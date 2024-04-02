
export interface IQueueConfig {
	tableName?: string;
	env?: IQLambdaEnvConfig[];
	topics?: IQueueSNSConfig[];
}
export interface IQLambdaEnvConfig {
	name: string;
	path: string;
}

export interface IQueueSNSConfig {
	name: string;
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
