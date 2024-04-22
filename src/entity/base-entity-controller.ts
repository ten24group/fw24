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

		return res.json({ __created__: createdEntity,  __req__: req });
	}

	@Get('/{id}')
	async find(req: Request, res: Response) {
        // prepare the identifiers
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);

		const entity = await this.getEntityService().get(identifiers);

		return res.json({ __entity__: entity,  __req__: req });
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
			...filters
		} = data;

		const pagination = {
			order: order ?? 'asc',
            cursor: cursor ?? null,
			
            count: safeParseInt(count, 12).value,
			limit: safeParseInt(limit, 250).value,

            pages:  pages === 'all' ? 'all' as const : safeParseInt(pages, 1).value,
        }

		const entities = await this.getEntityService().list({filters, pagination});

		return res.json(entities);
	}

	@Patch('/{id}')
	async update(req: Request, res: Response) {
        // prepare the identifiers
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);

		const updatedEntity = await this.getEntityService().update(identifiers, req.body);

		return res.json({ __updated__: updatedEntity,  __req__: req });
	}

	@Delete('/{id}')
	async delete(req: Request, res: Response) {
        // prepare the identifiers
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);

		const deletedEntity = await this.getEntityService().delete(identifiers);

		return res.json({ __deleted__: deletedEntity,  __req__: req });
	}

}