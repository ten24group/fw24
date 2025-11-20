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
        const autoGeneratedSettings = searchConfig.settings || {};
        // Calculate deep diff
        const { diff, hasDifferences } = this.calculateSettingsDiff(currentSettings, autoGeneratedSettings);
        return res.json({
            settings: currentSettings,
            autoGeneratedSettings,
            diff,
            hasDifferences,
            recommendation: hasDifferences
                ? '⚠️ Configuration drift detected. Consider updating settings to match auto-generated configuration.'
                : '✓ Current settings match auto-generated configuration.',
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
     * Calculate deep diff between current and auto-generated settings
     * Dynamically compares all fields regardless of type
     */
    calculateSettingsDiff(current, autoGenerated) {
        const diff = {};
        let hasDifferences = false;
        // Get all unique keys from both objects
        const allKeys = new Set([
            ...Object.keys(current || {}),
            ...Object.keys(autoGenerated || {})
        ]);
        for (const field of allKeys) {
            const currentValue = current[field];
            const autoGeneratedValue = autoGenerated[field];
            // Determine field type and compare accordingly
            if (Array.isArray(currentValue) || Array.isArray(autoGeneratedValue)) {
                // Array comparison
                const currArr = Array.isArray(currentValue) ? currentValue : [];
                const autoArr = Array.isArray(autoGeneratedValue) ? autoGeneratedValue : [];
                // Use deep normalized comparison for array items
                const currNormalizedSet = new Set(currArr.map((item) => this.deepNormalize(item)));
                const autoNormalizedSet = new Set(autoArr.map((item) => this.deepNormalize(item)));
                const added = autoArr.filter((item) => !currNormalizedSet.has(this.deepNormalize(item)));
                const removed = currArr.filter((item) => !autoNormalizedSet.has(this.deepNormalize(item)));
                const unchanged = currArr.filter((item) => autoNormalizedSet.has(this.deepNormalize(item)));
                const isDifferent = added.length > 0 || removed.length > 0;
                if (isDifferent)
                    hasDifferences = true;
                diff[field] = {
                    type: 'array',
                    current: currArr,
                    autoGenerated: autoArr,
                    added,
                    removed,
                    unchanged,
                    status: isDifferent ? 'different' : 'same'
                };
            }
            else if ((currentValue !== null && typeof currentValue === 'object') ||
                (autoGeneratedValue !== null && typeof autoGeneratedValue === 'object')) {
                // Object comparison using deep normalization
                const currentNormalized = this.deepNormalize(currentValue);
                const autoGeneratedNormalized = this.deepNormalize(autoGeneratedValue);
                const isDifferent = currentNormalized !== autoGeneratedNormalized;
                if (isDifferent)
                    hasDifferences = true;
                diff[field] = {
                    type: 'object',
                    current: currentValue,
                    autoGenerated: autoGeneratedValue,
                    status: isDifferent ? 'different' : 'same'
                };
            }
            else {
                // Scalar comparison (string, number, boolean, null, undefined)
                const isDifferent = currentValue !== autoGeneratedValue;
                if (isDifferent)
                    hasDifferences = true;
                diff[field] = {
                    type: 'scalar',
                    current: currentValue,
                    autoGenerated: autoGeneratedValue,
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
        // Get auto-generated settings from entity schema
        const searchConfig = searchService.getSearchIndexConfig();
        const autoGeneratedSettings = searchConfig.settings || {};
        // Apply the auto-generated settings
        await searchService.updateIndexSettings(autoGeneratedSettings, true);
        return res.json({
            success: true,
            entityName,
            appliedSettings: autoGeneratedSettings,
            message: 'Default settings applied successfully from entity schema'
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9zZWFyY2gtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFFQSwwQ0FBNkU7QUFDN0Usc0ZBQTBFO0FBRTFFLGlEQUFzRTtBQUN0RSxpQ0FBMkM7QUFHM0MsdUNBQTJEO0FBQzNELGtEQUFtRDtBQUNuRCx5Q0FBMkM7QUFFM0MsSUFBWSwwQkFFWDtBQUZELFdBQVksMEJBQTBCO0lBQ3BDLHlGQUEyRCxDQUFBO0FBQzdELENBQUMsRUFGVywwQkFBMEIsMENBQTFCLDBCQUEwQixRQUVyQztBQU9NLElBQU0sc0JBQXNCLEdBQTVCLE1BQU0sc0JBQXVCLFNBQVEsc0NBQWE7SUFDZDtJQUF6QyxZQUF5QyxTQUF1QjtRQUM5RCxLQUFLLEVBQUUsQ0FBQztRQUQrQixjQUFTLEdBQVQsU0FBUyxDQUFjO0lBRWhFLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQTRCLEVBQUUsUUFBaUIsSUFBSSxDQUFDO0lBRy9ELEFBQU4sS0FBSyxDQUFDLFdBQVcsQ0FBQyxRQUFpQixFQUFFLFFBQWtCO1FBQ3JELDZDQUE2QztRQUM3QyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDO1lBQzdELElBQUksRUFBRSxTQUFTO1lBQ2YsK0JBQStCLEVBQUUsSUFBSTtTQUN0QyxDQUFDO2FBQ0MsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFO1lBQ1YsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUE7UUFDaEMsQ0FBQyxDQUFDLENBQUM7UUFFTCxNQUFNLFdBQVcsR0FBVSxFQUFFLENBQUM7UUFFOUIsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLFFBQVEsRUFBRSxFQUFFO1lB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QSxtQkFBTSxFQUFDLGlDQUFpQyxFQUFFO1FBQ3pDLFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRTtnQkFDSixNQUFNLEVBQUUsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUU7YUFDL0M7U0FDRjtLQUNGLENBQUM7cUVBcUJEO2lDQTkzQlUsc0JBQXNCO0lBTGxDLElBQUEsdUJBQVUsRUFBQyxlQUFlLEVBQUU7UUFDM0IsR0FBRyxFQUFFLENBQUU7Z0JBQ0wsSUFBSSxFQUFFLDBCQUEwQixDQUFDLDJCQUEyQjthQUM3RCxDQUFFO0tBQ0osQ0FBQztJQUVhLFdBQUEsSUFBQSxvQkFBZSxHQUFFLENBQUE7R0FEbkIsc0JBQXNCLENBdzVCbEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcblxuaW1wb3J0IHsgZ2V0UXVldWVNZXNzYWdlTWV0YWRhdGEsIHNlbmRRdWV1ZU1lc3NhZ2UgfSBmcm9tIFwiLi4vLi4vY2xpZW50L3Nxc1wiO1xuaW1wb3J0IHsgQVBJQ29udHJvbGxlciB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9hcGktZ2F0ZXdheS1jb250cm9sbGVyJztcbmltcG9ydCB0eXBlIHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gXCIuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBDb250cm9sbGVyLCBEZWxldGUsIEdldCwgUG9zdCwgUHV0IH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycyc7XG5pbXBvcnQgeyBJbmplY3RDb250YWluZXIgfSBmcm9tICcuLi8uLi9kaSc7XG5pbXBvcnQgeyB0eXBlIEJhc2VFbnRpdHlTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vZW50aXR5JztcbmltcG9ydCB7IHR5cGUgSURJQ29udGFpbmVyLCB0eXBlIFJlcXVlc3QsIHR5cGUgUmVzcG9uc2UgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IGRlZXBDb3B5LCByZXNvbHZlRW52VmFsdWVGb3IgfSBmcm9tICcuLi8uLi91dGlscyc7XG5pbXBvcnQgeyBwYXJzZVNlYXJjaFF1ZXJ5IH0gZnJvbSBcIi4uL3NlYXJjaC11dGlsc1wiO1xuaW1wb3J0IHsgRW52aXJvbm1lbnQgfSBmcm9tIFwiLi4vLi4vY2xpZW50XCI7XG5cbmV4cG9ydCBlbnVtIFNFQVJDSF9DT05UUk9MTEVSX0VOVl9LRVlTIHtcbiAgTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FID0gJ01FSUxJU0VBUkNIX1NZTkNfUVVFVUVfTkFNRScsXG59XG5cbkBDb250cm9sbGVyKCdzeXN0ZW0vc2VhcmNoJywge1xuICBlbnY6IFsge1xuICAgIG5hbWU6IFNFQVJDSF9DT05UUk9MTEVSX0VOVl9LRVlTLk1FSUxJU0VBUkNIX1NZTkNfUVVFVUVfTkFNRSxcbiAgfSBdLFxufSlcbmV4cG9ydCBjbGFzcyBTZWFyY2hTeXN0ZW1Db250cm9sbGVyIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG4gIGNvbnN0cnVjdG9yKEBJbmplY3RDb250YWluZXIoKSBwcm90ZWN0ZWQgY29udGFpbmVyOiBJRElDb250YWluZXIpIHtcbiAgICBzdXBlcigpO1xuICB9XG5cbiAgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBfY29udGV4dDogQ29udGV4dCkgeyB9XG5cbiAgQEdldCgnL2luZGljZXMnKVxuICBhc3luYyBsaXN0SW5kaWNlcyhfcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlKSB7XG4gICAgLy8gQXV0by1kaXNjb3ZlciBlbnRpdGllcyB3aXRoIHNlYXJjaCBlbmFibGVkXG4gICAgY29uc3QgZW50aXR5UHJvdmlkZXJzID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICB9KVxuICAgICAgLmZpbHRlcihwID0+IHtcbiAgICAgICAgcmV0dXJuICEhcC5fcHJvdmlkZXIuZm9yRW50aXR5XG4gICAgICB9KTtcblxuICAgIGNvbnN0IGluZGljZXNEYXRhOiBhbnlbXSA9IFtdO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZW50aXR5UHJvdmlkZXJzLm1hcChhc3luYyAocHJvdmlkZXIpID0+IHtcblxuICAgICAgY29uc3QgZW50aXR5TmFtZSA9IHByb3ZpZGVyLl9wcm92aWRlci5mb3JFbnRpdHkgYXMgc3RyaW5nO1xuXG4gICAgICB0cnkge1xuXG4gICAgICAgIC8vIHVzZSBwcm92aWRlcidzIGNvbnRhaW5lciAgdG8gcmVzb2x2ZSB0aGUgc2VydmljZVxuICAgICAgICBjb25zdCBzZXJ2aWNlID0gcHJvdmlkZXIuX2NvbnRhaW5lci5yZXNvbHZlPEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KFxuICAgICAgICAgIHByb3ZpZGVyLl9wcm92aWRlci5wcm92aWRlXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKCFzZXJ2aWNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZXJ2aWNlICR7U3RyaW5nKHByb3ZpZGVyLl9wcm92aWRlci5wcm92aWRlKX0gbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXNlYXJjaFNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGluZGV4SW5mbyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0SW5kZXhJbmZvKCk7XG5cbiAgICAgICAgaW5kaWNlc0RhdGEucHVzaCh7XG4gICAgICAgICAgLi4uaW5kZXhJbmZvLFxuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgaW5kZXhOYW1lOiBpbmRleEluZm8udWlkLFxuICAgICAgICB9KTtcblxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuXG4gICAgICAgIGluZGljZXNEYXRhLnB1c2goe1xuICAgICAgICAgIGluZGV4TmFtZTogYFske2VudGl0eU5hbWV9XS1pbmRleC1uYW1lLW5vdC1yZXNvbHZlZGAsXG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoZXJyb3IpO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIHJldHVybiByZXNwb25zZS5qc29uKHsgaW5kaWNlczogaW5kaWNlc0RhdGEgfSk7XG4gIH1cblxuICAvKipcbiAgICogQWRkIG5ldyBhcGkgdG8gZ2V0IGluZGV4IGRldGFpbHNcbiAgICogXG4gICAqL1xuXG4gIEBHZXQoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfScsIHt9KVxuICBhc3luYyBnZXRJbmRleERldGFpbHMoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IGluZGV4SW5mbyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0SW5kZXhJbmZvKCk7XG4gICAgY29uc3QgaW5kZXhTdGF0cyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0SW5kZXhTdGF0cygpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIGRldGFpbHM6IHtcbiAgICAgICAgaW5kZXhJbmZvLFxuICAgICAgICBpbmRleFN0YXRzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgQEdldCgnL2VudGl0aWVzJylcbiAgYXN5bmMgZ2V0U2VhcmNoRW50aXRpZXMoX3JlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IGVudGl0eVByb3ZpZGVycyA9IHRoaXMuY29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWUsXG4gICAgfSlcbiAgICAgIC5maWx0ZXIocCA9PiAhIXAuX3Byb3ZpZGVyLmZvckVudGl0eSk7XG5cbiAgICBjb25zdCBlbnRpdGllc0RhdGE6IHtcbiAgICAgIGVudGl0eU5hbWU6IHN0cmluZztcbiAgICAgIHNlYXJjaEVuYWJsZWQ6IGJvb2xlYW47XG4gICAgICBpbmRleEV4aXN0cz86IGJvb2xlYW47XG4gICAgICBpbmRleE5hbWU/OiBzdHJpbmc7XG4gICAgICBlcnJvcj86IHN0cmluZztcbiAgICB9W10gPSBbXTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKGVudGl0eVByb3ZpZGVycy5tYXAoYXN5bmMgKHByb3ZpZGVyKSA9PiB7XG4gICAgICBjb25zdCBlbnRpdHlOYW1lID0gcHJvdmlkZXIuX3Byb3ZpZGVyLmZvckVudGl0eSBhcyBzdHJpbmc7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNlcnZpY2UgPSBwcm92aWRlci5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oXG4gICAgICAgICAgcHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGVcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAoIXNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoRW5hYmxlZCA9IHNlcnZpY2UuaXNTZWFyY2hFbmFibGVkKCk7XG4gICAgICAgIGxldCBpbmRleEV4aXN0cyA9IGZhbHNlO1xuICAgICAgICBsZXQgaW5kZXhOYW1lID0gJyc7XG5cbiAgICAgICAgaWYgKHNlYXJjaEVuYWJsZWQpIHtcbiAgICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gc2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgICAgaWYgKHNlYXJjaFNlcnZpY2UpIHtcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICAgICAgICAgIGluZGV4TmFtZSA9IGNvbmZpZy5pbmRleE5hbWUhO1xuICAgICAgICAgICAgaW5kZXhFeGlzdHMgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpLmluZGV4RXhpc3RzKGluZGV4TmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZW50aXRpZXNEYXRhLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgc2VhcmNoRW5hYmxlZCxcbiAgICAgICAgICBpbmRleEV4aXN0cyxcbiAgICAgICAgICBpbmRleE5hbWUsXG4gICAgICAgIH0pO1xuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIGVudGl0aWVzRGF0YS5wdXNoKHtcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIHNlYXJjaEVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KSk7XG5cbiAgICByZXR1cm4gcmVzcG9uc2UuanNvbih7IGVudGl0aWVzOiBlbnRpdGllc0RhdGEgfSk7XG4gIH1cblxuICBAR2V0KCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0ve2RvY3VtZW50SWR9JylcbiAgYXN5bmMgZ2V0U2luZ2xlRG9jdW1lbnQoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcsIGRvY3VtZW50SWQ6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBkb2N1bWVudElkIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgZW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHByaW1hcnlJZEZpZWxkTmFtZSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG4gICAgXG4gICAgY29uc3QgZG9jID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXREb2N1bWVudChkb2N1bWVudElkKTtcblxuICAgIGRvY1sgJ2lkJyBdID0gZG9jWyAnaWQnIF0gfHwgZG9jWyBwcmltYXJ5SWRGaWVsZE5hbWUgYXMgc3RyaW5nIF07XG4gICAgZG9jWyAnZnVsbFJlY29yZCcgXSA9IHsgLi4uZG9jIH07XG4gICAgZG9jWyAnZW50aXR5TmFtZScgXSA9IGVudGl0eU5hbWU7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oZG9jKTtcbiAgfVxuXG4gIEBHZXQoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfScpXG4gIGFzeW5jIGdldEVudGl0eVJlY29yZHMoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZSxcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0XG4gICkge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHF1ZXJ5ID0gZGVlcENvcHkocmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyk7XG5cbiAgICBjb25zdCBwYXJzZWRRdWVyeSA9IHBhcnNlU2VhcmNoUXVlcnkocXVlcnkpO1xuICAgIGNvbnN0IHsgc2VsZWN0OiBfc2VsZWN0LCAuLi5yZXN0UXVlcnlQYXJhbXMgfSA9IHBhcnNlZFF1ZXJ5O1xuXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IGVudGl0eVNlcnZpY2Uuc2VhcmNoKHJlc3RRdWVyeVBhcmFtcywgY3R4KTtcblxuICAgIGNvbnN0IHsgaGl0cywgLi4ucmVzdCB9ID0gcmVzdWx0cztcbiAgICBcbiAgICAvLyBHZXQgdGhlIGVudGl0eSdzIHByaW1hcnkgaWRlbnRpZmllciBmaWVsZCBuYW1lXG4gICAgY29uc3QgcHJpbWFyeUlkRmllbGROYW1lID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcbiAgICBcbiAgICAvLyBFbnN1cmUgYWxsIHJlY29yZHMgaGF2ZSBhIGNvbnNpc3RlbnQgJ2lkJyBmaWVsZCBmb3IgZ2VuZXJpYyBVSSBsaXN0aW5nXG4gICAgY29uc3Qgbm9ybWFsaXplZEhpdHMgPSBoaXRzLm1hcCgoaGl0OiBhbnkpID0+IHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRIaXQgPSB7IC4uLmhpdCB9O1xuXG4gICAgICBub3JtYWxpemVkSGl0WyAnZW50aXR5TmFtZScgXSA9IGVudGl0eU5hbWU7XG4gICAgICBub3JtYWxpemVkSGl0WyAnZnVsbFJlY29yZCcgXSA9IGhpdDtcbiAgICAgIFxuICAgICAgLy8gSWYgdGhlIHJlY29yZCBkb2Vzbid0IGhhdmUgYW4gJ2lkJyBmaWVsZCBidXQgaGFzIHRoZSBwcmltYXJ5IGlkZW50aWZpZXIgZmllbGQsXG4gICAgICAvLyBtYXAgaXQgdG8gJ2lkJyBmb3IgY29uc2lzdGVudCBnZW5lcmljIGxpc3RpbmdcbiAgICAgIGlmICghbm9ybWFsaXplZEhpdC5pZCAmJiBwcmltYXJ5SWRGaWVsZE5hbWUgJiYgbm9ybWFsaXplZEhpdFsgcHJpbWFyeUlkRmllbGROYW1lIF0pIHtcbiAgICAgICAgbm9ybWFsaXplZEhpdC5pZCA9IG5vcm1hbGl6ZWRIaXRbIHByaW1hcnlJZEZpZWxkTmFtZSBdO1xuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBJZiBzdGlsbCBubyBpZCBmaWVsZCwgdHJ5IGNvbW1vbiBpZGVudGlmaWVyIHBhdHRlcm5zXG4gICAgICBpZiAoIW5vcm1hbGl6ZWRIaXQuaWQpIHtcbiAgICAgICAgY29uc3QgaWRGaWVsZHMgPSBbIGAke2VudGl0eU5hbWV9SWRgLCBgJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9SWRgIF07XG4gICAgICAgIGZvciAoY29uc3QgaWRGaWVsZCBvZiBpZEZpZWxkcykge1xuICAgICAgICAgIGlmIChub3JtYWxpemVkSGl0WyBpZEZpZWxkIF0pIHtcbiAgICAgICAgICAgIG5vcm1hbGl6ZWRIaXQuaWQgPSBub3JtYWxpemVkSGl0WyBpZEZpZWxkIF07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIFxuICAgICAgcmV0dXJuIG5vcm1hbGl6ZWRIaXQ7XG4gICAgfSk7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IHtcbiAgICAgIC4uLnJlc3QsXG4gICAgICBpdGVtczogbm9ybWFsaXplZEhpdHMsXG4gICAgfTtcblxuICAgIGlmIChyZXEuZGVidWdNb2RlKSB7XG4gICAgICBPYmplY3QuYXNzaWduKHJlc3BvbnNlLCB7XG4gICAgICAgIGlucHV0UXVlcnk6IHF1ZXJ5LFxuICAgICAgICBwcm9jZXNzaW5nVGltZU1zOiByZXN1bHRzLnByb2Nlc3NpbmdUaW1lTXMsXG4gICAgICAgIHByaW1hcnlJZEZpZWxkTmFtZVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcy5qc29uKHJlc3BvbnNlKTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5pdEluZGljZXMnKVxuICBhc3luYyBpbml0U2VhcmNoSW5kaWNlcyhcbiAgICByZXE6IFJlcXVlc3Q8eyBib2R5OiB7IGVudGl0aWVzPzogc3RyaW5nW10gfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBlbnRpdGllczogcmVxdWVzdGVkRW50aXRpZXMgPSBbXSB9ID0gcmVxLmJvZHkgfHwge307XG5cbiAgICAvLyBjb2xsZWN0IHByb3ZpZGVyIGZvciBlbnRpdHktc2VydmljZXMgZnJvbSBjb250YWluZXItaGllcmFyY2h5XG4gICAgY29uc3QgZW50aXR5UHJvdmlkZXJzID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICB9KVxuICAgICAgLmZpbHRlcihwID0+IChcbiAgICAgICAgLy8gZmlsdGVyIG91dCBwcm92aWRlcnMgdGhhdCBkbyBub3QgaGF2ZSBhIGZvckVudGl0eSBwcm9wZXJ0eVxuICAgICAgICAhIXAuX3Byb3ZpZGVyLmZvckVudGl0eVxuICAgICAgICAmJiAoXG4gICAgICAgICAgLy8gaWYgbm8gZW50aXRpZXMgYXJlIHJlcXVlc3RlZCwgaW5jbHVkZSBhbGwgZW50aXRpZXNcbiAgICAgICAgICAhcmVxdWVzdGVkRW50aXRpZXM/Lmxlbmd0aFxuICAgICAgICAgIC8vIGlmIGVudGl0aWVzIGFyZSByZXF1ZXN0ZWQsIGluY2x1ZGUgb25seSB0aGUgcmVxdWVzdGVkIGVudGl0aWVzXG4gICAgICAgICAgfHwgcmVxdWVzdGVkRW50aXRpZXMuaW5jbHVkZXMocC5fcHJvdmlkZXIuZm9yRW50aXR5IGFzIHN0cmluZylcbiAgICAgICAgKVxuICAgICAgKSk7XG5cbiAgICBjb25zdCByZXN1bHRzOiB7XG4gICAgICBlcnJvcj86IHN0cmluZztcbiAgICAgIHN1Y2Nlc3M6IGJvb2xlYW47XG4gICAgICBtZXNzYWdlPzogc3RyaW5nO1xuXG4gICAgICBlbnRpdHlOYW1lOiBzdHJpbmc7XG4gICAgICBpbmRleE5hbWU/OiBzdHJpbmc7XG4gICAgICBpbmRleENvbmZpZz86IGFueTtcbiAgICB9W10gPSBbXTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKGVudGl0eVByb3ZpZGVycy5tYXAoYXN5bmMgKHByb3ZpZGVyKSA9PiB7XG4gICAgICBjb25zdCBlbnRpdHlOYW1lID0gcHJvdmlkZXIuX3Byb3ZpZGVyLmZvckVudGl0eSBhcyBzdHJpbmc7XG5cbiAgICAgIHRyeSB7XG5cbiAgICAgICAgY29uc3Qgc2VydmljZSA9IHByb3ZpZGVyLl9jb250YWluZXIucmVzb2x2ZTxCYXNlRW50aXR5U2VydmljZTxhbnk+PihcbiAgICAgICAgICBwcm92aWRlci5fcHJvdmlkZXIucHJvdmlkZVxuICAgICAgICApO1xuICAgICAgICBpZiAoIXNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEVudGl0eVNlcnZpY2UgY291bGQgbm90IGJlIHJlc29sdmVkIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgc2VhcmNoIGlzIGVuYWJsZWQgYmVmb3JlIGF0dGVtcHRpbmcgdG8gaW5pdGlhbGl6ZVxuICAgICAgICBpZiAoIXNlcnZpY2UuaXNTZWFyY2hFbmFibGVkKCkpIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgbWVzc2FnZTogYFNlYXJjaCBpcyBub3QgZW5hYmxlZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSBzZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgaWYgKCFzZWFyY2hTZXJ2aWNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggc2VydmljZSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmluaXRTZWFyY2hJbmRleCgpO1xuICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG5cbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgICAgICBpbmRleENvbmZpZzogY29uZmlnLFxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgbWVzc2FnZTogYEluZGV4ICR7Y29uZmlnLmluZGV4TmFtZX0gaW5pdGlhbGl6ZWQgc3VjY2Vzc2Z1bGx5YCxcbiAgICAgICAgfSk7XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIGVycm9yOiBlcnJvcixcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBtZXNzYWdlOiBgRXJyb3IgaW5pdGlhbGl6aW5nIGluZGV4IGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfTogJHtlcnJvci5tZXNzYWdlfWAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIHJldHVybiByZXMuanNvbih7IHJlc3VsdHMgfSk7XG4gIH1cblxuICBAR2V0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vc2V0dGluZ3MnKVxuICBhc3luYyBnZXRJbmRleFNldHRpbmdzKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIFxuICAgIC8vIEdldCBjdXJyZW50IHNldHRpbmdzIGZyb20gdGhlIHNlYXJjaCBlbmdpbmVcbiAgICBjb25zdCBjdXJyZW50U2V0dGluZ3MgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEluZGV4U2V0dGluZ3MoKTtcblxuICAgIC8vIEdldCBhdXRvLWdlbmVyYXRlZCBzZXR0aW5ncyBmcm9tIGVudGl0eSBzY2hlbWFcbiAgICBjb25zdCBzZWFyY2hDb25maWcgPSBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgY29uc3QgYXV0b0dlbmVyYXRlZFNldHRpbmdzID0gc2VhcmNoQ29uZmlnLnNldHRpbmdzIHx8IHt9O1xuXG4gICAgLy8gQ2FsY3VsYXRlIGRlZXAgZGlmZlxuICAgIGNvbnN0IHsgZGlmZiwgaGFzRGlmZmVyZW5jZXMgfSA9IHRoaXMuY2FsY3VsYXRlU2V0dGluZ3NEaWZmKGN1cnJlbnRTZXR0aW5ncywgYXV0b0dlbmVyYXRlZFNldHRpbmdzKTtcblxuICAgIHJldHVybiByZXMuanNvbih7IFxuICAgICAgc2V0dGluZ3M6IGN1cnJlbnRTZXR0aW5ncyxcbiAgICAgIGF1dG9HZW5lcmF0ZWRTZXR0aW5ncyxcbiAgICAgIGRpZmYsXG4gICAgICBoYXNEaWZmZXJlbmNlcyxcbiAgICAgIHJlY29tbWVuZGF0aW9uOiBoYXNEaWZmZXJlbmNlc1xuICAgICAgICA/ICfimqDvuI8gQ29uZmlndXJhdGlvbiBkcmlmdCBkZXRlY3RlZC4gQ29uc2lkZXIgdXBkYXRpbmcgc2V0dGluZ3MgdG8gbWF0Y2ggYXV0by1nZW5lcmF0ZWQgY29uZmlndXJhdGlvbi4nXG4gICAgICAgIDogJ+KckyBDdXJyZW50IHNldHRpbmdzIG1hdGNoIGF1dG8tZ2VuZXJhdGVkIGNvbmZpZ3VyYXRpb24uJyxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWVwIG5vcm1hbGl6ZSBhbnkgdmFsdWUgZm9yIGNvbnNpc3RlbnQgY29tcGFyaXNvblxuICAgKiBSZWN1cnNpdmVseSBzb3J0cyBvYmplY3Qga2V5cyBhbmQgaGFuZGxlcyBhcnJheXMvcHJpbWl0aXZlc1xuICAgKi9cbiAgcHJpdmF0ZSBkZWVwTm9ybWFsaXplKHZhbHVlOiBhbnkpOiBzdHJpbmcge1xuICAgIC8vIEhhbmRsZSBwcmltaXRpdmVzIGFuZCBudWxsL3VuZGVmaW5lZFxuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSk7XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIGFycmF5cyAtIHJlY3Vyc2l2ZWx5IG5vcm1hbGl6ZSBlYWNoIGl0ZW1cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIC8vIFBhcnNlIGJhY2sgZWFjaCBub3JtYWxpemVkIHN0cmluZyB0byBhdm9pZCBkb3VibGUgc3RyaW5naWZpY2F0aW9uXG4gICAgICBjb25zdCBub3JtYWxpemVkQXJyYXkgPSB2YWx1ZS5tYXAoaXRlbSA9PiBKU09OLnBhcnNlKHRoaXMuZGVlcE5vcm1hbGl6ZShpdGVtKSkpO1xuICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KG5vcm1hbGl6ZWRBcnJheSk7XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIG9iamVjdHMgLSBzb3J0IGtleXMgYW5kIHJlY3Vyc2l2ZWx5IG5vcm1hbGl6ZSB2YWx1ZXNcbiAgICBjb25zdCBzb3J0ZWRLZXlzID0gT2JqZWN0LmtleXModmFsdWUpLnNvcnQoKTtcbiAgICBjb25zdCBub3JtYWxpemVkT2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgXG4gICAgZm9yIChjb25zdCBrZXkgb2Ygc29ydGVkS2V5cykge1xuICAgICAgLy8gUGFyc2UgYmFjayB0aGUgbm9ybWFsaXplZCBzdHJpbmcgZm9yIG5lc3RlZCBzdHJ1Y3R1cmVzXG4gICAgICB0cnkge1xuICAgICAgICBub3JtYWxpemVkT2JqW2tleV0gPSBKU09OLnBhcnNlKHRoaXMuZGVlcE5vcm1hbGl6ZSh2YWx1ZVtrZXldKSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgbm9ybWFsaXplZE9ialtrZXldID0gdmFsdWVba2V5XTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZE9iaik7XG4gIH1cblxuICAvKipcbiAgICogQ2FsY3VsYXRlIGRlZXAgZGlmZiBiZXR3ZWVuIGN1cnJlbnQgYW5kIGF1dG8tZ2VuZXJhdGVkIHNldHRpbmdzXG4gICAqIER5bmFtaWNhbGx5IGNvbXBhcmVzIGFsbCBmaWVsZHMgcmVnYXJkbGVzcyBvZiB0eXBlXG4gICAqL1xuICBwcml2YXRlIGNhbGN1bGF0ZVNldHRpbmdzRGlmZihjdXJyZW50OiBSZWNvcmQ8c3RyaW5nLCBhbnk+LCBhdXRvR2VuZXJhdGVkOiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSB7XG4gICAgY29uc3QgZGlmZjogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIGxldCBoYXNEaWZmZXJlbmNlcyA9IGZhbHNlO1xuXG4gICAgLy8gR2V0IGFsbCB1bmlxdWUga2V5cyBmcm9tIGJvdGggb2JqZWN0c1xuICAgIGNvbnN0IGFsbEtleXMgPSBuZXcgU2V0KFtcbiAgICAgIC4uLk9iamVjdC5rZXlzKGN1cnJlbnQgfHwge30pLFxuICAgICAgLi4uT2JqZWN0LmtleXMoYXV0b0dlbmVyYXRlZCB8fCB7fSlcbiAgICBdKTtcblxuICAgIGZvciAoY29uc3QgZmllbGQgb2YgYWxsS2V5cykge1xuICAgICAgY29uc3QgY3VycmVudFZhbHVlID0gY3VycmVudFtmaWVsZF07XG4gICAgICBjb25zdCBhdXRvR2VuZXJhdGVkVmFsdWUgPSBhdXRvR2VuZXJhdGVkW2ZpZWxkXTtcblxuICAgICAgLy8gRGV0ZXJtaW5lIGZpZWxkIHR5cGUgYW5kIGNvbXBhcmUgYWNjb3JkaW5nbHlcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGN1cnJlbnRWYWx1ZSkgfHwgQXJyYXkuaXNBcnJheShhdXRvR2VuZXJhdGVkVmFsdWUpKSB7XG4gICAgICAgIC8vIEFycmF5IGNvbXBhcmlzb25cbiAgICAgICAgY29uc3QgY3VyckFyciA9IEFycmF5LmlzQXJyYXkoY3VycmVudFZhbHVlKSA/IGN1cnJlbnRWYWx1ZSA6IFtdO1xuICAgICAgICBjb25zdCBhdXRvQXJyID0gQXJyYXkuaXNBcnJheShhdXRvR2VuZXJhdGVkVmFsdWUpID8gYXV0b0dlbmVyYXRlZFZhbHVlIDogW107XG5cbiAgICAgICAgLy8gVXNlIGRlZXAgbm9ybWFsaXplZCBjb21wYXJpc29uIGZvciBhcnJheSBpdGVtc1xuICAgICAgICBjb25zdCBjdXJyTm9ybWFsaXplZFNldCA9IG5ldyBTZXQoY3VyckFyci5tYXAoKGl0ZW06IGFueSkgPT4gdGhpcy5kZWVwTm9ybWFsaXplKGl0ZW0pKSk7XG4gICAgICAgIGNvbnN0IGF1dG9Ob3JtYWxpemVkU2V0ID0gbmV3IFNldChhdXRvQXJyLm1hcCgoaXRlbTogYW55KSA9PiB0aGlzLmRlZXBOb3JtYWxpemUoaXRlbSkpKTtcblxuICAgICAgICBjb25zdCBhZGRlZCA9IGF1dG9BcnIuZmlsdGVyKChpdGVtOiBhbnkpID0+ICFjdXJyTm9ybWFsaXplZFNldC5oYXModGhpcy5kZWVwTm9ybWFsaXplKGl0ZW0pKSk7XG4gICAgICAgIGNvbnN0IHJlbW92ZWQgPSBjdXJyQXJyLmZpbHRlcigoaXRlbTogYW55KSA9PiAhYXV0b05vcm1hbGl6ZWRTZXQuaGFzKHRoaXMuZGVlcE5vcm1hbGl6ZShpdGVtKSkpO1xuICAgICAgICBjb25zdCB1bmNoYW5nZWQgPSBjdXJyQXJyLmZpbHRlcigoaXRlbTogYW55KSA9PiBhdXRvTm9ybWFsaXplZFNldC5oYXModGhpcy5kZWVwTm9ybWFsaXplKGl0ZW0pKSk7XG5cbiAgICAgICAgY29uc3QgaXNEaWZmZXJlbnQgPSBhZGRlZC5sZW5ndGggPiAwIHx8IHJlbW92ZWQubGVuZ3RoID4gMDtcbiAgICAgICAgaWYgKGlzRGlmZmVyZW50KSBoYXNEaWZmZXJlbmNlcyA9IHRydWU7XG5cbiAgICAgICAgZGlmZltmaWVsZF0gPSB7XG4gICAgICAgICAgdHlwZTogJ2FycmF5JyxcbiAgICAgICAgICBjdXJyZW50OiBjdXJyQXJyLFxuICAgICAgICAgIGF1dG9HZW5lcmF0ZWQ6IGF1dG9BcnIsXG4gICAgICAgICAgYWRkZWQsXG4gICAgICAgICAgcmVtb3ZlZCxcbiAgICAgICAgICB1bmNoYW5nZWQsXG4gICAgICAgICAgc3RhdHVzOiBpc0RpZmZlcmVudCA/ICdkaWZmZXJlbnQnIDogJ3NhbWUnXG4gICAgICAgIH07XG5cbiAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgIChjdXJyZW50VmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIGN1cnJlbnRWYWx1ZSA9PT0gJ29iamVjdCcpIHx8XG4gICAgICAgIChhdXRvR2VuZXJhdGVkVmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIGF1dG9HZW5lcmF0ZWRWYWx1ZSA9PT0gJ29iamVjdCcpXG4gICAgICApIHtcbiAgICAgICAgLy8gT2JqZWN0IGNvbXBhcmlzb24gdXNpbmcgZGVlcCBub3JtYWxpemF0aW9uXG4gICAgICAgIGNvbnN0IGN1cnJlbnROb3JtYWxpemVkID0gdGhpcy5kZWVwTm9ybWFsaXplKGN1cnJlbnRWYWx1ZSk7XG4gICAgICAgIGNvbnN0IGF1dG9HZW5lcmF0ZWROb3JtYWxpemVkID0gdGhpcy5kZWVwTm9ybWFsaXplKGF1dG9HZW5lcmF0ZWRWYWx1ZSk7XG4gICAgICAgIGNvbnN0IGlzRGlmZmVyZW50ID0gY3VycmVudE5vcm1hbGl6ZWQgIT09IGF1dG9HZW5lcmF0ZWROb3JtYWxpemVkO1xuXG4gICAgICAgIGlmIChpc0RpZmZlcmVudCkgaGFzRGlmZmVyZW5jZXMgPSB0cnVlO1xuXG4gICAgICAgIGRpZmZbZmllbGRdID0ge1xuICAgICAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgICAgIGN1cnJlbnQ6IGN1cnJlbnRWYWx1ZSxcbiAgICAgICAgICBhdXRvR2VuZXJhdGVkOiBhdXRvR2VuZXJhdGVkVmFsdWUsXG4gICAgICAgICAgc3RhdHVzOiBpc0RpZmZlcmVudCA/ICdkaWZmZXJlbnQnIDogJ3NhbWUnXG4gICAgICAgIH07XG5cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFNjYWxhciBjb21wYXJpc29uIChzdHJpbmcsIG51bWJlciwgYm9vbGVhbiwgbnVsbCwgdW5kZWZpbmVkKVxuICAgICAgICBjb25zdCBpc0RpZmZlcmVudCA9IGN1cnJlbnRWYWx1ZSAhPT0gYXV0b0dlbmVyYXRlZFZhbHVlO1xuICAgICAgICBcbiAgICAgICAgaWYgKGlzRGlmZmVyZW50KSBoYXNEaWZmZXJlbmNlcyA9IHRydWU7XG5cbiAgICAgICAgZGlmZltmaWVsZF0gPSB7XG4gICAgICAgICAgdHlwZTogJ3NjYWxhcicsXG4gICAgICAgICAgY3VycmVudDogY3VycmVudFZhbHVlLFxuICAgICAgICAgIGF1dG9HZW5lcmF0ZWQ6IGF1dG9HZW5lcmF0ZWRWYWx1ZSxcbiAgICAgICAgICBzdGF0dXM6IGlzRGlmZmVyZW50ID8gJ2RpZmZlcmVudCcgOiAnc2FtZSdcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4geyBkaWZmLCBoYXNEaWZmZXJlbmNlcyB9O1xuICB9XG5cbiAgQFB1dCgnL2luZGljZXMve2VudGl0eU5hbWV9L3NldHRpbmdzJywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIHNldHRpbmdzOiB7IGRhdGF0eXBlOiAnb2JqZWN0JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgdXBkYXRlSW5kZXhTZXR0aW5ncyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgc2V0dGluZ3M6IFJlY29yZDxzdHJpbmcsIGFueT47IH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG4gICAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcmVxLmJvZHkgfHwge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2VhcmNoU2VydmljZS51cGRhdGVJbmRleFNldHRpbmdzKHNldHRpbmdzLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICByZXN1bHQsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIG1lc3NhZ2U6ICdJbmRleCBzZXR0aW5ncyB1cGRhdGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgfSk7XG4gIH1cblxuICBAUG9zdCgnL2luZGljZXMve2VudGl0eU5hbWV9L3Jlc2V0LXNldHRpbmdzJylcbiAgYXN5bmMgcmVzZXRJbmRleFNldHRpbmdzKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UucmVzZXRJbmRleFNldHRpbmdzKCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBtZXNzYWdlOiAnSW5kZXggc2V0dGluZ3MgcmVzZXQgdG8gTWVpbGlzZWFyY2ggZGVmYXVsdHMnXG4gICAgfSk7XG4gIH1cblxuICBAUG9zdCgnL2luZGljZXMve2VudGl0eU5hbWV9L2FwcGx5LWRlZmF1bHQtc2V0dGluZ3MnKVxuICBhc3luYyBhcHBseURlZmF1bHRTZXR0aW5ncyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgXG4gICAgLy8gR2V0IGF1dG8tZ2VuZXJhdGVkIHNldHRpbmdzIGZyb20gZW50aXR5IHNjaGVtYVxuICAgIGNvbnN0IHNlYXJjaENvbmZpZyA9IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBjb25zdCBhdXRvR2VuZXJhdGVkU2V0dGluZ3MgPSBzZWFyY2hDb25maWcuc2V0dGluZ3MgfHwge307XG5cbiAgICAvLyBBcHBseSB0aGUgYXV0by1nZW5lcmF0ZWQgc2V0dGluZ3NcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLnVwZGF0ZUluZGV4U2V0dGluZ3MoYXV0b0dlbmVyYXRlZFNldHRpbmdzLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGFwcGxpZWRTZXR0aW5nczogYXV0b0dlbmVyYXRlZFNldHRpbmdzLFxuICAgICAgbWVzc2FnZTogJ0RlZmF1bHQgc2V0dGluZ3MgYXBwbGllZCBzdWNjZXNzZnVsbHkgZnJvbSBlbnRpdHkgc2NoZW1hJ1xuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9pbml0JylcbiAgYXN5bmMgaW5pdFNpbmdsZUVudGl0eUluZGV4KFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBpZiAoIWVudGl0eVNlcnZpY2UuaXNTZWFyY2hFbmFibGVkKCkpIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBtZXNzYWdlOiBgU2VhcmNoIGlzIG5vdCBlbmFibGVkIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWAsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5pbml0U2VhcmNoSW5kZXgoKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICBjb25maWcsXG4gICAgICBtZXNzYWdlOiBgSW5kZXggJHtjb25maWcuaW5kZXhOYW1lfSBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHlgLFxuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9yZWNyZWF0ZScpXG4gIGFzeW5jIHJlY3JlYXRlSW5kZXgoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7XG4gICAgICAgIHJlc3luY0RvY3VtZW50cz86IGJvb2xlYW47XG4gICAgICAgIHN5bmNNZXRob2Q/OiAnZGlyZWN0JyB8ICdxdWV1ZSc7XG4gICAgICAgIGJhdGNoU2l6ZT86IG51bWJlcjtcbiAgICAgICAgcXVldWVVcmw/OiBzdHJpbmc7XG4gICAgICB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcbiAgICBjb25zdCB7IFxuICAgICAgcmVzeW5jRG9jdW1lbnRzID0gZmFsc2UsIFxuICAgICAgc3luY01ldGhvZCA9ICdkaXJlY3QnLFxuICAgICAgYmF0Y2hTaXplID0gNTAsXG4gICAgICBxdWV1ZVVybCBcbiAgICB9ID0gcmVxLmJvZHkgfHwge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3Qgb2xkQ29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oYFJlY3JlYXRpbmcgaW5kZXggZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCwgeyBvbGRDb25maWcgfSk7XG5cbiAgICAvLyBEZWxldGUgZXhpc3RpbmcgaW5kZXhcbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBEZWxldGluZyBleGlzdGluZyBpbmRleDogJHtvbGRDb25maWcuaW5kZXhOYW1lfWApO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmRlbGV0ZVNlYXJjaEluZGV4KHRydWUpO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oYENvdWxkIG5vdCBkZWxldGUgaW5kZXggKG1pZ2h0IG5vdCBleGlzdCk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG5cbiAgICAvLyBSZWluaXRpYWxpemUgaW5kZXggd2l0aCBuZXcgY29uZmlndXJhdGlvblxuICAgIHRoaXMubG9nZ2VyLmluZm8oYFJlaW5pdGlhbGl6aW5nIGluZGV4IGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuaW5pdFNlYXJjaEluZGV4KCk7XG4gICAgY29uc3QgbmV3Q29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuXG4gICAgbGV0IHJlc3luY1Jlc3VsdCA9IG51bGw7XG5cbiAgICAvLyBPcHRpb25hbGx5IHJlc3luYyBhbGwgZG9jdW1lbnRzXG4gICAgaWYgKHJlc3luY0RvY3VtZW50cykge1xuICAgICAgaWYgKHN5bmNNZXRob2QgPT09ICdxdWV1ZScpIHtcbiAgICAgICAgLy8gUXVldWUtYmFzZWQgc3luYyAobm9uLWJsb2NraW5nLCBmb3IgbGFyZ2UgZGF0YXNldHMpXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYFF1ZXVlaW5nIGRvY3VtZW50cyBmb3IgcmVzeW5jOiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIHJlc3luY1Jlc3VsdCA9IGF3YWl0IHRoaXMucXVldWVEb2N1bWVudHNGb3JSZXN5bmMoZW50aXR5TmFtZSwgeyBiYXRjaFNpemUsIHF1ZXVlVXJsIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRGlyZWN0IHN5bmMgKGJsb2NraW5nLCBpbW1lZGlhdGUgY29uZmlybWF0aW9uKVxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBEaXJlY3RseSByZXN5bmNpbmcgZG9jdW1lbnRzOiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIHJlc3luY1Jlc3VsdCA9IGF3YWl0IHNlYXJjaFNlcnZpY2UucmVzeW5jQWxsRG9jdW1lbnRzKHsgYmF0Y2hTaXplIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIG9sZEluZGV4TmFtZTogb2xkQ29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG5ld0luZGV4TmFtZTogbmV3Q29uZmlnLmluZGV4TmFtZSxcbiAgICAgIHN5bmNNZXRob2Q6IHJlc3luY0RvY3VtZW50cyA/IHN5bmNNZXRob2QgOiBudWxsLFxuICAgICAgbWVzc2FnZTogYEluZGV4IHJlY3JlYXRlZCBzdWNjZXNzZnVsbHkke3Jlc3luY0RvY3VtZW50cyA/IGAgKCR7c3luY01ldGhvZH0gc3luYzogJHtyZXN5bmNSZXN1bHQ/LnByb2Nlc3NlZENvdW50IHx8IDB9IGRvY3VtZW50cylgIDogJyd9YCxcbiAgICAgIHJlc3luY1Jlc3VsdCxcbiAgICAgIGNvbmZpZ3M6IHsgb2xkQ29uZmlnLCBuZXdDb25maWcgfVxuICAgIH0pO1xuICB9XG5cbiAgQERlbGV0ZSgnL2luZGljZXMve2VudGl0eU5hbWV9JylcbiAgYXN5bmMgZGVsZXRlSW5kZXgoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5kZWxldGVTZWFyY2hJbmRleCh0cnVlKTtcbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBtZXNzYWdlOiAnSW5kZXggZGVsZXRlZCBzdWNjZXNzZnVsbHknXG4gICAgfSk7XG4gIH1cblxuICBARGVsZXRlKCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vZG9jdW1lbnRzJylcbiAgYXN5bmMgY2xlYXJFbnRpdHlJbmRleChcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgY29uZmlnID0gc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RW5naW5lKCkuZGVsZXRlQWxsRG9jdW1lbnRzKGNvbmZpZy5pbmRleE5hbWUhLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdBbGwgZG9jdW1lbnRzIGNsZWFyZWQgZnJvbSBpbmRleCdcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vcmVzeW5jJylcbiAgYXN5bmMgcmVzeW5jRW50aXR5UmVjb3JkcyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgYmF0Y2hTaXplPzogbnVtYmVyOyBxdWV1ZVVybD86IHN0cmluZzsgYnlCYXRjaD86IGJvb2xlYW4gfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG4gICAgY29uc3QgeyBiYXRjaFNpemUgPSA1MCwgcXVldWVVcmwsIGJ5QmF0Y2ggPSB0cnVlIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucXVldWVEb2N1bWVudHNGb3JSZXN5bmMoZW50aXR5TmFtZSwgeyBiYXRjaFNpemUsIHF1ZXVlVXJsLCBieUJhdGNoIH0pO1xuXG4gICAgbGV0IG1lc3NhZ2UgPSBgUXVldWVkICR7cmVzdWx0LnByb2Nlc3NlZENvdW50fSByZWNvcmRzIGZvciByZS1pbmRleGluZ2A7XG4gICAgaWYgKHJlc3VsdC5mYWlsZWRDb3VudCA+IDApIHtcbiAgICAgIG1lc3NhZ2UgKz0gYCwgJHtyZXN1bHQuZmFpbGVkQ291bnR9IHJlY29yZHMgZmFpbGVkIHRvIGJlIHF1ZXVlZGA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBzdWNjZXNzOiByZXN1bHQucHJvY2Vzc2VkQ291bnQgPiAwLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIC4uLnJlc3VsdCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZSBkb2N1bWVudHMgZm9yIGFzeW5jIHJlc3luYyB2aWEgU1FTXG4gICAqIFNoYXJlZCBsb2dpYyB1c2VkIGJ5IHJlc3luYyBhbmQgcmVjcmVhdGUgZW5kcG9pbnRzXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHF1ZXVlRG9jdW1lbnRzRm9yUmVzeW5jKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBvcHRpb25zOiB7XG4gICAgICBiYXRjaFNpemU/OiBudW1iZXI7XG4gICAgICBxdWV1ZVVybD86IHN0cmluZztcbiAgICAgIGJ5QmF0Y2g/OiBib29sZWFuO1xuICAgIH1cbiAgKTogUHJvbWlzZTx7XG4gICAgcHJvY2Vzc2VkQ291bnQ6IG51bWJlcjtcbiAgICBmYWlsZWRDb3VudDogbnVtYmVyO1xuICAgIHRvdGFsSXRlcmF0aW9uczogbnVtYmVyO1xuICB9PiB7XG4gICAgY29uc3QgeyBiYXRjaFNpemUgPSA1MCwgcXVldWVVcmwsIGJ5QmF0Y2ggPSB0cnVlIH0gPSBvcHRpb25zO1xuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICAvLyBVc2UgcHJvdmlkZWQgcXVldWVVcmwgb3IgcmVzb2x2ZSBmcm9tIGVudmlyb25tZW50XG4gICAgY29uc3QgcXVldWVOYW1lID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBTRUFSQ0hfQ09OVFJPTExFUl9FTlZfS0VZUy5NRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUgfSk7XG4gICAgY29uc3QgcmVzb2x2ZWRRdWV1ZVVybCA9IHF1ZXVlVXJsIHx8IEVudmlyb25tZW50LnF1ZXVlVXJsKHF1ZXVlTmFtZSk7XG5cbiAgICBpZiAoIXJlc29sdmVkUXVldWVVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUXVldWUgVVJMIG5vdCBwcm92aWRlZCBhbmQgZW52LWtleSBbJHtTRUFSQ0hfQ09OVFJPTExFUl9FTlZfS0VZUy5NRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUV9XSBpcyBub3QgY29uZmlndXJlZGApO1xuICAgIH1cblxuICAgIGxldCBmYWlsZWRDb3VudCA9IDA7XG4gICAgbGV0IHByb2Nlc3NlZENvdW50ID0gMDtcbiAgICBsZXQgY3Vyc29yOiBzdHJpbmcgfCB1bmRlZmluZWQgPSAnaW5pdCc7XG4gICAgbGV0IGl0ZXJhdGlvbkNvdW50ID0gMDtcbiAgICBjb25zdCBtYXhJdGVyYXRpb25zID0gMTAwMDAwO1xuXG4gICAgd2hpbGUgKCEhY3Vyc29yICYmIGl0ZXJhdGlvbkNvdW50IDwgbWF4SXRlcmF0aW9ucykge1xuICAgICAgaXRlcmF0aW9uQ291bnQrKztcblxuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgRmV0Y2hpbmcgJHtlbnRpdHlOYW1lfSByZWNvcmRzIGZyb20gY3Vyc29yOiAke2N1cnNvcn1gKTtcblxuICAgICAgY29uc3QgcXVlcnlSZXN1bHQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnF1ZXJ5KHtcbiAgICAgICAgcGFnaW5hdGlvbjoge1xuICAgICAgICAgIGxpbWl0OiBiYXRjaFNpemUsXG4gICAgICAgICAgY3Vyc29yOiBjdXJzb3IgPT09ICdpbml0JyA/IHVuZGVmaW5lZCA6IGN1cnNvclxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgaWYgKCFxdWVyeVJlc3VsdC5kYXRhIHx8IHF1ZXJ5UmVzdWx0LmRhdGEubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBpZiAoYnlCYXRjaCkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgUHJvbWlzZS5hbGwocXVlcnlSZXN1bHQuZGF0YS5tYXAoYXN5bmMgKHJlYykgPT4ge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBlbnRpdHlTZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcocmVjKTtcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgc2VuZFF1ZXVlTWVzc2FnZShyZXNvbHZlZFF1ZXVlVXJsLCB7XG4gICAgICAgICAgICBkYXRhLFxuICAgICAgICAgICAgZXZlbnROYW1lOiBcIlJFU1lOQ1wiLFxuICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBwcm9jZXNzZWRDb3VudCArPSBkYXRhLmxlbmd0aDtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBFcnJvciBxdWV1ZWluZyBiYXRjaCBmb3Igc3luYzogJHtlcnJvci5tZXNzYWdlfWAsIHsgZW50aXR5TmFtZSwgYmF0Y2hTaXplLCBlcnJvciB9KTtcbiAgICAgICAgICBmYWlsZWRDb3VudCArPSBkYXRhLmxlbmd0aDtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgcXVlcnlSZXN1bHQuZGF0YS5tYXAoYXN5bmMgKGVudGl0eVJlY29yZCkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgY29uc3QgdHJhbnNmb3JtZWQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5UmVjb3JkKTtcbiAgICAgICAgICAgICAgYXdhaXQgc2VuZFF1ZXVlTWVzc2FnZShyZXNvbHZlZFF1ZXVlVXJsLCB7XG4gICAgICAgICAgICAgIGRhdGE6IHRyYW5zZm9ybWVkLFxuICAgICAgICAgICAgICBldmVudE5hbWU6IFwiUkVTWU5DXCIsXG4gICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcHJvY2Vzc2VkQ291bnQrKztcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBFcnJvciBxdWV1ZWluZyByZWNvcmQgZm9yIHN5bmM6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGVudGl0eU5hbWUsIGVycm9yIH0pO1xuICAgICAgICAgICAgZmFpbGVkQ291bnQrKztcbiAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY3Vyc29yID0gcXVlcnlSZXN1bHQuY3Vyc29yID8/IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBRdWV1ZSBzeW5jIGNvbXBsZXRlZCBmb3IgJHtlbnRpdHlOYW1lfWAsIHtcbiAgICAgIHByb2Nlc3NlZENvdW50LFxuICAgICAgZmFpbGVkQ291bnQsXG4gICAgICB0b3RhbEl0ZXJhdGlvbnM6IGl0ZXJhdGlvbkNvdW50XG4gICAgfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgcHJvY2Vzc2VkQ291bnQsXG4gICAgICBmYWlsZWRDb3VudCxcbiAgICAgIHRvdGFsSXRlcmF0aW9uczogaXRlcmF0aW9uQ291bnQsXG4gICAgfTtcbiAgfVxuXG4gIEBHZXQoJy9xdWV1ZS1pbmZvJylcbiAgYXN5bmMgZ2V0UXVldWVJbmZvKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgcXVldWVVcmw6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IHF1ZXVlVXJsIH0gPSByZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzOyAgXG5cbiAgICAvLyBVc2UgcHJvdmlkZWQgcXVldWVVcmwgb3IgcmVzb2x2ZSBmcm9tIGVudmlyb25tZW50XG4gICAgY29uc3QgcXVldWVOYW1lID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBTRUFSQ0hfQ09OVFJPTExFUl9FTlZfS0VZUy5NRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUgfSk7XG4gICAgY29uc3QgcmVzb2x2ZWRRdWV1ZVVybCA9IHF1ZXVlVXJsIHx8IEVudmlyb25tZW50LnF1ZXVlVXJsKHF1ZXVlTmFtZSk7XG5cbiAgICBjb25zdCBpbmZvID0gYXdhaXQgZ2V0UXVldWVNZXNzYWdlTWV0YWRhdGEocmVzb2x2ZWRRdWV1ZVVybCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oeyBpbmZvIH0pO1xuICB9XG5cbiAgQFB1dCgnL3JlY29yZHMve2VudGl0eU5hbWV9Jywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIGRvY3VtZW50czogeyBkYXRhdHlwZTogJ2FycmF5JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgdXBkYXRlRG9jdW1lbnRzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBkb2N1bWVudHM6IGFueVtdIH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHsgZG9jdW1lbnRzIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNlYXJjaFNlcnZpY2UudXBkYXRlRG9jdW1lbnRzKGRvY3VtZW50cywgdHJ1ZSk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHJlc3VsdCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgbWVzc2FnZTogJ0RvY3VtZW50cyB1cGRhdGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgfSk7XG4gIH1cblxuICBARGVsZXRlKCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0vYnktaWRzJywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIGlkczogeyBkYXRhdHlwZTogJ2FycmF5JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzQnlJZHMoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IGlkczogc3RyaW5nW10gfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgeyBpZHMgfSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RW5naW5lKCkuZGVsZXRlRG9jdW1lbnRzKGlkcywgY29uZmlnLmluZGV4TmFtZSEsIHRydWUpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgbWVzc2FnZTogJ0RvY3VtZW50cyBkZWxldGVkIHN1Y2Nlc3NmdWxseSdcbiAgICB9KTtcbiAgfVxuXG4gIEBEZWxldGUoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfS9ieS1maWx0ZXInLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZmlsdGVyOiB7IGRhdGF0eXBlOiAnb2JqZWN0JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzQnlGaWx0ZXIoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IGZpbHRlcjogYW55IH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHsgZmlsdGVyIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZGVsZXRlRG9jdW1lbnRzQnlGaWx0ZXIoZmlsdGVyLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdEb2N1bWVudHMgbWF0Y2hpbmcgZmlsdGVyIGhhdmUgYmVlbiBxdWV1ZWQgZm9yIGRlbGV0aW9uLidcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IHByb3ZpZGVyID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICAgIGZvckVudGl0eTogZW50aXR5TmFtZSxcbiAgICB9KTtcblxuICAgIGlmIChwcm92aWRlci5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gcHJvdmlkZXIgZm91bmQgZm9yIGVudGl0eS1zZXJ2aWNlIGZvciAke2VudGl0eU5hbWV9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHByb3ZpZGVyWyAwIF0uX2NvbnRhaW5lci5yZXNvbHZlPEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KHByb3ZpZGVyWyAwIF0uX3Byb3ZpZGVyLnByb3ZpZGUpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3QgZW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gZW50aXR5U2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG5cbiAgICBpZiAoIXNlYXJjaFNlcnZpY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIHNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgIH1cblxuICAgIHJldHVybiBzZWFyY2hTZXJ2aWNlO1xuICB9XG59Il19