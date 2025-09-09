/**
 * Environment variable keys used for search indexer configuration
 */

/**
 * Constant containing the actual environment variable keys
 */
export const SEARCH_INDEXER_ENV_KEYS = {
  ENABLED: 'SEARCH_INDEXER_ENABLED',
  TABLE_NAME_ENV_KEY: 'TABLE_NAME_ENV_KEY', // this will hold a pointer to the actual table name key in the environment.
  MEILI_HOST: 'MEILI_HOST',
  MEILI_MASTER_KEY: 'MEILI_MASTER_KEY',
  ALLOWED_ENTITY_NAMES: 'SEARCH_INDEXER_ALLOWED_ENTITY_NAMES',
  IGNORED_ENTITY_NAMES: 'SEARCH_INDEXER_IGNORED_ENTITY_NAMES'
} as const;


export interface SearchIndexEntry {
  entityName: string;
  eventType: 'create' | 'update' | 'delete';
  data: any;
  id: string;
  timestamp?: string;
} 