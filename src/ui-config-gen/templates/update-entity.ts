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
        pageTitle:  `Update ${entityNameCamel}`,
        pageType:   'form',
        cardStyle: {
            width: '50%'
        },
        breadcrums: [],
        pageHeaderActions: [
            {
                label:  "Back",
                url:  `/list-${entityNameLower}`
            },
        ],
        formPageConfig: {
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
            formButtons: [ "submit", "cancel" ],
            propertiesConfig: [] as any[],
            submitSuccessRedirect: `/list-${entityNameLower}`,
        }
    };

    const _propertiesConfig = config.formPageConfig.propertiesConfig;

    properties.forEach( prop => {
        if(prop){
            _propertiesConfig.push({
                label:          prop.name,
                column:         prop.id,
                fieldType:      `${prop.fieldType || 'text'}`,
                validations:    prop.validations
            });
        }
    });

    return config;
};