import { AbstractLambdaHandler } from "./abstract-lambda-handler";
/**
 * Base class for handling Schedule Tasks.
 */
declare abstract class TaskController extends AbstractLambdaHandler {
    abstract initialize(): Promise<any>;
    abstract process(): Promise<any>;
    /**
     * Lambda handler for the task.
     */
    LambdaHandler(): Promise<any>;
}
export { TaskController };
