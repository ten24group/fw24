export declare const AuditCustomPageConfigs: {
    listingUiConfig: {
        readonly pageTitle: "AuditLog";
        readonly routePattern: "/system/list-auditlog";
        readonly breadcrumbs: readonly [{
            readonly label: "Home";
            readonly url: "/";
        }, {
            readonly label: "System";
            readonly url: "/system";
        }, {
            readonly label: "Audit Logs";
        }];
        readonly pageType: "list";
        readonly pageHeaderActions: import("../../../ui-config-gen").IEntityPageAction[];
        readonly listPageConfig: {
            fetchStrategy: "eager" | "lazy";
            segments?: readonly (import("../../../fw24").IFilterSegment | import("../../../fw24").IFilterSegmentGroup)[] | (import("../../../fw24").IFilterSegment | import("../../../fw24").IFilterSegmentGroup)[] | undefined;
            expandableConfig?: import("../../../fw24").ITableExpandableConfig | undefined;
            rowSelection?: {
                enabled: boolean;
                visibility?: import("../../../fw24").VisibilityConfig;
            } | undefined;
            bulkActions?: readonly import("../../../ui-config-gen").IEntityPageAction[] | import("../../../ui-config-gen").IEntityPageAction[] | undefined;
            apiConfig: {
                search: {
                    defaultSort?: "asc" | "desc" | {
                        readonly field: string;
                        readonly order: "asc" | "desc";
                    } | readonly {
                        readonly field: string;
                        readonly order: "asc" | "desc";
                    }[] | undefined;
                    apiMethod: "GET";
                    responseKey: string;
                    apiUrl: string;
                };
                database: {
                    defaultSort?: "asc" | "desc" | {
                        readonly field: string;
                        readonly order: "asc" | "desc";
                    } | readonly {
                        readonly field: string;
                        readonly order: "asc" | "desc";
                    }[] | undefined;
                    apiMethod: "GET";
                    responseKey: string;
                    apiUrl: string;
                };
            } | {
                defaultSort?: "asc" | "desc" | {
                    readonly field: string;
                    readonly order: "asc" | "desc";
                } | readonly {
                    readonly field: string;
                    readonly order: "asc" | "desc";
                }[] | undefined;
                apiMethod: "GET";
                responseKey: string;
                useSearch: false;
                apiUrl: string;
                search?: undefined;
                database?: undefined;
            };
            propertiesConfig: import("../../../ui-config-gen/templates/util").ListingPropConfig[];
            entityName: string;
        };
    };
    viewUiConfig: {
        readonly pageTitle: "AuditLog";
        readonly routePattern: "/view-auditlog/:auditId";
        readonly pageHeaderActions: readonly [{
            readonly label: "Back";
            readonly url: "/system/list-auditlog";
            readonly icon: "arrow-left";
        }];
        readonly detailsPageConfig: any;
        readonly pageType: "details";
        readonly breadcrumbs: readonly {
            label: import("../../../fw24").Template;
            url?: string;
        }[];
    };
};
