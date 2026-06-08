import HandlerDescriptor from "../interfaces/handler-descriptor";
import { IFw24Module } from "./runtime/module";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
/**
 * Configuration for parallel handler loading
 */
interface ParallelLoadConfig {
    /**
     * Maximum number of files to load in parallel
     * @default 10
     */
    maxConcurrency?: number;
    /**
     * Whether to fail fast on first error or collect all errors
     * @default false (collect all errors)
     */
    failFast?: boolean;
}
/**
 * Simple timer utility for measuring durations
 */
export declare class Helper {
    static readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    static hydrateConfig<T>(config: T, prefix?: string): void;
    static registerControllersFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void): Promise<void>;
    static registerQueuesFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void): Promise<void>;
    static registerTasksFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void): Promise<void>;
    static scanControllerSourceFilesFrom(directoryPath: string): string[];
    static isFifoQueueProps(props: QueueProps): boolean;
    /**
     * Load a single handler file and extract its descriptors
     * @private
     */
    private static loadHandlerFile;
    /**
     * Register handlers from a directory with parallel file loading
     * Files are loaded in parallel for speed, but construct registration is sequential for CDK safety
     *
     * @param path - Directory path containing handler files
     * @param handlerRegistrar - Callback to register each handler
     * @param files - Optional array of specific files to load (if empty, scans directory)
     * @param config - Configuration for parallel loading
     *
     * @example
     * // Use default concurrency (5)
     * await Helper.registerHandlers('./src/controllers', registerController);
     *
     * // Override concurrency via environment variable FW24_HANDLER_LOAD_CONCURRENCY
     * process.env.FW24_HANDLER_LOAD_CONCURRENCY = '10';
     *
     * // Or pass config directly
     * await Helper.registerHandlers('./src/controllers', registerController, [], { maxConcurrency: 5 });
     */
    static registerHandlers(path: string, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void | Promise<void>, files?: string[], config?: ParallelLoadConfig): Promise<void>;
}
export {};
