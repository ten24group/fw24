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
            });
        });
    }
}
exports.TaskController = TaskController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFzay1jb250cm9sbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS90YXNrLWNvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsdUVBQWtFO0FBRWxFLHVEQUFvRTtBQUNwRSwyREFJNkI7QUFlN0I7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHO0FBQ0gsTUFBZSxjQUFlLFNBQVEsK0NBQXFCO0lBRS9DLFVBQVU7UUFDbEIsT0FBTyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQVFTLGFBQWE7UUFDckIsT0FBUSxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxZQUFZLENBQWlCLElBQUksRUFBRSxRQUFRLEVBQUUsRUFBRSxFQUFFLENBQUM7SUFDOUUsQ0FBQztJQUVTLFdBQVc7UUFDbkIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxVQUFVLENBQXVCLENBQUM7SUFDN0QsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQUMsTUFBdUIsRUFBRSxPQUFpQjtRQUM1RCxJQUFJLENBQUMsdUNBQXVDLEVBQUUsQ0FBQztRQUUvQyxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDN0QsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3hDLE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBQ2pELG9FQUFvRTtRQUNwRSxNQUFNLGFBQWEsR0FBRyxPQUFPLEVBQUUsWUFBWSxJQUFJLElBQUEsK0JBQWUsR0FBRSxDQUFDO1FBRWpFLG9EQUFvRDtRQUNwRCxNQUFNLGFBQWEsR0FBMkI7WUFDNUMsWUFBWSxFQUFFLE1BQU07WUFDcEIsU0FBUyxFQUFFLFFBQVE7U0FDcEIsQ0FBQztRQUNGLElBQUksVUFBVSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ3hCLGFBQWEsQ0FBQyxRQUFRLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQztRQUMvQyxDQUFDO1FBRUQscUZBQXFGO1FBQ3JGLE1BQU0sU0FBUyxHQUFVO1lBQ3ZCLFNBQVMsRUFBRSxTQUFTO1lBQ3BCLFVBQVUsRUFBRSxRQUFRO1lBQ3BCLE9BQU8sRUFBRSxRQUFRLFFBQVEsRUFBRTtZQUMzQixTQUFTLEVBQUUsT0FBTyxFQUFFLFlBQVksSUFBSSxhQUFhO1lBQ2pELFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtZQUNuQyxhQUFhLEVBQUcseURBQXlEO1NBQzFFLENBQUM7UUFFRixzRUFBc0U7UUFDdEUsTUFBTSxPQUFPLEdBQUcsSUFBQSwwQ0FBc0IsRUFBQztZQUNyQyxhQUFhO1lBQ2IsS0FBSyxFQUFFLFNBQVM7WUFDaEIsTUFBTSxFQUFFLFNBQVMsQ0FBQyxNQUFNLElBQUksUUFBUSxRQUFRLEVBQUU7WUFDOUMsSUFBSSxFQUFFO2dCQUNKLEdBQUcsYUFBYTtnQkFDaEIsR0FBRyxTQUFTLENBQUMsSUFBSSxFQUFFLG9DQUFvQzthQUN4RDtTQUNGLENBQUMsQ0FBQztRQUVILCtCQUErQjtRQUMvQixNQUFNLEdBQUcsR0FBeUI7WUFDaEMsS0FBSyxFQUFFLE1BQU07WUFDYixhQUFhLEVBQUUsT0FBTztZQUN0QixnQkFBZ0IsRUFBRSxPQUFPO1NBQzFCLENBQUM7UUFFRix1Q0FBdUM7UUFDdkMsT0FBTyxJQUFBLDJDQUF1QixFQUFDLE9BQU8sRUFBRSxLQUFLLElBQUksRUFBRTtZQUNqRCxxREFBcUQ7WUFDckQsT0FBTyxJQUFJLENBQUMsdUJBQXVCLENBQ2pDLFFBQVEsUUFBUSxFQUFFLEVBQ2xCLEtBQUssRUFBRSxRQUFRLEVBQUUsRUFBRTtnQkFDakIsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO2dCQUM3QixJQUFJLENBQUM7b0JBQ0gsTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7b0JBQ3hCLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDeEIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQztvQkFDeEMsUUFBUSxDQUFDLE9BQU8sQ0FBQzt3QkFDZixrQkFBa0IsRUFBRSxRQUFRO3FCQUM3QixDQUFDLENBQUM7b0JBQ0gseUVBQXlFO2dCQUMzRSxDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2YsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQztvQkFDeEMsUUFBUSxDQUFDLE9BQU8sQ0FBQzt3QkFDZixrQkFBa0IsRUFBRSxRQUFRO3dCQUM1QixhQUFhLEVBQUUsQ0FBQztxQkFDakIsQ0FBQyxDQUFDO29CQUNILHlFQUF5RTtvQkFDekUsTUFBTSxLQUFLLENBQUM7Z0JBQ2QsQ0FBQztZQUNILENBQUMsRUFDRDtnQkFDRSxhQUFhO2dCQUNiLEtBQUssRUFBRSxTQUFTO2dCQUNoQixNQUFNLEVBQUUsU0FBUyxDQUFDLE1BQU0sSUFBSSxRQUFRLFFBQVEsRUFBRTtnQkFDOUMsSUFBSSxFQUFFO29CQUNKLEdBQUcsYUFBYTtvQkFDaEIsR0FBRyxTQUFTLENBQUMsSUFBSTtvQkFDakIsV0FBVyxFQUFFLFFBQVE7b0JBQ3JCLGVBQWUsRUFBRSxVQUFVLENBQUMsUUFBUSxJQUFJLEVBQUU7aUJBQzNDO2FBQ0YsQ0FDRixDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFFUSx3Q0FBYyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENvbnRleHQsIFNjaGVkdWxlZEV2ZW50IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBJVGFza0NvbmZpZyB9IGZyb20gJy4uLy4uL2RlY29yYXRvcnMvdGFzayc7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIsIGdlbmVyYXRlVHJhY2VJZCB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuaW1wb3J0IHtcbiAgRXhlY3V0aW9uQ29udGV4dERhdGEsXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxufSBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSAnLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuXG4vKipcbiAqIFRhc2sgZXhlY3V0aW9uIGNvbnRleHQgLSBjb250YWlucyB0YXNrLXNwZWNpZmljIGRhdGEgQU5EIGV4ZWN1dGlvbiBjb250ZXh0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFRhc2tFeGVjdXRpb25Db250ZXh0IHtcbiAgLyoqIFRoZSBzY2hlZHVsZWQgZXZlbnQgKGlmIGF2YWlsYWJsZSkgKi9cbiAgcmVhZG9ubHkgZXZlbnQ/OiBTY2hlZHVsZWRFdmVudDtcbiAgLyoqIExhbWJkYSBjb250ZXh0IChpZiBhdmFpbGFibGUpICovXG4gIHJlYWRvbmx5IGxhbWJkYUNvbnRleHQ/OiBDb250ZXh0O1xuICAvKiogRXhlY3V0aW9uIGNvbnRleHQgKGFsc28gYXZhaWxhYmxlIHZpYSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpKSAqL1xuICByZWFkb25seSBleGVjdXRpb25Db250ZXh0OiBFeGVjdXRpb25Db250ZXh0RGF0YTtcbn1cblxuLyoqXG4gKiBCYXNlIGNsYXNzIGZvciBoYW5kbGluZyBTY2hlZHVsZSBUYXNrcy5cbiAqIFxuICogQWxsIGhhbmRsZXIgZXhlY3V0aW9uIGlzIHdyYXBwZWQgaW4gZXhlY3V0aW9uIGNvbnRleHQuXG4gKiBDb25maWd1cmUgb2JzZXJ2YWJpbGl0eSB2aWEgdGhlIEBUYXNrIGRlY29yYXRvcjpcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIEBUYXNrKCdteS10YXNrJywge1xuICogICBzY2hlZHVsZTogJ3JhdGUoMSBtaW51dGUpJyxcbiAqICAgb2JzZXJ2YWJpbGl0eToge1xuICogICAgIHNvdXJjZTogJ2RvbWFpbjp0YXNrLXR5cGUnLFxuICogICAgIHRhZ3M6IHsgZG9tYWluOiAnc3BvcnRzJywgZnJlcXVlbmN5OiAnZnJlcXVlbnQnIH1cbiAqICAgfVxuICogfSlcbiAqIGV4cG9ydCBjbGFzcyBNeVRhc2sgZXh0ZW5kcyBUYXNrQ29udHJvbGxlciB7IH1cbiAqIGBgYFxuICovXG5hYnN0cmFjdCBjbGFzcyBUYXNrQ29udHJvbGxlciBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG5cbiAgcHJvdGVjdGVkIGluaXRpYWxpemUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3MgdGhlIHNjaGVkdWxlZCB0YXNrLlxuICAgKiBAcGFyYW0gY3R4IC0gVGFzayBleGVjdXRpb24gY29udGV4dFxuICAgKi9cbiAgYWJzdHJhY3QgcHJvY2VzcyhjdHg/OiBUYXNrRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8dm9pZD47XG5cbiAgcHJvdGVjdGVkIGdldFRhc2tDb25maWcoKTogSVRhc2tDb25maWcge1xuICAgIHJldHVybiAoUmVmbGVjdC5nZXQodGhpcywgJ3Rhc2tDb25maWcnKSBhcyBJVGFza0NvbmZpZykgfHwgeyBzY2hlZHVsZTogJycgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRUYXNrTmFtZSgpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0aGlzLCAndGFza05hbWUnKSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIH1cblxuICBhc3luYyBMYW1iZGFIYW5kbGVyKF9ldmVudD86IFNjaGVkdWxlZEV2ZW50LCBjb250ZXh0PzogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuaW5pdGlhbGl6ZUVudHJ5UGFja2FnZXNBbmRPYnNlcnZhYmlsaXR5KCk7XG5cbiAgICBjb25zdCB0YXNrTmFtZSA9IHRoaXMuZ2V0VGFza05hbWUoKSB8fCB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgY29uc3QgdGFza0NvbmZpZyA9IHRoaXMuZ2V0VGFza0NvbmZpZygpO1xuICAgIGNvbnN0IG9ic0NvbmZpZyA9IHRhc2tDb25maWcub2JzZXJ2YWJpbGl0eSB8fCB7fTtcbiAgICAvLyBVc2UgVzNDIFRyYWNlIElEIGZvcm1hdCBmb3IgY29uc2lzdGVuY3kgd2l0aCBvYnNlcnZhYmlsaXR5IHN5c3RlbVxuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBjb250ZXh0Py5hd3NSZXF1ZXN0SWQgfHwgZ2VuZXJhdGVUcmFjZUlkKCk7XG5cbiAgICAvLyBCdWlsZCBhdXRvbWF0aWMgdGFncyBmb3IgY29uc2lzdGVudCBvYnNlcnZhYmlsaXR5XG4gICAgY29uc3QgYXV0b21hdGljVGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgIGhhbmRsZXJfdHlwZTogJ3Rhc2snLFxuICAgICAgdGFza19uYW1lOiB0YXNrTmFtZSxcbiAgICB9O1xuICAgIGlmICh0YXNrQ29uZmlnLnNjaGVkdWxlKSB7XG4gICAgICBhdXRvbWF0aWNUYWdzLnNjaGVkdWxlID0gdGFza0NvbmZpZy5zY2hlZHVsZTtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgc2VydmljZSBhY3RvciBmb3IgdGFzayAtIGVuYWJsZXMgYWN0b3IgY29udGV4dCBpbmplY3Rpb24gaW4gZW50aXR5IHNlcnZpY2VzXG4gICAgY29uc3QgdGFza0FjdG9yOiBBY3RvciA9IHtcbiAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYXV0aE1ldGhvZDogJ3N5c3RlbScsXG4gICAgICBhY3RvcklkOiBgdGFzazoke3Rhc2tOYW1lfWAsXG4gICAgICByZXF1ZXN0SWQ6IGNvbnRleHQ/LmF3c1JlcXVlc3RJZCB8fCBjb3JyZWxhdGlvbklkLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBjb3JyZWxhdGlvbklkLCAgLy8gVGFzayBpcyB0aGUgcm9vdCB0cmlnZ2VyLCBzbyB1c2UgaXRzIG93biBjb3JyZWxhdGlvbklkXG4gICAgfTtcblxuICAgIC8vIENyZWF0ZSBleGVjdXRpb24gY29udGV4dCB3aXRoIGN1c3RvbSBzb3VyY2UgYW5kIHRhZ3MgZnJvbSBkZWNvcmF0b3JcbiAgICBjb25zdCBleGVjQ3R4ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgYWN0b3I6IHRhc2tBY3RvcixcbiAgICAgIHNvdXJjZTogb2JzQ29uZmlnLnNvdXJjZSB8fCBgdGFzazoke3Rhc2tOYW1lfWAsXG4gICAgICB0YWdzOiB7XG4gICAgICAgIC4uLmF1dG9tYXRpY1RhZ3MsXG4gICAgICAgIC4uLm9ic0NvbmZpZy50YWdzLCAvLyBEZWNvcmF0b3IgdGFncyBvdmVycmlkZSBhdXRvbWF0aWNcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBCdWlsZCB0YXNrIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgY29uc3QgY3R4OiBUYXNrRXhlY3V0aW9uQ29udGV4dCA9IHtcbiAgICAgIGV2ZW50OiBfZXZlbnQsXG4gICAgICBsYW1iZGFDb250ZXh0OiBjb250ZXh0LFxuICAgICAgZXhlY3V0aW9uQ29udGV4dDogZXhlY0N0eCxcbiAgICB9O1xuXG4gICAgLy8gUnVuIGhhbmRsZXIgd2l0aGluIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgcmV0dXJuIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KGV4ZWNDdHgsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFVzZSB0aGUgYmFzZSBjbGFzcyBoZWxwZXIgZm9yIHNwYW4gKyBmbHVzaCBwYXR0ZXJuXG4gICAgICByZXR1cm4gdGhpcy5leGVjdXRlV2l0aFNwYW5BbmRGbHVzaChcbiAgICAgICAgYFRhc2sgJHt0YXNrTmFtZX1gLFxuICAgICAgICBhc3luYyAodGFza1NwYW4pID0+IHtcbiAgICAgICAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucHJvY2VzcyhjdHgpO1xuICAgICAgICAgICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgICAgICAgICAgdGFza1NwYW4ubWV0cmljcyh7XG4gICAgICAgICAgICAgICd0YXNrLmR1cmF0aW9uX21zJzogZHVyYXRpb24sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIC8vIEZsdXNoIGhhcHBlbnMgYXV0b21hdGljYWxseSBpbiBleGVjdXRlV2l0aFNwYW5BbmRGbHVzaCdzIGZpbmFsbHkgYmxvY2tcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgICAgICAgICAgdGFza1NwYW4ubWV0cmljcyh7XG4gICAgICAgICAgICAgICd0YXNrLmR1cmF0aW9uX21zJzogZHVyYXRpb24sXG4gICAgICAgICAgICAgICd0YXNrLmVycm9ycyc6IDEsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIC8vIEZsdXNoIGhhcHBlbnMgYXV0b21hdGljYWxseSBpbiBleGVjdXRlV2l0aFNwYW5BbmRGbHVzaCdzIGZpbmFsbHkgYmxvY2tcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgYWN0b3I6IHRhc2tBY3RvcixcbiAgICAgICAgICBzb3VyY2U6IG9ic0NvbmZpZy5zb3VyY2UgfHwgYHRhc2s6JHt0YXNrTmFtZX1gLFxuICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgIC4uLmF1dG9tYXRpY1RhZ3MsXG4gICAgICAgICAgICAuLi5vYnNDb25maWcudGFncyxcbiAgICAgICAgICAgICd0YXNrLm5hbWUnOiB0YXNrTmFtZSxcbiAgICAgICAgICAgICd0YXNrLnNjaGVkdWxlJzogdGFza0NvbmZpZy5zY2hlZHVsZSB8fCAnJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9XG4gICAgICApO1xuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCB7IFRhc2tDb250cm9sbGVyIH07XG4iXX0=