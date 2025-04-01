import { EntityConfiguration } from 'electrodb';
import { createElectroDBEntity } from '../../entity';
import { createLogger } from '../../logging';
import { AuditLoggerConfig, AuditOptions, IAuditLogger } from '../interfaces';
import { auditSchema } from '../schema/dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

export const AuditWorksDefaultEntityConfiguration: EntityConfiguration = {
  table: process.env[`${process.env.AUDIT_TABLE_NAME?.toUpperCase()}_TABLE`],
  client: new DynamoDBClient({}),
};

export class DynamoDbAuditLogger implements IAuditLogger {
  private logger = createLogger('DynamoDbAuditLogger');
  private enabled: boolean;

  constructor(config: AuditLoggerConfig) {
    this.enabled = config.enabled ?? false;
  }

  async audit(options: AuditOptions): Promise<void> {
    // If explicitly disabled for this operation or globally disabled, skip logging
    if (options.enabled === false || this.enabled === false) {
      return;
    }

    const timestamp = new Date();
    const auditEntry = {
      timestamp: timestamp.toISOString(),
      ...options.auditEntry,
      entityName: options.auditEntry?.entityName || 'unknown',
      eventType: options.auditEntry?.eventType || 'unknown',
    };

    try {
      this.logger.debug('Writing to DynamoDB:', { auditEntry, AuditWorksDefaultEntityConfiguration });
      const auditService = createElectroDBEntity({
        schema: auditSchema,
        entityConfigurations: AuditWorksDefaultEntityConfiguration,
      });
      await auditService.entity.create(auditEntry).go();
    } catch (error) {
      this.logger.error('Failed to write to DynamoDB:', error);
      throw error;
    }
  }
}
