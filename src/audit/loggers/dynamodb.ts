import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';
import { EntityConfiguration } from 'electrodb';
import { DefaultEntityOperations, createElectroDBEntity, createEntitySchema } from '../../entity/base-entity';
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
                        'auditType',
                        'logType',
                        'subType',
                        'entityName',
                        'entityId',
                        'eventType',
                        'operation',
                        'service',
                        'status',
                        'success',
                        'severity',
                        'category',
                        'timestamp',
                        'ttl',
                        'actorId',
                        'correlationId',
                        'data',
                        'metrics',
                        'actor',
                        'context',
                    ]
                },
            ]
        }
    },
    attributes: {
        // === CORE IDENTIFICATION ===
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
            isListable: false,
            default: () => Date.now()
        },
        
        // === CLASSIFICATION (Enhanced) ===
        logType: {
            type: 'string',
            required: false,
            isEditable: false,
            default: () => 'audit' // 'audit', 'log', 'event', 'metric'
        },
        subType: {
            type: 'string',
            required: false,
            isEditable: false,
            isListable: false,
        },
        severity: {
            type: 'string',
            required: false,
            isEditable: false,
            default: () => 'info', // 'info', 'warn', 'error', 'critical'
        },
        category: {
            type: 'string',
            required: false,
            isEditable: false,
        },
        
        // === ENTITY/RESOURCE TRACKING ===
        entityName: {
            type: 'string',
            required: true,
            isEditable: false,
        },
        entityId: {
            type: 'string',
            required: false,
            isEditable: false,
        },
        eventType: {
            type: 'string',
            required: true,
            isEditable: false,
            isListable: false,
        },
        operation: {
            type: 'string', // 'create', 'read', 'update', 'delete', 'login', 'sync'
            required: false,
            isEditable: false,
        },
        
        // === SERVICE CONTEXT ===
        service: {
            type: 'string', // 'user-service', 'payment-service', 'api-gateway'
            required: false,
            isEditable: false,
        },
        externalSystem: {
            type: 'string', // 'stripe', 'sendgrid', 'github', 'slack'
            required: false,
            isEditable: false,
        },
        externalId: {
            type: 'string',
            required: false,
            isEditable: false,
        },
        
        // === STATUS & OUTCOME ===
        status: {
            type: 'string', // 'pending', 'processing', 'completed', 'failed', 'cancelled'
            required: false,
            isEditable: false,
        },
        success: {
            type: 'boolean',
            required: false,
            isEditable: false,
            isListable: false,
        },
        ipAddress: {
            type: 'string',
            required: false,
            isEditable: false,
        },
        
        // === METRICS (Structured Object) ===
        metrics: {
            type: 'any',
            required: false,
            isEditable: false,
            isListable: false,
        },
        
        // === TRACKING IDs ===
        correlationId: {
            type: 'string',
            required: false,
            isEditable: false,
            isListable: false,
        },
        
        // === ACTOR CONTEXT ===
        actor: {
            type: 'any',
            required: false,
            isEditable: false,
            isListable: false,
        },
        
        // === FLEXIBLE DATA BLOCKS ===
        data: {
            type: 'any',
            required: false,
            isEditable: false,
            isListable: false,
        },
        metadata: {
            type: 'any',
            required: false,
            isEditable: false,
            isListable: false,
        },
        context: {
            type: 'any',
            required: false,
            isEditable: false,
            isListable: false,
        },
        
        // === LEGACY SUPPORT ===
        identifiers: {
            type: 'any',
            required: false,
            isEditable: false,
            isListable: false,
        },
        
        // === COMPUTED FIELDS FOR INDEXING ===
        // These are derived fields for optimized querying
        actorId: {
            type: 'string',
            required: false,
            isEditable: false,
            watch: ['actor'],
            set: (_, { actor }) => actor?.actorId || undefined
        },
        tenantId: {
            type: 'string',
            required: false,
            isEditable: false,
            watch: ['actor'],
            set: (_, { actor }) => actor?.tenantId || undefined
        },
        
        // === TTL (Time To Live) ===
        // DynamoDB TTL field - automatically deletes records after expiration
        // Default: 90 days from creation, can be overridden per audit entry
        ttl: {
            type: 'number',
            required: false,
            isEditable: false,
            isListable: false,
            default: () => {
                // Default TTL: 365 days from now (in seconds)
                const ttlDays = parseInt(process.env.AUDIT_TTL_DAYS || '365');
                return Math.floor(Date.now() / 1000) + (ttlDays * 24 * 60 * 60);
            }
        }
    },
    indexes: {
        // Primary index - auditId
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
        
        // GSI1 - Entity-based queries (entityName)
        // Usage: Track all activities for specific entities
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
        
        // GSI2 - Log type classification (logType only)
        // Usage: Filter by log type (subType filtering done post-query)
        gsi2: {
            index: 'gsi2',
            pk: {
                field: 'gsi2pk',
                composite: [ 'logType' ]
            },
            sk: {
                field: 'gsi2sk',
                composite: [ 'timestampMs' ]
            }
        },
        
        // GSI3 - Log type classification (auditType only)
        // Usage: Query all audit logs chronologically
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
        },
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

            this.logger.info('Writing to DynamoDB:', {
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