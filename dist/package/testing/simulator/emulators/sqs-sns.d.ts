import { IEmulator } from '../interfaces';
export declare class SqsSnsEmulator implements IEmulator {
    readonly name = "SQS/SNS";
    private readonly logger;
    private server?;
    private readonly port;
    private queues;
    private topics;
    private subscriptions;
    constructor(options?: {
        port?: number;
    });
    start(): Promise<void>;
    stop(): Promise<void>;
    getEndpoint(): string;
    getMessages(queueName: string): any[] | undefined;
}
