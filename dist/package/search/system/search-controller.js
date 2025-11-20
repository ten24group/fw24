"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchSystemController = exports.SEARCH_CONTROLLER_ENV_KEYS = void 0;
const sqs_1 = require("../../client/sqs");
const api_gateway_controller_1 = require("../../core/runtime/api-gateway-controller");
const decorators_1 = require("../../decorators");
const di_1 = require("../../di");
const utils_1 = require("../../utils");
const search_utils_1 = require("../search-utils");
const client_1 = require("../../client");
var SEARCH_CONTROLLER_ENV_KEYS;
(function (SEARCH_CONTROLLER_ENV_KEYS) {
    SEARCH_CONTROLLER_ENV_KEYS["MEILISEARCH_SYNC_QUEUE_NAME"] = "MEILISEARCH_SYNC_QUEUE_NAME";
})(SEARCH_CONTROLLER_ENV_KEYS || (exports.SEARCH_CONTROLLER_ENV_KEYS = SEARCH_CONTROLLER_ENV_KEYS = {}));
let SearchSystemController = class SearchSystemController extends api_gateway_controller_1.APIController {
    container;
    constructor(container) {
        super();
        this.container = container;
    }
    async initialize(_event, _context) { }
    async listIndices(_request, response) {
        // Auto-discover entities with search enabled
        const entityProviders = this.container.collectBestProvidersFor({
            type: 'service',
            allProvidersFromChildContainers: true,
        })
            .filter(p => {
            return !!p._provider.forEntity;
        });
        const indicesData = [];
        await Promise.all(entityProviders.map(async (provider) => {
            const entityName = provider._provider.forEntity;
            try {
                // use provider's container  to resolve the service
                const service = provider._container.resolve(provider._provider.provide);
                if (!service) {
                    throw new Error(`Service ${String(provider._provider.provide)} not found for entity ${entityName}`);
                }
                const searchService = service.getSearchService();
                if (!searchService) {
                    throw new Error(`Search service not found for entity ${entityName}`);
                }
                const indexInfo = await searchService.getIndexInfo();
                indicesData.push({
                    ...indexInfo,
                    entityName,
                    indexName: indexInfo.uid,
                });
            }
            catch (error) {
                indicesData.push({
                    indexName: `[${entityName}]-index-name-not-resolved`,
                    entityName,
                    error: error.message,
                });
                this.logger.error(error);
            }
        }));
        return response.json({ indices: indicesData });
    }
    /**
     * Add new api to get index details
     *
     */
    async getIndexDetails(req, res) {
        const { entityName } = req.pathParameters ?? {};
        const searchService = this.getEntitySearchService(entityName);
        const indexInfo = await searchService.getIndexInfo();
        const indexStats = await searchService.getIndexStats();
        return res.json({
            details: {
                indexInfo,
                indexStats,
                entityName,
            }
        });
    }
    async getSearchEntities(_request, response) {
        const entityProviders = this.container.collectBestProvidersFor({
            type: 'service',
            allProvidersFromChildContainers: true,
        })
            .filter(p => !!p._provider.forEntity);
        const entitiesData = [];
        await Promise.all(entityProviders.map(async (provider) => {
            const entityName = provider._provider.forEntity;
            try {
                const service = provider._container.resolve(provider._provider.provide);
                if (!service) {
                    throw new Error(`Service not found for entity ${entityName}`);
                }
                const searchEnabled = service.isSearchEnabled();
                let indexExists = false;
                let indexName = '';
                if (searchEnabled) {
                    const searchService = service.getSearchService();
                    if (searchService) {
                        const config = await searchService.getSearchIndexConfig();
                        indexName = config.indexName;
                        indexExists = await searchService.getEngine().indexExists(indexName);
                    }
                }
                entitiesData.push({
                    entityName,
                    searchEnabled,
                    indexExists,
                    indexName,
                });
            }
            catch (error) {
                entitiesData.push({
                    entityName,
                    searchEnabled: false,
                    error: error.message,
                });
            }
        }));
        return response.json({ entities: entitiesData });
    }
    async getSingleDocument(req, res) {
        const { entityName, documentId } = req.pathParameters;
        const entityService = this.getEntityService(entityName);
        const searchService = this.getEntitySearchService(entityName);
        const primaryIdFieldName = entityService.getEntityPrimaryIdPropertyName();
        const doc = await searchService.getDocument(documentId);
        doc['id'] = doc['id'] || doc[primaryIdFieldName];
        doc['fullRecord'] = { ...doc };
        doc['entityName'] = entityName;
        return res.json(doc);
    }
    async getEntityRecords(req, res, ctx) {
        const { entityName } = req.pathParameters ?? {};
        const entityService = this.getEntityService(entityName);
        const query = (0, utils_1.deepCopy)(req.queryStringParameters);
        const parsedQuery = (0, search_utils_1.parseSearchQuery)(query);
        const { select: _select, ...restQueryParams } = parsedQuery;
        const results = await entityService.search(restQueryParams, ctx);
        const { hits, ...rest } = results;
        // Get the entity's primary identifier field name
        const primaryIdFieldName = entityService.getEntityPrimaryIdPropertyName();
        // Ensure all records have a consistent 'id' field for generic UI listing
        const normalizedHits = hits.map((hit) => {
            const normalizedHit = { ...hit };
            normalizedHit['entityName'] = entityName;
            normalizedHit['fullRecord'] = hit;
            // If the record doesn't have an 'id' field but has the primary identifier field,
            // map it to 'id' for consistent generic listing
            if (!normalizedHit.id && primaryIdFieldName && normalizedHit[primaryIdFieldName]) {
                normalizedHit.id = normalizedHit[primaryIdFieldName];
            }
            // If still no id field, try common identifier patterns
            if (!normalizedHit.id) {
                const idFields = [`${entityName}Id`, `${entityName.toLowerCase()}Id`];
                for (const idField of idFields) {
                    if (normalizedHit[idField]) {
                        normalizedHit.id = normalizedHit[idField];
                        break;
                    }
                }
            }
            return normalizedHit;
        });
        const response = {
            ...rest,
            items: normalizedHits,
        };
        if (req.debugMode) {
            Object.assign(response, {
                inputQuery: query,
                processingTimeMs: results.processingTimeMs,
                primaryIdFieldName
            });
        }
        return res.json(response);
    }
    async initSearchIndices(req, res) {
        const { entities: requestedEntities = [] } = req.body || {};
        // collect provider for entity-services from container-hierarchy
        const entityProviders = this.container.collectBestProvidersFor({
            type: 'service',
            allProvidersFromChildContainers: true,
        })
            .filter(p => (
        // filter out providers that do not have a forEntity property
        !!p._provider.forEntity
            && (
            // if no entities are requested, include all entities
            !requestedEntities?.length
                // if entities are requested, include only the requested entities
                || requestedEntities.includes(p._provider.forEntity))));
        const results = [];
        await Promise.all(entityProviders.map(async (provider) => {
            const entityName = provider._provider.forEntity;
            try {
                const service = provider._container.resolve(provider._provider.provide);
                if (!service) {
                    throw new Error(`EntityService could not be resolved for entity ${entityName}`);
                }
                // Check if search is enabled before attempting to initialize
                if (!service.isSearchEnabled()) {
                    results.push({
                        entityName,
                        success: false,
                        message: `Search is not enabled for entity ${entityName}`,
                    });
                    return;
                }
                const searchService = service.getSearchService();
                if (!searchService) {
                    throw new Error(`Search service not found for entity ${entityName}`);
                }
                await searchService.initSearchIndex();
                const config = await searchService.getSearchIndexConfig();
                results.push({
                    entityName,
                    indexName: config.indexName,
                    indexConfig: config,
                    success: true,
                    message: `Index ${config.indexName} initialized successfully`,
                });
            }
            catch (error) {
                results.push({
                    entityName,
                    error: error,
                    success: false,
                    message: `Error initializing index for entity ${entityName}: ${error.message}`,
                });
            }
        }));
        return res.json({ results });
    }
    async getIndexSettings(req, res) {
        const { entityName } = req.pathParameters ?? {};
        const searchService = this.getEntitySearchService(entityName);
        // Get current settings from the search engine
        const currentSettings = await searchService.getIndexSettings();
        // Get auto-generated settings from entity schema
        const searchConfig = searchService.getSearchIndexConfig();
        const schemaSettings = searchConfig.settings || {};
        // Calculate deep diff
        const { diff, hasDifferences } = this.calculateSettingsDiff(currentSettings, schemaSettings);
        // Build informative status message
        let status = '✓ Index settings match entity schema';
        if (hasDifferences) {
            const summary = [];
            for (const [field, fieldDiff] of Object.entries(diff)) {
                if (fieldDiff.status === 'different' && fieldDiff.type === 'array') {
                    const added = fieldDiff.added?.length || 0;
                    const removed = fieldDiff.removed?.length || 0;
                    if (added > 0)
                        summary.push(`${added} new in schema (${field})`);
                    if (removed > 0)
                        summary.push(`${removed} only in index (${field})`);
                }
            }
            status = summary.length > 0
                ? `ℹ️ Differences found: ${summary.join(', ')}`
                : 'ℹ️ Settings differ from schema';
        }
        return res.json({
            settings: currentSettings,
            schemaSettings,
            diff,
            hasDifferences,
            status,
        });
    }
    /**
     * Deep normalize any value for consistent comparison
     * Recursively sorts object keys and handles arrays/primitives
     */
    deepNormalize(value) {
        // Handle primitives and null/undefined
        if (value === null || value === undefined || typeof value !== 'object') {
            return JSON.stringify(value);
        }
        // Handle arrays - recursively normalize each item
        if (Array.isArray(value)) {
            // Parse back each normalized string to avoid double stringification
            const normalizedArray = value.map(item => JSON.parse(this.deepNormalize(item)));
            return JSON.stringify(normalizedArray);
        }
        // Handle objects - sort keys and recursively normalize values
        const sortedKeys = Object.keys(value).sort();
        const normalizedObj = {};
        for (const key of sortedKeys) {
            // Parse back the normalized string for nested structures
            try {
                normalizedObj[key] = JSON.parse(this.deepNormalize(value[key]));
            }
            catch {
                normalizedObj[key] = value[key];
            }
        }
        return JSON.stringify(normalizedObj);
    }
    /**
     * Calculate diff between current index settings and schema-derived settings
     * Only compares fields that exist in schema settings (framework-managed fields)
     */
    calculateSettingsDiff(current, schema) {
        const diff = {};
        let hasDifferences = false;
        // ONLY compare fields that exist in schema settings (framework-managed)
        // Typically: searchableAttributes, filterableAttributes, sortableAttributes
        const fieldsToCompare = Object.keys(schema || {});
        for (const field of fieldsToCompare) {
            const currentValue = current[field];
            const schemaValue = schema[field];
            // Array comparison (most common case for our managed fields)
            if (Array.isArray(schemaValue)) {
                const currArr = Array.isArray(currentValue) ? currentValue : [];
                const schemaArr = schemaValue;
                // Use deep normalized comparison for array items
                const currNormalizedSet = new Set(currArr.map((item) => this.deepNormalize(item)));
                const schemaNormalizedSet = new Set(schemaArr.map((item) => this.deepNormalize(item)));
                const added = schemaArr.filter((item) => !currNormalizedSet.has(this.deepNormalize(item)));
                const removed = currArr.filter((item) => !schemaNormalizedSet.has(this.deepNormalize(item)));
                const isDifferent = added.length > 0 || removed.length > 0;
                if (isDifferent)
                    hasDifferences = true;
                // Only include detailed breakdown if there ARE differences
                if (isDifferent) {
                    diff[field] = {
                        type: 'array',
                        added,
                        removed,
                        status: 'different'
                    };
                }
                else {
                    // Concise for "same" status
                    diff[field] = {
                        type: 'array',
                        status: 'same'
                    };
                }
            }
            else if (schemaValue !== null && typeof schemaValue === 'object') {
                // Object comparison using deep normalization
                const currentNormalized = this.deepNormalize(currentValue);
                const schemaNormalized = this.deepNormalize(schemaValue);
                const isDifferent = currentNormalized !== schemaNormalized;
                if (isDifferent)
                    hasDifferences = true;
                diff[field] = {
                    type: 'object',
                    current: currentValue,
                    schema: schemaValue,
                    status: isDifferent ? 'different' : 'same'
                };
            }
            else {
                // Scalar comparison (string, number, boolean, null, undefined)
                const isDifferent = currentValue !== schemaValue;
                if (isDifferent)
                    hasDifferences = true;
                diff[field] = {
                    type: 'scalar',
                    current: currentValue,
                    schema: schemaValue,
                    status: isDifferent ? 'different' : 'same'
                };
            }
        }
        return { diff, hasDifferences };
    }
    async updateIndexSettings(req, res) {
        const { entityName } = req.pathParameters ?? {};
        const { settings } = req.body || {};
        const searchService = this.getEntitySearchService(entityName);
        const result = await searchService.updateIndexSettings(settings, true);
        return res.json({
            result,
            entityName,
            success: true,
            message: 'Index settings updated successfully',
        });
    }
    async resetIndexSettings(req, res) {
        const { entityName } = req.pathParameters ?? {};
        const searchService = this.getEntitySearchService(entityName);
        await searchService.resetIndexSettings();
        return res.json({
            success: true,
            entityName,
            message: 'Index settings reset to Meilisearch defaults'
        });
    }
    async applyDefaultSettings(req, res) {
        const { entityName } = req.pathParameters ?? {};
        const searchService = this.getEntitySearchService(entityName);
        // Get schema-derived settings
        const searchConfig = searchService.getSearchIndexConfig();
        const schemaSettings = searchConfig.settings || {};
        // Apply the schema-derived settings
        await searchService.updateIndexSettings(schemaSettings, true);
        return res.json({
            success: true,
            entityName,
            appliedSettings: schemaSettings,
            message: 'Index settings synced successfully from entity schema'
        });
    }
    async initSingleEntityIndex(req, res) {
        const { entityName } = req.pathParameters ?? {};
        const entityService = this.getEntityService(entityName);
        if (!entityService.isSearchEnabled()) {
            return res.status(400).json({
                success: false,
                entityName,
                message: `Search is not enabled for entity ${entityName}`,
            });
        }
        const searchService = this.getEntitySearchService(entityName);
        await searchService.initSearchIndex();
        const config = await searchService.getSearchIndexConfig();
        return res.json({
            success: true,
            entityName,
            indexName: config.indexName,
            config,
            message: `Index ${config.indexName} initialized successfully`,
        });
    }
    async recreateIndex(req, res) {
        const { entityName } = req.pathParameters ?? {};
        const { resyncDocuments = false, syncMethod = 'direct', batchSize = 50, queueUrl } = req.body || {};
        const searchService = this.getEntitySearchService(entityName);
        const oldConfig = await searchService.getSearchIndexConfig();
        this.logger.info(`Recreating index for entity ${entityName}`, { oldConfig });
        // Delete existing index
        this.logger.info(`Deleting existing index: ${oldConfig.indexName}`);
        try {
            await searchService.deleteSearchIndex(true);
        }
        catch (error) {
            this.logger.warn(`Could not delete index (might not exist): ${error.message}`);
        }
        // Reinitialize index with new configuration
        this.logger.info(`Reinitializing index for entity ${entityName}`);
        await searchService.initSearchIndex();
        const newConfig = await searchService.getSearchIndexConfig();
        let resyncResult = null;
        // Optionally resync all documents
        if (resyncDocuments) {
            if (syncMethod === 'queue') {
                // Queue-based sync (non-blocking, for large datasets)
                this.logger.info(`Queueing documents for resync: ${entityName}`);
                resyncResult = await this.queueDocumentsForResync(entityName, { batchSize, queueUrl });
            }
            else {
                // Direct sync (blocking, immediate confirmation)
                this.logger.info(`Directly resyncing documents: ${entityName}`);
                resyncResult = await searchService.resyncAllDocuments({ batchSize });
            }
        }
        return res.json({
            success: true,
            entityName,
            oldIndexName: oldConfig.indexName,
            newIndexName: newConfig.indexName,
            syncMethod: resyncDocuments ? syncMethod : null,
            message: `Index recreated successfully${resyncDocuments ? ` (${syncMethod} sync: ${resyncResult?.processedCount || 0} documents)` : ''}`,
            resyncResult,
            configs: { oldConfig, newConfig }
        });
    }
    async deleteIndex(req, res) {
        const { entityName } = req.pathParameters;
        const searchService = this.getEntitySearchService(entityName);
        await searchService.deleteSearchIndex(true);
        return res.json({
            success: true,
            entityName,
            message: 'Index deleted successfully'
        });
    }
    async clearEntityIndex(req, res) {
        const { entityName } = req.pathParameters ?? {};
        const searchService = this.getEntitySearchService(entityName);
        const config = searchService.getSearchIndexConfig();
        await searchService.getEngine().deleteAllDocuments(config.indexName, true);
        return res.json({
            success: true,
            entityName,
            indexName: config.indexName,
            message: 'All documents cleared from index'
        });
    }
    async resyncEntityRecords(req, res) {
        const { entityName } = req.pathParameters ?? {};
        const { batchSize = 50, queueUrl, byBatch = true } = req.body || {};
        const result = await this.queueDocumentsForResync(entityName, { batchSize, queueUrl, byBatch });
        let message = `Queued ${result.processedCount} records for re-indexing`;
        if (result.failedCount > 0) {
            message += `, ${result.failedCount} records failed to be queued`;
        }
        return res.json({
            message,
            success: result.processedCount > 0,
            entityName,
            ...result,
        });
    }
    /**
     * Queue documents for async resync via SQS
     * Shared logic used by resync and recreate endpoints
     */
    async queueDocumentsForResync(entityName, options) {
        const { batchSize = 50, queueUrl, byBatch = true } = options;
        const entityService = this.getEntityService(entityName);
        // Use provided queueUrl or resolve from environment
        const queueName = (0, utils_1.resolveEnvValueFor)({ key: SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME });
        const resolvedQueueUrl = queueUrl || client_1.Environment.queueUrl(queueName);
        if (!resolvedQueueUrl) {
            throw new Error(`Queue URL not provided and env-key [${SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME}] is not configured`);
        }
        let failedCount = 0;
        let processedCount = 0;
        let cursor = 'init';
        let iterationCount = 0;
        const maxIterations = 100000;
        while (!!cursor && iterationCount < maxIterations) {
            iterationCount++;
            this.logger.info(`Fetching ${entityName} records from cursor: ${cursor}`);
            const queryResult = await entityService.query({
                pagination: {
                    limit: batchSize,
                    cursor: cursor === 'init' ? undefined : cursor
                }
            });
            if (!queryResult.data || queryResult.data.length === 0) {
                break;
            }
            if (byBatch) {
                const data = await Promise.all(queryResult.data.map(async (rec) => {
                    return await entityService.transformDocumentForIndexing(rec);
                }));
                try {
                    await (0, sqs_1.sendQueueMessage)(resolvedQueueUrl, {
                        data,
                        eventName: "RESYNC",
                        entityName,
                    });
                    processedCount += data.length;
                }
                catch (error) {
                    this.logger.error(`Error queueing batch for sync: ${error.message}`, { entityName, batchSize, error });
                    failedCount += data.length;
                }
            }
            else {
                await Promise.all(queryResult.data.map(async (entityRecord) => {
                    try {
                        const transformed = await entityService.transformDocumentForIndexing(entityRecord);
                        await (0, sqs_1.sendQueueMessage)(resolvedQueueUrl, {
                            data: transformed,
                            eventName: "RESYNC",
                            entityName,
                        });
                        processedCount++;
                    }
                    catch (error) {
                        this.logger.error(`Error queueing record for sync: ${error.message}`, { entityName, error });
                        failedCount++;
                    }
                }));
            }
            cursor = queryResult.cursor ?? undefined;
        }
        this.logger.info(`Queue sync completed for ${entityName}`, {
            processedCount,
            failedCount,
            totalIterations: iterationCount
        });
        return {
            processedCount,
            failedCount,
            totalIterations: iterationCount,
        };
    }
    async getQueueInfo(req, res) {
        const { queueUrl } = req.queryStringParameters;
        // Use provided queueUrl or resolve from environment
        const queueName = (0, utils_1.resolveEnvValueFor)({ key: SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME });
        const resolvedQueueUrl = queueUrl || client_1.Environment.queueUrl(queueName);
        const info = await (0, sqs_1.getQueueMessageMetadata)(resolvedQueueUrl);
        return res.json({ info });
    }
    async updateDocuments(req, res) {
        const { entityName } = req.pathParameters;
        const { documents } = req.body;
        const searchService = this.getEntitySearchService(entityName);
        const result = await searchService.updateDocuments(documents, true);
        return res.json({
            result,
            entityName,
            success: true,
            message: 'Documents updated successfully',
        });
    }
    async deleteDocumentsByIds(req, res) {
        const { entityName } = req.pathParameters;
        const { ids } = req.body;
        const searchService = this.getEntitySearchService(entityName);
        const config = await searchService.getSearchIndexConfig();
        await searchService.getEngine().deleteDocuments(ids, config.indexName, true);
        return res.json({
            success: true,
            entityName,
            indexName: config.indexName,
            message: 'Documents deleted successfully'
        });
    }
    async deleteDocumentsByFilter(req, res) {
        const { entityName } = req.pathParameters;
        const { filter } = req.body;
        const searchService = this.getEntitySearchService(entityName);
        const config = await searchService.getSearchIndexConfig();
        await searchService.deleteDocumentsByFilter(filter, true);
        return res.json({
            success: true,
            entityName,
            indexName: config.indexName,
            message: 'Documents matching filter have been queued for deletion.'
        });
    }
    getEntityService(entityName) {
        const provider = this.container.collectBestProvidersFor({
            type: 'service',
            allProvidersFromChildContainers: true,
            forEntity: entityName,
        });
        if (provider.length === 0) {
            throw new Error(`No provider found for entity-service for ${entityName}`);
        }
        return provider[0]._container.resolve(provider[0]._provider.provide);
    }
    getEntitySearchService(entityName) {
        const entityService = this.getEntityService(entityName);
        const searchService = entityService.getSearchService();
        if (!searchService) {
            throw new Error(`Search service not found for entity ${entityName}`);
        }
        return searchService;
    }
};
exports.SearchSystemController = SearchSystemController;
__decorate([
    (0, decorators_1.Get)('/indices')
], SearchSystemController.prototype, "listIndices", null);
__decorate([
    (0, decorators_1.Get)('/indices/{entityName}', {})
], SearchSystemController.prototype, "getIndexDetails", null);
__decorate([
    (0, decorators_1.Get)('/entities')
], SearchSystemController.prototype, "getSearchEntities", null);
__decorate([
    (0, decorators_1.Get)('/records/{entityName}/{documentId}')
], SearchSystemController.prototype, "getSingleDocument", null);
__decorate([
    (0, decorators_1.Get)('/records/{entityName}')
], SearchSystemController.prototype, "getEntityRecords", null);
__decorate([
    (0, decorators_1.Post)('/initIndices')
], SearchSystemController.prototype, "initSearchIndices", null);
__decorate([
    (0, decorators_1.Get)('/indices/{entityName}/settings')
], SearchSystemController.prototype, "getIndexSettings", null);
__decorate([
    (0, decorators_1.Put)('/indices/{entityName}/settings', {
        validations: {
            body: {
                settings: { datatype: 'object', required: true },
            },
        },
    })
], SearchSystemController.prototype, "updateIndexSettings", null);
__decorate([
    (0, decorators_1.Post)('/indices/{entityName}/reset-settings')
], SearchSystemController.prototype, "resetIndexSettings", null);
__decorate([
    (0, decorators_1.Post)('/indices/{entityName}/apply-default-settings')
], SearchSystemController.prototype, "applyDefaultSettings", null);
__decorate([
    (0, decorators_1.Post)('/indices/{entityName}/init')
], SearchSystemController.prototype, "initSingleEntityIndex", null);
__decorate([
    (0, decorators_1.Post)('/indices/{entityName}/recreate')
], SearchSystemController.prototype, "recreateIndex", null);
__decorate([
    (0, decorators_1.Delete)('/indices/{entityName}')
], SearchSystemController.prototype, "deleteIndex", null);
__decorate([
    (0, decorators_1.Delete)('/indices/{entityName}/documents')
], SearchSystemController.prototype, "clearEntityIndex", null);
__decorate([
    (0, decorators_1.Post)('/indices/{entityName}/resync')
], SearchSystemController.prototype, "resyncEntityRecords", null);
__decorate([
    (0, decorators_1.Get)('/queue-info')
], SearchSystemController.prototype, "getQueueInfo", null);
__decorate([
    (0, decorators_1.Put)('/records/{entityName}', {
        validations: {
            body: {
                documents: { datatype: 'array', required: true },
            },
        },
    })
], SearchSystemController.prototype, "updateDocuments", null);
__decorate([
    (0, decorators_1.Delete)('/records/{entityName}/by-ids', {
        validations: {
            body: {
                ids: { datatype: 'array', required: true },
            },
        },
    })
], SearchSystemController.prototype, "deleteDocumentsByIds", null);
__decorate([
    (0, decorators_1.Delete)('/records/{entityName}/by-filter', {
        validations: {
            body: {
                filter: { datatype: 'object', required: true },
            },
        },
    })
], SearchSystemController.prototype, "deleteDocumentsByFilter", null);
exports.SearchSystemController = SearchSystemController = __decorate([
    (0, decorators_1.Controller)('system/search', {
        env: [{
                name: SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME,
            }],
    }),
    __param(0, (0, di_1.InjectContainer)())
], SearchSystemController);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9zZWFyY2gtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFFQSwwQ0FBNkU7QUFDN0Usc0ZBQTBFO0FBRTFFLGlEQUFzRTtBQUN0RSxpQ0FBMkM7QUFHM0MsdUNBQTJEO0FBQzNELGtEQUFtRDtBQUNuRCx5Q0FBMkM7QUFFM0MsSUFBWSwwQkFFWDtBQUZELFdBQVksMEJBQTBCO0lBQ3BDLHlGQUEyRCxDQUFBO0FBQzdELENBQUMsRUFGVywwQkFBMEIsMENBQTFCLDBCQUEwQixRQUVyQztBQU9NLElBQU0sc0JBQXNCLEdBQTVCLE1BQU0sc0JBQXVCLFNBQVEsc0NBQWE7SUFDZDtJQUF6QyxZQUF5QyxTQUF1QjtRQUM5RCxLQUFLLEVBQUUsQ0FBQztRQUQrQixjQUFTLEdBQVQsU0FBUyxDQUFjO0lBRWhFLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQTRCLEVBQUUsUUFBaUIsSUFBSSxDQUFDO0lBRy9ELEFBQU4sS0FBSyxDQUFDLFdBQVcsQ0FBQyxRQUFpQixFQUFFLFFBQWtCO1FBQ3JELDZDQUE2QztRQUM3QyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDO1lBQzdELElBQUksRUFBRSxTQUFTO1lBQ2YsK0JBQStCLEVBQUUsSUFBSTtTQUN0QyxDQUFDO2FBQ0MsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFO1lBQ1YsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUE7UUFDaEMsQ0FBQyxDQUFDLENBQUM7UUFFTCxNQUFNLFdBQVcsR0FBVSxFQUFFLENBQUM7UUFFOUIsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLFFBQVEsRUFBRSxFQUFFO1lB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QVNLO0lBUEwsSUFBQSxnQkFBRyxFQUFDLHVCQUF1QixFQUFFO1FBQzVCLFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRTtnQkFDSixTQUFTLEVBQUUsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUU7YUFDakQ7U0FDRjtLQUNGLENBQUM7NkRBa0JEO0FBU0s7SUFQTCxJQUFBLG1CQUFNLEVBQUMsOEJBQThCLEVBQUU7UUFDdEMsV0FBVyxFQUFFO1lBQ1gsSUFBSSxFQUFFO2dCQUNKLEdBQUcsRUFBRSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRTthQUMzQztTQUNGO0tBQ0YsQ0FBQztrRUFvQkQ7QUFTSztJQVBMLElBQUEsbUJBQU0sRUFBQyxpQ0FBaUMsRUFBRTtRQUN6QyxXQUFXLEVBQUU7WUFDWCxJQUFJLEVBQUU7Z0JBQ0osTUFBTSxFQUFFLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFO2FBQy9DO1NBQ0Y7S0FDRixDQUFDO3FFQXFCRDtpQ0E1NEJVLHNCQUFzQjtJQUxsQyxJQUFBLHVCQUFVLEVBQUMsZUFBZSxFQUFFO1FBQzNCLEdBQUcsRUFBRSxDQUFFO2dCQUNMLElBQUksRUFBRSwwQkFBMEIsQ0FBQywyQkFBMkI7YUFDN0QsQ0FBRTtLQUNKLENBQUM7SUFFYSxXQUFBLElBQUEsb0JBQWUsR0FBRSxDQUFBO0dBRG5CLHNCQUFzQixDQXM2QmxDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBBUElHYXRld2F5UHJveHlFdmVudCwgQ29udGV4dCB9IGZyb20gXCJhd3MtbGFtYmRhXCI7XG5cbmltcG9ydCB7IGdldFF1ZXVlTWVzc2FnZU1ldGFkYXRhLCBzZW5kUXVldWVNZXNzYWdlIH0gZnJvbSBcIi4uLy4uL2NsaWVudC9zcXNcIjtcbmltcG9ydCB7IEFQSUNvbnRyb2xsZXIgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlcic7XG5pbXBvcnQgdHlwZSB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tIFwiLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dFwiO1xuaW1wb3J0IHsgQ29udHJvbGxlciwgRGVsZXRlLCBHZXQsIFBvc3QsIFB1dCB9IGZyb20gJy4uLy4uL2RlY29yYXRvcnMnO1xuaW1wb3J0IHsgSW5qZWN0Q29udGFpbmVyIH0gZnJvbSAnLi4vLi4vZGknO1xuaW1wb3J0IHsgdHlwZSBCYXNlRW50aXR5U2VydmljZSB9IGZyb20gJy4uLy4uL2VudGl0eSc7XG5pbXBvcnQgeyB0eXBlIElESUNvbnRhaW5lciwgdHlwZSBSZXF1ZXN0LCB0eXBlIFJlc3BvbnNlIH0gZnJvbSAnLi4vLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBkZWVwQ29weSwgcmVzb2x2ZUVudlZhbHVlRm9yIH0gZnJvbSAnLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgcGFyc2VTZWFyY2hRdWVyeSB9IGZyb20gXCIuLi9zZWFyY2gtdXRpbHNcIjtcbmltcG9ydCB7IEVudmlyb25tZW50IH0gZnJvbSBcIi4uLy4uL2NsaWVudFwiO1xuXG5leHBvcnQgZW51bSBTRUFSQ0hfQ09OVFJPTExFUl9FTlZfS0VZUyB7XG4gIE1FSUxJU0VBUkNIX1NZTkNfUVVFVUVfTkFNRSA9ICdNRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUnLFxufVxuXG5AQ29udHJvbGxlcignc3lzdGVtL3NlYXJjaCcsIHtcbiAgZW52OiBbIHtcbiAgICBuYW1lOiBTRUFSQ0hfQ09OVFJPTExFUl9FTlZfS0VZUy5NRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUsXG4gIH0gXSxcbn0pXG5leHBvcnQgY2xhc3MgU2VhcmNoU3lzdGVtQ29udHJvbGxlciBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICBjb25zdHJ1Y3RvcihASW5qZWN0Q29udGFpbmVyKCkgcHJvdGVjdGVkIGNvbnRhaW5lcjogSURJQ29udGFpbmVyKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpIHsgfVxuXG4gIEBHZXQoJy9pbmRpY2VzJylcbiAgYXN5bmMgbGlzdEluZGljZXMoX3JlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSkge1xuICAgIC8vIEF1dG8tZGlzY292ZXIgZW50aXRpZXMgd2l0aCBzZWFyY2ggZW5hYmxlZFxuICAgIGNvbnN0IGVudGl0eVByb3ZpZGVycyA9IHRoaXMuY29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWUsXG4gICAgfSlcbiAgICAgIC5maWx0ZXIocCA9PiB7XG4gICAgICAgIHJldHVybiAhIXAuX3Byb3ZpZGVyLmZvckVudGl0eVxuICAgICAgfSk7XG5cbiAgICBjb25zdCBpbmRpY2VzRGF0YTogYW55W10gPSBbXTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKGVudGl0eVByb3ZpZGVycy5tYXAoYXN5bmMgKHByb3ZpZGVyKSA9PiB7XG5cbiAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSBwcm92aWRlci5fcHJvdmlkZXIuZm9yRW50aXR5IGFzIHN0cmluZztcblxuICAgICAgdHJ5IHtcblxuICAgICAgICAvLyB1c2UgcHJvdmlkZXIncyBjb250YWluZXIgIHRvIHJlc29sdmUgdGhlIHNlcnZpY2VcbiAgICAgICAgY29uc3Qgc2VydmljZSA9IHByb3ZpZGVyLl9jb250YWluZXIucmVzb2x2ZTxCYXNlRW50aXR5U2VydmljZTxhbnk+PihcbiAgICAgICAgICBwcm92aWRlci5fcHJvdmlkZXIucHJvdmlkZVxuICAgICAgICApO1xuXG4gICAgICAgIGlmICghc2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VydmljZSAke1N0cmluZyhwcm92aWRlci5fcHJvdmlkZXIucHJvdmlkZSl9IG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSBzZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgaWYgKCFzZWFyY2hTZXJ2aWNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggc2VydmljZSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpbmRleEluZm8gPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEluZGV4SW5mbygpO1xuXG4gICAgICAgIGluZGljZXNEYXRhLnB1c2goe1xuICAgICAgICAgIC4uLmluZGV4SW5mbyxcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIGluZGV4TmFtZTogaW5kZXhJbmZvLnVpZCxcbiAgICAgICAgfSk7XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcblxuICAgICAgICBpbmRpY2VzRGF0YS5wdXNoKHtcbiAgICAgICAgICBpbmRleE5hbWU6IGBbJHtlbnRpdHlOYW1lfV0taW5kZXgtbmFtZS1ub3QtcmVzb2x2ZWRgLFxuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGVycm9yKTtcbiAgICAgIH1cbiAgICB9KSk7XG5cbiAgICByZXR1cm4gcmVzcG9uc2UuanNvbih7IGluZGljZXM6IGluZGljZXNEYXRhIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBuZXcgYXBpIHRvIGdldCBpbmRleCBkZXRhaWxzXG4gICAqIFxuICAgKi9cblxuICBAR2V0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0nLCB7fSlcbiAgYXN5bmMgZ2V0SW5kZXhEZXRhaWxzKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBjb25zdCBpbmRleEluZm8gPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEluZGV4SW5mbygpO1xuICAgIGNvbnN0IGluZGV4U3RhdHMgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEluZGV4U3RhdHMoKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBkZXRhaWxzOiB7XG4gICAgICAgIGluZGV4SW5mbyxcbiAgICAgICAgaW5kZXhTdGF0cyxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIEBHZXQoJy9lbnRpdGllcycpXG4gIGFzeW5jIGdldFNlYXJjaEVudGl0aWVzKF9yZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBlbnRpdHlQcm92aWRlcnMgPSB0aGlzLmNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlLFxuICAgIH0pXG4gICAgICAuZmlsdGVyKHAgPT4gISFwLl9wcm92aWRlci5mb3JFbnRpdHkpO1xuXG4gICAgY29uc3QgZW50aXRpZXNEYXRhOiB7XG4gICAgICBlbnRpdHlOYW1lOiBzdHJpbmc7XG4gICAgICBzZWFyY2hFbmFibGVkOiBib29sZWFuO1xuICAgICAgaW5kZXhFeGlzdHM/OiBib29sZWFuO1xuICAgICAgaW5kZXhOYW1lPzogc3RyaW5nO1xuICAgICAgZXJyb3I/OiBzdHJpbmc7XG4gICAgfVtdID0gW107XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChlbnRpdHlQcm92aWRlcnMubWFwKGFzeW5jIChwcm92aWRlcikgPT4ge1xuICAgICAgY29uc3QgZW50aXR5TmFtZSA9IHByb3ZpZGVyLl9wcm92aWRlci5mb3JFbnRpdHkgYXMgc3RyaW5nO1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBzZXJ2aWNlID0gcHJvdmlkZXIuX2NvbnRhaW5lci5yZXNvbHZlPEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KFxuICAgICAgICAgIHByb3ZpZGVyLl9wcm92aWRlci5wcm92aWRlXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKCFzZXJ2aWNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZXJ2aWNlIG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlYXJjaEVuYWJsZWQgPSBzZXJ2aWNlLmlzU2VhcmNoRW5hYmxlZCgpO1xuICAgICAgICBsZXQgaW5kZXhFeGlzdHMgPSBmYWxzZTtcbiAgICAgICAgbGV0IGluZGV4TmFtZSA9ICcnO1xuXG4gICAgICAgIGlmIChzZWFyY2hFbmFibGVkKSB7XG4gICAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICAgIGlmIChzZWFyY2hTZXJ2aWNlKSB7XG4gICAgICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgICAgICAgICBpbmRleE5hbWUgPSBjb25maWcuaW5kZXhOYW1lITtcbiAgICAgICAgICAgIGluZGV4RXhpc3RzID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRFbmdpbmUoKS5pbmRleEV4aXN0cyhpbmRleE5hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGVudGl0aWVzRGF0YS5wdXNoKHtcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIHNlYXJjaEVuYWJsZWQsXG4gICAgICAgICAgaW5kZXhFeGlzdHMsXG4gICAgICAgICAgaW5kZXhOYW1lLFxuICAgICAgICB9KTtcblxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICBlbnRpdGllc0RhdGEucHVzaCh7XG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBzZWFyY2hFbmFibGVkOiBmYWxzZSxcbiAgICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHJlc3BvbnNlLmpzb24oeyBlbnRpdGllczogZW50aXRpZXNEYXRhIH0pO1xuICB9XG5cbiAgQEdldCgnL3JlY29yZHMve2VudGl0eU5hbWV9L3tkb2N1bWVudElkfScpXG4gIGFzeW5jIGdldFNpbmdsZURvY3VtZW50KFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nLCBkb2N1bWVudElkOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZG9jdW1lbnRJZCB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBwcmltYXJ5SWRGaWVsZE5hbWUgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuICAgIFxuICAgIGNvbnN0IGRvYyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RG9jdW1lbnQoZG9jdW1lbnRJZCk7XG5cbiAgICBkb2NbICdpZCcgXSA9IGRvY1sgJ2lkJyBdIHx8IGRvY1sgcHJpbWFyeUlkRmllbGROYW1lIGFzIHN0cmluZyBdO1xuICAgIGRvY1sgJ2Z1bGxSZWNvcmQnIF0gPSB7IC4uLmRvYyB9O1xuICAgIGRvY1sgJ2VudGl0eU5hbWUnIF0gPSBlbnRpdHlOYW1lO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKGRvYyk7XG4gIH1cblxuICBAR2V0KCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0nKVxuICBhc3luYyBnZXRFbnRpdHlSZWNvcmRzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzPzogUmVjb3JkPHN0cmluZywgYW55PlxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2UsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dFxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3QgZW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBxdWVyeSA9IGRlZXBDb3B5KHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnMpO1xuXG4gICAgY29uc3QgcGFyc2VkUXVlcnkgPSBwYXJzZVNlYXJjaFF1ZXJ5KHF1ZXJ5KTtcbiAgICBjb25zdCB7IHNlbGVjdDogX3NlbGVjdCwgLi4ucmVzdFF1ZXJ5UGFyYW1zIH0gPSBwYXJzZWRRdWVyeTtcblxuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnNlYXJjaChyZXN0UXVlcnlQYXJhbXMsIGN0eCk7XG5cbiAgICBjb25zdCB7IGhpdHMsIC4uLnJlc3QgfSA9IHJlc3VsdHM7XG4gICAgXG4gICAgLy8gR2V0IHRoZSBlbnRpdHkncyBwcmltYXJ5IGlkZW50aWZpZXIgZmllbGQgbmFtZVxuICAgIGNvbnN0IHByaW1hcnlJZEZpZWxkTmFtZSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG4gICAgXG4gICAgLy8gRW5zdXJlIGFsbCByZWNvcmRzIGhhdmUgYSBjb25zaXN0ZW50ICdpZCcgZmllbGQgZm9yIGdlbmVyaWMgVUkgbGlzdGluZ1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRIaXRzID0gaGl0cy5tYXAoKGhpdDogYW55KSA9PiB7XG4gICAgICBjb25zdCBub3JtYWxpemVkSGl0ID0geyAuLi5oaXQgfTtcblxuICAgICAgbm9ybWFsaXplZEhpdFsgJ2VudGl0eU5hbWUnIF0gPSBlbnRpdHlOYW1lO1xuICAgICAgbm9ybWFsaXplZEhpdFsgJ2Z1bGxSZWNvcmQnIF0gPSBoaXQ7XG4gICAgICBcbiAgICAgIC8vIElmIHRoZSByZWNvcmQgZG9lc24ndCBoYXZlIGFuICdpZCcgZmllbGQgYnV0IGhhcyB0aGUgcHJpbWFyeSBpZGVudGlmaWVyIGZpZWxkLFxuICAgICAgLy8gbWFwIGl0IHRvICdpZCcgZm9yIGNvbnNpc3RlbnQgZ2VuZXJpYyBsaXN0aW5nXG4gICAgICBpZiAoIW5vcm1hbGl6ZWRIaXQuaWQgJiYgcHJpbWFyeUlkRmllbGROYW1lICYmIG5vcm1hbGl6ZWRIaXRbIHByaW1hcnlJZEZpZWxkTmFtZSBdKSB7XG4gICAgICAgIG5vcm1hbGl6ZWRIaXQuaWQgPSBub3JtYWxpemVkSGl0WyBwcmltYXJ5SWRGaWVsZE5hbWUgXTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gSWYgc3RpbGwgbm8gaWQgZmllbGQsIHRyeSBjb21tb24gaWRlbnRpZmllciBwYXR0ZXJuc1xuICAgICAgaWYgKCFub3JtYWxpemVkSGl0LmlkKSB7XG4gICAgICAgIGNvbnN0IGlkRmllbGRzID0gWyBgJHtlbnRpdHlOYW1lfUlkYCwgYCR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfUlkYCBdO1xuICAgICAgICBmb3IgKGNvbnN0IGlkRmllbGQgb2YgaWRGaWVsZHMpIHtcbiAgICAgICAgICBpZiAobm9ybWFsaXplZEhpdFsgaWRGaWVsZCBdKSB7XG4gICAgICAgICAgICBub3JtYWxpemVkSGl0LmlkID0gbm9ybWFsaXplZEhpdFsgaWRGaWVsZCBdO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBcbiAgICAgIHJldHVybiBub3JtYWxpemVkSGl0O1xuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzcG9uc2UgPSB7XG4gICAgICAuLi5yZXN0LFxuICAgICAgaXRlbXM6IG5vcm1hbGl6ZWRIaXRzLFxuICAgIH07XG5cbiAgICBpZiAocmVxLmRlYnVnTW9kZSkge1xuICAgICAgT2JqZWN0LmFzc2lnbihyZXNwb25zZSwge1xuICAgICAgICBpbnB1dFF1ZXJ5OiBxdWVyeSxcbiAgICAgICAgcHJvY2Vzc2luZ1RpbWVNczogcmVzdWx0cy5wcm9jZXNzaW5nVGltZU1zLFxuICAgICAgICBwcmltYXJ5SWRGaWVsZE5hbWVcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiByZXMuanNvbihyZXNwb25zZSk7XG4gIH1cblxuICBAUG9zdCgnL2luaXRJbmRpY2VzJylcbiAgYXN5bmMgaW5pdFNlYXJjaEluZGljZXMoXG4gICAgcmVxOiBSZXF1ZXN0PHsgYm9keTogeyBlbnRpdGllcz86IHN0cmluZ1tdIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXRpZXM6IHJlcXVlc3RlZEVudGl0aWVzID0gW10gfSA9IHJlcS5ib2R5IHx8IHt9O1xuXG4gICAgLy8gY29sbGVjdCBwcm92aWRlciBmb3IgZW50aXR5LXNlcnZpY2VzIGZyb20gY29udGFpbmVyLWhpZXJhcmNoeVxuICAgIGNvbnN0IGVudGl0eVByb3ZpZGVycyA9IHRoaXMuY29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWUsXG4gICAgfSlcbiAgICAgIC5maWx0ZXIocCA9PiAoXG4gICAgICAgIC8vIGZpbHRlciBvdXQgcHJvdmlkZXJzIHRoYXQgZG8gbm90IGhhdmUgYSBmb3JFbnRpdHkgcHJvcGVydHlcbiAgICAgICAgISFwLl9wcm92aWRlci5mb3JFbnRpdHlcbiAgICAgICAgJiYgKFxuICAgICAgICAgIC8vIGlmIG5vIGVudGl0aWVzIGFyZSByZXF1ZXN0ZWQsIGluY2x1ZGUgYWxsIGVudGl0aWVzXG4gICAgICAgICAgIXJlcXVlc3RlZEVudGl0aWVzPy5sZW5ndGhcbiAgICAgICAgICAvLyBpZiBlbnRpdGllcyBhcmUgcmVxdWVzdGVkLCBpbmNsdWRlIG9ubHkgdGhlIHJlcXVlc3RlZCBlbnRpdGllc1xuICAgICAgICAgIHx8IHJlcXVlc3RlZEVudGl0aWVzLmluY2x1ZGVzKHAuX3Byb3ZpZGVyLmZvckVudGl0eSBhcyBzdHJpbmcpXG4gICAgICAgIClcbiAgICAgICkpO1xuXG4gICAgY29uc3QgcmVzdWx0czoge1xuICAgICAgZXJyb3I/OiBzdHJpbmc7XG4gICAgICBzdWNjZXNzOiBib29sZWFuO1xuICAgICAgbWVzc2FnZT86IHN0cmluZztcblxuICAgICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgICAgaW5kZXhOYW1lPzogc3RyaW5nO1xuICAgICAgaW5kZXhDb25maWc/OiBhbnk7XG4gICAgfVtdID0gW107XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChlbnRpdHlQcm92aWRlcnMubWFwKGFzeW5jIChwcm92aWRlcikgPT4ge1xuICAgICAgY29uc3QgZW50aXR5TmFtZSA9IHByb3ZpZGVyLl9wcm92aWRlci5mb3JFbnRpdHkgYXMgc3RyaW5nO1xuXG4gICAgICB0cnkge1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2UgPSBwcm92aWRlci5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oXG4gICAgICAgICAgcHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGVcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFzZXJ2aWNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbnRpdHlTZXJ2aWNlIGNvdWxkIG5vdCBiZSByZXNvbHZlZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIHNlYXJjaCBpcyBlbmFibGVkIGJlZm9yZSBhdHRlbXB0aW5nIHRvIGluaXRpYWxpemVcbiAgICAgICAgaWYgKCFzZXJ2aWNlLmlzU2VhcmNoRW5hYmxlZCgpKSB7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIG1lc3NhZ2U6IGBTZWFyY2ggaXMgbm90IGVuYWJsZWQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gc2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgIGlmICghc2VhcmNoU2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIHNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgc2VhcmNoU2VydmljZS5pbml0U2VhcmNoSW5kZXgoKTtcbiAgICAgICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuXG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICAgICAgaW5kZXhDb25maWc6IGNvbmZpZyxcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgIG1lc3NhZ2U6IGBJbmRleCAke2NvbmZpZy5pbmRleE5hbWV9IGluaXRpYWxpemVkIHN1Y2Nlc3NmdWxseWAsXG4gICAgICAgIH0pO1xuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBlcnJvcjogZXJyb3IsXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgbWVzc2FnZTogYEVycm9yIGluaXRpYWxpemluZyBpbmRleCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX06ICR7ZXJyb3IubWVzc2FnZX1gLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oeyByZXN1bHRzIH0pO1xuICB9XG5cbiAgQEdldCgnL2luZGljZXMve2VudGl0eU5hbWV9L3NldHRpbmdzJylcbiAgYXN5bmMgZ2V0SW5kZXhTZXR0aW5ncyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBcbiAgICAvLyBHZXQgY3VycmVudCBzZXR0aW5ncyBmcm9tIHRoZSBzZWFyY2ggZW5naW5lXG4gICAgY29uc3QgY3VycmVudFNldHRpbmdzID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleFNldHRpbmdzKCk7XG5cbiAgICAvLyBHZXQgYXV0by1nZW5lcmF0ZWQgc2V0dGluZ3MgZnJvbSBlbnRpdHkgc2NoZW1hXG4gICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIGNvbnN0IHNjaGVtYVNldHRpbmdzID0gc2VhcmNoQ29uZmlnLnNldHRpbmdzIHx8IHt9O1xuXG4gICAgLy8gQ2FsY3VsYXRlIGRlZXAgZGlmZlxuICAgIGNvbnN0IHsgZGlmZiwgaGFzRGlmZmVyZW5jZXMgfSA9IHRoaXMuY2FsY3VsYXRlU2V0dGluZ3NEaWZmKGN1cnJlbnRTZXR0aW5ncywgc2NoZW1hU2V0dGluZ3MpO1xuXG4gICAgLy8gQnVpbGQgaW5mb3JtYXRpdmUgc3RhdHVzIG1lc3NhZ2VcbiAgICBsZXQgc3RhdHVzID0gJ+KckyBJbmRleCBzZXR0aW5ncyBtYXRjaCBlbnRpdHkgc2NoZW1hJztcbiAgICBpZiAoaGFzRGlmZmVyZW5jZXMpIHtcbiAgICAgIGNvbnN0IHN1bW1hcnk6IHN0cmluZ1tdID0gW107XG4gICAgICBmb3IgKGNvbnN0IFtmaWVsZCwgZmllbGREaWZmXSBvZiBPYmplY3QuZW50cmllcyhkaWZmKSkge1xuICAgICAgICBpZiAoZmllbGREaWZmLnN0YXR1cyA9PT0gJ2RpZmZlcmVudCcgJiYgZmllbGREaWZmLnR5cGUgPT09ICdhcnJheScpIHtcbiAgICAgICAgICBjb25zdCBhZGRlZCA9IChmaWVsZERpZmYgYXMgYW55KS5hZGRlZD8ubGVuZ3RoIHx8IDA7XG4gICAgICAgICAgY29uc3QgcmVtb3ZlZCA9IChmaWVsZERpZmYgYXMgYW55KS5yZW1vdmVkPy5sZW5ndGggfHwgMDtcbiAgICAgICAgICBpZiAoYWRkZWQgPiAwKSBzdW1tYXJ5LnB1c2goYCR7YWRkZWR9IG5ldyBpbiBzY2hlbWEgKCR7ZmllbGR9KWApO1xuICAgICAgICAgIGlmIChyZW1vdmVkID4gMCkgc3VtbWFyeS5wdXNoKGAke3JlbW92ZWR9IG9ubHkgaW4gaW5kZXggKCR7ZmllbGR9KWApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBzdGF0dXMgPSBzdW1tYXJ5Lmxlbmd0aCA+IDAgXG4gICAgICAgID8gYOKEue+4jyBEaWZmZXJlbmNlcyBmb3VuZDogJHtzdW1tYXJ5LmpvaW4oJywgJyl9YFxuICAgICAgICA6ICfihLnvuI8gU2V0dGluZ3MgZGlmZmVyIGZyb20gc2NoZW1hJztcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmpzb24oeyBcbiAgICAgIHNldHRpbmdzOiBjdXJyZW50U2V0dGluZ3MsXG4gICAgICBzY2hlbWFTZXR0aW5ncyxcbiAgICAgIGRpZmYsXG4gICAgICBoYXNEaWZmZXJlbmNlcyxcbiAgICAgIHN0YXR1cyxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWVwIG5vcm1hbGl6ZSBhbnkgdmFsdWUgZm9yIGNvbnNpc3RlbnQgY29tcGFyaXNvblxuICAgKiBSZWN1cnNpdmVseSBzb3J0cyBvYmplY3Qga2V5cyBhbmQgaGFuZGxlcyBhcnJheXMvcHJpbWl0aXZlc1xuICAgKi9cbiAgcHJpdmF0ZSBkZWVwTm9ybWFsaXplKHZhbHVlOiBhbnkpOiBzdHJpbmcge1xuICAgIC8vIEhhbmRsZSBwcmltaXRpdmVzIGFuZCBudWxsL3VuZGVmaW5lZFxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSk7XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIGFycmF5cyAtIHJlY3Vyc2l2ZWx5IG5vcm1hbGl6ZSBlYWNoIGl0ZW1cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIC8vIFBhcnNlIGJhY2sgZWFjaCBub3JtYWxpemVkIHN0cmluZyB0byBhdm9pZCBkb3VibGUgc3RyaW5naWZpY2F0aW9uXG4gICAgICBjb25zdCBub3JtYWxpemVkQXJyYXkgPSB2YWx1ZS5tYXAoaXRlbSA9PiBKU09OLnBhcnNlKHRoaXMuZGVlcE5vcm1hbGl6ZShpdGVtKSkpO1xuICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KG5vcm1hbGl6ZWRBcnJheSk7XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIG9iamVjdHMgLSBzb3J0IGtleXMgYW5kIHJlY3Vyc2l2ZWx5IG5vcm1hbGl6ZSB2YWx1ZXNcbiAgICBjb25zdCBzb3J0ZWRLZXlzID0gT2JqZWN0LmtleXModmFsdWUpLnNvcnQoKTtcbiAgICBjb25zdCBub3JtYWxpemVkT2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgXG4gICAgZm9yIChjb25zdCBrZXkgb2Ygc29ydGVkS2V5cykge1xuICAgICAgLy8gUGFyc2UgYmFjayB0aGUgbm9ybWFsaXplZCBzdHJpbmcgZm9yIG5lc3RlZCBzdHJ1Y3R1cmVzXG4gICAgICB0cnkge1xuICAgICAgICBub3JtYWxpemVkT2JqW2tleV0gPSBKU09OLnBhcnNlKHRoaXMuZGVlcE5vcm1hbGl6ZSh2YWx1ZVtrZXldKSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgbm9ybWFsaXplZE9ialtrZXldID0gdmFsdWVba2V5XTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZE9iaik7XG4gIH1cblxuICAvKipcbiAgICogQ2FsY3VsYXRlIGRpZmYgYmV0d2VlbiBjdXJyZW50IGluZGV4IHNldHRpbmdzIGFuZCBzY2hlbWEtZGVyaXZlZCBzZXR0aW5nc1xuICAgKiBPbmx5IGNvbXBhcmVzIGZpZWxkcyB0aGF0IGV4aXN0IGluIHNjaGVtYSBzZXR0aW5ncyAoZnJhbWV3b3JrLW1hbmFnZWQgZmllbGRzKVxuICAgKi9cbiAgcHJpdmF0ZSBjYWxjdWxhdGVTZXR0aW5nc0RpZmYoY3VycmVudDogUmVjb3JkPHN0cmluZywgYW55Piwgc2NoZW1hOiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSB7XG4gICAgY29uc3QgZGlmZjogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIGxldCBoYXNEaWZmZXJlbmNlcyA9IGZhbHNlO1xuXG4gICAgLy8gT05MWSBjb21wYXJlIGZpZWxkcyB0aGF0IGV4aXN0IGluIHNjaGVtYSBzZXR0aW5ncyAoZnJhbWV3b3JrLW1hbmFnZWQpXG4gICAgLy8gVHlwaWNhbGx5OiBzZWFyY2hhYmxlQXR0cmlidXRlcywgZmlsdGVyYWJsZUF0dHJpYnV0ZXMsIHNvcnRhYmxlQXR0cmlidXRlc1xuICAgIGNvbnN0IGZpZWxkc1RvQ29tcGFyZSA9IE9iamVjdC5rZXlzKHNjaGVtYSB8fCB7fSk7XG5cbiAgICBmb3IgKGNvbnN0IGZpZWxkIG9mIGZpZWxkc1RvQ29tcGFyZSkge1xuICAgICAgY29uc3QgY3VycmVudFZhbHVlID0gY3VycmVudFtmaWVsZF07XG4gICAgICBjb25zdCBzY2hlbWFWYWx1ZSA9IHNjaGVtYVtmaWVsZF07XG5cbiAgICAgIC8vIEFycmF5IGNvbXBhcmlzb24gKG1vc3QgY29tbW9uIGNhc2UgZm9yIG91ciBtYW5hZ2VkIGZpZWxkcylcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHNjaGVtYVZhbHVlKSkge1xuICAgICAgICBjb25zdCBjdXJyQXJyID0gQXJyYXkuaXNBcnJheShjdXJyZW50VmFsdWUpID8gY3VycmVudFZhbHVlIDogW107XG4gICAgICAgIGNvbnN0IHNjaGVtYUFyciA9IHNjaGVtYVZhbHVlO1xuXG4gICAgICAgIC8vIFVzZSBkZWVwIG5vcm1hbGl6ZWQgY29tcGFyaXNvbiBmb3IgYXJyYXkgaXRlbXNcbiAgICAgICAgY29uc3QgY3Vyck5vcm1hbGl6ZWRTZXQgPSBuZXcgU2V0KGN1cnJBcnIubWFwKChpdGVtOiBhbnkpID0+IHRoaXMuZGVlcE5vcm1hbGl6ZShpdGVtKSkpO1xuICAgICAgICBjb25zdCBzY2hlbWFOb3JtYWxpemVkU2V0ID0gbmV3IFNldChzY2hlbWFBcnIubWFwKChpdGVtOiBhbnkpID0+IHRoaXMuZGVlcE5vcm1hbGl6ZShpdGVtKSkpO1xuXG4gICAgICAgIGNvbnN0IGFkZGVkID0gc2NoZW1hQXJyLmZpbHRlcigoaXRlbTogYW55KSA9PiAhY3Vyck5vcm1hbGl6ZWRTZXQuaGFzKHRoaXMuZGVlcE5vcm1hbGl6ZShpdGVtKSkpO1xuICAgICAgICBjb25zdCByZW1vdmVkID0gY3VyckFyci5maWx0ZXIoKGl0ZW06IGFueSkgPT4gIXNjaGVtYU5vcm1hbGl6ZWRTZXQuaGFzKHRoaXMuZGVlcE5vcm1hbGl6ZShpdGVtKSkpO1xuXG4gICAgICAgIGNvbnN0IGlzRGlmZmVyZW50ID0gYWRkZWQubGVuZ3RoID4gMCB8fCByZW1vdmVkLmxlbmd0aCA+IDA7XG4gICAgICAgIGlmIChpc0RpZmZlcmVudCkgaGFzRGlmZmVyZW5jZXMgPSB0cnVlO1xuXG4gICAgICAgIC8vIE9ubHkgaW5jbHVkZSBkZXRhaWxlZCBicmVha2Rvd24gaWYgdGhlcmUgQVJFIGRpZmZlcmVuY2VzXG4gICAgICAgIGlmIChpc0RpZmZlcmVudCkge1xuICAgICAgICAgIGRpZmZbZmllbGRdID0ge1xuICAgICAgICAgICAgdHlwZTogJ2FycmF5JyxcbiAgICAgICAgICAgIGFkZGVkLFxuICAgICAgICAgICAgcmVtb3ZlZCxcbiAgICAgICAgICAgIHN0YXR1czogJ2RpZmZlcmVudCdcbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIENvbmNpc2UgZm9yIFwic2FtZVwiIHN0YXR1c1xuICAgICAgICAgIGRpZmZbZmllbGRdID0ge1xuICAgICAgICAgICAgdHlwZTogJ2FycmF5JyxcbiAgICAgICAgICAgIHN0YXR1czogJ3NhbWUnXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICB9IGVsc2UgaWYgKHNjaGVtYVZhbHVlICE9PSBudWxsICYmIHR5cGVvZiBzY2hlbWFWYWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgLy8gT2JqZWN0IGNvbXBhcmlzb24gdXNpbmcgZGVlcCBub3JtYWxpemF0aW9uXG4gICAgICAgIGNvbnN0IGN1cnJlbnROb3JtYWxpemVkID0gdGhpcy5kZWVwTm9ybWFsaXplKGN1cnJlbnRWYWx1ZSk7XG4gICAgICAgIGNvbnN0IHNjaGVtYU5vcm1hbGl6ZWQgPSB0aGlzLmRlZXBOb3JtYWxpemUoc2NoZW1hVmFsdWUpO1xuICAgICAgICBjb25zdCBpc0RpZmZlcmVudCA9IGN1cnJlbnROb3JtYWxpemVkICE9PSBzY2hlbWFOb3JtYWxpemVkO1xuXG4gICAgICAgIGlmIChpc0RpZmZlcmVudCkgaGFzRGlmZmVyZW5jZXMgPSB0cnVlO1xuXG4gICAgICAgIGRpZmZbZmllbGRdID0ge1xuICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgIGN1cnJlbnQ6IGN1cnJlbnRWYWx1ZSxcbiAgICAgICAgICBzY2hlbWE6IHNjaGVtYVZhbHVlLFxuICAgICAgICAgIHN0YXR1czogaXNEaWZmZXJlbnQgPyAnZGlmZmVyZW50JyA6ICdzYW1lJ1xuICAgICAgICB9O1xuXG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBTY2FsYXIgY29tcGFyaXNvbiAoc3RyaW5nLCBudW1iZXIsIGJvb2xlYW4sIG51bGwsIHVuZGVmaW5lZClcbiAgICAgICAgY29uc3QgaXNEaWZmZXJlbnQgPSBjdXJyZW50VmFsdWUgIT09IHNjaGVtYVZhbHVlO1xuICAgICAgICBcbiAgICAgICAgaWYgKGlzRGlmZmVyZW50KSBoYXNEaWZmZXJlbmNlcyA9IHRydWU7XG5cbiAgICAgICAgZGlmZltmaWVsZF0gPSB7XG4gICAgICAgICAgdHlwZTogJ3NjYWxhcicsXG4gICAgICAgICAgY3VycmVudDogY3VycmVudFZhbHVlLFxuICAgICAgICAgIHNjaGVtYTogc2NoZW1hVmFsdWUsXG4gICAgICAgICAgc3RhdHVzOiBpc0RpZmZlcmVudCA/ICdkaWZmZXJlbnQnIDogJ3NhbWUnXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgZGlmZiwgaGFzRGlmZmVyZW5jZXMgfTtcbiAgfVxuXG4gIEBQdXQoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9zZXR0aW5ncycsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBzZXR0aW5nczogeyBkYXRhdHlwZTogJ29iamVjdCcsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIHVwZGF0ZUluZGV4U2V0dGluZ3MoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IHNldHRpbmdzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+OyB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuICAgIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHJlcS5ib2R5IHx8IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNlYXJjaFNlcnZpY2UudXBkYXRlSW5kZXhTZXR0aW5ncyhzZXR0aW5ncywgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgcmVzdWx0LFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBtZXNzYWdlOiAnSW5kZXggc2V0dGluZ3MgdXBkYXRlZCBzdWNjZXNzZnVsbHknLFxuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9yZXNldC1zZXR0aW5ncycpXG4gIGFzeW5jIHJlc2V0SW5kZXhTZXR0aW5ncyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLnJlc2V0SW5kZXhTZXR0aW5ncygpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgbWVzc2FnZTogJ0luZGV4IHNldHRpbmdzIHJlc2V0IHRvIE1laWxpc2VhcmNoIGRlZmF1bHRzJ1xuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9hcHBseS1kZWZhdWx0LXNldHRpbmdzJylcbiAgYXN5bmMgYXBwbHlEZWZhdWx0U2V0dGluZ3MoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIFxuICAgIC8vIEdldCBzY2hlbWEtZGVyaXZlZCBzZXR0aW5nc1xuICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBjb25zdCBzY2hlbWFTZXR0aW5ncyA9IHNlYXJjaENvbmZpZy5zZXR0aW5ncyB8fCB7fTtcblxuICAgIC8vIEFwcGx5IHRoZSBzY2hlbWEtZGVyaXZlZCBzZXR0aW5nc1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UudXBkYXRlSW5kZXhTZXR0aW5ncyhzY2hlbWFTZXR0aW5ncywgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBhcHBsaWVkU2V0dGluZ3M6IHNjaGVtYVNldHRpbmdzLFxuICAgICAgbWVzc2FnZTogJ0luZGV4IHNldHRpbmdzIHN5bmNlZCBzdWNjZXNzZnVsbHkgZnJvbSBlbnRpdHkgc2NoZW1hJ1xuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9pbml0JylcbiAgYXN5bmMgaW5pdFNpbmdsZUVudGl0eUluZGV4KFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBpZiAoIWVudGl0eVNlcnZpY2UuaXNTZWFyY2hFbmFibGVkKCkpIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBtZXNzYWdlOiBgU2VhcmNoIGlzIG5vdCBlbmFibGVkIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWAsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5pbml0U2VhcmNoSW5kZXgoKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICBjb25maWcsXG4gICAgICBtZXNzYWdlOiBgSW5kZXggJHtjb25maWcuaW5kZXhOYW1lfSBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHlgLFxuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9yZWNyZWF0ZScpXG4gIGFzeW5jIHJlY3JlYXRlSW5kZXgoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7XG4gICAgICAgIHJlc3luY0RvY3VtZW50cz86IGJvb2xlYW47XG4gICAgICAgIHN5bmNNZXRob2Q/OiAnZGlyZWN0JyB8ICdxdWV1ZSc7XG4gICAgICAgIGJhdGNoU2l6ZT86IG51bWJlcjtcbiAgICAgICAgcXVldWVVcmw/OiBzdHJpbmc7XG4gICAgICB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcbiAgICBjb25zdCB7IFxuICAgICAgcmVzeW5jRG9jdW1lbnRzID0gZmFsc2UsIFxuICAgICAgc3luY01ldGhvZCA9ICdkaXJlY3QnLFxuICAgICAgYmF0Y2hTaXplID0gNTAsXG4gICAgICBxdWV1ZVVybCBcbiAgICB9ID0gcmVxLmJvZHkgfHwge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3Qgb2xkQ29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oYFJlY3JlYXRpbmcgaW5kZXggZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCwgeyBvbGRDb25maWcgfSk7XG5cbiAgICAvLyBEZWxldGUgZXhpc3RpbmcgaW5kZXhcbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBEZWxldGluZyBleGlzdGluZyBpbmRleDogJHtvbGRDb25maWcuaW5kZXhOYW1lfWApO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmRlbGV0ZVNlYXJjaEluZGV4KHRydWUpO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oYENvdWxkIG5vdCBkZWxldGUgaW5kZXggKG1pZ2h0IG5vdCBleGlzdCk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG5cbiAgICAvLyBSZWluaXRpYWxpemUgaW5kZXggd2l0aCBuZXcgY29uZmlndXJhdGlvblxuICAgIHRoaXMubG9nZ2VyLmluZm8oYFJlaW5pdGlhbGl6aW5nIGluZGV4IGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuaW5pdFNlYXJjaEluZGV4KCk7XG4gICAgY29uc3QgbmV3Q29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuXG4gICAgbGV0IHJlc3luY1Jlc3VsdCA9IG51bGw7XG5cbiAgICAvLyBPcHRpb25hbGx5IHJlc3luYyBhbGwgZG9jdW1lbnRzXG4gICAgaWYgKHJlc3luY0RvY3VtZW50cykge1xuICAgICAgaWYgKHN5bmNNZXRob2QgPT09ICdxdWV1ZScpIHtcbiAgICAgICAgLy8gUXVldWUtYmFzZWQgc3luYyAobm9uLWJsb2NraW5nLCBmb3IgbGFyZ2UgZGF0YXNldHMpXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFF1ZXVlaW5nIGRvY3VtZW50cyBmb3IgcmVzeW5jOiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIHJlc3luY1Jlc3VsdCA9IGF3YWl0IHRoaXMucXVldWVEb2N1bWVudHNGb3JSZXN5bmMoZW50aXR5TmFtZSwgeyBiYXRjaFNpemUsIHF1ZXVlVXJsIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRGlyZWN0IHN5bmMgKGJsb2NraW5nLCBpbW1lZGlhdGUgY29uZmlybWF0aW9uKVxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBEaXJlY3RseSByZXN5bmNpbmcgZG9jdW1lbnRzOiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIHJlc3luY1Jlc3VsdCA9IGF3YWl0IHNlYXJjaFNlcnZpY2UucmVzeW5jQWxsRG9jdW1lbnRzKHsgYmF0Y2hTaXplIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIG9sZEluZGV4TmFtZTogb2xkQ29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG5ld0luZGV4TmFtZTogbmV3Q29uZmlnLmluZGV4TmFtZSxcbiAgICAgIHN5bmNNZXRob2Q6IHJlc3luY0RvY3VtZW50cyA/IHN5bmNNZXRob2QgOiBudWxsLFxuICAgICAgbWVzc2FnZTogYEluZGV4IHJlY3JlYXRlZCBzdWNjZXNzZnVsbHkke3Jlc3luY0RvY3VtZW50cyA/IGAgKCR7c3luY01ldGhvZH0gc3luYzogJHtyZXN5bmNSZXN1bHQ/LnByb2Nlc3NlZENvdW50IHx8IDB9IGRvY3VtZW50cylgIDogJyd9YCxcbiAgICAgIHJlc3luY1Jlc3VsdCxcbiAgICAgIGNvbmZpZ3M6IHsgb2xkQ29uZmlnLCBuZXdDb25maWcgfVxuICAgIH0pO1xuICB9XG5cbiAgQERlbGV0ZSgnL2luZGljZXMve2VudGl0eU5hbWV9JylcbiAgYXN5bmMgZGVsZXRlSW5kZXgoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5kZWxldGVTZWFyY2hJbmRleCh0cnVlKTtcbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBtZXNzYWdlOiAnSW5kZXggZGVsZXRlZCBzdWNjZXNzZnVsbHknXG4gICAgfSk7XG4gIH1cblxuICBARGVsZXRlKCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vZG9jdW1lbnRzJylcbiAgYXN5bmMgY2xlYXJFbnRpdHlJbmRleChcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgY29uZmlnID0gc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RW5naW5lKCkuZGVsZXRlQWxsRG9jdW1lbnRzKGNvbmZpZy5pbmRleE5hbWUhLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdBbGwgZG9jdW1lbnRzIGNsZWFyZWQgZnJvbSBpbmRleCdcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vcmVzeW5jJylcbiAgYXN5bmMgcmVzeW5jRW50aXR5UmVjb3JkcyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgYmF0Y2hTaXplPzogbnVtYmVyOyBxdWV1ZVVybD86IHN0cmluZzsgYnlCYXRjaD86IGJvb2xlYW4gfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG4gICAgY29uc3QgeyBiYXRjaFNpemUgPSA1MCwgcXVldWVVcmwsIGJ5QmF0Y2ggPSB0cnVlIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVldWVEb2N1bWVudHNGb3JSZXN5bmMoZW50aXR5TmFtZSwgeyBiYXRjaFNpemUsIHF1ZXVlVXJsLCBieUJhdGNoIH0pO1xuXG4gICAgbGV0IG1lc3NhZ2UgPSBgUXVldWVkICR7cmVzdWx0LnByb2Nlc3NlZENvdW50fSByZWNvcmRzIGZvciByZS1pbmRleGluZ2A7XG4gICAgaWYgKHJlc3VsdC5mYWlsZWRDb3VudCA+IDApIHtcbiAgICAgIG1lc3NhZ2UgKz0gYCwgJHtyZXN1bHQuZmFpbGVkQ291bnR9IHJlY29yZHMgZmFpbGVkIHRvIGJlIHF1ZXVlZGA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBzdWNjZXNzOiByZXN1bHQucHJvY2Vzc2VkQ291bnQgPiAwLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIC4uLnJlc3VsdCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZSBkb2N1bWVudHMgZm9yIGFzeW5jIHJlc3luYyB2aWEgU1FTXG4gICAqIFNoYXJlZCBsb2dpYyB1c2VkIGJ5IHJlc3luYyBhbmQgcmVjcmVhdGUgZW5kcG9pbnRzXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHF1ZXVlRG9jdW1lbnRzRm9yUmVzeW5jKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBvcHRpb25zOiB7XG4gICAgICBiYXRjaFNpemU/OiBudW1iZXI7XG4gICAgICBxdWV1ZVVybD86IHN0cmluZztcbiAgICAgIGJ5QmF0Y2g/OiBib29sZWFuO1xuICAgIH1cbiAgKTogUHJvbWlzZTx7XG4gICAgcHJvY2Vzc2VkQ291bnQ6IG51bWJlcjtcbiAgICBmYWlsZWRDb3VudDogbnVtYmVyO1xuICAgIHRvdGFsSXRlcmF0aW9uczogbnVtYmVyO1xuICB9PiB7XG4gICAgY29uc3QgeyBiYXRjaFNpemUgPSA1MCwgcXVldWVVcmwsIGJ5QmF0Y2ggPSB0cnVlIH0gPSBvcHRpb25zO1xuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICAvLyBVc2UgcHJvdmlkZWQgcXVldWVVcmwgb3IgcmVzb2x2ZSBmcm9tIGVudmlyb25tZW50XG4gICAgY29uc3QgcXVldWVOYW1lID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBTRUFSQ0hfQ09OVFJPTExFUl9FTlZfS0VZUy5NRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUgfSk7XG4gICAgY29uc3QgcmVzb2x2ZWRRdWV1ZVVybCA9IHF1ZXVlVXJsIHx8IEVudmlyb25tZW50LnF1ZXVlVXJsKHF1ZXVlTmFtZSk7XG5cbiAgICBpZiAoIXJlc29sdmVkUXVldWVVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUXVldWUgVVJMIG5vdCBwcm92aWRlZCBhbmQgZW52LWtleSBbJHtTRUFSQ0hfQ09OVFJPTExFUl9FTlZfS0VZUy5NRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUV9XSBpcyBub3QgY29uZmlndXJlZGApO1xuICAgIH1cblxuICAgIGxldCBmYWlsZWRDb3VudCA9IDA7XG4gICAgbGV0IHByb2Nlc3NlZENvdW50ID0gMDtcbiAgICBsZXQgY3Vyc29yOiBzdHJpbmcgfCB1bmRlZmluZWQgPSAnaW5pdCc7XG4gICAgbGV0IGl0ZXJhdGlvbkNvdW50ID0gMDtcbiAgICBjb25zdCBtYXhJdGVyYXRpb25zID0gMTAwMDAwO1xuXG4gICAgd2hpbGUgKCEhY3Vyc29yICYmIGl0ZXJhdGlvbkNvdW50IDwgbWF4SXRlcmF0aW9ucykge1xuICAgICAgaXRlcmF0aW9uQ291bnQrKztcblxuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgRmV0Y2hpbmcgJHtlbnRpdHlOYW1lfSByZWNvcmRzIGZyb20gY3Vyc29yOiAke2N1cnNvcn1gKTtcblxuICAgICAgY29uc3QgcXVlcnlSZXN1bHQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnF1ZXJ5KHtcbiAgICAgICAgcGFnaW5hdGlvbjoge1xuICAgICAgICAgIGxpbWl0OiBiYXRjaFNpemUsXG4gICAgICAgICAgY3Vyc29yOiBjdXJzb3IgPT09ICdpbml0JyA/IHVuZGVmaW5lZCA6IGN1cnNvclxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgaWYgKCFxdWVyeVJlc3VsdC5kYXRhIHx8IHF1ZXJ5UmVzdWx0LmRhdGEubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBpZiAoYnlCYXRjaCkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgUHJvbWlzZS5hbGwocXVlcnlSZXN1bHQuZGF0YS5tYXAoYXN5bmMgKHJlYykgPT4ge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBlbnRpdHlTZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcocmVjKTtcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgc2VuZFF1ZXVlTWVzc2FnZShyZXNvbHZlZFF1ZXVlVXJsLCB7XG4gICAgICAgICAgICBkYXRhLFxuICAgICAgICAgICAgZXZlbnROYW1lOiBcIlJFU1lOQ1wiLFxuICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBwcm9jZXNzZWRDb3VudCArPSBkYXRhLmxlbmd0aDtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBFcnJvciBxdWV1ZWluZyBiYXRjaCBmb3Igc3luYzogJHtlcnJvci5tZXNzYWdlfWAsIHsgZW50aXR5TmFtZSwgYmF0Y2hTaXplLCBlcnJvciB9KTtcbiAgICAgICAgICBmYWlsZWRDb3VudCArPSBkYXRhLmxlbmd0aDtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgcXVlcnlSZXN1bHQuZGF0YS5tYXAoYXN5bmMgKGVudGl0eVJlY29yZCkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgY29uc3QgdHJhbnNmb3JtZWQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5UmVjb3JkKTtcbiAgICAgICAgICAgICAgYXdhaXQgc2VuZFF1ZXVlTWVzc2FnZShyZXNvbHZlZFF1ZXVlVXJsLCB7XG4gICAgICAgICAgICAgIGRhdGE6IHRyYW5zZm9ybWVkLFxuICAgICAgICAgICAgICBldmVudE5hbWU6IFwiUkVTWU5DXCIsXG4gICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcHJvY2Vzc2VkQ291bnQrKztcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBFcnJvciBxdWV1ZWluZyByZWNvcmQgZm9yIHN5bmM6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGVudGl0eU5hbWUsIGVycm9yIH0pO1xuICAgICAgICAgICAgZmFpbGVkQ291bnQrKztcbiAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY3Vyc29yID0gcXVlcnlSZXN1bHQuY3Vyc29yID8/IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBRdWV1ZSBzeW5jIGNvbXBsZXRlZCBmb3IgJHtlbnRpdHlOYW1lfWAsIHtcbiAgICAgIHByb2Nlc3NlZENvdW50LFxuICAgICAgZmFpbGVkQ291bnQsXG4gICAgICB0b3RhbEl0ZXJhdGlvbnM6IGl0ZXJhdGlvbkNvdW50XG4gICAgfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgcHJvY2Vzc2VkQ291bnQsXG4gICAgICBmYWlsZWRDb3VudCxcbiAgICAgIHRvdGFsSXRlcmF0aW9uczogaXRlcmF0aW9uQ291bnQsXG4gICAgfTtcbiAgfVxuXG4gIEBHZXQoJy9xdWV1ZS1pbmZvJylcbiAgYXN5bmMgZ2V0UXVldWVJbmZvKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgcXVldWVVcmw6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IHF1ZXVlVXJsIH0gPSByZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzOyAgXG5cbiAgICAvLyBVc2UgcHJvdmlkZWQgcXVldWVVcmwgb3IgcmVzb2x2ZSBmcm9tIGVudmlyb25tZW50XG4gICAgY29uc3QgcXVldWVOYW1lID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBTRUFSQ0hfQ09OVFJPTExFUl9FTlZfS0VZUy5NRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUgfSk7XG4gICAgY29uc3QgcmVzb2x2ZWRRdWV1ZVVybCA9IHF1ZXVlVXJsIHx8IEVudmlyb25tZW50LnF1ZXVlVXJsKHF1ZXVlTmFtZSk7XG5cbiAgICBjb25zdCBpbmZvID0gYXdhaXQgZ2V0UXVldWVNZXNzYWdlTWV0YWRhdGEocmVzb2x2ZWRRdWV1ZVVybCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oeyBpbmZvIH0pO1xuICB9XG5cbiAgQFB1dCgnL3JlY29yZHMve2VudGl0eU5hbWV9Jywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIGRvY3VtZW50czogeyBkYXRhdHlwZTogJ2FycmF5JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgdXBkYXRlRG9jdW1lbnRzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBkb2N1bWVudHM6IGFueVtdIH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHsgZG9jdW1lbnRzIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNlYXJjaFNlcnZpY2UudXBkYXRlRG9jdW1lbnRzKGRvY3VtZW50cywgdHJ1ZSk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHJlc3VsdCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgbWVzc2FnZTogJ0RvY3VtZW50cyB1cGRhdGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgfSk7XG4gIH1cblxuICBARGVsZXRlKCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0vYnktaWRzJywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIGlkczogeyBkYXRhdHlwZTogJ2FycmF5JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzQnlJZHMoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IGlkczogc3RyaW5nW10gfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgeyBpZHMgfSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RW5naW5lKCkuZGVsZXRlRG9jdW1lbnRzKGlkcywgY29uZmlnLmluZGV4TmFtZSEsIHRydWUpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgbWVzc2FnZTogJ0RvY3VtZW50cyBkZWxldGVkIHN1Y2Nlc3NmdWxseSdcbiAgICB9KTtcbiAgfVxuXG4gIEBEZWxldGUoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfS9ieS1maWx0ZXInLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZmlsdGVyOiB7IGRhdGF0eXBlOiAnb2JqZWN0JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzQnlGaWx0ZXIoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IGZpbHRlcjogYW55IH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHsgZmlsdGVyIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZGVsZXRlRG9jdW1lbnRzQnlGaWx0ZXIoZmlsdGVyLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdEb2N1bWVudHMgbWF0Y2hpbmcgZmlsdGVyIGhhdmUgYmVlbiBxdWV1ZWQgZm9yIGRlbGV0aW9uLidcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IHByb3ZpZGVyID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICAgIGZvckVudGl0eTogZW50aXR5TmFtZSxcbiAgICB9KTtcblxuICAgIGlmIChwcm92aWRlci5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gcHJvdmlkZXIgZm91bmQgZm9yIGVudGl0eS1zZXJ2aWNlIGZvciAke2VudGl0eU5hbWV9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHByb3ZpZGVyWyAwIF0uX2NvbnRhaW5lci5yZXNvbHZlPEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KHByb3ZpZGVyWyAwIF0uX3Byb3ZpZGVyLnByb3ZpZGUpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3QgZW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gZW50aXR5U2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG5cbiAgICBpZiAoIXNlYXJjaFNlcnZpY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIHNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgIH1cblxuICAgIHJldHVybiBzZWFyY2hTZXJ2aWNlO1xuICB9XG59Il19