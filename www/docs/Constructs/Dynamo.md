
# DynamoDBConstruct

## Introduction

The `DynamoDBConstruct` is a part of the FW24 toolkit, designed to simplify the process of integrating AWS DynamoDB tables into your application. With `DynamoDBConstruct`, you can define a DynamoDB table with its properties. The configuration involves setting up name and props:

name: The name of the DynamoDB table.
props: The properties for the DynamoDB table, such as partitionKey, sortKey, and billingMode.
This construct provides a streamlined way to manage DynamoDB tables, making it easier to work with data in your AWS applications. Whether you're storing user data, application logs, or other types of data, `DynamoDBConstruct` simplifies the task of managing DynamoDB tables in AWS.

## Getting Started

This guide will walk you through the process of importing, configuring, and using `DynamoDBConstruct` in your project.

### Step 1: Importing

First things first, let's bring `DynamoDBConstruct` into your project. You can do this by importing it from the `FW24` package as shown below:

```ts
import { DynamoDBConstruct } from '@ten24group/fw24';
```

### Step 2: Configuration

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

### Step 3: Usages

With `DynamoDBConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(dynamoDBTable).run();
```
