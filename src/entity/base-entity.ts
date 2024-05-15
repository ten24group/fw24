import { Entity, EntityConfiguration, Schema, EntityIdentifiers, CreateEntityItem, UpdateEntityItem, EntityItem, createSchema, Attribute } from "electrodb";
import { BaseEntityService } from "./base-service";
import { Narrow, Writable } from "../utils/types";

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
     * Validations for the attribute.
     */
    validations?: any[];
    
    /**
     * The field type for the UI.
     */
    fieldType?: 'text' | 'textarea' | 'select' | 'multi-select' | 'date' | 'time' | 'date-time' | 'number' | 'password' | 'radio' | 'checkbox';
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
        : opName extends 'get'      ? EntityIdentifiersTypeFromSchema<Sch>
        : opName extends 'create'   ? CreateEntityItemTypeFromSchema<Sch>
        : opName extends 'update'   ? UpdateEntityItemTypeFromSchema<Sch>
        : opName extends 'delete'   ? EntityIdentifiersTypeFromSchema<Sch>
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


export type EntityRecordTypeFromSchema<Sch extends EntitySchema<any, any, any>> = Narrow<EntityItem<EntityTypeFromSchema<Sch>>>;

// Entity service
export type EntityServiceTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = BaseEntityService<TSchema>;

// Entity identifiers
export type EntityIdentifiersTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<EntityIdentifiers<EntityTypeFromSchema<TSchema>>>;

// Create entity
export type CreateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<CreateEntityItem<EntityTypeFromSchema<TSchema>>>;

// Update entity
export type UpdateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any> > = Writable<UpdateEntityItem<EntityTypeFromSchema<TSchema>>>;