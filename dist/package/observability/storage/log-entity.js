"use strict";
/**
 * Observability Log Entity Schema
 *
 * DynamoDB table schema for storing all observability events.
 * Used by ObservabilityLogService which is self-contained (no DI dependency).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityLogEntitySchema = void 0;
const crypto_1 = require("crypto");
// Import directly from base-entity to avoid circular dependency
const base_entity_1 = require("../../entity/base-entity");
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
exports.ObservabilityLogEntitySchema = (0, base_entity_1.createEntitySchema)({
    model: {
        version: '1',
        entity: 'observabilityLog',
        entityNamePlural: 'observabilityLogs',
        service: 'observability',
        entityOperations: base_entity_1.DefaultEntityOperations,
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
        // TTL for auto-cleanup (always provided by backend)
        ttl: {
            type: 'number',
            required: false,
            default: () => Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLWVudGl0eS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3N0b3JhZ2UvbG9nLWVudGl0eS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7OztBQUVILG1DQUFvQztBQUNwQyxnRUFBZ0U7QUFDaEUsMERBQXVGO0FBRXZGOzs7Ozs7Ozs7OztHQVdHO0FBQ1UsUUFBQSw0QkFBNEIsR0FBRyxJQUFBLGdDQUFrQixFQUFDO0lBQzdELEtBQUssRUFBRTtRQUNMLE9BQU8sRUFBRSxHQUFHO1FBQ1osTUFBTSxFQUFFLGtCQUFrQjtRQUMxQixnQkFBZ0IsRUFBRSxtQkFBbUI7UUFDckMsT0FBTyxFQUFFLGVBQWU7UUFDeEIsZ0JBQWdCLEVBQUUscUNBQXVCO1FBQ3pDLDhDQUE4QztRQUM5QyxvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLFdBQVcsRUFBRSx1QkFBdUI7UUFDcEMsTUFBTSxFQUFFO1lBQ04sT0FBTyxFQUFFLElBQUk7WUFDYixXQUFXLEVBQUU7Z0JBQ1gsVUFBVSxFQUFFLE9BQU87YUFDcEI7U0FDRjtLQUNGO0lBQ0QsVUFBVSxFQUFFO1FBQ1YsbUJBQW1CO1FBQ25CLEtBQUssRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7WUFDZCxZQUFZLEVBQUUsSUFBSTtZQUNsQixPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMsSUFBQSxtQkFBVSxHQUFFO1NBQzVCO1FBQ0QsV0FBVyxFQUFFO1lBQ1gsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsS0FBSztTQUNoQjtRQUNELHNEQUFzRDtRQUN0RCxzRkFBc0Y7UUFDdEYsbUZBQW1GO1FBQ25GLGFBQWEsRUFBRTtZQUNiLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFB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QUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLFFBQVEsQ0FBRSxFQUFFO1lBQ2hELEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7UUFDRCwwQ0FBMEM7UUFDMUMsUUFBUSxFQUFFO1lBQ1IsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLFVBQVUsQ0FBRSxFQUFFO1lBQ2xELEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7UUFDRCxnREFBZ0Q7UUFDaEQsT0FBTyxFQUFFO1lBQ1AsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLFNBQVMsQ0FBRSxFQUFFO1lBQ2pELEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7S0FDRjtDQUNPLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eSBMb2cgRW50aXR5IFNjaGVtYVxuICogXG4gKiBEeW5hbW9EQiB0YWJsZSBzY2hlbWEgZm9yIHN0b3JpbmcgYWxsIG9ic2VydmFiaWxpdHkgZXZlbnRzLlxuICogVXNlZCBieSBPYnNlcnZhYmlsaXR5TG9nU2VydmljZSB3aGljaCBpcyBzZWxmLWNvbnRhaW5lZCAobm8gREkgZGVwZW5kZW5jeSkuXG4gKi9cblxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG4vLyBJbXBvcnQgZGlyZWN0bHkgZnJvbSBiYXNlLWVudGl0eSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5XG5pbXBvcnQgeyBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgY3JlYXRlRW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcblxuLyoqXG4gKiBPYnNlcnZhYmlsaXR5IExvZyBFbnRpdHkgU2NoZW1hXG4gKiBcbiAqIFVuaXZlcnNhbCBzY2hlbWEgZm9yIGFsbCBvYnNlcnZhYmlsaXR5IGV2ZW50IHR5cGVzOlxuICogLSBzcGFuLnN0YXJ0LCBzcGFuLmVuZCwgc3Bhbi5ldmVudCAoZGlzdHJpYnV0ZWQgdHJhY2luZylcbiAqIC0gYXVkaXQuZW50aXR5LCBhdWRpdC5hY3Rpb24sIGF1ZGl0LmNvbXBsaWFuY2UgKGF1ZGl0aW5nKVxuICogLSBtZXRyaWMgKG1ldHJpY3MvY291bnRlcnMpXG4gKiAtIHdvcmtmbG93LiogKHdvcmtmbG93IHRyYWNraW5nKVxuICogLSBkZWNpc2lvbi4qIChkZWNpc2lvbiBsb2dnaW5nKVxuICogLSBhY2Nlc3MgKEFQSSBhY2Nlc3MgbG9ncylcbiAqIC0gbG9nIChzdHJ1Y3R1cmVkIGxvZ2dpbmcpXG4gKi9cbmV4cG9ydCBjb25zdCBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgbW9kZWw6IHtcbiAgICB2ZXJzaW9uOiAnMScsXG4gICAgZW50aXR5OiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgZW50aXR5TmFtZVBsdXJhbDogJ29ic2VydmFiaWxpdHlMb2dzJyxcbiAgICBzZXJ2aWNlOiAnb2JzZXJ2YWJpbGl0eScsXG4gICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgLy8gRXhjbHVkZSBmcm9tIGFkbWluIFVJIC0gdGhpcyBpcyBzeXN0ZW0gZGF0YVxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5NZW51OiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5DcmVhdGU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlOiB0cnVlLFxuICAgIENSVURBcGlQYXRoOiAnL3N5c3RlbS9vYnNlcnZhYmlsaXR5JyxcbiAgICBzZWFyY2g6IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBpbmRleENvbmZpZzoge1xuICAgICAgICBwcmltYXJ5S2V5OiAnbG9nSWQnLFxuICAgICAgfVxuICAgIH0sXG4gIH0sXG4gIGF0dHJpYnV0ZXM6IHtcbiAgICAvLyA9PT0gSURFTlRJVFkgPT09XG4gICAgbG9nSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICBkZWZhdWx0OiAoKSA9PiByYW5kb21VVUlEKCksXG4gICAgfSxcbiAgICBwYXJlbnRMb2dJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcbiAgICAvLyBOT1RFOiBjb3JyZWxhdGlvbklkIGlzIFJFUVVJUkVEIGFuZCBoYXMgTk8gZGVmYXVsdC5cbiAgICAvLyBJZiB5b3UncmUgZ2V0dGluZyB2YWxpZGF0aW9uIGVycm9ycywgZXN0YWJsaXNoIGNvbnRleHQgZmlyc3Qgd2l0aCBydW5XaXRoQ29udGV4dCgpLlxuICAgIC8vIEhhdmluZyBhIGRlZmF1bHQgaGVyZSB3b3VsZCBoaWRlIGJ1Z3Mgd2hlcmUgY29udGV4dCB3YXNuJ3QgcHJvcGVybHkgZXN0YWJsaXNoZWQuXG4gICAgY29ycmVsYXRpb25JZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIC8vIE5PIERFRkFVTFQgLSBtdXN0IGJlIHByb3BhZ2F0ZWQgZnJvbSBjb250ZXh0XG4gICAgfSxcblxuICAgIC8vID09PSBDTEFTU0lGSUNBVElPTiA9PT1cbiAgICB0eXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgIH0sXG4gICAgc3ViVHlwZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcbiAgICAvLyBOT1RFOiBsZXZlbCBpcyBSRVFVSVJFRCBhbmQgaGFzIE5PIGRlZmF1bHQuXG4gICAgLy8gVGhlIG9ic2VydmVyIE1VU1Qgc3BlY2lmeSB0aGUgbGV2ZWwgZXhwbGljaXRseS5cbiAgICBsZXZlbDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIC8vIE5PIERFRkFVTFQgLSBtdXN0IGJlIHNwZWNpZmllZCBieSBvYnNlcnZlclxuICAgIH0sXG5cbiAgICAvLyA9PT0gRU5USVRZIENPTlRFWFQgPT09XG4gICAgZW50aXR5TmFtZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcbiAgICBlbnRpdHlJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcblxuICAgIC8vID09PSBPUEVSQVRJT04gPT09XG4gICAgb3BlcmF0aW9uOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICB9LFxuICAgIHN0YXR1czoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcbiAgICBzdWNjZXNzOiB7XG4gICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcblxuICAgIC8vID09PSBUSU1JTkcgPT09XG4gICAgdGltZXN0YW1wTXM6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBkZWZhdWx0OiAoKSA9PiBEYXRlLm5vdygpLFxuICAgIH0sXG4gICAgZHVyYXRpb25Nczoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcblxuICAgIC8vID09PSBTT1VSQ0UgJiBUQUdTID09PVxuICAgIHNvdXJjZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgfSxcbiAgICAvLyBOT1RFOiB0YWdzLCBtZXRyaWNzLCBhdHRyaWJ1dGVzLCBkYXRhLCBtZXRhZGF0YSwgYWN0b3IsIGNvbnRleHQgYWxsIHVzZSBwcm9wZXJ0aWVzOnt9XG4gICAgLy8gVGhpcyBpcyBCWSBERVNJR04gLSB0aGlzIGlzIGEgVU5JVkVSU0FMIHN0b3JlIGZvciBBTEwgZXZlbnQgdHlwZXMgKHNwYW4sIGF1ZGl0LFxuICAgIC8vIG1ldHJpYywgd29ya2Zsb3csIGRlY2lzaW9uLCBhY2Nlc3MsIGxvZykuIEVhY2ggaGFzIGNvbXBsZXRlbHkgZGlmZmVyZW50IHBheWxvYWRzLlxuICAgIC8vIEVsZWN0cm9EQiBwcm9wZXJ0aWVzOnt9ID0gYWNjZXB0IGFueSBtYXAgc3RydWN0dXJlIGF0IHJ1bnRpbWUuXG4gICAgdGFnczoge1xuICAgICAgdHlwZTogJ21hcCcsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICB9LFxuXG4gICAgLy8gPT09IFBBWUxPQURTIChzY2hlbWFsZXNzIGJ5IGRlc2lnbiAtIGRpZmZlcmVudCBldmVudCB0eXBlcyBoYXZlIGRpZmZlcmVudCBzdHJ1Y3R1cmVzKSA9PT1cbiAgICBtZXRyaWNzOiB7XG4gICAgICB0eXBlOiAnbWFwJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgIH0sXG4gICAgYXR0cmlidXRlczoge1xuICAgICAgdHlwZTogJ21hcCcsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICB9LFxuICAgIGRhdGE6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgfSxcbiAgICBtZXRhZGF0YToge1xuICAgICAgdHlwZTogJ21hcCcsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICB9LFxuICAgIGVycm9yOiB7XG4gICAgICB0eXBlOiAnbWFwJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgdHlwZTogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgICBtZXNzYWdlOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgIHN0YWNrOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgIGNvZGU6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIC8vID09PSBBQ1RPUiAoc3RvcmVkIGFzLWlzIGZyb20gZXhpc3RpbmcgQWN0b3IgdHlwZSkgPT09XG4gICAgYWN0b3I6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgfSxcblxuICAgIC8vID09PSBDT05URVhUID09PVxuICAgIGNvbnRleHQ6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgcHJvcGVydGllczoge30sXG4gICAgfSxcblxuICAgIC8vID09PSBERVJJVkVEIEZJRUxEUyAoZm9yIGluZGV4aW5nKSA9PT1cbiAgICAvLyBUaGVzZSBhcmUgY29tcHV0ZWQgZnJvbSBhY3RvciBmb3IgZWZmaWNpZW50IHF1ZXJ5aW5nXG4gICAgLy8gVXNpbmcgPz8gdW5kZWZpbmVkIHRvIHByZXNlcnZlIGVtcHR5IHN0cmluZ3MgKHx8IHdvdWxkIGNvZXJjZSAnJyB0byB1bmRlZmluZWQpXG4gICAgYWN0b3JJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICB3YXRjaDogWyAnYWN0b3InIF0sXG4gICAgICBzZXQ6IChfOiB1bmtub3duLCBkYXRhOiB7IGFjdG9yPzogeyBhY3RvcklkPzogc3RyaW5nIH0gfSkgPT4gZGF0YS5hY3Rvcj8uYWN0b3JJZCA/PyB1bmRlZmluZWQsXG4gICAgfSxcbiAgICB0ZW5hbnRJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICB3YXRjaDogWyAnYWN0b3InIF0sXG4gICAgICBzZXQ6IChfOiB1bmtub3duLCBkYXRhOiB7IGFjdG9yPzogeyB0ZW5hbnRJZD86IHN0cmluZyB9IH0pID0+IGRhdGEuYWN0b3I/LnRlbmFudElkID8/IHVuZGVmaW5lZCxcbiAgICB9LFxuXG4gICAgLy8gPT09IFRUTCA9PT1cbiAgICAvLyBUVEwgZm9yIGF1dG8tY2xlYW51cCAoYWx3YXlzIHByb3ZpZGVkIGJ5IGJhY2tlbmQpXG4gICAgdHRsOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDkwICogMjQgKiA2MCAqIDYwKSwgLy8gOTAgZGF5c1xuICAgIH0sXG4gIH0sXG4gIGluZGV4ZXM6IHtcbiAgICAvLyBQcmltYXJ5IC0gYnkgbG9nSWRcbiAgICBwcmltYXJ5OiB7XG4gICAgICBwazogeyBmaWVsZDogJ3BrJywgY29tcG9zaXRlOiBbICdsb2dJZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdzaycsIGNvbXBvc2l0ZTogW10gfSxcbiAgICB9LFxuICAgIC8vIEdTSTEgLSBieSBjb3JyZWxhdGlvbiAodHJhY2UpIC0gZ2V0IGFsbCBldmVudHMgaW4gYSB0cmFjZVxuICAgIGJ5VHJhY2U6IHtcbiAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTFwaycsIGNvbXBvc2l0ZTogWyAnY29ycmVsYXRpb25JZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kxc2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0kyIC0gYnkgcGFyZW50IChoaWVyYXJjaHkpIC0gZ2V0IGNoaWxkcmVuIG9mIGEgbG9nXG4gICAgYnlQYXJlbnQ6IHtcbiAgICAgIGluZGV4OiAnZ3NpMicsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTJwaycsIGNvbXBvc2l0ZTogWyAncGFyZW50TG9nSWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpMnNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJMyAtIGJ5IGVudGl0eSAtIGdldCBoaXN0b3J5IG9mIGFuIGVudGl0eVxuICAgIGJ5RW50aXR5OiB7XG4gICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2kzcGsnLCBjb21wb3NpdGU6IFsgJ2VudGl0eU5hbWUnLCAnZW50aXR5SWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpM3NrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNCAtIGJ5IGxldmVsIC0gZ2V0IGFsbCBlcnJvcnMsIHdhcm5pbmdzLCBldGMuXG4gICAgYnlMZXZlbDoge1xuICAgICAgaW5kZXg6ICdnc2k0JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNHBrJywgY29tcG9zaXRlOiBbICdsZXZlbCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k0c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k1IC0gYnkgdHlwZSAtIGdldCBhbGwgZXZlbnRzIG9mIGEgdHlwZVxuICAgIGJ5VHlwZToge1xuICAgICAgaW5kZXg6ICdnc2k1JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNXBrJywgY29tcG9zaXRlOiBbICd0eXBlJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTVzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTYgLSBieSBzb3VyY2UgLSBnZXQgZXZlbnRzIGZyb20gYSBzb3VyY2VcbiAgICBieVNvdXJjZToge1xuICAgICAgaW5kZXg6ICdnc2k2JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNnBrJywgY29tcG9zaXRlOiBbICdzb3VyY2UnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNnNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNyAtIGJ5IHRlbmFudCAtIG11bHRpLXRlbmFudCBxdWVyaWVzXG4gICAgYnlUZW5hbnQ6IHtcbiAgICAgIGluZGV4OiAnZ3NpNycsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTdwaycsIGNvbXBvc2l0ZTogWyAndGVuYW50SWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpN3NrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJOCAtIGJ5IGFjdG9yIC0gZ2V0IGFsbCBhY3Rpb25zIGJ5IGFuIGFjdG9yXG4gICAgYnlBY3Rvcjoge1xuICAgICAgaW5kZXg6ICdnc2k4JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpOHBrJywgY29tcG9zaXRlOiBbICdhY3RvcklkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaThzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICB9LFxufSBhcyBjb25zdCk7XG5cbmV4cG9ydCB0eXBlIE9ic2VydmFiaWxpdHlMb2dTY2hlbWEgPSB0eXBlb2YgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVNjaGVtYTsiXX0=