import { EntitySchema, TIOSchemaAttributesMap } from "../../entity";

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

    let listingConfig = {
        pageTitle:  `List Of ${options.entityNamePlural}`,
        pageType:   "list",
        breadcrums: [],
        pageHeaderActions: [
            {
                label:  "create",
                url:    `/create-${options.entityName.toLowerCase()}`
            }
        ],
        listPageConfig: {
            apiConfig: {
                apiUrl: `/${options.entityName.toLowerCase()}/list`,
                apiMethod: `GET`
            },
            propertiesConfig: [] as any[],
        }
    };

    const propertiesConfig = listingConfig.listPageConfig.propertiesConfig;

    options.properties.forEach( prop => {
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
                        url: `/edit-${options.entityName.toLowerCase()}`
                    },
                    {
                        icon: 'delete',
                        openInModel: true,
                        modelConfig: {
                            modalType: 'confirm',
                            modalPageConfig: {
                                title: `Delete ${options.entityName}`,
                                content: `Are you sure you want to delete this ${options.entityName}?`
                            },
                            apiConfig: {
                                apiUrl: `/${options.entityName.toLowerCase()}/delete`,
                                apiMethod: `GET`
                            },
                            confirmSuccessRedirect: `/list-${options.entityName.toLowerCase()}`
                        }
                    },
                    {
                        icon: `view`,
                        url: `/view-${options.entityName.toLowerCase()}`
                    }
                ];
            }

            propertiesConfig.push(propConfig);
        }
    });

    return listingConfig;
};