import { ExclusiveUnion, Narrow, ValueOf, isArray, isArrayOfType, isBoolean, isEmpty, isEmptyObject, isObject, isString } from "../utils";
import { EntitySchema } from "./base-entity";


export type Pagination = {
    limit?: number;
    count?: number;
    pages?: number | 'all';
    pager?: 'raw' | 'cursor',
    order?: 'asc' | 'desc';
    cursor ?: string,
}

export type LogicalOperator = 'and' | 'or' | 'not';

export type StringLiteralToType<T> = T extends 'string' ? string 
    : T extends 'number' ? number 
    : T extends 'boolean' ? boolean
    : T extends 'array' ? Array<any>
    : T extends 'set' ? Array<any>
    : T extends 'list' ? Array<any>
    : T extends 'object' ? any
    : T extends 'map' ? any 
    : any;

/**
 * Represents a complex filter operator value.
 * @template T - The type of the value.
 */
export type ComplexFilterOperatorValue<T> = {
    val: T,
    /**
     * The type of the value.
     * - 'literal': The exact value will be used for comparison.
     * - 'propRef': The comparison is with another property of the same entity, including properties of nested maps (objects) or lists (arrays).
     * - 'expression': The value needs to be evaluated first, for example [`now()`, `$currentUser`, `$requestId`].
     * TODO: Add support for evaluating filter expressions and a dictionary of supported expressions/syntax.
     */
    valType?: 'literal' | 'propRef' | 'expression',
    /**
     * A label to be used by the UI for the filter value. Useful for persisted filter configurations.
     */
    valLabel?: any,
}

/**
 * Represents a value that can be used as an operator in a filter.
 * It can be either a single value of type T or a complex filter operator value.
 */
export type FilterOperatorValue<T> = T |  ComplexFilterOperatorValue<T>;

// TODO: narrow available filters based of the type of the attribute  [string, number, date, boolean, complex etc]
export type FilterOperators<T> = {

    'eq': FilterOperatorValue<T>,
    'neq': FilterOperatorValue<T>,

    'gt': FilterOperatorValue<T>,
    'gte': FilterOperatorValue<T>,

    'lt': FilterOperatorValue<T>,
    'lte': FilterOperatorValue<T>,
    
    'in': FilterOperatorValue<Array<T>>,
    'nin': FilterOperatorValue<Array<T>>,

    'bt': FilterOperatorValue<[ from: T, to: T ]> | FilterOperatorValue<{ from: T, to: T }>,
    
    'isNull': FilterOperatorValue<true>, 
    'isEmpty': FilterOperatorValue<true>, 
    
    'contains': FilterOperatorValue<T | Array<T>>,
    'notContains': FilterOperatorValue<T | Array<T>>,

    'containsSome': FilterOperatorValue<T | Array<T>>,
    
    'like': FilterOperatorValue<T>,
    'endsWith': FilterOperatorValue<T>,
    'startsWith': FilterOperatorValue<T>,
} 

export type FilterOperatorsExtended<T> = FilterOperators<T> & {

    'between': FilterOperators<T>['bt'],
    'bw': FilterOperators<T>['bt'],
    "><": FilterOperators<T>['bt'],

    'equalTo': FilterOperators<T>['eq'],
    'equal': FilterOperators<T>['eq'],
    '===' : FilterOperators<T>['eq'],
    '==' : FilterOperators<T>['eq'],

    'notEqualTo': FilterOperators<T>['neq'],
    'notEqual': FilterOperators<T>['neq'],
    '!==': FilterOperators<T>['neq'],
    '!=': FilterOperators<T>['neq'],
    '<>': FilterOperators<T>['neq'],
    'ne': FilterOperators<T>['neq'],

    'greaterThan': FilterOperators<T>['gt'],
    '>': FilterOperators<T>['gt'],

    'greaterThanOrEqualTo': FilterOperators<T>['gte'],
    '>=': FilterOperators<T>['gte'],
    '>==': FilterOperators<T>['gte'],

    'lessThan': FilterOperators<T>['lt'],
    '<': FilterOperators<T>['lt'],

    'lessThanOrEqualTo': FilterOperators<T>['lte'],
    '<=': FilterOperators<T>['lte'],
    '<==': FilterOperators<T>['lte'],

    'inList': FilterOperators<T>['in'],

    'notInList': FilterOperators<T>['nin'],
    'notIn': FilterOperators<T>['nin'],

    'exists': FilterOperators<T>['isNull'],

    'begins': FilterOperators<T>['startsWith'],
    'beginsWith': FilterOperators<T>['startsWith'],

    'includes': FilterOperators<T>['contains'],
    'includesSome': FilterOperators<T>['containsSome'],

    'has': FilterOperators<T>['contains'],
    'hasSome': FilterOperators<T>['containsSome'],

    'notIncludes': FilterOperators<T>['notContains'],
    'notHas': FilterOperators<T>['notContains'],
}

export const allFilterOperators: Array<keyof FilterOperatorsExtended<any>> = [
    'equalTo',
    'equal',
    'eq',
    '==',
    '===',
     
    'notEqualTo',
    'notEqual',
    'neq', 
    'ne', 
    '!=', 
    '!==', 
    '<>', 
    
    'greaterThan',
    'gt', 
    '>',

    'greaterThanOrEqualTo',
    'gte', 
    '>=',
    '>==',

    'lessThan',
    'lt', 
    '<',

    'lessThanOrEqualTo',
    'lte', 
    '<=',
    '<==',

    'between', 
    'bt', 
    'bw',
    '><', 

    'contains', 
    'includes',
    'has',
    'containsSome',
    'includesSome',
    'hasSome',

    'notContains', 
    'notIncludes',
    'notHas',
    
    'exists', 
    'isNull',

    'isEmpty',
    
    'like', 
    'startsWith',
    'begins',
    'beginsWith',

    'endsWith',

    'inList', 
    'in', 

    'notInList',
    'notIn',
    'nin', 
] as const;

// Filters supported by ElectroDB 
// see https://electrodb.dev/en/queries/filters/
// [eq, ne, gt, gte, lt, lte, between, begins, exists, notExists, contains, notContains, value, name, size, type, field, escape]

// `inList` and `notInList` will be supported by multiple `contains` with OR/AND.
export type FilterOperatorsForDynamo<T> = Exclude<FilterOperatorsExtended<T>, 'endsWith'>;

export const filterOperatorsForDynamo: Array<keyof FilterOperatorsForDynamo<any>>  = allFilterOperators.filter(op => !['endsWith'].includes(op) );

export type IdAndLabel = {
    filterId?: string,
    filterLabel?: string,
};

export type IdAndLabelAndLogicalOp = IdAndLabel & {
    logicalOp?: LogicalOperator,
}

/**
 * Represents the filter criteria for a query.
 * @template T - The type of the filter criteria.
 * 
 * @example
 * { 
 *   eq: 'value',
 *   neq: 'value',
 *   gt: 'value',
 *   gte: 'value',
 * }
 */
export type FilterCriteria<T> = IdAndLabelAndLogicalOp & {
    [op in keyof FilterOperatorsExtended<T>] ?: FilterOperatorsExtended<StringLiteralToType<T>>[op]
}

/**
 * Represents an attribute filter for an entity.
 * @template E - The entity schema type.
 * 
 * @example
 * {
 *  attribute: 'name',
 *  eq: 'value',
 *  neq: 'value',
 *  gt: 'value',
 * }
 */
export type AttributeFilter<E extends EntitySchema<any, any, any>> = 
IdAndLabelAndLogicalOp 
& FilterCriteria<ValueOf<E['attributes']>['type']>
& { 
    attribute: keyof E['attributes'] 
};

/**
 * Represents a filter for an entity.
 * @template E - The entity schema type.
 * 
 * @example
 * ```ts
 *   interface UserEntitySchema {
 *     attributes: {
 *       id: { type: 'string' },
 *       age: { type: 'number' },
 *       name: { type: 'string' },
 *     };
 *   }
 * 
 * 
 *   const filter: EntityFilter<UserEntitySchema> = {
 *     id: { eq: '123' },
 *     name: { like: 'John', notLike: 'Doe', logicalOp: 'OR' }, // `name like 'John' OR name not like 'Doe'`
 *     age: { gte: 18 },
 *   };
 *  
 */
export type EntityFilter<E extends EntitySchema<any, any, any>> = IdAndLabelAndLogicalOp & {
    /**
     * The filter criteria for each attribute of the entity.
     */
    [ key in keyof E['attributes'] ] ?: FilterCriteria<E['attributes'][key]['type']>
};

/**
 * Represents a filter group for querying entities.
 * @template E - The entity schema type.
 * 
 * @example
 *  {
 *    and: [
 *     {
 *        attribute: 'name',
 *        eq: 'value',
 *        neq: 'value',
 *        gt: 'value',
 *    },
 *    {
 *      or: [{    
 *        attribute: 'name',
 *        eq: 'value',
 *        neq: 'value',
 *        gt: 'value',
 *      },
 *      {...}
 *     ]
 *   }
 * ]}
 */
export type FilterGroup<E extends EntitySchema<any, any, any>> = IdAndLabel & {
    [op in LogicalOperator] ?: Array< 
        ExclusiveUnion<
            EntityFilter<E> 
            | AttributeFilter<E> 
            | FilterGroup<E>
        > 
    > 
}

/**
 * Represents the criteria for filtering entities.
 * @template E - The entity schema type.
 */
export type EntityFilterCriteria<E extends EntitySchema<any, any, any>> = ExclusiveUnion< FilterGroup<E> | EntityFilter<E> >;

/**
 * Represents the selection of attributes for an entity.
 * It can be an array of attribute keys or an object with attribute keys as properties.
 * If an attribute key is present in the object, it indicates that the attribute should be included in the selection.
 * If the value of the property is `true`, the attribute will be included.
 * If the value of the property is `false`, the attribute will be excluded.
 * @template E - The entity schema type.
 */
export type EntitySelection<E extends EntitySchema<any, any, any>> = Array<keyof E['attributes']> | {
    [prop in keyof E['attributes']]?: boolean
}

/**
 * Represents a query for retrieving entities of type E.
 * 
 * @example
 * 
 * ```ts
 * interface UserEntitySchema {
 *   attributes: {
 *     name: { type: 'string' };
 *     age: { type: 'number' };
 *   };
 * }
 * 
 * type UserQuery = EntityQuery<UserEntitySchema>;
 * 
 * const query: UserQuery = {
 *   attributes: ['name', 'age'], // selection attributes
 *   filters: {
 *     name: { like: 'John' },
 *     age: { gte: 18 },
 *   },
 *   search: 'John',
 *   searchAttributes: ['name'], // searchable attributes
 *   pagination: {
 *     cursor: 'xxxxxxxx-yyyyyy-zzzzzzz',
 *     count: 10,   // number of records to return in the response
 *     pages: 1,    // default:1; number of the pages to scan for queries when scanning is needed
 *     limit: 1000, // default:none; number of maximum returns to scan for queries when scanning is needed
 *     order: 'asc'
 *   },
 * };
 * ```
 */
export type EntityQuery<E extends EntitySchema<any, any, any>> = {
    /**
     * Specifies the attributes to be selected for each entity.
     */
    attributes?: EntitySelection<E>,
    
    /**
     * Specifies the filter criteria for the query.
     */
    filters?: EntityFilterCriteria<E>,
    
    /**
     * Specifies the search string or an array of search strings.
     * Keywords for search can be delimited by [',', ' ', '+'].
     */
    search?: string | Array<string>,

    /**
     * Specifies the list of attributes to search for.
     */
    searchAttributes?: Array<string>,
    
    /**
     * Specifies the pagination settings for the query.
     */
    pagination?: Pagination,
}

export function isComplexFilterValue<T>(payload: any): payload is ComplexFilterOperatorValue<T> {
    return isObject(payload) && payload.hasOwnProperty('val')
}

export function isFilterCriteria<T>(payload: any): payload is FilterCriteria<T> {
    return isObject(payload) 
    && filterOperatorsForDynamo.some( key => payload.hasOwnProperty(key) )
}

export function isAttributeFilter<E extends EntitySchema<any, any, any>>(payload: any): payload is AttributeFilter<E> {
    return isFilterCriteria(payload) && payload.hasOwnProperty('attribute') 
}

export function isEntityFilter<E extends EntitySchema<any, any, any>>(payload: any): payload is EntityFilter<E> {
    return isObject(payload)
    && !isEmpty(payload)
    && Object.entries(payload)
    // except these things every other key must represent a filter
    .filter(([k]) => !['filterId', 'filterLabel', 'logicalOp'].includes(k)) 
    .every( ([, v]) => isFilterCriteria(v) )
}

export function isFilterGroup<E extends EntitySchema<any, any, any>>(payload: any): payload is FilterGroup<E> {
    return isObject(payload) 
    && !isEmpty(payload)
    && ['and', 'or', 'not'].some( 
        logicalOp => (
            payload.hasOwnProperty(logicalOp) 
            && isArray(payload[logicalOp]) 
            && payload[logicalOp].every( 
                (f: any) => isAttributeFilter(f) || isFilterGroup(f) || isEntityFilter(f) 
            )
        )
    );
}

export type ObjectOfStringKeysAndBooleanValues = {[k:string]: boolean};
export function isArrayOfObjectOfStringKeysAndBooleanValues(payload: any ): payload is Array<ObjectOfStringKeysAndBooleanValues> {
    return isArrayOfType<ObjectOfStringKeysAndBooleanValues>(payload, (item: any): item is ObjectOfStringKeysAndBooleanValues => {
        return isObject(item) && Object.entries(item).every(([key, value]) => isString(key) && isBoolean(value));
    });
}