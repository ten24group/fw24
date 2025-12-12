/**
 * Observability Log Entity Schema
 *
 * DynamoDB table schema for storing all observability events.
 * Used by ObservabilityLogService which is self-contained (no DI dependency).
 */
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
                    readonly tooltip: "View details";
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
                            readonly isRoot: {
                                readonly eq: true;
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
                    readonly defaultVisible: false;
                }, {
                    readonly field: "correlationId";
                    readonly defaultVisible: false;
                }];
                readonly segments: [{
                    readonly id: "hierarchy-group";
                    readonly label: "View";
                    readonly segments: [{
                        readonly id: "root-only";
                        readonly label: "Root Spans";
                        readonly icon: "ApartmentOutlined";
                        readonly filters: {
                            readonly isRoot: {
                                readonly eq: true;
                            };
                        };
                        readonly default: true;
                    }, {
                        readonly id: "child-only";
                        readonly label: "Child Spans";
                        readonly icon: "BranchesOutlined";
                        readonly filters: {
                            readonly isRoot: {
                                readonly eq: false;
                            };
                        };
                    }, {
                        readonly id: "all-spans";
                        readonly label: "All Events";
                        readonly icon: "UnorderedListOutlined";
                        readonly filters: {};
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
            readonly columnsConfig: {
                readonly columns: [{
                    readonly sortOrder: 1;
                    readonly label: "Identity & Classification";
                    readonly fields: ["observabilityLogId", "type", "subType", "level", "correlationId", "isRoot"];
                }, {
                    readonly sortOrder: 2;
                    readonly label: "Operation & Timing";
                    readonly fields: ["operation", "status", "success", "timestampMs", "durationMs", "source"];
                }];
            };
            readonly sectionsConfig: {
                readonly sectionGroups: [{
                    readonly id: "hierarchy-relations";
                    readonly label: "Hierarchy & Trace";
                    readonly icon: "ApartmentOutlined";
                    readonly sortOrder: 2;
                    readonly renderMode: "tabs";
                    readonly defaultCollapsed: true;
                    readonly lazyLoad: true;
                    readonly keepMounted: true;
                    readonly sections: {
                        readonly parentSpan: {
                            readonly label: "Parent Span";
                            readonly icon: "NodeIndexOutlined";
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
                                        readonly target: "observabilityLogId";
                                    };
                                };
                            };
                        };
                        readonly childSpans: {
                            readonly label: "Child Spans";
                            readonly icon: "BranchesOutlined";
                            readonly sortOrder: 2;
                            readonly pageType: "list";
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly parentObservabilityLogId: ":observabilityLogId";
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                };
                            };
                        };
                        readonly traceLogs: {
                            readonly label: "Full Trace";
                            readonly icon: "ShareAltOutlined";
                            readonly sortOrder: 3;
                            readonly pageType: "list";
                            readonly entityConfigRef: {
                                readonly entityName: "observabilityLog";
                                readonly pageType: "list";
                                readonly overrideConfig: {
                                    readonly defaultFilters: {
                                        readonly correlationId: ":correlationId";
                                    };
                                    readonly hideSegments: ["hierarchy-group"];
                                };
                            };
                        };
                    };
                }, {
                    readonly id: "event-data";
                    readonly label: "Event Data";
                    readonly icon: "FileTextOutlined";
                    readonly sortOrder: 3;
                    readonly renderMode: "tabs";
                    readonly defaultCollapsed: false;
                    readonly lazyLoad: false;
                    readonly keepMounted: true;
                    readonly sections: {
                        readonly entityInfo: {
                            readonly label: "Entity Information";
                            readonly icon: "InfoCircleOutlined";
                            readonly sortOrder: 1;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly entityName: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: ["entityName", "entityId"];
                            };
                        };
                        readonly data: {
                            readonly label: "Data";
                            readonly icon: "FileTextOutlined";
                            readonly sortOrder: 2;
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
                        readonly attributes: {
                            readonly label: "Attributes";
                            readonly icon: "TagsOutlined";
                            readonly sortOrder: 3;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly attributes: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: ["attributes"];
                            };
                        };
                        readonly error: {
                            readonly label: "Error";
                            readonly icon: "ExclamationCircleOutlined";
                            readonly sortOrder: 4;
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
                                readonly propertiesConfig: ["error"];
                            };
                        };
                    };
                }, {
                    readonly id: "additional-data";
                    readonly label: "Additional Data";
                    readonly icon: "FolderOpenOutlined";
                    readonly sortOrder: 5;
                    readonly renderMode: "tabs";
                    readonly defaultCollapsed: true;
                    readonly lazyLoad: false;
                    readonly keepMounted: true;
                    readonly sections: {
                        readonly metrics: {
                            readonly label: "Metrics";
                            readonly icon: "DashboardOutlined";
                            readonly sortOrder: 1;
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
                                readonly propertiesConfig: ["metrics"];
                            };
                        };
                        readonly tags: {
                            readonly label: "Tags";
                            readonly icon: "TagOutlined";
                            readonly sortOrder: 2;
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
                                readonly propertiesConfig: ["tags"];
                            };
                        };
                        readonly metadata: {
                            readonly label: "Metadata";
                            readonly icon: "InfoCircleOutlined";
                            readonly sortOrder: 3;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly metadata: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: ["metadata"];
                            };
                        };
                        readonly context: {
                            readonly label: "Context";
                            readonly icon: "EnvironmentOutlined";
                            readonly sortOrder: 4;
                            readonly pageType: "details";
                            readonly visibility: {
                                readonly record: {
                                    readonly context: {
                                        readonly exists: true;
                                    };
                                };
                            };
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: ["context"];
                            };
                        };
                    };
                }, {
                    readonly id: "related-analytics";
                    readonly label: "Related Logs";
                    readonly icon: "FundOutlined";
                    readonly sortOrder: 6;
                    readonly renderMode: "tabs";
                    readonly defaultCollapsed: true;
                    readonly lazyLoad: false;
                    readonly keepMounted: true;
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
                }, {
                    readonly id: "actor-system";
                    readonly label: "Actor & System";
                    readonly icon: "SettingOutlined";
                    readonly sortOrder: 7;
                    readonly renderMode: "tabs";
                    readonly defaultCollapsed: true;
                    readonly lazyLoad: false;
                    readonly keepMounted: true;
                    readonly sections: {
                        readonly actor: {
                            readonly label: "Actor";
                            readonly icon: "UserOutlined";
                            readonly sortOrder: 1;
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
                                readonly propertiesConfig: ["actor"];
                            };
                        };
                        readonly systemInfo: {
                            readonly label: "System Info";
                            readonly icon: "ClockCircleOutlined";
                            readonly sortOrder: 2;
                            readonly pageType: "details";
                            readonly detailsPageConfig: {
                                readonly useParentData: true;
                                readonly propertiesConfig: ["ttl"];
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
            readonly default: () => `${string}-${string}-${string}-${string}-${string}`;
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
        readonly type: {
            readonly type: "string";
            readonly required: true;
            readonly label: "Type";
            readonly helpText: "Event type (span.start, span.end, audit.entity, log, metric, etc.)";
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
            readonly isLink: true;
            readonly linkConfig: {
                readonly routePattern: "/view-:entityName/:entityId";
                readonly displayText: "View Entity";
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
        };
        readonly metadata: {
            readonly type: "any";
            readonly label: "Metadata";
            readonly helpText: "Additional metadata about the event";
        };
        readonly error: {
            readonly type: "any";
            readonly label: "Error";
            readonly helpText: "Error details if the operation failed";
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
            readonly label: "TTL";
            readonly helpText: "Time-to-live for automatic cleanup (Unix timestamp)";
            readonly fieldType: "datetime";
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
        readonly byIsRoot: {
            readonly index: "gsi7";
            readonly pk: {
                readonly field: "gsi7pk";
                readonly composite: readonly ["isRoot"];
            };
            readonly sk: {
                readonly field: "gsi7sk";
                readonly composite: readonly ["timestampMs"];
            };
        };
    };
};
export type ObservabilityLogSchema = typeof ObservabilityLogEntitySchema;
