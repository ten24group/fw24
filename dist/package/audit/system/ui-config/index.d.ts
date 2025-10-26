export declare const AuditCustomPageConfigs: {
    listingUiConfig: {
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
                    defaultSort?: string | {
                        field: string;
                        order: "asc" | "desc";
                    } | {
                        field: string;
                        order: "asc" | "desc";
                    }[] | undefined;
                    apiMethod: "GET";
                    responseKey: string;
                    apiUrl: string;
                };
                readonly database: {
                    defaultSort?: string | {
                        field: string;
                        order: "asc" | "desc";
                    } | {
                        field: string;
                        order: "asc" | "desc";
                    }[] | undefined;
                    apiMethod: "GET";
                    responseKey: string;
                    apiUrl: string;
                };
            } | {
                readonly apiUrl: "/system/auditlog";
                readonly defaultSort?: string | {
                    field: string;
                    order: "asc" | "desc";
                } | {
                    field: string;
                    order: "asc" | "desc";
                }[] | undefined;
                readonly apiMethod: "GET";
                readonly responseKey: string;
                readonly useSearch: false;
                readonly search?: undefined;
                readonly database?: undefined;
            };
            readonly propertiesConfig: import("../../../ui-config-gen/templates/util").ListingPropConfig[];
        };
        readonly pageTitle: `${string} Listing`;
        readonly pageType: "list";
        readonly pageHeaderActions: import("../../../entity").IEntityPageAction[];
    };
    viewUiConfig: {
        readonly routePattern: "/view-auditlog/:auditId";
        readonly detailsPageConfig: any;
        readonly pageTitle: `${string} Details`;
        readonly pageType: "details";
        readonly breadcrumbs: {
            label: string;
            url?: string;
        }[];
        readonly pageHeaderActions: import("../../../entity").IEntityPageAction[];
    };
};
