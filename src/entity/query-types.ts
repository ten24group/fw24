import { ExclusiveUnion, ValueOf, isArray, isArrayOfType, isBoolean, isEmpty, isObject, isString } from "../utils";
import { EntitySchema, HydrateOptionForEntity, HydrateOptionForRelation, } from "./base-entity";


export type Pagination = {
    limit?: number;
    count?: number;
    pages?: number | 'all';
    pager?: 'raw' | 'cursor',
    order?: 'asc' | 'desc';
    cursor?: string,
}

export type LogicalOperator = 'and' | 'or' | 'not';

export type StringLiteralToType<T> = T extends 'string' ? string
    : T extends 'number' ? number
    : T extends 'boolean' ? boolean
    : T extends 'array' ? Array<any>
    : T extends 'set' ? Array<any>
    : T extends 'list' ? Array<any>
    : T extends 'object' ? Record<string, any>
    : T extends 'map' ? Map<any, any>
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

export function isComplexFilterValue<T>(payload: any): payload is ComplexFilterOperatorValue<T> {
    return (isObject(payload) && payload.hasOwnProperty('val'))
}

/**
 * Represents a value that can be used as an operator in a filter.
 * It can be either a single value of type T or a complex filter operator value.
 */
export type FilterOperatorValue<T> = T | ComplexFilterOperatorValue<T>;

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

    'between': FilterOperators<T>[ 'bt' ],
    'bw': FilterOperators<T>[ 'bt' ],
    "><": FilterOperators<T>[ 'bt' ],

    'equalTo': FilterOperators<T>[ 'eq' ],
    'equal': FilterOperators<T>[ 'eq' ],
    '===': FilterOperators<T>[ 'eq' ],
    '==': FilterOperators<T>[ 'eq' ],

    'notEqualTo': FilterOperators<T>[ 'neq' ],
    'notEqual': FilterOperators<T>[ 'neq' ],
    '!==': FilterOperators<T>[ 'neq' ],
    '!=': FilterOperators<T>[ 'neq' ],
    '<>': FilterOperators<T>[ 'neq' ],
    'ne': FilterOperators<T>[ 'neq' ],

    'greaterThan': FilterOperators<T>[ 'gt' ],
    '>': FilterOperators<T>[ 'gt' ],

    'greaterThanOrEqualTo': FilterOperators<T>[ 'gte' ],
    '>=': FilterOperators<T>[ 'gte' ],
    '>==': FilterOperators<T>[ 'gte' ],

    'lessThan': FilterOperators<T>[ 'lt' ],
    '<': FilterOperators<T>[ 'lt' ],

    'lessThanOrEqualTo': FilterOperators<T>[ 'lte' ],
    '<=': FilterOperators<T>[ 'lte' ],
    '<==': FilterOperators<T>[ 'lte' ],

    'inList': FilterOperators<T>[ 'in' ],

    'notInList': FilterOperators<T>[ 'nin' ],
    'notIn': FilterOperators<T>[ 'nin' ],

    'exists': FilterOperators<T>[ 'isNull' ],

    'begins': FilterOperators<T>[ 'startsWith' ],
    'beginsWith': FilterOperators<T>[ 'startsWith' ],

    'includes': FilterOperators<T>[ 'contains' ],
    'includesSome': FilterOperators<T>[ 'containsSome' ],

    'has': FilterOperators<T>[ 'contains' ],
    'hasSome': FilterOperators<T>[ 'containsSome' ],

    'notIncludes': FilterOperators<T>[ 'notContains' ],
    'notHas': FilterOperators<T>[ 'notContains' ],
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

export const filterOperatorsForDynamo: Array<keyof FilterOperatorsForDynamo<any>> = allFilterOperators.filter(op => ![ 'endsWith' ].includes(op));

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
export type TypedFilterCriteria<T = any> = IdAndLabelAndLogicalOp & {
    [ op in keyof FilterOperatorsExtended<T> ]?: FilterOperatorsExtended<StringLiteralToType<T>>[ op ]
}

export function isFilterCriteria<T>(payload: any): payload is TypedFilterCriteria<T> {
    return (
        isObject(payload)
        &&
        allFilterOperators.some(key => payload.hasOwnProperty(key))
    )
}

// New: Generic AttributeFilter
export type AttributeFilter<AttrType = string, ValueType = any> = TypedFilterCriteria<ValueType> & {
    attribute: AttrType; // Name of the attribute to filter on
};

export function isAttributeFilter(payload: any): payload is AttributeFilter {
    return (isFilterCriteria(payload) && payload.hasOwnProperty('attribute'))
}

/**
 * Represents a generic filter for any typed object.
 * @template T - The type of the filter criteria.
 * 
 * @example
 *   const filter: GenericFilter<{ id: string, name: string, age: number }> = {
 *     id: { eq: '123' },
 *     name: { like: 'John', notLike: 'Doe', logicalOp: 'OR' }, // `name like 'John' OR name not like 'Doe'`
 *     age: { gte: 18 },
 *   };
 *  
 */
export type GenericTypedFilter<T extends Record<string, any> = Record<string, any>> = IdAndLabelAndLogicalOp & {
    [ k in keyof T ]?: TypedFilterCriteria<T[ k ]>
}

export function isGenericTypedFilter(payload: any): payload is GenericTypedFilter {
    return isObject(payload)
        && !isEmpty(payload)
        && Object.entries(payload)
            // except these things every other key must represent a filter
            .filter(([ k ]) => ![ 'filterId', 'filterLabel', 'logicalOp' ].includes(k))
            .every(([ , v ]) => isFilterCriteria(v))
}

export type GenericFilterGroup<T extends Record<string, any> = Record<string, any>> = IdAndLabel & {
    [ op in LogicalOperator ]?: Array<
        ExclusiveUnion<GenericFilterGroup<T> | GenericTypedFilter<T> | AttributeFilter<keyof T, T[ keyof T ][ 'type' ]>>
    >
};

export function isGenericFilterGroup(payload: any): payload is GenericFilterGroup {
    return isObject(payload)
        && !isEmpty(payload)
        && [ 'and', 'or', 'not' ].some(
            logicalOp => (
                payload.hasOwnProperty(logicalOp)
                && isArray(payload[ logicalOp ])
                && payload[ logicalOp ].every(
                    (f: any) => isAttributeFilter(f) || isGenericFilterGroup(f) || isGenericTypedFilter(f)
                )
            )
        );
}

// the starting point of the filter or filter group
export type GenericFilterCriteria<T extends Record<string, any> = Record<string, any>> =
    ExclusiveUnion<GenericFilterGroup<T> | GenericTypedFilter<T>>

/**
 * Represents a key-value pair of entity attribute names and their types.
 * @template E - The entity schema type.
 *
 * @example
 * ```ts
 * interface UserEntitySchema {
 *   attributes: {
 *     id: { type: 'string' };
 *     name: { type: 'string' };
 *     age: { type: 'number' };
 *   };
 * }
 *
 * EntityAttributeValueTypeKV<UserEntitySchema> would resolve to:
 *  {
 *    id: 'string';
 *    name: 'string';
 *    age: 'number';
 *  }
 * ```
 */
export type EntityAttributeValueTypeKV<E extends EntitySchema<any, any, any>> = {
    [ key in keyof E[ 'attributes' ] ]: E[ 'attributes' ][ key ][ 'type' ]
}

/**
 * Represents a filter criteria for a single attribute of an entity.
 * It combines the attribute name with the filter operators applicable to the attribute's value type.
 * @template E - The entity schema type.
 *
 * @example
 * ```ts
 * interface UserEntitySchema {
 *   attributes: {
 *     id: { type: 'string' };
 *     name: { type: 'string' };
 *     age: { type: 'number' };
 *   };
 * }
 *
 * // Filter for users named 'John'
 * const nameFilter: EntityAttributeFilter<UserEntitySchema> = {
 *   attribute: 'name',
 *   eq: 'John',
 * };
 *
 * // Filter for users older than 18
 * const ageFilter: EntityAttributeFilter<UserEntitySchema> = {
 *   attribute: 'age',
 *   gt: 18,
 * };
 *
 * // Filter for users whose id is in a list
 * const idFilter: EntityAttributeFilter<UserEntitySchema> = {
 *   attribute: 'id',
 *   inList: ['123', '456'],
 * };
 * ```
 */
export type EntityAttributeFilter<E extends EntitySchema<any, any, any>> = {
    [ K in keyof EntityAttributeValueTypeKV<E> ]: AttributeFilter<K, EntityAttributeValueTypeKV<E>[ K ]>
}[ keyof EntityAttributeValueTypeKV<E> ];

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
 *   const filter: EntityFilter<UserEntitySchema> = {
 *     id: { eq: '123' },
 *     name: { like: 'John', notLike: 'Doe', logicalOp: 'OR' }, // `name like 'John' OR name not like 'Doe'`
 *     age: { gte: 18 },
 *   };
 *   // Equivalent to: (name like 'John' OR name not like 'Doe') AND age >= 18
 *
 *   // Example 4: Combining top-level and attribute-level logical operators
 *   const filter4: EntityFilter<UserEntitySchema> = {
 *     logicalOp: 'or', // Top-level OR
 *     id: { eq: '123' },
 *     name: {
 *       logicalOp: 'and', // Attribute-level AND
 *       like: 'Smith',
 *       notLike: 'Jones',
 *     },
 *   };
 *   // Equivalent to: id = '123' OR (name like 'Smith' AND name not like 'Jones')
 *
 *   // Example 5: Including filterId and filterLabel
 *   const filter5: EntityFilter<UserEntitySchema> = {
 *     filterId: 'teenagers',
 *     filterLabel: 'Teenagers',
 *     age: { gte: 13, lte: 19 },
 *   };
 *   // Equivalent to: age >= 13 AND age <= 19
 * ```
 */
export type EntityFilter<E extends EntitySchema<any, any, any>> = GenericTypedFilter<EntityAttributeValueTypeKV<E>>

export function isEntityFilter<E extends EntitySchema<any, any, any>>(payload: any): payload is EntityFilter<E> {
    return isGenericTypedFilter(payload);
}

/**
 * Represents a filter group for querying entities.
 * This structure allows combining multiple attribute filters using logical operators ('and', 'or').
 * Each element within an 'and' or 'or' array can be either a single attribute filter or another filter group,
 * allowing for complex nested filter logic.
 *
 * @template E - The entity schema type.
 *
 * @example
 * ```ts
 * interface UserEntitySchema {
 *   attributes: {
 *     id: { type: 'string' };
 *     name: { type: 'string' };
 *     age: { type: 'number' };
 *   };
 * }
 *
 * // Example: (name = 'John' OR name = 'Jane') AND age >= 18
 * const filterGroup: EntityFilterGroup<UserEntitySchema> = {
 *   and: [
 *     {
 *       or: [
 *         { attribute: 'name', eq: 'John' },
 *         { attribute: 'name', eq: 'Jane' },
 *       ],
 *     },
 *     { attribute: 'age', gte: 18 },
 *   ],
 * };
 *
 * // Example with filterId and filterLabel
 * const filterGroupWithMeta: EntityFilterGroup<UserEntitySchema> = {
 *   filterId: 'adults',
 *   filterLabel: 'Adult Users',
 *   and: [
 *     { attribute: 'age', gte: 18 },
 *     { attribute: 'age', lte: 55 },
 *     { 
 *       or: [
 *         { attribute: 'name', eq: 'John' },
 *         { attribute: 'lastName', eq: 'Doe' },
 *       ],
 *     },
 *   ],
 * };
 * ```
 * // Equivalent to: (age >= 18 AND age <= 55) AND (name = 'John' OR lastName = 'Doe')
 */
export type EntityFilterGroup<E extends EntitySchema<any, any, any>> = GenericFilterGroup<EntityAttributeValueTypeKV<E>>;

export function isEntityFilterGroup<E extends EntitySchema<any, any, any>>(payload: any): payload is EntityFilterGroup<E> {
    return isGenericFilterGroup(payload);
}

/**
 * Represents the criteria used to filter entities.
 *
 * This type provides a flexible way to define filter conditions for entity queries.
 * It can take two main forms:
 *
 * 1.  **Flat Key-Value Filter (`EntityFilter<E>`):** A simple object where keys are entity attribute names
 *     and values are the filter conditions for that specific attribute (e.g., `{ age: { gte: 18 }, status: { eq: 'active' } }`).
 *     Multiple conditions on the same attribute are combined using the `logicalOp` property within the attribute's filter criteria.
 *     Multiple attributes are combined using an implicit 'AND' operator by default, or explicitly via the `logicalOp` property at the top level.
 *
 * 2.  **Nested Filter Group (`EntityFilterGroup<E>`):** A structure using explicit logical operators (`and`, `or`)
 *     to combine multiple filter conditions or nested filter groups. This allows for complex boolean logic
 *     (e.g., `and: [{ or: [{ attribute: 'name', eq: 'John' }, { attribute: 'name', eq: 'Jane' }] }, { attribute: 'age', gte: 18 }]`).
 *     Each element in an `and` or `or` array can be either a single attribute filter (`EntityAttributeFilter<E>`)
 *     or another nested filter group (`EntityFilterGroup<E>`).
 *
 * This union type (`ExclusiveUnion<EntityFilterGroup<E> | EntityFilter<E>>`) ensures that a filter criteria
 * is *either* a flat filter *or* a filter group, but not both simultaneously at the top level.
 *
 * @template E - The entity schema type, which determines the valid attributes and their value types for filtering.
 *
 * @see {@link EntityFilter} for the flat filter structure.
 * @see {@link EntityFilterGroup} for the nested filter group structure.
 * @see {@link EntityAttributeFilter} for filtering a single attribute within a group.
 */
export type EntityFilterCriteria<E extends EntitySchema<any, any, any>> = GenericFilterCriteria<EntityAttributeValueTypeKV<E>>;

/**
 * Represents the selection of attributes for an entity.
 * It can be an array of attribute keys or an object with attribute keys as properties.
 * If an attribute key is present in the object, it indicates that the attribute should be included in the selection.
 * If the value of the property is `true`, the attribute will be included.
 * If the value of the property is `false`, the attribute will be excluded.
 * The attributes can be dot delimited keys to represent relation's attributes.
 * In case of objects, attributes can be nested objects where each key represents an attribute of the entity.
 * For relational attributes, the value can be a boolean for both relational and non-relational attributes.
 * For relational attributes, the value can also be an object with required metadata like entity-name, identifiers meta for the entity, and further attributes to hydrate in this relation.
 * The entity-name and identifiers meta are not required and will be inferred by the backend.
 * @template E - The entity schema type.
 * 
 * @example
 * 
 * ```ts
 * 
 * interface UserEntitySchema {
 *   attributes: {
 *     name: { type: 'string' };
 *     age: { type: 'number' };
 *     email: { type: 'string' };
 *     posts: { type: 'array',  relation: { entity: PostEntitySchema, type: 'one-to-many' } };
 *   };
 * }
 * 
 * interface PostEntitySchema {
 *   attributes: {
 *     title: { type: 'string' };
 *     content: { type: 'string' };
 *   };
 * }
 * 
 * type UserSelections = EntitySelections<UserEntitySchema>;
 * 
 * // Select specific attributes
 * const selections1: UserSelections = ['name', 'age']; // ['name', 'age']
 * 
 * // Include specific attributes
 * const selections4: UserSelections = { name: true, age: true }; // { name: true, age: true }
 * 
 * // Include relation attributes
 * const selections5: UserSelections = { posts: true }; // { posts: true }
 * 
 * // Include nested attributes
 * const selections6: UserSelections = { 'posts': { identifiers: ['title', 'content'] };
 * 
 * // Include nested attributes with metadata
 * const selections7: UserSelections = { 'posts': { identifiers: { postId: 'id' }, attributes: ['title'] } }; // { 'posts': { entityName: 'Post', attributeName: 'posts' identifiers: { id: '123-xxx-yyy' }, attributes: ['title'] } }
 * ```
 */
export type EntitySelections<E extends EntitySchema<any, any, any>> = HydrateOptionForEntity<E>;

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
/**
 * Represents a query for retrieving entities.
 * @template E - The entity schema type.
 */
export type EntityQuery<E extends EntitySchema<any, any, any>> = {
    /**
     * Specifies the attributes to be selected for the entity.
     */
    attributes?: EntitySelections<E>,

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

    /**
     * Specifies the index to use for the query.
     * If not provided, the system will automatically find a matching index based on the filters.
     */
    index?: {
        /**
         * The name of the index to use.
         */
        name: string,

        /**
         * The filters to use with the index.
         * These filters should match the key attributes of the index.
         */
        filters?: Record<string, any>
    }
}

export type ObjectOfStringKeysAndBooleanValues = { [ k: string ]: boolean };
export function isArrayOfObjectOfStringKeysAndBooleanValues(payload: any): payload is Array<ObjectOfStringKeysAndBooleanValues> {
    return isArrayOfType<ObjectOfStringKeysAndBooleanValues>(payload, (item: any): item is ObjectOfStringKeysAndBooleanValues => {
        return isObject(item) && Object.entries(item).every(([ key, value ]) => isString(key) && isBoolean(value));
    });
}

export type ParsedEntityAttributePaths = {
    [ key: string ]: boolean | { attributes: ParsedEntityAttributePaths };
};

export type ParsedEntityAttributePathsWithRelationMeta = {
    [ key: string ]: boolean | HydrateOptionForRelation;
};