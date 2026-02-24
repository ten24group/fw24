import { IBridge, ILambdaRunner } from '../interfaces';
export interface SqsSubscription {
    queueName: string;
    handlerId: string;
}
export declare class SqsBridge implements IBridge {
    private readonly lambdaRunner;
    readonly name = "SQS";
    private readonly logger;
    private interval?;
    private subscriptions;
    private lambdaConfigs;
    private client;
    constructor(lambdaRunner: ILambdaRunner, sqsEndpoint?: string);
    setLambdaConfigs(configs: Map<string, any>): void;
    setSubscriptions(subs: SqsSubscription[]): void;
    start(): Promise<void>;
    stop(): Promise<void>;
}
