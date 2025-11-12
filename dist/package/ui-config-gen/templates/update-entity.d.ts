import { BaseEntityService, EntityEditPageConfig, EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { IEntityPageAction, IEntityPageColumnConfig, Template } from "../../entity/base-entity";
export type UpdateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string;
    entityNamePlural: string;
    CRUDApiPath?: string;
    properties: TIOSchemaAttributesMap<S>;
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
