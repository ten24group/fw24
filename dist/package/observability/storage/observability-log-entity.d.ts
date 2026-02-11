/**
 * Observability Log Entity Schema
 *
 * DynamoDB table schema for storing all observability events.
 * Used by ObservabilityLogService which is self-contained (no DI dependency).
 */
import { EntityTypeFromSchema, EntityRecordTypeFromSchema } from '../../entity/base-entity';
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
export declare const ObservabilityLogEntitySchema: {
    readonly model: {
        readonly version: "1";
        readonly entity: "observabilityLog";
        readonly entityNamePlural: "observabilityLogs";
        readonly service: "observability";
        readonly entityOperations: {
            readonly get: "get";
            readonly list: "list";
            readonly query: "query";
            readonly create: "create";
            readonly upsert: "upsert";
            readonly update: "update";
            readonly delete: "delete";
            readonly duplicate: "duplicate";
        };
        readonly excludeAuditActions: true;
        readonly excludeFromAdminMenu: true;
        readonly excludeFromAdminCreate: true;
        readonly excludeFromAdminUpdate: true;
        readonly excludeFromAdminDelete: true;
        readonly search: {
            readonly enabled: false;
            readonly indexConfig: {
                readonly primaryKey: "observabilityLogId";
            };
        };
        readonly listPageConfig: {
            readonly tableConfig: {
                readonly defaultSort: {
                    readonly field: "timestampMs";
                    readonly order: "desc";
                };
                readonly rowActions: [{
                    readonly id: "quick-view";
                    readonly label: "Quick View";
                    readonly icon: "ExpandAltOutlined";
                    readonly tooltip: "Quick View";
                    readonly url: "/view-observabilitylog/:observabilityLogId";
                    readonly openInModal: true;
                    readonly modalTitle: "Log Details";
                }, {
                    readonly id: "view-trace";
                    readonly label: "View Trace";
                    readonly icon: "ApartmentOutlined";
                    readonly tooltip: "View correlated logs";
                    readonly openInModal: true;
                    readonly modalTitle: "Trace Logs";
                    readonly visibility: {
                        readonly record: {
                            readonly correlationId: {
                                readonly exists: true;
                            };
                        };
                    };
                    readonly modalConfigRef: {
                        readonly entityName: "observabilityLog";
                        readonly pageType: "list";
                        readonly overrideConfig: {
                            readonly defaultFilters: {
                                readonly correlationId: ":correlationId";
                            };
                        };
                    };
                }, {
                    readonly id: "view-children";
                    readonly label: "View Children";
                    readonly icon: "BranchesOutlined";
                    readonly tooltip: "View child logs";
                    readonly openInModal: true;
                    readonly modalTitle: "Child Logs";
                    readonly visibility: {
                        readonly record: {
                            readonly parentObservabilityLogId: {
                                readonly exists: false;
                            };
                        };
                    };
                    readonly modalConfigRef: {
                        readonly entityName: "observabilityLog";
                        readonly pageType: "list";
                        readonly overrideConfig: {
                            readonly defaultFilters: {
                                readonly parentObservabilityLogId: ":observabilityLogId";
                            };
                            readonly hideSegments: ["hierarchy-group"];
                        };
                    };
                }];
                readonly columns: [{
                    readonly field: "type";
                }, {
                    readonly field: "level";
                }, {
                    readonly field: "entityName";
                }, {
                    readonly field: "source";
                }, {
                    readonly field: "operation";
                }, {
                    readonly field: "status";
                }, {
                    readonly field: "timestampMs";
                }, {
                    readonly field: "durationMs";
                }, {
                    readonly field: "fingerprint";
                    readonly defaultVisible: false;
                }, {
                    readonly field: "correlationId";
                    readonly defaultVisible: false;
                }];
                readonly segments: [{
                    readonly id: "hierarchy-group";
                    readonly label: "View";
                    readonly segments: [{
                        readonly id: "all-spans";
                        readonly label: "All Events";
                        readonly icon: "UnorderedListOutlined";
                        readonly filters: {};
                        readonly default: true;
                    }, {
                        readonly id: "root-only";
                        readonly label: "Root Spans";
                        readonly icon: "ApartmentOutlined";
                        readonly filters: {
                            readonly parentObservabilityLogId: {
                                readonly exists: false;
                            };
                        };
                    }, {
                        readonly id: "child-only";
                        readonly label: "Child Spans";
                        readonly icon: "BranchesOutlined";
                        readonly filters: {
                            readonly parentObservabilityLogId: {
                                readonly exists: true;
                            };
                        };
                    }];
                }, {
                    readonly id: "level-group";
                    readonly label: "Level";
                    readonly segments: [{
                        readonly id: "all-levels";
                        readonly label: "All";
                        readonly filters: {};
                        readonly default: true;
                    }, {
                        readonly id: "errors";
                        readonly label: "Errors";
                        readonly icon: "CloseCircleOutlined";
                        readonly filters: {
                            readonly level: {
                                readonly eq: "error";
                            };
                        };
                        readonly badgeStatus: "error";
                    }, {
                        readonly id: "warnings";
                        readonly label: "Warnings";
                        readonly icon: "WarningOutlined";
                        readonly filters: {
                            readonly level: {
                                readonly eq: "warn";
                            };
                        };
                        readonly badgeStatus: "warning";
                    }, {
                        readonly id: "info";
                        readonly label: "Info";
                        readonly icon: "InfoCircleOutlined";
                        readonly filters: {
                            readonly level: {
                                readonly eq: "info";
                            };
                        };
                    }, {
                        readonly id: "debug";
                        readonly label: "Debug";
                        readonly icon: "BugOutlined";
                        readonly filters: {
                            readonly level: {
                                readonly eq: "debug";
                            };
                        };
                    }, {
                        readonly id: "trace";
                        readonly label: "Trace";
                        readonly icon: "ApartmentOutlined";
                        readonly filters: {
                            readonly level: {
                                readonly eq: "trace";
                            };
                        };
                    }];
                }];
                readonly expandable: {
                    readonly mode: "json";
                };
            };
        };
        readonly viewPageConfig: {
            readonly actions: [{
                readonly id: "view-trace";
                readonly label: "View Full Trace";
                readonly icon: "ApartmentOutlined";
                readonly tooltip: "View all events in this trace";
                readonly url: "/list-observabilitylog?correlationId.eq=:correlationId";
                readonly visibility: {
                    readonly record: {
                        readonly correlationId: {
                            readonly exists: true;
                        };
                    };
                };
            }, {
                readonly id: "view-parent";
                readonly label: "Go to Parent";
                readonly icon: "ArrowUpOutlined";
                readonly tooltip: "Navigate to the parent span";
                readonly url: "/view-observabilitylog/:parentObservabilityLogId";
                readonly visibility: {
                    readonly record: {
                        readonly parentObservabilityLogId: {
                            readonly exists: true;
                        };
                    };
                };
            }, {
                readonly id: "view-same-error";
                readonly label: "Same Error Pattern";
                readonly icon: "BugOutlined";
                readonly tooltip: "View all occurrences of this error fingerprint";
                readonly url: "/list-observabilitylog?fingerprint.eq=:fingerprint";
                readonly visibility: {
                    readonly record: {
                        readonly fingerprint: {
                            readonly exists: true;
                        };
                    };
                };
            }];
            readonly columnsConfig: {
                readonly columns: [{
                    readonly sortOrder: 1;
                    readonly label: "Identity & Classification";
                    readonly fields: ["observabilityLogId", "type", "subType", "level", "correlationId"];
                }, {
                    readonly sortOrder: 2;
                    readonly label: "Operation & Timing";
                    readonly fields: ["operation", "status", "success", "timestampMs", "durationMs", "source"];
                }];
            };
            readonly sectionsConfig: {
                readonly sectionGroups: [{
                    readonly id: "event-details";
                    readonly label: "Event Details";
                    readonly icon: "FileSearchOutlined";
                    readonly sortOrder: 1;
                    readonly renderMode: "tabs";
                    readonly defaultCollapsed: false;
                    readonly lazyLoad: false;
                    readonly keepMounted: true;
                    readonly sections: {
                        readonly error: {
                            readonly label: "Error";
                            readonly icon: "ExclamationCircleOutlined";
                            readonly sortOrder: 1;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly error: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: [{
                                    readonly name: "error.type";
                                    readonly column: "error.type";
                                    readonly label: "Error Type";
                                    readonly fieldType: "badge";
                                    readonly helpText: "The class/constructor name of the error";
                                }, {
                                    readonly name: "error.message";
                                    readonly column: "error.message";
                                    readonly label: "Message";
                                    readonly fieldType: "text";
                                    readonly helpText: "The error message";
                                }, {
                                    readonly name: "error.code";
                                    readonly column: "error.code";
                                    readonly label: "Error Code";
                                    readonly fieldType: "badge";
                                    readonly helpText: "Application or system error code (e.g., ECONNREFUSED, VALIDATION_FAILED)";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'error.code': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "error.stack";
                                    readonly column: "error.stack";
                                    readonly label: "Stack Trace";
                                    readonly fieldType: "code";
                                    readonly helpText: "Full stack trace from the error";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'error.stack': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }];
                            };
                        };
                        readonly timeline: {
                            readonly label: "Timeline";
                            readonly icon: "NodeIndexOutlined";
                            readonly sortOrder: 2;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly 'data.checkpoints': {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: [{
                                    readonly name: "data.checkpoints";
                                    readonly column: "data.checkpoints";
                                    readonly label: "Timeline & Checkpoints";
                                    readonly helpText: "Chronological timeline of events within this span. Includes manual checkpoints and absorbed child operations.";
                                    readonly fieldType: "timeline";
                                    readonly timelineConfig: {
                                        readonly mode: "left";
                                        readonly showTimestamp: true;
                                        readonly timestampFormat: "h:mm:ss.SSS A";
                                        readonly itemMapping: {
                                            readonly labelField: "name";
                                            readonly timestampField: "ts";
                                            readonly typeField: "_type";
                                            readonly descriptionField: "_description";
                                        };
                                    };
                                }];
                            };
                        };
                        readonly auditData: {
                            readonly label: "Audit Data";
                            readonly icon: "AuditOutlined";
                            readonly sortOrder: 3;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly 'tags.audit': {
                                        readonly eq: "true";
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: [{
                                    readonly name: "data.before";
                                    readonly column: "data.before";
                                    readonly label: "Before (Old State)";
                                    readonly fieldType: "json";
                                    readonly helpText: "Entity state before the update";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'data.before': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "data.after";
                                    readonly column: "data.after";
                                    readonly label: "After (New State)";
                                    readonly fieldType: "json";
                                    readonly helpText: "Entity state after the update";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'data.after': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "data.diff";
                                    readonly column: "data.diff";
                                    readonly label: "Diff";
                                    readonly fieldType: "json";
                                    readonly helpText: "Changed fields with old/new values";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'data.diff': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "data.created";
                                    readonly column: "data.created";
                                    readonly label: "Created Record";
                                    readonly fieldType: "json";
                                    readonly helpText: "Full data of the newly created entity";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'data.created': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "data.deleted";
                                    readonly column: "data.deleted";
                                    readonly label: "Deleted Record";
                                    readonly fieldType: "json";
                                    readonly helpText: "Full data of the entity that was deleted";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'data.deleted': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "data.query";
                                    readonly column: "data.query";
                                    readonly label: "Query Filters";
                                    readonly fieldType: "json";
                                    readonly helpText: "Filters used in the list/query operation";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'data.query': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "data.resultCount";
                                    readonly column: "data.resultCount";
                                    readonly label: "Result Count";
                                    readonly fieldType: "badge";
                                    readonly helpText: "Number of records returned by the query";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'data.resultCount': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, "data"];
                            };
                        };
                        readonly noiseReduction: {
                            readonly label: "Noise Reduction";
                            readonly icon: "CompressOutlined";
                            readonly sortOrder: 4;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly 'data.absorbed': {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: [{
                                    readonly name: "data.absorbed.count";
                                    readonly column: "data.absorbed.count";
                                    readonly fieldType: "badge";
                                    readonly label: "Absorbed Events";
                                    readonly helpText: "Total child events absorbed into this record. Per-operation breakdown is in the Timeline tab.";
                                }, {
                                    readonly name: "data.absorbed.silentCount";
                                    readonly column: "data.absorbed.silentCount";
                                    readonly fieldType: "badge";
                                    readonly label: "Silenced Events";
                                    readonly helpText: "Total child events silently dropped (counter only)";
                                }, {
                                    readonly name: "data.absorbed.errors";
                                    readonly column: "data.absorbed.errors";
                                    readonly label: "Absorbed Errors";
                                    readonly helpText: "Error details from absorbed child events";
                                    readonly fieldType: "json";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'data.absorbed.errors': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "data.absorbed.causedByLinks";
                                    readonly column: "data.absorbed.causedByLinks";
                                    readonly label: "Cross-Invocation Links";
                                    readonly helpText: "Correlation IDs from absorbed events linking to other invocations";
                                    readonly fieldType: "json";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'data.absorbed.causedByLinks': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }];
                            };
                        };
                        readonly tags: {
                            readonly label: "Tags";
                            readonly icon: "TagOutlined";
                            readonly sortOrder: 5;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly tags: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: [{
                                    readonly name: "tags.http.status_code";
                                    readonly column: "tags.http.status_code";
                                    readonly label: "HTTP Status Code";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'tags.http.status_code': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "tags.http.status_code_class";
                                    readonly column: "tags.http.status_code_class";
                                    readonly label: "Status Class";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'tags.http.status_code_class': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "tags.error_category";
                                    readonly column: "tags.error_category";
                                    readonly label: "Error Category";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'tags.error_category': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "tags.cold_start";
                                    readonly column: "tags.cold_start";
                                    readonly label: "Cold Start";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'tags.cold_start': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "tags._slow";
                                    readonly column: "tags._slow";
                                    readonly label: "Slow";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'tags._slow': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "tags._memory_pressure";
                                    readonly column: "tags._memory_pressure";
                                    readonly label: "Memory Pressure";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'tags._memory_pressure': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "tags._timeout_risk";
                                    readonly column: "tags._timeout_risk";
                                    readonly label: "Timeout Risk";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'tags._timeout_risk': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "tags.sqs.has_retries";
                                    readonly column: "tags.sqs.has_retries";
                                    readonly label: "SQS Retries";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'tags.sqs.has_retries': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "tags.query_type";
                                    readonly column: "tags.query_type";
                                    readonly label: "Query Type";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'tags.query_type': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "tags.lambda.function_name";
                                    readonly column: "tags.lambda.function_name";
                                    readonly label: "Lambda Function";
                                    readonly fieldType: "text";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'tags.lambda.function_name': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, "tags"];
                            };
                        };
                        readonly metrics: {
                            readonly label: "Metrics";
                            readonly icon: "DashboardOutlined";
                            readonly sortOrder: 6;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly metrics: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: [{
                                    readonly name: "metrics.duration";
                                    readonly column: "metrics.duration";
                                    readonly label: "Duration";
                                    readonly fieldType: "duration";
                                    readonly durationUnit: "ms";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'metrics.duration': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "metrics.span.depth";
                                    readonly column: "metrics.span.depth";
                                    readonly label: "Span Depth";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'metrics.span.depth': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "metrics.invocation_number";
                                    readonly column: "metrics.invocation_number";
                                    readonly label: "Invocation #";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'metrics.invocation_number': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "metrics.http.request_content_length";
                                    readonly column: "metrics.http.request_content_length";
                                    readonly label: "Request Size (bytes)";
                                    readonly fieldType: "number";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'metrics.http.request_content_length': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "metrics.http.response_content_length";
                                    readonly column: "metrics.http.response_content_length";
                                    readonly label: "Response Size (bytes)";
                                    readonly fieldType: "number";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'metrics.http.response_content_length': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "metrics.node.heap_used_mb";
                                    readonly column: "metrics.node.heap_used_mb";
                                    readonly label: "Heap Used (MB)";
                                    readonly fieldType: "number";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'metrics.node.heap_used_mb': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "metrics.lambda.remaining_time_ms";
                                    readonly column: "metrics.lambda.remaining_time_ms";
                                    readonly label: "Lambda Remaining Time";
                                    readonly fieldType: "duration";
                                    readonly durationUnit: "ms";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'metrics.lambda.remaining_time_ms': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, "metrics"];
                            };
                        };
                        readonly payload: {
                            readonly label: "Payload";
                            readonly icon: "FileTextOutlined";
                            readonly sortOrder: 7;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly data: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: ["data"];
                            };
                        };
                        readonly actor: {
                            readonly label: "Actor";
                            readonly icon: "UserOutlined";
                            readonly sortOrder: 8;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly actor: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: [{
                                    readonly name: "actorType";
                                    readonly column: "actor.type";
                                    readonly label: "Actor Type";
                                    readonly fieldType: "badge";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'actor.type': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "actorId";
                                    readonly column: "actor.id";
                                    readonly label: "Actor ID";
                                    readonly fieldType: "text";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'actor.id': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "actorEmail";
                                    readonly column: "actor.email";
                                    readonly label: "Email";
                                    readonly fieldType: "text";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'actor.email': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "actorName";
                                    readonly column: "actor.name";
                                    readonly label: "Name";
                                    readonly fieldType: "text";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'actor.name': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, {
                                    readonly name: "actorGroups";
                                    readonly column: "actor.groups";
                                    readonly label: "Groups";
                                    readonly fieldType: "json";
                                    readonly visibility: {
                                        readonly record: {
                                            readonly 'actor.groups': {
                                                readonly exists: true;
                                            };
                                        };
                                    };
                                }, "actor"];
                            };
                        };
                        readonly raw: {
                            readonly label: "Raw / Other";
                            readonly icon: "CodeOutlined";
                            readonly sortOrder: 9;
                            readonly pageType: "details";
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: ["attributes", "metadata", "context", "ttl"];
                            };
                        };
                    };
                }, {
                    readonly id: "hierarchy-relations";
                    readonly label: "Hierarchy & Trace";
                    readonly icon: "ApartmentOutlined";
                    readonly sortOrder: 2;
                    readonly renderMode: "tabs";
                    readonly defaultCollapsed: true;
                    readonly lazyLoad: true;
                    readonly keepMounted: false;
                    readonly sections: {
                        readonly hierarchyInfo: {
                            readonly label: "Hierarchy Info";
                            readonly icon: "NodeIndexOutlined";
                            readonly sortOrder: 0;
                            readonly pageType: "details";
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: ["isRoot", "parentObservabilityLogId", "correlationId", "causedBy"];
                            };
                        };
                        readonly parentSpan: {
                            readonly label: "Parent Span";
                            readonly icon: "ArrowUpOutlined";
                            readonly sortOrder: 1;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly parentObservabilityLogId: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "view";
                                readonly overrideConfig: {
                                    readonly identifierMapping: {
                                        readonly source: "parentObservabilityLogId";
                                        readonly target: "id";
                                    };
                                };
                            };
                        };
                        readonly siblingSpans: {
                            readonly label: "Sibling Spans";
                            readonly icon: "BlockOutlined";
                            readonly sortOrder: 2;
                            readonly pageType: "list";
                            readonly visibility: {
                                readonly record: {
                                    readonly parentObservabilityLogId: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly parentObservabilityLogId: {
                                            readonly eq: ":parentObservabilityLogId";
                                        };
                                        readonly observabilityLogId: {
                                            readonly ne: ":observabilityLogId";
                                        };
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                    readonly description: "Other spans at the same hierarchy level (same parent)";
                                };
                            };
                        };
                        readonly childSpans: {
                            readonly label: "Child Spans";
                            readonly icon: "BranchesOutlined";
                            readonly sortOrder: 3;
                            readonly pageType: "list";
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly parentObservabilityLogId: {
                                            readonly eq: ":observabilityLogId";
                                        };
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                };
                            };
                        };
                        readonly rootSpan: {
                            readonly label: "Root of Hierarchy";
                            readonly icon: "GatewayOutlined";
                            readonly sortOrder: 4;
                            readonly pageType: "list";
                            readonly visibility: {
                                readonly record: {
                                    readonly isRoot: {
                                        readonly eq: false;
                                    };
                                };
                            };
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly correlationId: {
                                            readonly eq: ":correlationId";
                                        };
                                        readonly isRoot: {
                                            readonly eq: true;
                                        };
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                    readonly description: "The root span that started this trace hierarchy";
                                };
                            };
                        };
                        readonly traceLogs: {
                            readonly label: "All in This Trace";
                            readonly icon: "ShareAltOutlined";
                            readonly sortOrder: 5;
                            readonly pageType: "list";
                            readonly visibility: {
                                readonly record: {
                                    readonly correlationId: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly correlationId: {
                                            readonly eq: ":correlationId";
                                        };
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                    readonly description: "All events in this Lambda invocation";
                                };
                            };
                        };
                        readonly causedByTrace: {
                            readonly label: "Causing Request Trace";
                            readonly icon: "LinkOutlined";
                            readonly sortOrder: 8;
                            readonly pageType: "list";
                            readonly visibility: {
                                readonly record: {
                                    readonly causedBy: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly correlationId: {
                                            readonly eq: ":causedBy";
                                        };
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                    readonly description: "View the original request trace that caused this event";
                                };
                            };
                        };
                        readonly causedEvents: {
                            readonly label: "Events Caused By This";
                            readonly icon: "ApiOutlined";
                            readonly sortOrder: 9;
                            readonly pageType: "list";
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly causedBy: {
                                            readonly eq: ":correlationId";
                                        };
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                    readonly description: "Events in other invocations caused by this request";
                                };
                            };
                        };
                        readonly sameErrorPattern: {
                            readonly label: "Same Error Pattern";
                            readonly icon: "BugOutlined";
                            readonly sortOrder: 9.5;
                            readonly pageType: "list";
                            readonly visibility: {
                                readonly record: {
                                    readonly fingerprint: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly fingerprint: {
                                            readonly eq: ":fingerprint";
                                        };
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                    readonly description: "All occurrences of this same error pattern across time";
                                };
                            };
                        };
                        readonly relatedTraces: {
                            readonly label: "Related Traces";
                            readonly icon: "ClusterOutlined";
                            readonly sortOrder: 10;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly relatedTraces: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: ["relatedTraces"];
                            };
                        };
                    };
                }, {
                    readonly id: "related-analytics";
                    readonly label: "Related Logs";
                    readonly icon: "FundOutlined";
                    readonly sortOrder: 3;
                    readonly renderMode: "tabs";
                    readonly defaultCollapsed: true;
                    readonly lazyLoad: false;
                    readonly keepMounted: false;
                    readonly sections: {
                        readonly byEntity: {
                            readonly label: "Entity Logs";
                            readonly icon: "DatabaseOutlined";
                            readonly sortOrder: 1;
                            readonly pageType: "list";
                            readonly visibility: {
                                readonly record: {
                                    readonly entityName: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly entityName: ":entityName";
                                        readonly entityId: ":entityId";
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                };
                            };
                        };
                        readonly byEntityType: {
                            readonly label: "Entity Type Logs";
                            readonly icon: "AppstoreOutlined";
                            readonly sortOrder: 2;
                            readonly pageType: "list";
                            readonly visibility: {
                                readonly record: {
                                    readonly entityName: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly entityName: ":entityName";
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                };
                            };
                        };
                        readonly bySource: {
                            readonly label: "Source Logs";
                            readonly icon: "CodeSandboxOutlined";
                            readonly sortOrder: 3;
                            readonly pageType: "list";
                            readonly visibility: {
                                readonly record: {
                                    readonly source: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly source: ":source";
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                };
                            };
                        };
                    };
                }];
            };
        };
    };
    readonly attributes: {
        readonly observabilityLogId: {
            readonly type: "string";
            readonly required: true;
            readonly isIdentifier: true;
            readonly default: () => string;
            readonly label: "Log ID";
            readonly isFilterable: true;
        };
        readonly parentObservabilityLogId: {
            readonly type: "string";
            readonly label: "Parent Log ID";
            readonly helpText: "Reference to parent span for hierarchical tracing";
            readonly isFilterable: true;
            readonly relation: {
                readonly entityName: "observabilityLog";
                readonly type: "many-to-one";
                readonly identifiers: {
                    readonly source: "parentObservabilityLogId";
                    readonly target: "observabilityLogId";
                };
            };
        };
        readonly isRoot: {
            readonly type: "boolean";
            readonly label: "Is Root";
            readonly helpText: "True if this is a root span (no parent)";
            readonly isFilterable: true;
            readonly watch: readonly ["parentObservabilityLogId"];
            readonly set: (_: unknown, data: {
                parentObservabilityLogId?: string;
            }) => boolean;
            readonly default: () => true;
        };
        readonly correlationId: {
            readonly type: "string";
            readonly required: true;
            readonly label: "Correlation ID";
            readonly helpText: "Unique identifier for the entire request/trace";
            readonly isFilterable: true;
            readonly isLink: true;
            readonly linkConfig: {
                readonly routePattern: "/list-observabilitylog?correlationId.eq=:correlationId";
                readonly displayText: "View Correlated Logs";
            };
        };
        readonly causedBy: {
            readonly type: "string";
            readonly required: false;
            readonly label: "Caused By";
            readonly helpText: "Correlation ID that caused this event (cross-invocation tracing)";
            readonly isFilterable: true;
            readonly isLink: true;
            readonly linkConfig: {
                readonly routePattern: "/list-observabilitylog?correlationId.eq=:causedBy";
                readonly displayText: "View Causing Request";
            };
        };
        readonly relatedTraces: {
            readonly type: "list";
            readonly items: {
                readonly type: "string";
            };
            readonly required: false;
            readonly label: "Related Traces";
            readonly helpText: "All related correlation IDs for complex workflows spanning multiple invocations";
            readonly isFilterable: false;
        };
        readonly type: {
            readonly type: "string";
            readonly required: true;
            readonly label: "Type";
            readonly helpText: "Event type (span, audit.entity, log, metric, etc.)";
            readonly isFilterable: true;
            readonly isSortable: true;
        };
        readonly subType: {
            readonly type: "string";
            readonly label: "Sub-Type";
            readonly helpText: "Additional type classification";
            readonly isFilterable: true;
        };
        readonly level: {
            readonly type: "string";
            readonly required: true;
            readonly label: "Level";
            readonly helpText: "Severity level: error, warn, info, debug";
            readonly isFilterable: true;
            readonly isSortable: true;
        };
        readonly entityName: {
            readonly type: "string";
            readonly label: "Entity Name";
            readonly helpText: "Name of the entity this event relates to";
            readonly isFilterable: true;
            readonly isSortable: true;
        };
        readonly entityId: {
            readonly type: "string";
            readonly label: "Entity ID";
            readonly helpText: "ID of the specific entity instance";
            readonly isFilterable: true;
            readonly watch: readonly ["entityName"];
            readonly set: (_: unknown, data: {
                entityName?: string;
                entityId?: string;
            }) => string | undefined;
            readonly linkConfig: {
                readonly routePattern: "/view-:entityName/:entityId";
                readonly displayText: "View {entityName}";
            };
        };
        readonly operation: {
            readonly type: "string";
            readonly label: "Operation";
            readonly helpText: "The operation being performed (e.g., create, update, query)";
            readonly isFilterable: true;
            readonly isSortable: true;
        };
        readonly status: {
            readonly type: "string";
            readonly label: "Status";
            readonly helpText: "Operation status (e.g., started, completed, failed)";
            readonly isFilterable: true;
        };
        readonly success: {
            readonly type: "boolean";
            readonly label: "Success";
            readonly helpText: "Whether the operation completed successfully";
            readonly isFilterable: true;
            readonly fieldType: "boolean";
            readonly booleanLabels: {
                readonly true: "Success";
                readonly false: "Failed";
            };
        };
        readonly timestampMs: {
            readonly type: "number";
            readonly required: true;
            readonly default: () => number;
            readonly label: "Timestamp";
            readonly helpText: "Event timestamp in milliseconds since epoch";
            readonly isFilterable: true;
            readonly isSortable: true;
            readonly fieldType: "datetime";
        };
        readonly durationMs: {
            readonly type: "number";
            readonly label: "Duration (ms)";
            readonly helpText: "Operation duration in milliseconds";
            readonly isFilterable: true;
            readonly isSortable: true;
            readonly fieldType: "duration";
            readonly durationUnit: "ms";
        };
        readonly source: {
            readonly type: "string";
            readonly label: "Source";
            readonly helpText: "Source of the event (e.g., service name, function name)";
            readonly isFilterable: true;
        };
        readonly tags: {
            readonly type: "any";
            readonly label: "Tags";
            readonly helpText: "Key-value tags for categorization";
        };
        readonly metrics: {
            readonly type: "any";
            readonly label: "Metrics";
            readonly helpText: "Numerical metrics and measurements";
        };
        readonly attributes: {
            readonly type: "any";
            readonly label: "Attributes";
            readonly helpText: "Additional structured attributes";
        };
        readonly data: {
            readonly type: "any";
            readonly label: "Data";
            readonly helpText: "Event-specific data payload";
            readonly compressed: {
                readonly threshold: number;
            };
        };
        readonly metadata: {
            readonly type: "any";
            readonly label: "Metadata";
            readonly helpText: "Additional metadata about the event";
            readonly compressed: true;
        };
        readonly error: {
            readonly type: "any";
            readonly label: "Error";
            readonly helpText: "Error details if the operation failed";
        };
        readonly fingerprint: {
            readonly type: "string";
            readonly label: "Error Fingerprint";
            readonly helpText: "Deterministic hash for grouping same errors across invocations (16 hex chars from SHA-256)";
            readonly isLink: true;
            readonly linkConfig: {
                readonly routePattern: "/list-observabilitylog?fingerprint.eq=:fingerprint";
                readonly displayText: "View Same Error Pattern";
            };
        };
        readonly actor: {
            readonly type: "any";
            readonly label: "Actor";
            readonly helpText: "Information about who triggered this event";
        };
        readonly context: {
            readonly type: "any";
            readonly label: "Context";
            readonly helpText: "Execution context and environment information";
        };
        readonly ttl: {
            readonly type: "number";
            readonly default: () => number;
            readonly watch: readonly ["level"];
            readonly set: (_: unknown, data: {
                level?: string;
            }) => number;
            readonly label: "TTL";
            readonly helpText: "Tiered retention: error/critical 90d, warn 60d, info 30d, debug/trace 7d";
            readonly fieldType: "ttl";
            readonly ttlUnit: "seconds";
            readonly ttlFormat: "auto";
            readonly isVisible: true;
            readonly isEditable: false;
            readonly isListable: true;
        };
    };
    readonly indexes: {
        readonly primary: {
            readonly pk: {
                readonly field: "pk";
                readonly composite: readonly ["observabilityLogId"];
            };
            readonly sk: {
                readonly field: "sk";
                readonly composite: readonly [];
            };
        };
        readonly byTrace: {
            readonly index: "gsi1";
            readonly pk: {
                readonly field: "gsi1pk";
                readonly composite: readonly ["correlationId"];
            };
            readonly sk: {
                readonly field: "gsi1sk";
                readonly composite: readonly ["timestampMs"];
            };
        };
        readonly byParent: {
            readonly index: "gsi2";
            readonly pk: {
                readonly field: "gsi2pk";
                readonly composite: readonly ["parentObservabilityLogId"];
            };
            readonly sk: {
                readonly field: "gsi2sk";
                readonly composite: readonly ["timestampMs"];
            };
        };
        readonly byType: {
            readonly index: "gsi3";
            readonly pk: {
                readonly field: "gsi3pk";
                readonly composite: readonly ["type"];
            };
            readonly sk: {
                readonly field: "gsi3sk";
                readonly composite: readonly ["timestampMs"];
            };
        };
        readonly byLevel: {
            readonly index: "gsi4";
            readonly pk: {
                readonly field: "gsi4pk";
                readonly composite: readonly ["level"];
            };
            readonly sk: {
                readonly field: "gsi4sk";
                readonly composite: readonly ["timestampMs"];
            };
        };
        readonly byEntityType: {
            readonly index: "gsi5";
            readonly pk: {
                readonly field: "gsi5pk";
                readonly composite: readonly ["entityName"];
            };
            readonly sk: {
                readonly field: "gsi5sk";
                readonly composite: readonly ["timestampMs"];
            };
        };
        readonly byEntity: {
            readonly index: "gsi6";
            readonly pk: {
                readonly field: "gsi6pk";
                readonly composite: readonly ["entityName", "entityId"];
            };
            readonly sk: {
                readonly field: "gsi6sk";
                readonly composite: readonly ["timestampMs"];
            };
        };
        readonly allRecords: {
            readonly index: "gsi7";
            readonly pk: {
                readonly field: "gsi7pk";
                readonly composite: readonly [];
                readonly template: "ALL_EVENTS";
            };
            readonly sk: {
                readonly field: "gsi7sk";
                readonly composite: readonly ["timestampMs"];
            };
        };
        readonly byCausedBy: {
            readonly index: "gsi8";
            readonly pk: {
                readonly field: "gsi8pk";
                readonly composite: readonly ["causedBy"];
            };
            readonly sk: {
                readonly field: "gsi8sk";
                readonly composite: readonly ["timestampMs"];
            };
        };
        readonly byFingerprint: {
            readonly index: "gsi9";
            readonly pk: {
                readonly field: "gsi9pk";
                readonly composite: readonly ["fingerprint"];
            };
            readonly sk: {
                readonly field: "gsi9sk";
                readonly composite: readonly ["timestampMs"];
            };
        };
    };
};
export type ObservabilityLogSchema = typeof ObservabilityLogEntitySchema;
export type ObservabilityLogEntityType = EntityTypeFromSchema<ObservabilityLogSchema>;
export type ObservabilityLogRecordType = EntityRecordTypeFromSchema<ObservabilityLogSchema>;
