import { BaseEntityService, EntitySchema, TIOSchemaAttributesMap } from "../../entity";
import { IEntityPageAction, IEntityPageColumnConfig } from "../../entity/base-entity";
export type ViewEntityPageOptions<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>> = {
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
declare const _default: <S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ViewEntityPageOptions<S>, entityService: BaseEntityService<S>) => {
    readonly pageTitle: `${string} Details`;
    readonly pageType: "details";
    readonly breadcrumbs: {
        label: string;
        url?: string;
    }[];
    readonly pageHeaderActions: IEntityPageAction[];
    readonly detailsPageConfig: any;
};
export default _default;
export declare function makeViewEntityDetailConfig<S extends EntitySchema<string, string, string> = EntitySchema<string, string, string>>(options: ViewEntityPageOptions<S>, entityService: BaseEntityService<S>): any;
