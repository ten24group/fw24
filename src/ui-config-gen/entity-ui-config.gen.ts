import { type } from 'os';
import MakeCreateEntityConfig from './templates/create-entity';
import MakeUpdateEntityConfig from './templates/update-entity';
import MakeListEntityConfig from './templates/list-entity';
import MakeViewEntityConfig from './templates/view-entity';
import MakeEntityMenuConfig from './templates/entity-menu';
import { BaseEntityService, EntitySchema } from '../entity';
import { makeCustomPageConfig, CustomPageOptions, ListPageConfig, FormPageConfig, DetailsPageConfig } from './templates/custom-page';

import MakeAuthConfig from './templates/auth';
import MakeDashboardConfig from './templates/dashboard';

import { existsSync, mkdirSync, writeFileSync } from "fs";
import {
    resolve as pathResolve,
    join as pathJoin
} from "path";

import { Fw24 } from '../core/fw24';
import { Helper } from '../core/helper';
import { LogDuration, createLogger } from '../logging';

export class EntityUIConfigGen {
    readonly logger = createLogger(EntityUIConfigGen.name);
    // make sure to create a child container to not pollute anything in the Application container 
    // while scanning and loading stuff
    readonly uiGenDIContainer = Fw24.getInstance().getAppDIContainer();

    private customPages: Map<string, CustomPageOptions> = new Map();

    @LogDuration()
    async scanCustomPages() {
        const fw24 = Fw24.getInstance();
        const config = fw24.getConfig();
        const customPagesDir = config.uiConfigGenOptions?.customPagesDirectory || 'custom-pages';

        const customPagesDirectories = [ pathResolve(`./src/${customPagesDir}/`) ];

        if (fw24.hasModules()) {
            for (const [ , module ] of fw24.getModules()) {
                const moduleCustomPagesPath = pathJoin(module.getBasePath(), customPagesDir);
                customPagesDirectories.push(pathResolve(moduleCustomPagesPath));
            }
        }

        for (const dir of customPagesDirectories) {
            if (!existsSync(dir)) {
                this.logger.debug(`Custom pages directory does not exist: ${dir}`);
                continue;
            }

            const customPageFiles = Helper.scanTSSourceFilesFrom(dir);

            for (const file of customPageFiles) {
                try {
                    const module = await import(pathJoin(dir, file));
                    for (const [ key, value ] of Object.entries(module)) {
                        if (this.isValidCustomPageConfig(value)) {
                            const pageName = this.getPageNameFromConfig(value);
                            if (pageName) {
                                this.registerCustomPage(value);
                                this.logger.debug(`Registered custom page: ${pageName}`);
                            }
                        }
                    }
                } catch (e) {
                    this.logger.error(`Error loading custom page from ${file}:`, e);
                }
            }
        }
    }

    private isValidCustomPageConfig(value: unknown): value is CustomPageOptions {
        if (!value || typeof value !== 'object') return false;

        const config = value as Record<string, unknown>;
        if (!('pageType' in config) || !('pageTitle' in config)) return false;

        const pageType = config.pageType;
        if (pageType === 'list') {
            return 'listPageConfig' in config;
        } else if (pageType === 'form') {
            return 'formPageConfig' in config;
        } else if (pageType === 'details') {
            return 'detailsPageConfig' in config;
        }
        return false;
    }

    private getPageNameFromConfig(config: CustomPageOptions): string | null {
        switch (config.pageType) {
            case 'list':
                return `list-${config.pageTitle.toLowerCase().replace(/\s+/g, '-')}`;
            case 'form':
                return config.pageTitle.toLowerCase().includes('add')
                    ? `create-${config.pageTitle.toLowerCase().replace(/\s+/g, '-').replace('add-', '')}`
                    : `edit-${config.pageTitle.toLowerCase().replace(/\s+/g, '-').replace('edit-', '')}`;
            case 'details':
                return `view-${config.pageTitle.toLowerCase().replace(/\s+/g, '-')}`;
            default:
                return null;
        }
    }

    /**
     * Register a custom page. Supports optional routePattern for dynamic routes (e.g., /author/:authorId/books)
     */
    registerCustomPage(options: CustomPageOptions) {
        const pageName = this.getPageNameFromConfig(options);
        if (pageName) {
            this.customPages.set(pageName, options);
        }
    }

    async run() {
        this.process();
    }

    @LogDuration()
    async process() {
        const menuConfigs: any[] = [];
        const entityConfigs: any = {};

        const serviceDirectories = this.prepareServicesDirectories();

        const services = await this.scanAndLoadServices(serviceDirectories);

        // Scan and load custom pages
        await this.scanCustomPages();

        this.logger.debug(`Ui-config-gen::: Process::: all-services: `, Array.from(services.keys()));

        let menuIndex = 1;
        // generate UI configs
        services.forEach((service, entityName) => {

            const entitySchema = service.getEntitySchema();
            const entityDefaultOpsSchema = service.getOpsDefaultIOSchema();

            if (!entitySchema.model.excludeFromAdminCreate) {
                const createConfig = MakeCreateEntityConfig({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    properties: entityDefaultOpsSchema.create.input
                }, service);
                entityConfigs[ `create-${entityName.toLowerCase()}` ] = createConfig;
            }

            if (!entitySchema.model.excludeFromAdminUpdate) {
                const updateConfig = MakeUpdateEntityConfig({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    properties: entityDefaultOpsSchema.update.input,
                    actions: entitySchema.model.editPageActions,
                    breadcrumbs: entitySchema.model.editPageBreadcrumbs,
                }, service);
                entityConfigs[ `edit-${entityName.toLowerCase()}` ] = updateConfig;
            }

            if (!entitySchema.model.excludeFromAdminList) {
                const listConfig = MakeListEntityConfig({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    properties: entityDefaultOpsSchema.list.output,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    excludeFromAdminCreate: entitySchema.model.excludeFromAdminCreate,
                    excludeFromAdminUpdate: entitySchema.model.excludeFromAdminUpdate,
                    excludeFromAdminDelete: entitySchema.model.excludeFromAdminDelete,
                    excludeFromAdminDetail: entitySchema.model.excludeFromAdminDetail
                });
                entityConfigs[ `list-${entityName.toLowerCase()}` ] = listConfig;
            }

            if (!entitySchema.model.excludeFromAdminDetail) {
                const viewConfig = MakeViewEntityConfig({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    properties: entityDefaultOpsSchema.get.output,
                    CRUDApiPath: entitySchema.model.CRUDApiPath,
                    actions: entitySchema.model.viewPageActions,
                    breadcrumbs: entitySchema.model.viewPageBreadcrumbs,
                }, service);
                entityConfigs[ `view-${entityName.toLowerCase()}` ] = viewConfig;
            }

            if (!entitySchema.model.excludeFromAdminMenu) {
                const menuConfig = MakeEntityMenuConfig({
                    entityName,
                    entityNamePlural: entitySchema.model.entityNamePlural,
                    icon: entitySchema.model.entityMenuIcon || 'appStore',
                    menuIndex: menuIndex++,
                    excludeFromAdminList: entitySchema.model.excludeFromAdminList,
                    excludeFromAdminCreate: entitySchema.model.excludeFromAdminCreate,
                });

                menuConfigs.push(menuConfig);
            }

        });

        // Process custom pages
        for (const [ pageName, options ] of this.customPages) {
            const customConfig = makeCustomPageConfig(options);
            entityConfigs[ pageName ] = customConfig;
        }

        const authConfigOptions = Fw24.getInstance().getConfig().uiConfigGenOptions || {};

        const authConfigs = MakeAuthConfig({
            ...authConfigOptions,
            authEndpoint: authConfigOptions.authEndpoint || 'mauth'
        });

        const dashboardConfig = MakeDashboardConfig();

        await this.writeToFiles(menuConfigs, entityConfigs, authConfigs, dashboardConfig);
    }

    @LogDuration()
    prepareServicesDirectories() {
        const fw24 = Fw24.getInstance();

        const serviceDirectories = [ pathResolve('./src/services/') ];

        if (fw24.hasModules()) {
            this.logger.debug(`Ui-config-gen::: Process::: app has modules: `, Array.from(fw24.getModules().keys()));
            for (const [ , module ] of fw24.getModules()) {
                const moduleServicesPath = pathJoin(module.getBasePath(), module.getServicesDirectory());
                this.logger.debug(`Ui-config-gen::: Process::: moduleServicesPath: `, moduleServicesPath);
                this.logger.debug(`Ui-config-gen::: Process::: res-moduleServicesPath: `, pathResolve(moduleServicesPath));
                serviceDirectories.push(pathResolve(moduleServicesPath));
            }
        }

        return serviceDirectories;
    }

    @LogDuration()
    async scanAndLoadServices(serviceDirectories: Array<string>) {

        const scannedServices = new Set<Function>();

        for (const dir of serviceDirectories) {
            this.logger.debug(`Ui-config-gen::: Process::: loading services from DIR: `, dir);
            const dirServiceTokens = await this.scanServicesFromDirectory(dir);
            dirServiceTokens.forEach(token => scannedServices.add(token));
        }

        // get all container registered services to make sure auto-gen entity-services are also included
        this.uiGenDIContainer.collectBestProvidersFor({
            type: 'service',
            allProvidersFromChildContainers: true
        }).filter(opt => {
            // make sure to collect only the entity service providers
            return !!opt._provider.forEntity
        }).forEach(opt => {
            scannedServices.add(opt._provider.provide as Function);
        })

        // resolve all services
        const resolvedServices = new Map<string, BaseEntityService<any>>();

        scannedServices.forEach(token => {
            const service = this.uiGenDIContainer.resolve(token, {
                allProvidersFromChildContainers: true
            }) as BaseEntityService<any>;

            this.logger.debug(`resolved service for entity: ${service.getEntityName()}`);

            this.logger.debug(`Ui-config-gen::: Process::: loaded services from entity: `, service.getEntityName());
            resolvedServices.set(service.getEntityName(), service);
        })

        return resolvedServices;
    }

    @LogDuration()
    async scanServicesFromDirectory(servicesDir: string) {

        const scannedServices = new Set<Function>();

        if (!existsSync(servicesDir)) {
            this.logger.warn(`scanServicesFromDirectory: servicesDir does not exists: ${servicesDir}`);
            return scannedServices;
        }

        const servicePaths = Helper.scanTSSourceFilesFrom(servicesDir);

        for (const servicePath of servicePaths) {
            this.logger.debug(`trying to load servicePath: ${servicePath}`);

            try {
                // Dynamically import the service file
                const module = await import(pathJoin(servicesDir, servicePath));

                // Find and instantiate service classes
                for (const exportedItem of Object.values(module)) {
                    if (
                        exportedItem
                        && typeof exportedItem === 'function'
                        && 'prototype' in exportedItem
                        && exportedItem.prototype instanceof BaseEntityService
                    ) {

                        if (this.uiGenDIContainer.has(exportedItem, {
                            type: 'service',
                            allProvidersFromChildContainers: true
                        })) {
                            scannedServices.add(exportedItem);
                            this.logger.debug(`scanServicesFromDirectory: registering service: ${exportedItem.name}`);
                            continue;
                        }

                        this.logger.debug(`scanServicesFromDirectory: no provider could be found for service: ${exportedItem.name}`);

                    } else {

                        this.logger.debug(`scanServicesFromDirectory: SKIP: exportedItem is not a service class: ${(exportedItem as any)?.name ? (exportedItem as any).name : exportedItem}`);
                    }
                }
            } catch (e) {
                this.logger.error(`scanServicesFromDirectory: Exception while trying to load servicePath: ${servicePath}`, e);
            }
        }

        return scannedServices;
    }

    @LogDuration()
    async writeToFiles(menuConfig: any, entitiesConfig: any, authConfig: any, dashboardConfig: any) {
        this.logger.debug("Called writeToFiles:::::: ");
        const genDirectoryPath = pathResolve('./gen/');
        if (!existsSync(genDirectoryPath)) {
            this.logger.debug(`Gen DIR does not exists, creating: ${genDirectoryPath}`,);
            mkdirSync(genDirectoryPath);
        }

        const configDirectoryPath = pathResolve(pathJoin(genDirectoryPath, 'config'));
        if (!existsSync(configDirectoryPath)) {
            this.logger.debug(`Config DIR does not exists, creating: ${configDirectoryPath}`);
            mkdirSync(configDirectoryPath);
        }

        const menuConfigFilePath = pathJoin(configDirectoryPath, 'menu.json');
        this.logger.debug(`writing menu-config.. into: ${menuConfigFilePath}`);
        writeFileSync(menuConfigFilePath, JSON.stringify(menuConfig, null, 2));

        const entitiesConfigFilePath = pathJoin(configDirectoryPath, 'entities.json');
        this.logger.debug(`writing entities-config.. into: ${entitiesConfigFilePath}`,);
        writeFileSync(entitiesConfigFilePath, JSON.stringify(entitiesConfig, null, 2));

        const authConfigFilePath = pathJoin(configDirectoryPath, 'auth.json');
        this.logger.debug(`writing auth-config.. into: ${authConfigFilePath}`,);
        writeFileSync(authConfigFilePath, JSON.stringify(authConfig, null, 2));

        const dashboardConfigFilePath = pathJoin(configDirectoryPath, 'dashboard.json');
        this.logger.debug(`writing dashboard-config.. into: ${dashboardConfigFilePath}`,);
        writeFileSync(dashboardConfigFilePath, JSON.stringify(dashboardConfig, null, 2));

    }
}

