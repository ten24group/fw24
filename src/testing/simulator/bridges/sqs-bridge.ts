import { IBridge, ILambdaRunner } from '../interfaces';
import { createLogger } from '../../../logging';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

export interface SqsSubscription {
    queueName: string;
    handlerId: string;
}

export class SqsBridge implements IBridge {
    readonly name = 'SQS';
    private readonly logger = createLogger(SqsBridge.name);
    private interval?: NodeJS.Timeout;
    private subscriptions: SqsSubscription[] = [];
    private lambdaConfigs: Map<string, any> = new Map();

    private client: SQSClient;

    constructor(
        private readonly lambdaRunner: ILambdaRunner,
        sqsEndpoint: string = 'http://localhost:9324'
    ) {
        this.client = new SQSClient({
            endpoint: sqsEndpoint,
            region: 'us-east-1',
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
        });
    }

    setLambdaConfigs(configs: Map<string, any>) {
        this.lambdaConfigs = configs;
    }

    setSubscriptions(subs: SqsSubscription[]) {
        this.subscriptions = subs;
    }

    async start(): Promise<void> {
        this.logger.info("Starting SQS Bridge...");

        this.interval = setInterval(async () => {
            for (const sub of this.subscriptions) {
                try {
                    const queueUrl = `http://localhost:9324/queue/${sub.queueName}`;
                    const receive = await this.client.send(new ReceiveMessageCommand({
                        QueueUrl: queueUrl,
                        MaxNumberOfMessages: 5,
                        WaitTimeSeconds: 0
                    }));

                    if (receive.Messages && receive.Messages.length > 0) {
                        this.logger.info(`SQS Bridge: Received ${receive.Messages.length} messages for ${sub.queueName}`);

                        const lambdaConfig = this.lambdaConfigs.get(sub.handlerId);
                        if (!lambdaConfig) {
                            this.logger.error(`Lambda configuration not found for ID: ${sub.handlerId}`);
                            continue;
                        }

                        const event = {
                            Records: receive.Messages.map(m => ({
                                messageId: m.MessageId,
                                receiptHandle: m.ReceiptHandle,
                                body: m.Body,
                                attributes: m.Attributes,
                                messageAttributes: m.MessageAttributes,
                                eventSource: 'aws:sqs'
                            }))
                        };

                        await this.lambdaRunner.runHandler(
                            lambdaConfig.entry,
                            lambdaConfig.handlerClassName,
                            event,
                            {},
                            lambdaConfig.environment
                        );

                        // Delete messages after successful processing
                        for (const m of receive.Messages) {
                            await this.client.send(new DeleteMessageCommand({
                                QueueUrl: queueUrl,
                                ReceiptHandle: m.ReceiptHandle
                            }));
                        }
                    }
                } catch (error: any) {
                    if (error.name !== 'ConnectTimeoutError' && error.code !== 'ECONNREFUSED') {
                        this.logger.error(`Error in SQS Bridge for ${sub.queueName}:`, error);
                    }
                }
            }
        }, 1000);
    }

    async stop(): Promise<void> {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
}
