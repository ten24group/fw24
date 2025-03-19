import { BaseEntityService } from '../../entity';
import { createLogger } from '../../logging';
import { AuditLoggerConfig, AuditOptions, IAuditLogger } from '../interfaces';
import { AuditSchemaType } from '../schema/dynamodb';

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
        };

        try {
            // TODO: Implement DynamoDB write using the schema
            // const auditService = BaseEntityService<AuditSchemaType>;
            // await auditService.create({auditEntry});
        } catch (error) {
            this.logger.error('Failed to write to DynamoDB:', error);
            throw error;
        }
    }
} 