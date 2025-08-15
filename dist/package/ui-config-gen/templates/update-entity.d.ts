import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { IEntityPageAction, IEntityPageColumnConfig } from "../../entity/base-entity";
export type UpdateEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
    entityName: string;
    entityNamePlural: string;
    CRUDApiPath?: string;
    properties: TIOSchemaAttributesMap<S>;
    actions?: IEntityPageAction[];
    breadcrumbs?: Array<{
        label: string;
        url?: string;
    }>;
    columnsConfig?: IEntityPageColumnConfig;
};
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: UpdateEntityPageOptions<S>, entityService: BaseEntityService<S>) => {
    pageTitle: string;
    pageType: string;
    breadcrumbs: {
        label: string;
        url?: string;
    }[];
    pageHeaderActions: IEntityPageAction[];
    formPageConfig: any;
};
export default _default;
export declare function makeUpdateEntityFormConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: UpdateEntityPageOptions<S>, entityService: BaseEntityService<S>): any;
