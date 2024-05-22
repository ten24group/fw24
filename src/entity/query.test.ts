import { describe, expect, it } from '@jest/globals';
import { parseUrlQueryStringParameters, queryStringParamsToFilterGroup } from './query';


import { entityFilterToFilterGroup } from './query';
import { EntityFilter } from './query-types';

describe('entityFilterToFilterGroup', () => {

    it('should convert entity filter to filter group', () => {
        const filter = {
        name: {
            equalTo: 'John'  
        },
        age: {
            greaterThan: 18
        }
        };

        const result = entityFilterToFilterGroup(filter);

        expect(result).toEqual({
        and: [
            { attribute: 'name', equalTo: 'John'},
            { attribute: 'age', greaterThan: 18}  
        ]
        });
    });

    it('should set id and label', () => {
        const filter = {
        filterId: 'myFilter',
        filterLabel: 'myFilter',
        name: {
            equalTo: 'John'
        }
        };

        const result = entityFilterToFilterGroup(filter);

        expect(result.filterId).toBe('myFilter');
        expect(result.filterLabel).toBe('myFilter');
    });

    it('should handle custom logical operator', () => {
        const filter:EntityFilter<any> = {
            logicalOp: 'or',
            name: {
                equalTo: 'John'
            },
            age: {
                greaterThan: 18
            }
        };

        const result = entityFilterToFilterGroup(filter);

        expect(result).toEqual({
            id: undefined,
            label: undefined,
            or:[
                {
                   attribute: "name",
                   equalTo: "John",
                 },
                {
                   attribute: "age",
                   greaterThan: 18,
                },
            ]
        });
    });

    it('should handle missing logicalOp', () => {
        const filter = {
            name: {
                equalTo: 'John'
            }
        };

        const result = entityFilterToFilterGroup(filter);

        expect(result.and).toBeDefined(); // default
    });

    it('should handle multiple filter criteria', () => {
        const filter = {
            name: {
                equalTo: 'John'
            },
            age: {
                greaterThan: 18,
                lessThan: 60
            }
        };

        const result = entityFilterToFilterGroup(filter);

        expect(result).toEqual({
            id: undefined, 
            label: undefined,
            and: [
                {attribute: 'name', equalTo: 'John'},
                {attribute: 'age', greaterThan: 18, lessThan: 60}
            ]
        });
    });

    it('should throw error for invalid filter shape', () => {
        const filter = {
            name: 'John' // invalid shape
        };

        expect(() => {
            entityFilterToFilterGroup(filter);
        }).toThrowError();
    });


});


describe('parseUrlQueryStringParameters', () => {

it('should parse simple query string params successfully', ()=>{
    const parsed = parseUrlQueryStringParameters({
    "foo[eq]" : "1",
    "foo.neq": "3",
    "bar[contains]": "fluffy",
    "baz[in]": "4,34&343+787",
    });
    
    console.log(parsed);

    expect(parsed).toEqual({
        foo: {
            eq: '1',
            neq: '3'
        },
        bar: {
            contains: 'fluffy'
        },
        baz: {
            in: '4,34&343+787'
        }
    });

    const etQ = queryStringParamsToFilterGroup(parsed);
    console.log(etQ);

    expect(etQ).toEqual({
        filterId: 'queryStringParamsToFilterGroup',
        and: [
            {
                attribute: 'foo',
                eq: 1,
                neq: 3
            },
            {
                attribute: 'bar',
                contains: [ 'fluffy' ]
            },
            {
                attribute: 'baz',
                in: [ 4, 34, 343, 787 ]
            }
        ],
        not: [],
        or: []
    });
});

it('should parse query strings with and/or groups having ( [] array, and `.` dot ) notation successfully', () => {

    const parsed = parseUrlQueryStringParameters({
    "or[][foo][eq]" : "1",
    "or[].foo.neq": "3",
    "and[].bar[contains]": "fluffy",
    "and[].baz[in]": "4,34",
    });

    console.log(parsed);

    expect(parsed).toEqual({
    or: [{
        foo: {
            eq: '1',
            neq: '3'
        }
    }],
    and: [{
        bar: { contains: 'fluffy' },
        baz: { in: '4,34' }
    }]
    });

    const etQ = queryStringParamsToFilterGroup(parsed);
    console.log(etQ);

    expect(etQ).toEqual({
        filterId: 'queryStringParamsToFilterGroup',
        and: [{
            attribute: 'bar',
            contains: [ 'fluffy' ]
        },
        {
            attribute: 'baz',
            in: [ 4, 34]
        }],
        not: [],
        or: [{
            attribute: 'foo',
            eq: 1,
            neq: 3
        }]
    });

});

it('should parse query strings with and/or groups and [split/combine/parse] values successfully', () => {

    const parsed = parseUrlQueryStringParameters({
    "or.0.foo.eq" : "1",
    "or.1.foo.neq": "3",
    "and.0.bar[contains]": "fluffy",
    "and.1.baz[in]": "4,34",
    "and.1.baz.nin": "8989",
    "and.1.baz[nin]": "565",
    });

    console.log(parsed);

    expect(parsed).toEqual({
    or:[
        {foo: {"eq": "1"} },
        {foo: {"neq": "3"} }
    ],
    and:[{
        bar: { contains: "fluffy"}
        },
        {
        baz: {
            in: "4,34",
            nin: ["8989", "565"]
        }
    }]
    });

    const etQ = queryStringParamsToFilterGroup(parsed);

    expect(etQ).toEqual({
        filterId: 'queryStringParamsToFilterGroup',
        and: [
            {
                attribute: 'bar',
                contains: [ 'fluffy' ]
            },
            {
                attribute: 'baz',
                in: [4, 34], // splitted value
                nin: [8989, 565] // combined values
            }
        ],
        not: [],
        or: [
            {
                attribute: 'foo',
                eq: 1 // parsed type
            },
            {
                attribute: 'foo',
                neq: 3 // parsed type
            }
        ]
    });

});


});