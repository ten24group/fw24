"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskController = void 0;
const abstract_lambda_handler_1 = require("./abstract-lambda-handler");
const observability_1 = require("../../observability");
const execution_context_1 = require("./execution-context");
/**
 * Base class for handling Schedule Tasks.
 *
 * All handler execution is wrapped in execution context.
 * Configure observability via the @Task decorator:
 *
 * @example
 * ```typescript
 * @Task('my-task', {
 *   schedule: 'rate(1 minute)',
 *   observability: {
 *     source: 'domain:task-type',
 *     tags: { domain: 'sports', frequency: 'frequent' }
 *   }
 * })
 * export class MyTask extends TaskController { }
 * ```
 */
class TaskController extends abstract_lambda_handler_1.AbstractLambdaHandler {
    initialize() {
        return Promise.resolve();
    }
    getTaskConfig() {
        return Reflect.get(this, 'taskConfig') || { schedule: '' };
    }
    getTaskName() {
        return Reflect.get(this, 'taskName');
    }
    async LambdaHandler(_event, context) {
        this.initializeEntryPackagesAndObservability();
        const taskName = this.getTaskName() || this.constructor.name;
        const taskConfig = this.getTaskConfig();
        const obsConfig = taskConfig.observability || {};
        // Use W3C Trace ID format for consistency with observability system
        const correlationId = context?.awsRequestId || (0, observability_1.generateTraceId)();
        // Build automatic tags for consistent observability
        const automaticTags = {
            handler_type: 'task',
            task_name: taskName,
        };
        if (taskConfig.schedule) {
            automaticTags.schedule = taskConfig.schedule;
        }
        // Create execution context with custom source and tags from decorator
        const execCtx = (0, execution_context_1.createExecutionContext)({
            correlationId,
            source: obsConfig.source || `task:${taskName}`,
            tags: {
                ...automaticTags,
                ...obsConfig.tags, // Decorator tags override automatic
            },
        });
        // Run handler within execution context
        return (0, execution_context_1.runWithExecutionContext)(execCtx, async () => {
            // Create span with merged tags (consistent with API Gateway)
            const taskSpan = observability_1.SpanObserver.start(`Task ${taskName}`, {
                correlationId,
                source: obsConfig.source || `task:${taskName}`,
                tags: {
                    ...automaticTags,
                    ...obsConfig.tags, // Decorator tags override automatic
                },
                attributes: {
                    'task.name': taskName,
                    'task.schedule': taskConfig.schedule,
                    ...obsConfig.attributes,
                },
            });
            // Store span ID in execution context for child spans
            (0, execution_context_1.setParentObservabilityLogId)(taskSpan.id);
            // Build task execution context
            const ctx = {
                event: _event,
                lambdaContext: context,
                executionContext: execCtx,
            };
            let spanEnded = false;
            const endSpan = async (success, error, metrics) => {
                if (!spanEnded) {
                    taskSpan.end({ success, error, metrics });
                    spanEnded = true;
                }
                await this.flushObservability();
            };
            const startTime = Date.now();
            try {
                await this.initialize();
                await this.process(ctx);
                const duration = Date.now() - startTime;
                await endSpan(true, undefined, { 'task.duration_ms': duration });
            }
            catch (error) {
                const duration = Date.now() - startTime;
                await endSpan(false, error, {
                    'task.duration_ms': duration,
                    'task.errors': 1,
                });
                throw error;
            }
        });
    }
}
exports.TaskController = TaskController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFzay1jb250cm9sbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS90YXNrLWNvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsdUVBQWtFO0FBRWxFLHVEQUFvRTtBQUNwRSwyREFLNkI7QUFjN0I7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHO0FBQ0gsTUFBZSxjQUFlLFNBQVEsK0NBQXFCO0lBRS9DLFVBQVU7UUFDbEIsT0FBTyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQVFTLGFBQWE7UUFDckIsT0FBUSxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxZQUFZLENBQWlCLElBQUksRUFBRSxRQUFRLEVBQUUsRUFBRSxFQUFFLENBQUM7SUFDOUUsQ0FBQztJQUVTLFdBQVc7UUFDbkIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxVQUFVLENBQXVCLENBQUM7SUFDN0QsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQUMsTUFBdUIsRUFBRSxPQUFpQjtRQUM1RCxJQUFJLENBQUMsdUNBQXVDLEVBQUUsQ0FBQztRQUUvQyxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDN0QsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3hDLE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBQ2pELG9FQUFvRTtRQUNwRSxNQUFNLGFBQWEsR0FBRyxPQUFPLEVBQUUsWUFBWSxJQUFJLElBQUEsK0JBQWUsR0FBRSxDQUFDO1FBRWpFLG9EQUFvRDtRQUNwRCxNQUFNLGFBQWEsR0FBMkI7WUFDNUMsWUFBWSxFQUFFLE1BQU07WUFDcEIsU0FBUyxFQUFFLFFBQVE7U0FDcEIsQ0FBQztRQUNGLElBQUksVUFBVSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ3hCLGFBQWEsQ0FBQyxRQUFRLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQztRQUMvQyxDQUFDO1FBRUQsc0VBQXNFO1FBQ3RFLE1BQU0sT0FBTyxHQUFHLElBQUEsMENBQXNCLEVBQUM7WUFDckMsYUFBYTtZQUNiLE1BQU0sRUFBRSxTQUFTLENBQUMsTUFBTSxJQUFJLFFBQVEsUUFBUSxFQUFFO1lBQzlDLElBQUksRUFBRTtnQkFDSixHQUFHLGFBQWE7Z0JBQ2hCLEdBQUcsU0FBUyxDQUFDLElBQUksRUFBRSxvQ0FBb0M7YUFDeEQ7U0FDRixDQUFDLENBQUM7UUFFSCx1Q0FBdUM7UUFDdkMsT0FBTyxJQUFBLDJDQUF1QixFQUFDLE9BQU8sRUFBRSxLQUFLLElBQUksRUFBRTtZQUNqRCw2REFBNkQ7WUFDN0QsTUFBTSxRQUFRLEdBQUcsNEJBQVksQ0FBQyxLQUFLLENBQUMsUUFBUSxRQUFRLEVBQUUsRUFBRTtnQkFDdEQsYUFBYTtnQkFDYixNQUFNLEVBQUUsU0FBUyxDQUFDLE1BQU0sSUFBSSxRQUFRLFFBQVEsRUFBRTtnQkFDOUMsSUFBSSxFQUFFO29CQUNKLEdBQUcsYUFBYTtvQkFDaEIsR0FBRyxTQUFTLENBQUMsSUFBSSxFQUFFLG9DQUFvQztpQkFDeEQ7Z0JBQ0QsVUFBVSxFQUFFO29CQUNWLFdBQVcsRUFBRSxRQUFRO29CQUNyQixlQUFlLEVBQUUsVUFBVSxDQUFDLFFBQVE7b0JBQ3BDLEdBQUcsU0FBUyxDQUFDLFVBQVU7aUJBQ3hCO2FBQ0YsQ0FBQyxDQUFDO1lBRUgscURBQXFEO1lBQ3JELElBQUEsK0NBQTJCLEVBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBRXpDLCtCQUErQjtZQUMvQixNQUFNLEdBQUcsR0FBeUI7Z0JBQ2hDLEtBQUssRUFBRSxNQUFNO2dCQUNiLGFBQWEsRUFBRSxPQUFPO2dCQUN0QixnQkFBZ0IsRUFBRSxPQUFPO2FBQzFCLENBQUM7WUFFRixJQUFJLFNBQVMsR0FBRyxLQUFLLENBQUM7WUFDdEIsTUFBTSxPQUFPLEdBQUcsS0FBSyxFQUFFLE9BQWdCLEVBQUUsS0FBYSxFQUFFLE9BQWdDLEVBQWlCLEVBQUU7Z0JBQ3pHLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztvQkFDZixRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsQ0FBQyxDQUFDO29CQUMxQyxTQUFTLEdBQUcsSUFBSSxDQUFDO2dCQUNuQixDQUFDO2dCQUNELE1BQU0sSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDbEMsQ0FBQyxDQUFDO1lBRUYsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQzdCLElBQUksQ0FBQztnQkFDSCxNQUFNLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDeEIsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUN4QixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsU0FBUyxDQUFDO2dCQUN4QyxNQUFNLE9BQU8sQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLEVBQUUsa0JBQWtCLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQztZQUNuRSxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsU0FBUyxDQUFDO2dCQUN4QyxNQUFNLE9BQU8sQ0FBQyxLQUFLLEVBQUUsS0FBYyxFQUFFO29CQUNuQyxrQkFBa0IsRUFBRSxRQUFRO29CQUM1QixhQUFhLEVBQUUsQ0FBQztpQkFDakIsQ0FBQyxDQUFDO2dCQUNILE1BQU0sS0FBSyxDQUFDO1lBQ2QsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBRVEsd0NBQWMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb250ZXh0LCBTY2hlZHVsZWRFdmVudCB9IGZyb20gXCJhd3MtbGFtYmRhXCI7XG5pbXBvcnQgeyBBYnN0cmFjdExhbWJkYUhhbmRsZXIgfSBmcm9tIFwiLi9hYnN0cmFjdC1sYW1iZGEtaGFuZGxlclwiO1xuaW1wb3J0IHsgSVRhc2tDb25maWcgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzL3Rhc2snO1xuaW1wb3J0IHsgU3Bhbk9ic2VydmVyLCBnZW5lcmF0ZVRyYWNlSWQgfSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5JztcbmltcG9ydCB7XG4gIEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICBjcmVhdGVFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCxcbiAgc2V0UGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxufSBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuLyoqXG4gKiBUYXNrIGV4ZWN1dGlvbiBjb250ZXh0IC0gY29udGFpbnMgdGFzay1zcGVjaWZpYyBkYXRhIEFORCBleGVjdXRpb24gY29udGV4dC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUYXNrRXhlY3V0aW9uQ29udGV4dCB7XG4gIC8qKiBUaGUgc2NoZWR1bGVkIGV2ZW50IChpZiBhdmFpbGFibGUpICovXG4gIHJlYWRvbmx5IGV2ZW50PzogU2NoZWR1bGVkRXZlbnQ7XG4gIC8qKiBMYW1iZGEgY29udGV4dCAoaWYgYXZhaWxhYmxlKSAqL1xuICByZWFkb25seSBsYW1iZGFDb250ZXh0PzogQ29udGV4dDtcbiAgLyoqIEV4ZWN1dGlvbiBjb250ZXh0IChhbHNvIGF2YWlsYWJsZSB2aWEgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKSkgKi9cbiAgcmVhZG9ubHkgZXhlY3V0aW9uQ29udGV4dDogRXhlY3V0aW9uQ29udGV4dERhdGE7XG59XG5cbi8qKlxuICogQmFzZSBjbGFzcyBmb3IgaGFuZGxpbmcgU2NoZWR1bGUgVGFza3MuXG4gKiBcbiAqIEFsbCBoYW5kbGVyIGV4ZWN1dGlvbiBpcyB3cmFwcGVkIGluIGV4ZWN1dGlvbiBjb250ZXh0LlxuICogQ29uZmlndXJlIG9ic2VydmFiaWxpdHkgdmlhIHRoZSBAVGFzayBkZWNvcmF0b3I6XG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBAVGFzaygnbXktdGFzaycsIHtcbiAqICAgc2NoZWR1bGU6ICdyYXRlKDEgbWludXRlKScsXG4gKiAgIG9ic2VydmFiaWxpdHk6IHtcbiAqICAgICBzb3VyY2U6ICdkb21haW46dGFzay10eXBlJyxcbiAqICAgICB0YWdzOiB7IGRvbWFpbjogJ3Nwb3J0cycsIGZyZXF1ZW5jeTogJ2ZyZXF1ZW50JyB9XG4gKiAgIH1cbiAqIH0pXG4gKiBleHBvcnQgY2xhc3MgTXlUYXNrIGV4dGVuZHMgVGFza0NvbnRyb2xsZXIgeyB9XG4gKiBgYGBcbiAqL1xuYWJzdHJhY3QgY2xhc3MgVGFza0NvbnRyb2xsZXIgZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuXG4gIHByb3RlY3RlZCBpbml0aWFsaXplKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzIHRoZSBzY2hlZHVsZWQgdGFzay5cbiAgICogQHBhcmFtIGN0eCAtIFRhc2sgZXhlY3V0aW9uIGNvbnRleHRcbiAgICovXG4gIGFic3RyYWN0IHByb2Nlc3MoY3R4PzogVGFza0V4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPHZvaWQ+O1xuXG4gIHByb3RlY3RlZCBnZXRUYXNrQ29uZmlnKCk6IElUYXNrQ29uZmlnIHtcbiAgICByZXR1cm4gKFJlZmxlY3QuZ2V0KHRoaXMsICd0YXNrQ29uZmlnJykgYXMgSVRhc2tDb25maWcpIHx8IHsgc2NoZWR1bGU6ICcnIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0VGFza05hbWUoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGhpcywgJ3Rhc2tOYW1lJykgYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICB9XG5cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihfZXZlbnQ/OiBTY2hlZHVsZWRFdmVudCwgY29udGV4dD86IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmluaXRpYWxpemVFbnRyeVBhY2thZ2VzQW5kT2JzZXJ2YWJpbGl0eSgpO1xuXG4gICAgY29uc3QgdGFza05hbWUgPSB0aGlzLmdldFRhc2tOYW1lKCkgfHwgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIGNvbnN0IHRhc2tDb25maWcgPSB0aGlzLmdldFRhc2tDb25maWcoKTtcbiAgICBjb25zdCBvYnNDb25maWcgPSB0YXNrQ29uZmlnLm9ic2VydmFiaWxpdHkgfHwge307XG4gICAgLy8gVXNlIFczQyBUcmFjZSBJRCBmb3JtYXQgZm9yIGNvbnNpc3RlbmN5IHdpdGggb2JzZXJ2YWJpbGl0eSBzeXN0ZW1cbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gY29udGV4dD8uYXdzUmVxdWVzdElkIHx8IGdlbmVyYXRlVHJhY2VJZCgpO1xuXG4gICAgLy8gQnVpbGQgYXV0b21hdGljIHRhZ3MgZm9yIGNvbnNpc3RlbnQgb2JzZXJ2YWJpbGl0eVxuICAgIGNvbnN0IGF1dG9tYXRpY1RhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICBoYW5kbGVyX3R5cGU6ICd0YXNrJyxcbiAgICAgIHRhc2tfbmFtZTogdGFza05hbWUsXG4gICAgfTtcbiAgICBpZiAodGFza0NvbmZpZy5zY2hlZHVsZSkge1xuICAgICAgYXV0b21hdGljVGFncy5zY2hlZHVsZSA9IHRhc2tDb25maWcuc2NoZWR1bGU7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIGV4ZWN1dGlvbiBjb250ZXh0IHdpdGggY3VzdG9tIHNvdXJjZSBhbmQgdGFncyBmcm9tIGRlY29yYXRvclxuICAgIGNvbnN0IGV4ZWNDdHggPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICBzb3VyY2U6IG9ic0NvbmZpZy5zb3VyY2UgfHwgYHRhc2s6JHt0YXNrTmFtZX1gLFxuICAgICAgdGFnczoge1xuICAgICAgICAuLi5hdXRvbWF0aWNUYWdzLFxuICAgICAgICAuLi5vYnNDb25maWcudGFncywgLy8gRGVjb3JhdG9yIHRhZ3Mgb3ZlcnJpZGUgYXV0b21hdGljXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gUnVuIGhhbmRsZXIgd2l0aGluIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgcmV0dXJuIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KGV4ZWNDdHgsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIENyZWF0ZSBzcGFuIHdpdGggbWVyZ2VkIHRhZ3MgKGNvbnNpc3RlbnQgd2l0aCBBUEkgR2F0ZXdheSlcbiAgICAgIGNvbnN0IHRhc2tTcGFuID0gU3Bhbk9ic2VydmVyLnN0YXJ0KGBUYXNrICR7dGFza05hbWV9YCwge1xuICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICBzb3VyY2U6IG9ic0NvbmZpZy5zb3VyY2UgfHwgYHRhc2s6JHt0YXNrTmFtZX1gLFxuICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgLi4uYXV0b21hdGljVGFncyxcbiAgICAgICAgICAuLi5vYnNDb25maWcudGFncywgLy8gRGVjb3JhdG9yIHRhZ3Mgb3ZlcnJpZGUgYXV0b21hdGljXG4gICAgICAgIH0sXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAndGFzay5uYW1lJzogdGFza05hbWUsXG4gICAgICAgICAgJ3Rhc2suc2NoZWR1bGUnOiB0YXNrQ29uZmlnLnNjaGVkdWxlLFxuICAgICAgICAgIC4uLm9ic0NvbmZpZy5hdHRyaWJ1dGVzLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFN0b3JlIHNwYW4gSUQgaW4gZXhlY3V0aW9uIGNvbnRleHQgZm9yIGNoaWxkIHNwYW5zXG4gICAgICBzZXRQYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQodGFza1NwYW4uaWQpO1xuXG4gICAgICAvLyBCdWlsZCB0YXNrIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgICBjb25zdCBjdHg6IFRhc2tFeGVjdXRpb25Db250ZXh0ID0ge1xuICAgICAgICBldmVudDogX2V2ZW50LFxuICAgICAgICBsYW1iZGFDb250ZXh0OiBjb250ZXh0LFxuICAgICAgICBleGVjdXRpb25Db250ZXh0OiBleGVjQ3R4LFxuICAgICAgfTtcblxuICAgICAgbGV0IHNwYW5FbmRlZCA9IGZhbHNlO1xuICAgICAgY29uc3QgZW5kU3BhbiA9IGFzeW5jIChzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IEVycm9yLCBtZXRyaWNzPzogUmVjb3JkPHN0cmluZywgbnVtYmVyPik6IFByb21pc2U8dm9pZD4gPT4ge1xuICAgICAgICBpZiAoIXNwYW5FbmRlZCkge1xuICAgICAgICAgIHRhc2tTcGFuLmVuZCh7IHN1Y2Nlc3MsIGVycm9yLCBtZXRyaWNzIH0pO1xuICAgICAgICAgIHNwYW5FbmRlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5mbHVzaE9ic2VydmFiaWxpdHkoKTtcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wcm9jZXNzKGN0eCk7XG4gICAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgYXdhaXQgZW5kU3Bhbih0cnVlLCB1bmRlZmluZWQsIHsgJ3Rhc2suZHVyYXRpb25fbXMnOiBkdXJhdGlvbiB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgYXdhaXQgZW5kU3BhbihmYWxzZSwgZXJyb3IgYXMgRXJyb3IsIHtcbiAgICAgICAgICAndGFzay5kdXJhdGlvbl9tcyc6IGR1cmF0aW9uLFxuICAgICAgICAgICd0YXNrLmVycm9ycyc6IDEsXG4gICAgICAgIH0pO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG5leHBvcnQgeyBUYXNrQ29udHJvbGxlciB9O1xuIl19