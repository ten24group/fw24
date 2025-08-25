"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDbAuditLogger = exports.DynamoDBAuditEntitySchema = exports.DynamoDBAuditEntityConfiguration = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const crypto_1 = require("crypto");
const entity_1 = require("../../entity");
const logging_1 = require("../../logging");
exports.DynamoDBAuditEntityConfiguration = {
    table: process.env[`${process.env.AUDIT_TABLE_NAME?.toUpperCase()}_TABLE`],
    client: new client_dynamodb_1.DynamoDBClient({}),
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
            this.logger.info('Writing to DynamoDB:', {
                auditEntry,
                DefaultDynamoDBAuditEntityConfiguration: exports.DynamoDBAuditEntityConfiguration
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEQ7QUFDMUQsbUNBQW9DO0FBRXBDLHlDQUFrRztBQUNsRywyQ0FBNkM7QUFHaEMsUUFBQSxnQ0FBZ0MsR0FBd0I7SUFDakUsS0FBSyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxRQUFRLENBQUU7SUFDNUUsTUFBTSxFQUFFLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUM7Q0FDakMsQ0FBQztBQUVXLFFBQUEseUJBQXlCLEdBQUcsSUFBQSwyQkFBa0IsRUFBQztJQUN4RCxLQUFLLEVBQUU7UUFDSCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxVQUFVO1FBQ2xCLGdCQUFnQixFQUFFLFdBQVc7UUFDN0IsZ0JBQWdCLEVBQUUsZ0NBQXVCO1FBQ3pDLE9BQU8sRUFBRSxVQUFVO1FBQ25CLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLG9CQUFvQixFQUFFLElBQUk7UUFDMUIscUJBQXFCLEVBQUU7WUFDbkIsT0FBTyxFQUFFO2dCQUNMO29CQUNJLFNBQVMsRUFBRSxDQUFDO29CQUNaLE1BQU0sRUFBRTt3QkFDSixTQUFTO3dCQUNULFlBQVk7d0JBQ1osV0FBVzt3QkFDWCxXQUFXO3dCQUNYLFNBQVM7d0JBQ1QsVUFBVTt3QkFDVixhQUFhO3dCQUNiLE9BQU87d0JBQ1AsTUFBTTtxQkFDVDtpQkFDSjthQUNKO1NBQ0o7S0FDSjtJQUNELFVBQVUsRUFBRTtRQUNSLE9BQU8sRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7WUFDZCxRQUFRLEVBQUUsSUFB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O1lBRUgsTUFBTSxZQUFZLEdBQUcsSUFBQSw4QkFBcUIsRUFBQztnQkFDdkMsTUFBTSxFQUFFLGlDQUF5QjtnQkFDakMsb0JBQW9CLEVBQUUsd0NBQWdDO2FBQ3pELENBQUMsQ0FBQztZQUVILE1BQU0sWUFBWSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUM7UUFDdEQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN6RCxNQUFNLEtBQUssQ0FBQztRQUNoQixDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBakRELGtEQWlEQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgRW50aXR5Q29uZmlndXJhdGlvbiB9IGZyb20gJ2VsZWN0cm9kYic7XG5pbXBvcnQgeyBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgY3JlYXRlRWxlY3Ryb0RCRW50aXR5LCBjcmVhdGVFbnRpdHlTY2hlbWEgfSBmcm9tICcuLi8uLi9lbnRpdHknO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBBdWRpdExvZ2dlckNvbmZpZywgQXVkaXRPcHRpb25zLCBJQXVkaXRMb2dnZXIgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcblxuZXhwb3J0IGNvbnN0IER5bmFtb0RCQXVkaXRFbnRpdHlDb25maWd1cmF0aW9uOiBFbnRpdHlDb25maWd1cmF0aW9uID0ge1xuICAgIHRhYmxlOiBwcm9jZXNzLmVudlsgYCR7cHJvY2Vzcy5lbnYuQVVESVRfVEFCTEVfTkFNRT8udG9VcHBlckNhc2UoKX1fVEFCTEVgIF0sXG4gICAgY2xpZW50OiBuZXcgRHluYW1vREJDbGllbnQoe30pLFxufTtcblxuZXhwb3J0IGNvbnN0IER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgIG1vZGVsOiB7XG4gICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgZW50aXR5OiAnYXVkaXRMb2cnLFxuICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAnYXVkaXRMb2dzJyxcbiAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIHNlcnZpY2U6ICdhdWRpdExvZycsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IHRydWUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU6IHRydWUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IHRydWUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5NZW51OiB0cnVlLFxuICAgICAgICB2aWV3UGFnZUNvbHVtbnNDb25maWc6IHtcbiAgICAgICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICAgICAgZmllbGRzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAnYXVkaXRJZCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW50aXR5TmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZXZlbnRUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICd0aW1lc3RhbXAnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3N1Y2Nlc3MnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3NldmVyaXR5JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdpZGVudGlmaWVycycsXG4gICAgICAgICAgICAgICAgICAgICAgICAnYWN0b3InLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2RhdGEnLFxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgIH0sXG4gICAgYXR0cmlidXRlczoge1xuICAgICAgICBhdWRpdElkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgcmVhZE9ubHk6IHRydWUsXG4gICAgICAgICAgICBpc1Zpc2libGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0NyZWF0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiByYW5kb21VVUlEKClcbiAgICAgICAgfSxcbiAgICAgICAgYXVkaXRUeXBlOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiAnYXVkaXQnXG4gICAgICAgIH0sXG4gICAgICAgIHN1Y2Nlc3M6IHtcbiAgICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBzZXZlcml0eToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIC8vICdpbmZvJywgJ3dhcm4nLCAnZXJyb3InLCAnY3JpdGljYWwnXG4gICAgICAgIH0sXG4gICAgICAgIGVudGl0eU5hbWU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgZXZlbnRUeXBlOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVzdGFtcDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVzdGFtcE1zOiB7XG4gICAgICAgICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiBEYXRlLm5vdygpXG4gICAgICAgIH0sXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgaWRlbnRpZmllcnM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfVxuICAgIH0sXG4gICAgaW5kZXhlczoge1xuICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnYXVkaXRJZCcgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBnc2kxOiB7XG4gICAgICAgICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTFwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdlbnRpdHlOYW1lJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTFzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuXG4gICAgICAgIGdzaTM6IHtcbiAgICAgICAgICAgIGluZGV4OiAnZ3NpMycsXG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpM3BrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2F1ZGl0VHlwZScgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kzc2snLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0gYXMgY29uc3QpO1xuZXhwb3J0IHR5cGUgQXVkaXRFbnRpdHlTY2hlbWFUeXBlID0gdHlwZW9mIER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWE7XG5cbi8vIER5bmFtb0RCQXVkaXRFbnRpdHlTZXJ2aWNlIG1vdmVkIHRvIHNlcGFyYXRlIGZpbGUgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeVxuXG5leHBvcnQgY2xhc3MgRHluYW1vRGJBdWRpdExvZ2dlciBpbXBsZW1lbnRzIElBdWRpdExvZ2dlciB7XG4gICAgcHJpdmF0ZSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoRHluYW1vRGJBdWRpdExvZ2dlcik7XG4gICAgcHJpdmF0ZSBlbmFibGVkOiBib29sZWFuO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnOiBBdWRpdExvZ2dlckNvbmZpZykge1xuICAgICAgICB0aGlzLmVuYWJsZWQgPSBjb25maWcuZW5hYmxlZCA/PyBmYWxzZTtcbiAgICB9XG5cbiAgICBhc3luYyBhdWRpdChvcHRpb25zOiBBdWRpdE9wdGlvbnMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gSWYgZXhwbGljaXRseSBkaXNhYmxlZCBmb3IgdGhpcyBvcGVyYXRpb24gb3IgZ2xvYmFsbHkgZGlzYWJsZWQsIHNraXAgbG9nZ2luZ1xuICAgICAgICBpZiAob3B0aW9ucy5lbmFibGVkID09PSBmYWxzZSB8fCB0aGlzLmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVc2UgcHJvdmlkZWQgdGltZXN0YW1wIG9yIGdlbmVyYXRlIGZhbGxiYWNrXG4gICAgICAgIGNvbnN0IHByb3ZpZGVkVGltZXN0YW1wID0gb3B0aW9ucy5hdWRpdEVudHJ5Py50aW1lc3RhbXA7XG4gICAgICAgIGNvbnN0IHRpbWVzdGFtcERhdGUgPSBwcm92aWRlZFRpbWVzdGFtcCA/IG5ldyBEYXRlKHByb3ZpZGVkVGltZXN0YW1wKSA6IG5ldyBEYXRlKCk7XG4gICAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IHRpbWVzdGFtcERhdGUudG9JU09TdHJpbmcoKTtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wTXMgPSB0aW1lc3RhbXBEYXRlLmdldFRpbWUoKTtcblxuICAgICAgICBjb25zdCBhdWRpdEVudHJ5ID0ge1xuICAgICAgICAgICAgYXVkaXRUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgICAgdGltZXN0YW1wLFxuICAgICAgICAgICAgdGltZXN0YW1wTXMsXG4gICAgICAgICAgICAuLi5vcHRpb25zLmF1ZGl0RW50cnksXG4gICAgICAgICAgICAvLyBFbnN1cmUgcmVxdWlyZWQgZmllbGRzIGhhdmUgZGVmYXVsdHNcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnMuYXVkaXRFbnRyeT8uZW50aXR5TmFtZSB8fCAndW5rbm93bicsXG4gICAgICAgICAgICBldmVudFR5cGU6IG9wdGlvbnMuYXVkaXRFbnRyeT8uZXZlbnRUeXBlIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgIHNldmVyaXR5OiBvcHRpb25zLmF1ZGl0RW50cnk/LnNldmVyaXR5IHx8ICdpbmZvJyxcbiAgICAgICAgfTtcblxuICAgICAgICB0cnkge1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdXcml0aW5nIHRvIER5bmFtb0RCOicsIHtcbiAgICAgICAgICAgICAgICBhdWRpdEVudHJ5LFxuICAgICAgICAgICAgICAgIERlZmF1bHREeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvbjogRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb25cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBhdWRpdFNlcnZpY2UgPSBjcmVhdGVFbGVjdHJvREJFbnRpdHkoe1xuICAgICAgICAgICAgICAgIHNjaGVtYTogRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWd1cmF0aW9uczogRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgYXdhaXQgYXVkaXRTZXJ2aWNlLmVudGl0eS5jcmVhdGUoYXVkaXRFbnRyeSkuZ28oKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gd3JpdGUgdG8gRHluYW1vREI6JywgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG59ICJdfQ==