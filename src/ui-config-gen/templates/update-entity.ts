import { BaseEntityService, EntityEditPageConfig, EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForUpdate, mergeButtons, mergeFieldVisibility } from "./util";
import { IEntityPageAction, IEntityPageColumnConfig, Template } from "../../entity/base-entity";
import { DefaultLogger } from "../../logging";
export type UpdateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string,
    entityNamePlural: string,
    CRUDApiPath?: string,
    properties: TIOSchemaAttributesMap<S>,
    actions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>,
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
    breadcrumbs?: ReadonlyArray<{ label: Template; url?: string }> | Array<{ label: Template; url?: string }>,
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
    /**
     * Form configuration including custom buttons and field-level visibility
     */
    formConfig?: EntityEditPageConfig['formConfig'];
};

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: UpdateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {

    const{ entityName, actions, breadcrumbs, CRUDApiPath, pageTitle, successMessage } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);
    const entityNamePascalCase = pascalCase(entityName);

    const formPageConfig = makeUpdateEntityFormConfig(options, entityService);

    // Default back action with templates
    const defaultActions: IEntityPageAction[] = [
        {
            label:  "Back",
            template: `Back`,
            url:    `/list-${entityNameLower}`
        },
        {
            icon: 'delete',
            label: `Delete`,
            template: `Delete`, // Dynamic label showing record ID
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
            template: `Duplicate`, // Dynamic label showing record ID
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


    // Add cancel button to the merged form buttons
    const cancelButton = { id: 'cancel', text: 'Cancel', action: 'cancel' as const, url: `/list-${entityNameLower}` };
    const finalFormButtons = [...formPageConfig.formButtons, cancelButton];

    return {
        pageTitle: pageTitle || `Update ${entityNamePascalCase}`,
        pageType:   'form',
        breadcrumbs: breadcrumbs || [],
        pageHeaderActions: pageHeaderActions,
        formPageConfig: {
            ...formPageConfig,
            formButtons: finalFormButtons,  // Use merged buttons with cancel added
            submitSuccessRedirect: `/list-${entityNameLower}`,
            ...(successMessage && { successMessage })
        }
    };
};

export function makeUpdateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> (
    options: UpdateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
){

    const{ entityName, properties, CRUDApiPath, formConfig } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    // 1. Generate base properties from schema
    let formattedProps = formatEntityAttributesForUpdate(Array.from(properties.values()), entityService);

    // 2. Merge field-level visibility/enablement/helpText/placeholder from formConfig.fields
    if (formConfig?.fields) {
        formattedProps = mergeFieldVisibility(formattedProps, formConfig.fields);
    }

    // 3. Build default form buttons with IDs
    const defaultButtons = [
        { id: 'submit', text: 'Submit', action: 'submit' as const },
        { id: 'reset', text: 'Reset', action: 'reset' as const }
    ];

    // 4. Merge custom buttons from formConfig.buttons (override/add pattern)
    const finalButtons = formConfig?.buttons
        ? mergeButtons(defaultButtons, formConfig.buttons as any[])
        : defaultButtons;

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
        formButtons: finalButtons,  // Merged buttons
        propertiesConfig: formattedProps,  // Properties with field visibility merged
        entityName,  // Add entityName to config for evaluation system
    };

    // Add columnsConfig if provided
    if (options.columnsConfig) {
        formPageConfig.columnsConfig = options.columnsConfig;
    }

    return formPageConfig;
}