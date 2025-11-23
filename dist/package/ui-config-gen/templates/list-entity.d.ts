import { BaseEntityService, EntityListPageConfig, EntitySchema, TIOSchemaAttributesMap, IFilterSegment } from "../../entity";
import { IEntityPageAction, Template } from "../../entity/base-entity";
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
     * Default sort configuration
     * - Object/Array: for search mode with field+order
     * - 'asc' | 'desc': for DynamoDB mode (index order direction only)
     */
    defaultSort?: {
        readonly field: string;
        readonly order: 'asc' | 'desc';
    } | ReadonlyArray<{
        readonly field: string;
        readonly order: 'asc' | 'desc';
    }> | 'asc' | 'desc';
    /**
     * Table configuration including row actions, bulk actions, row selection, and column visibility
     */
    tableConfig?: EntityListPageConfig['tableConfig'];
    /**
     * Global UI config options (NEW: for passing global duplicatedFieldDetection config)
     */
    globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions'];
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ListEntityPageOptions<S>, entityService: BaseEntityService<S>) => {
    readonly pageTitle: Template;
    readonly pageType: "list";
    readonly routePattern: `list-${string}`;
    readonly breadcrumbs: readonly {
        label: Template;
        url?: string;
    }[];
    readonly pageHeaderActions: IEntityPageAction[];
    readonly listPageConfig: {
        fetchStrategy: "eager" | "lazy";
        segments?: readonly (IFilterSegment | import("../../entity").IFilterSegmentGroup)[] | (IFilterSegment | import("../../entity").IFilterSegmentGroup)[] | undefined;
        expandableConfig?: import("../../entity").ITableExpandableConfig | undefined;
        rowSelection?: {
            enabled: boolean;
            visibility?: import("../../entity").VisibilityConfig;
        } | undefined;
        bulkActions?: readonly IEntityPageAction[] | IEntityPageAction[] | undefined;
        apiConfig: {
            search: {
                defaultSort?: "asc" | "desc" | {
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
            database: {
                defaultSort?: "asc" | "desc" | {
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
        propertiesConfig: import("./util").ListingPropConfig[];
        entityName: string;
    };
};
export default _default;
export declare function makeViewEntityListConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ListEntityPageOptions<S>, entityService: BaseEntityService<S>): {
    fetchStrategy: "eager" | "lazy";
    segments?: readonly (IFilterSegment | import("../../entity").IFilterSegmentGroup)[] | (IFilterSegment | import("../../entity").IFilterSegmentGroup)[] | undefined;
    expandableConfig?: import("../../entity").ITableExpandableConfig | undefined;
    rowSelection?: {
        enabled: boolean;
        visibility?: import("../../entity").VisibilityConfig;
    } | undefined;
    bulkActions?: readonly IEntityPageAction[] | IEntityPageAction[] | undefined;
    apiConfig: {
        search: {
            defaultSort?: "asc" | "desc" | {
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
        database: {
            defaultSort?: "asc" | "desc" | {
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
    propertiesConfig: import("./util").ListingPropConfig[];
    entityName: string;
};
