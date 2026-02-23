import express from 'express';
import { Server } from 'node:http';
import { IEmulator, ILambdaRunner } from '../interfaces';
import { createLogger } from '../../../logging';

export interface ApiRoute {
    method: string;
    path: string;
    handlerId: string;
    controllerName: string;
    authorizer?: {
        type: string;
        name?: string;
        groups?: string[];
    };
}

export class ApiGatewayEmulator implements IEmulator {
    readonly name = 'API Gateway';
    private readonly logger = createLogger(ApiGatewayEmulator.name);
    private server?: Server;
    private readonly port: number;
    private routes: ApiRoute[] = [];

    private lambdaConfigs: Map<string, any> = new Map();

    constructor(private readonly lambdaRunner: ILambdaRunner, options: { port?: number } = {}) {
        this.port = options.port || 3000;
    }

    setLambdaConfigs(configs: Map<string, any>) {
        this.lambdaConfigs = configs;
    }

    setRoutes(routes: ApiRoute[]) {
        this.routes = routes;
    }

    async start(): Promise<void> {
        if (this.server) {
            this.logger.info("Restarting API Gateway Emulator...");
            await this.stop();
        }

        const app = express();
        app.use(express.json());
        app.use(express.raw({ type: '*/*' }));

        const { match } = require('path-to-regexp');

        // Dynamic routing middleware
        app.use(async (req: express.Request, res: express.Response): Promise<any> => {
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
                    // Auth Check
                    const authorizerContext = await this.authorizeRequest(req, matchingRoute);
                    if (!authorizerContext.authorized) {
                        return res.status(authorizerContext.statusCode || 401).json({ message: authorizerContext.message || "Unauthorized" });
                    }

                    const lambdaConfig = this.lambdaConfigs.get(matchingRoute.handlerId);
                    if (!lambdaConfig) {
                        throw new Error(`Lambda configuration not found for ID: ${matchingRoute.handlerId}`);
                    }

                    const event = this.mapRequestToApiGatewayEvent(req, matchingRoute, params, authorizerContext.context);
                    const context = {}; // Mock context

                    const result = await this.lambdaRunner.runHandler(
                        lambdaConfig.entry,
                        lambdaConfig.handlerClassName,
                        event,
                        context,
                        lambdaConfig.environment
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

    private mapRequestToApiGatewayEvent(req: express.Request, route: ApiRoute, pathParameters: any, authorizerContext?: any) {
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
                authorizer: authorizerContext,
                identity: {
                    sourceIp: req.ip,
                    userArn: authorizerContext?.iam?.userArn,
                    apiKey: req.headers[ 'x-api-key' ]
                },
                stage: 'local'
            }
        };
    }

    private async authorizeRequest(req: express.Request, route: ApiRoute): Promise<{ authorized: boolean, statusCode?: number, message?: string, context?: any }> {
        const { authorizer } = route;

        if (!authorizer || authorizer.type === 'NONE') {
            return { authorized: true };
        }

        const authHeader = req.headers.authorization || (req.headers['Authorization'] as string);

        if (authorizer.type === 'COGNITO_USER_POOLS' || authorizer.type === 'JWT' || authorizer.type === 'CUSTOM') {
            if (!authHeader) {
                return { authorized: false, message: "Missing Authorization header" };
            }

            try {
                let claims: any = {};
                if (authHeader.startsWith('Bearer ')) {
                    const token = authHeader.substring(7);
                    const parts = token.split('.');
                    if (parts.length === 3) {
                        try {
                            claims = JSON.parse(Buffer.from(parts[ 1 ], 'base64').toString());
                        } catch (e) {
                            claims = { sub: token, email: `${token}@example.com` };
                        }
                    } else {
                        claims = { sub: token, email: `${token}@example.com` };
                    }
                } else {
                    // Treat direct token as sub
                    claims = { sub: authHeader, email: `${authHeader}@example.com` };
                }

                // Simulating Cognito Groups from header if present for easier testing
                const groupsHeader = req.headers['x-simulated-groups'];
                if (groupsHeader) {
                    claims['cognito:groups'] = (groupsHeader as string).split(',');
                }

                // Check groups if required
                if (authorizer.groups && authorizer.groups.length > 0) {
                    const userGroups = claims[ 'cognito:groups' ] || [];
                    const hasGroup = authorizer.groups.some(g => userGroups.includes(g));
                    if (!hasGroup) {
                        this.logger.warn(`Auth Failed: User ${claims.sub} not in required groups: ${authorizer.groups}`);
                        return { authorized: false, statusCode: 403, message: "Insufficient permissions (group membership required)" };
                    }
                }

                return { authorized: true, context: { claims } };
            } catch (e) {
                return { authorized: false, message: "Invalid token" };
            }
        }

        if (authorizer.type === 'AWS_IAM') {
            // Check for SigV4 headers
            const hasSigV4 = authHeader?.includes('AWS4-HMAC-SHA256') || req.headers['x-amz-date'];

            if (!hasSigV4) {
                return { authorized: false, message: "Missing or invalid AWS SigV4 Authorization headers" };
            }

            // For simulator, we assume valid signature and extract mock IAM info
            // Allow overriding via headers for testing
            const userArn = (req.headers['x-simulated-iam-arn'] as string) || 'arn:aws:iam::123456789012:user/mock-user';

            return {
                authorized: true, context: {
                    iam: {
                        userArn,
                        userId: userArn.split('/').pop()
                    }
                }
            };
        }

        return { authorized: true };
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
