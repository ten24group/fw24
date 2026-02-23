import { parentPort, workerData } from 'node:worker_threads';
import { resolve } from 'node:path';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function run() {
    if (!parentPort) return;

    try {
        const { handlerPath, handlerClassName, event, context } = workerData;

        // Resolve the absolute path to the handler
        let absoluteHandlerPath = resolve(handlerPath);

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
        } catch (e) {}

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
                const instance = new (HandlerClass as any)();
                handler = instance.LambdaHandler?.bind(instance);
            }
        }

        if (!handler) {
            throw new Error(`Handler not found in ${handlerPath}. Tried auto-exported 'handler' and class '${handlerClassName}'`);
        }

        // Run the handler
        const result = await handler(event, context);

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
