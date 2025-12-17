import { createLogger } from "../../logging";
import { DefaultValidator, IValidator } from "../../validation";
import { ObservabilityManager } from "../../observability";
import { tryImportingEntryPackagesFor } from "../../decorators/decorator-utils";

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
   * 
   * Ensure entry packages are loaded proeprly, before 
   * before observability initialization attempts to resolve config.
   */
  protected initializeEntryPackagesAndObservability(): void {
    // Load entry packages (idempotent - safe to call multiple times)
    // This ensures DI config is available for bundled framework handlers
    tryImportingEntryPackagesFor(this.constructor.name);

    // Now initialize observability with proper DI config
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