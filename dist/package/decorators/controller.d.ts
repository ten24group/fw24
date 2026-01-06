import type { ILambdaEnvConfig } from "../interfaces/lambda-env";
import type { AuthorizerTypeMetadata } from "./authorizer";
import type { CommonLambdaHandlerOptions } from "./decorator-utils";
import type { ControllerObservabilityConfig } from "../observability/controller-config";
/**
 * Represents the configuration options for a controller.
 */
export type IControllerConfig = CommonLambdaHandlerOptions & {
    /**
     * Specifies the authorizer for the controller.
     * It can be an array of authorizer objects, a single authorizer object, or a string.
     */
    authorizer?: Array<AuthorizerTypeMetadata> | AuthorizerTypeMetadata | string;
    /**
     * Specifies the environment configurations for the controller.
     */
    env?: Array<ILambdaEnvConfig>;
    /**
     * Specifies the target for the API
     * Values can be "function", "queue" or "topic"
     * @default "function"
     */
    target?: string;
    /**
     * Specifies a stackname to be used in a multi-stack environment.
     */
    stackName?: string;
    /**
     * Specifies a parent stackname to be used in a nested-stack environment.
     */
    parentStackName?: string;
    /**
     * Specifies the options for the error handler.
     */
    errorHandlerOptions?: {
        includeStack?: boolean;
        logErrors?: boolean;
        logRequestDetails?: boolean;
    };
    /**
     * Whether to require an API key for this controller
     * @default false
     */
    requireApiKey?: boolean;
    /**
     * Observability configuration for request/response data capture.
     * By default, only basic HTTP info is captured. Use `includes` to capture
     * request body/headers/query and response body/headers.
     *
     * @example
     * ```typescript
     * @Controller('payments', {
     *   observability: {
     *     includes: {
     *       request: { body: true },
     *       response: { body: ['id', 'status'] }
     *     },
     *     dataProtection: { enabled: true }
     *   }
     * })
     * ```
     */
    observability?: ControllerObservabilityConfig;
};
/**
 * Decorator function for defining a controller.
 *
 * @param controllerName - The name of the controller.
 * @param controllerConfig - Optional configuration for the controller.
 * @returns A class decorator function.
 */
export declare function Controller(controllerName: string, controllerConfig?: IControllerConfig): <T extends {
    new (...args: any[]): {};
}>(target: T) => {
    new (...args: any[]): {};
} & T;
