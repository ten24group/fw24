import type { EntityConfiguration } from "electrodb";
import { DIContainer } from "../di";
import type { EntityInputValidations, EntityValidations } from "../validation";
import type { CreateEntityItemTypeFromSchema, EntityAttribute, EntityIdentifiersTypeFromSchema, EntityRecordTypeFromSchema, EntityTypeFromSchema as EntityRepositoryTypeFromSchema, EntitySchema, HydrateOptionForEntity, HydrateOptionForRelation, HydrateOptionsMapForEntity, RelationIdentifier, SpecialAttributeType, TDefaultEntityOperations, UpdateEntityItemTypeFromSchema, UpsertEntityItemTypeFromSchema, EntityOperationConfig, EntityOperationsConfig } from "./base-entity";
import { DefaultEntityOperations } from "./constants";
import type { EntityFilterCriteria, EntityQuery, EntitySelections, ParsedEntityAttributePaths } from "./query-types";

import { ExecutionContext, Actor } from "../core/types/execution-context";
import {
    getCurrentExecutionContext,
} from "../core/runtime/execution-context";
import { DepIdentifier, IDIContainer } from "../interfaces";
import { createLogger } from "../logging";
import { BaseSearchService, EntitySearchService } from '../search/services';
import { EntitySearchQuery, SearchResult } from '../search/types';
import { Observed } from "../observability/decorators/observed";
import { makeEntitySearchIndexName } from '../search/search-utils';
import { JsonSerializer, getValueByPath, isArray, isBoolean, isClassConstructor, isEmpty, isEmptyObjectDeep, isFunction, isObject, isString, pascalCase, pickKeys, toHumanReadableName, toSlug, compressIfNeeded, decompressItem, isCompressed, merge } from "../utils";
import { createElectroDBEntity } from "./base-entity";
import { Service } from "electrodb";
import { ENTITY_OPERATION_KEY } from "./decorators";
import { UpdateEntityOperators, UpdateEntityResponse, CreateEntityResponse, GetEntityResponse, DeleteEntityResponse, UpsertEntityResponse, createEntity, deleteEntity, deleteBatchEntity, getBatchEntity, getEntity, listEntity, queryEntity, updateEntity, upsertEntity, upsertBatchEntity } from "./crud-service";
import { EntitySchemaValidator } from "./entity-schema-validator";
import { DatabaseError, EntityValidationError } from './errors';
import { addFilterGroupToEntityFilterCriteria, makeFilterGroupForSearchKeywords, parseEntityAttributePaths } from "./query";
import { InternalServerError, ServerError } from "../errors";

/**
 * Context for an entity operation execution.
 */
export interface OperationContext<S extends EntitySchema<any, any, any>> {
    operation: string;
    config: EntityOperationConfig;
    payload: any;
    ctx?: ExecutionContext;
}

export type ExtractEntityIdentifiersContext = {
    // tenantId: string, 
    forAccessPattern?: string
}

type GetOptions<S extends EntitySchema<any, any, any>> = {
    identifiers: EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>>,
    attributes?: EntitySelections<S>
}

export function hasAttribute(schema: EntitySchema<any, any, any>, attributeName: string) {
    return (attributeName in schema.attributes);
}

export function isAttributeReadOnly(schema: EntitySchema<any, any, any>, attributeName: string): boolean {
    const attribute = schema.attributes[ attributeName ];
    return !!(attribute && attribute.readOnly === true);
}

export function hasAttributeBy(schema: EntitySchema<any, any, any>, spec: SpecialAttributeType) {
    return getAttributeNameBy(schema, spec) !== undefined;
}

export function getAttributeNameBy(schema: EntitySchema<any, any, any>, spec: SpecialAttributeType) {

    let specAttMetaKey = `entity${pascalCase(spec)}Attribute`;
    if (specAttMetaKey in schema.model) {
        return schema.model[ specAttMetaKey as keyof typeof schema.model ] as string;
    }

    if (hasAttribute(schema, `${schema.model.entity}${pascalCase(spec)}`)) {
        return `${schema.model.entity}${pascalCase(spec)}`;
    }

    if (hasAttribute(schema, spec)) {
        return spec;
    }

    return undefined;
}

export abstract class BaseEntityService<S extends EntitySchema<any, any, any>> {

    readonly logger = createLogger(`BaseEntityService:${this.constructor.name}`);

    protected entityRepository?: EntityRepositoryTypeFromSchema<S>;
    protected entityServiceInstance?: Service;
    protected entityOpsDefaultIoSchema?: ReturnType<typeof this.makeOpsDefaultIOSchema<S>>;
    private _resolvedOperationsConfig?: Record<string, EntityOperationConfig>;

    constructor(
        readonly schema: S,
        protected readonly entityConfigurations: EntityConfiguration,
        protected readonly diContainer: IDIContainer = DIContainer.ROOT,
    ) { }

    protected getTableName(): string {
        if (!this.entityConfigurations.table) {
            throw new InternalServerError(`Table name is required for entity: ${this.getEntityName()}`);
        }
        return this.entityConfigurations.table;
    }


    public getEntitySearchConfig(_ctx?: ExecutionContext<any>) {

        const schema = this.getEntitySchema();

        const searchConfig = schema.model.search || {
            enabled: true,
            indexConfig: {}
        };

        searchConfig.serviceClass = searchConfig.serviceClass || EntitySearchService;

        if (!searchConfig.indexConfig) {
            searchConfig.indexConfig = {};
        }

        searchConfig.indexConfig.indexName = searchConfig.indexConfig.indexName || makeEntitySearchIndexName({
            entityName: schema.model.entity,
            tableName: this.getTableName(),
        });

        searchConfig.indexConfig.primaryKey = searchConfig.indexConfig.primaryKey || this.getEntityPrimaryIdPropertyName();

        const entitySearchableAttributes = this.getSearchableAttributeNames();
        const entityFilterableAttributes = this.getFilterableAttributeNames();

        searchConfig.indexConfig.settings = {
            ...(searchConfig.indexConfig.settings || {}),
            searchableAttributes: [
                ...(searchConfig.indexConfig.settings?.searchableAttributes || entitySearchableAttributes),
            ],
            filterableAttributes: [
                ...(searchConfig.indexConfig.settings?.filterableAttributes || entityFilterableAttributes),
            ],
            sortableAttributes: [
                ...(searchConfig.indexConfig.settings?.sortableAttributes || entityFilterableAttributes),
            ],
        }

        return searchConfig;
    }

    /**
     * Checks if search is enabled for the entity.
     * @returns True if search is enabled, false otherwise.
     */
    public isSearchEnabled() {
        const searchConfig = this.getEntitySearchConfig();
        return Boolean(searchConfig?.enabled);
    }

    /**
     * Gets the search service for the entity.
     * @returns The search service.
     */
    public getSearchService(): EntitySearchService<S> {
        try {
            const searchConfig = this.getEntitySearchConfig();

            // Skip search logic if search is not enabled
            if (!searchConfig?.enabled) {
                throw new Error(`Search is not enabled for entity ${this.getEntityName()}.`);
            }

            // Validate search configuration if present
            if (searchConfig) {
                this.validateSearchConfig(searchConfig);
            }

            const searchServiceTokenOrClass = searchConfig?.serviceClass;

            // Case 1: DI Container has the service
            if (searchServiceTokenOrClass && this.diContainer.has(searchServiceTokenOrClass as DepIdentifier<EntitySearchService<any>>)) {
                try {
                    return this.diContainer.resolve<EntitySearchService<S>>(searchServiceTokenOrClass as DepIdentifier<EntitySearchService<S>>);
                } catch (err: any) {
                    this.logger.error('Failed to resolve search service from container:', err);
                    throw new Error(`Failed to resolve search service for entity ${this.getEntityName()}: ${err.message}`);
                }
            }

            // Case 2: Service instance provided
            if (searchServiceTokenOrClass instanceof BaseSearchService) {
                return searchServiceTokenOrClass;
            }

            // Case 3: Service class provided
            if (
                isClassConstructor(searchServiceTokenOrClass) &&
                (
                    searchServiceTokenOrClass === EntitySearchService
                    ||
                    searchServiceTokenOrClass.prototype instanceof EntitySearchService
                )
            ) {
                try {
                    // TODO: add support to configure this without needing to use the DI
                    const searchEngine = this.diContainer.resolveSearchEngine();
                    if (!searchEngine) {
                        throw new Error('Search engine not found in container');
                    }
                    return new (searchServiceTokenOrClass as typeof EntitySearchService)(
                        this,
                        searchEngine,
                    );
                } catch (err: any) {
                    this.logger.error('Failed to instantiate search service:', err);
                    throw new Error(`Failed to create search service instance for entity ${this.getEntityName()}: ${err.message}`);
                }
            }

            throw new Error(`No valid search-service-configuration found for entity: ${this.getEntityName()}`);
        } catch (err: any) {
            this.logger.error('Error in getSearchService:', err);
            throw new Error(`Search service initialization failed for entity ${this.getEntityName()}: ${err.message}`);
        }
    }

    private validateSearchConfig(searchConfig: EntitySchema<any, any, any>[ 'model' ][ 'search' ]) {

        if (!searchConfig) {
            throw new Error('Search configuration is required');
        }

        if (!searchConfig.indexConfig) {
            throw new Error('Search configuration must include a config object');
        }

        const { indexConfig: config } = searchConfig;

        if (!config.indexName) {
            throw new Error('Search configuration must specify an indexName');
        }

        // Validate searchable attributes if specified
        if (config.settings?.searchableAttributes) {
            const invalidAttributes = config.settings.searchableAttributes.filter(
                (attr: string) => !hasAttribute(this.getEntitySchema(), attr)
            );
            if (invalidAttributes.length > 0) {
                throw new Error(`Invalid searchable attributes: ${invalidAttributes.join(', ')}`);
            }
        }

        // Validate filterable attributes if specified
        if (config.settings?.filterableAttributes) {
            const invalidAttributes = config.settings.filterableAttributes.filter(
                (attr: string) => !hasAttribute(this.getEntitySchema(), attr)
            );
            if (invalidAttributes.length > 0) {
                throw new Error(`Invalid filterable attributes: ${invalidAttributes.join(', ')}`);
            }
        }
    }

    public async transformDocumentForIndexing(entity: EntityRecordTypeFromSchema<S>): Promise<Record<string, any>> {
        const searchService = this.getSearchService();
        const transformed = await searchService.transformDocumentForIndexing(entity);

        if (!transformed[ 'id' ]) {
            // make sure there's an id attribute
            const primaryIdName = this.getEntityPrimaryIdPropertyName();
            transformed[ 'id' ] = entity[ primaryIdName as any ];
        }

        return transformed;
    }

    public validateEntitySchema() {
        const validator = new EntitySchemaValidator(this.diContainer);
        validator.validateSchema(
            this.getEntitySchema(),
            this.entityConfigurations
        );
    }

    getEntityServiceByEntityName<T extends EntitySchema<any, any, any>>(relatedEntityName: string) {
        return this.diContainer.resolveEntityService<BaseEntityService<T>>(relatedEntityName);
    }

    hasEntityServiceByEntityName(relatedEntityName: string) {
        return this.diContainer.hasEntityService(relatedEntityName);
    }

    getEntitySchemaByEntityName<T extends EntitySchema<any, any, any>>(relatedEntityName: string) {
        return this.diContainer.resolveEntitySchema<T>(relatedEntityName);
    }

    hasEntitySchemaByEntityName(relatedEntityName: string) {
        return this.diContainer.hasEntitySchema(relatedEntityName);
    }

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
    extractEntityIdentifiers(
        input: Record<string, string> | Array<Record<string, string>>,
        context: ExtractEntityIdentifiersContext = {
            // tenantId: 'xxx-yyy-zzz'
        }
    ): EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>> {

        if (!input || typeof input !== 'object') {
            throw new Error('Input is required and must be an object containing entity-identifiers or an array of objects containing entity-identifiers');
        }

        const isBatchInput = isArray(input);

        const inputs = isBatchInput ? input : [ input ];

        // TODO: tenant logic
        // identifiers['tenantId'] = input.tenantId || context.tenantId;

        const accessPatterns = makeEntityAccessPatternsSchema(this.getEntitySchema());

        const identifierAttributes = new Set<{ name: string, required: boolean }>();
        for (const [ accessPatternName, accessPatternAttributes ] of accessPatterns) {
            if (!context.forAccessPattern || accessPatternName == context.forAccessPattern) {
                for (const [ , att ] of accessPatternAttributes) {
                    identifierAttributes.add({
                        name: att.id,
                        required: att.required == true
                    });
                }
            }
        }

        const primaryAttName = this.getEntityPrimaryIdPropertyName();

        const identifiersBatch = inputs.map(input => {
            const identifiers: any = {};
            for (const { name: attName, required } of identifierAttributes) {
                if ((attName in input)) {
                    identifiers[ attName ] = input[ attName ];
                } else if (attName == primaryAttName && ('id' in input)) {
                    identifiers[ attName ] = input.id;
                } else if (required) {
                    this.logger.warn(`required attribute: ${attName} for access-pattern: ${context.forAccessPattern ?? '--primary--'} is not found in input:`, input);
                }
            }
            return identifiers as EntityIdentifiersTypeFromSchema<S>;
        }
        );

        this.logger.debug('Extracting identifiers from identifiers:', identifiersBatch);

        return isBatchInput ? identifiersBatch : identifiersBatch[ 0 ];
    };

    public getEntityName(): S[ 'model' ][ 'entity' ] { return this.getEntitySchema().model.entity; }

    public getEntitySchema(): S { return this.schema; }

    /**
     * Returns the merged operations configuration for this entity.
     * Combines default framework operations with entity-specific overrides, custom actions,
     * and decorated service methods.
     */
    public getOperationsConfig(): Record<string, EntityOperationConfig> {
        if (this._resolvedOperationsConfig) return this._resolvedOperationsConfig;

        const schema = this.getEntitySchema();
        const entityOps = schema?.model?.entityOperations || {};
        const resolved: Record<string, EntityOperationConfig> = {};

        // 1. Start with OOB defaults
        Object.entries(DefaultEntityOperations).forEach(([ key, def ]) => {
            resolved[ key ] = { ...def };
        });

        // 2. Apply entity-specific overrides and custom operations from schema
        Object.entries(entityOps).forEach(([ key, cfg ]) => {
            if (typeof cfg === 'string') {
                // Legacy string mapping - keep OOB default but maybe rename label?
                // For now, just ensure it's enabled
                if (resolved[ key ]) {
                    resolved[ key ].enabled = true;
                }
            } else {
                resolved[ key ] = merge([ resolved[ key ] || {}, cfg ])!;
            }
        });

        // 3. Collect operations from decorators on the service class
        const decoratedOps: Record<string, EntityOperationConfig> = Reflect.get(this.constructor, ENTITY_OPERATION_KEY) || {};
        Object.entries(decoratedOps).forEach(([ key, cfg ]) => {
            // Service decorators override schema definitions for the same operation name
            resolved[ key ] = merge([ resolved[ key ] || {}, cfg ])!;
        });

        // 4. Verify handlers for enabled operations
        Object.entries(resolved).forEach(([ opName, config ]) => {
            if (config.enabled !== false) {
                const handlerName = config.handler || opName;
                const isStandard = [ 'get', 'list', 'query', 'search', 'create', 'update', 'upsert', 'delete', 'duplicate', 'batchDelete', 'deleteByQuery', 'batchUpsert' ].includes(opName);

                if (!isStandard && typeof (this as any)[ handlerName ] !== 'function') {
                    this.logger.error(`⚠️ Operation "${opName}" is enabled but handler "${handlerName}" is missing on service ${this.constructor.name}`);
                }
            }
        });

        this._resolvedOperationsConfig = resolved;
        return resolved;
    }

    /**
     * Gets configuration for a specific operation.
     */
    public getOperationConfig(opName: string): EntityOperationConfig | undefined {
        return this.getOperationsConfig()[ opName ];
    }

    /**
     * Executes an entity operation by name.
     * This is the central entry point for all operations (CRUD + Custom).
     * Provides unified hook execution and error handling.
     *
     * @param opName Name of the operation to execute
     * @param payload Input data for the operation
     * @param ctx Execution context
     */
    /**
     * Creates a new entity.
     * Note: Prefer calling executeOperation('create', payload) to ensure all hooks are executed.
     *
     * @param payload - The payload for creating the entity.
     * @returns The created entity.
     */
    @Observed({
        trace: { level: 'info' },
        sourceType: 'service',
        extract: {
            start: ({ instance, args }) => ({
                tags: {
                    entityName: (instance as { getEntityName(): string }).getEntityName(),
                    operation: String(args[ 0 ])
                }
            })
        }
    })
    public async executeOperation(opName: string, payload: any, ctx?: ExecutionContext): Promise<any> {
        const config = this.getOperationConfig(opName);
        if (!config || config.enabled === false) {
            throw new Error(`Operation "${opName}" is not enabled for entity "${this.getEntityName()}"`);
        }

        const opCtx: OperationContext<S> = { operation: opName, config, payload, ctx };

        try {
            // 1. BEFORE HOOKS
            const modifiedPayload = await this.beforeOperation(opCtx);
            opCtx.payload = modifiedPayload ?? opCtx.payload;

            // 2. DISPATCH TO HANDLER
            let result: any;
            const handlerName = config.handler || opName;

            // Check if it's a standard operation without a custom handler override in schema
            const isStandard = [ 'get', 'list', 'query', 'search', 'create', 'update', 'upsert', 'delete', 'duplicate', 'batchDelete', 'deleteByQuery', 'batchUpsert' ].includes(opName);
            const hasCustomHandler = config.handler && config.handler !== opName;

            if (isStandard && !hasCustomHandler) {
                // Use the dispatcher which knows how to call standard methods with multiple arguments
                this.logger.debug(`Executing operation "${opName}" using default CRUD dispatcher`);
                result = await this.dispatchDefaultOperation(opName, opCtx.payload, opCtx.ctx);
            } else if (typeof (this as any)[ handlerName ] === 'function') {
                // Use custom handler method
                this.logger.debug(`Executing operation "${opName}" using service handler "${handlerName}"`);
                result = await (this as any)[ handlerName ](opCtx.payload, opCtx.ctx);
            } else {
                // Fallback to default CRUD dispatcher for anything else
                this.logger.debug(`Executing operation "${opName}" using fallback CRUD dispatcher`);
                result = await this.dispatchDefaultOperation(opName, opCtx.payload, opCtx.ctx);
            }

            // 3. AFTER HOOKS
            const modifiedResult = await this.afterOperation(opCtx, result);
            return modifiedResult ?? result;

        } catch (error: any) {
            // 4. ON ERROR HOOK
            await this.onOperationError(opCtx, error);
            throw error;
        }
    }

    /**
     * Executes multiple operations in a single DynamoDB transaction.
     *
     * @param operations Array of operations to execute
     * @param ctx Execution context
     * @example
     * await service.transaction([
     *   { op: 'create', payload: { ... } },
     *   { op: 'update', payload: { id: '...', data: { ... } } }
     * ]);
     */
    /**
     * Prepares a transaction item for use in a multi-entity transaction.
     * Executes "before" lifecycle hooks on the payload.
     */
    public async prepareTransactionItem(opName: string, payload: any, ctx?: ExecutionContext): Promise<any> {
        const config = this.getOperationConfig(opName);
        if (!config || config.enabled === false) {
            throw new Error(`Operation "${opName}" is not enabled for entity "${this.getEntityName()}"`);
        }

        const opCtx: OperationContext<S> = { operation: opName, config, payload, ctx };
        const modifiedPayload = await this.beforeOperation(opCtx);
        const finalPayload = modifiedPayload ?? payload;

        const repo = this.getRepository();
        switch (opName) {
            case 'create':
            case 'upsert':
                return (repo as any).put(finalPayload).transaction();
            case 'update':
                const pathParams = ctx?.request?.pathParameters || (ctx as any)?.params || {};
                const identifiers = finalPayload.identifiers || this.extractEntityIdentifiers({ ...pathParams, ...finalPayload });
                const data = finalPayload.data || finalPayload;
                return (repo as any).patch(identifiers).set(data).transaction();
            case 'delete':
                const deleteIds = this.extractEntityIdentifiers(finalPayload);
                return (repo as any).delete(deleteIds).transaction();
            default:
                throw new Error(`Operation "${opName}" is not supported in transactions.`);
        }
    }

    /**
     * Executes multiple operations in a single DynamoDB transaction.
     *
     * @param operations Array of operations to execute
     * @param ctx Execution context
     * @example
     * await service.transaction([
     *   { op: 'create', payload: { ... } },
     *   { op: 'update', payload: { id: '...', data: { ... } }, service: otherService }
     * ]);
     */
    public async executeTransaction(
        operations: Array<{ op: string, payload: any, service?: BaseEntityService<any> }>,
        ctx?: ExecutionContext
    ) {
        const items = await Promise.all(operations.map(async (opt) => {
            const service = opt.service || this;
            const txItem = await service.prepareTransactionItem(opt.op, opt.payload, ctx);
            return txItem;
        }));

        // We use the current service's configurations for the transaction
        const entities: Record<string, any> = {};
        operations.forEach(opt => {
            const service = opt.service || this;
            entities[ service.getEntityName() ] = service.getRepository();
        });

        const transactionService = new Service(entities, this.entityConfigurations);

        return await QueryObserver.track(this.getEntityName(), 'transaction', () =>
            (transactionService.transaction as any).write(items).go({ ...QueryObserver.getCapacityGoOptions() })
        );
    }

    /**
     * Dispatches OOB operations to their default implementations if no custom handler is provided.
     */
    protected async dispatchDefaultOperation(opName: string, payload: any, ctx?: ExecutionContext): Promise<any> {
        switch (opName) {
            case 'get': return this.get(payload, ctx);
            case 'list': return this.list(payload, ctx);
            case 'query': return this.query(payload, ctx);
            case 'search': return this.search(payload, ctx);
            case 'create': return this.create(payload, ctx);
            case 'update':
                const pathParams = ctx?.request?.pathParameters || (ctx as any)?.params || {};
                const updateIdentifiers = payload.identifiers || this.extractEntityIdentifiers({ ...pathParams, ...payload });
                // Ensure updateData doesn't contain circular refs if it came from ctx
                const updateData = payload.data || payload;
                return this.update(updateIdentifiers as any, updateData, payload.operators, ctx);
            case 'upsert': return this.upsert(payload);
            case 'delete': return this.delete(payload, ctx);
            case 'duplicate': return this.duplicate(payload, ctx);
            case 'batchUpsert': return this.batchUpsert(payload.items, payload.options, ctx);
            case 'batchDelete': return this.batchDelete(payload, ctx);
            case 'deleteByQuery': return this.deleteByQuery(payload, ctx);
            default:
                throw new Error(`No handler found for operation "${opName}" and it is not a standard CRUD operation.`);
        }
    }

    // =========================================================================
    // LIFECYCLE HOOKS - OVERRIDE IN SUBCLASSES
    // =========================================================================

    /**
     * Executed before any operation.
     * Return a modified payload to change the input to the handler.
     */
    protected async beforeOperation(opCtx: OperationContext<S>): Promise<any | void> {
        // Base implementation calls specific lifecycle hooks
        const { operation, payload, ctx } = opCtx;

        switch (operation) {
            case 'create': return this.onBeforeCreate(payload, ctx);
            case 'update': return this.onBeforeUpdate(payload, ctx);
            case 'delete': return this.onBeforeDelete(payload, ctx);
            case 'upsert': return this.onBeforeUpsert(payload, ctx);
        }
    }

    /**
     * Executed after any operation completes successfully.
     * Return a modified result to change what is returned to the caller.
     */
    protected async afterOperation(opCtx: OperationContext<S>, result: any): Promise<any | void> {
        // Base implementation calls specific lifecycle hooks
        const { operation, ctx } = opCtx;

        switch (operation) {
            case 'create': await this.onAfterCreate(result, ctx); break;
            case 'update': await this.onAfterUpdate(result, ctx); break;
            case 'delete': await this.onAfterDelete(result, ctx); break;
            case 'upsert': await this.onAfterUpsert(result, ctx); break;
        }
    }

    /**
     * Executed if an operation fails.
     */
    protected async onOperationError(opCtx: OperationContext<S>, error: Error): Promise<void> {
        this.logger.error(`Operation "${opCtx.operation}" failed:`, error);
    }

    // Specific convenience hooks
    protected async onBeforeCreate(payload: any, ctx?: ExecutionContext): Promise<any | void> {
        let payloadCopy = { ...payload };

        // 1. Inject actor context
        payloadCopy = this.injectActorContext(payloadCopy, 'create', ctx);

        // 2. Auto-slug generation
        const schema = this.getEntitySchema();
        const entitySlugAttribute = getAttributeNameBy(schema, 'slug') || '';
        const entityNameAttribute = getAttributeNameBy(schema, 'name') || '';

        if (entitySlugAttribute && !(entitySlugAttribute in payloadCopy)) {
            if (entityNameAttribute && (entityNameAttribute in payloadCopy)) {
                payloadCopy[ entitySlugAttribute ] = toSlug(payloadCopy[ entityNameAttribute ]) as any;
            }
        }

        // 3. Uniqueness checks
        const uniqueFields = this.getUniqueAttributes();
        const skipCheckingAttributesUniqueness = false;
        const maxAttemptsForCreatingUniqueAttributeValue = 5;

        if (!skipCheckingAttributesUniqueness && uniqueFields.length) {
            let uniquenessChecks = [];

            for (const { name } of uniqueFields) {
                if (name! in payloadCopy) {
                    let value = payloadCopy[ name! ];
                    uniquenessChecks.push(() => this.checkUniquenessAndUpdate({
                        payloadToUpdate: payloadCopy,
                        attributeName: name!,
                        attributeValue: value,
                        maxAttemptsForCreatingUniqueAttributeValue,
                    }));
                }
            }

            const checkResults = await Promise.all(uniquenessChecks.map(check => check()));

            if (checkResults.includes(false)) {
                const uniqueFieldsPath = uniqueFields.map(field => field.name!) ?? [];

                throw new EntityValidationError([ {
                    message: "Unable to ensure uniqueness for one or more fields.",
                    path: uniqueFieldsPath,
                    expected: [ 'unique', uniqueFields ],
                } ]);
            }
        }

        // 4. Compression
        payloadCopy = this.compressFields(payloadCopy);

        return payloadCopy;
    }

    protected async onAfterCreate(_record: any, _ctx?: ExecutionContext): Promise<void> { }

    protected async onBeforeUpdate(payload: any, ctx?: ExecutionContext): Promise<any | void> {
        // Inject actor context
        let enhancedData = this.injectActorContext(payload as any, 'update', ctx);

        const uniqueFields = this.getUniqueAttributes();
        const skipCheckingAttributesUniqueness = false;
        const maxAttemptsForCreatingUniqueAttributeValue = 5;

        if (!skipCheckingAttributesUniqueness && uniqueFields.length) {
            let uniquenessChecks = [];

            // We need identifiers for uniqueness check to ignore self
            const identifiers = this.extractEntityIdentifiers(ctx?.request?.pathParameters || payload);

            for (const { name, readOnly } of uniqueFields) {
                if (readOnly) {
                    delete enhancedData[ name as keyof typeof enhancedData ];
                    continue;
                }

                if (name! in enhancedData) {
                    let value = enhancedData[ name as keyof typeof enhancedData ];
                    uniquenessChecks.push(() => this.checkUniquenessAndUpdate({
                        payloadToUpdate: enhancedData,
                        attributeName: name!,
                        attributeValue: value,
                        maxAttemptsForCreatingUniqueAttributeValue,
                        ignoredEntityIdentifiers: identifiers as any,
                    }));
                }
            }

            const checkResults = await Promise.all(uniquenessChecks.map(check => check()));

            if (checkResults.includes(false)) {
                const uniqueFieldsPath = uniqueFields.map(field => field.name!) ?? [];

                throw new EntityValidationError([ {
                    message: "Unable to ensure uniqueness for one or more fields.",
                    path: uniqueFieldsPath,
                    expected: [ 'unique', uniqueFields ],
                } ]);
            }
        }

        // Compress fields before writing
        enhancedData = this.compressFields(enhancedData);

        return enhancedData;
    }

    protected async onAfterUpdate(_record: any, _ctx?: ExecutionContext): Promise<void> { }

    protected async onBeforeUpsert(payload: any, ctx?: ExecutionContext): Promise<any | void> {
        // Inject actor context so DynamoDB images always have _actor for auditing/causedBy
        // Treat upsert as an update for actor-field purposes (we always want _actor and updatedBy/updatedAt).
        let payloadCopy = this.injectActorContext({ ...payload }, 'upsert', ctx);

        // Compress fields before writing
        payloadCopy = this.compressFields(payloadCopy);

        return payloadCopy;
    }

    protected async onAfterUpsert(_record: any, _ctx?: ExecutionContext): Promise<void> { }

    protected async onBeforeDelete(_identifiers: any, _ctx?: ExecutionContext): Promise<void> { }
    protected async onAfterDelete(_record: any, _ctx?: ExecutionContext): Promise<void> { }

    public getRepository() {
        if (!this.entityRepository) {
            const { entity } = createElectroDBEntity({
                schema: this.getEntitySchema(),
                entityConfigurations: this.entityConfigurations
            });
            this.entityRepository = entity as EntityRepositoryTypeFromSchema<S>;
        }

        return this.entityRepository!;
    }

    /**
     * Returns an ElectroDB Service instance containing this entity.
     * Useful for cross-entity transactions and more complex service-level operations.
     */
    public getServiceInstance() {
        if (!this.entityServiceInstance) {
            this.entityServiceInstance = new Service({
                [ this.getEntityName() ]: this.getRepository()
            }, this.entityConfigurations);
        }
        return this.entityServiceInstance;
    }

    /**
     * Finds items that match the provided attributes using ElectroDB's find method.
     * Find automatically selects the best index to use.
     *
     * @param attributes Map of attribute names to values to match
     * @param options Go options
     */
    public async find(attributes: Partial<EntityRecordTypeFromSchema<S>>, options: any = {}) {
        const repo = this.getRepository();
        return await repo.find(attributes as any).go({
            ...QueryObserver.getCapacityGoOptions(),
            ...options
        });
    }

    /**
     * Matches items based on attributes using ElectroDB's match method.
     * Similar to find but allows for more complex attribute matching.
     *
     * @param attributes Map of attribute names to values to match
     * @param options Go options
     */
    public async match(attributes: Partial<EntityRecordTypeFromSchema<S>>, options: any = {}) {
        const repo = this.getRepository();
        return await repo.match(attributes as any).go({
            ...QueryObserver.getCapacityGoOptions(),
            ...options
        });
    }

    /**
     * Placeholder for the entity validations; override this to provide your own validations
     * @returns An object containing the entity validations.
     */
    public getEntityValidations(): EntityValidations<S> | EntityInputValidations<S> {
        return {};
    };

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
    public async getOverriddenEntityValidationErrorMessages() {
        return Promise.resolve(new Map<string, string>());
    }

    public getEntityPrimaryIdPropertyName() {
        const schema = this.getEntitySchema();

        for (const attName in schema.attributes) {
            const att = schema.attributes[ attName ];
            if (att.isIdentifier) {
                return attName;
            }
        }

        return undefined;
    }

    /**
 * Generates the default input and output schemas for various operations of an entity.
 * 
 * @template S - The entity schema type.
 * @template Ops - The type of entity operations.
 * 
 * @param schema - The entity schema.
 * @returns The default input and output schemas for the entity operations.
 */
    protected makeOpsDefaultIOSchema<
        S extends EntitySchema<any, any, any, Ops>,
        Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
    >(schema: S) {

        const inputSchemaAttributes = {
            create: new Map() as TIOSchemaAttributesMap<S>,
            update: new Map() as TIOSchemaAttributesMap<S>,
        };

        const outputSchemaAttributes = {
            detail: new Map() as TIOSchemaAttributesMap<S>,
            list: new Map() as TIOSchemaAttributesMap<S>,
        };

        // create and update
        for (const attName in schema.attributes) {

            const att = schema.attributes[ attName ];
            const formattedAtt = entityAttributeToIOSchemaAttribute(attName, att);

            if (formattedAtt.hidden) {
                // if it's marked as hidden it's not visible to any op
                continue;
            }

            if (formattedAtt.isVisible || formattedAtt.isIdentifier) {
                outputSchemaAttributes.detail.set(attName, { ...formattedAtt });
            }

            if (formattedAtt.isListable || formattedAtt.isIdentifier) {
                outputSchemaAttributes.list.set(attName, { ...formattedAtt });
            }

            if (formattedAtt.isCreatable) {
                inputSchemaAttributes.create.set(attName, { ...formattedAtt });
            }

            if (formattedAtt.isEditable) {
                inputSchemaAttributes.update.set(attName, { ...formattedAtt });
            }
        }

        const accessPatterns = makeEntityAccessPatternsSchema(schema);

        // if there's an index named `primary`, use that, else fallback to first index
        // accessPatternAttributes['get'] = accessPatterns.get('primary') ?? accessPatterns.entries().next().value;
        // accessPatternAttributes['delete'] = accessPatterns.get('primary') ?? accessPatterns.entries().next().value;


        // for(const ap of accessPatterns.keys()){
        // 	accessPatternAttributes[`get_${ap}`] = accessPatterns.get(ap);
        // 	accessPatternAttributes[`delete_${ap}`] = accessPatterns.get(ap);
        // }

        // const inputSchemaAttributes: any = {};	
        // inputSchemaAttributes['create'] = {
        // 	'identifiers': accessPatternAttributes['get'],
        // 	'data': inputSchemaAttributes['create'],
        // }
        // inputSchemaAttributes['update'] = {
        // 	'identifiers': accessPatternAttributes['get'],
        // 	'data': inputSchemaAttributes['update'],
        // }

        const defaultAccessPattern = accessPatterns.get('primary');

        // TODO: add schema for the rest fo the secondary access-patterns

        return {
            get: {
                by: defaultAccessPattern,
                output: outputSchemaAttributes.detail, // default for the detail page
            },
            duplicate: {
                by: defaultAccessPattern,
                output: outputSchemaAttributes.detail, // default for the detail page
            },
            delete: {
                by: defaultAccessPattern
            },
            create: {
                input: inputSchemaAttributes.create,
                output: outputSchemaAttributes,
            },
            update: {
                by: defaultAccessPattern,
                input: inputSchemaAttributes.update,
                output: outputSchemaAttributes.detail,
            },
            list: {
                output: outputSchemaAttributes.list,
            },
        };
    }


    /**
     * Returns the default input/output schema for entity operations.
     * 
    */
    public getOpsDefaultIOSchema() {
        if (!this.entityOpsDefaultIoSchema) {
            this.entityOpsDefaultIoSchema = this.makeOpsDefaultIOSchema<S>(this.getEntitySchema());
        }
        return this.entityOpsDefaultIoSchema;
    }

    /**
     * Returns an array of default serialization attribute names. Used by the `detail` API to serialize the entity.
     * 
     * @returns {Array<string>} An array of default serialization attribute names.
     */
    public getDefaultSerializationAttributeNames(): EntitySelections<S> {
        const defaultOutputSchemaAttributesMap = this.getOpsDefaultIOSchema().get.output;

        const attributes: any = {};
        defaultOutputSchemaAttributesMap.forEach((_, key) => {
            // if (!val.relation || val.relation.hydrate) {
            // }
            attributes[ key ] = true
        });

        return attributes as EntitySelections<S>;

        //  return Array.from( defaultOutputSchemaAttributesMap.keys() ) as EntitySelections<S>;
    }

    /**
     * Returns attribute names for listing and search API. Defaults to the default serialization attribute names.
     * @returns {Array<string>} An array of attribute names.
     */
    public getListingAttributeNames(): EntitySelections<S> {
        const defaultOutputSchemaAttributesMap = this.getOpsDefaultIOSchema().list.output;
        return Array.from(defaultOutputSchemaAttributesMap.keys()) as EntitySelections<S>;
    }

    /**
     * Returns the default attribute names to be used for keyword search.
     * Includes string fields and enum fields with string values.
     * Excludes identifiers, hidden fields, date/datetime fields, relations, and select fields by default.
     * 
     * @returns {Array<string>} attribute names to be used for keyword search
    */
    public getSearchableAttributeNames(): Array<string> {
        const attributeNames = [];
        const schema = this.getEntitySchema();

        for (const attName in schema.attributes) {
            const att = schema.attributes[ attName ];

            // Skip if hidden, identifier, or explicitly not searchable
            if (att.hidden || att.isIdentifier || att.isSearchable === false) {
                continue;
            }

            const attrType = att.type;
            const fieldType = att.fieldType;

            // Exclude date/datetime fields (they're for filtering, not text search)
            if (fieldType === 'date' || fieldType === 'datetime') {
                continue;
            }

            // Exclude date-like field names (createdAt, publishedDate, etc.)
            const lowerName = attName.toLowerCase();
            if (attrType === 'string' && (lowerName.includes('date') || lowerName.includes('time'))) {
                continue;
            }

            // Exclude relation fields (they're IDs, not searchable text)
            if ('relation' in att && att.relation) {
                continue;
            }

            // Exclude select/radio/checkbox fields with options (they're for filtering, not full-text search)
            if ((fieldType === 'select' || fieldType === 'radio' || fieldType === 'checkbox' || fieldType === 'multi-select') &&
                'options' in att && att.options) {
                continue;
            }

            // Include searchable text-based field types
            const isSearchableType = (
                // String fields (primary searchable type)
                (typeof attrType === 'string' && attrType === 'string') ||

                // Enum fields can be searched by their string values
                (Array.isArray(attrType) && attrType.length > 0 && attrType.every(v => typeof v === 'string'))
            );

            // Include if searchable by default (isSearchable not explicitly set) or explicitly enabled
            if (isSearchableType && (!('isSearchable' in att) || att.isSearchable)) {
                attributeNames.push(attName);
            }
        }

        return attributeNames;
    }


    /**
     * Returns the unique attributes of the entity. 
     * Defaults to all attributes which are marked as unique or are identifiers; 
     * Or if they are part of a composite primary key where the composite length is 1.
     * 
     * @returns {Array<EntityAttribute>} unique attributes of the entity
    */
    public getUniqueAttributes(): Array<EntityAttribute> {
        const attributes = [];
        const schema = this.getEntitySchema();

        for (const attName in schema.attributes) {
            const att = schema.attributes[ attName ];

            let isUnique = ('isUnique' in att) ? att.isUnique : att.isIdentifier;

            if (isUnique) {
                attributes.push({
                    ...att,
                    isUnique,
                    name: attName,
                });
            }
        }

        return attributes;
    }

    /**
     * Returns the default attribute names that can be used for filtering the records.
     * Includes all filterable field types: string, number, boolean, enums, dates, and relations.
     * 
     * This matches the comprehensive filtering support in the UI filter generation.
     * 
     * @returns {Array<string>} attribute names to be used for filtering
    */
    public getFilterableAttributeNames(): Array<string> {
        const attributeNames = [];
        const schema = this.getEntitySchema();

        for (const attName in schema.attributes) {
            const att = schema.attributes[ attName ];

            // Skip if explicitly marked as not filterable or hidden
            if (att.hidden || att.isFilterable === false) {
                continue;
            }

            const attrType = att.type;
            const fieldType = att.fieldType;
            let isFilterableType = false;

            // Check basic scalar types
            if (attrType === 'string' || attrType === 'number' || attrType === 'boolean') {
                isFilterableType = true;
            }

            // Check for enum types (array of values)
            if (!isFilterableType && Array.isArray(attrType)) {
                isFilterableType = true;
            }

            // Check for date/datetime fields
            if (!isFilterableType && (fieldType === 'date' || fieldType === 'datetime')) {
                isFilterableType = true;
            }

            // Check for date-like field names
            if (!isFilterableType && attrType === 'string') {
                const lowerName = attName.toLowerCase();
                if (lowerName.includes('date') || lowerName.includes('time')) {
                    isFilterableType = true;
                }
            }

            // Check for relation fields
            if (!isFilterableType && 'relation' in att && att.relation) {
                isFilterableType = true;
            }

            // Check for select/radio/checkbox fields with options
            if (!isFilterableType &&
                (fieldType === 'select' || fieldType === 'radio' || fieldType === 'checkbox' || fieldType === 'multi-select') &&
                'options' in att && att.options) {
                isFilterableType = true;
            }

            // Include if filterable by default (isFilterable not explicitly set) or explicitly enabled
            if (isFilterableType && (!('isFilterable' in att) || att.isFilterable)) {
                attributeNames.push(attName);
            }
        }

        return attributeNames;
    }

    public serializeRecord<T extends Record<string, any>>(record: T, attributes = this.getDefaultSerializationAttributeNames()): Partial<T> {

        let keys: Array<string>;

        if (Array.isArray(attributes)) {
            const parsed = parseEntityAttributePaths(attributes as string[]);
            keys = Object.keys(parsed);
        } else {
            keys = Object.keys(attributes);
        }

        return pickKeys<T>(record, ...keys);
    }

    public serializeRecords<T extends Record<string, any>>(record: Array<T> | null, attributes = this.getDefaultSerializationAttributeNames()): Array<Partial<T>> {
        if (!record || !Array.isArray(record)) {
            return [];
        }
        return record.map(record => this.serializeRecord<T>(record, attributes));
    }

    @Observed({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read', hydration: 'true' },
        extract: {
            start: ({ instance, args }) => {
                const [ relations, rootRecords ] = args as [ unknown[] | undefined, unknown[] | undefined ];
                const relationCount = Array.isArray(relations) ? relations.length : 0;
                const recordCount = Array.isArray(rootRecords) ? rootRecords.length : 0;

                return {
                    tags: {
                        entityName: (instance as { getEntityName(): string }).getEntityName(),
                    },
                    metrics: {
                        relationCount,
                        recordCount,
                    }
                };
            }
        }
    })
    async hydrateRecords(
        relations: Array<[ relatedAttributeName: string, options: HydrateOptionForRelation<any> ]>,
        rootEntityRecords: Array<{ [ x: string ]: any; }>
    ) {
        this.logger.debug(`called 'hydrateRecords' for entity: ${this.getEntityName()}`);
        await Promise.all(relations?.map(async ([ relatedAttributeName, options ]) => {
            await this.hydrateSingleRelation(rootEntityRecords, relatedAttributeName, options);
        }));
    }

    private async hydrateSingleRelation(rootEntityRecords: any[], relatedAttributeName: string, options: HydrateOptionForRelation<any>) {
        this.logger.debug(`called 'hydrateSingleRelation' relation: ${relatedAttributeName} for entity: ${this.getEntityName()}`, {
            options
        });

        // 1. Give service a chance to handle hydration manually
        const handled = await this.onHydrateRelation(relatedAttributeName, rootEntityRecords, options);
        if (handled) {
            this.logger.debug(`Relation "${relatedAttributeName}" was handled by custom hydration hook.`);
            return;
        }

        const { entityName: relatedEntityName, relationType, identifiers } = options;

        if (!identifiers) {
            throw (`No Identifiers:[${relationType}:${relatedEntityName}] provided`);
        }

        if (relationType == 'one-to-one' || relationType == 'many-to-many') {
            throw (`RelationType:[${relationType}:${relatedEntityName}] in not supported by hydration, use one of [many-to-one, one-to-many] ot manually hydrate'`)
        }

        // Get related entity service
        const relatedEntityService = this.getEntityServiceByEntityName(relatedEntityName);
        if (!relatedEntityService) {
            throw new Error(`No service found for relationship: ${relatedAttributeName}(${relatedEntityName}); please make sure service has been registered in the required 'di-container'`);
        }

        // Get relation's metadata
        const currentEntitySchema = this.getEntitySchema();
        const relationAttributeMetadata = currentEntitySchema.attributes[ relatedAttributeName as any ] as EntityAttribute;

        if (!relationAttributeMetadata || !relationAttributeMetadata?.relation) {
            const message = `No metadata found for relationship: ${relatedAttributeName}`
            this.logger.warn(message, relationAttributeMetadata);
            throw (message);
        }

        // relation identifiers mapping
        const identifierMappings: RelationIdentifier<any>[] = Array.isArray(identifiers) ? identifiers : [ identifiers! ];

        // Decide logic based on relationType
        if (relationType === 'many-to-one') {
            /**
             * MANY-TO-ONE:
             * -------------
             * The "rootEntityRecords" are the CHILD items, each storing the parent's
             * composite key in some fields. We gather all those parent keys, do a batch
             * retrieval from the parent entity, then attach the single matching parent
             * record into childRecord[relatedAttributeName].
            */
            await this.hydrateManyToOne(
                rootEntityRecords,
                relatedAttributeName,
                identifierMappings,
                options.attributes,
                relatedEntityService
            );
        } else if (relationType === 'one-to-many') {
            /**
             * ONE-TO-MANY:
             * -------------
             * The "rootEntityRecords" are the PARENT items. Each parent can have multiple
             * child items. The child table records each store the parent's key. 
             * So we do a query per parent and then .
             */
            await this.hydrateOneToMany(
                rootEntityRecords,
                relatedAttributeName,
                identifierMappings,
                options.attributes,
                relatedEntityService
            );
        }
    }

    private async hydrateManyToOne(
        childRecords: any[],
        parentAttributeName: string,
        identifierMappings: RelationIdentifier<any>[],
        parentAttributesToHydrate: HydrateOptionForEntity<any> | undefined,
        parentService: BaseEntityService<any>
    ) {
        this.logger.debug(`called 'hydrateManyToOne' relation: ${parentAttributeName} for entity: ${this.getEntityName()}`, {
            parentAttributesToHydrate,
        });

        // for each parent create a children batch
        const parentIdentifiersToChildrenMap = new Map<string, any[]>();

        for (const child of childRecords) {
            if (!child) continue;

            // Build a parent key object. E.g. { orgId: child.orgId, userId: child.userId } for 2-attr PK
            const parentKeyObj: Record<string, any> = {};
            for (const { source, target } of identifierMappings) {

                try {
                    const val = getValueByPath(child, source);
                    if (val == null) continue;

                    parentKeyObj[ target as string ] = val;

                } catch (error) {
                    this.logger.error(`Error getting value for path: ${source}`, { error });
                }
            }

            // If partial or empty, skip
            if (Object.keys(parentKeyObj).length === 0) {
                child[ parentAttributeName ] = null;
                continue;
            }

            const keyStr = JSON.stringify(parentKeyObj);
            if (!parentIdentifiersToChildrenMap.has(keyStr)) {
                parentIdentifiersToChildrenMap.set(keyStr, []);
            }
            parentIdentifiersToChildrenMap.get(keyStr)!.push(child);
        }

        if (parentIdentifiersToChildrenMap.size === 0) return;

        // Create a parent-identifiers-batch for fetching
        const parentIdentifiersBatch: Array<Record<string, any>> = [];
        for (const k of parentIdentifiersToChildrenMap.keys()) {
            parentIdentifiersBatch.push(JSON.parse(k));
        }

        const fetchedParents = await parentService.get({
            identifiers: parentIdentifiersBatch,
            attributes: parentAttributesToHydrate,
        });

        // If "get()" returns a single item convert it into an array.
        const parentsArray = Array.isArray(fetchedParents) ? fetchedParents : [ fetchedParents ];

        // Make a dictionary from { <keyStr> => parentRecord }
        const parentDict = new Map<string, any>();
        for (const p of parentsArray) {
            if (!p) {
                continue;
            }
            // Rebuild the "composite key" from the parent's record
            const keyObj: Record<string, any> = {};
            for (const { target } of identifierMappings) {
                if (p[ target ] == null) {
                    // If some attribute is missing, skip
                    continue;
                }
                keyObj[ target as string ] = p[ target ];
            }
            const kStr = JSON.stringify(keyObj);
            parentDict.set(kStr, p);
        }

        // Attach each parent's data to the child
        for (const [ kStr, children ] of parentIdentifiersToChildrenMap.entries()) {
            const foundParent = parentDict.get(kStr) ?? null;
            for (const c of children) {
                c[ parentAttributeName ] = foundParent;
            }
        }
    }

    private async hydrateOneToMany(
        parentRecords: any[],
        childAttributeName: string,
        identifierMappings: RelationIdentifier<any>[],
        childAttributesToHydrate: HydrateOptionForEntity<any> | undefined,
        childService: BaseEntityService<any>
    ) {

        this.logger.debug(`called 'hydrateOneToMany' relation: ${childAttributeName} for entity: ${this.getEntityName()}`, {
            childAttributesToHydrate,
        });

        const parentKeyStrToParents = new Map<string, any[]>();

        for (const parent of parentRecords) {
            if (!parent) continue;

            // Build a "child index" key from the parent's fields. For example, 
            // if the child GSI has { pk: 'tenantId', sk: 'accountId' }, 
            // we fill { tenantId: parent.tenantId, accountId: parent.accountId }.
            const childKeyObj: Record<string, any> = {};
            for (const { source, target } of identifierMappings) {
                if (parent[ source ] != null) {
                    childKeyObj[ target as string ] = parent[ source ];
                }
            }

            // If we have no valid composite key, no children can be fetched
            if (Object.keys(childKeyObj).length === 0) {
                parent[ childAttributeName ] = [];
                continue;
            }

            const keyStr = JSON.stringify(childKeyObj);
            if (!parentKeyStrToParents.has(keyStr)) {
                parentKeyStrToParents.set(keyStr, []);
            }
            parentKeyStrToParents.get(keyStr)!.push(parent);
        }

        // If no parent has a valid key, we're done
        if (parentKeyStrToParents.size === 0) {
            return;
        }

        // For each unique parentKeyObj, do a childService query/list in parallel.
        const promises: Array<Promise<any>> = [];
        const parentKeys: string[] = [];

        for (const [ keyStr ] of parentKeyStrToParents.entries()) {

            const childKeyObj = JSON.parse(keyStr);

            parentKeys.push(keyStr);

            const filters: Record<string, any> = {};
            for (const [ childField, val ] of Object.entries(childKeyObj)) {
                filters[ childField ] = { eq: val };
            }

            promises.push(
                childService.list({
                    filters,
                    attributes: childAttributesToHydrate,
                })
            );
        }

        const results = await Promise.all(promises);

        // For each result, map children back to the correct-parent(s)
        const parentKeyStrToChildren: Record<string, any[]> = {};
        for (let i = 0; i < results.length; i++) {
            const { data: childItems } = results[ i ];
            const keyStr = parentKeys[ i ];
            parentKeyStrToChildren[ keyStr ] = childItems ?? [];
        }

        // Attach to parents
        for (const [ keyStr, parents ] of parentKeyStrToParents.entries()) {
            const childArray = parentKeyStrToChildren[ keyStr ] ?? [];
            for (const p of parents) {
                p[ childAttributeName ] = childArray;
            }
        }
    }

    /**
     * Retrieves an entity by its identifiers.
     * 
     * @param identifiers - The identifiers of the entity.
     * @param selections - Optional array of attribute names to include in the response.
     * @returns A promise that resolves to the retrieved entity data.
     */

    @Observed({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: (instance as { getEntityName(): string }).getEntityName() }
            }),
            finish: ({ result }) => ({
                tags: { found: !!result }
            })
        }
    })
    public async get(options: GetOptions<S>, _ctx?: ExecutionContext): Promise<EntityRecordTypeFromSchema<S> | undefined> {
        const { identifiers, attributes } = options;


        let formattedAttributes = attributes;
        if (!attributes) {
            formattedAttributes = this.getDefaultSerializationAttributeNames()
        }

        if (Array.isArray(formattedAttributes)) {
            const parsedOptions = parseEntityAttributePaths(formattedAttributes as string[]);
            formattedAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }

        this.logger.debug(`Formatted attributes for entity: ${this.getEntityName()}`, formattedAttributes);

        const requiredSelectAttributes = Object.entries(formattedAttributes as any).reduce((acc, [ attName, options ]) => {
            acc.push(attName);
            if (isObject(options) && options.identifiers) {
                const identifiers: Array<RelationIdentifier<any>> = Array.isArray(options.identifiers) ? options.identifiers : [ options.identifiers ];
                const topKeys = identifiers.map(identifier => identifier.source?.split?.('.')?.[ 0 ]).filter(key => !!key) as string[];
                acc.push(...topKeys);
            }
            return acc;
        }, [] as string[]);

        const uniqueSelectionAttributes = [ ...new Set(requiredSelectAttributes) ]

        const entity = await getEntity<S>({
            id: identifiers,
            attributes: uniqueSelectionAttributes,
            entityName: this.getEntityName(),
            entityService: this,
        });

        this.logger.debug(`Retrieved entity: ${this.getEntityName()}`, JsonSerializer.stringify(entity));

        if (entity?.data) {
            // Decompress fields after reading from DB
            entity.data = this.decompressFields(entity.data);

            if (!!formattedAttributes) {
                const relationalAttributes = Object.entries(formattedAttributes)?.map(([ attributeName, options ]) => [ attributeName, options ])
                    .filter(([ , options ]) => isObject(options));

                if (relationalAttributes.length) {
                    await this.hydrateRecords(relationalAttributes as any, [ entity.data ]);
                }
            }
        }

        return entity?.data as EntityRecordTypeFromSchema<S> | undefined;
    }

    /**
     * Retrieves multiple entities by their identifiers in a batch operation.
     * 
     * @param options - The options for batch retrieving entities.
     * @param options.identifiers - Array of entity identifiers to retrieve.
     * @param options.attributes - Optional array of attribute names to include in the response.
     * @param options.concurrent - Optional number of concurrent batch operations to perform (default: 1).
     * @returns A promise that resolves to an object containing the retrieved entities and any unprocessed items.
     */
    @Observed({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read', batch: 'true' },
        extract: {
            start: ({ instance, args }) => {
                const [ options ] = args as [ { identifiers?: unknown[]; concurrent?: number } ];
                const batchSize = Array.isArray(options?.identifiers) ? options.identifiers.length : 0;
                const concurrent = typeof options?.concurrent === 'number' ? options.concurrent : 1;

                return {
                    tags: { entityName: (instance as { getEntityName(): string }).getEntityName() },
                    metrics: { batchSize, concurrent }
                };
            },
            finish: ({ result }) => {
                const r = result as { data?: unknown[]; unprocessed?: unknown[] } | undefined;
                const retrievedCount = Array.isArray(r?.data) ? r!.data.length : 0;
                const unprocessedCount = Array.isArray(r?.unprocessed) ? r!.unprocessed.length : 0;
                return { metrics: { retrievedCount, unprocessedCount } };
            }
        }
    })
    public async batchGet<S extends EntitySchema<any, any, any>>(options: {
        identifiers: Array<EntityIdentifiersTypeFromSchema<S>>,
        attributes?: EntitySelections<S>,
        concurrent?: number
    }) {
        const { identifiers, attributes, concurrent = 1 } = options;

        let formattedAttributes = attributes;
        if (!attributes) {
            formattedAttributes = this.getDefaultSerializationAttributeNames()
        }

        if (Array.isArray(formattedAttributes)) {
            const parsedOptions = parseEntityAttributePaths(formattedAttributes as string[]);
            formattedAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }

        this.logger.debug(`Formatted attributes for batch get on entity: ${this.getEntityName()}`, formattedAttributes);

        const requiredSelectAttributes = Object.entries(formattedAttributes as any).reduce((acc, [ attName, options ]) => {
            acc.push(attName);
            if (isObject(options) && options.identifiers) {
                const identifiers: Array<RelationIdentifier<any>> = Array.isArray(options.identifiers) ? options.identifiers : [ options.identifiers ];
                const topKeys = identifiers.map(identifier => identifier.source?.split?.('.')?.[ 0 ]).filter(key => !!key) as string[];
                acc.push(...topKeys);
            }
            return acc;
        }, [] as string[]);

        const uniqueSelectionAttributes = [ ...new Set(requiredSelectAttributes) ];

        const entity = await getBatchEntity<S>({
            ids: identifiers,
            attributes: uniqueSelectionAttributes,
            entityName: this.getEntityName(),
            entityService: this as any,
            concurrent
        });

        this.logger.debug(`Retrieved batch entities: ${this.getEntityName()}`, JsonSerializer.stringify(entity));

        if (entity?.data) {
            // Decompress all records
            entity.data = entity.data.map(record => this.decompressFields(record));

            if (!!formattedAttributes) {
                const relationalAttributes = Object.entries(formattedAttributes)?.map(([ attributeName, options ]) => [ attributeName, options ])
                    .filter(([ , options ]) => isObject(options));

                if (relationalAttributes.length) {
                    await this.hydrateRecords(relationalAttributes as any, entity.data);
                }
            }
        }

        return {
            data: entity?.data || [],
            unprocessed: entity?.unprocessed || []
        };
    }

    /**
     * Checks the uniqueness of an attribute value and updates the payload if necessary.
     * @param options - The options for checking uniqueness and updating the payload.
     * @param options.payloadToUpdate - The payload object to update.
     * @param options.attributeName - The name of the attribute to check uniqueness for.
     * @param options.attributeValue - The value of the attribute to check uniqueness for.
     * @param options.maxAttemptsForCreatingUniqueAttributeValue - The maximum number of attempts to create a unique attribute value.
     * @returns A boolean indicating whether the attribute value is unique.
     */
    public async checkUniquenessAndUpdate(options: {
        payloadToUpdate: any,
        attributeName: string,
        attributeValue: any,
        ignoredEntityIdentifiers?: {
            [ key: string ]: any
        }
        maxAttemptsForCreatingUniqueAttributeValue: number,
    }) {

        const { payloadToUpdate, attributeName, ignoredEntityIdentifiers, maxAttemptsForCreatingUniqueAttributeValue } = options;
        let { attributeValue } = options;

        let isUnique = false;
        let triesCount = 1;

        while (!isUnique && triesCount < maxAttemptsForCreatingUniqueAttributeValue) {
            isUnique = await this.isUniqueAttributeValue(attributeName, attributeValue, ignoredEntityIdentifiers);
            if (!isUnique) {
                attributeValue = this.generateUniqueValue(attributeValue, triesCount);
            }
            triesCount++;
        }

        if (isUnique) {
            payloadToUpdate[ attributeName ] = attributeValue;
        }

        return isUnique;
    }

    /**
     * Checks if the given attribute value is unique for the specified attribute name.
     * @param attributeName - The name of the attribute to check uniqueness for.
     * @param attributeValue - The value of the attribute to check uniqueness for.
     * @returns A boolean indicating whether the attribute value is unique or not.
     */
    public async isUniqueAttributeValue(
        attributeName: string,
        attributeValue: any,
        ignoredEntityIdentifiers?: {
            [ key: string ]: any
        }
    ) {

        this.logger.debug(`Called ~ isUniqueAttributeValue ~ entityName: ${this.getEntityName()} ~ attributeName: ${attributeName} ~ attributeValue: ${attributeValue}`);

        // Create filters for the query using the correct structure
        const filters = {
            [ attributeName ]: { eq: attributeValue }
        } as EntityFilterCriteria<S>;

        // Determine which attributes to project - only the attribute being checked and ignored entity identifiers
        const attributesToProject: string[] = [ attributeName ];

        // Add ignored entity identifier fields to the projection
        if (ignoredEntityIdentifiers && !isEmptyObjectDeep(ignoredEntityIdentifiers)) {
            Object.keys(ignoredEntityIdentifiers).forEach(key => {
                if (!attributesToProject.includes(key)) {
                    attributesToProject.push(key);
                }
            });
        }

        // Use the query method to leverage index selection logic with minimal attribute projection
        const result = await this.query({
            filters,
            attributes: attributesToProject as any,
            pagination: { count: 1 } // We only need to know if any records exist
        });

        // If we have ignored entity identifiers, filter the results in memory
        let entities = result.data || [];
        if (ignoredEntityIdentifiers && !isEmptyObjectDeep(ignoredEntityIdentifiers)) {
            entities = entities.filter(entity => {
                return !Object.entries(ignoredEntityIdentifiers).every(([ key, value ]) =>
                    entity[ key ] === value
                );
            });
        }

        this.logger.debug(`isUniqueAttributeValue ~ entityName: ${this.getEntityName()} ~ attributeName: ${attributeName} ~ attributeValue: ${attributeValue} ~ entity:`, { data: entities });

        return entities.length === 0;
    }

    /**
     * Generates a unique value by appending a unique suffix to the original value.
     * @param originalValue - The original value to generate a unique value from.
     * @param attempt - The attempt number or string to be used as a suffix (default: random string).
     * @returns The generated unique value.
     */
    public generateUniqueValue(originalValue: any, attempt: number | string = Math.random().toString(36).substring(2, 15)): string {
        const uniqueSuffix = `${Date.now()}-${attempt}`;
        return `${originalValue}-${uniqueSuffix}`;
    }

    /**
     * Automatically injects actor context into entity data
     * @param data - The entity data to enhance
     * @param operation - The operation type (create/update)
     * @param ctx - The execution context containing actor info
     * @returns Enhanced data with actor context
     */
    public injectActorContext<T extends Record<string, any>>(
        data: T,
        operation: 'create' | 'update' | 'upsert' | 'delete',
        ctx?: ExecutionContext
    ): T {

        // Prefer explicit ctx.actor, otherwise fall back to framework execution-context (AsyncLocalStorage).
        // This is important for background handlers (queues/tasks) where ctx may not be threaded through.
        const effectiveActor = ctx?.actor ?? getCurrentExecutionContext()?.actor;
        if (!effectiveActor) {
            this.logger.debug('BaseEntityService: No actor context found, skipping injection');
            return data;
        }

        const schema = this.getEntitySchema();
        const enhancedData = { ...data };
        const actor = effectiveActor;

        // IMPORTANT: We do NOT persist/propagate parentObservabilityLogId across hops.
        // parentObservabilityLogId is strict hierarchy within a single invocation's persisted slice.

        // Get current timestamp for database operation
        const currentTimestamp = new Date().toISOString();

        // Inject visible actor fields if defined in schema and not read-only
        if (operation === 'create') {
            if (hasAttribute(schema, 'createdBy') && !isAttributeReadOnly(schema, 'createdBy') && actor.actorId) {
                (enhancedData as any).createdBy = actor.actorId;
            }
            if (hasAttribute(schema, 'createdAt') && !isAttributeReadOnly(schema, 'createdAt')) {
                (enhancedData as any).createdAt = currentTimestamp;
            }
        }

        // For delete operations, we still want to track who performed the deletion
        if (operation === 'delete') {
            if (hasAttribute(schema, 'deletedBy') && !isAttributeReadOnly(schema, 'deletedBy') && actor.actorId) {
                (enhancedData as any).deletedBy = actor.actorId;
            }
            if (hasAttribute(schema, 'deletedAt') && !isAttributeReadOnly(schema, 'deletedAt')) {
                (enhancedData as any).deletedAt = currentTimestamp;
            }
        } else {
            // Always update these fields on create/update (if not read-only)
            if (hasAttribute(schema, 'updatedBy') && !isAttributeReadOnly(schema, 'updatedBy') && actor.actorId) {
                (enhancedData as any).updatedBy = actor.actorId;
            }
            if (hasAttribute(schema, 'updatedAt') && !isAttributeReadOnly(schema, 'updatedAt')) {
                (enhancedData as any).updatedAt = currentTimestamp;
            }
            if (hasAttribute(schema, 'tenantId') && !isAttributeReadOnly(schema, 'tenantId') && actor.tenantId) {
                (enhancedData as any).tenantId = actor.tenantId;
            }
        }

        // Always inject complete actor context for audit trail
        // This field is hidden from API responses by default
        // Inject actorTimestamp for staleness detection in audit logs
        const actorWithTimestamp = {
            ...actor,
            actorTimestamp: Date.now(), // Milliseconds since epoch for easy comparison
        };

        // Clean actor object by removing undefined values (DynamoDB doesn't allow them)
        const cleanActor = Object.fromEntries(
            Object.entries(actorWithTimestamp).filter(([ _, value ]) => value !== undefined)
        );

        (enhancedData as any)._actor = cleanActor;

        return enhancedData;
    }

    /**
     * Creates a new entity.
     * 
     * @param payload - The payload for creating the entity.
     * @returns The created entity.
     */
    @Observed({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: (instance as { getEntityName(): string }).getEntityName() }
            })
        }
    })
    public async create(payload: CreateEntityItemTypeFromSchema<S>, _ctx?: ExecutionContext): Promise<CreateEntityResponse<S>> {

        const entity = await createEntity<S>({
            data: payload,
            entityName: this.getEntityName(),
            entityService: this,
        });

        // Decompress fields after reading
        return {
            ...entity,
            data: entity.data ? this.decompressFields(entity.data) : entity.data
        };
    }

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
    /**
     * Creates-OR-Updates an entity.
     * Note: Prefer calling executeOperation('upsert', payload) to ensure all hooks are executed.
     *
     * @param payload - The payload for creating-OR-updating the entity.
     * @returns Object containing data, wasCreated flag, and oldData if updated.
     */
    @Observed({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: (instance as { getEntityName(): string }).getEntityName() }
            }),
            finish: ({ result }) => ({
                tags: { wasCreated: !!(result as { wasCreated?: boolean } | undefined)?.wasCreated }
            })
        }
    })
    public async upsert(payload: UpsertEntityItemTypeFromSchema<S>): Promise<UpsertEntityResponse<S>> {
        this.logger.debug(`Called ~ upsert ~ entityName: ${this.getEntityName()} ~ payload:`, payload);

        const result = await upsertEntity<S>({
            data: payload,
            entityName: this.getEntityName(),
            entityService: this,
        });

        // Decompress result fields
        return {
            ...result,
            data: result.data ? this.decompressFields(result.data) : result.data,
            oldData: result.oldData ? this.decompressFields(result.oldData) : undefined
        };
    }

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
    protected async makeDuplicateEntityData(identifiers: EntityIdentifiersTypeFromSchema<S>): Promise<CreateEntityItemTypeFromSchema<S>> {
        const entity = await this.get({ identifiers }) as EntityRecordTypeFromSchema<S>;

        if (!entity) {
            throw new Error(`No ${this.getEntityName()} record found for identifiers: ${identifiers}`);
        }

        let duplicateEventData: CreateEntityItemTypeFromSchema<S> = {} as any;
        const primaryIdPropName = this.getEntityPrimaryIdPropertyName() as string;

        const schema = this.getEntitySchema();
        const entitySlugAttribute = (getAttributeNameBy(schema, 'slug') || '').toUpperCase();
        const entityNameAttribute = (getAttributeNameBy(schema, 'name') || '').toUpperCase();

        for (let [ key, value ] of Object.entries(entity)) {

            if (key !== primaryIdPropName) {
                // TODO: handle when entity has multiple identifiers

                if (key.toUpperCase() === entityNameAttribute) {
                    value = `${value} - Copy`;
                } else if (key.toUpperCase() === entitySlugAttribute) {
                    value = `${value}-copy`;
                }

                duplicateEventData[ key as keyof typeof duplicateEventData ] = value;
            }
        }

        return duplicateEventData;
    }

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
    /**
     * Updates an entity in the database.
     * Note: Prefer calling executeOperation('update', payload) to ensure all hooks are executed.
     *
     * @param identifiers - The identifiers of the entity to update.
     * @param data - The updated data for the entity.
     * @param operators - Optional update operators (e.g., remove).
     * @returns The updated entity.
     */
    @Observed({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: (instance as { getEntityName(): string }).getEntityName() }
            })
        }
    })
    public async duplicate(id: EntityIdentifiersTypeFromSchema<S>, ctx?: ExecutionContext): Promise<CreateEntityResponse<S>> {
        const duplicateEventData = await this.makeDuplicateEntityData(id);
        return await this.create(duplicateEventData, ctx);
    }

    // TODO: should be part of some config
    protected delimitersRegex = /(?:&| |,|\+)+/;

    /**
     * Retrieves a list of entities based on the provided query.
     * - If no specific attributes are provided in the query, it defaults to a list of attribute names obtained from `getListingAttributeNames()`.
     * - If a search term is provided in the query it will split the search term by `/(?:&| |,|\+)+/` Regex and will filter out empty strings.
     * - If search attributes are not provided in the query, it defaults to a list of searchable attribute names obtained from `getSearchableAttributeNames()`.
     * 
     * @param query - The query object containing filters, search keywords, and attributes.
     * @returns A Promise that resolves to an object containing the list of entities and the original query.
     */
    @Observed({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read' },
        extract: {
            start: ({ instance, args }) => {
                const [ query ] = args as [ { filters?: Record<string, unknown> } | undefined ];
                const hasFilters = !!query?.filters && Object.keys(query.filters).length > 0;
                return {
                    tags: {
                        entityName: (instance as { getEntityName(): string }).getEntityName(),
                        hasFilters,
                    }
                };
            },
            finish: ({ result }) => {
                const r = result as { data?: unknown[]; cursor?: unknown } | undefined;
                const resultCount = Array.isArray(r?.data) ? r!.data.length : 0;
                return {
                    tags: { hasCursor: !!r?.cursor },
                    metrics: { resultCount }
                };
            }
        }
    })
    public async list(query: EntityQuery<S> = {}, _ctx?: ExecutionContext) {
        this.logger.debug(`Called ~ list ~ entityName: ${this.getEntityName()} ~ query:`, query);

        // Handle soft delete filtering
        if (this.getEntitySchema().model.softDelete && !(query as any).includeDeleted) {
            const deletedAtAttr = getAttributeNameBy(this.getEntitySchema(), 'deletedAt') || 'deletedAt';
            query.filters = {
                ...(query.filters || {}),
                [ deletedAtAttr ]: { notExists: true }
            } as any;
        }

        if (!query.attributes) {
            query.attributes = this.getListingAttributeNames()
        }

        // for listing API attributes would be an array
        if (Array.isArray(query.attributes)) {
            const parsedOptions = parseEntityAttributePaths(query.attributes as string[]);
            query.attributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        }

        if (query.search) {
            if (isString(query.search)) {
                query.search = query.search.trim().split(this.delimitersRegex ?? ' ').filter(s => !!s);
            }

            if (query.search.length > 0) {

                if (isString(query.searchAttributes)) {
                    query.searchAttributes = query.searchAttributes.split(',').filter(s => !!s);
                }
                if (!query.searchAttributes || isEmpty(query.searchAttributes)) {
                    query.searchAttributes = this.getSearchableAttributeNames();
                }

                const searchFilterGroup = makeFilterGroupForSearchKeywords(query.search, query.searchAttributes);

                query.filters = addFilterGroupToEntityFilterCriteria<S>(searchFilterGroup as any, query.filters);
            }
        }

        const entities = await listEntity<S>({
            query,
            entityName: this.getEntityName(),
            entityService: this,
        });

        // Decompress all records
        entities.data = entities.data.map(record => this.decompressFields(record));

        entities.data = this.serializeRecords(entities.data, query.attributes);

        if (query.attributes && entities.data) {
            const relationalAttributes = Object.entries(query.attributes)?.map(([ attributeName, options ]) => {
                return [ attributeName, options ];
            })
                // only attributes in hydrate options that have relation metadata attached to them needs to be hydrated
                .filter(([ , options ]) => isObject(options));

            if (relationalAttributes.length) {
                await this.hydrateRecords(relationalAttributes as any, entities.data);
            }
        }

        return { ...entities, query };
    }


    /**
     * Executes a query on the entity.
     * - If no specific attributes are provided in the query, it defaults to a list of attribute names obtained from `getListingAttributeNames()`.
     * - If a search term is provided in the query it will split the search term by `/(?:&| |,|\+)+/` Regex and will filter out empty strings.
     *   -- If search attributes are not provided in the query, it defaults to a list of searchable attribute names obtained from `getSearchableAttributeNames()`.
     *   -- If there are any non-empty search-terms, it will add a filter group to the query based on the search keywords.
     * @param query - The entity query to execute.
     * @returns A promise that resolves to the result of the query.
     */
    @Observed({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read' },
        extract: {
            start: ({ instance, args }) => {
                const [ query ] = args as [ { filters?: Record<string, unknown> } | undefined ];
                const hasFilters = !!query?.filters && Object.keys(query.filters).length > 0;
                return {
                    tags: {
                        entityName: (instance as { getEntityName(): string }).getEntityName(),
                        hasFilters,
                    }
                };
            },
            finish: ({ result }) => {
                const r = result as { data?: unknown[] } | undefined;
                const resultCount = Array.isArray(r?.data) ? r!.data.length : 0;
                return { metrics: { resultCount } };
            }
        }
    })
    public async query(query: EntityQuery<S>, _ctx?: ExecutionContext) {
        this.logger.debug(`Called ~ list ~ entityName: ${this.getEntityName()} ~ query:`, query);

        // Handle soft delete filtering
        if (this.getEntitySchema().model.softDelete && !(query as any).includeDeleted) {
            const deletedAtAttr = getAttributeNameBy(this.getEntitySchema(), 'deletedAt') || 'deletedAt';
            query.filters = {
                ...(query.filters || {}),
                [ deletedAtAttr ]: { notExists: true }
            } as any;
        }

        const { attributes } = query;

        let selectAttributes: EntitySelections<S> | undefined = attributes || this.getListingAttributeNames();

        if (Array.isArray(selectAttributes)) {
            // parse the list of dot-separated attribute-identifiers paths and ensure all the required metadata is there
            const parsedOptions = parseEntityAttributePaths(selectAttributes as string[]);
            selectAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), parsedOptions);
        } else {
            // ensure all the provided select attributes has required metadata all the way down to the leaf level
            selectAttributes = this.inferRelationshipsForEntitySelections(this.getEntitySchema(), selectAttributes);
        }

        if (query.search) {
            if (isString(query.search)) {
                query.search = query.search.trim().split(this.delimitersRegex ?? ' ').filter(s => !!s);
            }

            if (query.search.length > 0) {

                query.searchAttributes = query.searchAttributes || this.getSearchableAttributeNames();

                const searchFilterGroup = makeFilterGroupForSearchKeywords(query.search, query.searchAttributes);

                query.filters = addFilterGroupToEntityFilterCriteria<S>(searchFilterGroup as any, query.filters);
            }
        }

        const entities = await queryEntity<S>({
            query,
            entityName: this.getEntityName(),
            entityService: this,
        });

        // Decompress all records
        entities.data = entities.data.map(record => this.decompressFields(record));

        entities.data = this.serializeRecords(entities.data, selectAttributes);

        if (selectAttributes && entities.data) {
            const relationalAttributes = Object.entries(selectAttributes)?.map(([ attributeName, options ]) => {
                return [ attributeName, options ];
            })
                // only attributes in hydrate options that have relation metadata attached to them needs to be hydrated
                .filter(([ , options ]) => isObject(options));

            if (relationalAttributes.length) {
                await this.hydrateRecords(relationalAttributes as any, entities.data);
            }
        }

        return { ...entities, query };
    }

    /**
     * Updates an entity in the database.
     *
     * @param identifiers - The identifiers of the entity to update.
     * @param data - The updated data for the entity.
     * @param remove - Optional array of attributes to remove from the entity.
     * @returns The updated entity.
     */
    @Observed({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: (instance as { getEntityName(): string }).getEntityName() }
            })
        }
    })
    public async update(identifiers: EntityIdentifiersTypeFromSchema<S>, data: UpdateEntityItemTypeFromSchema<S>, operators?: UpdateEntityOperators, _ctx?: ExecutionContext): Promise<UpdateEntityResponse<S>> {

        const updatedEntity = await updateEntity<S>({
            id: identifiers,
            data: data,
            operators: operators,
            entityName: this.getEntityName(),
            entityService: this,
        });

        // Decompress fields after reading
        return {
            ...updatedEntity,
            data: updatedEntity.data ? this.decompressFields(updatedEntity.data) : updatedEntity.data
        };
    }

    /**
     * Deletes an entity based on the provided identifiers.
     * 
     * @param identifiers - The identifiers of the entity to be deleted.
     * @returns A promise that resolves to the deleted entity.
     */
    @Observed({
        trace: { level: 'warn' },
        sourceType: 'service',
        tags: { operation_category: 'delete' },
        extract: {
            start: ({ instance }) => ({
                tags: { entityName: (instance as { getEntityName(): string }).getEntityName() }
            })
        }
    })
    public async delete(identifiers: EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>>, ctx?: ExecutionContext): Promise<DeleteEntityResponse<S>> {
        try {
            this.logger.debug(`Called ~ delete ~ entityName: ${this.getEntityName()} ~ identifiers:`, identifiers);

            if (this.getEntitySchema().model.softDelete) {
                this.logger.debug(`Soft delete enabled for ${this.getEntityName()}. Updating deletedAt instead of physical delete.`);
                const deletedAtAttr = getAttributeNameBy(this.getEntitySchema(), 'deletedAt') || 'deletedAt';
                const deletedByAttr = getAttributeNameBy(this.getEntitySchema(), 'deletedBy') || 'deletedBy';

                const updateData: any = {
                    [deletedAtAttr]: new Date().toISOString()
                };

                const actor = ctx?.actor || getCurrentExecutionContext()?.actor;
                if (actor?.actorId) {
                    updateData[deletedByAttr] = actor.actorId;
                }

                // Call update directly to perform soft delete
                const result = await this.update(identifiers as any, updateData, undefined, ctx);
                return { data: result.data };
            }

            const deletedEntity = await deleteEntity<S>({
                id: identifiers,
                entityName: this.getEntityName(),
                entityService: this,
                actor: ctx?.actor,
                tenant: ctx?.actor?.tenantId,
            });

            return deletedEntity;
        } catch (error: any) {
            throw new DatabaseError(`Failed to delete ${this.getEntityName()}: ${error.message}`);
        }
    }

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
    @Observed({
        trace: { level: 'warn' }, // Batch deletes are critical
        sourceType: 'service',
        tags: { operation_category: 'delete', batch: 'true' },
        extract: {
            start: ({ instance, args }) => {
                const [ options ] = args as [ { identifiers?: unknown[]; concurrent?: number } ];
                const batchSize = Array.isArray(options?.identifiers) ? options.identifiers.length : 0;
                const concurrent = typeof options?.concurrent === 'number' ? options.concurrent : 1;
                return {
                    tags: { entityName: (instance as { getEntityName(): string }).getEntityName() },
                    metrics: { batchSize, concurrent }
                };
            },
            finish: ({ result }) => {
                const r = result as { data?: unknown[]; unprocessed?: unknown[] } | undefined;
                const deletedCount = Array.isArray(r?.data) ? r!.data.length : 0;
                const unprocessedCount = Array.isArray(r?.unprocessed) ? r!.unprocessed.length : 0;
                return { metrics: { deletedCount, unprocessedCount } };
            }
        }
    })
    /**
     * Upserts multiple entities in a batch operation.
     * Note: Prefer calling executeOperation('batchUpsert', payload) to ensure all hooks are executed.
     */
    @Observed({
        trace: { level: 'info' },
        sourceType: 'service',
        tags: { operation_category: 'write', batch: 'true' },
        extract: {
            start: ({ instance, args }) => ({
                tags: { entityName: (instance as { getEntityName(): string }).getEntityName() },
                metrics: { batchSize: (args[ 0 ] as any[])?.length }
            })
        }
    })
    public async batchUpsert(items: Array<UpsertEntityItemTypeFromSchema<S>>, options: { concurrent?: number } = {}, ctx?: ExecutionContext) {
        // Pre-process items (hooks)
        const processedItems = await Promise.all(items.map(item => this.onBeforeUpsert(item, ctx)));

        const result = await upsertBatchEntity<S>({
            items: processedItems,
            entityName: this.getEntityName(),
            entityService: this as any,
            concurrent: options.concurrent,
            actor: ctx?.actor
        });

        // Post-process results (hooks)
        if (result.data) {
            await Promise.all(result.data.map(record => this.onAfterUpsert(record, ctx)));
        }

        return result;
    }

    public async batchDelete(options: {
        identifiers: Array<EntityIdentifiersTypeFromSchema<S>>,
        concurrent?: number
    }, ctx?: ExecutionContext) {
        try {
            const { identifiers, concurrent = 1 } = options;

            this.logger.debug(`Called ~ batchDelete ~ entityName: ${this.getEntityName()} ~ count: ${identifiers.length}`, {
                concurrent
            });

            const result = await deleteBatchEntity<S>({
                ids: identifiers,
                entityName: this.getEntityName(),
                entityService: this,
                actor: ctx?.actor,
                tenant: ctx?.actor?.tenantId,
                concurrent
            });

            // ElectroDB batch delete returns { unprocessed: Array }
            const unprocessedCount = (result as any)?.unprocessed?.length || 0;
            const dataCount = result.data?.length;
            this.logger.debug(`Completed ~ batchDelete ~ entityName: ${this.getEntityName()} ~ processed: ${identifiers.length}, dataCount: ${dataCount}, unprocessed: ${unprocessedCount}`);

            return result;
        } catch (error: any) {
            throw new DatabaseError(`Failed to batch delete ${this.getEntityName()}: ${error.message}`);
        }
    }

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
    @Observed({
        trace: { level: 'warn' }, // Bulk deletes are dangerous
        sourceType: 'service',
        tags: { operation_category: 'delete', batch: 'true', bulk: 'true' },
        extract: {
            start: ({ instance, args }) => {
                const [ options ] = args as [ { filters?: Record<string, unknown>; batchSize?: number; maxItems?: number } | undefined ];
                const maxItems = options?.maxItems;
                const batchSize = typeof options?.batchSize === 'number' ? options.batchSize : 25;
                return ({
                    tags: {
                        entityName: (instance as { getEntityName(): string }).getEntityName(),
                        hasFilters: (() => {
                            return !!options?.filters && Object.keys(options.filters).length > 0;
                        })(),
                    },
                    metrics: {
                        batchSize,
                        ...(typeof maxItems === 'number' ? { maxItems } : {}),
                    }
                });
            },
            finish: ({ result }) => ({
                metrics: {
                    deletedCount: (result as { deletedCount?: number } | undefined)?.deletedCount || 0,
                    failedCount: (result as { failedCount?: number } | undefined)?.failedCount || 0,
                    totalProcessed: (result as { totalProcessed?: number } | undefined)?.totalProcessed || 0,
                }
            })
        }
    })
    public async deleteByQuery(options: {
        filters: EntityFilterCriteria<S>,
        batchSize?: number,
        concurrent?: number,
        maxItems?: number
    }, ctx?: ExecutionContext) {
        try {
            const { filters, batchSize = 25, concurrent = 1, maxItems } = options;

            this.logger.info(`Called ~ deleteByQuery ~ entityName: ${this.getEntityName()}`, {
                filters,
                batchSize,
                maxItems
            });

            // Safety check: require filters to prevent accidental deletion of all records
            if (!filters || isEmptyObjectDeep(filters)) {
                throw new Error('deleteByQuery requires filters to prevent accidental deletion of all records. Use scan with explicit confirmation if you need to delete all records.');
            }

            let deletedCount = 0;
            let failedCount = 0;
            let cursor: string | null = null;
            let totalProcessed = 0;

            // Query and delete in batches
            do {
                // Fetch a batch of items to delete
                const queryResult = await this.query({
                    filters,
                    pagination: {
                        count: batchSize,
                        cursor: cursor || undefined,
                        order: 'asc',
                        pager: 'cursor'
                    }
                }, ctx);

                const itemsToDelete = queryResult.data;

                if (!itemsToDelete || itemsToDelete.length === 0) {
                    break;
                }

                this.logger.debug(`Deleting batch of ${itemsToDelete.length} items`);

                // Extract identifiers from the fetched items
                const identifiers = itemsToDelete.map(item =>
                    this.extractEntityIdentifiers(item as any)
                ) as Array<EntityIdentifiersTypeFromSchema<S>>;

                // Batch delete the items
                const deleteResult = await this.batchDelete({
                    identifiers,
                    concurrent
                }, ctx);

                const unprocessedCount = (deleteResult as any)?.unprocessed?.length || 0;
                const dataCount = deleteResult.data?.length;
                const batchDeletedCount = identifiers.length - unprocessedCount;
                deletedCount += batchDeletedCount;
                failedCount += unprocessedCount;
                totalProcessed += itemsToDelete.length;

                this.logger.debug(`Batch result: ${batchDeletedCount} deleted, ${unprocessedCount} failed`);

                // Check if we've hit the max items limit
                if (maxItems && totalProcessed >= maxItems) {
                    this.logger.warn(`Reached maxItems limit of ${maxItems}, stopping deletion`);
                    break;
                }

                // Update cursor for next iteration
                cursor = queryResult.cursor || null;

            } while (cursor);

            this.logger.info(`Completed ~ deleteByQuery ~ entityName: ${this.getEntityName()} ~ deleted: ${deletedCount}, failed: ${failedCount}`);

            return {
                deletedCount,
                failedCount,
                totalProcessed
            };

        } catch (error: any) {
            this.logger.error(`Failed to delete by query for ${this.getEntityName()}:`, error);
            throw new DatabaseError(`Failed to delete by query for ${this.getEntityName()}: ${error.message}`);
        }
    }

    /**
     * Rebuilds all indexes for the entity by writing to the primary index.
     * This method is useful for maintaining data integrity and ensuring indexes are properly updated.
     * 
     * @param options - Options for rebuilding the index
     * @param options.batchSize - The number of items to process in each batch. Defaults to 100.
     * @returns A promise that resolves when the index rebuild is complete.
     */
    @Observed({
        trace: { level: 'warn' }, // Index rebuilds are critical operations
        sourceType: 'service',
        tags: { operation_category: 'maintenance', batch: 'true' },
        extract: {
            start: ({ instance, args }) => ({
                tags: { entityName: (instance as { getEntityName(): string }).getEntityName() },
                metrics: {
                    batchSize: (() => {
                        const [ options ] = args as [ { batchSize?: number } | undefined ];
                        return typeof options?.batchSize === 'number' ? options.batchSize : 100;
                    })()
                }
            }),
            finish: () => ({
                tags: { completed: true }
            })
        }
    })
    public async rebuildIndex(options: { batchSize?: number } = {}): Promise<void> {
        try {
            const { batchSize = 100 } = options;
            const entityName = this.getEntityName();
            const repository = this.getRepository();

            this.logger.info(`Starting index rebuild for entity: ${entityName}`);

            // Get all records from the primary index
            const allRecords = await repository.scan.go();

            if (!allRecords.data || allRecords.data.length === 0) {
                this.logger.info(`No records found for entity: ${entityName}`);
                return;
            }

            this.logger.info(`Found ${allRecords.data.length} records to process for entity: ${entityName}`);

            // Process records in batches
            const totalRecords = allRecords.data.length;
            const totalBatches = Math.ceil(totalRecords / batchSize);

            for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                const start = batchIndex * batchSize;
                const end = Math.min(start + batchSize, totalRecords);
                const batch = allRecords.data.slice(start, end);

                this.logger.info(`Processing batch ${batchIndex + 1}/${totalBatches} (${start + 1}-${end} of ${totalRecords} records)`);

                // Rebuild all indexes by upserting each record to the primary index
                for (const record of batch) {
                    try {
                        // Use upsert to ensure the record is properly indexed
                        await repository.upsert(record).go();
                    } catch (error) {
                        this.logger.error(`Error processing record:`, error);
                    }
                }
            }

            this.logger.info(`Completed index rebuild for entity: ${entityName}`);
        } catch (error) {
            this.logger.error(`Failed to rebuild index for entity: ${this.getEntityName()}`, error);
            throw new DatabaseError(`Failed to rebuild index for ${this.getEntityName()}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Infers relationships between entities based on the provided schema and selection-paths.
     * @param schema The entity schema.
     * @param paths The parsed selection paths from e.g. parseEntityAttributePaths().
     * @param pathKey The current "path" string representing how we arrived here (defaults to the entity name).
     * @param visitedPaths A set of path-strings visited so far in this recursion chain (prevents cycles).
     * @param maxDepth Maximum recursion depth (optional).
     */
    inferRelationshipsForEntitySelections<E extends EntitySchema<any, any, any>>(
        schema: E,
        paths: ParsedEntityAttributePaths,
        pathKey: string = schema.model.entity,
        visitedPaths: Set<string> = new Set<string>(),
        maxDepth = 5
    ): HydrateOptionsMapForEntity<E> {

        this.logger.debug('inferRelationshipsForEntitySelections', { pathKey, paths });

        // If we exceed max depth, we skip expansions
        if (maxDepth <= 0) {
            this.logger.warn(`Max recursion depth reached at pathKey="${pathKey}"`);
            return {} as HydrateOptionsMapForEntity<E>;
        }

        const inferred: any = {};

        // Loop over each attribute in the entity schema
        Object.entries(schema.attributes).forEach(([ attributeName, attributeMeta ]) => {
            const attVal = paths[ attributeName ];
            if (!attVal) {
                // Not selected in the user's attributes
                return;
            }

            const isRelational = !!attributeMeta.relation;

            // If the attribute is not relational or the value is a boolean, we can infer the attribute
            if (!isRelational || isBoolean(attVal)) {
                inferred[ attributeName ] = attVal;
                return;
            }

            // It's a relational attribute; prepare to recurse
            const relationMeta = attributeMeta.relation!;
            const nextEntityName = relationMeta.entityName;

            // Build a new "path" string to detect cycles (e.g. "User.groups.Group.members.User")
            const newPath = `${pathKey}.${attributeName}.${nextEntityName}`;

            // Check if we've already visited this path, if so => skip expansions for this attribute only
            if (visitedPaths.has(newPath)) {
                this.logger.warn(`Skipping cyc relation expansions for: ${newPath}`);
                inferred[ attributeName ] = {
                    entityName: nextEntityName,
                    skippedDueToCycle: true,
                };
                return;
            }

            // Mark this path as visited
            visitedPaths.add(newPath);

            // Recurse to the related entity's schema
            const relatedEntitySchema = this.getEntitySchemaByEntityName<EntitySchema<any, any, any>>(nextEntityName);
            const relatedEntityService = this.getEntityServiceByEntityName<EntitySchema<any, any, any>>(nextEntityName);

            // Build the "meta" object that we store
            const meta: HydrateOptionForRelation = {
                entityName: nextEntityName,
                relationType: relationMeta.type,
                identifiers: isFunction(relationMeta.identifiers)
                    ? relationMeta.identifiers()
                    : relationMeta.identifiers,
                attributes: {},
            };
            const pathSelectionAttributes = isObject(attVal) ? attVal.attributes : undefined; // provided by the user 
            const relationSelectionAttributes = relationMeta.attributes; // defined in the relation definition
            const relatedEntityDefaultSelectionAttributes = relatedEntityService.getDefaultSerializationAttributeNames(); // auto gen by framework

            // Recurse to expand child's relationships
            meta.attributes = this.inferRelationshipsForEntitySelections(
                relatedEntitySchema,
                (pathSelectionAttributes || relationSelectionAttributes || relatedEntityDefaultSelectionAttributes) as any,
                nextEntityName,
                visitedPaths,
                maxDepth - 1
            );

            inferred[ attributeName ] = meta;

            // Remove this path so siblings can also expand it if needed
            visitedPaths.delete(newPath);
        });

        return inferred;
    }

    @Observed({
        trace: { level: 'debug' },
        sourceType: 'service',
        tags: { operation_category: 'read', search: 'true' },
        extract: {
            start: ({ instance, args }) => {
                const [ query ] = args as [ { q?: unknown; filter?: Record<string, unknown> } | undefined ];
                const hasQuery = !!query?.q;
                const hasFilters = !!query?.filter && Object.keys(query.filter).length > 0;
                return {
                    tags: {
                        entityName: (instance as { getEntityName(): string }).getEntityName(),
                        hasQuery,
                        hasFilters,
                    }
                };
            },
            finish: ({ result }) => {
                const r = result as { hits?: unknown[]; estimatedTotalHits?: number } | undefined;
                const hitCount = Array.isArray(r?.hits) ? r!.hits.length : 0;
                const totalHits = typeof r?.estimatedTotalHits === 'number' ? r.estimatedTotalHits : 0;
                return { metrics: { hitCount, totalHits } };
            }
        }
    })
    public async search(query: EntitySearchQuery<S>, ctx?: ExecutionContext) {
        const searchService = this.getSearchService();
        if (!query.select) {
            // * Note: we expect an array of attribute names
            query.select = this.getListingAttributeNames() as any;
        }
        const result = await searchService.search(query, undefined, ctx);

        // Decompress hits if present
        if (result?.hits && Array.isArray(result.hits)) {
            result.hits = result.hits.map(hit => this.decompressFields(hit));
        }

        return result;
    }

    /**
     * Compress fields marked with `compressed: true` in schema.
     * Called automatically before writing to DB.
     */
    protected compressFields<T extends Record<string, any>>(data: T): T {
        const attributes = this.getEntitySchema().attributes;
        const result = { ...data } as Record<string, any>;

        for (const [ fieldName, attribute ] of Object.entries(attributes)) {
            if (!attribute.compressed || !(fieldName in result)) continue;

            const threshold = typeof attribute.compressed === 'object'
                ? attribute.compressed.threshold
                : 10 * 1024; // Default 10KB

            result[ fieldName ] = compressIfNeeded(result[ fieldName ], threshold);
        }

        return result as T;
    }

    /**
     * Decompress fields that have compressed data.
     * Called automatically after reading from DB.
     */
    protected decompressFields<T extends Record<string, any>>(data: T): T {
        return decompressItem(data);
    }
}

const entityAttributeLogger = createLogger('entityAttributeToIOSchemaAttribute');

export function entityAttributeToIOSchemaAttribute(attId: string, att: EntityAttribute): Partial<EntityAttribute> & {
    id: string,
    name: string,
    properties?: TIOSchemaAttribute[]
} {

    const { name, validations, required, relation, default: defaultValue, get: _getter, set: _setter, watch, ...restMeta } = att;

    const { entityName: relatedEntityName, ...restRelation } = relation || {};

    const relationMeta = relatedEntityName ? { ...restRelation, entityName: relatedEntityName } : undefined;

    const { items, type, properties, addNewOption, addNewOptionConfig, fieldType: explicitFieldType, options, ...restRestMeta } = restMeta as any;

    // Infer fieldType from type if not explicitly provided
    let inferredFieldType: string | undefined = explicitFieldType;
    if (!inferredFieldType && type) {
        if (type === 'boolean') {
            inferredFieldType = 'boolean';
        } else if (type === 'number') {
            inferredFieldType = 'number';
        } else if (Array.isArray(type)) {
            // Enum type like ['active', 'inactive']
            inferredFieldType = 'select';
        } else if (type === 'string' && options && Array.isArray(options) && options.length > 0) {
            // String with options is a select
            inferredFieldType = 'select';
        } else if (type === 'any') {
            inferredFieldType = 'json';
        } else if (type === 'map') {
            inferredFieldType = 'map';
        } else if (type === 'list') {
            inferredFieldType = 'list';
        }
        // For date fields, check attribute name as hint
        else if (type === 'string') {
            const lowerAttId = attId.toLowerCase();
            // Only infer datetime for fields that are ACTUALLY dates, not just contain "date" in the name
            // Exclude: calendarDate (YYYY-MM-DD format), updatedBy/createdBy (user IDs), etc.
            if ((lowerAttId.endsWith('at') && (lowerAttId.includes('date') || lowerAttId.includes('time'))) ||
                lowerAttId === 'createdat' || lowerAttId === 'updatedat' || lowerAttId === 'deletedat' ||
                lowerAttId === 'scheduledat' || lowerAttId === 'publishedat' || lowerAttId === 'expiresat') {
                inferredFieldType = 'datetime';
            }
        }

        entityAttributeLogger.debug(`inferredFieldType: ${inferredFieldType} for entity attribute "${attId}" with type "${typeof type === 'object' ? JSON.stringify(type) : type}"`);
    }

    const formatted: any = {
        ...restRestMeta,
        type,
        id: attId,
        name: name || toHumanReadableName(attId),
        relation: relationMeta as any,
        defaultValue,
        validations: validations || required ? [ 'required' ] : [],
        isVisible: !('isVisible' in att) ? true : att.isVisible,
        isEditable: !('isEditable' in att) ? true : att.isEditable,
        isListable: !('isListable' in att) ? true : att.isListable,
        isCreatable: !('isCreatable' in att) ? true : att.isCreatable,
        isFilterable: !('isFilterable' in att) ? true : att.isFilterable,
        isSearchable: !('isSearchable' in att) ? true : att.isSearchable,
    }

    // Add inferred or explicit fieldType
    if (inferredFieldType) {
        formatted.fieldType = inferredFieldType;
    } else if (!explicitFieldType && type && type !== 'string') {
        // Log warning for non-string types we couldn't infer
        entityAttributeLogger.warn(`⚠️ Could not infer fieldType for attribute "${attId}" with type "${typeof type === 'object' ? JSON.stringify(type) : type}". Consider adding explicit fieldType.`);
    }

    // Add options back if they exist
    if (options) {
        formatted.options = options;
    }

    // Pass through both old and new addNewOption formats
    if (addNewOptionConfig) {
        formatted[ 'addNewOptionConfig' ] = addNewOptionConfig;
    }
    if (addNewOption) {
        formatted[ 'addNewOption' ] = addNewOption;
    }

    //
    // ** make sure to not override the inner fields of attributes like `list-[items]-[map]-properties` **
    //
    if (type === 'map') {
        formatted[ 'properties' ] = Object.entries<any>(properties).map(([ k, v ]) => entityAttributeToIOSchemaAttribute(k, v));
    } else if (type === 'list' && items.type === 'map') {
        formatted[ 'items' ] = {
            ...items,
            properties: Object.entries<any>(items.properties).map(([ k, v ]) => entityAttributeToIOSchemaAttribute(k, v))
        };
    }

    // TODO: add support for set, enum, and custom-types

    return formatted
}

export type TIOSchemaAttribute = ReturnType<typeof entityAttributeToIOSchemaAttribute>;
export type TIOSchemaAttributesMap<S extends EntitySchema<any, any, any>> = Map<keyof S[ 'attributes' ], TIOSchemaAttribute>;

/**
 * Creates an access patterns schema based on the provided entity schema.
 * @param schema The entity schema.
 * @returns A map of access patterns, where the keys are the index names and the values are maps of attribute names and their corresponding schema attributes.
 */
export function makeEntityAccessPatternsSchema<S extends EntitySchema<any, any, any>>(schema: S) {
    const accessPatterns = new Map<keyof S[ 'indexes' ], TIOSchemaAttributesMap<S>>();

    for (const indexName in schema.indexes) {
        const indexAttributes: TIOSchemaAttributesMap<S> = new Map();

        for (const idxPkAtt of schema.indexes[ indexName ].pk.composite) {
            const att = schema.attributes[ idxPkAtt ];
            indexAttributes.set(idxPkAtt, {
                ...entityAttributeToIOSchemaAttribute(idxPkAtt, { ...att, required: true })
            });
        }

        for (const idxSkAtt of schema.indexes[ indexName ].sk?.composite ?? []) {
            const att = schema.attributes[ idxSkAtt ];
            indexAttributes.set(idxSkAtt, {
                ...entityAttributeToIOSchemaAttribute(idxSkAtt, { ...att, required: true })
            });
        }

        accessPatterns.set(indexName, indexAttributes);
    }

    // make sure there's a primary access pattern;
    if (!accessPatterns.has('primary')) {
        accessPatterns.set('primary', accessPatterns.values().next().value!);
    }

    return accessPatterns;
}
