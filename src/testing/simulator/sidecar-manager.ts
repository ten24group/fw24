import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { createLogger } from '../../logging';
import { SimulatedResource } from './cdk-parser';
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { SQSClient, CreateQueueCommand } from '@aws-sdk/client-sqs';
import { Fw24 } from '../../core/fw24';

export class SidecarManager {
    private readonly logger = createLogger(SidecarManager.name);
    private containers: string[] = [];
    private readonly prefix: string;

    constructor() {
        const appName = Fw24.getInstance().appName || 'fw24';
        this.prefix = appName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    }

    async initResources(resources: SimulatedResource[]) {
        // Wait a bit for sidecars to be ready
        await new Promise(resolve => setTimeout(resolve, 2000));

        for (const resource of resources) {
            try {
                if (resource.type === 'AWS::DynamoDB::Table') {
                    await this.setupDynamoDBTable(resource.properties);
                } else if (resource.type === 'AWS::S3::Bucket') {
                    await this.setupS3Bucket(resource.properties);
                } else if (resource.type === 'AWS::SQS::Queue') {
                    await this.setupSQSQueue(resource.properties);
                }
            } catch (e) {
                this.logger.error(`Failed to initialize resource ${resource.id}:`, e);
            }
        }
    }

    private async setupSQSQueue(props: any) {
        const queueName = props.QueueName;
        if (!queueName) return;

        this.logger.info(`Setting up local SQS queue: ${queueName}`);
        const client = new SQSClient({
            endpoint: 'http://localhost:9324',
            region: 'us-east-1',
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
        });

        try {
            await client.send(new CreateQueueCommand({
                QueueName: queueName,
                Attributes: props.FifoQueue ? { FifoQueue: 'true', ContentBasedDeduplication: 'true' } : {}
            }));
        } catch (error: any) {
            if (error.name !== 'QueueAlreadyExists') {
                this.logger.error(`Failed to create queue ${queueName}:`, error);
            }
        }
    }

    private async setupS3Bucket(props: any) {
        const bucketName = props.BucketName;
        this.logger.info(`Setting up local S3 bucket: ${bucketName || 'unknown'}`);

        const client = new S3Client({
            endpoint: 'http://localhost:9000',
            region: 'us-east-1',
            credentials: { accessKeyId: 'local', secretAccessKey: 'localpassword' },
            forcePathStyle: true
        });

        try {
            await client.send(new CreateBucketCommand({
                Bucket: bucketName
            }));
        } catch (error: any) {
            if (error.name !== 'BucketAlreadyOwnedByYou' && error.name !== 'BucketAlreadyExists') {
                this.logger.error(`Failed to create bucket ${bucketName}:`, error);
            }
        }
    }

    private async setupDynamoDBTable(props: any) {
        this.logger.info(`Setting up local DynamoDB table: ${props.TableName || 'unknown'}`);
        const client = new DynamoDBClient({
            endpoint: 'http://localhost:8000',
            region: 'us-east-1',
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
        });

        try {
            // Map CloudFormation properties to SDK properties
            const command = new CreateTableCommand({
                TableName: props.TableName,
                KeySchema: props.KeySchema,
                AttributeDefinitions: props.AttributeDefinitions,
                BillingMode: props.BillingMode || 'PAY_PER_REQUEST',
                GlobalSecondaryIndexes: props.GlobalSecondaryIndexes,
            });
            await client.send(command);
        } catch (error: any) {
            if (error.name === 'ResourceInUseException') {
                this.logger.debug(`Table ${props.TableName} already exists.`);
            } else {
                this.logger.error(`Failed to create table ${props.TableName}:`, error);
            }
        }
    }

    async startDynamoDB(port: number = 8000) {
        this.logger.info(`Starting DynamoDB sidecar on port ${port}...`);
        await this.runContainer(`${this.prefix}-dynamodb`, `amazon/dynamodb-local`, port, 8000);
    }

    async startSQS(port: number = 9324) {
        this.logger.info(`Starting SQS sidecar on port ${port}...`);
        await this.runContainer(`${this.prefix}-sqs`, `softwaremill/elasticmq-native`, port, 9324);
    }

    async startS3(port: number = 9000) {
        this.logger.info(`Starting S3 sidecar on port ${port}...`);
        await this.runContainer(`${this.prefix}-s3`, `minio/minio`, port, 9000, [
            '-e', 'MINIO_ROOT_USER=local',
            '-e', 'MINIO_ROOT_PASSWORD=localpassword',
            'server', '/data', '--console-address', ':9001'
        ]);
    }

    async startMeiliSearch(port: number = 7700, masterKey: string = 'masterKey') {
        this.logger.info(`Starting MeiliSearch sidecar on port ${port}...`);
        await this.runContainer(`${this.prefix}-meilisearch`, `getmeili/meilisearch`, port, 7700, [
            `-e`, `MEILI_MASTER_KEY=${masterKey}`
        ]);
    }

    async startCognito(port: number = 9229) {
        this.logger.info(`Starting Cognito sidecar on port ${port}...`);
        await this.runContainer(`${this.prefix}-cognito`, `jagregory/cognito-local`, port, 9229);
    }

    async startSNS(port: number = 9911) {
        this.logger.info(`Starting SNS sidecar on port ${port}...`);
        await this.runContainer(`${this.prefix}-sns`, `s12v/sns-sqs-emulator`, port, 9911);
    }

    private async isDockerAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const process = spawn('docker', ['info'], { stdio: 'ignore' });
            process.on('close', (code) => resolve(code === 0));
            process.on('error', () => resolve(false));
        });
    }

    private async runContainer(name: string, image: string, hostPort: number, containerPort: number, extraArgs: string[] = []) {
        if (!(await this.isDockerAvailable())) {
            this.logger.error(`Docker is not available. Cannot start sidecar: ${name}`);
            throw new Error(`Docker is not available. Please make sure Docker Desktop or Docker Engine is running.`);
        }

        // Stop and remove if exists
        try {
            const result = spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
        } catch (e) {}

        const args = [
            'run', '-d',
            '--name', name,
            '-p', `${hostPort}:${containerPort}`,
            ...extraArgs,
            image
        ];

        this.logger.debug(`Running docker command: docker ${args.join(' ')}`);

        return new Promise((resolve, reject) => {
            const process = spawn('docker', args);
            let stderr = '';
            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', async (code) => {
                if (code === 0) {
                    this.containers.push(name);
                    // Wait for the service to be healthy
                    await this.waitForHealthy(hostPort, name);
                    resolve(true);
                } else {
                    this.logger.error(`Docker Run Error (${name}): ${stderr}`);
                    reject(new Error(`Failed to start container ${name}. Error: ${stderr}`));
                }
            });
        });
    }

    private async waitForHealthy(port: number, name: string, retries = 30) {
        const net = require('node:net');
        for (let i = 0; i < retries; i++) {
            try {
                await new Promise((resolve, reject) => {
                    const socket = net.createConnection(port, 'localhost');
                    socket.on('connect', () => {
                        socket.end();
                        resolve(true);
                    });
                    socket.on('error', reject);
                    socket.setTimeout(1000);
                });
                this.logger.debug(`Sidecar ${name} is healthy on port ${port}`);
                return;
            } catch (e) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        this.logger.warn(`Sidecar ${name} did not become healthy within ${retries} seconds`);
    }

    async stopAll() {
        for (const name of this.containers) {
            this.logger.info(`Stopping container ${name}...`);
            spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
        }
        this.containers = [];
    }
}
