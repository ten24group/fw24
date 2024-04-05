export interface IQueueConfig {
	env?: {
        name: string;
    },
	tableName?: string,
	topics?: [
        { name: string, actions: string[]}
    ]
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