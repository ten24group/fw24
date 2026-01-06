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
const batch_progress_1 = require("../../observability/utils/batch-progress");
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
            if (!queryResult.data?.length)
                break;
            if (byBatch) {
                // Queue entire batch as one message
                const { summary } = await batch_progress_1.BatchProgress.all(`Queue ${entityName}`, queryResult.data, async (records) => {
                    const data = await batch_progress_1.BatchProgress.map(`Transform ${entityName}`, records, async (rec) => {
                        return entityService.transformDocumentForIndexing(rec);
                    });
                    await (0, sqs_1.sendQueueMessage)(resolvedQueueUrl, { data, eventName: 'RESYNC', entityName });
                    return data;
                }, { observe: 'errors', tags: { entity: entityName } });
                processedCount += summary.succeeded;
                failedCount += summary.failed;
            }
            else {
                // Queue each record individually
                const { summary } = await batch_progress_1.BatchProgress.process(`Queue ${entityName}`, queryResult.data, async (rec) => {
                    const transformed = await entityService.transformDocumentForIndexing(rec);
                    await (0, sqs_1.sendQueueMessage)(resolvedQueueUrl, { data: transformed, eventName: 'RESYNC', entityName });
                    return transformed;
                }, { concurrency: 5, observe: 'errors', tags: { entity: entityName } });
                processedCount += summary.succeeded;
                failedCount += summary.failed;
            }
            cursor = queryResult.cursor ?? undefined;
        }
        this.logger.info(`Queue sync completed for ${entityName}`, { processedCount, failedCount, iterations: iterationCount });
        return { processedCount, failedCount, totalIterations: iterationCount };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9zZWFyY2gtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFFQSwwQ0FBNkU7QUFDN0Usc0ZBQTBFO0FBRTFFLGlEQUFzRTtBQUN0RSxpQ0FBMkM7QUFHM0MsdUNBQTJEO0FBQzNELGtEQUFtRDtBQUNuRCx5Q0FBMkM7QUFDM0MsNkVBQXlFO0FBRXpFLElBQVksMEJBRVg7QUFGRCxXQUFZLDBCQUEwQjtJQUNwQyx5RkFBMkQsQ0FBQTtBQUM3RCxDQUFDLEVBRlcsMEJBQTBCLDBDQUExQiwwQkFBMEIsUUFFckM7QUFFRCxrREFBa0Q7QUFDbEQsa0hBQWtIO0FBQ2xILGlDQUFpQztBQUNqQyxhQUFhO0FBQ2Isb0VBQW9FO0FBQ3BFLFNBQVM7QUFDVCxLQUFLO0FBQ0UsSUFBTSxzQkFBc0IsR0FBNUIsTUFBTSxzQkFBdUIsU0FBUSxzQ0FBYTtJQUNkO0lBQXpDLFlBQXlDLFNBQXVCO1FBQzlELEtBQUssRUFBRSxDQUFDO1FBRCtCLGNBQVMsR0FBVCxTQUFTLENBQWM7SUFFaEUsQ0FBQztJQUVELEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBNEIsRUFBRSxRQUFpQixJQUFJLENBQUM7SUFHL0QsQUFBTixLQUFLLENBQUMsV0FBVyxDQUFDLFFBQWlCLEVBQUUsUUFBa0I7UUFDckQsNkNBQTZDO1FBQzdDLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsdUJBQXVCLENBQUM7WUFDN0QsSUFBSSxFQUFFLFNBQVM7WUFDZiwrQkFBK0IsRUFBRSxJQUFJO1NBQ3RDLENBQUM7YUFDQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUU7WUFDVixPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQTtRQUNoQyxDQUFDLENBQUMsQ0FBQztRQUVMLE1BQU0sV0FB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QUFpQyxFQUFFO1FBQ3pDLFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRTtnQkFDSixNQUFNLEVBQUUsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUU7YUFDL0M7U0FDRjtLQUNGLENBQUM7cUVBcUJEO2lDQXI0QlUsc0JBQXNCO0lBQ3BCLFdBQUEsSUFBQSxvQkFBZSxHQUFFLENBQUE7R0FEbkIsc0JBQXNCLENBKzVCbEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcblxuaW1wb3J0IHsgZ2V0UXVldWVNZXNzYWdlTWV0YWRhdGEsIHNlbmRRdWV1ZU1lc3NhZ2UgfSBmcm9tIFwiLi4vLi4vY2xpZW50L3Nxc1wiO1xuaW1wb3J0IHsgQVBJQ29udHJvbGxlciB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9hcGktZ2F0ZXdheS1jb250cm9sbGVyJztcbmltcG9ydCB0eXBlIHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gXCIuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBDb250cm9sbGVyLCBEZWxldGUsIEdldCwgUG9zdCwgUHV0IH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycyc7XG5pbXBvcnQgeyBJbmplY3RDb250YWluZXIgfSBmcm9tICcuLi8uLi9kaSc7XG5pbXBvcnQgeyB0eXBlIEJhc2VFbnRpdHlTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vZW50aXR5JztcbmltcG9ydCB7IHR5cGUgSURJQ29udGFpbmVyLCB0eXBlIFJlcXVlc3QsIHR5cGUgUmVzcG9uc2UgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IGRlZXBDb3B5LCByZXNvbHZlRW52VmFsdWVGb3IgfSBmcm9tICcuLi8uLi91dGlscyc7XG5pbXBvcnQgeyBwYXJzZVNlYXJjaFF1ZXJ5IH0gZnJvbSBcIi4uL3NlYXJjaC11dGlsc1wiO1xuaW1wb3J0IHsgRW52aXJvbm1lbnQgfSBmcm9tIFwiLi4vLi4vY2xpZW50XCI7XG5pbXBvcnQgeyBCYXRjaFByb2dyZXNzIH0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eS91dGlscy9iYXRjaC1wcm9ncmVzcyc7XG5cbmV4cG9ydCBlbnVtIFNFQVJDSF9DT05UUk9MTEVSX0VOVl9LRVlTIHtcbiAgTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FID0gJ01FSUxJU0VBUkNIX1NZTkNfUVVFVUVfTkFNRScsXG59XG5cbi8vIHRoZSBpbXBsZW1lbml0bmcgY29udHJvbGxlciBtdXN0IGRlZmluZSB0aGlzLi4gXG4vLyBodGUgY29udHJvbGxlciBkZWNvcnRhdG9yIGhlcmUgY2F1c2VzIGVycm9ycyBkdWUgdG8gZHluYW1pYyBsYXllciBpbXBvcnRzIGFuZCBwb2xsdXRlcyBhdXRvbWF0aWMgbGFtYmRhIGhhbmRsZXJcbi8vIEBDb250cm9sbGVyKCdzeXN0ZW0vc2VhcmNoJywge1xuLy8gICBlbnY6IFsge1xuLy8gICAgIG5hbWU6IFNFQVJDSF9DT05UUk9MTEVSX0VOVl9LRVlTLk1FSUxJU0VBUkNIX1NZTkNfUVVFVUVfTkFNRSxcbi8vICAgfSBdLFxuLy8gfSlcbmV4cG9ydCBjbGFzcyBTZWFyY2hTeXN0ZW1Db250cm9sbGVyIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG4gIGNvbnN0cnVjdG9yKEBJbmplY3RDb250YWluZXIoKSBwcm90ZWN0ZWQgY29udGFpbmVyOiBJRElDb250YWluZXIpIHtcbiAgICBzdXBlcigpO1xuICB9XG5cbiAgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBfY29udGV4dDogQ29udGV4dCkgeyB9XG5cbiAgQEdldCgnL2luZGljZXMnKVxuICBhc3luYyBsaXN0SW5kaWNlcyhfcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlKSB7XG4gICAgLy8gQXV0by1kaXNjb3ZlciBlbnRpdGllcyB3aXRoIHNlYXJjaCBlbmFibGVkXG4gICAgY29uc3QgZW50aXR5UHJvdmlkZXJzID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICB9KVxuICAgICAgLmZpbHRlcihwID0+IHtcbiAgICAgICAgcmV0dXJuICEhcC5fcHJvdmlkZXIuZm9yRW50aXR5XG4gICAgICB9KTtcblxuICAgIGNvbnN0IGluZGljZXNEYXRhOiBhbnlbXSA9IFtdO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZW50aXR5UHJvdmlkZXJzLm1hcChhc3luYyAocHJvdmlkZXIpID0+IHtcblxuICAgICAgY29uc3QgZW50aXR5TmFtZSA9IHByb3ZpZGVyLl9wcm92aWRlci5mb3JFbnRpdHkgYXMgc3RyaW5nO1xuXG4gICAgICB0cnkge1xuXG4gICAgICAgIC8vIHVzZSBwcm92aWRlcidzIGNvbnRhaW5lciAgdG8gcmVzb2x2ZSB0aGUgc2VydmljZVxuICAgICAgICBjb25zdCBzZXJ2aWNlID0gcHJvdmlkZXIuX2NvbnRhaW5lci5yZXNvbHZlPEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KFxuICAgICAgICAgIHByb3ZpZGVyLl9wcm92aWRlci5wcm92aWRlXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKCFzZXJ2aWNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZXJ2aWNlICR7U3RyaW5nKHByb3ZpZGVyLl9wcm92aWRlci5wcm92aWRlKX0gbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXNlYXJjaFNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGluZGV4SW5mbyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0SW5kZXhJbmZvKCk7XG5cbiAgICAgICAgaW5kaWNlc0RhdGEucHVzaCh7XG4gICAgICAgICAgLi4uaW5kZXhJbmZvLFxuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgaW5kZXhOYW1lOiBpbmRleEluZm8udWlkLFxuICAgICAgICB9KTtcblxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuXG4gICAgICAgIGluZGljZXNEYXRhLnB1c2goe1xuICAgICAgICAgIGluZGV4TmFtZTogYFske2VudGl0eU5hbWV9XS1pbmRleC1uYW1lLW5vdC1yZXNvbHZlZGAsXG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoZXJyb3IpO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIHJldHVybiByZXNwb25zZS5qc29uKHsgaW5kaWNlczogaW5kaWNlc0RhdGEgfSk7XG4gIH1cblxuICAvKipcbiAgICogQWRkIG5ldyBhcGkgdG8gZ2V0IGluZGV4IGRldGFpbHNcbiAgICogXG4gICAqL1xuXG4gIEBHZXQoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfScsIHt9KVxuICBhc3luYyBnZXRJbmRleERldGFpbHMoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IGluZGV4SW5mbyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0SW5kZXhJbmZvKCk7XG4gICAgY29uc3QgaW5kZXhTdGF0cyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0SW5kZXhTdGF0cygpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIGRldGFpbHM6IHtcbiAgICAgICAgaW5kZXhJbmZvLFxuICAgICAgICBpbmRleFN0YXRzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgQEdldCgnL2VudGl0aWVzJylcbiAgYXN5bmMgZ2V0U2VhcmNoRW50aXRpZXMoX3JlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IGVudGl0eVByb3ZpZGVycyA9IHRoaXMuY29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWUsXG4gICAgfSlcbiAgICAgIC5maWx0ZXIocCA9PiAhIXAuX3Byb3ZpZGVyLmZvckVudGl0eSk7XG5cbiAgICBjb25zdCBlbnRpdGllc0RhdGE6IHtcbiAgICAgIGVudGl0eU5hbWU6IHN0cmluZztcbiAgICAgIHNlYXJjaEVuYWJsZWQ6IGJvb2xlYW47XG4gICAgICBpbmRleEV4aXN0cz86IGJvb2xlYW47XG4gICAgICBpbmRleE5hbWU/OiBzdHJpbmc7XG4gICAgICBlcnJvcj86IHN0cmluZztcbiAgICB9W10gPSBbXTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKGVudGl0eVByb3ZpZGVycy5tYXAoYXN5bmMgKHByb3ZpZGVyKSA9PiB7XG4gICAgICBjb25zdCBlbnRpdHlOYW1lID0gcHJvdmlkZXIuX3Byb3ZpZGVyLmZvckVudGl0eSBhcyBzdHJpbmc7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNlcnZpY2UgPSBwcm92aWRlci5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oXG4gICAgICAgICAgcHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGVcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAoIXNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoRW5hYmxlZCA9IHNlcnZpY2UuaXNTZWFyY2hFbmFibGVkKCk7XG4gICAgICAgIGxldCBpbmRleEV4aXN0cyA9IGZhbHNlO1xuICAgICAgICBsZXQgaW5kZXhOYW1lID0gJyc7XG5cbiAgICAgICAgaWYgKHNlYXJjaEVuYWJsZWQpIHtcbiAgICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gc2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgICAgaWYgKHNlYXJjaFNlcnZpY2UpIHtcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICAgICAgICAgIGluZGV4TmFtZSA9IGNvbmZpZy5pbmRleE5hbWUhO1xuICAgICAgICAgICAgaW5kZXhFeGlzdHMgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpLmluZGV4RXhpc3RzKGluZGV4TmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZW50aXRpZXNEYXRhLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgc2VhcmNoRW5hYmxlZCxcbiAgICAgICAgICBpbmRleEV4aXN0cyxcbiAgICAgICAgICBpbmRleE5hbWUsXG4gICAgICAgIH0pO1xuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIGVudGl0aWVzRGF0YS5wdXNoKHtcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIHNlYXJjaEVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KSk7XG5cbiAgICByZXR1cm4gcmVzcG9uc2UuanNvbih7IGVudGl0aWVzOiBlbnRpdGllc0RhdGEgfSk7XG4gIH1cblxuICBAR2V0KCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0ve2RvY3VtZW50SWR9JylcbiAgYXN5bmMgZ2V0U2luZ2xlRG9jdW1lbnQoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcsIGRvY3VtZW50SWQ6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBkb2N1bWVudElkIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgZW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHByaW1hcnlJZEZpZWxkTmFtZSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG5cbiAgICBjb25zdCBkb2MgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldERvY3VtZW50KGRvY3VtZW50SWQpO1xuXG4gICAgZG9jWyAnaWQnIF0gPSBkb2NbICdpZCcgXSB8fCBkb2NbIHByaW1hcnlJZEZpZWxkTmFtZSBhcyBzdHJpbmcgXTtcbiAgICBkb2NbICdmdWxsUmVjb3JkJyBdID0geyAuLi5kb2MgfTtcbiAgICBkb2NbICdlbnRpdHlOYW1lJyBdID0gZW50aXR5TmFtZTtcblxuICAgIHJldHVybiByZXMuanNvbihkb2MpO1xuICB9XG5cbiAgQEdldCgnL3JlY29yZHMve2VudGl0eU5hbWV9JylcbiAgYXN5bmMgZ2V0RW50aXR5UmVjb3JkcyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVycz86IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHRcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcXVlcnkgPSBkZWVwQ29weShyZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzKTtcblxuICAgIGNvbnN0IHBhcnNlZFF1ZXJ5ID0gcGFyc2VTZWFyY2hRdWVyeShxdWVyeSk7XG4gICAgY29uc3QgeyBzZWxlY3Q6IF9zZWxlY3QsIC4uLnJlc3RRdWVyeVBhcmFtcyB9ID0gcGFyc2VkUXVlcnk7XG5cbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgZW50aXR5U2VydmljZS5zZWFyY2gocmVzdFF1ZXJ5UGFyYW1zLCBjdHgpO1xuXG4gICAgY29uc3QgeyBoaXRzLCAuLi5yZXN0IH0gPSByZXN1bHRzO1xuXG4gICAgLy8gR2V0IHRoZSBlbnRpdHkncyBwcmltYXJ5IGlkZW50aWZpZXIgZmllbGQgbmFtZVxuICAgIGNvbnN0IHByaW1hcnlJZEZpZWxkTmFtZSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG5cbiAgICAvLyBFbnN1cmUgYWxsIHJlY29yZHMgaGF2ZSBhIGNvbnNpc3RlbnQgJ2lkJyBmaWVsZCBmb3IgZ2VuZXJpYyBVSSBsaXN0aW5nXG4gICAgY29uc3Qgbm9ybWFsaXplZEhpdHMgPSBoaXRzLm1hcCgoaGl0OiBhbnkpID0+IHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRIaXQgPSB7IC4uLmhpdCB9O1xuXG4gICAgICBub3JtYWxpemVkSGl0WyAnZW50aXR5TmFtZScgXSA9IGVudGl0eU5hbWU7XG4gICAgICBub3JtYWxpemVkSGl0WyAnZnVsbFJlY29yZCcgXSA9IGhpdDtcblxuICAgICAgLy8gSWYgdGhlIHJlY29yZCBkb2Vzbid0IGhhdmUgYW4gJ2lkJyBmaWVsZCBidXQgaGFzIHRoZSBwcmltYXJ5IGlkZW50aWZpZXIgZmllbGQsXG4gICAgICAvLyBtYXAgaXQgdG8gJ2lkJyBmb3IgY29uc2lzdGVudCBnZW5lcmljIGxpc3RpbmdcbiAgICAgIGlmICghbm9ybWFsaXplZEhpdC5pZCAmJiBwcmltYXJ5SWRGaWVsZE5hbWUgJiYgbm9ybWFsaXplZEhpdFsgcHJpbWFyeUlkRmllbGROYW1lIF0pIHtcbiAgICAgICAgbm9ybWFsaXplZEhpdC5pZCA9IG5vcm1hbGl6ZWRIaXRbIHByaW1hcnlJZEZpZWxkTmFtZSBdO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiBzdGlsbCBubyBpZCBmaWVsZCwgdHJ5IGNvbW1vbiBpZGVudGlmaWVyIHBhdHRlcm5zXG4gICAgICBpZiAoIW5vcm1hbGl6ZWRIaXQuaWQpIHtcbiAgICAgICAgY29uc3QgaWRGaWVsZHMgPSBbIGAke2VudGl0eU5hbWV9SWRgLCBgJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9SWRgIF07XG4gICAgICAgIGZvciAoY29uc3QgaWRGaWVsZCBvZiBpZEZpZWxkcykge1xuICAgICAgICAgIGlmIChub3JtYWxpemVkSGl0WyBpZEZpZWxkIF0pIHtcbiAgICAgICAgICAgIG5vcm1hbGl6ZWRIaXQuaWQgPSBub3JtYWxpemVkSGl0WyBpZEZpZWxkIF07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG5vcm1hbGl6ZWRIaXQ7XG4gICAgfSk7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IHtcbiAgICAgIC4uLnJlc3QsXG4gICAgICBpdGVtczogbm9ybWFsaXplZEhpdHMsXG4gICAgfTtcblxuICAgIGlmIChyZXEuZGVidWdNb2RlKSB7XG4gICAgICBPYmplY3QuYXNzaWduKHJlc3BvbnNlLCB7XG4gICAgICAgIGlucHV0UXVlcnk6IHF1ZXJ5LFxuICAgICAgICBwcm9jZXNzaW5nVGltZU1zOiByZXN1bHRzLnByb2Nlc3NpbmdUaW1lTXMsXG4gICAgICAgIHByaW1hcnlJZEZpZWxkTmFtZVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcy5qc29uKHJlc3BvbnNlKTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5pdEluZGljZXMnKVxuICBhc3luYyBpbml0U2VhcmNoSW5kaWNlcyhcbiAgICByZXE6IFJlcXVlc3Q8eyBib2R5OiB7IGVudGl0aWVzPzogc3RyaW5nW10gfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBlbnRpdGllczogcmVxdWVzdGVkRW50aXRpZXMgPSBbXSB9ID0gcmVxLmJvZHkgfHwge307XG5cbiAgICAvLyBjb2xsZWN0IHByb3ZpZGVyIGZvciBlbnRpdHktc2VydmljZXMgZnJvbSBjb250YWluZXItaGllcmFyY2h5XG4gICAgY29uc3QgZW50aXR5UHJvdmlkZXJzID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICB9KVxuICAgICAgLmZpbHRlcihwID0+IChcbiAgICAgICAgLy8gZmlsdGVyIG91dCBwcm92aWRlcnMgdGhhdCBkbyBub3QgaGF2ZSBhIGZvckVudGl0eSBwcm9wZXJ0eVxuICAgICAgICAhIXAuX3Byb3ZpZGVyLmZvckVudGl0eVxuICAgICAgICAmJiAoXG4gICAgICAgICAgLy8gaWYgbm8gZW50aXRpZXMgYXJlIHJlcXVlc3RlZCwgaW5jbHVkZSBhbGwgZW50aXRpZXNcbiAgICAgICAgICAhcmVxdWVzdGVkRW50aXRpZXM/Lmxlbmd0aFxuICAgICAgICAgIC8vIGlmIGVudGl0aWVzIGFyZSByZXF1ZXN0ZWQsIGluY2x1ZGUgb25seSB0aGUgcmVxdWVzdGVkIGVudGl0aWVzXG4gICAgICAgICAgfHwgcmVxdWVzdGVkRW50aXRpZXMuaW5jbHVkZXMocC5fcHJvdmlkZXIuZm9yRW50aXR5IGFzIHN0cmluZylcbiAgICAgICAgKVxuICAgICAgKSk7XG5cbiAgICBjb25zdCByZXN1bHRzOiB7XG4gICAgICBlcnJvcj86IHN0cmluZztcbiAgICAgIHN1Y2Nlc3M6IGJvb2xlYW47XG4gICAgICBtZXNzYWdlPzogc3RyaW5nO1xuICAgICAgcmVzeW5jUmVzdWx0PzogYW55O1xuICAgICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgICAgaW5kZXhOYW1lPzogc3RyaW5nO1xuICAgICAgaW5kZXhDb25maWc/OiBhbnk7XG4gICAgfVtdID0gW107XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChlbnRpdHlQcm92aWRlcnMubWFwKGFzeW5jIChwcm92aWRlcikgPT4ge1xuICAgICAgY29uc3QgZW50aXR5TmFtZSA9IHByb3ZpZGVyLl9wcm92aWRlci5mb3JFbnRpdHkgYXMgc3RyaW5nO1xuXG4gICAgICB0cnkge1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2UgPSBwcm92aWRlci5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oXG4gICAgICAgICAgcHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGVcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFzZXJ2aWNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbnRpdHlTZXJ2aWNlIGNvdWxkIG5vdCBiZSByZXNvbHZlZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENoZWNrIGlmIHNlYXJjaCBpcyBlbmFibGVkIGJlZm9yZSBhdHRlbXB0aW5nIHRvIGluaXRpYWxpemVcbiAgICAgICAgaWYgKCFzZXJ2aWNlLmlzU2VhcmNoRW5hYmxlZCgpKSB7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIG1lc3NhZ2U6IGBTZWFyY2ggaXMgbm90IGVuYWJsZWQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gc2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgIGlmICghc2VhcmNoU2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIHNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgc2VhcmNoU2VydmljZS5pbml0U2VhcmNoSW5kZXgoKTtcbiAgICAgICAgY29uc3QgY29uZmlnID0gc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuXG4gICAgICAgIGxldCByZXN5bmNSZXN1bHQ6IGFueTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJlc3luY1Jlc3VsdCA9IGF3YWl0IHRoaXMucXVldWVEb2N1bWVudHNGb3JSZXN5bmMoZW50aXR5TmFtZSwgeyBiYXRjaFNpemU6IDUwLCBxdWV1ZVVybDogdW5kZWZpbmVkLCBieUJhdGNoOiB0cnVlIH0pO1xuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIHJlc3luY2luZyByZWNvcmRzIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfTogJHtlcnJvci5tZXNzYWdlfWAsIHsgZXJyb3IgfSk7XG4gICAgICAgICAgcmVzeW5jUmVzdWx0ID0ge1xuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICBtZXNzYWdlOiBgRXJyb3IgcmVzeW5jaW5nIHJlY29yZHMgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9OiAke2Vycm9yLm1lc3NhZ2V9YCxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgICAgICBpbmRleENvbmZpZzogY29uZmlnLFxuICAgICAgICAgIHJlc3luY1Jlc3VsdCxcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgIG1lc3NhZ2U6IGBJbmRleCAke2NvbmZpZy5pbmRleE5hbWV9IGluaXRpYWxpemVkIHN1Y2Nlc3NmdWxseWAsXG4gICAgICAgIH0pO1xuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBlcnJvcjogZXJyb3IsXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgbWVzc2FnZTogYEVycm9yIGluaXRpYWxpemluZyBpbmRleCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX06ICR7ZXJyb3IubWVzc2FnZX1gLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oeyByZXN1bHRzIH0pO1xuICB9XG5cbiAgQEdldCgnL2luZGljZXMve2VudGl0eU5hbWV9L3NldHRpbmdzJylcbiAgYXN5bmMgZ2V0SW5kZXhTZXR0aW5ncyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIC8vIEdldCBjdXJyZW50IHNldHRpbmdzIGZyb20gdGhlIHNlYXJjaCBlbmdpbmVcbiAgICBjb25zdCBjdXJyZW50U2V0dGluZ3MgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEluZGV4U2V0dGluZ3MoKTtcblxuICAgIC8vIEdldCBhdXRvLWdlbmVyYXRlZCBzZXR0aW5ncyBmcm9tIGVudGl0eSBzY2hlbWFcbiAgICBjb25zdCBzZWFyY2hDb25maWcgPSBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgY29uc3Qgc2NoZW1hU2V0dGluZ3MgPSBzZWFyY2hDb25maWcuc2V0dGluZ3MgfHwge307XG5cbiAgICAvLyBDYWxjdWxhdGUgZGVlcCBkaWZmXG4gICAgY29uc3QgeyBkaWZmLCBoYXNEaWZmZXJlbmNlcyB9ID0gdGhpcy5jYWxjdWxhdGVTZXR0aW5nc0RpZmYoY3VycmVudFNldHRpbmdzLCBzY2hlbWFTZXR0aW5ncyk7XG5cbiAgICAvLyBCdWlsZCBpbmZvcm1hdGl2ZSBzdGF0dXMgbWVzc2FnZVxuICAgIGxldCBzdGF0dXMgPSAn4pyTIEluZGV4IHNldHRpbmdzIG1hdGNoIGVudGl0eSBzY2hlbWEnO1xuICAgIGlmIChoYXNEaWZmZXJlbmNlcykge1xuICAgICAgY29uc3Qgc3VtbWFyeTogc3RyaW5nW10gPSBbXTtcbiAgICAgIGZvciAoY29uc3QgWyBmaWVsZCwgZmllbGREaWZmIF0gb2YgT2JqZWN0LmVudHJpZXMoZGlmZikpIHtcbiAgICAgICAgaWYgKGZpZWxkRGlmZi5zdGF0dXMgPT09ICdkaWZmZXJlbnQnICYmIGZpZWxkRGlmZi50eXBlID09PSAnYXJyYXknKSB7XG4gICAgICAgICAgY29uc3QgYWRkZWQgPSAoZmllbGREaWZmIGFzIGFueSkuYWRkZWQ/Lmxlbmd0aCB8fCAwO1xuICAgICAgICAgIGNvbnN0IHJlbW92ZWQgPSAoZmllbGREaWZmIGFzIGFueSkucmVtb3ZlZD8ubGVuZ3RoIHx8IDA7XG4gICAgICAgICAgaWYgKGFkZGVkID4gMCkgc3VtbWFyeS5wdXNoKGAke2FkZGVkfSBuZXcgaW4gc2NoZW1hICgke2ZpZWxkfSlgKTtcbiAgICAgICAgICBpZiAocmVtb3ZlZCA+IDApIHN1bW1hcnkucHVzaChgJHtyZW1vdmVkfSBvbmx5IGluIGluZGV4ICgke2ZpZWxkfSlgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgc3RhdHVzID0gc3VtbWFyeS5sZW5ndGggPiAwXG4gICAgICAgID8gYOKEue+4jyBEaWZmZXJlbmNlcyBmb3VuZDogJHtzdW1tYXJ5LmpvaW4oJywgJyl9YFxuICAgICAgICA6ICfihLnvuI8gU2V0dGluZ3MgZGlmZmVyIGZyb20gc2NoZW1hJztcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc2V0dGluZ3M6IGN1cnJlbnRTZXR0aW5ncyxcbiAgICAgIHNjaGVtYVNldHRpbmdzLFxuICAgICAgZGlmZixcbiAgICAgIGhhc0RpZmZlcmVuY2VzLFxuICAgICAgc3RhdHVzLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIERlZXAgbm9ybWFsaXplIGFueSB2YWx1ZSBmb3IgY29uc2lzdGVudCBjb21wYXJpc29uXG4gICAqIFJlY3Vyc2l2ZWx5IHNvcnRzIG9iamVjdCBrZXlzIGFuZCBoYW5kbGVzIGFycmF5cy9wcmltaXRpdmVzXG4gICAqL1xuICBwcml2YXRlIGRlZXBOb3JtYWxpemUodmFsdWU6IGFueSk6IHN0cmluZyB7XG4gICAgLy8gSGFuZGxlIHByaW1pdGl2ZXMgYW5kIG51bGwvdW5kZWZpbmVkXG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgYXJyYXlzIC0gcmVjdXJzaXZlbHkgbm9ybWFsaXplIGVhY2ggaXRlbVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgLy8gUGFyc2UgYmFjayBlYWNoIG5vcm1hbGl6ZWQgc3RyaW5nIHRvIGF2b2lkIGRvdWJsZSBzdHJpbmdpZmljYXRpb25cbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRBcnJheSA9IHZhbHVlLm1hcChpdGVtID0+IEpTT04ucGFyc2UodGhpcy5kZWVwTm9ybWFsaXplKGl0ZW0pKSk7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZEFycmF5KTtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgb2JqZWN0cyAtIHNvcnQga2V5cyBhbmQgcmVjdXJzaXZlbHkgbm9ybWFsaXplIHZhbHVlc1xuICAgIGNvbnN0IHNvcnRlZEtleXMgPSBPYmplY3Qua2V5cyh2YWx1ZSkuc29ydCgpO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRPYmo6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIGZvciAoY29uc3Qga2V5IG9mIHNvcnRlZEtleXMpIHtcbiAgICAgIC8vIFBhcnNlIGJhY2sgdGhlIG5vcm1hbGl6ZWQgc3RyaW5nIGZvciBuZXN0ZWQgc3RydWN0dXJlc1xuICAgICAgdHJ5IHtcbiAgICAgICAgbm9ybWFsaXplZE9ialsga2V5IF0gPSBKU09OLnBhcnNlKHRoaXMuZGVlcE5vcm1hbGl6ZSh2YWx1ZVsga2V5IF0pKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBub3JtYWxpemVkT2JqWyBrZXkgXSA9IHZhbHVlWyBrZXkgXTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZE9iaik7XG4gIH1cblxuICAvKipcbiAgICogQ2FsY3VsYXRlIGRpZmYgYmV0d2VlbiBjdXJyZW50IGluZGV4IHNldHRpbmdzIGFuZCBzY2hlbWEtZGVyaXZlZCBzZXR0aW5nc1xuICAgKiBPbmx5IGNvbXBhcmVzIGZpZWxkcyB0aGF0IGV4aXN0IGluIHNjaGVtYSBzZXR0aW5ncyAoZnJhbWV3b3JrLW1hbmFnZWQgZmllbGRzKVxuICAgKi9cbiAgcHJpdmF0ZSBjYWxjdWxhdGVTZXR0aW5nc0RpZmYoY3VycmVudDogUmVjb3JkPHN0cmluZywgYW55Piwgc2NoZW1hOiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSB7XG4gICAgY29uc3QgZGlmZjogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIGxldCBoYXNEaWZmZXJlbmNlcyA9IGZhbHNlO1xuXG4gICAgLy8gT05MWSBjb21wYXJlIGZpZWxkcyB0aGF0IGV4aXN0IGluIHNjaGVtYSBzZXR0aW5ncyAoZnJhbWV3b3JrLW1hbmFnZWQpXG4gICAgLy8gVHlwaWNhbGx5OiBzZWFyY2hhYmxlQXR0cmlidXRlcywgZmlsdGVyYWJsZUF0dHJpYnV0ZXMsIHNvcnRhYmxlQXR0cmlidXRlc1xuICAgIGNvbnN0IGZpZWxkc1RvQ29tcGFyZSA9IE9iamVjdC5rZXlzKHNjaGVtYSB8fCB7fSk7XG5cbiAgICBmb3IgKGNvbnN0IGZpZWxkIG9mIGZpZWxkc1RvQ29tcGFyZSkge1xuICAgICAgY29uc3QgY3VycmVudFZhbHVlID0gY3VycmVudFsgZmllbGQgXTtcbiAgICAgIGNvbnN0IHNjaGVtYVZhbHVlID0gc2NoZW1hWyBmaWVsZCBdO1xuXG4gICAgICAvLyBBcnJheSBjb21wYXJpc29uIChtb3N0IGNvbW1vbiBjYXNlIGZvciBvdXIgbWFuYWdlZCBmaWVsZHMpXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShzY2hlbWFWYWx1ZSkpIHtcbiAgICAgICAgY29uc3QgY3VyckFyciA9IEFycmF5LmlzQXJyYXkoY3VycmVudFZhbHVlKSA/IGN1cnJlbnRWYWx1ZSA6IFtdO1xuICAgICAgICBjb25zdCBzY2hlbWFBcnIgPSBzY2hlbWFWYWx1ZTtcblxuICAgICAgICAvLyBVc2UgZGVlcCBub3JtYWxpemVkIGNvbXBhcmlzb24gZm9yIGFycmF5IGl0ZW1zXG4gICAgICAgIGNvbnN0IGN1cnJOb3JtYWxpemVkU2V0ID0gbmV3IFNldChjdXJyQXJyLm1hcCgoaXRlbTogYW55KSA9PiB0aGlzLmRlZXBOb3JtYWxpemUoaXRlbSkpKTtcbiAgICAgICAgY29uc3Qgc2NoZW1hTm9ybWFsaXplZFNldCA9IG5ldyBTZXQoc2NoZW1hQXJyLm1hcCgoaXRlbTogYW55KSA9PiB0aGlzLmRlZXBOb3JtYWxpemUoaXRlbSkpKTtcblxuICAgICAgICBjb25zdCBhZGRlZCA9IHNjaGVtYUFyci5maWx0ZXIoKGl0ZW06IGFueSkgPT4gIWN1cnJOb3JtYWxpemVkU2V0Lmhhcyh0aGlzLmRlZXBOb3JtYWxpemUoaXRlbSkpKTtcbiAgICAgICAgY29uc3QgcmVtb3ZlZCA9IGN1cnJBcnIuZmlsdGVyKChpdGVtOiBhbnkpID0+ICFzY2hlbWFOb3JtYWxpemVkU2V0Lmhhcyh0aGlzLmRlZXBOb3JtYWxpemUoaXRlbSkpKTtcblxuICAgICAgICBjb25zdCBpc0RpZmZlcmVudCA9IGFkZGVkLmxlbmd0aCA+IDAgfHwgcmVtb3ZlZC5sZW5ndGggPiAwO1xuICAgICAgICBpZiAoaXNEaWZmZXJlbnQpIGhhc0RpZmZlcmVuY2VzID0gdHJ1ZTtcblxuICAgICAgICAvLyBPbmx5IGluY2x1ZGUgZGV0YWlsZWQgYnJlYWtkb3duIGlmIHRoZXJlIEFSRSBkaWZmZXJlbmNlc1xuICAgICAgICBpZiAoaXNEaWZmZXJlbnQpIHtcbiAgICAgICAgICBkaWZmWyBmaWVsZCBdID0ge1xuICAgICAgICAgICAgdHlwZTogJ2FycmF5JyxcbiAgICAgICAgICAgIGFkZGVkLFxuICAgICAgICAgICAgcmVtb3ZlZCxcbiAgICAgICAgICAgIHN0YXR1czogJ2RpZmZlcmVudCdcbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIENvbmNpc2UgZm9yIFwic2FtZVwiIHN0YXR1c1xuICAgICAgICAgIGRpZmZbIGZpZWxkIF0gPSB7XG4gICAgICAgICAgICB0eXBlOiAnYXJyYXknLFxuICAgICAgICAgICAgc3RhdHVzOiAnc2FtZSdcbiAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgIH0gZWxzZSBpZiAoc2NoZW1hVmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIHNjaGVtYVZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgICAvLyBPYmplY3QgY29tcGFyaXNvbiB1c2luZyBkZWVwIG5vcm1hbGl6YXRpb25cbiAgICAgICAgY29uc3QgY3VycmVudE5vcm1hbGl6ZWQgPSB0aGlzLmRlZXBOb3JtYWxpemUoY3VycmVudFZhbHVlKTtcbiAgICAgICAgY29uc3Qgc2NoZW1hTm9ybWFsaXplZCA9IHRoaXMuZGVlcE5vcm1hbGl6ZShzY2hlbWFWYWx1ZSk7XG4gICAgICAgIGNvbnN0IGlzRGlmZmVyZW50ID0gY3VycmVudE5vcm1hbGl6ZWQgIT09IHNjaGVtYU5vcm1hbGl6ZWQ7XG5cbiAgICAgICAgaWYgKGlzRGlmZmVyZW50KSBoYXNEaWZmZXJlbmNlcyA9IHRydWU7XG5cbiAgICAgICAgZGlmZlsgZmllbGQgXSA9IHtcbiAgICAgICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgICAgICBjdXJyZW50OiBjdXJyZW50VmFsdWUsXG4gICAgICAgICAgc2NoZW1hOiBzY2hlbWFWYWx1ZSxcbiAgICAgICAgICBzdGF0dXM6IGlzRGlmZmVyZW50ID8gJ2RpZmZlcmVudCcgOiAnc2FtZSdcbiAgICAgICAgfTtcblxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gU2NhbGFyIGNvbXBhcmlzb24gKHN0cmluZywgbnVtYmVyLCBib29sZWFuLCBudWxsLCB1bmRlZmluZWQpXG4gICAgICAgIGNvbnN0IGlzRGlmZmVyZW50ID0gY3VycmVudFZhbHVlICE9PSBzY2hlbWFWYWx1ZTtcblxuICAgICAgICBpZiAoaXNEaWZmZXJlbnQpIGhhc0RpZmZlcmVuY2VzID0gdHJ1ZTtcblxuICAgICAgICBkaWZmWyBmaWVsZCBdID0ge1xuICAgICAgICAgIHR5cGU6ICdzY2FsYXInLFxuICAgICAgICAgIGN1cnJlbnQ6IGN1cnJlbnRWYWx1ZSxcbiAgICAgICAgICBzY2hlbWE6IHNjaGVtYVZhbHVlLFxuICAgICAgICAgIHN0YXR1czogaXNEaWZmZXJlbnQgPyAnZGlmZmVyZW50JyA6ICdzYW1lJ1xuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7IGRpZmYsIGhhc0RpZmZlcmVuY2VzIH07XG4gIH1cblxuICBAUHV0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vc2V0dGluZ3MnLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgc2V0dGluZ3M6IHsgZGF0YXR5cGU6ICdvYmplY3QnLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyB1cGRhdGVJbmRleFNldHRpbmdzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBzZXR0aW5nczogUmVjb3JkPHN0cmluZywgYW55PjsgfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcbiAgICBjb25zdCB7IHNldHRpbmdzIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLnVwZGF0ZUluZGV4U2V0dGluZ3Moc2V0dGluZ3MsIHRydWUpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHJlc3VsdCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgbWVzc2FnZTogJ0luZGV4IHNldHRpbmdzIHVwZGF0ZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vcmVzZXQtc2V0dGluZ3MnKVxuICBhc3luYyByZXNldEluZGV4U2V0dGluZ3MoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5yZXNldEluZGV4U2V0dGluZ3MoKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdJbmRleCBzZXR0aW5ncyByZXNldCB0byBNZWlsaXNlYXJjaCBkZWZhdWx0cydcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vYXBwbHktZGVmYXVsdC1zZXR0aW5ncycpXG4gIGFzeW5jIGFwcGx5RGVmYXVsdFNldHRpbmdzKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIC8vIEdldCBzY2hlbWEtZGVyaXZlZCBzZXR0aW5nc1xuICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBjb25zdCBzY2hlbWFTZXR0aW5ncyA9IHNlYXJjaENvbmZpZy5zZXR0aW5ncyB8fCB7fTtcblxuICAgIC8vIEFwcGx5IHRoZSBzY2hlbWEtZGVyaXZlZCBzZXR0aW5nc1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UudXBkYXRlSW5kZXhTZXR0aW5ncyhzY2hlbWFTZXR0aW5ncywgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBhcHBsaWVkU2V0dGluZ3M6IHNjaGVtYVNldHRpbmdzLFxuICAgICAgbWVzc2FnZTogJ0luZGV4IHNldHRpbmdzIHN5bmNlZCBzdWNjZXNzZnVsbHkgZnJvbSBlbnRpdHkgc2NoZW1hJ1xuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9pbml0JylcbiAgYXN5bmMgaW5pdFNpbmdsZUVudGl0eUluZGV4KFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBpZiAoIWVudGl0eVNlcnZpY2UuaXNTZWFyY2hFbmFibGVkKCkpIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBtZXNzYWdlOiBgU2VhcmNoIGlzIG5vdCBlbmFibGVkIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWAsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5pbml0U2VhcmNoSW5kZXgoKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICBjb25maWcsXG4gICAgICBtZXNzYWdlOiBgSW5kZXggJHtjb25maWcuaW5kZXhOYW1lfSBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHlgLFxuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9yZWNyZWF0ZScpXG4gIGFzeW5jIHJlY3JlYXRlSW5kZXgoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7XG4gICAgICAgIHJlc3luY0RvY3VtZW50cz86IGJvb2xlYW47XG4gICAgICAgIHN5bmNNZXRob2Q/OiAnZGlyZWN0JyB8ICdxdWV1ZSc7XG4gICAgICAgIGJhdGNoU2l6ZT86IG51bWJlcjtcbiAgICAgICAgcXVldWVVcmw/OiBzdHJpbmc7XG4gICAgICB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcbiAgICBjb25zdCB7XG4gICAgICByZXN5bmNEb2N1bWVudHMgPSBmYWxzZSxcbiAgICAgIHN5bmNNZXRob2QgPSAnZGlyZWN0JyxcbiAgICAgIGJhdGNoU2l6ZSA9IDUwLFxuICAgICAgcXVldWVVcmxcbiAgICB9ID0gcmVxLmJvZHkgfHwge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3Qgb2xkQ29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oYFJlY3JlYXRpbmcgaW5kZXggZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCwgeyBvbGRDb25maWcgfSk7XG5cbiAgICAvLyBEZWxldGUgZXhpc3RpbmcgaW5kZXhcbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBEZWxldGluZyBleGlzdGluZyBpbmRleDogJHtvbGRDb25maWcuaW5kZXhOYW1lfWApO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmRlbGV0ZVNlYXJjaEluZGV4KHRydWUpO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oYENvdWxkIG5vdCBkZWxldGUgaW5kZXggKG1pZ2h0IG5vdCBleGlzdCk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG5cbiAgICAvLyBSZWluaXRpYWxpemUgaW5kZXggd2l0aCBuZXcgY29uZmlndXJhdGlvblxuICAgIHRoaXMubG9nZ2VyLmluZm8oYFJlaW5pdGlhbGl6aW5nIGluZGV4IGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuaW5pdFNlYXJjaEluZGV4KCk7XG4gICAgY29uc3QgbmV3Q29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuXG4gICAgbGV0IHJlc3luY1Jlc3VsdCA9IG51bGw7XG5cbiAgICAvLyBPcHRpb25hbGx5IHJlc3luYyBhbGwgZG9jdW1lbnRzXG4gICAgaWYgKHJlc3luY0RvY3VtZW50cykge1xuICAgICAgaWYgKHN5bmNNZXRob2QgPT09ICdxdWV1ZScpIHtcbiAgICAgICAgLy8gUXVldWUtYmFzZWQgc3luYyAobm9uLWJsb2NraW5nLCBmb3IgbGFyZ2UgZGF0YXNldHMpXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFF1ZXVlaW5nIGRvY3VtZW50cyBmb3IgcmVzeW5jOiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIHJlc3luY1Jlc3VsdCA9IGF3YWl0IHRoaXMucXVldWVEb2N1bWVudHNGb3JSZXN5bmMoZW50aXR5TmFtZSwgeyBiYXRjaFNpemUsIHF1ZXVlVXJsIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRGlyZWN0IHN5bmMgKGJsb2NraW5nLCBpbW1lZGlhdGUgY29uZmlybWF0aW9uKVxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBEaXJlY3RseSByZXN5bmNpbmcgZG9jdW1lbnRzOiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIHJlc3luY1Jlc3VsdCA9IGF3YWl0IHNlYXJjaFNlcnZpY2UucmVzeW5jQWxsRG9jdW1lbnRzKHsgYmF0Y2hTaXplIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIG9sZEluZGV4TmFtZTogb2xkQ29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG5ld0luZGV4TmFtZTogbmV3Q29uZmlnLmluZGV4TmFtZSxcbiAgICAgIHN5bmNNZXRob2Q6IHJlc3luY0RvY3VtZW50cyA/IHN5bmNNZXRob2QgOiBudWxsLFxuICAgICAgbWVzc2FnZTogYEluZGV4IHJlY3JlYXRlZCBzdWNjZXNzZnVsbHkke3Jlc3luY0RvY3VtZW50cyA/IGAgKCR7c3luY01ldGhvZH0gc3luYzogJHtyZXN5bmNSZXN1bHQ/LnByb2Nlc3NlZENvdW50IHx8IDB9IGRvY3VtZW50cylgIDogJyd9YCxcbiAgICAgIHJlc3luY1Jlc3VsdCxcbiAgICAgIGNvbmZpZ3M6IHsgb2xkQ29uZmlnLCBuZXdDb25maWcgfVxuICAgIH0pO1xuICB9XG5cbiAgQERlbGV0ZSgnL2luZGljZXMve2VudGl0eU5hbWV9JylcbiAgYXN5bmMgZGVsZXRlSW5kZXgoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5kZWxldGVTZWFyY2hJbmRleCh0cnVlKTtcbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBtZXNzYWdlOiAnSW5kZXggZGVsZXRlZCBzdWNjZXNzZnVsbHknXG4gICAgfSk7XG4gIH1cblxuICBARGVsZXRlKCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vZG9jdW1lbnRzJylcbiAgYXN5bmMgY2xlYXJFbnRpdHlJbmRleChcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgY29uZmlnID0gc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RW5naW5lKCkuZGVsZXRlQWxsRG9jdW1lbnRzKGNvbmZpZy5pbmRleE5hbWUhLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdBbGwgZG9jdW1lbnRzIGNsZWFyZWQgZnJvbSBpbmRleCdcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vcmVzeW5jJylcbiAgYXN5bmMgcmVzeW5jRW50aXR5UmVjb3JkcyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgYmF0Y2hTaXplPzogbnVtYmVyOyBxdWV1ZVVybD86IHN0cmluZzsgYnlCYXRjaD86IGJvb2xlYW4gfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG4gICAgY29uc3QgeyBiYXRjaFNpemUgPSA1MCwgcXVldWVVcmwsIGJ5QmF0Y2ggPSB0cnVlIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVldWVEb2N1bWVudHNGb3JSZXN5bmMoZW50aXR5TmFtZSwgeyBiYXRjaFNpemUsIHF1ZXVlVXJsLCBieUJhdGNoIH0pO1xuXG4gICAgbGV0IG1lc3NhZ2UgPSBgUXVldWVkICR7cmVzdWx0LnByb2Nlc3NlZENvdW50fSByZWNvcmRzIGZvciByZS1pbmRleGluZ2A7XG4gICAgaWYgKHJlc3VsdC5mYWlsZWRDb3VudCA+IDApIHtcbiAgICAgIG1lc3NhZ2UgKz0gYCwgJHtyZXN1bHQuZmFpbGVkQ291bnR9IHJlY29yZHMgZmFpbGVkIHRvIGJlIHF1ZXVlZGA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBzdWNjZXNzOiByZXN1bHQucHJvY2Vzc2VkQ291bnQgPiAwLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIC4uLnJlc3VsdCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZSBkb2N1bWVudHMgZm9yIGFzeW5jIHJlc3luYyB2aWEgU1FTXG4gICAqIFNoYXJlZCBsb2dpYyB1c2VkIGJ5IHJlc3luYyBhbmQgcmVjcmVhdGUgZW5kcG9pbnRzXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHF1ZXVlRG9jdW1lbnRzRm9yUmVzeW5jKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBvcHRpb25zOiB7IGJhdGNoU2l6ZT86IG51bWJlcjsgcXVldWVVcmw/OiBzdHJpbmc7IGJ5QmF0Y2g/OiBib29sZWFuIH1cbiAgKTogUHJvbWlzZTx7IHByb2Nlc3NlZENvdW50OiBudW1iZXI7IGZhaWxlZENvdW50OiBudW1iZXI7IHRvdGFsSXRlcmF0aW9uczogbnVtYmVyIH0+IHtcbiAgICBjb25zdCB7IGJhdGNoU2l6ZSA9IDUwLCBxdWV1ZVVybCwgYnlCYXRjaCA9IHRydWUgfSA9IG9wdGlvbnM7XG4gICAgY29uc3QgZW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIC8vIFVzZSBwcm92aWRlZCBxdWV1ZVVybCBvciByZXNvbHZlIGZyb20gZW52aXJvbm1lbnRcbiAgICBjb25zdCBxdWV1ZU5hbWUgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IFNFQVJDSF9DT05UUk9MTEVSX0VOVl9LRVlTLk1FSUxJU0VBUkNIX1NZTkNfUVVFVUVfTkFNRSB9KTtcbiAgICBjb25zdCByZXNvbHZlZFF1ZXVlVXJsID0gcXVldWVVcmwgfHwgRW52aXJvbm1lbnQucXVldWVVcmwocXVldWVOYW1lKTtcblxuICAgIGlmICghcmVzb2x2ZWRRdWV1ZVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBRdWV1ZSBVUkwgbm90IHByb3ZpZGVkIGZvciByZXN5bmNpbmcgcmVjb3JkcyBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX0gYW5kIGVudi1rZXkgWyR7U0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FfV0gaXMgbm90IGNvbmZpZ3VyZWRgKTtcbiAgICB9XG5cbiAgICBsZXQgZmFpbGVkQ291bnQgPSAwO1xuICAgIGxldCBwcm9jZXNzZWRDb3VudCA9IDA7XG4gICAgbGV0IGN1cnNvcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gJ2luaXQnO1xuICAgIGxldCBpdGVyYXRpb25Db3VudCA9IDA7XG4gICAgY29uc3QgbWF4SXRlcmF0aW9ucyA9IDEwMDAwMDtcblxuICAgIHdoaWxlICghIWN1cnNvciAmJiBpdGVyYXRpb25Db3VudCA8IG1heEl0ZXJhdGlvbnMpIHtcbiAgICAgIGl0ZXJhdGlvbkNvdW50Kys7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZldGNoaW5nICR7ZW50aXR5TmFtZX0gcmVjb3JkcyBmcm9tIGN1cnNvcjogJHtjdXJzb3J9YCk7XG5cbiAgICAgIGNvbnN0IHF1ZXJ5UmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5xdWVyeSh7XG4gICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICBsaW1pdDogYmF0Y2hTaXplLFxuICAgICAgICAgIGN1cnNvcjogY3Vyc29yID09PSAnaW5pdCcgPyB1bmRlZmluZWQgOiBjdXJzb3JcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGlmICghcXVlcnlSZXN1bHQuZGF0YT8ubGVuZ3RoKSBicmVhaztcblxuICAgICAgaWYgKGJ5QmF0Y2gpIHtcblxuICAgICAgICAvLyBRdWV1ZSBlbnRpcmUgYmF0Y2ggYXMgb25lIG1lc3NhZ2VcbiAgICAgICAgY29uc3QgeyBzdW1tYXJ5IH0gPSBhd2FpdCBCYXRjaFByb2dyZXNzLmFsbChgUXVldWUgJHtlbnRpdHlOYW1lfWAsIHF1ZXJ5UmVzdWx0LmRhdGEsIGFzeW5jIChyZWNvcmRzKSA9PiB7XG5cbiAgICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgQmF0Y2hQcm9ncmVzcy5tYXAoYFRyYW5zZm9ybSAke2VudGl0eU5hbWV9YCwgcmVjb3JkcywgYXN5bmMgKHJlYykgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGVudGl0eVNlcnZpY2UudHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZyhyZWMpO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgYXdhaXQgc2VuZFF1ZXVlTWVzc2FnZShyZXNvbHZlZFF1ZXVlVXJsLCB7IGRhdGEsIGV2ZW50TmFtZTogJ1JFU1lOQycsIGVudGl0eU5hbWUgfSk7XG5cbiAgICAgICAgICByZXR1cm4gZGF0YTtcblxuICAgICAgICB9LCB7IG9ic2VydmU6ICdlcnJvcnMnLCB0YWdzOiB7IGVudGl0eTogZW50aXR5TmFtZSB9IH0pO1xuXG4gICAgICAgIHByb2Nlc3NlZENvdW50ICs9IHN1bW1hcnkuc3VjY2VlZGVkO1xuICAgICAgICBmYWlsZWRDb3VudCArPSBzdW1tYXJ5LmZhaWxlZDtcblxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gUXVldWUgZWFjaCByZWNvcmQgaW5kaXZpZHVhbGx5XG4gICAgICAgIGNvbnN0IHsgc3VtbWFyeSB9ID0gYXdhaXQgQmF0Y2hQcm9ncmVzcy5wcm9jZXNzKGBRdWV1ZSAke2VudGl0eU5hbWV9YCwgcXVlcnlSZXN1bHQuZGF0YSwgYXN5bmMgKHJlYykgPT4ge1xuXG4gICAgICAgICAgY29uc3QgdHJhbnNmb3JtZWQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcocmVjKTtcblxuICAgICAgICAgIGF3YWl0IHNlbmRRdWV1ZU1lc3NhZ2UocmVzb2x2ZWRRdWV1ZVVybCwgeyBkYXRhOiB0cmFuc2Zvcm1lZCwgZXZlbnROYW1lOiAnUkVTWU5DJywgZW50aXR5TmFtZSB9KTtcblxuICAgICAgICAgIHJldHVybiB0cmFuc2Zvcm1lZDtcblxuICAgICAgICB9LCB7IGNvbmN1cnJlbmN5OiA1LCBvYnNlcnZlOiAnZXJyb3JzJywgdGFnczogeyBlbnRpdHk6IGVudGl0eU5hbWUgfSB9KTtcblxuICAgICAgICBwcm9jZXNzZWRDb3VudCArPSBzdW1tYXJ5LnN1Y2NlZWRlZDtcbiAgICAgICAgZmFpbGVkQ291bnQgKz0gc3VtbWFyeS5mYWlsZWQ7XG4gICAgICB9XG5cbiAgICAgIGN1cnNvciA9IHF1ZXJ5UmVzdWx0LmN1cnNvciA/PyB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIuaW5mbyhgUXVldWUgc3luYyBjb21wbGV0ZWQgZm9yICR7ZW50aXR5TmFtZX1gLCB7IHByb2Nlc3NlZENvdW50LCBmYWlsZWRDb3VudCwgaXRlcmF0aW9uczogaXRlcmF0aW9uQ291bnQgfSk7XG4gICAgcmV0dXJuIHsgcHJvY2Vzc2VkQ291bnQsIGZhaWxlZENvdW50LCB0b3RhbEl0ZXJhdGlvbnM6IGl0ZXJhdGlvbkNvdW50IH07XG4gIH1cblxuICBAR2V0KCcvcXVldWUtaW5mbycpXG4gIGFzeW5jIGdldFF1ZXVlSW5mbyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IHF1ZXVlVXJsOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBxdWV1ZVVybCB9ID0gcmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVycztcblxuICAgIC8vIFVzZSBwcm92aWRlZCBxdWV1ZVVybCBvciByZXNvbHZlIGZyb20gZW52aXJvbm1lbnRcbiAgICBjb25zdCBxdWV1ZU5hbWUgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IFNFQVJDSF9DT05UUk9MTEVSX0VOVl9LRVlTLk1FSUxJU0VBUkNIX1NZTkNfUVVFVUVfTkFNRSB9KTtcbiAgICBjb25zdCByZXNvbHZlZFF1ZXVlVXJsID0gcXVldWVVcmwgfHwgRW52aXJvbm1lbnQucXVldWVVcmwocXVldWVOYW1lKTtcblxuICAgIGNvbnN0IGluZm8gPSBhd2FpdCBnZXRRdWV1ZU1lc3NhZ2VNZXRhZGF0YShyZXNvbHZlZFF1ZXVlVXJsKTtcblxuICAgIHJldHVybiByZXMuanNvbih7IGluZm8gfSk7XG4gIH1cblxuICBAUHV0KCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0nLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZG9jdW1lbnRzOiB7IGRhdGF0eXBlOiAnYXJyYXknLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyB1cGRhdGVEb2N1bWVudHMoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IGRvY3VtZW50czogYW55W10gfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgeyBkb2N1bWVudHMgfSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2VhcmNoU2VydmljZS51cGRhdGVEb2N1bWVudHMoZG9jdW1lbnRzLCB0cnVlKTtcbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgcmVzdWx0LFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBtZXNzYWdlOiAnRG9jdW1lbnRzIHVwZGF0ZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICB9KTtcbiAgfVxuXG4gIEBEZWxldGUoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfS9ieS1pZHMnLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgaWRzOiB7IGRhdGF0eXBlOiAnYXJyYXknLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyBkZWxldGVEb2N1bWVudHNCeUlkcyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgaWRzOiBzdHJpbmdbXSB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCB7IGlkcyB9ID0gcmVxLmJvZHk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5nZXRFbmdpbmUoKS5kZWxldGVEb2N1bWVudHMoaWRzLCBjb25maWcuaW5kZXhOYW1lISwgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICBtZXNzYWdlOiAnRG9jdW1lbnRzIGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5J1xuICAgIH0pO1xuICB9XG5cbiAgQERlbGV0ZSgnL3JlY29yZHMve2VudGl0eU5hbWV9L2J5LWZpbHRlcicsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBmaWx0ZXI6IHsgZGF0YXR5cGU6ICdvYmplY3QnLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyBkZWxldGVEb2N1bWVudHNCeUZpbHRlcihcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgZmlsdGVyOiBhbnkgfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgeyBmaWx0ZXIgfSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5kZWxldGVEb2N1bWVudHNCeUZpbHRlcihmaWx0ZXIsIHRydWUpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgbWVzc2FnZTogJ0RvY3VtZW50cyBtYXRjaGluZyBmaWx0ZXIgaGF2ZSBiZWVuIHF1ZXVlZCBmb3IgZGVsZXRpb24uJ1xuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3QgcHJvdmlkZXIgPSB0aGlzLmNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlLFxuICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgIH0pO1xuXG4gICAgaWYgKHByb3ZpZGVyLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBwcm92aWRlciBmb3VuZCBmb3IgZW50aXR5LXNlcnZpY2UgZm9yICR7ZW50aXR5TmFtZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvdmlkZXJbIDAgXS5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4ocHJvdmlkZXJbIDAgXS5fcHJvdmlkZXIucHJvdmlkZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSBlbnRpdHlTZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKTtcblxuICAgIGlmICghc2VhcmNoU2VydmljZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggc2VydmljZSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlYXJjaFNlcnZpY2U7XG4gIH1cbn0iXX0=