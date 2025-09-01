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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEQ7QUFDMUQsbUNBQW9DO0FBRXBDLDBEQUE4RztBQUM5RywyQ0FBNkM7QUFHaEMsUUFBQSxnQ0FBZ0MsR0FBd0I7SUFDakUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxRQUFRLENBQUU7SUFDNUUsTUFBTSxFQUFFLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUM7Q0FDakMsQ0FBQztBQUVXLFFBQUEseUJBQXlCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUN4RCxLQUFLLEVBQUU7UUFDSCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxVQUFVO1FBQ2xCLGdCQUFnQixFQUFFLFdBQVc7UUFDN0IsZ0JBQWdCLEVBQUUscUNBQXVCO1FBQ3pDLE9BQU8sRUFBRSxVQUFVO1FBQ25CLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLG9CQUFvQixFQUFFLElBQUk7UUFDMUIscUJBQXFCLEVBQUU7WUFDbkIsT0FBTyxFQUFFO2dCQUNMO29CQUNJLFNBQVMsRUFBRSxDQUFDO29CQUNaLE1BQU0sRUFBRTt3QkFDSixTQUFTO3dCQUNULFdBQVc7d0JBQ1gsU0FBUzt3QkFDVCxTQUFTO3dCQUNULFlBQVk7d0JBQ1osVUFBVTt3QkFDVixXQUFXO3dCQUNYLFdBQVc7d0JBQ1gsU0FBUzt3QkFDVCxRQUFRO3dCQUNSLFNBQVM7d0JBQ1QsVUFBVTt3QkFDVixVQUFVO3dCQUNWLFdBQVc7d0JBQ1gsS0FBSzt3QkFDTCxTQUFTO3dCQUNULGVBQWU7d0JBQ2YsTUFBTTt3QkFDTixTQUFTO3dCQUNU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QUMsTUFBTSxDQUFDLElBQUksQ0FBQyxzQkFBc0IsRUFBRTtnQkFDckMsVUFBVTtnQkFDVix1Q0FBdUMsRUFBRSx3Q0FBZ0M7YUFDNUUsQ0FBQyxDQUFDO1lBRUgsTUFBTSxZQUFZLEdBQUcsSUFBQSxtQ0FBcUIsRUFBQztnQkFDdkMsTUFBTSxFQUFFLGlDQUF5QjtnQkFDakMsb0JBQW9CLEVBQUUsd0NBQWdDO2FBQ3pELENBQUMsQ0FBQztZQUVILE1BQU0sWUFBWSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUM7UUFDdEQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN6RCxNQUFNLEtBQUssQ0FBQztRQUNoQixDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBakRELGtEQWlEQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgRW50aXR5Q29uZmlndXJhdGlvbiB9IGZyb20gJ2VsZWN0cm9kYic7XG5pbXBvcnQgeyBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgY3JlYXRlRWxlY3Ryb0RCRW50aXR5LCBjcmVhdGVFbnRpdHlTY2hlbWEgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1lbnRpdHknO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBBdWRpdExvZ2dlckNvbmZpZywgQXVkaXRPcHRpb25zLCBJQXVkaXRMb2dnZXIgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcblxuZXhwb3J0IGNvbnN0IER5bmFtb0RCQXVkaXRFbnRpdHlDb25maWd1cmF0aW9uOiBFbnRpdHlDb25maWd1cmF0aW9uID0ge1xuICAgIHRhYmxlOiBwcm9jZXNzLmVudlsgYCR7cHJvY2Vzcy5lbnYuQVVESVRfVEFCTEVfTkFNRT8udG9VcHBlckNhc2UoKX1fVEFCTEVgIF0sXG4gICAgY2xpZW50OiBuZXcgRHluYW1vREJDbGllbnQoe30pLFxufTtcblxuZXhwb3J0IGNvbnN0IER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgIG1vZGVsOiB7XG4gICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgZW50aXR5OiAnYXVkaXRMb2cnLFxuICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAnYXVkaXRMb2dzJyxcbiAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIHNlcnZpY2U6ICdhdWRpdExvZycsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IHRydWUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU6IHRydWUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IHRydWUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5NZW51OiB0cnVlLFxuICAgICAgICB2aWV3UGFnZUNvbHVtbnNDb25maWc6IHtcbiAgICAgICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICAgICAgZmllbGRzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAnYXVkaXRJZCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnYXVkaXRUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdsb2dUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdWJUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbnRpdHlOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbnRpdHlJZCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZXZlbnRUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdvcGVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3NlcnZpY2UnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3N0YXR1cycsXG4gICAgICAgICAgICAgICAgICAgICAgICAnc3VjY2VzcycsXG4gICAgICAgICAgICAgICAgICAgICAgICAnc2V2ZXJpdHknLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2NhdGVnb3J5JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICd0aW1lc3RhbXAnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3R0bCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnYWN0b3JJZCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnY29ycmVsYXRpb25JZCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZGF0YScsXG4gICAgICAgICAgICAgICAgICAgICAgICAnbWV0cmljcycsXG4gICAgICAgICAgICAgICAgICAgICAgICAnYWN0b3InLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbnRleHQnLFxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgYXR0cmlidXRlczoge1xuICAgICAgICAvLyA9PT0gQ09SRSBJREVOVElGSUNBVElPTiA9PT1cbiAgICAgICAgYXVkaXRJZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICAgICAgaXNWaXNpYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNDcmVhdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNJZGVudGlmaWVyOiB0cnVlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gcmFuZG9tVVVJRCgpXG4gICAgICAgIH0sXG4gICAgICAgIGF1ZGl0VHlwZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gJ2F1ZGl0J1xuICAgICAgICB9LFxuICAgICAgICB0aW1lc3RhbXA6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgICB9LFxuICAgICAgICB0aW1lc3RhbXBNczoge1xuICAgICAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiBEYXRlLm5vdygpXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gQ0xBU1NJRklDQVRJT04gKEVuaGFuY2VkKSA9PT1cbiAgICAgICAgbG9nVHlwZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+ICdhdWRpdCcgLy8gJ2F1ZGl0JywgJ2xvZycsICdldmVudCcsICdtZXRyaWMnXG4gICAgICAgIH0sXG4gICAgICAgIHN1YlR5cGU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgc2V2ZXJpdHk6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiAnaW5mbycsIC8vICdpbmZvJywgJ3dhcm4nLCAnZXJyb3InLCAnY3JpdGljYWwnXG4gICAgICAgIH0sXG4gICAgICAgIGNhdGVnb3J5OiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IEVOVElUWS9SRVNPVVJDRSBUUkFDS0lORyA9PT1cbiAgICAgICAgZW50aXR5TmFtZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBlbnRpdHlJZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRUeXBlOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgb3BlcmF0aW9uOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJywgLy8gJ2NyZWF0ZScsICdyZWFkJywgJ3VwZGF0ZScsICdkZWxldGUnLCAnbG9naW4nLCAnc3luYydcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IFNFUlZJQ0UgQ09OVEVYVCA9PT1cbiAgICAgICAgc2VydmljZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsIC8vICd1c2VyLXNlcnZpY2UnLCAncGF5bWVudC1zZXJ2aWNlJywgJ2FwaS1nYXRld2F5J1xuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGV4dGVybmFsU3lzdGVtOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJywgLy8gJ3N0cmlwZScsICdzZW5kZ3JpZCcsICdnaXRodWInLCAnc2xhY2snXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgZXh0ZXJuYWxJZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBTVEFUVVMgJiBPVVRDT01FID09PVxuICAgICAgICBzdGF0dXM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLCAvLyAncGVuZGluZycsICdwcm9jZXNzaW5nJywgJ2NvbXBsZXRlZCcsICdmYWlsZWQnLCAnY2FuY2VsbGVkJ1xuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIHN1Y2Nlc3M6IHtcbiAgICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGlwQWRkcmVzczoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBNRVRSSUNTIChTdHJ1Y3R1cmVkIE9iamVjdCkgPT09XG4gICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBUUkFDS0lORyBJRHMgPT09XG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBBQ1RPUiBDT05URVhUID09PVxuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IEZMRVhJQkxFIERBVEEgQkxPQ0tTID09PVxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBMRUdBQ1kgU1VQUE9SVCA9PT1cbiAgICAgICAgaWRlbnRpZmllcnM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBDT01QVVRFRCBGSUVMRFMgRk9SIElOREVYSU5HID09PVxuICAgICAgICAvLyBUaGVzZSBhcmUgZGVyaXZlZCBmaWVsZHMgZm9yIG9wdGltaXplZCBxdWVyeWluZ1xuICAgICAgICBhY3RvcklkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgd2F0Y2g6IFsnYWN0b3InXSxcbiAgICAgICAgICAgIHNldDogKF8sIHsgYWN0b3IgfSkgPT4gYWN0b3I/LmFjdG9ySWQgfHwgdW5kZWZpbmVkXG4gICAgICAgIH0sXG4gICAgICAgIHRlbmFudElkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgd2F0Y2g6IFsnYWN0b3InXSxcbiAgICAgICAgICAgIHNldDogKF8sIHsgYWN0b3IgfSkgPT4gYWN0b3I/LnRlbmFudElkIHx8IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IFRUTCAoVGltZSBUbyBMaXZlKSA9PT1cbiAgICAgICAgLy8gRHluYW1vREIgVFRMIGZpZWxkIC0gYXV0b21hdGljYWxseSBkZWxldGVzIHJlY29yZHMgYWZ0ZXIgZXhwaXJhdGlvblxuICAgICAgICAvLyBEZWZhdWx0OiA5MCBkYXlzIGZyb20gY3JlYXRpb24sIGNhbiBiZSBvdmVycmlkZGVuIHBlciBhdWRpdCBlbnRyeVxuICAgICAgICB0dGw6IHtcbiAgICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBEZWZhdWx0IFRUTDogMzY1IGRheXMgZnJvbSBub3cgKGluIHNlY29uZHMpXG4gICAgICAgICAgICAgICAgY29uc3QgdHRsRGF5cyA9IHBhcnNlSW50KHByb2Nlc3MuZW52LkFVRElUX1RUTF9EQVlTIHx8ICczNjUnKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyAodHRsRGF5cyAqIDI0ICogNjAgKiA2MCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIGluZGV4ZXM6IHtcbiAgICAgICAgLy8gUHJpbWFyeSBpbmRleCAtIGF1ZGl0SWRcbiAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2F1ZGl0SWQnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogW11cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vIEdTSTEgLSBFbnRpdHktYmFzZWQgcXVlcmllcyAoZW50aXR5TmFtZSlcbiAgICAgICAgLy8gVXNhZ2U6IFRyYWNrIGFsbCBhY3Rpdml0aWVzIGZvciBzcGVjaWZpYyBlbnRpdGllc1xuICAgICAgICBnc2kxOiB7XG4gICAgICAgICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTFwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdlbnRpdHlOYW1lJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTFzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gR1NJMiAtIExvZyB0eXBlIGNsYXNzaWZpY2F0aW9uIChsb2dUeXBlIG9ubHkpXG4gICAgICAgIC8vIFVzYWdlOiBGaWx0ZXIgYnkgbG9nIHR5cGUgKHN1YlR5cGUgZmlsdGVyaW5nIGRvbmUgcG9zdC1xdWVyeSlcbiAgICAgICAgZ3NpMjoge1xuICAgICAgICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kycGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnbG9nVHlwZScgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kyc2snLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vIEdTSTMgLSBMb2cgdHlwZSBjbGFzc2lmaWNhdGlvbiAoYXVkaXRUeXBlIG9ubHkpXG4gICAgICAgIC8vIFVzYWdlOiBRdWVyeSBhbGwgYXVkaXQgbG9ncyBjaHJvbm9sb2dpY2FsbHlcbiAgICAgICAgZ3NpMzoge1xuICAgICAgICAgICAgaW5kZXg6ICdnc2kzJyxcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kzcGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnYXVkaXRUeXBlJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTNzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgIH1cbn0gYXMgY29uc3QpO1xuZXhwb3J0IHR5cGUgQXVkaXRFbnRpdHlTY2hlbWFUeXBlID0gdHlwZW9mIER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWE7XG5cbi8vIER5bmFtb0RCQXVkaXRFbnRpdHlTZXJ2aWNlIG1vdmVkIHRvIHNlcGFyYXRlIGZpbGUgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeVxuXG5leHBvcnQgY2xhc3MgRHluYW1vRGJBdWRpdExvZ2dlciBpbXBsZW1lbnRzIElBdWRpdExvZ2dlciB7XG4gICAgcHJpdmF0ZSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoRHluYW1vRGJBdWRpdExvZ2dlcik7XG4gICAgcHJpdmF0ZSBlbmFibGVkOiBib29sZWFuO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnOiBBdWRpdExvZ2dlckNvbmZpZykge1xuICAgICAgICB0aGlzLmVuYWJsZWQgPSBjb25maWcuZW5hYmxlZCA/PyBmYWxzZTtcbiAgICB9XG5cbiAgICBhc3luYyBhdWRpdChvcHRpb25zOiBBdWRpdE9wdGlvbnMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gSWYgZXhwbGljaXRseSBkaXNhYmxlZCBmb3IgdGhpcyBvcGVyYXRpb24gb3IgZ2xvYmFsbHkgZGlzYWJsZWQsIHNraXAgbG9nZ2luZ1xuICAgICAgICBpZiAob3B0aW9ucy5lbmFibGVkID09PSBmYWxzZSB8fCB0aGlzLmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVc2UgcHJvdmlkZWQgdGltZXN0YW1wIG9yIGdlbmVyYXRlIGZhbGxiYWNrXG4gICAgICAgIGNvbnN0IHByb3ZpZGVkVGltZXN0YW1wID0gb3B0aW9ucy5hdWRpdEVudHJ5Py50aW1lc3RhbXA7XG4gICAgICAgIGNvbnN0IHRpbWVzdGFtcERhdGUgPSBwcm92aWRlZFRpbWVzdGFtcCA/IG5ldyBEYXRlKHByb3ZpZGVkVGltZXN0YW1wKSA6IG5ldyBEYXRlKCk7XG4gICAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IHRpbWVzdGFtcERhdGUudG9JU09TdHJpbmcoKTtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wTXMgPSB0aW1lc3RhbXBEYXRlLmdldFRpbWUoKTtcblxuICAgICAgICBjb25zdCBhdWRpdEVudHJ5ID0ge1xuICAgICAgICAgICAgYXVkaXRUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgICAgdGltZXN0YW1wLFxuICAgICAgICAgICAgdGltZXN0YW1wTXMsXG4gICAgICAgICAgICAuLi5vcHRpb25zLmF1ZGl0RW50cnksXG4gICAgICAgICAgICAvLyBFbnN1cmUgcmVxdWlyZWQgZmllbGRzIGhhdmUgZGVmYXVsdHNcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnMuYXVkaXRFbnRyeT8uZW50aXR5TmFtZSB8fCAndW5rbm93bicsXG4gICAgICAgICAgICBldmVudFR5cGU6IG9wdGlvbnMuYXVkaXRFbnRyeT8uZXZlbnRUeXBlIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgIHNldmVyaXR5OiBvcHRpb25zLmF1ZGl0RW50cnk/LnNldmVyaXR5IHx8ICdpbmZvJyxcbiAgICAgICAgfTtcblxuICAgICAgICB0cnkge1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdXcml0aW5nIHRvIER5bmFtb0RCOicsIHtcbiAgICAgICAgICAgICAgICBhdWRpdEVudHJ5LFxuICAgICAgICAgICAgICAgIERlZmF1bHREeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvbjogRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb25cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBhdWRpdFNlcnZpY2UgPSBjcmVhdGVFbGVjdHJvREJFbnRpdHkoe1xuICAgICAgICAgICAgICAgIHNjaGVtYTogRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWd1cmF0aW9uczogRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgYXdhaXQgYXVkaXRTZXJ2aWNlLmVudGl0eS5jcmVhdGUoYXVkaXRFbnRyeSkuZ28oKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gd3JpdGUgdG8gRHluYW1vREI6JywgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG59ICJdfQ==