import type { EntityConfiguration, Schema, EntityIdentifiers, CreateEntityItem, UpdateEntityItem, EntityItem, Attribute, ResponseItem, UpsertItem } from "electrodb";
import { createSchema, Entity } from "electrodb";

import type { EntityQuery, FilterOperatorsExtended, EntityFilterCriteria } from './query-types';
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
 * ## Architecture: Data Layer vs UI Layer
 * 
 * ### ⚠️ CRITICAL: Relations are split into two layers:
 * 
 * **1. Data Layer (`Relation<E>`)** - Define in entity attribute's `relation` property
 * - Purpose: Fetching, hydration, identifiers
 * - Properties: `entityName`, `type`, `identifiers`, `hydrate`, `attributes`
 * - When: Always required for relations
 * 
 * **2. UI Layer (`IRelationFieldConfig`)** - Optional, define in `relationConfig` property
 * - Purpose: Display, navigation, modals
 * - Properties: `routePattern`, `modalConfigRef`, `displayConfig`, etc.
 * - When: Only if you need custom UI behavior (backend auto-generates defaults)
 * 
 * ### Example:
 * ```ts
 * teamId: {
 *   type: 'string',
 *   // DATA LAYER (required)
 *   relation: createEntityRelation<TeamSchema>({
 *     entityName: 'team',
 *     type: 'many-to-one',
 *     identifiers: { source: 'teamId', target: 'teamId' }
 *   }),
 *   // UI LAYER (optional - backend auto-generates if omitted)
 *   relationConfig: {
 *     routePattern: '/custom-team/:teamId',
 *     modalWidth: 1200
 *   }
 * }
 * ```
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
  [ K in keyof T[ 'attributes' ] ]: T[ 'attributes' ][ K ][ 'hidden' ] extends true ? never
  : PickRelation<T, K> extends never ? never
  : PickRelation<T, K>;
}>

export type NonRelationalAttributes<T extends EntitySchema<any, any, any, any>> = OmitNever<{
  [ K in keyof T[ 'attributes' ] ]: T[ 'attributes' ][ K ][ 'hidden' ] extends true ? never
  : PickRelation<T, K> extends never ? T[ 'attributes' ][ K ] : never
}>

export type PickRelation<E extends EntitySchema<any, any, any, any>, A extends keyof E[ 'attributes' ]> =
  E[ 'attributes' ][ A ][ 'relation' ] extends Relation<infer R> ? Relation<R> : never;

// utility type for prepare all the paths for entity and it's relations
type _EntityAttributePaths<E extends EntitySchema<any, any, any, any>> =
  { [ K in keyof NonRelationalAttributes<E> ]?: K }
  &
  { [ K in keyof RelationalAttributes<E> ]?: _EntityAttributePaths<RelToRelatedEntity<RelationalAttributes<E>[ K ]>> }
// utility type for prepare all the paths for entity and it's relations
export type EntityAttributePaths<E extends EntitySchema<any, any, any, any>> = Paths<_EntityAttributePaths<E>>;


export type HydrateOptionsMapForEntity<T extends EntitySchema<any, any, any, any>> =
  { [ K in keyof NonRelationalAttributes<T> ]?: boolean; }
  &
  { [ K in keyof RelationalAttributes<T> ]?: boolean | HydrateOptionForRelation<RelationalAttributes<T>[ K ]> };

export type HydrateOptionForEntity<E extends EntitySchema<any, any, any, any>> = HydrateOptionsMapForEntity<E> | Array<EntityAttributePaths<E>>;

export type HydrateOptionForRelation<Rel extends Relation<any> = any> = {
  entityName?: Rel[ 'entityName' ],
  relationType?: Rel[ 'type' ],
  identifiers?: RelationIdentifiers<RelToRelatedEntity<Rel>>,
  attributes: HydrateOptionForEntity<RelToRelatedEntity<Rel>>
}

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
export function createHydrateOptions<E extends EntitySchema<any, any, any, any>>(
  options: HydrateOptionForEntity<E>
): HydrateOptionForEntity<E> {
  return options;
}

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
export function createEntityQuery<E extends EntitySchema<any, any, any>>(
  query: EntityQuery<E>
): EntityQuery<E> {
  return query;
}



/**
 * Utility type to extract only visible (non-hidden) attribute keys from an entity schema
 */
export type VisibleAttributeKeys<E extends EntitySchema<any, any, any, any>> = {
  [K in keyof E['attributes']]: E['attributes'][K]['hidden'] extends true ? never : K
}[keyof E['attributes']];

/**
 * Utility type to extract only writable (non-readonly) attribute keys from an entity schema
 */
export type WritableAttributeKeys<E extends EntitySchema<any, any, any, any>> = {
  [K in keyof E['attributes']]: E['attributes'][K]['readOnly'] extends true ? never : K
}[keyof E['attributes']];

/**
 * Represents an identifier mapping between source and target entity attributes.
 * The target is constrained to valid attribute keys of the target entity.
 */
export type RelationIdentifier<E extends EntitySchema<any, any, any, any> = any> = { 
  source: string, 
  target: keyof E[ 'attributes' ] 
};

export type RelationIdentifiers<E extends EntitySchema<any, any, any, any> = any> = RelationIdentifier<E> | Array<RelationIdentifier<E>>

/**
 * Helper type to resolve entity schema from either direct type or lazy function
 */
export type ResolveEntitySchema<T> = T extends () => infer E 
  ? E extends EntitySchema<any, any, any, any> ? E : never
  : T extends EntitySchema<any, any, any, any> ? T : never;

/**
 * Creates an entity relation with full type safety and circular dependency support.
 * This is the primary helper for defining entity relations (DATA LAYER).
 * 
 * ⚠️ IMPORTANT: This is for data layer only (identifiers, hydration, attributes).
 * For UI configuration (routes, modals), use `relationConfig` in field metadata.
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
 * // Multiple identifiers (composite key)
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
 * // With hydration (auto-load related data)
 * createEntityRelation<TeamSchema>({
 *   entityName: 'team',
 *   type: 'many-to-one',
 *   identifiers: { source: 'teamId', target: 'teamId' },
 *   hydrate: true,
 *   attributes: { teamId: true, teamName: true, logo: true }
 * })
 * 
 * @example
 * // With UI customization (use relationConfig separately)
 * teamId: {
 *   type: 'string',
 *   relation: createEntityRelation<TeamSchema>({
 *     entityName: 'team',
 *     type: 'many-to-one',
 *     identifiers: { source: 'teamId', target: 'teamId' }
 *   }),
 *   // UI config (optional - backend auto-generates if omitted)
 *   relationConfig: {
 *     routePattern: '/custom-team/:teamId',
 *     modalWidth: 1200
 *   }
 * }
 */
export function createEntityRelation<T extends EntitySchema<any, any, any, any> | (() => EntitySchema<any, any, any, any>)>(
  relation: Relation<ResolveEntitySchema<T>>
): Relation<ResolveEntitySchema<T>> {
  return relation;
}

export type RelToRelatedEntity<Rel> = Rel extends Relation<infer E> ? E : never;
/**
 * Represents a relation between entities (DATA LAYER ONLY).
 * Supports lazy-loaded entity schemas to avoid circular dependency issues.
 * 
 * ⚠️ IMPORTANT: This type is for DATA/HYDRATION concerns only!
 * For UI configuration (routes, modals, display), use `relationConfig` in field metadata.
 *
 * @template E - The type of the related entity schema.
 * 
 * @example
 * // Simple relation (data layer)
 * teamId: {
 *   type: 'string',
 *   relation: createEntityRelation<TeamSchema>({
 *     entityName: 'team',
 *     type: 'many-to-one',
 *     identifiers: { source: 'teamId', target: 'teamId' },
 *     hydrate: true,
 *     attributes: { teamId: true, teamName: true }
 *   })
 * }
 * 
 * @example
 * // With UI configuration (use relationConfig separately)
 * teamId: {
 *   type: 'string',
 *   relation: createEntityRelation<TeamSchema>({
 *     entityName: 'team',
 *     type: 'many-to-one',
 *     identifiers: { source: 'teamId', target: 'teamId' }
 *   }),
 *   // UI config goes here (optional, backend will generate defaults)
 *   relationConfig: {
 *     routePattern: '/custom-team/:teamId',
 *     modalConfigRef: {
 *       entityName: 'team',
 *       pageType: 'view',
 *       overrideConfig: { pageTitle: 'Team Details' }
 *     }
 *   }
 * }
 */
export type Relation<E extends EntitySchema<any, any, any, any> = any> = {
  /**
   * Entity name of the related entity
   */
  entityName: E[ 'model' ][ 'entity' ];

  /**
   * The type of the relation.
   * Possible values: 'one-to-many' or 'many-to-one'
   */
  type: 'one-to-many' | 'many-to-one'; // 'one-to-one' | 'many-to-many';

  /**
   * Identifiers to load the related entity.
   * Mappings between source entity attributes and target entity attributes.
   * Source keys support nested paths like 'order.userId'.
   * Can be provided directly or via a function to handle circular dependencies.
   * 
   * @example
   * // Single identifier
   * identifiers: { source: 'teamId', target: 'teamId' }
   * 
   * @example
   * // Composite key
   * identifiers: [
   *   { source: 'tenantId', target: 'tenantId' },
   *   { source: 'teamId', target: 'teamId' }
   * ]
   * 
   * @example
   * // Lazy loading (circular dependency)
   * identifiers: () => ({ source: 'userId', target: 'userId' })
   */
  identifiers: RelationIdentifiers<E> | (() => RelationIdentifiers<E>);

  /**
   * Auto-hydrate this relation when loading the parent entity.
   * Default: false
   */
  hydrate?: boolean;

  /**
   * Attributes to load when hydrating this relation.
   * Can be provided directly or via a function to handle circular dependencies.
   * 
   * @example
   * attributes: { teamId: true, teamName: true, logo: true }
   * 
   * @example
   * // Lazy loading
   * attributes: () => ({ userId: true, name: true, email: true })
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

}
  & FieldMetadata;


export type FieldMetadata = TextFieldMetadata | NumberFieldMetadata | DateFieldMetadata
  | TimeFieldMetadata | DateTimeFieldMetadata | BooleanFieldMetadata
  | SelectFieldMetadata | RadioFieldMetadata | CheckboxFieldMetadata
  | FileFieldMetadata | RangeFieldMetadata | ColorFieldMetadata
  | ImageFieldMetadata | HiddenFieldMetadata | CustomFieldMetadata
  | RatingFieldMetadata | EditorFieldMetadata | CodeEditorFieldMetadata;

/**
 * UI Metadata for entity attributes.
 * Controls how fields are displayed, filtered, and interacted with in the UI.
 */
export interface BaseFieldMetadata {
  // Visibility controls
  isVisible?: boolean; // if the field is visible or hidden on all detail-pages
  isListable?: boolean; // if the field is visible in the list view
  isCreatable?: boolean; // if the field is creatable
  isEditable?: boolean; // if the field is editable
  isFilterable?: boolean; // if the field is filterable
  isSearchable?: boolean; // if the field is searchable
  isSortable?: boolean; // if the field is sortable
  
  // Display configuration
  placeholder?: string;
  helpText?: string;
  tooltip?: string; // maybe this can be inferred from the helpText
  
  // Filter configuration options
  filterConfig?: {
    filterType?: 'text' | 'select' | 'datetime' | 'number' | 'boolean'; // Filter input type
    defaultOperator?: FilterOperatorsExtended<any>; // Default filter operator (e.g., 'contains', 'eq', 'in')
    availableOperators?: FilterOperatorsExtended<any>[]; // Restrict available operators for this column
    predefinedOptions?: Array<{ label: string; value: string }>; // For dropdown/select filters
  };
  
  // Link configuration for rendering field as internal link (non-relation fields)
  isLink?: boolean;
  linkConfig?: {
    routePattern: string;
    displayText?: string;
  };
  
  /**
   * Template for rendering column values (list pages only).
   * Supports nested paths and composite templates.
   * If provided, overrides default rendering.
   * 
   * @example
   * // Simple string template
   * template: '{firstName} {lastName}'
   * 
   * @example
   * // Complex template with nested paths
   * template: {
   *   composite: ['jerseyNumber', 'name', 'team.name'],
   *   template: '#{jerseyNumber} {name} ({team.name})'
   * }
   */
  template?: Template;
  
  /**
   * UI Configuration for relation fields (UI LAYER ONLY).
   * 
   * ⚠️ IMPORTANT: This is separate from `relation` (which is data layer).
   * 
   * Use this to customize how relation fields are displayed in detail pages:
   * - Navigation routes
   * - Modal display
   * - Icons and links
   * 
   * If not provided, the backend will auto-generate defaults from the `relation` definition.
   * Providing this allows you to override/customize the UI behavior.
   * 
   * @example
   * // Auto-generated (no relationConfig needed)
   * teamId: {
   *   type: 'string',
   *   relation: createEntityRelation<TeamSchema>({
   *     entityName: 'team',
   *     type: 'many-to-one',
   *     identifiers: { source: 'teamId', target: 'teamId' }
   *   })
   *   // Backend generates: routePattern, modalConfigRef, displayConfig
   * }
   * 
   * @example
   * // Custom UI (override defaults)
   * teamId: {
   *   type: 'string',
   *   relation: createEntityRelation<TeamSchema>({ ... }),
   *   relationConfig: {
   *     routePattern: '/teams/:teamId/details', // Custom route
   *     modalWidth: 1200, // Wider modal
   *     displayConfig: {
   *       showLink: false // Hide link, only show modal icon
   *     }
   *   }
   * }
   */
  relationConfig?: IRelationFieldConfig;
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
  /**
   * Modal title - can be static string or dynamic template.
   * 
   * @example title: "Delete Team?"
   * @example title: "Delete {teamName}?"
   * @example title: { composite: ['teamName', 'city'], template: 'Delete {teamName} ({city})?' }
   */
  title: Template;
  
  /**
   * Modal content - can be static string or dynamic template.
   * 
   * @example content: "Are you sure?"
   * @example content: "Delete {teamName}? This will affect {playerCount} players."
   * @example content: { composite: ['teamName', 'playerCount'], template: 'Delete {teamName}? This will affect {playerCount} players.' }
   */
  content?: Template;
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

/**
 * Entity Configuration Reference
 * 
 * Instead of embedding full page configurations (causing massive JSON bloat),
 * reference existing entity configs by name and apply optional overrides.
 * 
 * Benefits:
 * - Dramatically reduces JSON payload size (KB → bytes)
 * - Maintains single source of truth for entity configs
 * - Supports customization via overrideConfig
 * 
 * Example:
 * ```ts
 * addNewOptionConfig: {
 *   entityName: 'team',
 *   pageType: 'create',
 *   overrideConfig: {
 *     submitSuccessRedirect: undefined, // Stay in modal
 *     formButtons: [
 *       { text: "Add", action: "submit" },
 *       { text: "Cancel", action: "cancel" }
 *     ]
 *   }
 * }
 * ```
 */
export interface IEntityConfigReference {
  /** Entity name (e.g., 'team', 'game', 'user') */
  entityName: string;
  
  /** Which page config to reference: 'view', 'create', or 'list' */
  pageType: 'view' | 'create' | 'list';
  
  /** Optional overrides to apply to the referenced config */
  overrideConfig?: {
    /** Override page title */
    pageTitle?: string;
    
    /** Override columns configuration (for view pages) */
    columnsConfig?: IEntityPageColumnConfig;
    
    /** Override breadcrumbs */
    breadcrumbs?: Array<{ label: string; url?: string }>;
    
    /** Override form success redirect (for create pages) */
    submitSuccessRedirect?: string;
    
    /** Override form buttons (for create pages) */
    formButtons?: Array<{ text: string; action: string; url?: string }>;
    
    /** Add default filters (for list pages) */
    defaultFilters?: Record<string, any>;
    
    /** Hide specific fields from rendering */
    hideFields?: string[];
    
    /** Show only specific fields (mutually exclusive with hideFields) */
    showOnlyFields?: string[];
  };
}

/**
 * Relation Field UI Configuration (UI LAYER ONLY)
 * 
 * ⚠️ IMPORTANT: This is for UI rendering only! Works together with `Relation<E>` (data layer).
 * 
 * **Architecture:**
 * - `Relation<E>` (in entity attribute): Data layer (identifiers, hydration, attributes)
 * - `IRelationFieldConfig` (in BaseFieldMetadata): UI layer (routes, modals, display)
 * 
 * **When to use:**
 * - Usually NOT needed - backend auto-generates from `Relation<E>`
 * - Use only to override defaults or customize UI behavior
 * 
 * **Defines how relation fields are rendered in detail pages:**
 * - Navigation via link (opens route)
 * - Modal viewing (opens related entity in modal)
 * - Filtering (for to-many relations)
 * - Display options (icons, links)
 * 
 * **Display patterns:**
 * - To-One: Shows ID value with link + modal icon (e.g., "abc-123 | 🔍")
 * - To-Many: Shows count/array with modal icon only (e.g., "[3 items] | 📋")
 * 
 * @example
 * // AUTO-GENERATED (most common - no manual config needed!)
 * teamId: {
 *   type: 'string',
 *   relation: createEntityRelation<TeamSchema>({
 *     entityName: 'team',
 *     type: 'many-to-one',
 *     identifiers: { source: 'teamId', target: 'teamId' }
 *   })
 *   // Backend auto-generates:
 *   // - routePattern: '/view-team/:teamId'
 *   // - identifierMapping: [{ source: 'teamId', target: 'teamId' }]
 *   // - modalConfigRef: { entityName: 'team', pageType: 'view' }
 *   // - displayConfig: { showLink: true, showModalIcon: true }
 * }
 * 
 * @example
 * // CUSTOM OVERRIDE (to-one relation with custom UI)
 * teamId: {
 *   type: 'string',
 *   relation: createEntityRelation<TeamSchema>({
 *     entityName: 'team',
 *     type: 'many-to-one',
 *     identifiers: { source: 'teamId', target: 'teamId' }
 *   }),
 *   relationConfig: {
 *     routePattern: '/teams/:teamId/details', // Custom route
 *     modalWidth: 1200,
 *     modalConfigRef: {
 *       entityName: 'team',
 *       pageType: 'view',
 *       overrideConfig: {
 *         pageTitle: 'Team Information'
 *       }
 *     },
 *     displayConfig: {
 *       showLink: false, // Hide link, only show modal icon
 *       icon: 'TeamOutlined'
 *     }
 *   }
 * }
 * 
 * @example
 * // CUSTOM OVERRIDE (to-many relation with filters)
 * games: {
 *   type: 'list',
 *   items: { type: 'string' },
 *   relation: createEntityRelation<GameSchema>({
 *     entityName: 'game',
 *     type: 'one-to-many',
 *     identifiers: { source: 'teamId', target: 'teamId' }
 *   }),
 *   relationConfig: {
 *     routePattern: '/list-game',
 *     modalConfigRef: {
 *       entityName: 'game',
 *       pageType: 'list',
 *       overrideConfig: {
 *         defaultFilters: { teamId: ':teamId', status: 'upcoming' }
 *       }
 *     },
 *     modalWidth: '95%',
 *     displayConfig: {
 *       showModalIcon: true,
 *       icon: 'UnorderedListOutlined',
 *       showLink: false
 *     }
 *   }
 * }
 */
export interface IRelationFieldConfig {
  /** 
   * Route pattern for navigation (e.g., '/view-team/:teamId' or '/list-game')
   * Backend auto-generates if not provided
   */
  routePattern: string;
  
  /** 
   * Identifier mappings from source fields to target params.
   * Backend auto-extracts from `Relation.identifiers` if not provided.
   * 
   * @example
   * // Single identifier
   * identifierMapping: { source: 'homeTeamId', target: 'teamId' }
   * 
   * @example
   * // Composite key
   * identifierMapping: [
   *   { source: 'tenantId', target: 'tenantId' },
   *   { source: 'teamId', target: 'teamId' }
   * ]
   * 
   * @example
   * // Nested path
   * identifierMapping: { source: 'order.userId', target: 'userId' }
   */
  identifierMapping?: RelationIdentifier | RelationIdentifier[];
  
  /** 
   * Reference to entity config for modal display.
   * Backend auto-generates if not provided.
   */
  modalConfigRef?: IEntityConfigReference;
  
  /** Modal width in pixels or CSS string. Default: 800 for to-one, 1200 for to-many */
  modalWidth?: number | string;
  
  /** Modal title override. Default: uses page title from config */
  modalTitle?: string;
  
  /**
   * Display configuration for relation fields.
   * Controls templates, fallbacks, icons, and actions.
   */
  displayConfig?: {
    /**
     * Template for displaying relation value when hydrated data is available.
     * Falls back to fallback.template if data not available, then raw value.
     * 
     * @example '{team.name} ({team.city})'
     * @example { composite: ['team.name', 'team.city'], template: '{team.name} ({team.city})' }
     */
    template?: Template;
    
    /**
     * Fallback configuration when only ID available.
     * Backend pre-resolves this using entity metadata.
     * 
     * @example
     * fallback: {
     *   template: 'Team: {teamId}',
     *   linkText: 'View Team',
     *   modalButtonText: 'Team Details'
     * }
     */
    fallback?: {
      /** Fallback template - intentionally string-only for simplicity, backend pre-generates these */
      template: string;
      /** Link text (e.g., "View Team") */
      linkText?: string;
      /** Modal button text (e.g., "Team Details") */
      modalButtonText?: string;
    };
    
    /** Icon (defaults to entity metadata icon if not provided) */
    icon?: string;
    
    /** Show navigation link? Default: true for to-one, false for to-many */
    showLink?: boolean;
    
    /** Show modal button? Default: true */
    showModalIcon?: boolean;
    
    /** Configure which actions to render */
    actions?: {
      link?: boolean;
      modal?: boolean;
      custom?: Array<{
        label: string;
        /** Dynamic custom action label */
        template?: Template;
        icon?: string;
        onClick: string;
      }>;
    };
  };
}

export interface IEntityPageActionModalConfig {
  modalType: ModalType;
  modalPageConfig?: IConfirmModal | FormPageConfigStructure | ListPageConfigStructure | DetailsPageConfigStructure;
  
  /** EITHER: Make API call (existing pattern) */
  apiConfig?: IModalApiConfig;
  submitSuccessRedirect?: string;
  
  /** OR: Navigate without API call (new pattern) */
  navigateTo?: INavigateToConfig | string;  // String shorthand: "/list-game?status={status}"
  
  /** OPTIONAL: Display API response in a modal (instead of just toast notification)
   * Note: Only applies when apiConfig is present. Ignored for navigateTo.
   */
  responseConfig?: IResponseDisplayConfig;
  
  /**
   * Pre-populate form fields from context (route params + record data).
   * 
   * Values are evaluated when the modal opens and merged with form field defaults.
   * Merge priority (lowest to highest):
   * 1. Field-level defaults (from entity schema)
   * 2. initialValues (from action config) ← THIS
   * 3. Query params (from URL navigation with inverseMapping)
   * 4. Form defaultValues (from parent component)
   * 
   * Supports:
   * - Static values: `{ isActive: true, priority: 1 }`
   * - Template strings: `{ teamId: '{teamId}', sport: '{sport}' }`
   * - Nested paths: `{ teamName: '{team.name}', teamId: '{team.teamId}' }`
   * 
   * @example
   * // Static values
   * initialValues: {
   *   isActive: true,
   *   status: 'pending'
   * }
   * 
   * @example
   * // Template strings (evaluated from routeParams)
   * initialValues: {
   *   teamId: '{teamId}',        // Gets routeParams.teamId
   *   sport: '{sport}',          // Gets routeParams.sport
   *   createdDate: '2024-01-01'  // Static
   * }
   * 
   * @example
   * // Nested paths (for complex record data)
   * initialValues: {
   *   teamId: '{team.teamId}',
   *   teamName: '{team.name}',
   *   sportId: '{team.sport.sportId}'
   * }
   * 
   * Note: Template strings like '{teamId}' are evaluated at runtime from:
   * - routeParams (URL parameters)
   * - record (table row data when action is triggered from a table row)
   */
  initialValues?: Record<string, any>;
  
  /**
   * If true, parent component will be notified to refresh after successful operation.
   * This triggers the onSuccessCallback with the API response data.
   * 
   * Use cases:
   * - Refresh table after creating/updating a record
   * - Refresh parent page data after a successful operation
   * - Update UI state after modal action completes
   * 
   * Note: This works in combination with submitSuccessRedirect and responseConfig.
   * All three can be used together.
   * 
   * @default false
   * 
   * @example
   * {
   *   modalConfig: {
   *     modalType: 'form',
   *     apiConfig: { apiUrl: '/api/teams', apiMethod: 'POST' },
   *     refreshParentOnSuccess: true  // ✅ Table will refresh after creation
   *   }
   * }
   */
  refreshParentOnSuccess?: boolean;
  
  /**
   * Modal title - can be static string or dynamic template.
   * If string: used as-is or evaluated as template if contains {...}
   * If object: evaluated from routeParams
   * 
   * @example modalTitle: "Edit Team"
   * @example modalTitle: "Edit {teamName}"
   * @example modalTitle: { composite: ['teamName', 'city'], template: 'Edit {teamName} ({city})' }
   */
  modalTitle?: Template;
  
  /**
   * Success message - can be static string or dynamic template.
   * Evaluated from API response data.
   * If not provided, uses message from API response.
   * 
   * @example successMessage: 'Team created successfully!'
   * @example successMessage: '{teamName} created successfully!'
   */
  successMessage?: Template;
  
  /**
   * Error message - can be static string or dynamic template.
   * Evaluated from API error data.
   * If not provided, uses error from API response.
   * 
   * @example errorMessage: 'Failed to create team'
   * @example errorMessage: 'Failed to create {teamName}'
   */
  errorMessage?: Template;
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
  
  /**
   * Dynamic label template (evaluated from routeParams or record context).
   * If provided, overrides static `label` field.
   * 
   * @example
   * // Simple template
   * template: 'Edit {teamName}'
   * 
   * @example
   * // Complex template
   * template: {
   *   composite: ['teamName', 'city'],
   *   template: 'Edit {teamName} ({city})'
   * }
   */
  template?: Template;
  
  url?: string;
  icon?: string;
  type?: 'button' | 'dropdown';
  items?: Array<Omit<IEntityPageAction, 'items'>>;  // Items cannot have sub-items
  
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
  dateFormat?: string; // format to display the date
}


interface TimeFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'time';
  minTime?: string; // in HH:mm format
  maxTime?: string; // in HH:mm format
  timeFormat?: string; // format to display the time
}

interface DateTimeFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'datetime';
  minDateTime?: Date;
  maxDateTime?: Date;
  dateTimeFormat?: string; // format to display the date and time
}

interface ColorFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'color';
  defaultColor?: string; // default color value
}

interface BooleanFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'boolean' | 'switch' | 'toggle';
  trueLabel?: string; // label for the true value
  falseLabel?: string; // label for the false value
}

export interface SelectFieldMetadata<E extends EntitySchema<any, any, any> = any> extends BaseFieldMetadata {
  fieldType?: 'select' | 'multi-select' | 'autocomplete';
  options: FieldOptions<E>;
  maxSelections?: number; // maximum number of selections
  
  // DEPRECATED: Use addNewOptionConfig instead (this generates embedded config - causes JSON bloat)
  addNewOption?: {
    entityName: string; // entity name to create new option
    // UI Configuration: Overrides to apply when opening create form in modal
    overrideConfig?: {
      pageTitle?: string;
      columnsConfig?: IEntityPageColumnConfig;
      breadcrumbs?: Array<{ label: string; url?: string }>;
      submitSuccessRedirect?: string;
      formButtons?: Array<{ text: string; action: string; url?: string }>;
      hideFields?: string[];
      showOnlyFields?: string[];
    };
  };
  
  // NEW: Reference entity config instead of embedding (recommended - reduces JSON size)
  addNewOptionConfig?: IEntityConfigReference;
}

// Type guard for SelectFieldMetadata
export function isSelectFieldMetadata(obj: any): obj is SelectFieldMetadata {
  return (
    typeof obj === 'object'
    && !!obj
    && 'options' in obj
    && [ 'select', 'multi-select', 'autocomplete' ].includes(obj.fieldType)
  );
}

// Type guard for ImageFieldMetadata
export function isImageFieldMetadata(obj: any): obj is ImageFieldMetadata {
  return (
    typeof obj === 'object'
    && !!obj
    && obj.fieldType === 'image'
  );
}

// Type guard for FileFieldMetadata
export function isFileFieldMetadata(obj: any): obj is FileFieldMetadata {
  return (
    typeof obj === 'object'
    && !!obj
    && obj.fieldType === 'file'
  );
}

// Type guard for DateFieldMetadata
export function isDateFieldMetadata(obj: any): obj is DateFieldMetadata {
  return (
    typeof obj === 'object'
    && !!obj
    && obj.fieldType === 'date'
  );
}

// Type guard for DateTimeFieldMetadata
export function isDateTimeFieldMetadata(obj: any): obj is DateTimeFieldMetadata {
  return (
    typeof obj === 'object'
    && !!obj
    && obj.fieldType === 'datetime'
  );
}

// Type guard for NumberFieldMetadata
export function isNumberFieldMetadata(obj: any): obj is NumberFieldMetadata {
  return (
    typeof obj === 'object'
    && !!obj
    && obj.fieldType === 'number'
  );
}

// Type guard for BooleanFieldMetadata
export function isBooleanFieldMetadata(obj: any): obj is BooleanFieldMetadata {
  return (
    typeof obj === 'object'
    && !!obj
    && [ 'boolean', 'switch', 'toggle' ].includes(obj.fieldType)
  );
}

// Type guard for EditorFieldMetadata
export function isEditorFieldMetadata(obj: any): obj is EditorFieldMetadata {
  return (
    typeof obj === 'object'
    && !!obj
    && [ 'rich-text', 'wysiwyg' ].includes(obj.fieldType)
  );
}

// Type guard for CodeEditorFieldMetadata
export function isCodeEditorFieldMetadata(obj: any): obj is CodeEditorFieldMetadata {
  return (
    typeof obj === 'object'
    && !!obj
    && [ 'code', 'markdown', 'json' ].includes(obj.fieldType)
  );
}



interface RadioFieldMetadata<E extends EntitySchema<any, any, any> = any> extends BaseFieldMetadata {
  fieldType?: 'radio';
  options: FieldOptions<E>;
  layout?: 'horizontal' | 'vertical'; // layout of the radio buttons
}

interface CheckboxFieldMetadata<E extends EntitySchema<any, any, any> = any> extends BaseFieldMetadata {
  fieldType?: 'checkbox';
  options: FieldOptions<E>;
  layout?: 'horizontal' | 'vertical'; // layout of the radio buttons
}

interface CommonFileFieldMetadata {
  accept?: string; // file types to accept e.g. "image/*" | "image/png" | "image/jpeg" | "image/gif" | "image/bmp" | "image/webp" | "application/pdf" | "application/msword"
  maxFileSize?: number; // maximum file size in bytes
  fileNamePrefix?: string; // prefix for the file name e.g. 'profile-pic-' | 'documents/' | 'nested/path/to/images/'
  getSignedUploadUrlAPIConfig?: GetSignedUploadUrlAPIConfig, // API config to get signed upload URL
}

export interface FileFieldMetadata extends BaseFieldMetadata, CommonFileFieldMetadata {
  fieldType?: 'file';
}

export interface ImageFieldMetadata extends BaseFieldMetadata, CommonFileFieldMetadata {
  fieldType?: 'image';
  aspectRatio?: string; // desired aspect ratio for the image
  withImageCrop?: boolean; // whether to allow image cropping at the time of uploading
  accept?: "image/*" | "image/png" | "image/jpeg" | "image/gif" | "image/bmp" | "image/webp";
}

interface RangeFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'range';
  min?: number;
  max?: number;
  step?: number;
  showValue?: boolean; // whether to show the current value
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
  maxRating?: number; // maximum rating value
}

interface EditorFieldMetadata extends BaseFieldMetadata, CommonFileFieldMetadata {
  fieldType?: 'rich-text' | 'wysiwyg';
}

interface CodeEditorFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'code' | 'markdown' | 'json';
}

export type FieldOptions<E extends EntitySchema<any, any, any> = any> = Array<FieldOption> | FieldOptionsAPIConfig<E>;

export type FieldOption = {
  value: string,
  label: string,
}

/**
 * Represents the template for attributes in option selectors and dynamic labels.
 * Allows composing multiple attributes (including nested paths) into a formatted string.
 * Provides type-safe attribute name validation via generics.
 * 
 * Supports:
 * - Simple attribute names: 'firstName', 'lastName'
 * - Nested paths (dot notation): 'team.name', 'address.city', 'sport.league.name'
 * - Mixed usage: Combine simple and nested paths in the same template
 * 
 * @template E - The entity schema type
 * 
 * @example
 * ```ts
 * // Simple attributes
 * const template: AttributesTemplate<UserSchema> = {
 *   composite: ['firstName', 'lastName'],
 *   template: '{firstName} {lastName}'
 * }
 * ```
 * 
 * @example
 * ```ts
 * // Nested paths (dot notation)
 * const template: AttributesTemplate<PlayerSchema> = {
 *   composite: ['name', 'team.name', 'team.city'],
 *   template: '{name} - {team.name} ({team.city})'
 * }
 * // Result: 'LeBron James - Lakers (Los Angeles)'
 * ```
 * 
 * @example
 * ```ts
 * // Complex template with nested paths
 * const template: AttributesTemplate<PlayerSchema> = {
 *   composite: ['jerseyNumber', 'name', 'team.name', 'team.sport.league'],
 *   template: '#{jerseyNumber} {name} ({team.name} - {team.sport.league})'
 * }
 * // Result: '#23 LeBron James (Lakers - NBA)'
 * ```
 */
export type AttributesTemplate<E extends EntitySchema<any, any, any> = any> = {
  /** 
   * Array of attribute paths to include in the template.
   * Supports dot notation for nested access (e.g., 'team.name', 'address.city')
   */
  composite: Array<keyof E['attributes'] & string>,
  /** 
   * Template string with {attributePath} placeholders.
   * Example: '{firstName} {lastName}' or '{team.name} ({team.city})'
   */
  template: string,
}

/**
 * Template type for dynamic text rendering throughout FW24.
 * Used for actions, titles, labels, messages, etc.
 * 
 * Backend uses this with AttributesTemplate<E> for type safety against entity schemas.
 * Frontend uses ITemplateConfig as a generic interface for runtime evaluation.
 * 
 * @template E - Entity schema type for type-safe field access
 * 
 * @example
 * // Simple string template
 * template: '{firstName} {lastName}'
 * 
 * @example
 * // Complex template with type safety
 * template: {
 *   composite: ['firstName', 'lastName', 'team.name'],
 *   template: '{firstName} {lastName} ({team.name})'
 * }
 */
export type Template<E extends EntitySchema<any, any, any> = any> = 
  | string  // Simple: '{field1} {field2}' or static 'My Title'
  | AttributesTemplate<E>;  // Complex: { composite: [...], template: '...' }

/**
 * Configuration for loading field options from an API endpoint.
 * Provides type-safe attribute references for the given entity schema.
 * 
 * Features:
 * - Cursor-based pagination with "Load More" button (enabled by default)
 * - Remote search with debouncing (enabled by default)
 * - Frontend search fallback when remote search is disabled
 * - Automatic deduplication by value
 * - Alphabetical sorting by label
 * - Nested field support via dot notation (e.g., 'team.name')
 * - Complex template labels with multiple fields
 * 
 * @template E - The entity schema type for type-safe attribute references
 */
export type FieldOptionsAPIConfig<E extends EntitySchema<any, any, any>> = {
  /** HTTP method to use for fetching options */
  apiMethod: 'GET' | 'POST',
  /** API endpoint URL */
  apiUrl: string,
  /** Key in response data that contains the options array */
  responseKey: string,
  /** Additional filters to apply when fetching options (supports EntityFilterCriteria) */
  filters?: Record<string, any> | EntityFilterCriteria<E>,
  /** 
   * Mapping configuration for label and value fields.
   * 
   * Supports:
   * - Simple field names: 'firstName', 'teamName'
   * - Nested paths (dot notation): 'team.name', 'address.city'
   * - Complex templates: { composite: ['name', 'team.city'], template: '{name} ({team.city})' }
   */
  optionMapping?: {
    label: (keyof E['attributes'] & string) | AttributesTemplate<E>,
    value: (keyof E['attributes'] & string) | AttributesTemplate<E>,
  },
  /** Number of options to fetch per request (default: 50) */
  count?: number,
  /** 
   * Disable cursor-based pagination "Load More" functionality.
   * When false (default), shows "Load More" button when more data is available.
   * @default false (ENABLED by default)
   */
  disableLoadMore?: boolean,
  /** 
   * Disable remote search functionality.
   * When false (default), sends 'search' parameter to backend.
   * When true, falls back to frontend filtering.
   * @default false (ENABLED by default)
   */
  disableSearch?: boolean,
  /** 
   * Debounce delay for remote search in milliseconds.
   * Prevents excessive API calls while user is typing.
   * @default 500
   */
  searchDebounce?: number,
}

/**
 * Creates type-safe field options configuration for API-loaded select/radio/checkbox options.
 * Provides full type safety for attribute references in option mappings and filters.
 * 
 * Features:
 * - Cursor-based pagination with "Load More" (enabled by default)
 * - Remote search with debouncing (enabled by default)
 * - Type-safe filters using EntityFilterCriteria
 * - Nested field support via dot notation (e.g., 'team.name')
 * - Complex template labels with multiple fields
 * - Configurable fetch count (default: 50)
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
 * // With filters (active users only)
 * createFieldOptions<TeamSchema>({
 *   apiMethod: 'GET',
 *   apiUrl: '/api/teams',
 *   responseKey: 'teams',
 *   filters: { status: { eq: 'active' } },
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
 * 
 * @example
 * // With nested paths (dot notation) - supports accessing related entity data
 * createFieldOptions<PlayerSchema>({
 *   apiMethod: 'GET',
 *   apiUrl: '/api/players',
 *   responseKey: 'data',
 *   optionMapping: {
 *     label: {
 *       composite: ['jerseyNumber', 'name', 'team.name', 'team.city'],
 *       template: '#{jerseyNumber} {name} ({team.name} - {team.city})'
 *     },
 *     value: 'playerId'
 *   }
 * })
 * // Result: '#23 LeBron James (Lakers - Los Angeles)'
 * 
 * @example
 * // With custom settings: disable search, custom count, faster debounce
 * createFieldOptions<UserSchema>({
 *   apiMethod: 'GET',
 *   apiUrl: '/api/users',
 *   responseKey: 'data',
 *   count: 100,
 *   disableSearch: true,
 *   disableLoadMore: false,
 *   searchDebounce: 300,
 *   optionMapping: {
 *     label: 'name',
 *     value: 'userId'
 *   }
 * })
 */
export function createFieldOptions<E extends EntitySchema<any, any, any>>(
  config: FieldOptionsAPIConfig<E>
): FieldOptionsAPIConfig<E> {
  return config;
}

export const SpecialAttributeTypes = {
  name: 'name',
  slug: 'slug',
  color: 'color',
  image: 'image',
  description: 'description',

  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
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
export interface EntitySchema<
  A extends string,
  F extends string,
  C extends string,
  Opp extends TDefaultEntityOperations = TDefaultEntityOperations
> extends Schema<A, F, C> {
  readonly model: Schema<A, F, C>[ 'model' ] & {
    readonly entityNamePlural: string;
    readonly entityOperations: Opp;
    readonly entityMenuIcon?: string, // default is 'appStore'
    readonly entityNameAttribute?: string, // default is 'name'
    readonly entitySlugAttribute?: string, // default is 'slug'
    readonly entityImageAttribute?: string, // default is 'image'
    readonly entityDescriptionAttribute?: string, // default is 'description'

    readonly excludeFromAdminMenu?: boolean, // default is false
    readonly excludeFromAdminList?: boolean, // default is false
    readonly excludeFromAdminDetail?: boolean, // default is false
    readonly excludeFromAdminCreate?: boolean, // default is false
    readonly excludeFromAdminUpdate?: boolean, // default is false
    readonly excludeFromAdminDelete?: boolean, // default is false
    readonly excludeFromAdminDuplicate?: boolean, // default is false

    readonly CRUDApiPath?: string, // default is ''

    /**
     * Entity metadata for UI rendering.
     * Used for relation fallbacks, default icons, descriptions, etc.
     */
    readonly metadata?: {
      /** Icon name (Ant Design) - used as default in relations and UI elements */
      icon?: string;
      /** Brand color for this entity type (hex color) */
      color?: string;
      /** Short description for tooltips and help text */
      description?: string;
    };

    // Menu configuration
    readonly menuGroup?: string; // Group this entity belongs to in the menu
    readonly menuOrder?: number; // Order within the group (default: 0)

    // Create page configuration
    readonly createPageBreadcrumbs?: Array<{ label: string; url?: string }>,
    readonly createPageColumnsConfig?: IEntityPageColumnConfig,
    
    /**
     * List page configuration
     * 
     * These properties configure the entity's list/index page (e.g., `/list-game`).
     * All properties are transformed to unified names in the generated UI config.
     */
    
    /**
     * Actions for the list page header (page-level actions only, not table row actions).
     * 
     * These appear in the page header and operate at the page/entity level, not on individual
     * rows or selections. For row-level actions (edit, delete, view) or bulk selection actions
     * (delete selected, export selected), those are configured separately in the table config.
     * 
     * Note: Mapped to `pageHeaderActions` in generated UI config for frontend consumption.
     * The page-specific naming here (listPageActions) provides semantic clarity during
     * entity schema definition, while the frontend uses unified naming (pageHeaderActions)
     * for component reusability across all page types.
     * 
     * @example
     * ```typescript
     * listPageActions: [
     *   {
     *     label: 'Import Data',
     *     url: '/game/import',
     *     icon: 'upload',
     *     openInModal: true
     *   },
     *   {
     *     type: 'dropdown',
     *     label: 'Export Options',
     *     items: [
     *       { label: 'Export All as CSV', url: '/game/export/csv' },
     *       { label: 'Export All as JSON', url: '/game/export/json' }
     *     ]
     *   },
     *   {
     *     label: 'Refresh Data',
     *     url: '/game/refresh',
     *     icon: 'reload'
     *   }
     * ]
     * ```
     */
    readonly listPageActions?: IEntityPageAction[],
    readonly listPageBreadcrumbs?: Array<{ label: string; url?: string }>,
    /**
     * Default sort configuration for the list page
     * 
     * Three formats supported:
     * 1. Object (single column for search): { field: 'createdAt', order: 'desc' }
     * 2. Array (multi-column for search): [{ field: 'publishDate', order: 'desc' }, { field: 'likeCount', order: 'desc' }]
     * 3. Order direction (DynamoDB index order): 'asc' | 'desc'
     * 
     * Note: For DynamoDB (non-search) mode, use 'asc' | 'desc' to indicate the expected
     * index order direction. DynamoDB returns data in index (PK/SK) order, not arbitrary sort.
     */
    readonly listPageDefaultSort?: { field: string; order: 'asc' | 'desc' } | Array<{ field: string; order: 'asc' | 'desc' }> | 'asc' | 'desc',
    
    /**
     * View/Detail page configuration
     * 
     * These properties configure the entity's detail/view page (e.g., `/view-game/:id`).
     * All properties are transformed to unified names in the generated UI config.
     */
    
    /**
     * Actions for the view/detail page header (page-level actions for this specific record).
     * 
     * These actions operate on the current record being viewed. Common use cases include
     * navigating to related data, triggering record-specific operations, or opening
     * related pages/modals.
     * 
     * Note: Mapped to `pageHeaderActions` in generated UI config for frontend consumption.
     * Default actions ("Back", "Edit") are automatically added by the framework unless
     * excluded via entity operation flags.
     * 
     * @example
     * ```typescript
     * viewPageActions: [
     *   {
     *     type: 'dropdown',
     *     label: 'Related Data',
     *     items: [
     *       { label: 'View Game Stats', url: '/game/:id/stats' },
     *       { label: 'View Players', url: '/game/:id/players' },
     *       { label: 'View Timeline', url: '/game/:id/timeline' }
     *     ]
     *   },
     *   {
     *     label: 'Publish',
     *     url: '/game/:id/publish',
     *     icon: 'rocket',
     *     openInModal: true
     *   }
     * ]
     * ```
     */
    readonly viewPageActions?: IEntityPageAction[],
    readonly viewPageBreadcrumbs?: Array<{ label: string; url?: string }>,
    readonly viewPageColumnsConfig?: IEntityPageColumnConfig,
    
    /**
     * Edit/Update page configuration
     * 
     * These properties configure the entity's edit/update page (e.g., `/edit-game/:id`).
     * All properties are transformed to unified names in the generated UI config.
     */
    
    /**
     * Actions for the edit/update page header (page-level actions while editing this record).
     * 
     * These actions are available while editing a record. Common use cases include
     * previewing changes, accessing related data, or triggering record-specific workflows.
     * 
     * Note: Mapped to `pageHeaderActions` in generated UI config for frontend consumption.
     * Default actions ("Back", "Delete", "Duplicate") are automatically added by the
     * framework unless excluded via entity operation flags.
     * 
     * @example
     * ```typescript
     * editPageActions: [
     *   {
     *     label: 'Preview Changes',
     *     url: '/game/:id/preview',
     *     icon: 'eye',
     *     openInModal: true
     *   },
     *   {
     *     label: 'View History',
     *     url: '/game/:id/history',
     *     icon: 'history'
     *   }
     * ]
     * ```
     */
    readonly editPageActions?: IEntityPageAction[],
    readonly editPageBreadcrumbs?: Array<{ label: string; url?: string }>,
    readonly editPageColumnsConfig?: IEntityPageColumnConfig,
    

    readonly search?: {
      enabled: boolean;
      indexConfig?: SearchIndexConfig;
      serviceClass?: DepIdentifier<EntitySearchService<any>> | typeof EntitySearchService | EntitySearchService<any>;
      // Document transformation for indexing
      documentTransformer?: (entity: EntityRecordTypeFromSchema<EntitySchema<A, F, C>>) => Promise<Record<string, any>>;
    };
  };
  readonly attributes: {
    readonly [ a in A ]: EntityAttribute;
  };
}

/**
 * Default entity operations that are commonly used.
 * Use this as a base or define your own subset/superset.
 */
export const DefaultEntityOperations = {
  get: "get",
  list: "list",
  query: "query",
  create: "create",
  upsert: "upsert",
  update: "update",
  delete: "delete",
  duplicate: "duplicate",
} as const;

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
export type TEntityOpsInputSchemas<
  Sch extends EntitySchema<any, any, any, any>,
> = {
    readonly [ opName in keyof Sch[ 'model' ][ 'entityOperations' ] ]
    : opName extends 'get' ? EntityIdentifiersTypeFromSchema<Sch> | Array<EntityIdentifiersTypeFromSchema<Sch>>
    : opName extends 'list' ? never // list operations typically don't take identifiers as input
    : opName extends 'query' ? never // query operations use EntityQuery type
    : opName extends 'create' ? CreateEntityItemTypeFromSchema<Sch>
    : opName extends 'upsert' ? UpsertEntityItemTypeFromSchema<Sch>
    : opName extends 'update' ? UpdateEntityItemTypeFromSchema<Sch>
    : opName extends 'delete' ? EntityIdentifiersTypeFromSchema<Sch> | Array<EntityIdentifiersTypeFromSchema<Sch>>
    : opName extends 'duplicate' ? EntityIdentifiersTypeFromSchema<Sch>
    : {}
  }

export type CreateElectroDBEntityOptions<S extends EntitySchema<any, any, any>> = {
  schema: S,
  entityConfigurations: EntityConfiguration;
}


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
export function createEntitySchema<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C, Ops>,
  Ops extends TDefaultEntityOperations = TDefaultEntityOperations,
>(schema: S): S {
  // Automatically inject _actor field into every schema for audit tracking
  const enhancedSchema = {
    ...schema,
    attributes: {
      ...schema.attributes,
      _actor: {
        type: 'any',
        required: false,
        hidden: true,  // Hidden from ElectroDB operations
        readOnly: false,
        // UI metadata - mark as not visible in any UI
        isVisible: false,
        isListable: false,
        isCreatable: false,
        isEditable: false,
        isFilterable: false,
        isSearchable: false,
        isSortable: false,
        name: "Actor Context",
        description: "Internal field storing complete actor context for audit purposes"
      }
    }
  } as S;

  return createSchema(enhancedSchema);
}

export function createElectroDBEntity<S extends EntitySchema<any, any, any>>(options: CreateElectroDBEntityOptions<S>) {
  const { schema, entityConfigurations } = options;

  const newElectroDbEntity = new Entity(
    schema,
    entityConfigurations
  );

  return {
    name: schema.model.entity,
    entity: newElectroDbEntity,
    schema: schema,
    symbol: Symbol.for(schema.model.entity),
  }
}

// Infer types utils
export type EntityTypeFromSchema<TSchema> = TSchema extends EntitySchema<infer A, infer F, infer C>
  ? Entity<A, F, C, TSchema>
  : never;

export type EntityResponseItemTypeFromSchema<TSchema> = TSchema extends EntitySchema<infer A, infer F, infer C>
  ? ResponseItem<A, F, C, TSchema>
  : never;

/**
 * Utility type to extract the value type of a specific attribute from an entity schema.
 * Useful for type-safe attribute value handling.
 * 
 * @template E - The entity schema
 * @template K - The attribute key
 */
export type AttributeValueType<
  E extends EntitySchema<any, any, any>,
  K extends keyof E['attributes']
> = E['attributes'][K]['type'] extends 'string' ? string
  : E['attributes'][K]['type'] extends 'number' ? number
  : E['attributes'][K]['type'] extends 'boolean' ? boolean
  : E['attributes'][K]['type'] extends Array<infer T> ? T
  : E['attributes'][K]['type'] extends 'any' ? any
  : E['attributes'][K]['type'] extends 'set' ? Set<string>
  : E['attributes'][K]['type'] extends 'list' ? Array<any>
  : E['attributes'][K]['type'] extends 'map' ? Record<string, any>
  : any;

/**
 * Utility type to extract all attribute names and their value types as a key-value map.
 * 
 * @template E - The entity schema
 */
export type EntityAttributeValueMap<E extends EntitySchema<any, any, any>> = {
  [K in keyof E['attributes']]: AttributeValueType<E, K>
};


export type UpsertEntityItem<E extends Entity<any, any, any, any>> =
  E extends Entity<infer A, infer F, infer C, infer S>
  ? UpsertItem<A, F, C, S>
  : never;

export type EntityRecordTypeFromSchema<Sch extends EntitySchema<any, any, any>> = EntityItem<EntityTypeFromSchema<Sch>>;

// Entity service
export type EntityServiceTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = BaseEntityService<TSchema>;

// Entity identifiers
export type EntityIdentifiersTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<EntityIdentifiers<EntityTypeFromSchema<TSchema>>>;

// Create entity
export type CreateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<CreateEntityItem<EntityTypeFromSchema<TSchema>>>;

// Upsert entity
export type UpsertEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<UpsertEntityItem<EntityTypeFromSchema<TSchema>>>;

// Update entity
export type UpdateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<UpdateEntityItem<EntityTypeFromSchema<TSchema>>>;