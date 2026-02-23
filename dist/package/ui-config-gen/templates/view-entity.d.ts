import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap, EntityViewPageConfig, ISectionsConfig, IErrorHandlingConfig, IRetryConfig, IDataQualityConfig } from "../../entity";
import { IEntityPageAction, IEntityPageColumnConfig, Template } from "../../entity/base-entity";
import { IApplicationConfig } from "../../interfaces/config";
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
     * @example pageTitle: 'Team Details'
     * @example pageTitle: '{teamName} - Team Details'
     * @example pageTitle: { composite: ['teamName', 'city'], template: '{teamName} ({city}) - Details' }
     */
    pageTitle?: Template;
    columnsConfig?: IEntityPageColumnConfig;
    /**
     * Field-level visibility overrides
     */
    fields?: EntityViewPageConfig['fields'];
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
    globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions'];
    /** Whether observability is enabled (passed from UI config gen) */
    hasObservability?: boolean;
    /** Exclude audit actions for this entity */
    excludeAuditActions?: boolean;
    /** Auto-group secondary actions into a "More" dropdown */
    autoGroupActions?: boolean;
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ViewEntityPageOptions<S>, entityService: BaseEntityService<S>) => {
    readonly pageTitle: Template;
    readonly pageType: "details";
    readonly routePattern: `/view-${string}/:id`;
    readonly breadcrumbs: readonly {
        label: Template;
        url?: string;
    }[];
    readonly pageHeaderActions: IEntityPageAction[];
    readonly detailsPageConfig: any;
};
export default _default;
export declare function makeViewEntityDetailConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ViewEntityPageOptions<S>, entityService: BaseEntityService<S>): any;
