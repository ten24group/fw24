import type { Item, WhereAttributes, WhereOperations } from "electrodb";
import type { EntitySchema } from "./base-entity";
import type { EntityAttributeFilter, EntityFilter, EntityFilterCriteria, EntityFilterGroup, ParsedEntityAttributePaths } from './query-types';
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
export declare function parseEntityAttributePaths(paths: string[]): ParsedEntityAttributePaths;
export declare function attributeFilterToExpression<A extends string, F extends string, C extends string, S extends EntitySchema<A, F, C>, I extends Item<A, F, C, S, S["attributes"]>, WAttributes extends WhereAttributes<A, F, C, S, I>, WOperations extends WhereOperations<A, F, C, S, I>>(filter: EntityAttributeFilter<any>, attributes: WAttributes, operations: WOperations): string;
export declare function makeParenthesesGroup(items: Array<string>, delimiter: string): string;
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
export declare function entityFilterToFilterGroup<A extends string, F extends string, C extends string, S extends EntitySchema<A, F, C>>(entityFilter: EntityFilter<S>): EntityFilterGroup<S>;
/**
 * Converts the entity filter criteria into a filter expression.
 * @param entityFilter The entity filter to convert.
 * @param attributes The attributes for the filter expression.
 * @param operations The operations for the filter expression.
 * @returns The filter expression.
 */
export declare function entityFilterToExpression<A extends string, F extends string, C extends string, S extends EntitySchema<A, F, C>, I extends Item<A, F, C, S, S["attributes"]>, WAttributes extends WhereAttributes<A, F, C, S, I>, WOperations extends WhereOperations<A, F, C, S, I>>(entityFilter: EntityFilter<S>, attributes: WAttributes, operations: WOperations): string;
/**
 * Converts the given entity filter criteria to an expression.
 *
 * @param filterCriteria - The entity filter criteria to convert.
 * @param attributes - The attributes for the filter criteria.
 * @param operations - The operations for the filter criteria.
 * @returns The expression representing the converted filter criteria.
 */
export declare function entityFilterCriteriaToExpression<A extends string, F extends string, C extends string, S extends EntitySchema<A, F, C>, I extends Item<A, F, C, S, S["attributes"]>, WAttributes extends WhereAttributes<A, F, C, S, I>, WOperations extends WhereOperations<A, F, C, S, I>>(filterCriteria: EntityFilterCriteria<S>, attributes: WAttributes, operations: WOperations): string;
/**
 * Converts a filter criteria, filter group, or attribute filter to an expression.
 * @param options - The options object containing the filter criteria, attributes, and operations.
 * @returns The expression representing the converted filter criteria.
 * @throws An error if the filter criteria is not a valid EntityFilterGroup, EntityFilterCriteria, or EntityAttributeFilterCriteria.
 */
export declare function filterCriteriaOrFilterGroupOrAttributeFilterToExpression<A extends string, F extends string, C extends string, S extends EntitySchema<A, F, C>, I extends Item<A, F, C, S, S["attributes"]>, WAttributes extends WhereAttributes<A, F, C, S, I>, WOperations extends WhereOperations<A, F, C, S, I>>(options: {
    filterCriteria: EntityFilterCriteria<S>;
    attributes: WAttributes;
    operations: WOperations;
}): string;
/**
 * Converts a filter group object into a filter expression string.
 * @param filterGroup - The filter group object to convert.
 * @param attributes - The attributes object.
 * @param operations - The operations object.
 * @returns The filter expression string.
 */
export declare function filterGroupToExpression<A extends string, F extends string, C extends string, S extends EntitySchema<A, F, C>, I extends Item<A, F, C, S, S["attributes"]>, WAttributes extends WhereAttributes<A, F, C, S, I>, WOperations extends WhereOperations<A, F, C, S, I>>(filterGroup: EntityFilterGroup<any>, attributes: WAttributes, operations: WOperations): string;
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
 *          name: 'John',
 *          age: '30',
 *          hobbies: ['reading', 'writing'],
 *          address: {
 *              city: 'New York',
 *              country: 'USA',
 *          },
 *      },
 *  });
 * ```
 */
export declare function parseUrlQueryStringParameters(queryStringParameters: {
    [name: string]: string | undefined;
}): import("qs").ParsedQs;
/**
 * Converts a query string parameter into a filter object.
 * @param paramName - The name of the query string parameter.
 * @param paramValue - The value of the query string parameter.
 * @returns The formatted filter object.
 */
export declare function makeFilterFromQueryStringParam(paramName: string, paramValue: any): any;
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
export declare function queryStringParamsToFilterGroup(queryStringParams: {
    [name: string]: any;
}): EntityFilterGroup<any>;
/**
 * Creates a filter group for searching keywords in the specified attributes.
 * @param keywords - An array of keywords to search for.
 * @param attributeNames - An array of attribute names to search within. Defaults to an empty array.
 * @returns A filter group object.
 */
export declare function makeFilterGroupForSearchKeywords<E extends EntitySchema<any, any, any>>(keywords: Array<string>, attributeNames?: Array<string>): EntityFilterGroup<E>;
/**
 * Adds a filter group to the entity filter criteria.
 *
 * @template E - The entity schema type.
 * @param {EntityFilterGroup<E>} filterGroup - The filter group to add.
 * @param {EntityFilterCriteria<E>} [entityFilterCriteria] - The existing entity filter criteria.
 * @returns {EntityFilterCriteria<E>} - The updated entity filter criteria.
 */
export declare function addFilterGroupToEntityFilterCriteria<E extends EntitySchema<any, any, any>>(filterGroup: EntityFilterGroup<E>, entityFilterCriteria?: EntityFilterCriteria<E>): EntityFilterCriteria<E>;
