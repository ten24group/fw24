import { IBridge, ILambdaRunner } from '../interfaces';
import { createLogger } from '../../../logging';

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

    constructor(
        private readonly lambdaRunner: ILambdaRunner,
        private readonly sqsEmulator: any // We'll need to access the in-memory queues
    ) {}

    setLambdaConfigs(configs: Map<string, any>) {
        this.lambdaConfigs = configs;
    }

    setSubscriptions(subs: SqsSubscription[]) {
        this.subscriptions = subs;
    }

    async start(): Promise<void> {
        this.logger.info("Starting SQS Bridge...");

        // Simple polling mechanism for the in-memory SQS emulator
        this.interval = setInterval(async () => {
            for (const sub of this.subscriptions) {
                const messages = this.sqsEmulator.getMessages?.(sub.queueName);
                if (messages && messages.length > 0) {
                    this.logger.info(`SQS Bridge: Found ${messages.length} messages for ${sub.queueName}`);

                    // Take one message (or all) and process
                    const message = messages.shift();

                    try {
                        const lambdaConfig = this.lambdaConfigs.get(sub.handlerId);
                        if (!lambdaConfig) {
                            this.logger.error(`Lambda configuration not found for ID: ${sub.handlerId}`);
                            continue;
                        }

                        const event = {
                            Records: [
                                {
                                    messageId: message.id,
                                    body: message.body,
                                    eventSource: 'aws:sqs'
                                }
                            ]
                        };

                        await this.lambdaRunner.runHandler(
                            lambdaConfig.entry,
                            lambdaConfig.handlerClassName,
                            event,
                            {},
                            lambdaConfig.environment
                        );
                    } catch (error) {
                        this.logger.error(`Error processing SQS message for ${sub.queueName}:`, error);
                        // Put message back? (Simple mock doesn't handle retries well)
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
