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
                                    propertiesConfig: ['entityName', 'entityId'],
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
                                    propertiesConfig: ['attributes'],
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
                                    propertiesConfig: ['error'],
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
                                    propertiesConfig: ['data'],
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
                                        hideSegments: ['hierarchy-group'],
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
                                        hideSegments: ['hierarchy-group'],
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
                                        hideSegments: ['hierarchy-group'],
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
                                        hideSegments: ['hierarchy-group'],
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
                                        hideSegments: ['hierarchy-group'],
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
                                        hideSegments: ['hierarchy-group'],
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
                                    propertiesConfig: ['relatedTraces'],
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1sb2ctZW50aXR5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvc3RvcmFnZS9vYnNlcnZhYmlsaXR5LWxvZy1lbnRpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCxtQ0FBcUM7QUFDckMsZ0VBQWdFO0FBQ2hFLDBEQUF1RjtBQUV2Rjs7Ozs7Ozs7Ozs7R0FXRztBQUNVLFFBQUEsNEJBQTRCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUM3RCxLQUFLLEVBQUU7UUFDTCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxrQkFBa0I7UUFDMUIsZ0JBQWdCLEVBQUUsbUJBQW1CO1FBQ3JDLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6Qyx3Q0FBd0M7UUFDeEMsbUJBQW1CLEVBQUUsSUFBSTtRQUN6QixvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLE1BQU0sRUFBRTtZQUNOLE9BQU8sRUFBRSxLQUFLO1lBQ2QsV0FBVyxFQUFFO2dCQUNYLFVBQVUsRUFBRSxvQkFBb0I7YUFDakM7U0FDRjtRQUNELGtDQUFrQztRQUNsQyxjQUFjLEVBQUU7WUFDZCxXQUFXLEVBQUU7Z0JBQ1gscUNBQXFDO2dCQUNyQyx1RUFBdUU7Z0JBQ3ZFLFdBQVcsRUFBRSxFQUFFLEtBQUssRUFBRSxhQUFhLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRTtnQkFDcEQseURBQXlEO2dCQUN6RCxVQUFVLEVBQUU7b0JBQ1Y7d0JBQ0UsRUFBRSxFQUFFLFlBQVk7d0JBQ2hCLEtBQUssRUFBRSxZQUFZO3dCQUNuQixJQUFJLEVBQUUsbUJBQW1CO3dCQUN6QixPQUFPLEVBQUUsWUFBWTt3QkFDckIsaUVBQWlFO3dC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QUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLGFBQWEsQ0FBRSxFQUFFO1NBQ3REO1FBQ0QseURBQXlEO1FBQ3pELFFBQVEsRUFBRTtZQUNSLEtBQUssRUFBRSxNQUFNO1lBQ2IsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxZQUFZLEVBQUUsVUFBVSxDQUFFLEVBQUU7WUFDaEUsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUUsRUFBRTtTQUN0RDtRQUNELCtFQUErRTtRQUMvRSw0REFBNEQ7UUFDNUQsVUFBVSxFQUFFO1lBQ1YsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUUsUUFBUSxFQUFFLFlBQVksRUFBRTtZQUM5RCxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLGFBQWEsQ0FBRSxFQUFFO1NBQ3REO1FBQ0QsK0ZBQStGO1FBQy9GLFVBQVUsRUFBRTtZQUNWLEtBQUssRUFBRSxNQUFNO1lBQ2IsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxVQUFVLENBQUUsRUFBRTtZQUNsRCxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLGFBQWEsQ0FBRSxFQUFFO1NBQ3REO1FBQ0QsMkRBQTJEO0tBQzVEO0NBQ08sQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5IExvZyBFbnRpdHkgU2NoZW1hXG4gKiBcbiAqIER5bmFtb0RCIHRhYmxlIHNjaGVtYSBmb3Igc3RvcmluZyBhbGwgb2JzZXJ2YWJpbGl0eSBldmVudHMuXG4gKiBVc2VkIGJ5IE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlIHdoaWNoIGlzIHNlbGYtY29udGFpbmVkIChubyBESSBkZXBlbmRlbmN5KS5cbiAqL1xuXG5pbXBvcnQgeyByYW5kb21CeXRlcyB9IGZyb20gJ2NyeXB0byc7XG4vLyBJbXBvcnQgZGlyZWN0bHkgZnJvbSBiYXNlLWVudGl0eSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5XG5pbXBvcnQgeyBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgY3JlYXRlRW50aXR5U2NoZW1hIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcblxuLyoqXG4gKiBPYnNlcnZhYmlsaXR5IExvZyBFbnRpdHkgU2NoZW1hXG4gKiBcbiAqIFVuaXZlcnNhbCBzY2hlbWEgZm9yIGFsbCBvYnNlcnZhYmlsaXR5IGV2ZW50IHR5cGVzOlxuICogLSBzcGFuIC8gc3Bhbi5zdGFydCAoZGlzdHJpYnV0ZWQgdHJhY2luZylcbiAqIC0gYXVkaXQuZW50aXR5LCBhdWRpdC5hY3Rpb24sIGF1ZGl0LmNvbXBsaWFuY2UgKGF1ZGl0aW5nKVxuICogLSBtZXRyaWMgKG1ldHJpY3MvY291bnRlcnMpXG4gKiAtIHdvcmtmbG93LiogKHdvcmtmbG93IHRyYWNraW5nKVxuICogLSBkZWNpc2lvbi4qIChkZWNpc2lvbiBsb2dnaW5nKVxuICogLSBhY2Nlc3MgKEFQSSBhY2Nlc3MgbG9ncylcbiAqIC0gbG9nIChzdHJ1Y3R1cmVkIGxvZ2dpbmcpXG4gKi9cbmV4cG9ydCBjb25zdCBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgbW9kZWw6IHtcbiAgICB2ZXJzaW9uOiAnMScsXG4gICAgZW50aXR5OiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgZW50aXR5TmFtZVBsdXJhbDogJ29ic2VydmFiaWxpdHlMb2dzJyxcbiAgICBzZXJ2aWNlOiAnb2JzZXJ2YWJpbGl0eScsXG4gICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgLy8gU3lzdGVtIGVudGl0eSAtIHJlYWQtb25seSBpbiBhZG1pbiBVSVxuICAgIGV4Y2x1ZGVBdWRpdEFjdGlvbnM6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbk1lbnU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IHRydWUsXG4gICAgc2VhcmNoOiB7XG4gICAgICBlbmFibGVkOiBmYWxzZSxcbiAgICAgIGluZGV4Q29uZmlnOiB7XG4gICAgICAgIHByaW1hcnlLZXk6ICdvYnNlcnZhYmlsaXR5TG9nSWQnLFxuICAgICAgfVxuICAgIH0sXG4gICAgLy8gPT09IExJU1QgUEFHRSBDT05GSUdVUkFUSU9OID09PVxuICAgIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgICB0YWJsZUNvbmZpZzoge1xuICAgICAgICAvLyBEZWZhdWx0IHNvcnQ6IGxhdGVzdCByZWNvcmRzIGZpcnN0XG4gICAgICAgIC8vIFNlYXJjaCBtb2RlIHVzZXMgZnVsbCBjb25maWcsIERCIG1vZGUgZXh0cmFjdHMganVzdCB0aGUgJ2Rlc2MnIG9yZGVyXG4gICAgICAgIGRlZmF1bHRTb3J0OiB7IGZpZWxkOiAndGltZXN0YW1wTXMnLCBvcmRlcjogJ2Rlc2MnIH0sXG4gICAgICAgIC8vIFJvdyBhY3Rpb25zIC0gcXVpY2sgYWNjZXNzIHdpdGhvdXQgbG9zaW5nIGxpc3QgY29udGV4dFxuICAgICAgICByb3dBY3Rpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdxdWljay12aWV3JyxcbiAgICAgICAgICAgIGxhYmVsOiAnUXVpY2sgVmlldycsXG4gICAgICAgICAgICBpY29uOiAnRXhwYW5kQWx0T3V0bGluZWQnLFxuICAgICAgICAgICAgdG9vbHRpcDogJ1F1aWNrIFZpZXcnLFxuICAgICAgICAgICAgLy8gT3BlbiB2aWV3IHBhZ2UgaW4gbW9kYWwgLSBVUkwgd2lsbCBiZSByZXNvbHZlZCB0byBmZXRjaCBjb25maWdcbiAgICAgICAgICAgIHVybDogJy92aWV3LW9ic2VydmFiaWxpdHlsb2cvOm9ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgIG1vZGFsVGl0bGU6ICdMb2cgRGV0YWlscycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3ZpZXctdHJhY2UnLFxuICAgICAgICAgICAgbGFiZWw6ICdWaWV3IFRyYWNlJyxcbiAgICAgICAgICAgIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsXG4gICAgICAgICAgICB0b29sdGlwOiAnVmlldyBjb3JyZWxhdGVkIGxvZ3MnLFxuICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICBtb2RhbFRpdGxlOiAnVHJhY2UgTG9ncycsXG4gICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBjb3JyZWxhdGlvbklkOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBjb3JyZWxhdGlvbklkOiAnOmNvcnJlbGF0aW9uSWQnIH0sXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndmlldy1jaGlsZHJlbicsXG4gICAgICAgICAgICBsYWJlbDogJ1ZpZXcgQ2hpbGRyZW4nLFxuICAgICAgICAgICAgaWNvbjogJ0JyYW5jaGVzT3V0bGluZWQnLFxuICAgICAgICAgICAgdG9vbHRpcDogJ1ZpZXcgY2hpbGQgbG9ncycsXG4gICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgIG1vZGFsVGl0bGU6ICdDaGlsZCBMb2dzJyxcbiAgICAgICAgICAgIC8vIFNob3cgZm9yIGxvZ3MgdGhhdCBkb24ndCBoYXZlIGEgcGFyZW50IChyb290IGxvZ3MgbWF5IGhhdmUgY2hpbGRyZW4pXG4gICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiBmYWxzZSB9IH0gfSxcbiAgICAgICAgICAgIC8vIFVzZSBtb2RhbENvbmZpZ1JlZiB0byBoaWRlIGhpZXJhcmNoeSBzZWdtZW50cyAoY29uZmxpY3RzIHdpdGggcGFyZW50IGZpbHRlcilcbiAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICc6b2JzZXJ2YWJpbGl0eUxvZ0lkJyB9LFxuICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICAvLyBPbmx5IHNob3cgZXNzZW50aWFsIGNvbHVtbnMgZm9yIHF1aWNrIHNjYW5uaW5nXG4gICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICB7IGZpZWxkOiAndHlwZScgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnbGV2ZWwnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2VudGl0eU5hbWUnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ3NvdXJjZScgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnb3BlcmF0aW9uJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdzdGF0dXMnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ3RpbWVzdGFtcE1zJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdkdXJhdGlvbk1zJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdjb3JyZWxhdGlvbklkJywgZGVmYXVsdFZpc2libGU6IGZhbHNlIH0sXG4gICAgICAgIF0sXG4gICAgICAgIC8vID09PSBGSUxURVIgU0VHTUVOVFM6IFF1aWNrIGFjY2VzcyB0byBjb21tb24gdmlld3MgPT09XG4gICAgICAgIHNlZ21lbnRzOiBbXG4gICAgICAgICAgLy8gPT09IEJZIEhJRVJBUkNIWSA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2hpZXJhcmNoeS1ncm91cCcsXG4gICAgICAgICAgICBsYWJlbDogJ1ZpZXcnLFxuICAgICAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnYWxsLXNwYW5zJywgbGFiZWw6ICdBbGwgRXZlbnRzJywgaWNvbjogJ1Vub3JkZXJlZExpc3RPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgZmlsdGVyczoge30sXG4gICAgICAgICAgICAgICAgZGVmYXVsdDogdHJ1ZVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaWQ6ICdyb290LW9ubHknLCBsYWJlbDogJ1Jvb3QgU3BhbnMnLCBpY29uOiAnQXBhcnRtZW50T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIC8vIEZpbHRlcjogbm8gcGFyZW50ID0gcm9vdCBzcGFuXG4gICAgICAgICAgICAgICAgZmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiBmYWxzZSB9IH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpZDogJ2NoaWxkLW9ubHknLCBsYWJlbDogJ0NoaWxkIFNwYW5zJywgaWNvbjogJ0JyYW5jaGVzT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIC8vIEZpbHRlcjogaGFzIHBhcmVudCA9IGNoaWxkIHNwYW5cbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IHRydWUgfSB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vID09PSBCWSBMRVZFTCA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2xldmVsLWdyb3VwJyxcbiAgICAgICAgICAgIGxhYmVsOiAnTGV2ZWwnLFxuICAgICAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICAgICAgeyBpZDogJ2FsbC1sZXZlbHMnLCBsYWJlbDogJ0FsbCcsIGZpbHRlcnM6IHt9LCBkZWZhdWx0OiB0cnVlIH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdlcnJvcnMnLCBsYWJlbDogJ0Vycm9ycycsIGljb246ICdDbG9zZUNpcmNsZU91dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ2Vycm9yJyB9IH0sIGJhZGdlU3RhdHVzOiAnZXJyb3InIH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICd3YXJuaW5ncycsIGxhYmVsOiAnV2FybmluZ3MnLCBpY29uOiAnV2FybmluZ091dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ3dhcm4nIH0gfSwgYmFkZ2VTdGF0dXM6ICd3YXJuaW5nJyB9LFxuICAgICAgICAgICAgICB7IGlkOiAnaW5mbycsIGxhYmVsOiAnSW5mbycsIGljb246ICdJbmZvQ2lyY2xlT3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAnaW5mbycgfSB9IH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdkZWJ1ZycsIGxhYmVsOiAnRGVidWcnLCBpY29uOiAnQnVnT3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAnZGVidWcnIH0gfSB9LFxuICAgICAgICAgICAgICB7IGlkOiAndHJhY2UnLCBsYWJlbDogJ1RyYWNlJywgaWNvbjogJ0FwYXJ0bWVudE91dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ3RyYWNlJyB9IH0gfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgZXhwYW5kYWJsZToge1xuICAgICAgICAgIG1vZGU6ICdqc29uJyxcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9LFxuICAgIC8vID09PSBWSUVXIFBBR0UgQ09ORklHVVJBVElPTiA9PT1cbiAgICB2aWV3UGFnZUNvbmZpZzoge1xuICAgICAgLy8gVHdvLWNvbHVtbiBsYXlvdXQgZm9yIGVzc2VudGlhbCBpZGVudGlmaWNhdGlvbiBhbmQgb3BlcmF0aW9uIGRldGFpbHNcbiAgICAgIGNvbHVtbnNDb25maWc6IHtcbiAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgIGxhYmVsOiAnSWRlbnRpdHkgJiBDbGFzc2lmaWNhdGlvbicsXG4gICAgICAgICAgICBmaWVsZHM6IFtcbiAgICAgICAgICAgICAgJ29ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgICAgICd0eXBlJyxcbiAgICAgICAgICAgICAgJ3N1YlR5cGUnLFxuICAgICAgICAgICAgICAnbGV2ZWwnLFxuICAgICAgICAgICAgICAnY29ycmVsYXRpb25JZCcsICAvLyBIYXMgbGlua0NvbmZpZyAtIHJlbmRlcnMgYXMgbGluayB0byB0cmFjZSB2aWV3XG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgbGFiZWw6ICdPcGVyYXRpb24gJiBUaW1pbmcnLFxuICAgICAgICAgICAgZmllbGRzOiBbXG4gICAgICAgICAgICAgICdvcGVyYXRpb24nLFxuICAgICAgICAgICAgICAnc3RhdHVzJyxcbiAgICAgICAgICAgICAgJ3N1Y2Nlc3MnLFxuICAgICAgICAgICAgICAndGltZXN0YW1wTXMnLFxuICAgICAgICAgICAgICAnZHVyYXRpb25NcycsXG4gICAgICAgICAgICAgICdzb3VyY2UnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIC8vIFNlY3Rpb25zIG9yZ2FuaXplZCBieSBsb2dpY2FsIGdyb3VwaW5nIHdpdGggcHJvcGVyIHRhYnMvYWNjb3JkaW9uc1xuICAgICAgc2VjdGlvbnNDb25maWc6IHtcbiAgICAgICAgc2VjdGlvbkdyb3VwczogW1xuICAgICAgICAgIC8vID09PSAxLiBPUEVSQVRJT04gJiBUSU1JTkcgKFBSSU1BUlkgSU5GTykgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdvcGVyYXRpb24tdGltaW5nJyxcbiAgICAgICAgICAgIGxhYmVsOiAnT3BlcmF0aW9uICYgVGltaW5nJyxcbiAgICAgICAgICAgIGljb246ICdUaHVuZGVyYm9sdE91dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IHRydWUsXG4gICAgICAgICAgICBsYXp5TG9hZDogZmFsc2UsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogdHJ1ZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIG9wZXJhdGlvbkRldGFpbHM6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ09wZXJhdGlvbicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1BsYXlDaXJjbGVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgICdvcGVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAnc3RhdHVzJyxcbiAgICAgICAgICAgICAgICAgICAgJ3N1Y2Nlc3MnLFxuICAgICAgICAgICAgICAgICAgICAndHlwZScsXG4gICAgICAgICAgICAgICAgICAgICdzdWJUeXBlJyxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZW50aXR5SW5mbzoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRW50aXR5IEluZm9ybWF0aW9uJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnSW5mb0NpcmNsZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlbnRpdHlOYW1lOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2VudGl0eU5hbWUnLCAnZW50aXR5SWQnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgdGltaW5nRGV0YWlsczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnVGltaW5nJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQ2xvY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAzLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgICd0aW1lc3RhbXBNcycsXG4gICAgICAgICAgICAgICAgICAgICdkdXJhdGlvbk1zJyxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgc291cmNlRGV0YWlsczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnU291cmNlJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQ29kZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDQsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBzb3VyY2U6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICAnc291cmNlJyxcbiAgICAgICAgICAgICAgICAgICAgJ2xldmVsJyxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQXR0cmlidXRlcycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1RhZ3NPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA0LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgYXR0cmlidXRlczogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICdhdHRyaWJ1dGVzJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gPT09IDIuIEVSUk9SIChFcnJvciBkZXRhaWxzKSA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Vycm9yJyxcbiAgICAgICAgICAgIGxhYmVsOiAnRXJyb3InLFxuICAgICAgICAgICAgaWNvbjogJ0V4Y2xhbWF0aW9uQ2lyY2xlT3V0bGluZWQnLFxuICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgcmVuZGVyTW9kZTogJ3RhYnMnLFxuICAgICAgICAgICAgZGVmYXVsdENvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgICAgICBsYXp5TG9hZDogZmFsc2UsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogdHJ1ZSxcbiAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGVycm9yOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIGVycm9yOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFcnJvcicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0V4Y2xhbWF0aW9uQ2lyY2xlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnZXJyb3InIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gMy4gRVZFTlQgREFUQSAoQ29yZSBwYXlsb2FkcykgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdldmVudC1kYXRhJyxcbiAgICAgICAgICAgIGxhYmVsOiAnRXZlbnQgRGF0YScsXG4gICAgICAgICAgICBpY29uOiAnRmlsZVRleHRPdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiBmYWxzZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiB0cnVlLFxuICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZGF0YTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBjaGVja3BvaW50czoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ2hlY2twb2ludHMnLFxuICAgICAgICAgICAgICAgIGljb246ICdOb2RlSW5kZXhPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2RhdGEuY2hlY2twb2ludHMnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLmNoZWNrcG9pbnRzJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdkYXRhLmNoZWNrcG9pbnRzJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0NoZWNrcG9pbnRzJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICd0aW1lbGluZScsXG4gICAgICAgICAgICAgICAgICAgICAgdGltZWxpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGU6ICdsZWZ0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNob3dUaW1lc3RhbXA6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXBGb3JtYXQ6ICdoOm1tOnNzLlNTUyBBJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW1NYXBwaW5nOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsRmllbGQ6ICduYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZXN0YW1wRmllbGQ6ICd0cycsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0V2ZW50IFBheWxvYWQnLFxuICAgICAgICAgICAgICAgIGljb246ICdGaWxlVGV4dE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBkYXRhOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2RhdGEnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gNC4gSElFUkFSQ0hZICYgVFJBQ0UgUkVMQVRJT05TID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnaGllcmFyY2h5LXJlbGF0aW9ucycsXG4gICAgICAgICAgICBsYWJlbDogJ0hpZXJhcmNoeSAmIFRyYWNlJyxcbiAgICAgICAgICAgIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDQsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiB0cnVlLFxuICAgICAgICAgICAgbGF6eUxvYWQ6IHRydWUsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogZmFsc2UsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBoaWVyYXJjaHlJbmZvOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdIaWVyYXJjaHkgSW5mbycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ05vZGVJbmRleE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDAsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgICAgICAgICAgJ2lzUm9vdCcsXG4gICAgICAgICAgICAgICAgICAgICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnLFxuICAgICAgICAgICAgICAgICAgICAnY29ycmVsYXRpb25JZCcsXG4gICAgICAgICAgICAgICAgICAgICdjYXVzZWRCeScsXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHBhcmVudFNwYW46IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1BhcmVudCBTcGFuJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQXJyb3dVcE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5nOiB7IHNvdXJjZTogJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsIHRhcmdldDogJ2lkJyB9LFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBzaWJsaW5nU3BhbnM6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1NpYmxpbmcgU3BhbnMnLFxuICAgICAgICAgICAgICAgIGljb246ICdCbG9ja091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGVxOiAnOnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcgfSxcbiAgICAgICAgICAgICAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IHsgbmU6ICc6b2JzZXJ2YWJpbGl0eUxvZ0lkJyB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdPdGhlciBzcGFucyBhdCB0aGUgc2FtZSBoaWVyYXJjaHkgbGV2ZWwgKHNhbWUgcGFyZW50KScsXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGNoaWxkU3BhbnM6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0NoaWxkIFNwYW5zJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQnJhbmNoZXNPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAzLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGVxOiAnOm9ic2VydmFiaWxpdHlMb2dJZCcgfSB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgcm9vdFNwYW46IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1Jvb3Qgb2YgSGllcmFyY2h5JyxcbiAgICAgICAgICAgICAgICBpY29uOiAnR2F0ZXdheU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDQsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBpc1Jvb3Q6IHsgZXE6IGZhbHNlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgY29ycmVsYXRpb25JZDogeyBlcTogJzpjb3JyZWxhdGlvbklkJyB9LFxuICAgICAgICAgICAgICAgICAgICAgIGlzUm9vdDogeyBlcTogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdUaGUgcm9vdCBzcGFuIHRoYXQgc3RhcnRlZCB0aGlzIHRyYWNlIGhpZXJhcmNoeScsXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHRyYWNlTG9nczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQWxsIGluIFRoaXMgVHJhY2UnLFxuICAgICAgICAgICAgICAgIGljb246ICdTaGFyZUFsdE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDUsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBjb3JyZWxhdGlvbklkOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBjb3JyZWxhdGlvbklkOiB7IGVxOiAnOmNvcnJlbGF0aW9uSWQnIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQWxsIGV2ZW50cyBpbiB0aGlzIExhbWJkYSBpbnZvY2F0aW9uJyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY2F1c2VkQnlUcmFjZToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ2F1c2luZyBSZXF1ZXN0IFRyYWNlJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnTGlua091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDgsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBjYXVzZWRCeTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgY29ycmVsYXRpb25JZDogeyBlcTogJzpjYXVzZWRCeScgfSB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdWaWV3IHRoZSBvcmlnaW5hbCByZXF1ZXN0IHRyYWNlIHRoYXQgY2F1c2VkIHRoaXMgZXZlbnQnLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBjYXVzZWRFdmVudHM6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0V2ZW50cyBDYXVzZWQgQnkgVGhpcycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0FwaU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDksXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBjYXVzZWRCeTogeyBlcTogJzpjb3JyZWxhdGlvbklkJyB9IH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0V2ZW50cyBpbiBvdGhlciBpbnZvY2F0aW9ucyBjYXVzZWQgYnkgdGhpcyByZXF1ZXN0JyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgcmVsYXRlZFRyYWNlczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnUmVsYXRlZCBUcmFjZXMnLFxuICAgICAgICAgICAgICAgIGljb246ICdDbHVzdGVyT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMTAsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyByZWxhdGVkVHJhY2VzOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ3JlbGF0ZWRUcmFjZXMnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gNS4gUkVMQVRFRCBMT0dTIChFbnRpdHkgJiBTb3VyY2UgQW5hbHl0aWNzKSA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3JlbGF0ZWQtYW5hbHl0aWNzJyxcbiAgICAgICAgICAgIGxhYmVsOiAnUmVsYXRlZCBMb2dzJyxcbiAgICAgICAgICAgIGljb246ICdGdW5kT3V0bGluZWQnLFxuICAgICAgICAgICAgc29ydE9yZGVyOiA1LFxuICAgICAgICAgICAgcmVuZGVyTW9kZTogJ3RhYnMnLFxuICAgICAgICAgICAgZGVmYXVsdENvbGxhcHNlZDogdHJ1ZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiBmYWxzZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiBmYWxzZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIGJ5RW50aXR5OiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFbnRpdHkgTG9ncycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0RhdGFiYXNlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGVudGl0eU5hbWU6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJzplbnRpdHlOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICBlbnRpdHlJZDogJzplbnRpdHlJZCcsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBieUVudGl0eVR5cGU6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0VudGl0eSBUeXBlIExvZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdBcHBzdG9yZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlbnRpdHlOYW1lOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBlbnRpdHlOYW1lOiAnOmVudGl0eU5hbWUnIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBieVNvdXJjZToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnU291cmNlIExvZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdDb2RlU2FuZGJveE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBzb3VyY2U6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IHNvdXJjZTogJzpzb3VyY2UnIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vID09PSA2LiBBRERJVElPTkFMIERBVEEgKFRhZ3MsIE1ldGFkYXRhLCBDb250ZXh0KSA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2FkZGl0aW9uYWwtZGF0YScsXG4gICAgICAgICAgICBsYWJlbDogJ0FkZGl0aW9uYWwgRGF0YScsXG4gICAgICAgICAgICBpY29uOiAnRm9sZGVyT3Blbk91dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogNixcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IHRydWUsXG4gICAgICAgICAgICBsYXp5TG9hZDogZmFsc2UsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogdHJ1ZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ01ldHJpY3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdEYXNoYm9hcmRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgbWV0cmljczogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICdtZXRyaWNzJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1RhZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdUYWdPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgdGFnczogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICd0YWdzJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdNZXRhZGF0YScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0luZm9DaXJjbGVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAzLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgbWV0YWRhdGE6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnbWV0YWRhdGEnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY29udGV4dDoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ29udGV4dCcsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0Vudmlyb25tZW50T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNCxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGNvbnRleHQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnY29udGV4dCcgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vID09PSA3LiBBQ1RPUiAmIFNZU1RFTSBJTkZPID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnYWN0b3Itc3lzdGVtJyxcbiAgICAgICAgICAgIGxhYmVsOiAnQWN0b3IgJiBTeXN0ZW0nLFxuICAgICAgICAgICAgaWNvbjogJ1NldHRpbmdPdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDcsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiB0cnVlLFxuICAgICAgICAgICAgbGF6eUxvYWQ6IGZhbHNlLFxuICAgICAgICAgICAga2VlcE1vdW50ZWQ6IHRydWUsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBhY3Rvcjoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQWN0b3InLFxuICAgICAgICAgICAgICAgIGljb246ICdVc2VyT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGFjdG9yOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2FjdG9yJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHN5c3RlbUluZm86IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1N5c3RlbSBJbmZvJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQ2xvY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICd0dGwnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgYXR0cmlidXRlczoge1xuICAgIC8vID09PSBJREVOVElUWSA9PT1cbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICAvLyAxMjgtYml0IGZhbGxiYWNrIGZvciBtYW51YWwvYWRtaW4tY3JlYXRlZCByZWNvcmRzIChmcmFtZXdvcmsgZ2VuZXJhbGx5IHN1cHBsaWVzIG9ic2VydmFiaWxpdHlMb2dJZCBleHBsaWNpdGx5KS5cbiAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbUJ5dGVzKDE2KS50b1N0cmluZygnaGV4JyksXG4gICAgICBsYWJlbDogJ0xvZyBJRCcsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdQYXJlbnQgTG9nIElEJyxcbiAgICAgIGhlbHBUZXh0OiAnUmVmZXJlbmNlIHRvIHBhcmVudCBzcGFuIGZvciBoaWVyYXJjaGljYWwgdHJhY2luZycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBTZWxmLXJlZmVyZW50aWFsIHJlbGF0aW9uIHRvIHBhcmVudCBvYnNlcnZhYmlsaXR5IGxvZ1xuICAgICAgcmVsYXRpb246IHtcbiAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICB0eXBlOiAnbWFueS10by1vbmUnLFxuICAgICAgICBpZGVudGlmaWVyczogeyBzb3VyY2U6ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnLCB0YXJnZXQ6ICdvYnNlcnZhYmlsaXR5TG9nSWQnIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gQ29tcHV0ZWQgZmllbGQ6IHRydWUgaWYgdGhpcyBpcyBhIHJvb3Qgc3BhbiAobm8gcGFyZW50KVxuICAgIC8vIFVzZWQgZm9yIGVmZmljaWVudCBHU0kgcXVlcmllcyBpbnN0ZWFkIG9mIG5vdEV4aXN0cyBmaWx0ZXJcbiAgICBpc1Jvb3Q6IHtcbiAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgIGxhYmVsOiAnSXMgUm9vdCcsXG4gICAgICBoZWxwVGV4dDogJ1RydWUgaWYgdGhpcyBpcyBhIHJvb3Qgc3BhbiAobm8gcGFyZW50KScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICB3YXRjaDogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdLFxuICAgICAgLy8gU2V0IHRvIHRydWUgd2hlbiBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgaXMgbnVsbC91bmRlZmluZWRcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkPzogc3RyaW5nIH0pID0+XG4gICAgICAgICFkYXRhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IHRydWUsICAvLyBEZWZhdWx0IHRvIHRydWUgaWYgbm8gcGFyZW50IHNwZWNpZmllZFxuICAgIH0sXG4gICAgLy8gTk9URTogY29ycmVsYXRpb25JZCBpcyBSRVFVSVJFRCBhbmQgaGFzIE5PIGRlZmF1bHQuXG4gICAgLy8gSWYgeW91J3JlIGdldHRpbmcgdmFsaWRhdGlvbiBlcnJvcnMsIGVuc3VyZSBjb250ZXh0IGlzIGVzdGFibGlzaGVkIChhdXRvIGluIGNvbnRyb2xsZXJzKS5cbiAgICAvLyBIYXZpbmcgYSBkZWZhdWx0IGhlcmUgd291bGQgaGlkZSBidWdzIHdoZXJlIGNvbnRleHQgd2Fzbid0IHByb3Blcmx5IGVzdGFibGlzaGVkLlxuICAgIGNvcnJlbGF0aW9uSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBsYWJlbDogJ0NvcnJlbGF0aW9uIElEJyxcbiAgICAgIGhlbHBUZXh0OiAnVW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBlbnRpcmUgcmVxdWVzdC90cmFjZScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBOTyBERUZBVUxUIC0gbXVzdCBiZSBwcm9wYWdhdGVkIGZyb20gY29udGV4dFxuICAgICAgLy8gTGluayB0byBmaWx0ZXJlZCBsaXN0IHNob3dpbmcgYWxsIGxvZ3MgaW4gdGhlIHNhbWUgdHJhY2VcbiAgICAgIGlzTGluazogdHJ1ZSxcbiAgICAgIGxpbmtDb25maWc6IHtcbiAgICAgICAgcm91dGVQYXR0ZXJuOiAnL2xpc3Qtb2JzZXJ2YWJpbGl0eWxvZz9jb3JyZWxhdGlvbklkLmVxPTpjb3JyZWxhdGlvbklkJyxcbiAgICAgICAgZGlzcGxheVRleHQ6ICdWaWV3IENvcnJlbGF0ZWQgTG9ncycsXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gQ3Jvc3MtaW52b2NhdGlvbiB0cmFjaW5nOiBDb3JyZWxhdGlvbiBJRCB0aGF0IGNhdXNlZCB0aGlzIGV2ZW50XG4gICAgLy8gRXhhbXBsZTogRHluYW1vREIgc3RyZWFtIGF1ZGl0IGNhdXNlZCBieSBvcmlnaW5hbCBBUEkgcmVxdWVzdFxuICAgIGNhdXNlZEJ5OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIGxhYmVsOiAnQ2F1c2VkIEJ5JyxcbiAgICAgIGhlbHBUZXh0OiAnQ29ycmVsYXRpb24gSUQgdGhhdCBjYXVzZWQgdGhpcyBldmVudCAoY3Jvc3MtaW52b2NhdGlvbiB0cmFjaW5nKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc0xpbms6IHRydWUsXG4gICAgICBsaW5rQ29uZmlnOiB7XG4gICAgICAgIHJvdXRlUGF0dGVybjogJy9saXN0LW9ic2VydmFiaWxpdHlsb2c/Y29ycmVsYXRpb25JZC5lcT06Y2F1c2VkQnknLFxuICAgICAgICBkaXNwbGF5VGV4dDogJ1ZpZXcgQ2F1c2luZyBSZXF1ZXN0JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBBbGwgcmVsYXRlZCB0cmFjZSBJRHMgZm9yIGNvbXBsZXggd29ya2Zsb3dzXG4gICAgcmVsYXRlZFRyYWNlczoge1xuICAgICAgdHlwZTogJ2xpc3QnLFxuICAgICAgaXRlbXM6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIGxhYmVsOiAnUmVsYXRlZCBUcmFjZXMnLFxuICAgICAgaGVscFRleHQ6ICdBbGwgcmVsYXRlZCBjb3JyZWxhdGlvbiBJRHMgZm9yIGNvbXBsZXggd29ya2Zsb3dzIHNwYW5uaW5nIG11bHRpcGxlIGludm9jYXRpb25zJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogZmFsc2UsIC8vIExpc3QgZmllbGQsIG5vdCBmaWx0ZXJhYmxlXG4gICAgfSxcblxuICAgIC8vID09PSBDTEFTU0lGSUNBVElPTiA9PT1cbiAgICB0eXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgbGFiZWw6ICdUeXBlJyxcbiAgICAgIGhlbHBUZXh0OiAnRXZlbnQgdHlwZSAoc3BhbiwgYXVkaXQuZW50aXR5LCBsb2csIG1ldHJpYywgZXRjLiknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHN1YlR5cGU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdTdWItVHlwZScsXG4gICAgICBoZWxwVGV4dDogJ0FkZGl0aW9uYWwgdHlwZSBjbGFzc2lmaWNhdGlvbicsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICAvLyBOT1RFOiBsZXZlbCBpcyBSRVFVSVJFRCBhbmQgaGFzIE5PIGRlZmF1bHQuXG4gICAgLy8gVGhlIG9ic2VydmVyIE1VU1Qgc3BlY2lmeSB0aGUgbGV2ZWwgZXhwbGljaXRseS5cbiAgICBsZXZlbDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGxhYmVsOiAnTGV2ZWwnLFxuICAgICAgaGVscFRleHQ6ICdTZXZlcml0eSBsZXZlbDogZXJyb3IsIHdhcm4sIGluZm8sIGRlYnVnJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgICAvLyBOTyBERUZBVUxUIC0gbXVzdCBiZSBzcGVjaWZpZWQgYnkgb2JzZXJ2ZXJcbiAgICB9LFxuXG4gICAgLy8gPT09IEVOVElUWSBDT05URVhUID09PVxuICAgIGVudGl0eU5hbWU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdFbnRpdHkgTmFtZScsXG4gICAgICBoZWxwVGV4dDogJ05hbWUgb2YgdGhlIGVudGl0eSB0aGlzIGV2ZW50IHJlbGF0ZXMgdG8nLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIGVudGl0eUlkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnRW50aXR5IElEJyxcbiAgICAgIGhlbHBUZXh0OiAnSUQgb2YgdGhlIHNwZWNpZmljIGVudGl0eSBpbnN0YW5jZScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBEZWZhdWx0IHRvICdfJyB3aGVuIGVudGl0eU5hbWUgaXMgc2V0IGJ1dCBlbnRpdHlJZCBpcyBub3QgKHJlcXVpcmVkIGZvciBieUVudGl0eSBjb21wb3NpdGUgaW5kZXgpXG4gICAgICB3YXRjaDogWyAnZW50aXR5TmFtZScgXSxcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgZW50aXR5TmFtZT86IHN0cmluZzsgZW50aXR5SWQ/OiBzdHJpbmcgfSkgPT5cbiAgICAgICAgZGF0YS5lbnRpdHlJZCB8fCAoZGF0YS5lbnRpdHlOYW1lID8gJ18nIDogdW5kZWZpbmVkKSxcbiAgICAgIC8vIER5bmFtaWMgbGluayB0byB0aGUgcmVsYXRlZCBlbnRpdHkgYmFzZWQgb24gZW50aXR5TmFtZVxuICAgICAgbGlua0NvbmZpZzoge1xuICAgICAgICByb3V0ZVBhdHRlcm46ICcvdmlldy06ZW50aXR5TmFtZS86ZW50aXR5SWQnLFxuICAgICAgICBkaXNwbGF5VGV4dDogJ1ZpZXcge2VudGl0eU5hbWV9JyxcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIC8vID09PSBPUEVSQVRJT04gPT09XG4gICAgb3BlcmF0aW9uOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnT3BlcmF0aW9uJyxcbiAgICAgIGhlbHBUZXh0OiAnVGhlIG9wZXJhdGlvbiBiZWluZyBwZXJmb3JtZWQgKGUuZy4sIGNyZWF0ZSwgdXBkYXRlLCBxdWVyeSknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHN0YXR1czoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ1N0YXR1cycsXG4gICAgICBoZWxwVGV4dDogJ09wZXJhdGlvbiBzdGF0dXMgKGUuZy4sIHN0YXJ0ZWQsIGNvbXBsZXRlZCwgZmFpbGVkKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICBzdWNjZXNzOiB7XG4gICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICBsYWJlbDogJ1N1Y2Nlc3MnLFxuICAgICAgaGVscFRleHQ6ICdXaGV0aGVyIHRoZSBvcGVyYXRpb24gY29tcGxldGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBmaWVsZFR5cGU6ICdib29sZWFuJyxcbiAgICAgIGJvb2xlYW5MYWJlbHM6IHsgdHJ1ZTogJ1N1Y2Nlc3MnLCBmYWxzZTogJ0ZhaWxlZCcgfSxcbiAgICB9LFxuXG4gICAgLy8gPT09IFRJTUlORyA9PT1cbiAgICB0aW1lc3RhbXBNczoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KCksXG4gICAgICBsYWJlbDogJ1RpbWVzdGFtcCcsXG4gICAgICBoZWxwVGV4dDogJ0V2ZW50IHRpbWVzdGFtcCBpbiBtaWxsaXNlY29uZHMgc2luY2UgZXBvY2gnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICAgIGZpZWxkVHlwZTogJ2RhdGV0aW1lJyxcbiAgICB9LFxuICAgIGR1cmF0aW9uTXM6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgbGFiZWw6ICdEdXJhdGlvbiAobXMpJyxcbiAgICAgIGhlbHBUZXh0OiAnT3BlcmF0aW9uIGR1cmF0aW9uIGluIG1pbGxpc2Vjb25kcycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc1NvcnRhYmxlOiB0cnVlLFxuICAgICAgZmllbGRUeXBlOiAnZHVyYXRpb24nLFxuICAgICAgZHVyYXRpb25Vbml0OiAnbXMnLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gU09VUkNFICYgVEFHUyA9PT1cbiAgICBzb3VyY2U6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdTb3VyY2UnLFxuICAgICAgaGVscFRleHQ6ICdTb3VyY2Ugb2YgdGhlIGV2ZW50IChlLmcuLCBzZXJ2aWNlIG5hbWUsIGZ1bmN0aW9uIG5hbWUpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIC8vIE5PVEU6IHRhZ3MsIG1ldHJpY3MsIGF0dHJpYnV0ZXMsIGRhdGEsIG1ldGFkYXRhLCBhY3RvciwgY29udGV4dCBhbGwgdXNlIHByb3BlcnRpZXM6e31cbiAgICAvLyBUaGlzIGlzIEJZIERFU0lHTiAtIHRoaXMgaXMgYSBVTklWRVJTQUwgc3RvcmUgZm9yIEFMTCBldmVudCB0eXBlcyAoc3BhbiwgYXVkaXQsXG4gICAgLy8gbWV0cmljLCB3b3JrZmxvdywgZGVjaXNpb24sIGFjY2VzcywgbG9nKS4gRWFjaCBoYXMgY29tcGxldGVseSBkaWZmZXJlbnQgcGF5bG9hZHMuXG4gICAgLy8gRWxlY3Ryb0RCIHByb3BlcnRpZXM6e30gPSBhY2NlcHQgYW55IG1hcCBzdHJ1Y3R1cmUgYXQgcnVudGltZS5cbiAgICB0YWdzOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnVGFncycsXG4gICAgICBoZWxwVGV4dDogJ0tleS12YWx1ZSB0YWdzIGZvciBjYXRlZ29yaXphdGlvbicsXG4gICAgfSxcblxuICAgIC8vID09PSBQQVlMT0FEUyAoc2NoZW1hbGVzcyBieSBkZXNpZ24gLSBkaWZmZXJlbnQgZXZlbnQgdHlwZXMgaGF2ZSBkaWZmZXJlbnQgc3RydWN0dXJlcykgPT09XG4gICAgbWV0cmljczoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ01ldHJpY3MnLFxuICAgICAgaGVscFRleHQ6ICdOdW1lcmljYWwgbWV0cmljcyBhbmQgbWVhc3VyZW1lbnRzJyxcbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdBdHRyaWJ1dGVzJyxcbiAgICAgIGhlbHBUZXh0OiAnQWRkaXRpb25hbCBzdHJ1Y3R1cmVkIGF0dHJpYnV0ZXMnLFxuICAgIH0sXG4gICAgZGF0YToge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0RhdGEnLFxuICAgICAgaGVscFRleHQ6ICdFdmVudC1zcGVjaWZpYyBkYXRhIHBheWxvYWQnLFxuICAgICAgY29tcHJlc3NlZDogeyB0aHJlc2hvbGQ6IDUwICogMTAyNCB9LCAvLyBGcmFtZXdvcmsgYXV0by1jb21wcmVzc2VzIGlmID4gNTBLQlxuICAgIH0sXG4gICAgbWV0YWRhdGE6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdNZXRhZGF0YScsXG4gICAgICBoZWxwVGV4dDogJ0FkZGl0aW9uYWwgbWV0YWRhdGEgYWJvdXQgdGhlIGV2ZW50JyxcbiAgICAgIGNvbXByZXNzZWQ6IHRydWUsIC8vIEZyYW1ld29yayBhdXRvLWNvbXByZXNzZXMgaWYgPiAxMEtCXG4gICAgfSxcbiAgICBlcnJvcjoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0Vycm9yJyxcbiAgICAgIGhlbHBUZXh0OiAnRXJyb3IgZGV0YWlscyBpZiB0aGUgb3BlcmF0aW9uIGZhaWxlZCcsXG4gICAgICAvLyBTdHJ1Y3R1cmU6IHsgdHlwZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmcsIHN0YWNrPzogc3RyaW5nLCBjb2RlPzogc3RyaW5nIH1cbiAgICB9LFxuICAgIC8vID09PSBBQ1RPUiAoc3RvcmVkIGFzLWlzIGZyb20gZXhpc3RpbmcgQWN0b3IgdHlwZSkgPT09XG4gICAgYWN0b3I6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdBY3RvcicsXG4gICAgICBoZWxwVGV4dDogJ0luZm9ybWF0aW9uIGFib3V0IHdobyB0cmlnZ2VyZWQgdGhpcyBldmVudCcsXG4gICAgfSxcblxuICAgIC8vID09PSBDT05URVhUID09PVxuICAgIGNvbnRleHQ6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdDb250ZXh0JyxcbiAgICAgIGhlbHBUZXh0OiAnRXhlY3V0aW9uIGNvbnRleHQgYW5kIGVudmlyb25tZW50IGluZm9ybWF0aW9uJyxcbiAgICB9LFxuXG4gICAgLy8gPT09IFRUTCA9PT1cbiAgICAvLyBUVEwgZm9yIGF1dG8tY2xlYW51cCAoYWx3YXlzIHByb3ZpZGVkIGJ5IGJhY2tlbmQpXG4gICAgdHRsOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDkwICogMjQgKiA2MCAqIDYwKSwgLy8gOTAgZGF5c1xuICAgICAgbGFiZWw6ICdUVEwnLFxuICAgICAgaGVscFRleHQ6ICdUaW1lLXRvLWxpdmUgZm9yIGF1dG9tYXRpYyBjbGVhbnVwIChVbml4IHRpbWVzdGFtcCknLFxuICAgICAgZmllbGRUeXBlOiAndHRsJyxcbiAgICAgIHR0bFVuaXQ6ICdzZWNvbmRzJyxcbiAgICAgIHR0bEZvcm1hdDogJ2F1dG8nLFxuICAgICAgaXNWaXNpYmxlOiB0cnVlLFxuICAgICAgaXNFZGl0YWJsZTogZmFsc2UsXG4gICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgIH0sXG4gIH0sXG4gIGluZGV4ZXM6IHtcbiAgICAvLyA9PT0gSU5ERVggREVTSUdOIE5PVEVTID09PVxuICAgIC8vIDEuIFByaW1hcnkgaW5kZXggaGFzIG5vIHNvcnQga2V5IC0gb25seSBmb3Igc2luZ2xlLWl0ZW0gbG9va3VwcyBieSBJRFxuICAgIC8vIDIuIEdTSTcgKGFsbFJlY29yZHMpIHByb3ZpZGVzIHNvcnRlZCBsaXN0aW5nIGZvciB1bmZpbHRlcmVkIHF1ZXJpZXNcbiAgICAvLyAgICAtIFVzZXMgY29uc3RhbnQgUEsgdGVtcGxhdGUgdG8gZ3JvdXAgYWxsIHJlY29yZHNcbiAgICAvLyAgICAtIFNvcnRlZCBieSB0aW1lc3RhbXBNcyBmb3IgZWZmaWNpZW50IGNocm9ub2xvZ2ljYWwgbGlzdGluZ1xuICAgIC8vICAgIC0gVHJhZGUtb2ZmOiBIb3QgcGFydGl0aW9uLCBidXQgYWNjZXB0YWJsZSBmb3Igb2JzZXJ2YWJpbGl0eSBsb2dzIHdpdGggVFRMXG4gICAgLy8gMy4gQWxsIG90aGVyIEdTSXMgYXJlIGZvciBmaWx0ZXJlZCBxdWVyaWVzIChieSB0cmFjZSwgcGFyZW50LCB0eXBlLCBsZXZlbCwgZXRjLilcblxuICAgIC8vIFByaW1hcnkgLSBieSBvYnNlcnZhYmlsaXR5TG9nSWRcbiAgICBwcmltYXJ5OiB7XG4gICAgICBwazogeyBmaWVsZDogJ3BrJywgY29tcG9zaXRlOiBbICdvYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnc2snLCBjb21wb3NpdGU6IFtdIH0sXG4gICAgfSxcbiAgICAvLyBHU0kxIC0gYnkgdHJhY2UgLSBnZXQgYWxsIGV2ZW50cyBpbiBhIHJlcXVlc3QvdHJhY2VcbiAgICBieVRyYWNlOiB7XG4gICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2kxcGsnLCBjb21wb3NpdGU6IFsgJ2NvcnJlbGF0aW9uSWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpMXNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJMiAtIGJ5IHBhcmVudCAtIGdldCBjaGlsZHJlbiwgcmVjb25zdHJ1Y3Qgc3BhbiBoaWVyYXJjaHlcbiAgICBieVBhcmVudDoge1xuICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpMnBrJywgY29tcG9zaXRlOiBbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpMnNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJMyAtIGJ5IHR5cGUgLSBmaWx0ZXIgYnkgZXZlbnQgdHlwZSAoc3Bhbi4qLCBhdWRpdC4qLCBsb2csIG1ldHJpYylcbiAgICBieVR5cGU6IHtcbiAgICAgIGluZGV4OiAnZ3NpMycsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTNwaycsIGNvbXBvc2l0ZTogWyAndHlwZScgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kzc2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k0IC0gYnkgbGV2ZWwgLSBmaW5kIGVycm9ycy93YXJuaW5ncyBxdWlja2x5XG4gICAgYnlMZXZlbDoge1xuICAgICAgaW5kZXg6ICdnc2k0JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNHBrJywgY29tcG9zaXRlOiBbICdsZXZlbCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k0c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k1IC0gYnkgZW50aXR5IHR5cGUgLSBcImFsbCBPcmRlciBldmVudHNcIiwgXCJhbGwgVXNlciBldmVudHNcIlxuICAgIGJ5RW50aXR5VHlwZToge1xuICAgICAgaW5kZXg6ICdnc2k1JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNXBrJywgY29tcG9zaXRlOiBbICdlbnRpdHlOYW1lJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTVzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTYgLSBieSBlbnRpdHkgaW5zdGFuY2UgLSBcImFsbCBldmVudHMgZm9yIE9yZGVyOjEyM1wiXG4gICAgYnlFbnRpdHk6IHtcbiAgICAgIGluZGV4OiAnZ3NpNicsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTZwaycsIGNvbXBvc2l0ZTogWyAnZW50aXR5TmFtZScsICdlbnRpdHlJZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k2c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k3IC0gYWxsIHJlY29yZHMgYnkgdGltZXN0YW1wIC0gZm9yIGVmZmljaWVudCBzb3J0ZWQgbGlzdGluZyBvZiBhbGwgZXZlbnRzXG4gICAgLy8gVXNlcyBjb25zdGFudCBwYXJ0aXRpb24ga2V5IHRvIGdyb3VwIGFsbCByZWNvcmRzIHRvZ2V0aGVyXG4gICAgYWxsUmVjb3Jkczoge1xuICAgICAgaW5kZXg6ICdnc2k3JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpN3BrJywgY29tcG9zaXRlOiBbXSwgdGVtcGxhdGU6ICdBTExfRVZFTlRTJyB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k3c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k4IC0gYnkgY2F1c2VkQnkgLSBmaW5kIGFsbCBldmVudHMgY2F1c2VkIGJ5IGEgc3BlY2lmaWMgcmVxdWVzdCAoY3Jvc3MtaW52b2NhdGlvbiB0cmFjaW5nKVxuICAgIGJ5Q2F1c2VkQnk6IHtcbiAgICAgIGluZGV4OiAnZ3NpOCcsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaThwaycsIGNvbXBvc2l0ZTogWyAnY2F1c2VkQnknIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpOHNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gRm9yIHNvdXJjZS9hY3Rvci90ZW5hbnQgcXVlcmllcyAtIHVzZSBzZWFyY2ggZW5naW5lIHN5bmNcbiAgfSxcbn0gYXMgY29uc3QpO1xuXG5leHBvcnQgdHlwZSBPYnNlcnZhYmlsaXR5TG9nU2NoZW1hID0gdHlwZW9mIE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWE7Il19