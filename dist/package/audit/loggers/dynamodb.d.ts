import { EntityConfiguration } from 'electrodb';
import { AuditLoggerConfig, AuditOptions, IAuditLogger } from '../interfaces';
export declare const DynamoDBAuditEntityConfiguration: EntityConfiguration;
export declare const DynamoDBAuditEntitySchema: {
    readonly model: {
        readonly version: "1";
        readonly entity: "auditLog";
        readonly entityNamePlural: "auditLogs";
        readonly entityOperations: {
            get: string;
            list: string;
            query: string;
            create: string;
            upsert: string;
            update: string;
            delete: string;
            duplicate: string;
        };
        readonly service: "auditLog";
        readonly excludeFromAdminUpdate: true;
        readonly excludeFromAdminCreate: true;
        readonly excludeFromAdminDelete: true;
        readonly excludeFromAdminMenu: true;
        readonly viewPageColumnsConfig: {
            readonly columns: [{
                readonly sortOrder: 1;
                readonly fields: ["auditId", "entityName", "eventType", "timestamp", "success", "severity", "identifiers", "actor", "data"];
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
        readonly success: {
            readonly type: "boolean";
            readonly required: false;
            readonly isEditable: false;
        };
        readonly severity: {
            readonly type: "string";
            readonly required: false;
            readonly isEditable: false;
        };
        readonly entityName: {
            readonly type: "string";
            readonly required: true;
            readonly isEditable: false;
        };
        readonly eventType: {
            readonly type: "string";
            readonly required: true;
            readonly isEditable: false;
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
            readonly default: () => number;
        };
        readonly data: {
            readonly type: "any";
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
        readonly identifiers: {
            readonly type: "any";
            readonly required: false;
            readonly isEditable: false;
            readonly isListable: false;
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
};
export type AuditEntitySchemaType = typeof DynamoDBAuditEntitySchema;
export declare class DynamoDbAuditLogger implements IAuditLogger {
    private logger;
    private enabled;
    constructor(config: AuditLoggerConfig);
    audit(options: AuditOptions): Promise<void>;
}
