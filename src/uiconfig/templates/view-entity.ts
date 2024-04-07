import {  Schema } from "electrodb";
import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: {
        entityName: string,
        entityNamePlural: string,
        properties: TIOSchemaAttributesMap<S>
    }
) => {

    let config = {
        pageTitle:  `${options.entityName} Details`,
        pageType:   'details',
        breadcrums: [],
        pageHeaderActions: [
            {
                label:  "Back",
                url:    `/list-${options.entityName.toLowerCase()}`
            }
        ],
        detailsPageConfig: {
            detailApiConfig: {
                apiMethod: `GET`,
                apiUrl: `/${options.entityName.toLowerCase()}/get`,
            },
            propertiesConfig: [] as any[],
        }
    };

    const propertiesConfig = config.detailsPageConfig.propertiesConfig;

    options.properties.forEach( prop => {
        if(prop){
            propertiesConfig.push({
                label:          `${prop.name}`,
                column:         `${prop.id}`,
                fieldType:      `${prop.fieldType || 'text'}`,
            });
        }
    });

    return config;
};