"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeEntitySearchIndexName = makeEntitySearchIndexName;
exports.parseSearchQuery = parseSearchQuery;
const query_1 = require("../entity/query");
const utils_1 = require("../utils");
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
function makeEntitySearchIndexName({ entityName, tableName }) {
    const indexName = [
        tableName,
        entityName.toLowerCase(),
    ].filter(Boolean).join('-').toLowerCase();
    return indexName;
}
function parseSearchQuery(params) {
    const { q, query, search, attributes: attributesParam, hitsPerPage, page, facets: facetsParam, sort: sortParam, limit: _legacyLimit, cursor: _legacyCursor, ...rest } = params;
    let parsedSelect = undefined;
    if ((0, utils_1.isString)(attributesParam)) {
        parsedSelect = attributesParam.split(',');
    }
    else if (Array.isArray(attributesParam)) {
        parsedSelect = attributesParam.filter(attr => typeof attr === 'string');
    }
    let parsedFacets = undefined;
    if ((0, utils_1.isString)(facetsParam)) {
        parsedFacets = facetsParam.split(',');
    }
    else if (Array.isArray(facetsParam)) {
        parsedFacets = facetsParam.filter(facet => typeof facet === 'string');
    }
    let parsedSort;
    let tempSort;
    if ((0, utils_1.isString)(sortParam)) {
        tempSort = sortParam.split(',')
            .map(s => {
            const [field, dirInput] = s.split(':');
            const dir = dirInput?.toLowerCase() === 'desc' ? 'desc' : 'asc';
            return { field, dir };
        });
    }
    else if (Array.isArray(sortParam)) {
        tempSort = sortParam
            .filter(s => s && typeof s.field === 'string')
            .map(s => ({ field: s.field, dir: s.dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' }));
    }
    if (tempSort?.length) {
        parsedSort = tempSort;
    }
    const parsedQueryParams = (0, query_1.parseUrlQueryStringParameters)(rest);
    const parsedQueryParamFilters = (0, query_1.queryStringParamsToFilterGroup)(parsedQueryParams);
    const finalFilters = parsedQueryParamFilters;
    // Convert search value to string to handle numeric search terms
    const searchValue = search || q || query;
    const normalizedSearch = searchValue != null ? String(searchValue) : undefined;
    return {
        search: normalizedSearch, // q and query should be removed
        filters: finalFilters,
        select: (parsedSelect?.length ? parsedSelect : undefined),
        facets: (parsedFacets?.length ? parsedFacets : undefined),
        sort: parsedSort,
        pagination: {
            limit: parseInt(hitsPerPage || _legacyLimit, 10) || 20,
            page: parseInt(page, 10) || 1,
            usePagination: true
        }
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLXV0aWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlYXJjaC9zZWFyY2gtdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFvQ0EsOERBV0M7QUFHRCw0Q0EyREM7QUE1R0QsMkNBQWdHO0FBQ2hHLG9DQUFvQztBQVNwQzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBd0JHO0FBQ0gsU0FBZ0IseUJBQXlCLENBQUMsRUFDeEMsVUFBVSxFQUNWLFNBQVMsRUFDd0I7SUFFakMsTUFBTSxTQUFTLEdBQUc7UUFDaEIsU0FBUztRQUNULFVBQVUsQ0FBQyxXQUFXLEVBQUU7S0FDekIsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRTFDLE9BQU8sU0FBUyxDQUFDO0FBQ25CLENBQUM7QUFHRCxTQUFnQixnQkFBZ0IsQ0FBd0UsTUFBMkI7SUFFakksTUFBTSxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxlQUFlLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxNQUFNLEVBQUUsYUFBYSxFQUFFLEdBQUcsSUFBSSxFQUFFLEdBQUcsTUFBTSxDQUFDO0lBRy9LLElBQUksWUFBWSxHQUF5QixTQUFTLENBQUM7SUFDbkQsSUFBSSxJQUFBLGdCQUFRLEVBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztRQUM5QixZQUFZLEdBQUcsZUFBZSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUM1QyxDQUFDO1NBQU0sSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7UUFDMUMsWUFBWSxHQUFHLGVBQWUsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FB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WUFDdEQsSUFBSSxFQUFFLFFBQVEsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQztZQUM3QixhQUFhLEVBQUUsSUFBSTtTQUNwQjtLQUNGLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRW50aXR5U2NoZW1hIH0gZnJvbSBcIi4uL2VudGl0eS9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHsgcGFyc2VVcmxRdWVyeVN0cmluZ1BhcmFtZXRlcnMsIHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCB9IGZyb20gXCIuLi9lbnRpdHkvcXVlcnlcIjtcbmltcG9ydCB7IGlzU3RyaW5nIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBFbnRpdHlTZWFyY2hRdWVyeSB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZU9wdGlvbnMge1xuICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gIHRhYmxlTmFtZTogc3RyaW5nXG59XG5cblxuLyoqXG4gKiBDcmVhdGVzIGEgc3RhbmRhcmRpemVkIHNlYXJjaCBpbmRleCBuYW1lIGZvciBhbiBlbnRpdHlcbiAqIFxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIGNyZWF0aW5nIHRoZSBpbmRleCBuYW1lXG4gKiBAcGFyYW0gb3B0aW9ucy5lbnRpdHlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGVudGl0eSAoZS5nLiwgJ1VzZXInLCAnUHJvZHVjdCcpXG4gKiBAcGFyYW0gb3B0aW9ucy50YWJsZU5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgZGF0YWJhc2UgdGFibGUgKGUuZy4sICdwbHVzZmFuJywgJ215YXBwJylcbiAqIEByZXR1cm5zIEEgbG93ZXJjYXNlLCBoeXBoZW4tc2VwYXJhdGVkIGluZGV4IG5hbWVcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIENyZWF0ZSBpbmRleCBuYW1lIGZvciBVc2VyIGVudGl0eSBpbiBwbHVzZmFuIHRhYmxlXG4gKiBjb25zdCBpbmRleE5hbWUgPSBtYWtlRW50aXR5U2VhcmNoSW5kZXhOYW1lKHtcbiAqICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICogICB0YWJsZU5hbWU6ICdwbHVzZmFuJ1xuICogfSk7XG4gKiAvLyBSZXR1cm5zOiAncGx1c2Zhbi11c2VyJ1xuICogXG4gKiAvLyBDcmVhdGUgaW5kZXggbmFtZSBmb3IgUHJvZHVjdCBlbnRpdHkgaW4gZWNvbW1lcmNlIHRhYmxlXG4gKiBjb25zdCBwcm9kdWN0SW5kZXggPSBtYWtlRW50aXR5U2VhcmNoSW5kZXhOYW1lKHtcbiAqICAgZW50aXR5TmFtZTogJ1Byb2R1Y3QnLFxuICogICB0YWJsZU5hbWU6ICdlY29tbWVyY2UnXG4gKiB9KTtcbiAqIC8vIFJldHVybnM6ICdlY29tbWVyY2UtcHJvZHVjdCdcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSh7XG4gIGVudGl0eU5hbWUsXG4gIHRhYmxlTmFtZVxufTogTWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZU9wdGlvbnMpIHtcblxuICBjb25zdCBpbmRleE5hbWUgPSBbXG4gICAgdGFibGVOYW1lLFxuICAgIGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKSxcbiAgXS5maWx0ZXIoQm9vbGVhbikuam9pbignLScpLnRvTG93ZXJDYXNlKCk7XG5cbiAgcmV0dXJuIGluZGV4TmFtZTtcbn1cblxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTZWFyY2hRdWVyeTxTY2ggZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4+KHBhcmFtczogUmVjb3JkPHN0cmluZywgYW55Pik6IEVudGl0eVNlYXJjaFF1ZXJ5PFNjaD4ge1xuXG4gIGNvbnN0IHsgcSwgcXVlcnksIHNlYXJjaCwgYXR0cmlidXRlczogYXR0cmlidXRlc1BhcmFtLCBoaXRzUGVyUGFnZSwgcGFnZSwgZmFjZXRzOiBmYWNldHNQYXJhbSwgc29ydDogc29ydFBhcmFtLCBsaW1pdDogX2xlZ2FjeUxpbWl0LCBjdXJzb3I6IF9sZWdhY3lDdXJzb3IsIC4uLnJlc3QgfSA9IHBhcmFtcztcblxuXG4gIGxldCBwYXJzZWRTZWxlY3Q6IHN0cmluZ1tdIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICBpZiAoaXNTdHJpbmcoYXR0cmlidXRlc1BhcmFtKSkge1xuICAgIHBhcnNlZFNlbGVjdCA9IGF0dHJpYnV0ZXNQYXJhbS5zcGxpdCgnLCcpO1xuICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlc1BhcmFtKSkge1xuICAgIHBhcnNlZFNlbGVjdCA9IGF0dHJpYnV0ZXNQYXJhbS5maWx0ZXIoYXR0ciA9PiB0eXBlb2YgYXR0ciA9PT0gJ3N0cmluZycpO1xuICB9XG5cbiAgbGV0IHBhcnNlZEZhY2V0czogc3RyaW5nW10gfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG4gIGlmIChpc1N0cmluZyhmYWNldHNQYXJhbSkpIHtcbiAgICBwYXJzZWRGYWNldHMgPSBmYWNldHNQYXJhbS5zcGxpdCgnLCcpO1xuICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoZmFjZXRzUGFyYW0pKSB7XG4gICAgcGFyc2VkRmFjZXRzID0gZmFjZXRzUGFyYW0uZmlsdGVyKGZhY2V0ID0+IHR5cGVvZiBmYWNldCA9PT0gJ3N0cmluZycpO1xuICB9XG5cbiAgbGV0IHBhcnNlZFNvcnQ6IEVudGl0eVNlYXJjaFF1ZXJ5PFNjaD5bICdzb3J0JyBdIHwgdW5kZWZpbmVkO1xuICBsZXQgdGVtcFNvcnQ6IHsgZmllbGQ6IHN0cmluZywgZGlyOiAnYXNjJyB8ICdkZXNjJyB9W10gfCB1bmRlZmluZWQ7XG5cbiAgaWYgKGlzU3RyaW5nKHNvcnRQYXJhbSkpIHtcbiAgICB0ZW1wU29ydCA9IHNvcnRQYXJhbS5zcGxpdCgnLCcpXG4gICAgICAubWFwKHMgPT4ge1xuICAgICAgICBjb25zdCBbIGZpZWxkLCBkaXJJbnB1dCBdID0gcy5zcGxpdCgnOicpO1xuICAgICAgICBjb25zdCBkaXIgPSBkaXJJbnB1dD8udG9Mb3dlckNhc2UoKSA9PT0gJ2Rlc2MnID8gJ2Rlc2MnIDogJ2FzYyc7XG4gICAgICAgIHJldHVybiB7IGZpZWxkLCBkaXIgfTtcbiAgICAgIH0pO1xuICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoc29ydFBhcmFtKSkge1xuICAgIHRlbXBTb3J0ID0gc29ydFBhcmFtXG4gICAgICAuZmlsdGVyKHMgPT4gcyAmJiB0eXBlb2Ygcy5maWVsZCA9PT0gJ3N0cmluZycpXG4gICAgICAubWFwKHMgPT4gKHsgZmllbGQ6IHMuZmllbGQsIGRpcjogcy5kaXI/LnRvTG93ZXJDYXNlKCkgPT09ICdkZXNjJyA/ICdkZXNjJyA6ICdhc2MnIH0gYXMgY29uc3QpKTtcbiAgfVxuXG4gIGlmICh0ZW1wU29ydD8ubGVuZ3RoKSB7XG4gICAgcGFyc2VkU29ydCA9IHRlbXBTb3J0IGFzIEVudGl0eVNlYXJjaFF1ZXJ5PFNjaD5bICdzb3J0JyBdO1xuICB9XG5cbiAgY29uc3QgcGFyc2VkUXVlcnlQYXJhbXMgPSBwYXJzZVVybFF1ZXJ5U3RyaW5nUGFyYW1ldGVycyhyZXN0KTtcbiAgY29uc3QgcGFyc2VkUXVlcnlQYXJhbUZpbHRlcnMgPSBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAocGFyc2VkUXVlcnlQYXJhbXMpO1xuICBjb25zdCBmaW5hbEZpbHRlcnMgPSBwYXJzZWRRdWVyeVBhcmFtRmlsdGVycyBhcyBFbnRpdHlTZWFyY2hRdWVyeTxTY2g+WyAnZmlsdGVycycgXTtcblxuICAvLyBDb252ZXJ0IHNlYXJjaCB2YWx1ZSB0byBzdHJpbmcgdG8gaGFuZGxlIG51bWVyaWMgc2VhcmNoIHRlcm1zXG4gIGNvbnN0IHNlYXJjaFZhbHVlID0gc2VhcmNoIHx8IHEgfHwgcXVlcnk7XG4gIGNvbnN0IG5vcm1hbGl6ZWRTZWFyY2ggPSBzZWFyY2hWYWx1ZSAhPSBudWxsID8gU3RyaW5nKHNlYXJjaFZhbHVlKSA6IHVuZGVmaW5lZDtcblxuICByZXR1cm4ge1xuICAgIHNlYXJjaDogbm9ybWFsaXplZFNlYXJjaCwgLy8gcSBhbmQgcXVlcnkgc2hvdWxkIGJlIHJlbW92ZWRcbiAgICBmaWx0ZXJzOiBmaW5hbEZpbHRlcnMsXG4gICAgc2VsZWN0OiAocGFyc2VkU2VsZWN0Py5sZW5ndGggPyBwYXJzZWRTZWxlY3QgOiB1bmRlZmluZWQpIGFzIEVudGl0eVNlYXJjaFF1ZXJ5PFNjaD5bICdzZWxlY3QnIF0sXG4gICAgZmFjZXRzOiAocGFyc2VkRmFjZXRzPy5sZW5ndGggPyBwYXJzZWRGYWNldHMgOiB1bmRlZmluZWQpIGFzIEVudGl0eVNlYXJjaFF1ZXJ5PFNjaD5bICdmYWNldHMnIF0sXG4gICAgc29ydDogcGFyc2VkU29ydCxcbiAgICBwYWdpbmF0aW9uOiB7XG4gICAgICBsaW1pdDogcGFyc2VJbnQoaGl0c1BlclBhZ2UgfHwgX2xlZ2FjeUxpbWl0LCAxMCkgfHwgMjAsXG4gICAgICBwYWdlOiBwYXJzZUludChwYWdlLCAxMCkgfHwgMSxcbiAgICAgIHVzZVBhZ2luYXRpb246IHRydWVcbiAgICB9XG4gIH07XG59Il19