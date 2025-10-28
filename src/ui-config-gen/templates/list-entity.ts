import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { IEntityPageAction } from "../../entity/base-entity";
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
    pageHeaderActions?: Array<IEntityPageAction>,
    breadcrumbs?: Array<{ label: string; url?: string }>,
    /**
     * Default sort configuration
     * - Object/Array: for search mode with field+order
     * - 'asc' | 'desc': for DynamoDB mode (index order direction only)
     */
    defaultSort?: { field: string; order: 'asc' | 'desc' } | Array<{ field: string; order: 'asc' | 'desc' }> | 'asc' | 'desc',
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: ListEntityPageOptions<S>
) => {

    const { entityName, entityNamePlural, properties, breadcrumbs } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const listPageConfig = makeViewEntityListConfig(options);

    // Build default page header actions
    const defaultPageHeaderActions = [];
    if (!options.excludeFromAdminCreate) {
        defaultPageHeaderActions.push({
            label: "Create",
            url: `/create-${entityNameLower}`
        });
    }

    // Combine default actions with custom actions (custom actions take precedence)
    const pageHeaderActions = options.pageHeaderActions 
        ? [...defaultPageHeaderActions, ...options.pageHeaderActions]
        : defaultPageHeaderActions;

    return {
        pageTitle: `${entityNamePascalCase} Listing`,
        pageType: "list",
        routePattern: undefined,
        breadcrumbs: breadcrumbs || [],
        pageHeaderActions,
        listPageConfig
    } as const;
};

export function makeViewEntityListConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: ListEntityPageOptions<S>
) {

    const { entityName, properties, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail, CRUDApiPath, useSearch, defaultSort } = options;
    const entityNameLower = entityName.toLowerCase();

    const baseApiUrl = `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`;
    const searchApiUrl = `${baseApiUrl}/search`;

    // Check if dual API configuration is enabled
    const isDualApiEnabled = useSearch; // Note: we can make it configurable in future

    // Build API config with optional defaultSort
    const apiConfig = isDualApiEnabled ? {
        // Dual API configuration
        search: {
            apiMethod: 'GET' as const,
            responseKey: 'items',
            apiUrl: searchApiUrl,
            ...(defaultSort && { defaultSort })
        },
        database: {
            apiMethod: 'GET' as const,
            responseKey: 'items',
            apiUrl: baseApiUrl,
            ...(defaultSort && { defaultSort })
        }
    } : {
        // Single API configuration (backward compatible)
        apiMethod: 'GET' as const,
        responseKey: 'items',
        useSearch: useSearch ?? false,
        apiUrl: useSearch ? searchApiUrl : baseApiUrl,
        ...(defaultSort && { defaultSort })
    };

    const formattedProps = formatEntityAttributesForList(entityName, Array.from(properties.values()), {
        CRUDApiPath,
        excludeFromAdminUpdate,
        excludeFromAdminDelete,
        excludeFromAdminDetail
    });

    return {
        apiConfig,
        propertiesConfig: formattedProps
    };
}