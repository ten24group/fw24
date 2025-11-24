"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrudObservabilityHooks = void 0;
const manager_1 = require("./manager");
const span_1 = require("./span");
class CrudObservabilityHooks {
    /**
     * Emit observability event for entity read operation
     */
    static captureEntityRead(entityName, entityId, context) {
        void manager_1.ObservabilityManager.capture({
            type: 'audit',
            subType: 'entity.read',
            level: 'debug',
            correlationId: context?.traceId || '',
            parentLogId: context?.parentLogId,
            timestampMs: Date.now(),
            operation: `${entityName}.get`,
            entityName,
            entityId,
            actor: context?.actor,
        });
    }
    /**
     * Emit observability event for entity create operation
     */
    static captureEntityCreate(entityName, entityId, data, context) {
        void manager_1.ObservabilityManager.capture({
            type: 'audit',
            subType: 'entity.create',
            level: 'info',
            correlationId: context?.traceId || '',
            parentLogId: context?.parentLogId,
            timestampMs: Date.now(),
            operation: `${entityName}.create`,
            entityName,
            entityId,
            data: {
                created: true,
                ...data,
            },
            actor: context?.actor,
        });
    }
    /**
     * Emit observability event for entity update operation
     */
    static captureEntityUpdate(entityName, entityId, changes, context) {
        void manager_1.ObservabilityManager.capture({
            type: 'audit',
            subType: 'entity.update',
            level: 'info',
            correlationId: context?.traceId || '',
            parentLogId: context?.parentLogId,
            timestampMs: Date.now(),
            operation: `${entityName}.update`,
            entityName,
            entityId,
            data: {
                updated: true,
                changes,
            },
            actor: context?.actor,
        });
    }
    /**
     * Emit observability event for entity delete operation
     */
    static captureEntityDelete(entityName, entityId, context) {
        void manager_1.ObservabilityManager.capture({
            type: 'audit',
            subType: 'entity.delete',
            level: 'warn',
            correlationId: context?.traceId || '',
            parentLogId: context?.parentLogId,
            timestampMs: Date.now(),
            operation: `${entityName}.delete`,
            entityName,
            entityId,
            data: {
                deleted: true,
            },
            actor: context?.actor,
        });
    }
    /**
     * Emit observability event for entity query operation
     */
    static captureEntityQuery(entityName, filters, resultCount, context) {
        void manager_1.ObservabilityManager.capture({
            type: 'audit',
            subType: 'entity.query',
            level: 'debug',
            correlationId: context?.traceId || '',
            parentLogId: context?.parentLogId,
            timestampMs: Date.now(),
            operation: `${entityName}.query`,
            entityName,
            data: {
                filters,
                resultCount,
            },
            actor: context?.actor,
        });
    }
    /**
     * Create a span for entity operation (for more detailed tracing)
     */
    static createEntitySpan(operation, entityName, context) {
        return new span_1.Span(`${entityName}.${operation}`, {
            traceId: context?.traceId,
            parentSpanId: context?.parentLogId, // parentLogId maps to parentSpanId in Span constructor
            level: 'debug',
            attributes: {
                'entity.name': entityName,
                'entity.operation': operation,
            },
        });
    }
}
exports.CrudObservabilityHooks = CrudObservabilityHooks;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1ob29rcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2NydWQtaG9va3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsdUNBQWlEO0FBQ2pELGlDQUE4QjtBQWE5QixNQUFhLHNCQUFzQjtJQUNqQzs7T0FFRztJQUNILE1BQU0sQ0FBQyxpQkFBaUIsQ0FDdEIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsT0FBa0M7UUFFbEMsS0FBSyw4QkFBb0IsQ0FBQyxPQUFPLENBQUM7WUFDaEMsSUFBSSxFQUFFLE9BQU87WUFDYixPQUFPLEVBQUUsYUFBYTtZQUN0QixLQUFLLEVBQUUsT0FBTztZQUNkLGFBQWEsRUFBRSxPQUFPLEVBQUUsT0FBTyxJQUFJLEVBQUU7WUFDckMsV0FBVyxFQUFFLE9BQU8sRUFBRSxXQUFXO1lBQ2pDLFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3ZCLFNBQVMsRUFBRSxHQUFHLFVBQVUsTUFBTTtZQUM5QixVQUFVO1lBQ1YsUUFBUTtZQUNSLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSztTQUN0QixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsbUJBQW1CLENBQ3hCLFVBQWtCLEVBQ2xCLFFBQWdCLEVBQ2hCLElBQVMsRUFDVCxPQUFrQztRQUVsQyxLQUFLLDhCQUFvQixDQUFDLE9BQU8sQ0FBQztZQUNoQyxJQUFJLEVBQUUsT0FBTztZQUNiLE9BQU8sRUFBRSxlQUFlO1lBQ3hCLEtBQUssRUFBRSxNQUFNO1lBQ2IsYUFBYSxFQUFFLE9BQU8sRUFBRSxPQUFPLElBQUksRUFBRTtZQUNyQyxXQUFXLEVBQUUsT0FBTyxFQUFFLFdBQVc7WUFDakMsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDdkIsU0FBUyxFQUFFLEdBQUcsVUFBVSxTQUFTO1lBQ2pDLFVBQVU7WUFDVixRQUFRO1lBQ1IsSUFBSSxFQUFFO2dCQUNKLE9BQU8sRUFBRSxJQUFJO2dCQUNiLEdBQUcsSUFBSTthQUNSO1lBQ0QsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLO1NBQ3RCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxtQkFBbUIsQ0FDeEIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsT0FBWSxFQUNaLE9BQWtDO1FBRWxDLEtBQUssOEJBQW9CLENBQUMsT0FBTyxDQUFDO1lBQ2hDLElBQUksRUFBRSxPQUFPO1lBQ2IsT0FBTyxFQUFFLGVBQWU7WUFDeEIsS0FBSyxFQUFFLE1BQU07WUFDYixhQUFhLEVBQUUsT0FBTyxFQUFFLE9BQU8sSUFBSSxFQUFFO1lBQ3JDLFdBQVcsRUFBRSxPQUFPLEVBQUUsV0FBVztZQUNqQyxXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUN2QixTQUFTLEVBQUUsR0FBRyxVQUFVLFNBQVM7WUFDakMsVUFBVTtZQUNWLFFBQVE7WUFDUixJQUFJLEVBQUU7Z0JBQ0osT0FBTyxFQUFFLElBQUk7Z0JBQ2IsT0FBTzthQUNSO1lBQ0QsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLO1NBQ3RCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxtQkFBbUIsQ0FDeEIsVUFBa0IsRUFDbEIsUUFBZ0IsRUFDaEIsT0FBa0M7UUFFbEMsS0FBSyw4QkFBb0IsQ0FBQyxPQUFPLENBQUM7WUFDaEMsSUFBSSxFQUFFLE9BQU87WUFDYixPQUFPLEVBQUUsZUFBZTtZQUN4QixLQUFLLEVBQUUsTUFBTTtZQUNiLGFBQWEsRUFBRSxPQUFPLEVBQUUsT0FBTyxJQUFJLEVBQUU7WUFDckMsV0FBVyxFQUFFLE9BQU8sRUFBRSxXQUFXO1lBQ2pDLFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3ZCLFNBQVMsRUFBRSxHQUFHLFVBQVUsU0FBUztZQUNqQyxVQUFVO1lBQ1YsUUFBUTtZQUNSLElBQUksRUFBRTtnQkFDSixPQUFPLEVBQUUsSUFBSTthQUNkO1lBQ0QsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLO1NBQ3RCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxrQkFBa0IsQ0FDdkIsVUFBa0IsRUFDbEIsT0FBWSxFQUNaLFdBQW1CLEVBQ25CLE9BQWtDO1FBRWxDLEtBQUssOEJBQW9CLENBQUMsT0FBTyxDQUFDO1lBQ2hDLElBQUksRUFBRSxPQUFPO1lBQ2IsT0FBTyxFQUFFLGNBQWM7WUFDdkIsS0FBSyxFQUFFLE9BQU87WUFDZCxhQUFhLEVBQUUsT0FBTyxFQUFFLE9BQU8sSUFBSSxFQUFFO1lBQ3JDLFdBQVcsRUFBRSxPQUFPLEVBQUUsV0FBVztZQUNqQyxXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUN2QixTQUFTLEVBQUUsR0FBRyxVQUFVLFFBQVE7WUFDaEMsVUFBVTtZQUNWLElBQUksRUFBRTtnQkFDSixPQUFPO2dCQUNQLFdBQVc7YUFDWjtZQUNELEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSztTQUN0QixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsZ0JBQWdCLENBQ3JCLFNBQWlCLEVBQ2pCLFVBQWtCLEVBQ2xCLE9BQWtDO1FBRWxDLE9BQU8sSUFBSSxXQUFJLENBQUMsR0FBRyxVQUFVLElBQUksU0FBUyxFQUFFLEVBQUU7WUFDNUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxPQUFPO1lBQ3pCLFlBQVksRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLHVEQUF1RDtZQUMzRixLQUFLLEVBQUUsT0FBTztZQUNkLFVBQVUsRUFBRTtnQkFDVixhQUFhLEVBQUUsVUFBVTtnQkFDekIsa0JBQWtCLEVBQUUsU0FBUzthQUM5QjtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQWxKRCx3REFrSkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciB9IGZyb20gJy4vbWFuYWdlcic7XG5pbXBvcnQgeyBTcGFuIH0gZnJvbSAnLi9zcGFuJztcblxuLyoqXG4gKiBPYnNlcnZhYmlsaXR5IGhvb2tzIGZvciBlbnRpdHkgQ1JVRCBvcGVyYXRpb25zXG4gKiBUaGVzZSBjYW4gYmUgY2FsbGVkIGZyb20gY3J1ZC1zZXJ2aWNlLnRzIHRvIGVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudHNcbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCB7XG4gIHRyYWNlSWQ/OiBzdHJpbmc7XG4gIHBhcmVudExvZ0lkPzogc3RyaW5nO1xuICBhY3Rvcj86IGFueTtcbn1cblxuZXhwb3J0IGNsYXNzIENydWRPYnNlcnZhYmlsaXR5SG9va3Mge1xuICAvKipcbiAgICogRW1pdCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZvciBlbnRpdHkgcmVhZCBvcGVyYXRpb25cbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlRW50aXR5UmVhZChcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWQ6IHN0cmluZyxcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICB2b2lkIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoe1xuICAgICAgdHlwZTogJ2F1ZGl0JyxcbiAgICAgIHN1YlR5cGU6ICdlbnRpdHkucmVhZCcsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQ/LnRyYWNlSWQgfHwgJycsXG4gICAgICBwYXJlbnRMb2dJZDogY29udGV4dD8ucGFyZW50TG9nSWQsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0uZ2V0YCxcbiAgICAgIGVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZCxcbiAgICAgIGFjdG9yOiBjb250ZXh0Py5hY3RvcixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0IG9ic2VydmFiaWxpdHkgZXZlbnQgZm9yIGVudGl0eSBjcmVhdGUgb3BlcmF0aW9uXG4gICAqL1xuICBzdGF0aWMgY2FwdHVyZUVudGl0eUNyZWF0ZShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWQ6IHN0cmluZyxcbiAgICBkYXRhOiBhbnksXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgdm9pZCBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKHtcbiAgICAgIHR5cGU6ICdhdWRpdCcsXG4gICAgICBzdWJUeXBlOiAnZW50aXR5LmNyZWF0ZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dD8udHJhY2VJZCB8fCAnJyxcbiAgICAgIHBhcmVudExvZ0lkOiBjb250ZXh0Py5wYXJlbnRMb2dJZCxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5jcmVhdGVgLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkLFxuICAgICAgZGF0YToge1xuICAgICAgICBjcmVhdGVkOiB0cnVlLFxuICAgICAgICAuLi5kYXRhLFxuICAgICAgfSxcbiAgICAgIGFjdG9yOiBjb250ZXh0Py5hY3RvcixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0IG9ic2VydmFiaWxpdHkgZXZlbnQgZm9yIGVudGl0eSB1cGRhdGUgb3BlcmF0aW9uXG4gICAqL1xuICBzdGF0aWMgY2FwdHVyZUVudGl0eVVwZGF0ZShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWQ6IHN0cmluZyxcbiAgICBjaGFuZ2VzOiBhbnksXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgdm9pZCBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKHtcbiAgICAgIHR5cGU6ICdhdWRpdCcsXG4gICAgICBzdWJUeXBlOiAnZW50aXR5LnVwZGF0ZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dD8udHJhY2VJZCB8fCAnJyxcbiAgICAgIHBhcmVudExvZ0lkOiBjb250ZXh0Py5wYXJlbnRMb2dJZCxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS51cGRhdGVgLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkLFxuICAgICAgZGF0YToge1xuICAgICAgICB1cGRhdGVkOiB0cnVlLFxuICAgICAgICBjaGFuZ2VzLFxuICAgICAgfSxcbiAgICAgIGFjdG9yOiBjb250ZXh0Py5hY3RvcixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0IG9ic2VydmFiaWxpdHkgZXZlbnQgZm9yIGVudGl0eSBkZWxldGUgb3BlcmF0aW9uXG4gICAqL1xuICBzdGF0aWMgY2FwdHVyZUVudGl0eURlbGV0ZShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5SWQ6IHN0cmluZyxcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiB2b2lkIHtcbiAgICB2b2lkIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoe1xuICAgICAgdHlwZTogJ2F1ZGl0JyxcbiAgICAgIHN1YlR5cGU6ICdlbnRpdHkuZGVsZXRlJyxcbiAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0Py50cmFjZUlkIHx8ICcnLFxuICAgICAgcGFyZW50TG9nSWQ6IGNvbnRleHQ/LnBhcmVudExvZ0lkLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBvcGVyYXRpb246IGAke2VudGl0eU5hbWV9LmRlbGV0ZWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGRlbGV0ZWQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgYWN0b3I6IGNvbnRleHQ/LmFjdG9yLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEVtaXQgb2JzZXJ2YWJpbGl0eSBldmVudCBmb3IgZW50aXR5IHF1ZXJ5IG9wZXJhdGlvblxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmVFbnRpdHlRdWVyeShcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZmlsdGVyczogYW55LFxuICAgIHJlc3VsdENvdW50OiBudW1iZXIsXG4gICAgY29udGV4dD86IENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbiAgKTogdm9pZCB7XG4gICAgdm9pZCBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKHtcbiAgICAgIHR5cGU6ICdhdWRpdCcsXG4gICAgICBzdWJUeXBlOiAnZW50aXR5LnF1ZXJ5JyxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dD8udHJhY2VJZCB8fCAnJyxcbiAgICAgIHBhcmVudExvZ0lkOiBjb250ZXh0Py5wYXJlbnRMb2dJZCxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS5xdWVyeWAsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgZGF0YToge1xuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICByZXN1bHRDb3VudCxcbiAgICAgIH0sXG4gICAgICBhY3RvcjogY29udGV4dD8uYWN0b3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgc3BhbiBmb3IgZW50aXR5IG9wZXJhdGlvbiAoZm9yIG1vcmUgZGV0YWlsZWQgdHJhY2luZylcbiAgICovXG4gIHN0YXRpYyBjcmVhdGVFbnRpdHlTcGFuKFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBjb250ZXh0PzogQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LFxuICApOiBTcGFuIHtcbiAgICByZXR1cm4gbmV3IFNwYW4oYCR7ZW50aXR5TmFtZX0uJHtvcGVyYXRpb259YCwge1xuICAgICAgdHJhY2VJZDogY29udGV4dD8udHJhY2VJZCxcbiAgICAgIHBhcmVudFNwYW5JZDogY29udGV4dD8ucGFyZW50TG9nSWQsIC8vIHBhcmVudExvZ0lkIG1hcHMgdG8gcGFyZW50U3BhbklkIGluIFNwYW4gY29uc3RydWN0b3JcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAnZW50aXR5Lm5hbWUnOiBlbnRpdHlOYW1lLFxuICAgICAgICAnZW50aXR5Lm9wZXJhdGlvbic6IG9wZXJhdGlvbixcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cbn1cblxuXG4iXX0=