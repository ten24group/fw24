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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEQ7QUFDMUQsd0RBQStEO0FBQy9ELG1DQUFvQztBQUVwQyx5Q0FBa0c7QUFDbEcsMkNBQTZDO0FBRzdDLE1BQU0sTUFBTSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUV0QyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFDO0lBQ2pELDZEQUE2RDtJQUM3RCxlQUFlLEVBQUU7UUFDYix5QkFBeUIsRUFBRSxJQUFJO1FBQy9CLHFCQUFxQixFQUFFLElBQUk7UUFDM0Isa0JBQWtCLEVBQUUsSUFBSTtLQUMzQjtDQUNKLENBQUMsQ0FBQTtBQUVXLFFBQUEsZ0NBQWdDLEdBQXdCO0lBQ2pFLEtBQUssRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFFLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxXQUFXLEVBQUUsUUFBUSxDQUFFO0lBQzVFLE1BQU0sRUFBRSxTQUFTO0NBQ3BCLENBQUM7QUFFVyxRQUFBLHlCQUF5QixHQUFHLElBQUEsMkJBQWtCLEVBQUM7SUFDeEQsS0FBSyxFQUFFO1FBQ0gsT0FBTyxFQUFFLEdBQUc7UUFDWixNQUFNLEVBQUUsVUFBVTtRQUNsQixnQkFBZ0IsRUFBRSxXQUFXO1FBQzdCLGdCQUFnQixFQUFFLGdDQUF1QjtRQUN6QyxPQUFPLEVBQUUsVUFBVTtRQUNuQixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLHFCQUFxQixFQUFFO1lBQ25CLE9BQU8sRUFBRTtnQkFDTDtvQkFDSSxTQUFTLEVBQUUsQ0FBQztvQkFDWixNQUFNLEVBQUU7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QUUsT0FBTyxDQUFDLFVBQVUsRUFBRSxTQUFTLElBQUksU0FBUztZQUNyRCxRQUFRLEVBQUUsT0FBTyxDQUFDLFVBQVUsRUFBRSxRQUFRLElBQUksTUFBTTtTQUNuRCxDQUFDO1FBRUYsSUFBSSxDQUFDO1lBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsc0JBQXNCLEVBQUU7Z0JBQ3JDLFVBQVU7Z0JBQ1YsdUNBQXVDLEVBQUUsd0NBQWdDO2FBQzVFLENBQUMsQ0FBQztZQUVILE1BQU0sWUFBWSxHQUFHLElBQUEsOEJBQXFCLEVBQUM7Z0JBQ3ZDLE1BQU0sRUFBRSxpQ0FBeUI7Z0JBQ2pDLG9CQUFvQixFQUFFLHdDQUFnQzthQUN6RCxDQUFDLENBQUM7WUFFSCxNQUFNLFlBQVksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDO1FBQ3RELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDekQsTUFBTSxLQUFLLENBQUM7UUFDaEIsQ0FBQztJQUNMLENBQUM7Q0FDSjtBQWpERCxrREFpREMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50IH0gZnJvbSBcIkBhd3Mtc2RrL2xpYi1keW5hbW9kYlwiO1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSAnZWxlY3Ryb2RiJztcbmltcG9ydCB7IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBjcmVhdGVFbGVjdHJvREJFbnRpdHksIGNyZWF0ZUVudGl0eVNjaGVtYSB9IGZyb20gJy4uLy4uL2VudGl0eSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IEF1ZGl0TG9nZ2VyQ29uZmlnLCBBdWRpdE9wdGlvbnMsIElBdWRpdExvZ2dlciB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuXG5jb25zdCBjbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xuXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oY2xpZW50LHtcbiAgICAvLyB0byBtYWtlIHN1cmUgbWlzc2luZyBzdHVmZiBpbiBhdWRpdHMgZG9lcyBub3QgY2F1c2UgZXJyb3JzXG4gICAgbWFyc2hhbGxPcHRpb25zOiB7XG4gICAgICAgIGNvbnZlcnRDbGFzc0luc3RhbmNlVG9NYXA6IHRydWUsXG4gICAgICAgIHJlbW92ZVVuZGVmaW5lZFZhbHVlczogdHJ1ZSxcbiAgICAgICAgY29udmVydEVtcHR5VmFsdWVzOiB0cnVlLFxuICAgIH0sXG59KVxuXG5leHBvcnQgY29uc3QgRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb246IEVudGl0eUNvbmZpZ3VyYXRpb24gPSB7XG4gICAgdGFibGU6IHByb2Nlc3MuZW52WyBgJHtwcm9jZXNzLmVudi5BVURJVF9UQUJMRV9OQU1FPy50b1VwcGVyQ2FzZSgpfV9UQUJMRWAgXSxcbiAgICBjbGllbnQ6IGRvY0NsaWVudCxcbn07XG5cbmV4cG9ydCBjb25zdCBEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICBtb2RlbDoge1xuICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgIGVudGl0eTogJ2F1ZGl0TG9nJyxcbiAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ2F1ZGl0TG9ncycsXG4gICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICBzZXJ2aWNlOiAnYXVkaXRMb2cnLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiB0cnVlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiB0cnVlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluTWVudTogdHJ1ZSxcbiAgICAgICAgdmlld1BhZ2VDb2x1bW5zQ29uZmlnOiB7XG4gICAgICAgICAgICBjb2x1bW5zOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgICAgIGZpZWxkczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgJ2F1ZGl0SWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VudGl0eU5hbWUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2V2ZW50VHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAndGltZXN0YW1wJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdWNjZXNzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzZXZlcml0eScsXG4gICAgICAgICAgICAgICAgICAgICAgICAnaWRlbnRpZmllcnMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2FjdG9yJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdkYXRhJyxcbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgYXVkaXRJZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICAgICAgaXNWaXNpYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNDcmVhdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNJZGVudGlmaWVyOiB0cnVlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gcmFuZG9tVVVJRCgpXG4gICAgICAgIH0sXG4gICAgICAgIGF1ZGl0VHlwZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gJ2F1ZGl0J1xuICAgICAgICB9LFxuICAgICAgICBzdWNjZXNzOiB7XG4gICAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgc2V2ZXJpdHk6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICAvLyAnaW5mbycsICd3YXJuJywgJ2Vycm9yJywgJ2NyaXRpY2FsJ1xuICAgICAgICB9LFxuICAgICAgICBlbnRpdHlOYW1lOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50VHlwZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICB0aW1lc3RhbXA6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgICB9LFxuICAgICAgICB0aW1lc3RhbXBNczoge1xuICAgICAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gRGF0ZS5ub3coKVxuICAgICAgICB9LFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGlkZW50aWZpZXJzOiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH1cbiAgICB9LFxuICAgIGluZGV4ZXM6IHtcbiAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2F1ZGl0SWQnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogW11cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgZ3NpMToge1xuICAgICAgICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kxcGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnZW50aXR5TmFtZScgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kxc2snLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICBnc2kzOiB7XG4gICAgICAgICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTNwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdhdWRpdFR5cGUnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpM3NrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59IGFzIGNvbnN0KTtcbmV4cG9ydCB0eXBlIEF1ZGl0RW50aXR5U2NoZW1hVHlwZSA9IHR5cGVvZiBEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hO1xuXG4vLyBEeW5hbW9EQkF1ZGl0RW50aXR5U2VydmljZSBtb3ZlZCB0byBzZXBhcmF0ZSBmaWxlIHRvIGF2b2lkIGNpcmN1bGFyIGRlcGVuZGVuY3lcblxuZXhwb3J0IGNsYXNzIER5bmFtb0RiQXVkaXRMb2dnZXIgaW1wbGVtZW50cyBJQXVkaXRMb2dnZXIge1xuICAgIHByaXZhdGUgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKER5bmFtb0RiQXVkaXRMb2dnZXIpO1xuICAgIHByaXZhdGUgZW5hYmxlZDogYm9vbGVhbjtcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZzogQXVkaXRMb2dnZXJDb25maWcpIHtcbiAgICAgICAgdGhpcy5lbmFibGVkID0gY29uZmlnLmVuYWJsZWQgPz8gZmFsc2U7XG4gICAgfVxuXG4gICAgYXN5bmMgYXVkaXQob3B0aW9uczogQXVkaXRPcHRpb25zKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIElmIGV4cGxpY2l0bHkgZGlzYWJsZWQgZm9yIHRoaXMgb3BlcmF0aW9uIG9yIGdsb2JhbGx5IGRpc2FibGVkLCBza2lwIGxvZ2dpbmdcbiAgICAgICAgaWYgKG9wdGlvbnMuZW5hYmxlZCA9PT0gZmFsc2UgfHwgdGhpcy5lbmFibGVkID09PSBmYWxzZSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVXNlIHByb3ZpZGVkIHRpbWVzdGFtcCBvciBnZW5lcmF0ZSBmYWxsYmFja1xuICAgICAgICBjb25zdCBwcm92aWRlZFRpbWVzdGFtcCA9IG9wdGlvbnMuYXVkaXRFbnRyeT8udGltZXN0YW1wO1xuICAgICAgICBjb25zdCB0aW1lc3RhbXBEYXRlID0gcHJvdmlkZWRUaW1lc3RhbXAgPyBuZXcgRGF0ZShwcm92aWRlZFRpbWVzdGFtcCkgOiBuZXcgRGF0ZSgpO1xuICAgICAgICBjb25zdCB0aW1lc3RhbXAgPSB0aW1lc3RhbXBEYXRlLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIGNvbnN0IHRpbWVzdGFtcE1zID0gdGltZXN0YW1wRGF0ZS5nZXRUaW1lKCk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IHtcbiAgICAgICAgICAgIGF1ZGl0VHlwZTogJ2F1ZGl0JyxcbiAgICAgICAgICAgIHRpbWVzdGFtcCxcbiAgICAgICAgICAgIHRpbWVzdGFtcE1zLFxuICAgICAgICAgICAgLi4ub3B0aW9ucy5hdWRpdEVudHJ5LFxuICAgICAgICAgICAgLy8gRW5zdXJlIHJlcXVpcmVkIGZpZWxkcyBoYXZlIGRlZmF1bHRzXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiBvcHRpb25zLmF1ZGl0RW50cnk/LmVudGl0eU5hbWUgfHwgJ3Vua25vd24nLFxuICAgICAgICAgICAgZXZlbnRUeXBlOiBvcHRpb25zLmF1ZGl0RW50cnk/LmV2ZW50VHlwZSB8fCAndW5rbm93bicsXG4gICAgICAgICAgICBzZXZlcml0eTogb3B0aW9ucy5hdWRpdEVudHJ5Py5zZXZlcml0eSB8fCAnaW5mbycsXG4gICAgICAgIH07XG5cbiAgICAgICAgdHJ5IHtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnV3JpdGluZyB0byBEeW5hbW9EQjonLCB7XG4gICAgICAgICAgICAgICAgYXVkaXRFbnRyeSxcbiAgICAgICAgICAgICAgICBEZWZhdWx0RHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb246IER5bmFtb0RCQXVkaXRFbnRpdHlDb25maWd1cmF0aW9uXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgYXVkaXRTZXJ2aWNlID0gY3JlYXRlRWxlY3Ryb0RCRW50aXR5KHtcbiAgICAgICAgICAgICAgICBzY2hlbWE6IER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWEsXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlndXJhdGlvbnM6IER5bmFtb0RCQXVkaXRFbnRpdHlDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGF3YWl0IGF1ZGl0U2VydmljZS5lbnRpdHkuY3JlYXRlKGF1ZGl0RW50cnkpLmdvKCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHdyaXRlIHRvIER5bmFtb0RCOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxufSAiXX0=