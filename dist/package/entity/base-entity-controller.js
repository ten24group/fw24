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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1lbnRpdHktY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvYmFzZS1lbnRpdHktY29udHJvbGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFLQSxtRkFBdUU7QUFDdkUsaURBQWdFO0FBQ2hFLDBDQUE4QztBQUM5QyxvQ0FBbUk7QUFDbkksbUNBQXdGO0FBQ3hGLG1DQUFvQztBQUNwQyxxQ0FBeUQ7QUFDekQsb0NBQW9DO0FBQ3BDLHNDQUEwQztBQUUxQyxpREFBd0Q7QUFFeEQsc0NBQThFO0FBYzlFOzs7R0FHRztBQUNILE1BQWEsb0JBQThELFNBQVEsc0NBQWE7SUFTaEU7SUFQdkIsVUFBVSxDQUFTO0lBRTNCOzs7O09BSUc7SUFDSCxZQUErQixhQUFxQyxFQUFFLFVBQVUsR0FBRyxhQUFhLEVBQUUsYUFBYSxFQUFFO1FBQ2hILEtBQUssRUFBRSxDQUFDO1FBRHNCLGtCQUFhLEdBQWIsYUFBYSxDQUF3QjtRQUVuRSxJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQztRQUU3QixtREFBbUQ7UUFDbkQsTUFBTSxtQkFBbUIsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxxQkFBcUIsQ0FJdEQsQ0FBQztRQUVkLElBQUksbUJBQW1CLEVBQUUsQ0FBQztZQUN6QixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUEsNkJBQWtCLEVBQUM7Z0JBQ3RDLFlBQVksRUFBRSxtQkFBbUIsQ0FBQyxZQUFZO2dCQUM5QyxTQUFTLEVBQUUsbUJBQW1CLENBQUMsU0FBUztnQkFDeEMsaUJBQWlCLEVBQUUsbUJBQW1CLENBQUMsaUJBQWlCO2FBQ3hELENBQUMsQ0FBQztRQUNKLENBQUM7SUFDRixDQUFDO0lBRVMsYUFBYTtRQUN0QixPQUFPLElBQUksQ0FBQyxVQUFVLElBQUksSUFBSSxDQUFDLGdCQUFnQixFQUFFLEVBQUUsYUFBYSxFQUFFLENBQUM7SUFDcEUsQ0FB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QUdLO0lBREwsSUFBQSxZQUFHLEVBQUMsaUJBQWlCLENBQUM7cURBa0J0QjtBQVNLO0lBREwsSUFBQSxZQUFHLEVBQUMsT0FBTyxDQUFDO2dEQXFCWjtBQVNLO0lBREwsSUFBQSxZQUFHLEVBQUMsRUFBRSxDQUFDO2dEQWtGUDtBQVNLO0lBREwsSUFBQSxjQUFLLEVBQUMsT0FBTyxDQUFDO2tEQXFCZDtBQVNLO0lBREwsSUFBQSxlQUFNLEVBQUMsT0FBTyxDQUFDO2tEQXFCZjtBQVNLO0lBREwsSUFBQSxhQUFJLEVBQUMsUUFBUSxDQUFDO2lEQXVCZDtBQUdLO0lBREwsSUFBQSxhQUFJLEVBQUMsU0FBUyxDQUFDO2tEQXNCZjtBQUdLO0lBREwsSUFBQSxZQUFHLEVBQUMsU0FBUyxDQUFDO3FEQUlkIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBSZXF1ZXN0LCBSZXNwb25zZSB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlTY2hlbWEsIEVudGl0eUlkZW50aWZpZXJzVHlwZUZyb21TY2hlbWEgfSBmcm9tICcuL2Jhc2UtZW50aXR5JztcbmltcG9ydCB0eXBlIHsgQmFzZUVudGl0eVNlcnZpY2UgfSBmcm9tICcuL2Jhc2Utc2VydmljZSc7XG5pbXBvcnQgdHlwZSB7IEVudGl0eUZpbHRlckNyaXRlcmlhLCBFbnRpdHlRdWVyeSwgR2VuZXJpY0ZpbHRlckNyaXRlcmlhLCBUeXBlZEZpbHRlckNyaXRlcmlhIH0gZnJvbSAnLi9xdWVyeS10eXBlcyc7XG5cbmltcG9ydCB7IEFQSUNvbnRyb2xsZXIgfSBmcm9tICcuLi9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlcic7XG5pbXBvcnQgeyBEZWxldGUsIEdldCwgUGF0Y2gsIFBvc3QgfSBmcm9tICcuLi9kZWNvcmF0b3JzL21ldGhvZCc7XG5pbXBvcnQgeyBzYWZlUGFyc2VJbnQgfSBmcm9tICcuLi91dGlscy9wYXJzZSc7XG5pbXBvcnQgeyBjYW1lbENhc2UsIGRlZXBDb3B5LCBpc0VtcHR5T2JqZWN0LCBpc0pzb25TdHJpbmcsIGlzT2JqZWN0LCBpc1N0cmluZywgbWVyZ2UsIHJlc29sdmVFbnZWYWx1ZUZvciwgdG9TbHVnIH0gZnJvbSAnLi4vdXRpbHMnO1xuaW1wb3J0IHsgcGFyc2VVcmxRdWVyeVN0cmluZ1BhcmFtZXRlcnMsIHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCB9IGZyb20gJy4vcXVlcnknO1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBnZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkIH0gZnJvbSAnLi4vY2xpZW50L3MzJztcbmltcG9ydCB7IEVOVl9LRVlTIH0gZnJvbSAnLi4vY29uc3QnO1xuaW1wb3J0IHsgTm90Rm91bmRFcnJvciB9IGZyb20gJy4uL2Vycm9ycyc7XG5pbXBvcnQgeyBFbnRpdHlWYWxpZGF0aW9uRXJyb3IgfSBmcm9tICcuL2Vycm9ycyc7XG5pbXBvcnQgeyBjcmVhdGVFcnJvckhhbmRsZXIgfSBmcm9tICcuLi9lcnJvcnMvaGFuZGxlcnMnO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgRW50aXR5U2VhcmNoUXVlcnksIHBhcnNlU2VhcmNoUXVlcnksIFNlYXJjaFJlc3VsdCB9IGZyb20gJy4uL3NlYXJjaCc7XG5pbXBvcnQgeyBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYSB9IGZyb20gJy4vYmFzZS1lbnRpdHknO1xuXG50eXBlIHNlY29uZHMgPSBudW1iZXI7XG5cbmV4cG9ydCB0eXBlIEdldFNpZ25lZFVybEZvckZpbGVVcGxvYWRTY2hlbWEgPSB7XG5cdGZpbGVOYW1lOiBzdHJpbmcsXG5cdGJ1Y2tldE5hbWU6IHN0cmluZyxcblx0ZXhwaXJlc0luPzogc2Vjb25kcywgLy8gZGVmYXVsdCB0byAxNSo2MCBzZWNvbmRzXG5cdGZpbGVOYW1lUHJlZml4Pzogc3RyaW5nLFxuXHRjb250ZW50VHlwZT86IHN0cmluZyAvLyBkZWZhdWx0IHRvICovKlxuXHRtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBzdHJpbmdcbn07XG5cbi8qKlxuICogQWJzdHJhY3QgYmFzZSBjbGFzcyBmb3IgZW50aXR5IGNvbnRyb2xsZXJzLlxuICogQHRlbXBsYXRlIFNjaCAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKi9cbmV4cG9ydCBjbGFzcyBCYXNlRW50aXR5Q29udHJvbGxlcjxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+IGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG5cblx0cHJpdmF0ZSBlbnRpdHlOYW1lOiBzdHJpbmc7XG5cblx0LyoqXG5cdCAqIENyZWF0ZXMgYW4gaW5zdGFuY2Ugb2YgQmFzZUVudGl0eUNvbnRyb2xsZXIuXG5cdCAqIEBwYXJhbSB7QmFzZUVudGl0eVNlcnZpY2U8U2NoPn0gZW50aXR5U2VydmljZSAtIFRoZSBlbnRpdHktc2VydmljZS5cblx0ICogQHBhcmFtIHtzdHJpbmd9IGVudGl0eU5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgZW50aXR5LlxuXHQgKi9cblx0Y29uc3RydWN0b3IocHJvdGVjdGVkIHJlYWRvbmx5IGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPFNjaD4sIGVudGl0eU5hbWUgPSBlbnRpdHlTZXJ2aWNlPy5nZXRFbnRpdHlOYW1lKCkpIHtcblx0XHRzdXBlcigpO1xuXHRcdHRoaXMuZW50aXR5TmFtZSA9IGVudGl0eU5hbWU7XG5cblx0XHQvLyBTZXQgZXJyb3IgaGFuZGxlciBvcHRpb25zIGZyb20gY29udHJvbGxlciBjb25maWdcblx0XHRjb25zdCBlcnJvckhhbmRsZXJPcHRpb25zID0gUmVmbGVjdC5nZXQodGhpcywgJ2Vycm9ySGFuZGxlck9wdGlvbnMnKSBhcyB7XG5cdFx0XHRpbmNsdWRlU3RhY2s/OiBib29sZWFuO1xuXHRcdFx0bG9nRXJyb3JzPzogYm9vbGVhbjtcblx0XHRcdGxvZ1JlcXVlc3REZXRhaWxzPzogYm9vbGVhbjtcblx0XHR9IHwgdW5kZWZpbmVkO1xuXG5cdFx0aWYgKGVycm9ySGFuZGxlck9wdGlvbnMpIHtcblx0XHRcdHRoaXMuZXJyb3JIYW5kbGVyID0gY3JlYXRlRXJyb3JIYW5kbGVyKHtcblx0XHRcdFx0aW5jbHVkZVN0YWNrOiBlcnJvckhhbmRsZXJPcHRpb25zLmluY2x1ZGVTdGFjayxcblx0XHRcdFx0bG9nRXJyb3JzOiBlcnJvckhhbmRsZXJPcHRpb25zLmxvZ0Vycm9ycyxcblx0XHRcdFx0bG9nUmVxdWVzdERldGFpbHM6IGVycm9ySGFuZGxlck9wdGlvbnMubG9nUmVxdWVzdERldGFpbHNcblx0XHRcdH0pO1xuXHRcdH1cblx0fVxuXG5cdHByb3RlY3RlZCBnZXRFbnRpdHlOYW1lKCkge1xuXHRcdHJldHVybiB0aGlzLmVudGl0eU5hbWUgfHwgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCk/LmdldEVudGl0eU5hbWUoKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBJbml0aWFsaXplcyB0aGUgZW50aXR5IGNvbnRyb2xsZXIuXG5cdCAqIE5vdGU6IEl0J3Mgbm90IGFuIGlkZWFsIHBsYWNlIHRvIGluaXRpYWxpemUgdGhlIGFwcCBzdGF0ZS9ESS9yb3V0ZXMsIGFuZCBzaG91bGQgYmUgcmVmYWN0b3JlZCB0byBhbiBpZGVhbCBjb21wb25lbnQuXG5cdCAqIEBwYXJhbSB7YW55fSBldmVudCAtIFRoZSBldmVudCBvYmplY3QuXG5cdCAqIEBwYXJhbSB7YW55fSBjb250ZXh0IC0gVGhlIGNvbnRleHQgb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgaW5pdGlhbGl6YXRpb24gaXMgY29tcGxldGUuXG5cdCAqL1xuXHRhc3luYyBpbml0aWFsaXplKF9ldmVudDogYW55LCBfY29udGV4dDogYW55KTogUHJvbWlzZTx2b2lkPiB7XG5cdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYEJhc2VFbnRpdHlDb250cm9sbGVyLmluaXRpYWxpemUgLSBkb25lOiAke2V2ZW50fSAke2NvbnRleHR9YCk7XG5cdH1cblxuXHQvKipcblx0ICogR2V0cyB0aGUgZW50aXR5IHNlcnZpY2UgZm9yIHRoZSBjb250cm9sbGVyLlxuXHQgKiBAdGVtcGxhdGUgUyAtIFRoZSB0eXBlIG9mIHRoZSBlbnRpdHkgc2VydmljZS5cblx0ICogQHJldHVybnMge1N9IFRoZSBlbnRpdHkgc2VydmljZS5cblx0ICovXG5cdHB1YmxpYyBnZXRFbnRpdHlTZXJ2aWNlPFMgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTxTY2g+PigpOiBTIHtcblx0XHRyZXR1cm4gdGhpcy5lbnRpdHlTZXJ2aWNlIGFzIFM7XG5cdH1cblxuXHQvKipcblx0ICogQ3JlYXRlcyBhIG5ldyBlbnRpdHkuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QFBvc3QoJycpXG5cdGFzeW5jIGNyZWF0ZShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgY3JlYXRlZEVudGl0eSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLmNyZWF0ZShyZXEuYm9keSwgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0WyBjYW1lbENhc2UodGhpcy5nZXRFbnRpdHlOYW1lKCkpIF06IGNyZWF0ZWRFbnRpdHksXG5cdFx0XHRtZXNzYWdlOiBcIkNyZWF0ZWQgc3VjY2Vzc2Z1bGx5XCJcblx0XHR9O1xuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXN1bHQpO1xuXHR9XG5cblx0QEdldCgnL2dldFNpZ25lZFVybEZvckZpbGVVcGxvYWQnLCB7XG5cdFx0dmFsaWRhdGlvbnM6IHtcblx0XHRcdGZpbGVOYW1lOiB7XG5cdFx0XHRcdHJlcXVpcmVkOiB0cnVlLFxuXHRcdFx0XHRkYXRhdHlwZTogJ3N0cmluZycsXG5cdFx0XHR9LFxuXHRcdFx0YnVja2V0TmFtZToge1xuXHRcdFx0XHRyZXF1aXJlZDogdHJ1ZSxcblx0XHRcdFx0ZGF0YXR5cGU6ICdzdHJpbmcnLFxuXHRcdFx0fSxcblx0XHR9XG5cdH0pXG5cdGFzeW5jIGdldFNpZ25lZFVybEZvckZpbGVVcGxvYWQocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBfY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXG5cdFx0bGV0IHsgYnVja2V0TmFtZSwgZmlsZU5hbWUsIGV4cGlyZXNJbiA9IDE1ICogNjAsIGZpbGVOYW1lUHJlZml4ID0gXCJcIiwgY29udGVudFR5cGUgPSBcIiovKlwiLCBtZXRhZGF0YSB9ID0gcmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyBhcyBHZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkU2NoZW1hID8/IHt9O1xuXG5cdFx0Y29uc3QgbmFtZVBhcnRzID0gZmlsZU5hbWUuc3BsaXQoJy4nKTtcblx0XHRjb25zdCBmaWxlRXh0ZW5zaW9uID0gbmFtZVBhcnRzLnBvcCgpO1xuXG5cdFx0Ly8gZW5zdXJlIGl0J3MgdW5pcXVlXG5cdFx0ZmlsZU5hbWUgPSBgJHtmaWxlTmFtZVByZWZpeH0ke3RvU2x1ZyhuYW1lUGFydHMuam9pbignLicpKX0tJHtyYW5kb21VVUlEKCl9LiR7ZmlsZUV4dGVuc2lvbn1gO1xuXG5cdFx0aWYgKG1ldGFkYXRhICYmIGlzU3RyaW5nKG1ldGFkYXRhKSAmJiBpc0pzb25TdHJpbmcobWV0YWRhdGEpKSB7XG5cdFx0XHRtZXRhZGF0YSA9IEpTT04ucGFyc2UobWV0YWRhdGEpO1xuXHRcdH1cblxuXHRcdGNvbnN0IG9wdGlvbnMgPSB7XG5cdFx0XHRmaWxlTmFtZSxcblx0XHRcdG1ldGFkYXRhOiBtZXRhZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuXHRcdFx0ZXhwaXJlc0luLFxuXHRcdFx0YnVja2V0TmFtZSxcblx0XHRcdGNvbnRlbnRUeXBlLFxuXHRcdFx0Y3VzdG9tRG9tYWluOiByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IEVOVl9LRVlTLkZJTEVTX0JVQ0tFVF9DVVNUT01fRE9NQUlOX0VOVl9LRVksIGRlZmF1bHRWYWx1ZTogJycgfSlcblx0XHR9O1xuXG5cdFx0Ly8gdGhpcy5sb2dnZXIuZGVidWcoYGdldFNpZ25lZFVybEZvckZpbGVVcGxvYWQ6OmAsIG9wdGlvbnMpO1xuXG5cdFx0Y29uc3Qgc2lnbmVkVXBsb2FkVVJMID0gYXdhaXQgZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZChvcHRpb25zKTtcblxuXHRcdGNvbnN0IHJlc3BvbnNlOiBhbnkgPSB7XG5cdFx0XHRmaWxlTmFtZSxcblx0XHRcdGV4cGlyZXNJbixcblx0XHRcdGNvbnRlbnRUeXBlLFxuXHRcdFx0c2lnbmVkVXBsb2FkVVJMLFxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzcG9uc2VbICdidWNrZXROYW1lJyBdID0gYnVja2V0TmFtZTtcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzcG9uc2UpO1xuXHR9XG5cblx0QEdldCgnL2R1cGxpY2F0ZS97aWR9Jylcblx0YXN5bmMgZHVwbGljYXRlKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuXHRcdGNvbnN0IHNlcnZpY2UgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoKTtcblxuXHRcdGNvbnN0IGlkZW50aWZpZXJzID0gc2VydmljZS5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMocmVxLnBhdGhQYXJhbWV0ZXJzKSBhcyBFbnRpdHlJZGVudGlmaWVyc1R5cGVGcm9tU2NoZW1hPFNjaD47XG5cblx0XHRjb25zdCBkdXBsaWNhdGVFbnRpdHkgPSBhd2FpdCBzZXJ2aWNlLmR1cGxpY2F0ZShpZGVudGlmaWVycywgY3R4KTtcblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0WyBjYW1lbENhc2UodGhpcy5nZXRFbnRpdHlOYW1lKCkpIF06IGR1cGxpY2F0ZUVudGl0eSxcblx0XHR9O1xuXG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3VsdC5yZXEgPSByZXE7XG5cdFx0XHRyZXN1bHQuaWRlbnRpZmllcnMgPSBpZGVudGlmaWVycztcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzdWx0KTtcblx0fVxuXG5cdC8qKlxuXHQgKiBGaW5kcyBhbiBlbnRpdHkgYnkgSUQuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QEdldCgnL3tpZH0nKVxuXHRhc3luYyBmaW5kKHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVzcG9uc2U+IHtcblx0XHRjb25zdCBpZGVudGlmaWVycyA9IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpPy5leHRyYWN0RW50aXR5SWRlbnRpZmllcnMocmVxLnBhdGhQYXJhbWV0ZXJzKTtcblx0XHRjb25zdCBhdHRyaWJ1dGVzID0gcmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVycz8uYXR0cmlidXRlcz8uc3BsaXQ/LignLCcpO1xuXG5cdFx0Y29uc3QgZW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuZ2V0KHsgaWRlbnRpZmllcnMsIGF0dHJpYnV0ZXMgfSwgY3R4KTtcblxuXHRcdGlmICghZW50aXR5KSB7XG5cdFx0XHR0aHJvdyBuZXcgTm90Rm91bmRFcnJvcih0aGlzLmdldEVudGl0eU5hbWUoKSwgdW5kZWZpbmVkLCByZXEpO1xuXHRcdH1cblxuXHRcdGNvbnN0IHJlc3VsdDogYW55ID0ge1xuXHRcdFx0WyBjYW1lbENhc2UodGhpcy5nZXRFbnRpdHlOYW1lKCkpIF06IGVudGl0eSxcblx0XHR9O1xuXG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3VsdC5yZXEgPSByZXE7XG5cdFx0XHRyZXN1bHQuaWRlbnRpZmllcnMgPSBpZGVudGlmaWVycztcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzdWx0KTtcblx0fVxuXG5cdC8qKlxuXHQgKiBMaXN0cyBlbnRpdGllcy5cblx0ICogQHBhcmFtIHtSZXF1ZXN0fSByZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG5cdCAqIEBwYXJhbSB7UmVzcG9uc2V9IHJlcyAtIFRoZSByZXNwb25zZSBvYmplY3QuXG5cdCAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3BvbnNlPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgcmVzcG9uc2UuXG5cdCAqL1xuXHRAR2V0KCcnKVxuXHRhc3luYyBsaXN0KHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVzcG9uc2U+IHtcblx0XHRjb25zdCBkYXRhID0gcmVxLnF1ZXJ5U3RyaW5nUGFyYW1ldGVycztcblx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgbGlzdCAtIGRhdGE6YCwgZGF0YSk7XG5cblx0XHRjb25zdCB7XG5cdFx0XHRvcmRlcixcblx0XHRcdGN1cnNvcixcblx0XHRcdGNvdW50LFxuXHRcdFx0bGltaXQsXG5cdFx0XHRwYWdlcyxcblx0XHRcdC4uLnJlc3RPZlF1ZXJ5UGFyYW1zXG5cdFx0fSA9IGRhdGEgfHwge307XG5cblx0XHRjb25zdCB7IGZpbHRlcnMgPSB7fSwgYXR0cmlidXRlcywgc2VhcmNoLCBzZWFyY2hBdHRyaWJ1dGVzLCAuLi5yZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzIH0gPSByZXN0T2ZRdWVyeVBhcmFtcztcblxuXHRcdGxldCBwYXJzZWRGaWx0ZXJzID0ge307XG5cblx0XHRpZiAoIWlzT2JqZWN0KGZpbHRlcnMpKSB7XG5cdFx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgZmlsdGVycyBpcyBub3QgYW4gb2JqZWN0OiBuZWVkIHRvIHBhcnNlIHRoZSBmaWx0ZXJzIHF1ZXJ5IHN0cmluZ2AsIGZpbHRlcnMpO1xuXG5cdFx0XHRpZiAoaXNKc29uU3RyaW5nKGZpbHRlcnMpKSB7XG5cdFx0XHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBmb3VuZCBKU09OIHN0cmluZyBmaWx0ZXJzIHBhcnNpbmdgLCBmaWx0ZXJzKTtcblx0XHRcdFx0cGFyc2VkRmlsdGVycyA9IEpTT04ucGFyc2UoZmlsdGVycyk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHQvLyBUT0RPOiBwYXJzZSBmaWx0ZXJzIHF1ZXJ5IHN0cmluZ1xuXHRcdFx0XHR0aGlzLmxvZ2dlci53YXJuKGBmaWx0ZXJzIGlzIG5vdCBhbiBKU09OOiBuZWVkIHRvIHBhcnNlIHRoZSBmaWx0ZXJzIHF1ZXJ5IHN0cmluZ2AsIGZpbHRlcnMpO1xuXHRcdFx0fVxuXHRcdH0gZWxzZSB7XG5cdFx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgZmlsdGVycyBpcyBhIHBhcnNlZCBvYmplY3RgLCBmaWx0ZXJzKTtcblx0XHRcdHBhcnNlZEZpbHRlcnMgPSBmaWx0ZXJzO1xuXHRcdH1cblxuXHRcdGlmIChyZXN0T2ZRdWVyeVBhcmFtc1dpdGhvdXRGaWx0ZXJzICYmICFpc0VtcHR5T2JqZWN0KHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnMpKSB7XG5cdFx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgZm91bmQgbm90IGVtcHR5IHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnM6YCwgcmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVycyk7XG5cblx0XHRcdGNvbnN0IHBhcnNlZFF1ZXJ5UGFyYW1zID0gcGFyc2VVcmxRdWVyeVN0cmluZ1BhcmFtZXRlcnMocmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVycyk7XG5cdFx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgcGFyc2VkIHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnM6YCwgcGFyc2VkUXVlcnlQYXJhbXMpO1xuXG5cdFx0XHRjb25zdCBwYXJzZWRRdWVyeVBhcmFtRmlsdGVycyA9IHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cChwYXJzZWRRdWVyeVBhcmFtcyk7XG5cdFx0XHQvLyB0aGlzLmxvZ2dlci5kZWJ1ZyhgZmlsdGVycyBmcm9tIHJlc3RPZlF1ZXJ5UGFyYW1zV2l0aG91dEZpbHRlcnM6YCwgcGFyc2VkUXVlcnlQYXJhbUZpbHRlcnMpO1xuXG5cdFx0XHRwYXJzZWRGaWx0ZXJzID0gbWVyZ2UoWyBwYXJzZWRGaWx0ZXJzLCBwYXJzZWRRdWVyeVBhcmFtRmlsdGVycyBdKSA/PyB7fTtcblx0XHR9XG5cblx0XHRjb25zdCBwYWdpbmF0aW9uID0ge1xuXHRcdFx0b3JkZXI6IG9yZGVyID8/ICdhc2MnLFxuXHRcdFx0Y3Vyc29yOiBjdXJzb3IgPz8gbnVsbCxcblx0XHRcdGNvdW50OiBzYWZlUGFyc2VJbnQoY291bnQsIDEyKS52YWx1ZSxcblx0XHRcdGxpbWl0OiBzYWZlUGFyc2VJbnQobGltaXQsIDI1MCkudmFsdWUsXG5cdFx0XHRwYWdlczogcGFnZXMgPT09ICdhbGwnID8gJ2FsbCcgYXMgY29uc3QgOiBzYWZlUGFyc2VJbnQocGFnZXMsIDEpLnZhbHVlLFxuXHRcdH1cblxuXHRcdHRoaXMubG9nZ2VyLmRlYnVnKGBwYXJzZWQgcGFnaW5hdGlvbmAsIHBhZ2luYXRpb24pO1xuXG5cdFx0Y29uc3QgcXVlcnkgPSB7XG5cdFx0XHRmaWx0ZXJzOiBkZWVwQ29weShwYXJzZWRGaWx0ZXJzKSBhcyBFbnRpdHlGaWx0ZXJDcml0ZXJpYTxTY2g+LFxuXHRcdFx0YXR0cmlidXRlczogYXR0cmlidXRlcz8uc3BsaXQ/LignLCcpLFxuXHRcdFx0cGFnaW5hdGlvbixcblx0XHRcdHNlYXJjaCxcblx0XHRcdHNlYXJjaEF0dHJpYnV0ZXNcblx0XHR9O1xuXG5cdFx0Y29uc3QgeyBkYXRhOiByZWNvcmRzLCBjdXJzb3I6IG5ld0N1cnNvciwgcXVlcnk6IHBhcnNlZFF1ZXJ5IH0gPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5saXN0KHF1ZXJ5LCBjdHgpO1xuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRjdXJzb3I6IG5ld0N1cnNvcixcblx0XHRcdGl0ZW1zOiByZWNvcmRzLFxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHRcdHJlc3VsdC5jcml0ZXJpYSA9IHtcblx0XHRcdFx0cGFnaW5hdGlvbixcblx0XHRcdFx0ZmlsdGVycyxcblx0XHRcdFx0cGFyc2VkRmlsdGVycyxcblx0XHRcdFx0cmVzdE9mUXVlcnlQYXJhbXNXaXRob3V0RmlsdGVycyxcblx0XHRcdFx0cGFyc2VkUXVlcnlcblx0XHRcdH07XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHQvKipcblx0ICogVXBkYXRlcyBhbiBlbnRpdHkgYnkgSUQuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QFBhdGNoKCcve2lkfScpXG5cdGFzeW5jIHVwZGF0ZShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgaWRlbnRpZmllcnMgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoKT8uZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKHJlcS5wYXRoUGFyYW1ldGVycyk7XG5cdFx0Y29uc3QgZW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuZ2V0KHsgaWRlbnRpZmllcnMgfSwgY3R4KTtcblxuXHRcdGlmICghZW50aXR5KSB7XG5cdFx0XHR0aHJvdyBuZXcgTm90Rm91bmRFcnJvcih0aGlzLmdldEVudGl0eU5hbWUoKSwgdW5kZWZpbmVkLCByZXEpO1xuXHRcdH1cblxuXHRcdGNvbnN0IHVwZGF0ZWRFbnRpdHkgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS51cGRhdGUoaWRlbnRpZmllcnMgYXMgYW55LCByZXEuYm9keSwgdW5kZWZpbmVkLCBjdHgpO1xuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRbIGNhbWVsQ2FzZSh0aGlzLmdldEVudGl0eU5hbWUoKSkgXTogdXBkYXRlZEVudGl0eSxcblx0XHRcdG1lc3NhZ2U6IFwiVXBkYXRlZCBzdWNjZXNzZnVsbHlcIlxuXHRcdH07XG5cdFx0aWYgKHJlcS5kZWJ1Z01vZGUpIHtcblx0XHRcdHJlc3VsdC5yZXEgPSByZXE7XG5cdFx0XHRyZXN1bHQuaWRlbnRpZmllcnMgPSBpZGVudGlmaWVycztcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzLmpzb24ocmVzdWx0KTtcblx0fVxuXG5cdC8qKlxuXHQgKiBEZWxldGVzIGFuIGVudGl0eSBieSBJRC5cblx0ICogQHBhcmFtIHtSZXF1ZXN0fSByZXEgLSBUaGUgcmVxdWVzdCBvYmplY3QuXG5cdCAqIEBwYXJhbSB7UmVzcG9uc2V9IHJlcyAtIFRoZSByZXNwb25zZSBvYmplY3QuXG5cdCAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3BvbnNlPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgcmVzcG9uc2UuXG5cdCAqL1xuXHRARGVsZXRlKCcve2lkfScpXG5cdGFzeW5jIGRlbGV0ZShyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgaWRlbnRpZmllcnMgPSB0aGlzLmdldEVudGl0eVNlcnZpY2UoKT8uZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKHJlcS5wYXRoUGFyYW1ldGVycyk7XG5cdFx0Y29uc3QgZW50aXR5ID0gYXdhaXQgdGhpcy5nZXRFbnRpdHlTZXJ2aWNlKCkuZ2V0KHsgaWRlbnRpZmllcnMgfSwgY3R4KTtcblxuXHRcdGlmICghZW50aXR5KSB7XG5cdFx0XHR0aHJvdyBuZXcgTm90Rm91bmRFcnJvcih0aGlzLmdldEVudGl0eU5hbWUoKSwgdW5kZWZpbmVkLCByZXEpO1xuXHRcdH1cblxuXHRcdGNvbnN0IGRlbGV0ZWRFbnRpdHkgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5kZWxldGUoaWRlbnRpZmllcnMsIGN0eCk7XG5cblx0XHRjb25zdCByZXN1bHQ6IGFueSA9IHtcblx0XHRcdFsgY2FtZWxDYXNlKHRoaXMuZ2V0RW50aXR5TmFtZSgpKSBdOiBkZWxldGVkRW50aXR5LFxuXHRcdFx0bWVzc2FnZTogXCJEZWxldGVkIHN1Y2Nlc3NmdWxseVwiXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRyZXN1bHQucmVxID0gcmVxO1xuXHRcdH1cblxuXHRcdHJldHVybiByZXMuanNvbihyZXN1bHQpO1xuXHR9XG5cblx0LyoqXG5cdCAqIFBlcmZvcm1zIGEgY3VzdG9tIHF1ZXJ5IG9uIHRoZSBlbnRpdHkuXG5cdCAqIEBwYXJhbSB7UmVxdWVzdH0gcmVxIC0gVGhlIHJlcXVlc3Qgb2JqZWN0LlxuXHQgKiBAcGFyYW0ge1Jlc3BvbnNlfSByZXMgLSBUaGUgcmVzcG9uc2Ugb2JqZWN0LlxuXHQgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXNwb25zZT59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHJlc3BvbnNlLlxuXHQgKi9cblx0QFBvc3QoJy9xdWVyeScpXG5cdGFzeW5jIHF1ZXJ5KHJlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UmVzcG9uc2U+IHtcblx0XHRjb25zdCBxdWVyeSA9IHJlcS5ib2R5O1xuXHRcdC8vIHRoaXMubG9nZ2VyLmRlYnVnKGBxdWVyeSAtIHF1ZXJ5OmAsIHF1ZXJ5KTtcblxuXHRcdGNvbnN0IGlucHV0UXVlcnkgPSBkZWVwQ29weShxdWVyeSk7XG5cblx0XHRjb25zdCB7IGRhdGE6IHJlY29yZHMsIGN1cnNvcjogbmV3Q3Vyc29yLCBxdWVyeTogcGFyc2VkUXVlcnkgfSA9IGF3YWl0IHRoaXMuZ2V0RW50aXR5U2VydmljZSgpLnF1ZXJ5KHF1ZXJ5LCBjdHgpO1xuXG5cdFx0Y29uc3QgcmVzdWx0OiBhbnkgPSB7XG5cdFx0XHRjdXJzb3I6IG5ld0N1cnNvcixcblx0XHRcdGl0ZW1zOiByZWNvcmRzLFxuXHRcdH07XG5cblx0XHRpZiAocmVxLmRlYnVnTW9kZSkge1xuXHRcdFx0cmVzdWx0LnJlcSA9IHJlcTtcblx0XHRcdHJlc3VsdC5jcml0ZXJpYSA9IHtcblx0XHRcdFx0aW5wdXRRdWVyeSxcblx0XHRcdFx0cGFyc2VkUXVlcnlcblx0XHRcdH07XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3VsdCk7XG5cdH1cblxuXHRAUG9zdCgnL3NlYXJjaCcpXG5cdGFzeW5jIHNlYXJjaChyZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFJlc3BvbnNlPiB7XG5cdFx0Y29uc3QgcXVlcnkgPSByZXEuYm9keTtcblxuXHRcdGNvbnN0IGlucHV0UXVlcnkgPSBkZWVwQ29weShxdWVyeSkgYXMgRW50aXR5U2VhcmNoUXVlcnk8U2NoPjtcblxuXHRcdGNvbnN0IHJlc3VsdHMgPSBhd2FpdCB0aGlzLmdldEVudGl0eVNlcnZpY2UoKS5zZWFyY2gocXVlcnksIGN0eCk7XG5cblx0XHRjb25zdCB7IGhpdHMsIC4uLnJlc3QgfSA9IHJlc3VsdHM7XG5cdFx0Y29uc3QgcmVzcG9uc2UgPSB7XG5cdFx0XHQuLi5yZXN0LFxuXHRcdFx0aXRlbXM6IGhpdHMsXG5cdFx0fTtcblxuXHRcdGlmIChyZXEuZGVidWdNb2RlKSB7XG5cdFx0XHRPYmplY3QuYXNzaWduKHJlc3BvbnNlLCB7XG5cdFx0XHRcdGlucHV0UXVlcnksXG5cdFx0XHRcdHByb2Nlc3NpbmdUaW1lTXM6IHJlc3VsdHMucHJvY2Vzc2luZ1RpbWVNc1xuXHRcdFx0fSk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHJlcy5qc29uKHJlc3BvbnNlKTtcblx0fVxuXG5cdEBHZXQoJy9zZWFyY2gnKVxuXHRhc3luYyBzZWFyY2hHZXQocmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xuXHRcdGNvbnN0IHF1ZXJ5ID0gcGFyc2VTZWFyY2hRdWVyeShyZXEucXVlcnlTdHJpbmdQYXJhbWV0ZXJzIHx8IHt9KTtcblx0XHRyZXR1cm4gYXdhaXQgdGhpcy5zZWFyY2goeyAuLi5yZXEsIGJvZHk6IHF1ZXJ5IH0sIHJlcywgY3R4KTtcblx0fVxuXG59Il19