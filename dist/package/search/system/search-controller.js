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
// the implemenitng controller must define this.. 
// hte controller decortator here causes errors due to dynamic layer imports and pollutes automatic lambda handler
// @Controller('system/search', {
//   env: [ {
//     name: SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME,
//   } ],
// })
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
    __param(0, (0, di_1.InjectContainer)())
], SearchSystemController);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9zZWFyY2gtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFFQSwwQ0FBNkU7QUFDN0Usc0ZBQTBFO0FBRTFFLGlEQUFzRTtBQUN0RSxpQ0FBMkM7QUFHM0MsdUNBQTJEO0FBQzNELGtEQUFtRDtBQUNuRCx5Q0FBMkM7QUFFM0MsSUFBWSwwQkFFWDtBQUZELFdBQVksMEJBQTBCO0lBQ3BDLHlGQUEyRCxDQUFBO0FBQzdELENBQUMsRUFGVywwQkFBMEIsMENBQTFCLDBCQUEwQixRQUVyQztBQUVELGtEQUFrRDtBQUNsRCxrSEFBa0g7QUFDbEgsaUNBQWlDO0FBQ2pDLGFBQWE7QUFDYixvRUFBb0U7QUFDcEUsU0FBUztBQUNULEtBQUs7QUFDRSxJQUFNLHNCQUFzQixHQUE1QixNQUFNLHNCQUF1QixTQUFRLHNDQUFhO0lBQ2Q7SUFBekMsWUFBeUMsU0FBdUI7UUFDOUQsS0FBSyxFQUFFLENBQUM7UUFEK0IsY0FBUyxHQUFULFNBQVMsQ0FBYztJQUVoRSxDQUFDO0lBRUQsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUE0QixFQUFFLFFBQWlCLElBQUksQ0FBQztJQUcvRCxBQUFOLEtBQUssQ0FBQyxXQUFXLENBQUMsUUFBaUIsRUFBRSxRQUFrQjtRQUNyRCw2Q0FBNkM7UUFDN0MsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyx1QkFBdUIsQ0FBQztZQUM3RCxJQUFJLEVBQUUsU0FBUztZQUNmLCtCQUErQixFQUFFLElBQUk7U0FDdEMsQ0FBQzthQUNDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUNWLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFBO1FBQ2hDLENBQUMsQ0FBQyxDQUFDO1FBRUwsTUFBTSxXQUFXLEdBQVUsRUFBRSxD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LElBQUEsaUJBQUksRUFBQyw4QkFBOEIsQ0FBQztpRUF3QnBDO0FBdUdLO0lBREwsSUFBQSxnQkFBRyxFQUFDLGFBQWEsQ0FBQzswREFlbEI7QUFTSztJQVBMLElBQUEsZ0JBQUcsRUFBQyx1QkFBdUIsRUFBRTtRQUM1QixXQUFXLEVBQUU7WUFDWCxJQUFJLEVBQUU7Z0JBQ0osU0FBUyxFQUFFLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFO2FBQ2pEO1NBQ0Y7S0FDRixDQUFDOzZEQWtCRDtBQVNLO0lBUEwsSUFBQSxtQkFBTSxFQUFDLDhCQUE4QixFQUFFO1FBQ3RDLFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRTtnQkFDSixHQUFHLEVBQUUsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUU7YUFDM0M7U0FDRjtLQUNGLENBQUM7a0VBb0JEO0FBU0s7SUFQTCxJQUFBLG1CQUFNLEVBQUMsaUNBQWlDLEVBQUU7UUFDekMsV0FBVyxFQUFFO1lBQ1gsSUFBSSxFQUFFO2dCQUNKLE1BQU0sRUFBRSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRTthQUMvQztTQUNGO0tBQ0YsQ0FBQztxRUFxQkQ7aUNBNTRCVSxzQkFBc0I7SUFDcEIsV0FBQSxJQUFBLG9CQUFlLEdBQUUsQ0FBQTtHQURuQixzQkFBc0IsQ0FzNkJsQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuXG5pbXBvcnQgeyBnZXRRdWV1ZU1lc3NhZ2VNZXRhZGF0YSwgc2VuZFF1ZXVlTWVzc2FnZSB9IGZyb20gXCIuLi8uLi9jbGllbnQvc3FzXCI7XG5pbXBvcnQgeyBBUElDb250cm9sbGVyIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2FwaS1nYXRld2F5LWNvbnRyb2xsZXInO1xuaW1wb3J0IHR5cGUgeyBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSBcIi4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7IENvbnRyb2xsZXIsIERlbGV0ZSwgR2V0LCBQb3N0LCBQdXQgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzJztcbmltcG9ydCB7IEluamVjdENvbnRhaW5lciB9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7IHR5cGUgQmFzZUVudGl0eVNlcnZpY2UgfSBmcm9tICcuLi8uLi9lbnRpdHknO1xuaW1wb3J0IHsgdHlwZSBJRElDb250YWluZXIsIHR5cGUgUmVxdWVzdCwgdHlwZSBSZXNwb25zZSB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgZGVlcENvcHksIHJlc29sdmVFbnZWYWx1ZUZvciB9IGZyb20gJy4uLy4uL3V0aWxzJztcbmltcG9ydCB7IHBhcnNlU2VhcmNoUXVlcnkgfSBmcm9tIFwiLi4vc2VhcmNoLXV0aWxzXCI7XG5pbXBvcnQgeyBFbnZpcm9ubWVudCB9IGZyb20gXCIuLi8uLi9jbGllbnRcIjtcblxuZXhwb3J0IGVudW0gU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMge1xuICBNRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUgPSAnTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FJyxcbn1cblxuLy8gdGhlIGltcGxlbWVuaXRuZyBjb250cm9sbGVyIG11c3QgZGVmaW5lIHRoaXMuLiBcbi8vIGh0ZSBjb250cm9sbGVyIGRlY29ydGF0b3IgaGVyZSBjYXVzZXMgZXJyb3JzIGR1ZSB0byBkeW5hbWljIGxheWVyIGltcG9ydHMgYW5kIHBvbGx1dGVzIGF1dG9tYXRpYyBsYW1iZGEgaGFuZGxlclxuLy8gQENvbnRyb2xsZXIoJ3N5c3RlbS9zZWFyY2gnLCB7XG4vLyAgIGVudjogWyB7XG4vLyAgICAgbmFtZTogU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FLFxuLy8gICB9IF0sXG4vLyB9KVxuZXhwb3J0IGNsYXNzIFNlYXJjaFN5c3RlbUNvbnRyb2xsZXIgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgY29uc3RydWN0b3IoQEluamVjdENvbnRhaW5lcigpIHByb3RlY3RlZCBjb250YWluZXI6IElESUNvbnRhaW5lcikge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KSB7IH1cblxuICBAR2V0KCcvaW5kaWNlcycpXG4gIGFzeW5jIGxpc3RJbmRpY2VzKF9yZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UpIHtcbiAgICAvLyBBdXRvLWRpc2NvdmVyIGVudGl0aWVzIHdpdGggc2VhcmNoIGVuYWJsZWRcbiAgICBjb25zdCBlbnRpdHlQcm92aWRlcnMgPSB0aGlzLmNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlLFxuICAgIH0pXG4gICAgICAuZmlsdGVyKHAgPT4ge1xuICAgICAgICByZXR1cm4gISFwLl9wcm92aWRlci5mb3JFbnRpdHlcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgaW5kaWNlc0RhdGE6IGFueVtdID0gW107XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChlbnRpdHlQcm92aWRlcnMubWFwKGFzeW5jIChwcm92aWRlcikgPT4ge1xuXG4gICAgICBjb25zdCBlbnRpdHlOYW1lID0gcHJvdmlkZXIuX3Byb3ZpZGVyLmZvckVudGl0eSBhcyBzdHJpbmc7XG5cbiAgICAgIHRyeSB7XG5cbiAgICAgICAgLy8gdXNlIHByb3ZpZGVyJ3MgY29udGFpbmVyICB0byByZXNvbHZlIHRoZSBzZXJ2aWNlXG4gICAgICAgIGNvbnN0IHNlcnZpY2UgPSBwcm92aWRlci5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oXG4gICAgICAgICAgcHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGVcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAoIXNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlcnZpY2UgJHtTdHJpbmcocHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGUpfSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gc2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgIGlmICghc2VhcmNoU2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIHNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaW5kZXhJbmZvID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleEluZm8oKTtcblxuICAgICAgICBpbmRpY2VzRGF0YS5wdXNoKHtcbiAgICAgICAgICAuLi5pbmRleEluZm8sXG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBpbmRleE5hbWU6IGluZGV4SW5mby51aWQsXG4gICAgICAgIH0pO1xuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG5cbiAgICAgICAgaW5kaWNlc0RhdGEucHVzaCh7XG4gICAgICAgICAgaW5kZXhOYW1lOiBgWyR7ZW50aXR5TmFtZX1dLWluZGV4LW5hbWUtbm90LXJlc29sdmVkYCxcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihlcnJvcik7XG4gICAgICB9XG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHJlc3BvbnNlLmpzb24oeyBpbmRpY2VzOiBpbmRpY2VzRGF0YSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgbmV3IGFwaSB0byBnZXQgaW5kZXggZGV0YWlsc1xuICAgKiBcbiAgICovXG5cbiAgQEdldCgnL2luZGljZXMve2VudGl0eU5hbWV9Jywge30pXG4gIGFzeW5jIGdldEluZGV4RGV0YWlscyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgaW5kZXhJbmZvID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleEluZm8oKTtcbiAgICBjb25zdCBpbmRleFN0YXRzID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleFN0YXRzKCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgZGV0YWlsczoge1xuICAgICAgICBpbmRleEluZm8sXG4gICAgICAgIGluZGV4U3RhdHMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBAR2V0KCcvZW50aXRpZXMnKVxuICBhc3luYyBnZXRTZWFyY2hFbnRpdGllcyhfcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgZW50aXR5UHJvdmlkZXJzID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICB9KVxuICAgICAgLmZpbHRlcihwID0+ICEhcC5fcHJvdmlkZXIuZm9yRW50aXR5KTtcblxuICAgIGNvbnN0IGVudGl0aWVzRGF0YToge1xuICAgICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgICAgc2VhcmNoRW5hYmxlZDogYm9vbGVhbjtcbiAgICAgIGluZGV4RXhpc3RzPzogYm9vbGVhbjtcbiAgICAgIGluZGV4TmFtZT86IHN0cmluZztcbiAgICAgIGVycm9yPzogc3RyaW5nO1xuICAgIH1bXSA9IFtdO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZW50aXR5UHJvdmlkZXJzLm1hcChhc3luYyAocHJvdmlkZXIpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSBwcm92aWRlci5fcHJvdmlkZXIuZm9yRW50aXR5IGFzIHN0cmluZztcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc2VydmljZSA9IHByb3ZpZGVyLl9jb250YWluZXIucmVzb2x2ZTxCYXNlRW50aXR5U2VydmljZTxhbnk+PihcbiAgICAgICAgICBwcm92aWRlci5fcHJvdmlkZXIucHJvdmlkZVxuICAgICAgICApO1xuXG4gICAgICAgIGlmICghc2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VydmljZSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWFyY2hFbmFibGVkID0gc2VydmljZS5pc1NlYXJjaEVuYWJsZWQoKTtcbiAgICAgICAgbGV0IGluZGV4RXhpc3RzID0gZmFsc2U7XG4gICAgICAgIGxldCBpbmRleE5hbWUgPSAnJztcblxuICAgICAgICBpZiAoc2VhcmNoRW5hYmxlZCkge1xuICAgICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSBzZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgICBpZiAoc2VhcmNoU2VydmljZSkge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgICAgICAgICAgaW5kZXhOYW1lID0gY29uZmlnLmluZGV4TmFtZSE7XG4gICAgICAgICAgICBpbmRleEV4aXN0cyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RW5naW5lKCkuaW5kZXhFeGlzdHMoaW5kZXhOYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBlbnRpdGllc0RhdGEucHVzaCh7XG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBzZWFyY2hFbmFibGVkLFxuICAgICAgICAgIGluZGV4RXhpc3RzLFxuICAgICAgICAgIGluZGV4TmFtZSxcbiAgICAgICAgfSk7XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgZW50aXRpZXNEYXRhLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgc2VhcmNoRW5hYmxlZDogZmFsc2UsXG4gICAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIHJldHVybiByZXNwb25zZS5qc29uKHsgZW50aXRpZXM6IGVudGl0aWVzRGF0YSB9KTtcbiAgfVxuXG4gIEBHZXQoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfS97ZG9jdW1lbnRJZH0nKVxuICBhc3luYyBnZXRTaW5nbGVEb2N1bWVudChcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZywgZG9jdW1lbnRJZDogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGRvY3VtZW50SWQgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcHJpbWFyeUlkRmllbGROYW1lID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcbiAgICBcbiAgICBjb25zdCBkb2MgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldERvY3VtZW50KGRvY3VtZW50SWQpO1xuXG4gICAgZG9jWyAnaWQnIF0gPSBkb2NbICdpZCcgXSB8fCBkb2NbIHByaW1hcnlJZEZpZWxkTmFtZSBhcyBzdHJpbmcgXTtcbiAgICBkb2NbICdmdWxsUmVjb3JkJyBdID0geyAuLi5kb2MgfTtcbiAgICBkb2NbICdlbnRpdHlOYW1lJyBdID0gZW50aXR5TmFtZTtcblxuICAgIHJldHVybiByZXMuanNvbihkb2MpO1xuICB9XG5cbiAgQEdldCgnL3JlY29yZHMve2VudGl0eU5hbWV9JylcbiAgYXN5bmMgZ2V0RW50aXR5UmVjb3JkcyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVycz86IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHRcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcXVlcnkgPSBkZWVwQ29weShyZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzKTtcblxuICAgIGNvbnN0IHBhcnNlZFF1ZXJ5ID0gcGFyc2VTZWFyY2hRdWVyeShxdWVyeSk7XG4gICAgY29uc3QgeyBzZWxlY3Q6IF9zZWxlY3QsIC4uLnJlc3RRdWVyeVBhcmFtcyB9ID0gcGFyc2VkUXVlcnk7XG5cbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgZW50aXR5U2VydmljZS5zZWFyY2gocmVzdFF1ZXJ5UGFyYW1zLCBjdHgpO1xuXG4gICAgY29uc3QgeyBoaXRzLCAuLi5yZXN0IH0gPSByZXN1bHRzO1xuICAgIFxuICAgIC8vIEdldCB0aGUgZW50aXR5J3MgcHJpbWFyeSBpZGVudGlmaWVyIGZpZWxkIG5hbWVcbiAgICBjb25zdCBwcmltYXJ5SWRGaWVsZE5hbWUgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuICAgIFxuICAgIC8vIEVuc3VyZSBhbGwgcmVjb3JkcyBoYXZlIGEgY29uc2lzdGVudCAnaWQnIGZpZWxkIGZvciBnZW5lcmljIFVJIGxpc3RpbmdcbiAgICBjb25zdCBub3JtYWxpemVkSGl0cyA9IGhpdHMubWFwKChoaXQ6IGFueSkgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEhpdCA9IHsgLi4uaGl0IH07XG5cbiAgICAgIG5vcm1hbGl6ZWRIaXRbICdlbnRpdHlOYW1lJyBdID0gZW50aXR5TmFtZTtcbiAgICAgIG5vcm1hbGl6ZWRIaXRbICdmdWxsUmVjb3JkJyBdID0gaGl0O1xuICAgICAgXG4gICAgICAvLyBJZiB0aGUgcmVjb3JkIGRvZXNuJ3QgaGF2ZSBhbiAnaWQnIGZpZWxkIGJ1dCBoYXMgdGhlIHByaW1hcnkgaWRlbnRpZmllciBmaWVsZCxcbiAgICAgIC8vIG1hcCBpdCB0byAnaWQnIGZvciBjb25zaXN0ZW50IGdlbmVyaWMgbGlzdGluZ1xuICAgICAgaWYgKCFub3JtYWxpemVkSGl0LmlkICYmIHByaW1hcnlJZEZpZWxkTmFtZSAmJiBub3JtYWxpemVkSGl0WyBwcmltYXJ5SWRGaWVsZE5hbWUgXSkge1xuICAgICAgICBub3JtYWxpemVkSGl0LmlkID0gbm9ybWFsaXplZEhpdFsgcHJpbWFyeUlkRmllbGROYW1lIF07XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIElmIHN0aWxsIG5vIGlkIGZpZWxkLCB0cnkgY29tbW9uIGlkZW50aWZpZXIgcGF0dGVybnNcbiAgICAgIGlmICghbm9ybWFsaXplZEhpdC5pZCkge1xuICAgICAgICBjb25zdCBpZEZpZWxkcyA9IFsgYCR7ZW50aXR5TmFtZX1JZGAsIGAke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1JZGAgXTtcbiAgICAgICAgZm9yIChjb25zdCBpZEZpZWxkIG9mIGlkRmllbGRzKSB7XG4gICAgICAgICAgaWYgKG5vcm1hbGl6ZWRIaXRbIGlkRmllbGQgXSkge1xuICAgICAgICAgICAgbm9ybWFsaXplZEhpdC5pZCA9IG5vcm1hbGl6ZWRIaXRbIGlkRmllbGQgXTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgXG4gICAgICByZXR1cm4gbm9ybWFsaXplZEhpdDtcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3BvbnNlID0ge1xuICAgICAgLi4ucmVzdCxcbiAgICAgIGl0ZW1zOiBub3JtYWxpemVkSGl0cyxcbiAgICB9O1xuXG4gICAgaWYgKHJlcS5kZWJ1Z01vZGUpIHtcbiAgICAgIE9iamVjdC5hc3NpZ24ocmVzcG9uc2UsIHtcbiAgICAgICAgaW5wdXRRdWVyeTogcXVlcnksXG4gICAgICAgIHByb2Nlc3NpbmdUaW1lTXM6IHJlc3VsdHMucHJvY2Vzc2luZ1RpbWVNcyxcbiAgICAgICAgcHJpbWFyeUlkRmllbGROYW1lXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmpzb24ocmVzcG9uc2UpO1xuICB9XG5cbiAgQFBvc3QoJy9pbml0SW5kaWNlcycpXG4gIGFzeW5jIGluaXRTZWFyY2hJbmRpY2VzKFxuICAgIHJlcTogUmVxdWVzdDx7IGJvZHk6IHsgZW50aXRpZXM/OiBzdHJpbmdbXSB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0aWVzOiByZXF1ZXN0ZWRFbnRpdGllcyA9IFtdIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIC8vIGNvbGxlY3QgcHJvdmlkZXIgZm9yIGVudGl0eS1zZXJ2aWNlcyBmcm9tIGNvbnRhaW5lci1oaWVyYXJjaHlcbiAgICBjb25zdCBlbnRpdHlQcm92aWRlcnMgPSB0aGlzLmNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlLFxuICAgIH0pXG4gICAgICAuZmlsdGVyKHAgPT4gKFxuICAgICAgICAvLyBmaWx0ZXIgb3V0IHByb3ZpZGVycyB0aGF0IGRvIG5vdCBoYXZlIGEgZm9yRW50aXR5IHByb3BlcnR5XG4gICAgICAgICEhcC5fcHJvdmlkZXIuZm9yRW50aXR5XG4gICAgICAgICYmIChcbiAgICAgICAgICAvLyBpZiBubyBlbnRpdGllcyBhcmUgcmVxdWVzdGVkLCBpbmNsdWRlIGFsbCBlbnRpdGllc1xuICAgICAgICAgICFyZXF1ZXN0ZWRFbnRpdGllcz8ubGVuZ3RoXG4gICAgICAgICAgLy8gaWYgZW50aXRpZXMgYXJlIHJlcXVlc3RlZCwgaW5jbHVkZSBvbmx5IHRoZSByZXF1ZXN0ZWQgZW50aXRpZXNcbiAgICAgICAgICB8fCByZXF1ZXN0ZWRFbnRpdGllcy5pbmNsdWRlcyhwLl9wcm92aWRlci5mb3JFbnRpdHkgYXMgc3RyaW5nKVxuICAgICAgICApXG4gICAgICApKTtcblxuICAgIGNvbnN0IHJlc3VsdHM6IHtcbiAgICAgIGVycm9yPzogc3RyaW5nO1xuICAgICAgc3VjY2VzczogYm9vbGVhbjtcbiAgICAgIG1lc3NhZ2U/OiBzdHJpbmc7XG5cbiAgICAgIGVudGl0eU5hbWU6IHN0cmluZztcbiAgICAgIGluZGV4TmFtZT86IHN0cmluZztcbiAgICAgIGluZGV4Q29uZmlnPzogYW55O1xuICAgIH1bXSA9IFtdO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZW50aXR5UHJvdmlkZXJzLm1hcChhc3luYyAocHJvdmlkZXIpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSBwcm92aWRlci5fcHJvdmlkZXIuZm9yRW50aXR5IGFzIHN0cmluZztcblxuICAgICAgdHJ5IHtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlID0gcHJvdmlkZXIuX2NvbnRhaW5lci5yZXNvbHZlPEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KFxuICAgICAgICAgIHByb3ZpZGVyLl9wcm92aWRlci5wcm92aWRlXG4gICAgICAgICk7XG4gICAgICAgIGlmICghc2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRW50aXR5U2VydmljZSBjb3VsZCBub3QgYmUgcmVzb2x2ZWQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiBzZWFyY2ggaXMgZW5hYmxlZCBiZWZvcmUgYXR0ZW1wdGluZyB0byBpbml0aWFsaXplXG4gICAgICAgIGlmICghc2VydmljZS5pc1NlYXJjaEVuYWJsZWQoKSkge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICBtZXNzYWdlOiBgU2VhcmNoIGlzIG5vdCBlbmFibGVkIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWAsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXNlYXJjaFNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuaW5pdFNlYXJjaEluZGV4KCk7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcblxuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgICAgIGluZGV4Q29uZmlnOiBjb25maWcsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBtZXNzYWdlOiBgSW5kZXggJHtjb25maWcuaW5kZXhOYW1lfSBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHlgLFxuICAgICAgICB9KTtcblxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgZXJyb3I6IGVycm9yLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIG1lc3NhZ2U6IGBFcnJvciBpbml0aWFsaXppbmcgaW5kZXggZm9yIGVudGl0eSAke2VudGl0eU5hbWV9OiAke2Vycm9yLm1lc3NhZ2V9YCxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHsgcmVzdWx0cyB9KTtcbiAgfVxuXG4gIEBHZXQoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9zZXR0aW5ncycpXG4gIGFzeW5jIGdldEluZGV4U2V0dGluZ3MoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgXG4gICAgLy8gR2V0IGN1cnJlbnQgc2V0dGluZ3MgZnJvbSB0aGUgc2VhcmNoIGVuZ2luZVxuICAgIGNvbnN0IGN1cnJlbnRTZXR0aW5ncyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0SW5kZXhTZXR0aW5ncygpO1xuXG4gICAgLy8gR2V0IGF1dG8tZ2VuZXJhdGVkIHNldHRpbmdzIGZyb20gZW50aXR5IHNjaGVtYVxuICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBjb25zdCBzY2hlbWFTZXR0aW5ncyA9IHNlYXJjaENvbmZpZy5zZXR0aW5ncyB8fCB7fTtcblxuICAgIC8vIENhbGN1bGF0ZSBkZWVwIGRpZmZcbiAgICBjb25zdCB7IGRpZmYsIGhhc0RpZmZlcmVuY2VzIH0gPSB0aGlzLmNhbGN1bGF0ZVNldHRpbmdzRGlmZihjdXJyZW50U2V0dGluZ3MsIHNjaGVtYVNldHRpbmdzKTtcblxuICAgIC8vIEJ1aWxkIGluZm9ybWF0aXZlIHN0YXR1cyBtZXNzYWdlXG4gICAgbGV0IHN0YXR1cyA9ICfinJMgSW5kZXggc2V0dGluZ3MgbWF0Y2ggZW50aXR5IHNjaGVtYSc7XG4gICAgaWYgKGhhc0RpZmZlcmVuY2VzKSB7XG4gICAgICBjb25zdCBzdW1tYXJ5OiBzdHJpbmdbXSA9IFtdO1xuICAgICAgZm9yIChjb25zdCBbZmllbGQsIGZpZWxkRGlmZl0gb2YgT2JqZWN0LmVudHJpZXMoZGlmZikpIHtcbiAgICAgICAgaWYgKGZpZWxkRGlmZi5zdGF0dXMgPT09ICdkaWZmZXJlbnQnICYmIGZpZWxkRGlmZi50eXBlID09PSAnYXJyYXknKSB7XG4gICAgICAgICAgY29uc3QgYWRkZWQgPSAoZmllbGREaWZmIGFzIGFueSkuYWRkZWQ/Lmxlbmd0aCB8fCAwO1xuICAgICAgICAgIGNvbnN0IHJlbW92ZWQgPSAoZmllbGREaWZmIGFzIGFueSkucmVtb3ZlZD8ubGVuZ3RoIHx8IDA7XG4gICAgICAgICAgaWYgKGFkZGVkID4gMCkgc3VtbWFyeS5wdXNoKGAke2FkZGVkfSBuZXcgaW4gc2NoZW1hICgke2ZpZWxkfSlgKTtcbiAgICAgICAgICBpZiAocmVtb3ZlZCA+IDApIHN1bW1hcnkucHVzaChgJHtyZW1vdmVkfSBvbmx5IGluIGluZGV4ICgke2ZpZWxkfSlgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgc3RhdHVzID0gc3VtbWFyeS5sZW5ndGggPiAwIFxuICAgICAgICA/IGDihLnvuI8gRGlmZmVyZW5jZXMgZm91bmQ6ICR7c3VtbWFyeS5qb2luKCcsICcpfWBcbiAgICAgICAgOiAn4oS577iPIFNldHRpbmdzIGRpZmZlciBmcm9tIHNjaGVtYSc7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcy5qc29uKHsgXG4gICAgICBzZXR0aW5nczogY3VycmVudFNldHRpbmdzLFxuICAgICAgc2NoZW1hU2V0dGluZ3MsXG4gICAgICBkaWZmLFxuICAgICAgaGFzRGlmZmVyZW5jZXMsXG4gICAgICBzdGF0dXMsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRGVlcCBub3JtYWxpemUgYW55IHZhbHVlIGZvciBjb25zaXN0ZW50IGNvbXBhcmlzb25cbiAgICogUmVjdXJzaXZlbHkgc29ydHMgb2JqZWN0IGtleXMgYW5kIGhhbmRsZXMgYXJyYXlzL3ByaW1pdGl2ZXNcbiAgICovXG4gIHByaXZhdGUgZGVlcE5vcm1hbGl6ZSh2YWx1ZTogYW55KTogc3RyaW5nIHtcbiAgICAvLyBIYW5kbGUgcHJpbWl0aXZlcyBhbmQgbnVsbC91bmRlZmluZWRcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgdmFsdWUgIT09ICdvYmplY3QnKSB7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUpO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBhcnJheXMgLSByZWN1cnNpdmVseSBub3JtYWxpemUgZWFjaCBpdGVtXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAvLyBQYXJzZSBiYWNrIGVhY2ggbm9ybWFsaXplZCBzdHJpbmcgdG8gYXZvaWQgZG91YmxlIHN0cmluZ2lmaWNhdGlvblxuICAgICAgY29uc3Qgbm9ybWFsaXplZEFycmF5ID0gdmFsdWUubWFwKGl0ZW0gPT4gSlNPTi5wYXJzZSh0aGlzLmRlZXBOb3JtYWxpemUoaXRlbSkpKTtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShub3JtYWxpemVkQXJyYXkpO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBvYmplY3RzIC0gc29ydCBrZXlzIGFuZCByZWN1cnNpdmVseSBub3JtYWxpemUgdmFsdWVzXG4gICAgY29uc3Qgc29ydGVkS2V5cyA9IE9iamVjdC5rZXlzKHZhbHVlKS5zb3J0KCk7XG4gICAgY29uc3Qgbm9ybWFsaXplZE9iajogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIFxuICAgIGZvciAoY29uc3Qga2V5IG9mIHNvcnRlZEtleXMpIHtcbiAgICAgIC8vIFBhcnNlIGJhY2sgdGhlIG5vcm1hbGl6ZWQgc3RyaW5nIGZvciBuZXN0ZWQgc3RydWN0dXJlc1xuICAgICAgdHJ5IHtcbiAgICAgICAgbm9ybWFsaXplZE9ialtrZXldID0gSlNPTi5wYXJzZSh0aGlzLmRlZXBOb3JtYWxpemUodmFsdWVba2V5XSkpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIG5vcm1hbGl6ZWRPYmpba2V5XSA9IHZhbHVlW2tleV07XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KG5vcm1hbGl6ZWRPYmopO1xuICB9XG5cbiAgLyoqXG4gICAqIENhbGN1bGF0ZSBkaWZmIGJldHdlZW4gY3VycmVudCBpbmRleCBzZXR0aW5ncyBhbmQgc2NoZW1hLWRlcml2ZWQgc2V0dGluZ3NcbiAgICogT25seSBjb21wYXJlcyBmaWVsZHMgdGhhdCBleGlzdCBpbiBzY2hlbWEgc2V0dGluZ3MgKGZyYW1ld29yay1tYW5hZ2VkIGZpZWxkcylcbiAgICovXG4gIHByaXZhdGUgY2FsY3VsYXRlU2V0dGluZ3NEaWZmKGN1cnJlbnQ6IFJlY29yZDxzdHJpbmcsIGFueT4sIHNjaGVtYTogUmVjb3JkPHN0cmluZywgYW55Pikge1xuICAgIGNvbnN0IGRpZmY6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBsZXQgaGFzRGlmZmVyZW5jZXMgPSBmYWxzZTtcblxuICAgIC8vIE9OTFkgY29tcGFyZSBmaWVsZHMgdGhhdCBleGlzdCBpbiBzY2hlbWEgc2V0dGluZ3MgKGZyYW1ld29yay1tYW5hZ2VkKVxuICAgIC8vIFR5cGljYWxseTogc2VhcmNoYWJsZUF0dHJpYnV0ZXMsIGZpbHRlcmFibGVBdHRyaWJ1dGVzLCBzb3J0YWJsZUF0dHJpYnV0ZXNcbiAgICBjb25zdCBmaWVsZHNUb0NvbXBhcmUgPSBPYmplY3Qua2V5cyhzY2hlbWEgfHwge30pO1xuXG4gICAgZm9yIChjb25zdCBmaWVsZCBvZiBmaWVsZHNUb0NvbXBhcmUpIHtcbiAgICAgIGNvbnN0IGN1cnJlbnRWYWx1ZSA9IGN1cnJlbnRbZmllbGRdO1xuICAgICAgY29uc3Qgc2NoZW1hVmFsdWUgPSBzY2hlbWFbZmllbGRdO1xuXG4gICAgICAvLyBBcnJheSBjb21wYXJpc29uIChtb3N0IGNvbW1vbiBjYXNlIGZvciBvdXIgbWFuYWdlZCBmaWVsZHMpXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShzY2hlbWFWYWx1ZSkpIHtcbiAgICAgICAgY29uc3QgY3VyckFyciA9IEFycmF5LmlzQXJyYXkoY3VycmVudFZhbHVlKSA/IGN1cnJlbnRWYWx1ZSA6IFtdO1xuICAgICAgICBjb25zdCBzY2hlbWFBcnIgPSBzY2hlbWFWYWx1ZTtcblxuICAgICAgICAvLyBVc2UgZGVlcCBub3JtYWxpemVkIGNvbXBhcmlzb24gZm9yIGFycmF5IGl0ZW1zXG4gICAgICAgIGNvbnN0IGN1cnJOb3JtYWxpemVkU2V0ID0gbmV3IFNldChjdXJyQXJyLm1hcCgoaXRlbTogYW55KSA9PiB0aGlzLmRlZXBOb3JtYWxpemUoaXRlbSkpKTtcbiAgICAgICAgY29uc3Qgc2NoZW1hTm9ybWFsaXplZFNldCA9IG5ldyBTZXQoc2NoZW1hQXJyLm1hcCgoaXRlbTogYW55KSA9PiB0aGlzLmRlZXBOb3JtYWxpemUoaXRlbSkpKTtcblxuICAgICAgICBjb25zdCBhZGRlZCA9IHNjaGVtYUFyci5maWx0ZXIoKGl0ZW06IGFueSkgPT4gIWN1cnJOb3JtYWxpemVkU2V0Lmhhcyh0aGlzLmRlZXBOb3JtYWxpemUoaXRlbSkpKTtcbiAgICAgICAgY29uc3QgcmVtb3ZlZCA9IGN1cnJBcnIuZmlsdGVyKChpdGVtOiBhbnkpID0+ICFzY2hlbWFOb3JtYWxpemVkU2V0Lmhhcyh0aGlzLmRlZXBOb3JtYWxpemUoaXRlbSkpKTtcblxuICAgICAgICBjb25zdCBpc0RpZmZlcmVudCA9IGFkZGVkLmxlbmd0aCA+IDAgfHwgcmVtb3ZlZC5sZW5ndGggPiAwO1xuICAgICAgICBpZiAoaXNEaWZmZXJlbnQpIGhhc0RpZmZlcmVuY2VzID0gdHJ1ZTtcblxuICAgICAgICAvLyBPbmx5IGluY2x1ZGUgZGV0YWlsZWQgYnJlYWtkb3duIGlmIHRoZXJlIEFSRSBkaWZmZXJlbmNlc1xuICAgICAgICBpZiAoaXNEaWZmZXJlbnQpIHtcbiAgICAgICAgICBkaWZmW2ZpZWxkXSA9IHtcbiAgICAgICAgICAgIHR5cGU6ICdhcnJheScsXG4gICAgICAgICAgICBhZGRlZCxcbiAgICAgICAgICAgIHJlbW92ZWQsXG4gICAgICAgICAgICBzdGF0dXM6ICdkaWZmZXJlbnQnXG4gICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBDb25jaXNlIGZvciBcInNhbWVcIiBzdGF0dXNcbiAgICAgICAgICBkaWZmW2ZpZWxkXSA9IHtcbiAgICAgICAgICAgIHR5cGU6ICdhcnJheScsXG4gICAgICAgICAgICBzdGF0dXM6ICdzYW1lJ1xuICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgfSBlbHNlIGlmIChzY2hlbWFWYWx1ZSAhPT0gbnVsbCAmJiB0eXBlb2Ygc2NoZW1hVmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICAgIC8vIE9iamVjdCBjb21wYXJpc29uIHVzaW5nIGRlZXAgbm9ybWFsaXphdGlvblxuICAgICAgICBjb25zdCBjdXJyZW50Tm9ybWFsaXplZCA9IHRoaXMuZGVlcE5vcm1hbGl6ZShjdXJyZW50VmFsdWUpO1xuICAgICAgICBjb25zdCBzY2hlbWFOb3JtYWxpemVkID0gdGhpcy5kZWVwTm9ybWFsaXplKHNjaGVtYVZhbHVlKTtcbiAgICAgICAgY29uc3QgaXNEaWZmZXJlbnQgPSBjdXJyZW50Tm9ybWFsaXplZCAhPT0gc2NoZW1hTm9ybWFsaXplZDtcblxuICAgICAgICBpZiAoaXNEaWZmZXJlbnQpIGhhc0RpZmZlcmVuY2VzID0gdHJ1ZTtcblxuICAgICAgICBkaWZmW2ZpZWxkXSA9IHtcbiAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICBjdXJyZW50OiBjdXJyZW50VmFsdWUsXG4gICAgICAgICAgc2NoZW1hOiBzY2hlbWFWYWx1ZSxcbiAgICAgICAgICBzdGF0dXM6IGlzRGlmZmVyZW50ID8gJ2RpZmZlcmVudCcgOiAnc2FtZSdcbiAgICAgICAgfTtcblxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gU2NhbGFyIGNvbXBhcmlzb24gKHN0cmluZywgbnVtYmVyLCBib29sZWFuLCBudWxsLCB1bmRlZmluZWQpXG4gICAgICAgIGNvbnN0IGlzRGlmZmVyZW50ID0gY3VycmVudFZhbHVlICE9PSBzY2hlbWFWYWx1ZTtcbiAgICAgICAgXG4gICAgICAgIGlmIChpc0RpZmZlcmVudCkgaGFzRGlmZmVyZW5jZXMgPSB0cnVlO1xuXG4gICAgICAgIGRpZmZbZmllbGRdID0ge1xuICAgICAgICAgIHR5cGU6ICdzY2FsYXInLFxuICAgICAgICAgIGN1cnJlbnQ6IGN1cnJlbnRWYWx1ZSxcbiAgICAgICAgICBzY2hlbWE6IHNjaGVtYVZhbHVlLFxuICAgICAgICAgIHN0YXR1czogaXNEaWZmZXJlbnQgPyAnZGlmZmVyZW50JyA6ICdzYW1lJ1xuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7IGRpZmYsIGhhc0RpZmZlcmVuY2VzIH07XG4gIH1cblxuICBAUHV0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vc2V0dGluZ3MnLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgc2V0dGluZ3M6IHsgZGF0YXR5cGU6ICdvYmplY3QnLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyB1cGRhdGVJbmRleFNldHRpbmdzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBzZXR0aW5nczogUmVjb3JkPHN0cmluZywgYW55PjsgfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcbiAgICBjb25zdCB7IHNldHRpbmdzIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLnVwZGF0ZUluZGV4U2V0dGluZ3Moc2V0dGluZ3MsIHRydWUpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHJlc3VsdCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgbWVzc2FnZTogJ0luZGV4IHNldHRpbmdzIHVwZGF0ZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vcmVzZXQtc2V0dGluZ3MnKVxuICBhc3luYyByZXNldEluZGV4U2V0dGluZ3MoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5yZXNldEluZGV4U2V0dGluZ3MoKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdJbmRleCBzZXR0aW5ncyByZXNldCB0byBNZWlsaXNlYXJjaCBkZWZhdWx0cydcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vYXBwbHktZGVmYXVsdC1zZXR0aW5ncycpXG4gIGFzeW5jIGFwcGx5RGVmYXVsdFNldHRpbmdzKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBcbiAgICAvLyBHZXQgc2NoZW1hLWRlcml2ZWQgc2V0dGluZ3NcbiAgICBjb25zdCBzZWFyY2hDb25maWcgPSBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgY29uc3Qgc2NoZW1hU2V0dGluZ3MgPSBzZWFyY2hDb25maWcuc2V0dGluZ3MgfHwge307XG5cbiAgICAvLyBBcHBseSB0aGUgc2NoZW1hLWRlcml2ZWQgc2V0dGluZ3NcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLnVwZGF0ZUluZGV4U2V0dGluZ3Moc2NoZW1hU2V0dGluZ3MsIHRydWUpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgYXBwbGllZFNldHRpbmdzOiBzY2hlbWFTZXR0aW5ncyxcbiAgICAgIG1lc3NhZ2U6ICdJbmRleCBzZXR0aW5ncyBzeW5jZWQgc3VjY2Vzc2Z1bGx5IGZyb20gZW50aXR5IHNjaGVtYSdcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vaW5pdCcpXG4gIGFzeW5jIGluaXRTaW5nbGVFbnRpdHlJbmRleChcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgaWYgKCFlbnRpdHlTZXJ2aWNlLmlzU2VhcmNoRW5hYmxlZCgpKSB7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oe1xuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgbWVzc2FnZTogYFNlYXJjaCBpcyBub3QgZW5hYmxlZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuaW5pdFNlYXJjaEluZGV4KCk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgY29uZmlnLFxuICAgICAgbWVzc2FnZTogYEluZGV4ICR7Y29uZmlnLmluZGV4TmFtZX0gaW5pdGlhbGl6ZWQgc3VjY2Vzc2Z1bGx5YCxcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vcmVjcmVhdGUnKVxuICBhc3luYyByZWNyZWF0ZUluZGV4KFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keToge1xuICAgICAgICByZXN5bmNEb2N1bWVudHM/OiBib29sZWFuO1xuICAgICAgICBzeW5jTWV0aG9kPzogJ2RpcmVjdCcgfCAncXVldWUnO1xuICAgICAgICBiYXRjaFNpemU/OiBudW1iZXI7XG4gICAgICAgIHF1ZXVlVXJsPzogc3RyaW5nO1xuICAgICAgfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG4gICAgY29uc3QgeyBcbiAgICAgIHJlc3luY0RvY3VtZW50cyA9IGZhbHNlLCBcbiAgICAgIHN5bmNNZXRob2QgPSAnZGlyZWN0JyxcbiAgICAgIGJhdGNoU2l6ZSA9IDUwLFxuICAgICAgcXVldWVVcmwgXG4gICAgfSA9IHJlcS5ib2R5IHx8IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IG9sZENvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZWNyZWF0aW5nIGluZGV4IGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWAsIHsgb2xkQ29uZmlnIH0pO1xuXG4gICAgLy8gRGVsZXRlIGV4aXN0aW5nIGluZGV4XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhgRGVsZXRpbmcgZXhpc3RpbmcgaW5kZXg6ICR7b2xkQ29uZmlnLmluZGV4TmFtZX1gKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc2VhcmNoU2VydmljZS5kZWxldGVTZWFyY2hJbmRleCh0cnVlKTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKGBDb3VsZCBub3QgZGVsZXRlIGluZGV4IChtaWdodCBub3QgZXhpc3QpOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuXG4gICAgLy8gUmVpbml0aWFsaXplIGluZGV4IHdpdGggbmV3IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZWluaXRpYWxpemluZyBpbmRleCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmluaXRTZWFyY2hJbmRleCgpO1xuICAgIGNvbnN0IG5ld0NvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcblxuICAgIGxldCByZXN5bmNSZXN1bHQgPSBudWxsO1xuXG4gICAgLy8gT3B0aW9uYWxseSByZXN5bmMgYWxsIGRvY3VtZW50c1xuICAgIGlmIChyZXN5bmNEb2N1bWVudHMpIHtcbiAgICAgIGlmIChzeW5jTWV0aG9kID09PSAncXVldWUnKSB7XG4gICAgICAgIC8vIFF1ZXVlLWJhc2VkIHN5bmMgKG5vbi1ibG9ja2luZywgZm9yIGxhcmdlIGRhdGFzZXRzKVxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBRdWV1ZWluZyBkb2N1bWVudHMgZm9yIHJlc3luYzogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICByZXN5bmNSZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXVlRG9jdW1lbnRzRm9yUmVzeW5jKGVudGl0eU5hbWUsIHsgYmF0Y2hTaXplLCBxdWV1ZVVybCB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIERpcmVjdCBzeW5jIChibG9ja2luZywgaW1tZWRpYXRlIGNvbmZpcm1hdGlvbilcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgRGlyZWN0bHkgcmVzeW5jaW5nIGRvY3VtZW50czogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICByZXN5bmNSZXN1bHQgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLnJlc3luY0FsbERvY3VtZW50cyh7IGJhdGNoU2l6ZSB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBvbGRJbmRleE5hbWU6IG9sZENvbmZpZy5pbmRleE5hbWUsXG4gICAgICBuZXdJbmRleE5hbWU6IG5ld0NvbmZpZy5pbmRleE5hbWUsXG4gICAgICBzeW5jTWV0aG9kOiByZXN5bmNEb2N1bWVudHMgPyBzeW5jTWV0aG9kIDogbnVsbCxcbiAgICAgIG1lc3NhZ2U6IGBJbmRleCByZWNyZWF0ZWQgc3VjY2Vzc2Z1bGx5JHtyZXN5bmNEb2N1bWVudHMgPyBgICgke3N5bmNNZXRob2R9IHN5bmM6ICR7cmVzeW5jUmVzdWx0Py5wcm9jZXNzZWRDb3VudCB8fCAwfSBkb2N1bWVudHMpYCA6ICcnfWAsXG4gICAgICByZXN5bmNSZXN1bHQsXG4gICAgICBjb25maWdzOiB7IG9sZENvbmZpZywgbmV3Q29uZmlnIH1cbiAgICB9KTtcbiAgfVxuXG4gIEBEZWxldGUoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfScpXG4gIGFzeW5jIGRlbGV0ZUluZGV4KFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZGVsZXRlU2VhcmNoSW5kZXgodHJ1ZSk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgbWVzc2FnZTogJ0luZGV4IGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5J1xuICAgIH0pO1xuICB9XG5cbiAgQERlbGV0ZSgnL2luZGljZXMve2VudGl0eU5hbWV9L2RvY3VtZW50cycpXG4gIGFzeW5jIGNsZWFyRW50aXR5SW5kZXgoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpLmRlbGV0ZUFsbERvY3VtZW50cyhjb25maWcuaW5kZXhOYW1lISwgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICBtZXNzYWdlOiAnQWxsIGRvY3VtZW50cyBjbGVhcmVkIGZyb20gaW5kZXgnXG4gICAgfSk7XG4gIH1cblxuICBAUG9zdCgnL2luZGljZXMve2VudGl0eU5hbWV9L3Jlc3luYycpXG4gIGFzeW5jIHJlc3luY0VudGl0eVJlY29yZHMoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IGJhdGNoU2l6ZT86IG51bWJlcjsgcXVldWVVcmw/OiBzdHJpbmc7IGJ5QmF0Y2g/OiBib29sZWFuIH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuICAgIGNvbnN0IHsgYmF0Y2hTaXplID0gNTAsIHF1ZXVlVXJsLCBieUJhdGNoID0gdHJ1ZSB9ID0gcmVxLmJvZHkgfHwge307XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXVlRG9jdW1lbnRzRm9yUmVzeW5jKGVudGl0eU5hbWUsIHsgYmF0Y2hTaXplLCBxdWV1ZVVybCwgYnlCYXRjaCB9KTtcblxuICAgIGxldCBtZXNzYWdlID0gYFF1ZXVlZCAke3Jlc3VsdC5wcm9jZXNzZWRDb3VudH0gcmVjb3JkcyBmb3IgcmUtaW5kZXhpbmdgO1xuICAgIGlmIChyZXN1bHQuZmFpbGVkQ291bnQgPiAwKSB7XG4gICAgICBtZXNzYWdlICs9IGAsICR7cmVzdWx0LmZhaWxlZENvdW50fSByZWNvcmRzIGZhaWxlZCB0byBiZSBxdWV1ZWRgO1xuICAgIH1cblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBtZXNzYWdlLFxuICAgICAgc3VjY2VzczogcmVzdWx0LnByb2Nlc3NlZENvdW50ID4gMCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICAuLi5yZXN1bHQsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUXVldWUgZG9jdW1lbnRzIGZvciBhc3luYyByZXN5bmMgdmlhIFNRU1xuICAgKiBTaGFyZWQgbG9naWMgdXNlZCBieSByZXN5bmMgYW5kIHJlY3JlYXRlIGVuZHBvaW50c1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBxdWV1ZURvY3VtZW50c0ZvclJlc3luYyhcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgb3B0aW9uczoge1xuICAgICAgYmF0Y2hTaXplPzogbnVtYmVyO1xuICAgICAgcXVldWVVcmw/OiBzdHJpbmc7XG4gICAgICBieUJhdGNoPzogYm9vbGVhbjtcbiAgICB9XG4gICk6IFByb21pc2U8e1xuICAgIHByb2Nlc3NlZENvdW50OiBudW1iZXI7XG4gICAgZmFpbGVkQ291bnQ6IG51bWJlcjtcbiAgICB0b3RhbEl0ZXJhdGlvbnM6IG51bWJlcjtcbiAgfT4ge1xuICAgIGNvbnN0IHsgYmF0Y2hTaXplID0gNTAsIHF1ZXVlVXJsLCBieUJhdGNoID0gdHJ1ZSB9ID0gb3B0aW9ucztcbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgLy8gVXNlIHByb3ZpZGVkIHF1ZXVlVXJsIG9yIHJlc29sdmUgZnJvbSBlbnZpcm9ubWVudFxuICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FIH0pO1xuICAgIGNvbnN0IHJlc29sdmVkUXVldWVVcmwgPSBxdWV1ZVVybCB8fCBFbnZpcm9ubWVudC5xdWV1ZVVybChxdWV1ZU5hbWUpO1xuXG4gICAgaWYgKCFyZXNvbHZlZFF1ZXVlVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXVlIFVSTCBub3QgcHJvdmlkZWQgYW5kIGVudi1rZXkgWyR7U0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FfV0gaXMgbm90IGNvbmZpZ3VyZWRgKTtcbiAgICB9XG5cbiAgICBsZXQgZmFpbGVkQ291bnQgPSAwO1xuICAgIGxldCBwcm9jZXNzZWRDb3VudCA9IDA7XG4gICAgbGV0IGN1cnNvcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gJ2luaXQnO1xuICAgIGxldCBpdGVyYXRpb25Db3VudCA9IDA7XG4gICAgY29uc3QgbWF4SXRlcmF0aW9ucyA9IDEwMDAwMDtcblxuICAgIHdoaWxlICghIWN1cnNvciAmJiBpdGVyYXRpb25Db3VudCA8IG1heEl0ZXJhdGlvbnMpIHtcbiAgICAgIGl0ZXJhdGlvbkNvdW50Kys7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZldGNoaW5nICR7ZW50aXR5TmFtZX0gcmVjb3JkcyBmcm9tIGN1cnNvcjogJHtjdXJzb3J9YCk7XG5cbiAgICAgIGNvbnN0IHF1ZXJ5UmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5xdWVyeSh7XG4gICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICBsaW1pdDogYmF0Y2hTaXplLFxuICAgICAgICAgIGN1cnNvcjogY3Vyc29yID09PSAnaW5pdCcgPyB1bmRlZmluZWQgOiBjdXJzb3JcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGlmICghcXVlcnlSZXN1bHQuZGF0YSB8fCBxdWVyeVJlc3VsdC5kYXRhLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgaWYgKGJ5QmF0Y2gpIHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IFByb21pc2UuYWxsKHF1ZXJ5UmVzdWx0LmRhdGEubWFwKGFzeW5jIChyZWMpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgZW50aXR5U2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKHJlYyk7XG4gICAgICAgIH0pKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHNlbmRRdWV1ZU1lc3NhZ2UocmVzb2x2ZWRRdWV1ZVVybCwge1xuICAgICAgICAgICAgZGF0YSxcbiAgICAgICAgICAgIGV2ZW50TmFtZTogXCJSRVNZTkNcIixcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcHJvY2Vzc2VkQ291bnQgKz0gZGF0YS5sZW5ndGg7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcXVldWVpbmcgYmF0Y2ggZm9yIHN5bmM6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGVudGl0eU5hbWUsIGJhdGNoU2l6ZSwgZXJyb3IgfSk7XG4gICAgICAgICAgZmFpbGVkQ291bnQgKz0gZGF0YS5sZW5ndGg7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICAgIHF1ZXJ5UmVzdWx0LmRhdGEubWFwKGFzeW5jIChlbnRpdHlSZWNvcmQpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGNvbnN0IHRyYW5zZm9ybWVkID0gYXdhaXQgZW50aXR5U2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eVJlY29yZCk7XG4gICAgICAgICAgICAgIGF3YWl0IHNlbmRRdWV1ZU1lc3NhZ2UocmVzb2x2ZWRRdWV1ZVVybCwge1xuICAgICAgICAgICAgICBkYXRhOiB0cmFuc2Zvcm1lZCxcbiAgICAgICAgICAgICAgZXZlbnROYW1lOiBcIlJFU1lOQ1wiLFxuICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHByb2Nlc3NlZENvdW50Kys7XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcXVldWVpbmcgcmVjb3JkIGZvciBzeW5jOiAke2Vycm9yLm1lc3NhZ2V9YCwgeyBlbnRpdHlOYW1lLCBlcnJvciB9KTtcbiAgICAgICAgICAgIGZhaWxlZENvdW50Kys7XG4gICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGN1cnNvciA9IHF1ZXJ5UmVzdWx0LmN1cnNvciA/PyB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIuaW5mbyhgUXVldWUgc3luYyBjb21wbGV0ZWQgZm9yICR7ZW50aXR5TmFtZX1gLCB7XG4gICAgICBwcm9jZXNzZWRDb3VudCxcbiAgICAgIGZhaWxlZENvdW50LFxuICAgICAgdG90YWxJdGVyYXRpb25zOiBpdGVyYXRpb25Db3VudFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHByb2Nlc3NlZENvdW50LFxuICAgICAgZmFpbGVkQ291bnQsXG4gICAgICB0b3RhbEl0ZXJhdGlvbnM6IGl0ZXJhdGlvbkNvdW50LFxuICAgIH07XG4gIH1cblxuICBAR2V0KCcvcXVldWUtaW5mbycpXG4gIGFzeW5jIGdldFF1ZXVlSW5mbyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IHF1ZXVlVXJsOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBxdWV1ZVVybCB9ID0gcmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVyczsgIFxuXG4gICAgLy8gVXNlIHByb3ZpZGVkIHF1ZXVlVXJsIG9yIHJlc29sdmUgZnJvbSBlbnZpcm9ubWVudFxuICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FIH0pO1xuICAgIGNvbnN0IHJlc29sdmVkUXVldWVVcmwgPSBxdWV1ZVVybCB8fCBFbnZpcm9ubWVudC5xdWV1ZVVybChxdWV1ZU5hbWUpO1xuXG4gICAgY29uc3QgaW5mbyA9IGF3YWl0IGdldFF1ZXVlTWVzc2FnZU1ldGFkYXRhKHJlc29sdmVkUXVldWVVcmwpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHsgaW5mbyB9KTtcbiAgfVxuXG4gIEBQdXQoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfScsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBkb2N1bWVudHM6IHsgZGF0YXR5cGU6ICdhcnJheScsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIHVwZGF0ZURvY3VtZW50cyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgZG9jdW1lbnRzOiBhbnlbXSB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCB7IGRvY3VtZW50cyB9ID0gcmVxLmJvZHk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLnVwZGF0ZURvY3VtZW50cyhkb2N1bWVudHMsIHRydWUpO1xuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICByZXN1bHQsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIG1lc3NhZ2U6ICdEb2N1bWVudHMgdXBkYXRlZCBzdWNjZXNzZnVsbHknLFxuICAgIH0pO1xuICB9XG5cbiAgQERlbGV0ZSgnL3JlY29yZHMve2VudGl0eU5hbWV9L2J5LWlkcycsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBpZHM6IHsgZGF0YXR5cGU6ICdhcnJheScsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIGRlbGV0ZURvY3VtZW50c0J5SWRzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBpZHM6IHN0cmluZ1tdIH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHsgaWRzIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpLmRlbGV0ZURvY3VtZW50cyhpZHMsIGNvbmZpZy5pbmRleE5hbWUhLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdEb2N1bWVudHMgZGVsZXRlZCBzdWNjZXNzZnVsbHknXG4gICAgfSk7XG4gIH1cblxuICBARGVsZXRlKCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0vYnktZmlsdGVyJywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIGZpbHRlcjogeyBkYXRhdHlwZTogJ29iamVjdCcsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIGRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBmaWx0ZXI6IGFueSB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCB7IGZpbHRlciB9ID0gcmVxLmJvZHk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKGZpbHRlciwgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICBtZXNzYWdlOiAnRG9jdW1lbnRzIG1hdGNoaW5nIGZpbHRlciBoYXZlIGJlZW4gcXVldWVkIGZvciBkZWxldGlvbi4nXG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBwcm92aWRlciA9IHRoaXMuY29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWUsXG4gICAgICBmb3JFbnRpdHk6IGVudGl0eU5hbWUsXG4gICAgfSk7XG5cbiAgICBpZiAocHJvdmlkZXIubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHByb3ZpZGVyIGZvdW5kIGZvciBlbnRpdHktc2VydmljZSBmb3IgJHtlbnRpdHlOYW1lfWApO1xuICAgIH1cblxuICAgIHJldHVybiBwcm92aWRlclsgMCBdLl9jb250YWluZXIucmVzb2x2ZTxCYXNlRW50aXR5U2VydmljZTxhbnk+Pihwcm92aWRlclsgMCBdLl9wcm92aWRlci5wcm92aWRlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IGVudGl0eVNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpO1xuXG4gICAgaWYgKCFzZWFyY2hTZXJ2aWNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VhcmNoU2VydmljZTtcbiAgfVxufSJdfQ==