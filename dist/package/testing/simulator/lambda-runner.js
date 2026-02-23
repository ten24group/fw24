"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LambdaRunner = void 0;
const node_worker_threads_1 = require("node:worker_threads");
const node_path_1 = require("node:path");
const logging_1 = require("../../logging");
class LambdaRunner {
    logger = (0, logging_1.createLogger)(LambdaRunner.name);
    async runHandler(handlerPath, handlerClassName, event, context, env = {}) {
        return new Promise((res, reject) => {
            this.logger.debug(`Invoking handler ${handlerClassName} in ${handlerPath}`);
            // Path to the worker script
            const isTs = __filename.endsWith('.ts');
            const workerScript = (0, node_path_1.resolve)(__dirname, isTs ? 'lambda-worker.ts' : 'lambda-worker.js');
            const worker = new node_worker_threads_1.Worker(isTs ? `require('ts-node').register(); require('${workerScript}')` : workerScript, {
                eval: isTs,
                workerData: {
                    handlerPath,
                    handlerClassName,
                    event,
                    context
                },
                env: {
                    ...process.env,
                    ...env
                }
            });
            worker.on('message', (message) => {
                if (message.type === 'success') {
                    res(message.result);
                }
                else if (message.type === 'error') {
                    const error = new Error(message.error.message);
                    error.stack = message.error.stack;
                    error.name = message.error.name;
                    reject(error);
                }
            });
            worker.on('error', (err) => {
                this.logger.error(`Worker error for ${handlerClassName}:`, err);
                reject(err);
            });
            worker.on('exit', (code) => {
                if (code !== 0) {
                    this.logger.warn(`Worker for ${handlerClassName} exited with code ${code}`);
                }
            });
        });
    }
}
exports.LambdaRunner = LambdaRunner;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXJ1bm5lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy90ZXN0aW5nL3NpbXVsYXRvci9sYW1iZGEtcnVubmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZEQUE2QztBQUM3Qyx5Q0FBb0M7QUFFcEMsMkNBQTZDO0FBRTdDLE1BQWEsWUFBWTtJQUNKLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRTFELEtBQUssQ0FBQyxVQUFVLENBQ1osV0FBbUIsRUFDbkIsZ0JBQXdCLEVBQ3hCLEtBQVUsRUFDVixPQUFZLEVBQ1osTUFBOEIsRUFBRTtRQUVoQyxPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsR0FBRyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQy9CLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLG9CQUFvQixnQkFBZ0IsT0FBTyxXQUFXLEVBQUUsQ0FBQyxDQUFDO1lBRTVFLDRCQUE0QjtZQUM1QixNQUFNLElBQUksR0FBRyxVQUFVLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3hDLE1BQU0sWUFBWSxHQUFHLElBQUEsbUJBQU8sRUFBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQztZQUV4RixNQUFNLE1BQU0sR0FBRyxJQUFJLDRCQUFNLENBQ3JCLElBQUksQ0FBQyxDQUFDLENBQUMsMkNBQTJDLFlBQVksSUFBSSxDQUFDLENBQUMsQ0FBQyxZQUFZLEVBQ2pGO2dCQUNJLElBQUksRUFBRSxJQUFJO2dCQUNWLFVBQVUsRUFBRTtvQkFDUixXQUFXO29CQUNYLGdCQUFnQjtvQkFDaEIsS0FBSztvQkFDTCxPQUFPO2lCQUNWO2dCQUNELEdBQUcsRUFBRTtvQkFDRCxHQUFHLE9BQU8sQ0FBQyxHQUFHO29CQUNkLEdBQUcsR0FBRztpQkFDVDthQUNKLENBQ0osQ0FBQztZQUVGLE1BQU0sQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUMsT0FBTyxFQUFFLEVBQUU7Z0JBQzdCLElBQUksT0FBTyxDQUFDLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztvQkFDN0IsR0FBRyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFDeEIsQ0FBQztxQkFBTSxJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssT0FBTyxFQUFFLENBQUM7b0JBQ2xDLE1BQU0sS0FBSyxHQUFHLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7b0JBQy9DLEtBQUssQ0FBQyxLQUFLLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUM7b0JBQ2xDLEtBQUssQ0FBQyxJQUFJLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUM7b0JBQ2hDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDbEIsQ0FBQztZQUNMLENBQUMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRTtnQkFDdkIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsb0JBQW9CLGdCQUFnQixHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7Z0JBQ2hFLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNoQixDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxFQUFFLEVBQUU7Z0JBQ3ZCLElBQUksSUFBSSxLQUFLLENBQUMsRUFBRSxDQUFDO29CQUNiLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGNBQWMsZ0JBQWdCLHFCQUFxQixJQUFJLEVBQUUsQ0FBQyxDQUFDO2dCQUNoRixDQUFDO1lBQ0wsQ0FBQyxDQUFDLENBQUM7UUFDUCxDQUFDLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQXpERCxvQ0F5REMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBXb3JrZXIgfSBmcm9tICdub2RlOndvcmtlcl90aHJlYWRzJztcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgSUxhbWJkYVJ1bm5lciB9IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcblxuZXhwb3J0IGNsYXNzIExhbWJkYVJ1bm5lciBpbXBsZW1lbnRzIElMYW1iZGFSdW5uZXIge1xuICAgIHByaXZhdGUgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKExhbWJkYVJ1bm5lci5uYW1lKTtcblxuICAgIGFzeW5jIHJ1bkhhbmRsZXIoXG4gICAgICAgIGhhbmRsZXJQYXRoOiBzdHJpbmcsXG4gICAgICAgIGhhbmRsZXJDbGFzc05hbWU6IHN0cmluZyxcbiAgICAgICAgZXZlbnQ6IGFueSxcbiAgICAgICAgY29udGV4dDogYW55LFxuICAgICAgICBlbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuICAgICk6IFByb21pc2U8YW55PiB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBJbnZva2luZyBoYW5kbGVyICR7aGFuZGxlckNsYXNzTmFtZX0gaW4gJHtoYW5kbGVyUGF0aH1gKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gUGF0aCB0byB0aGUgd29ya2VyIHNjcmlwdFxuICAgICAgICAgICAgY29uc3QgaXNUcyA9IF9fZmlsZW5hbWUuZW5kc1dpdGgoJy50cycpO1xuICAgICAgICAgICAgY29uc3Qgd29ya2VyU2NyaXB0ID0gcmVzb2x2ZShfX2Rpcm5hbWUsIGlzVHMgPyAnbGFtYmRhLXdvcmtlci50cycgOiAnbGFtYmRhLXdvcmtlci5qcycpO1xuXG4gICAgICAgICAgICBjb25zdCB3b3JrZXIgPSBuZXcgV29ya2VyKFxuICAgICAgICAgICAgICAgIGlzVHMgPyBgcmVxdWlyZSgndHMtbm9kZScpLnJlZ2lzdGVyKCk7IHJlcXVpcmUoJyR7d29ya2VyU2NyaXB0fScpYCA6IHdvcmtlclNjcmlwdCxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGV2YWw6IGlzVHMsXG4gICAgICAgICAgICAgICAgICAgIHdvcmtlckRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbmRsZXJQYXRoLFxuICAgICAgICAgICAgICAgICAgICAgICAgaGFuZGxlckNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGV2ZW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGV4dFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBlbnY6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgICAgICAgICAgICAgICAgICAgLi4uZW52XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICB3b3JrZXIub24oJ21lc3NhZ2UnLCAobWVzc2FnZSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChtZXNzYWdlLnR5cGUgPT09ICdzdWNjZXNzJykge1xuICAgICAgICAgICAgICAgICAgICByZXMobWVzc2FnZS5yZXN1bHQpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAobWVzc2FnZS50eXBlID09PSAnZXJyb3InKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKG1lc3NhZ2UuZXJyb3IubWVzc2FnZSk7XG4gICAgICAgICAgICAgICAgICAgIGVycm9yLnN0YWNrID0gbWVzc2FnZS5lcnJvci5zdGFjaztcbiAgICAgICAgICAgICAgICAgICAgZXJyb3IubmFtZSA9IG1lc3NhZ2UuZXJyb3IubmFtZTtcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgd29ya2VyLm9uKCdlcnJvcicsIChlcnIpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgV29ya2VyIGVycm9yIGZvciAke2hhbmRsZXJDbGFzc05hbWV9OmAsIGVycik7XG4gICAgICAgICAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgd29ya2VyLm9uKCdleGl0JywgKGNvZGUpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoY29kZSAhPT0gMCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKGBXb3JrZXIgZm9yICR7aGFuZGxlckNsYXNzTmFtZX0gZXhpdGVkIHdpdGggY29kZSAke2NvZGV9YCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cbn1cbiJdfQ==