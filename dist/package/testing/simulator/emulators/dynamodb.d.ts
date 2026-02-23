import { IEmulator } from '../interfaces';
export declare class DynamoDBEmulator implements IEmulator {
    readonly name = "DynamoDB";
    private readonly logger;
    private process?;
    private readonly port;
    private readonly dataDir?;
    constructor(options?: {
        port?: number;
        dataDir?: string;
    });
    start(): Promise<void>;
    stop(): Promise<void>;
    getEndpoint(): string;
}
