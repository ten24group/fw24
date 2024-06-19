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
        pageTitle:  `Update ${entityNamePascalCase}`,
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

            if( !prop.isEditable || prop.readOnly ){
                return;
            }

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