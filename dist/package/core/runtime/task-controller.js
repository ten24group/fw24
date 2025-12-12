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
        this.initializeObservability();
        const taskName = this.getTaskName() || this.constructor.name;
        const taskConfig = this.getTaskConfig();
        const obsConfig = taskConfig.observability || {};
        const correlationId = context?.awsRequestId || `task-${taskName}-${Date.now()}`;
        // Create execution context with custom source and tags from decorator
        const execCtx = (0, execution_context_1.createExecutionContext)({
            correlationId,
            source: obsConfig.source || `task:${taskName}`,
            tags: {
                taskName,
                ...obsConfig.tags,
            },
        });
        // Run handler within execution context
        return (0, execution_context_1.runWithExecutionContext)(execCtx, async () => {
            // Create span with custom attributes from decorator
            const taskSpan = observability_1.SpanObserver.start(`Task ${taskName}`, {
                correlationId,
                source: obsConfig.source || `task:${taskName}`,
                tags: obsConfig.tags,
                attributes: {
                    'task.name': taskName,
                    'task.schedule': taskConfig.schedule,
                    ...obsConfig.attributes,
                },
            });
            // Store span ID in execution context for child spans
            execCtx.parentObservabilityLogId = taskSpan.id;
            // Build task execution context
            const ctx = {
                event: _event,
                lambdaContext: context,
                executionContext: execCtx,
            };
            let spanEnded = false;
            const endSpan = async (success, error) => {
                if (!spanEnded) {
                    taskSpan.end({ success, error });
                    spanEnded = true;
                }
                await this.flushObservability();
            };
            try {
                await this.initialize();
                await this.process(ctx);
                await endSpan(true);
            }
            catch (error) {
                await endSpan(false, error);
                throw error;
            }
        });
    }
}
exports.TaskController = TaskController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFzay1jb250cm9sbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS90YXNrLWNvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsdUVBQWtFO0FBRWxFLHVEQUFtRDtBQUNuRCwyREFJNkI7QUFjN0I7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHO0FBQ0gsTUFBZSxjQUFlLFNBQVEsK0NBQXFCO0lBRS9DLFVBQVU7UUFDbEIsT0FBTyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQVFTLGFBQWE7UUFDckIsT0FBUSxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxZQUFZLENBQWlCLElBQUksRUFBRSxRQUFRLEVBQUUsRUFBRSxFQUFFLENBQUM7SUFDOUUsQ0FBQztJQUVTLFdBQVc7UUFDbkIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxVQUFVLENBQXVCLENBQUM7SUFDN0QsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQUMsTUFBdUIsRUFBRSxPQUFpQjtRQUM1RCxJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQztRQUUvQixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDN0QsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3hDLE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBQ2pELE1BQU0sYUFBYSxHQUFHLE9BQU8sRUFBRSxZQUFZLElBQUksUUFBUSxRQUFRLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUM7UUFFaEYsc0VBQXNFO1FBQ3RFLE1BQU0sT0FBTyxHQUFHLElBQUEsMENBQXNCLEVBQUM7WUFDckMsYUFBYTtZQUNiLE1BQU0sRUFBRSxTQUFTLENBQUMsTUFBTSxJQUFJLFFBQVEsUUFBUSxFQUFFO1lBQzlDLElBQUksRUFBRTtnQkFDSixRQUFRO2dCQUNSLEdBQUcsU0FBUyxDQUFDLElBQUk7YUFDbEI7U0FDRixDQUFDLENBQUM7UUFFSCx1Q0FBdUM7UUFDdkMsT0FBTyxJQUFBLDJDQUF1QixFQUFDLE9BQU8sRUFBRSxLQUFLLElBQUksRUFBRTtZQUNqRCxvREFBb0Q7WUFDcEQsTUFBTSxRQUFRLEdBQUcsNEJBQVksQ0FBQyxLQUFLLENBQUMsUUFBUSxRQUFRLEVBQUUsRUFBRTtnQkFDdEQsYUFBYTtnQkFDYixNQUFNLEVBQUUsU0FBUyxDQUFDLE1BQU0sSUFBSSxRQUFRLFFBQVEsRUFBRTtnQkFDOUMsSUFBSSxFQUFFLFNBQVMsQ0FBQyxJQUFJO2dCQUNwQixVQUFVLEVBQUU7b0JBQ1YsV0FBVyxFQUFFLFFBQVE7b0JBQ3JCLGVBQWUsRUFBRSxVQUFVLENBQUMsUUFBUTtvQkFDcEMsR0FBRyxTQUFTLENBQUMsVUFBVTtpQkFDeEI7YUFDRixDQUFDLENBQUM7WUFFSCxxREFBcUQ7WUFDckQsT0FBTyxDQUFDLHdCQUF3QixHQUFHLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFFL0MsK0JBQStCO1lBQy9CLE1BQU0sR0FBRyxHQUF5QjtnQkFDaEMsS0FBSyxFQUFFLE1BQU07Z0JBQ2IsYUFBYSxFQUFFLE9BQU87Z0JBQ3RCLGdCQUFnQixFQUFFLE9BQU87YUFDMUIsQ0FBQztZQUVGLElBQUksU0FBUyxHQUFHLEtBQUssQ0FBQztZQUN0QixNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUUsT0FBZ0IsRUFBRSxLQUFhLEVBQWlCLEVBQUU7Z0JBQ3ZFLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztvQkFDZixRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7b0JBQ2pDLFNBQVMsR0FBRyxJQUFJLENBQUM7Z0JBQ25CLENBQUM7Z0JBQ0QsTUFBTSxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztZQUNsQyxDQUFDLENBQUM7WUFFRixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQ3hCLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDeEIsTUFBTSxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDdEIsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQWMsQ0FBQyxDQUFDO2dCQUNyQyxNQUFNLEtBQUssQ0FBQztZQUNkLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQUVRLHdDQUFjIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29udGV4dCwgU2NoZWR1bGVkRXZlbnQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcbmltcG9ydCB7IElUYXNrQ29uZmlnIH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycy90YXNrJztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuaW1wb3J0IHtcbiAgRXhlY3V0aW9uQ29udGV4dERhdGEsXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxufSBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuLyoqXG4gKiBUYXNrIGV4ZWN1dGlvbiBjb250ZXh0IC0gY29udGFpbnMgdGFzay1zcGVjaWZpYyBkYXRhIEFORCBleGVjdXRpb24gY29udGV4dC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUYXNrRXhlY3V0aW9uQ29udGV4dCB7XG4gIC8qKiBUaGUgc2NoZWR1bGVkIGV2ZW50IChpZiBhdmFpbGFibGUpICovXG4gIHJlYWRvbmx5IGV2ZW50PzogU2NoZWR1bGVkRXZlbnQ7XG4gIC8qKiBMYW1iZGEgY29udGV4dCAoaWYgYXZhaWxhYmxlKSAqL1xuICByZWFkb25seSBsYW1iZGFDb250ZXh0PzogQ29udGV4dDtcbiAgLyoqIEV4ZWN1dGlvbiBjb250ZXh0IChhbHNvIGF2YWlsYWJsZSB2aWEgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKSkgKi9cbiAgcmVhZG9ubHkgZXhlY3V0aW9uQ29udGV4dDogRXhlY3V0aW9uQ29udGV4dERhdGE7XG59XG5cbi8qKlxuICogQmFzZSBjbGFzcyBmb3IgaGFuZGxpbmcgU2NoZWR1bGUgVGFza3MuXG4gKiBcbiAqIEFsbCBoYW5kbGVyIGV4ZWN1dGlvbiBpcyB3cmFwcGVkIGluIGV4ZWN1dGlvbiBjb250ZXh0LlxuICogQ29uZmlndXJlIG9ic2VydmFiaWxpdHkgdmlhIHRoZSBAVGFzayBkZWNvcmF0b3I6XG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBAVGFzaygnbXktdGFzaycsIHtcbiAqICAgc2NoZWR1bGU6ICdyYXRlKDEgbWludXRlKScsXG4gKiAgIG9ic2VydmFiaWxpdHk6IHtcbiAqICAgICBzb3VyY2U6ICdkb21haW46dGFzay10eXBlJyxcbiAqICAgICB0YWdzOiB7IGRvbWFpbjogJ3Nwb3J0cycsIGZyZXF1ZW5jeTogJ2ZyZXF1ZW50JyB9XG4gKiAgIH1cbiAqIH0pXG4gKiBleHBvcnQgY2xhc3MgTXlUYXNrIGV4dGVuZHMgVGFza0NvbnRyb2xsZXIgeyB9XG4gKiBgYGBcbiAqL1xuYWJzdHJhY3QgY2xhc3MgVGFza0NvbnRyb2xsZXIgZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuXG4gIHByb3RlY3RlZCBpbml0aWFsaXplKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzIHRoZSBzY2hlZHVsZWQgdGFzay5cbiAgICogQHBhcmFtIGN0eCAtIFRhc2sgZXhlY3V0aW9uIGNvbnRleHRcbiAgICovXG4gIGFic3RyYWN0IHByb2Nlc3MoY3R4PzogVGFza0V4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPHZvaWQ+O1xuXG4gIHByb3RlY3RlZCBnZXRUYXNrQ29uZmlnKCk6IElUYXNrQ29uZmlnIHtcbiAgICByZXR1cm4gKFJlZmxlY3QuZ2V0KHRoaXMsICd0YXNrQ29uZmlnJykgYXMgSVRhc2tDb25maWcpIHx8IHsgc2NoZWR1bGU6ICcnIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0VGFza05hbWUoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGhpcywgJ3Rhc2tOYW1lJykgYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICB9XG5cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihfZXZlbnQ/OiBTY2hlZHVsZWRFdmVudCwgY29udGV4dD86IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmluaXRpYWxpemVPYnNlcnZhYmlsaXR5KCk7XG4gICAgXG4gICAgY29uc3QgdGFza05hbWUgPSB0aGlzLmdldFRhc2tOYW1lKCkgfHwgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIGNvbnN0IHRhc2tDb25maWcgPSB0aGlzLmdldFRhc2tDb25maWcoKTtcbiAgICBjb25zdCBvYnNDb25maWcgPSB0YXNrQ29uZmlnLm9ic2VydmFiaWxpdHkgfHwge307XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGNvbnRleHQ/LmF3c1JlcXVlc3RJZCB8fCBgdGFzay0ke3Rhc2tOYW1lfS0ke0RhdGUubm93KCl9YDtcblxuICAgIC8vIENyZWF0ZSBleGVjdXRpb24gY29udGV4dCB3aXRoIGN1c3RvbSBzb3VyY2UgYW5kIHRhZ3MgZnJvbSBkZWNvcmF0b3JcbiAgICBjb25zdCBleGVjQ3R4ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgc291cmNlOiBvYnNDb25maWcuc291cmNlIHx8IGB0YXNrOiR7dGFza05hbWV9YCxcbiAgICAgIHRhZ3M6IHtcbiAgICAgICAgdGFza05hbWUsXG4gICAgICAgIC4uLm9ic0NvbmZpZy50YWdzLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIFJ1biBoYW5kbGVyIHdpdGhpbiBleGVjdXRpb24gY29udGV4dFxuICAgIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChleGVjQ3R4LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBDcmVhdGUgc3BhbiB3aXRoIGN1c3RvbSBhdHRyaWJ1dGVzIGZyb20gZGVjb3JhdG9yXG4gICAgICBjb25zdCB0YXNrU3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydChgVGFzayAke3Rhc2tOYW1lfWAsIHtcbiAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgICAgc291cmNlOiBvYnNDb25maWcuc291cmNlIHx8IGB0YXNrOiR7dGFza05hbWV9YCxcbiAgICAgICAgdGFnczogb2JzQ29uZmlnLnRhZ3MsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAndGFzay5uYW1lJzogdGFza05hbWUsXG4gICAgICAgICAgJ3Rhc2suc2NoZWR1bGUnOiB0YXNrQ29uZmlnLnNjaGVkdWxlLFxuICAgICAgICAgIC4uLm9ic0NvbmZpZy5hdHRyaWJ1dGVzLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFN0b3JlIHNwYW4gSUQgaW4gZXhlY3V0aW9uIGNvbnRleHQgZm9yIGNoaWxkIHNwYW5zXG4gICAgICBleGVjQ3R4LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IHRhc2tTcGFuLmlkO1xuXG4gICAgICAvLyBCdWlsZCB0YXNrIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgICBjb25zdCBjdHg6IFRhc2tFeGVjdXRpb25Db250ZXh0ID0ge1xuICAgICAgICBldmVudDogX2V2ZW50LFxuICAgICAgICBsYW1iZGFDb250ZXh0OiBjb250ZXh0LFxuICAgICAgICBleGVjdXRpb25Db250ZXh0OiBleGVjQ3R4LFxuICAgICAgfTtcblxuICAgICAgbGV0IHNwYW5FbmRlZCA9IGZhbHNlO1xuICAgICAgY29uc3QgZW5kU3BhbiA9IGFzeW5jIChzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IEVycm9yKTogUHJvbWlzZTx2b2lkPiA9PiB7XG4gICAgICAgIGlmICghc3BhbkVuZGVkKSB7XG4gICAgICAgICAgdGFza1NwYW4uZW5kKHsgc3VjY2VzcywgZXJyb3IgfSk7XG4gICAgICAgICAgc3BhbkVuZGVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLmZsdXNoT2JzZXJ2YWJpbGl0eSgpO1xuICAgICAgfTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplKCk7XG4gICAgICAgIGF3YWl0IHRoaXMucHJvY2VzcyhjdHgpO1xuICAgICAgICBhd2FpdCBlbmRTcGFuKHRydWUpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgYXdhaXQgZW5kU3BhbihmYWxzZSwgZXJyb3IgYXMgRXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG5leHBvcnQgeyBUYXNrQ29udHJvbGxlciB9O1xuIl19