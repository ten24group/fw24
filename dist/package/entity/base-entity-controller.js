"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseEntityController = void 0;
const crypto_1 = require("crypto");
const s3_1 = require("../client/s3");
const util_1 = require("../client/util");
const const_1 = require("../const");
const api_gateway_controller_1 = require("../core/runtime/api-gateway-controller");
const method_1 = require("../decorators/method");
const errors_1 = require("../errors");
const handlers_1 = require("../errors/handlers");
const search_1 = require("../search");
const utils_1 = require("../utils");
const parse_1 = require("../utils/parse");
const query_1 = require("./query");
/**
 * Abstract base class for entity controllers.
 * @template Sch - The entity schema type.
 */
class BaseEntityController extends api_gateway_controller_1.APIController {
    entityService;
    entityName;
    /**
     * Creates an instance of BaseEntityController.
     * @param {BaseEntityService<Sch>} entityService - The entity-service.
     * @param {string} entityName - The name of the entity.
     */
    constructor(entityService, entityName = entityService?.getEntityName()) {
        super();
        this.entityService = entityService;
        this.entityName = entityName;
        // Set error handler options from controller config
        const errorHandlerOptions = Reflect.get(this, 'errorHandlerOptions');
        if (errorHandlerOptions) {
            this.errorHandler = (0, handlers_1.createErrorHandler)({
                includeStack: errorHandlerOptions.includeStack,
                logErrors: errorHandlerOptions.logErrors,
                logRequestDetails: errorHandlerOptions.logRequestDetails
            });
        }
    }
    getEntityName() {
        return this.entityName || this.getEntityService()?.getEntityName();
    }
    /**
     * Initializes the entity controller.
     * Note: It's not an ideal place to initialize the app state/DI/routes, and should be refactored to an ideal component.
     * @param {any} event - The event object.
     * @param {any} context - The context object.
     * @returns {Promise<void>} A promise that resolves when the initialization is complete.
     */
    async initialize(_event, _context) {
        // this.logger.debug(`BaseEntityController.initialize - done: ${event} ${context}`);
    }
    /**
     * Gets the entity service for the controller.
     * @template S - The type of the entity service.
     * @returns {S} The entity service.
     */
    getEntityService() {
        return this.entityService;
    }
    /**
     * Creates a new entity.
     * Top-level `null` in the body omits optional attributes on the new item (not stored as null).
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    async create(req, res, ctx) {
        const createdEntity = await this.getEntityService().create(req.body, ctx);
        const result = {
            [(0, utils_1.camelCase)(this.getEntityName())]: createdEntity,
            message: "Created successfully"
        };
        if (req.debugMode) {
            result.req = req;
        }
        return res.json(result);
    }
    async getSignedUrlForFileUpload(req, res, _ctx) {
        let { bucketName, fileName, expiresIn = 15 * 60, fileNamePrefix = "", contentType = "*/*", metadata } = req.queryStringParameters ?? {};
        // try resolving actual bucket name from simple name like "files-bucket" to "files-bucket-123"	
        // if not found, use the provided bucket name directly
        const resolvedBucketName = util_1.Environment.bucketName(bucketName);
        const nameParts = fileName.split('.');
        const fileExtension = nameParts.pop();
        // ensure it's unique
        fileName = `${fileNamePrefix}${(0, utils_1.toSlug)(nameParts.join('.'))}-${(0, crypto_1.randomUUID)()}.${fileExtension}`;
        if (metadata && (0, utils_1.isString)(metadata) && (0, utils_1.isJsonString)(metadata)) {
            metadata = JSON.parse(metadata);
        }
        const options = {
            fileName,
            metadata: metadata,
            expiresIn,
            bucketName: resolvedBucketName,
            contentType,
            customDomain: (0, utils_1.resolveEnvValueFor)({ key: const_1.ENV_KEYS.FILES_BUCKET_CUSTOM_DOMAIN_ENV_KEY, defaultValue: '' })
        };
        // this.logger.debug(`getSignedUrlForFileUpload::`, options);
        const signedUploadURL = await (0, s3_1.getSignedUrlForFileUpload)(options);
        const response = {
            fileName,
            expiresIn,
            contentType,
            signedUploadURL,
        };
        if (req.debugMode) {
            response['bucketName'] = resolvedBucketName;
        }
        return res.json(response);
    }
    async duplicate(req, res, ctx) {
        const service = this.getEntityService();
        const identifiers = service.extractEntityIdentifiers(req.pathParameters);
        const duplicateEntity = await service.duplicate(identifiers, ctx);
        const result = {
            [(0, utils_1.camelCase)(this.getEntityName())]: duplicateEntity,
        };
        if (req.debugMode) {
            result.req = req;
            result.identifiers = identifiers;
        }
        return res.json(result);
    }
    /**
     * Finds an entity by ID.
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    async find(req, res, ctx) {
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);
        const attributes = req.queryStringParameters?.attributes?.split?.(',');
        const entity = await this.getEntityService().get({ identifiers, attributes }, ctx);
        if (!entity) {
            throw new errors_1.NotFoundError(this.getEntityName(), undefined, req);
        }
        const result = {
            [(0, utils_1.camelCase)(this.getEntityName())]: entity,
        };
        if (req.debugMode) {
            result.req = req;
            result.identifiers = identifiers;
        }
        return res.json(result);
    }
    /**
     * Lists entities.
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    async list(req, res, ctx) {
        const data = req.queryStringParameters;
        // this.logger.debug(`list - data:`, data);
        const { order, cursor, count, limit, pages, ...restOfQueryParams } = data || {};
        const { filters = {}, attributes, search, searchAttributes, ...restOfQueryParamsWithoutFilters } = restOfQueryParams;
        let parsedFilters = {};
        if (!(0, utils_1.isObject)(filters)) {
            // this.logger.debug(`filters is not an object: need to parse the filters query string`, filters);
            if ((0, utils_1.isJsonString)(filters)) {
                // this.logger.debug(`found JSON string filters parsing`, filters);
                parsedFilters = JSON.parse(filters);
            }
            else {
                // TODO: parse filters query string
                this.logger.warn(`filters is not an JSON: need to parse the filters query string`, filters);
            }
        }
        else {
            // this.logger.debug(`filters is a parsed object`, filters);
            parsedFilters = filters;
        }
        if (restOfQueryParamsWithoutFilters && !(0, utils_1.isEmptyObject)(restOfQueryParamsWithoutFilters)) {
            // this.logger.debug(`found not empty restOfQueryParamsWithoutFilters:`, restOfQueryParamsWithoutFilters);
            const parsedQueryParams = (0, query_1.parseUrlQueryStringParameters)(restOfQueryParamsWithoutFilters);
            // this.logger.debug(`parsed restOfQueryParamsWithoutFilters:`, parsedQueryParams);
            const parsedQueryParamFilters = (0, query_1.queryStringParamsToFilterGroup)(parsedQueryParams);
            // this.logger.debug(`filters from restOfQueryParamsWithoutFilters:`, parsedQueryParamFilters);
            parsedFilters = (0, utils_1.merge)([parsedFilters, parsedQueryParamFilters]) ?? {};
        }
        const pagination = {
            order: order ?? 'asc',
            cursor: cursor ?? null,
            count: (0, parse_1.safeParseInt)(count, 12).value,
            limit: (0, parse_1.safeParseInt)(limit, 250).value,
            pages: pages === 'all' ? 'all' : (0, parse_1.safeParseInt)(pages, 1).value,
        };
        this.logger.debug(`parsed pagination`, pagination);
        const query = {
            filters: (0, utils_1.deepCopy)(parsedFilters),
            attributes: attributes?.split?.(','),
            pagination,
            search,
            searchAttributes
        };
        const { data: records, cursor: newCursor, query: parsedQuery } = await this.getEntityService().list(query, ctx);
        const result = {
            cursor: newCursor,
            items: records,
        };
        if (req.debugMode) {
            result.req = req;
            result.criteria = {
                pagination,
                filters,
                parsedFilters,
                restOfQueryParamsWithoutFilters,
                parsedQuery
            };
        }
        return res.json(result);
    }
    /**
     * Updates an entity by ID.
     * Request body uses JSON Merge Patch semantics for top-level keys: `null` clears an optional attribute
     * (DynamoDB REMOVE), rather than storing null (ElectroDB rejects null for most scalar types).
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    async update(req, res, ctx) {
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);
        const entity = await this.getEntityService().get({ identifiers }, ctx);
        if (!entity) {
            throw new errors_1.NotFoundError(this.getEntityName(), undefined, req);
        }
        const updatedEntity = await this.getEntityService().update(identifiers, req.body, undefined, ctx);
        const result = {
            [(0, utils_1.camelCase)(this.getEntityName())]: updatedEntity,
            message: "Updated successfully"
        };
        if (req.debugMode) {
            result.req = req;
            result.identifiers = identifiers;
        }
        return res.json(result);
    }
    /**
     * Deletes an entity by ID.
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    async delete(req, res, ctx) {
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);
        const entity = await this.getEntityService().get({ identifiers }, ctx);
        if (!entity) {
            throw new errors_1.NotFoundError(this.getEntityName(), undefined, req);
        }
        const deletedEntity = await this.getEntityService().delete(identifiers, ctx);
        const result = {
            [(0, utils_1.camelCase)(this.getEntityName())]: deletedEntity,
            message: "Deleted successfully"
        };
        if (req.debugMode) {
            result.req = req;
        }
        return res.json(result);
    }
    /**
     * BULK DELETE OPERATIONS
     * =======================
     *
     * The following methods are commented out by default as they are dangerous operations
     * that can delete multiple records at once. To enable them in your controller:
     *
     * 1. Uncomment the method(s) you need
     * 2. Add appropriate authorization checks
     * 3. Consider adding additional safety measures (e.g., dry-run mode, confirmation tokens)
     * 4. Add audit logging
     *
     * Example usage in a specific entity controller:
     *
     * ```typescript
     * export class MyEntityController extends BaseEntityController<MyEntitySchema> {
     *     // Uncomment and customize the bulk delete methods below
     * }
     * ```
     */
    /**
     * Batch deletes multiple entities by their IDs.
     *
     * ⚠️ DANGEROUS OPERATION - Enable only in specific controllers with proper authorization
     *
     * @param {Request} req - The request object with body: { ids: Array<identifiers>, concurrent?: number }
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     *
     * @example
     * // Request body:
     * {
     *   "ids": [
     *     { "id": "item1" },
     *     { "id": "item2" },
     *     { "id": "item3" }
     *   ],
     *   "concurrent": 2
     * }
     */
    // ⚠️ DANGEROUS OPERATION
    //  @Post('/batch-delete')
    async batchDelete(req, res, ctx) {
        const { ids = [], concurrent = 1 } = req.body || {};
        const identifiers = ids.map((id) => this.getEntityService()?.extractEntityIdentifiers(id));
        const result = await this.getEntityService().batchDelete({
            identifiers,
            concurrent
        }, ctx);
        const unprocessedCount = result?.unprocessed?.length || 0;
        const deletedCount = identifiers.length - unprocessedCount;
        const response = {
            deletedCount,
            unprocessedCount: unprocessedCount,
            message: `Successfully deleted ${deletedCount} ${this.getEntityName()} record(s)`
        };
        if (unprocessedCount > 0) {
            response.unprocessed = result?.unprocessed || [];
            response.message += `, ${unprocessedCount} failed`;
        }
        if (req.debugMode) {
            response.req = req;
        }
        return res.json(response);
    }
    /**
     * Deletes entities based on filter criteria.
     *
     * ⚠️ EXTREMELY DANGEROUS OPERATION - Enable only in specific controllers with strict authorization
     *
     * This endpoint queries for entities matching the filters and batch deletes them.
     * It includes safety measures like requiring filters and optional maxItems limit.
     *
     * @param {Request} req - The request object with body containing filters and options
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     *
     * @example
     * // Request body:
     * {
     *   "filters": {
     *     "status": { "eq": "inactive" },
     *     "lastLoginAt": { "lt": "2023-01-01" }
     *   },
     *   "batchSize": 50,
     *   "concurrent": 2,
     *   "maxItems": 1000
     * }
     */
    // ⚠️ EXTREMELY DANGEROUS OPERATION
    // @Post('/delete-by-query')
    async deleteByQuery(req, res, ctx) {
        const { filters, batchSize = 25, concurrent = 1, maxItems } = req.body || {};
        const { dryRun = false } = req.queryStringParameters || {};
        if (dryRun) {
            const previewResult = await this.getEntityService().query({
                filters,
                pagination: { count: 1000, limit: 1000, pages: 'all' }
            }, ctx);
            return res.json({
                message: 'Dry run mode - preview results [up to 1000 items]',
                previewCount: previewResult.data.length,
                preview: previewResult.data
            });
        }
        const result = await this.getEntityService().deleteByQuery({
            filters,
            batchSize,
            concurrent,
            maxItems
        }, ctx);
        const response = {
            ...result,
            message: `Successfully deleted ${result.deletedCount} ${this.getEntityName()} record(s)`
        };
        if (result.failedCount > 0) {
            response.message += `, ${result.failedCount} failed`;
        }
        if (req.debugMode) {
            response.req = req;
            response.filters = filters;
        }
        return res.json(response);
    }
    /**
     * Performs a custom query on the entity.
     * @param {Request} req - The request object.
     * @param {Response} res - The response object.
     * @returns {Promise<Response>} A promise that resolves with the response.
     */
    async query(req, res, ctx) {
        const query = req.body;
        // this.logger.debug(`query - query:`, query);
        const inputQuery = (0, utils_1.deepCopy)(query);
        const { data: records, cursor: newCursor, query: parsedQuery } = await this.getEntityService().query(query, ctx);
        const result = {
            cursor: newCursor,
            items: records,
        };
        if (req.debugMode) {
            result.req = req;
            result.criteria = {
                inputQuery,
                parsedQuery
            };
        }
        return res.json(result);
    }
    async search(req, res, ctx) {
        const query = req.body;
        const inputQuery = (0, utils_1.deepCopy)(query);
        const results = await this.getEntityService().search(query, ctx);
        const { hits, ...rest } = results;
        const response = {
            ...rest,
            items: hits,
        };
        if (req.debugMode) {
            Object.assign(response, {
                inputQuery,
                processingTimeMs: results.processingTimeMs
            });
        }
        return res.json(response);
    }
    async searchGet(req, res, ctx) {
        const query = (0, search_1.parseSearchQuery)(req.queryStringParameters || {});
        return await this.search({ ...req, body: query }, res, ctx);
    }
}
exports.BaseEntityController = BaseEntityController;
__decorate([
    (0, method_1.Post)('')
], BaseEntityController.prototype, "create", null);
__decorate([
    (0, method_1.Get)('/getSignedUrlForFileUpload', {
        validations: {
            fileName: {
                required: true,
                datatype: 'string',
            },
            bucketName: {
                required: true,
                datatype: 'string',
            },
        }
    })
], BaseEntityController.prototype, "getSignedUrlForFileUpload", null);
__decorate([
    (0, method_1.Get)('/duplicate/{id}')
], BaseEntityController.prototype, "duplicate", null);
__decorate([
    (0, method_1.Get)('/{id}')
], BaseEntityController.prototype, "find", null);
__decorate([
    (0, method_1.Get)('')
], BaseEntityController.prototype, "list", null);
__decorate([
    (0, method_1.Patch)('/{id}')
], BaseEntityController.prototype, "update", null);
__decorate([
    (0, method_1.Delete)('/{id}')
], BaseEntityController.prototype, "delete", null);
__decorate([
    (0, method_1.Post)('/query')
], BaseEntityController.prototype, "query", null);
__decorate([
    (0, method_1.Post)('/search')
], BaseEntityController.prototype, "search", null);
__decorate([
    (0, method_1.Get)('/search')
], BaseEntityController.prototype, "searchGet", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1lbnRpdHktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvYmFzZS1lbnRpdHktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFLQSxtQ0FBb0M7QUFDcEMscUNBQXlEO0FBQ3pELHlDQUE2QztBQUM3QyxvQ0FBb0M7QUFDcEMsbUZBQXVFO0FBRXZFLGlEQUFnRTtBQUNoRSxzQ0FBMEM7QUFDMUMsaURBQXdEO0FBQ3hELHNDQUFnRTtBQUNoRSxvQ0FBbUk7QUFDbkksMENBQThDO0FBQzlDLG1DQUF3RjtBQWF4Rjs7O0dBR0c7QUFDSCxNQUFhLG9CQUE4RCxTQUFRLHNDQUFhO0lBU2hFO0lBUHZCLFVBQVUsQ0FBUztJQUUzQjs7OztPQUlHO0lBQ0gsWUFBK0IsYUFBcUMsRUFBRSxVQUFVLEdBQUcsYUFBYSxFQUFFLGFBQWEsRUFBRTtRQUNoSCxLQUFLLEVBQUUsQ0FBQztRQURzQixrQkFBYSxHQUFiLGFBQWEsQ0FBd0I7UUFFbkUsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUM7UUFFN0IsbURBQW1EO1FBQ25ELE1BQU0sbUJBQW1CLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLENBSXRELENBQUM7UUFFZCxJQUFJLG1CQUFtQixFQUFFLENBQUM7WUFDekIsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFBLDZCQUFrQixFQUFDO2dCQUN0QyxZQUFZLEVBQUUsbUJBQW1CLENBQUMsWUFBWTtnQkFDOUMsU0FBUyxFQUFFLG1CQUFtQixDQUFDLFNBQVM7Z0JBQ3hDLGlCQUFpQixFQUFFLG1CQUFtQixDQUFDLGlCQUFpQjthQUN4RCxDQUFDLENBQUM7UUFDSixDQUFDO0lBQ0YsQ0FBQztJQUVTLGFBQWE7UUFDdEIsT0FBTyxJQUFJLENBQUMsVUFBVSxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLGFBQWEsRUFBRSxD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QVMsQ0FBQyxHQUFZLEVBQUUsR0FBYSxFQUFFLEdBQXNCO1FBQ2xFLE1BQU0sS0FBSyxHQUFHLElBQUEseUJBQWdCLEVBQUMsR0FBRyxDQUFDLHFCQUFxQixJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ2hFLE9BQU8sTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsR0FBRyxHQUFHLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUM3RCxDQUFDO0NBRUQ7QUExaEJELG9EQTBoQkM7QUE3ZE07SUFETCxJQUFBLGFBQUksRUFBQyxFQUFFLENBQUM7a0RBYVI7QUFjSztJQVpMLElBQUEsWUFBRyxFQUFDLDRCQUE0QixFQUFFO1FBQ2xDLFdBQVcsRUFBRTtZQUNaLFFBQVEsRUFBRTtnQkFDVCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxRQUFRLEVBQUUsUUFBUTthQUNsQjtZQUNELFVBQVUsRUFBRTtnQkFDWCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxRQUFRLEVBQUUsUUFBUTthQUNsQjtTQUNEO0tBQ0QsQ0FBQztxRUE0Q0Q7QUFHSztJQURMLElBQUEsWUFBRyxFQUFDLGlCQUFpQixDQUFDO3FEQWtCdEI7QUFTSztJQURMLElBQUEsWUFBRyxFQUFDLE9BQU8sQ0FBQztnREFxQlo7QUFTSztJQURMLElBQUEsWUFBRyxFQUFDLEVBQUUsQ0FBQztnREFrRlA7QUFXSztJQURMLElBQUEsY0FBSyxFQUFDLE9BQU8sQ0FBQztrREFzQmQ7QUFTSztJQURMLElBQUEsZUFBTSxFQUFDLE9BQU8sQ0FBQztrREFxQmY7QUEwSks7SUFETCxJQUFBLGFBQUksRUFBQyxRQUFRLENBQUM7aURBdUJkO0FBR0s7SUFETCxJQUFBLGFBQUksRUFBQyxTQUFTLENBQUM7a0RBc0JmO0FBR0s7SUFETCxJQUFBLFlBQUcsRUFBQyxTQUFTLENBQUM7cURBSWQiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IFJlcXVlc3QsIFJlc3BvbnNlIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgdHlwZSB7IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWEsIEVudGl0eVNjaGVtYSB9IGZyb20gJy4vYmFzZS1lbnRpdHknO1xuaW1wb3J0IHR5cGUgeyBCYXNlRW50aXR5U2VydmljZSB9IGZyb20gJy4vYmFzZS1zZXJ2aWNlJztcbmltcG9ydCB0eXBlIHsgRW50aXR5RmlsdGVyQ3JpdGVyaWEgfSBmcm9tICcuL3F1ZXJ5LXR5cGVzJztcblxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBnZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkIH0gZnJvbSAnLi4vY2xpZW50L3MzJztcbmltcG9ydCB7IEVudmlyb25tZW50IH0gZnJvbSAnLi4vY2xpZW50L3V0aWwnO1xuaW1wb3J0IHsgRU5WX0tFWVMgfSBmcm9tICcuLi9jb25zdCc7XG5pbXBvcnQgeyBBUElDb250cm9sbGVyIH0gZnJvbSAnLi4vY29yZS9ydW50aW1lL2FwaS1nYXRld2F5LWNvbnRyb2xsZXInO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgRGVsZXRlLCBHZXQsIFBhdGNoLCBQb3N0IH0gZnJvbSAnLi4vZGVjb3JhdG9ycy9tZXRob2QnO1xuaW1wb3J0IHsgTm90Rm91bmRFcnJvciB9IGZyb20gJy4uL2Vycm9ycyc7XG5pbXBvcnQgeyBjcmVhdGVFcnJvckhhbmRsZXIgfSBmcm9tICcuLi9lcnJvcnMvaGFuZGxlcnMnO1xuaW1wb3J0IHsgRW50aXR5U2VhcmNoUXVlcnksIHBhcnNlU2VhcmNoUXVlcnkgfSBmcm9tICcuLi9zZWFyY2gnO1xuaW1wb3J0IHsgY2FtZWxDYXNlLCBkZWVwQ29weSwgaXNFbXB0eU9iamVjdCwgaXNKc29uU3RyaW5nLCBpc09iamVjdCwgaXNTdHJpbmcsIG1lcmdlLCByZXNvbHZlRW52VmFsdWVGb3IsIHRvU2x1ZyB9IGZyb20gJy4uL3V0aWxzJztcbmltcG9ydCB7IHNhZmVQYXJzZUludCB9IGZyb20gJy4uL3V0aWxzL3BhcnNlJztcbmltcG9ydCB7IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzLCBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAgfSBmcm9tICcuL3F1ZXJ5JztcblxudHlwZSBzZWNvbmRzID0gbnVtYmVyO1xuXG5leHBvcnQgdHlwZSBHZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkU2NoZW1hID0ge1xuXHRmaWxlTmFtZTogc3RyaW5nLFxuXHRidWNrZXROYW1lOiBzdHJpbmcsXG5cdGV4cGlyZXNJbj86IHNlY29uZHMsIC8vIGRlZmF1bHQgdG8gMTUqNjAgc2Vjb25kc1xuXHRmaWxlTmFtZVByZWZpeD86IHN0cmluZyxcblx0Y29udGVudFR5cGU/OiBzdHJpbmcgLy8gZGVmYXVsdCB0byAqLypcblx0bWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgc3RyaW5nXG59O1xuXG4vKipcbiAqIEFic3RyYWN0IGJhc2UgY2xhc3MgZm9yIGVudGl0eSBjb250cm9sbGVycy5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICovXG5leHBvcnQgY2xhc3MgQmFzZUVudGl0eUNvbnRyb2xsZXI8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuXG5cdHByaXZhdGUgZW50aXR5TmFtZTogc3RyaW5nO1xuXG5cdC8qKlxuXHQgKiBDcmVhdGVzIGFuIGluc3RhbmNlIG9mIEJhc2VFbnRpdHlDb250cm9sbGVyLlxuXHQgKiBAcGFyYW0ge0Jhc2VFbnRpdHlTZXJ2aWNlPFNjaD59IGVudGl0eVNlcnZpY2UgLSBUaGUgZW50aXR5LXNlcnZpY2UuXG5cdCAqIEBwYXJhbSB7c3RyaW5nfSBlbnRpdHlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGVudGl0eS5cblx0ICovXG5cdGNvbnN0cnVjdG9yKHByb3RlY3RlZCByZWFkb25seSBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxTY2g+LCBlbnRpdHlOYW1lID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5TmFtZSgpKSB7XG5cdFx0c3VwZXIoKTtcblx0XHR0aGlzLmVudGl0eU5hbWUgPSBlbnRpdHlOYW1lO1xuXG5cdFx0Ly8gU2V0IGVycm9yIGhhbmRsZXIgb3B0aW9ucyBmcm9tIGNvbnRyb2xsZXIgY29uZmlnXG5cdFx0Y29uc3QgZXJyb3JIYW5kbGVyT3B0aW9ucyA9IFJlZmxlY3QuZ2V0KHRoaXMsICdlcnJvckhhbmRsZXJPcHRpb25zJykgYXMge1xuXHRcdFx0aW5jbHVkZVN0YWNrPzogYm9vbGVhbjtcblx0XHRcdGxvZ0Vycm9ycz86IGJvb2xlYW47XG5cdFx0XHRsb2dSZXF1ZXN0RGV0YWlscz86IGJvb2xlYW47XG5cdFx0fSB8IHVuZGVmaW5lZDtcblxuXHRcdGlmIChlcnJvckhhbmRsZXJPcHRpb25zKSB7XG5cdFx0XHR0aGlzLmVycm9ySGFuZGxlciA9IGNyZWF0ZUVycm9ySGFuZGxlcih7XG5cdFx0XHRcdGluY2x1ZGVTdGFjazogZXJyb3JIYW5kbGVyT3B0aW9ucy5pbmNsdWRlU3RhY2ssXG5cdFx0XHRcdGxvZ0Vycm9yczogZXJyb3JIYW5kbGVyT3B0aW9ucy5sb2dFcnJvcnMsXG5cdFx0XHRcdGxvZ1JlcXVlc3REZXRhaWxzOiBlcnJvckhhbmRsZXJPcHRpb25zLmxvZ1JlcXVlc3REZXRhaWxzXG5cdFx0XHR9KTtcblx0XHR9XG5cdH1cblxuXHRwcm90ZWN0ZWQgZ2V0RW50aXR5TmFtZSgpIHtcblx0XHRyZXR1cm4gdGhpcy5lbnRpdHlOYW1lIHx8IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpPy5nZXRFbnRpdHlOYW1lKCk7XG5cdH1cblxuXHQvKipcblx0ICogSW5pdGlhbGl6ZXMgdGhlIGVudGl0eSBjb250cm9sbGVyLlxuXHQgKiBOb3RlOiBJdCdzIG5vdCBhbiBpZGVhbCBwbGFjZSB0byBpbml0aWFsaXplIHRoZSBhcHAgc3RhdGUvREkvcm91dGVzLCBhbmQgc2hvdWxkIGJlIHJlZmFjdG9yZWQgdG8gYW4gaWRlYWwgY29tcG9uZW50LlxuXHQgKiBAcGFyYW0ge2FueX0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge2FueX0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gdGhlIGluaXRpYWxpemF0aW9uIGlzIGNvbXBsZXRlLlxuXHQgKi9cblx0YXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IGFueSwgX2NvbnRleHQ6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuXHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBCYXNlRW50aXR5Q29udHJvbGxlci5pbml0aWFsaXplIC0gZG9uZTogJHtldmVudH0gJHtjb250ZXh0fWApO1xuXHR9XG5cblx0LyoqXG5cdCAqIEdldHMgdGhlIGVudGl0eSBzZXJ2aWNlIGZvciB0aGUgY29udHJvbGxlci5cblx0ICogQHRlbXBsYXRlIFMgLSBUaGUgdHlwZSBvZiB0aGUgZW50aXR5IHNlcnZpY2UuXG5cdCAqIEByZXR1cm5zIHtTfSBUaGUgZW50aXR5IHNlcnZpY2UuXG5cdCAqL1xuXHRwdWJsaWMgZ2V0RW50aXR5U2VydmljZTxTIGV4dGVuZHMgQmFzZUVudGl0eVNlcnZpY2U8U2NoPj4oKTogUyB7XG5cdFx0cmV0dXJuIHRoaXMuZW50aXR5U2VydmljZSBhcyBTO1xuXHR9XG5cblx0LyoqXG5cdCAqIENyZWF0ZXMgYSBuZXcgZW50aXR5LlxuXHQgKiBUb3AtbGV2ZWwgYG51bGxgIGluIHRoZSBib2R5IG9taXRzIG9wdGlvbmFsIGF0dHJpYnV0ZXMgb24gdGhlIG5ldyBpdGVtIChub3Qgc3RvcmVkIGFzIG51bGwpLlxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICovXG5cdEBQb3N0KCcnKVxuXHRhc3luYyBjcmVhdGUocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IGNyZWF0ZWRFbnRpdHkgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5jcmVhdGUocmVxLmJvZHksIGN0eCk7XG5cblx0XHRjb25zdCByZXN1bHQ6IGFueSA9IHtcblx0XHRcdFsgY2FtZWxDYXNlKHRoaXMuZ2V0RW50aXR5TmFtZSgpKSBdOiBjcmVhdGVkRW50aXR5LFxuXHRcdFx0bWVzc2FnZTogXCJDcmVhdGVkIHN1Y2Nlc3NmdWxseVwiXG5cdFx0fTtcblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzdWx0KTtcblx0fVxuXG5cdEBHZXQoJy9nZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkJywge1xuXHRcdHZhbGlkYXRpb25zOiB7XG5cdFx0XHRmaWxlTmFtZToge1xuXHRcdFx0XHRyZXF1aXJlZDogdHJ1ZSxcblx0XHRcdFx0ZGF0YXR5cGU6ICdzdHJpbmcnLFxuXHRcdFx0fSxcblx0XHRcdGJ1Y2tldE5hbWU6IHtcblx0XHRcdFx0cmVxdWlyZWQ6IHRydWUsXG5cdFx0XHRcdGRhdGF0eXBlOiAnc3RyaW5nJyxcblx0XHRcdH0sXG5cdFx0fVxuXHR9KVxuXHRhc3luYyBnZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuXHRcdGxldCB7IGJ1Y2tldE5hbWUsIGZpbGVOYW1lLCBleHBpcmVzSW4gPSAxNSAqIDYwLCBmaWxlTmFtZVByZWZpeCA9IFwiXCIsIGNvbnRlbnRUeXBlID0gXCIqLypcIiwgbWV0YWRhdGEgfSA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnMgYXMgR2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZFNjaGVtYSA/PyB7fTtcblxuXHRcdC8vIHRyeSByZXNvbHZpbmcgYWN0dWFsIGJ1Y2tldCBuYW1lIGZyb20gc2ltcGxlIG5hbWUgbGlrZSBcImZpbGVzLWJ1Y2tldFwiIHRvIFwiZmlsZXMtYnVja2V0LTEyM1wiXHRcblx0XHQvLyBpZiBub3QgZm91bmQsIHVzZSB0aGUgcHJvdmlkZWQgYnVja2V0IG5hbWUgZGlyZWN0bHlcblx0XHRjb25zdCByZXNvbHZlZEJ1Y2tldE5hbWUgPSBFbnZpcm9ubWVudC5idWNrZXROYW1lKGJ1Y2tldE5hbWUpO1xuXG5cdFx0Y29uc3QgbmFtZVBhcnRzID0gZmlsZU5hbWUuc3BsaXQoJy4nKTtcblx0XHRjb25zdCBmaWxlRXh0ZW5zaW9uID0gbmFtZVBhcnRzLnBvcCgpO1xuXG5cdFx0Ly8gZW5zdXJlIGl0J3MgdW5pcXVlXG5cdFx0ZmlsZU5hbWUgPSBgJHtmaWxlTmFtZVByZWZpeH0ke3RvU2x1ZyhuYW1lUGFydHMuam9pbignLicpKX0tJHtyYW5kb21VVUlEKCl9LiR7ZmlsZUV4dGVuc2lvbn1gO1xuXG5cdFx0aWYgKG1ldGFkYXRhICYmIGlzU3RyaW5nKG1ldGFkYXRhKSAmJiBpc0pzb25TdHJpbmcobWV0YWRhdGEpKSB7XG5cdFx0XHRtZXRhZGF0YSA9IEpTT04ucGFyc2UobWV0YWRhdGEpO1xuXHRcdH1cblxuXHRcdGNvbnN0IG9wdGlvbnMgPSB7XG5cdFx0XHRmaWxlTmFtZSxcblx0XHRcdG1ldGFkYXRhOiBtZXRhZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuXHRcdFx0ZXhwaXJlc0luLFxuXHRcdFx0YnVja2V0TmFtZTogcmVzb2x2ZWRCdWNrZXROYW1lLFxuXHRcdFx0Y29udGVudFR5cGUsXG5cdFx0XHRjdXN0b21Eb21haW46IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogRU5WX0tFWVMuRklMRVNfQlVDS0VUX0NVU1RPTV9ET01BSU5fRU5WX0tFWSwgZGVmYXVsdFZhbHVlOiAnJyB9KVxuXHRcdH07XG5cblx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZDo6YCwgb3B0aW9ucyk7XG5cblx0XHRjb25zdCBzaWduZWRVcGxvYWRVUkwgPSBhd2FpdCBnZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkKG9wdGlvbnMpO1xuXG5cdFx0Y29uc3QgcmVzcG9uc2U6IGFueSA9IHtcblx0XHRcdGZpbGVOYW1lLFxuXHRcdFx0ZXhwaXJlc0luLFxuXHRcdFx0Y29udGVudFR5cGUsXG5cdFx0XHRzaWduZWRVcGxvYWRVUkwsXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXNwb25zZVsgJ2J1Y2tldE5hbWUnIF0gPSByZXNvbHZlZEJ1Y2tldE5hbWU7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3BvbnNlKTtcblx0fVxuXG5cdEBHZXQoJy9kdXBsaWNhdGUve2lkfScpXG5cdGFzeW5jIGR1cGxpY2F0ZShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblx0XHRjb25zdCBzZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCk7XG5cblx0XHRjb25zdCBpZGVudGlmaWVycyA9IHNlcnZpY2UuZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKHJlcS5wYXRoUGFyYW1ldGVycykgYXMgRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTY2g+O1xuXG5cdFx0Y29uc3QgZHVwbGljYXRlRW50aXR5ID0gYXdhaXQgc2VydmljZS5kdXBsaWNhdGUoaWRlbnRpZmllcnMsIGN0eCk7XG5cblx0XHRjb25zdCByZXN1bHQ6IGFueSA9IHtcblx0XHRcdFsgY2FtZWxDYXNlKHRoaXMuZ2V0RW50aXR5TmFtZSgpKSBdOiBkdXBsaWNhdGVFbnRpdHksXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdFx0cmVzdWx0LmlkZW50aWZpZXJzID0gaWRlbnRpZmllcnM7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHQvKipcblx0ICogRmluZHMgYW4gZW50aXR5IGJ5IElELlxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICovXG5cdEBHZXQoJy97aWR9Jylcblx0YXN5bmMgZmluZChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgaWRlbnRpZmllcnMgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoKT8uZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKHJlcS5wYXRoUGFyYW1ldGVycyk7XG5cdFx0Y29uc3QgYXR0cmlidXRlcyA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnM/LmF0dHJpYnV0ZXM/LnNwbGl0Py4oJywnKTtcblxuXHRcdGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmdldCh7IGlkZW50aWZpZXJzLCBhdHRyaWJ1dGVzIH0sIGN0eCk7XG5cblx0XHRpZiAoIWVudGl0eSkge1xuXHRcdFx0dGhyb3cgbmV3IE5vdEZvdW5kRXJyb3IodGhpcy5nZXRFbnRpdHlOYW1lKCksIHVuZGVmaW5lZCwgcmVxKTtcblx0XHR9XG5cblx0XHRjb25zdCByZXN1bHQ6IGFueSA9IHtcblx0XHRcdFsgY2FtZWxDYXNlKHRoaXMuZ2V0RW50aXR5TmFtZSgpKSBdOiBlbnRpdHksXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdFx0cmVzdWx0LmlkZW50aWZpZXJzID0gaWRlbnRpZmllcnM7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHQvKipcblx0ICogTGlzdHMgZW50aXRpZXMuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QEdldCgnJylcblx0YXN5bmMgbGlzdChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgZGF0YSA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnM7XG5cdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGxpc3QgLSBkYXRhOmAsIGRhdGEpO1xuXG5cdFx0Y29uc3Qge1xuXHRcdFx0b3JkZXIsXG5cdFx0XHRjdXJzb3IsXG5cdFx0XHRjb3VudCxcblx0XHRcdGxpbWl0LFxuXHRcdFx0cGFnZXMsXG5cdFx0XHQuLi5yZXN0T2ZRdWVyeVBhcmFtc1xuXHRcdH0gPSBkYXRhIHx8IHt9O1xuXG5cdFx0Y29uc3QgeyBmaWx0ZXJzID0ge30sIGF0dHJpYnV0ZXMsIHNlYXJjaCwgc2VhcmNoQXR0cmlidXRlcywgLi4ucmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVycyB9ID0gcmVzdE9mUXVlcnlQYXJhbXM7XG5cblx0XHRsZXQgcGFyc2VkRmlsdGVycyA9IHt9O1xuXG5cdFx0aWYgKCFpc09iamVjdChmaWx0ZXJzKSkge1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZpbHRlcnMgaXMgbm90IGFuIG9iamVjdDogbmVlZCB0byBwYXJzZSB0aGUgZmlsdGVycyBxdWVyeSBzdHJpbmdgLCBmaWx0ZXJzKTtcblxuXHRcdFx0aWYgKGlzSnNvblN0cmluZyhmaWx0ZXJzKSkge1xuXHRcdFx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgZm91bmQgSlNPTiBzdHJpbmcgZmlsdGVycyBwYXJzaW5nYCwgZmlsdGVycyk7XG5cdFx0XHRcdHBhcnNlZEZpbHRlcnMgPSBKU09OLnBhcnNlKGZpbHRlcnMpO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Ly8gVE9ETzogcGFyc2UgZmlsdGVycyBxdWVyeSBzdHJpbmdcblx0XHRcdFx0dGhpcy5sb2dnZXIud2FybihgZmlsdGVycyBpcyBub3QgYW4gSlNPTjogbmVlZCB0byBwYXJzZSB0aGUgZmlsdGVycyBxdWVyeSBzdHJpbmdgLCBmaWx0ZXJzKTtcblx0XHRcdH1cblx0XHR9IGVsc2Uge1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZpbHRlcnMgaXMgYSBwYXJzZWQgb2JqZWN0YCwgZmlsdGVycyk7XG5cdFx0XHRwYXJzZWRGaWx0ZXJzID0gZmlsdGVycztcblx0XHR9XG5cblx0XHRpZiAocmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChyZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzKSkge1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZvdW5kIG5vdCBlbXB0eSByZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzOmAsIHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMpO1xuXG5cdFx0XHRjb25zdCBwYXJzZWRRdWVyeVBhcmFtcyA9IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzKHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMpO1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYHBhcnNlZCByZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzOmAsIHBhcnNlZFF1ZXJ5UGFyYW1zKTtcblxuXHRcdFx0Y29uc3QgcGFyc2VkUXVlcnlQYXJhbUZpbHRlcnMgPSBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAocGFyc2VkUXVlcnlQYXJhbXMpO1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZpbHRlcnMgZnJvbSByZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzOmAsIHBhcnNlZFF1ZXJ5UGFyYW1GaWx0ZXJzKTtcblxuXHRcdFx0cGFyc2VkRmlsdGVycyA9IG1lcmdlKFsgcGFyc2VkRmlsdGVycywgcGFyc2VkUXVlcnlQYXJhbUZpbHRlcnMgXSkgPz8ge307XG5cdFx0fVxuXG5cdFx0Y29uc3QgcGFnaW5hdGlvbiA9IHtcblx0XHRcdG9yZGVyOiBvcmRlciA/PyAnYXNjJyxcblx0XHRcdGN1cnNvcjogY3Vyc29yID8/IG51bGwsXG5cdFx0XHRjb3VudDogc2FmZVBhcnNlSW50KGNvdW50LCAxMikudmFsdWUsXG5cdFx0XHRsaW1pdDogc2FmZVBhcnNlSW50KGxpbWl0LCAyNTApLnZhbHVlLFxuXHRcdFx0cGFnZXM6IHBhZ2VzID09PSAnYWxsJyA/ICdhbGwnIGFzIGNvbnN0IDogc2FmZVBhcnNlSW50KHBhZ2VzLCAxKS52YWx1ZSxcblx0XHR9XG5cblx0XHR0aGlzLmxvZ2dlci5kZWJ1ZyhgcGFyc2VkIHBhZ2luYXRpb25gLCBwYWdpbmF0aW9uKTtcblxuXHRcdGNvbnN0IHF1ZXJ5ID0ge1xuXHRcdFx0ZmlsdGVyczogZGVlcENvcHkocGFyc2VkRmlsdGVycykgYXMgRW50aXR5RmlsdGVyQ3JpdGVyaWE8U2NoPixcblx0XHRcdGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXM/LnNwbGl0Py4oJywnKSxcblx0XHRcdHBhZ2luYXRpb24sXG5cdFx0XHRzZWFyY2gsXG5cdFx0XHRzZWFyY2hBdHRyaWJ1dGVzXG5cdFx0fTtcblxuXHRcdGNvbnN0IHsgZGF0YTogcmVjb3JkcywgY3Vyc29yOiBuZXdDdXJzb3IsIHF1ZXJ5OiBwYXJzZWRRdWVyeSB9ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkubGlzdChxdWVyeSwgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0Y3Vyc29yOiBuZXdDdXJzb3IsXG5cdFx0XHRpdGVtczogcmVjb3Jkcyxcblx0XHR9O1xuXG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3VsdC5yZXEgPSByZXE7XG5cdFx0XHRyZXN1bHQuY3JpdGVyaWEgPSB7XG5cdFx0XHRcdHBhZ2luYXRpb24sXG5cdFx0XHRcdGZpbHRlcnMsXG5cdFx0XHRcdHBhcnNlZEZpbHRlcnMsXG5cdFx0XHRcdHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMsXG5cdFx0XHRcdHBhcnNlZFF1ZXJ5XG5cdFx0XHR9O1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXN1bHQpO1xuXHR9XG5cblx0LyoqXG5cdCAqIFVwZGF0ZXMgYW4gZW50aXR5IGJ5IElELlxuXHQgKiBSZXF1ZXN0IGJvZHkgdXNlcyBKU09OIE1lcmdlIFBhdGNoIHNlbWFudGljcyBmb3IgdG9wLWxldmVsIGtleXM6IGBudWxsYCBjbGVhcnMgYW4gb3B0aW9uYWwgYXR0cmlidXRlXG5cdCAqIChEeW5hbW9EQiBSRU1PVkUpLCByYXRoZXIgdGhhbiBzdG9yaW5nIG51bGwgKEVsZWN0cm9EQiByZWplY3RzIG51bGwgZm9yIG1vc3Qgc2NhbGFyIHR5cGVzKS5cblx0ICogQHBhcmFtIHtSZXF1ZXN0fSByZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG5cdCAqIEBwYXJhbSB7UmVzcG9uc2V9IHJlcyAtIFRoZSByZXNwb25zZSBvYmplY3QuXG5cdCAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3BvbnNlPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgcmVzcG9uc2UuXG5cdCAqL1xuXHRAUGF0Y2goJy97aWR9Jylcblx0YXN5bmMgdXBkYXRlKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVzcG9uc2U+IHtcblx0XHRjb25zdCBpZGVudGlmaWVycyA9IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpPy5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMocmVxLnBhdGhQYXJhbWV0ZXJzKTtcblxuXHRcdGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmdldCh7IGlkZW50aWZpZXJzIH0sIGN0eCk7XG5cblx0XHRpZiAoIWVudGl0eSkge1xuXHRcdFx0dGhyb3cgbmV3IE5vdEZvdW5kRXJyb3IodGhpcy5nZXRFbnRpdHlOYW1lKCksIHVuZGVmaW5lZCwgcmVxKTtcblx0XHR9XG5cblx0XHRjb25zdCB1cGRhdGVkRW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkudXBkYXRlKGlkZW50aWZpZXJzIGFzIGFueSwgcmVxLmJvZHksIHVuZGVmaW5lZCwgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0WyBjYW1lbENhc2UodGhpcy5nZXRFbnRpdHlOYW1lKCkpIF06IHVwZGF0ZWRFbnRpdHksXG5cdFx0XHRtZXNzYWdlOiBcIlVwZGF0ZWQgc3VjY2Vzc2Z1bGx5XCJcblx0XHR9O1xuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdFx0cmVzdWx0LmlkZW50aWZpZXJzID0gaWRlbnRpZmllcnM7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHQvKipcblx0ICogRGVsZXRlcyBhbiBlbnRpdHkgYnkgSUQuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QERlbGV0ZSgnL3tpZH0nKVxuXHRhc3luYyBkZWxldGUocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IGlkZW50aWZpZXJzID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCk/LmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhyZXEucGF0aFBhcmFtZXRlcnMpO1xuXHRcdGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmdldCh7IGlkZW50aWZpZXJzIH0sIGN0eCk7XG5cblx0XHRpZiAoIWVudGl0eSkge1xuXHRcdFx0dGhyb3cgbmV3IE5vdEZvdW5kRXJyb3IodGhpcy5nZXRFbnRpdHlOYW1lKCksIHVuZGVmaW5lZCwgcmVxKTtcblx0XHR9XG5cblx0XHRjb25zdCBkZWxldGVkRW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuZGVsZXRlKGlkZW50aWZpZXJzLCBjdHgpO1xuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRbIGNhbWVsQ2FzZSh0aGlzLmdldEVudGl0eU5hbWUoKSkgXTogZGVsZXRlZEVudGl0eSxcblx0XHRcdG1lc3NhZ2U6IFwiRGVsZXRlZCBzdWNjZXNzZnVsbHlcIlxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzdWx0KTtcblx0fVxuXG5cdC8qKlxuXHQgKiBCVUxLIERFTEVURSBPUEVSQVRJT05TXG5cdCAqID09PT09PT09PT09PT09PT09PT09PT09XG5cdCAqIFxuXHQgKiBUaGUgZm9sbG93aW5nIG1ldGhvZHMgYXJlIGNvbW1lbnRlZCBvdXQgYnkgZGVmYXVsdCBhcyB0aGV5IGFyZSBkYW5nZXJvdXMgb3BlcmF0aW9uc1xuXHQgKiB0aGF0IGNhbiBkZWxldGUgbXVsdGlwbGUgcmVjb3JkcyBhdCBvbmNlLiBUbyBlbmFibGUgdGhlbSBpbiB5b3VyIGNvbnRyb2xsZXI6XG5cdCAqIFxuXHQgKiAxLiBVbmNvbW1lbnQgdGhlIG1ldGhvZChzKSB5b3UgbmVlZFxuXHQgKiAyLiBBZGQgYXBwcm9wcmlhdGUgYXV0aG9yaXphdGlvbiBjaGVja3Ncblx0ICogMy4gQ29uc2lkZXIgYWRkaW5nIGFkZGl0aW9uYWwgc2FmZXR5IG1lYXN1cmVzIChlLmcuLCBkcnktcnVuIG1vZGUsIGNvbmZpcm1hdGlvbiB0b2tlbnMpXG5cdCAqIDQuIEFkZCBhdWRpdCBsb2dnaW5nXG5cdCAqIFxuXHQgKiBFeGFtcGxlIHVzYWdlIGluIGEgc3BlY2lmaWMgZW50aXR5IGNvbnRyb2xsZXI6XG5cdCAqIFxuXHQgKiBgYGB0eXBlc2NyaXB0XG5cdCAqIGV4cG9ydCBjbGFzcyBNeUVudGl0eUNvbnRyb2xsZXIgZXh0ZW5kcyBCYXNlRW50aXR5Q29udHJvbGxlcjxNeUVudGl0eVNjaGVtYT4ge1xuXHQgKiAgICAgLy8gVW5jb21tZW50IGFuZCBjdXN0b21pemUgdGhlIGJ1bGsgZGVsZXRlIG1ldGhvZHMgYmVsb3dcblx0ICogfVxuXHQgKiBgYGBcblx0ICovXG5cblx0LyoqXG5cdCAqIEJhdGNoIGRlbGV0ZXMgbXVsdGlwbGUgZW50aXRpZXMgYnkgdGhlaXIgSURzLlxuXHQgKiBcblx0ICog4pqg77iPIERBTkdFUk9VUyBPUEVSQVRJT04gLSBFbmFibGUgb25seSBpbiBzcGVjaWZpYyBjb250cm9sbGVycyB3aXRoIHByb3BlciBhdXRob3JpemF0aW9uXG5cdCAqIFxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdCB3aXRoIGJvZHk6IHsgaWRzOiBBcnJheTxpZGVudGlmaWVycz4sIGNvbmN1cnJlbnQ/OiBudW1iZXIgfVxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKiBcblx0ICogQGV4YW1wbGVcblx0ICogLy8gUmVxdWVzdCBib2R5OlxuXHQgKiB7XG5cdCAqICAgXCJpZHNcIjogW1xuXHQgKiAgICAgeyBcImlkXCI6IFwiaXRlbTFcIiB9LFxuXHQgKiAgICAgeyBcImlkXCI6IFwiaXRlbTJcIiB9LFxuXHQgKiAgICAgeyBcImlkXCI6IFwiaXRlbTNcIiB9XG5cdCAqICAgXSxcblx0ICogICBcImNvbmN1cnJlbnRcIjogMlxuXHQgKiB9XG5cdCAqL1xuXHQvLyDimqDvuI8gREFOR0VST1VTIE9QRVJBVElPTlxuXHQvLyAgQFBvc3QoJy9iYXRjaC1kZWxldGUnKVxuXHRhc3luYyBiYXRjaERlbGV0ZShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgeyBpZHMgPSBbXSwgY29uY3VycmVudCA9IDEgfSA9IHJlcS5ib2R5IHx8IHt9O1xuXG5cdFx0Y29uc3QgaWRlbnRpZmllcnMgPSBpZHMubWFwKChpZDogYW55KSA9PiB0aGlzLmdldEVudGl0eVNlcnZpY2UoKT8uZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKGlkKSk7XG5cblx0XHRjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5iYXRjaERlbGV0ZSh7XG5cdFx0XHRpZGVudGlmaWVycyxcblx0XHRcdGNvbmN1cnJlbnRcblx0XHR9LCBjdHgpO1xuXG5cdFx0Y29uc3QgdW5wcm9jZXNzZWRDb3VudCA9IChyZXN1bHQgYXMgYW55KT8udW5wcm9jZXNzZWQ/Lmxlbmd0aCB8fCAwO1xuXG5cdFx0Y29uc3QgZGVsZXRlZENvdW50ID0gaWRlbnRpZmllcnMubGVuZ3RoIC0gdW5wcm9jZXNzZWRDb3VudDtcblxuXHRcdGNvbnN0IHJlc3BvbnNlOiBhbnkgPSB7XG5cdFx0XHRkZWxldGVkQ291bnQsXG5cdFx0XHR1bnByb2Nlc3NlZENvdW50OiB1bnByb2Nlc3NlZENvdW50LFxuXHRcdFx0bWVzc2FnZTogYFN1Y2Nlc3NmdWxseSBkZWxldGVkICR7ZGVsZXRlZENvdW50fSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSByZWNvcmQocylgXG5cdFx0fTtcblxuXHRcdGlmICh1bnByb2Nlc3NlZENvdW50ID4gMCkge1xuXHRcdFx0cmVzcG9uc2UudW5wcm9jZXNzZWQgPSAocmVzdWx0IGFzIGFueSk/LnVucHJvY2Vzc2VkIHx8IFtdO1xuXHRcdFx0cmVzcG9uc2UubWVzc2FnZSArPSBgLCAke3VucHJvY2Vzc2VkQ291bnR9IGZhaWxlZGA7XG5cdFx0fVxuXG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3BvbnNlLnJlcSA9IHJlcTtcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzcG9uc2UpO1xuXHR9XG5cblx0LyoqXG5cdCAqIERlbGV0ZXMgZW50aXRpZXMgYmFzZWQgb24gZmlsdGVyIGNyaXRlcmlhLlxuXHQgKiBcblx0ICog4pqg77iPIEVYVFJFTUVMWSBEQU5HRVJPVVMgT1BFUkFUSU9OIC0gRW5hYmxlIG9ubHkgaW4gc3BlY2lmaWMgY29udHJvbGxlcnMgd2l0aCBzdHJpY3QgYXV0aG9yaXphdGlvblxuXHQgKiBcblx0ICogVGhpcyBlbmRwb2ludCBxdWVyaWVzIGZvciBlbnRpdGllcyBtYXRjaGluZyB0aGUgZmlsdGVycyBhbmQgYmF0Y2ggZGVsZXRlcyB0aGVtLlxuXHQgKiBJdCBpbmNsdWRlcyBzYWZldHkgbWVhc3VyZXMgbGlrZSByZXF1aXJpbmcgZmlsdGVycyBhbmQgb3B0aW9uYWwgbWF4SXRlbXMgbGltaXQuXG5cdCAqIFxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdCB3aXRoIGJvZHkgY29udGFpbmluZyBmaWx0ZXJzIGFuZCBvcHRpb25zXG5cdCAqIEBwYXJhbSB7UmVzcG9uc2V9IHJlcyAtIFRoZSByZXNwb25zZSBvYmplY3QuXG5cdCAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3BvbnNlPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgcmVzcG9uc2UuXG5cdCAqIFxuXHQgKiBAZXhhbXBsZVxuXHQgKiAvLyBSZXF1ZXN0IGJvZHk6XG5cdCAqIHtcblx0ICogICBcImZpbHRlcnNcIjoge1xuXHQgKiAgICAgXCJzdGF0dXNcIjogeyBcImVxXCI6IFwiaW5hY3RpdmVcIiB9LFxuXHQgKiAgICAgXCJsYXN0TG9naW5BdFwiOiB7IFwibHRcIjogXCIyMDIzLTAxLTAxXCIgfVxuXHQgKiAgIH0sXG5cdCAqICAgXCJiYXRjaFNpemVcIjogNTAsXG5cdCAqICAgXCJjb25jdXJyZW50XCI6IDIsXG5cdCAqICAgXCJtYXhJdGVtc1wiOiAxMDAwXG5cdCAqIH1cblx0ICovXG5cdC8vIOKaoO+4jyBFWFRSRU1FTFkgREFOR0VST1VTIE9QRVJBVElPTlxuXHQvLyBAUG9zdCgnL2RlbGV0ZS1ieS1xdWVyeScpXG5cdGFzeW5jIGRlbGV0ZUJ5UXVlcnkocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IHsgZmlsdGVycywgYmF0Y2hTaXplID0gMjUsIGNvbmN1cnJlbnQgPSAxLCBtYXhJdGVtcyB9ID0gcmVxLmJvZHkgfHwge307XG5cblx0XHRjb25zdCB7IGRyeVJ1biA9IGZhbHNlIH0gPSByZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzIHx8IHt9O1xuXG5cdFx0aWYgKGRyeVJ1bikge1xuXHRcdFx0Y29uc3QgcHJldmlld1Jlc3VsdCA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLnF1ZXJ5KHtcblx0XHRcdFx0ZmlsdGVycyxcblx0XHRcdFx0cGFnaW5hdGlvbjogeyBjb3VudDogMTAwMCwgbGltaXQ6IDEwMDAsIHBhZ2VzOiAnYWxsJyB9XG5cdFx0XHR9LFxuXHRcdFx0XHRjdHhcblx0XHRcdCk7XG5cblx0XHRcdHJldHVybiByZXMuanNvbih7XG5cdFx0XHRcdG1lc3NhZ2U6ICdEcnkgcnVuIG1vZGUgLSBwcmV2aWV3IHJlc3VsdHMgW3VwIHRvIDEwMDAgaXRlbXNdJyxcblx0XHRcdFx0cHJldmlld0NvdW50OiBwcmV2aWV3UmVzdWx0LmRhdGEubGVuZ3RoLFxuXHRcdFx0XHRwcmV2aWV3OiBwcmV2aWV3UmVzdWx0LmRhdGFcblx0XHRcdH0pO1xuXHRcdH1cblxuXHRcdGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmRlbGV0ZUJ5UXVlcnkoe1xuXHRcdFx0ZmlsdGVycyxcblx0XHRcdGJhdGNoU2l6ZSxcblx0XHRcdGNvbmN1cnJlbnQsXG5cdFx0XHRtYXhJdGVtc1xuXHRcdH0sIGN0eCk7XG5cblx0XHRjb25zdCByZXNwb25zZTogYW55ID0ge1xuXHRcdFx0Li4ucmVzdWx0LFxuXHRcdFx0bWVzc2FnZTogYFN1Y2Nlc3NmdWxseSBkZWxldGVkICR7cmVzdWx0LmRlbGV0ZWRDb3VudH0gJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gcmVjb3JkKHMpYFxuXHRcdH07XG5cblx0XHRpZiAocmVzdWx0LmZhaWxlZENvdW50ID4gMCkge1xuXHRcdFx0cmVzcG9uc2UubWVzc2FnZSArPSBgLCAke3Jlc3VsdC5mYWlsZWRDb3VudH0gZmFpbGVkYDtcblx0XHR9XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzcG9uc2UucmVxID0gcmVxO1xuXHRcdFx0cmVzcG9uc2UuZmlsdGVycyA9IGZpbHRlcnM7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3BvbnNlKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBQZXJmb3JtcyBhIGN1c3RvbSBxdWVyeSBvbiB0aGUgZW50aXR5LlxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICovXG5cdEBQb3N0KCcvcXVlcnknKVxuXHRhc3luYyBxdWVyeShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgcXVlcnkgPSByZXEuYm9keTtcblx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgcXVlcnkgLSBxdWVyeTpgLCBxdWVyeSk7XG5cblx0XHRjb25zdCBpbnB1dFF1ZXJ5ID0gZGVlcENvcHkocXVlcnkpO1xuXG5cdFx0Y29uc3QgeyBkYXRhOiByZWNvcmRzLCBjdXJzb3I6IG5ld0N1cnNvciwgcXVlcnk6IHBhcnNlZFF1ZXJ5IH0gPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5xdWVyeShxdWVyeSwgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0Y3Vyc29yOiBuZXdDdXJzb3IsXG5cdFx0XHRpdGVtczogcmVjb3Jkcyxcblx0XHR9O1xuXG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3VsdC5yZXEgPSByZXE7XG5cdFx0XHRyZXN1bHQuY3JpdGVyaWEgPSB7XG5cdFx0XHRcdGlucHV0UXVlcnksXG5cdFx0XHRcdHBhcnNlZFF1ZXJ5XG5cdFx0XHR9O1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXN1bHQpO1xuXHR9XG5cblx0QFBvc3QoJy9zZWFyY2gnKVxuXHRhc3luYyBzZWFyY2gocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IHF1ZXJ5ID0gcmVxLmJvZHk7XG5cblx0XHRjb25zdCBpbnB1dFF1ZXJ5ID0gZGVlcENvcHkocXVlcnkpIGFzIEVudGl0eVNlYXJjaFF1ZXJ5PFNjaD47XG5cblx0XHRjb25zdCByZXN1bHRzID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuc2VhcmNoKHF1ZXJ5LCBjdHgpO1xuXG5cdFx0Y29uc3QgeyBoaXRzLCAuLi5yZXN0IH0gPSByZXN1bHRzO1xuXHRcdGNvbnN0IHJlc3BvbnNlID0ge1xuXHRcdFx0Li4ucmVzdCxcblx0XHRcdGl0ZW1zOiBoaXRzLFxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0T2JqZWN0LmFzc2lnbihyZXNwb25zZSwge1xuXHRcdFx0XHRpbnB1dFF1ZXJ5LFxuXHRcdFx0XHRwcm9jZXNzaW5nVGltZU1zOiByZXN1bHRzLnByb2Nlc3NpbmdUaW1lTXNcblx0XHRcdH0pO1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXNwb25zZSk7XG5cdH1cblxuXHRAR2V0KCcvc2VhcmNoJylcblx0YXN5bmMgc2VhcmNoR2V0KHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVzcG9uc2U+IHtcblx0XHRjb25zdCBxdWVyeSA9IHBhcnNlU2VhcmNoUXVlcnkocmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyB8fCB7fSk7XG5cdFx0cmV0dXJuIGF3YWl0IHRoaXMuc2VhcmNoKHsgLi4ucmVxLCBib2R5OiBxdWVyeSB9LCByZXMsIGN0eCk7XG5cdH1cblxufSJdfQ==