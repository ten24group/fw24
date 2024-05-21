# MailerConstruct

## Introduction

`MailerConstruct` is a robust construct from the FW24 toolkit, designed to streamline the process of sending emails using AWS Simple Email Service (SES) in your applications. With `MailerConstruct`, you can define a mailer with its properties. The configuration involves setting up `domain`, `sesOptions`, `templatesDirectory`, and `queueProps`:

- `domain`: This is the domain for the mailer. It's the domain from which the emails will be sent.
- `sesOptions`: These are optional SES options. You can specify additional `configuration` options for AWS SES here.
- `templatesDirectory`: This is the directory path where the email templates are located. AWS SES will use these templates for sending emails.
- `queueProps`: These are the properties for the queue. If you're using a queue (like AWS SQS) to manage your email sending tasks, you can specify the queue properties here.

`MailerConstruct` provides a streamlined way to manage email sending tasks, making it easier to send emails from your AWS applications. Whether you're sending transactional emails, marketing emails, or any other types of emails, `MailerConstruct` simplifies the task of managing email sending tasks in AWS. It's an invaluable tool that not only streamlines email sending but also enhances the overall efficiency and responsiveness of your application.

## Getting Started

This guide will walk you through the process of importing, configuring, and using `MailerConstruct` in your project.

### Step 1: Importing

First things first, let's bring `MailerConstruct` into your project. You can do this by importing it from the FW24 package as shown below:

```ts
import { MailerConstruct } from '@ten24group/fw24';
```

### Step 2: Configuration

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
- `queueProps` sets the properties for the queue. To manage your email sending tasks, you can specify the `queue-properties` here.

Feel free to adjust these settings to match your application's requirements.

### Step 3: Usages

With `MailerConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(mailer).run();
```

This will add the configured mailer to your application. You can now send emails from your AWS applications using the `MailerConstruct`.

### Step 4: Sending Emails

- Sending simple email

  ```ts
    import { sendMail } from '@ten24group/fw24';

    const {ToEmailAddress, Subject, Message} = req.body;

    const emailMessage = {
      Subject,
      Message,
      ToEmailAddress,
      FromEmailAddress: "fw24@ten24.co"
    }

    const sendResult = await sendMail(emailMessage);

  ```

- Sending emails using email-templates

  ```ts
    const {ToEmailAddress, TemplateName, TemplateData} = req.body;

    const emailMessage = {
      TemplateName,
      ToEmailAddress,
      FromEmailAddress: "fw24@ten24.co"
    }

    const sendResult = await sendMail(emailMessage, TemplateData);
  ```
