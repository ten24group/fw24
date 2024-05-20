---
sidebar_position: 2
---

# Getting Started

Welcome to the `QueueConstruct` guide! `QueueConstruct` is a powerful tool from the FW24 package that simplifies the process of creating and managing `AWS Simple Queue Service (SQS)` queues in your application. This guide will walk you through the process of importing, configuring, and using `QueueConstruct` in your project.

## Step 1: Importing

First things first, let's bring `QueueConstruct` into your project. You can do this by importing it from the FW24 package as shown below:

```ts
import { QueueConstruct } from '@ten24group/fw24';
```

## Step 2: Configuration

Now that `QueueConstruct` is part of your project, it's time to configure it to suit your needs. The configuration involves setting up `queuesDirectory`, env, `queueProps`, and `functionProps`:

```ts
  var queue = new QueueConstruct({
    queuesDirectory: '/path/to/queues',
    env: {
      name: 'my-env',
      prefix: 'my-prefix',
    },
    queueProps: {
      fifo: true,
      contentBasedDeduplication: true,
    },
    functionProps: {
      memorySize: 128,
      timeout: cdk.Duration.seconds(60),
    },
  });
```

In this configuration:

- `queuesDirectory` sets the directory path where the queue's code resides. It's where AWS SQS expects to find your queue code.
- `env` sets the environment variables for the queue. You can specify the name and prefix of the environment variables here.
- `queueProps` sets the properties for the SQS queue, such as `fifo` and `contentBasedDeduplication`. These properties allow you to specify the behavior of your queue.
- `functionProps` sets the properties for the Lambda function that will process the messages from the queue, such as `memorySize` and `timeout`. These properties allow you to specify the behavior of your Lambda function.

Feel free to adjust these settings to match your application's requirements.

## Step 3: Usages

With `QueueConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(queue).run();
```

This will add the configured queue to your application. You can now manage SQS queues in your AWS applications using the `QueueConstruct`.
