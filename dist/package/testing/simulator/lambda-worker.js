"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_worker_threads_1 = require("node:worker_threads");
const node_path_1 = require("node:path");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
async function run() {
    if (!node_worker_threads_1.parentPort)
        return;
    try {
        const { handlerPath, handlerClassName, event, context } = node_worker_threads_1.workerData;
        // Resolve the absolute path to the handler
        let absoluteHandlerPath = (0, node_path_1.resolve)(handlerPath);
        // If it's a directory, look for index.js
        if (fs.existsSync(absoluteHandlerPath) && fs.lstatSync(absoluteHandlerPath).isDirectory()) {
            absoluteHandlerPath = path.join(absoluteHandlerPath, 'index.js');
        }
        if (!fs.existsSync(absoluteHandlerPath)) {
            throw new Error(`Handler file not found: ${absoluteHandlerPath}`);
        }
        // Clear require cache for this module to support HMR
        try {
            delete require.cache[require.resolve(absoluteHandlerPath)];
        }
        catch (e) { }
        // Explicitly load entry packages for simulator fidelity
        try {
            const { tryImportingEntryPackagesFor } = require('@ten24group/fw24');
            tryImportingEntryPackagesFor('simulator-worker');
        }
        catch (e) {
            // If framework not found in NODE_PATH, skip
        }
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
        // Reconstruct context functions
        const fullContext = {
            ...context,
            getRemainingTimeInMillis: () => context.remainingTimeMs || 30000
        };
        // Run the handler
        if (event && event.body) {
            console.log(`[Worker] Event body type: ${typeof event.body}, value: ${event.body}`);
        }
        const result = await handler(event, fullContext);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXdvcmtlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy90ZXN0aW5nL3NpbXVsYXRvci9sYW1iZGEtd29ya2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsNkRBQTZEO0FBQzdELHlDQUFvQztBQUNwQyw0Q0FBOEI7QUFDOUIsZ0RBQWtDO0FBRWxDLEtBQUssVUFBVSxHQUFHO0lBQ2QsSUFBSSxDQUFDLGdDQUFVO1FBQUUsT0FBTztJQUV4QixJQUFJLENBQUM7UUFDRCxNQUFNLEVBQUUsV0FBVyxFQUFFLGdCQUFnQixFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsR0FBRyxnQ0FBVSxDQUFDO1FBRXJFLDJDQUEyQztRQUMzQyxJQUFJLG1CQUFtQixHQUFHLElBQUEsbUJBQU8sRUFBQyxXQUFXLENBQUMsQ0FBQztRQUUvQyx5Q0FBeUM7UUFDekMsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLG1CQUFtQixDQUFDLElBQUksRUFBRSxDQUFDLFNBQVMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7WUFDeEYsbUJBQW1CLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUNyRSxDQUFDO1FBRUQsSUFBSSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsbUJBQW1CLENBQUMsRUFBRSxDQUFDO1lBQ3RDLE1BQU0sSUFBSSxLQUFLLENBQUMsMkJBQTJCLG1CQUFtQixFQUFFLENBQUMsQ0FBQztRQUN0RSxDQUFDO1FBRUQscURBQXFEO1FBQ3JELElBQUksQ0FBQztZQUNELE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQztRQUMvRCxDQUFDO1FBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFBLENBQUM7UUFFZCx3REFBd0Q7UUFDeEQsSUFBSSxDQUFDO1lBQ0QsTUFBTSxFQUFFLDRCQUE0QixFQUFFLEdBQUcsT0FBTyxDQUFDLGtCQUFrQixDQUFDLENBQUM7WUFDckUsNEJBQTRCLENBQUMsa0JBQWtCLENBQUMsQ0FBQztRQUNyRCxDQUFDO1FBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNULDRDQUE0QztRQUNoRCxDQUFDO1FBRUQsNEJBQTRCO1FBQzVCLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO1FBRTVDLGtGQUFrRjtRQUNsRixJQUFJLE9BQU8sR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDO1FBRTdCLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNYLHlEQUF5RDtZQUN6RCxJQUFJLFlBQVksR0FBRyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztZQUU1QyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7Z0JBQ2hCLEtBQUssTUFBTSxZQUFZLElBQUksTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO29CQUMvQyxJQUFJLE9BQU8sWUFBWSxLQUFLLFVBQVUsSUFBSSxZQUFZLENBQUMsSUFBSSxLQUFLLGdCQUFnQixFQUFFLENBQUM7d0JBQy9FLFlBQVksR0FBRyxZQUFZLENBQUM7d0JBQzVCLE1BQU07b0JBQ1YsQ0FBQztnQkFDTCxDQUFDO1lBQ0wsQ0FBQztZQUVELElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxRQUFRLEdBQUcsSUFBSyxZQUFvQixFQUFFLENBQUM7Z0JBQzdDLE9BQU8sR0FBRyxRQUFRLENBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUNyRCxDQUFDO1FBQ0wsQ0FBQztRQUVELElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNYLE1BQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLFdBQVcsOENBQThDLGdCQUFnQixHQUFHLENBQUMsQ0FBQztRQUMxSCxDQUFDO1FBRUQsZ0NBQWdDO1FBQ2hDLE1BQU0sV0FBVyxHQUFHO1lBQ2hCLEdBQUcsT0FBTztZQUNWLHdCQUF3QixFQUFFLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxlQUFlLElBQUksS0FBSztTQUNuRSxDQUFDO1FBRUYsa0JBQWtCO1FBQ2xCLElBQUksS0FBSyxJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUN0QixPQUFPLENBQUMsR0FBRyxDQUFDLDZCQUE2QixPQUFPLEtBQUssQ0FBQyxJQUFJLFlBQVksS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7UUFDeEYsQ0FBQztRQUNELE1BQU0sTUFBTSxHQUFHLE1BQU0sT0FBTyxDQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQztRQUVqRCx1QkFBdUI7UUFDdkIsZ0NBQVUsQ0FBQyxXQUFXLENBQUMsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7SUFDeEQsQ0FBQztJQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7UUFDbEIsZ0NBQVUsQ0FBQyxXQUFXLENBQUM7WUFDbkIsSUFBSSxFQUFFLE9BQU87WUFDYixLQUFLLEVBQUU7Z0JBQ0gsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO2dCQUN0QixLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUs7Z0JBQ2xCLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSTthQUNuQjtTQUNKLENBQUMsQ0FBQztJQUNQLENBQUM7QUFDTCxDQUFDO0FBRUQsR0FBRyxFQUFFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBwYXJlbnRQb3J0LCB3b3JrZXJEYXRhIH0gZnJvbSAnbm9kZTp3b3JrZXJfdGhyZWFkcyc7XG5pbXBvcnQgeyByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG5hc3luYyBmdW5jdGlvbiBydW4oKSB7XG4gICAgaWYgKCFwYXJlbnRQb3J0KSByZXR1cm47XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCB7IGhhbmRsZXJQYXRoLCBoYW5kbGVyQ2xhc3NOYW1lLCBldmVudCwgY29udGV4dCB9ID0gd29ya2VyRGF0YTtcbiAgICAgICAgXG4gICAgICAgIC8vIFJlc29sdmUgdGhlIGFic29sdXRlIHBhdGggdG8gdGhlIGhhbmRsZXJcbiAgICAgICAgbGV0IGFic29sdXRlSGFuZGxlclBhdGggPSByZXNvbHZlKGhhbmRsZXJQYXRoKTtcbiAgICAgICAgXG4gICAgICAgIC8vIElmIGl0J3MgYSBkaXJlY3RvcnksIGxvb2sgZm9yIGluZGV4LmpzXG4gICAgICAgIGlmIChmcy5leGlzdHNTeW5jKGFic29sdXRlSGFuZGxlclBhdGgpICYmIGZzLmxzdGF0U3luYyhhYnNvbHV0ZUhhbmRsZXJQYXRoKS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBhYnNvbHV0ZUhhbmRsZXJQYXRoID0gcGF0aC5qb2luKGFic29sdXRlSGFuZGxlclBhdGgsICdpbmRleC5qcycpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFmcy5leGlzdHNTeW5jKGFic29sdXRlSGFuZGxlclBhdGgpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEhhbmRsZXIgZmlsZSBub3QgZm91bmQ6ICR7YWJzb2x1dGVIYW5kbGVyUGF0aH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENsZWFyIHJlcXVpcmUgY2FjaGUgZm9yIHRoaXMgbW9kdWxlIHRvIHN1cHBvcnQgSE1SXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBkZWxldGUgcmVxdWlyZS5jYWNoZVtyZXF1aXJlLnJlc29sdmUoYWJzb2x1dGVIYW5kbGVyUGF0aCldO1xuICAgICAgICB9IGNhdGNoIChlKSB7fVxuICAgICAgICBcbiAgICAgICAgLy8gRXhwbGljaXRseSBsb2FkIGVudHJ5IHBhY2thZ2VzIGZvciBzaW11bGF0b3IgZmlkZWxpdHlcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHsgdHJ5SW1wb3J0aW5nRW50cnlQYWNrYWdlc0ZvciB9ID0gcmVxdWlyZSgnQHRlbjI0Z3JvdXAvZncyNCcpO1xuICAgICAgICAgICAgdHJ5SW1wb3J0aW5nRW50cnlQYWNrYWdlc0Zvcignc2ltdWxhdG9yLXdvcmtlcicpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAvLyBJZiBmcmFtZXdvcmsgbm90IGZvdW5kIGluIE5PREVfUEFUSCwgc2tpcFxuICAgICAgICB9XG5cbiAgICAgICAgLy8gRHluYW1pYyBpbXBvcnQgdGhlIG1vZHVsZVxuICAgICAgICBjb25zdCBtb2R1bGUgPSByZXF1aXJlKGFic29sdXRlSGFuZGxlclBhdGgpO1xuICAgICAgICBcbiAgICAgICAgLy8gUHJlZmVyIHRoZSBleHBvcnRlZCAnaGFuZGxlcicgaWYgYXZhaWxhYmxlIChpdCB3YXMgYXV0by1leHBvcnRlZCBieSBkZWNvcmF0b3JzKVxuICAgICAgICBsZXQgaGFuZGxlciA9IG1vZHVsZS5oYW5kbGVyO1xuXG4gICAgICAgIGlmICghaGFuZGxlcikge1xuICAgICAgICAgICAgLy8gRmFsbGJhY2sgdG8gZmluZGluZyB0aGUgY2xhc3MgYW5kIGNyZWF0aW5nIGFuIGluc3RhbmNlXG4gICAgICAgICAgICBsZXQgSGFuZGxlckNsYXNzID0gbW9kdWxlW2hhbmRsZXJDbGFzc05hbWVdO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIUhhbmRsZXJDbGFzcykge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXhwb3J0ZWRJdGVtIG9mIE9iamVjdC52YWx1ZXMobW9kdWxlKSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGV4cG9ydGVkSXRlbSA9PT0gJ2Z1bmN0aW9uJyAmJiBleHBvcnRlZEl0ZW0ubmFtZSA9PT0gaGFuZGxlckNsYXNzTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgSGFuZGxlckNsYXNzID0gZXhwb3J0ZWRJdGVtO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChIYW5kbGVyQ2xhc3MpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpbnN0YW5jZSA9IG5ldyAoSGFuZGxlckNsYXNzIGFzIGFueSkoKTtcbiAgICAgICAgICAgICAgICBoYW5kbGVyID0gaW5zdGFuY2UuTGFtYmRhSGFuZGxlcj8uYmluZChpbnN0YW5jZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWhhbmRsZXIpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSGFuZGxlciBub3QgZm91bmQgaW4gJHtoYW5kbGVyUGF0aH0uIFRyaWVkIGF1dG8tZXhwb3J0ZWQgJ2hhbmRsZXInIGFuZCBjbGFzcyAnJHtoYW5kbGVyQ2xhc3NOYW1lfSdgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJlY29uc3RydWN0IGNvbnRleHQgZnVuY3Rpb25zXG4gICAgICAgIGNvbnN0IGZ1bGxDb250ZXh0ID0ge1xuICAgICAgICAgICAgLi4uY29udGV4dCxcbiAgICAgICAgICAgIGdldFJlbWFpbmluZ1RpbWVJbk1pbGxpczogKCkgPT4gY29udGV4dC5yZW1haW5pbmdUaW1lTXMgfHwgMzAwMDBcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBSdW4gdGhlIGhhbmRsZXJcbiAgICAgICAgaWYgKGV2ZW50ICYmIGV2ZW50LmJvZHkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbV29ya2VyXSBFdmVudCBib2R5IHR5cGU6ICR7dHlwZW9mIGV2ZW50LmJvZHl9LCB2YWx1ZTogJHtldmVudC5ib2R5fWApO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIGZ1bGxDb250ZXh0KTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNlbmQgdGhlIHJlc3VsdCBiYWNrXG4gICAgICAgIHBhcmVudFBvcnQucG9zdE1lc3NhZ2UoeyB0eXBlOiAnc3VjY2VzcycsIHJlc3VsdCB9KTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIHBhcmVudFBvcnQucG9zdE1lc3NhZ2UoeyBcbiAgICAgICAgICAgIHR5cGU6ICdlcnJvcicsIFxuICAgICAgICAgICAgZXJyb3I6IHtcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICAgICAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcbiAgICAgICAgICAgICAgICBuYW1lOiBlcnJvci5uYW1lXG4gICAgICAgICAgICB9IFxuICAgICAgICB9KTtcbiAgICB9XG59XG5cbnJ1bigpO1xuIl19