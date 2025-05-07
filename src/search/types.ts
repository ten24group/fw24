import { ValueOf } from './../../dist/package/utils/types.d';
import { EntitySchema } from '../entity/base-entity';
import type { EntityFilterCriteria } from '../entity/query-types';
export type SearchProvider = 'meili' | 'elasticsearch' | 'algolia';

export interface SearchIndexConfig {
  indexName?: string;
  provider?: SearchProvider;
  settings?: {
    searchableAttributes?: string[];
    filterableAttributes?: string[];
    sortableAttributes?: string[];
    facetableAttributes?: string[];
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
export type SearchIndexConfigSettings = NonNullable<SearchIndexConfig[ 'settings' ]> & {
  selectableAttributes: string[];
};

/**
 * Defines all query options for search engines: full-text, filters, pagination, sorting, faceting, etc.
 */
export type SearchQuery = {
  indexName?: string;
  /** Text or terms to search for (full-text). */
  search?: string | string[];

  /** Attributes to target for searching. */
  searchAttributes?: Array<string>;

  /** Filter criteria using the EntityQuery filter DSL. */
  filters?: EntityFilterCriteria<any>;

  /** Facet filtering (values to filter on). */
  facetFilters?: Array<string | string[]>;

  /** Request facet distribution for given attributes. */
  returnFacets?: Array<string>;

  /** Pagination settings: page and limit. */
  pagination?: {
    page?: number;
    limit?: number;
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
  matchingStrategy?: 'all' | 'last';

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


/**
 * Generic extension of SearchEngineQuery that integrates with search configuration.
 * It omits overlapping keys from SearchEngineQuery and replaces them with ones
 * constrained by the provided config T.
 */
export type SearchQueryTyped<T extends SearchIndexConfigSettings> = Omit<SearchQuery, 'searchAttributes' | 'sort' | 'select' | 'distinctAttribute' | 'facets'> & {
  /** Allowed search attributes derived from entity metadata. */
  searchAttributes?: T[ 'searchableAttributes' ];

  /** Field selection restricted to available selectable attributes. */
  select?: T[ 'selectableAttributes' ];
  /** Distinct attribute must be one of the selectable attributes. */
  distinctAttribute?: T[ 'selectableAttributes' ][ number ];

  /** Facet distribution is restricted to the facet attributes from the entity metadata. */
  facets?: T[ 'facetableAttributes' ];

  /** Sorting limited to the sortable attributes from the entity metadata. */
  sort?: Array<{ field: Extract<ValueOf<T[ 'sortableAttributes' ]>, string>; dir: 'asc' | 'desc' }>;
};

/**
 * Infers an EntitySearchConfig from an entity schema E.
 * TODO: improve this to be able to use other entity-metadata to infer what attributes are allowed for search, sorting, filtering, etc.
 * will need to be able to use metadata like isSearchable, isSortable, isFilterable, isFacetable, etc.
 */
export type InferEntitySearchIndexConfig<E extends EntitySchema<any, any, any, any>> = {
  searchableAttributes: Array<Extract<keyof E[ 'attributes' ], string>>;
  filterableAttributes: Array<Extract<keyof E[ 'attributes' ], string>>;
  sortableAttributes: Array<Extract<keyof E[ 'attributes' ], string>>;
  facetAttributes: Array<Extract<keyof E[ 'attributes' ], string>>;
  selectableAttributes: Array<Extract<keyof E[ 'attributes' ], string>>;
};

/**
 * A type-specific search query for an entity.
 * It derives the search configuration from the entity schema E using InferEntitySearchConfig,
 * and returns a SearchEngineQueryExt with those settings.
 */
export type EntitySearchQuery<E extends EntitySchema<any, any, any, any>> = SearchQueryTyped<InferEntitySearchIndexConfig<E>>;


export interface SearchResult<T> {
  hits: T[];
  facets?: Record<string, Record<string, number>>;
  total: number;
  page?: number;
  hitsPerPage?: number;
  processingTimeMs?: number;
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