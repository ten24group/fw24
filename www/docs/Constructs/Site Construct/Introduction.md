---
sidebar_position: 1
---

# Introduction

`SchedulerConstruct` is a versatile construct from the FW24 toolkit, designed to simplify the process of scheduling tasks using AWS CloudWatch Events in your applications. With `SchedulerConstruct`, you can define a scheduler with its properties. The configuration involves setting up `tasksDirectory`, `env`, and `functionProps`:

- `tasksDirectory`: This is the directory path where the tasks are located. AWS CloudWatch Events will use these tasks for scheduling.
- `env`: These are the environment variables for the Lambda functions that will be triggered by the scheduled events. You can specify the name and prefix of the environment variables here.
- `functionProps`: These are the properties for the Node.js functions that will be triggered by the scheduled events, such as `runtime`, `handler`, and `code`.

`SchedulerConstruct` provides a streamlined way to manage scheduled tasks, making it easier to automate tasks in your AWS applications. Whether you're running cron jobs, automating backups, or scheduling data processing tasks, `SchedulerConstruct` simplifies the task of managing scheduled tasks in AWS. It's an invaluable tool that not only streamlines task scheduling but also enhances the overall efficiency and responsiveness of your application.
