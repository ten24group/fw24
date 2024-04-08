import MakeCreateEntityConfig from './templates/create-entity';
import MakeUpdateEntityConfig from './templates/update-entity';
import MakeListEntityConfig from './templates/list-entity';
import MakeViewEntityConfig from './templates/view-entity';
import MakeEntityMenuConfig from './templates/entity-menu';
import { BaseEntityService, EntitySchema } from '../entity';

import {existsSync, mkdirSync, writeFileSync, readdirSync} from "fs";
import {
    resolve as pathResolve, 
    join as pathJoin
} from "path";

import { Fw24 } from '../core/fw24';

export class EntityUIConfigGen{

    async run(){
        this.process();
    }

    async process(){
        const menuConfigs: any[] = [];
        const entityConfigs: any = {}; 

        const serviceDirectories = this.prepareServicesDirectories();

        const services = await this.scanAndLoadServices(serviceDirectories);

        console.log(`Ui-config-gen::: Process::: all-services: `, services);

        let menuIndex = 1;
        // generate UI configs
        services.forEach( (service, entityName) => {

            const entitySchema = service.getEntitySchema();
            const entityDefaultOpsSchema = service.getOpsDefaultIOSchema();

            const createConfig = MakeCreateEntityConfig({
                entityName,
                entityNamePlural: entitySchema.model.entityNamePlural,
                properties: entityDefaultOpsSchema.create.input
            });

            const updateConfig = MakeUpdateEntityConfig({
                entityName,
                entityNamePlural: entitySchema.model.entityNamePlural,
                properties: entityDefaultOpsSchema.update.input
            });

            const listConfig = MakeListEntityConfig({
                entityName,
                entityNamePlural: entitySchema.model.entityNamePlural,
                properties: entityDefaultOpsSchema.list.output
            });

            const viewConfig = MakeViewEntityConfig({
                entityName,
                entityNamePlural: entitySchema.model.entityNamePlural,
                properties: entityDefaultOpsSchema.list.output
            });

            console.log(`Created entityCrudConfig for entity: ${entityName}.`, {createConfig, updateConfig, listConfig, viewConfig})

            entityConfigs[`list-${entityName.toLowerCase()}`] = listConfig;
            entityConfigs[`create-${entityName.toLowerCase()}`] = createConfig;
            entityConfigs[`edit-${entityName.toLowerCase()}`] = updateConfig;
            entityConfigs[`view-${entityName.toLowerCase()}`] = viewConfig;

            const menuConfig = MakeEntityMenuConfig({
                entityName,
                entityNamePlural: entitySchema.model.entityNamePlural,
                icon: entitySchema.model.entityMenuIcon || 'appStore',
                menuIndex: menuIndex++
            });

            console.log(`Created menuConfig for entity: ${entityName}.`, {menuConfig})

            menuConfigs.push(menuConfig);
        });

        await this.writeToFiles(menuConfigs, entityConfigs);
    }

    prepareServicesDirectories(){
        const fw24 = Fw24.getInstance();
        
        const serviceDirectories = [pathResolve('./src/services/')];

        if(fw24.hasModules()){
            console.log(`Ui-config-gen::: Process::: app has modules: `, fw24.getModules().keys());
            for(const [, module] of fw24.getModules()){
                const moduleServicesPath = pathJoin(module.getBasePath(), module.getServicesDirectory());
                console.log(`Ui-config-gen::: Process::: moduleServicesPath: `, moduleServicesPath);
                console.log(`Ui-config-gen::: Process::: res-moduleServicesPath: `, pathResolve(moduleServicesPath) );
                serviceDirectories.push(pathResolve(moduleServicesPath));
            }
        }

        return serviceDirectories;
    }

    async scanAndLoadServices(serviceDirectories: Array<string>){
        const services = new Map<string, BaseEntityService<any>>();
        
        for( const dir of serviceDirectories){
            console.log(`Ui-config-gen::: Process::: loading services from DIR: `, dir);
            const dirServices = await this.scanAndLoadServicesFromDirectory(dir);
            for(const [entityName, service] of dirServices){
                console.log(`Ui-config-gen::: Process::: loaded services from entity: `, entityName);
                services.set(entityName, service);
            }
        }

        return services;
    }
    
    async scanAndLoadServicesFromDirectory(servicesDir: string) {
    
        const loadedServices = new Map<string, BaseEntityService<EntitySchema<string, string, string>> > ;
        
        if(!existsSync(servicesDir)){
            console.log(`scanAndLoadServices:: servicesDir does not exists: ${servicesDir}`);
            return loadedServices;
        }   

        // Resolve the absolute path
        // const servicesDirectory = pathResolve(pathJoin(__dirname, '..', 'src', 'services'));
        // Get all the files in the controllers directory
        const serviceFiles = readdirSync(servicesDir);
        // Filter the files to only include TypeScript files
        const servicePaths = serviceFiles.filter((file) => file.endsWith(".ts"));
    
        for (const servicePath of servicePaths) {
            console.log(`trying to load servicePath: ${servicePath}`);
    
            try {
                // Dynamically import the service file
                const module = await import(pathJoin(servicesDir, servicePath));
                // Find and instantiate service classes
                for (const exportedItem of Object.values(module)) {
                    // find the factory function
                    if (typeof exportedItem === "function" && exportedItem.name === "factory") {
                        const service = exportedItem() as BaseEntityService<any>;
                        console.log(`loading service for entity: ${service.getEntityName()}`);
                        loadedServices.set(service.getEntityName(), service);
                        break;
                    } else {
                        // console.log(`SKIP: exportedItem is not a factory function: ${exportedItem}`);
                    }
                }
            } catch (e){
                console.log(`Exception while trying to load servicePath: ${servicePath}`, e);
            }
        }
    
        return loadedServices;
    }


    async writeToFiles(menuConfig: any[], entitiesConfig: any[]){
        console.log("Called writeToFiles:::::: ");
        const genDirectoryPath = pathResolve('./gen/');
        if (!existsSync(genDirectoryPath)){
            console.log("Gen DIR does not exists, creating: ", genDirectoryPath);
            mkdirSync(genDirectoryPath);
        }
    
        const configDirectoryPath = pathResolve(pathJoin(genDirectoryPath, 'config'));
        if (!existsSync(configDirectoryPath)){
            console.log("COnfig DIR does not exists, creating: ", configDirectoryPath);
            mkdirSync(configDirectoryPath);
        }
    
        const menuConfigFilePath = pathJoin(configDirectoryPath, 'menu.json');
        console.log("writing menu config.. into: ", menuConfigFilePath);
        writeFileSync(menuConfigFilePath, JSON.stringify(menuConfig, null, 2));
    
        const entitiesConfigFilePath = pathJoin(configDirectoryPath, 'entities.json');
        console.log("writing entities config.. into: ", entitiesConfigFilePath);
        writeFileSync(entitiesConfigFilePath, JSON.stringify(entitiesConfig, null, 2));
    }
}
