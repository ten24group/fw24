import { TablePropsV2 } from "aws-cdk-lib/aws-dynamodb";
import { TopicProps } from "aws-cdk-lib/aws-sns";
import { DynamoEventSourceProps, SqsEventSourceProps } from "aws-cdk-lib/aws-lambda-event-sources";
import { LogGroupProps } from "aws-cdk-lib/aws-logs";
import { Stack } from "aws-cdk-lib";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import { IConstructConfig } from "../interfaces/construct-config";
import { AuditLoggerType } from "../audit/interfaces";
import { LambdaFunctionProps } from "./lambda-function";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
export type SearchEngineConfig = {
    type: 'meili';
    host: string;
    masterKey: string;
};
/**
 * Configuration for search indexing.
 */
export interface SearchIndexingConfig extends IConstructConfig {
    /**
     * Whether to enable search indexing.
     * @default false
     */
    enabled?: boolean;
    /**
     * List of allowed entity names to be indexed.
     * If not provided, all entities will be indexed except those in excludedEntityNames or system entities.
     * Takes precedence over excludedEntityNames if both are provided.
     */
    allowedEntityNames?: string[];
    /**
     * List of entity names to exclude from indexing.
     * If allowedEntityNames is provided, this field is ignored.
     * If neither allowedEntityNames nor excludedEntityNames is provided, defaults to excluding system entities like 'auditLog'.
     */
    excludedEntityNames?: string[];
    /**
     * Search engine configuration that defines which search provider to use and its connection details.
     *
     * Currently supports MeiliSearch with plans to extend to Elasticsearch and Algolia.
     *
     * @example
     * ```typescript
     * engineConfig: {
     *   type: 'meili',
     *   host: 'https://your-meilisearch-instance.com',
     *   masterKey: 'your-master-key'
     * }
     * ```
     */
    engineConfig: SearchEngineConfig;
    /**
     * Custom lambda function properties for search indexing processing.
     * When provided, completely replaces the default search indexer handler.
     * Custom handlers can extend base classes and reuse framework utilities.
     *
     * **Note:** Ignored when `existingQueueName` is provided (existing queues have their own handlers)
     */
    lambdaFunctionProps?: LambdaFunctionProps;
    /**
     * Custom queue name for creating a new search indexing queue.
     * If not provided, defaults to `${tableName}-search-indexer`
     *
     * **Note:** Cannot be used with `existingQueueName`
     */
    queueName?: string;
    /**
     * Name of an existing framework-managed queue to use for search indexing processing.
     *
     * **Important:** The existing queue must:
     * - Be defined with @Queue('QueueName') decorator in your src/queues directory
     * - Already be registered by the framework's QueueConstruct
     * - Be configured to subscribe to the stream topic in its @Queue subscriptions
     *
     * **Example:**
     * ```typescript
     * @Queue('MeilisearchSync', {
     *   subscriptions: {
     *     topics: [{ name: 'myTable-stream' }]
     *   }
     * })
     * export class MeilisearchSync extends BaseSearchIndexer { ... }
     * ```
     * Then use: `existingQueueName: 'MeilisearchSync'`
     *
     * **Note:** Cannot be used with `queueName` or `queueProps`
     */
    existingQueueName?: string;
    /**
     * Path to queue handler file for manual registration.
     * The queue handler must have `manualRegistration: true` in its @Queue config.
     * DynamoDB construct will create the queue and automatically subscribe it to the stream topic.
     *
     * **Example:**
     * ```typescript
     * // In src/queues/meilisearch-sync.ts:
     * @Queue('MeilisearchSync', {
     *   manualRegistration: true,
     *   resourceAccess: { tables: ['plusfan'] },
     *   // ... other queue config
     * })
     * export class MeilisearchSync extends BaseSearchIndexer { ... }
     *
     * // In index.ts:
     * searchIndexing: [{
     *   enabled: true,
     *   queueHandlerPath: './src/queues/meilisearch-sync.ts',
     *   engineConfig: { type: 'meili', host: '...', masterKey: '...' }
     * }]
     * ```
     *
     * **Note:** Cannot be used with `queueName`, `existingQueueName`, or `lambdaFunctionProps`
     */
    queueHandlerPath?: string;
    /**
     * Search indexing queue properties (only used when creating a new queue)
     *
     * **Note:** Ignored when `existingQueueName` or `queueHandlerPath` is provided
     */
    queueProps?: QueueProps;
    /**
     * SQS event source properties for search indexing
     */
    sqsEventSourceProps?: SqsEventSourceProps;
}
/**
 * Represents the configuration for a DynamoDB table.
 */
export interface IDynamoDBConfig extends IConstructConfig {
    table: {
        /**
         * The name of the DynamoDB table.
         */
        name: string;
        /**
         * The properties for the DynamoDB table.
         */
        props: TablePropsV2;
        /**
         * Stream processing configuration
         */
        stream?: {
            /**
             * Enable stream processing
             */
            enabled?: boolean;
            /**
             * SNS topic configuration for stream events
             */
            topic?: {
                /**
                 * Topic name. Defaults to {tableName}-stream
                 */
                name?: string;
                /**
                 * Topic properties
                 */
                props?: TopicProps;
            };
            /**
             * Stream processor Lambda configuration
             */
            processor?: DynamoEventSourceProps;
        };
        /**
         * Audit configuration for the DynamoDB table.
         */
        audit?: AuditConfig;
        /**
         * Search indexing configuration for the DynamoDB table.
         */
        searchIndexing?: SearchIndexingConfig[];
    };
}
/**
 * @param dynamoDBConfig The configuration object for DynamoDB.
 * @example
 * ```ts
 *
 * const dynamoDBConfig: IDynamoDBConfig = {
 *   table: {
 *     name: 'myTable',
 *     props: {
 *       partitionKey: { name: 'id', type: 'STRING' },
 *       sortKey: { name: 'timestamp', type: 'NUMBER' },
 *       billingMode: 'PAY_PER_REQUEST',
 *       removalPolicy: cdk.RemovalPolicy.DESTROY
 *     }
 *   }
 * };
 *
 * const dynamoDB = new DynamoDBConstruct(dynamoDBConfig);
 *
 * app.use(dynamoDB);
 *
 * ```
 *
 * Custom audit queue name:
 * ```ts
 * audit: {
 *   enabled: true,
 *   type: AuditLoggerType.CLOUDWATCH,
 *   dynamodbstreamOptions: {
 *     queueName: 'my-custom-audit-queue'
 *   }
 * }
 * ```
 *
 * Existing framework-managed audit queue:
 * ```ts
 * // First define the queue handler:
 * // @Queue('AuditProcessor', { subscriptions: { topics: [{ name: 'myTable-stream' }] } })
 * // export class AuditProcessor extends BaseAuditLogger { ... }
 *
 * audit: {
 *   enabled: true,
 *   type: AuditLoggerType.CLOUDWATCH,
 *   dynamodbstreamOptions: {
 *     existingQueueName: 'AuditProcessor'  // References the @Queue('AuditProcessor')
 *   }
 * }
 * ```
 *
 * Custom search indexing queue:
 * ```ts
 * searchIndexing: [{
 *   enabled: true,
 *   engineConfig: {
 *     type: 'meili',
 *     host: 'https://meilisearch.example.com',
 *     masterKey: 'master-key'
 *   },
 *   queueName: 'my-custom-search-queue'
 * }]
 * ```
 *
 * Existing framework-managed search indexing queue:
 * ```ts
 * // First define the queue handler:
 * // @Queue('MeilisearchSync', { subscriptions: { topics: [{ name: 'myTable-stream' }] } })
 * // export class MeilisearchSync extends BaseSearchIndexer { ... }
 *
 * searchIndexing: [{
 *   enabled: true,
 *   engineConfig: {
 *     type: 'meili',
 *     host: 'https://meilisearch.example.com',
 *     masterKey: 'master-key'
 *   },
 *   existingQueueName: 'MeilisearchSync'  // References the @Queue('MeilisearchSync')
 * }]
 * ```
 */
/**
 * Configuration for audit logging.
 */
export interface AuditConfig extends IConstructConfig {
    /**
     * Whether to enable audit logging.
     * @default false
     */
    enabled?: boolean;
    /**
     * List of allowed entity names to be audited.
     * If not provided, all entities will be audited except those in excludedEntityNames or system entities.
     * Takes precedence over excludedEntityNames if both are provided.
     */
    allowedEntityNames?: string[];
    /**
     * List of entity names to exclude from auditing.
     * If allowedEntityNames is provided, this field is ignored.
     * If neither allowedEntityNames nor excludedEntityNames is provided, defaults to excluding system entities like 'auditLog'.
     */
    excludedEntityNames?: string[];
    /**
     * The type of audit logger to use.
     * @default 'console'
     */
    type?: AuditLoggerType;
    /**
     * Custom lambda function properties for audit processing.
     * When provided, completely replaces the default audit handler.
     * Custom handlers can extend base classes and reuse framework utilities.
     *
     * **Note:** Ignored when `existingQueueName` is provided (existing queues have their own handlers)
     */
    lambdaFunctionProps?: LambdaFunctionProps;
    /**
     * Options for the audit logger.
     */
    cloudwatchOptions?: {
        /**
         * CloudWatch specific options
         */
        logGroupName?: string;
        /**
         * AWS region for the service (CloudWatch or DynamoDB)
         */
        region?: string;
        /**
         * Log Group Options
         */
        logGroupOptions?: LogGroupProps;
    };
    dynamodbstreamOptions?: {
        /**
         * Table to use for audit logs, defaults to the same table as the one being audited
         */
        auditTableName?: string;
        /**
         * TTL in seconds for DynamoDB records
         */
        ttl?: number;
        /**
         * Custom queue name for creating a new audit queue.
         * If not provided, defaults to `${tableName}-entity-audit`
         *
         * **Note:** Cannot be used with `existingQueueName`
         */
        queueName?: string;
        /**
         * Name of an existing framework-managed queue to use for audit processing.
         *
         * **Important:** The existing queue must:
         * - Be defined with @Queue('QueueName') decorator in your src/queues directory
         * - Already be registered by the framework's QueueConstruct
         * - Be configured to subscribe to the stream topic in its @Queue subscriptions
         *
         * **Example:**
         * ```typescript
         * @Queue('AuditProcessor', {
         *   subscriptions: {
         *     topics: [{ name: 'myTable-stream' }]
         *   }
         * })
         * export class AuditProcessor extends BaseAuditLogger { ... }
         * ```
         * Then use: `existingQueueName: 'AuditProcessor'`
         *
         * **Note:** Cannot be used with `queueName` or `queueProps`
         */
        existingQueueName?: string;
        /**
         * Audit queue properties (only used when creating a new queue)
         *
         * **Note:** Ignored when `existingQueueName` is provided
         */
        queueProps?: QueueProps;
        /**
         * SQS event source properties
         */
        sqsEventSourceProps?: SqsEventSourceProps;
    };
}
export declare class DynamoDBConstruct implements FW24Construct {
    private dynamoDBConfig;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    /**
     * Constructs a new instance of the DynamoDB class.
     * @param dynamoDBConfig The configuration object for DynamoDB.
     * @example
     * const dynamoDBConfig = {
     *   region: 'us-west-2',
     *   tableName: 'myTable'
     * };
     * const dynamoDB = new DynamoDB(dynamoDBConfig);
     */
    constructor(dynamoDBConfig: IDynamoDBConfig);
    construct(): Promise<void>;
    private getStreamTopicName;
    private setupStreamProcessing;
    private setupStreamEventConsumers;
    private validateQueueConfig;
    private extractQueueConfig;
    private buildCommonLambdaConfig;
    private setupWithExistingQueue;
    private setupWithQueueHandler;
    private setupWithNewQueue;
    private buildSqsEventSourceProps;
    private setupAuditProcessing;
    private setupSearchIndexingProcessing;
}
