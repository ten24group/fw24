import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap, IEntityPageColumnConfig, Template, EntityEditPageConfig, EntityCreatePageConfig, ISectionsConfig, IErrorHandlingConfig, IRetryConfig, DisplayOverridesUIConfig } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForCreate, mergeButtons, mergeFieldVisibility, processSectionsConfig } from "./util";
import {
    applyDisplayOverrideStorageFieldFormDefaults,
    mergeDisplayOverrideFieldConfigIntoProperties,
} from "./merge-display-override-ui-fields";
import { IApplicationConfig } from "../../interfaces/config";

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
    formConfig?: EntityEditPageConfig[ 'formConfig' ];
    /**
     * Sections configuration for multi-section create pages with tabs/accordions
     */
    sectionsConfig?: ISectionsConfig;
    /**
     * Loading skeleton configuration.
     * @default { type: 'skeleton' }
     */
    loading?: EntityCreatePageConfig[ 'loading' ];
    /** Error handling configuration (#58) */
    errorHandling?: IErrorHandlingConfig;
    /** Retry configuration (#58) */
    retry?: IRetryConfig;
    /**
     * Global UI config options (for passing global configuration like duplicatedFieldDetection)
     */
    globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ];
    /** Auto-group secondary actions into a "More" dropdown */
    autoGroupActions?: boolean;
    /** Display overrides UI metadata (merged from model + createPageConfig in ui-config gen). */
    displayOverrides?: DisplayOverridesUIConfig;
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: CreateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {

    const { entityName, entityNamePlural, breadcrumbs, pageTitle, successMessage, errorHandling, retry } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const formPageConfig = makeCreateEntityFormConfig(options, entityService);

    // Add cancel button to the merged form buttons
    const cancelButton = { id: 'cancel', text: 'Cancel', action: 'cancel' as const, url: `/list-${entityNameLower}` };
    const finalFormButtons = [ ...formPageConfig.formButtons, cancelButton ];

    return {
        pageTitle: pageTitle || `Create ${entityNamePascalCase}`,
        pageType: 'form',
        breadcrumbs: breadcrumbs || [],
        routePattern: `create-${entityNameLower}`,
        pageHeaderActions: [
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
            }
        ],
        formPageConfig: {
            ...formPageConfig,
            formButtons: finalFormButtons,  // Use merged buttons with cancel added
            submitSuccessRedirect: `/list-${entityNameLower}`,
            ...(successMessage && { successMessage }),
            ...(errorHandling && { errorHandling }),
            ...(retry && { retry }),
        }
    };
};

export function makeCreateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: CreateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) {

    const { entityName, properties, CRUDApiPath, columnsConfig, formConfig, sectionsConfig, loading, globalUIConfigOptions, displayOverrides } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    // 1. Generate base properties from schema
    let formattedProps = formatEntityAttributesForCreate(Array.from(properties.values()), entityService, globalUIConfigOptions);

    // 2. Merge field-level visibility/helpText/placeholder from formConfig.fields
    if (formConfig?.fields) {
        formattedProps = mergeFieldVisibility(formattedProps, formConfig.fields);
    }

    if (options.displayOverrides) {
        formattedProps = mergeDisplayOverrideFieldConfigIntoProperties(formattedProps, options.displayOverrides);
        formattedProps = applyDisplayOverrideStorageFieldFormDefaults(formattedProps, options.displayOverrides);
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
        ...(columnsConfig && { columnsConfig }),
        ...(formConfig?.stickyActions != null && { stickyActions: formConfig.stickyActions }),
        ...(formConfig?.reviewBeforeSave && { reviewBeforeSave: formConfig.reviewBeforeSave }),
        ...(formConfig?.prefill && { prefill: formConfig.prefill }),
        ...(loading && { loading }),
    };

    // Add sectionsConfig if provided - process to expand shorthand propertiesConfig
    if (sectionsConfig) {
        config.sectionsConfig = processSectionsConfig(
            sectionsConfig,
            Array.from(properties.values()),
            entityService,
            globalUIConfigOptions,
            displayOverrides
        );
    }

    return config;
}