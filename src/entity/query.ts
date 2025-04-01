import type { Item, WhereAttributes, WhereOperations } from 'electrodb';
import type { EntitySchema } from './base-entity';
import type {
  AttributeFilter,
  EntityFilter,
  EntityFilterCriteria,
  FilterCriteria,
  FilterGroup,
  ParsedEntityAttributePaths,
} from './query-types';

import { createLogger } from '../logging';
import { isAttributeFilter, isComplexFilterValue, isEntityFilter, isFilterGroup } from './query-types';

import { parse as parseQueryString, stringify as stringifyQueryParams } from 'qs';

import { isObject, parseValueToCorrectTypes } from '../utils';

const logger = createLogger('EntityQuery');

/**
 * Parses the given array of entity attribute paths into a structured format.
 * @param paths - The array of entity attribute paths.
 * @returns The parsed entity attribute paths.
 *
 * @example
 * ```ts
 * const paths = ['user.name', 'user.age', 'user.address.city'];
 * const parsed = parseEntityAttributePaths(paths);
 *
 * console.log(parsed);
 * // Output:
 * // {
 * //   user: {
 * //     name: true,
 * //     age: true,
 * //     address: {
 * //       city: true
 * //     }
 * //   }
 * // }
 * ```
 */
export function parseEntityAttributePaths(paths: string[]): ParsedEntityAttributePaths {
  type ParsedAttributePaths = {
    [key: string]: boolean | ParsedAttributePaths;
  };

  const parsed = paths.reduce<ParsedEntityAttributePaths>((acc, path) => {
    const keys = path.split('.');

    keys.reduce<ParsedAttributePaths>((obj, key, index) => {
      if (index === keys.length - 1) {
        if (typeof obj[key] === 'object') {
          // If the key already exists as an object, do nothing
        } else {
          // If the key doesn't exist or is a boolean, set it to true
          obj[key] = true;
        }
      } else {
        if (typeof obj[key] === 'boolean') {
          // If the key already exists as a boolean, convert it to an object
          obj[key] = {};
        } else {
          // If the key doesn't exist, set it to an object
          obj[key] = obj[key] || {};
        }
      }

      return obj[key] as ParsedAttributePaths;
    }, acc);

    return acc;
  }, {});

  const format = (obj: ParsedAttributePaths): ParsedEntityAttributePaths => {
    const res: ParsedEntityAttributePaths = {};
    Object.entries(obj).forEach(([key, val]) => {
      if (isObject(val)) {
        res[key] = { attributes: format(val) };
      } else {
        res[key] = true;
      }
    });
    return res;
  };

  return format(parsed);
}

export function attributeFilterToExpression<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C>,
  I extends Item<A, F, C, S, S['attributes']>,
  WAttributes extends WhereAttributes<A, F, C, S, I>,
  WOperations extends WhereOperations<A, F, C, S, I>,
>(filter: AttributeFilter<any>, attributes: WAttributes, operations: WOperations) {
  const { filterId: id, filterLabel: label, attribute: prop, logicalOp = 'and', ...filters } = filter;

  const attributeRef = attributes[prop as keyof WAttributes];

  if (!attributeRef) {
    logger.error(`Invalid filter property`, { prop, filter, attributes });
    throw `Invalid filter property ${prop?.toString()}`;
  }

  const filterFragments: Array<string> = [];
  const { eq, ne, gt, gte, lt, lte, between, begins, exists, notExists, contains, notContains, name, size, type } =
    operations;

  for (const filterKey in filters) {
    let filterVal = filters[filterKey as keyof typeof filters];

    if (isComplexFilterValue(filterVal)) {
      // TODO: handle `expression` filter values
      filterVal = filterVal?.valType == 'propRef' ? name(filterVal.val) : filterVal.val;
    }

    if (['equalTo', 'equal', 'eq', '==', '==='].includes(filterKey)) {
      filterFragments.push(eq(attributeRef, filterVal));
    } else if (['notEqualTo', 'notEqual', 'neq', 'ne', '!=', '!==', '<>'].includes(filterKey)) {
      filterFragments.push(ne(attributeRef, filterVal));
    } else if (['greaterThen', 'gt', '>'].includes(filterKey)) {
      filterFragments.push(gt(attributeRef, filterVal));
    } else if (['greaterThenOrEqualTo', 'gte', '>=', '>=='].includes(filterKey)) {
      filterFragments.push(gte(attributeRef, filterVal));
    } else if (['lessThen', 'lt', '<'].includes(filterKey)) {
      filterFragments.push(lt(attributeRef, filterVal));
    } else if (['lessThenOrEqualTo', 'lte', '<=', '<=='].includes(filterKey)) {
      filterFragments.push(lte(attributeRef, filterVal));
    } else if (['between', 'bt', 'bw', '><'].includes(filterKey)) {
      filterFragments.push(between(attributeRef, filterVal[0], filterVal[1]));
    } else if (['like', 'begins', 'startsWith', 'beginsWith'].includes(filterKey)) {
      filterFragments.push(begins(attributeRef, filterVal));
    } else if (['contains', 'has', 'includes', 'containsSome'].includes(filterKey)) {
      filterVal = Array.isArray(filterVal) ? filterVal : [filterVal];
      const logicalOpp = filterKey === 'containsSome' ? 'OR' : 'AND';

      const listFilters = filterVal.map((val: any) => contains(attributeRef, val));

      filterFragments.push(makeParenthesesGroup(listFilters, logicalOpp));
    } else if (['notContains', 'notHas', 'notIncludes'].includes(filterKey)) {
      filterVal = Array.isArray(filterVal) ? filterVal : [filterVal];

      const listFilters = filterVal.map((val: any) => notContains(attributeRef, val));

      filterFragments.push(makeParenthesesGroup(listFilters, 'AND'));
    } else if (['in', 'inList'].includes(filterKey)) {
      filterVal = Array.isArray(filterVal) ? filterVal : [filterVal];

      const listFilters = filterVal.map((val: any) => eq(attributeRef, val));

      filterFragments.push(makeParenthesesGroup(listFilters, 'OR'));
    } else if (['nin', 'notIn', 'notInList'].includes(filterKey)) {
      filterVal = Array.isArray(filterVal) ? filterVal : [filterVal];

      const listFilters = filterVal.map((val: any) => ne(attributeRef, val));

      filterFragments.push(makeParenthesesGroup(listFilters, 'AND'));
    } else if (['exists', 'isNull'].includes(filterKey)) {
      filterFragments.push(filterVal ? exists(attributeRef) : notExists(attributeRef));
    } else if (['isEmpty'].includes(filterKey)) {
      filterFragments.push(
        filterVal ? eq(attributeRef as string, '' as string) : ne(attributeRef as string, '' as string),
      );
    }
  }

  const filterExpression = makeParenthesesGroup(filterFragments, logicalOp);

  return filterExpression;
}

export function makeParenthesesGroup(items: Array<string>, delimiter: string): string {
  return items.length > 1 ? '( ' + items.join(` ${delimiter.toUpperCase()} `) + ' )' : items[0];
}

/**
 * Converts an entity filter to a filter group.
 * @param entityFilter The entity filter to convert.
 * @returns The converted filter group.
 * @throws Error if the entity filter is invalid.
 *
 * @example
 *
 * ```ts
 * interface UserEntitySchema {
 *   // rest of the schema stuff...
 *   attributes: {
 *     id: { type: 'string' };
 *     name: { type: 'string' };
 *     age: { type: 'number' };
 *   };
 * }
 *
 * const userFilter: EntityFilter<UserEntitySchema> = {
 *     id: { eq: '123' },
 *     name: { like: 'John' },
 *     age: { gte: 18 },
 * };
 *
 * const userFilterGroup = entityFilterToFilterGroup(userFilter);
 * expect(userFilterGroup).to.deep.equal({
 *     and: [
 *         { attribute: 'id', eq: '123' },
 *         { attribute: 'name', like: 'John' },
 *         { attribute: 'age', gte: 18 },
 *     ],
 * });
 * ```
 * * 'and' becomes the default logical operator if not specified in the filter.
 *
 */
export function entityFilterToFilterGroup<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C>,
>(entityFilter: EntityFilter<S>): FilterGroup<S> {
  if (!isEntityFilter(entityFilter)) {
    throw new Error(`invalid entity filter ${entityFilter}`);
  }

  const entityFilterGroup: FilterGroup<S> = {};
  const { filterId, filterLabel: label, logicalOp = 'and', ...entityPopsFilters } = entityFilter;

  entityFilterGroup.filterId = filterId;
  entityFilterGroup.filterLabel = label;

  const logicalOpFilters = Object.entries<FilterCriteria<any>>(
    entityPopsFilters as { [s: string]: FilterCriteria<any> },
  ).map(([key, val]): AttributeFilter<any> => {
    return { ...val, attribute: key };
  });

  entityFilterGroup[logicalOp] = logicalOpFilters as any;

  return entityFilterGroup;
}

/**
 * Converts the entity filter criteria into a filter expression.
 * @param entityFilterCriteria The entity filter criteria to convert.
 * @param attributes The attributes for the filter expression.
 * @param operations The operations for the filter expression.
 * @returns The filter expression.
 */
export function entityFilterToExpression<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C>,
  I extends Item<A, F, C, S, S['attributes']>,
  WAttributes extends WhereAttributes<A, F, C, S, I>,
  WOperations extends WhereOperations<A, F, C, S, I>,
>(entityFilterCriteria: EntityFilterCriteria<S>, attributes: WAttributes, operations: WOperations) {
  const filterGroup = entityFilterToFilterGroup(entityFilterCriteria);

  const expression = filterGroupToExpression(filterGroup, attributes, operations);

  return expression;
}

/**
 * Converts the given entity filter criteria to an expression.
 *
 * @param filterCriteria - The entity filter criteria to convert.
 * @param attributes - The attributes for the filter criteria.
 * @param operations - The operations for the filter criteria.
 * @returns The expression representing the converted filter criteria.
 */
export function entityFilterCriteriaToExpression<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C>,
  I extends Item<A, F, C, S, S['attributes']>,
  WAttributes extends WhereAttributes<A, F, C, S, I>,
  WOperations extends WhereOperations<A, F, C, S, I>,
>(filterCriteria: EntityFilterCriteria<S>, attributes: WAttributes, operations: WOperations) {
  const expression = filterCriteriaOrFilterGroupOrAttributeFilterToExpression({
    filterCriteria,
    attributes,
    operations,
  });

  return expression;
}

/**
 * Converts a filter criteria, filter group, or attribute filter to an expression.
 * @param options - The options object containing the filter criteria, attributes, and operations.
 * @returns The expression representing the converted filter criteria.
 * @throws An error if the filter criteria is not a valid EntityFilterGroup, EntityFilterCriteria, or EntityAttributeFilterCriteria.
 */
export function filterCriteriaOrFilterGroupOrAttributeFilterToExpression<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C>,
  I extends Item<A, F, C, S, S['attributes']>,
  WAttributes extends WhereAttributes<A, F, C, S, I>,
  WOperations extends WhereOperations<A, F, C, S, I>,
>(options: { filterCriteria: EntityFilter<S>; attributes: WAttributes; operations: WOperations }) {
  const { filterCriteria, attributes, operations } = options;

  if (isEntityFilter(filterCriteria)) {
    return entityFilterToExpression(filterCriteria, attributes, operations);
  } else if (isFilterGroup(filterCriteria)) {
    return filterGroupToExpression(filterCriteria, attributes, operations);
  } else if (isAttributeFilter(filterCriteria)) {
    return attributeFilterToExpression(filterCriteria, attributes, operations);
  }

  const msg = `entityFilters is not a EntityFilterGroup or EntityFilterCriteria or EntityAttributeFilterCriteria`;

  logger.error(`filterCriteriaOrFilterGroupToExpression: ${msg}`, { filterCriteria });

  throw new Error(`${msg}`);
}

/**
 * Converts a filter group object into a filter expression string.
 * @param filterGroup - The filter group object to convert.
 * @param attributes - The attributes object.
 * @param operations - The operations object.
 * @returns The filter expression string.
 */
export function filterGroupToExpression<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C>,
  I extends Item<A, F, C, S, S['attributes']>,
  WAttributes extends WhereAttributes<A, F, C, S, I>,
  WOperations extends WhereOperations<A, F, C, S, I>,
>(filterGroup: FilterGroup<any>, attributes: WAttributes, operations: WOperations) {
  const { filterId: id, filterLabel: label, and = [], or = [], not = [] } = filterGroup;

  const filterGroupFragments: Array<string> = [];

  const andFragments: Array<string> = [];

  for (const thisFilter of and) {
    const thisExpression = filterCriteriaOrFilterGroupOrAttributeFilterToExpression({
      filterCriteria: thisFilter,
      attributes,
      operations,
    });
    if (thisExpression.length) {
      andFragments.push(thisExpression);
    }
  }

  if (andFragments.length) {
    const andExpressions = makeParenthesesGroup(andFragments, 'and');
    filterGroupFragments.push(andExpressions);
  }

  const orFragments: Array<string> = [];
  for (const thisFilter of or) {
    const thisExpression = filterCriteriaOrFilterGroupOrAttributeFilterToExpression({
      filterCriteria: thisFilter,
      attributes,
      operations,
    });
    if (thisExpression.length) {
      orFragments.push(thisExpression);
    }
  }
  if (orFragments.length) {
    const orExpressions = makeParenthesesGroup(orFragments, 'or');
    filterGroupFragments.push(orExpressions);
  }

  const notFragments: Array<string> = [];
  for (const thisFilter of not) {
    const thisExpression = filterCriteriaOrFilterGroupOrAttributeFilterToExpression({
      filterCriteria: thisFilter,
      attributes,
      operations,
    });
    if (thisExpression.length) {
      notFragments.push(thisExpression);
    }
  }
  if (notFragments.length) {
    const notExpressions = makeParenthesesGroup(notFragments, 'AND NOT');
    filterGroupFragments.push(notExpressions);
  }

  const filterExpression = makeParenthesesGroup(filterGroupFragments, 'AND');

  return filterExpression;
}

/**
 * Parses the query string parameters from an object into a structured format.
 * @param queryStringParameters - The query string parameters as an object.
 * @returns The parsed query string parameters.
 *
 * @example
 * ```ts
 *  const queryStringParameters = {
 *      'user.name': 'John',
 *      'user.age': '30',
 *      'user.hobbies': 'reading,writing',
 *      'user.address.city': 'New York',
 *      'user.address.country': 'USA',
 *  };
 *
 *  const parsed = parseUrlQueryStringParameters(queryStringParameters);
 *
 *  expect(parsed).to.deep.equal({
 *      user: {
 *      name: 'John',
 *      age: '30',
 *      hobbies: ['reading', 'writing'],
 *      address: {
 *          city: 'New York',
 *          country: 'USA',
 *      },
 *      },
 *  });
 * ```
 */
export function parseUrlQueryStringParameters(queryStringParameters: { [name: string]: string | undefined }) {
  const queryString = stringifyQueryParams(queryStringParameters);

  const parsed = parseQueryString(queryString, {
    delimiter: /[;,&:+]/,
    allowDots: true,
    decodeDotInKeys: true,
    parseArrays: true,
    duplicates: 'combine',
    allowEmptyArrays: false,
  });

  return parsed;
}

/**
 * Regular expression pattern used to parse value delimiters.
 * The pattern matches any of the following characters: &, ,, +, ;, :, or ..
 */
export const PARSE_VALUE_DELIMITERS = /(?:&|,|\+|;|:|\.)+/;
/**
 * An array of filter keys that can have array values.
 */
export const FILTER_KEYS_HAVING_ARRAY_VALUES = [
  'in',
  'inList',
  'nin',
  'notIn',
  'notInList',
  'contains',
  'includes',
  'has',
  'notContains',
  'notIncludes',
  'notHas',
];

/**
 * Converts a query string parameter into a filter object.
 * @param paramName - The name of the query string parameter.
 * @param paramValue - The value of the query string parameter.
 * @returns The formatted filter object.
 */
export function makeFilterFromQueryStringParam(paramName: string, paramValue: any) {
  /**
   *  { paramName: or,  paramValue: [{ foo: { eq: '1' }}, { foo: { neq: '3' } }] }
   */
  if (['and', 'or', 'not'].includes(paramName)) {
    let formattedGroupVal: Array<any> = [];

    paramValue.forEach((item: any) => {
      Object.keys(item).forEach((itemKey: string) => {
        const itemValue = item[itemKey];
        const formattedItems = makeFilterFromQueryStringParam(itemKey, itemValue);
        formattedGroupVal = formattedGroupVal.concat(formattedItems);
      });
    });

    return formattedGroupVal;
  }

  const formattedValues: any = {};

  if (!isObject(paramValue)) {
    paramValue = { eq: paramValue };
  }

  /*
        foo: {
            eq: '1',
            neq: '3',
            in: [232,kl,klk],
            nin: qwq,334,jhj,
            contains: hj+hjj+yuy7
        }
    */
  Object.keys(paramValue).forEach(key => {
    const keyVal = paramValue[key];
    let formattedVal = keyVal;

    // parse the values to the right types here
    if (FILTER_KEYS_HAVING_ARRAY_VALUES.includes(key) && typeof keyVal === 'string') {
      formattedVal = keyVal.split(PARSE_VALUE_DELIMITERS);
    }

    formattedVal = parseValueToCorrectTypes(formattedVal);

    formattedValues[key] = formattedVal;
  });

  const formattedItemVal = {
    attribute: paramName,
    ...formattedValues,
  };

  return formattedItemVal;
}

/**
 * Converts query string parameters to a filter group.
 * @param queryStringParams - The query string parameters.
 * @returns The formatted filter group.
 * @example
 * ```ts
 *  const queryStringParams = {
 *      'and': [
 *          { 'user.age': { 'gt': '30' } },
 *          { 'user.hobbies': { 'in': 'reading,writing' } },
 *      ],
 *      'or': [
 *          { 'user.name': { 'eq': 'John' } },
 *          { 'user.address.city': { 'eq': 'New York' } },
 *      ],
 *  };
 *
 *  const filterGroup = queryStringParamsToFilterGroup(queryStringParams);
 *
 *  expect(filterGroup).to.deep.equal({
 *      filterId: 'queryStringParamsToFilterGroup',
 *      and: [
 *          {
 *              attribute: 'user.age',
 *              gt: 30,
 *          },
 *          {
 *              attribute: 'user.hobbies',
 *              in: ['reading', 'writing'],
 *          },
 *      ],
 *      not: [],
 *      or: [
 *          {
 *             attribute: 'user.name',
 *            eq: 'John',
 *          },
 *          {
 *              attribute: 'user.address.city',
 *           eq: 'New York',
 *          },
 *      ],
 *  });
 * ```
 */
export function queryStringParamsToFilterGroup(queryStringParams: { [name: string]: any }) {
  const formatted: FilterGroup<any> = {
    filterId: 'queryStringParamsToFilterGroup',
    and: [],
    not: [],
    or: [],
  };

  for (const qParamName in queryStringParams) {
    let groupName: keyof typeof formatted = 'and';

    // then treat it as a filter item
    if (Object.keys(formatted).includes(qParamName)) {
      groupName = qParamName as keyof typeof formatted;
    }

    const qParamValue = queryStringParams[qParamName];

    const formattedQPVal = makeFilterFromQueryStringParam(qParamName, qParamValue);

    formatted[groupName] = formatted[groupName]!.concat(formattedQPVal) as any;
  }

  return formatted;
}

/**
 * Creates a filter group for searching keywords in the specified attributes.
 * @param keywords - An array of keywords to search for.
 * @param attributeNames - An array of attribute names to search within. Defaults to an empty array.
 * @returns A filter group object.
 */
export function makeFilterGroupForSearchKeywords<E extends EntitySchema<any, any, any>>(
  keywords: Array<string>,
  attributeNames: Array<string> = [],
): FilterGroup<E> {
  const filterGroup: FilterGroup<E> = {
    filterId: 'keywordSearchFilterGroup',
    or: [],
  };

  attributeNames.forEach(attributeName => {
    filterGroup!.or!.push({
      attribute: attributeName,
      contains: keywords,
    } as any);
  });

  return filterGroup;
}

/**
 * Adds a filter group to the entity filter criteria.
 *
 * @template E - The entity schema type.
 * @param {FilterGroup<E>} filterGroup - The filter group to add.
 * @param {EntityFilterCriteria<E>} [entityFilterCriteria] - The existing entity filter criteria.
 * @returns {EntityFilterCriteria<E>} - The updated entity filter criteria.
 */
export function addFilterGroupToEntityFilterCriteria<E extends EntitySchema<any, any, any>>(
  filterGroup: FilterGroup<E>,
  entityFilterCriteria?: EntityFilterCriteria<E>,
): EntityFilterCriteria<E> {
  const newFilterCriteria: FilterGroup<E> = isFilterGroup<E>(entityFilterCriteria)
    ? { ...entityFilterCriteria }
    : { filterId: '_addFilterGroupToEntityFilterCriteria' };

  // make sure it has an `and` group
  newFilterCriteria.and = newFilterCriteria.and || [];

  /**
   * Spread out the filters to make sure we have a copy of the original filter criteria.
   * Note: A deep copy may make more sense.
   */

  if (isAttributeFilter(entityFilterCriteria) || isEntityFilter(entityFilterCriteria)) {
    newFilterCriteria.and.push({ ...entityFilterCriteria });
  }

  newFilterCriteria.and.push({ ...filterGroup } as any);

  return newFilterCriteria as EntityFilterCriteria<E>;
}
