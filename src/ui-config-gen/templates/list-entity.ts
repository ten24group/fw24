import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { camelCase } from "../../utils";

export type ListingPropConfig = {
    name: string,
    dataIndex: string,
    fieldType: string,
    hidden?: boolean,
    actions?: any[]
};

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: {
        entityName: string,
        entityNamePlural: string,
        properties: TIOSchemaAttributesMap<S>
    }
) => {

    const{ entityName, entityNamePlural, properties } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    let listingConfig = {
        pageTitle:  `${camelCase(entityNamePlural)} Listing`,
        pageType:   "list",
        breadcrums: [],
        pageHeaderActions: [
            {
                label:  "create",
                url:    `/create-${entityNameLower}`
            }
        ],
        listPageConfig: {
            apiConfig: {
                apiMethod: `GET`,
                responseKey: 'items',
                apiUrl: `/${entityNameLower}`,
            },
            propertiesConfig: [] as any[],
        }
    };

    const _propertiesConfig = listingConfig.listPageConfig.propertiesConfig;

    properties.forEach( prop => {
        if(prop){
            const propConfig: ListingPropConfig = {
                name:      `${prop.name}`,
                dataIndex:  `${prop.id}`,
                fieldType:  `${prop.fieldType || 'text'}`
            };

            if(prop?.isIdentifier){
                propConfig.hidden = true;

                propConfig.actions = [
                    {
                        icon: 'edit',
                        url: `/edit-${entityNameLower}`
                    },
                    {
                        icon: 'delete',
                        openInModel: true,
                        modelConfig: {
                            modalType: 'confirm',
                            modalPageConfig: {
                                title: `Delete ${entityNameCamel}`,
                                content: `Are you sure you want to delete this ${entityNameCamel}?`
                            },
                            apiConfig: {
                                apiMethod: `DELETE`,
                                responseKey: entityNameLower,
                                apiUrl: `/${entityNameLower}`,
                            },
                            confirmSuccessRedirect: `/list-${entityNameLower}`
                        }
                    },
                    {
                        icon: `view`,
                        url: `/view-${entityNameLower}`
                    }
                ];
            }

            _propertiesConfig.push(propConfig);
        }
    });

    return listingConfig;
};