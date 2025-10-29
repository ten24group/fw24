import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap, IEntityPageColumnConfig, Template } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForCreate } from "./util";

export type CreateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string,
    entityNamePlural: string,
    CRUDApiPath?: string,
    properties: TIOSchemaAttributesMap<S>,
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
    breadcrumbs?: Array<{ label: Template; url?: string }>,
    /**
     * Page title with template support
     * 
     * @example pageTitle: 'Create Team'
     * @example pageTitle: 'Create New {entityType}'
     */
    pageTitle?: Template,
    /**
     * Success message template for when entity is created
     * 
     * @example successMessage: 'Team created successfully!'
     * @example successMessage: '{teamName} created successfully!'
     */
    successMessage?: Template,
    columnsConfig?: IEntityPageColumnConfig,
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: CreateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {

    const{ entityName, breadcrumbs, pageTitle, successMessage } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const formPageConfig = makeCreateEntityFormConfig(options, entityService);

    return {
        pageTitle: pageTitle || `Create ${entityNamePascalCase}`,
        pageType:   'form',
        breadcrumbs: breadcrumbs || [],
        pageHeaderActions: [
            {
                label:  "Back",
                template: `Back to ${entityNamePascalCase} Listing`,
                url:    `/list-${entityNameLower}`
            }
        ], 
        formPageConfig: {
            ...formPageConfig, 
            formButtons: [
                "submit", 
                "reset", 
                {
                    text:  "Cancel",
                    url:    `/list-${entityNameLower}`
                }
            ],
            submitSuccessRedirect: `/list-${entityNameLower}`,
            ...(successMessage && { successMessage })
        }
    };
};

export function makeCreateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> (
    options: CreateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
){

    const{ entityName, properties, CRUDApiPath, columnsConfig } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    const formattedProps = formatEntityAttributesForCreate( Array.from(properties.values()), entityService);

    return {
        apiConfig: {
            apiMethod: 'POST' as const,
            responseKey: entityNameCamel,
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
        },
        formButtons: [ "submit", "reset"] as const,
        propertiesConfig: formattedProps,
        ...(columnsConfig && { columnsConfig })
    };
}