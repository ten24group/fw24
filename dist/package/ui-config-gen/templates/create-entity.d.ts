import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap } from "../../entity";
export type CreateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string;
    entityNamePlural: string;
    CRUDApiPath?: string;
    properties: TIOSchemaAttributesMap<S>;
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: CreateEntityPageOptions<S>, entityService: BaseEntityService<S>) => {
    pageTitle: string;
    pageType: string;
    breadcrums: never[];
    pageHeaderActions: {
        label: string;
        url: string;
    }[];
    formPageConfig: {
        formButtons: (string | {
            text: string;
            url: string;
        })[];
        submitSuccessRedirect: string;
        apiConfig: {
            apiMethod: string;
            responseKey: string;
            apiUrl: string;
        };
        propertiesConfig: any[];
    };
};
export default _default;
export declare function makeCreateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: CreateEntityPageOptions<S>, entityService: BaseEntityService<S>): {
    apiConfig: {
        apiMethod: string;
        responseKey: string;
        apiUrl: string;
    };
    formButtons: string[];
    propertiesConfig: any[];
};
