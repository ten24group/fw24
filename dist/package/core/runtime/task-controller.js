"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskController = void 0;
const abstract_lambda_handler_1 = require("./abstract-lambda-handler");
const audit_helpers_1 = require("../../audit/helpers/audit-helpers");
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
            return result;
        }
        catch (error) {
            if (auditContext) {
                await this.captureEnd(auditContext, null, error);
            }
            throw error;
        }
    }
}
exports.TaskController = TaskController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFzay1jb250cm9sbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS90YXNrLWNvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsdUVBQWtFO0FBRWxFLHFFQUF3RTtBQUd4RTs7R0FFRztBQUNILE1BQWUsY0FBZSxTQUFRLCtDQUFxQjtJQUUvQyxVQUFVO1FBQ2xCLE9BQU8sT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQzNCLENBQUM7SUFJRDs7O09BR0c7SUFDTyxnQkFBZ0I7UUFDeEIsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3BDLElBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLE9BQU87WUFBRSxPQUFPLElBQUksQ0FBQztRQUV6QyxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLElBQUksU0FBUyxDQUFDO1FBQ3RELE1BQU0sV0FBVyxHQUFHLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLElBQUksYUFBYSxFQUFFLENBQUM7UUFDaEUsTUFBTSxhQUFhLEdBQUcsR0FBRyxXQUFXLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUM7UUFFckQsT0FBTztZQUNMLE9BQU8sRUFBRSxJQUFJO1lBQ2IsT0FBTyxFQUFFLE9BQU87WUFDaEIsT0FBTyxFQUFFLGdCQUFnQjtZQUN6QixVQUFVLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJO1lBQ2pDLFNBQVMsRUFBRSxhQUFhO1lBQ3hCLFFBQVEsRUFBRSxNQUFNLENBQUMsS0FBSyxDQUFDLFFBQVE7WUFDL0IsS0FBSyxFQUFFO2dCQUNMLFNBQVMsRUFBRSxTQUFTO2dCQUNwQixPQUFPLEVBQUUsV0FBVztnQkFDcEIsVUFBVSxFQUFFLFFBQVE7Z0JBQ3BCLFNBQVMsRUFBRSxhQUFhO2dCQUN4QixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7YUFDcEM7WUFDRCxXQUFXLEVBQUU7Z0JBQ1gsYUFBYTtnQkFDYixXQUFXO2dCQUNYLGlCQUFpQixFQUFFLFNBQVMsRUFBRSxxQ0FBcUM7Z0JBQ25FLGFBQWEsRUFBRSxNQUFNO2dCQUNyQixhQUFhO2dCQUNiLGNBQWMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTthQUN6QztZQUNELFdBQVcsRUFBRSxNQUFNLENBQUMsS0FBSztTQUMxQixDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ08sS0FBSyxDQUFDLFlBQVksQ0FBQyxZQUEwQixFQUFFLFdBQTZCO1FBQ3BGLE1BQU0sbUNBQW1CLENBQUMsWUFBWSxDQUFDLFlBQVksRUFBRSxXQUFXLENBQUMsQ0FBQztJQUNwRSxDQUFDO0lBRUQ7O09BRUc7SUFDTyxLQUFLLENBQUMsVUFBVSxDQUFDLFlBQTBCLEVBQUUsT0FBWSxFQUFFLEtBQW1CO1FBQ3RGLE1BQU0sbUNBQW1CLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDckUsQ0FBQztJQUVEOztPQUVHO0lBQ08sYUFBYTtRQUNyQixPQUFRLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFlBQVksQ0FBaUIsSUFBSSxFQUFFLFFBQVEsRUFBRSxFQUFFLEVBQUUsQ0FBQztJQUM5RSxDQUFDO0lBRUQ7O09BRUc7SUFDTyxXQUFXO1FBQ25CLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsVUFBVSxDQUF1QixDQUFDO0lBQzdELENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxhQUFhO1FBQ2YsdUJBQXVCO1FBQ3ZCLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1FBQzdDLE1BQU0sV0FBVyxHQUFxQjtZQUNwQyxRQUFRLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRTtZQUM1QixRQUFRLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDLFFBQVE7WUFDdkMsYUFBYSxFQUFFLFdBQVc7WUFDMUIsV0FBVyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUTtTQUNsQyxDQUFDO1FBRUYsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNqQixNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsWUFBWSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1FBQ3JELENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCw4RUFBOEU7WUFDOUUsTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDeEIsa0NBQWtDO1lBQ2xDLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBRXBDLElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1lBQ3BELENBQUM7WUFFRCxPQUFPLE1BQU0sQ0FBQztRQUNoQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsSUFBSSxFQUFFLEtBQWMsQ0FBQyxDQUFDO1lBQzVELENBQUM7WUFDRCxNQUFNLEtBQUssQ0FBQztRQUNkLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFFUSx3Q0FBYyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBBdWRpdENvbnRleHQsIFRhc2tBdWRpdENvbnRleHQgfSBmcm9tICcuLi8uLi9hdWRpdC9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEF1ZGl0Q2FwdHVyZVNlcnZpY2UgfSBmcm9tICcuLi8uLi9hdWRpdC9oZWxwZXJzL2F1ZGl0LWhlbHBlcnMnO1xuaW1wb3J0IHsgSVRhc2tDb25maWcgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzL3Rhc2snO1xuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGhhbmRsaW5nIFNjaGVkdWxlIFRhc2tzLlxuICovXG5hYnN0cmFjdCBjbGFzcyBUYXNrQ29udHJvbGxlciBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG5cbiAgcHJvdGVjdGVkIGluaXRpYWxpemUoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBhYnN0cmFjdCBwcm9jZXNzKCk6IFByb21pc2U8YW55PjtcblxuICAvKipcbiAgICogQ3JlYXRlcyBhdWRpdCBjb250ZXh0IGZvciB0aGUgdGFzayBleGVjdXRpb24gZm9sbG93aW5nIHRoZSBleGlzdGluZyBwYXR0ZXJuXG4gICAqIEByZXR1cm5zIEF1ZGl0Q29udGV4dCBvciBudWxsIGlmIGF1ZGl0IGlzIGRpc2FibGVkXG4gICAqL1xuICBwcm90ZWN0ZWQgbWFrZUF1ZGl0Q29udGV4dCgpOiBBdWRpdENvbnRleHQgfCBudWxsIHtcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldFRhc2tDb25maWcoKTtcbiAgICBpZiAoIWNvbmZpZz8uYXVkaXQ/LmVuYWJsZWQpIHJldHVybiBudWxsO1xuICAgIFxuICAgIGNvbnN0IG9wZXJhdGlvbk5hbWUgPSB0aGlzLmdldFRhc2tOYW1lKCkgfHwgJ2V4ZWN1dGUnO1xuICAgIGNvbnN0IG9wZXJhdGlvbklkID0gYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS4ke29wZXJhdGlvbk5hbWV9YDtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gYCR7b3BlcmF0aW9uSWR9LSR7RGF0ZS5ub3coKX1gO1xuICAgIFxuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbG9nVHlwZTogJ2V2ZW50JyxcbiAgICAgIHN1YlR5cGU6ICd0YXNrX2V4ZWN1dGlvbicsXG4gICAgICBlbnRpdHlOYW1lOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICBvcGVyYXRpb246IG9wZXJhdGlvbk5hbWUsXG4gICAgICBjYXRlZ29yeTogY29uZmlnLmF1ZGl0LmNhdGVnb3J5LFxuICAgICAgYWN0b3I6IHtcbiAgICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICAgIGFjdG9ySWQ6ICdzY2hlZHVsZXInLFxuICAgICAgICBhdXRoTWV0aG9kOiAnc3lzdGVtJyxcbiAgICAgICAgcmVxdWVzdElkOiBjb3JyZWxhdGlvbklkLFxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfSxcbiAgICAgIGNvcnJlbGF0aW9uOiB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgIG9wZXJhdGlvbklkLFxuICAgICAgICBwYXJlbnRPcGVyYXRpb25JZDogdW5kZWZpbmVkLCAvLyBUYXNrcyB0eXBpY2FsbHkgZG9uJ3QgaGF2ZSBwYXJlbnRzXG4gICAgICAgIG9wZXJhdGlvblR5cGU6ICd0YXNrJyxcbiAgICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgICAgc3RhcnRUaW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfSxcbiAgICAgIGF1ZGl0Q29uZmlnOiBjb25maWcuYXVkaXRcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3IgdGFzayBleGVjdXRpb24gc3RhcnRcbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBjYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0OiBBdWRpdENvbnRleHQsIHRhc2tDb250ZXh0OiBUYXNrQXVkaXRDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCB0YXNrQ29udGV4dCk7XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYXVkaXQgbG9nIGZvciB0YXNrIGV4ZWN1dGlvbiBlbmQgKHN1Y2Nlc3Mgb3IgZXJyb3IpXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZUVuZChhdWRpdENvbnRleHQ6IEF1ZGl0Q29udGV4dCwgX3Jlc3VsdDogYW55LCBlcnJvcjogRXJyb3IgfCBudWxsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgX3Jlc3VsdCwgZXJyb3IpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIHRhc2sgY29uZmlndXJhdGlvblxuICAgKi9cbiAgcHJvdGVjdGVkIGdldFRhc2tDb25maWcoKTogSVRhc2tDb25maWcge1xuICAgIHJldHVybiAoUmVmbGVjdC5nZXQodGhpcywgJ3Rhc2tDb25maWcnKSBhcyBJVGFza0NvbmZpZykgfHwgeyBzY2hlZHVsZTogJycgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSB0YXNrIG5hbWVcbiAgICovXG4gIHByb3RlY3RlZCBnZXRUYXNrTmFtZSgpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0aGlzLCAndGFza05hbWUnKSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogTGFtYmRhIGhhbmRsZXIgZm9yIHRoZSB0YXNrLlxuICAgKi9cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcigpOiBQcm9taXNlPGFueT4ge1xuICAgICAgLy8gQ3JlYXRlIGF1ZGl0IGNvbnRleHRcbiAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IHRoaXMubWFrZUF1ZGl0Q29udGV4dCgpO1xuICAgICAgY29uc3QgdGFza0NvbnRleHQ6IFRhc2tBdWRpdENvbnRleHQgPSB7XG4gICAgICAgIHRhc2tOYW1lOiB0aGlzLmdldFRhc2tOYW1lKCksXG4gICAgICAgIHNjaGVkdWxlOiB0aGlzLmdldFRhc2tDb25maWcoKS5zY2hlZHVsZSxcbiAgICAgICAgdHJpZ2dlclNvdXJjZTogJ3NjaGVkdWxlZCcsXG4gICAgICAgIGVudmlyb25tZW50OiBwcm9jZXNzLmVudi5OT0RFX0VOVlxuICAgICAgfTtcbiAgICAgIFxuICAgICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHRhc2tDb250ZXh0KTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gaG9vayBmb3IgdGhlIGFwcGxpY2F0aW9uIHRvIGluaXRpYWxpemUgaXQncyBzdGF0ZSwgRGVwZW5kZW5jaWVzLCBjb25maWcgZXRjXG4gICAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZSgpO1xuICAgICAgICAvLyBFeGVjdXRlIHRoZSBhc3NvY2lhdGVkIGZ1bmN0aW9uXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucHJvY2VzcygpO1xuICAgICAgICBcbiAgICAgICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIHJlc3VsdCwgbnVsbCk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoYXVkaXRDb250ZXh0KSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgbnVsbCwgZXJyb3IgYXMgRXJyb3IpO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICB9XG59XG5cbmV4cG9ydCB7IFRhc2tDb250cm9sbGVyIH07Il19