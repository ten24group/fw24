import { EntitySchema } from "../../entity";
import { IPageActionItem } from "../../entity/base-entity";
export type PageType = "list" | "form" | "details" | "custom" | "dashboard";

export interface BasePageConfig {
    pageTitle: string;
    pageType: PageType;
    routePattern?: string;
    breadcrumbs?: Array<{ label: string; url?: string }>;
    pageHeaderActions?: Array<{
        label: string;
        url?: string;
        icon?: string;
        type?: 'button' | 'dropdown';
        items?: IPageActionItem[];
        openInModal?: boolean;
        modalConfig?: {
            modalType: string;
            modalPageConfig: any;
            apiConfig?: {
                apiMethod: string;
                responseKey: string;
                apiUrl: string;
            };
            submitSuccessRedirect?: string;
        };
    }>;
}

// Dashboard widget type for type safety
export interface DashboardWidgetConfig {
    type: 'stat' | 'chart' | 'list';
    title?: string;
    colSpan?: number;
    maxWidth?: number | string;
    width?: number | string;
    dataConfig?: any;
    options?: any;
    showTimePeriodSelector?: boolean;
    defaultTimePeriod?: { period: string; range?: [string, string] };
    timezone?: string;
}

export interface DashboardPageConfig extends BasePageConfig {
    pageType: "dashboard";
    dashboardPageConfig: {
        showTimePeriodSelector?: boolean;
        defaultTimePeriod?: { period: string; range?: [string, string] };
        widgets: DashboardWidgetConfig[];
        timezone?: string;
    }
}

export interface ListPageConfig extends BasePageConfig {
    pageType: "list";
    listPageConfig: {
        apiConfig: {
            apiMethod: string;
            responseKey: string;
            apiUrl: string;
        };
        propertiesConfig: Array<{
            type?: string;
            id?: string;
            name: string;
            dataIndex: string;
            fieldType: string;
            hidden?: boolean;
            validations?: string[];
            isVisible?: boolean;
            isEditable?: boolean;
            isListable?: boolean;
            isCreatable?: boolean;
            isFilterable?: boolean;
            isSearchable?: boolean;
            isIdentifier?: boolean;
            readOnly?: boolean;
            defaultValue?: any;
            actions?: Array<{
                label?: string;
                icon?: string;
                url?: string;
                type?: string;
                openInModal?: boolean;
                modalConfig?: {
                    modalType: string;
                    modalPageConfig: any;
                    apiConfig?: {
                        apiMethod: string;
                        responseKey: string;
                        apiUrl: string;
                    };
                    submitSuccessRedirect?: string;
                };
            }>;
        }>;
    };
}

export interface FormPageConfig extends BasePageConfig {
    pageType: "form";
    cardStyle?: {
        width: string;
    };
    formPageConfig: {
        apiConfig: {
            apiMethod: string;
            responseKey: string;
            apiUrl: string;
        };
        detailApiConfig?: {
            apiMethod: string;
            responseKey: string;
            apiUrl: string;
        };
        formButtons: Array<string | {
            text: string;
            url: string;
        }>;
        propertiesConfig: Array<{
            type?: string;
            id?: string;
            name: string;
            label: string;
            column: string;
            fieldType: string;
            hidden?: boolean;
            validations?: string[];
            isVisible?: boolean;
            isEditable?: boolean;
            isListable?: boolean;
            isCreatable?: boolean;
            isFilterable?: boolean;
            isSearchable?: boolean;
            isIdentifier?: boolean;
            readOnly?: boolean;
            defaultValue?: any;
        }>;
        submitSuccessRedirect?: string;
    };
}

export interface DetailsPageConfig extends BasePageConfig {
    pageType: "details";
    detailsPageConfig: {
        detailApiConfig: {
            apiMethod: string;
            responseKey: string;
            apiUrl: string;
        };
        propertiesConfig: Array<{
            type?: string;
            id?: string;
            name: string;
            label: string;
            column: string;
            fieldType: string;
            hidden?: boolean;
            validations?: string[];
            isVisible?: boolean;
            isEditable?: boolean;
            isListable?: boolean;
            isCreatable?: boolean;
            isFilterable?: boolean;
            isSearchable?: boolean;
            isIdentifier?: boolean;
            readOnly?: boolean;
            defaultValue?: any;
        }>;
    };
}

export type CustomPageOptions = ListPageConfig | FormPageConfig | DetailsPageConfig | DashboardPageConfig;

export function makeCustomPageConfig(options: CustomPageOptions) {
    const baseConfig = {
        pageTitle: options.pageTitle,
        pageType: options.pageType,
        routePattern: options.routePattern,
        breadcrumbs: options.breadcrumbs || [],
        pageHeaderActions: options.pageHeaderActions || [],
    };

    switch (options.pageType) {
        case "list":
            return {
                ...baseConfig,
                listPageConfig: options.listPageConfig
            };
        case "form":
            return {
                ...baseConfig,
                cardStyle: options.cardStyle,
                formPageConfig: options.formPageConfig
            };
        case "details":
            return {
                ...baseConfig,
                detailsPageConfig: options.detailsPageConfig
            };
        case "dashboard":
            return {
                ...baseConfig,
                dashboardPageConfig: options.dashboardPageConfig
            };
        default:
            return baseConfig;
    }
} 