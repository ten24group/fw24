import type { Request, Response } from '../interfaces';
import type { EntitySchema, EntityIdentifiersTypeFromSchema } from './base-entity';
import type { BaseEntityService } from './base-service';
import type { EntityFilterCriteria } from './query-types';

import { APIController } from '../core/runtime/api-gateway-controller';
import { Delete, Get, Patch, Post } from '../decorators/method';
import { createLogger } from '../logging';
import { safeParseInt } from '../utils/parse';
import { camelCase, deepCopy, isEmptyObject, isJsonString, isObject, isString, merge, resolveEnvValueFor, toSlug } from '../utils';
import { parseUrlQueryStringParameters, queryStringParamsToFilterGroup } from './query';
import { randomUUID } from 'crypto';
import { getSignedUrlForFileUpload } from '../client/s3';
import { ENV_KEYS } from '../const';

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

	readonly logger = createLogger(BaseEntityController.name);

	/**
	 * Creates an instance of BaseEntityController.
	 * @param {string} entityName - The name of the entity.
	 */
	constructor(protected readonly entityName: string, protected readonly entityService: BaseEntityService<Sch>) {
		super();
		this.entityName = entityName;
	}

	/**
	 * Initializes the entity controller.
	 * Note: It's not an ideal place to initialize the app state/DI/routes, and should be refactored to an ideal component.
	 * @param {any} event - The event object.
	 * @param {any} context - The context object.
	 * @returns {Promise<void>} A promise that resolves when the initialization is complete.
	 */
	async initialize(event: any, context: any): Promise<void> {
		this.logger.debug(`BaseEntityController.initialize - done: ${event} ${context}`);
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
	async create(req: Request, res: Response): Promise<Response> {
		const createdEntity = await this.getEntityService().create(req.body);

		const result: any = {
			[ camelCase(this.entityName) ]: createdEntity,
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
	async getSignedUrlForFileUpload(req: Request, res: Response) {

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
			customDomain: resolveEnvValueFor({ key: ENV_KEYS.FILES_BUCKET_CUSTOM_DOMAIN_ENV_KEY }) ?? ''
		};

		this.logger.info(`getSignedUrlForFileUpload::`, options);

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
	async duplicate(req: Request, res: Response) {
		const service = this.getEntityService();

		const identifiers = service.extractEntityIdentifiers(req.pathParameters) as EntityIdentifiersTypeFromSchema<Sch>;

		const duplicateEntity = await service.duplicate(identifiers);

		const result: any = {
			[ camelCase(this.entityName) ]: duplicateEntity,
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
	async find(req: Request, res: Response): Promise<Response> {
		// prepare the identifiers
		const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);
		const selections = req.queryStringParameters?.attributes?.split?.(',');

		const entity = await this.getEntityService().get({ identifiers, selections });

		const result: any = {
			[ camelCase(this.entityName) ]: entity,
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
	async list(req: Request, res: Response): Promise<Response> {
		const data = req.queryStringParameters;
		this.logger.info(`list - data:`, data);

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
			this.logger.warn(`filters is not an object: need to parse the filters query string`, filters);

			if (isJsonString(filters)) {
				this.logger.info(`found JSON string filters parsing`, filters);
				parsedFilters = JSON.parse(filters);
			} else {
				// TODO: parse filters query string
				this.logger.warn(`filters is not an object: need to parse the filters query string`, filters);
			}
		} else {
			this.logger.info(`filters is a parsed object`, filters);
			parsedFilters = filters;
		}

		if (restOfQueryParamsWithoutFilters && !isEmptyObject(restOfQueryParamsWithoutFilters)) {
			this.logger.info(`found not empty restOfQueryParamsWithoutFilters:`, restOfQueryParamsWithoutFilters);

			const parsedQueryParams = parseUrlQueryStringParameters(restOfQueryParamsWithoutFilters);
			this.logger.info(`parsed restOfQueryParamsWithoutFilters:`, parsedQueryParams);

			const parsedQueryParamFilters = queryStringParamsToFilterGroup(parsedQueryParams);
			this.logger.info(`filters from restOfQueryParamsWithoutFilters:`, parsedQueryParamFilters);

			parsedFilters = merge([ parsedFilters, parsedQueryParamFilters ]) ?? {};
		}

		const pagination = {
			order: order ?? 'asc',
			cursor: cursor ?? null,
			count: safeParseInt(count, 12).value,
			limit: safeParseInt(limit, 250).value,
			pages: pages === 'all' ? 'all' as const : safeParseInt(pages, 1).value,
		}

		this.logger.info(`parsed pagination`, pagination);

		const query = {
			filters: deepCopy(parsedFilters) as EntityFilterCriteria<Sch>,
			attributes: attributes?.split?.(','),
			pagination,
			search,
			searchAttributes
		};

		const { data: records, cursor: newCursor, query: parsedQuery } = await this.getEntityService().list(query);

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
	async update(req: Request, res: Response): Promise<Response> {
		// prepare the identifiers
		const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);

		const updatedEntity = await this.getEntityService().update(identifiers as any, req.body);

		const result: any = {
			[ camelCase(this.entityName) ]: updatedEntity,
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
	async delete(req: Request, res: Response): Promise<Response> {
		// prepare the identifiers
		const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);

		const deletedEntity = await this.getEntityService().delete(identifiers);

		const result: any = {
			[ camelCase(this.entityName) ]: deletedEntity,
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
	@Post('/query')
	async query(req: Request, res: Response): Promise<Response> {
		const query = req.body;
		this.logger.info(`query - query:`, query);

		const inputQuery = deepCopy(query);

		const { data: records, cursor: newCursor, query: parsedQuery } = await this.getEntityService().query(query);

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

}