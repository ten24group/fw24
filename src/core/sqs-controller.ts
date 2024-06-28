import { SQSEvent, Context } from "aws-lambda";
import { createLogger } from "../logging";

import AWSXRay from 'aws-xray-sdk-core';

/**
 * Base class for handling SQS events.
 */
abstract class QueueController {
  readonly logger = createLogger(QueueController.name);

  /**
   * Binds the LambdaHandler method to the instance of the class.
   */
  constructor() {
    this.LambdaHandler = this.LambdaHandler.bind(this)
  }

  abstract initialize(event: SQSEvent, context: Context): Promise<any>;

  abstract process(event: any, context: any): Promise<any>;

  /**
   * Lambda handler for the queue.
   * Handles incoming SQS events.
   * @param event - The event object from the SQS.
   * @param context - The context object from the SQS.
   * @returns The SQS response object.
   */
  async LambdaHandler(event: SQSEvent, context: Context): Promise<any> {
    this.logger.debug("SQS-LambdaHandler Received event:", JSON.stringify(event, null, 2));
    
    await AWSXRay.captureAsyncFunc(`${QueueController.name}::LambdaHandler::initialize`, async (subsegment) => {
      try {

        // hook for the application to initialize it's state, Dependencies, config etc
        await this.initialize(event, context);

      } catch (error: any) {
        subsegment?.addError(error);
        this.logger.error("Error processing event:", error);
        throw error;
      } finally {
        subsegment?.close();
      }
    });

    await AWSXRay.captureAsyncFunc(`${QueueController.name}::LambdaHandler::process`, async (subsegment) => {
      try {

        // Execute the associated route function
        await this.process(event, context);

      } catch (error: any) {
        subsegment?.addError(error);
        this.logger.error("Error processing event:", error);
        throw error;
      } finally {
        subsegment?.close();
      }
    });

}

/**
   * Creates a new instance of the controller and returns its LambdaHandler method.
   * @returns The LambdaHandler method of the controller.
   */
  static CreateHandler( queueFunc: { new (): QueueController} ) {
    const queue = new queueFunc();
    return queue.LambdaHandler;
  }
}

export { QueueController };