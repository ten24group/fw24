import { CfnOutput } from "aws-cdk-lib";
import { Topic, TopicProps } from 'aws-cdk-lib/aws-sns';

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";
import { LogDuration, createLogger } from "../logging";


export interface ISNSConfig {
    topicName: string;
    topicProps?: TopicProps;
}

export class SNSStack implements IStack {
    readonly logger = createLogger(SNSStack.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    dependencies: string[] = [];

    constructor(private config: ISNSConfig[]) {
        this.logger.debug("constructor: ", config);
        Helper.hydrateConfig(config,'sns');
    }

    @LogDuration()
    public async construct() {
        this.logger.debug("construct: ");

        const mainStack = this.fw24.getStack('main');

        this.config.forEach( ( snsConfig: ISNSConfig ) => {
            this.logger.debug("Creating topic: ", snsConfig.topicName);

            const topic = new Topic(mainStack, snsConfig.topicName + '-topic', {
                ...snsConfig.topicProps
            });

            this.fw24.set(snsConfig.topicName, topic.topicName, "topicName");

            new CfnOutput(mainStack, snsConfig.topicName + 'Output', {
                value: topic.topicName,
            });
        });
    }
}   