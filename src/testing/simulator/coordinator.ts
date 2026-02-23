import { Simulator } from './index';
import { ISimulatorConfig } from './interfaces';
import { LambdaRunner } from './lambda-runner';
import { ApiGatewayEmulator, ApiRoute } from './emulators/api-gateway';
import { SqsBridge } from './bridges/sqs-bridge';
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
        this.sqsBridge = new SqsBridge(this.lambdaRunner, `http://localhost:9324`);

        this.simulator.addEmulator(this.apiGatewayEmulator);
        this.simulator.addBridge(this.sqsBridge);
    }

    async syncWithCDK(cdkOutDir: string = 'cdk.out') {
        this.logger.info(`Syncing simulator with CDK blueprint from ${cdkOutDir}...`);
        const parser = new CDKParser(cdkOutDir);
        const blueprint = parser.parse();

        const lambdaConfigs = new Map<string, any>();
        blueprint.lambdas.forEach(l => {
            lambdaConfigs.set(l.id, {
                entry: l.codePath,
                handlerClassName: l.handler.split('.').pop(),
                environment: {
                    ...l.environment,
                    AWS_ENDPOINT_URL: `http://localhost:4566`,
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

        this.apiGatewayEmulator.setLambdaConfigs(lambdaConfigs);
        this.sqsBridge.setLambdaConfigs(lambdaConfigs);

        const routes: ApiRoute[] = blueprint.routes.map(r => ({
            method: r.method,
            path: r.path,
            handlerId: r.lambdaId,
            controllerName: ''
        }));

        this.apiGatewayEmulator.setRoutes(routes);

        // Start sidecars
        if (blueprint.resources.some(r => r.type === 'AWS::DynamoDB::Table')) {
            await this.sidecarManager.startDynamoDB();
        }
        if (blueprint.resources.some(r => r.type === 'AWS::SQS::Queue')) {
            await this.sidecarManager.startSQS();
        }

        // Initialize resource schema
        await this.sidecarManager.initResources(blueprint.resources);
    }

    async start() {
        await this.simulator.start();
    }

    async stop() {
        await this.simulator.stop();
        await this.sidecarManager.stopAll();
    }

    getLambdaRunner() {
        return this.lambdaRunner;
    }
}
