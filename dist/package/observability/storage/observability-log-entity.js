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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1sb2ctZW50aXR5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvc3RvcmFnZS9vYnNlcnZhYmlsaXR5LWxvZy1lbnRpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCxtQ0FBcUM7QUFDckMsZ0VBQWdFO0FBQ2hFLDBEQUF5STtBQUV6STs7Ozs7Ozs7Ozs7R0FXRztBQUNVLFFBQUEsNEJBQTRCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUM3RCxLQUFLLEVBQUU7UUFDTCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxrQkFBa0I7UUFDMUIsZ0JBQWdCLEVBQUUsbUJBQW1CO1FBQ3JDLE9BQU8sRUFBRSxlQUFlO1FBQ3hCLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6Qyx3Q0FBd0M7UUFDeEMsbUJBQW1CLEVBQUUsSUFBSTtRQUN6QixvQkFBb0IsRUFBRSxJQUFJO1FBQzFCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsc0JBQXNCLEVBQUUsSUFBSTtRQUM1QixzQkFBc0IsRUFBRSxJQUFJO1FBQzVCLE1BQU0sRUFBRTtZQUNOLE9BQU8sRUFBRSxLQUFLO1lBQ2QsV0FBVyxFQUFFO2dCQUNYLFVBQVUsRUFBRSxvQkFBb0I7YUFDakM7U0FDRjtRQUNELGtDQUFrQztRQUNsQyxjQUFjLEVBQUU7WUFDZCxXQUFXLEVBQUU7Z0JBQ1gscUNBQXFDO2dCQUNyQyx1RUFBdUU7Z0JBQ3ZFLFdBQVcsRUFBRSxFQUFFLEtBQUssRUFBRSxhQUFhLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRTtnQkFDcEQseURBQXlEO2dCQUN6RCxVQUFVLEVBQUU7b0JBQ1Y7d0JBQ0UsRUFBRSxFQUFFLFlBQVk7d0JBQ2hCLEtBQUssRUFBRSxZQUFZO3dCQUNuQixJQUFJLEVBQUUsbUJBQW1CO3dCQUN6QixPQUFPLEVBQUUsWUFBWTt3QkFDckIsaUVBQWlFO3dC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WSxFQUFFLFVBQVUsQ0FBRSxFQUFFO1lBQ2hFLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7U0FDdEQ7UUFDRCwrRUFBK0U7UUFDL0UsNERBQTREO1FBQzVELFVBQVUsRUFBRTtZQUNWLEtBQUssRUFBRSxNQUFNO1lBQ2IsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFLFFBQVEsRUFBRSxZQUFZLEVBQUU7WUFDOUQsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUUsRUFBRTtTQUN0RDtRQUNELCtGQUErRjtRQUMvRixVQUFVLEVBQUU7WUFDVixLQUFLLEVBQUUsTUFBTTtZQUNiLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsVUFBVSxDQUFFLEVBQUU7WUFDbEQsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUUsRUFBRTtTQUN0RDtRQUNELCtEQUErRDtRQUMvRCxhQUFhLEVBQUU7WUFDYixLQUFLLEVBQUUsTUFBTTtZQUNiLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUUsYUFBYSxDQUFFLEVBQUU7WUFDckQsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBRSxhQUFhLENBQUUsRUFBRTtTQUN0RDtRQUNELDJEQUEyRDtLQUM1RDtDQUNPLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eSBMb2cgRW50aXR5IFNjaGVtYVxuICogXG4gKiBEeW5hbW9EQiB0YWJsZSBzY2hlbWEgZm9yIHN0b3JpbmcgYWxsIG9ic2VydmFiaWxpdHkgZXZlbnRzLlxuICogVXNlZCBieSBPYnNlcnZhYmlsaXR5TG9nU2VydmljZSB3aGljaCBpcyBzZWxmLWNvbnRhaW5lZCAobm8gREkgZGVwZW5kZW5jeSkuXG4gKi9cblxuaW1wb3J0IHsgcmFuZG9tQnl0ZXMgfSBmcm9tICdjcnlwdG8nO1xuLy8gSW1wb3J0IGRpcmVjdGx5IGZyb20gYmFzZS1lbnRpdHkgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeVxuaW1wb3J0IHsgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIGNyZWF0ZUVudGl0eVNjaGVtYSwgRW50aXR5VHlwZUZyb21TY2hlbWEsIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcblxuLyoqXG4gKiBPYnNlcnZhYmlsaXR5IExvZyBFbnRpdHkgU2NoZW1hXG4gKiBcbiAqIFVuaXZlcnNhbCBzY2hlbWEgZm9yIGFsbCBvYnNlcnZhYmlsaXR5IGV2ZW50IHR5cGVzOlxuICogLSBzcGFuIC8gc3Bhbi5zdGFydCAoZGlzdHJpYnV0ZWQgdHJhY2luZylcbiAqIC0gYXVkaXQuZW50aXR5LCBhdWRpdC5hY3Rpb24sIGF1ZGl0LmNvbXBsaWFuY2UgKGF1ZGl0aW5nKVxuICogLSBtZXRyaWMgKG1ldHJpY3MvY291bnRlcnMpXG4gKiAtIHdvcmtmbG93LiogKHdvcmtmbG93IHRyYWNraW5nKVxuICogLSBkZWNpc2lvbi4qIChkZWNpc2lvbiBsb2dnaW5nKVxuICogLSBhY2Nlc3MgKEFQSSBhY2Nlc3MgbG9ncylcbiAqIC0gbG9nIChzdHJ1Y3R1cmVkIGxvZ2dpbmcpXG4gKi9cbmV4cG9ydCBjb25zdCBPYnNlcnZhYmlsaXR5TG9nRW50aXR5U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgbW9kZWw6IHtcbiAgICB2ZXJzaW9uOiAnMScsXG4gICAgZW50aXR5OiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgZW50aXR5TmFtZVBsdXJhbDogJ29ic2VydmFiaWxpdHlMb2dzJyxcbiAgICBzZXJ2aWNlOiAnb2JzZXJ2YWJpbGl0eScsXG4gICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgLy8gU3lzdGVtIGVudGl0eSAtIHJlYWQtb25seSBpbiBhZG1pbiBVSVxuICAgIGV4Y2x1ZGVBdWRpdEFjdGlvbnM6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbk1lbnU6IHRydWUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkNyZWF0ZTogdHJ1ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlOiB0cnVlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU6IHRydWUsXG4gICAgc2VhcmNoOiB7XG4gICAgICBlbmFibGVkOiBmYWxzZSxcbiAgICAgIGluZGV4Q29uZmlnOiB7XG4gICAgICAgIHByaW1hcnlLZXk6ICdvYnNlcnZhYmlsaXR5TG9nSWQnLFxuICAgICAgfVxuICAgIH0sXG4gICAgLy8gPT09IExJU1QgUEFHRSBDT05GSUdVUkFUSU9OID09PVxuICAgIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgICB0YWJsZUNvbmZpZzoge1xuICAgICAgICAvLyBEZWZhdWx0IHNvcnQ6IGxhdGVzdCByZWNvcmRzIGZpcnN0XG4gICAgICAgIC8vIFNlYXJjaCBtb2RlIHVzZXMgZnVsbCBjb25maWcsIERCIG1vZGUgZXh0cmFjdHMganVzdCB0aGUgJ2Rlc2MnIG9yZGVyXG4gICAgICAgIGRlZmF1bHRTb3J0OiB7IGZpZWxkOiAndGltZXN0YW1wTXMnLCBvcmRlcjogJ2Rlc2MnIH0sXG4gICAgICAgIC8vIFJvdyBhY3Rpb25zIC0gcXVpY2sgYWNjZXNzIHdpdGhvdXQgbG9zaW5nIGxpc3QgY29udGV4dFxuICAgICAgICByb3dBY3Rpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdxdWljay12aWV3JyxcbiAgICAgICAgICAgIGxhYmVsOiAnUXVpY2sgVmlldycsXG4gICAgICAgICAgICBpY29uOiAnRXhwYW5kQWx0T3V0bGluZWQnLFxuICAgICAgICAgICAgdG9vbHRpcDogJ1F1aWNrIFZpZXcnLFxuICAgICAgICAgICAgLy8gT3BlbiB2aWV3IHBhZ2UgaW4gbW9kYWwgLSBVUkwgd2lsbCBiZSByZXNvbHZlZCB0byBmZXRjaCBjb25maWdcbiAgICAgICAgICAgIHVybDogJy92aWV3LW9ic2VydmFiaWxpdHlsb2cvOm9ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgIG1vZGFsVGl0bGU6ICdMb2cgRGV0YWlscycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3ZpZXctdHJhY2UnLFxuICAgICAgICAgICAgbGFiZWw6ICdWaWV3IFRyYWNlJyxcbiAgICAgICAgICAgIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsXG4gICAgICAgICAgICB0b29sdGlwOiAnVmlldyBjb3JyZWxhdGVkIGxvZ3MnLFxuICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICBtb2RhbFRpdGxlOiAnVHJhY2UgTG9ncycsXG4gICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBjb3JyZWxhdGlvbklkOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBjb3JyZWxhdGlvbklkOiAnOmNvcnJlbGF0aW9uSWQnIH0sXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndmlldy1jaGlsZHJlbicsXG4gICAgICAgICAgICBsYWJlbDogJ1ZpZXcgQ2hpbGRyZW4nLFxuICAgICAgICAgICAgaWNvbjogJ0JyYW5jaGVzT3V0bGluZWQnLFxuICAgICAgICAgICAgdG9vbHRpcDogJ1ZpZXcgY2hpbGQgbG9ncycsXG4gICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgIG1vZGFsVGl0bGU6ICdDaGlsZCBMb2dzJyxcbiAgICAgICAgICAgIC8vIFNob3cgZm9yIGxvZ3MgdGhhdCBkb24ndCBoYXZlIGEgcGFyZW50IChyb290IGxvZ3MgbWF5IGhhdmUgY2hpbGRyZW4pXG4gICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHsgZXhpc3RzOiBmYWxzZSB9IH0gfSxcbiAgICAgICAgICAgIC8vIFVzZSBtb2RhbENvbmZpZ1JlZiB0byBoaWRlIGhpZXJhcmNoeSBzZWdtZW50cyAoY29uZmxpY3RzIHdpdGggcGFyZW50IGZpbHRlcilcbiAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICc6b2JzZXJ2YWJpbGl0eUxvZ0lkJyB9LFxuICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICAvLyBDb2x1bW5zIGZvciBxdWljayBzY2FubmluZyDigJQgZXNzZW50aWFsIGZpZWxkcyB2aXNpYmxlIGJ5IGRlZmF1bHRcbiAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgIHsgZmllbGQ6ICd0eXBlJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdsZXZlbCcgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnZW50aXR5TmFtZScgfSxcbiAgICAgICAgICB7IGZpZWxkOiAnc291cmNlJyB9LFxuICAgICAgICAgIHsgZmllbGQ6ICdvcGVyYXRpb24nIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ3N0YXR1cycgfSxcbiAgICAgICAgICB7IGZpZWxkOiAndGltZXN0YW1wTXMnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2R1cmF0aW9uTXMnIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2ZpbmdlcnByaW50JywgZGVmYXVsdFZpc2libGU6IGZhbHNlIH0sXG4gICAgICAgICAgeyBmaWVsZDogJ2NvcnJlbGF0aW9uSWQnLCBkZWZhdWx0VmlzaWJsZTogZmFsc2UgfSxcbiAgICAgICAgXSxcbiAgICAgICAgLy8gPT09IEZJTFRFUiBTRUdNRU5UUzogUXVpY2sgYWNjZXNzIHRvIGNvbW1vbiB2aWV3cyA9PT1cbiAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICAvLyA9PT0gQlkgSElFUkFSQ0hZID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnaGllcmFyY2h5LWdyb3VwJyxcbiAgICAgICAgICAgIGxhYmVsOiAnVmlldycsXG4gICAgICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaWQ6ICdhbGwtc3BhbnMnLCBsYWJlbDogJ0FsbCBFdmVudHMnLCBpY29uOiAnVW5vcmRlcmVkTGlzdE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7fSxcbiAgICAgICAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpZDogJ3Jvb3Qtb25seScsIGxhYmVsOiAnUm9vdCBTcGFucycsIGljb246ICdBcGFydG1lbnRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgLy8gRmlsdGVyOiBubyBwYXJlbnQgPSByb290IHNwYW5cbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IGZhbHNlIH0gfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGlkOiAnY2hpbGQtb25seScsIGxhYmVsOiAnQ2hpbGQgU3BhbnMnLCBpY29uOiAnQnJhbmNoZXNPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgLy8gRmlsdGVyOiBoYXMgcGFyZW50ID0gY2hpbGQgc3BhblxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGV4aXN0czogdHJ1ZSB9IH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLy8gPT09IEJZIExFVkVMID09PVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnbGV2ZWwtZ3JvdXAnLFxuICAgICAgICAgICAgbGFiZWw6ICdMZXZlbCcsXG4gICAgICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgICAgICB7IGlkOiAnYWxsLWxldmVscycsIGxhYmVsOiAnQWxsJywgZmlsdGVyczoge30sIGRlZmF1bHQ6IHRydWUgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ2Vycm9ycycsIGxhYmVsOiAnRXJyb3JzJywgaWNvbjogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAnZXJyb3InIH0gfSwgYmFkZ2VTdGF0dXM6ICdlcnJvcicgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ3dhcm5pbmdzJywgbGFiZWw6ICdXYXJuaW5ncycsIGljb246ICdXYXJuaW5nT3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAnd2FybicgfSB9LCBiYWRnZVN0YXR1czogJ3dhcm5pbmcnIH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdpbmZvJywgbGFiZWw6ICdJbmZvJywgaWNvbjogJ0luZm9DaXJjbGVPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICdpbmZvJyB9IH0gfSxcbiAgICAgICAgICAgICAgeyBpZDogJ2RlYnVnJywgbGFiZWw6ICdEZWJ1ZycsIGljb246ICdCdWdPdXRsaW5lZCcsIGZpbHRlcnM6IHsgbGV2ZWw6IHsgZXE6ICdkZWJ1ZycgfSB9IH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICd0cmFjZScsIGxhYmVsOiAnVHJhY2UnLCBpY29uOiAnQXBhcnRtZW50T3V0bGluZWQnLCBmaWx0ZXJzOiB7IGxldmVsOiB7IGVxOiAndHJhY2UnIH0gfSB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICBleHBhbmRhYmxlOiB7XG4gICAgICAgICAgbW9kZTogJ2pzb24nLFxuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gPT09IFZJRVcgUEFHRSBDT05GSUdVUkFUSU9OID09PVxuICAgIHZpZXdQYWdlQ29uZmlnOiB7XG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ3ZpZXctdHJhY2UnLFxuICAgICAgICAgIGxhYmVsOiAnVmlldyBGdWxsIFRyYWNlJyxcbiAgICAgICAgICBpY29uOiAnQXBhcnRtZW50T3V0bGluZWQnLFxuICAgICAgICAgIHRvb2x0aXA6ICdWaWV3IGFsbCBldmVudHMgaW4gdGhpcyB0cmFjZScsXG4gICAgICAgICAgdXJsOiAnL2xpc3Qtb2JzZXJ2YWJpbGl0eWxvZz9jb3JyZWxhdGlvbklkLmVxPTpjb3JyZWxhdGlvbklkJyxcbiAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBjb3JyZWxhdGlvbklkOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAndmlldy1wYXJlbnQnLFxuICAgICAgICAgIGxhYmVsOiAnR28gdG8gUGFyZW50JyxcbiAgICAgICAgICBpY29uOiAnQXJyb3dVcE91dGxpbmVkJyxcbiAgICAgICAgICB0b29sdGlwOiAnTmF2aWdhdGUgdG8gdGhlIHBhcmVudCBzcGFuJyxcbiAgICAgICAgICB1cmw6ICcvdmlldy1vYnNlcnZhYmlsaXR5bG9nLzpwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnLFxuICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ3ZpZXctc2FtZS1lcnJvcicsXG4gICAgICAgICAgbGFiZWw6ICdTYW1lIEVycm9yIFBhdHRlcm4nLFxuICAgICAgICAgIGljb246ICdCdWdPdXRsaW5lZCcsXG4gICAgICAgICAgdG9vbHRpcDogJ1ZpZXcgYWxsIG9jY3VycmVuY2VzIG9mIHRoaXMgZXJyb3IgZmluZ2VycHJpbnQnLFxuICAgICAgICAgIHVybDogJy9saXN0LW9ic2VydmFiaWxpdHlsb2c/ZmluZ2VycHJpbnQuZXE9OmZpbmdlcnByaW50JyxcbiAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBmaW5nZXJwcmludDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgLy8gVHdvLWNvbHVtbiBsYXlvdXQgZm9yIGVzc2VudGlhbCBpZGVudGlmaWNhdGlvbiBhbmQgb3BlcmF0aW9uIGRldGFpbHNcbiAgICAgIGNvbHVtbnNDb25maWc6IHtcbiAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgIGxhYmVsOiAnSWRlbnRpdHkgJiBDbGFzc2lmaWNhdGlvbicsXG4gICAgICAgICAgICBmaWVsZHM6IFtcbiAgICAgICAgICAgICAgJ29ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgICAgICd0eXBlJyxcbiAgICAgICAgICAgICAgJ3N1YlR5cGUnLFxuICAgICAgICAgICAgICAnbGV2ZWwnLFxuICAgICAgICAgICAgICAnY29ycmVsYXRpb25JZCcsICAvLyBIYXMgbGlua0NvbmZpZyAtIHJlbmRlcnMgYXMgbGluayB0byB0cmFjZSB2aWV3XG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgbGFiZWw6ICdPcGVyYXRpb24gJiBUaW1pbmcnLFxuICAgICAgICAgICAgZmllbGRzOiBbXG4gICAgICAgICAgICAgICdvcGVyYXRpb24nLFxuICAgICAgICAgICAgICAnc3RhdHVzJyxcbiAgICAgICAgICAgICAgJ3N1Y2Nlc3MnLFxuICAgICAgICAgICAgICAndGltZXN0YW1wTXMnLFxuICAgICAgICAgICAgICAnZHVyYXRpb25NcycsXG4gICAgICAgICAgICAgICdzb3VyY2UnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIC8vIFR3byBncm91cHM6IEV2ZW50IERldGFpbHMgKGFib3V0IHRoaXMgcmVjb3JkKSBhbmQgUmVsYXRpb25zIChuYXZpZ2F0aW9uIHRvIHJlbGF0ZWQgcmVjb3JkcykuXG4gICAgICAvLyBXaXRoaW4gZWFjaCBncm91cCwgdGFicyBoYW5kbGUgZG9tYWluIHNlcGFyYXRpb24uIFN0cnVjdHVyZWQgdmlld3MgY29tZSBmaXJzdCxcbiAgICAgIC8vIHJhdyBKU09OIGZhbGxiYWNrcyBhcmUgYWx3YXlzIGF2YWlsYWJsZSBhcyB0aGUgbGFzdCB0YWJzLlxuICAgICAgc2VjdGlvbnNDb25maWc6IHtcbiAgICAgICAgc2VjdGlvbkdyb3VwczogW1xuICAgICAgICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgICAgICAgIC8vIEdST1VQIDE6IEVWRU5UIERFVEFJTFMg4oCUIEV2ZXJ5dGhpbmcgYWJvdXQgdGhpcyBzcGVjaWZpYyBldmVudFxuICAgICAgICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnZXZlbnQtZGV0YWlscycsXG4gICAgICAgICAgICBsYWJlbDogJ0V2ZW50IERldGFpbHMnLFxuICAgICAgICAgICAgaWNvbjogJ0ZpbGVTZWFyY2hPdXRsaW5lZCcsXG4gICAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgICByZW5kZXJNb2RlOiAndGFicycsXG4gICAgICAgICAgICBkZWZhdWx0Q29sbGFwc2VkOiBmYWxzZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiBmYWxzZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiB0cnVlLFxuICAgICAgICAgICAgc2VjdGlvbnM6IHtcbiAgICAgICAgICAgICAgLy8gTk9URTogTm8gXCJPdmVydmlld1wiIHRhYiBoZXJlIOKAlCB0aGUgZGVmYXVsdCBlbnRpdHkgdmlldyBwYWdlIGFscmVhZHkgcmVuZGVyc1xuICAgICAgICAgICAgICAvLyBjb3JlIGZpZWxkcyAob3BlcmF0aW9uLCBzdGF0dXMsIHR5cGUsIHN1YlR5cGUsIGxldmVsLCB0aW1pbmcsIGV0Yy4pIHZpYSBjb2x1bW5zQ29uZmlnLlxuXG4gICAgICAgICAgICAgIC8vIC0tLSBFcnJvcjogc3RydWN0dXJlZCBicmVha2Rvd24gKyByYXcgLS0tXG4gICAgICAgICAgICAgIGVycm9yOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFcnJvcicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0V4Y2xhbWF0aW9uQ2lyY2xlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGVycm9yOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdlcnJvci50eXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdlcnJvci50eXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0Vycm9yIFR5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ1RoZSBjbGFzcy9jb25zdHJ1Y3RvciBuYW1lIG9mIHRoZSBlcnJvcicsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZXJyb3IubWVzc2FnZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZXJyb3IubWVzc2FnZScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdNZXNzYWdlJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ1RoZSBlcnJvciBtZXNzYWdlJyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdlcnJvci5jb2RlJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdlcnJvci5jb2RlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0Vycm9yIENvZGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0FwcGxpY2F0aW9uIG9yIHN5c3RlbSBlcnJvciBjb2RlIChlLmcuLCBFQ09OTlJFRlVTRUQsIFZBTElEQVRJT05fRkFJTEVEKScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2Vycm9yLmNvZGUnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdlcnJvci5zdGFjaycsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZXJyb3Iuc3RhY2snLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnU3RhY2sgVHJhY2UnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2NvZGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnRnVsbCBzdGFjayB0cmFjZSBmcm9tIHRoZSBlcnJvcicsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2Vycm9yLnN0YWNrJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIC8vIC0tLSBUaW1lbGluZTogc3BhbiBjaGVja3BvaW50cyAtLS1cbiAgICAgICAgICAgICAgdGltZWxpbmU6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1RpbWVsaW5lJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnTm9kZUluZGV4T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMixcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLmNoZWNrcG9pbnRzJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5jaGVja3BvaW50cycsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5jaGVja3BvaW50cycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdUaW1lbGluZSAmIENoZWNrcG9pbnRzJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0Nocm9ub2xvZ2ljYWwgdGltZWxpbmUgb2YgZXZlbnRzIHdpdGhpbiB0aGlzIHNwYW4uIEluY2x1ZGVzIG1hbnVhbCBjaGVja3BvaW50cyBhbmQgYWJzb3JiZWQgY2hpbGQgb3BlcmF0aW9ucy4nLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ3RpbWVsaW5lJyxcbiAgICAgICAgICAgICAgICAgICAgICB0aW1lbGluZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgbW9kZTogJ2xlZnQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2hvd1RpbWVzdGFtcDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcEZvcm1hdDogJ2g6bW06c3MuU1NTIEEnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaXRlbU1hcHBpbmc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWxGaWVsZDogJ25hbWUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXBGaWVsZDogJ3RzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZUZpZWxkOiAnX3R5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbkZpZWxkOiAnX2Rlc2NyaXB0aW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgLy8gLS0tIEF1ZGl0IERhdGE6IHN0cnVjdHVyZWQgdmlldyBmb3IgYXVkaXQuZW50aXR5IHJlY29yZHMgLS0tXG4gICAgICAgICAgICAgIGF1ZGl0RGF0YToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnQXVkaXQgRGF0YScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0F1ZGl0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMyxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIC8vIE9ubHkgc2hvdyBmb3IgYXVkaXQtdHlwZSByZWNvcmRzIChhdWRpdC5lbnRpdHksIGF1ZGl0LmNvbXBsaWFuY2UsIGF1ZGl0LmFjY2VzcylcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5hdWRpdCc6IHsgZXE6ICd0cnVlJyB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgICAgICAgICAgLy8gRW50aXR5IHVwZGF0ZTogYmVmb3JlIC8gYWZ0ZXIgLyBkaWZmXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5iZWZvcmUnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuYmVmb3JlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0JlZm9yZSAoT2xkIFN0YXRlKScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnanNvbicsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdFbnRpdHkgc3RhdGUgYmVmb3JlIHRoZSB1cGRhdGUnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLmJlZm9yZSc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEuYWZ0ZXInLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuYWZ0ZXInLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnQWZ0ZXIgKE5ldyBTdGF0ZSknLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2pzb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnRW50aXR5IHN0YXRlIGFmdGVyIHRoZSB1cGRhdGUnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLmFmdGVyJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5kaWZmJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdkYXRhLmRpZmYnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRGlmZicsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnanNvbicsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdDaGFuZ2VkIGZpZWxkcyB3aXRoIG9sZC9uZXcgdmFsdWVzJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5kaWZmJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIC8vIEVudGl0eSBjcmVhdGVcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLmNyZWF0ZWQnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuY3JlYXRlZCcsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdDcmVhdGVkIFJlY29yZCcsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnanNvbicsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdGdWxsIGRhdGEgb2YgdGhlIG5ld2x5IGNyZWF0ZWQgZW50aXR5JyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5jcmVhdGVkJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIC8vIEVudGl0eSBkZWxldGVcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLmRlbGV0ZWQnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2RhdGEuZGVsZXRlZCcsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdEZWxldGVkIFJlY29yZCcsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnanNvbicsXG4gICAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6ICdGdWxsIGRhdGEgb2YgdGhlIGVudGl0eSB0aGF0IHdhcyBkZWxldGVkJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnZGF0YS5kZWxldGVkJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIC8vIEVudGl0eSBsaXN0IHF1ZXJ5XG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5xdWVyeScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5xdWVyeScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdRdWVyeSBGaWx0ZXJzJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0ZpbHRlcnMgdXNlZCBpbiB0aGUgbGlzdC9xdWVyeSBvcGVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLnF1ZXJ5JzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5yZXN1bHRDb3VudCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5yZXN1bHRDb3VudCcsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdSZXN1bHQgQ291bnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ051bWJlciBvZiByZWNvcmRzIHJldHVybmVkIGJ5IHRoZSBxdWVyeScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2RhdGEucmVzdWx0Q291bnQnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgLy8gUmF3IGZhbGxiYWNrIOKAlCBmdWxsIGRhdGEgZm9yIGFueSBzaGFwZVxuICAgICAgICAgICAgICAgICAgICAnZGF0YScsXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIC8vIC0tLSBOb2lzZSBSZWR1Y3Rpb246IGFic29yYmVkIGV2ZW50IHN1bW1hcnkgLS0tXG4gICAgICAgICAgICAgIG5vaXNlUmVkdWN0aW9uOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdOb2lzZSBSZWR1Y3Rpb24nLFxuICAgICAgICAgICAgICAgIGljb246ICdDb21wcmVzc091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDQsXG5cbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLmFic29yYmVkJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5hYnNvcmJlZC5jb3VudCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5hYnNvcmJlZC5jb3VudCcsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnQWJzb3JiZWQgRXZlbnRzJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ1RvdGFsIGNoaWxkIGV2ZW50cyBhYnNvcmJlZCBpbnRvIHRoaXMgcmVjb3JkLiBQZXItb3BlcmF0aW9uIGJyZWFrZG93biBpcyBpbiB0aGUgVGltZWxpbmUgdGFiLicsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnZGF0YS5hYnNvcmJlZC5zaWxlbnRDb3VudCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5hYnNvcmJlZC5zaWxlbnRDb3VudCcsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnU2lsZW5jZWQgRXZlbnRzJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ1RvdGFsIGNoaWxkIGV2ZW50cyBzaWxlbnRseSBkcm9wcGVkIChjb3VudGVyIG9ubHkpJyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdkYXRhLmFic29yYmVkLmVycm9ycycsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5hYnNvcmJlZC5lcnJvcnMnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnQWJzb3JiZWQgRXJyb3JzJyxcbiAgICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogJ0Vycm9yIGRldGFpbHMgZnJvbSBhYnNvcmJlZCBjaGlsZCBldmVudHMnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2pzb24nLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLmFic29yYmVkLmVycm9ycyc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2RhdGEuYWJzb3JiZWQuY2F1c2VkQnlMaW5rcycsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnZGF0YS5hYnNvcmJlZC5jYXVzZWRCeUxpbmtzJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0Nyb3NzLUludm9jYXRpb24gTGlua3MnLFxuICAgICAgICAgICAgICAgICAgICAgIGhlbHBUZXh0OiAnQ29ycmVsYXRpb24gSURzIGZyb20gYWJzb3JiZWQgZXZlbnRzIGxpbmtpbmcgdG8gb3RoZXIgaW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2pzb24nLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdkYXRhLmFic29yYmVkLmNhdXNlZEJ5TGlua3MnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgLy8gLS0tIFRhZ3M6IHNpZ25hbCBiYWRnZXMgKyByYXcgSlNPTiAtLS1cbiAgICAgICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnVGFncycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ1RhZ091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDUsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyB0YWdzOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgICAgICAgICAgLy8gU3RydWN0dXJlZCBzaWduYWwgYmFkZ2VzIChlYWNoIGNvbmRpdGlvbmFsIOKAlCBvbmx5IHJlbmRlciB3aGVuIHByZXNlbnQpXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5odHRwLnN0YXR1c19jb2RlJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICd0YWdzLmh0dHAuc3RhdHVzX2NvZGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnSFRUUCBTdGF0dXMgQ29kZScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICd0YWdzLmh0dHAuc3RhdHVzX2NvZGUnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICd0YWdzLmh0dHAuc3RhdHVzX2NvZGVfY2xhc3MnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ3RhZ3MuaHR0cC5zdGF0dXNfY29kZV9jbGFzcycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdTdGF0dXMgQ2xhc3MnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5odHRwLnN0YXR1c19jb2RlX2NsYXNzJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5lcnJvcl9jYXRlZ29yeScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5lcnJvcl9jYXRlZ29yeScsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdFcnJvciBDYXRlZ29yeScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICd0YWdzLmVycm9yX2NhdGVnb3J5JzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5jb2xkX3N0YXJ0JyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICd0YWdzLmNvbGRfc3RhcnQnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnQ29sZCBTdGFydCcsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICd0YWdzLmNvbGRfc3RhcnQnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICd0YWdzLl9zbG93JyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICd0YWdzLl9zbG93JyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1Nsb3cnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5fc2xvdyc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhZ3MuX21lbW9yeV9wcmVzc3VyZScsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAndGFncy5fbWVtb3J5X3ByZXNzdXJlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ01lbW9yeSBQcmVzc3VyZScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICd0YWdzLl9tZW1vcnlfcHJlc3N1cmUnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICd0YWdzLl90aW1lb3V0X3Jpc2snLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ3RhZ3MuX3RpbWVvdXRfcmlzaycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdUaW1lb3V0IFJpc2snLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAndGFncy5fdGltZW91dF9yaXNrJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5zcXMuaGFzX3JldHJpZXMnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ3RhZ3Muc3FzLmhhc19yZXRyaWVzJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1NRUyBSZXRyaWVzJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdiYWRnZScsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ3RhZ3Muc3FzLmhhc19yZXRyaWVzJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAndGFncy5xdWVyeV90eXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICd0YWdzLnF1ZXJ5X3R5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnUXVlcnkgVHlwZScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnYmFkZ2UnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICd0YWdzLnF1ZXJ5X3R5cGUnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICd0YWdzLmxhbWJkYS5mdW5jdGlvbl9uYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICd0YWdzLmxhbWJkYS5mdW5jdGlvbl9uYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0xhbWJkYSBGdW5jdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAndGV4dCcsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ3RhZ3MubGFtYmRhLmZ1bmN0aW9uX25hbWUnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgLy8gUmF3IGZhbGxiYWNrIOKAlCBmdWxsIHRhZ3MgSlNPTiBhbHdheXMgYXQgdGhlIGJvdHRvbVxuICAgICAgICAgICAgICAgICAgICAndGFncycsXG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIC8vIC0tLSBNZXRyaWNzOiBrZXkgdmFsdWVzICsgcmF3IEpTT04gLS0tXG4gICAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ01ldHJpY3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdEYXNoYm9hcmRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA2LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgbWV0cmljczogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgIC8vIFN0cnVjdHVyZWQga2V5IG1ldHJpY3MgKGVhY2ggY29uZGl0aW9uYWwpXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnbWV0cmljcy5kdXJhdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnbWV0cmljcy5kdXJhdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdEdXJhdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnZHVyYXRpb24nLFxuICAgICAgICAgICAgICAgICAgICAgIGR1cmF0aW9uVW5pdDogJ21zJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnbWV0cmljcy5kdXJhdGlvbic6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ21ldHJpY3Muc3Bhbi5kZXB0aCcsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnbWV0cmljcy5zcGFuLmRlcHRoJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1NwYW4gRGVwdGgnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnbWV0cmljcy5zcGFuLmRlcHRoJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnbWV0cmljcy5pbnZvY2F0aW9uX251bWJlcicsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnbWV0cmljcy5pbnZvY2F0aW9uX251bWJlcicsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdJbnZvY2F0aW9uICMnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnbWV0cmljcy5pbnZvY2F0aW9uX251bWJlcic6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ21ldHJpY3MuaHR0cC5yZXF1ZXN0X2NvbnRlbnRfbGVuZ3RoJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdtZXRyaWNzLmh0dHAucmVxdWVzdF9jb250ZW50X2xlbmd0aCcsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdSZXF1ZXN0IFNpemUgKGJ5dGVzKScsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnbWV0cmljcy5odHRwLnJlcXVlc3RfY29udGVudF9sZW5ndGgnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdtZXRyaWNzLmh0dHAucmVzcG9uc2VfY29udGVudF9sZW5ndGgnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ21ldHJpY3MuaHR0cC5yZXNwb25zZV9jb250ZW50X2xlbmd0aCcsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdSZXNwb25zZSBTaXplIChieXRlcyknLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ251bWJlcicsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ21ldHJpY3MuaHR0cC5yZXNwb25zZV9jb250ZW50X2xlbmd0aCc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ21ldHJpY3Mubm9kZS5oZWFwX3VzZWRfbWInLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ21ldHJpY3Mubm9kZS5oZWFwX3VzZWRfbWInLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnSGVhcCBVc2VkIChNQiknLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ251bWJlcicsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ21ldHJpY3Mubm9kZS5oZWFwX3VzZWRfbWInOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdtZXRyaWNzLmxhbWJkYS5yZW1haW5pbmdfdGltZV9tcycsXG4gICAgICAgICAgICAgICAgICAgICAgY29sdW1uOiAnbWV0cmljcy5sYW1iZGEucmVtYWluaW5nX3RpbWVfbXMnLFxuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnTGFtYmRhIFJlbWFpbmluZyBUaW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICdkdXJhdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgZHVyYXRpb25Vbml0OiAnbXMnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdtZXRyaWNzLmxhbWJkYS5yZW1haW5pbmdfdGltZV9tcyc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAvLyBSYXcgZmFsbGJhY2sg4oCUIGZ1bGwgbWV0cmljcyBKU09OIGFsd2F5cyBhdCB0aGUgYm90dG9tXG4gICAgICAgICAgICAgICAgICAgICdtZXRyaWNzJyxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgLy8gLS0tIEV2ZW50IFBheWxvYWQ6IHJhdyBkYXRhIC0tLVxuICAgICAgICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdQYXlsb2FkJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnRmlsZVRleHRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA3LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgZGF0YTogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbICdkYXRhJyBdLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIC8vIC0tLSBBY3Rvcjogc3RydWN0dXJlZCArIHJhdyAtLS1cbiAgICAgICAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0FjdG9yJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnVXNlck91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDgsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBhY3RvcjogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnYWN0b3JUeXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdhY3Rvci50eXBlJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0FjdG9yIFR5cGUnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2JhZGdlJyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnYWN0b3IudHlwZSc6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2FjdG9ySWQnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2FjdG9yLmlkJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0FjdG9yIElEJyxcbiAgICAgICAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyAnYWN0b3IuaWQnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6ICdhY3RvckVtYWlsJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdhY3Rvci5lbWFpbCcsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdFbWFpbCcsXG4gICAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiAndGV4dCcsXG4gICAgICAgICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgJ2FjdG9yLmVtYWlsJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnYWN0b3JOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICBjb2x1bW46ICdhY3Rvci5uYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ05hbWUnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdhY3Rvci5uYW1lJzogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnYWN0b3JHcm91cHMnLFxuICAgICAgICAgICAgICAgICAgICAgIGNvbHVtbjogJ2FjdG9yLmdyb3VwcycsXG4gICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdHcm91cHMnLFxuICAgICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ2pzb24nLFxuICAgICAgICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7ICdhY3Rvci5ncm91cHMnOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgLy8gUmF3IGZhbGxiYWNrIOKAlCBhbHdheXMgc2hvd3MgZnVsbCBhY3RvciBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgJ2FjdG9yJyxcbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgLy8gLS0tIFJhdzogYWxsIHJlbWFpbmluZyBmaWVsZHMsIGFsd2F5cyB2aXNpYmxlIC0tLVxuICAgICAgICAgICAgICByYXc6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1JhdyAvIE90aGVyJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQ29kZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDksXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdkZXRhaWxzJyxcbiAgICAgICAgICAgICAgICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgdXNlUGFyZW50RGF0YTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgICAgICAgICAgJ2F0dHJpYnV0ZXMnLFxuICAgICAgICAgICAgICAgICAgICAnbWV0YWRhdGEnLFxuICAgICAgICAgICAgICAgICAgICAnY29udGV4dCcsXG4gICAgICAgICAgICAgICAgICAgICd0dGwnLFxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgICAgICAgIC8vIEdST1VQIDI6IEhJRVJBUkNIWSAmIFRSQUNFIChzcGFuIHRyZWUgbmF2aWdhdGlvbilcbiAgICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2hpZXJhcmNoeS1yZWxhdGlvbnMnLFxuICAgICAgICAgICAgbGFiZWw6ICdIaWVyYXJjaHkgJiBUcmFjZScsXG4gICAgICAgICAgICBpY29uOiAnQXBhcnRtZW50T3V0bGluZWQnLFxuICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgcmVuZGVyTW9kZTogJ3RhYnMnLFxuICAgICAgICAgICAgZGVmYXVsdENvbGxhcHNlZDogdHJ1ZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiB0cnVlLFxuICAgICAgICAgICAga2VlcE1vdW50ZWQ6IGZhbHNlLFxuICAgICAgICAgICAgc2VjdGlvbnM6IHtcbiAgICAgICAgICAgICAgaGllcmFyY2h5SW5mbzoge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnSGllcmFyY2h5IEluZm8nLFxuICAgICAgICAgICAgICAgIGljb246ICdOb2RlSW5kZXhPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAwLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHVzZVBhcmVudERhdGE6IHRydWUsXG4gICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICAgICAgICAgICAgICAgICdpc1Jvb3QnLFxuICAgICAgICAgICAgICAgICAgICAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyxcbiAgICAgICAgICAgICAgICAgICAgJ2NvcnJlbGF0aW9uSWQnLFxuICAgICAgICAgICAgICAgICAgICAnY2F1c2VkQnknLFxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBwYXJlbnRTcGFuOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdQYXJlbnQgU3BhbicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0Fycm93VXBPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnZGV0YWlscycsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAndmlldycsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogeyBzb3VyY2U6ICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnLCB0YXJnZXQ6ICdpZCcgfSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgc2libGluZ1NwYW5zOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdTaWJsaW5nIFNwYW5zJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnQmxvY2tPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAyLFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBlcTogJzpwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIH0sXG4gICAgICAgICAgICAgICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IG5lOiAnOm9ic2VydmFiaWxpdHlMb2dJZCcgfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnT3RoZXIgc3BhbnMgYXQgdGhlIHNhbWUgaGllcmFyY2h5IGxldmVsIChzYW1lIHBhcmVudCknLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBjaGlsZFNwYW5zOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdDaGlsZCBTcGFucycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0JyYW5jaGVzT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMyxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyBlcTogJzpvYnNlcnZhYmlsaXR5TG9nSWQnIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHJvb3RTcGFuOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdSb290IG9mIEhpZXJhcmNoeScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0dhdGV3YXlPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA0LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgaXNSb290OiB7IGVxOiBmYWxzZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHsgZXE6ICc6Y29ycmVsYXRpb25JZCcgfSxcbiAgICAgICAgICAgICAgICAgICAgICBpc1Jvb3Q6IHsgZXE6IHRydWUgfSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVGhlIHJvb3Qgc3BhbiB0aGF0IHN0YXJ0ZWQgdGhpcyB0cmFjZSBoaWVyYXJjaHknLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB0cmFjZUxvZ3M6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0FsbCBpbiBUaGlzIFRyYWNlJyxcbiAgICAgICAgICAgICAgICBpY29uOiAnU2hhcmVBbHRPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA1LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgY29ycmVsYXRpb25JZDogeyBleGlzdHM6IHRydWUgfSB9IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgY29ycmVsYXRpb25JZDogeyBlcTogJzpjb3JyZWxhdGlvbklkJyB9IH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0FsbCBldmVudHMgaW4gdGhpcyBMYW1iZGEgaW52b2NhdGlvbicsXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGNhdXNlZEJ5VHJhY2U6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0NhdXNpbmcgUmVxdWVzdCBUcmFjZScsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0xpbmtPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA4LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgdmlzaWJpbGl0eTogeyByZWNvcmQ6IHsgY2F1c2VkQnk6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IGNvcnJlbGF0aW9uSWQ6IHsgZXE6ICc6Y2F1c2VkQnknIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgaGlkZVNlZ21lbnRzOiBbICdoaWVyYXJjaHktZ3JvdXAnIF0sXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVmlldyB0aGUgb3JpZ2luYWwgcmVxdWVzdCB0cmFjZSB0aGF0IGNhdXNlZCB0aGlzIGV2ZW50JyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY2F1c2VkRXZlbnRzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFdmVudHMgQ2F1c2VkIEJ5IFRoaXMnLFxuICAgICAgICAgICAgICAgIGljb246ICdBcGlPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiA5LFxuICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnUmVmOiB7XG4gICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHsgY2F1c2VkQnk6IHsgZXE6ICc6Y29ycmVsYXRpb25JZCcgfSB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdFdmVudHMgaW4gb3RoZXIgaW52b2NhdGlvbnMgY2F1c2VkIGJ5IHRoaXMgcmVxdWVzdCcsXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHNhbWVFcnJvclBhdHRlcm46IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1NhbWUgRXJyb3IgUGF0dGVybicsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0J1Z091dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDkuNSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGZpbmdlcnByaW50OiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBmaW5nZXJwcmludDogeyBlcTogJzpmaW5nZXJwcmludCcgfSB9LFxuICAgICAgICAgICAgICAgICAgICBoaWRlU2VnbWVudHM6IFsgJ2hpZXJhcmNoeS1ncm91cCcgXSxcbiAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdBbGwgb2NjdXJyZW5jZXMgb2YgdGhpcyBzYW1lIGVycm9yIHBhdHRlcm4gYWNyb3NzIHRpbWUnLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICByZWxhdGVkVHJhY2VzOiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdSZWxhdGVkIFRyYWNlcycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0NsdXN0ZXJPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgc29ydE9yZGVyOiAxMCxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2RldGFpbHMnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IHJlbGF0ZWRUcmFjZXM6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogWyAncmVsYXRlZFRyYWNlcycgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgICAgICAgIC8vIEdST1VQIDM6IFJFTEFURUQgTE9HUyAoRW50aXR5ICYgU291cmNlIGFuYWx5dGljcylcbiAgICAgICAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3JlbGF0ZWQtYW5hbHl0aWNzJyxcbiAgICAgICAgICAgIGxhYmVsOiAnUmVsYXRlZCBMb2dzJyxcbiAgICAgICAgICAgIGljb246ICdGdW5kT3V0bGluZWQnLFxuICAgICAgICAgICAgc29ydE9yZGVyOiAzLFxuICAgICAgICAgICAgcmVuZGVyTW9kZTogJ3RhYnMnLFxuICAgICAgICAgICAgZGVmYXVsdENvbGxhcHNlZDogdHJ1ZSxcbiAgICAgICAgICAgIGxhenlMb2FkOiBmYWxzZSxcbiAgICAgICAgICAgIGtlZXBNb3VudGVkOiBmYWxzZSxcbiAgICAgICAgICAgIHNlY3Rpb25zOiB7XG4gICAgICAgICAgICAgIGJ5RW50aXR5OiB7XG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFbnRpdHkgTG9ncycsXG4gICAgICAgICAgICAgICAgaWNvbjogJ0RhdGFiYXNlT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgIHNvcnRPcmRlcjogMSxcbiAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgIHZpc2liaWxpdHk6IHsgcmVjb3JkOiB7IGVudGl0eU5hbWU6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJzplbnRpdHlOYW1lJyxcbiAgICAgICAgICAgICAgICAgICAgICBlbnRpdHlJZDogJzplbnRpdHlJZCcsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBieUVudGl0eVR5cGU6IHtcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0VudGl0eSBUeXBlIExvZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdBcHBzdG9yZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBlbnRpdHlOYW1lOiB7IGV4aXN0czogdHJ1ZSB9IH0gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlDb25maWdSZWY6IHtcbiAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogeyBlbnRpdHlOYW1lOiAnOmVudGl0eU5hbWUnIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBieVNvdXJjZToge1xuICAgICAgICAgICAgICAgIGxhYmVsOiAnU291cmNlIExvZ3MnLFxuICAgICAgICAgICAgICAgIGljb246ICdDb2RlU2FuZGJveE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICB2aXNpYmlsaXR5OiB7IHJlY29yZDogeyBzb3VyY2U6IHsgZXhpc3RzOiB0cnVlIH0gfSB9LFxuICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZ1JlZjoge1xuICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7IHNvdXJjZTogJzpzb3VyY2UnIH0sXG4gICAgICAgICAgICAgICAgICAgIGhpZGVTZWdtZW50czogWyAnaGllcmFyY2h5LWdyb3VwJyBdLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICBhdHRyaWJ1dGVzOiB7XG4gICAgLy8gPT09IElERU5USVRZID09PVxuICAgIG9ic2VydmFiaWxpdHlMb2dJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgIC8vIDEyOC1iaXQgZmFsbGJhY2sgZm9yIG1hbnVhbC9hZG1pbi1jcmVhdGVkIHJlY29yZHMgKGZyYW1ld29yayBnZW5lcmFsbHkgc3VwcGxpZXMgb2JzZXJ2YWJpbGl0eUxvZ0lkIGV4cGxpY2l0bHkpLlxuICAgICAgZGVmYXVsdDogKCkgPT4gcmFuZG9tQnl0ZXMoMTYpLnRvU3RyaW5nKCdoZXgnKSxcbiAgICAgIGxhYmVsOiAnTG9nIElEJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ1BhcmVudCBMb2cgSUQnLFxuICAgICAgaGVscFRleHQ6ICdSZWZlcmVuY2UgdG8gcGFyZW50IHNwYW4gZm9yIGhpZXJhcmNoaWNhbCB0cmFjaW5nJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIC8vIFNlbGYtcmVmZXJlbnRpYWwgcmVsYXRpb24gdG8gcGFyZW50IG9ic2VydmFiaWxpdHkgbG9nXG4gICAgICByZWxhdGlvbjoge1xuICAgICAgICBlbnRpdHlOYW1lOiAnb2JzZXJ2YWJpbGl0eUxvZycsXG4gICAgICAgIHR5cGU6ICdtYW55LXRvLW9uZScsXG4gICAgICAgIGlkZW50aWZpZXJzOiB7IHNvdXJjZTogJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsIHRhcmdldDogJ29ic2VydmFiaWxpdHlMb2dJZCcgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBDb21wdXRlZCBmaWVsZDogdHJ1ZSBpZiB0aGlzIGlzIGEgcm9vdCBzcGFuIChubyBwYXJlbnQpXG4gICAgLy8gVXNlZCBmb3IgZWZmaWNpZW50IEdTSSBxdWVyaWVzIGluc3RlYWQgb2Ygbm90RXhpc3RzIGZpbHRlclxuICAgIGlzUm9vdDoge1xuICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgbGFiZWw6ICdJcyBSb290JyxcbiAgICAgIGhlbHBUZXh0OiAnVHJ1ZSBpZiB0aGlzIGlzIGEgcm9vdCBzcGFuIChubyBwYXJlbnQpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIHdhdGNoOiBbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF0sXG4gICAgICAvLyBTZXQgdG8gdHJ1ZSB3aGVuIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBpcyBudWxsL3VuZGVmaW5lZFxuICAgICAgc2V0OiAoXzogdW5rbm93biwgZGF0YTogeyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ/OiBzdHJpbmcgfSkgPT5cbiAgICAgICAgIWRhdGEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgZGVmYXVsdDogKCkgPT4gdHJ1ZSwgIC8vIERlZmF1bHQgdG8gdHJ1ZSBpZiBubyBwYXJlbnQgc3BlY2lmaWVkXG4gICAgfSxcbiAgICAvLyBOT1RFOiBjb3JyZWxhdGlvbklkIGlzIFJFUVVJUkVEIGFuZCBoYXMgTk8gZGVmYXVsdC5cbiAgICAvLyBJZiB5b3UncmUgZ2V0dGluZyB2YWxpZGF0aW9uIGVycm9ycywgZW5zdXJlIGNvbnRleHQgaXMgZXN0YWJsaXNoZWQgKGF1dG8gaW4gY29udHJvbGxlcnMpLlxuICAgIC8vIEhhdmluZyBhIGRlZmF1bHQgaGVyZSB3b3VsZCBoaWRlIGJ1Z3Mgd2hlcmUgY29udGV4dCB3YXNuJ3QgcHJvcGVybHkgZXN0YWJsaXNoZWQuXG4gICAgY29ycmVsYXRpb25JZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIGxhYmVsOiAnQ29ycmVsYXRpb24gSUQnLFxuICAgICAgaGVscFRleHQ6ICdVbmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIGVudGlyZSByZXF1ZXN0L3RyYWNlJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIC8vIE5PIERFRkFVTFQgLSBtdXN0IGJlIHByb3BhZ2F0ZWQgZnJvbSBjb250ZXh0XG4gICAgICAvLyBMaW5rIHRvIGZpbHRlcmVkIGxpc3Qgc2hvd2luZyBhbGwgbG9ncyBpbiB0aGUgc2FtZSB0cmFjZVxuICAgICAgaXNMaW5rOiB0cnVlLFxuICAgICAgbGlua0NvbmZpZzoge1xuICAgICAgICByb3V0ZVBhdHRlcm46ICcvbGlzdC1vYnNlcnZhYmlsaXR5bG9nP2NvcnJlbGF0aW9uSWQuZXE9OmNvcnJlbGF0aW9uSWQnLFxuICAgICAgICBkaXNwbGF5VGV4dDogJ1ZpZXcgQ29ycmVsYXRlZCBMb2dzJyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBDcm9zcy1pbnZvY2F0aW9uIHRyYWNpbmc6IENvcnJlbGF0aW9uIElEIHRoYXQgY2F1c2VkIHRoaXMgZXZlbnRcbiAgICAvLyBFeGFtcGxlOiBEeW5hbW9EQiBzdHJlYW0gYXVkaXQgY2F1c2VkIGJ5IG9yaWdpbmFsIEFQSSByZXF1ZXN0XG4gICAgY2F1c2VkQnk6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgbGFiZWw6ICdDYXVzZWQgQnknLFxuICAgICAgaGVscFRleHQ6ICdDb3JyZWxhdGlvbiBJRCB0aGF0IGNhdXNlZCB0aGlzIGV2ZW50IChjcm9zcy1pbnZvY2F0aW9uIHRyYWNpbmcpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzTGluazogdHJ1ZSxcbiAgICAgIGxpbmtDb25maWc6IHtcbiAgICAgICAgcm91dGVQYXR0ZXJuOiAnL2xpc3Qtb2JzZXJ2YWJpbGl0eWxvZz9jb3JyZWxhdGlvbklkLmVxPTpjYXVzZWRCeScsXG4gICAgICAgIGRpc3BsYXlUZXh0OiAnVmlldyBDYXVzaW5nIFJlcXVlc3QnLFxuICAgICAgfSxcbiAgICB9LFxuICAgIC8vIEFsbCByZWxhdGVkIHRyYWNlIElEcyBmb3IgY29tcGxleCB3b3JrZmxvd3NcbiAgICByZWxhdGVkVHJhY2VzOiB7XG4gICAgICB0eXBlOiAnbGlzdCcsXG4gICAgICBpdGVtczogeyB0eXBlOiAnc3RyaW5nJyB9LFxuICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgbGFiZWw6ICdSZWxhdGVkIFRyYWNlcycsXG4gICAgICBoZWxwVGV4dDogJ0FsbCByZWxhdGVkIGNvcnJlbGF0aW9uIElEcyBmb3IgY29tcGxleCB3b3JrZmxvd3Mgc3Bhbm5pbmcgbXVsdGlwbGUgaW52b2NhdGlvbnMnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiBmYWxzZSwgLy8gTGlzdCBmaWVsZCwgbm90IGZpbHRlcmFibGVcbiAgICB9LFxuXG4gICAgLy8gPT09IENMQVNTSUZJQ0FUSU9OID09PVxuICAgIHR5cGU6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBsYWJlbDogJ1R5cGUnLFxuICAgICAgaGVscFRleHQ6ICdFdmVudCB0eXBlIChzcGFuLCBhdWRpdC5lbnRpdHksIGxvZywgbWV0cmljLCBldGMuKScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc1NvcnRhYmxlOiB0cnVlLFxuICAgIH0sXG4gICAgc3ViVHlwZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ1N1Yi1UeXBlJyxcbiAgICAgIGhlbHBUZXh0OiAnQWRkaXRpb25hbCB0eXBlIGNsYXNzaWZpY2F0aW9uJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIC8vIE5PVEU6IGxldmVsIGlzIFJFUVVJUkVEIGFuZCBoYXMgTk8gZGVmYXVsdC5cbiAgICAvLyBUaGUgb2JzZXJ2ZXIgTVVTVCBzcGVjaWZ5IHRoZSBsZXZlbCBleHBsaWNpdGx5LlxuICAgIGxldmVsOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgbGFiZWw6ICdMZXZlbCcsXG4gICAgICBoZWxwVGV4dDogJ1NldmVyaXR5IGxldmVsOiBlcnJvciwgd2FybiwgaW5mbywgZGVidWcnLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgaXNTb3J0YWJsZTogdHJ1ZSxcbiAgICAgIC8vIE5PIERFRkFVTFQgLSBtdXN0IGJlIHNwZWNpZmllZCBieSBvYnNlcnZlclxuICAgIH0sXG5cbiAgICAvLyA9PT0gRU5USVRZIENPTlRFWFQgPT09XG4gICAgZW50aXR5TmFtZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ0VudGl0eSBOYW1lJyxcbiAgICAgIGhlbHBUZXh0OiAnTmFtZSBvZiB0aGUgZW50aXR5IHRoaXMgZXZlbnQgcmVsYXRlcyB0bycsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc1NvcnRhYmxlOiB0cnVlLFxuICAgIH0sXG4gICAgZW50aXR5SWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdFbnRpdHkgSUQnLFxuICAgICAgaGVscFRleHQ6ICdJRCBvZiB0aGUgc3BlY2lmaWMgZW50aXR5IGluc3RhbmNlJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIC8vIERlZmF1bHQgdG8gJ18nIHdoZW4gZW50aXR5TmFtZSBpcyBzZXQgYnV0IGVudGl0eUlkIGlzIG5vdCAocmVxdWlyZWQgZm9yIGJ5RW50aXR5IGNvbXBvc2l0ZSBpbmRleClcbiAgICAgIHdhdGNoOiBbICdlbnRpdHlOYW1lJyBdLFxuICAgICAgc2V0OiAoXzogdW5rbm93biwgZGF0YTogeyBlbnRpdHlOYW1lPzogc3RyaW5nOyBlbnRpdHlJZD86IHN0cmluZyB9KSA9PlxuICAgICAgICBkYXRhLmVudGl0eUlkIHx8IChkYXRhLmVudGl0eU5hbWUgPyAnXycgOiB1bmRlZmluZWQpLFxuICAgICAgLy8gRHluYW1pYyBsaW5rIHRvIHRoZSByZWxhdGVkIGVudGl0eSBiYXNlZCBvbiBlbnRpdHlOYW1lXG4gICAgICBsaW5rQ29uZmlnOiB7XG4gICAgICAgIHJvdXRlUGF0dGVybjogJy92aWV3LTplbnRpdHlOYW1lLzplbnRpdHlJZCcsXG4gICAgICAgIGRpc3BsYXlUZXh0OiAnVmlldyB7ZW50aXR5TmFtZX0nLFxuICAgICAgfSxcbiAgICB9LFxuXG4gICAgLy8gPT09IE9QRVJBVElPTiA9PT1cbiAgICBvcGVyYXRpb246IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdPcGVyYXRpb24nLFxuICAgICAgaGVscFRleHQ6ICdUaGUgb3BlcmF0aW9uIGJlaW5nIHBlcmZvcm1lZCAoZS5nLiwgY3JlYXRlLCB1cGRhdGUsIHF1ZXJ5KScsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc1NvcnRhYmxlOiB0cnVlLFxuICAgIH0sXG4gICAgc3RhdHVzOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGxhYmVsOiAnU3RhdHVzJyxcbiAgICAgIGhlbHBUZXh0OiAnT3BlcmF0aW9uIHN0YXR1cyAoZS5nLiwgc3RhcnRlZCwgY29tcGxldGVkLCBmYWlsZWQpJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICB9LFxuICAgIHN1Y2Nlc3M6IHtcbiAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgIGxhYmVsOiAnU3VjY2VzcycsXG4gICAgICBoZWxwVGV4dDogJ1doZXRoZXIgdGhlIG9wZXJhdGlvbiBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGZpZWxkVHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgYm9vbGVhbkxhYmVsczogeyB0cnVlOiAnU3VjY2VzcycsIGZhbHNlOiAnRmFpbGVkJyB9LFxuICAgIH0sXG5cbiAgICAvLyA9PT0gVElNSU5HID09PVxuICAgIHRpbWVzdGFtcE1zOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgZGVmYXVsdDogKCkgPT4gRGF0ZS5ub3coKSxcbiAgICAgIGxhYmVsOiAnVGltZXN0YW1wJyxcbiAgICAgIGhlbHBUZXh0OiAnRXZlbnQgdGltZXN0YW1wIGluIG1pbGxpc2Vjb25kcyBzaW5jZSBlcG9jaCcsXG4gICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICBpc1NvcnRhYmxlOiB0cnVlLFxuICAgICAgZmllbGRUeXBlOiAnZGF0ZXRpbWUnLFxuICAgIH0sXG4gICAgZHVyYXRpb25Nczoge1xuICAgICAgdHlwZTogJ251bWJlcicsXG4gICAgICBsYWJlbDogJ0R1cmF0aW9uIChtcyknLFxuICAgICAgaGVscFRleHQ6ICdPcGVyYXRpb24gZHVyYXRpb24gaW4gbWlsbGlzZWNvbmRzJyxcbiAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgIGlzU29ydGFibGU6IHRydWUsXG4gICAgICBmaWVsZFR5cGU6ICdkdXJhdGlvbicsXG4gICAgICBkdXJhdGlvblVuaXQ6ICdtcycsXG4gICAgfSxcblxuICAgIC8vID09PSBTT1VSQ0UgJiBUQUdTID09PVxuICAgIHNvdXJjZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBsYWJlbDogJ1NvdXJjZScsXG4gICAgICBoZWxwVGV4dDogJ1NvdXJjZSBvZiB0aGUgZXZlbnQgKGUuZy4sIHNlcnZpY2UgbmFtZSwgZnVuY3Rpb24gbmFtZSknLFxuICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgIH0sXG4gICAgLy8gTk9URTogdGFncywgbWV0cmljcywgYXR0cmlidXRlcywgZGF0YSwgbWV0YWRhdGEsIGFjdG9yLCBjb250ZXh0IGFsbCB1c2UgcHJvcGVydGllczp7fVxuICAgIC8vIFRoaXMgaXMgQlkgREVTSUdOIC0gdGhpcyBpcyBhIFVOSVZFUlNBTCBzdG9yZSBmb3IgQUxMIGV2ZW50IHR5cGVzIChzcGFuLCBhdWRpdCxcbiAgICAvLyBtZXRyaWMsIHdvcmtmbG93LCBkZWNpc2lvbiwgYWNjZXNzLCBsb2cpLiBFYWNoIGhhcyBjb21wbGV0ZWx5IGRpZmZlcmVudCBwYXlsb2Fkcy5cbiAgICAvLyBFbGVjdHJvREIgcHJvcGVydGllczp7fSA9IGFjY2VwdCBhbnkgbWFwIHN0cnVjdHVyZSBhdCBydW50aW1lLlxuICAgIHRhZ3M6IHtcbiAgICAgIHR5cGU6ICdhbnknLFxuICAgICAgbGFiZWw6ICdUYWdzJyxcbiAgICAgIGhlbHBUZXh0OiAnS2V5LXZhbHVlIHRhZ3MgZm9yIGNhdGVnb3JpemF0aW9uJyxcbiAgICB9LFxuXG4gICAgLy8gPT09IFBBWUxPQURTIChzY2hlbWFsZXNzIGJ5IGRlc2lnbiAtIGRpZmZlcmVudCBldmVudCB0eXBlcyBoYXZlIGRpZmZlcmVudCBzdHJ1Y3R1cmVzKSA9PT1cbiAgICBtZXRyaWNzOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnTWV0cmljcycsXG4gICAgICBoZWxwVGV4dDogJ051bWVyaWNhbCBtZXRyaWNzIGFuZCBtZWFzdXJlbWVudHMnLFxuICAgIH0sXG4gICAgYXR0cmlidXRlczoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0F0dHJpYnV0ZXMnLFxuICAgICAgaGVscFRleHQ6ICdBZGRpdGlvbmFsIHN0cnVjdHVyZWQgYXR0cmlidXRlcycsXG4gICAgfSxcbiAgICBkYXRhOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnRGF0YScsXG4gICAgICBoZWxwVGV4dDogJ0V2ZW50LXNwZWNpZmljIGRhdGEgcGF5bG9hZCcsXG4gICAgICBjb21wcmVzc2VkOiB7IHRocmVzaG9sZDogNTAgKiAxMDI0IH0sIC8vIEZyYW1ld29yayBhdXRvLWNvbXByZXNzZXMgaWYgPiA1MEtCXG4gICAgfSxcbiAgICBtZXRhZGF0YToge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ01ldGFkYXRhJyxcbiAgICAgIGhlbHBUZXh0OiAnQWRkaXRpb25hbCBtZXRhZGF0YSBhYm91dCB0aGUgZXZlbnQnLFxuICAgICAgY29tcHJlc3NlZDogdHJ1ZSwgLy8gRnJhbWV3b3JrIGF1dG8tY29tcHJlc3NlcyBpZiA+IDEwS0JcbiAgICB9LFxuICAgIGVycm9yOiB7XG4gICAgICB0eXBlOiAnYW55JyxcbiAgICAgIGxhYmVsOiAnRXJyb3InLFxuICAgICAgaGVscFRleHQ6ICdFcnJvciBkZXRhaWxzIGlmIHRoZSBvcGVyYXRpb24gZmFpbGVkJyxcbiAgICAgIC8vIFN0cnVjdHVyZTogeyB0eXBlOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZywgc3RhY2s/OiBzdHJpbmcsIGNvZGU/OiBzdHJpbmcgfVxuICAgIH0sXG4gICAgZmluZ2VycHJpbnQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgbGFiZWw6ICdFcnJvciBGaW5nZXJwcmludCcsXG4gICAgICBoZWxwVGV4dDogJ0RldGVybWluaXN0aWMgaGFzaCBmb3IgZ3JvdXBpbmcgc2FtZSBlcnJvcnMgYWNyb3NzIGludm9jYXRpb25zICgxNiBoZXggY2hhcnMgZnJvbSBTSEEtMjU2KScsXG4gICAgICBpc0xpbms6IHRydWUsXG4gICAgICBsaW5rQ29uZmlnOiB7XG4gICAgICAgIHJvdXRlUGF0dGVybjogJy9saXN0LW9ic2VydmFiaWxpdHlsb2c/ZmluZ2VycHJpbnQuZXE9OmZpbmdlcnByaW50JyxcbiAgICAgICAgZGlzcGxheVRleHQ6ICdWaWV3IFNhbWUgRXJyb3IgUGF0dGVybicsXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gPT09IEFDVE9SIChzdG9yZWQgYXMtaXMgZnJvbSBleGlzdGluZyBBY3RvciB0eXBlKSA9PT1cbiAgICBhY3Rvcjoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0FjdG9yJyxcbiAgICAgIGhlbHBUZXh0OiAnSW5mb3JtYXRpb24gYWJvdXQgd2hvIHRyaWdnZXJlZCB0aGlzIGV2ZW50JyxcbiAgICB9LFxuXG4gICAgLy8gTk9URTogQWJzb3JiZWQgZGF0YSAobm9pc2UgcmVkdWN0aW9uIHN1bW1hcmllcykgbGl2ZXMgaW5zaWRlIGBkYXRhLmFic29yYmVkYCDigJQgbm8gc2VwYXJhdGUgYXR0cmlidXRlLlxuICAgIC8vIFRoZSBgZGF0YWAgZmllbGQgYWxyZWFkeSBoYXMgY29tcHJlc3Npb24gY29uZmlndXJlZCwgc28gYWJzb3JiZWQgZGF0YSBpcyBjb3ZlcmVkLlxuXG4gICAgLy8gPT09IENPTlRFWFQgPT09XG4gICAgY29udGV4dDoge1xuICAgICAgdHlwZTogJ2FueScsXG4gICAgICBsYWJlbDogJ0NvbnRleHQnLFxuICAgICAgaGVscFRleHQ6ICdFeGVjdXRpb24gY29udGV4dCBhbmQgZW52aXJvbm1lbnQgaW5mb3JtYXRpb24nLFxuICAgIH0sXG5cbiAgICAvLyA9PT0gVFRMID09PVxuICAgIC8vIFRpZXJlZCByZXRlbnRpb246IFRUTCB2YXJpZXMgYnkgc2V2ZXJpdHkgbGV2ZWwuXG4gICAgLy8gICBlcnJvci9jcml0aWNhbCAtPiA5MCBkYXlzLCB3YXJuIC0+IDYwIGRheXMsIGluZm8gLT4gMzAgZGF5cywgZGVidWcvdHJhY2UgLT4gNyBkYXlzXG4gICAgdHRsOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIGRlZmF1bHQ6ICgpID0+IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDkwICogMjQgKiA2MCAqIDYwKSwgLy8gOTAgZGF5cyBmYWxsYmFja1xuICAgICAgd2F0Y2g6IFsgJ2xldmVsJyBdLFxuICAgICAgc2V0OiAoXzogdW5rbm93biwgZGF0YTogeyBsZXZlbD86IHN0cmluZyB9KSA9PiB7XG4gICAgICAgIGNvbnN0IFNFQ09ORFNfUEVSX0RBWSA9IDI0ICogNjAgKiA2MDtcbiAgICAgICAgY29uc3Qgbm93U2Vjb25kcyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICAgICAgICBjb25zdCByZXRlbnRpb25EYXlzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge1xuICAgICAgICAgIGNyaXRpY2FsOiA5MCxcbiAgICAgICAgICBlcnJvcjogOTAsXG4gICAgICAgICAgd2FybjogNjAsXG4gICAgICAgICAgaW5mbzogMzAsXG4gICAgICAgICAgZGVidWc6IDcsXG4gICAgICAgICAgdHJhY2U6IDcsXG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGRheXMgPSByZXRlbnRpb25EYXlzWyBkYXRhLmxldmVsID8/ICcnIF0gPz8gOTA7XG4gICAgICAgIHJldHVybiBub3dTZWNvbmRzICsgKGRheXMgKiBTRUNPTkRTX1BFUl9EQVkpO1xuICAgICAgfSxcbiAgICAgIGxhYmVsOiAnVFRMJyxcbiAgICAgIGhlbHBUZXh0OiAnVGllcmVkIHJldGVudGlvbjogZXJyb3IvY3JpdGljYWwgOTBkLCB3YXJuIDYwZCwgaW5mbyAzMGQsIGRlYnVnL3RyYWNlIDdkJyxcbiAgICAgIGZpZWxkVHlwZTogJ3R0bCcsXG4gICAgICB0dGxVbml0OiAnc2Vjb25kcycsXG4gICAgICB0dGxGb3JtYXQ6ICdhdXRvJyxcbiAgICAgIGlzVmlzaWJsZTogdHJ1ZSxcbiAgICAgIGlzRWRpdGFibGU6IGZhbHNlLFxuICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICB9LFxuICB9LFxuICBpbmRleGVzOiB7XG4gICAgLy8gPT09IElOREVYIERFU0lHTiBOT1RFUyA9PT1cbiAgICAvLyAxLiBQcmltYXJ5IGluZGV4IGhhcyBubyBzb3J0IGtleSAtIG9ubHkgZm9yIHNpbmdsZS1pdGVtIGxvb2t1cHMgYnkgSURcbiAgICAvLyAyLiBHU0k3IChhbGxSZWNvcmRzKSBwcm92aWRlcyBzb3J0ZWQgbGlzdGluZyBmb3IgdW5maWx0ZXJlZCBxdWVyaWVzXG4gICAgLy8gICAgLSBVc2VzIGNvbnN0YW50IFBLIHRlbXBsYXRlIHRvIGdyb3VwIGFsbCByZWNvcmRzXG4gICAgLy8gICAgLSBTb3J0ZWQgYnkgdGltZXN0YW1wTXMgZm9yIGVmZmljaWVudCBjaHJvbm9sb2dpY2FsIGxpc3RpbmdcbiAgICAvLyAgICAtIFRyYWRlLW9mZjogSG90IHBhcnRpdGlvbiwgYnV0IGFjY2VwdGFibGUgZm9yIG9ic2VydmFiaWxpdHkgbG9ncyB3aXRoIFRUTFxuICAgIC8vIDMuIEFsbCBvdGhlciBHU0lzIGFyZSBmb3IgZmlsdGVyZWQgcXVlcmllcyAoYnkgdHJhY2UsIHBhcmVudCwgdHlwZSwgbGV2ZWwsIGV0Yy4pXG5cbiAgICAvLyBQcmltYXJ5IC0gYnkgb2JzZXJ2YWJpbGl0eUxvZ0lkXG4gICAgcHJpbWFyeToge1xuICAgICAgcGs6IHsgZmllbGQ6ICdwaycsIGNvbXBvc2l0ZTogWyAnb2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ3NrJywgY29tcG9zaXRlOiBbXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJMSAtIGJ5IHRyYWNlIC0gZ2V0IGFsbCBldmVudHMgaW4gYSByZXF1ZXN0L3RyYWNlXG4gICAgYnlUcmFjZToge1xuICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpMXBrJywgY29tcG9zaXRlOiBbICdjb3JyZWxhdGlvbklkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTFzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTIgLSBieSBwYXJlbnQgLSBnZXQgY2hpbGRyZW4sIHJlY29uc3RydWN0IHNwYW4gaGllcmFyY2h5XG4gICAgYnlQYXJlbnQ6IHtcbiAgICAgIGluZGV4OiAnZ3NpMicsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTJwaycsIGNvbXBvc2l0ZTogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaTJzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTMgLSBieSB0eXBlIC0gZmlsdGVyIGJ5IGV2ZW50IHR5cGUgKHNwYW4uKiwgYXVkaXQuKiwgbG9nLCBtZXRyaWMpXG4gICAgYnlUeXBlOiB7XG4gICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2kzcGsnLCBjb21wb3NpdGU6IFsgJ3R5cGUnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpM3NrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNCAtIGJ5IGxldmVsIC0gZmluZCBlcnJvcnMvd2FybmluZ3MgcXVpY2tseVxuICAgIGJ5TGV2ZWw6IHtcbiAgICAgIGluZGV4OiAnZ3NpNCcsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTRwaycsIGNvbXBvc2l0ZTogWyAnbGV2ZWwnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNHNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNSAtIGJ5IGVudGl0eSB0eXBlIC0gXCJhbGwgT3JkZXIgZXZlbnRzXCIsIFwiYWxsIFVzZXIgZXZlbnRzXCJcbiAgICBieUVudGl0eVR5cGU6IHtcbiAgICAgIGluZGV4OiAnZ3NpNScsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTVwaycsIGNvbXBvc2l0ZTogWyAnZW50aXR5TmFtZScgXSB9LFxuICAgICAgc2s6IHsgZmllbGQ6ICdnc2k1c2snLCBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0sXG4gICAgfSxcbiAgICAvLyBHU0k2IC0gYnkgZW50aXR5IGluc3RhbmNlIC0gXCJhbGwgZXZlbnRzIGZvciBPcmRlcjoxMjNcIlxuICAgIGJ5RW50aXR5OiB7XG4gICAgICBpbmRleDogJ2dzaTYnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k2cGsnLCBjb21wb3NpdGU6IFsgJ2VudGl0eU5hbWUnLCAnZW50aXR5SWQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpNnNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJNyAtIGFsbCByZWNvcmRzIGJ5IHRpbWVzdGFtcCAtIGZvciBlZmZpY2llbnQgc29ydGVkIGxpc3Rpbmcgb2YgYWxsIGV2ZW50c1xuICAgIC8vIFVzZXMgY29uc3RhbnQgcGFydGl0aW9uIGtleSB0byBncm91cCBhbGwgcmVjb3JkcyB0b2dldGhlclxuICAgIGFsbFJlY29yZHM6IHtcbiAgICAgIGluZGV4OiAnZ3NpNycsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTdwaycsIGNvbXBvc2l0ZTogW10sIHRlbXBsYXRlOiAnQUxMX0VWRU5UUycgfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpN3NrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gR1NJOCAtIGJ5IGNhdXNlZEJ5IC0gZmluZCBhbGwgZXZlbnRzIGNhdXNlZCBieSBhIHNwZWNpZmljIHJlcXVlc3QgKGNyb3NzLWludm9jYXRpb24gdHJhY2luZylcbiAgICBieUNhdXNlZEJ5OiB7XG4gICAgICBpbmRleDogJ2dzaTgnLFxuICAgICAgcGs6IHsgZmllbGQ6ICdnc2k4cGsnLCBjb21wb3NpdGU6IFsgJ2NhdXNlZEJ5JyBdIH0sXG4gICAgICBzazogeyBmaWVsZDogJ2dzaThzaycsIGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSxcbiAgICB9LFxuICAgIC8vIEdTSTkgLSBieSBmaW5nZXJwcmludCAtIGdyb3VwIHNhbWUgZXJyb3JzIGFjcm9zcyBpbnZvY2F0aW9uc1xuICAgIGJ5RmluZ2VycHJpbnQ6IHtcbiAgICAgIGluZGV4OiAnZ3NpOScsXG4gICAgICBwazogeyBmaWVsZDogJ2dzaTlwaycsIGNvbXBvc2l0ZTogWyAnZmluZ2VycHJpbnQnIF0gfSxcbiAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpOXNrJywgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9LFxuICAgIH0sXG4gICAgLy8gRm9yIHNvdXJjZS9hY3Rvci90ZW5hbnQgcXVlcmllcyAtIHVzZSBzZWFyY2ggZW5naW5lIHN5bmNcbiAgfSxcbn0gYXMgY29uc3QpO1xuXG5leHBvcnQgdHlwZSBPYnNlcnZhYmlsaXR5TG9nU2NoZW1hID0gdHlwZW9mIE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWE7XG5leHBvcnQgdHlwZSBPYnNlcnZhYmlsaXR5TG9nRW50aXR5VHlwZSA9IEVudGl0eVR5cGVGcm9tU2NoZW1hPE9ic2VydmFiaWxpdHlMb2dTY2hlbWE+O1xuZXhwb3J0IHR5cGUgT2JzZXJ2YWJpbGl0eUxvZ1JlY29yZFR5cGUgPSBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYTxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPjsiXX0=