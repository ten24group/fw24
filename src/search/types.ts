import type { EntityQuery } from '../entity/query-types';

export type SearchProvider = 'meili' | 'elasticsearch' | 'algolia';

export interface SearchEngineConfig {
  provider: SearchProvider;
  indexName?: string;
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

export interface ISearchEngine {
  /**
   * Index documents in the search engine
   * @param documents Documents to index
   * @param config Search engine configuration
   */
  index<T extends Record<string, any>>(documents: T[], config: SearchEngineConfig): Promise<void>;

  /**
   * Search for documents
   * @param query Search query
   * @param config Search engine configuration
   */
  search<T>(query: EntityQuery<any>, config: SearchEngineConfig): Promise<SearchResult<T>>;

  /**
   * Delete documents from index
   * @param ids Document IDs to delete
   * @param indexName Index name
   */
  delete(ids: string[], indexName: string): Promise<void>;
} 