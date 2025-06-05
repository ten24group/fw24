
export interface MakeEntitySearchIndexNameOptions {
  entityName: string,
  tableName: string
}


/**
 * Creates a standardized search index name for an entity
 * 
 * @param options - Configuration options for creating the index name
 * @param options.entityName - The name of the entity (e.g., 'User', 'Product')
 * @param options.tableName - The name of the database table (e.g., 'plusfan', 'myapp')
 * @returns A lowercase, hyphen-separated index name
 * 
 * @example
 * ```typescript
 * // Create index name for User entity in plusfan table
 * const indexName = makeEntitySearchIndexName({
 *   entityName: 'User',
 *   tableName: 'plusfan'
 * });
 * // Returns: 'plusfan-user'
 * 
 * // Create index name for Product entity in ecommerce table
 * const productIndex = makeEntitySearchIndexName({
 *   entityName: 'Product',
 *   tableName: 'ecommerce'
 * });
 * // Returns: 'ecommerce-product'
 * ```
 */
export function makeEntitySearchIndexName({
  entityName,
  tableName
}: MakeEntitySearchIndexNameOptions) {

  const indexName = [
    tableName,
    entityName.toLowerCase(),
  ].filter(Boolean).join('-').toLowerCase();

  return indexName;
}