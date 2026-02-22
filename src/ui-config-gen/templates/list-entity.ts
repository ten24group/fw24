import { BaseEntityService, EntityListPageConfig, EntitySchema, TIOSchemaAttributesMap, IFilterSegment } from "../../entity";
import { IEntityPageAction, Template, SortConfig, FieldSortConfig, SortOrder, TableSortConfig, SearchSortConfig, DatabaseSortConfig, DualSortConfig } from "../../entity/base-entity";
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
     * @deprecated Use tableConfig.defaultSort instead
     */
    defaultSort?: SortConfig,
    /**
     * Table configuration including row actions, bulk actions, row selection, column visibility, and sorting
     */
    tableConfig?: EntityListPageConfig[ 'tableConfig' ];
    /**
     * Global UI config options (NEW: for passing global duplicatedFieldDetection config)
     */
    globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ];
    /** Whether observability is enabled (passed from UI config gen) */
    hasObservability?: boolean;
    /** Exclude audit actions for this entity */
    excludeAuditActions?: boolean;
}

/**
 * Check if sort config is a DualSortConfig (has search/database keys)
 */
function isDualSortConfig(sort: TableSortConfig): sort is DualSortConfig {
    return typeof sort === 'object' && !Array.isArray(sort) && ('search' in sort || 'database' in sort);
}

/**
 * Extract search sort config from TableSortConfig
 */
function getSearchSort(sort: TableSortConfig): SearchSortConfig | undefined {
    if (isDualSortConfig(sort)) return sort.search;
    return sort; // Simple format - use as-is for search
}

/**
 * Extract database sort direction from TableSortConfig
 */
function getDatabaseSort(sort: TableSortConfig): DatabaseSortConfig {
    if (isDualSortConfig(sort)) return sort.database ?? 'desc';
    // Simple format - extract order from first field
    if (Array.isArray(sort)) return sort[ 0 ]?.order ?? 'desc';
    return (sort as FieldSortConfig).order;
}

/**
 * Automatically generate audit log action for list pages.
 * Shows all audit logs for this entity type.
 */
function generateListAuditActions(
    entityName: string,
    entityNamePlural: string,
    hasObservability: boolean,
    excludeAuditActions: boolean,
    globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ]
): IEntityPageAction[] {
    const auditActions: IEntityPageAction[] = [];

    // Check if auto-generation is enabled and observability is available
    const autoGenerate = globalUIConfigOptions?.autoGenerateAuditActions ?? true;

    if (!hasObservability || !autoGenerate || excludeAuditActions) {
        return auditActions;
    }

    // Add entity type audit logs action
    auditActions.push({
        id: 'view-entity-audit-logs',
        label: 'Audit Logs',
        icon: 'HistoryOutlined',
        tooltip: `View all audit logs for ${entityNamePlural}`,
        openInModal: true,
        modalTitle: `${entityName} Audit Logs`,
        modalConfigRef: {
            entityName: 'observabilityLog',
            pageType: 'list',
            overrideConfig: {
                defaultFilters: {
                    entityName: entityName,
                    type: { eq: 'audit.entity' }
                },
                hideSegments: [ 'hierarchy-group' ],
            }
        }
    });

    return auditActions;
}

/**
 * @deprecated Extract just the order direction from legacy SortConfig
 */
function extractSortOrder(sort: SortConfig): SortOrder {
    if (typeof sort === 'string') return sort;
    if (Array.isArray(sort)) return sort[ 0 ]?.order ?? 'desc';
    return (sort as FieldSortConfig).order;
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: ListEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {

    const { entityName, entityNamePlural, properties, breadcrumbs, pageTitle, hasObservability, excludeAuditActions, globalUIConfigOptions } = options;
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

    // Automatically generate audit log actions if observability is enabled
    const auditActions = generateListAuditActions(entityName, entityNamePlural, hasObservability || false, excludeAuditActions || false, globalUIConfigOptions);

    // Build custom header actions from entity operations
    const ops = entityService.getOperationsConfig();
    const customHeaderActions: IEntityPageAction[] = [];
    Object.entries(ops).forEach(([ opName, config ]) => {
        if (config.enabled !== false && config.uiLocation === 'header' && !['get', 'list', 'create', 'update', 'delete'].includes(opName)) {
            const isApiAction = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(config.method || '');

            customHeaderActions.push({
                id: opName,
                label: config.label || pascalCase(opName),
                icon: config.icon,
                tooltip: config.tooltip,
                visibility: config.visibility,
                enablement: config.enablement,
                openInModal: config.openInModal,
                modalConfig: config.modalConfig,
                url: config.path ? (config.path.startsWith('/') ? config.path : `/${config.path}`) : `/${opName}`,
                apiConfig: (!config.openInModal && isApiAction) ? {
                    apiMethod: config.method as any,
                    apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}${config.path || `/${opName}`}`
                } : undefined
            });
        }
    });

    // Combine: default + custom (from options) + dynamic (from ops) + audit
    const pageHeaderActions = [
        ...defaultPageHeaderActions,
        ...(options.pageHeaderActions || []),
        ...customHeaderActions,
        ...auditActions
    ];

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

    const { entityName, properties, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail, CRUDApiPath, useSearch, tableConfig, globalUIConfigOptions } = options;
    const entityNameLower = entityName.toLowerCase();

    const baseApiUrl = `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`;
    const searchApiUrl = `${baseApiUrl}/search`;

    // Get sort config: prefer tableConfig.defaultSort, fall back to deprecated top-level
    const sortConfig = tableConfig?.defaultSort;
    const legacySortConfig = options.defaultSort;

    // Check if dual API configuration is enabled
    const isDualApiEnabled = useSearch;

    // Resolve sort configs for each mode
    const searchSort = sortConfig ? getSearchSort(sortConfig) : legacySortConfig;
    const databaseSort = sortConfig ? getDatabaseSort(sortConfig) : (legacySortConfig ? extractSortOrder(legacySortConfig) : undefined);

    // Build API config with properly formatted defaultSort for each mode
    const apiConfig = isDualApiEnabled ? {
        // Dual API configuration
        search: {
            apiMethod: 'GET' as const,
            responseKey: 'items',
            apiUrl: searchApiUrl,
            ...(searchSort && { defaultSort: searchSort })
        },
        database: {
            apiMethod: 'GET' as const,
            responseKey: 'items',
            apiUrl: baseApiUrl,
            ...(databaseSort && { defaultSort: databaseSort })
        }
    } : {
        // Single API configuration (backward compatible)
        apiMethod: 'GET' as const,
        responseKey: 'items',
        useSearch: useSearch ?? false,
        apiUrl: useSearch ? searchApiUrl : baseApiUrl,
        ...((useSearch ? searchSort : databaseSort) && { defaultSort: useSearch ? searchSort : databaseSort })
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

    // 4. Auto-generate bulk actions based on entity operations
    const ops = entityService.getOperationsConfig();
    const generatedBulkActions: IEntityPageAction[] = [ ...(tableConfig?.bulkActions || []) ];

    if (ops.batchDelete?.enabled !== false && !generatedBulkActions.some(a => a.id === 'batch-delete')) {
        generatedBulkActions.push({
            id: 'batch-delete',
            label: 'Delete Selected',
            icon: 'DeleteOutlined',
            openInModal: true,
            modalConfig: {
                modalType: 'confirm',
                modalPageConfig: {
                    title: `Delete Selected ${entityNamePascalCase}?`,
                    content: `Are you sure you want to delete the selected ${entityNamePascalCase}? This action cannot be undone.`
                },
                apiConfig: {
                    apiMethod: 'POST',
                    apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}/batch-delete`,
                },
                refreshParentOnSuccess: true
            }
        });
    }

    // Add custom bulk actions from entity operations
    Object.entries(ops).forEach(([ opName, config ]) => {
        if (config.enabled !== false && config.uiLocation === 'bulk' && !generatedBulkActions.some(a => a.id === opName)) {
            generatedBulkActions.push({
                id: opName,
                label: config.label || pascalCase(opName),
                icon: config.icon,
                tooltip: config.tooltip,
                visibility: config.visibility,
                enablement: config.enablement,
                openInModal: config.openInModal,
                modalConfig: config.modalConfig,
                apiConfig: config.openInModal ? undefined : {
                    apiMethod: config.method || 'POST',
                    apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}${config.path || `/${opName}`}`
                }
            });
        }
    });

    return {
        apiConfig,
        propertiesConfig: formattedProps,  // Row actions are merged into identifier field's actions
        entityName,  // Add entityName to config for evaluation system
        ...(generatedBulkActions.length > 0 && { bulkActions: generatedBulkActions }),
        ...(tableConfig?.rowSelection && {
            rowSelection: {
                enabled: tableConfig.rowSelection.enabled ?? (generatedBulkActions.length > 0),
                ...tableConfig.rowSelection
            }
        }),
        ...(tableConfig?.expandable && { expandableConfig: tableConfig.expandable }),  // Include expandable config if provided
        ...(segments && segments.length > 0 && { segments }),  // Include segments if generated/provided
        fetchStrategy: tableConfig?.fetchStrategy || 'eager', // Default to 'eager' fetching
        ...(tableConfig?.pageSize && { pageSize: tableConfig.pageSize })  // Include pageSize if provided
    };
}