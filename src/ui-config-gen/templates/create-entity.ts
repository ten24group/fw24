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
        pageTitle:  `Create ${entityNamePascalCase}`,
        pageType:   'form',
        cardStyle: {
            width: '50%'
        },
        breadcrums: [],
        pageHeaderActions: [
            {
                label:  "Back",
                url:    `/list-${entityNameLower}`
            }
        ],
        formPageConfig: {
            apiConfig: {
                apiMethod: `POST`,
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

            const propConfig = {
                ...prop,
                label:          prop.name,
                column:         prop.id,
                fieldType:      prop.fieldType || 'text',
            };

            _propertiesConfig.push(propConfig);
        }
    });

    return config;
};