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
        const correlationId = `task-${taskName}-${Date.now()}`;
        const taskSpan = observability_1.SpanObserver.start(`Task ${taskName}`, {
            correlationId,
            attributes: {
                'task.name': taskName,
            },
        });
        let spanEnded = false;
        const finalizeObservability = async (success, error) => {
            if (!spanEnded) {
                taskSpan.end({ success, error });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFzay1jb250cm9sbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS90YXNrLWNvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsdUVBQWtFO0FBRWxFLHFFQUF3RTtBQUV4RSx1REFBeUU7QUFFekU7O0dBRUc7QUFDSCxNQUFlLGNBQWUsU0FBUSwrQ0FBcUI7SUFFL0MsVUFBVTtRQUNsQixPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBSUQ7OztPQUdHO0lBQ08sZ0JBQWdCO1FBQ3hCLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNwQyxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxPQUFPO1lBQUUsT0FBTyxJQUFJLENBQUM7UUFFekMsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxJQUFJLFNBQVMsQ0FBQztRQUN0RCxNQUFNLFdBQVcsR0FBRyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxJQUFJLGFBQWEsRUFBRSxDQUFDO1FBQ2hFLE1BQU0sYUFBYSxHQUFHLEdBQUcsV0FBVyxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDO1FBRXJELE9BQU87WUFDTCxPQUFPLEVBQUUsSUFBSTtZQUNiLE9BQU8sRUFBRSxPQUFPO1lBQ2hCLE9BQU8sRUFBRSxnQkFBZ0I7WUFDekIsVUFBVSxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSTtZQUNqQyxTQUFTLEVBQUUsYUFBYTtZQUN4QixRQUFRLEVBQUUsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRO1lBQy9CLEtBQUssRUFBRTtnQkFDTCxTQUFTLEVBQUUsU0FBUztnQkFDcEIsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLFVBQVUsRUFBRSxRQUFRO2dCQUNwQixTQUFTLEVBQUUsYUFBYTtnQkFDeEIsU0FBUyxFQUFF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RUFBRSxDQUFDO2dCQUNqQixNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztZQUNwRCxDQUFDO1lBRUQsTUFBTSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNsQyxPQUFPLE1BQU0sQ0FBQztRQUNoQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsSUFBSSxFQUFFLEtBQWMsQ0FBQyxDQUFDO1lBQzVELENBQUM7WUFDRCxNQUFNLHFCQUFxQixDQUFDLEtBQUssRUFBRSxLQUFjLENBQUMsQ0FBQztZQUNuRCxNQUFNLEtBQUssQ0FBQztRQUNkLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFFUSx3Q0FBYyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBBdWRpdENvbnRleHQsIFRhc2tBdWRpdENvbnRleHQgfSBmcm9tICcuLi8uLi9hdWRpdC9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEF1ZGl0Q2FwdHVyZVNlcnZpY2UgfSBmcm9tICcuLi8uLi9hdWRpdC9oZWxwZXJzL2F1ZGl0LWhlbHBlcnMnO1xuaW1wb3J0IHsgSVRhc2tDb25maWcgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzL3Rhc2snO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIsIFNwYW5PYnNlcnZlciB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGhhbmRsaW5nIFNjaGVkdWxlIFRhc2tzLlxuICovXG5hYnN0cmFjdCBjbGFzcyBUYXNrQ29udHJvbGxlciBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG5cbiAgcHJvdGVjdGVkIGluaXRpYWxpemUoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBhYnN0cmFjdCBwcm9jZXNzKCk6IFByb21pc2U8YW55PjtcblxuICAvKipcbiAgICogQ3JlYXRlcyBhdWRpdCBjb250ZXh0IGZvciB0aGUgdGFzayBleGVjdXRpb24gZm9sbG93aW5nIHRoZSBleGlzdGluZyBwYXR0ZXJuXG4gICAqIEByZXR1cm5zIEF1ZGl0Q29udGV4dCBvciBudWxsIGlmIGF1ZGl0IGlzIGRpc2FibGVkXG4gICAqL1xuICBwcm90ZWN0ZWQgbWFrZUF1ZGl0Q29udGV4dCgpOiBBdWRpdENvbnRleHQgfCBudWxsIHtcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldFRhc2tDb25maWcoKTtcbiAgICBpZiAoIWNvbmZpZz8uYXVkaXQ/LmVuYWJsZWQpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3Qgb3BlcmF0aW9uTmFtZSA9IHRoaXMuZ2V0VGFza05hbWUoKSB8fCAnZXhlY3V0ZSc7XG4gICAgY29uc3Qgb3BlcmF0aW9uSWQgPSBgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LiR7b3BlcmF0aW9uTmFtZX1gO1xuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBgJHtvcGVyYXRpb25JZH0tJHtEYXRlLm5vdygpfWA7XG5cbiAgICByZXR1cm4ge1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIGxvZ1R5cGU6ICdldmVudCcsXG4gICAgICBzdWJUeXBlOiAndGFza19leGVjdXRpb24nLFxuICAgICAgZW50aXR5TmFtZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgb3BlcmF0aW9uOiBvcGVyYXRpb25OYW1lLFxuICAgICAgY2F0ZWdvcnk6IGNvbmZpZy5hdWRpdC5jYXRlZ29yeSxcbiAgICAgIGFjdG9yOiB7XG4gICAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICBhY3RvcklkOiAnc2NoZWR1bGVyJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ3N5c3RlbScsXG4gICAgICAgIHJlcXVlc3RJZDogY29ycmVsYXRpb25JZCxcbiAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH0sXG4gICAgICBjb3JyZWxhdGlvbjoge1xuICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICBvcGVyYXRpb25JZCxcbiAgICAgICAgcGFyZW50T3BlcmF0aW9uSWQ6IHVuZGVmaW5lZCwgLy8gVGFza3MgdHlwaWNhbGx5IGRvbid0IGhhdmUgcGFyZW50c1xuICAgICAgICBvcGVyYXRpb25UeXBlOiAndGFzaycsXG4gICAgICAgIG9wZXJhdGlvbk5hbWUsXG4gICAgICAgIHN0YXJ0VGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH0sXG4gICAgICBhdWRpdENvbmZpZzogY29uZmlnLmF1ZGl0XG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBhdWRpdCBsb2cgZm9yIHRhc2sgZXhlY3V0aW9uIHN0YXJ0XG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dDogQXVkaXRDb250ZXh0LCB0YXNrQ29udGV4dDogVGFza0F1ZGl0Q29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgdGFza0NvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3IgdGFzayBleGVjdXRpb24gZW5kIChzdWNjZXNzIG9yIGVycm9yKVxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGNhcHR1cmVFbmQoYXVkaXRDb250ZXh0OiBBdWRpdENvbnRleHQsIF9yZXN1bHQ6IGFueSwgZXJyb3I6IEVycm9yIHwgbnVsbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIF9yZXN1bHQsIGVycm9yKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSB0YXNrIGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHByb3RlY3RlZCBnZXRUYXNrQ29uZmlnKCk6IElUYXNrQ29uZmlnIHtcbiAgICByZXR1cm4gKFJlZmxlY3QuZ2V0KHRoaXMsICd0YXNrQ29uZmlnJykgYXMgSVRhc2tDb25maWcpIHx8IHsgc2NoZWR1bGU6ICcnIH07XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgdGFzayBuYW1lXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0VGFza05hbWUoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGhpcywgJ3Rhc2tOYW1lJykgYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIExhbWJkYSBoYW5kbGVyIGZvciB0aGUgdGFzay5cbiAgICovXG4gIGFzeW5jIExhbWJkYUhhbmRsZXIoKTogUHJvbWlzZTxhbnk+IHtcbiAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5pbml0aWFsaXplSW52b2NhdGlvbigpO1xuICAgIGNvbnN0IHRhc2tOYW1lID0gdGhpcy5nZXRUYXNrTmFtZSgpIHx8IHRoaXMuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gYHRhc2stJHt0YXNrTmFtZX0tJHtEYXRlLm5vdygpfWA7XG4gICAgY29uc3QgdGFza1NwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoYFRhc2sgJHt0YXNrTmFtZX1gLCB7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAndGFzay5uYW1lJzogdGFza05hbWUsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGxldCBzcGFuRW5kZWQgPSBmYWxzZTtcbiAgICBjb25zdCBmaW5hbGl6ZU9ic2VydmFiaWxpdHkgPSBhc3luYyAoc3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBFcnJvcikgPT4ge1xuICAgICAgaWYgKCFzcGFuRW5kZWQpIHtcbiAgICAgICAgdGFza1NwYW4uZW5kKHsgc3VjY2VzcywgZXJyb3IgfSk7XG4gICAgICAgIHNwYW5FbmRlZCA9IHRydWU7XG4gICAgICB9XG4gICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgIH07XG5cbiAgICAvLyBDcmVhdGUgYXVkaXQgY29udGV4dFxuICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IHRoaXMubWFrZUF1ZGl0Q29udGV4dCgpO1xuICAgIGNvbnN0IHRhc2tDb250ZXh0OiBUYXNrQXVkaXRDb250ZXh0ID0ge1xuICAgICAgdGFza05hbWU6IHRoaXMuZ2V0VGFza05hbWUoKSxcbiAgICAgIHNjaGVkdWxlOiB0aGlzLmdldFRhc2tDb25maWcoKS5zY2hlZHVsZSxcbiAgICAgIHRyaWdnZXJTb3VyY2U6ICdzY2hlZHVsZWQnLFxuICAgICAgZW52aXJvbm1lbnQ6IHByb2Nlc3MuZW52Lk5PREVfRU5WXG4gICAgfTtcblxuICAgIGlmIChhdWRpdENvbnRleHQpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgdGFza0NvbnRleHQpO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBob29rIGZvciB0aGUgYXBwbGljYXRpb24gdG8gaW5pdGlhbGl6ZSBpdCdzIHN0YXRlLCBEZXBlbmRlbmNpZXMsIGNvbmZpZyBldGNcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZSgpO1xuICAgICAgLy8gRXhlY3V0ZSB0aGUgYXNzb2NpYXRlZCBmdW5jdGlvblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzKCk7XG5cbiAgICAgIGlmIChhdWRpdENvbnRleHQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgcmVzdWx0LCBudWxsKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgZmluYWxpemVPYnNlcnZhYmlsaXR5KHRydWUpO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCBudWxsLCBlcnJvciBhcyBFcnJvcik7XG4gICAgICB9XG4gICAgICBhd2FpdCBmaW5hbGl6ZU9ic2VydmFiaWxpdHkoZmFsc2UsIGVycm9yIGFzIEVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgeyBUYXNrQ29udHJvbGxlciB9O1xuIl19