---
sidebar_position: 1
---

# Building Controllers with FW24

FW24 adheres to the Model-View-Controller (MVC) pattern and prioritizes convention over configuration. To create a controller in FW24, simply generate a file within .`/src/controllers/` and export a function named `handler` and a route descriptor. This guide provides a comprehensive overview of how to create and configure controllers in FW24, from basic to advanced use cases, including entity controllers with CRUD APIs.

## Simple API handler

Whether you are trying things out or you like to define your APIs individually we have got you covered. To create an API handler FW24 provides you a factory function `createApiHandler` which will return a handler and a descriptor;
> both `handler` and the descriptor need to be exported.

```ts
import { Get, createApiHandler } from '@ten24group/fw24';

export const { handler, descriptor } = createApiHandler(
    { method: Get, name: 'demo' },
    async ( event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
        return Promise.resolve({
            statusCode: 200,
            body: JSON.stringify({ message: "Hello World!"})
        })
    }
)
```  

## Class based Controller

For more options, you can create a class decorated with the `@Controller('endpoint')` decorator, and you can optionally pass additional configuration. Fw24 also provides an abstract base class `APIController` with additional functionality.

### using `@Controller()` decorator

```ts
@Controller('demo', {authorizer: 'NONE'})
export class Demo{
    @Get('')
    async handler(event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> {
        return Promise.resolve({
            statusCode: 200,
            body: JSON.stringify({
                message: "Hello World! from demo ctrl",
            })
        })
    }
}

export const handler = new Demo2().handler;

```

### Extending `APIController`

APIController provides additional functionality like parsed `request` and `response` classes for handler-functions; option to run `init-logic` at the start of every request, like `middlewares` see `initialize` function below. And option to override/provide custom error messages for validations by overriding `getOverriddenHttpRequestValidationErrorMessages` function (se validations section for more details).

```ts
    import { Controller, APIController, Get} from '@ten24group/fw24';

    @Controller('demo')
    export class MyController extends APIController {

        initialize(event: APIGatewayEvent, context: Context): Promise<void> {

            // your custom init logic here

            return Promise.resolve();
        }

        @Get('/my-endpoint') // This maps to `demo/my-endpoint`
        private myEndpointHandler(req: Request, res: Response): Promise<Response>{
            return res.json(req);
        }
    }
    
    export const handler = MyController.CreateHandler(MyController);
```

## Controller Configuration

- `authorizer`: FW24 utilizes AWS Cognito for authentication and authorization. For more details, refer to the section on adding an authorizer.
  > authorizer relies on the the `Auth-Module`.
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
    export class MyController extends APIController {
        // ...
    }
```

## Entity Controllers

To create a controller for an entity with CRUD APIs, you should extend the `BaseEntityController`. The `BaseEntityController` is a subclass of `ApiController` and inherits all its functionalities, including the ability to override validation error messages.

The `BaseEntityController` also introduces an abstract function `initDI` that you must implement in your subclass. This function is used to register your dependencies into a container. The framework does not enforce a specific Dependency Injection (DI) system and instead uses a `Map`-based container named `defaultMetaContainer` for entity services. This container supports registering and retrieving a service for an entity.

If you prefer to use a different DI library, you can do so. To integrate your DI system, you'll need to override the `getEntityService` function in your entity controller. This function should return an instance of the entity service from your DI container.

Here's an example of how to create a controller for an entity named 'myEntity':

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

        // You can override this function the return the entity service from your DI-container
        getEntityService<S extends BaseEntityService<Sch>>(): S {
            return defaultMetaContainer.setEntityServiceByEntityName('myEntity');
        }

        @Get('/my-endpoint')
        private myEndpointHandler(req: Request, res: Response): Promise<Response>{
            const entityService = this.getEntityService();
            // Perform operations with the entity service
            return res.json(req);
        }

        // CRUD endpoints are provided by the `BaseEntityController` out of the box.
    }
    
    export const handler = MyEntityController.CreateHandler(MyEntityController);
```

### BaseEntityController API Endpoints

The `BaseEntityController` provides a set of pre-defined API endpoints for performing CRUD operations on an entity.

#### Endpoints

- `GET /:entity/:id` - to get an entity by it's Identifiers.
- `POST /:entity` - to create a new entity.
- `PUT /:entity/:id` - to update a specific entity by its Identifiers.
- `DELETE /:entity/:id` - to delete a specific entity by its Identifiers.
- `GET /:entity`  - to retrieve a list of entities, supports pagination, filtering and term-search.
- `POST /:entity/query` - to fetch a list of entity using advance filters; supports pagination, term-search.
