import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap, EntityViewPageConfig, ISectionsConfig, IErrorHandlingConfig, IRetryConfig, IDataQualityConfig } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForDetail, mergeFieldVisibility, processSectionsConfig, groupPageHeaderActions } from "./util";
import { IEntityPageAction, IEntityPageColumnConfig, Template } from "../../entity/base-entity";
import { DefaultLogger } from "../../logging";
import { IApplicationConfig } from "../../interfaces/config";
import { makeViewEntityListConfig } from "./list-entity";

export type ViewEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string;
    entityNamePlural: string;
    CRUDApiPath?: string;
    properties: TIOSchemaAttributesMap<S>;
    excludeFromAdminUpdate?: boolean;
    excludeFromAdminDelete?: boolean;
    actions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>;
    /**
     * Breadcrumbs with template support
     *
     * @example
     * breadcrumbs: [
     *   { label: 'Home', url: '/' },
     *   { label: 'Teams', url: '/list-team' },
     *   { label: '{teamName}' }  // Dynamic template from record data
     * ]
     */
    breadcrumbs?: ReadonlyArray<{ label: Template; url?: string }> | Array<{ label: Template; url?: string }>;
    /**
     * Page title with template support
     *
     * @example pageTitle: 'Team Details'
     * @example pageTitle: '{teamName} - Team Details'
     * @example pageTitle: { composite: ['teamName', 'city'], template: '{teamName} ({city}) - Details' }
     */
    pageTitle?: Template;
    columnsConfig?: IEntityPageColumnConfig;
    /**
     * Field-level visibility overrides
     */
    fields?: EntityViewPageConfig[ 'fields' ];
    /**
     * Sections configuration for multi-section detail pages
     */
    sectionsConfig?: ISectionsConfig;
    /**
     * Loading skeleton configuration.
     * @default { type: 'skeleton' }
     */
    loading?: EntityViewPageConfig['loading'];
    /** Data quality / completeness indicator (#65) */
    dataQuality?: IDataQualityConfig;
    /** Error handling configuration (#58) */
    errorHandling?: IErrorHandlingConfig;
    /** Retry configuration (#58) */
    retry?: IRetryConfig;
    /** Global UI config options */
    globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ];
    /** Whether observability is enabled (passed from UI config gen) */
    hasObservability?: boolean;
    /** Exclude audit actions for this entity */
    excludeAuditActions?: boolean;
    /** Auto-group secondary actions into a "More" dropdown */
    autoGroupActions?: boolean;
}

/**
 * Automatically generate audit log actions if observability is enabled.
 * ZERO configuration needed - works for ALL entities automatically.
 */
function generateAuditLogActions(
    entityName: string,
    entityNamePascalCase: string,
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

    // Automatically add both actions
    auditActions.push({
        id: 'view-record-audit-logs',
        label: 'Audit Logs',
        icon: 'HistoryOutlined',
        tooltip: `View audit logs for this ${entityNamePascalCase}`,
        openInModal: true,
        modalTitle: `Audit Logs`,
        modalConfigRef: {
            entityName: 'observabilityLog',
            pageType: 'list',
            overrideConfig: {
                defaultFilters: {
                    entityName: entityName,
                    entityId: ':id',
                    type: { eq: 'audit.entity' }
                },
                hideSegments: [ 'hierarchy-group' ],
            }
        }
    });

    return auditActions;
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: ViewEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {
    const { entityName, entityNamePlural, CRUDApiPath, actions, breadcrumbs, pageTitle, excludeFromAdminUpdate, excludeFromAdminDelete, hasObservability, excludeAuditActions, autoGroupActions, globalUIConfigOptions } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);
    const entityNamePascalCase = pascalCase(entityName);

    const detailsPageConfig = makeViewEntityDetailConfig(options, entityService);

    const primaryActions: IEntityPageAction[] = [
        {
            id: 'back',
            label: 'Back',
            url: '__back__',
            icon: 'ArrowLeftOutlined',
            hideInModal: true,
        },
        {
            id: 'go-to-list',
            label: `All ${entityNamePlural}`,
            url: `/list-${entityNameLower}`,
        },
    ];

    if (!excludeFromAdminUpdate) {
        primaryActions.push({
            id: 'edit',
            label: "Edit",
            template: `Edit`,
            url: `/edit-${entityNameLower}/:id`,
            icon: "EditOutlined",
        });
    }

    const secondaryActions: IEntityPageAction[] = [
        ...(actions || []),
    ];

    // Automatically generate audit log actions if observability is enabled
    const auditActions = generateAuditLogActions(entityName, entityNamePascalCase, hasObservability || false, excludeAuditActions || false, globalUIConfigOptions);
    secondaryActions.push(...auditActions);

    const shouldGroup = autoGroupActions ?? true;
    const pageHeaderActions = groupPageHeaderActions(primaryActions, secondaryActions, shouldGroup);

    return {
        // Use custom pageTitle if provided, otherwise default
        pageTitle: pageTitle || `${entityNamePascalCase} Details`,
        pageType: 'details',
        routePattern: `/view-${entityNameLower}/:id`,
        breadcrumbs: breadcrumbs || [],
        pageHeaderActions,
        detailsPageConfig,
    } as const;
};

export function makeViewEntityDetailConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: ViewEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) {
    const { entityName, properties, CRUDApiPath, fields, globalUIConfigOptions } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    // 1. Generate base properties from schema
    let formattedProps = formatEntityAttributesForDetail(Array.from(properties.values()), entityService, globalUIConfigOptions);

    // 2. Merge field-level visibility/helpText from viewPageConfig.fields
    if (fields) {
        formattedProps = mergeFieldVisibility(formattedProps, fields);
    }

    const detailsPageConfig: any = {
        detailApiConfig: {
            apiMethod: `GET`,
            responseKey: entityNameCamel,
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}/:id`,
        },
        propertiesConfig: formattedProps,  // Properties with field visibility merged
        entityName,  // Add entityName to config for evaluation system
    };

    // Add loading config if provided
    if (options.loading) {
        detailsPageConfig.loading = options.loading;
    }

    // Add data quality config if provided
    if (options.dataQuality) {
        detailsPageConfig.dataQuality = options.dataQuality;
    }

    // Add error handling / retry configs if provided
    if (options.errorHandling) {
        detailsPageConfig.errorHandling = options.errorHandling;
    }
    if (options.retry) {
        detailsPageConfig.retry = options.retry;
    }

    // Add columnsConfig if provided
    if (options.columnsConfig) {
        detailsPageConfig.columnsConfig = options.columnsConfig;
    }

    // Add sectionsConfig if provided - process to expand shorthand propertiesConfig
    if (options.sectionsConfig) {
        detailsPageConfig.sectionsConfig = processSectionsConfig(
            options.sectionsConfig,
            Array.from(properties.values()),
            entityService,
            globalUIConfigOptions
        );
    }

    return detailsPageConfig;
}