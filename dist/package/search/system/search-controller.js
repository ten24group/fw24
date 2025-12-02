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
                const config = searchService.getSearchIndexConfig();
                let resyncResult;
                try {
                    resyncResult = await this.queueDocumentsForResync(entityName, { batchSize: 50, queueUrl: undefined, byBatch: true });
                }
                catch (error) {
                    this.logger.error(`Error resyncing records for entity ${entityName}: ${error.message}`, { error });
                    resyncResult = {
                        success: false,
                        message: `Error resyncing records for entity ${entityName}: ${error.message}`,
                    };
                }
                results.push({
                    entityName,
                    indexName: config.indexName,
                    indexConfig: config,
                    resyncResult,
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
            throw new Error(`Queue URL not provided for resyncing records for entity ${entityName} and env-key [${SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME}] is not configured`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9zZWFyY2gtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFFQSwwQ0FBNkU7QUFDN0Usc0ZBQTBFO0FBRTFFLGlEQUFzRTtBQUN0RSxpQ0FBMkM7QUFHM0MsdUNBQTJEO0FBQzNELGtEQUFtRDtBQUNuRCx5Q0FBMkM7QUFFM0MsSUFBWSwwQkFFWDtBQUZELFdBQVksMEJBQTBCO0lBQ3BDLHlGQUEyRCxDQUFBO0FBQzdELENBQUMsRUFGVywwQkFBMEIsMENBQTFCLDBCQUEwQixRQUVyQztBQUVELGtEQUFrRDtBQUNsRCxrSEFBa0g7QUFDbEgsaUNBQWlDO0FBQ2pDLGFBQWE7QUFDYixvRUFBb0U7QUFDcEUsU0FBUztBQUNULEtBQUs7QUFDRSxJQUFNLHNCQUFzQixHQUE1QixNQUFNLHNCQUF1QixTQUFRLHNDQUFhO0lBQ2Q7SUFBekMsWUFBeUMsU0FBdUI7UUFDOUQsS0FBSyxFQUFFLENBQUM7UUFEK0IsY0FBUyxHQUFULFNBQVMsQ0FBYztJQUVoRSxDQUFDO0lBRUQsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUE0QixFQUFFLFFBQWlCLElBQUksQ0FBQztJQUcvRCxBQUFOLEtBQUssQ0FBQyxXQUFXLENBQUMsUUFBaUIsRUFBRSxRQUFrQjtRQUNyRCw2Q0FBNkM7UUFDN0MsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyx1QkFBdUIsQ0FBQztZQUM3RCxJQUFJLEVBQUUsU0FBUztZQUNmLCtCQUErQixFQUFFLElBQUk7U0FDdEMsQ0FBQzthQUNDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUNWLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFBO1FBQ2hDLENBQUMsQ0FBQyxDQUFDO1FBRUwsTUFBTSxXQUFXLEdBQVUsRUFBRSxDQUFDO1FBRTlCLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxRQUFRLEVBQUUsRUFBRTtZQUV2RCxNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsU0FBUyxDQUFDLFNBQW1CLENBQUM7WUFFMUQsSUFBSSxDQUFDO2dCQUVILG1EQUFtRDtnQkFDbkQsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQ3pDLFFBQVEsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUMzQixDQUFDO2dCQUVGLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztvQkFDYixNQUFNLElBQUksS0FBSyxDQUFDLFdBQVcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLHlCQUF5QixVQUFVLEVBQUUsQ0FBQyxDQUFDO2dCQUN0RyxDQUFDO2dCQUVELE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUNqRCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7b0JBQ25CLE1BQU0sSUFBSSxLQUFLLENBQUMsdUNBQXVDLFVBQVUsRUFBRSxDQUFDLENBQUM7Z0JBQ3ZFLENBQUM7Z0JBRUQsTUFBTSxTQUFTLEdBQUcsTUFBTSxhQUFhLENBQUMsWUFBWSxFQUFFLENBQUM7Z0JBRXJELFdBQVcsQ0FBQyxJQUFJLENBQUM7b0JBQ2YsR0FBRyxTQUFTO29CQUNaLFVBQVU7b0JBQ1YsU0FBUyxFQUFFLFNBQVMsQ0FBQyxHQUFHO2lCQUN6QixDQUFDLENBQUM7WUFFTCxDQUFDO1lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztnQkFFcEIsV0FBVyxDQUFDLElBQUksQ0FBQztvQkFDZixTQUFTLEVBQUUsSUFBSSxVQUFVLDJCQUEyQjtvQkFDcEQsVUFBVTtvQkFDVixLQUFLLEVBQUUsS0FBSyxDQUFDLE9BQU87aUJBQ3JCLENBQUMsQ0FBQztnQkFFSCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUMzQixDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUVKLE9BQU8sUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO0lBQ2pELENBQUM7SUFFRDs7O09BR0c7SUFHRyxBQUFOLEtBQUssQ0FBQyxlQUFlLENBQ25CLEdBQThDLEVBQzlDLEdBQWE7UUFFYixNQUFNLEVBQUUsVUFBVSxFQUFFLEdBQUcsR0FBRyxDQUFDLGNBQWMsSUFBSSxFQUFFLENBQUM7UUFFaEQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBRTlELE1BQU0sU0FBUyxHQUFHLE1BQU0sYUFBYSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBQ3JELE1BQU0sVUFBVSxHQUFHLE1BQU0sYUFBYSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBRXZELE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQztZQUNkLE9BQU8sRUFBRTtnQkFDUCxTQUFTO2dCQUNULFVBQVU7Z0JBQ1YsVUFBVTthQUNYO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUdLLEFBQU4sS0FBSyxDQUFDLGlCQUFpQixDQUFDLFFBQWlCLEVBQUUsUUFBa0I7UUFDM0QsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyx1QkFBdUIsQ0FBQztZQUM3RCxJQUFJLEVBQUUsU0FBUztZQUNmLCtCQUErQixFQUFFLElBQUk7U0FDdEMsQ0FBQzthQUNDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBRXhDLE1BQU0sWUFBWSxHQU1aLEVBQUUsQ0FBQztRQUVULE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxRQUFRLEVBQUUsRUFBRTtZQUN2RCxNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsU0FBUyxDQUFDLFNBQW1CLENBQUM7WUFFMUQsSUFBSSxDQUFDO2dCQUNILE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUN6QyxRQUFRLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FDM0IsQ0FBQztnQkFFRixJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7b0JBQ2IsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQ0FBZ0MsVUFBVSxFQUFFLENBQUMsQ0FBQztnQkFDaEUsQ0FBQztnQkFFRCxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsZUFBZSxFQUFFLENBQUM7Z0JBQ2hELElBQUksV0FBVyxHQUFHLEtBQUssQ0FBQztnQkFDeEIsSUFBSSxTQUFTLEdBQUcsRUFBRSxDQUFDO2dCQUVuQixJQUFJLGFBQWEsRUFBRSxDQUFDO29CQUNsQixNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztvQkFDakQsSUFBSSxhQUFhLEVBQUUsQ0FBQzt3QkFDbEIsTUFBTSxNQUFNLEdBQUcsTUFBTSxhQUFhLENBQUMsb0JBQW9CLEVBQUUsQ0FBQzt3QkFDMUQsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFVLENBQUM7d0JBQzlCLFdBQVcsR0FBRyxNQUFNLGFBQWEsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUM7b0JBQ3ZFLENBQUM7Z0JBQ0gsQ0FBQztnQkFFRCxZQUFZLENBQUMsSUFBSSxDQUFDO29CQUNoQixVQUFVO29CQUNWLGFBQWE7b0JBQ2IsV0FBVztvQkFDWCxTQUFTO2lCQUNWLENBQUMsQ0FBQztZQUVMLENBQUM7WUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO2dCQUNwQixZQUFZLENBQUMsSUFBSSxDQUFDO29CQUNoQixVQUFVO29CQUNWLGFBQWEsRUFBRSxLQUFLO29CQUNwQixLQUFLLEVBQUUsS0FBSyxDQUFDLE9BQU87aUJBQ3JCLENBQUMsQ0FBQztZQUNMLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBRUosT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsUUFBUSxFQUFFLFlBQVksRUFBRSxDQUFDLENBQUM7SUFDbkQsQ0FBQztJQUdLLEFBQU4sS0FBSyxDQUFDLGlCQUFpQixDQUNyQixHQUFrRSxFQUNsRSxHQUFhO1FBRWIsTUFBTSxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsR0FBRyxHQUFHLENBQUMsY0FBYyxDQUFDO1FBQ3RELE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUN4RCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDOUQsTUFBTSxrQkFBa0IsR0FBRyxhQUFhLENBQUMsOEJBQThCLEVBQUUsQ0FBQztRQUUxRSxNQUFNLEdBQUcsR0FBRyxNQUFNLGFBQWEsQ0FBQyxXQUFXLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFeEQsR0FBRyxDQUFFLElBQUksQ0FBRSxHQUFHLEdBQUcsQ0FBRSxJQUFJLENBQUUsSUFBSSxHQUFHLENBQUUsa0JBQTRCLENBQUUsQ0FBQztRQUNqRSxHQUFHLENBQUUsWUFBWSxDQUFFLEdBQUcsRUFBRSxHQUFHLEdBQUcsRUFBRSxDQUFDO1FBQ2pDLEdBQUcsQ0FBRSxZQUFZLENBQUUsR0FBRyxVQUFVLENBQUM7UUFFakMsT0FBTyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3ZCLENBQUM7SUFHSyxBQUFOLEtBQUssQ0FBQyxnQkFBZ0IsQ0FDcEIsR0FHRSxFQUNGLEdBQWEsRUFDYixHQUFzQjtRQUd0QixNQUFNLEVBQUUsVUFBVSxFQUFFLEdBQUcsR0FBRyxDQUFDLGNBQWMsSUFBSSxFQUFFLENBQUM7UUFFaEQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3hELE1BQU0sS0FBSyxHQUFHLElBQUEsZ0JBQVEsRUFBQyxHQUFHLENBQUMscUJBQXFCLENBQUMsQ0FBQztRQUVsRCxNQUFNLFdBQVcsR0FBRyxJQUFBLCtCQUFnQixFQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzVDLE1BQU0sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsZUFBZSxFQUFFLEdBQUcsV0FBVyxDQUFDO1FBRTVELE1BQU0sT0FBTyxHQUFHLE1BQU0sYUFBYSxDQUFDLE1BQU0sQ0FBQyxlQUFlLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFFakUsTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLElBQUksRUFBRSxHQUFHLE9BQU8sQ0FBQztRQUVsQyxpREFBaUQ7UUFDakQsTUFBTSxrQkFBa0IsR0FBRyxhQUFhLENBQUMsOEJBQThCLEVBQUUsQ0FBQztRQUUxRSx5RUFBeUU7UUFDekUsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQVEsRUFBRSxFQUFFO1lBQzNDLE1BQU0sYUFBYSxHQUFHLEVBQUUsR0FBRyxHQUFHLEVBQUUsQ0FBQztZQUVqQyxhQUFhLENBQUUsWUFBWSxDQUFFLEdBQUcsVUFBVSxDQUFDO1lBQzNDLGFBQWEsQ0FBRSxZQUFZLENBQUUsR0FBRyxHQUFHLENBQUM7WUFFcEMsaUZBQWlGO1lBQ2pGLGdEQUFnRDtZQUNoRCxJQUFJLENBQUMsYUFBYSxDQUFDLEVBQUUsSUFBSSxrQkFBa0IsSUFBSSxhQUFhLENBQUUsa0JBQWtCLENBQUUsRUFBRSxDQUFDO2dCQUNuRixhQUFhLENBQUMsRUFBRSxHQUFHLGFBQWEsQ0FBRSxrQkFBa0IsQ0FBRSxDQUFDO1lBQ3pELENBQUM7WUFFRCx1REFBdUQ7WUFDdkQsSUFBSSxDQUFDLGFBQWEsQ0FBQyxFQUFFLEVBQUUsQ0FBQztnQkFDdEIsTUFBTSxRQUFRLEdBQUcsQ0FBRSxHQUFHLFVBQVUsSUFBSSxFQUFFLEdBQUcsVUFBVSxDQUFDLFdBQVcsRUFBRSxJQUFJLENBQUUsQ0FBQztnQkFDeEUsS0FBSyxNQUFNLE9BQU8sSUFBSSxRQUFRLEVBQUUsQ0FBQztvQkFDL0IsSUFBSSxhQUFhLENBQUUsT0FBTyxDQUFFLEVBQUUsQ0FBQzt3QkFDN0IsYUFBYSxDQUFDLEVBQUUsR0FBRyxhQUFhLENBQUUsT0FBTyxDQUFFLENBQUM7d0JBQzVDLE1BQU07b0JBQ1IsQ0FBQztnQkFDSCxDQUFDO1lBQ0gsQ0FBQztZQUVELE9BQU8sYUFBYSxDQUFDO1FBQ3ZCLENBQUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxRQUFRLEdBQUc7WUFDZixHQUFHLElBQUk7WUFDUCxLQUFLLEVBQUUsY0FBYztTQUN0QixDQUFDO1FBRUYsSUFBSSxHQUFHLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDbEIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUU7Z0JBQ3RCLFVBQVUsRUFBRSxLQUFLO2dCQUNqQixnQkFBZ0IsRUFBRSxPQUFPLENBQUMsZ0JBQWdCO2dCQUMxQyxrQkFBa0I7YUFDbkIsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUM1QixDQUFDO0lBR0ssQUFBTixLQUFLLENBQUMsaUJBQWlCLENBQ3JCLEdBQStDLEVBQy9DLEdBQWE7UUFHYixNQUFNLEVBQUUsUUFBUSxFQUFFLGlCQUFpQixHQUFHLEVBQUUsRUFBRSxHQUFHLEdBQUcsQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDO1FBRTVELGdFQUFnRTtRQUNoRSxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDO1lBQzdELElBQUksRUFBRSxTQUFTO1lBQ2YsK0JBQStCLEVBQUUsSUFBSTtTQUN0QyxDQUFDO2FBQ0MsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDWCw2REFBNkQ7UUFDN0QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsU0FBUztlQUNwQjtZQUNELHFEQUFxRDtZQUNyRCxDQUFDLGlCQUFpQixFQUFFLE1BQU07Z0JBQzFCLGlFQUFpRTttQkFDOUQsaUJBQWlCLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsU0FBbUIsQ0FBQyxDQUMvRCxDQUNGLENBQUMsQ0FBQztRQUVMLE1BQU0sT0FBTyxHQVFQLEVBQUUsQ0FBQztRQUVULE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxRQUFRLEVBQUUsRUFBRTtZQUN2RCxNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsU0FBUyxDQUFDLFNBQW1CLENBQUM7WUFFMUQsSUFBSSxDQUFDO2dCQUVILE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUN6QyxRQUFRLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FDM0IsQ0FBQztnQkFDRixJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7b0JBQ2IsTUFBTSxJQUFJLEtBQUssQ0FBQyxrREFBa0QsVUFBVSxFQUFFLENBQUMsQ0FBQztnQkFDbEYsQ0FBQztnQkFFRCw2REFBNkQ7Z0JBQzdELElBQUksQ0FBQyxPQUFPLENBQUMsZUFBZSxFQUFFLEVBQUUsQ0FBQztvQkFDL0IsT0FBTyxDQUFDLElBQUksQ0FBQzt3QkFDWCxVQUFVO3dCQUNWLE9BQU8sRUFBRSxLQUFLO3dCQUNkLE9BQU8sRUFBRSxvQ0FBb0MsVUFBVSxFQUFFO3FCQUMxRCxDQUFDLENBQUM7b0JBQ0gsT0FBTztnQkFDVCxDQUFDO2dCQUVELE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUNqRCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7b0JBQ25CLE1BQU0sSUFBSSxLQUFLLENBQUMsdUNBQXVDLFVBQVUsRUFBRSxDQUFDLENBQUM7Z0JBQ3ZFLENBQUM7Z0JBRUQsTUFBTSxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUM7Z0JBQ3RDLE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO2dCQUVwRCxJQUFJLFlBQWlCLENBQUM7Z0JBRXRCLElBQUksQ0FBQztvQkFDSCxZQUFZLEdBQUcsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsVUFBVSxFQUFFLEVBQUUsU0FBUyxFQUFFLEVBQUUsRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO2dCQUN2SCxDQUFDO2dCQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7b0JBQ3BCLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLHNDQUFzQyxVQUFVLEtBQUssS0FBSyxDQUFDLE9BQU8sRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztvQkFDbkcsWUFBWSxHQUFHO3dCQUNiLE9BQU8sRUFBRSxLQUFLO3dCQUNkLE9BQU8sRUFBRSxzQ0FBc0MsVUFBVSxLQUFLLEtBQUssQ0FBQyxPQUFPLEVBQUU7cUJBQzlFLENBQUM7Z0JBQ0osQ0FBQztnQkFFRCxPQUFPLENBQUMsSUFBSSxDQUFDO29CQUNYLFVBQVU7b0JBQ1YsU0FBUyxFQUFFLE1BQU0sQ0FBQyxTQUFTO29CQUMzQixXQUFXLEVBQUUsTUFBTTtvQkFDbkIsWUFBWTtvQkFDWixPQUFPLEVBQUUsSUFBSTtvQkFDYixPQUFPLEVBQUUsU0FBUyxNQUFNLENBQUMsU0FBUywyQkFBMkI7aUJBQzlELENBQUMsQ0FBQztZQUVMLENBQUM7WUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO2dCQUNwQixPQUFPLENBQUMsSUFBSSxDQUFDO29CQUNYLFVBQVU7b0JBQ1YsS0FBSyxFQUFFLEtBQUs7b0JBQ1osT0FBTyxFQUFFLEtBQUs7b0JBQ2QsT0FBTyxFQUFFLHVDQUF1QyxVQUFVLEtBQUssS0FBSyxDQUFDLE9BQU8sRUFBRTtpQkFDL0UsQ0FBQyxDQUFDO1lBQ0wsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFSixPQUFPLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxPQUFPLEVBQUUsQ0FBQyxDQUFDO0lBQy9CLENBQUM7SUFHSyxBQUFOLEtBQUssQ0FBQyxnQkFBZ0IsQ0FDcEIsR0FBOEMsRUFDOUMsR0FBYTtRQUViLE1BQU0sRUFBRSxVQUFVLEVBQUUsR0FBRyxHQUFHLENBQUMsY0FBYyxJQUFJLEVBQUUsQ0FBQztRQUNoRCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFOUQsOENBQThDO1FBQzlDLE1BQU0sZUFBZSxHQUFHLE1BQU0sYUFBYSxDQUFDLGdCQUFnQixFQUFFLENBQUM7UUFFL0QsaURBQWlEO1FBQ2pELE1BQU0sWUFBWSxHQUFHLGFBQWEsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBQzFELE1BQU0sY0FBYyxHQUFHLFlBQVksQ0FBQyxRQUFRLElBQUksRUFBRSxDQUFDO1FBRW5ELHNCQUFzQjtRQUN0QixNQUFNLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxlQUFlLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFFN0YsbUNBQW1DO1FBQ25DLElBQUksTUFBTSxHQUFHLHNDQUFzQyxDQUFDO1FBQ3BELElBQUksY0FBYyxFQUFFLENBQUM7WUFDbkIsTUFBTSxPQUFPLEdBQWEsRUFBRSxDQUFDO1lBQzdCLEtBQUssTUFBTSxDQUFDLEtBQUssRUFBRSxTQUFTLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ3RELElBQUksU0FBUyxDQUFDLE1BQU0sS0FBSyxXQUFXLElBQUksU0FBUyxDQUFDLElBQUksS0FBSyxPQUFPLEVBQUUsQ0FBQztvQkFDbkUsTUFBTSxLQUFLLEdBQUksU0FBaUIsQ0FBQyxLQUFLLEVBQUUsTUFBTSxJQUFJLENBQUMsQ0FBQztvQkFDcEQsTUFBTSxPQUFPLEdBQUksU0FBaUIsQ0FBQyxPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUMsQ0FBQztvQkFDeEQsSUFBSSxLQUFLLEdBQUcsQ0FBQzt3QkFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsS0FBSyxtQkFBbUIsS0FBSyxHQUFHLENBQUMsQ0FBQztvQkFDakUsSUFBSSxPQUFPLEdBQUcsQ0FBQzt3QkFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsT0FBTyxtQkFBbUIsS0FBSyxHQUFHLENBQUMsQ0FBQztnQkFDdkUsQ0FBQztZQUNILENBQUM7WUFDRCxNQUFNLEdBQUcsT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDO2dCQUN6QixDQUFDLENBQUMseUJBQXlCLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUU7Z0JBQy9DLENBQUMsQ0FBQyxnQ0FBZ0MsQ0FBQztRQUN2QyxDQUFDO1FBRUQsT0FBTyxHQUFHLENBQUMsSUFBSSxDQUFDO1lBQ2QsUUFBUSxFQUFFLGVBQWU7WUFDekIsY0FBYztZQUNkLElBQUk7WUFDSixjQUFjO1lBQ2QsTUFBTTtTQUNQLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7O09BR0c7SUFDSyxhQUFhLENBQUMsS0FBVTtRQUM5Qix1Q0FBdUM7UUFDdkMsSUFBSSxLQUFLLEtBQUssSUFBSSxJQUFJLEtBQUssS0FBSyxTQUFTLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDdkUsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQy9CLENBQUM7UUFFRCxrREFBa0Q7UUFDbEQsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDekIsb0VBQW9FO1lBQ3BFLE1BQU0sZUFBZSxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2hGLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUN6QyxDQUFDO1FBRUQsOERBQThEO1FBQzlELE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDN0MsTUFBTSxhQUFhLEdBQXdCLEVBQUUsQ0FBQztRQUU5QyxLQUFLLE1BQU0sR0FBRyxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQzdCLHlEQUF5RDtZQUN6RCxJQUFJLENBQUM7Z0JBQ0gsYUFBYSxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2xFLENBQUM7WUFBQyxNQUFNLENBQUM7Z0JBQ1AsYUFBYSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNsQyxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUN2QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0sscUJBQXFCLENBQUMsT0FBNEIsRUFBRSxNQUEyQjtRQUNyRixNQUFNLElBQUksR0FBd0IsRUFBRSxDQUFDO1FBQ3JDLElBQUksY0FBYyxHQUFHLEtBQUssQ0FBQztRQUUzQix3RUFBd0U7UUFDeEUsNEVBQTRFO1FBQzVFLE1BQU0sZUFBZSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBRWxELEtBQUssTUFBTSxLQUFLLElBQUksZUFBZSxFQUFFLENBQUM7WUFDcEMsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3BDLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUVsQyw2REFBNkQ7WUFDN0QsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7Z0JBQy9CLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUNoRSxNQUFNLFNBQVMsR0FBRyxXQUFXLENBQUM7Z0JBRTlCLGlEQUFpRDtnQkFDakQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBUyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDeEYsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBUyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFFNUYsTUFBTSxLQUFLLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQVMsRUFBRSxFQUFFLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ2hHLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFTLEVBQUUsRUFBRSxDQUFDLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUVsRyxNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQztnQkFDM0QsSUFBSSxXQUFXO29CQUFFLGNBQWMsR0FBRyxJQUFJLENBQUM7Z0JBRXZDLDJEQUEyRDtnQkFDM0QsSUFBSSxXQUFXLEVBQUUsQ0FBQztvQkFDaEIsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHO3dCQUNaLElBQUksRUFBRSxPQUFPO3dCQUNiLEtBQUs7d0JBQ0wsT0FBTzt3QkFDUCxNQUFNLEVBQUUsV0FBVztxQkFDcEIsQ0FBQztnQkFDSixDQUFDO3FCQUFNLENBQUM7b0JBQ04sNEJBQTRCO29CQUM1QixJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUc7d0JBQ1osSUFBSSxFQUFFLE9BQU87d0JBQ2IsTUFBTSxFQUFFLE1BQU07cUJBQ2YsQ0FBQztnQkFDSixDQUFDO1lBRUgsQ0FBQztpQkFBTSxJQUFJLFdBQVcsS0FBSyxJQUFJLElBQUksT0FBTyxXQUFXLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQ25FLDZDQUE2QztnQkFDN0MsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO2dCQUMzRCxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUM7Z0JBQ3pELE1BQU0sV0FBVyxHQUFHLGlCQUFpQixLQUFLLGdCQUFnQixDQUFDO2dCQUUzRCxJQUFJLFdBQVc7b0JBQUUsY0FBYyxHQUFHLElBQUksQ0FBQztnQkFFdkMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHO29CQUNaLElBQUksRUFBRSxRQUFRO29CQUNkLE9BQU8sRUFBRSxZQUFZO29CQUNyQixNQUFNLEVBQUUsV0FBVztvQkFDbkIsTUFBTSxFQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxNQUFNO2lCQUMzQyxDQUFDO1lBRUosQ0FBQztpQkFBTSxDQUFDO2dCQUNOLCtEQUErRDtnQkFDL0QsTUFBTSxXQUFXLEdBQUcsWUFBWSxLQUFLLFdBQVcsQ0FBQztnQkFFakQsSUFBSSxXQUFXO29CQUFFLGNBQWMsR0FBRyxJQUFJLENBQUM7Z0JBRXZDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRztvQkFDWixJQUFJLEVBQUUsUUFBUTtvQkFDZCxPQUFPLEVBQUUsWUFBWTtvQkFDckIsTUFBTSxFQUFFLFdBQVc7b0JBQ25CLE1BQU0sRUFBRSxXQUFXLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsTUFBTTtpQkFDM0MsQ0FBQztZQUNKLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxFQUFFLElBQUksRUFBRSxjQUFjLEVBQUUsQ0FBQztJQUNsQyxDQUFDO0lBU0ssQUFBTixLQUFLLENBQUMsbUJBQW1CLENBQ3ZCLEdBR0UsRUFDRixHQUFhO1FBR2IsTUFBTSxFQUFFLFVBQVUsRUFBRSxHQUFHLEdBQUcsQ0FBQyxjQUFjLElBQUksRUFBRSxDQUFDO1FBQ2hELE1BQU0sRUFBRSxRQUFRLEVBQUUsR0FBRyxHQUFHLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUVwQyxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFOUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxhQUFhLENBQUMsbUJBQW1CLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRXZFLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQztZQUNkLE1BQU07WUFDTixVQUFVO1lBQ1YsT0FBTyxFQUFFLElBQUk7WUFDYixPQUFPLEVBQUUscUNBQXFDO1NBQy9DLENBQUMsQ0FBQztJQUNMLENBQUM7SUFHSyxBQUFOLEtBQUssQ0FBQyxrQkFBa0IsQ0FDdEIsR0FBOEMsRUFDOUMsR0FBYTtRQUdiLE1BQU0sRUFBRSxVQUFVLEVBQUUsR0FBRyxHQUFHLENBQUMsY0FBYyxJQUFJLEVBQUUsQ0FBQztRQUVoRCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFOUQsTUFBTSxhQUFhLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztRQUV6QyxPQUFPLEdBQUcsQ0FBQyxJQUFJLENBQUM7WUFDZCxPQUFPLEVBQUUsSUFBSTtZQUNiLFVBQVU7WUFDVixPQUFPLEVBQUUsOENBQThDO1NBQ3hELENBQUMsQ0FBQztJQUNMLENBQUM7SUFHSyxBQUFOLEtBQUssQ0FBQyxvQkFBb0IsQ0FDeEIsR0FBOEMsRUFDOUMsR0FBYTtRQUdiLE1BQU0sRUFBRSxVQUFVLEVBQUUsR0FBRyxHQUFHLENBQUMsY0FBYyxJQUFJLEVBQUUsQ0FBQztRQUVoRCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFOUQsOEJBQThCO1FBQzlCLE1BQU0sWUFBWSxHQUFHLGFBQWEsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBQzFELE1BQU0sY0FBYyxHQUFHLFlBQVksQ0FBQyxRQUFRLElBQUksRUFBRSxDQUFDO1FBRW5ELG9DQUFvQztRQUNwQyxNQUFNLGFBQWEsQ0FBQyxtQkFBbUIsQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFOUQsT0FBTyxHQUFHLENBQUMsSUFBSSxDQUFDO1lBQ2QsT0FBTyxFQUFFLElBQUk7WUFDYixVQUFVO1lBQ1YsZUFBZSxFQUFFLGNBQWM7WUFDL0IsT0FBTyxFQUFFLHVEQUF1RDtTQUNqRSxDQUFDLENBQUM7SUFDTCxDQUFDO0lBR0ssQUFBTixLQUFLLENBQUMscUJBQXFCLENBQ3pCLEdBQThDLEVBQzlDLEdBQWE7UUFFYixNQUFNLEVBQUUsVUFBVSxFQUFFLEdBQUcsR0FBRyxDQUFDLGNBQWMsSUFBSSxFQUFFLENBQUM7UUFFaEQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBRXhELElBQUksQ0FBQyxhQUFhLENBQUMsZUFBZSxFQUFFLEVBQUUsQ0FBQztZQUNyQyxPQUFPLEdBQUcsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDO2dCQUMxQixPQUFPLEVBQUUsS0FBSztnQkFDZCxVQUFVO2dCQUNWLE9BQU8sRUFBRSxvQ0FBb0MsVUFBVSxFQUFFO2FBQzFELENBQUMsQ0FBQztRQUNMLENBQUM7UUFFRCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFOUQsTUFBTSxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDdEMsTUFBTSxNQUFNLEdBQUcsTUFBTSxhQUFhLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztRQUUxRCxPQUFPLEdBQUcsQ0FBQyxJQUFJLENBQUM7WUFDZCxPQUFPLEVBQUUsSUFBSTtZQUNiLFVBQVU7WUFDVixTQUFTLEVBQUUsTUFBTSxDQUFDLFNBQVM7WUFDM0IsTUFBTTtZQUNOLE9BQU8sRUFBRSxTQUFTLE1BQU0sQ0FBQyxTQUFTLDJCQUEyQjtTQUM5RCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBR0ssQUFBTixLQUFLLENBQUMsYUFBYSxDQUNqQixHQVFFLEVBQ0YsR0FBYTtRQUViLE1BQU0sRUFBRSxVQUFVLEVBQUUsR0FBRyxHQUFHLENBQUMsY0FBYyxJQUFJLEVBQUUsQ0FBQztRQUNoRCxNQUFNLEVBQ0osZUFBZSxHQUFHLEtBQUssRUFDdkIsVUFBVSxHQUFHLFFBQVEsRUFDckIsU0FBUyxHQUFHLEVBQUUsRUFDZCxRQUFRLEVBQ1QsR0FBRyxHQUFHLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUVuQixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFOUQsTUFBTSxTQUFTLEdBQUcsTUFBTSxhQUFhLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztRQUM3RCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywrQkFBK0IsVUFBVSxFQUFFLEVBQUUsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBRTdFLHdCQUF3QjtRQUN4QixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyw0QkFBNEIsU0FBUyxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDcEUsSUFBSSxDQUFDO1lBQ0gsTUFBTSxhQUFhLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDOUMsQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDcEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsNkNBQTZDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1FBQ2pGLENBQUM7UUFFRCw0Q0FBNEM7UUFDNUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsbUNBQW1DLFVBQVUsRUFBRSxDQUFDLENBQUM7UUFDbEUsTUFBTSxhQUFhLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDdEMsTUFBTSxTQUFTLEdBQUcsTUFBTSxhQUFhLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztRQUU3RCxJQUFJLFlBQVksR0FBRyxJQUFJLENBQUM7UUFFeEIsa0NBQWtDO1FBQ2xDLElBQUksZUFBZSxFQUFFLENBQUM7WUFDcEIsSUFBSSxVQUFVLEtBQUssT0FBTyxFQUFFLENBQUM7Z0JBQzNCLHNEQUFzRDtnQkFDdEQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsa0NBQWtDLFVBQVUsRUFBRSxDQUFDLENBQUM7Z0JBQ2pFLFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxVQUFVLEVBQUUsRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQztZQUN6RixDQUFDO2lCQUFNLENBQUM7Z0JBQ04saURBQWlEO2dCQUNqRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxpQ0FBaUMsVUFBVSxFQUFFLENBQUMsQ0FBQztnQkFDaEUsWUFBWSxHQUFHLE1BQU0sYUFBYSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztZQUN2RSxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQztZQUNkLE9BQU8sRUFBRSxJQUFJO1lBQ2IsVUFBVTtZQUNWLFlBQVksRUFBRSxTQUFTLENBQUMsU0FBUztZQUNqQyxZQUFZLEVBQUUsU0FBUyxDQUFDLFNBQVM7WUFDakMsVUFBVSxFQUFFLGVBQWUsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxJQUFJO1lBQy9DLE9BQU8sRUFBRSwrQkFBK0IsZUFBZSxDQUFDLENBQUMsQ0FBQyxLQUFLLFVBQVUsVUFBVSxZQUFZLEVBQUUsY0FBYyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7WUFDeEksWUFBWTtZQUNaLE9BQU8sRUFBRSxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUU7U0FDbEMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUdLLEFBQU4sS0FBSyxDQUFDLFdBQVcsQ0FDZixHQUE4QyxFQUM5QyxHQUFhO1FBRWIsTUFBTSxFQUFFLFVBQVUsRUFBRSxHQUFHLEdBQUcsQ0FBQyxjQUFjLENBQUM7UUFDMUMsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQzlELE1BQU0sYUFBYSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzVDLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQztZQUNkLE9BQU8sRUFBRSxJQUFJO1lBQ2IsVUFBVTtZQUNWLE9BQU8sRUFBRSw0QkFBNEI7U0FDdEMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUdLLEFBQU4sS0FBSyxDQUFDLGdCQUFnQixDQUNwQixHQUE4QyxFQUM5QyxHQUFhO1FBRWIsTUFBTSxFQUFFLFVBQVUsRUFBRSxHQUFHLEdBQUcsQ0FBQyxjQUFjLElBQUksRUFBRSxDQUFDO1FBRWhELE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUU5RCxNQUFNLE1BQU0sR0FBRyxhQUFhLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztRQUNwRCxNQUFNLGFBQWEsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsU0FBVSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRTVFLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQztZQUNkLE9BQU8sRUFBRSxJQUFJO1lBQ2IsVUFBVTtZQUNWLFNBQVMsRUFBRSxNQUFNLENBQUMsU0FBUztZQUMzQixPQUFPLEVBQUUsa0NBQWtDO1NBQzVDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFHSyxBQUFOLEtBQUssQ0FBQyxtQkFBbUIsQ0FDdkIsR0FHRSxFQUNGLEdBQWE7UUFFYixNQUFNLEVBQUUsVUFBVSxFQUFFLEdBQUcsR0FBRyxDQUFDLGNBQWMsSUFBSSxFQUFFLENBQUM7UUFDaEQsTUFBTSxFQUFFLFNBQVMsR0FBRyxFQUFFLEVBQUUsUUFBUSxFQUFFLE9BQU8sR0FBRyxJQUFJLEVBQUUsR0FBRyxHQUFHLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUVwRSxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxVQUFVLEVBQUUsRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxDQUFDLENBQUM7UUFFaEcsSUFBSSxPQUFPLEdBQUcsVUFBVSxNQUFNLENBQUMsY0FBYywwQkFBMEIsQ0FBQztRQUN4RSxJQUFJLE1BQU0sQ0FBQyxXQUFXLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDM0IsT0FBTyxJQUFJLEtBQUssTUFBTSxDQUFDLFdBQVcsOEJBQThCLENBQUM7UUFDbkUsQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQztZQUNkLE9BQU87WUFDUCxPQUFPLEVBQUUsTUFBTSxDQUFDLGNBQWMsR0FBRyxDQUFDO1lBQ2xDLFVBQVU7WUFDVixHQUFHLE1BQU07U0FDVixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0ssS0FBSyxDQUFDLHVCQUF1QixDQUNuQyxVQUFrQixFQUNsQixPQUlDO1FBTUQsTUFBTSxFQUFFLFNBQVMsR0FBRyxFQUFFLEVBQUUsUUFBUSxFQUFFLE9BQU8sR0FBRyxJQUFJLEVBQUUsR0FBRyxPQUFPLENBQUM7UUFDN0QsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBRXhELG9EQUFvRDtRQUNwRCxNQUFNLFNBQVMsR0FBRyxJQUFBLDBCQUFrQixFQUFDLEVBQUUsR0FBRyxFQUFFLDBCQUEwQixDQUFDLDJCQUEyQixFQUFFLENBQUMsQ0FBQztRQUN0RyxNQUFNLGdCQUFnQixHQUFHLFFBQVEsSUFBSSxvQkFBVyxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUVyRSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUN0QixNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxVQUFVLGlCQUFpQiwwQkFBMEIsQ0FBQywyQkFBMkIscUJBQXFCLENBQUMsQ0FBQztRQUNyTCxDQUFDO1FBRUQsSUFBSSxXQUFXLEdBQUcsQ0FBQyxDQUFDO1FBQ3BCLElBQUksY0FBYyxHQUFHLENBQUMsQ0FBQztRQUN2QixJQUFJLE1BQU0sR0FBdUIsTUFBTSxDQUFDO1FBQ3hDLElBQUksY0FBYyxHQUFHLENBQUMsQ0FBQztRQUN2QixNQUFNLGFBQWEsR0FBRyxNQUFNLENBQUM7UUFFN0IsT0FBTyxDQUFDLENBQUMsTUFBTSxJQUFJLGNBQWMsR0FBRyxhQUFhLEVBQUUsQ0FBQztZQUNsRCxjQUFjLEVBQUUsQ0FBQztZQUVqQixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxZQUFZLFVBQVUseUJBQXlCLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFFMUUsTUFBTSxXQUFXLEdBQUcsTUFBTSxhQUFhLENBQUMsS0FBSyxDQUFDO2dCQUM1QyxVQUFVLEVBQUU7b0JBQ1YsS0FBSyxFQUFFLFNBQVM7b0JBQ2hCLE1BQU0sRUFBRSxNQUFNLEtBQUssTUFBTSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLE1BQU07aUJBQy9DO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLElBQUksV0FBVyxDQUFDLElBQUksQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZELE1BQU07WUFDUixDQUFDO1lBRUQsSUFBSSxPQUFPLEVBQUUsQ0FBQztnQkFDWixNQUFNLElBQUksR0FBRyxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLEdBQUcsRUFBRSxFQUFFO29CQUNoRSxPQUFPLE1BQU0sYUFBYSxDQUFDLDRCQUE0QixDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUMvRCxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUVKLElBQUksQ0FBQztvQkFDSCxNQUFNLElBQUEsc0JBQWdCLEVBQUMsZ0JBQWdCLEVBQUU7d0JBQ3ZDLElBQUk7d0JBQ0osU0FBUyxFQUFFLFFBQVE7d0JBQ25CLFVBQVU7cUJBQ1gsQ0FBQyxDQUFDO29CQUNILGNBQWMsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDO2dCQUNoQyxDQUFDO2dCQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7b0JBQ3BCLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGtDQUFrQyxLQUFLLENBQUMsT0FBTyxFQUFFLEVBQUUsRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7b0JBQ3ZHLFdBQVcsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDO2dCQUM3QixDQUFDO1lBQ0gsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FDZixXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsWUFBWSxFQUFFLEVBQUU7b0JBQzFDLElBQUksQ0FBQzt3QkFDSCxNQUFNLFdBQVcsR0FBRyxNQUFNLGFBQWEsQ0FBQyw0QkFBNEIsQ0FBQyxZQUFZLENBQUMsQ0FBQzt3QkFDbkYsTUFBTSxJQUFBLHNCQUFnQixFQUFDLGdCQUFnQixFQUFFOzRCQUN6QyxJQUFJLEVBQUUsV0FBVzs0QkFDakIsU0FBUyxFQUFFLFFBQVE7NEJBQ25CLFVBQVU7eUJBQ1QsQ0FBQyxDQUFDO3dCQUNMLGNBQWMsRUFBRSxDQUFDO29CQUNuQixDQUFDO29CQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7d0JBQ2xCLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLG1DQUFtQyxLQUFLLENBQUMsT0FBTyxFQUFFLEVBQUUsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQzt3QkFDL0YsV0FBVyxFQUFFLENBQUM7b0JBQ2hCLENBQUM7Z0JBQ0QsQ0FBQyxDQUFDLENBQ0gsQ0FBQztZQUNKLENBQUM7WUFFRCxNQUFNLEdBQUcsV0FBVyxDQUFDLE1BQU0sSUFBSSxTQUFTLENBQUM7UUFDM0MsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLDRCQUE0QixVQUFVLEVBQUUsRUFBRTtZQUN6RCxjQUFjO1lBQ2QsV0FBVztZQUNYLGVBQWUsRUFBRSxjQUFjO1NBQ2hDLENBQUMsQ0FBQztRQUVILE9BQU87WUFDTCxjQUFjO1lBQ2QsV0FBVztZQUNYLGVBQWUsRUFBRSxjQUFjO1NBQ2hDLENBQUM7SUFDSixDQUFDO0lBR0ssQUFBTixLQUFLLENBQUMsWUFBWSxDQUNoQixHQUE0QyxFQUM1QyxHQUFhO1FBR2IsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQztRQUUvQyxvREFBb0Q7UUFDcEQsTUFBTSxTQUFTLEdBQUcsSUFBQSwwQkFBa0IsRUFBQyxFQUFFLEdBQUcsRUFBRSwwQkFBMEIsQ0FBQywyQkFBMkIsRUFBRSxDQUFDLENBQUM7UUFDdEcsTUFBTSxnQkFBZ0IsR0FBRyxRQUFRLElBQUksb0JBQVcsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFckUsTUFBTSxJQUFJLEdBQUcsTUFBTSxJQUFBLDZCQUF1QixFQUFDLGdCQUFnQixDQUFDLENBQUM7UUFFN0QsT0FBTyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUM1QixDQUFDO0lBU0ssQUFBTixLQUFLLENBQUMsZUFBZSxDQUNuQixHQUdFLEVBQ0YsR0FBYTtRQUViLE1BQU0sRUFBRSxVQUFVLEVBQUUsR0FBRyxHQUFHLENBQUMsY0FBYyxDQUFDO1FBQzFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDO1FBQy9CLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUM5RCxNQUFNLE1BQU0sR0FBRyxNQUFNLGFBQWEsQ0FBQyxlQUFlLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ3BFLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQztZQUNkLE1BQU07WUFDTixVQUFVO1lBQ1YsT0FBTyxFQUFFLElBQUk7WUFDYixPQUFPLEVBQUUsZ0NBQWdDO1NBQzFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFTSyxBQUFOLEtBQUssQ0FBQyxvQkFBb0IsQ0FDeEIsR0FHRSxFQUNGLEdBQWE7UUFFYixNQUFNLEVBQUUsVUFBVSxFQUFFLEdBQUcsR0FBRyxDQUFDLGNBQWMsQ0FBQztRQUMxQyxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQztRQUN6QixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDOUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxhQUFhLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztRQUMxRCxNQUFNLGFBQWEsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxlQUFlLENBQUMsR0FBRyxFQUFFLE1BQU0sQ0FBQyxTQUFVLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFOUUsT0FBTyxHQUFHLENBQUMsSUFBSSxDQUFDO1lBQ2QsT0FBTyxFQUFFLElBQUk7WUFDYixVQUFVO1lBQ1YsU0FBUyxFQUFFLE1BQU0sQ0FBQyxTQUFTO1lBQzNCLE9BQU8sRUFBRSxnQ0FBZ0M7U0FDMUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQVNLLEFBQU4sS0FBSyxDQUFDLHVCQUF1QixDQUMzQixHQUdFLEVBQ0YsR0FBYTtRQUViLE1BQU0sRUFBRSxVQUFVLEVBQUUsR0FBRyxHQUFHLENBQUMsY0FBYyxDQUFDO1FBQzFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDO1FBQzVCLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUU5RCxNQUFNLE1BQU0sR0FBRyxNQUFNLGFBQWEsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBQzFELE1BQU0sYUFBYSxDQUFDLHVCQUF1QixDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztRQUUxRCxPQUFPLEdBQUcsQ0FBQyxJQUFJLENBQUM7WUFDZCxPQUFPLEVBQUUsSUFBSTtZQUNiLFVBQVU7WUFDVixTQUFTLEVBQUUsTUFBTSxDQUFDLFNBQVM7WUFDM0IsT0FBTyxFQUFFLDBEQUEwRDtTQUNwRSxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRVMsZ0JBQWdCLENBQUMsVUFBa0I7UUFDM0MsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyx1QkFBdUIsQ0FBQztZQUN0RCxJQUFJLEVBQUUsU0FBUztZQUNmLCtCQUErQixFQUFFLElBQUk7WUFDckMsU0FBUyxFQUFFLFVBQVU7U0FDdEIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsNENBQTRDLFVBQVUsRUFBRSxDQUFDLENBQUM7UUFDNUUsQ0FBQztRQUVELE9BQU8sUUFBUSxDQUFFLENBQUMsQ0FBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQXlCLFFBQVEsQ0FBRSxDQUFDLENBQUUsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDbkcsQ0FBQztJQUVTLHNCQUFzQixDQUFDLFVBQWtCO1FBQ2pELE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUN4RCxNQUFNLGFBQWEsR0FBRyxhQUFhLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztRQUV2RCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDbkIsTUFBTSxJQUFJLEtBQUssQ0FBQyx1Q0FBdUMsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUN2RSxDQUFDO1FBRUQsT0FBTyxhQUFhLENBQUM7SUFDdkIsQ0FBQztDQUNGLENBQUE7QUFuN0JZLHdEQUFzQjtBQVEzQjtJQURMLElBQUEsZ0JBQUcsRUFBQyxVQUFVLENBQUM7eURBc0RmO0FBUUs7SUFETCxJQUFBLGdCQUFHLEVBQUMsdUJBQXVCLEVBQUUsRUFBRSxDQUFDOzZEQW1CaEM7QUFHSztJQURMLElBQUEsZ0JBQUcsRUFBQyxXQUFXLENBQUM7K0RBMERoQjtBQUdLO0lBREwsSUFBQSxnQkFBRyxFQUFDLG9DQUFvQyxDQUFDOytEQWlCekM7QUFHSztJQURMLElBQUEsZ0JBQUcsRUFBQyx1QkFBdUIsQ0FBQzs4REFrRTVCO0FBR0s7SUFETCxJQUFBLGlCQUFJLEVBQUMsY0FBYyxDQUFDOytEQWdHcEI7QUFHSztJQURMLElBQUEsZ0JBQUcsRUFBQyxnQ0FBZ0MsQ0FBQzs4REEwQ3JDO0FBMEhLO0lBUEwsSUFBQSxnQkFBRyxFQUFDLGdDQUFnQyxFQUFFO1FBQ3JDLFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRTtnQkFDSixRQUFRLEVBQUUsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUU7YUFDakQ7U0FDRjtLQUNGLENBQUM7aUVBc0JEO0FBR0s7SUFETCxJQUFBLGlCQUFJLEVBQUMsc0NBQXNDLENBQUM7Z0VBaUI1QztBQUdLO0lBREwsSUFBQSxpQkFBSSxFQUFDLDhDQUE4QyxDQUFDO2tFQXVCcEQ7QUFHSztJQURMLElBQUEsaUJBQUksRUFBQyw0QkFBNEIsQ0FBQzttRUE2QmxDO0FBR0s7SUFETCxJQUFBLGlCQUFJLEVBQUMsZ0NBQWdDLENBQUM7MkRBZ0V0QztBQUdLO0lBREwsSUFBQSxtQkFBTSxFQUFDLHVCQUF1QixDQUFDO3lEQWEvQjtBQUdLO0lBREwsSUFBQSxtQkFBTSxFQUFDLGlDQUFpQyxDQUFDOzhEQWtCekM7QUFHSztJQURMLElBQUEsaUJBQUksRUFBQyw4QkFBOEIsQ0FBQztpRUF3QnBDO0FBdUdLO0lBREwsSUFBQSxnQkFBRyxFQUFDLGFBQWEsQ0FBQzswREFlbEI7QUFTSztJQVBMLElBQUEsZ0JBQUcsRUFBQyx1QkFBdUIsRUFBRTtRQUM1QixXQUFXLEVBQUU7WUFDWCxJQUFJLEVBQUU7Z0JBQ0osU0FBUyxFQUFFLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFO2FBQ2pEO1NBQ0Y7S0FDRixDQUFDOzZEQWtCRDtBQVNLO0lBUEwsSUFBQSxtQkFBTSxFQUFDLDhCQUE4QixFQUFFO1FBQ3RDLFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRTtnQkFDSixHQUFHLEVBQUUsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUU7YUFDM0M7U0FDRjtLQUNGLENBQUM7a0VBb0JEO0FBU0s7SUFQTCxJQUFBLG1CQUFNLEVBQUMsaUNBQWlDLEVBQUU7UUFDekMsV0FBVyxFQUFFO1lBQ1gsSUFBSSxFQUFFO2dCQUNKLE1BQU0sRUFBRSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRTthQUMvQztTQUNGO0tBQ0YsQ0FBQztxRUFxQkQ7aUNBejVCVSxzQkFBc0I7SUFDcEIsV0FBQSxJQUFBLG9CQUFlLEdBQUUsQ0FBQTtHQURuQixzQkFBc0IsQ0FtN0JsQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuXG5pbXBvcnQgeyBnZXRRdWV1ZU1lc3NhZ2VNZXRhZGF0YSwgc2VuZFF1ZXVlTWVzc2FnZSB9IGZyb20gXCIuLi8uLi9jbGllbnQvc3FzXCI7XG5pbXBvcnQgeyBBUElDb250cm9sbGVyIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2FwaS1nYXRld2F5LWNvbnRyb2xsZXInO1xuaW1wb3J0IHR5cGUgeyBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSBcIi4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7IENvbnRyb2xsZXIsIERlbGV0ZSwgR2V0LCBQb3N0LCBQdXQgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzJztcbmltcG9ydCB7IEluamVjdENvbnRhaW5lciB9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7IHR5cGUgQmFzZUVudGl0eVNlcnZpY2UgfSBmcm9tICcuLi8uLi9lbnRpdHknO1xuaW1wb3J0IHsgdHlwZSBJRElDb250YWluZXIsIHR5cGUgUmVxdWVzdCwgdHlwZSBSZXNwb25zZSB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgZGVlcENvcHksIHJlc29sdmVFbnZWYWx1ZUZvciB9IGZyb20gJy4uLy4uL3V0aWxzJztcbmltcG9ydCB7IHBhcnNlU2VhcmNoUXVlcnkgfSBmcm9tIFwiLi4vc2VhcmNoLXV0aWxzXCI7XG5pbXBvcnQgeyBFbnZpcm9ubWVudCB9IGZyb20gXCIuLi8uLi9jbGllbnRcIjtcblxuZXhwb3J0IGVudW0gU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMge1xuICBNRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUgPSAnTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FJyxcbn1cblxuLy8gdGhlIGltcGxlbWVuaXRuZyBjb250cm9sbGVyIG11c3QgZGVmaW5lIHRoaXMuLiBcbi8vIGh0ZSBjb250cm9sbGVyIGRlY29ydGF0b3IgaGVyZSBjYXVzZXMgZXJyb3JzIGR1ZSB0byBkeW5hbWljIGxheWVyIGltcG9ydHMgYW5kIHBvbGx1dGVzIGF1dG9tYXRpYyBsYW1iZGEgaGFuZGxlclxuLy8gQENvbnRyb2xsZXIoJ3N5c3RlbS9zZWFyY2gnLCB7XG4vLyAgIGVudjogWyB7XG4vLyAgICAgbmFtZTogU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FLFxuLy8gICB9IF0sXG4vLyB9KVxuZXhwb3J0IGNsYXNzIFNlYXJjaFN5c3RlbUNvbnRyb2xsZXIgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgY29uc3RydWN0b3IoQEluamVjdENvbnRhaW5lcigpIHByb3RlY3RlZCBjb250YWluZXI6IElESUNvbnRhaW5lcikge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KSB7IH1cblxuICBAR2V0KCcvaW5kaWNlcycpXG4gIGFzeW5jIGxpc3RJbmRpY2VzKF9yZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UpIHtcbiAgICAvLyBBdXRvLWRpc2NvdmVyIGVudGl0aWVzIHdpdGggc2VhcmNoIGVuYWJsZWRcbiAgICBjb25zdCBlbnRpdHlQcm92aWRlcnMgPSB0aGlzLmNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlLFxuICAgIH0pXG4gICAgICAuZmlsdGVyKHAgPT4ge1xuICAgICAgICByZXR1cm4gISFwLl9wcm92aWRlci5mb3JFbnRpdHlcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgaW5kaWNlc0RhdGE6IGFueVtdID0gW107XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChlbnRpdHlQcm92aWRlcnMubWFwKGFzeW5jIChwcm92aWRlcikgPT4ge1xuXG4gICAgICBjb25zdCBlbnRpdHlOYW1lID0gcHJvdmlkZXIuX3Byb3ZpZGVyLmZvckVudGl0eSBhcyBzdHJpbmc7XG5cbiAgICAgIHRyeSB7XG5cbiAgICAgICAgLy8gdXNlIHByb3ZpZGVyJ3MgY29udGFpbmVyICB0byByZXNvbHZlIHRoZSBzZXJ2aWNlXG4gICAgICAgIGNvbnN0IHNlcnZpY2UgPSBwcm92aWRlci5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oXG4gICAgICAgICAgcHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGVcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAoIXNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlcnZpY2UgJHtTdHJpbmcocHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGUpfSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gc2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgIGlmICghc2VhcmNoU2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIHNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaW5kZXhJbmZvID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleEluZm8oKTtcblxuICAgICAgICBpbmRpY2VzRGF0YS5wdXNoKHtcbiAgICAgICAgICAuLi5pbmRleEluZm8sXG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBpbmRleE5hbWU6IGluZGV4SW5mby51aWQsXG4gICAgICAgIH0pO1xuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG5cbiAgICAgICAgaW5kaWNlc0RhdGEucHVzaCh7XG4gICAgICAgICAgaW5kZXhOYW1lOiBgWyR7ZW50aXR5TmFtZX1dLWluZGV4LW5hbWUtbm90LXJlc29sdmVkYCxcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihlcnJvcik7XG4gICAgICB9XG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHJlc3BvbnNlLmpzb24oeyBpbmRpY2VzOiBpbmRpY2VzRGF0YSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgbmV3IGFwaSB0byBnZXQgaW5kZXggZGV0YWlsc1xuICAgKiBcbiAgICovXG5cbiAgQEdldCgnL2luZGljZXMve2VudGl0eU5hbWV9Jywge30pXG4gIGFzeW5jIGdldEluZGV4RGV0YWlscyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgaW5kZXhJbmZvID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleEluZm8oKTtcbiAgICBjb25zdCBpbmRleFN0YXRzID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleFN0YXRzKCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgZGV0YWlsczoge1xuICAgICAgICBpbmRleEluZm8sXG4gICAgICAgIGluZGV4U3RhdHMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBAR2V0KCcvZW50aXRpZXMnKVxuICBhc3luYyBnZXRTZWFyY2hFbnRpdGllcyhfcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgZW50aXR5UHJvdmlkZXJzID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICB9KVxuICAgICAgLmZpbHRlcihwID0+ICEhcC5fcHJvdmlkZXIuZm9yRW50aXR5KTtcblxuICAgIGNvbnN0IGVudGl0aWVzRGF0YToge1xuICAgICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgICAgc2VhcmNoRW5hYmxlZDogYm9vbGVhbjtcbiAgICAgIGluZGV4RXhpc3RzPzogYm9vbGVhbjtcbiAgICAgIGluZGV4TmFtZT86IHN0cmluZztcbiAgICAgIGVycm9yPzogc3RyaW5nO1xuICAgIH1bXSA9IFtdO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZW50aXR5UHJvdmlkZXJzLm1hcChhc3luYyAocHJvdmlkZXIpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSBwcm92aWRlci5fcHJvdmlkZXIuZm9yRW50aXR5IGFzIHN0cmluZztcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc2VydmljZSA9IHByb3ZpZGVyLl9jb250YWluZXIucmVzb2x2ZTxCYXNlRW50aXR5U2VydmljZTxhbnk+PihcbiAgICAgICAgICBwcm92aWRlci5fcHJvdmlkZXIucHJvdmlkZVxuICAgICAgICApO1xuXG4gICAgICAgIGlmICghc2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VydmljZSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWFyY2hFbmFibGVkID0gc2VydmljZS5pc1NlYXJjaEVuYWJsZWQoKTtcbiAgICAgICAgbGV0IGluZGV4RXhpc3RzID0gZmFsc2U7XG4gICAgICAgIGxldCBpbmRleE5hbWUgPSAnJztcblxuICAgICAgICBpZiAoc2VhcmNoRW5hYmxlZCkge1xuICAgICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSBzZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgICBpZiAoc2VhcmNoU2VydmljZSkge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgICAgICAgICAgaW5kZXhOYW1lID0gY29uZmlnLmluZGV4TmFtZSE7XG4gICAgICAgICAgICBpbmRleEV4aXN0cyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RW5naW5lKCkuaW5kZXhFeGlzdHMoaW5kZXhOYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBlbnRpdGllc0RhdGEucHVzaCh7XG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBzZWFyY2hFbmFibGVkLFxuICAgICAgICAgIGluZGV4RXhpc3RzLFxuICAgICAgICAgIGluZGV4TmFtZSxcbiAgICAgICAgfSk7XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgZW50aXRpZXNEYXRhLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgc2VhcmNoRW5hYmxlZDogZmFsc2UsXG4gICAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIHJldHVybiByZXNwb25zZS5qc29uKHsgZW50aXRpZXM6IGVudGl0aWVzRGF0YSB9KTtcbiAgfVxuXG4gIEBHZXQoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfS97ZG9jdW1lbnRJZH0nKVxuICBhc3luYyBnZXRTaW5nbGVEb2N1bWVudChcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZywgZG9jdW1lbnRJZDogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGRvY3VtZW50SWQgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcHJpbWFyeUlkRmllbGROYW1lID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcbiAgICBcbiAgICBjb25zdCBkb2MgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldERvY3VtZW50KGRvY3VtZW50SWQpO1xuXG4gICAgZG9jWyAnaWQnIF0gPSBkb2NbICdpZCcgXSB8fCBkb2NbIHByaW1hcnlJZEZpZWxkTmFtZSBhcyBzdHJpbmcgXTtcbiAgICBkb2NbICdmdWxsUmVjb3JkJyBdID0geyAuLi5kb2MgfTtcbiAgICBkb2NbICdlbnRpdHlOYW1lJyBdID0gZW50aXR5TmFtZTtcblxuICAgIHJldHVybiByZXMuanNvbihkb2MpO1xuICB9XG5cbiAgQEdldCgnL3JlY29yZHMve2VudGl0eU5hbWV9JylcbiAgYXN5bmMgZ2V0RW50aXR5UmVjb3JkcyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVycz86IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHRcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcXVlcnkgPSBkZWVwQ29weShyZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzKTtcblxuICAgIGNvbnN0IHBhcnNlZFF1ZXJ5ID0gcGFyc2VTZWFyY2hRdWVyeShxdWVyeSk7XG4gICAgY29uc3QgeyBzZWxlY3Q6IF9zZWxlY3QsIC4uLnJlc3RRdWVyeVBhcmFtcyB9ID0gcGFyc2VkUXVlcnk7XG5cbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgZW50aXR5U2VydmljZS5zZWFyY2gocmVzdFF1ZXJ5UGFyYW1zLCBjdHgpO1xuXG4gICAgY29uc3QgeyBoaXRzLCAuLi5yZXN0IH0gPSByZXN1bHRzO1xuICAgIFxuICAgIC8vIEdldCB0aGUgZW50aXR5J3MgcHJpbWFyeSBpZGVudGlmaWVyIGZpZWxkIG5hbWVcbiAgICBjb25zdCBwcmltYXJ5SWRGaWVsZE5hbWUgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuICAgIFxuICAgIC8vIEVuc3VyZSBhbGwgcmVjb3JkcyBoYXZlIGEgY29uc2lzdGVudCAnaWQnIGZpZWxkIGZvciBnZW5lcmljIFVJIGxpc3RpbmdcbiAgICBjb25zdCBub3JtYWxpemVkSGl0cyA9IGhpdHMubWFwKChoaXQ6IGFueSkgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEhpdCA9IHsgLi4uaGl0IH07XG5cbiAgICAgIG5vcm1hbGl6ZWRIaXRbICdlbnRpdHlOYW1lJyBdID0gZW50aXR5TmFtZTtcbiAgICAgIG5vcm1hbGl6ZWRIaXRbICdmdWxsUmVjb3JkJyBdID0gaGl0O1xuICAgICAgXG4gICAgICAvLyBJZiB0aGUgcmVjb3JkIGRvZXNuJ3QgaGF2ZSBhbiAnaWQnIGZpZWxkIGJ1dCBoYXMgdGhlIHByaW1hcnkgaWRlbnRpZmllciBmaWVsZCxcbiAgICAgIC8vIG1hcCBpdCB0byAnaWQnIGZvciBjb25zaXN0ZW50IGdlbmVyaWMgbGlzdGluZ1xuICAgICAgaWYgKCFub3JtYWxpemVkSGl0LmlkICYmIHByaW1hcnlJZEZpZWxkTmFtZSAmJiBub3JtYWxpemVkSGl0WyBwcmltYXJ5SWRGaWVsZE5hbWUgXSkge1xuICAgICAgICBub3JtYWxpemVkSGl0LmlkID0gbm9ybWFsaXplZEhpdFsgcHJpbWFyeUlkRmllbGROYW1lIF07XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIElmIHN0aWxsIG5vIGlkIGZpZWxkLCB0cnkgY29tbW9uIGlkZW50aWZpZXIgcGF0dGVybnNcbiAgICAgIGlmICghbm9ybWFsaXplZEhpdC5pZCkge1xuICAgICAgICBjb25zdCBpZEZpZWxkcyA9IFsgYCR7ZW50aXR5TmFtZX1JZGAsIGAke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1JZGAgXTtcbiAgICAgICAgZm9yIChjb25zdCBpZEZpZWxkIG9mIGlkRmllbGRzKSB7XG4gICAgICAgICAgaWYgKG5vcm1hbGl6ZWRIaXRbIGlkRmllbGQgXSkge1xuICAgICAgICAgICAgbm9ybWFsaXplZEhpdC5pZCA9IG5vcm1hbGl6ZWRIaXRbIGlkRmllbGQgXTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgXG4gICAgICByZXR1cm4gbm9ybWFsaXplZEhpdDtcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3BvbnNlID0ge1xuICAgICAgLi4ucmVzdCxcbiAgICAgIGl0ZW1zOiBub3JtYWxpemVkSGl0cyxcbiAgICB9O1xuXG4gICAgaWYgKHJlcS5kZWJ1Z01vZGUpIHtcbiAgICAgIE9iamVjdC5hc3NpZ24ocmVzcG9uc2UsIHtcbiAgICAgICAgaW5wdXRRdWVyeTogcXVlcnksXG4gICAgICAgIHByb2Nlc3NpbmdUaW1lTXM6IHJlc3VsdHMucHJvY2Vzc2luZ1RpbWVNcyxcbiAgICAgICAgcHJpbWFyeUlkRmllbGROYW1lXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmpzb24ocmVzcG9uc2UpO1xuICB9XG5cbiAgQFBvc3QoJy9pbml0SW5kaWNlcycpXG4gIGFzeW5jIGluaXRTZWFyY2hJbmRpY2VzKFxuICAgIHJlcTogUmVxdWVzdDx7IGJvZHk6IHsgZW50aXRpZXM/OiBzdHJpbmdbXSB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0aWVzOiByZXF1ZXN0ZWRFbnRpdGllcyA9IFtdIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIC8vIGNvbGxlY3QgcHJvdmlkZXIgZm9yIGVudGl0eS1zZXJ2aWNlcyBmcm9tIGNvbnRhaW5lci1oaWVyYXJjaHlcbiAgICBjb25zdCBlbnRpdHlQcm92aWRlcnMgPSB0aGlzLmNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlLFxuICAgIH0pXG4gICAgICAuZmlsdGVyKHAgPT4gKFxuICAgICAgICAvLyBmaWx0ZXIgb3V0IHByb3ZpZGVycyB0aGF0IGRvIG5vdCBoYXZlIGEgZm9yRW50aXR5IHByb3BlcnR5XG4gICAgICAgICEhcC5fcHJvdmlkZXIuZm9yRW50aXR5XG4gICAgICAgICYmIChcbiAgICAgICAgICAvLyBpZiBubyBlbnRpdGllcyBhcmUgcmVxdWVzdGVkLCBpbmNsdWRlIGFsbCBlbnRpdGllc1xuICAgICAgICAgICFyZXF1ZXN0ZWRFbnRpdGllcz8ubGVuZ3RoXG4gICAgICAgICAgLy8gaWYgZW50aXRpZXMgYXJlIHJlcXVlc3RlZCwgaW5jbHVkZSBvbmx5IHRoZSByZXF1ZXN0ZWQgZW50aXRpZXNcbiAgICAgICAgICB8fCByZXF1ZXN0ZWRFbnRpdGllcy5pbmNsdWRlcyhwLl9wcm92aWRlci5mb3JFbnRpdHkgYXMgc3RyaW5nKVxuICAgICAgICApXG4gICAgICApKTtcblxuICAgIGNvbnN0IHJlc3VsdHM6IHtcbiAgICAgIGVycm9yPzogc3RyaW5nO1xuICAgICAgc3VjY2VzczogYm9vbGVhbjtcbiAgICAgIG1lc3NhZ2U/OiBzdHJpbmc7XG4gICAgICByZXN5bmNSZXN1bHQ/OiBhbnk7XG4gICAgICBlbnRpdHlOYW1lOiBzdHJpbmc7XG4gICAgICBpbmRleE5hbWU/OiBzdHJpbmc7XG4gICAgICBpbmRleENvbmZpZz86IGFueTtcbiAgICB9W10gPSBbXTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKGVudGl0eVByb3ZpZGVycy5tYXAoYXN5bmMgKHByb3ZpZGVyKSA9PiB7XG4gICAgICBjb25zdCBlbnRpdHlOYW1lID0gcHJvdmlkZXIuX3Byb3ZpZGVyLmZvckVudGl0eSBhcyBzdHJpbmc7XG5cbiAgICAgIHRyeSB7XG5cbiAgICAgICAgY29uc3Qgc2VydmljZSA9IHByb3ZpZGVyLl9jb250YWluZXIucmVzb2x2ZTxCYXNlRW50aXR5U2VydmljZTxhbnk+PihcbiAgICAgICAgICBwcm92aWRlci5fcHJvdmlkZXIucHJvdmlkZVxuICAgICAgICApO1xuICAgICAgICBpZiAoIXNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEVudGl0eVNlcnZpY2UgY291bGQgbm90IGJlIHJlc29sdmVkIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgc2VhcmNoIGlzIGVuYWJsZWQgYmVmb3JlIGF0dGVtcHRpbmcgdG8gaW5pdGlhbGl6ZVxuICAgICAgICBpZiAoIXNlcnZpY2UuaXNTZWFyY2hFbmFibGVkKCkpIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgbWVzc2FnZTogYFNlYXJjaCBpcyBub3QgZW5hYmxlZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSBzZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgaWYgKCFzZWFyY2hTZXJ2aWNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggc2VydmljZSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmluaXRTZWFyY2hJbmRleCgpO1xuICAgICAgICBjb25zdCBjb25maWcgPSBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG5cbiAgICAgICAgbGV0IHJlc3luY1Jlc3VsdDogYW55O1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmVzeW5jUmVzdWx0ID0gYXdhaXQgdGhpcy5xdWV1ZURvY3VtZW50c0ZvclJlc3luYyhlbnRpdHlOYW1lLCB7IGJhdGNoU2l6ZTogNTAsIHF1ZXVlVXJsOiB1bmRlZmluZWQsIGJ5QmF0Y2g6IHRydWUgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcmVzeW5jaW5nIHJlY29yZHMgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9OiAke2Vycm9yLm1lc3NhZ2V9YCwgeyBlcnJvciB9KTtcbiAgICAgICAgICByZXN5bmNSZXN1bHQgPSB7XG4gICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIG1lc3NhZ2U6IGBFcnJvciByZXN5bmNpbmcgcmVjb3JkcyBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX06ICR7ZXJyb3IubWVzc2FnZX1gLFxuICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgICAgIGluZGV4Q29uZmlnOiBjb25maWcsXG4gICAgICAgICAgcmVzeW5jUmVzdWx0LFxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgbWVzc2FnZTogYEluZGV4ICR7Y29uZmlnLmluZGV4TmFtZX0gaW5pdGlhbGl6ZWQgc3VjY2Vzc2Z1bGx5YCxcbiAgICAgICAgfSk7XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIGVycm9yOiBlcnJvcixcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBtZXNzYWdlOiBgRXJyb3IgaW5pdGlhbGl6aW5nIGluZGV4IGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfTogJHtlcnJvci5tZXNzYWdlfWAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIHJldHVybiByZXMuanNvbih7IHJlc3VsdHMgfSk7XG4gIH1cblxuICBAR2V0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vc2V0dGluZ3MnKVxuICBhc3luYyBnZXRJbmRleFNldHRpbmdzKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIFxuICAgIC8vIEdldCBjdXJyZW50IHNldHRpbmdzIGZyb20gdGhlIHNlYXJjaCBlbmdpbmVcbiAgICBjb25zdCBjdXJyZW50U2V0dGluZ3MgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEluZGV4U2V0dGluZ3MoKTtcblxuICAgIC8vIEdldCBhdXRvLWdlbmVyYXRlZCBzZXR0aW5ncyBmcm9tIGVudGl0eSBzY2hlbWFcbiAgICBjb25zdCBzZWFyY2hDb25maWcgPSBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgY29uc3Qgc2NoZW1hU2V0dGluZ3MgPSBzZWFyY2hDb25maWcuc2V0dGluZ3MgfHwge307XG5cbiAgICAvLyBDYWxjdWxhdGUgZGVlcCBkaWZmXG4gICAgY29uc3QgeyBkaWZmLCBoYXNEaWZmZXJlbmNlcyB9ID0gdGhpcy5jYWxjdWxhdGVTZXR0aW5nc0RpZmYoY3VycmVudFNldHRpbmdzLCBzY2hlbWFTZXR0aW5ncyk7XG5cbiAgICAvLyBCdWlsZCBpbmZvcm1hdGl2ZSBzdGF0dXMgbWVzc2FnZVxuICAgIGxldCBzdGF0dXMgPSAn4pyTIEluZGV4IHNldHRpbmdzIG1hdGNoIGVudGl0eSBzY2hlbWEnO1xuICAgIGlmIChoYXNEaWZmZXJlbmNlcykge1xuICAgICAgY29uc3Qgc3VtbWFyeTogc3RyaW5nW10gPSBbXTtcbiAgICAgIGZvciAoY29uc3QgW2ZpZWxkLCBmaWVsZERpZmZdIG9mIE9iamVjdC5lbnRyaWVzKGRpZmYpKSB7XG4gICAgICAgIGlmIChmaWVsZERpZmYuc3RhdHVzID09PSAnZGlmZmVyZW50JyAmJiBmaWVsZERpZmYudHlwZSA9PT0gJ2FycmF5Jykge1xuICAgICAgICAgIGNvbnN0IGFkZGVkID0gKGZpZWxkRGlmZiBhcyBhbnkpLmFkZGVkPy5sZW5ndGggfHwgMDtcbiAgICAgICAgICBjb25zdCByZW1vdmVkID0gKGZpZWxkRGlmZiBhcyBhbnkpLnJlbW92ZWQ/Lmxlbmd0aCB8fCAwO1xuICAgICAgICAgIGlmIChhZGRlZCA+IDApIHN1bW1hcnkucHVzaChgJHthZGRlZH0gbmV3IGluIHNjaGVtYSAoJHtmaWVsZH0pYCk7XG4gICAgICAgICAgaWYgKHJlbW92ZWQgPiAwKSBzdW1tYXJ5LnB1c2goYCR7cmVtb3ZlZH0gb25seSBpbiBpbmRleCAoJHtmaWVsZH0pYCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHN0YXR1cyA9IHN1bW1hcnkubGVuZ3RoID4gMCBcbiAgICAgICAgPyBg4oS577iPIERpZmZlcmVuY2VzIGZvdW5kOiAke3N1bW1hcnkuam9pbignLCAnKX1gXG4gICAgICAgIDogJ+KEue+4jyBTZXR0aW5ncyBkaWZmZXIgZnJvbSBzY2hlbWEnO1xuICAgIH1cblxuICAgIHJldHVybiByZXMuanNvbih7IFxuICAgICAgc2V0dGluZ3M6IGN1cnJlbnRTZXR0aW5ncyxcbiAgICAgIHNjaGVtYVNldHRpbmdzLFxuICAgICAgZGlmZixcbiAgICAgIGhhc0RpZmZlcmVuY2VzLFxuICAgICAgc3RhdHVzLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIERlZXAgbm9ybWFsaXplIGFueSB2YWx1ZSBmb3IgY29uc2lzdGVudCBjb21wYXJpc29uXG4gICAqIFJlY3Vyc2l2ZWx5IHNvcnRzIG9iamVjdCBrZXlzIGFuZCBoYW5kbGVzIGFycmF5cy9wcmltaXRpdmVzXG4gICAqL1xuICBwcml2YXRlIGRlZXBOb3JtYWxpemUodmFsdWU6IGFueSk6IHN0cmluZyB7XG4gICAgLy8gSGFuZGxlIHByaW1pdGl2ZXMgYW5kIG51bGwvdW5kZWZpbmVkXG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgYXJyYXlzIC0gcmVjdXJzaXZlbHkgbm9ybWFsaXplIGVhY2ggaXRlbVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgLy8gUGFyc2UgYmFjayBlYWNoIG5vcm1hbGl6ZWQgc3RyaW5nIHRvIGF2b2lkIGRvdWJsZSBzdHJpbmdpZmljYXRpb25cbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBcnJheSA9IHZhbHVlLm1hcChpdGVtID0+IEpTT04ucGFyc2UodGhpcy5kZWVwTm9ybWFsaXplKGl0ZW0pKSk7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZEFycmF5KTtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgb2JqZWN0cyAtIHNvcnQga2V5cyBhbmQgcmVjdXJzaXZlbHkgbm9ybWFsaXplIHZhbHVlc1xuICAgIGNvbnN0IHNvcnRlZEtleXMgPSBPYmplY3Qua2V5cyh2YWx1ZSkuc29ydCgpO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBzb3J0ZWRLZXlzKSB7XG4gICAgICAvLyBQYXJzZSBiYWNrIHRoZSBub3JtYWxpemVkIHN0cmluZyBmb3IgbmVzdGVkIHN0cnVjdHVyZXNcbiAgICAgIHRyeSB7XG4gICAgICAgIG5vcm1hbGl6ZWRPYmpba2V5XSA9IEpTT04ucGFyc2UodGhpcy5kZWVwTm9ybWFsaXplKHZhbHVlW2tleV0pKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBub3JtYWxpemVkT2JqW2tleV0gPSB2YWx1ZVtrZXldO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShub3JtYWxpemVkT2JqKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGUgZGlmZiBiZXR3ZWVuIGN1cnJlbnQgaW5kZXggc2V0dGluZ3MgYW5kIHNjaGVtYS1kZXJpdmVkIHNldHRpbmdzXG4gICAqIE9ubHkgY29tcGFyZXMgZmllbGRzIHRoYXQgZXhpc3QgaW4gc2NoZW1hIHNldHRpbmdzIChmcmFtZXdvcmstbWFuYWdlZCBmaWVsZHMpXG4gICAqL1xuICBwcml2YXRlIGNhbGN1bGF0ZVNldHRpbmdzRGlmZihjdXJyZW50OiBSZWNvcmQ8c3RyaW5nLCBhbnk+LCBzY2hlbWE6IFJlY29yZDxzdHJpbmcsIGFueT4pIHtcbiAgICBjb25zdCBkaWZmOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgbGV0IGhhc0RpZmZlcmVuY2VzID0gZmFsc2U7XG5cbiAgICAvLyBPTkxZIGNvbXBhcmUgZmllbGRzIHRoYXQgZXhpc3QgaW4gc2NoZW1hIHNldHRpbmdzIChmcmFtZXdvcmstbWFuYWdlZClcbiAgICAvLyBUeXBpY2FsbHk6IHNlYXJjaGFibGVBdHRyaWJ1dGVzLCBmaWx0ZXJhYmxlQXR0cmlidXRlcywgc29ydGFibGVBdHRyaWJ1dGVzXG4gICAgY29uc3QgZmllbGRzVG9Db21wYXJlID0gT2JqZWN0LmtleXMoc2NoZW1hIHx8IHt9KTtcblxuICAgIGZvciAoY29uc3QgZmllbGQgb2YgZmllbGRzVG9Db21wYXJlKSB7XG4gICAgICBjb25zdCBjdXJyZW50VmFsdWUgPSBjdXJyZW50W2ZpZWxkXTtcbiAgICAgIGNvbnN0IHNjaGVtYVZhbHVlID0gc2NoZW1hW2ZpZWxkXTtcblxuICAgICAgLy8gQXJyYXkgY29tcGFyaXNvbiAobW9zdCBjb21tb24gY2FzZSBmb3Igb3VyIG1hbmFnZWQgZmllbGRzKVxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoc2NoZW1hVmFsdWUpKSB7XG4gICAgICAgIGNvbnN0IGN1cnJBcnIgPSBBcnJheS5pc0FycmF5KGN1cnJlbnRWYWx1ZSkgPyBjdXJyZW50VmFsdWUgOiBbXTtcbiAgICAgICAgY29uc3Qgc2NoZW1hQXJyID0gc2NoZW1hVmFsdWU7XG5cbiAgICAgICAgLy8gVXNlIGRlZXAgbm9ybWFsaXplZCBjb21wYXJpc29uIGZvciBhcnJheSBpdGVtc1xuICAgICAgICBjb25zdCBjdXJyTm9ybWFsaXplZFNldCA9IG5ldyBTZXQoY3VyckFyci5tYXAoKGl0ZW06IGFueSkgPT4gdGhpcy5kZWVwTm9ybWFsaXplKGl0ZW0pKSk7XG4gICAgICAgIGNvbnN0IHNjaGVtYU5vcm1hbGl6ZWRTZXQgPSBuZXcgU2V0KHNjaGVtYUFyci5tYXAoKGl0ZW06IGFueSkgPT4gdGhpcy5kZWVwTm9ybWFsaXplKGl0ZW0pKSk7XG5cbiAgICAgICAgY29uc3QgYWRkZWQgPSBzY2hlbWFBcnIuZmlsdGVyKChpdGVtOiBhbnkpID0+ICFjdXJyTm9ybWFsaXplZFNldC5oYXModGhpcy5kZWVwTm9ybWFsaXplKGl0ZW0pKSk7XG4gICAgICAgIGNvbnN0IHJlbW92ZWQgPSBjdXJyQXJyLmZpbHRlcigoaXRlbTogYW55KSA9PiAhc2NoZW1hTm9ybWFsaXplZFNldC5oYXModGhpcy5kZWVwTm9ybWFsaXplKGl0ZW0pKSk7XG5cbiAgICAgICAgY29uc3QgaXNEaWZmZXJlbnQgPSBhZGRlZC5sZW5ndGggPiAwIHx8IHJlbW92ZWQubGVuZ3RoID4gMDtcbiAgICAgICAgaWYgKGlzRGlmZmVyZW50KSBoYXNEaWZmZXJlbmNlcyA9IHRydWU7XG5cbiAgICAgICAgLy8gT25seSBpbmNsdWRlIGRldGFpbGVkIGJyZWFrZG93biBpZiB0aGVyZSBBUkUgZGlmZmVyZW5jZXNcbiAgICAgICAgaWYgKGlzRGlmZmVyZW50KSB7XG4gICAgICAgICAgZGlmZltmaWVsZF0gPSB7XG4gICAgICAgICAgICB0eXBlOiAnYXJyYXknLFxuICAgICAgICAgICAgYWRkZWQsXG4gICAgICAgICAgICByZW1vdmVkLFxuICAgICAgICAgICAgc3RhdHVzOiAnZGlmZmVyZW50J1xuICAgICAgICAgIH07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gQ29uY2lzZSBmb3IgXCJzYW1lXCIgc3RhdHVzXG4gICAgICAgICAgZGlmZltmaWVsZF0gPSB7XG4gICAgICAgICAgICB0eXBlOiAnYXJyYXknLFxuICAgICAgICAgICAgc3RhdHVzOiAnc2FtZSdcbiAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgIH0gZWxzZSBpZiAoc2NoZW1hVmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIHNjaGVtYVZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgICAvLyBPYmplY3QgY29tcGFyaXNvbiB1c2luZyBkZWVwIG5vcm1hbGl6YXRpb25cbiAgICAgICAgY29uc3QgY3VycmVudE5vcm1hbGl6ZWQgPSB0aGlzLmRlZXBOb3JtYWxpemUoY3VycmVudFZhbHVlKTtcbiAgICAgICAgY29uc3Qgc2NoZW1hTm9ybWFsaXplZCA9IHRoaXMuZGVlcE5vcm1hbGl6ZShzY2hlbWFWYWx1ZSk7XG4gICAgICAgIGNvbnN0IGlzRGlmZmVyZW50ID0gY3VycmVudE5vcm1hbGl6ZWQgIT09IHNjaGVtYU5vcm1hbGl6ZWQ7XG5cbiAgICAgICAgaWYgKGlzRGlmZmVyZW50KSBoYXNEaWZmZXJlbmNlcyA9IHRydWU7XG5cbiAgICAgICAgZGlmZltmaWVsZF0gPSB7XG4gICAgICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICAgICAgY3VycmVudDogY3VycmVudFZhbHVlLFxuICAgICAgICAgIHNjaGVtYTogc2NoZW1hVmFsdWUsXG4gICAgICAgICAgc3RhdHVzOiBpc0RpZmZlcmVudCA/ICdkaWZmZXJlbnQnIDogJ3NhbWUnXG4gICAgICAgIH07XG5cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFNjYWxhciBjb21wYXJpc29uIChzdHJpbmcsIG51bWJlciwgYm9vbGVhbiwgbnVsbCwgdW5kZWZpbmVkKVxuICAgICAgICBjb25zdCBpc0RpZmZlcmVudCA9IGN1cnJlbnRWYWx1ZSAhPT0gc2NoZW1hVmFsdWU7XG4gICAgICAgIFxuICAgICAgICBpZiAoaXNEaWZmZXJlbnQpIGhhc0RpZmZlcmVuY2VzID0gdHJ1ZTtcblxuICAgICAgICBkaWZmW2ZpZWxkXSA9IHtcbiAgICAgICAgICB0eXBlOiAnc2NhbGFyJyxcbiAgICAgICAgICBjdXJyZW50OiBjdXJyZW50VmFsdWUsXG4gICAgICAgICAgc2NoZW1hOiBzY2hlbWFWYWx1ZSxcbiAgICAgICAgICBzdGF0dXM6IGlzRGlmZmVyZW50ID8gJ2RpZmZlcmVudCcgOiAnc2FtZSdcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4geyBkaWZmLCBoYXNEaWZmZXJlbmNlcyB9O1xuICB9XG5cbiAgQFB1dCgnL2luZGljZXMve2VudGl0eU5hbWV9L3NldHRpbmdzJywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIHNldHRpbmdzOiB7IGRhdGF0eXBlOiAnb2JqZWN0JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgdXBkYXRlSW5kZXhTZXR0aW5ncyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgc2V0dGluZ3M6IFJlY29yZDxzdHJpbmcsIGFueT47IH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG4gICAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcmVxLmJvZHkgfHwge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2VhcmNoU2VydmljZS51cGRhdGVJbmRleFNldHRpbmdzKHNldHRpbmdzLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICByZXN1bHQsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIG1lc3NhZ2U6ICdJbmRleCBzZXR0aW5ncyB1cGRhdGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgfSk7XG4gIH1cblxuICBAUG9zdCgnL2luZGljZXMve2VudGl0eU5hbWV9L3Jlc2V0LXNldHRpbmdzJylcbiAgYXN5bmMgcmVzZXRJbmRleFNldHRpbmdzKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UucmVzZXRJbmRleFNldHRpbmdzKCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBtZXNzYWdlOiAnSW5kZXggc2V0dGluZ3MgcmVzZXQgdG8gTWVpbGlzZWFyY2ggZGVmYXVsdHMnXG4gICAgfSk7XG4gIH1cblxuICBAUG9zdCgnL2luZGljZXMve2VudGl0eU5hbWV9L2FwcGx5LWRlZmF1bHQtc2V0dGluZ3MnKVxuICBhc3luYyBhcHBseURlZmF1bHRTZXR0aW5ncyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgXG4gICAgLy8gR2V0IHNjaGVtYS1kZXJpdmVkIHNldHRpbmdzXG4gICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIGNvbnN0IHNjaGVtYVNldHRpbmdzID0gc2VhcmNoQ29uZmlnLnNldHRpbmdzIHx8IHt9O1xuXG4gICAgLy8gQXBwbHkgdGhlIHNjaGVtYS1kZXJpdmVkIHNldHRpbmdzXG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS51cGRhdGVJbmRleFNldHRpbmdzKHNjaGVtYVNldHRpbmdzLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGFwcGxpZWRTZXR0aW5nczogc2NoZW1hU2V0dGluZ3MsXG4gICAgICBtZXNzYWdlOiAnSW5kZXggc2V0dGluZ3Mgc3luY2VkIHN1Y2Nlc3NmdWxseSBmcm9tIGVudGl0eSBzY2hlbWEnXG4gICAgfSk7XG4gIH1cblxuICBAUG9zdCgnL2luZGljZXMve2VudGl0eU5hbWV9L2luaXQnKVxuICBhc3luYyBpbml0U2luZ2xlRW50aXR5SW5kZXgoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3QgZW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGlmICghZW50aXR5U2VydmljZS5pc1NlYXJjaEVuYWJsZWQoKSkge1xuICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIG1lc3NhZ2U6IGBTZWFyY2ggaXMgbm90IGVuYWJsZWQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmluaXRTZWFyY2hJbmRleCgpO1xuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgIGNvbmZpZyxcbiAgICAgIG1lc3NhZ2U6IGBJbmRleCAke2NvbmZpZy5pbmRleE5hbWV9IGluaXRpYWxpemVkIHN1Y2Nlc3NmdWxseWAsXG4gICAgfSk7XG4gIH1cblxuICBAUG9zdCgnL2luZGljZXMve2VudGl0eU5hbWV9L3JlY3JlYXRlJylcbiAgYXN5bmMgcmVjcmVhdGVJbmRleChcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgcmVzeW5jRG9jdW1lbnRzPzogYm9vbGVhbjtcbiAgICAgICAgc3luY01ldGhvZD86ICdkaXJlY3QnIHwgJ3F1ZXVlJztcbiAgICAgICAgYmF0Y2hTaXplPzogbnVtYmVyO1xuICAgICAgICBxdWV1ZVVybD86IHN0cmluZztcbiAgICAgIH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuICAgIGNvbnN0IHsgXG4gICAgICByZXN5bmNEb2N1bWVudHMgPSBmYWxzZSwgXG4gICAgICBzeW5jTWV0aG9kID0gJ2RpcmVjdCcsXG4gICAgICBiYXRjaFNpemUgPSA1MCxcbiAgICAgIHF1ZXVlVXJsIFxuICAgIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBjb25zdCBvbGRDb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhgUmVjcmVhdGluZyBpbmRleCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gLCB7IG9sZENvbmZpZyB9KTtcblxuICAgIC8vIERlbGV0ZSBleGlzdGluZyBpbmRleFxuICAgIHRoaXMubG9nZ2VyLmluZm8oYERlbGV0aW5nIGV4aXN0aW5nIGluZGV4OiAke29sZENvbmZpZy5pbmRleE5hbWV9YCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZGVsZXRlU2VhcmNoSW5kZXgodHJ1ZSk7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihgQ291bGQgbm90IGRlbGV0ZSBpbmRleCAobWlnaHQgbm90IGV4aXN0KTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgIH1cblxuICAgIC8vIFJlaW5pdGlhbGl6ZSBpbmRleCB3aXRoIG5ldyBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5sb2dnZXIuaW5mbyhgUmVpbml0aWFsaXppbmcgaW5kZXggZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5pbml0U2VhcmNoSW5kZXgoKTtcbiAgICBjb25zdCBuZXdDb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG5cbiAgICBsZXQgcmVzeW5jUmVzdWx0ID0gbnVsbDtcblxuICAgIC8vIE9wdGlvbmFsbHkgcmVzeW5jIGFsbCBkb2N1bWVudHNcbiAgICBpZiAocmVzeW5jRG9jdW1lbnRzKSB7XG4gICAgICBpZiAoc3luY01ldGhvZCA9PT0gJ3F1ZXVlJykge1xuICAgICAgICAvLyBRdWV1ZS1iYXNlZCBzeW5jIChub24tYmxvY2tpbmcsIGZvciBsYXJnZSBkYXRhc2V0cylcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgUXVldWVpbmcgZG9jdW1lbnRzIGZvciByZXN5bmM6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgcmVzeW5jUmVzdWx0ID0gYXdhaXQgdGhpcy5xdWV1ZURvY3VtZW50c0ZvclJlc3luYyhlbnRpdHlOYW1lLCB7IGJhdGNoU2l6ZSwgcXVldWVVcmwgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBEaXJlY3Qgc3luYyAoYmxvY2tpbmcsIGltbWVkaWF0ZSBjb25maXJtYXRpb24pXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYERpcmVjdGx5IHJlc3luY2luZyBkb2N1bWVudHM6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgcmVzeW5jUmVzdWx0ID0gYXdhaXQgc2VhcmNoU2VydmljZS5yZXN5bmNBbGxEb2N1bWVudHMoeyBiYXRjaFNpemUgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgb2xkSW5kZXhOYW1lOiBvbGRDb25maWcuaW5kZXhOYW1lLFxuICAgICAgbmV3SW5kZXhOYW1lOiBuZXdDb25maWcuaW5kZXhOYW1lLFxuICAgICAgc3luY01ldGhvZDogcmVzeW5jRG9jdW1lbnRzID8gc3luY01ldGhvZCA6IG51bGwsXG4gICAgICBtZXNzYWdlOiBgSW5kZXggcmVjcmVhdGVkIHN1Y2Nlc3NmdWxseSR7cmVzeW5jRG9jdW1lbnRzID8gYCAoJHtzeW5jTWV0aG9kfSBzeW5jOiAke3Jlc3luY1Jlc3VsdD8ucHJvY2Vzc2VkQ291bnQgfHwgMH0gZG9jdW1lbnRzKWAgOiAnJ31gLFxuICAgICAgcmVzeW5jUmVzdWx0LFxuICAgICAgY29uZmlnczogeyBvbGRDb25maWcsIG5ld0NvbmZpZyB9XG4gICAgfSk7XG4gIH1cblxuICBARGVsZXRlKCcvaW5kaWNlcy97ZW50aXR5TmFtZX0nKVxuICBhc3luYyBkZWxldGVJbmRleChcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmRlbGV0ZVNlYXJjaEluZGV4KHRydWUpO1xuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdJbmRleCBkZWxldGVkIHN1Y2Nlc3NmdWxseSdcbiAgICB9KTtcbiAgfVxuXG4gIEBEZWxldGUoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9kb2N1bWVudHMnKVxuICBhc3luYyBjbGVhckVudGl0eUluZGV4KFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5nZXRFbmdpbmUoKS5kZWxldGVBbGxEb2N1bWVudHMoY29uZmlnLmluZGV4TmFtZSEsIHRydWUpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgbWVzc2FnZTogJ0FsbCBkb2N1bWVudHMgY2xlYXJlZCBmcm9tIGluZGV4J1xuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9yZXN5bmMnKVxuICBhc3luYyByZXN5bmNFbnRpdHlSZWNvcmRzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBiYXRjaFNpemU/OiBudW1iZXI7IHF1ZXVlVXJsPzogc3RyaW5nOyBieUJhdGNoPzogYm9vbGVhbiB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcbiAgICBjb25zdCB7IGJhdGNoU2l6ZSA9IDUwLCBxdWV1ZVVybCwgYnlCYXRjaCA9IHRydWUgfSA9IHJlcS5ib2R5IHx8IHt9O1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5xdWV1ZURvY3VtZW50c0ZvclJlc3luYyhlbnRpdHlOYW1lLCB7IGJhdGNoU2l6ZSwgcXVldWVVcmwsIGJ5QmF0Y2ggfSk7XG5cbiAgICBsZXQgbWVzc2FnZSA9IGBRdWV1ZWQgJHtyZXN1bHQucHJvY2Vzc2VkQ291bnR9IHJlY29yZHMgZm9yIHJlLWluZGV4aW5nYDtcbiAgICBpZiAocmVzdWx0LmZhaWxlZENvdW50ID4gMCkge1xuICAgICAgbWVzc2FnZSArPSBgLCAke3Jlc3VsdC5mYWlsZWRDb3VudH0gcmVjb3JkcyBmYWlsZWQgdG8gYmUgcXVldWVkYDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgbWVzc2FnZSxcbiAgICAgIHN1Y2Nlc3M6IHJlc3VsdC5wcm9jZXNzZWRDb3VudCA+IDAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgLi4ucmVzdWx0LFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlIGRvY3VtZW50cyBmb3IgYXN5bmMgcmVzeW5jIHZpYSBTUVNcbiAgICogU2hhcmVkIGxvZ2ljIHVzZWQgYnkgcmVzeW5jIGFuZCByZWNyZWF0ZSBlbmRwb2ludHNcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcXVldWVEb2N1bWVudHNGb3JSZXN5bmMoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIG9wdGlvbnM6IHtcbiAgICAgIGJhdGNoU2l6ZT86IG51bWJlcjtcbiAgICAgIHF1ZXVlVXJsPzogc3RyaW5nO1xuICAgICAgYnlCYXRjaD86IGJvb2xlYW47XG4gICAgfVxuICApOiBQcm9taXNlPHtcbiAgICBwcm9jZXNzZWRDb3VudDogbnVtYmVyO1xuICAgIGZhaWxlZENvdW50OiBudW1iZXI7XG4gICAgdG90YWxJdGVyYXRpb25zOiBudW1iZXI7XG4gIH0+IHtcbiAgICBjb25zdCB7IGJhdGNoU2l6ZSA9IDUwLCBxdWV1ZVVybCwgYnlCYXRjaCA9IHRydWUgfSA9IG9wdGlvbnM7XG4gICAgY29uc3QgZW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIC8vIFVzZSBwcm92aWRlZCBxdWV1ZVVybCBvciByZXNvbHZlIGZyb20gZW52aXJvbm1lbnRcbiAgICBjb25zdCBxdWV1ZU5hbWUgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IFNFQVJDSF9DT05UUk9MTEVSX0VOVl9LRVlTLk1FSUxJU0VBUkNIX1NZTkNfUVVFVUVfTkFNRSB9KTtcbiAgICBjb25zdCByZXNvbHZlZFF1ZXVlVXJsID0gcXVldWVVcmwgfHwgRW52aXJvbm1lbnQucXVldWVVcmwocXVldWVOYW1lKTtcblxuICAgIGlmICghcmVzb2x2ZWRRdWV1ZVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWV1ZSBVUkwgbm90IHByb3ZpZGVkIGZvciByZXN5bmNpbmcgcmVjb3JkcyBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX0gYW5kIGVudi1rZXkgWyR7U0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FfV0gaXMgbm90IGNvbmZpZ3VyZWRgKTtcbiAgICB9XG5cbiAgICBsZXQgZmFpbGVkQ291bnQgPSAwO1xuICAgIGxldCBwcm9jZXNzZWRDb3VudCA9IDA7XG4gICAgbGV0IGN1cnNvcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gJ2luaXQnO1xuICAgIGxldCBpdGVyYXRpb25Db3VudCA9IDA7XG4gICAgY29uc3QgbWF4SXRlcmF0aW9ucyA9IDEwMDAwMDtcblxuICAgIHdoaWxlICghIWN1cnNvciAmJiBpdGVyYXRpb25Db3VudCA8IG1heEl0ZXJhdGlvbnMpIHtcbiAgICAgIGl0ZXJhdGlvbkNvdW50Kys7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZldGNoaW5nICR7ZW50aXR5TmFtZX0gcmVjb3JkcyBmcm9tIGN1cnNvcjogJHtjdXJzb3J9YCk7XG5cbiAgICAgIGNvbnN0IHF1ZXJ5UmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5xdWVyeSh7XG4gICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICBsaW1pdDogYmF0Y2hTaXplLFxuICAgICAgICAgIGN1cnNvcjogY3Vyc29yID09PSAnaW5pdCcgPyB1bmRlZmluZWQgOiBjdXJzb3JcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGlmICghcXVlcnlSZXN1bHQuZGF0YSB8fCBxdWVyeVJlc3VsdC5kYXRhLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgaWYgKGJ5QmF0Y2gpIHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IFByb21pc2UuYWxsKHF1ZXJ5UmVzdWx0LmRhdGEubWFwKGFzeW5jIChyZWMpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgZW50aXR5U2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKHJlYyk7XG4gICAgICAgIH0pKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHNlbmRRdWV1ZU1lc3NhZ2UocmVzb2x2ZWRRdWV1ZVVybCwge1xuICAgICAgICAgICAgZGF0YSxcbiAgICAgICAgICAgIGV2ZW50TmFtZTogXCJSRVNZTkNcIixcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcHJvY2Vzc2VkQ291bnQgKz0gZGF0YS5sZW5ndGg7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcXVldWVpbmcgYmF0Y2ggZm9yIHN5bmM6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGVudGl0eU5hbWUsIGJhdGNoU2l6ZSwgZXJyb3IgfSk7XG4gICAgICAgICAgZmFpbGVkQ291bnQgKz0gZGF0YS5sZW5ndGg7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICAgIHF1ZXJ5UmVzdWx0LmRhdGEubWFwKGFzeW5jIChlbnRpdHlSZWNvcmQpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGNvbnN0IHRyYW5zZm9ybWVkID0gYXdhaXQgZW50aXR5U2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eVJlY29yZCk7XG4gICAgICAgICAgICAgIGF3YWl0IHNlbmRRdWV1ZU1lc3NhZ2UocmVzb2x2ZWRRdWV1ZVVybCwge1xuICAgICAgICAgICAgICBkYXRhOiB0cmFuc2Zvcm1lZCxcbiAgICAgICAgICAgICAgZXZlbnROYW1lOiBcIlJFU1lOQ1wiLFxuICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHByb2Nlc3NlZENvdW50Kys7XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcXVldWVpbmcgcmVjb3JkIGZvciBzeW5jOiAke2Vycm9yLm1lc3NhZ2V9YCwgeyBlbnRpdHlOYW1lLCBlcnJvciB9KTtcbiAgICAgICAgICAgIGZhaWxlZENvdW50Kys7XG4gICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGN1cnNvciA9IHF1ZXJ5UmVzdWx0LmN1cnNvciA/PyB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIuaW5mbyhgUXVldWUgc3luYyBjb21wbGV0ZWQgZm9yICR7ZW50aXR5TmFtZX1gLCB7XG4gICAgICBwcm9jZXNzZWRDb3VudCxcbiAgICAgIGZhaWxlZENvdW50LFxuICAgICAgdG90YWxJdGVyYXRpb25zOiBpdGVyYXRpb25Db3VudFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHByb2Nlc3NlZENvdW50LFxuICAgICAgZmFpbGVkQ291bnQsXG4gICAgICB0b3RhbEl0ZXJhdGlvbnM6IGl0ZXJhdGlvbkNvdW50LFxuICAgIH07XG4gIH1cblxuICBAR2V0KCcvcXVldWUtaW5mbycpXG4gIGFzeW5jIGdldFF1ZXVlSW5mbyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IHF1ZXVlVXJsOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBxdWV1ZVVybCB9ID0gcmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVyczsgIFxuXG4gICAgLy8gVXNlIHByb3ZpZGVkIHF1ZXVlVXJsIG9yIHJlc29sdmUgZnJvbSBlbnZpcm9ubWVudFxuICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FIH0pO1xuICAgIGNvbnN0IHJlc29sdmVkUXVldWVVcmwgPSBxdWV1ZVVybCB8fCBFbnZpcm9ubWVudC5xdWV1ZVVybChxdWV1ZU5hbWUpO1xuXG4gICAgY29uc3QgaW5mbyA9IGF3YWl0IGdldFF1ZXVlTWVzc2FnZU1ldGFkYXRhKHJlc29sdmVkUXVldWVVcmwpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHsgaW5mbyB9KTtcbiAgfVxuXG4gIEBQdXQoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfScsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBkb2N1bWVudHM6IHsgZGF0YXR5cGU6ICdhcnJheScsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIHVwZGF0ZURvY3VtZW50cyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgZG9jdW1lbnRzOiBhbnlbXSB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCB7IGRvY3VtZW50cyB9ID0gcmVxLmJvZHk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLnVwZGF0ZURvY3VtZW50cyhkb2N1bWVudHMsIHRydWUpO1xuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICByZXN1bHQsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIG1lc3NhZ2U6ICdEb2N1bWVudHMgdXBkYXRlZCBzdWNjZXNzZnVsbHknLFxuICAgIH0pO1xuICB9XG5cbiAgQERlbGV0ZSgnL3JlY29yZHMve2VudGl0eU5hbWV9L2J5LWlkcycsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBpZHM6IHsgZGF0YXR5cGU6ICdhcnJheScsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIGRlbGV0ZURvY3VtZW50c0J5SWRzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBpZHM6IHN0cmluZ1tdIH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHsgaWRzIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpLmRlbGV0ZURvY3VtZW50cyhpZHMsIGNvbmZpZy5pbmRleE5hbWUhLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdEb2N1bWVudHMgZGVsZXRlZCBzdWNjZXNzZnVsbHknXG4gICAgfSk7XG4gIH1cblxuICBARGVsZXRlKCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0vYnktZmlsdGVyJywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIGZpbHRlcjogeyBkYXRhdHlwZTogJ29iamVjdCcsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIGRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBmaWx0ZXI6IGFueSB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCB7IGZpbHRlciB9ID0gcmVxLmJvZHk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKGZpbHRlciwgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICBtZXNzYWdlOiAnRG9jdW1lbnRzIG1hdGNoaW5nIGZpbHRlciBoYXZlIGJlZW4gcXVldWVkIGZvciBkZWxldGlvbi4nXG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBwcm92aWRlciA9IHRoaXMuY29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWUsXG4gICAgICBmb3JFbnRpdHk6IGVudGl0eU5hbWUsXG4gICAgfSk7XG5cbiAgICBpZiAocHJvdmlkZXIubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHByb3ZpZGVyIGZvdW5kIGZvciBlbnRpdHktc2VydmljZSBmb3IgJHtlbnRpdHlOYW1lfWApO1xuICAgIH1cblxuICAgIHJldHVybiBwcm92aWRlclsgMCBdLl9jb250YWluZXIucmVzb2x2ZTxCYXNlRW50aXR5U2VydmljZTxhbnk+Pihwcm92aWRlclsgMCBdLl9wcm92aWRlci5wcm92aWRlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IGVudGl0eVNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpO1xuXG4gICAgaWYgKCFzZWFyY2hTZXJ2aWNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VhcmNoU2VydmljZTtcbiAgfVxufSJdfQ==