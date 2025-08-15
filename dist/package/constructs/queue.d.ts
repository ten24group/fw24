import { Stack } from "aws-cdk-lib";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { ILambdaEnvConfig } from "../interfaces/lambda-env";
import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { IConstructConfig } from "../interfaces/construct-config";
/**
 * Represents the configuration for a queue construct.
 */
export interface IQueueConstructConfig extends IConstructConfig {
    /**
     * The directory where queues are stored.
     */
    queuesDirectory?: string;
    /**
     * The properties for the queue.
     */
    queueProps?: QueueProps;
    /**
     * The environment configuration for the queue.
     */
    env?: ILambdaEnvConfig[];
    /**
     * The properties for the function.
     */
    functionProps?: NodejsFunctionProps;
}
/**
 * Represents a QueueConstruct that creates and registers queues in the stack.
 * @implements FW24Construct
 * @example
 * ```ts
 * // Create a new QueueConstruct instance
 * const queueConfig: IQueueConstructConfig = {
 *   queuesDirectory: "./src/queues",
 *   env: [
 *     { name: "QUEUE_NAME", prefix: "PREFIX_" },
 *     { name: "QUEUE_URL" }
 *   ],
 *   queueProps: {
 *     fifo: true,
 *     contentBasedDeduplication: true
 *   },
 *   functionProps: {
 *     memorySize: 512
 *   }
 * };
 * const queueConstruct = new QueueConstruct(queueConfig);
 *
 * app.use(queueConstruct);
 * ```
 */
export declare class QueueConstruct implements FW24Construct {
    private queueConstructConfig;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    /**
     * Default constructor to initialize the stack configuration.
     * @param queueConstructConfig The configuration for the QueueConstruct.
     */
    constructor(queueConstructConfig: IQueueConstructConfig);
    /**
     * Construct method to create the stack.
     */
    construct(): Promise<void>;
    /**
     * Registers a queue using the provided queue information.
     * @param queueInfo The information about the queue to be registered.
     */
    private registerQueue;
}
