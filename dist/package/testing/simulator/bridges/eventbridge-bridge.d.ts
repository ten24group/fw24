import { IBridge, ILambdaRunner } from '../interfaces';
export interface EventBridgeRule {
    id: string;
    schedule: string;
    targets: any[];
}
export declare class EventBridgeBridge implements IBridge {
    private readonly lambdaRunner;
    readonly name = "EventBridge";
    private readonly logger;
    private tasks;
    private rules;
    private lambdaConfigs;
    constructor(lambdaRunner: ILambdaRunner);
    setLambdaConfigs(configs: Map<string, any>): void;
    setRules(rules: EventBridgeRule[]): void;
    start(): Promise<void>;
    private awsScheduleToCron;
    private stopTasks;
    stop(): Promise<void>;
}
