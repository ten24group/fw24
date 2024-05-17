# SQSController

The `SQSController` class serves as a base class for handling SQS events. It includes methods for initializing the event handler and executing the associated route function.

## Constructor

### `constructor()`

Binds the `LambdaHandler` method to the instance of the class.

## Abstract Methods

### `initialize(event: SQSEvent, context: Context): Promise<void>`

This abstract method must be implemented by subclasses to initialize the controller with the provided event and context.

## Methods

### `LambdaHandler(event: SQSEvent, context: Context): Promise<void>`

Lambda handler for the queue. Handles incoming SQS events.

- Parameters:
  - `event` - The event object from the SQS.
  - `context` - The context object from the SQS.

- Returns: 
  - A promise that resolves to void.

### `CreateHandler(queueFunc: { new (): SQSController}): () => Promise<void>`

Creates a new instance of the controller and returns its `LambdaHandler` method.

- Parameters:
  - `queueFunc` - A function that creates a new instance of `SQSController`.

- Returns:
  - The `LambdaHandler` method of the controller.

## Usage

```ts
import { SQSController } from "./SQSController";

class MySQSController extends SQSController {
  async initialize(event: SQSEvent, context: Context): Promise<void> {
    // Implement initialization logic here
  }
}

const handler = SQSController.CreateHandler(MySQSController);

export { handler };
```

This documentation outlines the structure and usage of the `SQSController` class, which can be extended and implemented for handling SQS events in AWS Lambda functions.