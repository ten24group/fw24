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
            type: 'map',
            required: false,
            isEditable: false,
            isListable: false,
            properties: {
                '*': { type: 'any' }
            }
        },
        actor: {
            type: 'map',
            required: false,
            isEditable: false,
            isListable: false,
            properties: {
                '*': { type: 'any' }
            }
        },
        tenant: {
            type: 'map',
            required: false,
            isEditable: false,
            isListable: false,
            properties: {
                '*': { type: 'any' }
            }
        },
        identifiers: {
            type: 'map',
            required: false,
            isEditable: false,
            isListable: false,
            properties: {
                'id': { type: 'string' }
            }
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
            this.logger.debug('Writing to DynamoDB:', {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFBQSw4REFBMEQ7QUFDMUQsbUNBQW9DO0FBRXBDLHlDQUF1STtBQUN2SSwyQ0FBNkM7QUFFN0MsaURBQXVEO0FBRzFDLFFBQUEsZ0NBQWdDLEdBQXdCO0lBQ2pFLEtBQUssRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFFLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxXQUFXLEVBQUUsUUFBUSxDQUFFO0lBQzVFLE1BQU0sRUFBRSxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDO0NBQ2pDLENBQUM7QUFFVyxRQUFBLHlCQUF5QixHQUFHLElBQUEsMkJBQWtCLEVBQUM7SUFDeEQsS0FBSyxFQUFFO1FBQ0gsT0FBTyxFQUFFLEdBQUc7UUFDWixNQUFNLEVBQUUsVUFBVTtRQUNsQixnQkFBZ0IsRUFBRSxXQUFXO1FBQzdCLGdCQUFnQixFQUFFLGdDQUF1QjtRQUN6QyxPQUFPLEVBQUUsVUFBVTtRQUNuQixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLHFCQUFxQixFQUFFO1lBQ25CLE9BQU8sRUFBRTtnQkFDTDtvQkFDSSxTQUFTLEVBQUUsQ0FBQztvQkFDWixNQUFNLEVBQUU7d0JBQ0osU0FBUzt3QkFDVCxZQUFZO3dCQUNaLFdBQVc7d0JBQ1gsV0FBVzt3QkFDWCxhQUFhO3dCQUNiLFFBQVE7d0JBQ1IsT0FBTzt3QkFDUCxRQUFRO3dCQUNSLE1BQU07cUJBQ1Q7aUJBQ0o7YUFDSjtTQUNKO0tBQ0o7SUFDRCxVQUFVLEVBQUU7UUFDUixPQUFPLEVBQUU7WUFDTCxJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxJQUFJ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Q0FBeUI7Z0JBQ2pDLG9CQUFvQixFQUFFLHdDQUFnQzthQUN6RCxDQUFDLENBQUM7WUFFSCxNQUFNLFlBQVksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDO1FBRXRELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBRWIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDekQsTUFBTSxLQUFLLENBQUM7UUFDaEIsQ0FBQztJQUNMLENBQUM7Q0FDSjtBQTlDRCxrREE4Q0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IEVudGl0eUNvbmZpZ3VyYXRpb24gfSBmcm9tICdlbGVjdHJvZGInO1xuaW1wb3J0IHsgQmFzZUVudGl0eVNlcnZpY2UsIERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBjcmVhdGVFbGVjdHJvREJFbnRpdHksIGNyZWF0ZUVudGl0eVNjaGVtYSwgdHlwZSBFbnRpdHlRdWVyeSB9IGZyb20gJy4uLy4uL2VudGl0eSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IEF1ZGl0TG9nZ2VyQ29uZmlnLCBBdWRpdE9wdGlvbnMsIElBdWRpdExvZ2dlciB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQ29udHJvbGxlciwgU2VydmljZSB9IGZyb20gJy4uLy4uL2RlY29yYXRvcnMnO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuXG5leHBvcnQgY29uc3QgRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb246IEVudGl0eUNvbmZpZ3VyYXRpb24gPSB7XG4gICAgdGFibGU6IHByb2Nlc3MuZW52WyBgJHtwcm9jZXNzLmVudi5BVURJVF9UQUJMRV9OQU1FPy50b1VwcGVyQ2FzZSgpfV9UQUJMRWAgXSxcbiAgICBjbGllbnQ6IG5ldyBEeW5hbW9EQkNsaWVudCh7fSksXG59O1xuXG5leHBvcnQgY29uc3QgRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgbW9kZWw6IHtcbiAgICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgICBlbnRpdHk6ICdhdWRpdExvZycsXG4gICAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICdhdWRpdExvZ3MnLFxuICAgICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAgICAgc2VydmljZTogJ2F1ZGl0TG9nJyxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZTogdHJ1ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogdHJ1ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZTogdHJ1ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbk1lbnU6IHRydWUsXG4gICAgICAgIHZpZXdQYWdlQ29sdW1uc0NvbmZpZzoge1xuICAgICAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgICAgICBmaWVsZHM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICdhdWRpdElkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdlbnRpdHlOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdldmVudFR5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3RpbWVzdGFtcCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnaWRlbnRpZmllcnMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3RlbmFudCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAnYWN0b3InLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2VudGl0eScsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZGF0YScsXG4gICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXVxuICAgICAgICB9XG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgIGF1ZGl0SWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgICAgIGlzVmlzaWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzQ3JlYXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKVxuICAgICAgICB9LFxuICAgICAgICBhdWRpdFR5cGU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+ICdhdWRpdCdcbiAgICAgICAgfSxcbiAgICAgICAgZW50aXR5TmFtZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBldmVudFR5cGU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgdGltZXN0YW1wOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfSxcbiAgICAgICAgdGltZXN0YW1wTXM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KClcbiAgICAgICAgfSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBlbnRpdHk6IHtcbiAgICAgICAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICAnKic6IHsgdHlwZTogJ2FueScgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgICAgdHlwZTogJ21hcCcsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICcqJzogeyB0eXBlOiAnYW55JyB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHRlbmFudDoge1xuICAgICAgICAgICAgdHlwZTogJ21hcCcsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICcqJzogeyB0eXBlOiAnYW55JyB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGlkZW50aWZpZXJzOiB7XG4gICAgICAgICAgICB0eXBlOiAnbWFwJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgJ2lkJzogeyB0eXBlOiAnc3RyaW5nJyB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIGluZGV4ZXM6IHtcbiAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2F1ZGl0SWQnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogW11cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgZ3NpMToge1xuICAgICAgICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kxcGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnZW50aXR5TmFtZScgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kxc2snLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgZ3NpMjoge1xuICAgICAgICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kycGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnZXZlbnRUeXBlJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTJzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBnc2kzOiB7XG4gICAgICAgICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTNwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdhdWRpdFR5cGUnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnZ3NpM3NrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59IGFzIGNvbnN0KTtcbmV4cG9ydCB0eXBlIEF1ZGl0RW50aXR5U2NoZW1hVHlwZSA9IHR5cGVvZiBEeW5hbW9EQkF1ZGl0RW50aXR5U2NoZW1hO1xuXG5AU2VydmljZSgpXG5leHBvcnQgY2xhc3MgRHluYW1vREJBdWRpdEVudGl0eVNlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTxBdWRpdEVudGl0eVNjaGVtYVR5cGU+IHtcbiAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgc3VwZXIoRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYSwgRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb24pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIE92ZXJyaWRlIHRoZSBiYXNlIGxpc3QgbWV0aG9kIHRvIHJldHVybiBsYXRlc3QgYXVkaXQgcmVjb3JkcyBmaXJzdFxuICAgICAqIFRoaXMgZW5zdXJlcyBhdWRpdCBsb2dzIGFyZSBkaXNwbGF5ZWQgd2l0aCBtb3N0IHJlY2VudCBlbnRyaWVzIGF0IHRoZSB0b3BcbiAgICAgKiBVc2VzIEdTSTEgaW5kZXggZm9yIGNocm9ub2xvZ2ljYWwgc29ydGluZyBieSB0aW1lc3RhbXBNc1xuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBsaXN0KHF1ZXJ5OiBFbnRpdHlRdWVyeTxBdWRpdEVudGl0eVNjaGVtYVR5cGU+ID0ge30sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgLy8gU2V0IGRlZmF1bHQgb3JkZXIgdG8gJ2Rlc2MnIGZvciBhdWRpdCBsb2dzIHRvIHNob3cgbGF0ZXN0IGZpcnN0XG4gICAgICAgIC8vIEFsbG93IG92ZXJyaWRlIHZpYSBxdWVyeSBwYXJhbWV0ZXIgaWYgbmVlZGVkXG4gICAgICAgIGNvbnN0IG1vZGlmaWVkUXVlcnkgPSB7XG4gICAgICAgICAgICAuLi5xdWVyeSxcbiAgICAgICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICAgICAgICAuLi5xdWVyeS5wYWdpbmF0aW9uLFxuICAgICAgICAgICAgICAgIG9yZGVyOiAnZGVzYycgYXMgY29uc3RcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBVc2UgR1NJMyBpbmRleCBmb3IgY2hyb25vbG9naWNhbCBzb3J0aW5nXG4gICAgICAgICAgICAvLyBHU0kzOiBQSyA9IGF1ZGl0VHlwZSAoY29uc3RhbnQgJ2F1ZGl0JyksIFNLID0gdGltZXN0YW1wTXNcbiAgICAgICAgICAgIC8vIFRoaXMgYWxsb3dzIHNvcnRpbmcgYWxsIGF1ZGl0IGxvZ3MgY2hyb25vbG9naWNhbGx5XG4gICAgICAgICAgICBpbmRleDoge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdnc2kzJyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIGF1ZGl0VHlwZTogJ2F1ZGl0J1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4gc3VwZXIubGlzdChtb2RpZmllZFF1ZXJ5LCBjdHgpO1xuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIER5bmFtb0RiQXVkaXRMb2dnZXIgaW1wbGVtZW50cyBJQXVkaXRMb2dnZXIge1xuICAgIHByaXZhdGUgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKER5bmFtb0RiQXVkaXRMb2dnZXIpO1xuICAgIHByaXZhdGUgZW5hYmxlZDogYm9vbGVhbjtcblxuICAgIGNvbnN0cnVjdG9yKGNvbmZpZzogQXVkaXRMb2dnZXJDb25maWcpIHtcbiAgICAgICAgdGhpcy5lbmFibGVkID0gY29uZmlnLmVuYWJsZWQgPz8gZmFsc2U7XG4gICAgfVxuXG4gICAgYXN5bmMgYXVkaXQob3B0aW9uczogQXVkaXRPcHRpb25zKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIC8vIElmIGV4cGxpY2l0bHkgZGlzYWJsZWQgZm9yIHRoaXMgb3BlcmF0aW9uIG9yIGdsb2JhbGx5IGRpc2FibGVkLCBza2lwIGxvZ2dpbmdcbiAgICAgICAgaWYgKG9wdGlvbnMuZW5hYmxlZCA9PT0gZmFsc2UgfHwgdGhpcy5lbmFibGVkID09PSBmYWxzZSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKTtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wTXMgPSB0aW1lc3RhbXAuZ2V0VGltZSgpO1xuXG4gICAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSB7XG4gICAgICAgICAgICB0aW1lc3RhbXA6IHRpbWVzdGFtcC50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgdGltZXN0YW1wTXM6IHRpbWVzdGFtcE1zLFxuICAgICAgICAgICAgYXVkaXRUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgICAgLi4ub3B0aW9ucy5hdWRpdEVudHJ5LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogb3B0aW9ucy5hdWRpdEVudHJ5Py5lbnRpdHlOYW1lIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgIGV2ZW50VHlwZTogb3B0aW9ucy5hdWRpdEVudHJ5Py5ldmVudFR5cGUgfHwgJ3Vua25vd24nLFxuICAgICAgICB9O1xuXG4gICAgICAgIHRyeSB7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdXcml0aW5nIHRvIER5bmFtb0RCOicsIHtcbiAgICAgICAgICAgICAgICBhdWRpdEVudHJ5LFxuICAgICAgICAgICAgICAgIERlZmF1bHREeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvbjogRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb25cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBhdWRpdFNlcnZpY2UgPSBjcmVhdGVFbGVjdHJvREJFbnRpdHkoe1xuICAgICAgICAgICAgICAgIHNjaGVtYTogRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWd1cmF0aW9uczogRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgYXdhaXQgYXVkaXRTZXJ2aWNlLmVudGl0eS5jcmVhdGUoYXVkaXRFbnRyeSkuZ28oKTtcblxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHdyaXRlIHRvIER5bmFtb0RCOicsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxufSAiXX0=