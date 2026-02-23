import { Simulator } from './index';
import { ISimulatorConfig } from './interfaces';
import { LambdaRunner } from './lambda-runner';
import { DynamoDBEmulator } from './emulators/dynamodb';
import { SqsSnsEmulator } from './emulators/sqs-sns';
import { ApiGatewayEmulator, ApiRoute } from './emulators/api-gateway';
import { SqsBridge, SqsSubscription } from './bridges/sqs-bridge';
import { createLogger } from '../../logging';

export class SimulatorCoordinator {
    private readonly logger = createLogger(SimulatorCoordinator.name);
    private readonly simulator: Simulator;
    private readonly lambdaRunner: LambdaRunner;

    private readonly dynamoDbEmulator: DynamoDBEmulator;
    private readonly sqsSnsEmulator: SqsSnsEmulator;
    private readonly apiGatewayEmulator: ApiGatewayEmulator;

    private readonly sqsBridge: SqsBridge;

    constructor(config: ISimulatorConfig = {}) {
        this.lambdaRunner = new LambdaRunner();
        this.simulator = new Simulator(config);

        this.dynamoDbEmulator = new DynamoDBEmulator({ port: config.dynamoDbPort });
        this.sqsSnsEmulator = new SqsSnsEmulator({ port: config.sqsPort });
        this.apiGatewayEmulator = new ApiGatewayEmulator(this.lambdaRunner, { port: config.port });

        this.sqsBridge = new SqsBridge(this.lambdaRunner, this.sqsSnsEmulator);

        this.simulator.addEmulator(this.dynamoDbEmulator);
        this.simulator.addEmulator(this.sqsSnsEmulator);
        this.simulator.addEmulator(this.apiGatewayEmulator);

        this.simulator.addBridge(this.sqsBridge);
    }

    setLambdaConfigs(configs: Map<string, any>) {
        this.apiGatewayEmulator.setLambdaConfigs(configs);
        this.sqsBridge.setLambdaConfigs(configs);
    }

    async start() {
        await this.simulator.start();
    }

    async stop() {
        await this.simulator.stop();
    }

    setApiRoutes(routes: ApiRoute[]) {
        this.apiGatewayEmulator.setRoutes(routes);
    }

    setSqsSubscriptions(subs: SqsSubscription[]) {
        this.sqsBridge.setSubscriptions(subs);
    }

    getLambdaRunner() {
        return this.lambdaRunner;
    }
}
