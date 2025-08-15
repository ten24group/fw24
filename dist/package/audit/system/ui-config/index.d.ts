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
                    apiMethod: string;
                    responseKey: string;
                    apiUrl: string;
                };
                readonly database: {
                    apiMethod: string;
                    responseKey: string;
                    apiUrl: string;
                };
                readonly apiMethod?: undefined;
                readonly responseKey?: undefined;
                readonly useSearch?: undefined;
            } | {
                readonly apiUrl: "/system/auditlog";
                readonly apiMethod: string;
                readonly responseKey: string;
                readonly useSearch: false;
                readonly search?: undefined;
                readonly database?: undefined;
            };
            readonly propertiesConfig: any[];
        };
        readonly pageTitle: `${string} Listing`;
        readonly pageType: "list";
        readonly breadcrums: readonly [];
        readonly pageHeaderActions: {
            label: string;
            url: string;
        }[];
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
