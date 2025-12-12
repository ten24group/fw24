"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseEntityController = void 0;
const api_gateway_controller_1 = require("../core/runtime/api-gateway-controller");
const method_1 = require("../decorators/method");
const parse_1 = require("../utils/parse");
const utils_1 = require("../utils");
const query_1 = require("./query");
const crypto_1 = require("crypto");
const s3_1 = require("../client/s3");
const const_1 = require("../const");
const errors_1 = require("../errors");
const handlers_1 = require("../errors/handlers");
const search_1 = require("../search");
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
            bucketName,
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
            response['bucketName'] = bucketName;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1lbnRpdHktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvYmFzZS1lbnRpdHktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFLQSxtRkFBdUU7QUFDdkUsaURBQWdFO0FBQ2hFLDBDQUE4QztBQUM5QyxvQ0FBbUk7QUFDbkksbUNBQXdGO0FBQ3hGLG1DQUFvQztBQUNwQyxxQ0FBeUQ7QUFDekQsb0NBQW9DO0FBQ3BDLHNDQUEwQztBQUUxQyxpREFBd0Q7QUFFeEQsc0NBQThFO0FBYzlFOzs7R0FHRztBQUNILE1BQWEsb0JBQThELFNBQVEsc0NBQWE7SUFTaEU7SUFQdkIsVUFBVSxDQUFTO0lBRTNCOzs7O09BSUc7SUFDSCxZQUErQixhQUFxQyxFQUFFLFVBQVUsR0FBRyxhQUFhLEVBQUUsYUFBYSxFQUFFO1FBQ2hILEtBQUssRUFBRSxDQUFDO1FBRHNCLGtCQUFhLEdBQWIsYUFBYSxDQUF3QjtRQUVuRSxJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQztRQUU3QixtREFBbUQ7UUFDbkQsTUFBTSxtQkFBbUIsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxxQkFBcUIsQ0FJdEQsQ0FBQztRQUVkLElBQUksbUJBQW1CLEVBQUUsQ0FBQztZQUN6QixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUEsNkJBQWtCLEVBQUM7Z0JBQ3RDLFlBQVksRUFBRSxtQkFBbUIsQ0FBQyxZQUFZO2dCQUM5QyxTQUFTLEVBQUUsbUJBQW1CLENBQUMsU0FBUztnQkFDeEMsaUJBQWlCLEVBQUUsbUJBQW1CLENBQUMsaUJBQWlCO2FBQ3hELENBQUMsQ0FBQztRQUNKLENBQUM7SUFDRixDQUFDO0lBRVMsYUFBYTtRQUN0QixPQUFPLElBQUksQ0FBQyxVQUFVLElBQUksSUFBSSxDQUFDLGdCQUFnQixFQUFFLEVBQUUsYUFBYSxFQUFFLENBQUM7SUFDcEUsQ0FB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QUFPLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEdBQUcsR0FBRyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7SUFDN0QsQ0FBQztDQUVEO0FBbmhCRCxvREFtaEJDO0FBdmRNO0lBREwsSUFBQSxhQUFJLEVBQUMsRUFBRSxDQUFDO2tEQWFSO0FBY0s7SUFaTCxJQUFBLFlBQUcsRUFBQyw0QkFBNEIsRUFBRTtRQUNsQyxXQUFXLEVBQUU7WUFDWixRQUFRLEVBQUU7Z0JBQ1QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsUUFBUSxFQUFFLFFBQVE7YUFDbEI7WUFDRCxVQUFVLEVBQUU7Z0JBQ1gsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsUUFBUSxFQUFFLFFBQVE7YUFDbEI7U0FDRDtLQUNELENBQUM7cUVBd0NEO0FBR0s7SUFETCxJQUFBLFlBQUcsRUFBQyxpQkFBaUIsQ0FBQztxREFrQnRCO0FBU0s7SUFETCxJQUFBLFlBQUcsRUFBQyxPQUFPLENBQUM7Z0RBcUJaO0FBU0s7SUFETCxJQUFBLFlBQUcsRUFBQyxFQUFFLENBQUM7Z0RBa0ZQO0FBU0s7SUFETCxJQUFBLGNBQUssRUFBQyxPQUFPLENBQUM7a0RBc0JkO0FBU0s7SUFETCxJQUFBLGVBQU0sRUFBQyxPQUFPLENBQUM7a0RBcUJmO0FBMEpLO0lBREwsSUFBQSxhQUFJLEVBQUMsUUFBUSxDQUFDO2lEQXVCZDtBQUdLO0lBREwsSUFBQSxhQUFJLEVBQUMsU0FBUyxDQUFDO2tEQXNCZjtBQUdLO0lBREwsSUFBQSxZQUFHLEVBQUMsU0FBUyxDQUFDO3FEQUlkIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBSZXF1ZXN0LCBSZXNwb25zZSwgUm91dGUgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcbmltcG9ydCB0eXBlIHsgRW50aXR5U2NoZW1hLCBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hIH0gZnJvbSAnLi9iYXNlLWVudGl0eSc7XG5pbXBvcnQgdHlwZSB7IEJhc2VFbnRpdHlTZXJ2aWNlIH0gZnJvbSAnLi9iYXNlLXNlcnZpY2UnO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlGaWx0ZXJDcml0ZXJpYSwgRW50aXR5UXVlcnksIEdlbmVyaWNGaWx0ZXJDcml0ZXJpYSwgVHlwZWRGaWx0ZXJDcml0ZXJpYSB9IGZyb20gJy4vcXVlcnktdHlwZXMnO1xuXG5pbXBvcnQgeyBBUElDb250cm9sbGVyIH0gZnJvbSAnLi4vY29yZS9ydW50aW1lL2FwaS1nYXRld2F5LWNvbnRyb2xsZXInO1xuaW1wb3J0IHsgRGVsZXRlLCBHZXQsIFBhdGNoLCBQb3N0IH0gZnJvbSAnLi4vZGVjb3JhdG9ycy9tZXRob2QnO1xuaW1wb3J0IHsgc2FmZVBhcnNlSW50IH0gZnJvbSAnLi4vdXRpbHMvcGFyc2UnO1xuaW1wb3J0IHsgY2FtZWxDYXNlLCBkZWVwQ29weSwgaXNFbXB0eU9iamVjdCwgaXNKc29uU3RyaW5nLCBpc09iamVjdCwgaXNTdHJpbmcsIG1lcmdlLCByZXNvbHZlRW52VmFsdWVGb3IsIHRvU2x1ZyB9IGZyb20gJy4uL3V0aWxzJztcbmltcG9ydCB7IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzLCBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAgfSBmcm9tICcuL3F1ZXJ5JztcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZCB9IGZyb20gJy4uL2NsaWVudC9zMyc7XG5pbXBvcnQgeyBFTlZfS0VZUyB9IGZyb20gJy4uL2NvbnN0JztcbmltcG9ydCB7IE5vdEZvdW5kRXJyb3IgfSBmcm9tICcuLi9lcnJvcnMnO1xuaW1wb3J0IHsgRW50aXR5VmFsaWRhdGlvbkVycm9yIH0gZnJvbSAnLi9lcnJvcnMnO1xuaW1wb3J0IHsgY3JlYXRlRXJyb3JIYW5kbGVyIH0gZnJvbSAnLi4vZXJyb3JzL2hhbmRsZXJzJztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IEVudGl0eVNlYXJjaFF1ZXJ5LCBwYXJzZVNlYXJjaFF1ZXJ5LCBTZWFyY2hSZXN1bHQgfSBmcm9tICcuLi9zZWFyY2gnO1xuaW1wb3J0IHsgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWEgfSBmcm9tICcuL2Jhc2UtZW50aXR5JztcblxudHlwZSBzZWNvbmRzID0gbnVtYmVyO1xuXG5leHBvcnQgdHlwZSBHZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkU2NoZW1hID0ge1xuXHRmaWxlTmFtZTogc3RyaW5nLFxuXHRidWNrZXROYW1lOiBzdHJpbmcsXG5cdGV4cGlyZXNJbj86IHNlY29uZHMsIC8vIGRlZmF1bHQgdG8gMTUqNjAgc2Vjb25kc1xuXHRmaWxlTmFtZVByZWZpeD86IHN0cmluZyxcblx0Y29udGVudFR5cGU/OiBzdHJpbmcgLy8gZGVmYXVsdCB0byAqLypcblx0bWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgc3RyaW5nXG59O1xuXG4vKipcbiAqIEFic3RyYWN0IGJhc2UgY2xhc3MgZm9yIGVudGl0eSBjb250cm9sbGVycy5cbiAqIEB0ZW1wbGF0ZSBTY2ggLSBUaGUgZW50aXR5IHNjaGVtYSB0eXBlLlxuICovXG5leHBvcnQgY2xhc3MgQmFzZUVudGl0eUNvbnRyb2xsZXI8U2NoIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PiBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuXG5cdHByaXZhdGUgZW50aXR5TmFtZTogc3RyaW5nO1xuXG5cdC8qKlxuXHQgKiBDcmVhdGVzIGFuIGluc3RhbmNlIG9mIEJhc2VFbnRpdHlDb250cm9sbGVyLlxuXHQgKiBAcGFyYW0ge0Jhc2VFbnRpdHlTZXJ2aWNlPFNjaD59IGVudGl0eVNlcnZpY2UgLSBUaGUgZW50aXR5LXNlcnZpY2UuXG5cdCAqIEBwYXJhbSB7c3RyaW5nfSBlbnRpdHlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGVudGl0eS5cblx0ICovXG5cdGNvbnN0cnVjdG9yKHByb3RlY3RlZCByZWFkb25seSBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxTY2g+LCBlbnRpdHlOYW1lID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5TmFtZSgpKSB7XG5cdFx0c3VwZXIoKTtcblx0XHR0aGlzLmVudGl0eU5hbWUgPSBlbnRpdHlOYW1lO1xuXG5cdFx0Ly8gU2V0IGVycm9yIGhhbmRsZXIgb3B0aW9ucyBmcm9tIGNvbnRyb2xsZXIgY29uZmlnXG5cdFx0Y29uc3QgZXJyb3JIYW5kbGVyT3B0aW9ucyA9IFJlZmxlY3QuZ2V0KHRoaXMsICdlcnJvckhhbmRsZXJPcHRpb25zJykgYXMge1xuXHRcdFx0aW5jbHVkZVN0YWNrPzogYm9vbGVhbjtcblx0XHRcdGxvZ0Vycm9ycz86IGJvb2xlYW47XG5cdFx0XHRsb2dSZXF1ZXN0RGV0YWlscz86IGJvb2xlYW47XG5cdFx0fSB8IHVuZGVmaW5lZDtcblxuXHRcdGlmIChlcnJvckhhbmRsZXJPcHRpb25zKSB7XG5cdFx0XHR0aGlzLmVycm9ySGFuZGxlciA9IGNyZWF0ZUVycm9ySGFuZGxlcih7XG5cdFx0XHRcdGluY2x1ZGVTdGFjazogZXJyb3JIYW5kbGVyT3B0aW9ucy5pbmNsdWRlU3RhY2ssXG5cdFx0XHRcdGxvZ0Vycm9yczogZXJyb3JIYW5kbGVyT3B0aW9ucy5sb2dFcnJvcnMsXG5cdFx0XHRcdGxvZ1JlcXVlc3REZXRhaWxzOiBlcnJvckhhbmRsZXJPcHRpb25zLmxvZ1JlcXVlc3REZXRhaWxzXG5cdFx0XHR9KTtcblx0XHR9XG5cdH1cblxuXHRwcm90ZWN0ZWQgZ2V0RW50aXR5TmFtZSgpIHtcblx0XHRyZXR1cm4gdGhpcy5lbnRpdHlOYW1lIHx8IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpPy5nZXRFbnRpdHlOYW1lKCk7XG5cdH1cblxuXHQvKipcblx0ICogSW5pdGlhbGl6ZXMgdGhlIGVudGl0eSBjb250cm9sbGVyLlxuXHQgKiBOb3RlOiBJdCdzIG5vdCBhbiBpZGVhbCBwbGFjZSB0byBpbml0aWFsaXplIHRoZSBhcHAgc3RhdGUvREkvcm91dGVzLCBhbmQgc2hvdWxkIGJlIHJlZmFjdG9yZWQgdG8gYW4gaWRlYWwgY29tcG9uZW50LlxuXHQgKiBAcGFyYW0ge2FueX0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge2FueX0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gdGhlIGluaXRpYWxpemF0aW9uIGlzIGNvbXBsZXRlLlxuXHQgKi9cblx0YXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IGFueSwgX2NvbnRleHQ6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuXHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBCYXNlRW50aXR5Q29udHJvbGxlci5pbml0aWFsaXplIC0gZG9uZTogJHtldmVudH0gJHtjb250ZXh0fWApO1xuXHR9XG5cblx0LyoqXG5cdCAqIEdldHMgdGhlIGVudGl0eSBzZXJ2aWNlIGZvciB0aGUgY29udHJvbGxlci5cblx0ICogQHRlbXBsYXRlIFMgLSBUaGUgdHlwZSBvZiB0aGUgZW50aXR5IHNlcnZpY2UuXG5cdCAqIEByZXR1cm5zIHtTfSBUaGUgZW50aXR5IHNlcnZpY2UuXG5cdCAqL1xuXHRwdWJsaWMgZ2V0RW50aXR5U2VydmljZTxTIGV4dGVuZHMgQmFzZUVudGl0eVNlcnZpY2U8U2NoPj4oKTogUyB7XG5cdFx0cmV0dXJuIHRoaXMuZW50aXR5U2VydmljZSBhcyBTO1xuXHR9XG5cblx0LyoqXG5cdCAqIENyZWF0ZXMgYSBuZXcgZW50aXR5LlxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICovXG5cdEBQb3N0KCcnKVxuXHRhc3luYyBjcmVhdGUocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IGNyZWF0ZWRFbnRpdHkgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5jcmVhdGUocmVxLmJvZHksIGN0eCk7XG5cblx0XHRjb25zdCByZXN1bHQ6IGFueSA9IHtcblx0XHRcdFsgY2FtZWxDYXNlKHRoaXMuZ2V0RW50aXR5TmFtZSgpKSBdOiBjcmVhdGVkRW50aXR5LFxuXHRcdFx0bWVzc2FnZTogXCJDcmVhdGVkIHN1Y2Nlc3NmdWxseVwiXG5cdFx0fTtcblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzdWx0KTtcblx0fVxuXG5cdEBHZXQoJy9nZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkJywge1xuXHRcdHZhbGlkYXRpb25zOiB7XG5cdFx0XHRmaWxlTmFtZToge1xuXHRcdFx0XHRyZXF1aXJlZDogdHJ1ZSxcblx0XHRcdFx0ZGF0YXR5cGU6ICdzdHJpbmcnLFxuXHRcdFx0fSxcblx0XHRcdGJ1Y2tldE5hbWU6IHtcblx0XHRcdFx0cmVxdWlyZWQ6IHRydWUsXG5cdFx0XHRcdGRhdGF0eXBlOiAnc3RyaW5nJyxcblx0XHRcdH0sXG5cdFx0fVxuXHR9KVxuXHRhc3luYyBnZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgX2N0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblxuXHRcdGxldCB7IGJ1Y2tldE5hbWUsIGZpbGVOYW1lLCBleHBpcmVzSW4gPSAxNSAqIDYwLCBmaWxlTmFtZVByZWZpeCA9IFwiXCIsIGNvbnRlbnRUeXBlID0gXCIqLypcIiwgbWV0YWRhdGEgfSA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnMgYXMgR2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZFNjaGVtYSA/PyB7fTtcblxuXHRcdGNvbnN0IG5hbWVQYXJ0cyA9IGZpbGVOYW1lLnNwbGl0KCcuJyk7XG5cdFx0Y29uc3QgZmlsZUV4dGVuc2lvbiA9IG5hbWVQYXJ0cy5wb3AoKTtcblxuXHRcdC8vIGVuc3VyZSBpdCdzIHVuaXF1ZVxuXHRcdGZpbGVOYW1lID0gYCR7ZmlsZU5hbWVQcmVmaXh9JHt0b1NsdWcobmFtZVBhcnRzLmpvaW4oJy4nKSl9LSR7cmFuZG9tVVVJRCgpfS4ke2ZpbGVFeHRlbnNpb259YDtcblxuXHRcdGlmIChtZXRhZGF0YSAmJiBpc1N0cmluZyhtZXRhZGF0YSkgJiYgaXNKc29uU3RyaW5nKG1ldGFkYXRhKSkge1xuXHRcdFx0bWV0YWRhdGEgPSBKU09OLnBhcnNlKG1ldGFkYXRhKTtcblx0XHR9XG5cblx0XHRjb25zdCBvcHRpb25zID0ge1xuXHRcdFx0ZmlsZU5hbWUsXG5cdFx0XHRtZXRhZGF0YTogbWV0YWRhdGEgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPixcblx0XHRcdGV4cGlyZXNJbixcblx0XHRcdGJ1Y2tldE5hbWUsXG5cdFx0XHRjb250ZW50VHlwZSxcblx0XHRcdGN1c3RvbURvbWFpbjogcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBFTlZfS0VZUy5GSUxFU19CVUNLRVRfQ1VTVE9NX0RPTUFJTl9FTlZfS0VZLCBkZWZhdWx0VmFsdWU6ICcnIH0pXG5cdFx0fTtcblxuXHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBnZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkOjpgLCBvcHRpb25zKTtcblxuXHRcdGNvbnN0IHNpZ25lZFVwbG9hZFVSTCA9IGF3YWl0IGdldFNpZ25lZFVybEZvckZpbGVVcGxvYWQob3B0aW9ucyk7XG5cblx0XHRjb25zdCByZXNwb25zZTogYW55ID0ge1xuXHRcdFx0ZmlsZU5hbWUsXG5cdFx0XHRleHBpcmVzSW4sXG5cdFx0XHRjb250ZW50VHlwZSxcblx0XHRcdHNpZ25lZFVwbG9hZFVSTCxcblx0XHR9O1xuXG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3BvbnNlWyAnYnVja2V0TmFtZScgXSA9IGJ1Y2tldE5hbWU7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3BvbnNlKTtcblx0fVxuXG5cdEBHZXQoJy9kdXBsaWNhdGUve2lkfScpXG5cdGFzeW5jIGR1cGxpY2F0ZShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcblx0XHRjb25zdCBzZXJ2aWNlID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCk7XG5cblx0XHRjb25zdCBpZGVudGlmaWVycyA9IHNlcnZpY2UuZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKHJlcS5wYXRoUGFyYW1ldGVycykgYXMgRW50aXR5SWRlbnRpZmllcnNUeXBlRnJvbVNjaGVtYTxTY2g+O1xuXG5cdFx0Y29uc3QgZHVwbGljYXRlRW50aXR5ID0gYXdhaXQgc2VydmljZS5kdXBsaWNhdGUoaWRlbnRpZmllcnMsIGN0eCk7XG5cblx0XHRjb25zdCByZXN1bHQ6IGFueSA9IHtcblx0XHRcdFsgY2FtZWxDYXNlKHRoaXMuZ2V0RW50aXR5TmFtZSgpKSBdOiBkdXBsaWNhdGVFbnRpdHksXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdFx0cmVzdWx0LmlkZW50aWZpZXJzID0gaWRlbnRpZmllcnM7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHQvKipcblx0ICogRmluZHMgYW4gZW50aXR5IGJ5IElELlxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICovXG5cdEBHZXQoJy97aWR9Jylcblx0YXN5bmMgZmluZChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgaWRlbnRpZmllcnMgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoKT8uZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKHJlcS5wYXRoUGFyYW1ldGVycyk7XG5cdFx0Y29uc3QgYXR0cmlidXRlcyA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnM/LmF0dHJpYnV0ZXM/LnNwbGl0Py4oJywnKTtcblxuXHRcdGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmdldCh7IGlkZW50aWZpZXJzLCBhdHRyaWJ1dGVzIH0sIGN0eCk7XG5cblx0XHRpZiAoIWVudGl0eSkge1xuXHRcdFx0dGhyb3cgbmV3IE5vdEZvdW5kRXJyb3IodGhpcy5nZXRFbnRpdHlOYW1lKCksIHVuZGVmaW5lZCwgcmVxKTtcblx0XHR9XG5cblx0XHRjb25zdCByZXN1bHQ6IGFueSA9IHtcblx0XHRcdFsgY2FtZWxDYXNlKHRoaXMuZ2V0RW50aXR5TmFtZSgpKSBdOiBlbnRpdHksXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdFx0cmVzdWx0LmlkZW50aWZpZXJzID0gaWRlbnRpZmllcnM7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHQvKipcblx0ICogTGlzdHMgZW50aXRpZXMuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QEdldCgnJylcblx0YXN5bmMgbGlzdChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgZGF0YSA9IHJlcS5xdWVyeVN0cmluZ1BhcmFtZXRlcnM7XG5cdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGxpc3QgLSBkYXRhOmAsIGRhdGEpO1xuXG5cdFx0Y29uc3Qge1xuXHRcdFx0b3JkZXIsXG5cdFx0XHRjdXJzb3IsXG5cdFx0XHRjb3VudCxcblx0XHRcdGxpbWl0LFxuXHRcdFx0cGFnZXMsXG5cdFx0XHQuLi5yZXN0T2ZRdWVyeVBhcmFtc1xuXHRcdH0gPSBkYXRhIHx8IHt9O1xuXG5cdFx0Y29uc3QgeyBmaWx0ZXJzID0ge30sIGF0dHJpYnV0ZXMsIHNlYXJjaCwgc2VhcmNoQXR0cmlidXRlcywgLi4ucmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVycyB9ID0gcmVzdE9mUXVlcnlQYXJhbXM7XG5cblx0XHRsZXQgcGFyc2VkRmlsdGVycyA9IHt9O1xuXG5cdFx0aWYgKCFpc09iamVjdChmaWx0ZXJzKSkge1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZpbHRlcnMgaXMgbm90IGFuIG9iamVjdDogbmVlZCB0byBwYXJzZSB0aGUgZmlsdGVycyBxdWVyeSBzdHJpbmdgLCBmaWx0ZXJzKTtcblxuXHRcdFx0aWYgKGlzSnNvblN0cmluZyhmaWx0ZXJzKSkge1xuXHRcdFx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgZm91bmQgSlNPTiBzdHJpbmcgZmlsdGVycyBwYXJzaW5nYCwgZmlsdGVycyk7XG5cdFx0XHRcdHBhcnNlZEZpbHRlcnMgPSBKU09OLnBhcnNlKGZpbHRlcnMpO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0Ly8gVE9ETzogcGFyc2UgZmlsdGVycyBxdWVyeSBzdHJpbmdcblx0XHRcdFx0dGhpcy5sb2dnZXIud2FybihgZmlsdGVycyBpcyBub3QgYW4gSlNPTjogbmVlZCB0byBwYXJzZSB0aGUgZmlsdGVycyBxdWVyeSBzdHJpbmdgLCBmaWx0ZXJzKTtcblx0XHRcdH1cblx0XHR9IGVsc2Uge1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZpbHRlcnMgaXMgYSBwYXJzZWQgb2JqZWN0YCwgZmlsdGVycyk7XG5cdFx0XHRwYXJzZWRGaWx0ZXJzID0gZmlsdGVycztcblx0XHR9XG5cblx0XHRpZiAocmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVycyAmJiAhaXNFbXB0eU9iamVjdChyZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzKSkge1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZvdW5kIG5vdCBlbXB0eSByZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzOmAsIHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMpO1xuXG5cdFx0XHRjb25zdCBwYXJzZWRRdWVyeVBhcmFtcyA9IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzKHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMpO1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYHBhcnNlZCByZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzOmAsIHBhcnNlZFF1ZXJ5UGFyYW1zKTtcblxuXHRcdFx0Y29uc3QgcGFyc2VkUXVlcnlQYXJhbUZpbHRlcnMgPSBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAocGFyc2VkUXVlcnlQYXJhbXMpO1xuXHRcdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGZpbHRlcnMgZnJvbSByZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzOmAsIHBhcnNlZFF1ZXJ5UGFyYW1GaWx0ZXJzKTtcblxuXHRcdFx0cGFyc2VkRmlsdGVycyA9IG1lcmdlKFsgcGFyc2VkRmlsdGVycywgcGFyc2VkUXVlcnlQYXJhbUZpbHRlcnMgXSkgPz8ge307XG5cdFx0fVxuXG5cdFx0Y29uc3QgcGFnaW5hdGlvbiA9IHtcblx0XHRcdG9yZGVyOiBvcmRlciA/PyAnYXNjJyxcblx0XHRcdGN1cnNvcjogY3Vyc29yID8/IG51bGwsXG5cdFx0XHRjb3VudDogc2FmZVBhcnNlSW50KGNvdW50LCAxMikudmFsdWUsXG5cdFx0XHRsaW1pdDogc2FmZVBhcnNlSW50KGxpbWl0LCAyNTApLnZhbHVlLFxuXHRcdFx0cGFnZXM6IHBhZ2VzID09PSAnYWxsJyA/ICdhbGwnIGFzIGNvbnN0IDogc2FmZVBhcnNlSW50KHBhZ2VzLCAxKS52YWx1ZSxcblx0XHR9XG5cblx0XHR0aGlzLmxvZ2dlci5kZWJ1ZyhgcGFyc2VkIHBhZ2luYXRpb25gLCBwYWdpbmF0aW9uKTtcblxuXHRcdGNvbnN0IHF1ZXJ5ID0ge1xuXHRcdFx0ZmlsdGVyczogZGVlcENvcHkocGFyc2VkRmlsdGVycykgYXMgRW50aXR5RmlsdGVyQ3JpdGVyaWE8U2NoPixcblx0XHRcdGF0dHJpYnV0ZXM6IGF0dHJpYnV0ZXM/LnNwbGl0Py4oJywnKSxcblx0XHRcdHBhZ2luYXRpb24sXG5cdFx0XHRzZWFyY2gsXG5cdFx0XHRzZWFyY2hBdHRyaWJ1dGVzXG5cdFx0fTtcblxuXHRcdGNvbnN0IHsgZGF0YTogcmVjb3JkcywgY3Vyc29yOiBuZXdDdXJzb3IsIHF1ZXJ5OiBwYXJzZWRRdWVyeSB9ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkubGlzdChxdWVyeSwgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0Y3Vyc29yOiBuZXdDdXJzb3IsXG5cdFx0XHRpdGVtczogcmVjb3Jkcyxcblx0XHR9O1xuXG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3VsdC5yZXEgPSByZXE7XG5cdFx0XHRyZXN1bHQuY3JpdGVyaWEgPSB7XG5cdFx0XHRcdHBhZ2luYXRpb24sXG5cdFx0XHRcdGZpbHRlcnMsXG5cdFx0XHRcdHBhcnNlZEZpbHRlcnMsXG5cdFx0XHRcdHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMsXG5cdFx0XHRcdHBhcnNlZFF1ZXJ5XG5cdFx0XHR9O1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXN1bHQpO1xuXHR9XG5cblx0LyoqXG5cdCAqIFVwZGF0ZXMgYW4gZW50aXR5IGJ5IElELlxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdC5cblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICovXG5cdEBQYXRjaCgnL3tpZH0nKVxuXHRhc3luYyB1cGRhdGUocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IGlkZW50aWZpZXJzID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCk/LmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhyZXEucGF0aFBhcmFtZXRlcnMpO1xuXHRcdFxuXHRcdGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmdldCh7IGlkZW50aWZpZXJzIH0sIGN0eCk7XG5cblx0XHRpZiAoIWVudGl0eSkge1xuXHRcdFx0dGhyb3cgbmV3IE5vdEZvdW5kRXJyb3IodGhpcy5nZXRFbnRpdHlOYW1lKCksIHVuZGVmaW5lZCwgcmVxKTtcblx0XHR9XG5cblx0XHRjb25zdCB1cGRhdGVkRW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkudXBkYXRlKGlkZW50aWZpZXJzIGFzIGFueSwgcmVxLmJvZHksIHVuZGVmaW5lZCwgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0WyBjYW1lbENhc2UodGhpcy5nZXRFbnRpdHlOYW1lKCkpIF06IHVwZGF0ZWRFbnRpdHksXG5cdFx0XHRtZXNzYWdlOiBcIlVwZGF0ZWQgc3VjY2Vzc2Z1bGx5XCJcblx0XHR9O1xuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdFx0cmVzdWx0LmlkZW50aWZpZXJzID0gaWRlbnRpZmllcnM7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHQvKipcblx0ICogRGVsZXRlcyBhbiBlbnRpdHkgYnkgSUQuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QERlbGV0ZSgnL3tpZH0nKVxuXHRhc3luYyBkZWxldGUocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IGlkZW50aWZpZXJzID0gdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCk/LmV4dHJhY3RFbnRpdHlJZGVudGlmaWVycyhyZXEucGF0aFBhcmFtZXRlcnMpO1xuXHRcdGNvbnN0IGVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmdldCh7IGlkZW50aWZpZXJzIH0sIGN0eCk7XG5cblx0XHRpZiAoIWVudGl0eSkge1xuXHRcdFx0dGhyb3cgbmV3IE5vdEZvdW5kRXJyb3IodGhpcy5nZXRFbnRpdHlOYW1lKCksIHVuZGVmaW5lZCwgcmVxKTtcblx0XHR9XG5cblx0XHRjb25zdCBkZWxldGVkRW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuZGVsZXRlKGlkZW50aWZpZXJzLCBjdHgpO1xuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRbIGNhbWVsQ2FzZSh0aGlzLmdldEVudGl0eU5hbWUoKSkgXTogZGVsZXRlZEVudGl0eSxcblx0XHRcdG1lc3NhZ2U6IFwiRGVsZXRlZCBzdWNjZXNzZnVsbHlcIlxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzdWx0KTtcblx0fVxuXG5cdC8qKlxuXHQgKiBCVUxLIERFTEVURSBPUEVSQVRJT05TXG5cdCAqID09PT09PT09PT09PT09PT09PT09PT09XG5cdCAqIFxuXHQgKiBUaGUgZm9sbG93aW5nIG1ldGhvZHMgYXJlIGNvbW1lbnRlZCBvdXQgYnkgZGVmYXVsdCBhcyB0aGV5IGFyZSBkYW5nZXJvdXMgb3BlcmF0aW9uc1xuXHQgKiB0aGF0IGNhbiBkZWxldGUgbXVsdGlwbGUgcmVjb3JkcyBhdCBvbmNlLiBUbyBlbmFibGUgdGhlbSBpbiB5b3VyIGNvbnRyb2xsZXI6XG5cdCAqIFxuXHQgKiAxLiBVbmNvbW1lbnQgdGhlIG1ldGhvZChzKSB5b3UgbmVlZFxuXHQgKiAyLiBBZGQgYXBwcm9wcmlhdGUgYXV0aG9yaXphdGlvbiBjaGVja3Ncblx0ICogMy4gQ29uc2lkZXIgYWRkaW5nIGFkZGl0aW9uYWwgc2FmZXR5IG1lYXN1cmVzIChlLmcuLCBkcnktcnVuIG1vZGUsIGNvbmZpcm1hdGlvbiB0b2tlbnMpXG5cdCAqIDQuIEFkZCBhdWRpdCBsb2dnaW5nXG5cdCAqIFxuXHQgKiBFeGFtcGxlIHVzYWdlIGluIGEgc3BlY2lmaWMgZW50aXR5IGNvbnRyb2xsZXI6XG5cdCAqIFxuXHQgKiBgYGB0eXBlc2NyaXB0XG5cdCAqIGV4cG9ydCBjbGFzcyBNeUVudGl0eUNvbnRyb2xsZXIgZXh0ZW5kcyBCYXNlRW50aXR5Q29udHJvbGxlcjxNeUVudGl0eVNjaGVtYT4ge1xuXHQgKiAgICAgLy8gVW5jb21tZW50IGFuZCBjdXN0b21pemUgdGhlIGJ1bGsgZGVsZXRlIG1ldGhvZHMgYmVsb3dcblx0ICogfVxuXHQgKiBgYGBcblx0ICovXG5cblx0LyoqXG5cdCAqIEJhdGNoIGRlbGV0ZXMgbXVsdGlwbGUgZW50aXRpZXMgYnkgdGhlaXIgSURzLlxuXHQgKiBcblx0ICog4pqg77iPIERBTkdFUk9VUyBPUEVSQVRJT04gLSBFbmFibGUgb25seSBpbiBzcGVjaWZpYyBjb250cm9sbGVycyB3aXRoIHByb3BlciBhdXRob3JpemF0aW9uXG5cdCAqIFxuXHQgKiBAcGFyYW0ge1JlcXVlc3R9IHJlcSAtIFRoZSByZXF1ZXN0IG9iamVjdCB3aXRoIGJvZHk6IHsgaWRzOiBBcnJheTxpZGVudGlmaWVycz4sIGNvbmN1cnJlbnQ/OiBudW1iZXIgfVxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKiBcblx0ICogQGV4YW1wbGVcblx0ICogLy8gUmVxdWVzdCBib2R5OlxuXHQgKiB7XG5cdCAqICAgXCJpZHNcIjogW1xuXHQgKiAgICAgeyBcImlkXCI6IFwiaXRlbTFcIiB9LFxuXHQgKiAgICAgeyBcImlkXCI6IFwiaXRlbTJcIiB9LFxuXHQgKiAgICAgeyBcImlkXCI6IFwiaXRlbTNcIiB9XG5cdCAqICAgXSxcblx0ICogICBcImNvbmN1cnJlbnRcIjogMlxuXHQgKiB9XG5cdCAqL1xuXHQvLyDimqDvuI8gREFOR0VST1VTIE9QRVJBVElPTlxuXHQvLyAgQFBvc3QoJy9iYXRjaC1kZWxldGUnKVxuXHRhc3luYyBiYXRjaERlbGV0ZShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgeyBpZHMgPSBbXSwgY29uY3VycmVudCA9IDEgfSA9IHJlcS5ib2R5IHx8IHt9O1xuXHRcblx0XHRjb25zdCBpZGVudGlmaWVycyA9IGlkcy5tYXAoKGlkOiBhbnkpID0+IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpPy5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMoaWQpKTtcblx0XG5cdFx0Y29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuYmF0Y2hEZWxldGUoe1xuXHRcdFx0aWRlbnRpZmllcnMsXG5cdFx0XHRjb25jdXJyZW50XG5cdFx0fSwgY3R4KTtcblxuXHRcdGNvbnN0IHVucHJvY2Vzc2VkQ291bnQgPSAocmVzdWx0IGFzIGFueSk/LnVucHJvY2Vzc2VkPy5sZW5ndGggfHwgMDtcblx0XG5cdFx0Y29uc3QgZGVsZXRlZENvdW50ID0gaWRlbnRpZmllcnMubGVuZ3RoIC0gdW5wcm9jZXNzZWRDb3VudDtcblx0XG5cdFx0Y29uc3QgcmVzcG9uc2U6IGFueSA9IHtcblx0XHRcdGRlbGV0ZWRDb3VudCxcblx0XHRcdHVucHJvY2Vzc2VkQ291bnQ6IHVucHJvY2Vzc2VkQ291bnQsXG5cdFx0XHRtZXNzYWdlOiBgU3VjY2Vzc2Z1bGx5IGRlbGV0ZWQgJHtkZWxldGVkQ291bnR9ICR7dGhpcy5nZXRFbnRpdHlOYW1lKCl9IHJlY29yZChzKWBcblx0XHR9O1xuXHRcblx0XHRpZiAodW5wcm9jZXNzZWRDb3VudCA+IDApIHtcblx0XHRcdHJlc3BvbnNlLnVucHJvY2Vzc2VkID0gKHJlc3VsdCBhcyBhbnkpPy51bnByb2Nlc3NlZCB8fCBbXTtcblx0XHRcdHJlc3BvbnNlLm1lc3NhZ2UgKz0gYCwgJHt1bnByb2Nlc3NlZENvdW50fSBmYWlsZWRgO1xuXHRcdH1cblx0XG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3BvbnNlLnJlcSA9IHJlcTtcblx0XHR9XG5cdFxuXHRcdHJldHVybiByZXMuanNvbihyZXNwb25zZSk7XG5cdH1cblxuXHQvKipcblx0ICogRGVsZXRlcyBlbnRpdGllcyBiYXNlZCBvbiBmaWx0ZXIgY3JpdGVyaWEuXG5cdCAqIFxuXHQgKiDimqDvuI8gRVhUUkVNRUxZIERBTkdFUk9VUyBPUEVSQVRJT04gLSBFbmFibGUgb25seSBpbiBzcGVjaWZpYyBjb250cm9sbGVycyB3aXRoIHN0cmljdCBhdXRob3JpemF0aW9uXG5cdCAqIFxuXHQgKiBUaGlzIGVuZHBvaW50IHF1ZXJpZXMgZm9yIGVudGl0aWVzIG1hdGNoaW5nIHRoZSBmaWx0ZXJzIGFuZCBiYXRjaCBkZWxldGVzIHRoZW0uXG5cdCAqIEl0IGluY2x1ZGVzIHNhZmV0eSBtZWFzdXJlcyBsaWtlIHJlcXVpcmluZyBmaWx0ZXJzIGFuZCBvcHRpb25hbCBtYXhJdGVtcyBsaW1pdC5cblx0ICogXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0IHdpdGggYm9keSBjb250YWluaW5nIGZpbHRlcnMgYW5kIG9wdGlvbnNcblx0ICogQHBhcmFtIHtSZXNwb25zZX0gcmVzIC0gVGhlIHJlc3BvbnNlIG9iamVjdC5cblx0ICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSByZXNwb25zZS5cblx0ICogXG5cdCAqIEBleGFtcGxlXG5cdCAqIC8vIFJlcXVlc3QgYm9keTpcblx0ICoge1xuXHQgKiAgIFwiZmlsdGVyc1wiOiB7XG5cdCAqICAgICBcInN0YXR1c1wiOiB7IFwiZXFcIjogXCJpbmFjdGl2ZVwiIH0sXG5cdCAqICAgICBcImxhc3RMb2dpbkF0XCI6IHsgXCJsdFwiOiBcIjIwMjMtMDEtMDFcIiB9XG5cdCAqICAgfSxcblx0ICogICBcImJhdGNoU2l6ZVwiOiA1MCxcblx0ICogICBcImNvbmN1cnJlbnRcIjogMixcblx0ICogICBcIm1heEl0ZW1zXCI6IDEwMDBcblx0ICogfVxuXHQgKi9cblx0Ly8g4pqg77iPIEVYVFJFTUVMWSBEQU5HRVJPVVMgT1BFUkFUSU9OXG5cdC8vIEBQb3N0KCcvZGVsZXRlLWJ5LXF1ZXJ5Jylcblx0YXN5bmMgZGVsZXRlQnlRdWVyeShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgeyBmaWx0ZXJzLCBiYXRjaFNpemUgPSAyNSwgY29uY3VycmVudCA9IDEsIG1heEl0ZW1zIH0gPSByZXEuYm9keSB8fCB7fTtcblx0XG5cdFx0Y29uc3QgeyBkcnlSdW4gPSBmYWxzZSB9ID0gcmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyB8fCB7fTtcblxuXHRcdGlmIChkcnlSdW4pIHtcblx0XHQgICAgY29uc3QgcHJldmlld1Jlc3VsdCA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLnF1ZXJ5KHsgXG5cdFx0XHRcdFx0ZmlsdGVycywgXG5cdFx0XHRcdFx0cGFnaW5hdGlvbjogeyBjb3VudDogMTAwMCwgbGltaXQ6IDEwMDAsIHBhZ2VzOiAnYWxsJyB9IFxuXHRcdFx0XHR9LCBcblx0XHRcdFx0Y3R4XG5cdFx0XHQpO1xuXG5cdFx0XHRyZXR1cm4gcmVzLmpzb24oe1xuXHRcdFx0XHRcdG1lc3NhZ2U6ICdEcnkgcnVuIG1vZGUgLSBwcmV2aWV3IHJlc3VsdHMgW3VwIHRvIDEwMDAgaXRlbXNdJyxcblx0XHRcdFx0XHRwcmV2aWV3Q291bnQ6IHByZXZpZXdSZXN1bHQuZGF0YS5sZW5ndGgsXG5cdFx0XHRcdFx0cHJldmlldzogcHJldmlld1Jlc3VsdC5kYXRhXG5cdFx0XHR9KTtcblx0XHR9XG5cdFxuXHRcdGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmRlbGV0ZUJ5UXVlcnkoe1xuXHRcdFx0ZmlsdGVycyxcblx0XHRcdGJhdGNoU2l6ZSxcblx0XHRcdGNvbmN1cnJlbnQsXG5cdFx0XHRtYXhJdGVtc1xuXHRcdH0sIGN0eCk7XG5cdFxuXHRcdGNvbnN0IHJlc3BvbnNlOiBhbnkgPSB7XG5cdFx0XHQuLi5yZXN1bHQsXG5cdFx0XHRtZXNzYWdlOiBgU3VjY2Vzc2Z1bGx5IGRlbGV0ZWQgJHtyZXN1bHQuZGVsZXRlZENvdW50fSAke3RoaXMuZ2V0RW50aXR5TmFtZSgpfSByZWNvcmQocylgXG5cdFx0fTtcblx0XG5cdFx0aWYgKHJlc3VsdC5mYWlsZWRDb3VudCA+IDApIHtcblx0XHRcdHJlc3BvbnNlLm1lc3NhZ2UgKz0gYCwgJHtyZXN1bHQuZmFpbGVkQ291bnR9IGZhaWxlZGA7XG5cdFx0fVxuXHRcblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzcG9uc2UucmVxID0gcmVxO1xuXHRcdFx0cmVzcG9uc2UuZmlsdGVycyA9IGZpbHRlcnM7XG5cdFx0fVxuXHRcblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzcG9uc2UpO1xuXHR9XG5cblx0LyoqXG5cdCAqIFBlcmZvcm1zIGEgY3VzdG9tIHF1ZXJ5IG9uIHRoZSBlbnRpdHkuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QFBvc3QoJy9xdWVyeScpXG5cdGFzeW5jIHF1ZXJ5KHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVzcG9uc2U+IHtcblx0XHRjb25zdCBxdWVyeSA9IHJlcS5ib2R5O1xuXHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBxdWVyeSAtIHF1ZXJ5OmAsIHF1ZXJ5KTtcblxuXHRcdGNvbnN0IGlucHV0UXVlcnkgPSBkZWVwQ29weShxdWVyeSk7XG5cblx0XHRjb25zdCB7IGRhdGE6IHJlY29yZHMsIGN1cnNvcjogbmV3Q3Vyc29yLCBxdWVyeTogcGFyc2VkUXVlcnkgfSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLnF1ZXJ5KHF1ZXJ5LCBjdHgpO1xuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRjdXJzb3I6IG5ld0N1cnNvcixcblx0XHRcdGl0ZW1zOiByZWNvcmRzLFxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHRcdHJlc3VsdC5jcml0ZXJpYSA9IHtcblx0XHRcdFx0aW5wdXRRdWVyeSxcblx0XHRcdFx0cGFyc2VkUXVlcnlcblx0XHRcdH07XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHRAUG9zdCgnL3NlYXJjaCcpXG5cdGFzeW5jIHNlYXJjaChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgcXVlcnkgPSByZXEuYm9keTtcblxuXHRcdGNvbnN0IGlucHV0UXVlcnkgPSBkZWVwQ29weShxdWVyeSkgYXMgRW50aXR5U2VhcmNoUXVlcnk8U2NoPjtcblxuXHRcdGNvbnN0IHJlc3VsdHMgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5zZWFyY2gocXVlcnksIGN0eCk7XG5cblx0XHRjb25zdCB7IGhpdHMsIC4uLnJlc3QgfSA9IHJlc3VsdHM7XG5cdFx0Y29uc3QgcmVzcG9uc2UgPSB7XG5cdFx0XHQuLi5yZXN0LFxuXHRcdFx0aXRlbXM6IGhpdHMsXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRPYmplY3QuYXNzaWduKHJlc3BvbnNlLCB7XG5cdFx0XHRcdGlucHV0UXVlcnksXG5cdFx0XHRcdHByb2Nlc3NpbmdUaW1lTXM6IHJlc3VsdHMucHJvY2Vzc2luZ1RpbWVNc1xuXHRcdFx0fSk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3BvbnNlKTtcblx0fVxuXG5cdEBHZXQoJy9zZWFyY2gnKVxuXHRhc3luYyBzZWFyY2hHZXQocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IHF1ZXJ5ID0gcGFyc2VTZWFyY2hRdWVyeShyZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzIHx8IHt9KTtcblx0XHRyZXR1cm4gYXdhaXQgdGhpcy5zZWFyY2goeyAuLi5yZXEsIGJvZHk6IHF1ZXJ5IH0sIHJlcywgY3R4KTtcblx0fVxuXG59Il19