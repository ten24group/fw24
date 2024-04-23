import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";

export interface ITaskConfig {
	schedule: string;
	env?: {
        name: string;
    },
	functionProps?: NodejsFunctionProps

}

export function Task(taskName: string, taskConfig?: ITaskConfig) {
	return function <T extends { new (...args: any[]): {} }>(target: T) {
		return class extends target {
			constructor(...args: any[]) {
				super(...args);
				Reflect.set(this, 'taskName', taskName);
				Reflect.set(this, 'taskConfig', taskConfig);
			}
		};
	};
}