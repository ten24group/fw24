import { ISimulatorConfig } from './interfaces';
import { LambdaRunner } from './lambda-runner';
import { ApiRoute } from './emulators/api-gateway';
import { SqsSubscription } from './bridges/sqs-bridge';
export declare class SimulatorCoordinator {
    private readonly logger;
    private readonly simulator;
    private readonly lambdaRunner;
    private readonly dynamoDbEmulator;
    private readonly sqsSnsEmulator;
    private readonly apiGatewayEmulator;
    private readonly sqsBridge;
    constructor(config?: ISimulatorConfig);
    setLambdaConfigs(configs: Map<string, any>): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    setApiRoutes(routes: ApiRoute[]): void;
    setSqsSubscriptions(subs: SqsSubscription[]): void;
    getLambdaRunner(): LambdaRunner;
}
