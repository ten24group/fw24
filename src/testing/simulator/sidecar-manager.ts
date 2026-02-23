import { spawn, ChildProcess } from 'node:child_process';
import { createLogger } from '../../logging';
import { SimulatedResource } from './cdk-parser';
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb';

export class SidecarManager {
    private readonly logger = createLogger(SidecarManager.name);
    private containers: string[] = [];

    async initResources(resources: SimulatedResource[]) {
        for (const resource of resources) {
            if (resource.type === 'AWS::DynamoDB::Table') {
                await this.setupDynamoDBTable(resource.properties);
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
        await this.runContainer('dynamodb-local', `amazon/dynamodb-local`, port, 8000);
    }

    async startSQS(port: number = 9324) {
        this.logger.info(`Starting SQS sidecar on port ${port}...`);
        await this.runContainer('sqs-local', `softwaremill/elasticmq-native`, port, 9324);
    }

    async startMeiliSearch(port: number = 7700, masterKey: string = 'masterKey') {
        this.logger.info(`Starting MeiliSearch sidecar on port ${port}...`);
        await this.runContainer('meilisearch-local', `getmeili/meilisearch`, port, 7700, [
            `-e`, `MEILI_MASTER_KEY=${masterKey}`
        ]);
    }

    private async runContainer(name: string, image: string, hostPort: number, containerPort: number, extraArgs: string[] = []) {
        // Stop and remove if exists
        try {
            spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
        } catch (e) {}

        const args = [
            'run', '-d',
            '--name', name,
            '-p', `${hostPort}:${containerPort}`,
            ...extraArgs,
            image
        ];

        return new Promise((resolve, reject) => {
            const process = spawn('docker', args);
            process.on('close', (code) => {
                if (code === 0) {
                    this.containers.push(name);
                    resolve(true);
                } else {
                    reject(new Error(`Failed to start container ${name}. Make sure Docker is running.`));
                }
            });
        });
    }

    async stopAll() {
        for (const name of this.containers) {
            this.logger.info(`Stopping container ${name}...`);
            spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
        }
        this.containers = [];
    }
}
