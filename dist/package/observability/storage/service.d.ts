/**
 * ObservabilityLogService - Self-contained service for observability data
 *
 * Extends BaseEntityService but creates its own DynamoDB client internally.
 * This allows observability to work BEFORE DI is initialized.
 */
import { BaseEntityService } from '../../entity/base-service';
import { Pagination } from '../../entity/query-types';
import { ObservabilityLogSchema } from './log-entity';
import { CreateEntityItemTypeFromSchema, EntityRecordTypeFromSchema } from '../../entity/base-entity';
type ObservabilityLogCreateItem = CreateEntityItemTypeFromSchema<ObservabilityLogSchema>;
/**
 * Reconstructed span with hierarchy for trace visualization
 */
export interface ReconstructedSpan {
    spanId: string;
    traceId: string;
    parentSpanId?: string;
    operation: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    status?: string;
    success?: boolean;
    attributes: Record<string, unknown>;
    events: Array<{
        name: string;
        timestamp: number;
        attributes: Record<string, unknown>;
    }>;
    metrics: Record<string, number>;
    children: ReconstructedSpan[];
}
/**
 * Type for log record from query results
 */
export type LogRecord = EntityRecordTypeFromSchema<ObservabilityLogSchema>;
/**
 * ObservabilityLogService
 *
 * Self-contained service - creates its own DynamoDB client.
 */
export declare class ObservabilityLogService extends BaseEntityService<ObservabilityLogSchema> {
    private static instance;
    private constructor();
    static getInstance(): ObservabilityLogService;
    /**
     * Batch create - used by DynamoDB backend
     */
    batchCreate(items: ObservabilityLogCreateItem[]): Promise<void>;
    /**
     * Get by trace/correlation
     */
    getByTrace(correlationId: string, pagination?: Pagination): Promise<{
        query: import("../../entity/query-types").EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "observabilityLog";
                readonly entityNamePlural: "observabilityLogs";
                readonly service: "observability";
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
                readonly excludeFromAdminMenu: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminDelete: true;
                readonly CRUDApiPath: "/system/observability";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "logId";
                    };
                };
            };
            readonly attributes: {
                readonly logId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly parentLogId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly level: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly default: () => number;
                };
                readonly durationMs: {
                    readonly type: "number";
                    readonly required: false;
                };
                readonly source: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly tags: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metrics: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly attributes: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly data: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metadata: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly error: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                        };
                        readonly message: {
                            readonly type: "string";
                        };
                        readonly stack: {
                            readonly type: "string";
                        };
                        readonly code: {
                            readonly type: "string";
                        };
                    };
                };
                readonly actor: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly context: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            actorId?: string;
                        };
                    }) => string | undefined;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            tenantId?: string;
                        };
                    }) => string | undefined;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["logId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly byTrace: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["correlationId"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byParent: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["parentLogId"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byEntity: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["entityName", "entityId"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byLevel: {
                    readonly index: "gsi4";
                    readonly pk: {
                        readonly field: "gsi4pk";
                        readonly composite: readonly ["level"];
                    };
                    readonly sk: {
                        readonly field: "gsi4sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byType: {
                    readonly index: "gsi5";
                    readonly pk: {
                        readonly field: "gsi5pk";
                        readonly composite: readonly ["type"];
                    };
                    readonly sk: {
                        readonly field: "gsi5sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly bySource: {
                    readonly index: "gsi6";
                    readonly pk: {
                        readonly field: "gsi6pk";
                        readonly composite: readonly ["source"];
                    };
                    readonly sk: {
                        readonly field: "gsi6sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byTenant: {
                    readonly index: "gsi7";
                    readonly pk: {
                        readonly field: "gsi7pk";
                        readonly composite: readonly ["tenantId"];
                    };
                    readonly sk: {
                        readonly field: "gsi7sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byActor: {
                    readonly index: "gsi8";
                    readonly pk: {
                        readonly field: "gsi8pk";
                        readonly composite: readonly ["actorId"];
                    };
                    readonly sk: {
                        readonly field: "gsi8sk";
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
     * Get by entity
     */
    getByEntity(entityName: string, entityId: string, pagination?: Pagination): Promise<{
        query: import("../../entity/query-types").EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "observabilityLog";
                readonly entityNamePlural: "observabilityLogs";
                readonly service: "observability";
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
                readonly excludeFromAdminMenu: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminDelete: true;
                readonly CRUDApiPath: "/system/observability";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "logId";
                    };
                };
            };
            readonly attributes: {
                readonly logId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly parentLogId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly level: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly default: () => number;
                };
                readonly durationMs: {
                    readonly type: "number";
                    readonly required: false;
                };
                readonly source: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly tags: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metrics: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly attributes: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly data: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metadata: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly error: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                        };
                        readonly message: {
                            readonly type: "string";
                        };
                        readonly stack: {
                            readonly type: "string";
                        };
                        readonly code: {
                            readonly type: "string";
                        };
                    };
                };
                readonly actor: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly context: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            actorId?: string;
                        };
                    }) => string | undefined;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            tenantId?: string;
                        };
                    }) => string | undefined;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["logId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly byTrace: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["correlationId"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byParent: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["parentLogId"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byEntity: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["entityName", "entityId"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byLevel: {
                    readonly index: "gsi4";
                    readonly pk: {
                        readonly field: "gsi4pk";
                        readonly composite: readonly ["level"];
                    };
                    readonly sk: {
                        readonly field: "gsi4sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byType: {
                    readonly index: "gsi5";
                    readonly pk: {
                        readonly field: "gsi5pk";
                        readonly composite: readonly ["type"];
                    };
                    readonly sk: {
                        readonly field: "gsi5sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly bySource: {
                    readonly index: "gsi6";
                    readonly pk: {
                        readonly field: "gsi6pk";
                        readonly composite: readonly ["source"];
                    };
                    readonly sk: {
                        readonly field: "gsi6sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byTenant: {
                    readonly index: "gsi7";
                    readonly pk: {
                        readonly field: "gsi7pk";
                        readonly composite: readonly ["tenantId"];
                    };
                    readonly sk: {
                        readonly field: "gsi7sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byActor: {
                    readonly index: "gsi8";
                    readonly pk: {
                        readonly field: "gsi8pk";
                        readonly composite: readonly ["actorId"];
                    };
                    readonly sk: {
                        readonly field: "gsi8sk";
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
     * Get by type
     */
    getByType(type: string, pagination?: Pagination): Promise<{
        query: import("../../entity/query-types").EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "observabilityLog";
                readonly entityNamePlural: "observabilityLogs";
                readonly service: "observability";
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
                readonly excludeFromAdminMenu: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminDelete: true;
                readonly CRUDApiPath: "/system/observability";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "logId";
                    };
                };
            };
            readonly attributes: {
                readonly logId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly parentLogId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly level: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly default: () => number;
                };
                readonly durationMs: {
                    readonly type: "number";
                    readonly required: false;
                };
                readonly source: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly tags: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metrics: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly attributes: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly data: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metadata: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly error: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                        };
                        readonly message: {
                            readonly type: "string";
                        };
                        readonly stack: {
                            readonly type: "string";
                        };
                        readonly code: {
                            readonly type: "string";
                        };
                    };
                };
                readonly actor: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly context: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            actorId?: string;
                        };
                    }) => string | undefined;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            tenantId?: string;
                        };
                    }) => string | undefined;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["logId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly byTrace: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["correlationId"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byParent: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["parentLogId"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byEntity: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["entityName", "entityId"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byLevel: {
                    readonly index: "gsi4";
                    readonly pk: {
                        readonly field: "gsi4pk";
                        readonly composite: readonly ["level"];
                    };
                    readonly sk: {
                        readonly field: "gsi4sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byType: {
                    readonly index: "gsi5";
                    readonly pk: {
                        readonly field: "gsi5pk";
                        readonly composite: readonly ["type"];
                    };
                    readonly sk: {
                        readonly field: "gsi5sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly bySource: {
                    readonly index: "gsi6";
                    readonly pk: {
                        readonly field: "gsi6pk";
                        readonly composite: readonly ["source"];
                    };
                    readonly sk: {
                        readonly field: "gsi6sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byTenant: {
                    readonly index: "gsi7";
                    readonly pk: {
                        readonly field: "gsi7pk";
                        readonly composite: readonly ["tenantId"];
                    };
                    readonly sk: {
                        readonly field: "gsi7sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byActor: {
                    readonly index: "gsi8";
                    readonly pk: {
                        readonly field: "gsi8pk";
                        readonly composite: readonly ["actorId"];
                    };
                    readonly sk: {
                        readonly field: "gsi8sk";
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
     * Get children
     */
    getChildren(parentLogId: string, pagination?: Pagination): Promise<{
        query: import("../../entity/query-types").EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "observabilityLog";
                readonly entityNamePlural: "observabilityLogs";
                readonly service: "observability";
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
                readonly excludeFromAdminMenu: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminDelete: true;
                readonly CRUDApiPath: "/system/observability";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "logId";
                    };
                };
            };
            readonly attributes: {
                readonly logId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly parentLogId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly level: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly default: () => number;
                };
                readonly durationMs: {
                    readonly type: "number";
                    readonly required: false;
                };
                readonly source: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly tags: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metrics: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly attributes: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly data: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metadata: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly error: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                        };
                        readonly message: {
                            readonly type: "string";
                        };
                        readonly stack: {
                            readonly type: "string";
                        };
                        readonly code: {
                            readonly type: "string";
                        };
                    };
                };
                readonly actor: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly context: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            actorId?: string;
                        };
                    }) => string | undefined;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            tenantId?: string;
                        };
                    }) => string | undefined;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["logId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly byTrace: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["correlationId"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byParent: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["parentLogId"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byEntity: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["entityName", "entityId"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byLevel: {
                    readonly index: "gsi4";
                    readonly pk: {
                        readonly field: "gsi4pk";
                        readonly composite: readonly ["level"];
                    };
                    readonly sk: {
                        readonly field: "gsi4sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byType: {
                    readonly index: "gsi5";
                    readonly pk: {
                        readonly field: "gsi5pk";
                        readonly composite: readonly ["type"];
                    };
                    readonly sk: {
                        readonly field: "gsi5sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly bySource: {
                    readonly index: "gsi6";
                    readonly pk: {
                        readonly field: "gsi6pk";
                        readonly composite: readonly ["source"];
                    };
                    readonly sk: {
                        readonly field: "gsi6sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byTenant: {
                    readonly index: "gsi7";
                    readonly pk: {
                        readonly field: "gsi7pk";
                        readonly composite: readonly ["tenantId"];
                    };
                    readonly sk: {
                        readonly field: "gsi7sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byActor: {
                    readonly index: "gsi8";
                    readonly pk: {
                        readonly field: "gsi8pk";
                        readonly composite: readonly ["actorId"];
                    };
                    readonly sk: {
                        readonly field: "gsi8sk";
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
     * Get by source
     */
    getBySource(source: string, pagination?: Pagination): Promise<{
        query: import("../../entity/query-types").EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "observabilityLog";
                readonly entityNamePlural: "observabilityLogs";
                readonly service: "observability";
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
                readonly excludeFromAdminMenu: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminDelete: true;
                readonly CRUDApiPath: "/system/observability";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "logId";
                    };
                };
            };
            readonly attributes: {
                readonly logId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly parentLogId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly level: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly default: () => number;
                };
                readonly durationMs: {
                    readonly type: "number";
                    readonly required: false;
                };
                readonly source: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly tags: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metrics: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly attributes: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly data: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metadata: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly error: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                        };
                        readonly message: {
                            readonly type: "string";
                        };
                        readonly stack: {
                            readonly type: "string";
                        };
                        readonly code: {
                            readonly type: "string";
                        };
                    };
                };
                readonly actor: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly context: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            actorId?: string;
                        };
                    }) => string | undefined;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            tenantId?: string;
                        };
                    }) => string | undefined;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["logId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly byTrace: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["correlationId"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byParent: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["parentLogId"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byEntity: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["entityName", "entityId"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byLevel: {
                    readonly index: "gsi4";
                    readonly pk: {
                        readonly field: "gsi4pk";
                        readonly composite: readonly ["level"];
                    };
                    readonly sk: {
                        readonly field: "gsi4sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byType: {
                    readonly index: "gsi5";
                    readonly pk: {
                        readonly field: "gsi5pk";
                        readonly composite: readonly ["type"];
                    };
                    readonly sk: {
                        readonly field: "gsi5sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly bySource: {
                    readonly index: "gsi6";
                    readonly pk: {
                        readonly field: "gsi6pk";
                        readonly composite: readonly ["source"];
                    };
                    readonly sk: {
                        readonly field: "gsi6sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byTenant: {
                    readonly index: "gsi7";
                    readonly pk: {
                        readonly field: "gsi7pk";
                        readonly composite: readonly ["tenantId"];
                    };
                    readonly sk: {
                        readonly field: "gsi7sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byActor: {
                    readonly index: "gsi8";
                    readonly pk: {
                        readonly field: "gsi8pk";
                        readonly composite: readonly ["actorId"];
                    };
                    readonly sk: {
                        readonly field: "gsi8sk";
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
     * Get by tenant
     */
    getByTenant(tenantId: string, pagination?: Pagination): Promise<{
        query: import("../../entity/query-types").EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "observabilityLog";
                readonly entityNamePlural: "observabilityLogs";
                readonly service: "observability";
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
                readonly excludeFromAdminMenu: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminDelete: true;
                readonly CRUDApiPath: "/system/observability";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "logId";
                    };
                };
            };
            readonly attributes: {
                readonly logId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly parentLogId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly level: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly default: () => number;
                };
                readonly durationMs: {
                    readonly type: "number";
                    readonly required: false;
                };
                readonly source: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly tags: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metrics: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly attributes: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly data: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metadata: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly error: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                        };
                        readonly message: {
                            readonly type: "string";
                        };
                        readonly stack: {
                            readonly type: "string";
                        };
                        readonly code: {
                            readonly type: "string";
                        };
                    };
                };
                readonly actor: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly context: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            actorId?: string;
                        };
                    }) => string | undefined;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            tenantId?: string;
                        };
                    }) => string | undefined;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["logId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly byTrace: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["correlationId"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byParent: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["parentLogId"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byEntity: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["entityName", "entityId"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byLevel: {
                    readonly index: "gsi4";
                    readonly pk: {
                        readonly field: "gsi4pk";
                        readonly composite: readonly ["level"];
                    };
                    readonly sk: {
                        readonly field: "gsi4sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byType: {
                    readonly index: "gsi5";
                    readonly pk: {
                        readonly field: "gsi5pk";
                        readonly composite: readonly ["type"];
                    };
                    readonly sk: {
                        readonly field: "gsi5sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly bySource: {
                    readonly index: "gsi6";
                    readonly pk: {
                        readonly field: "gsi6pk";
                        readonly composite: readonly ["source"];
                    };
                    readonly sk: {
                        readonly field: "gsi6sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byTenant: {
                    readonly index: "gsi7";
                    readonly pk: {
                        readonly field: "gsi7pk";
                        readonly composite: readonly ["tenantId"];
                    };
                    readonly sk: {
                        readonly field: "gsi7sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byActor: {
                    readonly index: "gsi8";
                    readonly pk: {
                        readonly field: "gsi8pk";
                        readonly composite: readonly ["actorId"];
                    };
                    readonly sk: {
                        readonly field: "gsi8sk";
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
     * Get by actor
     */
    getByActor(actorId: string, pagination?: Pagination): Promise<{
        query: import("../../entity/query-types").EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "observabilityLog";
                readonly entityNamePlural: "observabilityLogs";
                readonly service: "observability";
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
                readonly excludeFromAdminMenu: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminDelete: true;
                readonly CRUDApiPath: "/system/observability";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "logId";
                    };
                };
            };
            readonly attributes: {
                readonly logId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly parentLogId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly level: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly default: () => number;
                };
                readonly durationMs: {
                    readonly type: "number";
                    readonly required: false;
                };
                readonly source: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly tags: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metrics: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly attributes: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly data: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metadata: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly error: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                        };
                        readonly message: {
                            readonly type: "string";
                        };
                        readonly stack: {
                            readonly type: "string";
                        };
                        readonly code: {
                            readonly type: "string";
                        };
                    };
                };
                readonly actor: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly context: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            actorId?: string;
                        };
                    }) => string | undefined;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            tenantId?: string;
                        };
                    }) => string | undefined;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["logId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly byTrace: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["correlationId"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byParent: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["parentLogId"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byEntity: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["entityName", "entityId"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byLevel: {
                    readonly index: "gsi4";
                    readonly pk: {
                        readonly field: "gsi4pk";
                        readonly composite: readonly ["level"];
                    };
                    readonly sk: {
                        readonly field: "gsi4sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byType: {
                    readonly index: "gsi5";
                    readonly pk: {
                        readonly field: "gsi5pk";
                        readonly composite: readonly ["type"];
                    };
                    readonly sk: {
                        readonly field: "gsi5sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly bySource: {
                    readonly index: "gsi6";
                    readonly pk: {
                        readonly field: "gsi6pk";
                        readonly composite: readonly ["source"];
                    };
                    readonly sk: {
                        readonly field: "gsi6sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byTenant: {
                    readonly index: "gsi7";
                    readonly pk: {
                        readonly field: "gsi7pk";
                        readonly composite: readonly ["tenantId"];
                    };
                    readonly sk: {
                        readonly field: "gsi7sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byActor: {
                    readonly index: "gsi8";
                    readonly pk: {
                        readonly field: "gsi8pk";
                        readonly composite: readonly ["actorId"];
                    };
                    readonly sk: {
                        readonly field: "gsi8sk";
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
     * Get by level
     */
    getByLevel(level: string, pagination?: Pagination): Promise<{
        query: import("../../entity/query-types").EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "observabilityLog";
                readonly entityNamePlural: "observabilityLogs";
                readonly service: "observability";
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
                readonly excludeFromAdminMenu: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminDelete: true;
                readonly CRUDApiPath: "/system/observability";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "logId";
                    };
                };
            };
            readonly attributes: {
                readonly logId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly parentLogId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly level: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly default: () => number;
                };
                readonly durationMs: {
                    readonly type: "number";
                    readonly required: false;
                };
                readonly source: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly tags: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metrics: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly attributes: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly data: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metadata: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly error: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                        };
                        readonly message: {
                            readonly type: "string";
                        };
                        readonly stack: {
                            readonly type: "string";
                        };
                        readonly code: {
                            readonly type: "string";
                        };
                    };
                };
                readonly actor: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly context: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            actorId?: string;
                        };
                    }) => string | undefined;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            tenantId?: string;
                        };
                    }) => string | undefined;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["logId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly byTrace: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["correlationId"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byParent: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["parentLogId"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byEntity: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["entityName", "entityId"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byLevel: {
                    readonly index: "gsi4";
                    readonly pk: {
                        readonly field: "gsi4pk";
                        readonly composite: readonly ["level"];
                    };
                    readonly sk: {
                        readonly field: "gsi4sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byType: {
                    readonly index: "gsi5";
                    readonly pk: {
                        readonly field: "gsi5pk";
                        readonly composite: readonly ["type"];
                    };
                    readonly sk: {
                        readonly field: "gsi5sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly bySource: {
                    readonly index: "gsi6";
                    readonly pk: {
                        readonly field: "gsi6pk";
                        readonly composite: readonly ["source"];
                    };
                    readonly sk: {
                        readonly field: "gsi6sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byTenant: {
                    readonly index: "gsi7";
                    readonly pk: {
                        readonly field: "gsi7pk";
                        readonly composite: readonly ["tenantId"];
                    };
                    readonly sk: {
                        readonly field: "gsi7sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byActor: {
                    readonly index: "gsi8";
                    readonly pk: {
                        readonly field: "gsi8pk";
                        readonly composite: readonly ["actorId"];
                    };
                    readonly sk: {
                        readonly field: "gsi8sk";
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
     * Get errors
     */
    getErrors(pagination?: Pagination): Promise<{
        query: import("../../entity/query-types").EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "observabilityLog";
                readonly entityNamePlural: "observabilityLogs";
                readonly service: "observability";
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
                readonly excludeFromAdminMenu: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminDelete: true;
                readonly CRUDApiPath: "/system/observability";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "logId";
                    };
                };
            };
            readonly attributes: {
                readonly logId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly parentLogId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly level: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly default: () => number;
                };
                readonly durationMs: {
                    readonly type: "number";
                    readonly required: false;
                };
                readonly source: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly tags: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metrics: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly attributes: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly data: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metadata: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly error: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                        };
                        readonly message: {
                            readonly type: "string";
                        };
                        readonly stack: {
                            readonly type: "string";
                        };
                        readonly code: {
                            readonly type: "string";
                        };
                    };
                };
                readonly actor: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly context: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            actorId?: string;
                        };
                    }) => string | undefined;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            tenantId?: string;
                        };
                    }) => string | undefined;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["logId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly byTrace: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["correlationId"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byParent: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["parentLogId"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byEntity: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["entityName", "entityId"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byLevel: {
                    readonly index: "gsi4";
                    readonly pk: {
                        readonly field: "gsi4pk";
                        readonly composite: readonly ["level"];
                    };
                    readonly sk: {
                        readonly field: "gsi4sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byType: {
                    readonly index: "gsi5";
                    readonly pk: {
                        readonly field: "gsi5pk";
                        readonly composite: readonly ["type"];
                    };
                    readonly sk: {
                        readonly field: "gsi5sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly bySource: {
                    readonly index: "gsi6";
                    readonly pk: {
                        readonly field: "gsi6pk";
                        readonly composite: readonly ["source"];
                    };
                    readonly sk: {
                        readonly field: "gsi6sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byTenant: {
                    readonly index: "gsi7";
                    readonly pk: {
                        readonly field: "gsi7pk";
                        readonly composite: readonly ["tenantId"];
                    };
                    readonly sk: {
                        readonly field: "gsi7sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byActor: {
                    readonly index: "gsi8";
                    readonly pk: {
                        readonly field: "gsi8pk";
                        readonly composite: readonly ["actorId"];
                    };
                    readonly sk: {
                        readonly field: "gsi8sk";
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
     * Get audit history for entity
     */
    getAuditHistory(entityName: string, entityId: string, pagination?: Pagination): Promise<{
        query: import("../../entity/query-types").EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "observabilityLog";
                readonly entityNamePlural: "observabilityLogs";
                readonly service: "observability";
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
                readonly excludeFromAdminMenu: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminDelete: true;
                readonly CRUDApiPath: "/system/observability";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "logId";
                    };
                };
            };
            readonly attributes: {
                readonly logId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly parentLogId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly level: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly default: () => number;
                };
                readonly durationMs: {
                    readonly type: "number";
                    readonly required: false;
                };
                readonly source: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly tags: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metrics: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly attributes: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly data: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metadata: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly error: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                        };
                        readonly message: {
                            readonly type: "string";
                        };
                        readonly stack: {
                            readonly type: "string";
                        };
                        readonly code: {
                            readonly type: "string";
                        };
                    };
                };
                readonly actor: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly context: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            actorId?: string;
                        };
                    }) => string | undefined;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            tenantId?: string;
                        };
                    }) => string | undefined;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["logId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly byTrace: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["correlationId"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byParent: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["parentLogId"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byEntity: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["entityName", "entityId"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byLevel: {
                    readonly index: "gsi4";
                    readonly pk: {
                        readonly field: "gsi4pk";
                        readonly composite: readonly ["level"];
                    };
                    readonly sk: {
                        readonly field: "gsi4sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byType: {
                    readonly index: "gsi5";
                    readonly pk: {
                        readonly field: "gsi5pk";
                        readonly composite: readonly ["type"];
                    };
                    readonly sk: {
                        readonly field: "gsi5sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly bySource: {
                    readonly index: "gsi6";
                    readonly pk: {
                        readonly field: "gsi6pk";
                        readonly composite: readonly ["source"];
                    };
                    readonly sk: {
                        readonly field: "gsi6sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byTenant: {
                    readonly index: "gsi7";
                    readonly pk: {
                        readonly field: "gsi7pk";
                        readonly composite: readonly ["tenantId"];
                    };
                    readonly sk: {
                        readonly field: "gsi7sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byActor: {
                    readonly index: "gsi8";
                    readonly pk: {
                        readonly field: "gsi8pk";
                        readonly composite: readonly ["actorId"];
                    };
                    readonly sk: {
                        readonly field: "gsi8sk";
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
     * Get workflow history
     */
    getWorkflowHistory(workflowId: string, pagination?: Pagination): Promise<{
        query: import("../../entity/query-types").EntityQuery<{
            readonly model: {
                readonly version: "1";
                readonly entity: "observabilityLog";
                readonly entityNamePlural: "observabilityLogs";
                readonly service: "observability";
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
                readonly excludeFromAdminMenu: true;
                readonly excludeFromAdminCreate: true;
                readonly excludeFromAdminUpdate: true;
                readonly excludeFromAdminDelete: true;
                readonly CRUDApiPath: "/system/observability";
                readonly search: {
                    readonly enabled: true;
                    readonly indexConfig: {
                        readonly primaryKey: "logId";
                    };
                };
            };
            readonly attributes: {
                readonly logId: {
                    readonly type: "string";
                    readonly required: true;
                    readonly isIdentifier: true;
                    readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
                };
                readonly parentLogId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly correlationId: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly subType: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly level: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly entityName: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly entityId: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly operation: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly status: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly success: {
                    readonly type: "boolean";
                    readonly required: false;
                };
                readonly timestampMs: {
                    readonly type: "number";
                    readonly required: true;
                    readonly default: () => number;
                };
                readonly durationMs: {
                    readonly type: "number";
                    readonly required: false;
                };
                readonly source: {
                    readonly type: "string";
                    readonly required: false;
                };
                readonly tags: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metrics: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly attributes: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly data: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly metadata: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly error: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {
                        readonly type: {
                            readonly type: "string";
                        };
                        readonly message: {
                            readonly type: "string";
                        };
                        readonly stack: {
                            readonly type: "string";
                        };
                        readonly code: {
                            readonly type: "string";
                        };
                    };
                };
                readonly actor: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly context: {
                    readonly type: "map";
                    readonly required: false;
                    readonly properties: {};
                };
                readonly actorId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            actorId?: string;
                        };
                    }) => string | undefined;
                };
                readonly tenantId: {
                    readonly type: "string";
                    readonly required: false;
                    readonly watch: readonly ["actor"];
                    readonly set: (_: unknown, data: {
                        actor?: {
                            tenantId?: string;
                        };
                    }) => string | undefined;
                };
                readonly ttl: {
                    readonly type: "number";
                    readonly required: false;
                    readonly default: () => number;
                };
            };
            readonly indexes: {
                readonly primary: {
                    readonly pk: {
                        readonly field: "pk";
                        readonly composite: readonly ["logId"];
                    };
                    readonly sk: {
                        readonly field: "sk";
                        readonly composite: readonly [];
                    };
                };
                readonly byTrace: {
                    readonly index: "gsi1";
                    readonly pk: {
                        readonly field: "gsi1pk";
                        readonly composite: readonly ["correlationId"];
                    };
                    readonly sk: {
                        readonly field: "gsi1sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byParent: {
                    readonly index: "gsi2";
                    readonly pk: {
                        readonly field: "gsi2pk";
                        readonly composite: readonly ["parentLogId"];
                    };
                    readonly sk: {
                        readonly field: "gsi2sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byEntity: {
                    readonly index: "gsi3";
                    readonly pk: {
                        readonly field: "gsi3pk";
                        readonly composite: readonly ["entityName", "entityId"];
                    };
                    readonly sk: {
                        readonly field: "gsi3sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byLevel: {
                    readonly index: "gsi4";
                    readonly pk: {
                        readonly field: "gsi4pk";
                        readonly composite: readonly ["level"];
                    };
                    readonly sk: {
                        readonly field: "gsi4sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byType: {
                    readonly index: "gsi5";
                    readonly pk: {
                        readonly field: "gsi5pk";
                        readonly composite: readonly ["type"];
                    };
                    readonly sk: {
                        readonly field: "gsi5sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly bySource: {
                    readonly index: "gsi6";
                    readonly pk: {
                        readonly field: "gsi6pk";
                        readonly composite: readonly ["source"];
                    };
                    readonly sk: {
                        readonly field: "gsi6sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byTenant: {
                    readonly index: "gsi7";
                    readonly pk: {
                        readonly field: "gsi7pk";
                        readonly composite: readonly ["tenantId"];
                    };
                    readonly sk: {
                        readonly field: "gsi7sk";
                        readonly composite: readonly ["timestampMs"];
                    };
                };
                readonly byActor: {
                    readonly index: "gsi8";
                    readonly pk: {
                        readonly field: "gsi8pk";
                        readonly composite: readonly ["actorId"];
                    };
                    readonly sk: {
                        readonly field: "gsi8sk";
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
     * Get trace with reconstructed spans
     */
    getTraceWithSpans(correlationId: string): Promise<ReconstructedSpan[]>;
    /**
     * Reconstruct span hierarchy from flat records
     */
    reconstructSpans(records: ReadonlyArray<LogRecord>): ReconstructedSpan[];
    private toRecord;
    private toNumberRecord;
}
export {};
