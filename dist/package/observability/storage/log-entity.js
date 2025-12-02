"use strict";
/**
 * Observability Log Entity Schema
 *
 * DynamoDB table schema for storing all observability events.
 * Used by ObservabilityLogService which is self-contained (no DI dependency).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityLogEntitySchema = void 0;
exports.getTtlDays = getTtlDays;
const crypto_1 = require("crypto");
const entity_1 = require("../../entity");
const config_1 = require("../config");
/**
 * Get TTL in days from config
 */
function getTtlDays() {
    return config_1.ConfigManager.fromEnvironment().dynamodb.ttlDays;
}
/**
 * Observability Log Entity Schema
 *
 * Universal schema for all observability event types:
 * - span.start, span.end, span.event (distributed tracing)
 * - audit.entity, audit.action, audit.compliance (auditing)
 * - metric (metrics/counters)
 * - workflow.* (workflow tracking)
 * - decision.* (decision logging)
 * - access (API access logs)
 * - log (structured logging)
 */
exports.ObservabilityLogEntitySchema = (0, entity_1.createEntitySchema)({
    model: {
        version: '1',
        entity: 'observabilityLog',
        entityNamePlural: 'observabilityLogs',
        service: 'observability',
        entityOperations: entity_1.DefaultEntityOperations,
        // Exclude from admin UI - this is system data
        excludeFromAdminMenu: true,
        excludeFromAdminCreate: true,
        excludeFromAdminUpdate: true,
        excludeFromAdminDelete: true,
        CRUDApiPath: '/system/observability',
        search: {
            enabled: true,
            indexConfig: {
                primaryKey: 'logId',
            }
        },
    },
    attributes: {
        // === IDENTITY ===
        logId: {
            type: 'string',
            required: true,
            isIdentifier: true,
            default: () => (0, crypto_1.randomUUID)(),
        },
        parentLogId: {
            type: 'string',
            required: false,
        },
        // NOTE: correlationId is REQUIRED and has NO default.
        // If you're getting validation errors, establish context first with runWithContext().
        // Having a default here would hide bugs where context wasn't properly established.
        correlationId: {
            type: 'string',
            required: true,
            // NO DEFAULT - must be propagated from context
        },
        // === CLASSIFICATION ===
        type: {
            type: 'string',
            required: true,
        },
        subType: {
            type: 'string',
            required: false,
        },
        // NOTE: level is REQUIRED and has NO default.
        // The observer MUST specify the level explicitly.
        level: {
            type: 'string',
            required: true,
            // NO DEFAULT - must be specified by observer
        },
        // === ENTITY CONTEXT ===
        entityName: {
            type: 'string',
            required: false,
        },
        entityId: {
            type: 'string',
            required: false,
        },
        // === OPERATION ===
        operation: {
            type: 'string',
            required: false,
        },
        status: {
            type: 'string',
            required: false,
        },
        success: {
            type: 'boolean',
            required: false,
        },
        // === TIMING ===
        timestampMs: {
            type: 'number',
            required: true,
            default: () => Date.now(),
        },
        durationMs: {
            type: 'number',
            required: false,
        },
        // === SOURCE & TAGS ===
        source: {
            type: 'string',
            required: false,
        },
        // NOTE: tags, metrics, attributes, data, metadata, actor, context all use properties:{}
        // This is BY DESIGN - this is a UNIVERSAL store for ALL event types (span, audit,
        // metric, workflow, decision, access, log). Each has completely different payloads.
        // ElectroDB properties:{} = accept any map structure at runtime.
        tags: {
            type: 'map',
            required: false,
            properties: {},
        },
        // === PAYLOADS (schemaless by design - different event types have different structures) ===
        metrics: {
            type: 'map',
            required: false,
            properties: {},
        },
        attributes: {
            type: 'map',
            required: false,
            properties: {},
        },
        data: {
            type: 'map',
            required: false,
            properties: {},
        },
        metadata: {
            type: 'map',
            required: false,
            properties: {},
        },
        error: {
            type: 'map',
            required: false,
            properties: {
                type: { type: 'string' },
                message: { type: 'string' },
                stack: { type: 'string' },
                code: { type: 'string' },
            },
        },
        // === ACTOR (stored as-is from existing Actor type) ===
        actor: {
            type: 'map',
            required: false,
            properties: {},
        },
        // === CONTEXT ===
        context: {
            type: 'map',
            required: false,
            properties: {},
        },
        // === DERIVED FIELDS (for indexing) ===
        // These are computed from actor for efficient querying
        // Using ?? undefined to preserve empty strings (|| would coerce '' to undefined)
        actorId: {
            type: 'string',
            required: false,
            watch: ['actor'],
            set: (_, data) => data.actor?.actorId ?? undefined,
        },
        tenantId: {
            type: 'string',
            required: false,
            watch: ['actor'],
            set: (_, data) => data.actor?.tenantId ?? undefined,
        },
        // === TTL ===
        ttl: {
            type: 'number',
            required: false,
            default: () => {
                const ttlDays = getTtlDays();
                return Math.floor(Date.now() / 1000) + (ttlDays * 24 * 60 * 60);
            },
        },
    },
    indexes: {
        // Primary - by logId
        primary: {
            pk: { field: 'pk', composite: ['logId'] },
            sk: { field: 'sk', composite: [] },
        },
        // GSI1 - by correlation (trace) - get all events in a trace
        byTrace: {
            index: 'gsi1',
            pk: { field: 'gsi1pk', composite: ['correlationId'] },
            sk: { field: 'gsi1sk', composite: ['timestampMs'] },
        },
        // GSI2 - by parent (hierarchy) - get children of a log
        byParent: {
            index: 'gsi2',
            pk: { field: 'gsi2pk', composite: ['parentLogId'] },
            sk: { field: 'gsi2sk', composite: ['timestampMs'] },
        },
        // GSI3 - by entity - get history of an entity
        byEntity: {
            index: 'gsi3',
            pk: { field: 'gsi3pk', composite: ['entityName', 'entityId'] },
            sk: { field: 'gsi3sk', composite: ['timestampMs'] },
        },
        // GSI4 - by level - get all errors, warnings, etc.
        byLevel: {
            index: 'gsi4',
            pk: { field: 'gsi4pk', composite: ['level'] },
            sk: { field: 'gsi4sk', composite: ['timestampMs'] },
        },
        // GSI5 - by type - get all events of a type
        byType: {
            index: 'gsi5',
            pk: { field: 'gsi5pk', composite: ['type'] },
            sk: { field: 'gsi5sk', composite: ['timestampMs'] },
        },
        // GSI6 - by source - get events from a source
        bySource: {
            index: 'gsi6',
            pk: { field: 'gsi6pk', composite: ['source'] },
            sk: { field: 'gsi6sk', composite: ['timestampMs'] },
        },
        // GSI7 - by tenant - multi-tenant queries
        byTenant: {
            index: 'gsi7',
            pk: { field: 'gsi7pk', composite: ['tenantId'] },
            sk: { field: 'gsi7sk', composite: ['timestampMs'] },
        },
        // GSI8 - by actor - get all actions by an actor
        byActor: {
            index: 'gsi8',
            pk: { field: 'gsi8pk', composite: ['actorId'] },
            sk: { field: 'gsi8sk', composite: ['timestampMs'] },
        },
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWVudGl0eS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3N0b3JhZ2UvbG9nLWVudGl0eS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7OztBQVNILGdDQUVDO0FBVEQsbUNBQW9DO0FBQ3BDLHlDQUEyRTtBQUMzRSxzQ0FBMEM7QUFFMUM7O0dBRUc7QUFDSCxTQUFnQixVQUFVO0lBQ3hCLE9BQU8sc0JBQWEsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDO0FBQzFELENBQUM7QUFFRDs7Ozs7Ozs7Ozs7R0FXRztBQUNVLFFBQUEsNEJBQTRCLEdBQUcsSUFBQSwyQkFBa0IsRUFBQztJQUM3RCxLQUFLLEVBQUU7UUFDTCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxrQkFBa0I7UUFDMUIsZ0JBQWdCLEVBQUUsbUJBQW1CO1FBQ3JDLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLGdCQUFnQixFQUFFLGdDQUF1QjtRQUN6Qyw4Q0FBOEM7UUFDOUMsb0JBQW9CLEVBQUUsSUFBSTtRQUMxQixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixXQUFXLEVBQUUsdUJBQXVCO1FBQ3BDLE1BQU0sRUFBRTtZQUNOLE9BQU8sRUFBRSxJQUFJO1lBQ2IsV0FBVyxFQUFFO2dCQUNYLFVBQVUsRUFBRSxPQUFPO2FBQ3BCO1NBQ0Y7S0FDRjtJQUNELFVBQVUsRUFBRTtRQUNWLG1CQUFtQjtRQUNuQixLQUFLLEVBQUU7WUFDTCxJQUFJLEVBQUUsUUFBUTtZQUNkLFFBQVEsRUFBRSxJQUFJO1lBQ2QsWUFBWSxFQUFFLElBQUk7WUFDbEIsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUEsbUJBQVUsR0FBRTtTQUM1QjtRQUNELFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRSxRQUFRO1lB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Q0FBRSxFQUFFO1lBQzlDLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7UUFDRCw4Q0FBOEM7UUFDOUMsUUFBUSxFQUFFO1lBQ1IsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLFFBQVEsQ0FBRSxFQUFFO1lBQ2hELEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7UUFDRCwwQ0FBMEM7UUFDMUMsUUFBUSxFQUFFO1lBQ1IsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLFVBQVUsQ0FBRSxFQUFFO1lBQ2xELEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7UUFDRCxnREFBZ0Q7UUFDaEQsT0FBTyxFQUFFO1lBQ1AsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLFNBQVMsQ0FBRSxFQUFFO1lBQ2pELEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7S0FDRjtDQUNPLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eSBMb2cgRW50aXR5IFNjaGVtYVxuICogXG4gKiBEeW5hbW9EQiB0YWJsZSBzY2hlbWEgZm9yIHN0b3JpbmcgYWxsIG9ic2VydmFiaWxpdHkgZXZlbnRzLlxuICogVXNlZCBieSBPYnNlcnZhYmlsaXR5TG9nU2VydmljZSB3aGljaCBpcyBzZWxmLWNvbnRhaW5lZCAobm8gREkgZGVwZW5kZW5jeSkuXG4gKi9cblxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgY3JlYXRlRW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vLi4vZW50aXR5JztcbmltcG9ydCB7IENvbmZpZ01hbmFnZXIgfSBmcm9tICcuLi9jb25maWcnO1xuXG4vKipcbiAqIEdldCBUVEwgaW4gZGF5cyBmcm9tIGNvbmZpZ1xuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0VHRsRGF5cygpOiBudW1iZXIge1xuICByZXR1cm4gQ29uZmlnTWFuYWdlci5mcm9tRW52aXJvbm1lbnQoKS5keW5hbW9kYi50dGxEYXlzO1xufVxuXG4vKipcbiAqIE9ic2VydmFiaWxpdHkgTG9nIEVudGl0eSBTY2hlbWFcbiAqIFxuICogVW5pdmVyc2FsIHNjaGVtYSBmb3IgYWxsIG9ic2VydmFiaWxpdHkgZXZlbnQgdHlwZXM6XG4gKiAtIHNwYW4uc3RhcnQsIHNwYW4uZW5kLCBzcGFuLmV2ZW50IChkaXN0cmlidXRlZCB0cmFjaW5nKVxuICogLSBhdWRpdC5lbnRpdHksIGF1ZGl0LmFjdGlvbiwgYXVkaXQuY29tcGxpYW5jZSAoYXVkaXRpbmcpXG4gKiAtIG1ldHJpYyAobWV0cmljcy9jb3VudGVycylcbiAqIC0gd29ya2Zsb3cuKiAod29ya2Zsb3cgdHJhY2tpbmcpXG4gKiAtIGRlY2lzaW9uLiogKGRlY2lzaW9uIGxvZ2dpbmcpXG4gKiAtIGFjY2VzcyAoQVBJIGFjY2VzcyBsb2dzKVxuICogLSBsb2cgKHN0cnVjdHVyZWQgbG9nZ2luZylcbiAqL1xuZXhwb3J0IGNvbnN0IE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICBtb2RlbDoge1xuICAgIHZlcnNpb246ICcxJyxcbiAgICBlbnRpdHk6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICBlbnRpdHlOYW1lUGx1cmFsOiAnb2JzZXJ2YWJpbGl0eUxvZ3MnLFxuICAgIHNlcnZpY2U6ICdvYnNlcnZhYmlsaXR5JyxcbiAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAvLyBFeGNsdWRlIGZyb20gYWRtaW4gVUkgLSB0aGlzIGlzIHN5c3RlbSBkYXRhXG4gICAgZXhjbHVkZUZyb21BZG1pbk1lbnU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IHRydWUsXG4gICAgQ1JVREFwaVBhdGg6ICcvc3lzdGVtL29ic2VydmFiaWxpdHknLFxuICAgIHNlYXJjaDoge1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIGluZGV4Q29uZmlnOiB7XG4gICAgICAgIHByaW1hcnlLZXk6ICdsb2dJZCcsXG4gICAgICB9XG4gICAgfSxcbiAgfSxcbiAgYXR0cmlidXRlczoge1xuICAgIC8vID09PSBJREVOVElUWSA9PT1cbiAgICBsb2dJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKSxcbiAgICB9LFxuICAgIHBhcmVudExvZ0lkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuICAgIC8vIE5PVEU6IGNvcnJlbGF0aW9uSWQgaXMgUkVRVUlSRUQgYW5kIGhhcyBOTyBkZWZhdWx0LlxuICAgIC8vIElmIHlvdSdyZSBnZXR0aW5nIHZhbGlkYXRpb24gZXJyb3JzLCBlc3RhYmxpc2ggY29udGV4dCBmaXJzdCB3aXRoIHJ1bldpdGhDb250ZXh0KCkuXG4gICAgLy8gSGF2aW5nIGEgZGVmYXVsdCBoZXJlIHdvdWxkIGhpZGUgYnVncyB3aGVyZSBjb250ZXh0IHdhc24ndCBwcm9wZXJseSBlc3RhYmxpc2hlZC5cbiAgICBjb3JyZWxhdGlvbklkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgLy8gTk8gREVGQVVMVCAtIG11c3QgYmUgcHJvcGFnYXRlZCBmcm9tIGNvbnRleHRcbiAgICB9LFxuXG4gICAgLy8gPT09IENMQVNTSUZJQ0FUSU9OID09PVxuICAgIHR5cGU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgfSxcbiAgICBzdWJUeXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuICAgIC8vIE5PVEU6IGxldmVsIGlzIFJFUVVJUkVEIGFuZCBoYXMgTk8gZGVmYXVsdC5cbiAgICAvLyBUaGUgb2JzZXJ2ZXIgTVVTVCBzcGVjaWZ5IHRoZSBsZXZlbCBleHBsaWNpdGx5LlxuICAgIGxldmVsOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgLy8gTk8gREVGQVVMVCAtIG11c3QgYmUgc3BlY2lmaWVkIGJ5IG9ic2VydmVyXG4gICAgfSxcblxuICAgIC8vID09PSBFTlRJVFkgQ09OVEVYVCA9PT1cbiAgICBlbnRpdHlOYW1lOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuICAgIGVudGl0eUlkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuXG4gICAgLy8gPT09IE9QRVJBVElPTiA9PT1cbiAgICBvcGVyYXRpb246IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgIH0sXG4gICAgc3RhdHVzOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuICAgIHN1Y2Nlc3M6IHtcbiAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuXG4gICAgLy8gPT09IFRJTUlORyA9PT1cbiAgICB0aW1lc3RhbXBNczoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KCksXG4gICAgfSxcbiAgICBkdXJhdGlvbk1zOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuXG4gICAgLy8gPT09IFNPVVJDRSAmIFRBR1MgPT09XG4gICAgc291cmNlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuICAgIC8vIE5PVEU6IHRhZ3MsIG1ldHJpY3MsIGF0dHJpYnV0ZXMsIGRhdGEsIG1ldGFkYXRhLCBhY3RvciwgY29udGV4dCBhbGwgdXNlIHByb3BlcnRpZXM6e31cbiAgICAvLyBUaGlzIGlzIEJZIERFU0lHTiAtIHRoaXMgaXMgYSBVTklWRVJTQUwgc3RvcmUgZm9yIEFMTCBldmVudCB0eXBlcyAoc3BhbiwgYXVkaXQsXG4gICAgLy8gbWV0cmljLCB3b3JrZmxvdywgZGVjaXNpb24sIGFjY2VzcywgbG9nKS4gRWFjaCBoYXMgY29tcGxldGVseSBkaWZmZXJlbnQgcGF5bG9hZHMuXG4gICAgLy8gRWxlY3Ryb0RCIHByb3BlcnRpZXM6e30gPSBhY2NlcHQgYW55IG1hcCBzdHJ1Y3R1cmUgYXQgcnVudGltZS5cbiAgICB0YWdzOiB7XG4gICAgICB0eXBlOiAnbWFwJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgIH0sXG5cbiAgICAvLyA9PT0gUEFZTE9BRFMgKHNjaGVtYWxlc3MgYnkgZGVzaWduIC0gZGlmZmVyZW50IGV2ZW50IHR5cGVzIGhhdmUgZGlmZmVyZW50IHN0cnVjdHVyZXMpID09PVxuICAgIG1ldHJpY3M6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICB0eXBlOiAnbWFwJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgIH0sXG4gICAgZGF0YToge1xuICAgICAgdHlwZTogJ21hcCcsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICB9LFxuICAgIG1ldGFkYXRhOiB7XG4gICAgICB0eXBlOiAnbWFwJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgIH0sXG4gICAgZXJyb3I6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICB0eXBlOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgIG1lc3NhZ2U6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgc3RhY2s6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgY29kZTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgfSxcbiAgICB9LFxuXG4gICAgLy8gPT09IEFDVE9SIChzdG9yZWQgYXMtaXMgZnJvbSBleGlzdGluZyBBY3RvciB0eXBlKSA9PT1cbiAgICBhY3Rvcjoge1xuICAgICAgdHlwZTogJ21hcCcsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICB9LFxuXG4gICAgLy8gPT09IENPTlRFWFQgPT09XG4gICAgY29udGV4dDoge1xuICAgICAgdHlwZTogJ21hcCcsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICB9LFxuXG4gICAgLy8gPT09IERFUklWRUQgRklFTERTIChmb3IgaW5kZXhpbmcpID09PVxuICAgIC8vIFRoZXNlIGFyZSBjb21wdXRlZCBmcm9tIGFjdG9yIGZvciBlZmZpY2llbnQgcXVlcnlpbmdcbiAgICAvLyBVc2luZyA/PyB1bmRlZmluZWQgdG8gcHJlc2VydmUgZW1wdHkgc3RyaW5ncyAofHwgd291bGQgY29lcmNlICcnIHRvIHVuZGVmaW5lZClcbiAgICBhY3RvcklkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHdhdGNoOiBbICdhY3RvcicgXSxcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgYWN0b3I/OiB7IGFjdG9ySWQ/OiBzdHJpbmcgfSB9KSA9PiBkYXRhLmFjdG9yPy5hY3RvcklkID8/IHVuZGVmaW5lZCxcbiAgICB9LFxuICAgIHRlbmFudElkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHdhdGNoOiBbICdhY3RvcicgXSxcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgYWN0b3I/OiB7IHRlbmFudElkPzogc3RyaW5nIH0gfSkgPT4gZGF0YS5hY3Rvcj8udGVuYW50SWQgPz8gdW5kZWZpbmVkLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gVFRMID09PVxuICAgIHR0bDoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBkZWZhdWx0OiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHR0bERheXMgPSBnZXRUdGxEYXlzKCk7XG4gICAgICAgIHJldHVybiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICh0dGxEYXlzICogMjQgKiA2MCAqIDYwKTtcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgaW5kZXhlczoge1xuICAgIC8vIFByaW1hcnkgLSBieSBsb2dJZFxuICAgIHByaW1hcnk6IHtcbiAgICAgIHBrOiB7IGZpZWxkOiAncGsnLCBjb21wb3NpdGU6IFsgJ2xvZ0lkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ3NrJywgY29tcG9zaXRlOiBbXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJMSAtIGJ5IGNvcnJlbGF0aW9uICh0cmFjZSkgLSBnZXQgYWxsIGV2ZW50cyBpbiBhIHRyYWNlXG4gICAgYnlUcmFjZToge1xuICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpMXBrJywgY29tcG9zaXRlOiBbICdjb3JyZWxhdGlvbklkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTFzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTIgLSBieSBwYXJlbnQgKGhpZXJhcmNoeSkgLSBnZXQgY2hpbGRyZW4gb2YgYSBsb2dcbiAgICBieVBhcmVudDoge1xuICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpMnBrJywgY29tcG9zaXRlOiBbICdwYXJlbnRMb2dJZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kyc2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0kzIC0gYnkgZW50aXR5IC0gZ2V0IGhpc3Rvcnkgb2YgYW4gZW50aXR5XG4gICAgYnlFbnRpdHk6IHtcbiAgICAgIGluZGV4OiAnZ3NpMycsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTNwaycsIGNvbXBvc2l0ZTogWyAnZW50aXR5TmFtZScsICdlbnRpdHlJZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kzc2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k0IC0gYnkgbGV2ZWwgLSBnZXQgYWxsIGVycm9ycywgd2FybmluZ3MsIGV0Yy5cbiAgICBieUxldmVsOiB7XG4gICAgICBpbmRleDogJ2dzaTQnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k0cGsnLCBjb21wb3NpdGU6IFsgJ2xldmVsJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTRzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTUgLSBieSB0eXBlIC0gZ2V0IGFsbCBldmVudHMgb2YgYSB0eXBlXG4gICAgYnlUeXBlOiB7XG4gICAgICBpbmRleDogJ2dzaTUnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k1cGsnLCBjb21wb3NpdGU6IFsgJ3R5cGUnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNXNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNiAtIGJ5IHNvdXJjZSAtIGdldCBldmVudHMgZnJvbSBhIHNvdXJjZVxuICAgIGJ5U291cmNlOiB7XG4gICAgICBpbmRleDogJ2dzaTYnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k2cGsnLCBjb21wb3NpdGU6IFsgJ3NvdXJjZScgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k2c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k3IC0gYnkgdGVuYW50IC0gbXVsdGktdGVuYW50IHF1ZXJpZXNcbiAgICBieVRlbmFudDoge1xuICAgICAgaW5kZXg6ICdnc2k3JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpN3BrJywgY29tcG9zaXRlOiBbICd0ZW5hbnRJZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k3c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k4IC0gYnkgYWN0b3IgLSBnZXQgYWxsIGFjdGlvbnMgYnkgYW4gYWN0b3JcbiAgICBieUFjdG9yOiB7XG4gICAgICBpbmRleDogJ2dzaTgnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k4cGsnLCBjb21wb3NpdGU6IFsgJ2FjdG9ySWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpOHNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gIH0sXG59IGFzIGNvbnN0KTtcblxuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYSA9IHR5cGVvZiBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hOyJdfQ==