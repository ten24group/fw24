"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
const __1 = require("..");
const di_1 = require("../../di");
const decorators_1 = require("../../decorators");
const search_1 = require("../../search");
const lambda_test_harness_1 = require("../../testing/lambda-test-harness");
const decorators_2 = require("../../decorators");
const base_entity_controller_1 = require("../base-entity-controller");
describe('BaseEntityController Search Integration (real MeiliSearch)', () => {
    // --- Setup test entity schema and service ---
    const entitySchema = (0, __1.createEntitySchema)({
        model: {
            entity: 'testcontroller',
            service: 'testcontroller-service',
            version: '1',
            entityNamePlural: 'testcontrollers',
            entityOperations: __1.DefaultEntityOperations,
        },
        attributes: {
            id: { type: 'string', required: true },
            name: { type: 'string', required: true },
            status: { type: 'string', required: true },
            createdAt: { type: 'string', required: true },
        },
        indexes: {
            primary: {
                pk: { composite: ['id'], field: 'pk' },
                sk: { composite: ['id'], field: 'sk' },
            },
        },
    });
    let TestEntityService = class TestEntityService extends __1.BaseEntityService {
        constructor(entityConfigurations = {
            table: 'test-table-base-entity-controller-integration-test',
        }) {
            super(entitySchema, entityConfigurations, di_1.DIContainer.ROOT);
        }
    };
    TestEntityService = __decorate([
        (0, decorators_1.Service)()
    ], TestEntityService);
    let TestEntityController = class TestEntityController extends base_entity_controller_1.BaseEntityController {
        constructor() {
            super(di_1.DIContainer.ROOT.resolve(TestEntityService));
        }
    };
    TestEntityController = __decorate([
        (0, decorators_2.Controller)('testcontroller')
    ], TestEntityController);
    let entityService;
    let searchService;
    let harness;
    let controller;
    const indexName = 'testcontroller';
    beforeAll(async () => {
        di_1.DIContainer.ROOT.setSearchEngine(new search_1.MeiliSearchEngine({
            host: 'http://localhost:7700',
            apiKey: 'xxx_your_master_key',
        }));
        entityService = di_1.DIContainer.ROOT.resolve(TestEntityService);
        searchService = entityService.getSearchService();
        controller = new TestEntityController();
        harness = new lambda_test_harness_1.LambdaTestHarness(controller);
        // Clean up and create index
        const engine = searchService.getEngine();
        try {
            const exists = await engine.indexExists(indexName);
            if (exists)
                await engine.deleteIndex(indexName, true);
        }
        catch { }
        await new Promise(res => setTimeout(res, 1000));
        await searchService.initSearchIndex();
        await new Promise(res => setTimeout(res, 2000));
    }, 60000);
    afterAll(async () => {
        const engine = searchService.getEngine();
        try {
            await engine.deleteIndex(indexName, true);
        }
        catch { }
    }, 60000);
    // --- Seed data before each test ---
    const testEntities = [
        { id: '1', name: 'Alpha Product', status: 'active', createdAt: '2023-01-01' },
        { id: '2', name: 'Beta Service', status: 'inactive', createdAt: '2023-01-02' },
        { id: '3', name: 'Gamma Tool', status: 'active', createdAt: '2023-01-03' },
        { id: '4', name: 'Delta App', status: 'pending', createdAt: '2023-01-04' },
        { id: '5', name: 'Alpha Beta Mix', status: 'active', createdAt: '2023-01-05' },
    ];
    beforeEach(async () => {
        await searchService.bulkSync(testEntities);
        await new Promise(res => setTimeout(res, 1000));
    });
    afterEach(async () => {
        // Clean up index between tests
        await searchService.deleteAllDocuments();
        await new Promise(res => setTimeout(res, 500));
    });
    describe('POST /search', () => {
        it('should return all items for empty search', async () => {
            const response = await harness.post('/search', { body: {} });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(5);
            expect(body.total).toBe(5);
        }, 60000);
        it('should filter by search string', async () => {
            const response = await harness.post('/search', { body: { search: 'Alpha' } });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(2);
            expect(body.items.every((item) => item.name.includes('Alpha'))).toBe(true);
        }, 60000);
        it('should filter by status with eq operator', async () => {
            const response = await harness.post('/search', { body: { filters: { status: { eq: 'active' } } } });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(3);
            expect(body.items.every((item) => item.status === 'active')).toBe(true);
        }, 60000);
        it('should filter by status with neq operator', async () => {
            const response = await harness.post('/search', { body: { filters: { status: { neq: 'active' } } } });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(2);
            expect(body.items.every((item) => item.status !== 'active')).toBe(true);
        }, 60000);
        it('should filter with in operator', async () => {
            const response = await harness.post('/search', {
                body: { filters: { status: { in: ['active', 'pending'] } } }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(4);
            expect(body.items.every((item) => ['active', 'pending'].includes(item.status))).toBe(true);
        }, 60000);
        it('should filter with nin operator', async () => {
            const response = await harness.post('/search', {
                body: { filters: { status: { nin: ['inactive'] } } }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(4);
            expect(body.items.every((item) => item.status !== 'inactive')).toBe(true);
        }, 60000);
        it('should filter with NOT logical operator', async () => {
            const response = await harness.post('/search', {
                body: {
                    filters: {
                        not: [
                            { status: { eq: 'inactive' } }
                        ]
                    }
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(4);
            expect(body.items.every((item) => item.status !== 'inactive')).toBe(true);
        }, 60000);
        it('should sort results by name ascending', async () => {
            const response = await harness.post('/search', {
                body: {
                    sort: [{ field: 'name', dir: 'asc' }]
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(5);
            const names = body.items.map((item) => item.name);
            expect(names).toEqual([...names].sort());
        }, 60000);
        it('should sort results by createdAt descending', async () => {
            const response = await harness.post('/search', {
                body: {
                    sort: [{ field: 'createdAt', dir: 'desc' }]
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(5);
            const dates = body.items.map((item) => item.createdAt);
            expect(dates).toEqual([...dates].sort().reverse());
        }, 60000);
        it('should select specific fields', async () => {
            const response = await harness.post('/search', {
                body: {
                    select: ['id', 'name']
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(5);
            body.items.forEach((item) => {
                expect(Object.keys(item).sort()).toEqual(['id', 'name'].sort());
            });
        }, 60000);
        it('should combine search, filters, sort, and pagination', async () => {
            const response = await harness.post('/search', {
                body: {
                    search: 'Alpha',
                    filters: { status: { eq: 'active' } },
                    sort: [{ field: 'name', dir: 'asc' }],
                    pagination: { page: 1, limit: 1 }
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(1);
            expect(body.items[0].name).toBe('Alpha Beta Mix');
            expect(body.items[0].status).toBe('active');
        }, 60000);
        it('should paginate results correctly', async () => {
            const page1 = await harness.post('/search', {
                body: {
                    sort: [{ field: 'id', dir: 'asc' }],
                    pagination: { page: 1, limit: 2 }
                }
            });
            const page2 = await harness.post('/search', {
                body: {
                    sort: [{ field: 'id', dir: 'asc' }],
                    pagination: { page: 2, limit: 2 }
                }
            });
            expect(page1.statusCode).toBe(200);
            expect(page2.statusCode).toBe(200);
            const body1 = JSON.parse(page1.body);
            const body2 = JSON.parse(page2.body);
            expect(body1.items.length).toBe(2);
            expect(body2.items.length).toBe(2);
            expect(body1.total).toBe(5);
            expect(body2.total).toBe(5);
            // Ensure no overlap between pages
            const page1Ids = body1.items.map((item) => item.id);
            const page2Ids = body2.items.map((item) => item.id);
            expect(page1Ids).not.toEqual(expect.arrayContaining(page2Ids));
        }, 60000);
        it('should return empty results for non-matching search', async () => {
            const response = await harness.post('/search', { body: { search: 'NonExistent' } });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(0);
            expect(body.total).toBe(0);
        }, 60000);
        it('should handle special characters in search', async () => {
            // First add an entity with special characters
            const specialEntity = { id: '99', name: 'Test-Item @#$%', status: 'active', createdAt: '2023-01-99' };
            await searchService.syncToIndex(specialEntity, undefined, undefined, true);
            await new Promise(res => setTimeout(res, 1000));
            const response = await harness.post('/search', { body: { search: 'Test-Item' } });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(1);
            expect(body.items[0].name).toBe('Test-Item @#$%');
        }, 60000);
    });
    describe('GET /search', () => {
        it('should support search via query string', async () => {
            const response = await harness.get('/search', { queryStringParameters: { q: 'Beta' } });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(2);
            expect(body.items.every((item) => item.name.includes('Beta'))).toBe(true);
        }, 60000);
        it('should support filters via query string with eq operator', async () => {
            const response = await harness.get('/search', { queryStringParameters: { status: 'inactive' } });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(1);
            expect(body.items[0].status).toBe('inactive');
        }, 60000);
        it('should support in filter via query string', async () => {
            const response = await harness.get('/search', {
                queryStringParameters: {
                    'status.in': 'active,pending'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(4);
            expect(body.items.every((item) => ['active', 'pending'].includes(item.status))).toBe(true);
        }, 60000);
        it('should support sorting via query string', async () => {
            const response = await harness.get('/search', {
                queryStringParameters: {
                    sort: 'name:asc'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(5);
            const names = body.items.map((item) => item.name);
            expect(names).toEqual([...names].sort());
        }, 60000);
        it('should support multiple sort fields via query string', async () => {
            const response = await harness.get('/search', {
                queryStringParameters: {
                    sort: 'status:asc,name:desc'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(5);
        }, 60000);
        it('should support field selection via query string', async () => {
            const response = await harness.get('/search', {
                queryStringParameters: {
                    attributes: 'id,name'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(5);
            body.items.forEach((item) => {
                expect(Object.keys(item).sort()).toEqual(['id', 'name'].sort());
            });
        }, 60000);
        it('should support pagination via query string', async () => {
            const response = await harness.get('/search', {
                queryStringParameters: {
                    hitsPerPage: '2',
                    page: '2',
                    sort: 'id:asc'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(2);
            expect(body.total).toBe(5);
            expect(['3', '4']).toContain(body.items[0].id);
        }, 60000);
        it('should combine multiple query parameters', async () => {
            const response = await harness.get('/search', {
                queryStringParameters: {
                    q: 'Alpha',
                    status: 'active',
                    sort: 'name:asc',
                    hitsPerPage: '1',
                    page: '1'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(1);
            expect(body.items[0].name.includes('Alpha')).toBe(true);
            expect(body.items[0].status).toBe('active');
        }, 60000);
        it('should handle empty query parameters gracefully', async () => {
            const response = await harness.get('/search', { queryStringParameters: {} });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items.length).toBe(5);
            expect(body.total).toBe(5);
        }, 60000);
        it('should handle invalid pagination parameters gracefully', async () => {
            const response = await harness.get('/search', {
                queryStringParameters: {
                    hitsPerPage: 'invalid',
                    page: 'notanumber'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            // Should use default pagination values
            expect(body.items.length).toBeGreaterThan(0);
        }, 60000);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1lbnRpdHktY29udHJvbGxlci5pbnRlZ3JhdGlvbi50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2VudGl0eS9pbnRlZ3JhdGlvbi10ZXN0L2Jhc2UtZW50aXR5LWNvbnRyb2xsZXIuaW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUNBLDBCQUFvRjtBQUNwRixpQ0FBK0M7QUFDL0MsaURBQTJDO0FBQzNDLHlDQUFzRTtBQUN0RSwyRUFBc0U7QUFDdEUsaURBQThDO0FBQzlDLHNFQUFpRTtBQUVqRSxRQUFRLENBQUMsNERBQTRELEVBQUUsR0FBRyxFQUFFO0lBQzFFLCtDQUErQztJQUMvQyxNQUFNLFlBQVksR0FBRyxJQUFBLHNCQUFrQixFQUFDO1FBQ3RDLEtBQUssRUFBRTtZQUNMLE1BQU0sRUFBRSxnQkFBZ0I7WUFDeEIsT0FBTyxFQUFFLHdCQUF3QjtZQUNqQyxPQUFPLEVBQUUsR0FBRztZQUNaLGdCQUFnQixFQUFFLGlCQUFpQjtZQUNuQyxnQkFBZ0IsRUFBRSwyQkFBdUI7U0FDMUM7UUFDRCxVQUFVLEVBQUU7WUFDVixFQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUU7WUFDdEMsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFO1lBQ3hDLE1BQU0sRUFBRSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRTtZQUMxQyxTQUFTLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUU7U0FDOUM7UUFDRCxPQUFPLEVBQUU7WUFDUCxPQUFPLEVBQUU7Z0JBQ1AsRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLENBQUUsSUFBSSxDQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRTtnQkFDeEMsRUFB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Q0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDdkMsdUNBQXVDO1lBQ3ZDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUMvQyxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDWixDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRW50aXR5LCBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSBcImVsZWN0cm9kYlwiO1xuaW1wb3J0IHsgQmFzZUVudGl0eVNlcnZpY2UsIGNyZWF0ZUVudGl0eVNjaGVtYSwgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgfSBmcm9tIFwiLi5cIjtcbmltcG9ydCB7IERJQ29udGFpbmVyLCBPbkluaXQgfSBmcm9tIFwiLi4vLi4vZGlcIjtcbmltcG9ydCB7IFNlcnZpY2UgfSBmcm9tIFwiLi4vLi4vZGVjb3JhdG9yc1wiO1xuaW1wb3J0IHsgRW50aXR5U2VhcmNoU2VydmljZSwgTWVpbGlTZWFyY2hFbmdpbmUgfSBmcm9tIFwiLi4vLi4vc2VhcmNoXCI7XG5pbXBvcnQgeyBMYW1iZGFUZXN0SGFybmVzcyB9IGZyb20gJy4uLy4uL3Rlc3RpbmcvbGFtYmRhLXRlc3QtaGFybmVzcyc7XG5pbXBvcnQgeyBDb250cm9sbGVyIH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycyc7XG5pbXBvcnQgeyBCYXNlRW50aXR5Q29udHJvbGxlciB9IGZyb20gJy4uL2Jhc2UtZW50aXR5LWNvbnRyb2xsZXInO1xuXG5kZXNjcmliZSgnQmFzZUVudGl0eUNvbnRyb2xsZXIgU2VhcmNoIEludGVncmF0aW9uIChyZWFsIE1laWxpU2VhcmNoKScsICgpID0+IHtcbiAgLy8gLS0tIFNldHVwIHRlc3QgZW50aXR5IHNjaGVtYSBhbmQgc2VydmljZSAtLS1cbiAgY29uc3QgZW50aXR5U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgICBtb2RlbDoge1xuICAgICAgZW50aXR5OiAndGVzdGNvbnRyb2xsZXInLFxuICAgICAgc2VydmljZTogJ3Rlc3Rjb250cm9sbGVyLXNlcnZpY2UnLFxuICAgICAgdmVyc2lvbjogJzEnLFxuICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ3Rlc3Rjb250cm9sbGVycycsXG4gICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgIGlkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSB9LFxuICAgICAgbmFtZTogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIHN0YXR1czogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICAgIGNyZWF0ZWRBdDogeyB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUgfSxcbiAgICB9LFxuICAgIGluZGV4ZXM6IHtcbiAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgcGs6IHsgY29tcG9zaXRlOiBbICdpZCcgXSwgZmllbGQ6ICdwaycgfSxcbiAgICAgICAgc2s6IHsgY29tcG9zaXRlOiBbICdpZCcgXSwgZmllbGQ6ICdzaycgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSk7XG5cbiAgQFNlcnZpY2UoKVxuICBjbGFzcyBUZXN0RW50aXR5U2VydmljZSBleHRlbmRzIEJhc2VFbnRpdHlTZXJ2aWNlPHR5cGVvZiBlbnRpdHlTY2hlbWE+IHtcbiAgICBjb25zdHJ1Y3RvcihlbnRpdHlDb25maWd1cmF0aW9uczogRW50aXR5Q29uZmlndXJhdGlvbiA9IHtcbiAgICAgIHRhYmxlOiAndGVzdC10YWJsZS1iYXNlLWVudGl0eS1jb250cm9sbGVyLWludGVncmF0aW9uLXRlc3QnLFxuICAgIH0pIHtcbiAgICAgIHN1cGVyKGVudGl0eVNjaGVtYSwgZW50aXR5Q29uZmlndXJhdGlvbnMsIERJQ29udGFpbmVyLlJPT1QpO1xuICAgIH1cbiAgfVxuXG4gIEBDb250cm9sbGVyKCd0ZXN0Y29udHJvbGxlcicpXG4gIGNsYXNzIFRlc3RFbnRpdHlDb250cm9sbGVyIGV4dGVuZHMgQmFzZUVudGl0eUNvbnRyb2xsZXI8dHlwZW9mIGVudGl0eVNjaGVtYT4ge1xuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgc3VwZXIoRElDb250YWluZXIuUk9PVC5yZXNvbHZlKFRlc3RFbnRpdHlTZXJ2aWNlKSk7XG4gICAgfVxuICB9XG5cbiAgbGV0IGVudGl0eVNlcnZpY2U6IFRlc3RFbnRpdHlTZXJ2aWNlO1xuICBsZXQgc2VhcmNoU2VydmljZTogRW50aXR5U2VhcmNoU2VydmljZTxhbnk+O1xuICBsZXQgaGFybmVzczogTGFtYmRhVGVzdEhhcm5lc3M7XG4gIGxldCBjb250cm9sbGVyOiBUZXN0RW50aXR5Q29udHJvbGxlcjtcbiAgY29uc3QgaW5kZXhOYW1lID0gJ3Rlc3Rjb250cm9sbGVyJztcblxuICBiZWZvcmVBbGwoYXN5bmMgKCkgPT4ge1xuXG4gICAgRElDb250YWluZXIuUk9PVC5zZXRTZWFyY2hFbmdpbmUobmV3IE1laWxpU2VhcmNoRW5naW5lKHtcbiAgICAgIGhvc3Q6ICdodHRwOi8vbG9jYWxob3N0Ojc3MDAnLFxuICAgICAgYXBpS2V5OiAneHh4X3lvdXJfbWFzdGVyX2tleScsXG4gICAgfSkpO1xuXG4gICAgZW50aXR5U2VydmljZSA9IERJQ29udGFpbmVyLlJPT1QucmVzb2x2ZShUZXN0RW50aXR5U2VydmljZSk7XG4gICAgc2VhcmNoU2VydmljZSA9IGVudGl0eVNlcnZpY2UuZ2V0U2VhcmNoU2VydmljZSgpO1xuICAgIGNvbnRyb2xsZXIgPSBuZXcgVGVzdEVudGl0eUNvbnRyb2xsZXIoKTtcbiAgICBoYXJuZXNzID0gbmV3IExhbWJkYVRlc3RIYXJuZXNzKGNvbnRyb2xsZXIgYXMgYW55KTtcblxuICAgIC8vIENsZWFuIHVwIGFuZCBjcmVhdGUgaW5kZXhcbiAgICBjb25zdCBlbmdpbmUgPSBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpIGFzIE1laWxpU2VhcmNoRW5naW5lO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBleGlzdHMgPSBhd2FpdCBlbmdpbmUuaW5kZXhFeGlzdHMoaW5kZXhOYW1lKTtcbiAgICAgIGlmIChleGlzdHMpIGF3YWl0IGVuZ2luZS5kZWxldGVJbmRleChpbmRleE5hbWUsIHRydWUpO1xuICAgIH0gY2F0Y2ggeyB9XG4gICAgYXdhaXQgbmV3IFByb21pc2UocmVzID0+IHNldFRpbWVvdXQocmVzLCAxMDAwKSk7XG4gICAgYXdhaXQgc2VhcmNoU2VydmljZS5pbml0U2VhcmNoSW5kZXgoKTtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXMgPT4gc2V0VGltZW91dChyZXMsIDIwMDApKTtcbiAgfSwgNjAwMDApO1xuXG4gIGFmdGVyQWxsKGFzeW5jICgpID0+IHtcbiAgICBjb25zdCBlbmdpbmUgPSBzZWFyY2hTZXJ2aWNlLmdldEVuZ2luZSgpIGFzIE1laWxpU2VhcmNoRW5naW5lO1xuICAgIHRyeSB7IGF3YWl0IGVuZ2luZS5kZWxldGVJbmRleChpbmRleE5hbWUsIHRydWUpOyB9IGNhdGNoIHsgfVxuICB9LCA2MDAwMCk7XG5cbiAgLy8gLS0tIFNlZWQgZGF0YSBiZWZvcmUgZWFjaCB0ZXN0IC0tLVxuICBjb25zdCB0ZXN0RW50aXRpZXMgPSBbXG4gICAgeyBpZDogJzEnLCBuYW1lOiAnQWxwaGEgUHJvZHVjdCcsIHN0YXR1czogJ2FjdGl2ZScsIGNyZWF0ZWRBdDogJzIwMjMtMDEtMDEnIH0sXG4gICAgeyBpZDogJzInLCBuYW1lOiAnQmV0YSBTZXJ2aWNlJywgc3RhdHVzOiAnaW5hY3RpdmUnLCBjcmVhdGVkQXQ6ICcyMDIzLTAxLTAyJyB9LFxuICAgIHsgaWQ6ICczJywgbmFtZTogJ0dhbW1hIFRvb2wnLCBzdGF0dXM6ICdhY3RpdmUnLCBjcmVhdGVkQXQ6ICcyMDIzLTAxLTAzJyB9LFxuICAgIHsgaWQ6ICc0JywgbmFtZTogJ0RlbHRhIEFwcCcsIHN0YXR1czogJ3BlbmRpbmcnLCBjcmVhdGVkQXQ6ICcyMDIzLTAxLTA0JyB9LFxuICAgIHsgaWQ6ICc1JywgbmFtZTogJ0FscGhhIEJldGEgTWl4Jywgc3RhdHVzOiAnYWN0aXZlJywgY3JlYXRlZEF0OiAnMjAyMy0wMS0wNScgfSxcbiAgXTtcblxuICBiZWZvcmVFYWNoKGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBzZWFyY2hTZXJ2aWNlLmJ1bGtTeW5jKHRlc3RFbnRpdGllcyk7XG4gICAgYXdhaXQgbmV3IFByb21pc2UocmVzID0+IHNldFRpbWVvdXQocmVzLCAxMDAwKSk7XG4gIH0pO1xuXG4gIGFmdGVyRWFjaChhc3luYyAoKSA9PiB7XG4gICAgLy8gQ2xlYW4gdXAgaW5kZXggYmV0d2VlbiB0ZXN0c1xuICAgIGF3YWl0IHNlYXJjaFNlcnZpY2UuZGVsZXRlQWxsRG9jdW1lbnRzKCk7XG4gICAgYXdhaXQgbmV3IFByb21pc2UocmVzID0+IHNldFRpbWVvdXQocmVzLCA1MDApKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1BPU1QgL3NlYXJjaCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJldHVybiBhbGwgaXRlbXMgZm9yIGVtcHR5IHNlYXJjaCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wb3N0KCcvc2VhcmNoJywgeyBib2R5OiB7fSB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSg1KTtcbiAgICAgIGV4cGVjdChib2R5LnRvdGFsKS50b0JlKDUpO1xuICAgIH0sIDYwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIGJ5IHNlYXJjaCBzdHJpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL3NlYXJjaCcsIHsgYm9keTogeyBzZWFyY2g6ICdBbHBoYScgfSB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSgyKTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KChpdGVtOiBhbnkpID0+IGl0ZW0ubmFtZS5pbmNsdWRlcygnQWxwaGEnKSkpLnRvQmUodHJ1ZSk7XG4gICAgfSwgNjAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgYnkgc3RhdHVzIHdpdGggZXEgb3BlcmF0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL3NlYXJjaCcsIHsgYm9keTogeyBmaWx0ZXJzOiB7IHN0YXR1czogeyBlcTogJ2FjdGl2ZScgfSB9IH0gfSk7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmUoMyk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgoaXRlbTogYW55KSA9PiBpdGVtLnN0YXR1cyA9PT0gJ2FjdGl2ZScpKS50b0JlKHRydWUpO1xuICAgIH0sIDYwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIGJ5IHN0YXR1cyB3aXRoIG5lcSBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wb3N0KCcvc2VhcmNoJywgeyBib2R5OiB7IGZpbHRlcnM6IHsgc3RhdHVzOiB7IG5lcTogJ2FjdGl2ZScgfSB9IH0gfSk7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmUoMik7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgoaXRlbTogYW55KSA9PiBpdGVtLnN0YXR1cyAhPT0gJ2FjdGl2ZScpKS50b0JlKHRydWUpO1xuICAgIH0sIDYwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHdpdGggaW4gb3BlcmF0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL3NlYXJjaCcsIHtcbiAgICAgICAgYm9keTogeyBmaWx0ZXJzOiB7IHN0YXR1czogeyBpbjogWyAnYWN0aXZlJywgJ3BlbmRpbmcnIF0gfSB9IH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlKDQpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKGl0ZW06IGFueSkgPT4gWyAnYWN0aXZlJywgJ3BlbmRpbmcnIF0uaW5jbHVkZXMoaXRlbS5zdGF0dXMpKSkudG9CZSh0cnVlKTtcbiAgICB9LCA2MDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciB3aXRoIG5pbiBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wb3N0KCcvc2VhcmNoJywge1xuICAgICAgICBib2R5OiB7IGZpbHRlcnM6IHsgc3RhdHVzOiB7IG5pbjogWyAnaW5hY3RpdmUnIF0gfSB9IH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlKDQpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKGl0ZW06IGFueSkgPT4gaXRlbS5zdGF0dXMgIT09ICdpbmFjdGl2ZScpKS50b0JlKHRydWUpO1xuICAgIH0sIDYwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHdpdGggTk9UIGxvZ2ljYWwgb3BlcmF0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL3NlYXJjaCcsIHtcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIGZpbHRlcnM6IHtcbiAgICAgICAgICAgIG5vdDogW1xuICAgICAgICAgICAgICB7IHN0YXR1czogeyBlcTogJ2luYWN0aXZlJyB9IH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlKDQpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKGl0ZW06IGFueSkgPT4gaXRlbS5zdGF0dXMgIT09ICdpbmFjdGl2ZScpKS50b0JlKHRydWUpO1xuICAgIH0sIDYwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgc29ydCByZXN1bHRzIGJ5IG5hbWUgYXNjZW5kaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLnBvc3QoJy9zZWFyY2gnLCB7XG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICBzb3J0OiBbIHsgZmllbGQ6ICduYW1lJywgZGlyOiAnYXNjJyB9IF1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmUoNSk7XG4gICAgICBjb25zdCBuYW1lcyA9IGJvZHkuaXRlbXMubWFwKChpdGVtOiBhbnkpID0+IGl0ZW0ubmFtZSk7XG4gICAgICBleHBlY3QobmFtZXMpLnRvRXF1YWwoWyAuLi5uYW1lcyBdLnNvcnQoKSk7XG4gICAgfSwgNjAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBzb3J0IHJlc3VsdHMgYnkgY3JlYXRlZEF0IGRlc2NlbmRpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL3NlYXJjaCcsIHtcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIHNvcnQ6IFsgeyBmaWVsZDogJ2NyZWF0ZWRBdCcsIGRpcjogJ2Rlc2MnIH0gXVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSg1KTtcbiAgICAgIGNvbnN0IGRhdGVzID0gYm9keS5pdGVtcy5tYXAoKGl0ZW06IGFueSkgPT4gaXRlbS5jcmVhdGVkQXQpO1xuICAgICAgZXhwZWN0KGRhdGVzKS50b0VxdWFsKFsgLi4uZGF0ZXMgXS5zb3J0KCkucmV2ZXJzZSgpKTtcbiAgICB9LCA2MDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIHNlbGVjdCBzcGVjaWZpYyBmaWVsZHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL3NlYXJjaCcsIHtcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIHNlbGVjdDogWyAnaWQnLCAnbmFtZScgXVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSg1KTtcbiAgICAgIGJvZHkuaXRlbXMuZm9yRWFjaCgoaXRlbTogYW55KSA9PiB7XG4gICAgICAgIGV4cGVjdChPYmplY3Qua2V5cyhpdGVtKS5zb3J0KCkpLnRvRXF1YWwoWyAnaWQnLCAnbmFtZScgXS5zb3J0KCkpO1xuICAgICAgfSk7XG4gICAgfSwgNjAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBjb21iaW5lIHNlYXJjaCwgZmlsdGVycywgc29ydCwgYW5kIHBhZ2luYXRpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL3NlYXJjaCcsIHtcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIHNlYXJjaDogJ0FscGhhJyxcbiAgICAgICAgICBmaWx0ZXJzOiB7IHN0YXR1czogeyBlcTogJ2FjdGl2ZScgfSB9LFxuICAgICAgICAgIHNvcnQ6IFsgeyBmaWVsZDogJ25hbWUnLCBkaXI6ICdhc2MnIH0gXSxcbiAgICAgICAgICBwYWdpbmF0aW9uOiB7IHBhZ2U6IDEsIGxpbWl0OiAxIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmUoMSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtc1sgMCBdLm5hbWUpLnRvQmUoJ0FscGhhIEJldGEgTWl4Jyk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtc1sgMCBdLnN0YXR1cykudG9CZSgnYWN0aXZlJyk7XG4gICAgfSwgNjAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBwYWdpbmF0ZSByZXN1bHRzIGNvcnJlY3RseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHBhZ2UxID0gYXdhaXQgaGFybmVzcy5wb3N0KCcvc2VhcmNoJywge1xuICAgICAgICBib2R5OiB7XG4gICAgICAgICAgc29ydDogWyB7IGZpZWxkOiAnaWQnLCBkaXI6ICdhc2MnIH0gXSxcbiAgICAgICAgICBwYWdpbmF0aW9uOiB7IHBhZ2U6IDEsIGxpbWl0OiAyIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBjb25zdCBwYWdlMiA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL3NlYXJjaCcsIHtcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIHNvcnQ6IFsgeyBmaWVsZDogJ2lkJywgZGlyOiAnYXNjJyB9IF0sXG4gICAgICAgICAgcGFnaW5hdGlvbjogeyBwYWdlOiAyLCBsaW1pdDogMiB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocGFnZTEuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgZXhwZWN0KHBhZ2UyLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcblxuICAgICAgY29uc3QgYm9keTEgPSBKU09OLnBhcnNlKHBhZ2UxLmJvZHkpO1xuICAgICAgY29uc3QgYm9keTIgPSBKU09OLnBhcnNlKHBhZ2UyLmJvZHkpO1xuXG4gICAgICBleHBlY3QoYm9keTEuaXRlbXMubGVuZ3RoKS50b0JlKDIpO1xuICAgICAgZXhwZWN0KGJvZHkyLml0ZW1zLmxlbmd0aCkudG9CZSgyKTtcbiAgICAgIGV4cGVjdChib2R5MS50b3RhbCkudG9CZSg1KTtcbiAgICAgIGV4cGVjdChib2R5Mi50b3RhbCkudG9CZSg1KTtcblxuICAgICAgLy8gRW5zdXJlIG5vIG92ZXJsYXAgYmV0d2VlbiBwYWdlc1xuICAgICAgY29uc3QgcGFnZTFJZHMgPSBib2R5MS5pdGVtcy5tYXAoKGl0ZW06IGFueSkgPT4gaXRlbS5pZCk7XG4gICAgICBjb25zdCBwYWdlMklkcyA9IGJvZHkyLml0ZW1zLm1hcCgoaXRlbTogYW55KSA9PiBpdGVtLmlkKTtcbiAgICAgIGV4cGVjdChwYWdlMUlkcykubm90LnRvRXF1YWwoZXhwZWN0LmFycmF5Q29udGFpbmluZyhwYWdlMklkcykpO1xuICAgIH0sIDYwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGVtcHR5IHJlc3VsdHMgZm9yIG5vbi1tYXRjaGluZyBzZWFyY2gnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL3NlYXJjaCcsIHsgYm9keTogeyBzZWFyY2g6ICdOb25FeGlzdGVudCcgfSB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChib2R5LnRvdGFsKS50b0JlKDApO1xuICAgIH0sIDYwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHNwZWNpYWwgY2hhcmFjdGVycyBpbiBzZWFyY2gnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBGaXJzdCBhZGQgYW4gZW50aXR5IHdpdGggc3BlY2lhbCBjaGFyYWN0ZXJzXG4gICAgICBjb25zdCBzcGVjaWFsRW50aXR5ID0geyBpZDogJzk5JywgbmFtZTogJ1Rlc3QtSXRlbSBAIyQlJywgc3RhdHVzOiAnYWN0aXZlJywgY3JlYXRlZEF0OiAnMjAyMy0wMS05OScgfTtcbiAgICAgIGF3YWl0IHNlYXJjaFNlcnZpY2Uuc3luY1RvSW5kZXgoc3BlY2lhbEVudGl0eSwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHRydWUpO1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzID0+IHNldFRpbWVvdXQocmVzLCAxMDAwKSk7XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wb3N0KCcvc2VhcmNoJywgeyBib2R5OiB7IHNlYXJjaDogJ1Rlc3QtSXRlbScgfSB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSgxKTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zWyAwIF0ubmFtZSkudG9CZSgnVGVzdC1JdGVtIEAjJCUnKTtcbiAgICB9LCA2MDAwMCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdHRVQgL3NlYXJjaCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHN1cHBvcnQgc2VhcmNoIHZpYSBxdWVyeSBzdHJpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvc2VhcmNoJywgeyBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgcTogJ0JldGEnIH0gfSk7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmUoMik7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgoaXRlbTogYW55KSA9PiBpdGVtLm5hbWUuaW5jbHVkZXMoJ0JldGEnKSkpLnRvQmUodHJ1ZSk7XG4gICAgfSwgNjAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBzdXBwb3J0IGZpbHRlcnMgdmlhIHF1ZXJ5IHN0cmluZyB3aXRoIGVxIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3NlYXJjaCcsIHsgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IHN0YXR1czogJ2luYWN0aXZlJyB9IH0pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlKDEpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXNbIDAgXS5zdGF0dXMpLnRvQmUoJ2luYWN0aXZlJyk7XG4gICAgfSwgNjAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBzdXBwb3J0IGluIGZpbHRlciB2aWEgcXVlcnkgc3RyaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3NlYXJjaCcsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ3N0YXR1cy5pbic6ICdhY3RpdmUscGVuZGluZydcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmUoNCk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgoaXRlbTogYW55KSA9PiBbICdhY3RpdmUnLCAncGVuZGluZycgXS5pbmNsdWRlcyhpdGVtLnN0YXR1cykpKS50b0JlKHRydWUpO1xuICAgIH0sIDYwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgc3VwcG9ydCBzb3J0aW5nIHZpYSBxdWVyeSBzdHJpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvc2VhcmNoJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICBzb3J0OiAnbmFtZTphc2MnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlKDUpO1xuICAgICAgY29uc3QgbmFtZXMgPSBib2R5Lml0ZW1zLm1hcCgoaXRlbTogYW55KSA9PiBpdGVtLm5hbWUpO1xuICAgICAgZXhwZWN0KG5hbWVzKS50b0VxdWFsKFsgLi4ubmFtZXMgXS5zb3J0KCkpO1xuICAgIH0sIDYwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgc3VwcG9ydCBtdWx0aXBsZSBzb3J0IGZpZWxkcyB2aWEgcXVlcnkgc3RyaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3NlYXJjaCcsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgc29ydDogJ3N0YXR1czphc2MsbmFtZTpkZXNjJ1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSg1KTtcbiAgICB9LCA2MDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIHN1cHBvcnQgZmllbGQgc2VsZWN0aW9uIHZpYSBxdWVyeSBzdHJpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvc2VhcmNoJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICBhdHRyaWJ1dGVzOiAnaWQsbmFtZSdcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmUoNSk7XG4gICAgICBib2R5Lml0ZW1zLmZvckVhY2goKGl0ZW06IGFueSkgPT4ge1xuICAgICAgICBleHBlY3QoT2JqZWN0LmtleXMoaXRlbSkuc29ydCgpKS50b0VxdWFsKFsgJ2lkJywgJ25hbWUnIF0uc29ydCgpKTtcbiAgICAgIH0pO1xuICAgIH0sIDYwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgc3VwcG9ydCBwYWdpbmF0aW9uIHZpYSBxdWVyeSBzdHJpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvc2VhcmNoJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICBoaXRzUGVyUGFnZTogJzInLFxuICAgICAgICAgIHBhZ2U6ICcyJyxcbiAgICAgICAgICBzb3J0OiAnaWQ6YXNjJ1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSgyKTtcbiAgICAgIGV4cGVjdChib2R5LnRvdGFsKS50b0JlKDUpO1xuICAgICAgZXhwZWN0KFsgJzMnLCAnNCcgXSkudG9Db250YWluKGJvZHkuaXRlbXNbIDAgXS5pZCk7XG4gICAgfSwgNjAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBjb21iaW5lIG11bHRpcGxlIHF1ZXJ5IHBhcmFtZXRlcnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvc2VhcmNoJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICBxOiAnQWxwaGEnLFxuICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgc29ydDogJ25hbWU6YXNjJyxcbiAgICAgICAgICBoaXRzUGVyUGFnZTogJzEnLFxuICAgICAgICAgIHBhZ2U6ICcxJ1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSgxKTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zWyAwIF0ubmFtZS5pbmNsdWRlcygnQWxwaGEnKSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zWyAwIF0uc3RhdHVzKS50b0JlKCdhY3RpdmUnKTtcbiAgICB9LCA2MDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBxdWVyeSBwYXJhbWV0ZXJzIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvc2VhcmNoJywgeyBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHt9IH0pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlKDUpO1xuICAgICAgZXhwZWN0KGJvZHkudG90YWwpLnRvQmUoNSk7XG4gICAgfSwgNjAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgaW52YWxpZCBwYWdpbmF0aW9uIHBhcmFtZXRlcnMgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9zZWFyY2gnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGhpdHNQZXJQYWdlOiAnaW52YWxpZCcsXG4gICAgICAgICAgcGFnZTogJ25vdGFudW1iZXInXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgLy8gU2hvdWxkIHVzZSBkZWZhdWx0IHBhZ2luYXRpb24gdmFsdWVzXG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKTtcbiAgICB9LCA2MDAwMCk7XG4gIH0pO1xufSk7ICJdfQ==