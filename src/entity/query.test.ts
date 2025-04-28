import { describe, expect, it } from '@jest/globals';
import { parseEntityAttributePaths, parseUrlQueryStringParameters, queryStringParamsToFilterGroup, makeParenthesesGroup, attributeFilterToExpression, entityFilterToExpression, filterGroupToExpression, makeFilterGroupForSearchKeywords, addFilterGroupToEntityFilterCriteria } from './query';

import { entityFilterToFilterGroup } from './query';
import { EntityFilter } from './query-types';


describe('query-test', () => {

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
                    { attribute: 'name', equalTo: 'John' },
                    { attribute: 'age', greaterThan: 18 }
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
            const filter: EntityFilter<any> = {
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
                or: [
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
                    { attribute: 'name', equalTo: 'John' },
                    { attribute: 'age', greaterThan: 18, lessThan: 60 }
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

    describe('parseEntityAttributePaths', () => {
        it('should transform array to nested object', () => {
            const array = [ 'name', 'groupId', 'admin', 'admin.firstName', 'admin.lastName', 'admin.tenant', 'admin.tenant.firstName', 'admin.tenant.lastName' ];

            const result = parseEntityAttributePaths(array);

            const expected = {
                name: true,
                groupId: true,
                admin: {
                    attributes: {
                        firstName: true,
                        lastName: true,
                        tenant: {
                            attributes: {
                                firstName: true,
                                lastName: true,
                            }
                        },
                    }
                },
            };

            expect(result).toEqual(expected);
        });
    });


    describe('parseUrlQueryStringParameters', () => {

        it('should parse simple query string params successfully', () => {
            const parsed = parseUrlQueryStringParameters({
                "foo[eq]": "1",
                "foo.neq": "3",
                "bar[contains]": "fluffy",
                "baz[in]": "4,34&343+787",
            });

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
                "or[][foo][eq]": "1",
                "or[].foo.neq": "3",
                "and[].bar[contains]": "fluffy",
                "and[].baz[in]": "4,34",
            });

            expect(parsed).toEqual({
                or: [ {
                    foo: {
                        eq: '1',
                        neq: '3'
                    }
                } ],
                and: [ {
                    bar: { contains: 'fluffy' },
                    baz: { in: '4,34' }
                } ]
            });

            const etQ = queryStringParamsToFilterGroup(parsed);

            expect(etQ).toEqual({
                filterId: 'queryStringParamsToFilterGroup',
                and: [ {
                    attribute: 'bar',
                    contains: [ 'fluffy' ]
                },
                {
                    attribute: 'baz',
                    in: [ 4, 34 ]
                } ],
                not: [],
                or: [ {
                    attribute: 'foo',
                    eq: 1,
                    neq: 3
                } ]
            });

        });

        it('should parse query strings with and/or groups and [split/combine/parse] values successfully', () => {

            const parsed = parseUrlQueryStringParameters({
                "or.0.foo.eq": "1",
                "or.1.foo.neq": "3",
                "and.0.bar[contains]": "fluffy",
                "and.1.baz[in]": "4,34",
                "and.1.baz.nin": "8989",
                "and.1.baz[nin]": "565",
            });

            expect(parsed).toEqual({
                or: [
                    { foo: { "eq": "1" } },
                    { foo: { "neq": "3" } }
                ],
                and: [ {
                    bar: { contains: "fluffy" }
                },
                {
                    baz: {
                        in: "4,34",
                        nin: [ "8989", "565" ]
                    }
                } ]
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
                        in: [ 4, 34 ], // splitted value
                        nin: [ 8989, 565 ] // combined values
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

    describe('makeParenthesesGroup', () => {
        it('should wrap multiple items with delimiter', () => {
            expect(makeParenthesesGroup([ 'a', 'b', 'c' ], 'or')).toEqual('( a OR b OR c )');
        });

        it('should not wrap single item', () => {
            expect(makeParenthesesGroup([ 'single' ], 'and')).toEqual('single');
        });
    });

    describe('attributeFilterToExpression', () => {
        it('should combine multiple filters with default and', () => {
            const filter = { attribute: 'age', eq: 30, gt: 20 } as any;
            const attributes = { age: 'ageRef' } as any;
            const operations = {
                eq: (attr: string, val: any) => `${attr}==${val}`,
                gt: (attr: string, val: any) => `${attr}>${val}`,
            } as any;
            const exp = attributeFilterToExpression(filter, attributes, operations);
            expect(exp).toEqual('( ageRef==30 AND ageRef>20 )');
        });
    });

    describe('entityFilterToExpression', () => {
        it('should convert entity filter to expression string', () => {
            const filter: EntityFilter<any> = { name: { eq: 'Alice' }, age: { gt: 30 } };
            const attributes = { name: 'nameRef', age: 'ageRef' } as any;
            const operations = {
                eq: (attr: string, val: any) => `${attr}=${val}`,
                gt: (attr: string, val: any) => `${attr}>${val}`,
            } as any;
            const exp = entityFilterToExpression(filter, attributes, operations);
            expect(exp).toEqual('( nameRef=Alice AND ageRef>30 )');
        });
    });

    describe('makeFilterGroupForSearchKeywords', () => {
        it('should create OR filter group for keywords', () => {
            const keywords = [ 'foo', 'bar' ];
            const attrs = [ 'name', 'desc' ];
            const fg = makeFilterGroupForSearchKeywords(keywords, attrs);
            expect(fg.filterId).toBe('keywordSearchFilterGroup');
            expect(fg.or).toEqual([
                { attribute: 'name', contains: [ 'foo', 'bar' ] },
                { attribute: 'desc', contains: [ 'foo', 'bar' ] },
            ]);
        });
    });

    describe('filterGroupToExpression', () => {
        it('should convert simple OR group to expression', () => {
            const group = { or: [ { attribute: 'foo', eq: '1' }, { attribute: 'bar', lt: '5' } ] } as any;
            const attributes = { foo: 'fooRef', bar: 'barRef' } as any;
            const operations = {
                eq: (attr: string, val: any) => `${attr}=${val}`,
                lt: (attr: string, val: any) => `${attr}<${val}`,
            } as any;
            const exp = filterGroupToExpression(group, attributes, operations);
            expect(exp).toEqual('( fooRef=1 OR barRef<5 )');
        });

        it('should convert simple AND group to expression', () => {
            const group = { and: [ { attribute: 'foo', eq: 2 }, { attribute: 'bar', eq: 3 } ] } as any;
            const attributes = { foo: 'fooRef', bar: 'barRef' } as any;
            const operations = {
                eq: (attr: string, val: any) => `${attr}:${val}`,
            } as any;
            const exp = filterGroupToExpression(group, attributes, operations);
            expect(exp).toEqual('( fooRef:2 AND barRef:3 )');
        });

        it('should return undefined for empty group', () => {
            const group = {} as any;
            const exp = filterGroupToExpression(group, {} as any, {} as any);
            expect(exp).toBeUndefined();
        });
    });
});