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

export type EntityAttribute = Attribute & {
    name ?: string; // Human readable name
    isIdentifier?: boolean;
    // field type for the UI
    validations ?: any[],
    fieldType?: 'text' | 'textarea' | 'select' | 'multi-select' | 'date' | 'time' | 'date-time' | 'number' | 'password' | 'radio' | 'checkbox';
}

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


// todo: maybe make it a enum
export const DefaultEntityOperations = {
    get: "get",
    list: "list",
    create: "create",
    update: "update",
    delete: "delete",
};

export type TDefaultEntityOperations = typeof DefaultEntityOperations;

/**
 * Extend this type for additional operations's input-schema types 
 * 
 */
export type TEntityOpsInputSchemas<
Sch extends EntitySchema<any, any, any>,
> = {
    readonly [opName in keyof Sch['model']['entityOperations']] 
        : opName extends 'get' 
            ? EntityIdentifiersTypeFromSchema<Sch>
            : opName extends 'create' 
                ? CreateEntityItemTypeFromSchema<Sch>
                : opName extends 'update' 
                    ? UpdateEntityItemTypeFromSchema<Sch>
                    : opName extends 'delete' 
                        ? EntityIdentifiersTypeFromSchema<Sch>
                        : {}
}

export type CreateEntityOptions<S extends EntitySchema<any, any, any>> = {
    schema: S,
    entityConfigurations: EntityConfiguration;
}

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