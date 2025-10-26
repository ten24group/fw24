import { BaseEntityService, FieldMetadata, TIOSchemaAttribute } from "../../entity";
export declare function formatEntityAttributeForFormOrDetail(thisProp: TIOSchemaAttribute, type: 'create' | 'update' | 'detail', entityService: BaseEntityService<any>): any;
export declare function formatEntityAttributesForFormOrDetail(properties: TIOSchemaAttribute[], type: 'create' | 'update' | 'detail', entityService: BaseEntityService<any>): any[];
export declare function formatEntityAttributesForCreate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>): any[];
export declare function formatEntityAttributesForUpdate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>): any[];
export declare function formatEntityAttributesForDetail(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>): any[];
export type ListingPropConfig = Pick<FieldMetadata, 'fieldType' | 'placeholder' | 'helpText' | 'filterConfig'> & {
    name: string;
    dataIndex: string;
    hidden?: boolean;
    actions?: any[];
};
export declare function formatEntityAttributesForList(entityName: string, properties: TIOSchemaAttribute[], { CRUDApiPath, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail }: {
    CRUDApiPath?: string;
    excludeFromAdminUpdate?: boolean;
    excludeFromAdminDelete?: boolean;
    excludeFromAdminDetail?: boolean;
}): ListingPropConfig[];
