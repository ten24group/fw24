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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1lbnRpdHktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvYmFzZS1lbnRpdHktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFLQSxtQ0FBb0M7QUFDcEMscUNBQXlEO0FBQ3pELHlDQUE2QztBQUM3QyxvQ0FBb0M7QUFDcEMsbUZBQXVFO0FBRXZFLGlEQUFnRTtBQUNoRSxzQ0FBMEM7QUFDMUMsaURBQXdEO0FBQ3hELHNDQUFnRTtBQUNoRSxvQ0FBbUk7QUFDbkksMENBQThDO0FBQzlDLG1DQUF3RjtBQWF4Rjs7O0dBR0c7QUFDSCxNQUFhLG9CQUE4RCxTQUFRLHNDQUFhO0lBU2hFO0lBUHZCLFVBQVUsQ0FBUztJQUUzQjs7OztPQUlHO0lBQ0gsWUFBK0IsYUFBcUMsRUFBRSxVQUFVLEdBQUcsYUFBYSxFQUFFLGFBQWEsRUFBRTtRQUNoSCxLQUFLLEVBQUUsQ0FBQztRQURzQixrQkFBYSxHQUFiLGFBQWEsQ0FBd0I7UUFFbkUsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUM7UUFFN0IsbURBQW1EO1FBQ25ELE1BQU0sbUJBQW1CLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLENBSXRELENBQUM7UUFFZCxJQUFJLG1CQUFtQixFQUFFLENBQUM7WUFDekIsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFBLDZCQUFrQixFQUFDO2dCQUN0QyxZQUFZLEVBQUUsbUJBQW1CLENBQUMsWUFBWTtnQkFDOUMsU0FBUyxFQUFFLG1CQUFtQixDQUFDLFNBQVM7Z0JBQ3hDLGlCQUFpQixFQUFFLG1CQUFtQixDQUFDLGlCQUFpQjthQUN4RCxDQUFDLENBQUM7UUFDSixDQUFDO0lBQ0YsQ0FBQztJQUVTLGFBQWE7UUFDdEIsT0FBTyxJQUFJLENBQUMsVUFBVSxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLGFBQWEsRUFBRSxD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Q0FBQyxHQUFZLEVBQUUsR0FBYSxFQUFFLEdBQXNCO1FBQ2xFLE1BQU0sS0FBSyxHQUFHLElBQUEseUJBQWdCLEVBQUMsR0FBRyxDQUFDLHFCQUFxQixJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ2hFLE9BQU8sTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsR0FBRyxHQUFHLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUM3RCxDQUFDO0NBRUQ7QUF2aEJELG9EQXVoQkM7QUEzZE07SUFETCxJQUFBLGFBQUksRUFBQyxFQUFFLENBQUM7a0RBYVI7QUFjSztJQVpMLElBQUEsWUFBRyxFQUFDLDRCQUE0QixFQUFFO1FBQ2xDLFdBQVcsRUFBRTtZQUNaLFFBQVEsRUFBRTtnQkFDVCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxRQUFRLEVBQUUsUUFBUTthQUNsQjtZQUNELFVBQVUsRUFBRTtnQkFDWCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxRQUFRLEVBQUUsUUFBUTthQUNsQjtTQUNEO0tBQ0QsQ0FBQztxRUE0Q0Q7QUFHSztJQURMLElBQUEsWUFBRyxFQUFDLGlCQUFpQixDQUFDO3FEQWtCdEI7QUFTSztJQURMLElBQUEsWUFBRyxFQUFDLE9BQU8sQ0FBQztnREFxQlo7QUFTSztJQURMLElBQUEsWUFBRyxFQUFDLEVBQUUsQ0FBQztnREFrRlA7QUFTSztJQURMLElBQUEsY0FBSyxFQUFDLE9BQU8sQ0FBQztrREFzQmQ7QUFTSztJQURMLElBQUEsZUFBTSxFQUFDLE9BQU8sQ0FBQztrREFxQmY7QUEwSks7SUFETCxJQUFBLGFBQUksRUFBQyxRQUFRLENBQUM7aURBdUJkO0FBR0s7SUFETCxJQUFBLGFBQUksRUFBQyxTQUFTLENBQUM7a0RBc0JmO0FBR0s7SUFETCxJQUFBLFlBQUcsRUFBQyxTQUFTLENBQUM7cURBSWQiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IFJlcXVlc3QsIFJlc3BvbnNlIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgdHlwZSB7IEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWEsIEVudGl0eVNjaGVtYSB9IGZyb20gJy4vYmFzZS1lbnRpdHknO1xuaW1wb3J0IHR5cGUgeyBCYXNlRW50aXR5U2VydmljZSB9IGZyb20gJy4vYmFzZS1zZXJ2aWNlJztcbmltcG9ydCB0eXBlIHsgRW50aXR5RmlsdGVyQ3JpdGVyaWEgfSBmcm9tICcuL3F1ZXJ5LXR5cGVzJztcblxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBnZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkIH0gZnJvbSAnLi4vY2xpZW50L3MzJztcbmltcG9ydCB7IEVudmlyb25tZW50IH0gZnJvbSAnLi4vY2xpZW50L3V0aWwnO1xuaW1wb3J0IHsgRU5WX0tFWVMgfSBmcm9tICcuLi9jb25zdCc7XG5pbXBvcnQgeyBBUElDb250cm9sbGVyIH0gZnJvbSAnLi4vY29yZS9ydW50aW1lL2FwaS1nYXRld2F5LWNvbnRyb2xsZXInO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgRGVsZXRlLCBHZXQsIFBhdGNoLCBQb3N0IH0gZnJvbSAnLi4vZGVjb3JhdG9ycy9tZXRob2QnO1xuaW1wb3J0IHsgTm90Rm91bmRFcnJvciB9IGZyb20gJy4uL2Vycm9ycyc7XG5pbXBvcnQgeyBjcmVhdGVFcnJvckhhbmRsZXIgfSBmcm9tICcuLi9lcnJvcnMvaGFuZGxlcnMnO1xuaW1wb3J0IHsgRW50aXR5U2VhcmNoUXVlcnksIHBhcnNlU2VhcmNoUXVlcnkgfSBmcm9tICcuLi9zZWFyY2gnO1xuaW1wb3J0IHsgY2FtZWxDYXNlLCBkZWVwQ29weSwgaXNFbXB0eU9iamVjdCwgaXNKc29uU3RyaW5nLCBpc09iamVjdCwgaXNTdHJpbmcsIG1lcmdlLCByZXNvbHZlRW52VmFsdWVGb3IsIHRvU2x1ZyB9IGZyb20gJy4uL3V0aWxzJztcbmltcG9ydCB7IHNhZmVQYXJzZUludCB9IGZyb20gJy4uL3V0aWxzL3BhcnNlJztcbmltcG9ydCB7IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzLCBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAgfSBmcm9tICcuL3F1ZXJ5JztcblxudHlwZSBzZWNvbmRzID0gbnVtYmVyO1xuXG5leHBvcnQgdHlwZSBHZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkU2NoZW1hID0ge1xuXHRmaWxlTmFtZTogc3RyaW5nLFxuXHRidWNrZXROYW1lOiBzdHJpbmcsXG5cdGV4cGlyZXNJbj86IHNlY29uZHMsIC8vIGRlZmF1bHQgdG8gMTUqNjAgc2Vjb25kc1xuXHRmaWxlTmFtZVByZWZpeD86IHN0cmluZyxcblx0Y29udGVudFR5cGU/OiBzdHJpbmcgLy8gZGVmYXVsdCB0byAqLypcblx0bWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgc3RyaW5nXG59O1xuXG4vKipcbiAqIEFic3RyYWN0IGJhc2UgY2xhc3MgZm9yIGVudGl0eSBjb250cm9sbGVycy5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICovXG5leHBvcnQgY2xhc3MgQmFzZUVudGl0eUNvbnRyb2xsZXI8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuXG5cdHByaXZhdGUgZW50aXR5TmFtZTogc3RyaW5nO1xuXG5cdC8qKlxuXHQgKiBDcmVhdGVzIGFuIGluc3RhbmNlIG9mIEJhc2VFbnRpdHlDb250cm9sbGVyLlxuXHQgKiBAcGFyYW0ge0Jhc2VFbnRpdHlTZXJ2aWNlPFNjaD59IGVudGl0eVNlcnZpY2UgLSBUaGUgZW50aXR5LXNlcnZpY2UuXG5cdCAqIEBwYXJhbSB7c3RyaW5nfSBlbnRpdHlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGVudGl0eS5cblx0ICovXG5cdGNvbnN0cnVjdG9yKHByb3RlY3RlZCByZWFkb25seSBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxTY2g+LCBlbnRpdHlOYW1lID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5TmFtZSgpKSB7XG5cdFx0c3VwZXIoKTtcblx0XHR0aGlzLmVudGl0eU5hbWUgPSBlbnRpdHlOYW1lO1xuXG5cdFx0Ly8gU2V0IGVycm9yIGhhbmRsZXIgb3B0aW9ucyBmcm9tIGNvbnRyb2xsZXIgY29uZmlnXG5cdFx0Y29uc3QgZXJyb3JIYW5kbGVyT3B0aW9ucyA9IFJlZmxlY3QuZ2V0KHRoaXMsICdlcnJvckhhbmRsZXJPcHRpb25zJykgYXMge1xuXHRcdFx0aW5jbHVkZVN0YWNrPzogYm9vbGVhbjtcblx0XHRcdGxvZ0Vycm9ycz86IGJvb2xlYW47XG5cdFx0XHRsb2dSZXF1ZXN0RGV0YWlscz86IGJvb2xlYW47XG5cdFx0fSB8IHVuZGVmaW5lZDtcblxuXHRcdGlmIChlcnJvckhhbmRsZXJPcHRpb25zKSB7XG5cdFx0XHR0aGlzLmVycm9ySGFuZGxlciA9IGNyZWF0ZUVycm9ySGFuZGxlcih7XG5cdFx0XHRcdGluY2x1ZGVTdGFjazogZXJyb3JIYW5kbGVyT3B0aW9ucy5pbmNsdWRlU3RhY2ssXG5cdFx0XHRcdGxvZ0Vycm9yczogZXJyb3JIYW5kbGVyT3B0aW9ucy5sb2dFcnJvcnMsXG5cdFx0XHRcdGxvZ1JlcXVlc3REZXRhaWxzOiBlcnJvckhhbmRsZXJPcHRpb25zLmxvZ1JlcXVlc3REZXRhaWxzXG5cdFx0XHR9KTtcblx0XHR9XG5cdH1cblxuXHRwcm90ZWN0ZWQgZ2V0RW50aXR5TmFtZSgpIHtcblx0XHRyZXR1cm4gdGhpcy5lbnRpdHlOYW1lIHx8IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpPy5nZXRFbnRpdHlOYW1lKCk7XG5cdH1cblxuXHQvKipcblx0ICogSW5pdGlhbGl6ZXMgdGhlIGVudGl0eSBjb250cm9sbGVyLlxuXHQgKiBOb3RlOiBJdCdzIG5vdCBhbiBpZGVhbCBwbGFjZSB0byBpbml0aWFsaXplIHRoZSBhcHAgc3RhdGUvREkvcm91dGVzLCBhbmQgc2hvdWxkIGJlIHJlZmFjdG9yZWQgdG8gYW4gaWRlYWwgY29tcG9uZW50LlxuXHQgKiBAcGFyYW0ge2FueX0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge2FueX0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gdGhlIGluaXRpYWxpemF0aW9uIGlzIGNvbXBsZXRlLlxuXHQgKi9cblx0YXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IGFueSwgX2NvbnRleHQ6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuXHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBCYXNlRW50aXR5Q29udHJvbGxlci5pbml0aWFsaXplIC0gZG9uZTogJHtldmVudH0gJHtjb250ZXh0fWApO1xuXHR9XG5cblx0LyoqXG5cdCAqIEdldHMgdGhlIGVudGl0eSBzZXJ2aWNlIGZvciB0aGUgY29udHJvbGxlci5cblx0ICogQHRlbXBsYXRlIFMgLSBUaGUgdHlwZSBvZiB0aGUgZW50aXR5IHNlcnZpY2UuXG5cdCAqIEByZXR1cm5zIHtTfSBUaGUgZW50aXR5IHNlcnZpY2UuXG5cdCAqL1xuXHRwdWJsaWMgZ2V0RW50aXR5U2VydmljZTxTIGV4dGVuZHMgQmFzZUVudGl0eVNlcnZpY2U8U2NoPj4oKTogUyB7XG5cdFx0cmV0dXJuIHRoaXMuZW50aXR5U2VydmljZSBhcyBTO1xuXHR9XG5cblx0LyoqXG5cdCAqIENyZWF0ZXMgYSBuZXcgZW50aXR5LlxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICovXG5cdEBQb3N0KCcnKVxuXHRhc3luYyBjcmVhdGUocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IGNyZWF0ZWRFbnRpdHkgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5jcmVhdGUocmVxLmJvZHksIGN0eCk7XG5cblx0XHRjb25zdCByZXN1bHQ6IGFueSA9IHtcblx0XHRcdFsgY2FtZWxDYXNlKHRoaXMuZ2V0RW50aXR5TmFtZSgpKSBdOiBjcmVhdGVkRW50aXR5LFxuXHRcdFx0bWVzc2FnZTogXCJDcmVhdGVkIHN1Y2Nlc3NmdWxseVwiXG5cdFx0fTtcblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzdWx0KTtcblx0fVxuXG5cdEBHZXQoJy9nZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkJywge1xuXHRcdHZhbGlkYXRpb25zOiB7XG5cdFx0XHRmaWxlTmFtZToge1xuXHRcdFx0XHRyZXF1aXJlZDogdHJ1ZSxcblx0XHRcdFx0ZGF0YXR5cGU6ICdzdHJpbmcnLFxuXHRcdFx0fSxcblx0XHRcdGJ1Y2tldE5hbWU6IHtcblx0XHRcdFx0cmVxdWlyZWQ6IHRydWUsXG5cdFx0XHRcdGRhdGF0eXBlOiAnc3RyaW5nJyxcblx0XHRcdH0sXG5cdFx0fVxuXHR9KVxuXHRhc3luYyBnZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuXHRcdGxldCB7IGJ1Y2tldE5hbWUsIGZpbGVOYW1lLCBleHBpcmVzSW4gPSAxNSAqIDYwLCBmaWxlTmFtZVByZWZpeCA9IFwiXCIsIGNvbnRlbnRUeXBlID0gXCIqLypcIiwgbWV0YWRhdGEgfSA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnMgYXMgR2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZFNjaGVtYSA/PyB7fTtcblxuXHRcdC8vIHRyeSByZXNvbHZpbmcgYWN0dWFsIGJ1Y2tldCBuYW1lIGZyb20gc2ltcGxlIG5hbWUgbGlrZSBcImZpbGVzLWJ1Y2tldFwiIHRvIFwiZmlsZXMtYnVja2V0LTEyM1wiXHRcblx0XHQvLyBpZiBub3QgZm91bmQsIHVzZSB0aGUgcHJvdmlkZWQgYnVja2V0IG5hbWUgZGlyZWN0bHlcblx0XHRjb25zdCByZXNvbHZlZEJ1Y2tldE5hbWUgPSBFbnZpcm9ubWVudC5idWNrZXROYW1lKGJ1Y2tldE5hbWUpO1xuXG5cdFx0Y29uc3QgbmFtZVBhcnRzID0gZmlsZU5hbWUuc3BsaXQoJy4nKTtcblx0XHRjb25zdCBmaWxlRXh0ZW5zaW9uID0gbmFtZVBhcnRzLnBvcCgpO1xuXG5cdFx0Ly8gZW5zdXJlIGl0J3MgdW5pcXVlXG5cdFx0ZmlsZU5hbWUgPSBgJHtmaWxlTmFtZVByZWZpeH0ke3RvU2x1ZyhuYW1lUGFydHMuam9pbignLicpKX0tJHtyYW5kb21VVUlEKCl9LiR7ZmlsZUV4dGVuc2lvbn1gO1xuXG5cdFx0aWYgKG1ldGFkYXRhICYmIGlzU3RyaW5nKG1ldGFkYXRhKSAmJiBpc0pzb25TdHJpbmcobWV0YWRhdGEpKSB7XG5cdFx0XHRtZXRhZGF0YSA9IEpTT04ucGFyc2UobWV0YWRhdGEpO1xuXHRcdH1cblxuXHRcdGNvbnN0IG9wdGlvbnMgPSB7XG5cdFx0XHRmaWxlTmFtZSxcblx0XHRcdG1ldGFkYXRhOiBtZXRhZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuXHRcdFx0ZXhwaXJlc0luLFxuXHRcdFx0YnVja2V0TmFtZTogcmVzb2x2ZWRCdWNrZXROYW1lLFxuXHRcdFx0Y29udGVudFR5cGUsXG5cdFx0XHRjdXN0b21Eb21haW46IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogRU5WX0tFWVMuRklMRVNfQlVDS0VUX0NVU1RPTV9ET01BSU5fRU5WX0tFWSwgZGVmYXVsdFZhbHVlOiAnJyB9KVxuXHRcdH07XG5cblx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZDo6YCwgb3B0aW9ucyk7XG5cblx0XHRjb25zdCBzaWduZWRVcGxvYWRVUkwgPSBhd2FpdCBnZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkKG9wdGlvbnMpO1xuXG5cdFx0Y29uc3QgcmVzcG9uc2U6IGFueSA9IHtcblx0XHRcdGZpbGVOYW1lLFxuXHRcdFx0ZXhwaXJlc0luLFxuXHRcdFx0Y29udGVudFR5cGUsXG5cdFx0XHRzaWduZWRVcGxvYWRVUkwsXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXNwb25zZVsgJ2J1Y2tldE5hbWUnIF0gPSByZXNvbHZlZEJ1Y2tldE5hbWU7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3BvbnNlKTtcblx0fVxuXG5cdEBHZXQoJy9kdXBsaWNhdGUve2lkfScpXG5cdGFzeW5jIGR1cGxpY2F0ZShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblx0XHRjb25zdCBzZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCk7XG5cblx0XHRjb25zdCBpZGVudGlmaWVycyA9IHNlcnZpY2UuZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKHJlcS5wYXRoUGFyYW1ldGVycykgYXMgRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTY2g+O1xuXG5cdFx0Y29uc3QgZHVwbGljYXRlRW50aXR5ID0gYXdhaXQgc2VydmljZS5kdXBsaWNhdGUoaWRlbnRpZmllcnMsIGN0eCk7XG5cblx0XHRjb25zdCByZXN1bHQ6IGFueSA9IHtcblx0XHRcdFsgY2FtZWxDYXNlKHRoaXMuZ2V0RW50aXR5TmFtZSgpKSBdOiBkdXBsaWNhdGVFbnRpdHksXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdFx0cmVzdWx0LmlkZW50aWZpZXJzID0gaWRlbnRpZmllcnM7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHQvKipcblx0ICogRmluZHMgYW4gZW50aXR5IGJ5IElELlxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICovXG5cdEBHZXQoJy97aWR9Jylcblx0YXN5bmMgZmluZChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgaWRlbnRpZmllcnMgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoKT8uZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKHJlcS5wYXRoUGFyYW1ldGVycyk7XG5cdFx0Y29uc3QgYXR0cmlidXRlcyA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnM/LmF0dHJpYnV0ZXM/LnNwbGl0Py4oJywnKTtcblxuXHRcdGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmdldCh7IGlkZW50aWZpZXJzLCBhdHRyaWJ1dGVzIH0sIGN0eCk7XG5cblx0XHRpZiAoIWVudGl0eSkge1xuXHRcdFx0dGhyb3cgbmV3IE5vdEZvdW5kRXJyb3IodGhpcy5nZXRFbnRpdHlOYW1lKCksIHVuZGVmaW5lZCwgcmVxKTtcblx0XHR9XG5cblx0XHRjb25zdCByZXN1bHQ6IGFueSA9IHtcblx0XHRcdFsgY2FtZWxDYXNlKHRoaXMuZ2V0RW50aXR5TmFtZSgpKSBdOiBlbnRpdHksXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdFx0cmVzdWx0LmlkZW50aWZpZXJzID0gaWRlbnRpZmllcnM7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHQvKipcblx0ICogTGlzdHMgZW50aXRpZXMuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QEdldCgnJylcblx0YXN5bmMgbGlzdChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgZGF0YSA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnM7XG5cdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGxpc3QgLSBkYXRhOmAsIGRhdGEpO1xuXG5cdFx0Y29uc3Qge1xuXHRcdFx0b3JkZXIsXG5cdFx0XHRjdXJzb3IsXG5cdFx0XHRjb3VudCxcblx0XHRcdGxpbWl0LFxuXHRcdFx0cGFnZXMsXG5cdFx0XHQuLi5yZXN0T2ZRdWVyeVBhcmFtc1xuXHRcdH0gPSBkYXRhIHx8IHt9O1xuXG5cdFx0Y29uc3QgeyBmaWx0ZXJzID0ge30sIGF0dHJpYnV0ZXMsIHNlYXJjaCwgc2VhcmNoQXR0cmlidXRlcywgLi4ucmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVycyB9ID0gcmVzdE9mUXVlcnlQYXJhbXM7XG5cblx0XHRsZXQgcGFyc2VkRmlsdGVycyA9IHt9O1xuXG5cdFx0aWYgKCFpc09iamVjdChmaWx0ZXJzKSkge1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZpbHRlcnMgaXMgbm90IGFuIG9iamVjdDogbmVlZCB0byBwYXJzZSB0aGUgZmlsdGVycyBxdWVyeSBzdHJpbmdgLCBmaWx0ZXJzKTtcblxuXHRcdFx0aWYgKGlzSnNvblN0cmluZyhmaWx0ZXJzKSkge1xuXHRcdFx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgZm91bmQgSlNPTiBzdHJpbmcgZmlsdGVycyBwYXJzaW5nYCwgZmlsdGVycyk7XG5cdFx0XHRcdHBhcnNlZEZpbHRlcnMgPSBKU09OLnBhcnNlKGZpbHRlcnMpO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Ly8gVE9ETzogcGFyc2UgZmlsdGVycyBxdWVyeSBzdHJpbmdcblx0XHRcdFx0dGhpcy5sb2dnZXIud2FybihgZmlsdGVycyBpcyBub3QgYW4gSlNPTjogbmVlZCB0byBwYXJzZSB0aGUgZmlsdGVycyBxdWVyeSBzdHJpbmdgLCBmaWx0ZXJzKTtcblx0XHRcdH1cblx0XHR9IGVsc2Uge1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZpbHRlcnMgaXMgYSBwYXJzZWQgb2JqZWN0YCwgZmlsdGVycyk7XG5cdFx0XHRwYXJzZWRGaWx0ZXJzID0gZmlsdGVycztcblx0XHR9XG5cblx0XHRpZiAocmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChyZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzKSkge1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZvdW5kIG5vdCBlbXB0eSByZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzOmAsIHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMpO1xuXG5cdFx0XHRjb25zdCBwYXJzZWRRdWVyeVBhcmFtcyA9IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzKHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMpO1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYHBhcnNlZCByZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzOmAsIHBhcnNlZFF1ZXJ5UGFyYW1zKTtcblxuXHRcdFx0Y29uc3QgcGFyc2VkUXVlcnlQYXJhbUZpbHRlcnMgPSBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAocGFyc2VkUXVlcnlQYXJhbXMpO1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZpbHRlcnMgZnJvbSByZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzOmAsIHBhcnNlZFF1ZXJ5UGFyYW1GaWx0ZXJzKTtcblxuXHRcdFx0cGFyc2VkRmlsdGVycyA9IG1lcmdlKFsgcGFyc2VkRmlsdGVycywgcGFyc2VkUXVlcnlQYXJhbUZpbHRlcnMgXSkgPz8ge307XG5cdFx0fVxuXG5cdFx0Y29uc3QgcGFnaW5hdGlvbiA9IHtcblx0XHRcdG9yZGVyOiBvcmRlciA/PyAnYXNjJyxcblx0XHRcdGN1cnNvcjogY3Vyc29yID8/IG51bGwsXG5cdFx0XHRjb3VudDogc2FmZVBhcnNlSW50KGNvdW50LCAxMikudmFsdWUsXG5cdFx0XHRsaW1pdDogc2FmZVBhcnNlSW50KGxpbWl0LCAyNTApLnZhbHVlLFxuXHRcdFx0cGFnZXM6IHBhZ2VzID09PSAnYWxsJyA/ICdhbGwnIGFzIGNvbnN0IDogc2FmZVBhcnNlSW50KHBhZ2VzLCAxKS52YWx1ZSxcblx0XHR9XG5cblx0XHR0aGlzLmxvZ2dlci5kZWJ1ZyhgcGFyc2VkIHBhZ2luYXRpb25gLCBwYWdpbmF0aW9uKTtcblxuXHRcdGNvbnN0IHF1ZXJ5ID0ge1xuXHRcdFx0ZmlsdGVyczogZGVlcENvcHkocGFyc2VkRmlsdGVycykgYXMgRW50aXR5RmlsdGVyQ3JpdGVyaWE8U2NoPixcblx0XHRcdGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXM/LnNwbGl0Py4oJywnKSxcblx0XHRcdHBhZ2luYXRpb24sXG5cdFx0XHRzZWFyY2gsXG5cdFx0XHRzZWFyY2hBdHRyaWJ1dGVzXG5cdFx0fTtcblxuXHRcdGNvbnN0IHsgZGF0YTogcmVjb3JkcywgY3Vyc29yOiBuZXdDdXJzb3IsIHF1ZXJ5OiBwYXJzZWRRdWVyeSB9ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkubGlzdChxdWVyeSwgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0Y3Vyc29yOiBuZXdDdXJzb3IsXG5cdFx0XHRpdGVtczogcmVjb3Jkcyxcblx0XHR9O1xuXG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3VsdC5yZXEgPSByZXE7XG5cdFx0XHRyZXN1bHQuY3JpdGVyaWEgPSB7XG5cdFx0XHRcdHBhZ2luYXRpb24sXG5cdFx0XHRcdGZpbHRlcnMsXG5cdFx0XHRcdHBhcnNlZEZpbHRlcnMsXG5cdFx0XHRcdHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMsXG5cdFx0XHRcdHBhcnNlZFF1ZXJ5XG5cdFx0XHR9O1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXN1bHQpO1xuXHR9XG5cblx0LyoqXG5cdCAqIFVwZGF0ZXMgYW4gZW50aXR5IGJ5IElELlxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICovXG5cdEBQYXRjaCgnL3tpZH0nKVxuXHRhc3luYyB1cGRhdGUocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IGlkZW50aWZpZXJzID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCk/LmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhyZXEucGF0aFBhcmFtZXRlcnMpO1xuXG5cdFx0Y29uc3QgZW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuZ2V0KHsgaWRlbnRpZmllcnMgfSwgY3R4KTtcblxuXHRcdGlmICghZW50aXR5KSB7XG5cdFx0XHR0aHJvdyBuZXcgTm90Rm91bmRFcnJvcih0aGlzLmdldEVudGl0eU5hbWUoKSwgdW5kZWZpbmVkLCByZXEpO1xuXHRcdH1cblxuXHRcdGNvbnN0IHVwZGF0ZWRFbnRpdHkgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS51cGRhdGUoaWRlbnRpZmllcnMgYXMgYW55LCByZXEuYm9keSwgdW5kZWZpbmVkLCBjdHgpO1xuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRbIGNhbWVsQ2FzZSh0aGlzLmdldEVudGl0eU5hbWUoKSkgXTogdXBkYXRlZEVudGl0eSxcblx0XHRcdG1lc3NhZ2U6IFwiVXBkYXRlZCBzdWNjZXNzZnVsbHlcIlxuXHRcdH07XG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3VsdC5yZXEgPSByZXE7XG5cdFx0XHRyZXN1bHQuaWRlbnRpZmllcnMgPSBpZGVudGlmaWVycztcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzdWx0KTtcblx0fVxuXG5cdC8qKlxuXHQgKiBEZWxldGVzIGFuIGVudGl0eSBieSBJRC5cblx0ICogQHBhcmFtIHtSZXF1ZXN0fSByZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG5cdCAqIEBwYXJhbSB7UmVzcG9uc2V9IHJlcyAtIFRoZSByZXNwb25zZSBvYmplY3QuXG5cdCAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3BvbnNlPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgcmVzcG9uc2UuXG5cdCAqL1xuXHRARGVsZXRlKCcve2lkfScpXG5cdGFzeW5jIGRlbGV0ZShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgaWRlbnRpZmllcnMgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoKT8uZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKHJlcS5wYXRoUGFyYW1ldGVycyk7XG5cdFx0Y29uc3QgZW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuZ2V0KHsgaWRlbnRpZmllcnMgfSwgY3R4KTtcblxuXHRcdGlmICghZW50aXR5KSB7XG5cdFx0XHR0aHJvdyBuZXcgTm90Rm91bmRFcnJvcih0aGlzLmdldEVudGl0eU5hbWUoKSwgdW5kZWZpbmVkLCByZXEpO1xuXHRcdH1cblxuXHRcdGNvbnN0IGRlbGV0ZWRFbnRpdHkgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5kZWxldGUoaWRlbnRpZmllcnMsIGN0eCk7XG5cblx0XHRjb25zdCByZXN1bHQ6IGFueSA9IHtcblx0XHRcdFsgY2FtZWxDYXNlKHRoaXMuZ2V0RW50aXR5TmFtZSgpKSBdOiBkZWxldGVkRW50aXR5LFxuXHRcdFx0bWVzc2FnZTogXCJEZWxldGVkIHN1Y2Nlc3NmdWxseVwiXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXN1bHQpO1xuXHR9XG5cblx0LyoqXG5cdCAqIEJVTEsgREVMRVRFIE9QRVJBVElPTlNcblx0ICogPT09PT09PT09PT09PT09PT09PT09PT1cblx0ICogXG5cdCAqIFRoZSBmb2xsb3dpbmcgbWV0aG9kcyBhcmUgY29tbWVudGVkIG91dCBieSBkZWZhdWx0IGFzIHRoZXkgYXJlIGRhbmdlcm91cyBvcGVyYXRpb25zXG5cdCAqIHRoYXQgY2FuIGRlbGV0ZSBtdWx0aXBsZSByZWNvcmRzIGF0IG9uY2UuIFRvIGVuYWJsZSB0aGVtIGluIHlvdXIgY29udHJvbGxlcjpcblx0ICogXG5cdCAqIDEuIFVuY29tbWVudCB0aGUgbWV0aG9kKHMpIHlvdSBuZWVkXG5cdCAqIDIuIEFkZCBhcHByb3ByaWF0ZSBhdXRob3JpemF0aW9uIGNoZWNrc1xuXHQgKiAzLiBDb25zaWRlciBhZGRpbmcgYWRkaXRpb25hbCBzYWZldHkgbWVhc3VyZXMgKGUuZy4sIGRyeS1ydW4gbW9kZSwgY29uZmlybWF0aW9uIHRva2Vucylcblx0ICogNC4gQWRkIGF1ZGl0IGxvZ2dpbmdcblx0ICogXG5cdCAqIEV4YW1wbGUgdXNhZ2UgaW4gYSBzcGVjaWZpYyBlbnRpdHkgY29udHJvbGxlcjpcblx0ICogXG5cdCAqIGBgYHR5cGVzY3JpcHRcblx0ICogZXhwb3J0IGNsYXNzIE15RW50aXR5Q29udHJvbGxlciBleHRlbmRzIEJhc2VFbnRpdHlDb250cm9sbGVyPE15RW50aXR5U2NoZW1hPiB7XG5cdCAqICAgICAvLyBVbmNvbW1lbnQgYW5kIGN1c3RvbWl6ZSB0aGUgYnVsayBkZWxldGUgbWV0aG9kcyBiZWxvd1xuXHQgKiB9XG5cdCAqIGBgYFxuXHQgKi9cblxuXHQvKipcblx0ICogQmF0Y2ggZGVsZXRlcyBtdWx0aXBsZSBlbnRpdGllcyBieSB0aGVpciBJRHMuXG5cdCAqIFxuXHQgKiDimqDvuI8gREFOR0VST1VTIE9QRVJBVElPTiAtIEVuYWJsZSBvbmx5IGluIHNwZWNpZmljIGNvbnRyb2xsZXJzIHdpdGggcHJvcGVyIGF1dGhvcml6YXRpb25cblx0ICogXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0IHdpdGggYm9keTogeyBpZHM6IEFycmF5PGlkZW50aWZpZXJzPiwgY29uY3VycmVudD86IG51bWJlciB9XG5cdCAqIEBwYXJhbSB7UmVzcG9uc2V9IHJlcyAtIFRoZSByZXNwb25zZSBvYmplY3QuXG5cdCAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3BvbnNlPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgcmVzcG9uc2UuXG5cdCAqIFxuXHQgKiBAZXhhbXBsZVxuXHQgKiAvLyBSZXF1ZXN0IGJvZHk6XG5cdCAqIHtcblx0ICogICBcImlkc1wiOiBbXG5cdCAqICAgICB7IFwiaWRcIjogXCJpdGVtMVwiIH0sXG5cdCAqICAgICB7IFwiaWRcIjogXCJpdGVtMlwiIH0sXG5cdCAqICAgICB7IFwiaWRcIjogXCJpdGVtM1wiIH1cblx0ICogICBdLFxuXHQgKiAgIFwiY29uY3VycmVudFwiOiAyXG5cdCAqIH1cblx0ICovXG5cdC8vIOKaoO+4jyBEQU5HRVJPVVMgT1BFUkFUSU9OXG5cdC8vICBAUG9zdCgnL2JhdGNoLWRlbGV0ZScpXG5cdGFzeW5jIGJhdGNoRGVsZXRlKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVzcG9uc2U+IHtcblx0XHRjb25zdCB7IGlkcyA9IFtdLCBjb25jdXJyZW50ID0gMSB9ID0gcmVxLmJvZHkgfHwge307XG5cblx0XHRjb25zdCBpZGVudGlmaWVycyA9IGlkcy5tYXAoKGlkOiBhbnkpID0+IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpPy5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpKTtcblxuXHRcdGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmJhdGNoRGVsZXRlKHtcblx0XHRcdGlkZW50aWZpZXJzLFxuXHRcdFx0Y29uY3VycmVudFxuXHRcdH0sIGN0eCk7XG5cblx0XHRjb25zdCB1bnByb2Nlc3NlZENvdW50ID0gKHJlc3VsdCBhcyBhbnkpPy51bnByb2Nlc3NlZD8ubGVuZ3RoIHx8IDA7XG5cblx0XHRjb25zdCBkZWxldGVkQ291bnQgPSBpZGVudGlmaWVycy5sZW5ndGggLSB1bnByb2Nlc3NlZENvdW50O1xuXG5cdFx0Y29uc3QgcmVzcG9uc2U6IGFueSA9IHtcblx0XHRcdGRlbGV0ZWRDb3VudCxcblx0XHRcdHVucHJvY2Vzc2VkQ291bnQ6IHVucHJvY2Vzc2VkQ291bnQsXG5cdFx0XHRtZXNzYWdlOiBgU3VjY2Vzc2Z1bGx5IGRlbGV0ZWQgJHtkZWxldGVkQ291bnR9ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IHJlY29yZChzKWBcblx0XHR9O1xuXG5cdFx0aWYgKHVucHJvY2Vzc2VkQ291bnQgPiAwKSB7XG5cdFx0XHRyZXNwb25zZS51bnByb2Nlc3NlZCA9IChyZXN1bHQgYXMgYW55KT8udW5wcm9jZXNzZWQgfHwgW107XG5cdFx0XHRyZXNwb25zZS5tZXNzYWdlICs9IGAsICR7dW5wcm9jZXNzZWRDb3VudH0gZmFpbGVkYDtcblx0XHR9XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzcG9uc2UucmVxID0gcmVxO1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXNwb25zZSk7XG5cdH1cblxuXHQvKipcblx0ICogRGVsZXRlcyBlbnRpdGllcyBiYXNlZCBvbiBmaWx0ZXIgY3JpdGVyaWEuXG5cdCAqIFxuXHQgKiDimqDvuI8gRVhUUkVNRUxZIERBTkdFUk9VUyBPUEVSQVRJT04gLSBFbmFibGUgb25seSBpbiBzcGVjaWZpYyBjb250cm9sbGVycyB3aXRoIHN0cmljdCBhdXRob3JpemF0aW9uXG5cdCAqIFxuXHQgKiBUaGlzIGVuZHBvaW50IHF1ZXJpZXMgZm9yIGVudGl0aWVzIG1hdGNoaW5nIHRoZSBmaWx0ZXJzIGFuZCBiYXRjaCBkZWxldGVzIHRoZW0uXG5cdCAqIEl0IGluY2x1ZGVzIHNhZmV0eSBtZWFzdXJlcyBsaWtlIHJlcXVpcmluZyBmaWx0ZXJzIGFuZCBvcHRpb25hbCBtYXhJdGVtcyBsaW1pdC5cblx0ICogXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0IHdpdGggYm9keSBjb250YWluaW5nIGZpbHRlcnMgYW5kIG9wdGlvbnNcblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICogXG5cdCAqIEBleGFtcGxlXG5cdCAqIC8vIFJlcXVlc3QgYm9keTpcblx0ICoge1xuXHQgKiAgIFwiZmlsdGVyc1wiOiB7XG5cdCAqICAgICBcInN0YXR1c1wiOiB7IFwiZXFcIjogXCJpbmFjdGl2ZVwiIH0sXG5cdCAqICAgICBcImxhc3RMb2dpbkF0XCI6IHsgXCJsdFwiOiBcIjIwMjMtMDEtMDFcIiB9XG5cdCAqICAgfSxcblx0ICogICBcImJhdGNoU2l6ZVwiOiA1MCxcblx0ICogICBcImNvbmN1cnJlbnRcIjogMixcblx0ICogICBcIm1heEl0ZW1zXCI6IDEwMDBcblx0ICogfVxuXHQgKi9cblx0Ly8g4pqg77iPIEVYVFJFTUVMWSBEQU5HRVJPVVMgT1BFUkFUSU9OXG5cdC8vIEBQb3N0KCcvZGVsZXRlLWJ5LXF1ZXJ5Jylcblx0YXN5bmMgZGVsZXRlQnlRdWVyeShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgeyBmaWx0ZXJzLCBiYXRjaFNpemUgPSAyNSwgY29uY3VycmVudCA9IDEsIG1heEl0ZW1zIH0gPSByZXEuYm9keSB8fCB7fTtcblxuXHRcdGNvbnN0IHsgZHJ5UnVuID0gZmFsc2UgfSA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnMgfHwge307XG5cblx0XHRpZiAoZHJ5UnVuKSB7XG5cdFx0XHRjb25zdCBwcmV2aWV3UmVzdWx0ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkucXVlcnkoe1xuXHRcdFx0XHRmaWx0ZXJzLFxuXHRcdFx0XHRwYWdpbmF0aW9uOiB7IGNvdW50OiAxMDAwLCBsaW1pdDogMTAwMCwgcGFnZXM6ICdhbGwnIH1cblx0XHRcdH0sXG5cdFx0XHRcdGN0eFxuXHRcdFx0KTtcblxuXHRcdFx0cmV0dXJuIHJlcy5qc29uKHtcblx0XHRcdFx0bWVzc2FnZTogJ0RyeSBydW4gbW9kZSAtIHByZXZpZXcgcmVzdWx0cyBbdXAgdG8gMTAwMCBpdGVtc10nLFxuXHRcdFx0XHRwcmV2aWV3Q291bnQ6IHByZXZpZXdSZXN1bHQuZGF0YS5sZW5ndGgsXG5cdFx0XHRcdHByZXZpZXc6IHByZXZpZXdSZXN1bHQuZGF0YVxuXHRcdFx0fSk7XG5cdFx0fVxuXG5cdFx0Y29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuZGVsZXRlQnlRdWVyeSh7XG5cdFx0XHRmaWx0ZXJzLFxuXHRcdFx0YmF0Y2hTaXplLFxuXHRcdFx0Y29uY3VycmVudCxcblx0XHRcdG1heEl0ZW1zXG5cdFx0fSwgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3BvbnNlOiBhbnkgPSB7XG5cdFx0XHQuLi5yZXN1bHQsXG5cdFx0XHRtZXNzYWdlOiBgU3VjY2Vzc2Z1bGx5IGRlbGV0ZWQgJHtyZXN1bHQuZGVsZXRlZENvdW50fSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSByZWNvcmQocylgXG5cdFx0fTtcblxuXHRcdGlmIChyZXN1bHQuZmFpbGVkQ291bnQgPiAwKSB7XG5cdFx0XHRyZXNwb25zZS5tZXNzYWdlICs9IGAsICR7cmVzdWx0LmZhaWxlZENvdW50fSBmYWlsZWRgO1xuXHRcdH1cblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXNwb25zZS5yZXEgPSByZXE7XG5cdFx0XHRyZXNwb25zZS5maWx0ZXJzID0gZmlsdGVycztcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzcG9uc2UpO1xuXHR9XG5cblx0LyoqXG5cdCAqIFBlcmZvcm1zIGEgY3VzdG9tIHF1ZXJ5IG9uIHRoZSBlbnRpdHkuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QFBvc3QoJy9xdWVyeScpXG5cdGFzeW5jIHF1ZXJ5KHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVzcG9uc2U+IHtcblx0XHRjb25zdCBxdWVyeSA9IHJlcS5ib2R5O1xuXHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBxdWVyeSAtIHF1ZXJ5OmAsIHF1ZXJ5KTtcblxuXHRcdGNvbnN0IGlucHV0UXVlcnkgPSBkZWVwQ29weShxdWVyeSk7XG5cblx0XHRjb25zdCB7IGRhdGE6IHJlY29yZHMsIGN1cnNvcjogbmV3Q3Vyc29yLCBxdWVyeTogcGFyc2VkUXVlcnkgfSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLnF1ZXJ5KHF1ZXJ5LCBjdHgpO1xuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRjdXJzb3I6IG5ld0N1cnNvcixcblx0XHRcdGl0ZW1zOiByZWNvcmRzLFxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHRcdHJlc3VsdC5jcml0ZXJpYSA9IHtcblx0XHRcdFx0aW5wdXRRdWVyeSxcblx0XHRcdFx0cGFyc2VkUXVlcnlcblx0XHRcdH07XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHRAUG9zdCgnL3NlYXJjaCcpXG5cdGFzeW5jIHNlYXJjaChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgcXVlcnkgPSByZXEuYm9keTtcblxuXHRcdGNvbnN0IGlucHV0UXVlcnkgPSBkZWVwQ29weShxdWVyeSkgYXMgRW50aXR5U2VhcmNoUXVlcnk8U2NoPjtcblxuXHRcdGNvbnN0IHJlc3VsdHMgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5zZWFyY2gocXVlcnksIGN0eCk7XG5cblx0XHRjb25zdCB7IGhpdHMsIC4uLnJlc3QgfSA9IHJlc3VsdHM7XG5cdFx0Y29uc3QgcmVzcG9uc2UgPSB7XG5cdFx0XHQuLi5yZXN0LFxuXHRcdFx0aXRlbXM6IGhpdHMsXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRPYmplY3QuYXNzaWduKHJlc3BvbnNlLCB7XG5cdFx0XHRcdGlucHV0UXVlcnksXG5cdFx0XHRcdHByb2Nlc3NpbmdUaW1lTXM6IHJlc3VsdHMucHJvY2Vzc2luZ1RpbWVNc1xuXHRcdFx0fSk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3BvbnNlKTtcblx0fVxuXG5cdEBHZXQoJy9zZWFyY2gnKVxuXHRhc3luYyBzZWFyY2hHZXQocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IHF1ZXJ5ID0gcGFyc2VTZWFyY2hRdWVyeShyZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzIHx8IHt9KTtcblx0XHRyZXR1cm4gYXdhaXQgdGhpcy5zZWFyY2goeyAuLi5yZXEsIGJvZHk6IHF1ZXJ5IH0sIHJlcywgY3R4KTtcblx0fVxuXG59Il19