import { SQSEvent, Context } from "aws-lambda";

/**
 * Base class for handling SQS events.
 */
abstract class SQSController {

  /**
   * Binds the LambdaHandler method to the instance of the class.
   */
  constructor() {
    this.LambdaHandler = this.LambdaHandler.bind(this)
  }

  abstract initialize(event: SQSEvent, context: Context): Promise<void>;

  abstract process(event: any, context: any): void;

  /**
   * Lambda handler for the queue.
   * Handles incoming SQS events.
   * @param event - The event object from the SQS.
   * @param context - The context object from the SQS.
   * @returns The SQS response object.
   */
  async LambdaHandler(event: SQSEvent, context: Context): Promise<void> {
    console.log("SQS-LambdaHandler Received event:", JSON.stringify(event, null, 2));

    // hook for the application to initialize it's state, Dependencies, config etc
    await this.initialize(event, context);
    // Execute the associated route function

    this.process(event, context);
}

/**
   * Creates a new instance of the controller and returns its LambdaHandler method.
   * @returns The LambdaHandler method of the controller.
   */
  static CreateHandler( queueFunc: { new (): SQSController} ) {
    const queue = new queueFunc();
    return queue.LambdaHandler;
  }
}

export { SQSController };
