import type { EntityConfiguration, Schema, EntityIdentifiers, CreateEntityItem, UpdateEntityItem, EntityItem, Attribute, ResponseItem, UpsertItem } from "electrodb";
import { Entity } from "electrodb";
import type { EntityQuery } from './query-types';
import type { BaseEntityService } from "./base-service";
import type { OmitNever, Paths, Writable } from "../utils/types";
import { SearchIndexConfig } from '../search/types';
import { EntitySearchService } from '../search/services';
import { DepIdentifier } from "../interfaces";
/**
 *  ElectroDB entity  examples
 *
 * - https://github.com/nljms/ssia/blob/main/packages/database/storages/PlayerStorage.ts
 * - https://github.com/tywalch/electro-demo/blob/main/netlify/functions/share/ratelimit.ts
 * - https://gist.github.com/tywalch/8040087e0fc886ca5f742aa99b623e1b
 * -- https://medium.com/developing-koan/modeling-graph-relationships-in-dynamodb-c06141612a70
 * - https://gist.github.com/severi/5d181a3e779f41a5e5fce1b7dcd17a89
 * - https://github.com/ikushlianski/family-car-booking-backend/blob/main/services/core/booking/booking.repository.ts
 *
 */
/**
 * Represents the options for hydrating an entity.
 * It can be a string representing the entity name,
 * or an object with additional attributes and hydrate options.
*/
export type RelationalAttributes<T extends EntitySchema<any, any, any, any>> = OmitNever<{
    [K in keyof T['attributes']]: T['attributes'][K]['hidden'] extends true ? never : PickRelation<T, K> extends never ? never : PickRelation<T, K>;
}>;
export type NonRelationalAttributes<T extends EntitySchema<any, any, any, any>> = OmitNever<{
    [K in keyof T['attributes']]: T['attributes'][K]['hidden'] extends true ? never : PickRelation<T, K> extends never ? T['attributes'][K] : never;
}>;
export type PickRelation<E extends EntitySchema<any, any, any, any>, A extends keyof E['attributes']> = E['attributes'][A]['relation'] extends Relation<infer R> ? Relation<R> : never;
type _EntityAttributePaths<E extends EntitySchema<any, any, any, any>> = {
    [K in keyof NonRelationalAttributes<E>]?: K;
} & {
    [K in keyof RelationalAttributes<E>]?: _EntityAttributePaths<RelToRelatedEntity<RelationalAttributes<E>[K]>>;
};
export type EntityAttributePaths<E extends EntitySchema<any, any, any, any>> = Paths<_EntityAttributePaths<E>>;
export type HydrateOptionsMapForEntity<T extends EntitySchema<any, any, any, any>> = {
    [K in keyof NonRelationalAttributes<T>]?: boolean;
} & {
    [K in keyof RelationalAttributes<T>]?: boolean | HydrateOptionForRelation<RelationalAttributes<T>[K]>;
};
export type HydrateOptionForEntity<E extends EntitySchema<any, any, any, any>> = HydrateOptionsMapForEntity<E> | Array<EntityAttributePaths<E>>;
export type HydrateOptionForRelation<Rel extends Relation<any> = any> = {
    entityName?: Rel['entityName'];
    relationType?: Rel['type'];
    identifiers?: RelationIdentifiers<RelToRelatedEntity<Rel>['entity']>;
    attributes: HydrateOptionForEntity<RelToRelatedEntity<Rel>['entity']>;
};
export type RelationIdentifier<E extends EntitySchema<any, any, any, any> = any> = {
    source: string;
    target: keyof E['attributes'];
};
export type RelationIdentifiers<E extends EntitySchema<any, any, any, any> = any> = RelationIdentifier<E> | Array<RelationIdentifier<E>>;
/**
 * Creates an entity relation and infers the type based on the provided relation.
 *
 * @param relation - The relation to create.
 * @returns The created relation.
 */
export declare function createEntityRelation<E extends EntitySchema<any, any, any, any>>(relation: Relation<E>): Relation<E>;
export type RelToRelatedEntity<Rel> = Rel extends Relation<infer E> ? E : never;
/**
 * Represents a relation between entities.
 *
 * @template E - The type of the related entity schema.
 */
export type Relation<E extends EntitySchema<any, any, any, any> = any> = {
    /**
     * Represents a relation between entities.
     */
    entityName: E['model']['entity'];
    /**
     * The type of the relation.
     * Possible values: 'one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'.
     */
    type: 'one-to-many' | 'many-to-one';
    /**
     * Identifiers to load the related entity.
     * These are mappings between source entity attributes and related entity attributes.
     * The keys for source entities can support paths like 'att1.nestedKey1'.
     * The values can be a string representing the related entity attribute or an array of strings.
     *
     */
    identifiers: RelationIdentifiers<E> | (() => RelationIdentifiers<E>);
    hydrate?: boolean;
    /**
     * Attributes to load when hydrating this relation and Options for hydrating the relational attributes of of this relation.
     */
    attributes?: HydrateOptionForEntity<E>;
};
/**
 * Represents an entity attribute.
 */
export type EntityAttribute = Attribute & {
    /**
     * The human readable name of the attribute.
     */
    name?: string;
    /**
     * Indicates whether the attribute is an identifier.
     */
    isIdentifier?: boolean;
    /**
     * Indicates whether the attribute is an identifier.
     */
    isUnique?: boolean;
    relation?: Relation;
    /**
     * Validations for the attribute.
     */
    validations?: any[];
} & FieldMetadata;
export type FieldMetadata = TextFieldMetadata | NumberFieldMetadata | DateFieldMetadata | TimeFieldMetadata | DateTimeFieldMetadata | BooleanFieldMetadata | SelectFieldMetadata | RadioFieldMetadata | CheckboxFieldMetadata | FileFieldMetadata | RangeFieldMetadata | ColorFieldMetadata | ImageFieldMetadata | HiddenFieldMetadata | CustomFieldMetadata | RatingFieldMetadata | EditorFieldMetadata | CodeEditorFieldMetadata;
export interface BaseFieldMetadata {
    isVisible?: boolean;
    isListable?: boolean;
    isCreatable?: boolean;
    isEditable?: boolean;
    isFilterable?: boolean;
    isSearchable?: boolean;
    isSortable?: boolean;
    placeholder?: string;
    helpText?: string;
    tooltip?: string;
    filterConfig?: {
        defaultOperator?: string;
        availableOperators?: string[];
        predefinedOptions?: Array<{
            label: string;
            value: string;
        }>;
        filterType?: 'text' | 'select' | 'datetime' | 'number' | 'boolean';
    };
}
export interface IPageActionItem {
    label: string;
    url: string;
    icon?: string;
}
export interface IEntityPageAction {
    label: string;
    url?: string;
    icon?: string;
    type?: 'button' | 'dropdown';
    items?: IPageActionItem[];
    openInModal?: boolean;
    modalConfig?: {
        modalType: "confirm" | "list" | "form" | "accordion" | "custom" | "details";
        modalPageConfig: any;
        apiConfig?: {
            apiMethod: string;
            responseKey: string;
            apiUrl: string;
        };
        submitSuccessRedirect?: string;
    };
}
export interface IEntityPageColumn {
    sortOrder: number;
    fields: string[];
}
export interface IEntityPageColumnConfig {
    columns: IEntityPageColumn[];
}
interface TextFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'text' | 'textarea' | 'password' | 'email';
    maxLength?: number;
    mask?: string;
}
interface NumberFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'number';
    min?: number;
    max?: number;
    step?: number;
}
interface DateFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'date';
    minDate?: Date;
    maxDate?: Date;
    dateFormat?: string;
}
interface TimeFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'time';
    minTime?: string;
    maxTime?: string;
    timeFormat?: string;
}
interface DateTimeFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'datetime';
    minDateTime?: Date;
    maxDateTime?: Date;
    dateTimeFormat?: string;
}
interface ColorFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'color';
    defaultColor?: string;
}
interface BooleanFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'boolean' | 'switch' | 'toggle';
    trueLabel?: string;
    falseLabel?: string;
}
export interface SelectFieldMetadata<E extends EntitySchema<any, any, any> = any> extends BaseFieldMetadata {
    fieldType?: 'select' | 'multi-select' | 'autocomplete';
    options: FieldOptions<E>;
    maxSelections?: number;
    addNewOption?: {
        entityName: string;
    };
}
export declare function isSelectFieldMetadata(obj: any): obj is SelectFieldMetadata;
interface RadioFieldMetadata<E extends EntitySchema<any, any, any> = any> extends BaseFieldMetadata {
    fieldType?: 'radio';
    options: FieldOptions<E>;
    layout?: 'horizontal' | 'vertical';
}
interface CheckboxFieldMetadata<E extends EntitySchema<any, any, any> = any> extends BaseFieldMetadata {
    fieldType?: 'checkbox';
    options: FieldOptions<E>;
    layout?: 'horizontal' | 'vertical';
}
interface CommonFileFieldMetadata {
    accept?: string;
    maxFileSize?: number;
    fileNamePrefix?: string;
    getSignedUploadUrlAPIConfig?: GetSignedUploadUrlAPIConfig;
}
export interface FileFieldMetadata extends BaseFieldMetadata, CommonFileFieldMetadata {
    fieldType?: 'file';
}
export interface ImageFieldMetadata extends BaseFieldMetadata, CommonFileFieldMetadata {
    fieldType?: 'image';
    aspectRatio?: string;
    withImageCrop?: boolean;
    accept?: "image/*" | "image/png" | "image/jpeg" | "image/gif" | "image/bmp" | "image/webp";
}
interface RangeFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'range';
    min?: number;
    max?: number;
    step?: number;
    showValue?: boolean;
}
export type GetSignedUploadUrlAPIConfig = {
    apiUrl: string;
    apiMethod: 'GET' | 'POST';
};
interface HiddenFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'hidden';
}
interface CustomFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'custom';
}
interface RatingFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'rating';
    maxRating?: number;
}
interface EditorFieldMetadata extends BaseFieldMetadata, CommonFileFieldMetadata {
    fieldType?: 'rich-text' | 'wysiwyg';
}
interface CodeEditorFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'code' | 'markdown' | 'json';
}
export type FieldOptions<E extends EntitySchema<any, any, any> = any> = Array<FieldOption> | FieldOptionsAPIConfig<E>;
export type FieldOption = {
    value: string;
    label: string;
};
/**
 * Represents the template for attributes.
 * like
 * ```ts
 * {
 *      composite: ['att1', 'att2'],
 *      template: '{att1}-AND-${att2}' // any arbitrary string with placeholders
 * }
 * ```
*/
export type AttributesTemplate = {
    composite: Array<string>;
    template: string;
};
export type FieldOptionsAPIConfig<E extends EntitySchema<any, any, any>> = {
    apiMethod: 'GET' | 'POST';
    apiUrl: string;
    responseKey: string;
    query?: EntityQuery<E>;
    optionMapping?: {
        label: string | AttributesTemplate;
        value: string | AttributesTemplate;
    };
};
export declare const SpecialAttributeTypes: {
    name: string;
    slug: string;
    color: string;
    image: string;
    description: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string;
};
export type SpecialAttributeType = keyof typeof SpecialAttributeTypes;
/**
 * Represents the schema for an entity.
 *
 * @template Opp - The type of entity operations.
 */
export interface EntitySchema<A extends string, F extends string, C extends string, Opp extends TDefaultEntityOperations = TDefaultEntityOperations> extends Schema<A, F, C> {
    readonly model: Schema<A, F, C>['model'] & {
        readonly entityNamePlural: string;
        readonly entityOperations: Opp;
        readonly entityMenuIcon?: string;
        readonly entityNameAttribute?: string;
        readonly entitySlugAttribute?: string;
        readonly entityImageAttribute?: string;
        readonly entityDescriptionAttribute?: string;
        readonly excludeFromAdminMenu?: boolean;
        readonly excludeFromAdminList?: boolean;
        readonly excludeFromAdminDetail?: boolean;
        readonly excludeFromAdminCreate?: boolean;
        readonly excludeFromAdminUpdate?: boolean;
        readonly excludeFromAdminDelete?: boolean;
        readonly excludeFromAdminDuplicate?: boolean;
        readonly CRUDApiPath?: string;
        readonly menuGroup?: string;
        readonly menuOrder?: number;
        readonly viewPageActions?: IEntityPageAction[];
        readonly viewPageBreadcrumbs?: Array<{
            label: string;
            url?: string;
        }>;
        readonly viewPageColumnsConfig?: IEntityPageColumnConfig;
        readonly editPageActions?: IEntityPageAction[];
        readonly editPageBreadcrumbs?: Array<{
            label: string;
            url?: string;
        }>;
        readonly editPageColumnsConfig?: IEntityPageColumnConfig;
        readonly search?: {
            enabled: boolean;
            indexConfig?: SearchIndexConfig;
            serviceClass?: DepIdentifier<EntitySearchService<any>> | typeof EntitySearchService | EntitySearchService<any>;
            documentTransformer?: (entity: EntityRecordTypeFromSchema<EntitySchema<A, F, C>>) => Promise<Record<string, any>>;
        };
    };
    readonly attributes: {
        readonly [a in A]: EntityAttribute;
    };
}
export declare const DefaultEntityOperations: {
    get: string;
    list: string;
    query: string;
    create: string;
    upsert: string;
    update: string;
    delete: string;
    duplicate: string;
};
export type TDefaultEntityOperations = typeof DefaultEntityOperations;
/**
 * Represents the input schemas for entity operations.
 * Extend this type for additional operations's input-schema types
 * @template Sch - The entity schema type.
 */
export type TEntityOpsInputSchemas<Sch extends EntitySchema<any, any, any>> = {
    readonly [opName in keyof Sch['model']['entityOperations']]: opName extends 'get' ? EntityIdentifiersTypeFromSchema<Sch> | Array<EntityIdentifiersTypeFromSchema<Sch>> : opName extends 'create' ? CreateEntityItemTypeFromSchema<Sch> : opName extends 'upsert' ? UpsertEntityItemTypeFromSchema<Sch> : opName extends 'update' ? UpdateEntityItemTypeFromSchema<Sch> : opName extends 'delete' ? EntityIdentifiersTypeFromSchema<Sch> | Array<EntityIdentifiersTypeFromSchema<Sch>> : opName extends 'duplicate' ? EntityIdentifiersTypeFromSchema<Sch> : {};
};
export type CreateElectroDBEntityOptions<S extends EntitySchema<any, any, any>> = {
    schema: S;
    entityConfigurations: EntityConfiguration;
};
/**
 * This function is used to define an entity schema for DynamoDB based entity, and it used ElectroDB under the hood.
 * It takes an object as an argument that describes the model, attributes, and indexes of the entity.
 * the generic params are only for the type inference, and they are not used in the function.
 *
 * @param schema - The entity schema configuration.
 *
 * @example
 * import { createEntitySchema } from '@ten24Group/fw24'
 *
 * const entitySchema = createEntitySchema({
 *   // entity schema configuration
 *
 *  // metadata about the entity
 *  model: {
 *      version: '1',
 *      entity: 'user',             // the name of the entity
 *      entityNamePlural: 'Users', // used by auto generated UI
 *      entityOperations: DefaultEntityOperations, // the operations that can be performed on the entity
 *      service: 'users', // ElectroDB service name [logical group of entities]
 *  },
 * // the attributes for the entity
 *  attributes: {
 *     userId: {
 *      type: 'string',
 *      required: true,
 *      readOnly: true,
 *      default: () => randomUUID()
 *    },
 *   // ... other attributes
 *  },
 * // the access patterns for the entity
 *  indexes: {
 *      primary: {
 *          pk: {
 *              field: 'primary_pk',
 *              composite: ['userId'],
 *          },
 *          sk: {
 *              field: 'primary_sk',
 *              composite: [],
 *          }
 *      },
 *      // ... other indexes
 *  },
 * } as const );
 *
 *
 */
export declare function createEntitySchema<A extends string, F extends string, C extends string, S extends EntitySchema<A, F, C, Ops>, Ops extends TDefaultEntityOperations = TDefaultEntityOperations>(schema: S): S;
export declare function createElectroDBEntity<S extends EntitySchema<any, any, any>>(options: CreateElectroDBEntityOptions<S>): {
    name: string;
    entity: Entity<string, string, string, S>;
    schema: S;
    symbol: symbol;
};
export type EntityTypeFromSchema<TSchema> = TSchema extends EntitySchema<infer A, infer F, infer C> ? Entity<A, F, C, TSchema> : never;
export type EntityResponseItemTypeFromSchema<TSchema> = TSchema extends EntitySchema<infer A, infer F, infer C> ? ResponseItem<A, F, C, TSchema> : never;
export type UpsertEntityItem<E extends Entity<any, any, any, any>> = E extends Entity<infer A, infer F, infer C, infer S> ? UpsertItem<A, F, C, S> : never;
export type EntityRecordTypeFromSchema<Sch extends EntitySchema<any, any, any>> = EntityItem<EntityTypeFromSchema<Sch>>;
export type EntityServiceTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = BaseEntityService<TSchema>;
export type EntityIdentifiersTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<EntityIdentifiers<EntityTypeFromSchema<TSchema>>>;
export type CreateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<CreateEntityItem<EntityTypeFromSchema<TSchema>>>;
export type UpsertEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<UpsertEntityItem<EntityTypeFromSchema<TSchema>>>;
export type UpdateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<UpdateEntityItem<EntityTypeFromSchema<TSchema>>>;
export {};
