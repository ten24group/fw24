import { ISimulator, ISimulatorConfig, IEmulator, IBridge } from "./interfaces";
export declare class Simulator implements ISimulator {
    private readonly config;
    private readonly logger;
    private emulators;
    private bridges;
    constructor(config: ISimulatorConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    addEmulator(emulator: IEmulator): void;
    addBridge(bridge: IBridge): void;
}
