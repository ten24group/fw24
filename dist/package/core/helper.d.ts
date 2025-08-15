import HandlerDescriptor from "../interfaces/handler-descriptor";
import { IFw24Module } from "./runtime/module";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
export declare class Helper {
    static readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    static hydrateConfig<T>(config: T, prefix?: string): void;
    static registerControllersFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void): Promise<void>;
    static registerQueuesFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void): Promise<void>;
    static registerTasksFromModule(module: IFw24Module, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void): Promise<void>;
    static scanControllerSourceFilesFrom(directoryPath: string): string[];
    static isFifoQueueProps(props: QueueProps): boolean;
    static registerHandlers(path: string, handlerRegistrar: (handlerInfo: HandlerDescriptor) => void, files?: string[]): Promise<void>;
}
