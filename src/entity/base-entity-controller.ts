import type { Request, Response } from '../interfaces';
import type { EntityIdentifiersTypeFromSchema, EntitySchema } from './base-entity';
import type { BaseEntityService } from './base-service';
import type { EntityFilterCriteria } from './query-types';

import { randomUUID } from 'crypto';
import { getSignedUrlForFileUpload } from '../client/s3';
import { Environment } from '../client/util';
import { ENV_KEYS } from '../const';
import { APIController } from '../core/runtime/api-gateway-controller';
import { ExecutionContext } from '../core/types/execution-context';
import { Delete, Get, Patch, Post } from '../decorators/method';
import { NotFoundError } from '../errors';
import { createErrorHandler } from '../errors/handlers';
import { EntitySearchQuery, parseSearchQuery } from '../search';
import { camelCase, deepCopy, isEmptyObject, isJsonString, isObject, isString, merge, resolveEnvValueFor, toSlug, sanitizeRequestForDebug } from '../utils';
import { safeParseInt } from '../utils/parse';
import { parseUrlQueryStringParameters, queryStringParamsToFilterGroup } from './query';
import { EntityOperationConfig } from './base-entity';

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

		// Dynamically configure routes based on entity metadata
		this.initializeMetadataRoutes();
	}

	/**
	 * Synchronizes controller routes with entity operation metadata.
	 * Allows enabling/disabling OOB operations and registering custom ones.
	 */
	protected initializeMetadataRoutes() {
		if (!this.entityService) return;

		const ops = this.entityService.getOperationsConfig();
		const currentRoutes = { ...(this as any).routes || {} };
		const newRoutes: Record<string, any> = {};

		// 1. Filter existing OOB routes based on enabled state
		for (const [ routeKey, route ] of Object.entries(currentRoutes)) {
			const opName = this.mapRouteToOperation(route as any);
			if (opName && ops[ opName ] && ops[ opName ].enabled === false) {
				this.logger.debug(`Disabling OOB route "${routeKey}" for operation "${opName}"`);
				continue;
			}
			newRoutes[ routeKey ] = route;
		}

		// 2. Register custom operations that don't have explicit methods
		for (const [ opName, config ] of Object.entries(ops)) {
			if (config.enabled && !this.isStandardOperation(opName)) {
				this.registerCustomOperationRoute(opName, config, newRoutes);
			}
		}

		(this as any).routes = newRoutes;
	}

	private isStandardOperation(opName: string): boolean {
		return [ 'get', 'list', 'query', 'search', 'create', 'update', 'delete', 'duplicate', 'upsert', 'batchDelete', 'deleteByQuery', 'geoSearch', 'getAncestors', 'getDescendants', 'attach', 'detach' ].includes(opName);
	}

	private mapRouteToOperation(route: { functionName: string }): string | undefined {
		const mapping: Record<string, string> = {
			'create': 'create',
			'find': 'get',
			'list': 'list',
			'update': 'update',
			'delete': 'delete',
			'query': 'query',
			'search': 'search',
			'duplicate': 'duplicate',
			'upsert': 'upsert',
			'batchDelete': 'batchDelete',
			'deleteByQuery': 'deleteByQuery',
			'geoSearch': 'geoSearch',
			'getAncestors': 'getAncestors',
			'getDescendants': 'getDescendants',
			'attach': 'attach',
			'detach': 'detach'
		};
		return mapping[ route.functionName ];
	}

	private registerCustomOperationRoute(opName: string, config: EntityOperationConfig, routes: Record<string, any>) {
		const method = config.method || 'POST';
		let path = config.path || `/${opName}`;
		if (config.requiresId && !path.includes('{id}')) {
			path = `/{id}${path.startsWith('/') ? '' : '/'}${path}`;
		}

		const routeKey = `${method}|${path}`;
		if (routes[ routeKey ]) {
			this.logger.warn(`Custom operation "${opName}" conflicts with existing route "${routeKey}". Skipping.`);
			return;
		}

		this.logger.debug(`Registering dynamic route for custom operation "${opName}": ${routeKey}`);

		const parameters: string[] = [];
		path.split('/').forEach((param) => {
			if (param.startsWith('{') && param.endsWith('}')) {
				parameters.push(param.slice(1, -1));
			}
		});

		routes[ routeKey ] = {
			path,
			httpMethod: method,
			functionName: 'handleDynamicOperation',
			parameters,
			// Custom property to store the operation name
			entityOperation: opName,
			authorizer: config.authorizer,
			validations: config.validations
		};
	}

	/**
	 * Generic handler for dynamically registered custom operations.
	 */
	async handleDynamicOperation(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const requestContext = req as any;
		// Try to get opName from the matched route metadata
		let opName = requestContext.route?.entityOperation;

		if (!opName) {
			// Fallback: search for a route that matches the current request
			const matchingRoute = this.findMatchingRoute(req);
			opName = (matchingRoute as any)?.entityOperation;
		}

		if (!opName) {
			// Second Fallback: derive from path
			const pathParts = req.path.split('/');
			opName = pathParts[ pathParts.length - 1 ];
		}

		this.logger.debug(`Handling dynamic operation "${opName}"`);

		// Collect all inputs: body, path params, query params
		const payload = {
			...(req.body || {}),
			...(req.pathParameters || {}),
			...(req.queryStringParameters || {})
		};

		const result = await this.getEntityService().executeOperation(opName, payload, ctx);
		return res.json(result);
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
		const createdEntity = await this.getEntityService().executeOperation('create', req.body, ctx);

		const result: Record<string, any> = {
			[ camelCase(this.getEntityName()) ]: createdEntity,
			message: "Created successfully"
		};
		if (req.debugMode) {
			result.request = sanitizeRequestForDebug(req);
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

		// try resolving actual bucket name from simple name like "files-bucket" to "files-bucket-123"	
		// if not found, use the provided bucket name directly
		const resolvedBucketName = Environment.bucketName(bucketName);

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
			bucketName: resolvedBucketName,
			contentType,
			customDomain: resolveEnvValueFor({ key: ENV_KEYS.FILES_BUCKET_CUSTOM_DOMAIN_ENV_KEY, defaultValue: '' })
		};

		// this.logger.debug(`getSignedUrlForFileUpload::`, options);

		const signedUploadURL = await getSignedUrlForFileUpload(options);

		const response: Record<string, any> = {
			fileName,
			expiresIn,
			contentType,
			signedUploadURL,
		};

		if (req.debugMode) {
			response[ 'bucketName' ] = resolvedBucketName;
		}

		return res.json(response);
	}

	@Get('/duplicate/{id}')
	async duplicate(req: Request, res: Response, ctx?: ExecutionContext) {
		const service = this.getEntityService();

		const identifiers = service.extractEntityIdentifiers(req.pathParameters) as EntityIdentifiersTypeFromSchema<Sch>;

		const duplicateEntity = await service.executeOperation('duplicate', identifiers, ctx);

		const result: Record<string, any> = {
			[ camelCase(this.getEntityName()) ]: duplicateEntity,
		};

		if (req.debugMode) {
			result.identifiers = identifiers;
			result.request = sanitizeRequestForDebug(req);
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

		const entity = await this.getEntityService().executeOperation('get', { identifiers, attributes }, ctx);

		if (!entity) {
			throw new NotFoundError(this.getEntityName(), undefined, req);
		}

		const result: Record<string, any> = {
			[ camelCase(this.getEntityName()) ]: entity,
		};

		if (req.debugMode) {
			result.identifiers = identifiers;
			result.request = sanitizeRequestForDebug(req);
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

		const { data: records, cursor: newCursor, query: parsedQuery } = await this.getEntityService().executeOperation('list', query, ctx);

		const result: Record<string, any> = {
			cursor: newCursor,
			items: records,
		};

		if (req.debugMode) {
			result.criteria = {
				pagination,
				filters,
				parsedFilters,
				restOfQueryParamsWithoutFilters,
				parsedQuery
			};
			result.request = sanitizeRequestForDebug(req);
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
		const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters) as EntityIdentifiersTypeFromSchema<Sch>;

		const entity = await this.getEntityService().executeOperation('get', { identifiers }, ctx);

		if (!entity) {
			throw new NotFoundError(this.getEntityName(), undefined, req);
		}

		const updatedEntity = await this.getEntityService().executeOperation('update', { identifiers, data: deepCopy(req.body) } as any, ctx);

		this.logger.debug(`Update result for ${this.getEntityName()}:`, { updatedEntity });

		const result: Record<string, any> = {
			[ camelCase(this.getEntityName()) ]: updatedEntity,
			message: "Updated successfully"
		};
		if (req.debugMode) {
			result.identifiers = identifiers;
			result.request = sanitizeRequestForDebug(req);
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
		const entity = await this.getEntityService().executeOperation('get', { identifiers }, ctx);

		if (!entity) {
			throw new NotFoundError(this.getEntityName(), undefined, req);
		}

		const deletedEntity = await this.getEntityService().executeOperation('delete', identifiers, ctx);

		const result: Record<string, any> = {
			[ camelCase(this.getEntityName()) ]: deletedEntity,
			message: "Deleted successfully"
		};

		if (req.debugMode) {
			result.request = sanitizeRequestForDebug(req);
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

		const result = await this.getEntityService().executeOperation('batchDelete', { ids, concurrent }, ctx);

		const unprocessedCount = (result as Record<string, any>)?.unprocessed?.length || 0;
		const identifiersCount = ids.length;
		const deletedCount = identifiersCount - unprocessedCount;

		const response: Record<string, any> = {
			deletedCount,
			unprocessedCount: unprocessedCount,
			message: `Successfully deleted ${deletedCount} ${this.getEntityName()} record(s)`
		};

		if (unprocessedCount > 0) {
			response.unprocessed = (result as Record<string, any>)?.unprocessed || [];
			response.message += `, ${unprocessedCount} failed`;
		}

		if (req.debugMode) {
			response.request = sanitizeRequestForDebug(req);
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
			const previewResult = await this.getEntityService().executeOperation('query', {
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

		const result = await this.getEntityService().executeOperation('deleteByQuery', {
			filters,
			batchSize,
			concurrent,
			maxItems
		}, ctx);

		const response: Record<string, any> = {
			...result,
			message: `Successfully deleted ${result.deletedCount} ${this.getEntityName()} record(s)`
		};

		if (result.failedCount > 0) {
			response.message += `, ${result.failedCount} failed`;
		}

		if (req.debugMode) {
			response.request = sanitizeRequestForDebug(req);
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

		const { data: records, cursor: newCursor, query: parsedQuery } = await this.getEntityService().executeOperation('query', query, ctx);

		const result: Record<string, any> = {
			cursor: newCursor,
			items: records,
		};

		if (req.debugMode) {
			result.criteria = {
				inputQuery,
				parsedQuery
			};
			result.request = sanitizeRequestForDebug(req);
		}

		return res.json(result);
	}

	@Post('/search')
	async search(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const query = req.body;

		const inputQuery = deepCopy(query) as EntitySearchQuery<Sch>;

		const results = await this.getEntityService().executeOperation('search', query, ctx);

		const { hits, ...rest } = results;
		const response = {
			...rest,
			items: hits,
		};

		if (req.debugMode) {
			Object.assign(response, {
				inputQuery,
				processingTimeMs: results.processingTimeMs,
				request: sanitizeRequestForDebug(req)
			});
		}

		return res.json(response);
	}

	@Get('/search')
	async searchGet(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const query = parseSearchQuery(req.queryStringParameters || {});
		return await this.search({ ...req, body: query }, res, ctx);
	}

	@Post('/geo-search')
	async geoSearch(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const result = await this.getEntityService().executeOperation('geoSearch', req.body, ctx);
		return res.json(result);
	}

	@Get('/{id}/ancestors')
	async getAncestors(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const identifiers = this.getEntityService().extractEntityIdentifiers(req.pathParameters);
		const result = await this.getEntityService().executeOperation('getAncestors', identifiers, ctx);
		return res.json(result);
	}

	@Get('/{id}/descendants')
	async getDescendants(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const identifiers = this.getEntityService().extractEntityIdentifiers(req.pathParameters);
		const result = await this.getEntityService().executeOperation('getDescendants', identifiers, ctx);
		return res.json(result);
	}

	@Post('/{id}/attach')
	async attach(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const identifiers = this.getEntityService().extractEntityIdentifiers(req.pathParameters);
		const payload = { ...req.body, id: identifiers };
		const result = await this.getEntityService().executeOperation('attach', payload, ctx);
		return res.json(result);
	}

	@Post('/{id}/detach')
	async detach(req: Request, res: Response, ctx?: ExecutionContext): Promise<Response> {
		const identifiers = this.getEntityService().extractEntityIdentifiers(req.pathParameters);
		const payload = { ...req.body, id: identifiers };
		const result = await this.getEntityService().executeOperation('detach', payload, ctx);
		return res.json(result);
	}

}