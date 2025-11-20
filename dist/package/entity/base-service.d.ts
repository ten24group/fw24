import type { EntityConfiguration } from "electrodb";
import type { EntityInputValidations, EntityValidations } from "../validation";
import type { CreateEntityItemTypeFromSchema, EntityAttribute, EntityIdentifiersTypeFromSchema, EntityRecordTypeFromSchema, EntityTypeFromSchema as EntityRepositoryTypeFromSchema, EntitySchema, HydrateOptionForRelation, HydrateOptionsMapForEntity, SpecialAttributeType, TDefaultEntityOperations, UpdateEntityItemTypeFromSchema, UpsertEntityItemTypeFromSchema } from "./base-entity";
import type { EntityFilterCriteria, EntityQuery, EntitySelections, ParsedEntityAttributePaths } from "./query-types";
import { ExecutionContext } from "../core/types/execution-context";
import { DepIdentifier, IDIContainer } from "../interfaces";
import { EntitySearchService } from '../search/services';
import { EntitySearchQuery } from '../search/types';
import { UpdateEntityOperators } from "./crud-service";
export type ExtractEntityIdentifiersContext = {
    forAccessPattern?: string;
};
type GetOptions<S extends EntitySchema<any, any, any>> = {
    identifiers: EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>>;
    attributes?: EntitySelections<S>;
};
export declare function hasAttribute(schema: EntitySchema<any, any, any>, attributeName: string): boolean;
export declare function isAttributeReadOnly(schema: EntitySchema<any, any, any>, attributeName: string): boolean;
export declare function hasAttributeBy(schema: EntitySchema<any, any, any>, spec: SpecialAttributeType): boolean;
export declare function getAttributeNameBy(schema: EntitySchema<any, any, any>, spec: SpecialAttributeType): string | undefined;
export declare abstract class BaseEntityService<S extends EntitySchema<any, any, any>> {
    readonly schema: S;
    protected readonly entityConfigurations: EntityConfiguration;
    protected readonly diContainer: IDIContainer;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    protected entityRepository?: EntityRepositoryTypeFromSchema<S>;
    protected entityOpsDefaultIoSchema?: ReturnType<typeof this.makeOpsDefaultIOSchema<S>>;
    constructor(schema: S, entityConfigurations: EntityConfiguration, diContainer?: IDIContainer);
    protected getTableName(): string;
    getEntitySearchConfig(_ctx?: ExecutionContext<any>): {
        enabled: boolean;
        indexConfig?: import("../search/types").SearchIndexConfig;
        serviceClass?: DepIdentifier<EntitySearchService<any>> | typeof EntitySearchService | EntitySearchService<any>;
        documentTransformer?: ((entity: import("electrodb").ResponseItem<any, any, any, EntitySchema<any, any, any, {
            readonly get: "get";
            readonly list: "list";
            readonly query: "query";
            readonly create: "create";
            readonly upsert: "upsert";
            readonly update: "update";
            readonly delete: "delete";
            readonly duplicate: "duplicate";
        }>>) => Promise<Record<string, any>>) | undefined;
    };
    /**
     * Checks if search is enabled for the entity.
     * @returns True if search is enabled, false otherwise.
     */
    isSearchEnabled(): boolean;
    /**
     * Gets the search service for the entity.
     * @returns The search service.
     */
    getSearchService(): EntitySearchService<S>;
    private validateSearchConfig;
    transformDocumentForIndexing(entity: EntityRecordTypeFromSchema<S>): Promise<Record<string, any>>;
    validateEntitySchema(): void;
    getEntityServiceByEntityName<T extends EntitySchema<any, any, any>>(relatedEntityName: string): BaseEntityService<T>;
    hasEntityServiceByEntityName(relatedEntityName: string): boolean;
    getEntitySchemaByEntityName<T extends EntitySchema<any, any, any>>(relatedEntityName: string): T;
    hasEntitySchemaByEntityName(relatedEntityName: string): boolean;
    /**
     * Extracts entity identifiers from the input object based on the provided context to fulfill an index.
     * e.g. entityId, tenantId, partition-keys.... etc
     * it is used by the `BaseEntityService` to find the right entity for `get`/`update`/`delete` operations
     *
     * @template S - The type of the entity schema.
     * @param input - The input object from which to extract the identifiers.
     * @param context - The context object containing additional information for extraction.
     * @param context.forAccessPattern - The access pattern for which to extract the identifiers.
     * @returns The extracted entity identifiers.
     * @throws {Error} If the input is missing or not an object.
     *
     * e.g.
     * IN   ==> `Request` object with headers, body, auth-context etc
     * OUT  ==> { tenantId: xxx, email: xxx@yyy.com, some-partition-key: xx-yy-zz }
     *
     */
    extractEntityIdentifiers(input: Record<string, string> | Array<Record<string, string>>, context?: ExtractEntityIdentifiersContext): EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>>;
    getEntityName(): S['model']['entity'];
    getEntitySchema(): S;
    getRepository(): EntityRepositoryTypeFromSchema<S>;
    /**
     * Placeholder for the entity validations; override this to provide your own validations
     * @returns An object containing the entity validations.
     */
    getEntityValidations(): EntityValidations<S> | EntityInputValidations<S>;
    /**
     * Placeholder for the custom validation-error-messages; override this to provide your own error-messages.
     * @returns A map containing the custom validation-error-messages.
     *
     * @example
     * ```ts
     *  public async getOverriddenEntityValidationErrorMessages() {
     *      return Promise.resolve( new Map<string, string>(
     *          Object.entries({
     *              'validation.email.required': 'Email is required!!!!!',
     *              'validation.password.required': 'Password is required!!!!!'
     *          })
     *      ));
     * }
     * ```
     */
    getOverriddenEntityValidationErrorMessages(): Promise<Map<string, string>>;
    getEntityPrimaryIdPropertyName(): string | undefined;
    /**
 * Generates the default input and output schemas for various operations of an entity.
 *
 * @template S - The entity schema type.
 * @template Ops - The type of entity operations.
 *
 * @param schema - The entity schema.
 * @returns The default input and output schemas for the entity operations.
 */
    protected makeOpsDefaultIOSchema<S extends EntitySchema<any, any, any, Ops>, Ops extends TDefaultEntityOperations = TDefaultEntityOperations>(schema: S): {
        get: {
            by: TIOSchemaAttributesMap<S> | undefined;
            output: TIOSchemaAttributesMap<S>;
        };
        duplicate: {
            by: TIOSchemaAttributesMap<S> | undefined;
            output: TIOSchemaAttributesMap<S>;
        };
        delete: {
            by: TIOSchemaAttributesMap<S> | undefined;
        };
        create: {
            input: TIOSchemaAttributesMap<S>;
            output: {
                detail: TIOSchemaAttributesMap<S>;
                list: TIOSchemaAttributesMap<S>;
            };
        };
        update: {
            by: TIOSchemaAttributesMap<S> | undefined;
            input: TIOSchemaAttributesMap<S>;
            output: TIOSchemaAttributesMap<S>;
        };
        list: {
            output: TIOSchemaAttributesMap<S>;
        };
    };
    /**
     * Returns the default input/output schema for entity operations.
     *
    */
    getOpsDefaultIOSchema(): {
        get: {
            by: TIOSchemaAttributesMap<S> | undefined;
            output: TIOSchemaAttributesMap<S>;
        };
        duplicate: {
            by: TIOSchemaAttributesMap<S> | undefined;
            output: TIOSchemaAttributesMap<S>;
        };
        delete: {
            by: TIOSchemaAttributesMap<S> | undefined;
        };
        create: {
            input: TIOSchemaAttributesMap<S>;
            output: {
                detail: TIOSchemaAttributesMap<S>;
                list: TIOSchemaAttributesMap<S>;
            };
        };
        update: {
            by: TIOSchemaAttributesMap<S> | undefined;
            input: TIOSchemaAttributesMap<S>;
            output: TIOSchemaAttributesMap<S>;
        };
        list: {
            output: TIOSchemaAttributesMap<S>;
        };
    };
    /**
     * Returns an array of default serialization attribute names. Used by the `detail` API to serialize the entity.
     *
     * @returns {Array<string>} An array of default serialization attribute names.
     */
    getDefaultSerializationAttributeNames(): EntitySelections<S>;
    /**
     * Returns attribute names for listing and search API. Defaults to the default serialization attribute names.
     * @returns {Array<string>} An array of attribute names.
     */
    getListingAttributeNames(): EntitySelections<S>;
    /**
     * Returns the default attribute names to be used for keyword search.
     * Includes string fields and enum fields with string values.
     * Excludes identifiers, hidden fields, date/datetime fields, relations, and select fields by default.
     *
     * @returns {Array<string>} attribute names to be used for keyword search
    */
    getSearchableAttributeNames(): Array<string>;
    /**
     * Returns the unique attributes of the entity.
     * Defaults to all attributes which are marked as unique or are identifiers;
     * Or if they are part of a composite primary key where the composite length is 1.
     *
     * @returns {Array<EntityAttribute>} unique attributes of the entity
    */
    getUniqueAttributes(): Array<EntityAttribute>;
    /**
     * Returns the default attribute names that can be used for filtering the records.
     * Includes all filterable field types: string, number, boolean, enums, dates, and relations.
     *
     * This matches the comprehensive filtering support in the UI filter generation.
     *
     * @returns {Array<string>} attribute names to be used for filtering
    */
    getFilterableAttributeNames(): Array<string>;
    serializeRecord<T extends Record<string, any>>(record: T, attributes?: EntitySelections<S>): Partial<T>;
    serializeRecords<T extends Record<string, any>>(record: Array<T> | null, attributes?: EntitySelections<S>): Array<Partial<T>>;
    hydrateRecords(relations: Array<[relatedAttributeName: string, options: HydrateOptionForRelation<any>]>, rootEntityRecords: Array<{
        [x: string]: any;
    }>): Promise<void>;
    private hydrateSingleRelation;
    private hydrateManyToOne;
    private hydrateOneToMany;
    /**
     * Retrieves an entity by its identifiers.
     *
     * @param identifiers - The identifiers of the entity.
     * @param selections - Optional array of attribute names to include in the response.
     * @returns A promise that resolves to the retrieved entity data.
     */
    get(options: GetOptions<S>, _ctx?: ExecutionContext): Promise<{
        readonly [x: string]: any;
    } | null>;
    /**
     * Retrieves multiple entities by their identifiers in a batch operation.
     *
     * @param options - The options for batch retrieving entities.
     * @param options.identifiers - Array of entity identifiers to retrieve.
     * @param options.attributes - Optional array of attribute names to include in the response.
     * @param options.concurrent - Optional number of concurrent batch operations to perform (default: 1).
     * @returns A promise that resolves to an object containing the retrieved entities and any unprocessed items.
     */
    batchGet<S extends EntitySchema<any, any, any>>(options: {
        identifiers: Array<EntityIdentifiersTypeFromSchema<S>>;
        attributes?: EntitySelections<S>;
        concurrent?: number;
    }): Promise<{
        data: any[];
        unprocessed: never[];
    }>;
    /**
     * Checks the uniqueness of an attribute value and updates the payload if necessary.
     * @param options - The options for checking uniqueness and updating the payload.
     * @param options.payloadToUpdate - The payload object to update.
     * @param options.attributeName - The name of the attribute to check uniqueness for.
     * @param options.attributeValue - The value of the attribute to check uniqueness for.
     * @param options.maxAttemptsForCreatingUniqueAttributeValue - The maximum number of attempts to create a unique attribute value.
     * @returns A boolean indicating whether the attribute value is unique.
     */
    checkUniquenessAndUpdate(options: {
        payloadToUpdate: any;
        attributeName: string;
        attributeValue: any;
        ignoredEntityIdentifiers?: {
            [key: string]: any;
        };
        maxAttemptsForCreatingUniqueAttributeValue: number;
    }): Promise<boolean>;
    /**
     * Checks if the given attribute value is unique for the specified attribute name.
     * @param attributeName - The name of the attribute to check uniqueness for.
     * @param attributeValue - The value of the attribute to check uniqueness for.
     * @returns A boolean indicating whether the attribute value is unique or not.
     */
    isUniqueAttributeValue(attributeName: string, attributeValue: any, ignoredEntityIdentifiers?: {
        [key: string]: any;
    }): Promise<boolean>;
    /**
     * Generates a unique value by appending a unique suffix to the original value.
     * @param originalValue - The original value to generate a unique value from.
     * @param attempt - The attempt number or string to be used as a suffix (default: random string).
     * @returns The generated unique value.
     */
    generateUniqueValue(originalValue: any, attempt?: number | string): string;
    /**
     * Automatically injects actor context into entity data
     * @param data - The entity data to enhance
     * @param operation - The operation type (create/update)
     * @param ctx - The execution context containing actor info
     * @returns Enhanced data with actor context
     */
    protected injectActorContext<T extends Record<string, any>>(data: T, operation: 'create' | 'update' | 'delete', ctx?: ExecutionContext): T;
    /**
     * Creates a new entity.
     *
     * @param payload - The payload for creating the entity.
     * @returns The created entity.
     */
    create(payload: CreateEntityItemTypeFromSchema<S>, ctx?: ExecutionContext): Promise<import("./crud-service").CreateEntityResponse<S>>;
    /**
     * Creates-OR-Updates an entity.
     * NOTE:
     *   - This method does not check for uniqueness of the attributes, neither create the slug automatically.
     *   - It's the responsibility of the caller to ensure the read ony attributes are not provided if the record is being upsert.
     *
     * @param payload - The payload for creating-OR-updating the entity.
     * @returns Object containing:
     *   - data: The upserted entity data
     *   - wasCreated: true if record was created, false if updated
     *   - oldData: previous data if it was an update (undefined for creates)
     */
    upsert(payload: UpsertEntityItemTypeFromSchema<S>): Promise<import("./crud-service").UpsertEntityResponse<S>>;
    /**
     * Creates a duplicate entity data based on the given identifiers.
     *
     * @param identifiers - The identifiers of the entity.
     * @returns The duplicate entity data.
     * @throws Error if no record is found for the given identifiers.
     *
     * @example
     * const identifiers = { id: 1 };
     * const duplicateData = await makeDuplicateEntityDataByIdentifiers(identifiers);
     * console.log(duplicateData); // { name: 'John Doe', age: 30, ... }
     */
    protected makeDuplicateEntityData(identifiers: EntityIdentifiersTypeFromSchema<S>): Promise<import("../utils").Writable<import("electrodb").CreateEntityItem<EntityRepositoryTypeFromSchema<S>>>>;
    /**
     * Creates a duplicate entity based on the provided identifiers.
     *
     * @param id - The identifiers of the entity to duplicate.
     * @returns A promise that resolves to the duplicated entity.
     *
     * @example
     * const entityId = { id: 123, name: 'example' };
     * const duplicatedEntity = await duplicate(entityId);
     */
    duplicate(id: EntityIdentifiersTypeFromSchema<S>, ctx?: ExecutionContext): Promise<import("./crud-service").CreateEntityResponse<S>>;
    protected delimitersRegex: RegExp;
    /**
     * Retrieves a list of entities based on the provided query.
     * - If no specific attributes are provided in the query, it defaults to a list of attribute names obtained from `getListingAttributeNames()`.
     * - If a search term is provided in the query it will split the search term by `/(?:&| |,|\+)+/` Regex and will filter out empty strings.
     * - If search attributes are not provided in the query, it defaults to a list of searchable attribute names obtained from `getSearchableAttributeNames()`.
     *
     * @param query - The query object containing filters, search keywords, and attributes.
     * @returns A Promise that resolves to an object containing the list of entities and the original query.
     */
    list(query?: EntityQuery<S>, _ctx?: ExecutionContext): Promise<{
        query: EntityQuery<S>;
        data: {
            readonly [x: string]: any;
        }[];
        cursor: string | null;
    }>;
    /**
     * Executes a query on the entity.
     * - If no specific attributes are provided in the query, it defaults to a list of attribute names obtained from `getListingAttributeNames()`.
     * - If a search term is provided in the query it will split the search term by `/(?:&| |,|\+)+/` Regex and will filter out empty strings.
     *   -- If search attributes are not provided in the query, it defaults to a list of searchable attribute names obtained from `getSearchableAttributeNames()`.
     *   -- If there are any non-empty search-terms, it will add a filter group to the query based on the search keywords.
     * @param query - The entity query to execute.
     * @returns A promise that resolves to the result of the query.
     */
    query(query: EntityQuery<S>, _ctx?: ExecutionContext): Promise<{
        query: EntityQuery<S>;
        data: {
            readonly [x: string]: any;
        }[];
        cursor: string | null;
    }>;
    /**
     * Updates an entity in the database.
     *
     * @param identifiers - The identifiers of the entity to update.
     * @param data - The updated data for the entity.
     * @param remove - Optional array of attributes to remove from the entity.
     * @returns The updated entity.
     */
    update(identifiers: EntityIdentifiersTypeFromSchema<S>, data: UpdateEntityItemTypeFromSchema<S>, operators?: UpdateEntityOperators, ctx?: ExecutionContext): Promise<{
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
     * Deletes an entity based on the provided identifiers.
     *
     * @param identifiers - The identifiers of the entity to be deleted.
     * @returns A promise that resolves to the deleted entity.
     */
    delete(identifiers: EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>>, ctx?: ExecutionContext): Promise<{
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
     * Deletes multiple entities in a batch operation.
     *
     * @param options - The options for batch deleting entities.
     * @param options.identifiers - Array of entity identifiers to delete.
     * @param options.concurrent - Optional number of concurrent batch operations to perform (default: 1).
     * @param ctx - Optional execution context containing actor information.
     * @returns A promise that resolves to an object containing any unprocessed items.
     *
     * @example
     * ```typescript
     * // Delete multiple entities
     * const result = await service.batchDelete({
     *   identifiers: [
     *     { id: 'item1' },
     *     { id: 'item2' },
     *     { id: 'item3' }
     *   ],
     *   concurrent: 2
     * });
     *
     * if (result.unprocessed.length > 0) {
     *   console.log('Some items were not deleted:', result.unprocessed);
     * }
     * ```
     */
    batchDelete(options: {
        identifiers: Array<EntityIdentifiersTypeFromSchema<S>>;
        concurrent?: number;
    }, ctx?: ExecutionContext): Promise<{
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
     * Deletes entities based on a query filter.
     * This method queries for entities matching the filter and then batch deletes them.
     *
     * @param options - The options for deleting by query.
     * @param options.filters - The filter criteria to match entities for deletion.
     * @param options.batchSize - The number of items to delete in each batch (default: 25).
     * @param options.concurrent - Number of concurrent batch operations (default: 1).
     * @param options.maxItems - Optional maximum number of items to delete (safety limit).
     * @param ctx - Optional execution context containing actor information.
     * @returns A promise that resolves to an object with deletion statistics.
     *
     * @example
     * ```typescript
     * // Delete all inactive users
     * const result = await userService.deleteByQuery({
     *   filters: {
     *     status: { eq: 'inactive' },
     *     lastLoginAt: { lt: '2023-01-01' }
     *   },
     *   batchSize: 50,
     *   maxItems: 1000
     * });
     *
     * console.log(`Deleted ${result.deletedCount} items, ${result.failedCount} failed`);
     * ```
     */
    deleteByQuery(options: {
        filters: EntityFilterCriteria<S>;
        batchSize?: number;
        concurrent?: number;
        maxItems?: number;
    }, ctx?: ExecutionContext): Promise<{
        deletedCount: number;
        failedCount: number;
        totalProcessed: number;
    }>;
    /**
     * Rebuilds all indexes for the entity by writing to the primary index.
     * This method is useful for maintaining data integrity and ensuring indexes are properly updated.
     *
     * @param options - Options for rebuilding the index
     * @param options.batchSize - The number of items to process in each batch. Defaults to 100.
     * @returns A promise that resolves when the index rebuild is complete.
     */
    rebuildIndex(options?: {
        batchSize?: number;
    }): Promise<void>;
    /**
     * Infers relationships between entities based on the provided schema and selection-paths.
     * @param schema The entity schema.
     * @param paths The parsed selection paths from e.g. parseEntityAttributePaths().
     * @param pathKey The current "path" string representing how we arrived here (defaults to the entity name).
     * @param visitedPaths A set of path-strings visited so far in this recursion chain (prevents cycles).
     * @param maxDepth Maximum recursion depth (optional).
     */
    inferRelationshipsForEntitySelections<E extends EntitySchema<any, any, any>>(schema: E, paths: ParsedEntityAttributePaths, pathKey?: string, visitedPaths?: Set<string>, maxDepth?: number): HydrateOptionsMapForEntity<E>;
    search(query: EntitySearchQuery<S>, ctx?: ExecutionContext): Promise<import("../search/types").SearchResult<any>>;
}
export declare function entityAttributeToIOSchemaAttribute(attId: string, att: EntityAttribute): Partial<EntityAttribute> & {
    id: string;
    name: string;
    properties?: TIOSchemaAttribute[];
};
export type TIOSchemaAttribute = ReturnType<typeof entityAttributeToIOSchemaAttribute>;
export type TIOSchemaAttributesMap<S extends EntitySchema<any, any, any>> = Map<keyof S['attributes'], TIOSchemaAttribute>;
/**
 * Creates an access patterns schema based on the provided entity schema.
 * @param schema The entity schema.
 * @returns A map of access patterns, where the keys are the index names and the values are maps of attribute names and their corresponding schema attributes.
 */
export declare function makeEntityAccessPatternsSchema<S extends EntitySchema<any, any, any>>(schema: S): Map<keyof S["indexes"], TIOSchemaAttributesMap<S>>;
export {};
