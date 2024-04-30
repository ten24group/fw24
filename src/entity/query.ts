import { EntityFilters, EntityQuery, FilterGroup, FilterOperatorValue, isComplexFilterOperatorValue, isFilterCriteria, isFilterGroup } from './query.types';
import { Item, Schema, WhereAttributes, WhereOperations } from "electrodb";
import { EntitySchema } from "./base-entity";
import { FilterCriteria } from "./query.types";
import { createLogger } from "../logging";

import {
    parse as parseQueryString,
    stringify as stringifyQueryParams,
} from 'qs';
import { isArray, isObject } from '../utils';
import { parseValueToCorrectTypes } from '../utils/parse';


const logger = createLogger('EntityQuery');

export function filterToExpression<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C>,
  I extends Item<A, F, C, S, S["attributes"]>,
  WAttributes extends WhereAttributes<A, F, C, S, I>,
  WOperations extends WhereOperations<A, F, C, S, I>,
>(filter: FilterCriteria<any>, attributes: WAttributes, operations: WOperations){
    
    logger.info('filterToExpression', {filter});

    const { id, label, prop, logicalOp = 'and', ...filters } = filter;

    const attributeRef = attributes[prop as keyof WAttributes];

    if(!attributeRef){
        logger.error(`Invalid filter property`, {prop, filter, attributes});
        throw(`Invalid filter property ${prop?.toString()}`);
    }

    const filterFragments: Array<string> = [];
    const { eq, ne, gt, gte, lt, lte, between, begins, exists, notExists, contains, notContains, name, size, type } = operations;

    for(const filterKey in filters){
        
        let filterVal = filters[filterKey as keyof typeof filters];

        if(isComplexFilterOperatorValue(filterVal)){
            console.log("isComplexFilterOperatorValue ", filterVal);
            // TODO: handle `expression` filter values
            filterVal = filterVal?.valType == 'propRef' ? name(filterVal.val) : filterVal.val;
        }

        if( ['equalTo', 'equal', 'eq', '==', '==='].includes(filterKey) ){

            filterFragments.push( eq(attributeRef, filterVal));

        } else if( ['notEqualTo', 'notEqual', 'neq', 'ne', '!=', '!==', '<>' ].includes(filterKey) ){

            filterFragments.push( ne(attributeRef, filterVal));

        } else if( [ 'greaterThen', 'gt', '>'].includes(filterKey) ){
            
            filterFragments.push( gt(attributeRef, filterVal));

        } else if( ['greaterThenOrEqualTo', 'gte', '>=', '>=='].includes(filterKey) ){
            
            filterFragments.push( gte(attributeRef, filterVal));

        } else if( [ 'lessThen', 'lt', '<'].includes(filterKey) ){
            
            filterFragments.push( lt(attributeRef, filterVal));

        } else if( ['lessThenOrEqualTo', 'lte', '<=', '<=='].includes(filterKey) ){
            
            filterFragments.push( lte(attributeRef, filterVal));

        } else if( ['between', 'bt', 'bw', '><'].includes(filterKey) ){
            filterFragments.push( between(attributeRef, filterVal[0], filterVal[1]));

        } else if( ['like', 'begins', 'startsWith', 'beginsWith' ].includes(filterKey) ){
            
            filterFragments.push( begins(attributeRef, filterVal));

        } else if( ['contains', 'has', 'includes', 'containsSome'].includes(filterKey) ){
            
            filterVal = Array.isArray(filterVal) ? filterVal : [filterVal];
            const logicalOpp = filterKey === 'containsSome' ? 'OR' : 'AND';

            const listFilters = filterVal.map( (val: any) => contains(attributeRef, val))

            filterFragments.push( makeParenthesesGroup(listFilters, logicalOpp) );
            
        } else if( ['notContains', 'notHas', 'notIncludes'].includes(filterKey) ){

            filterVal = Array.isArray(filterVal)? filterVal : [filterVal];

            const listFilters = filterVal.map( (val: any) => notContains(attributeRef, val))

            filterFragments.push( makeParenthesesGroup(listFilters, 'AND') );
                        
        } else if( ['in', 'inList'].includes(filterKey) ){

            filterVal = Array.isArray(filterVal)? filterVal : [filterVal];

            const listFilters = filterVal.map( (val: any) => eq(attributeRef, val))

            filterFragments.push( makeParenthesesGroup(listFilters, 'OR') );

        } else if( ['nin', 'notIn', 'notInList'].includes(filterKey) ){

            filterVal = Array.isArray(filterVal)? filterVal : [filterVal];

            const listFilters = filterVal.map( (val: any) => ne(attributeRef, val))

            filterFragments.push( makeParenthesesGroup(listFilters, 'AND') );

        } else if( ['exists', 'isNull'].includes(filterKey) ){
            
            filterFragments.push( filterVal ? exists(attributeRef) : notExists(attributeRef)  );
            
        } else if( ['isEmpty'].includes(filterKey) ){
            
            filterFragments.push( filterVal ? eq(attributeRef as string, '' as string) : ne(attributeRef as string, '' as string)  );
            
        }
    }
    
    const filterExpression = makeParenthesesGroup(filterFragments, logicalOp);

    logger.info('filterToExpression', {filterFragments, filterExpression});

    return filterExpression;
}

export function makeParenthesesGroup( items: Array<string>, delimiter: string ): string {
    return items.length > 1 ? '( ' + items.join(` ${delimiter.toUpperCase()} `) + ' )' : items[0];
}

export function filterCriteriaOrFilterGroupToExpression<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C>,
  I extends Item<A, F, C, S, S["attributes"]>,
  WAttributes extends WhereAttributes<A, F, C, S, I>,
  WOperations extends WhereOperations<A, F, C, S, I>,
>(filterCriteriaOrFilterGroup: FilterGroup<S> | FilterCriteria<S>, attributes: WAttributes, operations: WOperations){
    if(isFilterGroup(filterCriteriaOrFilterGroup)){
        return filterGroupToExpression(filterCriteriaOrFilterGroup, attributes, operations);
    } else if(isFilterCriteria(filterCriteriaOrFilterGroup)) {
        return filterToExpression(filterCriteriaOrFilterGroup, attributes, operations);
    }
    logger.error('filterCriteriaOrFilterGroupToExpression: filterCriteriaOrFilterGroup is not a FilterGroup or FilterCriteria', {filterCriteriaOrFilterGroup});
    throw new Error('filterCriteriaOrFilterGroup is not a FilterGroup or FilterCriteria');
}

export function filterGroupToExpression<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C>,
  I extends Item<A, F, C, S, S["attributes"]>,
  WAttributes extends WhereAttributes<A, F, C, S, I>,
  WOperations extends WhereOperations<A, F, C, S, I>,
>(filterGroup: FilterGroup<any>, attributes: WAttributes, operations: WOperations){
    
    logger.info('filterGroupToExpression', {filterGroup});

    const {id, label, and = [], or = [], not = []} = filterGroup;
    logger.info('filterGroupToExpression', {and, or, id, label, not});
    const filterGroupFragments: Array<string> = [];
    
    const andFragments: Array<string> = [];
    for(const thisFilter of and){
        const thisExpression = filterCriteriaOrFilterGroupToExpression(thisFilter, attributes, operations);
        if(thisExpression.length){
            andFragments.push(thisExpression);
        }
    }
    if(andFragments.length){
        const andExpressions = makeParenthesesGroup(andFragments, 'and');
        logger.info('filterGroupToExpression', {andExpressions});
        filterGroupFragments.push( andExpressions );
    }

    const orFragments: Array<string> = [];
    for(const thisFilter of or){
        const thisExpression = filterCriteriaOrFilterGroupToExpression(thisFilter, attributes, operations);
        if(thisExpression.length){
            orFragments.push(thisExpression);
        }
    }
    if(orFragments.length){
        const orExpressions = makeParenthesesGroup(orFragments, 'or');
        logger.info('filterGroupToExpression', {orExpressions});
        filterGroupFragments.push( orExpressions );
    }

    const notFragments: Array<string> = [];
    for(const thisFilter of not){
        const thisExpression = filterCriteriaOrFilterGroupToExpression(thisFilter, attributes, operations);
        if(thisExpression.length){
            notFragments.push(thisExpression);
        }
    }
    if(notFragments.length){
        const notExpressions = makeParenthesesGroup(notFragments, 'AND NOT');
        logger.info('filterGroupToExpression', {notExpressions});
        filterGroupFragments.push( notExpressions );
    }

    logger.info('filterGroupToExpression', {filterGroupFragments});

    
    const filterExpression = makeParenthesesGroup(filterGroupFragments, 'AND');  
    logger.info('filterGroupToExpression', {filterExpression});

    return filterExpression;
}

export function entityFiltersToFilterExpression<
  A extends string,
  F extends string,
  C extends string,
  S extends EntitySchema<A, F, C>,
  I extends Item<A, F, C, S, S["attributes"]>,
  WAttributes extends WhereAttributes<A, F, C, S, I>,
  WOperations extends WhereOperations<A, F, C, S, I>,
  >(
    entityFilters: EntityFilters<S>,
    attributes: WAttributes,
    operations: WOperations
  ) {
    logger.info('entityFiltersToFilterExpression', {entityFilters});

    let expression = '';

    if(isFilterCriteria(entityFilters) ){
        expression = filterToExpression(entityFilters, attributes, operations);
    } else if(isFilterGroup(entityFilters)) {
        expression = filterGroupToExpression(entityFilters, attributes, operations);
    }

    logger.info('entityQueryToFilterExpression', { expression});

    return expression;

  }


    export function parseUrlQueryStringParameters(queryStringParameters: {[name: string]: string | undefined}){
        logger.info('parseUrlQueryStringParameters', {queryStringParameters});
        
        const queryString = stringifyQueryParams(queryStringParameters);
        logger.info('parseUrlQueryStringParameters', {queryString});
        
        const parsed = parseQueryString(queryString, {
            delimiter: /[;,&:+]/,
            allowDots: true,
            decodeDotInKeys: true,
            parseArrays: true,
            duplicates: 'combine',
            allowEmptyArrays: false,
        });
        
        logger.info('parseUrlQueryStringParameters', {parsed});
        return parsed;
    }

    export const PARSE_VALUE_DELIMITERS = /(?:&|,|\+|;|:|\.)+/;
    export const FILTER_KEYS_HAVING_ARRAY_VALUES = ['in', 'inList', 'nin', 'notIn', 'notInList', 'contains', 'includes', 'has', 'notContains' ,'notIncludes', 'notHas' ];

    export function makeFilterFromQueryStringParams(paramName: string, paramValue: any){
        logger.info('makeFilterFromQueryStringParams', {paramName, paramValue});

        /**
         *  or: [{ foo: { eq: '1' }}, { foo: { neq: '3' } }]
        */
        if(['and', 'or', 'not'].includes(paramName)){
            
            let formattedGroupVal: Array<any> = []; 
            
            paramValue.forEach( (item: any) => {
                Object.keys(item).forEach( (itemKey: string) => {
                    const itemValue = item[itemKey];
                    const formattedItems = makeFilterFromQueryStringParams(itemKey, itemValue);
                    formattedGroupVal = formattedGroupVal.concat(formattedItems);
                });
            });

            logger.info('makeFilterFromQueryStringParams', {formattedGroupVal});

            return formattedGroupVal;
        }

        let formattedValues: any = {};

        if(!isObject(paramValue)){
            paramValue = {'eq': paramValue};
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
        Object.keys(paramValue).forEach( (key) => {
            const keyVal = paramValue[key];
            let formattedVal = keyVal;

            // parse the values to the right types here
            if( FILTER_KEYS_HAVING_ARRAY_VALUES.includes(key) && typeof keyVal === 'string') {
                logger.info('Splitting key value', {key, keyVal});
                formattedVal = keyVal.split(PARSE_VALUE_DELIMITERS);
            }

            formattedVal = parseValueToCorrectTypes(formattedVal);

            formattedValues[key] = formattedVal;
        });

        const formattedItemVal = {
            prop: paramName,
            ...formattedValues
        }

        logger.info('makeFilterFromQueryStringParams', {formattedItemVal});

        return formattedItemVal;
    }

    export function queryStringParamsToEntityFilters( queryStringParams: {[name: string]: any}){
        logger.info('queryStringParamsToEntityFilters', {queryStringParams});

        const formatted: any = {
            and: [],
            not: [],
            or: [],
        };

        for(let qParamName in queryStringParams){

            let groupName: keyof typeof formatted = 'and';

            // then treat it as a filter item
            if( Object.keys(formatted).includes(qParamName) ){
                groupName = qParamName as keyof typeof formatted;
            }

            let qParamValue = queryStringParams[qParamName];

            const formattedQPVal = makeFilterFromQueryStringParams(qParamName, qParamValue);

            formatted[groupName] = formatted[groupName].concat(formattedQPVal);
        }

        logger.info('queryStringParamsToEntityFilters', {formatted});

        return formatted;

        /*

        foo: {
          eq: '1',
          neq: '3'
        },
        bar: {
          contains: 'fluffy'
        },
        baz: {
          in: '4,34'
        }


        {
            or: [
            {
                foo: {
                eq: '1'
                }
            },
            {
                foo: {
                neq: '3'
                }
            }
            ],
            and: [
            {
                bar: {
                contains: 'fluffy'
                }
            },
            {
                baz: {
                in: '4,34',
                nin: [
                    '8989',
                    '565'
                ]
                }
            }
            ]
        }
        */
    }