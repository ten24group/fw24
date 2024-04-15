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
        pageTitle:  `Update ${options.entityName}`,
        pageType:   'form',
        cardStyle: {
            width: '50%'
        },
        breadcrums: [],
        pageHeaderActions: [
            {
                label:  "Back",
                url:    `/list-${options.entityName.toLowerCase()}`
            },
        ],
        formPageConfig: {
            apiConfig: {
                apiMethod: `PATCH`,
                apiUrl: `/${options.entityName.toLowerCase()}/`,
            },
            detailApiConfig: {
                apiUrl: `/${options.entityName.toLowerCase()}/`,
                apiMethod: "GET"
            },
            formButtons: [ "submit", "cancel" ],
            propertiesConfig: [] as any[],
            submitSuccessRedirect: `/list-${options.entityName.toLowerCase()}`,
        }
    };

    const propertiesConfig = config.formPageConfig.propertiesConfig;

    options.properties.forEach( prop => {
        if(prop){
            propertiesConfig.push({
                label:          prop.name,
                column:         prop.id,
                fieldType:      `${prop.fieldType || 'text'}`,
                validations:    prop.validations
            });
        }
    });

    return config;
};