import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';
import { EntityConfiguration } from 'electrodb';
import { DefaultEntityOperations, createElectroDBEntity, createEntitySchema } from '../../entity';
import { createLogger } from '../../logging';
import { AuditLoggerConfig, AuditOptions, IAuditLogger } from '../interfaces';

export const DynamoDBAuditEntityConfiguration: EntityConfiguration = {
    table: process.env[ `${process.env.AUDIT_TABLE_NAME?.toUpperCase()}_TABLE` ],
    client: new DynamoDBClient({}),
};

export const DynamoDBAuditEntitySchema = createEntitySchema({
    model: {
        version: '1',
        entity: 'auditLog',
        entityNamePlural: 'auditLogs',
        entityOperations: DefaultEntityOperations,
        service: 'auditLog'
    },
    attributes: {
        auditId: {
            type: 'string',
            required: true,
            readOnly: true,
            isVisible: false,
            isEditable: false,
            isCreatable: false,
            isIdentifier: true,
            default: () => randomUUID()
        },
        entityName: {
            type: 'string',
            required: true,
            isEditable: false,
        },
        eventType: {
            type: 'string',
            required: true,
            isEditable: false,
        },
        timestamp: {
            type: 'string',
            required: true,
            isEditable: false,
            default: () => new Date().toISOString()
        },
        data: {
            type: 'any',
            required: false,
            isEditable: false,
        },
        entity: {
            type: 'map',
            required: false,
            isEditable: false,
            properties: {
                '*': { type: 'any' }
            }
        },
        actor: {
            type: 'map',
            required: false,
            isEditable: false,
            properties: {
                '*': { type: 'any' }
            }
        },
        tenant: {
            type: 'map',
            required: false,
            isEditable: false,
            properties: {
                '*': { type: 'any' }
            }
        },
        identifiers: {
            type: 'map',
            required: false,
            isEditable: false,
            properties: {
                'id': { type: 'string' }
            }
        }
    },
    indexes: {
        primary: {
            pk: {
                field: 'pk',
                composite: [ 'auditId' ]
            },
            sk: {
                field: 'sk',
                composite: []
            }
        }
    }
});

export class DynamoDbAuditLogger implements IAuditLogger {
    private logger = createLogger(DynamoDbAuditLogger);
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

            this.logger.debug('Writing to DynamoDB:', {
                auditEntry,
                DefaultDynamoDBAuditEntityConfiguration: DynamoDBAuditEntityConfiguration
            });

            const auditService = createElectroDBEntity({
                schema: DynamoDBAuditEntitySchema,
                entityConfigurations: DynamoDBAuditEntityConfiguration,
            });

            await auditService.entity.create(auditEntry).go();

        } catch (error) {

            this.logger.error('Failed to write to DynamoDB:', error);
            throw error;
        }
    }
} 