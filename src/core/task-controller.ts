/**
 * Base class for handling Schedule Tasks.
 */
abstract class TaskController {

  /**
   * Binds the LambdaHandler method to the instance of the class.
   */
  constructor() {
    this.LambdaHandler = this.LambdaHandler.bind(this)
  }

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

/**
   * Creates a new instance of the controller and returns its LambdaHandler method.
   * @returns The LambdaHandler method of the controller.
   */
  static CreateHandler( taskFunc: { new (): TaskController} ) {
    const task = new taskFunc();
    return task.LambdaHandler;
  }
}

export { TaskController };