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
    private globalEnv;
    constructor(config?: ISimulatorConfig);
    setGlobalEnv(env: Record<string, string>): void;
    syncWithCDK(cdkOutDir?: string): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    getLambdaRunner(): LambdaRunner;
}
