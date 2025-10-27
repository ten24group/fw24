import { EntitySchema, FieldOptions, FieldOptionsAPIConfig, ApiMethod, ModalType, IModalApiConfig, IConfirmModal } from "../../entity";
import { IEntityPageColumnConfig } from "../../entity/base-entity";

export type PageType = "list" | "form" | "details" | "custom" | "dashboard" | "accordion" | "menu";

// ConfigFieldType: Field rendering types (UI components)
// Should NOT include structural types like "list" or "object"
export type ConfigFieldType = "text" | "textarea" | "password" | "email" | "number" | "date" | "time" | "datetime" | "boolean" | "switch" | "toggle" | "select" | "multi-select" | "autocomplete" | "radio" | "checkbox" | "color" | "range" | "hidden" | "custom" | "rating" | "file" | "image" | "rich-text" | "wysiwyg" | "code" | "markdown" | "json";

// ConfigPropertyType: Data structure types
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
    // Support for list/map types from EntityAttribute
    items?: {
        type: ConfigFieldType;
        properties?: Array<PropertyConfig>;
    };
    properties?: Array<PropertyConfig>;
}

// Dashboard widget type for type safety
export interface DashboardWidgetConfig {
    type: 'stat' | 'chart' | 'list' | 'actions' | 'description';
    title?: string;
    colSpan?: number;
    maxWidth?: number | string;
    width?: number | string;
    dataConfig?: Record<string, unknown>;
    options?: Record<string, unknown>;
    showTimePeriodSelector?: boolean;
    defaultTimePeriod?: { period: string; range?: [ string, string ] };
    timezone?: string;
}

// Define the actual page config structures first (without BasePageConfig inheritance)
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
        // New filter configuration options
        filterConfig?: {
            defaultOperator?: string; // Default filter operator (e.g., 'contains', 'eq', 'in')
            availableOperators?: string[]; // Restrict available operators for this column
            predefinedOptions?: Array<{ label: string; value: string }>; // For dropdown/select filters
            filterType?: 'text' | 'select' | 'datetime' | 'number' | 'boolean'; // Filter input type
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
        
        // for internal links
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
        
        // Support for list/map types from EntityAttribute
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
        
        // for internal links
        isLink?: boolean;
        linkConfig?: {
            routePattern: string;
            displayText?: string;
        };
    }>;
}

// Define the proper modal page config type as a union of all possible page configs
export type ModalPageConfig = IConfirmModal | FormPageConfigStructure | ListPageConfigStructure | DetailsPageConfigStructure;

export interface IPageAction {
    label: string;
    url?: string;
    icon?: string;
    type?: 'button' | 'dropdown';
    items?: Array<Omit<IPageAction, 'items'>>;  // Items cannot have sub-items
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
    breadcrumbs?: Array<{ label: string; url?: string }>;
    pageHeaderActions?: Array<IPageAction>;
}

export interface DashboardPageConfig extends BasePageConfig {
    pageType: "dashboard";
    dashboardPageConfig: {
        showTimePeriodSelector?: boolean;
        defaultTimePeriod?: { period: string; range?: [ string, string ] };
        widgets: DashboardWidgetConfig[];
        timezone?: string;
    }
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

export function makeCustomPageConfig(options: CustomPageOptions) {
    const baseConfig = {
        pageName: options.pageName,
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
        case "accordion":
            return {
                ...baseConfig,
                accordionsPageConfig: options.accordionPageConfig.accordions
            };
        case "menu":
            return {
                ...baseConfig,
                menuPageConfig: options.menuPageConfig
            };
        default:
            return baseConfig;
    }
}
