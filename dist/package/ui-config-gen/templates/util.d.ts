import { BaseEntityService, FieldMetadata, TIOSchemaAttribute, IRelationFieldConfig, TIOSchemaAttributesMap, EntitySchema, IFilterSegment } from "../../entity";
import type { RelationEntityOptionConfig, FieldOptionsAPIConfig, IEntityPageAction, Template, IFilterSegmentGroup, ITableColumns } from '../../entity/base-entity';
import type { IApplicationConfig } from '../../interfaces/config';
import type { DisplayOverridesUIConfig } from '../../entity/display-override-types';
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
/**
 * Generates fallback display configuration for relation fields.
 *
 * Creates user-friendly fallback text to display when only the ID of a related entity is available.
 * Uses the entity's plural display name (from metadata) or generates it from the entity name.
 *
 * @param entityName - Name of the related entity (e.g., 'team', 'user')
 * @param idField - ID field name (e.g., 'teamId', 'userId')
 * @param entityService - Optional entity service to fetch metadata for better naming
 * @returns Fallback configuration with template, link text, and modal button text
 *
 * @example
 * ```typescript
 * const fallback = generateRelationFallback('team', 'teamId');
 * // Returns: {
 * //   template: "Teams: {teamId}",
 * //   linkText: "View Teams",
 * //   modalButtonText: "Teams Details"
 * // }
 * ```
 */
export declare function generateRelationFallback(entityName: string, idField: string, entityService?: BaseEntityService<any>): NonNullable<IRelationFieldConfig['displayConfig']>['fallback'];
/**
 * Resolves RelationEntityOptionConfig into FieldOptionsAPIConfig by auto-detecting:
 * - CRUD API path from entity schema
 * - Label field from entityNameAttribute metadata or smart detection
 * - Value field from relation identifiers
 *
 * @param relationConfig - Minimal relation option config
 * @param relationAttribute - The relation attribute (to get identifiers)
 * @param entityService - Entity service for schema lookup
 * @param globalUIConfigOptions - Global UI config options (for label field detection)
 * @returns Fully resolved FieldOptionsAPIConfig or undefined if entity not found
 */
export declare function resolveRelationOptionConfig(relationConfig: RelationEntityOptionConfig, relationAttribute: TIOSchemaAttribute & {
    relation: NonNullable<TIOSchemaAttribute['relation']>;
}, entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']): FieldOptionsAPIConfig<any> | undefined;
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
/**
 * Formats a single entity attribute for form or detail page display.
 *
 * Transforms schema attributes into UI-ready field configurations with proper field types,
 * relation configs, options, visibility, and validation rules. Auto-generates relation
 * display configurations and filter configs when not explicitly provided.
 *
 * @param thisProp - The entity attribute to format
 * @param type - Page type: 'create', 'update', or 'detail'
 * @param entityService - Entity service for accessing related schemas
 * @param allProperties - Optional array of all properties for detecting duplicated relation fields
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Formatted field metadata ready for UI rendering
 *
 * @example
 * ```typescript
 * const formattedField = formatEntityAttributeForFormOrDetail(
 *   {
 *     id: 'teamId',
 *     name: 'teamId',
 *     type: 'string',
 *     relation: { type: 'one', entity: 'team' }
 *   },
 *   'create',
 *   entityService
 * );
 * // Returns field with relationConfig, filterConfig, and proper field type
 * ```
 */
export declare function formatEntityAttributeForFormOrDetail(thisProp: TIOSchemaAttribute, type: 'create' | 'update' | 'detail', entityService: BaseEntityService<any>, allProperties?: TIOSchemaAttribute[], // Optional: for detecting duplicated relation fields
globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']): any;
/**
 * Routes attribute formatting to the appropriate type-specific formatter.
 *
 * Convenience function that delegates to formatEntityAttributesForCreate,
 * formatEntityAttributesForUpdate, or formatEntityAttributesForDetail based on type.
 *
 * @param properties - Array of entity attributes to format
 * @param type - Page type: 'create', 'update', or 'detail'
 * @param entityService - Entity service for accessing schemas
 * @returns Array of formatted field metadata
 * @throws Error if invalid type is provided
 */
export declare function formatEntityAttributesForFormOrDetail(properties: TIOSchemaAttribute[], type: 'create' | 'update' | 'detail', entityService: BaseEntityService<any>): any[];
/**
 * Expands shorthand field references into full PropertyConfig objects.
 *
 * **Enterprise-Grade Pattern Supporting:**
 *
 * 1. **String shorthand (schema fields only):** `'fieldName'` → looks up in schema, expands to full config
 * 2. **Object with schema field:** `{ name: 'status', fieldType: 'badge' }` → merges overrides with schema defaults
 * 3. **JSON path (nested data):** `{ name: 'userEmail', column: 'user.email', label: 'Email', fieldType: 'text' }`
 * 4. **Multiple renderings:** `{ name: 'statusBadge', column: 'status', fieldType: 'badge' }` + `{ name: 'statusText', column: 'status', fieldType: 'text' }`
 * 5. **Custom/computed fields:** `{ name: 'confirmPassword', label: 'Confirm', column: 'confirmPassword', fieldType: 'password' }`
 * 6. **Visibility control:** All configs support `visibility: Condition` for role-based/conditional display
 *
 * **Key Concepts:**
 * - `name`: Unique UI identifier (must be unique within a single propertiesConfig)
 * - `column`: Data path - can be direct field, JSON path (`user.email`), or custom field
 * - Frontend uses `getNestedValue(record, column)` for data access (supports JSON paths)
 *
 * This is the property equivalent of `normalizeColumnOverrides()`.
 *
 * @param fieldReferences - Array containing strings (field names) or PropertyConfig objects
 * @param allProperties - All entity attributes from schema for field lookup
 * @param type - Page type: 'create', 'update', or 'detail' (determines formatting)
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Array of full PropertyConfig objects
 *
 * @example
 * // 1. String shorthand (schema fields only)
 * propertiesConfig: ['teamName', 'city', 'status']
 *
 * @example
 * // 2. Override schema field display
 * propertiesConfig: [
 *   'teamName',
 *   { name: 'status', fieldType: 'badge' },  // Same field, different rendering
 *   'total'
 * ]
 *
 * @example
 * // 3. Multiple renderings of same field
 * propertiesConfig: [
 *   { name: 'progressBar', column: 'progress', label: 'Progress', fieldType: 'progress' },
 *   { name: 'progressValue', column: 'progress', label: 'Value', fieldType: 'number' }
 * ]
 *
 * @example
 * // 4. JSON paths (nested data)
 * propertiesConfig: [
 *   'teamName',
 *   { name: 'userEmail', column: 'user.email', label: 'Email', fieldType: 'text' },
 *   { name: 'settingsTheme', column: 'metadata.settings.theme', label: 'Theme', fieldType: 'text' }
 * ]
 *
 * @example
 * // 5. Custom/computed fields (not in schema, API provides them)
 * propertiesConfig: [
 *   'password',
 *   {
 *     name: 'confirmPassword',
 *     label: 'Confirm Password',
 *     column: 'confirmPassword',
 *     fieldType: 'password',
 *     required: true
 *   }
 * ]
 *
 * @example
 * // 6. With visibility config
 * propertiesConfig: [
 *   'teamName',
 *   {
 *     name: 'adminNotes',
 *     label: 'Admin Notes',
 *     column: 'adminNotes',
 *     fieldType: 'textarea',
 *     visibility: { actor: { groups: { inList: ['admin'] } } }
 *   }
 * ]
 */
export declare function expandPropertyReferences(fieldReferences: ReadonlyArray<string | any> | Array<string | any>, allProperties: TIOSchemaAttribute[], type: 'create' | 'update' | 'detail', entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']): any[];
/**
 * Processes sectionsConfig and expands any shorthand propertiesConfig arrays.
 *
 * **Unified with column processing:**
 * - Uses `expandPropertyReferences()` (same pattern as `normalizeColumnOverrides()`)
 * - String shorthand `'fieldName'` → expands from schema
 * - Object syntax → merges with schema defaults
 *
 * Recursively walks through section groups and sections.
 *
 * @param sectionsConfig - Sections configuration from entity schema
 * @param allProperties - All entity attributes from schema for field lookup
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Processed sections config with expanded properties
 */
export declare function processSectionsConfig(sectionsConfig: any, allProperties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions'], 
/** When set, nested detail/form field rows receive the same displayOverride merge as root pages. */
displayOverrides?: DisplayOverridesUIConfig): any;
/**
 * Formats entity attributes for create form pages.
 *
 * Filters attributes to include only creatable fields (respects isCreatable flag)
 * and formats each for create form display.
 *
 * @param properties - Array of entity attributes from schema
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Array of formatted field metadata for create forms
 */
export declare function formatEntityAttributesForCreate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']): any[];
/**
 * Formats entity attributes for update/edit form pages.
 *
 * Filters attributes to include only editable fields (respects isEditable flag)
 * and formats each for update form display.
 *
 * @param properties - Array of entity attributes from schema
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Array of formatted field metadata for update forms
 */
export declare function formatEntityAttributesForUpdate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']): any[];
/**
 * Formats entity attributes for detail/view pages.
 *
 * Filters attributes to include only visible fields (respects isVisible flag)
 * and formats each for detail page display.
 *
 * @param properties - Array of entity attributes from schema
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Array of formatted field metadata for detail views
 */
export declare function formatEntityAttributesForDetail(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']): any[];
/**
 * Type definition for list/table column configuration.
 *
 * Extends FieldMetadata with list-specific properties like actions, templates,
 * and relation rendering configurations.
 */
export type ListingPropConfig = Pick<FieldMetadata, 'fieldType' | 'placeholder' | 'helpText' | 'filterConfig'> & {
    name: string;
    dataIndex: string;
    hidden?: boolean;
    actions?: Array<IEntityPageAction>;
    relationConfig?: IRelationFieldConfig;
    template?: Template;
    isIdentifier?: boolean;
    /** @deprecated Optional - presence of linkConfig is sufficient */
    isLink?: boolean;
    linkConfig?: {
        routePattern: string;
        displayText?: Template;
    };
};
/**
 * Formats entity attributes for list/table display.
 *
 * Transforms schema attributes into table column configurations with:
 * - Auto-generated filter configurations for filterable columns
 * - Relation display configurations with links and modal support
 * - Template-based rendering for duplicated relation fields
 * - Proper field types and visibility handling
 *
 * This is the main entry point for generating table column configurations from entity schemas.
 *
 * @param entityName - Name of the entity (for generating route patterns)
 * @param properties - Array of entity attributes from schema
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Array of formatted column configurations for table display
 *
 * @example
 * ```typescript
 * const columns = formatEntityAttributesForList(
 *   'game',
 *   gameSchema.attributes,
 *   gameService,
 *   globalConfig
 * );
 * // Returns array of column configs with filters, relations, and templates
 * ```
 */
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
/**
 * Merges default buttons with custom buttons using ID-based override logic.
 *
 * Custom buttons with matching IDs override defaults, and new custom buttons are appended.
 * Buttons without IDs are always included (no deduplication).
 *
 * @template T - Button type with optional id property
 * @param defaults - Default button configurations
 * @param customs - Custom button configurations to merge
 * @returns Merged array with custom overrides applied
 *
 * @example
 * ```typescript
 * const defaults = [
 *   { id: 'save', label: 'Save', action: 'submit' },
 *   { id: 'cancel', label: 'Cancel', action: 'cancel' }
 * ];
 * const customs = [
 *   { id: 'save', label: 'Save Changes', action: 'submit' }, // Override
 *   { id: 'delete', label: 'Delete', action: 'delete' }      // New
 * ];
 * const merged = mergeButtons(defaults, customs);
 * // Returns: [
 * //   { id: 'save', label: 'Save Changes', action: 'submit' },
 * //   { id: 'cancel', label: 'Cancel', action: 'cancel' },
 * //   { id: 'delete', label: 'Delete', action: 'delete' }
 * // ]
 * ```
 */
export declare function mergeButtons<T extends {
    id?: string;
}>(defaults: Array<T>, customs?: ReadonlyArray<T> | Array<T>): Array<T>;
/**
 * Merges default actions with custom actions using ID-based override logic.
 *
 * Delegates to mergeButtons with the same behavior: custom actions with matching IDs
 * override defaults, and new custom actions are appended. Semantically named for row/table actions.
 *
 * @template T - Action type with optional id property
 * @param defaults - Default action configurations
 * @param customs - Custom action configurations to merge
 * @returns Merged array with custom overrides applied
 *
 * @example
 * ```typescript
 * const defaults = [
 *   { id: 'edit', label: 'Edit', action: 'edit' },
 *   { id: 'delete', label: 'Delete', action: 'delete' }
 * ];
 * const customs = [
 *   { id: 'delete', label: 'Remove', action: 'delete', confirm: true } // Override
 * ];
 * const merged = mergeActions(defaults, customs);
 * // Returns: [
 * //   { id: 'edit', label: 'Edit', action: 'edit' },
 * //   { id: 'delete', label: 'Remove', action: 'delete', confirm: true }
 * // ]
 * ```
 */
export declare function mergeActions<T extends {
    id?: string;
}>(defaults: Array<T>, customs?: ReadonlyArray<T> | Array<T>): Array<T>;
/**
 * Groups page header actions into primary (top-level buttons) and secondary (inside a "More" dropdown).
 * When autoGroup is false, returns all actions as a flat array (no grouping).
 *
 * Guarantees at least one visible top-level action: if primaryActions is empty,
 * the first secondary action is promoted to top-level instead of being buried in "More".
 */
export declare function groupPageHeaderActions(primaryActions: Array<IEntityPageAction>, secondaryActions: Array<IEntityPageAction>, autoGroup: boolean): Array<IEntityPageAction>;
/**
 * Merges default filter segments with custom segments using ID-based override logic.
 *
 * Follows the same pattern as mergeButtons/mergeActions: custom segments with matching IDs
 * override defaults, and new custom segments are appended.
 *
 * @param defaults - Default segment configurations
 * @param customs - Custom segment configurations to merge
 * @returns Merged array with custom overrides applied
 *
 * @example
 * ```typescript
 * const defaults = [
 *   { id: 'active', label: 'Active', filters: { status: { eq: 'active' } } },
 *   { id: 'inactive', label: 'Inactive', filters: { status: { eq: 'inactive' } } }
 * ];
 * const customs = [
 *   { id: 'archived', label: 'Archived', filters: { archived: { eq: true } } }
 * ];
 * const result = mergeSegments(defaults, customs);
 * // Returns: [active, inactive, archived]
 * ```
 */
export declare function mergeSegments<T extends {
    id: string;
}>(defaults: Array<T>, customs?: ReadonlyArray<T> | Array<T>): Array<T>;
/**
 * Merges field-level visibility, enablement, help text, and placeholder overrides into base properties.
 *
 * Applies custom field configurations from form/detail config to base schema properties.
 * Only merges overrides for fields that exist in base properties (warns about non-existent fields).
 *
 * @template T - Property type with required name field
 * @param baseProperties - Base field properties from entity schema
 * @param fieldOverrides - Custom field overrides from form/detail configuration
 * @returns Base properties with overrides merged in
 *
 * @example
 * ```typescript
 * const baseProps = [
 *   { name: 'email', type: 'string', required: true },
 *   { name: 'bio', type: 'string', required: false }
 * ];
 * const overrides = [
 *   { name: 'email', helpText: 'Enter a valid email address' },
 *   { name: 'bio', visibility: { create: false } }
 * ];
 * const merged = mergeFieldVisibility(baseProps, overrides);
 * // Returns baseProps with helpText and visibility merged
 * ```
 */
export declare function mergeFieldVisibility<T extends {
    name: string;
}>(baseProperties: Array<T>, fieldOverrides?: ReadonlyArray<{
    readonly name: string;
    readonly [key: string]: unknown;
}> | Array<{
    name: string;
    [key: string]: unknown;
}>): Array<T>;
/**
 * Merges column visibility configuration with base properties.
 * Controls which columns are visible by default and their display order.
 *
 * **Supports:**
 * - Schema fields (from base properties)
 * - JSON paths (e.g., 'user.email', 'metadata.score')
 * - Custom/computed columns (not in schema, provided by API or frontend)
 *
 * @template T - Base property type with name and dataIndex
 * @param baseProperties - Base properties from entity schema
 * @param columnOverrides - Column configuration overrides (string or object format)
 * @returns Merged properties with visibility and order applied, including custom columns
 */
export declare function mergeColumnVisibility<T extends {
    name: string;
    dataIndex?: string;
}>(baseProperties: Array<T>, columnOverrides?: ITableColumns): Array<T>;
