import { EntityConfiguration } from 'electrodb';
export declare const ObservabilityLogEntityConfig: EntityConfiguration;
export declare const ObservabilityLogEntitySchema: {
    readonly model: {
        readonly version: "1";
        readonly entity: "log";
        readonly entityNamePlural: "logs";
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
            readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
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
            readonly default: () => string;
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
        readonly success: {
            readonly type: "boolean";
            readonly required: false;
        };
        readonly status: {
            readonly type: "string";
            readonly required: false;
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
    };
};
export declare const ObservabilityLogEntity: () => import("electrodb").Entity<string, string, string, {
    readonly model: {
        readonly version: "1";
        readonly entity: "log";
        readonly entityNamePlural: "logs";
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
            readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
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
            readonly default: () => string;
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
        readonly success: {
            readonly type: "boolean";
            readonly required: false;
        };
        readonly status: {
            readonly type: "string";
            readonly required: false;
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
    };
}>;
