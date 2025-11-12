import { Authorizer } from "../authorize";
import { EventDispatcher } from "../event";
import { ILogger } from "../logging";
import { type IValidator } from "../validation";
import type { EntityResponseItemTypeFromSchema, EntitySchema, EntityServiceTypeFromSchema, TDefaultEntityOperations, TEntityOpsInputSchemas } from "./base-entity";
import { Actor } from "../core/types/execution-context";
import type { EntityQuery } from "./query-types";
/**
 *
 * Serializer/formatter
 *  - https://github.com/dkzlv/micro-transform
 *
 * Event dispatcher
 * - https://github.com/FoxAndFly/ts-event-dispatcher/blob/master/src/index.ts
 * - https://github.com/ryardley/ts-bus
 * - https://github.com/binier/tiny-typed-emitter/tree/master
 *
 * Router
 * - https://github.com/berstend/tiny-request-router/blob/master/src/router.ts
 *
 * DI
 * - https://github.com/nicojs/typed-inject
 * - https://github.com/microsoft/tsyringe
 * - https://github.com/owja/ioc
 *
 *
 */
export interface BaseEntityCrudArgs<S extends EntitySchema<any, any, any>> {
    entityName: string;
    entityService: EntityServiceTypeFromSchema<S>;
    crudType?: keyof TDefaultEntityOperations;
    actor?: Actor;
    tenant?: any;
    logger?: ILogger;
    validator?: IValidator;
    authorizer?: Authorizer.IAuthorizer;
    eventDispatcher?: EventDispatcher.IEventDispatcher;
}
/**
 * Represents the arguments for retrieving an entity.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface GetEntityArgs<Sch extends EntitySchema<any, any, any>, OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>> extends BaseEntityCrudArgs<Sch> {
    /**
     * The ID of the entity to retrieve.
     */
    id: OpsSchema['get'];
    /**
     * Optional array of attributes to include in the retrieved entity.
     */
    attributes?: Array<string>;
}
/**
 * Retrieves an entity based on the provided options.
 * @param options - The options for retrieving the entity.
 * @returns The retrieved entity.
 */
export declare function getEntity<S extends EntitySchema<any, any, any>>(options: GetEntityArgs<S>): Promise<{
    data: {
        readonly [x: string]: any;
    } | null;
}>;
/**
 * Represents the arguments for retrieving multiple entities in a batch.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface GetBatchEntityArgs<Sch extends EntitySchema<any, any, any>, OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>> extends BaseEntityCrudArgs<Sch> {
    /**
     * Array of entity IDs to retrieve.
     */
    ids: Array<OpsSchema['get']>;
    /**
     * Optional array of attributes to include in the retrieved entities.
     */
    attributes?: Array<string>;
    /**
     * Optional number of concurrent batch operations (default: 1).
     */
    concurrent?: number;
}
/**
 * Retrieves multiple entities in a batch operation.
 * @param options - The options for retrieving the entities.
 * @returns The retrieved entities and any unprocessed items.
 */
export declare function getBatchEntity<S extends EntitySchema<any, any, any>>(options: GetBatchEntityArgs<S>): Promise<{
    data: any[];
    unprocessed: never[];
}>;
/**
 * Represents the arguments for creating an entity.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface CreateEntityArgs<Sch extends EntitySchema<any, any, any>, OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>> extends BaseEntityCrudArgs<Sch> {
    /**
     * The data for creating the entity.
     */
    data: OpsSchema['create'];
}
export type CreateEntityResponse<Sch extends EntitySchema<any, any, any>> = {
    data?: EntityResponseItemTypeFromSchema<Sch>;
};
/**
 * Creates an entity using the provided options.
 *
 * @param options - The options for creating the entity.
 * @returns The created entity.
 * @throws Error if no data is provided for create operation, validation fails, or authorization fails.
 */
export declare function createEntity<S extends EntitySchema<any, any, any>>(options: CreateEntityArgs<S>): Promise<CreateEntityResponse<S>>;
/**
 * Represents the arguments for creating-OR-updating an entity.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface UpsertEntityArgs<Sch extends EntitySchema<any, any, any>, OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>> extends BaseEntityCrudArgs<Sch> {
    /**
     * The data for creating the entity.
     */
    data: OpsSchema['upsert'];
}
export type UpsertEntityResponse<Sch extends EntitySchema<any, any, any>> = {
    data?: EntityResponseItemTypeFromSchema<Sch>;
    wasCreated?: boolean;
    oldData?: EntityResponseItemTypeFromSchema<Sch>;
};
/**
 * Creates an entity using the provided options.
 *
 * @param options - The options for creating-OR-updating the entity.
 * @returns The created entity with wasCreated flag indicating if it was a new record.
 * @throws Error if no data is provided for upsert operation, validation fails, or authorization fails.
 */
export declare function upsertEntity<S extends EntitySchema<any, any, any>>(options: UpsertEntityArgs<S>): Promise<UpsertEntityResponse<S>>;
/**
 * Represents the arguments for listing entities.
 * @template Sch - The entity schema type.
 */
export interface ListEntityArgs<Sch extends EntitySchema<any, any, any>> extends BaseEntityCrudArgs<Sch> {
    query: EntityQuery<Sch>;
}
/**
 * Finds a matching index based on the provided filters and schema.
 * @param schema - The entity schema
 * @param filters - The filters to match against
 * @param entityName - The name of the entity
 * @param entityService - The entity service
 * @returns The name of the matching index and the filters used to match it or undefined if no match is found
 */
export declare function findMatchingIndex(schema: EntitySchema<any, any, any>, filters: Record<string, any> | undefined, entityName: string, entityService: EntityServiceTypeFromSchema<any>): {
    indexName: string;
    indexFilters: Record<string, any>;
} | undefined;
/**
 * Retrieves a list of entities based on the provided options.
 *
 * @param options - The options for listing entities.
 * @returns A promise that resolves to an array of entities.
 */
export declare function listEntity<S extends EntitySchema<any, any, any>>(options: ListEntityArgs<S>): Promise<{
    data: {
        readonly [x: string]: any;
    }[];
    cursor: string | null;
}>;
export interface QueryEntityArgs<Sch extends EntitySchema<any, any, any>> extends BaseEntityCrudArgs<Sch> {
    query: EntityQuery<Sch>;
}
/**
 * Executes a query on the specified entity.
 * @param options - The options for the query.
 * @returns A promise that resolves to the result of the query.
 */
export declare function queryEntity<S extends EntitySchema<any, any, any>>(options: QueryEntityArgs<S>): Promise<{
    data: {
        readonly [x: string]: any;
    }[];
    cursor: string | null;
}>;
/**
 * Represents the arguments for updating an entity.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface UpdateEntityArgs<Sch extends EntitySchema<any, any, any>, OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>> extends BaseEntityCrudArgs<Sch> {
    /**
     * The Identifiers of the entity to update.
     */
    id: OpsSchema['get'];
    /**
     * The data to update the entity with.
     */
    data: OpsSchema['update'];
    /**
     * Optional attributes for patch operation.
     */
    operators?: UpdateEntityOperators;
    /**
     * Optional conditions for the update operation.
     */
    conditions?: any;
    /**
     * Optional pre-calculated composite key data. If provided, this will be used directly.
     * If not provided and composite keys are needed, they will be calculated internally.
     */
    compositeKeyData?: Record<string, any>;
}
export interface UpdateEntityOperators {
    remove?: string[];
}
/**
 * Updates an entity in the database.
 *
 * @template S - The entity schema type.
 * @param {UpdateEntityArgs<S>} options - The options for updating the entity.
 * @returns {Promise<Entity>} - A promise that resolves to the updated entity.
 * @throws {Error} - If no data is provided for the update operation, or if validation or authorization fails.
 */
export declare function updateEntity<S extends EntitySchema<any, any, any>>(options: UpdateEntityArgs<S>): Promise<{
    data: Partial<import("electrodb").ResponseItem<any, any, any, EntitySchema<any, any, any, {
        readonly get: "get";
        readonly list: "list";
        readonly query: "query";
        readonly create: "create";
        readonly upsert: "upsert";
        readonly update: "update";
        readonly delete: "delete";
        readonly duplicate: "duplicate";
    }>>>;
}>;
/**
 * the arguments for deleting an entity.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface DeleteEntityArgs<Sch extends EntitySchema<any, any, any>, OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>> extends BaseEntityCrudArgs<Sch> {
    /**
     * The ID of the entity to be deleted.
     */
    id: OpsSchema['delete'];
}
/**
 * Deletes an entity based on the provided options.
 * @param options - The options for deleting the entity.
 * @returns The deleted entity.
 */
export declare function deleteEntity<S extends EntitySchema<any, any, any>>(options: DeleteEntityArgs<S>): Promise<{
    data: import("electrodb").AllTableIndexCompositeAttributes<any, any, any, EntitySchema<any, any, any, {
        readonly get: "get";
        readonly list: "list";
        readonly query: "query";
        readonly create: "create";
        readonly upsert: "upsert";
        readonly update: "update";
        readonly delete: "delete";
        readonly duplicate: "duplicate";
    }>> | null;
}>;
/**
 * Represents the arguments for batch deleting entities.
 * @template Sch - The entity schema type.
 * @template OpsSchema - The input schemas for entity operations.
 */
export interface DeleteBatchEntityArgs<Sch extends EntitySchema<any, any, any>, OpsSchema extends TEntityOpsInputSchemas<Sch> = TEntityOpsInputSchemas<Sch>> extends BaseEntityCrudArgs<Sch> {
    /**
     * Array of entity IDs to delete.
     */
    ids: Array<OpsSchema['delete']>;
    /**
     * Optional number of concurrent batch operations (default: 1).
     */
    concurrent?: number;
}
/**
 * Deletes multiple entities in a batch operation.
 * @param options - The options for deleting the entities.
 * @returns The unprocessed items that couldn't be deleted.
 */
export declare function deleteBatchEntity<S extends EntitySchema<any, any, any>>(options: DeleteBatchEntityArgs<S>): Promise<{
    data: import("electrodb").AllTableIndexCompositeAttributes<any, any, any, EntitySchema<any, any, any, {
        readonly get: "get";
        readonly list: "list";
        readonly query: "query";
        readonly create: "create";
        readonly upsert: "upsert";
        readonly update: "update";
        readonly delete: "delete";
        readonly duplicate: "duplicate";
    }>>;
}>;
/**
 * Converts a filter object with eq operators to a simplified form.
 * Example: { age: { eq: 65 } } becomes { age: 65 }
 * @param filters - The filter object to simplify
 * @returns A new filter object with eq operators converted to direct values
 */
export declare function simplifyFilters(filters: Record<string, any> | undefined): Record<string, any>;
