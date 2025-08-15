"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEntityAttributePaths = parseEntityAttributePaths;
exports.attributeFilterToExpression = attributeFilterToExpression;
exports.makeParenthesesGroup = makeParenthesesGroup;
exports.entityFilterToFilterGroup = entityFilterToFilterGroup;
exports.entityFilterToExpression = entityFilterToExpression;
exports.entityFilterCriteriaToExpression = entityFilterCriteriaToExpression;
exports.filterCriteriaOrFilterGroupOrAttributeFilterToExpression = filterCriteriaOrFilterGroupOrAttributeFilterToExpression;
exports.filterGroupToExpression = filterGroupToExpression;
exports.parseUrlQueryStringParameters = parseUrlQueryStringParameters;
exports.makeFilterFromQueryStringParam = makeFilterFromQueryStringParam;
exports.queryStringParamsToFilterGroup = queryStringParamsToFilterGroup;
exports.makeFilterGroupForSearchKeywords = makeFilterGroupForSearchKeywords;
exports.addFilterGroupToEntityFilterCriteria = addFilterGroupToEntityFilterCriteria;
const logging_1 = require("../logging");
const query_types_1 = require("./query-types");
const query_utils_1 = require("./query-utils");
const qs_1 = require("qs");
const utils_1 = require("../utils");
const logger = (0, logging_1.createLogger)('EntityQuery');
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
function parseEntityAttributePaths(paths) {
    const parsed = paths.reduce((acc, path) => {
        const keys = path.split('.');
        keys.reduce((obj, key, index) => {
            if (index === keys.length - 1) {
                if (typeof obj[key] === 'object') {
                    // If the key already exists as an object, do nothing
                }
                else {
                    // If the key doesn't exist or is a boolean, set it to true
                    obj[key] = true;
                }
            }
            else {
                if (typeof obj[key] === 'boolean') {
                    // If the key already exists as a boolean, convert it to an object
                    obj[key] = {};
                }
                else {
                    // If the key doesn't exist, set it to an object
                    obj[key] = obj[key] || {};
                }
            }
            return obj[key];
        }, acc);
        return acc;
    }, {});
    const format = (obj) => {
        const res = {};
        Object.entries(obj).forEach(([key, val]) => {
            if ((0, utils_1.isObject)(val)) {
                res[key] = { attributes: format(val) };
            }
            else {
                res[key] = true;
            }
        });
        return res;
    };
    return format(parsed);
}
;
function attributeFilterToExpression(filter, attributes, operations) {
    const { filterId: id, filterLabel: label, attribute: prop, logicalOp = 'and', ...filters } = filter;
    const attributeRef = attributes[prop];
    if (!attributeRef) {
        logger.error(`Invalid filter property`, { prop, filter, attributes });
        throw (`Invalid filter property ${prop?.toString()}`);
    }
    const filterFragments = [];
    const { eq, ne, gt, gte, lt, lte, between, begins, exists, notExists, contains, notContains, name, size, type } = operations;
    for (const filterKey in filters) {
        let filterVal = filters[filterKey];
        // Use shared utility for complex filter value extraction
        if ((0, query_types_1.isComplexFilterValue)(filterVal)) {
            // TODO: handle `expression` filter values
            filterVal = filterVal?.valType == 'propRef' ? name(filterVal.val) : filterVal.val;
        }
        // Use shared utilities instead of array-based checks
        if ((0, query_utils_1.isEqualityOp)(filterKey)) {
            filterFragments.push(eq(attributeRef, filterVal));
        }
        else if ((0, query_utils_1.isInequalityOp)(filterKey)) {
            filterFragments.push(ne(attributeRef, filterVal));
        }
        else if ((0, query_utils_1.isGreaterThanOp)(filterKey)) {
            filterFragments.push(gt(attributeRef, filterVal));
        }
        else if ((0, query_utils_1.isGreaterThanOrEqualOp)(filterKey)) {
            filterFragments.push(gte(attributeRef, filterVal));
        }
        else if ((0, query_utils_1.isLessThanOp)(filterKey)) {
            filterFragments.push(lt(attributeRef, filterVal));
        }
        else if ((0, query_utils_1.isLessThanOrEqualOp)(filterKey)) {
            filterFragments.push(lte(attributeRef, filterVal));
        }
        else if ((0, query_utils_1.isRangeOp)(filterKey)) {
            // Use shared utility for range value normalization
            try {
                const [min, max] = (0, query_utils_1.normalizeRangeValue)(filterVal);
                filterFragments.push(between(attributeRef, min, max));
            }
            catch (error) {
                // Fallback to original array-based approach
                filterFragments.push(between(attributeRef, filterVal[0], filterVal[1]));
            }
        }
        else if ((0, query_utils_1.isStringPatternOp)(filterKey) || (0, query_utils_1.isOperatorAlias)(filterKey, 'startsWith')) {
            filterFragments.push(begins(attributeRef, filterVal));
        }
        else if ((0, query_utils_1.isContainsOp)(filterKey) || (0, query_utils_1.isOperatorAlias)(filterKey, 'containsSome')) {
            filterVal = (0, query_utils_1.normalizeToArray)(filterVal);
            const logicalOpp = (0, query_utils_1.isOperatorAlias)(filterKey, 'containsSome') ? 'OR' : 'AND';
            const listFilters = filterVal.map((val) => contains(attributeRef, val));
            filterFragments.push(makeParenthesesGroup(listFilters, logicalOpp));
        }
        else if ((0, query_utils_1.isNotContainsOp)(filterKey)) {
            filterVal = (0, query_utils_1.normalizeToArray)(filterVal);
            const listFilters = filterVal.map((val) => notContains(attributeRef, val));
            filterFragments.push(makeParenthesesGroup(listFilters, 'AND'));
        }
        else if ((0, query_utils_1.isInOp)(filterKey)) {
            filterVal = (0, query_utils_1.normalizeToArray)(filterVal);
            const listFilters = filterVal.map((val) => eq(attributeRef, val));
            filterFragments.push(makeParenthesesGroup(listFilters, 'OR'));
        }
        else if ((0, query_utils_1.isNotInOp)(filterKey)) {
            filterVal = (0, query_utils_1.normalizeToArray)(filterVal);
            const listFilters = filterVal.map((val) => ne(attributeRef, val));
            filterFragments.push(makeParenthesesGroup(listFilters, 'AND'));
        }
        else if ((0, query_utils_1.isOperatorAlias)(filterKey, 'exists') || (0, query_utils_1.isOperatorAlias)(filterKey, 'isNull')) {
            filterFragments.push(filterVal ? exists(attributeRef) : notExists(attributeRef));
        }
        else if ((0, query_utils_1.isOperatorAlias)(filterKey, 'isEmpty')) {
            filterFragments.push(filterVal ? eq(attributeRef, '') : ne(attributeRef, ''));
        }
    }
    const filterExpression = makeParenthesesGroup(filterFragments, logicalOp);
    return filterExpression;
}
function makeParenthesesGroup(items, delimiter) {
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
function entityFilterToFilterGroup(entityFilter) {
    if (!(0, query_types_1.isEntityFilter)(entityFilter)) {
        throw new Error(`invalid entity filter ${entityFilter}`);
    }
    const entityFilterGroup = {};
    const { filterId, filterLabel: label, logicalOp = 'and', ...entityPopsFilters } = entityFilter;
    entityFilterGroup.filterId = filterId;
    entityFilterGroup.filterLabel = label;
    const logicalOpFilters = Object
        .entries(entityPopsFilters)
        .map(([key, val]) => {
        return { ...val, attribute: key };
    });
    entityFilterGroup[logicalOp] = logicalOpFilters;
    return entityFilterGroup;
}
/**
 * Converts the entity filter criteria into a filter expression.
 * @param entityFilter The entity filter to convert.
 * @param attributes The attributes for the filter expression.
 * @param operations The operations for the filter expression.
 * @returns The filter expression.
 */
function entityFilterToExpression(entityFilter, attributes, operations) {
    const filterGroup = entityFilterToFilterGroup(entityFilter);
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
function entityFilterCriteriaToExpression(filterCriteria, attributes, operations) {
    let expression = filterCriteriaOrFilterGroupOrAttributeFilterToExpression({
        filterCriteria,
        attributes,
        operations
    });
    return expression;
}
/**
 * Converts a filter criteria, filter group, or attribute filter to an expression.
 * @param options - The options object containing the filter criteria, attributes, and operations.
 * @returns The expression representing the converted filter criteria.
 * @throws An error if the filter criteria is not a valid EntityFilterGroup, EntityFilterCriteria, or EntityAttributeFilterCriteria.
 */
function filterCriteriaOrFilterGroupOrAttributeFilterToExpression(options) {
    const { filterCriteria, attributes, operations } = options;
    if ((0, query_types_1.isEntityFilter)(filterCriteria)) {
        return entityFilterToExpression(filterCriteria, attributes, operations);
    }
    else if ((0, query_types_1.isEntityFilterGroup)(filterCriteria)) {
        return filterGroupToExpression(filterCriteria, attributes, operations);
    }
    else if ((0, query_types_1.isAttributeFilter)(filterCriteria)) {
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
function filterGroupToExpression(filterGroup, attributes, operations) {
    const { filterId: id, filterLabel: label, and = [], or = [], not = [] } = filterGroup;
    const filterGroupFragments = [];
    const andFragments = [];
    for (const thisFilter of and) {
        const thisExpression = filterCriteriaOrFilterGroupOrAttributeFilterToExpression({
            filterCriteria: thisFilter,
            attributes,
            operations
        });
        if (thisExpression.length) {
            andFragments.push(thisExpression);
        }
    }
    if (andFragments.length) {
        const andExpressions = makeParenthesesGroup(andFragments, 'and');
        filterGroupFragments.push(andExpressions);
    }
    const orFragments = [];
    for (const thisFilter of or) {
        const thisExpression = filterCriteriaOrFilterGroupOrAttributeFilterToExpression({
            filterCriteria: thisFilter,
            attributes,
            operations
        });
        if (thisExpression.length) {
            orFragments.push(thisExpression);
        }
    }
    if (orFragments.length) {
        const orExpressions = makeParenthesesGroup(orFragments, 'or');
        filterGroupFragments.push(orExpressions);
    }
    const notFragments = [];
    for (const thisFilter of not) {
        const thisExpression = filterCriteriaOrFilterGroupOrAttributeFilterToExpression({
            filterCriteria: thisFilter,
            attributes,
            operations
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
function parseUrlQueryStringParameters(queryStringParameters) {
    const queryString = (0, qs_1.stringify)(queryStringParameters);
    const parsed = (0, qs_1.parse)(queryString, {
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
 * Converts a query string parameter into a filter object.
 * @param paramName - The name of the query string parameter.
 * @param paramValue - The value of the query string parameter.
 * @returns The formatted filter object.
 */
function makeFilterFromQueryStringParam(paramName, paramValue) {
    /**
     *  { paramName: or,  paramValue: [{ foo: { eq: '1' }}, { foo: { neq: '3' } }] }
     */
    if (['and', 'or', 'not'].includes(paramName)) {
        let formattedGroupVal = [];
        paramValue.forEach((item) => {
            Object.keys(item).forEach((itemKey) => {
                const itemValue = item[itemKey];
                const formattedItems = makeFilterFromQueryStringParam(itemKey, itemValue);
                formattedGroupVal = formattedGroupVal.concat(formattedItems);
            });
        });
        return formattedGroupVal;
    }
    let formattedValues = {};
    if (!(0, utils_1.isObject)(paramValue)) {
        paramValue = { 'eq': paramValue };
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
    Object.keys(paramValue).forEach((key) => {
        const keyVal = paramValue[key];
        let formattedVal = keyVal;
        // parse the values to the right types here
        if (query_utils_1.FILTER_KEYS_HAVING_ARRAY_VALUES.includes(key) && typeof keyVal === 'string') {
            formattedVal = keyVal.split(query_utils_1.PARSE_VALUE_DELIMITERS);
        }
        formattedVal = (0, utils_1.parseValueToCorrectTypes)(formattedVal);
        formattedValues[key] = formattedVal;
    });
    const formattedItemVal = {
        attribute: paramName,
        ...formattedValues
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
function queryStringParamsToFilterGroup(queryStringParams) {
    const formatted = {
        filterId: 'queryStringParamsToFilterGroup',
        and: [],
        not: [],
        or: [],
    };
    for (let qParamName in queryStringParams) {
        let groupName = 'and';
        // then treat it as a filter item
        if (Object.keys(formatted).includes(qParamName)) {
            groupName = qParamName;
        }
        let qParamValue = queryStringParams[qParamName];
        const formattedQPVal = makeFilterFromQueryStringParam(qParamName, qParamValue);
        formatted[groupName] = formatted[groupName].concat(formattedQPVal);
    }
    return formatted;
}
/**
 * Creates a filter group for searching keywords in the specified attributes.
 * @param keywords - An array of keywords to search for.
 * @param attributeNames - An array of attribute names to search within. Defaults to an empty array.
 * @returns A filter group object.
 */
function makeFilterGroupForSearchKeywords(keywords, attributeNames = []) {
    const filterGroup = {
        filterId: 'keywordSearchFilterGroup',
        or: [],
    };
    attributeNames.forEach((attributeName) => {
        filterGroup.or.push({
            attribute: attributeName,
            contains: keywords,
        });
    });
    return filterGroup;
}
/**
 * Adds a filter group to the entity filter criteria.
 *
 * @template E - The entity schema type.
 * @param {EntityFilterGroup<E>} filterGroup - The filter group to add.
 * @param {EntityFilterCriteria<E>} [entityFilterCriteria] - The existing entity filter criteria.
 * @returns {EntityFilterCriteria<E>} - The updated entity filter criteria.
 */
function addFilterGroupToEntityFilterCriteria(filterGroup, entityFilterCriteria) {
    const newFilterCriteria = (0, query_types_1.isEntityFilterGroup)(entityFilterCriteria)
        ? { ...entityFilterCriteria }
        : { filterId: '_addFilterGroupToEntityFilterCriteria' };
    // make sure it has an `and` group
    newFilterCriteria.and = newFilterCriteria.and || [];
    /**
     * Spread out the filters to make sure we have a copy of the original filter criteria.
     * Note: A deep copy may make more sense.
     */
    if ((0, query_types_1.isAttributeFilter)(entityFilterCriteria) || (0, query_types_1.isEntityFilter)(entityFilterCriteria)) {
        newFilterCriteria.and.push({ ...entityFilterCriteria });
    }
    newFilterCriteria.and.push({ ...filterGroup });
    return newFilterCriteria;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L3F1ZXJ5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBMERBLDhEQThDQztBQUVELGtFQXNIQztBQUVELG9EQUVDO0FBdUNELDhEQTBCQztBQVNELDREQW1CQztBQVVELDRFQXFCQztBQVFELDRIQThCQztBQVNELDBEQW1FQztBQWlDRCxzRUFjQztBQVFELHdFQXVEQztBQWdERCx3RUEyQkM7QUFRRCw0RUFrQkM7QUFVRCxvRkF3QkM7QUFuc0JELHdDQUEwQztBQUMxQywrQ0FBNkc7QUFDN0csK0NBa0J1QjtBQUV2QiwyQkFHWTtBQUVaLG9DQUE4RDtBQUU5RCxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsYUFBYSxDQUFDLENBQUM7QUFFM0M7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FzQkc7QUFDSCxTQUFnQix5QkFBeUIsQ0FBQyxLQUFlO0lBTXJELE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQTZCLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRSxFQUFFO1FBQ2xFLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFFN0IsSUFBSSxDQUFDLE1BQU0sQ0FBdUIsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxFQUFFO1lBQ2xELElBQUksS0FBSyxLQUFLLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQzVCLElBQUksT0FBTyxHQUFHLENBQUUsR0FBRyxDQUFFLEtBQUssUUFBUSxFQUFFLENBQUM7b0JBQ2pDLHFEQUFxRDtnQkFDekQsQ0FBQztxQkFBTSxDQUFDO29CQUNKLDJEQUEyRDtvQkFDM0QsR0FBRyxDQUFFLEdBQUcsQ0FBRSxHQUFHLElBQUksQ0FBQztnQkFDdEIsQ0FBQztZQUNMLENBQUM7aUJBQU0sQ0FBQztnQkFDSixJQUFJLE9BQU8s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b0NBQW9DLENBQ2hELFdBQWlDLEVBQ2pDLG9CQUE4QztJQUc5QyxNQUFNLGlCQUFpQixHQUF5QixJQUFBLGlDQUFtQixFQUFJLG9CQUFvQixDQUFDO1FBQ3hGLENBQUMsQ0FBQyxFQUFFLEdBQUcsb0JBQW9CLEVBQUU7UUFDN0IsQ0FBQyxDQUFDLEVBQUUsUUFBUSxFQUFFLHVDQUF1QyxFQUFFLENBQUM7SUFFNUQsa0NBQWtDO0lBQ2xDLGlCQUFpQixDQUFDLEdBQUcsR0FBRyxpQkFBaUIsQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDO0lBRXBEOzs7T0FHRztJQUVILElBQUksSUFBQSwrQkFBaUIsRUFBQyxvQkFBb0IsQ0FBQyxJQUFJLElBQUEsNEJBQWMsRUFBQyxvQkFBb0IsQ0FBQyxFQUFFLENBQUM7UUFDbEYsaUJBQWlCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLEdBQUcsb0JBQW9CLEVBQUUsQ0FBQyxDQUFDO0lBQzVELENBQUM7SUFFRCxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxXQUFXLEVBQVMsQ0FBQyxDQUFDO0lBRXRELE9BQU8saUJBQTRDLENBQUM7QUFDeEQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgSXRlbSwgV2hlcmVBdHRyaWJ1dGVzLCBXaGVyZU9wZXJhdGlvbnMgfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eVNjaGVtYSB9IGZyb20gXCIuL2Jhc2UtZW50aXR5XCI7XG5pbXBvcnQgdHlwZSB7IEVudGl0eUF0dHJpYnV0ZUZpbHRlciwgRW50aXR5RmlsdGVyLCBFbnRpdHlGaWx0ZXJDcml0ZXJpYSwgRW50aXR5RmlsdGVyR3JvdXAsIFBhcnNlZEVudGl0eUF0dHJpYnV0ZVBhdGhzLCBUeXBlZEZpbHRlckNyaXRlcmlhIH0gZnJvbSAnLi9xdWVyeS10eXBlcyc7XG5cbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBpc0F0dHJpYnV0ZUZpbHRlciwgaXNDb21wbGV4RmlsdGVyVmFsdWUsIGlzRW50aXR5RmlsdGVyLCBpc0VudGl0eUZpbHRlckdyb3VwIH0gZnJvbSBcIi4vcXVlcnktdHlwZXNcIjtcbmltcG9ydCB7XG4gICAgRklMVEVSX0tFWVNfSEFWSU5HX0FSUkFZX1ZBTFVFUyxcbiAgICBQQVJTRV9WQUxVRV9ERUxJTUlURVJTLFxuICAgIGlzQ29udGFpbnNPcCxcbiAgICBpc0VxdWFsaXR5T3AsXG4gICAgaXNHcmVhdGVyVGhhbk9wLFxuICAgIGlzR3JlYXRlclRoYW5PckVxdWFsT3AsXG4gICAgaXNJbk9wLFxuICAgIGlzSW5lcXVhbGl0eU9wLFxuICAgIGlzTGVzc1RoYW5PcCxcbiAgICBpc0xlc3NUaGFuT3JFcXVhbE9wLFxuICAgIGlzTm90Q29udGFpbnNPcCxcbiAgICBpc05vdEluT3AsXG4gICAgaXNPcGVyYXRvckFsaWFzLFxuICAgIGlzUmFuZ2VPcCxcbiAgICBpc1N0cmluZ1BhdHRlcm5PcCxcbiAgICBub3JtYWxpemVSYW5nZVZhbHVlLFxuICAgIG5vcm1hbGl6ZVRvQXJyYXlcbn0gZnJvbSAnLi9xdWVyeS11dGlscyc7XG5cbmltcG9ydCB7XG4gICAgcGFyc2UgYXMgcGFyc2VRdWVyeVN0cmluZyxcbiAgICBzdHJpbmdpZnkgYXMgc3RyaW5naWZ5UXVlcnlQYXJhbXMsXG59IGZyb20gJ3FzJztcblxuaW1wb3J0IHsgaXNPYmplY3QsIHBhcnNlVmFsdWVUb0NvcnJlY3RUeXBlcyB9IGZyb20gJy4uL3V0aWxzJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdFbnRpdHlRdWVyeScpO1xuXG4vKipcbiAqIFBhcnNlcyB0aGUgZ2l2ZW4gYXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZSBwYXRocyBpbnRvIGEgc3RydWN0dXJlZCBmb3JtYXQuXG4gKiBAcGFyYW0gcGF0aHMgLSBUaGUgYXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZSBwYXRocy5cbiAqIEByZXR1cm5zIFRoZSBwYXJzZWQgZW50aXR5IGF0dHJpYnV0ZSBwYXRocy5cbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBjb25zdCBwYXRocyA9IFsndXNlci5uYW1lJywgJ3VzZXIuYWdlJywgJ3VzZXIuYWRkcmVzcy5jaXR5J107XG4gKiBjb25zdCBwYXJzZWQgPSBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKHBhdGhzKTtcbiAqIFxuICogY29uc29sZS5sb2cocGFyc2VkKTtcbiAqIC8vIE91dHB1dDogXG4gKiAvLyB7XG4gKiAvLyAgIHVzZXI6IHtcbiAqIC8vICAgICBuYW1lOiB0cnVlLFxuICogLy8gICAgIGFnZTogdHJ1ZSxcbiAqIC8vICAgICBhZGRyZXNzOiB7XG4gKiAvLyAgICAgICBjaXR5OiB0cnVlXG4gKiAvLyAgICAgfVxuICogLy8gICB9XG4gKiAvLyB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMocGF0aHM6IHN0cmluZ1tdKTogUGFyc2VkRW50aXR5QXR0cmlidXRlUGF0aHMge1xuXG4gICAgdHlwZSBQYXJzZWRBdHRyaWJ1dGVQYXRocyA9IHtcbiAgICAgICAgWyBrZXk6IHN0cmluZyBdOiBib29sZWFuIHwgUGFyc2VkQXR0cmlidXRlUGF0aHM7XG4gICAgfTtcblxuICAgIGNvbnN0IHBhcnNlZCA9IHBhdGhzLnJlZHVjZTxQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocz4oKGFjYywgcGF0aCkgPT4ge1xuICAgICAgICBjb25zdCBrZXlzID0gcGF0aC5zcGxpdCgnLicpO1xuXG4gICAgICAgIGtleXMucmVkdWNlPFBhcnNlZEF0dHJpYnV0ZVBhdGhzPigob2JqLCBrZXksIGluZGV4KSA9PiB7XG4gICAgICAgICAgICBpZiAoaW5kZXggPT09IGtleXMubGVuZ3RoIC0gMSkge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2Ygb2JqWyBrZXkgXSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgdGhlIGtleSBhbHJlYWR5IGV4aXN0cyBhcyBhbiBvYmplY3QsIGRvIG5vdGhpbmdcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyBJZiB0aGUga2V5IGRvZXNuJ3QgZXhpc3Qgb3IgaXMgYSBib29sZWFuLCBzZXQgaXQgdG8gdHJ1ZVxuICAgICAgICAgICAgICAgICAgICBvYmpbIGtleSBdID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2Ygb2JqWyBrZXkgXSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHRoZSBrZXkgYWxyZWFkeSBleGlzdHMgYXMgYSBib29sZWFuLCBjb252ZXJ0IGl0IHRvIGFuIG9iamVjdFxuICAgICAgICAgICAgICAgICAgICBvYmpbIGtleSBdID0ge307XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgdGhlIGtleSBkb2Vzbid0IGV4aXN0LCBzZXQgaXQgdG8gYW4gb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgIG9ialsga2V5IF0gPSBvYmpbIGtleSBdIHx8IHt9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIG9ialsga2V5IF0gYXMgUGFyc2VkQXR0cmlidXRlUGF0aHM7XG4gICAgICAgIH0sIGFjYyk7XG5cbiAgICAgICAgcmV0dXJuIGFjYztcbiAgICB9LCB7fSk7XG5cbiAgICBjb25zdCBmb3JtYXQgPSAob2JqOiBQYXJzZWRBdHRyaWJ1dGVQYXRocyk6IFBhcnNlZEVudGl0eUF0dHJpYnV0ZVBhdGhzID0+IHtcbiAgICAgICAgY29uc3QgcmVzOiBQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocyA9IHt9O1xuICAgICAgICBPYmplY3QuZW50cmllcyhvYmopLmZvckVhY2goKFsga2V5LCB2YWwgXSkgPT4ge1xuICAgICAgICAgICAgaWYgKGlzT2JqZWN0KHZhbCkpIHtcbiAgICAgICAgICAgICAgICByZXNbIGtleSBdID0geyBhdHRyaWJ1dGVzOiBmb3JtYXQodmFsKSB9O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXNbIGtleSBdID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZXM7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvcm1hdChwYXJzZWQpO1xufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGF0dHJpYnV0ZUZpbHRlclRvRXhwcmVzc2lvbjxcbiAgICBBIGV4dGVuZHMgc3RyaW5nLFxuICAgIEYgZXh0ZW5kcyBzdHJpbmcsXG4gICAgQyBleHRlbmRzIHN0cmluZyxcbiAgICBTIGV4dGVuZHMgRW50aXR5U2NoZW1hPEEsIEYsIEM+LFxuICAgIEkgZXh0ZW5kcyBJdGVtPEEsIEYsIEMsIFMsIFNbIFwiYXR0cmlidXRlc1wiIF0+LFxuICAgIFdBdHRyaWJ1dGVzIGV4dGVuZHMgV2hlcmVBdHRyaWJ1dGVzPEEsIEYsIEMsIFMsIEk+LFxuICAgIFdPcGVyYXRpb25zIGV4dGVuZHMgV2hlcmVPcGVyYXRpb25zPEEsIEYsIEMsIFMsIEk+LFxuPihmaWx0ZXI6IEVudGl0eUF0dHJpYnV0ZUZpbHRlcjxhbnk+LCBhdHRyaWJ1dGVzOiBXQXR0cmlidXRlcywgb3BlcmF0aW9uczogV09wZXJhdGlvbnMpIHtcblxuICAgIGNvbnN0IHsgZmlsdGVySWQ6IGlkLCBmaWx0ZXJMYWJlbDogbGFiZWwsIGF0dHJpYnV0ZTogcHJvcCwgbG9naWNhbE9wID0gJ2FuZCcsIC4uLmZpbHRlcnMgfSA9IGZpbHRlcjtcblxuICAgIGNvbnN0IGF0dHJpYnV0ZVJlZiA9IGF0dHJpYnV0ZXNbIHByb3AgYXMga2V5b2YgV0F0dHJpYnV0ZXMgXTtcblxuICAgIGlmICghYXR0cmlidXRlUmVmKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgSW52YWxpZCBmaWx0ZXIgcHJvcGVydHlgLCB7IHByb3AsIGZpbHRlciwgYXR0cmlidXRlcyB9KTtcbiAgICAgICAgdGhyb3cgKGBJbnZhbGlkIGZpbHRlciBwcm9wZXJ0eSAke3Byb3A/LnRvU3RyaW5nKCl9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgZmlsdGVyRnJhZ21lbnRzOiBBcnJheTxzdHJpbmc+ID0gW107XG4gICAgY29uc3QgeyBlcSwgbmUsIGd0LCBndGUsIGx0LCBsdGUsIGJldHdlZW4sIGJlZ2lucywgZXhpc3RzLCBub3RFeGlzdHMsIGNvbnRhaW5zLCBub3RDb250YWlucywgbmFtZSwgc2l6ZSwgdHlwZSB9ID0gb3BlcmF0aW9ucztcblxuICAgIGZvciAoY29uc3QgZmlsdGVyS2V5IGluIGZpbHRlcnMpIHtcblxuICAgICAgICBsZXQgZmlsdGVyVmFsID0gZmlsdGVyc1sgZmlsdGVyS2V5IGFzIGtleW9mIHR5cGVvZiBmaWx0ZXJzIF07XG5cbiAgICAgICAgLy8gVXNlIHNoYXJlZCB1dGlsaXR5IGZvciBjb21wbGV4IGZpbHRlciB2YWx1ZSBleHRyYWN0aW9uXG4gICAgICAgIGlmIChpc0NvbXBsZXhGaWx0ZXJWYWx1ZShmaWx0ZXJWYWwpKSB7XG4gICAgICAgICAgICAvLyBUT0RPOiBoYW5kbGUgYGV4cHJlc3Npb25gIGZpbHRlciB2YWx1ZXNcbiAgICAgICAgICAgIGZpbHRlclZhbCA9IGZpbHRlclZhbD8udmFsVHlwZSA9PSAncHJvcFJlZicgPyBuYW1lKGZpbHRlclZhbC52YWwpIDogZmlsdGVyVmFsLnZhbDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVzZSBzaGFyZWQgdXRpbGl0aWVzIGluc3RlYWQgb2YgYXJyYXktYmFzZWQgY2hlY2tzXG4gICAgICAgIGlmIChpc0VxdWFsaXR5T3AoZmlsdGVyS2V5KSkge1xuXG4gICAgICAgICAgICBmaWx0ZXJGcmFnbWVudHMucHVzaChlcShhdHRyaWJ1dGVSZWYsIGZpbHRlclZhbCkpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoaXNJbmVxdWFsaXR5T3AoZmlsdGVyS2V5KSkge1xuXG4gICAgICAgICAgICBmaWx0ZXJGcmFnbWVudHMucHVzaChuZShhdHRyaWJ1dGVSZWYsIGZpbHRlclZhbCkpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoaXNHcmVhdGVyVGhhbk9wKGZpbHRlcktleSkpIHtcblxuICAgICAgICAgICAgZmlsdGVyRnJhZ21lbnRzLnB1c2goZ3QoYXR0cmlidXRlUmVmLCBmaWx0ZXJWYWwpKTtcblxuICAgICAgICB9IGVsc2UgaWYgKGlzR3JlYXRlclRoYW5PckVxdWFsT3AoZmlsdGVyS2V5KSkge1xuXG4gICAgICAgICAgICBmaWx0ZXJGcmFnbWVudHMucHVzaChndGUoYXR0cmlidXRlUmVmLCBmaWx0ZXJWYWwpKTtcblxuICAgICAgICB9IGVsc2UgaWYgKGlzTGVzc1RoYW5PcChmaWx0ZXJLZXkpKSB7XG5cbiAgICAgICAgICAgIGZpbHRlckZyYWdtZW50cy5wdXNoKGx0KGF0dHJpYnV0ZVJlZiwgZmlsdGVyVmFsKSk7XG5cbiAgICAgICAgfSBlbHNlIGlmIChpc0xlc3NUaGFuT3JFcXVhbE9wKGZpbHRlcktleSkpIHtcblxuICAgICAgICAgICAgZmlsdGVyRnJhZ21lbnRzLnB1c2gobHRlKGF0dHJpYnV0ZVJlZiwgZmlsdGVyVmFsKSk7XG5cbiAgICAgICAgfSBlbHNlIGlmIChpc1JhbmdlT3AoZmlsdGVyS2V5KSkge1xuICAgICAgICAgICAgLy8gVXNlIHNoYXJlZCB1dGlsaXR5IGZvciByYW5nZSB2YWx1ZSBub3JtYWxpemF0aW9uXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IFsgbWluLCBtYXggXSA9IG5vcm1hbGl6ZVJhbmdlVmFsdWUoZmlsdGVyVmFsKTtcbiAgICAgICAgICAgICAgICBmaWx0ZXJGcmFnbWVudHMucHVzaChiZXR3ZWVuKGF0dHJpYnV0ZVJlZiwgbWluLCBtYXgpKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgLy8gRmFsbGJhY2sgdG8gb3JpZ2luYWwgYXJyYXktYmFzZWQgYXBwcm9hY2hcbiAgICAgICAgICAgICAgICBmaWx0ZXJGcmFnbWVudHMucHVzaChiZXR3ZWVuKGF0dHJpYnV0ZVJlZiwgZmlsdGVyVmFsWyAwIF0sIGZpbHRlclZhbFsgMSBdKSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfSBlbHNlIGlmIChpc1N0cmluZ1BhdHRlcm5PcChmaWx0ZXJLZXkpIHx8IGlzT3BlcmF0b3JBbGlhcyhmaWx0ZXJLZXksICdzdGFydHNXaXRoJykpIHtcblxuICAgICAgICAgICAgZmlsdGVyRnJhZ21lbnRzLnB1c2goYmVnaW5zKGF0dHJpYnV0ZVJlZiwgZmlsdGVyVmFsKSk7XG5cbiAgICAgICAgfSBlbHNlIGlmIChpc0NvbnRhaW5zT3AoZmlsdGVyS2V5KSB8fCBpc09wZXJhdG9yQWxpYXMoZmlsdGVyS2V5LCAnY29udGFpbnNTb21lJykpIHtcblxuICAgICAgICAgICAgZmlsdGVyVmFsID0gbm9ybWFsaXplVG9BcnJheShmaWx0ZXJWYWwpO1xuICAgICAgICAgICAgY29uc3QgbG9naWNhbE9wcCA9IGlzT3BlcmF0b3JBbGlhcyhmaWx0ZXJLZXksICdjb250YWluc1NvbWUnKSA/ICdPUicgOiAnQU5EJztcblxuICAgICAgICAgICAgY29uc3QgbGlzdEZpbHRlcnMgPSBmaWx0ZXJWYWwubWFwKCh2YWw6IGFueSkgPT4gY29udGFpbnMoYXR0cmlidXRlUmVmLCB2YWwpKVxuXG4gICAgICAgICAgICBmaWx0ZXJGcmFnbWVudHMucHVzaChtYWtlUGFyZW50aGVzZXNHcm91cChsaXN0RmlsdGVycywgbG9naWNhbE9wcCkpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoaXNOb3RDb250YWluc09wKGZpbHRlcktleSkpIHtcblxuICAgICAgICAgICAgZmlsdGVyVmFsID0gbm9ybWFsaXplVG9BcnJheShmaWx0ZXJWYWwpO1xuXG4gICAgICAgICAgICBjb25zdCBsaXN0RmlsdGVycyA9IGZpbHRlclZhbC5tYXAoKHZhbDogYW55KSA9PiBub3RDb250YWlucyhhdHRyaWJ1dGVSZWYsIHZhbCkpXG5cbiAgICAgICAgICAgIGZpbHRlckZyYWdtZW50cy5wdXNoKG1ha2VQYXJlbnRoZXNlc0dyb3VwKGxpc3RGaWx0ZXJzLCAnQU5EJykpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoaXNJbk9wKGZpbHRlcktleSkpIHtcblxuICAgICAgICAgICAgZmlsdGVyVmFsID0gbm9ybWFsaXplVG9BcnJheShmaWx0ZXJWYWwpO1xuXG4gICAgICAgICAgICBjb25zdCBsaXN0RmlsdGVycyA9IGZpbHRlclZhbC5tYXAoKHZhbDogYW55KSA9PiBlcShhdHRyaWJ1dGVSZWYsIHZhbCkpXG5cbiAgICAgICAgICAgIGZpbHRlckZyYWdtZW50cy5wdXNoKG1ha2VQYXJlbnRoZXNlc0dyb3VwKGxpc3RGaWx0ZXJzLCAnT1InKSk7XG5cbiAgICAgICAgfSBlbHNlIGlmIChpc05vdEluT3AoZmlsdGVyS2V5KSkge1xuXG4gICAgICAgICAgICBmaWx0ZXJWYWwgPSBub3JtYWxpemVUb0FycmF5KGZpbHRlclZhbCk7XG5cbiAgICAgICAgICAgIGNvbnN0IGxpc3RGaWx0ZXJzID0gZmlsdGVyVmFsLm1hcCgodmFsOiBhbnkpID0+IG5lKGF0dHJpYnV0ZVJlZiwgdmFsKSlcblxuICAgICAgICAgICAgZmlsdGVyRnJhZ21lbnRzLnB1c2gobWFrZVBhcmVudGhlc2VzR3JvdXAobGlzdEZpbHRlcnMsICdBTkQnKSk7XG5cbiAgICAgICAgfSBlbHNlIGlmIChpc09wZXJhdG9yQWxpYXMoZmlsdGVyS2V5LCAnZXhpc3RzJykgfHwgaXNPcGVyYXRvckFsaWFzKGZpbHRlcktleSwgJ2lzTnVsbCcpKSB7XG5cbiAgICAgICAgICAgIGZpbHRlckZyYWdtZW50cy5wdXNoKGZpbHRlclZhbCA/IGV4aXN0cyhhdHRyaWJ1dGVSZWYpIDogbm90RXhpc3RzKGF0dHJpYnV0ZVJlZikpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoaXNPcGVyYXRvckFsaWFzKGZpbHRlcktleSwgJ2lzRW1wdHknKSkge1xuXG4gICAgICAgICAgICBmaWx0ZXJGcmFnbWVudHMucHVzaChmaWx0ZXJWYWwgPyBlcShhdHRyaWJ1dGVSZWYgYXMgc3RyaW5nLCAnJyBhcyBzdHJpbmcpIDogbmUoYXR0cmlidXRlUmVmIGFzIHN0cmluZywgJycgYXMgc3RyaW5nKSk7XG5cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGZpbHRlckV4cHJlc3Npb24gPSBtYWtlUGFyZW50aGVzZXNHcm91cChmaWx0ZXJGcmFnbWVudHMsIGxvZ2ljYWxPcCk7XG5cbiAgICByZXR1cm4gZmlsdGVyRXhwcmVzc2lvbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VQYXJlbnRoZXNlc0dyb3VwKGl0ZW1zOiBBcnJheTxzdHJpbmc+LCBkZWxpbWl0ZXI6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGl0ZW1zLmxlbmd0aCA+IDEgPyAnKCAnICsgaXRlbXMuam9pbihgICR7ZGVsaW1pdGVyLnRvVXBwZXJDYXNlKCl9IGApICsgJyApJyA6IGl0ZW1zWyAwIF07XG59XG5cblxuLyoqXG4gKiBDb252ZXJ0cyBhbiBlbnRpdHkgZmlsdGVyIHRvIGEgZmlsdGVyIGdyb3VwLlxuICogQHBhcmFtIGVudGl0eUZpbHRlciBUaGUgZW50aXR5IGZpbHRlciB0byBjb252ZXJ0LlxuICogQHJldHVybnMgVGhlIGNvbnZlcnRlZCBmaWx0ZXIgZ3JvdXAuXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZSBlbnRpdHkgZmlsdGVyIGlzIGludmFsaWQuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBcbiAqIGBgYHRzXG4gKiBpbnRlcmZhY2UgVXNlckVudGl0eVNjaGVtYSB7XG4gKiAgIC8vIHJlc3Qgb2YgdGhlIHNjaGVtYSBzdHVmZi4uLlxuICogICBhdHRyaWJ1dGVzOiB7XG4gKiAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfTtcbiAqICAgICBuYW1lOiB7IHR5cGU6ICdzdHJpbmcnIH07XG4gKiAgICAgYWdlOiB7IHR5cGU6ICdudW1iZXInIH07XG4gKiAgIH07XG4gKiB9XG4gKiBcbiAqIGNvbnN0IHVzZXJGaWx0ZXI6IEVudGl0eUZpbHRlcjxVc2VyRW50aXR5U2NoZW1hPiA9IHtcbiAqICAgICBpZDogeyBlcTogJzEyMycgfSxcbiAqICAgICBuYW1lOiB7IGxpa2U6ICdKb2huJyB9LFxuICogICAgIGFnZTogeyBndGU6IDE4IH0sXG4gKiB9O1xuICogXG4gKiBjb25zdCB1c2VyRmlsdGVyR3JvdXAgPSBlbnRpdHlGaWx0ZXJUb0ZpbHRlckdyb3VwKHVzZXJGaWx0ZXIpO1xuICogZXhwZWN0KHVzZXJGaWx0ZXJHcm91cCkudG8uZGVlcC5lcXVhbCh7XG4gKiAgICAgYW5kOiBbXG4gKiAgICAgICAgIHsgYXR0cmlidXRlOiAnaWQnLCBlcTogJzEyMycgfSxcbiAqICAgICAgICAgeyBhdHRyaWJ1dGU6ICduYW1lJywgbGlrZTogJ0pvaG4nIH0sXG4gKiAgICAgICAgIHsgYXR0cmlidXRlOiAnYWdlJywgZ3RlOiAxOCB9LFxuICogICAgIF0sXG4gKiB9KTtcbiAqIGBgYFxuICogKiAnYW5kJyBiZWNvbWVzIHRoZSBkZWZhdWx0IGxvZ2ljYWwgb3BlcmF0b3IgaWYgbm90IHNwZWNpZmllZCBpbiB0aGUgZmlsdGVyLlxuICogXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbnRpdHlGaWx0ZXJUb0ZpbHRlckdyb3VwPFxuICAgIEEgZXh0ZW5kcyBzdHJpbmcsXG4gICAgRiBleHRlbmRzIHN0cmluZyxcbiAgICBDIGV4dGVuZHMgc3RyaW5nLFxuICAgIFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8QSwgRiwgQz5cbj4oZW50aXR5RmlsdGVyOiBFbnRpdHlGaWx0ZXI8Uz4pOiBFbnRpdHlGaWx0ZXJHcm91cDxTPiB7XG5cbiAgICBpZiAoIWlzRW50aXR5RmlsdGVyKGVudGl0eUZpbHRlcikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBpbnZhbGlkIGVudGl0eSBmaWx0ZXIgJHtlbnRpdHlGaWx0ZXJ9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgZW50aXR5RmlsdGVyR3JvdXA6IEVudGl0eUZpbHRlckdyb3VwPFM+ID0ge307XG4gICAgY29uc3QgeyBmaWx0ZXJJZCwgZmlsdGVyTGFiZWw6IGxhYmVsLCBsb2dpY2FsT3AgPSAnYW5kJywgLi4uZW50aXR5UG9wc0ZpbHRlcnMgfSA9IGVudGl0eUZpbHRlcjtcblxuICAgIGVudGl0eUZpbHRlckdyb3VwLmZpbHRlcklkID0gZmlsdGVySWQ7XG4gICAgZW50aXR5RmlsdGVyR3JvdXAuZmlsdGVyTGFiZWwgPSBsYWJlbDtcblxuICAgIGNvbnN0IGxvZ2ljYWxPcEZpbHRlcnMgPSBPYmplY3RcbiAgICAgICAgLmVudHJpZXM8VHlwZWRGaWx0ZXJDcml0ZXJpYTxhbnk+PihlbnRpdHlQb3BzRmlsdGVycyBhcyB7IFsgczogc3RyaW5nIF06IFR5cGVkRmlsdGVyQ3JpdGVyaWE8YW55PjsgfSlcbiAgICAgICAgLm1hcCgoWyBrZXksIHZhbCBdKTogRW50aXR5QXR0cmlidXRlRmlsdGVyPGFueT4gPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHsgLi4udmFsLCBhdHRyaWJ1dGU6IGtleSB9O1xuICAgICAgICB9KTtcblxuICAgIGVudGl0eUZpbHRlckdyb3VwWyBsb2dpY2FsT3AgXSA9IGxvZ2ljYWxPcEZpbHRlcnMgYXMgYW55O1xuXG4gICAgcmV0dXJuIGVudGl0eUZpbHRlckdyb3VwO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIHRoZSBlbnRpdHkgZmlsdGVyIGNyaXRlcmlhIGludG8gYSBmaWx0ZXIgZXhwcmVzc2lvbi5cbiAqIEBwYXJhbSBlbnRpdHlGaWx0ZXIgVGhlIGVudGl0eSBmaWx0ZXIgdG8gY29udmVydC5cbiAqIEBwYXJhbSBhdHRyaWJ1dGVzIFRoZSBhdHRyaWJ1dGVzIGZvciB0aGUgZmlsdGVyIGV4cHJlc3Npb24uXG4gKiBAcGFyYW0gb3BlcmF0aW9ucyBUaGUgb3BlcmF0aW9ucyBmb3IgdGhlIGZpbHRlciBleHByZXNzaW9uLlxuICogQHJldHVybnMgVGhlIGZpbHRlciBleHByZXNzaW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZW50aXR5RmlsdGVyVG9FeHByZXNzaW9uPFxuICAgIEEgZXh0ZW5kcyBzdHJpbmcsXG4gICAgRiBleHRlbmRzIHN0cmluZyxcbiAgICBDIGV4dGVuZHMgc3RyaW5nLFxuICAgIFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8QSwgRiwgQz4sXG4gICAgSSBleHRlbmRzIEl0ZW08QSwgRiwgQywgUywgU1sgXCJhdHRyaWJ1dGVzXCIgXT4sXG4gICAgV0F0dHJpYnV0ZXMgZXh0ZW5kcyBXaGVyZUF0dHJpYnV0ZXM8QSwgRiwgQywgUywgST4sXG4gICAgV09wZXJhdGlvbnMgZXh0ZW5kcyBXaGVyZU9wZXJhdGlvbnM8QSwgRiwgQywgUywgST4sXG4+KFxuICAgIGVudGl0eUZpbHRlcjogRW50aXR5RmlsdGVyPFM+LFxuICAgIGF0dHJpYnV0ZXM6IFdBdHRyaWJ1dGVzLFxuICAgIG9wZXJhdGlvbnM6IFdPcGVyYXRpb25zXG4pIHtcblxuICAgIGNvbnN0IGZpbHRlckdyb3VwID0gZW50aXR5RmlsdGVyVG9GaWx0ZXJHcm91cChlbnRpdHlGaWx0ZXIpO1xuXG4gICAgY29uc3QgZXhwcmVzc2lvbiA9IGZpbHRlckdyb3VwVG9FeHByZXNzaW9uKGZpbHRlckdyb3VwLCBhdHRyaWJ1dGVzLCBvcGVyYXRpb25zKTtcblxuICAgIHJldHVybiBleHByZXNzaW9uO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIHRoZSBnaXZlbiBlbnRpdHkgZmlsdGVyIGNyaXRlcmlhIHRvIGFuIGV4cHJlc3Npb24uXG4gKiBcbiAqIEBwYXJhbSBmaWx0ZXJDcml0ZXJpYSAtIFRoZSBlbnRpdHkgZmlsdGVyIGNyaXRlcmlhIHRvIGNvbnZlcnQuXG4gKiBAcGFyYW0gYXR0cmlidXRlcyAtIFRoZSBhdHRyaWJ1dGVzIGZvciB0aGUgZmlsdGVyIGNyaXRlcmlhLlxuICogQHBhcmFtIG9wZXJhdGlvbnMgLSBUaGUgb3BlcmF0aW9ucyBmb3IgdGhlIGZpbHRlciBjcml0ZXJpYS5cbiAqIEByZXR1cm5zIFRoZSBleHByZXNzaW9uIHJlcHJlc2VudGluZyB0aGUgY29udmVydGVkIGZpbHRlciBjcml0ZXJpYS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uPFxuICAgIEEgZXh0ZW5kcyBzdHJpbmcsXG4gICAgRiBleHRlbmRzIHN0cmluZyxcbiAgICBDIGV4dGVuZHMgc3RyaW5nLFxuICAgIFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8QSwgRiwgQz4sXG4gICAgSSBleHRlbmRzIEl0ZW08QSwgRiwgQywgUywgU1sgXCJhdHRyaWJ1dGVzXCIgXT4sXG4gICAgV0F0dHJpYnV0ZXMgZXh0ZW5kcyBXaGVyZUF0dHJpYnV0ZXM8QSwgRiwgQywgUywgST4sXG4gICAgV09wZXJhdGlvbnMgZXh0ZW5kcyBXaGVyZU9wZXJhdGlvbnM8QSwgRiwgQywgUywgST4sXG4+KFxuICAgIGZpbHRlckNyaXRlcmlhOiBFbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPixcbiAgICBhdHRyaWJ1dGVzOiBXQXR0cmlidXRlcyxcbiAgICBvcGVyYXRpb25zOiBXT3BlcmF0aW9uc1xuKSB7XG5cbiAgICBsZXQgZXhwcmVzc2lvbiA9IGZpbHRlckNyaXRlcmlhT3JGaWx0ZXJHcm91cE9yQXR0cmlidXRlRmlsdGVyVG9FeHByZXNzaW9uKHtcbiAgICAgICAgZmlsdGVyQ3JpdGVyaWEsXG4gICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgIG9wZXJhdGlvbnNcbiAgICB9KTtcblxuICAgIHJldHVybiBleHByZXNzaW9uO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGEgZmlsdGVyIGNyaXRlcmlhLCBmaWx0ZXIgZ3JvdXAsIG9yIGF0dHJpYnV0ZSBmaWx0ZXIgdG8gYW4gZXhwcmVzc2lvbi5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGZpbHRlciBjcml0ZXJpYSwgYXR0cmlidXRlcywgYW5kIG9wZXJhdGlvbnMuXG4gKiBAcmV0dXJucyBUaGUgZXhwcmVzc2lvbiByZXByZXNlbnRpbmcgdGhlIGNvbnZlcnRlZCBmaWx0ZXIgY3JpdGVyaWEuXG4gKiBAdGhyb3dzIEFuIGVycm9yIGlmIHRoZSBmaWx0ZXIgY3JpdGVyaWEgaXMgbm90IGEgdmFsaWQgRW50aXR5RmlsdGVyR3JvdXAsIEVudGl0eUZpbHRlckNyaXRlcmlhLCBvciBFbnRpdHlBdHRyaWJ1dGVGaWx0ZXJDcml0ZXJpYS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbHRlckNyaXRlcmlhT3JGaWx0ZXJHcm91cE9yQXR0cmlidXRlRmlsdGVyVG9FeHByZXNzaW9uPFxuICAgIEEgZXh0ZW5kcyBzdHJpbmcsXG4gICAgRiBleHRlbmRzIHN0cmluZyxcbiAgICBDIGV4dGVuZHMgc3RyaW5nLFxuICAgIFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8QSwgRiwgQz4sXG4gICAgSSBleHRlbmRzIEl0ZW08QSwgRiwgQywgUywgU1sgXCJhdHRyaWJ1dGVzXCIgXT4sXG4gICAgV0F0dHJpYnV0ZXMgZXh0ZW5kcyBXaGVyZUF0dHJpYnV0ZXM8QSwgRiwgQywgUywgST4sXG4gICAgV09wZXJhdGlvbnMgZXh0ZW5kcyBXaGVyZU9wZXJhdGlvbnM8QSwgRiwgQywgUywgST4sXG4+KFxuICAgIG9wdGlvbnM6IHtcbiAgICAgICAgZmlsdGVyQ3JpdGVyaWE6IEVudGl0eUZpbHRlckNyaXRlcmlhPFM+LFxuICAgICAgICBhdHRyaWJ1dGVzOiBXQXR0cmlidXRlcyxcbiAgICAgICAgb3BlcmF0aW9uczogV09wZXJhdGlvbnNcbiAgICB9XG4pIHtcbiAgICBjb25zdCB7IGZpbHRlckNyaXRlcmlhLCBhdHRyaWJ1dGVzLCBvcGVyYXRpb25zIH0gPSBvcHRpb25zO1xuXG4gICAgaWYgKGlzRW50aXR5RmlsdGVyKGZpbHRlckNyaXRlcmlhKSkge1xuICAgICAgICByZXR1cm4gZW50aXR5RmlsdGVyVG9FeHByZXNzaW9uKGZpbHRlckNyaXRlcmlhLCBhdHRyaWJ1dGVzLCBvcGVyYXRpb25zKTtcbiAgICB9IGVsc2UgaWYgKGlzRW50aXR5RmlsdGVyR3JvdXAoZmlsdGVyQ3JpdGVyaWEpKSB7XG4gICAgICAgIHJldHVybiBmaWx0ZXJHcm91cFRvRXhwcmVzc2lvbihmaWx0ZXJDcml0ZXJpYSwgYXR0cmlidXRlcywgb3BlcmF0aW9ucyk7XG4gICAgfSBlbHNlIGlmIChpc0F0dHJpYnV0ZUZpbHRlcihmaWx0ZXJDcml0ZXJpYSkpIHtcbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZUZpbHRlclRvRXhwcmVzc2lvbihmaWx0ZXJDcml0ZXJpYSwgYXR0cmlidXRlcywgb3BlcmF0aW9ucyk7XG4gICAgfVxuXG4gICAgY29uc3QgbXNnID0gYGVudGl0eUZpbHRlcnMgaXMgbm90IGEgRW50aXR5RmlsdGVyR3JvdXAgb3IgRW50aXR5RmlsdGVyQ3JpdGVyaWEgb3IgRW50aXR5QXR0cmlidXRlRmlsdGVyQ3JpdGVyaWFgO1xuXG4gICAgbG9nZ2VyLmVycm9yKGBmaWx0ZXJDcml0ZXJpYU9yRmlsdGVyR3JvdXBUb0V4cHJlc3Npb246ICR7bXNnfWAsIHsgZmlsdGVyQ3JpdGVyaWEgfSk7XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bXNnfWApO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGEgZmlsdGVyIGdyb3VwIG9iamVjdCBpbnRvIGEgZmlsdGVyIGV4cHJlc3Npb24gc3RyaW5nLlxuICogQHBhcmFtIGZpbHRlckdyb3VwIC0gVGhlIGZpbHRlciBncm91cCBvYmplY3QgdG8gY29udmVydC5cbiAqIEBwYXJhbSBhdHRyaWJ1dGVzIC0gVGhlIGF0dHJpYnV0ZXMgb2JqZWN0LlxuICogQHBhcmFtIG9wZXJhdGlvbnMgLSBUaGUgb3BlcmF0aW9ucyBvYmplY3QuXG4gKiBAcmV0dXJucyBUaGUgZmlsdGVyIGV4cHJlc3Npb24gc3RyaW5nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsdGVyR3JvdXBUb0V4cHJlc3Npb248XG4gICAgQSBleHRlbmRzIHN0cmluZyxcbiAgICBGIGV4dGVuZHMgc3RyaW5nLFxuICAgIEMgZXh0ZW5kcyBzdHJpbmcsXG4gICAgUyBleHRlbmRzIEVudGl0eVNjaGVtYTxBLCBGLCBDPixcbiAgICBJIGV4dGVuZHMgSXRlbTxBLCBGLCBDLCBTLCBTWyBcImF0dHJpYnV0ZXNcIiBdPixcbiAgICBXQXR0cmlidXRlcyBleHRlbmRzIFdoZXJlQXR0cmlidXRlczxBLCBGLCBDLCBTLCBJPixcbiAgICBXT3BlcmF0aW9ucyBleHRlbmRzIFdoZXJlT3BlcmF0aW9uczxBLCBGLCBDLCBTLCBJPixcbj4oZmlsdGVyR3JvdXA6IEVudGl0eUZpbHRlckdyb3VwPGFueT4sIGF0dHJpYnV0ZXM6IFdBdHRyaWJ1dGVzLCBvcGVyYXRpb25zOiBXT3BlcmF0aW9ucykge1xuXG4gICAgY29uc3QgeyBmaWx0ZXJJZDogaWQsIGZpbHRlckxhYmVsOiBsYWJlbCwgYW5kID0gW10sIG9yID0gW10sIG5vdCA9IFtdIH0gPSBmaWx0ZXJHcm91cDtcblxuICAgIGNvbnN0IGZpbHRlckdyb3VwRnJhZ21lbnRzOiBBcnJheTxzdHJpbmc+ID0gW107XG5cbiAgICBjb25zdCBhbmRGcmFnbWVudHM6IEFycmF5PHN0cmluZz4gPSBbXTtcblxuICAgIGZvciAoY29uc3QgdGhpc0ZpbHRlciBvZiBhbmQpIHtcbiAgICAgICAgY29uc3QgdGhpc0V4cHJlc3Npb24gPSBmaWx0ZXJDcml0ZXJpYU9yRmlsdGVyR3JvdXBPckF0dHJpYnV0ZUZpbHRlclRvRXhwcmVzc2lvbih7XG4gICAgICAgICAgICBmaWx0ZXJDcml0ZXJpYTogdGhpc0ZpbHRlcixcbiAgICAgICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBvcGVyYXRpb25zXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAodGhpc0V4cHJlc3Npb24ubGVuZ3RoKSB7XG4gICAgICAgICAgICBhbmRGcmFnbWVudHMucHVzaCh0aGlzRXhwcmVzc2lvbik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYW5kRnJhZ21lbnRzLmxlbmd0aCkge1xuICAgICAgICBjb25zdCBhbmRFeHByZXNzaW9ucyA9IG1ha2VQYXJlbnRoZXNlc0dyb3VwKGFuZEZyYWdtZW50cywgJ2FuZCcpO1xuICAgICAgICBmaWx0ZXJHcm91cEZyYWdtZW50cy5wdXNoKGFuZEV4cHJlc3Npb25zKTtcbiAgICB9XG5cbiAgICBjb25zdCBvckZyYWdtZW50czogQXJyYXk8c3RyaW5nPiA9IFtdO1xuICAgIGZvciAoY29uc3QgdGhpc0ZpbHRlciBvZiBvcikge1xuICAgICAgICBjb25zdCB0aGlzRXhwcmVzc2lvbiA9IGZpbHRlckNyaXRlcmlhT3JGaWx0ZXJHcm91cE9yQXR0cmlidXRlRmlsdGVyVG9FeHByZXNzaW9uKHtcbiAgICAgICAgICAgIGZpbHRlckNyaXRlcmlhOiB0aGlzRmlsdGVyLFxuICAgICAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgICAgIG9wZXJhdGlvbnNcbiAgICAgICAgfSk7XG4gICAgICAgIGlmICh0aGlzRXhwcmVzc2lvbi5sZW5ndGgpIHtcbiAgICAgICAgICAgIG9yRnJhZ21lbnRzLnB1c2godGhpc0V4cHJlc3Npb24pO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChvckZyYWdtZW50cy5sZW5ndGgpIHtcbiAgICAgICAgY29uc3Qgb3JFeHByZXNzaW9ucyA9IG1ha2VQYXJlbnRoZXNlc0dyb3VwKG9yRnJhZ21lbnRzLCAnb3InKTtcbiAgICAgICAgZmlsdGVyR3JvdXBGcmFnbWVudHMucHVzaChvckV4cHJlc3Npb25zKTtcbiAgICB9XG5cbiAgICBjb25zdCBub3RGcmFnbWVudHM6IEFycmF5PHN0cmluZz4gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHRoaXNGaWx0ZXIgb2Ygbm90KSB7XG4gICAgICAgIGNvbnN0IHRoaXNFeHByZXNzaW9uID0gZmlsdGVyQ3JpdGVyaWFPckZpbHRlckdyb3VwT3JBdHRyaWJ1dGVGaWx0ZXJUb0V4cHJlc3Npb24oe1xuICAgICAgICAgICAgZmlsdGVyQ3JpdGVyaWE6IHRoaXNGaWx0ZXIsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICAgICAgb3BlcmF0aW9uc1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKHRoaXNFeHByZXNzaW9uLmxlbmd0aCkge1xuICAgICAgICAgICAgbm90RnJhZ21lbnRzLnB1c2godGhpc0V4cHJlc3Npb24pO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChub3RGcmFnbWVudHMubGVuZ3RoKSB7XG4gICAgICAgIGNvbnN0IG5vdEV4cHJlc3Npb25zID0gbWFrZVBhcmVudGhlc2VzR3JvdXAobm90RnJhZ21lbnRzLCAnQU5EIE5PVCcpO1xuICAgICAgICBmaWx0ZXJHcm91cEZyYWdtZW50cy5wdXNoKG5vdEV4cHJlc3Npb25zKTtcbiAgICB9XG5cbiAgICBjb25zdCBmaWx0ZXJFeHByZXNzaW9uID0gbWFrZVBhcmVudGhlc2VzR3JvdXAoZmlsdGVyR3JvdXBGcmFnbWVudHMsICdBTkQnKTtcblxuICAgIHJldHVybiBmaWx0ZXJFeHByZXNzaW9uO1xufVxuXG5cbi8qKlxuICogUGFyc2VzIHRoZSBxdWVyeSBzdHJpbmcgcGFyYW1ldGVycyBmcm9tIGFuIG9iamVjdCBpbnRvIGEgc3RydWN0dXJlZCBmb3JtYXQuXG4gKiBAcGFyYW0gcXVlcnlTdHJpbmdQYXJhbWV0ZXJzIC0gVGhlIHF1ZXJ5IHN0cmluZyBwYXJhbWV0ZXJzIGFzIGFuIG9iamVjdC5cbiAqIEByZXR1cm5zIFRoZSBwYXJzZWQgcXVlcnkgc3RyaW5nIHBhcmFtZXRlcnMuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogIGNvbnN0IHF1ZXJ5U3RyaW5nUGFyYW1ldGVycyA9IHtcbiAqICAgICAgJ3VzZXIubmFtZSc6ICdKb2huJyxcbiAqICAgICAgJ3VzZXIuYWdlJzogJzMwJyxcbiAqICAgICAgJ3VzZXIuaG9iYmllcyc6ICdyZWFkaW5nLHdyaXRpbmcnLFxuICogICAgICAndXNlci5hZGRyZXNzLmNpdHknOiAnTmV3IFlvcmsnLFxuICogICAgICAndXNlci5hZGRyZXNzLmNvdW50cnknOiAnVVNBJyxcbiAqICB9O1xuICogIFxuICogIGNvbnN0IHBhcnNlZCA9IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzKHF1ZXJ5U3RyaW5nUGFyYW1ldGVycyk7XG4gKiAgXG4gKiAgZXhwZWN0KHBhcnNlZCkudG8uZGVlcC5lcXVhbCh7XG4gKiAgICAgIHVzZXI6IHtcbiAqICAgICAgICAgIG5hbWU6ICdKb2huJyxcbiAqICAgICAgICAgIGFnZTogJzMwJyxcbiAqICAgICAgICAgIGhvYmJpZXM6IFsncmVhZGluZycsICd3cml0aW5nJ10sXG4gKiAgICAgICAgICBhZGRyZXNzOiB7XG4gKiAgICAgICAgICAgICAgY2l0eTogJ05ldyBZb3JrJyxcbiAqICAgICAgICAgICAgICBjb3VudHJ5OiAnVVNBJyxcbiAqICAgICAgICAgIH0sXG4gKiAgICAgIH0sXG4gKiAgfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzKHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBbIG5hbWU6IHN0cmluZyBdOiBzdHJpbmcgfCB1bmRlZmluZWQgfSkge1xuXG4gICAgY29uc3QgcXVlcnlTdHJpbmcgPSBzdHJpbmdpZnlRdWVyeVBhcmFtcyhxdWVyeVN0cmluZ1BhcmFtZXRlcnMpO1xuXG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VRdWVyeVN0cmluZyhxdWVyeVN0cmluZywge1xuICAgICAgICBkZWxpbWl0ZXI6IC9bOywmOitdLyxcbiAgICAgICAgYWxsb3dEb3RzOiB0cnVlLFxuICAgICAgICBkZWNvZGVEb3RJbktleXM6IHRydWUsXG4gICAgICAgIHBhcnNlQXJyYXlzOiB0cnVlLFxuICAgICAgICBkdXBsaWNhdGVzOiAnY29tYmluZScsXG4gICAgICAgIGFsbG93RW1wdHlBcnJheXM6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHBhcnNlZDtcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIHF1ZXJ5IHN0cmluZyBwYXJhbWV0ZXIgaW50byBhIGZpbHRlciBvYmplY3QuXG4gKiBAcGFyYW0gcGFyYW1OYW1lIC0gVGhlIG5hbWUgb2YgdGhlIHF1ZXJ5IHN0cmluZyBwYXJhbWV0ZXIuXG4gKiBAcGFyYW0gcGFyYW1WYWx1ZSAtIFRoZSB2YWx1ZSBvZiB0aGUgcXVlcnkgc3RyaW5nIHBhcmFtZXRlci5cbiAqIEByZXR1cm5zIFRoZSBmb3JtYXR0ZWQgZmlsdGVyIG9iamVjdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VGaWx0ZXJGcm9tUXVlcnlTdHJpbmdQYXJhbShwYXJhbU5hbWU6IHN0cmluZywgcGFyYW1WYWx1ZTogYW55KSB7XG5cbiAgICAvKipcbiAgICAgKiAgeyBwYXJhbU5hbWU6IG9yLCAgcGFyYW1WYWx1ZTogW3sgZm9vOiB7IGVxOiAnMScgfX0sIHsgZm9vOiB7IG5lcTogJzMnIH0gfV0gfVxuICAgICAqL1xuICAgIGlmIChbICdhbmQnLCAnb3InLCAnbm90JyBdLmluY2x1ZGVzKHBhcmFtTmFtZSkpIHtcblxuICAgICAgICBsZXQgZm9ybWF0dGVkR3JvdXBWYWw6IEFycmF5PGFueT4gPSBbXTtcblxuICAgICAgICBwYXJhbVZhbHVlLmZvckVhY2goKGl0ZW06IGFueSkgPT4ge1xuICAgICAgICAgICAgT2JqZWN0LmtleXMoaXRlbSkuZm9yRWFjaCgoaXRlbUtleTogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgaXRlbVZhbHVlID0gaXRlbVsgaXRlbUtleSBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGZvcm1hdHRlZEl0ZW1zID0gbWFrZUZpbHRlckZyb21RdWVyeVN0cmluZ1BhcmFtKGl0ZW1LZXksIGl0ZW1WYWx1ZSk7XG4gICAgICAgICAgICAgICAgZm9ybWF0dGVkR3JvdXBWYWwgPSBmb3JtYXR0ZWRHcm91cFZhbC5jb25jYXQoZm9ybWF0dGVkSXRlbXMpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBmb3JtYXR0ZWRHcm91cFZhbDtcbiAgICB9XG5cbiAgICBsZXQgZm9ybWF0dGVkVmFsdWVzOiBhbnkgPSB7fTtcblxuICAgIGlmICghaXNPYmplY3QocGFyYW1WYWx1ZSkpIHtcbiAgICAgICAgcGFyYW1WYWx1ZSA9IHsgJ2VxJzogcGFyYW1WYWx1ZSB9O1xuICAgIH1cblxuICAgIC8qXG4gICAgICAgIGZvbzoge1xuICAgICAgICAgICAgZXE6ICcxJyxcbiAgICAgICAgICAgIG5lcTogJzMnLFxuICAgICAgICAgICAgaW46IFsyMzIsa2wsa2xrXSxcbiAgICAgICAgICAgIG5pbjogcXdxLDMzNCxqaGosXG4gICAgICAgICAgICBjb250YWluczogaGoraGpqK3l1eTdcbiAgICAgICAgfVxuICAgICovXG4gICAgT2JqZWN0LmtleXMocGFyYW1WYWx1ZSkuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICAgIGNvbnN0IGtleVZhbCA9IHBhcmFtVmFsdWVbIGtleSBdO1xuICAgICAgICBsZXQgZm9ybWF0dGVkVmFsID0ga2V5VmFsO1xuXG4gICAgICAgIC8vIHBhcnNlIHRoZSB2YWx1ZXMgdG8gdGhlIHJpZ2h0IHR5cGVzIGhlcmVcbiAgICAgICAgaWYgKEZJTFRFUl9LRVlTX0hBVklOR19BUlJBWV9WQUxVRVMuaW5jbHVkZXMoa2V5KSAmJiB0eXBlb2Yga2V5VmFsID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgZm9ybWF0dGVkVmFsID0ga2V5VmFsLnNwbGl0KFBBUlNFX1ZBTFVFX0RFTElNSVRFUlMpO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9ybWF0dGVkVmFsID0gcGFyc2VWYWx1ZVRvQ29ycmVjdFR5cGVzKGZvcm1hdHRlZFZhbCk7XG5cbiAgICAgICAgZm9ybWF0dGVkVmFsdWVzWyBrZXkgXSA9IGZvcm1hdHRlZFZhbDtcbiAgICB9KTtcblxuICAgIGNvbnN0IGZvcm1hdHRlZEl0ZW1WYWwgPSB7XG4gICAgICAgIGF0dHJpYnV0ZTogcGFyYW1OYW1lLFxuICAgICAgICAuLi5mb3JtYXR0ZWRWYWx1ZXNcbiAgICB9XG5cbiAgICByZXR1cm4gZm9ybWF0dGVkSXRlbVZhbDtcbn1cblxuXG4vKipcbiAqIENvbnZlcnRzIHF1ZXJ5IHN0cmluZyBwYXJhbWV0ZXJzIHRvIGEgZmlsdGVyIGdyb3VwLlxuICogQHBhcmFtIHF1ZXJ5U3RyaW5nUGFyYW1zIC0gVGhlIHF1ZXJ5IHN0cmluZyBwYXJhbWV0ZXJzLlxuICogQHJldHVybnMgVGhlIGZvcm1hdHRlZCBmaWx0ZXIgZ3JvdXAuXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqICBjb25zdCBxdWVyeVN0cmluZ1BhcmFtcyA9IHtcbiAqICAgICAgJ2FuZCc6IFtcbiAqICAgICAgICAgIHsgJ3VzZXIuYWdlJzogeyAnZ3QnOiAnMzAnIH0gfSxcbiAqICAgICAgICAgIHsgJ3VzZXIuaG9iYmllcyc6IHsgJ2luJzogJ3JlYWRpbmcsd3JpdGluZycgfSB9LFxuICogICAgICBdLFxuICogICAgICAnb3InOiBbXG4gKiAgICAgICAgICB7ICd1c2VyLm5hbWUnOiB7ICdlcSc6ICdKb2huJyB9IH0sXG4gKiAgICAgICAgICB7ICd1c2VyLmFkZHJlc3MuY2l0eSc6IHsgJ2VxJzogJ05ldyBZb3JrJyB9IH0sXG4gKiAgICAgIF0sXG4gKiAgfTtcbiAqICBcbiAqICBjb25zdCBmaWx0ZXJHcm91cCA9IHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cChxdWVyeVN0cmluZ1BhcmFtcyk7XG4gKiAgXG4gKiAgZXhwZWN0KGZpbHRlckdyb3VwKS50by5kZWVwLmVxdWFsKHtcbiAqICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICogICAgICBhbmQ6IFtcbiAqICAgICAgICAgIHtcbiAqICAgICAgICAgICAgICBhdHRyaWJ1dGU6ICd1c2VyLmFnZScsXG4gKiAgICAgICAgICAgICAgZ3Q6IDMwLFxuICogICAgICAgICAgfSxcbiAqICAgICAgICAgIHtcbiAqICAgICAgICAgICAgICBhdHRyaWJ1dGU6ICd1c2VyLmhvYmJpZXMnLFxuICogICAgICAgICAgICAgIGluOiBbJ3JlYWRpbmcnLCAnd3JpdGluZyddLFxuICogICAgICAgICAgfSxcbiAqICAgICAgXSxcbiAqICAgICAgbm90OiBbXSxcbiAqICAgICAgb3I6IFtcbiAqICAgICAgICAgIHtcbiAqICAgICAgICAgICAgIGF0dHJpYnV0ZTogJ3VzZXIubmFtZScsXG4gKiAgICAgICAgICAgIGVxOiAnSm9obicsXG4gKiAgICAgICAgICB9LFxuICogICAgICAgICAge1xuICogICAgICAgICAgICAgIGF0dHJpYnV0ZTogJ3VzZXIuYWRkcmVzcy5jaXR5JyxcbiAqICAgICAgICAgICBlcTogJ05ldyBZb3JrJyxcbiAqICAgICAgICAgIH0sXG4gKiAgICAgIF0sXG4gKiAgfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cChxdWVyeVN0cmluZ1BhcmFtczogeyBbIG5hbWU6IHN0cmluZyBdOiBhbnkgfSkge1xuXG4gICAgY29uc3QgZm9ybWF0dGVkOiBFbnRpdHlGaWx0ZXJHcm91cDxhbnk+ID0ge1xuICAgICAgICBmaWx0ZXJJZDogJ3F1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCcsXG4gICAgICAgIGFuZDogW10sXG4gICAgICAgIG5vdDogW10sXG4gICAgICAgIG9yOiBbXSxcbiAgICB9O1xuXG4gICAgZm9yIChsZXQgcVBhcmFtTmFtZSBpbiBxdWVyeVN0cmluZ1BhcmFtcykge1xuXG4gICAgICAgIGxldCBncm91cE5hbWU6IGtleW9mIHR5cGVvZiBmb3JtYXR0ZWQgPSAnYW5kJztcblxuICAgICAgICAvLyB0aGVuIHRyZWF0IGl0IGFzIGEgZmlsdGVyIGl0ZW1cbiAgICAgICAgaWYgKE9iamVjdC5rZXlzKGZvcm1hdHRlZCkuaW5jbHVkZXMocVBhcmFtTmFtZSkpIHtcbiAgICAgICAgICAgIGdyb3VwTmFtZSA9IHFQYXJhbU5hbWUgYXMga2V5b2YgdHlwZW9mIGZvcm1hdHRlZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBxUGFyYW1WYWx1ZSA9IHF1ZXJ5U3RyaW5nUGFyYW1zWyBxUGFyYW1OYW1lIF07XG5cbiAgICAgICAgY29uc3QgZm9ybWF0dGVkUVBWYWwgPSBtYWtlRmlsdGVyRnJvbVF1ZXJ5U3RyaW5nUGFyYW0ocVBhcmFtTmFtZSwgcVBhcmFtVmFsdWUpO1xuXG4gICAgICAgIGZvcm1hdHRlZFsgZ3JvdXBOYW1lIF0gPSBmb3JtYXR0ZWRbIGdyb3VwTmFtZSBdIS5jb25jYXQoZm9ybWF0dGVkUVBWYWwpIGFzIGFueTtcbiAgICB9XG5cblxuICAgIHJldHVybiBmb3JtYXR0ZWQ7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIGZpbHRlciBncm91cCBmb3Igc2VhcmNoaW5nIGtleXdvcmRzIGluIHRoZSBzcGVjaWZpZWQgYXR0cmlidXRlcy5cbiAqIEBwYXJhbSBrZXl3b3JkcyAtIEFuIGFycmF5IG9mIGtleXdvcmRzIHRvIHNlYXJjaCBmb3IuXG4gKiBAcGFyYW0gYXR0cmlidXRlTmFtZXMgLSBBbiBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMgdG8gc2VhcmNoIHdpdGhpbi4gRGVmYXVsdHMgdG8gYW4gZW1wdHkgYXJyYXkuXG4gKiBAcmV0dXJucyBBIGZpbHRlciBncm91cCBvYmplY3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkczxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBrZXl3b3JkczogQXJyYXk8c3RyaW5nPixcbiAgICBhdHRyaWJ1dGVOYW1lczogQXJyYXk8c3RyaW5nPiA9IFtdXG4pOiBFbnRpdHlGaWx0ZXJHcm91cDxFPiB7XG5cbiAgICBjb25zdCBmaWx0ZXJHcm91cDogRW50aXR5RmlsdGVyR3JvdXA8RT4gPSB7XG4gICAgICAgIGZpbHRlcklkOiAna2V5d29yZFNlYXJjaEZpbHRlckdyb3VwJyxcbiAgICAgICAgb3I6IFtdLFxuICAgIH07XG5cbiAgICBhdHRyaWJ1dGVOYW1lcy5mb3JFYWNoKChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICAgIGZpbHRlckdyb3VwIS5vciEucHVzaCh7XG4gICAgICAgICAgICBhdHRyaWJ1dGU6IGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgICBjb250YWluczoga2V5d29yZHMsXG4gICAgICAgIH0gYXMgYW55KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBmaWx0ZXJHcm91cDtcbn1cblxuLyoqXG4gKiBBZGRzIGEgZmlsdGVyIGdyb3VwIHRvIHRoZSBlbnRpdHkgZmlsdGVyIGNyaXRlcmlhLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAcGFyYW0ge0VudGl0eUZpbHRlckdyb3VwPEU+fSBmaWx0ZXJHcm91cCAtIFRoZSBmaWx0ZXIgZ3JvdXAgdG8gYWRkLlxuICogQHBhcmFtIHtFbnRpdHlGaWx0ZXJDcml0ZXJpYTxFPn0gW2VudGl0eUZpbHRlckNyaXRlcmlhXSAtIFRoZSBleGlzdGluZyBlbnRpdHkgZmlsdGVyIGNyaXRlcmlhLlxuICogQHJldHVybnMge0VudGl0eUZpbHRlckNyaXRlcmlhPEU+fSAtIFRoZSB1cGRhdGVkIGVudGl0eSBmaWx0ZXIgY3JpdGVyaWEuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWE8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgZmlsdGVyR3JvdXA6IEVudGl0eUZpbHRlckdyb3VwPEU+LFxuICAgIGVudGl0eUZpbHRlckNyaXRlcmlhPzogRW50aXR5RmlsdGVyQ3JpdGVyaWE8RT4sXG4pOiBFbnRpdHlGaWx0ZXJDcml0ZXJpYTxFPiB7XG5cbiAgICBjb25zdCBuZXdGaWx0ZXJDcml0ZXJpYTogRW50aXR5RmlsdGVyR3JvdXA8RT4gPSBpc0VudGl0eUZpbHRlckdyb3VwPEU+KGVudGl0eUZpbHRlckNyaXRlcmlhKVxuICAgICAgICA/IHsgLi4uZW50aXR5RmlsdGVyQ3JpdGVyaWEgfVxuICAgICAgICA6IHsgZmlsdGVySWQ6ICdfYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhJyB9O1xuXG4gICAgLy8gbWFrZSBzdXJlIGl0IGhhcyBhbiBgYW5kYCBncm91cFxuICAgIG5ld0ZpbHRlckNyaXRlcmlhLmFuZCA9IG5ld0ZpbHRlckNyaXRlcmlhLmFuZCB8fCBbXTtcblxuICAgIC8qKiBcbiAgICAgKiBTcHJlYWQgb3V0IHRoZSBmaWx0ZXJzIHRvIG1ha2Ugc3VyZSB3ZSBoYXZlIGEgY29weSBvZiB0aGUgb3JpZ2luYWwgZmlsdGVyIGNyaXRlcmlhLlxuICAgICAqIE5vdGU6IEEgZGVlcCBjb3B5IG1heSBtYWtlIG1vcmUgc2Vuc2UuXG4gICAgICovXG5cbiAgICBpZiAoaXNBdHRyaWJ1dGVGaWx0ZXIoZW50aXR5RmlsdGVyQ3JpdGVyaWEpIHx8IGlzRW50aXR5RmlsdGVyKGVudGl0eUZpbHRlckNyaXRlcmlhKSkge1xuICAgICAgICBuZXdGaWx0ZXJDcml0ZXJpYS5hbmQucHVzaCh7IC4uLmVudGl0eUZpbHRlckNyaXRlcmlhIH0pO1xuICAgIH1cblxuICAgIG5ld0ZpbHRlckNyaXRlcmlhLmFuZC5wdXNoKHsgLi4uZmlsdGVyR3JvdXAgfSBhcyBhbnkpO1xuXG4gICAgcmV0dXJuIG5ld0ZpbHRlckNyaXRlcmlhIGFzIEVudGl0eUZpbHRlckNyaXRlcmlhPEU+O1xufSJdfQ==