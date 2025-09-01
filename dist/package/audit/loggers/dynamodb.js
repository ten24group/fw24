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
                        'logType',
                        'subType',
                        'entityName',
                        'entityId',
                        'eventType',
                        'service',
                        'status',
                        'severity',
                        'timestamp',
                        'actor',
                        'correlationId',
                        'data',
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
            default: () => {
                // Default TTL: 90 days from now (in seconds)
                const ttlDays = parseInt(process.env.AUDIT_TTL_DAYS || '90');
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEQ7QUFDMUQsbUNBQW9DO0FBRXBDLDBEQUE4RztBQUM5RywyQ0FBNkM7QUFHaEMsUUFBQSxnQ0FBZ0MsR0FBd0I7SUFDakUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxRQUFRLENBQUU7SUFDNUUsTUFBTSxFQUFFLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUM7Q0FDakMsQ0FBQztBQUVXLFFBQUEseUJBQXlCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUN4RCxLQUFLLEVBQUU7UUFDSCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxVQUFVO1FBQ2xCLGdCQUFnQixFQUFFLFdBQVc7UUFDN0IsZ0JBQWdCLEVBQUUscUNBQXVCO1FBQ3pDLE9BQU8sRUFBRSxVQUFVO1FBQ25CLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLG9CQUFvQixFQUFFLElBQUk7UUFDMUIscUJBQXFCLEVBQUU7WUFDbkIsT0FBTyxFQUFFO2dCQUNMO29CQUNJLFNBQVMsRUFBRSxDQUFDO29CQUNaLE1BQU0sRUFBRTt3QkFDSixTQUFTO3dCQUNULFNBQVM7d0JBQ1QsU0FBUzt3QkFDVCxZQUFZO3dCQUNaLFVBQVU7d0JBQ1YsV0FBVzt3QkFDWCxTQUFTO3dCQUNULFFBQVE7d0JBQ1IsVUFBVTt3QkFDVixXQUFXO3dCQUNYLE9BQU87d0JBQ1AsZUFBZTt3QkFDZixNQUFNO3FCQUNUO2lCQUNKO2FBQ0o7U0FDSjtLQUNKO0lBQ0QsVUFBVSxFQUFFO1FBQ1IsOEJBQThCO1FBQzlCLE9BQU8sRUFBRTtZ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TSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQztRQUN0RCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDhCQUE4QixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3pELE1BQU0sS0FBSyxDQUFDO1FBQ2hCLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUFqREQsa0RBaURDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSAnZWxlY3Ryb2RiJztcbmltcG9ydCB7IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBjcmVhdGVFbGVjdHJvREJFbnRpdHksIGNyZWF0ZUVudGl0eVNjaGVtYSB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IEF1ZGl0TG9nZ2VyQ29uZmlnLCBBdWRpdE9wdGlvbnMsIElBdWRpdExvZ2dlciB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuXG5leHBvcnQgY29uc3QgRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb246IEVudGl0eUNvbmZpZ3VyYXRpb24gPSB7XG4gICAgdGFibGU6IHByb2Nlc3MuZW52WyBgJHtwcm9jZXNzLmVudi5BVURJVF9UQUJMRV9OQU1FPy50b1VwcGVyQ2FzZSgpfV9UQUJMRWAgXSxcbiAgICBjbGllbnQ6IG5ldyBEeW5hbW9EQkNsaWVudCh7fSksXG59O1xuXG5leHBvcnQgY29uc3QgRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgbW9kZWw6IHtcbiAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICBlbnRpdHk6ICdhdWRpdExvZycsXG4gICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICdhdWRpdExvZ3MnLFxuICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgc2VydmljZTogJ2F1ZGl0TG9nJyxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZTogdHJ1ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogdHJ1ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZTogdHJ1ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbk1lbnU6IHRydWUsXG4gICAgICAgIHZpZXdQYWdlQ29sdW1uc0NvbmZpZzoge1xuICAgICAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgICAgICBmaWVsZHM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICdhdWRpdElkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdsb2dUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdWJUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbnRpdHlOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbnRpdHlJZCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZXZlbnRUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzZXJ2aWNlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGF0dXMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3NldmVyaXR5JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICd0aW1lc3RhbXAnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2FjdG9yJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdjb3JyZWxhdGlvbklkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdkYXRhJyxcbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgLy8gPT09IENPUkUgSURFTlRJRklDQVRJT04gPT09XG4gICAgICAgIGF1ZGl0SWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgICAgIGlzVmlzaWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzQ3JlYXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKVxuICAgICAgICB9LFxuICAgICAgICBhdWRpdFR5cGU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+ICdhdWRpdCdcbiAgICAgICAgfSxcbiAgICAgICAgdGltZXN0YW1wOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfSxcbiAgICAgICAgdGltZXN0YW1wTXM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KClcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBDTEFTU0lGSUNBVElPTiAoRW5oYW5jZWQpID09PVxuICAgICAgICBsb2dUeXBlOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gJ2F1ZGl0JyAvLyAnYXVkaXQnLCAnbG9nJywgJ2V2ZW50JywgJ21ldHJpYydcbiAgICAgICAgfSxcbiAgICAgICAgc3ViVHlwZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgc2V2ZXJpdHk6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiAnaW5mbycsIC8vICdpbmZvJywgJ3dhcm4nLCAnZXJyb3InLCAnY3JpdGljYWwnXG4gICAgICAgIH0sXG4gICAgICAgIGNhdGVnb3J5OiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IEVOVElUWS9SRVNPVVJDRSBUUkFDS0lORyA9PT1cbiAgICAgICAgZW50aXR5TmFtZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBlbnRpdHlJZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRUeXBlOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIG9wZXJhdGlvbjoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsIC8vICdjcmVhdGUnLCAncmVhZCcsICd1cGRhdGUnLCAnZGVsZXRlJywgJ2xvZ2luJywgJ3N5bmMnXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBTRVJWSUNFIENPTlRFWFQgPT09XG4gICAgICAgIHNlcnZpY2U6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLCAvLyAndXNlci1zZXJ2aWNlJywgJ3BheW1lbnQtc2VydmljZScsICdhcGktZ2F0ZXdheSdcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBleHRlcm5hbFN5c3RlbToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsIC8vICdzdHJpcGUnLCAnc2VuZGdyaWQnLCAnZ2l0aHViJywgJ3NsYWNrJ1xuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGV4dGVybmFsSWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gU1RBVFVTICYgT1VUQ09NRSA9PT1cbiAgICAgICAgc3RhdHVzOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJywgLy8gJ3BlbmRpbmcnLCAncHJvY2Vzc2luZycsICdjb21wbGV0ZWQnLCAnZmFpbGVkJywgJ2NhbmNlbGxlZCdcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBzdWNjZXNzOiB7XG4gICAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgaXBBZGRyZXNzOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IE1FVFJJQ1MgKFN0cnVjdHVyZWQgT2JqZWN0KSA9PT1cbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IFRSQUNLSU5HIElEcyA9PT1cbiAgICAgICAgY29ycmVsYXRpb25JZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBBQ1RPUiBDT05URVhUID09PVxuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IEZMRVhJQkxFIERBVEEgQkxPQ0tTID09PVxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBMRUdBQ1kgU1VQUE9SVCA9PT1cbiAgICAgICAgaWRlbnRpZmllcnM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBDT01QVVRFRCBGSUVMRFMgRk9SIElOREVYSU5HID09PVxuICAgICAgICAvLyBUaGVzZSBhcmUgZGVyaXZlZCBmaWVsZHMgZm9yIG9wdGltaXplZCBxdWVyeWluZ1xuICAgICAgICBhY3RvcklkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgd2F0Y2g6IFsnYWN0b3InXSxcbiAgICAgICAgICAgIHNldDogKF8sIHsgYWN0b3IgfSkgPT4gYWN0b3I/LmFjdG9ySWQgfHwgdW5kZWZpbmVkXG4gICAgICAgIH0sXG4gICAgICAgIHRlbmFudElkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgd2F0Y2g6IFsnYWN0b3InXSxcbiAgICAgICAgICAgIHNldDogKF8sIHsgYWN0b3IgfSkgPT4gYWN0b3I/LnRlbmFudElkIHx8IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IFRUTCAoVGltZSBUbyBMaXZlKSA9PT1cbiAgICAgICAgLy8gRHluYW1vREIgVFRMIGZpZWxkIC0gYXV0b21hdGljYWxseSBkZWxldGVzIHJlY29yZHMgYWZ0ZXIgZXhwaXJhdGlvblxuICAgICAgICAvLyBEZWZhdWx0OiA5MCBkYXlzIGZyb20gY3JlYXRpb24sIGNhbiBiZSBvdmVycmlkZGVuIHBlciBhdWRpdCBlbnRyeVxuICAgICAgICB0dGw6IHtcbiAgICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gRGVmYXVsdCBUVEw6IDkwIGRheXMgZnJvbSBub3cgKGluIHNlY29uZHMpXG4gICAgICAgICAgICAgICAgY29uc3QgdHRsRGF5cyA9IHBhcnNlSW50KHByb2Nlc3MuZW52LkFVRElUX1RUTF9EQVlTIHx8ICc5MCcpO1xuICAgICAgICAgICAgICAgIHJldHVybiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICh0dGxEYXlzICogMjQgKiA2MCAqIDYwKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgaW5kZXhlczoge1xuICAgICAgICAvLyBQcmltYXJ5IGluZGV4IC0gYXVkaXRJZFxuICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnYXVkaXRJZCcgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gR1NJMSAtIEVudGl0eS1iYXNlZCBxdWVyaWVzIChlbnRpdHlOYW1lKVxuICAgICAgICAvLyBVc2FnZTogVHJhY2sgYWxsIGFjdGl2aXRpZXMgZm9yIHNwZWNpZmljIGVudGl0aWVzXG4gICAgICAgIGdzaTE6IHtcbiAgICAgICAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpMXBrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2VudGl0eU5hbWUnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpMXNrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyBHU0kyIC0gTG9nIHR5cGUgY2xhc3NpZmljYXRpb24gKGxvZ1R5cGUgb25seSlcbiAgICAgICAgLy8gVXNhZ2U6IEZpbHRlciBieSBsb2cgdHlwZSAoc3ViVHlwZSBmaWx0ZXJpbmcgZG9uZSBwb3N0LXF1ZXJ5KVxuICAgICAgICBnc2kyOiB7XG4gICAgICAgICAgICBpbmRleDogJ2dzaTInLFxuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTJwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdsb2dUeXBlJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTJzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gR1NJMyAtIExvZyB0eXBlIGNsYXNzaWZpY2F0aW9uIChhdWRpdFR5cGUgb25seSlcbiAgICAgICAgLy8gVXNhZ2U6IFF1ZXJ5IGFsbCBhdWRpdCBsb2dzIGNocm9ub2xvZ2ljYWxseVxuICAgICAgICBnc2kzOiB7XG4gICAgICAgICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTNwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdhdWRpdFR5cGUnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpM3NrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgfVxufSBhcyBjb25zdCk7XG5leHBvcnQgdHlwZSBBdWRpdEVudGl0eVNjaGVtYVR5cGUgPSB0eXBlb2YgRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYTtcblxuLy8gRHluYW1vREJBdWRpdEVudGl0eVNlcnZpY2UgbW92ZWQgdG8gc2VwYXJhdGUgZmlsZSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5XG5cbmV4cG9ydCBjbGFzcyBEeW5hbW9EYkF1ZGl0TG9nZ2VyIGltcGxlbWVudHMgSUF1ZGl0TG9nZ2VyIHtcbiAgICBwcml2YXRlIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihEeW5hbW9EYkF1ZGl0TG9nZ2VyKTtcbiAgICBwcml2YXRlIGVuYWJsZWQ6IGJvb2xlYW47XG5cbiAgICBjb25zdHJ1Y3Rvcihjb25maWc6IEF1ZGl0TG9nZ2VyQ29uZmlnKSB7XG4gICAgICAgIHRoaXMuZW5hYmxlZCA9IGNvbmZpZy5lbmFibGVkID8/IGZhbHNlO1xuICAgIH1cblxuICAgIGFzeW5jIGF1ZGl0KG9wdGlvbnM6IEF1ZGl0T3B0aW9ucyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAvLyBJZiBleHBsaWNpdGx5IGRpc2FibGVkIGZvciB0aGlzIG9wZXJhdGlvbiBvciBnbG9iYWxseSBkaXNhYmxlZCwgc2tpcCBsb2dnaW5nXG4gICAgICAgIGlmIChvcHRpb25zLmVuYWJsZWQgPT09IGZhbHNlIHx8IHRoaXMuZW5hYmxlZCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVzZSBwcm92aWRlZCB0aW1lc3RhbXAgb3IgZ2VuZXJhdGUgZmFsbGJhY2tcbiAgICAgICAgY29uc3QgcHJvdmlkZWRUaW1lc3RhbXAgPSBvcHRpb25zLmF1ZGl0RW50cnk/LnRpbWVzdGFtcDtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wRGF0ZSA9IHByb3ZpZGVkVGltZXN0YW1wID8gbmV3IERhdGUocHJvdmlkZWRUaW1lc3RhbXApIDogbmV3IERhdGUoKTtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wID0gdGltZXN0YW1wRGF0ZS50b0lTT1N0cmluZygpO1xuICAgICAgICBjb25zdCB0aW1lc3RhbXBNcyA9IHRpbWVzdGFtcERhdGUuZ2V0VGltZSgpO1xuXG4gICAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSB7XG4gICAgICAgICAgICBhdWRpdFR5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgICB0aW1lc3RhbXAsXG4gICAgICAgICAgICB0aW1lc3RhbXBNcyxcbiAgICAgICAgICAgIC4uLm9wdGlvbnMuYXVkaXRFbnRyeSxcbiAgICAgICAgICAgIC8vIEVuc3VyZSByZXF1aXJlZCBmaWVsZHMgaGF2ZSBkZWZhdWx0c1xuICAgICAgICAgICAgZW50aXR5TmFtZTogb3B0aW9ucy5hdWRpdEVudHJ5Py5lbnRpdHlOYW1lIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgIGV2ZW50VHlwZTogb3B0aW9ucy5hdWRpdEVudHJ5Py5ldmVudFR5cGUgfHwgJ3Vua25vd24nLFxuICAgICAgICAgICAgc2V2ZXJpdHk6IG9wdGlvbnMuYXVkaXRFbnRyeT8uc2V2ZXJpdHkgfHwgJ2luZm8nLFxuICAgICAgICB9O1xuXG4gICAgICAgIHRyeSB7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1dyaXRpbmcgdG8gRHluYW1vREI6Jywge1xuICAgICAgICAgICAgICAgIGF1ZGl0RW50cnksXG4gICAgICAgICAgICAgICAgRGVmYXVsdER5bmFtb0RCQXVkaXRFbnRpdHlDb25maWd1cmF0aW9uOiBEeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvblxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGF1ZGl0U2VydmljZSA9IGNyZWF0ZUVsZWN0cm9EQkVudGl0eSh7XG4gICAgICAgICAgICAgICAgc2NoZW1hOiBEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zOiBEeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCBhdWRpdFNlcnZpY2UuZW50aXR5LmNyZWF0ZShhdWRpdEVudHJ5KS5nbygpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byB3cml0ZSB0byBEeW5hbW9EQjonLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgIH1cbn0gIl19