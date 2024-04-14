import { QueueProps } from "aws-cdk-lib/aws-sqs";

export interface IQueueConfig {
	queueProps?: QueueProps;
	env?: {
        name: string;
    },
	tableName?: string,
	topics?: Array<{ name: string, actions: string[]}>
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