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
                                hideSegments: ['hierarchy-group']
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
                            'correlationId', // Has linkConfig - renders as link to trace view
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
                    // === 2. HIERARCHY & TRACE RELATIONS ===
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
                            parentSpan: {
                                label: 'Parent Span',
                                icon: 'NodeIndexOutlined',
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
                            childSpans: {
                                label: 'Child Spans',
                                icon: 'BranchesOutlined',
                                sortOrder: 2,
                                pageType: 'list',
                                entityConfigRef: {
                                    entityName: 'observabilityLog',
                                    pageType: 'list',
                                    overrideConfig: {
                                        defaultFilters: { parentObservabilityLogId: ':observabilityLogId' },
                                        hideSegments: ['hierarchy-group'],
                                    },
                                },
                            },
                            traceLogs: {
                                label: 'This Trace',
                                icon: 'ShareAltOutlined',
                                sortOrder: 3,
                                pageType: 'list',
                                entityConfigRef: {
                                    entityName: 'observabilityLog',
                                    pageType: 'list',
                                    overrideConfig: {
                                        defaultFilters: { correlationId: ':correlationId' },
                                        hideSegments: ['hierarchy-group'],
                                        description: 'All events in this Lambda invocation',
                                    },
                                },
                            },
                            causedByTrace: {
                                label: 'Causing Request Trace',
                                icon: 'LinkOutlined',
                                sortOrder: 4,
                                pageType: 'list',
                                visibility: { record: { causedBy: { exists: true } } },
                                entityConfigRef: {
                                    entityName: 'observabilityLog',
                                    pageType: 'list',
                                    overrideConfig: {
                                        defaultFilters: { correlationId: ':causedBy' },
                                        hideSegments: ['hierarchy-group'],
                                        description: 'View the original request trace that caused this event',
                                    },
                                },
                            },
                            causedEvents: {
                                label: 'Events Caused By This',
                                icon: 'ApiOutlined',
                                sortOrder: 5,
                                pageType: 'list',
                                entityConfigRef: {
                                    entityName: 'observabilityLog',
                                    pageType: 'list',
                                    overrideConfig: {
                                        defaultFilters: { causedBy: ':correlationId' },
                                        hideSegments: ['hierarchy-group'],
                                        description: 'Events in other invocations caused by this request',
                                    },
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
                        sections: {
                            entityInfo: {
                                label: 'Entity Information',
                                icon: 'InfoCircleOutlined',
                                sortOrder: 1,
                                pageType: 'details',
                                visibility: { record: { entityName: { exists: true } } },
                                detailsPageConfig: {
                                    useParentData: true,
                                    propertiesConfig: ['entityName', 'entityId'],
                                },
                            },
                            data: {
                                label: 'Data',
                                icon: 'FileTextOutlined',
                                sortOrder: 2,
                                pageType: 'details',
                                visibility: { record: { data: { exists: true } } },
                                detailsPageConfig: {
                                    useParentData: true,
                                    propertiesConfig: ['data'],
                                },
                            },
                            attributes: {
                                label: 'Attributes',
                                icon: 'TagsOutlined',
                                sortOrder: 3,
                                pageType: 'details',
                                visibility: { record: { attributes: { exists: true } } },
                                detailsPageConfig: {
                                    useParentData: true,
                                    propertiesConfig: ['attributes'],
                                },
                            },
                            error: {
                                label: 'Error',
                                icon: 'ExclamationCircleOutlined',
                                sortOrder: 4,
                                pageType: 'details',
                                visibility: { record: { error: { exists: true } } },
                                detailsPageConfig: {
                                    useParentData: true,
                                    propertiesConfig: ['error'],
                                },
                            },
                        },
                    },
                    // === 5. ADDITIONAL DATA (Tags, Metadata, Context) ===
                    {
                        id: 'additional-data',
                        label: 'Additional Data',
                        icon: 'FolderOpenOutlined',
                        sortOrder: 5,
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
                                    propertiesConfig: ['metrics'],
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
                                    propertiesConfig: ['tags'],
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
                                    propertiesConfig: ['metadata'],
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
                                    propertiesConfig: ['context'],
                                },
                            },
                        },
                    },
                    // === 6. RELATED LOGS (Entity & Source Analytics) ===
                    {
                        id: 'related-analytics',
                        label: 'Related Logs',
                        icon: 'FundOutlined',
                        sortOrder: 6,
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
                                        hideSegments: ['hierarchy-group'],
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
                                        hideSegments: ['hierarchy-group'],
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
                                        hideSegments: ['hierarchy-group'],
                                    },
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
                                    propertiesConfig: ['actor'],
                                },
                            },
                            systemInfo: {
                                label: 'System Info',
                                icon: 'ClockCircleOutlined',
                                sortOrder: 2,
                                pageType: 'details',
                                detailsPageConfig: {
                                    useParentData: true,
                                    propertiesConfig: ['ttl'],
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
            default: () => (0, crypto_1.randomUUID)(),
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
            watch: ['parentObservabilityLogId'],
            // Set to true when parentObservabilityLogId is null/undefined
            set: (_, data) => !data.parentObservabilityLogId,
            default: () => true, // Default to true if no parent specified
        },
        // NOTE: correlationId is REQUIRED and has NO default.
        // If you're getting validation errors, establish context first with runWithContext().
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
            helpText: 'Event type (span.start, span.end, audit.entity, log, metric, etc.)',
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
            watch: ['entityName'],
            set: (_, data) => data.entityId || (data.entityName ? '_' : undefined),
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
        },
        metadata: {
            type: 'any',
            label: 'Metadata',
            helpText: 'Additional metadata about the event',
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
            fieldType: 'duration',
            durationUnit: 'seconds',
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
            pk: { field: 'pk', composite: ['observabilityLogId'] },
            sk: { field: 'sk', composite: [] },
        },
        // GSI1 - by trace - get all events in a request/trace
        byTrace: {
            index: 'gsi1',
            pk: { field: 'gsi1pk', composite: ['correlationId'] },
            sk: { field: 'gsi1sk', composite: ['timestampMs'] },
        },
        // GSI2 - by parent - get children, reconstruct span hierarchy
        byParent: {
            index: 'gsi2',
            pk: { field: 'gsi2pk', composite: ['parentObservabilityLogId'] },
            sk: { field: 'gsi2sk', composite: ['timestampMs'] },
        },
        // GSI3 - by type - filter by event type (span.*, audit.*, log, metric)
        byType: {
            index: 'gsi3',
            pk: { field: 'gsi3pk', composite: ['type'] },
            sk: { field: 'gsi3sk', composite: ['timestampMs'] },
        },
        // GSI4 - by level - find errors/warnings quickly
        byLevel: {
            index: 'gsi4',
            pk: { field: 'gsi4pk', composite: ['level'] },
            sk: { field: 'gsi4sk', composite: ['timestampMs'] },
        },
        // GSI5 - by entity type - "all Order events", "all User events"
        byEntityType: {
            index: 'gsi5',
            pk: { field: 'gsi5pk', composite: ['entityName'] },
            sk: { field: 'gsi5sk', composite: ['timestampMs'] },
        },
        // GSI6 - by entity instance - "all events for Order:123"
        byEntity: {
            index: 'gsi6',
            pk: { field: 'gsi6pk', composite: ['entityName', 'entityId'] },
            sk: { field: 'gsi6sk', composite: ['timestampMs'] },
        },
        // GSI7 - all records by timestamp - for efficient sorted listing of all events
        // Uses constant partition key to group all records together
        allRecords: {
            index: 'gsi7',
            pk: { field: 'gsi7pk', composite: [], template: 'ALL_EVENTS' },
            sk: { field: 'gsi7sk', composite: ['timestampMs'] },
        },
        // GSI8 - by causedBy - find all events caused by a specific request (cross-invocation tracing)
        byCausedBy: {
            index: 'gsi8',
            pk: { field: 'gsi8pk', composite: ['causedBy'] },
            sk: { field: 'gsi8sk', composite: ['timestampMs'] },
        },
        // For source/actor/tenant queries - use search engine sync
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1sb2ctZW50aXR5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvc3RvcmFnZS9vYnNlcnZhYmlsaXR5LWxvZy1lbnRpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCxtQ0FBb0M7QUFDcEMsZ0VBQWdFO0FBQ2hFLDBEQUF1RjtBQUV2Rjs7Ozs7Ozs7Ozs7R0FXRztBQUNVLFFBQUEsNEJBQTRCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUM3RCxLQUFLLEVBQUU7UUFDTCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxrQkFBa0I7UUFDMUIsZ0JBQWdCLEVBQUUsbUJBQW1CO1FBQ3JDLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6Qyx3Q0FBd0M7UUFDeEMsb0JBQW9CLEVBQUUsSUFBSTtRQUMxQixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixNQUFNLEVBQUU7WUFDTixPQUFPLEVBQUUsS0FBSztZQUNkLFdBQVcsRUFBRTtnQkFDWCxVQUFVLEVBQUUsb0JBQW9CO2FBQ2pDO1NBQ0Y7UUFDRCxrQ0FBa0M7UUFDbEMsY0FBYyxFQUFFO1lBQ2QsV0FBVyxFQUFFO2dCQUNYLHFDQUFxQztnQkFDckMsdUVBQXVFO2dCQUN2RSxXQUFXLEVBQUUsRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUU7Z0JBQ3BELHlEQUF5RDtnQkFDekQsVUFBVSxFQUFFO29CQUNWO3dCQUNFLEVBQUUsRUFBRSxZQUFZO3dCQUNoQixLQUFLLEVBQUUsWUFBWTt3QkFDbkIsSUFBSSxFQUFFLG1CQUFtQjt3QkFDekIsT0FBTyxFQUFFLFlBQVk7d0JBQ3JCLGlFQUFpRTt3QkFDakUsR0FBRyxFQUFFLDRDQUE0Qzt3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UUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLGFBQWEsQ0FBRSxFQUFFO1NBQ3REO1FBQ0QseURBQXlEO1FBQ3pELFFBQVEsRUFBRTtZQUNSLEtBQUssRUFBRSxNQUFNO1lBQ2IsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxZQUFZLEVBQUUsVUFBVSxDQUFFLEVBQUU7WUFDaEUsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUUsRUFBRTtTQUN0RDtRQUNELCtFQUErRTtRQUMvRSw0REFBNEQ7UUFDNUQsVUFBVSxFQUFFO1lBQ1YsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUUsUUFBUSxFQUFFLFlBQVksRUFBRTtZQUM5RCxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLGFBQWEsQ0FBRSxFQUFFO1NBQ3REO1FBQ0QsK0ZBQStGO1FBQy9GLFVBQVUsRUFBRTtZQUNWLEtBQUssRUFBRSxNQUFNO1lBQ2IsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxVQUFVLENBQUUsRUFBRTtZQUNsRCxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLGFBQWEsQ0FBRSxFQUFFO1NBQ3REO1FBQ0QsMkRBQTJEO0tBQzVEO0NBQ08sQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5IExvZyBFbnRpdHkgU2NoZW1hXG4gKiBcbiAqIER5bmFtb0RCIHRhYmxlIHNjaGVtYSBmb3Igc3RvcmluZyBhbGwgb2JzZXJ2YWJpbGl0eSBldmVudHMuXG4gKiBVc2VkIGJ5IE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlIHdoaWNoIGlzIHNlbGYtY29udGFpbmVkIChubyBESSBkZXBlbmRlbmN5KS5cbiAqL1xuXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcbi8vIEltcG9ydCBkaXJlY3RseSBmcm9tIGJhc2UtZW50aXR5IHRvIGF2b2lkIGNpcmN1bGFyIGRlcGVuZGVuY3lcbmltcG9ydCB7IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBjcmVhdGVFbnRpdHlTY2hlbWEgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1lbnRpdHknO1xuXG4vKipcbiAqIE9ic2VydmFiaWxpdHkgTG9nIEVudGl0eSBTY2hlbWFcbiAqIFxuICogVW5pdmVyc2FsIHNjaGVtYSBmb3IgYWxsIG9ic2VydmFiaWxpdHkgZXZlbnQgdHlwZXM6XG4gKiAtIHNwYW4uc3RhcnQsIHNwYW4uZW5kLCBzcGFuLmV2ZW50IChkaXN0cmlidXRlZCB0cmFjaW5nKVxuICogLSBhdWRpdC5lbnRpdHksIGF1ZGl0LmFjdGlvbiwgYXVkaXQuY29tcGxpYW5jZSAoYXVkaXRpbmcpXG4gKiAtIG1ldHJpYyAobWV0cmljcy9jb3VudGVycylcbiAqIC0gd29ya2Zsb3cuKiAod29ya2Zsb3cgdHJhY2tpbmcpXG4gKiAtIGRlY2lzaW9uLiogKGRlY2lzaW9uIGxvZ2dpbmcpXG4gKiAtIGFjY2VzcyAoQVBJIGFjY2VzcyBsb2dzKVxuICogLSBsb2cgKHN0cnVjdHVyZWQgbG9nZ2luZylcbiAqL1xuZXhwb3J0IGNvbnN0IE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICBtb2RlbDoge1xuICAgIHZlcnNpb246ICcxJyxcbiAgICBlbnRpdHk6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICBlbnRpdHlOYW1lUGx1cmFsOiAnb2JzZXJ2YWJpbGl0eUxvZ3MnLFxuICAgIHNlcnZpY2U6ICdvYnNlcnZhYmlsaXR5JyxcbiAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAvLyBTeXN0ZW0gZW50aXR5IC0gcmVhZC1vbmx5IGluIGFkbWluIFVJXG4gICAgZXhjbHVkZUZyb21BZG1pbk1lbnU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IHRydWUsXG4gICAgc2VhcmNoOiB7XG4gICAgICBlbmFibGVkOiBmYWxzZSxcbiAgICAgIGluZGV4Q29uZmlnOiB7XG4gICAgICAgIHByaW1hcnlLZXk6ICdvYnNlcnZhYmlsaXR5TG9nSWQnLFxuICAgICAgfVxuICAgIH0sXG4gICAgLy8gPT09IExJU1QgUEFHRSBDT05GSUdVUkFUSU9OID09PVxuICAgIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgICB0YWJsZUNvbmZpZzoge1xuICAgICAgICAvLyBEZWZhdWx0IHNvcnQ6IGxhdGVzdCByZWNvcmRzIGZpcnN0XG4gICAgICAgIC8vIFNlYXJjaCBtb2RlIHVzZXMgZnVsbCBjb25maWcsIERCIG1vZGUgZXh0cmFjdHMganVzdCB0aGUgJ2Rlc2MnIG9yZGVyXG4gICAgICAgIGRlZmF1bHRTb3J0OiB7IGZpZWxkOiAndGltZXN0YW1wTXMnLCBvcmRlcjogJ2Rlc2MnIH0sXG4gICAgICAgIC8vIFJvdyBhY3Rpb25zIC0gcXVpY2sgYWNjZXNzIHdpdGhvdXQgbG9zaW5nIGxpc3QgY29udGV4dFxuICAgICAgICByb3dBY3Rpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdxdWljay12aWV3JyxcbiAgICAgICAgICAgIGxhYmVsOiAnUXVpY2sgVmlldycsXG4gICAgICAgICAgICBpY29uOiAnRXhwYW5kQWx0T3V0bGluZWQnLFxuICAgICAgICAgICAgdG9vbHRpcDogJ1F1aWNrIFZpZXcnLFxuICAgICAgICAgICAgLy8gT3BlbiB2aWV3IHBhZ2UgaW4gbW9kYWwgLSBVUkwgd2lsbCBiZSByZXNvbHZlZCB0byBmZXRjaCBjb25maWdcbiAgICAgICAgICAgIHVybDogJy92aWV3LW9ic2VydmFiaWxpdHlsb2cvOm9ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgIG1vZGFsVGl0bGU6ICdMb2cgRGV0YWlscycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3ZpZXctdHJhY2UnLFxuICAgICAgICAgICAgbGFiZWw6ICdWaWV3IFRyYWNlJyxcbiAgICAgICAgICAgIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsXG4gICAgICAgICAgICB0b29sdGlwOiAnVmlldyBjb3JyZWxhdGVkIGxvZ3MnLFxuICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICBtb2RhbFRpdGxlOiAnVHJhY2UgTG9ncycsXG4gICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBjb3JyZWxhdGlvbklkOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBjb3JyZWxhdGlvbklkOiAnOmNvcnJlbGF0aW9uSWQnIH0sXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndmlldy1jaGlsZHJlbicsXG4gICAgICAgICAgICBsYWJlbDogJ1ZpZXcgQ2hpbGRyZW4nLFxuICAgICAgICAgICAgaWNvbjogJ0JyYW5jaGVzT3V0bGluZWQnLFxuICAgICAgICAgICAgdG9vbHRpcDogJ1ZpZXcgY2hpbGQgbG9ncycsXG4gICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgIG1vZGFsVGl0bGU6ICdDaGlsZCBMb2dzJyxcbiAgICAgICAgICAgIC8vIFNob3cgZm9yIGxvZ3MgdGhhdCBkb24ndCBoYXZlIGEgcGFyZW50IChyb290IGxvZ3MgbWF5IGhhdmUgY2hpbGRyZW4pXG4gICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiBmYWxzZSB9IH0gfSxcbiAgICAgICAgICAgIC8vIFVzZSBtb2RhbENvbmZpZ1JlZiB0byBoaWRlIGhpZXJhcmNoeSBzZWdtZW50cyAoY29uZmxpY3RzIHdpdGggcGFyZW50IGZpbHRlcilcbiAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICc6b2JzZXJ2YWJpbGl0eUxvZ0lkJyB9LFxuICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICAvLyBPbmx5IHNob3cgZXNzZW50aWFsIGNvbHVtbnMgZm9yIHF1aWNrIHNjYW5uaW5nXG4gICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICB7IGZpZWxkOiAndHlwZScgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnbGV2ZWwnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2VudGl0eU5hbWUnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ3NvdXJjZScgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnb3BlcmF0aW9uJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdzdGF0dXMnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ3RpbWVzdGFtcE1zJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdkdXJhdGlvbk1zJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdjb3JyZWxhdGlvbklkJywgZGVmYXVsdFZpc2libGU6IGZhbHNlIH0sXG4gICAgICAgIF0sXG4gICAgICAgIC8vID09PSBGSUxURVIgU0VHTUVOVFM6IFF1aWNrIGFjY2VzcyB0byBjb21tb24gdmlld3MgPT09XG4gICAgICAgIHNlZ21lbnRzOiBbXG4gICAgICAgICAgLy8gPT09IEJZIEhJRVJBUkNIWSA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2hpZXJhcmNoeS1ncm91cCcsXG4gICAgICAgICAgICBsYWJlbDogJ1ZpZXcnLFxuICAgICAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnYWxsLXNwYW5zJywgbGFiZWw6ICdBbGwgRXZlbnRzJywgaWNvbjogJ1Vub3JkZXJlZExpc3RPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgZmlsdGVyczoge30sXG4gICAgICAgICAgICAgICAgZGVmYXVsdDogdHJ1ZVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaWQ6ICdyb290LW9ubHknLCBsYWJlbDogJ1Jvb3QgU3BhbnMnLCBpY29uOiAnQXBhcnRtZW50T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIC8vIEZpbHRlcjogbm8gcGFyZW50ID0gcm9vdCBzcGFuXG4gICAgICAgICAgICAgICAgZmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiBmYWxzZSB9IH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpZDogJ2NoaWxkLW9ubHknLCBsYWJlbDogJ0NoaWxkIFNwYW5zJywgaWNvbjogJ0JyYW5jaGVzT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIC8vIEZpbHRlcjogaGFzIHBhcmVudCA9IGNoaWxkIHNwYW5cbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IHRydWUgfSB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vID09PSBCWSBMRVZFTCA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2xldmVsLWdyb3VwJyxcbiAgICAgICAgICAgIGxhYmVsOiAnTGV2ZWwnLFxuICAgICAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICAgICAgeyBpZDogJ2FsbC1sZXZlbHMnLCBsYWJlbDogJ0FsbCcsIGZpbHRlcnM6IHt9LCBkZWZhdWx0OiB0cnVlIH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdlcnJvcnMnLCBsYWJlbDogJ0Vycm9ycycsIGljb246ICdDbG9zZUNpcmNsZU91dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ2Vycm9yJyB9IH0sIGJhZGdlU3RhdHVzOiAnZXJyb3InIH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICd3YXJuaW5ncycsIGxhYmVsOiAnV2FybmluZ3MnLCBpY29uOiAnV2FybmluZ091dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ3dhcm4nIH0gfSwgYmFkZ2VTdGF0dXM6ICd3YXJuaW5nJyB9LFxuICAgICAgICAgICAgICB7IGlkOiAnaW5mbycsIGxhYmVsOiAnSW5mbycsIGljb246ICdJbmZvQ2lyY2xlT3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAnaW5mbycgfSB9IH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdkZWJ1ZycsIGxhYmVsOiAnRGVidWcnLCBpY29uOiAnQnVnT3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAnZGVidWcnIH0gfSB9LFxuICAgICAgICAgICAgICB7IGlkOiAndHJhY2UnLCBsYWJlbDogJ1RyYWNlJywgaWNvbjogJ0FwYXJ0bWVudE91dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ3RyYWNlJyB9IH0gfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgZXhwYW5kYWJsZToge1xuICAgICAgICAgIG1vZGU6ICdqc29uJyxcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9LFxuICAgIC8vID09PSBWSUVXIFBBR0UgQ09ORklHVVJBVElPTiA9PT1cbiAgICB2aWV3UGFnZUNvbmZpZzoge1xuICAgICAgLy8gVHdvLWNvbHVtbiBsYXlvdXQgZm9yIGVzc2VudGlhbCBpZGVudGlmaWNhdGlvbiBhbmQgb3BlcmF0aW9uIGRldGFpbHNcbiAgICAgIGNvbHVtbnNDb25maWc6IHtcbiAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgIGxhYmVsOiAnSWRlbnRpdHkgJiBDbGFzc2lmaWNhdGlvbicsXG4gICAgICAgICAgICBmaWVsZHM6IFtcbiAgICAgICAgICAgICAgJ29ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgICAgICd0eXBlJyxcbiAgICAgICAgICAgICAgJ3N1YlR5cGUnLFxuICAgICAgICAgICAgICAnbGV2ZWwnLFxuICAgICAgICAgICAgICAnY29ycmVsYXRpb25JZCcsICAvLyBIYXMgbGlua0NvbmZpZyAtIHJlbmRlcnMgYXMgbGluayB0byB0cmFjZSB2aWV3XG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgbGFiZWw6ICdPcGVyYXRpb24gJiBUaW1pbmcnLFxuICAgICAgICAgICAgZmllbGRzOiBbXG4gICAgICAgICAgICAgICdvcGVyYXRpb24nLFxuICAgICAgICAgICAgICAnc3RhdHVzJyxcbiAgICAgICAgICAgICAgJ3N1Y2Nlc3MnLFxuICAgICAgICAgICAgICAndGltZXN0YW1wTXMnLFxuICAgICAgICAgICAgICAnZHVyYXRpb25NcycsXG4gICAgICAgICAgICAgICdzb3VyY2UnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIC8vIFNlY3Rpb25zIG9yZ2FuaXplZCBieSBsb2dpY2FsIGdyb3VwaW5nIHdpdGggcHJvcGVyIHRhYnMvYWNjb3JkaW9uc1xuICAgICAgc2VjdGlvbnNDb25maWc6IHtcbiAgICAgICAgc2VjdGlvbkdyb3VwczogW1xuICAgICAgICAgIC8vID09PSAyLiBISUVSQVJDSFkgJiBUUkFDRSBSRUxBVElPTlMgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdoaWVyYXJjaHktcmVsYXRpb25zJyxcbiAgICAgICAgICAgIGxhYmVsOiAnSGllcmFyY2h5ICYgVHJhY2UnLFxuICAgICAgICAgICAgaWNvbjogJ0FwYXJ0bWVudE91dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IHRydWUsXG4gICAgICAgICAgICBsYXp5TG9hZDogdHJ1ZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiBmYWxzZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIHBhcmVudFNwYW46IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1BhcmVudCBTcGFuJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnTm9kZUluZGV4T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmc6IHsgc291cmNlOiAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJywgdGFyZ2V0OiAnaWQnIH0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGNoaWxkU3BhbnM6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0NoaWxkIFNwYW5zJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQnJhbmNoZXNPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnOm9ic2VydmFiaWxpdHlMb2dJZCcgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHRyYWNlTG9nczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnVGhpcyBUcmFjZScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1NoYXJlQWx0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMyxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGNvcnJlbGF0aW9uSWQ6ICc6Y29ycmVsYXRpb25JZCcgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQWxsIGV2ZW50cyBpbiB0aGlzIExhbWJkYSBpbnZvY2F0aW9uJyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY2F1c2VkQnlUcmFjZToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ2F1c2luZyBSZXF1ZXN0IFRyYWNlJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnTGlua091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDQsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBjYXVzZWRCeTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgY29ycmVsYXRpb25JZDogJzpjYXVzZWRCeScgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVmlldyB0aGUgb3JpZ2luYWwgcmVxdWVzdCB0cmFjZSB0aGF0IGNhdXNlZCB0aGlzIGV2ZW50JyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY2F1c2VkRXZlbnRzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFdmVudHMgQ2F1c2VkIEJ5IFRoaXMnLFxuICAgICAgICAgICAgICAgIGljb246ICdBcGlPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA1LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgY2F1c2VkQnk6ICc6Y29ycmVsYXRpb25JZCcgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRXZlbnRzIGluIG90aGVyIGludm9jYXRpb25zIGNhdXNlZCBieSB0aGlzIHJlcXVlc3QnLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vID09PSAzLiBFVkVOVCBEQVRBIChDb3JlIHBheWxvYWRzKSA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2V2ZW50LWRhdGEnLFxuICAgICAgICAgICAgbGFiZWw6ICdFdmVudCBEYXRhJyxcbiAgICAgICAgICAgIGljb246ICdGaWxlVGV4dE91dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMyxcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICAgICAgbGF6eUxvYWQ6IGZhbHNlLFxuICAgICAgICAgICAga2VlcE1vdW50ZWQ6IHRydWUsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBlbnRpdHlJbmZvOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFbnRpdHkgSW5mb3JtYXRpb24nLFxuICAgICAgICAgICAgICAgIGljb246ICdJbmZvQ2lyY2xlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGVudGl0eU5hbWU6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnZW50aXR5TmFtZScsICdlbnRpdHlJZCcgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdEYXRhJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRmlsZVRleHRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZGF0YTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICdkYXRhJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0F0dHJpYnV0ZXMnLFxuICAgICAgICAgICAgICAgIGljb246ICdUYWdzT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMyxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGF0dHJpYnV0ZXM6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnYXR0cmlidXRlcycgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBlcnJvcjoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRXJyb3InLFxuICAgICAgICAgICAgICAgIGljb246ICdFeGNsYW1hdGlvbkNpcmNsZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDQsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlcnJvcjogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICdlcnJvcicgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vID09PSA1LiBBRERJVElPTkFMIERBVEEgKFRhZ3MsIE1ldGFkYXRhLCBDb250ZXh0KSA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2FkZGl0aW9uYWwtZGF0YScsXG4gICAgICAgICAgICBsYWJlbDogJ0FkZGl0aW9uYWwgRGF0YScsXG4gICAgICAgICAgICBpY29uOiAnRm9sZGVyT3Blbk91dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogNSxcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IHRydWUsXG4gICAgICAgICAgICBsYXp5TG9hZDogZmFsc2UsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogdHJ1ZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ01ldHJpY3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdEYXNoYm9hcmRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgbWV0cmljczogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICdtZXRyaWNzJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1RhZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdUYWdPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgdGFnczogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICd0YWdzJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdNZXRhZGF0YScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0luZm9DaXJjbGVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAzLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgbWV0YWRhdGE6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnbWV0YWRhdGEnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY29udGV4dDoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ29udGV4dCcsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0Vudmlyb25tZW50T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNCxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGNvbnRleHQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnY29udGV4dCcgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vID09PSA2LiBSRUxBVEVEIExPR1MgKEVudGl0eSAmIFNvdXJjZSBBbmFseXRpY3MpID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAncmVsYXRlZC1hbmFseXRpY3MnLFxuICAgICAgICAgICAgbGFiZWw6ICdSZWxhdGVkIExvZ3MnLFxuICAgICAgICAgICAgaWNvbjogJ0Z1bmRPdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDYsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiB0cnVlLFxuICAgICAgICAgICAgbGF6eUxvYWQ6IGZhbHNlLFxuICAgICAgICAgICAga2VlcE1vdW50ZWQ6IGZhbHNlLFxuICAgICAgICAgICAgc2VjdGlvbnM6IHtcbiAgICAgICAgICAgICAgYnlFbnRpdHk6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0VudGl0eSBMb2dzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRGF0YWJhc2VPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZW50aXR5TmFtZTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnOmVudGl0eU5hbWUnLFxuICAgICAgICAgICAgICAgICAgICAgIGVudGl0eUlkOiAnOmVudGl0eUlkJyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGJ5RW50aXR5VHlwZToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRW50aXR5IFR5cGUgTG9ncycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0FwcHN0b3JlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGVudGl0eU5hbWU6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGVudGl0eU5hbWU6ICc6ZW50aXR5TmFtZScgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGJ5U291cmNlOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdTb3VyY2UgTG9ncycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0NvZGVTYW5kYm94T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMyxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHNvdXJjZTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgc291cmNlOiAnOnNvdXJjZScgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gPT09IDcuIEFDVE9SICYgU1lTVEVNIElORk8gPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdhY3Rvci1zeXN0ZW0nLFxuICAgICAgICAgICAgbGFiZWw6ICdBY3RvciAmIFN5c3RlbScsXG4gICAgICAgICAgICBpY29uOiAnU2V0dGluZ091dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogNyxcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IHRydWUsXG4gICAgICAgICAgICBsYXp5TG9hZDogZmFsc2UsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogdHJ1ZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBY3RvcicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1VzZXJPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgYWN0b3I6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnYWN0b3InIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgc3lzdGVtSW5mbzoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnU3lzdGVtIEluZm8nLFxuICAgICAgICAgICAgICAgIGljb246ICdDbG9ja0NpcmNsZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ3R0bCcgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICBhdHRyaWJ1dGVzOiB7XG4gICAgLy8gPT09IElERU5USVRZID09PVxuICAgIG9ic2VydmFiaWxpdHlMb2dJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKSxcbiAgICAgIGxhYmVsOiAnTG9nIElEJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ1BhcmVudCBMb2cgSUQnLFxuICAgICAgaGVscFRleHQ6ICdSZWZlcmVuY2UgdG8gcGFyZW50IHNwYW4gZm9yIGhpZXJhcmNoaWNhbCB0cmFjaW5nJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIC8vIFNlbGYtcmVmZXJlbnRpYWwgcmVsYXRpb24gdG8gcGFyZW50IG9ic2VydmFiaWxpdHkgbG9nXG4gICAgICByZWxhdGlvbjoge1xuICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gICAgICAgIGlkZW50aWZpZXJzOiB7IHNvdXJjZTogJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsIHRhcmdldDogJ29ic2VydmFiaWxpdHlMb2dJZCcgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBDb21wdXRlZCBmaWVsZDogdHJ1ZSBpZiB0aGlzIGlzIGEgcm9vdCBzcGFuIChubyBwYXJlbnQpXG4gICAgLy8gVXNlZCBmb3IgZWZmaWNpZW50IEdTSSBxdWVyaWVzIGluc3RlYWQgb2Ygbm90RXhpc3RzIGZpbHRlclxuICAgIGlzUm9vdDoge1xuICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgbGFiZWw6ICdJcyBSb290JyxcbiAgICAgIGhlbHBUZXh0OiAnVHJ1ZSBpZiB0aGlzIGlzIGEgcm9vdCBzcGFuIChubyBwYXJlbnQpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIHdhdGNoOiBbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF0sXG4gICAgICAvLyBTZXQgdG8gdHJ1ZSB3aGVuIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBpcyBudWxsL3VuZGVmaW5lZFxuICAgICAgc2V0OiAoXzogdW5rbm93biwgZGF0YTogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ/OiBzdHJpbmcgfSkgPT5cbiAgICAgICAgIWRhdGEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgZGVmYXVsdDogKCkgPT4gdHJ1ZSwgIC8vIERlZmF1bHQgdG8gdHJ1ZSBpZiBubyBwYXJlbnQgc3BlY2lmaWVkXG4gICAgfSxcbiAgICAvLyBOT1RFOiBjb3JyZWxhdGlvbklkIGlzIFJFUVVJUkVEIGFuZCBoYXMgTk8gZGVmYXVsdC5cbiAgICAvLyBJZiB5b3UncmUgZ2V0dGluZyB2YWxpZGF0aW9uIGVycm9ycywgZXN0YWJsaXNoIGNvbnRleHQgZmlyc3Qgd2l0aCBydW5XaXRoQ29udGV4dCgpLlxuICAgIC8vIEhhdmluZyBhIGRlZmF1bHQgaGVyZSB3b3VsZCBoaWRlIGJ1Z3Mgd2hlcmUgY29udGV4dCB3YXNuJ3QgcHJvcGVybHkgZXN0YWJsaXNoZWQuXG4gICAgY29ycmVsYXRpb25JZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGxhYmVsOiAnQ29ycmVsYXRpb24gSUQnLFxuICAgICAgaGVscFRleHQ6ICdVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGVudGlyZSByZXF1ZXN0L3RyYWNlJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIC8vIE5PIERFRkFVTFQgLSBtdXN0IGJlIHByb3BhZ2F0ZWQgZnJvbSBjb250ZXh0XG4gICAgICAvLyBMaW5rIHRvIGZpbHRlcmVkIGxpc3Qgc2hvd2luZyBhbGwgbG9ncyBpbiB0aGUgc2FtZSB0cmFjZVxuICAgICAgaXNMaW5rOiB0cnVlLFxuICAgICAgbGlua0NvbmZpZzoge1xuICAgICAgICByb3V0ZVBhdHRlcm46ICcvbGlzdC1vYnNlcnZhYmlsaXR5bG9nP2NvcnJlbGF0aW9uSWQuZXE9OmNvcnJlbGF0aW9uSWQnLFxuICAgICAgICBkaXNwbGF5VGV4dDogJ1ZpZXcgQ29ycmVsYXRlZCBMb2dzJyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBDcm9zcy1pbnZvY2F0aW9uIHRyYWNpbmc6IENvcnJlbGF0aW9uIElEIHRoYXQgY2F1c2VkIHRoaXMgZXZlbnRcbiAgICAvLyBFeGFtcGxlOiBEeW5hbW9EQiBzdHJlYW0gYXVkaXQgY2F1c2VkIGJ5IG9yaWdpbmFsIEFQSSByZXF1ZXN0XG4gICAgY2F1c2VkQnk6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgbGFiZWw6ICdDYXVzZWQgQnknLFxuICAgICAgaGVscFRleHQ6ICdDb3JyZWxhdGlvbiBJRCB0aGF0IGNhdXNlZCB0aGlzIGV2ZW50IChjcm9zcy1pbnZvY2F0aW9uIHRyYWNpbmcpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzTGluazogdHJ1ZSxcbiAgICAgIGxpbmtDb25maWc6IHtcbiAgICAgICAgcm91dGVQYXR0ZXJuOiAnL2xpc3Qtb2JzZXJ2YWJpbGl0eWxvZz9jb3JyZWxhdGlvbklkLmVxPTpjYXVzZWRCeScsXG4gICAgICAgIGRpc3BsYXlUZXh0OiAnVmlldyBDYXVzaW5nIFJlcXVlc3QnLFxuICAgICAgfSxcbiAgICB9LFxuICAgIC8vIEFsbCByZWxhdGVkIHRyYWNlIElEcyBmb3IgY29tcGxleCB3b3JrZmxvd3NcbiAgICByZWxhdGVkVHJhY2VzOiB7XG4gICAgICB0eXBlOiAnbGlzdCcsXG4gICAgICBpdGVtczogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgbGFiZWw6ICdSZWxhdGVkIFRyYWNlcycsXG4gICAgICBoZWxwVGV4dDogJ0FsbCByZWxhdGVkIGNvcnJlbGF0aW9uIElEcyBmb3IgY29tcGxleCB3b3JrZmxvd3Mgc3Bhbm5pbmcgbXVsdGlwbGUgaW52b2NhdGlvbnMnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiBmYWxzZSwgLy8gTGlzdCBmaWVsZCwgbm90IGZpbHRlcmFibGVcbiAgICB9LFxuXG4gICAgLy8gPT09IENMQVNTSUZJQ0FUSU9OID09PVxuICAgIHR5cGU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBsYWJlbDogJ1R5cGUnLFxuICAgICAgaGVscFRleHQ6ICdFdmVudCB0eXBlIChzcGFuLnN0YXJ0LCBzcGFuLmVuZCwgYXVkaXQuZW50aXR5LCBsb2csIG1ldHJpYywgZXRjLiknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHN1YlR5cGU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdTdWItVHlwZScsXG4gICAgICBoZWxwVGV4dDogJ0FkZGl0aW9uYWwgdHlwZSBjbGFzc2lmaWNhdGlvbicsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICAvLyBOT1RFOiBsZXZlbCBpcyBSRVFVSVJFRCBhbmQgaGFzIE5PIGRlZmF1bHQuXG4gICAgLy8gVGhlIG9ic2VydmVyIE1VU1Qgc3BlY2lmeSB0aGUgbGV2ZWwgZXhwbGljaXRseS5cbiAgICBsZXZlbDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGxhYmVsOiAnTGV2ZWwnLFxuICAgICAgaGVscFRleHQ6ICdTZXZlcml0eSBsZXZlbDogZXJyb3IsIHdhcm4sIGluZm8sIGRlYnVnJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgICAvLyBOTyBERUZBVUxUIC0gbXVzdCBiZSBzcGVjaWZpZWQgYnkgb2JzZXJ2ZXJcbiAgICB9LFxuXG4gICAgLy8gPT09IEVOVElUWSBDT05URVhUID09PVxuICAgIGVudGl0eU5hbWU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdFbnRpdHkgTmFtZScsXG4gICAgICBoZWxwVGV4dDogJ05hbWUgb2YgdGhlIGVudGl0eSB0aGlzIGV2ZW50IHJlbGF0ZXMgdG8nLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIGVudGl0eUlkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnRW50aXR5IElEJyxcbiAgICAgIGhlbHBUZXh0OiAnSUQgb2YgdGhlIHNwZWNpZmljIGVudGl0eSBpbnN0YW5jZScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBEZWZhdWx0IHRvICdfJyB3aGVuIGVudGl0eU5hbWUgaXMgc2V0IGJ1dCBlbnRpdHlJZCBpcyBub3QgKHJlcXVpcmVkIGZvciBieUVudGl0eSBjb21wb3NpdGUgaW5kZXgpXG4gICAgICB3YXRjaDogWyAnZW50aXR5TmFtZScgXSxcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgZW50aXR5TmFtZT86IHN0cmluZzsgZW50aXR5SWQ/OiBzdHJpbmcgfSkgPT5cbiAgICAgICAgZGF0YS5lbnRpdHlJZCB8fCAoZGF0YS5lbnRpdHlOYW1lID8gJ18nIDogdW5kZWZpbmVkKSxcbiAgICAgIC8vIER5bmFtaWMgbGluayB0byB0aGUgcmVsYXRlZCBlbnRpdHkgYmFzZWQgb24gZW50aXR5TmFtZVxuICAgICAgbGlua0NvbmZpZzoge1xuICAgICAgICByb3V0ZVBhdHRlcm46ICcvdmlldy06ZW50aXR5TmFtZS86ZW50aXR5SWQnLFxuICAgICAgICBkaXNwbGF5VGV4dDogJ1ZpZXcge2VudGl0eU5hbWV9JyxcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIC8vID09PSBPUEVSQVRJT04gPT09XG4gICAgb3BlcmF0aW9uOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnT3BlcmF0aW9uJyxcbiAgICAgIGhlbHBUZXh0OiAnVGhlIG9wZXJhdGlvbiBiZWluZyBwZXJmb3JtZWQgKGUuZy4sIGNyZWF0ZSwgdXBkYXRlLCBxdWVyeSknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHN0YXR1czoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ1N0YXR1cycsXG4gICAgICBoZWxwVGV4dDogJ09wZXJhdGlvbiBzdGF0dXMgKGUuZy4sIHN0YXJ0ZWQsIGNvbXBsZXRlZCwgZmFpbGVkKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICBzdWNjZXNzOiB7XG4gICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICBsYWJlbDogJ1N1Y2Nlc3MnLFxuICAgICAgaGVscFRleHQ6ICdXaGV0aGVyIHRoZSBvcGVyYXRpb24gY29tcGxldGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBmaWVsZFR5cGU6ICdib29sZWFuJyxcbiAgICAgIGJvb2xlYW5MYWJlbHM6IHsgdHJ1ZTogJ1N1Y2Nlc3MnLCBmYWxzZTogJ0ZhaWxlZCcgfSxcbiAgICB9LFxuXG4gICAgLy8gPT09IFRJTUlORyA9PT1cbiAgICB0aW1lc3RhbXBNczoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KCksXG4gICAgICBsYWJlbDogJ1RpbWVzdGFtcCcsXG4gICAgICBoZWxwVGV4dDogJ0V2ZW50IHRpbWVzdGFtcCBpbiBtaWxsaXNlY29uZHMgc2luY2UgZXBvY2gnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICAgIGZpZWxkVHlwZTogJ2RhdGV0aW1lJyxcbiAgICB9LFxuICAgIGR1cmF0aW9uTXM6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgbGFiZWw6ICdEdXJhdGlvbiAobXMpJyxcbiAgICAgIGhlbHBUZXh0OiAnT3BlcmF0aW9uIGR1cmF0aW9uIGluIG1pbGxpc2Vjb25kcycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc1NvcnRhYmxlOiB0cnVlLFxuICAgICAgZmllbGRUeXBlOiAnZHVyYXRpb24nLFxuICAgICAgZHVyYXRpb25Vbml0OiAnbXMnLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gU09VUkNFICYgVEFHUyA9PT1cbiAgICBzb3VyY2U6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdTb3VyY2UnLFxuICAgICAgaGVscFRleHQ6ICdTb3VyY2Ugb2YgdGhlIGV2ZW50IChlLmcuLCBzZXJ2aWNlIG5hbWUsIGZ1bmN0aW9uIG5hbWUpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIC8vIE5PVEU6IHRhZ3MsIG1ldHJpY3MsIGF0dHJpYnV0ZXMsIGRhdGEsIG1ldGFkYXRhLCBhY3RvciwgY29udGV4dCBhbGwgdXNlIHByb3BlcnRpZXM6e31cbiAgICAvLyBUaGlzIGlzIEJZIERFU0lHTiAtIHRoaXMgaXMgYSBVTklWRVJTQUwgc3RvcmUgZm9yIEFMTCBldmVudCB0eXBlcyAoc3BhbiwgYXVkaXQsXG4gICAgLy8gbWV0cmljLCB3b3JrZmxvdywgZGVjaXNpb24sIGFjY2VzcywgbG9nKS4gRWFjaCBoYXMgY29tcGxldGVseSBkaWZmZXJlbnQgcGF5bG9hZHMuXG4gICAgLy8gRWxlY3Ryb0RCIHByb3BlcnRpZXM6e30gPSBhY2NlcHQgYW55IG1hcCBzdHJ1Y3R1cmUgYXQgcnVudGltZS5cbiAgICB0YWdzOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnVGFncycsXG4gICAgICBoZWxwVGV4dDogJ0tleS12YWx1ZSB0YWdzIGZvciBjYXRlZ29yaXphdGlvbicsXG4gICAgfSxcblxuICAgIC8vID09PSBQQVlMT0FEUyAoc2NoZW1hbGVzcyBieSBkZXNpZ24gLSBkaWZmZXJlbnQgZXZlbnQgdHlwZXMgaGF2ZSBkaWZmZXJlbnQgc3RydWN0dXJlcykgPT09XG4gICAgbWV0cmljczoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ01ldHJpY3MnLFxuICAgICAgaGVscFRleHQ6ICdOdW1lcmljYWwgbWV0cmljcyBhbmQgbWVhc3VyZW1lbnRzJyxcbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdBdHRyaWJ1dGVzJyxcbiAgICAgIGhlbHBUZXh0OiAnQWRkaXRpb25hbCBzdHJ1Y3R1cmVkIGF0dHJpYnV0ZXMnLFxuICAgIH0sXG4gICAgZGF0YToge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0RhdGEnLFxuICAgICAgaGVscFRleHQ6ICdFdmVudC1zcGVjaWZpYyBkYXRhIHBheWxvYWQnLFxuICAgIH0sXG4gICAgbWV0YWRhdGE6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdNZXRhZGF0YScsXG4gICAgICBoZWxwVGV4dDogJ0FkZGl0aW9uYWwgbWV0YWRhdGEgYWJvdXQgdGhlIGV2ZW50JyxcbiAgICB9LFxuICAgIGVycm9yOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnRXJyb3InLFxuICAgICAgaGVscFRleHQ6ICdFcnJvciBkZXRhaWxzIGlmIHRoZSBvcGVyYXRpb24gZmFpbGVkJyxcbiAgICAgIC8vIFN0cnVjdHVyZTogeyB0eXBlOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZywgc3RhY2s/OiBzdHJpbmcsIGNvZGU/OiBzdHJpbmcgfVxuICAgIH0sXG4gICAgLy8gPT09IEFDVE9SIChzdG9yZWQgYXMtaXMgZnJvbSBleGlzdGluZyBBY3RvciB0eXBlKSA9PT1cbiAgICBhY3Rvcjoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0FjdG9yJyxcbiAgICAgIGhlbHBUZXh0OiAnSW5mb3JtYXRpb24gYWJvdXQgd2hvIHRyaWdnZXJlZCB0aGlzIGV2ZW50JyxcbiAgICB9LFxuXG4gICAgLy8gPT09IENPTlRFWFQgPT09XG4gICAgY29udGV4dDoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0NvbnRleHQnLFxuICAgICAgaGVscFRleHQ6ICdFeGVjdXRpb24gY29udGV4dCBhbmQgZW52aXJvbm1lbnQgaW5mb3JtYXRpb24nLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gVFRMID09PVxuICAgIC8vIFRUTCBmb3IgYXV0by1jbGVhbnVwIChhbHdheXMgcHJvdmlkZWQgYnkgYmFja2VuZClcbiAgICB0dGw6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgZGVmYXVsdDogKCkgPT4gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyAoOTAgKiAyNCAqIDYwICogNjApLCAvLyA5MCBkYXlzXG4gICAgICBsYWJlbDogJ1RUTCcsXG4gICAgICBoZWxwVGV4dDogJ1RpbWUtdG8tbGl2ZSBmb3IgYXV0b21hdGljIGNsZWFudXAgKFVuaXggdGltZXN0YW1wKScsXG4gICAgICBmaWVsZFR5cGU6ICdkdXJhdGlvbicsXG4gICAgICBkdXJhdGlvblVuaXQ6ICdzZWNvbmRzJyxcbiAgICB9LFxuICB9LFxuICBpbmRleGVzOiB7XG4gICAgLy8gPT09IElOREVYIERFU0lHTiBOT1RFUyA9PT1cbiAgICAvLyAxLiBQcmltYXJ5IGluZGV4IGhhcyBubyBzb3J0IGtleSAtIG9ubHkgZm9yIHNpbmdsZS1pdGVtIGxvb2t1cHMgYnkgSURcbiAgICAvLyAyLiBHU0k3IChhbGxSZWNvcmRzKSBwcm92aWRlcyBzb3J0ZWQgbGlzdGluZyBmb3IgdW5maWx0ZXJlZCBxdWVyaWVzXG4gICAgLy8gICAgLSBVc2VzIGNvbnN0YW50IFBLIHRlbXBsYXRlIHRvIGdyb3VwIGFsbCByZWNvcmRzXG4gICAgLy8gICAgLSBTb3J0ZWQgYnkgdGltZXN0YW1wTXMgZm9yIGVmZmljaWVudCBjaHJvbm9sb2dpY2FsIGxpc3RpbmdcbiAgICAvLyAgICAtIFRyYWRlLW9mZjogSG90IHBhcnRpdGlvbiwgYnV0IGFjY2VwdGFibGUgZm9yIG9ic2VydmFiaWxpdHkgbG9ncyB3aXRoIFRUTFxuICAgIC8vIDMuIEFsbCBvdGhlciBHU0lzIGFyZSBmb3IgZmlsdGVyZWQgcXVlcmllcyAoYnkgdHJhY2UsIHBhcmVudCwgdHlwZSwgbGV2ZWwsIGV0Yy4pXG5cbiAgICAvLyBQcmltYXJ5IC0gYnkgb2JzZXJ2YWJpbGl0eUxvZ0lkXG4gICAgcHJpbWFyeToge1xuICAgICAgcGs6IHsgZmllbGQ6ICdwaycsIGNvbXBvc2l0ZTogWyAnb2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ3NrJywgY29tcG9zaXRlOiBbXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJMSAtIGJ5IHRyYWNlIC0gZ2V0IGFsbCBldmVudHMgaW4gYSByZXF1ZXN0L3RyYWNlXG4gICAgYnlUcmFjZToge1xuICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpMXBrJywgY29tcG9zaXRlOiBbICdjb3JyZWxhdGlvbklkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTFzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTIgLSBieSBwYXJlbnQgLSBnZXQgY2hpbGRyZW4sIHJlY29uc3RydWN0IHNwYW4gaGllcmFyY2h5XG4gICAgYnlQYXJlbnQ6IHtcbiAgICAgIGluZGV4OiAnZ3NpMicsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTJwaycsIGNvbXBvc2l0ZTogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTJzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTMgLSBieSB0eXBlIC0gZmlsdGVyIGJ5IGV2ZW50IHR5cGUgKHNwYW4uKiwgYXVkaXQuKiwgbG9nLCBtZXRyaWMpXG4gICAgYnlUeXBlOiB7XG4gICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2kzcGsnLCBjb21wb3NpdGU6IFsgJ3R5cGUnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpM3NrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNCAtIGJ5IGxldmVsIC0gZmluZCBlcnJvcnMvd2FybmluZ3MgcXVpY2tseVxuICAgIGJ5TGV2ZWw6IHtcbiAgICAgIGluZGV4OiAnZ3NpNCcsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTRwaycsIGNvbXBvc2l0ZTogWyAnbGV2ZWwnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNHNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNSAtIGJ5IGVudGl0eSB0eXBlIC0gXCJhbGwgT3JkZXIgZXZlbnRzXCIsIFwiYWxsIFVzZXIgZXZlbnRzXCJcbiAgICBieUVudGl0eVR5cGU6IHtcbiAgICAgIGluZGV4OiAnZ3NpNScsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTVwaycsIGNvbXBvc2l0ZTogWyAnZW50aXR5TmFtZScgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k1c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k2IC0gYnkgZW50aXR5IGluc3RhbmNlIC0gXCJhbGwgZXZlbnRzIGZvciBPcmRlcjoxMjNcIlxuICAgIGJ5RW50aXR5OiB7XG4gICAgICBpbmRleDogJ2dzaTYnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k2cGsnLCBjb21wb3NpdGU6IFsgJ2VudGl0eU5hbWUnLCAnZW50aXR5SWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNnNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNyAtIGFsbCByZWNvcmRzIGJ5IHRpbWVzdGFtcCAtIGZvciBlZmZpY2llbnQgc29ydGVkIGxpc3Rpbmcgb2YgYWxsIGV2ZW50c1xuICAgIC8vIFVzZXMgY29uc3RhbnQgcGFydGl0aW9uIGtleSB0byBncm91cCBhbGwgcmVjb3JkcyB0b2dldGhlclxuICAgIGFsbFJlY29yZHM6IHtcbiAgICAgIGluZGV4OiAnZ3NpNycsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTdwaycsIGNvbXBvc2l0ZTogW10sIHRlbXBsYXRlOiAnQUxMX0VWRU5UUycgfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpN3NrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJOCAtIGJ5IGNhdXNlZEJ5IC0gZmluZCBhbGwgZXZlbnRzIGNhdXNlZCBieSBhIHNwZWNpZmljIHJlcXVlc3QgKGNyb3NzLWludm9jYXRpb24gdHJhY2luZylcbiAgICBieUNhdXNlZEJ5OiB7XG4gICAgICBpbmRleDogJ2dzaTgnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k4cGsnLCBjb21wb3NpdGU6IFsgJ2NhdXNlZEJ5JyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaThzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEZvciBzb3VyY2UvYWN0b3IvdGVuYW50IHF1ZXJpZXMgLSB1c2Ugc2VhcmNoIGVuZ2luZSBzeW5jXG4gIH0sXG59IGFzIGNvbnN0KTtcblxuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYSA9IHR5cGVvZiBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hOyJdfQ==