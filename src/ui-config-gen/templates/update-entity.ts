import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { camelCase, pascalCase } from "../../utils";
import { formatEntityAttributesForUpdate } from "./util";
import { IEntityPageAction } from "../../entity/base-entity";
export type UpdateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string,
    entityNamePlural: string,
    CRUDApiPath?: string,
    properties: TIOSchemaAttributesMap<S>,
    actions?: IEntityPageAction[],
    breadcrumbs?: Array<{ label: string; url?: string }>,
};

export default <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string> >(
    options: UpdateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
) => {

    const{ entityName, actions, breadcrumbs, CRUDApiPath } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    const formPageConfig = makeUpdateEntityFormConfig(options, entityService);

    // Default back action
    const defaultActions: IEntityPageAction[] = [
        {
            label:  "Back",
            url:    `/list-${entityNameLower}`
        },
        {
            icon: 'delete',
            label: `Delete`,
            openInModal: true,
            modalConfig: {
                modalType: 'confirm',
                modalPageConfig: {
                    title: `Delete ${entityNamePascalCase}`,
                    content: `Are you sure you want to delete this ${entityNamePascalCase}?`
                },
                apiConfig: {
                    apiMethod: `DELETE`,
                    responseKey: entityNameLower,
                    apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
                },
                submitSuccessRedirect: `/list-${entityNameLower}`
            }
        },
        {
            icon: 'copy',
            label: `Duplicate`,
            openInModal: true,
            modalConfig: {
                modalType: 'confirm',
                modalPageConfig: {
                    title: `Duplicate ${entityNamePascalCase}`,
                    content: `Are you sure you want to duplicate this ${entityNamePascalCase}?`
                },
                apiConfig: {
                    apiMethod: `GET`,
                    responseKey: entityNameLower,
                    apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}/duplicate`,
                },
                submitSuccessRedirect: `/list-${entityNameLower}`
            }
        }
    ];

    // Combine default actions with custom actions
    const pageHeaderActions = [...defaultActions, ...(actions || [])];


    return {
        pageTitle:  `Update ${entityNamePascalCase}`,
        pageType:   'form',
        cardStyle: {
            width: '50%'
        },
        breadcrumbs: breadcrumbs || [],
        pageHeaderActions: pageHeaderActions,
        formPageConfig: {
            ...formPageConfig, 
            formButtons: [
                "submit", 
                "reset", 
                {
                    text:  "Cancel",
                    url:    `/list-${entityNameLower}`
                }
            ],
            submitSuccessRedirect: `/list-${entityNameLower}`
        }
    };
};

export function makeUpdateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> (
    options: UpdateEntityPageOptions<S>,
    entityService: BaseEntityService<S>
){

    const{ entityName, properties, CRUDApiPath } = options;
    const entityNameLower = entityName.toLowerCase();
    const entityNameCamel = camelCase(entityName);

    const formPageConfig = {
        apiConfig: {
            apiMethod: `PATCH`,
            responseKey: entityNameCamel,
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
        },
        detailApiConfig: {
            apiMethod: "GET",
            responseKey: entityNameCamel,
            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
        },
        formButtons: [ "submit", "reset"],
        propertiesConfig: [] as any[],
    }

    const formattedProps = formatEntityAttributesForUpdate(Array.from(properties.values()), entityService);

    formPageConfig.propertiesConfig.push(...formattedProps);

    return formPageConfig;
}