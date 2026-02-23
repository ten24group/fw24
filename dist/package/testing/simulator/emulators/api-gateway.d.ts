import { IEmulator, ILambdaRunner } from '../interfaces';
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
export declare class ApiGatewayEmulator implements IEmulator {
    private readonly lambdaRunner;
    readonly name = "API Gateway";
    private readonly logger;
    private server?;
    private readonly port;
    private routes;
    private lambdaConfigs;
    constructor(lambdaRunner: ILambdaRunner, options?: {
        port?: number;
    });
    setLambdaConfigs(configs: Map<string, any>): void;
    setRoutes(routes: ApiRoute[]): void;
    start(): Promise<void>;
    private mapRequestToApiGatewayEvent;
    private authorizeRequest;
    stop(): Promise<void>;
    getEndpoint(): string;
}
