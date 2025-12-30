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
 * - span / span.start (distributed tracing)
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
                                        defaultFilters: { parentObservabilityLogId: { eq: ':observabilityLogId' } },
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
                                        defaultFilters: { correlationId: { eq: ':correlationId' } },
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
                                        defaultFilters: { correlationId: { eq: ':causedBy' } },
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
                                        defaultFilters: { causedBy: { eq: ':correlationId' } },
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
                                label: 'Rest Data',
                                icon: 'FileTextOutlined',
                                sortOrder: 3,
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
            // 128-bit fallback for manual/admin-created records (framework generally supplies observabilityLogId explicitly).
            default: () => (0, crypto_1.randomBytes)(16).toString('hex'),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1sb2ctZW50aXR5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvc3RvcmFnZS9vYnNlcnZhYmlsaXR5LWxvZy1lbnRpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCxtQ0FBcUM7QUFDckMsZ0VBQWdFO0FBQ2hFLDBEQUF1RjtBQUV2Rjs7Ozs7Ozs7Ozs7R0FXRztBQUNVLFFBQUEsNEJBQTRCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUM3RCxLQUFLLEVBQUU7UUFDTCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxrQkFBa0I7UUFDMUIsZ0JBQWdCLEVBQUUsbUJBQW1CO1FBQ3JDLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6Qyx3Q0FBd0M7UUFDeEMsb0JBQW9CLEVBQUUsSUFBSTtRQUMxQixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixNQUFNLEVBQUU7WUFDTixPQUFPLEVBQUUsS0FBSztZQUNkLFdBQVcsRUFBRTtnQkFDWCxVQUFVLEVBQUUsb0JBQW9CO2FBQ2pDO1NBQ0Y7UUFDRCxrQ0FBa0M7UUFDbEMsY0FBYyxFQUFFO1lBQ2QsV0FBVyxFQUFFO2dCQUNYLHFDQUFxQztnQkFDckMsdUVBQXVFO2dCQUN2RSxXQUFXLEVBQUUsRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUU7Z0JBQ3BELHlEQUF5RDtnQkFDekQsVUFBVSxFQUFFO29CQUNWO3dCQUNFLEVBQUUsRUFBRSxZQUFZO3dCQUNoQixLQUFLLEVBQUUsWUFBWTt3QkFDbkIsSUFBSSxFQUFFLG1CQUFtQjt3QkFDekIsT0FBTyxFQUFFLFlBQVk7d0JBQ3JCLGlFQUFpRTt3QkFDakUsR0FBRyxFQUFFLDRDQUE0Qzt3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LEVBQUU7WUFDUixLQUFLLEVBQUUsTUFBTTtZQUNiLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsWUFBWSxFQUFFLFVBQVUsQ0FBRSxFQUFFO1lBQ2hFLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7UUFDRCwrRUFBK0U7UUFDL0UsNERBQTREO1FBQzVELFVBQVUsRUFBRTtZQUNWLEtBQUssRUFBRSxNQUFNO1lBQ2IsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFLFFBQVEsRUFBRSxZQUFZLEVBQUU7WUFDOUQsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUUsRUFBRTtTQUN0RDtRQUNELCtGQUErRjtRQUMvRixVQUFVLEVBQUU7WUFDVixLQUFLLEVBQUUsTUFBTTtZQUNiLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsVUFBVSxDQUFFLEVBQUU7WUFDbEQsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUUsRUFBRTtTQUN0RDtRQUNELDJEQUEyRDtLQUM1RDtDQUNPLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eSBMb2cgRW50aXR5IFNjaGVtYVxuICogXG4gKiBEeW5hbW9EQiB0YWJsZSBzY2hlbWEgZm9yIHN0b3JpbmcgYWxsIG9ic2VydmFiaWxpdHkgZXZlbnRzLlxuICogVXNlZCBieSBPYnNlcnZhYmlsaXR5TG9nU2VydmljZSB3aGljaCBpcyBzZWxmLWNvbnRhaW5lZCAobm8gREkgZGVwZW5kZW5jeSkuXG4gKi9cblxuaW1wb3J0IHsgcmFuZG9tQnl0ZXMgfSBmcm9tICdjcnlwdG8nO1xuLy8gSW1wb3J0IGRpcmVjdGx5IGZyb20gYmFzZS1lbnRpdHkgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeVxuaW1wb3J0IHsgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIGNyZWF0ZUVudGl0eVNjaGVtYSB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLWVudGl0eSc7XG5cbi8qKlxuICogT2JzZXJ2YWJpbGl0eSBMb2cgRW50aXR5IFNjaGVtYVxuICogXG4gKiBVbml2ZXJzYWwgc2NoZW1hIGZvciBhbGwgb2JzZXJ2YWJpbGl0eSBldmVudCB0eXBlczpcbiAqIC0gc3BhbiAvIHNwYW4uc3RhcnQgKGRpc3RyaWJ1dGVkIHRyYWNpbmcpXG4gKiAtIGF1ZGl0LmVudGl0eSwgYXVkaXQuYWN0aW9uLCBhdWRpdC5jb21wbGlhbmNlIChhdWRpdGluZylcbiAqIC0gbWV0cmljIChtZXRyaWNzL2NvdW50ZXJzKVxuICogLSB3b3JrZmxvdy4qICh3b3JrZmxvdyB0cmFja2luZylcbiAqIC0gZGVjaXNpb24uKiAoZGVjaXNpb24gbG9nZ2luZylcbiAqIC0gYWNjZXNzIChBUEkgYWNjZXNzIGxvZ3MpXG4gKiAtIGxvZyAoc3RydWN0dXJlZCBsb2dnaW5nKVxuICovXG5leHBvcnQgY29uc3QgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gIG1vZGVsOiB7XG4gICAgdmVyc2lvbjogJzEnLFxuICAgIGVudGl0eTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgIGVudGl0eU5hbWVQbHVyYWw6ICdvYnNlcnZhYmlsaXR5TG9ncycsXG4gICAgc2VydmljZTogJ29ic2VydmFiaWxpdHknLFxuICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgIC8vIFN5c3RlbSBlbnRpdHkgLSByZWFkLW9ubHkgaW4gYWRtaW4gVUlcbiAgICBleGNsdWRlRnJvbUFkbWluTWVudTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZTogdHJ1ZSxcbiAgICBzZWFyY2g6IHtcbiAgICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgICAgaW5kZXhDb25maWc6IHtcbiAgICAgICAgcHJpbWFyeUtleTogJ29ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICB9XG4gICAgfSxcbiAgICAvLyA9PT0gTElTVCBQQUdFIENPTkZJR1VSQVRJT04gPT09XG4gICAgbGlzdFBhZ2VDb25maWc6IHtcbiAgICAgIHRhYmxlQ29uZmlnOiB7XG4gICAgICAgIC8vIERlZmF1bHQgc29ydDogbGF0ZXN0IHJlY29yZHMgZmlyc3RcbiAgICAgICAgLy8gU2VhcmNoIG1vZGUgdXNlcyBmdWxsIGNvbmZpZywgREIgbW9kZSBleHRyYWN0cyBqdXN0IHRoZSAnZGVzYycgb3JkZXJcbiAgICAgICAgZGVmYXVsdFNvcnQ6IHsgZmllbGQ6ICd0aW1lc3RhbXBNcycsIG9yZGVyOiAnZGVzYycgfSxcbiAgICAgICAgLy8gUm93IGFjdGlvbnMgLSBxdWljayBhY2Nlc3Mgd2l0aG91dCBsb3NpbmcgbGlzdCBjb250ZXh0XG4gICAgICAgIHJvd0FjdGlvbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3F1aWNrLXZpZXcnLFxuICAgICAgICAgICAgbGFiZWw6ICdRdWljayBWaWV3JyxcbiAgICAgICAgICAgIGljb246ICdFeHBhbmRBbHRPdXRsaW5lZCcsXG4gICAgICAgICAgICB0b29sdGlwOiAnUXVpY2sgVmlldycsXG4gICAgICAgICAgICAvLyBPcGVuIHZpZXcgcGFnZSBpbiBtb2RhbCAtIFVSTCB3aWxsIGJlIHJlc29sdmVkIHRvIGZldGNoIGNvbmZpZ1xuICAgICAgICAgICAgdXJsOiAnL3ZpZXctb2JzZXJ2YWJpbGl0eWxvZy86b2JzZXJ2YWJpbGl0eUxvZ0lkJyxcbiAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgbW9kYWxUaXRsZTogJ0xvZyBEZXRhaWxzJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndmlldy10cmFjZScsXG4gICAgICAgICAgICBsYWJlbDogJ1ZpZXcgVHJhY2UnLFxuICAgICAgICAgICAgaWNvbjogJ0FwYXJ0bWVudE91dGxpbmVkJyxcbiAgICAgICAgICAgIHRvb2x0aXA6ICdWaWV3IGNvcnJlbGF0ZWQgbG9ncycsXG4gICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgIG1vZGFsVGl0bGU6ICdUcmFjZSBMb2dzJyxcbiAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGNvcnJlbGF0aW9uSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGNvcnJlbGF0aW9uSWQ6ICc6Y29ycmVsYXRpb25JZCcgfSxcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd2aWV3LWNoaWxkcmVuJyxcbiAgICAgICAgICAgIGxhYmVsOiAnVmlldyBDaGlsZHJlbicsXG4gICAgICAgICAgICBpY29uOiAnQnJhbmNoZXNPdXRsaW5lZCcsXG4gICAgICAgICAgICB0b29sdGlwOiAnVmlldyBjaGlsZCBsb2dzJyxcbiAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgbW9kYWxUaXRsZTogJ0NoaWxkIExvZ3MnLFxuICAgICAgICAgICAgLy8gU2hvdyBmb3IgbG9ncyB0aGF0IGRvbid0IGhhdmUgYSBwYXJlbnQgKHJvb3QgbG9ncyBtYXkgaGF2ZSBjaGlsZHJlbilcbiAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IGZhbHNlIH0gfSB9LFxuICAgICAgICAgICAgLy8gVXNlIG1vZGFsQ29uZmlnUmVmIHRvIGhpZGUgaGllcmFyY2h5IHNlZ21lbnRzIChjb25mbGljdHMgd2l0aCBwYXJlbnQgZmlsdGVyKVxuICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJzpvYnNlcnZhYmlsaXR5TG9nSWQnIH0sXG4gICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIC8vIE9ubHkgc2hvdyBlc3NlbnRpYWwgY29sdW1ucyBmb3IgcXVpY2sgc2Nhbm5pbmdcbiAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgIHsgZmllbGQ6ICd0eXBlJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdsZXZlbCcgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnZW50aXR5TmFtZScgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnc291cmNlJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdvcGVyYXRpb24nIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ3N0YXR1cycgfSxcbiAgICAgICAgICB7IGZpZWxkOiAndGltZXN0YW1wTXMnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2R1cmF0aW9uTXMnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2NvcnJlbGF0aW9uSWQnLCBkZWZhdWx0VmlzaWJsZTogZmFsc2UgfSxcbiAgICAgICAgXSxcbiAgICAgICAgLy8gPT09IEZJTFRFUiBTRUdNRU5UUzogUXVpY2sgYWNjZXNzIHRvIGNvbW1vbiB2aWV3cyA9PT1cbiAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICAvLyA9PT0gQlkgSElFUkFSQ0hZID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnaGllcmFyY2h5LWdyb3VwJyxcbiAgICAgICAgICAgIGxhYmVsOiAnVmlldycsXG4gICAgICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaWQ6ICdhbGwtc3BhbnMnLCBsYWJlbDogJ0FsbCBFdmVudHMnLCBpY29uOiAnVW5vcmRlcmVkTGlzdE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7fSxcbiAgICAgICAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpZDogJ3Jvb3Qtb25seScsIGxhYmVsOiAnUm9vdCBTcGFucycsIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgLy8gRmlsdGVyOiBubyBwYXJlbnQgPSByb290IHNwYW5cbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IGZhbHNlIH0gfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnY2hpbGQtb25seScsIGxhYmVsOiAnQ2hpbGQgU3BhbnMnLCBpY29uOiAnQnJhbmNoZXNPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgLy8gRmlsdGVyOiBoYXMgcGFyZW50ID0gY2hpbGQgc3BhblxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGV4aXN0czogdHJ1ZSB9IH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gPT09IEJZIExFVkVMID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnbGV2ZWwtZ3JvdXAnLFxuICAgICAgICAgICAgbGFiZWw6ICdMZXZlbCcsXG4gICAgICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgICAgICB7IGlkOiAnYWxsLWxldmVscycsIGxhYmVsOiAnQWxsJywgZmlsdGVyczoge30sIGRlZmF1bHQ6IHRydWUgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ2Vycm9ycycsIGxhYmVsOiAnRXJyb3JzJywgaWNvbjogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAnZXJyb3InIH0gfSwgYmFkZ2VTdGF0dXM6ICdlcnJvcicgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ3dhcm5pbmdzJywgbGFiZWw6ICdXYXJuaW5ncycsIGljb246ICdXYXJuaW5nT3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAnd2FybicgfSB9LCBiYWRnZVN0YXR1czogJ3dhcm5pbmcnIH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdpbmZvJywgbGFiZWw6ICdJbmZvJywgaWNvbjogJ0luZm9DaXJjbGVPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICdpbmZvJyB9IH0gfSxcbiAgICAgICAgICAgICAgeyBpZDogJ2RlYnVnJywgbGFiZWw6ICdEZWJ1ZycsIGljb246ICdCdWdPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICdkZWJ1ZycgfSB9IH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICd0cmFjZScsIGxhYmVsOiAnVHJhY2UnLCBpY29uOiAnQXBhcnRtZW50T3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAndHJhY2UnIH0gfSB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICBleHBhbmRhYmxlOiB7XG4gICAgICAgICAgbW9kZTogJ2pzb24nLFxuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gPT09IFZJRVcgUEFHRSBDT05GSUdVUkFUSU9OID09PVxuICAgIHZpZXdQYWdlQ29uZmlnOiB7XG4gICAgICAvLyBUd28tY29sdW1uIGxheW91dCBmb3IgZXNzZW50aWFsIGlkZW50aWZpY2F0aW9uIGFuZCBvcGVyYXRpb24gZGV0YWlsc1xuICAgICAgY29sdW1uc0NvbmZpZzoge1xuICAgICAgICBjb2x1bW5zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgbGFiZWw6ICdJZGVudGl0eSAmIENsYXNzaWZpY2F0aW9uJyxcbiAgICAgICAgICAgIGZpZWxkczogW1xuICAgICAgICAgICAgICAnb2JzZXJ2YWJpbGl0eUxvZ0lkJyxcbiAgICAgICAgICAgICAgJ3R5cGUnLFxuICAgICAgICAgICAgICAnc3ViVHlwZScsXG4gICAgICAgICAgICAgICdsZXZlbCcsXG4gICAgICAgICAgICAgICdjb3JyZWxhdGlvbklkJywgIC8vIEhhcyBsaW5rQ29uZmlnIC0gcmVuZGVycyBhcyBsaW5rIHRvIHRyYWNlIHZpZXdcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICBsYWJlbDogJ09wZXJhdGlvbiAmIFRpbWluZycsXG4gICAgICAgICAgICBmaWVsZHM6IFtcbiAgICAgICAgICAgICAgJ29wZXJhdGlvbicsXG4gICAgICAgICAgICAgICdzdGF0dXMnLFxuICAgICAgICAgICAgICAnc3VjY2VzcycsXG4gICAgICAgICAgICAgICd0aW1lc3RhbXBNcycsXG4gICAgICAgICAgICAgICdkdXJhdGlvbk1zJyxcbiAgICAgICAgICAgICAgJ3NvdXJjZScsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgLy8gU2VjdGlvbnMgb3JnYW5pemVkIGJ5IGxvZ2ljYWwgZ3JvdXBpbmcgd2l0aCBwcm9wZXIgdGFicy9hY2NvcmRpb25zXG4gICAgICBzZWN0aW9uc0NvbmZpZzoge1xuICAgICAgICBzZWN0aW9uR3JvdXBzOiBbXG4gICAgICAgICAgLy8gPT09IDIuIEhJRVJBUkNIWSAmIFRSQUNFIFJFTEFUSU9OUyA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2hpZXJhcmNoeS1yZWxhdGlvbnMnLFxuICAgICAgICAgICAgbGFiZWw6ICdIaWVyYXJjaHkgJiBUcmFjZScsXG4gICAgICAgICAgICBpY29uOiAnQXBhcnRtZW50T3V0bGluZWQnLFxuICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgcmVuZGVyTW9kZTogJ3RhYnMnLFxuICAgICAgICAgICAgZGVmYXVsdENvbGxhcHNlZDogdHJ1ZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiB0cnVlLFxuICAgICAgICAgICAga2VlcE1vdW50ZWQ6IGZhbHNlLFxuICAgICAgICAgICAgc2VjdGlvbnM6IHtcbiAgICAgICAgICAgICAgcGFyZW50U3Bhbjoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnUGFyZW50IFNwYW4nLFxuICAgICAgICAgICAgICAgIGljb246ICdOb2RlSW5kZXhPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAndmlldycsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogeyBzb3VyY2U6ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnLCB0YXJnZXQ6ICdpZCcgfSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY2hpbGRTcGFuczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ2hpbGQgU3BhbnMnLFxuICAgICAgICAgICAgICAgIGljb246ICdCcmFuY2hlc091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXE6ICc6b2JzZXJ2YWJpbGl0eUxvZ0lkJyB9IH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB0cmFjZUxvZ3M6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1RoaXMgVHJhY2UnLFxuICAgICAgICAgICAgICAgIGljb246ICdTaGFyZUFsdE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBjb3JyZWxhdGlvbklkOiB7IGVxOiAnOmNvcnJlbGF0aW9uSWQnIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQWxsIGV2ZW50cyBpbiB0aGlzIExhbWJkYSBpbnZvY2F0aW9uJyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY2F1c2VkQnlUcmFjZToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ2F1c2luZyBSZXF1ZXN0IFRyYWNlJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnTGlua091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDQsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBjYXVzZWRCeTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgY29ycmVsYXRpb25JZDogeyBlcTogJzpjYXVzZWRCeScgfSB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdWaWV3IHRoZSBvcmlnaW5hbCByZXF1ZXN0IHRyYWNlIHRoYXQgY2F1c2VkIHRoaXMgZXZlbnQnLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBjYXVzZWRFdmVudHM6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0V2ZW50cyBDYXVzZWQgQnkgVGhpcycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0FwaU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDUsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBjYXVzZWRCeTogeyBlcTogJzpjb3JyZWxhdGlvbklkJyB9IH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0V2ZW50cyBpbiBvdGhlciBpbnZvY2F0aW9ucyBjYXVzZWQgYnkgdGhpcyByZXF1ZXN0JyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gMy4gRVZFTlQgREFUQSAoQ29yZSBwYXlsb2FkcykgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdldmVudC1kYXRhJyxcbiAgICAgICAgICAgIGxhYmVsOiAnRXZlbnQgRGF0YScsXG4gICAgICAgICAgICBpY29uOiAnRmlsZVRleHRPdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiBmYWxzZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiB0cnVlLFxuICAgICAgICAgICAgc2VjdGlvbnM6IHtcbiAgICAgICAgICAgICAgZW50aXR5SW5mbzoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRW50aXR5IEluZm9ybWF0aW9uJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnSW5mb0NpcmNsZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlbnRpdHlOYW1lOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2VudGl0eU5hbWUnLCAnZW50aXR5SWQnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY2hlY2twb2ludHM6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0NoZWNrcG9pbnRzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnTm9kZUluZGV4T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLmNoZWNrcG9pbnRzJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5jaGVja3BvaW50cycsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5jaGVja3BvaW50cycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdDaGVja3BvaW50cycsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAndGltZWxpbmUnLFxuICAgICAgICAgICAgICAgICAgICAgIHRpbWVsaW5lQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtb2RlOiAnbGVmdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBzaG93VGltZXN0YW1wOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGltZXN0YW1wRm9ybWF0OiAnaDptbTpzcy5TU1MgQScsXG4gICAgICAgICAgICAgICAgICAgICAgICBpdGVtTWFwcGluZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbEZpZWxkOiAnbmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcEZpZWxkOiAndHMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdSZXN0IERhdGEnLFxuICAgICAgICAgICAgICAgIGljb246ICdGaWxlVGV4dE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBkYXRhOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2RhdGEnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQXR0cmlidXRlcycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1RhZ3NPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAzLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgYXR0cmlidXRlczogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICdhdHRyaWJ1dGVzJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGVycm9yOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFcnJvcicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0V4Y2xhbWF0aW9uQ2lyY2xlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNCxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGVycm9yOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2Vycm9yJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gPT09IDUuIEFERElUSU9OQUwgREFUQSAoVGFncywgTWV0YWRhdGEsIENvbnRleHQpID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnYWRkaXRpb25hbC1kYXRhJyxcbiAgICAgICAgICAgIGxhYmVsOiAnQWRkaXRpb25hbCBEYXRhJyxcbiAgICAgICAgICAgIGljb246ICdGb2xkZXJPcGVuT3V0bGluZWQnLFxuICAgICAgICAgICAgc29ydE9yZGVyOiA1LFxuICAgICAgICAgICAgcmVuZGVyTW9kZTogJ3RhYnMnLFxuICAgICAgICAgICAgZGVmYXVsdENvbGxhcHNlZDogdHJ1ZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiBmYWxzZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiB0cnVlLFxuICAgICAgICAgICAgc2VjdGlvbnM6IHtcbiAgICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnTWV0cmljcycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0Rhc2hib2FyZE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBtZXRyaWNzOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ21ldHJpY3MnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnVGFncycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1RhZ091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyB0YWdzOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ3RhZ3MnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ01ldGFkYXRhJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnSW5mb0NpcmNsZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBtZXRhZGF0YTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICdtZXRhZGF0YScgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdDb250ZXh0JyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRW52aXJvbm1lbnRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA0LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgY29udGV4dDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICdjb250ZXh0JyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gPT09IDYuIFJFTEFURUQgTE9HUyAoRW50aXR5ICYgU291cmNlIEFuYWx5dGljcykgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdyZWxhdGVkLWFuYWx5dGljcycsXG4gICAgICAgICAgICBsYWJlbDogJ1JlbGF0ZWQgTG9ncycsXG4gICAgICAgICAgICBpY29uOiAnRnVuZE91dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogNixcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IHRydWUsXG4gICAgICAgICAgICBsYXp5TG9hZDogZmFsc2UsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogZmFsc2UsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBieUVudGl0eToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRW50aXR5IExvZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdEYXRhYmFzZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlbnRpdHlOYW1lOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICc6ZW50aXR5TmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgZW50aXR5SWQ6ICc6ZW50aXR5SWQnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYnlFbnRpdHlUeXBlOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFbnRpdHkgVHlwZSBMb2dzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQXBwc3RvcmVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZW50aXR5TmFtZTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgZW50aXR5TmFtZTogJzplbnRpdHlOYW1lJyB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYnlTb3VyY2U6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1NvdXJjZSBMb2dzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQ29kZVNhbmRib3hPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAzLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgc291cmNlOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBzb3VyY2U6ICc6c291cmNlJyB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gNy4gQUNUT1IgJiBTWVNURU0gSU5GTyA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2FjdG9yLXN5c3RlbScsXG4gICAgICAgICAgICBsYWJlbDogJ0FjdG9yICYgU3lzdGVtJyxcbiAgICAgICAgICAgIGljb246ICdTZXR0aW5nT3V0bGluZWQnLFxuICAgICAgICAgICAgc29ydE9yZGVyOiA3LFxuICAgICAgICAgICAgcmVuZGVyTW9kZTogJ3RhYnMnLFxuICAgICAgICAgICAgZGVmYXVsdENvbGxhcHNlZDogdHJ1ZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiBmYWxzZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiB0cnVlLFxuICAgICAgICAgICAgc2VjdGlvbnM6IHtcbiAgICAgICAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0FjdG9yJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnVXNlck91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBhY3RvcjogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICdhY3RvcicgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBzeXN0ZW1JbmZvOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdTeXN0ZW0gSW5mbycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0Nsb2NrQ2lyY2xlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAndHRsJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIGF0dHJpYnV0ZXM6IHtcbiAgICAvLyA9PT0gSURFTlRJVFkgPT09XG4gICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgaXNJZGVudGlmaWVyOiB0cnVlLFxuICAgICAgLy8gMTI4LWJpdCBmYWxsYmFjayBmb3IgbWFudWFsL2FkbWluLWNyZWF0ZWQgcmVjb3JkcyAoZnJhbWV3b3JrIGdlbmVyYWxseSBzdXBwbGllcyBvYnNlcnZhYmlsaXR5TG9nSWQgZXhwbGljaXRseSkuXG4gICAgICBkZWZhdWx0OiAoKSA9PiByYW5kb21CeXRlcygxNikudG9TdHJpbmcoJ2hleCcpLFxuICAgICAgbGFiZWw6ICdMb2cgSUQnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgIH0sXG4gICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnUGFyZW50IExvZyBJRCcsXG4gICAgICBoZWxwVGV4dDogJ1JlZmVyZW5jZSB0byBwYXJlbnQgc3BhbiBmb3IgaGllcmFyY2hpY2FsIHRyYWNpbmcnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgLy8gU2VsZi1yZWZlcmVudGlhbCByZWxhdGlvbiB0byBwYXJlbnQgb2JzZXJ2YWJpbGl0eSBsb2dcbiAgICAgIHJlbGF0aW9uOiB7XG4gICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgdHlwZTogJ21hbnktdG8tb25lJyxcbiAgICAgICAgaWRlbnRpZmllcnM6IHsgc291cmNlOiAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJywgdGFyZ2V0OiAnb2JzZXJ2YWJpbGl0eUxvZ0lkJyB9LFxuICAgICAgfSxcbiAgICB9LFxuICAgIC8vIENvbXB1dGVkIGZpZWxkOiB0cnVlIGlmIHRoaXMgaXMgYSByb290IHNwYW4gKG5vIHBhcmVudClcbiAgICAvLyBVc2VkIGZvciBlZmZpY2llbnQgR1NJIHF1ZXJpZXMgaW5zdGVhZCBvZiBub3RFeGlzdHMgZmlsdGVyXG4gICAgaXNSb290OiB7XG4gICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICBsYWJlbDogJ0lzIFJvb3QnLFxuICAgICAgaGVscFRleHQ6ICdUcnVlIGlmIHRoaXMgaXMgYSByb290IHNwYW4gKG5vIHBhcmVudCknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgd2F0Y2g6IFsgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcgXSxcbiAgICAgIC8vIFNldCB0byB0cnVlIHdoZW4gcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGlzIG51bGwvdW5kZWZpbmVkXG4gICAgICBzZXQ6IChfOiB1bmtub3duLCBkYXRhOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZD86IHN0cmluZyB9KSA9PlxuICAgICAgICAhZGF0YS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICBkZWZhdWx0OiAoKSA9PiB0cnVlLCAgLy8gRGVmYXVsdCB0byB0cnVlIGlmIG5vIHBhcmVudCBzcGVjaWZpZWRcbiAgICB9LFxuICAgIC8vIE5PVEU6IGNvcnJlbGF0aW9uSWQgaXMgUkVRVUlSRUQgYW5kIGhhcyBOTyBkZWZhdWx0LlxuICAgIC8vIElmIHlvdSdyZSBnZXR0aW5nIHZhbGlkYXRpb24gZXJyb3JzLCBlbnN1cmUgY29udGV4dCBpcyBlc3RhYmxpc2hlZCAoYXV0byBpbiBjb250cm9sbGVycykuXG4gICAgLy8gSGF2aW5nIGEgZGVmYXVsdCBoZXJlIHdvdWxkIGhpZGUgYnVncyB3aGVyZSBjb250ZXh0IHdhc24ndCBwcm9wZXJseSBlc3RhYmxpc2hlZC5cbiAgICBjb3JyZWxhdGlvbklkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgbGFiZWw6ICdDb3JyZWxhdGlvbiBJRCcsXG4gICAgICBoZWxwVGV4dDogJ1VuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgZW50aXJlIHJlcXVlc3QvdHJhY2UnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgLy8gTk8gREVGQVVMVCAtIG11c3QgYmUgcHJvcGFnYXRlZCBmcm9tIGNvbnRleHRcbiAgICAgIC8vIExpbmsgdG8gZmlsdGVyZWQgbGlzdCBzaG93aW5nIGFsbCBsb2dzIGluIHRoZSBzYW1lIHRyYWNlXG4gICAgICBpc0xpbms6IHRydWUsXG4gICAgICBsaW5rQ29uZmlnOiB7XG4gICAgICAgIHJvdXRlUGF0dGVybjogJy9saXN0LW9ic2VydmFiaWxpdHlsb2c/Y29ycmVsYXRpb25JZC5lcT06Y29ycmVsYXRpb25JZCcsXG4gICAgICAgIGRpc3BsYXlUZXh0OiAnVmlldyBDb3JyZWxhdGVkIExvZ3MnLFxuICAgICAgfSxcbiAgICB9LFxuICAgIC8vIENyb3NzLWludm9jYXRpb24gdHJhY2luZzogQ29ycmVsYXRpb24gSUQgdGhhdCBjYXVzZWQgdGhpcyBldmVudFxuICAgIC8vIEV4YW1wbGU6IER5bmFtb0RCIHN0cmVhbSBhdWRpdCBjYXVzZWQgYnkgb3JpZ2luYWwgQVBJIHJlcXVlc3RcbiAgICBjYXVzZWRCeToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBsYWJlbDogJ0NhdXNlZCBCeScsXG4gICAgICBoZWxwVGV4dDogJ0NvcnJlbGF0aW9uIElEIHRoYXQgY2F1c2VkIHRoaXMgZXZlbnQgKGNyb3NzLWludm9jYXRpb24gdHJhY2luZyknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNMaW5rOiB0cnVlLFxuICAgICAgbGlua0NvbmZpZzoge1xuICAgICAgICByb3V0ZVBhdHRlcm46ICcvbGlzdC1vYnNlcnZhYmlsaXR5bG9nP2NvcnJlbGF0aW9uSWQuZXE9OmNhdXNlZEJ5JyxcbiAgICAgICAgZGlzcGxheVRleHQ6ICdWaWV3IENhdXNpbmcgUmVxdWVzdCcsXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gQWxsIHJlbGF0ZWQgdHJhY2UgSURzIGZvciBjb21wbGV4IHdvcmtmbG93c1xuICAgIHJlbGF0ZWRUcmFjZXM6IHtcbiAgICAgIHR5cGU6ICdsaXN0JyxcbiAgICAgIGl0ZW1zOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICBsYWJlbDogJ1JlbGF0ZWQgVHJhY2VzJyxcbiAgICAgIGhlbHBUZXh0OiAnQWxsIHJlbGF0ZWQgY29ycmVsYXRpb24gSURzIGZvciBjb21wbGV4IHdvcmtmbG93cyBzcGFubmluZyBtdWx0aXBsZSBpbnZvY2F0aW9ucycsXG4gICAgICBpc0ZpbHRlcmFibGU6IGZhbHNlLCAvLyBMaXN0IGZpZWxkLCBub3QgZmlsdGVyYWJsZVxuICAgIH0sXG5cbiAgICAvLyA9PT0gQ0xBU1NJRklDQVRJT04gPT09XG4gICAgdHlwZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGxhYmVsOiAnVHlwZScsXG4gICAgICBoZWxwVGV4dDogJ0V2ZW50IHR5cGUgKHNwYW4sIGF1ZGl0LmVudGl0eSwgbG9nLCBtZXRyaWMsIGV0Yy4pJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgfSxcbiAgICBzdWJUeXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnU3ViLVR5cGUnLFxuICAgICAgaGVscFRleHQ6ICdBZGRpdGlvbmFsIHR5cGUgY2xhc3NpZmljYXRpb24nLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgIH0sXG4gICAgLy8gTk9URTogbGV2ZWwgaXMgUkVRVUlSRUQgYW5kIGhhcyBOTyBkZWZhdWx0LlxuICAgIC8vIFRoZSBvYnNlcnZlciBNVVNUIHNwZWNpZnkgdGhlIGxldmVsIGV4cGxpY2l0bHkuXG4gICAgbGV2ZWw6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBsYWJlbDogJ0xldmVsJyxcbiAgICAgIGhlbHBUZXh0OiAnU2V2ZXJpdHkgbGV2ZWw6IGVycm9yLCB3YXJuLCBpbmZvLCBkZWJ1ZycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc1NvcnRhYmxlOiB0cnVlLFxuICAgICAgLy8gTk8gREVGQVVMVCAtIG11c3QgYmUgc3BlY2lmaWVkIGJ5IG9ic2VydmVyXG4gICAgfSxcblxuICAgIC8vID09PSBFTlRJVFkgQ09OVEVYVCA9PT1cbiAgICBlbnRpdHlOYW1lOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnRW50aXR5IE5hbWUnLFxuICAgICAgaGVscFRleHQ6ICdOYW1lIG9mIHRoZSBlbnRpdHkgdGhpcyBldmVudCByZWxhdGVzIHRvJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgfSxcbiAgICBlbnRpdHlJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ0VudGl0eSBJRCcsXG4gICAgICBoZWxwVGV4dDogJ0lEIG9mIHRoZSBzcGVjaWZpYyBlbnRpdHkgaW5zdGFuY2UnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgLy8gRGVmYXVsdCB0byAnXycgd2hlbiBlbnRpdHlOYW1lIGlzIHNldCBidXQgZW50aXR5SWQgaXMgbm90IChyZXF1aXJlZCBmb3IgYnlFbnRpdHkgY29tcG9zaXRlIGluZGV4KVxuICAgICAgd2F0Y2g6IFsgJ2VudGl0eU5hbWUnIF0sXG4gICAgICBzZXQ6IChfOiB1bmtub3duLCBkYXRhOiB7IGVudGl0eU5hbWU/OiBzdHJpbmc7IGVudGl0eUlkPzogc3RyaW5nIH0pID0+XG4gICAgICAgIGRhdGEuZW50aXR5SWQgfHwgKGRhdGEuZW50aXR5TmFtZSA/ICdfJyA6IHVuZGVmaW5lZCksXG4gICAgICAvLyBEeW5hbWljIGxpbmsgdG8gdGhlIHJlbGF0ZWQgZW50aXR5IGJhc2VkIG9uIGVudGl0eU5hbWVcbiAgICAgIGxpbmtDb25maWc6IHtcbiAgICAgICAgcm91dGVQYXR0ZXJuOiAnL3ZpZXctOmVudGl0eU5hbWUvOmVudGl0eUlkJyxcbiAgICAgICAgZGlzcGxheVRleHQ6ICdWaWV3IHtlbnRpdHlOYW1lfScsXG4gICAgICB9LFxuICAgIH0sXG5cbiAgICAvLyA9PT0gT1BFUkFUSU9OID09PVxuICAgIG9wZXJhdGlvbjoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ09wZXJhdGlvbicsXG4gICAgICBoZWxwVGV4dDogJ1RoZSBvcGVyYXRpb24gYmVpbmcgcGVyZm9ybWVkIChlLmcuLCBjcmVhdGUsIHVwZGF0ZSwgcXVlcnkpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgfSxcbiAgICBzdGF0dXM6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdTdGF0dXMnLFxuICAgICAgaGVscFRleHQ6ICdPcGVyYXRpb24gc3RhdHVzIChlLmcuLCBzdGFydGVkLCBjb21wbGV0ZWQsIGZhaWxlZCknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgIH0sXG4gICAgc3VjY2Vzczoge1xuICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgbGFiZWw6ICdTdWNjZXNzJyxcbiAgICAgIGhlbHBUZXh0OiAnV2hldGhlciB0aGUgb3BlcmF0aW9uIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgZmllbGRUeXBlOiAnYm9vbGVhbicsXG4gICAgICBib29sZWFuTGFiZWxzOiB7IHRydWU6ICdTdWNjZXNzJywgZmFsc2U6ICdGYWlsZWQnIH0sXG4gICAgfSxcblxuICAgIC8vID09PSBUSU1JTkcgPT09XG4gICAgdGltZXN0YW1wTXM6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBkZWZhdWx0OiAoKSA9PiBEYXRlLm5vdygpLFxuICAgICAgbGFiZWw6ICdUaW1lc3RhbXAnLFxuICAgICAgaGVscFRleHQ6ICdFdmVudCB0aW1lc3RhbXAgaW4gbWlsbGlzZWNvbmRzIHNpbmNlIGVwb2NoJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgICBmaWVsZFR5cGU6ICdkYXRldGltZScsXG4gICAgfSxcbiAgICBkdXJhdGlvbk1zOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIGxhYmVsOiAnRHVyYXRpb24gKG1zKScsXG4gICAgICBoZWxwVGV4dDogJ09wZXJhdGlvbiBkdXJhdGlvbiBpbiBtaWxsaXNlY29uZHMnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICAgIGZpZWxkVHlwZTogJ2R1cmF0aW9uJyxcbiAgICAgIGR1cmF0aW9uVW5pdDogJ21zJyxcbiAgICB9LFxuXG4gICAgLy8gPT09IFNPVVJDRSAmIFRBR1MgPT09XG4gICAgc291cmNlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnU291cmNlJyxcbiAgICAgIGhlbHBUZXh0OiAnU291cmNlIG9mIHRoZSBldmVudCAoZS5nLiwgc2VydmljZSBuYW1lLCBmdW5jdGlvbiBuYW1lKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICAvLyBOT1RFOiB0YWdzLCBtZXRyaWNzLCBhdHRyaWJ1dGVzLCBkYXRhLCBtZXRhZGF0YSwgYWN0b3IsIGNvbnRleHQgYWxsIHVzZSBwcm9wZXJ0aWVzOnt9XG4gICAgLy8gVGhpcyBpcyBCWSBERVNJR04gLSB0aGlzIGlzIGEgVU5JVkVSU0FMIHN0b3JlIGZvciBBTEwgZXZlbnQgdHlwZXMgKHNwYW4sIGF1ZGl0LFxuICAgIC8vIG1ldHJpYywgd29ya2Zsb3csIGRlY2lzaW9uLCBhY2Nlc3MsIGxvZykuIEVhY2ggaGFzIGNvbXBsZXRlbHkgZGlmZmVyZW50IHBheWxvYWRzLlxuICAgIC8vIEVsZWN0cm9EQiBwcm9wZXJ0aWVzOnt9ID0gYWNjZXB0IGFueSBtYXAgc3RydWN0dXJlIGF0IHJ1bnRpbWUuXG4gICAgdGFnczoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ1RhZ3MnLFxuICAgICAgaGVscFRleHQ6ICdLZXktdmFsdWUgdGFncyBmb3IgY2F0ZWdvcml6YXRpb24nLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gUEFZTE9BRFMgKHNjaGVtYWxlc3MgYnkgZGVzaWduIC0gZGlmZmVyZW50IGV2ZW50IHR5cGVzIGhhdmUgZGlmZmVyZW50IHN0cnVjdHVyZXMpID09PVxuICAgIG1ldHJpY3M6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdNZXRyaWNzJyxcbiAgICAgIGhlbHBUZXh0OiAnTnVtZXJpY2FsIG1ldHJpY3MgYW5kIG1lYXN1cmVtZW50cycsXG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnQXR0cmlidXRlcycsXG4gICAgICBoZWxwVGV4dDogJ0FkZGl0aW9uYWwgc3RydWN0dXJlZCBhdHRyaWJ1dGVzJyxcbiAgICB9LFxuICAgIGRhdGE6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdEYXRhJyxcbiAgICAgIGhlbHBUZXh0OiAnRXZlbnQtc3BlY2lmaWMgZGF0YSBwYXlsb2FkJyxcbiAgICAgIGNvbXByZXNzZWQ6IHsgdGhyZXNob2xkOiA1MCAqIDEwMjQgfSwgLy8gRnJhbWV3b3JrIGF1dG8tY29tcHJlc3NlcyBpZiA+IDUwS0JcbiAgICB9LFxuICAgIG1ldGFkYXRhOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnTWV0YWRhdGEnLFxuICAgICAgaGVscFRleHQ6ICdBZGRpdGlvbmFsIG1ldGFkYXRhIGFib3V0IHRoZSBldmVudCcsXG4gICAgICBjb21wcmVzc2VkOiB0cnVlLCAvLyBGcmFtZXdvcmsgYXV0by1jb21wcmVzc2VzIGlmID4gMTBLQlxuICAgIH0sXG4gICAgZXJyb3I6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdFcnJvcicsXG4gICAgICBoZWxwVGV4dDogJ0Vycm9yIGRldGFpbHMgaWYgdGhlIG9wZXJhdGlvbiBmYWlsZWQnLFxuICAgICAgLy8gU3RydWN0dXJlOiB7IHR5cGU6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nLCBzdGFjaz86IHN0cmluZywgY29kZT86IHN0cmluZyB9XG4gICAgfSxcbiAgICAvLyA9PT0gQUNUT1IgKHN0b3JlZCBhcy1pcyBmcm9tIGV4aXN0aW5nIEFjdG9yIHR5cGUpID09PVxuICAgIGFjdG9yOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnQWN0b3InLFxuICAgICAgaGVscFRleHQ6ICdJbmZvcm1hdGlvbiBhYm91dCB3aG8gdHJpZ2dlcmVkIHRoaXMgZXZlbnQnLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gQ09OVEVYVCA9PT1cbiAgICBjb250ZXh0OiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnQ29udGV4dCcsXG4gICAgICBoZWxwVGV4dDogJ0V4ZWN1dGlvbiBjb250ZXh0IGFuZCBlbnZpcm9ubWVudCBpbmZvcm1hdGlvbicsXG4gICAgfSxcblxuICAgIC8vID09PSBUVEwgPT09XG4gICAgLy8gVFRMIGZvciBhdXRvLWNsZWFudXAgKGFsd2F5cyBwcm92aWRlZCBieSBiYWNrZW5kKVxuICAgIHR0bDoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICBkZWZhdWx0OiAoKSA9PiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICg5MCAqIDI0ICogNjAgKiA2MCksIC8vIDkwIGRheXNcbiAgICAgIGxhYmVsOiAnVFRMJyxcbiAgICAgIGhlbHBUZXh0OiAnVGltZS10by1saXZlIGZvciBhdXRvbWF0aWMgY2xlYW51cCAoVW5peCB0aW1lc3RhbXApJyxcbiAgICAgIGZpZWxkVHlwZTogJ3R0bCcsXG4gICAgICB0dGxVbml0OiAnc2Vjb25kcycsXG4gICAgICB0dGxGb3JtYXQ6ICdhdXRvJyxcbiAgICAgIGlzVmlzaWJsZTogdHJ1ZSxcbiAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICB9LFxuICBpbmRleGVzOiB7XG4gICAgLy8gPT09IElOREVYIERFU0lHTiBOT1RFUyA9PT1cbiAgICAvLyAxLiBQcmltYXJ5IGluZGV4IGhhcyBubyBzb3J0IGtleSAtIG9ubHkgZm9yIHNpbmdsZS1pdGVtIGxvb2t1cHMgYnkgSURcbiAgICAvLyAyLiBHU0k3IChhbGxSZWNvcmRzKSBwcm92aWRlcyBzb3J0ZWQgbGlzdGluZyBmb3IgdW5maWx0ZXJlZCBxdWVyaWVzXG4gICAgLy8gICAgLSBVc2VzIGNvbnN0YW50IFBLIHRlbXBsYXRlIHRvIGdyb3VwIGFsbCByZWNvcmRzXG4gICAgLy8gICAgLSBTb3J0ZWQgYnkgdGltZXN0YW1wTXMgZm9yIGVmZmljaWVudCBjaHJvbm9sb2dpY2FsIGxpc3RpbmdcbiAgICAvLyAgICAtIFRyYWRlLW9mZjogSG90IHBhcnRpdGlvbiwgYnV0IGFjY2VwdGFibGUgZm9yIG9ic2VydmFiaWxpdHkgbG9ncyB3aXRoIFRUTFxuICAgIC8vIDMuIEFsbCBvdGhlciBHU0lzIGFyZSBmb3IgZmlsdGVyZWQgcXVlcmllcyAoYnkgdHJhY2UsIHBhcmVudCwgdHlwZSwgbGV2ZWwsIGV0Yy4pXG5cbiAgICAvLyBQcmltYXJ5IC0gYnkgb2JzZXJ2YWJpbGl0eUxvZ0lkXG4gICAgcHJpbWFyeToge1xuICAgICAgcGs6IHsgZmllbGQ6ICdwaycsIGNvbXBvc2l0ZTogWyAnb2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ3NrJywgY29tcG9zaXRlOiBbXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJMSAtIGJ5IHRyYWNlIC0gZ2V0IGFsbCBldmVudHMgaW4gYSByZXF1ZXN0L3RyYWNlXG4gICAgYnlUcmFjZToge1xuICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpMXBrJywgY29tcG9zaXRlOiBbICdjb3JyZWxhdGlvbklkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTFzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTIgLSBieSBwYXJlbnQgLSBnZXQgY2hpbGRyZW4sIHJlY29uc3RydWN0IHNwYW4gaGllcmFyY2h5XG4gICAgYnlQYXJlbnQ6IHtcbiAgICAgIGluZGV4OiAnZ3NpMicsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTJwaycsIGNvbXBvc2l0ZTogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTJzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTMgLSBieSB0eXBlIC0gZmlsdGVyIGJ5IGV2ZW50IHR5cGUgKHNwYW4uKiwgYXVkaXQuKiwgbG9nLCBtZXRyaWMpXG4gICAgYnlUeXBlOiB7XG4gICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2kzcGsnLCBjb21wb3NpdGU6IFsgJ3R5cGUnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpM3NrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNCAtIGJ5IGxldmVsIC0gZmluZCBlcnJvcnMvd2FybmluZ3MgcXVpY2tseVxuICAgIGJ5TGV2ZWw6IHtcbiAgICAgIGluZGV4OiAnZ3NpNCcsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTRwaycsIGNvbXBvc2l0ZTogWyAnbGV2ZWwnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNHNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNSAtIGJ5IGVudGl0eSB0eXBlIC0gXCJhbGwgT3JkZXIgZXZlbnRzXCIsIFwiYWxsIFVzZXIgZXZlbnRzXCJcbiAgICBieUVudGl0eVR5cGU6IHtcbiAgICAgIGluZGV4OiAnZ3NpNScsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTVwaycsIGNvbXBvc2l0ZTogWyAnZW50aXR5TmFtZScgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k1c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k2IC0gYnkgZW50aXR5IGluc3RhbmNlIC0gXCJhbGwgZXZlbnRzIGZvciBPcmRlcjoxMjNcIlxuICAgIGJ5RW50aXR5OiB7XG4gICAgICBpbmRleDogJ2dzaTYnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k2cGsnLCBjb21wb3NpdGU6IFsgJ2VudGl0eU5hbWUnLCAnZW50aXR5SWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNnNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNyAtIGFsbCByZWNvcmRzIGJ5IHRpbWVzdGFtcCAtIGZvciBlZmZpY2llbnQgc29ydGVkIGxpc3Rpbmcgb2YgYWxsIGV2ZW50c1xuICAgIC8vIFVzZXMgY29uc3RhbnQgcGFydGl0aW9uIGtleSB0byBncm91cCBhbGwgcmVjb3JkcyB0b2dldGhlclxuICAgIGFsbFJlY29yZHM6IHtcbiAgICAgIGluZGV4OiAnZ3NpNycsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTdwaycsIGNvbXBvc2l0ZTogW10sIHRlbXBsYXRlOiAnQUxMX0VWRU5UUycgfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpN3NrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJOCAtIGJ5IGNhdXNlZEJ5IC0gZmluZCBhbGwgZXZlbnRzIGNhdXNlZCBieSBhIHNwZWNpZmljIHJlcXVlc3QgKGNyb3NzLWludm9jYXRpb24gdHJhY2luZylcbiAgICBieUNhdXNlZEJ5OiB7XG4gICAgICBpbmRleDogJ2dzaTgnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k4cGsnLCBjb21wb3NpdGU6IFsgJ2NhdXNlZEJ5JyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaThzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEZvciBzb3VyY2UvYWN0b3IvdGVuYW50IHF1ZXJpZXMgLSB1c2Ugc2VhcmNoIGVuZ2luZSBzeW5jXG4gIH0sXG59IGFzIGNvbnN0KTtcblxuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYSA9IHR5cGVvZiBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hOyJdfQ==