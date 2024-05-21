# Topic

## Introduction

`TopicConstruct` is an influential construct from the FW24 toolkit, engineered to streamline the creation and management of Amazon Simple Notification Service (SNS) topics within your AWS applications. `TopicConstruct` allows you to define an SNS topic along with its properties, including `topicName` and `topicProps`:

- `topicName`: Represents the unique name of the SNS topic you wish to create.
- `topicProps`: Defines the properties of the SNS topic, such as `displayName` `topicName` etc.

`TopicConstruct` offers a simplified approach to managing SNS topics, facilitating the publishing of messages and subscribing endpoints to topics in your AWS applications. Whether you're dispatching direct notifications, broadcasting messages to multiple endpoints, or filtering messages prior to sending, `TopicConstruct` eases the task of managing SNS topics in AWS.

## Getting Started

This guide will walk you through the process of importing, configuring, and using `TopicConstruct` in your project.

### Step 1: Importing

First things first, let's bring `TopicConstruct` into your project. You can do this by importing it from the FW24 package as shown below:

```ts
import { TopicConstruct } from '@ten24group/fw24';
```

### Step 2: Configuration

Now that `TopicConstruct` is part of your project, it's time to configure it to suit your needs. The configuration involves setting up `topicName` and `topicProps`:

```ts
  var topic = new TopicConstruct({
    topicName: 'my-topic',
    topicProps: {
      displayName: 'My Topic',
    },
  });
```

In this configuration:

- `topicName` sets the name of the SNS topic that you want to create.
- `topicProps` sets the properties for the SNS topic, such as `displayName`.

Feel free to adjust these settings to match your application's requirements.

### Step 3: Usages

With `TopicConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(topic).run();
```

This will add the configured topic to your application. You can now manage SNS topics in your AWS applications using the `TopicConstruct`.

### Step 4: Publishing Messages

One of the key features of `TopicConstruct` is its ability to simplify the process of publishing messages and subscribing endpoints to topics. This means that you can easily send direct notifications, fanout messages to multiple endpoints, or filter messages before sending.

```ts

  import { Environment, sendTopicMessage } from '@ten24group/fw24';

  const { topicName, message } = req.body as {topicName: string, message: string};

  const topicArn = Environment.topicArn(topicName);
  const snsResult = await sendTopicMessage(topicArn, message);
```
