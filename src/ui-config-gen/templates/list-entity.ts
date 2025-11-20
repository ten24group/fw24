import { BaseEntityService, EntityListPageConfig, EntitySchema, TIOSchemaAttributesMap, IFilterSegment } from "../../entity";
import { IEntityPageAction, Template } from "../../entity/base-entity";
import type { IApplicationConfig } from "../../interfaces/config";
import { pascalCase } from "../../utils";
import { formatEntityAttributesForList, generateSegments, mergeColumnVisibility } from "./util";

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
    pageHeaderActions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>,
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
    breadcrumbs?: ReadonlyArray<{ label: Template; url?: string }> | Array<{ label: Template; url?: string }>,
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
    /**
     * Table configuration including row actions, bulk actions, row selection, and column visibility
     */
    tableConfig?: EntityListPageConfig['tableConfig'];
    /**
     * Global UI config options (NEW: for passing global duplicatedFieldDetection config)
     */
    globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions'];
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: ListEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {

    const { entityName, entityNamePlural, properties, breadcrumbs, pageTitle } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const listPageConfig = makeViewEntityListConfig(options, entityService);

    // Build default page header actions with templates
    const defaultPageHeaderActions: IEntityPageAction[] = [];
    if (!options.excludeFromAdminCreate) {
        defaultPageHeaderActions.push({
            label: "Create",
            template: `Create`, // Template showing entity name
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
        routePattern: `list-${entityNameLower}`,
        breadcrumbs: breadcrumbs || [],
        pageHeaderActions,
        listPageConfig
    } as const;
};

export function makeViewEntityListConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: ListEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) {

    const { entityName, properties, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail, CRUDApiPath, useSearch, defaultSort, tableConfig, globalUIConfigOptions } = options;
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

    // 1. Generate base properties from schema with merged row actions
    let formattedProps = formatEntityAttributesForList(entityName, Array.from(properties.values()), entityService, {
        CRUDApiPath,
        excludeFromAdminUpdate,
        excludeFromAdminDelete,
        excludeFromAdminDetail,
        customRowActions: tableConfig?.rowActions,
        globalUIConfigOptions  // NEW: Pass global config for duplicated field detection
    });

    // 2. Merge column visibility from tableConfig.columns
    if (tableConfig?.columns) {
        formattedProps = mergeColumnVisibility(formattedProps, tableConfig.columns);
    }

    // 3. Auto-generate or pass through segments
    const segments = generateSegments(properties, entityService, globalUIConfigOptions, tableConfig?.segments);

    return {
        apiConfig,
        propertiesConfig: formattedProps,  // Row actions are merged into identifier field's actions
        entityName,  // Add entityName to config for evaluation system
        ...(tableConfig?.bulkActions && { bulkActions: tableConfig.bulkActions }),  // Include bulkActions if provided
        ...(tableConfig?.rowSelection && { rowSelection: tableConfig.rowSelection }),  // Include rowSelection if provided
        ...(tableConfig?.expandable && { expandableConfig: tableConfig.expandable }),  // Include expandable config if provided
        ...(segments && segments.length > 0 && { segments }),  // Include segments if generated/provided
        fetchStrategy: tableConfig?.fetchStrategy || 'eager' // Default to 'eager' fetching
    };
}