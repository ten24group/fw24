import { APIController } from './api-gateway-controller';
import type { Request } from '../../interfaces';
import type { APIGatewayEvent, Context } from 'aws-lambda';

// Create a test controller class
class TestController extends APIController {
  public controllerName = 'test';
  public routes = {};

  constructor(routes: Record<string, any>) {
    super();
    this.routes = routes;
  }

  // Expose private methods for testing
  public testFindMatchingRoute(requestData: Request) {
    return (this as any).findMatchingRoute(requestData);
  }

  public testGetRouteFunction(route: any) {
    return (this as any).getRouteFunction(route);
  }

  public testExecuteMiddlewarePipeline(phase: string, request: Request, response: any, ctx?: any, error?: Error) {
    return (this as any).executeMiddlewarePipeline(phase, request, response, ctx, error);
  }

  public testHandleResponse(res: any) {
    return (this as any).handleResponse(res);
  }

  public testHandleException(req: Request, err: Error, res: any) {
    return (this as any).handleException(req, err, res);
  }

  public testBuildCtx(event: APIGatewayEvent, context: Context, request: Request, response: any) {
    return (this as any).buildCtx(event, context, request, response);
  }

  // Expose middleware registration for testing
  public testUseMiddleware(middleware: any) {
    this.useMiddleware(middleware);
  }

  // Expose protected methods for testing
  public testHandleNotFound(req: Request) {
    return this.handleNotFound(req);
  }

  // Test handler methods
  public testHandler() {
    return { message: 'test handler called' };
  }

  public async testAsyncHandler() {
    return { message: 'async test handler called' };
  }

  public testHandlerWithError() {
    throw new Error('Test handler error');
  }

  // Required abstract method
  async initialize(_event: APIGatewayEvent, _context: Context): Promise<void> {
    // No-op for testing
  }
}

// Helper function to create mock Request objects
function createMockRequest(overrides: Partial<Request> = {}): Request {
  const mockEvent = {} as APIGatewayEvent;
  const mockContext = {} as Context;

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
      const specialCharCases = [ 'abc-123', 'user_456', '999', 'special%20chars' ];
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
      const httpMethods = [ 'GET', 'PUT', 'DELETE' ];
      const expectedHandlers = [ 'getById', 'updateById', 'deleteById' ];
      httpMethods.forEach((method, index) => {
        request = createMockRequest({
          httpMethod: method,
          resource: '/test/123',
          pathParameters: { id: '123' },
        });
        expect(controller.testFindMatchingRoute(request)).toEqual({ handler: expectedHandlers[ index ] });
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
          middleware: [ 'auth', 'logging' ],
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
        middleware: [ 'auth', 'logging' ],
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
      [ null, { functionName: 'nonExistent' }, { functionName: 'notAFunction' } ].forEach(route => {
        const result = controller.testGetRouteFunction(route).call(controller, createMockRequest());
        expect(result.statusCode).toBe(404);
      });
    });
  });
});