import { createLogger } from '../../logging';
import { createAuditSchema } from '../schema/dynamodb';
import { AuditorConfig, AuditOptions, IAuditor } from '../interfaces';

export class DynamoDbAuditor implements IAuditor {
    private logger = createLogger('DynamoDbAuditor');
    private schema = createAuditSchema();
    private enabled: boolean;

    constructor(config: AuditorConfig) {
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
            ...options,
        };

        try {
            // TODO: Implement DynamoDB write using the schema
            // await this.schema.create(auditEntry).go();
        } catch (error) {
            this.logger.error('Failed to write to DynamoDB:', error);
            throw error;
        }
    }
} 