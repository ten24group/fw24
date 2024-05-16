import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { IFunctionResourceAccess } from "../constructs/lambda-function";
import { IQueueSubscriptions } from "../constructs/queue-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";
import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";

/**
 * Configuration options for the queue.
 */
/**
 * Represents the configuration options for a queue.
 */
export interface IQueueConfig {
	/**
	 * The properties of the queue.
	 */
	queueProps?: QueueProps;

	/**
	 * The visibility timeout for the messages in the queue, in seconds.
	 */
	visibilityTimeoutSeconds?: number;

	/**
	 * The amount of time for which a ReceiveMessage call will wait for a message to arrive in the queue before returning an empty response, in seconds.
	 */
	receiveMessageWaitTimeSeconds?: number;

	/**
	 * The number of days for which the messages in the queue are retained.
	 */
	retentionPeriodDays?: number;

	/**
	 * The environment variables for the queue.
	 */
	env?: {
		name: string;
	};

	/**
	 * The resource access configuration for the queue.
	 */
	resourceAccess?: IFunctionResourceAccess;

	/**
	 * The subscriptions for the queue.
	 */
	subscriptions?: IQueueSubscriptions;

	/**
	 * The timeout for the function associated with the queue, in seconds.
	 * * use this timeout to avoid importing duration class from aws-cdk-lib
	 * 
	 */
	functionTimeout?: number;

	/**
	 * The properties for the Node.js function associated with the queue.
	 */
	functionProps?: NodejsFunctionProps;

	/**
	 * The number of days to retain the logs for the queue.
	 */
	logRetentionDays?: RetentionDays;

	/**
	 * The removal policy for the logs of the queue.
	 */
	logRemovalPolicy?: RemovalPolicy;
}

/**
 * Decorator function defining a queue.
 * @param queueName - The name of the queue.
 * @param queueConfig - Optional configuration for the queue.
 * @returns A class decorator function.
 */
export function Queue(queueName: string, queueConfig?: IQueueConfig) {
	return function <T extends { new (...args: any[]): {} }>(target: T) {
		return class extends target {
			constructor(...args: any[]) {
				super(...args);
				Reflect.set(this, 'queueName', queueName);
				Reflect.set(this, 'queueConfig', queueConfig);
			}
		};
	};
}