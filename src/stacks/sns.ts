import { CfnOutput } from "aws-cdk-lib";
import { Topic } from 'aws-cdk-lib/aws-sns';

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";


export interface ISNSConfig {
    topicName: string;
}

export class SNSStack implements IStack {
    fw24: Fw24 = Fw24.getInstance();
    dependencies: string[] = [];

    constructor(private config: ISNSConfig[]) {
        console.log("sns", config);
        Helper.hydrateConfig(config,'sns');
    }

    public construct() {
        console.log("sns construct");

        const mainStack = this.fw24.getStack('main');

        this.config.forEach( ( snsConfig: ISNSConfig ) => {
            console.log("Creating topic: ", snsConfig.topicName);

            const topic = new Topic(mainStack, snsConfig.topicName + '-topic', {
                topicName: this.fw24.getUniqueName(snsConfig.topicName)
            });

            new CfnOutput(mainStack, snsConfig.topicName + 'Output', {
                value: topic.topicName,
            });
        });
    }
}   