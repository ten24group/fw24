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
                cognitoSub: 'user-123-456',
                cognitoUsername: 'john.doe',
                cognitoGroups: ['admin', 'user'],
                tenantId: 'tenant-789',
                correlationId: 'corr-xyz-789',
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
        it('should extract actor context from API Key authorization', () => {
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
                actorId: 'api-key:api-key-abc123',
                apiKeyId: 'api-key-abc123',
                correlationId: 'req-def-456'
            });
        });
        it('should extract actor context from IAM authorization', () => {
            const event = createMockEventForActorTests({
                requestContext: {
                    identity: {
                        sourceIp: '172.16.0.1',
                        userArn: 'arn:aws:iam::123456789012:user/service-user',
                        user: 'AIDAI23HZ27SI6FQMGNQ2'
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
                iamRole: 'arn:aws:iam::123456789012:user/service-user',
                iamUserId: 'AIDAI23HZ27SI6FQMGNQ2',
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
                authMethod: 'system',
                actorType: 'anonymous',
                actorId: 'system',
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
                authMethod: 'system',
                actorType: 'anonymous',
                actorId: 'system',
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
            expect(actor.cognitoSub).toBe('user-sub-123');
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
            expect(actor.cognitoSub).toBe('user-sub-456');
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktY29udHJvbGxlci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9hcGktZ2F0ZXdheS1jb250cm9sbGVyLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxRUFBeUQ7QUFJekQsaUNBQWlDO0FBQ2pDLE1BQU0sY0FBZSxTQUFRLHNDQUFhO0lBQ2pDLGNBQWMsR0FBRyxNQUFNLENBQUM7SUFDeEIsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUVuQixZQUFZLE1BQTJCO1FBQ3JDLEtBQUssRUFBRSxDQUFDO1FBQ1IsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7SUFDdkIsQ0FBQztJQUVELHFDQUFxQztJQUM5QixxQkFBcUIsQ0FBQyxXQUFvQjtRQUMvQyxPQUFRLElBQVksQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRU0sb0JBQW9CLENBQUMsS0FBVTtRQUNwQyxPQUFRLElBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUMvQyxDQUFDO0lBRU0sNkJBQTZCLENBQUMsS0FBYSxFQUFFLE9BQWdCLEVBQUUsUUFBYSxFQUFFLEdBQVMsRUFBRSxLQUFhO1FBQzNHLE9BQVEsSUFBWSxDQUFDLHlCQUF5QixDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUN2RixDQUFDO0lBRU0sa0JBQWtCLENBQUMsR0FBUTtRQUNoQyxPQUFRLElBQVksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDM0MsQ0FBQztJQUVNLG1CQUFtQixDQUFDLEdBQVksRUFBRSxHQUFVLEVBQUUsR0FBUTtRQUMzRCxPQUFRLElBQVksQ0FBQyxlQUFlLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRU0sWUFB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WUFFSCxNQUFNLE9BQU8sR0FBRyxFQUFhLENBQUM7WUFDOUIsTUFBTSxPQUFPLEdBQUcsaUJBQWlCLENBQUM7Z0JBQ2hDLFNBQVMsRUFBRSxjQUFjO2FBQzFCLENBQUMsQ0FBQztZQUNILE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQztZQUVwQixNQUFNLGdCQUFnQixHQUFHLFVBQVUsQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7WUFFcEYsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUNyQyxLQUFLO2dCQUNMLGFBQWEsRUFBRSxPQUFPO2dCQUN0QixPQUFPO2dCQUNQLFFBQVE7Z0JBQ1IsU0FBUyxFQUFFLEVBQUU7YUFDZCxDQUFDLENBQUM7WUFFSCxNQUFNLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUMzQyxTQUFTLEVBQUUsY0FBYztnQkFDekIsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixPQUFPLEVBQUUsV0FBVztnQkFDcEIsVUFBVSxFQUFFLFVBQVU7Z0JBQ3RCLGVBQWUsRUFBRSxXQUFXO2FBQzdCLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUNvbnRyb2xsZXIgfSBmcm9tICcuL2FwaS1nYXRld2F5LWNvbnRyb2xsZXInO1xuaW1wb3J0IHR5cGUgeyBSZXF1ZXN0IH0gZnJvbSAnLi4vLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgdHlwZSB7IEFQSUdhdGV3YXlFdmVudCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuXG4vLyBDcmVhdGUgYSB0ZXN0IGNvbnRyb2xsZXIgY2xhc3NcbmNsYXNzIFRlc3RDb250cm9sbGVyIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG4gIHB1YmxpYyBjb250cm9sbGVyTmFtZSA9ICd0ZXN0JztcbiAgcHVibGljIHJvdXRlcyA9IHt9O1xuXG4gIGNvbnN0cnVjdG9yKHJvdXRlczogUmVjb3JkPHN0cmluZywgYW55Pikge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5yb3V0ZXMgPSByb3V0ZXM7XG4gIH1cblxuICAvLyBFeHBvc2UgcHJpdmF0ZSBtZXRob2RzIGZvciB0ZXN0aW5nXG4gIHB1YmxpYyB0ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdERhdGE6IFJlcXVlc3QpIHtcbiAgICByZXR1cm4gKHRoaXMgYXMgYW55KS5maW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0RGF0YSk7XG4gIH1cblxuICBwdWJsaWMgdGVzdEdldFJvdXRlRnVuY3Rpb24ocm91dGU6IGFueSkge1xuICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmdldFJvdXRlRnVuY3Rpb24ocm91dGUpO1xuICB9XG5cbiAgcHVibGljIHRlc3RFeGVjdXRlTWlkZGxld2FyZVBpcGVsaW5lKHBoYXNlOiBzdHJpbmcsIHJlcXVlc3Q6IFJlcXVlc3QsIHJlc3BvbnNlOiBhbnksIGN0eD86IGFueSwgZXJyb3I/OiBFcnJvcikge1xuICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmV4ZWN1dGVNaWRkbGV3YXJlUGlwZWxpbmUocGhhc2UsIHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgsIGVycm9yKTtcbiAgfVxuXG4gIHB1YmxpYyB0ZXN0SGFuZGxlUmVzcG9uc2UocmVzOiBhbnkpIHtcbiAgICByZXR1cm4gKHRoaXMgYXMgYW55KS5oYW5kbGVSZXNwb25zZShyZXMpO1xuICB9XG5cbiAgcHVibGljIHRlc3RIYW5kbGVFeGNlcHRpb24ocmVxOiBSZXF1ZXN0LCBlcnI6IEVycm9yLCByZXM6IGFueSkge1xuICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmhhbmRsZUV4Y2VwdGlvbihyZXEsIGVyciwgcmVzKTtcbiAgfVxuXG4gIHB1YmxpYyB0ZXN0QnVpbGRDdHgoZXZlbnQ6IEFQSUdhdGV3YXlFdmVudCwgY29udGV4dDogQ29udGV4dCwgcmVxdWVzdDogUmVxdWVzdCwgcmVzcG9uc2U6IGFueSkge1xuICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmJ1aWxkQ3R4KGV2ZW50LCBjb250ZXh0LCByZXF1ZXN0LCByZXNwb25zZSk7XG4gIH1cblxuICAvLyBFeHBvc2UgbWlkZGxld2FyZSByZWdpc3RyYXRpb24gZm9yIHRlc3RpbmdcbiAgcHVibGljIHRlc3RVc2VNaWRkbGV3YXJlKG1pZGRsZXdhcmU6IGFueSkge1xuICAgIHRoaXMudXNlTWlkZGxld2FyZShtaWRkbGV3YXJlKTtcbiAgfVxuXG4gIC8vIEV4cG9zZSBwcm90ZWN0ZWQgbWV0aG9kcyBmb3IgdGVzdGluZ1xuICBwdWJsaWMgdGVzdEhhbmRsZU5vdEZvdW5kKHJlcTogUmVxdWVzdCkge1xuICAgIHJldHVybiB0aGlzLmhhbmRsZU5vdEZvdW5kKHJlcSk7XG4gIH1cblxuICAvLyBUZXN0IGhhbmRsZXIgbWV0aG9kc1xuICBwdWJsaWMgdGVzdEhhbmRsZXIoKSB7XG4gICAgcmV0dXJuIHsgbWVzc2FnZTogJ3Rlc3QgaGFuZGxlciBjYWxsZWQnIH07XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgdGVzdEFzeW5jSGFuZGxlcigpIHtcbiAgICByZXR1cm4geyBtZXNzYWdlOiAnYXN5bmMgdGVzdCBoYW5kbGVyIGNhbGxlZCcgfTtcbiAgfVxuXG4gIHB1YmxpYyB0ZXN0SGFuZGxlcldpdGhFcnJvcigpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1Rlc3QgaGFuZGxlciBlcnJvcicpO1xuICB9XG5cbiAgLy8gUmVxdWlyZWQgYWJzdHJhY3QgbWV0aG9kXG4gIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBBUElHYXRld2F5RXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gTm8tb3AgZm9yIHRlc3RpbmdcbiAgfVxufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIG1vY2sgUmVxdWVzdCBvYmplY3RzXG5mdW5jdGlvbiBjcmVhdGVNb2NrUmVxdWVzdChvdmVycmlkZXM6IFBhcnRpYWw8UmVxdWVzdD4gPSB7fSk6IFJlcXVlc3Qge1xuICBjb25zdCBtb2NrRXZlbnQgPSB7fSBhcyBBUElHYXRld2F5RXZlbnQ7XG4gIGNvbnN0IG1vY2tDb250ZXh0ID0ge30gYXMgQ29udGV4dDtcblxuICByZXR1cm4ge1xuICAgIGV2ZW50OiBtb2NrRXZlbnQsXG4gICAgcmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0LWlkJyxcbiAgICBjb250ZXh0OiBtb2NrQ29udGV4dCxcbiAgICByZXNvdXJjZTogJy90ZXN0JyxcbiAgICBib2R5OiB7fSxcbiAgICBwYXRoOiAnL3Rlc3QnLFxuICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge30sXG4gICAgaGVhZGVyczoge30sXG4gICAgcmVxdWVzdENvbnRleHQ6IHt9LFxuICAgIHN0YWdlVmFyaWFibGVzOiB7fSxcbiAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcbiAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICBkZWJ1Z01vZGU6IGZhbHNlLFxuICAgIGdldFBhcmFtOiBqZXN0LmZuKCksXG4gICAgaGFzUGFyYW06IGplc3QuZm4oKSxcbiAgICBnZXRIZWFkZXI6IGplc3QuZm4oKSxcbiAgICBoYXNIZWFkZXI6IGplc3QuZm4oKSxcbiAgICBnZXRQYXRoUGFyYW06IGplc3QuZm4oKSxcbiAgICBoYXNQYXRoUGFyYW06IGplc3QuZm4oKSxcbiAgICBnZXRRdWVyeVBhcmFtOiBqZXN0LmZuKCksXG4gICAgaGFzUXVlcnlQYXJhbTogamVzdC5mbigpLFxuICAgIGdldEJvZHlQYXJhbTogamVzdC5mbigpLFxuICAgIGhhc0JvZHlQYXJhbTogamVzdC5mbigpLFxuICAgIC4uLm92ZXJyaWRlcyxcbiAgfTtcbn1cblxuZGVzY3JpYmUoJ0FQSUdhdGV3YXlDb250cm9sbGVyIFJvdXRlIE1hdGNoaW5nJywgKCkgPT4ge1xuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBqZXN0LmNsZWFyQWxsTW9ja3MoKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2ZpbmRNYXRjaGluZ1JvdXRlIC0gQ29yZSBGdW5jdGlvbmFsaXR5JywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbXByZWhlbnNpdmUgcm91dGUgbWF0Y2hpbmcgc2NlbmFyaW9zJywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm91dGVzID0ge1xuICAgICAgICAvLyBFeGFjdCByb3V0ZXNcbiAgICAgICAgJ0dFVHwvJzogeyBoYW5kbGVyOiAnaW5kZXgnIH0sXG4gICAgICAgICdHRVR8L3VzZXJzJzogeyBoYW5kbGVyOiAnbGlzdFVzZXJzJyB9LFxuICAgICAgICAnUE9TVHwvdXNlcnMnOiB7IGhhbmRsZXI6ICdjcmVhdGVVc2VyJyB9LFxuXG4gICAgICAgIC8vIFNpbmdsZSBwYXJhbWV0ZXJcbiAgICAgICAgJ0dFVHwve2lkfSc6IHsgaGFuZGxlcjogJ2dldEJ5SWQnIH0sXG4gICAgICAgICdERUxFVEV8L3tpZH0nOiB7IGhhbmRsZXI6ICdkZWxldGVCeUlkJyB9LFxuXG4gICAgICAgIC8vIE11bHRpcGxlIHBhcmFtZXRlcnMgIFxuICAgICAgICAnR0VUfC97YWJjfS97ZGVmfS97eHl6fSc6IHsgaGFuZGxlcjogJ2dldFRyaXBsZVBhcmFtcycgfSxcbiAgICAgICAgJ0dFVHwvdXNlcnMve3VzZXJJZH0vcG9zdHMve3Bvc3RJZH0nOiB7IGhhbmRsZXI6ICdnZXRVc2VyUG9zdCcgfSxcblxuICAgICAgICAvLyBNaXhlZCBzdGF0aWMvZHluYW1pY1xuICAgICAgICAnR0VUfC90ZWFtcy97dGVhbUlkfS9jYXRlZ29yaWVzL3tjYXRlZ29yeUlkfS9wb3N0cy97cG9zdElkfSc6IHsgaGFuZGxlcjogJ2dldFRlYW1DYXRlZ29yeVBvc3QnIH0sXG5cbiAgICAgICAgLy8gUHJpb3JpdGl6YXRpb24gdGVzdCByb3V0ZXNcbiAgICAgICAgJ0dFVHwve3Jlc291cmNlfSc6IHsgaGFuZGxlcjogJ2dldFJlc291cmNlJyB9LFxuICAgICAgICAnR0VUfC97Y2F0ZWdvcnl9L3thY3Rpb259JzogeyBoYW5kbGVyOiAnZ2V0Q2F0ZWdvcnlBY3Rpb24nIH0sXG4gICAgICAgICdHRVR8L3VzZXJzL3t1c2VySWR9JzogeyBoYW5kbGVyOiAnZ2V0VXNlckJ5SWQnIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHJvdXRlcyk7XG5cbiAgICAgIC8vIFRlc3QgZXhhY3Qgcm91dGUgbWF0Y2hpbmdcbiAgICAgIGxldCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC8nLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdpbmRleCcgfSk7XG5cbiAgICAgIC8vIFRlc3Qgc2luZ2xlIHBhcmFtZXRlclxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvMTIzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICcxMjMnIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRCeUlkJyB9KTtcblxuICAgICAgLy8gVGVzdCBtdWx0aXBsZSBwYXJhbWV0ZXJzXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC92YWwxL3ZhbDIvdmFsMycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGFiYzogJ3ZhbDEnLCBkZWY6ICd2YWwyJywgeHl6OiAndmFsMycgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldFRyaXBsZVBhcmFtcycgfSk7XG5cbiAgICAgIC8vIFRlc3QgY29tcGxleCBuZXN0ZWQgcm91dGVcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L3RlYW1zL3RlYW0tMS9jYXRlZ29yaWVzL25ld3MvcG9zdHMvcG9zdC0xMjMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyB0ZWFtSWQ6ICd0ZWFtLTEnLCBjYXRlZ29yeUlkOiAnbmV3cycsIHBvc3RJZDogJ3Bvc3QtMTIzJyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0VGVhbUNhdGVnb3J5UG9zdCcgfSk7XG5cbiAgICAgIC8vIFRlc3QgZXhhY3QgbWF0Y2ggcHJpb3JpdHkgb3ZlciBwYXJhbWV0ZXJpemVkXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC91c2VycycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2xpc3RVc2VycycgfSk7XG5cbiAgICAgIC8vIFRlc3Qgc3BlY2lmaWMgcGFyYW1ldGVyaXplZCByb3V0ZSBwcmlvcml0eSBvdmVyIGdlbmVyYWxcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L3VzZXJzLzEyMycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IHVzZXJJZDogJzEyMycgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ2dldFVzZXJCeUlkJyB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG5lZ2F0aXZlIGNhc2VzIGNvcnJlY3RseScsICgpID0+IHtcbiAgICAgIGNvbnN0IHJvdXRlcyA9IHtcbiAgICAgICAgJ0dFVHwve2FiY30ve2RlZn0ve3h5en0nOiB7IGhhbmRsZXI6ICdnZXRUcmlwbGVQYXJhbXMnIH0sXG4gICAgICAgICdQT1NUfC97aWR9JzogeyBoYW5kbGVyOiAndXBkYXRlQnlJZCcgfSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIocm91dGVzKTtcblxuICAgICAgLy8gV3JvbmcgbnVtYmVyIG9mIHNlZ21lbnRzXG4gICAgICBsZXQgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvdmFsdWUxL3ZhbHVlMicsIC8vIFRvbyBmZXdcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgYWJjOiAndmFsdWUxJywgZGVmOiAndmFsdWUyJyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvQmVOdWxsKCk7XG5cbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L3ZhbHVlMS92YWx1ZTIvdmFsdWUzL2V4dHJhJywgLy8gVG9vIG1hbnlcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgYWJjOiAndmFsdWUxJywgZGVmOiAndmFsdWUyJywgeHl6OiAndmFsdWUzJyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvQmVOdWxsKCk7XG5cbiAgICAgIC8vIFdyb25nIEhUVFAgbWV0aG9kXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnREVMRVRFJywgLy8gU2hvdWxkIGJlIFBPU1RcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC8xMjMnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJzEyMycgfSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0JlTnVsbCgpO1xuXG4gICAgICAvLyBObyBtYXRjaGluZyByb3V0ZVxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3Qvbm9uZXhpc3RlbnQvcm91dGUnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9CZU51bGwoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbnRyb2xsZXIgbmFtZXMgd2l0aCBzbGFzaGVzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm91dGVzID0ge1xuICAgICAgICAnR0VUfC9pbmRpY2VzJzogeyBoYW5kbGVyOiAnZ2V0SW5kaWNlcycgfSxcbiAgICAgICAgJ1BPU1R8L3JlaW5kZXgve2VudGl0eX0nOiB7IGhhbmRsZXI6ICdyZWluZGV4RW50aXR5JyB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcihyb3V0ZXMpO1xuICAgICAgY29udHJvbGxlci5jb250cm9sbGVyTmFtZSA9ICdzeXN0ZW0vc2VhcmNoJztcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3N5c3RlbS9zZWFyY2gvaW5kaWNlcycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0SW5kaWNlcycgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdmaW5kTWF0Y2hpbmdSb3V0ZSAtIEVkZ2UgQ2FzZXMgJiBSb2J1c3RuZXNzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVkZ2UgY2FzZXMgYW5kIHBhcmFtZXRlciB2YXJpYXRpb25zJywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm91dGVzID0ge1xuICAgICAgICAnR0VUfC97aWR9JzogeyBoYW5kbGVyOiAnZ2V0QnlJZCcgfSxcbiAgICAgICAgJ0dFVHwve2F9L3tifS97Y30ve2R9L3tlfSc6IHsgaGFuZGxlcjogJ2dldEZpdmVQYXJhbXMnIH0sXG4gICAgICAgICdQT1NUfC97Y291bnRyeX0ve3N0YXRlfS97Y2l0eX0ve2Rpc3RyaWN0fS97c3RyZWV0fS97YnVpbGRpbmd9JzogeyBoYW5kbGVyOiAnZ2V0U2l4UGFyYW1zJyB9LFxuICAgICAgICAnUFVUfC97aWR9JzogeyBoYW5kbGVyOiAndXBkYXRlQnlJZCcgfSxcbiAgICAgICAgJ0RFTEVURXwve2lkfSc6IHsgaGFuZGxlcjogJ2RlbGV0ZUJ5SWQnIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKHJvdXRlcyk7XG5cbiAgICAgIC8vIEVtcHR5IHJvdXRlcyBvYmplY3RcbiAgICAgIGNvbnN0IGVtcHR5Q29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcih7fSk7XG4gICAgICBsZXQgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QvYW55dGhpbmcnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChlbXB0eUNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0JlTnVsbCgpO1xuXG4gICAgICAvLyBTcGVjaWFsIGNoYXJhY3RlcnMgaW4gcGFyYW1ldGVyc1xuICAgICAgY29uc3Qgc3BlY2lhbENoYXJDYXNlcyA9IFsgJ2FiYy0xMjMnLCAndXNlcl80NTYnLCAnOTk5JywgJ3NwZWNpYWwlMjBjaGFycycgXTtcbiAgICAgIHNwZWNpYWxDaGFyQ2FzZXMuZm9yRWFjaChpZCA9PiB7XG4gICAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcmVzb3VyY2U6IGAvdGVzdC8ke2lkfWAsXG4gICAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRCeUlkJyB9KTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBWZXJ5IGxvbmcgcGFyYW1ldGVyXG4gICAgICBjb25zdCBsb25nSWQgPSAnYScucmVwZWF0KDEwMDApO1xuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiBgL3Rlc3QvJHtsb25nSWR9YCxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6IGxvbmdJZCB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0QnlJZCcgfSk7XG5cbiAgICAgIC8vIE11bHRpcGxlIEhUVFAgbWV0aG9kc1xuICAgICAgY29uc3QgaHR0cE1ldGhvZHMgPSBbICdHRVQnLCAnUFVUJywgJ0RFTEVURScgXTtcbiAgICAgIGNvbnN0IGV4cGVjdGVkSGFuZGxlcnMgPSBbICdnZXRCeUlkJywgJ3VwZGF0ZUJ5SWQnLCAnZGVsZXRlQnlJZCcgXTtcbiAgICAgIGh0dHBNZXRob2RzLmZvckVhY2goKG1ldGhvZCwgaW5kZXgpID0+IHtcbiAgICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgICBodHRwTWV0aG9kOiBtZXRob2QsXG4gICAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC8xMjMnLFxuICAgICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGlkOiAnMTIzJyB9LFxuICAgICAgICB9KTtcbiAgICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogZXhwZWN0ZWRIYW5kbGVyc1sgaW5kZXggXSB9KTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBSb3V0ZXMgd2l0aCBtYW55IHBhcmFtZXRlcnNcbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0LzEvMi8zLzQvNScsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGE6ICcxJywgYjogJzInLCBjOiAnMycsIGQ6ICc0JywgZTogJzUnIH0sXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6ICdnZXRGaXZlUGFyYW1zJyB9KTtcblxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L1VTL0NBL1NGL0Rvd250b3duL01haW4vMTIzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBjb3VudHJ5OiAnVVMnLCBzdGF0ZTogJ0NBJywgY2l0eTogJ1NGJyxcbiAgICAgICAgICBkaXN0cmljdDogJ0Rvd250b3duJywgc3RyZWV0OiAnTWFpbicsIGJ1aWxkaW5nOiAnMTIzJ1xuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0U2l4UGFyYW1zJyB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2ZpbmRNYXRjaGluZ1JvdXRlIC0gQWR2YW5jZWQgU2NlbmFyaW9zJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbXBsZXggY29udHJvbGxlciBuYW1lcyBhbmQgUkVTVCBwYXR0ZXJucycsICgpID0+IHtcbiAgICAgIC8vIFRlc3QgbmVzdGVkIGNvbnRyb2xsZXIgbmFtZXNcbiAgICAgIGNvbnN0IG5lc3RlZFJvdXRlcyA9IHtcbiAgICAgICAgJ0dFVHwvc3RhdHVzJzogeyBoYW5kbGVyOiAnZ2V0U3RhdHVzJyB9LFxuICAgICAgICAnUE9TVHwvYWN0aW9ucy97YWN0aW9uSWR9JzogeyBoYW5kbGVyOiAnZXhlY3V0ZUFjdGlvbicgfSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG5lc3RlZENvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIobmVzdGVkUm91dGVzKTtcbiAgICAgIG5lc3RlZENvbnRyb2xsZXIuY29udHJvbGxlck5hbWUgPSAnYWRtaW4vc3lzdGVtL21vbml0b3JpbmcvaGVhbHRoJztcblxuICAgICAgbGV0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy9hZG1pbi9zeXN0ZW0vbW9uaXRvcmluZy9oZWFsdGgvc3RhdHVzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QobmVzdGVkQ29udHJvbGxlci50ZXN0RmluZE1hdGNoaW5nUm91dGUocmVxdWVzdCkpLnRvRXF1YWwoeyBoYW5kbGVyOiAnZ2V0U3RhdHVzJyB9KTtcblxuICAgICAgLy8gVGVzdCBjb250cm9sbGVyIG5hbWVzIHdpdGggc3BlY2lhbCBjaGFyYWN0ZXJzXG4gICAgICBjb25zdCBzcGVjaWFsQ29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcih7ICdHRVR8L3Rlc3QnOiB7IGhhbmRsZXI6ICd0ZXN0JyB9IH0pO1xuICAgICAgc3BlY2lhbENvbnRyb2xsZXIuY29udHJvbGxlck5hbWUgPSAnYXBpLXYxLjIvdXNlci1tYW5hZ2VtZW50JztcblxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHJlc291cmNlOiAnL2FwaS12MS4yL3VzZXItbWFuYWdlbWVudC90ZXN0JyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3Qoc3BlY2lhbENvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ3Rlc3QnIH0pO1xuXG4gICAgICAvLyBUZXN0IGNvbXByZWhlbnNpdmUgUkVTVCBBUEkgcGF0dGVybnNcbiAgICAgIGNvbnN0IHJlc3RSb3V0ZXMgPSB7XG4gICAgICAgICdHRVR8Lyc6IHsgaGFuZGxlcjogJ2xpc3QnIH0sXG4gICAgICAgICdQT1NUfC8nOiB7IGhhbmRsZXI6ICdjcmVhdGUnIH0sXG4gICAgICAgICdHRVR8L3tpZH0nOiB7IGhhbmRsZXI6ICdnZXQnIH0sXG4gICAgICAgICdQVVR8L3tpZH0nOiB7IGhhbmRsZXI6ICd1cGRhdGUnIH0sXG4gICAgICAgICdERUxFVEV8L3tpZH0nOiB7IGhhbmRsZXI6ICdkZWxldGUnIH0sXG4gICAgICAgICdHRVR8L3tpZH0vcmVsYXRpb25zaGlwcyc6IHsgaGFuZGxlcjogJ2dldFJlbGF0aW9uc2hpcHMnIH0sXG4gICAgICAgICdQT1NUfC97aWR9L3JlbGF0aW9uc2hpcHMve3JlbGF0aW9uc2hpcFR5cGV9JzogeyBoYW5kbGVyOiAnYWRkUmVsYXRpb25zaGlwJyB9LFxuICAgICAgICAnR0VUfC90ZWFtcy97dGVhbUlkfS9wcm9qZWN0cy97cHJvamVjdElkfS90YXNrcy97dGFza0lkfSc6IHsgaGFuZGxlcjogJ2dldFByb2plY3RUYXNrJyB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdENvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIocmVzdFJvdXRlcyk7XG5cbiAgICAgIGNvbnN0IHRlc3RDYXNlcyA9IFtcbiAgICAgICAgeyBtZXRob2Q6ICdHRVQnLCBwYXRoOiAnL3Rlc3QvJywgcGFyYW1zOiB7fSwgZXhwZWN0ZWQ6ICdsaXN0JyB9LFxuICAgICAgICB7IG1ldGhvZDogJ1BPU1QnLCBwYXRoOiAnL3Rlc3QvJywgcGFyYW1zOiB7fSwgZXhwZWN0ZWQ6ICdjcmVhdGUnIH0sXG4gICAgICAgIHsgbWV0aG9kOiAnR0VUJywgcGF0aDogJy90ZXN0LzEyMycsIHBhcmFtczogeyBpZDogJzEyMycgfSwgZXhwZWN0ZWQ6ICdnZXQnIH0sXG4gICAgICAgIHsgbWV0aG9kOiAnUFVUJywgcGF0aDogJy90ZXN0LzEyMycsIHBhcmFtczogeyBpZDogJzEyMycgfSwgZXhwZWN0ZWQ6ICd1cGRhdGUnIH0sXG4gICAgICAgIHsgbWV0aG9kOiAnREVMRVRFJywgcGF0aDogJy90ZXN0LzEyMycsIHBhcmFtczogeyBpZDogJzEyMycgfSwgZXhwZWN0ZWQ6ICdkZWxldGUnIH0sXG4gICAgICAgIHsgbWV0aG9kOiAnR0VUJywgcGF0aDogJy90ZXN0LzEyMy9yZWxhdGlvbnNoaXBzJywgcGFyYW1zOiB7IGlkOiAnMTIzJyB9LCBleHBlY3RlZDogJ2dldFJlbGF0aW9uc2hpcHMnIH0sXG4gICAgICAgIHsgbWV0aG9kOiAnUE9TVCcsIHBhdGg6ICcvdGVzdC8xMjMvcmVsYXRpb25zaGlwcy9mcmllbmRzJywgcGFyYW1zOiB7IGlkOiAnMTIzJywgcmVsYXRpb25zaGlwVHlwZTogJ2ZyaWVuZHMnIH0sIGV4cGVjdGVkOiAnYWRkUmVsYXRpb25zaGlwJyB9LFxuICAgICAgICB7IG1ldGhvZDogJ0dFVCcsIHBhdGg6ICcvdGVzdC90ZWFtcy90MS9wcm9qZWN0cy9wMi90YXNrcy90YXNrMycsIHBhcmFtczogeyB0ZWFtSWQ6ICd0MScsIHByb2plY3RJZDogJ3AyJywgdGFza0lkOiAndGFzazMnIH0sIGV4cGVjdGVkOiAnZ2V0UHJvamVjdFRhc2snIH0sXG4gICAgICBdO1xuXG4gICAgICB0ZXN0Q2FzZXMuZm9yRWFjaCgoeyBtZXRob2QsIHBhdGgsIHBhcmFtcywgZXhwZWN0ZWQgfSkgPT4ge1xuICAgICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICAgIGh0dHBNZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgICByZXNvdXJjZTogcGF0aCxcbiAgICAgICAgICBwYXRoUGFyYW1ldGVyczogcGFyYW1zLFxuICAgICAgICB9KTtcbiAgICAgICAgZXhwZWN0KHJlc3RDb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7IGhhbmRsZXI6IGV4cGVjdGVkIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdmaW5kTWF0Y2hpbmdSb3V0ZSAtIEVycm9yIFJlc2lsaWVuY2UnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZXJyb3IgY29uZGl0aW9ucyBncmFjZWZ1bGx5JywgKCkgPT4ge1xuICAgICAgLy8gVGVzdCBtYWxmb3JtZWQgcm91dGUga2V5c1xuICAgICAgY29uc3QgbWFsZm9ybWVkUm91dGVzID0ge1xuICAgICAgICAnR0VUfC92YWxpZCc6IHsgaGFuZGxlcjogJ3ZhbGlkJyB9LFxuICAgICAgICAnSU5WQUxJRF9ST1VURSc6IHsgaGFuZGxlcjogJ2ludmFsaWQnIH0sIC8vIE1pc3NpbmcgcGlwZSBzZXBhcmF0b3JcbiAgICAgICAgJ1BPU1R8JzogeyBoYW5kbGVyOiAnZW1wdHknIH0sIC8vIEVtcHR5IHBhdGhcbiAgICAgICAgJ3wvbm8tbWV0aG9kJzogeyBoYW5kbGVyOiAnbm9NZXRob2QnIH0sIC8vIE1pc3NpbmcgbWV0aG9kXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFRlc3RDb250cm9sbGVyKG1hbGZvcm1lZFJvdXRlcyk7XG5cbiAgICAgIC8vIFZhbGlkIHJvdXRlIHNob3VsZCBzdGlsbCB3b3JrIGRlc3BpdGUgbWFsZm9ybWVkIG9uZXNcbiAgICAgIGxldCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvdGVzdC92YWxpZCcsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7fSxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0VxdWFsKHsgaGFuZGxlcjogJ3ZhbGlkJyB9KTtcblxuICAgICAgLy8gVGVzdCBlbXB0eSBjb250cm9sbGVyIG5hbWVcbiAgICAgIGNvbnN0IGVtcHR5TmFtZUNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIoe30pO1xuICAgICAgZW1wdHlOYW1lQ29udHJvbGxlci5jb250cm9sbGVyTmFtZSA9ICcnO1xuXG4gICAgICByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcmVzb3VyY2U6ICcvYW55dGhpbmcnLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczoge30sXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KCgpID0+IGVtcHR5TmFtZUNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS5ub3QudG9UaHJvdygpO1xuICAgICAgZXhwZWN0KGVtcHR5TmFtZUNvbnRyb2xsZXIudGVzdEZpbmRNYXRjaGluZ1JvdXRlKHJlcXVlc3QpKS50b0JlTnVsbCgpO1xuXG4gICAgICAvLyBUZXN0IHJvdXRlcyB3aXRoIGFkZGl0aW9uYWwgbWV0YWRhdGFcbiAgICAgIGNvbnN0IG1ldGFkYXRhUm91dGVzID0ge1xuICAgICAgICAnR0VUfC91c2Vycyc6IHtcbiAgICAgICAgICBoYW5kbGVyOiAnZ2V0VXNlcnMnLFxuICAgICAgICAgIG1pZGRsZXdhcmU6IFsgJ2F1dGgnLCAnbG9nZ2luZycgXSxcbiAgICAgICAgICBjYWNoZTogdHJ1ZSxcbiAgICAgICAgICB0aW1lb3V0OiAzMDAwMFxuICAgICAgICB9LFxuICAgICAgICAnUE9TVHwve2lkfSc6IHtcbiAgICAgICAgICBoYW5kbGVyOiAndXBkYXRlVXNlcicsXG4gICAgICAgICAgdmFsaWRhdGlvbnM6IHsgYm9keTogeyByZXF1aXJlZDogdHJ1ZSB9IH0sXG4gICAgICAgICAgcmF0ZUxpbWl0OiAxMDBcbiAgICAgICAgfSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1ldGFkYXRhQ29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcihtZXRhZGF0YVJvdXRlcyk7XG5cbiAgICAgIHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0L3VzZXJzJyxcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHt9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QobWV0YWRhdGFDb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7XG4gICAgICAgIGhhbmRsZXI6ICdnZXRVc2VycycsXG4gICAgICAgIG1pZGRsZXdhcmU6IFsgJ2F1dGgnLCAnbG9nZ2luZycgXSxcbiAgICAgICAgY2FjaGU6IHRydWUsXG4gICAgICAgIHRpbWVvdXQ6IDMwMDAwXG4gICAgICB9KTtcblxuICAgICAgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxuICAgICAgICByZXNvdXJjZTogJy90ZXN0LzEyMycsXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7IGlkOiAnMTIzJyB9LFxuICAgICAgfSk7XG4gICAgICBleHBlY3QobWV0YWRhdGFDb250cm9sbGVyLnRlc3RGaW5kTWF0Y2hpbmdSb3V0ZShyZXF1ZXN0KSkudG9FcXVhbCh7XG4gICAgICAgIGhhbmRsZXI6ICd1cGRhdGVVc2VyJyxcbiAgICAgICAgdmFsaWRhdGlvbnM6IHsgYm9keTogeyByZXF1aXJlZDogdHJ1ZSB9IH0sXG4gICAgICAgIHJhdGVMaW1pdDogMTAwXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ0FQSUdhdGV3YXlDb250cm9sbGVyIENvcmUgRnVuY3Rpb25hbGl0eScsICgpID0+IHtcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdyb3V0ZSBmdW5jdGlvbiByZXNvbHV0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcmV0dXJuIGhhbmRsZXIgZnVuY3Rpb24gZm9yIHZhbGlkIHJvdXRlcywgNDA0IGhhbmRsZXIgb3RoZXJ3aXNlJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcih7fSk7XG5cbiAgICAgIC8vIFZhbGlkIHJvdXRlXG4gICAgICBjb25zdCB2YWxpZFJvdXRlID0geyBmdW5jdGlvbk5hbWU6ICd0ZXN0SGFuZGxlcicgfTtcbiAgICAgIGNvbnN0IHZhbGlkRnVuY3Rpb24gPSBjb250cm9sbGVyLnRlc3RHZXRSb3V0ZUZ1bmN0aW9uKHZhbGlkUm91dGUpO1xuICAgICAgZXhwZWN0KHZhbGlkRnVuY3Rpb24uY2FsbChjb250cm9sbGVyKSkudG9FcXVhbCh7IG1lc3NhZ2U6ICd0ZXN0IGhhbmRsZXIgY2FsbGVkJyB9KTtcblxuICAgICAgLy8gSW52YWxpZCByb3V0ZXMgYWxsIHJldHVybiA0MDRcbiAgICAgIFsgbnVsbCwgeyBmdW5jdGlvbk5hbWU6ICdub25FeGlzdGVudCcgfSwgeyBmdW5jdGlvbk5hbWU6ICdub3RBRnVuY3Rpb24nIH0gXS5mb3JFYWNoKHJvdXRlID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gY29udHJvbGxlci50ZXN0R2V0Um91dGVGdW5jdGlvbihyb3V0ZSkuY2FsbChjb250cm9sbGVyLCBjcmVhdGVNb2NrUmVxdWVzdCgpKTtcbiAgICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDQwNCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0FjdG9yIENvbnRleHQgRXh0cmFjdGlvbicsICgpID0+IHtcbiAgICBsZXQgY29udHJvbGxlcjogVGVzdENvbnRyb2xsZXI7XG5cbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIGNvbnRyb2xsZXIgPSBuZXcgVGVzdENvbnRyb2xsZXIoe30pO1xuICAgIH0pO1xuXG4gICAgLy8gSGVscGVyIHRvIGNyZWF0ZSBtb2NrIEFQSUdhdGV3YXlFdmVudFxuICAgIGNvbnN0IGNyZWF0ZU1vY2tFdmVudEZvckFjdG9yVGVzdHMgPSAob3ZlcnJpZGVzOiBQYXJ0aWFsPEFQSUdhdGV3YXlFdmVudD4gPSB7fSk6IEFQSUdhdGV3YXlFdmVudCA9PiB7XG4gICAgICBjb25zdCBiYXNlRXZlbnQgPSB7XG4gICAgICAgIHJlc291cmNlOiAnL3Rlc3QnLFxuICAgICAgICBwYXRoOiAnL3Rlc3QnLFxuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgaGVhZGVyczoge30sXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgcmVzb3VyY2VJZDogJ3Rlc3QnLFxuICAgICAgICAgIHJlc291cmNlUGF0aDogJy90ZXN0JyxcbiAgICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QnLFxuICAgICAgICAgIHN0YWdlOiAndGVzdCcsXG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIGNvZ25pdG9JZGVudGl0eVBvb2xJZDogbnVsbCxcbiAgICAgICAgICAgIGFjY291bnRJZDogbnVsbCxcbiAgICAgICAgICAgIGNvZ25pdG9JZGVudGl0eUlkOiBudWxsLFxuICAgICAgICAgICAgY2FsbGVyOiBudWxsLFxuICAgICAgICAgICAgc291cmNlSXA6ICcxMjcuMC4wLjEnLFxuICAgICAgICAgICAgcHJpbmNpcGFsT3JnSWQ6IG51bGwsXG4gICAgICAgICAgICBhY2Nlc3NLZXk6IG51bGwsXG4gICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25UeXBlOiBudWxsLFxuICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uUHJvdmlkZXI6IG51bGwsXG4gICAgICAgICAgICB1c2VyQXJuOiBudWxsLFxuICAgICAgICAgICAgdXNlckFnZW50OiAndGVzdC1hZ2VudCcsXG4gICAgICAgICAgICB1c2VyOiBudWxsLFxuICAgICAgICAgICAgYXBpS2V5OiBudWxsLFxuICAgICAgICAgICAgYXBpS2V5SWQ6IG51bGwsXG4gICAgICAgICAgICBjbGllbnRDZXJ0OiBudWxsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwcm90b2NvbDogJ0hUVFAvMS4xJyxcbiAgICAgICAgICByZXF1ZXN0VGltZTogJzA5L0Fwci8yMDE1OjEyOjM0OjU2ICswMDAwJyxcbiAgICAgICAgICByZXF1ZXN0VGltZUVwb2NoOiAxNDI4NTgyODk2MDAwLFxuICAgICAgICAgIGFwaUlkOiAndGVzdC1hcGknXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IG51bGwsXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXG4gICAgICB9IGFzIEFQSUdhdGV3YXlFdmVudDtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uYmFzZUV2ZW50LFxuICAgICAgICAuLi5vdmVycmlkZXMsXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgLi4uYmFzZUV2ZW50LnJlcXVlc3RDb250ZXh0LFxuICAgICAgICAgIC4uLm92ZXJyaWRlcy5yZXF1ZXN0Q29udGV4dFxuICAgICAgICB9XG4gICAgICB9IGFzIEFQSUdhdGV3YXlFdmVudDtcbiAgICB9O1xuXG4gICAgaXQoJ3Nob3VsZCBleHRyYWN0IGFjdG9yIGNvbnRleHQgZnJvbSBDb2duaXRvIGF1dGhvcml6YXRpb24nLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tFdmVudEZvckFjdG9yVGVzdHMoe1xuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ3VzZXItYWdlbnQnOiAnTW96aWxsYS81LjAgQ2hyb21lLzkxLjAnXG4gICAgICAgIH0sXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEwMCdcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICd1c2VyLTEyMy00NTYnLFxuICAgICAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdqb2huLmRvZScsXG4gICAgICAgICAgICAgICdjb2duaXRvOmdyb3Vwcyc6ICdhZG1pbix1c2VyJyxcbiAgICAgICAgICAgICAgJ2N1c3RvbTp0ZW5hbnRJZCc6ICd0ZW5hbnQtNzg5JyxcbiAgICAgICAgICAgICAgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJ1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnlcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtYWJjLTEyMycsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAneC1jb3JyZWxhdGlvbi1pZCc6ICdjb3JyLXh5ei03ODknXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1hYmMtMTIzJyxcbiAgICAgICAgc291cmNlSXA6ICcxOTIuMTY4LjEuMTAwJyxcbiAgICAgICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAgQ2hyb21lLzkxLjAnLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICBhY3RvcklkOiAnam9obi5kb2UnLFxuICAgICAgICBjb2duaXRvU3ViOiAndXNlci0xMjMtNDU2JyxcbiAgICAgICAgY29nbml0b1VzZXJuYW1lOiAnam9obi5kb2UnLFxuICAgICAgICBjb2duaXRvR3JvdXBzOiBbJ2FkbWluJywgJ3VzZXInXSxcbiAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtNzg5JyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ2NvcnIteHl6LTc4OScsXG4gICAgICAgIHJhd0F1dGhDb250ZXh0OiB7XG4gICAgICAgICAgc3ViOiAndXNlci0xMjMtNDU2JyxcbiAgICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdqb2huLmRvZScsXG4gICAgICAgICAgJ2NvZ25pdG86Z3JvdXBzJzogJ2FkbWluLHVzZXInLFxuICAgICAgICAgICdjdXN0b206dGVuYW50SWQnOiAndGVuYW50LTc4OScsXG4gICAgICAgICAgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJ1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChhY3Rvci50aW1lc3RhbXApLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGV4dHJhY3QgYWN0b3IgY29udGV4dCBmcm9tIEFQSSBLZXkgYXV0aG9yaXphdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMTAuMC4wLjEnLFxuICAgICAgICAgICAgYXBpS2V5OiAnYXBpLWtleS1hYmMxMjMnLFxuICAgICAgICAgICAgYXBpS2V5SWQ6ICdrZXktaWQtNDU2J1xuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnlcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtZGVmLTQ1NidcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1kZWYtNDU2JyxcbiAgICAgICAgc291cmNlSXA6ICcxMC4wLjAuMScsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhcGkta2V5JyxcbiAgICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICAgIGFjdG9ySWQ6ICdhcGkta2V5OmFwaS1rZXktYWJjMTIzJyxcbiAgICAgICAgYXBpS2V5SWQ6ICdhcGkta2V5LWFiYzEyMycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdyZXEtZGVmLTQ1NidcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBleHRyYWN0IGFjdG9yIGNvbnRleHQgZnJvbSBJQU0gYXV0aG9yaXphdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMTcyLjE2LjAuMScsXG4gICAgICAgICAgICB1c2VyQXJuOiAnYXJuOmF3czppYW06OjEyMzQ1Njc4OTAxMjp1c2VyL3NlcnZpY2UtdXNlcicsXG4gICAgICAgICAgICB1c2VyOiAnQUlEQUkyM0haMjdTSTZGUU1HTlEyJ1xuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnlcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtZ2hpLTc4OSdcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1naGktNzg5JyxcbiAgICAgICAgc291cmNlSXA6ICcxNzIuMTYuMC4xJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2lhbScsXG4gICAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICBhY3RvcklkOiAnQUlEQUkyM0haMjdTSTZGUU1HTlEyJyxcbiAgICAgICAgaWFtUm9sZTogJ2Fybjphd3M6aWFtOjoxMjM0NTY3ODkwMTI6dXNlci9zZXJ2aWNlLXVzZXInLFxuICAgICAgICBpYW1Vc2VySWQ6ICdBSURBSTIzSFoyN1NJNkZRTUdOUTInLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAncmVxLWdoaS03ODknXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHN5c3RlbS9hbm9ueW1vdXMgYXV0aG9yaXphdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMjAzLjAuMTEzLjEnXG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1qa2wtMDEyJ1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGFjdG9yID0gKGNvbnRyb2xsZXIgYXMgYW55KS5leHRyYWN0QWN0b3JDb250ZXh0KGV2ZW50LCByZXF1ZXN0KTtcblxuICAgICAgZXhwZWN0KGFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWprbC0wMTInLFxuICAgICAgICBzb3VyY2VJcDogJzIwMy4wLjExMy4xJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ3N5c3RlbScsXG4gICAgICAgIGFjdG9yVHlwZTogJ2Fub255bW91cycsXG4gICAgICAgIGFjdG9ySWQ6ICdzeXN0ZW0nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAncmVxLWprbC0wMTInXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHRlbmFudCBJRCBmcm9tIGN1c3RvbSBoZWFkZXJzJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnRGb3JBY3RvclRlc3RzKCk7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtbW5vLTM0NScsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAneC10ZW5hbnQtaWQnOiAndGVuYW50LWZyb20taGVhZGVyJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWN0b3IgPSAoY29udHJvbGxlciBhcyBhbnkpLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYWN0b3IudGVuYW50SWQpLnRvQmUoJ3RlbmFudC1mcm9tLWhlYWRlcicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWlzc2luZyBvcHRpb25hbCBmaWVsZHMgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIGhlYWRlcnM6IHt9LCAvLyBObyB1c2VyLWFnZW50XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIHNvdXJjZUlwOiB1bmRlZmluZWQgLy8gTm8gc291cmNlIElQXG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIGFueVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBjcmVhdGVNb2NrUmVxdWVzdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1wcXItNjc4JyxcbiAgICAgICAgaGVhZGVyczoge30gLy8gTm8gY3VzdG9tIGhlYWRlcnNcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3RvcikudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS1wcXItNjc4JyxcbiAgICAgICAgc291cmNlSXA6IHVuZGVmaW5lZCxcbiAgICAgICAgdXNlckFnZW50OiB1bmRlZmluZWQsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdzeXN0ZW0nLFxuICAgICAgICBhY3RvclR5cGU6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvcklkOiAnc3lzdGVtJyxcbiAgICAgICAgdGVuYW50SWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3JlcS1wcXItNjc4J1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByaW9yaXRpemUgY29nbml0byB1c2VybmFtZSBvdmVyIHN1YiBmb3IgYWN0b3JJZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQWN0b3JUZXN0cyh7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgYXV0aG9yaXplcjoge1xuICAgICAgICAgICAgY2xhaW1zOiB7XG4gICAgICAgICAgICAgIHN1YjogJ3VzZXItc3ViLTEyMycsXG4gICAgICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ3ByZWZlcnJlZC51c2VybmFtZSdcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVxdWVzdCA9IGNyZWF0ZU1vY2tSZXF1ZXN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXN0dS05MDEnXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWN0b3IgPSAoY29udHJvbGxlciBhcyBhbnkpLmV4dHJhY3RBY3RvckNvbnRleHQoZXZlbnQsIHJlcXVlc3QpO1xuXG4gICAgICBleHBlY3QoYWN0b3IuYWN0b3JJZCkudG9CZSgncHJlZmVycmVkLnVzZXJuYW1lJyk7XG4gICAgICBleHBlY3QoYWN0b3IuY29nbml0b1N1YikudG9CZSgndXNlci1zdWItMTIzJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHVzZSBzdWIgYXMgZmFsbGJhY2sgd2hlbiBjb2duaXRvIHVzZXJuYW1lIGlzIG5vdCBhdmFpbGFibGUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tFdmVudEZvckFjdG9yVGVzdHMoe1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICd1c2VyLXN1Yi00NTYnLFxuICAgICAgICAgICAgICB1c2VybmFtZTogJ2ZhbGxiYWNrLnVzZXJuYW1lJ1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBhcyBhbnlcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdnd4LTIzNCdcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhY3RvciA9IChjb250cm9sbGVyIGFzIGFueSkuZXh0cmFjdEFjdG9yQ29udGV4dChldmVudCwgcmVxdWVzdCk7XG5cbiAgICAgIGV4cGVjdChhY3Rvci5hY3RvcklkKS50b0JlKCdmYWxsYmFjay51c2VybmFtZScpO1xuICAgICAgZXhwZWN0KGFjdG9yLmNvZ25pdG9TdWIpLnRvQmUoJ3VzZXItc3ViLTQ1NicpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnYnVpbGRDdHggaW50ZWdyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBidWlsZCBleGVjdXRpb24gY29udGV4dCB3aXRoIGFjdG9yJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBUZXN0Q29udHJvbGxlcih7fSk7XG4gICAgICBcbiAgICAgIGNvbnN0IGNyZWF0ZU1vY2tFdmVudEZvckJ1aWxkQ3R4ID0gKG92ZXJyaWRlczogUGFydGlhbDxBUElHYXRld2F5RXZlbnQ+ID0ge30pOiBBUElHYXRld2F5RXZlbnQgPT4ge1xuICAgICAgICBjb25zdCBiYXNlRXZlbnQgPSB7XG4gICAgICAgICAgcmVzb3VyY2U6ICcvdGVzdCcsXG4gICAgICAgICAgcGF0aDogJy90ZXN0JyxcbiAgICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICBoZWFkZXJzOiB7fSxcbiAgICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXG4gICAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXG4gICAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXG4gICAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICAgIHJlc291cmNlSWQ6ICd0ZXN0JyxcbiAgICAgICAgICAgIHJlc291cmNlUGF0aDogJy90ZXN0JyxcbiAgICAgICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgcmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0JyxcbiAgICAgICAgICAgIHN0YWdlOiAndGVzdCcsXG4gICAgICAgICAgICBpZGVudGl0eToge1xuICAgICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlQb29sSWQ6IG51bGwsXG4gICAgICAgICAgICAgIGFjY291bnRJZDogbnVsbCxcbiAgICAgICAgICAgICAgY29nbml0b0lkZW50aXR5SWQ6IG51bGwsXG4gICAgICAgICAgICAgIGNhbGxlcjogbnVsbCxcbiAgICAgICAgICAgICAgc291cmNlSXA6ICcxMjcuMC4wLjEnLFxuICAgICAgICAgICAgICBwcmluY2lwYWxPcmdJZDogbnVsbCxcbiAgICAgICAgICAgICAgYWNjZXNzS2V5OiBudWxsLFxuICAgICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25UeXBlOiBudWxsLFxuICAgICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25Qcm92aWRlcjogbnVsbCxcbiAgICAgICAgICAgICAgdXNlckFybjogbnVsbCxcbiAgICAgICAgICAgICAgdXNlckFnZW50OiAndGVzdC1hZ2VudCcsXG4gICAgICAgICAgICAgIHVzZXI6IG51bGwsXG4gICAgICAgICAgICAgIGFwaUtleTogbnVsbCxcbiAgICAgICAgICAgICAgYXBpS2V5SWQ6IG51bGwsXG4gICAgICAgICAgICAgIGNsaWVudENlcnQ6IG51bGxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwcm90b2NvbDogJ0hUVFAvMS4xJyxcbiAgICAgICAgICAgIHJlcXVlc3RUaW1lOiAnMDkvQXByLzIwMTU6MTI6MzQ6NTYgKzAwMDAnLFxuICAgICAgICAgICAgcmVxdWVzdFRpbWVFcG9jaDogMTQyODU4Mjg5NjAwMCxcbiAgICAgICAgICAgIGFwaUlkOiAndGVzdC1hcGknXG4gICAgICAgICAgfSxcbiAgICAgICAgICBib2R5OiBudWxsLFxuICAgICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXG4gICAgICAgIH0gYXMgQVBJR2F0ZXdheUV2ZW50O1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgLi4uYmFzZUV2ZW50LFxuICAgICAgICAgIC4uLm92ZXJyaWRlcyxcbiAgICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgICAgLi4uYmFzZUV2ZW50LnJlcXVlc3RDb250ZXh0LFxuICAgICAgICAgICAgLi4ub3ZlcnJpZGVzLnJlcXVlc3RDb250ZXh0XG4gICAgICAgICAgfVxuICAgICAgICB9IGFzIEFQSUdhdGV3YXlFdmVudDtcbiAgICAgIH07XG4gICAgICBcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50Rm9yQnVpbGRDdHgoe1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGNsYWltczoge1xuICAgICAgICAgICAgICBzdWI6ICd1c2VyLTEyMycsXG4gICAgICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ3Rlc3QudXNlcidcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gYXMgYW55XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgY29udGV4dCA9IHt9IGFzIENvbnRleHQ7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gY3JlYXRlTW9ja1JlcXVlc3Qoe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtY3R4LXRlc3QnXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0ge307XG5cbiAgICAgIGNvbnN0IGV4ZWN1dGlvbkNvbnRleHQgPSBjb250cm9sbGVyLnRlc3RCdWlsZEN0eChldmVudCwgY29udGV4dCwgcmVxdWVzdCwgcmVzcG9uc2UpO1xuXG4gICAgICBleHBlY3QoZXhlY3V0aW9uQ29udGV4dCkudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIGV2ZW50LFxuICAgICAgICBsYW1iZGFDb250ZXh0OiBjb250ZXh0LFxuICAgICAgICByZXF1ZXN0LFxuICAgICAgICByZXNwb25zZSxcbiAgICAgICAgZGVidWdJbmZvOiB7fVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChleGVjdXRpb25Db250ZXh0LmFjdG9yKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLWN0eC10ZXN0JyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYWN0b3JJZDogJ3Rlc3QudXNlcicsXG4gICAgICAgIGNvZ25pdG9TdWI6ICd1c2VyLTEyMycsXG4gICAgICAgIGNvZ25pdG9Vc2VybmFtZTogJ3Rlc3QudXNlcidcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn0pOyJdfQ==