"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeiliSearchSystemController = void 0;
const decorators_1 = require("../../decorators");
const search_controller_1 = require("./search-controller");
const engines_1 = require("../engines");
const errors_1 = require("../errors");
const parse_1 = require("../../utils/parse");
const query_1 = require("../../entity/query");
// Helper function to convert cursor-based pagination to offset
function parseCursorPagination(req) {
    const data = req.queryStringParameters;
    const { cursor, count = "100", limit = "250", hitsPerPage, page, ...rest } = data || {};
    let offset = null;
    if (cursor) {
        try {
            const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());
            offset = cursorData.offset;
        }
        catch (error) {
            // Invalid cursor, start from beginning
        }
    }
    // Handle search-style pagination (hitsPerPage + page)
    if (hitsPerPage && page) {
        const pageSize = (0, parse_1.safeParseInt)(hitsPerPage, 20).value;
        const pageNum = (0, parse_1.safeParseInt)(page, 1).value;
        offset = (pageNum - 1) * pageSize;
        return {
            offset,
            limit: pageSize,
            rest
        };
    }
    // Use count as primary, limit as fallback (same as entity controller)
    const pageSize = (0, parse_1.safeParseInt)(count, (0, parse_1.safeParseInt)(limit, 250).value).value;
    return {
        offset,
        limit: pageSize,
        rest
    };
}
// Helper function to create next cursor
function createNextCursor(offset, limit, hasMore) {
    if (!hasMore) {
        return null;
    }
    const nextOffset = offset + limit;
    return Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64');
}
//* Note: this is a more focused [towards meilisearch] version of the search controller
//* at any given point only one of the controllers will be registered with the same route
let MeiliSearchSystemController = class MeiliSearchSystemController extends search_controller_1.SearchSystemController {
    getMeiliEngine() {
        const engine = this.container.resolveSearchEngine();
        if (engine instanceof engines_1.MeiliSearchEngine) {
            return engine;
        }
        throw new errors_1.SearchEngineError('Could not resolve MeiliSearchEngine from di-container');
    }
    async getStats(req, res) {
        const { includeIndexes = true } = req.queryStringParameters || {};
        const engine = this.getMeiliEngine();
        const stats = await engine.getStats();
        const { indexes, ...rest } = stats;
        if (!includeIndexes) {
            return res.json(rest);
        }
        return res.json(stats);
    }
    async updateExperimentalFeatures(req, res) {
        const { metrics = false, logsRoute = false, containsFilter = false, editDocumentsByFunction = false, network = false } = req.body;
        const engine = this.getMeiliEngine();
        const task = await engine.setExperimentalFeaturesStatus({
            metrics,
            network,
            logsRoute,
            containsFilter,
            editDocumentsByFunction,
        });
        return res.json(task);
    }
    async getExperimentalFeatures(_req, res) {
        const engine = this.getMeiliEngine();
        const features = await engine.getExperimentalFeatures();
        return res.json(features);
    }
    async getVersion(_req, res) {
        const engine = this.getMeiliEngine();
        const version = await engine.getVersion();
        return res.json(version);
    }
    async getHealth(_req, res) {
        const engine = this.getMeiliEngine();
        const health = await engine.health();
        return res.json(health);
    }
    async isHealthy(_req, res) {
        const engine = this.getMeiliEngine();
        const isHealthy = await engine.isHealthy();
        return res.json({ isHealthy });
    }
    async createDump(_req, res) {
        const engine = this.getMeiliEngine();
        const task = await engine.createDump();
        return res.json(task);
    }
    async createSnapshot(_req, res) {
        const engine = this.getMeiliEngine();
        const task = await engine.createSnapshot();
        return res.json(task);
    }
    async swapIndices(req, res) {
        const { swaps } = req.body;
        const engine = this.getMeiliEngine();
        const task = await engine.swapIndexes(swaps.map(pair => ({ indexes: pair })), true);
        return res.json(task);
    }
    async multiSearch(req, res) {
        const { queries } = req.body;
        const engine = this.getMeiliEngine();
        const results = await engine.multiSearch(queries);
        return res.json(results);
    }
    async getIndexDocuments(req, res) {
        const { indexName } = req.pathParameters;
        const options = req.queryStringParameters;
        const engine = this.getMeiliEngine();
        const documents = await engine.getDocuments(indexName, {
            // extract manually to avoid unwanted keys errors
            ids: options.ids,
            limit: options.limit,
            offset: options.offset,
            filter: options.filter,
            fields: options.fields,
            retrieveVectors: options.retrieveVectors,
        });
        return res.json({ documents });
    }
    entityNameToIndexName(entityName) {
        const searchService = this.getEntitySearchService(entityName);
        const indexInfo = searchService.getSearchIndexConfig();
        if (indexInfo) {
            return indexInfo.indexName;
        }
        throw new Error(`Index not found for entity ${entityName}`);
    }
    async getTasks(req, res) {
        const engine = this.getMeiliEngine();
        const { offset, limit, rest } = parseCursorPagination(req);
        // Use the same query parsing as entity controller
        const parsedQueryParams = (0, query_1.parseUrlQueryStringParameters)(rest);
        const filterGroup = (0, query_1.queryStringParamsToFilterGroup)(parsedQueryParams);
        // Convert filter group to MeiliSearch parameters
        const meiliParams = {
            limit,
            from: offset,
            reverse: false, // Get newest tasks first
        };
        // Extract MeiliSearch parameters from filter group
        if (filterGroup.and) {
            filterGroup.and.forEach(filter => {
                if (filter.attribute === 'type' && filter.eq) {
                    meiliParams.types = filter.eq;
                }
                else if (filter.attribute === 'type' && filter.in) {
                    meiliParams.types = filter.in;
                }
                else if (filter.attribute === 'status' && filter.eq) {
                    meiliParams.statuses = filter.eq;
                }
                else if (filter.attribute === 'status' && filter.in) {
                    meiliParams.statuses = filter.in;
                }
                else if (filter.attribute === 'uid' && filter.eq) {
                    meiliParams.uids = [filter.eq];
                }
                else if (filter.attribute === 'uid' && filter.in) {
                    meiliParams.uids = filter.in;
                }
                else if (filter.attribute === 'indexUid' && filter.eq) {
                    meiliParams.indexUids = [filter.eq];
                }
                else if (filter.attribute === 'indexUid' && filter.in) {
                    meiliParams.indexUids = filter.in;
                }
                else if (filter.attribute === 'enqueuedAt' && filter.lt) {
                    meiliParams.beforeEnqueuedAt = new Date(filter.lt).toISOString();
                }
                else if (filter.attribute === 'enqueuedAt' && filter.gt) {
                    meiliParams.afterEnqueuedAt = new Date(filter.gt).toISOString();
                }
                else if (filter.attribute === 'startedAt' && filter.lt) {
                    meiliParams.beforeStartedAt = new Date(filter.lt).toISOString();
                }
                else if (filter.attribute === 'startedAt' && filter.gt) {
                    meiliParams.afterStartedAt = new Date(filter.gt).toISOString();
                }
                else if (filter.attribute === 'finishedAt' && filter.lt) {
                    meiliParams.beforeFinishedAt = new Date(filter.lt).toISOString();
                }
                else if (filter.attribute === 'finishedAt' && filter.gt) {
                    meiliParams.afterFinishedAt = new Date(filter.gt).toISOString();
                }
                else if (filter.attribute === 'canceledBy' && filter.eq) {
                    meiliParams.canceledBy = [filter.eq];
                }
                else if (filter.attribute === 'batchUid' && filter.eq) {
                    meiliParams.batchUids = [filter.eq];
                }
                else if (filter.attribute === 'batchUid' && filter.in) {
                    meiliParams.batchUids = filter.in;
                }
                else if (filter.attribute === 'entityName' && filter.eq) {
                    const entityName = filter.eq;
                    const indexName = this.entityNameToIndexName(entityName);
                    if (indexName) {
                        meiliParams.indexUids = [indexName];
                    }
                }
                else if (filter.attribute === 'entityName' && filter.in) {
                    const entityNames = filter.in;
                    const indexNames = entityNames.map(entityName => this.entityNameToIndexName(entityName));
                    meiliParams.indexUids = indexNames.filter(indexName => indexName !== undefined);
                }
            });
        }
        const tasks = await engine.getClient().tasks.getTasks(meiliParams);
        // Use MeiliSearch's next value for cursor, or create our own if not available
        let nextCursor = null;
        if (tasks.next) {
            // MeiliSearch provides the next offset
            nextCursor = Buffer.from(JSON.stringify({ offset: tasks.next })).toString('base64');
        }
        return res.json({
            meiliParams,
            cursor: nextCursor,
            items: tasks.results
        });
    }
    async getTask(req, res) {
        const { taskId } = req.pathParameters;
        const engine = this.getMeiliEngine();
        const task = await engine.waitForTask(Number(taskId));
        return res.json(task);
    }
    async cancelTask(req, res) {
        const { taskId } = req.pathParameters;
        const engine = this.getMeiliEngine();
        const task = await engine.cancelTasks({ uids: [Number(taskId)] });
        return res.json(task);
    }
    async cancelTasks(req, res) {
        const query = req.body;
        const engine = this.getMeiliEngine();
        const task = await engine.cancelTasks(query);
        return res.json(task);
    }
    async deleteTasks(req, res) {
        const query = req.body;
        const engine = this.getMeiliEngine();
        const task = await engine.deleteTasks(query);
        return res.json(task);
    }
    async deleteTask(req, res) {
        const { taskId } = req.pathParameters;
        const engine = this.getMeiliEngine();
        const task = await engine.deleteTasks({ uids: [Number(taskId)] });
        return res.json(task);
    }
    async getKeys(req, res) {
        const engine = this.getMeiliEngine();
        const { offset, limit, rest } = parseCursorPagination(req);
        // Use the same query parsing as entity controller
        const parsedQueryParams = (0, query_1.parseUrlQueryStringParameters)(rest);
        const filterGroup = (0, query_1.queryStringParamsToFilterGroup)(parsedQueryParams);
        const allKeys = await engine.getKeys();
        let keysArray = allKeys.results || allKeys;
        // Apply filters from filter group
        if (filterGroup.and) {
            filterGroup.and.forEach(filter => {
                if (filter.attribute === 'uid' && filter.eq) {
                    keysArray = keysArray.filter((key) => key.uid === filter.eq);
                }
                else if (filter.attribute === 'uid' && filter.in) {
                    keysArray = keysArray.filter((key) => filter.in.includes(key.uid));
                }
                else if (filter.attribute === 'name' && filter.eq) {
                    keysArray = keysArray.filter((key) => key.name === filter.eq);
                }
                else if (filter.attribute === 'name' && filter.contains) {
                    keysArray = keysArray.filter((key) => key.name && key.name.toLowerCase().includes(filter.contains[0].toLowerCase()));
                }
                else if (filter.attribute === 'name' && filter.startsWith) {
                    keysArray = keysArray.filter((key) => key.name && key.name.toLowerCase().startsWith(filter.startsWith[0].toLowerCase()));
                }
                else if (filter.attribute === 'description' && filter.contains) {
                    keysArray = keysArray.filter((key) => key.description && key.description.toLowerCase().includes(filter.contains[0].toLowerCase()));
                }
                else if (filter.attribute === 'description' && filter.eq) {
                    keysArray = keysArray.filter((key) => key.description === filter.eq);
                }
                else if (filter.attribute === 'key' && filter.contains) {
                    keysArray = keysArray.filter((key) => key.key && key.key.toLowerCase().includes(filter.contains[0].toLowerCase()));
                }
                else if (filter.attribute === 'key' && filter.startsWith) {
                    keysArray = keysArray.filter((key) => key.key && key.key.toLowerCase().startsWith(filter.startsWith[0].toLowerCase()));
                }
                else if (filter.attribute === 'actions' && filter.in) {
                    keysArray = keysArray.filter((key) => key.actions && key.actions.some((action) => filter.in.includes(action)));
                }
                else if (filter.attribute === 'indexes' && filter.in) {
                    keysArray = keysArray.filter((key) => key.indexes && key.indexes.some((index) => filter.in.includes(index)));
                }
                else if (filter.attribute === 'expiresAt' && filter.gt) {
                    keysArray = keysArray.filter((key) => key.expiresAt && new Date(key.expiresAt) > new Date(filter.gt));
                }
                else if (filter.attribute === 'expiresAt' && filter.lt) {
                    keysArray = keysArray.filter((key) => key.expiresAt && new Date(key.expiresAt) < new Date(filter.lt));
                }
                else if (filter.attribute === 'expiresAt' && filter.eq) {
                    keysArray = keysArray.filter((key) => key.expiresAt && new Date(key.expiresAt).toISOString().split('T')[0] === new Date(filter.eq).toISOString().split('T')[0]);
                }
                else if (filter.attribute === 'createdAt' && filter.gt) {
                    keysArray = keysArray.filter((key) => key.createdAt && new Date(key.createdAt) > new Date(filter.gt));
                }
                else if (filter.attribute === 'createdAt' && filter.lt) {
                    keysArray = keysArray.filter((key) => key.createdAt && new Date(key.createdAt) < new Date(filter.lt));
                }
                else if (filter.attribute === 'createdAt' && filter.eq) {
                    keysArray = keysArray.filter((key) => key.createdAt && new Date(key.createdAt).toISOString().split('T')[0] === new Date(filter.eq).toISOString().split('T')[0]);
                }
                else if (filter.attribute === 'updatedAt' && filter.gt) {
                    keysArray = keysArray.filter((key) => key.updatedAt && new Date(key.updatedAt) > new Date(filter.gt));
                }
                else if (filter.attribute === 'updatedAt' && filter.lt) {
                    keysArray = keysArray.filter((key) => key.updatedAt && new Date(key.updatedAt) < new Date(filter.lt));
                }
                else if (filter.attribute === 'updatedAt' && filter.eq) {
                    keysArray = keysArray.filter((key) => key.updatedAt && new Date(key.updatedAt).toISOString().split('T')[0] === new Date(filter.eq).toISOString().split('T')[0]);
                }
            });
        }
        const paginatedKeys = keysArray.slice(offset, offset + limit);
        const nextCursor = createNextCursor(offset, limit, offset + limit < keysArray.length);
        return res.json({
            cursor: nextCursor,
            items: paginatedKeys
        });
    }
    async getBatches(req, res) {
        const engine = this.getMeiliEngine();
        const { offset, limit, rest } = parseCursorPagination(req);
        // Use the same query parsing as entity controller
        const parsedQueryParams = (0, query_1.parseUrlQueryStringParameters)(rest);
        const filterGroup = (0, query_1.queryStringParamsToFilterGroup)(parsedQueryParams);
        // Convert filter group to MeiliSearch parameters
        const meiliParams = {
            limit,
            from: offset,
            reverse: false, // Get newest batches first
        };
        // Extract MeiliSearch parameters from filter group
        if (filterGroup.and) {
            filterGroup.and.forEach(filter => {
                if (filter.attribute === 'uid' && filter.eq) {
                    meiliParams.uids = [filter.eq];
                }
                else if (filter.attribute === 'uid' && filter.in) {
                    meiliParams.uids = filter.in;
                }
                else if (filter.attribute === 'batchUid' && filter.eq) {
                    meiliParams.batchUids = [filter.eq];
                }
                else if (filter.attribute === 'batchUid' && filter.in) {
                    meiliParams.batchUids = filter.in;
                }
                else if (filter.attribute === 'indexUid' && filter.eq) {
                    meiliParams.indexUids = [filter.eq];
                }
                else if (filter.attribute === 'indexUid' && filter.in) {
                    meiliParams.indexUids = filter.in;
                }
                else if (filter.attribute === 'status' && filter.eq) {
                    meiliParams.statuses = filter.eq;
                }
                else if (filter.attribute === 'status' && filter.in) {
                    meiliParams.statuses = filter.in;
                }
                else if (filter.attribute === 'types' && filter.eq) {
                    meiliParams.types = filter.eq;
                }
                else if (filter.attribute === 'types' && filter.in) {
                    meiliParams.types = filter.in;
                }
                else if (filter.attribute === 'startedAt' && filter.lt) {
                    meiliParams.beforeStartedAt = new Date(filter.lt).toISOString();
                }
                else if (filter.attribute === 'startedAt' && filter.gt) {
                    meiliParams.afterStartedAt = new Date(filter.gt).toISOString();
                }
                else if (filter.attribute === 'finishedAt' && filter.lt) {
                    meiliParams.beforeFinishedAt = new Date(filter.lt).toISOString();
                }
                else if (filter.attribute === 'finishedAt' && filter.gt) {
                    meiliParams.afterFinishedAt = new Date(filter.gt).toISOString();
                }
                else if (filter.attribute === 'entityName' && filter.eq) {
                    const entityName = filter.eq;
                    const indexName = this.entityNameToIndexName(entityName);
                    if (indexName) {
                        meiliParams.indexUids = [indexName];
                    }
                }
                else if (filter.attribute === 'entityName' && filter.in) {
                    const entityNames = filter.in;
                    const indexNames = entityNames.map(entityName => this.entityNameToIndexName(entityName));
                    meiliParams.indexUids = indexNames.filter(indexName => indexName !== undefined);
                }
            });
        }
        const batches = await engine.getBatches(meiliParams);
        // Use MeiliSearch's next value for cursor, or create our own if not available
        let nextCursor = null;
        if (batches.next) {
            // MeiliSearch provides the next offset
            nextCursor = Buffer.from(JSON.stringify({ offset: batches.next })).toString('base64');
        }
        const results = batches.results.map((batch) => {
            return {
                ...batch,
                status: batch.stats?.status,
                types: batch.stats?.types
            };
        });
        return res.json({
            meiliParams,
            items: results,
            cursor: nextCursor,
        });
    }
    async getBatch(req, res) {
        const { uid } = req.pathParameters;
        const engine = this.getMeiliEngine();
        const batch = await engine.getBatch(Number(uid));
        return res.json(batch);
    }
    async getKey(req, res) {
        const { keyOrUid } = req.pathParameters;
        const engine = this.getMeiliEngine();
        const key = await engine.getKey(keyOrUid);
        return res.json(key);
    }
    async createKey(req, res) {
        const options = req.body;
        const engine = this.getMeiliEngine();
        const key = await engine.createKey({
            ...options,
            expiresAt: options.expiresAt ? new Date(options.expiresAt) : undefined
        });
        return res.json(key);
    }
    async updateKey(req, res) {
        const { keyOrUid } = req.pathParameters;
        const options = req.body;
        const engine = this.getMeiliEngine();
        const key = await engine.updateKey(keyOrUid, options);
        return res.json(key);
    }
    async deleteKey(req, res) {
        const { keyOrUid } = req.pathParameters;
        const engine = this.getMeiliEngine();
        const task = await engine.deleteKey(keyOrUid);
        return res.json({
            task,
            message: 'Key deleted successfully'
        });
    }
};
exports.MeiliSearchSystemController = MeiliSearchSystemController;
__decorate([
    (0, decorators_1.Get)('/stats')
], MeiliSearchSystemController.prototype, "getStats", null);
__decorate([
    (0, decorators_1.Post)('/experimental-features', {
        validations: {
            body: {
                metrics: { datatype: 'boolean', required: false },
                network: { datatype: 'boolean', required: false },
                logsRoute: { datatype: 'boolean', required: false },
                containsFilter: { datatype: 'boolean', required: false },
                editDocumentsByFunction: { datatype: 'boolean', required: false },
            },
        },
    })
], MeiliSearchSystemController.prototype, "updateExperimentalFeatures", null);
__decorate([
    (0, decorators_1.Get)('/experimental-features')
], MeiliSearchSystemController.prototype, "getExperimentalFeatures", null);
__decorate([
    (0, decorators_1.Get)('/version')
], MeiliSearchSystemController.prototype, "getVersion", null);
__decorate([
    (0, decorators_1.Get)('/health')
], MeiliSearchSystemController.prototype, "getHealth", null);
__decorate([
    (0, decorators_1.Get)('/is-healthy')
], MeiliSearchSystemController.prototype, "isHealthy", null);
__decorate([
    (0, decorators_1.Post)('/dumps')
], MeiliSearchSystemController.prototype, "createDump", null);
__decorate([
    (0, decorators_1.Post)('/snapshots')
], MeiliSearchSystemController.prototype, "createSnapshot", null);
__decorate([
    (0, decorators_1.Post)('/indices/swap', {
        validations: {
            body: {
                swaps: { datatype: 'array', required: true },
            },
        },
    })
], MeiliSearchSystemController.prototype, "swapIndices", null);
__decorate([
    (0, decorators_1.Post)('/multi-search', {
        validations: {
            body: {
                queries: { datatype: 'array', required: true },
            },
        },
    })
], MeiliSearchSystemController.prototype, "multiSearch", null);
__decorate([
    (0, decorators_1.Get)('/index-documents/{indexName}')
], MeiliSearchSystemController.prototype, "getIndexDocuments", null);
__decorate([
    (0, decorators_1.Get)('/tasks')
], MeiliSearchSystemController.prototype, "getTasks", null);
__decorate([
    (0, decorators_1.Get)('/tasks/{taskId}')
], MeiliSearchSystemController.prototype, "getTask", null);
__decorate([
    (0, decorators_1.Get)('/tasks/{taskId}/cancel')
], MeiliSearchSystemController.prototype, "cancelTask", null);
__decorate([
    (0, decorators_1.Post)('/tasks/cancel')
], MeiliSearchSystemController.prototype, "cancelTasks", null);
__decorate([
    (0, decorators_1.Delete)('/tasks')
], MeiliSearchSystemController.prototype, "deleteTasks", null);
__decorate([
    (0, decorators_1.Delete)('/tasks/{taskId}')
], MeiliSearchSystemController.prototype, "deleteTask", null);
__decorate([
    (0, decorators_1.Get)('/api-keys')
], MeiliSearchSystemController.prototype, "getKeys", null);
__decorate([
    (0, decorators_1.Get)('/batches')
], MeiliSearchSystemController.prototype, "getBatches", null);
__decorate([
    (0, decorators_1.Get)('/batches/{uid}')
], MeiliSearchSystemController.prototype, "getBatch", null);
__decorate([
    (0, decorators_1.Get)('/api-keys/{keyOrUid}')
], MeiliSearchSystemController.prototype, "getKey", null);
__decorate([
    (0, decorators_1.Post)('/api-keys', {
        validations: {
            body: {
                name: { required: true },
                actions: { required: true },
                indexes: { required: true },
                expiresAt: { required: true },
            },
        },
    })
], MeiliSearchSystemController.prototype, "createKey", null);
__decorate([
    (0, decorators_1.Put)('/api-keys/{keyOrUid}')
], MeiliSearchSystemController.prototype, "updateKey", null);
__decorate([
    (0, decorators_1.Delete)('/api-keys/{keyOrUid}')
], MeiliSearchSystemController.prototype, "deleteKey", null);
exports.MeiliSearchSystemController = MeiliSearchSystemController = __decorate([
    (0, decorators_1.Controller)('system/search', {
    // Config will be merged from construct registration
    })
], MeiliSearchSystemController);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGlzZWFyY2gtY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvc3lzdGVtL21laWxpc2VhcmNoLWNvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsaURBQXNFO0FBRXRFLDJEQUE2RDtBQUM3RCx3Q0FBK0M7QUFDL0Msc0NBQThDO0FBRzlDLDZDQUFpRDtBQUNqRCw4Q0FBbUc7QUFFbkcsK0RBQStEO0FBQy9ELFNBQVMscUJBQXFCLENBQUMsR0FBWTtJQUN6QyxNQUFNLElBQUksR0FBRyxHQUFHLENBQUMscUJBQXFCLENBQUM7SUFDdkMsTUFBTSxFQUFFLE1BQU0sRUFBRSxLQUFLLEdBQUMsS0FBSyxFQUFFLEtBQUssR0FBQyxLQUFLLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxHQUFHLElBQUksRUFBRSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7SUFFcEYsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDO0lBQ2xCLElBQUksTUFBTSxFQUFFLENBQUM7UUFDWCxJQUFJLENBQUM7WUFDSCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7WUFDeEUsTUFBTSxHQUFHLFVBQVUsQ0FBQyxNQUFNLENBQUM7UUFDN0IsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZix1Q0FBdUM7UUFDekMsQ0FBQztJQUNILENBQUM7SUFFRCxzREFBc0Q7SUFDdEQsSUFBSSxXQUFXLElBQUksSUFBSSxFQUFFLENBQUM7UUFDeEIsTUFBTSxRQUFRLEdBQUcsSUFBQSxvQkFBWSxFQUFDLFdBQVcsRUFBRSxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUM7UUFDckQsTUFBTSxPQUFPLEdBQUcsSUFBQSxvQkFBWSxFQUFDLElBQUksRUFB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QUMsV0FBVyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUNuSSxDQUFDO2dCQUNKLENBQUM7cUJBQU0sSUFBSSxNQUFNLENBQUMsU0FBUyxLQUFLLFdBQVcsSUFBSSxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQ3pELFNBQVMsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FDeEMsR0FBRyxDQUFDLFNBQVMsSUFBSSxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQVksQ0FBQyxDQUN6RSxDQUFDO2dCQUNKLENBQUM7cUJBQU0sSUFBSSxNQUFNLENBQUMsU0FBUyxLQUFLLFdBQVcsSUFBSSxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQ3pELFNBQVMsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FDeEMsR0FBRyxDQUFDLFNBQVMsSUFBSSxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQVksQ0FBQyxDQUN6RSxDQUFDO2dCQUNKLENBQUM7cUJBQU0sSUFBSSxNQUFNLENBQUMsU0FBUyxLQUFLLFdBQVcsSUFBSSxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQ3pELFNBQVMsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FDeEMsR0FBRyxDQUFDLFNBQVMsSUFBSSxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFZLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFD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M0IsU0FBUyxFQUFFLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRTthQUM5QjtTQUNGO0tBQ0YsQ0FBQzs0REFZRDtBQUdLO0lBREwsSUFBQSxnQkFBRyxFQUFDLHNCQUFzQixDQUFDOzREQWdCM0I7QUFHSztJQURMLElBQUEsbUJBQU0sRUFBQyxzQkFBc0IsQ0FBQzs0REFTOUI7c0NBdmlCVSwyQkFBMkI7SUFIdkMsSUFBQSx1QkFBVSxFQUFDLGVBQWUsRUFBRTtJQUMzQixvREFBb0Q7S0FDckQsQ0FBQztHQUNXLDJCQUEyQixDQXdpQnZDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29udHJvbGxlciwgRGVsZXRlLCBHZXQsIFBvc3QsIFB1dCB9IGZyb20gJy4uLy4uL2RlY29yYXRvcnMnO1xuaW1wb3J0IHsgUmVxdWVzdCwgUmVzcG9uc2UgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IFNlYXJjaFN5c3RlbUNvbnRyb2xsZXIgfSBmcm9tICcuL3NlYXJjaC1jb250cm9sbGVyJztcbmltcG9ydCB7IE1laWxpU2VhcmNoRW5naW5lIH0gZnJvbSAnLi4vZW5naW5lcyc7XG5pbXBvcnQgeyBTZWFyY2hFbmdpbmVFcnJvciB9IGZyb20gJy4uL2Vycm9ycyc7XG5pbXBvcnQgeyBCYXNlRW50aXR5U2VydmljZSB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLXNlcnZpY2UnO1xuaW1wb3J0IHsgRGVsZXRlT3JDYW5jZWxUYXNrc1F1ZXJ5LCBEb2N1bWVudHNRdWVyeSwgU3RhdHMsIFRhc2tzT3JCYXRjaGVzUXVlcnkgfSBmcm9tICdtZWlsaXNlYXJjaCc7XG5pbXBvcnQgeyBzYWZlUGFyc2VJbnQgfSBmcm9tICcuLi8uLi91dGlscy9wYXJzZSc7XG5pbXBvcnQgeyBwYXJzZVVybFF1ZXJ5U3RyaW5nUGFyYW1ldGVycywgcXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwIH0gZnJvbSAnLi4vLi4vZW50aXR5L3F1ZXJ5JztcblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNvbnZlcnQgY3Vyc29yLWJhc2VkIHBhZ2luYXRpb24gdG8gb2Zmc2V0XG5mdW5jdGlvbiBwYXJzZUN1cnNvclBhZ2luYXRpb24ocmVxOiBSZXF1ZXN0KSB7XG4gIGNvbnN0IGRhdGEgPSByZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzO1xuICBjb25zdCB7IGN1cnNvciwgY291bnQ9XCIxMDBcIiwgbGltaXQ9XCIyNTBcIiwgaGl0c1BlclBhZ2UsIHBhZ2UsIC4uLnJlc3QgfSA9IGRhdGEgfHwge307XG4gIFxuICBsZXQgb2Zmc2V0ID0gbnVsbDtcbiAgaWYgKGN1cnNvcikge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjdXJzb3JEYXRhID0gSlNPTi5wYXJzZShCdWZmZXIuZnJvbShjdXJzb3IsICdiYXNlNjQnKS50b1N0cmluZygpKTtcbiAgICAgIG9mZnNldCA9IGN1cnNvckRhdGEub2Zmc2V0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBJbnZhbGlkIGN1cnNvciwgc3RhcnQgZnJvbSBiZWdpbm5pbmdcbiAgICB9XG4gIH1cbiAgXG4gIC8vIEhhbmRsZSBzZWFyY2gtc3R5bGUgcGFnaW5hdGlvbiAoaGl0c1BlclBhZ2UgKyBwYWdlKVxuICBpZiAoaGl0c1BlclBhZ2UgJiYgcGFnZSkge1xuICAgIGNvbnN0IHBhZ2VTaXplID0gc2FmZVBhcnNlSW50KGhpdHNQZXJQYWdlLCAyMCkudmFsdWU7XG4gICAgY29uc3QgcGFnZU51bSA9IHNhZmVQYXJzZUludChwYWdlLCAxKS52YWx1ZTtcbiAgICBvZmZzZXQgPSAocGFnZU51bSAtIDEpICogcGFnZVNpemU7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9mZnNldCxcbiAgICAgIGxpbWl0OiBwYWdlU2l6ZSxcbiAgICAgIHJlc3RcbiAgICB9O1xuICB9XG4gIFxuICAvLyBVc2UgY291bnQgYXMgcHJpbWFyeSwgbGltaXQgYXMgZmFsbGJhY2sgKHNhbWUgYXMgZW50aXR5IGNvbnRyb2xsZXIpXG4gIGNvbnN0IHBhZ2VTaXplID0gc2FmZVBhcnNlSW50KGNvdW50LCBzYWZlUGFyc2VJbnQobGltaXQsIDI1MCkudmFsdWUpLnZhbHVlO1xuICBcbiAgcmV0dXJuIHtcbiAgICBvZmZzZXQsXG4gICAgbGltaXQ6IHBhZ2VTaXplLFxuICAgIHJlc3RcbiAgfTtcbn1cblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBuZXh0IGN1cnNvclxuZnVuY3Rpb24gY3JlYXRlTmV4dEN1cnNvcihvZmZzZXQ6IG51bWJlciwgbGltaXQ6IG51bWJlciwgaGFzTW9yZTogYm9vbGVhbikge1xuICBpZiAoIWhhc01vcmUpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBuZXh0T2Zmc2V0ID0gb2Zmc2V0ICsgbGltaXQ7XG4gIHJldHVybiBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeSh7IG9mZnNldDogbmV4dE9mZnNldCB9KSkudG9TdHJpbmcoJ2Jhc2U2NCcpO1xufVxuXG4vLyogTm90ZTogdGhpcyBpcyBhIG1vcmUgZm9jdXNlZCBbdG93YXJkcyBtZWlsaXNlYXJjaF0gdmVyc2lvbiBvZiB0aGUgc2VhcmNoIGNvbnRyb2xsZXJcbi8vKiBhdCBhbnkgZ2l2ZW4gcG9pbnQgb25seSBvbmUgb2YgdGhlIGNvbnRyb2xsZXJzIHdpbGwgYmUgcmVnaXN0ZXJlZCB3aXRoIHRoZSBzYW1lIHJvdXRlXG5AQ29udHJvbGxlcignc3lzdGVtL3NlYXJjaCcsIHtcbiAgLy8gQ29uZmlnIHdpbGwgYmUgbWVyZ2VkIGZyb20gY29uc3RydWN0IHJlZ2lzdHJhdGlvblxufSlcbmV4cG9ydCBjbGFzcyBNZWlsaVNlYXJjaFN5c3RlbUNvbnRyb2xsZXIgZXh0ZW5kcyBTZWFyY2hTeXN0ZW1Db250cm9sbGVyIHtcblxuICBwcml2YXRlIGdldE1laWxpRW5naW5lKCk6IE1laWxpU2VhcmNoRW5naW5lIHtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmNvbnRhaW5lci5yZXNvbHZlU2VhcmNoRW5naW5lKCk7XG5cbiAgICBpZiAoZW5naW5lIGluc3RhbmNlb2YgTWVpbGlTZWFyY2hFbmdpbmUpIHtcbiAgICAgIHJldHVybiBlbmdpbmU7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IFNlYXJjaEVuZ2luZUVycm9yKCdDb3VsZCBub3QgcmVzb2x2ZSBNZWlsaVNlYXJjaEVuZ2luZSBmcm9tIGRpLWNvbnRhaW5lcicpO1xuICB9XG5cbiAgQEdldCgnL3N0YXRzJylcbiAgYXN5bmMgZ2V0U3RhdHMocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgeyBpbmNsdWRlSW5kZXhlcyA9IHRydWUgfSA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnMgfHwge307XG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIFxuICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZW5naW5lLmdldFN0YXRzPFN0YXRzPigpO1xuXG4gICAgY29uc3QgeyBpbmRleGVzLCAuLi5yZXN0IH0gPSBzdGF0cztcblxuICAgIGlmICghaW5jbHVkZUluZGV4ZXMpIHtcbiAgICAgIHJldHVybiByZXMuanNvbihyZXN0KTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHJlcy5qc29uKHN0YXRzKTtcbiAgfVxuXG4gIEBQb3N0KCcvZXhwZXJpbWVudGFsLWZlYXR1cmVzJywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIG1ldHJpY3M6IHsgZGF0YXR5cGU6ICdib29sZWFuJywgcmVxdWlyZWQ6IGZhbHNlIH0sXG4gICAgICAgIG5ldHdvcms6IHsgZGF0YXR5cGU6ICdib29sZWFuJywgcmVxdWlyZWQ6IGZhbHNlIH0sXG4gICAgICAgIGxvZ3NSb3V0ZTogeyBkYXRhdHlwZTogJ2Jvb2xlYW4nLCByZXF1aXJlZDogZmFsc2UgfSxcbiAgICAgICAgY29udGFpbnNGaWx0ZXI6IHsgZGF0YXR5cGU6ICdib29sZWFuJywgcmVxdWlyZWQ6IGZhbHNlIH0sXG4gICAgICAgIGVkaXREb2N1bWVudHNCeUZ1bmN0aW9uOiB7IGRhdGF0eXBlOiAnYm9vbGVhbicsIHJlcXVpcmVkOiBmYWxzZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyB1cGRhdGVFeHBlcmltZW50YWxGZWF0dXJlcyhyZXE6IFJlcXVlc3Q8eyBib2R5OiB7IG1ldHJpY3M/OiBib29sZWFuLCBsb2dzUm91dGU/OiBib29sZWFuLCBjb250YWluc0ZpbHRlcj86IGJvb2xlYW4sIGVkaXREb2N1bWVudHNCeUZ1bmN0aW9uPzogYm9vbGVhbiwgbmV0d29yaz86IGJvb2xlYW4gfSB9PiwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IHsgbWV0cmljcyA9IGZhbHNlLCBsb2dzUm91dGUgPSBmYWxzZSwgY29udGFpbnNGaWx0ZXIgPSBmYWxzZSwgZWRpdERvY3VtZW50c0J5RnVuY3Rpb24gPSBmYWxzZSwgbmV0d29yayA9IGZhbHNlIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgdGFzayA9IGF3YWl0IGVuZ2luZS5zZXRFeHBlcmltZW50YWxGZWF0dXJlc1N0YXR1cyh7XG4gICAgICBtZXRyaWNzLFxuICAgICAgbmV0d29yayxcbiAgICAgIGxvZ3NSb3V0ZSxcbiAgICAgIGNvbnRhaW5zRmlsdGVyLFxuICAgICAgZWRpdERvY3VtZW50c0J5RnVuY3Rpb24sXG4gICAgfSk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHRhc2spO1xuICB9XG5cbiAgQEdldCgnL2V4cGVyaW1lbnRhbC1mZWF0dXJlcycpXG4gIGFzeW5jIGdldEV4cGVyaW1lbnRhbEZlYXR1cmVzKF9yZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgZmVhdHVyZXMgPSBhd2FpdCBlbmdpbmUuZ2V0RXhwZXJpbWVudGFsRmVhdHVyZXMoKTtcbiAgICByZXR1cm4gcmVzLmpzb24oZmVhdHVyZXMpO1xuICB9XG5cbiAgQEdldCgnL3ZlcnNpb24nKVxuICBhc3luYyBnZXRWZXJzaW9uKF9yZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgdmVyc2lvbiA9IGF3YWl0IGVuZ2luZS5nZXRWZXJzaW9uKCk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHZlcnNpb24pO1xuICB9XG5cbiAgQEdldCgnL2hlYWx0aCcpXG4gIGFzeW5jIGdldEhlYWx0aChfcmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IGhlYWx0aCA9IGF3YWl0IGVuZ2luZS5oZWFsdGgoKTtcbiAgICByZXR1cm4gcmVzLmpzb24oaGVhbHRoKTtcbiAgfVxuXG4gIEBHZXQoJy9pcy1oZWFsdGh5JylcbiAgYXN5bmMgaXNIZWFsdGh5KF9yZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgaXNIZWFsdGh5ID0gYXdhaXQgZW5naW5lLmlzSGVhbHRoeSgpO1xuICAgIHJldHVybiByZXMuanNvbih7IGlzSGVhbHRoeSB9KTtcbiAgfVxuXG4gIEBQb3N0KCcvZHVtcHMnKVxuICBhc3luYyBjcmVhdGVEdW1wKF9yZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgdGFzayA9IGF3YWl0IGVuZ2luZS5jcmVhdGVEdW1wKCk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHRhc2spO1xuICB9XG5cbiAgQFBvc3QoJy9zbmFwc2hvdHMnKVxuICBhc3luYyBjcmVhdGVTbmFwc2hvdChfcmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IHRhc2sgPSBhd2FpdCBlbmdpbmUuY3JlYXRlU25hcHNob3QoKTtcbiAgICByZXR1cm4gcmVzLmpzb24odGFzayk7XG4gIH1cblxuICBAUG9zdCgnL2luZGljZXMvc3dhcCcsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBzd2FwczogeyBkYXRhdHlwZTogJ2FycmF5JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgc3dhcEluZGljZXMocmVxOiBSZXF1ZXN0PHsgYm9keTogeyBzd2FwczogWyBzdHJpbmcsIHN0cmluZyBdW10gfSB9PiwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IHsgc3dhcHMgfSA9IHJlcS5ib2R5O1xuXG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IHRhc2sgPSBhd2FpdCBlbmdpbmUuc3dhcEluZGV4ZXMoXG4gICAgICBzd2Fwcy5tYXAocGFpciA9PiAoeyBpbmRleGVzOiBwYWlyIH0pKSxcbiAgICAgIHRydWVcbiAgICApO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHRhc2spO1xuICB9XG5cbiAgQFBvc3QoJy9tdWx0aS1zZWFyY2gnLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgcXVlcmllczogeyBkYXRhdHlwZTogJ2FycmF5JywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgbXVsdGlTZWFyY2goXG4gICAgcmVxOiBSZXF1ZXN0PHsgYm9keTogeyBxdWVyaWVzOiBhbnlbXSB9IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgeyBxdWVyaWVzIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IGVuZ2luZS5tdWx0aVNlYXJjaChxdWVyaWVzKTtcbiAgICByZXR1cm4gcmVzLmpzb24ocmVzdWx0cyk7XG4gIH1cblxuICBAR2V0KCcvaW5kZXgtZG9jdW1lbnRzL3tpbmRleE5hbWV9JylcbiAgYXN5bmMgZ2V0SW5kZXhEb2N1bWVudHMoXG4gICAgcmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBpbmRleE5hbWU6IHN0cmluZyB9LCBxdWVyeTogRG9jdW1lbnRzUXVlcnk8YW55PiB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuXG4gICAgY29uc3QgeyBpbmRleE5hbWUgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCBvcHRpb25zID0gcmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVycztcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG5cbiAgICBjb25zdCBkb2N1bWVudHMgPSBhd2FpdCBlbmdpbmUuZ2V0RG9jdW1lbnRzKGluZGV4TmFtZSwge1xuICAgICAgLy8gZXh0cmFjdCBtYW51YWxseSB0byBhdm9pZCB1bndhbnRlZCBrZXlzIGVycm9yc1xuICAgICAgaWRzOiBvcHRpb25zLmlkcyxcbiAgICAgIGxpbWl0OiBvcHRpb25zLmxpbWl0LFxuICAgICAgb2Zmc2V0OiBvcHRpb25zLm9mZnNldCxcbiAgICAgIGZpbHRlcjogb3B0aW9ucy5maWx0ZXIsXG4gICAgICBmaWVsZHM6IG9wdGlvbnMuZmllbGRzLFxuICAgICAgcmV0cmlldmVWZWN0b3JzOiBvcHRpb25zLnJldHJpZXZlVmVjdG9ycyxcbiAgICB9KTtcblxuICAgIHJldHVybiByZXMuanNvbih7IGRvY3VtZW50cyB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZW50aXR5TmFtZVRvSW5kZXhOYW1lKGVudGl0eU5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlYXJjaFNlcnZpY2UoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgaW5kZXhJbmZvID0gc2VhcmNoU2VydmljZS5nZXRTZWFyY2hJbmRleENvbmZpZygpO1xuXG4gICAgaWYgKGluZGV4SW5mbykge1xuICAgICAgcmV0dXJuIGluZGV4SW5mby5pbmRleE5hbWU7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbmRleCBub3QgZm91bmQgZm9yIGVudGl0eSAke2VudGl0eU5hbWV9YCk7XG4gIH1cblxuICBAR2V0KCcvdGFza3MnKVxuICBhc3luYyBnZXRUYXNrcyhyZXE6IFJlcXVlc3Q8eyBxdWVyeTogVGFza3NPckJhdGNoZXNRdWVyeSB9PiwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCB7IG9mZnNldCwgbGltaXQsIHJlc3QgfSA9IHBhcnNlQ3Vyc29yUGFnaW5hdGlvbihyZXEpO1xuXG4gICAgLy8gVXNlIHRoZSBzYW1lIHF1ZXJ5IHBhcnNpbmcgYXMgZW50aXR5IGNvbnRyb2xsZXJcbiAgICBjb25zdCBwYXJzZWRRdWVyeVBhcmFtcyA9IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzKHJlc3QpO1xuICAgIGNvbnN0IGZpbHRlckdyb3VwID0gcXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwKHBhcnNlZFF1ZXJ5UGFyYW1zKTtcblxuICAgIC8vIENvbnZlcnQgZmlsdGVyIGdyb3VwIHRvIE1laWxpU2VhcmNoIHBhcmFtZXRlcnNcbiAgICBjb25zdCBtZWlsaVBhcmFtczogVGFza3NPckJhdGNoZXNRdWVyeSA9IHtcbiAgICAgIGxpbWl0LFxuICAgICAgZnJvbTogb2Zmc2V0LFxuICAgICAgcmV2ZXJzZTogZmFsc2UsIC8vIEdldCBuZXdlc3QgdGFza3MgZmlyc3RcbiAgICB9O1xuXG4gICAgLy8gRXh0cmFjdCBNZWlsaVNlYXJjaCBwYXJhbWV0ZXJzIGZyb20gZmlsdGVyIGdyb3VwXG4gICAgaWYgKGZpbHRlckdyb3VwLmFuZCkge1xuICAgICAgZmlsdGVyR3JvdXAuYW5kLmZvckVhY2goZmlsdGVyID0+IHtcbiAgICAgICAgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICd0eXBlJyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy50eXBlcyA9IGZpbHRlci5lcSBhcyBhbnk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3R5cGUnICYmIGZpbHRlci5pbikge1xuICAgICAgICAgIG1laWxpUGFyYW1zLnR5cGVzID0gZmlsdGVyLmluIGFzIGFueTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnc3RhdHVzJyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5zdGF0dXNlcyA9IGZpbHRlci5lcSBhcyBhbnk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3N0YXR1cycgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuc3RhdHVzZXMgPSBmaWx0ZXIuaW4gYXMgYW55O1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICd1aWQnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLnVpZHMgPSBbZmlsdGVyLmVxIGFzIG51bWJlcl07XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3VpZCcgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMudWlkcyA9IGZpbHRlci5pbiBhcyBudW1iZXJbXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnaW5kZXhVaWQnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLmluZGV4VWlkcyA9IFtmaWx0ZXIuZXEgYXMgc3RyaW5nXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnaW5kZXhVaWQnICYmIGZpbHRlci5pbikge1xuICAgICAgICAgIG1laWxpUGFyYW1zLmluZGV4VWlkcyA9IGZpbHRlci5pbiBhcyBzdHJpbmdbXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZW5xdWV1ZWRBdCcgJiYgZmlsdGVyLmx0KSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYmVmb3JlRW5xdWV1ZWRBdCA9IG5ldyBEYXRlKGZpbHRlci5sdCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZW5xdWV1ZWRBdCcgJiYgZmlsdGVyLmd0KSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYWZ0ZXJFbnF1ZXVlZEF0ID0gbmV3IERhdGUoZmlsdGVyLmd0KS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdzdGFydGVkQXQnICYmIGZpbHRlci5sdCkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLmJlZm9yZVN0YXJ0ZWRBdCA9IG5ldyBEYXRlKGZpbHRlci5sdCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnc3RhcnRlZEF0JyAmJiBmaWx0ZXIuZ3QpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5hZnRlclN0YXJ0ZWRBdCA9IG5ldyBEYXRlKGZpbHRlci5ndCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZmluaXNoZWRBdCcgJiYgZmlsdGVyLmx0KSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYmVmb3JlRmluaXNoZWRBdCA9IG5ldyBEYXRlKGZpbHRlci5sdCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZmluaXNoZWRBdCcgJiYgZmlsdGVyLmd0KSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYWZ0ZXJGaW5pc2hlZEF0ID0gbmV3IERhdGUoZmlsdGVyLmd0KS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdjYW5jZWxlZEJ5JyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5jYW5jZWxlZEJ5ID0gW2ZpbHRlci5lcSBhcyBudW1iZXJdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdiYXRjaFVpZCcgJiYgZmlsdGVyLmVxKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYmF0Y2hVaWRzID0gW2ZpbHRlci5lcSBhcyBudW1iZXJdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdiYXRjaFVpZCcgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYmF0Y2hVaWRzID0gZmlsdGVyLmluIGFzIG51bWJlcltdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdlbnRpdHlOYW1lJyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBjb25zdCBlbnRpdHlOYW1lID0gZmlsdGVyLmVxIGFzIHN0cmluZztcbiAgICAgICAgICBjb25zdCBpbmRleE5hbWUgPSB0aGlzLmVudGl0eU5hbWVUb0luZGV4TmFtZShlbnRpdHlOYW1lKTtcbiAgICAgICAgICBpZiAoaW5kZXhOYW1lKSB7XG4gICAgICAgICAgICBtZWlsaVBhcmFtcy5pbmRleFVpZHMgPSBbaW5kZXhOYW1lXTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2VudGl0eU5hbWUnICYmIGZpbHRlci5pbikge1xuICAgICAgICAgIGNvbnN0IGVudGl0eU5hbWVzID0gZmlsdGVyLmluIGFzIHN0cmluZ1tdO1xuICAgICAgICAgIGNvbnN0IGluZGV4TmFtZXMgPSBlbnRpdHlOYW1lcy5tYXAoZW50aXR5TmFtZSA9PiB0aGlzLmVudGl0eU5hbWVUb0luZGV4TmFtZShlbnRpdHlOYW1lKSk7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuaW5kZXhVaWRzID0gaW5kZXhOYW1lcy5maWx0ZXIoaW5kZXhOYW1lID0+IGluZGV4TmFtZSAhPT0gdW5kZWZpbmVkKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgdGFza3MgPSBhd2FpdCBlbmdpbmUuZ2V0Q2xpZW50KCkudGFza3MuZ2V0VGFza3MobWVpbGlQYXJhbXMpO1xuICAgIFxuICAgIC8vIFVzZSBNZWlsaVNlYXJjaCdzIG5leHQgdmFsdWUgZm9yIGN1cnNvciwgb3IgY3JlYXRlIG91ciBvd24gaWYgbm90IGF2YWlsYWJsZVxuICAgIGxldCBuZXh0Q3Vyc29yID0gbnVsbDtcbiAgICBpZiAodGFza3MubmV4dCkge1xuICAgICAgLy8gTWVpbGlTZWFyY2ggcHJvdmlkZXMgdGhlIG5leHQgb2Zmc2V0XG4gICAgICBuZXh0Q3Vyc29yID0gQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkoeyBvZmZzZXQ6IHRhc2tzLm5leHQgfSkpLnRvU3RyaW5nKCdiYXNlNjQnKTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIG1laWxpUGFyYW1zLFxuICAgICAgY3Vyc29yOiBuZXh0Q3Vyc29yLFxuICAgICAgaXRlbXM6IHRhc2tzLnJlc3VsdHNcbiAgICB9KTtcbiAgfVxuXG4gIEBHZXQoJy90YXNrcy97dGFza0lkfScpXG4gIGFzeW5jIGdldFRhc2socmVxOiBSZXF1ZXN0PHsgcGF0aDogeyB0YXNrSWQ6IG51bWJlciB9IH0+LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgeyB0YXNrSWQgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcblxuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCB0YXNrID0gYXdhaXQgZW5naW5lLndhaXRGb3JUYXNrKE51bWJlcih0YXNrSWQpKTtcblxuICAgIHJldHVybiByZXMuanNvbih0YXNrKTtcbiAgfVxuXG4gIEBHZXQoJy90YXNrcy97dGFza0lkfS9jYW5jZWwnKVxuICBhc3luYyBjYW5jZWxUYXNrKHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgdGFza0lkOiBzdHJpbmcgfSB9PiwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IHsgdGFza0lkIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IHRhc2sgPSBhd2FpdCBlbmdpbmUuY2FuY2VsVGFza3MoeyB1aWRzOiBbIE51bWJlcih0YXNrSWQpIF0gfSk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHRhc2spO1xuICB9XG5cbiAgQFBvc3QoJy90YXNrcy9jYW5jZWwnKVxuICBhc3luYyBjYW5jZWxUYXNrcyhyZXE6IFJlcXVlc3Q8eyBib2R5OiBEZWxldGVPckNhbmNlbFRhc2tzUXVlcnkgfT4sIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBxdWVyeSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCB0YXNrID0gYXdhaXQgZW5naW5lLmNhbmNlbFRhc2tzKHF1ZXJ5KTtcbiAgICByZXR1cm4gcmVzLmpzb24odGFzayk7XG4gIH1cblxuICBARGVsZXRlKCcvdGFza3MnKVxuICBhc3luYyBkZWxldGVUYXNrcyhyZXE6IFJlcXVlc3Q8eyBib2R5OiBEZWxldGVPckNhbmNlbFRhc2tzUXVlcnkgfT4sIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBxdWVyeSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCB0YXNrID0gYXdhaXQgZW5naW5lLmRlbGV0ZVRhc2tzKHF1ZXJ5KTtcbiAgICByZXR1cm4gcmVzLmpzb24odGFzayk7XG4gIH1cblxuICBARGVsZXRlKCcvdGFza3Mve3Rhc2tJZH0nKVxuICBhc3luYyBkZWxldGVUYXNrKHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgdGFza0lkOiBzdHJpbmcgfSB9PiwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IHsgdGFza0lkIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IHRhc2sgPSBhd2FpdCBlbmdpbmUuZGVsZXRlVGFza3MoeyB1aWRzOiBbIE51bWJlcih0YXNrSWQpIF0gfSk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHRhc2spO1xuICB9XG5cbiAgQEdldCgnL2FwaS1rZXlzJylcbiAgYXN5bmMgZ2V0S2V5cyhyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgeyBvZmZzZXQsIGxpbWl0LCByZXN0IH0gPSBwYXJzZUN1cnNvclBhZ2luYXRpb24ocmVxKTtcblxuICAgIC8vIFVzZSB0aGUgc2FtZSBxdWVyeSBwYXJzaW5nIGFzIGVudGl0eSBjb250cm9sbGVyXG4gICAgY29uc3QgcGFyc2VkUXVlcnlQYXJhbXMgPSBwYXJzZVVybFF1ZXJ5U3RyaW5nUGFyYW1ldGVycyhyZXN0KTtcbiAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cChwYXJzZWRRdWVyeVBhcmFtcyk7XG5cbiAgICBjb25zdCBhbGxLZXlzID0gYXdhaXQgZW5naW5lLmdldEtleXMoKTtcbiAgICBsZXQga2V5c0FycmF5ID0gKGFsbEtleXMgYXMgYW55KS5yZXN1bHRzIHx8IGFsbEtleXM7XG4gICAgXG4gICAgLy8gQXBwbHkgZmlsdGVycyBmcm9tIGZpbHRlciBncm91cFxuICAgIGlmIChmaWx0ZXJHcm91cC5hbmQpIHtcbiAgICAgIGZpbHRlckdyb3VwLmFuZC5mb3JFYWNoKGZpbHRlciA9PiB7XG4gICAgICAgIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAndWlkJyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkudWlkID09PSBmaWx0ZXIuZXFcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICd1aWQnICYmIGZpbHRlci5pbikge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIChmaWx0ZXIuaW4gYXMgc3RyaW5nW10pLmluY2x1ZGVzKGtleS51aWQpXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnbmFtZScgJiYgZmlsdGVyLmVxKSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5Lm5hbWUgPT09IGZpbHRlci5lcVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ25hbWUnICYmIGZpbHRlci5jb250YWlucykge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIGtleS5uYW1lICYmIGtleS5uYW1lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoKGZpbHRlci5jb250YWlucyBhcyBzdHJpbmdbXSlbMF0udG9Mb3dlckNhc2UoKSlcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICduYW1lJyAmJiBmaWx0ZXIuc3RhcnRzV2l0aCkge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIGtleS5uYW1lICYmIGtleS5uYW1lLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aCgoZmlsdGVyLnN0YXJ0c1dpdGggYXMgc3RyaW5nW10pWzBdLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZGVzY3JpcHRpb24nICYmIGZpbHRlci5jb250YWlucykge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIGtleS5kZXNjcmlwdGlvbiAmJiBrZXkuZGVzY3JpcHRpb24udG9Mb3dlckNhc2UoKS5pbmNsdWRlcygoZmlsdGVyLmNvbnRhaW5zIGFzIHN0cmluZ1tdKVswXS50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2Rlc2NyaXB0aW9uJyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkuZGVzY3JpcHRpb24gPT09IGZpbHRlci5lcVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2tleScgJiYgZmlsdGVyLmNvbnRhaW5zKSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5LmtleSAmJiBrZXkua2V5LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoKGZpbHRlci5jb250YWlucyBhcyBzdHJpbmdbXSlbMF0udG9Mb3dlckNhc2UoKSlcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdrZXknICYmIGZpbHRlci5zdGFydHNXaXRoKSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5LmtleSAmJiBrZXkua2V5LnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aCgoZmlsdGVyLnN0YXJ0c1dpdGggYXMgc3RyaW5nW10pWzBdLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnYWN0aW9ucycgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5LmFjdGlvbnMgJiYga2V5LmFjdGlvbnMuc29tZSgoYWN0aW9uOiBhbnkpID0+IChmaWx0ZXIuaW4gYXMgc3RyaW5nW10pLmluY2x1ZGVzKGFjdGlvbikpXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnaW5kZXhlcycgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5LmluZGV4ZXMgJiYga2V5LmluZGV4ZXMuc29tZSgoaW5kZXg6IGFueSkgPT4gKGZpbHRlci5pbiBhcyBzdHJpbmdbXSkuaW5jbHVkZXMoaW5kZXgpKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2V4cGlyZXNBdCcgJiYgZmlsdGVyLmd0KSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5LmV4cGlyZXNBdCAmJiBuZXcgRGF0ZShrZXkuZXhwaXJlc0F0KSA+IG5ldyBEYXRlKGZpbHRlci5ndCBhcyBzdHJpbmcpXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZXhwaXJlc0F0JyAmJiBmaWx0ZXIubHQpIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkuZXhwaXJlc0F0ICYmIG5ldyBEYXRlKGtleS5leHBpcmVzQXQpIDwgbmV3IERhdGUoZmlsdGVyLmx0IGFzIHN0cmluZylcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdleHBpcmVzQXQnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIGtleS5leHBpcmVzQXQgJiYgbmV3IERhdGUoa2V5LmV4cGlyZXNBdCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdID09PSBuZXcgRGF0ZShmaWx0ZXIuZXEgYXMgc3RyaW5nKS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF1cbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdjcmVhdGVkQXQnICYmIGZpbHRlci5ndCkge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIGtleS5jcmVhdGVkQXQgJiYgbmV3IERhdGUoa2V5LmNyZWF0ZWRBdCkgPiBuZXcgRGF0ZShmaWx0ZXIuZ3QgYXMgc3RyaW5nKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2NyZWF0ZWRBdCcgJiYgZmlsdGVyLmx0KSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5LmNyZWF0ZWRBdCAmJiBuZXcgRGF0ZShrZXkuY3JlYXRlZEF0KSA8IG5ldyBEYXRlKGZpbHRlci5sdCBhcyBzdHJpbmcpXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnY3JlYXRlZEF0JyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkuY3JlYXRlZEF0ICYmIG5ldyBEYXRlKGtleS5jcmVhdGVkQXQpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXSA9PT0gbmV3IERhdGUoZmlsdGVyLmVxIGFzIHN0cmluZykudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAndXBkYXRlZEF0JyAmJiBmaWx0ZXIuZ3QpIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkudXBkYXRlZEF0ICYmIG5ldyBEYXRlKGtleS51cGRhdGVkQXQpID4gbmV3IERhdGUoZmlsdGVyLmd0IGFzIHN0cmluZylcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICd1cGRhdGVkQXQnICYmIGZpbHRlci5sdCkge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIGtleS51cGRhdGVkQXQgJiYgbmV3IERhdGUoa2V5LnVwZGF0ZWRBdCkgPCBuZXcgRGF0ZShmaWx0ZXIubHQgYXMgc3RyaW5nKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3VwZGF0ZWRBdCcgJiYgZmlsdGVyLmVxKSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5LnVwZGF0ZWRBdCAmJiBuZXcgRGF0ZShrZXkudXBkYXRlZEF0KS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF0gPT09IG5ldyBEYXRlKGZpbHRlci5lcSBhcyBzdHJpbmcpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICBjb25zdCBwYWdpbmF0ZWRLZXlzID0ga2V5c0FycmF5LnNsaWNlKG9mZnNldCwgb2Zmc2V0ICsgbGltaXQpO1xuICAgIGNvbnN0IG5leHRDdXJzb3IgPSBjcmVhdGVOZXh0Q3Vyc29yKG9mZnNldCwgbGltaXQsIG9mZnNldCArIGxpbWl0IDwga2V5c0FycmF5Lmxlbmd0aCk7XG4gICAgXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIGN1cnNvcjogbmV4dEN1cnNvcixcbiAgICAgIGl0ZW1zOiBwYWdpbmF0ZWRLZXlzXG4gICAgfSk7XG4gIH1cblxuICBAR2V0KCcvYmF0Y2hlcycpXG4gIGFzeW5jIGdldEJhdGNoZXMocmVxOiBSZXF1ZXN0PHsgcXVlcnk6IFRhc2tzT3JCYXRjaGVzUXVlcnkgfT4sIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgeyBvZmZzZXQsIGxpbWl0LCByZXN0IH0gPSBwYXJzZUN1cnNvclBhZ2luYXRpb24ocmVxKTtcblxuICAgIC8vIFVzZSB0aGUgc2FtZSBxdWVyeSBwYXJzaW5nIGFzIGVudGl0eSBjb250cm9sbGVyXG4gICAgY29uc3QgcGFyc2VkUXVlcnlQYXJhbXMgPSBwYXJzZVVybFF1ZXJ5U3RyaW5nUGFyYW1ldGVycyhyZXN0KTtcbiAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cChwYXJzZWRRdWVyeVBhcmFtcyk7XG5cbiAgICAvLyBDb252ZXJ0IGZpbHRlciBncm91cCB0byBNZWlsaVNlYXJjaCBwYXJhbWV0ZXJzXG4gICAgY29uc3QgbWVpbGlQYXJhbXM6IFRhc2tzT3JCYXRjaGVzUXVlcnkgPSB7XG4gICAgICBsaW1pdCxcbiAgICAgIGZyb206IG9mZnNldCxcbiAgICAgIHJldmVyc2U6IGZhbHNlLCAvLyBHZXQgbmV3ZXN0IGJhdGNoZXMgZmlyc3RcbiAgICB9O1xuXG4gICAgLy8gRXh0cmFjdCBNZWlsaVNlYXJjaCBwYXJhbWV0ZXJzIGZyb20gZmlsdGVyIGdyb3VwXG4gICAgaWYgKGZpbHRlckdyb3VwLmFuZCkge1xuICAgICAgZmlsdGVyR3JvdXAuYW5kLmZvckVhY2goZmlsdGVyID0+IHtcbiAgICAgICAgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICd1aWQnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLnVpZHMgPSBbZmlsdGVyLmVxIGFzIG51bWJlcl07XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3VpZCcgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMudWlkcyA9IGZpbHRlci5pbiBhcyBudW1iZXJbXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnYmF0Y2hVaWQnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLmJhdGNoVWlkcyA9IFtmaWx0ZXIuZXEgYXMgbnVtYmVyXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnYmF0Y2hVaWQnICYmIGZpbHRlci5pbikge1xuICAgICAgICAgIG1laWxpUGFyYW1zLmJhdGNoVWlkcyA9IGZpbHRlci5pbiBhcyBudW1iZXJbXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnaW5kZXhVaWQnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLmluZGV4VWlkcyA9IFtmaWx0ZXIuZXEgYXMgc3RyaW5nXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnaW5kZXhVaWQnICYmIGZpbHRlci5pbikge1xuICAgICAgICAgIG1laWxpUGFyYW1zLmluZGV4VWlkcyA9IGZpbHRlci5pbiBhcyBzdHJpbmdbXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnc3RhdHVzJyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5zdGF0dXNlcyA9IGZpbHRlci5lcSBhcyBhbnk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3N0YXR1cycgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuc3RhdHVzZXMgPSBmaWx0ZXIuaW4gYXMgYW55O1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICd0eXBlcycgJiYgZmlsdGVyLmVxKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMudHlwZXMgPSBmaWx0ZXIuZXEgYXMgYW55O1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICd0eXBlcycgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMudHlwZXMgPSBmaWx0ZXIuaW4gYXMgYW55O1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdzdGFydGVkQXQnICYmIGZpbHRlci5sdCkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLmJlZm9yZVN0YXJ0ZWRBdCA9IG5ldyBEYXRlKGZpbHRlci5sdCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnc3RhcnRlZEF0JyAmJiBmaWx0ZXIuZ3QpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5hZnRlclN0YXJ0ZWRBdCA9IG5ldyBEYXRlKGZpbHRlci5ndCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZmluaXNoZWRBdCcgJiYgZmlsdGVyLmx0KSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYmVmb3JlRmluaXNoZWRBdCA9IG5ldyBEYXRlKGZpbHRlci5sdCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZmluaXNoZWRBdCcgJiYgZmlsdGVyLmd0KSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYWZ0ZXJGaW5pc2hlZEF0ID0gbmV3IERhdGUoZmlsdGVyLmd0KS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdlbnRpdHlOYW1lJyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBjb25zdCBlbnRpdHlOYW1lID0gZmlsdGVyLmVxIGFzIHN0cmluZztcbiAgICAgICAgICBjb25zdCBpbmRleE5hbWUgPSB0aGlzLmVudGl0eU5hbWVUb0luZGV4TmFtZShlbnRpdHlOYW1lKTtcbiAgICAgICAgICBpZiAoaW5kZXhOYW1lKSB7XG4gICAgICAgICAgICBtZWlsaVBhcmFtcy5pbmRleFVpZHMgPSBbIGluZGV4TmFtZSBdO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZW50aXR5TmFtZScgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgY29uc3QgZW50aXR5TmFtZXMgPSBmaWx0ZXIuaW4gYXMgc3RyaW5nW107XG4gICAgICAgICAgY29uc3QgaW5kZXhOYW1lcyA9IGVudGl0eU5hbWVzLm1hcChlbnRpdHlOYW1lID0+IHRoaXMuZW50aXR5TmFtZVRvSW5kZXhOYW1lKGVudGl0eU5hbWUpKTtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5pbmRleFVpZHMgPSBpbmRleE5hbWVzLmZpbHRlcihpbmRleE5hbWUgPT4gaW5kZXhOYW1lICE9PSB1bmRlZmluZWQpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBiYXRjaGVzID0gYXdhaXQgZW5naW5lLmdldEJhdGNoZXMobWVpbGlQYXJhbXMpO1xuICAgIFxuICAgIC8vIFVzZSBNZWlsaVNlYXJjaCdzIG5leHQgdmFsdWUgZm9yIGN1cnNvciwgb3IgY3JlYXRlIG91ciBvd24gaWYgbm90IGF2YWlsYWJsZVxuICAgIGxldCBuZXh0Q3Vyc29yID0gbnVsbDtcbiAgICBpZiAoYmF0Y2hlcy5uZXh0KSB7XG4gICAgICAvLyBNZWlsaVNlYXJjaCBwcm92aWRlcyB0aGUgbmV4dCBvZmZzZXRcbiAgICAgIG5leHRDdXJzb3IgPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeSh7IG9mZnNldDogYmF0Y2hlcy5uZXh0IH0pKS50b1N0cmluZygnYmFzZTY0Jyk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0cyA9IGJhdGNoZXMucmVzdWx0cy5tYXAoKGJhdGNoOiBhbnkpID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmJhdGNoLFxuICAgICAgICBzdGF0dXM6IGJhdGNoLnN0YXRzPy5zdGF0dXMsXG4gICAgICAgIHR5cGVzOiBiYXRjaC5zdGF0cz8udHlwZXNcbiAgICAgIH07XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIG1laWxpUGFyYW1zLFxuICAgICAgaXRlbXM6IHJlc3VsdHMsXG4gICAgICBjdXJzb3I6IG5leHRDdXJzb3IsXG4gICAgfSk7XG4gIH1cblxuICBAR2V0KCcvYmF0Y2hlcy97dWlkfScpXG4gIGFzeW5jIGdldEJhdGNoKHJlcTogUmVxdWVzdDx7IHBhdGg6IHsgdWlkOiBudW1iZXIgfSB9PiwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IHsgdWlkIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG5cbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgYmF0Y2ggPSBhd2FpdCBlbmdpbmUuZ2V0QmF0Y2goTnVtYmVyKHVpZCkpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKGJhdGNoKTtcbiAgfVxuXG4gIEBHZXQoJy9hcGkta2V5cy97a2V5T3JVaWR9JylcbiAgYXN5bmMgZ2V0S2V5KHJlcTogUmVxdWVzdDx7IHBhdGg6IHsga2V5T3JVaWQ6IHN0cmluZyB9IH0+LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgeyBrZXlPclVpZCB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIFxuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCBrZXkgPSBhd2FpdCBlbmdpbmUuZ2V0S2V5KGtleU9yVWlkKTtcbiAgICByZXR1cm4gcmVzLmpzb24oa2V5KTtcbiAgfVxuXG4gIEBQb3N0KCcvYXBpLWtleXMnLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgbmFtZTogeyByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgICBhY3Rpb25zOiB7IHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgIGluZGV4ZXM6IHsgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgICAgZXhwaXJlc0F0OiB7IHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIGNyZWF0ZUtleShyZXE6IFJlcXVlc3Q8eyBib2R5OiBhbnkgfT4sIHJlczogUmVzcG9uc2UpIHtcblxuICAgIGNvbnN0IG9wdGlvbnMgPSByZXEuYm9keTtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG5cbiAgICBjb25zdCBrZXkgPSBhd2FpdCBlbmdpbmUuY3JlYXRlS2V5KHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICBleHBpcmVzQXQ6IG9wdGlvbnMuZXhwaXJlc0F0ID8gbmV3IERhdGUob3B0aW9ucy5leHBpcmVzQXQpIDogdW5kZWZpbmVkXG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oa2V5KTtcbiAgfVxuXG4gIEBQdXQoJy9hcGkta2V5cy97a2V5T3JVaWR9JylcbiAgYXN5bmMgdXBkYXRlS2V5KFxuICAgIHJlcTogUmVxdWVzdDx7XG4gICAgICBwYXRoOiB7IGtleU9yVWlkOiBzdHJpbmcgfTtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgbmFtZT86IHN0cmluZztcbiAgICAgICAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG4gICAgICB9XG4gICAgfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IGtleU9yVWlkIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCBrZXkgPSBhd2FpdCBlbmdpbmUudXBkYXRlS2V5KGtleU9yVWlkLCBvcHRpb25zKTtcbiAgICByZXR1cm4gcmVzLmpzb24oa2V5KTtcbiAgfVxuXG4gIEBEZWxldGUoJy9hcGkta2V5cy97a2V5T3JVaWR9JylcbiAgYXN5bmMgZGVsZXRlS2V5KHJlcTogUmVxdWVzdDx7IHBhdGg6IHsga2V5T3JVaWQ6IHN0cmluZyB9IH0+LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgeyBrZXlPclVpZCB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCB0YXNrID0gYXdhaXQgZW5naW5lLmRlbGV0ZUtleShrZXlPclVpZCk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHtcbiAgICAgIHRhc2ssXG4gICAgICBtZXNzYWdlOiAnS2V5IGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5J1xuICAgIH0pO1xuICB9XG59XG4iXX0=