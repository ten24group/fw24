import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap, IEntityPageColumnConfig, Template, EntityEditPageConfig, ISectionsConfig } from "../../entity";
import { IApplicationConfig } from "../../interfaces/config";
export type CreateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string;
    entityNamePlural: string;
    CRUDApiPath?: string;
    properties: TIOSchemaAttributesMap<S>;
    /**
     * Breadcrumbs with template support
     *
     * @example
     * breadcrumbs: [
     *   { label: 'Home', url: '/' },
     *   { label: 'Teams', url: '/list-team' },
     *   { label: 'Create' }
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
     * @example pageTitle: 'Create Team'
     * @example pageTitle: 'Create New {entityType}'
     */
    pageTitle?: Template;
    /**
     * Success message template for when entity is created
     *
     * @example successMessage: 'Team created successfully!'
     * @example successMessage: '{teamName} created successfully!'
     */
    successMessage?: Template;
    columnsConfig?: IEntityPageColumnConfig;
    /**
     * Form configuration including custom buttons and field-level visibility
     */
    formConfig?: EntityEditPageConfig['formConfig'];
    /**
     * Sections configuration for multi-section create pages with tabs/accordions
     */
    sectionsConfig?: ISectionsConfig;
    /**
     * Global UI config options (for passing global configuration like duplicatedFieldDetection)
     */
    globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions'];
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: CreateEntityPageOptions<S>, entityService: BaseEntityService<S>) => {
    pageTitle: Template;
    pageType: string;
    breadcrumbs: readonly {
        label: Template;
        url?: string;
    }[];
    routePattern: string;
    pageHeaderActions: {
        label: string;
        template: string;
        url: string;
    }[];
    formPageConfig: any;
};
export default _default;
export declare function makeCreateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: CreateEntityPageOptions<S>, entityService: BaseEntityService<S>): any;
