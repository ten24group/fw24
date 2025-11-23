import { BaseEntityService, EntityQuery } from '../../entity';
import { ExecutionContext } from '../../core/types/execution-context';
import { EntitySearchQuery } from '../../search/types';
import { AuditEntitySchemaType } from '../loggers/dynamodb';
export declare class DynamoDBAuditEntityService extends BaseEntityService<AuditEntitySchemaType> {
    constructor();
    /**
     * Override the base list method to return latest audit records first
     * This ensures audit logs are displayed with most recent entries at the top
     * Uses GSI3 index for chronological sorting by timestampMs
     */
    list(query?: EntityQuery<AuditEntitySchemaType>, ctx?: ExecutionContext): Promise<{
        query: EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "auditLog";
                readonly entityNamePlural: "auditLogs";
                readonly entityOperations: {
                    readonly get: "get";
                    readonly list: "list";
                    readonly query: "query";
                    readonly create: "create";
                    readonly upsert: "upsert";
                    readonly update: "update";
                    readonly delete: "delete";
                    readonly duplicate: "duplicate";
                };
                readonly service: "auditLog";
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminDelete: true;
                readonly excludeFromAdminMenu: true;
                readonly CRUDApiPath: "/system";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "auditId";
                    };
                };
                readonly viewPageColumnsConfig: {
                    readonly columns: [{
                        readonly sortOrder: 1;
                        readonly fields: ["auditId", "auditType", "logType", "subType", "entityName", "entityId", "eventType", "operation", "service", "status", "success", "severity", "category", "timestamp", "ttl", "actorId", "correlationId", "data", "metrics", "actor", "context"];
                    }];
                };
            };
            readonly attributes: {
                readonly auditId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly readOnly: true;
                    readonly isVisible: false;
                    readonly isEditable: false;
                    readonly isCreatable: false;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly auditType: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isEditable: false;
                    readonly default: () => string;
                };
                readonly timestamp: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isEditable: false;
                    readonly default: () => string;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly isEditable: false;
                    readonly isListable: false;
                    readonly default: () => number;
                };
                readonly logType: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly default: () => string;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly isListable: false;
                };
                readonly severity: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly default: () => string;
                };
                readonly category: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isEditable: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                };
                readonly eventType: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isEditable: false;
                    readonly isListable: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                };
                readonly service: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                };
                readonly externalSystem: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                };
                readonly externalId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly isListable: false;
                };
                readonly ipAddress: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                };
                readonly metrics: {
                    readonly type: "any";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly isListable: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly isListable: false;
                };
                readonly actor: {
                    readonly type: "any";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly isListable: false;
                };
                readonly data: {
                    readonly type: "any";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly isListable: false;
                };
                readonly metadata: {
                    readonly type: "any";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly isListable: false;
                };
                readonly context: {
                    readonly type: "any";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly isListable: false;
                };
                readonly identifiers: {
                    readonly type: "any";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly isListable: false;
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: any, { actor }: any) => any;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: any, { actor }: any) => any;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly isEditable: false;
                    readonly isListable: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["auditId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly gsi1: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["entityName"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly gsi2: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["logType"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly gsi3: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["auditType"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
            };
        }>;
        data: {
            readonly [x: string]: any;
        }[];
        cursor: string | null;
    }>;
    /**
     * Override the base search method to return latest audit records first
     * This ensures audit logs are displayed with most recent entries at the top
     * Adds default sorting by timestamp in descending order when no sort is specified
     */
    search(query: EntitySearchQuery<AuditEntitySchemaType>, ctx?: ExecutionContext): Promise<import("../../search/types").SearchResult<any>>;
}
