/**
 * Observability Log Entity Schema
 * 
 * DynamoDB table schema for storing all observability events.
 * Used by ObservabilityLogService which is self-contained (no DI dependency).
 */

import { randomUUID } from 'crypto';
import { DefaultEntityOperations, createEntitySchema } from '../../entity';
import { ConfigManager } from '../config';

/**
 * Get TTL in days from config
 */
export function getTtlDays(): number {
  return ConfigManager.fromEnvironment().dynamodb.ttlDays;
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
export const ObservabilityLogEntitySchema = createEntitySchema({
  model: {
    version: '1',
    entity: 'observabilityLog',
    entityNamePlural: 'observabilityLogs',
    service: 'observability',
    entityOperations: DefaultEntityOperations,
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
      default: () => randomUUID(),
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
      watch: [ 'actor' ],
      set: (_: unknown, data: { actor?: { actorId?: string } }) => data.actor?.actorId ?? undefined,
    },
    tenantId: {
      type: 'string',
      required: false,
      watch: [ 'actor' ],
      set: (_: unknown, data: { actor?: { tenantId?: string } }) => data.actor?.tenantId ?? undefined,
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
      pk: { field: 'pk', composite: [ 'logId' ] },
      sk: { field: 'sk', composite: [] },
    },
    // GSI1 - by correlation (trace) - get all events in a trace
    byTrace: {
      index: 'gsi1',
      pk: { field: 'gsi1pk', composite: [ 'correlationId' ] },
      sk: { field: 'gsi1sk', composite: [ 'timestampMs' ] },
    },
    // GSI2 - by parent (hierarchy) - get children of a log
    byParent: {
      index: 'gsi2',
      pk: { field: 'gsi2pk', composite: [ 'parentLogId' ] },
      sk: { field: 'gsi2sk', composite: [ 'timestampMs' ] },
    },
    // GSI3 - by entity - get history of an entity
    byEntity: {
      index: 'gsi3',
      pk: { field: 'gsi3pk', composite: [ 'entityName', 'entityId' ] },
      sk: { field: 'gsi3sk', composite: [ 'timestampMs' ] },
    },
    // GSI4 - by level - get all errors, warnings, etc.
    byLevel: {
      index: 'gsi4',
      pk: { field: 'gsi4pk', composite: [ 'level' ] },
      sk: { field: 'gsi4sk', composite: [ 'timestampMs' ] },
    },
    // GSI5 - by type - get all events of a type
    byType: {
      index: 'gsi5',
      pk: { field: 'gsi5pk', composite: [ 'type' ] },
      sk: { field: 'gsi5sk', composite: [ 'timestampMs' ] },
    },
    // GSI6 - by source - get events from a source
    bySource: {
      index: 'gsi6',
      pk: { field: 'gsi6pk', composite: [ 'source' ] },
      sk: { field: 'gsi6sk', composite: [ 'timestampMs' ] },
    },
    // GSI7 - by tenant - multi-tenant queries
    byTenant: {
      index: 'gsi7',
      pk: { field: 'gsi7pk', composite: [ 'tenantId' ] },
      sk: { field: 'gsi7sk', composite: [ 'timestampMs' ] },
    },
    // GSI8 - by actor - get all actions by an actor
    byActor: {
      index: 'gsi8',
      pk: { field: 'gsi8pk', composite: [ 'actorId' ] },
      sk: { field: 'gsi8sk', composite: [ 'timestampMs' ] },
    },
  },
} as const);

export type ObservabilityLogSchema = typeof ObservabilityLogEntitySchema;