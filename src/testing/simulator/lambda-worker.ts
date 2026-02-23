import { parentPort, workerData } from 'node:worker_threads';
import { resolve } from 'node:path';

async function run() {
    if (!parentPort) return;

    try {
        const { handlerPath, handlerClassName, event, context } = workerData;

        // Resolve the absolute path to the handler
        const absoluteHandlerPath = resolve(handlerPath);

        // Clear require cache for this module to support HMR
        delete require.cache[require.resolve(absoluteHandlerPath)];

        // Dynamic import the module
        const module = require(absoluteHandlerPath);

        // Find the handler class
        let HandlerClass = module[handlerClassName];

        if (!HandlerClass) {
            // Fallback: look for any exported class if handlerClassName wasn't found directly
            for (const exportedItem of Object.values(module)) {
                if (typeof exportedItem === 'function' && exportedItem.name === handlerClassName) {
                    HandlerClass = exportedItem;
                    break;
                }
            }
        }

        if (!HandlerClass) {
            throw new Error(`Handler class ${handlerClassName} not found in ${handlerPath}`);
        }

        // Create an instance of the handler
        const instance = new (HandlerClass as any)();

        // The handler is expected to have a LambdaHandler method (from AbstractLambdaHandler)
        if (typeof instance.LambdaHandler !== 'function') {
            throw new Error(`LambdaHandler method not found on ${handlerClassName}`);
        }

        // Run the handler
        const result = await instance.LambdaHandler(event, context);

        // Send the result back
        parentPort.postMessage({ type: 'success', result });
    } catch (error: any) {
        parentPort.postMessage({
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
