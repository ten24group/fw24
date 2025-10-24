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
        console.log(`[Task] Stored metadata for task: ${taskName}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFzay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9kZWNvcmF0b3JzL3Rhc2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUEyQkEsb0JBMENDO0FBckVELDRCQUEwQjtBQUcxQix1REFBc0g7QUFDdEgsNkRBQTZFO0FBaUI3RTs7Ozs7R0FLRztBQUNILFNBQWdCLElBQUksQ0FBQyxRQUFnQixFQUFFLFVBQXVCO0lBQzdELE9BQU8sVUFBaUQsTUFBUztRQUNoRSxJQUFBLDhDQUE0QixFQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRXZDLHVEQUF1RDtRQUN2RCxVQUFVLENBQUMsdUJBQXVCLEdBQUcsVUFBVSxDQUFDLHVCQUF1QixJQUFJLElBQUksQ0FBQztRQUVoRiw2Q0FBNkM7UUFDN0MsTUFBTSxZQUFZLEdBQWlCO1lBQ2xDLElBQUksRUFBRSxRQUFRO1lBQ2QsTUFBTSxFQUFFLFVBQVU7U0FDbEIsQ0FBQztRQUVGLE9BQU8sQ0FBQyxjQUFjLENBQUMsNkJBQWEsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBRWpFLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0NBQW9DLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFHNUQsMERBQTBEO1FBQzFELE1BQU0sY0FBZSxTQUFRLE1BQU07WUFDbEMsWUFBWSxHQUFHLElBQVc7Z0JBQ3pCLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDO2dCQUNmLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQztnQkFDeEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1lBQzdDLENBQUM7U0FDRDtRQUVELG1DQUFtQztRQUNuQyxNQUFNLENBQUMsY0FBYyxDQUFDLGNBQWMsRUFBRSxNQUFNLEVBQUUsRUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7UUFFdEUsTUFBTSxTQUFTLEdBQUcsSUFBQSw0Q0FBMEIsRUFBQztZQUM1QyxNQUFNLEVBQUUsY0FBYztZQUN0QixNQUFNLEVBQUUsVUFBVSxDQUFDLE1BQU0sSUFBSSxFQUFFO1lBQy9CLHVCQUF1QixFQUFFLFVBQVUsQ0FBQyx1QkFBdUI7U0FDM0QsQ0FBQyxDQUFDO1FBRUgsSUFBSSxVQUFVLENBQUMsdUJBQXVCLEVBQUUsQ0FBQztZQUN4QyxJQUFBLHlDQUF1QixFQUFDLGNBQWMsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUNwRCxDQUFDO1FBRUQsT0FBTyxjQUFjLENBQUM7SUFDdkIsQ0FBQyxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAncmVmbGVjdC1tZXRhZGF0YSc7XG5pbXBvcnQgdHlwZSB7IElMYW1iZGFFbnZDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHR5cGUgeyBDb21tb25MYW1iZGFIYW5kbGVyT3B0aW9ucyB9IGZyb20gXCIuL2RlY29yYXRvci11dGlsc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZUFuZEV4cG9ydEhhbmRsZXIsIHNldHVwRElNb2R1bGVGb3JDb250cm9sbGVyLCB0cnlJbXBvcnRpbmdFbnRyeVBhY2thZ2VzRm9yIH0gZnJvbSBcIi4vZGVjb3JhdG9yLXV0aWxzXCI7XG5pbXBvcnQgeyBNRVRBREFUQV9LRVlTLCB0eXBlIFRhc2tNZXRhZGF0YSB9IGZyb20gJy4uL21hbmlmZXN0L21ldGFkYXRhLWtleXMnO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGNvbmZpZ3VyYXRpb24gZm9yIGEgdGFzay5cbiAqL1xuZXhwb3J0IHR5cGUgSVRhc2tDb25maWcgPSBDb21tb25MYW1iZGFIYW5kbGVyT3B0aW9ucyAmIHtcblx0LyoqXG5cdCAqIFRoZSBzY2hlZHVsZSBmb3IgdGhlIHRhc2suXG5cdCAqL1xuXHRzY2hlZHVsZTogc3RyaW5nO1xuXG5cdC8qKlxuXHQgKiBUaGUgZW52aXJvbm1lbnQgY29uZmlndXJhdGlvbiBmb3IgdGhlIHRhc2suXG5cdCAqL1xuXHRlbnY/OiBBcnJheTxJTGFtYmRhRW52Q29uZmlnPjtcbn1cblxuLyoqXG4gKiBEZWNvcmF0b3IgZnVuY3Rpb24gdG8gZGVmaW5lIGEgc2NoZWR1bGVkIHRhc2suXG4gKiBAcGFyYW0gdGFza05hbWUgLSBUaGUgbmFtZSBvZiB0aGUgdGFzay5cbiAqIEBwYXJhbSB0YXNrQ29uZmlnIC0gT3B0aW9uYWwgY29uZmlndXJhdGlvbiBmb3IgdGhlIHRhc2suXG4gKiBAcmV0dXJucyBBIGNsYXNzIGRlY29yYXRvciBmdW5jdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIFRhc2sodGFza05hbWU6IHN0cmluZywgdGFza0NvbmZpZzogSVRhc2tDb25maWcpIHtcblx0cmV0dXJuIGZ1bmN0aW9uIDxUIGV4dGVuZHMgeyBuZXcoLi4uYXJnczogYW55W10pOiB7fSB9Pih0YXJnZXQ6IFQpIHtcblx0XHR0cnlJbXBvcnRpbmdFbnRyeVBhY2thZ2VzRm9yKHRhc2tOYW1lKTtcblxuXHRcdC8vIERlZmF1bHQgYXV0b0V4cG9ydExhbWJkYUhhbmRsZXIgdG8gdHJ1ZSBpZiB1bmRlZmluZWRcblx0XHR0YXNrQ29uZmlnLmF1dG9FeHBvcnRMYW1iZGFIYW5kbGVyID0gdGFza0NvbmZpZy5hdXRvRXhwb3J0TGFtYmRhSGFuZGxlciA/PyB0cnVlO1xuXG5cdFx0Ly8gU3RvcmUgdGFzayBtZXRhZGF0YSB1c2luZyByZWZsZWN0LW1ldGFkYXRhXG5cdFx0Y29uc3QgdGFza01ldGFkYXRhOiBUYXNrTWV0YWRhdGEgPSB7XG5cdFx0XHRuYW1lOiB0YXNrTmFtZSxcblx0XHRcdGNvbmZpZzogdGFza0NvbmZpZ1xuXHRcdH07XG5cblx0XHRSZWZsZWN0LmRlZmluZU1ldGFkYXRhKE1FVEFEQVRBX0tFWVMuVEFTSywgdGFza01ldGFkYXRhLCB0YXJnZXQpO1xuXHRcdFxuXHRcdGNvbnNvbGUubG9nKGBbVGFza10gU3RvcmVkIG1ldGFkYXRhIGZvciB0YXNrOiAke3Rhc2tOYW1lfWApO1xuXG5cblx0XHQvLyBDcmVhdGUgYW4gZXh0ZW5kZWQgY2xhc3MgdGhhdCBpbmNsdWRlcyBhZGRpdGlvbmFsIHNldHVwXG5cdFx0Y2xhc3MgRXh0ZW5kZWRUYXJnZXQgZXh0ZW5kcyB0YXJnZXQge1xuXHRcdFx0Y29uc3RydWN0b3IoLi4uYXJnczogYW55W10pIHtcblx0XHRcdFx0c3VwZXIoLi4uYXJncyk7XG5cdFx0XHRcdFJlZmxlY3Quc2V0KHRoaXMsICd0YXNrTmFtZScsIHRhc2tOYW1lKTtcblx0XHRcdFx0UmVmbGVjdC5zZXQodGhpcywgJ3Rhc2tDb25maWcnLCB0YXNrQ29uZmlnKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHQvLyBQcmVzZXJ2ZSB0aGUgb3JpZ2luYWwgY2xhc3MgbmFtZVxuXHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShFeHRlbmRlZFRhcmdldCwgJ25hbWUnLCB7IHZhbHVlOiB0YXJnZXQubmFtZSB9KTtcblxuXHRcdGNvbnN0IGNvbnRhaW5lciA9IHNldHVwRElNb2R1bGVGb3JDb250cm9sbGVyKHtcblx0XHRcdHRhcmdldDogRXh0ZW5kZWRUYXJnZXQsXG5cdFx0XHRtb2R1bGU6IHRhc2tDb25maWcubW9kdWxlIHx8IHt9LFxuXHRcdFx0ZmFsbGJhY2tUb1Jvb3RDb250YWluZXI6IHRhc2tDb25maWcuYXV0b0V4cG9ydExhbWJkYUhhbmRsZXJcblx0XHR9KTtcblxuXHRcdGlmICh0YXNrQ29uZmlnLmF1dG9FeHBvcnRMYW1iZGFIYW5kbGVyKSB7XG5cdFx0XHRyZXNvbHZlQW5kRXhwb3J0SGFuZGxlcihFeHRlbmRlZFRhcmdldCwgY29udGFpbmVyKTtcblx0XHR9XG5cblx0XHRyZXR1cm4gRXh0ZW5kZWRUYXJnZXQ7XG5cdH07XG59Il19