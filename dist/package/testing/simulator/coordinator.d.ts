import { ISimulatorConfig } from './interfaces';
import { LambdaRunner } from './lambda-runner';
export declare class SimulatorCoordinator {
    private readonly logger;
    private readonly simulator;
    private readonly lambdaRunner;
    private readonly sidecarManager;
    private readonly apiGatewayEmulator;
    private readonly awsMockEmulator;
    private readonly sqsBridge;
    private readonly snsBridge;
    private readonly eventBridgeBridge;
    constructor(config?: ISimulatorConfig);
    syncWithCDK(cdkOutDir?: string): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    getLambdaRunner(): LambdaRunner;
}
