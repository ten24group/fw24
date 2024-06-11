import {  Schema } from "electrodb";
import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { camelCase, pascalCase } from "../../utils";

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: {
        entityName: string,
        entityNamePlural: string,
        properties: TIOSchemaAttributesMap<S>,
    }
) => {

    const{ entityName, properties } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);
    const entityNamePascalCase = pascalCase(entityName);
    
    let config = {
        pageTitle:  `${entityNamePascalCase} Details`,
        pageType:   'details',
        breadcrums: [],
        pageHeaderActions: [
            {
                label:  "Back",
                url:    `/list-${entityNameLower}`
            }
        ],
        detailsPageConfig: {
            detailApiConfig: {
                apiMethod: `GET`,
                responseKey: entityNameCamel,
                apiUrl: `/${entityNameLower}`,
            },
            propertiesConfig: [] as any[],
        }
    };

    const _propertiesConfig = config.detailsPageConfig.propertiesConfig;

    properties.forEach( prop => {
        if(prop){

            _propertiesConfig.push({
                ...prop,
                label:          prop.name,
                column:         prop.id,
                fieldType:      prop.fieldType || 'text',
                hidden: prop.hasOwnProperty('isVisible') && !prop.isVisible
            });
        }
    });

    return config;
};