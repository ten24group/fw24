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
            // Default to 'all' pages so a result spanning multiple DynamoDB pages
            // isn't silently truncated. The `count` default above still bounds the
            // response size, so this only matters once a caller raises/removes `count`.
            // An explicit numeric `pages` is still honoured.
            pages: (pages == null || pages === 'all') ? 'all' : (0, parse_1.safeParseInt)(pages, 1).value,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1lbnRpdHktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvYmFzZS1lbnRpdHktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFLQSxtQ0FBb0M7QUFDcEMscUNBQXlEO0FBQ3pELHlDQUE2QztBQUM3QyxvQ0FBb0M7QUFDcEMsbUZBQXVFO0FBRXZFLGlEQUFnRTtBQUNoRSxzQ0FBMEM7QUFDMUMsaURBQXdEO0FBQ3hELHNDQUFnRTtBQUNoRSxvQ0FBbUk7QUFDbkksMENBQThDO0FBQzlDLG1DQUF3RjtBQWF4Rjs7O0dBR0c7QUFDSCxNQUFhLG9CQUE4RCxTQUFRLHNDQUFhO0lBU2hFO0lBUHZCLFVBQVUsQ0FBUztJQUUzQjs7OztPQUlHO0lBQ0gsWUFBK0IsYUFBcUMsRUFBRSxVQUFVLEdBQUcsYUFBYSxFQUFFLGFBQWEsRUFBRTtRQUNoSCxLQUFLLEVBQUUsQ0FBQztRQURzQixrQkFBYSxHQUFiLGFBQWEsQ0FBd0I7UUFFbkUsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUM7UUFFN0IsbURBQW1EO1FBQ25ELE1BQU0sbUJBQW1CLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLENBSXRELENBQUM7UUFFZCxJQUFJLG1CQUFtQixFQUFFLENBQUM7WUFDekIsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFBLDZCQUFrQixFQUFDO2dCQUN0QyxZQUFZLEVBQUUsbUJBQW1CLENBQUMsWUFBWTtnQkFDOUMsU0FBUyxFQUFFLG1CQUFtQixDQUFDLFNBQVM7Z0JBQ3hDLGlCQUFpQixFQUFFLG1CQUFtQixDQUFDLGlCQUFpQjthQUN4RCxDQUFDLENBQUM7UUFDSixDQUFDO0lBQ0YsQ0FBQztJQUVTLGFBQWE7UUFDdEIsT0FBTyxJQUFJLENBQUMsVUFBVSxJQUFJLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLGFBQWEsRUFBRSxD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QUFDO3FEQUlkIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBSZXF1ZXN0LCBSZXNwb25zZSB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hLCBFbnRpdHlTY2hlbWEgfSBmcm9tICcuL2Jhc2UtZW50aXR5JztcbmltcG9ydCB0eXBlIHsgQmFzZUVudGl0eVNlcnZpY2UgfSBmcm9tICcuL2Jhc2Utc2VydmljZSc7XG5pbXBvcnQgdHlwZSB7IEVudGl0eUZpbHRlckNyaXRlcmlhIH0gZnJvbSAnLi9xdWVyeS10eXBlcyc7XG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZCB9IGZyb20gJy4uL2NsaWVudC9zMyc7XG5pbXBvcnQgeyBFbnZpcm9ubWVudCB9IGZyb20gJy4uL2NsaWVudC91dGlsJztcbmltcG9ydCB7IEVOVl9LRVlTIH0gZnJvbSAnLi4vY29uc3QnO1xuaW1wb3J0IHsgQVBJQ29udHJvbGxlciB9IGZyb20gJy4uL2NvcmUvcnVudGltZS9hcGktZ2F0ZXdheS1jb250cm9sbGVyJztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IERlbGV0ZSwgR2V0LCBQYXRjaCwgUG9zdCB9IGZyb20gJy4uL2RlY29yYXRvcnMvbWV0aG9kJztcbmltcG9ydCB7IE5vdEZvdW5kRXJyb3IgfSBmcm9tICcuLi9lcnJvcnMnO1xuaW1wb3J0IHsgY3JlYXRlRXJyb3JIYW5kbGVyIH0gZnJvbSAnLi4vZXJyb3JzL2hhbmRsZXJzJztcbmltcG9ydCB7IEVudGl0eVNlYXJjaFF1ZXJ5LCBwYXJzZVNlYXJjaFF1ZXJ5IH0gZnJvbSAnLi4vc2VhcmNoJztcbmltcG9ydCB7IGNhbWVsQ2FzZSwgZGVlcENvcHksIGlzRW1wdHlPYmplY3QsIGlzSnNvblN0cmluZywgaXNPYmplY3QsIGlzU3RyaW5nLCBtZXJnZSwgcmVzb2x2ZUVudlZhbHVlRm9yLCB0b1NsdWcgfSBmcm9tICcuLi91dGlscyc7XG5pbXBvcnQgeyBzYWZlUGFyc2VJbnQgfSBmcm9tICcuLi91dGlscy9wYXJzZSc7XG5pbXBvcnQgeyBwYXJzZVVybFF1ZXJ5U3RyaW5nUGFyYW1ldGVycywgcXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwIH0gZnJvbSAnLi9xdWVyeSc7XG5cbnR5cGUgc2Vjb25kcyA9IG51bWJlcjtcblxuZXhwb3J0IHR5cGUgR2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZFNjaGVtYSA9IHtcblx0ZmlsZU5hbWU6IHN0cmluZyxcblx0YnVja2V0TmFtZTogc3RyaW5nLFxuXHRleHBpcmVzSW4/OiBzZWNvbmRzLCAvLyBkZWZhdWx0IHRvIDE1KjYwIHNlY29uZHNcblx0ZmlsZU5hbWVQcmVmaXg/OiBzdHJpbmcsXG5cdGNvbnRlbnRUeXBlPzogc3RyaW5nIC8vIGRlZmF1bHQgdG8gKi8qXG5cdG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHN0cmluZ1xufTtcblxuLyoqXG4gKiBBYnN0cmFjdCBiYXNlIGNsYXNzIGZvciBlbnRpdHkgY29udHJvbGxlcnMuXG4gKiBAdGVtcGxhdGUgU2NoIC0gVGhlIGVudGl0eSBzY2hlbWEgdHlwZS5cbiAqL1xuZXhwb3J0IGNsYXNzIEJhc2VFbnRpdHlDb250cm9sbGVyPFNjaCBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcblxuXHRwcml2YXRlIGVudGl0eU5hbWU6IHN0cmluZztcblxuXHQvKipcblx0ICogQ3JlYXRlcyBhbiBpbnN0YW5jZSBvZiBCYXNlRW50aXR5Q29udHJvbGxlci5cblx0ICogQHBhcmFtIHtCYXNlRW50aXR5U2VydmljZTxTY2g+fSBlbnRpdHlTZXJ2aWNlIC0gVGhlIGVudGl0eS1zZXJ2aWNlLlxuXHQgKiBAcGFyYW0ge3N0cmluZ30gZW50aXR5TmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBlbnRpdHkuXG5cdCAqL1xuXHRjb25zdHJ1Y3Rvcihwcm90ZWN0ZWQgcmVhZG9ubHkgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8U2NoPiwgZW50aXR5TmFtZSA9IGVudGl0eVNlcnZpY2U/LmdldEVudGl0eU5hbWUoKSkge1xuXHRcdHN1cGVyKCk7XG5cdFx0dGhpcy5lbnRpdHlOYW1lID0gZW50aXR5TmFtZTtcblxuXHRcdC8vIFNldCBlcnJvciBoYW5kbGVyIG9wdGlvbnMgZnJvbSBjb250cm9sbGVyIGNvbmZpZ1xuXHRcdGNvbnN0IGVycm9ySGFuZGxlck9wdGlvbnMgPSBSZWZsZWN0LmdldCh0aGlzLCAnZXJyb3JIYW5kbGVyT3B0aW9ucycpIGFzIHtcblx0XHRcdGluY2x1ZGVTdGFjaz86IGJvb2xlYW47XG5cdFx0XHRsb2dFcnJvcnM/OiBib29sZWFuO1xuXHRcdFx0bG9nUmVxdWVzdERldGFpbHM/OiBib29sZWFuO1xuXHRcdH0gfCB1bmRlZmluZWQ7XG5cblx0XHRpZiAoZXJyb3JIYW5kbGVyT3B0aW9ucykge1xuXHRcdFx0dGhpcy5lcnJvckhhbmRsZXIgPSBjcmVhdGVFcnJvckhhbmRsZXIoe1xuXHRcdFx0XHRpbmNsdWRlU3RhY2s6IGVycm9ySGFuZGxlck9wdGlvbnMuaW5jbHVkZVN0YWNrLFxuXHRcdFx0XHRsb2dFcnJvcnM6IGVycm9ySGFuZGxlck9wdGlvbnMubG9nRXJyb3JzLFxuXHRcdFx0XHRsb2dSZXF1ZXN0RGV0YWlsczogZXJyb3JIYW5kbGVyT3B0aW9ucy5sb2dSZXF1ZXN0RGV0YWlsc1xuXHRcdFx0fSk7XG5cdFx0fVxuXHR9XG5cblx0cHJvdGVjdGVkIGdldEVudGl0eU5hbWUoKSB7XG5cdFx0cmV0dXJuIHRoaXMuZW50aXR5TmFtZSB8fCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKT8uZ2V0RW50aXR5TmFtZSgpO1xuXHR9XG5cblx0LyoqXG5cdCAqIEluaXRpYWxpemVzIHRoZSBlbnRpdHkgY29udHJvbGxlci5cblx0ICogTm90ZTogSXQncyBub3QgYW4gaWRlYWwgcGxhY2UgdG8gaW5pdGlhbGl6ZSB0aGUgYXBwIHN0YXRlL0RJL3JvdXRlcywgYW5kIHNob3VsZCBiZSByZWZhY3RvcmVkIHRvIGFuIGlkZWFsIGNvbXBvbmVudC5cblx0ICogQHBhcmFtIHthbnl9IGV2ZW50IC0gVGhlIGV2ZW50IG9iamVjdC5cblx0ICogQHBhcmFtIHthbnl9IGNvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QuXG5cdCAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHRoZSBpbml0aWFsaXphdGlvbiBpcyBjb21wbGV0ZS5cblx0ICovXG5cdGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBhbnksIF9jb250ZXh0OiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcblx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgQmFzZUVudGl0eUNvbnRyb2xsZXIuaW5pdGlhbGl6ZSAtIGRvbmU6ICR7ZXZlbnR9ICR7Y29udGV4dH1gKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBHZXRzIHRoZSBlbnRpdHkgc2VydmljZSBmb3IgdGhlIGNvbnRyb2xsZXIuXG5cdCAqIEB0ZW1wbGF0ZSBTIC0gVGhlIHR5cGUgb2YgdGhlIGVudGl0eSBzZXJ2aWNlLlxuXHQgKiBAcmV0dXJucyB7U30gVGhlIGVudGl0eSBzZXJ2aWNlLlxuXHQgKi9cblx0cHVibGljIGdldEVudGl0eVNlcnZpY2U8UyBleHRlbmRzIEJhc2VFbnRpdHlTZXJ2aWNlPFNjaD4+KCk6IFMge1xuXHRcdHJldHVybiB0aGlzLmVudGl0eVNlcnZpY2UgYXMgUztcblx0fVxuXG5cdC8qKlxuXHQgKiBDcmVhdGVzIGEgbmV3IGVudGl0eS5cblx0ICogVG9wLWxldmVsIGBudWxsYCBpbiB0aGUgYm9keSBvbWl0cyBvcHRpb25hbCBhdHRyaWJ1dGVzIG9uIHRoZSBuZXcgaXRlbSAobm90IHN0b3JlZCBhcyBudWxsKS5cblx0ICogQHBhcmFtIHtSZXF1ZXN0fSByZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG5cdCAqIEBwYXJhbSB7UmVzcG9uc2V9IHJlcyAtIFRoZSByZXNwb25zZSBvYmplY3QuXG5cdCAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3BvbnNlPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgcmVzcG9uc2UuXG5cdCAqL1xuXHRAUG9zdCgnJylcblx0YXN5bmMgY3JlYXRlKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVzcG9uc2U+IHtcblx0XHRjb25zdCBjcmVhdGVkRW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuY3JlYXRlKHJlcS5ib2R5LCBjdHgpO1xuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRbIGNhbWVsQ2FzZSh0aGlzLmdldEVudGl0eU5hbWUoKSkgXTogY3JlYXRlZEVudGl0eSxcblx0XHRcdG1lc3NhZ2U6IFwiQ3JlYXRlZCBzdWNjZXNzZnVsbHlcIlxuXHRcdH07XG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3VsdC5yZXEgPSByZXE7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHRAR2V0KCcvZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZCcsIHtcblx0XHR2YWxpZGF0aW9uczoge1xuXHRcdFx0ZmlsZU5hbWU6IHtcblx0XHRcdFx0cmVxdWlyZWQ6IHRydWUsXG5cdFx0XHRcdGRhdGF0eXBlOiAnc3RyaW5nJyxcblx0XHRcdH0sXG5cdFx0XHRidWNrZXROYW1lOiB7XG5cdFx0XHRcdHJlcXVpcmVkOiB0cnVlLFxuXHRcdFx0XHRkYXRhdHlwZTogJ3N0cmluZycsXG5cdFx0XHR9LFxuXHRcdH1cblx0fSlcblx0YXN5bmMgZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIF9jdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cblx0XHRsZXQgeyBidWNrZXROYW1lLCBmaWxlTmFtZSwgZXhwaXJlc0luID0gMTUgKiA2MCwgZmlsZU5hbWVQcmVmaXggPSBcIlwiLCBjb250ZW50VHlwZSA9IFwiKi8qXCIsIG1ldGFkYXRhIH0gPSByZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzIGFzIEdldFNpZ25lZFVybEZvckZpbGVVcGxvYWRTY2hlbWEgPz8ge307XG5cblx0XHQvLyB0cnkgcmVzb2x2aW5nIGFjdHVhbCBidWNrZXQgbmFtZSBmcm9tIHNpbXBsZSBuYW1lIGxpa2UgXCJmaWxlcy1idWNrZXRcIiB0byBcImZpbGVzLWJ1Y2tldC0xMjNcIlx0XG5cdFx0Ly8gaWYgbm90IGZvdW5kLCB1c2UgdGhlIHByb3ZpZGVkIGJ1Y2tldCBuYW1lIGRpcmVjdGx5XG5cdFx0Y29uc3QgcmVzb2x2ZWRCdWNrZXROYW1lID0gRW52aXJvbm1lbnQuYnVja2V0TmFtZShidWNrZXROYW1lKTtcblxuXHRcdGNvbnN0IG5hbWVQYXJ0cyA9IGZpbGVOYW1lLnNwbGl0KCcuJyk7XG5cdFx0Y29uc3QgZmlsZUV4dGVuc2lvbiA9IG5hbWVQYXJ0cy5wb3AoKTtcblxuXHRcdC8vIGVuc3VyZSBpdCdzIHVuaXF1ZVxuXHRcdGZpbGVOYW1lID0gYCR7ZmlsZU5hbWVQcmVmaXh9JHt0b1NsdWcobmFtZVBhcnRzLmpvaW4oJy4nKSl9LSR7cmFuZG9tVVVJRCgpfS4ke2ZpbGVFeHRlbnNpb259YDtcblxuXHRcdGlmIChtZXRhZGF0YSAmJiBpc1N0cmluZyhtZXRhZGF0YSkgJiYgaXNKc29uU3RyaW5nKG1ldGFkYXRhKSkge1xuXHRcdFx0bWV0YWRhdGEgPSBKU09OLnBhcnNlKG1ldGFkYXRhKTtcblx0XHR9XG5cblx0XHRjb25zdCBvcHRpb25zID0ge1xuXHRcdFx0ZmlsZU5hbWUsXG5cdFx0XHRtZXRhZGF0YTogbWV0YWRhdGEgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPixcblx0XHRcdGV4cGlyZXNJbixcblx0XHRcdGJ1Y2tldE5hbWU6IHJlc29sdmVkQnVja2V0TmFtZSxcblx0XHRcdGNvbnRlbnRUeXBlLFxuXHRcdFx0Y3VzdG9tRG9tYWluOiByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IEVOVl9LRVlTLkZJTEVTX0JVQ0tFVF9DVVNUT01fRE9NQUlOX0VOVl9LRVksIGRlZmF1bHRWYWx1ZTogJycgfSlcblx0XHR9O1xuXG5cdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGdldFNpZ25lZFVybEZvckZpbGVVcGxvYWQ6OmAsIG9wdGlvbnMpO1xuXG5cdFx0Y29uc3Qgc2lnbmVkVXBsb2FkVVJMID0gYXdhaXQgZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZChvcHRpb25zKTtcblxuXHRcdGNvbnN0IHJlc3BvbnNlOiBhbnkgPSB7XG5cdFx0XHRmaWxlTmFtZSxcblx0XHRcdGV4cGlyZXNJbixcblx0XHRcdGNvbnRlbnRUeXBlLFxuXHRcdFx0c2lnbmVkVXBsb2FkVVJMLFxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzcG9uc2VbICdidWNrZXROYW1lJyBdID0gcmVzb2x2ZWRCdWNrZXROYW1lO1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXNwb25zZSk7XG5cdH1cblxuXHRAR2V0KCcvZHVwbGljYXRlL3tpZH0nKVxuXHRhc3luYyBkdXBsaWNhdGUocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG5cdFx0Y29uc3Qgc2VydmljZSA9IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpO1xuXG5cdFx0Y29uc3QgaWRlbnRpZmllcnMgPSBzZXJ2aWNlLmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhyZXEucGF0aFBhcmFtZXRlcnMpIGFzIEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWE8U2NoPjtcblxuXHRcdGNvbnN0IGR1cGxpY2F0ZUVudGl0eSA9IGF3YWl0IHNlcnZpY2UuZHVwbGljYXRlKGlkZW50aWZpZXJzLCBjdHgpO1xuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRbIGNhbWVsQ2FzZSh0aGlzLmdldEVudGl0eU5hbWUoKSkgXTogZHVwbGljYXRlRW50aXR5LFxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHRcdHJlc3VsdC5pZGVudGlmaWVycyA9IGlkZW50aWZpZXJzO1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXN1bHQpO1xuXHR9XG5cblx0LyoqXG5cdCAqIEZpbmRzIGFuIGVudGl0eSBieSBJRC5cblx0ICogQHBhcmFtIHtSZXF1ZXN0fSByZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG5cdCAqIEBwYXJhbSB7UmVzcG9uc2V9IHJlcyAtIFRoZSByZXNwb25zZSBvYmplY3QuXG5cdCAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3BvbnNlPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgcmVzcG9uc2UuXG5cdCAqL1xuXHRAR2V0KCcve2lkfScpXG5cdGFzeW5jIGZpbmQocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IGlkZW50aWZpZXJzID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCk/LmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhyZXEucGF0aFBhcmFtZXRlcnMpO1xuXHRcdGNvbnN0IGF0dHJpYnV0ZXMgPSByZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzPy5hdHRyaWJ1dGVzPy5zcGxpdD8uKCcsJyk7XG5cblx0XHRjb25zdCBlbnRpdHkgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5nZXQoeyBpZGVudGlmaWVycywgYXR0cmlidXRlcyB9LCBjdHgpO1xuXG5cdFx0aWYgKCFlbnRpdHkpIHtcblx0XHRcdHRocm93IG5ldyBOb3RGb3VuZEVycm9yKHRoaXMuZ2V0RW50aXR5TmFtZSgpLCB1bmRlZmluZWQsIHJlcSk7XG5cdFx0fVxuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRbIGNhbWVsQ2FzZSh0aGlzLmdldEVudGl0eU5hbWUoKSkgXTogZW50aXR5LFxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHRcdHJlc3VsdC5pZGVudGlmaWVycyA9IGlkZW50aWZpZXJzO1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXN1bHQpO1xuXHR9XG5cblx0LyoqXG5cdCAqIExpc3RzIGVudGl0aWVzLlxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICovXG5cdEBHZXQoJycpXG5cdGFzeW5jIGxpc3QocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IGRhdGEgPSByZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzO1xuXHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBsaXN0IC0gZGF0YTpgLCBkYXRhKTtcblxuXHRcdGNvbnN0IHtcblx0XHRcdG9yZGVyLFxuXHRcdFx0Y3Vyc29yLFxuXHRcdFx0Y291bnQsXG5cdFx0XHRsaW1pdCxcblx0XHRcdHBhZ2VzLFxuXHRcdFx0Li4ucmVzdE9mUXVlcnlQYXJhbXNcblx0XHR9ID0gZGF0YSB8fCB7fTtcblxuXHRcdGNvbnN0IHsgZmlsdGVycyA9IHt9LCBhdHRyaWJ1dGVzLCBzZWFyY2gsIHNlYXJjaEF0dHJpYnV0ZXMsIC4uLnJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMgfSA9IHJlc3RPZlF1ZXJ5UGFyYW1zO1xuXG5cdFx0bGV0IHBhcnNlZEZpbHRlcnMgPSB7fTtcblxuXHRcdGlmICghaXNPYmplY3QoZmlsdGVycykpIHtcblx0XHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBmaWx0ZXJzIGlzIG5vdCBhbiBvYmplY3Q6IG5lZWQgdG8gcGFyc2UgdGhlIGZpbHRlcnMgcXVlcnkgc3RyaW5nYCwgZmlsdGVycyk7XG5cblx0XHRcdGlmIChpc0pzb25TdHJpbmcoZmlsdGVycykpIHtcblx0XHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZvdW5kIEpTT04gc3RyaW5nIGZpbHRlcnMgcGFyc2luZ2AsIGZpbHRlcnMpO1xuXHRcdFx0XHRwYXJzZWRGaWx0ZXJzID0gSlNPTi5wYXJzZShmaWx0ZXJzKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdC8vIFRPRE86IHBhcnNlIGZpbHRlcnMgcXVlcnkgc3RyaW5nXG5cdFx0XHRcdHRoaXMubG9nZ2VyLndhcm4oYGZpbHRlcnMgaXMgbm90IGFuIEpTT046IG5lZWQgdG8gcGFyc2UgdGhlIGZpbHRlcnMgcXVlcnkgc3RyaW5nYCwgZmlsdGVycyk7XG5cdFx0XHR9XG5cdFx0fSBlbHNlIHtcblx0XHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBmaWx0ZXJzIGlzIGEgcGFyc2VkIG9iamVjdGAsIGZpbHRlcnMpO1xuXHRcdFx0cGFyc2VkRmlsdGVycyA9IGZpbHRlcnM7XG5cdFx0fVxuXG5cdFx0aWYgKHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMgJiYgIWlzRW1wdHlPYmplY3QocmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVycykpIHtcblx0XHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBmb3VuZCBub3QgZW1wdHkgcmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVyczpgLCByZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzKTtcblxuXHRcdFx0Y29uc3QgcGFyc2VkUXVlcnlQYXJhbXMgPSBwYXJzZVVybFF1ZXJ5U3RyaW5nUGFyYW1ldGVycyhyZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzKTtcblx0XHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBwYXJzZWQgcmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVyczpgLCBwYXJzZWRRdWVyeVBhcmFtcyk7XG5cblx0XHRcdGNvbnN0IHBhcnNlZFF1ZXJ5UGFyYW1GaWx0ZXJzID0gcXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwKHBhcnNlZFF1ZXJ5UGFyYW1zKTtcblx0XHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBmaWx0ZXJzIGZyb20gcmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVyczpgLCBwYXJzZWRRdWVyeVBhcmFtRmlsdGVycyk7XG5cblx0XHRcdHBhcnNlZEZpbHRlcnMgPSBtZXJnZShbIHBhcnNlZEZpbHRlcnMsIHBhcnNlZFF1ZXJ5UGFyYW1GaWx0ZXJzIF0pID8/IHt9O1xuXHRcdH1cblxuXHRcdGNvbnN0IHBhZ2luYXRpb24gPSB7XG5cdFx0XHRvcmRlcjogb3JkZXIgPz8gJ2FzYycsXG5cdFx0XHRjdXJzb3I6IGN1cnNvciA/PyBudWxsLFxuXHRcdFx0Y291bnQ6IHNhZmVQYXJzZUludChjb3VudCwgMTIpLnZhbHVlLFxuXHRcdFx0bGltaXQ6IHNhZmVQYXJzZUludChsaW1pdCwgMjUwKS52YWx1ZSxcblx0XHRcdC8vIERlZmF1bHQgdG8gJ2FsbCcgcGFnZXMgc28gYSByZXN1bHQgc3Bhbm5pbmcgbXVsdGlwbGUgRHluYW1vREIgcGFnZXNcblx0XHRcdC8vIGlzbid0IHNpbGVudGx5IHRydW5jYXRlZC4gVGhlIGBjb3VudGAgZGVmYXVsdCBhYm92ZSBzdGlsbCBib3VuZHMgdGhlXG5cdFx0XHQvLyByZXNwb25zZSBzaXplLCBzbyB0aGlzIG9ubHkgbWF0dGVycyBvbmNlIGEgY2FsbGVyIHJhaXNlcy9yZW1vdmVzIGBjb3VudGAuXG5cdFx0XHQvLyBBbiBleHBsaWNpdCBudW1lcmljIGBwYWdlc2AgaXMgc3RpbGwgaG9ub3VyZWQuXG5cdFx0XHRwYWdlczogKHBhZ2VzID09IG51bGwgfHwgcGFnZXMgPT09ICdhbGwnKSA/ICdhbGwnIGFzIGNvbnN0IDogc2FmZVBhcnNlSW50KHBhZ2VzLCAxKS52YWx1ZSxcblx0XHR9XG5cblx0XHR0aGlzLmxvZ2dlci5kZWJ1ZyhgcGFyc2VkIHBhZ2luYXRpb25gLCBwYWdpbmF0aW9uKTtcblxuXHRcdGNvbnN0IHF1ZXJ5ID0ge1xuXHRcdFx0ZmlsdGVyczogZGVlcENvcHkocGFyc2VkRmlsdGVycykgYXMgRW50aXR5RmlsdGVyQ3JpdGVyaWE8U2NoPixcblx0XHRcdGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXM/LnNwbGl0Py4oJywnKSxcblx0XHRcdHBhZ2luYXRpb24sXG5cdFx0XHRzZWFyY2gsXG5cdFx0XHRzZWFyY2hBdHRyaWJ1dGVzXG5cdFx0fTtcblxuXHRcdGNvbnN0IHsgZGF0YTogcmVjb3JkcywgY3Vyc29yOiBuZXdDdXJzb3IsIHF1ZXJ5OiBwYXJzZWRRdWVyeSB9ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkubGlzdChxdWVyeSwgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0Y3Vyc29yOiBuZXdDdXJzb3IsXG5cdFx0XHRpdGVtczogcmVjb3Jkcyxcblx0XHR9O1xuXG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3VsdC5yZXEgPSByZXE7XG5cdFx0XHRyZXN1bHQuY3JpdGVyaWEgPSB7XG5cdFx0XHRcdHBhZ2luYXRpb24sXG5cdFx0XHRcdGZpbHRlcnMsXG5cdFx0XHRcdHBhcnNlZEZpbHRlcnMsXG5cdFx0XHRcdHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMsXG5cdFx0XHRcdHBhcnNlZFF1ZXJ5XG5cdFx0XHR9O1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXN1bHQpO1xuXHR9XG5cblx0LyoqXG5cdCAqIFVwZGF0ZXMgYW4gZW50aXR5IGJ5IElELlxuXHQgKiBSZXF1ZXN0IGJvZHkgdXNlcyBKU09OIE1lcmdlIFBhdGNoIHNlbWFudGljcyBmb3IgdG9wLWxldmVsIGtleXM6IGBudWxsYCBjbGVhcnMgYW4gb3B0aW9uYWwgYXR0cmlidXRlXG5cdCAqIChEeW5hbW9EQiBSRU1PVkUpLCByYXRoZXIgdGhhbiBzdG9yaW5nIG51bGwgKEVsZWN0cm9EQiByZWplY3RzIG51bGwgZm9yIG1vc3Qgc2NhbGFyIHR5cGVzKS5cblx0ICogQHBhcmFtIHtSZXF1ZXN0fSByZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG5cdCAqIEBwYXJhbSB7UmVzcG9uc2V9IHJlcyAtIFRoZSByZXNwb25zZSBvYmplY3QuXG5cdCAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3BvbnNlPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgcmVzcG9uc2UuXG5cdCAqL1xuXHRAUGF0Y2goJy97aWR9Jylcblx0YXN5bmMgdXBkYXRlKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVzcG9uc2U+IHtcblx0XHRjb25zdCBpZGVudGlmaWVycyA9IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpPy5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMocmVxLnBhdGhQYXJhbWV0ZXJzKTtcblxuXHRcdGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmdldCh7IGlkZW50aWZpZXJzIH0sIGN0eCk7XG5cblx0XHRpZiAoIWVudGl0eSkge1xuXHRcdFx0dGhyb3cgbmV3IE5vdEZvdW5kRXJyb3IodGhpcy5nZXRFbnRpdHlOYW1lKCksIHVuZGVmaW5lZCwgcmVxKTtcblx0XHR9XG5cblx0XHRjb25zdCB1cGRhdGVkRW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkudXBkYXRlKGlkZW50aWZpZXJzIGFzIGFueSwgcmVxLmJvZHksIHVuZGVmaW5lZCwgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0WyBjYW1lbENhc2UodGhpcy5nZXRFbnRpdHlOYW1lKCkpIF06IHVwZGF0ZWRFbnRpdHksXG5cdFx0XHRtZXNzYWdlOiBcIlVwZGF0ZWQgc3VjY2Vzc2Z1bGx5XCJcblx0XHR9O1xuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdFx0cmVzdWx0LmlkZW50aWZpZXJzID0gaWRlbnRpZmllcnM7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHQvKipcblx0ICogRGVsZXRlcyBhbiBlbnRpdHkgYnkgSUQuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QERlbGV0ZSgnL3tpZH0nKVxuXHRhc3luYyBkZWxldGUocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IGlkZW50aWZpZXJzID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCk/LmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhyZXEucGF0aFBhcmFtZXRlcnMpO1xuXHRcdGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmdldCh7IGlkZW50aWZpZXJzIH0sIGN0eCk7XG5cblx0XHRpZiAoIWVudGl0eSkge1xuXHRcdFx0dGhyb3cgbmV3IE5vdEZvdW5kRXJyb3IodGhpcy5nZXRFbnRpdHlOYW1lKCksIHVuZGVmaW5lZCwgcmVxKTtcblx0XHR9XG5cblx0XHRjb25zdCBkZWxldGVkRW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuZGVsZXRlKGlkZW50aWZpZXJzLCBjdHgpO1xuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRbIGNhbWVsQ2FzZSh0aGlzLmdldEVudGl0eU5hbWUoKSkgXTogZGVsZXRlZEVudGl0eSxcblx0XHRcdG1lc3NhZ2U6IFwiRGVsZXRlZCBzdWNjZXNzZnVsbHlcIlxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzdWx0KTtcblx0fVxuXG5cdC8qKlxuXHQgKiBCVUxLIERFTEVURSBPUEVSQVRJT05TXG5cdCAqID09PT09PT09PT09PT09PT09PT09PT09XG5cdCAqIFxuXHQgKiBUaGUgZm9sbG93aW5nIG1ldGhvZHMgYXJlIGNvbW1lbnRlZCBvdXQgYnkgZGVmYXVsdCBhcyB0aGV5IGFyZSBkYW5nZXJvdXMgb3BlcmF0aW9uc1xuXHQgKiB0aGF0IGNhbiBkZWxldGUgbXVsdGlwbGUgcmVjb3JkcyBhdCBvbmNlLiBUbyBlbmFibGUgdGhlbSBpbiB5b3VyIGNvbnRyb2xsZXI6XG5cdCAqIFxuXHQgKiAxLiBVbmNvbW1lbnQgdGhlIG1ldGhvZChzKSB5b3UgbmVlZFxuXHQgKiAyLiBBZGQgYXBwcm9wcmlhdGUgYXV0aG9yaXphdGlvbiBjaGVja3Ncblx0ICogMy4gQ29uc2lkZXIgYWRkaW5nIGFkZGl0aW9uYWwgc2FmZXR5IG1lYXN1cmVzIChlLmcuLCBkcnktcnVuIG1vZGUsIGNvbmZpcm1hdGlvbiB0b2tlbnMpXG5cdCAqIDQuIEFkZCBhdWRpdCBsb2dnaW5nXG5cdCAqIFxuXHQgKiBFeGFtcGxlIHVzYWdlIGluIGEgc3BlY2lmaWMgZW50aXR5IGNvbnRyb2xsZXI6XG5cdCAqIFxuXHQgKiBgYGB0eXBlc2NyaXB0XG5cdCAqIGV4cG9ydCBjbGFzcyBNeUVudGl0eUNvbnRyb2xsZXIgZXh0ZW5kcyBCYXNlRW50aXR5Q29udHJvbGxlcjxNeUVudGl0eVNjaGVtYT4ge1xuXHQgKiAgICAgLy8gVW5jb21tZW50IGFuZCBjdXN0b21pemUgdGhlIGJ1bGsgZGVsZXRlIG1ldGhvZHMgYmVsb3dcblx0ICogfVxuXHQgKiBgYGBcblx0ICovXG5cblx0LyoqXG5cdCAqIEJhdGNoIGRlbGV0ZXMgbXVsdGlwbGUgZW50aXRpZXMgYnkgdGhlaXIgSURzLlxuXHQgKiBcblx0ICog4pqg77iPIERBTkdFUk9VUyBPUEVSQVRJT04gLSBFbmFibGUgb25seSBpbiBzcGVjaWZpYyBjb250cm9sbGVycyB3aXRoIHByb3BlciBhdXRob3JpemF0aW9uXG5cdCAqIFxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdCB3aXRoIGJvZHk6IHsgaWRzOiBBcnJheTxpZGVudGlmaWVycz4sIGNvbmN1cnJlbnQ/OiBudW1iZXIgfVxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKiBcblx0ICogQGV4YW1wbGVcblx0ICogLy8gUmVxdWVzdCBib2R5OlxuXHQgKiB7XG5cdCAqICAgXCJpZHNcIjogW1xuXHQgKiAgICAgeyBcImlkXCI6IFwiaXRlbTFcIiB9LFxuXHQgKiAgICAgeyBcImlkXCI6IFwiaXRlbTJcIiB9LFxuXHQgKiAgICAgeyBcImlkXCI6IFwiaXRlbTNcIiB9XG5cdCAqICAgXSxcblx0ICogICBcImNvbmN1cnJlbnRcIjogMlxuXHQgKiB9XG5cdCAqL1xuXHQvLyDimqDvuI8gREFOR0VST1VTIE9QRVJBVElPTlxuXHQvLyAgQFBvc3QoJy9iYXRjaC1kZWxldGUnKVxuXHRhc3luYyBiYXRjaERlbGV0ZShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgeyBpZHMgPSBbXSwgY29uY3VycmVudCA9IDEgfSA9IHJlcS5ib2R5IHx8IHt9O1xuXG5cdFx0Y29uc3QgaWRlbnRpZmllcnMgPSBpZHMubWFwKChpZDogYW55KSA9PiB0aGlzLmdldEVudGl0eVNlcnZpY2UoKT8uZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKGlkKSk7XG5cblx0XHRjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5iYXRjaERlbGV0ZSh7XG5cdFx0XHRpZGVudGlmaWVycyxcblx0XHRcdGNvbmN1cnJlbnRcblx0XHR9LCBjdHgpO1xuXG5cdFx0Y29uc3QgdW5wcm9jZXNzZWRDb3VudCA9IChyZXN1bHQgYXMgYW55KT8udW5wcm9jZXNzZWQ/Lmxlbmd0aCB8fCAwO1xuXG5cdFx0Y29uc3QgZGVsZXRlZENvdW50ID0gaWRlbnRpZmllcnMubGVuZ3RoIC0gdW5wcm9jZXNzZWRDb3VudDtcblxuXHRcdGNvbnN0IHJlc3BvbnNlOiBhbnkgPSB7XG5cdFx0XHRkZWxldGVkQ291bnQsXG5cdFx0XHR1bnByb2Nlc3NlZENvdW50OiB1bnByb2Nlc3NlZENvdW50LFxuXHRcdFx0bWVzc2FnZTogYFN1Y2Nlc3NmdWxseSBkZWxldGVkICR7ZGVsZXRlZENvdW50fSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSByZWNvcmQocylgXG5cdFx0fTtcblxuXHRcdGlmICh1bnByb2Nlc3NlZENvdW50ID4gMCkge1xuXHRcdFx0cmVzcG9uc2UudW5wcm9jZXNzZWQgPSAocmVzdWx0IGFzIGFueSk/LnVucHJvY2Vzc2VkIHx8IFtdO1xuXHRcdFx0cmVzcG9uc2UubWVzc2FnZSArPSBgLCAke3VucHJvY2Vzc2VkQ291bnR9IGZhaWxlZGA7XG5cdFx0fVxuXG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3BvbnNlLnJlcSA9IHJlcTtcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzcG9uc2UpO1xuXHR9XG5cblx0LyoqXG5cdCAqIERlbGV0ZXMgZW50aXRpZXMgYmFzZWQgb24gZmlsdGVyIGNyaXRlcmlhLlxuXHQgKiBcblx0ICog4pqg77iPIEVYVFJFTUVMWSBEQU5HRVJPVVMgT1BFUkFUSU9OIC0gRW5hYmxlIG9ubHkgaW4gc3BlY2lmaWMgY29udHJvbGxlcnMgd2l0aCBzdHJpY3QgYXV0aG9yaXphdGlvblxuXHQgKiBcblx0ICogVGhpcyBlbmRwb2ludCBxdWVyaWVzIGZvciBlbnRpdGllcyBtYXRjaGluZyB0aGUgZmlsdGVycyBhbmQgYmF0Y2ggZGVsZXRlcyB0aGVtLlxuXHQgKiBJdCBpbmNsdWRlcyBzYWZldHkgbWVhc3VyZXMgbGlrZSByZXF1aXJpbmcgZmlsdGVycyBhbmQgb3B0aW9uYWwgbWF4SXRlbXMgbGltaXQuXG5cdCAqIFxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdCB3aXRoIGJvZHkgY29udGFpbmluZyBmaWx0ZXJzIGFuZCBvcHRpb25zXG5cdCAqIEBwYXJhbSB7UmVzcG9uc2V9IHJlcyAtIFRoZSByZXNwb25zZSBvYmplY3QuXG5cdCAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3BvbnNlPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgcmVzcG9uc2UuXG5cdCAqIFxuXHQgKiBAZXhhbXBsZVxuXHQgKiAvLyBSZXF1ZXN0IGJvZHk6XG5cdCAqIHtcblx0ICogICBcImZpbHRlcnNcIjoge1xuXHQgKiAgICAgXCJzdGF0dXNcIjogeyBcImVxXCI6IFwiaW5hY3RpdmVcIiB9LFxuXHQgKiAgICAgXCJsYXN0TG9naW5BdFwiOiB7IFwibHRcIjogXCIyMDIzLTAxLTAxXCIgfVxuXHQgKiAgIH0sXG5cdCAqICAgXCJiYXRjaFNpemVcIjogNTAsXG5cdCAqICAgXCJjb25jdXJyZW50XCI6IDIsXG5cdCAqICAgXCJtYXhJdGVtc1wiOiAxMDAwXG5cdCAqIH1cblx0ICovXG5cdC8vIOKaoO+4jyBFWFRSRU1FTFkgREFOR0VST1VTIE9QRVJBVElPTlxuXHQvLyBAUG9zdCgnL2RlbGV0ZS1ieS1xdWVyeScpXG5cdGFzeW5jIGRlbGV0ZUJ5UXVlcnkocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IHsgZmlsdGVycywgYmF0Y2hTaXplID0gMjUsIGNvbmN1cnJlbnQgPSAxLCBtYXhJdGVtcyB9ID0gcmVxLmJvZHkgfHwge307XG5cblx0XHRjb25zdCB7IGRyeVJ1biA9IGZhbHNlIH0gPSByZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzIHx8IHt9O1xuXG5cdFx0aWYgKGRyeVJ1bikge1xuXHRcdFx0Y29uc3QgcHJldmlld1Jlc3VsdCA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLnF1ZXJ5KHtcblx0XHRcdFx0ZmlsdGVycyxcblx0XHRcdFx0cGFnaW5hdGlvbjogeyBjb3VudDogMTAwMCwgbGltaXQ6IDEwMDAsIHBhZ2VzOiAnYWxsJyB9XG5cdFx0XHR9LFxuXHRcdFx0XHRjdHhcblx0XHRcdCk7XG5cblx0XHRcdHJldHVybiByZXMuanNvbih7XG5cdFx0XHRcdG1lc3NhZ2U6ICdEcnkgcnVuIG1vZGUgLSBwcmV2aWV3IHJlc3VsdHMgW3VwIHRvIDEwMDAgaXRlbXNdJyxcblx0XHRcdFx0cHJldmlld0NvdW50OiBwcmV2aWV3UmVzdWx0LmRhdGEubGVuZ3RoLFxuXHRcdFx0XHRwcmV2aWV3OiBwcmV2aWV3UmVzdWx0LmRhdGFcblx0XHRcdH0pO1xuXHRcdH1cblxuXHRcdGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmRlbGV0ZUJ5UXVlcnkoe1xuXHRcdFx0ZmlsdGVycyxcblx0XHRcdGJhdGNoU2l6ZSxcblx0XHRcdGNvbmN1cnJlbnQsXG5cdFx0XHRtYXhJdGVtc1xuXHRcdH0sIGN0eCk7XG5cblx0XHRjb25zdCByZXNwb25zZTogYW55ID0ge1xuXHRcdFx0Li4ucmVzdWx0LFxuXHRcdFx0bWVzc2FnZTogYFN1Y2Nlc3NmdWxseSBkZWxldGVkICR7cmVzdWx0LmRlbGV0ZWRDb3VudH0gJHt0aGlzLmdldEVudGl0eU5hbWUoKX0gcmVjb3JkKHMpYFxuXHRcdH07XG5cblx0XHRpZiAocmVzdWx0LmZhaWxlZENvdW50ID4gMCkge1xuXHRcdFx0cmVzcG9uc2UubWVzc2FnZSArPSBgLCAke3Jlc3VsdC5mYWlsZWRDb3VudH0gZmFpbGVkYDtcblx0XHR9XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzcG9uc2UucmVxID0gcmVxO1xuXHRcdFx0cmVzcG9uc2UuZmlsdGVycyA9IGZpbHRlcnM7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3BvbnNlKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBQZXJmb3JtcyBhIGN1c3RvbSBxdWVyeSBvbiB0aGUgZW50aXR5LlxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICovXG5cdEBQb3N0KCcvcXVlcnknKVxuXHRhc3luYyBxdWVyeShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgcXVlcnkgPSByZXEuYm9keTtcblx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgcXVlcnkgLSBxdWVyeTpgLCBxdWVyeSk7XG5cblx0XHRjb25zdCBpbnB1dFF1ZXJ5ID0gZGVlcENvcHkocXVlcnkpO1xuXG5cdFx0Y29uc3QgeyBkYXRhOiByZWNvcmRzLCBjdXJzb3I6IG5ld0N1cnNvciwgcXVlcnk6IHBhcnNlZFF1ZXJ5IH0gPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5xdWVyeShxdWVyeSwgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0Y3Vyc29yOiBuZXdDdXJzb3IsXG5cdFx0XHRpdGVtczogcmVjb3Jkcyxcblx0XHR9O1xuXG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3VsdC5yZXEgPSByZXE7XG5cdFx0XHRyZXN1bHQuY3JpdGVyaWEgPSB7XG5cdFx0XHRcdGlucHV0UXVlcnksXG5cdFx0XHRcdHBhcnNlZFF1ZXJ5XG5cdFx0XHR9O1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXN1bHQpO1xuXHR9XG5cblx0QFBvc3QoJy9zZWFyY2gnKVxuXHRhc3luYyBzZWFyY2gocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IHF1ZXJ5ID0gcmVxLmJvZHk7XG5cblx0XHRjb25zdCBpbnB1dFF1ZXJ5ID0gZGVlcENvcHkocXVlcnkpIGFzIEVudGl0eVNlYXJjaFF1ZXJ5PFNjaD47XG5cblx0XHRjb25zdCByZXN1bHRzID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuc2VhcmNoKHF1ZXJ5LCBjdHgpO1xuXG5cdFx0Y29uc3QgeyBoaXRzLCAuLi5yZXN0IH0gPSByZXN1bHRzO1xuXHRcdGNvbnN0IHJlc3BvbnNlID0ge1xuXHRcdFx0Li4ucmVzdCxcblx0XHRcdGl0ZW1zOiBoaXRzLFxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0T2JqZWN0LmFzc2lnbihyZXNwb25zZSwge1xuXHRcdFx0XHRpbnB1dFF1ZXJ5LFxuXHRcdFx0XHRwcm9jZXNzaW5nVGltZU1zOiByZXN1bHRzLnByb2Nlc3NpbmdUaW1lTXNcblx0XHRcdH0pO1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXNwb25zZSk7XG5cdH1cblxuXHRAR2V0KCcvc2VhcmNoJylcblx0YXN5bmMgc2VhcmNoR2V0KHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVzcG9uc2U+IHtcblx0XHRjb25zdCBxdWVyeSA9IHBhcnNlU2VhcmNoUXVlcnkocmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyB8fCB7fSk7XG5cdFx0cmV0dXJuIGF3YWl0IHRoaXMuc2VhcmNoKHsgLi4ucmVxLCBib2R5OiBxdWVyeSB9LCByZXMsIGN0eCk7XG5cdH1cblxufSJdfQ==