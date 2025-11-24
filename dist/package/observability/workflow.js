"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowRun = void 0;
const crypto_1 = require("crypto");
const manager_1 = require("./manager");
class WorkflowRun {
    workflowId;
    traceId;
    workflowName;
    constructor(workflowName, traceId = (0, crypto_1.randomUUID)()) {
        this.workflowId = (0, crypto_1.randomUUID)();
        this.traceId = traceId;
        this.workflowName = workflowName;
        void manager_1.ObservabilityManager.capture({
            type: 'workflow.start',
            level: 'info',
            correlationId: this.traceId,
            entityName: 'workflow',
            entityId: this.workflowId,
            timestampMs: Date.now(),
            operation: workflowName,
        });
    }
    async recordStep(stepName, fn) {
        const stepId = (0, crypto_1.randomUUID)();
        const start = Date.now();
        void manager_1.ObservabilityManager.capture({
            type: 'workflow.step',
            level: 'info',
            correlationId: this.traceId,
            parentLogId: this.workflowId,
            entityName: 'workflow',
            entityId: this.workflowId,
            timestampMs: start,
            operation: stepName,
            status: 'started',
        });
        try {
            const result = await fn();
            void manager_1.ObservabilityManager.capture({
                type: 'workflow.step',
                level: 'info',
                correlationId: this.traceId,
                parentLogId: this.workflowId,
                entityName: 'workflow',
                entityId: this.workflowId,
                timestampMs: Date.now(),
                operation: stepName,
                status: 'completed',
                success: true,
                durationMs: Date.now() - start,
            });
            return result;
        }
        catch (error) {
            void manager_1.ObservabilityManager.capture({
                type: 'workflow.step',
                level: 'error',
                correlationId: this.traceId,
                parentLogId: this.workflowId,
                entityName: 'workflow',
                entityId: this.workflowId,
                timestampMs: Date.now(),
                operation: stepName,
                status: 'failed',
                success: false,
                durationMs: Date.now() - start,
                error: {
                    type: error.name,
                    message: error.message,
                    stack: error.stack,
                },
            });
            throw error;
        }
    }
    end() {
        void manager_1.ObservabilityManager.capture({
            type: 'workflow.end',
            level: 'info',
            correlationId: this.traceId,
            entityName: 'workflow',
            entityId: this.workflowId,
            timestampMs: Date.now(),
            operation: this.workflowName,
            status: 'completed',
            success: true,
        });
    }
}
exports.WorkflowRun = WorkflowRun;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2Zsb3cuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS93b3JrZmxvdy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBb0M7QUFDcEMsdUNBQWlEO0FBRWpELE1BQWEsV0FBVztJQUNMLFVBQVUsQ0FBUztJQUNuQixPQUFPLENBQVM7SUFDaEIsWUFBWSxDQUFTO0lBRXRDLFlBQVksWUFBb0IsRUFBRSxPQUFPLEdBQUcsSUFBQSxtQkFBVSxHQUFFO1FBQ3RELElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBQSxtQkFBVSxHQUFFLENBQUM7UUFDL0IsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLFlBQVksR0FBRyxZQUFZLENBQUM7UUFFakMsS0FBSyw4QkFBb0IsQ0FBQyxPQUFPLENBQUM7WUFDaEMsSUFBSSxFQUFFLGdCQUFnQjtZQUN0QixLQUFLLEVBQUUsTUFBTTtZQUNiLGFBQWEsRUFBRSxJQUFJLENBQUMsT0FBTztZQUMzQixVQUFVLEVBQUUsVUFBVTtZQUN0QixRQUFRLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDekIsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDdkIsU0FBUyxFQUFFLFlBQVk7U0FDeEIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxVQUFVLENBQUksUUFBZ0IsRUFBRSxFQUFvQjtRQUN4RCxNQUFNLE1BQU0sR0FBRyxJQUFBLG1CQUFVLEdBQUUsQ0FBQztRQUM1QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDekIsS0FBSyw4QkFBb0IsQ0FBQyxPQUFPLENBQUM7WUFDaEMsSUFBSSxFQUFFLGVBQWU7WUFDckIsS0FBSyxFQUFFLE1BQU07WUFDYixhQUFhLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDM0IsV0FBVyxFQUFFLElBQUksQ0FBQyxVQUFVO1lBQzVCLFVBQVUsRUFBRSxVQUFVO1lBQ3RCLFFBQVEsRUFBRSxJQUFJLENBQUMsVUFBVTtZQUN6QixXQUFXLEVBQUUsS0FBSztZQUNsQixTQUFTLEVBQUUsUUFBUTtZQUNuQixNQUFNLEVBQUUsU0FBUztTQUNsQixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUM7WUFDSCxNQUFNLE1BQU0sR0FBRyxNQUFNLEVBQUUsRUFBRSxDQUFDO1lBQzFCLEtBQUssOEJBQW9CLENBQUMsT0FBTyxDQUFDO2dCQUNoQyxJQUFJLEVBQUUsZUFBZTtnQkFDckIsS0FBSyxFQUFFLE1BQU07Z0JBQ2IsYUFBYSxFQUFFLElBQUksQ0FBQyxPQUFPO2dCQUMzQixXQUFXLEVBQUUsSUFBSSxDQUFDLFVBQVU7Z0JBQzVCLFVBQVUsRUFBRSxVQUFVO2dCQUN0QixRQUFRLEVBQUUsSUFBSSxDQUFDLFVBQVU7Z0JBQ3pCLFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO2dCQUN2QixTQUFTLEVBQUUsUUFBUTtnQkFDbkIsTUFBTSxFQUFFLFdBQVc7Z0JBQ25CLE9BQU8sRUFBRSxJQUFJO2dCQUNiLFVBQVUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsS0FBSzthQUMvQixDQUFDLENBQUM7WUFDSCxPQUFPLE1BQU0sQ0FBQztRQUNoQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLEtBQUssOEJBQW9CLENBQUMsT0FBTyxDQUFDO2dCQUNoQyxJQUFJLEVBQUUsZUFBZTtnQkFDckIsS0FBSyxFQUFFLE9BQU87Z0JBQ2QsYUFBYSxFQUFFLElBQUksQ0FBQyxPQUFPO2dCQUMzQixXQUFXLEVBQUUsSUFBSSxDQUFDLFVBQVU7Z0JBQzVCLFVBQVUsRUFBRSxVQUFVO2dCQUN0QixRQUFRLEVBQUUsSUFBSSxDQUFDLFVBQVU7Z0JBQ3pCLFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO2dCQUN2QixTQUFTLEVBQUUsUUFBUTtnQkFDbkIsTUFBTSxFQUFFLFFBQVE7Z0JBQ2hCLE9BQU8sRUFBRSxLQUFLO2dCQUNkLFVBQVUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsS0FBSztnQkFDOUIsS0FBSyxFQUFFO29CQUNMLElBQUksRUFBRyxLQUFlLENBQUMsSUFBSTtvQkFDM0IsT0FBTyxFQUFHLEtBQWUsQ0FBQyxPQUFPO29CQUNqQyxLQUFLLEVBQUcsS0FBZSxDQUFDLEtBQUs7aUJBQzlCO2FBQ0YsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxLQUFLLENBQUM7UUFDZCxDQUFDO0lBQ0gsQ0FBQztJQUVELEdBQUc7UUFDRCxLQUFLLDhCQUFvQixDQUFDLE9BQU8sQ0FBQztZQUNoQyxJQUFJLEVBQUUsY0FBYztZQUNwQixLQUFLLEVBQUUsTUFBTTtZQUNiLGFBQWEsRUFBRSxJQUFJLENBQUMsT0FBTztZQUMzQixVQUFVLEVBQUUsVUFBVTtZQUN0QixRQUFRLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDekIsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDdkIsU0FBUyxFQUFFLElBQUksQ0FBQyxZQUFZO1lBQzVCLE1BQU0sRUFBRSxXQUFXO1lBQ25CLE9BQU8sRUFBRSxJQUFJO1NBQ2QsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBeEZELGtDQXdGQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgfSBmcm9tICcuL21hbmFnZXInO1xuXG5leHBvcnQgY2xhc3MgV29ya2Zsb3dSdW4ge1xuICBwcml2YXRlIHJlYWRvbmx5IHdvcmtmbG93SWQ6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSB0cmFjZUlkOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgd29ya2Zsb3dOYW1lOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Iod29ya2Zsb3dOYW1lOiBzdHJpbmcsIHRyYWNlSWQgPSByYW5kb21VVUlEKCkpIHtcbiAgICB0aGlzLndvcmtmbG93SWQgPSByYW5kb21VVUlEKCk7XG4gICAgdGhpcy50cmFjZUlkID0gdHJhY2VJZDtcbiAgICB0aGlzLndvcmtmbG93TmFtZSA9IHdvcmtmbG93TmFtZTtcblxuICAgIHZvaWQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSh7XG4gICAgICB0eXBlOiAnd29ya2Zsb3cuc3RhcnQnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHRoaXMudHJhY2VJZCxcbiAgICAgIGVudGl0eU5hbWU6ICd3b3JrZmxvdycsXG4gICAgICBlbnRpdHlJZDogdGhpcy53b3JrZmxvd0lkLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBvcGVyYXRpb246IHdvcmtmbG93TmFtZSxcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHJlY29yZFN0ZXA8VD4oc3RlcE5hbWU6IHN0cmluZywgZm46ICgpID0+IFByb21pc2U8VD4pIHtcbiAgICBjb25zdCBzdGVwSWQgPSByYW5kb21VVUlEKCk7XG4gICAgY29uc3Qgc3RhcnQgPSBEYXRlLm5vdygpO1xuICAgIHZvaWQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSh7XG4gICAgICB0eXBlOiAnd29ya2Zsb3cuc3RlcCcsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogdGhpcy50cmFjZUlkLFxuICAgICAgcGFyZW50TG9nSWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgIGVudGl0eU5hbWU6ICd3b3JrZmxvdycsXG4gICAgICBlbnRpdHlJZDogdGhpcy53b3JrZmxvd0lkLFxuICAgICAgdGltZXN0YW1wTXM6IHN0YXJ0LFxuICAgICAgb3BlcmF0aW9uOiBzdGVwTmFtZSxcbiAgICAgIHN0YXR1czogJ3N0YXJ0ZWQnLFxuICAgIH0pO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZuKCk7XG4gICAgICB2b2lkIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoe1xuICAgICAgICB0eXBlOiAnd29ya2Zsb3cuc3RlcCcsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IHRoaXMudHJhY2VJZCxcbiAgICAgICAgcGFyZW50TG9nSWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgICAgZW50aXR5TmFtZTogJ3dvcmtmbG93JyxcbiAgICAgICAgZW50aXR5SWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICAgIG9wZXJhdGlvbjogc3RlcE5hbWUsXG4gICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydCxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdm9pZCBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKHtcbiAgICAgICAgdHlwZTogJ3dvcmtmbG93LnN0ZXAnLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogdGhpcy50cmFjZUlkLFxuICAgICAgICBwYXJlbnRMb2dJZDogdGhpcy53b3JrZmxvd0lkLFxuICAgICAgICBlbnRpdHlOYW1lOiAnd29ya2Zsb3cnLFxuICAgICAgICBlbnRpdHlJZDogdGhpcy53b3JrZmxvd0lkLFxuICAgICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgICAgb3BlcmF0aW9uOiBzdGVwTmFtZSxcbiAgICAgICAgc3RhdHVzOiAnZmFpbGVkJyxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydCxcbiAgICAgICAgZXJyb3I6IHtcbiAgICAgICAgICB0eXBlOiAoZXJyb3IgYXMgRXJyb3IpLm5hbWUsXG4gICAgICAgICAgbWVzc2FnZTogKGVycm9yIGFzIEVycm9yKS5tZXNzYWdlLFxuICAgICAgICAgIHN0YWNrOiAoZXJyb3IgYXMgRXJyb3IpLnN0YWNrLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICBlbmQoKTogdm9pZCB7XG4gICAgdm9pZCBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKHtcbiAgICAgIHR5cGU6ICd3b3JrZmxvdy5lbmQnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHRoaXMudHJhY2VJZCxcbiAgICAgIGVudGl0eU5hbWU6ICd3b3JrZmxvdycsXG4gICAgICBlbnRpdHlJZDogdGhpcy53b3JrZmxvd0lkLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBvcGVyYXRpb246IHRoaXMud29ya2Zsb3dOYW1lLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgfSk7XG4gIH1cbn1cblxuIl19