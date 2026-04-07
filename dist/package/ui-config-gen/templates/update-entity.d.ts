import { BaseEntityService, EntityEditPageConfig, EntitySchema, TIOSchemaAttributesMap, ISectionsConfig, IErrorHandlingConfig, IRetryConfig, DisplayOverridesUIConfig } from "../../entity";
import { IEntityPageAction, IEntityPageColumnConfig, Template } from "../../entity/base-entity";
import { IApplicationConfig } from "../../interfaces/config";
export type UpdateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string;
    entityNamePlural: string;
    CRUDApiPath?: string;
    properties: TIOSchemaAttributesMap<S>;
    excludeFromAdminDelete?: boolean;
    excludeFromAdminCreate?: boolean;
    excludeFromAdminDuplicate?: boolean;
    actions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>;
    /**
     * Breadcrumbs with template support
     *
     * @example
     * breadcrumbs: [
     *   { label: 'Home', url: '/' },
     *   { label: 'Teams', url: '/list-team' },
     *   { label: '{teamName}', url: '/view-team/:id' },
     *   { label: 'Edit' }
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
     * @example pageTitle: 'Edit Team'
     * @example pageTitle: 'Edit {teamName}'
     */
    pageTitle?: Template;
    /**
     * Success message template for when entity is updated
     *
     * @example successMessage: 'Team updated successfully!'
     * @example successMessage: '{teamName} updated successfully!'
     */
    successMessage?: Template;
    columnsConfig?: IEntityPageColumnConfig;
    /**
     * Form configuration including custom buttons and field-level visibility
     */
    formConfig?: EntityEditPageConfig['formConfig'];
    /**
     * Sections configuration for multi-section update pages with tabs/accordions
     */
    sectionsConfig?: ISectionsConfig;
    /**
     * Loading skeleton configuration.
     * @default { type: 'skeleton' }
     */
    loading?: EntityEditPageConfig['loading'];
    /** Error handling configuration (#58) */
    errorHandling?: IErrorHandlingConfig;
    /** Retry configuration (#58) */
    retry?: IRetryConfig;
    /**
     * Global UI config options (for passing global configuration like duplicatedFieldDetection)
     */
    globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions'];
    /** Auto-group secondary actions into a "More" dropdown */
    autoGroupActions?: boolean;
    /** Display overrides UI metadata (merged from model + editPageConfig in ui-config gen). */
    displayOverrides?: DisplayOverridesUIConfig;
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: UpdateEntityPageOptions<S>, entityService: BaseEntityService<S>) => {
    pageTitle: Template;
    pageType: string;
    routePattern: string;
    breadcrumbs: readonly {
        label: Template;
        url?: string;
    }[];
    pageHeaderActions: IEntityPageAction[];
    formPageConfig: any;
};
export default _default;
export declare function makeUpdateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: UpdateEntityPageOptions<S>, entityService: BaseEntityService<S>): any;
