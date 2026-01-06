"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Task = Task;
const decorator_utils_1 = require("./decorator-utils");
/**
 * Decorator function to define a scheduled task.
 * @param taskName - The name of the task.
 * @param taskConfig - Optional configuration for the task.
 * @returns A class decorator function.
 */
function Task(taskName, taskConfig) {
    return function (target) {
        // Entry packages are auto-loaded by fw24 layer - no need to call here
        // Default autoExportLambdaHandler to true if undefined
        taskConfig.autoExportLambdaHandler = taskConfig.autoExportLambdaHandler ?? true;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFzay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9kZWNvcmF0b3JzL3Rhc2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUF5QkEsb0JBZ0NDO0FBdkRELHVEQUF3RjtBQWlCeEY7Ozs7O0dBS0c7QUFDSCxTQUFnQixJQUFJLENBQUMsUUFBZ0IsRUFBRSxVQUF1QjtJQUM3RCxPQUFPLFVBQWlELE1BQVM7UUFDaEUsc0VBQXNFO1FBRXRFLHVEQUF1RDtRQUN2RCxVQUFVLENBQUMsdUJBQXVCLEdBQUcsVUFBVSxDQUFDLHVCQUF1QixJQUFJLElBQUksQ0FBQztRQUdoRiwwREFBMEQ7UUFDMUQsTUFBTSxjQUFlLFNBQVEsTUFBTTtZQUNsQyxZQUFZLEdBQUcsSUFBVztnQkFDekIsS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUM7Z0JBQ2YsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxDQUFDO2dCQUN4QyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUUsVUFBVSxDQUFDLENBQUM7WUFDN0MsQ0FBQztTQUNEO1FBRUQsbUNBQW1DO1FBQ25DLE1BQU0sQ0FBQyxjQUFjLENBQUMsY0FBYyxFQUFFLE1BQU0sRUFBRSxFQUFFLEtBQUssRUFBRSxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUV0RSxNQUFNLFNBQVMsR0FBRyxJQUFBLDRDQUEwQixFQUFDO1lBQzVDLE1BQU0sRUFBRSxjQUFjO1lBQ3RCLE1BQU0sRUFBRSxVQUFVLENBQUMsTUFBTSxJQUFJLEVBQUU7WUFDL0IsdUJBQXVCLEVBQUUsVUFBVSxDQUFDLHVCQUF1QjtTQUMzRCxDQUFDLENBQUM7UUFFSCxJQUFJLFVBQVUsQ0FBQyx1QkFBdUIsRUFBRSxDQUFDO1lBQ3hDLElBQUEseUNBQXVCLEVBQUMsY0FBYyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQ3BELENBQUM7UUFFRCxPQUFPLGNBQWMsQ0FBQztJQUN2QixDQUFDLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBJTGFtYmRhRW52Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB0eXBlIHsgQ29tbW9uTGFtYmRhSGFuZGxlck9wdGlvbnMgfSBmcm9tIFwiLi9kZWNvcmF0b3ItdXRpbHNcIjtcbmltcG9ydCB7IHJlc29sdmVBbmRFeHBvcnRIYW5kbGVyLCBzZXR1cERJTW9kdWxlRm9yQ29udHJvbGxlciB9IGZyb20gXCIuL2RlY29yYXRvci11dGlsc1wiO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGNvbmZpZ3VyYXRpb24gZm9yIGEgdGFzay5cbiAqL1xuZXhwb3J0IHR5cGUgSVRhc2tDb25maWcgPSBDb21tb25MYW1iZGFIYW5kbGVyT3B0aW9ucyAmIHtcblx0LyoqXG5cdCAqIFRoZSBzY2hlZHVsZSBmb3IgdGhlIHRhc2suXG5cdCAqL1xuXHRzY2hlZHVsZTogc3RyaW5nO1xuXG5cdC8qKlxuXHQgKiBUaGUgZW52aXJvbm1lbnQgY29uZmlndXJhdGlvbiBmb3IgdGhlIHRhc2suXG5cdCAqL1xuXHRlbnY/OiBBcnJheTxJTGFtYmRhRW52Q29uZmlnPjtcbn1cblxuLyoqXG4gKiBEZWNvcmF0b3IgZnVuY3Rpb24gdG8gZGVmaW5lIGEgc2NoZWR1bGVkIHRhc2suXG4gKiBAcGFyYW0gdGFza05hbWUgLSBUaGUgbmFtZSBvZiB0aGUgdGFzay5cbiAqIEBwYXJhbSB0YXNrQ29uZmlnIC0gT3B0aW9uYWwgY29uZmlndXJhdGlvbiBmb3IgdGhlIHRhc2suXG4gKiBAcmV0dXJucyBBIGNsYXNzIGRlY29yYXRvciBmdW5jdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIFRhc2sodGFza05hbWU6IHN0cmluZywgdGFza0NvbmZpZzogSVRhc2tDb25maWcpIHtcblx0cmV0dXJuIGZ1bmN0aW9uIDxUIGV4dGVuZHMgeyBuZXcoLi4uYXJnczogYW55W10pOiB7fSB9Pih0YXJnZXQ6IFQpIHtcblx0XHQvLyBFbnRyeSBwYWNrYWdlcyBhcmUgYXV0by1sb2FkZWQgYnkgZncyNCBsYXllciAtIG5vIG5lZWQgdG8gY2FsbCBoZXJlXG5cblx0XHQvLyBEZWZhdWx0IGF1dG9FeHBvcnRMYW1iZGFIYW5kbGVyIHRvIHRydWUgaWYgdW5kZWZpbmVkXG5cdFx0dGFza0NvbmZpZy5hdXRvRXhwb3J0TGFtYmRhSGFuZGxlciA9IHRhc2tDb25maWcuYXV0b0V4cG9ydExhbWJkYUhhbmRsZXIgPz8gdHJ1ZTtcblxuXG5cdFx0Ly8gQ3JlYXRlIGFuIGV4dGVuZGVkIGNsYXNzIHRoYXQgaW5jbHVkZXMgYWRkaXRpb25hbCBzZXR1cFxuXHRcdGNsYXNzIEV4dGVuZGVkVGFyZ2V0IGV4dGVuZHMgdGFyZ2V0IHtcblx0XHRcdGNvbnN0cnVjdG9yKC4uLmFyZ3M6IGFueVtdKSB7XG5cdFx0XHRcdHN1cGVyKC4uLmFyZ3MpO1xuXHRcdFx0XHRSZWZsZWN0LnNldCh0aGlzLCAndGFza05hbWUnLCB0YXNrTmFtZSk7XG5cdFx0XHRcdFJlZmxlY3Quc2V0KHRoaXMsICd0YXNrQ29uZmlnJywgdGFza0NvbmZpZyk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0Ly8gUHJlc2VydmUgdGhlIG9yaWdpbmFsIGNsYXNzIG5hbWVcblx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoRXh0ZW5kZWRUYXJnZXQsICduYW1lJywgeyB2YWx1ZTogdGFyZ2V0Lm5hbWUgfSk7XG5cblx0XHRjb25zdCBjb250YWluZXIgPSBzZXR1cERJTW9kdWxlRm9yQ29udHJvbGxlcih7XG5cdFx0XHR0YXJnZXQ6IEV4dGVuZGVkVGFyZ2V0LFxuXHRcdFx0bW9kdWxlOiB0YXNrQ29uZmlnLm1vZHVsZSB8fCB7fSxcblx0XHRcdGZhbGxiYWNrVG9Sb290Q29udGFpbmVyOiB0YXNrQ29uZmlnLmF1dG9FeHBvcnRMYW1iZGFIYW5kbGVyXG5cdFx0fSk7XG5cblx0XHRpZiAodGFza0NvbmZpZy5hdXRvRXhwb3J0TGFtYmRhSGFuZGxlcikge1xuXHRcdFx0cmVzb2x2ZUFuZEV4cG9ydEhhbmRsZXIoRXh0ZW5kZWRUYXJnZXQsIGNvbnRhaW5lcik7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIEV4dGVuZGVkVGFyZ2V0O1xuXHR9O1xufSJdfQ==