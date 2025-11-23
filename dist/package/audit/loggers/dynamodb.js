"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDbAuditLogger = exports.DynamoDBAuditEntitySchema = exports.DynamoDBAuditEntityConfiguration = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const crypto_1 = require("crypto");
const base_entity_1 = require("../../entity/base-entity");
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
            this.logger.debug('Writing to DynamoDB:', {
                auditEntry,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvbG9nZ2Vycy9keW5hbW9kYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEQ7QUFDMUQsd0RBQStEO0FBQy9ELG1DQUFvQztBQUVwQywwREFBOEc7QUFDOUcsMkNBQTZDO0FBRzdDLE1BQU0sTUFBTSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUV0QyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFDO0lBQ2pELDZEQUE2RDtJQUM3RCxlQUFlLEVBQUU7UUFDYix5QkFBeUIsRUFBRSxJQUFJO1FBQy9CLHFCQUFxQixFQUFFLElBQUk7UUFDM0Isa0JBQWtCLEVBQUUsSUFBSTtLQUMzQjtDQUNKLENBQUMsQ0FBQTtBQUVXLFFBQUEsZ0NBQWdDLEdBQXdCO0lBQ2pFLEtBQUssRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFFLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxXQUFXLEVBQUUsUUFBUSxDQUFFO0lBQzVFLE1BQU0sRUFBRSxTQUFTO0NBQ3BCLENBQUM7QUFFVyxRQUFBLHlCQUF5QixHQUFHLElBQUEsZ0NBQWtCLEVBQUM7SUFDeEQsS0FBSyxFQUFFO1FBQ0gsT0FBTyxFQUFFLEdBQUc7UUFDWixNQUFNLEVBQUUsVUFBVTtRQUNsQixnQkFBZ0IsRUFBRSxXQUFXO1FBQzdCLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6QyxPQUFPLEVBQUUsVUFBVTtRQUNuQixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLFdBQVcsRUFBRSxTQUFTO1FBQ3RCLE1BQU0sRUFBRTtZQUNKLE9BQU8sRUFBRSxJQUFJO1lBQ2IsV0FBVyxFQUFFO2dCQUNULFVBQVUsRUFBRSxTQUFTO2FBQ3hCO1NBQ0o7UUFDRCxxQkFBcUIsRUFBRTtZQUNuQixPQUFPLEVBQUU7Z0JBQ0w7b0JBQ0ksU0FBUyxFQUFFLENBQUM7b0JBQ1osTUFBTSxFQUFFO3dCQUNKLFNBQVM7d0JBQ1QsV0FBVzt3QkFDWCxTQUFTO3dCQUNULFNBQVM7d0JBQ1QsWUFBWTt3QkFDWixVQUFVO3dCQUNWLFdBQVc7d0JBQ1gsV0FBVzt3QkFDWCxTQUFTO3dCQUNULFFBQVE7d0JBQ1IsU0FBUzt3QkFDVCxVQUFVO3dCQUNWLFVBQVU7d0JBQ1YsV0FBVzt3QkFDWCxLQUFLO3dCQUNMLFNBQVM7d0JBQ1QsZUFBZTt3QkFDZixNQUFNO3dCQUNOLFNBQVM7d0JBQ1QsT0FBTzt3QkFDUCxTQUFTO3FCQUNaO2lCQUNKO2FBQ0o7U0FDSjtLQUNKO0lBQ0QsVUFBVSxFQUFFO1FBQ1IsOEJBQThCO1FBQzlCLE9BQU8sRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7WUFDZCxRQUFRLEVBQUUsSUFBSTtZQUNkLFNBQVMsRUFBRSxLQUFLO1lBQ2hCLFVBQVUsRUFBRSxLQUFLO1lBQ2pCLFdBQVcsRUFBRSxLQUFLO1lBQ2xCLFlBQVksRUFBRSxJQUFJO1lBQ2xCLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFBLG1CQUFVLEdBQUU7U0FDOUI7UUFDRCxTQUFTLEVBQUU7WUFDUCxJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxJQUFJO1lBQ2QsVUFBVSxFQUFFLEtBQUs7WUFDakIsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLE9BQU87U0FDekI7UUFDRCxTQUFTLEVBQUU7WUFDUCxJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxJQUFJO1lBQ2QsVUFBVSxFQUFFLEtBQUs7WUFDakIsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1NBQzFDO1FBQ0QsV0FBVyxFQUFFO1lBQ1QsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtZQUNkLFVBQVUsRUFBRSxLQUFLO1lBQ2pCLFVBQVUsRUFBRSxLQUFLO1lBQ2pCLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFO1NBQzVCO1FBRUQsb0NBQW9DO1FBQ3BDLE9BQU8sRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLEtBQUs7WUFDZixVQUFVLEVBQUUsS0FBSztZQUNqQixPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLG9DQUFvQztTQUM5RDtRQUNELE9BQU8sRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLEtBQUs7WUFDZixVQUFVLEVBQUUsS0FBSztZQUNqQixVQUFVLEVBQUUsS0FBSztTQUNwQjtRQUNELFFBQVEsRUFBRTtZQUNOLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLEtBQUs7WUFDZixVQUFVLEVBQUUsS0FBSztZQUNqQixPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMsTUFBTSxFQUFFLHNDQUFzQztTQUNoRTtRQUNELFFBQVEsRUFBRTtZQUNOLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLEtBQUs7WUFDZixVQUFVLEVBQUUsS0FBSztTQUNwQjtRQUVELG1DQUFtQztRQUNuQyxVQUFVLEVBQUU7WUFDUixJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxJQUFJO1lBQ2QsVUFBVSxFQUFFLEtBQUs7U0FDcEI7UUFDRCxRQUFRLEVBQUU7WUFDTixJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxLQUFLO1lBQ2YsVUFBVSxFQUFFLEtBQUs7U0FDcEI7UUFDRCxTQUFTLEVBQUU7WUFDUCxJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxJQUFJO1lBQ2QsVUFBVSxFQUFFLEtBQUs7WUFDakIsVUFBVSxFQUFFLEtBQUs7U0FDcEI7UUFDRCxTQUFTLEVBQUU7WUFDUCxJQUFJLEVBQUUsUUFBUSxFQUFFLHdEQUF3RDtZQUN4RSxRQUFRLEVBQUUsS0FBSztZQUNmLFVBQVUsRUFBRSxLQUFLO1NBQ3BCO1FBRUQsMEJBQTBCO1FBQzFCLE9BQU8sRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRLEVBQUUsbURBQW1EO1lBQ25FLFFBQVEsRUFBRSxLQUFLO1lBQ2YsVUFBVSxFQUFFLEtBQUs7U0FDcEI7UUFDRCxjQUFjLEVBQUU7WUFDWixJQUFJLEVBQUUsUUFBUSxFQUFFLDBDQUEwQztZQUMxRCxRQUFRLEVBQUUsS0FBSztZQUNmLFVBQVUsRUFBRSxLQUFLO1NBQ3BCO1FBQ0QsVUFBVSxFQUFFO1lBQ1IsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsS0FBSztZQUNmLFVBQVUsRUFBRSxLQUFLO1NBQ3BCO1FBRUQsMkJBQTJCO1FBQzNCLE1BQU0sRUFBRTtZQUNKLElBQUksRUFBRSxRQUFRLEVBQUUsOERBQThEO1lBQzlFLFFBQVEsRUFBRSxLQUFLO1lBQ2YsVUFBVSxFQUFFLEtBQUs7U0FDcEI7UUFDRCxPQUFPLEVBQUU7WUFDTCxJQUFJLEVBQUUsU0FBUztZQUNmLFFBQVEsRUFBRSxLQUFLO1lBQ2YsVUFBVSxFQUFFLEtBQUs7WUFDakIsVUFBVSxFQUFFLEtBQUs7U0FDcEI7UUFDRCxTQUFTLEVBQUU7WUFDUCxJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxLQUFLO1lBQ2YsVUFBVSxFQUFFLEtBQUs7U0FDcEI7UUFFRCxzQ0FBc0M7UUFDdEMsT0FBTyxFQUFFO1lBQ0wsSUFBSSxFQUFFLEtBQUs7WUFDWCxRQUFRLEVBQUUsS0FBSztZQUNmLFVBQVUsRUFBRSxLQUFLO1lBQ2pCLFVBQVUsRUFBRSxLQUFLO1NBQ3BCO1FBRUQsdUJBQXVCO1FBQ3ZCLGFBQWEsRUFBRTtZQUNYLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLEtBQUs7WUFDZixVQUFVLEVBQUUsS0FBSztZQUNqQixVQUFVLEVBQUUsS0FBSztTQUNwQjtRQUVELHdCQUF3QjtRQUN4QixLQUFLLEVBQUU7WUFDSCxJQUFJLEVBQUUsS0FBSztZQUNYLFFBQVEsRUFBRSxLQUFLO1lBQ2YsVUFBVSxFQUFFLEtBQUs7WUFDakIsVUFBVSxFQUFFLEtBQUs7U0FDcEI7UUFFRCwrQkFBK0I7UUFDL0IsSUFBSSxFQUFFO1lBQ0YsSUFBSSxFQUFFLEtBQUs7WUFDWCxRQUFRLEVBQUUsS0FBSztZQUNmLFVBQVUsRUFBRSxLQUFLO1lBQ2pCLFVBQVUsRUFBRSxLQUFLO1NBQ3BCO1FBQ0QsUUFBUSxFQUFFO1lBQ04sSUFBSSxFQUFFLEtBQUs7WUFDWCxRQUFRLEVBQUUsS0FBSztZQUNmLFVBQVUsRUFBRSxLQUFLO1lBQ2pCLFVBQVUsRUFBRSxLQUFLO1NBQ3BCO1FBQ0QsT0FBTyxFQUFFO1lBQ0wsSUFBSSxFQUFFLEtBQUs7WUFDWCxRQUFRLEVBQUUsS0FBSztZQUNmLFVBQVUsRUFBRSxLQUFLO1lBQ2pCLFVBQVUsRUFBRSxLQUFLO1NBQ3BCO1FBRUQseUJBQXlCO1FBQ3pCLFdBQVcsRUFBRTtZQUNULElBQUksRUFBRSxLQUFLO1lBQ1gsUUFBUSxFQUFFLEtBQUs7WUFDZixVQUFVLEVBQUUsS0FBSztZQUNqQixVQUFVLEVBQUUsS0FBSztTQUNwQjtRQUVELHVDQUF1QztRQUN2QyxrREFBa0Q7UUFDbEQsT0FBTyxFQUFFO1lBQ0wsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsS0FBSztZQUNmLFVBQVUsRUFBRSxLQUFLO1lBQ2pCLEtBQUssRUFBRSxDQUFDLE9BQU8sQ0FBQztZQUNoQixHQUFHLEVBQUUsQ0FBQyxDQUFNLEVBQUUsRUFBRSxLQUFLLEVBQU8sRUFBRSxFQUFFLENBQUMsS0FBSyxFQUFFLE9BQU8sSUFBSSxTQUFTO1NBQy9EO1FBQ0QsUUFBUSxFQUFFO1lBQ04sSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsS0FBSztZQUNmLFVBQVUsRUFBRSxLQUFLO1lBQ2pCLEtBQUssRUFBRSxDQUFDLE9BQU8sQ0FBQztZQUNoQixHQUFHLEVBQUUsQ0FBQyxDQUFNLEVBQUUsRUFBRSxLQUFLLEVBQU8sRUFBRSxFQUFFLENBQUMsS0FBSyxFQUFFLFFBQVEsSUFBSSxTQUFTO1NBQ2hFO1FBRUQsNkJBQTZCO1FBQzdCLHNFQUFzRTtRQUN0RSxvRUFBb0U7UUFDcEUsR0FBRyxFQUFFO1lBQ0QsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsS0FBSztZQUNmLFVBQVUsRUFBRSxLQUFLO1lBQ2pCLFVBQVUsRUFBRSxLQUFLO1lBQ2pCLE9BQU8sRUFBRSxHQUFHLEVBQUU7Z0JBQ1YsOENBQThDO2dCQUM5QyxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLElBQUksS0FBSyxDQUFDLENBQUM7Z0JBQzlELE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztZQUNwRSxDQUFDO1NBQ0o7S0FDSjtJQUNELE9BQU8sRUFBRTtRQUNMLDBCQUEwQjtRQUMxQixPQUFPLEVBQUU7WUFDTCxFQUFFLEVBQUU7Z0JBQ0EsS0FBSyxFQUFFLElBQUk7Z0JBQ1gsU0FBUyxFQUFFLENBQUUsU0FBUyxDQUFFO2FBQzNCO1lBQ0QsRUFBRSxFQUFFO2dCQUNBLEtBQUssRUFBRSxJQUFJO2dCQUNYLFNBQVMsRUFBRSxFQUFFO2FBQ2hCO1NBQ0o7UUFFRCwyQ0FBMkM7UUFDM0Msb0RBQW9EO1FBQ3BELElBQUksRUFBRTtZQUNGLEtBQUssRUFBRSxNQUFNO1lBQ2IsRUFBRSxFQUFFO2dCQUNBLEtBQUssRUFBRSxRQUFRO2dCQUNmLFNBQVMsRUFBRSxDQUFFLFlBQVksQ0FBRTthQUM5QjtZQUNELEVBQUUsRUFBRTtnQkFDQSxLQUFLLEVBQUUsUUFBUTtnQkFDZixTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUU7YUFDL0I7U0FDSjtRQUVELGdEQUFnRDtRQUNoRCxnRUFBZ0U7UUFDaEUsSUFBSSxFQUFFO1lBQ0YsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUU7Z0JBQ0EsS0FBSyxFQUFFLFFBQVE7Z0JBQ2YsU0FBUyxFQUFFLENBQUUsU0FBUyxDQUFFO2FBQzNCO1lBQ0QsRUFBRSxFQUFFO2dCQUNBLEtBQUssRUFBRSxRQUFRO2dCQUNmLFNBQVMsRUFBRSxDQUFFLGFBQWEsQ0FBRTthQUMvQjtTQUNKO1FBRUQsa0RBQWtEO1FBQ2xELDhDQUE4QztRQUM5QyxJQUFJLEVBQUU7WUFDRixLQUFLLEVBQUUsTUFBTTtZQUNiLEVBQUUsRUFBRTtnQkFDQSxLQUFLLEVBQUUsUUFBUTtnQkFDZixTQUFTLEVBQUUsQ0FBRSxXQUFXLENBQUU7YUFDN0I7WUFDRCxFQUFFLEVBQUU7Z0JBQ0EsS0FBSyxFQUFFLFFBQVE7Z0JBQ2YsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFO2FBQy9CO1NBQ0o7S0FDSjtDQUNLLENBQUMsQ0FBQztBQUdaLGlGQUFpRjtBQUVqRixNQUFhLG1CQUFtQjtJQUNwQixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLG1CQUFtQixDQUFDLENBQUM7SUFDM0MsT0FBTyxDQUFVO0lBRXpCLFlBQVksTUFBeUI7UUFDakMsSUFBSSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsT0FBTyxJQUFJLEtBQUssQ0FBQztJQUMzQyxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFxQjtRQUM3QiwrRUFBK0U7UUFDL0UsSUFBSSxPQUFPLENBQUMsT0FBTyxLQUFLLEtBQUssSUFBSSxJQUFJLENBQUMsT0FBTyxLQUFLLEtBQUssRUFBRSxDQUFDO1lBQ3RELE9BQU87UUFDWCxDQUFDO1FBRUQsOENBQThDO1FBQzlDLE1BQU0saUJBQWlCLEdBQUcsT0FBTyxDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUM7UUFDeEQsTUFBTSxhQUFhLEdBQUcsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxFQUFFLENBQUM7UUFDbkYsTUFBTSxTQUFTLEdBQUcsYUFBYSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQzlDLE1BQU0sV0FBVyxHQUFHLGFBQWEsQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUU1QyxNQUFNLFVBQVUsR0FBRztZQUNmLFNBQVMsRUFBRSxPQUFPO1lBQ2xCLFNBQVM7WUFDVCxXQUFXO1lBQ1gsR0FBRyxPQUFPLENBQUMsVUFBVTtZQUNyQix1Q0FBdUM7WUFDdkMsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVLEVBQUUsVUFBVSxJQUFJLFNBQVM7WUFDdkQsU0FBUyxFQUFFLE9BQU8sQ0FBQyxVQUFVLEVBQUUsU0FBUyxJQUFJLFNBQVM7WUFDckQsUUFBUSxFQUFFLE9BQU8sQ0FBQyxVQUFVLEVBQUUsUUFBUSxJQUFJLE1BQU07U0FDbkQsQ0FBQztRQUVGLElBQUksQ0FBQztZQUVELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLHNCQUFzQixFQUFFO2dCQUN0QyxVQUFVO2FBQ2IsQ0FBQyxDQUFDO1lBRUgsTUFBTSxZQUFZLEdBQUcsSUFBQSxtQ0FBcUIsRUFBQztnQkFDdkMsTUFBTSxFQUFFLGlDQUF5QjtnQkFDakMsb0JBQW9CLEVBQUUsd0NBQWdDO2FBQ3pELENBQUMsQ0FBQztZQUVILE1BQU0sWUFBWSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUM7UUFDdEQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN6RCxNQUFNLEtBQUssQ0FBQztRQUNoQixDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBaERELGtEQWdEQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQgfSBmcm9tIFwiQGF3cy1zZGsvbGliLWR5bmFtb2RiXCI7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IEVudGl0eUNvbmZpZ3VyYXRpb24gfSBmcm9tICdlbGVjdHJvZGInO1xuaW1wb3J0IHsgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIGNyZWF0ZUVsZWN0cm9EQkVudGl0eSwgY3JlYXRlRW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgQXVkaXRMb2dnZXJDb25maWcsIEF1ZGl0T3B0aW9ucywgSUF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5cbmNvbnN0IGNsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7fSk7XG5cbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShjbGllbnQse1xuICAgIC8vIHRvIG1ha2Ugc3VyZSBtaXNzaW5nIHN0dWZmIGluIGF1ZGl0cyBkb2VzIG5vdCBjYXVzZSBlcnJvcnNcbiAgICBtYXJzaGFsbE9wdGlvbnM6IHtcbiAgICAgICAgY29udmVydENsYXNzSW5zdGFuY2VUb01hcDogdHJ1ZSxcbiAgICAgICAgcmVtb3ZlVW5kZWZpbmVkVmFsdWVzOiB0cnVlLFxuICAgICAgICBjb252ZXJ0RW1wdHlWYWx1ZXM6IHRydWUsXG4gICAgfSxcbn0pXG5cbmV4cG9ydCBjb25zdCBEeW5hbW9EQkF1ZGl0RW50aXR5Q29uZmlndXJhdGlvbjogRW50aXR5Q29uZmlndXJhdGlvbiA9IHtcbiAgICB0YWJsZTogcHJvY2Vzcy5lbnZbIGAke3Byb2Nlc3MuZW52LkFVRElUX1RBQkxFX05BTUU/LnRvVXBwZXJDYXNlKCl9X1RBQkxFYCBdLFxuICAgIGNsaWVudDogZG9jQ2xpZW50LFxufTtcblxuZXhwb3J0IGNvbnN0IER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgIG1vZGVsOiB7XG4gICAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgICAgZW50aXR5OiAnYXVkaXRMb2cnLFxuICAgICAgICBlbnRpdHlOYW1lUGx1cmFsOiAnYXVkaXRMb2dzJyxcbiAgICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgICAgIHNlcnZpY2U6ICdhdWRpdExvZycsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IHRydWUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU6IHRydWUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IHRydWUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5NZW51OiB0cnVlLFxuICAgICAgICBDUlVEQXBpUGF0aDogJy9zeXN0ZW0nLFxuICAgICAgICBzZWFyY2g6IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBpbmRleENvbmZpZzoge1xuICAgICAgICAgICAgICAgIHByaW1hcnlLZXk6ICdhdWRpdElkJyxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgdmlld1BhZ2VDb2x1bW5zQ29uZmlnOiB7XG4gICAgICAgICAgICBjb2x1bW5zOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgICAgIGZpZWxkczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgJ2F1ZGl0SWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2F1ZGl0VHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAnbG9nVHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAnc3ViVHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW50aXR5TmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAnZW50aXR5SWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2V2ZW50VHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAnb3BlcmF0aW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzZXJ2aWNlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzdGF0dXMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3N1Y2Nlc3MnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ3NldmVyaXR5JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdjYXRlZ29yeScsXG4gICAgICAgICAgICAgICAgICAgICAgICAndGltZXN0YW1wJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICd0dGwnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2FjdG9ySWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2NvcnJlbGF0aW9uSWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2RhdGEnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ21ldHJpY3MnLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2FjdG9yJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdjb250ZXh0JyxcbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgLy8gPT09IENPUkUgSURFTlRJRklDQVRJT04gPT09XG4gICAgICAgIGF1ZGl0SWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgICAgIGlzVmlzaWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzQ3JlYXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKVxuICAgICAgICB9LFxuICAgICAgICBhdWRpdFR5cGU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+ICdhdWRpdCdcbiAgICAgICAgfSxcbiAgICAgICAgdGltZXN0YW1wOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfSxcbiAgICAgICAgdGltZXN0YW1wTXM6IHtcbiAgICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gRGF0ZS5ub3coKVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IENMQVNTSUZJQ0FUSU9OIChFbmhhbmNlZCkgPT09XG4gICAgICAgIGxvZ1R5cGU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBkZWZhdWx0OiAoKSA9PiAnYXVkaXQnIC8vICdhdWRpdCcsICdsb2cnLCAnZXZlbnQnLCAnbWV0cmljJ1xuICAgICAgICB9LFxuICAgICAgICBzdWJUeXBlOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIHNldmVyaXR5OiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZGVmYXVsdDogKCkgPT4gJ2luZm8nLCAvLyAnaW5mbycsICd3YXJuJywgJ2Vycm9yJywgJ2NyaXRpY2FsJ1xuICAgICAgICB9LFxuICAgICAgICBjYXRlZ29yeToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBFTlRJVFkvUkVTT1VSQ0UgVFJBQ0tJTkcgPT09XG4gICAgICAgIGVudGl0eU5hbWU6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgZW50aXR5SWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGV2ZW50VHlwZToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIG9wZXJhdGlvbjoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsIC8vICdjcmVhdGUnLCAncmVhZCcsICd1cGRhdGUnLCAnZGVsZXRlJywgJ2xvZ2luJywgJ3N5bmMnXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBTRVJWSUNFIENPTlRFWFQgPT09XG4gICAgICAgIHNlcnZpY2U6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLCAvLyAndXNlci1zZXJ2aWNlJywgJ3BheW1lbnQtc2VydmljZScsICdhcGktZ2F0ZXdheSdcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBleHRlcm5hbFN5c3RlbToge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsIC8vICdzdHJpcGUnLCAnc2VuZGdyaWQnLCAnZ2l0aHViJywgJ3NsYWNrJ1xuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIGV4dGVybmFsSWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gU1RBVFVTICYgT1VUQ09NRSA9PT1cbiAgICAgICAgc3RhdHVzOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJywgLy8gJ3BlbmRpbmcnLCAncHJvY2Vzc2luZycsICdjb21wbGV0ZWQnLCAnZmFpbGVkJywgJ2NhbmNlbGxlZCdcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBzdWNjZXNzOiB7XG4gICAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBpcEFkZHJlc3M6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gTUVUUklDUyAoU3RydWN0dXJlZCBPYmplY3QpID09PVxuICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gVFJBQ0tJTkcgSURzID09PVxuICAgICAgICBjb3JyZWxhdGlvbklkOiB7XG4gICAgICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gQUNUT1IgQ09OVEVYVCA9PT1cbiAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vID09PSBGTEVYSUJMRSBEQVRBIEJMT0NLUyA9PT1cbiAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgICAgdHlwZTogJ2FueScsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGlzTGlzdGFibGU6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gTEVHQUNZIFNVUFBPUlQgPT09XG4gICAgICAgIGlkZW50aWZpZXJzOiB7XG4gICAgICAgICAgICB0eXBlOiAnYW55JyxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIFxuICAgICAgICAvLyA9PT0gQ09NUFVURUQgRklFTERTIEZPUiBJTkRFWElORyA9PT1cbiAgICAgICAgLy8gVGhlc2UgYXJlIGRlcml2ZWQgZmllbGRzIGZvciBvcHRpbWl6ZWQgcXVlcnlpbmdcbiAgICAgICAgYWN0b3JJZDoge1xuICAgICAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIHdhdGNoOiBbJ2FjdG9yJ10sXG4gICAgICAgICAgICBzZXQ6IChfOiBhbnksIHsgYWN0b3IgfTogYW55KSA9PiBhY3Rvcj8uYWN0b3JJZCB8fCB1bmRlZmluZWRcbiAgICAgICAgfSxcbiAgICAgICAgdGVuYW50SWQ6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICB3YXRjaDogWydhY3RvciddLFxuICAgICAgICAgICAgc2V0OiAoXzogYW55LCB7IGFjdG9yIH06IGFueSkgPT4gYWN0b3I/LnRlbmFudElkIHx8IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gPT09IFRUTCAoVGltZSBUbyBMaXZlKSA9PT1cbiAgICAgICAgLy8gRHluYW1vREIgVFRMIGZpZWxkIC0gYXV0b21hdGljYWxseSBkZWxldGVzIHJlY29yZHMgYWZ0ZXIgZXhwaXJhdGlvblxuICAgICAgICAvLyBEZWZhdWx0OiA5MCBkYXlzIGZyb20gY3JlYXRpb24sIGNhbiBiZSBvdmVycmlkZGVuIHBlciBhdWRpdCBlbnRyeVxuICAgICAgICB0dGw6IHtcbiAgICAgICAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGRlZmF1bHQ6ICgpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBEZWZhdWx0IFRUTDogMzY1IGRheXMgZnJvbSBub3cgKGluIHNlY29uZHMpXG4gICAgICAgICAgICAgICAgY29uc3QgdHRsRGF5cyA9IHBhcnNlSW50KHByb2Nlc3MuZW52LkFVRElUX1RUTF9EQVlTIHx8ICczNjUnKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyAodHRsRGF5cyAqIDI0ICogNjAgKiA2MCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIGluZGV4ZXM6IHtcbiAgICAgICAgLy8gUHJpbWFyeSBpbmRleCAtIGF1ZGl0SWRcbiAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgJ2F1ZGl0SWQnIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzazoge1xuICAgICAgICAgICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogW11cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vIEdTSTEgLSBFbnRpdHktYmFzZWQgcXVlcmllcyAoZW50aXR5TmFtZSlcbiAgICAgICAgLy8gVXNhZ2U6IFRyYWNrIGFsbCBhY3Rpdml0aWVzIGZvciBzcGVjaWZpYyBlbnRpdGllc1xuICAgICAgICBnc2kxOiB7XG4gICAgICAgICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgICAgICAgcGs6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTFwaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICdlbnRpdHlOYW1lJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTFzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcbiAgICAgICAgLy8gR1NJMiAtIExvZyB0eXBlIGNsYXNzaWZpY2F0aW9uIChsb2dUeXBlIG9ubHkpXG4gICAgICAgIC8vIFVzYWdlOiBGaWx0ZXIgYnkgbG9nIHR5cGUgKHN1YlR5cGUgZmlsdGVyaW5nIGRvbmUgcG9zdC1xdWVyeSlcbiAgICAgICAgZ3NpMjoge1xuICAgICAgICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kycGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnbG9nVHlwZScgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kyc2snLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXG4gICAgICAgIC8vIEdTSTMgLSBMb2cgdHlwZSBjbGFzc2lmaWNhdGlvbiAoYXVkaXRUeXBlIG9ubHkpXG4gICAgICAgIC8vIFVzYWdlOiBRdWVyeSBhbGwgYXVkaXQgbG9ncyBjaHJvbm9sb2dpY2FsbHlcbiAgICAgICAgZ3NpMzoge1xuICAgICAgICAgICAgaW5kZXg6ICdnc2kzJyxcbiAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6ICdnc2kzcGsnLFxuICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyAnYXVkaXRUeXBlJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICBmaWVsZDogJ2dzaTNzaycsXG4gICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgIH1cbn0gYXMgY29uc3QpO1xuZXhwb3J0IHR5cGUgQXVkaXRFbnRpdHlTY2hlbWFUeXBlID0gdHlwZW9mIER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWE7XG5cbi8vIER5bmFtb0RCQXVkaXRFbnRpdHlTZXJ2aWNlIG1vdmVkIHRvIHNlcGFyYXRlIGZpbGUgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeVxuXG5leHBvcnQgY2xhc3MgRHluYW1vRGJBdWRpdExvZ2dlciBpbXBsZW1lbnRzIElBdWRpdExvZ2dlciB7XG4gICAgcHJpdmF0ZSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoRHluYW1vRGJBdWRpdExvZ2dlcik7XG4gICAgcHJpdmF0ZSBlbmFibGVkOiBib29sZWFuO1xuXG4gICAgY29uc3RydWN0b3IoY29uZmlnOiBBdWRpdExvZ2dlckNvbmZpZykge1xuICAgICAgICB0aGlzLmVuYWJsZWQgPSBjb25maWcuZW5hYmxlZCA/PyBmYWxzZTtcbiAgICB9XG5cbiAgICBhc3luYyBhdWRpdChvcHRpb25zOiBBdWRpdE9wdGlvbnMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgLy8gSWYgZXhwbGljaXRseSBkaXNhYmxlZCBmb3IgdGhpcyBvcGVyYXRpb24gb3IgZ2xvYmFsbHkgZGlzYWJsZWQsIHNraXAgbG9nZ2luZ1xuICAgICAgICBpZiAob3B0aW9ucy5lbmFibGVkID09PSBmYWxzZSB8fCB0aGlzLmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVc2UgcHJvdmlkZWQgdGltZXN0YW1wIG9yIGdlbmVyYXRlIGZhbGxiYWNrXG4gICAgICAgIGNvbnN0IHByb3ZpZGVkVGltZXN0YW1wID0gb3B0aW9ucy5hdWRpdEVudHJ5Py50aW1lc3RhbXA7XG4gICAgICAgIGNvbnN0IHRpbWVzdGFtcERhdGUgPSBwcm92aWRlZFRpbWVzdGFtcCA/IG5ldyBEYXRlKHByb3ZpZGVkVGltZXN0YW1wKSA6IG5ldyBEYXRlKCk7XG4gICAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IHRpbWVzdGFtcERhdGUudG9JU09TdHJpbmcoKTtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wTXMgPSB0aW1lc3RhbXBEYXRlLmdldFRpbWUoKTtcblxuICAgICAgICBjb25zdCBhdWRpdEVudHJ5ID0ge1xuICAgICAgICAgICAgYXVkaXRUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgICAgdGltZXN0YW1wLFxuICAgICAgICAgICAgdGltZXN0YW1wTXMsXG4gICAgICAgICAgICAuLi5vcHRpb25zLmF1ZGl0RW50cnksXG4gICAgICAgICAgICAvLyBFbnN1cmUgcmVxdWlyZWQgZmllbGRzIGhhdmUgZGVmYXVsdHNcbiAgICAgICAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnMuYXVkaXRFbnRyeT8uZW50aXR5TmFtZSB8fCAndW5rbm93bicsXG4gICAgICAgICAgICBldmVudFR5cGU6IG9wdGlvbnMuYXVkaXRFbnRyeT8uZXZlbnRUeXBlIHx8ICd1bmtub3duJyxcbiAgICAgICAgICAgIHNldmVyaXR5OiBvcHRpb25zLmF1ZGl0RW50cnk/LnNldmVyaXR5IHx8ICdpbmZvJyxcbiAgICAgICAgfTtcblxuICAgICAgICB0cnkge1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnV3JpdGluZyB0byBEeW5hbW9EQjonLCB7XG4gICAgICAgICAgICAgICAgYXVkaXRFbnRyeSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBhdWRpdFNlcnZpY2UgPSBjcmVhdGVFbGVjdHJvREJFbnRpdHkoe1xuICAgICAgICAgICAgICAgIHNjaGVtYTogRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWd1cmF0aW9uczogRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgYXdhaXQgYXVkaXRTZXJ2aWNlLmVudGl0eS5jcmVhdGUoYXVkaXRFbnRyeSkuZ28oKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gd3JpdGUgdG8gRHluYW1vREI6JywgZXJyb3IpO1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG59ICJdfQ==