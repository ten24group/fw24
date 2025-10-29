import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { IEntityPageAction, Template } from "../../entity/base-entity";
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
    breadcrumbs?: Array<{ label: Template; url?: string }>,
    /**
     * Page title with template support
     * 
     * @example pageTitle: 'Team Listing'
     * @example pageTitle: '{sport} Teams'
     */
    pageTitle?: Template,
    /**
     * Default sort configuration
     * - Object/Array: for search mode with field+order
     * - 'asc' | 'desc': for DynamoDB mode (index order direction only)
     */
    defaultSort?: { readonly field: string; readonly order: 'asc' | 'desc' } | ReadonlyArray<{ readonly field: string; readonly order: 'asc' | 'desc' }> | 'asc' | 'desc',
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: ListEntityPageOptions<S>
) => {

    const { entityName, entityNamePlural, properties, breadcrumbs, pageTitle } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const listPageConfig = makeViewEntityListConfig(options);

    // Build default page header actions with templates
    const defaultPageHeaderActions: IEntityPageAction[] = [];
    if (!options.excludeFromAdminCreate) {
        defaultPageHeaderActions.push({
            label: "Create",
            template: `Create ${entityNamePascalCase}`, // Template showing entity name
            url: `/create-${entityNameLower}`
        });
    }

    // Combine default actions with custom actions (custom actions take precedence)
    const pageHeaderActions = options.pageHeaderActions 
        ? [...defaultPageHeaderActions, ...options.pageHeaderActions]
        : defaultPageHeaderActions;

    return {
        // Use custom pageTitle if provided, otherwise default
        pageTitle: pageTitle || `${entityNamePascalCase} Listing`,
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