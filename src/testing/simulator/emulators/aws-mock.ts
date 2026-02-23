import express from 'express';
import { Server } from 'node:http';
import { IEmulator } from '../interfaces';
import { createLogger } from '../../../logging';
import { v4 as uuid } from 'uuid';
import { SnsBridge } from '../bridges/sns-bridge';

export class AwsMockEmulator implements IEmulator {
    readonly name = 'AWS Mock (SNS/SES)';
    private readonly logger = createLogger(AwsMockEmulator.name);
    private server?: Server;
    private readonly port: number;

    constructor(private readonly snsBridge: SnsBridge, options: { port?: number } = {}) {
        this.port = options.port || 4566;
    }

    async start(): Promise<void> {
        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        app.all('/', async (req, res) => {
            const action = (req.body.Action || req.query.Action) as string;
            this.logger.info(`AWS Mock Action: ${action}`);

            switch (action) {
                case 'Publish':
                    const topicArn = req.body.TopicArn;
                    const message = req.body.Message;
                    await this.snsBridge.relayPublish(topicArn, message);
                    return res.send(`<PublishResponse><PublishResult><MessageId>${uuid()}</MessageId></PublishResult></PublishResponse>`);

                case 'SendEmail':
                case 'SendRawEmail':
                    this.logger.info(`SES Mock: Email sent! To: ${req.body['Destination.ToAddresses.member.1'] || 'unknown'}`);
                    return res.send(`<SendEmailResponse><SendEmailResult><MessageId>${uuid()}</MessageId></SendEmailResult></SendEmailResponse>`);

                default:
                    res.status(200).send(`<ErrorResponse><Error><Code>UnknownAction</Code><Message>Action ${action} mocked</Message></Error></ErrorResponse>`);
            }
        });

        return new Promise((resolve) => {
            this.server = app.listen(this.port, () => {
                this.logger.info(`AWS Mock Emulator listening on port ${this.port}`);
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
}
