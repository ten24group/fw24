import { IBridge, ILambdaRunner } from '../interfaces';
export interface SqsSubscription {
    queueName: string;
    handlerId: string;
}
export declare class SqsBridge implements IBridge {
    private readonly lambdaRunner;
    private readonly sqsEmulator;
    readonly name = "SQS";
    private readonly logger;
    private interval?;
    private subscriptions;
    private lambdaConfigs;
    constructor(lambdaRunner: ILambdaRunner, sqsEmulator: any);
    setLambdaConfigs(configs: Map<string, any>): void;
    setSubscriptions(subs: SqsSubscription[]): void;
    start(): Promise<void>;
    stop(): Promise<void>;
}
