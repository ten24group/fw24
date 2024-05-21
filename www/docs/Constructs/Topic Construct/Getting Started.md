---
sidebar_position: 2
---

# Getting Started

Welcome to the `TopicConstruct` guide! `TopicConstruct` is a powerful tool from the FW24 package that simplifies the process of creating and managing Amazon Simple Notification Service (SNS) topics in your AWS applications. This guide will walk you through the process of importing, configuring, and using `TopicConstruct` in your project.

## Step 1: Importing

First things first, let's bring `TopicConstruct` into your project. You can do this by importing it from the FW24 package as shown below:

```ts
import { TopicConstruct } from '@ten24group/fw24';
```

## Step 2: Configuration

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
- `topicProps` sets the properties for the SNS topic, such as `displayName` and `masterKey`.

Feel free to adjust these settings to match your application's requirements.

## Step 3: Usages

With `TopicConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(topic).run();
```

This will add the configured topic to your application. You can now manage SNS topics in your AWS applications using the `TopicConstruct`.

## Step 4: Publishing Messages and Subscribing Endpoints

One of the key features of `TopicConstruct` is its ability to simplify the process of publishing messages and subscribing endpoints to topics. This means that you can easily send direct notifications, fanout messages to multiple endpoints, or filter messages before sending.

In conclusion, `TopicConstruct` provides a streamlined way to manage SNS topics, making it easier to publish messages and subscribe endpoints to topics in your AWS applications. Whether you're sending direct notifications, fanout messages to multiple endpoints, or filtering messages before sending, `TopicConstruct` simplifies the task of managing SNS topics in AWS. It's an invaluable tool that not only streamlines topic management but also enhances the overall efficiency and responsiveness of your application.
