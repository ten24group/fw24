"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crud_service_1 = require("./crud-service");
const electrodb_1 = require("electrodb");
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3J1ZC1zZXJ2aWNlLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2NydWQtc2VydmljZS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0EsaURBQThFO0FBQzlFLHlDQUFtQztBQUVuQyxRQUFRLENBQUMsMkJBQTJCLEVBQUUsR0FBRyxFQUFFO0lBQ3ZDLFFBQVEsQ0FBQyx5Q0FBeUMsRUFBRSxHQUFHLEVBQUU7UUFDckQsRUFBRSxDQUFDLCtDQUErQyxFQUFFLEdBQUcsRUFBRTtZQUNyRCxNQUFNLENBQUMsSUFBQSx3Q0FBeUIsRUFBQyxJQUFXLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUMzRCxNQUFNLENBQUMsSUFBQSx3Q0FBeUIsRUFBQyxTQUFnQixDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDcEUsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsNkNBQTZDLEVBQUUsR0FBRyxFQUFFO1lBQ25ELE1BQU0sTUFBTSxHQUFHLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRSxFQUFFLFFBQVEsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLEVBQUUsRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFDO1lBQ2xFLE1BQU0sQ0FBQyxJQUFBLHdDQUF5QixFQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQzlELENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLDBDQUEwQyxFQUFFLEdBQUcsRUFBRTtZQUNoRCxNQUFNLE9BQU8sR0FBRyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxDQUFDO1lBQ25ELE1BQU0sQ0FBQyxJQUFBLHdDQUF5QixFQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ2hFLENBQUMs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QUFFO29CQUNELEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxFQUFFLEVBQUUsUUFBUSxFQUFFO29CQUNyQyxpQkFBaUI7aUJBQ3BCO2dCQUNELEVBQUUsRUFBRSxFQUFFO2dCQUNOLEdBQUcsRUFBRSxFQUFFO2FBQ1YsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLElBQUEsZ0NBQWlCLEVBQUMsTUFBTSxFQUFFLFdBQVcsRUFBRSxZQUFZLEVBQUUsYUFBYSxDQUFDLENBQUM7WUFFbkYsZ0RBQWdEO1lBQ2hELE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUM3QixNQUFNLENBQUMsTUFBTyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDdkQsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRW50aXR5U2NoZW1hIH0gZnJvbSAnLi9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyBmaW5kTWF0Y2hpbmdJbmRleCwgZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdCB9IGZyb20gJy4vY3J1ZC1zZXJ2aWNlJztcbmltcG9ydCB7IEVudGl0eSB9IGZyb20gJ2VsZWN0cm9kYic7XG5cbmRlc2NyaWJlKCdmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0JywgKCkgPT4ge1xuICAgIGRlc2NyaWJlKCdwYXNzdGhyb3VnaCBmb3Igbm9uLUZpbHRlckdyb3VwIGZvcm1hdHMnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgcmV0dXJuIGVtcHR5IG9iamVjdCBmb3IgbnVsbC91bmRlZmluZWQnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChudWxsIGFzIGFueSkpLnRvRXF1YWwoe30pO1xuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQodW5kZWZpbmVkIGFzIGFueSkpLnRvRXF1YWwoe30pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHBhc3MgdGhyb3VnaCBzaW1wbGUgZm9ybWF0IHVuY2hhbmdlZCcsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNpbXBsZSA9IHsgc3RhdHVzOiB7IGVxOiAnYWN0aXZlJyB9LCB0eXBlOiB7IGVxOiAndXNlcicgfSB9O1xuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoc2ltcGxlKSkudG9FcXVhbChzaW1wbGUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHBhc3MgdGhyb3VnaCBkaXJlY3QgdmFsdWUgZmlsdGVycycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7IHN0YXR1czogJ2FjdGl2ZScsIHR5cGU6ICd1c2VyJyB9O1xuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVycykpLnRvRXF1YWwoZmlsdGVycyk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0ZpbHRlckdyb3VwIHRvIHNpbXBsZSBmb3JtYXQgY29udmVyc2lvbicsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCBjb252ZXJ0IHNpbmdsZSBmaWx0ZXIgaW4gYW5kIGFycmF5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogWyB7IGF0dHJpYnV0ZTogJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsIGVxOiAnODViN2VhYWQtNzJjZC00MTJkLThmYmItYjk1MzdiMzQxM2Q1JyB9IF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGV4cGVjdChmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlckdyb3VwKSkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IGVxOiAnODViN2VhYWQtNzJjZC00MTJkLThmYmItYjk1MzdiMzQxM2Q1JyB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBjb252ZXJ0IG11bHRpcGxlIGZpbHRlcnMgaW4gYW5kIGFycmF5JywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGVxOiAnYWN0aXZlJyB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3R5cGUnLCBlcTogJ3NwYW4uc3RhcnQnIH0sXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnbGV2ZWwnLCBlcTogJ2Vycm9yJyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBzdGF0dXM6IHsgZXE6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICAgICAgdHlwZTogeyBlcTogJ3NwYW4uc3RhcnQnIH0sXG4gICAgICAgICAgICAgICAgbGV2ZWw6IHsgZXE6ICdlcnJvcicgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIG11bHRpcGxlIG9wZXJhdG9ycyBvbiBzYW1lIGF0dHJpYnV0ZScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3RpbWVzdGFtcCcsIGd0ZTogMTAwMCwgbHRlOiAyMDAwIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogeyBndGU6IDEwMDAsIGx0ZTogMjAwMCB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgdmFyaW91cyBmaWx0ZXIgb3BlcmF0b3JzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnbmFtZScsIGNvbnRhaW5zOiAndGVzdCcgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdjb3VudCcsIGd0OiAxMCB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIG5lcTogJ2RlbGV0ZWQnIH0sXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAndGFncycsIGluOiBbICdhJywgJ2InLCAnYycgXSB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBuYW1lOiB7IGNvbnRhaW5zOiAndGVzdCcgfSxcbiAgICAgICAgICAgICAgICBjb3VudDogeyBndDogMTAgfSxcbiAgICAgICAgICAgICAgICBzdGF0dXM6IHsgbmVxOiAnZGVsZXRlZCcgfSxcbiAgICAgICAgICAgICAgICB0YWdzOiB7IGluOiBbICdhJywgJ2InLCAnYycgXSB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBleGNsdWRlIGV4aXN0cy9ub3RFeGlzdHMgb3BlcmF0b3JzIGZyb20gaW5kZXggbWF0Y2hpbmcnLCAoKSA9PiB7XG4gICAgICAgICAgICAvLyBFeGlzdGVuY2Ugb3BlcmF0b3JzIHNob3VsZCBiZSBleGNsdWRlZCBiZWNhdXNlIHJlY29yZHMgd2l0aCBtaXNzaW5nXG4gICAgICAgICAgICAvLyBhdHRyaWJ1dGVzIHdvbid0IGJlIGluIHNwYXJzZSBHU0lzIHdoZXJlIHRoYXQgYXR0cmlidXRlIGlzIHRoZSBQS1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAncGFyZW50SWQnLCBub3RFeGlzdHM6IHRydWUgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdtZXRhZGF0YScsIGV4aXN0czogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGVxOiAnYWN0aXZlJyB9ICAvLyBUaGlzIHNob3VsZCBiZSBpbmNsdWRlZFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIC8vIE9ubHkgJ3N0YXR1cycgd2l0aCAnZXEnIHNob3VsZCBiZSBpbiB0aGUgcmVzdWx0XG4gICAgICAgICAgICAvLyAncGFyZW50SWQnIGFuZCAnbWV0YWRhdGEnIHdpdGggZXhpc3RlbmNlIG9wZXJhdG9ycyBzaG91bGQgYmUgZXhjbHVkZWRcbiAgICAgICAgICAgIGV4cGVjdChmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlckdyb3VwKSkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgc3RhdHVzOiB7IGVxOiAnYWN0aXZlJyB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBleGNsdWRlIGFsbCBleGlzdGVuY2UtcmVsYXRlZCBvcGVyYXRvcnMgZnJvbSBpbmRleCBtYXRjaGluZycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2ZpZWxkMScsIG5vdEV4aXN0czogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2ZpZWxkMicsIGV4aXN0czogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2ZpZWxkMycsIGlzTnVsbDogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2ZpZWxkNCcsIG5vdE51bGw6IHRydWUgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdmaWVsZDUnLCBlbXB0eTogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2ZpZWxkNicsIG5vdEVtcHR5OiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnZmllbGQ3JywgZXE6ICd2YWx1ZScgfSAgLy8gVGhpcyBzaG91bGQgYmUgaW5jbHVkZWRcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBPbmx5IGZpZWxkNyB3aXRoIGVxIHNob3VsZCBiZSBpbiB0aGUgcmVzdWx0XG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGZpZWxkNzogeyBlcTogJ3ZhbHVlJyB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgYmV0d2VlbiBvcGVyYXRvcicsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2NyZWF0ZWRBdCcsIGJ0OiBbICcyMDI0LTAxLTAxJywgJzIwMjQtMTItMzEnIF0gfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGV4cGVjdChmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlckdyb3VwKSkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgY3JlYXRlZEF0OiB7IGJ0OiBbICcyMDI0LTAxLTAxJywgJzIwMjQtMTItMzEnIF0gfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IGFuZCBhcnJheScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGZpbHRlcklkOiAncXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwJyxcbiAgICAgICAgICAgICAgICBhbmQ6IFtdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe30pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGlnbm9yZSBpdGVtcyB3aXRob3V0IGF0dHJpYnV0ZSBwcm9wZXJ0eScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGVxOiAnYWN0aXZlJyB9LFxuICAgICAgICAgICAgICAgICAgICB7IGZvbzogJ2JhcicgfSwgLy8gbm8gYXR0cmlidXRlIC0gc2hvdWxkIGJlIGlnbm9yZWRcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICd0eXBlJywgZXE6ICd1c2VyJyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBzdGF0dXM6IHsgZXE6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICAgICAgdHlwZTogeyBlcTogJ3VzZXInIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGlnbm9yZSBpdGVtcyB3aXRoIGF0dHJpYnV0ZSBidXQgbm8gb3BlcmF0b3JzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnc3RhdHVzJyB9LCAvLyBubyBvcGVyYXRvcnNcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICd0eXBlJywgZXE6ICd1c2VyJyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICB0eXBlOiB7IGVxOiAndXNlcicgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIG5lc3RlZCBwYXRoIGF0dHJpYnV0ZXMnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHtcbiAgICAgICAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICd1c2VyLnByb2ZpbGUuc3RhdHVzJywgZXE6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnbWV0YWRhdGEudGFncycsIGNvbnRhaW5zOiAnaW1wb3J0YW50JyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICAndXNlci5wcm9maWxlLnN0YXR1cyc6IHsgZXE6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICAgICAgJ21ldGFkYXRhLnRhZ3MnOiB7IGNvbnRhaW5zOiAnaW1wb3J0YW50JyB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnZWRnZSBjYXNlcycsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgRmlsdGVyR3JvdXAgd2l0aCBvbmx5IFwiYW5kXCIga2V5IChtaW5pbWFsIGZvcm1hdCknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHtcbiAgICAgICAgICAgICAgICBhbmQ6IFsgeyBhdHRyaWJ1dGU6ICdzdGF0dXMnLCBlcTogJ2FjdGl2ZScgfSBdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIHN0YXR1czogeyBlcTogJ2FjdGl2ZScgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIGJvb2xlYW4gdmFsdWVzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnaXNBY3RpdmUnLCBlcTogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2lzRGVsZXRlZCcsIGVxOiBmYWxzZSB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgZXhwZWN0KGZpbHRlckdyb3VwVG9TaW1wbGVGb3JtYXQoZmlsdGVyR3JvdXApKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBpc0FjdGl2ZTogeyBlcTogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgIGlzRGVsZXRlZDogeyBlcTogZmFsc2UgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIG51bWVyaWMgdmFsdWVzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnY291bnQnLCBlcTogMCB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3ByaWNlJywgZ3RlOiAxMDAuNTAgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGV4cGVjdChmaWx0ZXJHcm91cFRvU2ltcGxlRm9ybWF0KGZpbHRlckdyb3VwKSkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgY291bnQ6IHsgZXE6IDAgfSxcbiAgICAgICAgICAgICAgICBwcmljZTogeyBndGU6IDEwMC41MCB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgbnVsbC91bmRlZmluZWQgZmlsdGVyIHZhbHVlcycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2RlbGV0ZWRBdCcsIGVxOiBudWxsIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGRlbGV0ZWRBdDogeyBlcTogbnVsbCB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgYXJyYXkgZmlsdGVyIHZhbHVlcycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGluOiBbICdhY3RpdmUnLCAncGVuZGluZycsICdwcm9jZXNzaW5nJyBdIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBleHBlY3QoZmlsdGVyR3JvdXBUb1NpbXBsZUZvcm1hdChmaWx0ZXJHcm91cCkpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIHN0YXR1czogeyBpbjogWyAnYWN0aXZlJywgJ3BlbmRpbmcnLCAncHJvY2Vzc2luZycgXSB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ2ZpbmRNYXRjaGluZ0luZGV4JywgKCkgPT4ge1xuICAgIGxldCBlbnRpdHlTZXJ2aWNlOiBhbnk7XG4gICAgbGV0IHJlcG9zaXRvcnk6IGFueTtcblxuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgICAvLyBDcmVhdGUgYSByZWFsIEVsZWN0cm9EQiBlbnRpdHkgd2l0aCBvdXIgc2NoZW1hXG4gICAgICAgIGNvbnN0IFRlc3RFbnRpdHkgPSBuZXcgRW50aXR5KHtcbiAgICAgICAgICAgIG1vZGVsOiB7XG4gICAgICAgICAgICAgICAgZW50aXR5OiBcInRlc3RFbnRpdHlcIixcbiAgICAgICAgICAgICAgICB2ZXJzaW9uOiBcIjFcIixcbiAgICAgICAgICAgICAgICBzZXJ2aWNlOiBcInRlc3RcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICBpZDoge1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBcInN0cmluZ1wiLFxuICAgICAgICAgICAgICAgICAgICByZXF1aXJlZDogdHJ1ZVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgc3RhdHVzOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB0eXBlOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBuYW1lOiB7XG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgICAgICAgICAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWVsZDogXCJwa1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbIFwiaWRcIiBdXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWVsZDogXCJza1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBieVN0YXR1czoge1xuICAgICAgICAgICAgICAgICAgICBpbmRleDogXCJnc2kxXCIsXG4gICAgICAgICAgICAgICAgICAgIHBrOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWVsZDogXCJnc2kxcGtcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyBcInN0YXR1c1wiIF1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgc2s6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpZWxkOiBcImdzaTFza1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBieVN0YXR1c0FuZFR5cGU6IHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXg6IFwiZ3NpMlwiLFxuICAgICAgICAgICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgICAgICAgICAgZmllbGQ6IFwiZ3NpMnBrXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFsgXCJzdGF0dXNcIiBdXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWVsZDogXCJnc2kyc2tcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogWyBcInR5cGVcIiBdXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGJ5VGVtcGxhdGU6IHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXg6IFwiZ3NpM1wiLFxuICAgICAgICAgICAgICAgICAgICBwazoge1xuICAgICAgICAgICAgICAgICAgICAgICAgZmllbGQ6IFwiZ3NpM3BrXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wb3NpdGU6IFtdLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IFwidGVzdEVudGl0eVwiXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmaWVsZDogXCJnc2kzc2tcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBvc2l0ZTogW11cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVwb3NpdG9yeSA9IFRlc3RFbnRpdHk7XG4gICAgICAgIGVudGl0eVNlcnZpY2UgPSB7XG4gICAgICAgICAgICBnZXRSZXBvc2l0b3J5OiAoKSA9PiByZXBvc2l0b3J5XG4gICAgICAgIH07XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiB0ZW1wbGF0ZSBtYXRjaCB3aGVuIG5vIGZpbHRlcnMgcHJvdmlkZWQnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICAgICAgaW5kZXhlczoge1xuICAgICAgICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdpZCcgXSB9LFxuICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFtdIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGJ5VGVtcGxhdGU6IHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kzJyxcbiAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbXSwgdGVtcGxhdGU6ICd0ZXN0RW50aXR5JyB9LFxuICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFtdIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55O1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgdW5kZWZpbmVkLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5VGVtcGxhdGUnLFxuICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7fVxuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdXNlIGluZGV4IHdoZW4gZmlsdGVycyBtYXRjaCBpbmRleCBhdHRyaWJ1dGVzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnaWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBieVN0YXR1c0FuZFR5cGU6IHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdzdGF0dXMnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbICd0eXBlJyBdIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55O1xuXG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgICBzdGF0dXM6IHsgZXE6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICB0eXBlOiB7IGVxOiAndXNlcicgfVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVycywgJ3Rlc3RFbnRpdHknLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgICAgICBpbmRleE5hbWU6ICdieVN0YXR1c0FuZFR5cGUnLFxuICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICAgICAgICB0eXBlOiAndXNlcidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBkaXJlY3QgdmFsdWUgZmlsdGVycycsICgpID0+IHtcbiAgICAgICAgY29uc3Qgc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICBwazogeyBjb21wb3NpdGU6IFsgJ2lkJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYnlTdGF0dXNBbmRUeXBlOiB7XG4gICAgICAgICAgICAgICAgICAgIGluZGV4OiAnZ3NpMicsXG4gICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnc3RhdHVzJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogWyAndHlwZScgXSB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICBjb25zdCBmaWx0ZXJzID0ge1xuICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICAgIHR5cGU6ICd1c2VyJ1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVycywgJ3Rlc3RFbnRpdHknLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgICAgICBpbmRleE5hbWU6ICdieVN0YXR1c0FuZFR5cGUnLFxuICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICAgICAgICB0eXBlOiAndXNlcidcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiB0ZW1wbGF0ZSBtYXRjaCB3aGVuIG5vIGluZGV4IG1hdGNoZXMgYW5kIHRlbXBsYXRlIGV4aXN0cycsICgpID0+IHtcbiAgICAgICAgY29uc3Qgc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICBwazogeyBjb21wb3NpdGU6IFsgJ2lkJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYnlUZW1wbGF0ZToge1xuICAgICAgICAgICAgICAgICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgICAgICAgICAgICAgICBwazogeyBjb21wb3NpdGU6IFtdLCB0ZW1wbGF0ZTogJ3Rlc3RFbnRpdHknIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnk7XG5cbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHtcbiAgICAgICAgICAgIHJhbmRvbUZpZWxkOiAndmFsdWUnXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJzLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5VGVtcGxhdGUnLFxuICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7fVxuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIHVuZGVmaW5lZCB3aGVuIG5vIGluZGV4IG1hdGNoZXMgYW5kIG5vIHRlbXBsYXRlIGV4aXN0cycsICgpID0+IHtcbiAgICAgICAgY29uc3Qgc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSB7XG4gICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICBwazogeyBjb21wb3NpdGU6IFsgJ2lkJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnk7XG5cbiAgICAgICAgY29uc3QgZmlsdGVycyA9IHtcbiAgICAgICAgICAgIHJhbmRvbUZpZWxkOiAndmFsdWUnXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJzLCAnbm9uRXhpc3RlbnRFbnRpdHknLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgcGFydGlhbCBpbmRleCBtYXRjaGVzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICBwcmltYXJ5OiB7XG4gICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnaWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBieVN0YXR1czoge1xuICAgICAgICAgICAgICAgICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgICAgICAgICAgICAgICBwazogeyBjb21wb3NpdGU6IFsgJ3N0YXR1cycgXSB9LFxuICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFtdIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55O1xuXG4gICAgICAgIGNvbnN0IGZpbHRlcnMgPSB7XG4gICAgICAgICAgICBzdGF0dXM6ICdhY3RpdmUnLFxuICAgICAgICAgICAgcmFuZG9tRmllbGQ6ICd2YWx1ZSdcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlcnMsICd0ZXN0RW50aXR5JywgZW50aXR5U2VydmljZSk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgaW5kZXhOYW1lOiAnYnlTdGF0dXMnLFxuICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJ1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdGaWx0ZXJHcm91cCBmb3JtYXQgc3VwcG9ydCcsICgpID0+IHtcbiAgICAgICAgLy8gU2hhcmVkIHNjaGVtYSB0aGF0IG1hdGNoZXMgdGhlIFRlc3RFbnRpdHkgaW4gYmVmb3JlRWFjaFxuICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICBwcmltYXJ5OiB7IHBrOiB7IGNvbXBvc2l0ZTogWyAnaWQnIF0gfSwgc2s6IHsgY29tcG9zaXRlOiBbXSB9IH0sXG4gICAgICAgICAgICAgICAgYnlTdGF0dXM6IHsgaW5kZXg6ICdnc2kxJywgcGs6IHsgY29tcG9zaXRlOiBbICdzdGF0dXMnIF0gfSwgc2s6IHsgY29tcG9zaXRlOiBbXSB9IH0sXG4gICAgICAgICAgICAgICAgYnlTdGF0dXNBbmRUeXBlOiB7IGluZGV4OiAnZ3NpMicsIHBrOiB7IGNvbXBvc2l0ZTogWyAnc3RhdHVzJyBdIH0sIHNrOiB7IGNvbXBvc2l0ZTogWyAndHlwZScgXSB9IH0sXG4gICAgICAgICAgICAgICAgYnlUZW1wbGF0ZTogeyBpbmRleDogJ2dzaTMnLCBwazogeyBjb21wb3NpdGU6IFtdLCB0ZW1wbGF0ZTogJ3Rlc3RFbnRpdHknIH0sIHNrOiB7IGNvbXBvc2l0ZTogW10gfSB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55O1xuXG4gICAgICAgIGl0KCdzaG91bGQgbWF0Y2ggaW5kZXggd2l0aCBGaWx0ZXJHcm91cCBmb3JtYXQgZmlsdGVycycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdpZCcgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5U3RhdHVzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdzdGF0dXMnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBhcyBhbnk7XG5cbiAgICAgICAgICAgIC8vIFRoaXMgaXMgdGhlIGZvcm1hdCBwcm9kdWNlZCBieSBxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXBcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGZpbHRlcklkOiAncXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwJyxcbiAgICAgICAgICAgICAgICBhbmQ6IFsgeyBhdHRyaWJ1dGU6ICdzdGF0dXMnLCBlcTogJ2FjdGl2ZScgfSBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlckdyb3VwLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuICAgICAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgaW5kZXhOYW1lOiAnYnlTdGF0dXMnLFxuICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6ICdhY3RpdmUnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgbWF0Y2ggY29tcG9zaXRlIGluZGV4IHdpdGggbXVsdGlwbGUgRmlsdGVyR3JvdXAgZmlsdGVycycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdpZCcgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5U3RhdHVzQW5kVHlwZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnc3RhdHVzJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFsgJ3R5cGUnIF0gfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBhcyBhbnk7XG5cbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGZpbHRlcklkOiAncXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwJyxcbiAgICAgICAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdzdGF0dXMnLCBlcTogJ2FjdGl2ZScgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICd0eXBlJywgZXE6ICd1c2VyJyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJHcm91cCwgJ3Rlc3RFbnRpdHknLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5U3RhdHVzQW5kVHlwZScsXG4gICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICd1c2VyJ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBGaWx0ZXJHcm91cCB3aXRoIG5vbi1tYXRjaGluZyBmaWx0ZXJzIChmYWxsYmFjayB0byB0ZW1wbGF0ZSknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnaWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBieVRlbXBsYXRlOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbXSwgdGVtcGxhdGU6ICd0ZXN0RW50aXR5JyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogWyB7IGF0dHJpYnV0ZTogJ25vbkV4aXN0ZW50RmllbGQnLCBlcTogJ3ZhbHVlJyB9IF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVyR3JvdXAsICd0ZXN0RW50aXR5JywgZW50aXR5U2VydmljZSk7XG4gICAgICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBpbmRleE5hbWU6ICdieVRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHt9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgZW1wdHkgRmlsdGVyR3JvdXAnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnaWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBieVRlbXBsYXRlOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogJ2dzaTMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbXSwgdGVtcGxhdGU6ICd0ZXN0RW50aXR5JyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogW10sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVyR3JvdXAsICd0ZXN0RW50aXR5JywgZW50aXR5U2VydmljZSk7XG4gICAgICAgICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBpbmRleE5hbWU6ICdieVRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHt9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgcmVhbC13b3JsZCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgZmlsdGVyIHNjZW5hcmlvJywgKCkgPT4ge1xuICAgICAgICAgICAgLy8gQ3JlYXRlIGVudGl0eSB3aXRoIGJ5UGFyZW50IGluZGV4IGxpa2Ugb2JzZXJ2YWJpbGl0eSBsb2dzXG4gICAgICAgICAgICBjb25zdCBPYnNFbnRpdHkgPSBuZXcgRW50aXR5KHtcbiAgICAgICAgICAgICAgICBtb2RlbDoge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHk6IFwib2JzZXJ2YWJpbGl0eUxvZ1wiLFxuICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiBcIjFcIixcbiAgICAgICAgICAgICAgICAgICAgc2VydmljZTogXCJvYnNlcnZhYmlsaXR5XCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IHR5cGU6IFwic3RyaW5nXCIsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyB0eXBlOiBcInN0cmluZ1wiIH0sXG4gICAgICAgICAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHsgdHlwZTogXCJzdHJpbmdcIiB9LFxuICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXBNczogeyB0eXBlOiBcIm51bWJlclwiIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgZmllbGQ6IFwicGtcIiwgY29tcG9zaXRlOiBbIFwib2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwic2tcIiwgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5UGFyZW50OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogXCJnc2kyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBwazogeyBmaWVsZDogXCJnc2kycGtcIiwgY29tcG9zaXRlOiBbIFwicGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMnNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5VHJhY2U6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4OiBcImdzaTFcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGZpZWxkOiBcImdzaTFwa1wiLCBjb21wb3NpdGU6IFsgXCJjb3JyZWxhdGlvbklkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMXNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3Qgb2JzRW50aXR5U2VydmljZSA9IHtcbiAgICAgICAgICAgICAgICBnZXRSZXBvc2l0b3J5OiAoKSA9PiBPYnNFbnRpdHlcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdvYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBieVBhcmVudDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgYnlUcmFjZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnY29ycmVsYXRpb25JZCcgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICAgICAgLy8gVGhpcyBpcyBleGFjdGx5IHdoYXQgdGhlIGNvbnRyb2xsZXIgcmVjZWl2ZXMgZnJvbSBxdWVyeSBzdHJpbmcgcGFyc2luZ1xuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogWyB7XG4gICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZTogJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcsXG4gICAgICAgICAgICAgICAgICAgIGVxOiAnODViN2VhYWQtNzJjZC00MTJkLThmYmItYjk1MzdiMzQxM2Q1J1xuICAgICAgICAgICAgICAgIH0gXSxcbiAgICAgICAgICAgICAgICBvcjogW10sXG4gICAgICAgICAgICAgICAgbm90OiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gZmluZE1hdGNoaW5nSW5kZXgoc2NoZW1hLCBmaWx0ZXJHcm91cCwgJ29ic2VydmFiaWxpdHlMb2cnLCBvYnNFbnRpdHlTZXJ2aWNlIGFzIGFueSk7XG5cbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5UGFyZW50JyxcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnODViN2VhYWQtNzJjZC00MTJkLThmYmItYjk1MzdiMzQxM2Q1J1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIG1hdGNoIGNvcnJlbGF0aW9uSWQgZmlsdGVyIHRvIGJ5VHJhY2UgaW5kZXgnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBPYnNFbnRpdHkgPSBuZXcgRW50aXR5KHtcbiAgICAgICAgICAgICAgICBtb2RlbDoge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHk6IFwib2JzZXJ2YWJpbGl0eUxvZ1wiLFxuICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiBcIjFcIixcbiAgICAgICAgICAgICAgICAgICAgc2VydmljZTogXCJvYnNlcnZhYmlsaXR5XCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IHR5cGU6IFwic3RyaW5nXCIsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyB0eXBlOiBcInN0cmluZ1wiIH0sXG4gICAgICAgICAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHsgdHlwZTogXCJzdHJpbmdcIiB9LFxuICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXBNczogeyB0eXBlOiBcIm51bWJlclwiIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgZmllbGQ6IFwicGtcIiwgY29tcG9zaXRlOiBbIFwib2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwic2tcIiwgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5UGFyZW50OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogXCJnc2kyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBwazogeyBmaWVsZDogXCJnc2kycGtcIiwgY29tcG9zaXRlOiBbIFwicGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMnNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5VHJhY2U6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4OiBcImdzaTFcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGZpZWxkOiBcImdzaTFwa1wiLCBjb21wb3NpdGU6IFsgXCJjb3JyZWxhdGlvbklkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMXNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3Qgb2JzRW50aXR5U2VydmljZSA9IHtcbiAgICAgICAgICAgICAgICBnZXRSZXBvc2l0b3J5OiAoKSA9PiBPYnNFbnRpdHlcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+ID0ge1xuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdvYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNrOiB7IGNvbXBvc2l0ZTogW10gfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBieVBhcmVudDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzazogeyBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH1cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgYnlUcmFjZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6ICdnc2kxJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGNvbXBvc2l0ZTogWyAnY29ycmVsYXRpb25JZCcgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbICd0aW1lc3RhbXBNcycgXSB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogWyB7XG4gICAgICAgICAgICAgICAgICAgIGF0dHJpYnV0ZTogJ2NvcnJlbGF0aW9uSWQnLFxuICAgICAgICAgICAgICAgICAgICBlcTogJ3RyYWNlLTEyMy00NTYnXG4gICAgICAgICAgICAgICAgfSBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlckdyb3VwLCAnb2JzZXJ2YWJpbGl0eUxvZycsIG9ic0VudGl0eVNlcnZpY2UgYXMgYW55KTtcblxuICAgICAgICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgICAgICAgICAgaW5kZXhOYW1lOiAnYnlUcmFjZScsXG4gICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0cmFjZS0xMjMtNDU2J1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHNlbGVjdCBjb3JyZWN0IGluZGV4IHdoZW4gRmlsdGVyR3JvdXAgaGFzIG11bHRpcGxlIEdTSS1lbGlnaWJsZSBhdHRyaWJ1dGVzJywgKCkgPT4ge1xuICAgICAgICAgICAgLy8gUmVhbCBzY2VuYXJpbzogZmlsdGVyIGhhcyBib3RoIGNvcnJlbGF0aW9uSWQgQU5EIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZFxuICAgICAgICAgICAgLy8gRWxlY3Ryb0RCIHNob3VsZCBwaWNrIHRoZSBiZXN0IG1hdGNoaW5nIGluZGV4XG4gICAgICAgICAgICBjb25zdCBPYnNFbnRpdHkgPSBuZXcgRW50aXR5KHtcbiAgICAgICAgICAgICAgICBtb2RlbDogeyBlbnRpdHk6IFwib2JzZXJ2YWJpbGl0eUxvZ1wiLCB2ZXJzaW9uOiBcIjFcIiwgc2VydmljZTogXCJvYnNcIiB9LFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiB7IHR5cGU6IFwic3RyaW5nXCIsIHJlcXVpcmVkOiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogeyB0eXBlOiBcInN0cmluZ1wiIH0sXG4gICAgICAgICAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHsgdHlwZTogXCJzdHJpbmdcIiB9LFxuICAgICAgICAgICAgICAgICAgICB0eXBlOiB7IHR5cGU6IFwic3RyaW5nXCIgfSxcbiAgICAgICAgICAgICAgICAgICAgbGV2ZWw6IHsgdHlwZTogXCJzdHJpbmdcIiB9LFxuICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXBNczogeyB0eXBlOiBcIm51bWJlclwiIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGluZGV4ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbWFyeToge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgZmllbGQ6IFwicGtcIiwgY29tcG9zaXRlOiBbIFwib2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwic2tcIiwgY29tcG9zaXRlOiBbXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5UGFyZW50OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogXCJnc2kyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBwazogeyBmaWVsZDogXCJnc2kycGtcIiwgY29tcG9zaXRlOiBbIFwicGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMnNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5VHJhY2U6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4OiBcImdzaTFcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIHBrOiB7IGZpZWxkOiBcImdzaTFwa1wiLCBjb21wb3NpdGU6IFsgXCJjb3JyZWxhdGlvbklkXCIgXSB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgc2s6IHsgZmllbGQ6IFwiZ3NpMXNrXCIsIGNvbXBvc2l0ZTogWyBcInRpbWVzdGFtcE1zXCIgXSB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5VHlwZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXg6IFwiZ3NpM1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGs6IHsgZmllbGQ6IFwiZ3NpM3BrXCIsIGNvbXBvc2l0ZTogWyBcInR5cGVcIiBdIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzazogeyBmaWVsZDogXCJnc2kzc2tcIiwgY29tcG9zaXRlOiBbIFwidGltZXN0YW1wTXNcIiBdIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIHByaW1hcnk6IHsgcGs6IHsgY29tcG9zaXRlOiBbICdvYnNlcnZhYmlsaXR5TG9nSWQnIF0gfSwgc2s6IHsgY29tcG9zaXRlOiBbXSB9IH0sXG4gICAgICAgICAgICAgICAgICAgIGJ5UGFyZW50OiB7IGluZGV4OiAnZ3NpMicsIHBrOiB7IGNvbXBvc2l0ZTogWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdIH0sIHNrOiB7IGNvbXBvc2l0ZTogWyAndGltZXN0YW1wTXMnIF0gfSB9LFxuICAgICAgICAgICAgICAgICAgICBieVRyYWNlOiB7IGluZGV4OiAnZ3NpMScsIHBrOiB7IGNvbXBvc2l0ZTogWyAnY29ycmVsYXRpb25JZCcgXSB9LCBzazogeyBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgYnlUeXBlOiB7IGluZGV4OiAnZ3NpMycsIHBrOiB7IGNvbXBvc2l0ZTogWyAndHlwZScgXSB9LCBzazogeyBjb21wb3NpdGU6IFsgJ3RpbWVzdGFtcE1zJyBdIH0gfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gYXMgYW55O1xuXG4gICAgICAgICAgICAvLyBGaWx0ZXJHcm91cCB3aXRoIG11bHRpcGxlIEdTSSBQSyBhdHRyaWJ1dGVzXG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJJZDogJ3F1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCcsXG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJywgZXE6ICdwYXJlbnQtMTIzJyB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2NvcnJlbGF0aW9uSWQnLCBlcTogJ3RyYWNlLTQ1NicgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdsZXZlbCcsIGVxOiAnZXJyb3InIH0gIC8vIE5vdCBhIEdTSSBQS1xuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSwgZmlsdGVyR3JvdXAsICdvYnNlcnZhYmlsaXR5TG9nJywgeyBnZXRSZXBvc2l0b3J5OiAoKSA9PiBPYnNFbnRpdHkgfSBhcyBhbnkpO1xuXG4gICAgICAgICAgICAvLyBFbGVjdHJvREIgcGlja3Mgb25lIC0gcmVzdWx0IHNob3VsZCBoYXZlIG9uZSBvZiB0aGUgR1NJIG5hbWVzXG4gICAgICAgICAgICBleHBlY3QocmVzdWx0KS50b0JlRGVmaW5lZCgpO1xuICAgICAgICAgICAgZXhwZWN0KFsgJ2J5UGFyZW50JywgJ2J5VHJhY2UnIF0pLnRvQ29udGFpbihyZXN1bHQhLmluZGV4TmFtZSk7XG4gICAgICAgICAgICAvLyBUaGUgc2VsZWN0ZWQgaW5kZXgncyBQSyB2YWx1ZSBzaG91bGQgYmUgaW4gaW5kZXhGaWx0ZXJzXG4gICAgICAgICAgICBleHBlY3QoXG4gICAgICAgICAgICAgICAgcmVzdWx0IS5pbmRleEZpbHRlcnMucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50LTEyMycgfHxcbiAgICAgICAgICAgICAgICByZXN1bHQhLmluZGV4RmlsdGVycy5jb3JyZWxhdGlvbklkID09PSAndHJhY2UtNDU2J1xuICAgICAgICAgICAgKS50b0JlKHRydWUpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBGaWx0ZXJHcm91cCB3aXRoIEFORCArIE9SICsgTk9UIGFuZCBzZWxlY3QgaW5kZXggZnJvbSBBTkQgb25seScsICgpID0+IHtcbiAgICAgICAgICAgIC8vIE9SIGFuZCBOT1QgY29uZGl0aW9ucyBjYW4ndCBiZSB1c2VkIGZvciBHU0kgUEsgc2VsZWN0aW9uXG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJJZDogJ3F1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCcsXG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnc3RhdHVzJywgZXE6ICdhY3RpdmUnIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAndHlwZScsIGVxOiAnc3Bhbi5zdGFydCcgfSxcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICd0eXBlJywgZXE6ICdzcGFuJyB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICduYW1lJywgZXE6ICdpbnRlcm5hbCcgfVxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSBhcyBhbnksIGZpbHRlckdyb3VwLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgICAgICAgICAvLyBTaG91bGQgdXNlIGJ5U3RhdHVzIGluZGV4IGZyb20gdGhlIEFORCBjb25kaXRpb25cbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5U3RhdHVzJyxcbiAgICAgICAgICAgICAgICBpbmRleEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGZhbGxiYWNrIHRvIHRlbXBsYXRlIHdoZW4gRmlsdGVyR3JvdXAgQU5EIGhhcyBubyBHU0ktbWF0Y2hpbmcgYXR0cmlidXRlcycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZpbHRlckdyb3VwID0ge1xuICAgICAgICAgICAgICAgIGZpbHRlcklkOiAncXVlcnlTdHJpbmdQYXJhbXNUb0ZpbHRlckdyb3VwJyxcbiAgICAgICAgICAgICAgICBhbmQ6IFtcbiAgICAgICAgICAgICAgICAgICAgeyBhdHRyaWJ1dGU6ICdyYW5kb21GaWVsZCcsIGVxOiAnc29tZVZhbHVlJyB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ2Fub3RoZXJGaWVsZCcsIGNvbnRhaW5zOiAndGV4dCcgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgb3I6IFtdLFxuICAgICAgICAgICAgICAgIG5vdDogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbmRNYXRjaGluZ0luZGV4KHNjaGVtYSBhcyBhbnksIGZpbHRlckdyb3VwLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgICAgICAgICAvLyBObyBHU0kgbWF0Y2gsIGZhbGxzIGJhY2sgdG8gdGVtcGxhdGVcbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5VGVtcGxhdGUnLFxuICAgICAgICAgICAgICAgIGluZGV4RmlsdGVyczoge31cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHJldHVybiB1bmRlZmluZWQgd2hlbiBGaWx0ZXJHcm91cCBBTkQgaXMgZW1wdHkgYW5kIG5vIHRlbXBsYXRlIGV4aXN0cycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNjaGVtYU5vVGVtcGxhdGU6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiA9IHtcbiAgICAgICAgICAgICAgICBpbmRleGVzOiB7XG4gICAgICAgICAgICAgICAgICAgIHByaW1hcnk6IHsgcGs6IHsgY29tcG9zaXRlOiBbICdpZCcgXSB9LCBzazogeyBjb21wb3NpdGU6IFtdIH0gfSxcbiAgICAgICAgICAgICAgICAgICAgYnlTdGF0dXM6IHsgaW5kZXg6ICdnc2kxJywgcGs6IHsgY29tcG9zaXRlOiBbICdzdGF0dXMnIF0gfSwgc2s6IHsgY29tcG9zaXRlOiBbXSB9IH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGFzIGFueTtcblxuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgYW5kOiBbXSxcbiAgICAgICAgICAgICAgICBvcjogWyB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGVxOiAnYWN0aXZlJyB9IF0sICAvLyBPUiBjYW4ndCBiZSB1c2VkIGZvciBHU0lcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWFOb1RlbXBsYXRlLCBmaWx0ZXJHcm91cCwgJ25vbkV4aXN0ZW50RW50aXR5JywgZW50aXR5U2VydmljZSk7XG5cbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29tcG9zaXRlIEdTSSAoUEsgKyBTSykgd2l0aCBGaWx0ZXJHcm91cCBmb3JtYXQnLCAoKSA9PiB7XG4gICAgICAgICAgICAvLyBieVN0YXR1c0FuZFR5cGUgaGFzIFBLPXN0YXR1cywgU0s9dHlwZVxuICAgICAgICAgICAgY29uc3QgZmlsdGVyR3JvdXAgPSB7XG4gICAgICAgICAgICAgICAgZmlsdGVySWQ6ICdxdWVyeVN0cmluZ1BhcmFtc1RvRmlsdGVyR3JvdXAnLFxuICAgICAgICAgICAgICAgIGFuZDogW1xuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3N0YXR1cycsIGVxOiAnYWN0aXZlJyB9LFxuICAgICAgICAgICAgICAgICAgICB7IGF0dHJpYnV0ZTogJ3R5cGUnLCBlcTogJ3VzZXInIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlckdyb3VwLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgICAgICAgICAvLyBTaG91bGQgbWF0Y2ggY29tcG9zaXRlIGluZGV4IHdpdGggYm90aCBQSyBhbmQgU0tcbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ2J5U3RhdHVzQW5kVHlwZScsXG4gICAgICAgICAgICAgICAgaW5kZXhGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6ICd1c2VyJ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBGaWx0ZXJHcm91cCB3aXRoIG9ubHkgUEsgbWF0Y2ggb24gY29tcG9zaXRlIEdTSScsICgpID0+IHtcbiAgICAgICAgICAgIC8vIGJ5U3RhdHVzQW5kVHlwZSBoYXMgUEs9c3RhdHVzLCBTSz10eXBlIC0gb25seSBwcm92aWRpbmcgc3RhdHVzXG4gICAgICAgICAgICBjb25zdCBmaWx0ZXJHcm91cCA9IHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJJZDogJ3F1ZXJ5U3RyaW5nUGFyYW1zVG9GaWx0ZXJHcm91cCcsXG4gICAgICAgICAgICAgICAgYW5kOiBbXG4gICAgICAgICAgICAgICAgICAgIHsgYXR0cmlidXRlOiAnc3RhdHVzJywgZXE6ICdhY3RpdmUnIH1cbiAgICAgICAgICAgICAgICAgICAgLy8gTm8gdHlwZSBmaWx0ZXJcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIG9yOiBbXSxcbiAgICAgICAgICAgICAgICBub3Q6IFtdXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBmaW5kTWF0Y2hpbmdJbmRleChzY2hlbWEsIGZpbHRlckdyb3VwLCAndGVzdEVudGl0eScsIGVudGl0eVNlcnZpY2UpO1xuXG4gICAgICAgICAgICAvLyBTaG91bGQgc3RpbGwgbWF0Y2ggYW4gaW5kZXggd2l0aCBzdGF0dXMgYXMgUEtcbiAgICAgICAgICAgIGV4cGVjdChyZXN1bHQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICAgICAgICBleHBlY3QocmVzdWx0IS5pbmRleEZpbHRlcnMuc3RhdHVzKS50b0JlKCdhY3RpdmUnKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59KTsgIl19