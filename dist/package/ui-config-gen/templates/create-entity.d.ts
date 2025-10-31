import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap, IEntityPageColumnConfig, Template } from "../../entity";
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
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: CreateEntityPageOptions<S>, entityService: BaseEntityService<S>) => {
    pageTitle: Template;
    pageType: string;
    breadcrumbs: readonly {
        label: Template;
        url?: string;
    }[];
    pageHeaderActions: {
        label: string;
        template: string;
        url: string;
    }[];
    formPageConfig: {
        successMessage?: Template | undefined;
        formButtons: (string | {
            text: string;
            url: string;
        })[];
        submitSuccessRedirect: string;
        columnsConfig?: IEntityPageColumnConfig | undefined;
        apiConfig: {
            apiMethod: "POST";
            responseKey: string;
            apiUrl: string;
        };
        propertiesConfig: any[];
        entityName: string;
    };
};
export default _default;
export declare function makeCreateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: CreateEntityPageOptions<S>, entityService: BaseEntityService<S>): {
    columnsConfig?: IEntityPageColumnConfig | undefined;
    apiConfig: {
        apiMethod: "POST";
        responseKey: string;
        apiUrl: string;
    };
    formButtons: readonly ["submit", "reset"];
    propertiesConfig: any[];
    entityName: string;
};
