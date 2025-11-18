import type { EntityConfiguration, Schema, EntityIdentifiers, CreateEntityItem, UpdateEntityItem, EntityItem, Attribute, ResponseItem, UpsertItem  } from "electrodb";
import { createSchema, Entity } from "electrodb";

import type { EntityQuery, FilterOperatorsExtended, EntityFilterCriteria } from './query-types';
import type { BaseEntityService } from "./base-service";
import type { OmitNever, Paths, Writable } from "../utils/types";
import { SearchIndexConfig } from '../search/types';
import { EntitySearchService } from '../search/services';
import { DepIdentifier, IFilterAutoGenerationConfig, ISegmentAutoGenerationConfig } from "../interfaces";
import type { FormPageConfigStructure, ListPageConfigStructure, DetailsPageConfigStructure, DashboardPageConfig } from '../ui-config-gen/templates/custom-page';

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
/**
 * Utility type to extract only relation attributes from an entity schema.
 * Filters out hidden attributes and non-relation attributes.
 * 
 * @template T - The entity schema type
 */
export type RelationalAttributes<T extends EntitySchema<any, any, any, any>> = OmitNever<{
  [ K in keyof T[ 'attributes' ] ]: T[ 'attributes' ][ K ][ 'hidden' ] extends true ? never
  : PickRelation<T, K> extends never ? never
  : PickRelation<T, K>;
}>

/**
 * Utility type to extract only non-relation attributes from an entity schema.
 * Filters out hidden attributes and relation attributes.
 * 
 * @template T - The entity schema type
 */
export type NonRelationalAttributes<T extends EntitySchema<any, any, any, any>> = OmitNever<{
  [ K in keyof T[ 'attributes' ] ]: T[ 'attributes' ][ K ][ 'hidden' ] extends true ? never
  : PickRelation<T, K> extends never ? T[ 'attributes' ][ K ] : never
}>

/**
 * Utility type to extract the relation type from an entity attribute.
 * Returns the Relation<E> type if the attribute has a relation, otherwise never.
 * 
 * @template E - The entity schema type
 * @template A - The attribute key
 */
export type PickRelation<E extends EntitySchema<any, any, any, any>, A extends keyof E[ 'attributes' ]> =
  E[ 'attributes' ][ A ][ 'relation' ] extends Relation<infer R> ? Relation<R> : never;

/**
 * Internal utility type for constructing all possible attribute paths.
 * Recursively builds paths for nested relations.
 * @internal
 */
type _EntityAttributePaths<E extends EntitySchema<any, any, any, any>> =
  { [ K in keyof NonRelationalAttributes<E> ]?: K }
  &
  { [ K in keyof RelationalAttributes<E> ]?: _EntityAttributePaths<RelToRelatedEntity<RelationalAttributes<E>[ K ]>> }

/**
 * Utility type representing all possible attribute paths for an entity.
 * Includes nested paths for relations (e.g., 'team.name', 'team.city').
 * 
 * @template E - The entity schema type
 * @example
 * ```ts
 * type GamePaths = EntityAttributePaths<GameSchema>;
 * // 'gameId' | 'gameDate' | 'homeTeam' | 'homeTeam.teamId' | 'homeTeam.teamName' | ...
 * ```
 */
export type EntityAttributePaths<E extends EntitySchema<any, any, any, any>> = Paths<_EntityAttributePaths<E>>;

/**
 * Utility type representing hydration options as a map.
 * Maps attribute names to boolean (simple hydration) or HydrateOptionForRelation (nested hydration).
 * 
 * @template T - The entity schema type
 */
export type HydrateOptionsMapForEntity<T extends EntitySchema<any, any, any, any>> =
  { [ K in keyof NonRelationalAttributes<T> ]?: boolean; }
  &
  { [ K in keyof RelationalAttributes<T> ]?: boolean | HydrateOptionForRelation<RelationalAttributes<T>[ K ]> };

/**
 * Utility type representing hydration options for an entity.
 * Can be either a map (object) or an array of attribute paths.
 * 
 * @template E - The entity schema type
 * @example
 * ```ts
 * // Map format
 * const hydrate1: HydrateOptionForEntity<GameSchema> = {
 *   gameId: true,
 *   homeTeam: { attributes: { teamId: true, teamName: true } }
 * };
 * 
 * // Array format
 * const hydrate2: HydrateOptionForEntity<GameSchema> = [
 *   'gameId',
 *   'homeTeam.teamId',
 *   'homeTeam.teamName'
 * ];
 * ```
 */
export type HydrateOptionForEntity<E extends EntitySchema<any, any, any, any>> = HydrateOptionsMapForEntity<E> | Array<EntityAttributePaths<E>>;

/**
 * Utility type representing hydration options for a specific relation.
 * Used when you want to control which attributes of a related entity to load.
 * 
 * @template Rel - The relation type
 * @example
 * ```ts
 * const relationHydrate: HydrateOptionForRelation = {
 *   entityName: 'team',
 *   attributes: { teamId: true, teamName: true, city: true }
 * };
 * ```
 */
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

/**
 * Utility type to extract the related entity schema from a Relation type.
 * 
 * @template Rel - The relation type
 * @example
 * ```ts
 * type TeamRelation = Relation<TeamSchema>;
 * type Team = RelToRelatedEntity<TeamRelation>;  // TeamSchema
 * ```
 */
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
 * FW24-specific properties that extend ElectroDB attributes
 */
export interface FW24AttributeExtensions {
  /**
   * The human readable name of the attribute.
   */
  readonly name?: string;

  /**
   * Indicates whether the attribute is an identifier.
   */
  readonly isIdentifier?: boolean;

  /**
   * Indicates whether the attribute is unique (for unique constraints).
   */
  readonly isUnique?: boolean;

  /**
   * Defines a relation with another entity.
   * Use the type-helper `createEntityRelation<EntitySchema>()` function for type-safe relation creation.
   * For circular dependencies, use `createEntityRelation<() => EntitySchema>()` with lazy loading.
   */
  readonly relation?: Relation<any>;

  /**
   * Validations for the attribute.
   * Supports both readonly and mutable arrays for compatibility with 'as const' entity schemas.
   */
  readonly validations?: ReadonlyArray<any> | Array<any>;
}

/**
 * Represents an entity attribute with full type safety and UI metadata.
 * Combines ElectroDB's base Attribute with FW24-specific extensions and UI field metadata.
 * 
 * This is the complete attribute type used in entity schemas, providing:
 * - Database configuration (from ElectroDB's Attribute)
 * - Data layer configuration (from FW24AttributeExtensions: relations, validations)
 * - UI layer configuration (from FieldMetadata: visibility, filtering, rendering)
 * 
 * @example
 * ```ts
 * const teamNameAttr: EntityAttribute = {
 *   type: 'string',
 *   required: true,
 *   name: 'Team Name',
 *   isVisible: true,
 *   isEditable: true,
 *   isFilterable: true,
 *   fieldType: 'text',
 *   placeholder: 'Enter team name'
 * };
 * ```
 */
export type EntityAttribute = Attribute & FW24AttributeExtensions & FieldMetadata;

/**
 * Union type of all possible field metadata configurations.
 * Represents the UI-specific configuration for different field types.
 * 
 * Each field type has its own metadata interface with type-specific options:
 * - Text fields: maxLength, mask
 * - Number fields: min, max, step
 * - Date fields: minDate, maxDate, dateFormat
 * - Select fields: options (static or API-loaded)
 * - File/Image fields: accept, maxFileSize, upload configuration
 * - Rich text/code editors: editor configuration
 * 
 * The appropriate metadata type is determined by the `fieldType` property.
 */
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
    filterType?: 'text' | 'select' | 'datetime' | 'number' | 'boolean' | 'relation'; // Filter input type
    defaultOperator?: keyof FilterOperatorsExtended<any> | string; // Default filter operator (e.g., 'contains', 'eq', 'in')
    availableOperators?: ReadonlyArray<keyof FilterOperatorsExtended<any> | string> | Array<keyof FilterOperatorsExtended<any> | string>; // Restrict available operators for this column
    predefinedOptions?: FieldOptionsAPIConfig<any> | FieldOption[]; // For filters: API config OR inline options
  };
  
  /**
   * Custom labels for boolean field segments.
   * Used when generating filter segments for boolean fields.
   * If not provided, framework uses global defaults from config.
   * 
   * @example
   * ```ts
   * isLive: {
   *   type: 'boolean',
   *   booleanLabels: { true: 'Live', false: 'Not Live' }
   * }
   * ```
   */
  booleanLabels?: BooleanFieldLabels;
  
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
    breadcrumbs?: ReadonlyArray<{ label: string; url?: string }> | Array<{ label: string; url?: string }>;
    
    /** Override form success redirect (for create pages) */
    submitSuccessRedirect?: string;
    
    /** Override form buttons (for create pages) */
    formButtons?: ReadonlyArray<{ text: string; action: string; url?: string }> | Array<{ text: string; action: string; url?: string }>;
    
    /** Add default filters (for list pages) */
    defaultFilters?: Record<string, any>;
    
    /** Hide specific fields from rendering */
    hideFields?: ReadonlyArray<string> | Array<string>;
    
    /** Show only specific fields (mutually exclusive with hideFields) */
    showOnlyFields?: ReadonlyArray<string> | Array<string>;
    
    /** 
     * Override the API configuration for fetching data.
     * - For view pages: Overrides detailApiConfig
     * - For list pages: Overrides apiConfig (supports both single and dual search/database configs)
     * 
     * @example
     * // View page - simple API config
     * apiConfig: {
     *   apiMethod: 'GET',
     *   apiUrl: '/admin/subscription/:id',
     *   responseKey: 'subscription'
     * }
     * 
     * @example
     * // List page - single API config
     * apiConfig: {
     *   apiMethod: 'GET',
     *   apiUrl: '/admin/orders',
     *   responseKey: 'items',
     *   useSearch: false
     * }
     * 
     * @example
     * // List page - dual API config (search + database)
     * apiConfig: {
     *   search: {
     *     apiMethod: 'GET',
     *     apiUrl: '/admin/orders/search',
     *     responseKey: 'items'
     *   },
     *   database: {
     *     apiMethod: 'GET',
     *     apiUrl: '/admin/orders',
     *     responseKey: 'items'
     *   }
     * }
     */
    apiConfig?: IModalApiConfig | {
      search: IModalApiConfig;
      database: IModalApiConfig;
    } | {
      apiMethod: ApiMethod;
      apiUrl: string;
      responseKey?: string;
      useSearch?: boolean;
      defaultSort?: { field: string; order: 'asc' | 'desc' };
    };
    
    /** 
     * Map parent route params to different names for the child section.
     * Uses the same pattern as relation identifierMapping for consistency.
     * 
     * @example
     * // Single identifier mapping
     * identifierMapping: { source: 'subscriptionId', target: 'id' }
     * 
     * @example
     * // Multiple identifier mappings
     * identifierMapping: [
     *   { source: 'subscriptionId', target: 'id' },
     *   { source: 'userId', target: 'customerId' }
     * ]
     * 
     * @example
     * // Nested path mapping (if needed in future)
     * identifierMapping: { source: 'order.subscriptionId', target: 'id' }
     */
    identifierMapping?: { source: string; target: string } | Array<{ source: string; target: string }>;
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
 *     identifiers: { source: 'homeTeamId', target: 'teamId' }
 *   }),
 *   relationConfig: {
 *     routePattern: '/list-game',
 *     modalConfigRef: {
 *       entityName: 'game',
 *       pageType: 'list',
 *       overrideConfig: {
 *         defaultFilters: { homeTeamId: ':teamId', status: 'upcoming' }
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
     * If not provided, auto-detection will try to find duplicated fields.
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
    
    /**
     * Control auto-detection of duplicated fields for this specific relation.
     * - undefined or true: Enable auto-detection (default)
     * - false: Disable auto-detection
     * 
     * Only used if template is not explicitly provided.
     * 
     * @example
     * autoDetect: false  // Disable auto-detection
     */
    autoDetect?: boolean;
    
    /**
     * Hints to guide auto-detection when enabled.
     * Only used if autoDetect !== false and template is not provided.
     * 
     * @example
     * autoDetectHints: {
     *   preferredFields: ['homeTeamName', 'homeTeamTitle'],
     *   excludeFields: ['homeTeamInternalCode'],
     *   templateStyle: 'composite'
     * }
     */
    autoDetectHints?: {
      /**
       * Preferred field names to use (in priority order).
       * Auto-detection will try these first.
       * @example ['homeTeamName', 'homeTeamTitle']
       */
      preferredFields?: string[];
      
      /**
       * Field names to exclude from detection.
       * @example ['homeTeamInternalCode']
       */
      excludeFields?: string[];
      
      /**
       * Template style for this specific relation.
       * Overrides global/entity-level templateStyle.
       */
      templateStyle?: 'simple' | 'composite';
    };
    
    /**
     * Internal: Detection metadata (populated by backend).
     * Stored for debugging and future features.
     * @internal
     */
    _detectionMetadata?: {
      detectedFields: {
        primary: string;
        alternatives?: string[];
        visual?: string[];
        meta?: string[];
      };
      confidence: 'high' | 'medium' | 'low';
      method: string;
      pattern: string;
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
 * Template reference for dynamic value resolution in visibility conditions.
 * Uses object notation to avoid JSX confusion.
 * 
 * @example
 * { $ref: 'actor.actorId' }
 * { $ref: 'record.createdBy' }
 * { $ref: 'context.pageType' }
 */
export type TemplateRef = {
  readonly $ref: string;
};

/**
 * Evaluation rule for visibility conditions.
 * Aligned with ValidationRule<T> pattern from validation/types.ts
 * 
 * @template T - The type of value being evaluated
 */
export type EvaluationRule<T = any> = {
  readonly eq?: T | TemplateRef;
  readonly neq?: T | TemplateRef;
  readonly gt?: T | TemplateRef;
  readonly gte?: T | TemplateRef;
  readonly lt?: T | TemplateRef;
  readonly lte?: T | TemplateRef;
  readonly inList?: ReadonlyArray<T>;
  readonly notInList?: ReadonlyArray<T>;
  readonly custom?: string;
  readonly pattern?: string;
  readonly exists?: boolean;
  readonly empty?: boolean;
};

/**
 * Inline visibility condition (full structure).
 * Similar to EntityValidationCondition pattern from validation/types.ts
 */
export type InlineVisibilityCondition = {
  readonly actor?: {
    readonly [ path: string ]: EvaluationRule;
  };
  readonly record?: {
    readonly [ path: string ]: EvaluationRule;
  };
  readonly selectedRecords?: {
    readonly length?: EvaluationRule<number>;
    readonly all?: {
      readonly [ path: string ]: EvaluationRule;
    };
    readonly some?: {
      readonly [ path: string ]: EvaluationRule;
    };
    readonly none?: {
      readonly [ path: string ]: EvaluationRule;
    };
  };
  readonly queryParams?: {
    readonly [ key: string ]: EvaluationRule;
  };
  readonly context?: {
    readonly pageType?: EvaluationRule<'list' | 'view' | 'edit' | 'create'>;
    readonly modalDepth?: EvaluationRule<number>;
    readonly entityName?: EvaluationRule<string>;
    readonly [ key: string ]: EvaluationRule | undefined;
  };
  readonly formValues?: {
    readonly [ path: string ]: EvaluationRule;
  };
};

/**
 * Custom evaluator reference.
 * References a function registered in the frontend registry.
 */
export type CustomVisibilityCondition = {
  readonly custom: string;
};

/**
 * Named conditions with scope.
 * References multiple named conditions registered in the frontend.
 */
export type NamedVisibilityCondition = {
  readonly conditions: ReadonlyArray<string>;
  readonly scope?: 'all' | 'any' | 'none';
};

/**
 * Shortcut visibility config for common cases.
 * Provides simplified syntax for role-based and simple conditional visibility.
 */
export type ShortcutVisibilityCondition = {
  readonly requiredRoles?: ReadonlyArray<string>;
  readonly excludedRoles?: ReadonlyArray<string>;
  readonly showWhen?: Record<string, any>;
  readonly hideWhen?: Record<string, any>;
};

/**
 * Visibility configuration for actions, buttons, and UI elements.
 * Controls visibility and enablement based on actor, record, context, and custom logic.
 * 
 * Serializable JSON configuration evaluated in the frontend.
 * Supports roles, permissions, custom evaluators, and complex conditions.
 * 
 * @example
 * // Role-based (shortcut)
 * visibility: {
 *   requiredRoles: ['admin', 'editor']
 * }
 * 
 * @example
 * // Owner check (inline with template)
 * visibility: {
 *   record: {
 *     createdBy: { eq: { $ref: 'actor.actorId' } }
 *   }
 * }
 * 
 * @example
 * // Custom logic (function reference)
 * visibility: {
 *   custom: 'canEditGame'
 * }
 * 
 * @example
 * // Named conditions
 * visibility: {
 *   conditions: ['isAdmin', 'isOwner'],
 *   scope: 'any'
 * }
 */
export type VisibilityConfig = 
  | InlineVisibilityCondition
  | CustomVisibilityCondition
  | NamedVisibilityCondition
  | ShortcutVisibilityCondition;

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
  /**
   * Unique identifier for this action. Used for override matching in merge logic.
   * When defaults are generated, they use standard IDs like 'view', 'edit', 'delete'.
   * Custom actions with the same ID will override defaults.
   */
  id?: string;
  
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
  items?: ReadonlyArray<Omit<IEntityPageAction, 'items'>> | Array<Omit<IEntityPageAction, 'items'>>;  // Items cannot have sub-items
  
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
  
  /**
   * Visibility configuration for this action.
   * Controls visibility and enablement based on actor roles, record state, context, and custom logic.
   * 
   * When undefined, action is visible and enabled by default.
   * 
   * Supports:
   * - Role-based access (requiredRoles, excludedRoles)
   * - Record-based conditions (owner checks, status checks)
   * - Context-based logic (page type, modal depth, query params)
   * - Custom evaluator functions (registered in frontend)
   * 
   * @example
   * // Simple role check
   * visibility: {
   *   requiredRoles: ['admin']
   * }
   * 
   * @example
   * // Owner check
   * visibility: {
   *   record: {
   *     createdBy: { eq: { $ref: 'actor.actorId' } }
   *   }
   * }
   * 
   * @example
   * // Custom logic
   * visibility: {
   *   custom: 'canEditGame'
   * }
   * 
   * @example
   * // Multiple conditions
   * visibility: {
   *   conditions: ['isAdmin', 'isOwner'],
   *   scope: 'any'
   * }
   */
  visibility?: VisibilityConfig;
}

export interface IEntityPageColumn {
  readonly sortOrder: number;
  readonly fields: ReadonlyArray<string> | Array<string>;
}

export interface IEntityPageColumnConfig {
  readonly numColumns?: number;
  readonly columns: ReadonlyArray<IEntityPageColumn> | Array<IEntityPageColumn>;
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
      breadcrumbs?: ReadonlyArray<{ label: string; url?: string }> | Array<{ label: string; url?: string }>;
      submitSuccessRedirect?: string;
      formButtons?: ReadonlyArray<{ text: string; action: string; url?: string }> | Array<{ text: string; action: string; url?: string }>;
      hideFields?: ReadonlyArray<string> | Array<string>;
      showOnlyFields?: ReadonlyArray<string> | Array<string>;
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

export type FieldOptions<E extends EntitySchema<any, any, any> = any> = 
  | ReadonlyArray<FieldOption> 
  | Array<FieldOption> 
  | FieldOptionsAPIConfig<E>
  | RelationEntityOptionConfig<E>;

export type FieldOption = {
  value: string,
  label: string,
}

/**
 * Custom labels for boolean field segments.
 * Allows defining user-friendly labels instead of "True"/"False".
 * 
 * @example
 * ```ts
 * isLive: {
 *   type: 'boolean',
 *   booleanLabels: { true: 'Live', false: 'Not Live' }
 * }
 * ```
 */
export interface BooleanFieldLabels {
  true: string;
  false: string;
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
  // composite: Array<keyof E['attributes'] & string>,
  composite: ReadonlyArray<keyof E['attributes'] & string> | Array<keyof E['attributes'] & string>,

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
 * Minimal configuration for relation-based options.
 * Framework automatically resolves CRUD path and option mapping from entity metadata.
 * Extends FieldOptionsAPIConfig but omits fields that are auto-generated (apiUrl, apiMethod, responseKey).
 * 
 * @template E - The related entity schema type
 * 
 * @example
 * ```ts
 * // Minimal - framework auto-detects everything
 * createRelationOptions({
 *   entityName: 'Team'
 * })
 * 
 * // With custom mapping
 * createRelationOptions({
 *   entityName: 'Team',
 *   optionMapping: {
 *     label: 'teamName',
 *     value: 'teamId'
 *   }
 * })
 * 
 * // With custom API URL
 * createRelationOptions({
 *   entityName: 'Team',
 *   customApiUrl: '/custom/teams'
 * })
 * ```
 */
export type RelationEntityOptionConfig<E extends EntitySchema<any, any, any> = any> = 
  Omit<FieldOptionsAPIConfig<E>, 'apiUrl' | 'apiMethod' | 'responseKey'> & {
    /** Name of the related entity (required) */
    entityName: string;
    /** Custom API URL (optional - overrides auto-detected CRUD path) */
    customApiUrl?: string;
  };

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

/**
 * Creates type-safe relation-based options configuration.
 * Framework automatically resolves CRUD path and option mapping from entity metadata.
 * 
 * Use this for relation fields where you want the framework to handle:
 * - CRUD API path resolution from entity schema
 * - Label field detection from entityNameAttribute metadata
 * - Value field resolution from relation identifiers
 * 
 * @example
 * ```ts
 * // Minimal - framework figures out everything
 * teamId: {
 *   fieldType: 'select',
 *   options: createRelationOptions({ entityName: 'Team' }),
 *   relation: { ... }
 * }
 * 
 * // With custom mapping override
 * teamId: {
 *   fieldType: 'select',
 *   options: createRelationOptions({
 *     entityName: 'Team',
 *     optionMapping: { label: 'teamName', value: 'teamId' }
 *   }),
 *   relation: { ... }
 * }
 * ```
 */
export function createRelationOptions<E extends EntitySchema<any, any, any> = any>(
  config: RelationEntityOptionConfig<E>
): RelationEntityOptionConfig<E> {
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
/**
 * List page nested configuration (RECOMMENDED)
 * Replaces: listPageActions, listPageBreadcrumbs, listPageDefaultSort
 */
/**
 * Expandable row configuration for list pages.
 * Allows displaying nested data (e.g., to-many relations) within table rows.
 * 
 * Uses the existing Table component to render nested data, providing:
 * - Full table features (pagination, filters, sorting)
 * - Consistent UI/UX
 * - Performance optimizations (lazy loading, virtualization)
 * 
 * @example
 * // Expand team rows to show players
 * expandable: {
 *   mode: 'nested-table',
 *   relationField: 'players',  // Field containing relation data or API URL
 *   tableConfig: {
 *     apiUrl: '/api/player?teamId.eq=:teamId',
 *     columns: ['playerName', 'position', 'jerseyNumber'],
 *     pageSize: 5,
 *     showPagination: true
 *   },
 *   rowExpandable: {
 *     record: { playerCount: { gt: 0 } }  // Only expand if team has players
 *   }
 * }
 */
export interface ITableExpandableConfig {
  /** 
   * Mode for expandable content.
   * - 'nested-table': Render another table (for to-many relations)
   * - 'details': Render detail view of nested data
   * - 'custom': Use custom pageType rendering
   */
  mode: 'nested-table' | 'details' | 'custom';
  
  /**
   * Field name containing relation data or used to construct API URL.
   * Supports placeholder substitution (e.g., 'teamId' in '/api/player?teamId.eq=:teamId')
   */
  relationField?: string;
  
  /**
   * Configuration for nested table mode.
   * Reuses existing Table component with all its features.
   */
  tableConfig?: {
    /** API URL for fetching nested data. Supports placeholders like :teamId */
    apiUrl: string;
    /** API method. Default: 'GET' */
    apiMethod?: 'GET' | 'POST';
    /** Response key for data extraction. Default: 'data' */
    responseKey?: string;
    /** Column field names to display. If omitted, shows all columns */
    columns?: ReadonlyArray<string> | Array<string>;
    /** Number of items per page. Default: 5 */
    pageSize?: number;
    /** Show pagination controls. Default: true */
    showPagination?: boolean;
    /** Pre-applied filters (supports placeholders like ':teamId') */
    defaultFilters?: Record<string, any>;
    /** Show "View All" link that opens full list in modal */
    showViewAll?: boolean;
    /** Modal width for "View All" link. Default: 1200 */
    viewAllModalWidth?: number | string;
  };
  
  /**
   * Configuration for details mode.
   * Shows detail view of nested data.
   */
  detailsConfig?: {
    /** Field names to display. If omitted, shows all fields */
    fields?: ReadonlyArray<string> | Array<string>;
    /** Number of columns for layout. Default: 2 */
    numColumns?: number;
  };
  
  /**
   * Configuration for custom page type mode.
   * Allows rendering any page type (list, details, form, dashboard, etc.)
   */
  customConfig?: {
    /** Page type to render */
    pageType: 'list' | 'details' | 'form' | 'dashboard' | 'accordion';
    /** Page configuration */
    pageConfig?: Record<string, any>;
  };
  
  /**
   * Condition to determine if a row is expandable.
   * Uses visibility evaluation system for conditional expansion.
   * 
   * @example
   * // Only expand if team has players
   * rowExpandable: {
   *   record: { playerCount: { gt: 0 } }
   * }
   * 
   * @example
   * // Only expand for admin users
   * rowExpandable: {
   *   actor: { role: { inList: ['admin'] } }
   * }
   */
  rowExpandable?: VisibilityConfig;
  
  /**
   * Default expand state. If true, rows are expanded by default.
   * Default: false
   */
  defaultExpanded?: boolean;
  
  /**
   * Icon for expand button. Default: uses Ant Design default
   */
  expandIcon?: string;
  
  /**
   * Indent size for nested content. Default: 60
   */
  indentSize?: number;
}

/**
 * Filter segment (quick filter tab) for tables.
 * 
 * Segments provide quick access to common filter sets displayed as tabs above the table.
 * Supports visibility conditions and placeholder resolution for dynamic filters.
 */
export interface IFilterSegment {
  /**
   * Unique identifier for the segment
   */
  id: string;
  
  /**
   * Display label for the segment tab
   */
  label: string;
  
  /**
   * Optional icon name (Ant Design icon)
   */
  icon?: string;
  
  /**
   * Filters to apply when this segment is active.
   * Supports placeholder syntax (`:actor.actorId`, `:startOfToday`, etc.)
   * 
   * @example
   * filters: {
   *   status: { eq: 'active' },
   *   createdBy: ':actor.actorId',
   *   createdAt: { gte: ':startOfMonth' }
   * }
   */
  filters: Record<string, any>;
  
  /**
   * Whether this segment should be selected by default
   * Default: false (first segment is default if none specified)
   */
  default?: boolean;
  
  /**
   * Visibility condition for this segment.
   * Can be used to show segments only to certain roles or in certain contexts.
   * 
   * @example
   * visibility: {
   *   actor: { role: { inList: ['admin', 'team-admin'] } }
   * }
   */
  visibility?: VisibilityConfig;
  
  /**
   * Badge count to display on the segment.
   * Can be a static number or a placeholder.
   * 
   * @example
   * badge: 5  // Static count
   * badge: ':record.activeCount'  // Dynamic from context
   */
  badge?: number | string;
  
  /**
   * Badge color (Ant Design status colors)
   * Default: 'default'
   */
  badgeStatus?: 'success' | 'processing' | 'error' | 'warning' | 'default';
}

/**
 * Filter segment group configuration.
 * Groups related segments together with a label (e.g., "By Status", "By League").
 * Each group manages its own filter state independently.
 */
export interface IFilterSegmentGroup {
  /**
   * Unique identifier for the group
   */
  id: string;
  
  /**
   * Display label for the group (e.g., "By Status", "By League", "By Priority")
   */
  label: string;
  
  /**
   * Segments within this group
   */
  segments: IFilterSegment[];
  
  /**
   * Default segment ID for this group (if different from first segment)
   */
  defaultSegmentId?: string;
  
  /**
   * Maximum number of segments to show before "More..." dropdown
   * Default: 10
   */
  maxVisible?: number;
}

/**
 * Column configuration object with full control.
 * Provides explicit control over visibility, width, grouping, and other column properties.
 */
export interface ITableColumnConfig {
  /** Field name (attribute name from entity schema) */
  field: string;
  /** Visibility configuration for role-based/conditional display */
  visibility?: VisibilityConfig;
  /** Column width in pixels or CSS string (e.g., '150px', '20%') */
  width?: string | number;
  /** Pin column to left or right side of table */
  fixed?: 'left' | 'right';
  /** Group title for column grouping. Columns with same groupTitle will be grouped together. */
  groupTitle?: string;
  /** 
   * Controls initial visibility in the UI. 
   * - true: Column is visible by default
   * - false: Column is hidden by default but available in Column Settings
   * - undefined: Defaults to true (visible)
   */
  defaultVisible?: boolean;
}

/**
 * Column configuration with flexible syntax.
 * Supports both string shorthand and full object configuration.
 * 
 * - String shorthand: `'fieldName'` - visible by default with default settings
 * - Object syntax: Full control over all column properties
 */
export type ITableColumn = string | ITableColumnConfig;

/**
 * Array of column configurations.
 * Determines column order, visibility, and display properties.
 */
export type ITableColumns = ReadonlyArray<ITableColumn> | Array<ITableColumn>;

/**
 * Entity-level table UI configuration.
 * Controls auto-generation of filters, segments, and other table features for a specific entity.
 */
export interface IEntityTableUIConfig {
  /** Override filter auto-generation for this entity */
  filterAutoGeneration?: Partial<IFilterAutoGenerationConfig>;
  
  /** Override segment auto-generation for this entity */
  segmentAutoGeneration?: Partial<ISegmentAutoGenerationConfig> & {
    /** 
     * Explicitly specify which field(s) to use for segments (highest priority).
     * - Single string: Creates one segment group from that field
     * - Array of strings: Creates multiple groups, one per field
     */
    segmentFields?: string | string[];
    
    /** 
     * @deprecated Use segmentFields (plural) instead for consistency 
     */
    segmentField?: string;
    
    /** Only consider these fields for segment detection */
    includeFields?: string[];
    
    /** Exclude these fields from segment detection */
    excludeFields?: string[];
    
    /** 
     * Only include these enum values in segments (global filter).
     * For field-specific filtering, use includeValuesByField.
     */
    includeValues?: string[];
    
    /**
     * Field-specific value inclusion.
     * @example
     * includeValuesByField: {
     *   status: ['active', 'inactive'],
     *   league: ['nfl', 'nba']
     * }
     */
    includeValuesByField?: Record<string, string[]>;
    
    /** 
     * Exclude these enum values from segments (global filter).
     * For field-specific filtering, use excludeValuesByField.
     */
    excludeValues?: string[];
    
    /**
     * Field-specific value exclusion.
     */
    excludeValuesByField?: Record<string, string[]>;
    
    /** 
     * Global sort order for segment values (applied to all fields).
     * For field-specific sorting, use sortOrderByField.
     */
    sortOrder?: string[];
    
    /**
     * Field-specific sort order for segment values.
     * @example
     * sortOrderByField: {
     *   status: ['active', 'pending', 'inactive'],
     *   priority: ['high', 'medium', 'low']
     * }
     */
    sortOrderByField?: Record<string, string[]>;
    
    /**
     * Custom labels for segment groups (overrides auto-generated labels).
     * @example
     * groupLabels: {
     *   status: 'Filter by Status',
     *   league: 'Select League'
     * }
     */
    groupLabels?: Record<string, string>;
    
    /** Custom icon mapping for this entity's segments */
    iconMapping?: Record<string, string>;
    
    /** Disable auto-generation, require manual segments */
    requireManual?: boolean;
  };
}

/**
 * Section configuration for any page type (list, detail, form, etc.)
 * Allows breaking pages into tabbed or accordion-based sections.
 * 
 * Each section can render a different page type and has access to the parent page's data
 * via `routeParams` (which contains merged parent record/state).
 */
export interface ISectionConfig {
  /** Section label - supports templates (e.g., 'Players ({playerCount})') */
  readonly label: Template;
  /** Optional icon for the section tab/accordion header */
  readonly icon?: string;
  /** Optional badge text - supports templates (e.g., '{errorCount}') */
  readonly badge?: Template;
  /** Visibility conditions for this section */
  readonly visibility?: VisibilityConfig;
  /** Sort order for section display */
  readonly sortOrder?: number;
  
  /** The type of page to render in this section */
  readonly pageType: 'list' | 'details' | 'form' | 'dashboard';
  
  /** 
   * Reference to existing entity config (recommended - avoids duplication)
   * Use this instead of inline configs to reference entity's list/view/create configs with optional overrides.
   * 
   * @example
   * entityConfigRef: {
   *   entityName: 'order',
   *   pageType: 'list',
   *   overrideConfig: {
   *     defaultFilters: { userId: ':userId' }
   *   }
   * }
   */
  readonly entityConfigRef?: IEntityConfigReference;
  
  /** List page config (if pageType === 'list' and not using entityConfigRef) */
  readonly listPageConfig?: ListPageConfigStructure;
  /** Detail page config (if pageType === 'details' and not using entityConfigRef) */
  readonly detailsPageConfig?: {
    readonly title?: string;
    readonly helpText?: string;
    /** If true, section reuses parent's loaded record data (organizational sections) */
    readonly useParentData?: boolean;
    /** API config for fetching data (optional if useParentData is true) */
    readonly detailApiConfig?: DetailsPageConfigStructure['detailApiConfig'];
    /** Column grouping config */
    readonly columnsConfig?: DetailsPageConfigStructure['columnsConfig'];
    /** Properties to display */
    readonly propertiesConfig: ReadonlyArray<DetailsPageConfigStructure['propertiesConfig'][number]> | DetailsPageConfigStructure['propertiesConfig'];
  };
  /** Form page config (if pageType === 'form' and not using entityConfigRef) */
  readonly formPageConfig?: FormPageConfigStructure;
  /** Dashboard config (if pageType === 'dashboard' and not using entityConfigRef) */
  readonly dashboardPageConfig?: DashboardPageConfig['dashboardPageConfig'];
}

/**
 * Section group configuration for organizing sections into cards.
 * Each group renders as a separate card with its own tabs/accordion.
 */
export interface ISectionGroup {
  /** Unique identifier for the group */
  readonly id: string;
  /** Group label/title for the card header - supports templates */
  readonly label?: Template;
  /** Optional icon for the group card header */
  readonly icon?: string;
  /** Visibility conditions for this entire group */
  readonly visibility?: VisibilityConfig;
  /** Sort order for group display */
  readonly sortOrder?: number;
  /** How to render sections within this group: tabs or accordion */
  readonly renderMode?: 'tabs' | 'accordion';
  /** Lazy load section content (only load when activated) */
  readonly lazyLoad?: boolean;
  /** Keep mounted sections in DOM when hidden (preserves state) */
  readonly keepMounted?: boolean;
  /** Sections within this group */
  readonly sections: Record<string, ISectionConfig>;
}

/**
 * Sections configuration for all page types.
 * Enables multi-section pages with tabs or accordion UI.
 * 
 * Supports two formats:
 * 1. Single group (backward compatible): Use `sections` directly
 * 2. Multiple groups: Use `sectionGroups` array
 * 
 * @example
 * // Single group (backward compatible)
 * sectionsConfig: {
 *   renderMode: 'tabs',
 *   sections: {
 *     players: { label: 'Players', pageType: 'list', ... },
 *     metadata: { label: 'Metadata', pageType: 'details', ... }
 *   }
 * }
 * 
 * @example
 * // Multiple groups (new)
 * sectionsConfig: {
 *   sectionGroups: [
 *     {
 *       id: 'basic',
 *       label: 'Basic Info',
 *       icon: 'InfoCircleOutlined',
 *       renderMode: 'tabs',
 *       sections: {
 *         details: { label: 'Details', pageType: 'details', ... },
 *         metadata: { label: 'Metadata', pageType: 'details', ... }
 *       }
 *     },
 *     {
 *       id: 'relations',
 *       label: 'Related Data',
 *       icon: 'LinkOutlined',
 *       visibility: { requiredRoles: ['admin'] },
 *       renderMode: 'accordion',
 *       sections: {
 *         players: { label: 'Players', pageType: 'list', ... },
 *         games: { label: 'Games', pageType: 'list', ... }
 *       }
 *     }
 *   ]
 * }
 */
export interface ISectionsConfig {
  // ===== SINGLE GROUP FORMAT (Backward Compatible) =====
  /** How to render sections: tabs or accordion (for single group format) */
  readonly renderMode?: 'tabs' | 'accordion';
  /** Lazy load section content (for single group format) */
  readonly lazyLoad?: boolean;
  /** Keep mounted sections in DOM when hidden (for single group format) */
  readonly keepMounted?: boolean;
  /** Sections to render (single group format - backward compatible) */
  readonly sections?: Record<string, ISectionConfig>;
  
  // ===== MULTIPLE GROUPS FORMAT (New) =====
  /** Array of section groups (each renders as a separate card) */
  readonly sectionGroups?: ReadonlyArray<ISectionGroup> | Array<ISectionGroup>;
  
  // ===== COMMON PROPERTIES =====
  /** Position relative to main content (not yet implemented) */
  readonly position?: 'below' | 'right';
  
  /** 
   * Maximum nesting depth for sections (default: 4).
   * Prevents infinite recursion when sections reference pages with their own sections.
   * When depth is exceeded, a warning is shown instead of rendering nested sections.
   */
  readonly maxDepth?: number;
}

export interface EntityListPageConfig {
  readonly actions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>;
  readonly breadcrumbs?: ReadonlyArray<{ label: Template; url?: string }> | Array<{ label: Template; url?: string }>;
  readonly defaultSort?: { readonly field: string; readonly order: 'asc' | 'desc' } | ReadonlyArray<{ readonly field: string; readonly order: 'asc' | 'desc' }> | 'asc' | 'desc';
  /**
   * Additional sections to display below or alongside the main list table.
   * Enables multi-section pages with tabs or accordion UI.
   */
  readonly sectionsConfig?: ISectionsConfig;
  readonly tableConfig?: {
    readonly rowActions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>;
    readonly bulkActions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>;
    readonly rowSelection?: {
      enabled: boolean;
      visibility?: VisibilityConfig;
    };
    /**
     * Column configuration with flexible syntax for improved developer experience.
     * 
     * **Syntax Options:**
     * 1. **String shorthand**: `'fieldName'` - visible by default with default settings
     * 2. **Object syntax**: Full control over width, visibility, grouping, etc.
     * 
     * **Behavior:**
     * - Fields listed here determine column order in the table
     * - `defaultVisible` defaults to `true` if not specified
     * - Fields not listed become hidden but available in Column Settings
     * - If `columns` is not defined, all `isListable` fields are visible (backward compatible)
     * 
     * **Column Grouping:**
     * - Set `groupTitle` on multiple columns to group them under a common header
     * - Columns with the same `groupTitle` will be grouped together
     * - Uses Ant Design's native `children` property
     * 
     * @example
     * // Clean and simple - most common case
     * columns: [
     *   'orderId',           // Visible with defaults
     *   'orderDate',         // Visible with defaults
     *   'status',            // Visible with defaults
     * ]
     * 
     * @example
     * // Mixed syntax with full control
     * columns: [
     *   'orderId',                              // Visible, default width
     *   { field: 'total', width: 150 },         // Visible, custom width
     *   { field: 'playerName', groupTitle: 'Player Info' },  // Visible, grouped
     *   { field: 'metadata', defaultVisible: false }         // Hidden but ordered
     * ]
     * 
     * @example
     * // Column grouping
     * columns: [
     *   { field: 'playerName', groupTitle: 'Player Info' },
     *   { field: 'position', groupTitle: 'Player Info' },
     *   { field: 'jerseyNumber', groupTitle: 'Player Info' },
     *   { field: 'points', groupTitle: 'Statistics' },
     *   { field: 'assists', groupTitle: 'Statistics', defaultVisible: false },
     *   'email'  // No group - stays ungrouped
     * ]
     */
    readonly columns?: ITableColumns;
    /**
     * Controls how column data is fetched from the API.
     * 
     * - `'eager'` (default): Fetches all `isListable` columns in a single request.
     *   Users can instantly toggle column visibility without additional API calls.
     *   Recommended for most admin panels and data tables.
     * 
     * - `'lazy'`: Only fetches visible columns initially. When users show hidden columns,
     *   the table will refetch data with the new column set.
     *   Use for tables with 50+ columns or expensive computed fields.
     * 
     * @default 'eager'
     * 
     * @example
     * // Eager fetching (default) - fetch all columns upfront
     * fetchStrategy: 'eager'
     * 
     * @example
     * // Lazy fetching - only fetch visible columns
     * fetchStrategy: 'lazy'
     */
    readonly fetchStrategy?: 'eager' | 'lazy';
    /**
     * Expandable row configuration.
     * Allows displaying nested data within table rows.
     * 
     * Common use case: Show to-many relations (e.g., Team → Players)
     */
    readonly expandable?: ITableExpandableConfig;
    
    /**
     * Filter segments (quick filter tabs) displayed above the table.
     * Provides quick access to common filter sets.
     * 
     * Supports two formats:
     * 1. Flat array (legacy): Single group of segments
     * 2. Grouped array: Multiple independent segment groups
     * 
     * Supports placeholder syntax for dynamic values:
     * - `:actor.actorId` - Current user ID
     * - `:startOfToday` - Date expressions
     * - `:paramName` - Route parameters
     * 
     * @example
     * // Legacy flat format (single group)
     * segments: [
     *   { id: 'all', label: 'All Items', filters: {}, default: true },
     *   { id: 'active', label: 'Active', icon: 'check', filters: { status: { eq: 'active' } } },
     *   { id: 'my-items', label: 'My Items', filters: { createdBy: ':actor.actorId' } }
     * ]
     * 
     * @example
     * // Grouped format (multiple independent groups)
     * segments: [
     *   {
     *     id: 'status-group',
     *     label: 'By Status',
     *     segments: [
     *       { id: 'all-status', label: 'All', filters: {}, default: true },
     *       { id: 'active', label: 'Active', filters: { status: { eq: 'active' } } }
     *     ]
     *   },
     *   {
     *     id: 'league-group',
     *     label: 'By League',
     *     segments: [
     *       { id: 'all-league', label: 'All', filters: {} },
     *       { id: 'nfl', label: 'NFL', filters: { league: { eq: 'nfl' } } }
     *     ]
     *   }
     * ]
     */
    readonly segments?: ReadonlyArray<IFilterSegment | IFilterSegmentGroup> | Array<IFilterSegment | IFilterSegmentGroup>;
  };
}

/**
 * View page nested configuration (RECOMMENDED)
 * Replaces: viewPageActions, viewPageBreadcrumbs, viewPageColumnsConfig
 */
export interface EntityViewPageConfig {
  readonly actions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>;
  readonly breadcrumbs?: ReadonlyArray<{ label: Template; url?: string }> | Array<{ label: Template; url?: string }>;
  readonly columnsConfig?: IEntityPageColumnConfig;
  readonly fields?: ReadonlyArray<{
    name: string;
    visibility?: VisibilityConfig;
    helpText?: string;
  }> | Array<{
    name: string;
    visibility?: VisibilityConfig;
    helpText?: string;
  }>;
  /**
   * Additional sections to display below or alongside the main detail view.
   * Enables multi-section detail pages with tabs or accordion UI.
   * 
   * Sections have access to the parent record via routeParams.
   * Use `useParentData: true` in detailsPageConfig for organizational sections
   * that display parts of the same record (e.g., metadata, large JSON fields).
   */
  readonly sectionsConfig?: ISectionsConfig;
}

/**
 * Edit page nested configuration (RECOMMENDED)
 * Replaces: editPageActions, editPageBreadcrumbs, editPageColumnsConfig
 */
export interface EntityEditPageConfig {
  readonly actions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>;
  readonly breadcrumbs?: ReadonlyArray<{ label: Template; url?: string }> | Array<{ label: Template; url?: string }>;
  readonly columnsConfig?: IEntityPageColumnConfig;
  readonly formConfig?: {
    readonly buttons?: ReadonlyArray<{
      id?: string;  // Identifier for override matching
      text: string;
      action: 'submit' | 'reset' | 'cancel';
      url?: string;
      visibility?: VisibilityConfig;
    }> | Array<{
      id?: string;
      text: string;
      action: 'submit' | 'reset' | 'cancel';
      url?: string;
      visibility?: VisibilityConfig;
    }>;
    readonly fields?: ReadonlyArray<{
      name: string;
      visibility?: VisibilityConfig;
      enablement?: VisibilityConfig;
      helpText?: string;
      placeholder?: string;
    }> | Array<{
      name: string;
      visibility?: VisibilityConfig;
      enablement?: VisibilityConfig;
      helpText?: string;
      placeholder?: string;
    }>;
  };
  /**
   * Additional sections to display below or alongside the main form.
   * Enables multi-section edit pages with tabs or accordion UI.
   * 
   * Sections have access to the parent record and live formValues via routeParams.
   * Use for features like live preview, help documentation, or related data.
   */
  readonly sectionsConfig?: ISectionsConfig;
}

/**
 * Create page nested configuration (RECOMMENDED)
 * Replaces: createPageBreadcrumbs, createPageColumnsConfig
 */
export interface EntityCreatePageConfig {
  readonly breadcrumbs?: ReadonlyArray<{ label: Template; url?: string }> | Array<{ label: Template; url?: string }>;
  readonly columnsConfig?: IEntityPageColumnConfig;
  readonly formConfig?: {
    readonly buttons?: ReadonlyArray<{
      id?: string;  // Identifier for override matching
      text: string;
      action: 'submit' | 'reset' | 'cancel';
      url?: string;
      visibility?: VisibilityConfig;
    }> | Array<{
      id?: string;
      text: string;
      action: 'submit' | 'reset' | 'cancel';
      url?: string;
      visibility?: VisibilityConfig;
    }>;
    readonly fields?: ReadonlyArray<{
      name: string;
      visibility?: VisibilityConfig;
      helpText?: string;
      placeholder?: string;
    }> | Array<{
      name: string;
      visibility?: VisibilityConfig;
      helpText?: string;
      placeholder?: string;
    }>;
  };
  /**
   * Additional sections to display below or alongside the create form.
   * Enables multi-section create pages with tabs or accordion UI.
   * 
   * Sections have access to live formValues via routeParams.
   * Use for features like live preview or help documentation.
   */
  readonly sectionsConfig?: ISectionsConfig;
}

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
      
      /** 
       * Entity-level duplicated field detection configuration.
       * Overrides global settings for this specific entity.
       * 
       * @example
       * duplicatedFieldDetection: {
       *   prefixes: ['home', 'away', 'opponent'],  // Add custom prefixes
       *   templateStyle: 'simple'                   // Override global style
       * }
       */
      duplicatedFieldDetection?: {
        /** Enable/disable detection for this entity. Overrides global setting. */
        enabled?: boolean;
        /** Override suffix patterns for this entity */
        suffixes?: {
          display?: string[];
          visual?: string[];
          meta?: string[];
        };
        /** Override recognized prefixes for this entity */
        prefixes?: string[];
        /** Override template style for this entity */
        templateStyle?: 'simple' | 'composite';
        /** Override confidence threshold for this entity */
        confidenceThreshold?: 'low' | 'medium' | 'high';
      };
      
      /**
       * Table UI auto-generation overrides for this entity.
       * Controls automatic generation of filters, segments, and other table features.
       * 
       * @example
       * tableUI: {
       *   segmentAutoGeneration: {
       *     segmentField: 'status',
       *     iconMapping: { 'active': 'check-circle', 'paused': 'pause-circle' }
       *   }
       * }
       */
      tableUI?: IEntityTableUIConfig;
    };

    // Menu configuration
    readonly menuGroup?: string; // Group this entity belongs to in the menu
    readonly menuOrder?: number; // Order within the group (default: 0)

    // Create page configuration
    /**
     * @deprecated Use createPageConfig.breadcrumbs instead
     */
    readonly createPageBreadcrumbs?: ReadonlyArray<{ label: string; url?: string }> | Array<{ label: string; url?: string }>,
    /**
     * @deprecated Use createPageConfig.columnsConfig instead
     */
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
     * 
     * @deprecated Use listPageConfig.actions instead
     */
    readonly listPageActions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>,
    /**
     * @deprecated Use listPageConfig.breadcrumbs instead
     */
    readonly listPageBreadcrumbs?: ReadonlyArray<{ label: string; url?: string }> | Array<{ label: string; url?: string }>,
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
     * 
     * @deprecated Use listPageConfig.defaultSort {@link EntityListPageConfig.defaultSort} instead
     */
    readonly listPageDefaultSort?: { readonly field: string; readonly order: 'asc' | 'desc' } | ReadonlyArray<{ readonly field: string; readonly order: 'asc' | 'desc' }> | 'asc' | 'desc',
    
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
     * 
     * @deprecated Use viewPageConfig.actions instead
     */
    readonly viewPageActions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>,
    /**
     * @deprecated Use viewPageConfig.breadcrumbs instead
     */
    readonly viewPageBreadcrumbs?: ReadonlyArray<{ label: string; url?: string }> | Array<{ label: string; url?: string }>,
    /**
     * @deprecated Use viewPageConfig.columnsConfig instead
     */
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
    /**
     * @deprecated Use editPageConfig.actions instead
     */
    readonly editPageActions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>,
    /**
     * @deprecated Use editPageConfig.breadcrumbs instead
     */
    readonly editPageBreadcrumbs?: ReadonlyArray<{ label: string; url?: string }> | Array<{ label: string; url?: string }>,
    /**
     * @deprecated Use editPageConfig.columnsConfig instead
     */
    readonly editPageColumnsConfig?: IEntityPageColumnConfig,
    
    /**
     * NEW NESTED STRUCTURE (RECOMMENDED)
     * 
     * These nested configs provide better organization and support for the universal
     * evaluation system, including visibility/enablement configs for actions, form
     * buttons, fields, and more.
     */
    
    /**
     * List page nested configuration
     * Replaces: listPageActions, listPageBreadcrumbs, listPageDefaultSort
     */
    readonly listPageConfig?: EntityListPageConfig;
    
    /**
     * View page nested configuration
     * Replaces: viewPageActions, viewPageBreadcrumbs, viewPageColumnsConfig
     */
    readonly viewPageConfig?: EntityViewPageConfig;
    
    /**
     * Edit page nested configuration
     * Replaces: editPageActions, editPageBreadcrumbs, editPageColumnsConfig
     */
    readonly editPageConfig?: EntityEditPageConfig;
    
    /**
     * Create page nested configuration
     * Replaces: createPageBreadcrumbs, createPageColumnsConfig
     */
    readonly createPageConfig?: EntityCreatePageConfig;

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

/**
 * Utility type to infer ElectroDB Entity type from an entity schema.
 * Extracts the Entity type with proper generic parameters from the schema.
 * 
 * @template TSchema - The entity schema type
 * @example
 * ```ts
 * const teamSchema = createEntitySchema({...});
 * type TeamEntity = EntityTypeFromSchema<typeof teamSchema>;
 * ```
 */
export type EntityTypeFromSchema<TSchema> = TSchema extends EntitySchema<infer A, infer F, infer C>
  ? Entity<A, F, C, TSchema>
  : never;

/**
 * Utility type to infer ElectroDB ResponseItem type from an entity schema.
 * ResponseItem is the type returned by ElectroDB query operations.
 * 
 * @template TSchema - The entity schema type
 * @example
 * ```ts
 * const teamSchema = createEntitySchema({...});
 * type TeamResponse = EntityResponseItemTypeFromSchema<typeof teamSchema>;
 * ```
 */
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


/**
 * Utility type for ElectroDB upsert item type from Entity.
 * @internal
 */
export type UpsertEntityItem<E extends Entity<any, any, any, any>> =
  E extends Entity<infer A, infer F, infer C, infer S>
  ? UpsertItem<A, F, C, S>
  : never;

/**
 * Utility type to infer the entity record type from an entity schema.
 * This is the type of actual record instances (with all computed properties).
 * 
 * @template Sch - The entity schema type
 * @example
 * ```ts
 * const teamSchema = createEntitySchema({...});
 * type TeamRecord = EntityRecordTypeFromSchema<typeof teamSchema>;
 * // Use for typed record instances
 * const team: TeamRecord = { teamId: '123', teamName: 'Lakers', ... };
 * ```
 */
export type EntityRecordTypeFromSchema<Sch extends EntitySchema<any, any, any>> = EntityItem<EntityTypeFromSchema<Sch>>;

/**
 * Utility type to infer the entity service type from an entity schema.
 * Used for type-safe service references in dependency injection.
 * 
 * @template TSchema - The entity schema type
 * @example
 * ```ts
 * const teamSchema = createEntitySchema({...});
 * type TeamService = EntityServiceTypeFromSchema<typeof teamSchema>;
 * ```
 */
export type EntityServiceTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = BaseEntityService<TSchema>;

/**
 * Utility type to infer the entity identifiers type from an entity schema.
 * Used for get/delete operations that require entity identifiers.
 * 
 * @template TSchema - The entity schema type
 * @example
 * ```ts
 * const teamSchema = createEntitySchema({...});
 * type TeamIdentifiers = EntityIdentifiersTypeFromSchema<typeof teamSchema>;
 * // Use for get/delete operations
 * const ids: TeamIdentifiers = { teamId: '123' };
 * await teamService.get(ids);
 * ```
 */
export type EntityIdentifiersTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<EntityIdentifiers<EntityTypeFromSchema<TSchema>>>;

/**
 * Utility type to infer the create entity item type from an entity schema.
 * Used for type-safe entity creation operations.
 * 
 * @template TSchema - The entity schema type
 * @example
 * ```ts
 * const teamSchema = createEntitySchema({...});
 * type CreateTeam = CreateEntityItemTypeFromSchema<typeof teamSchema>;
 * const newTeam: CreateTeam = {
 *   teamName: 'Lakers',
 *   city: 'Los Angeles'
 * };
 * await teamService.create(newTeam);
 * ```
 */
export type CreateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<CreateEntityItem<EntityTypeFromSchema<TSchema>>>;

/**
 * Utility type to infer the upsert entity item type from an entity schema.
 * Used for type-safe entity upsert operations (create or update).
 * 
 * @template TSchema - The entity schema type
 * @example
 * ```ts
 * const teamSchema = createEntitySchema({...});
 * type UpsertTeam = UpsertEntityItemTypeFromSchema<typeof teamSchema>;
 * const teamData: UpsertTeam = {
 *   teamId: '123',
 *   teamName: 'Lakers',
 *   city: 'Los Angeles'
 * };
 * await teamService.upsert(teamData);
 * ```
 */
export type UpsertEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<UpsertEntityItem<EntityTypeFromSchema<TSchema>>>;

/**
 * Utility type to infer the update entity item type from an entity schema.
 * Used for type-safe entity update operations.
 * 
 * @template TSchema - The entity schema type
 * @example
 * ```ts
 * const teamSchema = createEntitySchema({...});
 * type UpdateTeam = UpdateEntityItemTypeFromSchema<typeof teamSchema>;
 * const updates: UpdateTeam = {
 *   city: 'Los Angeles'  // Only fields being updated
 * };
 * await teamService.update({ teamId: '123' }, updates);
 * ```
 */
export type UpdateEntityItemTypeFromSchema<TSchema extends EntitySchema<any, any, any>> = Writable<UpdateEntityItem<EntityTypeFromSchema<TSchema>>>;