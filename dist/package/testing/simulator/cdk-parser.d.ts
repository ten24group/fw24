export interface SimulatedLambda {
    id: string;
    handler: string;
    runtime: string;
    codePath: string;
    environment: Record<string, string>;
}
export interface SimulatedApiRoute {
    method: string;
    path: string;
    lambdaId: string;
    authorizer?: {
        type: string;
        groups?: string[];
    };
}
export interface SimulatedResource {
    id: string;
    type: string;
    properties: any;
}
export interface SimulatedSqsSubscription {
    queueName: string;
    lambdaId: string;
}
export declare class CDKParser {
    private readonly logger;
    private readonly cdkOutDir;
    private resourceMap;
    constructor(cdkOutDir?: string);
    parse(): {
        lambdas: SimulatedLambda[];
        routes: SimulatedApiRoute[];
        resources: SimulatedResource[];
        events: any[];
        subscriptions: any[];
        sqsSubscriptions: SimulatedSqsSubscription[];
        s3Notifications: any[];
    };
    private extractS3Notifications;
    private resolveCodePath;
    private resolveEnvironment;
    private resolveProperties;
    private resolveIntrinsic;
    private resolveRoute;
}
