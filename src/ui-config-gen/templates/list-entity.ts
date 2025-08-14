import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { pascalCase } from "../../utils";
import { formatEntityAttributesForList } from "./util";

export type ListingPropConfig = {
    name: string,
    dataIndex: string,
    fieldType: "text" | "textarea" | "password" | "email" | "number" | "date" | "time" | "datetime" | "boolean" | "switch" | "toggle" | "select" | "multi-select" | "autocomplete" | "radio" | "checkbox" | "color" | "range" | "hidden" | "custom" | "rating" | "file" | "image" | "rich-text" | "wysiwyg" | "code" | "markdown" | "json",
    hidden?: boolean,
    actions?: any[]
};

export type ListEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string,
    entityNamePlural: string,
    excludeFromAdminCreate?: boolean,
    excludeFromAdminUpdate?: boolean,
    excludeFromAdminDelete?: boolean,
    excludeFromAdminDetail?: boolean,
    CRUDApiPath?: string,
    properties: TIOSchemaAttributesMap<S>
    useSearch?: boolean,
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: ListEntityPageOptions<S>
) => {

    const { entityName, entityNamePlural, properties } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const listPageConfig = makeViewEntityListConfig(options);

    const pageHeaderAction = [];
    if (!options.excludeFromAdminCreate) {
        pageHeaderAction.push({
            label: "Create",
            url: `/create-${entityNameLower}`
        });
    }

    return {
        pageTitle: `${entityNamePascalCase} Listing`,
        pageType: "list",
        routePattern: undefined,
        breadcrums: [],
        pageHeaderActions: pageHeaderAction,
        listPageConfig
    } as const;
};

export function makeViewEntityListConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: ListEntityPageOptions<S>
) {

    const { entityName, properties, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail, CRUDApiPath, useSearch } = options;
    const entityNameLower = entityName.toLowerCase();

    const baseApiUrl = `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`;
    const searchApiUrl = `${baseApiUrl}/search`;

    // Check if dual API configuration is enabled
    const isDualApiEnabled = useSearch; // Note: we can make it configurable in future

    const listPageConfig = {
        apiConfig: isDualApiEnabled ? {
            // Dual API configuration
            search: {
                apiMethod: 'GET',
                responseKey: 'items',
                apiUrl: searchApiUrl,
            },
            database: {
                apiMethod: 'GET',
                responseKey: 'items',
                apiUrl: baseApiUrl,
            }
        } : {
            // Single API configuration (backward compatible)
            apiMethod: 'GET',
            responseKey: 'items',
            useSearch: useSearch ?? false,
            apiUrl: useSearch ? searchApiUrl : baseApiUrl,
        },
        propertiesConfig: [] as any[],
    }

    const formattedProps = formatEntityAttributesForList(entityName, Array.from(properties.values()), {
        CRUDApiPath,
        excludeFromAdminUpdate,
        excludeFromAdminDelete,
        excludeFromAdminDetail
    });

    listPageConfig.propertiesConfig.push(...formattedProps);

    return listPageConfig;
}