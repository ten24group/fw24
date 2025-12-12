import { IValidator } from "../../validation";
export declare abstract class AbstractLambdaHandler {
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    protected validator: IValidator;
    /**
     * Binds the LambdaHandler method to the instance of the class.
     */
    constructor();
    abstract LambdaHandler(event: any, context: any): Promise<any>;
    /**
     * Initialize observability for this invocation.
     * Called at the start of each handler execution.
     */
    protected initializeObservability(): void;
    /**
     * Flush observability data at the end of handler execution.
     */
    protected flushObservability(): Promise<void>;
    /**
     * Creates a new instance of the controller and returns its LambdaHandler method.
     * @returns The LambdaHandler method of the controller.
     */
    static CreateHandler(handlerFunc: {
        new (): AbstractLambdaHandler;
    }): (event: any, context: any) => Promise<any>;
}
