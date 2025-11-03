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
        readonly listPageConfig: {
            readonly apiConfig: {
                readonly apiUrl: "/system/auditlog";
                readonly search: {
                    defaultSort?: "desc" | "asc" | {
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
                readonly database: {
                    defaultSort?: "desc" | "asc" | {
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
                readonly apiUrl: "/system/auditlog";
                readonly defaultSort?: "desc" | "asc" | {
                    readonly field: string;
                    readonly order: "asc" | "desc";
                } | readonly {
                    readonly field: string;
                    readonly order: "asc" | "desc";
                }[] | undefined;
                readonly apiMethod: "GET";
                readonly responseKey: string;
                readonly useSearch: false;
                readonly search?: undefined;
                readonly database?: undefined;
            };
            readonly bulkActions?: readonly import("../../../entity").IEntityPageAction[] | import("../../../entity").IEntityPageAction[] | undefined;
            readonly propertiesConfig: import("../../../ui-config-gen/templates/util").ListingPropConfig[];
            readonly entityName: string;
        };
        readonly pageType: "list";
        readonly pageHeaderActions: import("../../../entity").IEntityPageAction[];
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
            label: import("../../../entity").Template;
            url?: string;
        }[];
    };
};
