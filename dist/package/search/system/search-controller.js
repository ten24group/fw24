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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9zZWFyY2gtY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFFQSwwQ0FBNkU7QUFDN0Usc0ZBQTBFO0FBRTFFLGlEQUFzRTtBQUN0RSxpQ0FBMkM7QUFHM0MsdUNBQTJEO0FBQzNELGtEQUFtRDtBQUNuRCx5Q0FBMkM7QUFFM0MsSUFBWSwwQkFFWDtBQUZELFdBQVksMEJBQTBCO0lBQ3BDLHlGQUEyRCxDQUFBO0FBQzdELENBQUMsRUFGVywwQkFBMEIsMENBQTFCLDBCQUEwQixRQUVyQztBQU9NLElBQU0sc0JBQXNCLEdBQTVCLE1BQU0sc0JBQXVCLFNBQVEsc0NBQWE7SUFDZDtJQUF6QyxZQUF5QyxTQUF1QjtRQUM5RCxLQUFLLEVBQUUsQ0FBQztRQUQrQixjQUFTLEdBQVQsU0FBUyxDQUFjO0lBRWhFLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQTRCLEVBQUUsUUFBaUIsSUFBSSxDQUFDO0lBRy9ELEFBQU4sS0FBSyxDQUFDLFdBQVcsQ0FBQyxRQUFpQixFQUFFLFFBQWtCO1FBQ3JELDZDQUE2QztRQUM3QyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDO1lBQzdELElBQUksRUFBRSxTQUFTO1lBQ2YsK0JBQStCLEVBQUUsSUFBSTtTQUN0QyxDQUFDO2FBQ0MsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFO1lBQ1YsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUE7UUFDaEMsQ0FBQyxDQUFDLENBQUM7UUFFTCxNQUFNLFdBQVcsR0FBVSxFQUFFLENBQUM7UUFFOUIsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLFFBQVEsRUFBRSxFQUFFO1lB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RTtRQUMzQixHQUFHLEVBQUUsQ0FBRTtnQkFDTCxJQUFJLEVBQUUsMEJBQTBCLENBQUMsMkJBQTJCO2FBQzdELENBQUU7S0FDSixDQUFDO0lBRWEsV0FBQSxJQUFBLG9CQUFlLEdBQUUsQ0FBQTtHQURuQixzQkFBc0IsQ0FvbkJsQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuXG5pbXBvcnQgeyBnZXRRdWV1ZU1lc3NhZ2VNZXRhZGF0YSwgc2VuZFF1ZXVlTWVzc2FnZSB9IGZyb20gXCIuLi8uLi9jbGllbnQvc3FzXCI7XG5pbXBvcnQgeyBBUElDb250cm9sbGVyIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2FwaS1nYXRld2F5LWNvbnRyb2xsZXInO1xuaW1wb3J0IHR5cGUgeyBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSBcIi4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHRcIjtcbmltcG9ydCB7IENvbnRyb2xsZXIsIERlbGV0ZSwgR2V0LCBQb3N0LCBQdXQgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzJztcbmltcG9ydCB7IEluamVjdENvbnRhaW5lciB9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7IHR5cGUgQmFzZUVudGl0eVNlcnZpY2UgfSBmcm9tICcuLi8uLi9lbnRpdHknO1xuaW1wb3J0IHsgdHlwZSBJRElDb250YWluZXIsIHR5cGUgUmVxdWVzdCwgdHlwZSBSZXNwb25zZSB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgZGVlcENvcHksIHJlc29sdmVFbnZWYWx1ZUZvciB9IGZyb20gJy4uLy4uL3V0aWxzJztcbmltcG9ydCB7IHBhcnNlU2VhcmNoUXVlcnkgfSBmcm9tIFwiLi4vc2VhcmNoLXV0aWxzXCI7XG5pbXBvcnQgeyBFbnZpcm9ubWVudCB9IGZyb20gXCIuLi8uLi9jbGllbnRcIjtcblxuZXhwb3J0IGVudW0gU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMge1xuICBNRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUgPSAnTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FJyxcbn1cblxuQENvbnRyb2xsZXIoJ3N5c3RlbS9zZWFyY2gnLCB7XG4gIGVudjogWyB7XG4gICAgbmFtZTogU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FLFxuICB9IF0sXG59KVxuZXhwb3J0IGNsYXNzIFNlYXJjaFN5c3RlbUNvbnRyb2xsZXIgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgY29uc3RydWN0b3IoQEluamVjdENvbnRhaW5lcigpIHByb3RlY3RlZCBjb250YWluZXI6IElESUNvbnRhaW5lcikge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KSB7IH1cblxuICBAR2V0KCcvaW5kaWNlcycpXG4gIGFzeW5jIGxpc3RJbmRpY2VzKF9yZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogUmVzcG9uc2UpIHtcbiAgICAvLyBBdXRvLWRpc2NvdmVyIGVudGl0aWVzIHdpdGggc2VhcmNoIGVuYWJsZWRcbiAgICBjb25zdCBlbnRpdHlQcm92aWRlcnMgPSB0aGlzLmNvbnRhaW5lci5jb2xsZWN0QmVzdFByb3ZpZGVyc0Zvcih7XG4gICAgICB0eXBlOiAnc2VydmljZScsXG4gICAgICBhbGxQcm92aWRlcnNGcm9tQ2hpbGRDb250YWluZXJzOiB0cnVlLFxuICAgIH0pXG4gICAgICAuZmlsdGVyKHAgPT4ge1xuICAgICAgICByZXR1cm4gISFwLl9wcm92aWRlci5mb3JFbnRpdHlcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgaW5kaWNlc0RhdGE6IGFueVtdID0gW107XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChlbnRpdHlQcm92aWRlcnMubWFwKGFzeW5jIChwcm92aWRlcikgPT4ge1xuXG4gICAgICBjb25zdCBlbnRpdHlOYW1lID0gcHJvdmlkZXIuX3Byb3ZpZGVyLmZvckVudGl0eSBhcyBzdHJpbmc7XG5cbiAgICAgIHRyeSB7XG5cbiAgICAgICAgLy8gdXNlIHByb3ZpZGVyJ3MgY29udGFpbmVyICB0byByZXNvbHZlIHRoZSBzZXJ2aWNlXG4gICAgICAgIGNvbnN0IHNlcnZpY2UgPSBwcm92aWRlci5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oXG4gICAgICAgICAgcHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGVcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAoIXNlcnZpY2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlcnZpY2UgJHtTdHJpbmcocHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGUpfSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gc2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgICAgIGlmICghc2VhcmNoU2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIHNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaW5kZXhJbmZvID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleEluZm8oKTtcblxuICAgICAgICBpbmRpY2VzRGF0YS5wdXNoKHtcbiAgICAgICAgICAuLi5pbmRleEluZm8sXG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBpbmRleE5hbWU6IGluZGV4SW5mby51aWQsXG4gICAgICAgIH0pO1xuXG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG5cbiAgICAgICAgaW5kaWNlc0RhdGEucHVzaCh7XG4gICAgICAgICAgaW5kZXhOYW1lOiBgWyR7ZW50aXR5TmFtZX1dLWluZGV4LW5hbWUtbm90LXJlc29sdmVkYCxcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihlcnJvcik7XG4gICAgICB9XG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHJlc3BvbnNlLmpzb24oeyBpbmRpY2VzOiBpbmRpY2VzRGF0YSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgbmV3IGFwaSB0byBnZXQgaW5kZXggZGV0YWlsc1xuICAgKiBcbiAgICovXG5cbiAgQEdldCgnL2luZGljZXMve2VudGl0eU5hbWV9Jywge30pXG4gIGFzeW5jIGdldEluZGV4RGV0YWlscyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgaW5kZXhJbmZvID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleEluZm8oKTtcbiAgICBjb25zdCBpbmRleFN0YXRzID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleFN0YXRzKCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgZGV0YWlsczoge1xuICAgICAgICBpbmRleEluZm8sXG4gICAgICAgIGluZGV4U3RhdHMsXG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBAR2V0KCcvZW50aXRpZXMnKVxuICBhc3luYyBnZXRTZWFyY2hFbnRpdGllcyhfcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgZW50aXR5UHJvdmlkZXJzID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICB9KVxuICAgICAgLmZpbHRlcihwID0+ICEhcC5fcHJvdmlkZXIuZm9yRW50aXR5KTtcblxuICAgIGNvbnN0IGVudGl0aWVzRGF0YToge1xuICAgICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgICAgc2VhcmNoRW5hYmxlZDogYm9vbGVhbjtcbiAgICAgIGluZGV4RXhpc3RzPzogYm9vbGVhbjtcbiAgICAgIGluZGV4TmFtZT86IHN0cmluZztcbiAgICAgIGVycm9yPzogc3RyaW5nO1xuICAgIH1bXSA9IFtdO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZW50aXR5UHJvdmlkZXJzLm1hcChhc3luYyAocHJvdmlkZXIpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSBwcm92aWRlci5fcHJvdmlkZXIuZm9yRW50aXR5IGFzIHN0cmluZztcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc2VydmljZSA9IHByb3ZpZGVyLl9jb250YWluZXIucmVzb2x2ZTxCYXNlRW50aXR5U2VydmljZTxhbnk+PihcbiAgICAgICAgICBwcm92aWRlci5fcHJvdmlkZXIucHJvdmlkZVxuICAgICAgICApO1xuXG4gICAgICAgIGlmICghc2VydmljZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU2VydmljZSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWFyY2hFbmFibGVkID0gc2VydmljZS5pc1NlYXJjaEVuYWJsZWQoKTtcbiAgICAgICAgbGV0IGluZGV4RXhpc3RzID0gZmFsc2U7XG4gICAgICAgIGxldCBpbmRleE5hbWUgPSAnJztcblxuICAgICAgICBpZiAoc2VhcmNoRW5hYmxlZCkge1xuICAgICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSBzZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgICBpZiAoc2VhcmNoU2VydmljZSkge1xuICAgICAgICAgICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgICAgICAgICAgaW5kZXhOYW1lID0gY29uZmlnLmluZGV4TmFtZSE7XG4gICAgICAgICAgICBpbmRleEV4aXN0cyA9IGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RW5naW5lKCkuaW5kZXhFeGlzdHMoaW5kZXhOYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBlbnRpdGllc0RhdGEucHVzaCh7XG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBzZWFyY2hFbmFibGVkLFxuICAgICAgICAgIGluZGV4RXhpc3RzLFxuICAgICAgICAgIGluZGV4TmFtZSxcbiAgICAgICAgfSk7XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgZW50aXRpZXNEYXRhLnB1c2goe1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgc2VhcmNoRW5hYmxlZDogZmFsc2UsXG4gICAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIHJldHVybiByZXNwb25zZS5qc29uKHsgZW50aXRpZXM6IGVudGl0aWVzRGF0YSB9KTtcbiAgfVxuXG4gIEBHZXQoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfS97ZG9jdW1lbnRJZH0nKVxuICBhc3luYyBnZXRTaW5nbGVEb2N1bWVudChcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZywgZG9jdW1lbnRJZDogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGRvY3VtZW50SWQgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcHJpbWFyeUlkRmllbGROYW1lID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlQcmltYXJ5SWRQcm9wZXJ0eU5hbWUoKTtcbiAgICBcbiAgICBjb25zdCBkb2MgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldERvY3VtZW50KGRvY3VtZW50SWQpO1xuXG4gICAgZG9jWyAnaWQnIF0gPSBkb2NbICdpZCcgXSB8fCBkb2NbIHByaW1hcnlJZEZpZWxkTmFtZSBhcyBzdHJpbmcgXTtcbiAgICBkb2NbICdmdWxsUmVjb3JkJyBdID0geyAuLi5kb2MgfTtcbiAgICBkb2NbICdlbnRpdHlOYW1lJyBdID0gZW50aXR5TmFtZTtcblxuICAgIHJldHVybiByZXMuanNvbihkb2MpO1xuICB9XG5cbiAgQEdldCgnL3JlY29yZHMve2VudGl0eU5hbWV9JylcbiAgYXN5bmMgZ2V0RW50aXR5UmVjb3JkcyhcbiAgICByZXE6IFJlcXVlc3Q8e1xuICAgICAgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfTtcbiAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVycz86IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHRcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IGVudGl0eVNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcXVlcnkgPSBkZWVwQ29weShyZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzKTtcblxuICAgIGNvbnN0IHBhcnNlZFF1ZXJ5ID0gcGFyc2VTZWFyY2hRdWVyeShxdWVyeSk7XG4gICAgY29uc3QgeyBzZWxlY3Q6IF9zZWxlY3QsIC4uLnJlc3RRdWVyeVBhcmFtcyB9ID0gcGFyc2VkUXVlcnk7XG5cbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgZW50aXR5U2VydmljZS5zZWFyY2gocmVzdFF1ZXJ5UGFyYW1zLCBjdHgpO1xuXG4gICAgY29uc3QgeyBoaXRzLCAuLi5yZXN0IH0gPSByZXN1bHRzO1xuICAgIFxuICAgIC8vIEdldCB0aGUgZW50aXR5J3MgcHJpbWFyeSBpZGVudGlmaWVyIGZpZWxkIG5hbWVcbiAgICBjb25zdCBwcmltYXJ5SWRGaWVsZE5hbWUgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVByaW1hcnlJZFByb3BlcnR5TmFtZSgpO1xuICAgIFxuICAgIC8vIEVuc3VyZSBhbGwgcmVjb3JkcyBoYXZlIGEgY29uc2lzdGVudCAnaWQnIGZpZWxkIGZvciBnZW5lcmljIFVJIGxpc3RpbmdcbiAgICBjb25zdCBub3JtYWxpemVkSGl0cyA9IGhpdHMubWFwKChoaXQ6IGFueSkgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEhpdCA9IHsgLi4uaGl0IH07XG5cbiAgICAgIG5vcm1hbGl6ZWRIaXRbICdlbnRpdHlOYW1lJyBdID0gZW50aXR5TmFtZTtcbiAgICAgIG5vcm1hbGl6ZWRIaXRbICdmdWxsUmVjb3JkJyBdID0gaGl0O1xuICAgICAgXG4gICAgICAvLyBJZiB0aGUgcmVjb3JkIGRvZXNuJ3QgaGF2ZSBhbiAnaWQnIGZpZWxkIGJ1dCBoYXMgdGhlIHByaW1hcnkgaWRlbnRpZmllciBmaWVsZCxcbiAgICAgIC8vIG1hcCBpdCB0byAnaWQnIGZvciBjb25zaXN0ZW50IGdlbmVyaWMgbGlzdGluZ1xuICAgICAgaWYgKCFub3JtYWxpemVkSGl0LmlkICYmIHByaW1hcnlJZEZpZWxkTmFtZSAmJiBub3JtYWxpemVkSGl0W3ByaW1hcnlJZEZpZWxkTmFtZV0pIHtcbiAgICAgICAgbm9ybWFsaXplZEhpdC5pZCA9IG5vcm1hbGl6ZWRIaXRbcHJpbWFyeUlkRmllbGROYW1lXTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gSWYgc3RpbGwgbm8gaWQgZmllbGQsIHRyeSBjb21tb24gaWRlbnRpZmllciBwYXR0ZXJuc1xuICAgICAgaWYgKCFub3JtYWxpemVkSGl0LmlkKSB7XG4gICAgICAgIGNvbnN0IGlkRmllbGRzID0gW2Ake2VudGl0eU5hbWV9SWRgLCBgJHtlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCl9SWRgXTtcbiAgICAgICAgZm9yIChjb25zdCBpZEZpZWxkIG9mIGlkRmllbGRzKSB7XG4gICAgICAgICAgaWYgKG5vcm1hbGl6ZWRIaXRbaWRGaWVsZF0pIHtcbiAgICAgICAgICAgIG5vcm1hbGl6ZWRIaXQuaWQgPSBub3JtYWxpemVkSGl0W2lkRmllbGRdO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBcbiAgICAgIHJldHVybiBub3JtYWxpemVkSGl0O1xuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzcG9uc2UgPSB7XG4gICAgICAuLi5yZXN0LFxuICAgICAgaXRlbXM6IG5vcm1hbGl6ZWRIaXRzLFxuICAgIH07XG5cbiAgICBpZiAocmVxLmRlYnVnTW9kZSkge1xuICAgICAgT2JqZWN0LmFzc2lnbihyZXNwb25zZSwge1xuICAgICAgICBpbnB1dFF1ZXJ5OiBxdWVyeSxcbiAgICAgICAgcHJvY2Vzc2luZ1RpbWVNczogcmVzdWx0cy5wcm9jZXNzaW5nVGltZU1zLFxuICAgICAgICBwcmltYXJ5SWRGaWVsZE5hbWVcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiByZXMuanNvbihyZXNwb25zZSk7XG4gIH1cblxuICBAUG9zdCgnL2luaXRJbmRpY2VzJylcbiAgYXN5bmMgaW5pdFNlYXJjaEluZGljZXMoXG4gICAgcmVxOiBSZXF1ZXN0PHsgYm9keTogeyBlbnRpdGllcz86IHN0cmluZ1tdIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXRpZXM6IHJlcXVlc3RlZEVudGl0aWVzID0gW10gfSA9IHJlcS5ib2R5IHx8IHt9O1xuXG4gICAgLy8gY29sbGVjdCBwcm92aWRlciBmb3IgZW50aXR5LXNlcnZpY2VzIGZyb20gY29udGFpbmVyLWhpZXJhcmNoeVxuICAgIGNvbnN0IGVudGl0eVByb3ZpZGVycyA9IHRoaXMuY29udGFpbmVyLmNvbGxlY3RCZXN0UHJvdmlkZXJzRm9yKHtcbiAgICAgIHR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgIGFsbFByb3ZpZGVyc0Zyb21DaGlsZENvbnRhaW5lcnM6IHRydWUsXG4gICAgfSlcbiAgICAgIC5maWx0ZXIocCA9PiAoXG4gICAgICAgIC8vIGZpbHRlciBvdXQgcHJvdmlkZXJzIHRoYXQgZG8gbm90IGhhdmUgYSBmb3JFbnRpdHkgcHJvcGVydHlcbiAgICAgICAgISFwLl9wcm92aWRlci5mb3JFbnRpdHlcbiAgICAgICAgJiYgKFxuICAgICAgICAgIC8vIGlmIG5vIGVudGl0aWVzIGFyZSByZXF1ZXN0ZWQsIGluY2x1ZGUgYWxsIGVudGl0aWVzXG4gICAgICAgICAgIXJlcXVlc3RlZEVudGl0aWVzPy5sZW5ndGhcbiAgICAgICAgICAvLyBpZiBlbnRpdGllcyBhcmUgcmVxdWVzdGVkLCBpbmNsdWRlIG9ubHkgdGhlIHJlcXVlc3RlZCBlbnRpdGllc1xuICAgICAgICAgIHx8IHJlcXVlc3RlZEVudGl0aWVzLmluY2x1ZGVzKHAuX3Byb3ZpZGVyLmZvckVudGl0eSBhcyBzdHJpbmcpXG4gICAgICAgIClcbiAgICAgICkpO1xuXG4gICAgY29uc3QgcmVzdWx0czoge1xuICAgICAgZXJyb3I/OiBzdHJpbmc7XG4gICAgICBzdWNjZXNzOiBib29sZWFuO1xuICAgICAgbWVzc2FnZT86IHN0cmluZztcblxuICAgICAgZW50aXR5TmFtZTogc3RyaW5nO1xuICAgICAgaW5kZXhOYW1lPzogc3RyaW5nO1xuICAgICAgaW5kZXhDb25maWc/OiBhbnk7XG4gICAgfVtdID0gW107XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChlbnRpdHlQcm92aWRlcnMubWFwKGFzeW5jIChwcm92aWRlcikgPT4ge1xuICAgICAgY29uc3QgZW50aXR5TmFtZSA9IHByb3ZpZGVyLl9wcm92aWRlci5mb3JFbnRpdHkgYXMgc3RyaW5nO1xuXG4gICAgICB0cnkge1xuXG4gICAgICAgIGNvbnN0IHNlcnZpY2UgPSBwcm92aWRlci5fY29udGFpbmVyLnJlc29sdmU8QmFzZUVudGl0eVNlcnZpY2U8YW55Pj4oXG4gICAgICAgICAgcHJvdmlkZXIuX3Byb3ZpZGVyLnByb3ZpZGVcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFzZXJ2aWNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbnRpdHlTZXJ2aWNlIGNvdWxkIG5vdCBiZSByZXNvbHZlZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSBzZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICAgICAgaWYgKCFzZWFyY2hTZXJ2aWNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZWFyY2ggc2VydmljZSBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmluaXRTZWFyY2hJbmRleCgpO1xuICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG5cbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgICAgICBpbmRleENvbmZpZzogY29uZmlnLFxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgbWVzc2FnZTogYEluZGV4ICR7Y29uZmlnLmluZGV4TmFtZX0gaW5pdGlhbGl6ZWQgc3VjY2Vzc2Z1bGx5YCxcbiAgICAgICAgfSk7XG5cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgIGVycm9yOiBlcnJvcixcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBtZXNzYWdlOiBgRXJyb3IgaW5pdGlhbGl6aW5nIGluZGV4IGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfTogJHtlcnJvci5tZXNzYWdlfWAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pKTtcblxuICAgIHJldHVybiByZXMuanNvbih7IHJlc3VsdHMgfSk7XG4gIH1cblxuICBAR2V0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vc2V0dGluZ3MnKVxuICBhc3luYyBnZXRJbmRleFNldHRpbmdzKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHNldHRpbmdzID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRJbmRleFNldHRpbmdzKCk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHsgc2V0dGluZ3MgfSk7XG4gIH1cblxuICBAUHV0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vc2V0dGluZ3MnLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgc2V0dGluZ3M6IHsgZGF0YXR5cGU6ICdvYmplY3QnLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyB1cGRhdGVJbmRleFNldHRpbmdzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBzZXR0aW5nczogUmVjb3JkPHN0cmluZywgYW55PjsgfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcbiAgICBjb25zdCB7IHNldHRpbmdzIH0gPSByZXEuYm9keSB8fCB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZWFyY2hTZXJ2aWNlLnVwZGF0ZUluZGV4U2V0dGluZ3Moc2V0dGluZ3MsIHRydWUpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHJlc3VsdCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgbWVzc2FnZTogJ0luZGV4IHNldHRpbmdzIHVwZGF0ZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy97ZW50aXR5TmFtZX0vcmVzZXQtc2V0dGluZ3MnKVxuICBhc3luYyByZXNldEluZGV4U2V0dGluZ3MoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBlbnRpdHlOYW1lOiBzdHJpbmcgfSB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5yZXNldEluZGV4U2V0dGluZ3MoKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdJbmRleCBzZXR0aW5ncyByZXNldCB0byBjb2RlIGNvbmZpZ3VyYXRpb24nXG4gICAgfSk7XG4gIH1cblxuICBARGVsZXRlKCcvaW5kaWNlcy97ZW50aXR5TmFtZX0nKVxuICBhc3luYyBkZWxldGVJbmRleChcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmRlbGV0ZVNlYXJjaEluZGV4KHRydWUpO1xuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdJbmRleCBkZWxldGVkIHN1Y2Nlc3NmdWxseSdcbiAgICB9KTtcbiAgfVxuXG4gIEBEZWxldGUoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9kb2N1bWVudHMnKVxuICBhc3luYyBjbGVhckVudGl0eUluZGV4KFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycyA/PyB7fTtcblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5nZXRFbmdpbmUoKS5kZWxldGVBbGxEb2N1bWVudHMoY29uZmlnLmluZGV4TmFtZSEsIHRydWUpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgbWVzc2FnZTogJ0FsbCBkb2N1bWVudHMgY2xlYXJlZCBmcm9tIGluZGV4J1xuICAgIH0pO1xuICB9XG5cbiAgQFBvc3QoJy9pbmRpY2VzL3tlbnRpdHlOYW1lfS9yZXN5bmMnKVxuICBhc3luYyByZXN5bmNFbnRpdHlSZWNvcmRzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBiYXRjaFNpemU/OiBudW1iZXI7IHF1ZXVlVXJsPzogc3RyaW5nOyBieUJhdGNoPzogYm9vbGVhbiB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzID8/IHt9O1xuICAgIGNvbnN0IHsgYmF0Y2hTaXplID0gNTAsIHF1ZXVlVXJsLCBieUJhdGNoID0gdHJ1ZSB9ID0gcmVxLmJvZHkgfHwge307XG5cbiAgICBjb25zdCBlbnRpdHlTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgLy8gVXNlIHByb3ZpZGVkIHF1ZXVlVXJsIG9yIHJlc29sdmUgZnJvbSBlbnZpcm9ubWVudFxuICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogU0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FIH0pO1xuICAgIGNvbnN0IHJlc29sdmVkUXVldWVVcmwgPSBxdWV1ZVVybCB8fCBFbnZpcm9ubWVudC5xdWV1ZVVybChxdWV1ZU5hbWUpO1xuXG4gICAgaWYgKCFyZXNvbHZlZFF1ZXVlVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFF1ZXVlIFVSTCBub3QgcHJvdmlkZWQgYW5kIGVudi1rZXkgWyR7U0VBUkNIX0NPTlRST0xMRVJfRU5WX0tFWVMuTUVJTElTRUFSQ0hfU1lOQ19RVUVVRV9OQU1FfV0gaXMgbm90IGNvbmZpZ3VyZWRgKTtcbiAgICB9XG5cbiAgICAvLyBHZXQgYWxsIGVudGl0eSByZWNvcmRzIGluIGJhdGNoZXMgYW5kIHF1ZXVlIHRoZW0gZm9yIHN5bmNcbiAgICBsZXQgZmFpbGVkQ291bnQgPSAwO1xuICAgIGxldCBwcm9jZXNzZWRDb3VudCA9IDA7XG4gICAgbGV0IGN1cnNvcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gJ2luaXQnO1xuXG4gICAgd2hpbGUgKCEhY3Vyc29yKSB7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oYEZldGNoaW5nICR7ZW50aXR5TmFtZX0gcmVjb3JkcyBmcm9tIGN1cnNvcjogJHtjdXJzb3J9YCk7XG5cbiAgICAgIGNvbnN0IHF1ZXJ5UmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5xdWVyeSh7XG4gICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICBsaW1pdDogYmF0Y2hTaXplLFxuICAgICAgICAgIGN1cnNvcjogY3Vyc29yID09PSAnaW5pdCcgPyB1bmRlZmluZWQgOiBjdXJzb3JcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGlmIChieUJhdGNoKSB7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgUHJvbWlzZS5hbGwoWyAuLi4ocXVlcnlSZXN1bHQuZGF0YSA/PyBbXSkgXS5tYXAoYXN5bmMgKHJlYykgPT4ge1xuICAgICAgICAgIGNvbnN0IHRyYW5zZm9ybWVkID0gYXdhaXQgZW50aXR5U2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKHJlYyk7XG4gICAgICAgICAgcmV0dXJuIHRyYW5zZm9ybWVkO1xuICAgICAgICB9KSk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBpZiAoZGF0YS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYE5vIHJlY29yZHMgdG8gcXVldWUgZm9yIHN5bmM6ICR7ZW50aXR5TmFtZX1gLCB7IGJ5QmF0Y2gsIGVudGl0eU5hbWUsIGJhdGNoU2l6ZSwgcXVldWVVcmx9KTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGF3YWl0IHNlbmRRdWV1ZU1lc3NhZ2UocmVzb2x2ZWRRdWV1ZVVybCwge1xuICAgICAgICAgICAgZGF0YSxcbiAgICAgICAgICAgIGV2ZW50TmFtZTogXCJSRVNZTkNcIixcbiAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcHJvY2Vzc2VkQ291bnQgKz0gZGF0YS5sZW5ndGg7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgRXJyb3IgcXVldWVpbmcgcmVjb3JkIGZvciBzeW5jOiAke2Vycm9yLm1lc3NhZ2V9YCwgeyBieUJhdGNoLCBlbnRpdHlOYW1lLCBiYXRjaFNpemUsIHF1ZXVlVXJsLCBlcnJvcn0pO1xuICAgICAgICAgIGZhaWxlZENvdW50ICs9IGRhdGEubGVuZ3RoO1xuICAgICAgICB9XG5cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICAgIChxdWVyeVJlc3VsdC5kYXRhID8/IFtdKS5tYXAoYXN5bmMgKGVudGl0eVJlY29yZCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgdHJhbnNmb3JtZWQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5UmVjb3JkKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGF3YWl0IHNlbmRRdWV1ZU1lc3NhZ2UocmVzb2x2ZWRRdWV1ZVVybCwge1xuICAgICAgICAgICAgICBkYXRhOiB0cmFuc2Zvcm1lZCxcbiAgICAgICAgICAgICAgZXZlbnROYW1lOiBcIlJFU1lOQ1wiLFxuICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIHByb2Nlc3NlZENvdW50Kys7XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIHF1ZXVlaW5nIHJlY29yZCBmb3Igc3luYzogJHtlcnJvci5tZXNzYWdlfWAsIHsgYnlCYXRjaCwgZW50aXR5TmFtZSwgYmF0Y2hTaXplLCBxdWV1ZVVybCwgZXJyb3J9KTtcbiAgICAgICAgICAgIGZhaWxlZENvdW50Kys7XG4gICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGN1cnNvciA9IHF1ZXJ5UmVzdWx0LmN1cnNvciA/PyB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgbGV0IG1lc3NhZ2UgPSBgUXVldWVkICR7cHJvY2Vzc2VkQ291bnR9IHJlY29yZHMgZm9yIHJlLWluZGV4aW5nYDtcbiAgICBpZiAoZmFpbGVkQ291bnQgPiAwKSB7XG4gICAgICBtZXNzYWdlICs9IGAsICR7ZmFpbGVkQ291bnR9IHJlY29yZHMgZmFpbGVkIHRvIGJlIHF1ZXVlZGA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBzdWNjZXNzOiBwcm9jZXNzZWRDb3VudCA+IDAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZmFpbGVkQ291bnQsXG4gICAgICBwcm9jZXNzZWRDb3VudCxcbiAgICB9KTtcbiAgfVxuXG4gIEBHZXQoJy9xdWV1ZS1pbmZvJylcbiAgYXN5bmMgZ2V0UXVldWVJbmZvKFxuICAgIHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgcXVldWVVcmw6IHN0cmluZyB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IHF1ZXVlVXJsIH0gPSByZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzOyAgXG5cbiAgICAvLyBVc2UgcHJvdmlkZWQgcXVldWVVcmwgb3IgcmVzb2x2ZSBmcm9tIGVudmlyb25tZW50XG4gICAgY29uc3QgcXVldWVOYW1lID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBTRUFSQ0hfQ09OVFJPTExFUl9FTlZfS0VZUy5NRUlMSVNFQVJDSF9TWU5DX1FVRVVFX05BTUUgfSk7XG4gICAgY29uc3QgcmVzb2x2ZWRRdWV1ZVVybCA9IHF1ZXVlVXJsIHx8IEVudmlyb25tZW50LnF1ZXVlVXJsKHF1ZXVlTmFtZSk7XG5cbiAgICBjb25zdCBpbmZvID0gYXdhaXQgZ2V0UXVldWVNZXNzYWdlTWV0YWRhdGEocmVzb2x2ZWRRdWV1ZVVybCk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oeyBpbmZvIH0pO1xuICB9XG5cbiAgQFB1dCgnL3JlY29yZHMve2VudGl0eU5hbWV9Jywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIGRvY3VtZW50czogeyBkYXRhdHlwZTogJ2FycmF5JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgdXBkYXRlRG9jdW1lbnRzKFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgICAgYm9keTogeyBkb2N1bWVudHM6IGFueVtdIH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHsgZG9jdW1lbnRzIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNlYXJjaFNlcnZpY2UudXBkYXRlRG9jdW1lbnRzKGRvY3VtZW50cywgdHJ1ZSk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHJlc3VsdCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgbWVzc2FnZTogJ0RvY3VtZW50cyB1cGRhdGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgfSk7XG4gIH1cblxuICBARGVsZXRlKCcvcmVjb3Jkcy97ZW50aXR5TmFtZX0vYnktaWRzJywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIGlkczogeyBkYXRhdHlwZTogJ2FycmF5JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzQnlJZHMoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IGlkczogc3RyaW5nW10gfVxuICAgIH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgeyBpZHMgfSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZ2V0RW5naW5lKCkuZGVsZXRlRG9jdW1lbnRzKGlkcywgY29uZmlnLmluZGV4TmFtZSEsIHRydWUpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgaW5kZXhOYW1lOiBjb25maWcuaW5kZXhOYW1lLFxuICAgICAgbWVzc2FnZTogJ0RvY3VtZW50cyBkZWxldGVkIHN1Y2Nlc3NmdWxseSdcbiAgICB9KTtcbiAgfVxuXG4gIEBEZWxldGUoJy9yZWNvcmRzL3tlbnRpdHlOYW1lfS9ieS1maWx0ZXInLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZmlsdGVyOiB7IGRhdGF0eXBlOiAnb2JqZWN0JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzQnlGaWx0ZXIoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsgZW50aXR5TmFtZTogc3RyaW5nIH07XG4gICAgICBib2R5OiB7IGZpbHRlcjogYW55IH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IHsgZmlsdGVyIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hTZXJ2aWNlKGVudGl0eU5hbWUpO1xuXG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZGVsZXRlRG9jdW1lbnRzQnlGaWx0ZXIoZmlsdGVyLCB0cnVlKTtcblxuICAgIHJldHVybiByZXMuanNvbih7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGluZGV4TmFtZTogY29uZmlnLmluZGV4TmFtZSxcbiAgICAgIG1lc3NhZ2U6ICdEb2N1bWVudHMgbWF0Y2hpbmcgZmlsdGVyIGhhdmUgYmVlbiBxdWV1ZWQgZm9yIGRlbGV0aW9uLidcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRFbnRpdHlTZXJ2aWNlKGVudGl0eU5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IHByb3ZpZGVyID0gdGhpcy5jb250YWluZXIuY29sbGVjdEJlc3RQcm92aWRlcnNGb3Ioe1xuICAgICAgdHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYWxsUHJvdmlkZXJzRnJvbUNoaWxkQ29udGFpbmVyczogdHJ1ZSxcbiAgICAgIGZvckVudGl0eTogZW50aXR5TmFtZSxcbiAgICB9KTtcblxuICAgIGlmIChwcm92aWRlci5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gcHJvdmlkZXIgZm91bmQgZm9yIGVudGl0eS1zZXJ2aWNlIGZvciAke2VudGl0eU5hbWV9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHByb3ZpZGVyWyAwIF0uX2NvbnRhaW5lci5yZXNvbHZlPEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4+KHByb3ZpZGVyWyAwIF0uX3Byb3ZpZGVyLnByb3ZpZGUpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3QgZW50aXR5U2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gZW50aXR5U2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG5cbiAgICBpZiAoIXNlYXJjaFNlcnZpY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU2VhcmNoIHNlcnZpY2Ugbm90IGZvdW5kIGZvciBlbnRpdHkgJHtlbnRpdHlOYW1lfWApO1xuICAgIH1cblxuICAgIHJldHVybiBzZWFyY2hTZXJ2aWNlO1xuICB9XG59Il19