import { FieldOptions, ModalType, IModalApiConfig, IConfirmModal } from "../../entity";
import { IEntityPageColumnConfig } from "../../entity/base-entity";
export type PageType = "list" | "form" | "details" | "custom" | "dashboard" | "accordion" | "menu";
export type ConfigFieldType = "text" | "textarea" | "password" | "email" | "number" | "date" | "time" | "datetime" | "boolean" | "switch" | "toggle" | "select" | "multi-select" | "autocomplete" | "radio" | "checkbox" | "color" | "range" | "hidden" | "custom" | "rating" | "file" | "image" | "rich-text" | "wysiwyg" | "code" | "markdown" | "json";
export type ConfigPropertyType = "list" | "map" | "object";
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
    required?: boolean;
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
export interface FormPageConfigStructure {
    title?: string;
    helpText?: string;
    apiConfig: IModalApiConfig;
    detailApiConfig?: IModalApiConfig;
    formButtons: Array<string | {
        text: string;
        url: string;
    }>;
    propertiesConfig: Array<PropertyConfig>;
    submitSuccessRedirect?: string;
    columnsConfig?: IEntityPageColumnConfig;
}
export interface ListPageConfigStructure {
    title?: string;
    helpText?: string;
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
        required?: boolean;
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
                modalPageConfig: IConfirmModal | FormPageConfigStructure | ListPageConfigStructure | DetailsPageConfigStructure;
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
}
export interface DetailsPageConfigStructure {
    title?: string;
    helpText?: string;
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
        required?: boolean;
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
}
export type ModalPageConfig = IConfirmModal | FormPageConfigStructure | ListPageConfigStructure | DetailsPageConfigStructure;
export interface IPageAction {
    label: string;
    url?: string;
    icon?: string;
    type?: 'button' | 'dropdown';
    items?: Array<Omit<IPageAction, 'items'>>;
    openInModal?: boolean;
    modalConfig?: {
        modalType: ModalType;
        modalPageConfig?: ModalPageConfig;
        apiConfig?: IModalApiConfig;
        submitSuccessRedirect?: string;
    };
}
export interface BasePageConfig {
    pageName?: string;
    pageTitle: string;
    pageType: PageType;
    routePattern?: string;
    breadcrumbs?: Array<{
        label: string;
        url?: string;
    }>;
    pageHeaderActions?: Array<IPageAction>;
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
export interface FormPageConfig extends BasePageConfig {
    pageType: "form";
    cardStyle?: {
        width: string;
    };
    formPageConfig: FormPageConfigStructure;
}
export interface ListPageConfig extends BasePageConfig {
    pageType: "list";
    listPageConfig: ListPageConfigStructure;
}
export interface DetailsPageConfig extends BasePageConfig {
    pageType: "details";
    detailsPageConfig: DetailsPageConfigStructure;
}
export interface AccordionPageConfig extends BasePageConfig {
    pageType: "accordion";
    accordionPageConfig: {
        accordions: Record<string, {
            pageTitle: string;
            pageType: "list" | "form" | "details" | "dashboard";
            listPageConfig?: ListPageConfigStructure;
            formPageConfig?: FormPageConfigStructure;
            detailsPageConfig?: DetailsPageConfigStructure;
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
export type CustomPageOptions = ListPageConfig | FormPageConfig | DetailsPageConfig | DashboardPageConfig | AccordionPageConfig | MenuPageConfig;
export declare function makeCustomPageConfig(options: CustomPageOptions): {
    pageName: string | undefined;
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "dashboard" | "accordion";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: IPageAction[];
} | {
    listPageConfig: ListPageConfigStructure;
    pageName: string | undefined;
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "dashboard" | "accordion";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: IPageAction[];
} | {
    cardStyle: {
        width: string;
    } | undefined;
    formPageConfig: FormPageConfigStructure;
    pageName: string | undefined;
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "dashboard" | "accordion";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: IPageAction[];
} | {
    detailsPageConfig: DetailsPageConfigStructure;
    pageName: string | undefined;
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "dashboard" | "accordion";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: IPageAction[];
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
    pageName: string | undefined;
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "dashboard" | "accordion";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: IPageAction[];
} | {
    accordionsPageConfig: Record<string, {
        pageTitle: string;
        pageType: "list" | "form" | "details" | "dashboard";
        listPageConfig?: ListPageConfigStructure;
        formPageConfig?: FormPageConfigStructure;
        detailsPageConfig?: DetailsPageConfigStructure;
        dashboardPageConfig?: DashboardPageConfig["dashboardPageConfig"];
    }>;
    pageName: string | undefined;
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "dashboard" | "accordion";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: IPageAction[];
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
    pageName: string | undefined;
    pageTitle: string;
    pageType: "details" | "form" | "menu" | "list" | "dashboard" | "accordion";
    routePattern: string | undefined;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: IPageAction[];
};
