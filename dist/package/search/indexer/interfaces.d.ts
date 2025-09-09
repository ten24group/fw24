/**
 * Environment variable keys used for search indexer configuration
 */
/**
 * Constant containing the actual environment variable keys
 */
export declare const SEARCH_INDEXER_ENV_KEYS: {
    readonly ENABLED: "SEARCH_INDEXER_ENABLED";
    readonly TABLE_NAME_ENV_KEY: "TABLE_NAME_ENV_KEY";
    readonly MEILI_HOST: "MEILI_HOST";
    readonly MEILI_MASTER_KEY: "MEILI_MASTER_KEY";
    readonly ALLOWED_ENTITY_NAMES: "SEARCH_INDEXER_ALLOWED_ENTITY_NAMES";
    readonly IGNORED_ENTITY_NAMES: "SEARCH_INDEXER_IGNORED_ENTITY_NAMES";
};
export interface SearchIndexEntry {
    entityName: string;
    eventType: 'create' | 'update' | 'delete';
    data: any;
    id: string;
    timestamp?: string;
}
