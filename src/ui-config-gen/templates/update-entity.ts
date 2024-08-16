import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForUpdate } from "./util";

export type UpdateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string,
    entityNamePlural: string,
    properties: TIOSchemaAttributesMap<S>,
};

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: UpdateEntityPageOptions<S>
) => {

    const{ entityName } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const formPageConfig = makeUpdateEntityFormConfig(options);

    return {
        pageTitle:  `Update ${entityNamePascalCase}`,
        pageType:   'form',
        cardStyle: {
            width: '50%'
        },
        breadcrums: [],
        pageHeaderActions: [
            {
                icon: 'copy',
                label: `Duplicate`,
                openInModal: true,
                modalConfig: {
                    modalType: 'confirm',
                    modalPageConfig: {
                        title: `Duplicate ${entityNamePascalCase}`,
                        content: `Are you sure you want to duplicate this ${entityNamePascalCase}?`
                    },
                    apiConfig: {
                        apiMethod: `GET`,
                        responseKey: entityNameLower,
                        apiUrl: `/${entityNameLower}/duplicate`,
                    },
                    submitSuccessRedirect: `/list-${entityNameLower}`
                }
            },
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

export function makeUpdateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> (
    options: UpdateEntityPageOptions<S>
){

    const{ entityName, properties } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    const formPageConfig = {
        apiConfig: {
            apiMethod: `PATCH`,
            responseKey: entityNameCamel,
            apiUrl: `/${entityNameLower}`,
        },
        detailApiConfig: {
            apiMethod: "GET",
            responseKey: entityNameCamel,
            apiUrl: `/${entityNameLower}`,
        },
        formButtons: [ "submit", "reset"],
        propertiesConfig: [] as any[],
    }

    const formattedProps = formatEntityAttributesForUpdate(Array.from(properties.values()));

    formPageConfig.propertiesConfig.push(...formattedProps);

    return formPageConfig;
}