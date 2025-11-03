import { EntityListPageConfig, EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { IEntityPageAction, Template } from "../../entity/base-entity";
export type ListingPropConfig = {
    name: string;
    dataIndex: string;
    fieldType: "text" | "textarea" | "password" | "email" | "number" | "date" | "time" | "datetime" | "boolean" | "switch" | "toggle" | "select" | "multi-select" | "autocomplete" | "radio" | "checkbox" | "color" | "range" | "hidden" | "custom" | "rating" | "file" | "image" | "rich-text" | "wysiwyg" | "code" | "markdown" | "json";
    hidden?: boolean;
    actions?: Array<IEntityPageAction>;
};
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
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ListEntityPageOptions<S>) => {
    readonly pageTitle: Template;
    readonly pageType: "list";
    readonly routePattern: undefined;
    readonly breadcrumbs: readonly {
        label: Template;
        url?: string;
    }[];
    readonly pageHeaderActions: IEntityPageAction[];
    readonly listPageConfig: {
        bulkActions?: readonly IEntityPageAction[] | IEntityPageAction[] | undefined;
        apiConfig: {
            search: {
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
            database: {
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
            defaultSort?: "desc" | "asc" | {
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
export declare function makeViewEntityListConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ListEntityPageOptions<S>): {
    bulkActions?: readonly IEntityPageAction[] | IEntityPageAction[] | undefined;
    apiConfig: {
        search: {
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
        database: {
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
        defaultSort?: "desc" | "asc" | {
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
