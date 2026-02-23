import { BaseEntityService, EntityListPageConfig, EntitySchema, TIOSchemaAttributesMap, ISectionsConfig, IErrorHandlingConfig, IRetryConfig } from "../../entity";
import { IEntityPageAction, Template, SortConfig, FieldSortConfig, SortOrder } from "../../entity/base-entity";
import type { IApplicationConfig } from "../../interfaces/config";
export type ListEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string;
    entityNamePlural: string;
    excludeFromAdminCreate?: boolean;
    excludeFromAdminUpdate?: boolean;
    excludeFromAdminDelete?: boolean;
    excludeFromAdminDetail?: boolean;
    CRUDApiPath?: string;
    properties: TIOSchemaAttributesMap<S>;
    useSearch?: boolean;
    pageHeaderActions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>;
    /**
     * Breadcrumbs with template support
     *
     * @example
     * breadcrumbs: [
     *   { label: 'Home', url: '/' },
     *   { label: 'Teams' }  // Static
     * ]
     *
     * @example
     * breadcrumbs: [
     *   { label: 'Home', url: '/' },
     *   { label: '{teamName}' }  // Dynamic template
     * ]
     */
    breadcrumbs?: ReadonlyArray<{
        label: Template;
        url?: string;
    }> | Array<{
        label: Template;
        url?: string;
    }>;
    /**
     * Page title with template support
     *
     * @example pageTitle: 'Team Listing'
     * @example pageTitle: '{sport} Teams'
     */
    pageTitle?: Template;
    /**
     * @deprecated Use tableConfig.defaultSort instead
     */
    defaultSort?: SortConfig;
    /**
     * Table configuration including row actions, bulk actions, row selection, column visibility, and sorting
     */
    tableConfig?: EntityListPageConfig['tableConfig'];
    /**
     * Global UI config options (NEW: for passing global duplicatedFieldDetection config)
     */
    globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions'];
    /** Whether observability is enabled (passed from UI config gen) */
    hasObservability?: boolean;
    /** Exclude audit actions for this entity */
    excludeAuditActions?: boolean;
    /**
     * Sections configuration for multi-section list pages with tabs/accordions
     */
    sectionsConfig?: ISectionsConfig;
    /**
     * Loading skeleton configuration.
     * Controls how loading states are displayed before data is ready.
     * @default { type: 'skeleton' }
     */
    loading?: EntityListPageConfig['loading'];
    /** Error handling configuration for the list page (#58) */
    errorHandling?: IErrorHandlingConfig;
    /** Retry configuration for the list page (#58) */
    retry?: IRetryConfig;
    /** Auto-group secondary actions into a "More" dropdown */
    autoGroupActions?: boolean;
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ListEntityPageOptions<S>, entityService: BaseEntityService<S>) => {
    readonly retry?: IRetryConfig | undefined;
    readonly errorHandling?: IErrorHandlingConfig | undefined;
    readonly pageTitle: Template;
    readonly pageType: "list";
    readonly routePattern: `list-${string}`;
    readonly breadcrumbs: readonly {
        label: Template;
        url?: string;
    }[];
    readonly pageHeaderActions: IEntityPageAction[];
    readonly listPageConfig: {
        sectionsConfig?: any;
        loading?: {
            readonly type: "skeleton" | "spinner";
            readonly rows?: number;
        } | undefined;
        dataQuality?: import("../../entity").IDataQualityConfig | undefined;
        views?: import("../../entity").IViewsConfig | undefined;
        deepLink?: import("../../entity").IDeepLinkConfig | undefined;
        retry?: IRetryConfig | undefined;
        errorHandling?: IErrorHandlingConfig | undefined;
        pinnedColumns?: {
            left?: ReadonlyArray<string>;
            right?: ReadonlyArray<string>;
        } | undefined;
        viewSwitcher?: {
            available: ReadonlyArray<"table" | "card-grid" | "kanban" | "calendar" | "map">;
            default: "table" | "card-grid" | "kanban" | "calendar" | "map";
            persistPreference?: boolean;
            cardConfig?: import("../../entity").ICardGridConfig;
        } | undefined;
        displayMode?: {
            default?: "table" | "card";
            allowToggle?: boolean;
            cardConfig?: import("../../entity").ICardGridConfig;
            remember?: boolean;
        } | undefined;
        contextMenu?: {
            items: ReadonlyArray<{
                label: string | Template;
                url?: string;
                icon?: string;
                target?: "_blank" | "_self";
                openInModal?: boolean;
                visibility?: import("../../entity").Condition;
                divider?: boolean;
            }>;
        } | undefined;
        columnResizing?: {
            enabled: boolean;
            persist?: boolean;
            minWidth?: number;
        } | undefined;
        density?: {
            default: "default" | "compact" | "comfortable";
            allowToggle?: boolean;
            persist?: boolean;
        } | undefined;
        emptyState?: import("./custom-page").ITableEmptyStateConfig | undefined;
        rowFormatting?: readonly import("./custom-page").IFormattingRule[] | import("./custom-page").IFormattingRule[] | undefined;
        pagination?: import("./custom-page").IPaginationConfig | undefined;
        pageSize?: number | undefined;
        fetchStrategy: "eager" | "lazy";
        segments?: readonly (import("../../entity").IFilterSegment | import("../../entity").IFilterSegmentGroup)[] | (import("../../entity").IFilterSegment | import("../../entity").IFilterSegmentGroup)[] | undefined;
        expandableConfig?: import("../../entity").ITableExpandableConfig | undefined;
        rowSelection?: {
            enabled: boolean;
            visibility?: import("../../entity").Condition;
        } | undefined;
        bulkActions?: readonly IEntityPageAction[] | IEntityPageAction[] | undefined;
        apiConfig: {
            search: {
                defaultSort?: FieldSortConfig | readonly FieldSortConfig[] | "asc" | "desc" | undefined;
                apiMethod: "GET";
                responseKey: string;
                apiUrl: string;
            };
            database: {
                defaultSort?: SortOrder | undefined;
                apiMethod: "GET";
                responseKey: string;
                apiUrl: string;
            };
        } | {
            defaultSort?: FieldSortConfig | readonly FieldSortConfig[] | SortOrder | undefined;
            apiMethod: "GET";
            responseKey: string;
            useSearch: false;
            apiUrl: string;
            search?: undefined;
            database?: undefined;
        };
        propertiesConfig: import("./util").ListingPropConfig[];
        entityName: string;
    };
};
export default _default;
export declare function makeViewEntityListConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ListEntityPageOptions<S>, entityService: BaseEntityService<S>): {
    sectionsConfig?: any;
    loading?: {
        readonly type: "skeleton" | "spinner";
        readonly rows?: number;
    } | undefined;
    dataQuality?: import("../../entity").IDataQualityConfig | undefined;
    views?: import("../../entity").IViewsConfig | undefined;
    deepLink?: import("../../entity").IDeepLinkConfig | undefined;
    retry?: IRetryConfig | undefined;
    errorHandling?: IErrorHandlingConfig | undefined;
    pinnedColumns?: {
        left?: ReadonlyArray<string>;
        right?: ReadonlyArray<string>;
    } | undefined;
    viewSwitcher?: {
        available: ReadonlyArray<"table" | "card-grid" | "kanban" | "calendar" | "map">;
        default: "table" | "card-grid" | "kanban" | "calendar" | "map";
        persistPreference?: boolean;
        cardConfig?: import("../../entity").ICardGridConfig;
    } | undefined;
    displayMode?: {
        default?: "table" | "card";
        allowToggle?: boolean;
        cardConfig?: import("../../entity").ICardGridConfig;
        remember?: boolean;
    } | undefined;
    contextMenu?: {
        items: ReadonlyArray<{
            label: string | Template;
            url?: string;
            icon?: string;
            target?: "_blank" | "_self";
            openInModal?: boolean;
            visibility?: import("../../entity").Condition;
            divider?: boolean;
        }>;
    } | undefined;
    columnResizing?: {
        enabled: boolean;
        persist?: boolean;
        minWidth?: number;
    } | undefined;
    density?: {
        default: "default" | "compact" | "comfortable";
        allowToggle?: boolean;
        persist?: boolean;
    } | undefined;
    emptyState?: import("./custom-page").ITableEmptyStateConfig | undefined;
    rowFormatting?: readonly import("./custom-page").IFormattingRule[] | import("./custom-page").IFormattingRule[] | undefined;
    pagination?: import("./custom-page").IPaginationConfig | undefined;
    pageSize?: number | undefined;
    fetchStrategy: "eager" | "lazy";
    segments?: readonly (import("../../entity").IFilterSegment | import("../../entity").IFilterSegmentGroup)[] | (import("../../entity").IFilterSegment | import("../../entity").IFilterSegmentGroup)[] | undefined;
    expandableConfig?: import("../../entity").ITableExpandableConfig | undefined;
    rowSelection?: {
        enabled: boolean;
        visibility?: import("../../entity").Condition;
    } | undefined;
    bulkActions?: readonly IEntityPageAction[] | IEntityPageAction[] | undefined;
    apiConfig: {
        search: {
            defaultSort?: FieldSortConfig | readonly FieldSortConfig[] | "asc" | "desc" | undefined;
            apiMethod: "GET";
            responseKey: string;
            apiUrl: string;
        };
        database: {
            defaultSort?: SortOrder | undefined;
            apiMethod: "GET";
            responseKey: string;
            apiUrl: string;
        };
    } | {
        defaultSort?: FieldSortConfig | readonly FieldSortConfig[] | SortOrder | undefined;
        apiMethod: "GET";
        responseKey: string;
        useSearch: false;
        apiUrl: string;
        search?: undefined;
        database?: undefined;
    };
    propertiesConfig: import("./util").ListingPropConfig[];
    entityName: string;
};
