---
sidebar_position: 2
---

# Application

This class represents an AWS CDK application. It allows the user to create a new CDK App instance and a main CDK Stack instance.

## Constructor

### Parameters
- `config` (optional): An object that implements the `IApplicationConfig` interface. This object is used to configure the application. If no `config` object is provided, an empty object is used.

### Details
- The constructor initializes the AWS CDK application by creating a new `App` instance.
- It also creates a new CDK Stack instance for the main stack using the provided `config` object.
- The constructor hydrates the `config` object with environment variables using the `Helper` class.
- It sets global variables `mainStack` using the `Reflect` class.

## Properties
- `app`: An instance of the CDK `App` class representing the application.
- `mainStack`: An instance of the CDK `Stack` class representing the main stack of the application.

## Methods

### `use(stack: any): Application`
This method is used to add a new stack to the application.

#### Parameters
- `stack`: An object representing the stack to be added to the application.

#### Returns
- An instance of the `Application` class with the new stack added.

#### Details
- The `use` method takes a stack object and calls its `construct` method passing in the `config` object.
- This method allows the user to add different stacks to the application and configure them as needed.