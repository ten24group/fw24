import { TablePropsV2, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { TopicProps } from "aws-cdk-lib/aws-sns";
import { DynamoEventSource, DynamoEventSourceProps, SqsEventSourceProps } from "aws-cdk-lib/aws-lambda-event-sources";
import { LogGroup, LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { join } from "path";
import { Duration } from "aws-cdk-lib";

import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import { createLogger, LogDuration } from "../logging";
import { ensureNoSpecialChars, ensureSuffix } from "../utils/keys";
import { IConstructConfig } from "../interfaces/construct-config";
import { AuditLoggerType, AUDIT_ENV_KEYS, IAuditLogger } from "../audit/interfaces";
import { SEARCH_INDEXER_ENV_KEYS } from "../search/indexer/interfaces";
import { TopicConstruct, ITopicConstructConfig } from "./topic";
import { LambdaFunction, LambdaFunctionProps } from "./lambda-function";
import { QueueLambda } from "./queue-lambda";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
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
     * MeiliSearch host URL
     */
    meiliHost?: string;
    /**
     * MeiliSearch master key
     */
    meiliMasterKey?: string;
    /**
     * Custom lambda function properties for search indexing processing.
     * When provided, completely replaces the default search indexer handler.
     * Custom handlers can extend base classes and reuse framework utilities.
     */
    lambdaFunctionProps?: LambdaFunctionProps;
    /**
     * Search indexing queue properties
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
        searchIndexing?: SearchIndexingConfig;
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
     * The type of audit logger to use.
     * @default 'console'
     */
    type?: AuditLoggerType;
    /**
     * Custom logger implementation
     */
    customLogger?: IAuditLogger;
    /**
     * Custom lambda function properties for audit processing.
     * When provided, completely replaces the default audit handler.
     * Custom handlers can extend base classes and reuse framework utilities.
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
         * Audit queue properties
         */
        queueProps?: QueueProps;
        /**
         * SQS event source properties
         */
        sqsEventSourceProps?: SqsEventSourceProps;
    };
}

export class DynamoDBConstruct implements FW24Construct {
    readonly logger = createLogger(DynamoDBConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();

    name: string = DynamoDBConstruct.name;
    dependencies: string[] = [];
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
    constructor(private dynamoDBConfig: IDynamoDBConfig) { }

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
        this.fw24.setEnvironmentVariable(appQualifiedTableName, tableInstance.tableName, `${OutputType.TABLE}`);

        // Register the table instance as a global container
        fw24.addDynamoTable(appQualifiedTableName, tableInstance);

        // Setup stream processing if enabled or audit is enabled or search indexing is enabled and stream ARN exists
        if (
            (
                this.dynamoDBConfig.table.stream?.enabled
                || this.dynamoDBConfig.table.audit?.enabled
                || this.dynamoDBConfig.table.searchIndexing?.enabled
            )
            && tableInstance.tableStreamArn
        ) {
            this.setupStreamProcessing(tableInstance);
        }

        if (this.dynamoDBConfig.table.audit?.enabled) {
            this.setupAuditProcessing(this.dynamoDBConfig.table.audit, tableInstance);
        }

        if (this.dynamoDBConfig.table.searchIndexing?.enabled) {
            this.setupSearchIndexingProcessing(this.dynamoDBConfig.table.searchIndexing, tableInstance);
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
        const streamProcessor = new LambdaFunction(this.mainStack, `${this.fw24.appName}-stream-processor`, {
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

        this.logger.info('Stream processing setup completed for table:', this.dynamoDBConfig.table.name);
    }

    private setupStreamEventConsumers(
        tableInstance: TableV2,
        consumerName: string,
        config: AuditConfig | SearchIndexingConfig,
        defaultHandlerEntry: string,
        environmentVariables: Record<string, string>,
        resourceAccess?: any,
    ): void {

        if (!tableInstance.tableStreamArn) {
            this.logger.warn(`Stream ARN not found for table ${this.dynamoDBConfig.table.name}, cannot set up ${consumerName}`);
            return;
        }

        const isAuditConfig = (c: any): c is AuditConfig => c.type !== undefined || c.cloudwatchOptions !== undefined || c.dynamodbstreamOptions !== undefined;
        const isSearchConfig = (c: any): c is SearchIndexingConfig => c.meiliHost !== undefined || c.meiliMasterKey !== undefined;

        let specificEnvVars: Record<string, string> = {};
        let specificQueueProps: QueueProps | undefined;
        let specificSqsEventSourceProps: SqsEventSourceProps | undefined;
        let customLambdaProps: LambdaFunctionProps | undefined;

        if (isAuditConfig(config)) {
            specificEnvVars = {
                AUDIT_ENABLED: config.enabled?.toString() || 'false',
                AUDIT_TYPE: config.type || AuditLoggerType.CLOUDWATCH,
                ...(resourceAccess?.tables?.[ 0 ]?.name ? { AUDIT_TABLE_NAME: resourceAccess.tables[ 0 ].name } : {})
            };
            specificQueueProps = config.dynamodbstreamOptions?.queueProps;
            specificSqsEventSourceProps = config.dynamodbstreamOptions?.sqsEventSourceProps;
            customLambdaProps = config.lambdaFunctionProps;
        } else if (isSearchConfig(config)) {
            specificEnvVars = {
                SEARCH_INDEXER_ENABLED: config.enabled?.toString() || 'false',
                MEILI_HOST: config.meiliHost || this.fw24.getEnvironmentVariable(SEARCH_INDEXER_ENV_KEYS.MEILI_HOST),
                MEILI_MASTER_KEY: config.meiliMasterKey || this.fw24.getEnvironmentVariable(SEARCH_INDEXER_ENV_KEYS.MEILI_MASTER_KEY),
            };
            specificQueueProps = config.queueProps;
            specificSqsEventSourceProps = config.sqsEventSourceProps;
            customLambdaProps = config.lambdaFunctionProps;
        }


        const lambdaFunctionProps = customLambdaProps ? {
            ...customLambdaProps,
            environmentVariables: {
                ...environmentVariables, // Base env vars
                ...specificEnvVars, // Consumer specific default env vars
                ...customLambdaProps.environmentVariables, // Custom env vars (can override)
            },
            resourceAccess: {
                ...resourceAccess, // Base resource access
                ...customLambdaProps.resourceAccess, // Custom resource access (can override/extend)
            },
        } : {
            entry: defaultHandlerEntry,
            resourceAccess: resourceAccess,
            environmentVariables: {
                ...environmentVariables, // Base env vars
                ...specificEnvVars, // Consumer specific default env vars
            },
        };

        new QueueLambda(this.mainStack, `${this.fw24.appName}-${consumerName}-queue`, {
            queueName: `${this.dynamoDBConfig.table.name}-${consumerName}`,
            lambdaFunctionProps: lambdaFunctionProps,
            queueProps: {
                ...specificQueueProps,
            },
            subscriptions: {
                topics: [ {
                    name: this.getStreamTopicName(),
                    filters: [],
                } ],
            },
            sqsEventSourceProps: {
                batchSize: specificSqsEventSourceProps?.batchSize || 5,
                maxBatchingWindow: specificSqsEventSourceProps?.maxBatchingWindow || Duration.seconds(5),
                reportBatchItemFailures: specificSqsEventSourceProps?.reportBatchItemFailures || true,
                ...specificSqsEventSourceProps, // Allow overrides
            },
        });

        this.logger.info(`${consumerName} setup completed for table:`, this.dynamoDBConfig.table.name);
    }

    private async setupAuditProcessing(config: AuditConfig, tableInstance: TableV2) {
        // Set audit configuration in environment variables for lambda functions
        this.setupAuditEnvironmentVariables(config);

        let auditResourceAccess: any = {};
        if (config.type === AuditLoggerType.DYNAMODB) {
            auditResourceAccess = {
                tables: [ {
                    name: this.fw24.getEnvironmentVariable(AUDIT_ENV_KEYS.AUDIT_TABLE_NAME),
                    access: [ 'readwrite' ],
                } ],
            };
        }

        this.setupStreamEventConsumers(
            tableInstance,
            'entity-audit',
            config,
            join(__dirname, '../audit/function/dynamodb-stream-handler.js'),
            {}, // No base environment variables from here, they are set globally or in specificEnvVars
            auditResourceAccess
        );

        // Handle setup for various audit types
        switch (config.type) {
            case AuditLoggerType.DYNAMODB:
                // Configure the audit logging table
                const auditTableName = this.fw24.getEnvironmentVariable(AUDIT_ENV_KEYS.AUDIT_TABLE_NAME);
                this.logger.debug(`Setting up DynamoDB audit logging table with name ${auditTableName}`, config);
                break;
            case AuditLoggerType.CONSOLE:
                this.logger.info('No setup required for console audit');
                break;
            case AuditLoggerType.CLOUDWATCH:
            default:
                this.setupCloudWatchAuditor(config);
                break;
        }
    }

    private setupCloudWatchAuditor(config: AuditConfig): void {
        const logGroupName = this.fw24.getEnvironmentVariable(AUDIT_ENV_KEYS.LOG_GROUP_NAME);
        this.logger.info(`Setting up CloudWatch audit log group with name ${logGroupName}`);
        new LogGroup(this.mainStack, this.fw24.appName + '-audit-log-group', {
            logGroupName: logGroupName,
            retention: RetentionDays.ONE_YEAR,
            removalPolicy: RemovalPolicy.DESTROY,
            ...config.cloudwatchOptions?.logGroupOptions
        });
    }

    private setupAuditEnvironmentVariables(config: AuditConfig): void {
        this.fw24.setGlobalEnvironmentVariable(AUDIT_ENV_KEYS.ENABLED, config.enabled?.toString() || 'false');
        this.fw24.setGlobalEnvironmentVariable(AUDIT_ENV_KEYS.TYPE, config.type || AuditLoggerType.CLOUDWATCH);

        if (config.type === AuditLoggerType.DYNAMODB) {
            this.fw24.setEnvironmentVariable(AUDIT_ENV_KEYS.AUDIT_TABLE_NAME, config.dynamodbstreamOptions?.auditTableName || this.dynamoDBConfig.table.name);
        }

        // Default to CLOUDWATCH if no type is set, or it is set to CLOUDWATCH
        if (!config.type || config.type === AuditLoggerType.CLOUDWATCH) {
            this.fw24.setGlobalEnvironmentVariable(AUDIT_ENV_KEYS.LOG_GROUP_NAME,
                config.cloudwatchOptions?.logGroupName || `/audit/logs/${this.fw24.getConfig().name}`
            );
            this.fw24.setGlobalEnvironmentVariable(AUDIT_ENV_KEYS.REGION,
                config.cloudwatchOptions?.region || this.fw24.getConfig().region
            );
        }

    }

    private async setupSearchIndexingProcessing(config: SearchIndexingConfig, tableInstance: TableV2) {
        // Set search indexing configuration in environment variables for lambda functions
        this.setupSearchIndexingEnvironmentVariables(config);

        // Create QueueLambda for processing search indexing events from the stream topic
        // No specific resourceAccess needed for the default search indexer from here,
        // as it doesn't interact with AWS resources other than what's configured via env vars (Meili).
        // Custom lambdas can define their own.
        this.setupStreamEventConsumers(
            tableInstance,
            'search-indexer',
            config,
            join(__dirname, '../search/indexer/search-indexer-handler.js'),
            {}, // No base environment variables from here
            {}  // No base resource access
        );
    }

    private setupSearchIndexingEnvironmentVariables(config: SearchIndexingConfig): void {
        this.fw24.setGlobalEnvironmentVariable(SEARCH_INDEXER_ENV_KEYS.ENABLED, config.enabled?.toString() || 'false');

        // Set MeiliSearch specific environment variables
        if (config.meiliHost) {
            this.fw24.setGlobalEnvironmentVariable(SEARCH_INDEXER_ENV_KEYS.MEILI_HOST, config.meiliHost);
        }
        if (config.meiliMasterKey) {
            this.fw24.setGlobalEnvironmentVariable(SEARCH_INDEXER_ENV_KEYS.MEILI_MASTER_KEY, config.meiliMasterKey);
        }
    }

}
