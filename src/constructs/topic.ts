import { CfnOutput } from "aws-cdk-lib";
import { Topic, TopicProps } from 'aws-cdk-lib/aws-sns';

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutout, OutputType } from "../interfaces/construct";
import { LogDuration, createLogger } from "../logging";


export interface ITopicConstructConfig {
    topicName: string;
    topicProps?: TopicProps;
}

export class TopicConstruct implements FW24Construct {
    readonly logger = createLogger(TopicConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = TopicConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutout;

    constructor(private topicConstructConfig: ITopicConstructConfig[]) {
        Helper.hydrateConfig(topicConstructConfig,'SNS');
    }

    @LogDuration()
    public async construct() {
        this.logger.debug("construct: ");

        const mainStack = this.fw24.getStack('main');

        this.topicConstructConfig.forEach( ( topicConfig: ITopicConstructConfig ) => {
            this.logger.debug("Creating topic: ", topicConfig.topicName);

            const topic = new Topic(mainStack, topicConfig.topicName + '-topic', {
                ...topicConfig.topicProps
            });
            this.fw24.setConstructOutput(this, topicConfig.topicName, topic, OutputType.TOPIC);

            this.fw24.set(topicConfig.topicName, topic.topicName, "topicName");

            new CfnOutput(mainStack, topicConfig.topicName + 'Output', {
                value: topic.topicName,
            });
        });
    }
}   