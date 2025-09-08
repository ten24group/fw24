import { Service } from '../../decorators';
import { BaseEntityService, EntityQuery } from '../../entity';
import { ExecutionContext } from '../../core/types/execution-context';
import { EntitySearchQuery } from '../../search/types';
import { DynamoDBAuditEntitySchema, DynamoDBAuditEntityConfiguration, AuditEntitySchemaType } from '../loggers/dynamodb';

@Service()
export class DynamoDBAuditEntityService extends BaseEntityService<AuditEntitySchemaType> {
    constructor() {
        super(DynamoDBAuditEntitySchema, DynamoDBAuditEntityConfiguration);
    }

    /**
     * Override the base list method to return latest audit records first
     * This ensures audit logs are displayed with most recent entries at the top
     * Uses GSI3 index for chronological sorting by timestampMs
     */
    public async list(query: EntityQuery<AuditEntitySchemaType> = {}, ctx?: ExecutionContext) {
        // Set default order to 'desc' for audit logs to show latest first
        // Allow override via query parameter if needed
        const modifiedQuery = {
            ...query,
            pagination: {
                ...query.pagination,
                order: 'desc' as const
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

    /**
     * Override the base search method to return latest audit records first
     * This ensures audit logs are displayed with most recent entries at the top
     * Adds default sorting by timestamp in descending order when no sort is specified
     */
    public async search(query: EntitySearchQuery<AuditEntitySchemaType>, ctx?: ExecutionContext) {
        // Set default sort to 'timestamp:desc' for audit logs to show latest first
        // Allow override via query parameter if needed
        const modifiedQuery: EntitySearchQuery<AuditEntitySchemaType> = {
            ...query,
            // Only add default sort if no sort is specified
            sort: query.sort && query.sort.length > 0 
                ? query.sort 
                : [{ field: 'timestamp' as const, dir: 'desc' as const }]
        };

        return super.search(modifiedQuery, ctx);
    }
}
