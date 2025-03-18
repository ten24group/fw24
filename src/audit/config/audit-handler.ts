import { Fw24 } from '../../core/fw24';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { AUDIT_ENV_KEYS, AuditLoggerType, IAuditor } from '../interfaces';
import { LogGroupProps } from "aws-cdk-lib/aws-logs";
import { createLogger } from '../../logging';

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
    private logger = createLogger(AuditHandler.name);
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
        const logGroupName = this.fw24.getEnvironmentVariable(AUDIT_ENV_KEYS.LOG_GROUP_NAME);
        this.logger.info(`Setting up CloudWatch audit log group with name ${logGroupName}`);
        new LogGroup(this.fw24.getStack(), this.fw24.appName + '-audit-log-group', {
            logGroupName: logGroupName,
            ...config.cloudwatchOptions?.logGroupOptions
        });
    }

    private setupConsoleAudit(): void {
        // Nothing to do here
    }

    private setupAuditEnvironmentVariables(config: AuditConfig): void {
        this.fw24.setGlobalEnvironmentVariable(AUDIT_ENV_KEYS.ENABLED, config.enabled?.toString() || 'false');
        this.fw24.setGlobalEnvironmentVariable(AUDIT_ENV_KEYS.TYPE, config.type || 'console');
        
        if (config.type === 'dynamodb') {
            this.fw24.setGlobalEnvironmentVariable(AUDIT_ENV_KEYS.TABLE_NAME, config.dynamodbOptions?.tableName);
        }

        if (config.type === 'cloudwatch') {
            this.fw24.setGlobalEnvironmentVariable(AUDIT_ENV_KEYS.LOG_GROUP_NAME, 
                config.cloudwatchOptions?.logGroupName || `/audit/logs/${this.fw24.getConfig().name}`
            );
            this.fw24.setGlobalEnvironmentVariable(AUDIT_ENV_KEYS.REGION, 
                config.cloudwatchOptions?.region || this.fw24.getConfig().region
            );
        }

    }
    
} 