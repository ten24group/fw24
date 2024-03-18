import { Stack, Duration, CfnOutput } from "aws-cdk-lib";
import { EmailIdentity, Identity } from "aws-cdk-lib/aws-ses";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { join } from "path";

import { IApplicationConfig } from "../interfaces/config";
import { ISESConfig } from "../interfaces/ses";
import { Helper } from "../core/helper";

export class SESStack {
    //public queueURL!: Queue.QueueUrl;
    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;

    constructor(private config: ISESConfig) {
        console.log("SES", config);
        Helper.hydrateConfig(config,'SQS');

    }

    public construct(appConfig: IApplicationConfig) {
        console.log("SES construct", appConfig, this.config);
        this.appConfig = appConfig;

        this.mainStack = Reflect.get(globalThis, "mainStack");
       
        // create identity
        const identity = new EmailIdentity(this.mainStack, `${appConfig.name}-ses-identity`, {
            identity: Identity.domain(this.config.domain)
        });
        
        console.log("SES identity: ", identity);

        // create main queue
        const queue = this.createQueue();

        Reflect.set(globalThis, "mailQueue", queue);

        new CfnOutput(this.mainStack, "mail-queue-url", {
            value: queue.queueUrl,
            exportName: `${this.appConfig?.name}-mail-queue`,
        });

    }

    /* this should be a construct */
    private createQueue() {
        // create a queue to receive messages to send emails
        const queue = new Queue(this.mainStack, `${this.appConfig?.name}-mail-queue`, {
            queueName: `${this.appConfig?.mailQueueName}`,
            visibilityTimeout: Duration.seconds(30),
            receiveMessageWaitTime: Duration.seconds(10)
        });

        // create lambda function to process main queue
        const queueFunction = this.createLambdaFunction();

        // add event source to lambda function
        queueFunction.addEventSource(new SqsEventSource(queue, {
            batchSize: 1,
            maxBatchingWindow: Duration.seconds(5),
            reportBatchItemFailures: true
        }));

        return queue;

    }

    private createLambdaFunction() {
        // create lambda function to process the queue
        // fix the path
        const functionPath = join(__dirname, "../../../src/functions/mail-processor.ts");
        const lambda = new NodejsFunction(this.mainStack, `${this.appConfig?.name}-email-processor`, {
            entry: functionPath,
            handler: 'handler',
            runtime: Runtime.NODEJS_18_X,
            architecture: Architecture.ARM_64
        });

        // give lambda permission to send mail
        lambda.addToRolePolicy(
            new PolicyStatement({
                actions: ["ses:SendEmail", "SES:SendRawEmail"],
                resources: ["*"],
                effect: Effect.ALLOW,
            }),
        );

        return lambda
    }


}