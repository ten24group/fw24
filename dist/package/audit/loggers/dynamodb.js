"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDbAuditLogger = exports.DynamoDBAuditEntityService = exports.DynamoDBAuditEntitySchema = exports.DynamoDBAuditEntityConfiguration = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const crypto_1 = require("crypto");
const entity_1 = require("../../entity");
const logging_1 = require("../../logging");
const decorators_1 = require("../../decorators");
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
            default: () => (0, crypto_1.randomUUID)()
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
        gsi2: {
            index: 'gsi2',
            pk: {
                field: 'gsi2pk',
                composite: ['eventType']
            },
            sk: {
                field: 'gsi2sk',
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
let DynamoDBAuditEntityService = class DynamoDBAuditEntityService extends entity_1.BaseEntityService {
    constructor() {
        super(exports.DynamoDBAuditEntitySchema, exports.DynamoDBAuditEntityConfiguration);
    }
    /**
     * Override the base list method to return latest audit records first
     * This ensures audit logs are displayed with most recent entries at the top
     * Uses GSI1 index for chronological sorting by timestampMs
     */
    async list(query = {}, ctx) {
        // Set default order to 'desc' for audit logs to show latest first
        // Allow override via query parameter if needed
        const modifiedQuery = {
            ...query,
            pagination: {
                ...query.pagination,
                order: 'desc'
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
};
exports.DynamoDBAuditEntityService = DynamoDBAuditEntityService;
exports.DynamoDBAuditEntityService = DynamoDBAuditEntityService = __decorate([
    (0, decorators_1.Service)()
], DynamoDBAuditEntityService);
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
                DefaultDynamoDBAuditEntityConfiguration: exports.DynamoDBAuditEntityConfiguration
            });
            const auditService = (0, entity_1.createElectroDBEntity)({
                schema: exports.DynamoDBAuditEntitySchema,
                entityConfigurations: exports.DynamoDBAuditEntityConfiguration,
            });
            const result = await auditService.entity.create(auditEntry).go();
            this.logger.info('Successfully wrote to DynamoDB:', { result });
        }
        catch (error) {
            this.logger.error('Failed to write to DynamoDB:', error);
            throw error;
        }
    }
}
exports.DynamoDbAuditLogger = DynamoDbAuditLogger;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFBQSw4REFBMEQ7QUFDMUQsbUNBQW9DO0FBRXBDLHlDQUF1STtBQUN2SSwyQ0FBNkM7QUFFN0MsaURBQXVEO0FBRzFDLFFBQUEsZ0NBQWdDLEdBQXdCO0lBQ2pFLEtBQUssRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFFLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxXQUFXLEVBQUUsUUFBUSxDQUFFO0lBQzVFLE1BQU0sRUFBRSxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDO0NBQ2pDLENBQUM7QUFFVyxRQUFBLHlCQUF5QixHQUFHLElBQUEsMkJBQWtCLEVBQUM7SUFDeEQsS0FBSyxFQUFFO1FBQ0gsT0FBTyxFQUFFLEdBQUc7UUFDWixNQUFNLEVBQUUsVUFBVTtRQUNsQixnQkFBZ0IsRUFBRSxXQUFXO1FBQzdCLGdCQUFnQixFQUFFLGdDQUF1QjtRQUN6QyxPQUFPLEVBQUUsVUFBVTtRQUNuQixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLHFCQUFxQixFQUFFO1lBQ25CLE9BQU8sRUFBRTtnQkFDTDtvQkFDSSxTQUFTLEVBQUUsQ0FBQztvQkFDWixNQUFNLEVBQUU7d0JBQ0osU0FBUzt3QkFDVCxZQUFZO3dCQUNaLFdBQVc7d0JBQ1gsV0FBVzt3QkFDWCxhQUFhO3dCQUNiLFFBQVE7d0JBQ1IsT0FBTzt3QkFDUCxRQUFRO3dCQUNSLE1BQU07cUJBQ1Q7aUJBQ0o7YUFDSjtTQUNKO0tBQ0o7SUFDRCxVQUFVLEVBQUU7UUFDUixPQUFPLEVBQUU7WUFDTCxJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxJQUFJ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QUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN6RCxNQUFNLEtBQUssQ0FBQztRQUNoQixDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBL0NELGtEQStDQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgRW50aXR5Q29uZmlndXJhdGlvbiB9IGZyb20gJ2VsZWN0cm9kYic7XG5pbXBvcnQgeyBCYXNlRW50aXR5U2VydmljZSwgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIGNyZWF0ZUVsZWN0cm9EQkVudGl0eSwgY3JlYXRlRW50aXR5U2NoZW1hLCB0eXBlIEVudGl0eVF1ZXJ5IH0gZnJvbSAnLi4vLi4vZW50aXR5JztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgQXVkaXRMb2dnZXJDb25maWcsIEF1ZGl0T3B0aW9ucywgSUF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBDb250cm9sbGVyLCBTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycyc7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5cbmV4cG9ydCBjb25zdCBEeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvbjogRW50aXR5Q29uZmlndXJhdGlvbiA9IHtcbiAgICB0YWJsZTogcHJvY2Vzcy5lbnZbIGAke3Byb2Nlc3MuZW52LkFVRElUX1RBQkxFX05BTUU/LnRvVXBwZXJDYXNlKCl9X1RBQkxFYCBdLFxuICAgIGNsaWVudDogbmV3IER5bmFtb0RCQ2xpZW50KHt9KSxcbn07XG5cbmV4cG9ydCBjb25zdCBEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICBtb2RlbDoge1xuICAgICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICAgIGVudGl0eTogJ2F1ZGl0TG9nJyxcbiAgICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ2F1ZGl0TG9ncycsXG4gICAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgICBzZXJ2aWNlOiAnYXVkaXRMb2cnLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiB0cnVlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiB0cnVlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluTWVudTogdHJ1ZSxcbiAgICAgICAgdmlld1BhZ2VDb2x1bW5zQ29uZmlnOiB7XG4gICAgICAgICAgICBjb2x1bW5zOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgICAgIGZpZWxkczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgJ2F1ZGl0SWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VudGl0eU5hbWUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2V2ZW50VHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAndGltZXN0YW1wJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdpZGVudGlmaWVycycsXG4gICAgICAgICAgICAgICAgICAgICAgICAndGVuYW50JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdhY3RvcicsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW50aXR5JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdkYXRhJyxcbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgYXVkaXRJZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICAgICAgaXNWaXNpYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNDcmVhdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNJZGVudGlmaWVyOiB0cnVlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gcmFuZG9tVVVJRCgpXG4gICAgICAgIH0sXG4gICAgICAgIGF1ZGl0VHlwZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gJ2F1ZGl0J1xuICAgICAgICB9LFxuICAgICAgICBlbnRpdHlOYW1lOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50VHlwZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICB0aW1lc3RhbXA6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgICB9LFxuICAgICAgICB0aW1lc3RhbXBNczoge1xuICAgICAgICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gRGF0ZS5ub3coKVxuICAgICAgICB9LFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGVudGl0eToge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICB0ZW5hbnQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgaWRlbnRpZmllcnM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfVxuICAgIH0sXG4gICAgaW5kZXhlczoge1xuICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnYXVkaXRJZCcgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBnc2kxOiB7XG4gICAgICAgICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTFwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdlbnRpdHlOYW1lJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTFzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBnc2kyOiB7XG4gICAgICAgICAgICBpbmRleDogJ2dzaTInLFxuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTJwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdldmVudFR5cGUnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpMnNrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGdzaTM6IHtcbiAgICAgICAgICAgIGluZGV4OiAnZ3NpMycsXG4gICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpM3BrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2F1ZGl0VHlwZScgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kzc2snLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0gYXMgY29uc3QpO1xuZXhwb3J0IHR5cGUgQXVkaXRFbnRpdHlTY2hlbWFUeXBlID0gdHlwZW9mIER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWE7XG5cbkBTZXJ2aWNlKClcbmV4cG9ydCBjbGFzcyBEeW5hbW9EQkF1ZGl0RW50aXR5U2VydmljZSBleHRlbmRzIEJhc2VFbnRpdHlTZXJ2aWNlPEF1ZGl0RW50aXR5U2NoZW1hVHlwZT4ge1xuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICBzdXBlcihEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hLCBEeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvbik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogT3ZlcnJpZGUgdGhlIGJhc2UgbGlzdCBtZXRob2QgdG8gcmV0dXJuIGxhdGVzdCBhdWRpdCByZWNvcmRzIGZpcnN0XG4gICAgICogVGhpcyBlbnN1cmVzIGF1ZGl0IGxvZ3MgYXJlIGRpc3BsYXllZCB3aXRoIG1vc3QgcmVjZW50IGVudHJpZXMgYXQgdGhlIHRvcFxuICAgICAqIFVzZXMgR1NJMSBpbmRleCBmb3IgY2hyb25vbG9naWNhbCBzb3J0aW5nIGJ5IHRpbWVzdGFtcE1zXG4gICAgICovXG4gICAgcHVibGljIGFzeW5jIGxpc3QocXVlcnk6IEVudGl0eVF1ZXJ5PEF1ZGl0RW50aXR5U2NoZW1hVHlwZT4gPSB7fSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICAvLyBTZXQgZGVmYXVsdCBvcmRlciB0byAnZGVzYycgZm9yIGF1ZGl0IGxvZ3MgdG8gc2hvdyBsYXRlc3QgZmlyc3RcbiAgICAgICAgLy8gQWxsb3cgb3ZlcnJpZGUgdmlhIHF1ZXJ5IHBhcmFtZXRlciBpZiBuZWVkZWRcbiAgICAgICAgY29uc3QgbW9kaWZpZWRRdWVyeSA9IHtcbiAgICAgICAgICAgIC4uLnF1ZXJ5LFxuICAgICAgICAgICAgcGFnaW5hdGlvbjoge1xuICAgICAgICAgICAgICAgIC4uLnF1ZXJ5LnBhZ2luYXRpb24sXG4gICAgICAgICAgICAgICAgb3JkZXI6ICdkZXNjJyBhcyBjb25zdFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIFVzZSBHU0kzIGluZGV4IGZvciBjaHJvbm9sb2dpY2FsIHNvcnRpbmdcbiAgICAgICAgICAgIC8vIEdTSTM6IFBLID0gYXVkaXRUeXBlIChjb25zdGFudCAnYXVkaXQnKSwgU0sgPSB0aW1lc3RhbXBNc1xuICAgICAgICAgICAgLy8gVGhpcyBhbGxvd3Mgc29ydGluZyBhbGwgYXVkaXQgbG9ncyBjaHJvbm9sb2dpY2FsbHlcbiAgICAgICAgICAgIGluZGV4OiB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ2dzaTMnLFxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgYXVkaXRUeXBlOiAnYXVkaXQnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiBzdXBlci5saXN0KG1vZGlmaWVkUXVlcnksIGN0eCk7XG4gICAgfVxufVxuXG5leHBvcnQgY2xhc3MgRHluYW1vRGJBdWRpdExvZ2dlciBpbXBsZW1lbnRzIElBdWRpdExvZ2dlciB7XG4gICAgcHJpdmF0ZSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoRHluYW1vRGJBdWRpdExvZ2dlcik7XG4gICAgcHJpdmF0ZSBlbmFibGVkOiBib29sZWFuO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnOiBBdWRpdExvZ2dlckNvbmZpZykge1xuICAgICAgICB0aGlzLmVuYWJsZWQgPSBjb25maWcuZW5hYmxlZCA/PyBmYWxzZTtcbiAgICB9XG5cbiAgICBhc3luYyBhdWRpdChvcHRpb25zOiBBdWRpdE9wdGlvbnMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gSWYgZXhwbGljaXRseSBkaXNhYmxlZCBmb3IgdGhpcyBvcGVyYXRpb24gb3IgZ2xvYmFsbHkgZGlzYWJsZWQsIHNraXAgbG9nZ2luZ1xuICAgICAgICBpZiAob3B0aW9ucy5lbmFibGVkID09PSBmYWxzZSB8fCB0aGlzLmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBjb25zdCB0aW1lc3RhbXBNcyA9IHRpbWVzdGFtcC5nZXRUaW1lKCk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogdGltZXN0YW1wLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICB0aW1lc3RhbXBNczogdGltZXN0YW1wTXMsXG4gICAgICAgICAgICBhdWRpdFR5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgICAuLi5vcHRpb25zLmF1ZGl0RW50cnksXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiBvcHRpb25zLmF1ZGl0RW50cnk/LmVudGl0eU5hbWUgfHwgJ3Vua25vd24nLFxuICAgICAgICAgICAgZXZlbnRUeXBlOiBvcHRpb25zLmF1ZGl0RW50cnk/LmV2ZW50VHlwZSB8fCAndW5rbm93bicsXG4gICAgICAgIH07XG5cbiAgICAgICAgdHJ5IHtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnV3JpdGluZyB0byBEeW5hbW9EQjonLCB7XG4gICAgICAgICAgICAgICAgYXVkaXRFbnRyeSxcbiAgICAgICAgICAgICAgICBEZWZhdWx0RHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb246IER5bmFtb0RCQXVkaXRFbnRpdHlDb25maWd1cmF0aW9uXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgYXVkaXRTZXJ2aWNlID0gY3JlYXRlRWxlY3Ryb0RCRW50aXR5KHtcbiAgICAgICAgICAgICAgICBzY2hlbWE6IER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWEsXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlndXJhdGlvbnM6IER5bmFtb0RCQXVkaXRFbnRpdHlDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGF1ZGl0U2VydmljZS5lbnRpdHkuY3JlYXRlKGF1ZGl0RW50cnkpLmdvKCk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdTdWNjZXNzZnVsbHkgd3JvdGUgdG8gRHluYW1vREI6JywgeyByZXN1bHQgfSk7XG5cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcblxuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byB3cml0ZSB0byBEeW5hbW9EQjonLCBlcnJvcik7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgIH1cbn0gIl19