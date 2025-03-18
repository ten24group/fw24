import { TablePropsV2, TableV2 } from "aws-cdk-lib/aws-dynamodb";

import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import { createLogger, LogDuration } from "../logging";
import { ensureNoSpecialChars, ensureSuffix } from "../utils/keys";
import { IConstructConfig } from "../interfaces/construct-config";
import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { DynamoEventSource, DynamoEventSourceProps } from "aws-cdk-lib/aws-lambda-event-sources";
import { LogGroup, LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import { AuditLoggerType, AUDIT_ENV_KEYS, IAuditLogger } from "../audit/interfaces";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import path from "path";
import { LambdaFunction } from "./lambda-function";

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
         * Event source properties for DynamoDB table
         */
        eventSourceProps?: DynamoEventSourceProps;
        /**
         * TTL in seconds for DynamoDB records
         */
        ttl?: number;
        
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

        if (this.dynamoDBConfig.table.audit) {
            this.setupAudit(this.dynamoDBConfig.table.audit, tableInstance);
        }
    }

    private async setupAudit(config: AuditConfig, tableInstance: TableV2) {
        if (!config.enabled) {
            return;
        }
        // Set audit configuration in environment variables for lambda functions
        this.setupAuditEnvironmentVariables(config);

        // Setup DynamoDB stream reader lambda function
        this.setupDynamoDBStream(config, tableInstance);

        // handle setup for various audit types
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

    private setupDynamoDBStream(config: AuditConfig, tableInstance: TableV2): void {

        if(!tableInstance.tableStreamArn) {
            throw new Error('Table ' + this.dynamoDBConfig.table.name + ' does not have a stream enabled');
        }

        this.logger.info('Setting up DynamoDB stream reader lambda function for table ', this.dynamoDBConfig.table.name);   

        let resourceAccess: any = {};
        if(config.type === AuditLoggerType.DYNAMODB) {
            resourceAccess = {
                tables: [
                    {
                    name: this.fw24.getEnvironmentVariable(AUDIT_ENV_KEYS.AUDIT_TABLE_NAME),
                    access: ['readwrite']
                }
            ]   
            }
        }

        const streamReader = new LambdaFunction(this.mainStack, this.fw24.appName + '-audit-stream-reader', {
            entry: path.join(__dirname, '../audit/function/dynamodbstream.js'),
            resourceAccess: resourceAccess
        }) as NodejsFunction;

        const eventSourceProps: DynamoEventSourceProps = {
            ...config.dynamodbstreamOptions?.eventSourceProps,
            startingPosition: config.dynamodbstreamOptions?.eventSourceProps?.startingPosition || StartingPosition.LATEST,
            batchSize: config.dynamodbstreamOptions?.eventSourceProps?.batchSize || 5,
            bisectBatchOnError: config.dynamodbstreamOptions?.eventSourceProps?.bisectBatchOnError || true,
            retryAttempts: config.dynamodbstreamOptions?.eventSourceProps?.retryAttempts || 3,
        };

        tableInstance.grantStreamRead(streamReader);
        streamReader.addEventSource(new DynamoEventSource(tableInstance, eventSourceProps));
        
    }

    private setupDynamoDBAuditor(config: AuditConfig): void {
        // Configure the audit logging table
        const auditTableName = this.fw24.getEnvironmentVariable(AUDIT_ENV_KEYS.AUDIT_TABLE_NAME);
        this.logger.debug(`Setting up DynamoDB audit logging table with name ${auditTableName}`, config);
        const entitySchemaFile = path.join(__dirname, '../audit/schema/dynamodb.json');
        // TODO: Implement the creation of the audit logging table
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
