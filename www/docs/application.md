---
sidebar_position: 2
---

# Application

This class represents an AWS CDK application. It allows the user to create a new CDK App instance and a main CDK Stack instance.

## Constructor

### Parameters

- `config` (optional): An object that implements the `IApplicationConfig` interface. This object is used to configure the application. If no `config` object is provided, an empty object is used.

### Details

- The constructor initializes the AWS CDK application by creating a new `App` instance.
- It also creates a new CDK Stack instance for the main stack using the provided `config` object.
- The constructor hydrates the `config` object with environment variables using the `Helper` class.
- It sets global variables `mainStack` using the `Reflect` class.

## Properties

- `app`: An instance of the CDK `App` class representing the application.
- `mainStack`: An instance of the CDK `Stack` class representing the main stack of the application.

## Methods

### `use(stack: any): Application`

This method is used to add a new stack to the application.

#### Parameters

- `stack`: An object representing the stack to be added to the application.

#### Returns

- An instance of the `Application` class with the new stack added.

#### Details

- The `use` method takes a stack object and calls its `construct` method passing in the `config` object.
- This method allows the user to add different stacks to the application and configure them as needed.

### example

```ts
import { APIConstruct, Application, DynamoDBConstruct } from "@ten24group/fw24";
import { AuthModule } from '@ten24group/fw24-auth-cognito';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';

const app = new Application({
    functionProps: {
        bundling: {
            externalModules: ['@aws-sdk'],
        },
    },
});

var api = new APIConstruct({
    apiOptions: {
        description: 'Sample App API Gateway',
        deployOptions: {
            stageName: 'v1',
        },
    },
    functionProps: {
        timeout: Duration.seconds(15),
    },
});

const dynamo = new DynamoDBConstruct({
    table: {
        name: 'users_tbl',
        props: {
            partitionKey: {
                name: 'pk',
                type: AttributeType.STRING,
            },
            sortKey: {
                name: 'sk',
                type: AttributeType.STRING,
            },
        },
    },
});

const authModule = new AuthModule({
    userPool: {
        props: {
            selfSignUpEnabled: true,
            removalPolicy: RemovalPolicy.DESTROY,
        }
    },
    groups: [
        {
            name: 'admin',
            routes: ['auth/addUserToGroup', 'auth/removeUserFromGroup'],
        },
        {
            name: 'user',
            autoUserSignup: true,
        },
    ],
    useAsDefaultAuthorizer: false
});

app.use(api)
.use(dynamo)
.useModule(authModule)
.run();

```

This sample app creates an API gateway, adds a dynamoDB table and add supports for Authentication for 2 user groups `admin` and `user` using the `AuthModule`.


### Backend DIR structure

FW24 prefers conventions over configurations and follows a very intuitive directory structure.

```text
├── README.md
├── cdk.json
├── docs -- CLI generated API docs
│   └── api
│       ├── postman-nb9fz6aah9.json
│       └── swagger-nb9fz6aah9.json
├── gen -- auto-generated configs used by the framework internally
│   └── config
│       ├── auth.json
│       ├── entities.json
│       └── menu.json
├── package-lock.json
├── package.json
├── src
│   ├── controllers
│   │   ├── book.ts
│   │   ├── helloworld.ts
│   │   └── test.ts
│   ├── db
│   │   └── myproject2.dynamo.client.ts
│   ├── entities
│   │   └── book.ts
│   ├── functions
│   │   └── bucket1handler.ts
│   ├── modules -- this is where your application specific modules live
│   ├── policies
│   │   └── mypolicy.ts
│   ├── queues
│   │   └── myqueue.ts
│   ├── services
│   │   └── book.ts
│   ├── tasks
│   │   └── mytask.ts
│   └── templates -- this's where your email templates live
│   ├── index.ts // this is where the application code lives
└── tsconfig.json
```

![Fw24 backend app DIR structure](<../assets/Screenshot 2024-05-17 at 9.49.19 PM.png>)
