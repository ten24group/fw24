"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
const __1 = require("..");
const decorators_1 = require("../../decorators");
const di_1 = require("../../di");
const search_1 = require("../../search");
const entitySchema = (0, __1.createEntitySchema)({
    model: {
        entity: 'test',
        service: 'test-service',
        version: '1',
        entityNamePlural: 'tests',
        entityOperations: __1.DefaultEntityOperations,
    },
    attributes: {
        id: {
            type: 'string',
            required: true,
        },
        name: {
            type: 'string',
            required: true,
        },
        description: {
            type: 'string',
            required: true,
        },
        createdAt: {
            type: 'string',
            required: true,
        },
        updatedAt: {
            type: 'string',
        },
    },
    indexes: {
        primary: {
            pk: {
                composite: ['id'],
                field: 'pk',
            },
            sk: {
                composite: ['id'],
                field: 'sk',
            }
        }
    }
});
let TestEntityService = class TestEntityService extends __1.BaseEntityService {
    constructor(entityConfigurations = {
        table: 'test-table-entity-search-integration-test',
    }) {
        super(entitySchema, entityConfigurations, di_1.DIContainer.ROOT);
    }
};
TestEntityService = __decorate([
    (0, decorators_1.Service)()
], TestEntityService);
di_1.DIContainer.ROOT.setSearchEngine(new search_1.MeiliSearchEngine({
    host: 'http://localhost:7700',
    apiKey: 'xxx_your_master_key',
}));
const delay = async (ms) => await new Promise(resolve => setTimeout(resolve, ms));
describe('Entity Search', () => {
    let entityService;
    beforeAll(async () => {
        entityService = di_1.DIContainer.ROOT.resolve(TestEntityService);
        const searchService = entityService.getSearchService();
        const engine = searchService.getEngine();
        const indexName = entityService.getEntitySearchConfig().indexConfig?.indexName;
        // Clean up and create index
        try {
            console.log('checking if index exists', indexName);
            const exists = await engine.indexExists(indexName);
            if (exists) {
                console.log('deleting old index', indexName);
                await engine.deleteIndex(indexName, true);
            }
        }
        catch { }
        await delay(1000);
        console.log('initializing new index', indexName);
        await searchService.initSearchIndex();
        await delay(2000);
    }, 60000);
    beforeEach(async () => {
        // Clear all documents from the index before each test to ensure isolation
        const searchService = entityService.getSearchService();
        const engine = searchService.getEngine();
        const indexName = entityService.getEntitySearchConfig().indexConfig?.indexName;
        try {
            await engine.deleteAllDocuments(indexName, true);
            await delay(1000); // Wait for delete operation to complete
        }
        catch (error) {
            // Ignore errors during cleanup
        }
    }, 10000);
    afterAll(async () => {
        const searchService = entityService.getSearchService();
        const engine = searchService.getEngine();
        const indexName = entityService.getEntitySearchConfig().indexConfig?.indexName;
        try {
            await engine.deleteIndex(indexName, true);
        }
        catch { }
    }, 60000);
    it('should be able to search for an entity', async () => {
        const searchResult = await entityService.search({ search: 'abcd' });
        console.log(searchResult);
        expect(searchResult).toBeDefined();
        expect(searchResult.hits).toBeDefined();
    }, 50000);
    it('should index an entity', async () => {
        // wait time to make sure changes are propagated in the search engine
        await delay(1000);
        await entityService.getSearchService().syncToIndex({
            id: '1',
            name: 'test',
            description: 'test',
            createdAt: '2021-01-01',
            updatedAt: '2021-01-01',
        });
        await delay(1000);
        const searchResult = await entityService.getSearchService().search({
            search: 'test',
        });
        console.log(searchResult);
        expect(searchResult).toBeDefined();
        expect(searchResult.hits).toBeDefined();
        expect(searchResult.hits.length).toBe(1);
        expect(searchResult.hits[0].id).toBe('1');
    }, 50000);
    it('should bulk index multiple entities and search them all', async () => {
        const entities = [
            { id: '2', name: 'alpha', description: 'first', createdAt: '2021-01-02', updatedAt: '2021-01-02' },
            { id: '3', name: 'beta', description: 'second', createdAt: '2021-01-03', updatedAt: '2021-01-03' },
            { id: '4', name: 'gamma', description: 'third', createdAt: '2021-01-04', updatedAt: '2021-01-04' },
        ];
        await entityService.getSearchService().bulkSync(entities);
        await delay(1000);
        const searchResult = await entityService.search({ search: '' });
        expect(searchResult.total).toBeGreaterThanOrEqual(entities.length);
        const ids = searchResult.hits.map(h => h.id);
        expect(ids).toEqual(expect.arrayContaining(['2', '3', '4']));
    }, 50000);
    it('should filter results by attribute', async () => {
        await entityService.getSearchService().updateIndexSettings({
            filterableAttributes: ['name'],
        }, true);
        await delay(1000);
        await entityService.getSearchService().syncToIndex({
            id: '1',
            name: 'alpha',
            description: 'test',
            createdAt: '2021-01-01',
            updatedAt: '2021-01-01',
        });
        await delay(1000);
        const searchResult = await entityService.search({ filters: { name: { eq: 'alpha' } } });
        expect(searchResult.hits.length).toBe(1);
        expect(searchResult.hits[0].name).toBe('alpha');
    }, 20000);
    it('should sort results by createdAt descending', async () => {
        await entityService.getSearchService().updateIndexSettings({
            sortableAttributes: ['createdAt'],
        }, true);
        await delay(1000);
        await entityService.getSearchService().bulkSync([{
                id: '1',
                name: 'alpha',
                description: 'test',
                createdAt: '2021-01-01',
                updatedAt: '2021-01-01',
            },
            {
                id: '2',
                name: 'beta',
                description: 'test',
                createdAt: '2021-01-02',
                updatedAt: '2021-01-02',
            },
            {
                id: '3',
                name: 'gamma',
                description: 'test',
                createdAt: '2021-01-03',
                updatedAt: '2021-01-03',
            }]);
        await delay(1000);
        const searchResult = await entityService.search({ sort: [{ field: 'createdAt', dir: 'desc' }] });
        expect(searchResult.hits.length).toBeGreaterThan(1);
        const dates = searchResult.hits.map(h => h.createdAt);
        expect(dates).toEqual([...dates].sort().reverse());
    }, 20000);
    it('should paginate results', async () => {
        await entityService.getSearchService().bulkSync([
            { id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01' },
            { id: '2', name: 'beta', description: 'test', createdAt: '2021-01-02', updatedAt: '2021-01-02' },
            { id: '3', name: 'gamma', description: 'test', createdAt: '2021-01-03', updatedAt: '2021-01-03' },
            { id: '4', name: 'delta', description: 'test', createdAt: '2021-01-04', updatedAt: '2021-01-04' },
            { id: '5', name: 'epsilon', description: 'test', createdAt: '2021-01-05', updatedAt: '2021-01-05' },
            { id: '6', name: 'zeta', description: 'test', createdAt: '2021-01-06', updatedAt: '2021-01-06' },
            { id: '7', name: 'eta', description: 'test', createdAt: '2021-01-07', updatedAt: '2021-01-07' },
            { id: '8', name: 'theta', description: 'test', createdAt: '2021-01-08', updatedAt: '2021-01-08' },
            { id: '9', name: 'iota', description: 'test', createdAt: '2021-01-09', updatedAt: '2021-01-09' },
            { id: '10', name: 'kappa', description: 'test', createdAt: '2021-01-10', updatedAt: '2021-01-10' },
        ]);
        await delay(1000);
        const page1 = await entityService.search({ pagination: { page: 1, limit: 2 } });
        const page2 = await entityService.search({ pagination: { page: 2, limit: 2 } });
        expect(page1.hits.length).toBeLessThanOrEqual(2);
        expect(page2.hits.length).toBeLessThanOrEqual(2);
        if (page1.hits.length > 0 && page2.hits.length > 0) {
            expect(page1.hits[0].id).not.toBe(page2.hits[0].id);
        }
    }, 20000);
    it('should select only specific fields', async () => {
        await entityService.getSearchService().bulkSync([
            { id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01' },
            { id: '2', name: 'beta', description: 'test', createdAt: '2021-01-02', updatedAt: '2021-01-02' },
        ]);
        await delay(1000);
        const searchResult = await entityService.search({ select: ['id', 'name'] });
        expect(searchResult.hits.length).toBeGreaterThan(0);
        for (const hit of searchResult.hits) {
            expect(Object.keys(hit)).toEqual(expect.arrayContaining(['id', 'name']));
        }
    }, 20000);
    it('should return distinct results by name', async () => {
        await entityService.getSearchService().updateIndexSettings({
            filterableAttributes: ['name'],
        }, true);
        await delay(1000);
        await entityService.getSearchService().bulkSync([
            {
                id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01'
            },
            {
                id: '5', name: 'alpha', description: 'duplicate', createdAt: '2021-01-05', updatedAt: '2021-01-05'
            }
        ]);
        await delay(1000);
        const searchResult = await entityService.search({ distinct: 'name' });
        const names = searchResult.hits.map(h => h.name);
        expect(new Set(names).size).toBe(names.length);
    }, 20000);
    it('should delete an entity from the index', async () => {
        await entityService.getSearchService().updateIndexSettings({
            filterableAttributes: ['id'],
        }, true);
        await delay(1000);
        await entityService.getSearchService().bulkSync([
            {
                id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01'
            },
            {
                id: '2', name: 'alpha', description: 'duplicate', createdAt: '2021-01-05', updatedAt: '2021-01-05'
            }
        ]);
        await delay(1000);
        await entityService.getSearchService().deleteFromIndex('2');
        await delay(1000);
        const searchResult = await entityService.search({ filters: { id: { eq: '2' } } });
        expect(searchResult.hits.length).toBe(0);
    }, 20000);
    it('should update an indexed entity', async () => {
        await entityService.getSearchService().updateIndexSettings({
            filterableAttributes: ['id'],
        }, true);
        await delay(1000);
        await entityService.getSearchService().bulkSync([
            {
                id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01'
            },
            {
                id: '3', name: 'alpha', description: 'duplicate', createdAt: '2021-01-05', updatedAt: '2021-01-05'
            }
        ]);
        await delay(1000);
        await entityService.getSearchService().syncToIndex({
            id: '3', name: 'beta-updated', description: 'second-updated', createdAt: '2021-01-03', updatedAt: '2021-01-06',
        });
        await delay(1000);
        const searchResult = await entityService.search({ filters: { id: { eq: '3' } } });
        expect(searchResult.hits.length).toBe(1);
        expect(searchResult.hits[0].name).toBe('beta-updated');
    }, 20000);
    it('should return empty results for non-existent search', async () => {
        const searchResult = await entityService.search({ search: 'nonexistentterm' });
        expect(searchResult.hits.length).toBe(0);
    }, 10000);
    it('should return all results for empty search', async () => {
        await entityService.getSearchService().bulkSync([
            {
                id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01'
            },
            {
                id: '3', name: 'alpha', description: 'duplicate', createdAt: '2021-01-05', updatedAt: '2021-01-05'
            }
        ]);
        await delay(1000);
        const searchResult = await entityService.search({ search: '' });
        expect(searchResult.hits.length).toBe(2);
    }, 10000);
    describe('Geo Search', () => {
        // ─── Geo Search Tests ───────────────────────────────────────────────────────
        const geoEntities = [
            {
                id: 'geo-1',
                name: 'Eiffel Tower',
                description: 'Landmark in Paris, France',
                createdAt: '2023-01-01',
                _geo: { lat: 48.8584, lng: 2.2945 }, // Paris
            },
            {
                id: 'geo-2',
                name: 'Colosseum',
                description: 'Amphitheatre in Rome, Italy',
                createdAt: '2023-01-02',
                _geo: { lat: 41.8902, lng: 12.4922 }, // Rome
            },
            {
                id: 'geo-3',
                name: 'Brandenburg Gate',
                description: 'Monument in Berlin, Germany',
                createdAt: '2023-01-03',
                _geo: { lat: 52.5163, lng: 13.3777 }, // Berlin
            },
            {
                id: 'geo-4',
                name: 'Louvre Museum',
                description: 'Art museum in Paris, France',
                createdAt: '2023-01-04',
                _geo: { lat: 48.8606, lng: 2.3376 }, // Paris, near Eiffel Tower
            },
        ];
        beforeEach(async () => {
            await entityService.getSearchService().updateIndexSettings({
                filterableAttributes: ['_geo', 'name'],
                sortableAttributes: ['_geo'], // Also make it sortable for later tests
            }, true);
            await delay(1000);
            await entityService.getSearchService().bulkSync(geoEntities);
            await delay(1000);
        });
        it('should filter results by geoRadius', async () => {
            // Search for locations within 5km of a point in central Paris
            const searchResult = await entityService.search({
                geoRadiusFilter: {
                    center: { lat: 48.8570, lng: 2.3400 }, // Approx. central Paris
                    distanceInMeters: 5000, // 5km
                },
            });
            expect(searchResult.hits.length).toBe(2); // Eiffel Tower and Louvre Museum
            const names = searchResult.hits.map(h => h.name).sort();
            expect(names).toEqual(['Eiffel Tower', 'Louvre Museum'].sort());
        }, 20000);
        it('should sort results by _geoPoint ascending (nearest first)', async () => {
            // Sort by distance from a point closer to Eiffel Tower than Louvre
            const referencePoint = { lat: 48.8580, lng: 2.2900 }; // Very close to Eiffel Tower
            const searchResult = await entityService.search({
                // No text search, get all relevant geo entities
                geoSort: {
                    point: referencePoint,
                    direction: 'asc',
                },
                // Filter to only include Paris landmarks for a clearer sort test
                filters: { name: { in: ['Eiffel Tower', 'Louvre Museum'] } }
            });
            // Expect Eiffel Tower to be first, then Louvre
            expect(searchResult.hits.length).toBe(2);
            expect(searchResult.hits[0].name).toBe('Eiffel Tower');
            expect(searchResult.hits[1].name).toBe('Louvre Museum');
        }, 20000);
        it('should sort results by _geoPoint descending (farthest first)', async () => {
            const referencePoint = { lat: 48.8580, lng: 2.2900 }; // Very close to Eiffel Tower
            const searchResult = await entityService.search({
                geoSort: {
                    point: referencePoint,
                    direction: 'desc',
                },
                filters: { name: { in: ['Eiffel Tower', 'Louvre Museum'] } }
            });
            // Expect Louvre to be first (farthest from ref point), then Eiffel Tower
            expect(searchResult.hits.length).toBe(2);
            expect(searchResult.hits[0].name).toBe('Louvre Museum');
            expect(searchResult.hits[1].name).toBe('Eiffel Tower');
        }, 20000);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXNlYXJjaC5pbnRlZ3JhdGlvbi50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2VudGl0eS9pbnRlZ3JhdGlvbi10ZXN0L2VudGl0eS1zZWFyY2guaW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUVBLDBCQUFvRjtBQUNwRixpREFBMkM7QUFDM0MsaUNBQXVDO0FBQ3ZDLHlDQUFpRDtBQUdqRCxNQUFNLFlBQVksR0FBRyxJQUFBLHNCQUFrQixFQUFDO0lBQ3RDLEtBQUssRUFBRTtRQUNMLE1BQU0sRUFBRSxNQUFNO1FBQ2QsT0FBTyxFQUFFLGNBQWM7UUFDdkIsT0FBTyxFQUFFLEdBQUc7UUFDWixnQkFBZ0IsRUFBRSxPQUFPO1FBQ3pCLGdCQUFnQixFQUFFLDJCQUF1QjtLQUMxQztJQUNELFVBQVUsRUFBRTtRQUNWLEVBQUUsRUFBRTtZQUNGLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7U0FDZjtRQUNELElBQUksRUFBRTtZQUNKLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7U0FDZjtRQUNELFdBQVcsRUFBRTtZQUNYLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7U0FDZjtRQUNELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7U0FDZjtRQUNELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1NBQ2Y7S0FDRjtJQUNELE9BQU8sRUFBRTtRQUNQLE9BQU8sRUFBRTtZQUNQLEVBQUUsRUFBRTtnQkFDRixTQUFTLEVBQUUsQ0FBRSxJQUFJLENBQUU7Z0JBQ25CLEtBQUssRUFBRSxJQUFJO2FBQ1o7WUFDRCxFQUFFLEVBQUU7Z0JBQ0YsU0FBUyxFQUFFLENBQUUsSUFBSSxDQUFFO2dCQUNuQixLQUFLLEVBQUUsSUFBSTthQUNaO1NBQ0Y7S0FDRjtDQUNG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QUMsQ0FBQyw2QkFBNkI7WUFFbkYsTUFBTSxZQUFZLEdBQUcsTUFBTSxhQUFhLENBQUMsTUFBTSxDQUFDO2dCQUM5QyxPQUFPLEVBQUU7b0JBQ1AsS0FBSyxFQUFFLGNBQWM7b0JBQ3JCLFNBQVMsRUFBRSxNQUFNO2lCQUNsQjtnQkFDRCxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBRSxjQUFjLEVBQUUsZUFBZSxDQUFFLEVBQUUsRUFBRTthQUMvRCxDQUFDLENBQUM7WUFFSCx5RUFBeUU7WUFDekUsTUFBTSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3pDLE1BQU0sQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFFLENBQUMsQ0FBRSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUMxRCxNQUFNLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBRSxDQUFDLENBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDM0QsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ1osQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEVudGl0eUNvbmZpZ3VyYXRpb24gfSBmcm9tIFwiZWxlY3Ryb2RiXCI7XG5cbmltcG9ydCB7IEJhc2VFbnRpdHlTZXJ2aWNlLCBjcmVhdGVFbnRpdHlTY2hlbWEsIERlZmF1bHRFbnRpdHlPcGVyYXRpb25zIH0gZnJvbSBcIi4uXCI7XG5pbXBvcnQgeyBTZXJ2aWNlIH0gZnJvbSBcIi4uLy4uL2RlY29yYXRvcnNcIjtcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSBcIi4uLy4uL2RpXCI7XG5pbXBvcnQgeyBNZWlsaVNlYXJjaEVuZ2luZSB9IGZyb20gXCIuLi8uLi9zZWFyY2hcIjtcblxuXG5jb25zdCBlbnRpdHlTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICBtb2RlbDoge1xuICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgIHNlcnZpY2U6ICd0ZXN0LXNlcnZpY2UnLFxuICAgIHZlcnNpb246ICcxJyxcbiAgICBlbnRpdHlOYW1lUGx1cmFsOiAndGVzdHMnLFxuICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICB9LFxuICBhdHRyaWJ1dGVzOiB7XG4gICAgaWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgfSxcbiAgICBuYW1lOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgIH0sXG4gICAgZGVzY3JpcHRpb246IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgfSxcbiAgICBjcmVhdGVkQXQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgfSxcbiAgICB1cGRhdGVkQXQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgIH0sXG4gIH0sXG4gIGluZGV4ZXM6IHtcbiAgICBwcmltYXJ5OiB7XG4gICAgICBwazoge1xuICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgIH0sXG4gICAgICBzazoge1xuICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdLFxuICAgICAgICBmaWVsZDogJ3NrJyxcbiAgICAgIH1cbiAgICB9XG4gIH1cbn0pXG5cbkBTZXJ2aWNlKClcbmNsYXNzIFRlc3RFbnRpdHlTZXJ2aWNlIGV4dGVuZHMgQmFzZUVudGl0eVNlcnZpY2U8dHlwZW9mIGVudGl0eVNjaGVtYT4ge1xuICBjb25zdHJ1Y3RvcihcbiAgICBlbnRpdHlDb25maWd1cmF0aW9uczogRW50aXR5Q29uZmlndXJhdGlvbiA9IHtcbiAgICAgIHRhYmxlOiAndGVzdC10YWJsZS1lbnRpdHktc2VhcmNoLWludGVncmF0aW9uLXRlc3QnLFxuICAgIH0sXG4gICkge1xuICAgIHN1cGVyKGVudGl0eVNjaGVtYSwgZW50aXR5Q29uZmlndXJhdGlvbnMsIERJQ29udGFpbmVyLlJPT1QpO1xuICB9XG59XG5cbkRJQ29udGFpbmVyLlJPT1Quc2V0U2VhcmNoRW5naW5lKG5ldyBNZWlsaVNlYXJjaEVuZ2luZSh7XG4gIGhvc3Q6ICdodHRwOi8vbG9jYWxob3N0Ojc3MDAnLFxuICBhcGlLZXk6ICd4eHhfeW91cl9tYXN0ZXJfa2V5Jyxcbn0pKTtcblxuY29uc3QgZGVsYXkgPSBhc3luYyAobXM6IG51bWJlcikgPT4gYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XG5cbmRlc2NyaWJlKCdFbnRpdHkgU2VhcmNoJywgKCkgPT4ge1xuXG4gIGxldCBlbnRpdHlTZXJ2aWNlOiBUZXN0RW50aXR5U2VydmljZTtcblxuICBiZWZvcmVBbGwoYXN5bmMgKCkgPT4ge1xuXG4gICAgZW50aXR5U2VydmljZSA9IERJQ29udGFpbmVyLlJPT1QucmVzb2x2ZShUZXN0RW50aXR5U2VydmljZSk7XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gZW50aXR5U2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgY29uc3QgZW5naW5lID0gc2VhcmNoU2VydmljZS5nZXRFbmdpbmUoKSBhcyBNZWlsaVNlYXJjaEVuZ2luZTtcbiAgICBjb25zdCBpbmRleE5hbWUgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNlYXJjaENvbmZpZygpLmluZGV4Q29uZmlnPy5pbmRleE5hbWU7XG5cbiAgICAvLyBDbGVhbiB1cCBhbmQgY3JlYXRlIGluZGV4XG4gICAgdHJ5IHtcbiAgICAgIGNvbnNvbGUubG9nKCdjaGVja2luZyBpZiBpbmRleCBleGlzdHMnLCBpbmRleE5hbWUpO1xuICAgICAgY29uc3QgZXhpc3RzID0gYXdhaXQgZW5naW5lLmluZGV4RXhpc3RzKGluZGV4TmFtZSBhcyBzdHJpbmcpO1xuICAgICAgaWYgKGV4aXN0cykge1xuICAgICAgICBjb25zb2xlLmxvZygnZGVsZXRpbmcgb2xkIGluZGV4JywgaW5kZXhOYW1lKTtcbiAgICAgICAgYXdhaXQgZW5naW5lLmRlbGV0ZUluZGV4KGluZGV4TmFtZSBhcyBzdHJpbmcsIHRydWUpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggeyB9XG5cbiAgICBhd2FpdCBkZWxheSgxMDAwKTtcblxuICAgIGNvbnNvbGUubG9nKCdpbml0aWFsaXppbmcgbmV3IGluZGV4JywgaW5kZXhOYW1lKTtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmluaXRTZWFyY2hJbmRleCgpO1xuXG4gICAgYXdhaXQgZGVsYXkoMjAwMCk7XG4gIH0sIDYwMDAwKTtcblxuICBiZWZvcmVFYWNoKGFzeW5jICgpID0+IHtcbiAgICAvLyBDbGVhciBhbGwgZG9jdW1lbnRzIGZyb20gdGhlIGluZGV4IGJlZm9yZSBlYWNoIHRlc3QgdG8gZW5zdXJlIGlzb2xhdGlvblxuICAgIGNvbnN0IHNlYXJjaFNlcnZpY2UgPSBlbnRpdHlTZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKTtcbiAgICBjb25zdCBlbmdpbmUgPSBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpIGFzIE1laWxpU2VhcmNoRW5naW5lO1xuICAgIGNvbnN0IGluZGV4TmFtZSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2VhcmNoQ29uZmlnKCkuaW5kZXhDb25maWc/LmluZGV4TmFtZTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZW5naW5lLmRlbGV0ZUFsbERvY3VtZW50cyhpbmRleE5hbWUgYXMgc3RyaW5nLCB0cnVlKTtcbiAgICAgIGF3YWl0IGRlbGF5KDEwMDApOyAvLyBXYWl0IGZvciBkZWxldGUgb3BlcmF0aW9uIHRvIGNvbXBsZXRlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIElnbm9yZSBlcnJvcnMgZHVyaW5nIGNsZWFudXBcbiAgICB9XG4gIH0sIDEwMDAwKTtcblxuICBhZnRlckFsbChhc3luYyAoKSA9PiB7XG5cbiAgICBjb25zdCBzZWFyY2hTZXJ2aWNlID0gZW50aXR5U2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCk7XG4gICAgY29uc3QgZW5naW5lID0gc2VhcmNoU2VydmljZS5nZXRFbmdpbmUoKSBhcyBNZWlsaVNlYXJjaEVuZ2luZTtcbiAgICBjb25zdCBpbmRleE5hbWUgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNlYXJjaENvbmZpZygpLmluZGV4Q29uZmlnPy5pbmRleE5hbWU7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGVuZ2luZS5kZWxldGVJbmRleChpbmRleE5hbWUgYXMgc3RyaW5nLCB0cnVlKTtcbiAgICB9IGNhdGNoIHsgfVxuICB9LCA2MDAwMCk7XG5cblxuICBpdCgnc2hvdWxkIGJlIGFibGUgdG8gc2VhcmNoIGZvciBhbiBlbnRpdHknLCBhc3luYyAoKSA9PiB7XG4gICAgY29uc3Qgc2VhcmNoUmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5zZWFyY2goeyBzZWFyY2g6ICdhYmNkJyB9KTtcbiAgICBjb25zb2xlLmxvZyhzZWFyY2hSZXN1bHQpO1xuICAgIGV4cGVjdChzZWFyY2hSZXN1bHQpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHNlYXJjaFJlc3VsdC5oaXRzKS50b0JlRGVmaW5lZCgpO1xuICB9LCA1MDAwMCk7XG5cbiAgaXQoJ3Nob3VsZCBpbmRleCBhbiBlbnRpdHknLCBhc3luYyAoKSA9PiB7XG5cbiAgICAvLyB3YWl0IHRpbWUgdG8gbWFrZSBzdXJlIGNoYW5nZXMgYXJlIHByb3BhZ2F0ZWQgaW4gdGhlIHNlYXJjaCBlbmdpbmVcbiAgICBhd2FpdCBkZWxheSgxMDAwKTtcblxuICAgIGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpLnN5bmNUb0luZGV4KHtcbiAgICAgIGlkOiAnMScsXG4gICAgICBuYW1lOiAndGVzdCcsXG4gICAgICBkZXNjcmlwdGlvbjogJ3Rlc3QnLFxuICAgICAgY3JlYXRlZEF0OiAnMjAyMS0wMS0wMScsXG4gICAgICB1cGRhdGVkQXQ6ICcyMDIxLTAxLTAxJyxcbiAgICB9KTtcblxuICAgIGF3YWl0IGRlbGF5KDEwMDApO1xuXG4gICAgY29uc3Qgc2VhcmNoUmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCkuc2VhcmNoKHtcbiAgICAgIHNlYXJjaDogJ3Rlc3QnLFxuICAgIH0pO1xuICAgIGNvbnNvbGUubG9nKHNlYXJjaFJlc3VsdCk7XG4gICAgZXhwZWN0KHNlYXJjaFJlc3VsdCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3Qoc2VhcmNoUmVzdWx0LmhpdHMpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHNlYXJjaFJlc3VsdC5oaXRzLmxlbmd0aCkudG9CZSgxKTtcbiAgICBleHBlY3Qoc2VhcmNoUmVzdWx0LmhpdHNbIDAgXS5pZCkudG9CZSgnMScpO1xuXG4gIH0sIDUwMDAwKTtcblxuICBpdCgnc2hvdWxkIGJ1bGsgaW5kZXggbXVsdGlwbGUgZW50aXRpZXMgYW5kIHNlYXJjaCB0aGVtIGFsbCcsIGFzeW5jICgpID0+IHtcbiAgICBjb25zdCBlbnRpdGllcyA9IFtcbiAgICAgIHsgaWQ6ICcyJywgbmFtZTogJ2FscGhhJywgZGVzY3JpcHRpb246ICdmaXJzdCcsIGNyZWF0ZWRBdDogJzIwMjEtMDEtMDInLCB1cGRhdGVkQXQ6ICcyMDIxLTAxLTAyJyB9LFxuICAgICAgeyBpZDogJzMnLCBuYW1lOiAnYmV0YScsIGRlc2NyaXB0aW9uOiAnc2Vjb25kJywgY3JlYXRlZEF0OiAnMjAyMS0wMS0wMycsIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDMnIH0sXG4gICAgICB7IGlkOiAnNCcsIG5hbWU6ICdnYW1tYScsIGRlc2NyaXB0aW9uOiAndGhpcmQnLCBjcmVhdGVkQXQ6ICcyMDIxLTAxLTA0JywgdXBkYXRlZEF0OiAnMjAyMS0wMS0wNCcgfSxcbiAgICBdO1xuICAgIGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpLmJ1bGtTeW5jKGVudGl0aWVzKTtcbiAgICBhd2FpdCBkZWxheSgxMDAwKTtcbiAgICBjb25zdCBzZWFyY2hSZXN1bHQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnNlYXJjaCh7IHNlYXJjaDogJycgfSk7XG4gICAgZXhwZWN0KHNlYXJjaFJlc3VsdC50b3RhbCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbChlbnRpdGllcy5sZW5ndGgpO1xuICAgIGNvbnN0IGlkcyA9IHNlYXJjaFJlc3VsdC5oaXRzLm1hcChoID0+IGguaWQpO1xuICAgIGV4cGVjdChpZHMpLnRvRXF1YWwoZXhwZWN0LmFycmF5Q29udGFpbmluZyhbICcyJywgJzMnLCAnNCcgXSkpO1xuICB9LCA1MDAwMCk7XG5cbiAgaXQoJ3Nob3VsZCBmaWx0ZXIgcmVzdWx0cyBieSBhdHRyaWJ1dGUnLCBhc3luYyAoKSA9PiB7XG5cbiAgICBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKS51cGRhdGVJbmRleFNldHRpbmdzKHtcbiAgICAgIGZpbHRlcmFibGVBdHRyaWJ1dGVzOiBbICduYW1lJyBdLFxuICAgIH0sIHRydWUpO1xuXG4gICAgYXdhaXQgZGVsYXkoMTAwMCk7XG5cbiAgICBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKS5zeW5jVG9JbmRleCh7XG4gICAgICBpZDogJzEnLFxuICAgICAgbmFtZTogJ2FscGhhJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAndGVzdCcsXG4gICAgICBjcmVhdGVkQXQ6ICcyMDIxLTAxLTAxJyxcbiAgICAgIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDEnLFxuICAgIH0pO1xuXG4gICAgYXdhaXQgZGVsYXkoMTAwMCk7XG5cbiAgICBjb25zdCBzZWFyY2hSZXN1bHQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnNlYXJjaCh7IGZpbHRlcnM6IHsgbmFtZTogeyBlcTogJ2FscGhhJyB9IH0gfSk7XG4gICAgZXhwZWN0KHNlYXJjaFJlc3VsdC5oaXRzLmxlbmd0aCkudG9CZSgxKTtcbiAgICBleHBlY3Qoc2VhcmNoUmVzdWx0LmhpdHNbIDAgXS5uYW1lKS50b0JlKCdhbHBoYScpO1xuICB9LCAyMDAwMCk7XG5cbiAgaXQoJ3Nob3VsZCBzb3J0IHJlc3VsdHMgYnkgY3JlYXRlZEF0IGRlc2NlbmRpbmcnLCBhc3luYyAoKSA9PiB7XG5cbiAgICBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKS51cGRhdGVJbmRleFNldHRpbmdzKHtcbiAgICAgIHNvcnRhYmxlQXR0cmlidXRlczogWyAnY3JlYXRlZEF0JyBdLFxuICAgIH0sIHRydWUpO1xuXG4gICAgYXdhaXQgZGVsYXkoMTAwMCk7XG5cbiAgICBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKS5idWxrU3luYyhbIHtcbiAgICAgIGlkOiAnMScsXG4gICAgICBuYW1lOiAnYWxwaGEnLFxuICAgICAgZGVzY3JpcHRpb246ICd0ZXN0JyxcbiAgICAgIGNyZWF0ZWRBdDogJzIwMjEtMDEtMDEnLFxuICAgICAgdXBkYXRlZEF0OiAnMjAyMS0wMS0wMScsXG4gICAgfSxcbiAgICB7XG4gICAgICBpZDogJzInLFxuICAgICAgbmFtZTogJ2JldGEnLFxuICAgICAgZGVzY3JpcHRpb246ICd0ZXN0JyxcbiAgICAgIGNyZWF0ZWRBdDogJzIwMjEtMDEtMDInLFxuICAgICAgdXBkYXRlZEF0OiAnMjAyMS0wMS0wMicsXG4gICAgfSxcbiAgICB7XG4gICAgICBpZDogJzMnLFxuICAgICAgbmFtZTogJ2dhbW1hJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAndGVzdCcsXG4gICAgICBjcmVhdGVkQXQ6ICcyMDIxLTAxLTAzJyxcbiAgICAgIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDMnLFxuICAgIH0gXSk7XG5cbiAgICBhd2FpdCBkZWxheSgxMDAwKTtcblxuICAgIGNvbnN0IHNlYXJjaFJlc3VsdCA9IGF3YWl0IGVudGl0eVNlcnZpY2Uuc2VhcmNoKHsgc29ydDogWyB7IGZpZWxkOiAnY3JlYXRlZEF0JywgZGlyOiAnZGVzYycgfSBdIH0pO1xuICAgIGV4cGVjdChzZWFyY2hSZXN1bHQuaGl0cy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigxKTtcbiAgICBjb25zdCBkYXRlcyA9IHNlYXJjaFJlc3VsdC5oaXRzLm1hcChoID0+IGguY3JlYXRlZEF0KTtcbiAgICBleHBlY3QoZGF0ZXMpLnRvRXF1YWwoWyAuLi5kYXRlcyBdLnNvcnQoKS5yZXZlcnNlKCkpO1xuICB9LCAyMDAwMCk7XG5cbiAgaXQoJ3Nob3VsZCBwYWdpbmF0ZSByZXN1bHRzJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpLmJ1bGtTeW5jKFtcbiAgICAgIHsgaWQ6ICcxJywgbmFtZTogJ2FscGhhJywgZGVzY3JpcHRpb246ICd0ZXN0JywgY3JlYXRlZEF0OiAnMjAyMS0wMS0wMScsIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDEnIH0sXG4gICAgICB7IGlkOiAnMicsIG5hbWU6ICdiZXRhJywgZGVzY3JpcHRpb246ICd0ZXN0JywgY3JlYXRlZEF0OiAnMjAyMS0wMS0wMicsIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDInIH0sXG4gICAgICB7IGlkOiAnMycsIG5hbWU6ICdnYW1tYScsIGRlc2NyaXB0aW9uOiAndGVzdCcsIGNyZWF0ZWRBdDogJzIwMjEtMDEtMDMnLCB1cGRhdGVkQXQ6ICcyMDIxLTAxLTAzJyB9LFxuICAgICAgeyBpZDogJzQnLCBuYW1lOiAnZGVsdGEnLCBkZXNjcmlwdGlvbjogJ3Rlc3QnLCBjcmVhdGVkQXQ6ICcyMDIxLTAxLTA0JywgdXBkYXRlZEF0OiAnMjAyMS0wMS0wNCcgfSxcbiAgICAgIHsgaWQ6ICc1JywgbmFtZTogJ2Vwc2lsb24nLCBkZXNjcmlwdGlvbjogJ3Rlc3QnLCBjcmVhdGVkQXQ6ICcyMDIxLTAxLTA1JywgdXBkYXRlZEF0OiAnMjAyMS0wMS0wNScgfSxcbiAgICAgIHsgaWQ6ICc2JywgbmFtZTogJ3pldGEnLCBkZXNjcmlwdGlvbjogJ3Rlc3QnLCBjcmVhdGVkQXQ6ICcyMDIxLTAxLTA2JywgdXBkYXRlZEF0OiAnMjAyMS0wMS0wNicgfSxcbiAgICAgIHsgaWQ6ICc3JywgbmFtZTogJ2V0YScsIGRlc2NyaXB0aW9uOiAndGVzdCcsIGNyZWF0ZWRBdDogJzIwMjEtMDEtMDcnLCB1cGRhdGVkQXQ6ICcyMDIxLTAxLTA3JyB9LFxuICAgICAgeyBpZDogJzgnLCBuYW1lOiAndGhldGEnLCBkZXNjcmlwdGlvbjogJ3Rlc3QnLCBjcmVhdGVkQXQ6ICcyMDIxLTAxLTA4JywgdXBkYXRlZEF0OiAnMjAyMS0wMS0wOCcgfSxcbiAgICAgIHsgaWQ6ICc5JywgbmFtZTogJ2lvdGEnLCBkZXNjcmlwdGlvbjogJ3Rlc3QnLCBjcmVhdGVkQXQ6ICcyMDIxLTAxLTA5JywgdXBkYXRlZEF0OiAnMjAyMS0wMS0wOScgfSxcbiAgICAgIHsgaWQ6ICcxMCcsIG5hbWU6ICdrYXBwYScsIGRlc2NyaXB0aW9uOiAndGVzdCcsIGNyZWF0ZWRBdDogJzIwMjEtMDEtMTAnLCB1cGRhdGVkQXQ6ICcyMDIxLTAxLTEwJyB9LFxuICAgIF0pO1xuICAgIGF3YWl0IGRlbGF5KDEwMDApO1xuICAgIGNvbnN0IHBhZ2UxID0gYXdhaXQgZW50aXR5U2VydmljZS5zZWFyY2goeyBwYWdpbmF0aW9uOiB7IHBhZ2U6IDEsIGxpbWl0OiAyIH0gfSk7XG4gICAgY29uc3QgcGFnZTIgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnNlYXJjaCh7IHBhZ2luYXRpb246IHsgcGFnZTogMiwgbGltaXQ6IDIgfSB9KTtcbiAgICBleHBlY3QocGFnZTEuaGl0cy5sZW5ndGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoMik7XG4gICAgZXhwZWN0KHBhZ2UyLmhpdHMubGVuZ3RoKS50b0JlTGVzc1RoYW5PckVxdWFsKDIpO1xuICAgIGlmIChwYWdlMS5oaXRzLmxlbmd0aCA+IDAgJiYgcGFnZTIuaGl0cy5sZW5ndGggPiAwKSB7XG4gICAgICBleHBlY3QocGFnZTEuaGl0c1sgMCBdLmlkKS5ub3QudG9CZShwYWdlMi5oaXRzWyAwIF0uaWQpO1xuICAgIH1cbiAgfSwgMjAwMDApO1xuXG4gIGl0KCdzaG91bGQgc2VsZWN0IG9ubHkgc3BlY2lmaWMgZmllbGRzJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpLmJ1bGtTeW5jKFtcbiAgICAgIHsgaWQ6ICcxJywgbmFtZTogJ2FscGhhJywgZGVzY3JpcHRpb246ICd0ZXN0JywgY3JlYXRlZEF0OiAnMjAyMS0wMS0wMScsIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDEnIH0sXG4gICAgICB7IGlkOiAnMicsIG5hbWU6ICdiZXRhJywgZGVzY3JpcHRpb246ICd0ZXN0JywgY3JlYXRlZEF0OiAnMjAyMS0wMS0wMicsIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDInIH0sXG4gICAgXSk7XG4gICAgYXdhaXQgZGVsYXkoMTAwMCk7XG5cbiAgICBjb25zdCBzZWFyY2hSZXN1bHQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnNlYXJjaCh7IHNlbGVjdDogWyAnaWQnLCAnbmFtZScgXSB9KTtcbiAgICBleHBlY3Qoc2VhcmNoUmVzdWx0LmhpdHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW4oMCk7XG4gICAgZm9yIChjb25zdCBoaXQgb2Ygc2VhcmNoUmVzdWx0LmhpdHMpIHtcbiAgICAgIGV4cGVjdChPYmplY3Qua2V5cyhoaXQpKS50b0VxdWFsKGV4cGVjdC5hcnJheUNvbnRhaW5pbmcoWyAnaWQnLCAnbmFtZScgXSkpO1xuICAgIH1cbiAgfSwgMjAwMDApO1xuXG4gIGl0KCdzaG91bGQgcmV0dXJuIGRpc3RpbmN0IHJlc3VsdHMgYnkgbmFtZScsIGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKS51cGRhdGVJbmRleFNldHRpbmdzKHtcbiAgICAgIGZpbHRlcmFibGVBdHRyaWJ1dGVzOiBbICduYW1lJyBdLFxuICAgIH0sIHRydWUpO1xuXG4gICAgYXdhaXQgZGVsYXkoMTAwMCk7XG5cbiAgICBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKS5idWxrU3luYyhbXG4gICAgICB7XG4gICAgICAgIGlkOiAnMScsIG5hbWU6ICdhbHBoYScsIGRlc2NyaXB0aW9uOiAndGVzdCcsIGNyZWF0ZWRBdDogJzIwMjEtMDEtMDEnLCB1cGRhdGVkQXQ6ICcyMDIxLTAxLTAxJ1xuXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJzUnLCBuYW1lOiAnYWxwaGEnLCBkZXNjcmlwdGlvbjogJ2R1cGxpY2F0ZScsIGNyZWF0ZWRBdDogJzIwMjEtMDEtMDUnLCB1cGRhdGVkQXQ6ICcyMDIxLTAxLTA1J1xuICAgICAgfVxuICAgIF0pO1xuICAgIGF3YWl0IGRlbGF5KDEwMDApO1xuXG4gICAgY29uc3Qgc2VhcmNoUmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5zZWFyY2goeyBkaXN0aW5jdDogJ25hbWUnIH0pO1xuICAgIGNvbnN0IG5hbWVzID0gc2VhcmNoUmVzdWx0LmhpdHMubWFwKGggPT4gaC5uYW1lKTtcbiAgICBleHBlY3QobmV3IFNldChuYW1lcykuc2l6ZSkudG9CZShuYW1lcy5sZW5ndGgpO1xuICB9LCAyMDAwMCk7XG5cbiAgaXQoJ3Nob3VsZCBkZWxldGUgYW4gZW50aXR5IGZyb20gdGhlIGluZGV4JywgYXN5bmMgKCkgPT4ge1xuXG4gICAgYXdhaXQgZW50aXR5U2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCkudXBkYXRlSW5kZXhTZXR0aW5ncyh7XG4gICAgICBmaWx0ZXJhYmxlQXR0cmlidXRlczogWyAnaWQnIF0sXG4gICAgfSwgdHJ1ZSk7XG5cbiAgICBhd2FpdCBkZWxheSgxMDAwKTtcblxuICAgIGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpLmJ1bGtTeW5jKFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICcxJywgbmFtZTogJ2FscGhhJywgZGVzY3JpcHRpb246ICd0ZXN0JywgY3JlYXRlZEF0OiAnMjAyMS0wMS0wMScsIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDEnXG5cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnMicsIG5hbWU6ICdhbHBoYScsIGRlc2NyaXB0aW9uOiAnZHVwbGljYXRlJywgY3JlYXRlZEF0OiAnMjAyMS0wMS0wNScsIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDUnXG4gICAgICB9XG4gICAgXSk7XG4gICAgYXdhaXQgZGVsYXkoMTAwMCk7XG5cbiAgICBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKS5kZWxldGVGcm9tSW5kZXgoJzInKTtcbiAgICBhd2FpdCBkZWxheSgxMDAwKTtcblxuICAgIGNvbnN0IHNlYXJjaFJlc3VsdCA9IGF3YWl0IGVudGl0eVNlcnZpY2Uuc2VhcmNoKHsgZmlsdGVyczogeyBpZDogeyBlcTogJzInIH0gfSB9KTtcbiAgICBleHBlY3Qoc2VhcmNoUmVzdWx0LmhpdHMubGVuZ3RoKS50b0JlKDApO1xuICB9LCAyMDAwMCk7XG5cbiAgaXQoJ3Nob3VsZCB1cGRhdGUgYW4gaW5kZXhlZCBlbnRpdHknLCBhc3luYyAoKSA9PiB7XG5cbiAgICBhd2FpdCBlbnRpdHlTZXJ2aWNlLmdldFNlYXJjaFNlcnZpY2UoKS51cGRhdGVJbmRleFNldHRpbmdzKHtcbiAgICAgIGZpbHRlcmFibGVBdHRyaWJ1dGVzOiBbICdpZCcgXSxcbiAgICB9LCB0cnVlKTtcblxuICAgIGF3YWl0IGRlbGF5KDEwMDApO1xuXG4gICAgYXdhaXQgZW50aXR5U2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCkuYnVsa1N5bmMoW1xuICAgICAge1xuICAgICAgICBpZDogJzEnLCBuYW1lOiAnYWxwaGEnLCBkZXNjcmlwdGlvbjogJ3Rlc3QnLCBjcmVhdGVkQXQ6ICcyMDIxLTAxLTAxJywgdXBkYXRlZEF0OiAnMjAyMS0wMS0wMSdcblxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICczJywgbmFtZTogJ2FscGhhJywgZGVzY3JpcHRpb246ICdkdXBsaWNhdGUnLCBjcmVhdGVkQXQ6ICcyMDIxLTAxLTA1JywgdXBkYXRlZEF0OiAnMjAyMS0wMS0wNSdcbiAgICAgIH1cbiAgICBdKTtcbiAgICBhd2FpdCBkZWxheSgxMDAwKTtcblxuICAgIGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpLnN5bmNUb0luZGV4KHtcbiAgICAgIGlkOiAnMycsIG5hbWU6ICdiZXRhLXVwZGF0ZWQnLCBkZXNjcmlwdGlvbjogJ3NlY29uZC11cGRhdGVkJywgY3JlYXRlZEF0OiAnMjAyMS0wMS0wMycsIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDYnLFxuICAgIH0pO1xuICAgIGF3YWl0IGRlbGF5KDEwMDApO1xuXG4gICAgY29uc3Qgc2VhcmNoUmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5zZWFyY2goeyBmaWx0ZXJzOiB7IGlkOiB7IGVxOiAnMycgfSB9IH0pO1xuICAgIGV4cGVjdChzZWFyY2hSZXN1bHQuaGl0cy5sZW5ndGgpLnRvQmUoMSk7XG5cbiAgICBleHBlY3Qoc2VhcmNoUmVzdWx0LmhpdHNbIDAgXS5uYW1lKS50b0JlKCdiZXRhLXVwZGF0ZWQnKTtcbiAgfSwgMjAwMDApO1xuXG4gIGl0KCdzaG91bGQgcmV0dXJuIGVtcHR5IHJlc3VsdHMgZm9yIG5vbi1leGlzdGVudCBzZWFyY2gnLCBhc3luYyAoKSA9PiB7XG4gICAgY29uc3Qgc2VhcmNoUmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5zZWFyY2goeyBzZWFyY2g6ICdub25leGlzdGVudHRlcm0nIH0pO1xuICAgIGV4cGVjdChzZWFyY2hSZXN1bHQuaGl0cy5sZW5ndGgpLnRvQmUoMCk7XG4gIH0sIDEwMDAwKTtcblxuICBpdCgnc2hvdWxkIHJldHVybiBhbGwgcmVzdWx0cyBmb3IgZW1wdHkgc2VhcmNoJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGVudGl0eVNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpLmJ1bGtTeW5jKFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICcxJywgbmFtZTogJ2FscGhhJywgZGVzY3JpcHRpb246ICd0ZXN0JywgY3JlYXRlZEF0OiAnMjAyMS0wMS0wMScsIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDEnXG5cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnMycsIG5hbWU6ICdhbHBoYScsIGRlc2NyaXB0aW9uOiAnZHVwbGljYXRlJywgY3JlYXRlZEF0OiAnMjAyMS0wMS0wNScsIHVwZGF0ZWRBdDogJzIwMjEtMDEtMDUnXG4gICAgICB9XG4gICAgXSk7XG4gICAgYXdhaXQgZGVsYXkoMTAwMCk7XG4gICAgY29uc3Qgc2VhcmNoUmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5zZWFyY2goeyBzZWFyY2g6ICcnIH0pO1xuICAgIGV4cGVjdChzZWFyY2hSZXN1bHQuaGl0cy5sZW5ndGgpLnRvQmUoMik7XG4gIH0sIDEwMDAwKTtcblxuICBkZXNjcmliZSgnR2VvIFNlYXJjaCcsICgpID0+IHtcbiAgICAvLyDilIDilIDilIAgR2VvIFNlYXJjaCBUZXN0cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBnZW9FbnRpdGllcyA9IFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdnZW8tMScsXG4gICAgICAgIG5hbWU6ICdFaWZmZWwgVG93ZXInLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0xhbmRtYXJrIGluIFBhcmlzLCBGcmFuY2UnLFxuICAgICAgICBjcmVhdGVkQXQ6ICcyMDIzLTAxLTAxJyxcbiAgICAgICAgX2dlbzogeyBsYXQ6IDQ4Ljg1ODQsIGxuZzogMi4yOTQ1IH0sIC8vIFBhcmlzXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ2dlby0yJyxcbiAgICAgICAgbmFtZTogJ0NvbG9zc2V1bScsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnQW1waGl0aGVhdHJlIGluIFJvbWUsIEl0YWx5JyxcbiAgICAgICAgY3JlYXRlZEF0OiAnMjAyMy0wMS0wMicsXG4gICAgICAgIF9nZW86IHsgbGF0OiA0MS44OTAyLCBsbmc6IDEyLjQ5MjIgfSwgLy8gUm9tZVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdnZW8tMycsXG4gICAgICAgIG5hbWU6ICdCcmFuZGVuYnVyZyBHYXRlJyxcbiAgICAgICAgZGVzY3JpcHRpb246ICdNb251bWVudCBpbiBCZXJsaW4sIEdlcm1hbnknLFxuICAgICAgICBjcmVhdGVkQXQ6ICcyMDIzLTAxLTAzJyxcbiAgICAgICAgX2dlbzogeyBsYXQ6IDUyLjUxNjMsIGxuZzogMTMuMzc3NyB9LCAvLyBCZXJsaW5cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnZ2VvLTQnLFxuICAgICAgICBuYW1lOiAnTG91dnJlIE11c2V1bScsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnQXJ0IG11c2V1bSBpbiBQYXJpcywgRnJhbmNlJyxcbiAgICAgICAgY3JlYXRlZEF0OiAnMjAyMy0wMS0wNCcsXG4gICAgICAgIF9nZW86IHsgbGF0OiA0OC44NjA2LCBsbmc6IDIuMzM3NiB9LCAvLyBQYXJpcywgbmVhciBFaWZmZWwgVG93ZXJcbiAgICAgIH0sXG4gICAgXTtcblxuICAgIGJlZm9yZUVhY2goYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZW50aXR5U2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCkudXBkYXRlSW5kZXhTZXR0aW5ncyh7XG4gICAgICAgIGZpbHRlcmFibGVBdHRyaWJ1dGVzOiBbICdfZ2VvJywgJ25hbWUnIF0sXG4gICAgICAgIHNvcnRhYmxlQXR0cmlidXRlczogWyAnX2dlbycgXSwgLy8gQWxzbyBtYWtlIGl0IHNvcnRhYmxlIGZvciBsYXRlciB0ZXN0c1xuICAgICAgfSwgdHJ1ZSk7XG4gICAgICBhd2FpdCBkZWxheSgxMDAwKTtcblxuICAgICAgYXdhaXQgZW50aXR5U2VydmljZS5nZXRTZWFyY2hTZXJ2aWNlKCkuYnVsa1N5bmMoZ2VvRW50aXRpZXMpO1xuICAgICAgYXdhaXQgZGVsYXkoMTAwMCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciByZXN1bHRzIGJ5IGdlb1JhZGl1cycsIGFzeW5jICgpID0+IHtcblxuICAgICAgLy8gU2VhcmNoIGZvciBsb2NhdGlvbnMgd2l0aGluIDVrbSBvZiBhIHBvaW50IGluIGNlbnRyYWwgUGFyaXNcbiAgICAgIGNvbnN0IHNlYXJjaFJlc3VsdCA9IGF3YWl0IGVudGl0eVNlcnZpY2Uuc2VhcmNoKHtcbiAgICAgICAgZ2VvUmFkaXVzRmlsdGVyOiB7XG4gICAgICAgICAgY2VudGVyOiB7IGxhdDogNDguODU3MCwgbG5nOiAyLjM0MDAgfSwgLy8gQXBwcm94LiBjZW50cmFsIFBhcmlzXG4gICAgICAgICAgZGlzdGFuY2VJbk1ldGVyczogNTAwMCwgLy8gNWttXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHNlYXJjaFJlc3VsdC5oaXRzLmxlbmd0aCkudG9CZSgyKTsgLy8gRWlmZmVsIFRvd2VyIGFuZCBMb3V2cmUgTXVzZXVtXG4gICAgICBjb25zdCBuYW1lcyA9IHNlYXJjaFJlc3VsdC5oaXRzLm1hcChoID0+IGgubmFtZSkuc29ydCgpO1xuICAgICAgZXhwZWN0KG5hbWVzKS50b0VxdWFsKFsgJ0VpZmZlbCBUb3dlcicsICdMb3V2cmUgTXVzZXVtJyBdLnNvcnQoKSk7XG4gICAgfSwgMjAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBzb3J0IHJlc3VsdHMgYnkgX2dlb1BvaW50IGFzY2VuZGluZyAobmVhcmVzdCBmaXJzdCknLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTb3J0IGJ5IGRpc3RhbmNlIGZyb20gYSBwb2ludCBjbG9zZXIgdG8gRWlmZmVsIFRvd2VyIHRoYW4gTG91dnJlXG4gICAgICBjb25zdCByZWZlcmVuY2VQb2ludCA9IHsgbGF0OiA0OC44NTgwLCBsbmc6IDIuMjkwMCB9OyAvLyBWZXJ5IGNsb3NlIHRvIEVpZmZlbCBUb3dlclxuXG4gICAgICBjb25zdCBzZWFyY2hSZXN1bHQgPSBhd2FpdCBlbnRpdHlTZXJ2aWNlLnNlYXJjaCh7XG4gICAgICAgIC8vIE5vIHRleHQgc2VhcmNoLCBnZXQgYWxsIHJlbGV2YW50IGdlbyBlbnRpdGllc1xuICAgICAgICBnZW9Tb3J0OiB7XG4gICAgICAgICAgcG9pbnQ6IHJlZmVyZW5jZVBvaW50LFxuICAgICAgICAgIGRpcmVjdGlvbjogJ2FzYycsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIEZpbHRlciB0byBvbmx5IGluY2x1ZGUgUGFyaXMgbGFuZG1hcmtzIGZvciBhIGNsZWFyZXIgc29ydCB0ZXN0XG4gICAgICAgIGZpbHRlcnM6IHsgbmFtZTogeyBpbjogWyAnRWlmZmVsIFRvd2VyJywgJ0xvdXZyZSBNdXNldW0nIF0gfSB9XG4gICAgICB9KTtcblxuICAgICAgLy8gRXhwZWN0IEVpZmZlbCBUb3dlciB0byBiZSBmaXJzdCwgdGhlbiBMb3V2cmVcbiAgICAgIGV4cGVjdChzZWFyY2hSZXN1bHQuaGl0cy5sZW5ndGgpLnRvQmUoMik7XG4gICAgICBleHBlY3Qoc2VhcmNoUmVzdWx0LmhpdHNbIDAgXS5uYW1lKS50b0JlKCdFaWZmZWwgVG93ZXInKTtcbiAgICAgIGV4cGVjdChzZWFyY2hSZXN1bHQuaGl0c1sgMSBdLm5hbWUpLnRvQmUoJ0xvdXZyZSBNdXNldW0nKTtcbiAgICB9LCAyMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIHNvcnQgcmVzdWx0cyBieSBfZ2VvUG9pbnQgZGVzY2VuZGluZyAoZmFydGhlc3QgZmlyc3QpJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVmZXJlbmNlUG9pbnQgPSB7IGxhdDogNDguODU4MCwgbG5nOiAyLjI5MDAgfTsgLy8gVmVyeSBjbG9zZSB0byBFaWZmZWwgVG93ZXJcblxuICAgICAgY29uc3Qgc2VhcmNoUmVzdWx0ID0gYXdhaXQgZW50aXR5U2VydmljZS5zZWFyY2goe1xuICAgICAgICBnZW9Tb3J0OiB7XG4gICAgICAgICAgcG9pbnQ6IHJlZmVyZW5jZVBvaW50LFxuICAgICAgICAgIGRpcmVjdGlvbjogJ2Rlc2MnLFxuICAgICAgICB9LFxuICAgICAgICBmaWx0ZXJzOiB7IG5hbWU6IHsgaW46IFsgJ0VpZmZlbCBUb3dlcicsICdMb3V2cmUgTXVzZXVtJyBdIH0gfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIEV4cGVjdCBMb3V2cmUgdG8gYmUgZmlyc3QgKGZhcnRoZXN0IGZyb20gcmVmIHBvaW50KSwgdGhlbiBFaWZmZWwgVG93ZXJcbiAgICAgIGV4cGVjdChzZWFyY2hSZXN1bHQuaGl0cy5sZW5ndGgpLnRvQmUoMik7XG4gICAgICBleHBlY3Qoc2VhcmNoUmVzdWx0LmhpdHNbIDAgXS5uYW1lKS50b0JlKCdMb3V2cmUgTXVzZXVtJyk7XG4gICAgICBleHBlY3Qoc2VhcmNoUmVzdWx0LmhpdHNbIDEgXS5uYW1lKS50b0JlKCdFaWZmZWwgVG93ZXInKTtcbiAgICB9LCAyMDAwMCk7XG4gIH0pO1xufSk7XG4iXX0=