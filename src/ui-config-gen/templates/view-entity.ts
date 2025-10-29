import {  Schema } from "electrodb";
import { BaseEntityService, EntitySchema, TIOSchemaAttribute, TIOSchemaAttributesMap } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForDetail } from "./util";
import { IEntityPageAction, IEntityPageColumnConfig, Template } from "../../entity/base-entity";

export type ViewEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string;
    entityNamePlural: string;
    CRUDApiPath?: string;
    properties: TIOSchemaAttributesMap<S>;
    actions?: IEntityPageAction[];
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
    breadcrumbs?: Array<{ label: Template; url?: string }>;
    /**
     * Page title with template support
     * 
     * @example pageTitle: 'Team Details'
     * @example pageTitle: '{teamName} - Team Details'
     * @example pageTitle: { composite: ['teamName', 'city'], template: '{teamName} ({city}) - Details' }
     */
    pageTitle?: Template;
    columnsConfig?: IEntityPageColumnConfig;
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: ViewEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {
    const { entityName, CRUDApiPath, actions, breadcrumbs, pageTitle } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const detailsPageConfig = makeViewEntityDetailConfig(options, entityService);

    // Get primary identifier field for templates
    const pkComposite = entityService.getEntityPrimaryIdPropertyName();


    // Default back action
    const defaultActions: IEntityPageAction[] = [
        {
            label: "Back",
            template: `Back to ${entityNamePascalCase} Listing`,
            url: `/list-${entityNameLower}`,
            icon: "arrow-left"
        },
        {
            label: "Edit",
            template: `Edit {${pkComposite}}`, // Dynamic template showing record ID
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
    const{ entityName, properties, CRUDApiPath } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    const detailsPageConfig: any = {
        detailApiConfig: {
            apiMethod: `GET`,
            responseKey: entityNameCamel,
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
        },
        propertiesConfig: [] as any[],
    }

    const formattedProps = formatEntityAttributesForDetail(Array.from(properties.values()), entityService);
    detailsPageConfig.propertiesConfig.push(...formattedProps);

    // Add columnsConfig if provided
    if (options.columnsConfig) {
        detailsPageConfig.columnsConfig = options.columnsConfig;
    }

    return detailsPageConfig;
}