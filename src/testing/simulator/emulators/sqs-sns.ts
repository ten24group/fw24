import express from 'express';
import { Server } from 'node:http';
import { IEmulator } from '../interfaces';
import { createLogger } from '../../../logging';
import { v4 as uuid } from 'uuid';

export class SqsSnsEmulator implements IEmulator {
    readonly name = 'SQS/SNS';
    private readonly logger = createLogger(SqsSnsEmulator.name);
    private server?: Server;
    private readonly port: number;

    // In-memory storage for simplicity in this MVP
    private queues: Map<string, any[]> = new Map();
    private topics: Map<string, any[]> = new Map();
    private subscriptions: Map<string, any[]> = new Map();

    constructor(options: { port?: number } = {}) {
        this.port = options.port || 4566; // LocalStack default port
    }

    async start(): Promise<void> {
        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        // Simple mock for SQS/SNS AWS Query API
        app.all('/', (req: express.Request, res: express.Response) => {
            const action = (req.body.Action || req.query.Action) as string;
            this.logger.debug(`Received SQS/SNS Action: ${action}`, req.body);

            switch (action) {
                // SQS Actions
                case 'CreateQueue':
                    const queueName = req.body.QueueName;
                    const queueUrl = `http://localhost:${this.port}/queues/${queueName}`;
                    this.queues.set(queueName, []);
                    res.send(`<CreateQueueResponse><CreateQueueResult><QueueUrl>${queueUrl}</QueueUrl></CreateQueueResult></CreateQueueResponse>`);
                    break;

                case 'SendMessage':
                    const qName = req.body.QueueUrl?.split('/').pop();
                    const msg = req.body.MessageBody;
                    if (this.queues.has(qName)) {
                        this.queues.get(qName)!.push({ body: msg, id: uuid() });
                    }
                    res.send(`<SendMessageResponse><SendMessageResult><MessageId>${uuid()}</MessageId></SendMessageResult></SendMessageResponse>`);
                    break;

                // SNS Actions
                case 'CreateTopic':
                    const topicName = req.body.Name;
                    const topicArn = `arn:aws:sns:us-east-1:123456789012:${topicName}`;
                    this.topics.set(topicArn, []);
                    res.send(`<CreateTopicResponse><CreateTopicResult><TopicArn>${topicArn}</TopicArn></CreateTopicResult></CreateTopicResponse>`);
                    break;

                case 'Publish':
                    const tArn = req.body.TopicArn;
                    const message = req.body.Message;
                    this.logger.info(`SNS Publish to ${tArn}: ${message}`);
                    res.send(`<PublishResponse><PublishResult><MessageId>${uuid()}</MessageId></PublishResult></PublishResponse>`);
                    break;

                default:
                    this.logger.warn(`Unhandled Action: ${action}`);
                    res.status(200).send(`<ErrorResponse><Error><Code>UnknownAction</Code><Message>The action ${action} is not supported.</Message></Error></ErrorResponse>`);
                    break;
            }
        });

        return new Promise((resolve) => {
            this.server = app.listen(this.port, () => {
                this.logger.info(`SQS/SNS Emulator listening on port ${this.port}`);
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        return new Promise((resolve) => {
            this.server?.close(() => resolve());
        });
    }

    getEndpoint(): string {
        return `http://localhost:${this.port}`;
    }

    getMessages(queueName: string): any[] | undefined {
        return this.queues.get(queueName);
    }
}
