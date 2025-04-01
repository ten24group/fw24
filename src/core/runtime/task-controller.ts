import { AbstractLambdaHandler } from './abstract-lambda-handler';

/**
 * Base class for handling Schedule Tasks.
 */
abstract class TaskController extends AbstractLambdaHandler {
  abstract initialize(): Promise<any>;

  abstract process(): Promise<any>;

  /**
   * Lambda handler for the task.
   */
  async LambdaHandler(): Promise<any> {
    // hook for the application to initialize it's state, Dependencies, config etc
    await this.initialize();
    // Execute the associated function
    await this.process();
  }
}

export { TaskController };
