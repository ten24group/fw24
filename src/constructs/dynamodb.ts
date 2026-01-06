import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { TablePropsV2, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import { DynamoEventSource, DynamoEventSourceProps, SqsEventSourceProps } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import { TopicProps } from "aws-cdk-lib/aws-sns";
import { Queue, QueueProps } from "aws-cdk-lib/aws-sqs";
import { join, resolve } from "node:path";

import { AUDIT_ENV_KEYS } from "../audit/interfaces";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { IConstructConfig } from "../interfaces/construct-config";
import { createLogger, LogDuration } from "../logging";
import { SEARCH_INDEXER_ENV_KEYS } from "../search/indexer/interfaces";
import { merge, removeEmpty } from "../utils";
import type { IFunctionResourceAccess } from "./lambda-function";

type QueueConstructor = new (...args: unknown[]) => { queueName: string; queueConfig: Record<string, any> };
import { ensureNoSpecialChars, ensureSuffix } from "../utils/keys";
import { LambdaFunction, LambdaFunctionProps } from "./lambda-function";
import { QueueLambda } from "./queue-lambda";
import { ITopicConstructConfig, TopicConstruct } from "./topic";
import { LayerConstruct } from "./layer";

interface NewQueueConfig {
    type: 'new';
    functionProps?: NodejsFunctionProps;
    queueProps?: QueueProps;
    sqsEventSourceProps?: SqsEventSourceProps;
    customQueueName?: string;
}

interface ExistingQueueConfig {
    type: 'existing';
    existingQueueName: string;
}

interface HandlerQueueConfig {
    type: 'handler';
    queueHandlerPath: string;
    functionProps?: NodejsFunctionProps;
    sqsEventSourceProps?: SqsEventSourceProps;
}

type QueueConfig = NewQueueConfig | ExistingQueueConfig | HandlerQueueConfig;

export type SearchEngineConfig = {
    type: 'meili',
    host: string,
    masterKey: string
}
// uncomment when implemented
// } | {
//     type: 'elasticsearch', // not implemented yet
//     host: string,
//     apiKey: string
// } | {
//     type: 'algolia', // not implemented yet
//     appId: string,
//     apiKey: string
// }

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
     * Custom function properties for the search indexing Lambda.
     * Allows overriding function configuration like VPC, memory, timeout, etc.
     * 
     * **Note:** 
     * - Properties specified here will override the queue's @Queue decorator functionProps
     * - Ignored when `existingQueueName` is provided (existing queues have their own handlers)
     */
    functionProps?: NodejsFunctionProps;
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
 * Audit logging (via observability system):
 * ```ts
 * audit: {
 *   enabled: true,
 *   allowedEntityNames: ['user', 'order', 'payment'],
 *   // Backend routing configured via observability DI layer
 * }
 * ```
 * 
 * Custom audit queue:
 * ```ts
 * audit: {
 *   enabled: true,
 *   allowedEntityNames: ['user', 'order'],
 *   queueName: 'my-custom-audit-queue'
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
 * Configuration for audit logging via DynamoDB streams.
 * 
 * Audit events are captured by the observability system - this config only controls:
 * - Which entities to audit (entity filtering)
 * - Stream processing queue configuration
 * 
 * Backend routing (DynamoDB, CloudWatch, OTEL) is configured via observability:
 * ```typescript
 * // In your DI layer:
 * import { createObservabilityConfig } from '@ten24group/fw24/observability';
 * 
 * DIContainer.ROOT.registerConfigProvider({
 *   provide: 'observability',
 *   useConfig: createObservabilityConfig({
 *     backends: [
 *       { type: 'dynamodb'},
 *       { type: 'cloudwatch'}
 *     ]
 *   }),
 *   priority: 10
 * });
 * ```
 */
interface AuditConfig extends IConstructConfig {
    /**
     * Whether to enable audit logging for DynamoDB streams.
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
     * If neither allowedEntityNames nor excludedEntityNames is provided, 
     * defaults to excluding system entities like 'auditLog' and 'observabilityLog'.
     */
    excludedEntityNames?: string[];

    /**
     * Custom function properties for the audit Lambda.
     * Allows overriding function configuration like VPC, memory, timeout, etc.
     */
    functionProps?: NodejsFunctionProps;

    /**
     * Custom queue name for creating a new audit queue.
     * If not provided, defaults to `${tableName}-entity-audit`
     */
    queueName?: string;

    /**
     * Name of an existing framework-managed queue to use for audit processing.
     * The existing queue must be defined with @Queue decorator and subscribe to the stream topic.
     */
    existingQueueName?: string;

    /**
     * Path to queue handler file for manual registration.
     * The queue handler must have `manualRegistration: true` in its @Queue config.
     */
    queueHandlerPath?: string;

    /**
     * Audit queue properties (only used when creating a new queue)
     */
    queueProps?: QueueProps;

    /**
     * SQS event source properties
     */
    sqsEventSourceProps?: SqsEventSourceProps;
}

export class DynamoDBConstruct implements FW24Construct {
    readonly logger = createLogger(DynamoDBConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();

    name: string = DynamoDBConstruct.name;
    dependencies: string[] = [ LayerConstruct.name ];  // Wait for layers so entry packages are registered
    output!: FW24ConstructOutput;

    mainStack!: Stack;

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
    constructor(private readonly dynamoDBConfig: IDynamoDBConfig) { }

    // construct method to create the stack
    @LogDuration()
    public async construct() {
        const fw24 = Fw24.getInstance();
        this.mainStack = fw24.getStack(this.dynamoDBConfig.stackName, this.dynamoDBConfig.parentStackName);
        const appQualifiedTableName = ensureNoSpecialChars(ensureSuffix(this.dynamoDBConfig.table.name, `table`));

        this.logger.debug("appQualifiedTableName:", appQualifiedTableName);

        // See https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb-readme.html
        const tableInstance = new TableV2(this.mainStack, appQualifiedTableName, this.dynamoDBConfig.table.props);

        // Output the table instance
        this.fw24.setConstructOutput(this, appQualifiedTableName, tableInstance, OutputType.TABLE, 'tableName');
        this.fw24.setEnvironmentVariable(appQualifiedTableName, tableInstance.tableName, 'table');

        // Register the table instance as a global container
        fw24.addDynamoTable(appQualifiedTableName, tableInstance);

        const hasAuditEnabled = this.dynamoDBConfig.table.audit?.enabled;
        const hasSearchIndexingEnabled = this.dynamoDBConfig.table.searchIndexing?.some(config => config.enabled);
        const hasStreamEnabled = this.dynamoDBConfig.table.stream?.enabled;

        // Track configured features for summary
        const features: string[] = [];

        // Setup stream processing if enabled or audit is enabled or search indexing is enabled and stream ARN exists
        if (hasStreamEnabled || hasAuditEnabled || hasSearchIndexingEnabled) {
            if (tableInstance.tableStreamArn) {
                this.setupStreamProcessing(tableInstance);
                if (hasStreamEnabled) features.push('stream');
            } else {
                this.logger.warn(`Stream ARN not found for table ${this.dynamoDBConfig.table.name}, cannot set up stream processing`);
            }
        }

        if (this.dynamoDBConfig.table.audit?.enabled) {
            await this.setupAuditProcessing(this.dynamoDBConfig.table.audit, tableInstance);
            features.push('audit');
        }

        if (hasSearchIndexingEnabled) {
            for (const config of this.dynamoDBConfig.table.searchIndexing || []) {
                await this.setupSearchIndexingProcessing(config, tableInstance);
            }
            features.push('search-indexing');
        }

        // Summary
        if (features.length > 0) {
            this.logger.info(`✅ Table "${this.dynamoDBConfig.table.name}" configured with ${features.length} feature(s): ${features.join(', ')}`);
        } else {
            this.logger.info(`✅ Table "${this.dynamoDBConfig.table.name}" configured (basic setup)`);
        }
    }

    private getStreamTopicName(): string {
        return `${this.dynamoDBConfig.table.name}-stream`;
    }

    private setupStreamProcessing(tableInstance: TableV2): void {
        const streamConfig = this.dynamoDBConfig.table.stream || {};

        // Create SNS topic for stream events
        const topicName = streamConfig.topic?.name || this.getStreamTopicName();

        const isFifo = streamConfig.topic?.props?.fifo ?? false;
        const streamTopicConfig: ITopicConstructConfig[] = [ {
            topicName,
            topicProps: {
                displayName: `Stream events for ${this.dynamoDBConfig.table.name}`,
                fifo: isFifo,
                ...streamConfig.topic?.props
            }
        } ];

        new TopicConstruct(streamTopicConfig).construct();

        // Create Lambda to process stream and publish to SNS
        // Include table name to make construct name unique when multiple tables have streams
        const streamProcessor = new LambdaFunction(this.mainStack, `${this.dynamoDBConfig.table.name}-stream-processor`, {
            entry: join(__dirname, '../core/runtime/dynamodb-stream-processor.js'),
            environmentVariables: {
                TOPIC_NAME: topicName,
                TOPIC_TYPE: isFifo ? 'fifo' : 'standard'
            },
            resourceAccess: {
                topics: [ {
                    name: topicName,
                    access: [ 'publish' ]
                } ]
            }
        }) as NodejsFunction;

        // Grant permissions and add event source
        tableInstance.grantStreamRead(streamProcessor);
        streamProcessor.addEventSource(new DynamoEventSource(tableInstance, {
            ...streamConfig.processor,
            startingPosition: streamConfig.processor?.startingPosition ?? StartingPosition.LATEST,
            batchSize: streamConfig.processor?.batchSize ?? 5,
            bisectBatchOnError: streamConfig.processor?.bisectBatchOnError ?? true,
            retryAttempts: streamConfig.processor?.retryAttempts ?? 3
        }));

        this.logger.debug('Stream processing setup completed for table:', this.dynamoDBConfig.table.name);
    }

    private async setupStreamEventConsumers(
        tableInstance: TableV2,
        consumerName: string,
        config: AuditConfig | SearchIndexingConfig,
        defaultHandlerEntry: string,
        environmentVariables: Record<string, string>,
        resourceAccess?: IFunctionResourceAccess,
    ): Promise<void> {
        if (!tableInstance.tableStreamArn) {
            this.logger.warn(`Stream ARN not found for table ${this.dynamoDBConfig.table.name}, cannot set up ${consumerName}`);
            return;
        }

        const queueConfig = this.extractQueueConfig(config);

        // Validate configuration
        this.validateQueueConfig(config, consumerName);

        if (queueConfig.type === 'handler') {
            await this.setupWithQueueHandler(queueConfig.queueHandlerPath, consumerName, environmentVariables, queueConfig.functionProps, queueConfig.sqsEventSourceProps);
        } else if (queueConfig.type === 'existing') {
            this.setupWithExistingQueue(queueConfig.existingQueueName, consumerName);
        } else {
            const commonConfig = this.buildCommonLambdaConfig(defaultHandlerEntry, environmentVariables, resourceAccess ?? {}, queueConfig.functionProps);
            this.setupWithNewQueue(queueConfig, consumerName, commonConfig);
        }

        this.logger.debug(`${consumerName} setup completed for table:`, this.dynamoDBConfig.table.name);
    }

    private validateQueueConfig(config: AuditConfig | SearchIndexingConfig, consumerName: string): void {
        const isSearchConfig = 'engineConfig' in config;

        if (isSearchConfig) {
            const searchConfig = config;
            if (searchConfig.existingQueueName) {
                if (searchConfig.queueName) {
                    this.logger.warn(`${consumerName}: Both 'existingQueueName' and 'queueName' provided. Using existing queue '${searchConfig.existingQueueName}', ignoring queueName.`);
                }
                if (searchConfig.queueProps) {
                    this.logger.warn(`${consumerName}: 'queueProps' provided with 'existingQueueName'. Queue properties are ignored when using existing queues.`);
                }
                if (searchConfig.functionProps) {
                    this.logger.warn(`${consumerName}: 'functionProps' provided with 'existingQueueName'. Function properties are ignored when using existing queues (they have their own handlers).`);
                }
            }
        } else {
            const auditConfig = config;
            if (auditConfig.existingQueueName) {
                if (auditConfig.queueName) {
                    this.logger.warn(`${consumerName}: Both 'existingQueueName' and 'queueName' provided. Using existing queue '${auditConfig.existingQueueName}', ignoring queueName.`);
                }
                if (auditConfig.queueProps) {
                    this.logger.warn(`${consumerName}: 'queueProps' provided with 'existingQueueName'. Queue properties are ignored when using existing queues.`);
                }
                if (auditConfig.functionProps) {
                    this.logger.warn(`${consumerName}: 'functionProps' provided with 'existingQueueName'. Function properties are ignored when using existing queues (they have their own handlers).`);
                }
            }
        }
    }

    private extractQueueConfig(config: AuditConfig | SearchIndexingConfig): QueueConfig {
        // SearchIndexingConfig is distinguished by having engineConfig (required field)
        const isSearchConfig = 'engineConfig' in config;

        if (isSearchConfig) {
            const searchConfig = config;

            if ('queueHandlerPath' in searchConfig && searchConfig.queueHandlerPath) {
                return {
                    type: 'handler',
                    queueHandlerPath: searchConfig.queueHandlerPath,
                    functionProps: searchConfig.functionProps,
                    sqsEventSourceProps: searchConfig.sqsEventSourceProps,
                };
            } else if ('existingQueueName' in searchConfig && searchConfig.existingQueueName) {
                return {
                    type: 'existing',
                    existingQueueName: searchConfig.existingQueueName,
                };
            } else {
                return {
                    type: 'new',
                    functionProps: searchConfig.functionProps,
                    queueProps: searchConfig.queueProps,
                    sqsEventSourceProps: searchConfig.sqsEventSourceProps,
                    customQueueName: searchConfig.queueName,
                };
            }
        } else {
            // AuditConfig
            const auditConfig = config;

            if (auditConfig.queueHandlerPath) {
                return {
                    type: 'handler',
                    queueHandlerPath: auditConfig.queueHandlerPath,
                    functionProps: auditConfig.functionProps,
                    sqsEventSourceProps: auditConfig.sqsEventSourceProps,
                };
            } else if (auditConfig.existingQueueName) {
                return {
                    type: 'existing',
                    existingQueueName: auditConfig.existingQueueName,
                };
            } else {
                return {
                    type: 'new',
                    functionProps: auditConfig.functionProps,
                    queueProps: auditConfig.queueProps,
                    sqsEventSourceProps: auditConfig.sqsEventSourceProps,
                    customQueueName: auditConfig.queueName,
                };
            }
        }
    }

    private buildCommonLambdaConfig(
        defaultHandlerEntry: string,
        environmentVariables: Record<string, string>,
        resourceAccess: IFunctionResourceAccess,
        functionProps?: NodejsFunctionProps
    ): LambdaFunctionProps {
        return {
            entry: defaultHandlerEntry,
            environmentVariables,
            resourceAccess: resourceAccess ?? {},
            functionProps,
        };
    }

    private setupWithExistingQueue(
        existingQueueName: string,
        consumerName: string
    ): void {
        this.logger.info(`Using existing framework queue '${existingQueueName}' for ${consumerName}. The queue must be configured to subscribe to topic '${this.getStreamTopicName()}' in its @Queue setup.`);

        // Just validate the queue exists - DON'T modify it or subscribe it to anything
        try {
            this.fw24.getQueueByName(
                existingQueueName,
                this.mainStack,
                `${this.fw24.appName}-${consumerName}-existing`
            );
            this.logger.info(`${consumerName} validation completed - existing queue ${existingQueueName} found for table:`, this.dynamoDBConfig.table.name);
        } catch (error) {
            this.logger.error(`Queue '${existingQueueName}' not found for ${consumerName}. Ensure it's defined with @Queue('${existingQueueName}') decorator.`);
            throw error;
        }
    }

    private async setupWithQueueHandler(
        queueHandlerPath: string,
        consumerName: string,
        environmentVariables: Record<string, string>,
        functionProps?: NodejsFunctionProps,
        sqsEventSourceProps?: SqsEventSourceProps
    ): Promise<void> {
        this.logger.info(`Loading queue handler from: ${queueHandlerPath}`);

        // Dynamic import (same pattern as QueueConstruct uses via Helper.registerHandlers)
        const absolutePath = resolve(queueHandlerPath);
        const queueModule = await import(absolutePath);

        // Find queue class (same logic as Helper.registerHandlers)
        let QueueClass: QueueConstructor | undefined;
        for (const exportedItem of Object.values(queueModule)) {
            if (typeof exportedItem === "function" && exportedItem.name !== "handler") {
                QueueClass = exportedItem as QueueConstructor;
                break;
            }
        }

        if (!QueueClass) {
            throw new Error(`No queue class found in ${queueHandlerPath}`);
        }

        // Instantiate to get config (same as QueueConstruct does)
        const handlerInstance = new QueueClass();
        const queueName = handlerInstance.queueName;
        const queueConfig = handlerInstance.queueConfig || {};

        // Validate manual registration flag
        if (!queueConfig.manualRegistration) {
            throw new Error(
                `Queue '${queueName}' must have manualRegistration: true in its @Queue config to use queueHandlerPath`
            );
        }

        this.logger.info(`Creating queue ${queueName} for ${consumerName}`);

        // Merge environment variables
        const mergedEnvVars = {
            ...environmentVariables,
            ...this.fw24.resolveEnvVariables(queueConfig.env)
        };

        // Merge function props using proper merge utility (same pattern as QueueConstruct)
        // functionProps from searchIndexing/audit config take precedence
        const mergedFunctionProps = merge([
            queueConfig.functionProps ?? {},
            functionProps ?? {}
        ])!;

        // Merge sqsEventSourceProps: decorator config as base, searchIndexing/audit config takes precedence
        const mergedSqsEventSourceProps = { ...queueConfig.sqsEventSourceProps, ...sqsEventSourceProps };

        // Create queue + lambda (same pattern as QueueConstruct, but with subscription to stream topic)
        // Include table name to make construct ID and actual queue name unique when multiple tables use same queue handler
        const actualQueueName = `${this.dynamoDBConfig.table.name}-${queueName}`;
        const queue = new QueueLambda(this.mainStack, `${actualQueueName}-queue`, {
            queueName: actualQueueName,
            queueProps: queueConfig.queueProps,
            visibilityTimeoutSeconds: queueConfig.visibilityTimeoutSeconds,
            receiveMessageWaitTimeSeconds: queueConfig.receiveMessageWaitTimeSeconds,
            retentionPeriodDays: queueConfig.retentionPeriodDays,
            maxReceiveCount: queueConfig.maxReceiveCount,
            sqsEventSourceProps: mergedSqsEventSourceProps,
            subscriptions: {
                topics: [ {
                    name: this.getStreamTopicName(),
                    filters: [],
                } ],
            },
            lambdaFunctionProps: {
                entry: absolutePath,
                environmentVariables: mergedEnvVars,
                resourceAccess: queueConfig.resourceAccess,
                functionProps: mergedFunctionProps,
                functionTimeout: queueConfig.functionTimeout,
                policies: queueConfig.policies,
                logRemovalPolicy: queueConfig.logRemovalPolicy,
                logRetentionDays: queueConfig.logRetentionDays,
            }
        }) as Queue;

        // Register output (same as QueueConstruct does)
        this.fw24.setConstructOutput(this, actualQueueName, queue, OutputType.QUEUE, 'queueName');

        this.logger.info(`${consumerName} queue created successfully: ${actualQueueName}`);
    }

    private setupWithNewQueue(
        queueConfig: NewQueueConfig,
        consumerName: string,
        lambdaConfig: LambdaFunctionProps
    ): void {
        // Always prefix queue name with table name for uniqueness, even if custom name provided
        const baseQueueName = queueConfig.customQueueName || consumerName;
        const actualQueueName = `${this.dynamoDBConfig.table.name}-${baseQueueName}`;

        // Include table name to make construct ID and actual queue name unique
        // QueueLambda will normalize sqsEventSourceProps with proper defaults
        new QueueLambda(this.mainStack, `${actualQueueName}-queue`, {
            queueName: actualQueueName,
            lambdaFunctionProps: lambdaConfig,
            queueProps: queueConfig.queueProps || {},
            subscriptions: {
                topics: [ {
                    name: this.getStreamTopicName(),
                    filters: [],
                } ],
            },
            sqsEventSourceProps: queueConfig.sqsEventSourceProps,
        });
    }

    private async setupAuditProcessing(config: AuditConfig, tableInstance: TableV2): Promise<void> {
        // Only entity filtering env vars - observability handles backend routing
        const envVars: Record<string, string> = {};

        if (config.allowedEntityNames && config.allowedEntityNames.length > 0) {
            envVars[ AUDIT_ENV_KEYS.ALLOWED_ENTITY_NAMES ] = config.allowedEntityNames.join(',');
        }

        if (config.excludedEntityNames && config.excludedEntityNames.length > 0) {
            envVars[ AUDIT_ENV_KEYS.EXCLUDED_ENTITY_NAMES ] = config.excludedEntityNames.join(',');
        }

        // No resource access needed - observability system handles its own table access via global resource access
        await this.setupStreamEventConsumers(
            tableInstance,
            'entity-audit',
            config,
            join(__dirname, '../audit/function/dynamodb-stream-handler.js'),
            envVars,
            {} // No additional resource access - observability handles it
        );

        this.logger.info('Audit processing enabled', {
            table: this.dynamoDBConfig.table.name,
            allowedEntities: config.allowedEntityNames,
            excludedEntities: config.excludedEntityNames
        });
    }

    private async setupSearchIndexingProcessing(config: SearchIndexingConfig, tableInstance: TableV2): Promise<void> {
        // Set search indexing configuration in environment variables for lambda functions
        this.logger.debug('Setting up search indexing processing for table:', this.dynamoDBConfig.table.name);

        const appQualifiedTableName = ensureNoSpecialChars(ensureSuffix(this.dynamoDBConfig.table.name, `table`));

        const { enabled, engineConfig: { type: engineType, host: engineHost, masterKey: engineMasterKey } } = config;

        const envVars = {
            // pointer to the actual table name env variable
            [ SEARCH_INDEXER_ENV_KEYS.TABLE_NAME_ENV_KEY ]: appQualifiedTableName,
            // actual table name
            [ appQualifiedTableName ]: this.fw24.getEnvironmentVariable(appQualifiedTableName, 'table'),

            [ SEARCH_INDEXER_ENV_KEYS.ENABLED ]: enabled?.toString() || 'false',
            [ SEARCH_INDEXER_ENV_KEYS.MEILI_HOST ]: engineHost || engineType === 'meili' ? this.fw24.getEnvironmentVariable(SEARCH_INDEXER_ENV_KEYS.MEILI_HOST) : undefined,
            [ SEARCH_INDEXER_ENV_KEYS.MEILI_MASTER_KEY ]: engineMasterKey || engineType === 'meili' ? this.fw24.getEnvironmentVariable(SEARCH_INDEXER_ENV_KEYS.MEILI_MASTER_KEY) : undefined,
        }

        if (config.allowedEntityNames && config.allowedEntityNames.length > 0) {
            envVars[ SEARCH_INDEXER_ENV_KEYS.ALLOWED_ENTITY_NAMES ] = config.allowedEntityNames.join(',');
        }

        if (config.excludedEntityNames && config.excludedEntityNames.length > 0) {
            envVars[ SEARCH_INDEXER_ENV_KEYS.EXCLUDED_ENTITY_NAMES ] = config.excludedEntityNames.join(',');
        }

        // Create QueueLambda for processing search indexing events from the stream topic
        await this.setupStreamEventConsumers(
            tableInstance,
            'search-indexer',
            config,
            join(__dirname, '../search/indexer/functions/default-dynamo-stream-search-indexer-handler.js'),
            envVars,
            {}  // No base resource access
        );

        // TODO: look into it later
        // const systemControllerPath = '/system/search';
        // if (!this.fw24.hasSystemController(systemControllerPath)) {
        //     this.fw24.registerSystemController({
        //         path: systemControllerPath,
        //         filePath: join(__dirname, '../search/system/search-controller.js'),
        //     });
        //     this.logger.info('Search system controller registered.');
        // }
    }

}
