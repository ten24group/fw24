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
                        tooltip: 'View details',
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
                        // Only show for root logs (which have children)
                        visibility: { record: { isRoot: { eq: true } } },
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
                    // === BY HIERARCHY (Default: Root spans only to reduce clutter) ===
                    {
                        id: 'hierarchy-group',
                        label: 'View',
                        segments: [
                            {
                                id: 'root-only', label: 'Root Spans', icon: 'ApartmentOutlined',
                                // Use isRoot for efficient GSI query instead of notExists filter
                                filters: { isRoot: { eq: true } },
                                default: true
                            },
                            {
                                id: 'child-only', label: 'Child Spans', icon: 'BranchesOutlined',
                                filters: { isRoot: { eq: false } },
                            },
                            {
                                id: 'all-spans', label: 'All Events', icon: 'UnorderedListOutlined',
                                filters: {}
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
                            'isRoot',
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
                        keepMounted: true,
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
                                        identifierMapping: { source: 'parentObservabilityLogId', target: 'observabilityLogId' },
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
                                label: 'Full Trace',
                                icon: 'ShareAltOutlined',
                                sortOrder: 3,
                                pageType: 'list',
                                entityConfigRef: {
                                    entityName: 'observabilityLog',
                                    pageType: 'list',
                                    overrideConfig: {
                                        defaultFilters: { correlationId: ':correlationId' },
                                        hideSegments: ['hierarchy-group'],
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
                        keepMounted: true,
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
            isLink: true,
            linkConfig: {
                routePattern: '/view-:entityName/:entityId',
                displayText: 'View Entity',
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
        // GSI7 - by isRoot - efficiently find root spans without full scan
        byIsRoot: {
            index: 'gsi7',
            pk: { field: 'gsi7pk', composite: ['isRoot'] },
            sk: { field: 'gsi7sk', composite: ['timestampMs'] },
        },
        // For source/actor/tenant queries - use search engine sync
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1sb2ctZW50aXR5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvc3RvcmFnZS9vYnNlcnZhYmlsaXR5LWxvZy1lbnRpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCxtQ0FBb0M7QUFDcEMsZ0VBQWdFO0FBQ2hFLDBEQUF1RjtBQUV2Rjs7Ozs7Ozs7Ozs7R0FXRztBQUNVLFFBQUEsNEJBQTRCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUM3RCxLQUFLLEVBQUU7UUFDTCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxrQkFBa0I7UUFDMUIsZ0JBQWdCLEVBQUUsbUJBQW1CO1FBQ3JDLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6Qyx3Q0FBd0M7UUFDeEMsb0JBQW9CLEVBQUUsSUFBSTtRQUMxQixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixNQUFNLEVBQUU7WUFDTixPQUFPLEVBQUUsS0FBSztZQUNkLFdBQVcsRUFBRTtnQkFDWCxVQUFVLEVBQUUsb0JBQW9CO2FBQ2pDO1NBQ0Y7UUFDRCxrQ0FBa0M7UUFDbEMsY0FBYyxFQUFFO1lBQ2QsV0FBVyxFQUFFO2dCQUNYLHFDQUFxQztnQkFDckMsdUVBQXVFO2dCQUN2RSxXQUFXLEVBQUUsRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUU7Z0JBQ3BELHlEQUF5RDtnQkFDekQsVUFBVSxFQUFFO29CQUNWO3dCQUNFLEVBQUUsRUFBRSxZQUFZO3dCQUNoQixLQUFLLEVBQUUsWUFBWTt3QkFDbkIsSUFBSSxFQUFFLG1CQUFtQjt3QkFDekIsT0FBTyxFQUFFLGNBQWM7d0JBQ3ZCLGlFQUFpRTt3QkFDakUsR0FBRyxFQUFFLDRDQUE0Qzt3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LEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLFFBQVEsQ0FBRSxFQUFFO1lBQ2hELEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7UUFDRCwyREFBMkQ7S0FDNUQ7Q0FDTyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHkgTG9nIEVudGl0eSBTY2hlbWFcbiAqIFxuICogRHluYW1vREIgdGFibGUgc2NoZW1hIGZvciBzdG9yaW5nIGFsbCBvYnNlcnZhYmlsaXR5IGV2ZW50cy5cbiAqIFVzZWQgYnkgT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2Ugd2hpY2ggaXMgc2VsZi1jb250YWluZWQgKG5vIERJIGRlcGVuZGVuY3kpLlxuICovXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuLy8gSW1wb3J0IGRpcmVjdGx5IGZyb20gYmFzZS1lbnRpdHkgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeVxuaW1wb3J0IHsgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIGNyZWF0ZUVudGl0eVNjaGVtYSB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLWVudGl0eSc7XG5cbi8qKlxuICogT2JzZXJ2YWJpbGl0eSBMb2cgRW50aXR5IFNjaGVtYVxuICogXG4gKiBVbml2ZXJzYWwgc2NoZW1hIGZvciBhbGwgb2JzZXJ2YWJpbGl0eSBldmVudCB0eXBlczpcbiAqIC0gc3Bhbi5zdGFydCwgc3Bhbi5lbmQsIHNwYW4uZXZlbnQgKGRpc3RyaWJ1dGVkIHRyYWNpbmcpXG4gKiAtIGF1ZGl0LmVudGl0eSwgYXVkaXQuYWN0aW9uLCBhdWRpdC5jb21wbGlhbmNlIChhdWRpdGluZylcbiAqIC0gbWV0cmljIChtZXRyaWNzL2NvdW50ZXJzKVxuICogLSB3b3JrZmxvdy4qICh3b3JrZmxvdyB0cmFja2luZylcbiAqIC0gZGVjaXNpb24uKiAoZGVjaXNpb24gbG9nZ2luZylcbiAqIC0gYWNjZXNzIChBUEkgYWNjZXNzIGxvZ3MpXG4gKiAtIGxvZyAoc3RydWN0dXJlZCBsb2dnaW5nKVxuICovXG5leHBvcnQgY29uc3QgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gIG1vZGVsOiB7XG4gICAgdmVyc2lvbjogJzEnLFxuICAgIGVudGl0eTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgIGVudGl0eU5hbWVQbHVyYWw6ICdvYnNlcnZhYmlsaXR5TG9ncycsXG4gICAgc2VydmljZTogJ29ic2VydmFiaWxpdHknLFxuICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgIC8vIFN5c3RlbSBlbnRpdHkgLSByZWFkLW9ubHkgaW4gYWRtaW4gVUlcbiAgICBleGNsdWRlRnJvbUFkbWluTWVudTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZTogdHJ1ZSxcbiAgICBzZWFyY2g6IHtcbiAgICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgICAgaW5kZXhDb25maWc6IHtcbiAgICAgICAgcHJpbWFyeUtleTogJ29ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICB9XG4gICAgfSxcbiAgICAvLyA9PT0gTElTVCBQQUdFIENPTkZJR1VSQVRJT04gPT09XG4gICAgbGlzdFBhZ2VDb25maWc6IHtcbiAgICAgIHRhYmxlQ29uZmlnOiB7XG4gICAgICAgIC8vIERlZmF1bHQgc29ydDogbGF0ZXN0IHJlY29yZHMgZmlyc3RcbiAgICAgICAgLy8gU2VhcmNoIG1vZGUgdXNlcyBmdWxsIGNvbmZpZywgREIgbW9kZSBleHRyYWN0cyBqdXN0IHRoZSAnZGVzYycgb3JkZXJcbiAgICAgICAgZGVmYXVsdFNvcnQ6IHsgZmllbGQ6ICd0aW1lc3RhbXBNcycsIG9yZGVyOiAnZGVzYycgfSxcbiAgICAgICAgLy8gUm93IGFjdGlvbnMgLSBxdWljayBhY2Nlc3Mgd2l0aG91dCBsb3NpbmcgbGlzdCBjb250ZXh0XG4gICAgICAgIHJvd0FjdGlvbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3F1aWNrLXZpZXcnLFxuICAgICAgICAgICAgbGFiZWw6ICdRdWljayBWaWV3JyxcbiAgICAgICAgICAgIGljb246ICdFeHBhbmRBbHRPdXRsaW5lZCcsXG4gICAgICAgICAgICB0b29sdGlwOiAnVmlldyBkZXRhaWxzJyxcbiAgICAgICAgICAgIC8vIE9wZW4gdmlldyBwYWdlIGluIG1vZGFsIC0gVVJMIHdpbGwgYmUgcmVzb2x2ZWQgdG8gZmV0Y2ggY29uZmlnXG4gICAgICAgICAgICB1cmw6ICcvdmlldy1vYnNlcnZhYmlsaXR5bG9nLzpvYnNlcnZhYmlsaXR5TG9nSWQnLFxuICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICBtb2RhbFRpdGxlOiAnTG9nIERldGFpbHMnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd2aWV3LXRyYWNlJyxcbiAgICAgICAgICAgIGxhYmVsOiAnVmlldyBUcmFjZScsXG4gICAgICAgICAgICBpY29uOiAnQXBhcnRtZW50T3V0bGluZWQnLFxuICAgICAgICAgICAgdG9vbHRpcDogJ1ZpZXcgY29ycmVsYXRlZCBsb2dzJyxcbiAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgbW9kYWxUaXRsZTogJ1RyYWNlIExvZ3MnLFxuICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgY29ycmVsYXRpb25JZDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICBtb2RhbENvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgY29ycmVsYXRpb25JZDogJzpjb3JyZWxhdGlvbklkJyB9LFxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3ZpZXctY2hpbGRyZW4nLFxuICAgICAgICAgICAgbGFiZWw6ICdWaWV3IENoaWxkcmVuJyxcbiAgICAgICAgICAgIGljb246ICdCcmFuY2hlc091dGxpbmVkJyxcbiAgICAgICAgICAgIHRvb2x0aXA6ICdWaWV3IGNoaWxkIGxvZ3MnLFxuICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICBtb2RhbFRpdGxlOiAnQ2hpbGQgTG9ncycsXG4gICAgICAgICAgICAvLyBPbmx5IHNob3cgZm9yIHJvb3QgbG9ncyAod2hpY2ggaGF2ZSBjaGlsZHJlbilcbiAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGlzUm9vdDogeyBlcTogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgIC8vIFVzZSBtb2RhbENvbmZpZ1JlZiB0byBoaWRlIGhpZXJhcmNoeSBzZWdtZW50cyAoY29uZmxpY3RzIHdpdGggcGFyZW50IGZpbHRlcilcbiAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICc6b2JzZXJ2YWJpbGl0eUxvZ0lkJyB9LFxuICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICAvLyBPbmx5IHNob3cgZXNzZW50aWFsIGNvbHVtbnMgZm9yIHF1aWNrIHNjYW5uaW5nXG4gICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICB7IGZpZWxkOiAndHlwZScgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnbGV2ZWwnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2VudGl0eU5hbWUnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ3NvdXJjZScgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnb3BlcmF0aW9uJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdzdGF0dXMnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ3RpbWVzdGFtcE1zJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdkdXJhdGlvbk1zJywgZGVmYXVsdFZpc2libGU6IGZhbHNlIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2NvcnJlbGF0aW9uSWQnLCBkZWZhdWx0VmlzaWJsZTogZmFsc2UgfSxcbiAgICAgICAgXSxcbiAgICAgICAgLy8gPT09IEZJTFRFUiBTRUdNRU5UUzogUXVpY2sgYWNjZXNzIHRvIGNvbW1vbiB2aWV3cyA9PT1cbiAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICAvLyA9PT0gQlkgSElFUkFSQ0hZIChEZWZhdWx0OiBSb290IHNwYW5zIG9ubHkgdG8gcmVkdWNlIGNsdXR0ZXIpID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnaGllcmFyY2h5LWdyb3VwJyxcbiAgICAgICAgICAgIGxhYmVsOiAnVmlldycsXG4gICAgICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaWQ6ICdyb290LW9ubHknLCBsYWJlbDogJ1Jvb3QgU3BhbnMnLCBpY29uOiAnQXBhcnRtZW50T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIC8vIFVzZSBpc1Jvb3QgZm9yIGVmZmljaWVudCBHU0kgcXVlcnkgaW5zdGVhZCBvZiBub3RFeGlzdHMgZmlsdGVyXG4gICAgICAgICAgICAgICAgZmlsdGVyczogeyBpc1Jvb3Q6IHsgZXE6IHRydWUgfSB9LFxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHRydWVcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnY2hpbGQtb25seScsIGxhYmVsOiAnQ2hpbGQgU3BhbnMnLCBpY29uOiAnQnJhbmNoZXNPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgZmlsdGVyczogeyBpc1Jvb3Q6IHsgZXE6IGZhbHNlIH0gfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnYWxsLXNwYW5zJywgbGFiZWw6ICdBbGwgRXZlbnRzJywgaWNvbjogJ1Vub3JkZXJlZExpc3RPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgZmlsdGVyczoge31cbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gQlkgTEVWRUwgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdsZXZlbC1ncm91cCcsXG4gICAgICAgICAgICBsYWJlbDogJ0xldmVsJyxcbiAgICAgICAgICAgIHNlZ21lbnRzOiBbXG4gICAgICAgICAgICAgIHsgaWQ6ICdhbGwtbGV2ZWxzJywgbGFiZWw6ICdBbGwnLCBmaWx0ZXJzOiB7fSwgZGVmYXVsdDogdHJ1ZSB9LFxuICAgICAgICAgICAgICB7IGlkOiAnZXJyb3JzJywgbGFiZWw6ICdFcnJvcnMnLCBpY29uOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICdlcnJvcicgfSB9LCBiYWRnZVN0YXR1czogJ2Vycm9yJyB9LFxuICAgICAgICAgICAgICB7IGlkOiAnd2FybmluZ3MnLCBsYWJlbDogJ1dhcm5pbmdzJywgaWNvbjogJ1dhcm5pbmdPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICd3YXJuJyB9IH0sIGJhZGdlU3RhdHVzOiAnd2FybmluZycgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ2luZm8nLCBsYWJlbDogJ0luZm8nLCBpY29uOiAnSW5mb0NpcmNsZU91dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ2luZm8nIH0gfSB9LFxuICAgICAgICAgICAgICB7IGlkOiAnZGVidWcnLCBsYWJlbDogJ0RlYnVnJywgaWNvbjogJ0J1Z091dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ2RlYnVnJyB9IH0gfSxcbiAgICAgICAgICAgICAgeyBpZDogJ3RyYWNlJywgbGFiZWw6ICdUcmFjZScsIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICd0cmFjZScgfSB9IH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIGV4cGFuZGFibGU6IHtcbiAgICAgICAgICBtb2RlOiAnanNvbicsXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyA9PT0gVklFVyBQQUdFIENPTkZJR1VSQVRJT04gPT09XG4gICAgdmlld1BhZ2VDb25maWc6IHtcbiAgICAgIC8vIFR3by1jb2x1bW4gbGF5b3V0IGZvciBlc3NlbnRpYWwgaWRlbnRpZmljYXRpb24gYW5kIG9wZXJhdGlvbiBkZXRhaWxzXG4gICAgICBjb2x1bW5zQ29uZmlnOiB7XG4gICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICBsYWJlbDogJ0lkZW50aXR5ICYgQ2xhc3NpZmljYXRpb24nLFxuICAgICAgICAgICAgZmllbGRzOiBbXG4gICAgICAgICAgICAgICdvYnNlcnZhYmlsaXR5TG9nSWQnLFxuICAgICAgICAgICAgICAndHlwZScsXG4gICAgICAgICAgICAgICdzdWJUeXBlJyxcbiAgICAgICAgICAgICAgJ2xldmVsJyxcbiAgICAgICAgICAgICAgJ2NvcnJlbGF0aW9uSWQnLCAgLy8gSGFzIGxpbmtDb25maWcgLSByZW5kZXJzIGFzIGxpbmsgdG8gdHJhY2Ugdmlld1xuICAgICAgICAgICAgICAnaXNSb290JyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICBsYWJlbDogJ09wZXJhdGlvbiAmIFRpbWluZycsXG4gICAgICAgICAgICBmaWVsZHM6IFtcbiAgICAgICAgICAgICAgJ29wZXJhdGlvbicsXG4gICAgICAgICAgICAgICdzdGF0dXMnLFxuICAgICAgICAgICAgICAnc3VjY2VzcycsXG4gICAgICAgICAgICAgICd0aW1lc3RhbXBNcycsXG4gICAgICAgICAgICAgICdkdXJhdGlvbk1zJyxcbiAgICAgICAgICAgICAgJ3NvdXJjZScsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgLy8gU2VjdGlvbnMgb3JnYW5pemVkIGJ5IGxvZ2ljYWwgZ3JvdXBpbmcgd2l0aCBwcm9wZXIgdGFicy9hY2NvcmRpb25zXG4gICAgICBzZWN0aW9uc0NvbmZpZzoge1xuICAgICAgICBzZWN0aW9uR3JvdXBzOiBbXG4gICAgICAgICAgLy8gPT09IDIuIEhJRVJBUkNIWSAmIFRSQUNFIFJFTEFUSU9OUyA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2hpZXJhcmNoeS1yZWxhdGlvbnMnLFxuICAgICAgICAgICAgbGFiZWw6ICdIaWVyYXJjaHkgJiBUcmFjZScsXG4gICAgICAgICAgICBpY29uOiAnQXBhcnRtZW50T3V0bGluZWQnLFxuICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgcmVuZGVyTW9kZTogJ3RhYnMnLFxuICAgICAgICAgICAgZGVmYXVsdENvbGxhcHNlZDogdHJ1ZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiB0cnVlLFxuICAgICAgICAgICAga2VlcE1vdW50ZWQ6IHRydWUsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBwYXJlbnRTcGFuOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdQYXJlbnQgU3BhbicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ05vZGVJbmRleE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5nOiB7IHNvdXJjZTogJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsIHRhcmdldDogJ29ic2VydmFiaWxpdHlMb2dJZCcgfSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY2hpbGRTcGFuczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ2hpbGQgU3BhbnMnLFxuICAgICAgICAgICAgICAgIGljb246ICdCcmFuY2hlc091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICc6b2JzZXJ2YWJpbGl0eUxvZ0lkJyB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgdHJhY2VMb2dzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdGdWxsIFRyYWNlJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnU2hhcmVBbHRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAzLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgY29ycmVsYXRpb25JZDogJzpjb3JyZWxhdGlvbklkJyB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gMy4gRVZFTlQgREFUQSAoQ29yZSBwYXlsb2FkcykgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdldmVudC1kYXRhJyxcbiAgICAgICAgICAgIGxhYmVsOiAnRXZlbnQgRGF0YScsXG4gICAgICAgICAgICBpY29uOiAnRmlsZVRleHRPdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiBmYWxzZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiB0cnVlLFxuICAgICAgICAgICAgc2VjdGlvbnM6IHtcbiAgICAgICAgICAgICAgZW50aXR5SW5mbzoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRW50aXR5IEluZm9ybWF0aW9uJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnSW5mb0NpcmNsZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlbnRpdHlOYW1lOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2VudGl0eU5hbWUnLCAnZW50aXR5SWQnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRGF0YScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0ZpbGVUZXh0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGRhdGE6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnZGF0YScgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBdHRyaWJ1dGVzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnVGFnc091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBhdHRyaWJ1dGVzOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2F0dHJpYnV0ZXMnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgZXJyb3I6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0Vycm9yJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRXhjbGFtYXRpb25DaXJjbGVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA0LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZXJyb3I6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnZXJyb3InIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gNS4gQURESVRJT05BTCBEQVRBIChUYWdzLCBNZXRhZGF0YSwgQ29udGV4dCkgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdhZGRpdGlvbmFsLWRhdGEnLFxuICAgICAgICAgICAgbGFiZWw6ICdBZGRpdGlvbmFsIERhdGEnLFxuICAgICAgICAgICAgaWNvbjogJ0ZvbGRlck9wZW5PdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDUsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiB0cnVlLFxuICAgICAgICAgICAgbGF6eUxvYWQ6IGZhbHNlLFxuICAgICAgICAgICAga2VlcE1vdW50ZWQ6IHRydWUsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdNZXRyaWNzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRGFzaGJvYXJkT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IG1ldHJpY3M6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnbWV0cmljcycgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdUYWdzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnVGFnT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHRhZ3M6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAndGFncycgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnTWV0YWRhdGEnLFxuICAgICAgICAgICAgICAgIGljb246ICdJbmZvQ2lyY2xlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMyxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IG1ldGFkYXRhOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ21ldGFkYXRhJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0NvbnRleHQnLFxuICAgICAgICAgICAgICAgIGljb246ICdFbnZpcm9ubWVudE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDQsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBjb250ZXh0OiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ2NvbnRleHQnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gNi4gUkVMQVRFRCBMT0dTIChFbnRpdHkgJiBTb3VyY2UgQW5hbHl0aWNzKSA9PT1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3JlbGF0ZWQtYW5hbHl0aWNzJyxcbiAgICAgICAgICAgIGxhYmVsOiAnUmVsYXRlZCBMb2dzJyxcbiAgICAgICAgICAgIGljb246ICdGdW5kT3V0bGluZWQnLFxuICAgICAgICAgICAgc29ydE9yZGVyOiA2LFxuICAgICAgICAgICAgcmVuZGVyTW9kZTogJ3RhYnMnLFxuICAgICAgICAgICAgZGVmYXVsdENvbGxhcHNlZDogdHJ1ZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiBmYWxzZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiB0cnVlLFxuICAgICAgICAgICAgc2VjdGlvbnM6IHtcbiAgICAgICAgICAgICAgYnlFbnRpdHk6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0VudGl0eSBMb2dzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRGF0YWJhc2VPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZW50aXR5TmFtZTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnOmVudGl0eU5hbWUnLFxuICAgICAgICAgICAgICAgICAgICAgIGVudGl0eUlkOiAnOmVudGl0eUlkJyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGJ5RW50aXR5VHlwZToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRW50aXR5IFR5cGUgTG9ncycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0FwcHN0b3JlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGVudGl0eU5hbWU6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGVudGl0eU5hbWU6ICc6ZW50aXR5TmFtZScgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGJ5U291cmNlOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdTb3VyY2UgTG9ncycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0NvZGVTYW5kYm94T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMyxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHNvdXJjZTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgc291cmNlOiAnOnNvdXJjZScgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gPT09IDcuIEFDVE9SICYgU1lTVEVNIElORk8gPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdhY3Rvci1zeXN0ZW0nLFxuICAgICAgICAgICAgbGFiZWw6ICdBY3RvciAmIFN5c3RlbScsXG4gICAgICAgICAgICBpY29uOiAnU2V0dGluZ091dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogNyxcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IHRydWUsXG4gICAgICAgICAgICBsYXp5TG9hZDogZmFsc2UsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogdHJ1ZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBY3RvcicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1VzZXJPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgYWN0b3I6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnYWN0b3InIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgc3lzdGVtSW5mbzoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnU3lzdGVtIEluZm8nLFxuICAgICAgICAgICAgICAgIGljb246ICdDbG9ja0NpcmNsZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ3R0bCcgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICBhdHRyaWJ1dGVzOiB7XG4gICAgLy8gPT09IElERU5USVRZID09PVxuICAgIG9ic2VydmFiaWxpdHlMb2dJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbVVVSUQoKSxcbiAgICAgIGxhYmVsOiAnTG9nIElEJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ1BhcmVudCBMb2cgSUQnLFxuICAgICAgaGVscFRleHQ6ICdSZWZlcmVuY2UgdG8gcGFyZW50IHNwYW4gZm9yIGhpZXJhcmNoaWNhbCB0cmFjaW5nJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIC8vIFNlbGYtcmVmZXJlbnRpYWwgcmVsYXRpb24gdG8gcGFyZW50IG9ic2VydmFiaWxpdHkgbG9nXG4gICAgICByZWxhdGlvbjoge1xuICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gICAgICAgIGlkZW50aWZpZXJzOiB7IHNvdXJjZTogJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsIHRhcmdldDogJ29ic2VydmFiaWxpdHlMb2dJZCcgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBDb21wdXRlZCBmaWVsZDogdHJ1ZSBpZiB0aGlzIGlzIGEgcm9vdCBzcGFuIChubyBwYXJlbnQpXG4gICAgLy8gVXNlZCBmb3IgZWZmaWNpZW50IEdTSSBxdWVyaWVzIGluc3RlYWQgb2Ygbm90RXhpc3RzIGZpbHRlclxuICAgIGlzUm9vdDoge1xuICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgbGFiZWw6ICdJcyBSb290JyxcbiAgICAgIGhlbHBUZXh0OiAnVHJ1ZSBpZiB0aGlzIGlzIGEgcm9vdCBzcGFuIChubyBwYXJlbnQpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIHdhdGNoOiBbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF0sXG4gICAgICAvLyBTZXQgdG8gdHJ1ZSB3aGVuIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBpcyBudWxsL3VuZGVmaW5lZFxuICAgICAgc2V0OiAoXzogdW5rbm93biwgZGF0YTogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ/OiBzdHJpbmcgfSkgPT5cbiAgICAgICAgIWRhdGEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgZGVmYXVsdDogKCkgPT4gdHJ1ZSwgIC8vIERlZmF1bHQgdG8gdHJ1ZSBpZiBubyBwYXJlbnQgc3BlY2lmaWVkXG4gICAgfSxcbiAgICAvLyBOT1RFOiBjb3JyZWxhdGlvbklkIGlzIFJFUVVJUkVEIGFuZCBoYXMgTk8gZGVmYXVsdC5cbiAgICAvLyBJZiB5b3UncmUgZ2V0dGluZyB2YWxpZGF0aW9uIGVycm9ycywgZXN0YWJsaXNoIGNvbnRleHQgZmlyc3Qgd2l0aCBydW5XaXRoQ29udGV4dCgpLlxuICAgIC8vIEhhdmluZyBhIGRlZmF1bHQgaGVyZSB3b3VsZCBoaWRlIGJ1Z3Mgd2hlcmUgY29udGV4dCB3YXNuJ3QgcHJvcGVybHkgZXN0YWJsaXNoZWQuXG4gICAgY29ycmVsYXRpb25JZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGxhYmVsOiAnQ29ycmVsYXRpb24gSUQnLFxuICAgICAgaGVscFRleHQ6ICdVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGVudGlyZSByZXF1ZXN0L3RyYWNlJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIC8vIE5PIERFRkFVTFQgLSBtdXN0IGJlIHByb3BhZ2F0ZWQgZnJvbSBjb250ZXh0XG4gICAgICAvLyBMaW5rIHRvIGZpbHRlcmVkIGxpc3Qgc2hvd2luZyBhbGwgbG9ncyBpbiB0aGUgc2FtZSB0cmFjZVxuICAgICAgaXNMaW5rOiB0cnVlLFxuICAgICAgbGlua0NvbmZpZzoge1xuICAgICAgICByb3V0ZVBhdHRlcm46ICcvbGlzdC1vYnNlcnZhYmlsaXR5bG9nP2NvcnJlbGF0aW9uSWQuZXE9OmNvcnJlbGF0aW9uSWQnLFxuICAgICAgICBkaXNwbGF5VGV4dDogJ1ZpZXcgQ29ycmVsYXRlZCBMb2dzJyxcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIC8vID09PSBDTEFTU0lGSUNBVElPTiA9PT1cbiAgICB0eXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgbGFiZWw6ICdUeXBlJyxcbiAgICAgIGhlbHBUZXh0OiAnRXZlbnQgdHlwZSAoc3Bhbi5zdGFydCwgc3Bhbi5lbmQsIGF1ZGl0LmVudGl0eSwgbG9nLCBtZXRyaWMsIGV0Yy4pJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgfSxcbiAgICBzdWJUeXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnU3ViLVR5cGUnLFxuICAgICAgaGVscFRleHQ6ICdBZGRpdGlvbmFsIHR5cGUgY2xhc3NpZmljYXRpb24nLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgIH0sXG4gICAgLy8gTk9URTogbGV2ZWwgaXMgUkVRVUlSRUQgYW5kIGhhcyBOTyBkZWZhdWx0LlxuICAgIC8vIFRoZSBvYnNlcnZlciBNVVNUIHNwZWNpZnkgdGhlIGxldmVsIGV4cGxpY2l0bHkuXG4gICAgbGV2ZWw6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBsYWJlbDogJ0xldmVsJyxcbiAgICAgIGhlbHBUZXh0OiAnU2V2ZXJpdHkgbGV2ZWw6IGVycm9yLCB3YXJuLCBpbmZvLCBkZWJ1ZycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc1NvcnRhYmxlOiB0cnVlLFxuICAgICAgLy8gTk8gREVGQVVMVCAtIG11c3QgYmUgc3BlY2lmaWVkIGJ5IG9ic2VydmVyXG4gICAgfSxcblxuICAgIC8vID09PSBFTlRJVFkgQ09OVEVYVCA9PT1cbiAgICBlbnRpdHlOYW1lOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnRW50aXR5IE5hbWUnLFxuICAgICAgaGVscFRleHQ6ICdOYW1lIG9mIHRoZSBlbnRpdHkgdGhpcyBldmVudCByZWxhdGVzIHRvJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgfSxcbiAgICBlbnRpdHlJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ0VudGl0eSBJRCcsXG4gICAgICBoZWxwVGV4dDogJ0lEIG9mIHRoZSBzcGVjaWZpYyBlbnRpdHkgaW5zdGFuY2UnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgLy8gRGVmYXVsdCB0byAnXycgd2hlbiBlbnRpdHlOYW1lIGlzIHNldCBidXQgZW50aXR5SWQgaXMgbm90IChyZXF1aXJlZCBmb3IgYnlFbnRpdHkgY29tcG9zaXRlIGluZGV4KVxuICAgICAgd2F0Y2g6IFsgJ2VudGl0eU5hbWUnIF0sXG4gICAgICBzZXQ6IChfOiB1bmtub3duLCBkYXRhOiB7IGVudGl0eU5hbWU/OiBzdHJpbmc7IGVudGl0eUlkPzogc3RyaW5nIH0pID0+XG4gICAgICAgIGRhdGEuZW50aXR5SWQgfHwgKGRhdGEuZW50aXR5TmFtZSA/ICdfJyA6IHVuZGVmaW5lZCksXG4gICAgICAvLyBEeW5hbWljIGxpbmsgdG8gdGhlIHJlbGF0ZWQgZW50aXR5IGJhc2VkIG9uIGVudGl0eU5hbWVcbiAgICAgIGlzTGluazogdHJ1ZSxcbiAgICAgIGxpbmtDb25maWc6IHtcbiAgICAgICAgcm91dGVQYXR0ZXJuOiAnL3ZpZXctOmVudGl0eU5hbWUvOmVudGl0eUlkJyxcbiAgICAgICAgZGlzcGxheVRleHQ6ICdWaWV3IEVudGl0eScsXG4gICAgICB9LFxuICAgIH0sXG5cbiAgICAvLyA9PT0gT1BFUkFUSU9OID09PVxuICAgIG9wZXJhdGlvbjoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ09wZXJhdGlvbicsXG4gICAgICBoZWxwVGV4dDogJ1RoZSBvcGVyYXRpb24gYmVpbmcgcGVyZm9ybWVkIChlLmcuLCBjcmVhdGUsIHVwZGF0ZSwgcXVlcnkpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgfSxcbiAgICBzdGF0dXM6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdTdGF0dXMnLFxuICAgICAgaGVscFRleHQ6ICdPcGVyYXRpb24gc3RhdHVzIChlLmcuLCBzdGFydGVkLCBjb21wbGV0ZWQsIGZhaWxlZCknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgIH0sXG4gICAgc3VjY2Vzczoge1xuICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgbGFiZWw6ICdTdWNjZXNzJyxcbiAgICAgIGhlbHBUZXh0OiAnV2hldGhlciB0aGUgb3BlcmF0aW9uIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgZmllbGRUeXBlOiAnYm9vbGVhbicsXG4gICAgICBib29sZWFuTGFiZWxzOiB7IHRydWU6ICdTdWNjZXNzJywgZmFsc2U6ICdGYWlsZWQnIH0sXG4gICAgfSxcblxuICAgIC8vID09PSBUSU1JTkcgPT09XG4gICAgdGltZXN0YW1wTXM6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBkZWZhdWx0OiAoKSA9PiBEYXRlLm5vdygpLFxuICAgICAgbGFiZWw6ICdUaW1lc3RhbXAnLFxuICAgICAgaGVscFRleHQ6ICdFdmVudCB0aW1lc3RhbXAgaW4gbWlsbGlzZWNvbmRzIHNpbmNlIGVwb2NoJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgICBmaWVsZFR5cGU6ICdkYXRldGltZScsXG4gICAgfSxcbiAgICBkdXJhdGlvbk1zOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIGxhYmVsOiAnRHVyYXRpb24gKG1zKScsXG4gICAgICBoZWxwVGV4dDogJ09wZXJhdGlvbiBkdXJhdGlvbiBpbiBtaWxsaXNlY29uZHMnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICAgIGZpZWxkVHlwZTogJ2R1cmF0aW9uJyxcbiAgICAgIGR1cmF0aW9uVW5pdDogJ21zJyxcbiAgICB9LFxuXG4gICAgLy8gPT09IFNPVVJDRSAmIFRBR1MgPT09XG4gICAgc291cmNlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnU291cmNlJyxcbiAgICAgIGhlbHBUZXh0OiAnU291cmNlIG9mIHRoZSBldmVudCAoZS5nLiwgc2VydmljZSBuYW1lLCBmdW5jdGlvbiBuYW1lKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICAvLyBOT1RFOiB0YWdzLCBtZXRyaWNzLCBhdHRyaWJ1dGVzLCBkYXRhLCBtZXRhZGF0YSwgYWN0b3IsIGNvbnRleHQgYWxsIHVzZSBwcm9wZXJ0aWVzOnt9XG4gICAgLy8gVGhpcyBpcyBCWSBERVNJR04gLSB0aGlzIGlzIGEgVU5JVkVSU0FMIHN0b3JlIGZvciBBTEwgZXZlbnQgdHlwZXMgKHNwYW4sIGF1ZGl0LFxuICAgIC8vIG1ldHJpYywgd29ya2Zsb3csIGRlY2lzaW9uLCBhY2Nlc3MsIGxvZykuIEVhY2ggaGFzIGNvbXBsZXRlbHkgZGlmZmVyZW50IHBheWxvYWRzLlxuICAgIC8vIEVsZWN0cm9EQiBwcm9wZXJ0aWVzOnt9ID0gYWNjZXB0IGFueSBtYXAgc3RydWN0dXJlIGF0IHJ1bnRpbWUuXG4gICAgdGFnczoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ1RhZ3MnLFxuICAgICAgaGVscFRleHQ6ICdLZXktdmFsdWUgdGFncyBmb3IgY2F0ZWdvcml6YXRpb24nLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gUEFZTE9BRFMgKHNjaGVtYWxlc3MgYnkgZGVzaWduIC0gZGlmZmVyZW50IGV2ZW50IHR5cGVzIGhhdmUgZGlmZmVyZW50IHN0cnVjdHVyZXMpID09PVxuICAgIG1ldHJpY3M6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdNZXRyaWNzJyxcbiAgICAgIGhlbHBUZXh0OiAnTnVtZXJpY2FsIG1ldHJpY3MgYW5kIG1lYXN1cmVtZW50cycsXG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnQXR0cmlidXRlcycsXG4gICAgICBoZWxwVGV4dDogJ0FkZGl0aW9uYWwgc3RydWN0dXJlZCBhdHRyaWJ1dGVzJyxcbiAgICB9LFxuICAgIGRhdGE6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdEYXRhJyxcbiAgICAgIGhlbHBUZXh0OiAnRXZlbnQtc3BlY2lmaWMgZGF0YSBwYXlsb2FkJyxcbiAgICB9LFxuICAgIG1ldGFkYXRhOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnTWV0YWRhdGEnLFxuICAgICAgaGVscFRleHQ6ICdBZGRpdGlvbmFsIG1ldGFkYXRhIGFib3V0IHRoZSBldmVudCcsXG4gICAgfSxcbiAgICBlcnJvcjoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0Vycm9yJyxcbiAgICAgIGhlbHBUZXh0OiAnRXJyb3IgZGV0YWlscyBpZiB0aGUgb3BlcmF0aW9uIGZhaWxlZCcsXG4gICAgICAvLyBTdHJ1Y3R1cmU6IHsgdHlwZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmcsIHN0YWNrPzogc3RyaW5nLCBjb2RlPzogc3RyaW5nIH1cbiAgICB9LFxuXG4gICAgLy8gPT09IEFDVE9SIChzdG9yZWQgYXMtaXMgZnJvbSBleGlzdGluZyBBY3RvciB0eXBlKSA9PT1cbiAgICBhY3Rvcjoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0FjdG9yJyxcbiAgICAgIGhlbHBUZXh0OiAnSW5mb3JtYXRpb24gYWJvdXQgd2hvIHRyaWdnZXJlZCB0aGlzIGV2ZW50JyxcbiAgICB9LFxuXG4gICAgLy8gPT09IENPTlRFWFQgPT09XG4gICAgY29udGV4dDoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0NvbnRleHQnLFxuICAgICAgaGVscFRleHQ6ICdFeGVjdXRpb24gY29udGV4dCBhbmQgZW52aXJvbm1lbnQgaW5mb3JtYXRpb24nLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gVFRMID09PVxuICAgIC8vIFRUTCBmb3IgYXV0by1jbGVhbnVwIChhbHdheXMgcHJvdmlkZWQgYnkgYmFja2VuZClcbiAgICB0dGw6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgZGVmYXVsdDogKCkgPT4gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyAoOTAgKiAyNCAqIDYwICogNjApLCAvLyA5MCBkYXlzXG4gICAgICBsYWJlbDogJ1RUTCcsXG4gICAgICBoZWxwVGV4dDogJ1RpbWUtdG8tbGl2ZSBmb3IgYXV0b21hdGljIGNsZWFudXAgKFVuaXggdGltZXN0YW1wKScsXG4gICAgICBmaWVsZFR5cGU6ICdkYXRldGltZScsXG4gICAgfSxcbiAgfSxcbiAgaW5kZXhlczoge1xuICAgIC8vIFByaW1hcnkgLSBieSBvYnNlcnZhYmlsaXR5TG9nSWRcbiAgICBwcmltYXJ5OiB7XG4gICAgICBwazogeyBmaWVsZDogJ3BrJywgY29tcG9zaXRlOiBbICdvYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnc2snLCBjb21wb3NpdGU6IFtdIH0sXG4gICAgfSxcbiAgICAvLyBHU0kxIC0gYnkgdHJhY2UgLSBnZXQgYWxsIGV2ZW50cyBpbiBhIHJlcXVlc3QvdHJhY2VcbiAgICBieVRyYWNlOiB7XG4gICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2kxcGsnLCBjb21wb3NpdGU6IFsgJ2NvcnJlbGF0aW9uSWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpMXNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJMiAtIGJ5IHBhcmVudCAtIGdldCBjaGlsZHJlbiwgcmVjb25zdHJ1Y3Qgc3BhbiBoaWVyYXJjaHlcbiAgICBieVBhcmVudDoge1xuICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpMnBrJywgY29tcG9zaXRlOiBbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpMnNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJMyAtIGJ5IHR5cGUgLSBmaWx0ZXIgYnkgZXZlbnQgdHlwZSAoc3Bhbi4qLCBhdWRpdC4qLCBsb2csIG1ldHJpYylcbiAgICBieVR5cGU6IHtcbiAgICAgIGluZGV4OiAnZ3NpMycsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTNwaycsIGNvbXBvc2l0ZTogWyAndHlwZScgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kzc2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k0IC0gYnkgbGV2ZWwgLSBmaW5kIGVycm9ycy93YXJuaW5ncyBxdWlja2x5XG4gICAgYnlMZXZlbDoge1xuICAgICAgaW5kZXg6ICdnc2k0JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNHBrJywgY29tcG9zaXRlOiBbICdsZXZlbCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k0c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k1IC0gYnkgZW50aXR5IHR5cGUgLSBcImFsbCBPcmRlciBldmVudHNcIiwgXCJhbGwgVXNlciBldmVudHNcIlxuICAgIGJ5RW50aXR5VHlwZToge1xuICAgICAgaW5kZXg6ICdnc2k1JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNXBrJywgY29tcG9zaXRlOiBbICdlbnRpdHlOYW1lJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTVzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTYgLSBieSBlbnRpdHkgaW5zdGFuY2UgLSBcImFsbCBldmVudHMgZm9yIE9yZGVyOjEyM1wiXG4gICAgYnlFbnRpdHk6IHtcbiAgICAgIGluZGV4OiAnZ3NpNicsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTZwaycsIGNvbXBvc2l0ZTogWyAnZW50aXR5TmFtZScsICdlbnRpdHlJZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k2c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k3IC0gYnkgaXNSb290IC0gZWZmaWNpZW50bHkgZmluZCByb290IHNwYW5zIHdpdGhvdXQgZnVsbCBzY2FuXG4gICAgYnlJc1Jvb3Q6IHtcbiAgICAgIGluZGV4OiAnZ3NpNycsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTdwaycsIGNvbXBvc2l0ZTogWyAnaXNSb290JyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTdzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEZvciBzb3VyY2UvYWN0b3IvdGVuYW50IHF1ZXJpZXMgLSB1c2Ugc2VhcmNoIGVuZ2luZSBzeW5jXG4gIH0sXG59IGFzIGNvbnN0KTtcblxuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYSA9IHR5cGVvZiBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hOyJdfQ==