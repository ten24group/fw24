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
        const entityService = this.getEntityService(entityName);
        // Use provided queueUrl or resolve from environment
        const queueName = (0, utils_1.resolveEnvValueFor)({ key: SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME });
        const resolvedQueueUrl = queueUrl || client_1.Environment.queueUrl(queueName);
        if (!resolvedQueueUrl) {
            throw new Error(`Queue URL not provided and env-key [${SEARCH_CONTROLLER_ENV_KEYS.MEILISEARCH_SYNC_QUEUE_NAME}] is not configured`);
        }
        // Get all entity records in batches and queue them for sync
        let failedCount = 0;
        let processedCount = 0;
        let cursor = 'init';
        let iterationCount = 0;
        const maxIterations = 10000; // Safety limit to prevent infinite loops
        while (!!cursor) {
            this.logger.info(`Fetching ${entityName} records from cursor: ${cursor}`);
            const queryResult = await entityService.query({
                pagination: {
                    limit: batchSize,
                    cursor: cursor === 'init' ? undefined : cursor
                }
            });
            if (byBatch) {
                const data = await Promise.all([...(queryResult.data ?? [])].map(async (rec) => {
                    const transformed = await entityService.transformDocumentForIndexing(rec);
                    return transformed;
                }));
                try {
                    if (data.length === 0) {
                        this.logger.info(`No records to queue for sync: ${entityName}`, { byBatch, entityName, batchSize, queueUrl });
                        break;
                    }
                    await (0, sqs_1.sendQueueMessage)(resolvedQueueUrl, {
                        data,
                        eventName: "RESYNC",
                        entityName,
                    });
                    processedCount += data.length;
                }
                catch (error) {
                    this.logger.error(`Error queueing record for sync: ${error.message}`, { byBatch, entityName, batchSize, queueUrl, error });
                    failedCount += data.length;
                }
            }
            else {
                await Promise.all((queryResult.data ?? []).map(async (entityRecord) => {
                    const transformed = await entityService.transformDocumentForIndexing(entityRecord);
                    try {
                        await (0, sqs_1.sendQueueMessage)(resolvedQueueUrl, {
                            data: transformed,
                            eventName: "RESYNC",
                            entityName,
                        });
                        processedCount++;
                    }
                    catch (error) {
                        this.logger.error(`Error queueing record for sync: ${error.message}`, { byBatch, entityName, batchSize, queueUrl, error });
                        failedCount++;
                    }
                }));
            }
            cursor = queryResult.cursor ?? undefined;
        }
        let message = `Queued ${processedCount} records for re-indexing`;
        if (failedCount > 0) {
            message += `, ${failedCount} records failed to be queued`;
        }
        return res.json({
            message,
            success: processedCount > 0,
            entityName,
            failedCount,
            processedCount,
        });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9zZWFyY2gtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFFQSwwQ0FBNkU7QUFDN0Usc0ZBQTBFO0FBRTFFLGlEQUFzRTtBQUN0RSxpQ0FBMkM7QUFHM0MsdUNBQTJEO0FBQzNELGtEQUFtRDtBQUNuRCx5Q0FBMkM7QUFFM0MsSUFBWSwwQkFFWDtBQUZELFdBQVksMEJBQTBCO0lBQ3BDLHlGQUEyRCxDQUFBO0FBQzdELENBQUMsRUFGVywwQkFBMEIsMENBQTFCLDBCQUEwQixRQUVyQztBQU9NLElBQU0sc0JBQXNCLEdBQTVCLE1BQU0sc0JBQXVCLFNBQVEsc0NBQWE7SUFDZDtJQUF6QyxZQUF5QyxTQUF1QjtRQUM5RCxLQUFLLEVBQUUsQ0FBQztRQUQrQixjQUFTLEdBQVQsU0FBUyxDQUFjO0lBRWhFLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQTRCLEVBQUUsUUFBaUIsSUFBSSxDQUFDO0lBRy9ELEFBQU4sS0FBSyxDQUFDLFdBQVcsQ0FBQyxRQUFpQixFQUFFLFFBQWtCO1FBQ3JELDZDQUE2QztRQUM3QyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDO1lBQzdELElBQUksRUFBRSxTQUFTO1lBQ2YsK0JBQStCLEVBQUUsSUFBSTtTQUN0QyxDQUFDO2FBQ0MsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFO1lBQ1YsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUE7UUFDaEMsQ0FBQyxDQUFDLENBQUM7UUFFTCxNQUFNLFdBQVcsR0FBVSxFQUFFLENBQUM7UUFFOUIsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLFFBQVEsRUFBRSxFQUFFO1lB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QUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFO2FBQzNDO1NBQ0Y7S0FDRixDQUFDO2tFQW9CRDtBQVNLO0lBUEwsSUFBQSxtQkFBTSxFQUFDLGlDQUFpQyxFQUFFO1FBQ3pDLFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRTtnQkFDSixNQUFNLEVBQUUsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUU7YUFDL0M7U0FDRjtLQUNGLENBQUM7cUVBcUJEO2lDQXRtQlUsc0JBQXNCO0lBTGxDLElBQUEsdUJBQVUsRUFBQyxlQUFlLEVBQUU7UUFDM0IsR0FBRyxFQUFFLENBQUU7Z0JBQ0wsSUFBSSxFQUFFLDBCQUEwQixDQUFDLDJCQUEyQjthQUM3RCxDQUFFO0tBQ0osQ0FBQztJQUVhLFdBQUEsSUFBQSxvQkFBZSxHQUFFLENBQUE7R0FEbkIsc0JBQXNCLENBZ29CbEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcblxuaW1wb3J0IHsgZ2V0UXVldWVNZXNzYWdlTWV0YWRhdGEsIHNlbmRRdWV1ZU1lc3NhZ2UgfSBmcm9tIFwiLi4vLi4vY2xpZW50L3Nxc1wiO1xuaW1wb3J0IHsgQVBJQ29udHJvbGxlciB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9hcGktZ2F0ZXdheS1jb250cm9sbGVyJztcbmltcG9ydCB0eXBlIHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gXCIuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0XCI7XG5pbXBvcnQgeyBDb250cm9sbGVyLCBEZWxldGUsIEdldCwgUG9zdCwgUHV0IH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycyc7XG5pbXBvcnQgeyBJbmplY3RDb250YWluZXIgfSBmcm9tICcuLi8uLi9kaSc7XG5pbXBvcnQgeyB0eXBlIEJhc2VFbnRpdHlTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vZW50aXR5JztcbmltcG9ydCB7IHR5cGUgSURJQ29udGFpbmVyLCB0eXBlIFJlcXVlc3QsIHR5cGUgUmVzcG9uc2UgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IGRlZXBDb3B5LCByZXNvbHZlRW52VmFsdWVGb3IgfSBmcm9tICcuLi8uLi91dGlscyc7XG5pbXBvcnQgeyBwYXJzZVNlYXJjaFF1ZXJ5IH0gZnJvbSBcIi4uL3NlYXJjaC11dGlsc1wiO1xuaW1wb3J0IHsgRW52aXJvbm1lbnQgfSBmcm9tIFwiLi4vLi4vY2xpZW50XCI7XG5cbmV4cG9ydCBlbnVtIFNFQVJDSF9DT05UUk9MTEVSX0VOVl9LRVlTIHtcbiAgTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FID0gJ01FSUxJU0VBUkNIX1NZTkNfUVVFVUVfTkFNRScsXG59XG5cbkBDb250cm9sbGVyKCdzeXN0ZW0vc2VhcmNoJywge1xuICBlbnY6IFsge1xuICAgIG5hbWU6IFNFQVJDSF9DT05UUk9MTEVSX0VOVl9LRVlTLk1FSUxJU0VBUkNIX1NZTkNfUVVFVUVfTkFNRSxcbiAgfSBdLFxufSlcbmV4cG9ydCBjbGFzcyBTZWFyY2hTeXN0ZW1Db250cm9sbGVyIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG4gIGNvbnN0cnVjdG9yKEBJbmplY3RDb250YWluZXIoKSBwcm90ZWN0ZWQgY29udGFpbmVyOiBJRElDb250YWluZXIpIHtcbiAgICBzdXBlcigpO1xuICB9XG5cbiAgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBfY29udGV4dDogQ29udGV4dCkgeyB9XG5cbiAgQEdldCgnL2luZGljZXMnKVxuICBhc3luYyBsaXN0SW5kaWNlcyhfcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlKSB7XG4gICAgLy8gQXV0by1kaXNjb3ZlciBlbnRpdGllcyB3aXRoIHNlYXJjaCBlbmFibGVkXG4gICAgY29uc3QgZW50aXR5UHJvdmlkZXJzID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICB9KVxuICAgICAgLmZpbHRlcihwID0+IHtcbiAgICAgICAgcmV0dXJuICEhcC5fcHJvdmlkZXIuZm9yRW50aXR5XG4gICAgICB9KTtcblxuICAgIGNvbnN0IGluZGljZXNEYXRhOiBhbnlbXSA9IFtdO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZW50aXR5UHJvdmlkZXJzLm1hcChhc3luYyAocHJvdmlkZXIpID0+IHtcblxuICAgICAgY29uc3QgZW50aXR5TmFtZSA9IHByb3ZpZGVyLl9wcm92aWRlci5mb3JFbnRpdHkgYXMgc3RyaW5nO1xuXG4gICAgICB0cnkge1xuXG4gICAgICAgIC8vIHVzZSBwcm92aWRlcidzIGNvbnRhaW5lciAgdG8gcmVzb2x2ZSB0aGUgc2VydmljZVxuICAgICAgICBjb25zdCBzZXJ2aWNlID0gcHJvdmlkZXIuX2NvbnRhaW5lci5yZXNvbHZlPEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KFxuICAgICAgICAgIHByb3ZpZGVyLl9wcm92aWRlci5wcm92aWRlXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKCFzZXJ2aWNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZXJ2aWNlICR7U3RyaW5nKHByb3ZpZGVyLl9wcm92aWRlci5wcm92aWRlKX0gbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXNlYXJjaFNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGluZGV4SW5mbyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0SW5kZXhJbmZvKCk7XG5cbiAgICAgICAgaW5kaWNlc0RhdGEucHVzaCh7XG4gICAgICAgICAgLi4uaW5kZXhJbmZvLFxuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgaW5kZXhOYW1lOiBpbmRleEluZm8udWlkLFxuICAgICAgICB9KTtcblxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuXG4gICAgICAgIGluZGljZXNEYXRhLnB1c2goe1xuICAgICAgICAgIGluZGV4TmFtZTogYFske2VudGl0eU5hbWV9XS1pbmRleC1uYW1lLW5vdC1yZXNvbHZlZGAsXG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoZXJyb3IpO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIHJldHVybiByZXNwb25zZS5qc29uKHsgaW5kaWNlczogaW5kaWNlc0RhdGEgfSk7XG4gIH1cblxuICAvKipcbiAgICogQWRkIG5ldyBhcGkgdG8gZ2V0IGluZGV4IGRldGFpbHNcbiAgICogXG4gICAqL1xuXG4gIEBHZXQoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfScsIHt9KVxuICBhc3luYyBnZXRJbmRleERldGFpbHMoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IGluZGV4SW5mbyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0SW5kZXhJbmZvKCk7XG4gICAgY29uc3QgaW5kZXhTdGF0cyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0SW5kZXhTdGF0cygpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIGRldGFpbHM6IHtcbiAgICAgICAgaW5kZXhJbmZvLFxuICAgICAgICBpbmRleFN0YXRzLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgQEdldCgnL2VudGl0aWVzJylcbiAgYXN5bmMgZ2V0U2VhcmNoRW50aXRpZXMoX3JlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IGVudGl0eVByb3ZpZGVycyA9IHRoaXMuY29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWUsXG4gICAgfSlcbiAgICAgIC5maWx0ZXIocCA9PiAhIXAuX3Byb3ZpZGVyLmZvckVudGl0eSk7XG5cbiAgICBjb25zdCBlbnRpdGllc0RhdGE6IHtcbiAgICAgIGVudGl0eU5hbWU6IHN0cmluZztcbiAgICAgIHNlYXJjaEVuYWJsZWQ6IGJvb2xlYW47XG4gICAgICBpbmRleEV4aXN0cz86IGJvb2xlYW47XG4gICAgICBpbmRleE5hbWU/OiBzdHJpbmc7XG4gICAgICBlcnJvcj86IHN0cmluZztcbiAgICB9W10gPSBbXTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKGVudGl0eVByb3ZpZGVycy5tYXAoYXN5bmMgKHByb3ZpZGVyKSA9PiB7XG4gICAgICBjb25zdCBlbnRpdHlOYW1lID0gcHJvdmlkZXIuX3Byb3ZpZGVyLmZvckVudGl0eSBhcyBzdHJpbmc7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNlcnZpY2UgPSBwcm92aWRlci5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oXG4gICAgICAgICAgcHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGVcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAoIXNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoRW5hYmxlZCA9IHNlcnZpY2UuaXNTZWFyY2hFbmFibGVkKCk7XG4gICAgICAgIGxldCBpbmRleEV4aXN0cyA9IGZhbHNlO1xuICAgICAgICBsZXQgaW5kZXhOYW1lID0gJyc7XG5cbiAgICAgICAgaWYgKHNlYXJjaEVuYWJsZWQpIHtcbiAgICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gc2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgICAgaWYgKHNlYXJjaFNlcnZpY2UpIHtcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICAgICAgICAgIGluZGV4TmFtZSA9IGNvbmZpZy5pbmRleE5hbWUhO1xuICAgICAgICAgICAgaW5kZXhFeGlzdHMgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpLmluZGV4RXhpc3RzKGluZGV4TmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZW50aXRpZXNEYXRhLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgc2VhcmNoRW5hYmxlZCxcbiAgICAgICAgICBpbmRleEV4aXN0cyxcbiAgICAgICAgICBpbmRleE5hbWUsXG4gICAgICAgIH0pO1xuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIGVudGl0aWVzRGF0YS5wdXNoKHtcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIHNlYXJjaEVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KSk7XG5cbiAgICByZXR1cm4gcmVzcG9uc2UuanNvbih7IGVudGl0aWVzOiBlbnRpdGllc0RhdGEgfSk7XG4gIH1cblxuICBAR2V0KCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0ve2RvY3VtZW50SWR9JylcbiAgYXN5bmMgZ2V0U2luZ2xlRG9jdW1lbnQoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcsIGRvY3VtZW50SWQ6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBkb2N1bWVudElkIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgZW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHByaW1hcnlJZEZpZWxkTmFtZSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5UHJpbWFyeUlkUHJvcGVydHlOYW1lKCk7XG4gICAgXG4gICAgY29uc3QgZG9jID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXREb2N1bWVudChkb2N1bWVudElkKTtcblxuICAgIGRvY1sgJ2lkJyBdID0gZG9jWyAnaWQnIF0gfHwgZG9jWyBwcmltYXJ5SWRGaWVsZE5hbWUgYXMgc3RyaW5nIF07XG4gICAgZG9jWyAnZnVsbFJlY29yZCcgXSA9IHsgLi4uZG9jIH07XG4gICAgZG9jWyAnZW50aXR5TmFtZScgXSA9IGVudGl0eU5hbWU7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oZG9jKTtcbiAgfVxuXG4gIEBHZXQoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfScpXG4gIGFzeW5jIGdldEVudGl0eVJlY29yZHMoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZSxcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0XG4gICkge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHF1ZXJ5ID0gZGVlcENvcHkocmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyk7XG5cbiAgICBjb25zdCBwYXJzZWRRdWVyeSA9IHBhcnNlU2VhcmNoUXVlcnkocXVlcnkpO1xuICAgIGNvbnN0IHsgc2VsZWN0OiBfc2VsZWN0LCAuLi5yZXN0UXVlcnlQYXJhbXMgfSA9IHBhcnNlZFF1ZXJ5O1xuXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IGVudGl0eVNlcnZpY2Uuc2VhcmNoKHJlc3RRdWVyeVBhcmFtcywgY3R4KTtcblxuICAgIGNvbnN0IHsgaGl0cywgLi4ucmVzdCB9ID0gcmVzdWx0cztcbiAgICBcbiAgICAvLyBHZXQgdGhlIGVudGl0eSdzIHByaW1hcnkgaWRlbnRpZmllciBmaWVsZCBuYW1lXG4gICAgY29uc3QgcHJpbWFyeUlkRmllbGROYW1lID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcbiAgICBcbiAgICAvLyBFbnN1cmUgYWxsIHJlY29yZHMgaGF2ZSBhIGNvbnNpc3RlbnQgJ2lkJyBmaWVsZCBmb3IgZ2VuZXJpYyBVSSBsaXN0aW5nXG4gICAgY29uc3Qgbm9ybWFsaXplZEhpdHMgPSBoaXRzLm1hcCgoaGl0OiBhbnkpID0+IHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRIaXQgPSB7IC4uLmhpdCB9O1xuXG4gICAgICBub3JtYWxpemVkSGl0WyAnZW50aXR5TmFtZScgXSA9IGVudGl0eU5hbWU7XG4gICAgICBub3JtYWxpemVkSGl0WyAnZnVsbFJlY29yZCcgXSA9IGhpdDtcbiAgICAgIFxuICAgICAgLy8gSWYgdGhlIHJlY29yZCBkb2Vzbid0IGhhdmUgYW4gJ2lkJyBmaWVsZCBidXQgaGFzIHRoZSBwcmltYXJ5IGlkZW50aWZpZXIgZmllbGQsXG4gICAgICAvLyBtYXAgaXQgdG8gJ2lkJyBmb3IgY29uc2lzdGVudCBnZW5lcmljIGxpc3RpbmdcbiAgICAgIGlmICghbm9ybWFsaXplZEhpdC5pZCAmJiBwcmltYXJ5SWRGaWVsZE5hbWUgJiYgbm9ybWFsaXplZEhpdFtwcmltYXJ5SWRGaWVsZE5hbWVdKSB7XG4gICAgICAgIG5vcm1hbGl6ZWRIaXQuaWQgPSBub3JtYWxpemVkSGl0W3ByaW1hcnlJZEZpZWxkTmFtZV07XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIElmIHN0aWxsIG5vIGlkIGZpZWxkLCB0cnkgY29tbW9uIGlkZW50aWZpZXIgcGF0dGVybnNcbiAgICAgIGlmICghbm9ybWFsaXplZEhpdC5pZCkge1xuICAgICAgICBjb25zdCBpZEZpZWxkcyA9IFtgJHtlbnRpdHlOYW1lfUlkYCwgYCR7ZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpfUlkYF07XG4gICAgICAgIGZvciAoY29uc3QgaWRGaWVsZCBvZiBpZEZpZWxkcykge1xuICAgICAgICAgIGlmIChub3JtYWxpemVkSGl0W2lkRmllbGRdKSB7XG4gICAgICAgICAgICBub3JtYWxpemVkSGl0LmlkID0gbm9ybWFsaXplZEhpdFtpZEZpZWxkXTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgXG4gICAgICByZXR1cm4gbm9ybWFsaXplZEhpdDtcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3BvbnNlID0ge1xuICAgICAgLi4ucmVzdCxcbiAgICAgIGl0ZW1zOiBub3JtYWxpemVkSGl0cyxcbiAgICB9O1xuXG4gICAgaWYgKHJlcS5kZWJ1Z01vZGUpIHtcbiAgICAgIE9iamVjdC5hc3NpZ24ocmVzcG9uc2UsIHtcbiAgICAgICAgaW5wdXRRdWVyeTogcXVlcnksXG4gICAgICAgIHByb2Nlc3NpbmdUaW1lTXM6IHJlc3VsdHMucHJvY2Vzc2luZ1RpbWVNcyxcbiAgICAgICAgcHJpbWFyeUlkRmllbGROYW1lXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmpzb24ocmVzcG9uc2UpO1xuICB9XG5cbiAgQFBvc3QoJy9pbml0SW5kaWNlcycpXG4gIGFzeW5jIGluaXRTZWFyY2hJbmRpY2VzKFxuICAgIHJlcTogUmVxdWVzdDx7IGJvZHk6IHsgZW50aXRpZXM/OiBzdHJpbmdbXSB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0aWVzOiByZXF1ZXN0ZWRFbnRpdGllcyA9IFtdIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIC8vIGNvbGxlY3QgcHJvdmlkZXIgZm9yIGVudGl0eS1zZXJ2aWNlcyBmcm9tIGNvbnRhaW5lci1oaWVyYXJjaHlcbiAgICBjb25zdCBlbnRpdHlQcm92aWRlcnMgPSB0aGlzLmNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlLFxuICAgIH0pXG4gICAgICAuZmlsdGVyKHAgPT4gKFxuICAgICAgICAvLyBmaWx0ZXIgb3V0IHByb3ZpZGVycyB0aGF0IGRvIG5vdCBoYXZlIGEgZm9yRW50aXR5IHByb3BlcnR5XG4gICAgICAgICEhcC5fcHJvdmlkZXIuZm9yRW50aXR5XG4gICAgICAgICYmIChcbiAgICAgICAgICAvLyBpZiBubyBlbnRpdGllcyBhcmUgcmVxdWVzdGVkLCBpbmNsdWRlIGFsbCBlbnRpdGllc1xuICAgICAgICAgICFyZXF1ZXN0ZWRFbnRpdGllcz8ubGVuZ3RoXG4gICAgICAgICAgLy8gaWYgZW50aXRpZXMgYXJlIHJlcXVlc3RlZCwgaW5jbHVkZSBvbmx5IHRoZSByZXF1ZXN0ZWQgZW50aXRpZXNcbiAgICAgICAgICB8fCByZXF1ZXN0ZWRFbnRpdGllcy5pbmNsdWRlcyhwLl9wcm92aWRlci5mb3JFbnRpdHkgYXMgc3RyaW5nKVxuICAgICAgICApXG4gICAgICApKTtcblxuICAgIGNvbnN0IHJlc3VsdHM6IHtcbiAgICAgIGVycm9yPzogc3RyaW5nO1xuICAgICAgc3VjY2VzczogYm9vbGVhbjtcbiAgICAgIG1lc3NhZ2U/OiBzdHJpbmc7XG5cbiAgICAgIGVudGl0eU5hbWU6IHN0cmluZztcbiAgICAgIGluZGV4TmFtZT86IHN0cmluZztcbiAgICAgIGluZGV4Q29uZmlnPzogYW55O1xuICAgIH1bXSA9IFtdO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZW50aXR5UHJvdmlkZXJzLm1hcChhc3luYyAocHJvdmlkZXIpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSBwcm92aWRlci5fcHJvdmlkZXIuZm9yRW50aXR5IGFzIHN0cmluZztcblxuICAgICAgdHJ5IHtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlID0gcHJvdmlkZXIuX2NvbnRhaW5lci5yZXNvbHZlPEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KFxuICAgICAgICAgIHByb3ZpZGVyLl9wcm92aWRlci5wcm92aWRlXG4gICAgICAgICk7XG4gICAgICAgIGlmICghc2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRW50aXR5U2VydmljZSBjb3VsZCBub3QgYmUgcmVzb2x2ZWQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDaGVjayBpZiBzZWFyY2ggaXMgZW5hYmxlZCBiZWZvcmUgYXR0ZW1wdGluZyB0byBpbml0aWFsaXplXG4gICAgICAgIGlmICghc2VydmljZS5pc1NlYXJjaEVuYWJsZWQoKSkge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICBtZXNzYWdlOiBgU2VhcmNoIGlzIG5vdCBlbmFibGVkIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWAsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgICAgICBpZiAoIXNlYXJjaFNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBzZXJ2aWNlIG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuaW5pdFNlYXJjaEluZGV4KCk7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcblxuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgICAgIGluZGV4Q29uZmlnOiBjb25maWcsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBtZXNzYWdlOiBgSW5kZXggJHtjb25maWcuaW5kZXhOYW1lfSBpbml0aWFsaXplZCBzdWNjZXNzZnVsbHlgLFxuICAgICAgICB9KTtcblxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgZXJyb3I6IGVycm9yLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIG1lc3NhZ2U6IGBFcnJvciBpbml0aWFsaXppbmcgaW5kZXggZm9yIGVudGl0eSAke2VudGl0eU5hbWV9OiAke2Vycm9yLm1lc3NhZ2V9YCxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHsgcmVzdWx0cyB9KTtcbiAgfVxuXG4gIEBHZXQoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9zZXR0aW5ncycpXG4gIGFzeW5jIGdldEluZGV4U2V0dGluZ3MoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3Qgc2V0dGluZ3MgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEluZGV4U2V0dGluZ3MoKTtcbiAgICByZXR1cm4gcmVzLmpzb24oeyBzZXR0aW5ncyB9KTtcbiAgfVxuXG4gIEBQdXQoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9zZXR0aW5ncycsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBzZXR0aW5nczogeyBkYXRhdHlwZTogJ29iamVjdCcsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIHVwZGF0ZUluZGV4U2V0dGluZ3MoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IHNldHRpbmdzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+OyB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuICAgIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHJlcS5ib2R5IHx8IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNlYXJjaFNlcnZpY2UudXBkYXRlSW5kZXhTZXR0aW5ncyhzZXR0aW5ncywgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgcmVzdWx0LFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBtZXNzYWdlOiAnSW5kZXggc2V0dGluZ3MgdXBkYXRlZCBzdWNjZXNzZnVsbHknLFxuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9yZXNldC1zZXR0aW5ncycpXG4gIGFzeW5jIHJlc2V0SW5kZXhTZXR0aW5ncyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLnJlc2V0SW5kZXhTZXR0aW5ncygpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgbWVzc2FnZTogJ0luZGV4IHNldHRpbmdzIHJlc2V0IHRvIGNvZGUgY29uZmlndXJhdGlvbidcbiAgICB9KTtcbiAgfVxuXG4gIEBEZWxldGUoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfScpXG4gIGFzeW5jIGRlbGV0ZUluZGV4KFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZGVsZXRlU2VhcmNoSW5kZXgodHJ1ZSk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgbWVzc2FnZTogJ0luZGV4IGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5J1xuICAgIH0pO1xuICB9XG5cbiAgQERlbGV0ZSgnL2luZGljZXMve2VudGl0eU5hbWV9L2RvY3VtZW50cycpXG4gIGFzeW5jIGNsZWFyRW50aXR5SW5kZXgoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuXG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IHNlYXJjaFNlcnZpY2UuZ2V0U2VhcmNoSW5kZXhDb25maWcoKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpLmRlbGV0ZUFsbERvY3VtZW50cyhjb25maWcuaW5kZXhOYW1lISwgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICBtZXNzYWdlOiAnQWxsIGRvY3VtZW50cyBjbGVhcmVkIGZyb20gaW5kZXgnXG4gICAgfSk7XG4gIH1cblxuICBAUG9zdCgnL2luZGljZXMve2VudGl0eU5hbWV9L3Jlc3luYycpXG4gIGFzeW5jIHJlc3luY0VudGl0eVJlY29yZHMoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IGJhdGNoU2l6ZT86IG51bWJlcjsgcXVldWVVcmw/OiBzdHJpbmc7IGJ5QmF0Y2g/OiBib29sZWFuIH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG4gICAgY29uc3QgeyBiYXRjaFNpemUgPSA1MCwgcXVldWVVcmwsIGJ5QmF0Y2ggPSB0cnVlIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICAvLyBVc2UgcHJvdmlkZWQgcXVldWVVcmwgb3IgcmVzb2x2ZSBmcm9tIGVudmlyb25tZW50XG4gICAgY29uc3QgcXVldWVOYW1lID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBTRUFSQ0hfQ09OVFJPTExFUl9FTlZfS0VZUy5NRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUgfSk7XG4gICAgY29uc3QgcmVzb2x2ZWRRdWV1ZVVybCA9IHF1ZXVlVXJsIHx8IEVudmlyb25tZW50LnF1ZXVlVXJsKHF1ZXVlTmFtZSk7XG5cbiAgICBpZiAoIXJlc29sdmVkUXVldWVVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUXVldWUgVVJMIG5vdCBwcm92aWRlZCBhbmQgZW52LWtleSBbJHtTRUFSQ0hfQ09OVFJPTExFUl9FTlZfS0VZUy5NRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUV9XSBpcyBub3QgY29uZmlndXJlZGApO1xuICAgIH1cblxuICAgIC8vIEdldCBhbGwgZW50aXR5IHJlY29yZHMgaW4gYmF0Y2hlcyBhbmQgcXVldWUgdGhlbSBmb3Igc3luY1xuICAgIGxldCBmYWlsZWRDb3VudCA9IDA7XG4gICAgbGV0IHByb2Nlc3NlZENvdW50ID0gMDtcbiAgICBsZXQgY3Vyc29yOiBzdHJpbmcgfCB1bmRlZmluZWQgPSAnaW5pdCc7XG4gICAgbGV0IGl0ZXJhdGlvbkNvdW50ID0gMDtcbiAgICBjb25zdCBtYXhJdGVyYXRpb25zID0gMTAwMDA7IC8vIFNhZmV0eSBsaW1pdCB0byBwcmV2ZW50IGluZmluaXRlIGxvb3BzXG5cbiAgICB3aGlsZSAoISFjdXJzb3IpIHtcblxuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgRmV0Y2hpbmcgJHtlbnRpdHlOYW1lfSByZWNvcmRzIGZyb20gY3Vyc29yOiAke2N1cnNvcn1gKTtcblxuICAgICAgY29uc3QgcXVlcnlSZXN1bHQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnF1ZXJ5KHtcbiAgICAgICAgcGFnaW5hdGlvbjoge1xuICAgICAgICAgIGxpbWl0OiBiYXRjaFNpemUsXG4gICAgICAgICAgY3Vyc29yOiBjdXJzb3IgPT09ICdpbml0JyA/IHVuZGVmaW5lZCA6IGN1cnNvclxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgaWYgKGJ5QmF0Y2gpIHtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBQcm9taXNlLmFsbChbIC4uLihxdWVyeVJlc3VsdC5kYXRhID8/IFtdKSBdLm1hcChhc3luYyAocmVjKSA9PiB7XG4gICAgICAgICAgY29uc3QgdHJhbnNmb3JtZWQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcocmVjKTtcbiAgICAgICAgICByZXR1cm4gdHJhbnNmb3JtZWQ7XG4gICAgICAgIH0pKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGlmIChkYXRhLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgTm8gcmVjb3JkcyB0byBxdWV1ZSBmb3Igc3luYzogJHtlbnRpdHlOYW1lfWAsIHsgYnlCYXRjaCwgZW50aXR5TmFtZSwgYmF0Y2hTaXplLCBxdWV1ZVVybH0pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgc2VuZFF1ZXVlTWVzc2FnZShyZXNvbHZlZFF1ZXVlVXJsLCB7XG4gICAgICAgICAgICBkYXRhLFxuICAgICAgICAgICAgZXZlbnROYW1lOiBcIlJFU1lOQ1wiLFxuICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBwcm9jZXNzZWRDb3VudCArPSBkYXRhLmxlbmd0aDtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBFcnJvciBxdWV1ZWluZyByZWNvcmQgZm9yIHN5bmM6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGJ5QmF0Y2gsIGVudGl0eU5hbWUsIGJhdGNoU2l6ZSwgcXVldWVVcmwsIGVycm9yfSk7XG4gICAgICAgICAgZmFpbGVkQ291bnQgKz0gZGF0YS5sZW5ndGg7XG4gICAgICAgIH1cblxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgKHF1ZXJ5UmVzdWx0LmRhdGEgPz8gW10pLm1hcChhc3luYyAoZW50aXR5UmVjb3JkKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0cmFuc2Zvcm1lZCA9IGF3YWl0IGVudGl0eVNlcnZpY2UudHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZyhlbnRpdHlSZWNvcmQpO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgYXdhaXQgc2VuZFF1ZXVlTWVzc2FnZShyZXNvbHZlZFF1ZXVlVXJsLCB7XG4gICAgICAgICAgICAgIGRhdGE6IHRyYW5zZm9ybWVkLFxuICAgICAgICAgICAgICBldmVudE5hbWU6IFwiUkVTWU5DXCIsXG4gICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgcHJvY2Vzc2VkQ291bnQrKztcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcXVldWVpbmcgcmVjb3JkIGZvciBzeW5jOiAke2Vycm9yLm1lc3NhZ2V9YCwgeyBieUJhdGNoLCBlbnRpdHlOYW1lLCBiYXRjaFNpemUsIHF1ZXVlVXJsLCBlcnJvcn0pO1xuICAgICAgICAgICAgZmFpbGVkQ291bnQrKztcbiAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY3Vyc29yID0gcXVlcnlSZXN1bHQuY3Vyc29yID8/IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBsZXQgbWVzc2FnZSA9IGBRdWV1ZWQgJHtwcm9jZXNzZWRDb3VudH0gcmVjb3JkcyBmb3IgcmUtaW5kZXhpbmdgO1xuICAgIGlmIChmYWlsZWRDb3VudCA+IDApIHtcbiAgICAgIG1lc3NhZ2UgKz0gYCwgJHtmYWlsZWRDb3VudH0gcmVjb3JkcyBmYWlsZWQgdG8gYmUgcXVldWVkYDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgbWVzc2FnZSxcbiAgICAgIHN1Y2Nlc3M6IHByb2Nlc3NlZENvdW50ID4gMCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBmYWlsZWRDb3VudCxcbiAgICAgIHByb2Nlc3NlZENvdW50LFxuICAgIH0pO1xuICB9XG5cbiAgQEdldCgnL3F1ZXVlLWluZm8nKVxuICBhc3luYyBnZXRRdWV1ZUluZm8oXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBxdWV1ZVVybDogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcblxuICAgIGNvbnN0IHsgcXVldWVVcmwgfSA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnM7ICBcblxuICAgIC8vIFVzZSBwcm92aWRlZCBxdWV1ZVVybCBvciByZXNvbHZlIGZyb20gZW52aXJvbm1lbnRcbiAgICBjb25zdCBxdWV1ZU5hbWUgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IFNFQVJDSF9DT05UUk9MTEVSX0VOVl9LRVlTLk1FSUxJU0VBUkNIX1NZTkNfUVVFVUVfTkFNRSB9KTtcbiAgICBjb25zdCByZXNvbHZlZFF1ZXVlVXJsID0gcXVldWVVcmwgfHwgRW52aXJvbm1lbnQucXVldWVVcmwocXVldWVOYW1lKTtcblxuICAgIGNvbnN0IGluZm8gPSBhd2FpdCBnZXRRdWV1ZU1lc3NhZ2VNZXRhZGF0YShyZXNvbHZlZFF1ZXVlVXJsKTtcblxuICAgIHJldHVybiByZXMuanNvbih7IGluZm8gfSk7XG4gIH1cblxuICBAUHV0KCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0nLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZG9jdW1lbnRzOiB7IGRhdGF0eXBlOiAnYXJyYXknLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyB1cGRhdGVEb2N1bWVudHMoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IGRvY3VtZW50czogYW55W10gfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgeyBkb2N1bWVudHMgfSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2VhcmNoU2VydmljZS51cGRhdGVEb2N1bWVudHMoZG9jdW1lbnRzLCB0cnVlKTtcbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgcmVzdWx0LFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBtZXNzYWdlOiAnRG9jdW1lbnRzIHVwZGF0ZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICB9KTtcbiAgfVxuXG4gIEBEZWxldGUoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfS9ieS1pZHMnLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgaWRzOiB7IGRhdGF0eXBlOiAnYXJyYXknLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyBkZWxldGVEb2N1bWVudHNCeUlkcyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgaWRzOiBzdHJpbmdbXSB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCB7IGlkcyB9ID0gcmVxLmJvZHk7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5nZXRFbmdpbmUoKS5kZWxldGVEb2N1bWVudHMoaWRzLCBjb25maWcuaW5kZXhOYW1lISwgdHJ1ZSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBpbmRleE5hbWU6IGNvbmZpZy5pbmRleE5hbWUsXG4gICAgICBtZXNzYWdlOiAnRG9jdW1lbnRzIGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5J1xuICAgIH0pO1xuICB9XG5cbiAgQERlbGV0ZSgnL3JlY29yZHMve2VudGl0eU5hbWV9L2J5LWZpbHRlcicsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBmaWx0ZXI6IHsgZGF0YXR5cGU6ICdvYmplY3QnLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyBkZWxldGVEb2N1bWVudHNCeUZpbHRlcihcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHsgZmlsdGVyOiBhbnkgfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgeyBmaWx0ZXIgfSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5kZWxldGVEb2N1bWVudHNCeUZpbHRlcihmaWx0ZXIsIHRydWUpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgbWVzc2FnZTogJ0RvY3VtZW50cyBtYXRjaGluZyBmaWx0ZXIgaGF2ZSBiZWVuIHF1ZXVlZCBmb3IgZGVsZXRpb24uJ1xuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3QgcHJvdmlkZXIgPSB0aGlzLmNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlLFxuICAgICAgZm9yRW50aXR5OiBlbnRpdHlOYW1lLFxuICAgIH0pO1xuXG4gICAgaWYgKHByb3ZpZGVyLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBwcm92aWRlciBmb3VuZCBmb3IgZW50aXR5LXNlcnZpY2UgZm9yICR7ZW50aXR5TmFtZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvdmlkZXJbIDAgXS5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4ocHJvdmlkZXJbIDAgXS5fcHJvdmlkZXIucHJvdmlkZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSBlbnRpdHlTZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKTtcblxuICAgIGlmICghc2VhcmNoU2VydmljZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggc2VydmljZSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlYXJjaFNlcnZpY2U7XG4gIH1cbn0iXX0=