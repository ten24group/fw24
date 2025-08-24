import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';
import { EntityConfiguration } from 'electrodb';
import { BaseEntityService, DefaultEntityOperations, createElectroDBEntity, createEntitySchema, type EntityQuery } from '../../entity';
import { createLogger } from '../../logging';
import { AuditLoggerConfig, AuditOptions, IAuditLogger } from '../interfaces';
import { Controller, Service } from '../../decorators';
import { ExecutionContext } from '../../core/types/execution-context';

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
                        'identifiers',
                        'tenant',
                        'actor',
                        'entity',
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
        entity: {
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
        tenant: {
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
        gsi2: {
            index: 'gsi2',
            pk: {
                field: 'gsi2pk',
                composite: [ 'eventType' ]
            },
            sk: {
                field: 'gsi2sk',
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

@Service()
export class DynamoDBAuditEntityService extends BaseEntityService<AuditEntitySchemaType> {
    constructor() {
        super(DynamoDBAuditEntitySchema, DynamoDBAuditEntityConfiguration);
    }

    /**
     * Override the base list method to return latest audit records first
     * This ensures audit logs are displayed with most recent entries at the top
     * Uses GSI1 index for chronological sorting by timestampMs
     */
    public async list(query: EntityQuery<AuditEntitySchemaType> = {}, ctx?: ExecutionContext) {
        // Set default order to 'desc' for audit logs to show latest first
        // Allow override via query parameter if needed
        const modifiedQuery = {
            ...query,
            pagination: {
                ...query.pagination,
                order: 'desc' as const
            },
            // Use GSI3 index for chronological sorting
            // GSI3: PK = auditType (constant 'audit'), SK = timestampMs
            // This allows sorting all audit logs chronologically
            index: {
                name: 'gsi3',
                filters: {
                    auditType: 'audit'
                }
            }
        };

        return super.list(modifiedQuery, ctx);
    }
}

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
        const timestampMs = timestamp.getTime();

        const auditEntry = {
            timestamp: timestamp.toISOString(),
            timestampMs: timestampMs,
            auditType: 'audit',
            ...options.auditEntry,
            entityName: options.auditEntry?.entityName || 'unknown',
            eventType: options.auditEntry?.eventType || 'unknown',
        };

        try {

            this.logger.info('Writing to DynamoDB:', {
                auditEntry,
                DefaultDynamoDBAuditEntityConfiguration: DynamoDBAuditEntityConfiguration
            });

            const auditService = createElectroDBEntity({
                schema: DynamoDBAuditEntitySchema,
                entityConfigurations: DynamoDBAuditEntityConfiguration,
            });

            const result = await auditService.entity.create(auditEntry).go();
            this.logger.info('Successfully wrote to DynamoDB:', { result });

        } catch (error) {

            this.logger.error('Failed to write to DynamoDB:', error);
            throw error;
        }
    }
} 