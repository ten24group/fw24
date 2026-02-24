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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXdvcmtlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy90ZXN0aW5nL3NpbXVsYXRvci9sYW1iZGEtd29ya2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsNkRBQTZEO0FBQzdELHlDQUFvQztBQUNwQyw0Q0FBOEI7QUFDOUIsZ0RBQWtDO0FBRWxDLEtBQUssVUFBVSxHQUFHO0lBQ2QsSUFBSSxDQUFDLGdDQUFVO1FBQUUsT0FBTztJQUV4QixJQUFJLENBQUM7UUFDRCxNQUFNLEVBQUUsV0FBVyxFQUFFLGdCQUFnQixFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsR0FBRyxnQ0FBVSxDQUFDO1FBRXJFLDJDQUEyQztRQUMzQyxJQUFJLG1CQUFtQixHQUFHLElBQUEsbUJBQU8sRUFBQyxXQUFXLENBQUMsQ0FBQztRQUUvQyx5Q0FBeUM7UUFDekMsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLG1CQUFtQixDQUFDLElBQUksRUFBRSxDQUFDLFNBQVMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7WUFDeEYsbUJBQW1CLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUNyRSxDQUFDO1FBRUQsSUFBSSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsbUJBQW1CLENBQUMsRUFBRSxDQUFDO1lBQ3RDLE1BQU0sSUFBSSxLQUFLLENBQUMsMkJBQTJCLG1CQUFtQixFQUFFLENBQUMsQ0FBQztRQUN0RSxDQUFDO1FBRUQscURBQXFEO1FBQ3JELElBQUksQ0FBQztZQUNELE9BQU8sT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQztRQUMvRCxDQUFDO1FBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFBLENBQUM7UUFFZCw0QkFBNEI7UUFDNUIsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUM7UUFFNUMsa0ZBQWtGO1FBQ2xGLElBQUksT0FBTyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUM7UUFFN0IsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ1gseURBQXlEO1lBQ3pELElBQUksWUFBWSxHQUFHLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1lBRTVDLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDaEIsS0FBSyxNQUFNLFlBQVksSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7b0JBQy9DLElBQUksT0FBTyxZQUFZLEtBQUssVUFBVSxJQUFJLFlBQVksQ0FBQyxJQUFJLEtBQUssZ0JBQWdCLEVBQUUsQ0FBQzt3QkFDL0UsWUFBWSxHQUFHLFlBQVksQ0FBQzt3QkFDNUIsTUFBTTtvQkFDVixDQUFDO2dCQUNMLENBQUM7WUFDTCxDQUFDO1lBRUQsSUFBSSxZQUFZLEVBQUUsQ0FBQztnQkFDZixNQUFNLFFBQVEsR0FBRyxJQUFLLFlBQW9CLEVBQUUsQ0FBQztnQkFDN0MsT0FBTyxHQUFHLFFBQVEsQ0FBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3JELENBQUM7UUFDTCxDQUFDO1FBRUQsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ1gsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsV0FBVyw4Q0FBOEMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDO1FBQzFILENBQUM7UUFFRCxrQkFBa0I7UUFDbEIsTUFBTSxNQUFNLEdBQUcsTUFBTSxPQUFPLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRTdDLHVCQUF1QjtRQUN2QixnQ0FBVSxDQUFDLFdBQVcsQ0FBQyxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztJQUN4RCxDQUFDO0lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztRQUNsQixnQ0FBVSxDQUFDLFdBQVcsQ0FBQztZQUNuQixJQUFJLEVBQUUsT0FBTztZQUNiLEtBQUssRUFBRTtnQkFDSCxPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87Z0JBQ3RCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztnQkFDbEIsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO2FBQ25CO1NBQ0osQ0FBQyxDQUFDO0lBQ1AsQ0FBQztBQUNMLENBQUM7QUFFRCxHQUFHLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHBhcmVudFBvcnQsIHdvcmtlckRhdGEgfSBmcm9tICdub2RlOndvcmtlcl90aHJlYWRzJztcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmFzeW5jIGZ1bmN0aW9uIHJ1bigpIHtcbiAgICBpZiAoIXBhcmVudFBvcnQpIHJldHVybjtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHsgaGFuZGxlclBhdGgsIGhhbmRsZXJDbGFzc05hbWUsIGV2ZW50LCBjb250ZXh0IH0gPSB3b3JrZXJEYXRhO1xuICAgICAgICBcbiAgICAgICAgLy8gUmVzb2x2ZSB0aGUgYWJzb2x1dGUgcGF0aCB0byB0aGUgaGFuZGxlclxuICAgICAgICBsZXQgYWJzb2x1dGVIYW5kbGVyUGF0aCA9IHJlc29sdmUoaGFuZGxlclBhdGgpO1xuICAgICAgICBcbiAgICAgICAgLy8gSWYgaXQncyBhIGRpcmVjdG9yeSwgbG9vayBmb3IgaW5kZXguanNcbiAgICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoYWJzb2x1dGVIYW5kbGVyUGF0aCkgJiYgZnMubHN0YXRTeW5jKGFic29sdXRlSGFuZGxlclBhdGgpLmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIGFic29sdXRlSGFuZGxlclBhdGggPSBwYXRoLmpvaW4oYWJzb2x1dGVIYW5kbGVyUGF0aCwgJ2luZGV4LmpzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWZzLmV4aXN0c1N5bmMoYWJzb2x1dGVIYW5kbGVyUGF0aCkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSGFuZGxlciBmaWxlIG5vdCBmb3VuZDogJHthYnNvbHV0ZUhhbmRsZXJQYXRofWApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2xlYXIgcmVxdWlyZSBjYWNoZSBmb3IgdGhpcyBtb2R1bGUgdG8gc3VwcG9ydCBITVJcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGRlbGV0ZSByZXF1aXJlLmNhY2hlW3JlcXVpcmUucmVzb2x2ZShhYnNvbHV0ZUhhbmRsZXJQYXRoKV07XG4gICAgICAgIH0gY2F0Y2ggKGUpIHt9XG4gICAgICAgIFxuICAgICAgICAvLyBEeW5hbWljIGltcG9ydCB0aGUgbW9kdWxlXG4gICAgICAgIGNvbnN0IG1vZHVsZSA9IHJlcXVpcmUoYWJzb2x1dGVIYW5kbGVyUGF0aCk7XG4gICAgICAgIFxuICAgICAgICAvLyBQcmVmZXIgdGhlIGV4cG9ydGVkICdoYW5kbGVyJyBpZiBhdmFpbGFibGUgKGl0IHdhcyBhdXRvLWV4cG9ydGVkIGJ5IGRlY29yYXRvcnMpXG4gICAgICAgIGxldCBoYW5kbGVyID0gbW9kdWxlLmhhbmRsZXI7XG5cbiAgICAgICAgaWYgKCFoYW5kbGVyKSB7XG4gICAgICAgICAgICAvLyBGYWxsYmFjayB0byBmaW5kaW5nIHRoZSBjbGFzcyBhbmQgY3JlYXRpbmcgYW4gaW5zdGFuY2VcbiAgICAgICAgICAgIGxldCBIYW5kbGVyQ2xhc3MgPSBtb2R1bGVbaGFuZGxlckNsYXNzTmFtZV07XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghSGFuZGxlckNsYXNzKSB7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBleHBvcnRlZEl0ZW0gb2YgT2JqZWN0LnZhbHVlcyhtb2R1bGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgZXhwb3J0ZWRJdGVtID09PSAnZnVuY3Rpb24nICYmIGV4cG9ydGVkSXRlbS5uYW1lID09PSBoYW5kbGVyQ2xhc3NOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBIYW5kbGVyQ2xhc3MgPSBleHBvcnRlZEl0ZW07XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKEhhbmRsZXJDbGFzcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IChIYW5kbGVyQ2xhc3MgYXMgYW55KSgpO1xuICAgICAgICAgICAgICAgIGhhbmRsZXIgPSBpbnN0YW5jZS5MYW1iZGFIYW5kbGVyPy5iaW5kKGluc3RhbmNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghaGFuZGxlcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBIYW5kbGVyIG5vdCBmb3VuZCBpbiAke2hhbmRsZXJQYXRofS4gVHJpZWQgYXV0by1leHBvcnRlZCAnaGFuZGxlcicgYW5kIGNsYXNzICcke2hhbmRsZXJDbGFzc05hbWV9J2ApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUnVuIHRoZSBoYW5kbGVyXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgICBcbiAgICAgICAgLy8gU2VuZCB0aGUgcmVzdWx0IGJhY2tcbiAgICAgICAgcGFyZW50UG9ydC5wb3N0TWVzc2FnZSh7IHR5cGU6ICdzdWNjZXNzJywgcmVzdWx0IH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgcGFyZW50UG9ydC5wb3N0TWVzc2FnZSh7IFxuICAgICAgICAgICAgdHlwZTogJ2Vycm9yJywgXG4gICAgICAgICAgICBlcnJvcjoge1xuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxuICAgICAgICAgICAgICAgIG5hbWU6IGVycm9yLm5hbWVcbiAgICAgICAgICAgIH0gXG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxucnVuKCk7XG4iXX0=