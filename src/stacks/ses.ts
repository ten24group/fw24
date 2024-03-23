import { Stack, Duration, CfnOutput } from "aws-cdk-lib";
import { EmailIdentity, Identity } from "aws-cdk-lib/aws-ses";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";

import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { join } from "path";

import { IApplicationConfig } from "../interfaces/config";
import { ISESConfig } from "../interfaces/ses";
import { Helper } from "../core/helper";
import { IStack } from "../interfaces/stack";
import { Fw24 } from "../core/fw24";
import { QueueLambda } from "../constructs/queue-lambda";

export class SESStack implements IStack{
    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;

    // default contructor to initialize the stack configuration
    constructor(private stackConfig: ISESConfig) {
        console.log("SES");
        Helper.hydrateConfig(stackConfig,'SES');
    }

    // construct method to create the stack
    public construct(fw24: Fw24) {
        console.log("SES construct");
        // make the appConfig available to the class
        this.appConfig = fw24.getConfig();
        // make the main stack available to the class
        this.mainStack = fw24.getStack("main");
       
        // create identity
        const identity = new EmailIdentity(this.mainStack, `${fw24.appName}-ses-identity`, {
            identity: Identity.domain(this.stackConfig.domain)
        });
        
        console.log("SES identity: ", identity);

        // create main queue
        const queue = new QueueLambda(this.mainStack, `${this.appConfig?.name}-mail-queue`, {
            queueName: `${this.appConfig?.name}-mail-queue`,
            visibilityTimeout: Duration.seconds(30),
            receiveMessageWaitTime: Duration.seconds(10),
            entry: join(__dirname,"../core/mail-processor.js"),
            policies: [{
                actions: ["ses:SendEmail", "SES:SendRawEmail"],
                resources: ["*"],
                effect: Effect.ALLOW,
            }],
        }).queue;

        new CfnOutput(this.mainStack, "mail-queue-url", {
            value: queue.queueUrl,
            exportName: `${this.appConfig?.name}-mail-queue`,
        });
    }
}
