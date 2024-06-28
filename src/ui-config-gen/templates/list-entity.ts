import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { pascalCase } from "../../utils";
import { formatEntityAttributesForList } from "./util";

export type ListingPropConfig = {
    name: string,
    dataIndex: string,
    fieldType: string,
    hidden?: boolean,
    actions?: any[]
};

export type ListEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string,
    entityNamePlural: string,
    properties: TIOSchemaAttributesMap<S>
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: ListEntityPageOptions<S>
) => {

    const{ entityName, entityNamePlural, properties } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const listPageConfig = makeViewEntityListConfig(options);

    return {
        pageTitle:  `${entityNamePascalCase} Listing`,
        pageType:   "list",
        breadcrums: [],
        pageHeaderActions: [
            {
                label:  "Create",
                url:    `/create-${entityNameLower}`
            }
        ],
        listPageConfig
    };
};

export function makeViewEntityListConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> (
    options: ListEntityPageOptions<S>
){

    const{ entityName, properties } = options;
    const entityNameLower = entityName.toLowerCase();

    const listPageConfig = {
        apiConfig: {
            apiMethod: `GET`,
            responseKey: 'items',
            apiUrl: `/${entityNameLower}`,
        },
        propertiesConfig: [] as any[],
    }

    const formattedProps = formatEntityAttributesForList( entityName, Array.from(properties.values()) );

    listPageConfig.propertiesConfig.push(...formattedProps);

    return listPageConfig;
}