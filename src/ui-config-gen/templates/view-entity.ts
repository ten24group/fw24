import {  Schema } from "electrodb";
import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { camelCase } from "../../utils";

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: {
        entityName: string,
        entityNamePlural: string,
        properties: TIOSchemaAttributesMap<S>
    }
) => {

    const{ entityName, properties } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);
    
    let config = {
        pageTitle:  `${entityName} Details`,
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
                apiUrl: `/${entityNameLower}/`,
            },
            propertiesConfig: [] as any[],
        }
    };

    const _propertiesConfig = config.detailsPageConfig.propertiesConfig;

    properties.forEach( prop => {
        if(prop){
            _propertiesConfig.push({
                label:          `${prop.name}`,
                column:         `${prop.id}`,
                fieldType:      `${prop.fieldType || 'text'}`,
            });
        }
    });

    return config;
};