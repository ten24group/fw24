---
sidebar_position: 1
---

# Building Controllers

FW24 adheres to the Model-View-Controller (MVC) pattern and prioritizes convention over configuration. To create a controller in FW24, simply generate a file within .`/src/controllers/` and export a function named `handler` and a route descriptor. This guide provides a comprehensive overview of how to create and configure controllers in FW24, from basic to advanced use cases, including entity controllers with CRUD APIs.

## Simple API handler

Whether you're experimenting or prefer to define your APIs individually, FW24 has the tools you need. To create an API handler, FW24 offers a factory function called `createApiHandler`. This function returns both a handler and a descriptor for your convenience.
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

## Queue Controllers and Webhooks

FW24 provides a powerful integration between API Gateway and SQS through the `QueueController` base class, primarily designed for implementing robust webhooks. This integration allows you to create webhook endpoints that can handle failures gracefully and support automatic retries through SQS.

### Creating a Webhook Controller

To create a webhook endpoint that uses SQS for message processing, you can use the `@Controller` decorator with the `target` option and define your queues using the `@Queue` decorator:

```ts
import { APIController, Controller, Post, Queue } from '@ten24group/fw24';

@Controller('webhook', {
    authorizer: 'NONE',
    target: ''  // Default target type
})
export class Webhook extends APIController {
    async initialize() {
        return Promise.resolve();
    }

    @Post('/mywebhook', {
        target: 'queue'  // This endpoint will integrate with SQS
    })
    myWebhook() {
        // The method can be empty as the request will be automatically
        // forwarded to SQS by API Gateway
    }

    @Post('/mytopic', {
        target: 'topic'  // This endpoint will integrate with SNS
    })
    myTopic() {
        // The method can be empty as the request will be automatically
        // forwarded to SNS by API Gateway
    }
}

export const handler = Webhook.CreateHandler(Webhook);
```

### How It Works

1. **API Gateway Integration**:
   - When a request hits your webhook endpoint, API Gateway automatically forwards it to an SQS queue
   - The integration is configured through the `target: 'queue'` option in the route decorator
   - No Lambda function is invoked for the initial request, making it highly efficient

2. **Message Processing**:
   - Messages in the queue are processed by a Lambda function using the `QueueController`
   - The controller handles batches of messages and provides retry capabilities
   - Failed messages can be automatically retried based on your SQS configuration

### Processing Webhook Messages

Create a queue processor to handle the webhook messages:

```ts
import { SQSEvent, Context } from "aws-lambda";
import { QueueController } from "@ten24group/fw24";

@Queue('mywebhook')  // Process messages from the 'myqueue1' queue
export class WebhookProcessor extends QueueController {
    async initialize(event: SQSEvent, context: Context): Promise<void> {
        // Set up any necessary resources for webhook processing
        return Promise.resolve();
    }

    async process(event: SQSEvent, context: Context): Promise<void> {
        for (const record of event.Records) {
            try {
                // The webhook payload is in the message body
                const webhookData = JSON.parse(record.body);
                await this.processWebhook(webhookData);
                
                this.logger.info("Webhook processed successfully", {
                    messageId: record.messageId
                });
            } catch (error) {
                this.logger.error("Webhook processing failed", {
                    messageId: record.messageId,
                    error: error.message
                });
                // The message will be retried based on your SQS configuration
                throw error;
            }
        }
    }

    private async processWebhook(webhookData: any): Promise<void> {
        // Implement your webhook processing logic here
    }
}
```

### Benefits of Queue-Based Webhooks

1. **Reliability**:
   - Automatic retries for failed webhook processing
   - Dead-letter queues (DLQ) for handling persistent failures
   - No data loss even if processing fails

2. **Scalability**:
   - Handle high volumes of webhook calls efficiently
   - API Gateway responds immediately while processing happens asynchronously
   - SQS automatically scales to handle incoming load

3. **Monitoring and Debugging**:
   - Built-in logging for webhook processing
   - CloudWatch metrics for queue length and processing failures
   - Message retention for troubleshooting

## Nested Controllers

FW24 supports nested controllers, allowing you to organize your API endpoints hierarchically. This is especially useful for grouping endpoints by application sections, such as `admin`, `public`, or role-based areas (e.g., `public`).

### Why Use Nested Controllers?
- **Separation of concerns:** Group related APIs by section (e.g., all admin APIs under `/admin`, public APIs under `/public`).
- **Role-based access:** Easily apply different authorization or middleware to different sections.
- **Cleaner structure:** Your codebase and API routes mirror each other, making maintenance easier.

#### Example Folder Structure

```
controllers/
  admin/
    user.ts
    system.ts
    book.ts
  public/
    user.ts
    book.ts
```

With this structure, all controllers in the `admin` folder will be grouped under the `/admin` API path, and those in `public` under `/public`.

### Key Implementation Detail: CRUDApiPath

When defining an entity that is managed by a nested controller, you **must specify the `CRUDApiPath`** in the entity schema to match the nested path. This ensures that FW24 generates the correct API Gateway routes with the folder name as a prefix.

#### Example Entity Schema

```ts
export const createUserSchema = () => createEntitySchema({
  model: {
    version: '1',
    entity: 'user',
    entityNamePlural: 'Users',
    entityOperations: DefaultEntityOperations,
    service: 'mainService',
    CRUDApiPath: '/admin', // Matches the folder/controller path
    // ...
  },
  // ...
});
```

### How FW24 Handles Routing
- FW24 automatically creates API Gateway routes with the folder name as a prefix (e.g., `/section1/resourceA`, `/section2/resourceA`).
- The generated OpenAPI docs and UI configs will reflect these nested paths.
- This works for both entity controllers and custom controllers.

### Example: Nested Controller for Admin Section

```ts
// controllers/admin/user.ts
import { Controller, BaseEntityController } from '@ten24group/fw24';

@Controller('user') // This will be available at /admin/user
export class AdminUserController extends BaseEntityController<UserSchemaType> {
  // ...
}
```
