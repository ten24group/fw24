import { createLogger } from '../../logging';

export abstract class AbstractLambdaHandler {
  readonly logger = createLogger(this.constructor.name);

  /**
   * Binds the LambdaHandler method to the instance of the class.
   */
  constructor() {
    this.LambdaHandler = this.LambdaHandler.bind(this);
  }

  abstract LambdaHandler(event: any, context: any): Promise<any>;

  /**
   * Creates a new instance of the controller and returns its LambdaHandler method.
   * @returns The LambdaHandler method of the controller.
   */
  static CreateHandler(handlerFunc: { new (): AbstractLambdaHandler }) {
    const instance = new handlerFunc();
    return instance.LambdaHandler;
  }
}
