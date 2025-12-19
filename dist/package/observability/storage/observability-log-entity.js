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
                    { field: 'durationMs', defaultVisible: false },
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
            fieldType: 'datetime',
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1sb2ctZW50aXR5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvc3RvcmFnZS9vYnNlcnZhYmlsaXR5LWxvZy1lbnRpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCxtQ0FBb0M7QUFDcEMsZ0VBQWdFO0FBQ2hFLDBEQUF1RjtBQUV2Rjs7Ozs7Ozs7Ozs7R0FXRztBQUNVLFFBQUEsNEJBQTRCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUM3RCxLQUFLLEVBQUU7UUFDTCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxrQkFBa0I7UUFDMUIsZ0JBQWdCLEVBQUUsbUJBQW1CO1FBQ3JDLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6Qyx3Q0FBd0M7UUFDeEMsb0JBQW9CLEVBQUUsSUFBSTtRQUMxQixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixNQUFNLEVBQUU7WUFDTixPQUFPLEVBQUUsS0FBSztZQUNkLFdBQVcsRUFBRTtnQkFDWCxVQUFVLEVBQUUsb0JBQW9CO2FBQ2pDO1NBQ0Y7UUFDRCxrQ0FBa0M7UUFDbEMsY0FBYyxFQUFFO1lBQ2QsV0FBVyxFQUFFO2dCQUNYLHFDQUFxQztnQkFDckMsdUVBQXVFO2dCQUN2RSxXQUFXLEVBQUUsRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUU7Z0JBQ3BELHlEQUF5RDtnQkFDekQsVUFBVSxFQUFFO29CQUNWO3dCQUNFLEVBQUUsRUFBRSxZQUFZO3dCQUNoQixLQUFLLEVBQUUsWUFBWTt3QkFDbkIsSUFBSSxFQUFFLG1CQUFtQjt3QkFDekIsT0FBTyxFQUFFLFlBQVk7d0JBQ3JCLGlFQUFpRTt3QkFDakUsR0FBRyxFQUFFLDRDQUE0Qzt3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QUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7UUFDRCx5REFBeUQ7UUFDekQsUUFBUSxFQUFFO1lBQ1IsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLFlBQVksRUFBRSxVQUFVLENBQUUsRUFBRTtZQUNoRSxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLGFBQWEsQ0FBRSxFQUFFO1NBQ3REO1FBQ0QsK0VBQStFO1FBQy9FLDREQUE0RDtRQUM1RCxVQUFVLEVBQUU7WUFDVixLQUFLLEVBQUUsTUFBTTtZQUNiLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLEVBQUUsRUFBRSxRQUFRLEVBQUUsWUFBWSxFQUFFO1lBQzlELEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7UUFDRCwrRkFBK0Y7UUFDL0YsVUFBVSxFQUFFO1lBQ1YsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLFVBQVUsQ0FBRSxFQUFFO1lBQ2xELEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7UUFDRCwyREFBMkQ7S0FDNUQ7Q0FDTyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHkgTG9nIEVudGl0eSBTY2hlbWFcbiAqIFxuICogRHluYW1vREIgdGFibGUgc2NoZW1hIGZvciBzdG9yaW5nIGFsbCBvYnNlcnZhYmlsaXR5IGV2ZW50cy5cbiAqIFVzZWQgYnkgT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2Ugd2hpY2ggaXMgc2VsZi1jb250YWluZWQgKG5vIERJIGRlcGVuZGVuY3kpLlxuICovXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuLy8gSW1wb3J0IGRpcmVjdGx5IGZyb20gYmFzZS1lbnRpdHkgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeVxuaW1wb3J0IHsgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIGNyZWF0ZUVudGl0eVNjaGVtYSB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLWVudGl0eSc7XG5cbi8qKlxuICogT2JzZXJ2YWJpbGl0eSBMb2cgRW50aXR5IFNjaGVtYVxuICogXG4gKiBVbml2ZXJzYWwgc2NoZW1hIGZvciBhbGwgb2JzZXJ2YWJpbGl0eSBldmVudCB0eXBlczpcbiAqIC0gc3Bhbi5zdGFydCwgc3Bhbi5lbmQsIHNwYW4uZXZlbnQgKGRpc3RyaWJ1dGVkIHRyYWNpbmcpXG4gKiAtIGF1ZGl0LmVudGl0eSwgYXVkaXQuYWN0aW9uLCBhdWRpdC5jb21wbGlhbmNlIChhdWRpdGluZylcbiAqIC0gbWV0cmljIChtZXRyaWNzL2NvdW50ZXJzKVxuICogLSB3b3JrZmxvdy4qICh3b3JrZmxvdyB0cmFja2luZylcbiAqIC0gZGVjaXNpb24uKiAoZGVjaXNpb24gbG9nZ2luZylcbiAqIC0gYWNjZXNzIChBUEkgYWNjZXNzIGxvZ3MpXG4gKiAtIGxvZyAoc3RydWN0dXJlZCBsb2dnaW5nKVxuICovXG5leHBvcnQgY29uc3QgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gIG1vZGVsOiB7XG4gICAgdmVyc2lvbjogJzEnLFxuICAgIGVudGl0eTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgIGVudGl0eU5hbWVQbHVyYWw6ICdvYnNlcnZhYmlsaXR5TG9ncycsXG4gICAgc2VydmljZTogJ29ic2VydmFiaWxpdHknLFxuICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgIC8vIFN5c3RlbSBlbnRpdHkgLSByZWFkLW9ubHkgaW4gYWRtaW4gVUlcbiAgICBleGNsdWRlRnJvbUFkbWluTWVudTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZTogdHJ1ZSxcbiAgICBzZWFyY2g6IHtcbiAgICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgICAgaW5kZXhDb25maWc6IHtcbiAgICAgICAgcHJpbWFyeUtleTogJ29ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICB9XG4gICAgfSxcbiAgICAvLyA9PT0gTElTVCBQQUdFIENPTkZJR1VSQVRJT04gPT09XG4gICAgbGlzdFBhZ2VDb25maWc6IHtcbiAgICAgIHRhYmxlQ29uZmlnOiB7XG4gICAgICAgIC8vIERlZmF1bHQgc29ydDogbGF0ZXN0IHJlY29yZHMgZmlyc3RcbiAgICAgICAgLy8gU2VhcmNoIG1vZGUgdXNlcyBmdWxsIGNvbmZpZywgREIgbW9kZSBleHRyYWN0cyBqdXN0IHRoZSAnZGVzYycgb3JkZXJcbiAgICAgICAgZGVmYXVsdFNvcnQ6IHsgZmllbGQ6ICd0aW1lc3RhbXBNcycsIG9yZGVyOiAnZGVzYycgfSxcbiAgICAgICAgLy8gUm93IGFjdGlvbnMgLSBxdWljayBhY2Nlc3Mgd2l0aG91dCBsb3NpbmcgbGlzdCBjb250ZXh0XG4gICAgICAgIHJvd0FjdGlvbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3F1aWNrLXZpZXcnLFxuICAgICAgICAgICAgbGFiZWw6ICdRdWljayBWaWV3JyxcbiAgICAgICAgICAgIGljb246ICdFeHBhbmRBbHRPdXRsaW5lZCcsXG4gICAgICAgICAgICB0b29sdGlwOiAnUXVpY2sgVmlldycsXG4gICAgICAgICAgICAvLyBPcGVuIHZpZXcgcGFnZSBpbiBtb2RhbCAtIFVSTCB3aWxsIGJlIHJlc29sdmVkIHRvIGZldGNoIGNvbmZpZ1xuICAgICAgICAgICAgdXJsOiAnL3ZpZXctb2JzZXJ2YWJpbGl0eWxvZy86b2JzZXJ2YWJpbGl0eUxvZ0lkJyxcbiAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgbW9kYWxUaXRsZTogJ0xvZyBEZXRhaWxzJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndmlldy10cmFjZScsXG4gICAgICAgICAgICBsYWJlbDogJ1ZpZXcgVHJhY2UnLFxuICAgICAgICAgICAgaWNvbjogJ0FwYXJ0bWVudE91dGxpbmVkJyxcbiAgICAgICAgICAgIHRvb2x0aXA6ICdWaWV3IGNvcnJlbGF0ZWQgbG9ncycsXG4gICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgIG1vZGFsVGl0bGU6ICdUcmFjZSBMb2dzJyxcbiAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGNvcnJlbGF0aW9uSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGNvcnJlbGF0aW9uSWQ6ICc6Y29ycmVsYXRpb25JZCcgfSxcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd2aWV3LWNoaWxkcmVuJyxcbiAgICAgICAgICAgIGxhYmVsOiAnVmlldyBDaGlsZHJlbicsXG4gICAgICAgICAgICBpY29uOiAnQnJhbmNoZXNPdXRsaW5lZCcsXG4gICAgICAgICAgICB0b29sdGlwOiAnVmlldyBjaGlsZCBsb2dzJyxcbiAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgbW9kYWxUaXRsZTogJ0NoaWxkIExvZ3MnLFxuICAgICAgICAgICAgLy8gU2hvdyBmb3IgbG9ncyB0aGF0IGRvbid0IGhhdmUgYSBwYXJlbnQgKHJvb3QgbG9ncyBtYXkgaGF2ZSBjaGlsZHJlbilcbiAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IGZhbHNlIH0gfSB9LFxuICAgICAgICAgICAgLy8gVXNlIG1vZGFsQ29uZmlnUmVmIHRvIGhpZGUgaGllcmFyY2h5IHNlZ21lbnRzIChjb25mbGljdHMgd2l0aCBwYXJlbnQgZmlsdGVyKVxuICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJzpvYnNlcnZhYmlsaXR5TG9nSWQnIH0sXG4gICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIC8vIE9ubHkgc2hvdyBlc3NlbnRpYWwgY29sdW1ucyBmb3IgcXVpY2sgc2Nhbm5pbmdcbiAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgIHsgZmllbGQ6ICd0eXBlJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdsZXZlbCcgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnZW50aXR5TmFtZScgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnc291cmNlJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdvcGVyYXRpb24nIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ3N0YXR1cycgfSxcbiAgICAgICAgICB7IGZpZWxkOiAndGltZXN0YW1wTXMnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2R1cmF0aW9uTXMnLCBkZWZhdWx0VmlzaWJsZTogZmFsc2UgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnY29ycmVsYXRpb25JZCcsIGRlZmF1bHRWaXNpYmxlOiBmYWxzZSB9LFxuICAgICAgICBdLFxuICAgICAgICAvLyA9PT0gRklMVEVSIFNFR01FTlRTOiBRdWljayBhY2Nlc3MgdG8gY29tbW9uIHZpZXdzID09PVxuICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgIC8vID09PSBCWSBISUVSQVJDSFkgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdoaWVyYXJjaHktZ3JvdXAnLFxuICAgICAgICAgICAgbGFiZWw6ICdWaWV3JyxcbiAgICAgICAgICAgIHNlZ21lbnRzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpZDogJ2FsbC1zcGFucycsIGxhYmVsOiAnQWxsIEV2ZW50cycsIGljb246ICdVbm9yZGVyZWRMaXN0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHt9LFxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHRydWVcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAncm9vdC1vbmx5JywgbGFiZWw6ICdSb290IFNwYW5zJywgaWNvbjogJ0FwYXJ0bWVudE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAvLyBGaWx0ZXI6IG5vIHBhcmVudCA9IHJvb3Qgc3BhblxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGV4aXN0czogZmFsc2UgfSB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaWQ6ICdjaGlsZC1vbmx5JywgbGFiZWw6ICdDaGlsZCBTcGFucycsIGljb246ICdCcmFuY2hlc091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAvLyBGaWx0ZXI6IGhhcyBwYXJlbnQgPSBjaGlsZCBzcGFuXG4gICAgICAgICAgICAgICAgZmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gQlkgTEVWRUwgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdsZXZlbC1ncm91cCcsXG4gICAgICAgICAgICBsYWJlbDogJ0xldmVsJyxcbiAgICAgICAgICAgIHNlZ21lbnRzOiBbXG4gICAgICAgICAgICAgIHsgaWQ6ICdhbGwtbGV2ZWxzJywgbGFiZWw6ICdBbGwnLCBmaWx0ZXJzOiB7fSwgZGVmYXVsdDogdHJ1ZSB9LFxuICAgICAgICAgICAgICB7IGlkOiAnZXJyb3JzJywgbGFiZWw6ICdFcnJvcnMnLCBpY29uOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICdlcnJvcicgfSB9LCBiYWRnZVN0YXR1czogJ2Vycm9yJyB9LFxuICAgICAgICAgICAgICB7IGlkOiAnd2FybmluZ3MnLCBsYWJlbDogJ1dhcm5pbmdzJywgaWNvbjogJ1dhcm5pbmdPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICd3YXJuJyB9IH0sIGJhZGdlU3RhdHVzOiAnd2FybmluZycgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ2luZm8nLCBsYWJlbDogJ0luZm8nLCBpY29uOiAnSW5mb0NpcmNsZU91dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ2luZm8nIH0gfSB9LFxuICAgICAgICAgICAgICB7IGlkOiAnZGVidWcnLCBsYWJlbDogJ0RlYnVnJywgaWNvbjogJ0J1Z091dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ2RlYnVnJyB9IH0gfSxcbiAgICAgICAgICAgICAgeyBpZDogJ3RyYWNlJywgbGFiZWw6ICdUcmFjZScsIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICd0cmFjZScgfSB9IH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIGV4cGFuZGFibGU6IHtcbiAgICAgICAgICBtb2RlOiAnanNvbicsXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyA9PT0gVklFVyBQQUdFIENPTkZJR1VSQVRJT04gPT09XG4gICAgdmlld1BhZ2VDb25maWc6IHtcbiAgICAgIC8vIFR3by1jb2x1bW4gbGF5b3V0IGZvciBlc3NlbnRpYWwgaWRlbnRpZmljYXRpb24gYW5kIG9wZXJhdGlvbiBkZXRhaWxzXG4gICAgICBjb2x1bW5zQ29uZmlnOiB7XG4gICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICBsYWJlbDogJ0lkZW50aXR5ICYgQ2xhc3NpZmljYXRpb24nLFxuICAgICAgICAgICAgZmllbGRzOiBbXG4gICAgICAgICAgICAgICdvYnNlcnZhYmlsaXR5TG9nSWQnLFxuICAgICAgICAgICAgICAndHlwZScsXG4gICAgICAgICAgICAgICdzdWJUeXBlJyxcbiAgICAgICAgICAgICAgJ2xldmVsJyxcbiAgICAgICAgICAgICAgJ2NvcnJlbGF0aW9uSWQnLCAgLy8gSGFzIGxpbmtDb25maWcgLSByZW5kZXJzIGFzIGxpbmsgdG8gdHJhY2Ugdmlld1xuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgIGxhYmVsOiAnT3BlcmF0aW9uICYgVGltaW5nJyxcbiAgICAgICAgICAgIGZpZWxkczogW1xuICAgICAgICAgICAgICAnb3BlcmF0aW9uJyxcbiAgICAgICAgICAgICAgJ3N0YXR1cycsXG4gICAgICAgICAgICAgICdzdWNjZXNzJyxcbiAgICAgICAgICAgICAgJ3RpbWVzdGFtcE1zJyxcbiAgICAgICAgICAgICAgJ2R1cmF0aW9uTXMnLFxuICAgICAgICAgICAgICAnc291cmNlJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICAvLyBTZWN0aW9ucyBvcmdhbml6ZWQgYnkgbG9naWNhbCBncm91cGluZyB3aXRoIHByb3BlciB0YWJzL2FjY29yZGlvbnNcbiAgICAgIHNlY3Rpb25zQ29uZmlnOiB7XG4gICAgICAgIHNlY3Rpb25Hcm91cHM6IFtcbiAgICAgICAgICAvLyA9PT0gMi4gSElFUkFSQ0hZICYgVFJBQ0UgUkVMQVRJT05TID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnaGllcmFyY2h5LXJlbGF0aW9ucycsXG4gICAgICAgICAgICBsYWJlbDogJ0hpZXJhcmNoeSAmIFRyYWNlJyxcbiAgICAgICAgICAgIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiB0cnVlLFxuICAgICAgICAgICAgbGF6eUxvYWQ6IHRydWUsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogZmFsc2UsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBwYXJlbnRTcGFuOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdQYXJlbnQgU3BhbicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ05vZGVJbmRleE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5nOiB7IHNvdXJjZTogJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsIHRhcmdldDogJ2lkJyB9LFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBjaGlsZFNwYW5zOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdDaGlsZCBTcGFucycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0JyYW5jaGVzT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJzpvYnNlcnZhYmlsaXR5TG9nSWQnIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB0cmFjZUxvZ3M6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1RoaXMgVHJhY2UnLFxuICAgICAgICAgICAgICAgIGljb246ICdTaGFyZUFsdE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBjb3JyZWxhdGlvbklkOiAnOmNvcnJlbGF0aW9uSWQnIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0FsbCBldmVudHMgaW4gdGhpcyBMYW1iZGEgaW52b2NhdGlvbicsXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGNhdXNlZEJ5VHJhY2U6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0NhdXNpbmcgUmVxdWVzdCBUcmFjZScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0xpbmtPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA0LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgY2F1c2VkQnk6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGNvcnJlbGF0aW9uSWQ6ICc6Y2F1c2VkQnknIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1ZpZXcgdGhlIG9yaWdpbmFsIHJlcXVlc3QgdHJhY2UgdGhhdCBjYXVzZWQgdGhpcyBldmVudCcsXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGNhdXNlZEV2ZW50czoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRXZlbnRzIENhdXNlZCBCeSBUaGlzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQXBpT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGNhdXNlZEJ5OiAnOmNvcnJlbGF0aW9uSWQnIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0V2ZW50cyBpbiBvdGhlciBpbnZvY2F0aW9ucyBjYXVzZWQgYnkgdGhpcyByZXF1ZXN0JyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gMy4gRVZFTlQgREFUQSAoQ29yZSBwYXlsb2FkcykgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdldmVudC1kYXRhJyxcbiAgICAgICAgICAgIGxhYmVsOiAnRXZlbnQgRGF0YScsXG4gICAgICAgICAgICBpY29uOiAnRmlsZVRleHRPdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiBmYWxzZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiB0cnVlLFxuICAgICAgICAgICAgc2VjdGlvbnM6IHtcbiAgICAgICAgICAgICAgZW50aXR5SW5mbzoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRW50aXR5IEluZm9ybWF0aW9uJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnSW5mb0NpcmNsZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlbnRpdHlOYW1lOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2VudGl0eU5hbWUnLCAnZW50aXR5SWQnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRGF0YScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0ZpbGVUZXh0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGRhdGE6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnZGF0YScgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBdHRyaWJ1dGVzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnVGFnc091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBhdHRyaWJ1dGVzOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2F0dHJpYnV0ZXMnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZXJyb3I6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0Vycm9yJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRXhjbGFtYXRpb25DaXJjbGVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA0LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZXJyb3I6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnZXJyb3InIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gNS4gQURESVRJT05BTCBEQVRBIChUYWdzLCBNZXRhZGF0YSwgQ29udGV4dCkgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdhZGRpdGlvbmFsLWRhdGEnLFxuICAgICAgICAgICAgbGFiZWw6ICdBZGRpdGlvbmFsIERhdGEnLFxuICAgICAgICAgICAgaWNvbjogJ0ZvbGRlck9wZW5PdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDUsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiB0cnVlLFxuICAgICAgICAgICAgbGF6eUxvYWQ6IGZhbHNlLFxuICAgICAgICAgICAga2VlcE1vdW50ZWQ6IHRydWUsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdNZXRyaWNzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRGFzaGJvYXJkT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IG1ldHJpY3M6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnbWV0cmljcycgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdUYWdzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnVGFnT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHRhZ3M6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAndGFncycgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnTWV0YWRhdGEnLFxuICAgICAgICAgICAgICAgIGljb246ICdJbmZvQ2lyY2xlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMyxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IG1ldGFkYXRhOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ21ldGFkYXRhJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0NvbnRleHQnLFxuICAgICAgICAgICAgICAgIGljb246ICdFbnZpcm9ubWVudE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDQsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBjb250ZXh0OiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2NvbnRleHQnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gNi4gUkVMQVRFRCBMT0dTIChFbnRpdHkgJiBTb3VyY2UgQW5hbHl0aWNzKSA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3JlbGF0ZWQtYW5hbHl0aWNzJyxcbiAgICAgICAgICAgIGxhYmVsOiAnUmVsYXRlZCBMb2dzJyxcbiAgICAgICAgICAgIGljb246ICdGdW5kT3V0bGluZWQnLFxuICAgICAgICAgICAgc29ydE9yZGVyOiA2LFxuICAgICAgICAgICAgcmVuZGVyTW9kZTogJ3RhYnMnLFxuICAgICAgICAgICAgZGVmYXVsdENvbGxhcHNlZDogdHJ1ZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiBmYWxzZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiBmYWxzZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIGJ5RW50aXR5OiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFbnRpdHkgTG9ncycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0RhdGFiYXNlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGVudGl0eU5hbWU6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJzplbnRpdHlOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICBlbnRpdHlJZDogJzplbnRpdHlJZCcsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBieUVudGl0eVR5cGU6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0VudGl0eSBUeXBlIExvZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdBcHBzdG9yZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlbnRpdHlOYW1lOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBlbnRpdHlOYW1lOiAnOmVudGl0eU5hbWUnIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBieVNvdXJjZToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnU291cmNlIExvZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdDb2RlU2FuZGJveE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBzb3VyY2U6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IHNvdXJjZTogJzpzb3VyY2UnIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vID09PSA3LiBBQ1RPUiAmIFNZU1RFTSBJTkZPID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnYWN0b3Itc3lzdGVtJyxcbiAgICAgICAgICAgIGxhYmVsOiAnQWN0b3IgJiBTeXN0ZW0nLFxuICAgICAgICAgICAgaWNvbjogJ1NldHRpbmdPdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDcsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiB0cnVlLFxuICAgICAgICAgICAgbGF6eUxvYWQ6IGZhbHNlLFxuICAgICAgICAgICAga2VlcE1vdW50ZWQ6IHRydWUsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQWN0b3InLFxuICAgICAgICAgICAgICAgIGljb246ICdVc2VyT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGFjdG9yOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2FjdG9yJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHN5c3RlbUluZm86IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1N5c3RlbSBJbmZvJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQ2xvY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICd0dGwnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgYXR0cmlidXRlczoge1xuICAgIC8vID09PSBJREVOVElUWSA9PT1cbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICBkZWZhdWx0OiAoKSA9PiByYW5kb21VVUlEKCksXG4gICAgICBsYWJlbDogJ0xvZyBJRCcsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdQYXJlbnQgTG9nIElEJyxcbiAgICAgIGhlbHBUZXh0OiAnUmVmZXJlbmNlIHRvIHBhcmVudCBzcGFuIGZvciBoaWVyYXJjaGljYWwgdHJhY2luZycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBTZWxmLXJlZmVyZW50aWFsIHJlbGF0aW9uIHRvIHBhcmVudCBvYnNlcnZhYmlsaXR5IGxvZ1xuICAgICAgcmVsYXRpb246IHtcbiAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICB0eXBlOiAnbWFueS10by1vbmUnLFxuICAgICAgICBpZGVudGlmaWVyczogeyBzb3VyY2U6ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnLCB0YXJnZXQ6ICdvYnNlcnZhYmlsaXR5TG9nSWQnIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gQ29tcHV0ZWQgZmllbGQ6IHRydWUgaWYgdGhpcyBpcyBhIHJvb3Qgc3BhbiAobm8gcGFyZW50KVxuICAgIC8vIFVzZWQgZm9yIGVmZmljaWVudCBHU0kgcXVlcmllcyBpbnN0ZWFkIG9mIG5vdEV4aXN0cyBmaWx0ZXJcbiAgICBpc1Jvb3Q6IHtcbiAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgIGxhYmVsOiAnSXMgUm9vdCcsXG4gICAgICBoZWxwVGV4dDogJ1RydWUgaWYgdGhpcyBpcyBhIHJvb3Qgc3BhbiAobm8gcGFyZW50KScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICB3YXRjaDogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdLFxuICAgICAgLy8gU2V0IHRvIHRydWUgd2hlbiBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgaXMgbnVsbC91bmRlZmluZWRcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkPzogc3RyaW5nIH0pID0+XG4gICAgICAgICFkYXRhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IHRydWUsICAvLyBEZWZhdWx0IHRvIHRydWUgaWYgbm8gcGFyZW50IHNwZWNpZmllZFxuICAgIH0sXG4gICAgLy8gTk9URTogY29ycmVsYXRpb25JZCBpcyBSRVFVSVJFRCBhbmQgaGFzIE5PIGRlZmF1bHQuXG4gICAgLy8gSWYgeW91J3JlIGdldHRpbmcgdmFsaWRhdGlvbiBlcnJvcnMsIGVzdGFibGlzaCBjb250ZXh0IGZpcnN0IHdpdGggcnVuV2l0aENvbnRleHQoKS5cbiAgICAvLyBIYXZpbmcgYSBkZWZhdWx0IGhlcmUgd291bGQgaGlkZSBidWdzIHdoZXJlIGNvbnRleHQgd2Fzbid0IHByb3Blcmx5IGVzdGFibGlzaGVkLlxuICAgIGNvcnJlbGF0aW9uSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBsYWJlbDogJ0NvcnJlbGF0aW9uIElEJyxcbiAgICAgIGhlbHBUZXh0OiAnVW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBlbnRpcmUgcmVxdWVzdC90cmFjZScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBOTyBERUZBVUxUIC0gbXVzdCBiZSBwcm9wYWdhdGVkIGZyb20gY29udGV4dFxuICAgICAgLy8gTGluayB0byBmaWx0ZXJlZCBsaXN0IHNob3dpbmcgYWxsIGxvZ3MgaW4gdGhlIHNhbWUgdHJhY2VcbiAgICAgIGlzTGluazogdHJ1ZSxcbiAgICAgIGxpbmtDb25maWc6IHtcbiAgICAgICAgcm91dGVQYXR0ZXJuOiAnL2xpc3Qtb2JzZXJ2YWJpbGl0eWxvZz9jb3JyZWxhdGlvbklkLmVxPTpjb3JyZWxhdGlvbklkJyxcbiAgICAgICAgZGlzcGxheVRleHQ6ICdWaWV3IENvcnJlbGF0ZWQgTG9ncycsXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gQ3Jvc3MtaW52b2NhdGlvbiB0cmFjaW5nOiBDb3JyZWxhdGlvbiBJRCB0aGF0IGNhdXNlZCB0aGlzIGV2ZW50XG4gICAgLy8gRXhhbXBsZTogRHluYW1vREIgc3RyZWFtIGF1ZGl0IGNhdXNlZCBieSBvcmlnaW5hbCBBUEkgcmVxdWVzdFxuICAgIGNhdXNlZEJ5OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIGxhYmVsOiAnQ2F1c2VkIEJ5JyxcbiAgICAgIGhlbHBUZXh0OiAnQ29ycmVsYXRpb24gSUQgdGhhdCBjYXVzZWQgdGhpcyBldmVudCAoY3Jvc3MtaW52b2NhdGlvbiB0cmFjaW5nKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc0xpbms6IHRydWUsXG4gICAgICBsaW5rQ29uZmlnOiB7XG4gICAgICAgIHJvdXRlUGF0dGVybjogJy9saXN0LW9ic2VydmFiaWxpdHlsb2c/Y29ycmVsYXRpb25JZC5lcT06Y2F1c2VkQnknLFxuICAgICAgICBkaXNwbGF5VGV4dDogJ1ZpZXcgQ2F1c2luZyBSZXF1ZXN0JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBBbGwgcmVsYXRlZCB0cmFjZSBJRHMgZm9yIGNvbXBsZXggd29ya2Zsb3dzXG4gICAgcmVsYXRlZFRyYWNlczoge1xuICAgICAgdHlwZTogJ2xpc3QnLFxuICAgICAgaXRlbXM6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIGxhYmVsOiAnUmVsYXRlZCBUcmFjZXMnLFxuICAgICAgaGVscFRleHQ6ICdBbGwgcmVsYXRlZCBjb3JyZWxhdGlvbiBJRHMgZm9yIGNvbXBsZXggd29ya2Zsb3dzIHNwYW5uaW5nIG11bHRpcGxlIGludm9jYXRpb25zJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogZmFsc2UsIC8vIExpc3QgZmllbGQsIG5vdCBmaWx0ZXJhYmxlXG4gICAgfSxcblxuICAgIC8vID09PSBDTEFTU0lGSUNBVElPTiA9PT1cbiAgICB0eXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgbGFiZWw6ICdUeXBlJyxcbiAgICAgIGhlbHBUZXh0OiAnRXZlbnQgdHlwZSAoc3Bhbi5zdGFydCwgc3Bhbi5lbmQsIGF1ZGl0LmVudGl0eSwgbG9nLCBtZXRyaWMsIGV0Yy4pJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgfSxcbiAgICBzdWJUeXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnU3ViLVR5cGUnLFxuICAgICAgaGVscFRleHQ6ICdBZGRpdGlvbmFsIHR5cGUgY2xhc3NpZmljYXRpb24nLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgIH0sXG4gICAgLy8gTk9URTogbGV2ZWwgaXMgUkVRVUlSRUQgYW5kIGhhcyBOTyBkZWZhdWx0LlxuICAgIC8vIFRoZSBvYnNlcnZlciBNVVNUIHNwZWNpZnkgdGhlIGxldmVsIGV4cGxpY2l0bHkuXG4gICAgbGV2ZWw6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBsYWJlbDogJ0xldmVsJyxcbiAgICAgIGhlbHBUZXh0OiAnU2V2ZXJpdHkgbGV2ZWw6IGVycm9yLCB3YXJuLCBpbmZvLCBkZWJ1ZycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc1NvcnRhYmxlOiB0cnVlLFxuICAgICAgLy8gTk8gREVGQVVMVCAtIG11c3QgYmUgc3BlY2lmaWVkIGJ5IG9ic2VydmVyXG4gICAgfSxcblxuICAgIC8vID09PSBFTlRJVFkgQ09OVEVYVCA9PT1cbiAgICBlbnRpdHlOYW1lOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnRW50aXR5IE5hbWUnLFxuICAgICAgaGVscFRleHQ6ICdOYW1lIG9mIHRoZSBlbnRpdHkgdGhpcyBldmVudCByZWxhdGVzIHRvJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgfSxcbiAgICBlbnRpdHlJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ0VudGl0eSBJRCcsXG4gICAgICBoZWxwVGV4dDogJ0lEIG9mIHRoZSBzcGVjaWZpYyBlbnRpdHkgaW5zdGFuY2UnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgLy8gRGVmYXVsdCB0byAnXycgd2hlbiBlbnRpdHlOYW1lIGlzIHNldCBidXQgZW50aXR5SWQgaXMgbm90IChyZXF1aXJlZCBmb3IgYnlFbnRpdHkgY29tcG9zaXRlIGluZGV4KVxuICAgICAgd2F0Y2g6IFsgJ2VudGl0eU5hbWUnIF0sXG4gICAgICBzZXQ6IChfOiB1bmtub3duLCBkYXRhOiB7IGVudGl0eU5hbWU/OiBzdHJpbmc7IGVudGl0eUlkPzogc3RyaW5nIH0pID0+XG4gICAgICAgIGRhdGEuZW50aXR5SWQgfHwgKGRhdGEuZW50aXR5TmFtZSA/ICdfJyA6IHVuZGVmaW5lZCksXG4gICAgICAvLyBEeW5hbWljIGxpbmsgdG8gdGhlIHJlbGF0ZWQgZW50aXR5IGJhc2VkIG9uIGVudGl0eU5hbWVcbiAgICAgIGxpbmtDb25maWc6IHtcbiAgICAgICAgcm91dGVQYXR0ZXJuOiAnL3ZpZXctOmVudGl0eU5hbWUvOmVudGl0eUlkJyxcbiAgICAgICAgZGlzcGxheVRleHQ6ICdWaWV3IHtlbnRpdHlOYW1lfScsXG4gICAgICB9LFxuICAgIH0sXG5cbiAgICAvLyA9PT0gT1BFUkFUSU9OID09PVxuICAgIG9wZXJhdGlvbjoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ09wZXJhdGlvbicsXG4gICAgICBoZWxwVGV4dDogJ1RoZSBvcGVyYXRpb24gYmVpbmcgcGVyZm9ybWVkIChlLmcuLCBjcmVhdGUsIHVwZGF0ZSwgcXVlcnkpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgfSxcbiAgICBzdGF0dXM6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdTdGF0dXMnLFxuICAgICAgaGVscFRleHQ6ICdPcGVyYXRpb24gc3RhdHVzIChlLmcuLCBzdGFydGVkLCBjb21wbGV0ZWQsIGZhaWxlZCknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgIH0sXG4gICAgc3VjY2Vzczoge1xuICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgbGFiZWw6ICdTdWNjZXNzJyxcbiAgICAgIGhlbHBUZXh0OiAnV2hldGhlciB0aGUgb3BlcmF0aW9uIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgZmllbGRUeXBlOiAnYm9vbGVhbicsXG4gICAgICBib29sZWFuTGFiZWxzOiB7IHRydWU6ICdTdWNjZXNzJywgZmFsc2U6ICdGYWlsZWQnIH0sXG4gICAgfSxcblxuICAgIC8vID09PSBUSU1JTkcgPT09XG4gICAgdGltZXN0YW1wTXM6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBkZWZhdWx0OiAoKSA9PiBEYXRlLm5vdygpLFxuICAgICAgbGFiZWw6ICdUaW1lc3RhbXAnLFxuICAgICAgaGVscFRleHQ6ICdFdmVudCB0aW1lc3RhbXAgaW4gbWlsbGlzZWNvbmRzIHNpbmNlIGVwb2NoJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgICBmaWVsZFR5cGU6ICdkYXRldGltZScsXG4gICAgfSxcbiAgICBkdXJhdGlvbk1zOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIGxhYmVsOiAnRHVyYXRpb24gKG1zKScsXG4gICAgICBoZWxwVGV4dDogJ09wZXJhdGlvbiBkdXJhdGlvbiBpbiBtaWxsaXNlY29uZHMnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICAgIGZpZWxkVHlwZTogJ2R1cmF0aW9uJyxcbiAgICAgIGR1cmF0aW9uVW5pdDogJ21zJyxcbiAgICB9LFxuXG4gICAgLy8gPT09IFNPVVJDRSAmIFRBR1MgPT09XG4gICAgc291cmNlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnU291cmNlJyxcbiAgICAgIGhlbHBUZXh0OiAnU291cmNlIG9mIHRoZSBldmVudCAoZS5nLiwgc2VydmljZSBuYW1lLCBmdW5jdGlvbiBuYW1lKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICAvLyBOT1RFOiB0YWdzLCBtZXRyaWNzLCBhdHRyaWJ1dGVzLCBkYXRhLCBtZXRhZGF0YSwgYWN0b3IsIGNvbnRleHQgYWxsIHVzZSBwcm9wZXJ0aWVzOnt9XG4gICAgLy8gVGhpcyBpcyBCWSBERVNJR04gLSB0aGlzIGlzIGEgVU5JVkVSU0FMIHN0b3JlIGZvciBBTEwgZXZlbnQgdHlwZXMgKHNwYW4sIGF1ZGl0LFxuICAgIC8vIG1ldHJpYywgd29ya2Zsb3csIGRlY2lzaW9uLCBhY2Nlc3MsIGxvZykuIEVhY2ggaGFzIGNvbXBsZXRlbHkgZGlmZmVyZW50IHBheWxvYWRzLlxuICAgIC8vIEVsZWN0cm9EQiBwcm9wZXJ0aWVzOnt9ID0gYWNjZXB0IGFueSBtYXAgc3RydWN0dXJlIGF0IHJ1bnRpbWUuXG4gICAgdGFnczoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ1RhZ3MnLFxuICAgICAgaGVscFRleHQ6ICdLZXktdmFsdWUgdGFncyBmb3IgY2F0ZWdvcml6YXRpb24nLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gUEFZTE9BRFMgKHNjaGVtYWxlc3MgYnkgZGVzaWduIC0gZGlmZmVyZW50IGV2ZW50IHR5cGVzIGhhdmUgZGlmZmVyZW50IHN0cnVjdHVyZXMpID09PVxuICAgIG1ldHJpY3M6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdNZXRyaWNzJyxcbiAgICAgIGhlbHBUZXh0OiAnTnVtZXJpY2FsIG1ldHJpY3MgYW5kIG1lYXN1cmVtZW50cycsXG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnQXR0cmlidXRlcycsXG4gICAgICBoZWxwVGV4dDogJ0FkZGl0aW9uYWwgc3RydWN0dXJlZCBhdHRyaWJ1dGVzJyxcbiAgICB9LFxuICAgIGRhdGE6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdEYXRhJyxcbiAgICAgIGhlbHBUZXh0OiAnRXZlbnQtc3BlY2lmaWMgZGF0YSBwYXlsb2FkJyxcbiAgICB9LFxuICAgIG1ldGFkYXRhOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnTWV0YWRhdGEnLFxuICAgICAgaGVscFRleHQ6ICdBZGRpdGlvbmFsIG1ldGFkYXRhIGFib3V0IHRoZSBldmVudCcsXG4gICAgfSxcbiAgICBlcnJvcjoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0Vycm9yJyxcbiAgICAgIGhlbHBUZXh0OiAnRXJyb3IgZGV0YWlscyBpZiB0aGUgb3BlcmF0aW9uIGZhaWxlZCcsXG4gICAgICAvLyBTdHJ1Y3R1cmU6IHsgdHlwZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmcsIHN0YWNrPzogc3RyaW5nLCBjb2RlPzogc3RyaW5nIH1cbiAgICB9LFxuICAgIC8vID09PSBBQ1RPUiAoc3RvcmVkIGFzLWlzIGZyb20gZXhpc3RpbmcgQWN0b3IgdHlwZSkgPT09XG4gICAgYWN0b3I6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdBY3RvcicsXG4gICAgICBoZWxwVGV4dDogJ0luZm9ybWF0aW9uIGFib3V0IHdobyB0cmlnZ2VyZWQgdGhpcyBldmVudCcsXG4gICAgfSxcblxuICAgIC8vID09PSBDT05URVhUID09PVxuICAgIGNvbnRleHQ6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdDb250ZXh0JyxcbiAgICAgIGhlbHBUZXh0OiAnRXhlY3V0aW9uIGNvbnRleHQgYW5kIGVudmlyb25tZW50IGluZm9ybWF0aW9uJyxcbiAgICB9LFxuXG4gICAgLy8gPT09IFRUTCA9PT1cbiAgICAvLyBUVEwgZm9yIGF1dG8tY2xlYW51cCAoYWx3YXlzIHByb3ZpZGVkIGJ5IGJhY2tlbmQpXG4gICAgdHRsOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDkwICogMjQgKiA2MCAqIDYwKSwgLy8gOTAgZGF5c1xuICAgICAgbGFiZWw6ICdUVEwnLFxuICAgICAgaGVscFRleHQ6ICdUaW1lLXRvLWxpdmUgZm9yIGF1dG9tYXRpYyBjbGVhbnVwIChVbml4IHRpbWVzdGFtcCknLFxuICAgICAgZmllbGRUeXBlOiAnZGF0ZXRpbWUnLFxuICAgIH0sXG4gIH0sXG4gIGluZGV4ZXM6IHtcbiAgICAvLyA9PT0gSU5ERVggREVTSUdOIE5PVEVTID09PVxuICAgIC8vIDEuIFByaW1hcnkgaW5kZXggaGFzIG5vIHNvcnQga2V5IC0gb25seSBmb3Igc2luZ2xlLWl0ZW0gbG9va3VwcyBieSBJRFxuICAgIC8vIDIuIEdTSTcgKGFsbFJlY29yZHMpIHByb3ZpZGVzIHNvcnRlZCBsaXN0aW5nIGZvciB1bmZpbHRlcmVkIHF1ZXJpZXNcbiAgICAvLyAgICAtIFVzZXMgY29uc3RhbnQgUEsgdGVtcGxhdGUgdG8gZ3JvdXAgYWxsIHJlY29yZHNcbiAgICAvLyAgICAtIFNvcnRlZCBieSB0aW1lc3RhbXBNcyBmb3IgZWZmaWNpZW50IGNocm9ub2xvZ2ljYWwgbGlzdGluZ1xuICAgIC8vICAgIC0gVHJhZGUtb2ZmOiBIb3QgcGFydGl0aW9uLCBidXQgYWNjZXB0YWJsZSBmb3Igb2JzZXJ2YWJpbGl0eSBsb2dzIHdpdGggVFRMXG4gICAgLy8gMy4gQWxsIG90aGVyIEdTSXMgYXJlIGZvciBmaWx0ZXJlZCBxdWVyaWVzIChieSB0cmFjZSwgcGFyZW50LCB0eXBlLCBsZXZlbCwgZXRjLilcblxuICAgIC8vIFByaW1hcnkgLSBieSBvYnNlcnZhYmlsaXR5TG9nSWRcbiAgICBwcmltYXJ5OiB7XG4gICAgICBwazogeyBmaWVsZDogJ3BrJywgY29tcG9zaXRlOiBbICdvYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnc2snLCBjb21wb3NpdGU6IFtdIH0sXG4gICAgfSxcbiAgICAvLyBHU0kxIC0gYnkgdHJhY2UgLSBnZXQgYWxsIGV2ZW50cyBpbiBhIHJlcXVlc3QvdHJhY2VcbiAgICBieVRyYWNlOiB7XG4gICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2kxcGsnLCBjb21wb3NpdGU6IFsgJ2NvcnJlbGF0aW9uSWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpMXNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJMiAtIGJ5IHBhcmVudCAtIGdldCBjaGlsZHJlbiwgcmVjb25zdHJ1Y3Qgc3BhbiBoaWVyYXJjaHlcbiAgICBieVBhcmVudDoge1xuICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpMnBrJywgY29tcG9zaXRlOiBbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpMnNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJMyAtIGJ5IHR5cGUgLSBmaWx0ZXIgYnkgZXZlbnQgdHlwZSAoc3Bhbi4qLCBhdWRpdC4qLCBsb2csIG1ldHJpYylcbiAgICBieVR5cGU6IHtcbiAgICAgIGluZGV4OiAnZ3NpMycsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTNwaycsIGNvbXBvc2l0ZTogWyAndHlwZScgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kzc2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k0IC0gYnkgbGV2ZWwgLSBmaW5kIGVycm9ycy93YXJuaW5ncyBxdWlja2x5XG4gICAgYnlMZXZlbDoge1xuICAgICAgaW5kZXg6ICdnc2k0JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNHBrJywgY29tcG9zaXRlOiBbICdsZXZlbCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k0c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k1IC0gYnkgZW50aXR5IHR5cGUgLSBcImFsbCBPcmRlciBldmVudHNcIiwgXCJhbGwgVXNlciBldmVudHNcIlxuICAgIGJ5RW50aXR5VHlwZToge1xuICAgICAgaW5kZXg6ICdnc2k1JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNXBrJywgY29tcG9zaXRlOiBbICdlbnRpdHlOYW1lJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTVzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTYgLSBieSBlbnRpdHkgaW5zdGFuY2UgLSBcImFsbCBldmVudHMgZm9yIE9yZGVyOjEyM1wiXG4gICAgYnlFbnRpdHk6IHtcbiAgICAgIGluZGV4OiAnZ3NpNicsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTZwaycsIGNvbXBvc2l0ZTogWyAnZW50aXR5TmFtZScsICdlbnRpdHlJZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k2c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k3IC0gYWxsIHJlY29yZHMgYnkgdGltZXN0YW1wIC0gZm9yIGVmZmljaWVudCBzb3J0ZWQgbGlzdGluZyBvZiBhbGwgZXZlbnRzXG4gICAgLy8gVXNlcyBjb25zdGFudCBwYXJ0aXRpb24ga2V5IHRvIGdyb3VwIGFsbCByZWNvcmRzIHRvZ2V0aGVyXG4gICAgYWxsUmVjb3Jkczoge1xuICAgICAgaW5kZXg6ICdnc2k3JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpN3BrJywgY29tcG9zaXRlOiBbXSwgdGVtcGxhdGU6ICdBTExfRVZFTlRTJyB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k3c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k4IC0gYnkgY2F1c2VkQnkgLSBmaW5kIGFsbCBldmVudHMgY2F1c2VkIGJ5IGEgc3BlY2lmaWMgcmVxdWVzdCAoY3Jvc3MtaW52b2NhdGlvbiB0cmFjaW5nKVxuICAgIGJ5Q2F1c2VkQnk6IHtcbiAgICAgIGluZGV4OiAnZ3NpOCcsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaThwaycsIGNvbXBvc2l0ZTogWyAnY2F1c2VkQnknIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpOHNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gRm9yIHNvdXJjZS9hY3Rvci90ZW5hbnQgcXVlcmllcyAtIHVzZSBzZWFyY2ggZW5naW5lIHN5bmNcbiAgfSxcbn0gYXMgY29uc3QpO1xuXG5leHBvcnQgdHlwZSBPYnNlcnZhYmlsaXR5TG9nU2NoZW1hID0gdHlwZW9mIE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWE7Il19