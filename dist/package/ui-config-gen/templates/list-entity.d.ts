import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";
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
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ListEntityPageOptions<S>) => {
    readonly pageTitle: `${string} Listing`;
    readonly pageType: "list";
    readonly routePattern: undefined;
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
export default _default;
export declare function makeViewEntityListConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ListEntityPageOptions<S>): {
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
