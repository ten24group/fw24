/**
 * Observability Log Entity Schema
 * 
 * DynamoDB table schema for storing all observability events.
 * Used by ObservabilityLogService which is self-contained (no DI dependency).
 */

import { randomBytes } from 'crypto';
// Import directly from base-entity to avoid circular dependency
import { DefaultEntityOperations, createEntitySchema } from '../../entity/base-entity';

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
        // Only show essential columns for quick scanning
        columns: [
          { field: 'type' },
          { field: 'level' },
          { field: 'entityName' },
          { field: 'source' },
          { field: 'operation' },
          { field: 'status' },
          { field: 'timestampMs' },
          { field: 'durationMs' },
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
      // Sections organized by logical grouping with proper tabs/accordions
      sectionsConfig: {
        sectionGroups: [
          // === 1. OPERATION & TIMING (PRIMARY INFO) ===
          {
            id: 'operation-timing',
            label: 'Operation & Timing',
            icon: 'ThunderboltOutlined',
            sortOrder: 1,
            renderMode: 'tabs',
            defaultCollapsed: true,
            lazyLoad: false,
            keepMounted: true,
            sections: {
              operationDetails: {
                label: 'Operation',
                icon: 'PlayCircleOutlined',
                sortOrder: 1,
                pageType: 'details',
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    'operation',
                    'status',
                    'success',
                    'type',
                    'subType',
                  ],
                },
              },
              entityInfo: {
                label: 'Entity Information',
                icon: 'InfoCircleOutlined',
                sortOrder: 2,
                pageType: 'details',
                visibility: { record: { entityName: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'entityName', 'entityId' ],
                },
              },
              timingDetails: {
                label: 'Timing',
                icon: 'ClockCircleOutlined',
                sortOrder: 3,
                pageType: 'details',
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    'timestampMs',
                    'durationMs',
                  ],
                },
              },
              sourceDetails: {
                label: 'Source',
                icon: 'CodeOutlined',
                sortOrder: 4,
                pageType: 'details',
                visibility: { record: { source: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [
                    'source',
                    'level',
                  ],
                },
              },
              attributes: {
                label: 'Attributes',
                icon: 'TagsOutlined',
                sortOrder: 4,
                pageType: 'details',
                visibility: { record: { attributes: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'attributes' ],
                },
              },
            },
          },
          // === 2. ERROR (Error details) ===
          {
            id: 'error',
            label: 'Error',
            icon: 'ExclamationCircleOutlined',
            sortOrder: 2,
            renderMode: 'tabs',
            defaultCollapsed: false,
            lazyLoad: false,
            keepMounted: true,
            visibility: { record: { error: { exists: true } } },
            sections: {
              error: {
                label: 'Error',
                icon: 'ExclamationCircleOutlined',
                sortOrder: 5,
                pageType: 'details',
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'error' ],
                },
              },
            },
          },
          // === 3. EVENT DATA (Core payloads) ===
          {
            id: 'event-data',
            label: 'Event Data',
            icon: 'FileTextOutlined',
            sortOrder: 3,
            renderMode: 'tabs',
            defaultCollapsed: false,
            lazyLoad: false,
            keepMounted: true,
            visibility: { record: { data: { exists: true } } },
            sections: {
              checkpoints: {
                label: 'Checkpoints',
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
                      label: 'Checkpoints',
                      fieldType: 'timeline',
                      timelineConfig: {
                        mode: 'left',
                        showTimestamp: true,
                        timestampFormat: 'h:mm:ss.SSS A',
                        itemMapping: {
                          labelField: 'name',
                          timestampField: 'ts',
                        },
                      },
                    },
                  ],
                },
              },
              data: {
                label: 'Event Payload',
                icon: 'FileTextOutlined',
                sortOrder: 3,
                pageType: 'details',
                visibility: { record: { data: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'data' ],
                },
              },
            },
          },
          // === 4. HIERARCHY & TRACE RELATIONS ===
          {
            id: 'hierarchy-relations',
            label: 'Hierarchy & Trace',
            icon: 'ApartmentOutlined',
            sortOrder: 4,
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
          // === 5. RELATED LOGS (Entity & Source Analytics) ===
          {
            id: 'related-analytics',
            label: 'Related Logs',
            icon: 'FundOutlined',
            sortOrder: 5,
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
          // === 6. ADDITIONAL DATA (Tags, Metadata, Context) ===
          {
            id: 'additional-data',
            label: 'Additional Data',
            icon: 'FolderOpenOutlined',
            sortOrder: 6,
            renderMode: 'tabs',
            defaultCollapsed: true,
            lazyLoad: false,
            keepMounted: true,
            sections: {
              metrics: {
                label: 'Metrics',
                icon: 'DashboardOutlined',
                sortOrder: 1,
                pageType: 'details',
                visibility: { record: { metrics: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'metrics' ],
                },
              },
              tags: {
                label: 'Tags',
                icon: 'TagOutlined',
                sortOrder: 2,
                pageType: 'details',
                visibility: { record: { tags: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'tags' ],
                },
              },
              metadata: {
                label: 'Metadata',
                icon: 'InfoCircleOutlined',
                sortOrder: 3,
                pageType: 'details',
                visibility: { record: { metadata: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'metadata' ],
                },
              },
              context: {
                label: 'Context',
                icon: 'EnvironmentOutlined',
                sortOrder: 4,
                pageType: 'details',
                visibility: { record: { context: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'context' ],
                },
              },
            },
          },
          // === 7. ACTOR & SYSTEM INFO ===
          {
            id: 'actor-system',
            label: 'Actor & System',
            icon: 'SettingOutlined',
            sortOrder: 7,
            renderMode: 'tabs',
            defaultCollapsed: true,
            lazyLoad: false,
            keepMounted: true,
            sections: {
              actor: {
                label: 'Actor',
                icon: 'UserOutlined',
                sortOrder: 1,
                pageType: 'details',
                visibility: { record: { actor: { exists: true } } },
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'actor' ],
                },
              },
              systemInfo: {
                label: 'System Info',
                icon: 'ClockCircleOutlined',
                sortOrder: 2,
                pageType: 'details',
                detailsPageConfig: {
                  useParentData: true,
                  propertiesConfig: [ 'ttl' ],
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
    // === ACTOR (stored as-is from existing Actor type) ===
    actor: {
      type: 'any',
      label: 'Actor',
      helpText: 'Information about who triggered this event',
    },

    // === CONTEXT ===
    context: {
      type: 'any',
      label: 'Context',
      helpText: 'Execution context and environment information',
    },

    // === TTL ===
    // TTL for auto-cleanup (always provided by backend)
    ttl: {
      type: 'number',
      default: () => Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
      label: 'TTL',
      helpText: 'Time-to-live for automatic cleanup (Unix timestamp)',
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
    // For source/actor/tenant queries - use search engine sync
  },
} as const);

export type ObservabilityLogSchema = typeof ObservabilityLogEntitySchema;