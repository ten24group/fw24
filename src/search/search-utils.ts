
export interface MakeEntitySearchIndexNameOptions {
  entityName: string,
  version?: string,
  environment?: string,
  application?: string,
  tenant?: string,
}

/**
 * Makes a search index name for an entity based on provided options.
 * The name is constructed by joining the entity name, version, environment, application, and tenant
 * with hyphens, filtering out any empty values, and appending '-search-index'.
 * All parts are converted to lowercase.
 *
 * @param options - The options for the search index name.
 * @param options.entityName - The name of the entity (required).
 * @param options.version - The version of the entity or schema (optional).
 * @param options.environment - The environment identifier (optional).
 * @param options.application - The application identifier (optional).
 * @param options.tenant - The tenant identifier (optional).
 * @returns The generated search index name.
 *
 * @example
 * ```typescript
 * // Example usage:
 * const indexName = makeEntitySearchIndexName({
 *   entityName: 'User',
 *   tenant: 'ten24',
 *   environment: 'dev',
 *   application: 'backend'
 * });
 * // indexName will be 'user-dev-backend-ten24-search-index'
 *
 * const simpleIndexName = makeEntitySearchIndexName({
 *   entityName: 'Product'
 * });
 * // simpleIndexName will be 'product-search-index'
 * ```
 */
export function makeEntitySearchIndexName({
  entityName,
  version,
  environment,
  application,
  tenant,
}: MakeEntitySearchIndexNameOptions) {

  const indexName = [
    entityName.toLowerCase(),
    version,
    environment,
    application,
    tenant,
    'search-index'
  ].filter(Boolean).join('-').toLowerCase();

  return indexName;
}