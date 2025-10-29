import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForUpdate } from "./util";
import { IEntityPageAction, IEntityPageColumnConfig, Template } from "../../entity/base-entity";
export type UpdateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string,
    entityNamePlural: string,
    CRUDApiPath?: string,
    properties: TIOSchemaAttributesMap<S>,
    actions?: IEntityPageAction[],
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
    breadcrumbs?: Array<{ label: Template; url?: string }>,
    /**
     * Page title with template support
     * 
     * @example pageTitle: 'Edit Team'
     * @example pageTitle: 'Edit {teamName}'
     */
    pageTitle?: Template,
    /**
     * Success message template for when entity is updated
     * 
     * @example successMessage: 'Team updated successfully!'
     * @example successMessage: '{teamName} updated successfully!'
     */
    successMessage?: Template,
    columnsConfig?: IEntityPageColumnConfig,
};

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: UpdateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {

    const{ entityName, actions, breadcrumbs, CRUDApiPath, pageTitle, successMessage } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const formPageConfig = makeUpdateEntityFormConfig(options, entityService);

    // Get primary identifier field for templates
    const pkComposite = entityService.getEntityPrimaryIdPropertyName();

    // Default back action with templates
    const defaultActions: IEntityPageAction[] = [
        {
            label:  "Back",
            template: `Back to ${entityNamePascalCase} Listing`,
            url:    `/list-${entityNameLower}`
        },
        {
            icon: 'delete',
            label: `Delete`,
            template: `Delete {${pkComposite}}`, // Dynamic label showing record ID
            openInModal: true,
            modalConfig: {
                modalType: 'confirm',
                modalPageConfig: {
                    title: `Delete ${entityNamePascalCase}?`,
                    content: `Are you sure you want to delete this ${entityNamePascalCase}? This action cannot be undone.`
                },
                apiConfig: {
                    apiMethod: `DELETE`,
                    responseKey: entityNameLower,
                    apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
                },
                successMessage: `${entityNamePascalCase} deleted successfully`,
                errorMessage: `Failed to delete ${entityNamePascalCase}`,
                submitSuccessRedirect: `/list-${entityNameLower}`
            }
        },
        {
            icon: 'copy',
            label: `Duplicate`,
            template: `Duplicate {${pkComposite}}`, // Dynamic label showing record ID
            openInModal: true,
            modalConfig: {
                modalType: 'confirm',
                modalPageConfig: {
                    title: `Duplicate ${entityNamePascalCase}?`,
                    content: `Are you sure you want to duplicate this ${entityNamePascalCase}?`
                },
                apiConfig: {
                    apiMethod: `GET`,
                    responseKey: entityNameLower,
                    apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}/duplicate`,
                },
                successMessage: `${entityNamePascalCase} duplicated successfully`,
                errorMessage: `Failed to duplicate ${entityNamePascalCase}`,
                submitSuccessRedirect: `/list-${entityNameLower}`
            }
        }
    ];

    // Combine default actions with custom actions
    const pageHeaderActions = [...defaultActions, ...(actions || [])];


    return {
        pageTitle: pageTitle || `Update ${entityNamePascalCase}`,
        pageType:   'form',
        breadcrumbs: breadcrumbs || [],
        pageHeaderActions: pageHeaderActions,
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

export function makeUpdateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> (
    options: UpdateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
){

    const{ entityName, properties, CRUDApiPath } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    const formPageConfig: any = {
        apiConfig: {
            apiMethod: `PATCH`,
            responseKey: entityNameCamel,
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
        },
        detailApiConfig: {
            apiMethod: "GET",
            responseKey: entityNameCamel,
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
        },
        formButtons: [ "submit", "reset"],
        propertiesConfig: [] as any[],
    };

    const formattedProps = formatEntityAttributesForUpdate(Array.from(properties.values()), entityService);

    formPageConfig.propertiesConfig.push(...formattedProps);

    // Add columnsConfig if provided
    if (options.columnsConfig) {
        formPageConfig.columnsConfig = options.columnsConfig;
    }

    return formPageConfig;
}