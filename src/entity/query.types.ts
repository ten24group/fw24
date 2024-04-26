import { Narrow, ValueOf } from "../utils";
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

export type ComplexFilterOperatorValue<T> ={
val: T,
// default val type will be literal
valType ?: 
    // the exact value will be used for comparison
    'literal'       
    // when the compression is with another property of the same entity [including properties of nested maps(objects) or lists(arrays) ]
    | 'propRef'     
    // when the value needs to be evaluated first for example [`now()`, `$currentUser`, `$requestId`]  
    // TODO: add support for evaluating filter expressions and a dictionary of supported expressions/syntax
    | 'expression', 
// a label to be used by the UI for the filter value; useful for persisted filter-configs
label?: any,
}

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

    'greaterThen': FilterOperators<T>['gt'],
    '>': FilterOperators<T>['gt'],

    'greaterThenOrEqualTo': FilterOperators<T>['gte'],
    '>=': FilterOperators<T>['gte'],
    '>==': FilterOperators<T>['gte'],

    'lessThen': FilterOperators<T>['lt'],
    '<': FilterOperators<T>['lt'],

    'lessThenOrEqualTo': FilterOperators<T>['lte'],
    '<=': FilterOperators<T>['lte'],
    '<==': FilterOperators<T>['lte'],

    'inList': FilterOperators<T>['in'],

    'notInList': FilterOperators<T>['nin'],
    'notIn': FilterOperators<T>['nin'],

    'exists': FilterOperators<T>['isNull'],

    'begins': FilterOperators<T>['startsWith'],
    'beginsWith': FilterOperators<T>['startsWith'],

    'includes': FilterOperators<T>['contains'],
    'has': FilterOperators<T>['contains'],

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
    
    'greaterThen',
    'gt', 
    '>',

    'greaterThenOrEqualTo',
    'gte', 
    '>=',
    '>==',

    'lessThen',
    'lt', 
    '<',

    'lessThenOrEqualTo',
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

export type FilterCriteria<E extends EntitySchema<any, any, any>> = {
    prop: keyof E['attributes'],

    id?: string,
    label?: string,
    logicalOp?: 'and' | 'or', // defaults to `and`
}
& {
    [ op in keyof FilterOperatorsExtended<ValueOf<E['attributes']>['type']> ]?: FilterOperatorsExtended< StringLiteralToType< ValueOf<E['attributes']>['type'] > >[op]
}

export type FilterGroup<E extends EntitySchema<any, any, any>> = {
    id?: string,
    label?: string,
} & {
    [op in LogicalOperator] ?: Array< FilterCriteria<E> | FilterGroup<E> >
}

export function isComplexFilterOperatorValue<T>(filterVal: any): filterVal is ComplexFilterOperatorValue<T> {
    return typeof filterVal === 'object'
    && filterVal !== null 
    && filterVal.hasOwnProperty('val')
}

export function isFilterCriteria<E extends EntitySchema<any, any, any>>(filterCriteria: any): filterCriteria is FilterCriteria<E> {
    return typeof filterCriteria === 'object'
    && filterCriteria !== null 
    && filterCriteria.hasOwnProperty('prop') 
    && filterOperatorsForDynamo.some( key => filterCriteria.hasOwnProperty(key) )
}

export function isFilterGroup<E extends EntitySchema<any, any, any>>(filterGroup: any): filterGroup is FilterGroup<E> {
    return typeof filterGroup === 'object'
    && filterGroup !== null 
    && ['and', 'or', 'not'].some( logicalOp => (
        filterGroup.hasOwnProperty(logicalOp) 
        && Array.isArray(filterGroup[logicalOp]) 
        && filterGroup[logicalOp].every( (f: any) => isFilterCriteria(f)
    )));
}

export type EntityFilters<E extends EntitySchema<any, any, any>> = FilterGroup<E> | FilterCriteria<E>;

export type EntitySelection<E extends EntitySchema<any, any, any>> = Array<keyof E['attributes']> | {
    [prop in keyof E['attributes']]?: boolean
}

export type EntityQuery<E extends EntitySchema<any, any, any>> = {
    filters?: EntityFilters<E>,
    selection?: EntitySelection<E>,
    pagination ?: Pagination
}