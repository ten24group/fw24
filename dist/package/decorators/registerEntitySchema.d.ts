import { EntitySchema } from '../entity/base-entity';
import type { ClassConstructor, DepIdentifier, IDIContainer, ProviderOptions } from '../interfaces/di';
import type { OmitAnyKeys } from '../utils/types';
export type EntitySchemaProviderOptions = OmitAnyKeys<ProviderOptions<any>, 'provide' | 'useClass' | 'useConfig' | 'useExisting'> & {
    forEntity: DepIdentifier<any>;
    providedIn?: 'ROOT' | IDIContainer | ClassConstructor;
    doNotAutoRegisterEntityService?: boolean;
};
export declare function registerEntitySchema<T extends EntitySchema<any, any, any>>(options: EntitySchemaProviderOptions & {
    forEntity: T['model']['entity'];
}): void;
