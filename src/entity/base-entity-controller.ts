import type { Request, Response } from '../interfaces';
import type { EntitySchema, EntityIdentifiersTypeFromSchema } from './base-entity';
import type { BaseEntityService } from './base-service';
import type { EntityFilterCriteria, EntityQuery, GenericFilterCriteria, TypedFilterCriteria } from './query-types';

import { APIController } from '../core/runtime/api-gateway-controller';
import { Delete, Get, Patch, Post } from '../decorators/method';
import { safeParseInt } from '../utils/parse';
import { camelCase, deepCopy, isEmptyObject, isJsonString, isObject, isString, merge, resolveEnvValueFor, toSlug } from '../utils';
import { parseUrlQueryStringParameters, queryStringParamsToFilterGroup } from './query';
import { randomUUID } from 'crypto';
import { getSignedUrlForFileUpload } from '../client/s3';
import { ENV_KEYS } from '../const';
import { NotFoundError } from '../errors';
import { EntityValidationError } from './errors';
import { createErrorHandler } from '../errors/handlers';
import { ExecutionContext } from '../core/types/execution-context';
import { EntitySearchQuery, parseSearchQuery, SearchResult } from '../search';
import { EntityRecordTypeFromSchema } from './base-entity';

type seconds = number;

export type GetSignedUrlForFileUploadSchema = {
	fileName: string,
	bucketName: string,
	expiresIn?: seconds, // default to 15*60 seconds
	fileNamePrefix?: string,
	contentType?: string // default to */*
	metadata?: Record<string, string> | string
};

/**
 * Abstract base class for entity controllers.
 * @template Sch - The entity schema type.
 */
export class BaseEntityController<Sch extends EntitySchema<any, any, any>> extends APIController {

	private entityName: string;

	/**
	 * Creates an instance of BaseEntityController.
	 * @param {BaseEntityService<Sch>} entityService - The entity-service.
	 * @param {string} entityName - The name of the entity.
	 */
	constructor(protected readonly entityService: BaseEntityService<Sch>, entityName = entityService?.getEntityName()) {
		super();
		this.entityName = entityName;

		// Set error handler options from controller config
		const errorHandlerOptions = Reflect.get(this, 'errorHandlerOptions') as {
			includeStack?: boolean;
			logErrors?: boolean;
			logRequestDetails?: boolean;
		} | undefined;

		if (errorHandlerOptions) {
			this.errorHandler = createErrorHandler({
				includeStack: errorHandlerOptions.includeStack,
				logErrors: errorHandlerOptions.logErrors,
				logRequestDetails: errorHandlerOptions.logRequestDetails
			});
		}
	}

	protected getEntityName() {
		return this.entityName || this.getEntityService()?.getEntityName();
	}

	/**
	 * Initializes the entity controller.
	 * Note: It's not an ideal place to initialize the app state/DI/routes, and should be refactored to an ideal component.
	 * @param {any} event - The event object.
	 * @param {any} context - The context object.
	 * @returns {Promise<void>} A promise that resolves when the initialization is complete.
	 */
	async initialize(_event: any, _context: any): Promise<void> {
		// this.logger.debug(`BaseEntityController.initialize - done: ${event} ${context}`);
	}

	/**
	 * Gets the entity service for the controller.
	 * @template S - The type of the entity service.
	 * @returns {S} The entity service.
	 */
	public getEntityService<S extends BaseEntityService<Sch>>(): S {
		return this.entityService as S;
	}

	/**
	 * Creates a new entity.
	 * @param {Request} req - The request object.
	 * @param {Response} res - The response object.
	 * @returns {Promise<Response>} A promise that resolves with the response.
	 */
	@Post('')
	async create(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const createdEntity = await this.getEntityService().create(req.body, ctx);

		const result: any = {
			[ camelCase(this.getEntityName()) ]: createdEntity,
			message: "Created successfully"
		};
		if (req.debugMode) {
			result.req = req;
		}

		return res.json(result);
	}

	@Get('/getSignedUrlForFileUpload', {
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
	async getSignedUrlForFileUpload(req: Request, res: Response, _ctx?: ExecutionContext) {

		let { bucketName, fileName, expiresIn = 15 * 60, fileNamePrefix = "", contentType = "*/*", metadata } = req.queryStringParameters as GetSignedUrlForFileUploadSchema ?? {};

		const nameParts = fileName.split('.');
		const fileExtension = nameParts.pop();

		// ensure it's unique
		fileName = `${fileNamePrefix}${toSlug(nameParts.join('.'))}-${randomUUID()}.${fileExtension}`;

		if (metadata && isString(metadata) && isJsonString(metadata)) {
			metadata = JSON.parse(metadata);
		}

		const options = {
			fileName,
			metadata: metadata as Record<string, string>,
			expiresIn,
			bucketName,
			contentType,
			customDomain: resolveEnvValueFor({ key: ENV_KEYS.FILES_BUCKET_CUSTOM_DOMAIN_ENV_KEY, defaultValue: '' })
		};

		// this.logger.debug(`getSignedUrlForFileUpload::`, options);

		const signedUploadURL = await getSignedUrlForFileUpload(options);

		const response: any = {
			fileName,
			expiresIn,
			contentType,
			signedUploadURL,
		};

		if (req.debugMode) {
			response[ 'bucketName' ] = bucketName;
		}

		return res.json(response);
	}

	@Get('/duplicate/{id}')
	async duplicate(req: Request, res: Response, ctx?: ExecutionContext) {
		const service = this.getEntityService();

		const identifiers = service.extractEntityIdentifiers(req.pathParameters) as EntityIdentifiersTypeFromSchema<Sch>;

		const duplicateEntity = await service.duplicate(identifiers, ctx);

		const result: any = {
			[ camelCase(this.getEntityName()) ]: duplicateEntity,
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
	@Get('/{id}')
	async find(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);
		const attributes = req.queryStringParameters?.attributes?.split?.(',');

		const entity = await this.getEntityService().get({ identifiers, attributes }, ctx);

		if (!entity) {
			throw new NotFoundError(this.getEntityName(), undefined, req);
		}

		const result: any = {
			[ camelCase(this.getEntityName()) ]: entity,
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
	@Get('')
	async list(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const data = req.queryStringParameters;
		// this.logger.debug(`list - data:`, data);

		const {
			order,
			cursor,
			count,
			limit,
			pages,
			...restOfQueryParams
		} = data || {};

		const { filters = {}, attributes, search, searchAttributes, ...restOfQueryParamsWithoutFilters } = restOfQueryParams;

		let parsedFilters = {};

		if (!isObject(filters)) {
			// this.logger.debug(`filters is not an object: need to parse the filters query string`, filters);

			if (isJsonString(filters)) {
				// this.logger.debug(`found JSON string filters parsing`, filters);
				parsedFilters = JSON.parse(filters);
			} else {
				// TODO: parse filters query string
				this.logger.warn(`filters is not an JSON: need to parse the filters query string`, filters);
			}
		} else {
			// this.logger.debug(`filters is a parsed object`, filters);
			parsedFilters = filters;
		}

		if (restOfQueryParamsWithoutFilters && !isEmptyObject(restOfQueryParamsWithoutFilters)) {
			// this.logger.debug(`found not empty restOfQueryParamsWithoutFilters:`, restOfQueryParamsWithoutFilters);

			const parsedQueryParams = parseUrlQueryStringParameters(restOfQueryParamsWithoutFilters);
			// this.logger.debug(`parsed restOfQueryParamsWithoutFilters:`, parsedQueryParams);

			const parsedQueryParamFilters = queryStringParamsToFilterGroup(parsedQueryParams);
			// this.logger.debug(`filters from restOfQueryParamsWithoutFilters:`, parsedQueryParamFilters);

			parsedFilters = merge([ parsedFilters, parsedQueryParamFilters ]) ?? {};
		}

		const pagination = {
			order: order ?? 'asc',
			cursor: cursor ?? null,
			count: safeParseInt(count, 12).value,
			limit: safeParseInt(limit, 250).value,
			pages: pages === 'all' ? 'all' as const : safeParseInt(pages, 1).value,
		}

		this.logger.debug(`parsed pagination`, pagination);

		const query = {
			filters: deepCopy(parsedFilters) as EntityFilterCriteria<Sch>,
			attributes: attributes?.split?.(','),
			pagination,
			search,
			searchAttributes
		};

		const { data: records, cursor: newCursor, query: parsedQuery } = await this.getEntityService().list(query, ctx);

		const result: any = {
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
	@Patch('/{id}')
	async update(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);
		
		const entity = await this.getEntityService().get({ identifiers }, ctx);

		if (!entity) {
			throw new NotFoundError(this.getEntityName(), undefined, req);
		}

		const updatedEntity = await this.getEntityService().update(identifiers as any, req.body, undefined, ctx);

		const result: any = {
			[ camelCase(this.getEntityName()) ]: updatedEntity,
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
	@Delete('/{id}')
	async delete(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);
		const entity = await this.getEntityService().get({ identifiers }, ctx);

		if (!entity) {
			throw new NotFoundError(this.getEntityName(), undefined, req);
		}

		const deletedEntity = await this.getEntityService().delete(identifiers, ctx);

		const result: any = {
			[ camelCase(this.getEntityName()) ]: deletedEntity,
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
	async batchDelete(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const { ids = [], concurrent = 1 } = req.body || {};
	
		const identifiers = ids.map((id: any) => this.getEntityService()?.extractEntityIdentifiers(id));
	
		const result = await this.getEntityService().batchDelete({
			identifiers,
			concurrent
		}, ctx);

		const unprocessedCount = (result as any)?.unprocessed?.length || 0;
	
		const deletedCount = identifiers.length - unprocessedCount;
	
		const response: any = {
			deletedCount,
			unprocessedCount: unprocessedCount,
			message: `Successfully deleted ${deletedCount} ${this.getEntityName()} record(s)`
		};
	
		if (unprocessedCount > 0) {
			response.unprocessed = (result as any)?.unprocessed || [];
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
	async deleteByQuery(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const { filters, batchSize = 25, concurrent = 1, maxItems } = req.body || {};
	
		const { dryRun = false } = req.queryStringParameters || {};

		if (dryRun) {
		    const previewResult = await this.getEntityService().query({ 
					filters, 
					pagination: { count: 1000, limit: 1000, pages: 'all' } 
				}, 
				ctx
			);

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
	
		const response: any = {
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
	@Post('/query')
	async query(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const query = req.body;
		// this.logger.debug(`query - query:`, query);

		const inputQuery = deepCopy(query);

		const { data: records, cursor: newCursor, query: parsedQuery } = await this.getEntityService().query(query, ctx);

		const result: any = {
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

	@Post('/search')
	async search(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const query = req.body;

		const inputQuery = deepCopy(query) as EntitySearchQuery<Sch>;

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

	@Get('/search')
	async searchGet(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const query = parseSearchQuery(req.queryStringParameters || {});
		return await this.search({ ...req, body: query }, res, ctx);
	}

}