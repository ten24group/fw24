"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDbAuditLogger = exports.DynamoDBAuditEntitySchema = exports.DynamoDBAuditEntityConfiguration = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const crypto_1 = require("crypto");
const base_entity_1 = require("../../entity/base-entity");
const logging_1 = require("../../logging");
exports.DynamoDBAuditEntityConfiguration = {
    table: process.env[`${process.env.AUDIT_TABLE_NAME?.toUpperCase()}_TABLE`],
    client: new client_dynamodb_1.DynamoDBClient({}),
};
exports.DynamoDBAuditEntitySchema = (0, base_entity_1.createEntitySchema)({
    model: {
        version: '1',
        entity: 'auditLog',
        entityNamePlural: 'auditLogs',
        entityOperations: base_entity_1.DefaultEntityOperations,
        service: 'auditLog',
        excludeFromAdminUpdate: true,
        excludeFromAdminCreate: true,
        excludeFromAdminDelete: true,
        excludeFromAdminMenu: true,
        CRUDApiPath: '/system',
        search: {
            enabled: true,
            indexConfig: {
                primaryKey: 'auditId',
            }
        },
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
            default: () => (0, crypto_1.randomUUID)()
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
                composite: ['auditId']
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
                composite: ['entityName']
            },
            sk: {
                field: 'gsi1sk',
                composite: ['timestampMs']
            }
        },
        // GSI2 - Log type classification (logType only)
        // Usage: Filter by log type (subType filtering done post-query)
        gsi2: {
            index: 'gsi2',
            pk: {
                field: 'gsi2pk',
                composite: ['logType']
            },
            sk: {
                field: 'gsi2sk',
                composite: ['timestampMs']
            }
        },
        // GSI3 - Log type classification (auditType only)
        // Usage: Query all audit logs chronologically
        gsi3: {
            index: 'gsi3',
            pk: {
                field: 'gsi3pk',
                composite: ['auditType']
            },
            sk: {
                field: 'gsi3sk',
                composite: ['timestampMs']
            }
        },
    }
});
// DynamoDBAuditEntityService moved to separate file to avoid circular dependency
class DynamoDbAuditLogger {
    logger = (0, logging_1.createLogger)(DynamoDbAuditLogger);
    enabled;
    constructor(config) {
        this.enabled = config.enabled ?? false;
    }
    async audit(options) {
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
                DefaultDynamoDBAuditEntityConfiguration: exports.DynamoDBAuditEntityConfiguration
            });
            const auditService = (0, base_entity_1.createElectroDBEntity)({
                schema: exports.DynamoDBAuditEntitySchema,
                entityConfigurations: exports.DynamoDBAuditEntityConfiguration,
            });
            await auditService.entity.create(auditEntry).go();
        }
        catch (error) {
            this.logger.error('Failed to write to DynamoDB:', error);
            throw error;
        }
    }
}
exports.DynamoDbAuditLogger = DynamoDbAuditLogger;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEQ7QUFDMUQsbUNBQW9DO0FBRXBDLDBEQUE4RztBQUM5RywyQ0FBNkM7QUFHaEMsUUFBQSxnQ0FBZ0MsR0FBd0I7SUFDakUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxRQUFRLENBQUU7SUFDNUUsTUFBTSxFQUFFLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUM7Q0FDakMsQ0FBQztBQUVXLFFBQUEseUJBQXlCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUN4RCxLQUFLLEVBQUU7UUFDSCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxVQUFVO1FBQ2xCLGdCQUFnQixFQUFFLFdBQVc7UUFDN0IsZ0JBQWdCLEVBQUUscUNBQXVCO1FBQ3pDLE9BQU8sRUFBRSxVQUFVO1FBQ25CLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLG9CQUFvQixFQUFFLElBQUk7UUFDMUIsV0FBVyxFQUFFLFNBQVM7UUFDdEIsTUFBTSxFQUFFO1lBQ0osT0FBTyxFQUFFLElBQUk7WUFDYixXQUFXLEVBQUU7Z0JBQ1QsVUFBVSxFQUFFLFNBQVM7YUFDeEI7U0FDSjtRQUNELHFCQUFxQixFQUFFO1lBQ25CLE9BQU8sRUFBRTtnQkFDTDtvQkFDSSxTQUFTLEVBQUUsQ0FBQztvQkFDWixNQUFNLEVBQUU7d0JBQ0osU0FBUzt3QkFDVCxXQUFXO3dCQUNYLFNBQVM7d0JBQ1QsU0FBUzt3QkFDVCxZQUFZO3dCQUNaLFVBQVU7d0JBQ1YsV0FBVzt3QkFDWCxXQUFXO3dCQUNYLFNBQVM7d0JBQ1QsUUFBUTt3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QUFTLElBQUksU0FBUztZQUNyRCxRQUFRLEVBQUUsT0FBTyxDQUFDLFVBQVUsRUFBRSxRQUFRLElBQUksTUFBTTtTQUNuRCxDQUFDO1FBRUYsSUFBSSxDQUFDO1lBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsc0JBQXNCLEVBQUU7Z0JBQ3JDLFVBQVU7Z0JBQ1YsdUNBQXVDLEVBQUUsd0NBQWdDO2FBQzVFLENBQUMsQ0FBQztZQUVILE1BQU0sWUFBWSxHQUFHLElBQUEsbUNBQXFCLEVBQUM7Z0JBQ3ZDLE1BQU0sRUFBRSxpQ0FBeUI7Z0JBQ2pDLG9CQUFvQixFQUFFLHdDQUFnQzthQUN6RCxDQUFDLENBQUM7WUFFSCxNQUFNLFlBQVksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDO1FBQ3RELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDekQsTUFBTSxLQUFLLENBQUM7UUFDaEIsQ0FBQztJQUNMLENBQUM7Q0FDSjtBQWpERCxrREFpREMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IEVudGl0eUNvbmZpZ3VyYXRpb24gfSBmcm9tICdlbGVjdHJvZGInO1xuaW1wb3J0IHsgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIGNyZWF0ZUVsZWN0cm9EQkVudGl0eSwgY3JlYXRlRW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgQXVkaXRMb2dnZXJDb25maWcsIEF1ZGl0T3B0aW9ucywgSUF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5cbmV4cG9ydCBjb25zdCBEeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvbjogRW50aXR5Q29uZmlndXJhdGlvbiA9IHtcbiAgICB0YWJsZTogcHJvY2Vzcy5lbnZbIGAke3Byb2Nlc3MuZW52LkFVRElUX1RBQkxFX05BTUU/LnRvVXBwZXJDYXNlKCl9X1RBQkxFYCBdLFxuICAgIGNsaWVudDogbmV3IER5bmFtb0RCQ2xpZW50KHt9KSxcbn07XG5cbmV4cG9ydCBjb25zdCBEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICBtb2RlbDoge1xuICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgIGVudGl0eTogJ2F1ZGl0TG9nJyxcbiAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ2F1ZGl0TG9ncycsXG4gICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICBzZXJ2aWNlOiAnYXVkaXRMb2cnLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiB0cnVlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiB0cnVlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluTWVudTogdHJ1ZSxcbiAgICAgICAgQ1JVREFwaVBhdGg6ICcvc3lzdGVtJyxcbiAgICAgICAgc2VhcmNoOiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgaW5kZXhDb25maWc6IHtcbiAgICAgICAgICAgICAgICBwcmltYXJ5S2V5OiAnYXVkaXRJZCcsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHZpZXdQYWdlQ29sdW1uc0NvbmZpZzoge1xuICAgICAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgICAgICBmaWVsZHM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICdhdWRpdElkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdhdWRpdFR5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2xvZ1R5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3N1YlR5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VudGl0eU5hbWUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VudGl0eUlkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdldmVudFR5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ29wZXJhdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgICAnc2VydmljZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAnc3RhdHVzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdWNjZXNzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzZXZlcml0eScsXG4gICAgICAgICAgICAgICAgICAgICAgICAnY2F0ZWdvcnknLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3RpbWVzdGFtcCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAndHRsJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdhY3RvcklkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdjb3JyZWxhdGlvbklkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdkYXRhJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdtZXRyaWNzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdhY3RvcicsXG4gICAgICAgICAgICAgICAgICAgICAgICAnY29udGV4dCcsXG4gICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXVxuICAgICAgICB9XG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgIC8vID09PSBDT1JFIElERU5USUZJQ0FUSU9OID09PVxuICAgICAgICBhdWRpdElkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgcmVhZE9ubHk6IHRydWUsXG4gICAgICAgICAgICBpc1Zpc2libGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0NyZWF0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiByYW5kb21VVUlEKClcbiAgICAgICAgfSxcbiAgICAgICAgYXVkaXRUeXBlOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiAnYXVkaXQnXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVzdGFtcDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVzdGFtcE1zOiB7XG4gICAgICAgICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBDTEFTU0lGSUNBVElPTiAoRW5oYW5jZWQpID09PVxuICAgICAgICBsb2dUeXBlOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gJ2F1ZGl0JyAvLyAnYXVkaXQnLCAnbG9nJywgJ2V2ZW50JywgJ21ldHJpYydcbiAgICAgICAgfSxcbiAgICAgICAgc3ViVHlwZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBzZXZlcml0eToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+ICdpbmZvJywgLy8gJ2luZm8nLCAnd2FybicsICdlcnJvcicsICdjcml0aWNhbCdcbiAgICAgICAgfSxcbiAgICAgICAgY2F0ZWdvcnk6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gRU5USVRZL1JFU09VUkNFIFRSQUNLSU5HID09PVxuICAgICAgICBlbnRpdHlOYW1lOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGVudGl0eUlkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBldmVudFR5cGU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBvcGVyYXRpb246IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLCAvLyAnY3JlYXRlJywgJ3JlYWQnLCAndXBkYXRlJywgJ2RlbGV0ZScsICdsb2dpbicsICdzeW5jJ1xuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gU0VSVklDRSBDT05URVhUID09PVxuICAgICAgICBzZXJ2aWNlOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJywgLy8gJ3VzZXItc2VydmljZScsICdwYXltZW50LXNlcnZpY2UnLCAnYXBpLWdhdGV3YXknXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgZXh0ZXJuYWxTeXN0ZW06IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLCAvLyAnc3RyaXBlJywgJ3NlbmRncmlkJywgJ2dpdGh1YicsICdzbGFjaydcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBleHRlcm5hbElkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IFNUQVRVUyAmIE9VVENPTUUgPT09XG4gICAgICAgIHN0YXR1czoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsIC8vICdwZW5kaW5nJywgJ3Byb2Nlc3NpbmcnLCAnY29tcGxldGVkJywgJ2ZhaWxlZCcsICdjYW5jZWxsZWQnXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgc3VjY2Vzczoge1xuICAgICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgaXBBZGRyZXNzOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IE1FVFJJQ1MgKFN0cnVjdHVyZWQgT2JqZWN0KSA9PT1cbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IFRSQUNLSU5HIElEcyA9PT1cbiAgICAgICAgY29ycmVsYXRpb25JZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IEFDVE9SIENPTlRFWFQgPT09XG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gRkxFWElCTEUgREFUQSBCTE9DS1MgPT09XG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgY29udGV4dDoge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IExFR0FDWSBTVVBQT1JUID09PVxuICAgICAgICBpZGVudGlmaWVyczoge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IENPTVBVVEVEIEZJRUxEUyBGT1IgSU5ERVhJTkcgPT09XG4gICAgICAgIC8vIFRoZXNlIGFyZSBkZXJpdmVkIGZpZWxkcyBmb3Igb3B0aW1pemVkIHF1ZXJ5aW5nXG4gICAgICAgIGFjdG9ySWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICB3YXRjaDogWydhY3RvciddLFxuICAgICAgICAgICAgc2V0OiAoXywgeyBhY3RvciB9KSA9PiBhY3Rvcj8uYWN0b3JJZCB8fCB1bmRlZmluZWRcbiAgICAgICAgfSxcbiAgICAgICAgdGVuYW50SWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICB3YXRjaDogWydhY3RvciddLFxuICAgICAgICAgICAgc2V0OiAoXywgeyBhY3RvciB9KSA9PiBhY3Rvcj8udGVuYW50SWQgfHwgdW5kZWZpbmVkXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gVFRMIChUaW1lIFRvIExpdmUpID09PVxuICAgICAgICAvLyBEeW5hbW9EQiBUVEwgZmllbGQgLSBhdXRvbWF0aWNhbGx5IGRlbGV0ZXMgcmVjb3JkcyBhZnRlciBleHBpcmF0aW9uXG4gICAgICAgIC8vIERlZmF1bHQ6IDkwIGRheXMgZnJvbSBjcmVhdGlvbiwgY2FuIGJlIG92ZXJyaWRkZW4gcGVyIGF1ZGl0IGVudHJ5XG4gICAgICAgIHR0bDoge1xuICAgICAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIERlZmF1bHQgVFRMOiAzNjUgZGF5cyBmcm9tIG5vdyAoaW4gc2Vjb25kcylcbiAgICAgICAgICAgICAgICBjb25zdCB0dGxEYXlzID0gcGFyc2VJbnQocHJvY2Vzcy5lbnYuQVVESVRfVFRMX0RBWVMgfHwgJzM2NScpO1xuICAgICAgICAgICAgICAgIHJldHVybiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICh0dGxEYXlzICogMjQgKiA2MCAqIDYwKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgaW5kZXhlczoge1xuICAgICAgICAvLyBQcmltYXJ5IGluZGV4IC0gYXVkaXRJZFxuICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnYXVkaXRJZCcgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gR1NJMSAtIEVudGl0eS1iYXNlZCBxdWVyaWVzIChlbnRpdHlOYW1lKVxuICAgICAgICAvLyBVc2FnZTogVHJhY2sgYWxsIGFjdGl2aXRpZXMgZm9yIHNwZWNpZmljIGVudGl0aWVzXG4gICAgICAgIGdzaTE6IHtcbiAgICAgICAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpMXBrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2VudGl0eU5hbWUnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpMXNrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyBHU0kyIC0gTG9nIHR5cGUgY2xhc3NpZmljYXRpb24gKGxvZ1R5cGUgb25seSlcbiAgICAgICAgLy8gVXNhZ2U6IEZpbHRlciBieSBsb2cgdHlwZSAoc3ViVHlwZSBmaWx0ZXJpbmcgZG9uZSBwb3N0LXF1ZXJ5KVxuICAgICAgICBnc2kyOiB7XG4gICAgICAgICAgICBpbmRleDogJ2dzaTInLFxuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTJwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdsb2dUeXBlJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTJzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gR1NJMyAtIExvZyB0eXBlIGNsYXNzaWZpY2F0aW9uIChhdWRpdFR5cGUgb25seSlcbiAgICAgICAgLy8gVXNhZ2U6IFF1ZXJ5IGFsbCBhdWRpdCBsb2dzIGNocm9ub2xvZ2ljYWxseVxuICAgICAgICBnc2kzOiB7XG4gICAgICAgICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTNwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdhdWRpdFR5cGUnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpM3NrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgfVxufSBhcyBjb25zdCk7XG5leHBvcnQgdHlwZSBBdWRpdEVudGl0eVNjaGVtYVR5cGUgPSB0eXBlb2YgRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYTtcblxuLy8gRHluYW1vREJBdWRpdEVudGl0eVNlcnZpY2UgbW92ZWQgdG8gc2VwYXJhdGUgZmlsZSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5XG5cbmV4cG9ydCBjbGFzcyBEeW5hbW9EYkF1ZGl0TG9nZ2VyIGltcGxlbWVudHMgSUF1ZGl0TG9nZ2VyIHtcbiAgICBwcml2YXRlIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihEeW5hbW9EYkF1ZGl0TG9nZ2VyKTtcbiAgICBwcml2YXRlIGVuYWJsZWQ6IGJvb2xlYW47XG5cbiAgICBjb25zdHJ1Y3Rvcihjb25maWc6IEF1ZGl0TG9nZ2VyQ29uZmlnKSB7XG4gICAgICAgIHRoaXMuZW5hYmxlZCA9IGNvbmZpZy5lbmFibGVkID8/IGZhbHNlO1xuICAgIH1cblxuICAgIGFzeW5jIGF1ZGl0KG9wdGlvbnM6IEF1ZGl0T3B0aW9ucyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAvLyBJZiBleHBsaWNpdGx5IGRpc2FibGVkIGZvciB0aGlzIG9wZXJhdGlvbiBvciBnbG9iYWxseSBkaXNhYmxlZCwgc2tpcCBsb2dnaW5nXG4gICAgICAgIGlmIChvcHRpb25zLmVuYWJsZWQgPT09IGZhbHNlIHx8IHRoaXMuZW5hYmxlZCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVzZSBwcm92aWRlZCB0aW1lc3RhbXAgb3IgZ2VuZXJhdGUgZmFsbGJhY2tcbiAgICAgICAgY29uc3QgcHJvdmlkZWRUaW1lc3RhbXAgPSBvcHRpb25zLmF1ZGl0RW50cnk/LnRpbWVzdGFtcDtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wRGF0ZSA9IHByb3ZpZGVkVGltZXN0YW1wID8gbmV3IERhdGUocHJvdmlkZWRUaW1lc3RhbXApIDogbmV3IERhdGUoKTtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wID0gdGltZXN0YW1wRGF0ZS50b0lTT1N0cmluZygpO1xuICAgICAgICBjb25zdCB0aW1lc3RhbXBNcyA9IHRpbWVzdGFtcERhdGUuZ2V0VGltZSgpO1xuXG4gICAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSB7XG4gICAgICAgICAgICBhdWRpdFR5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgICB0aW1lc3RhbXAsXG4gICAgICAgICAgICB0aW1lc3RhbXBNcyxcbiAgICAgICAgICAgIC4uLm9wdGlvbnMuYXVkaXRFbnRyeSxcbiAgICAgICAgICAgIC8vIEVuc3VyZSByZXF1aXJlZCBmaWVsZHMgaGF2ZSBkZWZhdWx0c1xuICAgICAgICAgICAgZW50aXR5TmFtZTogb3B0aW9ucy5hdWRpdEVudHJ5Py5lbnRpdHlOYW1lIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgIGV2ZW50VHlwZTogb3B0aW9ucy5hdWRpdEVudHJ5Py5ldmVudFR5cGUgfHwgJ3Vua25vd24nLFxuICAgICAgICAgICAgc2V2ZXJpdHk6IG9wdGlvbnMuYXVkaXRFbnRyeT8uc2V2ZXJpdHkgfHwgJ2luZm8nLFxuICAgICAgICB9O1xuXG4gICAgICAgIHRyeSB7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1dyaXRpbmcgdG8gRHluYW1vREI6Jywge1xuICAgICAgICAgICAgICAgIGF1ZGl0RW50cnksXG4gICAgICAgICAgICAgICAgRGVmYXVsdER5bmFtb0RCQXVkaXRFbnRpdHlDb25maWd1cmF0aW9uOiBEeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvblxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGF1ZGl0U2VydmljZSA9IGNyZWF0ZUVsZWN0cm9EQkVudGl0eSh7XG4gICAgICAgICAgICAgICAgc2NoZW1hOiBEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zOiBEeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCBhdWRpdFNlcnZpY2UuZW50aXR5LmNyZWF0ZShhdWRpdEVudHJ5KS5nbygpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byB3cml0ZSB0byBEeW5hbW9EQjonLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgIH1cbn0gIl19