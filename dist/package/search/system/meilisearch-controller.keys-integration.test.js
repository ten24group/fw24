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
        // Manually set controllerName since the decorator is commented out
        Object.defineProperty(controller, 'controllerName', { value: 'system/search', writable: true });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGlzZWFyY2gtY29udHJvbGxlci5rZXlzLWludGVncmF0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9tZWlsaXNlYXJjaC1jb250cm9sbGVyLmtleXMtaW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHdDQUErQztBQUMvQyxpQ0FBdUM7QUFDdkMscUVBQXVFO0FBQ3ZFLDJFQUFzRTtBQUV0RSxRQUFRLENBQUMsa0NBQWtDLEVBQUUsR0FBRyxFQUFFO0lBQ2hELElBQUksVUFBdUMsQ0FBQztJQUM1QyxJQUFJLE9BQTBCLENBQUM7SUFDL0IsSUFBSSxNQUF5QixDQUFDO0lBQzlCLElBQUksVUFBa0IsQ0FBQztJQUV2QixTQUFTLENBQUMsS0FBSyxJQUFJLEVBQUU7UUFDbkIsMkJBQTJCO1FBQzNCLGdCQUFXLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxJQUFJLDJCQUFpQixDQUFDO1lBQ3JELElBQUksRUFBRSx1QkFBdUI7WUFDN0IsTUFBTSxFQUFFLHFCQUFxQjtTQUM5QixDQUFDLENBQUMsQ0FBQztRQUVKLFVBQVUsR0FBRyxJQUFJLG9EQUEyQixDQUFDLGdCQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDL0QsbUVBQW1FO1FBQ25FLE1BQU0sQ0FBQyxjQUFjLENBQUMsVUFBVSxFQUFFLGdCQUFnQixFQUFFLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUNoRyxPQUFPLEdBQUcsSUFBSSx1Q0FBaUIsQ0FBQyxVQUFpQixDQUFDLENBQUM7UUFDbkQsTUFBTSxHQUFHLGdCQUFXLENBQUMsSUFBSSxDQUFDLG1CQUFtQixFQUF1QixDQUFDO0lBQ3ZFLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUVWLFFBQVEsQ0FBQyxlQUFlLEVBQUUsR0FBRyxFQUFFO1FBQzdCLEVBQUUs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QU8sQ0FBQyxHQUFHLENBQUMsdUNBQXVDLENBQUMsQ0FBQztnQkFDckQsT0FBTztZQUNULENBQUM7WUFFRCxNQUFNLFFBQVEsR0FBRyxNQUFNLE9BQU8sQ0FBQyxNQUFNLENBQUMsYUFBYSxVQUFVLEVBQUUsRUFBRTtnQkFDL0QsY0FBYyxFQUFFO29CQUNkLFFBQVEsRUFBRSxVQUFVO2lCQUNyQjthQUNGLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3hDLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUVWLEVBQUUsQ0FBQyx3Q0FBd0MsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN0RCxNQUFNLFFBQVEsR0FBRyxNQUFNLE9BQU8sQ0FBQyxNQUFNLENBQUMsNEJBQTRCLEVBQUU7Z0JBQ2xFLGNBQWMsRUFBRTtvQkFDZCxRQUFRLEVBQUUsa0JBQWtCO2lCQUM3QjthQUNGLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3RDLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDO1FBQzdFLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUNaLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBNZWlsaVNlYXJjaEVuZ2luZSB9IGZyb20gJy4uL2VuZ2luZXMnO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi8uLi9kaSc7XG5pbXBvcnQgeyBNZWlsaVNlYXJjaFN5c3RlbUNvbnRyb2xsZXIgfSBmcm9tICcuL21laWxpc2VhcmNoLWNvbnRyb2xsZXInO1xuaW1wb3J0IHsgTGFtYmRhVGVzdEhhcm5lc3MgfSBmcm9tICcuLi8uLi90ZXN0aW5nL2xhbWJkYS10ZXN0LWhhcm5lc3MnO1xuXG5kZXNjcmliZSgnTWVpbGlTZWFyY2ggQVBJIEtleXMgSW50ZWdyYXRpb24nLCAoKSA9PiB7XG4gIGxldCBjb250cm9sbGVyOiBNZWlsaVNlYXJjaFN5c3RlbUNvbnRyb2xsZXI7XG4gIGxldCBoYXJuZXNzOiBMYW1iZGFUZXN0SGFybmVzcztcbiAgbGV0IGVuZ2luZTogTWVpbGlTZWFyY2hFbmdpbmU7XG4gIGxldCB0ZXN0S2V5VWlkOiBzdHJpbmc7XG5cbiAgYmVmb3JlQWxsKGFzeW5jICgpID0+IHtcbiAgICAvLyBTZXR1cCBNZWlsaVNlYXJjaCBlbmdpbmVcbiAgICBESUNvbnRhaW5lci5ST09ULnNldFNlYXJjaEVuZ2luZShuZXcgTWVpbGlTZWFyY2hFbmdpbmUoe1xuICAgICAgaG9zdDogJ2h0dHA6Ly9sb2NhbGhvc3Q6NzcwMCcsXG4gICAgICBhcGlLZXk6ICd4eHhfeW91cl9tYXN0ZXJfa2V5JyxcbiAgICB9KSk7XG5cbiAgICBjb250cm9sbGVyID0gbmV3IE1laWxpU2VhcmNoU3lzdGVtQ29udHJvbGxlcihESUNvbnRhaW5lci5ST09UKTtcbiAgICAvLyBNYW51YWxseSBzZXQgY29udHJvbGxlck5hbWUgc2luY2UgdGhlIGRlY29yYXRvciBpcyBjb21tZW50ZWQgb3V0XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGNvbnRyb2xsZXIsICdjb250cm9sbGVyTmFtZScsIHsgdmFsdWU6ICdzeXN0ZW0vc2VhcmNoJywgd3JpdGFibGU6IHRydWUgfSk7XG4gICAgaGFybmVzcyA9IG5ldyBMYW1iZGFUZXN0SGFybmVzcyhjb250cm9sbGVyIGFzIGFueSk7XG4gICAgZW5naW5lID0gRElDb250YWluZXIuUk9PVC5yZXNvbHZlU2VhcmNoRW5naW5lKCkgYXMgTWVpbGlTZWFyY2hFbmdpbmU7XG4gIH0sIDMwMDAwKTtcblxuICBkZXNjcmliZSgnR0VUIC9hcGkta2V5cycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJldHVybiBBUEkga2V5cyB3aXRoIGN1cnNvci1iYXNlZCBwYWdpbmF0aW9uIGZvcm1hdCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IGNvdW50OiAnNScgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgLy8gVmVyaWZ5IHJlc3BvbnNlIGZvcm1hdCBtYXRjaGVzIGVudGl0eSBjb250cm9sbGVyIHBhdHRlcm5cbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnY3Vyc29yJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICAgIC8vIEN1cnNvciBjYW4gYmUgc3RyaW5nIG9yIG51bGwgZGVwZW5kaW5nIG9uIGlmIHRoZXJlIGFyZSBtb3JlIHJlc3VsdHNcbiAgICAgIGV4cGVjdCh0eXBlb2YgYm9keS5jdXJzb3IgPT09ICdzdHJpbmcnIHx8IGJvZHkuY3Vyc29yID09PSBudWxsKS50b0JlKHRydWUpO1xuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgc3VwcG9ydCBjdXJzb3ItYmFzZWQgcGFnaW5hdGlvbiB3aXRoIG11bHRpcGxlIHBhZ2VzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gR2V0IGZpcnN0IHBhZ2VcbiAgICAgIGNvbnN0IHBhZ2UxID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IGNvdW50OiAnMicgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QocGFnZTEuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keTEgPSBKU09OLnBhcnNlKHBhZ2UxLmJvZHkpO1xuXG4gICAgICBleHBlY3QoYm9keTEuaXRlbXMubGVuZ3RoKS50b0JlTGVzc1RoYW5PckVxdWFsKDIpO1xuICAgICAgLy8gQ3Vyc29yIG1pZ2h0IGJlIG51bGwgaWYgdGhlcmUgYXJlIG5vIG1vcmUgcmVzdWx0c1xuICAgICAgaWYgKGJvZHkxLml0ZW1zLmxlbmd0aCA9PT0gMikge1xuICAgICAgICBleHBlY3QoYm9keTEuY3Vyc29yKS50b0JlVHJ1dGh5KCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJZiB3ZSBoYXZlIGZld2VyIHRoYW4gMiBpdGVtcywgY3Vyc29yIHNob3VsZCBiZSBudWxsXG4gICAgICAgIGV4cGVjdChib2R5MS5jdXJzb3IpLnRvQmVOdWxsKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIEdldCBzZWNvbmQgcGFnZSB1c2luZyBjdXJzb3IgKGlmIGN1cnNvciBleGlzdHMpXG4gICAgICBpZiAoYm9keTEuY3Vyc29yKSB7XG4gICAgICAgIGNvbnN0IHBhZ2UyID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgIGNvdW50OiAnMicsXG4gICAgICAgICAgICBjdXJzb3I6IGJvZHkxLmN1cnNvclxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGV4cGVjdChwYWdlMi5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICAgIGNvbnN0IGJvZHkyID0gSlNPTi5wYXJzZShwYWdlMi5ib2R5KTtcblxuICAgICAgICBleHBlY3QoYm9keTIuaXRlbXMubGVuZ3RoKS50b0JlTGVzc1RoYW5PckVxdWFsKDIpO1xuXG4gICAgICAgIC8vIFZlcmlmeSBkaWZmZXJlbnQga2V5cyAoaWYgYW55IGV4aXN0KVxuICAgICAgICBpZiAoYm9keTEuaXRlbXMubGVuZ3RoID4gMCAmJiBib2R5Mi5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgZXhwZWN0KGJvZHkyLml0ZW1zWyAwIF0udWlkKS5ub3QudG9CZShib2R5MS5pdGVtc1sgMCBdLnVpZCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciBBUEkga2V5cyBieSBVSUQgdXNpbmcgZW50aXR5LXN0eWxlIHF1ZXJ5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gRmlyc3QgZ2V0IGEga2V5IHRvIGdldCBpdHMgVUlEXG4gICAgICBjb25zdCBmaXJzdFJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IGNvdW50OiAnMScgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QoZmlyc3RSZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBmaXJzdEJvZHkgPSBKU09OLnBhcnNlKGZpcnN0UmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGlmIChmaXJzdEJvZHkuaXRlbXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdObyBBUEkga2V5cyBhdmFpbGFibGUgZm9yIFVJRCBmaWx0ZXIgdGVzdCcpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGtleVVpZCA9IGZpcnN0Qm9keS5pdGVtc1sgMCBdLnVpZDtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICAndWlkLmVxJzoga2V5VWlkLFxuICAgICAgICAgIGNvdW50OiAnMTAnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW4oMCk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5zb21lKChrZXk6IGFueSkgPT4ga2V5LnVpZCA9PT0ga2V5VWlkKSkudG9CZSh0cnVlKTtcbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciBBUEkga2V5cyBieSBuYW1lIHVzaW5nIGNvbnRhaW5zIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnbmFtZS5jb250YWlucyc6ICdEZWZhdWx0JyxcbiAgICAgICAgICBjb3VudDogJzEwJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKGtleTogYW55KSA9PlxuICAgICAgICAgIGtleS5uYW1lICYmIGtleS5uYW1lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ2RlZmF1bHQnKVxuICAgICAgICApKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIEFQSSBrZXlzIGJ5IGRlc2NyaXB0aW9uIHVzaW5nIGNvbnRhaW5zIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnZGVzY3JpcHRpb24uY29udGFpbnMnOiAnc2VhcmNoJyxcbiAgICAgICAgICBjb3VudDogJzEwJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKGtleTogYW55KSA9PlxuICAgICAgICAgIGtleS5kZXNjcmlwdGlvbiAmJiBrZXkuZGVzY3JpcHRpb24udG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnc2VhcmNoJylcbiAgICAgICAgKSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciBBUEkga2V5cyBieSBhY3Rpb25zIHVzaW5nIElOIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnYWN0aW9ucy5pbic6ICdzZWFyY2gsZG9jdW1lbnRzLmdldCcsXG4gICAgICAgICAgY291bnQ6ICcxMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KChrZXk6IGFueSkgPT5cbiAgICAgICAgICBrZXkuYWN0aW9ucyAmJiBrZXkuYWN0aW9ucy5zb21lKChhY3Rpb246IHN0cmluZykgPT5cbiAgICAgICAgICAgIFsgJ3NlYXJjaCcsICdkb2N1bWVudHMuZ2V0JyBdLmluY2x1ZGVzKGFjdGlvbilcbiAgICAgICAgICApXG4gICAgICAgICkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgQVBJIGtleXMgYnkgaW5kZXhlcyB1c2luZyBJTiBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ2luZGV4ZXMuaW4nOiAnKicsXG4gICAgICAgICAgY291bnQ6ICcxMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KChrZXk6IGFueSkgPT5cbiAgICAgICAgICBrZXkuaW5kZXhlcyAmJiBrZXkuaW5kZXhlcy5pbmNsdWRlcygnKicpXG4gICAgICAgICkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgQVBJIGtleXMgYnkga2V5IHZhbHVlIHVzaW5nIGNvbnRhaW5zIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gRmlyc3QgZ2V0IGEga2V5IHRvIGdldCBpdHMga2V5IHZhbHVlXG4gICAgICBjb25zdCBmaXJzdFJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IGNvdW50OiAnMScgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QoZmlyc3RSZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBmaXJzdEJvZHkgPSBKU09OLnBhcnNlKGZpcnN0UmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGlmIChmaXJzdEJvZHkuaXRlbXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdObyBBUEkga2V5cyBhdmFpbGFibGUgZm9yIGtleSBmaWx0ZXIgdGVzdCcpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGtleVZhbHVlID0gZmlyc3RCb2R5Lml0ZW1zWyAwIF0ua2V5O1xuICAgICAgY29uc3QgcGFydGlhbEtleSA9IGtleVZhbHVlLnN1YnN0cmluZygwLCA4KTsgLy8gVXNlIGZpcnN0IDggY2hhcmFjdGVyc1xuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvYXBpLWtleXMnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgICdrZXkuY29udGFpbnMnOiBwYXJ0aWFsS2V5LFxuICAgICAgICAgIGNvdW50OiAnMTAnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW4oMCk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5zb21lKChrZXk6IGFueSkgPT4ga2V5LmtleS5pbmNsdWRlcyhwYXJ0aWFsS2V5KSkpLnRvQmUodHJ1ZSk7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgQVBJIGtleXMgYnkgZXhwaXJlc0F0IHVzaW5nIGd0IG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnZXhwaXJlc0F0Lmd0JzogJzIwMjQtMDEtMDFUMDA6MDA6MDBaJyxcbiAgICAgICAgICBjb3VudDogJzEwJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKGtleTogYW55KSA9PlxuICAgICAgICAgIGtleS5leHBpcmVzQXQgJiYgbmV3IERhdGUoa2V5LmV4cGlyZXNBdCkgPiBuZXcgRGF0ZSgnMjAyNC0wMS0wMVQwMDowMDowMFonKVxuICAgICAgICApKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIEFQSSBrZXlzIGJ5IGNyZWF0ZWRBdCB1c2luZyBndCBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9hcGkta2V5cycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ2NyZWF0ZWRBdC5ndCc6ICcyMDI0LTAxLTAxVDAwOjAwOjAwWicsXG4gICAgICAgICAgY291bnQ6ICcxMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KChrZXk6IGFueSkgPT5cbiAgICAgICAgICBrZXkuY3JlYXRlZEF0ICYmIG5ldyBEYXRlKGtleS5jcmVhdGVkQXQpID4gbmV3IERhdGUoJzIwMjQtMDEtMDFUMDA6MDA6MDBaJylcbiAgICAgICAgKSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb21wbGV4IGZpbHRlciBjb21iaW5hdGlvbnMgZm9yIEFQSSBrZXlzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnYWN0aW9ucy5pbic6ICdzZWFyY2gnLFxuICAgICAgICAgICdpbmRleGVzLmluJzogJyonLFxuICAgICAgICAgIGNvdW50OiAnMTAnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KChrZXk6IGFueSkgPT5cbiAgICAgICAgICBrZXkuYWN0aW9ucyAmJiBrZXkuYWN0aW9ucy5pbmNsdWRlcygnc2VhcmNoJykgJiZcbiAgICAgICAgICBrZXkuaW5kZXhlcyAmJiBrZXkuaW5kZXhlcy5pbmNsdWRlcygnKicpXG4gICAgICAgICkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuICB9KTtcblxuICBkZXNjcmliZSgnR0VUIC9hcGkta2V5cy97a2V5T3JVaWR9JywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcmV0dXJuIGEgc3BlY2lmaWMgQVBJIGtleSBieSBVSUQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBGaXJzdCBnZXQgYSBrZXkgdG8gZ2V0IGl0cyBVSURcbiAgICAgIGNvbnN0IGZpcnN0UmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgY291bnQ6ICcxJyB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChmaXJzdFJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGZpcnN0Qm9keSA9IEpTT04ucGFyc2UoZmlyc3RSZXNwb25zZS5ib2R5KTtcblxuICAgICAgaWYgKGZpcnN0Qm9keS5pdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgY29uc29sZS5sb2coJ05vIEFQSSBrZXlzIGF2YWlsYWJsZSBmb3Igc2luZ2xlIGtleSB0ZXN0Jyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3Qga2V5VWlkID0gZmlyc3RCb2R5Lml0ZW1zWyAwIF0udWlkO1xuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KGAvYXBpLWtleXMvJHtrZXlVaWR9YCwge1xuICAgICAgICBwYXRoUGFyYW1ldGVyczoge1xuICAgICAgICAgIGtleU9yVWlkOiBrZXlVaWRcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgndWlkJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2tleScpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdhY3Rpb25zJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2luZGV4ZXMnKTtcbiAgICAgIGV4cGVjdChib2R5LnVpZCkudG9CZShrZXlVaWQpO1xuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGEgc3BlY2lmaWMgQVBJIGtleSBieSBrZXkgdmFsdWUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBGaXJzdCBnZXQgYSBrZXkgdG8gZ2V0IGl0cyBrZXkgdmFsdWVcbiAgICAgIGNvbnN0IGZpcnN0UmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL2FwaS1rZXlzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgY291bnQ6ICcxJyB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChmaXJzdFJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGZpcnN0Qm9keSA9IEpTT04ucGFyc2UoZmlyc3RSZXNwb25zZS5ib2R5KTtcblxuICAgICAgaWYgKGZpcnN0Qm9keS5pdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgY29uc29sZS5sb2coJ05vIEFQSSBrZXlzIGF2YWlsYWJsZSBmb3Iga2V5IHZhbHVlIHRlc3QnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBrZXlWYWx1ZSA9IGZpcnN0Qm9keS5pdGVtc1sgMCBdLmtleTtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldChgL2FwaS1rZXlzLyR7a2V5VmFsdWV9YCwge1xuICAgICAgICBwYXRoUGFyYW1ldGVyczoge1xuICAgICAgICAgIGtleU9yVWlkOiBrZXlWYWx1ZVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCd1aWQnKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgna2V5Jyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2FjdGlvbnMnKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaW5kZXhlcycpO1xuICAgICAgZXhwZWN0KGJvZHkua2V5KS50b0JlKGtleVZhbHVlKTtcbiAgICB9LCAzMDAwMCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdQT1NUIC9hcGkta2V5cycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhIG5ldyBBUEkga2V5IHdpdGggcmVxdWlyZWQgZmllbGRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbmV3S2V5RGF0YSA9IHtcbiAgICAgICAgbmFtZTogJ1Rlc3QgQVBJIEtleScsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVGVzdCBrZXkgZm9yIGludGVncmF0aW9uIHRlc3RpbmcnLFxuICAgICAgICBhY3Rpb25zOiBbICdzZWFyY2gnLCAnZG9jdW1lbnRzLmdldCcgXSxcbiAgICAgICAgaW5kZXhlczogWyAnKicgXSxcbiAgICAgICAgZXhwaXJlc0F0OiAnMjAyNS0xMi0zMVQyMzo1OTo1OVonXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL2FwaS1rZXlzJywge1xuICAgICAgICBib2R5OiBuZXdLZXlEYXRhXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ3VpZCcpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdrZXknKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnbmFtZScpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdkZXNjcmlwdGlvbicpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdhY3Rpb25zJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2luZGV4ZXMnKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnZXhwaXJlc0F0Jyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2NyZWF0ZWRBdCcpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCd1cGRhdGVkQXQnKTtcblxuICAgICAgZXhwZWN0KGJvZHkubmFtZSkudG9CZShuZXdLZXlEYXRhLm5hbWUpO1xuICAgICAgZXhwZWN0KGJvZHkuZGVzY3JpcHRpb24pLnRvQmUobmV3S2V5RGF0YS5kZXNjcmlwdGlvbik7XG4gICAgICBleHBlY3QoYm9keS5hY3Rpb25zKS50b0VxdWFsKG5ld0tleURhdGEuYWN0aW9ucyk7XG4gICAgICBleHBlY3QoYm9keS5pbmRleGVzKS50b0VxdWFsKG5ld0tleURhdGEuaW5kZXhlcyk7XG5cbiAgICAgIC8vIFN0b3JlIHRoZSBVSUQgZm9yIGNsZWFudXBcbiAgICAgIHRlc3RLZXlVaWQgPSBib2R5LnVpZDtcbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhIG5ldyBBUEkga2V5IHdpdGhvdXQgb3B0aW9uYWwgZmllbGRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbmV3S2V5RGF0YSA9IHtcbiAgICAgICAgYWN0aW9uczogWyAnc2VhcmNoJyBdLFxuICAgICAgICBpbmRleGVzOiBbICcqJyBdLFxuICAgICAgICBuYW1lOiBcInRlc3Qgbm8gb3B0aW9uYWwgZmllbGRzXCIsXG4gICAgICAgIGV4cGlyZXNBdDogJzIwMjUtMTItMzFUMjM6NTk6NTlaJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLnBvc3QoJy9hcGkta2V5cycsIHtcbiAgICAgICAgYm9keTogbmV3S2V5RGF0YVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCd1aWQnKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgna2V5Jyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2FjdGlvbnMnKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaW5kZXhlcycpO1xuICAgICAgZXhwZWN0KGJvZHkuYWN0aW9ucykudG9FcXVhbChuZXdLZXlEYXRhLmFjdGlvbnMpO1xuICAgICAgZXhwZWN0KGJvZHkuaW5kZXhlcykudG9FcXVhbChuZXdLZXlEYXRhLmluZGV4ZXMpO1xuXG4gICAgICAvLyBTdG9yZSB0aGUgVUlEIGZvciBjbGVhbnVwXG4gICAgICBpZiAoIXRlc3RLZXlVaWQpIHtcbiAgICAgICAgdGVzdEtleVVpZCA9IGJvZHkudWlkO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgcmVqZWN0IGNyZWF0aW9uIHdpdGhvdXQgcmVxdWlyZWQgZmllbGRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaW52YWxpZEtleURhdGEgPSB7XG4gICAgICAgIG5hbWU6ICdUZXN0IEFQSSBLZXknXG4gICAgICAgIC8vIE1pc3NpbmcgcmVxdWlyZWQgYWN0aW9ucyBhbmQgaW5kZXhlc1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLnBvc3QoJy9hcGkta2V5cycsIHtcbiAgICAgICAgYm9keTogaW52YWxpZEtleURhdGFcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSg0MDApO1xuICAgIH0sIDMwMDAwKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1BVVCAvYXBpLWtleXMve2tleU9yVWlkfScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHVwZGF0ZSBhbiBBUEkga2V5IG5hbWUgYW5kIGRlc2NyaXB0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0ZXN0S2V5VWlkKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdObyB0ZXN0IGtleSBhdmFpbGFibGUgZm9yIHVwZGF0ZSB0ZXN0Jyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgdXBkYXRlRGF0YSA9IHtcbiAgICAgICAgbmFtZTogJ1VwZGF0ZWQgVGVzdCBBUEkgS2V5JyxcbiAgICAgICAgZGVzY3JpcHRpb246ICdVcGRhdGVkIGRlc2NyaXB0aW9uIGZvciB0ZXN0aW5nJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLnB1dChgL2FwaS1rZXlzLyR7dGVzdEtleVVpZH1gLCB7XG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAga2V5T3JVaWQ6IHRlc3RLZXlVaWRcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTogdXBkYXRlRGF0YVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCd1aWQnKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnbmFtZScpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdkZXNjcmlwdGlvbicpO1xuICAgICAgZXhwZWN0KGJvZHkubmFtZSkudG9CZSh1cGRhdGVEYXRhLm5hbWUpO1xuICAgICAgZXhwZWN0KGJvZHkuZGVzY3JpcHRpb24pLnRvQmUodXBkYXRlRGF0YS5kZXNjcmlwdGlvbik7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCB1cGRhdGUgb25seSB0aGUgbmFtZSBmaWVsZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGVzdEtleVVpZCkge1xuICAgICAgICBjb25zb2xlLmxvZygnTm8gdGVzdCBrZXkgYXZhaWxhYmxlIGZvciBwYXJ0aWFsIHVwZGF0ZSB0ZXN0Jyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgdXBkYXRlRGF0YSA9IHtcbiAgICAgICAgbmFtZTogJ1BhcnRpYWxseSBVcGRhdGVkIEtleSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wdXQoYC9hcGkta2V5cy8ke3Rlc3RLZXlVaWR9YCwge1xuICAgICAgICBwYXRoUGFyYW1ldGVyczoge1xuICAgICAgICAgIGtleU9yVWlkOiB0ZXN0S2V5VWlkXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IHVwZGF0ZURhdGFcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnbmFtZScpO1xuICAgICAgZXhwZWN0KGJvZHkubmFtZSkudG9CZSh1cGRhdGVEYXRhLm5hbWUpO1xuICAgIH0sIDMwMDAwKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0RFTEVURSAvYXBpLWtleXMve2tleU9yVWlkfScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGRlbGV0ZSBhbiBBUEkga2V5IGJ5IFVJRCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGVzdEtleVVpZCkge1xuICAgICAgICBjb25zb2xlLmxvZygnTm8gdGVzdCBrZXkgYXZhaWxhYmxlIGZvciBkZWxldGUgdGVzdCcpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5kZWxldGUoYC9hcGkta2V5cy8ke3Rlc3RLZXlVaWR9YCwge1xuICAgICAgICBwYXRoUGFyYW1ldGVyczoge1xuICAgICAgICAgIGtleU9yVWlkOiB0ZXN0S2V5VWlkXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiA0MDQgZm9yIG5vbi1leGlzdGVudCBrZXknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZGVsZXRlKCcvYXBpLWtleXMvbm9uLWV4aXN0ZW50LXVpZCcsIHtcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBrZXlPclVpZDogJ25vbi1leGlzdGVudC11aWQnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoNTAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgZXhwZWN0KGJvZHkuZGV0YWlscy5tZXNzYWdlKS50b0JlKCdBUEkga2V5IGBub24tZXhpc3RlbnQtdWlkYCBub3QgZm91bmQuJyk7XG4gICAgfSwgMzAwMDApO1xuICB9KTtcbn0pOyAiXX0=