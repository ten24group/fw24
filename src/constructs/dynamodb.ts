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
import { registerEntitySchema } from "../decorators";
import { createAuditSchema, AuditSchemaType } from "../audit/schema/dynamodb";
import { TopicConstruct, ITopicConstructConfig } from "./topic";
import { LambdaFunction } from "./lambda-function";
import { QueueLambda } from "./queue-lambda";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
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
    constructor(private dynamoDBConfig: IDynamoDBConfig) {
    }

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

        // Setup stream processing if enabled or audit is enabled and stream ARN exists
        if (
            (this.dynamoDBConfig.table.stream?.enabled == undefined 
                || this.dynamoDBConfig.table.stream?.enabled 
                || this.dynamoDBConfig.table.audit?.enabled) 
            && tableInstance.tableStreamArn) {
            this.setupStreamProcessing(tableInstance);
        }

        if (this.dynamoDBConfig.table.audit?.enabled) {
            this.setupAuditProcessing(this.dynamoDBConfig.table.audit, tableInstance);
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
        const streamTopicConfig: ITopicConstructConfig[] = [{
            topicName,
            topicProps: {
                displayName: `Stream events for ${this.dynamoDBConfig.table.name}`,
                fifo: isFifo,
                ...streamConfig.topic?.props
            }
        }];

        new TopicConstruct(streamTopicConfig).construct();

        // Create Lambda to process stream and publish to SNS
        const streamProcessor = new LambdaFunction(this.mainStack, `${this.fw24.appName}-stream-processor`, {
            entry: join(__dirname, '../core/runtime/dynamodb-stream-processor.js'),
            environmentVariables: {
                TOPIC_NAME: topicName,
                TOPIC_TYPE: isFifo ? 'fifo' : 'standard'
            },
            resourceAccess: {
                topics: [{
                    name: topicName,
                    access: ['publish']
                }]
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

    private async setupAuditProcessing(config: AuditConfig, tableInstance: TableV2) {
        // Set audit configuration in environment variables for lambda functions
        this.setupAuditEnvironmentVariables(config);

        // Create QueueLambda for processing audit events from the stream topic
        if (tableInstance.tableStreamArn) {
            let resourceAccess: any = {};
            
            if (config.type === AuditLoggerType.DYNAMODB) {
                resourceAccess = {
                    tables: [{
                        name: this.fw24.getEnvironmentVariable(AUDIT_ENV_KEYS.AUDIT_TABLE_NAME),
                        access: ['readwrite']
                    }]
                };
            }

            new QueueLambda(this.mainStack, `${this.fw24.appName}-entity-audit-queue`, {
                queueName: `${this.dynamoDBConfig.table.name}-entity-audit`,
                lambdaFunctionProps: {
                    entry: join(__dirname, '../audit/function/dynamodb-stream-logging.js'),
                    resourceAccess: resourceAccess,
                    environmentVariables: {
                        AUDIT_ENABLED: config.enabled?.toString() || 'false',
                        AUDIT_TYPE: config.type || AuditLoggerType.CLOUDWATCH
                    }
                },
                queueProps: {
                    ...config.dynamodbstreamOptions?.queueProps
                },
                subscriptions: {
                    topics: [{
                        name: this.getStreamTopicName(),
                        filters: []
                    }]
                },
                sqsEventSourceProps: {
                    batchSize: config.dynamodbstreamOptions?.sqsEventSourceProps?.batchSize || 5,
                    maxBatchingWindow: config.dynamodbstreamOptions?.sqsEventSourceProps?.maxBatchingWindow || Duration.seconds(5),
                    reportBatchItemFailures: config.dynamodbstreamOptions?.sqsEventSourceProps?.reportBatchItemFailures || true
                }
            });
        }

        // Handle setup for various audit types
        switch (config.type) {
            case AuditLoggerType.DYNAMODB:
                this.setupDynamoDBAuditor(config);
                break;
            case AuditLoggerType.CONSOLE:
                this.setupConsoleAudit();
                break;
            case AuditLoggerType.CLOUDWATCH:
            default:
                this.setupCloudWatchAuditor(config);
                break;
        }
    }

    private setupDynamoDBAuditor(config: AuditConfig): void {
        // Configure the audit logging table
        const auditTableName = this.fw24.getEnvironmentVariable(AUDIT_ENV_KEYS.AUDIT_TABLE_NAME);
        this.logger.debug(`Setting up DynamoDB audit logging table with name ${auditTableName}`, config);
        // TODO: Implement the creation of the audit logging table
        registerEntitySchema<AuditSchemaType>({
            forEntity: 'auditLog',
            providedIn: "ROOT",
            useFactory: createAuditSchema,
        });
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

    private setupConsoleAudit(): void {
        // Nothing to do here
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
    
}
