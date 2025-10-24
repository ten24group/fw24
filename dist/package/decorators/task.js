"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Task = Task;
require("reflect-metadata");
const decorator_utils_1 = require("./decorator-utils");
const metadata_keys_1 = require("../manifest/metadata-keys");
/**
 * Decorator function to define a scheduled task.
 * @param taskName - The name of the task.
 * @param taskConfig - Optional configuration for the task.
 * @returns A class decorator function.
 */
function Task(taskName, taskConfig) {
    return function (target) {
        (0, decorator_utils_1.tryImportingEntryPackagesFor)(taskName);
        // Default autoExportLambdaHandler to true if undefined
        taskConfig.autoExportLambdaHandler = taskConfig.autoExportLambdaHandler ?? true;
        // Store task metadata using reflect-metadata
        const taskMetadata = {
            name: taskName,
            config: taskConfig
        };
        Reflect.defineMetadata(metadata_keys_1.METADATA_KEYS.TASK, taskMetadata, target);
        // Create an extended class that includes additional setup
        class ExtendedTarget extends target {
            constructor(...args) {
                super(...args);
                Reflect.set(this, 'taskName', taskName);
                Reflect.set(this, 'taskConfig', taskConfig);
            }
        }
        // Preserve the original class name
        Object.defineProperty(ExtendedTarget, 'name', { value: target.name });
        const container = (0, decorator_utils_1.setupDIModuleForController)({
            target: ExtendedTarget,
            module: taskConfig.module || {},
            fallbackToRootContainer: taskConfig.autoExportLambdaHandler
        });
        if (taskConfig.autoExportLambdaHandler) {
            (0, decorator_utils_1.resolveAndExportHandler)(ExtendedTarget, container);
        }
        return ExtendedTarget;
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFzay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9kZWNvcmF0b3JzL3Rhc2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUEyQkEsb0JBdUNDO0FBbEVELDRCQUEwQjtBQUcxQix1REFBc0g7QUFDdEgsNkRBQTZFO0FBaUI3RTs7Ozs7R0FLRztBQUNILFNBQWdCLElBQUksQ0FBQyxRQUFnQixFQUFFLFVBQXVCO0lBQzdELE9BQU8sVUFBaUQsTUFBUztRQUNoRSxJQUFBLDhDQUE0QixFQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRXZDLHVEQUF1RDtRQUN2RCxVQUFVLENBQUMsdUJBQXVCLEdBQUcsVUFBVSxDQUFDLHVCQUF1QixJQUFJLElBQUksQ0FBQztRQUVoRiw2Q0FBNkM7UUFDN0MsTUFBTSxZQUFZLEdBQWlCO1lBQ2xDLElBQUksRUFBRSxRQUFRO1lBQ2QsTUFBTSxFQUFFLFVBQVU7U0FDbEIsQ0FBQztRQUVGLE9BQU8sQ0FBQyxjQUFjLENBQUMsNkJBQWEsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBRWpFLDBEQUEwRDtRQUMxRCxNQUFNLGNBQWUsU0FBUSxNQUFNO1lBQ2xDLFlBQVksR0FBRyxJQUFXO2dCQUN6QixLQUFLLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQztnQkFDZixPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsUUFBUSxDQUFDLENBQUM7Z0JBQ3hDLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRSxVQUFVLENBQUMsQ0FBQztZQUM3QyxDQUFDO1NBQ0Q7UUFFRCxtQ0FBbUM7UUFDbkMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxjQUFjLEVBQUUsTUFBTSxFQUFFLEVBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBRXRFLE1BQU0sU0FBUyxHQUFHLElBQUEsNENBQTBCLEVBQUM7WUFDNUMsTUFBTSxFQUFFLGNBQWM7WUFDdEIsTUFBTSxFQUFFLFVBQVUsQ0FBQyxNQUFNLElBQUksRUFBRTtZQUMvQix1QkFBdUIsRUFBRSxVQUFVLENBQUMsdUJBQXVCO1NBQzNELENBQUMsQ0FBQztRQUVILElBQUksVUFBVSxDQUFDLHVCQUF1QixFQUFFLENBQUM7WUFDeEMsSUFBQSx5Q0FBdUIsRUFBQyxjQUFjLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFDcEQsQ0FBQztRQUVELE9BQU8sY0FBYyxDQUFDO0lBQ3ZCLENBQUMsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgJ3JlZmxlY3QtbWV0YWRhdGEnO1xuaW1wb3J0IHR5cGUgeyBJTGFtYmRhRW52Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB0eXBlIHsgQ29tbW9uTGFtYmRhSGFuZGxlck9wdGlvbnMgfSBmcm9tIFwiLi9kZWNvcmF0b3ItdXRpbHNcIjtcbmltcG9ydCB7IHJlc29sdmVBbmRFeHBvcnRIYW5kbGVyLCBzZXR1cERJTW9kdWxlRm9yQ29udHJvbGxlciwgdHJ5SW1wb3J0aW5nRW50cnlQYWNrYWdlc0ZvciB9IGZyb20gXCIuL2RlY29yYXRvci11dGlsc1wiO1xuaW1wb3J0IHsgTUVUQURBVEFfS0VZUywgdHlwZSBUYXNrTWV0YWRhdGEgfSBmcm9tICcuLi9tYW5pZmVzdC9tZXRhZGF0YS1rZXlzJztcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBjb25maWd1cmF0aW9uIGZvciBhIHRhc2suXG4gKi9cbmV4cG9ydCB0eXBlIElUYXNrQ29uZmlnID0gQ29tbW9uTGFtYmRhSGFuZGxlck9wdGlvbnMgJiB7XG5cdC8qKlxuXHQgKiBUaGUgc2NoZWR1bGUgZm9yIHRoZSB0YXNrLlxuXHQgKi9cblx0c2NoZWR1bGU6IHN0cmluZztcblxuXHQvKipcblx0ICogVGhlIGVudmlyb25tZW50IGNvbmZpZ3VyYXRpb24gZm9yIHRoZSB0YXNrLlxuXHQgKi9cblx0ZW52PzogQXJyYXk8SUxhbWJkYUVudkNvbmZpZz47XG59XG5cbi8qKlxuICogRGVjb3JhdG9yIGZ1bmN0aW9uIHRvIGRlZmluZSBhIHNjaGVkdWxlZCB0YXNrLlxuICogQHBhcmFtIHRhc2tOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIHRhc2suXG4gKiBAcGFyYW0gdGFza0NvbmZpZyAtIE9wdGlvbmFsIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSB0YXNrLlxuICogQHJldHVybnMgQSBjbGFzcyBkZWNvcmF0b3IgZnVuY3Rpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBUYXNrKHRhc2tOYW1lOiBzdHJpbmcsIHRhc2tDb25maWc6IElUYXNrQ29uZmlnKSB7XG5cdHJldHVybiBmdW5jdGlvbiA8VCBleHRlbmRzIHsgbmV3KC4uLmFyZ3M6IGFueVtdKToge30gfT4odGFyZ2V0OiBUKSB7XG5cdFx0dHJ5SW1wb3J0aW5nRW50cnlQYWNrYWdlc0Zvcih0YXNrTmFtZSk7XG5cblx0XHQvLyBEZWZhdWx0IGF1dG9FeHBvcnRMYW1iZGFIYW5kbGVyIHRvIHRydWUgaWYgdW5kZWZpbmVkXG5cdFx0dGFza0NvbmZpZy5hdXRvRXhwb3J0TGFtYmRhSGFuZGxlciA9IHRhc2tDb25maWcuYXV0b0V4cG9ydExhbWJkYUhhbmRsZXIgPz8gdHJ1ZTtcblxuXHRcdC8vIFN0b3JlIHRhc2sgbWV0YWRhdGEgdXNpbmcgcmVmbGVjdC1tZXRhZGF0YVxuXHRcdGNvbnN0IHRhc2tNZXRhZGF0YTogVGFza01ldGFkYXRhID0ge1xuXHRcdFx0bmFtZTogdGFza05hbWUsXG5cdFx0XHRjb25maWc6IHRhc2tDb25maWdcblx0XHR9O1xuXG5cdFx0UmVmbGVjdC5kZWZpbmVNZXRhZGF0YShNRVRBREFUQV9LRVlTLlRBU0ssIHRhc2tNZXRhZGF0YSwgdGFyZ2V0KTtcblxuXHRcdC8vIENyZWF0ZSBhbiBleHRlbmRlZCBjbGFzcyB0aGF0IGluY2x1ZGVzIGFkZGl0aW9uYWwgc2V0dXBcblx0XHRjbGFzcyBFeHRlbmRlZFRhcmdldCBleHRlbmRzIHRhcmdldCB7XG5cdFx0XHRjb25zdHJ1Y3RvciguLi5hcmdzOiBhbnlbXSkge1xuXHRcdFx0XHRzdXBlciguLi5hcmdzKTtcblx0XHRcdFx0UmVmbGVjdC5zZXQodGhpcywgJ3Rhc2tOYW1lJywgdGFza05hbWUpO1xuXHRcdFx0XHRSZWZsZWN0LnNldCh0aGlzLCAndGFza0NvbmZpZycsIHRhc2tDb25maWcpO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdC8vIFByZXNlcnZlIHRoZSBvcmlnaW5hbCBjbGFzcyBuYW1lXG5cdFx0T2JqZWN0LmRlZmluZVByb3BlcnR5KEV4dGVuZGVkVGFyZ2V0LCAnbmFtZScsIHsgdmFsdWU6IHRhcmdldC5uYW1lIH0pO1xuXG5cdFx0Y29uc3QgY29udGFpbmVyID0gc2V0dXBESU1vZHVsZUZvckNvbnRyb2xsZXIoe1xuXHRcdFx0dGFyZ2V0OiBFeHRlbmRlZFRhcmdldCxcblx0XHRcdG1vZHVsZTogdGFza0NvbmZpZy5tb2R1bGUgfHwge30sXG5cdFx0XHRmYWxsYmFja1RvUm9vdENvbnRhaW5lcjogdGFza0NvbmZpZy5hdXRvRXhwb3J0TGFtYmRhSGFuZGxlclxuXHRcdH0pO1xuXG5cdFx0aWYgKHRhc2tDb25maWcuYXV0b0V4cG9ydExhbWJkYUhhbmRsZXIpIHtcblx0XHRcdHJlc29sdmVBbmRFeHBvcnRIYW5kbGVyKEV4dGVuZGVkVGFyZ2V0LCBjb250YWluZXIpO1xuXHRcdH1cblxuXHRcdHJldHVybiBFeHRlbmRlZFRhcmdldDtcblx0fTtcbn0iXX0=