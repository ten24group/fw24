import { IBridge, ILambdaRunner } from '../interfaces';
export interface SnsSubscription {
    id: string;
    topicArn: string;
    endpoint: string;
    protocol: 'lambda' | 'sqs' | 'email';
}
export declare class SnsBridge implements IBridge {
    private readonly lambdaRunner;
    readonly name = "SNS";
    private readonly logger;
    private subscriptions;
    private lambdaConfigs;
    private snsClient;
    private sqsClient;
    private interval?;
    constructor(lambdaRunner: ILambdaRunner);
    setLambdaConfigs(configs: Map<string, any>): void;
    setSubscriptions(subs: SnsSubscription[]): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    relayPublish(topicArn: string, message: string, messageAttributes?: any): Promise<void>;
}
