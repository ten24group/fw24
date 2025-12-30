import { EntitySchema } from "../entity/base-entity";
import { parseUrlQueryStringParameters, queryStringParamsToFilterGroup } from "../entity/query";
import { isString } from "../utils";
import { EntitySearchQuery } from "./types";

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


export function parseSearchQuery<Sch extends EntitySchema<any, any, any> = EntitySchema<any, any, any>>(params: Record<string, any>): EntitySearchQuery<Sch> {

  const { q, query, search, attributes: attributesParam, hitsPerPage, page, facets: facetsParam, sort: sortParam, limit: _legacyLimit, cursor: _legacyCursor, ...rest } = params;


  let parsedSelect: string[] | undefined = undefined;
  if (isString(attributesParam)) {
    parsedSelect = attributesParam.split(',');
  } else if (Array.isArray(attributesParam)) {
    parsedSelect = attributesParam.filter(attr => typeof attr === 'string');
  }

  let parsedFacets: string[] | undefined = undefined;
  if (isString(facetsParam)) {
    parsedFacets = facetsParam.split(',');
  } else if (Array.isArray(facetsParam)) {
    parsedFacets = facetsParam.filter(facet => typeof facet === 'string');
  }

  let parsedSort: EntitySearchQuery<Sch>[ 'sort' ] | undefined;
  let tempSort: { field: string, dir: 'asc' | 'desc' }[] | undefined;

  if (isString(sortParam)) {
    tempSort = sortParam.split(',')
      .map(s => {
        const [ field, dirInput ] = s.split(':');
        const dir = dirInput?.toLowerCase() === 'desc' ? 'desc' : 'asc';
        return { field, dir };
      });
  } else if (Array.isArray(sortParam)) {
    tempSort = sortParam
      .filter(s => s && typeof s.field === 'string')
      .map(s => ({ field: s.field, dir: s.dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' } as const));
  }

  if (tempSort?.length) {
    parsedSort = tempSort as EntitySearchQuery<Sch>[ 'sort' ];
  }

  const parsedQueryParams = parseUrlQueryStringParameters(rest);
  const parsedQueryParamFilters = queryStringParamsToFilterGroup(parsedQueryParams);
  const finalFilters = parsedQueryParamFilters as EntitySearchQuery<Sch>[ 'filters' ];

  // Convert search value to string to handle numeric search terms
  const searchValue = search || q || query;
  const normalizedSearch = searchValue != null ? String(searchValue) : undefined;

  return {
    search: normalizedSearch, // q and query should be removed
    filters: finalFilters,
    select: (parsedSelect?.length ? parsedSelect : undefined) as EntitySearchQuery<Sch>[ 'select' ],
    facets: (parsedFacets?.length ? parsedFacets : undefined) as EntitySearchQuery<Sch>[ 'facets' ],
    sort: parsedSort,
    pagination: {
      limit: parseInt(hitsPerPage || _legacyLimit, 10) || 20,
      page: parseInt(page, 10) || 1,
      usePagination: true
    }
  };
}