---
sidebar_position: 2
---

# Getting Started

Welcome to the `DynamoDBConstruct` guide! `DynamoDBConstruct` is a powerful tool from the FW24 package that simplifies the process of setting up and managing AWS DynamoDB tables in your application. This guide will walk you through the process of importing, configuring, and using `DynamoDBConstruct` in your project.

## Step 1: Importing

First things first, let's bring `DynamoDBConstruct` into your project. You can do this by importing it from the `FW24` package as shown below:

```ts
import { DynamoDBConstruct } from '@ten24group/fw24';
```

## Step 2: Configuration

Now that `DynamoDBConstruct` is part of your project, it's time to configure it to suit your needs. The configuration involves setting up `name` and `props`:

```ts
  var dynamoDBTable = new DynamoDBConstruct({
    name: 'my-table',
    props: {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      sortKey: { name: 'timestamp', type: AttributeType.NUMBER },
      billingMode: BillingMode.PAY_PER_REQUEST,
    },
  });
```

In this configuration:

- `name` sets the name of the DynamoDB table.
- `props` sets the properties for the DynamoDB table, such as `partitionKey`, `sortKey`, and `billingMode`.

Feel free to adjust these settings to match your application's requirements.

## Step 3: Usages

With `DynamoDBConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(dynamoDBTable).run();
```
