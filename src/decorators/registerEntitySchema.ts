import { EntityConfiguration } from 'electrodb';
import { DI_TOKENS } from '../const';
import { BaseEntityService, EntitySchema } from '../entity';
import type { ClassConstructor, DepIdentifier, IDIContainer, ProviderOptions } from '../interfaces/di';
import { createLogger, DefaultLogger, ILogger } from '../logging';
import { camelCase, pascalCase } from '../utils/cases';
import type { OmitAnyKeys } from '../utils/types';

import { DIContainer } from '../di/container';
import { getModuleMetadata } from '../di/metadata';

export type EntitySchemaProviderOptions = OmitAnyKeys<
  ProviderOptions<any>,
  'provide' | 'useClass' | 'useConfig' | 'useExisting'
> & {
  forEntity: DepIdentifier<any>;
  providedIn?: 'ROOT' | IDIContainer | ClassConstructor;
  doNotAutoRegisterEntityService?: boolean;
};

function makeEntityServiceName(entityName: string) {
  return `${pascalCase(camelCase(entityName))}Service`;
}

export function registerEntitySchema<T extends EntitySchema<any, any, any>>(
  options: EntitySchemaProviderOptions & { forEntity: T['model']['entity'] },
) {
  const entitySchemaToken = `${options.forEntity}Schema`;

  const optionsCopy = {
    ...options,
    type: 'schema',
    provide: entitySchemaToken,
  } as ProviderOptions<any>;

  let container: IDIContainer | undefined;

  if (!options.providedIn || options.providedIn === 'ROOT') {
    container = DIContainer.ROOT;
  } else if (options.providedIn instanceof DIContainer) {
    container = options.providedIn!;
  } else if (typeof options.providedIn === 'function') {
    // Check if the providedIn is a class constructor
    const moduleMetadata = getModuleMetadata(options.providedIn);

    if (!moduleMetadata) {
      throw new Error(
        `Invalid providedIn option. No module metadata found for ${options.providedIn.name}; ensure the class is decorated with @DIModule({...}).`,
      );
    }

    moduleMetadata.addProvider(optionsCopy);

    container = moduleMetadata.container;
  }

  if (!container) {
    throw new Error(
      `Invalid providedIn option; no container could be resolved. Ensure it is either 'ROOT' or an instance of DI-container or a class decorated with @DIModule({...}).`,
    );
  }

  try {
    container.register(optionsCopy);
  } catch (error) {
    DefaultLogger.error(
      `registerEntitySchema:: Error registering ${options.forEntity} schema with container:`,
      container,
    );
    throw error;
  }

  if (options.doNotAutoRegisterEntityService) {
    return;
  }

  class AutoGenEntityService extends BaseEntityService<any> {
    constructor(
      readonly entityConfiguration: EntityConfiguration,
      readonly schema: any,
      readonly diContainer: IDIContainer,
    ) {
      super(schema, entityConfiguration, diContainer);
    }
  }
  const entityServiceName = makeEntityServiceName(String(optionsCopy.forEntity));
  Object.defineProperty(AutoGenEntityService, 'name', { value: entityServiceName });

  try {
    container.register({
      priority: -1,
      type: 'service',
      provide: AutoGenEntityService,
      forEntity: optionsCopy.forEntity,

      deps: [DI_TOKENS.DYNAMO_ENTITY_CONFIGURATIONS, entitySchemaToken, DIContainer],
      useFactory: (config: EntityConfiguration, schema: any, diContainer: IDIContainer) => {
        const service = new AutoGenEntityService(config, schema, diContainer);
        return service;
      },
    });
  } catch (error) {
    DefaultLogger.error(
      `registerEntitySchema:: Error registering ${options.forEntity} default-service with container:`,
      container,
    );
    throw error;
  }
}
