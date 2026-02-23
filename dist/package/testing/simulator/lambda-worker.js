"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_worker_threads_1 = require("node:worker_threads");
const node_path_1 = require("node:path");
async function run() {
    if (!node_worker_threads_1.parentPort)
        return;
    try {
        const { handlerPath, handlerClassName, event, context } = node_worker_threads_1.workerData;
        // Resolve the absolute path to the handler
        const absoluteHandlerPath = (0, node_path_1.resolve)(handlerPath);
        // Clear require cache for this module to support HMR
        delete require.cache[require.resolve(absoluteHandlerPath)];
        // Dynamic import the module
        const module = require(absoluteHandlerPath);
        // Prefer the exported 'handler' if available (it was auto-exported by decorators)
        let handler = module.handler;
        if (!handler) {
            // Fallback to finding the class and creating an instance
            let HandlerClass = module[handlerClassName];
            if (!HandlerClass) {
                for (const exportedItem of Object.values(module)) {
                    if (typeof exportedItem === 'function' && exportedItem.name === handlerClassName) {
                        HandlerClass = exportedItem;
                        break;
                    }
                }
            }
            if (HandlerClass) {
                const instance = new HandlerClass();
                handler = instance.LambdaHandler?.bind(instance);
            }
        }
        if (!handler) {
            throw new Error(`Handler not found in ${handlerPath}. Tried auto-exported 'handler' and class '${handlerClassName}'`);
        }
        // Run the handler
        const result = await handler(event, context);
        // Send the result back
        node_worker_threads_1.parentPort.postMessage({ type: 'success', result });
    }
    catch (error) {
        node_worker_threads_1.parentPort.postMessage({
            type: 'error',
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            }
        });
    }
}
run();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXdvcmtlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy90ZXN0aW5nL3NpbXVsYXRvci9sYW1iZGEtd29ya2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsNkRBQTZEO0FBQzdELHlDQUFvQztBQUVwQyxLQUFLLFVBQVUsR0FBRztJQUNkLElBQUksQ0FBQyxnQ0FBVTtRQUFFLE9BQU87SUFFeEIsSUFBSSxDQUFDO1FBQ0QsTUFBTSxFQUFFLFdBQVcsRUFBRSxnQkFBZ0IsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLEdBQUcsZ0NBQVUsQ0FBQztRQUVyRSwyQ0FBMkM7UUFDM0MsTUFBTSxtQkFBbUIsR0FBRyxJQUFBLG1CQUFPLEVBQUMsV0FBVyxDQUFDLENBQUM7UUFFakQscURBQXFEO1FBQ3JELE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQztRQUUzRCw0QkFBNEI7UUFDNUIsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUM7UUFFNUMsa0ZBQWtGO1FBQ2xGLElBQUksT0FBTyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUM7UUFFN0IsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ1gseURBQXlEO1lBQ3pELElBQUksWUFBWSxHQUFHLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1lBRTVDLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDaEIsS0FBSyxNQUFNLFlBQVksSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7b0JBQy9DLElBQUksT0FBTyxZQUFZLEtBQUssVUFBVSxJQUFJLFlBQVksQ0FBQyxJQUFJLEtBQUssZ0JBQWdCLEVBQUUsQ0FBQzt3QkFDL0UsWUFBWSxHQUFHLFlBQVksQ0FBQzt3QkFDNUIsTUFBTTtvQkFDVixDQUFDO2dCQUNMLENBQUM7WUFDTCxDQUFDO1lBRUQsSUFBSSxZQUFZLEVBQUUsQ0FBQztnQkFDZixNQUFNLFFBQVEsR0FBRyxJQUFLLFlBQW9CLEVBQUUsQ0FBQztnQkFDN0MsT0FBTyxHQUFHLFFBQVEsQ0FBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3JELENBQUM7UUFDTCxDQUFDO1FBRUQsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ1gsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsV0FBVyw4Q0FBOEMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDO1FBQzFILENBQUM7UUFFRCxrQkFBa0I7UUFDbEIsTUFBTSxNQUFNLEdBQUcsTUFBTSxPQUFPLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRTdDLHVCQUF1QjtRQUN2QixnQ0FBVSxDQUFDLFdBQVcsQ0FBQyxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztJQUN4RCxDQUFDO0lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztRQUNsQixnQ0FBVSxDQUFDLFdBQVcsQ0FBQztZQUNuQixJQUFJLEVBQUUsT0FBTztZQUNiLEtBQUssRUFBRTtnQkFDSCxPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87Z0JBQ3RCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztnQkFDbEIsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO2FBQ25CO1NBQ0osQ0FBQyxDQUFDO0lBQ1AsQ0FBQztBQUNMLENBQUM7QUFFRCxHQUFHLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHBhcmVudFBvcnQsIHdvcmtlckRhdGEgfSBmcm9tICdub2RlOndvcmtlcl90aHJlYWRzJztcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdub2RlOnBhdGgnO1xuXG5hc3luYyBmdW5jdGlvbiBydW4oKSB7XG4gICAgaWYgKCFwYXJlbnRQb3J0KSByZXR1cm47XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCB7IGhhbmRsZXJQYXRoLCBoYW5kbGVyQ2xhc3NOYW1lLCBldmVudCwgY29udGV4dCB9ID0gd29ya2VyRGF0YTtcbiAgICAgICAgXG4gICAgICAgIC8vIFJlc29sdmUgdGhlIGFic29sdXRlIHBhdGggdG8gdGhlIGhhbmRsZXJcbiAgICAgICAgY29uc3QgYWJzb2x1dGVIYW5kbGVyUGF0aCA9IHJlc29sdmUoaGFuZGxlclBhdGgpO1xuICAgICAgICBcbiAgICAgICAgLy8gQ2xlYXIgcmVxdWlyZSBjYWNoZSBmb3IgdGhpcyBtb2R1bGUgdG8gc3VwcG9ydCBITVJcbiAgICAgICAgZGVsZXRlIHJlcXVpcmUuY2FjaGVbcmVxdWlyZS5yZXNvbHZlKGFic29sdXRlSGFuZGxlclBhdGgpXTtcbiAgICAgICAgXG4gICAgICAgIC8vIER5bmFtaWMgaW1wb3J0IHRoZSBtb2R1bGVcbiAgICAgICAgY29uc3QgbW9kdWxlID0gcmVxdWlyZShhYnNvbHV0ZUhhbmRsZXJQYXRoKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFByZWZlciB0aGUgZXhwb3J0ZWQgJ2hhbmRsZXInIGlmIGF2YWlsYWJsZSAoaXQgd2FzIGF1dG8tZXhwb3J0ZWQgYnkgZGVjb3JhdG9ycylcbiAgICAgICAgbGV0IGhhbmRsZXIgPSBtb2R1bGUuaGFuZGxlcjtcblxuICAgICAgICBpZiAoIWhhbmRsZXIpIHtcbiAgICAgICAgICAgIC8vIEZhbGxiYWNrIHRvIGZpbmRpbmcgdGhlIGNsYXNzIGFuZCBjcmVhdGluZyBhbiBpbnN0YW5jZVxuICAgICAgICAgICAgbGV0IEhhbmRsZXJDbGFzcyA9IG1vZHVsZVtoYW5kbGVyQ2xhc3NOYW1lXTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCFIYW5kbGVyQ2xhc3MpIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGV4cG9ydGVkSXRlbSBvZiBPYmplY3QudmFsdWVzKG1vZHVsZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBleHBvcnRlZEl0ZW0gPT09ICdmdW5jdGlvbicgJiYgZXhwb3J0ZWRJdGVtLm5hbWUgPT09IGhhbmRsZXJDbGFzc05hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIEhhbmRsZXJDbGFzcyA9IGV4cG9ydGVkSXRlbTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoSGFuZGxlckNsYXNzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgKEhhbmRsZXJDbGFzcyBhcyBhbnkpKCk7XG4gICAgICAgICAgICAgICAgaGFuZGxlciA9IGluc3RhbmNlLkxhbWJkYUhhbmRsZXI/LmJpbmQoaW5zdGFuY2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoYW5kbGVyKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEhhbmRsZXIgbm90IGZvdW5kIGluICR7aGFuZGxlclBhdGh9LiBUcmllZCBhdXRvLWV4cG9ydGVkICdoYW5kbGVyJyBhbmQgY2xhc3MgJyR7aGFuZGxlckNsYXNzTmFtZX0nYCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSdW4gdGhlIGhhbmRsZXJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgY29udGV4dCk7XG4gICAgICAgIFxuICAgICAgICAvLyBTZW5kIHRoZSByZXN1bHQgYmFja1xuICAgICAgICBwYXJlbnRQb3J0LnBvc3RNZXNzYWdlKHsgdHlwZTogJ3N1Y2Nlc3MnLCByZXN1bHQgfSk7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICBwYXJlbnRQb3J0LnBvc3RNZXNzYWdlKHsgXG4gICAgICAgICAgICB0eXBlOiAnZXJyb3InLCBcbiAgICAgICAgICAgIGVycm9yOiB7XG4gICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICAgICAgICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXG4gICAgICAgICAgICAgICAgbmFtZTogZXJyb3IubmFtZVxuICAgICAgICAgICAgfSBcbiAgICAgICAgfSk7XG4gICAgfVxufVxuXG5ydW4oKTtcbiJdfQ==