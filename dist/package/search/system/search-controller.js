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
        const settings = await searchService.getIndexSettings();
        return res.json({ settings });
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
            message: 'Index settings reset to code configuration'
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9zZWFyY2gtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFFQSwwQ0FBNkU7QUFDN0Usc0ZBQTBFO0FBRTFFLGlEQUFzRTtBQUN0RSxpQ0FBMkM7QUFHM0MsdUNBQTJEO0FBQzNELGtEQUFtRDtBQUNuRCx5Q0FBMkM7QUFFM0MsSUFBWSwwQkFFWDtBQUZELFdBQVksMEJBQTBCO0lBQ3BDLHlGQUEyRCxDQUFBO0FBQzdELENBQUMsRUFGVywwQkFBMEIsMENBQTFCLDBCQUEwQixRQUVyQztBQU9NLElBQU0sc0JBQXNCLEdBQTVCLE1BQU0sc0JBQXVCLFNBQVEsc0NBQWE7SUFDZDtJQUF6QyxZQUF5QyxTQUF1QjtRQUM5RCxLQUFLLEVBQUUsQ0FBQztRQUQrQixjQUFTLEdBQVQsU0FBUyxDQUFjO0lBRWhFLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQTRCLEVBQUUsUUFBaUIsSUFBSSxDQUFDO0lBRy9ELEFBQU4sS0FBSyxDQUFDLFdBQVcsQ0FBQyxRQUFpQixFQUFFLFFBQWtCO1FBQ3JELDZDQUE2QztRQUM3QyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDO1lBQzdELElBQUksRUFBRSxTQUFTO1lBQ2YsK0JBQStCLEVBQUUsSUFBSTtTQUN0QyxDQUFDO2FBQ0MsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFO1lBQ1YsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUE7UUFDaEMsQ0FBQyxDQUFDLENBQUM7UUFFTCxNQUFNLFdBQVcsR0FBVSxFQUFFLENBQUM7UUFFOUIsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLFFBQVEsRUFBRSxFQUFFO1lB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QUFHLEVBQUUsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUU7YUFDM0M7U0FDRjtLQUNGLENBQUM7a0VBb0JEO0FBU0s7SUFQTCxJQUFBLG1CQUFNLEVBQUMsaUNBQWlDLEVBQUU7UUFDekMsV0FBVyxFQUFFO1lBQ1gsSUFBSSxFQUFFO2dCQUNKLE1BQU0sRUFBRSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRTthQUMvQztTQUNGO0tBQ0YsQ0FBQztxRUFxQkQ7aUNBanVCVSxzQkFBc0I7SUFMbEMsSUFBQSx1QkFBVSxFQUFDLGVBQWUsRUFBRTtRQUMzQixHQUFHLEVBQUUsQ0FBRTtnQkFDTCxJQUFJLEVBQUUsMEJBQTBCLENBQUMsMkJBQTJCO2FBQzdELENBQUU7S0FDSixDQUFDO0lBRWEsV0FBQSxJQUFBLG9CQUFlLEdBQUUsQ0FBQTtHQURuQixzQkFBc0IsQ0EydkJsQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuXG5pbXBvcnQgeyBnZXRRdWV1ZU1lc3NhZ2VNZXRhZGF0YSwgc2VuZFF1ZXVlTWVzc2FnZSB9IGZyb20gXCIuLi8uLi9jbGllbnQvc3FzXCI7XG5pbXBvcnQgeyBBUElDb250cm9sbGVyIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2FwaS1nYXRld2F5LWNvbnRyb2xsZXInO1xuaW1wb3J0IHR5cGUgeyBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSBcIi4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7IENvbnRyb2xsZXIsIERlbGV0ZSwgR2V0LCBQb3N0LCBQdXQgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzJztcbmltcG9ydCB7IEluamVjdENvbnRhaW5lciB9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7IHR5cGUgQmFzZUVudGl0eVNlcnZpY2UgfSBmcm9tICcuLi8uLi9lbnRpdHknO1xuaW1wb3J0IHsgdHlwZSBJRElDb250YWluZXIsIHR5cGUgUmVxdWVzdCwgdHlwZSBSZXNwb25zZSB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgZGVlcENvcHksIHJlc29sdmVFbnZWYWx1ZUZvciB9IGZyb20gJy4uLy4uL3V0aWxzJztcbmltcG9ydCB7IHBhcnNlU2VhcmNoUXVlcnkgfSBmcm9tIFwiLi4vc2VhcmNoLXV0aWxzXCI7XG5pbXBvcnQgeyBFbnZpcm9ubWVudCB9IGZyb20gXCIuLi8uLi9jbGllbnRcIjtcblxuZXhwb3J0IGVudW0gU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMge1xuICBNRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUgPSAnTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FJyxcbn1cblxuQENvbnRyb2xsZXIoJ3N5c3RlbS9zZWFyY2gnLCB7XG4gIGVudjogWyB7XG4gICAgbmFtZTogU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FLFxuICB9IF0sXG59KVxuZXhwb3J0IGNsYXNzIFNlYXJjaFN5c3RlbUNvbnRyb2xsZXIgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgY29uc3RydWN0b3IoQEluamVjdENvbnRhaW5lcigpIHByb3RlY3RlZCBjb250YWluZXI6IElESUNvbnRhaW5lcikge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KSB7IH1cblxuICBAR2V0KCcvaW5kaWNlcycpXG4gIGFzeW5jIGxpc3RJbmRpY2VzKF9yZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UpIHtcbiAgICAvLyBBdXRvLWRpc2NvdmVyIGVudGl0aWVzIHdpdGggc2VhcmNoIGVuYWJsZWRcbiAgICBjb25zdCBlbnRpdHlQcm92aWRlcnMgPSB0aGlzLmNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlLFxuICAgIH0pXG4gICAgICAuZmlsdGVyKHAgPT4ge1xuICAgICAgICByZXR1cm4gISFwLl9wcm92aWRlci5mb3JFbnRpdHlcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgaW5kaWNlc0RhdGE6IGFueVtdID0gW107XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChlbnRpdHlQcm92aWRlcnMubWFwKGFzeW5jIChwcm92aWRlcikgPT4ge1xuXG4gICAgICBjb25zdCBlbnRpdHlOYW1lID0gcHJvdmlkZXIuX3Byb3ZpZGVyLmZvckVudGl0eSBhcyBzdHJpbmc7XG5cbiAgICAgIHRyeSB7XG5cbiAgICAgICAgLy8gdXNlIHByb3ZpZGVyJ3MgY29udGFpbmVyICB0byByZXNvbHZlIHRoZSBzZXJ2aWNlXG4gICAgICAgIGNvbnN0IHNlcnZpY2UgPSBwcm92aWRlci5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oXG4gICAgICAgICAgcHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGVcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAoIXNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlcnZpY2UgJHtTdHJpbmcocHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGUpfSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gc2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgIGlmICghc2VhcmNoU2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIHNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaW5kZXhJbmZvID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleEluZm8oKTtcblxuICAgICAgICBpbmRpY2VzRGF0YS5wdXNoKHtcbiAgICAgICAgICAuLi5pbmRleEluZm8sXG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBpbmRleE5hbWU6IGluZGV4SW5mby51aWQsXG4gICAgICAgIH0pO1xuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG5cbiAgICAgICAgaW5kaWNlc0RhdGEucHVzaCh7XG4gICAgICAgICAgaW5kZXhOYW1lOiBgWyR7ZW50aXR5TmFtZX1dLWluZGV4LW5hbWUtbm90LXJlc29sdmVkYCxcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihlcnJvcik7XG4gICAgICB9XG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHJlc3BvbnNlLmpzb24oeyBpbmRpY2VzOiBpbmRpY2VzRGF0YSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgbmV3IGFwaSB0byBnZXQgaW5kZXggZGV0YWlsc1xuICAgKiBcbiAgICovXG5cbiAgQEdldCgnL2luZGljZXMve2VudGl0eU5hbWV9Jywge30pXG4gIGFzeW5jIGdldEluZGV4RGV0YWlscyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgaW5kZXhJbmZvID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleEluZm8oKTtcbiAgICBjb25zdCBpbmRleFN0YXRzID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleFN0YXRzKCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgZGV0YWlsczoge1xuICAgICAgICBpbmRleEluZm8sXG4gICAgICAgIGluZGV4U3RhdHMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBAR2V0KCcvZW50aXRpZXMnKVxuICBhc3luYyBnZXRTZWFyY2hFbnRpdGllcyhfcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgZW50aXR5UHJvdmlkZXJzID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICB9KVxuICAgICAgLmZpbHRlcihwID0+ICEhcC5fcHJvdmlkZXIuZm9yRW50aXR5KTtcblxuICAgIGNvbnN0IGVudGl0aWVzRGF0YToge1xuICAgICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgICAgc2VhcmNoRW5hYmxlZDogYm9vbGVhbjtcbiAgICAgIGluZGV4RXhpc3RzPzogYm9vbGVhbjtcbiAgICAgIGluZGV4TmFtZT86IHN0cmluZztcbiAgICAgIGVycm9yPzogc3RyaW5nO1xuICAgIH1bXSA9IFtdO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZW50aXR5UHJvdmlkZXJzLm1hcChhc3luYyAocHJvdmlkZXIpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSBwcm92aWRlci5fcHJvdmlkZXIuZm9yRW50aXR5IGFzIHN0cmluZztcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc2VydmljZSA9IHByb3ZpZGVyLl9jb250YWluZXIucmVzb2x2ZTxCYXNlRW50aXR5U2VydmljZTxhbnk+PihcbiAgICAgICAgICBwcm92aWRlci5fcHJvdmlkZXIucHJvdmlkZVxuICAgICAgICApO1xuXG4gICAgICAgIGlmICghc2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VydmljZSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWFyY2hFbmFibGVkID0gc2VydmljZS5pc1NlYXJjaEVuYWJsZWQoKTtcbiAgICAgICAgbGV0IGluZGV4RXhpc3RzID0gZmFsc2U7XG4gICAgICAgIGxldCBpbmRleE5hbWUgPSAnJztcblxuICAgICAgICBpZiAoc2VhcmNoRW5hYmxlZCkge1xuICAgICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSBzZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgICBpZiAoc2VhcmNoU2VydmljZSkge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgICAgICAgICAgaW5kZXhOYW1lID0gY29uZmlnLmluZGV4TmFtZSE7XG4gICAgICAgICAgICBpbmRleEV4aXN0cyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RW5naW5lKCkuaW5kZXhFeGlzdHMoaW5kZXhOYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBlbnRpdGllc0RhdGEucHVzaCh7XG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBzZWFyY2hFbmFibGVkLFxuICAgICAgICAgIGluZGV4RXhpc3RzLFxuICAgICAgICAgIGluZGV4TmFtZSxcbiAgICAgICAgfSk7XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgZW50aXRpZXNEYXRhLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgc2VhcmNoRW5hYmxlZDogZmFsc2UsXG4gICAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIHJldHVybiByZXNwb25zZS5qc29uKHsgZW50aXRpZXM6IGVudGl0aWVzRGF0YSB9KTtcbiAgfVxuXG4gIEBHZXQoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfS97ZG9jdW1lbnRJZH0nKVxuICBhc3luYyBnZXRTaW5nbGVEb2N1bWVudChcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZywgZG9jdW1lbnRJZDogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGRvY3VtZW50SWQgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcHJpbWFyeUlkRmllbGROYW1lID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcblxuICAgIGNvbnN0IGRvYyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RG9jdW1lbnQoZG9jdW1lbnRJZCk7XG5cbiAgICBkb2NbICdpZCcgXSA9IGRvY1sgJ2lkJyBdIHx8IGRvY1sgcHJpbWFyeUlkRmllbGROYW1lIGFzIHN0cmluZyBdO1xuICAgIGRvY1sgJ2Z1bGxSZWNvcmQnIF0gPSB7IC4uLmRvYyB9O1xuICAgIGRvY1sgJ2VudGl0eU5hbWUnIF0gPSBlbnRpdHlOYW1lO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKGRvYyk7XG4gIH1cblxuICBAR2V0KCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0nKVxuICBhc3luYyBnZXRFbnRpdHlSZWNvcmRzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzPzogUmVjb3JkPHN0cmluZywgYW55PlxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2UsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dFxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3QgZW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBxdWVyeSA9IGRlZXBDb3B5KHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnMpO1xuXG4gICAgY29uc3QgcGFyc2VkUXVlcnkgPSBwYXJzZVNlYXJjaFF1ZXJ5KHF1ZXJ5KTtcbiAgICBjb25zdCB7IHNlbGVjdDogX3NlbGVjdCwgLi4ucmVzdFF1ZXJ5UGFyYW1zIH0gPSBwYXJzZWRRdWVyeTtcblxuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnNlYXJjaChyZXN0UXVlcnlQYXJhbXMsIGN0eCk7XG5cbiAgICBjb25zdCB7IGhpdHMsIC4uLnJlc3QgfSA9IHJlc3VsdHM7XG5cbiAgICAvLyBHZXQgdGhlIGVudGl0eSdzIHByaW1hcnkgaWRlbnRpZmllciBmaWVsZCBuYW1lXG4gICAgY29uc3QgcHJpbWFyeUlkRmllbGROYW1lID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcblxuICAgIC8vIEVuc3VyZSBhbGwgcmVjb3JkcyBoYXZlIGEgY29uc2lzdGVudCAnaWQnIGZpZWxkIGZvciBnZW5lcmljIFVJIGxpc3RpbmdcbiAgICBjb25zdCBub3JtYWxpemVkSGl0cyA9IGhpdHMubWFwKChoaXQ6IGFueSkgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEhpdCA9IHsgLi4uaGl0IH07XG5cbiAgICAgIG5vcm1hbGl6ZWRIaXRbICdlbnRpdHlOYW1lJyBdID0gZW50aXR5TmFtZTtcbiAgICAgIG5vcm1hbGl6ZWRIaXRbICdmdWxsUmVjb3JkJyBdID0gaGl0O1xuXG4gICAgICAvLyBJZiB0aGUgcmVjb3JkIGRvZXNuJ3QgaGF2ZSBhbiAnaWQnIGZpZWxkIGJ1dCBoYXMgdGhlIHByaW1hcnkgaWRlbnRpZmllciBmaWVsZCxcbiAgICAgIC8vIG1hcCBpdCB0byAnaWQnIGZvciBjb25zaXN0ZW50IGdlbmVyaWMgbGlzdGluZ1xuICAgICAgaWYgKCFub3JtYWxpemVkSGl0LmlkICYmIHByaW1hcnlJZEZpZWxkTmFtZSAmJiBub3JtYWxpemVkSGl0WyBwcmltYXJ5SWRGaWVsZE5hbWUgXSkge1xuICAgICAgICBub3JtYWxpemVkSGl0LmlkID0gbm9ybWFsaXplZEhpdFsgcHJpbWFyeUlkRmllbGROYW1lIF07XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHN0aWxsIG5vIGlkIGZpZWxkLCB0cnkgY29tbW9uIGlkZW50aWZpZXIgcGF0dGVybnNcbiAgICAgIGlmICghbm9ybWFsaXplZEhpdC5pZCkge1xuICAgICAgICBjb25zdCBpZEZpZWxkcyA9IFsgYCR7ZW50aXR5TmFtZX1JZGAsIGAke2VudGl0eU5hbWUudG9Mb3dlckNhc2UoKX1JZGAgXTtcbiAgICAgICAgZm9yIChjb25zdCBpZEZpZWxkIG9mIGlkRmllbGRzKSB7XG4gICAgICAgICAgaWYgKG5vcm1hbGl6ZWRIaXRbIGlkRmllbGQgXSkge1xuICAgICAgICAgICAgbm9ybWFsaXplZEhpdC5pZCA9IG5vcm1hbGl6ZWRIaXRbIGlkRmllbGQgXTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gbm9ybWFsaXplZEhpdDtcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3BvbnNlID0ge1xuICAgICAgLi4ucmVzdCxcbiAgICAgIGl0ZW1zOiBub3JtYWxpemVkSGl0cyxcbiAgICB9O1xuXG4gICAgaWYgKHJlcS5kZWJ1Z01vZGUpIHtcbiAgICAgIE9iamVjdC5hc3NpZ24ocmVzcG9uc2UsIHtcbiAgICAgICAgaW5wdXRRdWVyeTogcXVlcnksXG4gICAgICAgIHByb2Nlc3NpbmdUaW1lTXM6IHJlc3VsdHMucHJvY2Vzc2luZ1RpbWVNcyxcbiAgICAgICAgcHJpbWFyeUlkRmllbGROYW1lXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmpzb24ocmVzcG9uc2UpO1xuICB9XG5cbiAgQFBvc3QoJy9pbml0SW5kaWNlcycpXG4gIGFzeW5jIGluaXRTZWFyY2hJbmRpY2VzKFxuICAgIHJlcTogUmVxdWVzdDx7IGJvZHk6IHsgZW50aXRpZXM/OiBzdHJpbmdbXSB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0aWVzOiByZXF1ZXN0ZWRFbnRpdGllcyA9IFtdIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIC8vIGNvbGxlY3QgcHJvdmlkZXIgZm9yIGVudGl0eS1zZXJ2aWNlcyBmcm9tIGNvbnRhaW5lci1oaWVyYXJjaHlcbiAgICBjb25zdCBlbnRpdHlQcm92aWRlcnMgPSB0aGlzLmNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlLFxuICAgIH0pXG4gICAgICAuZmlsdGVyKHAgPT4gKFxuICAgICAgICAvLyBmaWx0ZXIgb3V0IHByb3ZpZGVycyB0aGF0IGRvIG5vdCBoYXZlIGEgZm9yRW50aXR5IHByb3BlcnR5XG4gICAgICAgICEhcC5fcHJvdmlkZXIuZm9yRW50aXR5XG4gICAgICAgICYmIChcbiAgICAgICAgICAvLyBpZiBubyBlbnRpdGllcyBhcmUgcmVxdWVzdGVkLCBpbmNsdWRlIGFsbCBlbnRpdGllc1xuICAgICAgICAgICFyZXF1ZXN0ZWRFbnRpdGllcz8ubGVuZ3RoXG4gICAgICAgICAgLy8gaWYgZW50aXRpZXMgYXJlIHJlcXVlc3RlZCwgaW5jbHVkZSBvbmx5IHRoZSByZXF1ZXN0ZWQgZW50aXRpZXNcbiAgICAgICAgICB8fCByZXF1ZXN0ZWRFbnRpdGllcy5pbmNsdWRlcyhwLl9wcm92aWRlci5mb3JFbnRpdHkgYXMgc3RyaW5nKVxuICAgICAgICApXG4gICAgICApKTtcblxuICAgIGNvbnN0IHJlc3VsdHM6IHtcbiAgICAgIGVycm9yPzogc3RyaW5nO1xuICAgICAgc3VjY2VzczogYm9vbGVhbjtcbiAgICAgIG1lc3NhZ2U/OiBzdHJpbmc7XG5cbiAgICAgIGVudGl0eU5hbWU6IHN0cmluZztcbiAgICAgIGluZGV4TmFtZT86IHN0cmluZztcbiAgICAgIGluZGV4Q29uZmlnPzogYW55O1xuICAgIH1bXSA9IFtdO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZW50aXR5UHJvdmlkZXJzLm1hcChhc3luYyAocHJvdmlkZXIpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSBwcm92aWRlci5fcHJvdmlkZXIuZm9yRW50aXR5IGFzIHN0cmluZztcblxuICAgICAgdHJ5IHtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlID0gcHJvdmlkZXIuX2NvbnRhaW5lci5yZXNvbHZlPEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KFxuICAgICAgICAgIHByb3ZpZGVyLl9wcm92aWRlci5wcm92aWRlXG4gICAgICAgICk7XG4gICAgICAgIGlmICghc2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRW50aXR5U2VydmljZSBjb3VsZCBub3QgYmUgcmVzb2x2ZWQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiBzZWFyY2ggaXMgZW5hYmxlZCBiZWZvcmUgYXR0ZW1wdGluZyB0byBpbml0aWFsaXplXG4gICAgICAgIGlmICghc2VydmljZS5pc1NlYXJjaEVuYWJsZWQoKSkge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICBtZXNzYWdlOiBgU2VhcmNoIGlzIG5vdCBlbmFibGVkIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWAsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXNlYXJjaFNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuaW5pdFNlYXJjaEluZGV4KCk7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcblxuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgICAgIGluZGV4Q29uZmlnOiBjb25maWcsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBtZXNzYWdlOiBgSW5kZXggJHtjb25maWcuaW5kZXhOYW1lfSBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHlgLFxuICAgICAgICB9KTtcblxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgZXJyb3I6IGVycm9yLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIG1lc3NhZ2U6IGBFcnJvciBpbml0aWFsaXppbmcgaW5kZXggZm9yIGVudGl0eSAke2VudGl0eU5hbWV9OiAke2Vycm9yLm1lc3NhZ2V9YCxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHsgcmVzdWx0cyB9KTtcbiAgfVxuXG4gIEBHZXQoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9zZXR0aW5ncycpXG4gIGFzeW5jIGdldEluZGV4U2V0dGluZ3MoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3Qgc2V0dGluZ3MgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEluZGV4U2V0dGluZ3MoKTtcbiAgICByZXR1cm4gcmVzLmpzb24oeyBzZXR0aW5ncyB9KTtcbiAgfVxuXG4gIEBQdXQoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9zZXR0aW5ncycsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBzZXR0aW5nczogeyBkYXRhdHlwZTogJ29iamVjdCcsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIHVwZGF0ZUluZGV4U2V0dGluZ3MoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IHNldHRpbmdzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+OyB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuICAgIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHJlcS5ib2R5IHx8IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNlYXJjaFNlcnZpY2UudXBkYXRlSW5kZXhTZXR0aW5ncyhzZXR0aW5ncywgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgcmVzdWx0LFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBtZXNzYWdlOiAnSW5kZXggc2V0dGluZ3MgdXBkYXRlZCBzdWNjZXNzZnVsbHknLFxuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9yZXNldC1zZXR0aW5ncycpXG4gIGFzeW5jIHJlc2V0SW5kZXhTZXR0aW5ncyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLnJlc2V0SW5kZXhTZXR0aW5ncygpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgbWVzc2FnZTogJ0luZGV4IHNldHRpbmdzIHJlc2V0IHRvIGNvZGUgY29uZmlndXJhdGlvbidcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vaW5pdCcpXG4gIGFzeW5jIGluaXRTaW5nbGVFbnRpdHlJbmRleChcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgaWYgKCFlbnRpdHlTZXJ2aWNlLmlzU2VhcmNoRW5hYmxlZCgpKSB7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oe1xuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgbWVzc2FnZTogYFNlYXJjaCBpcyBub3QgZW5hYmxlZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuaW5pdFNlYXJjaEluZGV4KCk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgY29uZmlnLFxuICAgICAgbWVzc2FnZTogYEluZGV4ICR7Y29uZmlnLmluZGV4TmFtZX0gaW5pdGlhbGl6ZWQgc3VjY2Vzc2Z1bGx5YCxcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vcmVjcmVhdGUnKVxuICBhc3luYyByZWNyZWF0ZUluZGV4KFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keToge1xuICAgICAgICByZXN5bmNEb2N1bWVudHM/OiBib29sZWFuO1xuICAgICAgICBzeW5jTWV0aG9kPzogJ2RpcmVjdCcgfCAncXVldWUnO1xuICAgICAgICBiYXRjaFNpemU/OiBudW1iZXI7XG4gICAgICAgIHF1ZXVlVXJsPzogc3RyaW5nO1xuICAgICAgfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG4gICAgY29uc3QgeyBcbiAgICAgIHJlc3luY0RvY3VtZW50cyA9IGZhbHNlLCBcbiAgICAgIHN5bmNNZXRob2QgPSAnZGlyZWN0JyxcbiAgICAgIGJhdGNoU2l6ZSA9IDUwLFxuICAgICAgcXVldWVVcmwgXG4gICAgfSA9IHJlcS5ib2R5IHx8IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IG9sZENvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZWNyZWF0aW5nIGluZGV4IGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWAsIHsgb2xkQ29uZmlnIH0pO1xuXG4gICAgLy8gRGVsZXRlIGV4aXN0aW5nIGluZGV4XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhgRGVsZXRpbmcgZXhpc3RpbmcgaW5kZXg6ICR7b2xkQ29uZmlnLmluZGV4TmFtZX1gKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc2VhcmNoU2VydmljZS5kZWxldGVTZWFyY2hJbmRleCh0cnVlKTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKGBDb3VsZCBub3QgZGVsZXRlIGluZGV4IChtaWdodCBub3QgZXhpc3QpOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuXG4gICAgLy8gUmVpbml0aWFsaXplIGluZGV4IHdpdGggbmV3IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZWluaXRpYWxpemluZyBpbmRleCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmluaXRTZWFyY2hJbmRleCgpO1xuICAgIGNvbnN0IG5ld0NvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcblxuICAgIGxldCByZXN5bmNSZXN1bHQgPSBudWxsO1xuXG4gICAgLy8gT3B0aW9uYWxseSByZXN5bmMgYWxsIGRvY3VtZW50c1xuICAgIGlmIChyZXN5bmNEb2N1bWVudHMpIHtcbiAgICAgIGlmIChzeW5jTWV0aG9kID09PSAncXVldWUnKSB7XG4gICAgICAgIC8vIFF1ZXVlLWJhc2VkIHN5bmMgKG5vbi1ibG9ja2luZywgZm9yIGxhcmdlIGRhdGFzZXRzKVxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBRdWV1ZWluZyBkb2N1bWVudHMgZm9yIHJlc3luYzogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICByZXN5bmNSZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXVlRG9jdW1lbnRzRm9yUmVzeW5jKGVudGl0eU5hbWUsIHsgYmF0Y2hTaXplLCBxdWV1ZVVybCB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIERpcmVjdCBzeW5jIChibG9ja2luZywgaW1tZWRpYXRlIGNvbmZpcm1hdGlvbilcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgRGlyZWN0bHkgcmVzeW5jaW5nIGRvY3VtZW50czogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICByZXN5bmNSZXN1bHQgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLnJlc3luY0FsbERvY3VtZW50cyh7IGJhdGNoU2l6ZSB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBvbGRJbmRleE5hbWU6IG9sZENvbmZpZy5pbmRleE5hbWUsXG4gICAgICBuZXdJbmRleE5hbWU6IG5ld0NvbmZpZy5pbmRleE5hbWUsXG4gICAgICBzeW5jTWV0aG9kOiByZXN5bmNEb2N1bWVudHMgPyBzeW5jTWV0aG9kIDogbnVsbCxcbiAgICAgIG1lc3NhZ2U6IGBJbmRleCByZWNyZWF0ZWQgc3VjY2Vzc2Z1bGx5JHtyZXN5bmNEb2N1bWVudHMgPyBgICgke3N5bmNNZXRob2R9IHN5bmM6ICR7cmVzeW5jUmVzdWx0Py5wcm9jZXNzZWRDb3VudCB8fCAwfSBkb2N1bWVudHMpYCA6ICcnfWAsXG4gICAgICByZXN5bmNSZXN1bHQsXG4gICAgICBjb25maWdzOiB7IG9sZENvbmZpZywgbmV3Q29uZmlnIH1cbiAgICB9KTtcbiAgfVxuXG4gIEBEZWxldGUoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfScpXG4gIGFzeW5jIGRlbGV0ZUluZGV4KFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZGVsZXRlU2VhcmNoSW5kZXgodHJ1ZSk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgbWVzc2FnZTogJ0luZGV4IGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5J1xuICAgIH0pO1xuICB9XG5cbiAgQERlbGV0ZSgnL2luZGljZXMve2VudGl0eU5hbWV9L2RvY3VtZW50cycpXG4gIGFzeW5jIGNsZWFyRW50aXR5SW5kZXgoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpLmRlbGV0ZUFsbERvY3VtZW50cyhjb25maWcuaW5kZXhOYW1lISwgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICBtZXNzYWdlOiAnQWxsIGRvY3VtZW50cyBjbGVhcmVkIGZyb20gaW5kZXgnXG4gICAgfSk7XG4gIH1cblxuICBAUG9zdCgnL2luZGljZXMve2VudGl0eU5hbWV9L3Jlc3luYycpXG4gIGFzeW5jIHJlc3luY0VudGl0eVJlY29yZHMoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IGJhdGNoU2l6ZT86IG51bWJlcjsgcXVldWVVcmw/OiBzdHJpbmc7IGJ5QmF0Y2g/OiBib29sZWFuIH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuICAgIGNvbnN0IHsgYmF0Y2hTaXplID0gNTAsIHF1ZXVlVXJsLCBieUJhdGNoID0gdHJ1ZSB9ID0gcmVxLmJvZHkgfHwge307XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnF1ZXVlRG9jdW1lbnRzRm9yUmVzeW5jKGVudGl0eU5hbWUsIHsgYmF0Y2hTaXplLCBxdWV1ZVVybCwgYnlCYXRjaCB9KTtcblxuICAgIGxldCBtZXNzYWdlID0gYFF1ZXVlZCAke3Jlc3VsdC5wcm9jZXNzZWRDb3VudH0gcmVjb3JkcyBmb3IgcmUtaW5kZXhpbmdgO1xuICAgIGlmIChyZXN1bHQuZmFpbGVkQ291bnQgPiAwKSB7XG4gICAgICBtZXNzYWdlICs9IGAsICR7cmVzdWx0LmZhaWxlZENvdW50fSByZWNvcmRzIGZhaWxlZCB0byBiZSBxdWV1ZWRgO1xuICAgIH1cblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBtZXNzYWdlLFxuICAgICAgc3VjY2VzczogcmVzdWx0LnByb2Nlc3NlZENvdW50ID4gMCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICAuLi5yZXN1bHQsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUXVldWUgZG9jdW1lbnRzIGZvciBhc3luYyByZXN5bmMgdmlhIFNRU1xuICAgKiBTaGFyZWQgbG9naWMgdXNlZCBieSByZXN5bmMgYW5kIHJlY3JlYXRlIGVuZHBvaW50c1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBxdWV1ZURvY3VtZW50c0ZvclJlc3luYyhcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgb3B0aW9uczoge1xuICAgICAgYmF0Y2hTaXplPzogbnVtYmVyO1xuICAgICAgcXVldWVVcmw/OiBzdHJpbmc7XG4gICAgICBieUJhdGNoPzogYm9vbGVhbjtcbiAgICB9XG4gICk6IFByb21pc2U8e1xuICAgIHByb2Nlc3NlZENvdW50OiBudW1iZXI7XG4gICAgZmFpbGVkQ291bnQ6IG51bWJlcjtcbiAgICB0b3RhbEl0ZXJhdGlvbnM6IG51bWJlcjtcbiAgfT4ge1xuICAgIGNvbnN0IHsgYmF0Y2hTaXplID0gNTAsIHF1ZXVlVXJsLCBieUJhdGNoID0gdHJ1ZSB9ID0gb3B0aW9ucztcbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgLy8gVXNlIHByb3ZpZGVkIHF1ZXVlVXJsIG9yIHJlc29sdmUgZnJvbSBlbnZpcm9ubWVudFxuICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FIH0pO1xuICAgIGNvbnN0IHJlc29sdmVkUXVldWVVcmwgPSBxdWV1ZVVybCB8fCBFbnZpcm9ubWVudC5xdWV1ZVVybChxdWV1ZU5hbWUpO1xuXG4gICAgaWYgKCFyZXNvbHZlZFF1ZXVlVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXVlIFVSTCBub3QgcHJvdmlkZWQgYW5kIGVudi1rZXkgWyR7U0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FfV0gaXMgbm90IGNvbmZpZ3VyZWRgKTtcbiAgICB9XG5cbiAgICBsZXQgZmFpbGVkQ291bnQgPSAwO1xuICAgIGxldCBwcm9jZXNzZWRDb3VudCA9IDA7XG4gICAgbGV0IGN1cnNvcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gJ2luaXQnO1xuICAgIGxldCBpdGVyYXRpb25Db3VudCA9IDA7XG4gICAgY29uc3QgbWF4SXRlcmF0aW9ucyA9IDEwMDAwMDtcblxuICAgIHdoaWxlICghIWN1cnNvciAmJiBpdGVyYXRpb25Db3VudCA8IG1heEl0ZXJhdGlvbnMpIHtcbiAgICAgIGl0ZXJhdGlvbkNvdW50Kys7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZldGNoaW5nICR7ZW50aXR5TmFtZX0gcmVjb3JkcyBmcm9tIGN1cnNvcjogJHtjdXJzb3J9YCk7XG5cbiAgICAgIGNvbnN0IHF1ZXJ5UmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5xdWVyeSh7XG4gICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICBsaW1pdDogYmF0Y2hTaXplLFxuICAgICAgICAgIGN1cnNvcjogY3Vyc29yID09PSAnaW5pdCcgPyB1bmRlZmluZWQgOiBjdXJzb3JcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGlmICghcXVlcnlSZXN1bHQuZGF0YSB8fCBxdWVyeVJlc3VsdC5kYXRhLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgaWYgKGJ5QmF0Y2gpIHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IFByb21pc2UuYWxsKHF1ZXJ5UmVzdWx0LmRhdGEubWFwKGFzeW5jIChyZWMpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgZW50aXR5U2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKHJlYyk7XG4gICAgICAgIH0pKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHNlbmRRdWV1ZU1lc3NhZ2UocmVzb2x2ZWRRdWV1ZVVybCwge1xuICAgICAgICAgICAgZGF0YSxcbiAgICAgICAgICAgIGV2ZW50TmFtZTogXCJSRVNZTkNcIixcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcHJvY2Vzc2VkQ291bnQgKz0gZGF0YS5sZW5ndGg7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcXVldWVpbmcgYmF0Y2ggZm9yIHN5bmM6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGVudGl0eU5hbWUsIGJhdGNoU2l6ZSwgZXJyb3IgfSk7XG4gICAgICAgICAgZmFpbGVkQ291bnQgKz0gZGF0YS5sZW5ndGg7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICAgIHF1ZXJ5UmVzdWx0LmRhdGEubWFwKGFzeW5jIChlbnRpdHlSZWNvcmQpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGNvbnN0IHRyYW5zZm9ybWVkID0gYXdhaXQgZW50aXR5U2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eVJlY29yZCk7XG4gICAgICAgICAgICAgIGF3YWl0IHNlbmRRdWV1ZU1lc3NhZ2UocmVzb2x2ZWRRdWV1ZVVybCwge1xuICAgICAgICAgICAgICAgIGRhdGE6IHRyYW5zZm9ybWVkLFxuICAgICAgICAgICAgICAgIGV2ZW50TmFtZTogXCJSRVNZTkNcIixcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgcHJvY2Vzc2VkQ291bnQrKztcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIHF1ZXVlaW5nIHJlY29yZCBmb3Igc3luYzogJHtlcnJvci5tZXNzYWdlfWAsIHsgZW50aXR5TmFtZSwgZXJyb3IgfSk7XG4gICAgICAgICAgICAgIGZhaWxlZENvdW50Kys7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY3Vyc29yID0gcXVlcnlSZXN1bHQuY3Vyc29yID8/IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBRdWV1ZSBzeW5jIGNvbXBsZXRlZCBmb3IgJHtlbnRpdHlOYW1lfWAsIHtcbiAgICAgIHByb2Nlc3NlZENvdW50LFxuICAgICAgZmFpbGVkQ291bnQsXG4gICAgICB0b3RhbEl0ZXJhdGlvbnM6IGl0ZXJhdGlvbkNvdW50XG4gICAgfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgcHJvY2Vzc2VkQ291bnQsXG4gICAgICBmYWlsZWRDb3VudCxcbiAgICAgIHRvdGFsSXRlcmF0aW9uczogaXRlcmF0aW9uQ291bnQsXG4gICAgfTtcbiAgfVxuXG4gIEBHZXQoJy9xdWV1ZS1pbmZvJylcbiAgYXN5bmMgZ2V0UXVldWVJbmZvKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgcXVldWVVcmw6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IHF1ZXVlVXJsIH0gPSByZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzO1xuXG4gICAgLy8gVXNlIHByb3ZpZGVkIHF1ZXVlVXJsIG9yIHJlc29sdmUgZnJvbSBlbnZpcm9ubWVudFxuICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FIH0pO1xuICAgIGNvbnN0IHJlc29sdmVkUXVldWVVcmwgPSBxdWV1ZVVybCB8fCBFbnZpcm9ubWVudC5xdWV1ZVVybChxdWV1ZU5hbWUpO1xuXG4gICAgY29uc3QgaW5mbyA9IGF3YWl0IGdldFF1ZXVlTWVzc2FnZU1ldGFkYXRhKHJlc29sdmVkUXVldWVVcmwpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHsgaW5mbyB9KTtcbiAgfVxuXG4gIEBQdXQoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfScsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBkb2N1bWVudHM6IHsgZGF0YXR5cGU6ICdhcnJheScsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIHVwZGF0ZURvY3VtZW50cyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgZG9jdW1lbnRzOiBhbnlbXSB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCB7IGRvY3VtZW50cyB9ID0gcmVxLmJvZHk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLnVwZGF0ZURvY3VtZW50cyhkb2N1bWVudHMsIHRydWUpO1xuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICByZXN1bHQsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIG1lc3NhZ2U6ICdEb2N1bWVudHMgdXBkYXRlZCBzdWNjZXNzZnVsbHknLFxuICAgIH0pO1xuICB9XG5cbiAgQERlbGV0ZSgnL3JlY29yZHMve2VudGl0eU5hbWV9L2J5LWlkcycsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBpZHM6IHsgZGF0YXR5cGU6ICdhcnJheScsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIGRlbGV0ZURvY3VtZW50c0J5SWRzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBpZHM6IHN0cmluZ1tdIH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHsgaWRzIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpLmRlbGV0ZURvY3VtZW50cyhpZHMsIGNvbmZpZy5pbmRleE5hbWUhLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdEb2N1bWVudHMgZGVsZXRlZCBzdWNjZXNzZnVsbHknXG4gICAgfSk7XG4gIH1cblxuICBARGVsZXRlKCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0vYnktZmlsdGVyJywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIGZpbHRlcjogeyBkYXRhdHlwZTogJ29iamVjdCcsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIGRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBmaWx0ZXI6IGFueSB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCB7IGZpbHRlciB9ID0gcmVxLmJvZHk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKGZpbHRlciwgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICBtZXNzYWdlOiAnRG9jdW1lbnRzIG1hdGNoaW5nIGZpbHRlciBoYXZlIGJlZW4gcXVldWVkIGZvciBkZWxldGlvbi4nXG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBwcm92aWRlciA9IHRoaXMuY29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWUsXG4gICAgICBmb3JFbnRpdHk6IGVudGl0eU5hbWUsXG4gICAgfSk7XG5cbiAgICBpZiAocHJvdmlkZXIubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHByb3ZpZGVyIGZvdW5kIGZvciBlbnRpdHktc2VydmljZSBmb3IgJHtlbnRpdHlOYW1lfWApO1xuICAgIH1cblxuICAgIHJldHVybiBwcm92aWRlclsgMCBdLl9jb250YWluZXIucmVzb2x2ZTxCYXNlRW50aXR5U2VydmljZTxhbnk+Pihwcm92aWRlclsgMCBdLl9wcm92aWRlci5wcm92aWRlKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IGVudGl0eVNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpO1xuXG4gICAgaWYgKCFzZWFyY2hTZXJ2aWNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VhcmNoU2VydmljZTtcbiAgfVxufSJdfQ==