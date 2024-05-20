---
sidebar_position: 2
---

# Getting Started

Welcome to the `MailerConstruct` guide! `MailerConstruct` is a robust tool from the FW24 package that simplifies the process of sending emails using AWS Simple Email Service (SES) in your application. This guide will walk you through the process of importing, configuring, and using `MailerConstruct` in your project.

## Step 1: Importing

First things first, let's bring `MailerConstruct` into your project. You can do this by importing it from the FW24 package as shown below:

```ts
import { MailerConstruct } from '@ten24group/fw24';
```

## Step 2: Configuration

Now that `MailerConstruct` is part of your project, it's time to configure it to suit your needs. The configuration involves setting up `domain`, `sesOptions`, `templatesDirectory`, and `queueProps`:

```ts
  var mailer = new MailerConstruct({
    domain: 'my-domain.com',
    sesOptions: {
      region: 'us-east-1',
    },
    templatesDirectory: '/path/to/templates',
    queueProps: {
      visibilityTimeout: cdk.Duration.seconds(300),
    },
  });
```

In this configuration:

- `domain` sets the domain for the mailer. It's the domain from which the emails will be sent.
- `sesOptions` sets optional SES options. You can specify additional configuration options for AWS SES here.
- `templatesDirectory` sets the directory path where the email templates are located. AWS SES will use these templates for sending emails.
- `queueProps` sets the properties for the queue. If you're using a queue (like AWS SQS) to manage your email sending tasks, you can specify the queue properties here.

Feel free to adjust these settings to match your application's requirements.

## Step 3: Usages

With `MailerConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(mailer).run();
```

This will add the configured mailer to your application. You can now send emails from your AWS applications using the `MailerConstruct`.
