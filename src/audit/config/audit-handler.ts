import { Fw24 } from '../../core/fw24';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { AuditLoggerType, IAuditor } from '../interfaces';
import { LogGroupProps } from "aws-cdk-lib/aws-logs";

/**
 * Configuration for audit logging.
 */
export interface AuditConfig {
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
    customLogger?: IAuditor;
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
    dynamodbOptions?: {
        /**
         * DynamoDB specific options
         */
        tableName?: string;
        /**
         * TTL in seconds for DynamoDB records
         */
        ttl?: number;
        
    };
}


export class AuditHandler {
    private static instance: AuditHandler;
    private fw24: Fw24 = Fw24.getInstance();

    constructor() {
        this.setup();
    }

    private setup(): void {
        const config: AuditConfig = this.fw24.getConfig().audit || {};

        // Set audit configuration in environment variables for lambda functions
        this.setupAuditEnvironmentVariables(config);
        // handle setup for various audit types
        switch (config.type) {
            case 'dynamodb':
                this.setupDynamoDBAudit();
                break;
            case 'cloudwatch':
                this.setupCloudWatchAudit(config);
                break;
            case 'console':
                this.setupConsoleAudit();
                break;
        }
    }

    private setupDynamoDBAudit(): void {
        // TODO: Implement DynamoDB audit setup
    }

    private setupCloudWatchAudit(config: AuditConfig): void {
        // Create a CloudWatch Log Group if it doesn't exist
        const logGroupName = this.fw24.getEnvironmentVariable('AUDIT_CLOUDWATCH_LOG_GROUP', 'audit');
        new LogGroup(this.fw24.getStack(), logGroupName, {
            ...config.cloudwatchOptions?.logGroupOptions
        });
    }

    private setupConsoleAudit(): void {
        // Nothing to do here
    }

    private setupAuditEnvironmentVariables(config: AuditConfig): void {
        this.fw24.setGlobalEnvironmentVariable('AUDIT_ENABLED', config.enabled?.toString() || 'false');
        this.fw24.setGlobalEnvironmentVariable('AUDIT_TYPE', config.type || 'console');
        
        if (config.dynamodbOptions?.tableName) {
            this.fw24.setGlobalEnvironmentVariable('AUDIT_TABLE_NAME', config.dynamodbOptions.tableName);
        }

        if (config.cloudwatchOptions) {
            this.fw24.setGlobalEnvironmentVariable('AUDIT_CLOUDWATCH_LOG_GROUP', 
                config.cloudwatchOptions.logGroupName || `/audit/${this.fw24.getConfig().name}`
            );
            this.fw24.setGlobalEnvironmentVariable('AUDIT_CLOUDWATCH_REGION', 
                config.cloudwatchOptions.region || this.fw24.getConfig().region
            );
        }

    }
    
} 