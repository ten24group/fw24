import { Stack, CfnOutput } from "aws-cdk-lib";
import { Topic } from 'aws-cdk-lib/aws-sns';

import { IApplicationConfig } from "../interfaces/config";
import { Helper } from "../core/helper";


export interface ISNSConfig {
    topicName: string;
}

export class S3Stack {
    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;

    constructor(private config: ISNSConfig[]) {
        console.log("sns", config);
        Helper.hydrateConfig(config,'sns');

    }

    public construct(appConfig: IApplicationConfig) {
        console.log("sns construct", appConfig, this.config);
        this.appConfig = appConfig;

        console.log("Creating sns topics: ");

        this.mainStack = Reflect.get(globalThis, "mainStack");

        this.createTopics();

    }

    private createTopics() {
        
        this.config.forEach( ( snsConfig: ISNSConfig ) => {
            this.createTopic(snsConfig);
        });
    }

    private createTopic(snsConfig: ISNSConfig) {
        console.log("Creating topic: ", snsConfig.topicName);
        const topicName = this.getUniqueName(snsConfig.topicName);
        var topicParams: any = {
            topicName: topicName
        };

        const topic = new Topic(this.mainStack, snsConfig.topicName + '-topic', topicParams);
        

        new CfnOutput(this.mainStack, snsConfig.topicName + 'Output', {
            value: topic.topicName,
        });
    }
    

    // move to fw24 context
    public getUniqueName(name: string) {
        return `${name}-${this.appConfig?.name}-${this.appConfig?.env}-${this.mainStack.account}`;
    }


}   