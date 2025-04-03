import { EntitySchema } from './base-entity';
import { findMatchingIndex } from './crud-service';
import { Entity } from 'electrodb';

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
        const schema: EntitySchema<any, any, any> = {
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
                    pk: { composite: ['id'] },
                    sk: { composite: [] }
                },
                byStatusAndType: {
                    index: 'gsi2',
                    pk: { composite: ['status'] },
                    sk: { composite: ['type'] }
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
                    pk: { composite: ['id'] },
                    sk: { composite: [] }
                },
                byStatusAndType: {
                    index: 'gsi2',
                    pk: { composite: ['status'] },
                    sk: { composite: ['type'] }
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
                    pk: { composite: ['id'] },
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
                    pk: { composite: ['id'] },
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
                    pk: { composite: ['id'] },
                    sk: { composite: [] }
                },
                byStatus: {
                    index: 'gsi1',
                    pk: { composite: ['status'] },
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
}); 