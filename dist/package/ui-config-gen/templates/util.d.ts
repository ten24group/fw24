import { BaseEntityService, FieldMetadata, TIOSchemaAttribute, IRelationFieldConfig, TIOSchemaAttributesMap, EntitySchema, IFilterSegment } from "../../entity";
import type { RelationEntityOptionConfig, FieldOptionsAPIConfig, IEntityPageAction, Template, IFilterSegmentGroup } from '../../entity/base-entity';
import type { IApplicationConfig } from '../../interfaces/config';
/**
 * Generate smart fallback configuration for relation display when only ID is available.
 * Uses entity metadata (icon, entityNamePlural) to create user-friendly fallback text.
 *
 * @param entityName - Related entity name (e.g., 'team')
 * @param idField - ID field name (e.g., 'teamId')
 * @param entityService - Entity service to get metadata from
 * @returns Fallback configuration with template, linkText, and modalButtonText
 *
 * @example
 * // For a team relation
 * generateRelationFallback('team', 'teamId', teamService)
 * // Returns: {
 * //   template: 'Team: {teamId}',
 * //   linkText: 'View Team',
 * //   modalButtonText: 'Team Details'
 * // }
 */
export declare function generateRelationFallback(entityName: string, idField: string, entityService?: BaseEntityService<any>): NonNullable<IRelationFieldConfig['displayConfig']>['fallback'];
/**
 * Resolves RelationEntityOptionConfig into FieldOptionsAPIConfig by auto-detecting:
 * - CRUD API path from entity schema
 * - Label field from entityNameAttribute metadata
 * - Value field from relation identifiers
 *
 * @param relationConfig - Minimal relation option config
 * @param relationAttribute - The relation attribute (to get identifiers)
 * @param entityService - Entity service for schema lookup
 * @returns Fully resolved FieldOptionsAPIConfig or undefined if entity not found
 */
export declare function resolveRelationOptionConfig(relationConfig: RelationEntityOptionConfig, relationAttribute: TIOSchemaAttribute & {
    relation: NonNullable<TIOSchemaAttribute['relation']>;
}, entityService: BaseEntityService<any>): FieldOptionsAPIConfig<any> | undefined;
/**
 * Auto-generates filterConfig for entity attributes based on field type.
 *
 * Algorithm:
 * 1. Check if explicit filterConfig already exists → use it
 * 2. Check if field is explicitly non-filterable → skip
 * 3. Detect field type and generate appropriate config
 * 4. Merge with global and entity-level overrides
 *
 * @param attribute - The attribute to generate filter config for
 * @param entityService - Entity service for accessing entity metadata
 * @param globalUIConfigOptions - Global UI configuration options
 * @returns Generated filter configuration or undefined
 */
export declare function generateFilterConfig(attribute: TIOSchemaAttribute, entityService?: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']): FieldMetadata['filterConfig'] | undefined;
/**
 * Auto-generate filter segments based on entity attributes using smart detection.
 *
 * Algorithm:
 * 1. If custom segments provided → use them (highest priority)
 * 2. If entity requires manual segments → skip auto-generation
 * 3. Detect best field using scoring algorithm
 * 4. Generate segments from detected field with smart icons
 */
export declare function generateSegments<S extends EntitySchema<string, string, string>>(properties: TIOSchemaAttributesMap<S>, entityService?: BaseEntityService<S>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions'], customSegments?: ReadonlyArray<IFilterSegment | IFilterSegmentGroup> | Array<IFilterSegment | IFilterSegmentGroup>): ReadonlyArray<IFilterSegment | IFilterSegmentGroup> | Array<IFilterSegment | IFilterSegmentGroup> | undefined;
export declare function formatEntityAttributeForFormOrDetail(thisProp: TIOSchemaAttribute, type: 'create' | 'update' | 'detail', entityService: BaseEntityService<any>, allProperties?: TIOSchemaAttribute[], // Optional: for detecting duplicated relation fields
globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']): any;
export declare function formatEntityAttributesForFormOrDetail(properties: TIOSchemaAttribute[], type: 'create' | 'update' | 'detail', entityService: BaseEntityService<any>): any[];
export declare function formatEntityAttributesForCreate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']): any[];
export declare function formatEntityAttributesForUpdate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']): any[];
export declare function formatEntityAttributesForDetail(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']): any[];
export type ListingPropConfig = Pick<FieldMetadata, 'fieldType' | 'placeholder' | 'helpText' | 'filterConfig'> & {
    name: string;
    dataIndex: string;
    hidden?: boolean;
    actions?: Array<IEntityPageAction>;
    relationConfig?: IRelationFieldConfig;
    template?: Template;
    isIdentifier?: boolean;
    isLink?: boolean;
    linkConfig?: {
        routePattern: string;
        displayText?: string;
    };
};
export declare function formatEntityAttributesForList(entityName: string, properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, { CRUDApiPath, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail, customRowActions, globalUIConfigOptions }: {
    CRUDApiPath?: string;
    excludeFromAdminUpdate?: boolean;
    excludeFromAdminDelete?: boolean;
    excludeFromAdminDetail?: boolean;
    customRowActions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>;
    globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions'];
}): ListingPropConfig[];
/**
 * MERGE UTILITY FUNCTIONS
 *
 * These functions implement the identifier-based override pattern:
 * - Defaults have standard identifiers (e.g., 'view', 'edit', 'delete')
 * - Custom configs with same identifier override the default
 * - New identifiers get added to the result
 */
/**
 * Merge default buttons with custom buttons using identifier-based override.
 *
 * @param defaults - Default buttons (from generator)
 * @param customs - Custom buttons (from entity schema)
 * @returns Merged button array
 */
export declare function mergeButtons<T extends {
    id?: string;
}>(defaults: Array<T>, customs?: ReadonlyArray<T> | Array<T>): Array<T>;
/**
 * Merge default actions with custom actions using identifier-based override.
 * Same logic as mergeButtons but semantically named for actions.
 *
 * @param defaults - Default actions (from generator)
 * @param customs - Custom actions (from entity schema)
 * @returns Merged action array
 */
export declare function mergeActions<T extends {
    id?: string;
}>(defaults: Array<T>, customs?: ReadonlyArray<T> | Array<T>): Array<T>;
/**
 * Merge field-level visibility/enablement/helpText/placeholder into base properties.
 *
 * @param baseProperties - Base properties from schema
 * @param fieldOverrides - Field overrides from formConfig.fields
 * @returns Properties with overrides merged
 */
export declare function mergeFieldVisibility<T extends {
    name: string;
}>(baseProperties: Array<T>, fieldOverrides?: ReadonlyArray<{
    readonly name: string;
    readonly visibility?: any;
    readonly enablement?: any;
    readonly helpText?: string;
    readonly placeholder?: string;
}> | Array<{
    name: string;
    visibility?: any;
    enablement?: any;
    helpText?: string;
    placeholder?: string;
}>): Array<T>;
/**
 * Merge column-level visibility/width/fixed into base properties.
 *
 * @param baseProperties - Base properties from schema
 * @param columnOverrides - Column overrides from tableConfig.columns
 * @returns Properties with column overrides merged
 */
export declare function mergeColumnVisibility<T extends {
    name: string;
}>(baseProperties: Array<T>, columnOverrides?: ReadonlyArray<{
    readonly field: string;
    readonly visibility?: any;
    readonly width?: string | number;
    readonly fixed?: 'left' | 'right';
    readonly groupTitle?: string;
}> | Array<{
    field: string;
    visibility?: any;
    width?: string | number;
    fixed?: 'left' | 'right';
    groupTitle?: string;
}>): Array<T>;
