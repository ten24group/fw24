import { Simulator } from './index';
import { ISimulatorConfig } from './interfaces';
import { LambdaRunner } from './lambda-runner';
import { ApiGatewayEmulator, ApiRoute } from './emulators/api-gateway';
import { SqsBridge, SqsSubscription } from './bridges/sqs-bridge';
import { createLogger } from '../../logging';
import { CDKParser } from './cdk-parser';
import { SidecarManager } from './sidecar-manager';

export class SimulatorCoordinator {
    private readonly logger = createLogger(SimulatorCoordinator.name);
    private readonly simulator: Simulator;
    private readonly lambdaRunner: LambdaRunner;
    private readonly sidecarManager: SidecarManager;
    private readonly apiGatewayEmulator: ApiGatewayEmulator;
    private readonly sqsBridge: SqsBridge;

    constructor(config: ISimulatorConfig = {}) {
        this.lambdaRunner = new LambdaRunner();
        this.sidecarManager = new SidecarManager();
        this.simulator = new Simulator(config);

        this.apiGatewayEmulator = new ApiGatewayEmulator(this.lambdaRunner, { port: config.port });
        // SQS bridge will now point to local sidecar endpoint
        this.sqsBridge = new SqsBridge(this.lambdaRunner, null);

        this.simulator.addEmulator(this.apiGatewayEmulator);
        this.simulator.addBridge(this.sqsBridge);
    }

    async syncWithCDK(cdkOutDir: string = 'cdk.out') {
        const parser = new CDKParser(cdkOutDir);
        const blueprint = parser.parse();

        const lambdaConfigs = new Map<string, any>();
        blueprint.lambdas.forEach(l => {
            lambdaConfigs.set(l.id, {
                entry: l.codePath, // This is the bundled code path
                handlerClassName: l.handler.split('.').pop(), // e.g. index.handler -> handler
                environment: {
                    ...l.environment,
                    // Automatically point to local sidecars
                    AWS_ENDPOINT_URL: `http://localhost:4566`, // General fallback
                    AWS_ENDPOINT_URL_DYNAMODB: `http://localhost:8000`,
                    AWS_ENDPOINT_URL_SQS: `http://localhost:9324`,
                    AWS_ENDPOINT_URL_S3: `http://localhost:9000`,
                    AWS_ENDPOINT_URL_SNS: `http://localhost:4566`,
                    AWS_REGION: l.environment.AWS_REGION || 'us-east-1',
                    AWS_ACCESS_KEY_ID: 'local',
                    AWS_SECRET_ACCESS_KEY: 'local',
                }
            });
        });

        this.setLambdaConfigs(lambdaConfigs);

        const routes: ApiRoute[] = blueprint.routes.map(r => ({
            method: r.method,
            path: r.path,
            handlerId: r.lambdaId,
            controllerName: '' // Parser might need to extract this if needed
        }));

        this.setApiRoutes(routes);

        // Start sidecars based on resources found
        if (blueprint.resources.some(r => r.type === 'AWS::DynamoDB::Table')) {
            await this.sidecarManager.startDynamoDB();
        }
        if (blueprint.resources.some(r => r.type === 'AWS::SQS::Queue')) {
            await this.sidecarManager.startSQS();
        }

        // Initialize resource schema (create tables, etc.)
        await this.sidecarManager.initResources(blueprint.resources);
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
