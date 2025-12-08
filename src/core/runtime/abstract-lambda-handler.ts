import { createLogger } from "../../logging";
import { DefaultValidator, IValidator } from "../../validation";
import { ObservabilityManager } from "../../observability";

export abstract class AbstractLambdaHandler {
  readonly logger = createLogger(this.constructor.name);
  protected validator: IValidator = DefaultValidator;

  /**
   * Binds the LambdaHandler method to the instance of the class.
   */
  constructor() {
    this.LambdaHandler = this.LambdaHandler.bind(this)
  }

  abstract LambdaHandler(event: any, context: any): Promise<any>;

  /**
   * Initialize observability for this invocation.
   * Called at the start of each handler execution.
   */
  protected initializeObservability(): void {
    ObservabilityManager.initializeInvocation();
  }

  /**
   * Flush observability data at the end of handler execution.
   */
  protected async flushObservability(): Promise<void> {
    await ObservabilityManager.flush();
  }

  /**
   * Creates a new instance of the controller and returns its LambdaHandler method.
   * @returns The LambdaHandler method of the controller.
   */
  static CreateHandler(handlerFunc: { new(): AbstractLambdaHandler }) {
    const instance = new handlerFunc();
    return instance.LambdaHandler;
  }
}