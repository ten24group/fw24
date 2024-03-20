import { Entity, EntityConfiguration, Schema, EntityIdentifiers, CreateEntityItem, UpdateEntityItem, EntityItem } from "electrodb";
import { BaseEntityService } from "./base-service";
import { Narrow } from "../utils/types";

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

// todo: move to base entity
export type DefaultEntityOperations = {
    'get': "",
    'list': ""
    'create': "",
    'update': "",
    'delete': "",
};

export type DefaultEntityOpsInputSchema<Sch extends Schema<any, any, any>> = {
    get: EntityIdentifiersTypeFromSchema<Sch>,
    create: CreateEntityItemTypeFromSchema<Sch>,
    update: UpdateEntityItemTypeFromSchema<Sch>,
    delete: EntityIdentifiersTypeFromSchema<Sch>,
    list: {},
}

/**
 * Extend this type for additional operations's input-schema types 
 * 
 */
export type TEntityOpsInputSchemas<Sch extends Schema<any, any, any>, Opp extends DefaultEntityOperations = DefaultEntityOperations> = {
    readonly [opName in keyof Opp] ?: opName extends keyof DefaultEntityOpsInputSchema<Sch> 
        ? DefaultEntityOpsInputSchema<Sch>[opName] 
        : {}
}

export type CreateEntityOptions<S extends Schema<any, any, any>> = {
    schema: S,
    entityConfigurations: EntityConfiguration;
}

export function createElectroDBEntity<S extends Schema<any, any, any>>(options: CreateEntityOptions<S>) {
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
export type EntityTypeFromSchema<TSchema> = TSchema extends Schema<infer A, infer F, infer C> 
    ? Entity<A, F, C, TSchema> 
    : never;


export type EntityRecordTypeFromSchema<Sch extends Schema<any, any, any>> = Narrow<EntityItem<EntityTypeFromSchema<Sch>>>;

// Entity service
export type EntityServiceTypeFromSchema<TSchema extends Schema<any, any, any>> = BaseEntityService<TSchema>;

// Entity identifiers
export type EntityIdentifiersTypeFromSchema<TSchema extends Schema<any, any, any>> = EntityIdentifiers<EntityTypeFromSchema<TSchema>>;

// Create entity
export type CreateEntityItemTypeFromSchema<TSchema extends Schema<any, any, any>> = CreateEntityItem<EntityTypeFromSchema<TSchema>>;

// Update entity
export type UpdateEntityItemTypeFromSchema<TSchema extends Schema<any, any, any> > = UpdateEntityItem<EntityTypeFromSchema<TSchema>>;