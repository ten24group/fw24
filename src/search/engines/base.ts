import { SearchIndexConfig, SearchResult, SearchQuery } from '../types';
import { createLogger } from '../../logging';
import { SearchQueryError } from '../errors';

export abstract class BaseSearchEngine {
  protected readonly logger = createLogger(`BaseSearchEngine:${this.constructor.name}`);

  constructor(protected readonly config: Record<string, any>) { }

  abstract initIndex(config: SearchIndexConfig, synchronous?: boolean): Promise<any>;
  abstract indexExists(indexName: string): Promise<boolean>;
  abstract deleteIndex(indexName: string, synchronous?: boolean): Promise<any>;

  abstract search<T>(query: SearchQuery, config: SearchIndexConfig): Promise<SearchResult<T>>;

  abstract indexDocuments<T extends Record<string, any>>(documents: T[], config: SearchIndexConfig, synchronous?: boolean): Promise<any>;
  abstract deleteDocuments(ids: string[], indexName: string, synchronous?: boolean): Promise<any>;

  // --- Index management ---
  abstract getIndexInfo(indexName: string): Promise<any>;
  abstract getIndexStats(indexName: string): Promise<any>;
  abstract listIndices(): Promise<any>;
  abstract updateIndexSettings(indexName: string, settings: any, synchronous?: boolean): Promise<any>;
  abstract resetIndexSettings(indexName: string, synchronous?: boolean): Promise<any>;
  abstract getIndexSettings(indexName: string): Promise<any>;

  // --- Document management ---
  abstract updateDocuments<T extends Record<string, any> = Record<string, any>>(docs: T[], config: SearchIndexConfig, synchronous?: boolean): Promise<any>;
  abstract getDocument<T extends Record<string, any> = Record<string, any>>(id: string, indexName: string): Promise<T>;
  abstract getDocuments<T extends Record<string, any> = Record<string, any>>(indexName: string, options?: any): Promise<T[]>;
  abstract deleteAllDocuments(indexName: string, synchronous?: boolean): Promise<any>;
  abstract deleteDocumentsByFilter(filter: SearchQuery[ 'filters' ], indexName: string, synchronous?: boolean): Promise<any>;

  // --- Engine/server info ---
  abstract health<T = any>(): Promise<T>;
  abstract isHealthy(): Promise<boolean>;
  abstract getStats<T = any>(): Promise<T>;
  abstract getVersion<T = any>(): Promise<T>;
  abstract multiSearch<T = any>(queries: any[]): Promise<T>;

  protected validateConfig(config: SearchIndexConfig): void {
    if (!config.indexName) {
      throw new SearchQueryError('Index name is required');
    }
  }
} 