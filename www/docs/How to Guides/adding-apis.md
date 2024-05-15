---
sidebar_position: 1
---

# Building Controllers with FW24

FW24 adheres to the Model-View-Controller (MVC) pattern and prioritizes convention over configuration. To create a controller in FW24, simply generate a file within .`/src/controllers/` and export a function named `handler`. This guide provides a comprehensive overview of how to create and configure controllers in FW24, from basic to advanced use cases, including entity controllers with CRUD APIs.

```ts
export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> {
    // Insert your code here
}
```  

## Advanced Controller

For more sophisticated functionality, you can create a class that extends `APIGatewayController`. This class can be decorated with the `@Controller()` decorator, and you can optionally pass additional configuration.

```ts
    import { Controller, APIGatewayController, Get} from '@ten24group/fw24';

    @Controller('demo')
    export class MyController extends APIGatewayController {

        @Get('/my-endpoint') // This maps to `demo/my-endpoint`
        private myEndpointHandler(req: Request, res: Response): Promise<Response>{
            return res.json(req);
        }
    }
    
    export const handler = MyController.CreateHandler(MyController);
```

## Controller Configuration

- `authorizer`: FW24 utilizes AWS Cognito for authentication and authorization. For more details, refer to the section on adding an authorizer.
- `resourceAccess`: FW24 automatically generates AWS policies, ensuring this controller has the necessary permissions to use these resources seamlessly.

```ts
    @Controller('demo', {
        authorizer: 'my-authorizer', // name of the authorizer 

        resourceAccess: {
            buckets: [ 'upload', 'import-lambda', 'import-queue' ],
            queues: [
                { name: 'my-queue', access: ['send'] },
            ],
            topics: [
                { name: 'my-topic', access: ['publish']}
            ]
        },
        functionTimeout: 30
    })
    export class MyController extends APIGatewayController {
        // ...
    }
```

## Entity Controllers

To create a controller for an entity with CRUD APIs, extend the `BaseEntityController`.

```ts
    import { Controller, BaseEntityController, defaultMetaContainer, Get } from '@ten24group/fw24';

    @Controller('my-entity')
    export class MyEntityController extends BaseEntityController<any> {

        constructor() {
            super('myEntity');
        }
        
        async initDI() {
            // register DI
            defaultMetaContainer.setEntityServiceByEntityName(
                'myEntity', // entity-name
                undefined,  // Instance of the entity service or a factory function returning an instance
            );
            return Promise.resolve();
        }

        @Get('/my-endpoint')
        private myEndpointHandler(req: Request, res: Response): Promise<Response>{
            const entityService = this.getEntityService();
            // Perform operations with entity service
            return res.json(req);
        }

        // CRUD endpoints are provided by the BaseEntityController out of the box.

    }
    
    export const handler = MyEntityController.CreateHandler(MyEntityController);
```
