import { Stack } from "aws-cdk-lib";
import { TopicProps } from 'aws-cdk-lib/aws-sns';
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { IConstructConfig } from "../interfaces/construct-config";
/**
 * Represents the configuration for a topic construct.
 */
export interface ITopicConstructConfig extends IConstructConfig {
    topicName: string;
    topicProps?: TopicProps;
    notificationProps?: {
        email?: string[];
        sms?: string[];
    };
}
export declare class TopicConstruct implements FW24Construct {
    private topicConstructConfig;
    private stackName?;
    private parentStackName?;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    constructor(topicConstructConfig: ITopicConstructConfig[], stackName?: string | undefined, parentStackName?: string | undefined);
    construct(): Promise<void>;
}
