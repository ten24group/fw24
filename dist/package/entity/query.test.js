"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const query_1 = require("./query");
const query_2 = require("./query");
(0, globals_1.describe)('query-test', () => {
    (0, globals_1.describe)('entityFilterToFilterGroup', () => {
        (0, globals_1.it)('should convert entity filter to filter group', () => {
            const filter = {
                name: {
                    equalTo: 'John'
                },
                age: {
                    greaterThan: 18
                }
            };
            const result = (0, query_2.entityFilterToFilterGroup)(filter);
            (0, globals_1.expect)(result).toEqual({
                and: [
                    { attribute: 'name', equalTo: 'John' },
                    { attribute: 'age', greaterThan: 18 }
                ]
            });
        });
        (0, globals_1.it)('should set id and label', () => {
            const filter = {
                filterId: 'myFilter',
                filterLabel: 'myFilter',
                name: {
                    equalTo: 'John'
                }
            };
            const result = (0, query_2.entityFilterToFilterGroup)(filter);
            (0, globals_1.expect)(result.filterId).toBe('myFilter');
            (0, globals_1.expect)(result.filterLabel).toBe('myFilter');
        });
        (0, globals_1.it)('should handle custom logical operator', () => {
            const filter = {
                logicalOp: 'or',
                name: {
                    equalTo: 'John'
                },
                age: {
                    greaterThan: 18
                }
            };
            const result = (0, query_2.entityFilterToFilterGroup)(filter);
            (0, globals_1.expect)(result).toEqual({
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
        (0, globals_1.it)('should handle missing logicalOp', () => {
            const filter = {
                name: {
                    equalTo: 'John'
                }
            };
            const result = (0, query_2.entityFilterToFilterGroup)(filter);
            (0, globals_1.expect)(result.and).toBeDefined(); // default
        });
        (0, globals_1.it)('should handle multiple filter criteria', () => {
            const filter = {
                name: {
                    equalTo: 'John'
                },
                age: {
                    greaterThan: 18,
                    lessThan: 60
                }
            };
            const result = (0, query_2.entityFilterToFilterGroup)(filter);
            (0, globals_1.expect)(result).toEqual({
                id: undefined,
                label: undefined,
                and: [
                    { attribute: 'name', equalTo: 'John' },
                    { attribute: 'age', greaterThan: 18, lessThan: 60 }
                ]
            });
        });
        (0, globals_1.it)('should throw error for invalid filter shape', () => {
            const filter = {
                name: 'John' // invalid shape
            };
            (0, globals_1.expect)(() => {
                (0, query_2.entityFilterToFilterGroup)(filter);
            }).toThrow();
        });
    });
    (0, globals_1.describe)('parseEntityAttributePaths', () => {
        (0, globals_1.it)('should transform array to nested object', () => {
            const array = ['name', 'groupId', 'admin', 'admin.firstName', 'admin.lastName', 'admin.tenant', 'admin.tenant.firstName', 'admin.tenant.lastName'];
            const result = (0, query_1.parseEntityAttributePaths)(array);
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
            (0, globals_1.expect)(result).toEqual(expected);
        });
    });
    (0, globals_1.describe)('parseUrlQueryStringParameters', () => {
        (0, globals_1.it)('should parse simple query string params successfully', () => {
            const parsed = (0, query_1.parseUrlQueryStringParameters)({
                "foo[eq]": "1",
                "foo.neq": "3",
                "bar[contains]": "fluffy",
                "baz[in]": "4,34&343+787",
            });
            (0, globals_1.expect)(parsed).toEqual({
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
            const etQ = (0, query_1.queryStringParamsToFilterGroup)(parsed);
            (0, globals_1.expect)(etQ).toEqual({
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    {
                        attribute: 'foo',
                        eq: 1,
                        neq: 3
                    },
                    {
                        attribute: 'bar',
                        contains: ['fluffy']
                    },
                    {
                        attribute: 'baz',
                        in: [4, 34, 343, 787]
                    }
                ],
                not: [],
                or: []
            });
        });
        (0, globals_1.it)('should parse query strings with and/or groups having ( [] array, and `.` dot ) notation successfully', () => {
            const parsed = (0, query_1.parseUrlQueryStringParameters)({
                "or[][foo][eq]": "1",
                "or[].foo.neq": "3",
                "and[].bar[contains]": "fluffy",
                "and[].baz[in]": "4,34",
            });
            (0, globals_1.expect)(parsed).toEqual({
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
            const etQ = (0, query_1.queryStringParamsToFilterGroup)(parsed);
            (0, globals_1.expect)(etQ).toEqual({
                filterId: 'queryStringParamsToFilterGroup',
                and: [{
                        attribute: 'bar',
                        contains: ['fluffy']
                    },
                    {
                        attribute: 'baz',
                        in: [4, 34]
                    }],
                not: [],
                or: [{
                        attribute: 'foo',
                        eq: 1,
                        neq: 3
                    }]
            });
        });
        (0, globals_1.it)('should parse query strings with and/or groups and [split/combine/parse] values successfully', () => {
            const parsed = (0, query_1.parseUrlQueryStringParameters)({
                "or.0.foo.eq": "1",
                "or.1.foo.neq": "3",
                "and.0.bar[contains]": "fluffy",
                "and.1.baz[in]": "4,34",
                "and.1.baz.nin": "8989",
                "and.1.baz[nin]": "565",
            });
            (0, globals_1.expect)(parsed).toEqual({
                or: [
                    { foo: { "eq": "1" } },
                    { foo: { "neq": "3" } }
                ],
                and: [{
                        bar: { contains: "fluffy" }
                    },
                    {
                        baz: {
                            in: "4,34",
                            nin: ["8989", "565"]
                        }
                    }]
            });
            const etQ = (0, query_1.queryStringParamsToFilterGroup)(parsed);
            (0, globals_1.expect)(etQ).toEqual({
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    {
                        attribute: 'bar',
                        contains: ['fluffy']
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
        (0, globals_1.it)('should handle simple status query parameter correctly', () => {
            const queryParams = { status: 'inactive' };
            const result = (0, query_1.queryStringParamsToFilterGroup)(queryParams);
            (0, globals_1.expect)(result).toEqual({
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    {
                        attribute: 'status',
                        eq: 'inactive'
                    }
                ],
                not: [],
                or: []
            });
        });
    });
    (0, globals_1.describe)('makeParenthesesGroup', () => {
        (0, globals_1.it)('should wrap multiple items with delimiter', () => {
            (0, globals_1.expect)((0, query_1.makeParenthesesGroup)(['a', 'b', 'c'], 'or')).toEqual('( a OR b OR c )');
        });
        (0, globals_1.it)('should not wrap single item', () => {
            (0, globals_1.expect)((0, query_1.makeParenthesesGroup)(['single'], 'and')).toEqual('single');
        });
    });
    (0, globals_1.describe)('attributeFilterToExpression', () => {
        (0, globals_1.it)('should combine multiple filters with default and', () => {
            const filter = { attribute: 'age', eq: 30, gt: 20 };
            const attributes = { age: 'ageRef' };
            const operations = {
                eq: (attr, val) => `${attr}==${val}`,
                gt: (attr, val) => `${attr}>${val}`,
            };
            const exp = (0, query_1.attributeFilterToExpression)(filter, attributes, operations);
            (0, globals_1.expect)(exp).toEqual('( ageRef==30 AND ageRef>20 )');
        });
    });
    (0, globals_1.describe)('entityFilterToExpression', () => {
        (0, globals_1.it)('should convert entity filter to expression string', () => {
            const filter = { name: { eq: 'Alice' }, age: { gt: 30 } };
            const attributes = { name: 'nameRef', age: 'ageRef' };
            const operations = {
                eq: (attr, val) => `${attr}=${val}`,
                gt: (attr, val) => `${attr}>${val}`,
            };
            const exp = (0, query_1.entityFilterToExpression)(filter, attributes, operations);
            (0, globals_1.expect)(exp).toEqual('( nameRef=Alice AND ageRef>30 )');
        });
    });
    (0, globals_1.describe)('makeFilterGroupForSearchKeywords', () => {
        (0, globals_1.it)('should create OR filter group for keywords', () => {
            const keywords = ['foo', 'bar'];
            const attrs = ['name', 'desc'];
            const fg = (0, query_1.makeFilterGroupForSearchKeywords)(keywords, attrs);
            (0, globals_1.expect)(fg.filterId).toBe('keywordSearchFilterGroup');
            (0, globals_1.expect)(fg.or).toEqual([
                { attribute: 'name', contains: ['foo', 'bar'] },
                { attribute: 'desc', contains: ['foo', 'bar'] },
            ]);
        });
    });
    (0, globals_1.describe)('filterGroupToExpression', () => {
        (0, globals_1.it)('should convert simple OR group to expression', () => {
            const group = { or: [{ attribute: 'foo', eq: '1' }, { attribute: 'bar', lt: '5' }] };
            const attributes = { foo: 'fooRef', bar: 'barRef' };
            const operations = {
                eq: (attr, val) => `${attr}=${val}`,
                lt: (attr, val) => `${attr}<${val}`,
            };
            const exp = (0, query_1.filterGroupToExpression)(group, attributes, operations);
            (0, globals_1.expect)(exp).toEqual('( fooRef=1 OR barRef<5 )');
        });
        (0, globals_1.it)('should convert simple AND group to expression', () => {
            const group = { and: [{ attribute: 'foo', eq: 2 }, { attribute: 'bar', eq: 3 }] };
            const attributes = { foo: 'fooRef', bar: 'barRef' };
            const operations = {
                eq: (attr, val) => `${attr}:${val}`,
            };
            const exp = (0, query_1.filterGroupToExpression)(group, attributes, operations);
            (0, globals_1.expect)(exp).toEqual('( fooRef:2 AND barRef:3 )');
        });
        (0, globals_1.it)('should return undefined for empty group', () => {
            const group = {};
            const exp = (0, query_1.filterGroupToExpression)(group, {}, {});
            (0, globals_1.expect)(exp).toBeUndefined();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnRpdHkvcXVlcnkudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDJDQUFxRDtBQUNyRCxtQ0FBMlA7QUFFM1AsbUNBQW9EO0FBR3BELElBQUEsa0JBQVEsRUFBQyxZQUFZLEVBQUUsR0FBRyxFQUFFO0lBQ3hCLElBQUEsa0JBQVEsRUFBQywyQkFBMkIsRUFBRSxHQUFHLEVBQUU7UUFFdkMsSUFBQSxZQUFFLEVBQUMsOENBQThDLEVBQUUsR0FBRyxFQUFFO1lBQ3BELE1BQU0sTUFBTSxHQUFHO2dCQUNYLElBQUksRUFBRTtvQkFDRixPQUFPLEVBQUUsTUFBTTtpQkFDbEI7Z0JBQ0QsR0FBRyxFQUFFO29CQUNELFdBQVcsRUFBRSxFQUFFO2lCQUNsQjthQUNKLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxJQUFBLGlDQUF5QixFQUFDLE1BQU0sQ0FBQyxDQUFDO1lBRWpELElBQUEsZ0JBQU0sRUFBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUM7Z0JBQ25CLEdBQUcsRUFBRTtvQkFDRCxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRTtvQkFDdEMsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxFQUFFLEVBQUU7aUJBQ3hDO2FBQ0osQ0FBQyxDQUFDO1FBQ1AsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyx5QkFBeUIsRUFBRSxHQUFHLEVBQUU7WUFDL0IsTUFBTSxNQUFNLEdBQUc7Z0JBQ1gsUUFBUSxFQUFFLFVBQVU7Z0JBQ3BCLFdBQVcsRUFBRSxVQUFVO2dCQUN2QixJQUFJLEVBQUU7b0JBQ0YsT0FBTyxFQUFFLE1BQU07aUJBQ2xCO2FBQ0osQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLElBQUEsaUNBQXlCLEVBQUMsTUFBTSxDQUFDLENBQUM7WUFFakQsSUFBQSxnQkFB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UUFDckQsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyx5Q0FBeUMsRUFBRSxHQUFHLEVBQUU7WUFDL0MsTUFBTSxLQUFLLEdBQUcsRUFBUyxDQUFDO1lBQ3hCLE1BQU0sR0FBRyxHQUFHLElBQUEsK0JBQXVCLEVBQUMsS0FBSyxFQUFFLEVBQVMsRUFBRSxFQUFTLENBQUMsQ0FBQztZQUNqRSxJQUFBLGdCQUFNLEVBQUMsR0FBRyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDaEMsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZGVzY3JpYmUsIGV4cGVjdCwgaXQgfSBmcm9tICdAamVzdC9nbG9iYWxzJztcbmltcG9ydCB7IHBhcnNlRW50aXR5QXR0cmlidXRlUGF0aHMsIHBhcnNlVXJsUXVlcnlTdHJpbmdQYXJhbWV0ZXJzLCBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAsIG1ha2VQYXJlbnRoZXNlc0dyb3VwLCBhdHRyaWJ1dGVGaWx0ZXJUb0V4cHJlc3Npb24sIGVudGl0eUZpbHRlclRvRXhwcmVzc2lvbiwgZmlsdGVyR3JvdXBUb0V4cHJlc3Npb24sIG1ha2VGaWx0ZXJHcm91cEZvclNlYXJjaEtleXdvcmRzIH0gZnJvbSAnLi9xdWVyeSc7XG5cbmltcG9ydCB7IGVudGl0eUZpbHRlclRvRmlsdGVyR3JvdXAgfSBmcm9tICcuL3F1ZXJ5JztcbmltcG9ydCB7IEVudGl0eUZpbHRlciB9IGZyb20gJy4vcXVlcnktdHlwZXMnO1xuXG5kZXNjcmliZSgncXVlcnktdGVzdCcsICgpID0+IHtcbiAgICBkZXNjcmliZSgnZW50aXR5RmlsdGVyVG9GaWx0ZXJHcm91cCcsICgpID0+IHtcblxuICAgICAgICBpdCgnc2hvdWxkIGNvbnZlcnQgZW50aXR5IGZpbHRlciB0byBmaWx0ZXIgZ3JvdXAnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXIgPSB7XG4gICAgICAgICAgICAgICAgbmFtZToge1xuICAgICAgICAgICAgICAgICAgICBlcXVhbFRvOiAnSm9obidcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGFnZToge1xuICAgICAgICAgICAgICAgICAgICBncmVhdGVyVGhhbjogMThcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBlbnRpdHlGaWx0ZXJUb0ZpbHRlckdyb3VwKGZpbHRlcik7XG5cbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ25hbWUnLCBlcXVhbFRvOiAnSm9obicgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdhZ2UnLCBncmVhdGVyVGhhbjogMTggfVxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHNldCBpZCBhbmQgbGFiZWwnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXIgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdteUZpbHRlcicsXG4gICAgICAgICAgICAgICAgZmlsdGVyTGFiZWw6ICdteUZpbHRlcicsXG4gICAgICAgICAgICAgICAgbmFtZToge1xuICAgICAgICAgICAgICAgICAgICBlcXVhbFRvOiAnSm9obidcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBlbnRpdHlGaWx0ZXJUb0ZpbHRlckdyb3VwKGZpbHRlcik7XG5cbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQuZmlsdGVySWQpLnRvQmUoJ215RmlsdGVyJyk7XG4gICAgICAgICAgICBleHBlY3QocmVzdWx0LmZpbHRlckxhYmVsKS50b0JlKCdteUZpbHRlcicpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBjdXN0b20gbG9naWNhbCBvcGVyYXRvcicsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlcjogRW50aXR5RmlsdGVyPGFueT4gPSB7XG4gICAgICAgICAgICAgICAgbG9naWNhbE9wOiAnb3InLFxuICAgICAgICAgICAgICAgIG5hbWU6IHtcbiAgICAgICAgICAgICAgICAgICAgZXF1YWxUbzogJ0pvaG4nXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBhZ2U6IHtcbiAgICAgICAgICAgICAgICAgICAgZ3JlYXRlclRoYW46IDE4XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gZW50aXR5RmlsdGVyVG9GaWx0ZXJHcm91cChmaWx0ZXIpO1xuXG4gICAgICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBpZDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgIGxhYmVsOiB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgb3I6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlOiBcIm5hbWVcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGVxdWFsVG86IFwiSm9oblwiLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGU6IFwiYWdlXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBncmVhdGVyVGhhbjogMTgsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIG1pc3NpbmcgbG9naWNhbE9wJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyID0ge1xuICAgICAgICAgICAgICAgIG5hbWU6IHtcbiAgICAgICAgICAgICAgICAgICAgZXF1YWxUbzogJ0pvaG4nXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gZW50aXR5RmlsdGVyVG9GaWx0ZXJHcm91cChmaWx0ZXIpO1xuXG4gICAgICAgICAgICBleHBlY3QocmVzdWx0LmFuZCkudG9CZURlZmluZWQoKTsgLy8gZGVmYXVsdFxuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBtdWx0aXBsZSBmaWx0ZXIgY3JpdGVyaWEnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXIgPSB7XG4gICAgICAgICAgICAgICAgbmFtZToge1xuICAgICAgICAgICAgICAgICAgICBlcXVhbFRvOiAnSm9obidcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGFnZToge1xuICAgICAgICAgICAgICAgICAgICBncmVhdGVyVGhhbjogMTgsXG4gICAgICAgICAgICAgICAgICAgIGxlc3NUaGFuOiA2MFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGVudGl0eUZpbHRlclRvRmlsdGVyR3JvdXAoZmlsdGVyKTtcblxuICAgICAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgaWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICBsYWJlbDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ25hbWUnLCBlcXVhbFRvOiAnSm9obicgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdhZ2UnLCBncmVhdGVyVGhhbjogMTgsIGxlc3NUaGFuOiA2MCB9XG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgdGhyb3cgZXJyb3IgZm9yIGludmFsaWQgZmlsdGVyIHNoYXBlJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyID0ge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdKb2huJyAvLyBpbnZhbGlkIHNoYXBlXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBleHBlY3QoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGVudGl0eUZpbHRlclRvRmlsdGVyR3JvdXAoZmlsdGVyKTtcbiAgICAgICAgICAgIH0pLnRvVGhyb3coKTtcbiAgICAgICAgfSk7XG5cblxuICAgIH0pO1xuICAgIGRlc2NyaWJlKCdwYXJzZUVudGl0eUF0dHJpYnV0ZVBhdGhzJywgKCkgPT4ge1xuICAgICAgICBpdCgnc2hvdWxkIHRyYW5zZm9ybSBhcnJheSB0byBuZXN0ZWQgb2JqZWN0JywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgYXJyYXkgPSBbICduYW1lJywgJ2dyb3VwSWQnLCAnYWRtaW4nLCAnYWRtaW4uZmlyc3ROYW1lJywgJ2FkbWluLmxhc3ROYW1lJywgJ2FkbWluLnRlbmFudCcsICdhZG1pbi50ZW5hbnQuZmlyc3ROYW1lJywgJ2FkbWluLnRlbmFudC5sYXN0TmFtZScgXTtcblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gcGFyc2VFbnRpdHlBdHRyaWJ1dGVQYXRocyhhcnJheSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGV4cGVjdGVkID0ge1xuICAgICAgICAgICAgICAgIG5hbWU6IHRydWUsXG4gICAgICAgICAgICAgICAgZ3JvdXBJZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBhZG1pbjoge1xuICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaXJzdE5hbWU6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBsYXN0TmFtZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbmFudDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZmlyc3ROYW1lOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXN0TmFtZTogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoZXhwZWN0ZWQpO1xuICAgICAgICB9KTtcbiAgICB9KTtcbiAgICBkZXNjcmliZSgncGFyc2VVcmxRdWVyeVN0cmluZ1BhcmFtZXRlcnMnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgcGFyc2Ugc2ltcGxlIHF1ZXJ5IHN0cmluZyBwYXJhbXMgc3VjY2Vzc2Z1bGx5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VVcmxRdWVyeVN0cmluZ1BhcmFtZXRlcnMoe1xuICAgICAgICAgICAgICAgIFwiZm9vW2VxXVwiOiBcIjFcIixcbiAgICAgICAgICAgICAgICBcImZvby5uZXFcIjogXCIzXCIsXG4gICAgICAgICAgICAgICAgXCJiYXJbY29udGFpbnNdXCI6IFwiZmx1ZmZ5XCIsXG4gICAgICAgICAgICAgICAgXCJiYXpbaW5dXCI6IFwiNCwzNCYzNDMrNzg3XCIsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgZXhwZWN0KHBhcnNlZCkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgZm9vOiB7XG4gICAgICAgICAgICAgICAgICAgIGVxOiAnMScsXG4gICAgICAgICAgICAgICAgICAgIG5lcTogJzMnXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBiYXI6IHtcbiAgICAgICAgICAgICAgICAgICAgY29udGFpbnM6ICdmbHVmZnknXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBiYXo6IHtcbiAgICAgICAgICAgICAgICAgICAgaW46ICc0LDM0JjM0Mys3ODcnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGV0USA9IHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cChwYXJzZWQpO1xuXG4gICAgICAgICAgICBleHBlY3QoZXRRKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJJZDogJ3F1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCcsXG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZTogJ2ZvbycsXG4gICAgICAgICAgICAgICAgICAgICAgICBlcTogMSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG5lcTogM1xuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGU6ICdiYXInLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGFpbnM6IFsgJ2ZsdWZmeScgXVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGU6ICdiYXonLFxuICAgICAgICAgICAgICAgICAgICAgICAgaW46IFsgNCwgMzQsIDM0MywgNzg3IF1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgbm90OiBbXSxcbiAgICAgICAgICAgICAgICBvcjogW11cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHBhcnNlIHF1ZXJ5IHN0cmluZ3Mgd2l0aCBhbmQvb3IgZ3JvdXBzIGhhdmluZyAoIFtdIGFycmF5LCBhbmQgYC5gIGRvdCApIG5vdGF0aW9uIHN1Y2Nlc3NmdWxseScsICgpID0+IHtcblxuICAgICAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VVcmxRdWVyeVN0cmluZ1BhcmFtZXRlcnMoe1xuICAgICAgICAgICAgICAgIFwib3JbXVtmb29dW2VxXVwiOiBcIjFcIixcbiAgICAgICAgICAgICAgICBcIm9yW10uZm9vLm5lcVwiOiBcIjNcIixcbiAgICAgICAgICAgICAgICBcImFuZFtdLmJhcltjb250YWluc11cIjogXCJmbHVmZnlcIixcbiAgICAgICAgICAgICAgICBcImFuZFtdLmJheltpbl1cIjogXCI0LDM0XCIsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgZXhwZWN0KHBhcnNlZCkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgb3I6IFsge1xuICAgICAgICAgICAgICAgICAgICBmb286IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVxOiAnMScsXG4gICAgICAgICAgICAgICAgICAgICAgICBuZXE6ICczJ1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBdLFxuICAgICAgICAgICAgICAgIGFuZDogWyB7XG4gICAgICAgICAgICAgICAgICAgIGJhcjogeyBjb250YWluczogJ2ZsdWZmeScgfSxcbiAgICAgICAgICAgICAgICAgICAgYmF6OiB7IGluOiAnNCwzNCcgfVxuICAgICAgICAgICAgICAgIH0gXVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGV0USA9IHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cChwYXJzZWQpO1xuXG4gICAgICAgICAgICBleHBlY3QoZXRRKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJJZDogJ3F1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCcsXG4gICAgICAgICAgICAgICAgYW5kOiBbIHtcbiAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlOiAnYmFyJyxcbiAgICAgICAgICAgICAgICAgICAgY29udGFpbnM6IFsgJ2ZsdWZmeScgXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGU6ICdiYXonLFxuICAgICAgICAgICAgICAgICAgICBpbjogWyA0LCAzNCBdXG4gICAgICAgICAgICAgICAgfSBdLFxuICAgICAgICAgICAgICAgIG5vdDogW10sXG4gICAgICAgICAgICAgICAgb3I6IFsge1xuICAgICAgICAgICAgICAgICAgICBhdHRyaWJ1dGU6ICdmb28nLFxuICAgICAgICAgICAgICAgICAgICBlcTogMSxcbiAgICAgICAgICAgICAgICAgICAgbmVxOiAzXG4gICAgICAgICAgICAgICAgfSBdXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHBhcnNlIHF1ZXJ5IHN0cmluZ3Mgd2l0aCBhbmQvb3IgZ3JvdXBzIGFuZCBbc3BsaXQvY29tYmluZS9wYXJzZV0gdmFsdWVzIHN1Y2Nlc3NmdWxseScsICgpID0+IHtcblxuICAgICAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VVcmxRdWVyeVN0cmluZ1BhcmFtZXRlcnMoe1xuICAgICAgICAgICAgICAgIFwib3IuMC5mb28uZXFcIjogXCIxXCIsXG4gICAgICAgICAgICAgICAgXCJvci4xLmZvby5uZXFcIjogXCIzXCIsXG4gICAgICAgICAgICAgICAgXCJhbmQuMC5iYXJbY29udGFpbnNdXCI6IFwiZmx1ZmZ5XCIsXG4gICAgICAgICAgICAgICAgXCJhbmQuMS5iYXpbaW5dXCI6IFwiNCwzNFwiLFxuICAgICAgICAgICAgICAgIFwiYW5kLjEuYmF6Lm5pblwiOiBcIjg5ODlcIixcbiAgICAgICAgICAgICAgICBcImFuZC4xLmJheltuaW5dXCI6IFwiNTY1XCIsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgZXhwZWN0KHBhcnNlZCkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgb3I6IFtcbiAgICAgICAgICAgICAgICAgICAgeyBmb286IHsgXCJlcVwiOiBcIjFcIiB9IH0sXG4gICAgICAgICAgICAgICAgICAgIHsgZm9vOiB7IFwibmVxXCI6IFwiM1wiIH0gfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgYW5kOiBbIHtcbiAgICAgICAgICAgICAgICAgICAgYmFyOiB7IGNvbnRhaW5zOiBcImZsdWZmeVwiIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgYmF6OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbjogXCI0LDM0XCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBuaW46IFsgXCI4OTg5XCIsIFwiNTY1XCIgXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBdXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgZXRRID0gcXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwKHBhcnNlZCk7XG5cbiAgICAgICAgICAgIGV4cGVjdChldFEpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGZpbHRlcklkOiAncXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwJyxcbiAgICAgICAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlOiAnYmFyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRhaW5zOiBbICdmbHVmZnknIF1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlOiAnYmF6JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGluOiBbIDQsIDM0IF0sIC8vIHNwbGl0dGVkIHZhbHVlXG4gICAgICAgICAgICAgICAgICAgICAgICBuaW46IFsgODk4OSwgNTY1IF0gLy8gY29tYmluZWQgdmFsdWVzXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG5vdDogW10sXG4gICAgICAgICAgICAgICAgb3I6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlOiAnZm9vJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVxOiAxIC8vIHBhcnNlZCB0eXBlXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZTogJ2ZvbycsXG4gICAgICAgICAgICAgICAgICAgICAgICBuZXE6IDMgLy8gcGFyc2VkIHR5cGVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIHNpbXBsZSBzdGF0dXMgcXVlcnkgcGFyYW1ldGVyIGNvcnJlY3RseScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0geyBzdGF0dXM6ICdpbmFjdGl2ZScgfTtcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IHF1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cChxdWVyeVBhcmFtcyk7XG5cbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGZpbHRlcklkOiAncXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwJyxcbiAgICAgICAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlOiAnc3RhdHVzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVxOiAnaW5hY3RpdmUnXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG5vdDogW10sXG4gICAgICAgICAgICAgICAgb3I6IFtdXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdtYWtlUGFyZW50aGVzZXNHcm91cCcsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCB3cmFwIG11bHRpcGxlIGl0ZW1zIHdpdGggZGVsaW1pdGVyJywgKCkgPT4ge1xuICAgICAgICAgICAgZXhwZWN0KG1ha2VQYXJlbnRoZXNlc0dyb3VwKFsgJ2EnLCAnYicsICdjJyBdLCAnb3InKSkudG9FcXVhbCgnKCBhIE9SIGIgT1IgYyApJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgbm90IHdyYXAgc2luZ2xlIGl0ZW0nLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QobWFrZVBhcmVudGhlc2VzR3JvdXAoWyAnc2luZ2xlJyBdLCAnYW5kJykpLnRvRXF1YWwoJ3NpbmdsZScpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdhdHRyaWJ1dGVGaWx0ZXJUb0V4cHJlc3Npb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgY29tYmluZSBtdWx0aXBsZSBmaWx0ZXJzIHdpdGggZGVmYXVsdCBhbmQnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXIgPSB7IGF0dHJpYnV0ZTogJ2FnZScsIGVxOiAzMCwgZ3Q6IDIwIH0gYXMgYW55O1xuICAgICAgICAgICAgY29uc3QgYXR0cmlidXRlcyA9IHsgYWdlOiAnYWdlUmVmJyB9IGFzIGFueTtcbiAgICAgICAgICAgIGNvbnN0IG9wZXJhdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgZXE6IChhdHRyOiBzdHJpbmcsIHZhbDogYW55KSA9PiBgJHthdHRyfT09JHt2YWx9YCxcbiAgICAgICAgICAgICAgICBndDogKGF0dHI6IHN0cmluZywgdmFsOiBhbnkpID0+IGAke2F0dHJ9PiR7dmFsfWAsXG4gICAgICAgICAgICB9IGFzIGFueTtcbiAgICAgICAgICAgIGNvbnN0IGV4cCA9IGF0dHJpYnV0ZUZpbHRlclRvRXhwcmVzc2lvbihmaWx0ZXIsIGF0dHJpYnV0ZXMsIG9wZXJhdGlvbnMpO1xuICAgICAgICAgICAgZXhwZWN0KGV4cCkudG9FcXVhbCgnKCBhZ2VSZWY9PTMwIEFORCBhZ2VSZWY+MjAgKScpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdlbnRpdHlGaWx0ZXJUb0V4cHJlc3Npb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgY29udmVydCBlbnRpdHkgZmlsdGVyIHRvIGV4cHJlc3Npb24gc3RyaW5nJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyOiBFbnRpdHlGaWx0ZXI8YW55PiA9IHsgbmFtZTogeyBlcTogJ0FsaWNlJyB9LCBhZ2U6IHsgZ3Q6IDMwIH0gfTtcbiAgICAgICAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7IG5hbWU6ICduYW1lUmVmJywgYWdlOiAnYWdlUmVmJyB9IGFzIGFueTtcbiAgICAgICAgICAgIGNvbnN0IG9wZXJhdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgZXE6IChhdHRyOiBzdHJpbmcsIHZhbDogYW55KSA9PiBgJHthdHRyfT0ke3ZhbH1gLFxuICAgICAgICAgICAgICAgIGd0OiAoYXR0cjogc3RyaW5nLCB2YWw6IGFueSkgPT4gYCR7YXR0cn0+JHt2YWx9YCxcbiAgICAgICAgICAgIH0gYXMgYW55O1xuICAgICAgICAgICAgY29uc3QgZXhwID0gZW50aXR5RmlsdGVyVG9FeHByZXNzaW9uKGZpbHRlciwgYXR0cmlidXRlcywgb3BlcmF0aW9ucyk7XG4gICAgICAgICAgICBleHBlY3QoZXhwKS50b0VxdWFsKCcoIG5hbWVSZWY9QWxpY2UgQU5EIGFnZVJlZj4zMCApJyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ21ha2VGaWx0ZXJHcm91cEZvclNlYXJjaEtleXdvcmRzJywgKCkgPT4ge1xuICAgICAgICBpdCgnc2hvdWxkIGNyZWF0ZSBPUiBmaWx0ZXIgZ3JvdXAgZm9yIGtleXdvcmRzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3Qga2V5d29yZHMgPSBbICdmb28nLCAnYmFyJyBdO1xuICAgICAgICAgICAgY29uc3QgYXR0cnMgPSBbICduYW1lJywgJ2Rlc2MnIF07XG4gICAgICAgICAgICBjb25zdCBmZyA9IG1ha2VGaWx0ZXJHcm91cEZvclNlYXJjaEtleXdvcmRzKGtleXdvcmRzLCBhdHRycyk7XG4gICAgICAgICAgICBleHBlY3QoZmcuZmlsdGVySWQpLnRvQmUoJ2tleXdvcmRTZWFyY2hGaWx0ZXJHcm91cCcpO1xuICAgICAgICAgICAgZXhwZWN0KGZnLm9yKS50b0VxdWFsKFtcbiAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ25hbWUnLCBjb250YWluczogWyAnZm9vJywgJ2JhcicgXSB9LFxuICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnZGVzYycsIGNvbnRhaW5zOiBbICdmb28nLCAnYmFyJyBdIH0sXG4gICAgICAgICAgICBdKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnZmlsdGVyR3JvdXBUb0V4cHJlc3Npb24nLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgY29udmVydCBzaW1wbGUgT1IgZ3JvdXAgdG8gZXhwcmVzc2lvbicsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGdyb3VwID0geyBvcjogWyB7IGF0dHJpYnV0ZTogJ2ZvbycsIGVxOiAnMScgfSwgeyBhdHRyaWJ1dGU6ICdiYXInLCBsdDogJzUnIH0gXSB9IGFzIGFueTtcbiAgICAgICAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7IGZvbzogJ2Zvb1JlZicsIGJhcjogJ2JhclJlZicgfSBhcyBhbnk7XG4gICAgICAgICAgICBjb25zdCBvcGVyYXRpb25zID0ge1xuICAgICAgICAgICAgICAgIGVxOiAoYXR0cjogc3RyaW5nLCB2YWw6IGFueSkgPT4gYCR7YXR0cn09JHt2YWx9YCxcbiAgICAgICAgICAgICAgICBsdDogKGF0dHI6IHN0cmluZywgdmFsOiBhbnkpID0+IGAke2F0dHJ9PCR7dmFsfWAsXG4gICAgICAgICAgICB9IGFzIGFueTtcbiAgICAgICAgICAgIGNvbnN0IGV4cCA9IGZpbHRlckdyb3VwVG9FeHByZXNzaW9uKGdyb3VwLCBhdHRyaWJ1dGVzLCBvcGVyYXRpb25zKTtcbiAgICAgICAgICAgIGV4cGVjdChleHApLnRvRXF1YWwoJyggZm9vUmVmPTEgT1IgYmFyUmVmPDUgKScpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGNvbnZlcnQgc2ltcGxlIEFORCBncm91cCB0byBleHByZXNzaW9uJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZ3JvdXAgPSB7IGFuZDogWyB7IGF0dHJpYnV0ZTogJ2ZvbycsIGVxOiAyIH0sIHsgYXR0cmlidXRlOiAnYmFyJywgZXE6IDMgfSBdIH0gYXMgYW55O1xuICAgICAgICAgICAgY29uc3QgYXR0cmlidXRlcyA9IHsgZm9vOiAnZm9vUmVmJywgYmFyOiAnYmFyUmVmJyB9IGFzIGFueTtcbiAgICAgICAgICAgIGNvbnN0IG9wZXJhdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgZXE6IChhdHRyOiBzdHJpbmcsIHZhbDogYW55KSA9PiBgJHthdHRyfToke3ZhbH1gLFxuICAgICAgICAgICAgfSBhcyBhbnk7XG4gICAgICAgICAgICBjb25zdCBleHAgPSBmaWx0ZXJHcm91cFRvRXhwcmVzc2lvbihncm91cCwgYXR0cmlidXRlcywgb3BlcmF0aW9ucyk7XG4gICAgICAgICAgICBleHBlY3QoZXhwKS50b0VxdWFsKCcoIGZvb1JlZjoyIEFORCBiYXJSZWY6MyApJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgcmV0dXJuIHVuZGVmaW5lZCBmb3IgZW1wdHkgZ3JvdXAnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBncm91cCA9IHt9IGFzIGFueTtcbiAgICAgICAgICAgIGNvbnN0IGV4cCA9IGZpbHRlckdyb3VwVG9FeHByZXNzaW9uKGdyb3VwLCB7fSBhcyBhbnksIHt9IGFzIGFueSk7XG4gICAgICAgICAgICBleHBlY3QoZXhwKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xufSk7Il19