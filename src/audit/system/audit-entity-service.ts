import { Service } from '../../decorators';
import { BaseEntityService, EntityQuery } from '../../entity';
import { ExecutionContext } from '../../core/types/execution-context';
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
}
