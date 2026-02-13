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
                                    propertiesConfig: ['data'],
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
                                        hideSegments: ['hierarchy-group'],
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
                                    propertiesConfig: ['relatedTraces'],
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
            watch: ['level'],
            set: (_, data) => {
                const SECONDS_PER_DAY = 24 * 60 * 60;
                const nowSeconds = Math.floor(Date.now() / 1000);
                const retentionDays = {
                    critical: 90,
                    error: 90,
                    warn: 60,
                    info: 30,
                    debug: 7,
                    trace: 7,
                };
                const days = retentionDays[data.level ?? ''] ?? 90;
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
        // GSI9 - by fingerprint - group same errors across invocations
        byFingerprint: {
            index: 'gsi9',
            pk: { field: 'gsi9pk', composite: ['fingerprint'] },
            sk: { field: 'gsi9sk', composite: ['timestampMs'] },
        },
        // For source/actor/tenant queries - use search engine sync
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1sb2ctZW50aXR5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvc3RvcmFnZS9vYnNlcnZhYmlsaXR5LWxvZy1lbnRpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCxtQ0FBcUM7QUFDckMsZ0VBQWdFO0FBQ2hFLDBEQUF5STtBQUV6STs7Ozs7Ozs7Ozs7R0FXRztBQUNVLFFBQUEsNEJBQTRCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUM3RCxLQUFLLEVBQUU7UUFDTCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxrQkFBa0I7UUFDMUIsZ0JBQWdCLEVBQUUsbUJBQW1CO1FBQ3JDLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6Qyx3Q0FBd0M7UUFDeEMsbUJBQW1CLEVBQUUsSUFBSTtRQUN6QixvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLE1BQU0sRUFBRTtZQUNOLE9BQU8sRUFBRSxLQUFLO1lBQ2QsV0FBVyxFQUFFO2dCQUNYLFVBQVUsRUFBRSxvQkFBb0I7YUFDakM7U0FDRjtRQUNELGtDQUFrQztRQUNsQyxjQUFjLEVBQUU7WUFDZCxXQUFXLEVBQUU7Z0JBQ1gscUNBQXFDO2dCQUNyQyx1RUFBdUU7Z0JBQ3ZFLFdBQVcsRUFBRSxFQUFFLEtBQUssRUFBRSxhQUFhLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRTtnQkFDcEQseURBQXlEO2dCQUN6RCxVQUFVLEVBQUU7b0JBQ1Y7d0JBQ0UsRUFBRSxFQUFFLFlBQVk7d0JBQ2hCLEtBQUssRUFBRSxZQUFZO3dCQUNuQixJQUFJLEVBQUUsbUJBQW1CO3dCQUN6QixPQUFPLEVBQUUsWUFBWTt3QkFDckIsaUVBQWlFO3dC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aEUsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUUsRUFBRTtTQUN0RDtRQUNELCtFQUErRTtRQUMvRSw0REFBNEQ7UUFDNUQsVUFBVSxFQUFFO1lBQ1YsS0FBSyxFQUFFLE1BQU07WUFDYixFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUUsUUFBUSxFQUFFLFlBQVksRUFBRTtZQUM5RCxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLGFBQWEsQ0FBRSxFQUFFO1NBQ3REO1FBQ0QsK0ZBQStGO1FBQy9GLFVBQVUsRUFBRTtZQUNWLEtBQUssRUFBRSxNQUFNO1lBQ2IsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxVQUFVLENBQUUsRUFBRTtZQUNsRCxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLGFBQWEsQ0FBRSxFQUFFO1NBQ3REO1FBQ0QsK0RBQStEO1FBQy9ELGFBQWEsRUFBRTtZQUNiLEtBQUssRUFBRSxNQUFNO1lBQ2IsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUUsRUFBRTtZQUNyRCxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxDQUFFLGFBQWEsQ0FBRSxFQUFFO1NBQ3REO1FBQ0QsMkRBQTJEO0tBQzVEO0NBQ08sQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5IExvZyBFbnRpdHkgU2NoZW1hXG4gKiBcbiAqIER5bmFtb0RCIHRhYmxlIHNjaGVtYSBmb3Igc3RvcmluZyBhbGwgb2JzZXJ2YWJpbGl0eSBldmVudHMuXG4gKiBVc2VkIGJ5IE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlIHdoaWNoIGlzIHNlbGYtY29udGFpbmVkIChubyBESSBkZXBlbmRlbmN5KS5cbiAqL1xuXG5pbXBvcnQgeyByYW5kb21CeXRlcyB9IGZyb20gJ2NyeXB0byc7XG4vLyBJbXBvcnQgZGlyZWN0bHkgZnJvbSBiYXNlLWVudGl0eSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5XG5pbXBvcnQgeyBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgY3JlYXRlRW50aXR5U2NoZW1hLCBFbnRpdHlUeXBlRnJvbVNjaGVtYSwgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWEgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1lbnRpdHknO1xuXG4vKipcbiAqIE9ic2VydmFiaWxpdHkgTG9nIEVudGl0eSBTY2hlbWFcbiAqIFxuICogVW5pdmVyc2FsIHNjaGVtYSBmb3IgYWxsIG9ic2VydmFiaWxpdHkgZXZlbnQgdHlwZXM6XG4gKiAtIHNwYW4gLyBzcGFuLnN0YXJ0IChkaXN0cmlidXRlZCB0cmFjaW5nKVxuICogLSBhdWRpdC5lbnRpdHksIGF1ZGl0LmFjdGlvbiwgYXVkaXQuY29tcGxpYW5jZSAoYXVkaXRpbmcpXG4gKiAtIG1ldHJpYyAobWV0cmljcy9jb3VudGVycylcbiAqIC0gd29ya2Zsb3cuKiAod29ya2Zsb3cgdHJhY2tpbmcpXG4gKiAtIGRlY2lzaW9uLiogKGRlY2lzaW9uIGxvZ2dpbmcpXG4gKiAtIGFjY2VzcyAoQVBJIGFjY2VzcyBsb2dzKVxuICogLSBsb2cgKHN0cnVjdHVyZWQgbG9nZ2luZylcbiAqL1xuZXhwb3J0IGNvbnN0IE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICBtb2RlbDoge1xuICAgIHZlcnNpb246ICcxJyxcbiAgICBlbnRpdHk6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICBlbnRpdHlOYW1lUGx1cmFsOiAnb2JzZXJ2YWJpbGl0eUxvZ3MnLFxuICAgIHNlcnZpY2U6ICdvYnNlcnZhYmlsaXR5JyxcbiAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICAvLyBTeXN0ZW0gZW50aXR5IC0gcmVhZC1vbmx5IGluIGFkbWluIFVJXG4gICAgZXhjbHVkZUF1ZGl0QWN0aW9uczogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluTWVudTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluQ3JlYXRlOiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZTogdHJ1ZSxcbiAgICBzZWFyY2g6IHtcbiAgICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgICAgaW5kZXhDb25maWc6IHtcbiAgICAgICAgcHJpbWFyeUtleTogJ29ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICB9XG4gICAgfSxcbiAgICAvLyA9PT0gTElTVCBQQUdFIENPTkZJR1VSQVRJT04gPT09XG4gICAgbGlzdFBhZ2VDb25maWc6IHtcbiAgICAgIHRhYmxlQ29uZmlnOiB7XG4gICAgICAgIC8vIERlZmF1bHQgc29ydDogbGF0ZXN0IHJlY29yZHMgZmlyc3RcbiAgICAgICAgLy8gU2VhcmNoIG1vZGUgdXNlcyBmdWxsIGNvbmZpZywgREIgbW9kZSBleHRyYWN0cyBqdXN0IHRoZSAnZGVzYycgb3JkZXJcbiAgICAgICAgZGVmYXVsdFNvcnQ6IHsgZmllbGQ6ICd0aW1lc3RhbXBNcycsIG9yZGVyOiAnZGVzYycgfSxcbiAgICAgICAgLy8gUm93IGFjdGlvbnMgLSBxdWljayBhY2Nlc3Mgd2l0aG91dCBsb3NpbmcgbGlzdCBjb250ZXh0XG4gICAgICAgIHJvd0FjdGlvbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3F1aWNrLXZpZXcnLFxuICAgICAgICAgICAgbGFiZWw6ICdRdWljayBWaWV3JyxcbiAgICAgICAgICAgIGljb246ICdFeHBhbmRBbHRPdXRsaW5lZCcsXG4gICAgICAgICAgICB0b29sdGlwOiAnUXVpY2sgVmlldycsXG4gICAgICAgICAgICAvLyBPcGVuIHZpZXcgcGFnZSBpbiBtb2RhbCAtIFVSTCB3aWxsIGJlIHJlc29sdmVkIHRvIGZldGNoIGNvbmZpZ1xuICAgICAgICAgICAgdXJsOiAnL3ZpZXctb2JzZXJ2YWJpbGl0eWxvZy86b2JzZXJ2YWJpbGl0eUxvZ0lkJyxcbiAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgbW9kYWxUaXRsZTogJ0xvZyBEZXRhaWxzJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndmlldy10cmFjZScsXG4gICAgICAgICAgICBsYWJlbDogJ1ZpZXcgVHJhY2UnLFxuICAgICAgICAgICAgaWNvbjogJ0FwYXJ0bWVudE91dGxpbmVkJyxcbiAgICAgICAgICAgIHRvb2x0aXA6ICdWaWV3IGNvcnJlbGF0ZWQgbG9ncycsXG4gICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgIG1vZGFsVGl0bGU6ICdUcmFjZSBMb2dzJyxcbiAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGNvcnJlbGF0aW9uSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGNvcnJlbGF0aW9uSWQ6ICc6Y29ycmVsYXRpb25JZCcgfSxcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd2aWV3LWNoaWxkcmVuJyxcbiAgICAgICAgICAgIGxhYmVsOiAnVmlldyBDaGlsZHJlbicsXG4gICAgICAgICAgICBpY29uOiAnQnJhbmNoZXNPdXRsaW5lZCcsXG4gICAgICAgICAgICB0b29sdGlwOiAnVmlldyBjaGlsZCBsb2dzJyxcbiAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgbW9kYWxUaXRsZTogJ0NoaWxkIExvZ3MnLFxuICAgICAgICAgICAgLy8gU2hvdyBmb3IgbG9ncyB0aGF0IGRvbid0IGhhdmUgYSBwYXJlbnQgKHJvb3QgbG9ncyBtYXkgaGF2ZSBjaGlsZHJlbilcbiAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IGZhbHNlIH0gfSB9LFxuICAgICAgICAgICAgLy8gVXNlIG1vZGFsQ29uZmlnUmVmIHRvIGhpZGUgaGllcmFyY2h5IHNlZ21lbnRzIChjb25mbGljdHMgd2l0aCBwYXJlbnQgZmlsdGVyKVxuICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJzpvYnNlcnZhYmlsaXR5TG9nSWQnIH0sXG4gICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIC8vIENvbHVtbnMgZm9yIHF1aWNrIHNjYW5uaW5nIOKAlCBlc3NlbnRpYWwgZmllbGRzIHZpc2libGUgYnkgZGVmYXVsdFxuICAgICAgICBjb2x1bW5zOiBbXG4gICAgICAgICAgeyBmaWVsZDogJ3R5cGUnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2xldmVsJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdlbnRpdHlOYW1lJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdzb3VyY2UnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ29wZXJhdGlvbicgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnc3RhdHVzJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICd0aW1lc3RhbXBNcycgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnZHVyYXRpb25NcycgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnZmluZ2VycHJpbnQnLCBkZWZhdWx0VmlzaWJsZTogZmFsc2UgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnY29ycmVsYXRpb25JZCcsIGRlZmF1bHRWaXNpYmxlOiBmYWxzZSB9LFxuICAgICAgICBdLFxuICAgICAgICAvLyA9PT0gRklMVEVSIFNFR01FTlRTOiBRdWljayBhY2Nlc3MgdG8gY29tbW9uIHZpZXdzID09PVxuICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgIC8vID09PSBCWSBISUVSQVJDSFkgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdoaWVyYXJjaHktZ3JvdXAnLFxuICAgICAgICAgICAgbGFiZWw6ICdWaWV3JyxcbiAgICAgICAgICAgIHNlZ21lbnRzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpZDogJ2FsbC1zcGFucycsIGxhYmVsOiAnQWxsIEV2ZW50cycsIGljb246ICdVbm9yZGVyZWRMaXN0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHt9LFxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHRydWVcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAncm9vdC1vbmx5JywgbGFiZWw6ICdSb290IFNwYW5zJywgaWNvbjogJ0FwYXJ0bWVudE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAvLyBGaWx0ZXI6IG5vIHBhcmVudCA9IHJvb3Qgc3BhblxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGV4aXN0czogZmFsc2UgfSB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaWQ6ICdjaGlsZC1vbmx5JywgbGFiZWw6ICdDaGlsZCBTcGFucycsIGljb246ICdCcmFuY2hlc091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAvLyBGaWx0ZXI6IGhhcyBwYXJlbnQgPSBjaGlsZCBzcGFuXG4gICAgICAgICAgICAgICAgZmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyA9PT0gQlkgTEVWRUwgPT09XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdsZXZlbC1ncm91cCcsXG4gICAgICAgICAgICBsYWJlbDogJ0xldmVsJyxcbiAgICAgICAgICAgIHNlZ21lbnRzOiBbXG4gICAgICAgICAgICAgIHsgaWQ6ICdhbGwtbGV2ZWxzJywgbGFiZWw6ICdBbGwnLCBmaWx0ZXJzOiB7fSwgZGVmYXVsdDogdHJ1ZSB9LFxuICAgICAgICAgICAgICB7IGlkOiAnZXJyb3JzJywgbGFiZWw6ICdFcnJvcnMnLCBpY29uOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICdlcnJvcicgfSB9LCBiYWRnZVN0YXR1czogJ2Vycm9yJyB9LFxuICAgICAgICAgICAgICB7IGlkOiAnd2FybmluZ3MnLCBsYWJlbDogJ1dhcm5pbmdzJywgaWNvbjogJ1dhcm5pbmdPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICd3YXJuJyB9IH0sIGJhZGdlU3RhdHVzOiAnd2FybmluZycgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ2luZm8nLCBsYWJlbDogJ0luZm8nLCBpY29uOiAnSW5mb0NpcmNsZU91dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ2luZm8nIH0gfSB9LFxuICAgICAgICAgICAgICB7IGlkOiAnZGVidWcnLCBsYWJlbDogJ0RlYnVnJywgaWNvbjogJ0J1Z091dGxpbmVkJywgZmlsdGVyczogeyBsZXZlbDogeyBlcTogJ2RlYnVnJyB9IH0gfSxcbiAgICAgICAgICAgICAgeyBpZDogJ3RyYWNlJywgbGFiZWw6ICdUcmFjZScsIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICd0cmFjZScgfSB9IH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIGV4cGFuZGFibGU6IHtcbiAgICAgICAgICBtb2RlOiAnanNvbicsXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyA9PT0gVklFVyBQQUdFIENPTkZJR1VSQVRJT04gPT09XG4gICAgdmlld1BhZ2VDb25maWc6IHtcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAndmlldy10cmFjZScsXG4gICAgICAgICAgbGFiZWw6ICdWaWV3IEZ1bGwgVHJhY2UnLFxuICAgICAgICAgIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsXG4gICAgICAgICAgdG9vbHRpcDogJ1ZpZXcgYWxsIGV2ZW50cyBpbiB0aGlzIHRyYWNlJyxcbiAgICAgICAgICB1cmw6ICcvbGlzdC1vYnNlcnZhYmlsaXR5bG9nP2NvcnJlbGF0aW9uSWQuZXE9OmNvcnJlbGF0aW9uSWQnLFxuICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGNvcnJlbGF0aW9uSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICd2aWV3LXBhcmVudCcsXG4gICAgICAgICAgbGFiZWw6ICdHbyB0byBQYXJlbnQnLFxuICAgICAgICAgIGljb246ICdBcnJvd1VwT3V0bGluZWQnLFxuICAgICAgICAgIHRvb2x0aXA6ICdOYXZpZ2F0ZSB0byB0aGUgcGFyZW50IHNwYW4nLFxuICAgICAgICAgIHVybDogJy92aWV3LW9ic2VydmFiaWxpdHlsb2cvOnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAndmlldy1zYW1lLWVycm9yJyxcbiAgICAgICAgICBsYWJlbDogJ1NhbWUgRXJyb3IgUGF0dGVybicsXG4gICAgICAgICAgaWNvbjogJ0J1Z091dGxpbmVkJyxcbiAgICAgICAgICB0b29sdGlwOiAnVmlldyBhbGwgb2NjdXJyZW5jZXMgb2YgdGhpcyBlcnJvciBmaW5nZXJwcmludCcsXG4gICAgICAgICAgdXJsOiAnL2xpc3Qtb2JzZXJ2YWJpbGl0eWxvZz9maW5nZXJwcmludC5lcT06ZmluZ2VycHJpbnQnLFxuICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGZpbmdlcnByaW50OiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICAvLyBUd28tY29sdW1uIGxheW91dCBmb3IgZXNzZW50aWFsIGlkZW50aWZpY2F0aW9uIGFuZCBvcGVyYXRpb24gZGV0YWlsc1xuICAgICAgY29sdW1uc0NvbmZpZzoge1xuICAgICAgICBjb2x1bW5zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgbGFiZWw6ICdJZGVudGl0eSAmIENsYXNzaWZpY2F0aW9uJyxcbiAgICAgICAgICAgIGZpZWxkczogW1xuICAgICAgICAgICAgICAnb2JzZXJ2YWJpbGl0eUxvZ0lkJyxcbiAgICAgICAgICAgICAgJ3R5cGUnLFxuICAgICAgICAgICAgICAnc3ViVHlwZScsXG4gICAgICAgICAgICAgICdsZXZlbCcsXG4gICAgICAgICAgICAgICdjb3JyZWxhdGlvbklkJywgIC8vIEhhcyBsaW5rQ29uZmlnIC0gcmVuZGVycyBhcyBsaW5rIHRvIHRyYWNlIHZpZXdcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICBsYWJlbDogJ09wZXJhdGlvbiAmIFRpbWluZycsXG4gICAgICAgICAgICBmaWVsZHM6IFtcbiAgICAgICAgICAgICAgJ29wZXJhdGlvbicsXG4gICAgICAgICAgICAgICdzdGF0dXMnLFxuICAgICAgICAgICAgICAnc3VjY2VzcycsXG4gICAgICAgICAgICAgICd0aW1lc3RhbXBNcycsXG4gICAgICAgICAgICAgICdkdXJhdGlvbk1zJyxcbiAgICAgICAgICAgICAgJ3NvdXJjZScsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgLy8gVHdvIGdyb3VwczogRXZlbnQgRGV0YWlscyAoYWJvdXQgdGhpcyByZWNvcmQpIGFuZCBSZWxhdGlvbnMgKG5hdmlnYXRpb24gdG8gcmVsYXRlZCByZWNvcmRzKS5cbiAgICAgIC8vIFdpdGhpbiBlYWNoIGdyb3VwLCB0YWJzIGhhbmRsZSBkb21haW4gc2VwYXJhdGlvbi4gU3RydWN0dXJlZCB2aWV3cyBjb21lIGZpcnN0LFxuICAgICAgLy8gcmF3IEpTT04gZmFsbGJhY2tzIGFyZSBhbHdheXMgYXZhaWxhYmxlIGFzIHRoZSBsYXN0IHRhYnMuXG4gICAgICBzZWN0aW9uc0NvbmZpZzoge1xuICAgICAgICBzZWN0aW9uR3JvdXBzOiBbXG4gICAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgICAgLy8gR1JPVVAgMTogRVZFTlQgREVUQUlMUyDigJQgRXZlcnl0aGluZyBhYm91dCB0aGlzIHNwZWNpZmljIGV2ZW50XG4gICAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdldmVudC1kZXRhaWxzJyxcbiAgICAgICAgICAgIGxhYmVsOiAnRXZlbnQgRGV0YWlscycsXG4gICAgICAgICAgICBpY29uOiAnRmlsZVNlYXJjaE91dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IGZhbHNlLFxuICAgICAgICAgICAgbGF6eUxvYWQ6IGZhbHNlLFxuICAgICAgICAgICAga2VlcE1vdW50ZWQ6IHRydWUsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICAvLyBOT1RFOiBObyBcIk92ZXJ2aWV3XCIgdGFiIGhlcmUg4oCUIHRoZSBkZWZhdWx0IGVudGl0eSB2aWV3IHBhZ2UgYWxyZWFkeSByZW5kZXJzXG4gICAgICAgICAgICAgIC8vIGNvcmUgZmllbGRzIChvcGVyYXRpb24sIHN0YXR1cywgdHlwZSwgc3ViVHlwZSwgbGV2ZWwsIHRpbWluZywgZXRjLikgdmlhIGNvbHVtbnNDb25maWcuXG5cbiAgICAgICAgICAgICAgLy8gLS0tIEVycm9yOiBzdHJ1Y3R1cmVkIGJyZWFrZG93biArIHJhdyAtLS1cbiAgICAgICAgICAgICAgZXJyb3I6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0Vycm9yJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRXhjbGFtYXRpb25DaXJjbGVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZXJyb3I6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2Vycm9yLnR5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2Vycm9yLnR5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRXJyb3IgVHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnVGhlIGNsYXNzL2NvbnN0cnVjdG9yIG5hbWUgb2YgdGhlIGVycm9yJyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdlcnJvci5tZXNzYWdlJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdlcnJvci5tZXNzYWdlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ01lc3NhZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnVGhlIGVycm9yIG1lc3NhZ2UnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2Vycm9yLmNvZGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2Vycm9yLmNvZGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRXJyb3IgQ29kZScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnQXBwbGljYXRpb24gb3Igc3lzdGVtIGVycm9yIGNvZGUgKGUuZy4sIEVDT05OUkVGVVNFRCwgVkFMSURBVElPTl9GQUlMRUQpJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZXJyb3IuY29kZSc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2Vycm9yLnN0YWNrJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdlcnJvci5zdGFjaycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdTdGFjayBUcmFjZScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnY29kZScsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdGdWxsIHN0YWNrIHRyYWNlIGZyb20gdGhlIGVycm9yJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZXJyb3Iuc3RhY2snOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgLy8gLS0tIFRpbWVsaW5lOiBzcGFuIGNoZWNrcG9pbnRzIC0tLVxuICAgICAgICAgICAgICB0aW1lbGluZToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnVGltZWxpbmUnLFxuICAgICAgICAgICAgICAgIGljb246ICdOb2RlSW5kZXhPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2RhdGEuY2hlY2twb2ludHMnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLmNoZWNrcG9pbnRzJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdkYXRhLmNoZWNrcG9pbnRzJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1RpbWVsaW5lICYgQ2hlY2twb2ludHMnLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnQ2hyb25vbG9naWNhbCB0aW1lbGluZSBvZiBldmVudHMgd2l0aGluIHRoaXMgc3Bhbi4gSW5jbHVkZXMgbWFudWFsIGNoZWNrcG9pbnRzIGFuZCBhYnNvcmJlZCBjaGlsZCBvcGVyYXRpb25zLicsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAndGltZWxpbmUnLFxuICAgICAgICAgICAgICAgICAgICAgIHRpbWVsaW5lQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtb2RlOiAnbGVmdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBzaG93VGltZXN0YW1wOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGltZXN0YW1wRm9ybWF0OiAnaDptbTpzcy5TU1MgQScsXG4gICAgICAgICAgICAgICAgICAgICAgICBpdGVtTWFwcGluZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbEZpZWxkOiAnbmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcEZpZWxkOiAndHMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlRmllbGQ6ICdfdHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uRmllbGQ6ICdfZGVzY3JpcHRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAvLyAtLS0gQXVkaXQgRGF0YTogc3RydWN0dXJlZCB2aWV3IGZvciBhdWRpdC5lbnRpdHkgcmVjb3JkcyAtLS1cbiAgICAgICAgICAgICAgYXVkaXREYXRhOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBdWRpdCBEYXRhJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQXVkaXRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAzLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgLy8gT25seSBzaG93IGZvciBhdWRpdC10eXBlIHJlY29yZHMgKGF1ZGl0LmVudGl0eSwgYXVkaXQuY29tcGxpYW5jZSwgYXVkaXQuYWNjZXNzKVxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICd0YWdzLmF1ZGl0JzogeyBlcTogJ3RydWUnIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICAvLyBFbnRpdHkgdXBkYXRlOiBiZWZvcmUgLyBhZnRlciAvIGRpZmZcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLmJlZm9yZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5iZWZvcmUnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnQmVmb3JlIChPbGQgU3RhdGUpJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0VudGl0eSBzdGF0ZSBiZWZvcmUgdGhlIHVwZGF0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2RhdGEuYmVmb3JlJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5hZnRlcicsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5hZnRlcicsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdBZnRlciAoTmV3IFN0YXRlKScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnanNvbicsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdFbnRpdHkgc3RhdGUgYWZ0ZXIgdGhlIHVwZGF0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2RhdGEuYWZ0ZXInOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLmRpZmYnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuZGlmZicsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdEaWZmJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0NoYW5nZWQgZmllbGRzIHdpdGggb2xkL25ldyB2YWx1ZXMnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLmRpZmYnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgLy8gRW50aXR5IGNyZWF0ZVxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEuY3JlYXRlZCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5jcmVhdGVkJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0NyZWF0ZWQgUmVjb3JkJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0Z1bGwgZGF0YSBvZiB0aGUgbmV3bHkgY3JlYXRlZCBlbnRpdHknLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLmNyZWF0ZWQnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgLy8gRW50aXR5IGRlbGV0ZVxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEuZGVsZXRlZCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5kZWxldGVkJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0RlbGV0ZWQgUmVjb3JkJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0Z1bGwgZGF0YSBvZiB0aGUgZW50aXR5IHRoYXQgd2FzIGRlbGV0ZWQnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLmRlbGV0ZWQnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgLy8gRW50aXR5IGxpc3QgcXVlcnlcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLnF1ZXJ5JyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdkYXRhLnF1ZXJ5JyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1F1ZXJ5IEZpbHRlcnMnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2pzb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnRmlsdGVycyB1c2VkIGluIHRoZSBsaXN0L3F1ZXJ5IG9wZXJhdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2RhdGEucXVlcnknOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLnJlc3VsdENvdW50JyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdkYXRhLnJlc3VsdENvdW50JyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1Jlc3VsdCBDb3VudCcsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnTnVtYmVyIG9mIHJlY29yZHMgcmV0dXJuZWQgYnkgdGhlIHF1ZXJ5JyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5yZXN1bHRDb3VudCc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAvLyAtLS0gTm9pc2UgUmVkdWN0aW9uOiBhYnNvcmJlZCBldmVudCBzdW1tYXJ5IC0tLVxuICAgICAgICAgICAgICBub2lzZVJlZHVjdGlvbjoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnTm9pc2UgUmVkdWN0aW9uJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQ29tcHJlc3NPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA0LFxuXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5hYnNvcmJlZCc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEuYWJzb3JiZWQuY291bnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuYWJzb3JiZWQuY291bnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0Fic29yYmVkIEV2ZW50cycsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdUb3RhbCBjaGlsZCBldmVudHMgYWJzb3JiZWQgaW50byB0aGlzIHJlY29yZC4gUGVyLW9wZXJhdGlvbiBicmVha2Rvd24gaXMgaW4gdGhlIFRpbWVsaW5lIHRhYi4nLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEuYWJzb3JiZWQuc2lsZW50Q291bnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuYWJzb3JiZWQuc2lsZW50Q291bnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1NpbGVuY2VkIEV2ZW50cycsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdUb3RhbCBjaGlsZCBldmVudHMgc2lsZW50bHkgZHJvcHBlZCAoY291bnRlciBvbmx5KScsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5hYnNvcmJlZC5lcnJvcnMnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuYWJzb3JiZWQuZXJyb3JzJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0Fic29yYmVkIEVycm9ycycsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdFcnJvciBkZXRhaWxzIGZyb20gYWJzb3JiZWQgY2hpbGQgZXZlbnRzJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5hYnNvcmJlZC5lcnJvcnMnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLmFic29yYmVkLmNhdXNlZEJ5TGlua3MnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuYWJzb3JiZWQuY2F1c2VkQnlMaW5rcycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdDcm9zcy1JbnZvY2F0aW9uIExpbmtzJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0NvcnJlbGF0aW9uIElEcyBmcm9tIGFic29yYmVkIGV2ZW50cyBsaW5raW5nIHRvIG90aGVyIGludm9jYXRpb25zJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5hYnNvcmJlZC5jYXVzZWRCeUxpbmtzJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIC8vIC0tLSBUYWdzOiBzaWduYWwgYmFkZ2VzICsgcmF3IEpTT04gLS0tXG4gICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1RhZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdUYWdPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA1LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgdGFnczogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgIC8vIFN0cnVjdHVyZWQgc2lnbmFsIGJhZGdlcyAoZWFjaCBjb25kaXRpb25hbCDigJQgb25seSByZW5kZXIgd2hlbiBwcmVzZW50KVxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhZ3MuaHR0cC5zdGF0dXNfY29kZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5odHRwLnN0YXR1c19jb2RlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0hUVFAgU3RhdHVzIENvZGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5odHRwLnN0YXR1c19jb2RlJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5odHRwLnN0YXR1c19jb2RlX2NsYXNzJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICd0YWdzLmh0dHAuc3RhdHVzX2NvZGVfY2xhc3MnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnU3RhdHVzIENsYXNzJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ3RhZ3MuaHR0cC5zdGF0dXNfY29kZV9jbGFzcyc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhZ3MuZXJyb3JfY2F0ZWdvcnknLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ3RhZ3MuZXJyb3JfY2F0ZWdvcnknLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRXJyb3IgQ2F0ZWdvcnknLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5lcnJvcl9jYXRlZ29yeSc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhZ3MuY29sZF9zdGFydCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5jb2xkX3N0YXJ0JyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0NvbGQgU3RhcnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5jb2xkX3N0YXJ0JzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5fc2xvdycsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5fc2xvdycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdTbG93JyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ3RhZ3MuX3Nsb3cnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICd0YWdzLl9tZW1vcnlfcHJlc3N1cmUnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ3RhZ3MuX21lbW9yeV9wcmVzc3VyZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdNZW1vcnkgUHJlc3N1cmUnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5fbWVtb3J5X3ByZXNzdXJlJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5fdGltZW91dF9yaXNrJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICd0YWdzLl90aW1lb3V0X3Jpc2snLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnVGltZW91dCBSaXNrJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ3RhZ3MuX3RpbWVvdXRfcmlzayc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhZ3Muc3FzLmhhc19yZXRyaWVzJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICd0YWdzLnNxcy5oYXNfcmV0cmllcycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdTUVMgUmV0cmllcycsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICd0YWdzLnNxcy5oYXNfcmV0cmllcyc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhZ3MucXVlcnlfdHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5xdWVyeV90eXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1F1ZXJ5IFR5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5xdWVyeV90eXBlJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5sYW1iZGEuZnVuY3Rpb25fbmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5sYW1iZGEuZnVuY3Rpb25fbmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdMYW1iZGEgRnVuY3Rpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICd0YWdzLmxhbWJkYS5mdW5jdGlvbl9uYW1lJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhdyBmYWxsYmFjayDigJQgZnVsbCB0YWdzIEpTT04gYWx3YXlzIGF0IHRoZSBib3R0b21cbiAgICAgICAgICAgICAgICAgICAgJ3RhZ3MnLFxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAvLyAtLS0gTWV0cmljczoga2V5IHZhbHVlcyArIHJhdyBKU09OIC0tLVxuICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdNZXRyaWNzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRGFzaGJvYXJkT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IG1ldHJpY3M6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICAvLyBTdHJ1Y3R1cmVkIGtleSBtZXRyaWNzIChlYWNoIGNvbmRpdGlvbmFsKVxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ21ldHJpY3MuZHVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ21ldHJpY3MuZHVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRHVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2R1cmF0aW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICBkdXJhdGlvblVuaXQ6ICdtcycsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ21ldHJpY3MuZHVyYXRpb24nOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdtZXRyaWNzLnNwYW4uZGVwdGgnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ21ldHJpY3Muc3Bhbi5kZXB0aCcsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdTcGFuIERlcHRoJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ21ldHJpY3Muc3Bhbi5kZXB0aCc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ21ldHJpY3MuaW52b2NhdGlvbl9udW1iZXInLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ21ldHJpY3MuaW52b2NhdGlvbl9udW1iZXInLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnSW52b2NhdGlvbiAjJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ21ldHJpY3MuaW52b2NhdGlvbl9udW1iZXInOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdtZXRyaWNzLmh0dHAucmVxdWVzdF9jb250ZW50X2xlbmd0aCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnbWV0cmljcy5odHRwLnJlcXVlc3RfY29udGVudF9sZW5ndGgnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnUmVxdWVzdCBTaXplIChieXRlcyknLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ251bWJlcicsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ21ldHJpY3MuaHR0cC5yZXF1ZXN0X2NvbnRlbnRfbGVuZ3RoJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnbWV0cmljcy5odHRwLnJlc3BvbnNlX2NvbnRlbnRfbGVuZ3RoJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdtZXRyaWNzLmh0dHAucmVzcG9uc2VfY29udGVudF9sZW5ndGgnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnUmVzcG9uc2UgU2l6ZSAoYnl0ZXMpJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdtZXRyaWNzLmh0dHAucmVzcG9uc2VfY29udGVudF9sZW5ndGgnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdtZXRyaWNzLm5vZGUuaGVhcF91c2VkX21iJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdtZXRyaWNzLm5vZGUuaGVhcF91c2VkX21iJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0hlYXAgVXNlZCAoTUIpJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdtZXRyaWNzLm5vZGUuaGVhcF91c2VkX21iJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnbWV0cmljcy5sYW1iZGEucmVtYWluaW5nX3RpbWVfbXMnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ21ldHJpY3MubGFtYmRhLnJlbWFpbmluZ190aW1lX21zJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0xhbWJkYSBSZW1haW5pbmcgVGltZScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnZHVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGR1cmF0aW9uVW5pdDogJ21zJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnbWV0cmljcy5sYW1iZGEucmVtYWluaW5nX3RpbWVfbXMnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgLy8gUmF3IGZhbGxiYWNrIOKAlCBmdWxsIG1ldHJpY3MgSlNPTiBhbHdheXMgYXQgdGhlIGJvdHRvbVxuICAgICAgICAgICAgICAgICAgICAnbWV0cmljcycsXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIC8vIC0tLSBFdmVudCBQYXlsb2FkOiByYXcgZGF0YSAtLS1cbiAgICAgICAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnUGF5bG9hZCcsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0ZpbGVUZXh0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNyxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGRhdGE6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnZGF0YScgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAvLyAtLS0gQWN0b3I6IHN0cnVjdHVyZWQgKyByYXcgLS0tXG4gICAgICAgICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBY3RvcicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1VzZXJPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA4LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgYWN0b3I6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2FjdG9yVHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnYWN0b3IudHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdBY3RvciBUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2FjdG9yLnR5cGUnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdhY3RvcklkJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdhY3Rvci5pZCcsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdBY3RvciBJRCcsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAndGV4dCcsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2FjdG9yLmlkJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnYWN0b3JFbWFpbCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnYWN0b3IuZW1haWwnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRW1haWwnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdhY3Rvci5lbWFpbCc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2FjdG9yTmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnYWN0b3IubmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnYWN0b3IubmFtZSc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2FjdG9yR3JvdXBzJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdhY3Rvci5ncm91cHMnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnR3JvdXBzJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnYWN0b3IuZ3JvdXBzJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhdyBmYWxsYmFjayDigJQgYWx3YXlzIHNob3dzIGZ1bGwgYWN0b3Igb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgICdhY3RvcicsXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIC8vIC0tLSBSYXc6IGFsbCByZW1haW5pbmcgZmllbGRzLCBhbHdheXMgdmlzaWJsZSAtLS1cbiAgICAgICAgICAgICAgcmF3OiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdSYXcgLyBPdGhlcicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0NvZGVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA5LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgICdhdHRyaWJ1dGVzJyxcbiAgICAgICAgICAgICAgICAgICAgJ21ldGFkYXRhJyxcbiAgICAgICAgICAgICAgICAgICAgJ2NvbnRleHQnLFxuICAgICAgICAgICAgICAgICAgICAndHRsJyxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgICAvLyBHUk9VUCAyOiBISUVSQVJDSFkgJiBUUkFDRSAoc3BhbiB0cmVlIG5hdmlnYXRpb24pXG4gICAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdoaWVyYXJjaHktcmVsYXRpb25zJyxcbiAgICAgICAgICAgIGxhYmVsOiAnSGllcmFyY2h5ICYgVHJhY2UnLFxuICAgICAgICAgICAgaWNvbjogJ0FwYXJ0bWVudE91dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IHRydWUsXG4gICAgICAgICAgICBsYXp5TG9hZDogdHJ1ZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiBmYWxzZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIGhpZXJhcmNoeUluZm86IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0hpZXJhcmNoeSBJbmZvJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnTm9kZUluZGV4T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMCxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICAnaXNSb290JyxcbiAgICAgICAgICAgICAgICAgICAgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgICAgICAgICAgICdjb3JyZWxhdGlvbklkJyxcbiAgICAgICAgICAgICAgICAgICAgJ2NhdXNlZEJ5JyxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgcGFyZW50U3Bhbjoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnUGFyZW50IFNwYW4nLFxuICAgICAgICAgICAgICAgIGljb246ICdBcnJvd1VwT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmc6IHsgc291cmNlOiAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJywgdGFyZ2V0OiAnaWQnIH0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHNpYmxpbmdTcGFuczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnU2libGluZyBTcGFucycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0Jsb2NrT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXE6ICc6cGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyB9LFxuICAgICAgICAgICAgICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogeyBuZTogJzpvYnNlcnZhYmlsaXR5TG9nSWQnIH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ090aGVyIHNwYW5zIGF0IHRoZSBzYW1lIGhpZXJhcmNoeSBsZXZlbCAoc2FtZSBwYXJlbnQpJyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY2hpbGRTcGFuczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ2hpbGQgU3BhbnMnLFxuICAgICAgICAgICAgICAgIGljb246ICdCcmFuY2hlc091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXE6ICc6b2JzZXJ2YWJpbGl0eUxvZ0lkJyB9IH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICByb290U3Bhbjoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnUm9vdCBvZiBIaWVyYXJjaHknLFxuICAgICAgICAgICAgICAgIGljb246ICdHYXRld2F5T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNCxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGlzUm9vdDogeyBlcTogZmFsc2UgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICBjb3JyZWxhdGlvbklkOiB7IGVxOiAnOmNvcnJlbGF0aW9uSWQnIH0sXG4gICAgICAgICAgICAgICAgICAgICAgaXNSb290OiB7IGVxOiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1RoZSByb290IHNwYW4gdGhhdCBzdGFydGVkIHRoaXMgdHJhY2UgaGllcmFyY2h5JyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgdHJhY2VMb2dzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBbGwgaW4gVGhpcyBUcmFjZScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1NoYXJlQWx0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGNvcnJlbGF0aW9uSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGNvcnJlbGF0aW9uSWQ6IHsgZXE6ICc6Y29ycmVsYXRpb25JZCcgfSB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBbGwgZXZlbnRzIGluIHRoaXMgTGFtYmRhIGludm9jYXRpb24nLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBjYXVzZWRCeVRyYWNlOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdDYXVzaW5nIFJlcXVlc3QgVHJhY2UnLFxuICAgICAgICAgICAgICAgIGljb246ICdMaW5rT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogOCxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGNhdXNlZEJ5OiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBjb3JyZWxhdGlvbklkOiB7IGVxOiAnOmNhdXNlZEJ5JyB9IH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1ZpZXcgdGhlIG9yaWdpbmFsIHJlcXVlc3QgdHJhY2UgdGhhdCBjYXVzZWQgdGhpcyBldmVudCcsXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGNhdXNlZEV2ZW50czoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRXZlbnRzIENhdXNlZCBCeSBUaGlzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQXBpT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogOSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGNhdXNlZEJ5OiB7IGVxOiAnOmNvcnJlbGF0aW9uSWQnIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRXZlbnRzIGluIG90aGVyIGludm9jYXRpb25zIGNhdXNlZCBieSB0aGlzIHJlcXVlc3QnLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBzYW1lRXJyb3JQYXR0ZXJuOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdTYW1lIEVycm9yIFBhdHRlcm4nLFxuICAgICAgICAgICAgICAgIGljb246ICdCdWdPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA5LjUsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBmaW5nZXJwcmludDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgZmluZ2VycHJpbnQ6IHsgZXE6ICc6ZmluZ2VycHJpbnQnIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQWxsIG9jY3VycmVuY2VzIG9mIHRoaXMgc2FtZSBlcnJvciBwYXR0ZXJuIGFjcm9zcyB0aW1lJyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgcmVsYXRlZFRyYWNlczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnUmVsYXRlZCBUcmFjZXMnLFxuICAgICAgICAgICAgICAgIGljb246ICdDbHVzdGVyT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMTAsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyByZWxhdGVkVHJhY2VzOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ3JlbGF0ZWRUcmFjZXMnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgICAvLyBHUk9VUCAzOiBSRUxBVEVEIExPR1MgKEVudGl0eSAmIFNvdXJjZSBhbmFseXRpY3MpXG4gICAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdyZWxhdGVkLWFuYWx5dGljcycsXG4gICAgICAgICAgICBsYWJlbDogJ1JlbGF0ZWQgTG9ncycsXG4gICAgICAgICAgICBpY29uOiAnRnVuZE91dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMyxcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IHRydWUsXG4gICAgICAgICAgICBsYXp5TG9hZDogZmFsc2UsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogZmFsc2UsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBieUVudGl0eToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRW50aXR5IExvZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdEYXRhYmFzZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlbnRpdHlOYW1lOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICc6ZW50aXR5TmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgZW50aXR5SWQ6ICc6ZW50aXR5SWQnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYnlFbnRpdHlUeXBlOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFbnRpdHkgVHlwZSBMb2dzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQXBwc3RvcmVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZW50aXR5TmFtZTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgZW50aXR5TmFtZTogJzplbnRpdHlOYW1lJyB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYnlTb3VyY2U6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1NvdXJjZSBMb2dzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQ29kZVNhbmRib3hPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAzLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgc291cmNlOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBzb3VyY2U6ICc6c291cmNlJyB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgYXR0cmlidXRlczoge1xuICAgIC8vID09PSBJREVOVElUWSA9PT1cbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICAvLyAxMjgtYml0IGZhbGxiYWNrIGZvciBtYW51YWwvYWRtaW4tY3JlYXRlZCByZWNvcmRzIChmcmFtZXdvcmsgZ2VuZXJhbGx5IHN1cHBsaWVzIG9ic2VydmFiaWxpdHlMb2dJZCBleHBsaWNpdGx5KS5cbiAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbUJ5dGVzKDE2KS50b1N0cmluZygnaGV4JyksXG4gICAgICBsYWJlbDogJ0xvZyBJRCcsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdQYXJlbnQgTG9nIElEJyxcbiAgICAgIGhlbHBUZXh0OiAnUmVmZXJlbmNlIHRvIHBhcmVudCBzcGFuIGZvciBoaWVyYXJjaGljYWwgdHJhY2luZycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBTZWxmLXJlZmVyZW50aWFsIHJlbGF0aW9uIHRvIHBhcmVudCBvYnNlcnZhYmlsaXR5IGxvZ1xuICAgICAgcmVsYXRpb246IHtcbiAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICB0eXBlOiAnbWFueS10by1vbmUnLFxuICAgICAgICBpZGVudGlmaWVyczogeyBzb3VyY2U6ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnLCB0YXJnZXQ6ICdvYnNlcnZhYmlsaXR5TG9nSWQnIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gQ29tcHV0ZWQgZmllbGQ6IHRydWUgaWYgdGhpcyBpcyBhIHJvb3Qgc3BhbiAobm8gcGFyZW50KVxuICAgIC8vIFVzZWQgZm9yIGVmZmljaWVudCBHU0kgcXVlcmllcyBpbnN0ZWFkIG9mIG5vdEV4aXN0cyBmaWx0ZXJcbiAgICBpc1Jvb3Q6IHtcbiAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgIGxhYmVsOiAnSXMgUm9vdCcsXG4gICAgICBoZWxwVGV4dDogJ1RydWUgaWYgdGhpcyBpcyBhIHJvb3Qgc3BhbiAobm8gcGFyZW50KScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICB3YXRjaDogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdLFxuICAgICAgLy8gU2V0IHRvIHRydWUgd2hlbiBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgaXMgbnVsbC91bmRlZmluZWRcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkPzogc3RyaW5nIH0pID0+XG4gICAgICAgICFkYXRhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IHRydWUsICAvLyBEZWZhdWx0IHRvIHRydWUgaWYgbm8gcGFyZW50IHNwZWNpZmllZFxuICAgIH0sXG4gICAgLy8gTk9URTogY29ycmVsYXRpb25JZCBpcyBSRVFVSVJFRCBhbmQgaGFzIE5PIGRlZmF1bHQuXG4gICAgLy8gSWYgeW91J3JlIGdldHRpbmcgdmFsaWRhdGlvbiBlcnJvcnMsIGVuc3VyZSBjb250ZXh0IGlzIGVzdGFibGlzaGVkIChhdXRvIGluIGNvbnRyb2xsZXJzKS5cbiAgICAvLyBIYXZpbmcgYSBkZWZhdWx0IGhlcmUgd291bGQgaGlkZSBidWdzIHdoZXJlIGNvbnRleHQgd2Fzbid0IHByb3Blcmx5IGVzdGFibGlzaGVkLlxuICAgIGNvcnJlbGF0aW9uSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBsYWJlbDogJ0NvcnJlbGF0aW9uIElEJyxcbiAgICAgIGhlbHBUZXh0OiAnVW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBlbnRpcmUgcmVxdWVzdC90cmFjZScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBOTyBERUZBVUxUIC0gbXVzdCBiZSBwcm9wYWdhdGVkIGZyb20gY29udGV4dFxuICAgICAgLy8gTGluayB0byBmaWx0ZXJlZCBsaXN0IHNob3dpbmcgYWxsIGxvZ3MgaW4gdGhlIHNhbWUgdHJhY2VcbiAgICAgIGlzTGluazogdHJ1ZSxcbiAgICAgIGxpbmtDb25maWc6IHtcbiAgICAgICAgcm91dGVQYXR0ZXJuOiAnL2xpc3Qtb2JzZXJ2YWJpbGl0eWxvZz9jb3JyZWxhdGlvbklkLmVxPTpjb3JyZWxhdGlvbklkJyxcbiAgICAgICAgZGlzcGxheVRleHQ6ICdWaWV3IENvcnJlbGF0ZWQgTG9ncycsXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gQ3Jvc3MtaW52b2NhdGlvbiB0cmFjaW5nOiBDb3JyZWxhdGlvbiBJRCB0aGF0IGNhdXNlZCB0aGlzIGV2ZW50XG4gICAgLy8gRXhhbXBsZTogRHluYW1vREIgc3RyZWFtIGF1ZGl0IGNhdXNlZCBieSBvcmlnaW5hbCBBUEkgcmVxdWVzdFxuICAgIGNhdXNlZEJ5OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIGxhYmVsOiAnQ2F1c2VkIEJ5JyxcbiAgICAgIGhlbHBUZXh0OiAnQ29ycmVsYXRpb24gSUQgdGhhdCBjYXVzZWQgdGhpcyBldmVudCAoY3Jvc3MtaW52b2NhdGlvbiB0cmFjaW5nKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc0xpbms6IHRydWUsXG4gICAgICBsaW5rQ29uZmlnOiB7XG4gICAgICAgIHJvdXRlUGF0dGVybjogJy9saXN0LW9ic2VydmFiaWxpdHlsb2c/Y29ycmVsYXRpb25JZC5lcT06Y2F1c2VkQnknLFxuICAgICAgICBkaXNwbGF5VGV4dDogJ1ZpZXcgQ2F1c2luZyBSZXF1ZXN0JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBBbGwgcmVsYXRlZCB0cmFjZSBJRHMgZm9yIGNvbXBsZXggd29ya2Zsb3dzXG4gICAgcmVsYXRlZFRyYWNlczoge1xuICAgICAgdHlwZTogJ2xpc3QnLFxuICAgICAgaXRlbXM6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIGxhYmVsOiAnUmVsYXRlZCBUcmFjZXMnLFxuICAgICAgaGVscFRleHQ6ICdBbGwgcmVsYXRlZCBjb3JyZWxhdGlvbiBJRHMgZm9yIGNvbXBsZXggd29ya2Zsb3dzIHNwYW5uaW5nIG11bHRpcGxlIGludm9jYXRpb25zJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogZmFsc2UsIC8vIExpc3QgZmllbGQsIG5vdCBmaWx0ZXJhYmxlXG4gICAgfSxcblxuICAgIC8vID09PSBDTEFTU0lGSUNBVElPTiA9PT1cbiAgICB0eXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgbGFiZWw6ICdUeXBlJyxcbiAgICAgIGhlbHBUZXh0OiAnRXZlbnQgdHlwZSAoc3BhbiwgYXVkaXQuZW50aXR5LCBsb2csIG1ldHJpYywgZXRjLiknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHN1YlR5cGU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdTdWItVHlwZScsXG4gICAgICBoZWxwVGV4dDogJ0FkZGl0aW9uYWwgdHlwZSBjbGFzc2lmaWNhdGlvbicsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICAvLyBOT1RFOiBsZXZlbCBpcyBSRVFVSVJFRCBhbmQgaGFzIE5PIGRlZmF1bHQuXG4gICAgLy8gVGhlIG9ic2VydmVyIE1VU1Qgc3BlY2lmeSB0aGUgbGV2ZWwgZXhwbGljaXRseS5cbiAgICBsZXZlbDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGxhYmVsOiAnTGV2ZWwnLFxuICAgICAgaGVscFRleHQ6ICdTZXZlcml0eSBsZXZlbDogZXJyb3IsIHdhcm4sIGluZm8sIGRlYnVnJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgICAvLyBOTyBERUZBVUxUIC0gbXVzdCBiZSBzcGVjaWZpZWQgYnkgb2JzZXJ2ZXJcbiAgICB9LFxuXG4gICAgLy8gPT09IEVOVElUWSBDT05URVhUID09PVxuICAgIGVudGl0eU5hbWU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdFbnRpdHkgTmFtZScsXG4gICAgICBoZWxwVGV4dDogJ05hbWUgb2YgdGhlIGVudGl0eSB0aGlzIGV2ZW50IHJlbGF0ZXMgdG8nLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIGVudGl0eUlkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnRW50aXR5IElEJyxcbiAgICAgIGhlbHBUZXh0OiAnSUQgb2YgdGhlIHNwZWNpZmljIGVudGl0eSBpbnN0YW5jZScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBEZWZhdWx0IHRvICdfJyB3aGVuIGVudGl0eU5hbWUgaXMgc2V0IGJ1dCBlbnRpdHlJZCBpcyBub3QgKHJlcXVpcmVkIGZvciBieUVudGl0eSBjb21wb3NpdGUgaW5kZXgpXG4gICAgICB3YXRjaDogWyAnZW50aXR5TmFtZScgXSxcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgZW50aXR5TmFtZT86IHN0cmluZzsgZW50aXR5SWQ/OiBzdHJpbmcgfSkgPT5cbiAgICAgICAgZGF0YS5lbnRpdHlJZCB8fCAoZGF0YS5lbnRpdHlOYW1lID8gJ18nIDogdW5kZWZpbmVkKSxcbiAgICAgIC8vIER5bmFtaWMgbGluayB0byB0aGUgcmVsYXRlZCBlbnRpdHkgYmFzZWQgb24gZW50aXR5TmFtZVxuICAgICAgbGlua0NvbmZpZzoge1xuICAgICAgICByb3V0ZVBhdHRlcm46ICcvdmlldy06ZW50aXR5TmFtZS86ZW50aXR5SWQnLFxuICAgICAgICBkaXNwbGF5VGV4dDogJ1ZpZXcge2VudGl0eU5hbWV9JyxcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIC8vID09PSBPUEVSQVRJT04gPT09XG4gICAgb3BlcmF0aW9uOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnT3BlcmF0aW9uJyxcbiAgICAgIGhlbHBUZXh0OiAnVGhlIG9wZXJhdGlvbiBiZWluZyBwZXJmb3JtZWQgKGUuZy4sIGNyZWF0ZSwgdXBkYXRlLCBxdWVyeSknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHN0YXR1czoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ1N0YXR1cycsXG4gICAgICBoZWxwVGV4dDogJ09wZXJhdGlvbiBzdGF0dXMgKGUuZy4sIHN0YXJ0ZWQsIGNvbXBsZXRlZCwgZmFpbGVkKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICBzdWNjZXNzOiB7XG4gICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICBsYWJlbDogJ1N1Y2Nlc3MnLFxuICAgICAgaGVscFRleHQ6ICdXaGV0aGVyIHRoZSBvcGVyYXRpb24gY29tcGxldGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBmaWVsZFR5cGU6ICdib29sZWFuJyxcbiAgICAgIGJvb2xlYW5MYWJlbHM6IHsgdHJ1ZTogJ1N1Y2Nlc3MnLCBmYWxzZTogJ0ZhaWxlZCcgfSxcbiAgICB9LFxuXG4gICAgLy8gPT09IFRJTUlORyA9PT1cbiAgICB0aW1lc3RhbXBNczoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KCksXG4gICAgICBsYWJlbDogJ1RpbWVzdGFtcCcsXG4gICAgICBoZWxwVGV4dDogJ0V2ZW50IHRpbWVzdGFtcCBpbiBtaWxsaXNlY29uZHMgc2luY2UgZXBvY2gnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICAgIGZpZWxkVHlwZTogJ2RhdGV0aW1lJyxcbiAgICB9LFxuICAgIGR1cmF0aW9uTXM6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgbGFiZWw6ICdEdXJhdGlvbiAobXMpJyxcbiAgICAgIGhlbHBUZXh0OiAnT3BlcmF0aW9uIGR1cmF0aW9uIGluIG1pbGxpc2Vjb25kcycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc1NvcnRhYmxlOiB0cnVlLFxuICAgICAgZmllbGRUeXBlOiAnZHVyYXRpb24nLFxuICAgICAgZHVyYXRpb25Vbml0OiAnbXMnLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gU09VUkNFICYgVEFHUyA9PT1cbiAgICBzb3VyY2U6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdTb3VyY2UnLFxuICAgICAgaGVscFRleHQ6ICdTb3VyY2Ugb2YgdGhlIGV2ZW50IChlLmcuLCBzZXJ2aWNlIG5hbWUsIGZ1bmN0aW9uIG5hbWUpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIC8vIE5PVEU6IHRhZ3MsIG1ldHJpY3MsIGF0dHJpYnV0ZXMsIGRhdGEsIG1ldGFkYXRhLCBhY3RvciwgY29udGV4dCBhbGwgdXNlIHByb3BlcnRpZXM6e31cbiAgICAvLyBUaGlzIGlzIEJZIERFU0lHTiAtIHRoaXMgaXMgYSBVTklWRVJTQUwgc3RvcmUgZm9yIEFMTCBldmVudCB0eXBlcyAoc3BhbiwgYXVkaXQsXG4gICAgLy8gbWV0cmljLCB3b3JrZmxvdywgZGVjaXNpb24sIGFjY2VzcywgbG9nKS4gRWFjaCBoYXMgY29tcGxldGVseSBkaWZmZXJlbnQgcGF5bG9hZHMuXG4gICAgLy8gRWxlY3Ryb0RCIHByb3BlcnRpZXM6e30gPSBhY2NlcHQgYW55IG1hcCBzdHJ1Y3R1cmUgYXQgcnVudGltZS5cbiAgICB0YWdzOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnVGFncycsXG4gICAgICBoZWxwVGV4dDogJ0tleS12YWx1ZSB0YWdzIGZvciBjYXRlZ29yaXphdGlvbicsXG4gICAgfSxcblxuICAgIC8vID09PSBQQVlMT0FEUyAoc2NoZW1hbGVzcyBieSBkZXNpZ24gLSBkaWZmZXJlbnQgZXZlbnQgdHlwZXMgaGF2ZSBkaWZmZXJlbnQgc3RydWN0dXJlcykgPT09XG4gICAgbWV0cmljczoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ01ldHJpY3MnLFxuICAgICAgaGVscFRleHQ6ICdOdW1lcmljYWwgbWV0cmljcyBhbmQgbWVhc3VyZW1lbnRzJyxcbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdBdHRyaWJ1dGVzJyxcbiAgICAgIGhlbHBUZXh0OiAnQWRkaXRpb25hbCBzdHJ1Y3R1cmVkIGF0dHJpYnV0ZXMnLFxuICAgIH0sXG4gICAgZGF0YToge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0RhdGEnLFxuICAgICAgaGVscFRleHQ6ICdFdmVudC1zcGVjaWZpYyBkYXRhIHBheWxvYWQnLFxuICAgICAgY29tcHJlc3NlZDogeyB0aHJlc2hvbGQ6IDUwICogMTAyNCB9LCAvLyBGcmFtZXdvcmsgYXV0by1jb21wcmVzc2VzIGlmID4gNTBLQlxuICAgIH0sXG4gICAgbWV0YWRhdGE6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdNZXRhZGF0YScsXG4gICAgICBoZWxwVGV4dDogJ0FkZGl0aW9uYWwgbWV0YWRhdGEgYWJvdXQgdGhlIGV2ZW50JyxcbiAgICAgIGNvbXByZXNzZWQ6IHRydWUsIC8vIEZyYW1ld29yayBhdXRvLWNvbXByZXNzZXMgaWYgPiAxMEtCXG4gICAgfSxcbiAgICBlcnJvcjoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0Vycm9yJyxcbiAgICAgIGhlbHBUZXh0OiAnRXJyb3IgZGV0YWlscyBpZiB0aGUgb3BlcmF0aW9uIGZhaWxlZCcsXG4gICAgICAvLyBTdHJ1Y3R1cmU6IHsgdHlwZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmcsIHN0YWNrPzogc3RyaW5nLCBjb2RlPzogc3RyaW5nIH1cbiAgICB9LFxuICAgIGZpbmdlcnByaW50OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnRXJyb3IgRmluZ2VycHJpbnQnLFxuICAgICAgaGVscFRleHQ6ICdEZXRlcm1pbmlzdGljIGhhc2ggZm9yIGdyb3VwaW5nIHNhbWUgZXJyb3JzIGFjcm9zcyBpbnZvY2F0aW9ucyAoMTYgaGV4IGNoYXJzIGZyb20gU0hBLTI1NiknLFxuICAgICAgaXNMaW5rOiB0cnVlLFxuICAgICAgbGlua0NvbmZpZzoge1xuICAgICAgICByb3V0ZVBhdHRlcm46ICcvbGlzdC1vYnNlcnZhYmlsaXR5bG9nP2ZpbmdlcnByaW50LmVxPTpmaW5nZXJwcmludCcsXG4gICAgICAgIGRpc3BsYXlUZXh0OiAnVmlldyBTYW1lIEVycm9yIFBhdHRlcm4nLFxuICAgICAgfSxcbiAgICB9LFxuICAgIC8vID09PSBBQ1RPUiAoc3RvcmVkIGFzLWlzIGZyb20gZXhpc3RpbmcgQWN0b3IgdHlwZSkgPT09XG4gICAgYWN0b3I6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdBY3RvcicsXG4gICAgICBoZWxwVGV4dDogJ0luZm9ybWF0aW9uIGFib3V0IHdobyB0cmlnZ2VyZWQgdGhpcyBldmVudCcsXG4gICAgfSxcblxuICAgIC8vIE5PVEU6IEFic29yYmVkIGRhdGEgKG5vaXNlIHJlZHVjdGlvbiBzdW1tYXJpZXMpIGxpdmVzIGluc2lkZSBgZGF0YS5hYnNvcmJlZGAg4oCUIG5vIHNlcGFyYXRlIGF0dHJpYnV0ZS5cbiAgICAvLyBUaGUgYGRhdGFgIGZpZWxkIGFscmVhZHkgaGFzIGNvbXByZXNzaW9uIGNvbmZpZ3VyZWQsIHNvIGFic29yYmVkIGRhdGEgaXMgY292ZXJlZC5cblxuICAgIC8vID09PSBDT05URVhUID09PVxuICAgIGNvbnRleHQ6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdDb250ZXh0JyxcbiAgICAgIGhlbHBUZXh0OiAnRXhlY3V0aW9uIGNvbnRleHQgYW5kIGVudmlyb25tZW50IGluZm9ybWF0aW9uJyxcbiAgICB9LFxuXG4gICAgLy8gPT09IFRUTCA9PT1cbiAgICAvLyBUaWVyZWQgcmV0ZW50aW9uOiBUVEwgdmFyaWVzIGJ5IHNldmVyaXR5IGxldmVsLlxuICAgIC8vICAgZXJyb3IvY3JpdGljYWwgLT4gOTAgZGF5cywgd2FybiAtPiA2MCBkYXlzLCBpbmZvIC0+IDMwIGRheXMsIGRlYnVnL3RyYWNlIC0+IDcgZGF5c1xuICAgIHR0bDoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICBkZWZhdWx0OiAoKSA9PiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICg5MCAqIDI0ICogNjAgKiA2MCksIC8vIDkwIGRheXMgZmFsbGJhY2tcbiAgICAgIHdhdGNoOiBbICdsZXZlbCcgXSxcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgbGV2ZWw/OiBzdHJpbmcgfSkgPT4ge1xuICAgICAgICBjb25zdCBTRUNPTkRTX1BFUl9EQVkgPSAyNCAqIDYwICogNjA7XG4gICAgICAgIGNvbnN0IG5vd1NlY29uZHMgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcbiAgICAgICAgY29uc3QgcmV0ZW50aW9uRGF5czogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHtcbiAgICAgICAgICBjcml0aWNhbDogOTAsXG4gICAgICAgICAgZXJyb3I6IDkwLFxuICAgICAgICAgIHdhcm46IDYwLFxuICAgICAgICAgIGluZm86IDMwLFxuICAgICAgICAgIGRlYnVnOiA3LFxuICAgICAgICAgIHRyYWNlOiA3LFxuICAgICAgICB9O1xuICAgICAgICBjb25zdCBkYXlzID0gcmV0ZW50aW9uRGF5c1sgZGF0YS5sZXZlbCA/PyAnJyBdID8/IDkwO1xuICAgICAgICByZXR1cm4gbm93U2Vjb25kcyArIChkYXlzICogU0VDT05EU19QRVJfREFZKTtcbiAgICAgIH0sXG4gICAgICBsYWJlbDogJ1RUTCcsXG4gICAgICBoZWxwVGV4dDogJ1RpZXJlZCByZXRlbnRpb246IGVycm9yL2NyaXRpY2FsIDkwZCwgd2FybiA2MGQsIGluZm8gMzBkLCBkZWJ1Zy90cmFjZSA3ZCcsXG4gICAgICBmaWVsZFR5cGU6ICd0dGwnLFxuICAgICAgdHRsVW5pdDogJ3NlY29uZHMnLFxuICAgICAgdHRsRm9ybWF0OiAnYXV0bycsXG4gICAgICBpc1Zpc2libGU6IHRydWUsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgfSxcbiAgfSxcbiAgaW5kZXhlczoge1xuICAgIC8vID09PSBJTkRFWCBERVNJR04gTk9URVMgPT09XG4gICAgLy8gMS4gUHJpbWFyeSBpbmRleCBoYXMgbm8gc29ydCBrZXkgLSBvbmx5IGZvciBzaW5nbGUtaXRlbSBsb29rdXBzIGJ5IElEXG4gICAgLy8gMi4gR1NJNyAoYWxsUmVjb3JkcykgcHJvdmlkZXMgc29ydGVkIGxpc3RpbmcgZm9yIHVuZmlsdGVyZWQgcXVlcmllc1xuICAgIC8vICAgIC0gVXNlcyBjb25zdGFudCBQSyB0ZW1wbGF0ZSB0byBncm91cCBhbGwgcmVjb3Jkc1xuICAgIC8vICAgIC0gU29ydGVkIGJ5IHRpbWVzdGFtcE1zIGZvciBlZmZpY2llbnQgY2hyb25vbG9naWNhbCBsaXN0aW5nXG4gICAgLy8gICAgLSBUcmFkZS1vZmY6IEhvdCBwYXJ0aXRpb24sIGJ1dCBhY2NlcHRhYmxlIGZvciBvYnNlcnZhYmlsaXR5IGxvZ3Mgd2l0aCBUVExcbiAgICAvLyAzLiBBbGwgb3RoZXIgR1NJcyBhcmUgZm9yIGZpbHRlcmVkIHF1ZXJpZXMgKGJ5IHRyYWNlLCBwYXJlbnQsIHR5cGUsIGxldmVsLCBldGMuKVxuXG4gICAgLy8gUHJpbWFyeSAtIGJ5IG9ic2VydmFiaWxpdHlMb2dJZFxuICAgIHByaW1hcnk6IHtcbiAgICAgIHBrOiB7IGZpZWxkOiAncGsnLCBjb21wb3NpdGU6IFsgJ29ic2VydmFiaWxpdHlMb2dJZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdzaycsIGNvbXBvc2l0ZTogW10gfSxcbiAgICB9LFxuICAgIC8vIEdTSTEgLSBieSB0cmFjZSAtIGdldCBhbGwgZXZlbnRzIGluIGEgcmVxdWVzdC90cmFjZVxuICAgIGJ5VHJhY2U6IHtcbiAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTFwaycsIGNvbXBvc2l0ZTogWyAnY29ycmVsYXRpb25JZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kxc2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0kyIC0gYnkgcGFyZW50IC0gZ2V0IGNoaWxkcmVuLCByZWNvbnN0cnVjdCBzcGFuIGhpZXJhcmNoeVxuICAgIGJ5UGFyZW50OiB7XG4gICAgICBpbmRleDogJ2dzaTInLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2kycGsnLCBjb21wb3NpdGU6IFsgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kyc2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0kzIC0gYnkgdHlwZSAtIGZpbHRlciBieSBldmVudCB0eXBlIChzcGFuLiosIGF1ZGl0LiosIGxvZywgbWV0cmljKVxuICAgIGJ5VHlwZToge1xuICAgICAgaW5kZXg6ICdnc2kzJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpM3BrJywgY29tcG9zaXRlOiBbICd0eXBlJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTNzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTQgLSBieSBsZXZlbCAtIGZpbmQgZXJyb3JzL3dhcm5pbmdzIHF1aWNrbHlcbiAgICBieUxldmVsOiB7XG4gICAgICBpbmRleDogJ2dzaTQnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k0cGsnLCBjb21wb3NpdGU6IFsgJ2xldmVsJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTRzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTUgLSBieSBlbnRpdHkgdHlwZSAtIFwiYWxsIE9yZGVyIGV2ZW50c1wiLCBcImFsbCBVc2VyIGV2ZW50c1wiXG4gICAgYnlFbnRpdHlUeXBlOiB7XG4gICAgICBpbmRleDogJ2dzaTUnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k1cGsnLCBjb21wb3NpdGU6IFsgJ2VudGl0eU5hbWUnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNXNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNiAtIGJ5IGVudGl0eSBpbnN0YW5jZSAtIFwiYWxsIGV2ZW50cyBmb3IgT3JkZXI6MTIzXCJcbiAgICBieUVudGl0eToge1xuICAgICAgaW5kZXg6ICdnc2k2JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNnBrJywgY29tcG9zaXRlOiBbICdlbnRpdHlOYW1lJywgJ2VudGl0eUlkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTZzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTcgLSBhbGwgcmVjb3JkcyBieSB0aW1lc3RhbXAgLSBmb3IgZWZmaWNpZW50IHNvcnRlZCBsaXN0aW5nIG9mIGFsbCBldmVudHNcbiAgICAvLyBVc2VzIGNvbnN0YW50IHBhcnRpdGlvbiBrZXkgdG8gZ3JvdXAgYWxsIHJlY29yZHMgdG9nZXRoZXJcbiAgICBhbGxSZWNvcmRzOiB7XG4gICAgICBpbmRleDogJ2dzaTcnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k3cGsnLCBjb21wb3NpdGU6IFtdLCB0ZW1wbGF0ZTogJ0FMTF9FVkVOVFMnIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTdzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTggLSBieSBjYXVzZWRCeSAtIGZpbmQgYWxsIGV2ZW50cyBjYXVzZWQgYnkgYSBzcGVjaWZpYyByZXF1ZXN0IChjcm9zcy1pbnZvY2F0aW9uIHRyYWNpbmcpXG4gICAgYnlDYXVzZWRCeToge1xuICAgICAgaW5kZXg6ICdnc2k4JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpOHBrJywgY29tcG9zaXRlOiBbICdjYXVzZWRCeScgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k4c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k5IC0gYnkgZmluZ2VycHJpbnQgLSBncm91cCBzYW1lIGVycm9ycyBhY3Jvc3MgaW52b2NhdGlvbnNcbiAgICBieUZpbmdlcnByaW50OiB7XG4gICAgICBpbmRleDogJ2dzaTknLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k5cGsnLCBjb21wb3NpdGU6IFsgJ2ZpbmdlcnByaW50JyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTlzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEZvciBzb3VyY2UvYWN0b3IvdGVuYW50IHF1ZXJpZXMgLSB1c2Ugc2VhcmNoIGVuZ2luZSBzeW5jXG4gIH0sXG59IGFzIGNvbnN0KTtcblxuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYSA9IHR5cGVvZiBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hO1xuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVR5cGUgPSBFbnRpdHlUeXBlRnJvbVNjaGVtYTxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPjtcbmV4cG9ydCB0eXBlIE9ic2VydmFiaWxpdHlMb2dSZWNvcmRUeXBlID0gRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT47Il19