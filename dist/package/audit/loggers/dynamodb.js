"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDbAuditLogger = exports.DynamoDBAuditEntitySchema = exports.DynamoDBAuditEntityConfiguration = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const crypto_1 = require("crypto");
const entity_1 = require("../../entity");
const logging_1 = require("../../logging");
const client = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(client, {
    // to make sure missing stuff in audits does not cause errors
    marshallOptions: {
        convertClassInstanceToMap: true,
        removeUndefinedValues: true,
        convertEmptyValues: true,
    },
});
exports.DynamoDBAuditEntityConfiguration = {
    table: process.env[`${process.env.AUDIT_TABLE_NAME?.toUpperCase()}_TABLE`],
    client: docClient,
};
exports.DynamoDBAuditEntitySchema = (0, entity_1.createEntitySchema)({
    model: {
        version: '1',
        entity: 'auditLog',
        entityNamePlural: 'auditLogs',
        entityOperations: entity_1.DefaultEntityOperations,
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
            default: () => (0, crypto_1.randomUUID)()
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
                composite: ['auditId']
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
                composite: ['entityName']
            },
            sk: {
                field: 'gsi1sk',
                composite: ['timestampMs']
            }
        },
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
        }
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
            this.logger.debug('Writing to DynamoDB:', {
                auditEntry,
            });
            const auditService = (0, entity_1.createElectroDBEntity)({
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEQ7QUFDMUQsd0RBQStEO0FBQy9ELG1DQUFvQztBQUVwQyx5Q0FBa0c7QUFDbEcsMkNBQTZDO0FBRzdDLE1BQU0sTUFBTSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUV0QyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFDO0lBQ2pELDZEQUE2RDtJQUM3RCxlQUFlLEVBQUU7UUFDYix5QkFBeUIsRUFBRSxJQUFJO1FBQy9CLHFCQUFxQixFQUFFLElBQUk7UUFDM0Isa0JBQWtCLEVBQUUsSUFBSTtLQUMzQjtDQUNKLENBQUMsQ0FBQTtBQUVXLFFBQUEsZ0NBQWdDLEdBQXdCO0lBQ2pFLEtBQUssRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFFLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxXQUFXLEVBQUUsUUFBUSxDQUFFO0lBQzVFLE1BQU0sRUFBRSxTQUFTO0NBQ3BCLENBQUM7QUFFVyxRQUFBLHlCQUF5QixHQUFHLElBQUEsMkJBQWtCLEVBQUM7SUFDeEQsS0FBSyxFQUFFO1FBQ0gsT0FBTyxFQUFFLEdBQUc7UUFDWixNQUFNLEVBQUUsVUFBVTtRQUNsQixnQkFBZ0IsRUFBRSxXQUFXO1FBQzdCLGdCQUFnQixFQUFFLGdDQUF1QjtRQUN6QyxPQUFPLEVBQUUsVUFBVTtRQUNuQixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLHFCQUFxQixFQUFFO1lBQ25CLE9BQU8sRUFBRTtnQkFDTDtvQkFDSSxTQUFTLEVBQUUsQ0FBQztvQkFDWixNQUFNLEVBQUU7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QUUsT0FBTyxDQUFDLFVBQVUsRUFBRSxTQUFTLElBQUksU0FBUztZQUNyRCxRQUFRLEVBQUUsT0FBTyxDQUFDLFVBQVUsRUFBRSxRQUFRLElBQUksTUFBTTtTQUNuRCxDQUFDO1FBRUYsSUFBSSxDQUFDO1lBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsc0JBQXNCLEVBQUU7Z0JBQ3RDLFVBQVU7YUFDYixDQUFDLENBQUM7WUFFSCxNQUFNLFlBQVksR0FBRyxJQUFBLDhCQUFxQixFQUFDO2dCQUN2QyxNQUFNLEVBQUUsaUNBQXlCO2dCQUNqQyxvQkFBb0IsRUFBRSx3Q0FBZ0M7YUFDekQsQ0FBQyxDQUFDO1lBRUgsTUFBTSxZQUFZLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQztRQUN0RCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDhCQUE4QixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3pELE1BQU0sS0FBSyxDQUFDO1FBQ2hCLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUFoREQsa0RBZ0RDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCB9IGZyb20gXCJAYXdzLXNkay9saWItZHluYW1vZGJcIjtcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgRW50aXR5Q29uZmlndXJhdGlvbiB9IGZyb20gJ2VsZWN0cm9kYic7XG5pbXBvcnQgeyBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgY3JlYXRlRWxlY3Ryb0RCRW50aXR5LCBjcmVhdGVFbnRpdHlTY2hlbWEgfSBmcm9tICcuLi8uLi9lbnRpdHknO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBBdWRpdExvZ2dlckNvbmZpZywgQXVkaXRPcHRpb25zLCBJQXVkaXRMb2dnZXIgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcblxuY29uc3QgY2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcblxuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGNsaWVudCx7XG4gICAgLy8gdG8gbWFrZSBzdXJlIG1pc3Npbmcgc3R1ZmYgaW4gYXVkaXRzIGRvZXMgbm90IGNhdXNlIGVycm9yc1xuICAgIG1hcnNoYWxsT3B0aW9uczoge1xuICAgICAgICBjb252ZXJ0Q2xhc3NJbnN0YW5jZVRvTWFwOiB0cnVlLFxuICAgICAgICByZW1vdmVVbmRlZmluZWRWYWx1ZXM6IHRydWUsXG4gICAgICAgIGNvbnZlcnRFbXB0eVZhbHVlczogdHJ1ZSxcbiAgICB9LFxufSlcblxuZXhwb3J0IGNvbnN0IER5bmFtb0RCQXVkaXRFbnRpdHlDb25maWd1cmF0aW9uOiBFbnRpdHlDb25maWd1cmF0aW9uID0ge1xuICAgIHRhYmxlOiBwcm9jZXNzLmVudlsgYCR7cHJvY2Vzcy5lbnYuQVVESVRfVEFCTEVfTkFNRT8udG9VcHBlckNhc2UoKX1fVEFCTEVgIF0sXG4gICAgY2xpZW50OiBkb2NDbGllbnQsXG59O1xuXG5leHBvcnQgY29uc3QgRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgbW9kZWw6IHtcbiAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICBlbnRpdHk6ICdhdWRpdExvZycsXG4gICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICdhdWRpdExvZ3MnLFxuICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgc2VydmljZTogJ2F1ZGl0TG9nJyxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZTogdHJ1ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogdHJ1ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZTogdHJ1ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbk1lbnU6IHRydWUsXG4gICAgICAgIHZpZXdQYWdlQ29sdW1uc0NvbmZpZzoge1xuICAgICAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgICAgICBmaWVsZHM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICdhdWRpdElkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbnRpdHlOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdldmVudFR5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3RpbWVzdGFtcCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnc3VjY2VzcycsXG4gICAgICAgICAgICAgICAgICAgICAgICAnc2V2ZXJpdHknLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2lkZW50aWZpZXJzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdhY3RvcicsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZGF0YScsXG4gICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXVxuICAgICAgICB9XG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgIGF1ZGl0SWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgICAgIGlzVmlzaWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzQ3JlYXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKVxuICAgICAgICB9LFxuICAgICAgICBhdWRpdFR5cGU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+ICdhdWRpdCdcbiAgICAgICAgfSxcbiAgICAgICAgc3VjY2Vzczoge1xuICAgICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIHNldmVyaXR5OiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgLy8gJ2luZm8nLCAnd2FybicsICdlcnJvcicsICdjcml0aWNhbCdcbiAgICAgICAgfSxcbiAgICAgICAgZW50aXR5TmFtZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBldmVudFR5cGU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgdGltZXN0YW1wOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfSxcbiAgICAgICAgdGltZXN0YW1wTXM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KClcbiAgICAgICAgfSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBpZGVudGlmaWVyczoge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9XG4gICAgfSxcbiAgICBpbmRleGVzOiB7XG4gICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdhdWRpdElkJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ3NrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFtdXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGdzaTE6IHtcbiAgICAgICAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpMXBrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2VudGl0eU5hbWUnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpMXNrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG5cbiAgICAgICAgZ3NpMzoge1xuICAgICAgICAgICAgaW5kZXg6ICdnc2kzJyxcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kzcGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnYXVkaXRUeXBlJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTNzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufSBhcyBjb25zdCk7XG5leHBvcnQgdHlwZSBBdWRpdEVudGl0eVNjaGVtYVR5cGUgPSB0eXBlb2YgRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYTtcblxuLy8gRHluYW1vREJBdWRpdEVudGl0eVNlcnZpY2UgbW92ZWQgdG8gc2VwYXJhdGUgZmlsZSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5XG5cbmV4cG9ydCBjbGFzcyBEeW5hbW9EYkF1ZGl0TG9nZ2VyIGltcGxlbWVudHMgSUF1ZGl0TG9nZ2VyIHtcbiAgICBwcml2YXRlIGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihEeW5hbW9EYkF1ZGl0TG9nZ2VyKTtcbiAgICBwcml2YXRlIGVuYWJsZWQ6IGJvb2xlYW47XG5cbiAgICBjb25zdHJ1Y3Rvcihjb25maWc6IEF1ZGl0TG9nZ2VyQ29uZmlnKSB7XG4gICAgICAgIHRoaXMuZW5hYmxlZCA9IGNvbmZpZy5lbmFibGVkID8/IGZhbHNlO1xuICAgIH1cblxuICAgIGFzeW5jIGF1ZGl0KG9wdGlvbnM6IEF1ZGl0T3B0aW9ucyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICAvLyBJZiBleHBsaWNpdGx5IGRpc2FibGVkIGZvciB0aGlzIG9wZXJhdGlvbiBvciBnbG9iYWxseSBkaXNhYmxlZCwgc2tpcCBsb2dnaW5nXG4gICAgICAgIGlmIChvcHRpb25zLmVuYWJsZWQgPT09IGZhbHNlIHx8IHRoaXMuZW5hYmxlZCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVzZSBwcm92aWRlZCB0aW1lc3RhbXAgb3IgZ2VuZXJhdGUgZmFsbGJhY2tcbiAgICAgICAgY29uc3QgcHJvdmlkZWRUaW1lc3RhbXAgPSBvcHRpb25zLmF1ZGl0RW50cnk/LnRpbWVzdGFtcDtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wRGF0ZSA9IHByb3ZpZGVkVGltZXN0YW1wID8gbmV3IERhdGUocHJvdmlkZWRUaW1lc3RhbXApIDogbmV3IERhdGUoKTtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wID0gdGltZXN0YW1wRGF0ZS50b0lTT1N0cmluZygpO1xuICAgICAgICBjb25zdCB0aW1lc3RhbXBNcyA9IHRpbWVzdGFtcERhdGUuZ2V0VGltZSgpO1xuXG4gICAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSB7XG4gICAgICAgICAgICBhdWRpdFR5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgICB0aW1lc3RhbXAsXG4gICAgICAgICAgICB0aW1lc3RhbXBNcyxcbiAgICAgICAgICAgIC4uLm9wdGlvbnMuYXVkaXRFbnRyeSxcbiAgICAgICAgICAgIC8vIEVuc3VyZSByZXF1aXJlZCBmaWVsZHMgaGF2ZSBkZWZhdWx0c1xuICAgICAgICAgICAgZW50aXR5TmFtZTogb3B0aW9ucy5hdWRpdEVudHJ5Py5lbnRpdHlOYW1lIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgIGV2ZW50VHlwZTogb3B0aW9ucy5hdWRpdEVudHJ5Py5ldmVudFR5cGUgfHwgJ3Vua25vd24nLFxuICAgICAgICAgICAgc2V2ZXJpdHk6IG9wdGlvbnMuYXVkaXRFbnRyeT8uc2V2ZXJpdHkgfHwgJ2luZm8nLFxuICAgICAgICB9O1xuXG4gICAgICAgIHRyeSB7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdXcml0aW5nIHRvIER5bmFtb0RCOicsIHtcbiAgICAgICAgICAgICAgICBhdWRpdEVudHJ5LFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGF1ZGl0U2VydmljZSA9IGNyZWF0ZUVsZWN0cm9EQkVudGl0eSh7XG4gICAgICAgICAgICAgICAgc2NoZW1hOiBEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ3VyYXRpb25zOiBEeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCBhdWRpdFNlcnZpY2UuZW50aXR5LmNyZWF0ZShhdWRpdEVudHJ5KS5nbygpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byB3cml0ZSB0byBEeW5hbW9EQjonLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgIH1cbn0gIl19