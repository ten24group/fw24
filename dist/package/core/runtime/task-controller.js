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
        // Create service actor for task - enables actor context injection in entity services
        const taskActor = {
            actorType: 'service',
            authMethod: 'system',
            actorId: `task:${taskName}`,
            requestId: context?.awsRequestId || correlationId,
            timestamp: new Date().toISOString(),
            correlationId, // Task is the root trigger, so use its own correlationId
        };
        // Create execution context with custom source and tags from decorator
        const execCtx = (0, execution_context_1.createExecutionContext)({
            correlationId,
            actor: taskActor,
            source: obsConfig.source || `task:${taskName}`,
            tags: {
                ...automaticTags,
                ...obsConfig.tags, // Decorator tags override automatic
            },
        });
        // Build task execution context
        const ctx = {
            event: _event,
            lambdaContext: context,
            executionContext: execCtx,
        };
        // Run handler within execution context
        return (0, execution_context_1.runWithExecutionContext)(execCtx, async () => {
            // Use the base class helper for span + flush pattern
            return this.executeWithSpanAndFlush(`Task ${taskName}`, async (taskSpan) => {
                const startTime = Date.now();
                try {
                    await this.initialize();
                    await this.process(ctx);
                    const duration = Date.now() - startTime;
                    taskSpan.metrics({
                        'task.duration_ms': duration,
                    });
                    // Flush happens automatically in executeWithSpanAndFlush's finally block
                }
                catch (error) {
                    const duration = Date.now() - startTime;
                    taskSpan.metrics({
                        'task.duration_ms': duration,
                        'task.errors': 1,
                    });
                    // Flush happens automatically in executeWithSpanAndFlush's finally block
                    throw error;
                }
            }, {
                correlationId,
                actor: taskActor,
                source: obsConfig.source || `task:${taskName}`,
                tags: {
                    ...automaticTags,
                    ...obsConfig.tags,
                    'task.name': taskName,
                    'task.schedule': taskConfig.schedule || '',
                },
            }, context);
        });
    }
}
exports.TaskController = TaskController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFzay1jb250cm9sbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS90YXNrLWNvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsdUVBQWtFO0FBRWxFLHVEQUFvRTtBQUNwRSwyREFJNkI7QUFlN0I7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHO0FBQ0gsTUFBZSxjQUFlLFNBQVEsK0NBQXFCO0lBRS9DLFVBQVU7UUFDbEIsT0FBTyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQVFTLGFBQWE7UUFDckIsT0FBUSxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxZQUFZLENBQWlCLElBQUksRUFBRSxRQUFRLEVBQUUsRUFBRSxFQUFFLENBQUM7SUFDOUUsQ0FBQztJQUVTLFdBQVc7UUFDbkIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxVQUFVLENBQXVCLENBQUM7SUFDN0QsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQUMsTUFBdUIsRUFBRSxPQUFpQjtRQUM1RCxJQUFJLENBQUMsdUNBQXVDLEVBQUUsQ0FBQztRQUUvQyxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDN0QsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3hDLE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBQ2pELG9FQUFvRTtRQUNwRSxNQUFNLGFBQWEsR0FBRyxPQUFPLEVBQUUsWUFBWSxJQUFJLElBQUEsK0JBQWUsR0FBRSxDQUFDO1FBRWpFLG9EQUFvRDtRQUNwRCxNQUFNLGFBQWEsR0FBMkI7WUFDNUMsWUFBWSxFQUFFLE1BQU07WUFDcEIsU0FBUyxFQUFFLFFBQVE7U0FDcEIsQ0FBQztRQUNGLElBQUksVUFBVSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ3hCLGFBQWEsQ0FBQyxRQUFRLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQztRQUMvQyxDQUFDO1FBRUQscUZBQXFGO1FBQ3JGLE1BQU0sU0FBUyxHQUFVO1lBQ3ZCLFNBQVMsRUFBRSxTQUFTO1lBQ3BCLFVBQVUsRUFBRSxRQUFRO1lBQ3BCLE9BQU8sRUFBRSxRQUFRLFFBQVEsRUFBRTtZQUMzQixTQUFTLEVBQUUsT0FBTyxFQUFFLFlBQVksSUFBSSxhQUFhO1lBQ2pELFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtZQUNuQyxhQUFhLEVBQUcseURBQXlEO1NBQzFFLENBQUM7UUFFRixzRUFBc0U7UUFDdEUsTUFBTSxPQUFPLEdBQUcsSUFBQSwwQ0FBc0IsRUFBQztZQUNyQyxhQUFhO1lBQ2IsS0FBSyxFQUFFLFNBQVM7WUFDaEIsTUFBTSxFQUFFLFNBQVMsQ0FBQyxNQUFNLElBQUksUUFBUSxRQUFRLEVBQUU7WUFDOUMsSUFBSSxFQUFFO2dCQUNKLEdBQUcsYUFBYTtnQkFDaEIsR0FBRyxTQUFTLENBQUMsSUFBSSxFQUFFLG9DQUFvQzthQUN4RDtTQUNGLENBQUMsQ0FBQztRQUVILCtCQUErQjtRQUMvQixNQUFNLEdBQUcsR0FBeUI7WUFDaEMsS0FBSyxFQUFFLE1BQU07WUFDYixhQUFhLEVBQUUsT0FBTztZQUN0QixnQkFBZ0IsRUFBRSxPQUFPO1NBQzFCLENBQUM7UUFFRix1Q0FBdUM7UUFDdkMsT0FBTyxJQUFBLDJDQUF1QixFQUFDLE9BQU8sRUFBRSxLQUFLLElBQUksRUFBRTtZQUNqRCxxREFBcUQ7WUFDckQsT0FBTyxJQUFJLENBQUMsdUJBQXVCLENBQ2pDLFFBQVEsUUFBUSxFQUFFLEVBQ2xCLEtBQUssRUFBRSxRQUFRLEVBQUUsRUFBRTtnQkFDakIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO2dCQUM3QixJQUFJLENBQUM7b0JBQ0gsTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7b0JBQ3hCLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDeEIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQztvQkFDeEMsUUFBUSxDQUFDLE9BQU8sQ0FBQzt3QkFDZixrQkFBa0IsRUFBRSxRQUFRO3FCQUM3QixDQUFDLENBQUM7b0JBQ0gseUVBQXlFO2dCQUMzRSxDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2YsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQztvQkFDeEMsUUFBUSxDQUFDLE9BQU8sQ0FBQzt3QkFDZixrQkFBa0IsRUFBRSxRQUFRO3dCQUM1QixhQUFhLEVBQUUsQ0FBQztxQkFDakIsQ0FBQyxDQUFDO29CQUNILHlFQUF5RTtvQkFDekUsTUFBTSxLQUFLLENBQUM7Z0JBQ2QsQ0FBQztZQUNILENBQUMsRUFDRDtnQkFDRSxhQUFhO2dCQUNiLEtBQUssRUFBRSxTQUFTO2dCQUNoQixNQUFNLEVBQUUsU0FBUyxDQUFDLE1BQU0sSUFBSSxRQUFRLFFBQVEsRUFBRTtnQkFDOUMsSUFBSSxFQUFFO29CQUNKLEdBQUcsYUFBYTtvQkFDaEIsR0FBRyxTQUFTLENBQUMsSUFBSTtvQkFDakIsV0FBVyxFQUFFLFFBQVE7b0JBQ3JCLGVBQWUsRUFBRSxVQUFVLENBQUMsUUFBUSxJQUFJLEVBQUU7aUJBQzNDO2FBQ0YsRUFDRCxPQUFPLENBQ1IsQ0FBQztRQUNKLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBRVEsd0NBQWMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb250ZXh0LCBTY2hlZHVsZWRFdmVudCB9IGZyb20gXCJhd3MtbGFtYmRhXCI7XG5pbXBvcnQgeyBBYnN0cmFjdExhbWJkYUhhbmRsZXIgfSBmcm9tIFwiLi9hYnN0cmFjdC1sYW1iZGEtaGFuZGxlclwiO1xuaW1wb3J0IHsgSVRhc2tDb25maWcgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzL3Rhc2snO1xuaW1wb3J0IHsgU3Bhbk9ic2VydmVyLCBnZW5lcmF0ZVRyYWNlSWQgfSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5JztcbmltcG9ydCB7XG4gIEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICBjcmVhdGVFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCxcbn0gZnJvbSAnLi9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuLyoqXG4gKiBUYXNrIGV4ZWN1dGlvbiBjb250ZXh0IC0gY29udGFpbnMgdGFzay1zcGVjaWZpYyBkYXRhIEFORCBleGVjdXRpb24gY29udGV4dC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUYXNrRXhlY3V0aW9uQ29udGV4dCB7XG4gIC8qKiBUaGUgc2NoZWR1bGVkIGV2ZW50IChpZiBhdmFpbGFibGUpICovXG4gIHJlYWRvbmx5IGV2ZW50PzogU2NoZWR1bGVkRXZlbnQ7XG4gIC8qKiBMYW1iZGEgY29udGV4dCAoaWYgYXZhaWxhYmxlKSAqL1xuICByZWFkb25seSBsYW1iZGFDb250ZXh0PzogQ29udGV4dDtcbiAgLyoqIEV4ZWN1dGlvbiBjb250ZXh0IChhbHNvIGF2YWlsYWJsZSB2aWEgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKSkgKi9cbiAgcmVhZG9ubHkgZXhlY3V0aW9uQ29udGV4dDogRXhlY3V0aW9uQ29udGV4dERhdGE7XG59XG5cbi8qKlxuICogQmFzZSBjbGFzcyBmb3IgaGFuZGxpbmcgU2NoZWR1bGUgVGFza3MuXG4gKiBcbiAqIEFsbCBoYW5kbGVyIGV4ZWN1dGlvbiBpcyB3cmFwcGVkIGluIGV4ZWN1dGlvbiBjb250ZXh0LlxuICogQ29uZmlndXJlIG9ic2VydmFiaWxpdHkgdmlhIHRoZSBAVGFzayBkZWNvcmF0b3I6XG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBAVGFzaygnbXktdGFzaycsIHtcbiAqICAgc2NoZWR1bGU6ICdyYXRlKDEgbWludXRlKScsXG4gKiAgIG9ic2VydmFiaWxpdHk6IHtcbiAqICAgICBzb3VyY2U6ICdkb21haW46dGFzay10eXBlJyxcbiAqICAgICB0YWdzOiB7IGRvbWFpbjogJ3Nwb3J0cycsIGZyZXF1ZW5jeTogJ2ZyZXF1ZW50JyB9XG4gKiAgIH1cbiAqIH0pXG4gKiBleHBvcnQgY2xhc3MgTXlUYXNrIGV4dGVuZHMgVGFza0NvbnRyb2xsZXIgeyB9XG4gKiBgYGBcbiAqL1xuYWJzdHJhY3QgY2xhc3MgVGFza0NvbnRyb2xsZXIgZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuXG4gIHByb3RlY3RlZCBpbml0aWFsaXplKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzIHRoZSBzY2hlZHVsZWQgdGFzay5cbiAgICogQHBhcmFtIGN0eCAtIFRhc2sgZXhlY3V0aW9uIGNvbnRleHRcbiAgICovXG4gIGFic3RyYWN0IHByb2Nlc3MoY3R4PzogVGFza0V4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPHZvaWQ+O1xuXG4gIHByb3RlY3RlZCBnZXRUYXNrQ29uZmlnKCk6IElUYXNrQ29uZmlnIHtcbiAgICByZXR1cm4gKFJlZmxlY3QuZ2V0KHRoaXMsICd0YXNrQ29uZmlnJykgYXMgSVRhc2tDb25maWcpIHx8IHsgc2NoZWR1bGU6ICcnIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0VGFza05hbWUoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGhpcywgJ3Rhc2tOYW1lJykgYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICB9XG5cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihfZXZlbnQ/OiBTY2hlZHVsZWRFdmVudCwgY29udGV4dD86IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmluaXRpYWxpemVFbnRyeVBhY2thZ2VzQW5kT2JzZXJ2YWJpbGl0eSgpO1xuXG4gICAgY29uc3QgdGFza05hbWUgPSB0aGlzLmdldFRhc2tOYW1lKCkgfHwgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIGNvbnN0IHRhc2tDb25maWcgPSB0aGlzLmdldFRhc2tDb25maWcoKTtcbiAgICBjb25zdCBvYnNDb25maWcgPSB0YXNrQ29uZmlnLm9ic2VydmFiaWxpdHkgfHwge307XG4gICAgLy8gVXNlIFczQyBUcmFjZSBJRCBmb3JtYXQgZm9yIGNvbnNpc3RlbmN5IHdpdGggb2JzZXJ2YWJpbGl0eSBzeXN0ZW1cbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gY29udGV4dD8uYXdzUmVxdWVzdElkIHx8IGdlbmVyYXRlVHJhY2VJZCgpO1xuXG4gICAgLy8gQnVpbGQgYXV0b21hdGljIHRhZ3MgZm9yIGNvbnNpc3RlbnQgb2JzZXJ2YWJpbGl0eVxuICAgIGNvbnN0IGF1dG9tYXRpY1RhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICBoYW5kbGVyX3R5cGU6ICd0YXNrJyxcbiAgICAgIHRhc2tfbmFtZTogdGFza05hbWUsXG4gICAgfTtcbiAgICBpZiAodGFza0NvbmZpZy5zY2hlZHVsZSkge1xuICAgICAgYXV0b21hdGljVGFncy5zY2hlZHVsZSA9IHRhc2tDb25maWcuc2NoZWR1bGU7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIHNlcnZpY2UgYWN0b3IgZm9yIHRhc2sgLSBlbmFibGVzIGFjdG9yIGNvbnRleHQgaW5qZWN0aW9uIGluIGVudGl0eSBzZXJ2aWNlc1xuICAgIGNvbnN0IHRhc2tBY3RvcjogQWN0b3IgPSB7XG4gICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgIGF1dGhNZXRob2Q6ICdzeXN0ZW0nLFxuICAgICAgYWN0b3JJZDogYHRhc2s6JHt0YXNrTmFtZX1gLFxuICAgICAgcmVxdWVzdElkOiBjb250ZXh0Py5hd3NSZXF1ZXN0SWQgfHwgY29ycmVsYXRpb25JZCxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgY29ycmVsYXRpb25JZCwgIC8vIFRhc2sgaXMgdGhlIHJvb3QgdHJpZ2dlciwgc28gdXNlIGl0cyBvd24gY29ycmVsYXRpb25JZFxuICAgIH07XG5cbiAgICAvLyBDcmVhdGUgZXhlY3V0aW9uIGNvbnRleHQgd2l0aCBjdXN0b20gc291cmNlIGFuZCB0YWdzIGZyb20gZGVjb3JhdG9yXG4gICAgY29uc3QgZXhlY0N0eCA9IGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQoe1xuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIGFjdG9yOiB0YXNrQWN0b3IsXG4gICAgICBzb3VyY2U6IG9ic0NvbmZpZy5zb3VyY2UgfHwgYHRhc2s6JHt0YXNrTmFtZX1gLFxuICAgICAgdGFnczoge1xuICAgICAgICAuLi5hdXRvbWF0aWNUYWdzLFxuICAgICAgICAuLi5vYnNDb25maWcudGFncywgLy8gRGVjb3JhdG9yIHRhZ3Mgb3ZlcnJpZGUgYXV0b21hdGljXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQnVpbGQgdGFzayBleGVjdXRpb24gY29udGV4dFxuICAgIGNvbnN0IGN0eDogVGFza0V4ZWN1dGlvbkNvbnRleHQgPSB7XG4gICAgICBldmVudDogX2V2ZW50LFxuICAgICAgbGFtYmRhQ29udGV4dDogY29udGV4dCxcbiAgICAgIGV4ZWN1dGlvbkNvbnRleHQ6IGV4ZWNDdHgsXG4gICAgfTtcblxuICAgIC8vIFJ1biBoYW5kbGVyIHdpdGhpbiBleGVjdXRpb24gY29udGV4dFxuICAgIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChleGVjQ3R4LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBVc2UgdGhlIGJhc2UgY2xhc3MgaGVscGVyIGZvciBzcGFuICsgZmx1c2ggcGF0dGVyblxuICAgICAgcmV0dXJuIHRoaXMuZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2goXG4gICAgICAgIGBUYXNrICR7dGFza05hbWV9YCxcbiAgICAgICAgYXN5bmMgKHRhc2tTcGFuKSA9PiB7XG4gICAgICAgICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnByb2Nlc3MoY3R4KTtcbiAgICAgICAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgICAgIHRhc2tTcGFuLm1ldHJpY3Moe1xuICAgICAgICAgICAgICAndGFzay5kdXJhdGlvbl9tcyc6IGR1cmF0aW9uLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAvLyBGbHVzaCBoYXBwZW5zIGF1dG9tYXRpY2FsbHkgaW4gZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2gncyBmaW5hbGx5IGJsb2NrXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgICAgIHRhc2tTcGFuLm1ldHJpY3Moe1xuICAgICAgICAgICAgICAndGFzay5kdXJhdGlvbl9tcyc6IGR1cmF0aW9uLFxuICAgICAgICAgICAgICAndGFzay5lcnJvcnMnOiAxLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAvLyBGbHVzaCBoYXBwZW5zIGF1dG9tYXRpY2FsbHkgaW4gZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2gncyBmaW5hbGx5IGJsb2NrXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICAgIGFjdG9yOiB0YXNrQWN0b3IsXG4gICAgICAgICAgc291cmNlOiBvYnNDb25maWcuc291cmNlIHx8IGB0YXNrOiR7dGFza05hbWV9YCxcbiAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAuLi5hdXRvbWF0aWNUYWdzLFxuICAgICAgICAgICAgLi4ub2JzQ29uZmlnLnRhZ3MsXG4gICAgICAgICAgICAndGFzay5uYW1lJzogdGFza05hbWUsXG4gICAgICAgICAgICAndGFzay5zY2hlZHVsZSc6IHRhc2tDb25maWcuc2NoZWR1bGUgfHwgJycsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgY29udGV4dFxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxufVxuXG5leHBvcnQgeyBUYXNrQ29udHJvbGxlciB9O1xuIl19