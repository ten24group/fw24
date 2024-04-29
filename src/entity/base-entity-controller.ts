import { Schema } from 'electrodb';
import { APIGatewayController } from '../core/api-gateway-controller';
import { Request } from '../interfaces/request';
import { Response } from '../interfaces/response';
import { Delete, Get, Patch, Post } from '../decorators/method';
import { BaseEntityService } from './base-service';
import { defaultMetaContainer } from './entity-metadata-container';
import { EntitySchema } from './base-entity';
import { createLogger } from '../logging';
import { safeParseInt } from '../utils/parse';
import { camelCase, isEmptyObject, isJsonString, isObject } from '../utils';

export abstract class BaseEntityController<Sch extends EntitySchema<any, any, any>> extends APIGatewayController {
	
	readonly logger = createLogger(BaseEntityController.name);

    constructor( protected readonly entityName: string){
        super();
        this.entityName = entityName;
    }

    abstract initDI(): Promise<void>;

    // Note: it's not an ideal place to initialize the app state/ DI/ routes... etc and should be refactored to an Ideal component 
    async initialize(event: any, context: any) {

        await this.initDI();

        // TODO: rest of the init setup
		
		this.logger.debug(`BaseEntityController.initialize - done: ${event} ${context}`);

        return Promise.resolve();
    }

    public getEntityService<S extends BaseEntityService<Sch>>(): S {
        return defaultMetaContainer.getEntityServiceByEntityName<S>(this.entityName);
    }

	// Simple string response
	@Post('')
	async create(req: Request, res: Response) {
		const createdEntity = await this.getEntityService().create(req.body);

		const result: any = {
			[ camelCase(this.entityName) ]: createdEntity,
			message: "Created successfully"
		};
		if(req.debugMode){
			result.req = req;
		}

		return res.json(result);
	}

	@Get('/{id}')
	async find(req: Request, res: Response) {
        // prepare the identifiers
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);

		const entity = await this.getEntityService().get(identifiers);

		const result: any = {
			[ camelCase(this.entityName) ]: entity,
		};

		if(req.debugMode){
			result.req = req;
			result.identifiers = identifiers
		}

		return res.json(result);
	}

	@Get('')
	async list(req: Request, res: Response) {
		// TODO: pagination + filter + search
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

		// TODO: parse filters
		const {filters = {}, ...restOfQueryParamsWithoutFilters} = restOfQueryParams;

		let parsedFilters = {};

		if( restOfQueryParamsWithoutFilters && !isEmptyObject(restOfQueryParamsWithoutFilters) ){
			// TODO: parse filters from url query string
			/* e.g {
					==> simple value without comparison opp
					pqr: 2322,  		
					
					==> simple value with comparison opp
					abc:neq:  234,  	

					==> complex values/paths
					abc.pqr.xyz:in: 123, 456,
					someDate:between: 12,45 | [12, 45]
				}
			*/
			this.logger.warn(`found not empty restOfQueryParamsWithoutFilters:`, restOfQueryParamsWithoutFilters);
		};

		if( !isObject(filters) ){

			this.logger.warn(`filters is not an object: need to parse the filters query string`, filters);
			
			if(isJsonString(filters)){
				
				this.logger.info(`found JSON string filters parsing`, filters);
				parsedFilters =  JSON.parse(filters);

			}  else {

				// TODO: parse filters query string like 
				//
				// `abc=123 AND ( pqr != 456 OR xyz contains 'qwe rty yui')`
				//
				this.logger.warn(`filters is not an object: need to parse the filters query string`, filters);
			}
		} else {
			this.logger.info(`filters is a parsed object`, filters);
			parsedFilters = filters;
		}

		const pagination = {
			order: order ?? 'asc',
            cursor: cursor ?? null,
			
			// TODO: make the default-values configurable
            count: safeParseInt(count, 12).value,
			limit: safeParseInt(limit, 250).value,

            pages:  pages === 'all' ? 'all' as const : safeParseInt(pages, 1).value,
        }

		this.logger.info(`parsed pagination`, pagination);


		const {data: records, cursor: newCursor} = await this.getEntityService().list({
			filters: parsedFilters,
			pagination
		});

		const result: any = {
			cursor: newCursor,
			items: records,
		};

		if(req.debugMode){
			result.req = req;
			result.pagination = pagination;
			result.filters = filters;
		}

		return res.json(result);

	}

	@Patch('/{id}')
	async update(req: Request, res: Response) {
        // prepare the identifiers
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);

		const updatedEntity = await this.getEntityService().update(identifiers, req.body);

		const result: any = {
			[ camelCase(this.entityName) ]: updatedEntity,
			message: "Updated successfully"
		};
		if(req.debugMode){
			result.req = req;
			result.identifiers = identifiers
		}

		return res.json(result);
	}

	@Delete('/{id}')
	async delete(req: Request, res: Response) {
        // prepare the identifiers
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);

		const deletedEntity = await this.getEntityService().delete(identifiers);

		const result: any = {
			[ camelCase(this.entityName) ]: deletedEntity,
			message: "Deleted successfully"
		};

		if(req.debugMode){
			result.req = req;
		}

		return res.json(result);
	}

	@Post('/query')
	async query(req: Request, res: Response) {
        const query = req.body;
		this.logger.info(`query - query:`, query);

		const {data: records, cursor: newCursor} = await this.getEntityService().query(query);

		const result: any = {
			cursor: newCursor,
			items: records,
		};

		if(req.debugMode){
			result.req = req;
			result.query = query;
		}

		return res.json(result);
	}

}