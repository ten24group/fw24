import { FieldOptions, ModalType, IModalApiConfig, IConfirmModal } from "../../entity";
import { IPageActionItem, IEntityPageColumnConfig } from "../../entity/base-entity";
export type PageType = "list" | "form" | "details" | "custom" | "dashboard" | "accordion" | "menu";
export type ConfigFieldType = "text" | "textarea" | "password" | "email" | "number" | "date" | "time" | "datetime" | "boolean" | "switch" | "toggle" | "select" | "multi-select" | "autocomplete" | "radio" | "checkbox" | "color" | "range" | "hidden" | "custom" | "rating" | "file" | "image" | "rich-text" | "wysiwyg" | "code" | "markdown" | "json";
export type ConfigPropertyType = "list" | "map" | "object";
export interface BasePageConfig {
    pageTitle: string;
    pageType: PageType;
    routePattern?: string;
    breadcrumbs?: Array<{
        label: string;
        url?: string;
    }>;
    pageHeaderActions?: Array<{
        label: string;
        url?: string;
        icon?: string;
        type?: 'button' | 'dropdown';
        items?: IPageActionItem[];
        openInModal?: boolean;
        modalConfig?: {
            modalType: ModalType;
            modalPageConfig?: IConfirmModal | Record<string, any>;
            apiConfig?: IModalApiConfig;
            submitSuccessRedirect?: string;
        };
    }>;
}
export interface DashboardWidgetConfig {
    type: 'stat' | 'chart' | 'list' | 'actions' | 'description';
    title?: string;
    colSpan?: number;
    maxWidth?: number | string;
    width?: number | string;
    dataConfig?: Record<string, unknown>;
    options?: Record<string, unknown>;
    showTimePeriodSelector?: boolean;
    defaultTimePeriod?: {
        period: string;
        range?: [string, string];
    };
    timezone?: string;
}
export interface DashboardPageConfig extends BasePageConfig {
    pageType: "dashboard";
    dashboardPageConfig: {
        showTimePeriodSelector?: boolean;
        defaultTimePeriod?: {
            period: string;
            range?: [string, string];
        };
        widgets: DashboardWidgetConfig[];
        timezone?: string;
    };
}
export interface AccordionPageConfig extends BasePageConfig {
    pageType: "accordion";
    accordionPageConfig: {
        accordions: Record<string, {
            pageTitle: string;
            pageType: "list" | "form" | "details" | "dashboard";
            listPageConfig?: ListPageConfig['listPageConfig'];
            formPageConfig?: FormPageConfig['formPageConfig'];
            detailsPageConfig?: DetailsPageConfig['detailsPageConfig'];
            dashboardPageConfig?: DashboardPageConfig['dashboardPageConfig'];
        }>;
    };
}
export interface MenuPageConfig extends BasePageConfig {
    pageType: "menu";
    menuPageConfig: {
        menuItems: Array<{
            label: string;
            key: string;
            url?: string;
            icon?: string;
            children?: Array<{
                label: string;
                key: string;
                url?: string;
                icon?: string;
            }>;
            group?: string;
            order?: number;
        }>;
    };
}
export interface ListPageConfig extends BasePageConfig {
    pageType: "list";
    listPageConfig: {
        apiConfig: {
            apiMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
            useSearch?: boolean;
            responseKey?: string;
            apiUrl: string;
        };
        propertiesConfig: Array<{
            type?: ConfigPropertyType;
            id?: string;
            name: string;
            dataIndex: string;
            fieldType: ConfigFieldType;
            placeholder?: string;
            helpText?: string;
            hidden?: boolean;
            validations?: string[];
            isVisible?: boolean;
            isEditable?: boolean;
            isListable?: boolean;
            isCreatable?: boolean;
            isFilterable?: boolean;
            isSearchable?: boolean;
            isSortable?: boolean;
            isIdentifier?: boolean;
            readOnly?: boolean;
            defaultValue?: any;
            filterConfig?: {
                defaultOperator?: string;
                availableOperators?: string[];
                predefinedOptions?: Array<{
                    label: string;
                    value: string;
                }>;
                filterType?: 'text' | 'select' | 'datetime' | 'number' | 'boolean';
            };
            actions?: Array<{
                label?: string;
                icon?: string;
                url?: string;
                type?: 'button' | 'link' | 'modal';
                openInModal?: boolean;
                modalConfig?: {
                    modalType: ModalType;
                    modalPageConfig: IConfirmModal | Record<string, any>;
                    apiConfig?: IModalApiConfig;
                    submitSuccessRedirect?: string;
                };
            }>;
            isLink?: boolean;
            linkConfig?: {
                routePattern: string;
                displayText?: string;
            };
        }>;
    };
}
export interface PropertyConfig {
    type?: ConfigPropertyType;
    id?: string;
    name: string;
    label: string;
    column: string;
    fieldType: ConfigFieldType;
    placeholder?: string;
    helpText?: string;
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
    options?: FieldOptions<any>;
    items?: {
        type: ConfigFieldType;
        properties?: Array<PropertyConfig>;
    };
    properties?: Array<PropertyConfig>;
}
export interface FormPageConfig extends BasePageConfig {
    pageType: "form";
    cardStyle?: {
        width: string;
    };
    formPageConfig: {
        apiConfig: IModalApiConfig;
        detailApiConfig?: IModalApiConfig;
        formButtons: Array<string | {
            text: string;
            url: string;
        }>;
        propertiesConfig: Array<PropertyConfig>;
        submitSuccessRedirect?: string;
        columnsConfig?: IEntityPageColumnConfig;
    };
}
export interface DetailsPageConfig extends BasePageConfig {
    pageType: "details";
    detailsPageConfig: {
        detailApiConfig: IModalApiConfig;
        columnsConfig?: IEntityPageColumnConfig;
        propertiesConfig: Array<{
            type?: ConfigPropertyType;
            id?: string;
            name: string;
            label: string;
            column: string;
            fieldType: ConfigFieldType;
            placeholder?: string;
            helpText?: string;
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
            options?: FieldOptions<any>;
            items?: {
                type: ConfigFieldType;
                properties?: Array<{
                    name: string;
                    label: string;
                    fieldType: string;
                    placeholder?: string;
                }>;
            };
            properties?: Array<{
                name: string;
                label: string;
                fieldType: string;
                placeholder?: string;
            }>;
            isLink?: boolean;
            linkConfig?: {
                routePattern: string;
                displayText?: string;
            };
        }>;
    };
}
export type CustomPageOptions = ListPageConfig | FormPageConfig | DetailsPageConfig | DashboardPageConfig | AccordionPageConfig | MenuPageConfig;
export declare function makeCustomPageConfig(options: CustomPageOptions): {
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "accordion" | "dashboard";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: {
        label: string;
        url?: string;
        icon?: string;
        type?: "button" | "dropdown";
        items?: IPageActionItem[];
        openInModal?: boolean;
        modalConfig?: {
            modalType: ModalType;
            modalPageConfig?: IConfirmModal | Record<string, any>;
            apiConfig?: IModalApiConfig;
            submitSuccessRedirect?: string;
        };
    }[];
} | {
    listPageConfig: {
        apiConfig: {
            apiMethod: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
            useSearch?: boolean;
            responseKey?: string;
            apiUrl: string;
        };
        propertiesConfig: Array<{
            type?: ConfigPropertyType;
            id?: string;
            name: string;
            dataIndex: string;
            fieldType: ConfigFieldType;
            placeholder?: string;
            helpText?: string;
            hidden?: boolean;
            validations?: string[];
            isVisible?: boolean;
            isEditable?: boolean;
            isListable?: boolean;
            isCreatable?: boolean;
            isFilterable?: boolean;
            isSearchable?: boolean;
            isSortable?: boolean;
            isIdentifier?: boolean;
            readOnly?: boolean;
            defaultValue?: any;
            filterConfig?: {
                defaultOperator?: string;
                availableOperators?: string[];
                predefinedOptions?: Array<{
                    label: string;
                    value: string;
                }>;
                filterType?: "text" | "select" | "datetime" | "number" | "boolean";
            };
            actions?: Array<{
                label?: string;
                icon?: string;
                url?: string;
                type?: "button" | "link" | "modal";
                openInModal?: boolean;
                modalConfig?: {
                    modalType: ModalType;
                    modalPageConfig: IConfirmModal | Record<string, any>;
                    apiConfig?: IModalApiConfig;
                    submitSuccessRedirect?: string;
                };
            }>;
            isLink?: boolean;
            linkConfig?: {
                routePattern: string;
                displayText?: string;
            };
        }>;
    };
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "accordion" | "dashboard";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: {
        label: string;
        url?: string;
        icon?: string;
        type?: "button" | "dropdown";
        items?: IPageActionItem[];
        openInModal?: boolean;
        modalConfig?: {
            modalType: ModalType;
            modalPageConfig?: IConfirmModal | Record<string, any>;
            apiConfig?: IModalApiConfig;
            submitSuccessRedirect?: string;
        };
    }[];
} | {
    cardStyle: {
        width: string;
    } | undefined;
    formPageConfig: {
        apiConfig: IModalApiConfig;
        detailApiConfig?: IModalApiConfig;
        formButtons: Array<string | {
            text: string;
            url: string;
        }>;
        propertiesConfig: Array<PropertyConfig>;
        submitSuccessRedirect?: string;
        columnsConfig?: IEntityPageColumnConfig;
    };
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "accordion" | "dashboard";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: {
        label: string;
        url?: string;
        icon?: string;
        type?: "button" | "dropdown";
        items?: IPageActionItem[];
        openInModal?: boolean;
        modalConfig?: {
            modalType: ModalType;
            modalPageConfig?: IConfirmModal | Record<string, any>;
            apiConfig?: IModalApiConfig;
            submitSuccessRedirect?: string;
        };
    }[];
} | {
    detailsPageConfig: {
        detailApiConfig: IModalApiConfig;
        columnsConfig?: IEntityPageColumnConfig;
        propertiesConfig: Array<{
            type?: ConfigPropertyType;
            id?: string;
            name: string;
            label: string;
            column: string;
            fieldType: ConfigFieldType;
            placeholder?: string;
            helpText?: string;
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
            options?: FieldOptions<any>;
            items?: {
                type: ConfigFieldType;
                properties?: Array<{
                    name: string;
                    label: string;
                    fieldType: string;
                    placeholder?: string;
                }>;
            };
            properties?: Array<{
                name: string;
                label: string;
                fieldType: string;
                placeholder?: string;
            }>;
            isLink?: boolean;
            linkConfig?: {
                routePattern: string;
                displayText?: string;
            };
        }>;
    };
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "accordion" | "dashboard";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: {
        label: string;
        url?: string;
        icon?: string;
        type?: "button" | "dropdown";
        items?: IPageActionItem[];
        openInModal?: boolean;
        modalConfig?: {
            modalType: ModalType;
            modalPageConfig?: IConfirmModal | Record<string, any>;
            apiConfig?: IModalApiConfig;
            submitSuccessRedirect?: string;
        };
    }[];
} | {
    dashboardPageConfig: {
        showTimePeriodSelector?: boolean;
        defaultTimePeriod?: {
            period: string;
            range?: [string, string];
        };
        widgets: DashboardWidgetConfig[];
        timezone?: string;
    };
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "accordion" | "dashboard";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: {
        label: string;
        url?: string;
        icon?: string;
        type?: "button" | "dropdown";
        items?: IPageActionItem[];
        openInModal?: boolean;
        modalConfig?: {
            modalType: ModalType;
            modalPageConfig?: IConfirmModal | Record<string, any>;
            apiConfig?: IModalApiConfig;
            submitSuccessRedirect?: string;
        };
    }[];
} | {
    accordionsPageConfig: Record<string, {
        pageTitle: string;
        pageType: "list" | "form" | "details" | "dashboard";
        listPageConfig?: ListPageConfig["listPageConfig"];
        formPageConfig?: FormPageConfig["formPageConfig"];
        detailsPageConfig?: DetailsPageConfig["detailsPageConfig"];
        dashboardPageConfig?: DashboardPageConfig["dashboardPageConfig"];
    }>;
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "accordion" | "dashboard";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: {
        label: string;
        url?: string;
        icon?: string;
        type?: "button" | "dropdown";
        items?: IPageActionItem[];
        openInModal?: boolean;
        modalConfig?: {
            modalType: ModalType;
            modalPageConfig?: IConfirmModal | Record<string, any>;
            apiConfig?: IModalApiConfig;
            submitSuccessRedirect?: string;
        };
    }[];
} | {
    menuPageConfig: {
        menuItems: Array<{
            label: string;
            key: string;
            url?: string;
            icon?: string;
            children?: Array<{
                label: string;
                key: string;
                url?: string;
                icon?: string;
            }>;
            group?: string;
            order?: number;
        }>;
    };
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "accordion" | "dashboard";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: {
        label: string;
        url?: string;
        icon?: string;
        type?: "button" | "dropdown";
        items?: IPageActionItem[];
        openInModal?: boolean;
        modalConfig?: {
            modalType: ModalType;
            modalPageConfig?: IConfirmModal | Record<string, any>;
            apiConfig?: IModalApiConfig;
            submitSuccessRedirect?: string;
        };
    }[];
};
