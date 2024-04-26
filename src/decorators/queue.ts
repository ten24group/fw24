import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { IFunctionResourceAccess } from "../constructs/lambda-function";
import { IQueueSubscriptions } from "../constructs/queue-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";
import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";

export interface IQueueConfig {
	queueProps?: QueueProps;
	// define timeouts in seconds to avoid importing Duration class from aws-cdk-lib
	visibilityTimeoutSeconds?: number;
	receiveMessageWaitTimeSeconds?: number;
	// define the retention period in days
	retentionPeriodDays?: number;
	env?: {
        name: string;
    };
	resourceAccess?: IFunctionResourceAccess;
	subscriptions?: IQueueSubscriptions;
	// timeout in seconds; use this timeout to avoid importing duration class from aws-cdk-lib
	functionTimeout?: number;
	functionProps?: NodejsFunctionProps;
	logRetentionDays?: RetentionDays;
	logRemovalPolicy?: RemovalPolicy;
}

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