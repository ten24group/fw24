---
sidebar_position: 2
---

# Getting Started

Welcome to the `BucketConstruct` guide! `BucketConstruct` is a powerful tool from the FW24 that simplifies the process of setting up and managing AWS S3 buckets in your application. This guide will walk you through the process of importing, configuring, and using `BucketConstruct` in your project.

## Step 1: Importing

First things first, let's bring `BucketConstruct` into your project. You can do this by importing it from the FW24 package as shown below:

```ts
import { BucketConstruct } from '@ten24group/fw24';
```

## Step 2: Configuration

Now that `BucketConstruct` is part of your project, it's time to configure it to suit your needs. The configuration involves setting up `bucketName`, `removalPolicy`, `autoDeleteObjects`, `publicReadAccess`, `bucketProps`, `source`, and `triggers`:

```ts
  var bucket = new BucketConstruct({
    bucketName: 'my-bucket',
    removalPolicy: RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
    publicReadAccess: true,
    bucketProps: {
      encryption: BucketEncryption.KMS,
      versioned: true,
    },
    source: '/path/to/source',
    triggers: [
      {
        destination: 'lambda',
        events: [BucketEvent.OBJECT_CREATED],
        functionProps: {
          runtime: Runtime.NODEJS_12_X,
          handler: 'index.handler',
          entry: '/path/to/lambda_function',
        },
      },
    ],
  });
```

In this configuration:

- `bucketName` sets the name of the S3 bucket.
- `removalPolicy` sets the removal policy of the S3 bucket.
- `autoDeleteObjects` determines whether to automatically delete objects.
- `publicReadAccess` sets whether the bucket has public read access.
- `bucketProps` sets additional properties for the bucket, such as encryption and versioning.
- `source` specifies the path to the source directory that should be synced with the bucket.
- `triggers` sets up triggers that respond to bucket events.

Feel free to adjust these settings to match your application's requirements.

## Step 3: Usages

With BucketConstruct configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(bucket).run();
```
