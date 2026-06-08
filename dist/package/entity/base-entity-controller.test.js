"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
const base_entity_controller_1 = require("./base-entity-controller");
const base_service_1 = require("./base-service");
const lambda_test_harness_1 = require("../testing/lambda-test-harness");
const decorators_1 = require("../decorators");
const errors_1 = require("../errors");
// Mock the BaseEntityService
class MockEntityService extends base_service_1.BaseEntityService {
    constructor() {
        super({}, {});
    }
    getEntityName() {
        return 'testEntity';
    }
    extractEntityIdentifiers(input) {
        return { id: input.id };
    }
    async create(payload) {
        return { id: 'test-id', ...payload };
    }
    async get(options) {
        if (options.identifiers.id === 'not-found') {
            throw new errors_1.NotFoundError('TestEntity');
        }
        return { id: options.identifiers.id, name: 'Test Entity' };
    }
    async list(query) {
        const mockData = [
            { id: '1', name: 'Entity 1', status: 'active' },
            { id: '2', name: 'Entity 2', status: 'inactive' }
        ];
        // Apply filters if present
        let filteredData = mockData;
        if (query.filters) {
            filteredData = mockData.filter(item => {
                return Object.entries(query.filters).every(([key, value]) => item[key] === value);
            });
        }
        // Apply pagination
        const limit = query.pagination?.limit || 10;
        const offset = query.pagination?.cursor ? parseInt(query.pagination.cursor) : 0;
        const paginatedData = filteredData.slice(offset, offset + limit);
        return {
            data: paginatedData,
            cursor: offset + limit < filteredData.length ? (offset + limit).toString() : null,
            query: query
        };
    }
    async update(identifiers, data) {
        if (identifiers.id === 'not-found') {
            throw new errors_1.NotFoundError('TestEntity');
        }
        return { id: identifiers.id, ...data };
    }
    async delete(identifiers) {
        if (identifiers.id === 'not-found') {
            throw new errors_1.NotFoundError('TestEntity');
        }
        return {
            data: {
                id: identifiers.id,
                name: 'Deleted Entity',
                pk: 'test',
                sk: 'test',
                gsi1pk: 'test',
                gsi1sk: 'test'
            }
        };
    }
    async query(query) {
        const mockData = [
            { id: '1', name: 'Query Result 1', status: 'active' },
            { id: '2', name: 'Query Result 2', status: 'inactive' }
        ];
        // Apply filters if present
        let filteredData = mockData;
        if (query.filters) {
            filteredData = mockData.filter(item => {
                return Object.entries(query.filters).every(([key, value]) => item[key] === value);
            });
        }
        return {
            data: filteredData,
            cursor: 'query-next-cursor',
            query: query
        };
    }
    async search(query) {
        const mockData = [
            { id: '1', name: 'Search Result 1', status: 'active' },
            { id: '2', name: 'Search Result 2', status: 'inactive' }
        ];
        // Apply filters if present
        let filteredData = mockData;
        // if (query.filters) {
        //   filteredData = mockData.filter(item => {
        //     return Object.entries(query.filters).every(([ key, value ]) => item[ key ] === value);
        //   });
        // }
        // Apply search if present
        if (query.search) {
            filteredData = filteredData.filter(item => item.name.toLowerCase().includes(query.search.toLowerCase()));
        }
        return {
            hits: filteredData,
            facets: { status: { active: filteredData.filter(i => i.status === 'active').length } },
            total: filteredData.length,
            page: query.pagination?.pages || 1,
            hitsPerPage: query.pagination?.count || 10,
            processingTimeMs: 50
        };
    }
    async duplicate(identifiers) {
        if (identifiers.id === 'not-found') {
            throw new errors_1.NotFoundError('TestEntity');
        }
        return {
            data: {
                id: 'duplicated-id',
                name: 'Duplicated Entity',
                pk: 'test',
                sk: 'test',
                gsi1pk: 'test',
                gsi1sk: 'test'
            }
        };
    }
}
// Create a concrete implementation of BaseEntityController for testing
let TestEntityController = class TestEntityController extends base_entity_controller_1.BaseEntityController {
    constructor() {
        super(new MockEntityService());
    }
};
TestEntityController = __decorate([
    (0, decorators_1.Controller)('testentity')
], TestEntityController);
describe('BaseEntityController', () => {
    let controller;
    let harness;
    beforeEach(() => {
        controller = new TestEntityController();
        // (controller as any).controllerName = 'testEntity';
        harness = new lambda_test_harness_1.LambdaTestHarness(controller);
    });
    describe('create', () => {
        it('should create a new entity', async () => {
            const response = await harness.post('', {
                body: { name: 'New Entity' }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.testEntity).toBeDefined();
            expect(body.testEntity.id).toBe('test-id');
            expect(body.testEntity.name).toBe('New Entity');
            expect(body.message).toBe('Created successfully');
        });
    });
    describe('find', () => {
        it('should find an entity by id', async () => {
            const response = await harness.get('/123', {
                pathParameters: { id: '123' },
                resourcePath: '/{id}'
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.testEntity).toBeDefined();
            expect(body.testEntity.id).toBe('123');
            expect(body.testEntity.name).toBe('Test Entity');
        });
        it('should return 404 when entity is not found', async () => {
            const response = await harness.get('/not-found', {
                pathParameters: { id: 'not-found' },
                resourcePath: '/{id}'
            });
            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.body);
            expect(body.status).toBe('error');
            expect(body.message).toContain('Resource Not Found');
        });
    });
    describe('list', () => {
        it('should list entities', async () => {
            const response = await harness.get('', {
                queryStringParameters: {
                    limit: '10',
                    order: 'desc'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items).toBeDefined();
            expect(body.items.length).toBe(2);
            expect(body.cursor).toBeDefined();
        });
        it('should handle filters', async () => {
            const response = await harness.get('', {
                queryStringParameters: {
                    filters: JSON.stringify({ status: 'active' })
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items).toBeDefined();
            expect(body.items.length).toBe(1);
            expect(body.items[0].status).toBe('active');
        });
    });
    describe('update', () => {
        it('should update an entity', async () => {
            const response = await harness.patch('/123', {
                pathParameters: { id: '123' },
                resourcePath: '/{id}',
                body: { name: 'Updated Entity' }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.testEntity).toBeDefined();
            expect(body.testEntity.id).toBe('123');
            expect(body.testEntity.name).toBe('Updated Entity');
            expect(body.message).toBe('Updated successfully');
        });
        it('should return 404 when entity to update is not found', async () => {
            const response = await harness.patch('/not-found', {
                pathParameters: { id: 'not-found' },
                resourcePath: '/{id}',
                body: { name: 'Updated Entity' }
            });
            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.body);
            expect(body.status).toBe('error');
            expect(body.message).toContain('Resource Not Found');
        });
    });
    describe('delete', () => {
        it('should delete an entity', async () => {
            const response = await harness.delete('/123', {
                pathParameters: { id: '123' },
                resourcePath: '/{id}'
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.testEntity).toBeDefined();
            expect(body.testEntity.data.id).toBe('123');
            expect(body.testEntity.data.name).toBe('Deleted Entity');
            expect(body.message).toBe('Deleted successfully');
        });
        it('should return 404 when entity to delete is not found', async () => {
            const response = await harness.delete('/not-found', {
                pathParameters: { id: 'not-found' },
                resourcePath: '/{id}'
            });
            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.body);
            expect(body.status).toBe('error');
            expect(body.message).toContain('Resource Not Found');
        });
    });
    describe('query', () => {
        it('should perform a query', async () => {
            const response = await harness.post('/query', {
                body: {
                    filters: { status: 'active' }
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items).toBeDefined();
            expect(body.items.length).toBe(1);
            expect(body.cursor).toBe('query-next-cursor');
        });
    });
    describe('search', () => {
        it('should perform a search', async () => {
            const response = await harness.post('/search', {
                body: {
                    search: 'Result',
                    filters: { status: 'active' }
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items).toBeDefined();
            expect(body.items.length).toBe(2);
            expect(body.total).toBe(2);
            expect(body.facets).toBeDefined();
            expect(body.facets.status.active).toBe(1);
        });
        it('should perform a search via GET', async () => {
            const response = await harness.get('/search', {
                queryStringParameters: {
                    q: 'result 1',
                    status: 'active',
                    hitsPerPage: '10',
                    page: '1'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.items).toBeDefined();
            expect(body.items.length).toBe(1);
            expect(body.facets).toBeDefined();
            expect(body.total).toBe(1);
            expect(body.page).toBe(1);
            expect(body.hitsPerPage).toBe(10);
        });
    });
    describe('duplicate', () => {
        it('should duplicate an entity', async () => {
            const response = await harness.get('/duplicate/123', {
                pathParameters: { id: '123' },
                resourcePath: '/duplicate/{id}'
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.testEntity).toBeDefined();
            expect(body.testEntity.data).toBeDefined();
            expect(body.testEntity.data.id).toBe('duplicated-id');
            expect(body.testEntity.data.name).toBe('Duplicated Entity');
        });
        it('should return 404 when entity to duplicate is not found', async () => {
            const response = await harness.get('/duplicate/not-found', {
                pathParameters: { id: 'not-found' },
                resourcePath: '/duplicate/{id}'
            });
            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.body);
            expect(body.status).toBe('error');
            expect(body.message).toContain('Resource Not Found');
        });
    });
    describe('getSignedUrlForFileUpload', () => {
        it('should get a signed URL for file upload', async () => {
            // Mock the getSignedUrlForFileUpload function
            jest.spyOn(require('../client/s3'), 'getSignedUrlForFileUpload').mockResolvedValue('https://example.com/signed-url');
            const response = await harness.get('/getSignedUrlForFileUpload', {
                resourcePath: '/getSignedUrlForFileUpload',
                queryStringParameters: {
                    fileName: 'test.jpg',
                    bucketName: 'test-bucket',
                    expiresIn: '900',
                    fileNamePrefix: 'prefix-',
                    contentType: 'image/jpeg',
                    metadata: JSON.stringify({ key: 'value' })
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.fileName).toBeDefined();
            expect(body.fileName).toContain('prefix-');
            expect(body.fileName).toContain('.jpg');
            expect(body.expiresIn).toBe(900);
            expect(body.contentType).toBe('image/jpeg');
            expect(body.signedUploadURL).toBe('https://example.com/signed-url');
        });
        it('should handle missing required parameters', async () => {
            const response = await harness.get('/getSignedUrlForFileUpload', {
                resourcePath: '/getSignedUrlForFileUpload',
                queryStringParameters: {
                // Missing required fileName and bucketName
                }
            });
            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.body);
            expect(body.status).toBe('error');
            expect(body.message).toBe('Validation Failed');
            expect(body.details).toBeDefined();
            expect(body.details.errors).toBeDefined();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1lbnRpdHktY29udHJvbGxlci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9iYXNlLWVudGl0eS1jb250cm9sbGVyLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFBQSxxRUFBZ0U7QUFDaEUsaURBQW1EO0FBRW5ELHdFQUFtRTtBQUduRSw4Q0FBMkM7QUFDM0Msc0NBQTBDO0FBRTFDLDZCQUE2QjtBQUM3QixNQUFNLGlCQUFrQixTQUFRLGdDQUFzQjtJQUNwRDtRQUNFLEtBQUssQ0FBQyxFQUFpQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQy9DLENBQUM7SUFFRCxhQUFhO1FBQ1gsT0FBTyxZQUFZLENBQUM7SUFDdEIsQ0FBQztJQUVELHdCQUF3QixDQUFDLEtBQTZCO1FBQ3BELE9BQU8sRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLEVBQUUsRUFBRSxDQUFDO0lBQzFCLENBQUM7SUFFRCxLQUFLLENBQUMsTUFBTSxDQUFDLE9BQVk7UUFDdkIsT0FBTyxFQUFFLEVBQUUsRUFBRSxTQUFTLEVBQUUsR0FBRyxPQUFPLEVBQUUsQ0FBQztJQUN2QyxDQUFDO0lBRUQsS0FBSyxDQUFDLEdBQUcsQ0FBQyxPQUFZO1FBQ3BCLElBQUksT0FBTyxDQUFDLFdBQVcsQ0FBQyxFQUFFLEtBQUssV0FBVyxFQUFFLENBQUM7WUFDM0MsTUFBTSxJQUFJLHNCQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDeEMsQ0FBQztRQUNELE9BQU8sRUFBRSxFQUFFLEVBQUUsT0FBTyxDQUFDLFdBQVcsQ0FBQyxFQUFFLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxDQUFDO0lBQzdELENBQUM7SUFFRCxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQVU7UUFTbkIsTUFBTSxRQUFRLEdBQWlCO1lBQzdCLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxRQUFR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WUFDbEMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQztZQUMvQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ25DLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQzVDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEJhc2VFbnRpdHlDb250cm9sbGVyIH0gZnJvbSAnLi9iYXNlLWVudGl0eS1jb250cm9sbGVyJztcbmltcG9ydCB7IEJhc2VFbnRpdHlTZXJ2aWNlIH0gZnJvbSAnLi9iYXNlLXNlcnZpY2UnO1xuaW1wb3J0IHsgRW50aXR5U2NoZW1hIH0gZnJvbSAnLi9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyBMYW1iZGFUZXN0SGFybmVzcyB9IGZyb20gJy4uL3Rlc3RpbmcvbGFtYmRhLXRlc3QtaGFybmVzcyc7XG5pbXBvcnQgeyBTZWFyY2hSZXN1bHQgfSBmcm9tICcuLi9zZWFyY2gnO1xuaW1wb3J0IHsgQ3JlYXRlRW50aXR5UmVzcG9uc2UgfSBmcm9tICcuL2NydWQtc2VydmljZSc7XG5pbXBvcnQgeyBDb250cm9sbGVyIH0gZnJvbSAnLi4vZGVjb3JhdG9ycyc7XG5pbXBvcnQgeyBOb3RGb3VuZEVycm9yIH0gZnJvbSAnLi4vZXJyb3JzJztcblxuLy8gTW9jayB0aGUgQmFzZUVudGl0eVNlcnZpY2VcbmNsYXNzIE1vY2tFbnRpdHlTZXJ2aWNlIGV4dGVuZHMgQmFzZUVudGl0eVNlcnZpY2U8YW55PiB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKHt9IGFzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Piwge30pO1xuICB9XG5cbiAgZ2V0RW50aXR5TmFtZSgpIHtcbiAgICByZXR1cm4gJ3Rlc3RFbnRpdHknO1xuICB9XG5cbiAgZXh0cmFjdEVudGl0eUlkZW50aWZpZXJzKGlucHV0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KSB7XG4gICAgcmV0dXJuIHsgaWQ6IGlucHV0LmlkIH07XG4gIH1cblxuICBhc3luYyBjcmVhdGUocGF5bG9hZDogYW55KSB7XG4gICAgcmV0dXJuIHsgaWQ6ICd0ZXN0LWlkJywgLi4ucGF5bG9hZCB9O1xuICB9XG5cbiAgYXN5bmMgZ2V0KG9wdGlvbnM6IGFueSkge1xuICAgIGlmIChvcHRpb25zLmlkZW50aWZpZXJzLmlkID09PSAnbm90LWZvdW5kJykge1xuICAgICAgdGhyb3cgbmV3IE5vdEZvdW5kRXJyb3IoJ1Rlc3RFbnRpdHknKTtcbiAgICB9XG4gICAgcmV0dXJuIHsgaWQ6IG9wdGlvbnMuaWRlbnRpZmllcnMuaWQsIG5hbWU6ICdUZXN0IEVudGl0eScgfTtcbiAgfVxuXG4gIGFzeW5jIGxpc3QocXVlcnk6IGFueSkge1xuICAgIC8vIENyZWF0ZSBhIG1vY2sgcmVzcG9uc2UgYmFzZWQgb24gdGhlIHF1ZXJ5IHBhcmFtZXRlcnNcbiAgICBpbnRlcmZhY2UgTW9ja0VudGl0eSB7XG4gICAgICBpZDogc3RyaW5nO1xuICAgICAgbmFtZTogc3RyaW5nO1xuICAgICAgc3RhdHVzOiBzdHJpbmc7XG4gICAgICBbIGtleTogc3RyaW5nIF06IHN0cmluZztcbiAgICB9XG5cbiAgICBjb25zdCBtb2NrRGF0YTogTW9ja0VudGl0eVtdID0gW1xuICAgICAgeyBpZDogJzEnLCBuYW1lOiAnRW50aXR5IDEnLCBzdGF0dXM6ICdhY3RpdmUnIH0sXG4gICAgICB7IGlkOiAnMicsIG5hbWU6ICdFbnRpdHkgMicsIHN0YXR1czogJ2luYWN0aXZlJyB9XG4gICAgXTtcblxuICAgIC8vIEFwcGx5IGZpbHRlcnMgaWYgcHJlc2VudFxuICAgIGxldCBmaWx0ZXJlZERhdGEgPSBtb2NrRGF0YTtcbiAgICBpZiAocXVlcnkuZmlsdGVycykge1xuICAgICAgZmlsdGVyZWREYXRhID0gbW9ja0RhdGEuZmlsdGVyKGl0ZW0gPT4ge1xuICAgICAgICByZXR1cm4gT2JqZWN0LmVudHJpZXMocXVlcnkuZmlsdGVycykuZXZlcnkoKFsga2V5LCB2YWx1ZSBdKSA9PiBpdGVtWyBrZXkgXSA9PT0gdmFsdWUpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQXBwbHkgcGFnaW5hdGlvblxuICAgIGNvbnN0IGxpbWl0ID0gcXVlcnkucGFnaW5hdGlvbj8ubGltaXQgfHwgMTA7XG4gICAgY29uc3Qgb2Zmc2V0ID0gcXVlcnkucGFnaW5hdGlvbj8uY3Vyc29yID8gcGFyc2VJbnQocXVlcnkucGFnaW5hdGlvbi5jdXJzb3IpIDogMDtcbiAgICBjb25zdCBwYWdpbmF0ZWREYXRhID0gZmlsdGVyZWREYXRhLnNsaWNlKG9mZnNldCwgb2Zmc2V0ICsgbGltaXQpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGRhdGE6IHBhZ2luYXRlZERhdGEsXG4gICAgICBjdXJzb3I6IG9mZnNldCArIGxpbWl0IDwgZmlsdGVyZWREYXRhLmxlbmd0aCA/IChvZmZzZXQgKyBsaW1pdCkudG9TdHJpbmcoKSA6IG51bGwsXG4gICAgICBxdWVyeTogcXVlcnlcbiAgICB9O1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlKGlkZW50aWZpZXJzOiBhbnksIGRhdGE6IGFueSkge1xuICAgIGlmIChpZGVudGlmaWVycy5pZCA9PT0gJ25vdC1mb3VuZCcpIHtcbiAgICAgIHRocm93IG5ldyBOb3RGb3VuZEVycm9yKCdUZXN0RW50aXR5Jyk7XG4gICAgfVxuICAgIHJldHVybiB7IGlkOiBpZGVudGlmaWVycy5pZCwgLi4uZGF0YSB9O1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlKGlkZW50aWZpZXJzOiBhbnkpIHtcbiAgICBpZiAoaWRlbnRpZmllcnMuaWQgPT09ICdub3QtZm91bmQnKSB7XG4gICAgICB0aHJvdyBuZXcgTm90Rm91bmRFcnJvcignVGVzdEVudGl0eScpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgZGF0YToge1xuICAgICAgICBpZDogaWRlbnRpZmllcnMuaWQsXG4gICAgICAgIG5hbWU6ICdEZWxldGVkIEVudGl0eScsXG4gICAgICAgIHBrOiAndGVzdCcsXG4gICAgICAgIHNrOiAndGVzdCcsXG4gICAgICAgIGdzaTFwazogJ3Rlc3QnLFxuICAgICAgICBnc2kxc2s6ICd0ZXN0J1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICBhc3luYyBxdWVyeShxdWVyeTogYW55KSB7XG4gICAgaW50ZXJmYWNlIE1vY2tFbnRpdHkge1xuICAgICAgaWQ6IHN0cmluZztcbiAgICAgIG5hbWU6IHN0cmluZztcbiAgICAgIHN0YXR1czogc3RyaW5nO1xuICAgICAgWyBrZXk6IHN0cmluZyBdOiBzdHJpbmc7XG4gICAgfVxuXG4gICAgY29uc3QgbW9ja0RhdGE6IE1vY2tFbnRpdHlbXSA9IFtcbiAgICAgIHsgaWQ6ICcxJywgbmFtZTogJ1F1ZXJ5IFJlc3VsdCAxJywgc3RhdHVzOiAnYWN0aXZlJyB9LFxuICAgICAgeyBpZDogJzInLCBuYW1lOiAnUXVlcnkgUmVzdWx0IDInLCBzdGF0dXM6ICdpbmFjdGl2ZScgfVxuICAgIF07XG5cbiAgICAvLyBBcHBseSBmaWx0ZXJzIGlmIHByZXNlbnRcbiAgICBsZXQgZmlsdGVyZWREYXRhID0gbW9ja0RhdGE7XG4gICAgaWYgKHF1ZXJ5LmZpbHRlcnMpIHtcbiAgICAgIGZpbHRlcmVkRGF0YSA9IG1vY2tEYXRhLmZpbHRlcihpdGVtID0+IHtcbiAgICAgICAgcmV0dXJuIE9iamVjdC5lbnRyaWVzKHF1ZXJ5LmZpbHRlcnMpLmV2ZXJ5KChbIGtleSwgdmFsdWUgXSkgPT4gaXRlbVsga2V5IF0gPT09IHZhbHVlKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBkYXRhOiBmaWx0ZXJlZERhdGEsXG4gICAgICBjdXJzb3I6ICdxdWVyeS1uZXh0LWN1cnNvcicsXG4gICAgICBxdWVyeTogcXVlcnlcbiAgICB9O1xuICB9XG5cbiAgYXN5bmMgc2VhcmNoKHF1ZXJ5OiBhbnkpIHtcbiAgICBpbnRlcmZhY2UgTW9ja0VudGl0eSB7XG4gICAgICBpZDogc3RyaW5nO1xuICAgICAgbmFtZTogc3RyaW5nO1xuICAgICAgc3RhdHVzOiBzdHJpbmc7XG4gICAgICBbIGtleTogc3RyaW5nIF06IHN0cmluZztcbiAgICB9XG5cbiAgICBjb25zdCBtb2NrRGF0YTogTW9ja0VudGl0eVtdID0gW1xuICAgICAgeyBpZDogJzEnLCBuYW1lOiAnU2VhcmNoIFJlc3VsdCAxJywgc3RhdHVzOiAnYWN0aXZlJyB9LFxuICAgICAgeyBpZDogJzInLCBuYW1lOiAnU2VhcmNoIFJlc3VsdCAyJywgc3RhdHVzOiAnaW5hY3RpdmUnIH1cbiAgICBdO1xuXG4gICAgLy8gQXBwbHkgZmlsdGVycyBpZiBwcmVzZW50XG4gICAgbGV0IGZpbHRlcmVkRGF0YSA9IG1vY2tEYXRhO1xuICAgIC8vIGlmIChxdWVyeS5maWx0ZXJzKSB7XG4gICAgLy8gICBmaWx0ZXJlZERhdGEgPSBtb2NrRGF0YS5maWx0ZXIoaXRlbSA9PiB7XG4gICAgLy8gICAgIHJldHVybiBPYmplY3QuZW50cmllcyhxdWVyeS5maWx0ZXJzKS5ldmVyeSgoWyBrZXksIHZhbHVlIF0pID0+IGl0ZW1bIGtleSBdID09PSB2YWx1ZSk7XG4gICAgLy8gICB9KTtcbiAgICAvLyB9XG5cbiAgICAvLyBBcHBseSBzZWFyY2ggaWYgcHJlc2VudFxuICAgIGlmIChxdWVyeS5zZWFyY2gpIHtcbiAgICAgIGZpbHRlcmVkRGF0YSA9IGZpbHRlcmVkRGF0YS5maWx0ZXIoaXRlbSA9PlxuICAgICAgICBpdGVtLm5hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxdWVyeS5zZWFyY2gudG9Mb3dlckNhc2UoKSlcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGhpdHM6IGZpbHRlcmVkRGF0YSxcbiAgICAgIGZhY2V0czogeyBzdGF0dXM6IHsgYWN0aXZlOiBmaWx0ZXJlZERhdGEuZmlsdGVyKGkgPT4gaS5zdGF0dXMgPT09ICdhY3RpdmUnKS5sZW5ndGggfSB9LFxuICAgICAgdG90YWw6IGZpbHRlcmVkRGF0YS5sZW5ndGgsXG4gICAgICBwYWdlOiBxdWVyeS5wYWdpbmF0aW9uPy5wYWdlcyB8fCAxLFxuICAgICAgaGl0c1BlclBhZ2U6IHF1ZXJ5LnBhZ2luYXRpb24/LmNvdW50IHx8IDEwLFxuICAgICAgcHJvY2Vzc2luZ1RpbWVNczogNTBcbiAgICB9IGFzIFNlYXJjaFJlc3VsdDxhbnk+O1xuICB9XG5cbiAgYXN5bmMgZHVwbGljYXRlKGlkZW50aWZpZXJzOiBhbnkpIHtcbiAgICBpZiAoaWRlbnRpZmllcnMuaWQgPT09ICdub3QtZm91bmQnKSB7XG4gICAgICB0aHJvdyBuZXcgTm90Rm91bmRFcnJvcignVGVzdEVudGl0eScpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgZGF0YToge1xuICAgICAgICBpZDogJ2R1cGxpY2F0ZWQtaWQnLFxuICAgICAgICBuYW1lOiAnRHVwbGljYXRlZCBFbnRpdHknLFxuICAgICAgICBwazogJ3Rlc3QnLFxuICAgICAgICBzazogJ3Rlc3QnLFxuICAgICAgICBnc2kxcGs6ICd0ZXN0JyxcbiAgICAgICAgZ3NpMXNrOiAndGVzdCdcbiAgICAgIH1cbiAgICB9IGFzIENyZWF0ZUVudGl0eVJlc3BvbnNlPGFueT47XG4gIH1cbn1cblxuLy8gQ3JlYXRlIGEgY29uY3JldGUgaW1wbGVtZW50YXRpb24gb2YgQmFzZUVudGl0eUNvbnRyb2xsZXIgZm9yIHRlc3RpbmdcbkBDb250cm9sbGVyKCd0ZXN0ZW50aXR5JylcbmNsYXNzIFRlc3RFbnRpdHlDb250cm9sbGVyIGV4dGVuZHMgQmFzZUVudGl0eUNvbnRyb2xsZXI8YW55PiB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKG5ldyBNb2NrRW50aXR5U2VydmljZSgpKTtcbiAgfVxufVxuXG5kZXNjcmliZSgnQmFzZUVudGl0eUNvbnRyb2xsZXInLCAoKSA9PiB7XG4gIGxldCBjb250cm9sbGVyOiBUZXN0RW50aXR5Q29udHJvbGxlcjtcbiAgbGV0IGhhcm5lc3M6IExhbWJkYVRlc3RIYXJuZXNzO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGNvbnRyb2xsZXIgPSBuZXcgVGVzdEVudGl0eUNvbnRyb2xsZXIoKTtcbiAgICAvLyAoY29udHJvbGxlciBhcyBhbnkpLmNvbnRyb2xsZXJOYW1lID0gJ3Rlc3RFbnRpdHknO1xuICAgIGhhcm5lc3MgPSBuZXcgTGFtYmRhVGVzdEhhcm5lc3MoY29udHJvbGxlciBhcyBhbnkpO1xuICB9KTtcblxuICBkZXNjcmliZSgnY3JlYXRlJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY3JlYXRlIGEgbmV3IGVudGl0eScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wb3N0KCcnLCB7XG4gICAgICAgIGJvZHk6IHsgbmFtZTogJ05ldyBFbnRpdHknIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS50ZXN0RW50aXR5KS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGJvZHkudGVzdEVudGl0eS5pZCkudG9CZSgndGVzdC1pZCcpO1xuICAgICAgZXhwZWN0KGJvZHkudGVzdEVudGl0eS5uYW1lKS50b0JlKCdOZXcgRW50aXR5Jyk7XG4gICAgICBleHBlY3QoYm9keS5tZXNzYWdlKS50b0JlKCdDcmVhdGVkIHN1Y2Nlc3NmdWxseScpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZmluZCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGZpbmQgYW4gZW50aXR5IGJ5IGlkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnLzEyMycsIHtcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICcxMjMnIH0sXG4gICAgICAgIHJlc291cmNlUGF0aDogJy97aWR9J1xuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5LnRlc3RFbnRpdHkpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoYm9keS50ZXN0RW50aXR5LmlkKS50b0JlKCcxMjMnKTtcbiAgICAgIGV4cGVjdChib2R5LnRlc3RFbnRpdHkubmFtZSkudG9CZSgnVGVzdCBFbnRpdHknKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIDQwNCB3aGVuIGVudGl0eSBpcyBub3QgZm91bmQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvbm90LWZvdW5kJywge1xuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJ25vdC1mb3VuZCcgfSxcbiAgICAgICAgcmVzb3VyY2VQYXRoOiAnL3tpZH0nXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoNDA0KTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgZXhwZWN0KGJvZHkuc3RhdHVzKS50b0JlKCdlcnJvcicpO1xuICAgICAgZXhwZWN0KGJvZHkubWVzc2FnZSkudG9Db250YWluKCdSZXNvdXJjZSBOb3QgRm91bmQnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2xpc3QnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBsaXN0IGVudGl0aWVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICBsaW1pdDogJzEwJyxcbiAgICAgICAgICBvcmRlcjogJ2Rlc2MnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcykudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSgyKTtcbiAgICAgIGV4cGVjdChib2R5LmN1cnNvcikudG9CZURlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGZpbHRlcnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGZpbHRlcnM6IEpTT04uc3RyaW5naWZ5KHsgc3RhdHVzOiAnYWN0aXZlJyB9KVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmUoMSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtc1sgMCBdLnN0YXR1cykudG9CZSgnYWN0aXZlJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCd1cGRhdGUnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCB1cGRhdGUgYW4gZW50aXR5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLnBhdGNoKCcvMTIzJywge1xuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJzEyMycgfSxcbiAgICAgICAgcmVzb3VyY2VQYXRoOiAnL3tpZH0nLFxuICAgICAgICBib2R5OiB7IG5hbWU6ICdVcGRhdGVkIEVudGl0eScgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5LnRlc3RFbnRpdHkpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoYm9keS50ZXN0RW50aXR5LmlkKS50b0JlKCcxMjMnKTtcbiAgICAgIGV4cGVjdChib2R5LnRlc3RFbnRpdHkubmFtZSkudG9CZSgnVXBkYXRlZCBFbnRpdHknKTtcbiAgICAgIGV4cGVjdChib2R5Lm1lc3NhZ2UpLnRvQmUoJ1VwZGF0ZWQgc3VjY2Vzc2Z1bGx5Jyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiA0MDQgd2hlbiBlbnRpdHkgdG8gdXBkYXRlIGlzIG5vdCBmb3VuZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wYXRjaCgnL25vdC1mb3VuZCcsIHtcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICdub3QtZm91bmQnIH0sXG4gICAgICAgIHJlc291cmNlUGF0aDogJy97aWR9JyxcbiAgICAgICAgYm9keTogeyBuYW1lOiAnVXBkYXRlZCBFbnRpdHknIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSg0MDQpO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5zdGF0dXMpLnRvQmUoJ2Vycm9yJyk7XG4gICAgICBleHBlY3QoYm9keS5tZXNzYWdlKS50b0NvbnRhaW4oJ1Jlc291cmNlIE5vdCBGb3VuZCcpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZGVsZXRlJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgZGVsZXRlIGFuIGVudGl0eScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5kZWxldGUoJy8xMjMnLCB7XG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGlkOiAnMTIzJyB9LFxuICAgICAgICByZXNvdXJjZVBhdGg6ICcve2lkfSdcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS50ZXN0RW50aXR5KS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGJvZHkudGVzdEVudGl0eS5kYXRhLmlkKS50b0JlKCcxMjMnKTtcbiAgICAgIGV4cGVjdChib2R5LnRlc3RFbnRpdHkuZGF0YS5uYW1lKS50b0JlKCdEZWxldGVkIEVudGl0eScpO1xuICAgICAgZXhwZWN0KGJvZHkubWVzc2FnZSkudG9CZSgnRGVsZXRlZCBzdWNjZXNzZnVsbHknKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIDQwNCB3aGVuIGVudGl0eSB0byBkZWxldGUgaXMgbm90IGZvdW5kJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmRlbGV0ZSgnL25vdC1mb3VuZCcsIHtcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICdub3QtZm91bmQnIH0sXG4gICAgICAgIHJlc291cmNlUGF0aDogJy97aWR9J1xuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDQwNCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5LnN0YXR1cykudG9CZSgnZXJyb3InKTtcbiAgICAgIGV4cGVjdChib2R5Lm1lc3NhZ2UpLnRvQ29udGFpbignUmVzb3VyY2UgTm90IEZvdW5kJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdxdWVyeScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHBlcmZvcm0gYSBxdWVyeScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wb3N0KCcvcXVlcnknLCB7XG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICBmaWx0ZXJzOiB7IHN0YXR1czogJ2FjdGl2ZScgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmUoMSk7XG4gICAgICBleHBlY3QoYm9keS5jdXJzb3IpLnRvQmUoJ3F1ZXJ5LW5leHQtY3Vyc29yJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdzZWFyY2gnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBwZXJmb3JtIGEgc2VhcmNoJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLnBvc3QoJy9zZWFyY2gnLCB7XG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICBzZWFyY2g6ICdSZXN1bHQnLFxuICAgICAgICAgIGZpbHRlcnM6IHsgc3RhdHVzOiAnYWN0aXZlJyB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcykudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSgyKTtcbiAgICAgIGV4cGVjdChib2R5LnRvdGFsKS50b0JlKDIpO1xuICAgICAgZXhwZWN0KGJvZHkuZmFjZXRzKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGJvZHkuZmFjZXRzLnN0YXR1cy5hY3RpdmUpLnRvQmUoMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHBlcmZvcm0gYSBzZWFyY2ggdmlhIEdFVCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9zZWFyY2gnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIHE6ICdyZXN1bHQgMScsXG4gICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICBoaXRzUGVyUGFnZTogJzEwJyxcbiAgICAgICAgICBwYWdlOiAnMSdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlKDEpO1xuICAgICAgZXhwZWN0KGJvZHkuZmFjZXRzKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGJvZHkudG90YWwpLnRvQmUoMSk7XG4gICAgICBleHBlY3QoYm9keS5wYWdlKS50b0JlKDEpO1xuICAgICAgZXhwZWN0KGJvZHkuaGl0c1BlclBhZ2UpLnRvQmUoMTApO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZHVwbGljYXRlJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgZHVwbGljYXRlIGFuIGVudGl0eScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9kdXBsaWNhdGUvMTIzJywge1xuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJzEyMycgfSxcbiAgICAgICAgcmVzb3VyY2VQYXRoOiAnL2R1cGxpY2F0ZS97aWR9J1xuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5LnRlc3RFbnRpdHkpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoYm9keS50ZXN0RW50aXR5LmRhdGEpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoYm9keS50ZXN0RW50aXR5LmRhdGEuaWQpLnRvQmUoJ2R1cGxpY2F0ZWQtaWQnKTtcbiAgICAgIGV4cGVjdChib2R5LnRlc3RFbnRpdHkuZGF0YS5uYW1lKS50b0JlKCdEdXBsaWNhdGVkIEVudGl0eScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gNDA0IHdoZW4gZW50aXR5IHRvIGR1cGxpY2F0ZSBpcyBub3QgZm91bmQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvZHVwbGljYXRlL25vdC1mb3VuZCcsIHtcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICdub3QtZm91bmQnIH0sXG4gICAgICAgIHJlc291cmNlUGF0aDogJy9kdXBsaWNhdGUve2lkfSdcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSg0MDQpO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5zdGF0dXMpLnRvQmUoJ2Vycm9yJyk7XG4gICAgICBleHBlY3QoYm9keS5tZXNzYWdlKS50b0NvbnRhaW4oJ1Jlc291cmNlIE5vdCBGb3VuZCcpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGdldCBhIHNpZ25lZCBVUkwgZm9yIGZpbGUgdXBsb2FkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gTW9jayB0aGUgZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZCBmdW5jdGlvblxuICAgICAgamVzdC5zcHlPbihyZXF1aXJlKCcuLi9jbGllbnQvczMnKSwgJ2dldFNpZ25lZFVybEZvckZpbGVVcGxvYWQnKS5tb2NrUmVzb2x2ZWRWYWx1ZSgnaHR0cHM6Ly9leGFtcGxlLmNvbS9zaWduZWQtdXJsJyk7XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9nZXRTaWduZWRVcmxGb3JGaWxlVXBsb2FkJywge1xuICAgICAgICByZXNvdXJjZVBhdGg6ICcvZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZCcsXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGZpbGVOYW1lOiAndGVzdC5qcGcnLFxuICAgICAgICAgIGJ1Y2tldE5hbWU6ICd0ZXN0LWJ1Y2tldCcsXG4gICAgICAgICAgZXhwaXJlc0luOiAnOTAwJyxcbiAgICAgICAgICBmaWxlTmFtZVByZWZpeDogJ3ByZWZpeC0nLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiAnaW1hZ2UvanBlZycsXG4gICAgICAgICAgbWV0YWRhdGE6IEpTT04uc3RyaW5naWZ5KHsga2V5OiAndmFsdWUnIH0pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5maWxlTmFtZSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChib2R5LmZpbGVOYW1lKS50b0NvbnRhaW4oJ3ByZWZpeC0nKTtcbiAgICAgIGV4cGVjdChib2R5LmZpbGVOYW1lKS50b0NvbnRhaW4oJy5qcGcnKTtcbiAgICAgIGV4cGVjdChib2R5LmV4cGlyZXNJbikudG9CZSg5MDApO1xuICAgICAgZXhwZWN0KGJvZHkuY29udGVudFR5cGUpLnRvQmUoJ2ltYWdlL2pwZWcnKTtcbiAgICAgIGV4cGVjdChib2R5LnNpZ25lZFVwbG9hZFVSTCkudG9CZSgnaHR0cHM6Ly9leGFtcGxlLmNvbS9zaWduZWQtdXJsJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtaXNzaW5nIHJlcXVpcmVkIHBhcmFtZXRlcnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvZ2V0U2lnbmVkVXJsRm9yRmlsZVVwbG9hZCcsIHtcbiAgICAgICAgcmVzb3VyY2VQYXRoOiAnL2dldFNpZ25lZFVybEZvckZpbGVVcGxvYWQnLFxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICAvLyBNaXNzaW5nIHJlcXVpcmVkIGZpbGVOYW1lIGFuZCBidWNrZXROYW1lXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSg0MDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBleHBlY3QoYm9keS5zdGF0dXMpLnRvQmUoJ2Vycm9yJyk7XG4gICAgICBleHBlY3QoYm9keS5tZXNzYWdlKS50b0JlKCdWYWxpZGF0aW9uIEZhaWxlZCcpO1xuICAgICAgZXhwZWN0KGJvZHkuZGV0YWlscykudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChib2R5LmRldGFpbHMuZXJyb3JzKS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuICB9KTtcbn0pOyAiXX0=