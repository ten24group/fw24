import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { pascalCase } from "../../utils";

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
    const entityNamePascalCase = pascalCase(entityName);

    let listingConfig = {
        pageTitle:  `${entityNamePascalCase} Listing`,
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
                ...prop,
                hidden: !prop.isVisible,
                dataIndex:  `${prop.id}`,
                fieldType:  prop.fieldType || 'text',
            };

            if(prop?.isIdentifier){

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
                                title: `Delete ${entityNamePascalCase}`,
                                content: `Are you sure you want to delete this ${entityNamePascalCase}?`
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