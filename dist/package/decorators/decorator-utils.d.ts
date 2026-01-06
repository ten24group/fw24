import type { RemovalPolicy } from "aws-cdk-lib";
import type { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import type { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { IFunctionResourceAccess, TImportedPolicy, TPolicyStatementOrProps } from "../constructs/lambda-function";
import type { ILayerVersion } from "aws-cdk-lib/aws-lambda";
import type { ClassConstructor, IDIContainer } from "../interfaces/di";
import type { RegisterDIModuleMetadataOptions } from "../di/metadata";
export type CommonLambdaHandlerOptions = {
    /**
     * Defines the resources that the controller needs access to.
     */
    resourceAccess?: IFunctionResourceAccess;
    /**
     * The policies to attach to the Lambda function's execution role.
     */
    policies?: Array<TPolicyStatementOrProps | TImportedPolicy>;
    /**
     * Specifies the timeout for the controller function in seconds.
     * * Use this timeout to avoid importing the duration class from aws-cdk-lib.
     */
    functionTimeout?: number;
    processorArchitecture?: 'x86_64' | 'arm_64';
    /**
     * Specifies additional properties for the controller function.
     */
    functionProps?: Omit<NodejsFunctionProps, 'layers'> & {
        readonly layers?: Array<ILayerVersion | string>;
    };
    /**
     * Specifies the number of days to retain the controller function's logs.
     */
    logRetentionDays?: RetentionDays;
    /**
     * Specifies the removal policy for the controller function's logs.
     */
    logRemovalPolicy?: RemovalPolicy;
    /**
     * Specifies whether to auto-generate the lambda handler.
     * @default true
     * if set to false, the handler will not be exported into the module.exports of the decorated-class's module
     * this is useful when you want to manually export the handler in a different way
     * e.g.
     * ```ts
     *  @Controller('abc', { autoExportLambdaHandler: false })
     *  class MyController extends APIController {
     *
     *  }
     * 	export const handler: Handler = MyController.CreateHandler(MyController);
     * ```
     */
    autoExportLambdaHandler?: boolean;
    /**
     * Specifies the entry packages to import before initializing the lambda.
     * This is useful when you want to import packages to do some initial setup [like warming up DI container] before executing the handler.
     */
    entryPackages?: string[] | {
        override: boolean;
        packageNames: string[];
    };
    /**
     * Specifies the DI-module options for the controller.
     * Under the hood this will create a dedicated module and container for this controller; you can use this option to shadow the providers and configs available in the parent scopes.
     */
    module?: RegisterDIModuleMetadataOptions;
};
/**
 * Loads entry packages specified in ENTRY_PACKAGES environment variable.
 * Called automatically by fw24 layer on import, and by decorators for backward compatibility.
 * Safe to call multiple times - only loads once.
 */
export declare function tryImportingEntryPackagesFor(controllerName?: string | undefined): void;
/**
 * Sets up Dependency Injection (DI) for a class and returns the DI container.
 *
 * @param target - The class for which DI is being set up.
 * @param options - DI options including the container and module configurations.
 * @param fallbackToRootContainer - Whether to use the default DIContainer.ROOT if resolvingContainer is not specified in di options.
 * @returns The DI container used for the setup.
 */
export declare function setupDIModuleForController<T>(options: {
    target: ClassConstructor<T>;
    module: RegisterDIModuleMetadataOptions;
    fallbackToRootContainer?: boolean;
}): IDIContainer | undefined;
export declare function resolveHandler(target: string, container?: IDIContainer): (event: any, context: any) => Promise<any>;
export declare function resolveAndExportHandler(target: Function, container?: IDIContainer): void;
/**
 * Exports a Lambda handler from the calling module.
 *
 * @param handler - The handler function to export.
 * @param handlerName - The name under which to export the handler.
 */
export declare function exportHandler(handler: any, handlerName?: string, callingModule?: NodeModule | undefined): void;
/**
 * Gets the module that called the current function.
 *
 * @param nthModuleInStack - The index of the module in the stack to return.
 *
 * @returns The nth NodeModule from which the current function was called.
 */
export declare function getCallingModule(nthModuleInStack?: number): NodeModule | undefined;
/**
 * Utility function to find the constructor of a class from a method decorator target.
 * This ensures consistent constructor access across all decorators.
 *
 * @param target - The target object from the decorator
 * @param methodToDecorate - The method being decorated
 * @returns The constructor of the class or undefined if not found
 */
export declare function findConstructor(target: any, methodToDecorate: any): any;
/**
 * Utility function to get a unique symbol for a class's routes.
 * This ensures consistent route storage across all decorators.
 *
 * @param constructor - The constructor of the class
 * @returns A unique symbol for the class's routes
 */
export declare function getRoutesKey(constructor: any): symbol;
