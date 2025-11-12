import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap, IEntityPageColumnConfig, Template, EntityEditPageConfig } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForCreate, mergeButtons, mergeFieldVisibility } from "./util";

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
    breadcrumbs?: ReadonlyArray<{ label: Template; url?: string }> | Array<{ label: Template; url?: string }>,
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
    /**
     * Form configuration including custom buttons and field-level visibility
     */
    formConfig?: EntityEditPageConfig['formConfig'];
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: CreateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {

    const{ entityName, breadcrumbs, pageTitle, successMessage } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const formPageConfig = makeCreateEntityFormConfig(options, entityService);

    // Add cancel button to the merged form buttons
    const cancelButton = { id: 'cancel', text: 'Cancel', action: 'cancel' as const, url: `/list-${entityNameLower}` };
    const finalFormButtons = [...formPageConfig.formButtons, cancelButton];

    return {
        pageTitle: pageTitle || `Create ${entityNamePascalCase}`,
        pageType:   'form',
        breadcrumbs: breadcrumbs || [],
        routePattern: `create-${entityNameLower}`,
        pageHeaderActions: [
            {
                label:  "Back",
                template: `Back`,
                url:    `/list-${entityNameLower}`
            }
        ], 
        formPageConfig: {
            ...formPageConfig,
            formButtons: finalFormButtons,  // Use merged buttons with cancel added
            submitSuccessRedirect: `/list-${entityNameLower}`,
            ...(successMessage && { successMessage })
        }
    };
};

export function makeCreateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> (
    options: CreateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
){

    const{ entityName, properties, CRUDApiPath, columnsConfig, formConfig } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    // 1. Generate base properties from schema
    let formattedProps = formatEntityAttributesForCreate(Array.from(properties.values()), entityService);

    // 2. Merge field-level visibility/helpText/placeholder from formConfig.fields
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

    const config: any = {
        apiConfig: {
            apiMethod: 'POST' as const,
            responseKey: entityNameCamel,
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
        },
        formButtons: finalButtons,  // Merged buttons
        propertiesConfig: formattedProps,  // Properties with field visibility merged
        entityName,  // Add entityName to config for evaluation system
        ...(columnsConfig && { columnsConfig })
    };

    return config;
}