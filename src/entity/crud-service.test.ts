import { EntitySchema } from './base-entity';
import { findMatchingIndex, filterGroupToSimpleFormat, extractIndexFilterValues, InvalidIndexFilterError } from './crud-service';
import { Entity } from 'electrodb';

describe('extractIndexFilterValues', () => {
    describe('valid inputs', () => {
        it('should return empty object for null/undefined', () => {
            expect(extractIndexFilterValues(null as any)).toEqual({});
            expect(extractIndexFilterValues(undefined)).toEqual({});
        });

        it('should pass through direct values unchanged', () => {
            expect(extractIndexFilterValues({ teamId: 'team-123' })).toEqual({ teamId: 'team-123' });
            expect(extractIndexFilterValues({ count: 42 })).toEqual({ count: 42 });
            expect(extractIndexFilterValues({ active: true })).toEqual({ active: true });
        });

        it('should extract eq values from filter syntax', () => {
            expect(extractIndexFilterValues({
                teamId: { eq: 'team-123' },
                status: { eq: 'active' }
            })).toEqual({
                teamId: 'team-123',
                status: 'active'
            });
        });

        it('should handle mixed direct values and filter syntax', () => {
            expect(extractIndexFilterValues({
                teamId: 'team-123',
                status: { eq: 'active' },
                platform: 'twitter'
            })).toEqual({
                teamId: 'team-123',
                status: 'active',
                platform: 'twitter'
            });
        });

        it('should skip null and undefined values', () => {
            expect(extractIndexFilterValues({
                teamId: 'team-123',
                status: null,
                platform: undefined
            })).toEqual({
                teamId: 'team-123'
            });
        });

        it('should skip empty objects', () => {
            expect(extractIndexFilterValues({
                teamId: 'team-123',
                empty: {}
            })).toEqual({
                teamId: 'team-123'
            });
        });

        it('should handle boolean and numeric eq values', () => {
            expect(extractIndexFilterValues({
                isActive: { eq: true },
                count: { eq: 42 },
                ratio: { eq: 0.5 }
            })).toEqual({
                isActive: true,
                count: 42,
                ratio: 0.5
            });
        });

        it('should handle array eq values', () => {
            expect(extractIndexFilterValues({
                tags: { eq: [ 'a', 'b', 'c' ] }
            })).toEqual({
                tags: [ 'a', 'b', 'c' ]
            });
        });
    });

    describe('invalid inputs - should throw InvalidIndexFilterError', () => {
        it('should throw for gt operator', () => {
            expect(() => extractIndexFilterValues({
                createdAt: { gt: '2024-01-01' }
            })).toThrow(InvalidIndexFilterError);

            expect(() => extractIndexFilterValues({
                createdAt: { gt: '2024-01-01' }
            })).toThrow(/Invalid filter operator.*gt.*createdAt/);
        });

        it('should throw for gte operator', () => {
            expect(() => extractIndexFilterValues({
                count: { gte: 10 }
            })).toThrow(InvalidIndexFilterError);
        });

        it('should throw for lt operator', () => {
            expect(() => extractIndexFilterValues({
                date: { lt: '2024-12-31' }
            })).toThrow(InvalidIndexFilterError);
        });

        it('should throw for lte operator', () => {
            expect(() => extractIndexFilterValues({
                score: { lte: 100 }
            })).toThrow(InvalidIndexFilterError);
        });

        it('should throw for between operator', () => {
            expect(() => extractIndexFilterValues({
                range: { between: [ 'a', 'z' ] }
            })).toThrow(InvalidIndexFilterError);
        });

        it('should throw for begins operator', () => {
            expect(() => extractIndexFilterValues({
                code: { begins: 'PREFIX' }
            })).toThrow(InvalidIndexFilterError);
        });

        it('should throw for contains operator', () => {
            expect(() => extractIndexFilterValues({
                name: { contains: 'test' }
            })).toThrow(InvalidIndexFilterError);
        });

        it('should throw for multiple range operators', () => {
            expect(() => extractIndexFilterValues({
                count: { gte: 10, lte: 100 }
            })).toThrow(InvalidIndexFilterError);
        });

        it('should throw for mixed eq and other operators', () => {
            expect(() => extractIndexFilterValues({
                value: { eq: 'test', gt: 'a' }
            })).toThrow(InvalidIndexFilterError);
        });

        it('should include index name in error message when provided', () => {
            expect(() => extractIndexFilterValues({
                createdAt: { gt: '2024-01-01' }
            }, 'byTeam')).toThrow(/for index "byTeam"/);
        });

        it('should provide helpful error message with details', () => {
            try {
                extractIndexFilterValues({ score: { gte: 10 } }, 'byScore');
                fail('Should have thrown');
            } catch (e) {
                expect(e).toBeInstanceOf(InvalidIndexFilterError);
                const error = e as InvalidIndexFilterError;
                expect(error.attributeName).toBe('score');
                expect(error.invalidOperators).toEqual([ 'gte' ]);
                expect(error.indexName).toBe('byScore');
                expect(error.message).toContain('top-level');
                expect(error.message).toContain('filters');
            }
        });

        it('should throw even if some fields are valid eq', () => {
            // The function should throw when it encounters an invalid operator
            expect(() => extractIndexFilterValues({
                teamId: { eq: 'team-123' },
                createdAt: { gt: '2024-01-01' }
            })).toThrow(InvalidIndexFilterError);
        });
    });
});

describe('filterGroupToSimpleFormat', () => {
    describe('passthrough for non-FilterGroup formats', () => {
        it('should return empty object for null/undefined', () => {
            expect(filterGroupToSimpleFormat(null as any)).toEqual({});
            expect(filterGroupToSimpleFormat(undefined as any)).toEqual({});
        });

        it('should pass through simple format unchanged', () => {
            const simple = { status: { eq: 'active' }, type: { eq: 'user' } };
            expect(filterGroupToSimpleFormat(simple)).toEqual(simple);
        });

        it('should pass through direct value filters', () => {
            const filters = { status: 'active', type: 'user' };
            expect(filterGroupToSimpleFormat(filters)).toEqual(filters);
        });
    });

    describe('FilterGroup to simple format conversion', () => {
        it('should convert single filter in and array', () => {
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [ { attribute: 'parentObservabilityLogId', eq: '85b7eaad-72cd-412d-8fbb-b9537b3413d5' } ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                parentObservabilityLogId: { eq: '85b7eaad-72cd-412d-8fbb-b9537b3413d5' }
            });
        });

        it('should convert multiple filters in and array', () => {
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    { attribute: 'status', eq: 'active' },
                    { attribute: 'type', eq: 'span.start' },
                    { attribute: 'level', eq: 'error' }
                ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                status: { eq: 'active' },
                type: { eq: 'span.start' },
                level: { eq: 'error' }
            });
        });

        it('should handle multiple operators on same attribute', () => {
            const filterGroup = {
                and: [
                    { attribute: 'timestamp', gte: 1000, lte: 2000 }
                ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                timestamp: { gte: 1000, lte: 2000 }
            });
        });

        it('should handle various filter operators', () => {
            const filterGroup = {
                and: [
                    { attribute: 'name', contains: 'test' },
                    { attribute: 'count', gt: 10 },
                    { attribute: 'status', neq: 'deleted' },
                    { attribute: 'tags', in: [ 'a', 'b', 'c' ] }
                ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                name: { contains: 'test' },
                count: { gt: 10 },
                status: { neq: 'deleted' },
                tags: { in: [ 'a', 'b', 'c' ] }
            });
        });

        it('should exclude exists/notExists operators from index matching', () => {
            // Existence operators should be excluded because records with missing
            // attributes won't be in sparse GSIs where that attribute is the PK
            const filterGroup = {
                and: [
                    { attribute: 'parentId', notExists: true },
                    { attribute: 'metadata', exists: true },
                    { attribute: 'status', eq: 'active' }  // This should be included
                ],
                or: [],
                not: []
            };

            // Only 'status' with 'eq' should be in the result
            // 'parentId' and 'metadata' with existence operators should be excluded
            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                status: { eq: 'active' }
            });
        });

        it('should exclude all existence-related operators from index matching', () => {
            const filterGroup = {
                and: [
                    { attribute: 'field1', notExists: true },
                    { attribute: 'field2', exists: true },
                    { attribute: 'field3', isNull: true },
                    { attribute: 'field4', notNull: true },
                    { attribute: 'field5', empty: true },
                    { attribute: 'field6', notEmpty: true },
                    { attribute: 'field7', eq: 'value' }  // This should be included
                ],
                or: [],
                not: []
            };

            // Only field7 with eq should be in the result
            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                field7: { eq: 'value' }
            });
        });

        it('should handle between operator', () => {
            const filterGroup = {
                and: [
                    { attribute: 'createdAt', bt: [ '2024-01-01', '2024-12-31' ] }
                ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                createdAt: { bt: [ '2024-01-01', '2024-12-31' ] }
            });
        });

        it('should handle empty and array', () => {
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({});
        });

        it('should ignore items without attribute property', () => {
            const filterGroup = {
                and: [
                    { attribute: 'status', eq: 'active' },
                    { foo: 'bar' }, // no attribute - should be ignored
                    { attribute: 'type', eq: 'user' }
                ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                status: { eq: 'active' },
                type: { eq: 'user' }
            });
        });

        it('should ignore items with attribute but no operators', () => {
            const filterGroup = {
                and: [
                    { attribute: 'status' }, // no operators
                    { attribute: 'type', eq: 'user' }
                ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                type: { eq: 'user' }
            });
        });

        it('should handle nested path attributes', () => {
            const filterGroup = {
                and: [
                    { attribute: 'user.profile.status', eq: 'active' },
                    { attribute: 'metadata.tags', contains: 'important' }
                ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                'user.profile.status': { eq: 'active' },
                'metadata.tags': { contains: 'important' }
            });
        });
    });

    describe('edge cases', () => {
        it('should handle FilterGroup with only "and" key (minimal format)', () => {
            const filterGroup = {
                and: [ { attribute: 'status', eq: 'active' } ]
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                status: { eq: 'active' }
            });
        });

        it('should handle boolean values', () => {
            const filterGroup = {
                and: [
                    { attribute: 'isActive', eq: true },
                    { attribute: 'isDeleted', eq: false }
                ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                isActive: { eq: true },
                isDeleted: { eq: false }
            });
        });

        it('should handle numeric values', () => {
            const filterGroup = {
                and: [
                    { attribute: 'count', eq: 0 },
                    { attribute: 'price', gte: 100.50 }
                ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                count: { eq: 0 },
                price: { gte: 100.50 }
            });
        });

        it('should handle null/undefined filter values', () => {
            const filterGroup = {
                and: [
                    { attribute: 'deletedAt', eq: null }
                ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                deletedAt: { eq: null }
            });
        });

        it('should handle array filter values', () => {
            const filterGroup = {
                and: [
                    { attribute: 'status', in: [ 'active', 'pending', 'processing' ] }
                ],
                or: [],
                not: []
            };

            expect(filterGroupToSimpleFormat(filterGroup)).toEqual({
                status: { in: [ 'active', 'pending', 'processing' ] }
            });
        });
    });
});

describe('findMatchingIndex', () => {
    let entityService: any;
    let repository: any;

    beforeEach(() => {
        // Create a real ElectroDB entity with our schema
        const TestEntity = new Entity({
            model: {
                entity: "testEntity",
                version: "1",
                service: "test"
            },
            attributes: {
                id: {
                    type: "string",
                    required: true
                },
                status: {
                    type: "string",
                    required: true
                },
                type: {
                    type: "string",
                    required: true
                },
                name: {
                    type: "string",
                    required: true
                }
            },
            indexes: {
                primary: {
                    pk: {
                        field: "pk",
                        composite: [ "id" ]
                    },
                    sk: {
                        field: "sk",
                        composite: []
                    }
                },
                byStatus: {
                    index: "gsi1",
                    pk: {
                        field: "gsi1pk",
                        composite: [ "status" ]
                    },
                    sk: {
                        field: "gsi1sk",
                        composite: []
                    }
                },
                byStatusAndType: {
                    index: "gsi2",
                    pk: {
                        field: "gsi2pk",
                        composite: [ "status" ]
                    },
                    sk: {
                        field: "gsi2sk",
                        composite: [ "type" ]
                    }
                },
                byTemplate: {
                    index: "gsi3",
                    pk: {
                        field: "gsi3pk",
                        composite: [],
                        template: "testEntity"
                    },
                    sk: {
                        field: "gsi3sk",
                        composite: []
                    }
                }
            }
        });

        repository = TestEntity;
        entityService = {
            getRepository: () => repository
        };
    });

    it('should return template match when no filters provided', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                },
                byTemplate: {
                    index: 'gsi3',
                    pk: { composite: [], template: 'testEntity' },
                    sk: { composite: [] }
                }
            }
        } as any;

        const result = findMatchingIndex(schema, undefined, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byTemplate',
            indexFilters: {}
        });
    });

    it('should use index when filters match index attributes', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                },
                byStatusAndType: {
                    index: 'gsi2',
                    pk: { composite: [ 'status' ] },
                    sk: { composite: [ 'type' ] }
                }
            }
        } as any;

        const filters = {
            status: { eq: 'active' },
            type: { eq: 'user' }
        };

        const result = findMatchingIndex(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byStatusAndType',
            indexFilters: {
                status: 'active',
                type: 'user'
            }
        });
    });

    it('should handle direct value filters', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                },
                byStatusAndType: {
                    index: 'gsi2',
                    pk: { composite: [ 'status' ] },
                    sk: { composite: [ 'type' ] }
                }
            }
        } as any;

        const filters = {
            status: 'active',
            type: 'user'
        };

        const result = findMatchingIndex(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byStatusAndType',
            indexFilters: {
                status: 'active',
                type: 'user'
            }
        });
    });

    it('should return template match when no index matches and template exists', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                },
                byTemplate: {
                    index: 'gsi3',
                    pk: { composite: [], template: 'testEntity' },
                    sk: { composite: [] }
                }
            }
        } as any;

        const filters = {
            randomField: 'value'
        };

        const result = findMatchingIndex(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byTemplate',
            indexFilters: {}
        });
    });

    it('should return undefined when no index matches and no template exists', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                }
            }
        } as any;

        const filters = {
            randomField: 'value'
        };

        const result = findMatchingIndex(schema, filters, 'nonExistentEntity', entityService);
        expect(result).toBeUndefined();
    });

    it('should handle partial index matches', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                },
                byStatus: {
                    index: 'gsi1',
                    pk: { composite: [ 'status' ] },
                    sk: { composite: [] }
                }
            }
        } as any;

        const filters = {
            status: 'active',
            randomField: 'value'
        };

        const result = findMatchingIndex(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byStatus',
            indexFilters: {
                status: 'active'
            }
        });
    });

    describe('FilterGroup format support', () => {
        // Shared schema that matches the TestEntity in beforeEach
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: { pk: { composite: [ 'id' ] }, sk: { composite: [] } },
                byStatus: { index: 'gsi1', pk: { composite: [ 'status' ] }, sk: { composite: [] } },
                byStatusAndType: { index: 'gsi2', pk: { composite: [ 'status' ] }, sk: { composite: [ 'type' ] } },
                byTemplate: { index: 'gsi3', pk: { composite: [], template: 'testEntity' }, sk: { composite: [] } }
            }
        } as any;

        it('should match index with FilterGroup format filters', () => {
            const schema: EntitySchema<any, any, any> = {
                indexes: {
                    primary: {
                        pk: { composite: [ 'id' ] },
                        sk: { composite: [] }
                    },
                    byStatus: {
                        index: 'gsi1',
                        pk: { composite: [ 'status' ] },
                        sk: { composite: [] }
                    }
                }
            } as any;

            // This is the format produced by queryStringParamsToFilterGroup
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [ { attribute: 'status', eq: 'active' } ],
                or: [],
                not: []
            };

            const result = findMatchingIndex(schema, filterGroup, 'testEntity', entityService);
            expect(result).toEqual({
                indexName: 'byStatus',
                indexFilters: {
                    status: 'active'
                }
            });
        });

        it('should match composite index with multiple FilterGroup filters', () => {
            const schema: EntitySchema<any, any, any> = {
                indexes: {
                    primary: {
                        pk: { composite: [ 'id' ] },
                        sk: { composite: [] }
                    },
                    byStatusAndType: {
                        index: 'gsi2',
                        pk: { composite: [ 'status' ] },
                        sk: { composite: [ 'type' ] }
                    }
                }
            } as any;

            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    { attribute: 'status', eq: 'active' },
                    { attribute: 'type', eq: 'user' }
                ],
                or: [],
                not: []
            };

            const result = findMatchingIndex(schema, filterGroup, 'testEntity', entityService);
            expect(result).toEqual({
                indexName: 'byStatusAndType',
                indexFilters: {
                    status: 'active',
                    type: 'user'
                }
            });
        });

        it('should handle FilterGroup with non-matching filters (fallback to template)', () => {
            const schema: EntitySchema<any, any, any> = {
                indexes: {
                    primary: {
                        pk: { composite: [ 'id' ] },
                        sk: { composite: [] }
                    },
                    byTemplate: {
                        index: 'gsi3',
                        pk: { composite: [], template: 'testEntity' },
                        sk: { composite: [] }
                    }
                }
            } as any;

            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [ { attribute: 'nonExistentField', eq: 'value' } ],
                or: [],
                not: []
            };

            const result = findMatchingIndex(schema, filterGroup, 'testEntity', entityService);
            expect(result).toEqual({
                indexName: 'byTemplate',
                indexFilters: {}
            });
        });

        it('should handle empty FilterGroup', () => {
            const schema: EntitySchema<any, any, any> = {
                indexes: {
                    primary: {
                        pk: { composite: [ 'id' ] },
                        sk: { composite: [] }
                    },
                    byTemplate: {
                        index: 'gsi3',
                        pk: { composite: [], template: 'testEntity' },
                        sk: { composite: [] }
                    }
                }
            } as any;

            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [],
                or: [],
                not: []
            };

            const result = findMatchingIndex(schema, filterGroup, 'testEntity', entityService);
            expect(result).toEqual({
                indexName: 'byTemplate',
                indexFilters: {}
            });
        });

        it('should handle real-world parentObservabilityLogId filter scenario', () => {
            // Create entity with byParent index like observability logs
            const ObsEntity = new Entity({
                model: {
                    entity: "observabilityLog",
                    version: "1",
                    service: "observability"
                },
                attributes: {
                    observabilityLogId: { type: "string", required: true },
                    parentObservabilityLogId: { type: "string" },
                    correlationId: { type: "string" },
                    timestampMs: { type: "number" }
                },
                indexes: {
                    primary: {
                        pk: { field: "pk", composite: [ "observabilityLogId" ] },
                        sk: { field: "sk", composite: [] }
                    },
                    byParent: {
                        index: "gsi2",
                        pk: { field: "gsi2pk", composite: [ "parentObservabilityLogId" ] },
                        sk: { field: "gsi2sk", composite: [ "timestampMs" ] }
                    },
                    byTrace: {
                        index: "gsi1",
                        pk: { field: "gsi1pk", composite: [ "correlationId" ] },
                        sk: { field: "gsi1sk", composite: [ "timestampMs" ] }
                    }
                }
            });

            const obsEntityService = {
                getRepository: () => ObsEntity
            };

            const schema: EntitySchema<any, any, any> = {
                indexes: {
                    primary: {
                        pk: { composite: [ 'observabilityLogId' ] },
                        sk: { composite: [] }
                    },
                    byParent: {
                        index: 'gsi2',
                        pk: { composite: [ 'parentObservabilityLogId' ] },
                        sk: { composite: [ 'timestampMs' ] }
                    },
                    byTrace: {
                        index: 'gsi1',
                        pk: { composite: [ 'correlationId' ] },
                        sk: { composite: [ 'timestampMs' ] }
                    }
                }
            } as any;

            // This is exactly what the controller receives from query string parsing
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [ {
                    attribute: 'parentObservabilityLogId',
                    eq: '85b7eaad-72cd-412d-8fbb-b9537b3413d5'
                } ],
                or: [],
                not: []
            };

            const result = findMatchingIndex(schema, filterGroup, 'observabilityLog', obsEntityService as any);

            expect(result).toEqual({
                indexName: 'byParent',
                indexFilters: {
                    parentObservabilityLogId: '85b7eaad-72cd-412d-8fbb-b9537b3413d5'
                }
            });
        });

        it('should match correlationId filter to byTrace index', () => {
            const ObsEntity = new Entity({
                model: {
                    entity: "observabilityLog",
                    version: "1",
                    service: "observability"
                },
                attributes: {
                    observabilityLogId: { type: "string", required: true },
                    parentObservabilityLogId: { type: "string" },
                    correlationId: { type: "string" },
                    timestampMs: { type: "number" }
                },
                indexes: {
                    primary: {
                        pk: { field: "pk", composite: [ "observabilityLogId" ] },
                        sk: { field: "sk", composite: [] }
                    },
                    byParent: {
                        index: "gsi2",
                        pk: { field: "gsi2pk", composite: [ "parentObservabilityLogId" ] },
                        sk: { field: "gsi2sk", composite: [ "timestampMs" ] }
                    },
                    byTrace: {
                        index: "gsi1",
                        pk: { field: "gsi1pk", composite: [ "correlationId" ] },
                        sk: { field: "gsi1sk", composite: [ "timestampMs" ] }
                    }
                }
            });

            const obsEntityService = {
                getRepository: () => ObsEntity
            };

            const schema: EntitySchema<any, any, any> = {
                indexes: {
                    primary: {
                        pk: { composite: [ 'observabilityLogId' ] },
                        sk: { composite: [] }
                    },
                    byParent: {
                        index: 'gsi2',
                        pk: { composite: [ 'parentObservabilityLogId' ] },
                        sk: { composite: [ 'timestampMs' ] }
                    },
                    byTrace: {
                        index: 'gsi1',
                        pk: { composite: [ 'correlationId' ] },
                        sk: { composite: [ 'timestampMs' ] }
                    }
                }
            } as any;

            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [ {
                    attribute: 'correlationId',
                    eq: 'trace-123-456'
                } ],
                or: [],
                not: []
            };

            const result = findMatchingIndex(schema, filterGroup, 'observabilityLog', obsEntityService as any);

            expect(result).toEqual({
                indexName: 'byTrace',
                indexFilters: {
                    correlationId: 'trace-123-456'
                }
            });
        });

        it('should select correct index when FilterGroup has multiple GSI-eligible attributes', () => {
            // Real scenario: filter has both correlationId AND parentObservabilityLogId
            // ElectroDB should pick the best matching index
            const ObsEntity = new Entity({
                model: { entity: "observabilityLog", version: "1", service: "obs" },
                attributes: {
                    observabilityLogId: { type: "string", required: true },
                    parentObservabilityLogId: { type: "string" },
                    correlationId: { type: "string" },
                    type: { type: "string" },
                    level: { type: "string" },
                    timestampMs: { type: "number" }
                },
                indexes: {
                    primary: {
                        pk: { field: "pk", composite: [ "observabilityLogId" ] },
                        sk: { field: "sk", composite: [] }
                    },
                    byParent: {
                        index: "gsi2",
                        pk: { field: "gsi2pk", composite: [ "parentObservabilityLogId" ] },
                        sk: { field: "gsi2sk", composite: [ "timestampMs" ] }
                    },
                    byTrace: {
                        index: "gsi1",
                        pk: { field: "gsi1pk", composite: [ "correlationId" ] },
                        sk: { field: "gsi1sk", composite: [ "timestampMs" ] }
                    },
                    byType: {
                        index: "gsi3",
                        pk: { field: "gsi3pk", composite: [ "type" ] },
                        sk: { field: "gsi3sk", composite: [ "timestampMs" ] }
                    }
                }
            });

            const schema: EntitySchema<any, any, any> = {
                indexes: {
                    primary: { pk: { composite: [ 'observabilityLogId' ] }, sk: { composite: [] } },
                    byParent: { index: 'gsi2', pk: { composite: [ 'parentObservabilityLogId' ] }, sk: { composite: [ 'timestampMs' ] } },
                    byTrace: { index: 'gsi1', pk: { composite: [ 'correlationId' ] }, sk: { composite: [ 'timestampMs' ] } },
                    byType: { index: 'gsi3', pk: { composite: [ 'type' ] }, sk: { composite: [ 'timestampMs' ] } }
                }
            } as any;

            // FilterGroup with multiple GSI PK attributes
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    { attribute: 'parentObservabilityLogId', eq: 'parent-123' },
                    { attribute: 'correlationId', eq: 'trace-456' },
                    { attribute: 'level', eq: 'error' }  // Not a GSI PK
                ],
                or: [],
                not: []
            };

            const result = findMatchingIndex(schema, filterGroup, 'observabilityLog', { getRepository: () => ObsEntity } as any);

            // ElectroDB picks one - result should have one of the GSI names
            expect(result).toBeDefined();
            expect([ 'byParent', 'byTrace' ]).toContain(result!.indexName);
            // The selected index's PK value should be in indexFilters
            expect(
                result!.indexFilters.parentObservabilityLogId === 'parent-123' ||
                result!.indexFilters.correlationId === 'trace-456'
            ).toBe(true);
        });

        it('should handle FilterGroup with AND + OR + NOT and select index from AND only', () => {
            // OR and NOT conditions can't be used for GSI PK selection
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    { attribute: 'status', eq: 'active' }
                ],
                or: [
                    { attribute: 'type', eq: 'span.start' },
                    { attribute: 'type', eq: 'span' }
                ],
                not: [
                    { attribute: 'name', eq: 'internal' }
                ]
            };

            const result = findMatchingIndex(schema as any, filterGroup, 'testEntity', entityService);

            // Should use byStatus index from the AND condition
            expect(result).toEqual({
                indexName: 'byStatus',
                indexFilters: {
                    status: 'active'
                }
            });
        });

        it('should fallback to template when FilterGroup AND has no GSI-matching attributes', () => {
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    { attribute: 'randomField', eq: 'someValue' },
                    { attribute: 'anotherField', contains: 'text' }
                ],
                or: [],
                not: []
            };

            const result = findMatchingIndex(schema as any, filterGroup, 'testEntity', entityService);

            // No GSI match, falls back to template
            expect(result).toEqual({
                indexName: 'byTemplate',
                indexFilters: {}
            });
        });

        it('should return undefined when FilterGroup AND is empty and no template exists', () => {
            const schemaNoTemplate: EntitySchema<any, any, any> = {
                indexes: {
                    primary: { pk: { composite: [ 'id' ] }, sk: { composite: [] } },
                    byStatus: { index: 'gsi1', pk: { composite: [ 'status' ] }, sk: { composite: [] } }
                }
            } as any;

            const filterGroup = {
                and: [],
                or: [ { attribute: 'status', eq: 'active' } ],  // OR can't be used for GSI
                not: []
            };

            const result = findMatchingIndex(schemaNoTemplate, filterGroup, 'nonExistentEntity', entityService);

            expect(result).toBeUndefined();
        });

        it('should handle composite GSI (PK + SK) with FilterGroup format', () => {
            // byStatusAndType has PK=status, SK=type
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    { attribute: 'status', eq: 'active' },
                    { attribute: 'type', eq: 'user' }
                ],
                or: [],
                not: []
            };

            const result = findMatchingIndex(schema, filterGroup, 'testEntity', entityService);

            // Should match composite index with both PK and SK
            expect(result).toEqual({
                indexName: 'byStatusAndType',
                indexFilters: {
                    status: 'active',
                    type: 'user'
                }
            });
        });

        it('should handle FilterGroup with only PK match on composite GSI', () => {
            // byStatusAndType has PK=status, SK=type - only providing status
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    { attribute: 'status', eq: 'active' }
                    // No type filter
                ],
                or: [],
                not: []
            };

            const result = findMatchingIndex(schema, filterGroup, 'testEntity', entityService);

            // Should still match an index with status as PK
            expect(result).toBeDefined();
            expect(result!.indexFilters.status).toBe('active');
        });
    });
}); 