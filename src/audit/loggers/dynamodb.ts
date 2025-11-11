import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from 'crypto';
import { EntityConfiguration } from 'electrodb';
import { DefaultEntityOperations, createElectroDBEntity, createEntitySchema } from '../../entity';
import { createLogger } from '../../logging';
import { AuditLoggerConfig, AuditOptions, IAuditLogger } from '../interfaces';

const client = new DynamoDBClient({});

const docClient = DynamoDBDocumentClient.from(client,{
    // to make sure missing stuff in audits does not cause errors
    marshallOptions: {
        convertClassInstanceToMap: true,
        removeUndefinedValues: true,
        convertEmptyValues: true,
    },
})

export const DynamoDBAuditEntityConfiguration: EntityConfiguration = {
    table: process.env[ `${process.env.AUDIT_TABLE_NAME?.toUpperCase()}_TABLE` ],
    client: docClient,
};

export const DynamoDBAuditEntitySchema = createEntitySchema({
    model: {
        version: '1',
        entity: 'auditLog',
        entityNamePlural: 'auditLogs',
        entityOperations: DefaultEntityOperations,
        service: 'auditLog',
        excludeFromAdminUpdate: true,
        excludeFromAdminCreate: true,
        excludeFromAdminDelete: true,
        excludeFromAdminMenu: true,
        viewPageColumnsConfig: {
            columns: [
                {
                    sortOrder: 1,
                    fields: [
                        'auditId',
                        'entityName',
                        'eventType',
                        'timestamp',
                        'success',
                        'severity',
                        'identifiers',
                        'actor',
                        'data',
                    ]
                },
            ]
        }
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
        auditType: {
            type: 'string',
            required: true,
            isEditable: false,
            default: () => 'audit'
        },
        success: {
            type: 'boolean',
            required: false,
            isEditable: false,
        },
        severity: {
            type: 'string',
            required: false,
            isEditable: false,
            // 'info', 'warn', 'error', 'critical'
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
        timestampMs: {
            type: 'number',
            required: true,
            isEditable: false,
            default: () => Date.now()
        },
        data: {
            type: 'any',
            required: false,
            isEditable: false,
            isListable: false,
        },
        actor: {
            type: 'any',
            required: false,
            isEditable: false,
            isListable: false,
        },
        identifiers: {
            type: 'any',
            required: false,
            isEditable: false,
            isListable: false,
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
        },
        gsi1: {
            index: 'gsi1',
            pk: {
                field: 'gsi1pk',
                composite: [ 'entityName' ]
            },
            sk: {
                field: 'gsi1sk',
                composite: [ 'timestampMs' ]
            }
        },

        gsi3: {
            index: 'gsi3',
            pk: {
                field: 'gsi3pk',
                composite: [ 'auditType' ]
            },
            sk: {
                field: 'gsi3sk',
                composite: [ 'timestampMs' ]
            }
        }
    }
} as const);
export type AuditEntitySchemaType = typeof DynamoDBAuditEntitySchema;

// DynamoDBAuditEntityService moved to separate file to avoid circular dependency

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

        // Use provided timestamp or generate fallback
        const providedTimestamp = options.auditEntry?.timestamp;
        const timestampDate = providedTimestamp ? new Date(providedTimestamp) : new Date();
        const timestamp = timestampDate.toISOString();
        const timestampMs = timestampDate.getTime();

        const auditEntry = {
            auditType: 'audit',
            timestamp,
            timestampMs,
            ...options.auditEntry,
            // Ensure required fields have defaults
            entityName: options.auditEntry?.entityName || 'unknown',
            eventType: options.auditEntry?.eventType || 'unknown',
            severity: options.auditEntry?.severity || 'info',
        };

        try {

            this.logger.debug('Writing to DynamoDB:', {
                auditEntry,
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