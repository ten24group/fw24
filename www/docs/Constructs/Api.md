# APIConstruct

## Introduction

APIConstruct is a robust, feature-packed construct designed for FW24, built on the AWS-CDK framework. It is meticulously crafted to seamlessly integrate an API Gateway into your FW24 application, which operates on a serverless architecture.

The primary role of APIConstruct is to establish an API Gateway. However, its capabilities extend far beyond this fundamental function. It takes on the responsibility of setting up routes, authorizers, and policies, as well as orchestrating AWS Lambda functions.

APIConstruct's responsibilities don't end there. It also manages the permissions and environment settings for these Lambdas. This means that with APIConstruct, you are relieved from the intricate details of setting up and managing your API Gateway and its associated components. APIConstruct takes care of these complexities, allowing you to concentrate on what matters most - building your application.

APIConstruct leverages the `IAPIConstructConfig` interface to configure the API construct. This interface, defined in the `api.ts` file, includes options for specifying the CORS configuration for the API, additional options for the API, the directory where the controllers are located, the properties for the Node.js function, the number of days to retain the API logs, and the removal policy for the API logs.

By providing a configuration object that adheres to the `IAPIConstructConfig` interface, you can effortlessly customize the behavior of the API construct to align with your specific needs.

In conclusion, APIConstruct is a comprehensive construct that simplifies the process of setting up and managing an API Gateway in AWS. Whether you're building a small application with a few routes or a large application with complex routing and authorization needs, APIConstruct is equipped to handle it all.

## Getting Started

`APIConstruct` is a powerful tool from the FW24 that simplifies the process of setting up and managing an API Gateway in AWS. This guide will walk you through the process of importing, configuring, and using `APIConstruct` in your project.

### Step 1: Importing

First things first, let's bring `APIConstruct` into your project. You can do this by importing it from the FW24 as shown below:

```ts
import { APIConstruct } from '@ten24group/fw24';
```

### Step 2: Configuration

With `APIConstruct` now part of your project, the next step is to customize it to fit your specific needs. This involves configuring `apiOptions`, `controllersDirectory`, `functionProps`, `logRetentionDays`, and logRemovalPolicy:

```ts
  var api = new APIConstruct({
    cors: true,
    apiOptions: {
      description: 'Sandbox App API Gateway',
      deployOptions: {
        stageName: 'v1',
      },
    },
    controllersDirectory: './controllers',
    functionProps: {},
    logRetentionDays: RetentionDays.ONE_WEEK,
    logRemovalPolicy: RemovalPolicy.DESTROY,
  });
```

In this configuration:

- `cors` enables CORS for the API.
- `apiOptions` sets API Gateway and config like the deployment stage.
- `controllersDirectory` specifies the directory where the controllers are located.
- `functionProps` sets the configurations for controller lambda function, these can be overridden at the controller level.
- `logRetentionDays` specifies the number of days to retain the API logs.
- `logRemovalPolicy` specifies the removal policy for the API logs.

Feel free to adjust these settings to match your application's requirements.

### Step 3: Usages

With `APIConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(api).run();
```
