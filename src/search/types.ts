import { BaseFieldMetadata, EntityAttribute } from './../entity/base-entity';
import { ValueOf } from './../../dist/package/utils/types.d';
import { EntitySchema } from '../entity/base-entity';
import type { EntityFilterCriteria, GenericFilterCriteria, GenericFilterGroup, TypedFilterCriteria } from '../entity/query-types';
import { OmitNever } from '../utils';
export type SearchProvider = 'meili' | 'elasticsearch' | 'algolia';

export interface SearchIndexConfig {
  indexName?: string;
  provider?: SearchProvider;
  primaryKey?: string;
  settings?: {
    searchableAttributes?: string[];
    filterableAttributes?: string[];
    sortableAttributes?: string[];
  };
  faceting?: {
    maxValuesPerFacet?: number;
    facets: Record<string, FacetConfig>;
  };
}

export interface FacetConfig {
  attribute: string;
  type: 'value' | 'range' | 'date';
  ranges?: Array<{
    from: number | string;
    to: number | string;
    label: string;
  }>;
}

/**
 * Configuration derived from entity metadata regarding available attributes for search.
 */
export type SearchIndexSettings = NonNullable<SearchIndexConfig[ 'settings' ]> & {
  selectableAttributes: string[];
};

// Default filter type: allow field-based filters for string keys

/**
 * Defines all query options for search engines: full-text, filters, pagination, sorting, faceting, etc.
 */
export type SearchQuery<F = GenericFilterCriteria> = {
  /** Text or terms to search for (full-text). */
  search?: string | string[];

  /** Attributes to target for searching. */
  searchAttributes?: Array<string>;

  /** Filter criteria using the EntityQuery filter DSL. */
  filters?: F;

  /** Post-filter criteria (filtering after aggregations to preserve facet counts) */
  postFilters?: F;

  /** Facet filtering (values to filter on). */
  facetFilters?: Array<string | string[]>;

  /** Request facet distribution for given attributes. */
  returnFacets?: Array<string>;

  /** Pagination settings: page and limit. */
  pagination?: {
    page?: number;
    limit?: number;
    /** Use page/hitsPerPage pagination for exhaustive results */
    usePagination?: boolean;
  }

  /** Multi-field sorting criteria (field and direction). */
  sort?: Array<{ field: string; dir: 'asc' | 'desc' }>;

  /** Select specific fields from index results. */
  select?: Array<string>;

  /** Return distinct results on a given attribute. */
  distinctAttribute?: string;

  /** Highlight matching terms in given fields. */
  highlight?: {
    fields: Array<string>;
    preTag?: string;
    postTag?: string;
    showMatchesPosition?: boolean;
  };

  /** Return cropped excerpts for given fields. */
  crop?: {
    fields: Array<string>;
    length?: number;
    marker?: string;
  };

  /** Matching strategy for term splitting. */
  matchingStrategy?: 'all' | 'last' | 'frequency';

  /** Show global ranking score for each document */
  showRankingScore?: boolean;

  /** Show detailed ranking score information for each document */
  showRankingScoreDetails?: boolean;

  /** Filter results below a certain ranking score threshold */
  rankingScoreThreshold?: number;

  /** Configure AI-powered hybrid semantic search */
  hybrid?: {
    embedder: string;
    semanticRatio?: number;
  };

  /** Custom vector for vector search */
  vector?: number[];

  /** Return document vector data with search results */
  retrieveVectors?: boolean;

  /** Specify query languages for better search results */
  locales?: string[];

  /** Geolocation-based search. */
  geo?: {
    lat: number;
    lng: number;
    radius?: number;
    precision?: number;
  };

  /** Any engine-specific raw query options. */
  rawOptions?: Record<string, any>;
};

export type InferIndexSearchFilterCriteria<E extends SearchIndexSettings> = GenericFilterCriteria<{
  [ K in Extract<ValueOf<E[ 'filterableAttributes' ]>, string> ]: any
}>;


/**
 * Generic extension of SearchEngineQuery that integrates with search configuration.
 * It omits overlapping keys from SearchEngineQuery and replaces them with ones
 * constrained by the provided config T.
 */
export type SearchQueryTyped<T extends SearchIndexSettings> = Omit<SearchQuery, 'searchAttributes' | 'sort' | 'select' | 'distinctAttribute' | 'facets' | 'filters' | 'postFilters'> & {
  /** Allowed search attributes derived from entity metadata. */
  searchAttributes?: T[ 'searchableAttributes' ];

  filters?: InferIndexSearchFilterCriteria<T>;

  postFilters?: InferIndexSearchFilterCriteria<T>;

  /** Field selection restricted to available selectable attributes. */
  select?: T[ 'selectableAttributes' ];

  /** Distinct attribute must be one of the selectable attributes. */
  distinctAttribute?: T[ 'selectableAttributes' ][ number ];

  /** Facet distribution is restricted to the facet attributes from the entity metadata. */
  facets?: T[ 'filterableAttributes' ];

  /** Sorting limited to the sortable attributes from the entity metadata. */
  sort?: Array<{ field: Extract<ValueOf<T[ 'sortableAttributes' ]>, string>; dir: 'asc' | 'desc' }>;
};

// check if the entity modal had search config defined: use the searchable attributes form there
// else collect entity attributes which wither have isSearchable not defined or to true
// make sure the searchable attributes have length > 0 else fallback to entity-attributes
// make sure to ignore any attributes marked as isSearchable: false
export type ExtractEntitySearchableAttributes<E extends EntitySchema<any, any, any, any>> =
  ExtractEntitySearchConfigAttributesOfType<'searchableAttributes', E> extends never ?
  ExtractEntityAttributesOfType<'isSearchable', E>
  : ExtractEntitySearchConfigAttributesOfType<'searchableAttributes', E>;

export type ExtractEntityFilterableAttributes<E extends EntitySchema<any, any, any, any>> =
  ExtractEntitySearchConfigAttributesOfType<'filterableAttributes', E> extends never ?
  ExtractEntityAttributesOfType<'isFilterable', E>
  : ExtractEntitySearchConfigAttributesOfType<'filterableAttributes', E>;

export type ExtractEntitySortableAttributes<E extends EntitySchema<any, any, any, any>> =
  ExtractEntitySearchConfigAttributesOfType<'sortableAttributes', E> extends never ?
  ExtractEntityAttributesOfType<'isSortable', E>
  : ExtractEntitySearchConfigAttributesOfType<'sortableAttributes', E>;

export type ExtractEntitySelectableAttributes<E extends EntitySchema<any, any, any, any>> =
  ExtractEntitySearchConfigAttributesOfType<'selectableAttributes', E> extends never ?
  ExtractEntityAttributesOfType<'isListable', E>
  : ExtractEntitySearchConfigAttributesOfType<'selectableAttributes', E>;

export type ExtractEntityAttributesOfType<T extends keyof BaseFieldMetadata, E extends EntitySchema<any, any, any, any>> = Extract<
  keyof OmitNever<{
    [ K in keyof E[ 'attributes' ] ]: E[ 'attributes' ][ K ][ T ] extends false ? never : K
  }>
  , string>

type ExtractEntitySearchConfigAttributesOfType<T extends keyof SearchIndexSettings, E extends EntitySchema<any, any, any, any>> =
  E[ 'model' ][ 'search' ] extends {
    indexConfig: {
      settings: {
        [ K in T ]: string[];
      }
    }
  }
  ? Extract<ValueOf<E[ 'model' ][ 'search' ][ 'indexConfig' ][ 'settings' ][ T ]>, string>
  : never;

/**
* Infers an EntitySearchConfig from an entity schema E.
*/
export type InferEntitySearchIndexConfig<E extends EntitySchema<any, any, any, any>> = {
  searchableAttributes: Array<ExtractEntitySearchableAttributes<E>>;
  filterableAttributes: Array<ExtractEntityFilterableAttributes<E>>;
  sortableAttributes: Array<ExtractEntitySortableAttributes<E>>;
  selectableAttributes: Array<ExtractEntitySelectableAttributes<E>>;
};

/**
 * A type-specific search query for an entity.
 * It derives the search configuration from the entity schema E using InferEntitySearchConfig,
 * and returns a SearchEngineQueryExt with those settings.
 */
export type EntitySearchQuery<E extends EntitySchema<any, any, any, any>> =
  SearchQueryTyped<InferEntitySearchIndexConfig<E>>;

export interface SearchResult<T> {
  hits: T[];
  facets?: Record<string, Record<string, number>>;
  facetStats?: Record<string, { min: number; max: number }>;
  total: number;
  page?: number;
  hitsPerPage?: number;
  totalPages?: number;
  processingTimeMs?: number;
  totalHits?: number;
  query?: string;
}

export interface SearchOptions extends Record<string, any> {
  filter?: string | string[];
  facets?: string[];
  limit?: number;
  offset?: number;
  page?: number;
  hitsPerPage?: number;
  sort?: string[];
}