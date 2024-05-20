---
sidebar_position: 1
---

# Introduction

`MailerConstruct` is a robust construct from the FW24 toolkit, designed to streamline the process of sending emails using AWS Simple Email Service (SES) in your applications. With `MailerConstruct`, you can define a mailer with its properties. The configuration involves setting up `domain`, `sesOptions`, `templatesDirectory`, and `queueProps`:

- `domain`: This is the domain for the mailer. It's the domain from which the emails will be sent.
- `sesOptions`: These are optional SES options. You can specify additional `configuration` options for AWS SES here.
- `templatesDirectory`: This is the directory path where the email templates are located. AWS SES will use these templates for sending emails.
- `queueProps`: These are the properties for the queue. If you're using a queue (like AWS SQS) to manage your email sending tasks, you can specify the queue properties here.

`MailerConstruct` provides a streamlined way to manage email sending tasks, making it easier to send emails from your AWS applications. Whether you're sending transactional emails, marketing emails, or any other types of emails, `MailerConstruct` simplifies the task of managing email sending tasks in AWS. It's an invaluable tool that not only streamlines email sending but also enhances the overall efficiency and responsiveness of your application.
