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
<<<<<<< HEAD
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
=======
            readonly apiConfig: {
                readonly apiUrl: "/system/auditlog";
                readonly search: {
                    defaultSort?: "desc" | "asc" | import("../../../entity").FieldSortConfig | readonly import("../../../entity").FieldSortConfig[] | undefined;
>>>>>>> origin/develop
                    apiMethod: "GET";
                    responseKey: string;
                    apiUrl: string;
                };
<<<<<<< HEAD
                database: {
                    defaultSort?: "asc" | "desc" | {
                        readonly field: string;
                        readonly order: "asc" | "desc";
                    } | readonly {
                        readonly field: string;
                        readonly order: "asc" | "desc";
                    }[] | undefined;
=======
                readonly database: {
                    defaultSort?: import("../../../entity").SortOrder | undefined;
>>>>>>> origin/develop
                    apiMethod: "GET";
                    responseKey: string;
                    apiUrl: string;
                };
            } | {
<<<<<<< HEAD
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
=======
                readonly apiUrl: "/system/auditlog";
                readonly defaultSort?: import("../../../entity").FieldSortConfig | readonly import("../../../entity").FieldSortConfig[] | import("../../../entity").SortOrder | undefined;
                readonly apiMethod: "GET";
                readonly responseKey: string;
                readonly useSearch: false;
                readonly search?: undefined;
                readonly database?: undefined;
            };
            readonly pageSize?: number | undefined;
            readonly fetchStrategy: "eager" | "lazy";
            readonly segments?: readonly (import("../../../entity").IFilterSegment | import("../../../entity").IFilterSegmentGroup)[] | (import("../../../entity").IFilterSegment | import("../../../entity").IFilterSegmentGroup)[] | undefined;
            readonly expandableConfig?: import("../../../entity").ITableExpandableConfig | undefined;
            readonly rowSelection?: {
                enabled: boolean;
                visibility?: import("../../../entity").VisibilityConfig;
            } | undefined;
            readonly bulkActions?: readonly import("../../../entity").IEntityPageAction[] | import("../../../entity").IEntityPageAction[] | undefined;
            readonly propertiesConfig: import("../../../ui-config-gen/templates/util").ListingPropConfig[];
            readonly entityName: string;
>>>>>>> origin/develop
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
