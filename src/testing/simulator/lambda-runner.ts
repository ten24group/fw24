import { Worker } from 'node:worker_threads';
import { resolve, join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { ILambdaRunner } from './interfaces';
import { createLogger } from '../../logging';

export class LambdaRunner implements ILambdaRunner {
    private readonly logger = createLogger(LambdaRunner.name);

    private sanitize(obj: any): any {
        try {
            return JSON.parse(JSON.stringify(obj, (_key, value) => {
                if (typeof value === 'function') return undefined;
                return value;
            }));
        } catch (e: any) {
            this.logger.warn(`Failed to deep-sanitize object, falling back to shallow sanitize: ${e?.message}`);
            if (obj === null || typeof obj !== 'object') {
                return typeof obj === 'function' ? undefined : obj;
            }
            const result: any = {};
            for (const [key, value] of Object.entries(obj)) {
                if (typeof value === 'function') continue;
                result[key] = value;
            }
            return result;
        }
    }

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
                remainingTimeMs: 30000,
                ...context
            };

            this.logger.debug(`Invoking handler ${handlerClassName} in ${handlerPath}`);

            // Path to the worker script
            const isTs = __filename.endsWith('.ts');
            const workerScript = resolve(__dirname, isTs ? 'lambda-worker.ts' : 'lambda-worker.js');

            // Add layers to NODE_PATH
            const layersDir = resolve(process.cwd(), 'dist/layers');
            const layerPaths: string[] = [];
            if (existsSync(layersDir)) {
                const layers = readdirSync(layersDir);
                for (const layer of layers) {
                    const nodeModulesPath = join(layersDir, layer, 'nodejs/node_modules');
                    if (existsSync(nodeModulesPath)) {
                        layerPaths.push(nodeModulesPath);
                    }
                }
            }

            const nodePath = [
                env.NODE_PATH,
                ...layerPaths,
                process.env.NODE_PATH
            ].filter(Boolean).join(':');

            const worker = new Worker(
                isTs ? `require('ts-node').register(); require('${workerScript}')` : workerScript,
                {
                    eval: isTs,
                    workerData: this.sanitize({
                        handlerPath,
                        handlerClassName,
                        event,
                        context: fullContext
                    }),
                    env: {
                        ...process.env,
                        ...env,
                        NODE_PATH: nodePath
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
