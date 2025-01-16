import { EntityConfiguration } from 'electrodb';
import { DI_TOKENS } from '../const';
import { Inject, InjectContainer, OnInit } from '../di/decorators';
import { BaseEntityService } from '../entity';
import type { ClassConstructor, DepIdentifier, IDIContainer, ProviderOptions, } from '../interfaces/di';
import { createLogger, DefaultLogger, ILogger } from '../logging';
import { camelCase, pascalCase } from '../utils/cases';
import type { OmitAnyKeys } from '../utils/types';
import { Service } from './service';

import { DIContainer } from '../di/container';
import { getModuleMetadata } from '../di/metadata';

export type EntitySchemaProviderOptions = OmitAnyKeys<ProviderOptions<any>, 'provide' | 'useClass' | 'useConfig' | 'useExisting'> & {
    forEntity: DepIdentifier<any>;
    providedIn?: 'ROOT' | DIContainer | ClassConstructor;
    doNotAutoRegisterEntityService?: boolean;
};

function makeAutoGenEntityServiceName(entityName: string){
    return `${pascalCase(camelCase(entityName))}Service[AutoGen]`
}

export function registerEntitySchema(options: EntitySchemaProviderOptions){
    
    const entitySchemaToken = `${options.forEntity}Schema`;

    const optionsCopy = {
        ...options,
        type: 'schema',
        provide: entitySchemaToken,
    } as ProviderOptions<any>

    let container: IDIContainer | undefined;
    let diContainerHasBeenInitialized = true;

    if(!options.providedIn || options.providedIn === 'ROOT'){
        container = DIContainer.ROOT;
    } else if(options.providedIn instanceof DIContainer){
        container = options.providedIn!;
    } else if(typeof options.providedIn === 'function') {

        // Check if the providedIn is a class constructor
        const moduleMetadata = getModuleMetadata(options.providedIn);
        
        if (!moduleMetadata) {
            throw new Error(
                `Invalid providedIn option. No module metadata found for ${options.providedIn.name}; ensure the class is decorated with @DIModule({...}).`
            );
        }

        moduleMetadata.addProvider(optionsCopy);
        
        diContainerHasBeenInitialized = !!moduleMetadata.container;

        container = moduleMetadata.container;
    }

    if(container){
        
        try {
            container.register(optionsCopy);
        } catch (error) {
            DefaultLogger.error(`registerEntitySchema:: Error registering ${options.forEntity} schema with container:`, container);
            throw error;
        }

    } else if(diContainerHasBeenInitialized) {

        throw new Error(
            `Invalid providedIn option; no container could be resolved. Ensure it is either 'ROOT' or an instance of DI-container or a class decorated with @DIModule({...}).`
        );
    }

    if(options.doNotAutoRegisterEntityService){
        return;
    }

    const entityServiceName = makeAutoGenEntityServiceName(String(options.forEntity));

    @Service({
        priority: -1, 
        provide: entityServiceName,
        forEntity: options.forEntity, 
        providedIn: options.providedIn, 
    })
    class DefaultEntityService extends BaseEntityService<any> {
        readonly logger: ILogger = createLogger(DefaultEntityService);

        constructor(
            @Inject(DI_TOKENS.DYNAMO_ENTITY_CONFIGURATIONS)
            readonly entityConfiguration: EntityConfiguration,

            @Inject(entitySchemaToken) readonly schema: any,

            @InjectContainer()
            readonly container: IDIContainer,
        ) {
            super(schema, entityConfiguration, container);
        }
        
    }

    Object.defineProperty(DefaultEntityService, 'name', { value: entityServiceName });

}