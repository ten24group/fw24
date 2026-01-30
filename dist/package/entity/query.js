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
        else if (['exists', 'notExists', 'isNull', 'notNull', 'empty', 'notEmpty'].includes(filterKey)) {
            // Primary: exists/notExists
            // Aliases: isNull/empty → notExists, notNull/notEmpty → exists
            const isExistsOp = ['exists', 'notNull', 'notEmpty'].includes(filterKey);
            const wantExists = isExistsOp ? filterVal : !filterVal;
            filterFragments.push(wantExists ? exists(attributeRef) : notExists(attributeRef));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L3F1ZXJ5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBMERBLDhEQThDQztBQUVELGtFQW9IQztBQUVELG9EQUVDO0FBdUNELDhEQTBCQztBQVNELDREQW1CQztBQVVELDRFQXFCQztBQVFELDRIQThCQztBQVNELDBEQW1FQztBQWlDRCxzRUFjQztBQVFELHdFQXVEQztBQWdERCx3RUEyQkM7QUFRRCw0RUFrQkM7QUFVRCxvRkF3QkM7QUFqc0JELHdDQUEwQztBQUMxQywrQ0FBNkc7QUFDN0csK0NBa0J1QjtBQUV2QiwyQkFHWTtBQUVaLG9DQUE4RDtBQUU5RCxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsYUFBYSxDQUFDLENBQUM7QUFFM0M7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FzQkc7QUFDSCxTQUFnQix5QkFBeUIsQ0FBQyxLQUFlO0lBTXJELE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQTZCLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRSxFQUFFO1FBQ2xFLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFFN0IsSUFBSSxDQUFDLE1BQU0sQ0FBdUIsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxFQUFFO1lBQ2xELElBQUksS0FBSyxLQUFLLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQzVCLElBQUksT0FBTyxHQUFHLENBQUUsR0FBRyxDQUFFLEtBQUssUUFBUSxFQUFFLENBQUM7b0JBQ2pDLHFEQUFxRDtnQkFDekQsQ0FBQztxQkFBTSxDQUFDO29CQUNKLDJEQUEyRDtvQkFDM0QsR0FBRyxDQUFFLEdBQUcsQ0FBRSxHQUFHLElBQUksQ0FBQztnQkFDdEIsQ0FBQztZQUNMLENBQUM7aUJBQU0sQ0FBQztnQkFDSixJQUFJLE9BQU8s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LG9DQUFvQyxDQUNoRCxXQUFpQyxFQUNqQyxvQkFBOEM7SUFHOUMsTUFBTSxpQkFBaUIsR0FBeUIsSUFBQSxpQ0FBbUIsRUFBSSxvQkFBb0IsQ0FBQztRQUN4RixDQUFDLENBQUMsRUFBRSxHQUFHLG9CQUFvQixFQUFFO1FBQzdCLENBQUMsQ0FBQyxFQUFFLFFBQVEsRUFBRSx1Q0FBdUMsRUFBRSxDQUFDO0lBRTVELGtDQUFrQztJQUNsQyxpQkFBaUIsQ0FBQyxHQUFHLEdBQUcsaUJBQWlCLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQztJQUVwRDs7O09BR0c7SUFFSCxJQUFJLElBQUEsK0JBQWlCLEVBQUMsb0JBQW9CLENBQUMsSUFBSSxJQUFBLDRCQUFjLEVBQUMsb0JBQW9CLENBQUMsRUFBRSxDQUFDO1FBQ2xGLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxHQUFHLG9CQUFvQixFQUFFLENBQUMsQ0FBQztJQUM1RCxDQUFDO0lBRUQsaUJBQWlCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLEdBQUcsV0FBVyxFQUFTLENBQUMsQ0FBQztJQUV0RCxPQUFPLGlCQUE0QyxDQUFDO0FBQ3hELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEl0ZW0sIFdoZXJlQXR0cmlidXRlcywgV2hlcmVPcGVyYXRpb25zIH0gZnJvbSBcImVsZWN0cm9kYlwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlTY2hlbWEgfSBmcm9tIFwiLi9iYXNlLWVudGl0eVwiO1xuaW1wb3J0IHR5cGUgeyBFbnRpdHlBdHRyaWJ1dGVGaWx0ZXIsIEVudGl0eUZpbHRlciwgRW50aXR5RmlsdGVyQ3JpdGVyaWEsIEVudGl0eUZpbHRlckdyb3VwLCBQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocywgVHlwZWRGaWx0ZXJDcml0ZXJpYSB9IGZyb20gJy4vcXVlcnktdHlwZXMnO1xuXG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgaXNBdHRyaWJ1dGVGaWx0ZXIsIGlzQ29tcGxleEZpbHRlclZhbHVlLCBpc0VudGl0eUZpbHRlciwgaXNFbnRpdHlGaWx0ZXJHcm91cCB9IGZyb20gXCIuL3F1ZXJ5LXR5cGVzXCI7XG5pbXBvcnQge1xuICAgIEZJTFRFUl9LRVlTX0hBVklOR19BUlJBWV9WQUxVRVMsXG4gICAgUEFSU0VfVkFMVUVfREVMSU1JVEVSUyxcbiAgICBpc0NvbnRhaW5zT3AsXG4gICAgaXNFcXVhbGl0eU9wLFxuICAgIGlzR3JlYXRlclRoYW5PcCxcbiAgICBpc0dyZWF0ZXJUaGFuT3JFcXVhbE9wLFxuICAgIGlzSW5PcCxcbiAgICBpc0luZXF1YWxpdHlPcCxcbiAgICBpc0xlc3NUaGFuT3AsXG4gICAgaXNMZXNzVGhhbk9yRXF1YWxPcCxcbiAgICBpc05vdENvbnRhaW5zT3AsXG4gICAgaXNOb3RJbk9wLFxuICAgIGlzT3BlcmF0b3JBbGlhcyxcbiAgICBpc1JhbmdlT3AsXG4gICAgaXNTdHJpbmdQYXR0ZXJuT3AsXG4gICAgbm9ybWFsaXplUmFuZ2VWYWx1ZSxcbiAgICBub3JtYWxpemVUb0FycmF5XG59IGZyb20gJy4vcXVlcnktdXRpbHMnO1xuXG5pbXBvcnQge1xuICAgIHBhcnNlIGFzIHBhcnNlUXVlcnlTdHJpbmcsXG4gICAgc3RyaW5naWZ5IGFzIHN0cmluZ2lmeVF1ZXJ5UGFyYW1zLFxufSBmcm9tICdxcyc7XG5cbmltcG9ydCB7IGlzT2JqZWN0LCBwYXJzZVZhbHVlVG9Db3JyZWN0VHlwZXMgfSBmcm9tICcuLi91dGlscyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignRW50aXR5UXVlcnknKTtcblxuLyoqXG4gKiBQYXJzZXMgdGhlIGdpdmVuIGFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGUgcGF0aHMgaW50byBhIHN0cnVjdHVyZWQgZm9ybWF0LlxuICogQHBhcmFtIHBhdGhzIC0gVGhlIGFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGUgcGF0aHMuXG4gKiBAcmV0dXJucyBUaGUgcGFyc2VkIGVudGl0eSBhdHRyaWJ1dGUgcGF0aHMuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogY29uc3QgcGF0aHMgPSBbJ3VzZXIubmFtZScsICd1c2VyLmFnZScsICd1c2VyLmFkZHJlc3MuY2l0eSddO1xuICogY29uc3QgcGFyc2VkID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhwYXRocyk7XG4gKiBcbiAqIGNvbnNvbGUubG9nKHBhcnNlZCk7XG4gKiAvLyBPdXRwdXQ6IFxuICogLy8ge1xuICogLy8gICB1c2VyOiB7XG4gKiAvLyAgICAgbmFtZTogdHJ1ZSxcbiAqIC8vICAgICBhZ2U6IHRydWUsXG4gKiAvLyAgICAgYWRkcmVzczoge1xuICogLy8gICAgICAgY2l0eTogdHJ1ZVxuICogLy8gICAgIH1cbiAqIC8vICAgfVxuICogLy8gfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzKHBhdGhzOiBzdHJpbmdbXSk6IFBhcnNlZEVudGl0eUF0dHJpYnV0ZVBhdGhzIHtcblxuICAgIHR5cGUgUGFyc2VkQXR0cmlidXRlUGF0aHMgPSB7XG4gICAgICAgIFsga2V5OiBzdHJpbmcgXTogYm9vbGVhbiB8IFBhcnNlZEF0dHJpYnV0ZVBhdGhzO1xuICAgIH07XG5cbiAgICBjb25zdCBwYXJzZWQgPSBwYXRocy5yZWR1Y2U8UGFyc2VkRW50aXR5QXR0cmlidXRlUGF0aHM+KChhY2MsIHBhdGgpID0+IHtcbiAgICAgICAgY29uc3Qga2V5cyA9IHBhdGguc3BsaXQoJy4nKTtcblxuICAgICAgICBrZXlzLnJlZHVjZTxQYXJzZWRBdHRyaWJ1dGVQYXRocz4oKG9iaiwga2V5LCBpbmRleCkgPT4ge1xuICAgICAgICAgICAgaWYgKGluZGV4ID09PSBrZXlzLmxlbmd0aCAtIDEpIHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIG9ialsga2V5IF0gPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHRoZSBrZXkgYWxyZWFkeSBleGlzdHMgYXMgYW4gb2JqZWN0LCBkbyBub3RoaW5nXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgdGhlIGtleSBkb2Vzbid0IGV4aXN0IG9yIGlzIGEgYm9vbGVhbiwgc2V0IGl0IHRvIHRydWVcbiAgICAgICAgICAgICAgICAgICAgb2JqWyBrZXkgXSA9IHRydWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIG9ialsga2V5IF0gPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgICAgICAgICAvLyBJZiB0aGUga2V5IGFscmVhZHkgZXhpc3RzIGFzIGEgYm9vbGVhbiwgY29udmVydCBpdCB0byBhbiBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgb2JqWyBrZXkgXSA9IHt9O1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHRoZSBrZXkgZG9lc24ndCBleGlzdCwgc2V0IGl0IHRvIGFuIG9iamVjdFxuICAgICAgICAgICAgICAgICAgICBvYmpbIGtleSBdID0gb2JqWyBrZXkgXSB8fCB7fTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBvYmpbIGtleSBdIGFzIFBhcnNlZEF0dHJpYnV0ZVBhdGhzO1xuICAgICAgICB9LCBhY2MpO1xuXG4gICAgICAgIHJldHVybiBhY2M7XG4gICAgfSwge30pO1xuXG4gICAgY29uc3QgZm9ybWF0ID0gKG9iajogUGFyc2VkQXR0cmlidXRlUGF0aHMpOiBQYXJzZWRFbnRpdHlBdHRyaWJ1dGVQYXRocyA9PiB7XG4gICAgICAgIGNvbnN0IHJlczogUGFyc2VkRW50aXR5QXR0cmlidXRlUGF0aHMgPSB7fTtcbiAgICAgICAgT2JqZWN0LmVudHJpZXMob2JqKS5mb3JFYWNoKChbIGtleSwgdmFsIF0pID0+IHtcbiAgICAgICAgICAgIGlmIChpc09iamVjdCh2YWwpKSB7XG4gICAgICAgICAgICAgICAgcmVzWyBrZXkgXSA9IHsgYXR0cmlidXRlczogZm9ybWF0KHZhbCkgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmVzWyBrZXkgXSA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JtYXQocGFyc2VkKTtcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBhdHRyaWJ1dGVGaWx0ZXJUb0V4cHJlc3Npb248XG4gICAgQSBleHRlbmRzIHN0cmluZyxcbiAgICBGIGV4dGVuZHMgc3RyaW5nLFxuICAgIEMgZXh0ZW5kcyBzdHJpbmcsXG4gICAgUyBleHRlbmRzIEVudGl0eVNjaGVtYTxBLCBGLCBDPixcbiAgICBJIGV4dGVuZHMgSXRlbTxBLCBGLCBDLCBTLCBTWyBcImF0dHJpYnV0ZXNcIiBdPixcbiAgICBXQXR0cmlidXRlcyBleHRlbmRzIFdoZXJlQXR0cmlidXRlczxBLCBGLCBDLCBTLCBJPixcbiAgICBXT3BlcmF0aW9ucyBleHRlbmRzIFdoZXJlT3BlcmF0aW9uczxBLCBGLCBDLCBTLCBJPixcbj4oZmlsdGVyOiBFbnRpdHlBdHRyaWJ1dGVGaWx0ZXI8YW55PiwgYXR0cmlidXRlczogV0F0dHJpYnV0ZXMsIG9wZXJhdGlvbnM6IFdPcGVyYXRpb25zKSB7XG5cbiAgICBjb25zdCB7IGZpbHRlcklkOiBpZCwgZmlsdGVyTGFiZWw6IGxhYmVsLCBhdHRyaWJ1dGU6IHByb3AsIGxvZ2ljYWxPcCA9ICdhbmQnLCAuLi5maWx0ZXJzIH0gPSBmaWx0ZXI7XG5cbiAgICBjb25zdCBhdHRyaWJ1dGVSZWYgPSBhdHRyaWJ1dGVzWyBwcm9wIGFzIGtleW9mIFdBdHRyaWJ1dGVzIF07XG5cbiAgICBpZiAoIWF0dHJpYnV0ZVJlZikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEludmFsaWQgZmlsdGVyIHByb3BlcnR5YCwgeyBwcm9wLCBmaWx0ZXIsIGF0dHJpYnV0ZXMgfSk7XG4gICAgICAgIHRocm93IChgSW52YWxpZCBmaWx0ZXIgcHJvcGVydHkgJHtwcm9wPy50b1N0cmluZygpfWApO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbHRlckZyYWdtZW50czogQXJyYXk8c3RyaW5nPiA9IFtdO1xuICAgIGNvbnN0IHsgZXEsIG5lLCBndCwgZ3RlLCBsdCwgbHRlLCBiZXR3ZWVuLCBiZWdpbnMsIGV4aXN0cywgbm90RXhpc3RzLCBjb250YWlucywgbm90Q29udGFpbnMsIG5hbWUsIHNpemUsIHR5cGUgfSA9IG9wZXJhdGlvbnM7XG5cbiAgICBmb3IgKGNvbnN0IGZpbHRlcktleSBpbiBmaWx0ZXJzKSB7XG5cbiAgICAgICAgbGV0IGZpbHRlclZhbCA9IGZpbHRlcnNbIGZpbHRlcktleSBhcyBrZXlvZiB0eXBlb2YgZmlsdGVycyBdO1xuXG4gICAgICAgIC8vIFVzZSBzaGFyZWQgdXRpbGl0eSBmb3IgY29tcGxleCBmaWx0ZXIgdmFsdWUgZXh0cmFjdGlvblxuICAgICAgICBpZiAoaXNDb21wbGV4RmlsdGVyVmFsdWUoZmlsdGVyVmFsKSkge1xuICAgICAgICAgICAgLy8gVE9ETzogaGFuZGxlIGBleHByZXNzaW9uYCBmaWx0ZXIgdmFsdWVzXG4gICAgICAgICAgICBmaWx0ZXJWYWwgPSBmaWx0ZXJWYWw/LnZhbFR5cGUgPT0gJ3Byb3BSZWYnID8gbmFtZShmaWx0ZXJWYWwudmFsKSA6IGZpbHRlclZhbC52YWw7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVc2Ugc2hhcmVkIHV0aWxpdGllcyBpbnN0ZWFkIG9mIGFycmF5LWJhc2VkIGNoZWNrc1xuICAgICAgICBpZiAoaXNFcXVhbGl0eU9wKGZpbHRlcktleSkpIHtcblxuICAgICAgICAgICAgZmlsdGVyRnJhZ21lbnRzLnB1c2goZXEoYXR0cmlidXRlUmVmLCBmaWx0ZXJWYWwpKTtcblxuICAgICAgICB9IGVsc2UgaWYgKGlzSW5lcXVhbGl0eU9wKGZpbHRlcktleSkpIHtcblxuICAgICAgICAgICAgZmlsdGVyRnJhZ21lbnRzLnB1c2gobmUoYXR0cmlidXRlUmVmLCBmaWx0ZXJWYWwpKTtcblxuICAgICAgICB9IGVsc2UgaWYgKGlzR3JlYXRlclRoYW5PcChmaWx0ZXJLZXkpKSB7XG5cbiAgICAgICAgICAgIGZpbHRlckZyYWdtZW50cy5wdXNoKGd0KGF0dHJpYnV0ZVJlZiwgZmlsdGVyVmFsKSk7XG5cbiAgICAgICAgfSBlbHNlIGlmIChpc0dyZWF0ZXJUaGFuT3JFcXVhbE9wKGZpbHRlcktleSkpIHtcblxuICAgICAgICAgICAgZmlsdGVyRnJhZ21lbnRzLnB1c2goZ3RlKGF0dHJpYnV0ZVJlZiwgZmlsdGVyVmFsKSk7XG5cbiAgICAgICAgfSBlbHNlIGlmIChpc0xlc3NUaGFuT3AoZmlsdGVyS2V5KSkge1xuXG4gICAgICAgICAgICBmaWx0ZXJGcmFnbWVudHMucHVzaChsdChhdHRyaWJ1dGVSZWYsIGZpbHRlclZhbCkpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoaXNMZXNzVGhhbk9yRXF1YWxPcChmaWx0ZXJLZXkpKSB7XG5cbiAgICAgICAgICAgIGZpbHRlckZyYWdtZW50cy5wdXNoKGx0ZShhdHRyaWJ1dGVSZWYsIGZpbHRlclZhbCkpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoaXNSYW5nZU9wKGZpbHRlcktleSkpIHtcbiAgICAgICAgICAgIC8vIFVzZSBzaGFyZWQgdXRpbGl0eSBmb3IgcmFuZ2UgdmFsdWUgbm9ybWFsaXphdGlvblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbIG1pbiwgbWF4IF0gPSBub3JtYWxpemVSYW5nZVZhbHVlKGZpbHRlclZhbCk7XG4gICAgICAgICAgICAgICAgZmlsdGVyRnJhZ21lbnRzLnB1c2goYmV0d2VlbihhdHRyaWJ1dGVSZWYsIG1pbiwgbWF4KSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIC8vIEZhbGxiYWNrIHRvIG9yaWdpbmFsIGFycmF5LWJhc2VkIGFwcHJvYWNoXG4gICAgICAgICAgICAgICAgZmlsdGVyRnJhZ21lbnRzLnB1c2goYmV0d2VlbihhdHRyaWJ1dGVSZWYsIGZpbHRlclZhbFsgMCBdLCBmaWx0ZXJWYWxbIDEgXSkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgIH0gZWxzZSBpZiAoaXNTdHJpbmdQYXR0ZXJuT3AoZmlsdGVyS2V5KSB8fCBpc09wZXJhdG9yQWxpYXMoZmlsdGVyS2V5LCAnc3RhcnRzV2l0aCcpKSB7XG5cbiAgICAgICAgICAgIGZpbHRlckZyYWdtZW50cy5wdXNoKGJlZ2lucyhhdHRyaWJ1dGVSZWYsIGZpbHRlclZhbCkpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoaXNDb250YWluc09wKGZpbHRlcktleSkgfHwgaXNPcGVyYXRvckFsaWFzKGZpbHRlcktleSwgJ2NvbnRhaW5zU29tZScpKSB7XG5cbiAgICAgICAgICAgIGZpbHRlclZhbCA9IG5vcm1hbGl6ZVRvQXJyYXkoZmlsdGVyVmFsKTtcbiAgICAgICAgICAgIGNvbnN0IGxvZ2ljYWxPcHAgPSBpc09wZXJhdG9yQWxpYXMoZmlsdGVyS2V5LCAnY29udGFpbnNTb21lJykgPyAnT1InIDogJ0FORCc7XG5cbiAgICAgICAgICAgIGNvbnN0IGxpc3RGaWx0ZXJzID0gZmlsdGVyVmFsLm1hcCgodmFsOiBhbnkpID0+IGNvbnRhaW5zKGF0dHJpYnV0ZVJlZiwgdmFsKSlcblxuICAgICAgICAgICAgZmlsdGVyRnJhZ21lbnRzLnB1c2gobWFrZVBhcmVudGhlc2VzR3JvdXAobGlzdEZpbHRlcnMsIGxvZ2ljYWxPcHApKTtcblxuICAgICAgICB9IGVsc2UgaWYgKGlzTm90Q29udGFpbnNPcChmaWx0ZXJLZXkpKSB7XG5cbiAgICAgICAgICAgIGZpbHRlclZhbCA9IG5vcm1hbGl6ZVRvQXJyYXkoZmlsdGVyVmFsKTtcblxuICAgICAgICAgICAgY29uc3QgbGlzdEZpbHRlcnMgPSBmaWx0ZXJWYWwubWFwKCh2YWw6IGFueSkgPT4gbm90Q29udGFpbnMoYXR0cmlidXRlUmVmLCB2YWwpKVxuXG4gICAgICAgICAgICBmaWx0ZXJGcmFnbWVudHMucHVzaChtYWtlUGFyZW50aGVzZXNHcm91cChsaXN0RmlsdGVycywgJ0FORCcpKTtcblxuICAgICAgICB9IGVsc2UgaWYgKGlzSW5PcChmaWx0ZXJLZXkpKSB7XG5cbiAgICAgICAgICAgIGZpbHRlclZhbCA9IG5vcm1hbGl6ZVRvQXJyYXkoZmlsdGVyVmFsKTtcblxuICAgICAgICAgICAgY29uc3QgbGlzdEZpbHRlcnMgPSBmaWx0ZXJWYWwubWFwKCh2YWw6IGFueSkgPT4gZXEoYXR0cmlidXRlUmVmLCB2YWwpKVxuXG4gICAgICAgICAgICBmaWx0ZXJGcmFnbWVudHMucHVzaChtYWtlUGFyZW50aGVzZXNHcm91cChsaXN0RmlsdGVycywgJ09SJykpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoaXNOb3RJbk9wKGZpbHRlcktleSkpIHtcblxuICAgICAgICAgICAgZmlsdGVyVmFsID0gbm9ybWFsaXplVG9BcnJheShmaWx0ZXJWYWwpO1xuXG4gICAgICAgICAgICBjb25zdCBsaXN0RmlsdGVycyA9IGZpbHRlclZhbC5tYXAoKHZhbDogYW55KSA9PiBuZShhdHRyaWJ1dGVSZWYsIHZhbCkpXG5cbiAgICAgICAgICAgIGZpbHRlckZyYWdtZW50cy5wdXNoKG1ha2VQYXJlbnRoZXNlc0dyb3VwKGxpc3RGaWx0ZXJzLCAnQU5EJykpO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoWyAnZXhpc3RzJywgJ25vdEV4aXN0cycsICdpc051bGwnLCAnbm90TnVsbCcsICdlbXB0eScsICdub3RFbXB0eScgXS5pbmNsdWRlcyhmaWx0ZXJLZXkpKSB7XG4gICAgICAgICAgICAvLyBQcmltYXJ5OiBleGlzdHMvbm90RXhpc3RzXG4gICAgICAgICAgICAvLyBBbGlhc2VzOiBpc051bGwvZW1wdHkg4oaSIG5vdEV4aXN0cywgbm90TnVsbC9ub3RFbXB0eSDihpIgZXhpc3RzXG4gICAgICAgICAgICBjb25zdCBpc0V4aXN0c09wID0gWyAnZXhpc3RzJywgJ25vdE51bGwnLCAnbm90RW1wdHknIF0uaW5jbHVkZXMoZmlsdGVyS2V5KTtcbiAgICAgICAgICAgIGNvbnN0IHdhbnRFeGlzdHMgPSBpc0V4aXN0c09wID8gZmlsdGVyVmFsIDogIWZpbHRlclZhbDtcbiAgICAgICAgICAgIGZpbHRlckZyYWdtZW50cy5wdXNoKHdhbnRFeGlzdHMgPyBleGlzdHMoYXR0cmlidXRlUmVmKSA6IG5vdEV4aXN0cyhhdHRyaWJ1dGVSZWYpKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGZpbHRlckV4cHJlc3Npb24gPSBtYWtlUGFyZW50aGVzZXNHcm91cChmaWx0ZXJGcmFnbWVudHMsIGxvZ2ljYWxPcCk7XG5cbiAgICByZXR1cm4gZmlsdGVyRXhwcmVzc2lvbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VQYXJlbnRoZXNlc0dyb3VwKGl0ZW1zOiBBcnJheTxzdHJpbmc+LCBkZWxpbWl0ZXI6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGl0ZW1zLmxlbmd0aCA+IDEgPyAnKCAnICsgaXRlbXMuam9pbihgICR7ZGVsaW1pdGVyLnRvVXBwZXJDYXNlKCl9IGApICsgJyApJyA6IGl0ZW1zWyAwIF07XG59XG5cblxuLyoqXG4gKiBDb252ZXJ0cyBhbiBlbnRpdHkgZmlsdGVyIHRvIGEgZmlsdGVyIGdyb3VwLlxuICogQHBhcmFtIGVudGl0eUZpbHRlciBUaGUgZW50aXR5IGZpbHRlciB0byBjb252ZXJ0LlxuICogQHJldHVybnMgVGhlIGNvbnZlcnRlZCBmaWx0ZXIgZ3JvdXAuXG4gKiBAdGhyb3dzIEVycm9yIGlmIHRoZSBlbnRpdHkgZmlsdGVyIGlzIGludmFsaWQuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBcbiAqIGBgYHRzXG4gKiBpbnRlcmZhY2UgVXNlckVudGl0eVNjaGVtYSB7XG4gKiAgIC8vIHJlc3Qgb2YgdGhlIHNjaGVtYSBzdHVmZi4uLlxuICogICBhdHRyaWJ1dGVzOiB7XG4gKiAgICAgaWQ6IHsgdHlwZTogJ3N0cmluZycgfTtcbiAqICAgICBuYW1lOiB7IHR5cGU6ICdzdHJpbmcnIH07XG4gKiAgICAgYWdlOiB7IHR5cGU6ICdudW1iZXInIH07XG4gKiAgIH07XG4gKiB9XG4gKiBcbiAqIGNvbnN0IHVzZXJGaWx0ZXI6IEVudGl0eUZpbHRlcjxVc2VyRW50aXR5U2NoZW1hPiA9IHtcbiAqICAgICBpZDogeyBlcTogJzEyMycgfSxcbiAqICAgICBuYW1lOiB7IGxpa2U6ICdKb2huJyB9LFxuICogICAgIGFnZTogeyBndGU6IDE4IH0sXG4gKiB9O1xuICogXG4gKiBjb25zdCB1c2VyRmlsdGVyR3JvdXAgPSBlbnRpdHlGaWx0ZXJUb0ZpbHRlckdyb3VwKHVzZXJGaWx0ZXIpO1xuICogZXhwZWN0KHVzZXJGaWx0ZXJHcm91cCkudG8uZGVlcC5lcXVhbCh7XG4gKiAgICAgYW5kOiBbXG4gKiAgICAgICAgIHsgYXR0cmlidXRlOiAnaWQnLCBlcTogJzEyMycgfSxcbiAqICAgICAgICAgeyBhdHRyaWJ1dGU6ICduYW1lJywgbGlrZTogJ0pvaG4nIH0sXG4gKiAgICAgICAgIHsgYXR0cmlidXRlOiAnYWdlJywgZ3RlOiAxOCB9LFxuICogICAgIF0sXG4gKiB9KTtcbiAqIGBgYFxuICogKiAnYW5kJyBiZWNvbWVzIHRoZSBkZWZhdWx0IGxvZ2ljYWwgb3BlcmF0b3IgaWYgbm90IHNwZWNpZmllZCBpbiB0aGUgZmlsdGVyLlxuICogXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbnRpdHlGaWx0ZXJUb0ZpbHRlckdyb3VwPFxuICAgIEEgZXh0ZW5kcyBzdHJpbmcsXG4gICAgRiBleHRlbmRzIHN0cmluZyxcbiAgICBDIGV4dGVuZHMgc3RyaW5nLFxuICAgIFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8QSwgRiwgQz5cbj4oZW50aXR5RmlsdGVyOiBFbnRpdHlGaWx0ZXI8Uz4pOiBFbnRpdHlGaWx0ZXJHcm91cDxTPiB7XG5cbiAgICBpZiAoIWlzRW50aXR5RmlsdGVyKGVudGl0eUZpbHRlcikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBpbnZhbGlkIGVudGl0eSBmaWx0ZXIgJHtlbnRpdHlGaWx0ZXJ9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgZW50aXR5RmlsdGVyR3JvdXA6IEVudGl0eUZpbHRlckdyb3VwPFM+ID0ge307XG4gICAgY29uc3QgeyBmaWx0ZXJJZCwgZmlsdGVyTGFiZWw6IGxhYmVsLCBsb2dpY2FsT3AgPSAnYW5kJywgLi4uZW50aXR5UG9wc0ZpbHRlcnMgfSA9IGVudGl0eUZpbHRlcjtcblxuICAgIGVudGl0eUZpbHRlckdyb3VwLmZpbHRlcklkID0gZmlsdGVySWQ7XG4gICAgZW50aXR5RmlsdGVyR3JvdXAuZmlsdGVyTGFiZWwgPSBsYWJlbDtcblxuICAgIGNvbnN0IGxvZ2ljYWxPcEZpbHRlcnMgPSBPYmplY3RcbiAgICAgICAgLmVudHJpZXM8VHlwZWRGaWx0ZXJDcml0ZXJpYTxhbnk+PihlbnRpdHlQb3BzRmlsdGVycyBhcyB7IFsgczogc3RyaW5nIF06IFR5cGVkRmlsdGVyQ3JpdGVyaWE8YW55PjsgfSlcbiAgICAgICAgLm1hcCgoWyBrZXksIHZhbCBdKTogRW50aXR5QXR0cmlidXRlRmlsdGVyPGFueT4gPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHsgLi4udmFsLCBhdHRyaWJ1dGU6IGtleSB9O1xuICAgICAgICB9KTtcblxuICAgIGVudGl0eUZpbHRlckdyb3VwWyBsb2dpY2FsT3AgXSA9IGxvZ2ljYWxPcEZpbHRlcnMgYXMgYW55O1xuXG4gICAgcmV0dXJuIGVudGl0eUZpbHRlckdyb3VwO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIHRoZSBlbnRpdHkgZmlsdGVyIGNyaXRlcmlhIGludG8gYSBmaWx0ZXIgZXhwcmVzc2lvbi5cbiAqIEBwYXJhbSBlbnRpdHlGaWx0ZXIgVGhlIGVudGl0eSBmaWx0ZXIgdG8gY29udmVydC5cbiAqIEBwYXJhbSBhdHRyaWJ1dGVzIFRoZSBhdHRyaWJ1dGVzIGZvciB0aGUgZmlsdGVyIGV4cHJlc3Npb24uXG4gKiBAcGFyYW0gb3BlcmF0aW9ucyBUaGUgb3BlcmF0aW9ucyBmb3IgdGhlIGZpbHRlciBleHByZXNzaW9uLlxuICogQHJldHVybnMgVGhlIGZpbHRlciBleHByZXNzaW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZW50aXR5RmlsdGVyVG9FeHByZXNzaW9uPFxuICAgIEEgZXh0ZW5kcyBzdHJpbmcsXG4gICAgRiBleHRlbmRzIHN0cmluZyxcbiAgICBDIGV4dGVuZHMgc3RyaW5nLFxuICAgIFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8QSwgRiwgQz4sXG4gICAgSSBleHRlbmRzIEl0ZW08QSwgRiwgQywgUywgU1sgXCJhdHRyaWJ1dGVzXCIgXT4sXG4gICAgV0F0dHJpYnV0ZXMgZXh0ZW5kcyBXaGVyZUF0dHJpYnV0ZXM8QSwgRiwgQywgUywgST4sXG4gICAgV09wZXJhdGlvbnMgZXh0ZW5kcyBXaGVyZU9wZXJhdGlvbnM8QSwgRiwgQywgUywgST4sXG4+KFxuICAgIGVudGl0eUZpbHRlcjogRW50aXR5RmlsdGVyPFM+LFxuICAgIGF0dHJpYnV0ZXM6IFdBdHRyaWJ1dGVzLFxuICAgIG9wZXJhdGlvbnM6IFdPcGVyYXRpb25zXG4pIHtcblxuICAgIGNvbnN0IGZpbHRlckdyb3VwID0gZW50aXR5RmlsdGVyVG9GaWx0ZXJHcm91cChlbnRpdHlGaWx0ZXIpO1xuXG4gICAgY29uc3QgZXhwcmVzc2lvbiA9IGZpbHRlckdyb3VwVG9FeHByZXNzaW9uKGZpbHRlckdyb3VwLCBhdHRyaWJ1dGVzLCBvcGVyYXRpb25zKTtcblxuICAgIHJldHVybiBleHByZXNzaW9uO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIHRoZSBnaXZlbiBlbnRpdHkgZmlsdGVyIGNyaXRlcmlhIHRvIGFuIGV4cHJlc3Npb24uXG4gKiBcbiAqIEBwYXJhbSBmaWx0ZXJDcml0ZXJpYSAtIFRoZSBlbnRpdHkgZmlsdGVyIGNyaXRlcmlhIHRvIGNvbnZlcnQuXG4gKiBAcGFyYW0gYXR0cmlidXRlcyAtIFRoZSBhdHRyaWJ1dGVzIGZvciB0aGUgZmlsdGVyIGNyaXRlcmlhLlxuICogQHBhcmFtIG9wZXJhdGlvbnMgLSBUaGUgb3BlcmF0aW9ucyBmb3IgdGhlIGZpbHRlciBjcml0ZXJpYS5cbiAqIEByZXR1cm5zIFRoZSBleHByZXNzaW9uIHJlcHJlc2VudGluZyB0aGUgY29udmVydGVkIGZpbHRlciBjcml0ZXJpYS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVudGl0eUZpbHRlckNyaXRlcmlhVG9FeHByZXNzaW9uPFxuICAgIEEgZXh0ZW5kcyBzdHJpbmcsXG4gICAgRiBleHRlbmRzIHN0cmluZyxcbiAgICBDIGV4dGVuZHMgc3RyaW5nLFxuICAgIFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8QSwgRiwgQz4sXG4gICAgSSBleHRlbmRzIEl0ZW08QSwgRiwgQywgUywgU1sgXCJhdHRyaWJ1dGVzXCIgXT4sXG4gICAgV0F0dHJpYnV0ZXMgZXh0ZW5kcyBXaGVyZUF0dHJpYnV0ZXM8QSwgRiwgQywgUywgST4sXG4gICAgV09wZXJhdGlvbnMgZXh0ZW5kcyBXaGVyZU9wZXJhdGlvbnM8QSwgRiwgQywgUywgST4sXG4+KFxuICAgIGZpbHRlckNyaXRlcmlhOiBFbnRpdHlGaWx0ZXJDcml0ZXJpYTxTPixcbiAgICBhdHRyaWJ1dGVzOiBXQXR0cmlidXRlcyxcbiAgICBvcGVyYXRpb25zOiBXT3BlcmF0aW9uc1xuKSB7XG5cbiAgICBsZXQgZXhwcmVzc2lvbiA9IGZpbHRlckNyaXRlcmlhT3JGaWx0ZXJHcm91cE9yQXR0cmlidXRlRmlsdGVyVG9FeHByZXNzaW9uKHtcbiAgICAgICAgZmlsdGVyQ3JpdGVyaWEsXG4gICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgIG9wZXJhdGlvbnNcbiAgICB9KTtcblxuICAgIHJldHVybiBleHByZXNzaW9uO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGEgZmlsdGVyIGNyaXRlcmlhLCBmaWx0ZXIgZ3JvdXAsIG9yIGF0dHJpYnV0ZSBmaWx0ZXIgdG8gYW4gZXhwcmVzc2lvbi5cbiAqIEBwYXJhbSBvcHRpb25zIC0gVGhlIG9wdGlvbnMgb2JqZWN0IGNvbnRhaW5pbmcgdGhlIGZpbHRlciBjcml0ZXJpYSwgYXR0cmlidXRlcywgYW5kIG9wZXJhdGlvbnMuXG4gKiBAcmV0dXJucyBUaGUgZXhwcmVzc2lvbiByZXByZXNlbnRpbmcgdGhlIGNvbnZlcnRlZCBmaWx0ZXIgY3JpdGVyaWEuXG4gKiBAdGhyb3dzIEFuIGVycm9yIGlmIHRoZSBmaWx0ZXIgY3JpdGVyaWEgaXMgbm90IGEgdmFsaWQgRW50aXR5RmlsdGVyR3JvdXAsIEVudGl0eUZpbHRlckNyaXRlcmlhLCBvciBFbnRpdHlBdHRyaWJ1dGVGaWx0ZXJDcml0ZXJpYS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbHRlckNyaXRlcmlhT3JGaWx0ZXJHcm91cE9yQXR0cmlidXRlRmlsdGVyVG9FeHByZXNzaW9uPFxuICAgIEEgZXh0ZW5kcyBzdHJpbmcsXG4gICAgRiBleHRlbmRzIHN0cmluZyxcbiAgICBDIGV4dGVuZHMgc3RyaW5nLFxuICAgIFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8QSwgRiwgQz4sXG4gICAgSSBleHRlbmRzIEl0ZW08QSwgRiwgQywgUywgU1sgXCJhdHRyaWJ1dGVzXCIgXT4sXG4gICAgV0F0dHJpYnV0ZXMgZXh0ZW5kcyBXaGVyZUF0dHJpYnV0ZXM8QSwgRiwgQywgUywgST4sXG4gICAgV09wZXJhdGlvbnMgZXh0ZW5kcyBXaGVyZU9wZXJhdGlvbnM8QSwgRiwgQywgUywgST4sXG4+KFxuICAgIG9wdGlvbnM6IHtcbiAgICAgICAgZmlsdGVyQ3JpdGVyaWE6IEVudGl0eUZpbHRlckNyaXRlcmlhPFM+LFxuICAgICAgICBhdHRyaWJ1dGVzOiBXQXR0cmlidXRlcyxcbiAgICAgICAgb3BlcmF0aW9uczogV09wZXJhdGlvbnNcbiAgICB9XG4pIHtcbiAgICBjb25zdCB7IGZpbHRlckNyaXRlcmlhLCBhdHRyaWJ1dGVzLCBvcGVyYXRpb25zIH0gPSBvcHRpb25zO1xuXG4gICAgaWYgKGlzRW50aXR5RmlsdGVyKGZpbHRlckNyaXRlcmlhKSkge1xuICAgICAgICByZXR1cm4gZW50aXR5RmlsdGVyVG9FeHByZXNzaW9uKGZpbHRlckNyaXRlcmlhLCBhdHRyaWJ1dGVzLCBvcGVyYXRpb25zKTtcbiAgICB9IGVsc2UgaWYgKGlzRW50aXR5RmlsdGVyR3JvdXAoZmlsdGVyQ3JpdGVyaWEpKSB7XG4gICAgICAgIHJldHVybiBmaWx0ZXJHcm91cFRvRXhwcmVzc2lvbihmaWx0ZXJDcml0ZXJpYSwgYXR0cmlidXRlcywgb3BlcmF0aW9ucyk7XG4gICAgfSBlbHNlIGlmIChpc0F0dHJpYnV0ZUZpbHRlcihmaWx0ZXJDcml0ZXJpYSkpIHtcbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZUZpbHRlclRvRXhwcmVzc2lvbihmaWx0ZXJDcml0ZXJpYSwgYXR0cmlidXRlcywgb3BlcmF0aW9ucyk7XG4gICAgfVxuXG4gICAgY29uc3QgbXNnID0gYGVudGl0eUZpbHRlcnMgaXMgbm90IGEgRW50aXR5RmlsdGVyR3JvdXAgb3IgRW50aXR5RmlsdGVyQ3JpdGVyaWEgb3IgRW50aXR5QXR0cmlidXRlRmlsdGVyQ3JpdGVyaWFgO1xuXG4gICAgbG9nZ2VyLmVycm9yKGBmaWx0ZXJDcml0ZXJpYU9yRmlsdGVyR3JvdXBUb0V4cHJlc3Npb246ICR7bXNnfWAsIHsgZmlsdGVyQ3JpdGVyaWEgfSk7XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bXNnfWApO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIGEgZmlsdGVyIGdyb3VwIG9iamVjdCBpbnRvIGEgZmlsdGVyIGV4cHJlc3Npb24gc3RyaW5nLlxuICogQHBhcmFtIGZpbHRlckdyb3VwIC0gVGhlIGZpbHRlciBncm91cCBvYmplY3QgdG8gY29udmVydC5cbiAqIEBwYXJhbSBhdHRyaWJ1dGVzIC0gVGhlIGF0dHJpYnV0ZXMgb2JqZWN0LlxuICogQHBhcmFtIG9wZXJhdGlvbnMgLSBUaGUgb3BlcmF0aW9ucyBvYmplY3QuXG4gKiBAcmV0dXJucyBUaGUgZmlsdGVyIGV4cHJlc3Npb24gc3RyaW5nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsdGVyR3JvdXBUb0V4cHJlc3Npb248XG4gICAgQSBleHRlbmRzIHN0cmluZyxcbiAgICBGIGV4dGVuZHMgc3RyaW5nLFxuICAgIEMgZXh0ZW5kcyBzdHJpbmcsXG4gICAgUyBleHRlbmRzIEVudGl0eVNjaGVtYTxBLCBGLCBDPixcbiAgICBJIGV4dGVuZHMgSXRlbTxBLCBGLCBDLCBTLCBTWyBcImF0dHJpYnV0ZXNcIiBdPixcbiAgICBXQXR0cmlidXRlcyBleHRlbmRzIFdoZXJlQXR0cmlidXRlczxBLCBGLCBDLCBTLCBJPixcbiAgICBXT3BlcmF0aW9ucyBleHRlbmRzIFdoZXJlT3BlcmF0aW9uczxBLCBGLCBDLCBTLCBJPixcbj4oZmlsdGVyR3JvdXA6IEVudGl0eUZpbHRlckdyb3VwPGFueT4sIGF0dHJpYnV0ZXM6IFdBdHRyaWJ1dGVzLCBvcGVyYXRpb25zOiBXT3BlcmF0aW9ucykge1xuXG4gICAgY29uc3QgeyBmaWx0ZXJJZDogaWQsIGZpbHRlckxhYmVsOiBsYWJlbCwgYW5kID0gW10sIG9yID0gW10sIG5vdCA9IFtdIH0gPSBmaWx0ZXJHcm91cDtcblxuICAgIGNvbnN0IGZpbHRlckdyb3VwRnJhZ21lbnRzOiBBcnJheTxzdHJpbmc+ID0gW107XG5cbiAgICBjb25zdCBhbmRGcmFnbWVudHM6IEFycmF5PHN0cmluZz4gPSBbXTtcblxuICAgIGZvciAoY29uc3QgdGhpc0ZpbHRlciBvZiBhbmQpIHtcbiAgICAgICAgY29uc3QgdGhpc0V4cHJlc3Npb24gPSBmaWx0ZXJDcml0ZXJpYU9yRmlsdGVyR3JvdXBPckF0dHJpYnV0ZUZpbHRlclRvRXhwcmVzc2lvbih7XG4gICAgICAgICAgICBmaWx0ZXJDcml0ZXJpYTogdGhpc0ZpbHRlcixcbiAgICAgICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgICAgICBvcGVyYXRpb25zXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAodGhpc0V4cHJlc3Npb24ubGVuZ3RoKSB7XG4gICAgICAgICAgICBhbmRGcmFnbWVudHMucHVzaCh0aGlzRXhwcmVzc2lvbik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYW5kRnJhZ21lbnRzLmxlbmd0aCkge1xuICAgICAgICBjb25zdCBhbmRFeHByZXNzaW9ucyA9IG1ha2VQYXJlbnRoZXNlc0dyb3VwKGFuZEZyYWdtZW50cywgJ2FuZCcpO1xuICAgICAgICBmaWx0ZXJHcm91cEZyYWdtZW50cy5wdXNoKGFuZEV4cHJlc3Npb25zKTtcbiAgICB9XG5cbiAgICBjb25zdCBvckZyYWdtZW50czogQXJyYXk8c3RyaW5nPiA9IFtdO1xuICAgIGZvciAoY29uc3QgdGhpc0ZpbHRlciBvZiBvcikge1xuICAgICAgICBjb25zdCB0aGlzRXhwcmVzc2lvbiA9IGZpbHRlckNyaXRlcmlhT3JGaWx0ZXJHcm91cE9yQXR0cmlidXRlRmlsdGVyVG9FeHByZXNzaW9uKHtcbiAgICAgICAgICAgIGZpbHRlckNyaXRlcmlhOiB0aGlzRmlsdGVyLFxuICAgICAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgICAgIG9wZXJhdGlvbnNcbiAgICAgICAgfSk7XG4gICAgICAgIGlmICh0aGlzRXhwcmVzc2lvbi5sZW5ndGgpIHtcbiAgICAgICAgICAgIG9yRnJhZ21lbnRzLnB1c2godGhpc0V4cHJlc3Npb24pO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChvckZyYWdtZW50cy5sZW5ndGgpIHtcbiAgICAgICAgY29uc3Qgb3JFeHByZXNzaW9ucyA9IG1ha2VQYXJlbnRoZXNlc0dyb3VwKG9yRnJhZ21lbnRzLCAnb3InKTtcbiAgICAgICAgZmlsdGVyR3JvdXBGcmFnbWVudHMucHVzaChvckV4cHJlc3Npb25zKTtcbiAgICB9XG5cbiAgICBjb25zdCBub3RGcmFnbWVudHM6IEFycmF5PHN0cmluZz4gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHRoaXNGaWx0ZXIgb2Ygbm90KSB7XG4gICAgICAgIGNvbnN0IHRoaXNFeHByZXNzaW9uID0gZmlsdGVyQ3JpdGVyaWFPckZpbHRlckdyb3VwT3JBdHRyaWJ1dGVGaWx0ZXJUb0V4cHJlc3Npb24oe1xuICAgICAgICAgICAgZmlsdGVyQ3JpdGVyaWE6IHRoaXNGaWx0ZXIsXG4gICAgICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICAgICAgb3BlcmF0aW9uc1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKHRoaXNFeHByZXNzaW9uLmxlbmd0aCkge1xuICAgICAgICAgICAgbm90RnJhZ21lbnRzLnB1c2godGhpc0V4cHJlc3Npb24pO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChub3RGcmFnbWVudHMubGVuZ3RoKSB7XG4gICAgICAgIGNvbnN0IG5vdEV4cHJlc3Npb25zID0gbWFrZVBhcmVudGhlc2VzR3JvdXAobm90RnJhZ21lbnRzLCAnQU5EIE5PVCcpO1xuICAgICAgICBmaWx0ZXJHcm91cEZyYWdtZW50cy5wdXNoKG5vdEV4cHJlc3Npb25zKTtcbiAgICB9XG5cbiAgICBjb25zdCBmaWx0ZXJFeHByZXNzaW9uID0gbWFrZVBhcmVudGhlc2VzR3JvdXAoZmlsdGVyR3JvdXBGcmFnbWVudHMsICdBTkQnKTtcblxuICAgIHJldHVybiBmaWx0ZXJFeHByZXNzaW9uO1xufVxuXG5cbi8qKlxuICogUGFyc2VzIHRoZSBxdWVyeSBzdHJpbmcgcGFyYW1ldGVycyBmcm9tIGFuIG9iamVjdCBpbnRvIGEgc3RydWN0dXJlZCBmb3JtYXQuXG4gKiBAcGFyYW0gcXVlcnlTdHJpbmdQYXJhbWV0ZXJzIC0gVGhlIHF1ZXJ5IHN0cmluZyBwYXJhbWV0ZXJzIGFzIGFuIG9iamVjdC5cbiAqIEByZXR1cm5zIFRoZSBwYXJzZWQgcXVlcnkgc3RyaW5nIHBhcmFtZXRlcnMuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogIGNvbnN0IHF1ZXJ5U3RyaW5nUGFyYW1ldGVycyA9IHtcbiAqICAgICAgJ3VzZXIubmFtZSc6ICdKb2huJyxcbiAqICAgICAgJ3VzZXIuYWdlJzogJzMwJyxcbiAqICAgICAgJ3VzZXIuaG9iYmllcyc6ICdyZWFkaW5nLHdyaXRpbmcnLFxuICogICAgICAndXNlci5hZGRyZXNzLmNpdHknOiAnTmV3IFlvcmsnLFxuICogICAgICAndXNlci5hZGRyZXNzLmNvdW50cnknOiAnVVNBJyxcbiAqICB9O1xuICogIFxuICogIGNvbnN0IHBhcnNlZCA9IHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzKHF1ZXJ5U3RyaW5nUGFyYW1ldGVycyk7XG4gKiAgXG4gKiAgZXhwZWN0KHBhcnNlZCkudG8uZGVlcC5lcXVhbCh7XG4gKiAgICAgIHVzZXI6IHtcbiAqICAgICAgICAgIG5hbWU6ICdKb2huJyxcbiAqICAgICAgICAgIGFnZTogJzMwJyxcbiAqICAgICAgICAgIGhvYmJpZXM6IFsncmVhZGluZycsICd3cml0aW5nJ10sXG4gKiAgICAgICAgICBhZGRyZXNzOiB7XG4gKiAgICAgICAgICAgICAgY2l0eTogJ05ldyBZb3JrJyxcbiAqICAgICAgICAgICAgICBjb3VudHJ5OiAnVVNBJyxcbiAqICAgICAgICAgIH0sXG4gKiAgICAgIH0sXG4gKiAgfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzKHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBbIG5hbWU6IHN0cmluZyBdOiBzdHJpbmcgfCB1bmRlZmluZWQgfSkge1xuXG4gICAgY29uc3QgcXVlcnlTdHJpbmcgPSBzdHJpbmdpZnlRdWVyeVBhcmFtcyhxdWVyeVN0cmluZ1BhcmFtZXRlcnMpO1xuXG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VRdWVyeVN0cmluZyhxdWVyeVN0cmluZywge1xuICAgICAgICBkZWxpbWl0ZXI6IC9bOywmOitdLyxcbiAgICAgICAgYWxsb3dEb3RzOiB0cnVlLFxuICAgICAgICBkZWNvZGVEb3RJbktleXM6IHRydWUsXG4gICAgICAgIHBhcnNlQXJyYXlzOiB0cnVlLFxuICAgICAgICBkdXBsaWNhdGVzOiAnY29tYmluZScsXG4gICAgICAgIGFsbG93RW1wdHlBcnJheXM6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHBhcnNlZDtcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIHF1ZXJ5IHN0cmluZyBwYXJhbWV0ZXIgaW50byBhIGZpbHRlciBvYmplY3QuXG4gKiBAcGFyYW0gcGFyYW1OYW1lIC0gVGhlIG5hbWUgb2YgdGhlIHF1ZXJ5IHN0cmluZyBwYXJhbWV0ZXIuXG4gKiBAcGFyYW0gcGFyYW1WYWx1ZSAtIFRoZSB2YWx1ZSBvZiB0aGUgcXVlcnkgc3RyaW5nIHBhcmFtZXRlci5cbiAqIEByZXR1cm5zIFRoZSBmb3JtYXR0ZWQgZmlsdGVyIG9iamVjdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VGaWx0ZXJGcm9tUXVlcnlTdHJpbmdQYXJhbShwYXJhbU5hbWU6IHN0cmluZywgcGFyYW1WYWx1ZTogYW55KSB7XG5cbiAgICAvKipcbiAgICAgKiAgeyBwYXJhbU5hbWU6IG9yLCAgcGFyYW1WYWx1ZTogW3sgZm9vOiB7IGVxOiAnMScgfX0sIHsgZm9vOiB7IG5lcTogJzMnIH0gfV0gfVxuICAgICAqL1xuICAgIGlmIChbICdhbmQnLCAnb3InLCAnbm90JyBdLmluY2x1ZGVzKHBhcmFtTmFtZSkpIHtcblxuICAgICAgICBsZXQgZm9ybWF0dGVkR3JvdXBWYWw6IEFycmF5PGFueT4gPSBbXTtcblxuICAgICAgICBwYXJhbVZhbHVlLmZvckVhY2goKGl0ZW06IGFueSkgPT4ge1xuICAgICAgICAgICAgT2JqZWN0LmtleXMoaXRlbSkuZm9yRWFjaCgoaXRlbUtleTogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgaXRlbVZhbHVlID0gaXRlbVsgaXRlbUtleSBdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGZvcm1hdHRlZEl0ZW1zID0gbWFrZUZpbHRlckZyb21RdWVyeVN0cmluZ1BhcmFtKGl0ZW1LZXksIGl0ZW1WYWx1ZSk7XG4gICAgICAgICAgICAgICAgZm9ybWF0dGVkR3JvdXBWYWwgPSBmb3JtYXR0ZWRHcm91cFZhbC5jb25jYXQoZm9ybWF0dGVkSXRlbXMpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBmb3JtYXR0ZWRHcm91cFZhbDtcbiAgICB9XG5cbiAgICBsZXQgZm9ybWF0dGVkVmFsdWVzOiBhbnkgPSB7fTtcblxuICAgIGlmICghaXNPYmplY3QocGFyYW1WYWx1ZSkpIHtcbiAgICAgICAgcGFyYW1WYWx1ZSA9IHsgJ2VxJzogcGFyYW1WYWx1ZSB9O1xuICAgIH1cblxuICAgIC8qXG4gICAgICAgIGZvbzoge1xuICAgICAgICAgICAgZXE6ICcxJyxcbiAgICAgICAgICAgIG5lcTogJzMnLFxuICAgICAgICAgICAgaW46IFsyMzIsa2wsa2xrXSxcbiAgICAgICAgICAgIG5pbjogcXdxLDMzNCxqaGosXG4gICAgICAgICAgICBjb250YWluczogaGoraGpqK3l1eTdcbiAgICAgICAgfVxuICAgICovXG4gICAgT2JqZWN0LmtleXMocGFyYW1WYWx1ZSkuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICAgIGNvbnN0IGtleVZhbCA9IHBhcmFtVmFsdWVbIGtleSBdO1xuICAgICAgICBsZXQgZm9ybWF0dGVkVmFsID0ga2V5VmFsO1xuXG4gICAgICAgIC8vIHBhcnNlIHRoZSB2YWx1ZXMgdG8gdGhlIHJpZ2h0IHR5cGVzIGhlcmVcbiAgICAgICAgaWYgKEZJTFRFUl9LRVlTX0hBVklOR19BUlJBWV9WQUxVRVMuaW5jbHVkZXMoa2V5KSAmJiB0eXBlb2Yga2V5VmFsID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgZm9ybWF0dGVkVmFsID0ga2V5VmFsLnNwbGl0KFBBUlNFX1ZBTFVFX0RFTElNSVRFUlMpO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9ybWF0dGVkVmFsID0gcGFyc2VWYWx1ZVRvQ29ycmVjdFR5cGVzKGZvcm1hdHRlZFZhbCk7XG5cbiAgICAgICAgZm9ybWF0dGVkVmFsdWVzWyBrZXkgXSA9IGZvcm1hdHRlZFZhbDtcbiAgICB9KTtcblxuICAgIGNvbnN0IGZvcm1hdHRlZEl0ZW1WYWwgPSB7XG4gICAgICAgIGF0dHJpYnV0ZTogcGFyYW1OYW1lLFxuICAgICAgICAuLi5mb3JtYXR0ZWRWYWx1ZXNcbiAgICB9XG5cbiAgICByZXR1cm4gZm9ybWF0dGVkSXRlbVZhbDtcbn1cblxuXG4vKipcbiAqIENvbnZlcnRzIHF1ZXJ5IHN0cmluZyBwYXJhbWV0ZXJzIHRvIGEgZmlsdGVyIGdyb3VwLlxuICogQHBhcmFtIHF1ZXJ5U3RyaW5nUGFyYW1zIC0gVGhlIHF1ZXJ5IHN0cmluZyBwYXJhbWV0ZXJzLlxuICogQHJldHVybnMgVGhlIGZvcm1hdHRlZCBmaWx0ZXIgZ3JvdXAuXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqICBjb25zdCBxdWVyeVN0cmluZ1BhcmFtcyA9IHtcbiAqICAgICAgJ2FuZCc6IFtcbiAqICAgICAgICAgIHsgJ3VzZXIuYWdlJzogeyAnZ3QnOiAnMzAnIH0gfSxcbiAqICAgICAgICAgIHsgJ3VzZXIuaG9iYmllcyc6IHsgJ2luJzogJ3JlYWRpbmcsd3JpdGluZycgfSB9LFxuICogICAgICBdLFxuICogICAgICAnb3InOiBbXG4gKiAgICAgICAgICB7ICd1c2VyLm5hbWUnOiB7ICdlcSc6ICdKb2huJyB9IH0sXG4gKiAgICAgICAgICB7ICd1c2VyLmFkZHJlc3MuY2l0eSc6IHsgJ2VxJzogJ05ldyBZb3JrJyB9IH0sXG4gKiAgICAgIF0sXG4gKiAgfTtcbiAqICBcbiAqICBjb25zdCBmaWx0ZXJHcm91cCA9IHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cChxdWVyeVN0cmluZ1BhcmFtcyk7XG4gKiAgXG4gKiAgZXhwZWN0KGZpbHRlckdyb3VwKS50by5kZWVwLmVxdWFsKHtcbiAqICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICogICAgICBhbmQ6IFtcbiAqICAgICAgICAgIHtcbiAqICAgICAgICAgICAgICBhdHRyaWJ1dGU6ICd1c2VyLmFnZScsXG4gKiAgICAgICAgICAgICAgZ3Q6IDMwLFxuICogICAgICAgICAgfSxcbiAqICAgICAgICAgIHtcbiAqICAgICAgICAgICAgICBhdHRyaWJ1dGU6ICd1c2VyLmhvYmJpZXMnLFxuICogICAgICAgICAgICAgIGluOiBbJ3JlYWRpbmcnLCAnd3JpdGluZyddLFxuICogICAgICAgICAgfSxcbiAqICAgICAgXSxcbiAqICAgICAgbm90OiBbXSxcbiAqICAgICAgb3I6IFtcbiAqICAgICAgICAgIHtcbiAqICAgICAgICAgICAgIGF0dHJpYnV0ZTogJ3VzZXIubmFtZScsXG4gKiAgICAgICAgICAgIGVxOiAnSm9obicsXG4gKiAgICAgICAgICB9LFxuICogICAgICAgICAge1xuICogICAgICAgICAgICAgIGF0dHJpYnV0ZTogJ3VzZXIuYWRkcmVzcy5jaXR5JyxcbiAqICAgICAgICAgICBlcTogJ05ldyBZb3JrJyxcbiAqICAgICAgICAgIH0sXG4gKiAgICAgIF0sXG4gKiAgfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cChxdWVyeVN0cmluZ1BhcmFtczogeyBbIG5hbWU6IHN0cmluZyBdOiBhbnkgfSkge1xuXG4gICAgY29uc3QgZm9ybWF0dGVkOiBFbnRpdHlGaWx0ZXJHcm91cDxhbnk+ID0ge1xuICAgICAgICBmaWx0ZXJJZDogJ3F1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCcsXG4gICAgICAgIGFuZDogW10sXG4gICAgICAgIG5vdDogW10sXG4gICAgICAgIG9yOiBbXSxcbiAgICB9O1xuXG4gICAgZm9yIChsZXQgcVBhcmFtTmFtZSBpbiBxdWVyeVN0cmluZ1BhcmFtcykge1xuXG4gICAgICAgIGxldCBncm91cE5hbWU6IGtleW9mIHR5cGVvZiBmb3JtYXR0ZWQgPSAnYW5kJztcblxuICAgICAgICAvLyB0aGVuIHRyZWF0IGl0IGFzIGEgZmlsdGVyIGl0ZW1cbiAgICAgICAgaWYgKE9iamVjdC5rZXlzKGZvcm1hdHRlZCkuaW5jbHVkZXMocVBhcmFtTmFtZSkpIHtcbiAgICAgICAgICAgIGdyb3VwTmFtZSA9IHFQYXJhbU5hbWUgYXMga2V5b2YgdHlwZW9mIGZvcm1hdHRlZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBxUGFyYW1WYWx1ZSA9IHF1ZXJ5U3RyaW5nUGFyYW1zWyBxUGFyYW1OYW1lIF07XG5cbiAgICAgICAgY29uc3QgZm9ybWF0dGVkUVBWYWwgPSBtYWtlRmlsdGVyRnJvbVF1ZXJ5U3RyaW5nUGFyYW0ocVBhcmFtTmFtZSwgcVBhcmFtVmFsdWUpO1xuXG4gICAgICAgIGZvcm1hdHRlZFsgZ3JvdXBOYW1lIF0gPSBmb3JtYXR0ZWRbIGdyb3VwTmFtZSBdIS5jb25jYXQoZm9ybWF0dGVkUVBWYWwpIGFzIGFueTtcbiAgICB9XG5cblxuICAgIHJldHVybiBmb3JtYXR0ZWQ7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIGZpbHRlciBncm91cCBmb3Igc2VhcmNoaW5nIGtleXdvcmRzIGluIHRoZSBzcGVjaWZpZWQgYXR0cmlidXRlcy5cbiAqIEBwYXJhbSBrZXl3b3JkcyAtIEFuIGFycmF5IG9mIGtleXdvcmRzIHRvIHNlYXJjaCBmb3IuXG4gKiBAcGFyYW0gYXR0cmlidXRlTmFtZXMgLSBBbiBhcnJheSBvZiBhdHRyaWJ1dGUgbmFtZXMgdG8gc2VhcmNoIHdpdGhpbi4gRGVmYXVsdHMgdG8gYW4gZW1wdHkgYXJyYXkuXG4gKiBAcmV0dXJucyBBIGZpbHRlciBncm91cCBvYmplY3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWtlRmlsdGVyR3JvdXBGb3JTZWFyY2hLZXl3b3JkczxFIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihcbiAgICBrZXl3b3JkczogQXJyYXk8c3RyaW5nPixcbiAgICBhdHRyaWJ1dGVOYW1lczogQXJyYXk8c3RyaW5nPiA9IFtdXG4pOiBFbnRpdHlGaWx0ZXJHcm91cDxFPiB7XG5cbiAgICBjb25zdCBmaWx0ZXJHcm91cDogRW50aXR5RmlsdGVyR3JvdXA8RT4gPSB7XG4gICAgICAgIGZpbHRlcklkOiAna2V5d29yZFNlYXJjaEZpbHRlckdyb3VwJyxcbiAgICAgICAgb3I6IFtdLFxuICAgIH07XG5cbiAgICBhdHRyaWJ1dGVOYW1lcy5mb3JFYWNoKChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICAgIGZpbHRlckdyb3VwIS5vciEucHVzaCh7XG4gICAgICAgICAgICBhdHRyaWJ1dGU6IGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgICBjb250YWluczoga2V5d29yZHMsXG4gICAgICAgIH0gYXMgYW55KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBmaWx0ZXJHcm91cDtcbn1cblxuLyoqXG4gKiBBZGRzIGEgZmlsdGVyIGdyb3VwIHRvIHRoZSBlbnRpdHkgZmlsdGVyIGNyaXRlcmlhLlxuICogXG4gKiBAdGVtcGxhdGUgRSAtIFRoZSBlbnRpdHkgc2NoZW1hIHR5cGUuXG4gKiBAcGFyYW0ge0VudGl0eUZpbHRlckdyb3VwPEU+fSBmaWx0ZXJHcm91cCAtIFRoZSBmaWx0ZXIgZ3JvdXAgdG8gYWRkLlxuICogQHBhcmFtIHtFbnRpdHlGaWx0ZXJDcml0ZXJpYTxFPn0gW2VudGl0eUZpbHRlckNyaXRlcmlhXSAtIFRoZSBleGlzdGluZyBlbnRpdHkgZmlsdGVyIGNyaXRlcmlhLlxuICogQHJldHVybnMge0VudGl0eUZpbHRlckNyaXRlcmlhPEU+fSAtIFRoZSB1cGRhdGVkIGVudGl0eSBmaWx0ZXIgY3JpdGVyaWEuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZGRGaWx0ZXJHcm91cFRvRW50aXR5RmlsdGVyQ3JpdGVyaWE8RSBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4oXG4gICAgZmlsdGVyR3JvdXA6IEVudGl0eUZpbHRlckdyb3VwPEU+LFxuICAgIGVudGl0eUZpbHRlckNyaXRlcmlhPzogRW50aXR5RmlsdGVyQ3JpdGVyaWE8RT4sXG4pOiBFbnRpdHlGaWx0ZXJDcml0ZXJpYTxFPiB7XG5cbiAgICBjb25zdCBuZXdGaWx0ZXJDcml0ZXJpYTogRW50aXR5RmlsdGVyR3JvdXA8RT4gPSBpc0VudGl0eUZpbHRlckdyb3VwPEU+KGVudGl0eUZpbHRlckNyaXRlcmlhKVxuICAgICAgICA/IHsgLi4uZW50aXR5RmlsdGVyQ3JpdGVyaWEgfVxuICAgICAgICA6IHsgZmlsdGVySWQ6ICdfYWRkRmlsdGVyR3JvdXBUb0VudGl0eUZpbHRlckNyaXRlcmlhJyB9O1xuXG4gICAgLy8gbWFrZSBzdXJlIGl0IGhhcyBhbiBgYW5kYCBncm91cFxuICAgIG5ld0ZpbHRlckNyaXRlcmlhLmFuZCA9IG5ld0ZpbHRlckNyaXRlcmlhLmFuZCB8fCBbXTtcblxuICAgIC8qKiBcbiAgICAgKiBTcHJlYWQgb3V0IHRoZSBmaWx0ZXJzIHRvIG1ha2Ugc3VyZSB3ZSBoYXZlIGEgY29weSBvZiB0aGUgb3JpZ2luYWwgZmlsdGVyIGNyaXRlcmlhLlxuICAgICAqIE5vdGU6IEEgZGVlcCBjb3B5IG1heSBtYWtlIG1vcmUgc2Vuc2UuXG4gICAgICovXG5cbiAgICBpZiAoaXNBdHRyaWJ1dGVGaWx0ZXIoZW50aXR5RmlsdGVyQ3JpdGVyaWEpIHx8IGlzRW50aXR5RmlsdGVyKGVudGl0eUZpbHRlckNyaXRlcmlhKSkge1xuICAgICAgICBuZXdGaWx0ZXJDcml0ZXJpYS5hbmQucHVzaCh7IC4uLmVudGl0eUZpbHRlckNyaXRlcmlhIH0pO1xuICAgIH1cblxuICAgIG5ld0ZpbHRlckNyaXRlcmlhLmFuZC5wdXNoKHsgLi4uZmlsdGVyR3JvdXAgfSBhcyBhbnkpO1xuXG4gICAgcmV0dXJuIG5ld0ZpbHRlckNyaXRlcmlhIGFzIEVudGl0eUZpbHRlckNyaXRlcmlhPEU+O1xufSJdfQ==