import { IEmulator } from '../interfaces';
import { SnsBridge } from '../bridges/sns-bridge';
export declare class AwsMockEmulator implements IEmulator {
    private readonly snsBridge;
    readonly name = "AWS Mock (SNS/SES)";
    private readonly logger;
    private server?;
    private readonly port;
    constructor(snsBridge: SnsBridge, options?: {
        port?: number;
    });
    start(): Promise<void>;
    stop(): Promise<void>;
    getEndpoint(): string;
}
