# APIGateway

The `APIGateway` class is responsible for setting up an API Gateway in AWS and registering controllers to handle different routes within the API.

## Dependencies
- `aws-cdk-lib/aws-apigateway`
- `aws-cdk-lib/aws-lambda-nodejs`
- `aws-cdk-lib/aws-lambda`
- `aws-cdk-lib/aws-sqs`
- `fs`
- `path`
- `../interfaces/apigateway`
- `../interfaces/config`
- `../interfaces/controller-descriptor`
- `../types/mutable`
- `aws-cdk-lib`
- `aws-cdk-lib/aws-dynamodb`
- `../core/helper`
- `../fw24`
- `aws-cdk-lib/aws-s3`

## Constructor

### Parameters
- `config` : `IAPIGatewayConfig` - Configuration object for the APIGateway

### Properties
- `methods`: `Map<string, Integration>` - A Map to store HTTP methods and their corresponding integrations
- `appConfig`: `IApplicationConfig | undefined` - Application configuration object
- `mainStack`: `Stack` - Reference to the main Stack in which the APIGateway is constructed
- `api`: `RestApi` - RestApi object representing the API Gateway
- `mailQueue`: `any` - Reference to the mail queue associated with the APIGateway

### Methods

### `construct(appConfig: IApplicationConfig)`

Construct method for setting up the APIGateway.

#### Parameters
- `appConfig` : `IApplicationConfig` - Application configuration object

#### Description
- Initializes the APIGateway with the provided `appConfig`.
- Validates the presence of controllers in the configuration.
- Configures CORS settings if specified.
- Creates a new RestApi instance.
- Registers controllers for handling different routes.

### `getCors()`

Private method for getting CORS settings based on the configuration.

### `getLayerARN()`

Private method for getting the ARN of the Lambda Layer.

### `getUniqueName(name: string)`

Method to generate a unique name based on given parameters.

### `registerController(controllerInfo: ControllerDescriptor)`

Method to register a controller with the APIGateway.

### `registerControllers()`

Async method to register all controllers specified in the configuration.

#### Description
- Resolves the absolute path to the controllers directory.
- Retrieves all TypeScript files in the controllers directory.
- Dynamically imports and instantiates controller classes.
- Registers routes for each controller.

## Class Structure
1. **Import Statements**
2. **Class Declaration**
    - **Properties**
    - **Constructor**
    - **Methods**
        - `construct(appConfig: IApplicationConfig)`
        - `getCors()`
        - `getLayerARN()`
        - `getUniqueName(name: string)`
        - `registerController(controllerInfo: ControllerDescriptor)`
        - `registerControllers()`

This class enables the configuration and setup of an API Gateway in AWS, along with the registration of controller classes to handle different routes within the API.