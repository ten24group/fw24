import { EntitySchema } from "../entity/base-entity";
import { EntitySearchQuery } from "./types";
export interface MakeEntitySearchIndexNameOptions {
    entityName: string;
    tableName: string;
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
export declare function makeEntitySearchIndexName({ entityName, tableName }: MakeEntitySearchIndexNameOptions): string;
export declare function parseSearchQuery<Sch extends EntitySchema<any, any, any> = EntitySchema<any, any, any>>(params: Record<string, any>): EntitySearchQuery<Sch>;
