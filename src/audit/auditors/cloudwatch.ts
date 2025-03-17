import { CloudWatchLogs } from '@aws-sdk/client-cloudwatch-logs';
import { createLogger } from '../../logging';
import { AuditorConfig, AuditOptions, IAuditor } from '../interfaces';

export class CloudWatchAuditor implements IAuditor {
    private client: CloudWatchLogs;
    private logGroupName: string;
    private logger = createLogger('CloudWatchAuditor');
    private enabled: boolean;

    constructor(config: AuditorConfig) {
        this.enabled = config.enabled ?? false;
        this.client = new CloudWatchLogs({ region: config.region });
        this.logGroupName = config.logGroupName!;
    }

    async audit(options: AuditOptions): Promise<void> {
        this.logger.info('audit', options);
        // If explicitly disabled for this operation or globally disabled, skip logging
        if (options.enabled === false || this.enabled === false) {
            return;
        }

        const auditEntry = {
            timestamp: new Date().toISOString(),
            ...options
        };

        try {
            this.logger.info('putLogEvents', auditEntry);
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