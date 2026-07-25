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
    describe('Actor Context Extraction', () => {
        let controller;
        beforeEach(() => {
            controller = new TestController({});
        });
        // Helper to create mock APIGatewayEvent
        const createMockEventForActorTests = (overrides = {}) => {
            const baseEvent = {
                resource: '/test',
                path: '/test',
                httpMethod: 'GET',
                headers: {},
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {
                    resourceId: 'test',
                    resourcePath: '/test',
                    httpMethod: 'GET',
                    requestId: 'test-request',
                    stage: 'test',
                    identity: {
                        cognitoIdentityPoolId: null,
                        accountId: null,
                        cognitoIdentityId: null,
                        caller: null,
                        sourceIp: '127.0.0.1',
                        principalOrgId: null,
                        accessKey: null,
                        cognitoAuthenticationType: null,
                        cognitoAuthenticationProvider: null,
                        userArn: null,
                        userAgent: 'test-agent',
                        user: null,
                        apiKey: null,
                        apiKeyId: null,
                        clientCert: null
                    },
                    protocol: 'HTTP/1.1',
                    requestTime: '09/Apr/2015:12:34:56 +0000',
                    requestTimeEpoch: 1428582896000,
                    apiId: 'test-api'
                },
                body: null,
                isBase64Encoded: false,
            };
            return {
                ...baseEvent,
                ...overrides,
                requestContext: {
                    ...baseEvent.requestContext,
                    ...overrides.requestContext
                }
            };
        };
        it('should extract actor context from Cognito authorization', () => {
            const event = createMockEventForActorTests({
                headers: {
                    'user-agent': 'Mozilla/5.0 Chrome/91.0'
                },
                requestContext: {
                    identity: {
                        sourceIp: '192.168.1.100'
                    },
                    authorizer: {
                        claims: {
                            sub: 'user-123-456',
                            'cognito:username': 'john.doe',
                            'cognito:groups': 'admin,user',
                            email: 'john@example.com',
                            email_verified: 'true',
                            'custom:tenantId': 'tenant-789',
                            'custom:role': 'manager'
                        }
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-abc-123',
                headers: {
                    'x-correlation-id': 'corr-xyz-789'
                }
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                requestId: 'req-abc-123',
                sourceIp: '192.168.1.100',
                userAgent: 'Mozilla/5.0 Chrome/91.0',
                authMethod: 'cognito',
                actorType: 'user',
                actorId: 'john.doe',
                email: 'john@example.com',
                emailVerified: true,
                cognito: {
                    sub: 'user-123-456',
                    username: 'john.doe',
                    groups: ['admin', 'user'],
                    customAttributes: {
                        tenantId: 'tenant-789',
                        role: 'manager'
                    }
                }
            });
            expect(actor.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });
        it('should extract actor context from API Key authorization (request context)', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    identity: {
                        sourceIp: '10.0.0.1',
                        apiKey: 'api-key-abc123',
                        apiKeyId: 'key-id-456'
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-def-456'
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                requestId: 'req-def-456',
                sourceIp: '10.0.0.1',
                authMethod: 'api-key',
                actorType: 'service',
                actorId: 'api-key:key-id-456',
                apiKey: {
                    id: 'key-id-456',
                    source: 'request-context'
                }
            });
        });
        it('should extract actor context from API Key authorization (header)', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    identity: {
                        sourceIp: '10.0.0.1'
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-header-api-key',
                headers: {
                    'x-api-key': 'header-api-key-xyz789'
                }
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                requestId: 'req-header-api-key',
                sourceIp: '10.0.0.1',
                authMethod: 'api-key',
                actorType: 'service',
                actorId: 'api-key:header-api-key-xyz789',
                apiKey: {
                    id: 'header-api-key-xyz789',
                    source: 'header'
                }
            });
        });
        it('should prioritize request-context API key over header', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    identity: {
                        sourceIp: '10.0.0.1',
                        apiKey: 'context-api-key'
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-priority-test',
                headers: {
                    'x-api-key': 'header-api-key-should-be-ignored'
                }
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                authMethod: 'api-key',
                actorId: 'api-key:context-api-key',
                apiKey: {
                    id: 'context-api-key',
                    source: 'request-context'
                }
            });
        });
        it('should extract actor context from IAM authorization', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    identity: {
                        sourceIp: '172.16.0.1',
                        userArn: 'arn:aws:iam::123456789012:user/service-user',
                        user: 'AIDAI23HZ27SI6FQMGNQ2',
                        accountId: '123456789012',
                        caller: 'caller-id'
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-ghi-789'
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                requestId: 'req-ghi-789',
                sourceIp: '172.16.0.1',
                authMethod: 'iam',
                actorType: 'service',
                actorId: 'AIDAI23HZ27SI6FQMGNQ2',
                iam: {
                    userArn: 'arn:aws:iam::123456789012:user/service-user',
                    userId: 'AIDAI23HZ27SI6FQMGNQ2',
                    accountId: '123456789012',
                    caller: 'caller-id'
                },
            });
        });
        it('should handle system/anonymous authorization', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    identity: {
                        sourceIp: '203.0.113.1'
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-jkl-012'
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                requestId: 'req-jkl-012',
                sourceIp: '203.0.113.1',
                authMethod: 'anonymous',
                actorType: 'anonymous',
                actorId: 'anonymous',
            });
        });
        it('should merge a client-supplied x-actor header for IAM (SigV4) authorization', () => {
            const event = createMockEventForActorTests({
                headers: {
                    'x-actor': JSON.stringify({ id: 'cognito-sub-123', email: 'Jane@Example.com', username: 'JaneD', tenantId: 'tenant-1' }),
                },
                requestContext: {
                    identity: {
                        sourceIp: '172.16.0.1',
                        userArn: 'arn:aws:iam::123456789012:role/authenticated-role',
                        user: 'AIDAI23HZ27SI6FQMGNQ2',
                    }
                }
            });
            const request = createMockRequest({ requestId: 'req-sigv4-actor' });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                authMethod: 'iam',
                // actorId stays the auth-verified IAM identity — the client-supplied claim is NEVER
                // allowed to overwrite the field that createdBy/updatedBy/deletedBy audit stamping trusts.
                actorId: 'AIDAI23HZ27SI6FQMGNQ2',
                actorType: 'user',
                clientSuppliedActor: true,
                clientSuppliedActorId: 'cognito-sub-123',
                email: 'Jane@Example.com',
                name: 'JaneD',
                tenantId: 'tenant-1',
                cognito: { sub: 'cognito-sub-123' },
            });
            // The IAM ARN is still recorded — the client-supplied actor only fills the
            // "who", it doesn't erase the underlying auth mechanism's own context.
            expect(actor.iam?.userArn).toBe('arn:aws:iam::123456789012:role/authenticated-role');
        });
        it('should merge a client-supplied x-actor header for anonymous requests', () => {
            const event = createMockEventForActorTests({
                headers: { 'x-actor': JSON.stringify({ id: 'sub-abc' }) },
                requestContext: { identity: { sourceIp: '203.0.113.1' } }
            });
            const request = createMockRequest({ requestId: 'req-anon-actor' });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                authMethod: 'anonymous',
                // actorId stays 'anonymous' — see the IAM test above for why this is never overwritten.
                actorId: 'anonymous',
                actorType: 'user',
                clientSuppliedActor: true,
                clientSuppliedActorId: 'sub-abc',
            });
        });
        it('should ignore a malformed x-actor header without throwing', () => {
            const event = createMockEventForActorTests({
                headers: { 'x-actor': '{not valid json' },
                requestContext: { identity: { sourceIp: '203.0.113.1' } }
            });
            const request = createMockRequest({ requestId: 'req-bad-actor-header' });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                authMethod: 'anonymous',
                actorId: 'anonymous',
            });
            expect(actor.clientSuppliedActor).toBeUndefined();
            expect(actor.clientSuppliedActorId).toBeUndefined();
        });
        it('should ignore an x-actor header missing the required id field', () => {
            const event = createMockEventForActorTests({
                headers: { 'x-actor': JSON.stringify({ email: 'no-id@example.com' }) },
                requestContext: { identity: { sourceIp: '203.0.113.1' } }
            });
            const request = createMockRequest({ requestId: 'req-no-id-actor' });
            const actor = controller.extractActorContext(event, request);
            expect(actor.actorId).toBe('anonymous');
            expect(actor.clientSuppliedActor).toBeUndefined();
            expect(actor.clientSuppliedActorId).toBeUndefined();
        });
        it('should never let a client-supplied x-actor header override a verified Cognito actor', () => {
            const event = createMockEventForActorTests({
                headers: { 'x-actor': JSON.stringify({ id: 'spoofed-id' }) },
                requestContext: {
                    authorizer: {
                        claims: {
                            sub: 'real-cognito-sub',
                            'cognito:username': 'real_user',
                        }
                    }
                }
            });
            const request = createMockRequest({ requestId: 'req-cognito-not-spoofed' });
            const actor = controller.extractActorContext(event, request);
            expect(actor.authMethod).toBe('cognito');
            expect(actor.actorId).toBe('real_user');
            expect(actor.clientSuppliedActor).toBeUndefined();
            expect(actor.clientSuppliedActorId).toBeUndefined();
        });
        it('should handle malformed claims gracefully', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    authorizer: {
                        claims: {
                            sub: 'user-malformed-test',
                            'cognito:username': 'malformed_user',
                            'cognito:groups': null, // Malformed groups
                            email_verified: 'not-a-boolean', // Invalid boolean
                            'custom:weird:key': 'should-be-ignored' // Invalid custom attribute format
                        }
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-malformed-claims'
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                authMethod: 'cognito',
                actorType: 'user',
                actorId: 'malformed_user',
                emailVerified: false, // Should default to false for invalid boolean
                cognito: {
                    sub: 'user-malformed-test',
                    username: 'malformed_user',
                    groups: [], // Null groups should become empty array
                    customAttributes: {} // Invalid custom attributes should be empty
                }
            });
        });
        it('should handle missing optional fields gracefully', () => {
            const event = createMockEventForActorTests({
                headers: {}, // No user-agent
                requestContext: {
                    identity: {
                        sourceIp: undefined // No source IP
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-pqr-678',
                headers: {} // No custom headers
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                requestId: 'req-pqr-678',
                sourceIp: undefined,
                userAgent: undefined,
                authMethod: 'anonymous',
                actorType: 'anonymous',
                actorId: 'anonymous',
            });
        });
        it('should prioritize cognito username over sub for actorId', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    authorizer: {
                        claims: {
                            sub: 'user-sub-123',
                            'cognito:username': 'preferred.username'
                        }
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-stu-901'
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor.actorId).toBe('preferred.username');
            expect(actor.cognito?.sub).toBe('user-sub-123');
        });
        it('should use email as fallback when cognito username is not available', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    authorizer: {
                        claims: {
                            sub: 'user-sub-456',
                            email: 'fallback@example.com'
                        }
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-vwx-234'
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor.actorId).toBe('fallback@example.com');
            expect(actor.cognito?.sub).toBe('user-sub-456');
        });
        it('should handle groups parsing edge cases', () => {
            const testCases = [
                {
                    name: 'single group',
                    groups: 'admin',
                    expected: ['admin']
                },
                {
                    name: 'multiple groups with spaces',
                    groups: ' admin , user , moderator ',
                    expected: ['admin', 'user', 'moderator']
                },
                {
                    name: 'empty group string',
                    groups: '',
                    expected: []
                },
                {
                    name: 'groups with extra commas',
                    groups: 'admin,,user,',
                    expected: ['admin', 'user']
                }
            ];
            testCases.forEach(({ name, groups, expected }) => {
                const event = createMockEventForActorTests({
                    requestContext: {
                        authorizer: {
                            claims: {
                                sub: 'user-groups-test',
                                'cognito:username': 'groups_user',
                                'cognito:groups': groups
                            }
                        }
                    }
                });
                const request = createMockRequest({
                    requestId: `req-groups-${name.replace(/\s+/g, '-')}`
                });
                const actor = controller.extractActorContext(event, request);
                expect(actor.cognito?.groups).toEqual(expected);
            });
        });
        it('should extract custom attributes from Cognito', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    authorizer: {
                        claims: {
                            sub: 'user-with-custom-attrs',
                            'cognito:username': 'custom_user',
                            'custom:department': 'engineering',
                            'custom:role': 'senior-developer',
                            'custom:company_id': 'company-123'
                        }
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-custom-attrs'
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                authMethod: 'cognito',
                actorType: 'user',
                actorId: 'custom_user',
                cognito: {
                    sub: 'user-with-custom-attrs',
                    username: 'custom_user',
                    customAttributes: {
                        department: 'engineering',
                        role: 'senior-developer',
                        company_id: 'company-123'
                    }
                }
            });
        });
        it('should use sub as final fallback for actorId', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    authorizer: {
                        claims: {
                            sub: 'user-sub-final-fallback'
                            // No cognito:username, no email
                        }
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-sub-fallback'
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor.actorId).toBe('user-sub-final-fallback');
            expect(actor.cognito?.sub).toBe('user-sub-final-fallback');
        });
        it('should handle phone number verification correctly', () => {
            const testCases = [
                {
                    name: 'verified phone',
                    phone_number: '+1234567890',
                    phone_number_verified: 'true',
                    expectedVerified: true
                },
                {
                    name: 'unverified phone',
                    phone_number: '+1234567890',
                    phone_number_verified: 'false',
                    expectedVerified: false
                },
                {
                    name: 'phone without verification flag',
                    phone_number: '+1234567890',
                    phone_number_verified: undefined,
                    expectedVerified: false
                }
            ];
            testCases.forEach(({ name, phone_number, phone_number_verified, expectedVerified }) => {
                const claims = {
                    sub: 'user-phone-test',
                    'cognito:username': 'phone_user',
                    phone_number
                };
                if (phone_number_verified !== undefined) {
                    claims.phone_number_verified = phone_number_verified;
                }
                const event = createMockEventForActorTests({
                    requestContext: {
                        authorizer: { claims }
                    }
                });
                const request = createMockRequest({
                    requestId: `req-phone-${name.replace(/\s+/g, '-')}`
                });
                const actor = controller.extractActorContext(event, request);
                expect(actor.phoneNumber).toBe(phone_number);
                expect(actor.phoneVerified).toBe(expectedVerified);
            });
        });
    });
    describe('buildCtx integration', () => {
        it('should build execution context with actor', () => {
            const controller = new TestController({});
            const createMockEventForBuildCtx = (overrides = {}) => {
                const baseEvent = {
                    resource: '/test',
                    path: '/test',
                    httpMethod: 'GET',
                    headers: {},
                    multiValueHeaders: {},
                    queryStringParameters: null,
                    multiValueQueryStringParameters: null,
                    pathParameters: null,
                    stageVariables: null,
                    requestContext: {
                        resourceId: 'test',
                        resourcePath: '/test',
                        httpMethod: 'GET',
                        requestId: 'test-request',
                        stage: 'test',
                        identity: {
                            cognitoIdentityPoolId: null,
                            accountId: null,
                            cognitoIdentityId: null,
                            caller: null,
                            sourceIp: '127.0.0.1',
                            principalOrgId: null,
                            accessKey: null,
                            cognitoAuthenticationType: null,
                            cognitoAuthenticationProvider: null,
                            userArn: null,
                            userAgent: 'test-agent',
                            user: null,
                            apiKey: null,
                            apiKeyId: null,
                            clientCert: null
                        },
                        protocol: 'HTTP/1.1',
                        requestTime: '09/Apr/2015:12:34:56 +0000',
                        requestTimeEpoch: 1428582896000,
                        apiId: 'test-api'
                    },
                    body: null,
                    isBase64Encoded: false,
                };
                return {
                    ...baseEvent,
                    ...overrides,
                    requestContext: {
                        ...baseEvent.requestContext,
                        ...overrides.requestContext
                    }
                };
            };
            const event = createMockEventForBuildCtx({
                requestContext: {
                    authorizer: {
                        claims: {
                            sub: 'user-123',
                            'cognito:username': 'test.user'
                        }
                    }
                }
            });
            const context = {};
            const request = createMockRequest({
                requestId: 'req-ctx-test'
            });
            const response = {};
            const executionContext = controller.testBuildCtx(event, context, request, response);
            expect(executionContext).toMatchObject({
                event,
                lambdaContext: context,
                request,
                response,
                debugInfo: {}
            });
            expect(executionContext.actor).toMatchObject({
                requestId: 'req-ctx-test',
                authMethod: 'cognito',
                actorType: 'user',
                actorId: 'test.user',
                cognito: {
                    sub: 'user-123',
                    username: 'test.user'
                }
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9hcGktZ2F0ZXdheS1jb250cm9sbGVyLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxRUFBeUQ7QUFJekQsaUNBQWlDO0FBQ2pDLE1BQU0sY0FBZSxTQUFRLHNDQUFhO0lBQ2pDLGNBQWMsR0FBRyxNQUFNLENBQUM7SUFDeEIsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUVuQixZQUFZLE1BQTJCO1FBQ3JDLEtBQUssRUFBRSxDQUFDO1FBQ1IsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7SUFDdkIsQ0FBQztJQUVELHFDQUFxQztJQUM5QixxQkFBcUIsQ0FBQyxXQUFvQjtRQUMvQyxPQUFRLElBQVksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRU0sb0JBQW9CLENBQUMsS0FBVTtRQUNwQyxPQUFRLElBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUMvQyxDQUFDO0lBRU0sNkJBQTZCLENBQUMsS0FBYSxFQUFFLE9BQWdCLEVBQUUsUUFBYSxFQUFFLEdBQVMsRUFBRSxLQUFhO1FBQzNHLE9BQVEsSUFBWSxDQUFDLHlCQUF5QixDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUN2RixDQUFDO0lBRU0sa0JBQWtCLENBQUMsR0FBUTtRQUNoQyxPQUFRLElBQVksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDM0MsQ0FBQztJQUVNLG1CQUFtQixDQUFDLEdBQVksRUFBRSxHQUFVLEVBQUUsR0FBUTtRQUMzRCxPQUFRLElBQVksQ0FBQyxlQUFlLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRU0sWUFBWSxDQUFDLEtBQXNCLEVBQUUsT0FBZ0IsRUFBRSxPQUFnQixFQUFFLFFBQWE7UUFDM0YsT0FBUSxJQUFZLENBQUMsUUFBUSxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQ25FLENBQUM7SUFFRCw2Q0FBNkM7SUFDdEMsaUJBQWlCLENBQUMsVUFBZTtRQUN0QyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQ2pDLENBQUM7SUFFRCx1Q0FBdUM7SUFDaEMsa0JBQWtCLENBQUMsR0FBWTtRQUNwQyxPQUFPLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDbEMsQ0FBQztJQUVELHVCQUF1QjtJQUNoQixXQUFXO1FBQ2hCLE9BQU8sRUFBRSxPQUFPLEVBQUUscUJBQXFCLEVBQUUsQ0FBQztJQUM1QyxDQUFDO0lBRU0sS0FBSyxDQUFDLGdCQUFnQjtRQUMzQixPQUFPLEVBQUUsT0FBTyxFQUFFLDJCQUEyQixFQUFFLENBQUM7SUFDbEQsQ0FBQztJQUVNLG9CQUFvQjtRQUN6QixNQUFNLElBQUksS0FBSyxDQUFDLG9CQUFvQixDQUFDLENBQUM7SUFDeEMsQ0FBQztJQUVELDJCQUEyQjtJQUMzQixLQUFLLENBQUMsVUFBVSxDQUFDLE1BQXVCLEVBQUUsUUFBaUI7UUFDekQsb0JBQW9CO0lBQ3RCLENBQUM7Q0FDRjtBQUVELGlEQUFpRDtBQUNqRCxTQUFTLGlCQUFpQixDQUFDLFlBQThCLEVBQUU7SUFDekQsTUFBTSxTQUFTLEdBQUcsRUFBcUIsQ0FBQztJQUN4QyxNQUFNLFdBQVcsR0FBRyxFQUFhLENBQUM7SUFFbEMsT0FBTztRQUNMLEtBQUssRUFBRSxTQUFTO1FBQ2hCLFNBQVMsRUFBRSxpQkFBaUI7UUFDNUIsT0FBTyxFQUFFLFdBQVc7UUFDcEIsUUFBUSxFQUFFLE9BQU87UUFDakIsSUFBSSxFQUFFLEVBQUU7UUFDUixJQUFJLEVBQUUsT0FBTztRQUNiLHFCQUFxQixFQUFFLEVBQUU7UUFDekIsT0FBTyxFQUFFLEVBQUU7UUFDWCxjQUFjLEVBQUUsRUFBRTtRQUNsQixjQUFjLEVBQUUsRUFBRTtRQUNsQixjQUFjLEVBQUUsRUFBRTtRQUNsQixlQUFlLEVBQUUsS0FBSztRQUN0QixVQUFVLEVBQUUsS0FBSztRQUNqQixTQUFTLEVBQUUsS0FBSztRQUNoQixRQUFRLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNuQixRQUFRLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNuQixTQUFTLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNwQixTQUFTLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNwQixZQUFZLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUN2QixZQUFZLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUN2QixhQUFhLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUN4QixhQUFhLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUN4QixZQUFZLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUN2QixZQUFZLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUN2QixHQUFHLFNBQVM7S0FDYixDQUFDO0FBQ0osQ0FBQztBQUVELFFBQVEsQ0FBQyxxQ0FBcUMsRUFBRSxHQUFHLEVBQUU7SUFDbkQsVUFBVSxDQUFDLEdBQUcsRUFBRTtRQUNkLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUN2QixDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyx3Q0FBd0MsRUFBRSxHQUFHLEVBQUU7UUFDdEQsRUFBRSxDQUFDLHNEQUFzRCxFQUFFLEdBQUcsRUFBRTtZQUM5RCxNQUFNLE1BQU0sR0FBRztnQkFDYixlQUFlO2dCQUNmLE9BQU8sRUFBRSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUU7Z0JBQzdCLFlBQVksRUFBRSxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUU7Z0JBQ3RDLGFBQWEsRUFBRSxFQUFFLE9BQU8sRUFBRSxZQUFZLEVBQUU7Z0JBRXhDLG1CQUFtQjtnQkFDbkIsV0FBVyxFQUFFLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRTtnQkFDbkMsY0FBYyxFQUFFLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRTtnQkFFekMsd0JBQXdCO2dCQUN4Qix3QkFBd0IsRUFBRSxFQUFFLE9BQU8sRUFBRSxpQkFBaUIsRUFBRTtnQkFDeEQsb0NBQW9DLEVBQUUsRUFBRSxPQUFPLEVBQUUsYUFBYSxFQUFFO2dCQUVoRSx1QkFBdUI7Z0JBQ3ZCLDREQUE0RCxFQUFFLEVBQUUsT0FBTyxFQUFFLHFCQUFxQixFQUFFO2dCQUVoRyw2QkFBNkI7Z0JBQzdCLGlCQUFpQixFQUFFLEVBQUUsT0FBTyxFQUFFLGFBQWEsRUFBRTtnQkFDN0MsMEJBQTBCLEVBQUUsRUFBRSxPQUFPLEVBQUUsbUJBQW1CLEVBQUU7Z0JBQzVELHFCQUFxQixFQUFFLEVBQUUsT0FBTyxFQUFFLGFBQWEsRUFBRTthQUNsRCxDQUFDO1lBRUYsTUFBTSxVQUFVLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFOUMsNEJBQTRCO1lBQzVCLElBQUksT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUM5QixVQUFVLEVBQUUsS0FBSztnQkFDakIsUUFBUSxFQUFFLFFBQVE7Z0JBQ2xCLGNBQWMsRUFBRSxFQUFFO2FBQ25CLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxVQUFVLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQztZQUVoRix3QkFBd0I7WUFDeEIsT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUMxQixVQUFVLEVBQUUsS0FBSztnQkFDakIsUUFBUSxFQUFFLFdBQVc7Z0JBQ3JCLGNBQWMsRUFBRSxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUU7YUFDOUIsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxDQUFDLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1lBRWxGLDJCQUEyQjtZQUMzQixPQUFPLEdBQUcsaUJBQWlCLENBQUM7Z0JBQzFCLFVBQVUsRUFBRSxLQUFLO2dCQUNqQixRQUFRLEVBQUUsc0JBQXNCO2dCQUNoQyxjQUFjLEVBQUUsRUFBRSxHQUFHLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLE1BQU0sRUFBRTthQUMxRCxDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsVUFBVSxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsT0FBTyxFQUFFLGlCQUFpQixFQUFFLENBQUMsQ0FBQztZQUUxRiw0QkFBNEI7WUFDNUIsT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUMxQixVQUFVLEVBQUUsS0FBSztnQkFDakIsUUFBUSxFQUFFLG1EQUFtRDtnQkFDN0QsY0FBYyxFQUFFLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUU7YUFDN0UsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxDQUFDLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLE9BQU8sRUFBRSxxQkFBcUIsRUFBRSxDQUFDLENBQUM7WUFFOUYsK0NBQStDO1lBQy9DLE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztnQkFDMUIsVUFBVSxFQUFFLEtBQUs7Z0JBQ2pCLFFBQVEsRUFBRSxhQUFhO2dCQUN2QixjQUFjLEVBQUUsRUFBRTthQUNuQixDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsVUFBVSxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7WUFFcEYsMERBQTBEO1lBQzFELE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztnQkFDMUIsVUFBVSxFQUFFLEtBQUs7Z0JBQ2pCLFFBQVEsRUFBRSxpQkFBaUI7Z0JBQzNCLGNBQWMsRUFBRSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUU7YUFDbEMsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxDQUFDLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLE9BQU8sRUFBRSxhQUFhLEVBQUUsQ0FBQyxDQUFDO1FBQ3hGLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHdDQUF3QyxFQUFFLEdBQUcsRUFBRTtZQUNoRCxNQUFNLE1BQU0sR0FBRztnQkFDYix3QkFBd0IsRUFBRSxFQUFFLE9BQU8sRUFBRSxpQkFBaUIsRUFBRTtnQkFDeEQsWUFBWSxFQUFFLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRTthQUN4QyxDQUFDO1lBRUYsTUFBTSxVQUFVLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFOUMsMkJBQTJCO1lBQzNCLElBQUksT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUM5QixVQUFVLEVBQUUsS0FBSztnQkFDakIsUUFBUSxFQUFFLHFCQUFxQixFQUFFLFVBQVU7Z0JBQzNDLGNBQWMsRUFBRSxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLFFBQVEsRUFBRTthQUNqRCxDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsVUFBVSxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUM7WUFFN0QsT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUMxQixVQUFVLEVBQUUsS0FBSztnQkFDakIsUUFBUSxFQUFFLGtDQUFrQyxFQUFFLFdBQVc7Z0JBQ3pELGNBQWMsRUFBRSxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsUUFBUSxFQUFFO2FBQ2hFLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxVQUFVLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUU3RCxvQkFBb0I7WUFDcEIsT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUMxQixVQUFVLEVBQUUsUUFBUSxFQUFFLGlCQUFpQjtnQkFDdkMsUUFBUSxFQUFFLFdBQVc7Z0JBQ3JCLGNBQWMsRUFBRSxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUU7YUFDOUIsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxDQUFDLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBRTdELG9CQUFvQjtZQUNwQixPQUFPLEdBQUcsaUJBQWlCLENBQUM7Z0JBQzFCLFVBQVUsRUFBRSxLQUFLO2dCQUNqQixRQUFRLEVBQUUseUJBQXlCO2dCQUNuQyxjQUFjLEVBQUUsRUFBRTthQUNuQixDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsVUFBVSxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDL0QsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsNkNBQTZDLEVBQUUsR0FBRyxFQUFFO1lBQ3JELE1BQU0sTUFBTSxHQUFHO2dCQUNiLGNBQWMsRUFBRSxFQUFFLE9BQU8sRUFBRSxZQUFZLEVBQUU7Z0JBQ3pDLHdCQUF3QixFQUFFLEVBQUUsT0FBTyxFQUFFLGVBQWUsRUFBRTthQUN2RCxDQUFDO1lBRUYsTUFBTSxVQUFVLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDOUMsVUFBVSxDQUFDLGNBQWMsR0FBRyxlQUFlLENBQUM7WUFFNUMsTUFBTSxPQUFPLEdBQUcsaUJBQWlCLENBQUM7Z0JBQ2hDLFVBQVUsRUFBRSxLQUFLO2dCQUNqQixRQUFRLEVBQUUsd0JBQXdCO2dCQUNsQyxjQUFjLEVBQUUsRUFBRTthQUNuQixDQUFDLENBQUM7WUFFSCxNQUFNLENBQUMsVUFBVSxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRSxDQUFDLENBQUM7UUFDdkYsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyw2Q0FBNkMsRUFBRSxHQUFHLEVBQUU7UUFDM0QsRUFBRSxDQUFDLG1EQUFtRCxFQUFFLEdBQUcsRUFBRTtZQUMzRCxNQUFNLE1BQU0sR0FBRztnQkFDYixXQUFXLEVBQUUsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFO2dCQUNuQywwQkFBMEIsRUFBRSxFQUFFLE9BQU8sRUFBRSxlQUFlLEVBQUU7Z0JBQ3hELCtEQUErRCxFQUFFLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRTtnQkFDNUYsV0FBVyxFQUFFLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRTtnQkFDdEMsY0FBYyxFQUFFLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRTthQUMxQyxDQUFDO1lBRUYsTUFBTSxVQUFVLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFOUMsc0JBQXNCO1lBQ3RCLE1BQU0sZUFBZSxHQUFHLElBQUksY0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQy9DLElBQUksT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUM5QixVQUFVLEVBQUUsS0FBSztnQkFDakIsUUFBUSxFQUFFLGdCQUFnQjtnQkFDMUIsY0FBYyxFQUFFLEVBQUU7YUFDbkIsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxDQUFDLGVBQWUsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBRWxFLG1DQUFtQztZQUNuQyxNQUFNLGdCQUFnQixHQUFHLENBQUUsU0FBUyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsaUJBQWlCLENBQUUsQ0FBQztZQUM3RSxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEVBQUU7Z0JBQzVCLE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztvQkFDMUIsVUFBVSxFQUFFLEtBQUs7b0JBQ2pCLFFBQVEsRUFBRSxTQUFTLEVBQUUsRUFBRTtvQkFDdkIsY0FBYyxFQUFFLEVBQUUsRUFBRSxFQUFFO2lCQUN2QixDQUFDLENBQUM7Z0JBQ0gsTUFBTSxDQUFDLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1lBQ3BGLENBQUMsQ0FBQyxDQUFDO1lBRUgsc0JBQXNCO1lBQ3RCLE1BQU0sTUFBTSxHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDaEMsT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUMxQixVQUFVLEVBQUUsS0FBSztnQkFDakIsUUFBUSxFQUFFLFNBQVMsTUFBTSxFQUFFO2dCQUMzQixjQUFjLEVBQUUsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFO2FBQy9CLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxVQUFVLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztZQUVsRix3QkFBd0I7WUFDeEIsTUFBTSxXQUFXLEdBQUcsQ0FBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBRSxDQUFDO1lBQy9DLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBRSxTQUFTLEVBQUUsWUFBWSxFQUFFLFlBQVksQ0FBRSxDQUFDO1lBQ25FLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEVBQUU7Z0JBQ3BDLE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztvQkFDMUIsVUFBVSxFQUFFLE1BQU07b0JBQ2xCLFFBQVEsRUFBRSxXQUFXO29CQUNyQixjQUFjLEVBQUUsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFO2lCQUM5QixDQUFDLENBQUM7Z0JBQ0gsTUFBTSxDQUFDLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLE9BQU8sRUFBRSxnQkFBZ0IsQ0FBRSxLQUFLLENBQUUsRUFBRSxDQUFDLENBQUM7WUFDcEcsQ0FBQyxDQUFDLENBQUM7WUFFSCw4QkFBOEI7WUFDOUIsT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUMxQixVQUFVLEVBQUUsS0FBSztnQkFDakIsUUFBUSxFQUFFLGlCQUFpQjtnQkFDM0IsY0FBYyxFQUFFLEVBQUUsQ0FBQyxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFO2FBQzNELENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxVQUFVLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxPQUFPLEVBQUUsZUFBZSxFQUFFLENBQUMsQ0FBQztZQUV4RixPQUFPLEdBQUcsaUJBQWlCLENBQUM7Z0JBQzFCLFVBQVUsRUFBRSxNQUFNO2dCQUNsQixRQUFRLEVBQUUsa0NBQWtDO2dCQUM1QyxjQUFjLEVBQUU7b0JBQ2QsT0FBTyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJO29CQUN0QyxRQUFRLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLEtBQUs7aUJBQ3REO2FBQ0YsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxDQUFDLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUUsQ0FBQyxDQUFDO1FBQ3pGLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsd0NBQXdDLEVBQUUsR0FBRyxFQUFFO1FBQ3RELEVBQUUsQ0FBQywwREFBMEQsRUFBRSxHQUFHLEVBQUU7WUFDbEUsK0JBQStCO1lBQy9CLE1BQU0sWUFBWSxHQUFHO2dCQUNuQixhQUFhLEVBQUUsRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFO2dCQUN2QywwQkFBMEIsRUFBRSxFQUFFLE9BQU8sRUFBRSxlQUFlLEVBQUU7YUFDekQsQ0FBQztZQUVGLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxjQUFjLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDMUQsZ0JBQWdCLENBQUMsY0FBYyxHQUFHLGdDQUFnQyxDQUFDO1lBRW5FLElBQUksT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUM5QixVQUFVLEVBQUUsS0FBSztnQkFDakIsUUFBUSxFQUFFLHdDQUF3QztnQkFDbEQsY0FBYyxFQUFFLEVBQUU7YUFDbkIsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxDQUFDLGdCQUFnQixDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsT0FBTyxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7WUFFMUYsZ0RBQWdEO1lBQ2hELE1BQU0saUJBQWlCLEdBQUcsSUFBSSxjQUFjLENBQUMsRUFBRSxXQUFXLEVBQUUsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ25GLGlCQUFpQixDQUFDLGNBQWMsR0FBRywwQkFBMEIsQ0FBQztZQUU5RCxPQUFPLEdBQUcsaUJBQWlCLENBQUM7Z0JBQzFCLFVBQVUsRUFBRSxLQUFLO2dCQUNqQixRQUFRLEVBQUUsZ0NBQWdDO2dCQUMxQyxjQUFjLEVBQUUsRUFBRTthQUNuQixDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsaUJBQWlCLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUV0Rix1Q0FBdUM7WUFDdkMsTUFBTSxVQUFVLEdBQUc7Z0JBQ2pCLE9BQU8sRUFBRSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUU7Z0JBQzVCLFFBQVEsRUFBRSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUU7Z0JBQy9CLFdBQVcsRUFBRSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUU7Z0JBQy9CLFdBQVcsRUFBRSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUU7Z0JBQ2xDLGNBQWMsRUFBRSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUU7Z0JBQ3JDLHlCQUF5QixFQUFFLEVBQUUsT0FBTyxFQUFFLGtCQUFrQixFQUFFO2dCQUMxRCw2Q0FBNkMsRUFBRSxFQUFFLE9BQU8sRUFBRSxpQkFBaUIsRUFBRTtnQkFDN0UseURBQXlELEVBQUUsRUFBRSxPQUFPLEVBQUUsZ0JBQWdCLEVBQUU7YUFDekYsQ0FBQztZQUVGLE1BQU0sY0FBYyxHQUFHLElBQUksY0FBYyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBRXRELE1BQU0sU0FBUyxHQUFHO2dCQUNoQixFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUU7Z0JBQy9ELEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRTtnQkFDbEUsRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUU7Z0JBQzVFLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFO2dCQUMvRSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRTtnQkFDbEYsRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSx5QkFBeUIsRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLEVBQUUsUUFBUSxFQUFFLGtCQUFrQixFQUFFO2dCQUN2RyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLGlDQUFpQyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsZ0JBQWdCLEVBQUUsU0FBUyxFQUFFLEVBQUUsUUFBUSxFQUFFLGlCQUFpQixFQUFFO2dCQUM1SSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLHdDQUF3QyxFQUFFLE1BQU0sRUFBRSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLEVBQUUsUUFBUSxFQUFFLGdCQUFnQixFQUFFO2FBQzFKLENBQUM7WUFFRixTQUFTLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsRUFBRSxFQUFFO2dCQUN2RCxPQUFPLEdBQUcsaUJBQWlCLENBQUM7b0JBQzFCLFVBQVUsRUFBRSxNQUFNO29CQUNsQixRQUFRLEVBQUUsSUFBSTtvQkFDZCxjQUFjLEVBQUUsTUFBTTtpQkFDdkIsQ0FBQyxDQUFDO2dCQUNILE1BQU0sQ0FBQyxjQUFjLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQztZQUN2RixDQUFDLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsc0NBQXNDLEVBQUUsR0FBRyxFQUFFO1FBQ3BELEVBQUUsQ0FBQywyQ0FBMkMsRUFBRSxHQUFHLEVBQUU7WUFDbkQsNEJBQTRCO1lBQzVCLE1BQU0sZUFBZSxHQUFHO2dCQUN0QixZQUFZLEVBQUUsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFO2dCQUNsQyxlQUFlLEVBQUUsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLEVBQUUseUJBQXlCO2dCQUNsRSxPQUFPLEVBQUUsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLEVBQUUsYUFBYTtnQkFDNUMsYUFBYSxFQUFFLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxFQUFFLGlCQUFpQjthQUMxRCxDQUFDO1lBRUYsTUFBTSxVQUFVLEdBQUcsSUFBSSxjQUFjLENBQUMsZUFBZSxDQUFDLENBQUM7WUFFdkQsdURBQXVEO1lBQ3ZELElBQUksT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUM5QixVQUFVLEVBQUUsS0FBSztnQkFDakIsUUFBUSxFQUFFLGFBQWE7Z0JBQ3ZCLGNBQWMsRUFBRSxFQUFFO2FBQ25CLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxVQUFVLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQztZQUVoRiw2QkFBNkI7WUFDN0IsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLGNBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUNuRCxtQkFBbUIsQ0FBQyxjQUFjLEdBQUcsRUFBRSxDQUFDO1lBRXhDLE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztnQkFDMUIsVUFBVSxFQUFFLEtBQUs7Z0JBQ2pCLFFBQVEsRUFBRSxXQUFXO2dCQUNyQixjQUFjLEVBQUUsRUFBRTthQUNuQixDQUFDLENBQUM7WUFFSCxNQUFNLENBQUMsR0FBRyxFQUFFLENBQUMsbUJBQW1CLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDL0UsTUFBTSxDQUFDLG1CQUFtQixDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUM7WUFFdEUsdUNBQXVDO1lBQ3ZDLE1BQU0sY0FBYyxHQUFHO2dCQUNyQixZQUFZLEVBQUU7b0JBQ1osT0FBTyxFQUFFLFVBQVU7b0JBQ25CLFVBQVUsRUFBRSxDQUFFLE1BQU0sRUFBRSxTQUFTLENBQUU7b0JBQ2pDLEtBQUssRUFBRSxJQUFJO29CQUNYLE9BQU8sRUFBRSxLQUFLO2lCQUNmO2dCQUNELFlBQVksRUFBRTtvQkFDWixPQUFPLEVBQUUsWUFBWTtvQkFDckIsV0FBVyxFQUFFLEVBQUUsSUFBSSxFQUFFLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxFQUFFO29CQUN6QyxTQUFTLEVBQUUsR0FBRztpQkFDZjthQUNGLENBQUM7WUFFRixNQUFNLGtCQUFrQixHQUFHLElBQUksY0FBYyxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBRTlELE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztnQkFDMUIsVUFBVSxFQUFFLEtBQUs7Z0JBQ2pCLFFBQVEsRUFBRSxhQUFhO2dCQUN2QixjQUFjLEVBQUUsRUFBRTthQUNuQixDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsa0JBQWtCLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUM7Z0JBQ2hFLE9BQU8sRUFBRSxVQUFVO2dCQUNuQixVQUFVLEVBQUUsQ0FBRSxNQUFNLEVBQUUsU0FBUyxDQUFFO2dCQUNqQyxLQUFLLEVBQUUsSUFBSTtnQkFDWCxPQUFPLEVBQUUsS0FBSzthQUNmLENBQUMsQ0FBQztZQUVILE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztnQkFDMUIsVUFBVSxFQUFFLE1BQU07Z0JBQ2xCLFFBQVEsRUFBRSxXQUFXO2dCQUNyQixjQUFjLEVBQUUsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFO2FBQzlCLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQztnQkFDaEUsT0FBTyxFQUFFLFlBQVk7Z0JBQ3JCLFdBQVcsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsRUFBRTtnQkFDekMsU0FBUyxFQUFFLEdBQUc7YUFDZixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUM7QUFFSCxRQUFRLENBQUMseUNBQXlDLEVBQUUsR0FBRyxFQUFFO0lBQ3ZELFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7SUFDdkIsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsMkJBQTJCLEVBQUUsR0FBRyxFQUFFO1FBQ3pDLEVBQUUsQ0FBQyx3RUFBd0UsRUFBRSxHQUFHLEVBQUU7WUFDaEYsTUFBTSxVQUFVLEdBQUcsSUFBSSxjQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7WUFFMUMsY0FBYztZQUNkLE1BQU0sVUFBVSxHQUFHLEVBQUUsWUFBWSxFQUFFLGFBQWEsRUFBRSxDQUFDO1lBQ25ELE1BQU0sYUFBYSxHQUFHLFVBQVUsQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUNsRSxNQUFNLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLE9BQU8sRUFBRSxxQkFBcUIsRUFBRSxDQUFDLENBQUM7WUFFbkYsZ0NBQWdDO1lBQ2hDLENBQUUsSUFBSSxFQUFFLEVBQUUsWUFBWSxFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFFLGNBQWMsRUFBRSxDQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFO2dCQUMxRixNQUFNLE1BQU0sR0FBRyxVQUFVLENBQUMsb0JBQW9CLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxpQkFBaUIsRUFBRSxDQUFDLENBQUM7Z0JBQzVGLE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3RDLENBQUMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQywwQkFBMEIsRUFBRSxHQUFHLEVBQUU7UUFDeEMsSUFBSSxVQUEwQixDQUFDO1FBRS9CLFVBQVUsQ0FBQyxHQUFHLEVBQUU7WUFDZCxVQUFVLEdBQUcsSUFBSSxjQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDdEMsQ0FBQyxDQUFDLENBQUM7UUFFSCx3Q0FBd0M7UUFDeEMsTUFBTSw0QkFBNEIsR0FBRyxDQUFDLFlBQXNDLEVBQUUsRUFBbUIsRUFBRTtZQUNqRyxNQUFNLFNBQVMsR0FBRztnQkFDaEIsUUFBUSxFQUFFLE9BQU87Z0JBQ2pCLElBQUksRUFBRSxPQUFPO2dCQUNiLFVBQVUsRUFBRSxLQUFLO2dCQUNqQixPQUFPLEVBQUUsRUFBRTtnQkFDWCxpQkFBaUIsRUFBRSxFQUFFO2dCQUNyQixxQkFBcUIsRUFBRSxJQUFJO2dCQUMzQiwrQkFBK0IsRUFBRSxJQUFJO2dCQUNyQyxjQUFjLEVBQUUsSUFBSTtnQkFDcEIsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRTtvQkFDZCxVQUFVLEVBQUUsTUFBTTtvQkFDbEIsWUFBWSxFQUFFLE9BQU87b0JBQ3JCLFVBQVUsRUFBRSxLQUFLO29CQUNqQixTQUFTLEVBQUUsY0FBYztvQkFDekIsS0FBSyxFQUFFLE1BQU07b0JBQ2IsUUFBUSxFQUFFO3dCQUNSLHFCQUFxQixFQUFFLElBQUk7d0JBQzNCLFNBQVMsRUFBRSxJQUFJO3dCQUNmLGlCQUFpQixFQUFFLElBQUk7d0JBQ3ZCLE1BQU0sRUFBRSxJQUFJO3dCQUNaLFFBQVEsRUFBRSxXQUFXO3dCQUNyQixjQUFjLEVBQUUsSUFBSTt3QkFDcEIsU0FBUyxFQUFFLElBQUk7d0JBQ2YseUJBQXlCLEVBQUUsSUFBSTt3QkFDL0IsNkJBQTZCLEVBQUUsSUFBSTt3QkFDbkMsT0FBTyxFQUFFLElBQUk7d0JBQ2IsU0FBUyxFQUFFLFlBQVk7d0JBQ3ZCLElBQUksRUFBRSxJQUFJO3dCQUNWLE1BQU0sRUFBRSxJQUFJO3dCQUNaLFFBQVEsRUFBRSxJQUFJO3dCQUNkLFVBQVUsRUFBRSxJQUFJO3FCQUNqQjtvQkFDRCxRQUFRLEVBQUUsVUFBVTtvQkFDcEIsV0FBVyxFQUFFLDRCQUE0QjtvQkFDekMsZ0JBQWdCLEVBQUUsYUFBYTtvQkFDL0IsS0FBSyxFQUFFLFVBQVU7aUJBQ2xCO2dCQUNELElBQUksRUFBRSxJQUFJO2dCQUNWLGVBQWUsRUFBRSxLQUFLO2FBQ0osQ0FBQztZQUVyQixPQUFPO2dCQUNMLEdBQUcsU0FBUztnQkFDWixHQUFHLFNBQVM7Z0JBQ1osY0FBYyxFQUFFO29CQUNkLEdBQUcsU0FBUyxDQUFDLGNBQWM7b0JBQzNCLEdBQUcsU0FBUyxDQUFDLGNBQWM7aUJBQzVCO2FBQ2lCLENBQUM7UUFDdkIsQ0FBQyxDQUFDO1FBRUYsRUFBRSxDQUFDLHlEQUF5RCxFQUFFLEdBQUcsRUFBRTtZQUNqRSxNQUFNLEtBQUssR0FBRyw0QkFBNEIsQ0FBQztnQkFDekMsT0FBTyxFQUFFO29CQUNQLFlBQVksRUFBRSx5QkFBeUI7aUJBQ3hDO2dCQUNELGNBQWMsRUFBRTtvQkFDZCxRQUFRLEVBQUU7d0JBQ1IsUUFBUSxFQUFFLGVBQWU7cUJBQzFCO29CQUNELFVBQVUsRUFBRTt3QkFDVixNQUFNLEVBQUU7NEJBQ04sR0FBRyxFQUFFLGNBQWM7NEJBQ25CLGtCQUFrQixFQUFFLFVBQVU7NEJBQzlCLGdCQUFnQixFQUFFLFlBQVk7NEJBQzlCLEtBQUssRUFBRSxrQkFBa0I7NEJBQ3pCLGNBQWMsRUFBRSxNQUFNOzRCQUN0QixpQkFBaUIsRUFBRSxZQUFZOzRCQUMvQixhQUFhLEVBQUUsU0FBUzt5QkFDekI7cUJBQ0Y7aUJBQ0s7YUFDVCxDQUFDLENBQUM7WUFFSCxNQUFNLE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztnQkFDaEMsU0FBUyxFQUFFLGFBQWE7Z0JBQ3hCLE9BQU8sRUFBRTtvQkFDUCxrQkFBa0IsRUFBRSxjQUFjO2lCQUNuQzthQUNGLENBQUMsQ0FBQztZQUVILE1BQU0sS0FBSyxHQUFJLFVBQWtCLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBRXRFLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQzFCLFNBQVMsRUFBRSxhQUFhO2dCQUN4QixRQUFRLEVBQUUsZUFBZTtnQkFDekIsU0FBUyxFQUFFLHlCQUF5QjtnQkFDcEMsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixPQUFPLEVBQUUsVUFBVTtnQkFDbkIsS0FBSyxFQUFFLGtCQUFrQjtnQkFDekIsYUFBYSxFQUFFLElBQUk7Z0JBQ25CLE9BQU8sRUFBRTtvQkFDUCxHQUFHLEVBQUUsY0FBYztvQkFDbkIsUUFBUSxFQUFFLFVBQVU7b0JBQ3BCLE1BQU0sRUFBRSxDQUFFLE9BQU8sRUFBRSxNQUFNLENBQUU7b0JBQzNCLGdCQUFnQixFQUFFO3dCQUNoQixRQUFRLEVBQUUsWUFBWTt3QkFDdEIsSUFBSSxFQUFFLFNBQVM7cUJBQ2hCO2lCQUNGO2FBQ0YsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLENBQUMsK0NBQStDLENBQUMsQ0FBQztRQUNuRixDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQywyRUFBMkUsRUFBRSxHQUFHLEVBQUU7WUFDbkYsTUFBTSxLQUFLLEdBQUcsNEJBQTRCLENBQUM7Z0JBQ3pDLGNBQWMsRUFBRTtvQkFDZCxRQUFRLEVBQUU7d0JBQ1IsUUFBUSxFQUFFLFVBQVU7d0JBQ3BCLE1BQU0sRUFBRSxnQkFBZ0I7d0JBQ3hCLFFBQVEsRUFBRSxZQUFZO3FCQUN2QjtpQkFDSzthQUNULENBQUMsQ0FBQztZQUVILE1BQU0sT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUNoQyxTQUFTLEVBQUUsYUFBYTthQUN6QixDQUFDLENBQUM7WUFFSCxNQUFNLEtBQUssR0FBSSxVQUFrQixDQUFDLG1CQUFtQixDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztZQUV0RSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUMxQixTQUFTLEVBQUUsYUFBYTtnQkFDeEIsUUFBUSxFQUFFLFVBQVU7Z0JBQ3BCLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixTQUFTLEVBQUUsU0FBUztnQkFDcEIsT0FBTyxFQUFFLG9CQUFvQjtnQkFDN0IsTUFBTSxFQUFFO29CQUNOLEVBQUUsRUFBRSxZQUFZO29CQUNoQixNQUFNLEVBQUUsaUJBQWlCO2lCQUMxQjthQUNGLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLGtFQUFrRSxFQUFFLEdBQUcsRUFBRTtZQUMxRSxNQUFNLEtBQUssR0FBRyw0QkFBNEIsQ0FBQztnQkFDekMsY0FBYyxFQUFFO29CQUNkLFFBQVEsRUFBRTt3QkFDUixRQUFRLEVBQUUsVUFBVTtxQkFDckI7aUJBQ0s7YUFDVCxDQUFDLENBQUM7WUFFSCxNQUFNLE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztnQkFDaEMsU0FBUyxFQUFFLG9CQUFvQjtnQkFDL0IsT0FBTyxFQUFFO29CQUNQLFdBQVcsRUFBRSx1QkFBdUI7aUJBQ3JDO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsTUFBTSxLQUFLLEdBQUksVUFBa0IsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFdEUsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDMUIsU0FBUyxFQUFFLG9CQUFvQjtnQkFDL0IsUUFBUSxFQUFFLFVBQVU7Z0JBQ3BCLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixTQUFTLEVBQUUsU0FBUztnQkFDcEIsT0FBTyxFQUFFLCtCQUErQjtnQkFDeEMsTUFBTSxFQUFFO29CQUNOLEVBQUUsRUFBRSx1QkFBdUI7b0JBQzNCLE1BQU0sRUFBRSxRQUFRO2lCQUNqQjthQUNGLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHVEQUF1RCxFQUFFLEdBQUcsRUFBRTtZQUMvRCxNQUFNLEtBQUssR0FBRyw0QkFBNEIsQ0FBQztnQkFDekMsY0FBYyxFQUFFO29CQUNkLFFBQVEsRUFBRTt3QkFDUixRQUFRLEVBQUUsVUFBVTt3QkFDcEIsTUFBTSxFQUFFLGlCQUFpQjtxQkFDMUI7aUJBQ0s7YUFDVCxDQUFDLENBQUM7WUFFSCxNQUFNLE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztnQkFDaEMsU0FBUyxFQUFFLG1CQUFtQjtnQkFDOUIsT0FBTyxFQUFFO29CQUNQLFdBQVcsRUFBRSxrQ0FBa0M7aUJBQ2hEO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsTUFBTSxLQUFLLEdBQUksVUFBa0IsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFdEUsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDMUIsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLE9BQU8sRUFBRSx5QkFBeUI7Z0JBQ2xDLE1BQU0sRUFBRTtvQkFDTixFQUFFLEVBQUUsaUJBQWlCO29CQUNyQixNQUFNLEVBQUUsaUJBQWlCO2lCQUMxQjthQUNGLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHFEQUFxRCxFQUFFLEdBQUcsRUFBRTtZQUM3RCxNQUFNLEtBQUssR0FBRyw0QkFBNEIsQ0FBQztnQkFDekMsY0FBYyxFQUFFO29CQUNkLFFBQVEsRUFBRTt3QkFDUixRQUFRLEVBQUUsWUFBWTt3QkFDdEIsT0FBTyxFQUFFLDZDQUE2Qzt3QkFDdEQsSUFBSSxFQUFFLHVCQUF1Qjt3QkFDN0IsU0FBUyxFQUFFLGNBQWM7d0JBQ3pCLE1BQU0sRUFBRSxXQUFXO3FCQUNwQjtpQkFDSzthQUNULENBQUMsQ0FBQztZQUVILE1BQU0sT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUNoQyxTQUFTLEVBQUUsYUFBYTthQUN6QixDQUFDLENBQUM7WUFFSCxNQUFNLEtBQUssR0FBSSxVQUFrQixDQUFDLG1CQUFtQixDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztZQUV0RSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUMxQixTQUFTLEVBQUUsYUFBYTtnQkFDeEIsUUFBUSxFQUFFLFlBQVk7Z0JBQ3RCLFVBQVUsRUFBRSxLQUFLO2dCQUNqQixTQUFTLEVBQUUsU0FBUztnQkFDcEIsT0FBTyxFQUFFLHVCQUF1QjtnQkFDaEMsR0FBRyxFQUFFO29CQUNILE9BQU8sRUFBRSw2Q0FBNkM7b0JBQ3RELE1BQU0sRUFBRSx1QkFBdUI7b0JBQy9CLFNBQVMsRUFBRSxjQUFjO29CQUN6QixNQUFNLEVBQUUsV0FBVztpQkFDcEI7YUFDRixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyw4Q0FBOEMsRUFBRSxHQUFHLEVBQUU7WUFDdEQsTUFBTSxLQUFLLEdBQUcsNEJBQTRCLENBQUM7Z0JBQ3pDLGNBQWMsRUFBRTtvQkFDZCxRQUFRLEVBQUU7d0JBQ1IsUUFBUSxFQUFFLGFBQWE7cUJBQ3hCO2lCQUNLO2FBQ1QsQ0FBQyxDQUFDO1lBRUgsTUFBTSxPQUFPLEdBQUcsaUJBQWlCLENBQUM7Z0JBQ2hDLFNBQVMsRUFBRSxhQUFhO2FBQ3pCLENBQUMsQ0FBQztZQUVILE1BQU0sS0FBSyxHQUFJLFVBQWtCLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBRXRFLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQzFCLFNBQVMsRUFBRSxhQUFhO2dCQUN4QixRQUFRLEVBQUUsYUFBYTtnQkFDdkIsVUFBVSxFQUFFLFdBQVc7Z0JBQ3ZCLFNBQVMsRUFBRSxXQUFXO2dCQUN0QixPQUFPLEVBQUUsV0FBVzthQUNyQixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyw2RUFBNkUsRUFBRSxHQUFHLEVBQUU7WUFDckYsTUFBTSxLQUFLLEdBQUcsNEJBQTRCLENBQUM7Z0JBQ3pDLE9BQU8sRUFBRTtvQkFDUCxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxpQkFBaUIsRUFBRSxLQUFLLEVBQUUsa0JBQWtCLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLENBQUM7aUJBQ3pIO2dCQUNELGNBQWMsRUFBRTtvQkFDZCxRQUFRLEVBQUU7d0JBQ1IsUUFBUSxFQUFFLFlBQVk7d0JBQ3RCLE9BQU8sRUFBRSxtREFBbUQ7d0JBQzVELElBQUksRUFBRSx1QkFBdUI7cUJBQzlCO2lCQUNLO2FBQ1QsQ0FBQyxDQUFDO1lBRUgsTUFBTSxPQUFPLEdBQUcsaUJBQWlCLENBQUMsRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUUsQ0FBQyxDQUFDO1lBQ3BFLE1BQU0sS0FBSyxHQUFJLFVBQWtCLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBRXRFLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQzFCLFVBQVUsRUFBRSxLQUFLO2dCQUNqQixvRkFBb0Y7Z0JBQ3BGLDJGQUEyRjtnQkFDM0YsT0FBTyxFQUFFLHVCQUF1QjtnQkFDaEMsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLG1CQUFtQixFQUFFLElBQUk7Z0JBQ3pCLHFCQUFxQixFQUFFLGlCQUFpQjtnQkFDeEMsS0FBSyxFQUFFLGtCQUFrQjtnQkFDekIsSUFBSSxFQUFFLE9BQU87Z0JBQ2IsUUFBUSxFQUFFLFVBQVU7Z0JBQ3BCLE9BQU8sRUFBRSxFQUFFLEdBQUcsRUFBRSxpQkFBaUIsRUFBRTthQUNwQyxDQUFDLENBQUM7WUFDSCwyRUFBMkU7WUFDM0UsdUVBQXVFO1lBQ3ZFLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxtREFBbUQsQ0FBQyxDQUFDO1FBQ3ZGLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHNFQUFzRSxFQUFFLEdBQUcsRUFBRTtZQUM5RSxNQUFNLEtBQUssR0FBRyw0QkFBNEIsQ0FBQztnQkFDekMsT0FBTyxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLENBQUMsRUFBRTtnQkFDekQsY0FBYyxFQUFFLEVBQUUsUUFBUSxFQUFFLEVBQUUsUUFBUSxFQUFFLGFBQWEsRUFBRSxFQUFTO2FBQ2pFLENBQUMsQ0FBQztZQUVILE1BQU0sT0FBTyxHQUFHLGlCQUFpQixDQUFDLEVBQUUsU0FBUyxFQUFFLGdCQUFnQixFQUFFLENBQUMsQ0FBQztZQUNuRSxNQUFNLEtBQUssR0FBSSxVQUFrQixDQUFDLG1CQUFtQixDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztZQUV0RSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUMxQixVQUFVLEVBQUUsV0FBVztnQkFDdkIsd0ZBQXdGO2dCQUN4RixPQUFPLEVBQUUsV0FBVztnQkFDcEIsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLG1CQUFtQixFQUFFLElBQUk7Z0JBQ3pCLHFCQUFxQixFQUFFLFNBQVM7YUFDakMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsMkRBQTJELEVBQUUsR0FBRyxFQUFFO1lBQ25FLE1BQU0sS0FBSyxHQUFHLDRCQUE0QixDQUFDO2dCQUN6QyxPQUFPLEVBQUUsRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUU7Z0JBQ3pDLGNBQWMsRUFBRSxFQUFFLFFBQVEsRUFBRSxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUUsRUFBUzthQUNqRSxDQUFDLENBQUM7WUFFSCxNQUFNLE9BQU8sR0FBRyxpQkFBaUIsQ0FBQyxFQUFFLFNBQVMsRUFBRSxzQkFBc0IsRUFBRSxDQUFDLENBQUM7WUFDekUsTUFBTSxLQUFLLEdBQUksVUFBa0IsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFdEUsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDMUIsVUFBVSxFQUFFLFdBQVc7Z0JBQ3ZCLE9BQU8sRUFBRSxXQUFXO2FBQ3JCLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNsRCxNQUFNLENBQUMsS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDdEQsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsK0RBQStELEVBQUUsR0FBRyxFQUFFO1lBQ3ZFLE1BQU0sS0FBSyxHQUFHLDRCQUE0QixDQUFDO2dCQUN6QyxPQUFPLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxtQkFBbUIsRUFBRSxDQUFDLEVBQUU7Z0JBQ3RFLGNBQWMsRUFBRSxFQUFFLFFBQVEsRUFBRSxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUUsRUFBUzthQUNqRSxDQUFDLENBQUM7WUFFSCxNQUFNLE9BQU8sR0FBRyxpQkFBaUIsQ0FBQyxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBRSxDQUFDLENBQUM7WUFDcEUsTUFBTSxLQUFLLEdBQUksVUFBa0IsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFdEUsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDeEMsTUFBTSxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ2xELE1BQU0sQ0FBQyxLQUFLLENBQUMscUJBQXFCLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUN0RCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyxxRkFBcUYsRUFBRSxHQUFHLEVBQUU7WUFDN0YsTUFBTSxLQUFLLEdBQUcsNEJBQTRCLENBQUM7Z0JBQ3pDLE9BQU8sRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsRUFBRSxFQUFFLFlBQVksRUFBRSxDQUFDLEVBQUU7Z0JBQzVELGNBQWMsRUFBRTtvQkFDZCxVQUFVLEVBQUU7d0JBQ1YsTUFBTSxFQUFFOzRCQUNOLEdBQUcsRUFBRSxrQkFBa0I7NEJBQ3ZCLGtCQUFrQixFQUFFLFdBQVc7eUJBQ2hDO3FCQUNGO2lCQUNLO2FBQ1QsQ0FBQyxDQUFDO1lBRUgsTUFBTSxPQUFPLEdBQUcsaUJBQWlCLENBQUMsRUFBRSxTQUFTLEVBQUUseUJBQXlCLEVBQUUsQ0FBQyxDQUFDO1lBQzVFLE1BQU0sS0FBSyxHQUFJLFVBQWtCLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBRXRFLE1BQU0sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQ3pDLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBQ3hDLE1BQU0sQ0FBQyxLQUFLLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNsRCxNQUFNLENBQUMsS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDdEQsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsMkNBQTJDLEVBQUUsR0FBRyxFQUFFO1lBQ25ELE1BQU0sS0FBSyxHQUFHLDRCQUE0QixDQUFDO2dCQUN6QyxjQUFjLEVBQUU7b0JBQ2QsVUFBVSxFQUFFO3dCQUNWLE1BQU0sRUFBRTs0QkFDTixHQUFHLEVBQUUscUJBQXFCOzRCQUMxQixrQkFBa0IsRUFBRSxnQkFBZ0I7NEJBQ3BDLGdCQUFnQixFQUFFLElBQUksRUFBRSxtQkFBbUI7NEJBQzNDLGNBQWMsRUFBRSxlQUFlLEVBQUUsa0JBQWtCOzRCQUNuRCxrQkFBa0IsRUFBRSxtQkFBbUIsQ0FBQyxrQ0FBa0M7eUJBQzNFO3FCQUNGO2lCQUNLO2FBQ1QsQ0FBQyxDQUFDO1lBRUgsTUFBTSxPQUFPLEdBQUcsaUJBQWlCLENBQUM7Z0JBQ2hDLFNBQVMsRUFBRSxzQkFBc0I7YUFDbEMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxLQUFLLEdBQUksVUFBa0IsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFdEUsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDMUIsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixPQUFPLEVBQUUsZ0JBQWdCO2dCQUN6QixhQUFhLEVBQUUsS0FBSyxFQUFFLDhDQUE4QztnQkFDcEUsT0FBTyxFQUFFO29CQUNQLEdBQUcsRUFBRSxxQkFBcUI7b0JBQzFCLFFBQVEsRUFBRSxnQkFBZ0I7b0JBQzFCLE1BQU0sRUFBRSxFQUFFLEVBQUUsd0NBQXdDO29CQUNwRCxnQkFBZ0IsRUFBRSxFQUFFLENBQUMsNENBQTRDO2lCQUNsRTthQUNGLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLGtEQUFrRCxFQUFFLEdBQUcsRUFBRTtZQUMxRCxNQUFNLEtBQUssR0FBRyw0QkFBNEIsQ0FBQztnQkFDekMsT0FBTyxFQUFFLEVBQUUsRUFBRSxnQkFBZ0I7Z0JBQzdCLGNBQWMsRUFBRTtvQkFDZCxRQUFRLEVBQUU7d0JBQ1IsUUFBUSxFQUFFLFNBQVMsQ0FBQyxlQUFlO3FCQUNwQztpQkFDSzthQUNULENBQUMsQ0FBQztZQUVILE1BQU0sT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUNoQyxTQUFTLEVBQUUsYUFBYTtnQkFDeEIsT0FBTyxFQUFFLEVBQUUsQ0FBQyxvQkFBb0I7YUFDakMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxLQUFLLEdBQUksVUFBa0IsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFdEUsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDMUIsU0FBUyxFQUFFLGFBQWE7Z0JBQ3hCLFFBQVEsRUFBRSxTQUFTO2dCQUNuQixTQUFTLEVBQUUsU0FBUztnQkFDcEIsVUFBVSxFQUFFLFdBQVc7Z0JBQ3ZCLFNBQVMsRUFBRSxXQUFXO2dCQUN0QixPQUFPLEVBQUUsV0FBVzthQUNyQixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyx5REFBeUQsRUFBRSxHQUFHLEVBQUU7WUFDakUsTUFBTSxLQUFLLEdBQUcsNEJBQTRCLENBQUM7Z0JBQ3pDLGNBQWMsRUFBRTtvQkFDZCxVQUFVLEVBQUU7d0JBQ1YsTUFBTSxFQUFFOzRCQUNOLEdBQUcsRUFBRSxjQUFjOzRCQUNuQixrQkFBa0IsRUFBRSxvQkFBb0I7eUJBQ3pDO3FCQUNGO2lCQUNLO2FBQ1QsQ0FBQyxDQUFDO1lBRUgsTUFBTSxPQUFPLEdBQUcsaUJBQWlCLENBQUM7Z0JBQ2hDLFNBQVMsRUFBRSxhQUFhO2FBQ3pCLENBQUMsQ0FBQztZQUVILE1BQU0sS0FBSyxHQUFJLFVBQWtCLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBRXRFLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLENBQUM7WUFDakQsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ2xELENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHFFQUFxRSxFQUFFLEdBQUcsRUFBRTtZQUM3RSxNQUFNLEtBQUssR0FBRyw0QkFBNEIsQ0FBQztnQkFDekMsY0FBYyxFQUFFO29CQUNkLFVBQVUsRUFBRTt3QkFDVixNQUFNLEVBQUU7NEJBQ04sR0FBRyxFQUFFLGNBQWM7NEJBQ25CLEtBQUssRUFBRSxzQkFBc0I7eUJBQzlCO3FCQUNGO2lCQUNLO2FBQ1QsQ0FBQyxDQUFDO1lBRUgsTUFBTSxPQUFPLEdBQUcsaUJBQWlCLENBQUM7Z0JBQ2hDLFNBQVMsRUFBRSxhQUFhO2FBQ3pCLENBQUMsQ0FBQztZQUVILE1BQU0sS0FBSyxHQUFJLFVBQWtCLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBRXRFLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLENBQUM7WUFDbkQsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ2xELENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHlDQUF5QyxFQUFFLEdBQUcsRUFBRTtZQUNqRCxNQUFNLFNBQVMsR0FBRztnQkFDaEI7b0JBQ0UsSUFBSSxFQUFFLGNBQWM7b0JBQ3BCLE1BQU0sRUFBRSxPQUFPO29CQUNmLFFBQVEsRUFBRSxDQUFFLE9BQU8sQ0FBRTtpQkFDdEI7Z0JBQ0Q7b0JBQ0UsSUFBSSxFQUFFLDZCQUE2QjtvQkFDbkMsTUFBTSxFQUFFLDRCQUE0QjtvQkFDcEMsUUFBUSxFQUFFLENBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxXQUFXLENBQUU7aUJBQzNDO2dCQUNEO29CQUNFLElBQUksRUFBRSxvQkFBb0I7b0JBQzFCLE1BQU0sRUFBRSxFQUFFO29CQUNWLFFBQVEsRUFBRSxFQUFFO2lCQUNiO2dCQUNEO29CQUNFLElBQUksRUFBRSwwQkFBMEI7b0JBQ2hDLE1BQU0sRUFBRSxjQUFjO29CQUN0QixRQUFRLEVBQUUsQ0FBRSxPQUFPLEVBQUUsTUFBTSxDQUFFO2lCQUM5QjthQUNGLENBQUM7WUFFRixTQUFTLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxFQUFFLEVBQUU7Z0JBQy9DLE1BQU0sS0FBSyxHQUFHLDRCQUE0QixDQUFDO29CQUN6QyxjQUFjLEVBQUU7d0JBQ2QsVUFBVSxFQUFFOzRCQUNWLE1BQU0sRUFBRTtnQ0FDTixHQUFHLEVBQUUsa0JBQWtCO2dDQUN2QixrQkFBa0IsRUFBRSxhQUFhO2dDQUNqQyxnQkFBZ0IsRUFBRSxNQUFNOzZCQUN6Qjt5QkFDRjtxQkFDSztpQkFDVCxDQUFDLENBQUM7Z0JBRUgsTUFBTSxPQUFPLEdBQUcsaUJBQWlCLENBQUM7b0JBQ2hDLFNBQVMsRUFBRSxjQUFjLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxFQUFFO2lCQUNyRCxDQUFDLENBQUM7Z0JBRUgsTUFBTSxLQUFLLEdBQUksVUFBa0IsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7Z0JBRXRFLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUNsRCxDQUFDLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLCtDQUErQyxFQUFFLEdBQUcsRUFBRTtZQUN2RCxNQUFNLEtBQUssR0FBRyw0QkFBNEIsQ0FBQztnQkFDekMsY0FBYyxFQUFFO29CQUNkLFVBQVUsRUFBRTt3QkFDVixNQUFNLEVBQUU7NEJBQ04sR0FBRyxFQUFFLHdCQUF3Qjs0QkFDN0Isa0JBQWtCLEVBQUUsYUFBYTs0QkFDakMsbUJBQW1CLEVBQUUsYUFBYTs0QkFDbEMsYUFBYSxFQUFFLGtCQUFrQjs0QkFDakMsbUJBQW1CLEVBQUUsYUFBYTt5QkFDbkM7cUJBQ0Y7aUJBQ0s7YUFDVCxDQUFDLENBQUM7WUFFSCxNQUFNLE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztnQkFDaEMsU0FBUyxFQUFFLGtCQUFrQjthQUM5QixDQUFDLENBQUM7WUFFSCxNQUFNLEtBQUssR0FBSSxVQUFrQixDQUFDLG1CQUFtQixDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztZQUV0RSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUMxQixVQUFVLEVBQUUsU0FBUztnQkFDckIsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLE9BQU8sRUFBRSxhQUFhO2dCQUN0QixPQUFPLEVBQUU7b0JBQ1AsR0FBRyxFQUFFLHdCQUF3QjtvQkFDN0IsUUFBUSxFQUFFLGFBQWE7b0JBQ3ZCLGdCQUFnQixFQUFFO3dCQUNoQixVQUFVLEVBQUUsYUFBYTt3QkFDekIsSUFBSSxFQUFFLGtCQUFrQjt3QkFDeEIsVUFBVSxFQUFFLGFBQWE7cUJBQzFCO2lCQUNGO2FBQ0YsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsOENBQThDLEVBQUUsR0FBRyxFQUFFO1lBQ3RELE1BQU0sS0FBSyxHQUFHLDRCQUE0QixDQUFDO2dCQUN6QyxjQUFjLEVBQUU7b0JBQ2QsVUFBVSxFQUFFO3dCQUNWLE1BQU0sRUFBRTs0QkFDTixHQUFHLEVBQUUseUJBQXlCOzRCQUM5QixnQ0FBZ0M7eUJBQ2pDO3FCQUNGO2lCQUNLO2FBQ1QsQ0FBQyxDQUFDO1lBRUgsTUFBTSxPQUFPLEdBQUcsaUJBQWlCLENBQUM7Z0JBQ2hDLFNBQVMsRUFBRSxrQkFBa0I7YUFDOUIsQ0FBQyxDQUFDO1lBRUgsTUFBTSxLQUFLLEdBQUksVUFBa0IsQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFdEUsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsQ0FBQztZQUN0RCxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsQ0FBQztRQUM3RCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyxtREFBbUQsRUFBRSxHQUFHLEVBQUU7WUFDM0QsTUFBTSxTQUFTLEdBQUc7Z0JBQ2hCO29CQUNFLElBQUksRUFBRSxnQkFBZ0I7b0JBQ3RCLFlBQVksRUFBRSxhQUFhO29CQUMzQixxQkFBcUIsRUFBRSxNQUFNO29CQUM3QixnQkFBZ0IsRUFBRSxJQUFJO2lCQUN2QjtnQkFDRDtvQkFDRSxJQUFJLEVBQUUsa0JBQWtCO29CQUN4QixZQUFZLEVBQUUsYUFBYTtvQkFDM0IscUJBQXFCLEVBQUUsT0FBTztvQkFDOUIsZ0JBQWdCLEVBQUUsS0FBSztpQkFDeEI7Z0JBQ0Q7b0JBQ0UsSUFBSSxFQUFFLGlDQUFpQztvQkFDdkMsWUFBWSxFQUFFLGFBQWE7b0JBQzNCLHFCQUFxQixFQUFFLFNBQVM7b0JBQ2hDLGdCQUFnQixFQUFFLEtBQUs7aUJBQ3hCO2FBQ0YsQ0FBQztZQUVGLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxFQUFFLElBQUksRUFBRSxZQUFZLEVBQUUscUJBQXFCLEVBQUUsZ0JBQWdCLEVBQUUsRUFBRSxFQUFFO2dCQUNwRixNQUFNLE1BQU0sR0FBUTtvQkFDbEIsR0FBRyxFQUFFLGlCQUFpQjtvQkFDdEIsa0JBQWtCLEVBQUUsWUFBWTtvQkFDaEMsWUFBWTtpQkFDYixDQUFDO2dCQUVGLElBQUkscUJBQXFCLEtBQUssU0FBUyxFQUFFLENBQUM7b0JBQ3hDLE1BQU0sQ0FBQyxxQkFBcUIsR0FBRyxxQkFBcUIsQ0FBQztnQkFDdkQsQ0FBQztnQkFFRCxNQUFNLEtBQUssR0FBRyw0QkFBNEIsQ0FBQztvQkFDekMsY0FBYyxFQUFFO3dCQUNkLFVBQVUsRUFBRSxFQUFFLE1BQU0sRUFBRTtxQkFDaEI7aUJBQ1QsQ0FBQyxDQUFDO2dCQUVILE1BQU0sT0FBTyxHQUFHLGlCQUFpQixDQUFDO29CQUNoQyxTQUFTLEVBQUUsYUFBYSxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxHQUFHLENBQUMsRUFBRTtpQkFDcEQsQ0FBQyxDQUFDO2dCQUVILE1BQU0sS0FBSyxHQUFJLFVBQWtCLENBQUMsbUJBQW1CLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO2dCQUV0RSxNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztnQkFDN0MsTUFBTSxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztZQUNyRCxDQUFDLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsc0JBQXNCLEVBQUUsR0FBRyxFQUFFO1FBQ3BDLEVBQUUsQ0FBQywyQ0FBMkMsRUFBRSxHQUFHLEVBQUU7WUFDbkQsTUFBTSxVQUFVLEdBQUcsSUFBSSxjQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7WUFFMUMsTUFBTSwwQkFBMEIsR0FBRyxDQUFDLFlBQXNDLEVBQUUsRUFBbUIsRUFBRTtnQkFDL0YsTUFBTSxTQUFTLEdBQUc7b0JBQ2hCLFFBQVEsRUFBRSxPQUFPO29CQUNqQixJQUFJLEVBQUUsT0FBTztvQkFDYixVQUFVLEVBQUUsS0FBSztvQkFDakIsT0FBTyxFQUFFLEVBQUU7b0JBQ1gsaUJBQWlCLEVBQUUsRUFBRTtvQkFDckIscUJBQXFCLEVBQUUsSUFBSTtvQkFDM0IsK0JBQStCLEVBQUUsSUFBSTtvQkFDckMsY0FBYyxFQUFFLElBQUk7b0JBQ3BCLGNBQWMsRUFBRSxJQUFJO29CQUNwQixjQUFjLEVBQUU7d0JBQ2QsVUFBVSxFQUFFLE1BQU07d0JBQ2xCLFlBQVksRUFBRSxPQUFPO3dCQUNyQixVQUFVLEVBQUUsS0FBSzt3QkFDakIsU0FBUyxFQUFFLGNBQWM7d0JBQ3pCLEtBQUssRUFBRSxNQUFNO3dCQUNiLFFBQVEsRUFBRTs0QkFDUixxQkFBcUIsRUFBRSxJQUFJOzRCQUMzQixTQUFTLEVBQUUsSUFBSTs0QkFDZixpQkFBaUIsRUFBRSxJQUFJOzRCQUN2QixNQUFNLEVBQUUsSUFBSTs0QkFDWixRQUFRLEVBQUUsV0FBVzs0QkFDckIsY0FBYyxFQUFFLElBQUk7NEJBQ3BCLFNBQVMsRUFBRSxJQUFJOzRCQUNmLHlCQUF5QixFQUFFLElBQUk7NEJBQy9CLDZCQUE2QixFQUFFLElBQUk7NEJBQ25DLE9BQU8sRUFBRSxJQUFJOzRCQUNiLFNBQVMsRUFBRSxZQUFZOzRCQUN2QixJQUFJLEVBQUUsSUFBSTs0QkFDVixNQUFNLEVBQUUsSUFBSTs0QkFDWixRQUFRLEVBQUUsSUFBSTs0QkFDZCxVQUFVLEVBQUUsSUFBSTt5QkFDakI7d0JBQ0QsUUFBUSxFQUFFLFVBQVU7d0JBQ3BCLFdBQVcsRUFBRSw0QkFBNEI7d0JBQ3pDLGdCQUFnQixFQUFFLGFBQWE7d0JBQy9CLEtBQUssRUFBRSxVQUFVO3FCQUNsQjtvQkFDRCxJQUFJLEVBQUUsSUFBSTtvQkFDVixlQUFlLEVBQUUsS0FBSztpQkFDSixDQUFDO2dCQUVyQixPQUFPO29CQUNMLEdBQUcsU0FBUztvQkFDWixHQUFHLFNBQVM7b0JBQ1osY0FBYyxFQUFFO3dCQUNkLEdBQUcsU0FBUyxDQUFDLGNBQWM7d0JBQzNCLEdBQUcsU0FBUyxDQUFDLGNBQWM7cUJBQzVCO2lCQUNpQixDQUFDO1lBQ3ZCLENBQUMsQ0FBQztZQUVGLE1BQU0sS0FBSyxHQUFHLDBCQUEwQixDQUFDO2dCQUN2QyxjQUFjLEVBQUU7b0JBQ2QsVUFBVSxFQUFFO3dCQUNWLE1BQU0sRUFBRTs0QkFDTixHQUFHLEVBQUUsVUFBVTs0QkFDZixrQkFBa0IsRUFBRSxXQUFXO3lCQUNoQztxQkFDRjtpQkFDSzthQUNULENBQUMsQ0FBQztZQUVILE1BQU0sT0FBTyxHQUFHLEVBQWEsQ0FBQztZQUM5QixNQUFNLE9BQU8sR0FBRyxpQkFBaUIsQ0FBQztnQkFDaEMsU0FBUyxFQUFFLGNBQWM7YUFDMUIsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxRQUFRLEdBQUcsRUFBRSxDQUFDO1lBRXBCLE1BQU0sZ0JBQWdCLEdBQUcsVUFBVSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQztZQUVwRixNQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQ3JDLEtBQUs7Z0JBQ0wsYUFBYSxFQUFFLE9BQU87Z0JBQ3RCLE9BQU87Z0JBQ1AsUUFBUTtnQkFDUixTQUFTLEVBQUUsRUFBRTthQUNkLENBQUMsQ0FBQztZQUVILE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQzNDLFNBQVMsRUFBRSxjQUFjO2dCQUN6QixVQUFVLEVBQUUsU0FBUztnQkFDckIsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixPQUFPLEVBQUU7b0JBQ1AsR0FBRyxFQUFFLFVBQVU7b0JBQ2YsUUFBUSxFQUFFLFdBQVc7aUJBQ3RCO2FBQ0YsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQVBJQ29udHJvbGxlciB9IGZyb20gJy4vYXBpLWdhdGV3YXktY29udHJvbGxlcic7XG5pbXBvcnQgdHlwZSB7IFJlcXVlc3QgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzJztcbmltcG9ydCB0eXBlIHsgQVBJR2F0ZXdheUV2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5cbi8vIENyZWF0ZSBhIHRlc3QgY29udHJvbGxlciBjbGFzc1xuY2xhc3MgVGVzdENvbnRyb2xsZXIgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgcHVibGljIGNvbnRyb2xsZXJOYW1lID0gJ3Rlc3QnO1xuICBwdWJsaWMgcm91dGVzID0ge307XG5cbiAgY29uc3RydWN0b3Iocm91dGVzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJvdXRlcyA9IHJvdXRlcztcbiAgfVxuXG4gIC8vIEV4cG9zZSBwcml2YXRlIG1ldGhvZHMgZm9yIHRlc3RpbmdcbiAgcHVibGljIHRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0RGF0YTogUmVxdWVzdCkge1xuICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3REYXRhKTtcbiAgfVxuXG4gIHB1YmxpYyB0ZXN0R2V0Um91dGVGdW5jdGlvbihyb3V0ZTogYW55KSB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuZ2V0Um91dGVGdW5jdGlvbihyb3V0ZSk7XG4gIH1cblxuICBwdWJsaWMgdGVzdEV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUocGhhc2U6IHN0cmluZywgcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IGFueSwgY3R4PzogYW55LCBlcnJvcj86IEVycm9yKSB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuZXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZShwaGFzZSwgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCwgZXJyb3IpO1xuICB9XG5cbiAgcHVibGljIHRlc3RIYW5kbGVSZXNwb25zZShyZXM6IGFueSkge1xuICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmhhbmRsZVJlc3BvbnNlKHJlcyk7XG4gIH1cblxuICBwdWJsaWMgdGVzdEhhbmRsZUV4Y2VwdGlvbihyZXE6IFJlcXVlc3QsIGVycjogRXJyb3IsIHJlczogYW55KSB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuaGFuZGxlRXhjZXB0aW9uKHJlcSwgZXJyLCByZXMpO1xuICB9XG5cbiAgcHVibGljIHRlc3RCdWlsZEN0eChldmVudDogQVBJR2F0ZXdheUV2ZW50LCBjb250ZXh0OiBDb250ZXh0LCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogYW55KSB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuYnVpbGRDdHgoZXZlbnQsIGNvbnRleHQsIHJlcXVlc3QsIHJlc3BvbnNlKTtcbiAgfVxuXG4gIC8vIEV4cG9zZSBtaWRkbGV3YXJlIHJlZ2lzdHJhdGlvbiBmb3IgdGVzdGluZ1xuICBwdWJsaWMgdGVzdFVzZU1pZGRsZXdhcmUobWlkZGxld2FyZTogYW55KSB7XG4gICAgdGhpcy51c2VNaWRkbGV3YXJlKG1pZGRsZXdhcmUpO1xuICB9XG5cbiAgLy8gRXhwb3NlIHByb3RlY3RlZCBtZXRob2RzIGZvciB0ZXN0aW5nXG4gIHB1YmxpYyB0ZXN0SGFuZGxlTm90Rm91bmQocmVxOiBSZXF1ZXN0KSB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlTm90Rm91bmQocmVxKTtcbiAgfVxuXG4gIC8vIFRlc3QgaGFuZGxlciBtZXRob2RzXG4gIHB1YmxpYyB0ZXN0SGFuZGxlcigpIHtcbiAgICByZXR1cm4geyBtZXNzYWdlOiAndGVzdCBoYW5kbGVyIGNhbGxlZCcgfTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyB0ZXN0QXN5bmNIYW5kbGVyKCkge1xuICAgIHJldHVybiB7IG1lc3NhZ2U6ICdhc3luYyB0ZXN0IGhhbmRsZXIgY2FsbGVkJyB9O1xuICB9XG5cbiAgcHVibGljIHRlc3RIYW5kbGVyV2l0aEVycm9yKCkge1xuICAgIHRocm93IG5ldyBFcnJvcignVGVzdCBoYW5kbGVyIGVycm9yJyk7XG4gIH1cblxuICAvLyBSZXF1aXJlZCBhYnN0cmFjdCBtZXRob2RcbiAgYXN5bmMgaW5pdGlhbGl6ZShfZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBOby1vcCBmb3IgdGVzdGluZ1xuICB9XG59XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byBjcmVhdGUgbW9jayBSZXF1ZXN0IG9iamVjdHNcbmZ1bmN0aW9uIGNyZWF0ZU1vY2tSZXF1ZXN0KG92ZXJyaWRlczogUGFydGlhbDxSZXF1ZXN0PiA9IHt9KTogUmVxdWVzdCB7XG4gIGNvbnN0IG1vY2tFdmVudCA9IHt9IGFzIEFQSUdhdGV3YXlFdmVudDtcbiAgY29uc3QgbW9ja0NvbnRleHQgPSB7fSBhcyBDb250ZXh0O1xuXG4gIHJldHVybiB7XG4gICAgZXZlbnQ6IG1vY2tFdmVudCxcbiAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxuICAgIGNvbnRleHQ6IG1vY2tDb250ZXh0LFxuICAgIHJlc291cmNlOiAnL3Rlc3QnLFxuICAgIGJvZHk6IHt9LFxuICAgIHBhdGg6ICcvdGVzdCcsXG4gICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7fSxcbiAgICBoZWFkZXJzOiB7fSxcbiAgICByZXF1ZXN0Q29udGV4dDoge30sXG4gICAgc3RhZ2VWYXJpYWJsZXM6IHt9LFxuICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxuICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgIGRlYnVnTW9kZTogZmFsc2UsXG4gICAgZ2V0UGFyYW06IGplc3QuZm4oKSxcbiAgICBoYXNQYXJhbTogamVzdC5mbigpLFxuICAgIGdldEhlYWRlcjogamVzdC5mbigpLFxuICAgIGhhc0hlYWRlcjogamVzdC5mbigpLFxuICAgIGdldFBhdGhQYXJhbTogamVzdC5mbigpLFxuICAgIGhhc1BhdGhQYXJhbTogamVzdC5mbigpLFxuICAgIGdldFF1ZXJ5UGFyYW06IGplc3QuZm4oKSxcbiAgICBoYXNRdWVyeVBhcmFtOiBqZXN0LmZuKCksXG4gICAgZ2V0Qm9keVBhcmFtOiBqZXN0LmZuKCksXG4gICAgaGFzQm9keVBhcmFtOiBqZXN0LmZuKCksXG4gICAgLi4ub3ZlcnJpZGVzLFxuICB9O1xufVxuXG5kZXNjcmliZSgnQVBJR2F0ZXdheUNvbnRyb2xsZXIgUm91dGUgTWF0Y2hpbmcnLCAoKSA9PiB7XG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xuICB9KTtcblxuICBkZXNjcmliZSgnZmluZE1hdGNoaW5nUm91dGUgLSBDb3JlIEZ1bmN0aW9uYWxpdHknLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29tcHJlaGVuc2l2ZSByb3V0ZSBtYXRjaGluZyBzY2VuYXJpb3MnLCAoKSA9PiB7XG4gICAgICBjb25zdCByb3V0ZXMgPSB7XG4gICAgICAgIC8vIEV4YWN0IHJvdXRlc1xuICAgICAgICAnR0VUfC8nOiB7IGhhbmRsZXI6ICdpbmRleCcgfSxcbiAgICAgICAgJ0dFVHwvdXNlcnMnOiB7IGhhbmRsZXI6ICdsaXN0VXNlcnMnIH0sXG4gICAgICAgICdQT1NUfC91c2Vycyc6IHsgaGFuZGxlcjogJ2NyZWF0ZVVzZXInIH0sXG5cbiAgICAgICAgLy8gU2luZ2xlIHBhcmFtZXRlclxuICAgICAgICAnR0VUfC97aWR9JzogeyBoYW5kbGVyOiAnZ2V0QnlJZCcgfSxcbiAgICAgICAgJ0RFTEVURXwve2lkfSc6IHsgaGFuZGxlcjogJ2RlbGV0ZUJ5SWQnIH0sXG5cbiAgICAgICAgLy8gTXVsdGlwbGUgcGFyYW1ldGVycyAgXG4gICAgICAgICdHRVR8L3thYmN9L3tkZWZ9L3t4eXp9JzogeyBoYW5kbGVyOiAnZ2V0VHJpcGxlUGFyYW1zJyB9LFxuICAgICAgICAnR0VUfC91c2Vycy97dXNlcklkfS9wb3N0cy97cG9zdElkfSc6IHsgaGFuZGxlcjogJ2dldFVzZXJQb3N0JyB9LFxuXG4gICAgICAgIC8vIE1peGVkIHN0YXRpYy9keW5hbWljXG4gICAgICAgICdHRVR8L3RlYW1zL3t0ZWFtSWR9L2NhdGVnb3JpZXMve2NhdGVnb3J5SWR9L3Bvc3RzL3twb3N0SWR9JzogeyBoYW5kbGVyOiAnZ2V0VGVhbUNhdGVnb3J5UG9zdCcgfSxcblxuICAgICAgICAvLyBQcmlvcml0aXphdGlvbiB0ZXN0IHJvdXRlc1xuICAgICAgICAnR0VUfC97cmVzb3VyY2V9JzogeyBoYW5kbGVyOiAnZ2V0UmVzb3VyY2UnIH0sXG4gICAgICAgICdHRVR8L3tjYXRlZ29yeX0ve2FjdGlvbn0nOiB7IGhhbmRsZXI6ICdnZXRDYXRlZ29yeUFjdGlvbicgfSxcbiAgICAgICAgJ0dFVHwvdXNlcnMve3VzZXJJZH0nOiB7IGhhbmRsZXI6ICdnZXRVc2VyQnlJZCcgfSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIocm91dGVzKTtcblxuICAgICAgLy8gVGVzdCBleGFjdCByb3V0ZSBtYXRjaGluZ1xuICAgICAgbGV0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0LycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2luZGV4JyB9KTtcblxuICAgICAgLy8gVGVzdCBzaW5nbGUgcGFyYW1ldGVyXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC8xMjMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJzEyMycgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldEJ5SWQnIH0pO1xuXG4gICAgICAvLyBUZXN0IG11bHRpcGxlIHBhcmFtZXRlcnNcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L3ZhbDEvdmFsMi92YWwzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgYWJjOiAndmFsMScsIGRlZjogJ3ZhbDInLCB4eXo6ICd2YWwzJyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0VHJpcGxlUGFyYW1zJyB9KTtcblxuICAgICAgLy8gVGVzdCBjb21wbGV4IG5lc3RlZCByb3V0ZVxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdGVhbXMvdGVhbS0xL2NhdGVnb3JpZXMvbmV3cy9wb3N0cy9wb3N0LTEyMycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IHRlYW1JZDogJ3RlYW0tMScsIGNhdGVnb3J5SWQ6ICduZXdzJywgcG9zdElkOiAncG9zdC0xMjMnIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRUZWFtQ2F0ZWdvcnlQb3N0JyB9KTtcblxuICAgICAgLy8gVGVzdCBleGFjdCBtYXRjaCBwcmlvcml0eSBvdmVyIHBhcmFtZXRlcml6ZWRcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L3VzZXJzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnbGlzdFVzZXJzJyB9KTtcblxuICAgICAgLy8gVGVzdCBzcGVjaWZpYyBwYXJhbWV0ZXJpemVkIHJvdXRlIHByaW9yaXR5IG92ZXIgZ2VuZXJhbFxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdXNlcnMvMTIzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgdXNlcklkOiAnMTIzJyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0VXNlckJ5SWQnIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbmVnYXRpdmUgY2FzZXMgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm91dGVzID0ge1xuICAgICAgICAnR0VUfC97YWJjfS97ZGVmfS97eHl6fSc6IHsgaGFuZGxlcjogJ2dldFRyaXBsZVBhcmFtcycgfSxcbiAgICAgICAgJ1BPU1R8L3tpZH0nOiB7IGhhbmRsZXI6ICd1cGRhdGVCeUlkJyB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcihyb3V0ZXMpO1xuXG4gICAgICAvLyBXcm9uZyBudW1iZXIgb2Ygc2VnbWVudHNcbiAgICAgIGxldCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC92YWx1ZTEvdmFsdWUyJywgLy8gVG9vIGZld1xuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBhYmM6ICd2YWx1ZTEnLCBkZWY6ICd2YWx1ZTInIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9CZU51bGwoKTtcblxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdmFsdWUxL3ZhbHVlMi92YWx1ZTMvZXh0cmEnLCAvLyBUb28gbWFueVxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBhYmM6ICd2YWx1ZTEnLCBkZWY6ICd2YWx1ZTInLCB4eXo6ICd2YWx1ZTMnIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9CZU51bGwoKTtcblxuICAgICAgLy8gV3JvbmcgSFRUUCBtZXRob2RcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdERUxFVEUnLCAvLyBTaG91bGQgYmUgUE9TVFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0LzEyMycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGlkOiAnMTIzJyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvQmVOdWxsKCk7XG5cbiAgICAgIC8vIE5vIG1hdGNoaW5nIHJvdXRlXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC9ub25leGlzdGVudC9yb3V0ZScsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0JlTnVsbCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29udHJvbGxlciBuYW1lcyB3aXRoIHNsYXNoZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCByb3V0ZXMgPSB7XG4gICAgICAgICdHRVR8L2luZGljZXMnOiB7IGhhbmRsZXI6ICdnZXRJbmRpY2VzJyB9LFxuICAgICAgICAnUE9TVHwvcmVpbmRleC97ZW50aXR5fSc6IHsgaGFuZGxlcjogJ3JlaW5kZXhFbnRpdHknIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHJvdXRlcyk7XG4gICAgICBjb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lID0gJ3N5c3RlbS9zZWFyY2gnO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvc3lzdGVtL3NlYXJjaC9pbmRpY2VzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRJbmRpY2VzJyB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2ZpbmRNYXRjaGluZ1JvdXRlIC0gRWRnZSBDYXNlcyAmIFJvYnVzdG5lc3MnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZWRnZSBjYXNlcyBhbmQgcGFyYW1ldGVyIHZhcmlhdGlvbnMnLCAoKSA9PiB7XG4gICAgICBjb25zdCByb3V0ZXMgPSB7XG4gICAgICAgICdHRVR8L3tpZH0nOiB7IGhhbmRsZXI6ICdnZXRCeUlkJyB9LFxuICAgICAgICAnR0VUfC97YX0ve2J9L3tjfS97ZH0ve2V9JzogeyBoYW5kbGVyOiAnZ2V0Rml2ZVBhcmFtcycgfSxcbiAgICAgICAgJ1BPU1R8L3tjb3VudHJ5fS97c3RhdGV9L3tjaXR5fS97ZGlzdHJpY3R9L3tzdHJlZXR9L3tidWlsZGluZ30nOiB7IGhhbmRsZXI6ICdnZXRTaXhQYXJhbXMnIH0sXG4gICAgICAgICdQVVR8L3tpZH0nOiB7IGhhbmRsZXI6ICd1cGRhdGVCeUlkJyB9LFxuICAgICAgICAnREVMRVRFfC97aWR9JzogeyBoYW5kbGVyOiAnZGVsZXRlQnlJZCcgfSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIocm91dGVzKTtcblxuICAgICAgLy8gRW1wdHkgcm91dGVzIG9iamVjdFxuICAgICAgY29uc3QgZW1wdHlDb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHt9KTtcbiAgICAgIGxldCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC9hbnl0aGluZycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGVtcHR5Q29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvQmVOdWxsKCk7XG5cbiAgICAgIC8vIFNwZWNpYWwgY2hhcmFjdGVycyBpbiBwYXJhbWV0ZXJzXG4gICAgICBjb25zdCBzcGVjaWFsQ2hhckNhc2VzID0gWyAnYWJjLTEyMycsICd1c2VyXzQ1NicsICc5OTknLCAnc3BlY2lhbCUyMGNoYXJzJyBdO1xuICAgICAgc3BlY2lhbENoYXJDYXNlcy5mb3JFYWNoKGlkID0+IHtcbiAgICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICByZXNvdXJjZTogYC90ZXN0LyR7aWR9YCxcbiAgICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZCB9LFxuICAgICAgICB9KTtcbiAgICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldEJ5SWQnIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFZlcnkgbG9uZyBwYXJhbWV0ZXJcbiAgICAgIGNvbnN0IGxvbmdJZCA9ICdhJy5yZXBlYXQoMTAwMCk7XG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6IGAvdGVzdC8ke2xvbmdJZH1gLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogbG9uZ0lkIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRCeUlkJyB9KTtcblxuICAgICAgLy8gTXVsdGlwbGUgSFRUUCBtZXRob2RzXG4gICAgICBjb25zdCBodHRwTWV0aG9kcyA9IFsgJ0dFVCcsICdQVVQnLCAnREVMRVRFJyBdO1xuICAgICAgY29uc3QgZXhwZWN0ZWRIYW5kbGVycyA9IFsgJ2dldEJ5SWQnLCAndXBkYXRlQnlJZCcsICdkZWxldGVCeUlkJyBdO1xuICAgICAgaHR0cE1ldGhvZHMuZm9yRWFjaCgobWV0aG9kLCBpbmRleCkgPT4ge1xuICAgICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICAgIGh0dHBNZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgICByZXNvdXJjZTogJy90ZXN0LzEyMycsXG4gICAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICcxMjMnIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiBleHBlY3RlZEhhbmRsZXJzWyBpbmRleCBdIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFJvdXRlcyB3aXRoIG1hbnkgcGFyYW1ldGVyc1xuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvMS8yLzMvNC81JyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgYTogJzEnLCBiOiAnMicsIGM6ICczJywgZDogJzQnLCBlOiAnNScgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldEZpdmVQYXJhbXMnIH0pO1xuXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvVVMvQ0EvU0YvRG93bnRvd24vTWFpbi8xMjMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50cnk6ICdVUycsIHN0YXRlOiAnQ0EnLCBjaXR5OiAnU0YnLFxuICAgICAgICAgIGRpc3RyaWN0OiAnRG93bnRvd24nLCBzdHJlZXQ6ICdNYWluJywgYnVpbGRpbmc6ICcxMjMnXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRTaXhQYXJhbXMnIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZmluZE1hdGNoaW5nUm91dGUgLSBBZHZhbmNlZCBTY2VuYXJpb3MnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29tcGxleCBjb250cm9sbGVyIG5hbWVzIGFuZCBSRVNUIHBhdHRlcm5zJywgKCkgPT4ge1xuICAgICAgLy8gVGVzdCBuZXN0ZWQgY29udHJvbGxlciBuYW1lc1xuICAgICAgY29uc3QgbmVzdGVkUm91dGVzID0ge1xuICAgICAgICAnR0VUfC9zdGF0dXMnOiB7IGhhbmRsZXI6ICdnZXRTdGF0dXMnIH0sXG4gICAgICAgICdQT1NUfC9hY3Rpb25zL3thY3Rpb25JZH0nOiB7IGhhbmRsZXI6ICdleGVjdXRlQWN0aW9uJyB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgbmVzdGVkQ29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcihuZXN0ZWRSb3V0ZXMpO1xuICAgICAgbmVzdGVkQ29udHJvbGxlci5jb250cm9sbGVyTmFtZSA9ICdhZG1pbi9zeXN0ZW0vbW9uaXRvcmluZy9oZWFsdGgnO1xuXG4gICAgICBsZXQgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL2FkbWluL3N5c3RlbS9tb25pdG9yaW5nL2hlYWx0aC9zdGF0dXMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChuZXN0ZWRDb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRTdGF0dXMnIH0pO1xuXG4gICAgICAvLyBUZXN0IGNvbnRyb2xsZXIgbmFtZXMgd2l0aCBzcGVjaWFsIGNoYXJhY3RlcnNcbiAgICAgIGNvbnN0IHNwZWNpYWxDb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHsgJ0dFVHwvdGVzdCc6IHsgaGFuZGxlcjogJ3Rlc3QnIH0gfSk7XG4gICAgICBzcGVjaWFsQ29udHJvbGxlci5jb250cm9sbGVyTmFtZSA9ICdhcGktdjEuMi91c2VyLW1hbmFnZW1lbnQnO1xuXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvYXBpLXYxLjIvdXNlci1tYW5hZ2VtZW50L3Rlc3QnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChzcGVjaWFsQ29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAndGVzdCcgfSk7XG5cbiAgICAgIC8vIFRlc3QgY29tcHJlaGVuc2l2ZSBSRVNUIEFQSSBwYXR0ZXJuc1xuICAgICAgY29uc3QgcmVzdFJvdXRlcyA9IHtcbiAgICAgICAgJ0dFVHwvJzogeyBoYW5kbGVyOiAnbGlzdCcgfSxcbiAgICAgICAgJ1BPU1R8Lyc6IHsgaGFuZGxlcjogJ2NyZWF0ZScgfSxcbiAgICAgICAgJ0dFVHwve2lkfSc6IHsgaGFuZGxlcjogJ2dldCcgfSxcbiAgICAgICAgJ1BVVHwve2lkfSc6IHsgaGFuZGxlcjogJ3VwZGF0ZScgfSxcbiAgICAgICAgJ0RFTEVURXwve2lkfSc6IHsgaGFuZGxlcjogJ2RlbGV0ZScgfSxcbiAgICAgICAgJ0dFVHwve2lkfS9yZWxhdGlvbnNoaXBzJzogeyBoYW5kbGVyOiAnZ2V0UmVsYXRpb25zaGlwcycgfSxcbiAgICAgICAgJ1BPU1R8L3tpZH0vcmVsYXRpb25zaGlwcy97cmVsYXRpb25zaGlwVHlwZX0nOiB7IGhhbmRsZXI6ICdhZGRSZWxhdGlvbnNoaXAnIH0sXG4gICAgICAgICdHRVR8L3RlYW1zL3t0ZWFtSWR9L3Byb2plY3RzL3twcm9qZWN0SWR9L3Rhc2tzL3t0YXNrSWR9JzogeyBoYW5kbGVyOiAnZ2V0UHJvamVjdFRhc2snIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN0Q29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcihyZXN0Um91dGVzKTtcblxuICAgICAgY29uc3QgdGVzdENhc2VzID0gW1xuICAgICAgICB7IG1ldGhvZDogJ0dFVCcsIHBhdGg6ICcvdGVzdC8nLCBwYXJhbXM6IHt9LCBleHBlY3RlZDogJ2xpc3QnIH0sXG4gICAgICAgIHsgbWV0aG9kOiAnUE9TVCcsIHBhdGg6ICcvdGVzdC8nLCBwYXJhbXM6IHt9LCBleHBlY3RlZDogJ2NyZWF0ZScgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdHRVQnLCBwYXRoOiAnL3Rlc3QvMTIzJywgcGFyYW1zOiB7IGlkOiAnMTIzJyB9LCBleHBlY3RlZDogJ2dldCcgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdQVVQnLCBwYXRoOiAnL3Rlc3QvMTIzJywgcGFyYW1zOiB7IGlkOiAnMTIzJyB9LCBleHBlY3RlZDogJ3VwZGF0ZScgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdERUxFVEUnLCBwYXRoOiAnL3Rlc3QvMTIzJywgcGFyYW1zOiB7IGlkOiAnMTIzJyB9LCBleHBlY3RlZDogJ2RlbGV0ZScgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdHRVQnLCBwYXRoOiAnL3Rlc3QvMTIzL3JlbGF0aW9uc2hpcHMnLCBwYXJhbXM6IHsgaWQ6ICcxMjMnIH0sIGV4cGVjdGVkOiAnZ2V0UmVsYXRpb25zaGlwcycgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdQT1NUJywgcGF0aDogJy90ZXN0LzEyMy9yZWxhdGlvbnNoaXBzL2ZyaWVuZHMnLCBwYXJhbXM6IHsgaWQ6ICcxMjMnLCByZWxhdGlvbnNoaXBUeXBlOiAnZnJpZW5kcycgfSwgZXhwZWN0ZWQ6ICdhZGRSZWxhdGlvbnNoaXAnIH0sXG4gICAgICAgIHsgbWV0aG9kOiAnR0VUJywgcGF0aDogJy90ZXN0L3RlYW1zL3QxL3Byb2plY3RzL3AyL3Rhc2tzL3Rhc2szJywgcGFyYW1zOiB7IHRlYW1JZDogJ3QxJywgcHJvamVjdElkOiAncDInLCB0YXNrSWQ6ICd0YXNrMycgfSwgZXhwZWN0ZWQ6ICdnZXRQcm9qZWN0VGFzaycgfSxcbiAgICAgIF07XG5cbiAgICAgIHRlc3RDYXNlcy5mb3JFYWNoKCh7IG1ldGhvZCwgcGF0aCwgcGFyYW1zLCBleHBlY3RlZCB9KSA9PiB7XG4gICAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgICAgaHR0cE1ldGhvZDogbWV0aG9kLFxuICAgICAgICAgIHJlc291cmNlOiBwYXRoLFxuICAgICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBwYXJhbXMsXG4gICAgICAgIH0pO1xuICAgICAgICBleHBlY3QocmVzdENvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogZXhwZWN0ZWQgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2ZpbmRNYXRjaGluZ1JvdXRlIC0gRXJyb3IgUmVzaWxpZW5jZScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlcnJvciBjb25kaXRpb25zIGdyYWNlZnVsbHknLCAoKSA9PiB7XG4gICAgICAvLyBUZXN0IG1hbGZvcm1lZCByb3V0ZSBrZXlzXG4gICAgICBjb25zdCBtYWxmb3JtZWRSb3V0ZXMgPSB7XG4gICAgICAgICdHRVR8L3ZhbGlkJzogeyBoYW5kbGVyOiAndmFsaWQnIH0sXG4gICAgICAgICdJTlZBTElEX1JPVVRFJzogeyBoYW5kbGVyOiAnaW52YWxpZCcgfSwgLy8gTWlzc2luZyBwaXBlIHNlcGFyYXRvclxuICAgICAgICAnUE9TVHwnOiB7IGhhbmRsZXI6ICdlbXB0eScgfSwgLy8gRW1wdHkgcGF0aFxuICAgICAgICAnfC9uby1tZXRob2QnOiB7IGhhbmRsZXI6ICdub01ldGhvZCcgfSwgLy8gTWlzc2luZyBtZXRob2RcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIobWFsZm9ybWVkUm91dGVzKTtcblxuICAgICAgLy8gVmFsaWQgcm91dGUgc2hvdWxkIHN0aWxsIHdvcmsgZGVzcGl0ZSBtYWxmb3JtZWQgb25lc1xuICAgICAgbGV0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L3ZhbGlkJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAndmFsaWQnIH0pO1xuXG4gICAgICAvLyBUZXN0IGVtcHR5IGNvbnRyb2xsZXIgbmFtZVxuICAgICAgY29uc3QgZW1wdHlOYW1lQ29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcih7fSk7XG4gICAgICBlbXB0eU5hbWVDb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lID0gJyc7XG5cbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy9hbnl0aGluZycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoKCkgPT4gZW1wdHlOYW1lQ29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLm5vdC50b1Rocm93KCk7XG4gICAgICBleHBlY3QoZW1wdHlOYW1lQ29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvQmVOdWxsKCk7XG5cbiAgICAgIC8vIFRlc3Qgcm91dGVzIHdpdGggYWRkaXRpb25hbCBtZXRhZGF0YVxuICAgICAgY29uc3QgbWV0YWRhdGFSb3V0ZXMgPSB7XG4gICAgICAgICdHRVR8L3VzZXJzJzoge1xuICAgICAgICAgIGhhbmRsZXI6ICdnZXRVc2VycycsXG4gICAgICAgICAgbWlkZGxld2FyZTogWyAnYXV0aCcsICdsb2dnaW5nJyBdLFxuICAgICAgICAgIGNhY2hlOiB0cnVlLFxuICAgICAgICAgIHRpbWVvdXQ6IDMwMDAwXG4gICAgICAgIH0sXG4gICAgICAgICdQT1NUfC97aWR9Jzoge1xuICAgICAgICAgIGhhbmRsZXI6ICd1cGRhdGVVc2VyJyxcbiAgICAgICAgICB2YWxpZGF0aW9uczogeyBib2R5OiB7IHJlcXVpcmVkOiB0cnVlIH0gfSxcbiAgICAgICAgICByYXRlTGltaXQ6IDEwMFxuICAgICAgICB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgbWV0YWRhdGFDb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKG1ldGFkYXRhUm91dGVzKTtcblxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdXNlcnMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChtZXRhZGF0YUNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHtcbiAgICAgICAgaGFuZGxlcjogJ2dldFVzZXJzJyxcbiAgICAgICAgbWlkZGxld2FyZTogWyAnYXV0aCcsICdsb2dnaW5nJyBdLFxuICAgICAgICBjYWNoZTogdHJ1ZSxcbiAgICAgICAgdGltZW91dDogMzAwMDBcbiAgICAgIH0pO1xuXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvMTIzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICcxMjMnIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChtZXRhZGF0YUNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHtcbiAgICAgICAgaGFuZGxlcjogJ3VwZGF0ZVVzZXInLFxuICAgICAgICB2YWxpZGF0aW9uczogeyBib2R5OiB7IHJlcXVpcmVkOiB0cnVlIH0gfSxcbiAgICAgICAgcmF0ZUxpbWl0OiAxMDBcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnQVBJR2F0ZXdheUNvbnRyb2xsZXIgQ29yZSBGdW5jdGlvbmFsaXR5JywgKCkgPT4ge1xuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBqZXN0LmNsZWFyQWxsTW9ja3MoKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3JvdXRlIGZ1bmN0aW9uIHJlc29sdXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gaGFuZGxlciBmdW5jdGlvbiBmb3IgdmFsaWQgcm91dGVzLCA0MDQgaGFuZGxlciBvdGhlcndpc2UnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHt9KTtcblxuICAgICAgLy8gVmFsaWQgcm91dGVcbiAgICAgIGNvbnN0IHZhbGlkUm91dGUgPSB7IGZ1bmN0aW9uTmFtZTogJ3Rlc3RIYW5kbGVyJyB9O1xuICAgICAgY29uc3QgdmFsaWRGdW5jdGlvbiA9IGNvbnRyb2xsZXIudGVzdEdldFJvdXRlRnVuY3Rpb24odmFsaWRSb3V0ZSk7XG4gICAgICBleHBlY3QodmFsaWRGdW5jdGlvbi5jYWxsKGNvbnRyb2xsZXIpKS50b0VxdWFsKHsgbWVzc2FnZTogJ3Rlc3QgaGFuZGxlciBjYWxsZWQnIH0pO1xuXG4gICAgICAvLyBJbnZhbGlkIHJvdXRlcyBhbGwgcmV0dXJuIDQwNFxuICAgICAgWyBudWxsLCB7IGZ1bmN0aW9uTmFtZTogJ25vbkV4aXN0ZW50JyB9LCB7IGZ1bmN0aW9uTmFtZTogJ25vdEFGdW5jdGlvbicgfSBdLmZvckVhY2gocm91dGUgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBjb250cm9sbGVyLnRlc3RHZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlKS5jYWxsKGNvbnRyb2xsZXIsIGNyZWF0ZU1vY2tSZXF1ZXN0KCkpO1xuICAgICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDA0KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQWN0b3IgQ29udGV4dCBFeHRyYWN0aW9uJywgKCkgPT4ge1xuICAgIGxldCBjb250cm9sbGVyOiBUZXN0Q29udHJvbGxlcjtcblxuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgY29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcih7fSk7XG4gICAgfSk7XG5cbiAgICAvLyBIZWxwZXIgdG8gY3JlYXRlIG1vY2sgQVBJR2F0ZXdheUV2ZW50XG4gICAgY29uc3QgY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyA9IChvdmVycmlkZXM6IFBhcnRpYWw8QVBJR2F0ZXdheUV2ZW50PiA9IHt9KTogQVBJR2F0ZXdheUV2ZW50ID0+IHtcbiAgICAgIGNvbnN0IGJhc2VFdmVudCA9IHtcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdCcsXG4gICAgICAgIHBhdGg6ICcvdGVzdCcsXG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICBoZWFkZXJzOiB7fSxcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICByZXNvdXJjZUlkOiAndGVzdCcsXG4gICAgICAgICAgcmVzb3VyY2VQYXRoOiAnL3Rlc3QnLFxuICAgICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdCcsXG4gICAgICAgICAgc3RhZ2U6ICd0ZXN0JyxcbiAgICAgICAgICBpZGVudGl0eToge1xuICAgICAgICAgICAgY29nbml0b0lkZW50aXR5UG9vbElkOiBudWxsLFxuICAgICAgICAgICAgYWNjb3VudElkOiBudWxsLFxuICAgICAgICAgICAgY29nbml0b0lkZW50aXR5SWQ6IG51bGwsXG4gICAgICAgICAgICBjYWxsZXI6IG51bGwsXG4gICAgICAgICAgICBzb3VyY2VJcDogJzEyNy4wLjAuMScsXG4gICAgICAgICAgICBwcmluY2lwYWxPcmdJZDogbnVsbCxcbiAgICAgICAgICAgIGFjY2Vzc0tleTogbnVsbCxcbiAgICAgICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblR5cGU6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25Qcm92aWRlcjogbnVsbCxcbiAgICAgICAgICAgIHVzZXJBcm46IG51bGwsXG4gICAgICAgICAgICB1c2VyQWdlbnQ6ICd0ZXN0LWFnZW50JyxcbiAgICAgICAgICAgIHVzZXI6IG51bGwsXG4gICAgICAgICAgICBhcGlLZXk6IG51bGwsXG4gICAgICAgICAgICBhcGlLZXlJZDogbnVsbCxcbiAgICAgICAgICAgIGNsaWVudENlcnQ6IG51bGxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHByb3RvY29sOiAnSFRUUC8xLjEnLFxuICAgICAgICAgIHJlcXVlc3RUaW1lOiAnMDkvQXByLzIwMTU6MTI6MzQ6NTYgKzAwMDAnLFxuICAgICAgICAgIHJlcXVlc3RUaW1lRXBvY2g6IDE0Mjg1ODI4OTYwMDAsXG4gICAgICAgICAgYXBpSWQ6ICd0ZXN0LWFwaSdcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTogbnVsbCxcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcbiAgICAgIH0gYXMgQVBJR2F0ZXdheUV2ZW50O1xuXG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5iYXNlRXZlbnQsXG4gICAgICAgIC4uLm92ZXJyaWRlcyxcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICAuLi5iYXNlRXZlbnQucmVxdWVzdENvbnRleHQsXG4gICAgICAgICAgLi4ub3ZlcnJpZGVzLnJlcXVlc3RDb250ZXh0XG4gICAgICAgIH1cbiAgICAgIH0gYXMgQVBJR2F0ZXdheUV2ZW50O1xuICAgIH07XG5cbiAgICBpdCgnc2hvdWxkIGV4dHJhY3QgYWN0b3IgY29udGV4dCBmcm9tIENvZ25pdG8gYXV0aG9yaXphdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAndXNlci1hZ2VudCc6ICdNb3ppbGxhLzUuMCBDaHJvbWUvOTEuMCdcbiAgICAgICAgfSxcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBpZGVudGl0eToge1xuICAgICAgICAgICAgc291cmNlSXA6ICcxOTIuMTY4LjEuMTAwJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3VzZXItMTIzLTQ1NicsXG4gICAgICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2pvaG4uZG9lJyxcbiAgICAgICAgICAgICAgJ2NvZ25pdG86Z3JvdXBzJzogJ2FkbWluLHVzZXInLFxuICAgICAgICAgICAgICBlbWFpbDogJ2pvaG5AZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICBlbWFpbF92ZXJpZmllZDogJ3RydWUnLFxuICAgICAgICAgICAgICAnY3VzdG9tOnRlbmFudElkJzogJ3RlbmFudC03ODknLFxuICAgICAgICAgICAgICAnY3VzdG9tOnJvbGUnOiAnbWFuYWdlcidcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWFiYy0xMjMnLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ3gtY29ycmVsYXRpb24taWQnOiAnY29yci14eXotNzg5J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWN0b3IgPSAoY29udHJvbGxlciBhcyBhbnkpLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtYWJjLTEyMycsXG4gICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEwMCcsXG4gICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wIENocm9tZS85MS4wJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYWN0b3JJZDogJ2pvaG4uZG9lJyxcbiAgICAgICAgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJyxcbiAgICAgICAgZW1haWxWZXJpZmllZDogdHJ1ZSxcbiAgICAgICAgY29nbml0bzoge1xuICAgICAgICAgIHN1YjogJ3VzZXItMTIzLTQ1NicsXG4gICAgICAgICAgdXNlcm5hbWU6ICdqb2huLmRvZScsXG4gICAgICAgICAgZ3JvdXBzOiBbICdhZG1pbicsICd1c2VyJyBdLFxuICAgICAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgIHRlbmFudElkOiAndGVuYW50LTc4OScsXG4gICAgICAgICAgICByb2xlOiAnbWFuYWdlcidcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGFjdG9yLnRpbWVzdGFtcCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBhY3RvciBjb250ZXh0IGZyb20gQVBJIEtleSBhdXRob3JpemF0aW9uIChyZXF1ZXN0IGNvbnRleHQpJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBpZGVudGl0eToge1xuICAgICAgICAgICAgc291cmNlSXA6ICcxMC4wLjAuMScsXG4gICAgICAgICAgICBhcGlLZXk6ICdhcGkta2V5LWFiYzEyMycsXG4gICAgICAgICAgICBhcGlLZXlJZDogJ2tleS1pZC00NTYnXG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1kZWYtNDU2J1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWRlZi00NTYnLFxuICAgICAgICBzb3VyY2VJcDogJzEwLjAuMC4xJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2FwaS1rZXknLFxuICAgICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgYWN0b3JJZDogJ2FwaS1rZXk6a2V5LWlkLTQ1NicsXG4gICAgICAgIGFwaUtleToge1xuICAgICAgICAgIGlkOiAna2V5LWlkLTQ1NicsXG4gICAgICAgICAgc291cmNlOiAncmVxdWVzdC1jb250ZXh0J1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBhY3RvciBjb250ZXh0IGZyb20gQVBJIEtleSBhdXRob3JpemF0aW9uIChoZWFkZXIpJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBpZGVudGl0eToge1xuICAgICAgICAgICAgc291cmNlSXA6ICcxMC4wLjAuMSdcbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWhlYWRlci1hcGkta2V5JyxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICd4LWFwaS1rZXknOiAnaGVhZGVyLWFwaS1rZXkteHl6Nzg5J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWN0b3IgPSAoY29udHJvbGxlciBhcyBhbnkpLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtaGVhZGVyLWFwaS1rZXknLFxuICAgICAgICBzb3VyY2VJcDogJzEwLjAuMC4xJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2FwaS1rZXknLFxuICAgICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgYWN0b3JJZDogJ2FwaS1rZXk6aGVhZGVyLWFwaS1rZXkteHl6Nzg5JyxcbiAgICAgICAgYXBpS2V5OiB7XG4gICAgICAgICAgaWQ6ICdoZWFkZXItYXBpLWtleS14eXo3ODknLFxuICAgICAgICAgIHNvdXJjZTogJ2hlYWRlcidcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByaW9yaXRpemUgcmVxdWVzdC1jb250ZXh0IEFQSSBrZXkgb3ZlciBoZWFkZXInLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tFdmVudEZvckFjdG9yVGVzdHMoe1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBzb3VyY2VJcDogJzEwLjAuMC4xJyxcbiAgICAgICAgICAgIGFwaUtleTogJ2NvbnRleHQtYXBpLWtleSdcbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXByaW9yaXR5LXRlc3QnLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ3gtYXBpLWtleSc6ICdoZWFkZXItYXBpLWtleS1zaG91bGQtYmUtaWdub3JlZCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgYXV0aE1ldGhvZDogJ2FwaS1rZXknLFxuICAgICAgICBhY3RvcklkOiAnYXBpLWtleTpjb250ZXh0LWFwaS1rZXknLFxuICAgICAgICBhcGlLZXk6IHtcbiAgICAgICAgICBpZDogJ2NvbnRleHQtYXBpLWtleScsXG4gICAgICAgICAgc291cmNlOiAncmVxdWVzdC1jb250ZXh0J1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBhY3RvciBjb250ZXh0IGZyb20gSUFNIGF1dGhvcml6YXRpb24nLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tFdmVudEZvckFjdG9yVGVzdHMoe1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBzb3VyY2VJcDogJzE3Mi4xNi4wLjEnLFxuICAgICAgICAgICAgdXNlckFybjogJ2Fybjphd3M6aWFtOjoxMjM0NTY3ODkwMTI6dXNlci9zZXJ2aWNlLXVzZXInLFxuICAgICAgICAgICAgdXNlcjogJ0FJREFJMjNIWjI3U0k2RlFNR05RMicsXG4gICAgICAgICAgICBhY2NvdW50SWQ6ICcxMjM0NTY3ODkwMTInLFxuICAgICAgICAgICAgY2FsbGVyOiAnY2FsbGVyLWlkJ1xuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnlcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtZ2hpLTc4OSdcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1naGktNzg5JyxcbiAgICAgICAgc291cmNlSXA6ICcxNzIuMTYuMC4xJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2lhbScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICBhY3RvcklkOiAnQUlEQUkyM0haMjdTSTZGUU1HTlEyJyxcbiAgICAgICAgaWFtOiB7XG4gICAgICAgICAgdXNlckFybjogJ2Fybjphd3M6aWFtOjoxMjM0NTY3ODkwMTI6dXNlci9zZXJ2aWNlLXVzZXInLFxuICAgICAgICAgIHVzZXJJZDogJ0FJREFJMjNIWjI3U0k2RlFNR05RMicsXG4gICAgICAgICAgYWNjb3VudElkOiAnMTIzNDU2Nzg5MDEyJyxcbiAgICAgICAgICBjYWxsZXI6ICdjYWxsZXItaWQnXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHN5c3RlbS9hbm9ueW1vdXMgYXV0aG9yaXphdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMjAzLjAuMTEzLjEnXG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1qa2wtMDEyJ1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWprbC0wMTInLFxuICAgICAgICBzb3VyY2VJcDogJzIwMy4wLjExMy4xJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2Fub255bW91cycsXG4gICAgICAgIGFjdG9yVHlwZTogJ2Fub255bW91cycsXG4gICAgICAgIGFjdG9ySWQ6ICdhbm9ueW1vdXMnLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG1lcmdlIGEgY2xpZW50LXN1cHBsaWVkIHgtYWN0b3IgaGVhZGVyIGZvciBJQU0gKFNpZ1Y0KSBhdXRob3JpemF0aW9uJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICd4LWFjdG9yJzogSlNPTi5zdHJpbmdpZnkoeyBpZDogJ2NvZ25pdG8tc3ViLTEyMycsIGVtYWlsOiAnSmFuZUBFeGFtcGxlLmNvbScsIHVzZXJuYW1lOiAnSmFuZUQnLCB0ZW5hbnRJZDogJ3RlbmFudC0xJyB9KSxcbiAgICAgICAgfSxcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBpZGVudGl0eToge1xuICAgICAgICAgICAgc291cmNlSXA6ICcxNzIuMTYuMC4xJyxcbiAgICAgICAgICAgIHVzZXJBcm46ICdhcm46YXdzOmlhbTo6MTIzNDU2Nzg5MDEyOnJvbGUvYXV0aGVudGljYXRlZC1yb2xlJyxcbiAgICAgICAgICAgIHVzZXI6ICdBSURBSTIzSFoyN1NJNkZRTUdOUTInLFxuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnlcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3QoeyByZXF1ZXN0SWQ6ICdyZXEtc2lndjQtYWN0b3InIH0pO1xuICAgICAgY29uc3QgYWN0b3IgPSAoY29udHJvbGxlciBhcyBhbnkpLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICBhdXRoTWV0aG9kOiAnaWFtJyxcbiAgICAgICAgLy8gYWN0b3JJZCBzdGF5cyB0aGUgYXV0aC12ZXJpZmllZCBJQU0gaWRlbnRpdHkg4oCUIHRoZSBjbGllbnQtc3VwcGxpZWQgY2xhaW0gaXMgTkVWRVJcbiAgICAgICAgLy8gYWxsb3dlZCB0byBvdmVyd3JpdGUgdGhlIGZpZWxkIHRoYXQgY3JlYXRlZEJ5L3VwZGF0ZWRCeS9kZWxldGVkQnkgYXVkaXQgc3RhbXBpbmcgdHJ1c3RzLlxuICAgICAgICBhY3RvcklkOiAnQUlEQUkyM0haMjdTSTZGUU1HTlEyJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIGNsaWVudFN1cHBsaWVkQWN0b3I6IHRydWUsXG4gICAgICAgIGNsaWVudFN1cHBsaWVkQWN0b3JJZDogJ2NvZ25pdG8tc3ViLTEyMycsXG4gICAgICAgIGVtYWlsOiAnSmFuZUBFeGFtcGxlLmNvbScsXG4gICAgICAgIG5hbWU6ICdKYW5lRCcsXG4gICAgICAgIHRlbmFudElkOiAndGVuYW50LTEnLFxuICAgICAgICBjb2duaXRvOiB7IHN1YjogJ2NvZ25pdG8tc3ViLTEyMycgfSxcbiAgICAgIH0pO1xuICAgICAgLy8gVGhlIElBTSBBUk4gaXMgc3RpbGwgcmVjb3JkZWQg4oCUIHRoZSBjbGllbnQtc3VwcGxpZWQgYWN0b3Igb25seSBmaWxscyB0aGVcbiAgICAgIC8vIFwid2hvXCIsIGl0IGRvZXNuJ3QgZXJhc2UgdGhlIHVuZGVybHlpbmcgYXV0aCBtZWNoYW5pc20ncyBvd24gY29udGV4dC5cbiAgICAgIGV4cGVjdChhY3Rvci5pYW0/LnVzZXJBcm4pLnRvQmUoJ2Fybjphd3M6aWFtOjoxMjM0NTY3ODkwMTI6cm9sZS9hdXRoZW50aWNhdGVkLXJvbGUnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbWVyZ2UgYSBjbGllbnQtc3VwcGxpZWQgeC1hY3RvciBoZWFkZXIgZm9yIGFub255bW91cyByZXF1ZXN0cycsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIGhlYWRlcnM6IHsgJ3gtYWN0b3InOiBKU09OLnN0cmluZ2lmeSh7IGlkOiAnc3ViLWFiYycgfSkgfSxcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHsgaWRlbnRpdHk6IHsgc291cmNlSXA6ICcyMDMuMC4xMTMuMScgfSB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7IHJlcXVlc3RJZDogJ3JlcS1hbm9uLWFjdG9yJyB9KTtcbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgYXV0aE1ldGhvZDogJ2Fub255bW91cycsXG4gICAgICAgIC8vIGFjdG9ySWQgc3RheXMgJ2Fub255bW91cycg4oCUIHNlZSB0aGUgSUFNIHRlc3QgYWJvdmUgZm9yIHdoeSB0aGlzIGlzIG5ldmVyIG92ZXJ3cml0dGVuLlxuICAgICAgICBhY3RvcklkOiAnYW5vbnltb3VzJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIGNsaWVudFN1cHBsaWVkQWN0b3I6IHRydWUsXG4gICAgICAgIGNsaWVudFN1cHBsaWVkQWN0b3JJZDogJ3N1Yi1hYmMnLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGlnbm9yZSBhIG1hbGZvcm1lZCB4LWFjdG9yIGhlYWRlciB3aXRob3V0IHRocm93aW5nJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgaGVhZGVyczogeyAneC1hY3Rvcic6ICd7bm90IHZhbGlkIGpzb24nIH0sXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7IGlkZW50aXR5OiB7IHNvdXJjZUlwOiAnMjAzLjAuMTEzLjEnIH0gfSBhcyBhbnlcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3QoeyByZXF1ZXN0SWQ6ICdyZXEtYmFkLWFjdG9yLWhlYWRlcicgfSk7XG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIGF1dGhNZXRob2Q6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvcklkOiAnYW5vbnltb3VzJyxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGFjdG9yLmNsaWVudFN1cHBsaWVkQWN0b3IpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChhY3Rvci5jbGllbnRTdXBwbGllZEFjdG9ySWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaWdub3JlIGFuIHgtYWN0b3IgaGVhZGVyIG1pc3NpbmcgdGhlIHJlcXVpcmVkIGlkIGZpZWxkJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgaGVhZGVyczogeyAneC1hY3Rvcic6IEpTT04uc3RyaW5naWZ5KHsgZW1haWw6ICduby1pZEBleGFtcGxlLmNvbScgfSkgfSxcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHsgaWRlbnRpdHk6IHsgc291cmNlSXA6ICcyMDMuMC4xMTMuMScgfSB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7IHJlcXVlc3RJZDogJ3JlcS1uby1pZC1hY3RvcicgfSk7XG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3Rvci5hY3RvcklkKS50b0JlKCdhbm9ueW1vdXMnKTtcbiAgICAgIGV4cGVjdChhY3Rvci5jbGllbnRTdXBwbGllZEFjdG9yKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICBleHBlY3QoYWN0b3IuY2xpZW50U3VwcGxpZWRBY3RvcklkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG5ldmVyIGxldCBhIGNsaWVudC1zdXBwbGllZCB4LWFjdG9yIGhlYWRlciBvdmVycmlkZSBhIHZlcmlmaWVkIENvZ25pdG8gYWN0b3InLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tFdmVudEZvckFjdG9yVGVzdHMoe1xuICAgICAgICBoZWFkZXJzOiB7ICd4LWFjdG9yJzogSlNPTi5zdHJpbmdpZnkoeyBpZDogJ3Nwb29mZWQtaWQnIH0pIH0sXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3JlYWwtY29nbml0by1zdWInLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdyZWFsX3VzZXInLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnlcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3QoeyByZXF1ZXN0SWQ6ICdyZXEtY29nbml0by1ub3Qtc3Bvb2ZlZCcgfSk7XG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3Rvci5hdXRoTWV0aG9kKS50b0JlKCdjb2duaXRvJyk7XG4gICAgICBleHBlY3QoYWN0b3IuYWN0b3JJZCkudG9CZSgncmVhbF91c2VyJyk7XG4gICAgICBleHBlY3QoYWN0b3IuY2xpZW50U3VwcGxpZWRBY3RvcikudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGFjdG9yLmNsaWVudFN1cHBsaWVkQWN0b3JJZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWFsZm9ybWVkIGNsYWltcyBncmFjZWZ1bGx5JywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBhdXRob3JpemVyOiB7XG4gICAgICAgICAgICBjbGFpbXM6IHtcbiAgICAgICAgICAgICAgc3ViOiAndXNlci1tYWxmb3JtZWQtdGVzdCcsXG4gICAgICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ21hbGZvcm1lZF91c2VyJyxcbiAgICAgICAgICAgICAgJ2NvZ25pdG86Z3JvdXBzJzogbnVsbCwgLy8gTWFsZm9ybWVkIGdyb3Vwc1xuICAgICAgICAgICAgICBlbWFpbF92ZXJpZmllZDogJ25vdC1hLWJvb2xlYW4nLCAvLyBJbnZhbGlkIGJvb2xlYW5cbiAgICAgICAgICAgICAgJ2N1c3RvbTp3ZWlyZDprZXknOiAnc2hvdWxkLWJlLWlnbm9yZWQnIC8vIEludmFsaWQgY3VzdG9tIGF0dHJpYnV0ZSBmb3JtYXRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLW1hbGZvcm1lZC1jbGFpbXMnXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWN0b3IgPSAoY29udHJvbGxlciBhcyBhbnkpLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICBhY3RvcklkOiAnbWFsZm9ybWVkX3VzZXInLFxuICAgICAgICBlbWFpbFZlcmlmaWVkOiBmYWxzZSwgLy8gU2hvdWxkIGRlZmF1bHQgdG8gZmFsc2UgZm9yIGludmFsaWQgYm9vbGVhblxuICAgICAgICBjb2duaXRvOiB7XG4gICAgICAgICAgc3ViOiAndXNlci1tYWxmb3JtZWQtdGVzdCcsXG4gICAgICAgICAgdXNlcm5hbWU6ICdtYWxmb3JtZWRfdXNlcicsXG4gICAgICAgICAgZ3JvdXBzOiBbXSwgLy8gTnVsbCBncm91cHMgc2hvdWxkIGJlY29tZSBlbXB0eSBhcnJheVxuICAgICAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IHt9IC8vIEludmFsaWQgY3VzdG9tIGF0dHJpYnV0ZXMgc2hvdWxkIGJlIGVtcHR5XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWlzc2luZyBvcHRpb25hbCBmaWVsZHMgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIGhlYWRlcnM6IHt9LCAvLyBObyB1c2VyLWFnZW50XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIHNvdXJjZUlwOiB1bmRlZmluZWQgLy8gTm8gc291cmNlIElQXG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1wcXItNjc4JyxcbiAgICAgICAgaGVhZGVyczoge30gLy8gTm8gY3VzdG9tIGhlYWRlcnNcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1wcXItNjc4JyxcbiAgICAgICAgc291cmNlSXA6IHVuZGVmaW5lZCxcbiAgICAgICAgdXNlckFnZW50OiB1bmRlZmluZWQsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvclR5cGU6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvcklkOiAnYW5vbnltb3VzJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwcmlvcml0aXplIGNvZ25pdG8gdXNlcm5hbWUgb3ZlciBzdWIgZm9yIGFjdG9ySWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tFdmVudEZvckFjdG9yVGVzdHMoe1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICd1c2VyLXN1Yi0xMjMnLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdwcmVmZXJyZWQudXNlcm5hbWUnXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1zdHUtOTAxJ1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yLmFjdG9ySWQpLnRvQmUoJ3ByZWZlcnJlZC51c2VybmFtZScpO1xuICAgICAgZXhwZWN0KGFjdG9yLmNvZ25pdG8/LnN1YikudG9CZSgndXNlci1zdWItMTIzJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHVzZSBlbWFpbCBhcyBmYWxsYmFjayB3aGVuIGNvZ25pdG8gdXNlcm5hbWUgaXMgbm90IGF2YWlsYWJsZScsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3VzZXItc3ViLTQ1NicsXG4gICAgICAgICAgICAgIGVtYWlsOiAnZmFsbGJhY2tAZXhhbXBsZS5jb20nXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS12d3gtMjM0J1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yLmFjdG9ySWQpLnRvQmUoJ2ZhbGxiYWNrQGV4YW1wbGUuY29tJyk7XG4gICAgICBleHBlY3QoYWN0b3IuY29nbml0bz8uc3ViKS50b0JlKCd1c2VyLXN1Yi00NTYnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGdyb3VwcyBwYXJzaW5nIGVkZ2UgY2FzZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCB0ZXN0Q2FzZXMgPSBbXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnc2luZ2xlIGdyb3VwJyxcbiAgICAgICAgICBncm91cHM6ICdhZG1pbicsXG4gICAgICAgICAgZXhwZWN0ZWQ6IFsgJ2FkbWluJyBdXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnbXVsdGlwbGUgZ3JvdXBzIHdpdGggc3BhY2VzJyxcbiAgICAgICAgICBncm91cHM6ICcgYWRtaW4gLCB1c2VyICwgbW9kZXJhdG9yICcsXG4gICAgICAgICAgZXhwZWN0ZWQ6IFsgJ2FkbWluJywgJ3VzZXInLCAnbW9kZXJhdG9yJyBdXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnZW1wdHkgZ3JvdXAgc3RyaW5nJyxcbiAgICAgICAgICBncm91cHM6ICcnLFxuICAgICAgICAgIGV4cGVjdGVkOiBbXVxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ2dyb3VwcyB3aXRoIGV4dHJhIGNvbW1hcycsXG4gICAgICAgICAgZ3JvdXBzOiAnYWRtaW4sLHVzZXIsJyxcbiAgICAgICAgICBleHBlY3RlZDogWyAnYWRtaW4nLCAndXNlcicgXVxuICAgICAgICB9XG4gICAgICBdO1xuXG4gICAgICB0ZXN0Q2FzZXMuZm9yRWFjaCgoeyBuYW1lLCBncm91cHMsIGV4cGVjdGVkIH0pID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgICBjbGFpbXM6IHtcbiAgICAgICAgICAgICAgICBzdWI6ICd1c2VyLWdyb3Vwcy10ZXN0JyxcbiAgICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdncm91cHNfdXNlcicsXG4gICAgICAgICAgICAgICAgJ2NvZ25pdG86Z3JvdXBzJzogZ3JvdXBzXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGFzIGFueVxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICAgIHJlcXVlc3RJZDogYHJlcS1ncm91cHMtJHtuYW1lLnJlcGxhY2UoL1xccysvZywgJy0nKX1gXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgICBleHBlY3QoYWN0b3IuY29nbml0bz8uZ3JvdXBzKS50b0VxdWFsKGV4cGVjdGVkKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBleHRyYWN0IGN1c3RvbSBhdHRyaWJ1dGVzIGZyb20gQ29nbml0bycsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3VzZXItd2l0aC1jdXN0b20tYXR0cnMnLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdjdXN0b21fdXNlcicsXG4gICAgICAgICAgICAgICdjdXN0b206ZGVwYXJ0bWVudCc6ICdlbmdpbmVlcmluZycsXG4gICAgICAgICAgICAgICdjdXN0b206cm9sZSc6ICdzZW5pb3ItZGV2ZWxvcGVyJyxcbiAgICAgICAgICAgICAgJ2N1c3RvbTpjb21wYW55X2lkJzogJ2NvbXBhbnktMTIzJ1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnlcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtY3VzdG9tLWF0dHJzJ1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYWN0b3JJZDogJ2N1c3RvbV91c2VyJyxcbiAgICAgICAgY29nbml0bzoge1xuICAgICAgICAgIHN1YjogJ3VzZXItd2l0aC1jdXN0b20tYXR0cnMnLFxuICAgICAgICAgIHVzZXJuYW1lOiAnY3VzdG9tX3VzZXInLFxuICAgICAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgIGRlcGFydG1lbnQ6ICdlbmdpbmVlcmluZycsXG4gICAgICAgICAgICByb2xlOiAnc2VuaW9yLWRldmVsb3BlcicsXG4gICAgICAgICAgICBjb21wYW55X2lkOiAnY29tcGFueS0xMjMnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdXNlIHN1YiBhcyBmaW5hbCBmYWxsYmFjayBmb3IgYWN0b3JJZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3VzZXItc3ViLWZpbmFsLWZhbGxiYWNrJ1xuICAgICAgICAgICAgICAvLyBObyBjb2duaXRvOnVzZXJuYW1lLCBubyBlbWFpbFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnlcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtc3ViLWZhbGxiYWNrJ1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yLmFjdG9ySWQpLnRvQmUoJ3VzZXItc3ViLWZpbmFsLWZhbGxiYWNrJyk7XG4gICAgICBleHBlY3QoYWN0b3IuY29nbml0bz8uc3ViKS50b0JlKCd1c2VyLXN1Yi1maW5hbC1mYWxsYmFjaycpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgcGhvbmUgbnVtYmVyIHZlcmlmaWNhdGlvbiBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICBjb25zdCB0ZXN0Q2FzZXMgPSBbXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAndmVyaWZpZWQgcGhvbmUnLFxuICAgICAgICAgIHBob25lX251bWJlcjogJysxMjM0NTY3ODkwJyxcbiAgICAgICAgICBwaG9uZV9udW1iZXJfdmVyaWZpZWQ6ICd0cnVlJyxcbiAgICAgICAgICBleHBlY3RlZFZlcmlmaWVkOiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAndW52ZXJpZmllZCBwaG9uZScsXG4gICAgICAgICAgcGhvbmVfbnVtYmVyOiAnKzEyMzQ1Njc4OTAnLFxuICAgICAgICAgIHBob25lX251bWJlcl92ZXJpZmllZDogJ2ZhbHNlJyxcbiAgICAgICAgICBleHBlY3RlZFZlcmlmaWVkOiBmYWxzZVxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ3Bob25lIHdpdGhvdXQgdmVyaWZpY2F0aW9uIGZsYWcnLFxuICAgICAgICAgIHBob25lX251bWJlcjogJysxMjM0NTY3ODkwJyxcbiAgICAgICAgICBwaG9uZV9udW1iZXJfdmVyaWZpZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgICBleHBlY3RlZFZlcmlmaWVkOiBmYWxzZVxuICAgICAgICB9XG4gICAgICBdO1xuXG4gICAgICB0ZXN0Q2FzZXMuZm9yRWFjaCgoeyBuYW1lLCBwaG9uZV9udW1iZXIsIHBob25lX251bWJlcl92ZXJpZmllZCwgZXhwZWN0ZWRWZXJpZmllZCB9KSA9PiB7XG4gICAgICAgIGNvbnN0IGNsYWltczogYW55ID0ge1xuICAgICAgICAgIHN1YjogJ3VzZXItcGhvbmUtdGVzdCcsXG4gICAgICAgICAgJ2NvZ25pdG86dXNlcm5hbWUnOiAncGhvbmVfdXNlcicsXG4gICAgICAgICAgcGhvbmVfbnVtYmVyXG4gICAgICAgIH07XG4gICAgICAgIFxuICAgICAgICBpZiAocGhvbmVfbnVtYmVyX3ZlcmlmaWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjbGFpbXMucGhvbmVfbnVtYmVyX3ZlcmlmaWVkID0gcGhvbmVfbnVtYmVyX3ZlcmlmaWVkO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgICAgYXV0aG9yaXplcjogeyBjbGFpbXMgfVxuICAgICAgICAgIH0gYXMgYW55XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgICAgcmVxdWVzdElkOiBgcmVxLXBob25lLSR7bmFtZS5yZXBsYWNlKC9cXHMrL2csICctJyl9YFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgICAgZXhwZWN0KGFjdG9yLnBob25lTnVtYmVyKS50b0JlKHBob25lX251bWJlcik7XG4gICAgICAgIGV4cGVjdChhY3Rvci5waG9uZVZlcmlmaWVkKS50b0JlKGV4cGVjdGVkVmVyaWZpZWQpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdidWlsZEN0eCBpbnRlZ3JhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGJ1aWxkIGV4ZWN1dGlvbiBjb250ZXh0IHdpdGggYWN0b3InLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHt9KTtcbiAgICAgIFxuICAgICAgY29uc3QgY3JlYXRlTW9ja0V2ZW50Rm9yQnVpbGRDdHggPSAob3ZlcnJpZGVzOiBQYXJ0aWFsPEFQSUdhdGV3YXlFdmVudD4gPSB7fSk6IEFQSUdhdGV3YXlFdmVudCA9PiB7XG4gICAgICAgIGNvbnN0IGJhc2VFdmVudCA9IHtcbiAgICAgICAgICByZXNvdXJjZTogJy90ZXN0JyxcbiAgICAgICAgICBwYXRoOiAnL3Rlc3QnLFxuICAgICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICAgIGhlYWRlcnM6IHt9LFxuICAgICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcbiAgICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcbiAgICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgICAgcmVzb3VyY2VJZDogJ3Rlc3QnLFxuICAgICAgICAgICAgcmVzb3VyY2VQYXRoOiAnL3Rlc3QnLFxuICAgICAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QnLFxuICAgICAgICAgICAgc3RhZ2U6ICd0ZXN0JyxcbiAgICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICAgIGNvZ25pdG9JZGVudGl0eVBvb2xJZDogbnVsbCxcbiAgICAgICAgICAgICAgYWNjb3VudElkOiBudWxsLFxuICAgICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlJZDogbnVsbCxcbiAgICAgICAgICAgICAgY2FsbGVyOiBudWxsLFxuICAgICAgICAgICAgICBzb3VyY2VJcDogJzEyNy4wLjAuMScsXG4gICAgICAgICAgICAgIHByaW5jaXBhbE9yZ0lkOiBudWxsLFxuICAgICAgICAgICAgICBhY2Nlc3NLZXk6IG51bGwsXG4gICAgICAgICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblR5cGU6IG51bGwsXG4gICAgICAgICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblByb3ZpZGVyOiBudWxsLFxuICAgICAgICAgICAgICB1c2VyQXJuOiBudWxsLFxuICAgICAgICAgICAgICB1c2VyQWdlbnQ6ICd0ZXN0LWFnZW50JyxcbiAgICAgICAgICAgICAgdXNlcjogbnVsbCxcbiAgICAgICAgICAgICAgYXBpS2V5OiBudWxsLFxuICAgICAgICAgICAgICBhcGlLZXlJZDogbnVsbCxcbiAgICAgICAgICAgICAgY2xpZW50Q2VydDogbnVsbFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByb3RvY29sOiAnSFRUUC8xLjEnLFxuICAgICAgICAgICAgcmVxdWVzdFRpbWU6ICcwOS9BcHIvMjAxNToxMjozNDo1NiArMDAwMCcsXG4gICAgICAgICAgICByZXF1ZXN0VGltZUVwb2NoOiAxNDI4NTgyODk2MDAwLFxuICAgICAgICAgICAgYXBpSWQ6ICd0ZXN0LWFwaSdcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJvZHk6IG51bGwsXG4gICAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcbiAgICAgICAgfSBhcyBBUElHYXRld2F5RXZlbnQ7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAuLi5iYXNlRXZlbnQsXG4gICAgICAgICAgLi4ub3ZlcnJpZGVzLFxuICAgICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgICAuLi5iYXNlRXZlbnQucmVxdWVzdENvbnRleHQsXG4gICAgICAgICAgICAuLi5vdmVycmlkZXMucmVxdWVzdENvbnRleHRcbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgQVBJR2F0ZXdheUV2ZW50O1xuICAgICAgfTtcbiAgICAgIFxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JCdWlsZEN0eCh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3VzZXItMTIzJyxcbiAgICAgICAgICAgICAgJ2NvZ25pdG86dXNlcm5hbWUnOiAndGVzdC51c2VyJ1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnlcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBjb250ZXh0ID0ge30gYXMgQ29udGV4dDtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1jdHgtdGVzdCdcbiAgICAgIH0pO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSB7fTtcblxuICAgICAgY29uc3QgZXhlY3V0aW9uQ29udGV4dCA9IGNvbnRyb2xsZXIudGVzdEJ1aWxkQ3R4KGV2ZW50LCBjb250ZXh0LCByZXF1ZXN0LCByZXNwb25zZSk7XG5cbiAgICAgIGV4cGVjdChleGVjdXRpb25Db250ZXh0KS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgZXZlbnQsXG4gICAgICAgIGxhbWJkYUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICAgIHJlcXVlc3QsXG4gICAgICAgIHJlc3BvbnNlLFxuICAgICAgICBkZWJ1Z0luZm86IHt9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGV4ZWN1dGlvbkNvbnRleHQuYWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtY3R4LXRlc3QnLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICBhY3RvcklkOiAndGVzdC51c2VyJyxcbiAgICAgICAgY29nbml0bzoge1xuICAgICAgICAgIHN1YjogJ3VzZXItMTIzJyxcbiAgICAgICAgICB1c2VybmFtZTogJ3Rlc3QudXNlcidcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufSk7Il19