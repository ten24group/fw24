---
sidebar_position: 2
---

# Getting Started

`APIConstruct` is a powerful tool from the FW24 that simplifies the process of setting up and managing an API Gateway in AWS. This guide will walk you through the process of importing, configuring, and using `APIConstruct` in your project.

## Step 1: Importing

First things first, let's bring `APIConstruct` into your project. You can do this by importing it from the FW24 as shown below:

```ts
import { APIConstruct } from '@ten24group/fw24';
```

### Step 2: Configuration

Now that `APIConstruct` is part of your project, it's time to configure it to suit your needs. The configuration involves setting up `apiOptions`, `functionProps`, and other options:

```ts
  var api = new APIConstruct({
    apiOptions: {
      description: 'Sandbox App API Gateway',
      deployOptions: {
        stageName: 'v1',
      },
    },
    controllersDirectory: './controllers',
    functionProps: {
        timeout: Duration.seconds(15),
    },
    logRetentionDays: RetentionDays.ONE_WEEK,
    logRemovalPolicy: RemovalPolicy.DESTROY,
  });
```

In this configuration:

- `cors` enables CORS for the API.
- `apiOptions` sets the description of the API Gateway and specifies the deployment stage.
- `controllersDirectory` specifies the directory where the controllers are located.
- `functionProps` sets a timeout for the AWS Lambda function.
- `logRetentionDays` specifies the number of days to retain the API logs.
- `logRemovalPolicy` specifies the removal policy for the API logs.

Feel free to adjust these settings to match your application's requirements.

## Step 3: Usages

With `APIConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(api).run();
```
