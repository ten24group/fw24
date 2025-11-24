"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logEvent = void 0;
const crypto_1 = require("crypto");
const manager_1 = require("./manager");
const logEvent = (options) => {
    const correlationId = options.traceId ?? (0, crypto_1.randomUUID)();
    const logId = (0, crypto_1.randomUUID)();
    void manager_1.ObservabilityManager.capture({
        type: 'log',
        level: options.level ?? 'info',
        correlationId,
        entityName: options.entityName ?? 'log',
        entityId: options.entityId ?? logId,
        timestampMs: Date.now(),
        operation: options.operation ?? options.message,
        data: {
            message: options.message,
            ...options.data,
        },
        error: options.error
            ? {
                type: options.error.name,
                message: options.error.message,
                stack: options.error.stack,
            }
            : undefined,
    });
};
exports.logEvent = logEvent;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbG9nLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFvQztBQUNwQyx1Q0FBaUQ7QUFjMUMsTUFBTSxRQUFRLEdBQUcsQ0FBQyxPQUFtQixFQUFRLEVBQUU7SUFDcEQsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLE9BQU8sSUFBSSxJQUFBLG1CQUFVLEdBQUUsQ0FBQztJQUN0RCxNQUFNLEtBQUssR0FBRyxJQUFBLG1CQUFVLEdBQUUsQ0FBQztJQUMzQixLQUFLLDhCQUFvQixDQUFDLE9BQU8sQ0FBQztRQUNoQyxJQUFJLEVBQUUsS0FBSztRQUNYLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxJQUFJLE1BQU07UUFDOUIsYUFBYTtRQUNiLFVBQVUsRUFBRSxPQUFPLENBQUMsVUFBVSxJQUFJLEtBQUs7UUFDdkMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRLElBQUksS0FBSztRQUNuQyxXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtRQUN2QixTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsSUFBSSxPQUFPLENBQUMsT0FBTztRQUMvQyxJQUFJLEVBQUU7WUFDSixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87WUFDeEIsR0FBRyxPQUFPLENBQUMsSUFBSTtTQUNoQjtRQUNELEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSztZQUNsQixDQUFDLENBQUM7Z0JBQ0UsSUFBSSxFQUFFLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSTtnQkFDeEIsT0FBTyxFQUFFLE9BQU8sQ0FBQyxLQUFLLENBQUMsT0FBTztnQkFDOUIsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSzthQUMzQjtZQUNILENBQUMsQ0FBQyxTQUFTO0tBQ2QsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDO0FBdkJXLFFBQUEsUUFBUSxZQXVCbkIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlNYW5hZ2VyIH0gZnJvbSAnLi9tYW5hZ2VyJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlFdmVudCB9IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIExvZ09wdGlvbnMge1xuICBsZXZlbD86IE9ic2VydmFiaWxpdHlFdmVudFsnbGV2ZWwnXTtcbiAgbWVzc2FnZTogc3RyaW5nO1xuICBlbnRpdHlOYW1lPzogc3RyaW5nO1xuICBlbnRpdHlJZD86IHN0cmluZztcbiAgb3BlcmF0aW9uPzogc3RyaW5nO1xuICBkYXRhPzogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgZXJyb3I/OiBFcnJvcjtcbiAgdHJhY2VJZD86IHN0cmluZztcbn1cblxuZXhwb3J0IGNvbnN0IGxvZ0V2ZW50ID0gKG9wdGlvbnM6IExvZ09wdGlvbnMpOiB2b2lkID0+IHtcbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IG9wdGlvbnMudHJhY2VJZCA/PyByYW5kb21VVUlEKCk7XG4gIGNvbnN0IGxvZ0lkID0gcmFuZG9tVVVJRCgpO1xuICB2b2lkIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoe1xuICAgIHR5cGU6ICdsb2cnLFxuICAgIGxldmVsOiBvcHRpb25zLmxldmVsID8/ICdpbmZvJyxcbiAgICBjb3JyZWxhdGlvbklkLFxuICAgIGVudGl0eU5hbWU6IG9wdGlvbnMuZW50aXR5TmFtZSA/PyAnbG9nJyxcbiAgICBlbnRpdHlJZDogb3B0aW9ucy5lbnRpdHlJZCA/PyBsb2dJZCxcbiAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICBvcGVyYXRpb246IG9wdGlvbnMub3BlcmF0aW9uID8/IG9wdGlvbnMubWVzc2FnZSxcbiAgICBkYXRhOiB7XG4gICAgICBtZXNzYWdlOiBvcHRpb25zLm1lc3NhZ2UsXG4gICAgICAuLi5vcHRpb25zLmRhdGEsXG4gICAgfSxcbiAgICBlcnJvcjogb3B0aW9ucy5lcnJvclxuICAgICAgPyB7XG4gICAgICAgICAgdHlwZTogb3B0aW9ucy5lcnJvci5uYW1lLFxuICAgICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMuZXJyb3IubWVzc2FnZSxcbiAgICAgICAgICBzdGFjazogb3B0aW9ucy5lcnJvci5zdGFjayxcbiAgICAgICAgfVxuICAgICAgOiB1bmRlZmluZWQsXG4gIH0pO1xufTtcblxuIl19