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
                    // === BY SIGNALS ===
                    {
                        id: 'signals-group',
                        label: 'Signals',
                        segments: [
                            { id: 'all-signals', label: 'All', filters: {}, default: true },
                            { id: 'cold-starts', label: 'Cold Starts', icon: 'ThunderboltOutlined', filters: { 'tags.cold_start': { eq: 'true' } } },
                            { id: 'slow-requests', label: 'Slow', icon: 'ClockCircleOutlined', filters: { 'tags._slow': { eq: 'true' } }, badgeStatus: 'warning' },
                            { id: 'has-errors', label: 'Failed', icon: 'CloseCircleOutlined', filters: { success: { eq: 'false' } }, badgeStatus: 'error' },
                            { id: 'status-4xx', label: '4xx', icon: 'WarningOutlined', filters: { 'tags.http.status_code_class': { eq: '4xx' } }, badgeStatus: 'warning' },
                            { id: 'status-5xx', label: '5xx', icon: 'CloseCircleOutlined', filters: { 'tags.http.status_code_class': { eq: '5xx' } }, badgeStatus: 'error' },
                            { id: 'retries', label: 'Retries', icon: 'ReloadOutlined', filters: { 'tags.sqs.has_retries': { eq: 'true' } }, badgeStatus: 'warning' },
                            { id: 'memory-pressure', label: 'Memory', icon: 'DashboardOutlined', filters: { 'tags._memory_pressure': { eq: 'true' } }, badgeStatus: 'warning' },
                            { id: 'timeout-risk', label: 'Timeout Risk', icon: 'FieldTimeOutlined', filters: { 'tags._timeout_risk': { eq: 'true' } }, badgeStatus: 'error' },
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1sb2ctZW50aXR5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvc3RvcmFnZS9vYnNlcnZhYmlsaXR5LWxvZy1lbnRpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCxtQ0FBcUM7QUFDckMsZ0VBQWdFO0FBQ2hFLDBEQUF5STtBQUV6STs7Ozs7Ozs7Ozs7R0FXRztBQUNVLFFBQUEsNEJBQTRCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUM3RCxLQUFLLEVBQUU7UUFDTCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxrQkFBa0I7UUFDMUIsZ0JBQWdCLEVBQUUsbUJBQW1CO1FBQ3JDLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6Qyx3Q0FBd0M7UUFDeEMsbUJBQW1CLEVBQUUsSUFBSTtRQUN6QixvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLE1BQU0sRUFBRTtZQUNOLE9BQU8sRUFBRSxLQUFLO1lBQ2QsV0FBVyxFQUFFO2dCQUNYLFVBQVUsRUFBRSxvQkFBb0I7YUFDakM7U0FDRjtRQUNELGtDQUFrQztRQUNsQyxjQUFjLEVBQUU7WUFDZCxXQUFXLEVBQUU7Z0JBQ1gscUNBQXFDO2dCQUNyQyx1RUFBdUU7Z0JBQ3ZFLFdBQVcsRUFBRSxFQUFFLEtBQUssRUFBRSxhQUFhLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRTtnQkFDcEQseURBQXlEO2dCQUN6RCxVQUFVLEVBQUU7b0JBQ1Y7d0JBQ0UsRUFBRSxFQUFFLFlBQVk7d0JBQ2hCLEtBQUssRUFBRSxZQUFZO3dCQUNuQixJQUFJLEVBQUUsbUJBQW1CO3dCQUN6QixPQUFPLEVBQUUsWUFBWTt3QkFDckIsaUVBQWlFO3dC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RUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsVUFBVSxDQUFFLEVBQUU7WUFDbEQsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUUsRUFBRTtTQUN0RDtRQUNELCtEQUErRDtRQUMvRCxhQUFhLEVBQUU7WUFDYixLQUFLLEVBQUUsTUFBTTtZQUNiLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7WUFDckQsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUUsRUFBRTtTQUN0RDtRQUNELDJEQUEyRDtLQUM1RDtDQUNPLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eSBMb2cgRW50aXR5IFNjaGVtYVxuICogXG4gKiBEeW5hbW9EQiB0YWJsZSBzY2hlbWEgZm9yIHN0b3JpbmcgYWxsIG9ic2VydmFiaWxpdHkgZXZlbnRzLlxuICogVXNlZCBieSBPYnNlcnZhYmlsaXR5TG9nU2VydmljZSB3aGljaCBpcyBzZWxmLWNvbnRhaW5lZCAobm8gREkgZGVwZW5kZW5jeSkuXG4gKi9cblxuaW1wb3J0IHsgcmFuZG9tQnl0ZXMgfSBmcm9tICdjcnlwdG8nO1xuLy8gSW1wb3J0IGRpcmVjdGx5IGZyb20gYmFzZS1lbnRpdHkgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeVxuaW1wb3J0IHsgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIGNyZWF0ZUVudGl0eVNjaGVtYSwgRW50aXR5VHlwZUZyb21TY2hlbWEsIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcblxuLyoqXG4gKiBPYnNlcnZhYmlsaXR5IExvZyBFbnRpdHkgU2NoZW1hXG4gKiBcbiAqIFVuaXZlcnNhbCBzY2hlbWEgZm9yIGFsbCBvYnNlcnZhYmlsaXR5IGV2ZW50IHR5cGVzOlxuICogLSBzcGFuIC8gc3Bhbi5zdGFydCAoZGlzdHJpYnV0ZWQgdHJhY2luZylcbiAqIC0gYXVkaXQuZW50aXR5LCBhdWRpdC5hY3Rpb24sIGF1ZGl0LmNvbXBsaWFuY2UgKGF1ZGl0aW5nKVxuICogLSBtZXRyaWMgKG1ldHJpY3MvY291bnRlcnMpXG4gKiAtIHdvcmtmbG93LiogKHdvcmtmbG93IHRyYWNraW5nKVxuICogLSBkZWNpc2lvbi4qIChkZWNpc2lvbiBsb2dnaW5nKVxuICogLSBhY2Nlc3MgKEFQSSBhY2Nlc3MgbG9ncylcbiAqIC0gbG9nIChzdHJ1Y3R1cmVkIGxvZ2dpbmcpXG4gKi9cbmV4cG9ydCBjb25zdCBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgbW9kZWw6IHtcbiAgICB2ZXJzaW9uOiAnMScsXG4gICAgZW50aXR5OiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgZW50aXR5TmFtZVBsdXJhbDogJ29ic2VydmFiaWxpdHlMb2dzJyxcbiAgICBzZXJ2aWNlOiAnb2JzZXJ2YWJpbGl0eScsXG4gICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgLy8gU3lzdGVtIGVudGl0eSAtIHJlYWQtb25seSBpbiBhZG1pbiBVSVxuICAgIGV4Y2x1ZGVBdWRpdEFjdGlvbnM6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbk1lbnU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IHRydWUsXG4gICAgc2VhcmNoOiB7XG4gICAgICBlbmFibGVkOiBmYWxzZSxcbiAgICAgIGluZGV4Q29uZmlnOiB7XG4gICAgICAgIHByaW1hcnlLZXk6ICdvYnNlcnZhYmlsaXR5TG9nSWQnLFxuICAgICAgfVxuICAgIH0sXG4gICAgLy8gPT09IExJU1QgUEFHRSBDT05GSUdVUkFUSU9OID09PVxuICAgIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgICB0YWJsZUNvbmZpZzoge1xuICAgICAgICAvLyBEZWZhdWx0IHNvcnQ6IGxhdGVzdCByZWNvcmRzIGZpcnN0XG4gICAgICAgIC8vIFNlYXJjaCBtb2RlIHVzZXMgZnVsbCBjb25maWcsIERCIG1vZGUgZXh0cmFjdHMganVzdCB0aGUgJ2Rlc2MnIG9yZGVyXG4gICAgICAgIGRlZmF1bHRTb3J0OiB7IGZpZWxkOiAndGltZXN0YW1wTXMnLCBvcmRlcjogJ2Rlc2MnIH0sXG4gICAgICAgIC8vIFJvdyBhY3Rpb25zIC0gcXVpY2sgYWNjZXNzIHdpdGhvdXQgbG9zaW5nIGxpc3QgY29udGV4dFxuICAgICAgICByb3dBY3Rpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdxdWljay12aWV3JyxcbiAgICAgICAgICAgIGxhYmVsOiAnUXVpY2sgVmlldycsXG4gICAgICAgICAgICBpY29uOiAnRXhwYW5kQWx0T3V0bGluZWQnLFxuICAgICAgICAgICAgdG9vbHRpcDogJ1F1aWNrIFZpZXcnLFxuICAgICAgICAgICAgLy8gT3BlbiB2aWV3IHBhZ2UgaW4gbW9kYWwgLSBVUkwgd2lsbCBiZSByZXNvbHZlZCB0byBmZXRjaCBjb25maWdcbiAgICAgICAgICAgIHVybDogJy92aWV3LW9ic2VydmFiaWxpdHlsb2cvOm9ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgIG1vZGFsVGl0bGU6ICdMb2cgRGV0YWlscycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3ZpZXctdHJhY2UnLFxuICAgICAgICAgICAgbGFiZWw6ICdWaWV3IFRyYWNlJyxcbiAgICAgICAgICAgIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsXG4gICAgICAgICAgICB0b29sdGlwOiAnVmlldyBjb3JyZWxhdGVkIGxvZ3MnLFxuICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICBtb2RhbFRpdGxlOiAnVHJhY2UgTG9ncycsXG4gICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBjb3JyZWxhdGlvbklkOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBjb3JyZWxhdGlvbklkOiAnOmNvcnJlbGF0aW9uSWQnIH0sXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndmlldy1jaGlsZHJlbicsXG4gICAgICAgICAgICBsYWJlbDogJ1ZpZXcgQ2hpbGRyZW4nLFxuICAgICAgICAgICAgaWNvbjogJ0JyYW5jaGVzT3V0bGluZWQnLFxuICAgICAgICAgICAgdG9vbHRpcDogJ1ZpZXcgY2hpbGQgbG9ncycsXG4gICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgIG1vZGFsVGl0bGU6ICdDaGlsZCBMb2dzJyxcbiAgICAgICAgICAgIC8vIFNob3cgZm9yIGxvZ3MgdGhhdCBkb24ndCBoYXZlIGEgcGFyZW50IChyb290IGxvZ3MgbWF5IGhhdmUgY2hpbGRyZW4pXG4gICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiBmYWxzZSB9IH0gfSxcbiAgICAgICAgICAgIC8vIFVzZSBtb2RhbENvbmZpZ1JlZiB0byBoaWRlIGhpZXJhcmNoeSBzZWdtZW50cyAoY29uZmxpY3RzIHdpdGggcGFyZW50IGZpbHRlcilcbiAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICc6b2JzZXJ2YWJpbGl0eUxvZ0lkJyB9LFxuICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICAvLyBDb2x1bW5zIGZvciBxdWljayBzY2FubmluZyDigJQgZXNzZW50aWFsIGZpZWxkcyB2aXNpYmxlIGJ5IGRlZmF1bHRcbiAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgIHsgZmllbGQ6ICd0eXBlJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdsZXZlbCcgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnZW50aXR5TmFtZScgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnc291cmNlJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdvcGVyYXRpb24nIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ3N0YXR1cycgfSxcbiAgICAgICAgICB7IGZpZWxkOiAndGltZXN0YW1wTXMnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2R1cmF0aW9uTXMnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2ZpbmdlcnByaW50JywgZGVmYXVsdFZpc2libGU6IGZhbHNlIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2NvcnJlbGF0aW9uSWQnLCBkZWZhdWx0VmlzaWJsZTogZmFsc2UgfSxcbiAgICAgICAgXSxcbiAgICAgICAgLy8gPT09IEZJTFRFUiBTRUdNRU5UUzogUXVpY2sgYWNjZXNzIHRvIGNvbW1vbiB2aWV3cyA9PT1cbiAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICAvLyA9PT0gQlkgSElFUkFSQ0hZID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnaGllcmFyY2h5LWdyb3VwJyxcbiAgICAgICAgICAgIGxhYmVsOiAnVmlldycsXG4gICAgICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaWQ6ICdhbGwtc3BhbnMnLCBsYWJlbDogJ0FsbCBFdmVudHMnLCBpY29uOiAnVW5vcmRlcmVkTGlzdE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7fSxcbiAgICAgICAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpZDogJ3Jvb3Qtb25seScsIGxhYmVsOiAnUm9vdCBTcGFucycsIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgLy8gRmlsdGVyOiBubyBwYXJlbnQgPSByb290IHNwYW5cbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IGZhbHNlIH0gfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnY2hpbGQtb25seScsIGxhYmVsOiAnQ2hpbGQgU3BhbnMnLCBpY29uOiAnQnJhbmNoZXNPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgLy8gRmlsdGVyOiBoYXMgcGFyZW50ID0gY2hpbGQgc3BhblxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGV4aXN0czogdHJ1ZSB9IH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gPT09IEJZIExFVkVMID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnbGV2ZWwtZ3JvdXAnLFxuICAgICAgICAgICAgbGFiZWw6ICdMZXZlbCcsXG4gICAgICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgICAgICB7IGlkOiAnYWxsLWxldmVscycsIGxhYmVsOiAnQWxsJywgZmlsdGVyczoge30sIGRlZmF1bHQ6IHRydWUgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ2Vycm9ycycsIGxhYmVsOiAnRXJyb3JzJywgaWNvbjogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAnZXJyb3InIH0gfSwgYmFkZ2VTdGF0dXM6ICdlcnJvcicgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ3dhcm5pbmdzJywgbGFiZWw6ICdXYXJuaW5ncycsIGljb246ICdXYXJuaW5nT3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAnd2FybicgfSB9LCBiYWRnZVN0YXR1czogJ3dhcm5pbmcnIH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdpbmZvJywgbGFiZWw6ICdJbmZvJywgaWNvbjogJ0luZm9DaXJjbGVPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICdpbmZvJyB9IH0gfSxcbiAgICAgICAgICAgICAgeyBpZDogJ2RlYnVnJywgbGFiZWw6ICdEZWJ1ZycsIGljb246ICdCdWdPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICdkZWJ1ZycgfSB9IH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICd0cmFjZScsIGxhYmVsOiAnVHJhY2UnLCBpY29uOiAnQXBhcnRtZW50T3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAndHJhY2UnIH0gfSB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vID09PSBCWSBTSUdOQUxTID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnc2lnbmFscy1ncm91cCcsXG4gICAgICAgICAgICBsYWJlbDogJ1NpZ25hbHMnLFxuICAgICAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICAgICAgeyBpZDogJ2FsbC1zaWduYWxzJywgbGFiZWw6ICdBbGwnLCBmaWx0ZXJzOiB7fSwgZGVmYXVsdDogdHJ1ZSB9LFxuICAgICAgICAgICAgICB7IGlkOiAnY29sZC1zdGFydHMnLCBsYWJlbDogJ0NvbGQgU3RhcnRzJywgaWNvbjogJ1RodW5kZXJib2x0T3V0bGluZWQnLCBmaWx0ZXJzOiB7ICd0YWdzLmNvbGRfc3RhcnQnOiB7IGVxOiAndHJ1ZScgfSB9IH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdzbG93LXJlcXVlc3RzJywgbGFiZWw6ICdTbG93JywgaWNvbjogJ0Nsb2NrQ2lyY2xlT3V0bGluZWQnLCBmaWx0ZXJzOiB7ICd0YWdzLl9zbG93JzogeyBlcTogJ3RydWUnIH0gfSwgYmFkZ2VTdGF0dXM6ICd3YXJuaW5nJyB9LFxuICAgICAgICAgICAgICB7IGlkOiAnaGFzLWVycm9ycycsIGxhYmVsOiAnRmFpbGVkJywgaWNvbjogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLCBmaWx0ZXJzOiB7IHN1Y2Nlc3M6IHsgZXE6ICdmYWxzZScgfSB9LCBiYWRnZVN0YXR1czogJ2Vycm9yJyB9LFxuICAgICAgICAgICAgICB7IGlkOiAnc3RhdHVzLTR4eCcsIGxhYmVsOiAnNHh4JywgaWNvbjogJ1dhcm5pbmdPdXRsaW5lZCcsIGZpbHRlcnM6IHsgJ3RhZ3MuaHR0cC5zdGF0dXNfY29kZV9jbGFzcyc6IHsgZXE6ICc0eHgnIH0gfSwgYmFkZ2VTdGF0dXM6ICd3YXJuaW5nJyB9LFxuICAgICAgICAgICAgICB7IGlkOiAnc3RhdHVzLTV4eCcsIGxhYmVsOiAnNXh4JywgaWNvbjogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLCBmaWx0ZXJzOiB7ICd0YWdzLmh0dHAuc3RhdHVzX2NvZGVfY2xhc3MnOiB7IGVxOiAnNXh4JyB9IH0sIGJhZGdlU3RhdHVzOiAnZXJyb3InIH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdyZXRyaWVzJywgbGFiZWw6ICdSZXRyaWVzJywgaWNvbjogJ1JlbG9hZE91dGxpbmVkJywgZmlsdGVyczogeyAndGFncy5zcXMuaGFzX3JldHJpZXMnOiB7IGVxOiAndHJ1ZScgfSB9LCBiYWRnZVN0YXR1czogJ3dhcm5pbmcnIH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdtZW1vcnktcHJlc3N1cmUnLCBsYWJlbDogJ01lbW9yeScsIGljb246ICdEYXNoYm9hcmRPdXRsaW5lZCcsIGZpbHRlcnM6IHsgJ3RhZ3MuX21lbW9yeV9wcmVzc3VyZSc6IHsgZXE6ICd0cnVlJyB9IH0sIGJhZGdlU3RhdHVzOiAnd2FybmluZycgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ3RpbWVvdXQtcmlzaycsIGxhYmVsOiAnVGltZW91dCBSaXNrJywgaWNvbjogJ0ZpZWxkVGltZU91dGxpbmVkJywgZmlsdGVyczogeyAndGFncy5fdGltZW91dF9yaXNrJzogeyBlcTogJ3RydWUnIH0gfSwgYmFkZ2VTdGF0dXM6ICdlcnJvcicgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgZXhwYW5kYWJsZToge1xuICAgICAgICAgIG1vZGU6ICdqc29uJyxcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9LFxuICAgIC8vID09PSBWSUVXIFBBR0UgQ09ORklHVVJBVElPTiA9PT1cbiAgICB2aWV3UGFnZUNvbmZpZzoge1xuICAgICAgYWN0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICd2aWV3LXRyYWNlJyxcbiAgICAgICAgICBsYWJlbDogJ1ZpZXcgRnVsbCBUcmFjZScsXG4gICAgICAgICAgaWNvbjogJ0FwYXJ0bWVudE91dGxpbmVkJyxcbiAgICAgICAgICB0b29sdGlwOiAnVmlldyBhbGwgZXZlbnRzIGluIHRoaXMgdHJhY2UnLFxuICAgICAgICAgIHVybDogJy9saXN0LW9ic2VydmFiaWxpdHlsb2c/Y29ycmVsYXRpb25JZC5lcT06Y29ycmVsYXRpb25JZCcsXG4gICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgY29ycmVsYXRpb25JZDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ3ZpZXctcGFyZW50JyxcbiAgICAgICAgICBsYWJlbDogJ0dvIHRvIFBhcmVudCcsXG4gICAgICAgICAgaWNvbjogJ0Fycm93VXBPdXRsaW5lZCcsXG4gICAgICAgICAgdG9vbHRpcDogJ05hdmlnYXRlIHRvIHRoZSBwYXJlbnQgc3BhbicsXG4gICAgICAgICAgdXJsOiAnL3ZpZXctb2JzZXJ2YWJpbGl0eWxvZy86cGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyxcbiAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICd2aWV3LXNhbWUtZXJyb3InLFxuICAgICAgICAgIGxhYmVsOiAnU2FtZSBFcnJvciBQYXR0ZXJuJyxcbiAgICAgICAgICBpY29uOiAnQnVnT3V0bGluZWQnLFxuICAgICAgICAgIHRvb2x0aXA6ICdWaWV3IGFsbCBvY2N1cnJlbmNlcyBvZiB0aGlzIGVycm9yIGZpbmdlcnByaW50JyxcbiAgICAgICAgICB1cmw6ICcvbGlzdC1vYnNlcnZhYmlsaXR5bG9nP2ZpbmdlcnByaW50LmVxPTpmaW5nZXJwcmludCcsXG4gICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZmluZ2VycHJpbnQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIC8vIFR3by1jb2x1bW4gbGF5b3V0IGZvciBlc3NlbnRpYWwgaWRlbnRpZmljYXRpb24gYW5kIG9wZXJhdGlvbiBkZXRhaWxzXG4gICAgICBjb2x1bW5zQ29uZmlnOiB7XG4gICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICBsYWJlbDogJ0lkZW50aXR5ICYgQ2xhc3NpZmljYXRpb24nLFxuICAgICAgICAgICAgZmllbGRzOiBbXG4gICAgICAgICAgICAgICdvYnNlcnZhYmlsaXR5TG9nSWQnLFxuICAgICAgICAgICAgICAndHlwZScsXG4gICAgICAgICAgICAgICdzdWJUeXBlJyxcbiAgICAgICAgICAgICAgJ2xldmVsJyxcbiAgICAgICAgICAgICAgJ2NvcnJlbGF0aW9uSWQnLCAgLy8gSGFzIGxpbmtDb25maWcgLSByZW5kZXJzIGFzIGxpbmsgdG8gdHJhY2Ugdmlld1xuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgIGxhYmVsOiAnT3BlcmF0aW9uICYgVGltaW5nJyxcbiAgICAgICAgICAgIGZpZWxkczogW1xuICAgICAgICAgICAgICAnb3BlcmF0aW9uJyxcbiAgICAgICAgICAgICAgJ3N0YXR1cycsXG4gICAgICAgICAgICAgICdzdWNjZXNzJyxcbiAgICAgICAgICAgICAgJ3RpbWVzdGFtcE1zJyxcbiAgICAgICAgICAgICAgJ2R1cmF0aW9uTXMnLFxuICAgICAgICAgICAgICAnc291cmNlJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICAvLyBUd28gZ3JvdXBzOiBFdmVudCBEZXRhaWxzIChhYm91dCB0aGlzIHJlY29yZCkgYW5kIFJlbGF0aW9ucyAobmF2aWdhdGlvbiB0byByZWxhdGVkIHJlY29yZHMpLlxuICAgICAgLy8gV2l0aGluIGVhY2ggZ3JvdXAsIHRhYnMgaGFuZGxlIGRvbWFpbiBzZXBhcmF0aW9uLiBTdHJ1Y3R1cmVkIHZpZXdzIGNvbWUgZmlyc3QsXG4gICAgICAvLyByYXcgSlNPTiBmYWxsYmFja3MgYXJlIGFsd2F5cyBhdmFpbGFibGUgYXMgdGhlIGxhc3QgdGFicy5cbiAgICAgIHNlY3Rpb25zQ29uZmlnOiB7XG4gICAgICAgIHNlY3Rpb25Hcm91cHM6IFtcbiAgICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgICAvLyBHUk9VUCAxOiBFVkVOVCBERVRBSUxTIOKAlCBFdmVyeXRoaW5nIGFib3V0IHRoaXMgc3BlY2lmaWMgZXZlbnRcbiAgICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2V2ZW50LWRldGFpbHMnLFxuICAgICAgICAgICAgbGFiZWw6ICdFdmVudCBEZXRhaWxzJyxcbiAgICAgICAgICAgIGljb246ICdGaWxlU2VhcmNoT3V0bGluZWQnLFxuICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgcmVuZGVyTW9kZTogJ3RhYnMnLFxuICAgICAgICAgICAgZGVmYXVsdENvbGxhcHNlZDogZmFsc2UsXG4gICAgICAgICAgICBsYXp5TG9hZDogZmFsc2UsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogdHJ1ZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIC8vIE5PVEU6IE5vIFwiT3ZlcnZpZXdcIiB0YWIgaGVyZSDigJQgdGhlIGRlZmF1bHQgZW50aXR5IHZpZXcgcGFnZSBhbHJlYWR5IHJlbmRlcnNcbiAgICAgICAgICAgICAgLy8gY29yZSBmaWVsZHMgKG9wZXJhdGlvbiwgc3RhdHVzLCB0eXBlLCBzdWJUeXBlLCBsZXZlbCwgdGltaW5nLCBldGMuKSB2aWEgY29sdW1uc0NvbmZpZy5cblxuICAgICAgICAgICAgICAvLyAtLS0gRXJyb3I6IHN0cnVjdHVyZWQgYnJlYWtkb3duICsgcmF3IC0tLVxuICAgICAgICAgICAgICBlcnJvcjoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRXJyb3InLFxuICAgICAgICAgICAgICAgIGljb246ICdFeGNsYW1hdGlvbkNpcmNsZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlcnJvcjogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZXJyb3IudHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZXJyb3IudHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdFcnJvciBUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdUaGUgY2xhc3MvY29uc3RydWN0b3IgbmFtZSBvZiB0aGUgZXJyb3InLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2Vycm9yLm1lc3NhZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2Vycm9yLm1lc3NhZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnTWVzc2FnZScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAndGV4dCcsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdUaGUgZXJyb3IgbWVzc2FnZScsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZXJyb3IuY29kZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZXJyb3IuY29kZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdFcnJvciBDb2RlJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdBcHBsaWNhdGlvbiBvciBzeXN0ZW0gZXJyb3IgY29kZSAoZS5nLiwgRUNPTk5SRUZVU0VELCBWQUxJREFUSU9OX0ZBSUxFRCknLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdlcnJvci5jb2RlJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZXJyb3Iuc3RhY2snLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2Vycm9yLnN0YWNrJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1N0YWNrIFRyYWNlJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdjb2RlJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0Z1bGwgc3RhY2sgdHJhY2UgZnJvbSB0aGUgZXJyb3InLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdlcnJvci5zdGFjayc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAvLyAtLS0gVGltZWxpbmU6IHNwYW4gY2hlY2twb2ludHMgLS0tXG4gICAgICAgICAgICAgIHRpbWVsaW5lOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdUaW1lbGluZScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ05vZGVJbmRleE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5jaGVja3BvaW50cyc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEuY2hlY2twb2ludHMnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuY2hlY2twb2ludHMnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnVGltZWxpbmUgJiBDaGVja3BvaW50cycsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdDaHJvbm9sb2dpY2FsIHRpbWVsaW5lIG9mIGV2ZW50cyB3aXRoaW4gdGhpcyBzcGFuLiBJbmNsdWRlcyBtYW51YWwgY2hlY2twb2ludHMgYW5kIGFic29yYmVkIGNoaWxkIG9wZXJhdGlvbnMuJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICd0aW1lbGluZScsXG4gICAgICAgICAgICAgICAgICAgICAgdGltZWxpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGU6ICdsZWZ0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNob3dUaW1lc3RhbXA6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXBGb3JtYXQ6ICdoOm1tOnNzLlNTUyBBJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW1NYXBwaW5nOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsRmllbGQ6ICduYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGltZXN0YW1wRmllbGQ6ICd0cycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGVGaWVsZDogJ190eXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb25GaWVsZDogJ19kZXNjcmlwdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIC8vIC0tLSBBdWRpdCBEYXRhOiBzdHJ1Y3R1cmVkIHZpZXcgZm9yIGF1ZGl0LmVudGl0eSByZWNvcmRzIC0tLVxuICAgICAgICAgICAgICBhdWRpdERhdGE6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0F1ZGl0IERhdGEnLFxuICAgICAgICAgICAgICAgIGljb246ICdBdWRpdE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICAvLyBPbmx5IHNob3cgZm9yIGF1ZGl0LXR5cGUgcmVjb3JkcyAoYXVkaXQuZW50aXR5LCBhdWRpdC5jb21wbGlhbmNlLCBhdWRpdC5hY2Nlc3MpXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ3RhZ3MuYXVkaXQnOiB7IGVxOiAndHJ1ZScgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgIC8vIEVudGl0eSB1cGRhdGU6IGJlZm9yZSAvIGFmdGVyIC8gZGlmZlxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEuYmVmb3JlJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdkYXRhLmJlZm9yZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdCZWZvcmUgKE9sZCBTdGF0ZSknLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2pzb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnRW50aXR5IHN0YXRlIGJlZm9yZSB0aGUgdXBkYXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5iZWZvcmUnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLmFmdGVyJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdkYXRhLmFmdGVyJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0FmdGVyIChOZXcgU3RhdGUpJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0VudGl0eSBzdGF0ZSBhZnRlciB0aGUgdXBkYXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5hZnRlcic6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEuZGlmZicsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5kaWZmJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0RpZmYnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2pzb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnQ2hhbmdlZCBmaWVsZHMgd2l0aCBvbGQvbmV3IHZhbHVlcycsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2RhdGEuZGlmZic6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAvLyBFbnRpdHkgY3JlYXRlXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5jcmVhdGVkJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdkYXRhLmNyZWF0ZWQnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnQ3JlYXRlZCBSZWNvcmQnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2pzb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnRnVsbCBkYXRhIG9mIHRoZSBuZXdseSBjcmVhdGVkIGVudGl0eScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2RhdGEuY3JlYXRlZCc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAvLyBFbnRpdHkgZGVsZXRlXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5kZWxldGVkJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdkYXRhLmRlbGV0ZWQnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRGVsZXRlZCBSZWNvcmQnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2pzb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnRnVsbCBkYXRhIG9mIHRoZSBlbnRpdHkgdGhhdCB3YXMgZGVsZXRlZCcsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2RhdGEuZGVsZXRlZCc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAvLyBFbnRpdHkgbGlzdCBxdWVyeVxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEucXVlcnknLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEucXVlcnknLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnUXVlcnkgRmlsdGVycycsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnanNvbicsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdGaWx0ZXJzIHVzZWQgaW4gdGhlIGxpc3QvcXVlcnkgb3BlcmF0aW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5xdWVyeSc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEucmVzdWx0Q291bnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEucmVzdWx0Q291bnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnUmVzdWx0IENvdW50JyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdOdW1iZXIgb2YgcmVjb3JkcyByZXR1cm5lZCBieSB0aGUgcXVlcnknLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLnJlc3VsdENvdW50JzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhdyBmYWxsYmFjayDigJQgZnVsbCBkYXRhIGZvciBhbnkgc2hhcGVcbiAgICAgICAgICAgICAgICAgICAgJ2RhdGEnLFxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAvLyAtLS0gTm9pc2UgUmVkdWN0aW9uOiBhYnNvcmJlZCBldmVudCBzdW1tYXJ5IC0tLVxuICAgICAgICAgICAgICBub2lzZVJlZHVjdGlvbjoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnTm9pc2UgUmVkdWN0aW9uJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQ29tcHJlc3NPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA0LFxuXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5hYnNvcmJlZCc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEuYWJzb3JiZWQuY291bnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuYWJzb3JiZWQuY291bnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0Fic29yYmVkIEV2ZW50cycsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdUb3RhbCBjaGlsZCBldmVudHMgYWJzb3JiZWQgaW50byB0aGlzIHJlY29yZC4gUGVyLW9wZXJhdGlvbiBicmVha2Rvd24gaXMgaW4gdGhlIFRpbWVsaW5lIHRhYi4nLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEuYWJzb3JiZWQuc2lsZW50Q291bnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuYWJzb3JiZWQuc2lsZW50Q291bnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1NpbGVuY2VkIEV2ZW50cycsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdUb3RhbCBjaGlsZCBldmVudHMgc2lsZW50bHkgZHJvcHBlZCAoY291bnRlciBvbmx5KScsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5hYnNvcmJlZC5lcnJvcnMnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuYWJzb3JiZWQuZXJyb3JzJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0Fic29yYmVkIEVycm9ycycsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdFcnJvciBkZXRhaWxzIGZyb20gYWJzb3JiZWQgY2hpbGQgZXZlbnRzJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5hYnNvcmJlZC5lcnJvcnMnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLmFic29yYmVkLmNhdXNlZEJ5TGlua3MnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuYWJzb3JiZWQuY2F1c2VkQnlMaW5rcycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdDcm9zcy1JbnZvY2F0aW9uIExpbmtzJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0NvcnJlbGF0aW9uIElEcyBmcm9tIGFic29yYmVkIGV2ZW50cyBsaW5raW5nIHRvIG90aGVyIGludm9jYXRpb25zJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5hYnNvcmJlZC5jYXVzZWRCeUxpbmtzJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIC8vIC0tLSBUYWdzOiBzaWduYWwgYmFkZ2VzICsgcmF3IEpTT04gLS0tXG4gICAgICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1RhZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdUYWdPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA1LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgdGFnczogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgIC8vIFN0cnVjdHVyZWQgc2lnbmFsIGJhZGdlcyAoZWFjaCBjb25kaXRpb25hbCDigJQgb25seSByZW5kZXIgd2hlbiBwcmVzZW50KVxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhZ3MuaHR0cC5zdGF0dXNfY29kZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5odHRwLnN0YXR1c19jb2RlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0hUVFAgU3RhdHVzIENvZGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5odHRwLnN0YXR1c19jb2RlJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5odHRwLnN0YXR1c19jb2RlX2NsYXNzJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICd0YWdzLmh0dHAuc3RhdHVzX2NvZGVfY2xhc3MnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnU3RhdHVzIENsYXNzJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ3RhZ3MuaHR0cC5zdGF0dXNfY29kZV9jbGFzcyc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhZ3MuZXJyb3JfY2F0ZWdvcnknLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ3RhZ3MuZXJyb3JfY2F0ZWdvcnknLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRXJyb3IgQ2F0ZWdvcnknLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5lcnJvcl9jYXRlZ29yeSc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhZ3MuY29sZF9zdGFydCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5jb2xkX3N0YXJ0JyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0NvbGQgU3RhcnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5jb2xkX3N0YXJ0JzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5fc2xvdycsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5fc2xvdycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdTbG93JyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ3RhZ3MuX3Nsb3cnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICd0YWdzLl9tZW1vcnlfcHJlc3N1cmUnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ3RhZ3MuX21lbW9yeV9wcmVzc3VyZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdNZW1vcnkgUHJlc3N1cmUnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5fbWVtb3J5X3ByZXNzdXJlJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5fdGltZW91dF9yaXNrJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICd0YWdzLl90aW1lb3V0X3Jpc2snLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnVGltZW91dCBSaXNrJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ3RhZ3MuX3RpbWVvdXRfcmlzayc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhZ3Muc3FzLmhhc19yZXRyaWVzJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICd0YWdzLnNxcy5oYXNfcmV0cmllcycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdTUVMgUmV0cmllcycsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICd0YWdzLnNxcy5oYXNfcmV0cmllcyc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhZ3MucXVlcnlfdHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5xdWVyeV90eXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1F1ZXJ5IFR5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5xdWVyeV90eXBlJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5sYW1iZGEuZnVuY3Rpb25fbmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5sYW1iZGEuZnVuY3Rpb25fbmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdMYW1iZGEgRnVuY3Rpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICd0YWdzLmxhbWJkYS5mdW5jdGlvbl9uYW1lJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhdyBmYWxsYmFjayDigJQgZnVsbCB0YWdzIEpTT04gYWx3YXlzIGF0IHRoZSBib3R0b21cbiAgICAgICAgICAgICAgICAgICAgJ3RhZ3MnLFxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAvLyAtLS0gTWV0cmljczoga2V5IHZhbHVlcyArIHJhdyBKU09OIC0tLVxuICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdNZXRyaWNzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRGFzaGJvYXJkT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IG1ldHJpY3M6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICAvLyBTdHJ1Y3R1cmVkIGtleSBtZXRyaWNzIChlYWNoIGNvbmRpdGlvbmFsKVxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ21ldHJpY3MuZHVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ21ldHJpY3MuZHVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRHVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2R1cmF0aW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICBkdXJhdGlvblVuaXQ6ICdtcycsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ21ldHJpY3MuZHVyYXRpb24nOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdtZXRyaWNzLnNwYW4uZGVwdGgnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ21ldHJpY3Muc3Bhbi5kZXB0aCcsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdTcGFuIERlcHRoJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ21ldHJpY3Muc3Bhbi5kZXB0aCc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ21ldHJpY3MuaW52b2NhdGlvbl9udW1iZXInLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ21ldHJpY3MuaW52b2NhdGlvbl9udW1iZXInLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnSW52b2NhdGlvbiAjJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ21ldHJpY3MuaW52b2NhdGlvbl9udW1iZXInOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdtZXRyaWNzLmh0dHAucmVxdWVzdF9jb250ZW50X2xlbmd0aCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnbWV0cmljcy5odHRwLnJlcXVlc3RfY29udGVudF9sZW5ndGgnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnUmVxdWVzdCBTaXplIChieXRlcyknLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ251bWJlcicsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ21ldHJpY3MuaHR0cC5yZXF1ZXN0X2NvbnRlbnRfbGVuZ3RoJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnbWV0cmljcy5odHRwLnJlc3BvbnNlX2NvbnRlbnRfbGVuZ3RoJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdtZXRyaWNzLmh0dHAucmVzcG9uc2VfY29udGVudF9sZW5ndGgnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnUmVzcG9uc2UgU2l6ZSAoYnl0ZXMpJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdtZXRyaWNzLmh0dHAucmVzcG9uc2VfY29udGVudF9sZW5ndGgnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdtZXRyaWNzLm5vZGUuaGVhcF91c2VkX21iJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdtZXRyaWNzLm5vZGUuaGVhcF91c2VkX21iJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0hlYXAgVXNlZCAoTUIpJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdtZXRyaWNzLm5vZGUuaGVhcF91c2VkX21iJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnbWV0cmljcy5sYW1iZGEucmVtYWluaW5nX3RpbWVfbXMnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ21ldHJpY3MubGFtYmRhLnJlbWFpbmluZ190aW1lX21zJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0xhbWJkYSBSZW1haW5pbmcgVGltZScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnZHVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGR1cmF0aW9uVW5pdDogJ21zJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnbWV0cmljcy5sYW1iZGEucmVtYWluaW5nX3RpbWVfbXMnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgLy8gUmF3IGZhbGxiYWNrIOKAlCBmdWxsIG1ldHJpY3MgSlNPTiBhbHdheXMgYXQgdGhlIGJvdHRvbVxuICAgICAgICAgICAgICAgICAgICAnbWV0cmljcycsXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIC8vIC0tLSBFdmVudCBQYXlsb2FkOiByYXcgZGF0YSAtLS1cbiAgICAgICAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnUGF5bG9hZCcsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0ZpbGVUZXh0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNyxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGRhdGE6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAnZGF0YScgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAvLyAtLS0gQWN0b3I6IHN0cnVjdHVyZWQgKyByYXcgLS0tXG4gICAgICAgICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBY3RvcicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1VzZXJPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA4LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgYWN0b3I6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2FjdG9yVHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnYWN0b3IudHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdBY3RvciBUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2FjdG9yLnR5cGUnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdhY3RvcklkJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdhY3Rvci5pZCcsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdBY3RvciBJRCcsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAndGV4dCcsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2FjdG9yLmlkJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnYWN0b3JFbWFpbCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnYWN0b3IuZW1haWwnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRW1haWwnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdhY3Rvci5lbWFpbCc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2FjdG9yTmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnYWN0b3IubmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnYWN0b3IubmFtZSc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2FjdG9yR3JvdXBzJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdhY3Rvci5ncm91cHMnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnR3JvdXBzJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnYWN0b3IuZ3JvdXBzJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIC8vIFJhdyBmYWxsYmFjayDigJQgYWx3YXlzIHNob3dzIGZ1bGwgYWN0b3Igb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgICdhY3RvcicsXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIC8vIC0tLSBSYXc6IGFsbCByZW1haW5pbmcgZmllbGRzLCBhbHdheXMgdmlzaWJsZSAtLS1cbiAgICAgICAgICAgICAgcmF3OiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdSYXcgLyBPdGhlcicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0NvZGVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA5LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgICdhdHRyaWJ1dGVzJyxcbiAgICAgICAgICAgICAgICAgICAgJ21ldGFkYXRhJyxcbiAgICAgICAgICAgICAgICAgICAgJ2NvbnRleHQnLFxuICAgICAgICAgICAgICAgICAgICAndHRsJyxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgICAvLyBHUk9VUCAyOiBISUVSQVJDSFkgJiBUUkFDRSAoc3BhbiB0cmVlIG5hdmlnYXRpb24pXG4gICAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdoaWVyYXJjaHktcmVsYXRpb25zJyxcbiAgICAgICAgICAgIGxhYmVsOiAnSGllcmFyY2h5ICYgVHJhY2UnLFxuICAgICAgICAgICAgaWNvbjogJ0FwYXJ0bWVudE91dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IHRydWUsXG4gICAgICAgICAgICBsYXp5TG9hZDogdHJ1ZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiBmYWxzZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIGhpZXJhcmNoeUluZm86IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0hpZXJhcmNoeSBJbmZvJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnTm9kZUluZGV4T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMCxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICAgICAgICAnaXNSb290JyxcbiAgICAgICAgICAgICAgICAgICAgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgICAgICAgICAgICdjb3JyZWxhdGlvbklkJyxcbiAgICAgICAgICAgICAgICAgICAgJ2NhdXNlZEJ5JyxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgcGFyZW50U3Bhbjoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnUGFyZW50IFNwYW4nLFxuICAgICAgICAgICAgICAgIGljb246ICdBcnJvd1VwT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmc6IHsgc291cmNlOiAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJywgdGFyZ2V0OiAnaWQnIH0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHNpYmxpbmdTcGFuczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnU2libGluZyBTcGFucycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0Jsb2NrT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXE6ICc6cGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyB9LFxuICAgICAgICAgICAgICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogeyBuZTogJzpvYnNlcnZhYmlsaXR5TG9nSWQnIH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ090aGVyIHNwYW5zIGF0IHRoZSBzYW1lIGhpZXJhcmNoeSBsZXZlbCAoc2FtZSBwYXJlbnQpJyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY2hpbGRTcGFuczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ2hpbGQgU3BhbnMnLFxuICAgICAgICAgICAgICAgIGljb246ICdCcmFuY2hlc091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXE6ICc6b2JzZXJ2YWJpbGl0eUxvZ0lkJyB9IH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICByb290U3Bhbjoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnUm9vdCBvZiBIaWVyYXJjaHknLFxuICAgICAgICAgICAgICAgIGljb246ICdHYXRld2F5T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNCxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGlzUm9vdDogeyBlcTogZmFsc2UgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICBjb3JyZWxhdGlvbklkOiB7IGVxOiAnOmNvcnJlbGF0aW9uSWQnIH0sXG4gICAgICAgICAgICAgICAgICAgICAgaXNSb290OiB7IGVxOiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1RoZSByb290IHNwYW4gdGhhdCBzdGFydGVkIHRoaXMgdHJhY2UgaGllcmFyY2h5JyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgdHJhY2VMb2dzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBbGwgaW4gVGhpcyBUcmFjZScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1NoYXJlQWx0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogNSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGNvcnJlbGF0aW9uSWQ6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGNvcnJlbGF0aW9uSWQ6IHsgZXE6ICc6Y29ycmVsYXRpb25JZCcgfSB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBbGwgZXZlbnRzIGluIHRoaXMgTGFtYmRhIGludm9jYXRpb24nLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBjYXVzZWRCeVRyYWNlOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdDYXVzaW5nIFJlcXVlc3QgVHJhY2UnLFxuICAgICAgICAgICAgICAgIGljb246ICdMaW5rT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogOCxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGNhdXNlZEJ5OiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBjb3JyZWxhdGlvbklkOiB7IGVxOiAnOmNhdXNlZEJ5JyB9IH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1ZpZXcgdGhlIG9yaWdpbmFsIHJlcXVlc3QgdHJhY2UgdGhhdCBjYXVzZWQgdGhpcyBldmVudCcsXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGNhdXNlZEV2ZW50czoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRXZlbnRzIENhdXNlZCBCeSBUaGlzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQXBpT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogOSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGNhdXNlZEJ5OiB7IGVxOiAnOmNvcnJlbGF0aW9uSWQnIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnRXZlbnRzIGluIG90aGVyIGludm9jYXRpb25zIGNhdXNlZCBieSB0aGlzIHJlcXVlc3QnLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBzYW1lRXJyb3JQYXR0ZXJuOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdTYW1lIEVycm9yIFBhdHRlcm4nLFxuICAgICAgICAgICAgICAgIGljb246ICdCdWdPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA5LjUsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBmaW5nZXJwcmludDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgZmluZ2VycHJpbnQ6IHsgZXE6ICc6ZmluZ2VycHJpbnQnIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQWxsIG9jY3VycmVuY2VzIG9mIHRoaXMgc2FtZSBlcnJvciBwYXR0ZXJuIGFjcm9zcyB0aW1lJyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgcmVsYXRlZFRyYWNlczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnUmVsYXRlZCBUcmFjZXMnLFxuICAgICAgICAgICAgICAgIGljb246ICdDbHVzdGVyT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMTAsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyByZWxhdGVkVHJhY2VzOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFsgJ3JlbGF0ZWRUcmFjZXMnIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgICAvLyBHUk9VUCAzOiBSRUxBVEVEIExPR1MgKEVudGl0eSAmIFNvdXJjZSBhbmFseXRpY3MpXG4gICAgICAgICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdyZWxhdGVkLWFuYWx5dGljcycsXG4gICAgICAgICAgICBsYWJlbDogJ1JlbGF0ZWQgTG9ncycsXG4gICAgICAgICAgICBpY29uOiAnRnVuZE91dGxpbmVkJyxcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMyxcbiAgICAgICAgICAgIHJlbmRlck1vZGU6ICd0YWJzJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb2xsYXBzZWQ6IHRydWUsXG4gICAgICAgICAgICBsYXp5TG9hZDogZmFsc2UsXG4gICAgICAgICAgICBrZWVwTW91bnRlZDogZmFsc2UsXG4gICAgICAgICAgICBzZWN0aW9uczoge1xuICAgICAgICAgICAgICBieUVudGl0eToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnRW50aXR5IExvZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdEYXRhYmFzZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlbnRpdHlOYW1lOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICc6ZW50aXR5TmFtZScsXG4gICAgICAgICAgICAgICAgICAgICAgZW50aXR5SWQ6ICc6ZW50aXR5SWQnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYnlFbnRpdHlUeXBlOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFbnRpdHkgVHlwZSBMb2dzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQXBwc3RvcmVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZW50aXR5TmFtZTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgZW50aXR5TmFtZTogJzplbnRpdHlOYW1lJyB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYnlTb3VyY2U6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1NvdXJjZSBMb2dzJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQ29kZVNhbmRib3hPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAzLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgc291cmNlOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBzb3VyY2U6ICc6c291cmNlJyB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgYXR0cmlidXRlczoge1xuICAgIC8vID09PSBJREVOVElUWSA9PT1cbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICAvLyAxMjgtYml0IGZhbGxiYWNrIGZvciBtYW51YWwvYWRtaW4tY3JlYXRlZCByZWNvcmRzIChmcmFtZXdvcmsgZ2VuZXJhbGx5IHN1cHBsaWVzIG9ic2VydmFiaWxpdHlMb2dJZCBleHBsaWNpdGx5KS5cbiAgICAgIGRlZmF1bHQ6ICgpID0+IHJhbmRvbUJ5dGVzKDE2KS50b1N0cmluZygnaGV4JyksXG4gICAgICBsYWJlbDogJ0xvZyBJRCcsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdQYXJlbnQgTG9nIElEJyxcbiAgICAgIGhlbHBUZXh0OiAnUmVmZXJlbmNlIHRvIHBhcmVudCBzcGFuIGZvciBoaWVyYXJjaGljYWwgdHJhY2luZycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBTZWxmLXJlZmVyZW50aWFsIHJlbGF0aW9uIHRvIHBhcmVudCBvYnNlcnZhYmlsaXR5IGxvZ1xuICAgICAgcmVsYXRpb246IHtcbiAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICB0eXBlOiAnbWFueS10by1vbmUnLFxuICAgICAgICBpZGVudGlmaWVyczogeyBzb3VyY2U6ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnLCB0YXJnZXQ6ICdvYnNlcnZhYmlsaXR5TG9nSWQnIH0sXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gQ29tcHV0ZWQgZmllbGQ6IHRydWUgaWYgdGhpcyBpcyBhIHJvb3Qgc3BhbiAobm8gcGFyZW50KVxuICAgIC8vIFVzZWQgZm9yIGVmZmljaWVudCBHU0kgcXVlcmllcyBpbnN0ZWFkIG9mIG5vdEV4aXN0cyBmaWx0ZXJcbiAgICBpc1Jvb3Q6IHtcbiAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgIGxhYmVsOiAnSXMgUm9vdCcsXG4gICAgICBoZWxwVGV4dDogJ1RydWUgaWYgdGhpcyBpcyBhIHJvb3Qgc3BhbiAobm8gcGFyZW50KScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICB3YXRjaDogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdLFxuICAgICAgLy8gU2V0IHRvIHRydWUgd2hlbiBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgaXMgbnVsbC91bmRlZmluZWRcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkPzogc3RyaW5nIH0pID0+XG4gICAgICAgICFkYXRhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IHRydWUsICAvLyBEZWZhdWx0IHRvIHRydWUgaWYgbm8gcGFyZW50IHNwZWNpZmllZFxuICAgIH0sXG4gICAgLy8gTk9URTogY29ycmVsYXRpb25JZCBpcyBSRVFVSVJFRCBhbmQgaGFzIE5PIGRlZmF1bHQuXG4gICAgLy8gSWYgeW91J3JlIGdldHRpbmcgdmFsaWRhdGlvbiBlcnJvcnMsIGVuc3VyZSBjb250ZXh0IGlzIGVzdGFibGlzaGVkIChhdXRvIGluIGNvbnRyb2xsZXJzKS5cbiAgICAvLyBIYXZpbmcgYSBkZWZhdWx0IGhlcmUgd291bGQgaGlkZSBidWdzIHdoZXJlIGNvbnRleHQgd2Fzbid0IHByb3Blcmx5IGVzdGFibGlzaGVkLlxuICAgIGNvcnJlbGF0aW9uSWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBsYWJlbDogJ0NvcnJlbGF0aW9uIElEJyxcbiAgICAgIGhlbHBUZXh0OiAnVW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBlbnRpcmUgcmVxdWVzdC90cmFjZScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBOTyBERUZBVUxUIC0gbXVzdCBiZSBwcm9wYWdhdGVkIGZyb20gY29udGV4dFxuICAgICAgLy8gTGluayB0byBmaWx0ZXJlZCBsaXN0IHNob3dpbmcgYWxsIGxvZ3MgaW4gdGhlIHNhbWUgdHJhY2VcbiAgICAgIGlzTGluazogdHJ1ZSxcbiAgICAgIGxpbmtDb25maWc6IHtcbiAgICAgICAgcm91dGVQYXR0ZXJuOiAnL2xpc3Qtb2JzZXJ2YWJpbGl0eWxvZz9jb3JyZWxhdGlvbklkLmVxPTpjb3JyZWxhdGlvbklkJyxcbiAgICAgICAgZGlzcGxheVRleHQ6ICdWaWV3IENvcnJlbGF0ZWQgTG9ncycsXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gQ3Jvc3MtaW52b2NhdGlvbiB0cmFjaW5nOiBDb3JyZWxhdGlvbiBJRCB0aGF0IGNhdXNlZCB0aGlzIGV2ZW50XG4gICAgLy8gRXhhbXBsZTogRHluYW1vREIgc3RyZWFtIGF1ZGl0IGNhdXNlZCBieSBvcmlnaW5hbCBBUEkgcmVxdWVzdFxuICAgIGNhdXNlZEJ5OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIGxhYmVsOiAnQ2F1c2VkIEJ5JyxcbiAgICAgIGhlbHBUZXh0OiAnQ29ycmVsYXRpb24gSUQgdGhhdCBjYXVzZWQgdGhpcyBldmVudCAoY3Jvc3MtaW52b2NhdGlvbiB0cmFjaW5nKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc0xpbms6IHRydWUsXG4gICAgICBsaW5rQ29uZmlnOiB7XG4gICAgICAgIHJvdXRlUGF0dGVybjogJy9saXN0LW9ic2VydmFiaWxpdHlsb2c/Y29ycmVsYXRpb25JZC5lcT06Y2F1c2VkQnknLFxuICAgICAgICBkaXNwbGF5VGV4dDogJ1ZpZXcgQ2F1c2luZyBSZXF1ZXN0JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBBbGwgcmVsYXRlZCB0cmFjZSBJRHMgZm9yIGNvbXBsZXggd29ya2Zsb3dzXG4gICAgcmVsYXRlZFRyYWNlczoge1xuICAgICAgdHlwZTogJ2xpc3QnLFxuICAgICAgaXRlbXM6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgIGxhYmVsOiAnUmVsYXRlZCBUcmFjZXMnLFxuICAgICAgaGVscFRleHQ6ICdBbGwgcmVsYXRlZCBjb3JyZWxhdGlvbiBJRHMgZm9yIGNvbXBsZXggd29ya2Zsb3dzIHNwYW5uaW5nIG11bHRpcGxlIGludm9jYXRpb25zJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogZmFsc2UsIC8vIExpc3QgZmllbGQsIG5vdCBmaWx0ZXJhYmxlXG4gICAgfSxcblxuICAgIC8vID09PSBDTEFTU0lGSUNBVElPTiA9PT1cbiAgICB0eXBlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgbGFiZWw6ICdUeXBlJyxcbiAgICAgIGhlbHBUZXh0OiAnRXZlbnQgdHlwZSAoc3BhbiwgYXVkaXQuZW50aXR5LCBsb2csIG1ldHJpYywgZXRjLiknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHN1YlR5cGU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdTdWItVHlwZScsXG4gICAgICBoZWxwVGV4dDogJ0FkZGl0aW9uYWwgdHlwZSBjbGFzc2lmaWNhdGlvbicsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICAvLyBOT1RFOiBsZXZlbCBpcyBSRVFVSVJFRCBhbmQgaGFzIE5PIGRlZmF1bHQuXG4gICAgLy8gVGhlIG9ic2VydmVyIE1VU1Qgc3BlY2lmeSB0aGUgbGV2ZWwgZXhwbGljaXRseS5cbiAgICBsZXZlbDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGxhYmVsOiAnTGV2ZWwnLFxuICAgICAgaGVscFRleHQ6ICdTZXZlcml0eSBsZXZlbDogZXJyb3IsIHdhcm4sIGluZm8sIGRlYnVnJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgICAvLyBOTyBERUZBVUxUIC0gbXVzdCBiZSBzcGVjaWZpZWQgYnkgb2JzZXJ2ZXJcbiAgICB9LFxuXG4gICAgLy8gPT09IEVOVElUWSBDT05URVhUID09PVxuICAgIGVudGl0eU5hbWU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdFbnRpdHkgTmFtZScsXG4gICAgICBoZWxwVGV4dDogJ05hbWUgb2YgdGhlIGVudGl0eSB0aGlzIGV2ZW50IHJlbGF0ZXMgdG8nLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIGVudGl0eUlkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnRW50aXR5IElEJyxcbiAgICAgIGhlbHBUZXh0OiAnSUQgb2YgdGhlIHNwZWNpZmljIGVudGl0eSBpbnN0YW5jZScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAvLyBEZWZhdWx0IHRvICdfJyB3aGVuIGVudGl0eU5hbWUgaXMgc2V0IGJ1dCBlbnRpdHlJZCBpcyBub3QgKHJlcXVpcmVkIGZvciBieUVudGl0eSBjb21wb3NpdGUgaW5kZXgpXG4gICAgICB3YXRjaDogWyAnZW50aXR5TmFtZScgXSxcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgZW50aXR5TmFtZT86IHN0cmluZzsgZW50aXR5SWQ/OiBzdHJpbmcgfSkgPT5cbiAgICAgICAgZGF0YS5lbnRpdHlJZCB8fCAoZGF0YS5lbnRpdHlOYW1lID8gJ18nIDogdW5kZWZpbmVkKSxcbiAgICAgIC8vIER5bmFtaWMgbGluayB0byB0aGUgcmVsYXRlZCBlbnRpdHkgYmFzZWQgb24gZW50aXR5TmFtZVxuICAgICAgbGlua0NvbmZpZzoge1xuICAgICAgICByb3V0ZVBhdHRlcm46ICcvdmlldy06ZW50aXR5TmFtZS86ZW50aXR5SWQnLFxuICAgICAgICBkaXNwbGF5VGV4dDogJ1ZpZXcge2VudGl0eU5hbWV9JyxcbiAgICAgIH0sXG4gICAgfSxcblxuICAgIC8vID09PSBPUEVSQVRJT04gPT09XG4gICAgb3BlcmF0aW9uOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnT3BlcmF0aW9uJyxcbiAgICAgIGhlbHBUZXh0OiAnVGhlIG9wZXJhdGlvbiBiZWluZyBwZXJmb3JtZWQgKGUuZy4sIGNyZWF0ZSwgdXBkYXRlLCBxdWVyeSknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHN0YXR1czoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ1N0YXR1cycsXG4gICAgICBoZWxwVGV4dDogJ09wZXJhdGlvbiBzdGF0dXMgKGUuZy4sIHN0YXJ0ZWQsIGNvbXBsZXRlZCwgZmFpbGVkKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgfSxcbiAgICBzdWNjZXNzOiB7XG4gICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICBsYWJlbDogJ1N1Y2Nlc3MnLFxuICAgICAgaGVscFRleHQ6ICdXaGV0aGVyIHRoZSBvcGVyYXRpb24gY29tcGxldGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBmaWVsZFR5cGU6ICdib29sZWFuJyxcbiAgICAgIGJvb2xlYW5MYWJlbHM6IHsgdHJ1ZTogJ1N1Y2Nlc3MnLCBmYWxzZTogJ0ZhaWxlZCcgfSxcbiAgICB9LFxuXG4gICAgLy8gPT09IFRJTUlORyA9PT1cbiAgICB0aW1lc3RhbXBNczoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KCksXG4gICAgICBsYWJlbDogJ1RpbWVzdGFtcCcsXG4gICAgICBoZWxwVGV4dDogJ0V2ZW50IHRpbWVzdGFtcCBpbiBtaWxsaXNlY29uZHMgc2luY2UgZXBvY2gnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICAgIGZpZWxkVHlwZTogJ2RhdGV0aW1lJyxcbiAgICB9LFxuICAgIGR1cmF0aW9uTXM6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgbGFiZWw6ICdEdXJhdGlvbiAobXMpJyxcbiAgICAgIGhlbHBUZXh0OiAnT3BlcmF0aW9uIGR1cmF0aW9uIGluIG1pbGxpc2Vjb25kcycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc1NvcnRhYmxlOiB0cnVlLFxuICAgICAgZmllbGRUeXBlOiAnZHVyYXRpb24nLFxuICAgICAgZHVyYXRpb25Vbml0OiAnbXMnLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gU09VUkNFICYgVEFHUyA9PT1cbiAgICBzb3VyY2U6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdTb3VyY2UnLFxuICAgICAgaGVscFRleHQ6ICdTb3VyY2Ugb2YgdGhlIGV2ZW50IChlLmcuLCBzZXJ2aWNlIG5hbWUsIGZ1bmN0aW9uIG5hbWUpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIC8vIE5PVEU6IHRhZ3MsIG1ldHJpY3MsIGF0dHJpYnV0ZXMsIGRhdGEsIG1ldGFkYXRhLCBhY3RvciwgY29udGV4dCBhbGwgdXNlIHByb3BlcnRpZXM6e31cbiAgICAvLyBUaGlzIGlzIEJZIERFU0lHTiAtIHRoaXMgaXMgYSBVTklWRVJTQUwgc3RvcmUgZm9yIEFMTCBldmVudCB0eXBlcyAoc3BhbiwgYXVkaXQsXG4gICAgLy8gbWV0cmljLCB3b3JrZmxvdywgZGVjaXNpb24sIGFjY2VzcywgbG9nKS4gRWFjaCBoYXMgY29tcGxldGVseSBkaWZmZXJlbnQgcGF5bG9hZHMuXG4gICAgLy8gRWxlY3Ryb0RCIHByb3BlcnRpZXM6e30gPSBhY2NlcHQgYW55IG1hcCBzdHJ1Y3R1cmUgYXQgcnVudGltZS5cbiAgICB0YWdzOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnVGFncycsXG4gICAgICBoZWxwVGV4dDogJ0tleS12YWx1ZSB0YWdzIGZvciBjYXRlZ29yaXphdGlvbicsXG4gICAgfSxcblxuICAgIC8vID09PSBQQVlMT0FEUyAoc2NoZW1hbGVzcyBieSBkZXNpZ24gLSBkaWZmZXJlbnQgZXZlbnQgdHlwZXMgaGF2ZSBkaWZmZXJlbnQgc3RydWN0dXJlcykgPT09XG4gICAgbWV0cmljczoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ01ldHJpY3MnLFxuICAgICAgaGVscFRleHQ6ICdOdW1lcmljYWwgbWV0cmljcyBhbmQgbWVhc3VyZW1lbnRzJyxcbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdBdHRyaWJ1dGVzJyxcbiAgICAgIGhlbHBUZXh0OiAnQWRkaXRpb25hbCBzdHJ1Y3R1cmVkIGF0dHJpYnV0ZXMnLFxuICAgIH0sXG4gICAgZGF0YToge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0RhdGEnLFxuICAgICAgaGVscFRleHQ6ICdFdmVudC1zcGVjaWZpYyBkYXRhIHBheWxvYWQnLFxuICAgICAgY29tcHJlc3NlZDogeyB0aHJlc2hvbGQ6IDUwICogMTAyNCB9LCAvLyBGcmFtZXdvcmsgYXV0by1jb21wcmVzc2VzIGlmID4gNTBLQlxuICAgIH0sXG4gICAgbWV0YWRhdGE6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdNZXRhZGF0YScsXG4gICAgICBoZWxwVGV4dDogJ0FkZGl0aW9uYWwgbWV0YWRhdGEgYWJvdXQgdGhlIGV2ZW50JyxcbiAgICAgIGNvbXByZXNzZWQ6IHRydWUsIC8vIEZyYW1ld29yayBhdXRvLWNvbXByZXNzZXMgaWYgPiAxMEtCXG4gICAgfSxcbiAgICBlcnJvcjoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0Vycm9yJyxcbiAgICAgIGhlbHBUZXh0OiAnRXJyb3IgZGV0YWlscyBpZiB0aGUgb3BlcmF0aW9uIGZhaWxlZCcsXG4gICAgICAvLyBTdHJ1Y3R1cmU6IHsgdHlwZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmcsIHN0YWNrPzogc3RyaW5nLCBjb2RlPzogc3RyaW5nIH1cbiAgICB9LFxuICAgIGZpbmdlcnByaW50OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnRXJyb3IgRmluZ2VycHJpbnQnLFxuICAgICAgaGVscFRleHQ6ICdEZXRlcm1pbmlzdGljIGhhc2ggZm9yIGdyb3VwaW5nIHNhbWUgZXJyb3JzIGFjcm9zcyBpbnZvY2F0aW9ucyAoMTYgaGV4IGNoYXJzIGZyb20gU0hBLTI1NiknLFxuICAgICAgaXNMaW5rOiB0cnVlLFxuICAgICAgbGlua0NvbmZpZzoge1xuICAgICAgICByb3V0ZVBhdHRlcm46ICcvbGlzdC1vYnNlcnZhYmlsaXR5bG9nP2ZpbmdlcnByaW50LmVxPTpmaW5nZXJwcmludCcsXG4gICAgICAgIGRpc3BsYXlUZXh0OiAnVmlldyBTYW1lIEVycm9yIFBhdHRlcm4nLFxuICAgICAgfSxcbiAgICB9LFxuICAgIC8vID09PSBBQ1RPUiAoc3RvcmVkIGFzLWlzIGZyb20gZXhpc3RpbmcgQWN0b3IgdHlwZSkgPT09XG4gICAgYWN0b3I6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdBY3RvcicsXG4gICAgICBoZWxwVGV4dDogJ0luZm9ybWF0aW9uIGFib3V0IHdobyB0cmlnZ2VyZWQgdGhpcyBldmVudCcsXG4gICAgfSxcblxuICAgIC8vIE5PVEU6IEFic29yYmVkIGRhdGEgKG5vaXNlIHJlZHVjdGlvbiBzdW1tYXJpZXMpIGxpdmVzIGluc2lkZSBgZGF0YS5hYnNvcmJlZGAg4oCUIG5vIHNlcGFyYXRlIGF0dHJpYnV0ZS5cbiAgICAvLyBUaGUgYGRhdGFgIGZpZWxkIGFscmVhZHkgaGFzIGNvbXByZXNzaW9uIGNvbmZpZ3VyZWQsIHNvIGFic29yYmVkIGRhdGEgaXMgY292ZXJlZC5cblxuICAgIC8vID09PSBDT05URVhUID09PVxuICAgIGNvbnRleHQ6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdDb250ZXh0JyxcbiAgICAgIGhlbHBUZXh0OiAnRXhlY3V0aW9uIGNvbnRleHQgYW5kIGVudmlyb25tZW50IGluZm9ybWF0aW9uJyxcbiAgICB9LFxuXG4gICAgLy8gPT09IFRUTCA9PT1cbiAgICAvLyBUaWVyZWQgcmV0ZW50aW9uOiBUVEwgdmFyaWVzIGJ5IHNldmVyaXR5IGxldmVsLlxuICAgIC8vICAgZXJyb3IvY3JpdGljYWwgLT4gOTAgZGF5cywgd2FybiAtPiA2MCBkYXlzLCBpbmZvIC0+IDMwIGRheXMsIGRlYnVnL3RyYWNlIC0+IDcgZGF5c1xuICAgIHR0bDoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICBkZWZhdWx0OiAoKSA9PiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICg5MCAqIDI0ICogNjAgKiA2MCksIC8vIDkwIGRheXMgZmFsbGJhY2tcbiAgICAgIHdhdGNoOiBbICdsZXZlbCcgXSxcbiAgICAgIHNldDogKF86IHVua25vd24sIGRhdGE6IHsgbGV2ZWw/OiBzdHJpbmcgfSkgPT4ge1xuICAgICAgICBjb25zdCBTRUNPTkRTX1BFUl9EQVkgPSAyNCAqIDYwICogNjA7XG4gICAgICAgIGNvbnN0IG5vd1NlY29uZHMgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcbiAgICAgICAgY29uc3QgcmV0ZW50aW9uRGF5czogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHtcbiAgICAgICAgICBjcml0aWNhbDogOTAsXG4gICAgICAgICAgZXJyb3I6IDkwLFxuICAgICAgICAgIHdhcm46IDYwLFxuICAgICAgICAgIGluZm86IDMwLFxuICAgICAgICAgIGRlYnVnOiA3LFxuICAgICAgICAgIHRyYWNlOiA3LFxuICAgICAgICB9O1xuICAgICAgICBjb25zdCBkYXlzID0gcmV0ZW50aW9uRGF5c1sgZGF0YS5sZXZlbCA/PyAnJyBdID8/IDkwO1xuICAgICAgICByZXR1cm4gbm93U2Vjb25kcyArIChkYXlzICogU0VDT05EU19QRVJfREFZKTtcbiAgICAgIH0sXG4gICAgICBsYWJlbDogJ1RUTCcsXG4gICAgICBoZWxwVGV4dDogJ1RpZXJlZCByZXRlbnRpb246IGVycm9yL2NyaXRpY2FsIDkwZCwgd2FybiA2MGQsIGluZm8gMzBkLCBkZWJ1Zy90cmFjZSA3ZCcsXG4gICAgICBmaWVsZFR5cGU6ICd0dGwnLFxuICAgICAgdHRsVW5pdDogJ3NlY29uZHMnLFxuICAgICAgdHRsRm9ybWF0OiAnYXV0bycsXG4gICAgICBpc1Zpc2libGU6IHRydWUsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZSxcbiAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgfSxcbiAgfSxcbiAgaW5kZXhlczoge1xuICAgIC8vID09PSBJTkRFWCBERVNJR04gTk9URVMgPT09XG4gICAgLy8gMS4gUHJpbWFyeSBpbmRleCBoYXMgbm8gc29ydCBrZXkgLSBvbmx5IGZvciBzaW5nbGUtaXRlbSBsb29rdXBzIGJ5IElEXG4gICAgLy8gMi4gR1NJNyAoYWxsUmVjb3JkcykgcHJvdmlkZXMgc29ydGVkIGxpc3RpbmcgZm9yIHVuZmlsdGVyZWQgcXVlcmllc1xuICAgIC8vICAgIC0gVXNlcyBjb25zdGFudCBQSyB0ZW1wbGF0ZSB0byBncm91cCBhbGwgcmVjb3Jkc1xuICAgIC8vICAgIC0gU29ydGVkIGJ5IHRpbWVzdGFtcE1zIGZvciBlZmZpY2llbnQgY2hyb25vbG9naWNhbCBsaXN0aW5nXG4gICAgLy8gICAgLSBUcmFkZS1vZmY6IEhvdCBwYXJ0aXRpb24sIGJ1dCBhY2NlcHRhYmxlIGZvciBvYnNlcnZhYmlsaXR5IGxvZ3Mgd2l0aCBUVExcbiAgICAvLyAzLiBBbGwgb3RoZXIgR1NJcyBhcmUgZm9yIGZpbHRlcmVkIHF1ZXJpZXMgKGJ5IHRyYWNlLCBwYXJlbnQsIHR5cGUsIGxldmVsLCBldGMuKVxuXG4gICAgLy8gUHJpbWFyeSAtIGJ5IG9ic2VydmFiaWxpdHlMb2dJZFxuICAgIHByaW1hcnk6IHtcbiAgICAgIHBrOiB7IGZpZWxkOiAncGsnLCBjb21wb3NpdGU6IFsgJ29ic2VydmFiaWxpdHlMb2dJZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdzaycsIGNvbXBvc2l0ZTogW10gfSxcbiAgICB9LFxuICAgIC8vIEdTSTEgLSBieSB0cmFjZSAtIGdldCBhbGwgZXZlbnRzIGluIGEgcmVxdWVzdC90cmFjZVxuICAgIGJ5VHJhY2U6IHtcbiAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTFwaycsIGNvbXBvc2l0ZTogWyAnY29ycmVsYXRpb25JZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kxc2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0kyIC0gYnkgcGFyZW50IC0gZ2V0IGNoaWxkcmVuLCByZWNvbnN0cnVjdCBzcGFuIGhpZXJhcmNoeVxuICAgIGJ5UGFyZW50OiB7XG4gICAgICBpbmRleDogJ2dzaTInLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2kycGsnLCBjb21wb3NpdGU6IFsgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2kyc2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0kzIC0gYnkgdHlwZSAtIGZpbHRlciBieSBldmVudCB0eXBlIChzcGFuLiosIGF1ZGl0LiosIGxvZywgbWV0cmljKVxuICAgIGJ5VHlwZToge1xuICAgICAgaW5kZXg6ICdnc2kzJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpM3BrJywgY29tcG9zaXRlOiBbICd0eXBlJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTNzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTQgLSBieSBsZXZlbCAtIGZpbmQgZXJyb3JzL3dhcm5pbmdzIHF1aWNrbHlcbiAgICBieUxldmVsOiB7XG4gICAgICBpbmRleDogJ2dzaTQnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k0cGsnLCBjb21wb3NpdGU6IFsgJ2xldmVsJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTRzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTUgLSBieSBlbnRpdHkgdHlwZSAtIFwiYWxsIE9yZGVyIGV2ZW50c1wiLCBcImFsbCBVc2VyIGV2ZW50c1wiXG4gICAgYnlFbnRpdHlUeXBlOiB7XG4gICAgICBpbmRleDogJ2dzaTUnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k1cGsnLCBjb21wb3NpdGU6IFsgJ2VudGl0eU5hbWUnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNXNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNiAtIGJ5IGVudGl0eSBpbnN0YW5jZSAtIFwiYWxsIGV2ZW50cyBmb3IgT3JkZXI6MTIzXCJcbiAgICBieUVudGl0eToge1xuICAgICAgaW5kZXg6ICdnc2k2JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpNnBrJywgY29tcG9zaXRlOiBbICdlbnRpdHlOYW1lJywgJ2VudGl0eUlkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTZzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTcgLSBhbGwgcmVjb3JkcyBieSB0aW1lc3RhbXAgLSBmb3IgZWZmaWNpZW50IHNvcnRlZCBsaXN0aW5nIG9mIGFsbCBldmVudHNcbiAgICAvLyBVc2VzIGNvbnN0YW50IHBhcnRpdGlvbiBrZXkgdG8gZ3JvdXAgYWxsIHJlY29yZHMgdG9nZXRoZXJcbiAgICBhbGxSZWNvcmRzOiB7XG4gICAgICBpbmRleDogJ2dzaTcnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k3cGsnLCBjb21wb3NpdGU6IFtdLCB0ZW1wbGF0ZTogJ0FMTF9FVkVOVFMnIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTdzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTggLSBieSBjYXVzZWRCeSAtIGZpbmQgYWxsIGV2ZW50cyBjYXVzZWQgYnkgYSBzcGVjaWZpYyByZXF1ZXN0IChjcm9zcy1pbnZvY2F0aW9uIHRyYWNpbmcpXG4gICAgYnlDYXVzZWRCeToge1xuICAgICAgaW5kZXg6ICdnc2k4JyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpOHBrJywgY29tcG9zaXRlOiBbICdjYXVzZWRCeScgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k4c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k5IC0gYnkgZmluZ2VycHJpbnQgLSBncm91cCBzYW1lIGVycm9ycyBhY3Jvc3MgaW52b2NhdGlvbnNcbiAgICBieUZpbmdlcnByaW50OiB7XG4gICAgICBpbmRleDogJ2dzaTknLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k5cGsnLCBjb21wb3NpdGU6IFsgJ2ZpbmdlcnByaW50JyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTlzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEZvciBzb3VyY2UvYWN0b3IvdGVuYW50IHF1ZXJpZXMgLSB1c2Ugc2VhcmNoIGVuZ2luZSBzeW5jXG4gIH0sXG59IGFzIGNvbnN0KTtcblxuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYSA9IHR5cGVvZiBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hO1xuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVR5cGUgPSBFbnRpdHlUeXBlRnJvbVNjaGVtYTxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPjtcbmV4cG9ydCB0eXBlIE9ic2VydmFiaWxpdHlMb2dSZWNvcmRUeXBlID0gRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT47Il19