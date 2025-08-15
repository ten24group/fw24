import { SQSEvent, Context } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
/**
 * Base class for handling SQS events.
 */
declare abstract class QueueController extends AbstractLambdaHandler {
    abstract initialize(event: SQSEvent, context: Context): Promise<any>;
    abstract process(event: any, context: any): Promise<any>;
    /**
     * Lambda handler for the queue.
     * Handles incoming SQS events.
     * @param event - The event object from the SQS.
     * @param context - The context object from the SQS.
     * @returns The SQS response object.
     */
    LambdaHandler(event: SQSEvent, context: Context): Promise<any>;
}
export { QueueController };
