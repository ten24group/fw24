import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { IFunctionResourceAccess } from "../constructs/lambda-function";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";

export interface ITaskConfig {
	schedule: string;
	env?: {
        name: string;
    };
	// timeout in seconds; use this timeout to avoid importing duration class from aws-cdk-lib
	functionTimeout?: number;
	functionProps?: NodejsFunctionProps;
	resourceAccess?: IFunctionResourceAccess;
	logRetentionDays?: RetentionDays;
	logRemovalPolicy?: RemovalPolicy;
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