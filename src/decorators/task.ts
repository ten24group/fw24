import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { IFunctionResourceAccess } from "../constructs/lambda-function";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";

/**
 * Represents the configuration for a task.
 */
export interface ITaskConfig {
	/**
	 * The schedule for the task.
	 */
	schedule: string;

	/**
	 * The environment configuration for the task.
	 */
	env?: {
		name: string;
	};

	/**
	 * The timeout for the task in seconds.
	 * Use this timeout to avoid importing the duration class from aws-cdk-lib.
	 */
	functionTimeout?: number;

	/**
	 * The function properties for the task.
	 */
	functionProps?: NodejsFunctionProps;

	/**
	 * The resource access configuration for the task.
	 */
	resourceAccess?: IFunctionResourceAccess;

	/**
	 * The number of days to retain the task's logs.
	 */
	logRetentionDays?: RetentionDays;

	/**
	 * The removal policy for the task's logs.
	 */
	logRemovalPolicy?: RemovalPolicy;
}

/**
 * Decorator function to define a scheduled task.
 * @param taskName - The name of the task.
 * @param taskConfig - Optional configuration for the task.
 * @returns A class decorator function.
 */
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