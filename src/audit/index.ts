import { createLogger } from '../logging';
import { CloudWatchLogs } from '@aws-sdk/client-cloudwatch-logs';
import { createAuditSchema } from './schema';
import { Fw24 } from '../core/fw24';

export * as Auditor from './';

export type AuditLoggerType = 'console' | 'cloudwatch' | 'dynamodb' | 'custom';

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
     * @default 'cloudwatch'
     */
    type?: AuditLoggerType;
    /**
     * DynamoDB specific options
     */
    tableName?: string;
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
         * TTL in seconds for DynamoDB records
         */
        ttl?: number;
    };
}

export interface AuditOptions {
    /**
     * Whether audit logging is enabled for this specific operation.
     * If not provided, the auditor's configuration will be used.
     */
    enabled?: boolean;
    entityName: string;
    crudType: string;
    data?: any;
    entity?: any;
    actor?: any;
    tenant?: any;
    identifiers?: any;
}

export interface IAuditor {
    audit(options: AuditOptions): Promise<void>;
}

// Null Logger Implementation
export class NullAuditor implements IAuditor {
    async audit(): Promise<void> {
        // Do nothing
    }
}

// Console Logger Implementation
export class ConsoleAuditor implements IAuditor {
    private logger = createLogger('Auditor');
    private enabled: boolean;

    constructor(config?: AuditConfig) {
        this.enabled = config?.enabled ?? false;
    }

    async audit(options: AuditOptions): Promise<void> {
        // If explicitly disabled for this operation or globally disabled, skip logging
        if (options.enabled === false || this.enabled === false) {
            return;
        }

        const auditEntry = {
            timestamp: new Date().toISOString(),
            ...options
        };
        this.logger.info('Audit Log:', auditEntry);
    }
}

// CloudWatch Logger Implementation
export class CloudWatchAuditor implements IAuditor {
    readonly fw24: Fw24 = Fw24.getInstance();
    private client: CloudWatchLogs;
    private logGroupName: string;
    private logger = createLogger('CloudWatchAuditor');
    private enabled: boolean;

    constructor(config: AuditConfig) {
        this.enabled = config.enabled ?? false;
        this.client = new CloudWatchLogs({ region: config.cloudwatchOptions?.region || this.fw24.getConfig().region });
        this.logGroupName = config.cloudwatchOptions?.logGroupName || `/audit/${this.fw24.getConfig().name}/${config.tableName}`;
        // create log group if it doesn't exist
        this.client.createLogGroup({
            logGroupName: this.logGroupName
        });
    }

    async audit(options: AuditOptions): Promise<void> {
        // If explicitly disabled for this operation or globally disabled, skip logging
        if (options.enabled === false || this.enabled === false) {
            return;
        }

        const auditEntry = {
            timestamp: new Date().toISOString(),
            ...options
        };

        try {
            await this.client.putLogEvents({
                logGroupName: this.logGroupName,
                // Monthly streams with entity name
                logStreamName: `${options.entityName}-${new Date().toISOString().split('T')[0]}`,
                logEvents: [{
                    timestamp: Date.now(),
                    message: JSON.stringify(auditEntry)
                }]
            });
        } catch (error) {
            this.logger.error('Failed to write to CloudWatch:', error);
            throw error;
        }
    }
}

// DynamoDB Logger Implementation
export class DynamoDbAuditor implements IAuditor {
    private logger = createLogger('DynamoDbAuditor');
    private schema = createAuditSchema();
    private tableName: string;
    private enabled: boolean;

    constructor(config: AuditConfig) {
        this.enabled = config.enabled ?? false;
        this.tableName = config.tableName!;
    }

    async audit(options: AuditOptions): Promise<void> {
        // If explicitly disabled for this operation or globally disabled, skip logging
        if (options.enabled === false || this.enabled === false) {
            return;
        }

        const timestamp = new Date();
        const auditEntry = {
            timestamp: timestamp.toISOString(),
            ...options,
            //...(this.ttl && { ttl: Math.floor(timestamp.getTime() / 1000) + this.ttl })
        };

        try {
            // todo: write to dynamodb
        } catch (error) {
            this.logger.error('Failed to write to DynamoDB:', error);
            throw error;
        }
    }
}

// function to create the appropriate auditor
export function createAuditor(config: AuditConfig): IAuditor {
    let auditor: IAuditor;
    if (!config.enabled) {
        auditor = new NullAuditor();
    } else {
        switch (config.type) {
            case 'cloudwatch':
                auditor = new CloudWatchAuditor(config);
                break;
            case 'dynamodb':
                auditor = new DynamoDbAuditor(config);
                break;
            case 'custom':
                if (!config.customLogger) {
                    throw new Error('Custom logger must be provided when using custom type');
                }
                auditor = config.customLogger;
                break;
            case 'console':
            default:
                auditor = new ConsoleAuditor(config);
                break;
        }
    }

    // Store the auditor in the fw24 instance using the table name as the key
    const fw24 = Fw24.getInstance();
    const tableName = config.tableName!;
    fw24.setAuditor(tableName, auditor);
    return auditor;
}

// function to retrieve the appropriate auditor
export function getAuditor(tableName: string): IAuditor {
    const fw24 = Fw24.getInstance();
    const auditor = fw24.getAuditor(tableName);
    
    if (!auditor) {
        // If no auditor is found, return a new NullAuditor as default
        return new NullAuditor();
    }
    
    return auditor;
}

// Default implementation uses CloudWatch logging
// export const Default: IAuditor = createAuditor({ type: 'cloudwatch', enabled: true });