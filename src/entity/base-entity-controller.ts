import { Schema } from 'electrodb';
import { APIGatewayController } from '../core/api-gateway-controller';
import { Request } from '../interfaces/request';
import { Response } from '../interfaces/response';
import { Get } from '../decorators/method';
import { BaseEntityService } from './base-service';
import { defaultMetaContainer } from './entity-metadata-container';
import { EntitySchema } from './base-entity';

export abstract class BaseEntityController<Sch extends EntitySchema<any, any, any>> extends APIGatewayController {

    private entityName: any;
    
    constructor(
        entityName: string
    ){
        super();
        this.entityName = entityName;
    }

    abstract initDI(): Promise<void>;

    // Note: it's not an ideal place to initialize the app state/ DI/ routes... etc and should be refactored to an Ideal component 
    async initialize(event: any, context: any) {

        await this.initDI();

        // TODO: rest of the init setup
		console.log(`BaseEntityController.initialize - done: ${event} ${context}`);

        return Promise.resolve();
    }

    // ** workaround to deal with base controller type def
    public getEntityService<S extends BaseEntityService<Sch>>(): S {
        return defaultMetaContainer.getEntityServiceByEntityName<S>(this.entityName);
    }

	// Simple string response
	@Get('/create')
	async create(req: Request, res: Response) {

		const data = req.queryStringParameters; 

		const createdEntity = await this.getEntityService().create(data);

		return res.json({ __created__: createdEntity,  __req__: req });
	}

	@Get('/get/{id}')
	async find(req: Request, res: Response) {
        // prepare the identifiers
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);

		const entity = await this.getEntityService().get(identifiers);

		return res.json({ __entity__: entity,  __req__: req });
	}

	@Get('/update/{id}')
	async update(req: Request, res: Response) {
        // prepare the identifiers
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);

		const data = req.queryStringParameters; 

		const updatedEntity = await this.getEntityService().update(identifiers, data);

		return res.json({ __updated__: updatedEntity,  __req__: req });
	}

	@Get('/delete/{id}')
	async delete(req: Request, res: Response) {
        // prepare the identifiers
        const identifiers = this.getEntityService()?.extractEntityIdentifiers(req.pathParameters);

		const deletedEntity = await this.getEntityService().delete(identifiers);

		return res.json({ __deleted__: deletedEntity,  __req__: req });
	}

	@Get('/list')
	async list(req: Request, res: Response) {
        const data = req.queryStringParameters; 

		const entities = await this.getEntityService().list(data);

		return res.json(entities);
	}

}