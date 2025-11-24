"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskController = void 0;
const abstract_lambda_handler_1 = require("./abstract-lambda-handler");
const audit_helpers_1 = require("../../audit/helpers/audit-helpers");
const observability_1 = require("../../observability");
/**
 * Base class for handling Schedule Tasks.
 */
class TaskController extends abstract_lambda_handler_1.AbstractLambdaHandler {
    initialize() {
        return Promise.resolve();
    }
    /**
     * Creates audit context for the task execution following the existing pattern
     * @returns AuditContext or null if audit is disabled
     */
    makeAuditContext() {
        const config = this.getTaskConfig();
        if (!config?.audit?.enabled)
            return null;
        const operationName = this.getTaskName() || 'execute';
        const operationId = `${this.constructor.name}.${operationName}`;
        const correlationId = `${operationId}-${Date.now()}`;
        return {
            enabled: true,
            logType: 'event',
            subType: 'task_execution',
            entityName: this.constructor.name,
            operation: operationName,
            category: config.audit.category,
            actor: {
                actorType: 'service',
                actorId: 'scheduler',
                authMethod: 'system',
                requestId: correlationId,
                timestamp: new Date().toISOString()
            },
            correlation: {
                correlationId,
                operationId,
                parentOperationId: undefined, // Tasks typically don't have parents
                operationType: 'task',
                operationName,
                startTimestamp: new Date().toISOString()
            },
            auditConfig: config.audit
        };
    }
    /**
     * Captures audit log for task execution start
     */
    async captureStart(auditContext, taskContext) {
        await audit_helpers_1.AuditCaptureService.captureStart(auditContext, taskContext);
    }
    /**
     * Captures audit log for task execution end (success or error)
     */
    async captureEnd(auditContext, _result, error) {
        await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, _result, error);
    }
    /**
     * Gets the task configuration
     */
    getTaskConfig() {
        return Reflect.get(this, 'taskConfig') || { schedule: '' };
    }
    /**
     * Gets the task name
     */
    getTaskName() {
        return Reflect.get(this, 'taskName');
    }
    /**
     * Lambda handler for the task.
     */
    async LambdaHandler() {
        observability_1.ObservabilityManager.initializeInvocation();
        const taskName = this.getTaskName() || this.constructor.name;
        const taskSpan = new observability_1.Span(`Task ${taskName}`, {});
        let spanEnded = false;
        const finalizeObservability = async (success, error) => {
            if (!spanEnded) {
                await taskSpan.end({ success, error });
                spanEnded = true;
            }
            await observability_1.ObservabilityManager.flush();
        };
        // Create audit context
        const auditContext = this.makeAuditContext();
        const taskContext = {
            taskName: this.getTaskName(),
            schedule: this.getTaskConfig().schedule,
            triggerSource: 'scheduled',
            environment: process.env.NODE_ENV
        };
        if (auditContext) {
            await this.captureStart(auditContext, taskContext);
        }
        try {
            // hook for the application to initialize it's state, Dependencies, config etc
            await this.initialize();
            // Execute the associated function
            const result = await this.process();
            if (auditContext) {
                await this.captureEnd(auditContext, result, null);
            }
            await finalizeObservability(true);
            return result;
        }
        catch (error) {
            if (auditContext) {
                await this.captureEnd(auditContext, null, error);
            }
            await finalizeObservability(false, error);
            throw error;
        }
    }
}
exports.TaskController = TaskController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFzay1jb250cm9sbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS90YXNrLWNvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsdUVBQWtFO0FBRWxFLHFFQUF3RTtBQUV4RSx1REFBaUU7QUFFakU7O0dBRUc7QUFDSCxNQUFlLGNBQWUsU0FBUSwrQ0FBcUI7SUFFL0MsVUFBVTtRQUNsQixPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBSUQ7OztPQUdHO0lBQ08sZ0JBQWdCO1FBQ3hCLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNwQyxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxPQUFPO1lBQUUsT0FBTyxJQUFJLENBQUM7UUFFekMsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxJQUFJLFNBQVMsQ0FBQztRQUN0RCxNQUFNLFdBQVcsR0FBRyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxJQUFJLGFBQWEsRUFBRSxDQUFDO1FBQ2hFLE1BQU0sYUFBYSxHQUFHLEdBQUcsV0FBVyxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDO1FBRXJELE9BQU87WUFDTCxPQUFPLEVBQUUsSUFBSTtZQUNiLE9BQU8sRUFBRSxPQUFPO1lBQ2hCLE9BQU8sRUFBRSxnQkFBZ0I7WUFDekIsVUFBVSxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSTtZQUNqQyxTQUFTLEVBQUUsYUFBYTtZQUN4QixRQUFRLEVBQUUsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRO1lBQy9CLEtBQUssRUFBRTtnQkFDTCxTQUFTLEVBQUUsU0FBUztnQkFDcEIsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLFVBQVUsRUFBRSxRQUFRO2dCQUNwQixTQUFTLEVBQUUsYUFBYTtnQkFDeEIsU0FBUyxFQUFF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QyxDQUFDO1lBQ2xDLE9BQU8sTUFBTSxDQUFDO1FBQ2hCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxZQUFZLEVBQUUsQ0FBQztnQkFDakIsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxJQUFJLEVBQUUsS0FBYyxDQUFDLENBQUM7WUFDNUQsQ0FBQztZQUNELE1BQU0scUJBQXFCLENBQUMsS0FBSyxFQUFFLEtBQWMsQ0FBQyxDQUFDO1lBQ25ELE1BQU0sS0FBSyxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7Q0FDRjtBQUVRLHdDQUFjIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcbmltcG9ydCB7IEF1ZGl0Q29udGV4dCwgVGFza0F1ZGl0Q29udGV4dCB9IGZyb20gJy4uLy4uL2F1ZGl0L2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQXVkaXRDYXB0dXJlU2VydmljZSB9IGZyb20gJy4uLy4uL2F1ZGl0L2hlbHBlcnMvYXVkaXQtaGVscGVycyc7XG5pbXBvcnQgeyBJVGFza0NvbmZpZyB9IGZyb20gJy4uLy4uL2RlY29yYXRvcnMvdGFzayc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciwgU3BhbiB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGhhbmRsaW5nIFNjaGVkdWxlIFRhc2tzLlxuICovXG5hYnN0cmFjdCBjbGFzcyBUYXNrQ29udHJvbGxlciBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG5cbiAgcHJvdGVjdGVkIGluaXRpYWxpemUoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBhYnN0cmFjdCBwcm9jZXNzKCk6IFByb21pc2U8YW55PjtcblxuICAvKipcbiAgICogQ3JlYXRlcyBhdWRpdCBjb250ZXh0IGZvciB0aGUgdGFzayBleGVjdXRpb24gZm9sbG93aW5nIHRoZSBleGlzdGluZyBwYXR0ZXJuXG4gICAqIEByZXR1cm5zIEF1ZGl0Q29udGV4dCBvciBudWxsIGlmIGF1ZGl0IGlzIGRpc2FibGVkXG4gICAqL1xuICBwcm90ZWN0ZWQgbWFrZUF1ZGl0Q29udGV4dCgpOiBBdWRpdENvbnRleHQgfCBudWxsIHtcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldFRhc2tDb25maWcoKTtcbiAgICBpZiAoIWNvbmZpZz8uYXVkaXQ/LmVuYWJsZWQpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3Qgb3BlcmF0aW9uTmFtZSA9IHRoaXMuZ2V0VGFza05hbWUoKSB8fCAnZXhlY3V0ZSc7XG4gICAgY29uc3Qgb3BlcmF0aW9uSWQgPSBgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LiR7b3BlcmF0aW9uTmFtZX1gO1xuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBgJHtvcGVyYXRpb25JZH0tJHtEYXRlLm5vdygpfWA7XG5cbiAgICByZXR1cm4ge1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIGxvZ1R5cGU6ICdldmVudCcsXG4gICAgICBzdWJUeXBlOiAndGFza19leGVjdXRpb24nLFxuICAgICAgZW50aXR5TmFtZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgb3BlcmF0aW9uOiBvcGVyYXRpb25OYW1lLFxuICAgICAgY2F0ZWdvcnk6IGNvbmZpZy5hdWRpdC5jYXRlZ29yeSxcbiAgICAgIGFjdG9yOiB7XG4gICAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICBhY3RvcklkOiAnc2NoZWR1bGVyJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ3N5c3RlbScsXG4gICAgICAgIHJlcXVlc3RJZDogY29ycmVsYXRpb25JZCxcbiAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH0sXG4gICAgICBjb3JyZWxhdGlvbjoge1xuICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICBvcGVyYXRpb25JZCxcbiAgICAgICAgcGFyZW50T3BlcmF0aW9uSWQ6IHVuZGVmaW5lZCwgLy8gVGFza3MgdHlwaWNhbGx5IGRvbid0IGhhdmUgcGFyZW50c1xuICAgICAgICBvcGVyYXRpb25UeXBlOiAndGFzaycsXG4gICAgICAgIG9wZXJhdGlvbk5hbWUsXG4gICAgICAgIHN0YXJ0VGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH0sXG4gICAgICBhdWRpdENvbmZpZzogY29uZmlnLmF1ZGl0XG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBhdWRpdCBsb2cgZm9yIHRhc2sgZXhlY3V0aW9uIHN0YXJ0XG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dDogQXVkaXRDb250ZXh0LCB0YXNrQ29udGV4dDogVGFza0F1ZGl0Q29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgdGFza0NvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3IgdGFzayBleGVjdXRpb24gZW5kIChzdWNjZXNzIG9yIGVycm9yKVxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGNhcHR1cmVFbmQoYXVkaXRDb250ZXh0OiBBdWRpdENvbnRleHQsIF9yZXN1bHQ6IGFueSwgZXJyb3I6IEVycm9yIHwgbnVsbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIF9yZXN1bHQsIGVycm9yKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSB0YXNrIGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHByb3RlY3RlZCBnZXRUYXNrQ29uZmlnKCk6IElUYXNrQ29uZmlnIHtcbiAgICByZXR1cm4gKFJlZmxlY3QuZ2V0KHRoaXMsICd0YXNrQ29uZmlnJykgYXMgSVRhc2tDb25maWcpIHx8IHsgc2NoZWR1bGU6ICcnIH07XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgdGFzayBuYW1lXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0VGFza05hbWUoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGhpcywgJ3Rhc2tOYW1lJykgYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIExhbWJkYSBoYW5kbGVyIGZvciB0aGUgdGFzay5cbiAgICovXG4gIGFzeW5jIExhbWJkYUhhbmRsZXIoKTogUHJvbWlzZTxhbnk+IHtcbiAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5pbml0aWFsaXplSW52b2NhdGlvbigpO1xuICAgIGNvbnN0IHRhc2tOYW1lID0gdGhpcy5nZXRUYXNrTmFtZSgpIHx8IHRoaXMuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCB0YXNrU3BhbiA9IG5ldyBTcGFuKGBUYXNrICR7dGFza05hbWV9YCwge1xuICAgICAgXG4gICAgfSk7XG4gICAgbGV0IHNwYW5FbmRlZCA9IGZhbHNlO1xuICAgIGNvbnN0IGZpbmFsaXplT2JzZXJ2YWJpbGl0eSA9IGFzeW5jIChzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IEVycm9yKSA9PiB7XG4gICAgICBpZiAoIXNwYW5FbmRlZCkge1xuICAgICAgICBhd2FpdCB0YXNrU3Bhbi5lbmQoeyBzdWNjZXNzLCBlcnJvciB9KTtcbiAgICAgICAgc3BhbkVuZGVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgfTtcblxuICAgIC8vIENyZWF0ZSBhdWRpdCBjb250ZXh0XG4gICAgY29uc3QgYXVkaXRDb250ZXh0ID0gdGhpcy5tYWtlQXVkaXRDb250ZXh0KCk7XG4gICAgY29uc3QgdGFza0NvbnRleHQ6IFRhc2tBdWRpdENvbnRleHQgPSB7XG4gICAgICB0YXNrTmFtZTogdGhpcy5nZXRUYXNrTmFtZSgpLFxuICAgICAgc2NoZWR1bGU6IHRoaXMuZ2V0VGFza0NvbmZpZygpLnNjaGVkdWxlLFxuICAgICAgdHJpZ2dlclNvdXJjZTogJ3NjaGVkdWxlZCcsXG4gICAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlZcbiAgICB9O1xuXG4gICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCB0YXNrQ29udGV4dCk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIGhvb2sgZm9yIHRoZSBhcHBsaWNhdGlvbiB0byBpbml0aWFsaXplIGl0J3Mgc3RhdGUsIERlcGVuZGVuY2llcywgY29uZmlnIGV0Y1xuICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplKCk7XG4gICAgICAvLyBFeGVjdXRlIHRoZSBhc3NvY2lhdGVkIGZ1bmN0aW9uXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3MoKTtcblxuICAgICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCByZXN1bHQsIG51bGwpO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCBmaW5hbGl6ZU9ic2VydmFiaWxpdHkodHJ1ZSk7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoYXVkaXRDb250ZXh0KSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIG51bGwsIGVycm9yIGFzIEVycm9yKTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IGZpbmFsaXplT2JzZXJ2YWJpbGl0eShmYWxzZSwgZXJyb3IgYXMgRXJyb3IpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCB7IFRhc2tDb250cm9sbGVyIH07XG4iXX0=