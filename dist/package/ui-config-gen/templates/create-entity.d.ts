import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap, IEntityPageColumnConfig } from "../../entity";
export type CreateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string;
    entityNamePlural: string;
    CRUDApiPath?: string;
    properties: TIOSchemaAttributesMap<S>;
    breadcrumbs?: Array<{
        label: string;
        url?: string;
    }>;
    columnsConfig?: IEntityPageColumnConfig;
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: CreateEntityPageOptions<S>, entityService: BaseEntityService<S>) => {
    pageTitle: string;
    pageType: string;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
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
        columnsConfig?: IEntityPageColumnConfig | undefined;
        apiConfig: {
            apiMethod: "POST";
            responseKey: string;
            apiUrl: string;
        };
        propertiesConfig: any[];
    };
};
export default _default;
export declare function makeCreateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: CreateEntityPageOptions<S>, entityService: BaseEntityService<S>): {
    columnsConfig?: IEntityPageColumnConfig | undefined;
    apiConfig: {
        apiMethod: "POST";
        responseKey: string;
        apiUrl: string;
    };
    formButtons: readonly ["submit", "reset"];
    propertiesConfig: any[];
};
