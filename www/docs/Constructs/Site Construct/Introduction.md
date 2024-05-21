---
sidebar_position: 1
---

# Introduction

The `SchedulerConstruct` is a powerful component of the FW24 toolkit that simplifies the process of scheduling tasks using AWS CloudWatch Events in your applications. With the `SchedulerConstruct`, you can easily define a scheduler and configure its properties.

The configuration of the `SchedulerConstruct` involves the following elements:

- `tasksDirectory`: This is the directory path where the tasks are located. AWS CloudWatch Events will use the tasks in this directory for scheduling.
- `env`: These are the environment variables for the Lambda functions that will be triggered by the scheduled events. You can specify the name and prefix of the environment variables here.
- `functionProps`: These are the properties for the Node.js functions that will be triggered by the scheduled events, such as `runtime`, `handler`.

By using the `SchedulerConstruct`, you can easily manage scheduled tasks in your application. Whether you need to run cron jobs, automate backups, or schedule data processing tasks, the `SchedulerConstruct` simplifies the task management process in your FW24 application.
