import {  Schema } from "electrodb";
import { BaseEntityService, EntitySchema, TIOSchemaAttribute, TIOSchemaAttributesMap, EntityViewPageConfig } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForDetail, mergeFieldVisibility } from "./util";
import { IEntityPageAction, IEntityPageColumnConfig, Template } from "../../entity/base-entity";
import { DefaultLogger } from "../../logging";

export type ViewEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
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
     *   { label: '{teamName}' }  // Dynamic template from record data
     * ]
     */
    breadcrumbs?: ReadonlyArray<{ label: Template; url?: string }> | Array<{ label: Template; url?: string }>;
    /**
     * Page title with template support
     * 
     * @example pageTitle: 'Team Details'
     * @example pageTitle: '{teamName} - Team Details'
     * @example pageTitle: { composite: ['teamName', 'city'], template: '{teamName} ({city}) - Details' }
     */
    pageTitle?: Template;
    columnsConfig?: IEntityPageColumnConfig;
    /**
     * Field-level visibility overrides
     */
    fields?: EntityViewPageConfig['fields'];
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: ViewEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {
    const { entityName, CRUDApiPath, actions, breadcrumbs, pageTitle } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);
    const entityNamePascalCase = pascalCase(entityName);

    const detailsPageConfig = makeViewEntityDetailConfig(options, entityService);

    // Default back action
    const defaultActions: IEntityPageAction[] = [
        {
            label: "Back",
            template: `Back`,
            url: `/list-${entityNameLower}`,
            icon: "arrow-left"
        },
        {
            label: "Edit",
            template: `Edit`, // Dynamic template showing record ID
            url: `/edit-${entityNameLower}/:id`,
            icon: "edit",
        }
    ];

    // Combine default actions with custom actions
    const pageHeaderActions = [...defaultActions, ...(actions || [])];

    return {
        // Use custom pageTitle if provided, otherwise default
        pageTitle: pageTitle || `${entityNamePascalCase} Details`,
        pageType: 'details',
        breadcrumbs: breadcrumbs || [],
        pageHeaderActions,
        detailsPageConfig,
    } as const;
};

export function makeViewEntityDetailConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> (
    options: ViewEntityPageOptions<S>,
    entityService: BaseEntityService<S>
){
    const{ entityName, properties, CRUDApiPath, fields } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    // 1. Generate base properties from schema
    let formattedProps = formatEntityAttributesForDetail(Array.from(properties.values()), entityService);

    // 2. Merge field-level visibility/helpText from viewPageConfig.fields
    if (fields) {
        formattedProps = mergeFieldVisibility(formattedProps, fields);
    }

    const detailsPageConfig: any = {
        detailApiConfig: {
            apiMethod: `GET`,
            responseKey: entityNameCamel,
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
        },
        propertiesConfig: formattedProps,  // Properties with field visibility merged
        entityName,  // Add entityName to config for evaluation system
    }

    // Add columnsConfig if provided
    if (options.columnsConfig) {
        detailsPageConfig.columnsConfig = options.columnsConfig;
    }

    return detailsPageConfig;
}