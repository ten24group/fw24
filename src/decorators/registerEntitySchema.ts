import type { ClassConstructor, DepIdentifier, IDIContainer,  } from '../interfaces/di';
import { BaseEntityService } from '../entity';
import { createLogger, ILogger } from '../logging';
import { DI_TOKENS } from '../const';
import { Inject, InjectContainer } from '../di/decorators';
import { EntityConfiguration } from 'electrodb';
import { camelCase, pascalCase } from '../utils/cases';
import { Service } from '.';

import { tryRegisterInjectable, InjectableOptions } from '../di/utils/tryRegisterInjectable';

export type SchemaInjectableOptions = InjectableOptions & {
    forEntity: DepIdentifier<any>;
    doNotAutoRegisterEntityService?: boolean
};

function makeEntityServiceDIToken(entityName: string){
    return `${pascalCase(camelCase(entityName))}Service[Gen]`
}

export function registerEntitySchema(target: ClassConstructor, options: SchemaInjectableOptions){
    
    tryRegisterInjectable(target, {
        ...options,
        type: 'schema'
    });

    if(options.doNotAutoRegisterEntityService){
        return;
    }

    @Service({forEntity: options.forEntity, priority: -1})
    class DefaultEntityService extends BaseEntityService<any> {
        readonly logger: ILogger = createLogger(DefaultEntityService);

        constructor(
            @Inject(DI_TOKENS.DYNAMO_ENTITY_CONFIGURATIONS)
            readonly entityConfiguration: EntityConfiguration,

            @InjectContainer()
            readonly container: IDIContainer,
        ) {
            const schema = container.resolveEntitySchema(options.forEntity);
            super(schema, entityConfiguration, container);
        }
    }
    
    Object.defineProperty(DefaultEntityService, 'name', { value: makeEntityServiceDIToken(String(options.forEntity)) });

}