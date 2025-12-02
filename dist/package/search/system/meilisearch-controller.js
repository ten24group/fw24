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
// @Controller('system/search', {
//   // Config will be merged from construct registration
// })
class MeiliSearchSystemController extends search_controller_1.SearchSystemController {
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
}
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGlzZWFyY2gtY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvc3lzdGVtL21laWxpc2VhcmNoLWNvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsaURBQXNFO0FBRXRFLDJEQUE2RDtBQUM3RCx3Q0FBK0M7QUFDL0Msc0NBQThDO0FBRzlDLDZDQUFpRDtBQUNqRCw4Q0FBbUc7QUFFbkcsK0RBQStEO0FBQy9ELFNBQVMscUJBQXFCLENBQUMsR0FBWTtJQUN6QyxNQUFNLElBQUksR0FBRyxHQUFHLENBQUMscUJBQXFCLENBQUM7SUFDdkMsTUFBTSxFQUFFLE1BQU0sRUFBRSxLQUFLLEdBQUMsS0FBSyxFQUFFLEtBQUssR0FBQyxLQUFLLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxHQUFHLElBQUksRUFBRSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7SUFFcEYsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDO0lBQ2xCLElBQUksTUFBTSxFQUFFLENBQUM7UUFDWCxJQUFJLENBQUM7WUFDSCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7WUFDeEUsTUFBTSxHQUFHLFVBQVUsQ0FBQyxNQUFNLENBQUM7UUFDN0IsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZix1Q0FBdUM7UUFDekMsQ0FBQztJQUNILENBQUM7SUFFRCxzREFBc0Q7SUFDdEQsSUFBSSxXQUFXLElBQUksSUFBSSxFQUFFLENBQUM7UUFDeEIsTUFBTSxRQUFRLEdBQUcsSUFBQSxvQkFBWSxFQUFDLFdBQVcsRUFBRSxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUM7UUFDckQsTUFBTSxPQUFPLEdBQUcsSUFBQSxvQkFBWSxFQUFDLElBQUksRUFB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b0JBQzFELFNBQVMsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FDeEMsR0FBRyxDQUFDLElBQUksSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBRSxNQUFNLENBQUMsUUFBcUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUM1RixDQUFDO2dCQUNKLENBQUM7cUJBQU0sSUFBSSxNQUFNLENBQUMsU0FBUyxLQUFLLE1BQU0sSUFBSSxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUM7b0JBQzVELFNBQVMsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FDeEMsR0FBRyxDQUFDLElBQUksSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLFVBQVUsQ0FBRSxNQUFNLENBQUMsVUFBdUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUNoRyxDQUFDO2dCQUNKLENBQUM7cUJBQU0sSUFBSSxNQUFNLENBQUMsU0FBUyxLQUFLLGFBQWEsSUFBSSxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUM7b0JBQ2pFLFNBQVMsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FDeEMsR0FBRyxDQUFDLFdBQVcsSUFBSSxHQUFHLENBQUMsV0FBVyxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBRSxNQUFNLENBQUMsUUFBcUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUMxRyxDQUFDO2dCQUNKLENBQUM7cUJBQU0sSUFBSSxNQUFNLENBQUMsU0FBUyxLQUFLLGFBQWEsSUFBSSxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQzNELFNBQVMsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FDeEMsR0FBRyxDQUFDLFdBQVcsS0FBSyxNQUFNLENBQUMsRUFBRSxD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QUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQVksQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FDbkksQ0FBQztnQkFDSixDQUFDO3FCQUFNLElBQUksTUFBTSxDQUFDLFNBQVMsS0FBSyxXQUFXLElBQUksTUFBTSxDQUFDLEVBQUUsRUFBRSxDQUFDO29CQUN6RCxTQUFTLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQVEsRUFBRSxFQUFFLENBQ3hDLEdBQUcsQ0FBQyxTQUFTLElBQUksSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFZLENBQUMsQ0FDekUsQ0FBQztnQkFDSixDQUFDO3FCQUFNLElBQUksTUFBTSxDQUFDLFNBQVMsS0FBSyxXQUFXLElBQUksTUFBTSxDQUFDLEVBQUUsRUFBRSxDQUFDO29CQUN6RCxTQUFTLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQVEsRUFBRSxFQUFFLENBQ3hDLEdBQUcsQ0FBQyxTQUFTLElBQUksSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFZLENBQUMsQ0FDekUsQ0FBQztnQkFDSixDQUFDO3FCQUFNLElBQUksTUFBTSxDQUFDLFNBQVMsS0FBSyxXQUFXLElBQUksTUFBTSxDQUFDLEVBQUUsRUFBRSxDQUFDO29CQUN6RCxTQUFTLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQVEsRUFBRSxFQUFFLENBQ3hDLEdBQUcsQ0FBQyxTQUFTLElBQUksSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBWSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUNuSSxDQUFDO2dCQUNKLENBQUM7cUJBQU0sSUFBSSxNQUFNLENBQUMsU0FBUyxLQUFLLFdBQVcsSUFBSSxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQ3pELFNBQVMsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FDeEMsR0FBRyxDQUFDLFNBQVMsSUFBSSxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQVksQ0FBQyxDQUN6RSxDQUFDO2dCQUNKLENBQUM7cUJBQU0sSUFBSSxNQUFNLENBQUMsU0FBUyxLQUFLLFdBQVcsSUFBSSxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQ3pELFNBQVMsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FDeEMsR0FBRyxDQUFDLFNBQVMsSUFBSSxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQVksQ0FBQyxDQUN6RSxDQUFDO2dCQUNKLENBQUM7cUJBQU0sSUFBSSxNQUFNLENBQUMsU0FBUyxLQUFLLFdBQVcsSUFBSSxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQ3pELFNBQVMsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FDeEMsR0FBRyxDQUFDLFNBQVMsSUFBSSxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFZLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxD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LElBQUksRUFBRTtnQkFDM0IsU0FBUyxFQUFFLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRTthQUM5QjtTQUNGO0tBQ0YsQ0FBQzs0REFZRDtBQUdLO0lBREwsSUFBQSxnQkFBRyxFQUFDLHNCQUFzQixDQUFDOzREQWdCM0I7QUFHSztJQURMLElBQUEsbUJBQU0sRUFBQyxzQkFBc0IsQ0FBQzs0REFTOUIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb250cm9sbGVyLCBEZWxldGUsIEdldCwgUG9zdCwgUHV0IH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycyc7XG5pbXBvcnQgeyBSZXF1ZXN0LCBSZXNwb25zZSB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgU2VhcmNoU3lzdGVtQ29udHJvbGxlciB9IGZyb20gJy4vc2VhcmNoLWNvbnRyb2xsZXInO1xuaW1wb3J0IHsgTWVpbGlTZWFyY2hFbmdpbmUgfSBmcm9tICcuLi9lbmdpbmVzJztcbmltcG9ydCB7IFNlYXJjaEVuZ2luZUVycm9yIH0gZnJvbSAnLi4vZXJyb3JzJztcbmltcG9ydCB7IEJhc2VFbnRpdHlTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2Utc2VydmljZSc7XG5pbXBvcnQgeyBEZWxldGVPckNhbmNlbFRhc2tzUXVlcnksIERvY3VtZW50c1F1ZXJ5LCBTdGF0cywgVGFza3NPckJhdGNoZXNRdWVyeSB9IGZyb20gJ21laWxpc2VhcmNoJztcbmltcG9ydCB7IHNhZmVQYXJzZUludCB9IGZyb20gJy4uLy4uL3V0aWxzL3BhcnNlJztcbmltcG9ydCB7IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzLCBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAgfSBmcm9tICcuLi8uLi9lbnRpdHkvcXVlcnknO1xuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gY29udmVydCBjdXJzb3ItYmFzZWQgcGFnaW5hdGlvbiB0byBvZmZzZXRcbmZ1bmN0aW9uIHBhcnNlQ3Vyc29yUGFnaW5hdGlvbihyZXE6IFJlcXVlc3QpIHtcbiAgY29uc3QgZGF0YSA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnM7XG4gIGNvbnN0IHsgY3Vyc29yLCBjb3VudD1cIjEwMFwiLCBsaW1pdD1cIjI1MFwiLCBoaXRzUGVyUGFnZSwgcGFnZSwgLi4ucmVzdCB9ID0gZGF0YSB8fCB7fTtcbiAgXG4gIGxldCBvZmZzZXQgPSBudWxsO1xuICBpZiAoY3Vyc29yKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGN1cnNvckRhdGEgPSBKU09OLnBhcnNlKEJ1ZmZlci5mcm9tKGN1cnNvciwgJ2Jhc2U2NCcpLnRvU3RyaW5nKCkpO1xuICAgICAgb2Zmc2V0ID0gY3Vyc29yRGF0YS5vZmZzZXQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIEludmFsaWQgY3Vyc29yLCBzdGFydCBmcm9tIGJlZ2lubmluZ1xuICAgIH1cbiAgfVxuICBcbiAgLy8gSGFuZGxlIHNlYXJjaC1zdHlsZSBwYWdpbmF0aW9uIChoaXRzUGVyUGFnZSArIHBhZ2UpXG4gIGlmIChoaXRzUGVyUGFnZSAmJiBwYWdlKSB7XG4gICAgY29uc3QgcGFnZVNpemUgPSBzYWZlUGFyc2VJbnQoaGl0c1BlclBhZ2UsIDIwKS52YWx1ZTtcbiAgICBjb25zdCBwYWdlTnVtID0gc2FmZVBhcnNlSW50KHBhZ2UsIDEpLnZhbHVlO1xuICAgIG9mZnNldCA9IChwYWdlTnVtIC0gMSkgKiBwYWdlU2l6ZTtcbiAgICByZXR1cm4ge1xuICAgICAgb2Zmc2V0LFxuICAgICAgbGltaXQ6IHBhZ2VTaXplLFxuICAgICAgcmVzdFxuICAgIH07XG4gIH1cbiAgXG4gIC8vIFVzZSBjb3VudCBhcyBwcmltYXJ5LCBsaW1pdCBhcyBmYWxsYmFjayAoc2FtZSBhcyBlbnRpdHkgY29udHJvbGxlcilcbiAgY29uc3QgcGFnZVNpemUgPSBzYWZlUGFyc2VJbnQoY291bnQsIHNhZmVQYXJzZUludChsaW1pdCwgMjUwKS52YWx1ZSkudmFsdWU7XG4gIFxuICByZXR1cm4ge1xuICAgIG9mZnNldCxcbiAgICBsaW1pdDogcGFnZVNpemUsXG4gICAgcmVzdFxuICB9O1xufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIG5leHQgY3Vyc29yXG5mdW5jdGlvbiBjcmVhdGVOZXh0Q3Vyc29yKG9mZnNldDogbnVtYmVyLCBsaW1pdDogbnVtYmVyLCBoYXNNb3JlOiBib29sZWFuKSB7XG4gIGlmICghaGFzTW9yZSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGNvbnN0IG5leHRPZmZzZXQgPSBvZmZzZXQgKyBsaW1pdDtcbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHsgb2Zmc2V0OiBuZXh0T2Zmc2V0IH0pKS50b1N0cmluZygnYmFzZTY0Jyk7XG59XG5cbi8vKiBOb3RlOiB0aGlzIGlzIGEgbW9yZSBmb2N1c2VkIFt0b3dhcmRzIG1laWxpc2VhcmNoXSB2ZXJzaW9uIG9mIHRoZSBzZWFyY2ggY29udHJvbGxlclxuLy8qIGF0IGFueSBnaXZlbiBwb2ludCBvbmx5IG9uZSBvZiB0aGUgY29udHJvbGxlcnMgd2lsbCBiZSByZWdpc3RlcmVkIHdpdGggdGhlIHNhbWUgcm91dGVcbi8vIEBDb250cm9sbGVyKCdzeXN0ZW0vc2VhcmNoJywge1xuLy8gICAvLyBDb25maWcgd2lsbCBiZSBtZXJnZWQgZnJvbSBjb25zdHJ1Y3QgcmVnaXN0cmF0aW9uXG4vLyB9KVxuZXhwb3J0IGNsYXNzIE1laWxpU2VhcmNoU3lzdGVtQ29udHJvbGxlciBleHRlbmRzIFNlYXJjaFN5c3RlbUNvbnRyb2xsZXIge1xuXG4gIHByaXZhdGUgZ2V0TWVpbGlFbmdpbmUoKTogTWVpbGlTZWFyY2hFbmdpbmUge1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuY29udGFpbmVyLnJlc29sdmVTZWFyY2hFbmdpbmUoKTtcblxuICAgIGlmIChlbmdpbmUgaW5zdGFuY2VvZiBNZWlsaVNlYXJjaEVuZ2luZSkge1xuICAgICAgcmV0dXJuIGVuZ2luZTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgU2VhcmNoRW5naW5lRXJyb3IoJ0NvdWxkIG5vdCByZXNvbHZlIE1laWxpU2VhcmNoRW5naW5lIGZyb20gZGktY29udGFpbmVyJyk7XG4gIH1cblxuICBAR2V0KCcvc3RhdHMnKVxuICBhc3luYyBnZXRTdGF0cyhyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCB7IGluY2x1ZGVJbmRleGVzID0gdHJ1ZSB9ID0gcmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyB8fCB7fTtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgXG4gICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBlbmdpbmUuZ2V0U3RhdHM8U3RhdHM+KCk7XG5cbiAgICBjb25zdCB7IGluZGV4ZXMsIC4uLnJlc3QgfSA9IHN0YXRzO1xuXG4gICAgaWYgKCFpbmNsdWRlSW5kZXhlcykge1xuICAgICAgcmV0dXJuIHJlcy5qc29uKHJlc3QpO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gcmVzLmpzb24oc3RhdHMpO1xuICB9XG5cbiAgQFBvc3QoJy9leHBlcmltZW50YWwtZmVhdHVyZXMnLCB7XG4gICAgdmFsaWRhdGlvbnM6IHtcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgbWV0cmljczogeyBkYXRhdHlwZTogJ2Jvb2xlYW4nLCByZXF1aXJlZDogZmFsc2UgfSxcbiAgICAgICAgbmV0d29yazogeyBkYXRhdHlwZTogJ2Jvb2xlYW4nLCByZXF1aXJlZDogZmFsc2UgfSxcbiAgICAgICAgbG9nc1JvdXRlOiB7IGRhdGF0eXBlOiAnYm9vbGVhbicsIHJlcXVpcmVkOiBmYWxzZSB9LFxuICAgICAgICBjb250YWluc0ZpbHRlcjogeyBkYXRhdHlwZTogJ2Jvb2xlYW4nLCByZXF1aXJlZDogZmFsc2UgfSxcbiAgICAgICAgZWRpdERvY3VtZW50c0J5RnVuY3Rpb246IHsgZGF0YXR5cGU6ICdib29sZWFuJywgcmVxdWlyZWQ6IGZhbHNlIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG4gIGFzeW5jIHVwZGF0ZUV4cGVyaW1lbnRhbEZlYXR1cmVzKHJlcTogUmVxdWVzdDx7IGJvZHk6IHsgbWV0cmljcz86IGJvb2xlYW4sIGxvZ3NSb3V0ZT86IGJvb2xlYW4sIGNvbnRhaW5zRmlsdGVyPzogYm9vbGVhbiwgZWRpdERvY3VtZW50c0J5RnVuY3Rpb24/OiBib29sZWFuLCBuZXR3b3JrPzogYm9vbGVhbiB9IH0+LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgeyBtZXRyaWNzID0gZmFsc2UsIGxvZ3NSb3V0ZSA9IGZhbHNlLCBjb250YWluc0ZpbHRlciA9IGZhbHNlLCBlZGl0RG9jdW1lbnRzQnlGdW5jdGlvbiA9IGZhbHNlLCBuZXR3b3JrID0gZmFsc2UgfSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCB0YXNrID0gYXdhaXQgZW5naW5lLnNldEV4cGVyaW1lbnRhbEZlYXR1cmVzU3RhdHVzKHtcbiAgICAgIG1ldHJpY3MsXG4gICAgICBuZXR3b3JrLFxuICAgICAgbG9nc1JvdXRlLFxuICAgICAgY29udGFpbnNGaWx0ZXIsXG4gICAgICBlZGl0RG9jdW1lbnRzQnlGdW5jdGlvbixcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzLmpzb24odGFzayk7XG4gIH1cblxuICBAR2V0KCcvZXhwZXJpbWVudGFsLWZlYXR1cmVzJylcbiAgYXN5bmMgZ2V0RXhwZXJpbWVudGFsRmVhdHVyZXMoX3JlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCBmZWF0dXJlcyA9IGF3YWl0IGVuZ2luZS5nZXRFeHBlcmltZW50YWxGZWF0dXJlcygpO1xuICAgIHJldHVybiByZXMuanNvbihmZWF0dXJlcyk7XG4gIH1cblxuICBAR2V0KCcvdmVyc2lvbicpXG4gIGFzeW5jIGdldFZlcnNpb24oX3JlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCB2ZXJzaW9uID0gYXdhaXQgZW5naW5lLmdldFZlcnNpb24oKTtcbiAgICByZXR1cm4gcmVzLmpzb24odmVyc2lvbik7XG4gIH1cblxuICBAR2V0KCcvaGVhbHRoJylcbiAgYXN5bmMgZ2V0SGVhbHRoKF9yZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgaGVhbHRoID0gYXdhaXQgZW5naW5lLmhlYWx0aCgpO1xuICAgIHJldHVybiByZXMuanNvbihoZWFsdGgpO1xuICB9XG5cbiAgQEdldCgnL2lzLWhlYWx0aHknKVxuICBhc3luYyBpc0hlYWx0aHkoX3JlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCBpc0hlYWx0aHkgPSBhd2FpdCBlbmdpbmUuaXNIZWFsdGh5KCk7XG4gICAgcmV0dXJuIHJlcy5qc29uKHsgaXNIZWFsdGh5IH0pO1xuICB9XG5cbiAgQFBvc3QoJy9kdW1wcycpXG4gIGFzeW5jIGNyZWF0ZUR1bXAoX3JlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCB0YXNrID0gYXdhaXQgZW5naW5lLmNyZWF0ZUR1bXAoKTtcbiAgICByZXR1cm4gcmVzLmpzb24odGFzayk7XG4gIH1cblxuICBAUG9zdCgnL3NuYXBzaG90cycpXG4gIGFzeW5jIGNyZWF0ZVNuYXBzaG90KF9yZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgdGFzayA9IGF3YWl0IGVuZ2luZS5jcmVhdGVTbmFwc2hvdCgpO1xuICAgIHJldHVybiByZXMuanNvbih0YXNrKTtcbiAgfVxuXG4gIEBQb3N0KCcvaW5kaWNlcy9zd2FwJywge1xuICAgIHZhbGlkYXRpb25zOiB7XG4gICAgICBib2R5OiB7XG4gICAgICAgIHN3YXBzOiB7IGRhdGF0eXBlOiAnYXJyYXknLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyBzd2FwSW5kaWNlcyhyZXE6IFJlcXVlc3Q8eyBib2R5OiB7IHN3YXBzOiBbIHN0cmluZywgc3RyaW5nIF1bXSB9IH0+LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgeyBzd2FwcyB9ID0gcmVxLmJvZHk7XG5cbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgdGFzayA9IGF3YWl0IGVuZ2luZS5zd2FwSW5kZXhlcyhcbiAgICAgIHN3YXBzLm1hcChwYWlyID0+ICh7IGluZGV4ZXM6IHBhaXIgfSkpLFxuICAgICAgdHJ1ZVxuICAgICk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24odGFzayk7XG4gIH1cblxuICBAUG9zdCgnL211bHRpLXNlYXJjaCcsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBxdWVyaWVzOiB7IGRhdGF0eXBlOiAnYXJyYXknLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuICBhc3luYyBtdWx0aVNlYXJjaChcbiAgICByZXE6IFJlcXVlc3Q8eyBib2R5OiB7IHF1ZXJpZXM6IGFueVtdIH0gfT4sXG4gICAgcmVzOiBSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCB7IHF1ZXJpZXMgfSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgZW5naW5lLm11bHRpU2VhcmNoKHF1ZXJpZXMpO1xuICAgIHJldHVybiByZXMuanNvbihyZXN1bHRzKTtcbiAgfVxuXG4gIEBHZXQoJy9pbmRleC1kb2N1bWVudHMve2luZGV4TmFtZX0nKVxuICBhc3luYyBnZXRJbmRleERvY3VtZW50cyhcbiAgICByZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IGluZGV4TmFtZTogc3RyaW5nIH0sIHF1ZXJ5OiBEb2N1bWVudHNRdWVyeTxhbnk+IH0+LFxuICAgIHJlczogUmVzcG9uc2VcbiAgKSB7XG5cbiAgICBjb25zdCB7IGluZGV4TmFtZSB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IG9wdGlvbnMgPSByZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzO1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcblxuICAgIGNvbnN0IGRvY3VtZW50cyA9IGF3YWl0IGVuZ2luZS5nZXREb2N1bWVudHMoaW5kZXhOYW1lLCB7XG4gICAgICAvLyBleHRyYWN0IG1hbnVhbGx5IHRvIGF2b2lkIHVud2FudGVkIGtleXMgZXJyb3JzXG4gICAgICBpZHM6IG9wdGlvbnMuaWRzLFxuICAgICAgbGltaXQ6IG9wdGlvbnMubGltaXQsXG4gICAgICBvZmZzZXQ6IG9wdGlvbnMub2Zmc2V0LFxuICAgICAgZmlsdGVyOiBvcHRpb25zLmZpbHRlcixcbiAgICAgIGZpZWxkczogb3B0aW9ucy5maWVsZHMsXG4gICAgICByZXRyaWV2ZVZlY3RvcnM6IG9wdGlvbnMucmV0cmlldmVWZWN0b3JzLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHsgZG9jdW1lbnRzIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBlbnRpdHlOYW1lVG9JbmRleE5hbWUoZW50aXR5TmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3Qgc2VhcmNoU2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VhcmNoU2VydmljZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCBpbmRleEluZm8gPSBzZWFyY2hTZXJ2aWNlLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG5cbiAgICBpZiAoaW5kZXhJbmZvKSB7XG4gICAgICByZXR1cm4gaW5kZXhJbmZvLmluZGV4TmFtZTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYEluZGV4IG5vdCBmb3VuZCBmb3IgZW50aXR5ICR7ZW50aXR5TmFtZX1gKTtcbiAgfVxuXG4gIEBHZXQoJy90YXNrcycpXG4gIGFzeW5jIGdldFRhc2tzKHJlcTogUmVxdWVzdDx7IHF1ZXJ5OiBUYXNrc09yQmF0Y2hlc1F1ZXJ5IH0+LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IHsgb2Zmc2V0LCBsaW1pdCwgcmVzdCB9ID0gcGFyc2VDdXJzb3JQYWdpbmF0aW9uKHJlcSk7XG5cbiAgICAvLyBVc2UgdGhlIHNhbWUgcXVlcnkgcGFyc2luZyBhcyBlbnRpdHkgY29udHJvbGxlclxuICAgIGNvbnN0IHBhcnNlZFF1ZXJ5UGFyYW1zID0gcGFyc2VVcmxRdWVyeVN0cmluZ1BhcmFtZXRlcnMocmVzdCk7XG4gICAgY29uc3QgZmlsdGVyR3JvdXAgPSBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAocGFyc2VkUXVlcnlQYXJhbXMpO1xuXG4gICAgLy8gQ29udmVydCBmaWx0ZXIgZ3JvdXAgdG8gTWVpbGlTZWFyY2ggcGFyYW1ldGVyc1xuICAgIGNvbnN0IG1laWxpUGFyYW1zOiBUYXNrc09yQmF0Y2hlc1F1ZXJ5ID0ge1xuICAgICAgbGltaXQsXG4gICAgICBmcm9tOiBvZmZzZXQsXG4gICAgICByZXZlcnNlOiBmYWxzZSwgLy8gR2V0IG5ld2VzdCB0YXNrcyBmaXJzdFxuICAgIH07XG5cbiAgICAvLyBFeHRyYWN0IE1laWxpU2VhcmNoIHBhcmFtZXRlcnMgZnJvbSBmaWx0ZXIgZ3JvdXBcbiAgICBpZiAoZmlsdGVyR3JvdXAuYW5kKSB7XG4gICAgICBmaWx0ZXJHcm91cC5hbmQuZm9yRWFjaChmaWx0ZXIgPT4ge1xuICAgICAgICBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3R5cGUnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLnR5cGVzID0gZmlsdGVyLmVxIGFzIGFueTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAndHlwZScgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMudHlwZXMgPSBmaWx0ZXIuaW4gYXMgYW55O1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdzdGF0dXMnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLnN0YXR1c2VzID0gZmlsdGVyLmVxIGFzIGFueTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnc3RhdHVzJyAmJiBmaWx0ZXIuaW4pIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5zdGF0dXNlcyA9IGZpbHRlci5pbiBhcyBhbnk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3VpZCcgJiYgZmlsdGVyLmVxKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMudWlkcyA9IFtmaWx0ZXIuZXEgYXMgbnVtYmVyXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAndWlkJyAmJiBmaWx0ZXIuaW4pIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy51aWRzID0gZmlsdGVyLmluIGFzIG51bWJlcltdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdpbmRleFVpZCcgJiYgZmlsdGVyLmVxKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuaW5kZXhVaWRzID0gW2ZpbHRlci5lcSBhcyBzdHJpbmddO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdpbmRleFVpZCcgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuaW5kZXhVaWRzID0gZmlsdGVyLmluIGFzIHN0cmluZ1tdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdlbnF1ZXVlZEF0JyAmJiBmaWx0ZXIubHQpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5iZWZvcmVFbnF1ZXVlZEF0ID0gbmV3IERhdGUoZmlsdGVyLmx0KS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdlbnF1ZXVlZEF0JyAmJiBmaWx0ZXIuZ3QpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5hZnRlckVucXVldWVkQXQgPSBuZXcgRGF0ZShmaWx0ZXIuZ3QpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3N0YXJ0ZWRBdCcgJiYgZmlsdGVyLmx0KSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYmVmb3JlU3RhcnRlZEF0ID0gbmV3IERhdGUoZmlsdGVyLmx0KS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdzdGFydGVkQXQnICYmIGZpbHRlci5ndCkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLmFmdGVyU3RhcnRlZEF0ID0gbmV3IERhdGUoZmlsdGVyLmd0KS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdmaW5pc2hlZEF0JyAmJiBmaWx0ZXIubHQpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5iZWZvcmVGaW5pc2hlZEF0ID0gbmV3IERhdGUoZmlsdGVyLmx0KS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdmaW5pc2hlZEF0JyAmJiBmaWx0ZXIuZ3QpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5hZnRlckZpbmlzaGVkQXQgPSBuZXcgRGF0ZShmaWx0ZXIuZ3QpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2NhbmNlbGVkQnknICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLmNhbmNlbGVkQnkgPSBbZmlsdGVyLmVxIGFzIG51bWJlcl07XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2JhdGNoVWlkJyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5iYXRjaFVpZHMgPSBbZmlsdGVyLmVxIGFzIG51bWJlcl07XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2JhdGNoVWlkJyAmJiBmaWx0ZXIuaW4pIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5iYXRjaFVpZHMgPSBmaWx0ZXIuaW4gYXMgbnVtYmVyW107XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2VudGl0eU5hbWUnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSBmaWx0ZXIuZXEgYXMgc3RyaW5nO1xuICAgICAgICAgIGNvbnN0IGluZGV4TmFtZSA9IHRoaXMuZW50aXR5TmFtZVRvSW5kZXhOYW1lKGVudGl0eU5hbWUpO1xuICAgICAgICAgIGlmIChpbmRleE5hbWUpIHtcbiAgICAgICAgICAgIG1laWxpUGFyYW1zLmluZGV4VWlkcyA9IFtpbmRleE5hbWVdO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZW50aXR5TmFtZScgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgY29uc3QgZW50aXR5TmFtZXMgPSBmaWx0ZXIuaW4gYXMgc3RyaW5nW107XG4gICAgICAgICAgY29uc3QgaW5kZXhOYW1lcyA9IGVudGl0eU5hbWVzLm1hcChlbnRpdHlOYW1lID0+IHRoaXMuZW50aXR5TmFtZVRvSW5kZXhOYW1lKGVudGl0eU5hbWUpKTtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5pbmRleFVpZHMgPSBpbmRleE5hbWVzLmZpbHRlcihpbmRleE5hbWUgPT4gaW5kZXhOYW1lICE9PSB1bmRlZmluZWQpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCB0YXNrcyA9IGF3YWl0IGVuZ2luZS5nZXRDbGllbnQoKS50YXNrcy5nZXRUYXNrcyhtZWlsaVBhcmFtcyk7XG4gICAgXG4gICAgLy8gVXNlIE1laWxpU2VhcmNoJ3MgbmV4dCB2YWx1ZSBmb3IgY3Vyc29yLCBvciBjcmVhdGUgb3VyIG93biBpZiBub3QgYXZhaWxhYmxlXG4gICAgbGV0IG5leHRDdXJzb3IgPSBudWxsO1xuICAgIGlmICh0YXNrcy5uZXh0KSB7XG4gICAgICAvLyBNZWlsaVNlYXJjaCBwcm92aWRlcyB0aGUgbmV4dCBvZmZzZXRcbiAgICAgIG5leHRDdXJzb3IgPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeSh7IG9mZnNldDogdGFza3MubmV4dCB9KSkudG9TdHJpbmcoJ2Jhc2U2NCcpO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgbWVpbGlQYXJhbXMsXG4gICAgICBjdXJzb3I6IG5leHRDdXJzb3IsXG4gICAgICBpdGVtczogdGFza3MucmVzdWx0c1xuICAgIH0pO1xuICB9XG5cbiAgQEdldCgnL3Rhc2tzL3t0YXNrSWR9JylcbiAgYXN5bmMgZ2V0VGFzayhyZXE6IFJlcXVlc3Q8eyBwYXRoOiB7IHRhc2tJZDogbnVtYmVyIH0gfT4sIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCB7IHRhc2tJZCB9ID0gcmVxLnBhdGhQYXJhbWV0ZXJzO1xuXG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IHRhc2sgPSBhd2FpdCBlbmdpbmUud2FpdEZvclRhc2soTnVtYmVyKHRhc2tJZCkpO1xuXG4gICAgcmV0dXJuIHJlcy5qc29uKHRhc2spO1xuICB9XG5cbiAgQEdldCgnL3Rhc2tzL3t0YXNrSWR9L2NhbmNlbCcpXG4gIGFzeW5jIGNhbmNlbFRhc2socmVxOiBSZXF1ZXN0PHsgcGF0aDogeyB0YXNrSWQ6IHN0cmluZyB9IH0+LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgeyB0YXNrSWQgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgdGFzayA9IGF3YWl0IGVuZ2luZS5jYW5jZWxUYXNrcyh7IHVpZHM6IFsgTnVtYmVyKHRhc2tJZCkgXSB9KTtcbiAgICByZXR1cm4gcmVzLmpzb24odGFzayk7XG4gIH1cblxuICBAUG9zdCgnL3Rhc2tzL2NhbmNlbCcpXG4gIGFzeW5jIGNhbmNlbFRhc2tzKHJlcTogUmVxdWVzdDx7IGJvZHk6IERlbGV0ZU9yQ2FuY2VsVGFza3NRdWVyeSB9PiwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gcmVxLmJvZHk7XG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IHRhc2sgPSBhd2FpdCBlbmdpbmUuY2FuY2VsVGFza3MocXVlcnkpO1xuICAgIHJldHVybiByZXMuanNvbih0YXNrKTtcbiAgfVxuXG4gIEBEZWxldGUoJy90YXNrcycpXG4gIGFzeW5jIGRlbGV0ZVRhc2tzKHJlcTogUmVxdWVzdDx7IGJvZHk6IERlbGV0ZU9yQ2FuY2VsVGFza3NRdWVyeSB9PiwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gcmVxLmJvZHk7XG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IHRhc2sgPSBhd2FpdCBlbmdpbmUuZGVsZXRlVGFza3MocXVlcnkpO1xuICAgIHJldHVybiByZXMuanNvbih0YXNrKTtcbiAgfVxuXG4gIEBEZWxldGUoJy90YXNrcy97dGFza0lkfScpXG4gIGFzeW5jIGRlbGV0ZVRhc2socmVxOiBSZXF1ZXN0PHsgcGF0aDogeyB0YXNrSWQ6IHN0cmluZyB9IH0+LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgeyB0YXNrSWQgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCBlbmdpbmUgPSB0aGlzLmdldE1laWxpRW5naW5lKCk7XG4gICAgY29uc3QgdGFzayA9IGF3YWl0IGVuZ2luZS5kZWxldGVUYXNrcyh7IHVpZHM6IFsgTnVtYmVyKHRhc2tJZCkgXSB9KTtcbiAgICByZXR1cm4gcmVzLmpzb24odGFzayk7XG4gIH1cblxuICBAR2V0KCcvYXBpLWtleXMnKVxuICBhc3luYyBnZXRLZXlzKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCB7IG9mZnNldCwgbGltaXQsIHJlc3QgfSA9IHBhcnNlQ3Vyc29yUGFnaW5hdGlvbihyZXEpO1xuXG4gICAgLy8gVXNlIHRoZSBzYW1lIHF1ZXJ5IHBhcnNpbmcgYXMgZW50aXR5IGNvbnRyb2xsZXJcbiAgICBjb25zdCBwYXJzZWRRdWVyeVBhcmFtcyA9IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzKHJlc3QpO1xuICAgIGNvbnN0IGZpbHRlckdyb3VwID0gcXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwKHBhcnNlZFF1ZXJ5UGFyYW1zKTtcblxuICAgIGNvbnN0IGFsbEtleXMgPSBhd2FpdCBlbmdpbmUuZ2V0S2V5cygpO1xuICAgIGxldCBrZXlzQXJyYXkgPSAoYWxsS2V5cyBhcyBhbnkpLnJlc3VsdHMgfHwgYWxsS2V5cztcbiAgICBcbiAgICAvLyBBcHBseSBmaWx0ZXJzIGZyb20gZmlsdGVyIGdyb3VwXG4gICAgaWYgKGZpbHRlckdyb3VwLmFuZCkge1xuICAgICAgZmlsdGVyR3JvdXAuYW5kLmZvckVhY2goZmlsdGVyID0+IHtcbiAgICAgICAgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICd1aWQnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIGtleS51aWQgPT09IGZpbHRlci5lcVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3VpZCcgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAgKGZpbHRlci5pbiBhcyBzdHJpbmdbXSkuaW5jbHVkZXMoa2V5LnVpZClcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICduYW1lJyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkubmFtZSA9PT0gZmlsdGVyLmVxXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnbmFtZScgJiYgZmlsdGVyLmNvbnRhaW5zKSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5Lm5hbWUgJiYga2V5Lm5hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygoZmlsdGVyLmNvbnRhaW5zIGFzIHN0cmluZ1tdKVswXS50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ25hbWUnICYmIGZpbHRlci5zdGFydHNXaXRoKSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5Lm5hbWUgJiYga2V5Lm5hbWUudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKChmaWx0ZXIuc3RhcnRzV2l0aCBhcyBzdHJpbmdbXSlbMF0udG9Mb3dlckNhc2UoKSlcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdkZXNjcmlwdGlvbicgJiYgZmlsdGVyLmNvbnRhaW5zKSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5LmRlc2NyaXB0aW9uICYmIGtleS5kZXNjcmlwdGlvbi50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKChmaWx0ZXIuY29udGFpbnMgYXMgc3RyaW5nW10pWzBdLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZGVzY3JpcHRpb24nICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIGtleS5kZXNjcmlwdGlvbiA9PT0gZmlsdGVyLmVxXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAna2V5JyAmJiBmaWx0ZXIuY29udGFpbnMpIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkua2V5ICYmIGtleS5rZXkudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygoZmlsdGVyLmNvbnRhaW5zIGFzIHN0cmluZ1tdKVswXS50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2tleScgJiYgZmlsdGVyLnN0YXJ0c1dpdGgpIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkua2V5ICYmIGtleS5rZXkudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKChmaWx0ZXIuc3RhcnRzV2l0aCBhcyBzdHJpbmdbXSlbMF0udG9Mb3dlckNhc2UoKSlcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdhY3Rpb25zJyAmJiBmaWx0ZXIuaW4pIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkuYWN0aW9ucyAmJiBrZXkuYWN0aW9ucy5zb21lKChhY3Rpb246IGFueSkgPT4gKGZpbHRlci5pbiBhcyBzdHJpbmdbXSkuaW5jbHVkZXMoYWN0aW9uKSlcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdpbmRleGVzJyAmJiBmaWx0ZXIuaW4pIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkuaW5kZXhlcyAmJiBrZXkuaW5kZXhlcy5zb21lKChpbmRleDogYW55KSA9PiAoZmlsdGVyLmluIGFzIHN0cmluZ1tdKS5pbmNsdWRlcyhpbmRleCkpXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnZXhwaXJlc0F0JyAmJiBmaWx0ZXIuZ3QpIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkuZXhwaXJlc0F0ICYmIG5ldyBEYXRlKGtleS5leHBpcmVzQXQpID4gbmV3IERhdGUoZmlsdGVyLmd0IGFzIHN0cmluZylcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdleHBpcmVzQXQnICYmIGZpbHRlci5sdCkge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIGtleS5leHBpcmVzQXQgJiYgbmV3IERhdGUoa2V5LmV4cGlyZXNBdCkgPCBuZXcgRGF0ZShmaWx0ZXIubHQgYXMgc3RyaW5nKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2V4cGlyZXNBdCcgJiYgZmlsdGVyLmVxKSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5LmV4cGlyZXNBdCAmJiBuZXcgRGF0ZShrZXkuZXhwaXJlc0F0KS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF0gPT09IG5ldyBEYXRlKGZpbHRlci5lcSBhcyBzdHJpbmcpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2NyZWF0ZWRBdCcgJiYgZmlsdGVyLmd0KSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5LmNyZWF0ZWRBdCAmJiBuZXcgRGF0ZShrZXkuY3JlYXRlZEF0KSA+IG5ldyBEYXRlKGZpbHRlci5ndCBhcyBzdHJpbmcpXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnY3JlYXRlZEF0JyAmJiBmaWx0ZXIubHQpIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkuY3JlYXRlZEF0ICYmIG5ldyBEYXRlKGtleS5jcmVhdGVkQXQpIDwgbmV3IERhdGUoZmlsdGVyLmx0IGFzIHN0cmluZylcbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdjcmVhdGVkQXQnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIGtleS5jcmVhdGVkQXQgJiYgbmV3IERhdGUoa2V5LmNyZWF0ZWRBdCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdID09PSBuZXcgRGF0ZShmaWx0ZXIuZXEgYXMgc3RyaW5nKS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF1cbiAgICAgICAgICApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICd1cGRhdGVkQXQnICYmIGZpbHRlci5ndCkge1xuICAgICAgICAgIGtleXNBcnJheSA9IGtleXNBcnJheS5maWx0ZXIoKGtleTogYW55KSA9PiBcbiAgICAgICAgICAgIGtleS51cGRhdGVkQXQgJiYgbmV3IERhdGUoa2V5LnVwZGF0ZWRBdCkgPiBuZXcgRGF0ZShmaWx0ZXIuZ3QgYXMgc3RyaW5nKVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3VwZGF0ZWRBdCcgJiYgZmlsdGVyLmx0KSB7XG4gICAgICAgICAga2V5c0FycmF5ID0ga2V5c0FycmF5LmZpbHRlcigoa2V5OiBhbnkpID0+IFxuICAgICAgICAgICAga2V5LnVwZGF0ZWRBdCAmJiBuZXcgRGF0ZShrZXkudXBkYXRlZEF0KSA8IG5ldyBEYXRlKGZpbHRlci5sdCBhcyBzdHJpbmcpXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAndXBkYXRlZEF0JyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBrZXlzQXJyYXkgPSBrZXlzQXJyYXkuZmlsdGVyKChrZXk6IGFueSkgPT4gXG4gICAgICAgICAgICBrZXkudXBkYXRlZEF0ICYmIG5ldyBEYXRlKGtleS51cGRhdGVkQXQpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXSA9PT0gbmV3IERhdGUoZmlsdGVyLmVxIGFzIHN0cmluZykudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIGNvbnN0IHBhZ2luYXRlZEtleXMgPSBrZXlzQXJyYXkuc2xpY2Uob2Zmc2V0LCBvZmZzZXQgKyBsaW1pdCk7XG4gICAgY29uc3QgbmV4dEN1cnNvciA9IGNyZWF0ZU5leHRDdXJzb3Iob2Zmc2V0LCBsaW1pdCwgb2Zmc2V0ICsgbGltaXQgPCBrZXlzQXJyYXkubGVuZ3RoKTtcbiAgICBcbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgY3Vyc29yOiBuZXh0Q3Vyc29yLFxuICAgICAgaXRlbXM6IHBhZ2luYXRlZEtleXNcbiAgICB9KTtcbiAgfVxuXG4gIEBHZXQoJy9iYXRjaGVzJylcbiAgYXN5bmMgZ2V0QmF0Y2hlcyhyZXE6IFJlcXVlc3Q8eyBxdWVyeTogVGFza3NPckJhdGNoZXNRdWVyeSB9PiwgcmVzOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCB7IG9mZnNldCwgbGltaXQsIHJlc3QgfSA9IHBhcnNlQ3Vyc29yUGFnaW5hdGlvbihyZXEpO1xuXG4gICAgLy8gVXNlIHRoZSBzYW1lIHF1ZXJ5IHBhcnNpbmcgYXMgZW50aXR5IGNvbnRyb2xsZXJcbiAgICBjb25zdCBwYXJzZWRRdWVyeVBhcmFtcyA9IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzKHJlc3QpO1xuICAgIGNvbnN0IGZpbHRlckdyb3VwID0gcXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwKHBhcnNlZFF1ZXJ5UGFyYW1zKTtcblxuICAgIC8vIENvbnZlcnQgZmlsdGVyIGdyb3VwIHRvIE1laWxpU2VhcmNoIHBhcmFtZXRlcnNcbiAgICBjb25zdCBtZWlsaVBhcmFtczogVGFza3NPckJhdGNoZXNRdWVyeSA9IHtcbiAgICAgIGxpbWl0LFxuICAgICAgZnJvbTogb2Zmc2V0LFxuICAgICAgcmV2ZXJzZTogZmFsc2UsIC8vIEdldCBuZXdlc3QgYmF0Y2hlcyBmaXJzdFxuICAgIH07XG5cbiAgICAvLyBFeHRyYWN0IE1laWxpU2VhcmNoIHBhcmFtZXRlcnMgZnJvbSBmaWx0ZXIgZ3JvdXBcbiAgICBpZiAoZmlsdGVyR3JvdXAuYW5kKSB7XG4gICAgICBmaWx0ZXJHcm91cC5hbmQuZm9yRWFjaChmaWx0ZXIgPT4ge1xuICAgICAgICBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3VpZCcgJiYgZmlsdGVyLmVxKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMudWlkcyA9IFtmaWx0ZXIuZXEgYXMgbnVtYmVyXTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAndWlkJyAmJiBmaWx0ZXIuaW4pIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy51aWRzID0gZmlsdGVyLmluIGFzIG51bWJlcltdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdiYXRjaFVpZCcgJiYgZmlsdGVyLmVxKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYmF0Y2hVaWRzID0gW2ZpbHRlci5lcSBhcyBudW1iZXJdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdiYXRjaFVpZCcgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYmF0Y2hVaWRzID0gZmlsdGVyLmluIGFzIG51bWJlcltdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdpbmRleFVpZCcgJiYgZmlsdGVyLmVxKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuaW5kZXhVaWRzID0gW2ZpbHRlci5lcSBhcyBzdHJpbmddO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdpbmRleFVpZCcgJiYgZmlsdGVyLmluKSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuaW5kZXhVaWRzID0gZmlsdGVyLmluIGFzIHN0cmluZ1tdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdzdGF0dXMnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLnN0YXR1c2VzID0gZmlsdGVyLmVxIGFzIGFueTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWx0ZXIuYXR0cmlidXRlID09PSAnc3RhdHVzJyAmJiBmaWx0ZXIuaW4pIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5zdGF0dXNlcyA9IGZpbHRlci5pbiBhcyBhbnk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3R5cGVzJyAmJiBmaWx0ZXIuZXEpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy50eXBlcyA9IGZpbHRlci5lcSBhcyBhbnk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3R5cGVzJyAmJiBmaWx0ZXIuaW4pIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy50eXBlcyA9IGZpbHRlci5pbiBhcyBhbnk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ3N0YXJ0ZWRBdCcgJiYgZmlsdGVyLmx0KSB7XG4gICAgICAgICAgbWVpbGlQYXJhbXMuYmVmb3JlU3RhcnRlZEF0ID0gbmV3IERhdGUoZmlsdGVyLmx0KS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdzdGFydGVkQXQnICYmIGZpbHRlci5ndCkge1xuICAgICAgICAgIG1laWxpUGFyYW1zLmFmdGVyU3RhcnRlZEF0ID0gbmV3IERhdGUoZmlsdGVyLmd0KS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdmaW5pc2hlZEF0JyAmJiBmaWx0ZXIubHQpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5iZWZvcmVGaW5pc2hlZEF0ID0gbmV3IERhdGUoZmlsdGVyLmx0KS50b0lTT1N0cmluZygpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdmaW5pc2hlZEF0JyAmJiBmaWx0ZXIuZ3QpIHtcbiAgICAgICAgICBtZWlsaVBhcmFtcy5hZnRlckZpbmlzaGVkQXQgPSBuZXcgRGF0ZShmaWx0ZXIuZ3QpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIH0gZWxzZSBpZiAoZmlsdGVyLmF0dHJpYnV0ZSA9PT0gJ2VudGl0eU5hbWUnICYmIGZpbHRlci5lcSkge1xuICAgICAgICAgIGNvbnN0IGVudGl0eU5hbWUgPSBmaWx0ZXIuZXEgYXMgc3RyaW5nO1xuICAgICAgICAgIGNvbnN0IGluZGV4TmFtZSA9IHRoaXMuZW50aXR5TmFtZVRvSW5kZXhOYW1lKGVudGl0eU5hbWUpO1xuICAgICAgICAgIGlmIChpbmRleE5hbWUpIHtcbiAgICAgICAgICAgIG1laWxpUGFyYW1zLmluZGV4VWlkcyA9IFsgaW5kZXhOYW1lIF07XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGZpbHRlci5hdHRyaWJ1dGUgPT09ICdlbnRpdHlOYW1lJyAmJiBmaWx0ZXIuaW4pIHtcbiAgICAgICAgICBjb25zdCBlbnRpdHlOYW1lcyA9IGZpbHRlci5pbiBhcyBzdHJpbmdbXTtcbiAgICAgICAgICBjb25zdCBpbmRleE5hbWVzID0gZW50aXR5TmFtZXMubWFwKGVudGl0eU5hbWUgPT4gdGhpcy5lbnRpdHlOYW1lVG9JbmRleE5hbWUoZW50aXR5TmFtZSkpO1xuICAgICAgICAgIG1laWxpUGFyYW1zLmluZGV4VWlkcyA9IGluZGV4TmFtZXMuZmlsdGVyKGluZGV4TmFtZSA9PiBpbmRleE5hbWUgIT09IHVuZGVmaW5lZCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGJhdGNoZXMgPSBhd2FpdCBlbmdpbmUuZ2V0QmF0Y2hlcyhtZWlsaVBhcmFtcyk7XG4gICAgXG4gICAgLy8gVXNlIE1laWxpU2VhcmNoJ3MgbmV4dCB2YWx1ZSBmb3IgY3Vyc29yLCBvciBjcmVhdGUgb3VyIG93biBpZiBub3QgYXZhaWxhYmxlXG4gICAgbGV0IG5leHRDdXJzb3IgPSBudWxsO1xuICAgIGlmIChiYXRjaGVzLm5leHQpIHtcbiAgICAgIC8vIE1laWxpU2VhcmNoIHByb3ZpZGVzIHRoZSBuZXh0IG9mZnNldFxuICAgICAgbmV4dEN1cnNvciA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHsgb2Zmc2V0OiBiYXRjaGVzLm5leHQgfSkpLnRvU3RyaW5nKCdiYXNlNjQnKTtcbiAgICB9XG5cbiAgICBjb25zdCByZXN1bHRzID0gYmF0Y2hlcy5yZXN1bHRzLm1hcCgoYmF0Y2g6IGFueSkgPT4ge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uYmF0Y2gsXG4gICAgICAgIHN0YXR1czogYmF0Y2guc3RhdHM/LnN0YXR1cyxcbiAgICAgICAgdHlwZXM6IGJhdGNoLnN0YXRzPy50eXBlc1xuICAgICAgfTtcbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgbWVpbGlQYXJhbXMsXG4gICAgICBpdGVtczogcmVzdWx0cyxcbiAgICAgIGN1cnNvcjogbmV4dEN1cnNvcixcbiAgICB9KTtcbiAgfVxuXG4gIEBHZXQoJy9iYXRjaGVzL3t1aWR9JylcbiAgYXN5bmMgZ2V0QmF0Y2gocmVxOiBSZXF1ZXN0PHsgcGF0aDogeyB1aWQ6IG51bWJlciB9IH0+LCByZXM6IFJlc3BvbnNlKSB7XG4gICAgY29uc3QgeyB1aWQgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcblxuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcbiAgICBjb25zdCBiYXRjaCA9IGF3YWl0IGVuZ2luZS5nZXRCYXRjaChOdW1iZXIodWlkKSk7XG5cbiAgICByZXR1cm4gcmVzLmpzb24oYmF0Y2gpO1xuICB9XG5cbiAgQEdldCgnL2FwaS1rZXlzL3trZXlPclVpZH0nKVxuICBhc3luYyBnZXRLZXkocmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBrZXlPclVpZDogc3RyaW5nIH0gfT4sIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCB7IGtleU9yVWlkIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgXG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IGtleSA9IGF3YWl0IGVuZ2luZS5nZXRLZXkoa2V5T3JVaWQpO1xuICAgIHJldHVybiByZXMuanNvbihrZXkpO1xuICB9XG5cbiAgQFBvc3QoJy9hcGkta2V5cycsIHtcbiAgICB2YWxpZGF0aW9uczoge1xuICAgICAgYm9keToge1xuICAgICAgICBuYW1lOiB7IHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgIGFjdGlvbnM6IHsgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgICAgaW5kZXhlczogeyByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgICBleHBpcmVzQXQ6IHsgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcbiAgYXN5bmMgY3JlYXRlS2V5KHJlcTogUmVxdWVzdDx7IGJvZHk6IGFueSB9PiwgcmVzOiBSZXNwb25zZSkge1xuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IGVuZ2luZSA9IHRoaXMuZ2V0TWVpbGlFbmdpbmUoKTtcblxuICAgIGNvbnN0IGtleSA9IGF3YWl0IGVuZ2luZS5jcmVhdGVLZXkoe1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIGV4cGlyZXNBdDogb3B0aW9ucy5leHBpcmVzQXQgPyBuZXcgRGF0ZShvcHRpb25zLmV4cGlyZXNBdCkgOiB1bmRlZmluZWRcbiAgICB9KTtcblxuICAgIHJldHVybiByZXMuanNvbihrZXkpO1xuICB9XG5cbiAgQFB1dCgnL2FwaS1rZXlzL3trZXlPclVpZH0nKVxuICBhc3luYyB1cGRhdGVLZXkoXG4gICAgcmVxOiBSZXF1ZXN0PHtcbiAgICAgIHBhdGg6IHsga2V5T3JVaWQ6IHN0cmluZyB9O1xuICAgICAgYm9keToge1xuICAgICAgICBuYW1lPzogc3RyaW5nO1xuICAgICAgICBkZXNjcmlwdGlvbj86IHN0cmluZztcbiAgICAgIH1cbiAgICB9PixcbiAgICByZXM6IFJlc3BvbnNlXG4gICkge1xuICAgIGNvbnN0IHsga2V5T3JVaWQgfSA9IHJlcS5wYXRoUGFyYW1ldGVycztcbiAgICBjb25zdCBvcHRpb25zID0gcmVxLmJvZHk7XG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IGtleSA9IGF3YWl0IGVuZ2luZS51cGRhdGVLZXkoa2V5T3JVaWQsIG9wdGlvbnMpO1xuICAgIHJldHVybiByZXMuanNvbihrZXkpO1xuICB9XG5cbiAgQERlbGV0ZSgnL2FwaS1rZXlzL3trZXlPclVpZH0nKVxuICBhc3luYyBkZWxldGVLZXkocmVxOiBSZXF1ZXN0PHsgcGF0aDogeyBrZXlPclVpZDogc3RyaW5nIH0gfT4sIHJlczogUmVzcG9uc2UpIHtcbiAgICBjb25zdCB7IGtleU9yVWlkIH0gPSByZXEucGF0aFBhcmFtZXRlcnM7XG4gICAgY29uc3QgZW5naW5lID0gdGhpcy5nZXRNZWlsaUVuZ2luZSgpO1xuICAgIGNvbnN0IHRhc2sgPSBhd2FpdCBlbmdpbmUuZGVsZXRlS2V5KGtleU9yVWlkKTtcbiAgICByZXR1cm4gcmVzLmpzb24oe1xuICAgICAgdGFzayxcbiAgICAgIG1lc3NhZ2U6ICdLZXkgZGVsZXRlZCBzdWNjZXNzZnVsbHknXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==