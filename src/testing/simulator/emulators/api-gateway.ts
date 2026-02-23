import express from 'express';
import { Server } from 'node:http';
import { IEmulator, ILambdaRunner } from '../interfaces';
import { createLogger } from '../../../logging';

export interface ApiRoute {
    method: string;
    path: string;
    handlerPath: string;
    handlerClassName: string;
    controllerName: string;
    env?: Record<string, string>;
}

export class ApiGatewayEmulator implements IEmulator {
    readonly name = 'API Gateway';
    private readonly logger = createLogger(ApiGatewayEmulator.name);
    private server?: Server;
    private readonly port: number;
    private routes: ApiRoute[] = [];

    constructor(private readonly lambdaRunner: ILambdaRunner, options: { port?: number } = {}) {
        this.port = options.port || 3000;
    }

    setRoutes(routes: ApiRoute[]) {
        this.routes = routes;
    }

    async start(): Promise<void> {
        const app = express();
        app.use(express.json());
        app.use(express.raw({ type: '*/*' }));

        const { match } = require('path-to-regexp');

        // Dynamic routing middleware
        app.use(async (req, res) => {
            // Find matching route
            let matchingRoute: ApiRoute | undefined;
            let params: any = {};

            for (const route of this.routes) {
                if (route.method.toUpperCase() !== req.method.toUpperCase()) continue;

                const expressPath = route.path.replace(/\{([^}]+)\}/g, ':$1');
                const matcher = match(expressPath, { decode: decodeURIComponent });
                const result = matcher(req.path);

                if (result) {
                    matchingRoute = route;
                    params = result.params;
                    break;
                }
            }

            if (matchingRoute) {
                try {
                    const event = this.mapRequestToApiGatewayEvent(req, matchingRoute, params);
                    const context = {}; // Mock context

                    const result = await this.lambdaRunner.runHandler(
                        matchingRoute.handlerPath,
                        matchingRoute.handlerClassName,
                        event,
                        context,
                        matchingRoute.env
                    );

                    res.status(result.statusCode || 200);
                    if (result.headers) {
                        Object.entries(result.headers).forEach(([ k, v ]) => res.setHeader(k, v as string));
                    }
                    res.send(result.body);
                } catch (error: any) {
                    this.logger.error(`Error handling ${req.method} ${req.path}:`, error);
                    res.status(500).json({ message: error.message });
                }
            } else {
                res.status(404).json({ message: `No route found for ${req.method} ${req.path}` });
            }
        });

        return new Promise((resolve) => {
            this.server = app.listen(this.port, () => {
                this.logger.info(`API Gateway Emulator listening on http://localhost:${this.port}`);
                resolve();
            });
        });
    }

    private mapRequestToApiGatewayEvent(req: express.Request, route: ApiRoute, pathParameters: any) {
        return {
            httpMethod: req.method,
            path: req.path,
            resource: route.path, // This is the parameterized path
            headers: req.headers,
            queryStringParameters: Object.keys(req.query).length > 0 ? req.query : null,
            pathParameters: Object.keys(pathParameters).length > 0 ? pathParameters : null,
            body: req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : null,
            requestContext: {
                httpMethod: req.method,
                path: req.path,
                resourcePath: route.path,
                identity: {
                    sourceIp: req.ip
                },
                stage: 'local'
            }
        };
    }

    async stop(): Promise<void> {
        return new Promise((resolve) => {
            this.server?.close(() => resolve());
        });
    }

    getEndpoint(): string {
        return `http://localhost:${this.port}`;
    }
}
