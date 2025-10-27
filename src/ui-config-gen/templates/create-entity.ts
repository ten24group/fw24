import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap, IEntityPageColumnConfig } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForCreate } from "./util";

export type CreateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string,
    entityNamePlural: string,
    CRUDApiPath?: string,
    properties: TIOSchemaAttributesMap<S>,
    breadcrumbs?: Array<{ label: string; url?: string }>,
    columnsConfig?: IEntityPageColumnConfig,
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: CreateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {

    const{ entityName, breadcrumbs } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const formPageConfig = makeCreateEntityFormConfig(options, entityService);

    return {
        pageTitle:  `Create ${entityNamePascalCase}`,
        pageType:   'form',
        breadcrumbs: breadcrumbs || [],
        pageHeaderActions: [
            {
                label:  "Back",
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
            submitSuccessRedirect: `/list-${entityNameLower}`
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