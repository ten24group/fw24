/**
 * Observability Log Entity Schema
 * 
 * DynamoDB table schema for storing all observability events.
 * Used by ObservabilityLogService which is self-contained (no DI dependency).
 */

import { randomBytes } from 'crypto';
// Import directly from base-entity to avoid circular dependency
import { DefaultEntityOperations, createEntitySchema, EntityTypeFromSchema, EntityRecordTypeFromSchema } from '../../entity/base-entity';

/**
 * Observability Log Entity Schema
 * 
 * Universal schema for all observability event types:
 * - span / span.start (distributed tracing)
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
    // System entity - read-only in admin UI
    excludeAuditActions: true,
    excludeFromAdminMenu: true,
    excludeFromAdminCreate: true,
    excludeFromAdminUpdate: true,
    excludeFromAdminDelete: true,
    search: {
      enabled: false,
      indexConfig: {
        primaryKey: 'observabilityLogId',
      }
    },
    // === LIST PAGE CONFIGURATION ===
    listPageConfig: {
      tableConfig: {
        // Default sort: latest records first
        // Search mode uses full config, DB mode extracts just the 'desc' order
        defaultSort: { field: 'timestampMs', order: 'desc' },
        // Row actions - quick access without losing list context
        rowActions: [
          {
            id: 'quick-view',
            label: 'Quick View',
            icon: 'ExpandAltOutlined',
            tooltip: 'Quick View',
            // Open view page in modal - URL will be resolved to fetch config
            url: '/view-observabilitylog/:observabilityLogId',
            openInModal: true,
            modalTitle: 'Log Details',
          },
          {
            id: 'view-trace',
            label: 'View Trace',
            icon: 'ApartmentOutlined',
            tooltip: 'View correlated logs',
            openInModal: true,
            modalTitle: 'Trace Logs',
            visibility: { record: { correlationId: { exists: true } } },
            modalConfigRef: {
              entityName: 'observabilityLog',
              pageType: 'list',
              overrideConfig: {
                defaultFilters: { correlationId: ':correlationId' },
              }
            }
          },
          {
            id: 'view-children',
            label: 'View Children',
            icon: 'BranchesOutlined',
            tooltip: 'View child logs',
            openInModal: true,
            modalTitle: 'Child Logs',
            // Show for logs that don't have a parent (root logs may have children)
            visibility: { record: { parentObservabilityLogId: { exists: false } } },
            // Use modalConfigRef to hide hierarchy segments (conflicts with parent filter)
            modalConfigRef: {
              entityName: 'observabilityLog',
              pageType: 'list',
              overrideConfig: {
                defaultFilters: { parentObservabilityLogId: ':observabilityLogId' },
                hideSegments: [ 'hierarchy-group' ]
              }
            }
          },
        ],
        // Columns for quick scanning — essential fields visible by default
        columns: [
          { field: 'type' },
          { field: 'level' },
          { field: 'entityName' },
          { field: 'source' },
          { field: 'operation' },
          { field: 'status' },
          { field: 'timestampMs' },
          { field: 'durationMs' },
          { field: 'fingerprint', defaultVisible: false },
          { field: 'correlationId', defaultVisible: false },
        ],
        // === FILTER SEGMENTS: Quick access to common views ===
        segments: [
          // === BY HIERARCHY ===
          {
            id: 'hierarchy-group',
            label: 'View',
            segments: [
              {
                id: 'all-spans', label: 'All Events', icon: 'UnorderedListOutlined',
                filters: {},
                default: true
              },
              {
                id: 'root-only', label: 'Root Spans', icon: 'ApartmentOutlined',
                // Filter: no parent = root span
                filters: { parentObservabilityLogId: { exists: false } },
              },
              {
                id: 'child-only', label: 'Child Spans', icon: 'BranchesOutlined',
                // Filter: has parent = child span
                filters: { parentObservabilityLogId: { exists: true } },
              },
            ],
          },
          // === BY LEVEL ===
          {
            id: 'level-group',
            label: 'Level',
            segments: [
              { id: 'all-levels', label: 'All', filters: {}, default: true },
              { id: 'errors', label: 'Errors', icon: 'CloseCircleOutlined', filters: { level: { eq: 'error' } }, badgeStatus: 'error' },
              { id: 'warnings', label: 'Warnings', icon: 'WarningOutlined', filters: { level: { eq: 'warn' } }, badgeStatus: 'warning' },
              { id: 'info', label: 'Info', icon: 'InfoCircleOutlined', filters: { level: { eq: 'info' } } },
              { id: 'debug', label: 'Debug', icon: 'BugOutlined', filters: { level: { eq: 'debug' } } },
              { id: 'trace', label: 'Trace', icon: 'ApartmentOutlined', filters: { level: { eq: 'trace' } } },
            ],
          },
        ],
        expandable: {
          mode: 'json',
        }
      },
    },
    // === VIEW PAGE CONFIGURATION ===
    viewPageConfig: {
      actions: [
        {
          id: 'view-trace',
          label: 'View Full Trace',
          icon: 'ApartmentOutlined',
          tooltip: 'View all events in this trace',
          url: '/list-observabilitylog?correlationId.eq=:correlationId',
          visibility: { record: { correlationId: { exists: true } } },
        },
        {
          id: 'view-parent',
          label: 'Go to Parent',
          icon: 'ArrowUpOutlined',
          tooltip: 'Navigate to the parent span',
          url: '/view-observabilitylog/:parentObservabilityLogId',
          visibility: { record: { parentObservabilityLogId: { exists: true } } },
        },
        {
          id: 'view-same-error',
          label: 'Same Error Pattern',
          icon: 'BugOutlined',
          tooltip: 'View all occurrences of this error fingerprint',
          url: '/list-observabilitylog?fingerprint.eq=:fingerprint',
          visibility: { record: { fingerprint: { exists: true } } },
        },
      ],
      // Two-column layout for essential identification and operation details
      columnsConfig: {
        columns: [
          {
            sortOrder: 1,
            label: 'Identity & Classification',
            fields: [
              'observabilityLogId',
              'type',
              'subType',
              'level',
              'correlationId',  // Has linkConfig - renders as link to trace view
            ],
          },
          {
            sortOrder: 2,
            label: 'Operation & Timing',
            fields: [
              'operation',
              'status',
              'success',
              'timestampMs',
              'durationMs',
              'source',
            ],
          },
        ],
      },
      // Two groups: Event Details (about this record) and Relations (navigation to related records).
      // Within each group, tabs handle domain separation. Structured views come first,
      // raw JSON fallbacks are always available as the last tabs.
      sectionsConfig: {
        sectionGroups: [
          // ══════════════════════════════════════════════════════════════════
          // GROUP 1: EVENT DETAILS — Everything about this specific event
          // ══════════════════════════════════════════════════════════════════
          {
            id: 'event-details',
            label: 'Event Details',
            icon: 'FileSearchOutlined',
            sortOrder: 1,
            renderMode: 'tabs',
            defaultCollapsed: false,
            lazyLoad: false,
            keepMounted: true,
            sections: {
              // NOTE: No "Overview" tab here — the default entity view page already renders
              // core fields (operation, status, type, subType, level, timing, etc.) via columnsConfig.

              // --- Error: structured breakdown + raw ---
              error: {
                label: 'Error',
                icon: 'ExclamationCircleOutlined',
                sortOrder: 1,
                pageType: 'details',
                visibility: { record: { error: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    {
                      name: 'error.type',
                      column: 'error.type',
                      label: 'Error Type',
                      fieldType: 'badge',
                      helpText: 'The class/constructor name of the error',
                    },
                    {
                      name: 'error.message',
                      column: 'error.message',
                      label: 'Message',
                      fieldType: 'text',
                      helpText: 'The error message',
                    },
                    {
                      name: 'error.code',
                      column: 'error.code',
                      label: 'Error Code',
                      fieldType: 'badge',
                      helpText: 'Application or system error code (e.g., ECONNREFUSED, VALIDATION_FAILED)',
                      visibility: { record: { 'error.code': { exists: true } } },
                    },
                    {
                      name: 'error.stack',
                      column: 'error.stack',
                      label: 'Stack Trace',
                      fieldType: 'code',
                      helpText: 'Full stack trace from the error',
                      visibility: { record: { 'error.stack': { exists: true } } },
                    },
                  ],
                },
              },
              // --- Timeline: span checkpoints ---
              timeline: {
                label: 'Timeline',
                icon: 'NodeIndexOutlined',
                sortOrder: 2,
                pageType: 'details',
                visibility: { record: { 'data.checkpoints': { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    {
                      name: 'data.checkpoints',
                      column: 'data.checkpoints',
                      label: 'Timeline & Checkpoints',
                      helpText: 'Chronological timeline of events within this span. Includes manual checkpoints and absorbed child operations.',
                      fieldType: 'timeline',
                      timelineConfig: {
                        mode: 'left',
                        showTimestamp: true,
                        timestampFormat: 'h:mm:ss.SSS A',
                        itemMapping: {
                          labelField: 'name',
                          timestampField: 'ts',
                          typeField: '_type',
                          descriptionField: '_description',
                        },
                      },
                    },
                  ],
                },
              },
              // --- Audit Data: structured view for audit.entity records ---
              auditData: {
                label: 'Audit Data',
                icon: 'AuditOutlined',
                sortOrder: 3,
                pageType: 'details',
                // Only show for audit-type records (audit.entity, audit.compliance, audit.access)
                visibility: { record: { 'tags.audit': { eq: 'true' } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    // Entity update: before / after / diff
                    {
                      name: 'data.before',
                      column: 'data.before',
                      label: 'Before (Old State)',
                      fieldType: 'json',
                      helpText: 'Entity state before the update',
                      visibility: { record: { 'data.before': { exists: true } } },
                    },
                    {
                      name: 'data.after',
                      column: 'data.after',
                      label: 'After (New State)',
                      fieldType: 'json',
                      helpText: 'Entity state after the update',
                      visibility: { record: { 'data.after': { exists: true } } },
                    },
                    {
                      name: 'data.diff',
                      column: 'data.diff',
                      label: 'Diff',
                      fieldType: 'json',
                      helpText: 'Changed fields with old/new values',
                      visibility: { record: { 'data.diff': { exists: true } } },
                    },
                    // Entity create
                    {
                      name: 'data.created',
                      column: 'data.created',
                      label: 'Created Record',
                      fieldType: 'json',
                      helpText: 'Full data of the newly created entity',
                      visibility: { record: { 'data.created': { exists: true } } },
                    },
                    // Entity delete
                    {
                      name: 'data.deleted',
                      column: 'data.deleted',
                      label: 'Deleted Record',
                      fieldType: 'json',
                      helpText: 'Full data of the entity that was deleted',
                      visibility: { record: { 'data.deleted': { exists: true } } },
                    },
                    // Entity list query
                    {
                      name: 'data.query',
                      column: 'data.query',
                      label: 'Query Filters',
                      fieldType: 'json',
                      helpText: 'Filters used in the list/query operation',
                      visibility: { record: { 'data.query': { exists: true } } },
                    },
                    {
                      name: 'data.resultCount',
                      column: 'data.resultCount',
                      label: 'Result Count',
                      fieldType: 'badge',
                      helpText: 'Number of records returned by the query',
                      visibility: { record: { 'data.resultCount': { exists: true } } },
                    },
                    // Raw fallback — full data for any shape
                    'data',
                  ],
                },
              },
              // --- Noise Reduction: absorbed event summary ---
              noiseReduction: {
                label: 'Noise Reduction',
                icon: 'CompressOutlined',
                sortOrder: 4,

                pageType: 'details',
                visibility: { record: { 'data.absorbed': { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    {
                      name: 'data.absorbed.count',
                      column: 'data.absorbed.count',
                      fieldType: 'badge',
                      label: 'Absorbed Events',
                      helpText: 'Total child events absorbed into this record. Per-operation breakdown is in the Timeline tab.',
                    },
                    {
                      name: 'data.absorbed.silentCount',
                      column: 'data.absorbed.silentCount',
                      fieldType: 'badge',
                      label: 'Silenced Events',
                      helpText: 'Total child events silently dropped (counter only)',
                    },
                    {
                      name: 'data.absorbed.errors',
                      column: 'data.absorbed.errors',
                      label: 'Absorbed Errors',
                      helpText: 'Error details from absorbed child events',
                      fieldType: 'json',
                      visibility: { record: { 'data.absorbed.errors': { exists: true } } },
                    },
                    {
                      name: 'data.absorbed.causedByLinks',
                      column: 'data.absorbed.causedByLinks',
                      label: 'Cross-Invocation Links',
                      helpText: 'Correlation IDs from absorbed events linking to other invocations',
                      fieldType: 'json',
                      visibility: { record: { 'data.absorbed.causedByLinks': { exists: true } } },
                    },
                  ],
                },
              },
              // --- Tags: signal badges + raw JSON ---
              tags: {
                label: 'Tags',
                icon: 'TagOutlined',
                sortOrder: 5,
                pageType: 'details',
                visibility: { record: { tags: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    // Structured signal badges (each conditional — only render when present)
                    {
                      name: 'tags.http.status_code',
                      column: 'tags.http.status_code',
                      label: 'HTTP Status Code',
                      fieldType: 'badge',
                      visibility: { record: { 'tags.http.status_code': { exists: true } } },
                    },
                    {
                      name: 'tags.http.status_code_class',
                      column: 'tags.http.status_code_class',
                      label: 'Status Class',
                      fieldType: 'badge',
                      visibility: { record: { 'tags.http.status_code_class': { exists: true } } },
                    },
                    {
                      name: 'tags.error_category',
                      column: 'tags.error_category',
                      label: 'Error Category',
                      fieldType: 'badge',
                      visibility: { record: { 'tags.error_category': { exists: true } } },
                    },
                    {
                      name: 'tags.cold_start',
                      column: 'tags.cold_start',
                      label: 'Cold Start',
                      fieldType: 'badge',
                      visibility: { record: { 'tags.cold_start': { exists: true } } },
                    },
                    {
                      name: 'tags._slow',
                      column: 'tags._slow',
                      label: 'Slow',
                      fieldType: 'badge',
                      visibility: { record: { 'tags._slow': { exists: true } } },
                    },
                    {
                      name: 'tags._memory_pressure',
                      column: 'tags._memory_pressure',
                      label: 'Memory Pressure',
                      fieldType: 'badge',
                      visibility: { record: { 'tags._memory_pressure': { exists: true } } },
                    },
                    {
                      name: 'tags._timeout_risk',
                      column: 'tags._timeout_risk',
                      label: 'Timeout Risk',
                      fieldType: 'badge',
                      visibility: { record: { 'tags._timeout_risk': { exists: true } } },
                    },
                    {
                      name: 'tags.sqs.has_retries',
                      column: 'tags.sqs.has_retries',
                      label: 'SQS Retries',
                      fieldType: 'badge',
                      visibility: { record: { 'tags.sqs.has_retries': { exists: true } } },
                    },
                    {
                      name: 'tags.query_type',
                      column: 'tags.query_type',
                      label: 'Query Type',
                      fieldType: 'badge',
                      visibility: { record: { 'tags.query_type': { exists: true } } },
                    },
                    {
                      name: 'tags.lambda.function_name',
                      column: 'tags.lambda.function_name',
                      label: 'Lambda Function',
                      fieldType: 'text',
                      visibility: { record: { 'tags.lambda.function_name': { exists: true } } },
                    },
                    // Raw fallback — full tags JSON always at the bottom
                    'tags',
                  ],
                },
              },
              // --- Metrics: key values + raw JSON ---
              metrics: {
                label: 'Metrics',
                icon: 'DashboardOutlined',
                sortOrder: 6,
                pageType: 'details',
                visibility: { record: { metrics: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    // Structured key metrics (each conditional)
                    {
                      name: 'metrics.duration',
                      column: 'metrics.duration',
                      label: 'Duration',
                      fieldType: 'duration',
                      durationUnit: 'ms',
                      visibility: { record: { 'metrics.duration': { exists: true } } },
                    },
                    {
                      name: 'metrics.span.depth',
                      column: 'metrics.span.depth',
                      label: 'Span Depth',
                      fieldType: 'badge',
                      visibility: { record: { 'metrics.span.depth': { exists: true } } },
                    },
                    {
                      name: 'metrics.invocation_number',
                      column: 'metrics.invocation_number',
                      label: 'Invocation #',
                      fieldType: 'badge',
                      visibility: { record: { 'metrics.invocation_number': { exists: true } } },
                    },
                    {
                      name: 'metrics.http.request_content_length',
                      column: 'metrics.http.request_content_length',
                      label: 'Request Size (bytes)',
                      fieldType: 'number',
                      visibility: { record: { 'metrics.http.request_content_length': { exists: true } } },
                    },
                    {
                      name: 'metrics.http.response_content_length',
                      column: 'metrics.http.response_content_length',
                      label: 'Response Size (bytes)',
                      fieldType: 'number',
                      visibility: { record: { 'metrics.http.response_content_length': { exists: true } } },
                    },
                    {
                      name: 'metrics.node.heap_used_mb',
                      column: 'metrics.node.heap_used_mb',
                      label: 'Heap Used (MB)',
                      fieldType: 'number',
                      visibility: { record: { 'metrics.node.heap_used_mb': { exists: true } } },
                    },
                    {
                      name: 'metrics.lambda.remaining_time_ms',
                      column: 'metrics.lambda.remaining_time_ms',
                      label: 'Lambda Remaining Time',
                      fieldType: 'duration',
                      durationUnit: 'ms',
                      visibility: { record: { 'metrics.lambda.remaining_time_ms': { exists: true } } },
                    },
                    // Raw fallback — full metrics JSON always at the bottom
                    'metrics',
                  ],
                },
              },
              // --- Event Payload: raw data ---
              payload: {
                label: 'Payload',
                icon: 'FileTextOutlined',
                sortOrder: 7,
                pageType: 'details',
                visibility: { record: { data: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'data' ],
                },
              },
              // --- Actor: structured + raw ---
              actor: {
                label: 'Actor',
                icon: 'UserOutlined',
                sortOrder: 8,
                pageType: 'details',
                visibility: { record: { actor: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    {
                      name: 'actorType',
                      column: 'actor.type',
                      label: 'Actor Type',
                      fieldType: 'badge',
                      visibility: { record: { 'actor.type': { exists: true } } },
                    },
                    {
                      name: 'actorId',
                      column: 'actor.id',
                      label: 'Actor ID',
                      fieldType: 'text',
                      visibility: { record: { 'actor.id': { exists: true } } },
                    },
                    {
                      name: 'actorEmail',
                      column: 'actor.email',
                      label: 'Email',
                      fieldType: 'text',
                      visibility: { record: { 'actor.email': { exists: true } } },
                    },
                    {
                      name: 'actorName',
                      column: 'actor.name',
                      label: 'Name',
                      fieldType: 'text',
                      visibility: { record: { 'actor.name': { exists: true } } },
                    },
                    {
                      name: 'actorGroups',
                      column: 'actor.groups',
                      label: 'Groups',
                      fieldType: 'json',
                      visibility: { record: { 'actor.groups': { exists: true } } },
                    },
                    // Raw fallback — always shows full actor object
                    'actor',
                  ],
                },
              },
              // --- Raw: all remaining fields, always visible ---
              raw: {
                label: 'Raw / Other',
                icon: 'CodeOutlined',
                sortOrder: 9,
                pageType: 'details',
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    'attributes',
                    'metadata',
                    'context',
                    'ttl',
                  ],
                },
              },
            },
          },
          // ══════════════════════════════════════════════════════════════════
          // GROUP 2: HIERARCHY & TRACE (span tree navigation)
          // ══════════════════════════════════════════════════════════════════
          {
            id: 'hierarchy-relations',
            label: 'Hierarchy & Trace',
            icon: 'ApartmentOutlined',
            sortOrder: 2,
            renderMode: 'tabs',
            defaultCollapsed: true,
            lazyLoad: true,
            keepMounted: false,
            sections: {
              hierarchyInfo: {
                label: 'Hierarchy Info',
                icon: 'NodeIndexOutlined',
                sortOrder: 0,
                pageType: 'details',
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    'isRoot',
                    'parentObservabilityLogId',
                    'correlationId',
                    'causedBy',
                  ],
                },
              },
              parentSpan: {
                label: 'Parent Span',
                icon: 'ArrowUpOutlined',
                sortOrder: 1,
                pageType: 'details',
                visibility: { record: { parentObservabilityLogId: { exists: true } } },
                entityConfigRef: {
                  entityName: 'observabilityLog',
                  pageType: 'view',
                  overrideConfig: {
                    identifierMapping: { source: 'parentObservabilityLogId', target: 'id' },
                  },
                },
              },
              siblingSpans: {
                label: 'Sibling Spans',
                icon: 'BlockOutlined',
                sortOrder: 2,
                pageType: 'list',
                visibility: { record: { parentObservabilityLogId: { exists: true } } },
                entityConfigRef: {
                  entityName: 'observabilityLog',
                  pageType: 'list',
                  overrideConfig: {
                    defaultFilters: {
                      parentObservabilityLogId: { eq: ':parentObservabilityLogId' },
                      observabilityLogId: { ne: ':observabilityLogId' },
                    },
                    hideSegments: [ 'hierarchy-group' ],
                    description: 'Other spans at the same hierarchy level (same parent)',
                  },
                },
              },
              childSpans: {
                label: 'Child Spans',
                icon: 'BranchesOutlined',
                sortOrder: 3,
                pageType: 'list',
                entityConfigRef: {
                  entityName: 'observabilityLog',
                  pageType: 'list',
                  overrideConfig: {
                    defaultFilters: { parentObservabilityLogId: { eq: ':observabilityLogId' } },
                    hideSegments: [ 'hierarchy-group' ],
                  },
                },
              },
              rootSpan: {
                label: 'Root of Hierarchy',
                icon: 'GatewayOutlined',
                sortOrder: 4,
                pageType: 'list',
                visibility: { record: { isRoot: { eq: false } } },
                entityConfigRef: {
                  entityName: 'observabilityLog',
                  pageType: 'list',
                  overrideConfig: {
                    defaultFilters: {
                      correlationId: { eq: ':correlationId' },
                      isRoot: { eq: true },
                    },
                    hideSegments: [ 'hierarchy-group' ],
                    description: 'The root span that started this trace hierarchy',
                  },
                },
              },
              traceLogs: {
                label: 'All in This Trace',
                icon: 'ShareAltOutlined',
                sortOrder: 5,
                pageType: 'list',
                visibility: { record: { correlationId: { exists: true } } },
                entityConfigRef: {
                  entityName: 'observabilityLog',
                  pageType: 'list',
                  overrideConfig: {
                    defaultFilters: { correlationId: { eq: ':correlationId' } },
                    hideSegments: [ 'hierarchy-group' ],
                    description: 'All events in this Lambda invocation',
                  },
                },
              },
              causedByTrace: {
                label: 'Causing Request Trace',
                icon: 'LinkOutlined',
                sortOrder: 8,
                pageType: 'list',
                visibility: { record: { causedBy: { exists: true } } },
                entityConfigRef: {
                  entityName: 'observabilityLog',
                  pageType: 'list',
                  overrideConfig: {
                    defaultFilters: { correlationId: { eq: ':causedBy' } },
                    hideSegments: [ 'hierarchy-group' ],
                    description: 'View the original request trace that caused this event',
                  },
                },
              },
              causedEvents: {
                label: 'Events Caused By This',
                icon: 'ApiOutlined',
                sortOrder: 9,
                pageType: 'list',
                entityConfigRef: {
                  entityName: 'observabilityLog',
                  pageType: 'list',
                  overrideConfig: {
                    defaultFilters: { causedBy: { eq: ':correlationId' } },
                    hideSegments: [ 'hierarchy-group' ],
                    description: 'Events in other invocations caused by this request',
                  },
                },
              },
              sameErrorPattern: {
                label: 'Same Error Pattern',
                icon: 'BugOutlined',
                sortOrder: 9.5,
                pageType: 'list',
                visibility: { record: { fingerprint: { exists: true } } },
                entityConfigRef: {
                  entityName: 'observabilityLog',
                  pageType: 'list',
                  overrideConfig: {
                    defaultFilters: { fingerprint: { eq: ':fingerprint' } },
                    hideSegments: [ 'hierarchy-group' ],
                    description: 'All occurrences of this same error pattern across time',
                  },
                },
              },
              relatedTraces: {
                label: 'Related Traces',
                icon: 'ClusterOutlined',
                sortOrder: 10,
                pageType: 'details',
                visibility: { record: { relatedTraces: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'relatedTraces' ],
                },
              },
            },
          },
          // ══════════════════════════════════════════════════════════════════
          // GROUP 3: RELATED LOGS (Entity & Source analytics)
          // ══════════════════════════════════════════════════════════════════
          {
            id: 'related-analytics',
            label: 'Related Logs',
            icon: 'FundOutlined',
            sortOrder: 3,
            renderMode: 'tabs',
            defaultCollapsed: true,
            lazyLoad: false,
            keepMounted: false,
            sections: {
              byEntity: {
                label: 'Entity Logs',
                icon: 'DatabaseOutlined',
                sortOrder: 1,
                pageType: 'list',
                visibility: { record: { entityName: { exists: true } } },
                entityConfigRef: {
                  entityName: 'observabilityLog',
                  pageType: 'list',
                  overrideConfig: {
                    defaultFilters: {
                      entityName: ':entityName',
                      entityId: ':entityId',
                    },
                    hideSegments: [ 'hierarchy-group' ],
                  },
                },
              },
              byEntityType: {
                label: 'Entity Type Logs',
                icon: 'AppstoreOutlined',
                sortOrder: 2,
                pageType: 'list',
                visibility: { record: { entityName: { exists: true } } },
                entityConfigRef: {
                  entityName: 'observabilityLog',
                  pageType: 'list',
                  overrideConfig: {
                    defaultFilters: { entityName: ':entityName' },
                    hideSegments: [ 'hierarchy-group' ],
                  },
                },
              },
              bySource: {
                label: 'Source Logs',
                icon: 'CodeSandboxOutlined',
                sortOrder: 3,
                pageType: 'list',
                visibility: { record: { source: { exists: true } } },
                entityConfigRef: {
                  entityName: 'observabilityLog',
                  pageType: 'list',
                  overrideConfig: {
                    defaultFilters: { source: ':source' },
                    hideSegments: [ 'hierarchy-group' ],
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
  attributes: {
    // === IDENTITY ===
    observabilityLogId: {
      type: 'string',
      required: true,
      isIdentifier: true,
      // 128-bit fallback for manual/admin-created records (framework generally supplies observabilityLogId explicitly).
      default: () => randomBytes(16).toString('hex'),
      label: 'Log ID',
      isFilterable: true,
    },
    parentObservabilityLogId: {
      type: 'string',
      label: 'Parent Log ID',
      helpText: 'Reference to parent span for hierarchical tracing',
      isFilterable: true,
      // Self-referential relation to parent observability log
      relation: {
        entityName: 'observabilityLog',
        type: 'many-to-one',
        identifiers: { source: 'parentObservabilityLogId', target: 'observabilityLogId' },
      },
    },
    // Computed field: true if this is a root span (no parent)
    // Used for efficient GSI queries instead of notExists filter
    isRoot: {
      type: 'boolean',
      label: 'Is Root',
      helpText: 'True if this is a root span (no parent)',
      isFilterable: true,
      watch: [ 'parentObservabilityLogId' ],
      // Set to true when parentObservabilityLogId is null/undefined
      set: (_: unknown, data: { parentObservabilityLogId?: string }) =>
        !data.parentObservabilityLogId,
      default: () => true,  // Default to true if no parent specified
    },
    // NOTE: correlationId is REQUIRED and has NO default.
    // If you're getting validation errors, ensure context is established (auto in controllers).
    // Having a default here would hide bugs where context wasn't properly established.
    correlationId: {
      type: 'string',
      required: true,
      label: 'Correlation ID',
      helpText: 'Unique identifier for the entire request/trace',
      isFilterable: true,
      // NO DEFAULT - must be propagated from context
      // Link to filtered list showing all logs in the same trace
      isLink: true,
      linkConfig: {
        routePattern: '/list-observabilitylog?correlationId.eq=:correlationId',
        displayText: 'View Correlated Logs',
      },
    },
    // Cross-invocation tracing: Correlation ID that caused this event
    // Example: DynamoDB stream audit caused by original API request
    causedBy: {
      type: 'string',
      required: false,
      label: 'Caused By',
      helpText: 'Correlation ID that caused this event (cross-invocation tracing)',
      isFilterable: true,
      isLink: true,
      linkConfig: {
        routePattern: '/list-observabilitylog?correlationId.eq=:causedBy',
        displayText: 'View Causing Request',
      },
    },
    // All related trace IDs for complex workflows
    relatedTraces: {
      type: 'list',
      items: { type: 'string' },
      required: false,
      label: 'Related Traces',
      helpText: 'All related correlation IDs for complex workflows spanning multiple invocations',
      isFilterable: false, // List field, not filterable
    },

    // === CLASSIFICATION ===
    type: {
      type: 'string',
      required: true,
      label: 'Type',
      helpText: 'Event type (span, audit.entity, log, metric, etc.)',
      isFilterable: true,
      isSortable: true,
    },
    subType: {
      type: 'string',
      label: 'Sub-Type',
      helpText: 'Additional type classification',
      isFilterable: true,
    },
    // NOTE: level is REQUIRED and has NO default.
    // The observer MUST specify the level explicitly.
    level: {
      type: 'string',
      required: true,
      label: 'Level',
      helpText: 'Severity level: error, warn, info, debug',
      isFilterable: true,
      isSortable: true,
      // NO DEFAULT - must be specified by observer
    },

    // === ENTITY CONTEXT ===
    entityName: {
      type: 'string',
      label: 'Entity Name',
      helpText: 'Name of the entity this event relates to',
      isFilterable: true,
      isSortable: true,
    },
    entityId: {
      type: 'string',
      label: 'Entity ID',
      helpText: 'ID of the specific entity instance',
      isFilterable: true,
      // Default to '_' when entityName is set but entityId is not (required for byEntity composite index)
      watch: [ 'entityName' ],
      set: (_: unknown, data: { entityName?: string; entityId?: string }) =>
        data.entityId || (data.entityName ? '_' : undefined),
      // Dynamic link to the related entity based on entityName
      linkConfig: {
        routePattern: '/view-:entityName/:entityId',
        displayText: 'View {entityName}',
      },
    },

    // === OPERATION ===
    operation: {
      type: 'string',
      label: 'Operation',
      helpText: 'The operation being performed (e.g., create, update, query)',
      isFilterable: true,
      isSortable: true,
    },
    status: {
      type: 'string',
      label: 'Status',
      helpText: 'Operation status (e.g., started, completed, failed)',
      isFilterable: true,
    },
    success: {
      type: 'boolean',
      label: 'Success',
      helpText: 'Whether the operation completed successfully',
      isFilterable: true,
      fieldType: 'boolean',
      booleanLabels: { true: 'Success', false: 'Failed' },
    },

    // === TIMING ===
    timestampMs: {
      type: 'number',
      required: true,
      default: () => Date.now(),
      label: 'Timestamp',
      helpText: 'Event timestamp in milliseconds since epoch',
      isFilterable: true,
      isSortable: true,
      fieldType: 'datetime',
    },
    durationMs: {
      type: 'number',
      label: 'Duration (ms)',
      helpText: 'Operation duration in milliseconds',
      isFilterable: true,
      isSortable: true,
      fieldType: 'duration',
      durationUnit: 'ms',
    },

    // === SOURCE & TAGS ===
    source: {
      type: 'string',
      label: 'Source',
      helpText: 'Source of the event (e.g., service name, function name)',
      isFilterable: true,
    },
    // NOTE: tags, metrics, attributes, data, metadata, actor, context all use properties:{}
    // This is BY DESIGN - this is a UNIVERSAL store for ALL event types (span, audit,
    // metric, workflow, decision, access, log). Each has completely different payloads.
    // ElectroDB properties:{} = accept any map structure at runtime.
    tags: {
      type: 'any',
      label: 'Tags',
      helpText: 'Key-value tags for categorization',
    },

    // === PAYLOADS (schemaless by design - different event types have different structures) ===
    metrics: {
      type: 'any',
      label: 'Metrics',
      helpText: 'Numerical metrics and measurements',
    },
    attributes: {
      type: 'any',
      label: 'Attributes',
      helpText: 'Additional structured attributes',
    },
    data: {
      type: 'any',
      label: 'Data',
      helpText: 'Event-specific data payload',
      compressed: { threshold: 50 * 1024 }, // Framework auto-compresses if > 50KB
    },
    metadata: {
      type: 'any',
      label: 'Metadata',
      helpText: 'Additional metadata about the event',
      compressed: true, // Framework auto-compresses if > 10KB
    },
    error: {
      type: 'any',
      label: 'Error',
      helpText: 'Error details if the operation failed',
      // Structure: { type: string, message: string, stack?: string, code?: string }
    },
    fingerprint: {
      type: 'string',
      label: 'Error Fingerprint',
      helpText: 'Deterministic hash for grouping same errors across invocations (16 hex chars from SHA-256)',
      isLink: true,
      linkConfig: {
        routePattern: '/list-observabilitylog?fingerprint.eq=:fingerprint',
        displayText: 'View Same Error Pattern',
      },
    },
    // === ACTOR (stored as-is from existing Actor type) ===
    actor: {
      type: 'any',
      label: 'Actor',
      helpText: 'Information about who triggered this event',
    },

    // NOTE: Absorbed data (noise reduction summaries) lives inside `data.absorbed` — no separate attribute.
    // The `data` field already has compression configured, so absorbed data is covered.

    // === CONTEXT ===
    context: {
      type: 'any',
      label: 'Context',
      helpText: 'Execution context and environment information',
    },

    // === TTL ===
    // Tiered retention: TTL varies by severity level.
    //   error/critical -> 90 days, warn -> 60 days, info -> 30 days, debug/trace -> 7 days
    ttl: {
      type: 'number',
      default: () => Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days fallback
      watch: [ 'level' ],
      set: (_: unknown, data: { level?: string }) => {
        const SECONDS_PER_DAY = 24 * 60 * 60;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const retentionDays: Record<string, number> = {
          critical: 90,
          error: 90,
          warn: 60,
          info: 30,
          debug: 7,
          trace: 7,
        };
        const days = retentionDays[ data.level ?? '' ] ?? 90;
        return nowSeconds + (days * SECONDS_PER_DAY);
      },
      label: 'TTL',
      helpText: 'Tiered retention: error/critical 90d, warn 60d, info 30d, debug/trace 7d',
      fieldType: 'ttl',
      ttlUnit: 'seconds',
      ttlFormat: 'auto',
      isVisible: true,
      isEditable: false,
      isListable: true,
    },
  },
  indexes: {
    // === INDEX DESIGN NOTES ===
    // 1. Primary index has no sort key - only for single-item lookups by ID
    // 2. GSI7 (allRecords) provides sorted listing for unfiltered queries
    //    - Uses constant PK template to group all records
    //    - Sorted by timestampMs for efficient chronological listing
    //    - Trade-off: Hot partition, but acceptable for observability logs with TTL
    // 3. All other GSIs are for filtered queries (by trace, parent, type, level, etc.)

    // Primary - by observabilityLogId
    primary: {
      pk: { field: 'pk', composite: [ 'observabilityLogId' ] },
      sk: { field: 'sk', composite: [] },
    },
    // GSI1 - by trace - get all events in a request/trace
    byTrace: {
      index: 'gsi1',
      pk: { field: 'gsi1pk', composite: [ 'correlationId' ] },
      sk: { field: 'gsi1sk', composite: [ 'timestampMs' ] },
    },
    // GSI2 - by parent - get children, reconstruct span hierarchy
    byParent: {
      index: 'gsi2',
      pk: { field: 'gsi2pk', composite: [ 'parentObservabilityLogId' ] },
      sk: { field: 'gsi2sk', composite: [ 'timestampMs' ] },
    },
    // GSI3 - by type - filter by event type (span.*, audit.*, log, metric)
    byType: {
      index: 'gsi3',
      pk: { field: 'gsi3pk', composite: [ 'type' ] },
      sk: { field: 'gsi3sk', composite: [ 'timestampMs' ] },
    },
    // GSI4 - by level - find errors/warnings quickly
    byLevel: {
      index: 'gsi4',
      pk: { field: 'gsi4pk', composite: [ 'level' ] },
      sk: { field: 'gsi4sk', composite: [ 'timestampMs' ] },
    },
    // GSI5 - by entity type - "all Order events", "all User events"
    byEntityType: {
      index: 'gsi5',
      pk: { field: 'gsi5pk', composite: [ 'entityName' ] },
      sk: { field: 'gsi5sk', composite: [ 'timestampMs' ] },
    },
    // GSI6 - by entity instance - "all events for Order:123"
    byEntity: {
      index: 'gsi6',
      pk: { field: 'gsi6pk', composite: [ 'entityName', 'entityId' ] },
      sk: { field: 'gsi6sk', composite: [ 'timestampMs' ] },
    },
    // GSI7 - all records by timestamp - for efficient sorted listing of all events
    // Uses constant partition key to group all records together
    allRecords: {
      index: 'gsi7',
      pk: { field: 'gsi7pk', composite: [], template: 'ALL_EVENTS' },
      sk: { field: 'gsi7sk', composite: [ 'timestampMs' ] },
    },
    // GSI8 - by causedBy - find all events caused by a specific request (cross-invocation tracing)
    byCausedBy: {
      index: 'gsi8',
      pk: { field: 'gsi8pk', composite: [ 'causedBy' ] },
      sk: { field: 'gsi8sk', composite: [ 'timestampMs' ] },
    },
    // GSI9 - by fingerprint - group same errors across invocations
    byFingerprint: {
      index: 'gsi9',
      pk: { field: 'gsi9pk', composite: [ 'fingerprint' ] },
      sk: { field: 'gsi9sk', composite: [ 'timestampMs' ] },
    },
    // For source/actor/tenant queries - use search engine sync
  },
} as const);

export type ObservabilityLogSchema = typeof ObservabilityLogEntitySchema;
export type ObservabilityLogEntityType = EntityTypeFromSchema<ObservabilityLogSchema>;
export type ObservabilityLogRecordType = EntityRecordTypeFromSchema<ObservabilityLogSchema>;