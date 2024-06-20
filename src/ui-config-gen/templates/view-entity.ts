import {  Schema } from "electrodb";
import { EntitySchema, TIOSchemaAttribute, TIOSchemaAttributesMap } from "../../entity";
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

    const formatProps = (props: TIOSchemaAttribute[]) => props
    .filter( prop => prop && prop.isVisible )
    .map( formatProp );

    const formatProp = (thisProp: TIOSchemaAttribute) => {
        const formatted: any =  {
            ...thisProp,
            label:          thisProp.name,
            column:         thisProp.id,
            fieldType:      thisProp.fieldType || 'text',
            hidden: thisProp.hasOwnProperty('isVisible') && !thisProp.isVisible
        }; 

        const items = (thisProp as any).items;
        if(thisProp.type === 'map'){
            formatted['properties'] =  formatProps(thisProp.properties ?? []);
        } else if(thisProp.type === 'list' && items?.type === 'map'){
            formatted['items'] = {
                ...formatted['items'],
                properties: formatProps(items.properties ?? [])
            }
        }

        // TODO: add support for set, enum, and custom-types

        return formatted;
    }

    const formattedProps = formatProps(Array.from(properties.values()));

    _propertiesConfig.push(...formattedProps);

    return config;
};