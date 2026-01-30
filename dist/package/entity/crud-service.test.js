"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crud_service_1 = require("./crud-service");
const electrodb_1 = require("electrodb");
describe('extractIndexFilterValues', () => {
    describe('valid inputs', () => {
        it('should return empty object for null/undefined', () => {
            expect((0, crud_service_1.extractIndexFilterValues)(null)).toEqual({});
            expect((0, crud_service_1.extractIndexFilterValues)(undefined)).toEqual({});
        });
        it('should pass through direct values unchanged', () => {
            expect((0, crud_service_1.extractIndexFilterValues)({ teamId: 'team-123' })).toEqual({ teamId: 'team-123' });
            expect((0, crud_service_1.extractIndexFilterValues)({ count: 42 })).toEqual({ count: 42 });
            expect((0, crud_service_1.extractIndexFilterValues)({ active: true })).toEqual({ active: true });
        });
        it('should extract eq values from filter syntax', () => {
            expect((0, crud_service_1.extractIndexFilterValues)({
                teamId: { eq: 'team-123' },
                status: { eq: 'active' }
            })).toEqual({
                teamId: 'team-123',
                status: 'active'
            });
        });
        it('should handle mixed direct values and filter syntax', () => {
            expect((0, crud_service_1.extractIndexFilterValues)({
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
            expect((0, crud_service_1.extractIndexFilterValues)({
                teamId: 'team-123',
                status: null,
                platform: undefined
            })).toEqual({
                teamId: 'team-123'
            });
        });
        it('should skip empty objects', () => {
            expect((0, crud_service_1.extractIndexFilterValues)({
                teamId: 'team-123',
                empty: {}
            })).toEqual({
                teamId: 'team-123'
            });
        });
        it('should handle boolean and numeric eq values', () => {
            expect((0, crud_service_1.extractIndexFilterValues)({
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
            expect((0, crud_service_1.extractIndexFilterValues)({
                tags: { eq: ['a', 'b', 'c'] }
            })).toEqual({
                tags: ['a', 'b', 'c']
            });
        });
    });
    describe('invalid inputs - should throw InvalidIndexFilterError', () => {
        it('should throw for gt operator', () => {
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                createdAt: { gt: '2024-01-01' }
            })).toThrow(crud_service_1.InvalidIndexFilterError);
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                createdAt: { gt: '2024-01-01' }
            })).toThrow(/Invalid filter operator.*gt.*createdAt/);
        });
        it('should throw for gte operator', () => {
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                count: { gte: 10 }
            })).toThrow(crud_service_1.InvalidIndexFilterError);
        });
        it('should throw for lt operator', () => {
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                date: { lt: '2024-12-31' }
            })).toThrow(crud_service_1.InvalidIndexFilterError);
        });
        it('should throw for lte operator', () => {
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                score: { lte: 100 }
            })).toThrow(crud_service_1.InvalidIndexFilterError);
        });
        it('should throw for between operator', () => {
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                range: { between: ['a', 'z'] }
            })).toThrow(crud_service_1.InvalidIndexFilterError);
        });
        it('should throw for begins operator', () => {
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                code: { begins: 'PREFIX' }
            })).toThrow(crud_service_1.InvalidIndexFilterError);
        });
        it('should throw for contains operator', () => {
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                name: { contains: 'test' }
            })).toThrow(crud_service_1.InvalidIndexFilterError);
        });
        it('should throw for multiple range operators', () => {
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                count: { gte: 10, lte: 100 }
            })).toThrow(crud_service_1.InvalidIndexFilterError);
        });
        it('should throw for mixed eq and other operators', () => {
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                value: { eq: 'test', gt: 'a' }
            })).toThrow(crud_service_1.InvalidIndexFilterError);
        });
        it('should include index name in error message when provided', () => {
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                createdAt: { gt: '2024-01-01' }
            }, 'byTeam')).toThrow(/for index "byTeam"/);
        });
        it('should provide helpful error message with details', () => {
            try {
                (0, crud_service_1.extractIndexFilterValues)({ score: { gte: 10 } }, 'byScore');
                fail('Should have thrown');
            }
            catch (e) {
                expect(e).toBeInstanceOf(crud_service_1.InvalidIndexFilterError);
                const error = e;
                expect(error.attributeName).toBe('score');
                expect(error.invalidOperators).toEqual(['gte']);
                expect(error.indexName).toBe('byScore');
                expect(error.message).toContain('top-level');
                expect(error.message).toContain('filters');
            }
        });
        it('should throw even if some fields are valid eq', () => {
            // The function should throw when it encounters an invalid operator
            expect(() => (0, crud_service_1.extractIndexFilterValues)({
                teamId: { eq: 'team-123' },
                createdAt: { gt: '2024-01-01' }
            })).toThrow(crud_service_1.InvalidIndexFilterError);
        });
    });
});
describe('filterGroupToSimpleFormat', () => {
    describe('passthrough for non-FilterGroup formats', () => {
        it('should return empty object for null/undefined', () => {
            expect((0, crud_service_1.filterGroupToSimpleFormat)(null)).toEqual({});
            expect((0, crud_service_1.filterGroupToSimpleFormat)(undefined)).toEqual({});
        });
        it('should pass through simple format unchanged', () => {
            const simple = { status: { eq: 'active' }, type: { eq: 'user' } };
            expect((0, crud_service_1.filterGroupToSimpleFormat)(simple)).toEqual(simple);
        });
        it('should pass through direct value filters', () => {
            const filters = { status: 'active', type: 'user' };
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filters)).toEqual(filters);
        });
    });
    describe('FilterGroup to simple format conversion', () => {
        it('should convert single filter in and array', () => {
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [{ attribute: 'parentObservabilityLogId', eq: '85b7eaad-72cd-412d-8fbb-b9537b3413d5' }],
                or: [],
                not: []
            };
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
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
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
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
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
                timestamp: { gte: 1000, lte: 2000 }
            });
        });
        it('should handle various filter operators', () => {
            const filterGroup = {
                and: [
                    { attribute: 'name', contains: 'test' },
                    { attribute: 'count', gt: 10 },
                    { attribute: 'status', neq: 'deleted' },
                    { attribute: 'tags', in: ['a', 'b', 'c'] }
                ],
                or: [],
                not: []
            };
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
                name: { contains: 'test' },
                count: { gt: 10 },
                status: { neq: 'deleted' },
                tags: { in: ['a', 'b', 'c'] }
            });
        });
        it('should exclude exists/notExists operators from index matching', () => {
            // Existence operators should be excluded because records with missing
            // attributes won't be in sparse GSIs where that attribute is the PK
            const filterGroup = {
                and: [
                    { attribute: 'parentId', notExists: true },
                    { attribute: 'metadata', exists: true },
                    { attribute: 'status', eq: 'active' } // This should be included
                ],
                or: [],
                not: []
            };
            // Only 'status' with 'eq' should be in the result
            // 'parentId' and 'metadata' with existence operators should be excluded
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
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
                    { attribute: 'field7', eq: 'value' } // This should be included
                ],
                or: [],
                not: []
            };
            // Only field7 with eq should be in the result
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
                field7: { eq: 'value' }
            });
        });
        it('should handle between operator', () => {
            const filterGroup = {
                and: [
                    { attribute: 'createdAt', bt: ['2024-01-01', '2024-12-31'] }
                ],
                or: [],
                not: []
            };
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
                createdAt: { bt: ['2024-01-01', '2024-12-31'] }
            });
        });
        it('should handle empty and array', () => {
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [],
                or: [],
                not: []
            };
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({});
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
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
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
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
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
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
                'user.profile.status': { eq: 'active' },
                'metadata.tags': { contains: 'important' }
            });
        });
    });
    describe('edge cases', () => {
        it('should handle FilterGroup with only "and" key (minimal format)', () => {
            const filterGroup = {
                and: [{ attribute: 'status', eq: 'active' }]
            };
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
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
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
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
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
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
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
                deletedAt: { eq: null }
            });
        });
        it('should handle array filter values', () => {
            const filterGroup = {
                and: [
                    { attribute: 'status', in: ['active', 'pending', 'processing'] }
                ],
                or: [],
                not: []
            };
            expect((0, crud_service_1.filterGroupToSimpleFormat)(filterGroup)).toEqual({
                status: { in: ['active', 'pending', 'processing'] }
            });
        });
    });
});
describe('findMatchingIndex', () => {
    let entityService;
    let repository;
    beforeEach(() => {
        // Create a real ElectroDB entity with our schema
        const TestEntity = new electrodb_1.Entity({
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
                        composite: ["id"]
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
                        composite: ["status"]
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
                        composite: ["status"]
                    },
                    sk: {
                        field: "gsi2sk",
                        composite: ["type"]
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
        const schema = {
            indexes: {
                primary: {
                    pk: { composite: ['id'] },
                    sk: { composite: [] }
                },
                byTemplate: {
                    index: 'gsi3',
                    pk: { composite: [], template: 'testEntity' },
                    sk: { composite: [] }
                }
            }
        };
        const result = (0, crud_service_1.findMatchingIndex)(schema, undefined, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byTemplate',
            indexFilters: {}
        });
    });
    it('should use index when filters match index attributes', () => {
        const schema = {
            indexes: {
                primary: {
                    pk: { composite: ['id'] },
                    sk: { composite: [] }
                },
                byStatusAndType: {
                    index: 'gsi2',
                    pk: { composite: ['status'] },
                    sk: { composite: ['type'] }
                }
            }
        };
        const filters = {
            status: { eq: 'active' },
            type: { eq: 'user' }
        };
        const result = (0, crud_service_1.findMatchingIndex)(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byStatusAndType',
            indexFilters: {
                status: 'active',
                type: 'user'
            }
        });
    });
    it('should handle direct value filters', () => {
        const schema = {
            indexes: {
                primary: {
                    pk: { composite: ['id'] },
                    sk: { composite: [] }
                },
                byStatusAndType: {
                    index: 'gsi2',
                    pk: { composite: ['status'] },
                    sk: { composite: ['type'] }
                }
            }
        };
        const filters = {
            status: 'active',
            type: 'user'
        };
        const result = (0, crud_service_1.findMatchingIndex)(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byStatusAndType',
            indexFilters: {
                status: 'active',
                type: 'user'
            }
        });
    });
    it('should return template match when no index matches and template exists', () => {
        const schema = {
            indexes: {
                primary: {
                    pk: { composite: ['id'] },
                    sk: { composite: [] }
                },
                byTemplate: {
                    index: 'gsi3',
                    pk: { composite: [], template: 'testEntity' },
                    sk: { composite: [] }
                }
            }
        };
        const filters = {
            randomField: 'value'
        };
        const result = (0, crud_service_1.findMatchingIndex)(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byTemplate',
            indexFilters: {}
        });
    });
    it('should return undefined when no index matches and no template exists', () => {
        const schema = {
            indexes: {
                primary: {
                    pk: { composite: ['id'] },
                    sk: { composite: [] }
                }
            }
        };
        const filters = {
            randomField: 'value'
        };
        const result = (0, crud_service_1.findMatchingIndex)(schema, filters, 'nonExistentEntity', entityService);
        expect(result).toBeUndefined();
    });
    it('should handle partial index matches', () => {
        const schema = {
            indexes: {
                primary: {
                    pk: { composite: ['id'] },
                    sk: { composite: [] }
                },
                byStatus: {
                    index: 'gsi1',
                    pk: { composite: ['status'] },
                    sk: { composite: [] }
                }
            }
        };
        const filters = {
            status: 'active',
            randomField: 'value'
        };
        const result = (0, crud_service_1.findMatchingIndex)(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byStatus',
            indexFilters: {
                status: 'active'
            }
        });
    });
    describe('FilterGroup format support', () => {
        // Shared schema that matches the TestEntity in beforeEach
        const schema = {
            indexes: {
                primary: { pk: { composite: ['id'] }, sk: { composite: [] } },
                byStatus: { index: 'gsi1', pk: { composite: ['status'] }, sk: { composite: [] } },
                byStatusAndType: { index: 'gsi2', pk: { composite: ['status'] }, sk: { composite: ['type'] } },
                byTemplate: { index: 'gsi3', pk: { composite: [], template: 'testEntity' }, sk: { composite: [] } }
            }
        };
        it('should match index with FilterGroup format filters', () => {
            const schema = {
                indexes: {
                    primary: {
                        pk: { composite: ['id'] },
                        sk: { composite: [] }
                    },
                    byStatus: {
                        index: 'gsi1',
                        pk: { composite: ['status'] },
                        sk: { composite: [] }
                    }
                }
            };
            // This is the format produced by queryStringParamsToFilterGroup
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [{ attribute: 'status', eq: 'active' }],
                or: [],
                not: []
            };
            const result = (0, crud_service_1.findMatchingIndex)(schema, filterGroup, 'testEntity', entityService);
            expect(result).toEqual({
                indexName: 'byStatus',
                indexFilters: {
                    status: 'active'
                }
            });
        });
        it('should match composite index with multiple FilterGroup filters', () => {
            const schema = {
                indexes: {
                    primary: {
                        pk: { composite: ['id'] },
                        sk: { composite: [] }
                    },
                    byStatusAndType: {
                        index: 'gsi2',
                        pk: { composite: ['status'] },
                        sk: { composite: ['type'] }
                    }
                }
            };
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    { attribute: 'status', eq: 'active' },
                    { attribute: 'type', eq: 'user' }
                ],
                or: [],
                not: []
            };
            const result = (0, crud_service_1.findMatchingIndex)(schema, filterGroup, 'testEntity', entityService);
            expect(result).toEqual({
                indexName: 'byStatusAndType',
                indexFilters: {
                    status: 'active',
                    type: 'user'
                }
            });
        });
        it('should handle FilterGroup with non-matching filters (fallback to template)', () => {
            const schema = {
                indexes: {
                    primary: {
                        pk: { composite: ['id'] },
                        sk: { composite: [] }
                    },
                    byTemplate: {
                        index: 'gsi3',
                        pk: { composite: [], template: 'testEntity' },
                        sk: { composite: [] }
                    }
                }
            };
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [{ attribute: 'nonExistentField', eq: 'value' }],
                or: [],
                not: []
            };
            const result = (0, crud_service_1.findMatchingIndex)(schema, filterGroup, 'testEntity', entityService);
            expect(result).toEqual({
                indexName: 'byTemplate',
                indexFilters: {}
            });
        });
        it('should handle empty FilterGroup', () => {
            const schema = {
                indexes: {
                    primary: {
                        pk: { composite: ['id'] },
                        sk: { composite: [] }
                    },
                    byTemplate: {
                        index: 'gsi3',
                        pk: { composite: [], template: 'testEntity' },
                        sk: { composite: [] }
                    }
                }
            };
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [],
                or: [],
                not: []
            };
            const result = (0, crud_service_1.findMatchingIndex)(schema, filterGroup, 'testEntity', entityService);
            expect(result).toEqual({
                indexName: 'byTemplate',
                indexFilters: {}
            });
        });
        it('should handle real-world parentObservabilityLogId filter scenario', () => {
            // Create entity with byParent index like observability logs
            const ObsEntity = new electrodb_1.Entity({
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
                        pk: { field: "pk", composite: ["observabilityLogId"] },
                        sk: { field: "sk", composite: [] }
                    },
                    byParent: {
                        index: "gsi2",
                        pk: { field: "gsi2pk", composite: ["parentObservabilityLogId"] },
                        sk: { field: "gsi2sk", composite: ["timestampMs"] }
                    },
                    byTrace: {
                        index: "gsi1",
                        pk: { field: "gsi1pk", composite: ["correlationId"] },
                        sk: { field: "gsi1sk", composite: ["timestampMs"] }
                    }
                }
            });
            const obsEntityService = {
                getRepository: () => ObsEntity
            };
            const schema = {
                indexes: {
                    primary: {
                        pk: { composite: ['observabilityLogId'] },
                        sk: { composite: [] }
                    },
                    byParent: {
                        index: 'gsi2',
                        pk: { composite: ['parentObservabilityLogId'] },
                        sk: { composite: ['timestampMs'] }
                    },
                    byTrace: {
                        index: 'gsi1',
                        pk: { composite: ['correlationId'] },
                        sk: { composite: ['timestampMs'] }
                    }
                }
            };
            // This is exactly what the controller receives from query string parsing
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [{
                        attribute: 'parentObservabilityLogId',
                        eq: '85b7eaad-72cd-412d-8fbb-b9537b3413d5'
                    }],
                or: [],
                not: []
            };
            const result = (0, crud_service_1.findMatchingIndex)(schema, filterGroup, 'observabilityLog', obsEntityService);
            expect(result).toEqual({
                indexName: 'byParent',
                indexFilters: {
                    parentObservabilityLogId: '85b7eaad-72cd-412d-8fbb-b9537b3413d5'
                }
            });
        });
        it('should match correlationId filter to byTrace index', () => {
            const ObsEntity = new electrodb_1.Entity({
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
                        pk: { field: "pk", composite: ["observabilityLogId"] },
                        sk: { field: "sk", composite: [] }
                    },
                    byParent: {
                        index: "gsi2",
                        pk: { field: "gsi2pk", composite: ["parentObservabilityLogId"] },
                        sk: { field: "gsi2sk", composite: ["timestampMs"] }
                    },
                    byTrace: {
                        index: "gsi1",
                        pk: { field: "gsi1pk", composite: ["correlationId"] },
                        sk: { field: "gsi1sk", composite: ["timestampMs"] }
                    }
                }
            });
            const obsEntityService = {
                getRepository: () => ObsEntity
            };
            const schema = {
                indexes: {
                    primary: {
                        pk: { composite: ['observabilityLogId'] },
                        sk: { composite: [] }
                    },
                    byParent: {
                        index: 'gsi2',
                        pk: { composite: ['parentObservabilityLogId'] },
                        sk: { composite: ['timestampMs'] }
                    },
                    byTrace: {
                        index: 'gsi1',
                        pk: { composite: ['correlationId'] },
                        sk: { composite: ['timestampMs'] }
                    }
                }
            };
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [{
                        attribute: 'correlationId',
                        eq: 'trace-123-456'
                    }],
                or: [],
                not: []
            };
            const result = (0, crud_service_1.findMatchingIndex)(schema, filterGroup, 'observabilityLog', obsEntityService);
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
            const ObsEntity = new electrodb_1.Entity({
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
                        pk: { field: "pk", composite: ["observabilityLogId"] },
                        sk: { field: "sk", composite: [] }
                    },
                    byParent: {
                        index: "gsi2",
                        pk: { field: "gsi2pk", composite: ["parentObservabilityLogId"] },
                        sk: { field: "gsi2sk", composite: ["timestampMs"] }
                    },
                    byTrace: {
                        index: "gsi1",
                        pk: { field: "gsi1pk", composite: ["correlationId"] },
                        sk: { field: "gsi1sk", composite: ["timestampMs"] }
                    },
                    byType: {
                        index: "gsi3",
                        pk: { field: "gsi3pk", composite: ["type"] },
                        sk: { field: "gsi3sk", composite: ["timestampMs"] }
                    }
                }
            });
            const schema = {
                indexes: {
                    primary: { pk: { composite: ['observabilityLogId'] }, sk: { composite: [] } },
                    byParent: { index: 'gsi2', pk: { composite: ['parentObservabilityLogId'] }, sk: { composite: ['timestampMs'] } },
                    byTrace: { index: 'gsi1', pk: { composite: ['correlationId'] }, sk: { composite: ['timestampMs'] } },
                    byType: { index: 'gsi3', pk: { composite: ['type'] }, sk: { composite: ['timestampMs'] } }
                }
            };
            // FilterGroup with multiple GSI PK attributes
            const filterGroup = {
                filterId: 'queryStringParamsToFilterGroup',
                and: [
                    { attribute: 'parentObservabilityLogId', eq: 'parent-123' },
                    { attribute: 'correlationId', eq: 'trace-456' },
                    { attribute: 'level', eq: 'error' } // Not a GSI PK
                ],
                or: [],
                not: []
            };
            const result = (0, crud_service_1.findMatchingIndex)(schema, filterGroup, 'observabilityLog', { getRepository: () => ObsEntity });
            // ElectroDB picks one - result should have one of the GSI names
            expect(result).toBeDefined();
            expect(['byParent', 'byTrace']).toContain(result.indexName);
            // The selected index's PK value should be in indexFilters
            expect(result.indexFilters.parentObservabilityLogId === 'parent-123' ||
                result.indexFilters.correlationId === 'trace-456').toBe(true);
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
            const result = (0, crud_service_1.findMatchingIndex)(schema, filterGroup, 'testEntity', entityService);
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
            const result = (0, crud_service_1.findMatchingIndex)(schema, filterGroup, 'testEntity', entityService);
            // No GSI match, falls back to template
            expect(result).toEqual({
                indexName: 'byTemplate',
                indexFilters: {}
            });
        });
        it('should return undefined when FilterGroup AND is empty and no template exists', () => {
            const schemaNoTemplate = {
                indexes: {
                    primary: { pk: { composite: ['id'] }, sk: { composite: [] } },
                    byStatus: { index: 'gsi1', pk: { composite: ['status'] }, sk: { composite: [] } }
                }
            };
            const filterGroup = {
                and: [],
                or: [{ attribute: 'status', eq: 'active' }], // OR can't be used for GSI
                not: []
            };
            const result = (0, crud_service_1.findMatchingIndex)(schemaNoTemplate, filterGroup, 'nonExistentEntity', entityService);
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
            const result = (0, crud_service_1.findMatchingIndex)(schema, filterGroup, 'testEntity', entityService);
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
            const result = (0, crud_service_1.findMatchingIndex)(schema, filterGroup, 'testEntity', entityService);
            // Should still match an index with status as PK
            expect(result).toBeDefined();
            expect(result.indexFilters.status).toBe('active');
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2NydWQtc2VydmljZS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0EsaURBQWlJO0FBQ2pJLHlDQUFtQztBQUVuQyxRQUFRLENBQUMsMEJBQTBCLEVBQUUsR0FBRyxFQUFFO0lBQ3RDLFFBQVEsQ0FBQyxjQUFjLEVBQUUsR0FBRyxFQUFFO1FBQzFCLEVBQUUsQ0FBQywrQ0FBK0MsRUFBRSxHQUFHLEVBQUU7WUFDckQsTUFBTSxDQUFDLElBQUEsdUNBQXdCLEVBQUMsSUFBVyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDMUQsTUFBTSxDQUFDLElBQUEsdUNBQXdCLEVBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDNUQsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsNkNBQTZDLEVBQUUsR0FBRyxFQUFFO1lBQ25ELE1BQU0sQ0FBQyxJQUFBLHVDQUF3QixFQUFDLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxNQUFNLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQztZQUN6RixNQUFNLENBQUMsSUFBQSx1Q0FBd0IsRUFBQyxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDdkUsTUFBTSxDQUFDLElBQUEsdUNBQXdCLEVBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ2pGLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLDZDQUE2QyxFQUFFLEdBQUcsRUFB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WUFDakUsTUFBTSxXQUFXLEdBQUc7Z0JBQ2hCLFFBQVEsRUFBRSxnQ0FBZ0M7Z0JBQzFDLEdBQUcsRUFBRTtvQkFDRCxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsRUFBRSxFQUFFLFFBQVEsRUFBRTtvQkFDckMsaUJBQWlCO2lCQUNwQjtnQkFDRCxFQUFFLEVBQUUsRUFBRTtnQkFDTixHQUFHLEVBQUUsRUFBRTthQUNWLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxJQUFBLGdDQUFpQixFQUFDLE1BQU0sRUFBRSxXQUFXLEVBQUUsWUFBWSxFQUFFLGFBQWEsQ0FBQyxDQUFDO1lBRW5GLGdEQUFnRDtZQUNoRCxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDN0IsTUFBTSxDQUFDLE1BQU8sQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3ZELENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEVudGl0eVNjaGVtYSB9IGZyb20gJy4vYmFzZS1lbnRpdHknO1xuaW1wb3J0IHsgZmluZE1hdGNoaW5nSW5kZXgsIGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQsIGV4dHJhY3RJbmRleEZpbHRlclZhbHVlcywgSW52YWxpZEluZGV4RmlsdGVyRXJyb3IgfSBmcm9tICcuL2NydWQtc2VydmljZSc7XG5pbXBvcnQgeyBFbnRpdHkgfSBmcm9tICdlbGVjdHJvZGInO1xuXG5kZXNjcmliZSgnZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzJywgKCkgPT4ge1xuICAgIGRlc2NyaWJlKCd2YWxpZCBpbnB1dHMnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgcmV0dXJuIGVtcHR5IG9iamVjdCBmb3IgbnVsbC91bmRlZmluZWQnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKG51bGwgYXMgYW55KSkudG9FcXVhbCh7fSk7XG4gICAgICAgICAgICBleHBlY3QoZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHVuZGVmaW5lZCkpLnRvRXF1YWwoe30pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHBhc3MgdGhyb3VnaCBkaXJlY3QgdmFsdWVzIHVuY2hhbmdlZCcsICgpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdChleHRyYWN0SW5kZXhGaWx0ZXJWYWx1ZXMoeyB0ZWFtSWQ6ICd0ZWFtLTEyMycgfSkpLnRvRXF1YWwoeyB0ZWFtSWQ6ICd0ZWFtLTEyMycgfSk7XG4gICAgICAgICAgICBleHBlY3QoZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHsgY291bnQ6IDQyIH0pKS50b0VxdWFsKHsgY291bnQ6IDQyIH0pO1xuICAgICAgICAgICAgZXhwZWN0KGV4dHJhY3RJbmRleEZpbHRlclZhbHVlcyh7IGFjdGl2ZTogdHJ1ZSB9KSkudG9FcXVhbCh7IGFjdGl2ZTogdHJ1ZSB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBleHRyYWN0IGVxIHZhbHVlcyBmcm9tIGZpbHRlciBzeW50YXgnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICB0ZWFtSWQ6IHsgZXE6ICd0ZWFtLTEyMycgfSxcbiAgICAgICAgICAgICAgICBzdGF0dXM6IHsgZXE6ICdhY3RpdmUnIH1cbiAgICAgICAgICAgIH0pKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICB0ZWFtSWQ6ICd0ZWFtLTEyMycsXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJ1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIG1peGVkIGRpcmVjdCB2YWx1ZXMgYW5kIGZpbHRlciBzeW50YXgnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICB0ZWFtSWQ6ICd0ZWFtLTEyMycsXG4gICAgICAgICAgICAgICAgc3RhdHVzOiB7IGVxOiAnYWN0aXZlJyB9LFxuICAgICAgICAgICAgICAgIHBsYXRmb3JtOiAndHdpdHRlcidcbiAgICAgICAgICAgIH0pKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICB0ZWFtSWQ6ICd0ZWFtLTEyMycsXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICAgICAgICBwbGF0Zm9ybTogJ3R3aXR0ZXInXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBza2lwIG51bGwgYW5kIHVuZGVmaW5lZCB2YWx1ZXMnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICB0ZWFtSWQ6ICd0ZWFtLTEyMycsXG4gICAgICAgICAgICAgICAgc3RhdHVzOiBudWxsLFxuICAgICAgICAgICAgICAgIHBsYXRmb3JtOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH0pKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICB0ZWFtSWQ6ICd0ZWFtLTEyMydcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHNraXAgZW1wdHkgb2JqZWN0cycsICgpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdChleHRyYWN0SW5kZXhGaWx0ZXJWYWx1ZXMoe1xuICAgICAgICAgICAgICAgIHRlYW1JZDogJ3RlYW0tMTIzJyxcbiAgICAgICAgICAgICAgICBlbXB0eToge31cbiAgICAgICAgICAgIH0pKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICB0ZWFtSWQ6ICd0ZWFtLTEyMydcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBib29sZWFuIGFuZCBudW1lcmljIGVxIHZhbHVlcycsICgpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdChleHRyYWN0SW5kZXhGaWx0ZXJWYWx1ZXMoe1xuICAgICAgICAgICAgICAgIGlzQWN0aXZlOiB7IGVxOiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgY291bnQ6IHsgZXE6IDQyIH0sXG4gICAgICAgICAgICAgICAgcmF0aW86IHsgZXE6IDAuNSB9XG4gICAgICAgICAgICB9KSkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgaXNBY3RpdmU6IHRydWUsXG4gICAgICAgICAgICAgICAgY291bnQ6IDQyLFxuICAgICAgICAgICAgICAgIHJhdGlvOiAwLjVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBhcnJheSBlcSB2YWx1ZXMnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICB0YWdzOiB7IGVxOiBbICdhJywgJ2InLCAnYycgXSB9XG4gICAgICAgICAgICB9KSkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgdGFnczogWyAnYScsICdiJywgJ2MnIF1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdpbnZhbGlkIGlucHV0cyAtIHNob3VsZCB0aHJvdyBJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvcicsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCB0aHJvdyBmb3IgZ3Qgb3BlcmF0b3InLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICBjcmVhdGVkQXQ6IHsgZ3Q6ICcyMDI0LTAxLTAxJyB9XG4gICAgICAgICAgICB9KSkudG9UaHJvdyhJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvcik7XG5cbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBleHRyYWN0SW5kZXhGaWx0ZXJWYWx1ZXMoe1xuICAgICAgICAgICAgICAgIGNyZWF0ZWRBdDogeyBndDogJzIwMjQtMDEtMDEnIH1cbiAgICAgICAgICAgIH0pKS50b1Rocm93KC9JbnZhbGlkIGZpbHRlciBvcGVyYXRvci4qZ3QuKmNyZWF0ZWRBdC8pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHRocm93IGZvciBndGUgb3BlcmF0b3InLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICBjb3VudDogeyBndGU6IDEwIH1cbiAgICAgICAgICAgIH0pKS50b1Rocm93KEludmFsaWRJbmRleEZpbHRlckVycm9yKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCB0aHJvdyBmb3IgbHQgb3BlcmF0b3InLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICBkYXRlOiB7IGx0OiAnMjAyNC0xMi0zMScgfVxuICAgICAgICAgICAgfSkpLnRvVGhyb3coSW52YWxpZEluZGV4RmlsdGVyRXJyb3IpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHRocm93IGZvciBsdGUgb3BlcmF0b3InLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICBzY29yZTogeyBsdGU6IDEwMCB9XG4gICAgICAgICAgICB9KSkudG9UaHJvdyhJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvcik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgdGhyb3cgZm9yIGJldHdlZW4gb3BlcmF0b3InLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICByYW5nZTogeyBiZXR3ZWVuOiBbICdhJywgJ3onIF0gfVxuICAgICAgICAgICAgfSkpLnRvVGhyb3coSW52YWxpZEluZGV4RmlsdGVyRXJyb3IpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHRocm93IGZvciBiZWdpbnMgb3BlcmF0b3InLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICBjb2RlOiB7IGJlZ2luczogJ1BSRUZJWCcgfVxuICAgICAgICAgICAgfSkpLnRvVGhyb3coSW52YWxpZEluZGV4RmlsdGVyRXJyb3IpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHRocm93IGZvciBjb250YWlucyBvcGVyYXRvcicsICgpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBleHRyYWN0SW5kZXhGaWx0ZXJWYWx1ZXMoe1xuICAgICAgICAgICAgICAgIG5hbWU6IHsgY29udGFpbnM6ICd0ZXN0JyB9XG4gICAgICAgICAgICB9KSkudG9UaHJvdyhJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvcik7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgdGhyb3cgZm9yIG11bHRpcGxlIHJhbmdlIG9wZXJhdG9ycycsICgpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBleHRyYWN0SW5kZXhGaWx0ZXJWYWx1ZXMoe1xuICAgICAgICAgICAgICAgIGNvdW50OiB7IGd0ZTogMTAsIGx0ZTogMTAwIH1cbiAgICAgICAgICAgIH0pKS50b1Rocm93KEludmFsaWRJbmRleEZpbHRlckVycm9yKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCB0aHJvdyBmb3IgbWl4ZWQgZXEgYW5kIG90aGVyIG9wZXJhdG9ycycsICgpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdCgoKSA9PiBleHRyYWN0SW5kZXhGaWx0ZXJWYWx1ZXMoe1xuICAgICAgICAgICAgICAgIHZhbHVlOiB7IGVxOiAndGVzdCcsIGd0OiAnYScgfVxuICAgICAgICAgICAgfSkpLnRvVGhyb3coSW52YWxpZEluZGV4RmlsdGVyRXJyb3IpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGluY2x1ZGUgaW5kZXggbmFtZSBpbiBlcnJvciBtZXNzYWdlIHdoZW4gcHJvdmlkZWQnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICBjcmVhdGVkQXQ6IHsgZ3Q6ICcyMDI0LTAxLTAxJyB9XG4gICAgICAgICAgICB9LCAnYnlUZWFtJykpLnRvVGhyb3coL2ZvciBpbmRleCBcImJ5VGVhbVwiLyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgcHJvdmlkZSBoZWxwZnVsIGVycm9yIG1lc3NhZ2Ugd2l0aCBkZXRhaWxzJywgKCkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBleHRyYWN0SW5kZXhGaWx0ZXJWYWx1ZXMoeyBzY29yZTogeyBndGU6IDEwIH0gfSwgJ2J5U2NvcmUnKTtcbiAgICAgICAgICAgICAgICBmYWlsKCdTaG91bGQgaGF2ZSB0aHJvd24nKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBleHBlY3QoZSkudG9CZUluc3RhbmNlT2YoSW52YWxpZEluZGV4RmlsdGVyRXJyb3IpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yID0gZSBhcyBJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvcjtcbiAgICAgICAgICAgICAgICBleHBlY3QoZXJyb3IuYXR0cmlidXRlTmFtZSkudG9CZSgnc2NvcmUnKTtcbiAgICAgICAgICAgICAgICBleHBlY3QoZXJyb3IuaW52YWxpZE9wZXJhdG9ycykudG9FcXVhbChbICdndGUnIF0pO1xuICAgICAgICAgICAgICAgIGV4cGVjdChlcnJvci5pbmRleE5hbWUpLnRvQmUoJ2J5U2NvcmUnKTtcbiAgICAgICAgICAgICAgICBleHBlY3QoZXJyb3IubWVzc2FnZSkudG9Db250YWluKCd0b3AtbGV2ZWwnKTtcbiAgICAgICAgICAgICAgICBleHBlY3QoZXJyb3IubWVzc2FnZSkudG9Db250YWluKCdmaWx0ZXJzJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgdGhyb3cgZXZlbiBpZiBzb21lIGZpZWxkcyBhcmUgdmFsaWQgZXEnLCAoKSA9PiB7XG4gICAgICAgICAgICAvLyBUaGUgZnVuY3Rpb24gc2hvdWxkIHRocm93IHdoZW4gaXQgZW5jb3VudGVycyBhbiBpbnZhbGlkIG9wZXJhdG9yXG4gICAgICAgICAgICBleHBlY3QoKCkgPT4gZXh0cmFjdEluZGV4RmlsdGVyVmFsdWVzKHtcbiAgICAgICAgICAgICAgICB0ZWFtSWQ6IHsgZXE6ICd0ZWFtLTEyMycgfSxcbiAgICAgICAgICAgICAgICBjcmVhdGVkQXQ6IHsgZ3Q6ICcyMDI0LTAxLTAxJyB9XG4gICAgICAgICAgICB9KSkudG9UaHJvdyhJbnZhbGlkSW5kZXhGaWx0ZXJFcnJvcik7XG4gICAgICAgIH0pO1xuICAgIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0JywgKCkgPT4ge1xuICAgIGRlc2NyaWJlKCdwYXNzdGhyb3VnaCBmb3Igbm9uLUZpbHRlckdyb3VwIGZvcm1hdHMnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgcmV0dXJuIGVtcHR5IG9iamVjdCBmb3IgbnVsbC91bmRlZmluZWQnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChudWxsIGFzIGFueSkpLnRvRXF1YWwoe30pO1xuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQodW5kZWZpbmVkIGFzIGFueSkpLnRvRXF1YWwoe30pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHBhc3MgdGhyb3VnaCBzaW1wbGUgZm9ybWF0IHVuY2hhbmdlZCcsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNpbXBsZSA9IHsgc3RhdHVzOiB7IGVxOiAnYWN0aXZlJyB9LCB0eXBlOiB7IGVxOiAndXNlcicgfSB9O1xuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoc2ltcGxlKSkudG9FcXVhbChzaW1wbGUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHBhc3MgdGhyb3VnaCBkaXJlY3QgdmFsdWUgZmlsdGVycycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7IHN0YXR1czogJ2FjdGl2ZScsIHR5cGU6ICd1c2VyJyB9O1xuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVycykpLnRvRXF1YWwoZmlsdGVycyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0ZpbHRlckdyb3VwIHRvIHNpbXBsZSBmb3JtYXQgY29udmVyc2lvbicsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCBjb252ZXJ0IHNpbmdsZSBmaWx0ZXIgaW4gYW5kIGFycmF5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogWyB7IGF0dHJpYnV0ZTogJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsIGVxOiAnODViN2VhYWQtNzJjZC00MTJkLThmYmItYjk1MzdiMzQxM2Q1JyB9IF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGV4cGVjdChmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlckdyb3VwKSkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGVxOiAnODViN2VhYWQtNzJjZC00MTJkLThmYmItYjk1MzdiMzQxM2Q1JyB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBjb252ZXJ0IG11bHRpcGxlIGZpbHRlcnMgaW4gYW5kIGFycmF5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGVxOiAnYWN0aXZlJyB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3R5cGUnLCBlcTogJ3NwYW4uc3RhcnQnIH0sXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnbGV2ZWwnLCBlcTogJ2Vycm9yJyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBzdGF0dXM6IHsgZXE6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICAgICAgdHlwZTogeyBlcTogJ3NwYW4uc3RhcnQnIH0sXG4gICAgICAgICAgICAgICAgbGV2ZWw6IHsgZXE6ICdlcnJvcicgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIG11bHRpcGxlIG9wZXJhdG9ycyBvbiBzYW1lIGF0dHJpYnV0ZScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3RpbWVzdGFtcCcsIGd0ZTogMTAwMCwgbHRlOiAyMDAwIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogeyBndGU6IDEwMDAsIGx0ZTogMjAwMCB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgdmFyaW91cyBmaWx0ZXIgb3BlcmF0b3JzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnbmFtZScsIGNvbnRhaW5zOiAndGVzdCcgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdjb3VudCcsIGd0OiAxMCB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIG5lcTogJ2RlbGV0ZWQnIH0sXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAndGFncycsIGluOiBbICdhJywgJ2InLCAnYycgXSB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBuYW1lOiB7IGNvbnRhaW5zOiAndGVzdCcgfSxcbiAgICAgICAgICAgICAgICBjb3VudDogeyBndDogMTAgfSxcbiAgICAgICAgICAgICAgICBzdGF0dXM6IHsgbmVxOiAnZGVsZXRlZCcgfSxcbiAgICAgICAgICAgICAgICB0YWdzOiB7IGluOiBbICdhJywgJ2InLCAnYycgXSB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBleGNsdWRlIGV4aXN0cy9ub3RFeGlzdHMgb3BlcmF0b3JzIGZyb20gaW5kZXggbWF0Y2hpbmcnLCAoKSA9PiB7XG4gICAgICAgICAgICAvLyBFeGlzdGVuY2Ugb3BlcmF0b3JzIHNob3VsZCBiZSBleGNsdWRlZCBiZWNhdXNlIHJlY29yZHMgd2l0aCBtaXNzaW5nXG4gICAgICAgICAgICAvLyBhdHRyaWJ1dGVzIHdvbid0IGJlIGluIHNwYXJzZSBHU0lzIHdoZXJlIHRoYXQgYXR0cmlidXRlIGlzIHRoZSBQS1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAncGFyZW50SWQnLCBub3RFeGlzdHM6IHRydWUgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdtZXRhZGF0YScsIGV4aXN0czogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGVxOiAnYWN0aXZlJyB9ICAvLyBUaGlzIHNob3VsZCBiZSBpbmNsdWRlZFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIC8vIE9ubHkgJ3N0YXR1cycgd2l0aCAnZXEnIHNob3VsZCBiZSBpbiB0aGUgcmVzdWx0XG4gICAgICAgICAgICAvLyAncGFyZW50SWQnIGFuZCAnbWV0YWRhdGEnIHdpdGggZXhpc3RlbmNlIG9wZXJhdG9ycyBzaG91bGQgYmUgZXhjbHVkZWRcbiAgICAgICAgICAgIGV4cGVjdChmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlckdyb3VwKSkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgc3RhdHVzOiB7IGVxOiAnYWN0aXZlJyB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBleGNsdWRlIGFsbCBleGlzdGVuY2UtcmVsYXRlZCBvcGVyYXRvcnMgZnJvbSBpbmRleCBtYXRjaGluZycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2ZpZWxkMScsIG5vdEV4aXN0czogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2ZpZWxkMicsIGV4aXN0czogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2ZpZWxkMycsIGlzTnVsbDogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2ZpZWxkNCcsIG5vdE51bGw6IHRydWUgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdmaWVsZDUnLCBlbXB0eTogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2ZpZWxkNicsIG5vdEVtcHR5OiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnZmllbGQ3JywgZXE6ICd2YWx1ZScgfSAgLy8gVGhpcyBzaG91bGQgYmUgaW5jbHVkZWRcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBPbmx5IGZpZWxkNyB3aXRoIGVxIHNob3VsZCBiZSBpbiB0aGUgcmVzdWx0XG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGZpZWxkNzogeyBlcTogJ3ZhbHVlJyB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgYmV0d2VlbiBvcGVyYXRvcicsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2NyZWF0ZWRBdCcsIGJ0OiBbICcyMDI0LTAxLTAxJywgJzIwMjQtMTItMzEnIF0gfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGV4cGVjdChmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlckdyb3VwKSkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgY3JlYXRlZEF0OiB7IGJ0OiBbICcyMDI0LTAxLTAxJywgJzIwMjQtMTItMzEnIF0gfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IGFuZCBhcnJheScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGZpbHRlcklkOiAncXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwJyxcbiAgICAgICAgICAgICAgICBhbmQ6IFtdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe30pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGlnbm9yZSBpdGVtcyB3aXRob3V0IGF0dHJpYnV0ZSBwcm9wZXJ0eScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGVxOiAnYWN0aXZlJyB9LFxuICAgICAgICAgICAgICAgICAgICB7IGZvbzogJ2JhcicgfSwgLy8gbm8gYXR0cmlidXRlIC0gc2hvdWxkIGJlIGlnbm9yZWRcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICd0eXBlJywgZXE6ICd1c2VyJyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBzdGF0dXM6IHsgZXE6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICAgICAgdHlwZTogeyBlcTogJ3VzZXInIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGlnbm9yZSBpdGVtcyB3aXRoIGF0dHJpYnV0ZSBidXQgbm8gb3BlcmF0b3JzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnc3RhdHVzJyB9LCAvLyBubyBvcGVyYXRvcnNcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICd0eXBlJywgZXE6ICd1c2VyJyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICB0eXBlOiB7IGVxOiAndXNlcicgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIG5lc3RlZCBwYXRoIGF0dHJpYnV0ZXMnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHtcbiAgICAgICAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICd1c2VyLnByb2ZpbGUuc3RhdHVzJywgZXE6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnbWV0YWRhdGEudGFncycsIGNvbnRhaW5zOiAnaW1wb3J0YW50JyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICAndXNlci5wcm9maWxlLnN0YXR1cyc6IHsgZXE6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICAgICAgJ21ldGFkYXRhLnRhZ3MnOiB7IGNvbnRhaW5zOiAnaW1wb3J0YW50JyB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnZWRnZSBjYXNlcycsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgRmlsdGVyR3JvdXAgd2l0aCBvbmx5IFwiYW5kXCIga2V5IChtaW5pbWFsIGZvcm1hdCknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHtcbiAgICAgICAgICAgICAgICBhbmQ6IFsgeyBhdHRyaWJ1dGU6ICdzdGF0dXMnLCBlcTogJ2FjdGl2ZScgfSBdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIHN0YXR1czogeyBlcTogJ2FjdGl2ZScgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIGJvb2xlYW4gdmFsdWVzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnaXNBY3RpdmUnLCBlcTogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2lzRGVsZXRlZCcsIGVxOiBmYWxzZSB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBpc0FjdGl2ZTogeyBlcTogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgIGlzRGVsZXRlZDogeyBlcTogZmFsc2UgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIG51bWVyaWMgdmFsdWVzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnY291bnQnLCBlcTogMCB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3ByaWNlJywgZ3RlOiAxMDAuNTAgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGV4cGVjdChmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlckdyb3VwKSkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgY291bnQ6IHsgZXE6IDAgfSxcbiAgICAgICAgICAgICAgICBwcmljZTogeyBndGU6IDEwMC41MCB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgbnVsbC91bmRlZmluZWQgZmlsdGVyIHZhbHVlcycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2RlbGV0ZWRBdCcsIGVxOiBudWxsIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGRlbGV0ZWRBdDogeyBlcTogbnVsbCB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgYXJyYXkgZmlsdGVyIHZhbHVlcycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGluOiBbICdhY3RpdmUnLCAncGVuZGluZycsICdwcm9jZXNzaW5nJyBdIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIHN0YXR1czogeyBpbjogWyAnYWN0aXZlJywgJ3BlbmRpbmcnLCAncHJvY2Vzc2luZycgXSB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ2ZpbmRNYXRjaGluZ0luZGV4JywgKCkgPT4ge1xuICAgIGxldCBlbnRpdHlTZXJ2aWNlOiBhbnk7XG4gICAgbGV0IHJlcG9zaXRvcnk6IGFueTtcblxuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgICAvLyBDcmVhdGUgYSByZWFsIEVsZWN0cm9EQiBlbnRpdHkgd2l0aCBvdXIgc2NoZW1hXG4gICAgICAgIGNvbnN0IFRlc3RFbnRpdHkgPSBuZXcgRW50aXR5KHtcbiAgICAgICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgICAgICAgZW50aXR5OiBcInRlc3RFbnRpdHlcIixcbiAgICAgICAgICAgICAgICB2ZXJzaW9uOiBcIjFcIixcbiAgICAgICAgICAgICAgICBzZXJ2aWNlOiBcInRlc3RcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICBpZDoge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcInN0cmluZ1wiLFxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogdHJ1ZVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgc3RhdHVzOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB0eXBlOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBuYW1lOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWVsZDogXCJwa1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbIFwiaWRcIiBdXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWVsZDogXCJza1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBieVN0YXR1czoge1xuICAgICAgICAgICAgICAgICAgICBpbmRleDogXCJnc2kxXCIsXG4gICAgICAgICAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWVsZDogXCJnc2kxcGtcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyBcInN0YXR1c1wiIF1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpZWxkOiBcImdzaTFza1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBieVN0YXR1c0FuZFR5cGU6IHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXg6IFwiZ3NpMlwiLFxuICAgICAgICAgICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgICAgICAgICAgZmllbGQ6IFwiZ3NpMnBrXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgXCJzdGF0dXNcIiBdXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWVsZDogXCJnc2kyc2tcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyBcInR5cGVcIiBdXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGJ5VGVtcGxhdGU6IHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXg6IFwiZ3NpM1wiLFxuICAgICAgICAgICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgICAgICAgICAgZmllbGQ6IFwiZ3NpM3BrXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IFwidGVzdEVudGl0eVwiXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWVsZDogXCJnc2kzc2tcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogW11cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVwb3NpdG9yeSA9IFRlc3RFbnRpdHk7XG4gICAgICAgIGVudGl0eVNlcnZpY2UgPSB7XG4gICAgICAgICAgICBnZXRSZXBvc2l0b3J5OiAoKSA9PiByZXBvc2l0b3J5XG4gICAgICAgIH07XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiB0ZW1wbGF0ZSBtYXRjaCB3aGVuIG5vIGZpbHRlcnMgcHJvdmlkZWQnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdpZCcgXSB9LFxuICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFtdIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGJ5VGVtcGxhdGU6IHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kzJyxcbiAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbXSwgdGVtcGxhdGU6ICd0ZXN0RW50aXR5JyB9LFxuICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFtdIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55O1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgdW5kZWZpbmVkLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5VGVtcGxhdGUnLFxuICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7fVxuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdXNlIGluZGV4IHdoZW4gZmlsdGVycyBtYXRjaCBpbmRleCBhdHRyaWJ1dGVzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnaWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBieVN0YXR1c0FuZFR5cGU6IHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdzdGF0dXMnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbICd0eXBlJyBdIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55O1xuXG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgICBzdGF0dXM6IHsgZXE6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICB0eXBlOiB7IGVxOiAndXNlcicgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVycywgJ3Rlc3RFbnRpdHknLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgICAgICBpbmRleE5hbWU6ICdieVN0YXR1c0FuZFR5cGUnLFxuICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICAgICAgICB0eXBlOiAndXNlcidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBkaXJlY3QgdmFsdWUgZmlsdGVycycsICgpID0+IHtcbiAgICAgICAgY29uc3Qgc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICBwazogeyBjb21wb3NpdGU6IFsgJ2lkJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYnlTdGF0dXNBbmRUeXBlOiB7XG4gICAgICAgICAgICAgICAgICAgIGluZGV4OiAnZ3NpMicsXG4gICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnc3RhdHVzJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogWyAndHlwZScgXSB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICBjb25zdCBmaWx0ZXJzID0ge1xuICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICAgIHR5cGU6ICd1c2VyJ1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVycywgJ3Rlc3RFbnRpdHknLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgICAgICBpbmRleE5hbWU6ICdieVN0YXR1c0FuZFR5cGUnLFxuICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICAgICAgICB0eXBlOiAndXNlcidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiB0ZW1wbGF0ZSBtYXRjaCB3aGVuIG5vIGluZGV4IG1hdGNoZXMgYW5kIHRlbXBsYXRlIGV4aXN0cycsICgpID0+IHtcbiAgICAgICAgY29uc3Qgc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICBwazogeyBjb21wb3NpdGU6IFsgJ2lkJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYnlUZW1wbGF0ZToge1xuICAgICAgICAgICAgICAgICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgICAgICAgICAgICAgICBwazogeyBjb21wb3NpdGU6IFtdLCB0ZW1wbGF0ZTogJ3Rlc3RFbnRpdHknIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnk7XG5cbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHtcbiAgICAgICAgICAgIHJhbmRvbUZpZWxkOiAndmFsdWUnXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJzLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5VGVtcGxhdGUnLFxuICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7fVxuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIHVuZGVmaW5lZCB3aGVuIG5vIGluZGV4IG1hdGNoZXMgYW5kIG5vIHRlbXBsYXRlIGV4aXN0cycsICgpID0+IHtcbiAgICAgICAgY29uc3Qgc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICBwazogeyBjb21wb3NpdGU6IFsgJ2lkJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnk7XG5cbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHtcbiAgICAgICAgICAgIHJhbmRvbUZpZWxkOiAndmFsdWUnXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJzLCAnbm9uRXhpc3RlbnRFbnRpdHknLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgcGFydGlhbCBpbmRleCBtYXRjaGVzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnaWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBieVN0YXR1czoge1xuICAgICAgICAgICAgICAgICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgICAgICAgICAgICAgICBwazogeyBjb21wb3NpdGU6IFsgJ3N0YXR1cycgXSB9LFxuICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFtdIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55O1xuXG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgICBzdGF0dXM6ICdhY3RpdmUnLFxuICAgICAgICAgICAgcmFuZG9tRmllbGQ6ICd2YWx1ZSdcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlcnMsICd0ZXN0RW50aXR5JywgZW50aXR5U2VydmljZSk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgaW5kZXhOYW1lOiAnYnlTdGF0dXMnLFxuICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdGaWx0ZXJHcm91cCBmb3JtYXQgc3VwcG9ydCcsICgpID0+IHtcbiAgICAgICAgLy8gU2hhcmVkIHNjaGVtYSB0aGF0IG1hdGNoZXMgdGhlIFRlc3RFbnRpdHkgaW4gYmVmb3JlRWFjaFxuICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICBwcmltYXJ5OiB7IHBrOiB7IGNvbXBvc2l0ZTogWyAnaWQnIF0gfSwgc2s6IHsgY29tcG9zaXRlOiBbXSB9IH0sXG4gICAgICAgICAgICAgICAgYnlTdGF0dXM6IHsgaW5kZXg6ICdnc2kxJywgcGs6IHsgY29tcG9zaXRlOiBbICdzdGF0dXMnIF0gfSwgc2s6IHsgY29tcG9zaXRlOiBbXSB9IH0sXG4gICAgICAgICAgICAgICAgYnlTdGF0dXNBbmRUeXBlOiB7IGluZGV4OiAnZ3NpMicsIHBrOiB7IGNvbXBvc2l0ZTogWyAnc3RhdHVzJyBdIH0sIHNrOiB7IGNvbXBvc2l0ZTogWyAndHlwZScgXSB9IH0sXG4gICAgICAgICAgICAgICAgYnlUZW1wbGF0ZTogeyBpbmRleDogJ2dzaTMnLCBwazogeyBjb21wb3NpdGU6IFtdLCB0ZW1wbGF0ZTogJ3Rlc3RFbnRpdHknIH0sIHNrOiB7IGNvbXBvc2l0ZTogW10gfSB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55O1xuXG4gICAgICAgIGl0KCdzaG91bGQgbWF0Y2ggaW5kZXggd2l0aCBGaWx0ZXJHcm91cCBmb3JtYXQgZmlsdGVycycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdpZCcgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5U3RhdHVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdzdGF0dXMnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBhcyBhbnk7XG5cbiAgICAgICAgICAgIC8vIFRoaXMgaXMgdGhlIGZvcm1hdCBwcm9kdWNlZCBieSBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXBcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGZpbHRlcklkOiAncXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwJyxcbiAgICAgICAgICAgICAgICBhbmQ6IFsgeyBhdHRyaWJ1dGU6ICdzdGF0dXMnLCBlcTogJ2FjdGl2ZScgfSBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlckdyb3VwLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuICAgICAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgaW5kZXhOYW1lOiAnYnlTdGF0dXMnLFxuICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdhY3RpdmUnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgbWF0Y2ggY29tcG9zaXRlIGluZGV4IHdpdGggbXVsdGlwbGUgRmlsdGVyR3JvdXAgZmlsdGVycycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdpZCcgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5U3RhdHVzQW5kVHlwZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnc3RhdHVzJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFsgJ3R5cGUnIF0gfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBhcyBhbnk7XG5cbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGZpbHRlcklkOiAncXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwJyxcbiAgICAgICAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdzdGF0dXMnLCBlcTogJ2FjdGl2ZScgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICd0eXBlJywgZXE6ICd1c2VyJyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJHcm91cCwgJ3Rlc3RFbnRpdHknLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5U3RhdHVzQW5kVHlwZScsXG4gICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICd1c2VyJ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBGaWx0ZXJHcm91cCB3aXRoIG5vbi1tYXRjaGluZyBmaWx0ZXJzIChmYWxsYmFjayB0byB0ZW1wbGF0ZSknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnaWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBieVRlbXBsYXRlOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbXSwgdGVtcGxhdGU6ICd0ZXN0RW50aXR5JyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogWyB7IGF0dHJpYnV0ZTogJ25vbkV4aXN0ZW50RmllbGQnLCBlcTogJ3ZhbHVlJyB9IF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVyR3JvdXAsICd0ZXN0RW50aXR5JywgZW50aXR5U2VydmljZSk7XG4gICAgICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBpbmRleE5hbWU6ICdieVRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHt9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgZW1wdHkgRmlsdGVyR3JvdXAnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnaWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBieVRlbXBsYXRlOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbXSwgdGVtcGxhdGU6ICd0ZXN0RW50aXR5JyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogW10sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVyR3JvdXAsICd0ZXN0RW50aXR5JywgZW50aXR5U2VydmljZSk7XG4gICAgICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBpbmRleE5hbWU6ICdieVRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHt9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgcmVhbC13b3JsZCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgZmlsdGVyIHNjZW5hcmlvJywgKCkgPT4ge1xuICAgICAgICAgICAgLy8gQ3JlYXRlIGVudGl0eSB3aXRoIGJ5UGFyZW50IGluZGV4IGxpa2Ugb2JzZXJ2YWJpbGl0eSBsb2dzXG4gICAgICAgICAgICBjb25zdCBPYnNFbnRpdHkgPSBuZXcgRW50aXR5KHtcbiAgICAgICAgICAgICAgICBtb2RlbDoge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHk6IFwib2JzZXJ2YWJpbGl0eUxvZ1wiLFxuICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiBcIjFcIixcbiAgICAgICAgICAgICAgICAgICAgc2VydmljZTogXCJvYnNlcnZhYmlsaXR5XCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IHR5cGU6IFwic3RyaW5nXCIsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyB0eXBlOiBcInN0cmluZ1wiIH0sXG4gICAgICAgICAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHsgdHlwZTogXCJzdHJpbmdcIiB9LFxuICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXBNczogeyB0eXBlOiBcIm51bWJlclwiIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgZmllbGQ6IFwicGtcIiwgY29tcG9zaXRlOiBbIFwib2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwic2tcIiwgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5UGFyZW50OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogXCJnc2kyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBwazogeyBmaWVsZDogXCJnc2kycGtcIiwgY29tcG9zaXRlOiBbIFwicGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMnNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5VHJhY2U6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4OiBcImdzaTFcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGZpZWxkOiBcImdzaTFwa1wiLCBjb21wb3NpdGU6IFsgXCJjb3JyZWxhdGlvbklkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMXNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3Qgb2JzRW50aXR5U2VydmljZSA9IHtcbiAgICAgICAgICAgICAgICBnZXRSZXBvc2l0b3J5OiAoKSA9PiBPYnNFbnRpdHlcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdvYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBieVBhcmVudDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgYnlUcmFjZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnY29ycmVsYXRpb25JZCcgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICAgICAgLy8gVGhpcyBpcyBleGFjdGx5IHdoYXQgdGhlIGNvbnRyb2xsZXIgcmVjZWl2ZXMgZnJvbSBxdWVyeSBzdHJpbmcgcGFyc2luZ1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogWyB7XG4gICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZTogJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgICAgICAgICAgIGVxOiAnODViN2VhYWQtNzJjZC00MTJkLThmYmItYjk1MzdiMzQxM2Q1J1xuICAgICAgICAgICAgICAgIH0gXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJHcm91cCwgJ29ic2VydmFiaWxpdHlMb2cnLCBvYnNFbnRpdHlTZXJ2aWNlIGFzIGFueSk7XG5cbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5UGFyZW50JyxcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnODViN2VhYWQtNzJjZC00MTJkLThmYmItYjk1MzdiMzQxM2Q1J1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIG1hdGNoIGNvcnJlbGF0aW9uSWQgZmlsdGVyIHRvIGJ5VHJhY2UgaW5kZXgnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBPYnNFbnRpdHkgPSBuZXcgRW50aXR5KHtcbiAgICAgICAgICAgICAgICBtb2RlbDoge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHk6IFwib2JzZXJ2YWJpbGl0eUxvZ1wiLFxuICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiBcIjFcIixcbiAgICAgICAgICAgICAgICAgICAgc2VydmljZTogXCJvYnNlcnZhYmlsaXR5XCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IHR5cGU6IFwic3RyaW5nXCIsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyB0eXBlOiBcInN0cmluZ1wiIH0sXG4gICAgICAgICAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHsgdHlwZTogXCJzdHJpbmdcIiB9LFxuICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXBNczogeyB0eXBlOiBcIm51bWJlclwiIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgZmllbGQ6IFwicGtcIiwgY29tcG9zaXRlOiBbIFwib2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwic2tcIiwgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5UGFyZW50OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogXCJnc2kyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBwazogeyBmaWVsZDogXCJnc2kycGtcIiwgY29tcG9zaXRlOiBbIFwicGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMnNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5VHJhY2U6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4OiBcImdzaTFcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGZpZWxkOiBcImdzaTFwa1wiLCBjb21wb3NpdGU6IFsgXCJjb3JyZWxhdGlvbklkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMXNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3Qgb2JzRW50aXR5U2VydmljZSA9IHtcbiAgICAgICAgICAgICAgICBnZXRSZXBvc2l0b3J5OiAoKSA9PiBPYnNFbnRpdHlcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdvYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBieVBhcmVudDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgYnlUcmFjZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnY29ycmVsYXRpb25JZCcgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogWyB7XG4gICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZTogJ2NvcnJlbGF0aW9uSWQnLFxuICAgICAgICAgICAgICAgICAgICBlcTogJ3RyYWNlLTEyMy00NTYnXG4gICAgICAgICAgICAgICAgfSBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlckdyb3VwLCAnb2JzZXJ2YWJpbGl0eUxvZycsIG9ic0VudGl0eVNlcnZpY2UgYXMgYW55KTtcblxuICAgICAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgaW5kZXhOYW1lOiAnYnlUcmFjZScsXG4gICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0cmFjZS0xMjMtNDU2J1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHNlbGVjdCBjb3JyZWN0IGluZGV4IHdoZW4gRmlsdGVyR3JvdXAgaGFzIG11bHRpcGxlIEdTSS1lbGlnaWJsZSBhdHRyaWJ1dGVzJywgKCkgPT4ge1xuICAgICAgICAgICAgLy8gUmVhbCBzY2VuYXJpbzogZmlsdGVyIGhhcyBib3RoIGNvcnJlbGF0aW9uSWQgQU5EIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZFxuICAgICAgICAgICAgLy8gRWxlY3Ryb0RCIHNob3VsZCBwaWNrIHRoZSBiZXN0IG1hdGNoaW5nIGluZGV4XG4gICAgICAgICAgICBjb25zdCBPYnNFbnRpdHkgPSBuZXcgRW50aXR5KHtcbiAgICAgICAgICAgICAgICBtb2RlbDogeyBlbnRpdHk6IFwib2JzZXJ2YWJpbGl0eUxvZ1wiLCB2ZXJzaW9uOiBcIjFcIiwgc2VydmljZTogXCJvYnNcIiB9LFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IHR5cGU6IFwic3RyaW5nXCIsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyB0eXBlOiBcInN0cmluZ1wiIH0sXG4gICAgICAgICAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHsgdHlwZTogXCJzdHJpbmdcIiB9LFxuICAgICAgICAgICAgICAgICAgICB0eXBlOiB7IHR5cGU6IFwic3RyaW5nXCIgfSxcbiAgICAgICAgICAgICAgICAgICAgbGV2ZWw6IHsgdHlwZTogXCJzdHJpbmdcIiB9LFxuICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXBNczogeyB0eXBlOiBcIm51bWJlclwiIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgZmllbGQ6IFwicGtcIiwgY29tcG9zaXRlOiBbIFwib2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwic2tcIiwgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5UGFyZW50OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogXCJnc2kyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBwazogeyBmaWVsZDogXCJnc2kycGtcIiwgY29tcG9zaXRlOiBbIFwicGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMnNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5VHJhY2U6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4OiBcImdzaTFcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGZpZWxkOiBcImdzaTFwa1wiLCBjb21wb3NpdGU6IFsgXCJjb3JyZWxhdGlvbklkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMXNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5VHlwZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6IFwiZ3NpM1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgZmllbGQ6IFwiZ3NpM3BrXCIsIGNvbXBvc2l0ZTogWyBcInR5cGVcIiBdIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzazogeyBmaWVsZDogXCJnc2kzc2tcIiwgY29tcG9zaXRlOiBbIFwidGltZXN0YW1wTXNcIiBdIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIHByaW1hcnk6IHsgcGs6IHsgY29tcG9zaXRlOiBbICdvYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSwgc2s6IHsgY29tcG9zaXRlOiBbXSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5UGFyZW50OiB7IGluZGV4OiAnZ3NpMicsIHBrOiB7IGNvbXBvc2l0ZTogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sIHNrOiB7IGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSB9LFxuICAgICAgICAgICAgICAgICAgICBieVRyYWNlOiB7IGluZGV4OiAnZ3NpMScsIHBrOiB7IGNvbXBvc2l0ZTogWyAnY29ycmVsYXRpb25JZCcgXSB9LCBzazogeyBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgYnlUeXBlOiB7IGluZGV4OiAnZ3NpMycsIHBrOiB7IGNvbXBvc2l0ZTogWyAndHlwZScgXSB9LCBzazogeyBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0gfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gYXMgYW55O1xuXG4gICAgICAgICAgICAvLyBGaWx0ZXJHcm91cCB3aXRoIG11bHRpcGxlIEdTSSBQSyBhdHRyaWJ1dGVzXG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJJZDogJ3F1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCcsXG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJywgZXE6ICdwYXJlbnQtMTIzJyB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2NvcnJlbGF0aW9uSWQnLCBlcTogJ3RyYWNlLTQ1NicgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdsZXZlbCcsIGVxOiAnZXJyb3InIH0gIC8vIE5vdCBhIEdTSSBQS1xuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVyR3JvdXAsICdvYnNlcnZhYmlsaXR5TG9nJywgeyBnZXRSZXBvc2l0b3J5OiAoKSA9PiBPYnNFbnRpdHkgfSBhcyBhbnkpO1xuXG4gICAgICAgICAgICAvLyBFbGVjdHJvREIgcGlja3Mgb25lIC0gcmVzdWx0IHNob3VsZCBoYXZlIG9uZSBvZiB0aGUgR1NJIG5hbWVzXG4gICAgICAgICAgICBleHBlY3QocmVzdWx0KS50b0JlRGVmaW5lZCgpO1xuICAgICAgICAgICAgZXhwZWN0KFsgJ2J5UGFyZW50JywgJ2J5VHJhY2UnIF0pLnRvQ29udGFpbihyZXN1bHQhLmluZGV4TmFtZSk7XG4gICAgICAgICAgICAvLyBUaGUgc2VsZWN0ZWQgaW5kZXgncyBQSyB2YWx1ZSBzaG91bGQgYmUgaW4gaW5kZXhGaWx0ZXJzXG4gICAgICAgICAgICBleHBlY3QoXG4gICAgICAgICAgICAgICAgcmVzdWx0IS5pbmRleEZpbHRlcnMucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50LTEyMycgfHxcbiAgICAgICAgICAgICAgICByZXN1bHQhLmluZGV4RmlsdGVycy5jb3JyZWxhdGlvbklkID09PSAndHJhY2UtNDU2J1xuICAgICAgICAgICAgKS50b0JlKHRydWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBGaWx0ZXJHcm91cCB3aXRoIEFORCArIE9SICsgTk9UIGFuZCBzZWxlY3QgaW5kZXggZnJvbSBBTkQgb25seScsICgpID0+IHtcbiAgICAgICAgICAgIC8vIE9SIGFuZCBOT1QgY29uZGl0aW9ucyBjYW4ndCBiZSB1c2VkIGZvciBHU0kgUEsgc2VsZWN0aW9uXG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJJZDogJ3F1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCcsXG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnc3RhdHVzJywgZXE6ICdhY3RpdmUnIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAndHlwZScsIGVxOiAnc3Bhbi5zdGFydCcgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICd0eXBlJywgZXE6ICdzcGFuJyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICduYW1lJywgZXE6ICdpbnRlcm5hbCcgfVxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSBhcyBhbnksIGZpbHRlckdyb3VwLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgICAgICAgICAvLyBTaG91bGQgdXNlIGJ5U3RhdHVzIGluZGV4IGZyb20gdGhlIEFORCBjb25kaXRpb25cbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5U3RhdHVzJyxcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGZhbGxiYWNrIHRvIHRlbXBsYXRlIHdoZW4gRmlsdGVyR3JvdXAgQU5EIGhhcyBubyBHU0ktbWF0Y2hpbmcgYXR0cmlidXRlcycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGZpbHRlcklkOiAncXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwJyxcbiAgICAgICAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdyYW5kb21GaWVsZCcsIGVxOiAnc29tZVZhbHVlJyB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2Fub3RoZXJGaWVsZCcsIGNvbnRhaW5zOiAndGV4dCcgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSBhcyBhbnksIGZpbHRlckdyb3VwLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgICAgICAgICAvLyBObyBHU0kgbWF0Y2gsIGZhbGxzIGJhY2sgdG8gdGVtcGxhdGVcbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5VGVtcGxhdGUnLFxuICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyczoge31cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHJldHVybiB1bmRlZmluZWQgd2hlbiBGaWx0ZXJHcm91cCBBTkQgaXMgZW1wdHkgYW5kIG5vIHRlbXBsYXRlIGV4aXN0cycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYU5vVGVtcGxhdGU6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIHByaW1hcnk6IHsgcGs6IHsgY29tcG9zaXRlOiBbICdpZCcgXSB9LCBzazogeyBjb21wb3NpdGU6IFtdIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgYnlTdGF0dXM6IHsgaW5kZXg6ICdnc2kxJywgcGs6IHsgY29tcG9zaXRlOiBbICdzdGF0dXMnIF0gfSwgc2s6IHsgY29tcG9zaXRlOiBbXSB9IH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXSxcbiAgICAgICAgICAgICAgICBvcjogWyB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGVxOiAnYWN0aXZlJyB9IF0sICAvLyBPUiBjYW4ndCBiZSB1c2VkIGZvciBHU0lcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWFOb1RlbXBsYXRlLCBmaWx0ZXJHcm91cCwgJ25vbkV4aXN0ZW50RW50aXR5JywgZW50aXR5U2VydmljZSk7XG5cbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29tcG9zaXRlIEdTSSAoUEsgKyBTSykgd2l0aCBGaWx0ZXJHcm91cCBmb3JtYXQnLCAoKSA9PiB7XG4gICAgICAgICAgICAvLyBieVN0YXR1c0FuZFR5cGUgaGFzIFBLPXN0YXR1cywgU0s9dHlwZVxuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGVxOiAnYWN0aXZlJyB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3R5cGUnLCBlcTogJ3VzZXInIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlckdyb3VwLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgICAgICAgICAvLyBTaG91bGQgbWF0Y2ggY29tcG9zaXRlIGluZGV4IHdpdGggYm90aCBQSyBhbmQgU0tcbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5U3RhdHVzQW5kVHlwZScsXG4gICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICd1c2VyJ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBGaWx0ZXJHcm91cCB3aXRoIG9ubHkgUEsgbWF0Y2ggb24gY29tcG9zaXRlIEdTSScsICgpID0+IHtcbiAgICAgICAgICAgIC8vIGJ5U3RhdHVzQW5kVHlwZSBoYXMgUEs9c3RhdHVzLCBTSz10eXBlIC0gb25seSBwcm92aWRpbmcgc3RhdHVzXG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJJZDogJ3F1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCcsXG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnc3RhdHVzJywgZXE6ICdhY3RpdmUnIH1cbiAgICAgICAgICAgICAgICAgICAgLy8gTm8gdHlwZSBmaWx0ZXJcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlckdyb3VwLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgICAgICAgICAvLyBTaG91bGQgc3RpbGwgbWF0Y2ggYW4gaW5kZXggd2l0aCBzdGF0dXMgYXMgUEtcbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICAgICAgICBleHBlY3QocmVzdWx0IS5pbmRleEZpbHRlcnMuc3RhdHVzKS50b0JlKCdhY3RpdmUnKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59KTsgIl19