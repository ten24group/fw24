import { CloudWatchLogs, ResourceNotFoundException } from '@aws-sdk/client-cloudwatch-logs';
import { createLogger } from '../../logging';
import { AuditLoggerConfig, AuditOptions, IAuditLogger } from '../interfaces';

export class CloudWatchAuditLogger implements IAuditLogger {
  private client: CloudWatchLogs;
  private logGroupName: string;
  private logger = createLogger('CloudWatchAuditLogger');
  private enabled: boolean;

  constructor(config: AuditLoggerConfig) {
    this.enabled = config.enabled ?? false;
    this.client = new CloudWatchLogs({ region: config.region });
    this.logGroupName = config.logGroupName!;
  }

  async audit(options: AuditOptions): Promise<void> {
    this.logger.debug('audit', options);
    // If explicitly disabled for this operation or globally disabled, skip logging
    if (options.enabled === false || this.enabled === false) {
      return;
    }

    const auditEntry = {
      timestamp: new Date().toISOString(),
      ...options.auditEntry,
    };

    // Create a new log stream name for each month
    const date = new Date();
    const logStreamName = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    try {
      this.logger.debug('putLogEvents', auditEntry);
      await this.addLogEvents(logStreamName, auditEntry);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        await this.client.createLogStream({
          logGroupName: this.logGroupName,
          logStreamName,
        });
        try {
          await this.addLogEvents(logStreamName, auditEntry);
        } catch (error) {
          this.logger.error('Failed to write to CloudWatch:', error);
          throw error;
        }
      }
    }
  }

  private async addLogEvents(logStreamName: string, auditEntry: any) {
    await this.client.putLogEvents({
      logGroupName: this.logGroupName,
      logStreamName,
      logEvents: [
        {
          timestamp: Date.now(),
          message: JSON.stringify(auditEntry),
        },
      ],
    });
  }
}
