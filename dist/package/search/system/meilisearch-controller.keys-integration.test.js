"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const engines_1 = require("../engines");
const di_1 = require("../../di");
const meilisearch_controller_1 = require("./meilisearch-controller");
const lambda_test_harness_1 = require("../../testing/lambda-test-harness");
describe('MeiliSearch API Keys Integration', () => {
    let controller;
    let harness;
    let engine;
    let testKeyUid;
    beforeAll(async () => {
        // Setup MeiliSearch engine
        di_1.DIContainer.ROOT.setSearchEngine(new engines_1.MeiliSearchEngine({
            host: 'http://localhost:7700',
            apiKey: 'xxx_your_master_key',
        }));
        controller = new meilisearch_controller_1.MeiliSearchSystemController(di_1.DIContainer.ROOT);
        harness = new lambda_test_harness_1.LambdaTestHarness(controller);
        engine = di_1.DIContainer.ROOT.resolveSearchEngine();
    }, 30000);
    describe('GET /api-keys', () => {
        it('should return API keys with cursor-based pagination format', async () => {
            const response = await harness.get('/api-keys', {
                queryStringParameters: { count: '5' }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            // Verify response format matches entity controller pattern
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            // Cursor can be string or null depending on if there are more results
            expect(typeof body.cursor === 'string' || body.cursor === null).toBe(true);
        }, 30000);
        it('should support cursor-based pagination with multiple pages', async () => {
            // Get first page
            const page1 = await harness.get('/api-keys', {
                queryStringParameters: { count: '2' }
            });
            expect(page1.statusCode).toBe(200);
            const body1 = JSON.parse(page1.body);
            expect(body1.items.length).toBeLessThanOrEqual(2);
            // Cursor might be null if there are no more results
            if (body1.items.length === 2) {
                expect(body1.cursor).toBeTruthy();
            }
            else {
                // If we have fewer than 2 items, cursor should be null
                expect(body1.cursor).toBeNull();
            }
            // Get second page using cursor (if cursor exists)
            if (body1.cursor) {
                const page2 = await harness.get('/api-keys', {
                    queryStringParameters: {
                        count: '2',
                        cursor: body1.cursor
                    }
                });
                expect(page2.statusCode).toBe(200);
                const body2 = JSON.parse(page2.body);
                expect(body2.items.length).toBeLessThanOrEqual(2);
                // Verify different keys (if any exist)
                if (body1.items.length > 0 && body2.items.length > 0) {
                    expect(body2.items[0].uid).not.toBe(body1.items[0].uid);
                }
            }
        }, 30000);
        it('should filter API keys by UID using entity-style query', async () => {
            // First get a key to get its UID
            const firstResponse = await harness.get('/api-keys', {
                queryStringParameters: { count: '1' }
            });
            expect(firstResponse.statusCode).toBe(200);
            const firstBody = JSON.parse(firstResponse.body);
            if (firstBody.items.length === 0) {
                console.log('No API keys available for UID filter test');
                return;
            }
            const keyUid = firstBody.items[0].uid;
            const response = await harness.get('/api-keys', {
                queryStringParameters: {
                    'uid.eq': keyUid,
                    count: '10'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            expect(body.items.length).toBeGreaterThan(0);
            expect(body.items.some((key) => key.uid === keyUid)).toBe(true);
        }, 30000);
        it('should filter API keys by name using contains operator', async () => {
            const response = await harness.get('/api-keys', {
                queryStringParameters: {
                    'name.contains': 'Default',
                    count: '10'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            if (body.items.length > 0) {
                expect(body.items.every((key) => key.name && key.name.toLowerCase().includes('default'))).toBe(true);
            }
        }, 30000);
        it('should filter API keys by description using contains operator', async () => {
            const response = await harness.get('/api-keys', {
                queryStringParameters: {
                    'description.contains': 'search',
                    count: '10'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            if (body.items.length > 0) {
                expect(body.items.every((key) => key.description && key.description.toLowerCase().includes('search'))).toBe(true);
            }
        }, 30000);
        it('should filter API keys by actions using IN operator', async () => {
            const response = await harness.get('/api-keys', {
                queryStringParameters: {
                    'actions.in': 'search,documents.get',
                    count: '10'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            if (body.items.length > 0) {
                expect(body.items.every((key) => key.actions && key.actions.some((action) => ['search', 'documents.get'].includes(action)))).toBe(true);
            }
        }, 30000);
        it('should filter API keys by indexes using IN operator', async () => {
            const response = await harness.get('/api-keys', {
                queryStringParameters: {
                    'indexes.in': '*',
                    count: '10'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            if (body.items.length > 0) {
                expect(body.items.every((key) => key.indexes && key.indexes.includes('*'))).toBe(true);
            }
        }, 30000);
        it('should filter API keys by key value using contains operator', async () => {
            // First get a key to get its key value
            const firstResponse = await harness.get('/api-keys', {
                queryStringParameters: { count: '1' }
            });
            expect(firstResponse.statusCode).toBe(200);
            const firstBody = JSON.parse(firstResponse.body);
            if (firstBody.items.length === 0) {
                console.log('No API keys available for key filter test');
                return;
            }
            const keyValue = firstBody.items[0].key;
            const partialKey = keyValue.substring(0, 8); // Use first 8 characters
            const response = await harness.get('/api-keys', {
                queryStringParameters: {
                    'key.contains': partialKey,
                    count: '10'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            expect(body.items.length).toBeGreaterThan(0);
            expect(body.items.some((key) => key.key.includes(partialKey))).toBe(true);
        }, 30000);
        it('should filter API keys by expiresAt using gt operator', async () => {
            const response = await harness.get('/api-keys', {
                queryStringParameters: {
                    'expiresAt.gt': '2024-01-01T00:00:00Z',
                    count: '10'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            if (body.items.length > 0) {
                expect(body.items.every((key) => key.expiresAt && new Date(key.expiresAt) > new Date('2024-01-01T00:00:00Z'))).toBe(true);
            }
        }, 30000);
        it('should filter API keys by createdAt using gt operator', async () => {
            const response = await harness.get('/api-keys', {
                queryStringParameters: {
                    'createdAt.gt': '2024-01-01T00:00:00Z',
                    count: '10'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            if (body.items.length > 0) {
                expect(body.items.every((key) => key.createdAt && new Date(key.createdAt) > new Date('2024-01-01T00:00:00Z'))).toBe(true);
            }
        }, 30000);
        it('should handle complex filter combinations for API keys', async () => {
            const response = await harness.get('/api-keys', {
                queryStringParameters: {
                    'actions.in': 'search',
                    'indexes.in': '*',
                    count: '10'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            if (body.items.length > 0) {
                expect(body.items.every((key) => key.actions && key.actions.includes('search') &&
                    key.indexes && key.indexes.includes('*'))).toBe(true);
            }
        }, 30000);
    });
    describe('GET /api-keys/{keyOrUid}', () => {
        it('should return a specific API key by UID', async () => {
            // First get a key to get its UID
            const firstResponse = await harness.get('/api-keys', {
                queryStringParameters: { count: '1' }
            });
            expect(firstResponse.statusCode).toBe(200);
            const firstBody = JSON.parse(firstResponse.body);
            if (firstBody.items.length === 0) {
                console.log('No API keys available for single key test');
                return;
            }
            const keyUid = firstBody.items[0].uid;
            const response = await harness.get(`/api-keys/${keyUid}`, {
                pathParameters: {
                    keyOrUid: keyUid
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('uid');
            expect(body).toHaveProperty('key');
            expect(body).toHaveProperty('actions');
            expect(body).toHaveProperty('indexes');
            expect(body.uid).toBe(keyUid);
        }, 30000);
        it('should return a specific API key by key value', async () => {
            // First get a key to get its key value
            const firstResponse = await harness.get('/api-keys', {
                queryStringParameters: { count: '1' }
            });
            expect(firstResponse.statusCode).toBe(200);
            const firstBody = JSON.parse(firstResponse.body);
            if (firstBody.items.length === 0) {
                console.log('No API keys available for key value test');
                return;
            }
            const keyValue = firstBody.items[0].key;
            const response = await harness.get(`/api-keys/${keyValue}`, {
                pathParameters: {
                    keyOrUid: keyValue
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('uid');
            expect(body).toHaveProperty('key');
            expect(body).toHaveProperty('actions');
            expect(body).toHaveProperty('indexes');
            expect(body.key).toBe(keyValue);
        }, 30000);
    });
    describe('POST /api-keys', () => {
        it('should create a new API key with required fields', async () => {
            const newKeyData = {
                name: 'Test API Key',
                description: 'Test key for integration testing',
                actions: ['search', 'documents.get'],
                indexes: ['*'],
                expiresAt: '2025-12-31T23:59:59Z'
            };
            const response = await harness.post('/api-keys', {
                body: newKeyData
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('uid');
            expect(body).toHaveProperty('key');
            expect(body).toHaveProperty('name');
            expect(body).toHaveProperty('description');
            expect(body).toHaveProperty('actions');
            expect(body).toHaveProperty('indexes');
            expect(body).toHaveProperty('expiresAt');
            expect(body).toHaveProperty('createdAt');
            expect(body).toHaveProperty('updatedAt');
            expect(body.name).toBe(newKeyData.name);
            expect(body.description).toBe(newKeyData.description);
            expect(body.actions).toEqual(newKeyData.actions);
            expect(body.indexes).toEqual(newKeyData.indexes);
            // Store the UID for cleanup
            testKeyUid = body.uid;
        }, 30000);
        it('should create a new API key without optional fields', async () => {
            const newKeyData = {
                actions: ['search'],
                indexes: ['*'],
                name: "test no optional fields",
                expiresAt: '2025-12-31T23:59:59Z'
            };
            const response = await harness.post('/api-keys', {
                body: newKeyData
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('uid');
            expect(body).toHaveProperty('key');
            expect(body).toHaveProperty('actions');
            expect(body).toHaveProperty('indexes');
            expect(body.actions).toEqual(newKeyData.actions);
            expect(body.indexes).toEqual(newKeyData.indexes);
            // Store the UID for cleanup
            if (!testKeyUid) {
                testKeyUid = body.uid;
            }
        }, 30000);
        it('should reject creation without required fields', async () => {
            const invalidKeyData = {
                name: 'Test API Key'
                // Missing required actions and indexes
            };
            const response = await harness.post('/api-keys', {
                body: invalidKeyData
            });
            expect(response.statusCode).toBe(400);
        }, 30000);
    });
    describe('PUT /api-keys/{keyOrUid}', () => {
        it('should update an API key name and description', async () => {
            if (!testKeyUid) {
                console.log('No test key available for update test');
                return;
            }
            const updateData = {
                name: 'Updated Test API Key',
                description: 'Updated description for testing'
            };
            const response = await harness.put(`/api-keys/${testKeyUid}`, {
                pathParameters: {
                    keyOrUid: testKeyUid
                },
                body: updateData
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('uid');
            expect(body).toHaveProperty('name');
            expect(body).toHaveProperty('description');
            expect(body.name).toBe(updateData.name);
            expect(body.description).toBe(updateData.description);
        }, 30000);
        it('should update only the name field', async () => {
            if (!testKeyUid) {
                console.log('No test key available for partial update test');
                return;
            }
            const updateData = {
                name: 'Partially Updated Key'
            };
            const response = await harness.put(`/api-keys/${testKeyUid}`, {
                pathParameters: {
                    keyOrUid: testKeyUid
                },
                body: updateData
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('name');
            expect(body.name).toBe(updateData.name);
        }, 30000);
    });
    describe('DELETE /api-keys/{keyOrUid}', () => {
        it('should delete an API key by UID', async () => {
            if (!testKeyUid) {
                console.log('No test key available for delete test');
                return;
            }
            const response = await harness.delete(`/api-keys/${testKeyUid}`, {
                pathParameters: {
                    keyOrUid: testKeyUid
                }
            });
            expect(response.statusCode).toBe(200);
        }, 30000);
        it('should return 404 for non-existent key', async () => {
            const response = await harness.delete('/api-keys/non-existent-uid', {
                pathParameters: {
                    keyOrUid: 'non-existent-uid'
                }
            });
            expect(response.statusCode).toBe(500);
            const body = JSON.parse(response.body);
            expect(body.details.message).toBe('API key `non-existent-uid` not found.');
        }, 30000);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGlzZWFyY2gtY29udHJvbGxlci5rZXlzLWludGVncmF0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9tZWlsaXNlYXJjaC1jb250cm9sbGVyLmtleXMtaW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHdDQUErQztBQUMvQyxpQ0FBdUM7QUFDdkMscUVBQXVFO0FBQ3ZFLDJFQUFzRTtBQUV0RSxRQUFRLENBQUMsa0NBQWtDLEVBQUUsR0FBRyxFQUFFO0lBQ2hELElBQUksVUFBdUMsQ0FBQztJQUM1QyxJQUFJLE9BQTBCLENBQUM7SUFDL0IsSUFBSSxNQUF5QixDQUFDO0lBQzlCLElBQUksVUFBa0IsQ0FBQztJQUV2QixTQUFTLENBQUMsS0FBSyxJQUFJLEVBQUU7UUFDbkIsMkJBQTJCO1FBQzNCLGdCQUFXLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxJQUFJLDJCQUFpQixDQUFDO1lBQ3JELElBQUksRUFBRSx1QkFBdUI7WUFDN0IsTUFBTSxFQUFFLHFCQUFxQjtTQUM5QixDQUFDLENBQUMsQ0FBQztRQUVKLFVBQVUsR0FBRyxJQUFJLG9EQUEyQixDQUFDLGdCQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDL0QsT0FBTyxHQUFHLElBQUksdUNBQWlCLENBQUMsVUFBaUIsQ0FBQyxDQUFDO1FBQ25ELE1BQU0sR0FBRyxnQkFBVyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsRUFBdUIsQ0FBQztJQUN2RSxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFFVixRQUFRLENBQUMsZUFBZSxFQUFFLEdBQUcsRUFBRTtRQUM3QixFQUFFLENBQUMsNERBQTRELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDMUUsTUFBTSxRQUFRLEdBQUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRTtnQkFDOUMscUJBQXFCLEVBQUUsRUFBRSxLQUFL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RUFBRTtnQkFDL0QsY0FBYyxFQUFFO29CQUNkLFFBQVEsRUFBRSxVQUFVO2lCQUNyQjthQUNGLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3hDLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUVWLEVBQUUsQ0FBQyx3Q0FBd0MsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN0RCxNQUFNLFFBQVEsR0FBRyxNQUFNLE9BQU8sQ0FBQyxNQUFNLENBQUMsNEJBQTRCLEVBQUU7Z0JBQ2xFLGNBQWMsRUFBRTtvQkFDZCxRQUFRLEVBQUUsa0JBQWtCO2lCQUM3QjthQUNGLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3RDLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDO1FBQzdFLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUNaLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBNZWlsaVNlYXJjaEVuZ2luZSB9IGZyb20gJy4uL2VuZ2luZXMnO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi8uLi9kaSc7XG5pbXBvcnQgeyBNZWlsaVNlYXJjaFN5c3RlbUNvbnRyb2xsZXIgfSBmcm9tICcuL21laWxpc2VhcmNoLWNvbnRyb2xsZXInO1xuaW1wb3J0IHsgTGFtYmRhVGVzdEhhcm5lc3MgfSBmcm9tICcuLi8uLi90ZXN0aW5nL2xhbWJkYS10ZXN0LWhhcm5lc3MnO1xuXG5kZXNjcmliZSgnTWVpbGlTZWFyY2ggQVBJIEtleXMgSW50ZWdyYXRpb24nLCAoKSA9PiB7XG4gIGxldCBjb250cm9sbGVyOiBNZWlsaVNlYXJjaFN5c3RlbUNvbnRyb2xsZXI7XG4gIGxldCBoYXJuZXNzOiBMYW1iZGFUZXN0SGFybmVzcztcbiAgbGV0IGVuZ2luZTogTWVpbGlTZWFyY2hFbmdpbmU7XG4gIGxldCB0ZXN0S2V5VWlkOiBzdHJpbmc7XG5cbiAgYmVmb3JlQWxsKGFzeW5jICgpID0+IHtcbiAgICAvLyBTZXR1cCBNZWlsaVNlYXJjaCBlbmdpbmVcbiAgICBESUNvbnRhaW5lci5ST09ULnNldFNlYXJjaEVuZ2luZShuZXcgTWVpbGlTZWFyY2hFbmdpbmUoe1xuICAgICAgaG9zdDogJ2h0dHA6Ly9sb2NhbGhvc3Q6NzcwMCcsXG4gICAgICBhcGlLZXk6ICd4eHhfeW91cl9tYXN0ZXJfa2V5JyxcbiAgICB9KSk7XG5cbiAgICBjb250cm9sbGVyID0gbmV3IE1laWxpU2VhcmNoU3lzdGVtQ29udHJvbGxlcihESUNvbnRhaW5lci5ST09UKTtcbiAgICBoYXJuZXNzID0gbmV3IExhbWJkYVRlc3RIYXJuZXNzKGNvbnRyb2xsZXIgYXMgYW55KTtcbiAgICBlbmdpbmUgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmVTZWFyY2hFbmdpbmUoKSBhcyBNZWlsaVNlYXJjaEVuZ2luZTtcbiAgfSwgMzAwMDApO1xuXG4gIGRlc2NyaWJlKCdHRVQgL2FwaS1rZXlzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcmV0dXJuIEFQSSBrZXlzIHdpdGggY3Vyc29yLWJhc2VkIHBhZ2luYXRpb24gZm9ybWF0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgY291bnQ6ICc1JyB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICAvLyBWZXJpZnkgcmVzcG9uc2UgZm9ybWF0IG1hdGNoZXMgZW50aXR5IGNvbnRyb2xsZXIgcGF0dGVyblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgLy8gQ3Vyc29yIGNhbiBiZSBzdHJpbmcgb3IgbnVsbCBkZXBlbmRpbmcgb24gaWYgdGhlcmUgYXJlIG1vcmUgcmVzdWx0c1xuICAgICAgZXhwZWN0KHR5cGVvZiBib2R5LmN1cnNvciA9PT0gJ3N0cmluZycgfHwgYm9keS5jdXJzb3IgPT09IG51bGwpLnRvQmUodHJ1ZSk7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBzdXBwb3J0IGN1cnNvci1iYXNlZCBwYWdpbmF0aW9uIHdpdGggbXVsdGlwbGUgcGFnZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBHZXQgZmlyc3QgcGFnZVxuICAgICAgY29uc3QgcGFnZTEgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgY291bnQ6ICcyJyB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChwYWdlMS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5MSA9IEpTT04ucGFyc2UocGFnZTEuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5MS5pdGVtcy5sZW5ndGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoMik7XG4gICAgICAvLyBDdXJzb3IgbWlnaHQgYmUgbnVsbCBpZiB0aGVyZSBhcmUgbm8gbW9yZSByZXN1bHRzXG4gICAgICBpZiAoYm9keTEuaXRlbXMubGVuZ3RoID09PSAyKSB7XG4gICAgICAgIGV4cGVjdChib2R5MS5jdXJzb3IpLnRvQmVUcnV0aHkoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElmIHdlIGhhdmUgZmV3ZXIgdGhhbiAyIGl0ZW1zLCBjdXJzb3Igc2hvdWxkIGJlIG51bGxcbiAgICAgICAgZXhwZWN0KGJvZHkxLmN1cnNvcikudG9CZU51bGwoKTtcbiAgICAgIH1cblxuICAgICAgLy8gR2V0IHNlY29uZCBwYWdlIHVzaW5nIGN1cnNvciAoaWYgY3Vyc29yIGV4aXN0cylcbiAgICAgIGlmIChib2R5MS5jdXJzb3IpIHtcbiAgICAgICAgY29uc3QgcGFnZTIgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBcbiAgICAgICAgICAgIGNvdW50OiAnMicsXG4gICAgICAgICAgICBjdXJzb3I6IGJvZHkxLmN1cnNvclxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGV4cGVjdChwYWdlMi5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICAgIGNvbnN0IGJvZHkyID0gSlNPTi5wYXJzZShwYWdlMi5ib2R5KTtcbiAgICAgICAgXG4gICAgICAgIGV4cGVjdChib2R5Mi5pdGVtcy5sZW5ndGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoMik7XG4gICAgICAgIFxuICAgICAgICAvLyBWZXJpZnkgZGlmZmVyZW50IGtleXMgKGlmIGFueSBleGlzdClcbiAgICAgICAgaWYgKGJvZHkxLml0ZW1zLmxlbmd0aCA+IDAgJiYgYm9keTIuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGV4cGVjdChib2R5Mi5pdGVtc1swXS51aWQpLm5vdC50b0JlKGJvZHkxLml0ZW1zWzBdLnVpZCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciBBUEkga2V5cyBieSBVSUQgdXNpbmcgZW50aXR5LXN0eWxlIHF1ZXJ5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gRmlyc3QgZ2V0IGEga2V5IHRvIGdldCBpdHMgVUlEXG4gICAgICBjb25zdCBmaXJzdFJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IGNvdW50OiAnMScgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QoZmlyc3RSZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBmaXJzdEJvZHkgPSBKU09OLnBhcnNlKGZpcnN0UmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGlmIChmaXJzdEJvZHkuaXRlbXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdObyBBUEkga2V5cyBhdmFpbGFibGUgZm9yIFVJRCBmaWx0ZXIgdGVzdCcpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBcbiAgICAgIGNvbnN0IGtleVVpZCA9IGZpcnN0Qm9keS5pdGVtc1swXS51aWQ7XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ3VpZC5lcSc6IGtleVVpZCxcbiAgICAgICAgICBjb3VudDogJzEwJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuc29tZSgoa2V5OiBhbnkpID0+IGtleS51aWQgPT09IGtleVVpZCkpLnRvQmUodHJ1ZSk7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgQVBJIGtleXMgYnkgbmFtZSB1c2luZyBjb250YWlucyBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ25hbWUuY29udGFpbnMnOiAnRGVmYXVsdCcsXG4gICAgICAgICAgY291bnQ6ICcxMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KChrZXk6IGFueSkgPT4gXG4gICAgICAgICAga2V5Lm5hbWUgJiYga2V5Lm5hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnZGVmYXVsdCcpXG4gICAgICAgICkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgQVBJIGtleXMgYnkgZGVzY3JpcHRpb24gdXNpbmcgY29udGFpbnMgb3BlcmF0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvYXBpLWtleXMnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgICdkZXNjcmlwdGlvbi5jb250YWlucyc6ICdzZWFyY2gnLFxuICAgICAgICAgIGNvdW50OiAnMTAnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgoa2V5OiBhbnkpID0+IFxuICAgICAgICAgIGtleS5kZXNjcmlwdGlvbiAmJiBrZXkuZGVzY3JpcHRpb24udG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnc2VhcmNoJylcbiAgICAgICAgKSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciBBUEkga2V5cyBieSBhY3Rpb25zIHVzaW5nIElOIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnYWN0aW9ucy5pbic6ICdzZWFyY2gsZG9jdW1lbnRzLmdldCcsXG4gICAgICAgICAgY291bnQ6ICcxMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KChrZXk6IGFueSkgPT4gXG4gICAgICAgICAga2V5LmFjdGlvbnMgJiYga2V5LmFjdGlvbnMuc29tZSgoYWN0aW9uOiBzdHJpbmcpID0+IFxuICAgICAgICAgICAgWydzZWFyY2gnLCAnZG9jdW1lbnRzLmdldCddLmluY2x1ZGVzKGFjdGlvbilcbiAgICAgICAgICApXG4gICAgICAgICkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgQVBJIGtleXMgYnkgaW5kZXhlcyB1c2luZyBJTiBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ2luZGV4ZXMuaW4nOiAnKicsXG4gICAgICAgICAgY291bnQ6ICcxMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KChrZXk6IGFueSkgPT4gXG4gICAgICAgICAga2V5LmluZGV4ZXMgJiYga2V5LmluZGV4ZXMuaW5jbHVkZXMoJyonKVxuICAgICAgICApKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIEFQSSBrZXlzIGJ5IGtleSB2YWx1ZSB1c2luZyBjb250YWlucyBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEZpcnN0IGdldCBhIGtleSB0byBnZXQgaXRzIGtleSB2YWx1ZVxuICAgICAgY29uc3QgZmlyc3RSZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvYXBpLWtleXMnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBjb3VudDogJzEnIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGZpcnN0UmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgZmlyc3RCb2R5ID0gSlNPTi5wYXJzZShmaXJzdFJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBpZiAoZmlyc3RCb2R5Lml0ZW1zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBjb25zb2xlLmxvZygnTm8gQVBJIGtleXMgYXZhaWxhYmxlIGZvciBrZXkgZmlsdGVyIHRlc3QnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgXG4gICAgICBjb25zdCBrZXlWYWx1ZSA9IGZpcnN0Qm9keS5pdGVtc1swXS5rZXk7XG4gICAgICBjb25zdCBwYXJ0aWFsS2V5ID0ga2V5VmFsdWUuc3Vic3RyaW5nKDAsIDgpOyAvLyBVc2UgZmlyc3QgOCBjaGFyYWN0ZXJzXG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ2tleS5jb250YWlucyc6IHBhcnRpYWxLZXksXG4gICAgICAgICAgY291bnQ6ICcxMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLnNvbWUoKGtleTogYW55KSA9PiBrZXkua2V5LmluY2x1ZGVzKHBhcnRpYWxLZXkpKSkudG9CZSh0cnVlKTtcbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciBBUEkga2V5cyBieSBleHBpcmVzQXQgdXNpbmcgZ3Qgb3BlcmF0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvYXBpLWtleXMnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgICdleHBpcmVzQXQuZ3QnOiAnMjAyNC0wMS0wMVQwMDowMDowMFonLFxuICAgICAgICAgIGNvdW50OiAnMTAnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgoa2V5OiBhbnkpID0+IFxuICAgICAgICAgIGtleS5leHBpcmVzQXQgJiYgbmV3IERhdGUoa2V5LmV4cGlyZXNBdCkgPiBuZXcgRGF0ZSgnMjAyNC0wMS0wMVQwMDowMDowMFonKVxuICAgICAgICApKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIEFQSSBrZXlzIGJ5IGNyZWF0ZWRBdCB1c2luZyBndCBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ2NyZWF0ZWRBdC5ndCc6ICcyMDI0LTAxLTAxVDAwOjAwOjAwWicsXG4gICAgICAgICAgY291bnQ6ICcxMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KChrZXk6IGFueSkgPT4gXG4gICAgICAgICAga2V5LmNyZWF0ZWRBdCAmJiBuZXcgRGF0ZShrZXkuY3JlYXRlZEF0KSA+IG5ldyBEYXRlKCcyMDI0LTAxLTAxVDAwOjAwOjAwWicpXG4gICAgICAgICkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29tcGxleCBmaWx0ZXIgY29tYmluYXRpb25zIGZvciBBUEkga2V5cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ2FjdGlvbnMuaW4nOiAnc2VhcmNoJyxcbiAgICAgICAgICAnaW5kZXhlcy5pbic6ICcqJyxcbiAgICAgICAgICBjb3VudDogJzEwJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICAgIFxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgoa2V5OiBhbnkpID0+IFxuICAgICAgICAgIGtleS5hY3Rpb25zICYmIGtleS5hY3Rpb25zLmluY2x1ZGVzKCdzZWFyY2gnKSAmJlxuICAgICAgICAgIGtleS5pbmRleGVzICYmIGtleS5pbmRleGVzLmluY2x1ZGVzKCcqJylcbiAgICAgICAgKSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdHRVQgL2FwaS1rZXlzL3trZXlPclVpZH0nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gYSBzcGVjaWZpYyBBUEkga2V5IGJ5IFVJRCcsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEZpcnN0IGdldCBhIGtleSB0byBnZXQgaXRzIFVJRFxuICAgICAgY29uc3QgZmlyc3RSZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvYXBpLWtleXMnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBjb3VudDogJzEnIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGZpcnN0UmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgZmlyc3RCb2R5ID0gSlNPTi5wYXJzZShmaXJzdFJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBpZiAoZmlyc3RCb2R5Lml0ZW1zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBjb25zb2xlLmxvZygnTm8gQVBJIGtleXMgYXZhaWxhYmxlIGZvciBzaW5nbGUga2V5IHRlc3QnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgXG4gICAgICBjb25zdCBrZXlVaWQgPSBmaXJzdEJvZHkuaXRlbXNbMF0udWlkO1xuICAgICAgXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KGAvYXBpLWtleXMvJHtrZXlVaWR9YCwge1xuICAgICAgICBwYXRoUGFyYW1ldGVyczoge1xuICAgICAgICAgIGtleU9yVWlkOiBrZXlVaWRcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgndWlkJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2tleScpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdhY3Rpb25zJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2luZGV4ZXMnKTtcbiAgICAgIGV4cGVjdChib2R5LnVpZCkudG9CZShrZXlVaWQpO1xuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGEgc3BlY2lmaWMgQVBJIGtleSBieSBrZXkgdmFsdWUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBGaXJzdCBnZXQgYSBrZXkgdG8gZ2V0IGl0cyBrZXkgdmFsdWVcbiAgICAgIGNvbnN0IGZpcnN0UmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgY291bnQ6ICcxJyB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChmaXJzdFJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGZpcnN0Qm9keSA9IEpTT04ucGFyc2UoZmlyc3RSZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgaWYgKGZpcnN0Qm9keS5pdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgY29uc29sZS5sb2coJ05vIEFQSSBrZXlzIGF2YWlsYWJsZSBmb3Iga2V5IHZhbHVlIHRlc3QnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgXG4gICAgICBjb25zdCBrZXlWYWx1ZSA9IGZpcnN0Qm9keS5pdGVtc1swXS5rZXk7XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoYC9hcGkta2V5cy8ke2tleVZhbHVlfWAsIHtcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBrZXlPclVpZDoga2V5VmFsdWVcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgndWlkJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2tleScpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdhY3Rpb25zJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2luZGV4ZXMnKTtcbiAgICAgIGV4cGVjdChib2R5LmtleSkudG9CZShrZXlWYWx1ZSk7XG4gICAgfSwgMzAwMDApO1xuICB9KTtcblxuICBkZXNjcmliZSgnUE9TVCAvYXBpLWtleXMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgYSBuZXcgQVBJIGtleSB3aXRoIHJlcXVpcmVkIGZpZWxkcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG5ld0tleURhdGEgPSB7XG4gICAgICAgIG5hbWU6ICdUZXN0IEFQSSBLZXknLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1Rlc3Qga2V5IGZvciBpbnRlZ3JhdGlvbiB0ZXN0aW5nJyxcbiAgICAgICAgYWN0aW9uczogWydzZWFyY2gnLCAnZG9jdW1lbnRzLmdldCddLFxuICAgICAgICBpbmRleGVzOiBbJyonXSxcbiAgICAgICAgZXhwaXJlc0F0OiAnMjAyNS0xMi0zMVQyMzo1OTo1OVonXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL2FwaS1rZXlzJywge1xuICAgICAgICBib2R5OiBuZXdLZXlEYXRhXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ3VpZCcpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdrZXknKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnbmFtZScpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdkZXNjcmlwdGlvbicpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdhY3Rpb25zJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2luZGV4ZXMnKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnZXhwaXJlc0F0Jyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2NyZWF0ZWRBdCcpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCd1cGRhdGVkQXQnKTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGJvZHkubmFtZSkudG9CZShuZXdLZXlEYXRhLm5hbWUpO1xuICAgICAgZXhwZWN0KGJvZHkuZGVzY3JpcHRpb24pLnRvQmUobmV3S2V5RGF0YS5kZXNjcmlwdGlvbik7XG4gICAgICBleHBlY3QoYm9keS5hY3Rpb25zKS50b0VxdWFsKG5ld0tleURhdGEuYWN0aW9ucyk7XG4gICAgICBleHBlY3QoYm9keS5pbmRleGVzKS50b0VxdWFsKG5ld0tleURhdGEuaW5kZXhlcyk7XG4gICAgICBcbiAgICAgIC8vIFN0b3JlIHRoZSBVSUQgZm9yIGNsZWFudXBcbiAgICAgIHRlc3RLZXlVaWQgPSBib2R5LnVpZDtcbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhIG5ldyBBUEkga2V5IHdpdGhvdXQgb3B0aW9uYWwgZmllbGRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbmV3S2V5RGF0YSA9IHtcbiAgICAgICAgYWN0aW9uczogWydzZWFyY2gnXSxcbiAgICAgICAgaW5kZXhlczogWyAnKicgXSxcbiAgICAgICAgbmFtZTogXCJ0ZXN0IG5vIG9wdGlvbmFsIGZpZWxkc1wiLFxuICAgICAgICBleHBpcmVzQXQ6ICcyMDI1LTEyLTMxVDIzOjU5OjU5WidcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wb3N0KCcvYXBpLWtleXMnLCB7XG4gICAgICAgIGJvZHk6IG5ld0tleURhdGFcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgndWlkJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2tleScpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdhY3Rpb25zJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2luZGV4ZXMnKTtcbiAgICAgIGV4cGVjdChib2R5LmFjdGlvbnMpLnRvRXF1YWwobmV3S2V5RGF0YS5hY3Rpb25zKTtcbiAgICAgIGV4cGVjdChib2R5LmluZGV4ZXMpLnRvRXF1YWwobmV3S2V5RGF0YS5pbmRleGVzKTtcbiAgICAgIFxuICAgICAgLy8gU3RvcmUgdGhlIFVJRCBmb3IgY2xlYW51cFxuICAgICAgaWYgKCF0ZXN0S2V5VWlkKSB7XG4gICAgICAgIHRlc3RLZXlVaWQgPSBib2R5LnVpZDtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIHJlamVjdCBjcmVhdGlvbiB3aXRob3V0IHJlcXVpcmVkIGZpZWxkcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGludmFsaWRLZXlEYXRhID0ge1xuICAgICAgICBuYW1lOiAnVGVzdCBBUEkgS2V5J1xuICAgICAgICAvLyBNaXNzaW5nIHJlcXVpcmVkIGFjdGlvbnMgYW5kIGluZGV4ZXNcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wb3N0KCcvYXBpLWtleXMnLCB7XG4gICAgICAgIGJvZHk6IGludmFsaWRLZXlEYXRhXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoNDAwKTtcbiAgICB9LCAzMDAwMCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdQVVQgL2FwaS1rZXlzL3trZXlPclVpZH0nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCB1cGRhdGUgYW4gQVBJIGtleSBuYW1lIGFuZCBkZXNjcmlwdGlvbicsIGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGVzdEtleVVpZCkge1xuICAgICAgICBjb25zb2xlLmxvZygnTm8gdGVzdCBrZXkgYXZhaWxhYmxlIGZvciB1cGRhdGUgdGVzdCcpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHVwZGF0ZURhdGEgPSB7XG4gICAgICAgIG5hbWU6ICdVcGRhdGVkIFRlc3QgQVBJIEtleScsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVXBkYXRlZCBkZXNjcmlwdGlvbiBmb3IgdGVzdGluZydcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wdXQoYC9hcGkta2V5cy8ke3Rlc3RLZXlVaWR9YCwge1xuICAgICAgICBwYXRoUGFyYW1ldGVyczoge1xuICAgICAgICAgIGtleU9yVWlkOiB0ZXN0S2V5VWlkXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IHVwZGF0ZURhdGFcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgndWlkJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ25hbWUnKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnZGVzY3JpcHRpb24nKTtcbiAgICAgIGV4cGVjdChib2R5Lm5hbWUpLnRvQmUodXBkYXRlRGF0YS5uYW1lKTtcbiAgICAgIGV4cGVjdChib2R5LmRlc2NyaXB0aW9uKS50b0JlKHVwZGF0ZURhdGEuZGVzY3JpcHRpb24pO1xuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgdXBkYXRlIG9ubHkgdGhlIG5hbWUgZmllbGQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRlc3RLZXlVaWQpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ05vIHRlc3Qga2V5IGF2YWlsYWJsZSBmb3IgcGFydGlhbCB1cGRhdGUgdGVzdCcpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHVwZGF0ZURhdGEgPSB7XG4gICAgICAgIG5hbWU6ICdQYXJ0aWFsbHkgVXBkYXRlZCBLZXknXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucHV0KGAvYXBpLWtleXMvJHt0ZXN0S2V5VWlkfWAsIHtcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBrZXlPclVpZDogdGVzdEtleVVpZFxuICAgICAgICB9LFxuICAgICAgICBib2R5OiB1cGRhdGVEYXRhXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ25hbWUnKTtcbiAgICAgIGV4cGVjdChib2R5Lm5hbWUpLnRvQmUodXBkYXRlRGF0YS5uYW1lKTtcbiAgICB9LCAzMDAwMCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdERUxFVEUgL2FwaS1rZXlzL3trZXlPclVpZH0nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBkZWxldGUgYW4gQVBJIGtleSBieSBVSUQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRlc3RLZXlVaWQpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ05vIHRlc3Qga2V5IGF2YWlsYWJsZSBmb3IgZGVsZXRlIHRlc3QnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZGVsZXRlKGAvYXBpLWtleXMvJHt0ZXN0S2V5VWlkfWAsIHtcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBrZXlPclVpZDogdGVzdEtleVVpZFxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gNDA0IGZvciBub24tZXhpc3RlbnQga2V5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmRlbGV0ZSgnL2FwaS1rZXlzL25vbi1leGlzdGVudC11aWQnLCB7XG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAga2V5T3JVaWQ6ICdub24tZXhpc3RlbnQtdWlkJ1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDUwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIGV4cGVjdChib2R5LmRldGFpbHMubWVzc2FnZSkudG9CZSgnQVBJIGtleSBgbm9uLWV4aXN0ZW50LXVpZGAgbm90IGZvdW5kLicpO1xuICAgIH0sIDMwMDAwKTtcbiAgfSk7XG59KTsgIl19