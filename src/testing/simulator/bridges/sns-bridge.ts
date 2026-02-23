import { IBridge, ILambdaRunner } from '../interfaces';
import { createLogger } from '../../../logging';
import { SNSClient, SubscribeCommand, PublishCommand } from '@aws-sdk/client-sns';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

export interface SnsSubscription {
    id: string;
    topicArn: string;
    endpoint: string;
    protocol: 'lambda' | 'sqs' | 'email';
}

export class SnsBridge implements IBridge {
    readonly name = 'SNS';
    private readonly logger = createLogger(SnsBridge.name);
    private subscriptions: SnsSubscription[] = [];
    private lambdaConfigs: Map<string, any> = new Map();
    private snsClient: SNSClient;
    private sqsClient: SQSClient;
    private interval?: NodeJS.Timeout;

    constructor(private readonly lambdaRunner: ILambdaRunner) {
        this.snsClient = new SNSClient({
            endpoint: 'http://localhost:4566',
            region: 'us-east-1',
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
        });
        this.sqsClient = new SQSClient({
            endpoint: 'http://localhost:9324',
            region: 'us-east-1',
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
        });
    }

    setLambdaConfigs(configs: Map<string, any>) {
        this.lambdaConfigs = configs;
    }

    setSubscriptions(subs: SnsSubscription[]) {
        this.subscriptions = subs;
    }

    async start(): Promise<void> {
        this.logger.info("Starting SNS Bridge...");
        // Since we are mocking SNS, we could either poll local SNS or intercept calls.
        // For LocalStack-less, we'll implement a simple in-memory relay if needed,
        // but if we use a sidecar for SNS (LocalStack), we'd need to poll it or use its triggers.

        // However, user said "no LocalStack".
        // If I use a sidecar like softwaremill/elasticmq for SQS, it doesn't do SNS.
        // So for SNS I'll implement a small Express mock for Publish and Relay.
    }

    async stop(): Promise<void> {
        if (this.interval) clearInterval(this.interval);
    }

    // This would be called by SimulatorCoordinator when it detects a Publish action to its own mock SNS
    async relayPublish(topicArn: string, message: string, messageAttributes?: any) {
        this.logger.info(`Relaying SNS Publish for ${topicArn}`);
        const targets = this.subscriptions.filter(s => s.topicArn === topicArn);

        for (const target of targets) {
            if (target.protocol === 'lambda') {
                const lambdaId = target.endpoint.split(':').pop()!;
                const config = this.lambdaConfigs.get(lambdaId);
                if (config) {
                    await this.lambdaRunner.runHandler(
                        config.entry,
                        config.handlerClassName,
                        {
                            Records: [{
                                EventSource: 'aws:sns',
                                Sns: {
                                    TopicArn: topicArn,
                                    Message: message,
                                    MessageAttributes: messageAttributes
                                }
                            }]
                        },
                        {},
                        config.environment
                    );
                }
            } else if (target.protocol === 'sqs') {
                const queueName = target.endpoint.split(':').pop()!;
                await this.sqsClient.send(new SendMessageCommand({
                    QueueUrl: `http://localhost:9324/queue/${queueName}`,
                    MessageBody: JSON.stringify({
                        Type: 'Notification',
                        TopicArn: topicArn,
                        Message: message,
                        MessageAttributes: messageAttributes
                    })
                }));
            }
        }
    }
}
