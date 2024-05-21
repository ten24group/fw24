
# SchedulerConstruct

## Introduction

The `SchedulerConstruct` is a powerful component of the FW24 toolkit that simplifies the process of scheduling tasks using AWS CloudWatch Events in your applications. With the `SchedulerConstruct`, you can easily define a scheduler and configure its properties.

The configuration of the `SchedulerConstruct` involves the following elements:

- `tasksDirectory`: This is the directory path where the tasks are located. AWS CloudWatch Events will use the tasks in this directory for scheduling.
- `env`: These are the environment variables for the Lambda functions that will be triggered by the scheduled events. You can specify the name and prefix of the environment variables here.
- `functionProps`: These are the properties for the Node.js functions that will be triggered by the scheduled events, such as `runtime`, `handler`.

By using the `SchedulerConstruct`, you can easily manage scheduled tasks in your application. Whether you need to run cron jobs, automate backups, or schedule data processing tasks, the `SchedulerConstruct` simplifies the task management process in your FW24 application.

## Getting Started

This guide will walk you through the process of importing, configuring, and using `SchedulerConstruct` in your project.

### Step 1: Importing

First things first, let's bring `SchedulerConstruct` into your project. You can do this by importing it from the FW24 package as shown below:

```ts
import { SchedulerConstruct } from '@ten24group/fw24';
```

### Step 2: Configuration

Now that `SchedulerConstruct` is part of your project, it's time to configure it to suit your needs. The configuration involves setting up `tasksDirectory`, `env`, and `functionProps`:

```ts
  var scheduler = new SchedulerConstruct({
    tasksDirectory: '/path/to/tasks',
    env: {
      name: 'my-env',
      prefix: 'my-prefix',
    },
    functionProps: {
      runtime: lambda.Runtime.NODEJS_14_X,
    },
  });
```

In this configuration:

- `tasksDirectory` sets the directory path where the tasks are located. AWS CloudWatch Events will use these tasks for scheduling.
- `env` sets the environment variables for the Lambda functions that will be triggered by the scheduled events. You can specify the name and prefix of the environment variables here.
- `functionProps` sets the properties for the Node.js functions that will be triggered by the scheduled events, such as `runtime`, `handler`, and `code`.

Feel free to adjust these settings to match your application's requirements.

### Step 3: Usages

With `SchedulerConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(scheduler).run();
```

This will add the configured scheduler to your application. You can now manage scheduled tasks in your AWS applications using the `SchedulerConstruct`.
