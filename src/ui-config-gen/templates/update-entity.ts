import { BaseEntityService, EntityEditPageConfig, EntitySchema, TIOSchemaAttributesMap, ISectionsConfig, IErrorHandlingConfig, IRetryConfig, DisplayOverridesUIConfig } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForUpdate, mergeButtons, mergeFieldVisibility, processSectionsConfig, groupPageHeaderActions } from "./util";
import {
    applyDisplayOverrideStorageFieldFormDefaults,
    mergeDisplayOverrideFieldConfigIntoProperties,
} from "./merge-display-override-ui-fields";
import { IEntityPageAction, IEntityPageColumnConfig, Template } from "../../entity/base-entity";
import { DefaultLogger } from "../../logging";
import { IApplicationConfig } from "../../interfaces/config";

export type UpdateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string,
    entityNamePlural: string,
    CRUDApiPath?: string,
    properties: TIOSchemaAttributesMap<S>,
    excludeFromAdminDelete?: boolean,
    excludeFromAdminCreate?: boolean,
    excludeFromAdminDuplicate?: boolean,
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
    formConfig?: EntityEditPageConfig[ 'formConfig' ];
    /**
     * Sections configuration for multi-section update pages with tabs/accordions
     */
    sectionsConfig?: ISectionsConfig;
    /**
     * Loading skeleton configuration.
     * @default { type: 'skeleton' }
     */
    loading?: EntityEditPageConfig[ 'loading' ];
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
    /** Display overrides UI metadata (merged from model + editPageConfig in ui-config gen). */
    displayOverrides?: DisplayOverridesUIConfig;
    /**
     * After successful PATCH, navigate here instead of the default `/view-{entity}/:id`.
     * @example "/list-post" to send users back to the listing
     */
    submitSuccessRedirect?: string;
    /**
     * Cancel button URL instead of the default `/view-{entity}/:id`.
     * @example "/list-post"
     */
    cancelRedirectUrl?: string;
};

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: UpdateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {

    const {
        entityName,
        entityNamePlural,
        actions,
        breadcrumbs,
        CRUDApiPath,
        pageTitle,
        successMessage,
        errorHandling,
        retry,
        excludeFromAdminDelete,
        excludeFromAdminCreate,
        excludeFromAdminDuplicate,
        autoGroupActions,
        submitSuccessRedirect: submitSuccessRedirectOverride,
        cancelRedirectUrl: cancelRedirectUrlOverride,
    } = options;
    const entityNameLower = entityName.toLowerCase();
    const defaultListPath = `/list-${entityNameLower}`;
    /** Default after save / cancel on edit form: return to the entity detail page (same record). */
    const defaultDetailPath = `/view-${entityNameLower}/:id`;
    const effectiveSubmitSuccessRedirect = submitSuccessRedirectOverride ?? defaultDetailPath;
    const effectiveCancelUrl = cancelRedirectUrlOverride ?? defaultDetailPath;
    const entityNameCamel = camelCase(entityName);
    const entityNamePascalCase = pascalCase(entityName);

    const formPageConfig = makeUpdateEntityFormConfig(options, entityService);

    const primaryActions: IEntityPageAction[] = [
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
        },
    ];

    const secondaryActions: IEntityPageAction[] = [];

    if (!excludeFromAdminDelete) {
        secondaryActions.push({
            id: 'delete',
            icon: 'delete',
            label: `Delete`,
            template: `Delete`,
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
                submitSuccessRedirect: defaultListPath
            }
        });
    }

    if (!excludeFromAdminDuplicate && !excludeFromAdminCreate) {
        secondaryActions.push({
            id: 'duplicate',
            icon: 'copy',
            label: `Duplicate`,
            template: `Duplicate`,
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
                submitSuccessRedirect: defaultListPath
            }
        });
    }

    // Add custom actions to secondary
    secondaryActions.push(...(actions || []));

    const shouldGroup = autoGroupActions ?? true;
    const pageHeaderActions = groupPageHeaderActions(primaryActions, secondaryActions, shouldGroup);


    // Add cancel button to the merged form buttons
    const cancelButton = { id: 'cancel', text: 'Cancel', action: 'cancel' as const, url: effectiveCancelUrl };
    const finalFormButtons = [ ...formPageConfig.formButtons, cancelButton ];

    return {
        pageTitle: pageTitle || `Update ${entityNamePascalCase}`,
        pageType: 'form',
        routePattern: `/edit-${entityNameLower}/:id`,
        breadcrumbs: breadcrumbs || [],
        pageHeaderActions: pageHeaderActions,
        formPageConfig: {
            ...formPageConfig,
            formButtons: finalFormButtons,  // Use merged buttons with cancel added
            submitSuccessRedirect: effectiveSubmitSuccessRedirect,
            ...(successMessage && { successMessage }),
            ...(errorHandling && { errorHandling }),
            ...(retry && { retry }),
        }
    };
};

export function makeUpdateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(
    options: UpdateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) {

    const { entityName, properties, CRUDApiPath, formConfig, sectionsConfig, loading, globalUIConfigOptions, displayOverrides } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    // 1. Generate base properties from schema
    let formattedProps = formatEntityAttributesForUpdate(Array.from(properties.values()), entityService, globalUIConfigOptions);

    // 2. Merge field-level visibility/enablement/helpText/placeholder from formConfig.fields
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

    const formPageConfig: any = {
        apiConfig: {
            apiMethod: `PATCH`,
            responseKey: entityNameCamel,
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}/:id`,
        },
        detailApiConfig: {
            apiMethod: "GET",
            responseKey: entityNameCamel,
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}/:id`,
        },
        formButtons: finalButtons,  // Merged buttons
        propertiesConfig: formattedProps,  // Properties with field visibility merged
        entityName,  // Add entityName to config for evaluation system
        ...(formConfig?.stickyActions != null && { stickyActions: formConfig.stickyActions }),
        ...(formConfig?.reviewBeforeSave && { reviewBeforeSave: formConfig.reviewBeforeSave }),
        ...(formConfig?.prefill && { prefill: formConfig.prefill }),
        ...(loading && { loading }),
    };

    // Add columnsConfig if provided
    if (options.columnsConfig) {
        formPageConfig.columnsConfig = options.columnsConfig;
    }

    // Add sectionsConfig if provided - process to expand shorthand propertiesConfig
    if (sectionsConfig) {
        formPageConfig.sectionsConfig = processSectionsConfig(
            sectionsConfig,
            Array.from(properties.values()),
            entityService,
            globalUIConfigOptions,
            displayOverrides
        );
    }

    return formPageConfig;
}