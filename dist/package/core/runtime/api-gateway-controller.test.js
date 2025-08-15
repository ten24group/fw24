"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_gateway_controller_1 = require("./api-gateway-controller");
// Create a test controller class
class TestController extends api_gateway_controller_1.APIController {
    controllerName = 'test';
    routes = {};
    constructor(routes) {
        super();
        this.routes = routes;
    }
    // Expose private methods for testing
    testFindMatchingRoute(requestData) {
        return this.findMatchingRoute(requestData);
    }
    testGetRouteFunction(route) {
        return this.getRouteFunction(route);
    }
    testExecuteMiddlewarePipeline(phase, request, response, ctx, error) {
        return this.executeMiddlewarePipeline(phase, request, response, ctx, error);
    }
    testHandleResponse(res) {
        return this.handleResponse(res);
    }
    testHandleException(req, err, res) {
        return this.handleException(req, err, res);
    }
    testBuildCtx(event, context, request, response) {
        return this.buildCtx(event, context, request, response);
    }
    // Expose middleware registration for testing
    testUseMiddleware(middleware) {
        this.useMiddleware(middleware);
    }
    // Expose protected methods for testing
    testHandleNotFound(req) {
        return this.handleNotFound(req);
    }
    // Test handler methods
    testHandler() {
        return { message: 'test handler called' };
    }
    async testAsyncHandler() {
        return { message: 'async test handler called' };
    }
    testHandlerWithError() {
        throw new Error('Test handler error');
    }
    // Required abstract method
    async initialize(_event, _context) {
        // No-op for testing
    }
}
// Helper function to create mock Request objects
function createMockRequest(overrides = {}) {
    const mockEvent = {};
    const mockContext = {};
    return {
        event: mockEvent,
        requestId: 'test-request-id',
        context: mockContext,
        resource: '/test',
        body: {},
        path: '/test',
        queryStringParameters: {},
        headers: {},
        requestContext: {},
        stageVariables: {},
        pathParameters: {},
        isBase64Encoded: false,
        httpMethod: 'GET',
        debugMode: false,
        getParam: jest.fn(),
        hasParam: jest.fn(),
        getHeader: jest.fn(),
        hasHeader: jest.fn(),
        getPathParam: jest.fn(),
        hasPathParam: jest.fn(),
        getQueryParam: jest.fn(),
        hasQueryParam: jest.fn(),
        getBodyParam: jest.fn(),
        hasBodyParam: jest.fn(),
        ...overrides,
    };
}
describe('APIGatewayController Route Matching', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    describe('findMatchingRoute - Core Functionality', () => {
        it('should handle comprehensive route matching scenarios', () => {
            const routes = {
                // Exact routes
                'GET|/': { handler: 'index' },
                'GET|/users': { handler: 'listUsers' },
                'POST|/users': { handler: 'createUser' },
                // Single parameter
                'GET|/{id}': { handler: 'getById' },
                'DELETE|/{id}': { handler: 'deleteById' },
                // Multiple parameters  
                'GET|/{abc}/{def}/{xyz}': { handler: 'getTripleParams' },
                'GET|/users/{userId}/posts/{postId}': { handler: 'getUserPost' },
                // Mixed static/dynamic
                'GET|/teams/{teamId}/categories/{categoryId}/posts/{postId}': { handler: 'getTeamCategoryPost' },
                // Prioritization test routes
                'GET|/{resource}': { handler: 'getResource' },
                'GET|/{category}/{action}': { handler: 'getCategoryAction' },
                'GET|/users/{userId}': { handler: 'getUserById' },
            };
            const controller = new TestController(routes);
            // Test exact route matching
            let request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/',
                pathParameters: {},
            });
            expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'index' });
            // Test single parameter
            request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/123',
                pathParameters: { id: '123' },
            });
            expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'getById' });
            // Test multiple parameters
            request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/val1/val2/val3',
                pathParameters: { abc: 'val1', def: 'val2', xyz: 'val3' },
            });
            expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'getTripleParams' });
            // Test complex nested route
            request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/teams/team-1/categories/news/posts/post-123',
                pathParameters: { teamId: 'team-1', categoryId: 'news', postId: 'post-123' },
            });
            expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'getTeamCategoryPost' });
            // Test exact match priority over parameterized
            request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/users',
                pathParameters: {},
            });
            expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'listUsers' });
            // Test specific parameterized route priority over general
            request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/users/123',
                pathParameters: { userId: '123' },
            });
            expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'getUserById' });
        });
        it('should handle negative cases correctly', () => {
            const routes = {
                'GET|/{abc}/{def}/{xyz}': { handler: 'getTripleParams' },
                'POST|/{id}': { handler: 'updateById' },
            };
            const controller = new TestController(routes);
            // Wrong number of segments
            let request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/value1/value2', // Too few
                pathParameters: { abc: 'value1', def: 'value2' },
            });
            expect(controller.testFindMatchingRoute(request)).toBeNull();
            request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/value1/value2/value3/extra', // Too many
                pathParameters: { abc: 'value1', def: 'value2', xyz: 'value3' },
            });
            expect(controller.testFindMatchingRoute(request)).toBeNull();
            // Wrong HTTP method
            request = createMockRequest({
                httpMethod: 'DELETE', // Should be POST
                resource: '/test/123',
                pathParameters: { id: '123' },
            });
            expect(controller.testFindMatchingRoute(request)).toBeNull();
            // No matching route
            request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/nonexistent/route',
                pathParameters: {},
            });
            expect(controller.testFindMatchingRoute(request)).toBeNull();
        });
        it('should handle controller names with slashes', () => {
            const routes = {
                'GET|/indices': { handler: 'getIndices' },
                'POST|/reindex/{entity}': { handler: 'reindexEntity' },
            };
            const controller = new TestController(routes);
            controller.controllerName = 'system/search';
            const request = createMockRequest({
                httpMethod: 'GET',
                resource: '/system/search/indices',
                pathParameters: {},
            });
            expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'getIndices' });
        });
    });
    describe('findMatchingRoute - Edge Cases & Robustness', () => {
        it('should handle edge cases and parameter variations', () => {
            const routes = {
                'GET|/{id}': { handler: 'getById' },
                'GET|/{a}/{b}/{c}/{d}/{e}': { handler: 'getFiveParams' },
                'POST|/{country}/{state}/{city}/{district}/{street}/{building}': { handler: 'getSixParams' },
                'PUT|/{id}': { handler: 'updateById' },
                'DELETE|/{id}': { handler: 'deleteById' },
            };
            const controller = new TestController(routes);
            // Empty routes object
            const emptyController = new TestController({});
            let request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/anything',
                pathParameters: {},
            });
            expect(emptyController.testFindMatchingRoute(request)).toBeNull();
            // Special characters in parameters
            const specialCharCases = ['abc-123', 'user_456', '999', 'special%20chars'];
            specialCharCases.forEach(id => {
                request = createMockRequest({
                    httpMethod: 'GET',
                    resource: `/test/${id}`,
                    pathParameters: { id },
                });
                expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'getById' });
            });
            // Very long parameter
            const longId = 'a'.repeat(1000);
            request = createMockRequest({
                httpMethod: 'GET',
                resource: `/test/${longId}`,
                pathParameters: { id: longId },
            });
            expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'getById' });
            // Multiple HTTP methods
            const httpMethods = ['GET', 'PUT', 'DELETE'];
            const expectedHandlers = ['getById', 'updateById', 'deleteById'];
            httpMethods.forEach((method, index) => {
                request = createMockRequest({
                    httpMethod: method,
                    resource: '/test/123',
                    pathParameters: { id: '123' },
                });
                expect(controller.testFindMatchingRoute(request)).toEqual({ handler: expectedHandlers[index] });
            });
            // Routes with many parameters
            request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/1/2/3/4/5',
                pathParameters: { a: '1', b: '2', c: '3', d: '4', e: '5' },
            });
            expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'getFiveParams' });
            request = createMockRequest({
                httpMethod: 'POST',
                resource: '/test/US/CA/SF/Downtown/Main/123',
                pathParameters: {
                    country: 'US', state: 'CA', city: 'SF',
                    district: 'Downtown', street: 'Main', building: '123'
                },
            });
            expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'getSixParams' });
        });
    });
    describe('findMatchingRoute - Advanced Scenarios', () => {
        it('should handle complex controller names and REST patterns', () => {
            // Test nested controller names
            const nestedRoutes = {
                'GET|/status': { handler: 'getStatus' },
                'POST|/actions/{actionId}': { handler: 'executeAction' },
            };
            const nestedController = new TestController(nestedRoutes);
            nestedController.controllerName = 'admin/system/monitoring/health';
            let request = createMockRequest({
                httpMethod: 'GET',
                resource: '/admin/system/monitoring/health/status',
                pathParameters: {},
            });
            expect(nestedController.testFindMatchingRoute(request)).toEqual({ handler: 'getStatus' });
            // Test controller names with special characters
            const specialController = new TestController({ 'GET|/test': { handler: 'test' } });
            specialController.controllerName = 'api-v1.2/user-management';
            request = createMockRequest({
                httpMethod: 'GET',
                resource: '/api-v1.2/user-management/test',
                pathParameters: {},
            });
            expect(specialController.testFindMatchingRoute(request)).toEqual({ handler: 'test' });
            // Test comprehensive REST API patterns
            const restRoutes = {
                'GET|/': { handler: 'list' },
                'POST|/': { handler: 'create' },
                'GET|/{id}': { handler: 'get' },
                'PUT|/{id}': { handler: 'update' },
                'DELETE|/{id}': { handler: 'delete' },
                'GET|/{id}/relationships': { handler: 'getRelationships' },
                'POST|/{id}/relationships/{relationshipType}': { handler: 'addRelationship' },
                'GET|/teams/{teamId}/projects/{projectId}/tasks/{taskId}': { handler: 'getProjectTask' },
            };
            const restController = new TestController(restRoutes);
            const testCases = [
                { method: 'GET', path: '/test/', params: {}, expected: 'list' },
                { method: 'POST', path: '/test/', params: {}, expected: 'create' },
                { method: 'GET', path: '/test/123', params: { id: '123' }, expected: 'get' },
                { method: 'PUT', path: '/test/123', params: { id: '123' }, expected: 'update' },
                { method: 'DELETE', path: '/test/123', params: { id: '123' }, expected: 'delete' },
                { method: 'GET', path: '/test/123/relationships', params: { id: '123' }, expected: 'getRelationships' },
                { method: 'POST', path: '/test/123/relationships/friends', params: { id: '123', relationshipType: 'friends' }, expected: 'addRelationship' },
                { method: 'GET', path: '/test/teams/t1/projects/p2/tasks/task3', params: { teamId: 't1', projectId: 'p2', taskId: 'task3' }, expected: 'getProjectTask' },
            ];
            testCases.forEach(({ method, path, params, expected }) => {
                request = createMockRequest({
                    httpMethod: method,
                    resource: path,
                    pathParameters: params,
                });
                expect(restController.testFindMatchingRoute(request)).toEqual({ handler: expected });
            });
        });
    });
    describe('findMatchingRoute - Error Resilience', () => {
        it('should handle error conditions gracefully', () => {
            // Test malformed route keys
            const malformedRoutes = {
                'GET|/valid': { handler: 'valid' },
                'INVALID_ROUTE': { handler: 'invalid' }, // Missing pipe separator
                'POST|': { handler: 'empty' }, // Empty path
                '|/no-method': { handler: 'noMethod' }, // Missing method
            };
            const controller = new TestController(malformedRoutes);
            // Valid route should still work despite malformed ones
            let request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/valid',
                pathParameters: {},
            });
            expect(controller.testFindMatchingRoute(request)).toEqual({ handler: 'valid' });
            // Test empty controller name
            const emptyNameController = new TestController({});
            emptyNameController.controllerName = '';
            request = createMockRequest({
                httpMethod: 'GET',
                resource: '/anything',
                pathParameters: {},
            });
            expect(() => emptyNameController.testFindMatchingRoute(request)).not.toThrow();
            expect(emptyNameController.testFindMatchingRoute(request)).toBeNull();
            // Test routes with additional metadata
            const metadataRoutes = {
                'GET|/users': {
                    handler: 'getUsers',
                    middleware: ['auth', 'logging'],
                    cache: true,
                    timeout: 30000
                },
                'POST|/{id}': {
                    handler: 'updateUser',
                    validations: { body: { required: true } },
                    rateLimit: 100
                },
            };
            const metadataController = new TestController(metadataRoutes);
            request = createMockRequest({
                httpMethod: 'GET',
                resource: '/test/users',
                pathParameters: {},
            });
            expect(metadataController.testFindMatchingRoute(request)).toEqual({
                handler: 'getUsers',
                middleware: ['auth', 'logging'],
                cache: true,
                timeout: 30000
            });
            request = createMockRequest({
                httpMethod: 'POST',
                resource: '/test/123',
                pathParameters: { id: '123' },
            });
            expect(metadataController.testFindMatchingRoute(request)).toEqual({
                handler: 'updateUser',
                validations: { body: { required: true } },
                rateLimit: 100
            });
        });
    });
});
describe('APIGatewayController Core Functionality', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    describe('route function resolution', () => {
        it('should return handler function for valid routes, 404 handler otherwise', () => {
            const controller = new TestController({});
            // Valid route
            const validRoute = { functionName: 'testHandler' };
            const validFunction = controller.testGetRouteFunction(validRoute);
            expect(validFunction.call(controller)).toEqual({ message: 'test handler called' });
            // Invalid routes all return 404
            [null, { functionName: 'nonExistent' }, { functionName: 'notAFunction' }].forEach(route => {
                const result = controller.testGetRouteFunction(route).call(controller, createMockRequest());
                expect(result.statusCode).toBe(404);
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9hcGktZ2F0ZXdheS1jb250cm9sbGVyLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxRUFBeUQ7QUFJekQsaUNBQWlDO0FBQ2pDLE1BQU0sY0FBZSxTQUFRLHNDQUFhO0lBQ2pDLGNBQWMsR0FBRyxNQUFNLENBQUM7SUFDeEIsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUVuQixZQUFZLE1BQTJCO1FBQ3JDLEtBQUssRUFBRSxDQUFDO1FBQ1IsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7SUFDdkIsQ0FBQztJQUVELHFDQUFxQztJQUM5QixxQkFBcUIsQ0FBQyxXQUFvQjtRQUMvQyxPQUFRLElBQVksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRU0sb0JBQW9CLENBQUMsS0FBVTtRQUNwQyxPQUFRLElBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUMvQyxDQUFDO0lBRU0sNkJBQTZCLENBQUMsS0FBYSxFQUFFLE9BQWdCLEVBQUUsUUFBYSxFQUFFLEdBQVMsRUFBRSxLQUFhO1FBQzNHLE9BQVEsSUFBWSxDQUFDLHlCQUF5QixDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUN2RixDQUFDO0lBRU0sa0JBQWtCLENBQUMsR0FBUTtRQUNoQyxPQUFRLElBQVksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDM0MsQ0FBQztJQUVNLG1CQUFtQixDQUFDLEdBQVksRUFBRSxHQUFVLEVBQUUsR0FBUTtRQUMzRCxPQUFRLElBQVksQ0FBQyxlQUFlLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRU0sWUFB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YXktY29udHJvbGxlcic7XG5pbXBvcnQgdHlwZSB7IFJlcXVlc3QgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzJztcbmltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheUV2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5cbi8vIENyZWF0ZSBhIHRlc3QgY29udHJvbGxlciBjbGFzc1xuY2xhc3MgVGVzdENvbnRyb2xsZXIgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgcHVibGljIGNvbnRyb2xsZXJOYW1lID0gJ3Rlc3QnO1xuICBwdWJsaWMgcm91dGVzID0ge307XG5cbiAgY29uc3RydWN0b3Iocm91dGVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJvdXRlcyA9IHJvdXRlcztcbiAgfVxuXG4gIC8vIEV4cG9zZSBwcml2YXRlIG1ldGhvZHMgZm9yIHRlc3RpbmdcbiAgcHVibGljIHRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0RGF0YTogUmVxdWVzdCkge1xuICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3REYXRhKTtcbiAgfVxuXG4gIHB1YmxpYyB0ZXN0R2V0Um91dGVGdW5jdGlvbihyb3V0ZTogYW55KSB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuZ2V0Um91dGVGdW5jdGlvbihyb3V0ZSk7XG4gIH1cblxuICBwdWJsaWMgdGVzdEV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUocGhhc2U6IHN0cmluZywgcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IGFueSwgY3R4PzogYW55LCBlcnJvcj86IEVycm9yKSB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZShwaGFzZSwgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCwgZXJyb3IpO1xuICB9XG5cbiAgcHVibGljIHRlc3RIYW5kbGVSZXNwb25zZShyZXM6IGFueSkge1xuICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmhhbmRsZVJlc3BvbnNlKHJlcyk7XG4gIH1cblxuICBwdWJsaWMgdGVzdEhhbmRsZUV4Y2VwdGlvbihyZXE6IFJlcXVlc3QsIGVycjogRXJyb3IsIHJlczogYW55KSB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuaGFuZGxlRXhjZXB0aW9uKHJlcSwgZXJyLCByZXMpO1xuICB9XG5cbiAgcHVibGljIHRlc3RCdWlsZEN0eChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0LCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogYW55KSB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuYnVpbGRDdHgoZXZlbnQsIGNvbnRleHQsIHJlcXVlc3QsIHJlc3BvbnNlKTtcbiAgfVxuXG4gIC8vIEV4cG9zZSBtaWRkbGV3YXJlIHJlZ2lzdHJhdGlvbiBmb3IgdGVzdGluZ1xuICBwdWJsaWMgdGVzdFVzZU1pZGRsZXdhcmUobWlkZGxld2FyZTogYW55KSB7XG4gICAgdGhpcy51c2VNaWRkbGV3YXJlKG1pZGRsZXdhcmUpO1xuICB9XG5cbiAgLy8gRXhwb3NlIHByb3RlY3RlZCBtZXRob2RzIGZvciB0ZXN0aW5nXG4gIHB1YmxpYyB0ZXN0SGFuZGxlTm90Rm91bmQocmVxOiBSZXF1ZXN0KSB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlTm90Rm91bmQocmVxKTtcbiAgfVxuXG4gIC8vIFRlc3QgaGFuZGxlciBtZXRob2RzXG4gIHB1YmxpYyB0ZXN0SGFuZGxlcigpIHtcbiAgICByZXR1cm4geyBtZXNzYWdlOiAndGVzdCBoYW5kbGVyIGNhbGxlZCcgfTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyB0ZXN0QXN5bmNIYW5kbGVyKCkge1xuICAgIHJldHVybiB7IG1lc3NhZ2U6ICdhc3luYyB0ZXN0IGhhbmRsZXIgY2FsbGVkJyB9O1xuICB9XG5cbiAgcHVibGljIHRlc3RIYW5kbGVyV2l0aEVycm9yKCkge1xuICAgIHRocm93IG5ldyBFcnJvcignVGVzdCBoYW5kbGVyIGVycm9yJyk7XG4gIH1cblxuICAvLyBSZXF1aXJlZCBhYnN0cmFjdCBtZXRob2RcbiAgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBOby1vcCBmb3IgdGVzdGluZ1xuICB9XG59XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byBjcmVhdGUgbW9jayBSZXF1ZXN0IG9iamVjdHNcbmZ1bmN0aW9uIGNyZWF0ZU1vY2tSZXF1ZXN0KG92ZXJyaWRlczogUGFydGlhbDxSZXF1ZXN0PiA9IHt9KTogUmVxdWVzdCB7XG4gIGNvbnN0IG1vY2tFdmVudCA9IHt9IGFzIEFQSUdhdGV3YXlFdmVudDtcbiAgY29uc3QgbW9ja0NvbnRleHQgPSB7fSBhcyBDb250ZXh0O1xuXG4gIHJldHVybiB7XG4gICAgZXZlbnQ6IG1vY2tFdmVudCxcbiAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxuICAgIGNvbnRleHQ6IG1vY2tDb250ZXh0LFxuICAgIHJlc291cmNlOiAnL3Rlc3QnLFxuICAgIGJvZHk6IHt9LFxuICAgIHBhdGg6ICcvdGVzdCcsXG4gICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7fSxcbiAgICBoZWFkZXJzOiB7fSxcbiAgICByZXF1ZXN0Q29udGV4dDoge30sXG4gICAgc3RhZ2VWYXJpYWJsZXM6IHt9LFxuICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxuICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgIGRlYnVnTW9kZTogZmFsc2UsXG4gICAgZ2V0UGFyYW06IGplc3QuZm4oKSxcbiAgICBoYXNQYXJhbTogamVzdC5mbigpLFxuICAgIGdldEhlYWRlcjogamVzdC5mbigpLFxuICAgIGhhc0hlYWRlcjogamVzdC5mbigpLFxuICAgIGdldFBhdGhQYXJhbTogamVzdC5mbigpLFxuICAgIGhhc1BhdGhQYXJhbTogamVzdC5mbigpLFxuICAgIGdldFF1ZXJ5UGFyYW06IGplc3QuZm4oKSxcbiAgICBoYXNRdWVyeVBhcmFtOiBqZXN0LmZuKCksXG4gICAgZ2V0Qm9keVBhcmFtOiBqZXN0LmZuKCksXG4gICAgaGFzQm9keVBhcmFtOiBqZXN0LmZuKCksXG4gICAgLi4ub3ZlcnJpZGVzLFxuICB9O1xufVxuXG5kZXNjcmliZSgnQVBJR2F0ZXdheUNvbnRyb2xsZXIgUm91dGUgTWF0Y2hpbmcnLCAoKSA9PiB7XG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xuICB9KTtcblxuICBkZXNjcmliZSgnZmluZE1hdGNoaW5nUm91dGUgLSBDb3JlIEZ1bmN0aW9uYWxpdHknLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29tcHJlaGVuc2l2ZSByb3V0ZSBtYXRjaGluZyBzY2VuYXJpb3MnLCAoKSA9PiB7XG4gICAgICBjb25zdCByb3V0ZXMgPSB7XG4gICAgICAgIC8vIEV4YWN0IHJvdXRlc1xuICAgICAgICAnR0VUfC8nOiB7IGhhbmRsZXI6ICdpbmRleCcgfSxcbiAgICAgICAgJ0dFVHwvdXNlcnMnOiB7IGhhbmRsZXI6ICdsaXN0VXNlcnMnIH0sXG4gICAgICAgICdQT1NUfC91c2Vycyc6IHsgaGFuZGxlcjogJ2NyZWF0ZVVzZXInIH0sXG5cbiAgICAgICAgLy8gU2luZ2xlIHBhcmFtZXRlclxuICAgICAgICAnR0VUfC97aWR9JzogeyBoYW5kbGVyOiAnZ2V0QnlJZCcgfSxcbiAgICAgICAgJ0RFTEVURXwve2lkfSc6IHsgaGFuZGxlcjogJ2RlbGV0ZUJ5SWQnIH0sXG5cbiAgICAgICAgLy8gTXVsdGlwbGUgcGFyYW1ldGVycyAgXG4gICAgICAgICdHRVR8L3thYmN9L3tkZWZ9L3t4eXp9JzogeyBoYW5kbGVyOiAnZ2V0VHJpcGxlUGFyYW1zJyB9LFxuICAgICAgICAnR0VUfC91c2Vycy97dXNlcklkfS9wb3N0cy97cG9zdElkfSc6IHsgaGFuZGxlcjogJ2dldFVzZXJQb3N0JyB9LFxuXG4gICAgICAgIC8vIE1peGVkIHN0YXRpYy9keW5hbWljXG4gICAgICAgICdHRVR8L3RlYW1zL3t0ZWFtSWR9L2NhdGVnb3JpZXMve2NhdGVnb3J5SWR9L3Bvc3RzL3twb3N0SWR9JzogeyBoYW5kbGVyOiAnZ2V0VGVhbUNhdGVnb3J5UG9zdCcgfSxcblxuICAgICAgICAvLyBQcmlvcml0aXphdGlvbiB0ZXN0IHJvdXRlc1xuICAgICAgICAnR0VUfC97cmVzb3VyY2V9JzogeyBoYW5kbGVyOiAnZ2V0UmVzb3VyY2UnIH0sXG4gICAgICAgICdHRVR8L3tjYXRlZ29yeX0ve2FjdGlvbn0nOiB7IGhhbmRsZXI6ICdnZXRDYXRlZ29yeUFjdGlvbicgfSxcbiAgICAgICAgJ0dFVHwvdXNlcnMve3VzZXJJZH0nOiB7IGhhbmRsZXI6ICdnZXRVc2VyQnlJZCcgfSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIocm91dGVzKTtcblxuICAgICAgLy8gVGVzdCBleGFjdCByb3V0ZSBtYXRjaGluZ1xuICAgICAgbGV0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0LycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2luZGV4JyB9KTtcblxuICAgICAgLy8gVGVzdCBzaW5nbGUgcGFyYW1ldGVyXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC8xMjMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJzEyMycgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldEJ5SWQnIH0pO1xuXG4gICAgICAvLyBUZXN0IG11bHRpcGxlIHBhcmFtZXRlcnNcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L3ZhbDEvdmFsMi92YWwzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgYWJjOiAndmFsMScsIGRlZjogJ3ZhbDInLCB4eXo6ICd2YWwzJyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0VHJpcGxlUGFyYW1zJyB9KTtcblxuICAgICAgLy8gVGVzdCBjb21wbGV4IG5lc3RlZCByb3V0ZVxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdGVhbXMvdGVhbS0xL2NhdGVnb3JpZXMvbmV3cy9wb3N0cy9wb3N0LTEyMycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IHRlYW1JZDogJ3RlYW0tMScsIGNhdGVnb3J5SWQ6ICduZXdzJywgcG9zdElkOiAncG9zdC0xMjMnIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRUZWFtQ2F0ZWdvcnlQb3N0JyB9KTtcblxuICAgICAgLy8gVGVzdCBleGFjdCBtYXRjaCBwcmlvcml0eSBvdmVyIHBhcmFtZXRlcml6ZWRcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L3VzZXJzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnbGlzdFVzZXJzJyB9KTtcblxuICAgICAgLy8gVGVzdCBzcGVjaWZpYyBwYXJhbWV0ZXJpemVkIHJvdXRlIHByaW9yaXR5IG92ZXIgZ2VuZXJhbFxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdXNlcnMvMTIzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgdXNlcklkOiAnMTIzJyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0VXNlckJ5SWQnIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbmVnYXRpdmUgY2FzZXMgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm91dGVzID0ge1xuICAgICAgICAnR0VUfC97YWJjfS97ZGVmfS97eHl6fSc6IHsgaGFuZGxlcjogJ2dldFRyaXBsZVBhcmFtcycgfSxcbiAgICAgICAgJ1BPU1R8L3tpZH0nOiB7IGhhbmRsZXI6ICd1cGRhdGVCeUlkJyB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcihyb3V0ZXMpO1xuXG4gICAgICAvLyBXcm9uZyBudW1iZXIgb2Ygc2VnbWVudHNcbiAgICAgIGxldCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC92YWx1ZTEvdmFsdWUyJywgLy8gVG9vIGZld1xuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBhYmM6ICd2YWx1ZTEnLCBkZWY6ICd2YWx1ZTInIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9CZU51bGwoKTtcblxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdmFsdWUxL3ZhbHVlMi92YWx1ZTMvZXh0cmEnLCAvLyBUb28gbWFueVxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBhYmM6ICd2YWx1ZTEnLCBkZWY6ICd2YWx1ZTInLCB4eXo6ICd2YWx1ZTMnIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9CZU51bGwoKTtcblxuICAgICAgLy8gV3JvbmcgSFRUUCBtZXRob2RcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdERUxFVEUnLCAvLyBTaG91bGQgYmUgUE9TVFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0LzEyMycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGlkOiAnMTIzJyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvQmVOdWxsKCk7XG5cbiAgICAgIC8vIE5vIG1hdGNoaW5nIHJvdXRlXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC9ub25leGlzdGVudC9yb3V0ZScsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0JlTnVsbCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29udHJvbGxlciBuYW1lcyB3aXRoIHNsYXNoZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCByb3V0ZXMgPSB7XG4gICAgICAgICdHRVR8L2luZGljZXMnOiB7IGhhbmRsZXI6ICdnZXRJbmRpY2VzJyB9LFxuICAgICAgICAnUE9TVHwvcmVpbmRleC97ZW50aXR5fSc6IHsgaGFuZGxlcjogJ3JlaW5kZXhFbnRpdHknIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHJvdXRlcyk7XG4gICAgICBjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lID0gJ3N5c3RlbS9zZWFyY2gnO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvc3lzdGVtL3NlYXJjaC9pbmRpY2VzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRJbmRpY2VzJyB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2ZpbmRNYXRjaGluZ1JvdXRlIC0gRWRnZSBDYXNlcyAmIFJvYnVzdG5lc3MnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZWRnZSBjYXNlcyBhbmQgcGFyYW1ldGVyIHZhcmlhdGlvbnMnLCAoKSA9PiB7XG4gICAgICBjb25zdCByb3V0ZXMgPSB7XG4gICAgICAgICdHRVR8L3tpZH0nOiB7IGhhbmRsZXI6ICdnZXRCeUlkJyB9LFxuICAgICAgICAnR0VUfC97YX0ve2J9L3tjfS97ZH0ve2V9JzogeyBoYW5kbGVyOiAnZ2V0Rml2ZVBhcmFtcycgfSxcbiAgICAgICAgJ1BPU1R8L3tjb3VudHJ5fS97c3RhdGV9L3tjaXR5fS97ZGlzdHJpY3R9L3tzdHJlZXR9L3tidWlsZGluZ30nOiB7IGhhbmRsZXI6ICdnZXRTaXhQYXJhbXMnIH0sXG4gICAgICAgICdQVVR8L3tpZH0nOiB7IGhhbmRsZXI6ICd1cGRhdGVCeUlkJyB9LFxuICAgICAgICAnREVMRVRFfC97aWR9JzogeyBoYW5kbGVyOiAnZGVsZXRlQnlJZCcgfSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIocm91dGVzKTtcblxuICAgICAgLy8gRW1wdHkgcm91dGVzIG9iamVjdFxuICAgICAgY29uc3QgZW1wdHlDb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHt9KTtcbiAgICAgIGxldCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC9hbnl0aGluZycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGVtcHR5Q29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvQmVOdWxsKCk7XG5cbiAgICAgIC8vIFNwZWNpYWwgY2hhcmFjdGVycyBpbiBwYXJhbWV0ZXJzXG4gICAgICBjb25zdCBzcGVjaWFsQ2hhckNhc2VzID0gWyAnYWJjLTEyMycsICd1c2VyXzQ1NicsICc5OTknLCAnc3BlY2lhbCUyMGNoYXJzJyBdO1xuICAgICAgc3BlY2lhbENoYXJDYXNlcy5mb3JFYWNoKGlkID0+IHtcbiAgICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICByZXNvdXJjZTogYC90ZXN0LyR7aWR9YCxcbiAgICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZCB9LFxuICAgICAgICB9KTtcbiAgICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldEJ5SWQnIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFZlcnkgbG9uZyBwYXJhbWV0ZXJcbiAgICAgIGNvbnN0IGxvbmdJZCA9ICdhJy5yZXBlYXQoMTAwMCk7XG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6IGAvdGVzdC8ke2xvbmdJZH1gLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogbG9uZ0lkIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRCeUlkJyB9KTtcblxuICAgICAgLy8gTXVsdGlwbGUgSFRUUCBtZXRob2RzXG4gICAgICBjb25zdCBodHRwTWV0aG9kcyA9IFsgJ0dFVCcsICdQVVQnLCAnREVMRVRFJyBdO1xuICAgICAgY29uc3QgZXhwZWN0ZWRIYW5kbGVycyA9IFsgJ2dldEJ5SWQnLCAndXBkYXRlQnlJZCcsICdkZWxldGVCeUlkJyBdO1xuICAgICAgaHR0cE1ldGhvZHMuZm9yRWFjaCgobWV0aG9kLCBpbmRleCkgPT4ge1xuICAgICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICAgIGh0dHBNZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgICByZXNvdXJjZTogJy90ZXN0LzEyMycsXG4gICAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICcxMjMnIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiBleHBlY3RlZEhhbmRsZXJzWyBpbmRleCBdIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFJvdXRlcyB3aXRoIG1hbnkgcGFyYW1ldGVyc1xuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvMS8yLzMvNC81JyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgYTogJzEnLCBiOiAnMicsIGM6ICczJywgZDogJzQnLCBlOiAnNScgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldEZpdmVQYXJhbXMnIH0pO1xuXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvVVMvQ0EvU0YvRG93bnRvd24vTWFpbi8xMjMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50cnk6ICdVUycsIHN0YXRlOiAnQ0EnLCBjaXR5OiAnU0YnLFxuICAgICAgICAgIGRpc3RyaWN0OiAnRG93bnRvd24nLCBzdHJlZXQ6ICdNYWluJywgYnVpbGRpbmc6ICcxMjMnXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRTaXhQYXJhbXMnIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZmluZE1hdGNoaW5nUm91dGUgLSBBZHZhbmNlZCBTY2VuYXJpb3MnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29tcGxleCBjb250cm9sbGVyIG5hbWVzIGFuZCBSRVNUIHBhdHRlcm5zJywgKCkgPT4ge1xuICAgICAgLy8gVGVzdCBuZXN0ZWQgY29udHJvbGxlciBuYW1lc1xuICAgICAgY29uc3QgbmVzdGVkUm91dGVzID0ge1xuICAgICAgICAnR0VUfC9zdGF0dXMnOiB7IGhhbmRsZXI6ICdnZXRTdGF0dXMnIH0sXG4gICAgICAgICdQT1NUfC9hY3Rpb25zL3thY3Rpb25JZH0nOiB7IGhhbmRsZXI6ICdleGVjdXRlQWN0aW9uJyB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgbmVzdGVkQ29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcihuZXN0ZWRSb3V0ZXMpO1xuICAgICAgbmVzdGVkQ29udHJvbGxlci5jb250cm9sbGVyTmFtZSA9ICdhZG1pbi9zeXN0ZW0vbW9uaXRvcmluZy9oZWFsdGgnO1xuXG4gICAgICBsZXQgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL2FkbWluL3N5c3RlbS9tb25pdG9yaW5nL2hlYWx0aC9zdGF0dXMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChuZXN0ZWRDb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRTdGF0dXMnIH0pO1xuXG4gICAgICAvLyBUZXN0IGNvbnRyb2xsZXIgbmFtZXMgd2l0aCBzcGVjaWFsIGNoYXJhY3RlcnNcbiAgICAgIGNvbnN0IHNwZWNpYWxDb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHsgJ0dFVHwvdGVzdCc6IHsgaGFuZGxlcjogJ3Rlc3QnIH0gfSk7XG4gICAgICBzcGVjaWFsQ29udHJvbGxlci5jb250cm9sbGVyTmFtZSA9ICdhcGktdjEuMi91c2VyLW1hbmFnZW1lbnQnO1xuXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvYXBpLXYxLjIvdXNlci1tYW5hZ2VtZW50L3Rlc3QnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChzcGVjaWFsQ29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAndGVzdCcgfSk7XG5cbiAgICAgIC8vIFRlc3QgY29tcHJlaGVuc2l2ZSBSRVNUIEFQSSBwYXR0ZXJuc1xuICAgICAgY29uc3QgcmVzdFJvdXRlcyA9IHtcbiAgICAgICAgJ0dFVHwvJzogeyBoYW5kbGVyOiAnbGlzdCcgfSxcbiAgICAgICAgJ1BPU1R8Lyc6IHsgaGFuZGxlcjogJ2NyZWF0ZScgfSxcbiAgICAgICAgJ0dFVHwve2lkfSc6IHsgaGFuZGxlcjogJ2dldCcgfSxcbiAgICAgICAgJ1BVVHwve2lkfSc6IHsgaGFuZGxlcjogJ3VwZGF0ZScgfSxcbiAgICAgICAgJ0RFTEVURXwve2lkfSc6IHsgaGFuZGxlcjogJ2RlbGV0ZScgfSxcbiAgICAgICAgJ0dFVHwve2lkfS9yZWxhdGlvbnNoaXBzJzogeyBoYW5kbGVyOiAnZ2V0UmVsYXRpb25zaGlwcycgfSxcbiAgICAgICAgJ1BPU1R8L3tpZH0vcmVsYXRpb25zaGlwcy97cmVsYXRpb25zaGlwVHlwZX0nOiB7IGhhbmRsZXI6ICdhZGRSZWxhdGlvbnNoaXAnIH0sXG4gICAgICAgICdHRVR8L3RlYW1zL3t0ZWFtSWR9L3Byb2plY3RzL3twcm9qZWN0SWR9L3Rhc2tzL3t0YXNrSWR9JzogeyBoYW5kbGVyOiAnZ2V0UHJvamVjdFRhc2snIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN0Q29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcihyZXN0Um91dGVzKTtcblxuICAgICAgY29uc3QgdGVzdENhc2VzID0gW1xuICAgICAgICB7IG1ldGhvZDogJ0dFVCcsIHBhdGg6ICcvdGVzdC8nLCBwYXJhbXM6IHt9LCBleHBlY3RlZDogJ2xpc3QnIH0sXG4gICAgICAgIHsgbWV0aG9kOiAnUE9TVCcsIHBhdGg6ICcvdGVzdC8nLCBwYXJhbXM6IHt9LCBleHBlY3RlZDogJ2NyZWF0ZScgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdHRVQnLCBwYXRoOiAnL3Rlc3QvMTIzJywgcGFyYW1zOiB7IGlkOiAnMTIzJyB9LCBleHBlY3RlZDogJ2dldCcgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdQVVQnLCBwYXRoOiAnL3Rlc3QvMTIzJywgcGFyYW1zOiB7IGlkOiAnMTIzJyB9LCBleHBlY3RlZDogJ3VwZGF0ZScgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdERUxFVEUnLCBwYXRoOiAnL3Rlc3QvMTIzJywgcGFyYW1zOiB7IGlkOiAnMTIzJyB9LCBleHBlY3RlZDogJ2RlbGV0ZScgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdHRVQnLCBwYXRoOiAnL3Rlc3QvMTIzL3JlbGF0aW9uc2hpcHMnLCBwYXJhbXM6IHsgaWQ6ICcxMjMnIH0sIGV4cGVjdGVkOiAnZ2V0UmVsYXRpb25zaGlwcycgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdQT1NUJywgcGF0aDogJy90ZXN0LzEyMy9yZWxhdGlvbnNoaXBzL2ZyaWVuZHMnLCBwYXJhbXM6IHsgaWQ6ICcxMjMnLCByZWxhdGlvbnNoaXBUeXBlOiAnZnJpZW5kcycgfSwgZXhwZWN0ZWQ6ICdhZGRSZWxhdGlvbnNoaXAnIH0sXG4gICAgICAgIHsgbWV0aG9kOiAnR0VUJywgcGF0aDogJy90ZXN0L3RlYW1zL3QxL3Byb2plY3RzL3AyL3Rhc2tzL3Rhc2szJywgcGFyYW1zOiB7IHRlYW1JZDogJ3QxJywgcHJvamVjdElkOiAncDInLCB0YXNrSWQ6ICd0YXNrMycgfSwgZXhwZWN0ZWQ6ICdnZXRQcm9qZWN0VGFzaycgfSxcbiAgICAgIF07XG5cbiAgICAgIHRlc3RDYXNlcy5mb3JFYWNoKCh7IG1ldGhvZCwgcGF0aCwgcGFyYW1zLCBleHBlY3RlZCB9KSA9PiB7XG4gICAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgICAgaHR0cE1ldGhvZDogbWV0aG9kLFxuICAgICAgICAgIHJlc291cmNlOiBwYXRoLFxuICAgICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBwYXJhbXMsXG4gICAgICAgIH0pO1xuICAgICAgICBleHBlY3QocmVzdENvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogZXhwZWN0ZWQgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2ZpbmRNYXRjaGluZ1JvdXRlIC0gRXJyb3IgUmVzaWxpZW5jZScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlcnJvciBjb25kaXRpb25zIGdyYWNlZnVsbHknLCAoKSA9PiB7XG4gICAgICAvLyBUZXN0IG1hbGZvcm1lZCByb3V0ZSBrZXlzXG4gICAgICBjb25zdCBtYWxmb3JtZWRSb3V0ZXMgPSB7XG4gICAgICAgICdHRVR8L3ZhbGlkJzogeyBoYW5kbGVyOiAndmFsaWQnIH0sXG4gICAgICAgICdJTlZBTElEX1JPVVRFJzogeyBoYW5kbGVyOiAnaW52YWxpZCcgfSwgLy8gTWlzc2luZyBwaXBlIHNlcGFyYXRvclxuICAgICAgICAnUE9TVHwnOiB7IGhhbmRsZXI6ICdlbXB0eScgfSwgLy8gRW1wdHkgcGF0aFxuICAgICAgICAnfC9uby1tZXRob2QnOiB7IGhhbmRsZXI6ICdub01ldGhvZCcgfSwgLy8gTWlzc2luZyBtZXRob2RcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIobWFsZm9ybWVkUm91dGVzKTtcblxuICAgICAgLy8gVmFsaWQgcm91dGUgc2hvdWxkIHN0aWxsIHdvcmsgZGVzcGl0ZSBtYWxmb3JtZWQgb25lc1xuICAgICAgbGV0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L3ZhbGlkJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAndmFsaWQnIH0pO1xuXG4gICAgICAvLyBUZXN0IGVtcHR5IGNvbnRyb2xsZXIgbmFtZVxuICAgICAgY29uc3QgZW1wdHlOYW1lQ29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcih7fSk7XG4gICAgICBlbXB0eU5hbWVDb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lID0gJyc7XG5cbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy9hbnl0aGluZycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoKCkgPT4gZW1wdHlOYW1lQ29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLm5vdC50b1Rocm93KCk7XG4gICAgICBleHBlY3QoZW1wdHlOYW1lQ29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvQmVOdWxsKCk7XG5cbiAgICAgIC8vIFRlc3Qgcm91dGVzIHdpdGggYWRkaXRpb25hbCBtZXRhZGF0YVxuICAgICAgY29uc3QgbWV0YWRhdGFSb3V0ZXMgPSB7XG4gICAgICAgICdHRVR8L3VzZXJzJzoge1xuICAgICAgICAgIGhhbmRsZXI6ICdnZXRVc2VycycsXG4gICAgICAgICAgbWlkZGxld2FyZTogWyAnYXV0aCcsICdsb2dnaW5nJyBdLFxuICAgICAgICAgIGNhY2hlOiB0cnVlLFxuICAgICAgICAgIHRpbWVvdXQ6IDMwMDAwXG4gICAgICAgIH0sXG4gICAgICAgICdQT1NUfC97aWR9Jzoge1xuICAgICAgICAgIGhhbmRsZXI6ICd1cGRhdGVVc2VyJyxcbiAgICAgICAgICB2YWxpZGF0aW9uczogeyBib2R5OiB7IHJlcXVpcmVkOiB0cnVlIH0gfSxcbiAgICAgICAgICByYXRlTGltaXQ6IDEwMFxuICAgICAgICB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgbWV0YWRhdGFDb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKG1ldGFkYXRhUm91dGVzKTtcblxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdXNlcnMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChtZXRhZGF0YUNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHtcbiAgICAgICAgaGFuZGxlcjogJ2dldFVzZXJzJyxcbiAgICAgICAgbWlkZGxld2FyZTogWyAnYXV0aCcsICdsb2dnaW5nJyBdLFxuICAgICAgICBjYWNoZTogdHJ1ZSxcbiAgICAgICAgdGltZW91dDogMzAwMDBcbiAgICAgIH0pO1xuXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvMTIzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICcxMjMnIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChtZXRhZGF0YUNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHtcbiAgICAgICAgaGFuZGxlcjogJ3VwZGF0ZVVzZXInLFxuICAgICAgICB2YWxpZGF0aW9uczogeyBib2R5OiB7IHJlcXVpcmVkOiB0cnVlIH0gfSxcbiAgICAgICAgcmF0ZUxpbWl0OiAxMDBcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnQVBJR2F0ZXdheUNvbnRyb2xsZXIgQ29yZSBGdW5jdGlvbmFsaXR5JywgKCkgPT4ge1xuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBqZXN0LmNsZWFyQWxsTW9ja3MoKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3JvdXRlIGZ1bmN0aW9uIHJlc29sdXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gaGFuZGxlciBmdW5jdGlvbiBmb3IgdmFsaWQgcm91dGVzLCA0MDQgaGFuZGxlciBvdGhlcndpc2UnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHt9KTtcblxuICAgICAgLy8gVmFsaWQgcm91dGVcbiAgICAgIGNvbnN0IHZhbGlkUm91dGUgPSB7IGZ1bmN0aW9uTmFtZTogJ3Rlc3RIYW5kbGVyJyB9O1xuICAgICAgY29uc3QgdmFsaWRGdW5jdGlvbiA9IGNvbnRyb2xsZXIudGVzdEdldFJvdXRlRnVuY3Rpb24odmFsaWRSb3V0ZSk7XG4gICAgICBleHBlY3QodmFsaWRGdW5jdGlvbi5jYWxsKGNvbnRyb2xsZXIpKS50b0VxdWFsKHsgbWVzc2FnZTogJ3Rlc3QgaGFuZGxlciBjYWxsZWQnIH0pO1xuXG4gICAgICAvLyBJbnZhbGlkIHJvdXRlcyBhbGwgcmV0dXJuIDQwNFxuICAgICAgWyBudWxsLCB7IGZ1bmN0aW9uTmFtZTogJ25vbkV4aXN0ZW50JyB9LCB7IGZ1bmN0aW9uTmFtZTogJ25vdEFGdW5jdGlvbicgfSBdLmZvckVhY2gocm91dGUgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBjb250cm9sbGVyLnRlc3RHZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlKS5jYWxsKGNvbnRyb2xsZXIsIGNyZWF0ZU1vY2tSZXF1ZXN0KCkpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDA0KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn0pOyJdfQ==