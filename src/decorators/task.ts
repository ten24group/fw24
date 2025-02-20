import type { ILambdaEnvConfig } from "../interfaces";
import type { CommonLambdaHandlerOptions } from "./decorator-utils";
import { resolveAndExportHandler, setupDIModuleForController, tryImportingEntryPackagesFor } from "./decorator-utils";

/**
 * Represents the configuration for a task.
 */
export type ITaskConfig = CommonLambdaHandlerOptions & {
	/**
	 * The schedule for the task.
	 */
	schedule: string;

	/**
	 * The environment configuration for the task.
	 */
	env?: Array<ILambdaEnvConfig>;
}

/**
 * Decorator function to define a scheduled task.
 * @param taskName - The name of the task.
 * @param taskConfig - Optional configuration for the task.
 * @returns A class decorator function.
 */
export function Task(taskName: string, taskConfig: ITaskConfig) {
	return function <T extends { new(...args: any[]): {} }>(target: T) {
		tryImportingEntryPackagesFor(taskName);

		// Default autoExportLambdaHandler to true if undefined
		taskConfig.autoExportLambdaHandler = taskConfig.autoExportLambdaHandler ?? true;


		// Create an extended class that includes additional setup
		class ExtendedTarget extends target {
			constructor(...args: any[]) {
				super(...args);
				Reflect.set(this, 'taskName', taskName);
				Reflect.set(this, 'taskConfig', taskConfig);
			}
		}

		// Preserve the original class name
		Object.defineProperty(ExtendedTarget, 'name', { value: target.name });

		const container = setupDIModuleForController({
			target: ExtendedTarget,
			module: taskConfig.module || {},
			fallbackToRootContainer: taskConfig.autoExportLambdaHandler
		});

		if (taskConfig.autoExportLambdaHandler) {
			resolveAndExportHandler(ExtendedTarget, container);
		}

		return ExtendedTarget;
	};
}