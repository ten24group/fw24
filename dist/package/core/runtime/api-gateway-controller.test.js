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
                            'custom:tenantId': 'tenant-789',
                            email: 'john@example.com'
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
                tenantId: 'tenant-789',
                correlationId: 'corr-xyz-789',
                cognito: {
                    sub: 'user-123-456',
                    username: 'john.doe',
                    groups: ['admin', 'user']
                },
                rawAuthContext: {
                    sub: 'user-123-456',
                    'cognito:username': 'john.doe',
                    'cognito:groups': 'admin,user',
                    'custom:tenantId': 'tenant-789',
                    email: 'john@example.com'
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
                },
                correlationId: 'req-def-456'
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
                },
                correlationId: 'req-header-api-key'
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
                correlationId: 'req-ghi-789'
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
                correlationId: 'req-jkl-012'
            });
        });
        it('should handle tenant ID from custom headers', () => {
            const event = createMockEventForActorTests();
            const request = createMockRequest({
                requestId: 'req-mno-345',
                headers: {
                    'x-tenant-id': 'tenant-from-header'
                }
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor.tenantId).toBe('tenant-from-header');
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
                tenantId: undefined,
                correlationId: 'req-pqr-678'
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
        it('should use sub as fallback when cognito username is not available', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    authorizer: {
                        claims: {
                            sub: 'user-sub-456',
                            username: 'fallback.username'
                        }
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-vwx-234'
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor.actorId).toBe('fallback.username');
            expect(actor.cognito?.sub).toBe('user-sub-456');
        });
        it('should extract social login identity information', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    authorizer: {
                        claims: {
                            sub: 'google-user-123',
                            'cognito:username': 'google_user',
                            email: 'user@gmail.com',
                            identities: [
                                {
                                    userId: 'google-123456789',
                                    providerName: 'Google',
                                    providerType: 'OIDC',
                                    primary: 'true'
                                }
                            ]
                        }
                    }
                }
            });
            const request = createMockRequest({
                requestId: 'req-social-login'
            });
            const actor = controller.extractActorContext(event, request);
            expect(actor).toMatchObject({
                authMethod: 'cognito',
                actorType: 'user',
                email: 'user@gmail.com',
                cognito: {
                    sub: 'google-user-123',
                    username: 'google_user',
                    identities: [
                        {
                            userId: 'google-123456789',
                            providerName: 'Google',
                            providerType: 'OIDC',
                            primary: 'true'
                        }
                    ]
                }
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
                cognitoSub: 'user-123',
                cognitoUsername: 'test.user'
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9hcGktZ2F0ZXdheS1jb250cm9sbGVyLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxRUFBeUQ7QUFJekQsaUNBQWlDO0FBQ2pDLE1BQU0sY0FBZSxTQUFRLHNDQUFhO0lBQ2pDLGNBQWMsR0FBRyxNQUFNLENBQUM7SUFDeEIsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUVuQixZQUFZLE1BQTJCO1FBQ3JDLEtBQUssRUFBRSxDQUFDO1FBQ1IsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7SUFDdkIsQ0FBQztJQUVELHFDQUFxQztJQUM5QixxQkFBcUIsQ0FBQyxXQUFvQjtRQUMvQyxPQUFRLElBQVksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRU0sb0JBQW9CLENBQUMsS0FBVTtRQUNwQyxPQUFRLElBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUMvQyxDQUFDO0lBRU0sNkJBQTZCLENBQUMsS0FBYSxFQUFFLE9BQWdCLEVBQUUsUUFBYSxFQUFFLEdBQVMsRUFBRSxLQUFhO1FBQzNHLE9BQVEsSUFBWSxDQUFDLHlCQUF5QixDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUN2RixDQUFDO0lBRU0sa0JBQWtCLENBQUMsR0FBUTtRQUNoQyxPQUFRLElBQVksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDM0MsQ0FBQztJQUVNLG1CQUFtQixDQUFDLEdBQVksRUFBRSxHQUFVLEVBQUUsR0FBUTtRQUMzRCxPQUFRLElBQVksQ0FBQyxlQUFlLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRU0sWUFB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Q0FBQyxDQUFDO1lBRUYsTUFBTSxLQUFLLEdBQUcsMEJBQTBCLENBQUM7Z0JBQ3ZDLGNBQWMsRUFBRTtvQkFDZCxVQUFVLEVBQUU7d0JBQ1YsTUFBTSxFQUFFOzRCQUNOLEdBQUcsRUFBRSxVQUFVOzRCQUNmLGtCQUFrQixFQUFFLFdBQVc7eUJBQ2hDO3FCQUNGO2lCQUNLO2FBQ1QsQ0FBQyxDQUFDO1lBRUgsTUFBTSxPQUFPLEdBQUcsRUFBYSxDQUFDO1lBQzlCLE1BQU0sT0FBTyxHQUFHLGlCQUFpQixDQUFDO2dCQUNoQyxTQUFTLEVBQUUsY0FBYzthQUMxQixDQUFDLENBQUM7WUFDSCxNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUM7WUFFcEIsTUFBTSxnQkFBZ0IsR0FBRyxVQUFVLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1lBRXBGLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDckMsS0FBSztnQkFDTCxhQUFhLEVBQUUsT0FBTztnQkFDdEIsT0FBTztnQkFDUCxRQUFRO2dCQUNSLFNBQVMsRUFBRSxFQUFFO2FBQ2QsQ0FBQyxDQUFDO1lBRUgsTUFBTSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDM0MsU0FBUyxFQUFFLGNBQWM7Z0JBQ3pCLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixTQUFTLEVBQUUsTUFBTTtnQkFDakIsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLFVBQVUsRUFBRSxVQUFVO2dCQUN0QixlQUFlLEVBQUUsV0FBVzthQUM3QixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElDb250cm9sbGVyIH0gZnJvbSAnLi9hcGktZ2F0ZXdheS1jb250cm9sbGVyJztcbmltcG9ydCB0eXBlIHsgUmVxdWVzdCB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHR5cGUgeyBBUElHYXRld2F5RXZlbnQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcblxuLy8gQ3JlYXRlIGEgdGVzdCBjb250cm9sbGVyIGNsYXNzXG5jbGFzcyBUZXN0Q29udHJvbGxlciBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICBwdWJsaWMgY29udHJvbGxlck5hbWUgPSAndGVzdCc7XG4gIHB1YmxpYyByb3V0ZXMgPSB7fTtcblxuICBjb25zdHJ1Y3Rvcihyb3V0ZXM6IFJlY29yZDxzdHJpbmcsIGFueT4pIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucm91dGVzID0gcm91dGVzO1xuICB9XG5cbiAgLy8gRXhwb3NlIHByaXZhdGUgbWV0aG9kcyBmb3IgdGVzdGluZ1xuICBwdWJsaWMgdGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3REYXRhOiBSZXF1ZXN0KSB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuZmluZE1hdGNoaW5nUm91dGUocmVxdWVzdERhdGEpO1xuICB9XG5cbiAgcHVibGljIHRlc3RHZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlOiBhbnkpIHtcbiAgICByZXR1cm4gKHRoaXMgYXMgYW55KS5nZXRSb3V0ZUZ1bmN0aW9uKHJvdXRlKTtcbiAgfVxuXG4gIHB1YmxpYyB0ZXN0RXhlY3V0ZU1pZGRsZXdhcmVQaXBlbGluZShwaGFzZTogc3RyaW5nLCByZXF1ZXN0OiBSZXF1ZXN0LCByZXNwb25zZTogYW55LCBjdHg/OiBhbnksIGVycm9yPzogRXJyb3IpIHtcbiAgICByZXR1cm4gKHRoaXMgYXMgYW55KS5leGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKHBoYXNlLCByZXF1ZXN0LCByZXNwb25zZSwgY3R4LCBlcnJvcik7XG4gIH1cblxuICBwdWJsaWMgdGVzdEhhbmRsZVJlc3BvbnNlKHJlczogYW55KSB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuaGFuZGxlUmVzcG9uc2UocmVzKTtcbiAgfVxuXG4gIHB1YmxpYyB0ZXN0SGFuZGxlRXhjZXB0aW9uKHJlcTogUmVxdWVzdCwgZXJyOiBFcnJvciwgcmVzOiBhbnkpIHtcbiAgICByZXR1cm4gKHRoaXMgYXMgYW55KS5oYW5kbGVFeGNlcHRpb24ocmVxLCBlcnIsIHJlcyk7XG4gIH1cblxuICBwdWJsaWMgdGVzdEJ1aWxkQ3R4KGV2ZW50OiBBUElHYXRld2F5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBhbnkpIHtcbiAgICByZXR1cm4gKHRoaXMgYXMgYW55KS5idWlsZEN0eChldmVudCwgY29udGV4dCwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuICB9XG5cbiAgLy8gRXhwb3NlIG1pZGRsZXdhcmUgcmVnaXN0cmF0aW9uIGZvciB0ZXN0aW5nXG4gIHB1YmxpYyB0ZXN0VXNlTWlkZGxld2FyZShtaWRkbGV3YXJlOiBhbnkpIHtcbiAgICB0aGlzLnVzZU1pZGRsZXdhcmUobWlkZGxld2FyZSk7XG4gIH1cblxuICAvLyBFeHBvc2UgcHJvdGVjdGVkIG1ldGhvZHMgZm9yIHRlc3RpbmdcbiAgcHVibGljIHRlc3RIYW5kbGVOb3RGb3VuZChyZXE6IFJlcXVlc3QpIHtcbiAgICByZXR1cm4gdGhpcy5oYW5kbGVOb3RGb3VuZChyZXEpO1xuICB9XG5cbiAgLy8gVGVzdCBoYW5kbGVyIG1ldGhvZHNcbiAgcHVibGljIHRlc3RIYW5kbGVyKCkge1xuICAgIHJldHVybiB7IG1lc3NhZ2U6ICd0ZXN0IGhhbmRsZXIgY2FsbGVkJyB9O1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHRlc3RBc3luY0hhbmRsZXIoKSB7XG4gICAgcmV0dXJuIHsgbWVzc2FnZTogJ2FzeW5jIHRlc3QgaGFuZGxlciBjYWxsZWQnIH07XG4gIH1cblxuICBwdWJsaWMgdGVzdEhhbmRsZXJXaXRoRXJyb3IoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdUZXN0IGhhbmRsZXIgZXJyb3InKTtcbiAgfVxuXG4gIC8vIFJlcXVpcmVkIGFic3RyYWN0IG1ldGhvZFxuICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogQVBJR2F0ZXdheUV2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIE5vLW9wIGZvciB0ZXN0aW5nXG4gIH1cbn1cblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBtb2NrIFJlcXVlc3Qgb2JqZWN0c1xuZnVuY3Rpb24gY3JlYXRlTW9ja1JlcXVlc3Qob3ZlcnJpZGVzOiBQYXJ0aWFsPFJlcXVlc3Q+ID0ge30pOiBSZXF1ZXN0IHtcbiAgY29uc3QgbW9ja0V2ZW50ID0ge30gYXMgQVBJR2F0ZXdheUV2ZW50O1xuICBjb25zdCBtb2NrQ29udGV4dCA9IHt9IGFzIENvbnRleHQ7XG5cbiAgcmV0dXJuIHtcbiAgICBldmVudDogbW9ja0V2ZW50LFxuICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXG4gICAgY29udGV4dDogbW9ja0NvbnRleHQsXG4gICAgcmVzb3VyY2U6ICcvdGVzdCcsXG4gICAgYm9keToge30sXG4gICAgcGF0aDogJy90ZXN0JyxcbiAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHt9LFxuICAgIGhlYWRlcnM6IHt9LFxuICAgIHJlcXVlc3RDb250ZXh0OiB7fSxcbiAgICBzdGFnZVZhcmlhYmxlczoge30sXG4gICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXG4gICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgZGVidWdNb2RlOiBmYWxzZSxcbiAgICBnZXRQYXJhbTogamVzdC5mbigpLFxuICAgIGhhc1BhcmFtOiBqZXN0LmZuKCksXG4gICAgZ2V0SGVhZGVyOiBqZXN0LmZuKCksXG4gICAgaGFzSGVhZGVyOiBqZXN0LmZuKCksXG4gICAgZ2V0UGF0aFBhcmFtOiBqZXN0LmZuKCksXG4gICAgaGFzUGF0aFBhcmFtOiBqZXN0LmZuKCksXG4gICAgZ2V0UXVlcnlQYXJhbTogamVzdC5mbigpLFxuICAgIGhhc1F1ZXJ5UGFyYW06IGplc3QuZm4oKSxcbiAgICBnZXRCb2R5UGFyYW06IGplc3QuZm4oKSxcbiAgICBoYXNCb2R5UGFyYW06IGplc3QuZm4oKSxcbiAgICAuLi5vdmVycmlkZXMsXG4gIH07XG59XG5cbmRlc2NyaWJlKCdBUElHYXRld2F5Q29udHJvbGxlciBSb3V0ZSBNYXRjaGluZycsICgpID0+IHtcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdmaW5kTWF0Y2hpbmdSb3V0ZSAtIENvcmUgRnVuY3Rpb25hbGl0eScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb21wcmVoZW5zaXZlIHJvdXRlIG1hdGNoaW5nIHNjZW5hcmlvcycsICgpID0+IHtcbiAgICAgIGNvbnN0IHJvdXRlcyA9IHtcbiAgICAgICAgLy8gRXhhY3Qgcm91dGVzXG4gICAgICAgICdHRVR8Lyc6IHsgaGFuZGxlcjogJ2luZGV4JyB9LFxuICAgICAgICAnR0VUfC91c2Vycyc6IHsgaGFuZGxlcjogJ2xpc3RVc2VycycgfSxcbiAgICAgICAgJ1BPU1R8L3VzZXJzJzogeyBoYW5kbGVyOiAnY3JlYXRlVXNlcicgfSxcblxuICAgICAgICAvLyBTaW5nbGUgcGFyYW1ldGVyXG4gICAgICAgICdHRVR8L3tpZH0nOiB7IGhhbmRsZXI6ICdnZXRCeUlkJyB9LFxuICAgICAgICAnREVMRVRFfC97aWR9JzogeyBoYW5kbGVyOiAnZGVsZXRlQnlJZCcgfSxcblxuICAgICAgICAvLyBNdWx0aXBsZSBwYXJhbWV0ZXJzICBcbiAgICAgICAgJ0dFVHwve2FiY30ve2RlZn0ve3h5en0nOiB7IGhhbmRsZXI6ICdnZXRUcmlwbGVQYXJhbXMnIH0sXG4gICAgICAgICdHRVR8L3VzZXJzL3t1c2VySWR9L3Bvc3RzL3twb3N0SWR9JzogeyBoYW5kbGVyOiAnZ2V0VXNlclBvc3QnIH0sXG5cbiAgICAgICAgLy8gTWl4ZWQgc3RhdGljL2R5bmFtaWNcbiAgICAgICAgJ0dFVHwvdGVhbXMve3RlYW1JZH0vY2F0ZWdvcmllcy97Y2F0ZWdvcnlJZH0vcG9zdHMve3Bvc3RJZH0nOiB7IGhhbmRsZXI6ICdnZXRUZWFtQ2F0ZWdvcnlQb3N0JyB9LFxuXG4gICAgICAgIC8vIFByaW9yaXRpemF0aW9uIHRlc3Qgcm91dGVzXG4gICAgICAgICdHRVR8L3tyZXNvdXJjZX0nOiB7IGhhbmRsZXI6ICdnZXRSZXNvdXJjZScgfSxcbiAgICAgICAgJ0dFVHwve2NhdGVnb3J5fS97YWN0aW9ufSc6IHsgaGFuZGxlcjogJ2dldENhdGVnb3J5QWN0aW9uJyB9LFxuICAgICAgICAnR0VUfC91c2Vycy97dXNlcklkfSc6IHsgaGFuZGxlcjogJ2dldFVzZXJCeUlkJyB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcihyb3V0ZXMpO1xuXG4gICAgICAvLyBUZXN0IGV4YWN0IHJvdXRlIG1hdGNoaW5nXG4gICAgICBsZXQgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnaW5kZXgnIH0pO1xuXG4gICAgICAvLyBUZXN0IHNpbmdsZSBwYXJhbWV0ZXJcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0LzEyMycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGlkOiAnMTIzJyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0QnlJZCcgfSk7XG5cbiAgICAgIC8vIFRlc3QgbXVsdGlwbGUgcGFyYW1ldGVyc1xuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdmFsMS92YWwyL3ZhbDMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBhYmM6ICd2YWwxJywgZGVmOiAndmFsMicsIHh5ejogJ3ZhbDMnIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRUcmlwbGVQYXJhbXMnIH0pO1xuXG4gICAgICAvLyBUZXN0IGNvbXBsZXggbmVzdGVkIHJvdXRlXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC90ZWFtcy90ZWFtLTEvY2F0ZWdvcmllcy9uZXdzL3Bvc3RzL3Bvc3QtMTIzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgdGVhbUlkOiAndGVhbS0xJywgY2F0ZWdvcnlJZDogJ25ld3MnLCBwb3N0SWQ6ICdwb3N0LTEyMycgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldFRlYW1DYXRlZ29yeVBvc3QnIH0pO1xuXG4gICAgICAvLyBUZXN0IGV4YWN0IG1hdGNoIHByaW9yaXR5IG92ZXIgcGFyYW1ldGVyaXplZFxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdXNlcnMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdsaXN0VXNlcnMnIH0pO1xuXG4gICAgICAvLyBUZXN0IHNwZWNpZmljIHBhcmFtZXRlcml6ZWQgcm91dGUgcHJpb3JpdHkgb3ZlciBnZW5lcmFsXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC91c2Vycy8xMjMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyB1c2VySWQ6ICcxMjMnIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRVc2VyQnlJZCcgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBuZWdhdGl2ZSBjYXNlcyBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICBjb25zdCByb3V0ZXMgPSB7XG4gICAgICAgICdHRVR8L3thYmN9L3tkZWZ9L3t4eXp9JzogeyBoYW5kbGVyOiAnZ2V0VHJpcGxlUGFyYW1zJyB9LFxuICAgICAgICAnUE9TVHwve2lkfSc6IHsgaGFuZGxlcjogJ3VwZGF0ZUJ5SWQnIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHJvdXRlcyk7XG5cbiAgICAgIC8vIFdyb25nIG51bWJlciBvZiBzZWdtZW50c1xuICAgICAgbGV0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L3ZhbHVlMS92YWx1ZTInLCAvLyBUb28gZmV3XG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGFiYzogJ3ZhbHVlMScsIGRlZjogJ3ZhbHVlMicgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0JlTnVsbCgpO1xuXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC92YWx1ZTEvdmFsdWUyL3ZhbHVlMy9leHRyYScsIC8vIFRvbyBtYW55XG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGFiYzogJ3ZhbHVlMScsIGRlZjogJ3ZhbHVlMicsIHh5ejogJ3ZhbHVlMycgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0JlTnVsbCgpO1xuXG4gICAgICAvLyBXcm9uZyBIVFRQIG1ldGhvZFxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0RFTEVURScsIC8vIFNob3VsZCBiZSBQT1NUXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvMTIzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICcxMjMnIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9CZU51bGwoKTtcblxuICAgICAgLy8gTm8gbWF0Y2hpbmcgcm91dGVcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L25vbmV4aXN0ZW50L3JvdXRlJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvQmVOdWxsKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb250cm9sbGVyIG5hbWVzIHdpdGggc2xhc2hlcycsICgpID0+IHtcbiAgICAgIGNvbnN0IHJvdXRlcyA9IHtcbiAgICAgICAgJ0dFVHwvaW5kaWNlcyc6IHsgaGFuZGxlcjogJ2dldEluZGljZXMnIH0sXG4gICAgICAgICdQT1NUfC9yZWluZGV4L3tlbnRpdHl9JzogeyBoYW5kbGVyOiAncmVpbmRleEVudGl0eScgfSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIocm91dGVzKTtcbiAgICAgIGNvbnRyb2xsZXIuY29udHJvbGxlck5hbWUgPSAnc3lzdGVtL3NlYXJjaCc7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy9zeXN0ZW0vc2VhcmNoL2luZGljZXMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldEluZGljZXMnIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZmluZE1hdGNoaW5nUm91dGUgLSBFZGdlIENhc2VzICYgUm9idXN0bmVzcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlZGdlIGNhc2VzIGFuZCBwYXJhbWV0ZXIgdmFyaWF0aW9ucycsICgpID0+IHtcbiAgICAgIGNvbnN0IHJvdXRlcyA9IHtcbiAgICAgICAgJ0dFVHwve2lkfSc6IHsgaGFuZGxlcjogJ2dldEJ5SWQnIH0sXG4gICAgICAgICdHRVR8L3thfS97Yn0ve2N9L3tkfS97ZX0nOiB7IGhhbmRsZXI6ICdnZXRGaXZlUGFyYW1zJyB9LFxuICAgICAgICAnUE9TVHwve2NvdW50cnl9L3tzdGF0ZX0ve2NpdHl9L3tkaXN0cmljdH0ve3N0cmVldH0ve2J1aWxkaW5nfSc6IHsgaGFuZGxlcjogJ2dldFNpeFBhcmFtcycgfSxcbiAgICAgICAgJ1BVVHwve2lkfSc6IHsgaGFuZGxlcjogJ3VwZGF0ZUJ5SWQnIH0sXG4gICAgICAgICdERUxFVEV8L3tpZH0nOiB7IGhhbmRsZXI6ICdkZWxldGVCeUlkJyB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcihyb3V0ZXMpO1xuXG4gICAgICAvLyBFbXB0eSByb3V0ZXMgb2JqZWN0XG4gICAgICBjb25zdCBlbXB0eUNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIoe30pO1xuICAgICAgbGV0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L2FueXRoaW5nJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoZW1wdHlDb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9CZU51bGwoKTtcblxuICAgICAgLy8gU3BlY2lhbCBjaGFyYWN0ZXJzIGluIHBhcmFtZXRlcnNcbiAgICAgIGNvbnN0IHNwZWNpYWxDaGFyQ2FzZXMgPSBbICdhYmMtMTIzJywgJ3VzZXJfNDU2JywgJzk5OScsICdzcGVjaWFsJTIwY2hhcnMnIF07XG4gICAgICBzcGVjaWFsQ2hhckNhc2VzLmZvckVhY2goaWQgPT4ge1xuICAgICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICAgIHJlc291cmNlOiBgL3Rlc3QvJHtpZH1gLFxuICAgICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGlkIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0QnlJZCcgfSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gVmVyeSBsb25nIHBhcmFtZXRlclxuICAgICAgY29uc3QgbG9uZ0lkID0gJ2EnLnJlcGVhdCgxMDAwKTtcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogYC90ZXN0LyR7bG9uZ0lkfWAsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGlkOiBsb25nSWQgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldEJ5SWQnIH0pO1xuXG4gICAgICAvLyBNdWx0aXBsZSBIVFRQIG1ldGhvZHNcbiAgICAgIGNvbnN0IGh0dHBNZXRob2RzID0gWyAnR0VUJywgJ1BVVCcsICdERUxFVEUnIF07XG4gICAgICBjb25zdCBleHBlY3RlZEhhbmRsZXJzID0gWyAnZ2V0QnlJZCcsICd1cGRhdGVCeUlkJywgJ2RlbGV0ZUJ5SWQnIF07XG4gICAgICBodHRwTWV0aG9kcy5mb3JFYWNoKChtZXRob2QsIGluZGV4KSA9PiB7XG4gICAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgICAgaHR0cE1ldGhvZDogbWV0aG9kLFxuICAgICAgICAgIHJlc291cmNlOiAnL3Rlc3QvMTIzJyxcbiAgICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJzEyMycgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6IGV4cGVjdGVkSGFuZGxlcnNbIGluZGV4IF0gfSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gUm91dGVzIHdpdGggbWFueSBwYXJhbWV0ZXJzXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC8xLzIvMy80LzUnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBhOiAnMScsIGI6ICcyJywgYzogJzMnLCBkOiAnNCcsIGU6ICc1JyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0Rml2ZVBhcmFtcycgfSk7XG5cbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC9VUy9DQS9TRi9Eb3dudG93bi9NYWluLzEyMycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgY291bnRyeTogJ1VTJywgc3RhdGU6ICdDQScsIGNpdHk6ICdTRicsXG4gICAgICAgICAgZGlzdHJpY3Q6ICdEb3dudG93bicsIHN0cmVldDogJ01haW4nLCBidWlsZGluZzogJzEyMydcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldFNpeFBhcmFtcycgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdmaW5kTWF0Y2hpbmdSb3V0ZSAtIEFkdmFuY2VkIFNjZW5hcmlvcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb21wbGV4IGNvbnRyb2xsZXIgbmFtZXMgYW5kIFJFU1QgcGF0dGVybnMnLCAoKSA9PiB7XG4gICAgICAvLyBUZXN0IG5lc3RlZCBjb250cm9sbGVyIG5hbWVzXG4gICAgICBjb25zdCBuZXN0ZWRSb3V0ZXMgPSB7XG4gICAgICAgICdHRVR8L3N0YXR1cyc6IHsgaGFuZGxlcjogJ2dldFN0YXR1cycgfSxcbiAgICAgICAgJ1BPU1R8L2FjdGlvbnMve2FjdGlvbklkfSc6IHsgaGFuZGxlcjogJ2V4ZWN1dGVBY3Rpb24nIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBuZXN0ZWRDb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKG5lc3RlZFJvdXRlcyk7XG4gICAgICBuZXN0ZWRDb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lID0gJ2FkbWluL3N5c3RlbS9tb25pdG9yaW5nL2hlYWx0aCc7XG5cbiAgICAgIGxldCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvYWRtaW4vc3lzdGVtL21vbml0b3JpbmcvaGVhbHRoL3N0YXR1cycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KG5lc3RlZENvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldFN0YXR1cycgfSk7XG5cbiAgICAgIC8vIFRlc3QgY29udHJvbGxlciBuYW1lcyB3aXRoIHNwZWNpYWwgY2hhcmFjdGVyc1xuICAgICAgY29uc3Qgc3BlY2lhbENvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIoeyAnR0VUfC90ZXN0JzogeyBoYW5kbGVyOiAndGVzdCcgfSB9KTtcbiAgICAgIHNwZWNpYWxDb250cm9sbGVyLmNvbnRyb2xsZXJOYW1lID0gJ2FwaS12MS4yL3VzZXItbWFuYWdlbWVudCc7XG5cbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy9hcGktdjEuMi91c2VyLW1hbmFnZW1lbnQvdGVzdCcsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHNwZWNpYWxDb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICd0ZXN0JyB9KTtcblxuICAgICAgLy8gVGVzdCBjb21wcmVoZW5zaXZlIFJFU1QgQVBJIHBhdHRlcm5zXG4gICAgICBjb25zdCByZXN0Um91dGVzID0ge1xuICAgICAgICAnR0VUfC8nOiB7IGhhbmRsZXI6ICdsaXN0JyB9LFxuICAgICAgICAnUE9TVHwvJzogeyBoYW5kbGVyOiAnY3JlYXRlJyB9LFxuICAgICAgICAnR0VUfC97aWR9JzogeyBoYW5kbGVyOiAnZ2V0JyB9LFxuICAgICAgICAnUFVUfC97aWR9JzogeyBoYW5kbGVyOiAndXBkYXRlJyB9LFxuICAgICAgICAnREVMRVRFfC97aWR9JzogeyBoYW5kbGVyOiAnZGVsZXRlJyB9LFxuICAgICAgICAnR0VUfC97aWR9L3JlbGF0aW9uc2hpcHMnOiB7IGhhbmRsZXI6ICdnZXRSZWxhdGlvbnNoaXBzJyB9LFxuICAgICAgICAnUE9TVHwve2lkfS9yZWxhdGlvbnNoaXBzL3tyZWxhdGlvbnNoaXBUeXBlfSc6IHsgaGFuZGxlcjogJ2FkZFJlbGF0aW9uc2hpcCcgfSxcbiAgICAgICAgJ0dFVHwvdGVhbXMve3RlYW1JZH0vcHJvamVjdHMve3Byb2plY3RJZH0vdGFza3Mve3Rhc2tJZH0nOiB7IGhhbmRsZXI6ICdnZXRQcm9qZWN0VGFzaycgfSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3RDb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHJlc3RSb3V0ZXMpO1xuXG4gICAgICBjb25zdCB0ZXN0Q2FzZXMgPSBbXG4gICAgICAgIHsgbWV0aG9kOiAnR0VUJywgcGF0aDogJy90ZXN0LycsIHBhcmFtczoge30sIGV4cGVjdGVkOiAnbGlzdCcgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdQT1NUJywgcGF0aDogJy90ZXN0LycsIHBhcmFtczoge30sIGV4cGVjdGVkOiAnY3JlYXRlJyB9LFxuICAgICAgICB7IG1ldGhvZDogJ0dFVCcsIHBhdGg6ICcvdGVzdC8xMjMnLCBwYXJhbXM6IHsgaWQ6ICcxMjMnIH0sIGV4cGVjdGVkOiAnZ2V0JyB9LFxuICAgICAgICB7IG1ldGhvZDogJ1BVVCcsIHBhdGg6ICcvdGVzdC8xMjMnLCBwYXJhbXM6IHsgaWQ6ICcxMjMnIH0sIGV4cGVjdGVkOiAndXBkYXRlJyB9LFxuICAgICAgICB7IG1ldGhvZDogJ0RFTEVURScsIHBhdGg6ICcvdGVzdC8xMjMnLCBwYXJhbXM6IHsgaWQ6ICcxMjMnIH0sIGV4cGVjdGVkOiAnZGVsZXRlJyB9LFxuICAgICAgICB7IG1ldGhvZDogJ0dFVCcsIHBhdGg6ICcvdGVzdC8xMjMvcmVsYXRpb25zaGlwcycsIHBhcmFtczogeyBpZDogJzEyMycgfSwgZXhwZWN0ZWQ6ICdnZXRSZWxhdGlvbnNoaXBzJyB9LFxuICAgICAgICB7IG1ldGhvZDogJ1BPU1QnLCBwYXRoOiAnL3Rlc3QvMTIzL3JlbGF0aW9uc2hpcHMvZnJpZW5kcycsIHBhcmFtczogeyBpZDogJzEyMycsIHJlbGF0aW9uc2hpcFR5cGU6ICdmcmllbmRzJyB9LCBleHBlY3RlZDogJ2FkZFJlbGF0aW9uc2hpcCcgfSxcbiAgICAgICAgeyBtZXRob2Q6ICdHRVQnLCBwYXRoOiAnL3Rlc3QvdGVhbXMvdDEvcHJvamVjdHMvcDIvdGFza3MvdGFzazMnLCBwYXJhbXM6IHsgdGVhbUlkOiAndDEnLCBwcm9qZWN0SWQ6ICdwMicsIHRhc2tJZDogJ3Rhc2szJyB9LCBleHBlY3RlZDogJ2dldFByb2plY3RUYXNrJyB9LFxuICAgICAgXTtcblxuICAgICAgdGVzdENhc2VzLmZvckVhY2goKHsgbWV0aG9kLCBwYXRoLCBwYXJhbXMsIGV4cGVjdGVkIH0pID0+IHtcbiAgICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgICBodHRwTWV0aG9kOiBtZXRob2QsXG4gICAgICAgICAgcmVzb3VyY2U6IHBhdGgsXG4gICAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHBhcmFtcyxcbiAgICAgICAgfSk7XG4gICAgICAgIGV4cGVjdChyZXN0Q29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiBleHBlY3RlZCB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZmluZE1hdGNoaW5nUm91dGUgLSBFcnJvciBSZXNpbGllbmNlJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVycm9yIGNvbmRpdGlvbnMgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIC8vIFRlc3QgbWFsZm9ybWVkIHJvdXRlIGtleXNcbiAgICAgIGNvbnN0IG1hbGZvcm1lZFJvdXRlcyA9IHtcbiAgICAgICAgJ0dFVHwvdmFsaWQnOiB7IGhhbmRsZXI6ICd2YWxpZCcgfSxcbiAgICAgICAgJ0lOVkFMSURfUk9VVEUnOiB7IGhhbmRsZXI6ICdpbnZhbGlkJyB9LCAvLyBNaXNzaW5nIHBpcGUgc2VwYXJhdG9yXG4gICAgICAgICdQT1NUfCc6IHsgaGFuZGxlcjogJ2VtcHR5JyB9LCAvLyBFbXB0eSBwYXRoXG4gICAgICAgICd8L25vLW1ldGhvZCc6IHsgaGFuZGxlcjogJ25vTWV0aG9kJyB9LCAvLyBNaXNzaW5nIG1ldGhvZFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcihtYWxmb3JtZWRSb3V0ZXMpO1xuXG4gICAgICAvLyBWYWxpZCByb3V0ZSBzaG91bGQgc3RpbGwgd29yayBkZXNwaXRlIG1hbGZvcm1lZCBvbmVzXG4gICAgICBsZXQgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdmFsaWQnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICd2YWxpZCcgfSk7XG5cbiAgICAgIC8vIFRlc3QgZW1wdHkgY29udHJvbGxlciBuYW1lXG4gICAgICBjb25zdCBlbXB0eU5hbWVDb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHt9KTtcbiAgICAgIGVtcHR5TmFtZUNvbnRyb2xsZXIuY29udHJvbGxlck5hbWUgPSAnJztcblxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL2FueXRoaW5nJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdCgoKSA9PiBlbXB0eU5hbWVDb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkubm90LnRvVGhyb3coKTtcbiAgICAgIGV4cGVjdChlbXB0eU5hbWVDb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9CZU51bGwoKTtcblxuICAgICAgLy8gVGVzdCByb3V0ZXMgd2l0aCBhZGRpdGlvbmFsIG1ldGFkYXRhXG4gICAgICBjb25zdCBtZXRhZGF0YVJvdXRlcyA9IHtcbiAgICAgICAgJ0dFVHwvdXNlcnMnOiB7XG4gICAgICAgICAgaGFuZGxlcjogJ2dldFVzZXJzJyxcbiAgICAgICAgICBtaWRkbGV3YXJlOiBbICdhdXRoJywgJ2xvZ2dpbmcnIF0sXG4gICAgICAgICAgY2FjaGU6IHRydWUsXG4gICAgICAgICAgdGltZW91dDogMzAwMDBcbiAgICAgICAgfSxcbiAgICAgICAgJ1BPU1R8L3tpZH0nOiB7XG4gICAgICAgICAgaGFuZGxlcjogJ3VwZGF0ZVVzZXInLFxuICAgICAgICAgIHZhbGlkYXRpb25zOiB7IGJvZHk6IHsgcmVxdWlyZWQ6IHRydWUgfSB9LFxuICAgICAgICAgIHJhdGVMaW1pdDogMTAwXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtZXRhZGF0YUNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIobWV0YWRhdGFSb3V0ZXMpO1xuXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC91c2VycycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KG1ldGFkYXRhQ29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoe1xuICAgICAgICBoYW5kbGVyOiAnZ2V0VXNlcnMnLFxuICAgICAgICBtaWRkbGV3YXJlOiBbICdhdXRoJywgJ2xvZ2dpbmcnIF0sXG4gICAgICAgIGNhY2hlOiB0cnVlLFxuICAgICAgICB0aW1lb3V0OiAzMDAwMFxuICAgICAgfSk7XG5cbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC8xMjMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJzEyMycgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KG1ldGFkYXRhQ29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoe1xuICAgICAgICBoYW5kbGVyOiAndXBkYXRlVXNlcicsXG4gICAgICAgIHZhbGlkYXRpb25zOiB7IGJvZHk6IHsgcmVxdWlyZWQ6IHRydWUgfSB9LFxuICAgICAgICByYXRlTGltaXQ6IDEwMFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdBUElHYXRld2F5Q29udHJvbGxlciBDb3JlIEZ1bmN0aW9uYWxpdHknLCAoKSA9PiB7XG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xuICB9KTtcblxuICBkZXNjcmliZSgncm91dGUgZnVuY3Rpb24gcmVzb2x1dGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJldHVybiBoYW5kbGVyIGZ1bmN0aW9uIGZvciB2YWxpZCByb3V0ZXMsIDQwNCBoYW5kbGVyIG90aGVyd2lzZScsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIoe30pO1xuXG4gICAgICAvLyBWYWxpZCByb3V0ZVxuICAgICAgY29uc3QgdmFsaWRSb3V0ZSA9IHsgZnVuY3Rpb25OYW1lOiAndGVzdEhhbmRsZXInIH07XG4gICAgICBjb25zdCB2YWxpZEZ1bmN0aW9uID0gY29udHJvbGxlci50ZXN0R2V0Um91dGVGdW5jdGlvbih2YWxpZFJvdXRlKTtcbiAgICAgIGV4cGVjdCh2YWxpZEZ1bmN0aW9uLmNhbGwoY29udHJvbGxlcikpLnRvRXF1YWwoeyBtZXNzYWdlOiAndGVzdCBoYW5kbGVyIGNhbGxlZCcgfSk7XG5cbiAgICAgIC8vIEludmFsaWQgcm91dGVzIGFsbCByZXR1cm4gNDA0XG4gICAgICBbIG51bGwsIHsgZnVuY3Rpb25OYW1lOiAnbm9uRXhpc3RlbnQnIH0sIHsgZnVuY3Rpb25OYW1lOiAnbm90QUZ1bmN0aW9uJyB9IF0uZm9yRWFjaChyb3V0ZSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdEdldFJvdXRlRnVuY3Rpb24ocm91dGUpLmNhbGwoY29udHJvbGxlciwgY3JlYXRlTW9ja1JlcXVlc3QoKSk7XG4gICAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg0MDQpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdBY3RvciBDb250ZXh0IEV4dHJhY3Rpb24nLCAoKSA9PiB7XG4gICAgbGV0IGNvbnRyb2xsZXI6IFRlc3RDb250cm9sbGVyO1xuXG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICBjb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHt9KTtcbiAgICB9KTtcblxuICAgIC8vIEhlbHBlciB0byBjcmVhdGUgbW9jayBBUElHYXRld2F5RXZlbnRcbiAgICBjb25zdCBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzID0gKG92ZXJyaWRlczogUGFydGlhbDxBUElHYXRld2F5RXZlbnQ+ID0ge30pOiBBUElHYXRld2F5RXZlbnQgPT4ge1xuICAgICAgY29uc3QgYmFzZUV2ZW50ID0ge1xuICAgICAgICByZXNvdXJjZTogJy90ZXN0JyxcbiAgICAgICAgcGF0aDogJy90ZXN0JyxcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIGhlYWRlcnM6IHt9LFxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIHJlc291cmNlSWQ6ICd0ZXN0JyxcbiAgICAgICAgICByZXNvdXJjZVBhdGg6ICcvdGVzdCcsXG4gICAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0JyxcbiAgICAgICAgICBzdGFnZTogJ3Rlc3QnLFxuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlQb29sSWQ6IG51bGwsXG4gICAgICAgICAgICBhY2NvdW50SWQ6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlJZDogbnVsbCxcbiAgICAgICAgICAgIGNhbGxlcjogbnVsbCxcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMTI3LjAuMC4xJyxcbiAgICAgICAgICAgIHByaW5jaXBhbE9yZ0lkOiBudWxsLFxuICAgICAgICAgICAgYWNjZXNzS2V5OiBudWxsLFxuICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uVHlwZTogbnVsbCxcbiAgICAgICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblByb3ZpZGVyOiBudWxsLFxuICAgICAgICAgICAgdXNlckFybjogbnVsbCxcbiAgICAgICAgICAgIHVzZXJBZ2VudDogJ3Rlc3QtYWdlbnQnLFxuICAgICAgICAgICAgdXNlcjogbnVsbCxcbiAgICAgICAgICAgIGFwaUtleTogbnVsbCxcbiAgICAgICAgICAgIGFwaUtleUlkOiBudWxsLFxuICAgICAgICAgICAgY2xpZW50Q2VydDogbnVsbFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJvdG9jb2w6ICdIVFRQLzEuMScsXG4gICAgICAgICAgcmVxdWVzdFRpbWU6ICcwOS9BcHIvMjAxNToxMjozNDo1NiArMDAwMCcsXG4gICAgICAgICAgcmVxdWVzdFRpbWVFcG9jaDogMTQyODU4Mjg5NjAwMCxcbiAgICAgICAgICBhcGlJZDogJ3Rlc3QtYXBpJ1xuICAgICAgICB9LFxuICAgICAgICBib2R5OiBudWxsLFxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxuICAgICAgfSBhcyBBUElHYXRld2F5RXZlbnQ7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmJhc2VFdmVudCxcbiAgICAgICAgLi4ub3ZlcnJpZGVzLFxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIC4uLmJhc2VFdmVudC5yZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgICAuLi5vdmVycmlkZXMucmVxdWVzdENvbnRleHRcbiAgICAgICAgfVxuICAgICAgfSBhcyBBUElHYXRld2F5RXZlbnQ7XG4gICAgfTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBhY3RvciBjb250ZXh0IGZyb20gQ29nbml0byBhdXRob3JpemF0aW9uJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICd1c2VyLWFnZW50JzogJ01vemlsbGEvNS4wIENocm9tZS85MS4wJ1xuICAgICAgICB9LFxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xMDAnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdXRob3JpemVyOiB7XG4gICAgICAgICAgICBjbGFpbXM6IHtcbiAgICAgICAgICAgICAgc3ViOiAndXNlci0xMjMtNDU2JyxcbiAgICAgICAgICAgICAgJ2NvZ25pdG86dXNlcm5hbWUnOiAnam9obi5kb2UnLFxuICAgICAgICAgICAgICAnY29nbml0bzpncm91cHMnOiAnYWRtaW4sdXNlcicsXG4gICAgICAgICAgICAgICdjdXN0b206dGVuYW50SWQnOiAndGVuYW50LTc4OScsXG4gICAgICAgICAgICAgIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbSdcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWFiYy0xMjMnLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ3gtY29ycmVsYXRpb24taWQnOiAnY29yci14eXotNzg5J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWN0b3IgPSAoY29udHJvbGxlciBhcyBhbnkpLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtYWJjLTEyMycsXG4gICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEwMCcsXG4gICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wIENocm9tZS85MS4wJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYWN0b3JJZDogJ2pvaG4uZG9lJyxcbiAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtNzg5JyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ2NvcnIteHl6LTc4OScsXG4gICAgICAgIGNvZ25pdG86IHtcbiAgICAgICAgICBzdWI6ICd1c2VyLTEyMy00NTYnLFxuICAgICAgICAgIHVzZXJuYW1lOiAnam9obi5kb2UnLFxuICAgICAgICAgIGdyb3VwczogWydhZG1pbicsICd1c2VyJ11cbiAgICAgICAgfSxcbiAgICAgICAgcmF3QXV0aENvbnRleHQ6IHtcbiAgICAgICAgICBzdWI6ICd1c2VyLTEyMy00NTYnLFxuICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2pvaG4uZG9lJyxcbiAgICAgICAgICAnY29nbml0bzpncm91cHMnOiAnYWRtaW4sdXNlcicsXG4gICAgICAgICAgJ2N1c3RvbTp0ZW5hbnRJZCc6ICd0ZW5hbnQtNzg5JyxcbiAgICAgICAgICBlbWFpbDogJ2pvaG5AZXhhbXBsZS5jb20nXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGFjdG9yLnRpbWVzdGFtcCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBhY3RvciBjb250ZXh0IGZyb20gQVBJIEtleSBhdXRob3JpemF0aW9uIChyZXF1ZXN0IGNvbnRleHQpJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBpZGVudGl0eToge1xuICAgICAgICAgICAgc291cmNlSXA6ICcxMC4wLjAuMScsXG4gICAgICAgICAgICBhcGlLZXk6ICdhcGkta2V5LWFiYzEyMycsXG4gICAgICAgICAgICBhcGlLZXlJZDogJ2tleS1pZC00NTYnXG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1kZWYtNDU2J1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWRlZi00NTYnLFxuICAgICAgICBzb3VyY2VJcDogJzEwLjAuMC4xJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2FwaS1rZXknLFxuICAgICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgYWN0b3JJZDogJ2FwaS1rZXk6a2V5LWlkLTQ1NicsXG4gICAgICAgIGFwaUtleToge1xuICAgICAgICAgIGlkOiAna2V5LWlkLTQ1NicsXG4gICAgICAgICAgc291cmNlOiAncmVxdWVzdC1jb250ZXh0J1xuICAgICAgICB9LFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAncmVxLWRlZi00NTYnXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBhY3RvciBjb250ZXh0IGZyb20gQVBJIEtleSBhdXRob3JpemF0aW9uIChoZWFkZXIpJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBpZGVudGl0eToge1xuICAgICAgICAgICAgc291cmNlSXA6ICcxMC4wLjAuMSdcbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWhlYWRlci1hcGkta2V5JyxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICd4LWFwaS1rZXknOiAnaGVhZGVyLWFwaS1rZXkteHl6Nzg5J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWN0b3IgPSAoY29udHJvbGxlciBhcyBhbnkpLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtaGVhZGVyLWFwaS1rZXknLFxuICAgICAgICBzb3VyY2VJcDogJzEwLjAuMC4xJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2FwaS1rZXknLFxuICAgICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgYWN0b3JJZDogJ2FwaS1rZXk6aGVhZGVyLWFwaS1rZXkteHl6Nzg5JyxcbiAgICAgICAgYXBpS2V5OiB7XG4gICAgICAgICAgaWQ6ICdoZWFkZXItYXBpLWtleS14eXo3ODknLFxuICAgICAgICAgIHNvdXJjZTogJ2hlYWRlcidcbiAgICAgICAgfSxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3JlcS1oZWFkZXItYXBpLWtleSdcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwcmlvcml0aXplIHJlcXVlc3QtY29udGV4dCBBUEkga2V5IG92ZXIgaGVhZGVyJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBpZGVudGl0eToge1xuICAgICAgICAgICAgc291cmNlSXA6ICcxMC4wLjAuMScsXG4gICAgICAgICAgICBhcGlLZXk6ICdjb250ZXh0LWFwaS1rZXknXG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1wcmlvcml0eS10ZXN0JyxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICd4LWFwaS1rZXknOiAnaGVhZGVyLWFwaS1rZXktc2hvdWxkLWJlLWlnbm9yZWQnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIGF1dGhNZXRob2Q6ICdhcGkta2V5JyxcbiAgICAgICAgYWN0b3JJZDogJ2FwaS1rZXk6Y29udGV4dC1hcGkta2V5JyxcbiAgICAgICAgYXBpS2V5OiB7XG4gICAgICAgICAgaWQ6ICdjb250ZXh0LWFwaS1rZXknLFxuICAgICAgICAgIHNvdXJjZTogJ3JlcXVlc3QtY29udGV4dCdcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGV4dHJhY3QgYWN0b3IgY29udGV4dCBmcm9tIElBTSBhdXRob3JpemF0aW9uJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKHtcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBpZGVudGl0eToge1xuICAgICAgICAgICAgc291cmNlSXA6ICcxNzIuMTYuMC4xJyxcbiAgICAgICAgICAgIHVzZXJBcm46ICdhcm46YXdzOmlhbTo6MTIzNDU2Nzg5MDEyOnVzZXIvc2VydmljZS11c2VyJyxcbiAgICAgICAgICAgIHVzZXI6ICdBSURBSTIzSFoyN1NJNkZRTUdOUTInLFxuICAgICAgICAgICAgYWNjb3VudElkOiAnMTIzNDU2Nzg5MDEyJyxcbiAgICAgICAgICAgIGNhbGxlcjogJ2NhbGxlci1pZCdcbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWdoaS03ODknXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWN0b3IgPSAoY29udHJvbGxlciBhcyBhbnkpLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYWN0b3IpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtZ2hpLTc4OScsXG4gICAgICAgIHNvdXJjZUlwOiAnMTcyLjE2LjAuMScsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdpYW0nLFxuICAgICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgYWN0b3JJZDogJ0FJREFJMjNIWjI3U0k2RlFNR05RMicsXG4gICAgICAgIGlhbToge1xuICAgICAgICAgIHVzZXJBcm46ICdhcm46YXdzOmlhbTo6MTIzNDU2Nzg5MDEyOnVzZXIvc2VydmljZS11c2VyJyxcbiAgICAgICAgICB1c2VySWQ6ICdBSURBSTIzSFoyN1NJNkZRTUdOUTInLFxuICAgICAgICAgIGFjY291bnRJZDogJzEyMzQ1Njc4OTAxMicsXG4gICAgICAgICAgY2FsbGVyOiAnY2FsbGVyLWlkJ1xuICAgICAgICB9LFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAncmVxLWdoaS03ODknXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHN5c3RlbS9hbm9ueW1vdXMgYXV0aG9yaXphdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMjAzLjAuMTEzLjEnXG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1qa2wtMDEyJ1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWprbC0wMTInLFxuICAgICAgICBzb3VyY2VJcDogJzIwMy4wLjExMy4xJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2Fub255bW91cycsXG4gICAgICAgIGFjdG9yVHlwZTogJ2Fub255bW91cycsXG4gICAgICAgIGFjdG9ySWQ6ICdhbm9ueW1vdXMnLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAncmVxLWprbC0wMTInXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHRlbmFudCBJRCBmcm9tIGN1c3RvbSBoZWFkZXJzJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKCk7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtbW5vLTM0NScsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAneC10ZW5hbnQtaWQnOiAndGVuYW50LWZyb20taGVhZGVyJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWN0b3IgPSAoY29udHJvbGxlciBhcyBhbnkpLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYWN0b3IudGVuYW50SWQpLnRvQmUoJ3RlbmFudC1mcm9tLWhlYWRlcicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWlzc2luZyBvcHRpb25hbCBmaWVsZHMgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIGhlYWRlcnM6IHt9LCAvLyBObyB1c2VyLWFnZW50XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIHNvdXJjZUlwOiB1bmRlZmluZWQgLy8gTm8gc291cmNlIElQXG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1wcXItNjc4JyxcbiAgICAgICAgaGVhZGVyczoge30gLy8gTm8gY3VzdG9tIGhlYWRlcnNcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1wcXItNjc4JyxcbiAgICAgICAgc291cmNlSXA6IHVuZGVmaW5lZCxcbiAgICAgICAgdXNlckFnZW50OiB1bmRlZmluZWQsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvclR5cGU6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvcklkOiAnYW5vbnltb3VzJyxcbiAgICAgICAgdGVuYW50SWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3JlcS1wcXItNjc4J1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByaW9yaXRpemUgY29nbml0byB1c2VybmFtZSBvdmVyIHN1YiBmb3IgYWN0b3JJZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3VzZXItc3ViLTEyMycsXG4gICAgICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ3ByZWZlcnJlZC51c2VybmFtZSdcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXN0dS05MDEnXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWN0b3IgPSAoY29udHJvbGxlciBhcyBhbnkpLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYWN0b3IuYWN0b3JJZCkudG9CZSgncHJlZmVycmVkLnVzZXJuYW1lJyk7XG4gICAgICBleHBlY3QoYWN0b3IuY29nbml0bz8uc3ViKS50b0JlKCd1c2VyLXN1Yi0xMjMnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdXNlIHN1YiBhcyBmYWxsYmFjayB3aGVuIGNvZ25pdG8gdXNlcm5hbWUgaXMgbm90IGF2YWlsYWJsZScsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3VzZXItc3ViLTQ1NicsXG4gICAgICAgICAgICAgIHVzZXJuYW1lOiAnZmFsbGJhY2sudXNlcm5hbWUnXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS12d3gtMjM0J1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yLmFjdG9ySWQpLnRvQmUoJ2ZhbGxiYWNrLnVzZXJuYW1lJyk7XG4gICAgICBleHBlY3QoYWN0b3IuY29nbml0bz8uc3ViKS50b0JlKCd1c2VyLXN1Yi00NTYnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBzb2NpYWwgbG9naW4gaWRlbnRpdHkgaW5mb3JtYXRpb24nLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tFdmVudEZvckFjdG9yVGVzdHMoe1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICdnb29nbGUtdXNlci0xMjMnLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdnb29nbGVfdXNlcicsXG4gICAgICAgICAgICAgIGVtYWlsOiAndXNlckBnbWFpbC5jb20nLFxuICAgICAgICAgICAgICBpZGVudGl0aWVzOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgdXNlcklkOiAnZ29vZ2xlLTEyMzQ1Njc4OScsXG4gICAgICAgICAgICAgICAgICBwcm92aWRlck5hbWU6ICdHb29nbGUnLFxuICAgICAgICAgICAgICAgICAgcHJvdmlkZXJUeXBlOiAnT0lEQycsXG4gICAgICAgICAgICAgICAgICBwcmltYXJ5OiAndHJ1ZSdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXNvY2lhbC1sb2dpbidcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIGVtYWlsOiAndXNlckBnbWFpbC5jb20nLFxuICAgICAgICBjb2duaXRvOiB7XG4gICAgICAgICAgc3ViOiAnZ29vZ2xlLXVzZXItMTIzJyxcbiAgICAgICAgICB1c2VybmFtZTogJ2dvb2dsZV91c2VyJyxcbiAgICAgICAgICBpZGVudGl0aWVzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHVzZXJJZDogJ2dvb2dsZS0xMjM0NTY3ODknLFxuICAgICAgICAgICAgICBwcm92aWRlck5hbWU6ICdHb29nbGUnLFxuICAgICAgICAgICAgICBwcm92aWRlclR5cGU6ICdPSURDJyxcbiAgICAgICAgICAgICAgcHJpbWFyeTogJ3RydWUnXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBjdXN0b20gYXR0cmlidXRlcyBmcm9tIENvZ25pdG8nLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tFdmVudEZvckFjdG9yVGVzdHMoe1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICd1c2VyLXdpdGgtY3VzdG9tLWF0dHJzJyxcbiAgICAgICAgICAgICAgJ2NvZ25pdG86dXNlcm5hbWUnOiAnY3VzdG9tX3VzZXInLFxuICAgICAgICAgICAgICAnY3VzdG9tOmRlcGFydG1lbnQnOiAnZW5naW5lZXJpbmcnLFxuICAgICAgICAgICAgICAnY3VzdG9tOnJvbGUnOiAnc2VuaW9yLWRldmVsb3BlcicsXG4gICAgICAgICAgICAgICdjdXN0b206Y29tcGFueV9pZCc6ICdjb21wYW55LTEyMydcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWN1c3RvbS1hdHRycydcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgY29nbml0bzoge1xuICAgICAgICAgIHN1YjogJ3VzZXItd2l0aC1jdXN0b20tYXR0cnMnLFxuICAgICAgICAgIHVzZXJuYW1lOiAnY3VzdG9tX3VzZXInLFxuICAgICAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgIGRlcGFydG1lbnQ6ICdlbmdpbmVlcmluZycsXG4gICAgICAgICAgICByb2xlOiAnc2VuaW9yLWRldmVsb3BlcicsXG4gICAgICAgICAgICBjb21wYW55X2lkOiAnY29tcGFueS0xMjMnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2J1aWxkQ3R4IGludGVncmF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgYnVpbGQgZXhlY3V0aW9uIGNvbnRleHQgd2l0aCBhY3RvcicsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIoe30pO1xuICAgICAgXG4gICAgICBjb25zdCBjcmVhdGVNb2NrRXZlbnRGb3JCdWlsZEN0eCA9IChvdmVycmlkZXM6IFBhcnRpYWw8QVBJR2F0ZXdheUV2ZW50PiA9IHt9KTogQVBJR2F0ZXdheUV2ZW50ID0+IHtcbiAgICAgICAgY29uc3QgYmFzZUV2ZW50ID0ge1xuICAgICAgICAgIHJlc291cmNlOiAnL3Rlc3QnLFxuICAgICAgICAgIHBhdGg6ICcvdGVzdCcsXG4gICAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgaGVhZGVyczoge30sXG4gICAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxuICAgICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxuICAgICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgICByZXNvdXJjZUlkOiAndGVzdCcsXG4gICAgICAgICAgICByZXNvdXJjZVBhdGg6ICcvdGVzdCcsXG4gICAgICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdCcsXG4gICAgICAgICAgICBzdGFnZTogJ3Rlc3QnLFxuICAgICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgICAgY29nbml0b0lkZW50aXR5UG9vbElkOiBudWxsLFxuICAgICAgICAgICAgICBhY2NvdW50SWQ6IG51bGwsXG4gICAgICAgICAgICAgIGNvZ25pdG9JZGVudGl0eUlkOiBudWxsLFxuICAgICAgICAgICAgICBjYWxsZXI6IG51bGwsXG4gICAgICAgICAgICAgIHNvdXJjZUlwOiAnMTI3LjAuMC4xJyxcbiAgICAgICAgICAgICAgcHJpbmNpcGFsT3JnSWQ6IG51bGwsXG4gICAgICAgICAgICAgIGFjY2Vzc0tleTogbnVsbCxcbiAgICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uVHlwZTogbnVsbCxcbiAgICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uUHJvdmlkZXI6IG51bGwsXG4gICAgICAgICAgICAgIHVzZXJBcm46IG51bGwsXG4gICAgICAgICAgICAgIHVzZXJBZ2VudDogJ3Rlc3QtYWdlbnQnLFxuICAgICAgICAgICAgICB1c2VyOiBudWxsLFxuICAgICAgICAgICAgICBhcGlLZXk6IG51bGwsXG4gICAgICAgICAgICAgIGFwaUtleUlkOiBudWxsLFxuICAgICAgICAgICAgICBjbGllbnRDZXJ0OiBudWxsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJvdG9jb2w6ICdIVFRQLzEuMScsXG4gICAgICAgICAgICByZXF1ZXN0VGltZTogJzA5L0Fwci8yMDE1OjEyOjM0OjU2ICswMDAwJyxcbiAgICAgICAgICAgIHJlcXVlc3RUaW1lRXBvY2g6IDE0Mjg1ODI4OTYwMDAsXG4gICAgICAgICAgICBhcGlJZDogJ3Rlc3QtYXBpJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgYm9keTogbnVsbCxcbiAgICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxuICAgICAgICB9IGFzIEFQSUdhdGV3YXlFdmVudDtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIC4uLmJhc2VFdmVudCxcbiAgICAgICAgICAuLi5vdmVycmlkZXMsXG4gICAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICAgIC4uLmJhc2VFdmVudC5yZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgICAgIC4uLm92ZXJyaWRlcy5yZXF1ZXN0Q29udGV4dFxuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBBUElHYXRld2F5RXZlbnQ7XG4gICAgICB9O1xuICAgICAgXG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tFdmVudEZvckJ1aWxkQ3R4KHtcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBhdXRob3JpemVyOiB7XG4gICAgICAgICAgICBjbGFpbXM6IHtcbiAgICAgICAgICAgICAgc3ViOiAndXNlci0xMjMnLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICd0ZXN0LnVzZXInXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSB7fSBhcyBDb250ZXh0O1xuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWN0eC10ZXN0J1xuICAgICAgfSk7XG4gICAgICBjb25zdCByZXNwb25zZSA9IHt9O1xuXG4gICAgICBjb25zdCBleGVjdXRpb25Db250ZXh0ID0gY29udHJvbGxlci50ZXN0QnVpbGRDdHgoZXZlbnQsIGNvbnRleHQsIHJlcXVlc3QsIHJlc3BvbnNlKTtcblxuICAgICAgZXhwZWN0KGV4ZWN1dGlvbkNvbnRleHQpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICBldmVudCxcbiAgICAgICAgbGFtYmRhQ29udGV4dDogY29udGV4dCxcbiAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgIGRlYnVnSW5mbzoge31cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoZXhlY3V0aW9uQ29udGV4dC5hY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1jdHgtdGVzdCcsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIGFjdG9ySWQ6ICd0ZXN0LnVzZXInLFxuICAgICAgICBjb2duaXRvU3ViOiAndXNlci0xMjMnLFxuICAgICAgICBjb2duaXRvVXNlcm5hbWU6ICd0ZXN0LnVzZXInXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59KTsiXX0=