import {  Schema } from "electrodb";
import { BaseEntityService, EntitySchema, TIOSchemaAttribute, TIOSchemaAttributesMap } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForDetail } from "./util";
import { IEntityPageAction, IEntityPageColumnConfig } from "../../entity/base-entity";

export type ViewEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string;
    entityNamePlural: string;
    CRUDApiPath?: string;
    properties: TIOSchemaAttributesMap<S>;
    actions?: IEntityPageAction[];
    breadcrumbs?: Array<{ label: string; url?: string }>;
    columnsConfig?: IEntityPageColumnConfig;
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: ViewEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {
    const { entityName, CRUDApiPath, actions, breadcrumbs } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const detailsPageConfig = makeViewEntityDetailConfig(options, entityService);

    // Default back action
    const defaultActions: IEntityPageAction[] = [
        {
            label: "Back",
            url: `/list-${entityNameLower}`,
            icon: "arrow-left"
        },
        {
            label: "Edit",
            url: `/edit-${entityNameLower}/:id`,
            icon: "edit",
        }
    ];

    // Combine default actions with custom actions
    const pageHeaderActions = [...defaultActions, ...(actions || [])];

    return {
        pageTitle: `${entityNamePascalCase} Details`,
        pageType: 'details',
        breadcrumbs: breadcrumbs || [],
        pageHeaderActions,
        detailsPageConfig,
    };
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