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
        readonly pageTitle: `${string} Listing`;
        readonly pageType: "list";
        readonly breadcrums: readonly [];
        readonly pageHeaderActions: {
            label: string;
            url: string;
        }[];
        readonly listPageConfig: {
            apiConfig: {
                search: {
                    apiMethod: string;
                    responseKey: string;
                    apiUrl: string;
                };
                database: {
                    apiMethod: string;
                    responseKey: string;
                    apiUrl: string;
                };
                apiMethod?: undefined;
                responseKey?: undefined;
                useSearch?: undefined;
                apiUrl?: undefined;
            } | {
                apiMethod: string;
                responseKey: string;
                useSearch: false;
                apiUrl: string;
                search?: undefined;
                database?: undefined;
            };
            propertiesConfig: any[];
        };
    };
    viewUiConfig: {
        readonly pageHeaderActions: readonly [{
            readonly label: "Back";
            readonly url: "/system/list-auditlog";
            readonly icon: "arrow-left";
        }];
        readonly routePattern: "/view-auditlog/:auditId";
        readonly detailsPageConfig: any;
        readonly pageTitle: `${string} Details`;
        readonly pageType: "details";
        readonly breadcrumbs: {
            label: string;
            url?: string;
        }[];
    };
};
