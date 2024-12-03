import { CfnOutput } from "aws-cdk-lib";
import { Topic, TopicProps } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription, SmsSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { LogDuration, createLogger } from "../logging";


/**
 * Represents the configuration for a topic construct.
 */
export interface ITopicConstructConfig {
    topicName: string;
    topicProps?: TopicProps;
    notificationProps?: {
        email?: string[];
        sms?: string[];
    }
}

export class TopicConstruct implements FW24Construct {
    readonly logger = createLogger(TopicConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = TopicConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutput;

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
            this.fw24.setEnvironmentVariable(topicConfig.topicName, topic.topicName, "topicName");
            this.fw24.setEnvironmentVariable(topicConfig.topicName, topic, "topic");

            if(topicConfig.notificationProps?.email){
                for (const email of topicConfig.notificationProps.email) {
                    topic.addSubscription(
                        new EmailSubscription(email)
                    );
                }
            }

            if(topicConfig.notificationProps?.sms){
                for (const sms of topicConfig.notificationProps.sms) {
                    topic.addSubscription(
                        new SmsSubscription(sms)
                    );
                }
            }

            new CfnOutput(mainStack, topicConfig.topicName + 'Output', {
                value: topic.topicName,
            });
        });
    }
}   