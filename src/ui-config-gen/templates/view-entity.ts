import {  Schema } from "electrodb";
import { EntitySchema, TIOSchemaAttribute, TIOSchemaAttributesMap } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForDetail, formatEntityAttributesForFormOrDetail } from "./util";

export type ViewEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string,
    entityNamePlural: string,
    properties: TIOSchemaAttributesMap<S>,
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: ViewEntityPageOptions<S>
) => {

    const{ entityName } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);
    

    const detailsPageConfig = makeViewEntityDetailConfig(options);

    return {
        pageTitle:  `${entityNamePascalCase} Details`,
        pageType:   'details',
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
        detailsPageConfig,
    };
};

export function makeViewEntityDetailConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> (
    options: ViewEntityPageOptions<S>
){

    const{ entityName, properties } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    const detailsPageConfig = {
        detailApiConfig: {
            apiMethod: `GET`,
            responseKey: entityNameCamel,
            apiUrl: `/${entityNameLower}`,
        },
        propertiesConfig: [] as any[],
    }

    const formattedProps = formatEntityAttributesForDetail(Array.from(properties.values()));

    detailsPageConfig.propertiesConfig.push(...formattedProps);

    return detailsPageConfig;
}