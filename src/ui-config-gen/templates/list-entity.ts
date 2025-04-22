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
    excludeFromAdminCreate?: boolean,
    excludeFromAdminUpdate?: boolean,
    excludeFromAdminDelete?: boolean,
    excludeFromAdminDetail?: boolean,
    CRUDApiPath?: string,
    properties: TIOSchemaAttributesMap<S>
}

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: ListEntityPageOptions<S>
) => {

    const{ entityName, entityNamePlural, properties } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const listPageConfig = makeViewEntityListConfig(options);

    const pageHeaderAction = [];
    if(!options.excludeFromAdminCreate){
        pageHeaderAction.push({
            label:  "Create",
            url:    `/create-${entityNameLower}`
        });
    }

    return {
        pageTitle:  `${entityNamePascalCase} Listing`,
        pageType:   "list",
        breadcrums: [],
        pageHeaderActions: pageHeaderAction,
        listPageConfig
    };
};

export function makeViewEntityListConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> (
    options: ListEntityPageOptions<S>
){

    const{ entityName, properties, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail, CRUDApiPath } = options;
    const entityNameLower = entityName.toLowerCase();

    const listPageConfig = {
        apiConfig: {
            apiMethod: `GET`,
            responseKey: 'items',
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
        },
        propertiesConfig: [] as any[],
    }

    const formattedProps = formatEntityAttributesForList( entityName, Array.from(properties.values()), {
        excludeFromAdminUpdate,
        excludeFromAdminDelete,
        excludeFromAdminDetail
    } );

    listPageConfig.propertiesConfig.push(...formattedProps);

    return listPageConfig;
}