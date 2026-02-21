import type { EntityConfiguration, Schema, EntityIdentifiers, CreateEntityItem, UpdateEntityItem, EntityItem, Attribute, ResponseItem, UpsertItem } from "electrodb";
import { createSchema, Entity } from "electrodb";

import type { EntityQuery, FilterOperatorsExtended, EntityFilterCriteria, EntitySelections } from './query-types';
import type { BaseEntityService } from "./base-service";
import type { ExecutionContext } from '../core/types/execution-context';
import type {
  CreateEntityResponse,
  UpdateEntityResponse,
  UpsertEntityResponse,
  DeleteEntityResponse,
  UpdateEntityOperators
} from './crud-service';
import type { SearchResult } from '../search/types';
import type { OmitNever, Paths, Writable } from "../utils/types";
import { SearchIndexConfig } from '../search/types';
import { EntitySearchService } from '../search/services';
import { DepIdentifier, IFilterAutoGenerationConfig, ISegmentAutoGenerationConfig } from "../interfaces";
import type { FormPageConfigStructure, ListPageConfigStructure, DetailsPageConfigStructure, DashboardPageConfig, AccordionPageConfig, WizardPageConfigStructure, CustomPageConfigStructure } from '../ui-config-gen/templates/custom-page';
import type { HttpRequestValidations, InputValidationRule } from "../validation";

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
  [ K in keyof E[ 'attributes' ] ]: E[ 'attributes' ][ K ][ 'hidden' ] extends true ? never : K
}[ keyof E[ 'attributes' ] ];

/**
 * Utility type to extract only writable (non-readonly) attribute keys from an entity schema
 */
export type WritableAttributeKeys<E extends EntitySchema<any, any, any, any>> = {
  [ K in keyof E[ 'attributes' ] ]: E[ 'attributes' ][ K ][ 'readOnly' ] extends true ? never : K
}[ keyof E[ 'attributes' ] ];

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

  /**
   * Enable compression for this attribute.
   * 
   * **Usage:**
   * - `compressed: true` - Use default threshold (10KB)
   * - `compressed: { threshold: 50 * 1024 }` - Custom threshold (50KB)
   * 
   * **Behavior:**
   * - Write: Automatically compresses if size exceeds threshold
   * - Read: Automatically decompresses when loading from DB
   * - Storage: Creates `{ _compressed: true, _algorithm: 'gzip', _data: base64, ... }`
   * - UI: UI24 recognizes `_compressed` marker and auto-decompresses for display
   * 
   * **Recommended for:**
   * - Large JSON payloads (e.g., `metadata`, `data`, `context`)
   * - API responses stored in DB
   * - Nested objects with deep structures
   * 
   * @example
   * ```ts
   * attributes: {
   *   apiResponse: {
   *     type: 'any',
   *     compressed: true  // Auto-compress if > 10KB
   *   },
   *   largeMetadata: {
   *     type: 'map',
   *     compressed: { threshold: 50 * 1024 }  // Compress if > 50KB
   *   }
   * }
   * ```
   */
  readonly compressed?: boolean | { threshold: number };
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
  | TimeFieldMetadata | DateTimeFieldMetadata | DurationFieldMetadata | TTLFieldMetadata | BooleanFieldMetadata
  | SelectFieldMetadata | RadioFieldMetadata | CheckboxFieldMetadata
  | FileFieldMetadata | RangeFieldMetadata | SliderFieldMetadata | ColorFieldMetadata
  | ImageFieldMetadata | VideoFieldMetadata | AudioFieldMetadata
  | BadgeFieldMetadata | TagFieldMetadata | ProgressFieldMetadata | AvatarFieldMetadata | IconFieldMetadata
  | LinkFieldMetadata | QRCodeFieldMetadata
  | HiddenFieldMetadata | CustomFieldMetadata
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
  /** @deprecated Optional - presence of linkConfig is sufficient to indicate a link */
  isLink?: boolean;
  /**
   * Link configuration for rendering field as internal link (non-relation fields)
   * When isLink is true, the field will be rendered as a link using linkConfig
   */
  linkConfig?: {
    routePattern: string;
    /** Display text for the link - supports templates like "View {entityName}: {entityId}" */
    displayText?: Template;
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
   * Custom renderer key for this field.
   * When specified, the frontend uses this key to look up a registered custom renderer
   * via ExtensionRegistry.getFieldRenderer().
   * 
   * This enables custom field rendering in forms, details pages, and table columns.
   * The renderer must be registered in the frontend before use.
   * 
   * Supports `ConditionalValue<string>` for runtime component swapping based on
   * device, feature flags, A/B experiments, or any evaluation context data.
   * 
   * @example
   * // Static renderer
   * address: {
   *   type: 'map',
   *   fieldType: 'json',
   *   renderer: 'address-picker',
   *   rendererConfig: { country: 'US' }
   * }
   * 
   * // Conditional renderer (A/B test or device adaptation)
   * description: {
   *   type: 'string',
   *   renderer: {
   *     rules: [
   *       { when: { device: { isMobile: { eq: true } } }, value: 'simple-textarea' },
   *       { when: { featureFlags: { richText: { eq: true } } }, value: 'rich-text-editor' },
   *     ],
   *     default: 'text-input',
   *   }
   * }
   * 
   * // Frontend registration
   * ExtensionRegistry.registerFieldRenderer({
   *   key: 'address-picker',
   *   contexts: ['form', 'detail'],
   *   component: GoogleAddressPicker
   * });
   */
  renderer?: string | ConditionalValue<string>;

  /**
   * Configuration passed to the custom renderer.
   * Only used when `renderer` is specified.
   * The config is passed as-is to the custom renderer component.
   */
  rendererConfig?: Record<string, unknown>;

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
export type ModalType = "confirm" | "list" | "form" | "accordion" | "custom" | "details" | "dashboard" | "wizard";

/**
 * Navigation options for success redirects after form/modal submission.
 * Shared by modal configs, drawer configs, and the ui24 OperationExecutor.
 *
 * - `replace` / `state` — react-router NavigateOptions for internal URLs
 * - `target` — open external URLs in a new tab (e.g. OAuth flows)
 */
export interface IRedirectOptions {
  replace?: boolean;
  state?: unknown;
  /** Open redirect URL in a new browser tab. Use '_blank' for external URLs (e.g. OAuth flows). */
  target?: '_blank' | '_self';
}

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
 * Drawer configuration for page actions.
 * 
 * Similar to IEntityPageActionModalConfig but with drawer-specific presentation properties.
 * Both drawer and modal share the same page config types (form, list, details, confirm).
 * 
 * Supports two patterns:
 * 1. **Route resolution**: Use with url or drawerConfigRef
 * 2. **Inline config**: Use drawerType + drawerPageConfig (same as modalType + modalPageConfig)
 * 
 * @see {@link IEntityPageActionModalConfig} for the modal equivalent
 */
export interface IEntityPageActionDrawerConfig {
  // =========================================================================
  // DRAWER-SPECIFIC PRESENTATION PROPERTIES
  // =========================================================================

  /** Drawer title (supports templates like 'Edit {teamName}') */
  title?: Template;
  /** Drawer placement (drawer-specific, modals don't have this) */
  placement?: 'left' | 'right' | 'top' | 'bottom';
  /** Drawer width (for left/right placement) */
  width?: number | string;
  /** Drawer height (for top/bottom placement, drawer-specific) */
  height?: number | string;
  /** Show close button */
  closable?: boolean;
  /** Show mask overlay */
  mask?: boolean;
  /** Close on mask click */
  maskClosable?: boolean;
  /** Destroy content on close */
  destroyOnClose?: boolean;

  // =========================================================================
  // SHARED PAGE CONFIG (SAME AS MODAL)
  // =========================================================================

  /** Page type to render (same as modalType) */
  drawerType?: Omit<ModalType, 'confirm'>;

  /** Page configuration (same as modalPageConfig) */
  drawerPageConfig?: FormPageConfigStructure | ListPageConfigStructure | DetailsPageConfigStructure | DashboardPageConfig | AccordionPageConfig | WizardPageConfigStructure | CustomPageConfigStructure;

  // =========================================================================
  // SHARED API/NAVIGATION CONFIG (SAME AS MODAL)
  // =========================================================================

  /** EITHER: Make API call */
  apiConfig?: IModalApiConfig;
  submitSuccessRedirect?: string;
  submitSuccessRedirectOptions?: IRedirectOptions;

  /** OR: Navigate without API call */
  navigateTo?: INavigateToConfig | string;

  /** Display API response in a modal */
  responseConfig?: IResponseDisplayConfig;

  /** Dynamic config key for chaining operations */
  dynamicConfigKey?: string;

  /**
   * Control drawer closing behavior on error
   * - true: Close drawer immediately on error
   * - false (default): Keep drawer open so user can fix and retry
   */
  closeDrawerOnError?: boolean;

  /** Skip toast notifications */
  skipSuccessToast?: boolean;
  skipErrorToast?: boolean;

  /**
   * Pre-populate form fields from context (route params + record data).
   * Same as modalConfig.initialValues - see IEntityPageActionModalConfig for full documentation.
   */
  initialValues?: Record<string, any>;

  /** Refresh parent component after success */
  refreshParentOnSuccess?: boolean;

  /** Custom success message template */
  successMessage?: Template;

  /** Custom error message template */
  errorMessage?: Template;
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

  /** Width of response modal in pixels. Default: 707 */
  modalWidth?: number;

  /** OPTION 1: Render response using existing page type system (recommended) */
  pageType?: 'form' | 'details' | 'list' | 'dashboard' | 'accordion';
  pageConfig?: FormPageConfigStructure | DetailsPageConfigStructure | ListPageConfigStructure | DashboardPageConfig | AccordionPageConfig;

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

    /**
     * Override filter segments completely (for list pages).
     * When provided, replaces all segments from base config.
     * Set to empty array [] to disable segments entirely.
     * 
     * @example
     * // Disable segments (useful in modal/section contexts)
     * segments: []
     * 
     * @example
     * // Replace with custom segments
     * segments: [
     *   { id: 'active', label: 'Active', filters: { status: { eq: 'active' } } },
     *   { id: 'inactive', label: 'Inactive', filters: { status: { eq: 'inactive' } } }
     * ]
     */
    segments?: ReadonlyArray<IFilterSegment | IFilterSegmentGroup> | Array<IFilterSegment | IFilterSegmentGroup>;

    /**
     * Hide specific segments by ID (for list pages).
     * Keeps all other segments from base config.
     * 
     * @example
     * hideSegments: ['root-only', 'child-only']
     */
    hideSegments?: ReadonlyArray<string> | Array<string>;

    /**
     * Show only these segments by ID (for list pages).
     * Mutually exclusive with hideSegments.
     * 
     * @example
     * showOnlySegments: ['all-levels', 'errors']
     */
    showOnlySegments?: ReadonlyArray<string> | Array<string>;

    /**
     * Add additional segments to base config (for list pages).
     * Merged with base segments using mergeSegments logic (ID-based override).
     * 
     * @example
     * additionalSegments: [
     *   { id: 'archived', label: 'Archived', filters: { archived: { eq: true } } }
     * ]
     */
    additionalSegments?: ReadonlyArray<IFilterSegment | IFilterSegmentGroup> | Array<IFilterSegment | IFilterSegmentGroup>;

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
  modalPageConfig?: IConfirmModal | FormPageConfigStructure | ListPageConfigStructure | DetailsPageConfigStructure | DashboardPageConfig | AccordionPageConfig | WizardPageConfigStructure | CustomPageConfigStructure;

  /** EITHER: Make API call (existing pattern) */
  apiConfig?: IModalApiConfig;
  submitSuccessRedirect?: string;
  submitSuccessRedirectOptions?: IRedirectOptions;

  /** OR: Navigate without API call (new pattern) */
  navigateTo?: INavigateToConfig | string;  // String shorthand: "/list-game?status={status}"

  /** OPTIONAL: Display API response in a modal (instead of just toast notification)
   * Note: Only applies when apiConfig is present. Ignored for navigateTo.
   */
  responseConfig?: IResponseDisplayConfig;

  /**
   * Dynamic Configuration Extraction for Chaining/Wizard Flows
   * If provided, OperationExecutor looks for next-step config in the API response.
   * Useful for backend-driven wizards where each step is determined by the previous response.
   * 
   * @example
   * // Backend entity action config
   * dynamicConfigKey: 'nextStep'
   * 
   * // Backend API returns:
   * {
   *   success: true,
   *   data: { userId: '123', email: 'user@example.com' },
   *   nextStep: {
   *     modalType: 'form',
   *     modalPageConfig: {
   *       title: 'Verify Email',
   *       propertiesConfig: [...],
   *       apiConfig: { apiUrl: '/verify-email', apiMethod: 'POST' }
   *     }
   *   }
   * }
   * 
   * // Result: Response modal opens with form, pre-filled with user data
   */
  dynamicConfigKey?: string;

  /**
   * Control modal closing behavior on error
   * - true: Close modal immediately on error
   * - false (default): Keep modal open so user can fix and retry
   */
  closeModalOnError?: boolean;

  /**
   * Skip showing success toast notification
   * Useful when responseConfig.showModal is true (avoid duplicate notifications)
   */
  skipSuccessToast?: boolean;

  /**
   * Skip showing error toast notification
   * Useful when you want custom error handling via callbacks
   */
  skipErrorToast?: boolean;

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
 * Evaluation rule — a single comparison against a value.
 * Used inside both Condition (UI control) and validation (server-side data integrity).
 * 
 * Aligned with ValidationRule<T> pattern from validation/types.ts
 * 
 * @template T - The type of value being evaluated
 */
export type EvaluationRule<T = any> = {
  // Equality
  readonly eq?: T | TemplateRef;
  readonly neq?: T | TemplateRef;

  // Comparison
  readonly gt?: T | TemplateRef;
  readonly gte?: T | TemplateRef;
  readonly lt?: T | TemplateRef;
  readonly lte?: T | TemplateRef;
  /** Inclusive range check: value >= min && value <= max */
  readonly between?: readonly [ T | TemplateRef, T | TemplateRef ];

  // Membership
  readonly inList?: ReadonlyArray<T>;
  readonly notInList?: ReadonlyArray<T>;

  // Existence
  readonly exists?: boolean;
  readonly empty?: boolean;

  // Pattern / String
  /** Regular expression pattern */
  readonly pattern?: string;
  /** Case-insensitive substring match */
  readonly contains?: string;

  // Custom (registered function name — triggers async evaluation)
  readonly custom?: string;
};

// =============================================================================
// NEW CONDITION SYSTEM — Unified Condition & Evaluation Types
// See: docs/CONDITION_SYSTEM_DESIGN.md
// =============================================================================

/**
 * Inline condition — the primary workhorse of the condition system.
 * Each field checks a category of runtime data. All fields present are implicitly ANDed.
 * 
 * Inline field-level condition with categories for actor, device, tenant,
 * featureFlags, and an extensible index signature for app-defined fields.
 * 
 * @example
 * // Admin who is on desktop
 * { actor: { groups: { inList: ['admin'] } }, device: { isDesktop: { eq: true } } }
 * 
 * @example
 * // App-defined subscription check
 * { subscription: { tier: { inList: ['pro', 'enterprise'] } } }
 */
export type InlineCondition = {
  // Tier 1: App-level (rarely changes)
  readonly actor?: { readonly [ path: string ]: EvaluationRule };
  readonly featureFlags?: { readonly [ flag: string ]: EvaluationRule<boolean | string> };
  readonly device?: {
    readonly isMobile?: EvaluationRule<boolean>;
    readonly isTablet?: EvaluationRule<boolean>;
    readonly isDesktop?: EvaluationRule<boolean>;
    readonly viewport?: EvaluationRule<'xs' | 'sm' | 'md' | 'lg' | 'xl'>;
  };
  readonly tenant?: { readonly [ path: string ]: EvaluationRule };

  // Tier 2: Page-level (changes on navigation)
  readonly context?: {
    readonly pageType?: EvaluationRule<string>;
    readonly modalDepth?: EvaluationRule<number>;
    readonly entityName?: EvaluationRule<string>;
    readonly [ key: string ]: EvaluationRule | undefined;
  };
  readonly queryParams?: { readonly [ key: string ]: EvaluationRule };

  // Tier 3-5: Dynamic (changes on interaction)
  readonly record?: { readonly [ path: string ]: EvaluationRule };
  readonly formValues?: { readonly [ path: string ]: EvaluationRule };
  readonly selectedRecords?: {
    readonly length?: EvaluationRule<number>;
    readonly all?: { readonly [ path: string ]: EvaluationRule };
    readonly some?: { readonly [ path: string ]: EvaluationRule };
    readonly none?: { readonly [ path: string ]: EvaluationRule };
  };

  // App-defined fields (extensible) — any key not listed above is treated as
  // an app-defined context category. The evaluator looks up the key in
  // EvaluationContext and applies rules against it.
  // Using `any` because known fields have complex nested types that TypeScript's
  // index signature can't reconcile with a single union type.
  readonly [ key: string ]: any;
};

/**
 * Condition — a boolean expression used for visibility, enablement, expandability, etc.
 * Single type used everywhere for boolean outcomes.
 * 
 * The core boolean expression type for visibility, enablement, expandability, etc.
 * 
 * @example
 * // Inline — role check
 * { actor: { groups: { inList: ['admin'] } } }
 * 
 * @example
 * // Logical composition
 * { and: [
 *   { actor: { groups: { inList: ['admin'] } } },
 *   { selectedRecords: { length: { gt: 0 } } },
 *   { not: { featureFlags: { maintenanceMode: { eq: true } } } }
 * ] }
 * 
 * @example
 * // Named condition reference
 * { ref: 'canEdit' }
 * 
 * @example
 * // Boolean literal
 * false
 */
export type Condition =
  | InlineCondition
  | { readonly custom: string }
  | { readonly ref: string }
  | { readonly and: ReadonlyArray<Condition> }
  | { readonly or: ReadonlyArray<Condition> }
  | { readonly not: Condition }
  | boolean;

/**
 * A value that depends on conditions. For when the outcome isn't true/false
 * but a resolved value — a component name, label, CSS class, etc.
 * 
 * Rules are evaluated top-to-bottom. First matching rule wins. If none match, `default` is returned.
 * 
 * @template T - The type of value being resolved
 * 
 * @example
 * // Conditional renderer based on device
 * {
 *   rules: [
 *     { when: { device: { isMobile: { eq: true } } }, value: 'SimpleTextArea' },
 *     { when: { featureFlags: { richText: { eq: true } } }, value: 'RichTextEditor' }
 *   ],
 *   default: 'TextInput'
 * }
 */
export type ConditionalValue<T> = {
  readonly rules: ReadonlyArray<{
    readonly when: Condition;
    readonly value: T;
  }>;
  readonly default: T;
};

/**
 * Type guard for ConditionalValue<T>.
 * Checks structure (rules array with when/value items + default) rather than just property names.
 */
export function isConditionalValue<T> ( value: unknown ): value is ConditionalValue<T> {
  if ( !value || typeof value !== 'object' ) return false;
  const obj = value as Record<string, any>;
  if ( !Array.isArray( obj.rules ) || !( 'default' in obj ) ) return false;
  if ( obj.rules.length > 0 ) {
    const first = obj.rules[ 0 ];
    return first && typeof first === 'object' && 'when' in first && 'value' in first;
  }
  return true; // empty rules + default is valid
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

  /**
   * Tooltip text (shown on hover).
   * Can be static string or dynamic template evaluated from routeParams/record context.
   * 
   * @example
   * // Static tooltip
   * tooltip: 'View all child spans'
   * 
   * @example
   * // Dynamic tooltip
   * tooltip: 'View trace for {correlationId}'
   * 
   * @example
   * // Complex template
   * tooltip: {
   *   composite: ['teamName', 'status'],
   *   template: 'Edit {teamName} (Status: {status})'
   * }
   */
  tooltip?: Template;

  url?: string;
  icon?: string;
  type?: 'button' | 'dropdown';
  items?: ReadonlyArray<Omit<IEntityPageAction, 'items'>> | Array<Omit<IEntityPageAction, 'items'>>;  // Items cannot have sub-items

  /** Open action in modal instead of navigating */
  openInModal?: boolean;

  /** Modal configuration (inline config or resolved from url) */
  modalConfig?: IEntityPageActionModalConfig;

  /** 
   * Entity config reference for modal route resolution (when using url + openInModal).
   * Provides overrideConfig support for defaultFilters, hideSegments, etc.
   * Only used when modalConfig is NOT provided (route resolution pattern).
   * 
   * @example
   * {
   *   url: '/list-observabilitylog?parentObservabilityLogId.eq=:observabilityLogId',
   *   openInModal: true,
   *   modalConfigRef: {
   *     entityName: 'observabilityLog',
   *     pageType: 'list',
   *     overrideConfig: {
   *       hideSegments: ['hierarchy-group']
   *     }
   *   }
   * }
   */
  modalConfigRef?: IEntityConfigReference;

  /** Custom modal width. Default: auto-detect from page type */
  modalWidth?: number | string;

  /** Override resolved page title when opened in modal */
  modalTitle?: string;

  /** Hide this action when rendered inside a modal. Default: false */
  hideInModal?: boolean;

  /** Only open in modal on specified screen size. Default: always */
  openInModalCondition?: 'sm' | 'md' | 'lg' | 'xl';

  // =========================================================================
  // DRAWER SUPPORT
  // =========================================================================

  /**
   * Open action in drawer (slide-out panel) instead of navigating.
   * Similar to openInModal but renders in a side drawer.
   * 
   * Use drawers for:
   * - Quick preview of entity details
   * - Side-by-side editing while viewing list
   * - Forms that don't require full page context
   * - Secondary content that shouldn't interrupt main flow
   * 
   * @example
   * {
   *   label: 'Quick View',
   *   url: '/view-order/:orderId',
   *   openInDrawer: true,
   *   drawerConfig: {
   *     placement: 'right',
   *     width: 500,
   *     title: 'Order Details'
   *   }
   * }
   */
  openInDrawer?: boolean;

  /**
   * Drawer configuration.
   * Only used when openInDrawer is true.
   * 
   * @see {@link IEntityPageActionDrawerConfig} for full documentation
   */
  drawerConfig?: IEntityPageActionDrawerConfig;

  /**
   * Entity config reference for drawer route resolution (when using url + openInDrawer).
   * Similar to modalConfigRef but for drawers.
   * 
   * @example
   * {
   *   url: '/view-order/:orderId',
   *   openInDrawer: true,
   *   drawerConfigRef: {
   *     entityName: 'order',
   *     pageType: 'view',
   *     overrideConfig: {
   *       hideFields: ['createdAt', 'updatedAt']
   *     }
   *   }
   * }
   */
  drawerConfigRef?: IEntityConfigReference;

  /**
   * Visibility configuration for this action.
   * Controls visibility and enablement based on actor roles, record state, context, and custom logic.
   * 
   * When undefined, action is visible and enabled by default.
   * 
   * Supports:
   * - Role-based access via actor.groups
   * - Record-based conditions (owner checks, status checks)
   * - Context-based logic (page type, modal depth, query params)
   * - Custom evaluator functions (registered in frontend)
   * 
   * @example
   * // Simple role check
   * visibility: {
   *   actor: { groups: { inList: ['admin'] } }
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
  visibility?: Condition;

  /**
   * Enablement condition — when false, the action renders as disabled (greyed out).
   * 
   * @example
   * // Only enabled when record is not locked
   * enablement: { record: { status: { neq: 'locked' } } }
   * 
   * @example
   * // Only enabled for admins OR record owners
   * enablement: { or: [{ ref: 'isAdmin' }, { ref: 'isOwner' }] }
   */
  enablement?: Condition;

  /**
   * Message shown when action is disabled (as tooltip or helper text).
   * Supports template syntax resolved against EvaluationContext.
   * 
   * @example
   * disabledMessage: 'Record is locked by {record.lockedBy}'
   */
  disabledMessage?: string | Template;

  /**
   * Link target attribute for external URLs.
   * Only applicable when url is set and action navigates to an external link.
   * 
   * @example
   * // Open external link in new tab
   * {
   *   label: 'View on Platform',
   *   url: '{platformPostUrl}',
   *   target: '_blank'
   * }
   */
  target?: '_blank' | '_self' | '_parent' | '_top';
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
  fieldType?: 'text' | 'textarea' | 'password' | 'email' | 'url' | 'phone';
  maxLength?: number;
  mask?: string;
  /**
   * For 'url' type: validate URL format
   * For 'phone' type: phone number format/mask
   */
  format?: string;
}

interface NumberFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'number' | 'currency' | 'percentage';
  min?: number;
  max?: number;
  step?: number;
  /**
   * For 'currency' type: currency code (e.g., 'USD', 'EUR')
   * For 'percentage' type: display format (e.g., '0.00%')
   */
  format?: string;
  /**
   * For 'currency' type: currency symbol (e.g., '$', '€')
   */
  currencySymbol?: string;
  /**
   * For 'currency' type: symbol position ('before' | 'after')
   */
  symbolPosition?: 'before' | 'after';
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

interface DurationFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'duration';
  /**
   * Input unit of the duration value stored in the database.
   * The renderer will convert from this unit to human-readable format.
   * Default: 'seconds'
   * 
   * @example
   * // For a field storing milliseconds (e.g., durationMs: 1500)
   * durationUnit: 'ms'  // Displays as "1.5s"
   * 
   * @example
   * // For a field storing seconds (e.g., duration: 90)
   * durationUnit: 'seconds'  // Displays as "1m 30s"
   * 
   * @example
   * // For a field storing days (e.g., retentionDays: 30)
   * durationUnit: 'days'  // Displays as "30d" or "1mo"
   */
  durationUnit?: 'ms' | 'seconds' | 'minutes' | 'hours' | 'days';
  /**
   * Display format for duration. Default: 'auto' (shows largest relevant units)
   * - 'auto': Automatically shows days/hours/minutes/seconds as needed
   * - 'long': Shows all units (e.g., "2d 3h 15m 30s")
   * - 'short': Shows only 2 most significant units (e.g., "2d 3h")
   * - 'compact': Shows single most significant unit (e.g., "2d")
   */
  durationFormat?: 'auto' | 'long' | 'short' | 'compact';
  /**
   * Minimum duration value (in the specified unit)
   */
  minDuration?: number;
  /**
   * Maximum duration value (in the specified unit)
   */
  maxDuration?: number;
}

interface TTLFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'ttl';
  /**
   * Input unit of the TTL value stored in the database.
   * The renderer will convert from this unit to human-readable format.
   * Default: 'seconds' (Unix timestamp)
   * 
   * TTL (Time To Live) is typically stored as a Unix timestamp representing
   * when the item expires. The UI calculates and displays the remaining time
   * until expiration.
   * 
   * @example
   * // For a field storing Unix timestamp in seconds (DynamoDB TTL format)
   * ttlUnit: 'seconds'  // Displays as "5d 3h 15m 22s" (time until expiration)
   * 
   * @example
   * // For a field storing Unix timestamp in milliseconds
   * ttlUnit: 'ms'  // Displays calculated remaining time
   */
  ttlUnit?: 'ms' | 'seconds' | 'minutes' | 'hours';
  /**
   * Display format for TTL. Default: 'auto'
   * - 'auto': Automatically shows appropriate units based on remaining time
   * - 'long': Shows all units (e.g., "2d 3h 15m 30s remaining")
   * - 'short': Shows only 2 most significant units
   * - 'compact': Shows single most significant unit with suffix
   */
  ttlFormat?: 'auto' | 'long' | 'short' | 'compact';
  /**
   * Auto-refresh TTL display every N seconds. Default: 0 (disabled)
   * Useful for countdown timers. Recommended: 1-60 seconds
   * 
   * @example
   * ttlAutoRefresh: 1   // Refresh every second (live countdown)
   * ttlAutoRefresh: 30  // Refresh every 30 seconds (less aggressive)
   */
  ttlAutoRefresh?: number;
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

interface SliderFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'slider';
  min?: number;
  max?: number;
  step?: number;
  showValue?: boolean; // whether to show the current value
  /**
   * Show marks on slider (e.g., { 0: '0°C', 26: '26°C', 37: '37°C', 100: '100°C' })
   */
  marks?: Record<number, string>;
  /**
   * Enable vertical slider
   */
  vertical?: boolean;
}

interface BadgeFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'badge';
  /**
   * Badge status/color: 'success', 'processing', 'error', 'warning', 'default'
   */
  status?: 'success' | 'processing' | 'error' | 'warning' | 'default';
  /**
   * Custom color (hex code) - overrides status color
   */
  color?: string;
  /**
   * Show count/dot indicator
   */
  showDot?: boolean;
}

interface TagFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'tag' | 'tags';
  /**
   * Tag color: 'success', 'processing', 'error', 'warning', 'default', or custom hex
   */
  color?: 'success' | 'processing' | 'error' | 'warning' | 'default' | string;
  /**
   * Closeable tags (for editable lists)
   */
  closable?: boolean;
  /**
   * Icon to display in tag
   */
  icon?: string;
}

interface ProgressFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'progress';
  /**
   * Progress type: 'line', 'circle', 'dashboard'
   */
  type?: 'line' | 'circle' | 'dashboard';
  /**
   * Progress status color: 'success', 'exception', 'normal', 'active'
   */
  status?: 'success' | 'exception' | 'normal' | 'active';
  /**
   * Show percentage text
   */
  showInfo?: boolean;
  /**
   * Custom format for percentage text
   */
  format?: string;
}

interface AvatarFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'avatar';
  /**
   * Avatar shape: 'circle', 'square'
   */
  shape?: 'circle' | 'square';
  /**
   * Avatar size: number (pixels) or 'small', 'default', 'large'
   */
  size?: number | 'small' | 'default' | 'large';
  /**
   * Fallback icon when no image
   */
  icon?: string;
  /**
   * Fallback text when no image (e.g., initials)
   */
  text?: string;
}

interface IconFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'icon';
  /**
   * Icon size in pixels
   */
  size?: number;
  /**
   * Icon color (hex code)
   */
  color?: string;
  /**
   * Icon library: 'antd', 'custom'
   */
  library?: 'antd' | 'custom';
}

interface LinkFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'link';
  /**
   * Target for link: '_blank', '_self', '_parent', '_top'
   */
  target?: '_blank' | '_self' | '_parent' | '_top';
  /**
   * Link template/pattern (supports placeholders)
   */
  urlPattern?: string;
}

interface VideoFieldMetadata extends BaseFieldMetadata, CommonFileFieldMetadata {
  fieldType?: 'video';
  /**
   * Accepted video formats
   */
  accept?: 'video/*' | 'video/mp4' | 'video/webm' | 'video/ogg';
  /**
   * Show video player controls
   */
  controls?: boolean;
  /**
   * Autoplay video
   */
  autoplay?: boolean;
  /**
   * Maximum duration in seconds
   */
  maxDuration?: number;
}

interface AudioFieldMetadata extends BaseFieldMetadata, CommonFileFieldMetadata {
  fieldType?: 'audio';
  /**
   * Accepted audio formats
   */
  accept?: 'audio/*' | 'audio/mpeg' | 'audio/wav' | 'audio/ogg';
  /**
   * Show audio player controls
   */
  controls?: boolean;
  /**
   * Maximum duration in seconds
   */
  maxDuration?: number;
}

interface QRCodeFieldMetadata extends BaseFieldMetadata {
  fieldType?: 'qrcode';
  /**
   * QR code size in pixels
   */
  size?: number;
  /**
   * Error correction level: 'L', 'M', 'Q', 'H'
   */
  errorLevel?: 'L' | 'M' | 'Q' | 'H';
  /**
   * Include logo in QR code
   */
  includeImage?: boolean;
  /**
   * Logo image URL
   */
  logoImage?: string;
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
  /**
   * Code language for syntax highlighting (used when fieldType is 'code')
   * Supported: 'json', 'html', 'javascript', 'handlebars', 'text'
   */
  codeLanguage?: 'json' | 'html' | 'javascript' | 'handlebars' | 'text';
  /** Editor height in pixels (default: 300) */
  height?: number;
  /** Read-only mode */
  readOnly?: boolean;
  /** Dark theme */
  darkTheme?: boolean;
  /** Show line numbers (default: true) */
  lineNumbers?: boolean;
  /** Enable JSON validation for json language (default: true) */
  validateJson?: boolean;
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
  composite: ReadonlyArray<keyof E[ 'attributes' ] & string> | Array<keyof E[ 'attributes' ] & string>,

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
    label: (keyof E[ 'attributes' ] & string) | AttributesTemplate<E>,
    value: (keyof E[ 'attributes' ] & string) | AttributesTemplate<E>,
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
   * - 'json': Render raw JSON view of the entire record
   */
  mode: 'nested-table' | 'details' | 'custom' | 'json';

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
  rowExpandable?: Condition;

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
  visibility?: Condition;

  /**
   * Badge count to display on the segment.
   * Can be a static number or a placeholder.
   * 
   * @example
   * badge: 5  // Static count
   * badge: ':record.activeCount'  // Dynamic from context
   */
  badge?: number | Template;

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
  visibility?: Condition;
  /** Custom renderer component name — supports conditional resolution */
  renderer?: string | ConditionalValue<string>;
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
/**
 * Badge configuration for sections.
 * Supports:
 * - Templates with JSONPath: '{$.lineItems.length()} items'
 * - Advanced config: { template: '{$.items.length()}', showZero: true }
 * - API-based counts: { apiEndpoint: '/admin/order/count', responseKey: 'count' }
 */
export type SectionBadgeConfig =
  | Template  // Template with JSONPath support: '{$.lineItems.length()} items', '{$.items[?(@.status=="active")].length()}'
  | {
    /** Template for badge text with JSONPath support */
    template: Template;
    /** Show badge even if evaluated to 0. Default: false */
    showZero?: boolean;
  }
  | {
    /** API endpoint to fetch count/value from (e.g., '/admin/order/count?userId.eq=:userId') */
    apiEndpoint: string;
    /** Key in response to extract value from. Supports JSONPath. Default: 'count' */
    responseKey?: string;
    /** Optional template for formatting the badge text (e.g., '{count} orders') */
    template?: string;
    /** Show badge even if count is 0. Default: false */
    showZero?: boolean;
  };

export interface ISectionConfig {
  /** Section label - supports templates (e.g., 'Players ({playerCount})') */
  readonly label: Template;
  /** Optional icon for the section tab/accordion header */
  readonly icon?: string;
  /** 
   * Optional badge for the section tab/accordion header.
   * Supports:
   * - Static text: 'New'
   * - JSONPath templates: '{$.lineItems.length()} items' (shows 0 by default)
   * - Filtered counts: '{$.items[?(@.status=="active")].length()} active'
   * - API fetching: { apiEndpoint: '/admin/order/count', responseKey: 'count' }
   * - Multiple badges: ['{$.lineItems.length()}', '{$.errors.length()}']
   * 
   * JSONPath Examples:
   * - Array length: '{$.lineItems.length()}'
   * - Filtered: '{$.lineItems[?(@.type=="subscription")].length()}'
   * - Nested: '{$.order.items.length()}'
   * - Sum: '{$.lineItems[*].quantity}' (returns array, use .length() for count)
   * 
   * Note: Simple templates show "0" by default. Use advanced config to hide zeros.
   * 
   * @example
   * // Static badge
   * badge: 'New'
   * 
   * @example
   * // JSONPath: Count array length (shows "0 items" if array is empty)
   * badge: '{$.lineItems.length()} items'
   * 
   * @example
   * // JSONPath: Hide when 0
   * badge: {
   *   template: '{$.lineItems.length()} items',
   *   showZero: false
   * }
   * 
   * @example
   * // JSONPath: Filtered count
   * badge: '{$.lineItems[?(@.type=="subscription")].length()} subscriptions'
   * 
   * @example
   * // Fetch from API (hides 0 by default)
   * badge: {
   *   apiEndpoint: '/admin/order/count?userId.eq=:userId',
   *   responseKey: 'count',
   *   template: '{count} orders',
   *   showZero: true  // Show "0 orders"
   * }
   * 
   * @example
   * // Multiple badges
   * badge: [
   *   '{$.lineItems.length()} items',
   *   '{$.errors.length()} errors'
   * ]
   */
  readonly badge?: SectionBadgeConfig | ReadonlyArray<SectionBadgeConfig> | Array<SectionBadgeConfig>;
  /** Visibility conditions for this section */
  readonly visibility?: Condition;
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
    readonly detailApiConfig?: DetailsPageConfigStructure[ 'detailApiConfig' ];
    /** Column grouping config */
    readonly columnsConfig?: DetailsPageConfigStructure[ 'columnsConfig' ];
    /** 
     * Properties to display.
     * Supports string shorthand for field names or full PropertyConfig objects.
     * 
     * @example
     * // String shorthand
     * propertiesConfig: ['orderDate', 'status', 'total']
     * 
     * @example
     * // Mixed usage
     * propertiesConfig: [
     *   'orderDate',
     *   { name: 'status', label: 'Order Status', column: 'status', fieldType: 'badge' },
     *   'total'
     * ]
     */
    readonly propertiesConfig: DetailsPageConfigStructure[ 'propertiesConfig' ];
  };
  /** Form page config (if pageType === 'form' and not using entityConfigRef) */
  readonly formPageConfig?: FormPageConfigStructure;
  /** Dashboard config (if pageType === 'dashboard' and not using entityConfigRef) */
  readonly dashboardPageConfig?: DashboardPageConfig[ 'dashboardPageConfig' ];
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
  readonly visibility?: Condition;
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

  // Collapsible card behavior
  /** Start collapsed (default: false for first group, true for others) */
  readonly defaultCollapsed?: boolean;
  /** Show this text when collapsed - supports templates (e.g., 'Total: {total}') */
  readonly collapsedSummary?: Template;
  /** Allow users to collapse/expand this card (default: true) */
  readonly allowCollapse?: boolean;
  /** Allow users to maximize this card to full screen (default: true) */
  readonly allowMaximize?: boolean;
  /** Auto-collapse when another accordion-mode group opens (default: false) */
  readonly autoCollapse?: boolean;
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
 *       visibility: { actor: { groups: { inList: ['admin'] } } },
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

  // ===== UI BEHAVIOR =====
  /** Remember collapsed/expanded state in localStorage (default: true) */
  readonly rememberState?: boolean;
  /** Highlight card that's currently in viewport (default: true) */
  readonly scrollSpyHighlight?: boolean;
}

/** Sort order direction */
export type SortOrder = 'asc' | 'desc';

/** Single field sort configuration (for search engines) */
export type FieldSortConfig = { readonly field: string; readonly order: SortOrder };

/** Search mode sort - field+order, supports multi-field */
export type SearchSortConfig = FieldSortConfig | ReadonlyArray<FieldSortConfig>;

/** Database mode sort - just direction (DynamoDB sorts by index SK) */
export type DatabaseSortConfig = SortOrder;

/**
 * Dual-mode sort configuration for explicit control over both modes
 */
export type DualSortConfig = {
  /** Sort config for search mode (MeiliSearch) - supports field + order */
  readonly search?: SearchSortConfig;
  /** Sort direction for database mode (DynamoDB) - just 'asc' or 'desc' */
  readonly database?: DatabaseSortConfig;
};

/**
 * Table sort configuration - flexible format supporting:
 * 1. Simple: `{ field, order }` - auto-extracts order for DB mode
 * 2. Multi-field: `[{ field, order }, ...]` - search only, DB uses first item's order
 * 3. Explicit: `{ search: {...}, database: 'desc' }` - full control over both modes
 */
export type TableSortConfig = SearchSortConfig | DualSortConfig;

/** @deprecated Use TableSortConfig instead */
export type SortConfig = FieldSortConfig | ReadonlyArray<FieldSortConfig> | SortOrder;

export interface EntityListPageConfig {
  readonly actions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>;
  readonly breadcrumbs?: ReadonlyArray<{ label: Template; url?: string }> | Array<{ label: Template; url?: string }>;

  /**
   * @deprecated Use tableConfig.defaultSort instead
   * Default sort configuration (legacy - kept for backward compatibility)
   */
  readonly defaultSort?: SortConfig;
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
      visibility?: Condition;
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
     * Default sort configuration for the table.
     * 
     * Supports three formats:
     * 
     * **1. Simple (both modes use same direction):**
     * ```ts
     * defaultSort: { field: 'createdAt', order: 'desc' }
     * // Search: sorts by createdAt desc
     * // Database: sorts desc (by index SK)
     * ```
     * 
     * **2. Multi-field (search mode only):**
     * ```ts
     * defaultSort: [
     *   { field: 'publishDate', order: 'desc' },
     *   { field: 'likeCount', order: 'desc' }
     * ]
     * // Search: multi-field sort
     * // Database: uses first item's order ('desc')
     * ```
     * 
     * **3. Explicit (different config per mode):**
     * ```ts
     * defaultSort: {
     *   search: { field: 'relevanceScore', order: 'desc' },
     *   database: 'asc'  // Index designed for ascending
     * }
     * ```
     */
    readonly defaultSort?: TableSortConfig;

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

    /**
     * Default number of records per page.
     * Users can change this via the pagination controls (options: 10, 20, 50, 100).
     * 
     * @default 10
     * 
     * @example
     * pageSize: 20  // Show 20 records per page by default
     */
    readonly pageSize?: number;
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
    visibility?: Condition;
    helpText?: string;
  }> | Array<{
    name: string;
    visibility?: Condition;
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
      visibility?: Condition;
    }> | Array<{
      id?: string;
      text: string;
      action: 'submit' | 'reset' | 'cancel';
      url?: string;
      visibility?: Condition;
    }>;
    readonly fields?: ReadonlyArray<{
      name: string;
      visibility?: Condition;
      enablement?: Condition;
      helpText?: string;
      placeholder?: string;
    }> | Array<{
      name: string;
      visibility?: Condition;
      enablement?: Condition;
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
      visibility?: Condition;
    }> | Array<{
      id?: string;
      text: string;
      action: 'submit' | 'reset' | 'cancel';
      url?: string;
      visibility?: Condition;
    }>;
    readonly fields?: ReadonlyArray<{
      name: string;
      visibility?: Condition;
      helpText?: string;
      placeholder?: string;
    }> | Array<{
      name: string;
      visibility?: Condition;
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
  Opp extends EntityOperationsConfig = TDefaultEntityOperations
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
    readonly excludeAuditActions?: boolean, // default is false - disable automatic audit log actions for this entity

    readonly CRUDApiPath?: string, // default is ''
    readonly softDelete?: boolean, // default is false

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
    readonly listPageDefaultSort?: SortConfig,

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
 * Configuration for an entity operation (action).
 */
export interface EntityOperationConfig {
  /**
   * Whether this operation is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * HTTP method for this operation's API endpoint.
   */
  method?: ApiMethod;

  /**
   * Custom path for this operation's API endpoint.
   * If not provided, defaults to the operation name.
   */
  path?: string;

  /**
   * Name of the handler method on the entity service.
   * If not provided, defaults to the operation name.
   */
  handler?: string;

  /**
   * Whether this is a bulk operation (operates on multiple records).
   */
  isBulk?: boolean;

  /**
   * Whether this operation requires a record ID in the path.
   */
  requiresId?: boolean;

  /**
   * Human readable name for the operation.
   */
  label?: string;

  /**
   * Tooltip for the operation in the UI.
   */
  tooltip?: string;

  /**
   * Icon for the operation button.
   */
  icon?: string;

  /**
   * Visibility condition for the operation.
   */
  visibility?: Condition;

  /**
   * Enablement condition for the operation.
   */
  enablement?: Condition;

  /**
   * Summary for documentation.
   */
  summary?: string;

  /**
   * Description for documentation.
   */
  description?: string;

  /**
   * Authorizer configuration for this operation's API endpoint.
   */
  authorizer?: any;

  /**
   * Validations for this operation's API endpoint.
   */
  validations?: InputValidationRule | HttpRequestValidations;

  /**
   * Specifies where this operation should appear in the UI.
   */
  uiLocation?: 'header' | 'row' | 'bulk' | 'none';

  /**
   * Whether to open this operation in a modal.
   */
  openInModal?: boolean;

  /**
   * Modal configuration if openInModal is true.
   */
  modalConfig?: IEntityPageActionModalConfig;

  /**
   * Operation guards that must pass for this operation to be executed.
   * Can be a service method name or a function.
   */
  guards?: ReadonlyArray<string | ((payload: any, ctx?: ExecutionContext) => Promise<boolean> | boolean)>;

  /**
   * Input schema configuration for this operation.
   */
  input?: EntityOperationIOConfig;

  /**
   * Output schema configuration for this operation.
   */
  output?: EntityOperationIOConfig;
}

/**
 * Configuration for operation Input/Output schemas.
 */
export interface EntityOperationIOConfig {
  /**
   * Reference entity attributes by name.
   */
  attributes?: ReadonlyArray<string>;

  /**
   * Use pre-defined profiles.
   * - 'creatable': all attributes with isCreatable !== false
   * - 'editable': all attributes with isEditable !== false
   * - 'visible': all attributes with isVisible !== false
   * - 'listable': all attributes with isListable !== false
   * - 'identifiers': only primary identifier attributes
   */
  profile?: 'creatable' | 'editable' | 'visible' | 'listable' | 'identifiers' | 'all';

  /**
   * Define extra fields not in the entity schema.
   */
  extra?: Record<string, EntityAttribute>;
}

/**
 * Map of operation configurations for an entity.
 */
export type EntityOperationsConfig = {
  [ key: string ]: EntityOperationConfig | string;
};

import { DefaultEntityOperations } from "./constants";
export { DefaultEntityOperations };

/**
 * Type for the default entity operations.
 */
export type TDefaultEntityOperations = typeof DefaultEntityOperations;

/**
 * Options for getting an entity.
 */
export type EntityGetOptions<S extends EntitySchema<any, any, any, any>> = {
  identifiers: EntityIdentifiersTypeFromSchema<S> | Array<EntityIdentifiersTypeFromSchema<S>>,
  attributes?: EntitySelections<S>
}

/**
 * Type for an entity operation handler function.
 */
export type EntityOperationHandler<TInput = any, TOutput = any> = (payload: TInput, ctx?: ExecutionContext) => Promise<TOutput>;

/**
 * Helper to infer TypeScript types from declarative I/O configuration.
 */
export type InferIOType<
  S extends EntitySchema<any, any, any>,
  IO extends EntityOperationIOConfig | undefined
> = IO extends undefined ? any :
  (IO extends { profile: 'creatable' } ? CreateEntityItemTypeFromSchema<S> :
   IO extends { profile: 'editable' } ? UpdateEntityItemTypeFromSchema<S> :
   IO extends { profile: 'identifiers' } ? EntityIdentifiersTypeFromSchema<S> :
   IO extends { profile: 'all' } ? EntityRecordTypeFromSchema<S> :
   {}) &
  (IO extends { attributes: ReadonlyArray<infer A> } ? Pick<EntityRecordTypeFromSchema<S>, Extract<A, keyof EntityRecordTypeFromSchema<S>>> : {}) &
  (IO extends { extra: Record<infer K, any> } ? { [P in K]: any } : {});

/**
 * Options for updating an entity via executeOperation.
 */
export type EntityUpdateOptions<S extends EntitySchema<any, any, any, any>> = {
  identifiers?: EntityIdentifiersTypeFromSchema<S>,
  data: UpdateEntityItemTypeFromSchema<S>,
  operators?: UpdateEntityOperators<S>
} | UpdateEntityItemTypeFromSchema<S>;

/**
 * Represents the input schemas for entity operations.
 * Provides type-safe mapping of operation names to their corresponding input types.
 */
export type TEntityOpsInputSchemas<
  Sch extends EntitySchema<any, any, any, any>,
> = {
    readonly [ opName in keyof Sch[ 'model' ][ 'entityOperations' ] ]
    : Sch[ 'model' ][ 'entityOperations' ][ opName ] extends { input: infer IO }
      ? (IO extends EntityOperationIOConfig ? InferIOType<Sch, IO> : any)
      : opName extends 'get' ? EntityGetOptions<Sch>
      : opName extends 'list' ? EntityQuery<Sch>
      : opName extends 'query' ? EntityQuery<Sch>
      : opName extends 'search' ? any // Search query type
      : opName extends 'create' ? CreateEntityItemTypeFromSchema<Sch>
      : opName extends 'upsert' ? UpsertEntityItemTypeFromSchema<Sch>
      : opName extends 'update' ? EntityUpdateOptions<Sch>
      : opName extends 'delete' ? EntityIdentifiersTypeFromSchema<Sch> | Array<EntityIdentifiersTypeFromSchema<Sch>>
      : opName extends 'duplicate' ? EntityIdentifiersTypeFromSchema<Sch>
      : opName extends 'batchDelete' ? { ids: Array<EntityIdentifiersTypeFromSchema<Sch>>, concurrent?: number }
      : opName extends 'deleteByQuery' ? { filters: EntityFilterCriteria<Sch>, batchSize?: number, concurrent?: number, maxItems?: number }
      : opName extends 'batchUpsert' ? { items: Array<UpsertEntityItemTypeFromSchema<Sch>>, options?: any }
      : opName extends 'export' ? { query?: EntityQuery<Sch>, format?: 'json' | 'csv' }
      : opName extends 'import' ? { items: Array<CreateEntityItemTypeFromSchema<Sch>>, options?: { upsert?: boolean } }
      : opName extends 'patch' ? { ids: Array<EntityIdentifiersTypeFromSchema<Sch>>, data: UpdateEntityItemTypeFromSchema<Sch> }
      : opName extends 'restore' ? EntityIdentifiersTypeFromSchema<Sch>
      : opName extends 'archive' ? EntityIdentifiersTypeFromSchema<Sch>
      : any
  }

/**
 * Represents the output types for entity operations.
 */
export type TEntityOpsOutputTypes<
  Sch extends EntitySchema<any, any, any, any>,
> = {
    readonly [ opName in keyof Sch[ 'model' ][ 'entityOperations' ] ]
    : Sch[ 'model' ][ 'entityOperations' ][ opName ] extends { output: infer IO }
      ? (IO extends EntityOperationIOConfig ? InferIOType<Sch, IO> : any)
      : opName extends 'get' ? EntityRecordTypeFromSchema<Sch> | undefined
      : opName extends 'list' ? EntityRecordTypeFromSchema<Sch>[]
      : opName extends 'query' ? EntityRecordTypeFromSchema<Sch>[]
      : opName extends 'search' ? SearchResult<EntityRecordTypeFromSchema<Sch>>
      : opName extends 'create' ? CreateEntityResponse<Sch>
      : opName extends 'upsert' ? UpsertEntityResponse<Sch>
      : opName extends 'update' ? UpdateEntityResponse<Sch>
      : opName extends 'delete' ? DeleteEntityResponse<Sch>
      : opName extends 'duplicate' ? EntityRecordTypeFromSchema<Sch>
      : opName extends 'batchUpsert' ? Array<UpsertEntityResponse<Sch>>
      : opName extends 'batchDelete' ? Array<DeleteEntityResponse<Sch>>
      : opName extends 'export' ? { url?: string, data?: any[] }
      : opName extends 'import' ? { count: number, results: Array<CreateEntityResponse<Sch> | UpsertEntityResponse<Sch>> }
      : opName extends 'patch' ? Array<UpdateEntityResponse<Sch>>
      : opName extends 'restore' ? UpdateEntityResponse<Sch>
      : opName extends 'archive' ? UpdateEntityResponse<Sch>
      : any
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
  Ops extends EntityOperationsConfig,
  S extends EntitySchema<A, F, C, Ops>
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
  K extends keyof E[ 'attributes' ]
> = E[ 'attributes' ][ K ][ 'type' ] extends 'string' ? string
  : E[ 'attributes' ][ K ][ 'type' ] extends 'number' ? number
  : E[ 'attributes' ][ K ][ 'type' ] extends 'boolean' ? boolean
  : E[ 'attributes' ][ K ][ 'type' ] extends Array<infer T> ? T
  : E[ 'attributes' ][ K ][ 'type' ] extends 'any' ? any
  : E[ 'attributes' ][ K ][ 'type' ] extends 'set' ? Set<string>
  : E[ 'attributes' ][ K ][ 'type' ] extends 'list' ? Array<any>
  : E[ 'attributes' ][ K ][ 'type' ] extends 'map' ? Record<string, any>
  : any;

/**
 * Utility type to extract all attribute names and their value types as a key-value map.
 * 
 * @template E - The entity schema
 */
export type EntityAttributeValueMap<E extends EntitySchema<any, any, any>> = {
  [ K in keyof E[ 'attributes' ] ]: AttributeValueType<E, K>
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