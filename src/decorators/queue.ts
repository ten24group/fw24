import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { IFunctionResourceAccess } from "../constructs/lambda-function";
import { IQueueSubscriptions } from "../constructs/queue-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";

export interface IQueueConfig {
	queueProps?: QueueProps;
	env?: {
        name: string;
    };
	resourceAccess?: IFunctionResourceAccess;
	subscriptions?: IQueueSubscriptions;
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