import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { ILambdaRunner } from './interfaces';
import { createLogger } from '../../logging';

export class LambdaRunner implements ILambdaRunner {
    private readonly logger = createLogger(LambdaRunner.name);

    async runHandler(
        handlerPath: string,
        handlerClassName: string,
        event: any,
        context: any = {},
        env: Record<string, string> = {}
    ): Promise<any> {
        return new Promise((res, reject) => {
            const requestId = `req-${Date.now()}`;
            const fullContext = {
                awsRequestId: requestId,
                functionName: handlerClassName,
                invokedFunctionArn: `arn:aws:lambda:us-east-1:123456789012:function:${handlerClassName}`,
                memoryLimitInMB: '128',
                getRemainingTimeInMillis: () => 30000,
                ...context
            };

            this.logger.debug(`Invoking handler ${handlerClassName} in ${handlerPath}`);

            // Path to the worker script
            const isTs = __filename.endsWith('.ts');
            const workerScript = resolve(__dirname, isTs ? 'lambda-worker.ts' : 'lambda-worker.js');

            const worker = new Worker(
                isTs ? `require('ts-node').register(); require('${workerScript}')` : workerScript,
                {
                    eval: isTs,
                    workerData: {
                        handlerPath,
                        handlerClassName,
                        event,
                        context: fullContext
                    },
                    env: {
                        ...process.env,
                        ...env
                    }
                }
            );

            worker.on('message', (message) => {
                if (message.type === 'success') {
                    res(message.result);
                } else if (message.type === 'error') {
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
