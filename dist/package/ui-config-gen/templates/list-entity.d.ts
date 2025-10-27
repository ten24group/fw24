import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { IEntityPageAction } from "../../entity/base-entity";
export type ListingPropConfig = {
    name: string;
    dataIndex: string;
    fieldType: "text" | "textarea" | "password" | "email" | "number" | "date" | "time" | "datetime" | "boolean" | "switch" | "toggle" | "select" | "multi-select" | "autocomplete" | "radio" | "checkbox" | "color" | "range" | "hidden" | "custom" | "rating" | "file" | "image" | "rich-text" | "wysiwyg" | "code" | "markdown" | "json";
    hidden?: boolean;
    actions?: any[];
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
    pageHeaderActions?: Array<IEntityPageAction>;
    breadcrumbs?: Array<{
        label: string;
        url?: string;
    }>;
    defaultSort?: {
        field: string;
        order: 'asc' | 'desc';
    } | Array<{
        field: string;
        order: 'asc' | 'desc';
    }> | string;
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ListEntityPageOptions<S>) => {
    readonly pageTitle: `${string} Listing`;
    readonly pageType: "list";
    readonly routePattern: undefined;
    readonly breadcrumbs: {
        label: string;
        url?: string;
    }[];
    readonly pageHeaderActions: IEntityPageAction[];
    readonly listPageConfig: {
        apiConfig: {
            search: {
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
            database: {
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
            defaultSort?: string | {
                field: string;
                order: "asc" | "desc";
            } | {
                field: string;
                order: "asc" | "desc";
            }[] | undefined;
            apiMethod: "GET";
            responseKey: string;
            useSearch: false;
            apiUrl: string;
            search?: undefined;
            database?: undefined;
        };
        propertiesConfig: import("./util").ListingPropConfig[];
    };
};
export default _default;
export declare function makeViewEntityListConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ListEntityPageOptions<S>): {
    apiConfig: {
        search: {
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
        database: {
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
        defaultSort?: string | {
            field: string;
            order: "asc" | "desc";
        } | {
            field: string;
            order: "asc" | "desc";
        }[] | undefined;
        apiMethod: "GET";
        responseKey: string;
        useSearch: false;
        apiUrl: string;
        search?: undefined;
        database?: undefined;
    };
    propertiesConfig: import("./util").ListingPropConfig[];
};
