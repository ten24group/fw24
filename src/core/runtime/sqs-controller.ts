import { SQSEvent, Context } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";

/**
 * Base class for handling SQS events.
 */
abstract class QueueController extends AbstractLambdaHandler {

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
      // hook for the application to initialize it's state, Dependencies, config etc
      await this.initialize(event, context);
      // Execute the associated route function

      await this.process(event, context);
  }
}

export { QueueController };