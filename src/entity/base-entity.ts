import { EntityQuery } from './query-types';
import { Entity, EntityConfiguration, Schema, EntityIdentifiers, CreateEntityItem, UpdateEntityItem, EntityItem, createSchema, Attribute } from "electrodb";
import { BaseEntityService } from "./base-service";
import { Narrow, OmitNever, Paths, ValueOf, Writable } from "../utils/types";

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
  [K in keyof T['attributes']]: T['attributes'][K]['hidden'] extends true ? never 
    : PickRelation<T, K> extends never ? never 
    : PickRelation<T, K>;
}>

export type NonRelationalAttributes<T extends EntitySchema<any, any, any, any>> = OmitNever<{
  [K in keyof T['attributes']]: T['attributes'][K]['hidden'] extends true ? never
  : PickRelation<T, K> extends never ? T['attributes'][K] : never
}>

export type PickRelation<E extends EntitySchema<any, any, any, any>, A extends keyof E['attributes']> = 
E['attributes'][A]['relation'] extends Relation<infer R> ? Relation<R> : never;

// utility type for prepare all the paths for entity and it's relations
type _EntityAttributePaths<E extends EntitySchema<any, any, any, any>> = 
{ [K in keyof NonRelationalAttributes<E>] ?: K } 
& 
{ [K in keyof RelationalAttributes<E>] ?: _EntityAttributePaths<RelationalAttributes<E>[K]['entity'] > }
// utility type for prepare all the paths for entity and it's relations
export type EntityAttributePaths<E extends EntitySchema<any, any, any, any>> = Paths<_EntityAttributePaths<E>>;


export type HydrateOptionsMapForEntity<T extends EntitySchema<any, any, any, any>> = 
{ [K in keyof NonRelationalAttributes<T>] ?: boolean; } 
& 
{ [K in keyof RelationalAttributes<T>]?: boolean | HydrateOptionForRelation<RelationalAttributes<T>[K]> };

export type HydrateOptionForEntity<E extends EntitySchema<any, any, any, any>> = HydrateOptionsMapForEntity<E> | Array<EntityAttributePaths<E>>;

export type HydrateOptionForRelation<Rel extends Relation<any>=any> = {
    entityName?: Rel['entity']['model']['entity'],
    relationType?: Rel['type'],
    identifiers?: RelationIdentifiers<Rel['entity']>,
    attributes: HydrateOptionForEntity<Rel['entity']>
}


export type RelationIdentifier<E extends EntitySchema<any, any, any, any> = any> = { source?: string, target: keyof E['attributes'] };
export type RelationIdentifiers<E extends EntitySchema<any, any, any, any> = any> = RelationIdentifier<E> | Array<RelationIdentifier<E>>
/**
 * Creates an entity relation and infers the type based on the provided relation.
 * 
 * @param relation - The relation to create.
 * @returns The created relation.
 */
export function createEntityRelation<E extends EntitySchema<any, any, any, any>>(relation: Relation<E>): Relation<E> {
    return relation;
}

/**
 * Represents a relation between entities.
 *
 * @template E - The type of the related entity schema.
 */
export type Relation<E extends EntitySchema<any, any, any, any> = any> = {
    /**
     * Represents a relation between entities.
     */
    entity: E;

    /**
     * The type of the relation.
     * Possible values: 'one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'.
     */
    type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

    /**
     * Identifiers to load the related entity.
     * These are mappings between source entity attributes and related entity attributes.
     * The keys for source entities can support paths like 'att1.nestedKey1'.
     * The values can be a string representing the related entity attribute or an array of strings.
     * 
     */
    identifiers?: RelationIdentifiers<E>;

    // set this to true in entity-definition to auto-hydrate this relation
    hydrate ?: boolean;
    
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

    // define a relation with another entity use the type-helper `createEntityRelation` function
    relation ?: Relation;

    /**
     * Validations for the attribute.
     */
    validations?: any[];

} 
& FieldMetadata;


export type FieldMetadata = TextFieldMetadata | NumberFieldMetadata | DateFieldMetadata 
    | TimeFieldMetadata | DateTimeFieldMetadata | BooleanFieldMetadata 
    | SelectFieldMetadata | RadioFieldMetadata | CheckboxFieldMetadata 
    | FileFieldMetadata | RangeFieldMetadata | ColorFieldMetadata
    | ImageFieldMetadata | HiddenFieldMetadata | CustomFieldMetadata 
    | RatingFieldMetadata | EditorFieldMetadata | CodeEditorFieldMetadata;

// Metadata for UI
export interface BaseFieldMetadata {
    isVisible?: boolean; // if the field is visible or hidden on all detail-pages
    isListable?: boolean; // if the field is visible in the list view
    isCreatable?: boolean; // if the field is creatable
    isEditable?: boolean; // if the field is editable
    isFilterable?: boolean; // if the field is filterable
    isSearchable?: boolean; // if the field is searchable
    placeholder?: string;
    helpText?: string;
    tooltip?: string; // maybe this can be inferred from the helpText
}

interface TextFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'text' | 'textarea' | 'password';
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
  dateFormat?: string; // format to display the date
}


interface TimeFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'time';
  minTime?: string; // in HH:mm format
  maxTime?: string; // in HH:mm format
  timeFormat?: string; // format to display the time
}

interface DateTimeFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'datetime';
  minDateTime?: Date;
  maxDateTime?: Date;
  dateTimeFormat?: string; // format to display the date and time
}

interface ColorFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'color';
  defaultColor?: string; // default color value
}

interface BooleanFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'boolean' | 'switch' | 'toggle';
  trueLabel?: string; // label for the true value
  falseLabel?: string; // label for the false value
}

interface SelectFieldMetadata<E extends EntitySchema<any, any, any> = any> extends BaseFieldMetadata {
  fieldType?: 'select' | 'multi-select' | 'autocomplete';
  options: FieldOptions<E>;
  maxSelections?: number; // maximum number of selections
}

interface RadioFieldMetadata<E extends EntitySchema<any, any, any>=any> extends BaseFieldMetadata {
  fieldType?: 'radio';
  options: FieldOptions<E>;
  layout?: 'horizontal' | 'vertical'; // layout of the radio buttons
}

interface CheckboxFieldMetadata<E extends EntitySchema<any, any, any>=any> extends BaseFieldMetadata {
    fieldType?: 'checkbox';
    options: FieldOptions<E>;
    layout?: 'horizontal' | 'vertical'; // layout of the radio buttons
}

interface FileFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'file';
  acceptedFileTypes?: string[];
  maxFileSize?: number; // maximum file size in bytes
}

interface RangeFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'range';
  min?: number;
  max?: number;
  step?: number;
  showValue?: boolean; // whether to show the current value
}

interface ImageFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'image';
  acceptedFileTypes?: string[];
  maxFileSize?: number; // maximum file size in bytes
  aspectRatio?: string; // desired aspect ratio for the image
}

interface HiddenFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'hidden';
}

interface CustomFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'custom';
}

interface RatingFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'rating';
  maxRating?: number; // maximum rating value
}

interface EditorFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'rich-text' | 'wysiwyg';  
}

interface CodeEditorFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'code' | 'markdown' | 'json';  
}

export type FieldOptions<E extends EntitySchema<any, any, any>=any> = Array<FieldOption> | FieldOptionsAPIConfig<E>;

export type FieldOption = {
  value: string,
  label: string,
}

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
    composite: Array<string>,
    template: string,
}
export type FieldOptionsAPIConfig<E extends EntitySchema<any, any, any>> = {
    apiMethod: 'GET' | 'POST',
    apiUrl: string,
    responseKey: string,
    query?: EntityQuery<E>,
    optionMapping?: {
        label: string | AttributesTemplate, // 
        value: string | AttributesTemplate, // 
    },
}

/**
 * Represents the schema for an entity.
 *
 * @template Opp - The type of entity operations.
 */
export interface EntitySchema<
    A extends string, 
    F extends string, 
    C extends string,
    Opp extends TDefaultEntityOperations = TDefaultEntityOperations
> extends Schema<A, F, C>{
    readonly model: Schema<A, F, C>['model'] & {
        readonly entityNamePlural: string;
        readonly entityOperations: Opp; 
        readonly entityMenuIcon ?: string,
    };
    readonly attributes: {
        readonly [a in A]: EntityAttribute;
    };
}

export const DefaultEntityOperations = {
    get: "get",
    list: "list",
    query: "query",
    create: "create",
    update: "update",
    delete: "delete",
};

export type TDefaultEntityOperations = typeof DefaultEntityOperations;

/**
 * Represents the input schemas for entity operations.
 * Extend this type for additional operations's input-schema types 
 * @template Sch - The entity schema type.
 */
export type TEntityOpsInputSchemas<
Sch extends EntitySchema<any, any, any>,
> = {
    readonly [opName in keyof Sch['model']['entityOperations']] 
        : opName extends 'get'      ? EntityIdentifiersTypeFromSchema<Sch> | Array<EntityIdentifiersTypeFromSchema<Sch>>
        : opName extends 'create'   ? CreateEntityItemTypeFromSchema<Sch>
        : opName extends 'update'   ? UpdateEntityItemTypeFromSchema<Sch>
        : opName extends 'delete'   ? EntityIdentifiersTypeFromSchema<Sch> | Array<EntityIdentifiersTypeFromSchema<Sch>>
        : {}
}

export type CreateEntityOptions<S extends EntitySchema<any, any, any>> = {
    schema: S,
    entityConfigurations: EntityConfiguration;
}


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
export function createEntitySchema<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C, Ops>,
  Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
>(schema: S): S {
    return createSchema(schema);
}

export function createElectroDBEntity<S extends EntitySchema<any, any, any>>(options: CreateEntityOptions<S>) {
    const { schema, entityConfigurations} = options;

	const newElectroDbEntity = new Entity(
        schema, 
        entityConfigurations
    );

    return {
        name:       schema.model.entity,
        entity:     newElectroDbEntity,
        schema:     schema,
        symbol:     Symbol.for(schema.model.entity),
    }
}

// Infer types utils
export type EntityTypeFromSchema<TSchema> = TSchema extends EntitySchema<infer A, infer F, infer C> 
    ? Entity<A, F, C, TSchema> 
    : never;


export type EntityRecordTypeFromSchema<Sch extends EntitySchema<any, any, any>> = EntityItem<EntityTypeFromSchema<Sch>>;

// Entity service
export type EntityServiceTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = BaseEntityService<TSchema>;

// Entity identifiers
export type EntityIdentifiersTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<EntityIdentifiers<EntityTypeFromSchema<TSchema>>>;

// Create entity
export type CreateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<CreateEntityItem<EntityTypeFromSchema<TSchema>>>;

// Update entity
export type UpdateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any> > = Writable<UpdateEntityItem<EntityTypeFromSchema<TSchema>>>;