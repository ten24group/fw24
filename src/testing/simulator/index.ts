import { createLogger } from "../../logging";
import { ISimulator, ISimulatorConfig, IEmulator, IBridge } from "./interfaces";

export class Simulator implements ISimulator {
    private readonly logger = createLogger(Simulator.name);
    private emulators: IEmulator[] = [];
    private bridges: IBridge[] = [];

    constructor(private readonly config: ISimulatorConfig) {}

    async start(): Promise<void> {
        this.logger.info("Starting FW24 Simulator...");

        for (const emulator of this.emulators) {
            this.logger.info(`Starting ${emulator.name} emulator...`);
            await emulator.start();
        }

        for (const bridge of this.bridges) {
            this.logger.info(`Starting ${bridge.name} bridge...`);
            await bridge.start();
        }

        this.logger.info("FW24 Simulator is ready!");
    }

    async stop(): Promise<void> {
        this.logger.info("Stopping FW24 Simulator...");

        for (const bridge of this.bridges) {
            await bridge.stop();
        }

        for (const emulator of this.emulators) {
            await emulator.stop();
        }

        this.logger.info("FW24 Simulator stopped.");
    }

    addEmulator(emulator: IEmulator) {
        this.emulators.push(emulator);
    }

    addBridge(bridge: IBridge) {
        this.bridges.push(bridge);
    }
}
