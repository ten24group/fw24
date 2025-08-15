import { BaseEntityService, TIOSchemaAttribute } from "../../entity";
export declare function formatEntityAttributeForFormOrDetail(thisProp: TIOSchemaAttribute, type: 'create' | 'update' | 'detail', entityService: BaseEntityService<any>): any;
export declare function formatEntityAttributesForFormOrDetail(properties: TIOSchemaAttribute[], type: 'create' | 'update' | 'detail', entityService: BaseEntityService<any>): any[];
export declare function formatEntityAttributesForCreate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>): any[];
export declare function formatEntityAttributesForUpdate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>): any[];
export declare function formatEntityAttributesForDetail(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>): any[];
export type ListingPropConfig = {
    name: string;
    dataIndex: string;
    fieldType: "text" | "textarea" | "password" | "email" | "number" | "date" | "time" | "datetime" | "boolean" | "switch" | "toggle" | "select" | "multi-select" | "autocomplete" | "radio" | "checkbox" | "color" | "range" | "hidden" | "custom" | "rating" | "file" | "image" | "rich-text" | "wysiwyg" | "code" | "markdown" | "json";
    hidden?: boolean;
    actions?: any[];
    placeholder?: string;
    helpText?: string;
    filterConfig?: {
        defaultOperator?: string;
        availableOperators?: string[];
        predefinedOptions?: Array<{
            label: string;
            value: string;
        }>;
        filterType?: 'text' | 'select' | 'datetime' | 'number' | 'boolean';
    };
};
export declare function formatEntityAttributesForList(entityName: string, properties: TIOSchemaAttribute[], { CRUDApiPath, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail }: {
    CRUDApiPath?: string;
    excludeFromAdminUpdate?: boolean;
    excludeFromAdminDelete?: boolean;
    excludeFromAdminDetail?: boolean;
}): ListingPropConfig[];
