# Documentation for ses.ts

# SESStack Documentation

The `SESStack` class is responsible for setting up an AWS CDK stack that includes resources related to Simple Email Service (SES) in Amazon Web Services.

## Dependencies

- aws-cdk-lib
- aws-cdk-lib/aws-ses
- aws-cdk-lib/aws-sqs
- aws-cdk-lib/aws-lambda-nodejs
- aws-cdk-lib/aws-lambda
- aws-cdk-lib/aws-lambda-event-sources
- aws-cdk-lib/aws-iam

## Constructor

### Parameters
- `config`: ISESConfig - Configuration object for SES

### Constructor Description
- Constructs an instance of `SESStack` with the provided `config`.
- Initializes the configuration and calls `Helper.hydrateConfig()` with the `config` object.

## Methods

### construct()

### Parameters
- `appConfig`: IApplicationConfig - Application configuration object

### Method Description
- Constructs the SES stack with the provided `appConfig`.
- Creates an email identity using the `config.domain` property from the constructor.
- Creates a main queue using `createQueue()` method.
- Sets the `mailQueue` in the global context.
- Creates a CloudFormation Output for the mail queue URL.

### createQueue()

#### Return
- Queue - AWS SQS Queue object

#### Method Description
- Creates a queue to receive messages for sending emails.
- Creates a Lambda function to process the main queue using `createLambdaFunction()`.
- Adds an event source to the Lambda function with specified batch settings.
- Returns the created queue.

### createLambdaFunction()

#### Return
- NodejsFunction - AWS Lambda NodejsFunction object

#### Method Description
- Creates a Lambda function to process the queue.
- Specifies the entry file path, handler function, runtime, and architecture for the Lambda function.
- Adds a policy statement to the Lambda function role allowing it to send emails.
- Returns the created Lambda function.

## Properties

- `appConfig`: IApplicationConfig | undefined - Application configuration object.
- `mainStack`: Stack - AWS CDK Stack object for the main stack.

## Usage

```typescript
const sesConfig: ISESConfig = {
    domain: 'example.com'
};

const appConfig: IApplicationConfig = {
    name: 'MyApp',
    mailQueueName: 'MyMailQueue'
};

const sesStack = new SESStack(sesConfig);
sesStack.construct(appConfig);
```

This documentation outlines the structure and functionality of the `SESStack` class for setting up SES-related resources in AWS CDK.