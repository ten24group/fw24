import type { EntityConfiguration, Schema, EntityIdentifiers, CreateEntityItem, UpdateEntityItem, EntityItem, Attribute, ResponseItem, UpsertItem } from "electrodb";
import { Entity } from "electrodb";
import type { EntityQuery, FilterOperatorsExtended } from './query-types';
import type { BaseEntityService } from "./base-service";
import type { OmitNever, Paths, Writable } from "../utils/types";
import { SearchIndexConfig } from '../search/types';
import { EntitySearchService } from '../search/services';
import { DepIdentifier } from "../interfaces";
import type { FormPageConfigStructure, ListPageConfigStructure, DetailsPageConfigStructure } from '../ui-config-gen/templates/custom-page';
/**
 * @fileoverview Entity Schema and Type-Safe Helper Functions
 *
 * This module provides essential type-safe helpers for defining entity schemas,
 * relations, queries, and configurations with full TypeScript support.
 *
 * ## Core Type-Safe Helper Functions
 *
 * ### Essential Helpers (4 functions)
 *
 * 1. **`createEntityRelation<E>()`** - Define entity relations with circular dependency support
 *    - Direct: `createEntityRelation<TeamSchema>({ ... })`
 *    - Lazy: `createEntityRelation<() => PostSchema>({ ... })`
 *
 * 2. **`createEntityQuery<E>()`** - Build type-safe queries with filters, pagination, and hydration
 *
 * 3. **`createHydrateOptions<E>()`** - Specify which attributes and relations to load
 *
 * 4. **`createFieldOptions<E>()`** - Configure API-loaded options for select/radio/checkbox fields
 *
 * ### Core Schema Functions
 * - `createEntitySchema<...>()` - Define entity schemas with ElectroDB
 * - `createElectroDBEntity<S>()` - Create ElectroDB entity instances
 *
 * ## Usage Examples
 *
 * ### Simple Relation
 * ```ts
 * teamId: {
 *   type: 'string',
 *   relation: createEntityRelation<TeamSchema>({
 *     entityName: 'team',
 *     type: 'many-to-one',
 *     identifiers: { source: 'teamId', target: 'teamId' }
 *   })
 * }
 * ```
 *
 * ### Circular Dependency Relation
 * ```ts
 * userId: {
 *   type: 'string',
 *   relation: createEntityRelation<() => UserSchema>({
 *     entityName: 'user',
 *     type: 'many-to-one',
 *     identifiers: () => ({ source: 'userId', target: 'userId' })
 *   })
 * }
 * ```
 *
 * ### Query with Hydration
 * ```ts
 * const query = createEntityQuery<GameSchema>({
 *   filters: { status: { eq: 'upcoming' } },
 *   attributes: createHydrateOptions<GameSchema>({
 *     gameId: true,
 *     homeTeam: { attributes: { teamId: true, teamName: true } }
 *   })
 * })
 * ```
 *
 * ### Field Options
 * ```ts
 * // Static options - use array directly
 * options: [
 *   { value: 'active', label: 'Active' },
 *   { value: 'inactive', label: 'Inactive' }
 * ]
 *
 * // API-loaded options - use helper
 * options: createFieldOptions<TeamSchema>({
 *   apiMethod: 'GET',
 *   apiUrl: '/api/teams',
 *   responseKey: 'data',
 *   optionMapping: { label: 'teamName', value: 'teamId' }
 * })
 * ```
 *
 * ### Entity Operations
 *
 * ```ts
 * // Full set (default) - All CRUD operations
 * entityOperations: DefaultEntityOperations
 *
 * // Superset - Add custom operations (e.g., publish/approve workflows)
 * const ArticleOps = {
 *   ...DefaultEntityOperations,
 *   publish: 'publish',
 *   unpublish: 'unpublish',
 *   archive: 'archive'
 * } as const;
 * entityOperations: ArticleOps
 * ```
 *
 * ## Type Utilities
 *
 * Additional type utilities for advanced use cases:
 * - `AttributesTemplate<E>` - Type-safe attribute composition
 * - `VisibleAttributeKeys<E>` - Extract visible attribute names
 * - `WritableAttributeKeys<E>` - Extract writable attribute names
 * - `AttributeValueType<E, K>` - Get value type for an attribute
 * - `EntityAttributeValueMap<E>` - Map of all attributes to value types
 *
 * ## Resources
 *
 * - https://github.com/nljms/ssia/blob/main/packages/database/storages/PlayerStorage.ts
 * - https://github.com/tywalch/electro-demo/blob/main/netlify/functions/share/ratelimit.ts
 * - https://gist.github.com/tywalch/8040087e0fc886ca5f742aa99b623e1b
 * - https://medium.com/developing-koan/modeling-graph-relationships-in-dynamodb-c06141612a70
 * - https://gist.github.com/severi/5d181a3e779f41a5e5fce1b7dcd17a89
 * - https://github.com/ikushlianski/family-car-booking-backend/blob/main/services/core/booking/booking.repository.ts
 */
/**
 * Represents the options for hydrating an entity.
 * It can be a string representing the entity name,
 * or an object with additional attributes and hydrate options.
*/
export type RelationalAttributes<T extends EntitySchema<any, any, any, any>> = OmitNever<{
    [K in keyof T['attributes']]: T['attributes'][K]['hidden'] extends true ? never : PickRelation<T, K> extends never ? never : PickRelation<T, K>;
}>;
export type NonRelationalAttributes<T extends EntitySchema<any, any, any, any>> = OmitNever<{
    [K in keyof T['attributes']]: T['attributes'][K]['hidden'] extends true ? never : PickRelation<T, K> extends never ? T['attributes'][K] : never;
}>;
export type PickRelation<E extends EntitySchema<any, any, any, any>, A extends keyof E['attributes']> = E['attributes'][A]['relation'] extends Relation<infer R> ? Relation<R> : never;
type _EntityAttributePaths<E extends EntitySchema<any, any, any, any>> = {
    [K in keyof NonRelationalAttributes<E>]?: K;
} & {
    [K in keyof RelationalAttributes<E>]?: _EntityAttributePaths<RelToRelatedEntity<RelationalAttributes<E>[K]>>;
};
export type EntityAttributePaths<E extends EntitySchema<any, any, any, any>> = Paths<_EntityAttributePaths<E>>;
export type HydrateOptionsMapForEntity<T extends EntitySchema<any, any, any, any>> = {
    [K in keyof NonRelationalAttributes<T>]?: boolean;
} & {
    [K in keyof RelationalAttributes<T>]?: boolean | HydrateOptionForRelation<RelationalAttributes<T>[K]>;
};
export type HydrateOptionForEntity<E extends EntitySchema<any, any, any, any>> = HydrateOptionsMapForEntity<E> | Array<EntityAttributePaths<E>>;
export type HydrateOptionForRelation<Rel extends Relation<any> = any> = {
    entityName?: Rel['entityName'];
    relationType?: Rel['type'];
    identifiers?: RelationIdentifiers<RelToRelatedEntity<Rel>>;
    attributes: HydrateOptionForEntity<RelToRelatedEntity<Rel>>;
};
/**
 * Creates type-safe hydrate options for entity queries.
 * Use this to specify which attributes (including relations) to load when querying entities.
 *
 * @template E - The entity schema type
 * @param options - The hydrate options (map or array of attribute paths)
 * @returns The typed hydrate options
 *
 * @example
 * // Using attribute map
 * createHydrateOptions<UserSchema>({
 *   userId: true,
 *   name: true,
 *   email: true,
 *   posts: true // hydrate relation
 * })
 *
 * @example
 * // Using array of paths
 * createHydrateOptions<UserSchema>([
 *   'userId',
 *   'name',
 *   'email',
 *   'posts.title',
 *   'posts.content'
 * ])
 *
 * @example
 * // With nested relation hydration
 * createHydrateOptions<UserSchema>({
 *   userId: true,
 *   name: true,
 *   posts: {
 *     attributes: {
 *       postId: true,
 *       title: true,
 *       comments: true
 *     }
 *   }
 * })
 */
export declare function createHydrateOptions<E extends EntitySchema<any, any, any, any>>(options: HydrateOptionForEntity<E>): HydrateOptionForEntity<E>;
/**
 * Creates a type-safe entity query with proper type inference for all query parameters.
 * Ensures that filters, attributes, and search parameters are valid for the given entity schema.
 *
 * @template E - The entity schema type
 * @param query - The entity query configuration
 * @returns The typed entity query
 *
 * @example
 * // Simple query with filters
 * createEntityQuery<UserSchema>({
 *   filters: {
 *     status: { eq: 'active' },
 *     age: { gte: 18 }
 *   },
 *   attributes: ['userId', 'name', 'email']
 * })
 *
 * @example
 * // Query with pagination and search
 * createEntityQuery<UserSchema>({
 *   search: 'john',
 *   searchAttributes: ['name', 'email'],
 *   attributes: createHydrateOptions<UserSchema>({
 *     userId: true,
 *     name: true,
 *     email: true
 *   }),
 *   pagination: {
 *     count: 20,
 *     order: 'asc',
 *     cursor: null
 *   }
 * })
 *
 * @example
 * // Query with relation hydration
 * createEntityQuery<GameSchema>({
 *   filters: {
 *     status: { eq: 'upcoming' }
 *   },
 *   attributes: createHydrateOptions<GameSchema>({
 *     gameId: true,
 *     gameDate: true,
 *     homeTeam: {
 *       attributes: {
 *         teamId: true,
 *         teamName: true,
 *         logo: true
 *       }
 *     },
 *     awayTeam: {
 *       attributes: {
 *         teamId: true,
 *         teamName: true,
 *         logo: true
 *       }
 *     }
 *   }),
 *   pagination: { count: 10 }
 * })
 */
export declare function createEntityQuery<E extends EntitySchema<any, any, any>>(query: EntityQuery<E>): EntityQuery<E>;
/**
 * Utility type to extract only visible (non-hidden) attribute keys from an entity schema
 */
export type VisibleAttributeKeys<E extends EntitySchema<any, any, any, any>> = {
    [K in keyof E['attributes']]: E['attributes'][K]['hidden'] extends true ? never : K;
}[keyof E['attributes']];
/**
 * Utility type to extract only writable (non-readonly) attribute keys from an entity schema
 */
export type WritableAttributeKeys<E extends EntitySchema<any, any, any, any>> = {
    [K in keyof E['attributes']]: E['attributes'][K]['readOnly'] extends true ? never : K;
}[keyof E['attributes']];
/**
 * Represents an identifier mapping between source and target entity attributes.
 * The target is constrained to valid attribute keys of the target entity.
 */
export type RelationIdentifier<E extends EntitySchema<any, any, any, any> = any> = {
    source: string;
    target: keyof E['attributes'];
};
export type RelationIdentifiers<E extends EntitySchema<any, any, any, any> = any> = RelationIdentifier<E> | Array<RelationIdentifier<E>>;
/**
 * Helper type to resolve entity schema from either direct type or lazy function
 */
export type ResolveEntitySchema<T> = T extends () => infer E ? E extends EntitySchema<any, any, any, any> ? E : never : T extends EntitySchema<any, any, any, any> ? T : never;
/**
 * Creates an entity relation with full type safety and circular dependency support.
 * This is the primary helper for defining entity relations.
 *
 * @template T - The entity schema type (direct or lazy-loaded via function)
 * @param relation - The relation configuration
 * @returns The typed relation
 *
 * @example
 * // Simple relation (no circular dependency)
 * createEntityRelation<TeamSchema>({
 *   entityName: 'team',
 *   type: 'many-to-one',
 *   identifiers: { source: 'teamId', target: 'teamId' }
 * })
 *
 * @example
 * // Multiple identifiers
 * createEntityRelation<TeamSchema>({
 *   entityName: 'team',
 *   type: 'many-to-one',
 *   identifiers: [
 *     { source: 'teamId', target: 'teamId' },
 *     { source: 'tenantId', target: 'tenantId' }
 *   ]
 * })
 *
 * @example
 * // Circular dependency - use lazy loading with arrow function
 * createEntityRelation<() => PostSchema>({
 *   entityName: 'post',
 *   type: 'one-to-many',
 *   identifiers: () => ({ source: 'userId', target: 'userId' })
 * })
 *
 * @example
 * // With hydration options
 * createEntityRelation<TeamSchema>({
 *   entityName: 'team',
 *   type: 'many-to-one',
 *   identifiers: { source: 'teamId', target: 'teamId' },
 *   hydrate: true,
 *   attributes: { teamId: true, teamName: true, logo: true }
 * })
 */
export declare function createEntityRelation<T extends EntitySchema<any, any, any, any> | (() => EntitySchema<any, any, any, any>)>(relation: Relation<ResolveEntitySchema<T>>): Relation<ResolveEntitySchema<T>>;
export type RelToRelatedEntity<Rel> = Rel extends Relation<infer E> ? E : never;
/**
 * Represents a relation between entities.
 * Supports lazy-loaded entity schemas to avoid circular dependency issues.
 *
 * @template E - The type of the related entity schema.
 */
export type Relation<E extends EntitySchema<any, any, any, any> = any> = {
    /**
     * Represents a relation between entities.
     */
    entityName: E['model']['entity'];
    /**
     * The type of the relation.
     * Possible values: 'one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'.
     */
    type: 'one-to-many' | 'many-to-one';
    /**
     * Identifiers to load the related entity.
     * These are mappings between source entity attributes and related entity attributes.
     * The keys for source entities can support paths like 'att1.nestedKey1'.
     * The values can be a string representing the related entity attribute or an array of strings.
     * Can be provided directly or via a function to handle circular dependencies.
     */
    identifiers: RelationIdentifiers<E> | (() => RelationIdentifiers<E>);
    hydrate?: boolean;
    /**
     * Attributes to load when hydrating this relation and Options for hydrating the relational attributes of this relation.
     * Can be provided directly or via a function to handle circular dependencies in complex relation chains.
     */
    attributes?: HydrateOptionForEntity<E> | (() => HydrateOptionForEntity<E>);
};
/**
 * Represents an entity attribute.
 */
export type EntityAttribute = Attribute & {
    /**
     * The human readable name of the attribute.
     */
    name?: string;
    /**
     * Indicates whether the attribute is an identifier.
     */
    isIdentifier?: boolean;
    /**
     * Indicates whether the attribute is unique (for unique constraints).
     */
    isUnique?: boolean;
    /**
     * Defines a relation with another entity.
     * Use the type-helper `createEntityRelation<EntitySchema>()` function for type-safe relation creation.
     * For circular dependencies, use `createEntityRelation<() => EntitySchema>()` with lazy loading.
     */
    relation?: Relation<any>;
    /**
     * Validations for the attribute.
     */
    validations?: any[];
} & FieldMetadata;
export type FieldMetadata = TextFieldMetadata | NumberFieldMetadata | DateFieldMetadata | TimeFieldMetadata | DateTimeFieldMetadata | BooleanFieldMetadata | SelectFieldMetadata | RadioFieldMetadata | CheckboxFieldMetadata | FileFieldMetadata | RangeFieldMetadata | ColorFieldMetadata | ImageFieldMetadata | HiddenFieldMetadata | CustomFieldMetadata | RatingFieldMetadata | EditorFieldMetadata | CodeEditorFieldMetadata;
export interface BaseFieldMetadata {
    isVisible?: boolean;
    isListable?: boolean;
    isCreatable?: boolean;
    isEditable?: boolean;
    isFilterable?: boolean;
    isSearchable?: boolean;
    isSortable?: boolean;
    placeholder?: string;
    helpText?: string;
    tooltip?: string;
    filterConfig?: {
        filterType?: 'text' | 'select' | 'datetime' | 'number' | 'boolean';
        defaultOperator?: FilterOperatorsExtended<any>;
        availableOperators?: FilterOperatorsExtended<any>[];
        predefinedOptions?: Array<{
            label: string;
            value: string;
        }>;
    };
    isLink?: boolean;
    linkConfig?: {
        routePattern: string;
        displayText?: string;
    };
}
/**
 * Modal type for actions
 */
export type ModalType = "confirm" | "list" | "form" | "accordion" | "custom" | "details" | "dashboard";
/**
 * API method type - must match frontend IApiConfig
 */
export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
/**
 * Confirm modal configuration
 */
export interface IConfirmModal {
    title: string;
    content?: string;
}
/**
 * API configuration for modal actions
 */
export interface IModalApiConfig {
    apiMethod: ApiMethod;
    responseKey?: string;
    apiUrl: string;
}
/**
 * Modal configuration for entity page actions
 * Note: This is a subset of the frontend IModalConfig, excluding runtime props
 */
/**
 * Navigation configuration for modal form submissions
 * Allows collecting user input and navigating to a route without API calls
 */
export interface INavigateToConfig {
    /** Target route pattern, e.g., "/list-game" or "/view-user/:userId" */
    routePattern: string;
    /** Whether to use form values for route/query params. Default: true */
    useFormValues?: boolean;
    /** Maps form field paths to query parameters.
     * Example: { "status.eq": "statusFilter", "teamIds.in": "selectedTeams" }
     */
    queryParamMapping?: Record<string, string>;
    /** Maps form field paths to route parameters.
     * Example: { userId: "selectedUser.id" }
     */
    routeParamMapping?: Record<string, string>;
    /** Use sessionStorage for large parameter sets (>1500 chars). Default: false */
    useLargeParamStorage?: boolean;
    /** Date format for date fields. Default: 'ISO' */
    dateFormat?: 'ISO' | 'unix' | 'YYYY-MM-DD';
    /** Array field to extract (e.g., 'id' extracts IDs from object arrays). Default: auto-detect */
    arrayValuePath?: string;
    /** Use replace instead of push in navigation history. Default: false */
    replace?: boolean;
    /** Pre-populate form from query params on modal open. Default: false */
    inverseMapping?: boolean;
}
/**
 * Configuration for displaying API response in a modal
 * Reuses the existing page rendering system (details, list, dashboard, etc.)
 *
 * Use Cases:
 * - Bulk operations: Show results breakdown (created/updated/failed counts)
 * - Report generation: Show summary with download links
 * - Test/validation: Show operation results, warnings, API responses
 */
export interface IResponseDisplayConfig {
    /** Whether to show response in a modal. If false, only toast notification shows. Default: false */
    showModal?: boolean;
    /** Title for response modal. If not provided, appends " - Results" to action modal title */
    modalTitle?: string;
    /** Width of response modal in pixels. Default: 800 */
    modalWidth?: number;
    /** OPTION 1: Render response using existing page type system (recommended) */
    pageType?: 'details' | 'list' | 'dashboard' | 'accordion';
    pageConfig?: DetailsPageConfigStructure | ListPageConfigStructure | Record<string, any>;
    /** OPTION 2: Show raw JSON response (useful for debugging/testing) */
    showRawJson?: boolean;
    /** Path to extract data from response. Default: uses response root
     * Example: "data.results" will use response.data.results as the data source
     */
    dataPath?: string;
}
export interface IEntityPageActionModalConfig {
    modalType: ModalType;
    modalPageConfig?: IConfirmModal | FormPageConfigStructure | ListPageConfigStructure | DetailsPageConfigStructure;
    /** EITHER: Make API call (existing pattern) */
    apiConfig?: IModalApiConfig;
    submitSuccessRedirect?: string;
    /** OR: Navigate without API call (new pattern) */
    navigateTo?: INavigateToConfig | string;
    /** OPTIONAL: Display API response in a modal (instead of just toast notification)
     * Note: Only applies when apiConfig is present. Ignored for navigateTo.
     */
    responseConfig?: IResponseDisplayConfig;
}
/**
 * Entity page action
 * Supports buttons, dropdowns with modals/navigation
 *
 * Patterns:
 * 1. Navigation: { url: "/view-user/:id" }
 * 2. Modal with inline config: { openInModal: true, modalConfig: {...} }
 * 3. Modal with route resolution: { openInModal: true, url: "/view-user/:id" }
 *
 * Note: items cannot have nested items (max 1 level of nesting)
 */
export interface IEntityPageAction {
    label: string;
    url?: string;
    icon?: string;
    type?: 'button' | 'dropdown';
    items?: Array<Omit<IEntityPageAction, 'items'>>;
    /** Open action in modal instead of navigating */
    openInModal?: boolean;
    /** Modal configuration (inline config or resolved from url) */
    modalConfig?: IEntityPageActionModalConfig;
    /** Custom modal width. Default: auto-detect from page type */
    modalWidth?: number | string;
    /** Override resolved page title when opened in modal */
    modalTitle?: string;
    /** Hide this action when rendered inside a modal. Default: false */
    hideInModal?: boolean;
    /** Only open in modal on specified screen size. Default: always */
    openInModalCondition?: 'sm' | 'md' | 'lg' | 'xl';
}
export interface IEntityPageColumn {
    sortOrder: number;
    fields: string[];
}
export interface IEntityPageColumnConfig {
    numColumns?: number;
    columns: IEntityPageColumn[];
}
interface TextFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'text' | 'textarea' | 'password' | 'email';
    maxLength?: number;
    mask?: string;
}
interface NumberFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'number';
    min?: number;
    max?: number;
    step?: number;
}
interface DateFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'date';
    minDate?: Date;
    maxDate?: Date;
    dateFormat?: string;
}
interface TimeFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'time';
    minTime?: string;
    maxTime?: string;
    timeFormat?: string;
}
interface DateTimeFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'datetime';
    minDateTime?: Date;
    maxDateTime?: Date;
    dateTimeFormat?: string;
}
interface ColorFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'color';
    defaultColor?: string;
}
interface BooleanFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'boolean' | 'switch' | 'toggle';
    trueLabel?: string;
    falseLabel?: string;
}
export interface SelectFieldMetadata<E extends EntitySchema<any, any, any> = any> extends BaseFieldMetadata {
    fieldType?: 'select' | 'multi-select' | 'autocomplete';
    options: FieldOptions<E>;
    maxSelections?: number;
    addNewOption?: {
        entityName: string;
    };
}
export declare function isSelectFieldMetadata(obj: any): obj is SelectFieldMetadata;
export declare function isImageFieldMetadata(obj: any): obj is ImageFieldMetadata;
export declare function isFileFieldMetadata(obj: any): obj is FileFieldMetadata;
export declare function isDateFieldMetadata(obj: any): obj is DateFieldMetadata;
export declare function isDateTimeFieldMetadata(obj: any): obj is DateTimeFieldMetadata;
export declare function isNumberFieldMetadata(obj: any): obj is NumberFieldMetadata;
export declare function isBooleanFieldMetadata(obj: any): obj is BooleanFieldMetadata;
export declare function isEditorFieldMetadata(obj: any): obj is EditorFieldMetadata;
export declare function isCodeEditorFieldMetadata(obj: any): obj is CodeEditorFieldMetadata;
interface RadioFieldMetadata<E extends EntitySchema<any, any, any> = any> extends BaseFieldMetadata {
    fieldType?: 'radio';
    options: FieldOptions<E>;
    layout?: 'horizontal' | 'vertical';
}
interface CheckboxFieldMetadata<E extends EntitySchema<any, any, any> = any> extends BaseFieldMetadata {
    fieldType?: 'checkbox';
    options: FieldOptions<E>;
    layout?: 'horizontal' | 'vertical';
}
interface CommonFileFieldMetadata {
    accept?: string;
    maxFileSize?: number;
    fileNamePrefix?: string;
    getSignedUploadUrlAPIConfig?: GetSignedUploadUrlAPIConfig;
}
export interface FileFieldMetadata extends BaseFieldMetadata, CommonFileFieldMetadata {
    fieldType?: 'file';
}
export interface ImageFieldMetadata extends BaseFieldMetadata, CommonFileFieldMetadata {
    fieldType?: 'image';
    aspectRatio?: string;
    withImageCrop?: boolean;
    accept?: "image/*" | "image/png" | "image/jpeg" | "image/gif" | "image/bmp" | "image/webp";
}
interface RangeFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'range';
    min?: number;
    max?: number;
    step?: number;
    showValue?: boolean;
}
export type GetSignedUploadUrlAPIConfig = {
    apiUrl: string;
    apiMethod: 'GET' | 'POST';
};
interface HiddenFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'hidden';
}
interface CustomFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'custom';
}
interface RatingFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'rating';
    maxRating?: number;
}
interface EditorFieldMetadata extends BaseFieldMetadata, CommonFileFieldMetadata {
    fieldType?: 'rich-text' | 'wysiwyg';
}
interface CodeEditorFieldMetadata extends BaseFieldMetadata {
    fieldType?: 'code' | 'markdown' | 'json';
}
export type FieldOptions<E extends EntitySchema<any, any, any> = any> = Array<FieldOption> | FieldOptionsAPIConfig<E>;
export type FieldOption = {
    value: string;
    label: string;
};
/**
 * Represents the template for attributes.
 * Allows composing multiple attributes into a formatted string.
 * Provides type-safe attribute name validation via generics.
 *
 * @template E - The entity schema type
 *
 * @example
 * ```ts
 * // Define directly in field options config
 * const template: AttributesTemplate<UserSchema> = {
 *   composite: ['firstName', 'lastName'],
 *   template: '{firstName}-AND-{lastName}'
 * }
 * ```
 */
export type AttributesTemplate<E extends EntitySchema<any, any, any> = any> = {
    composite: Array<keyof E['attributes'] & string>;
    template: string;
};
/**
 * Configuration for loading field options from an API endpoint.
 * Provides type-safe attribute references for the given entity schema.
 *
 * @template E - The entity schema type for type-safe attribute references
 */
export type FieldOptionsAPIConfig<E extends EntitySchema<any, any, any>> = {
    apiMethod: 'GET' | 'POST';
    apiUrl: string;
    responseKey: string;
    query?: EntityQuery<E>;
    optionMapping?: {
        label: (keyof E['attributes'] & string) | AttributesTemplate<E>;
        value: (keyof E['attributes'] & string) | AttributesTemplate<E>;
    };
};
/**
 * Creates type-safe field options configuration for API-loaded select/radio/checkbox options.
 * Provides full type safety for attribute references in option mappings and query filters.
 *
 * @template E - The entity schema type for the options source
 * @param config - The field options API configuration
 * @returns The typed field options API config
 *
 * @example
 * // Simple attribute mapping
 * createFieldOptions<UserSchema>({
 *   apiMethod: 'GET',
 *   apiUrl: '/api/users',
 *   responseKey: 'data',
 *   optionMapping: {
 *     label: 'name',
 *     value: 'userId'
 *   }
 * })
 *
 * @example
 * // With query filters
 * createFieldOptions<TeamSchema>({
 *   apiMethod: 'GET',
 *   apiUrl: '/api/teams',
 *   responseKey: 'teams',
 *   query: { filters: { status: { eq: 'active' } } },
 *   optionMapping: {
 *     label: 'teamName',
 *     value: 'teamId'
 *   }
 * })
 *
 * @example
 * // With attribute template for composed labels
 * createFieldOptions<TeamSchema>({
 *   apiMethod: 'GET',
 *   apiUrl: '/api/teams',
 *   responseKey: 'teams',
 *   optionMapping: {
 *     label: {
 *       composite: ['teamName', 'city'],
 *       template: '{teamName} ({city})'
 *     },
 *     value: 'teamId'
 *   }
 * })
 */
export declare function createFieldOptions<E extends EntitySchema<any, any, any>>(config: FieldOptionsAPIConfig<E>): FieldOptionsAPIConfig<E>;
export declare const SpecialAttributeTypes: {
    name: string;
    slug: string;
    color: string;
    image: string;
    description: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string;
};
export type SpecialAttributeType = keyof typeof SpecialAttributeTypes;
/**
 * Represents the schema for an entity.
 *
 * @template A - Attribute names
 * @template F - Facet names
 * @template C - Collection names
 * @template Opp - The type of entity operations.
 */
export interface EntitySchema<A extends string, F extends string, C extends string, Opp extends TDefaultEntityOperations = TDefaultEntityOperations> extends Schema<A, F, C> {
    readonly model: Schema<A, F, C>['model'] & {
        readonly entityNamePlural: string;
        readonly entityOperations: Opp;
        readonly entityMenuIcon?: string;
        readonly entityNameAttribute?: string;
        readonly entitySlugAttribute?: string;
        readonly entityImageAttribute?: string;
        readonly entityDescriptionAttribute?: string;
        readonly excludeFromAdminMenu?: boolean;
        readonly excludeFromAdminList?: boolean;
        readonly excludeFromAdminDetail?: boolean;
        readonly excludeFromAdminCreate?: boolean;
        readonly excludeFromAdminUpdate?: boolean;
        readonly excludeFromAdminDelete?: boolean;
        readonly excludeFromAdminDuplicate?: boolean;
        readonly CRUDApiPath?: string;
        readonly menuGroup?: string;
        readonly menuOrder?: number;
        readonly createPageBreadcrumbs?: Array<{
            label: string;
            url?: string;
        }>;
        readonly createPageColumnsConfig?: IEntityPageColumnConfig;
        readonly listPageActions?: IEntityPageAction[];
        readonly listPageBreadcrumbs?: Array<{
            label: string;
            url?: string;
        }>;
        readonly listPageDefaultSort?: {
            field: string;
            order: 'asc' | 'desc';
        } | Array<{
            field: string;
            order: 'asc' | 'desc';
        }> | string;
        readonly viewPageActions?: IEntityPageAction[];
        readonly viewPageBreadcrumbs?: Array<{
            label: string;
            url?: string;
        }>;
        readonly viewPageColumnsConfig?: IEntityPageColumnConfig;
        readonly editPageActions?: IEntityPageAction[];
        readonly editPageBreadcrumbs?: Array<{
            label: string;
            url?: string;
        }>;
        readonly editPageColumnsConfig?: IEntityPageColumnConfig;
        readonly search?: {
            enabled: boolean;
            indexConfig?: SearchIndexConfig;
            serviceClass?: DepIdentifier<EntitySearchService<any>> | typeof EntitySearchService | EntitySearchService<any>;
            documentTransformer?: (entity: EntityRecordTypeFromSchema<EntitySchema<A, F, C>>) => Promise<Record<string, any>>;
        };
    };
    readonly attributes: {
        readonly [a in A]: EntityAttribute;
    };
}
/**
 * Default entity operations that are commonly used.
 * Use this as a base or define your own subset/superset.
 */
export declare const DefaultEntityOperations: {
    readonly get: "get";
    readonly list: "list";
    readonly query: "query";
    readonly create: "create";
    readonly upsert: "upsert";
    readonly update: "update";
    readonly delete: "delete";
    readonly duplicate: "duplicate";
};
/**
 * Type for the default entity operations.
 * Use this when you want all standard CRUD operations.
 */
export type TDefaultEntityOperations = typeof DefaultEntityOperations;
/**
 * Represents the input schemas for entity operations.
 * Provides type-safe mapping of operation names to their corresponding input types.
 * Extend this type for additional operations's input-schema types.
 *
 * @template Sch - The entity schema type.
 *
 * @example
 * ```ts
 * type UserOpsInputs = TEntityOpsInputSchemas<UserEntitySchema>;
 * // {
 * //   get: UserIdentifiers | UserIdentifiers[],
 * //   create: CreateUserItem,
 * //   update: UpdateUserItem,
 * //   ...
 * // }
 * ```
 */
export type TEntityOpsInputSchemas<Sch extends EntitySchema<any, any, any, any>> = {
    readonly [opName in keyof Sch['model']['entityOperations']]: opName extends 'get' ? EntityIdentifiersTypeFromSchema<Sch> | Array<EntityIdentifiersTypeFromSchema<Sch>> : opName extends 'list' ? never : opName extends 'query' ? never : opName extends 'create' ? CreateEntityItemTypeFromSchema<Sch> : opName extends 'upsert' ? UpsertEntityItemTypeFromSchema<Sch> : opName extends 'update' ? UpdateEntityItemTypeFromSchema<Sch> : opName extends 'delete' ? EntityIdentifiersTypeFromSchema<Sch> | Array<EntityIdentifiersTypeFromSchema<Sch>> : opName extends 'duplicate' ? EntityIdentifiersTypeFromSchema<Sch> : {};
};
export type CreateElectroDBEntityOptions<S extends EntitySchema<any, any, any>> = {
    schema: S;
    entityConfigurations: EntityConfiguration;
};
/**
 * This function is used to define an entity schema for DynamoDB based entity, and it used ElectroDB under the hood.
 * It takes an object as an argument that describes the model, attributes, and indexes of the entity.
 * the generic params are only for the type inference, and they are not used in the function.
 *
 * @param schema - The entity schema configuration.
 *
 * @example
 * import { createEntitySchema } from '@ten24Group/fw24'
 *
 * const entitySchema = createEntitySchema({
 *   // entity schema configuration
 *
 *  // metadata about the entity
 *  model: {
 *      version: '1',
 *      entity: 'user',             // the name of the entity
 *      entityNamePlural: 'Users', // used by auto generated UI
 *      entityOperations: DefaultEntityOperations, // the operations that can be performed on the entity
 *      service: 'users', // ElectroDB service name [logical group of entities]
 *  },
 * // the attributes for the entity
 *  attributes: {
 *     userId: {
 *      type: 'string',
 *      required: true,
 *      readOnly: true,
 *      default: () => randomUUID()
 *    },
 *   // ... other attributes
 *  },
 * // the access patterns for the entity
 *  indexes: {
 *      primary: {
 *          pk: {
 *              field: 'primary_pk',
 *              composite: ['userId'],
 *          },
 *          sk: {
 *              field: 'primary_sk',
 *              composite: [],
 *          }
 *      },
 *      // ... other indexes
 *  },
 * } as const );
 *
 *
 */
export declare function createEntitySchema<A extends string, F extends string, C extends string, S extends EntitySchema<A, F, C, Ops>, Ops extends TDefaultEntityOperations = TDefaultEntityOperations>(schema: S): S;
export declare function createElectroDBEntity<S extends EntitySchema<any, any, any>>(options: CreateElectroDBEntityOptions<S>): {
    name: string;
    entity: Entity<string, string, string, S>;
    schema: S;
    symbol: symbol;
};
export type EntityTypeFromSchema<TSchema> = TSchema extends EntitySchema<infer A, infer F, infer C> ? Entity<A, F, C, TSchema> : never;
export type EntityResponseItemTypeFromSchema<TSchema> = TSchema extends EntitySchema<infer A, infer F, infer C> ? ResponseItem<A, F, C, TSchema> : never;
/**
 * Utility type to extract the value type of a specific attribute from an entity schema.
 * Useful for type-safe attribute value handling.
 *
 * @template E - The entity schema
 * @template K - The attribute key
 */
export type AttributeValueType<E extends EntitySchema<any, any, any>, K extends keyof E['attributes']> = E['attributes'][K]['type'] extends 'string' ? string : E['attributes'][K]['type'] extends 'number' ? number : E['attributes'][K]['type'] extends 'boolean' ? boolean : E['attributes'][K]['type'] extends Array<infer T> ? T : E['attributes'][K]['type'] extends 'any' ? any : E['attributes'][K]['type'] extends 'set' ? Set<string> : E['attributes'][K]['type'] extends 'list' ? Array<any> : E['attributes'][K]['type'] extends 'map' ? Record<string, any> : any;
/**
 * Utility type to extract all attribute names and their value types as a key-value map.
 *
 * @template E - The entity schema
 */
export type EntityAttributeValueMap<E extends EntitySchema<any, any, any>> = {
    [K in keyof E['attributes']]: AttributeValueType<E, K>;
};
export type UpsertEntityItem<E extends Entity<any, any, any, any>> = E extends Entity<infer A, infer F, infer C, infer S> ? UpsertItem<A, F, C, S> : never;
export type EntityRecordTypeFromSchema<Sch extends EntitySchema<any, any, any>> = EntityItem<EntityTypeFromSchema<Sch>>;
export type EntityServiceTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = BaseEntityService<TSchema>;
export type EntityIdentifiersTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<EntityIdentifiers<EntityTypeFromSchema<TSchema>>>;
export type CreateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<CreateEntityItem<EntityTypeFromSchema<TSchema>>>;
export type UpsertEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<UpsertEntityItem<EntityTypeFromSchema<TSchema>>>;
export type UpdateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<UpdateEntityItem<EntityTypeFromSchema<TSchema>>>;
export {};
