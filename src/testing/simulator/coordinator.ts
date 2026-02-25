import { Simulator } from './index';
import { ISimulatorConfig } from './interfaces';
import { LambdaRunner } from './lambda-runner';
import { ApiGatewayEmulator, ApiRoute } from './emulators/api-gateway';
import { SqsBridge } from './bridges/sqs-bridge';
import { SnsBridge } from './bridges/sns-bridge';
import { EventBridgeBridge } from './bridges/eventbridge-bridge';
import { createLogger } from '../../logging';
import { CDKParser } from './cdk-parser';
import { SidecarManager } from './sidecar-manager';
import { AwsMockEmulator } from './emulators/aws-mock';

export class SimulatorCoordinator {
    private readonly logger = createLogger(SimulatorCoordinator.name);
    private readonly simulator: Simulator;
    private readonly lambdaRunner: LambdaRunner;
    private readonly sidecarManager: SidecarManager;
    private readonly apiGatewayEmulator: ApiGatewayEmulator;
    private readonly awsMockEmulator: AwsMockEmulator;
    private readonly sqsBridge: SqsBridge;
    private readonly snsBridge: SnsBridge;
    private readonly eventBridgeBridge: EventBridgeBridge;
    private globalEnv: Record<string, string> = {};

    constructor(config: ISimulatorConfig = {}) {
        this.lambdaRunner = new LambdaRunner();
        this.sidecarManager = new SidecarManager();
        this.simulator = new Simulator(config);

        this.apiGatewayEmulator = new ApiGatewayEmulator(this.lambdaRunner, { port: config.port });
        this.sqsBridge = new SqsBridge(this.lambdaRunner, `http://localhost:9324`);
        this.snsBridge = new SnsBridge(this.lambdaRunner);
        this.eventBridgeBridge = new EventBridgeBridge(this.lambdaRunner);
        this.awsMockEmulator = new AwsMockEmulator(this.snsBridge, { port: config.snsPort });

        this.simulator.addEmulator(this.apiGatewayEmulator);
        this.simulator.addEmulator(this.awsMockEmulator);
        this.simulator.addBridge(this.sqsBridge);
        this.simulator.addBridge(this.snsBridge);
        this.simulator.addBridge(this.eventBridgeBridge);
    }

    setGlobalEnv(env: Record<string, string>) {
        this.globalEnv = env;
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
                    ...this.globalEnv,
                    ...l.environment,
                    AWS_ENDPOINT_URL: `http://localhost:4566`,
                    AWS_ENDPOINT_URL_DYNAMODB: `http://localhost:8000`,
                    AWS_ENDPOINT_URL_SQS: `http://localhost:9324`,
                    AWS_ENDPOINT_URL_S3: `http://localhost:9000`,
                    AWS_ENDPOINT_URL_SNS: `http://localhost:4566`,
                    AWS_ENDPOINT_URL_SES: `http://localhost:4566`,
                    AWS_ENDPOINT_URL_COGNITO: `http://localhost:9229`,
                    AWS_REGION: l.environment.AWS_REGION || 'us-east-1',
                    AWS_ACCESS_KEY_ID: 'local',
                    AWS_SECRET_ACCESS_KEY: 'localpassword',
                    MEILI_HOST: 'http://localhost:7700',
                    MEILI_MASTER_KEY: l.environment.MEILI_MASTER_KEY || 'masterKey'
                }
            });
        });

        this.apiGatewayEmulator.setLambdaConfigs(lambdaConfigs);
        this.sqsBridge.setLambdaConfigs(lambdaConfigs);
        this.snsBridge.setLambdaConfigs(lambdaConfigs);
        this.eventBridgeBridge.setLambdaConfigs(lambdaConfigs);

        this.snsBridge.setSubscriptions(blueprint.subscriptions);
        this.eventBridgeBridge.setRules(blueprint.events);
        this.sqsBridge.setSubscriptions(blueprint.sqsSubscriptions.map(s => ({
            queueName: s.queueName,
            handlerId: s.lambdaId
        })));

        const routes: ApiRoute[] = blueprint.routes.map(r => ({
            method: r.method,
            path: r.path,
            handlerId: r.lambdaId,
            controllerName: '',
            authorizer: r.authorizer
        }));

        this.apiGatewayEmulator.setRoutes(routes);

        this.logger.info(`Parsed ${routes.length} routes from blueprint.`);
        if (routes.length > 0) {
            routes.forEach(r => {
                this.logger.info(`  → ${r.method.padEnd(6)} ${r.path}`);
            });
        }

        // Start sidecars
        if (blueprint.resources.some(r => r.type === 'AWS::DynamoDB::Table')) {
            await this.sidecarManager.startDynamoDB();
        }
        if (blueprint.resources.some(r => r.type === 'AWS::SQS::Queue')) {
            await this.sidecarManager.startSQS();
        }
        if (blueprint.resources.some(r => r.type === 'AWS::S3::Bucket')) {
            await this.sidecarManager.startS3();
        }
        if (blueprint.resources.some(r => r.type === 'AWS::Cognito::UserPool')) {
            await this.sidecarManager.startCognito();
        }
        if (blueprint.lambdas.some(l => l.environment.MEILI_HOST)) {
            await this.sidecarManager.startMeiliSearch();
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
