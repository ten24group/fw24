import { Duration, CfnOutput } from "aws-cdk-lib";
import { EmailIdentity, Identity } from "aws-cdk-lib/aws-ses";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Effect } from "aws-cdk-lib/aws-iam";
import { join } from "path";

import { Helper } from "../core/helper";
import { IStack } from "../interfaces/stack";
import { Fw24 } from "../core/fw24";
import { QueueLambda } from "../constructs/queue-lambda";

export interface ISESConfig {
    domain: string;
    sesOptions?: {};
}

export class SESStack implements IStack{

    // default contructor to initialize the stack configuration
    constructor(private stackConfig: ISESConfig) {
        console.log("SES");
        Helper.hydrateConfig(stackConfig,'SES');
    }

    // construct method to create the stack
    public construct() {
        console.log("SES construct");

        const fw24 = Fw24.getInstance();
        // make the main stack available to the class
        const mainStack = fw24.getStack("main");
       
        // create identity
        const identity = new EmailIdentity(mainStack, `${fw24.appName}-ses-identity`, {
            identity: Identity.domain(this.stackConfig.domain)
        });
        
        console.log("SES identity: ", identity);

        // create main queue
        const queue = new QueueLambda(mainStack, `${fw24.appName}-mail-queue`, {
            queueName: `${fw24.appName}-mail-queue`,
            visibilityTimeout: Duration.seconds(30),
            receiveMessageWaitTime: Duration.seconds(10),
            entry: join(__dirname,"../core/mail-processor.js"),
            policies: [{
                actions: ["ses:SendEmail", "SES:SendRawEmail"],
                resources: ["*"],
                effect: Effect.ALLOW,
            }],
            batchSize: 1,
            maxBatchingWindow: Duration.seconds(5),
            reportBatchItemFailures: true,
        }) as Queue;
        
        // print queue url
        new CfnOutput(mainStack, "mail-queue-url", {
            value: queue.queueUrl,
            exportName: `${fw24.appName}-mail-queue`,
        });
    }
}
