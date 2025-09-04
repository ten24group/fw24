import { APIController } from '../../core/runtime/api-gateway-controller';
import { AuditConfig } from '../interfaces';
import { ExecutionContext, Actor } from '../../core/types/execution-context';
import { Response } from '../../interfaces';

describe('Selective Field Auditing', () => {
  
  class TestSelectiveAuditController extends APIController {
    constructor() {
      super();
    }
    
    // Expose private methods for testing
    public testBuildRequestContext(ctx: ExecutionContext, auditConfig: AuditConfig) {
      return this['buildRequestContext'](ctx, auditConfig);
    }
    
    public testBuildResponseContext(response: Response, auditConfig: AuditConfig) {
      return this['buildResponseContext'](response, auditConfig);
    }
    
    public testSelectivelyIncludeFields(obj: any, fields: string[]) {
      return this['selectivelyIncludeFields'](obj, fields);
    }
    
    public testSelectivelyIncludeResponseBody(body: string, fields: string[]) {
      return this['selectivelyIncludeResponseBody'](body, fields);
    }
    
    protected initialize() {
      return Promise.resolve();
    }
  }

  const createMockExecutionContext = (): ExecutionContext => {
    // Simplified mock that focuses on what buildRequestContext actually uses
    const mockRequest = {
      httpMethod: 'POST',
      path: '/api/users',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
        'user-agent': 'Mozilla/5.0',
        'x-forwarded-for': '192.168.1.1'
      },
      body: {
        email: 'john@example.com',
        password: 'secret123',
        name: 'John Doe',
        age: 30,
        preferences: {
          theme: 'dark',
          notifications: true
        }
      },
      queryStringParameters: {
        page: '1',
        limit: '10',
        sort: 'name',
        debug: 'true'
      }
    };

    return {
      request: mockRequest as any,
      response: {} as any,
      event: {
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer token123',
          'user-agent': 'Mozilla/5.0'
        },
        requestContext: {
          identity: { sourceIp: '192.168.1.1' }
        }
      } as any,
      lambdaContext: {} as any,
      actor: {
        actorType: 'user',
        actorId: 'user123',
        authMethod: 'cognito',
        requestId: 'req-123',
        timestamp: '2024-01-01T00:00:00.000Z'
      } as Actor
    };
  };

  const createMockResponse = (): Response => ({
    statusCode: 201,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-remaining': '99',
      'x-response-time': '150ms'
    },
    body: JSON.stringify({
      id: '123',
      email: 'john@example.com',
      name: 'John Doe',
      token: 'access_token_123',
      internal: {
        userId: 'user_123',
        permissions: ['read', 'write']
      }
    }),
    isBase64Encoded: false,
    // Only include the methods that might be called by the code under test
    send: jest.fn(),
    end: jest.fn(),
    set: jest.fn(),
    setHeader: jest.fn(),
    getHeader: jest.fn(),
    getHeaders: jest.fn(),
    getBody: jest.fn(),
    getStatusCode: jest.fn(),
    json: jest.fn(),
    text: jest.fn(),
    html: jest.fn(),
    xml: jest.fn(),
    binary: jest.fn(),
    download: jest.fn(),
    status: jest.fn(),
    header: jest.fn(),
    cookie: jest.fn(),
    cors: jest.fn(),
    cache: jest.fn(),
    redirect: jest.fn(),
    withMetadata: jest.fn(),
    withMetrics: jest.fn(),
    setMetadata: jest.fn(),
    build: jest.fn()
  });

  let controller: TestSelectiveAuditController;

  beforeEach(() => {
    controller = new TestSelectiveAuditController();
  });

  describe('selectivelyIncludeFields Helper', () => {
    it('should return entire object when no fields specified', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const result = controller.testSelectivelyIncludeFields(obj, []);
      
      expect(result).toEqual(obj);
    });

    it('should extract only specified fields', () => {
      const obj = { a: 1, b: 2, c: 3, d: 4 };
      const result = controller.testSelectivelyIncludeFields(obj, ['a', 'c']);
      
      expect(result).toEqual({ a: 1, c: 3 });
    });

    it('should ignore non-existent fields', () => {
      const obj = { a: 1, b: 2 };
      const result = controller.testSelectivelyIncludeFields(obj, ['a', 'nonexistent', 'b']);
      
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should handle null/undefined objects', () => {
      expect(controller.testSelectivelyIncludeFields(null, ['field'])).toBeNull();
      expect(controller.testSelectivelyIncludeFields(undefined, ['field'])).toBeUndefined();
    });
  });

  describe('selectivelyIncludeResponseBody Helper', () => {
    it('should return entire JSON body when no fields specified', () => {
      const jsonBody = JSON.stringify({ a: 1, b: 2, c: 3 });
      const result = controller.testSelectivelyIncludeResponseBody(jsonBody, []);
      
      expect(result).toEqual(jsonBody);
    });

    it('should extract only specified fields from JSON body', () => {
      const jsonBody = JSON.stringify({ a: 1, b: 2, c: 3, d: 4 });
      const result = controller.testSelectivelyIncludeResponseBody(jsonBody, ['a', 'c']);
      
      expect(result).toEqual(JSON.stringify({ a: 1, c: 3 }));
    });

    it('should ignore non-existent fields in JSON body', () => {
      const jsonBody = JSON.stringify({ a: 1, b: 2 });
      const result = controller.testSelectivelyIncludeResponseBody(jsonBody, ['a', 'nonexistent', 'b']);
      
      expect(result).toEqual(JSON.stringify({ a: 1, b: 2 }));
    });

    it('should handle non-JSON strings by returning as-is', () => {
      const plainText = 'This is plain text';
      const result = controller.testSelectivelyIncludeResponseBody(plainText, ['field']);
      
      expect(result).toEqual(plainText);
    });

    it('should handle invalid JSON gracefully', () => {
      const invalidJson = '{ invalid json }';
      const result = controller.testSelectivelyIncludeResponseBody(invalidJson, ['field']);
      
      expect(result).toEqual(invalidJson);
    });

    it('should handle null/undefined/empty strings', () => {
      expect(controller.testSelectivelyIncludeResponseBody('', ['field'])).toBe('');
      expect(controller.testSelectivelyIncludeResponseBody(null as any, ['field'])).toBeNull();
      expect(controller.testSelectivelyIncludeResponseBody(undefined as any, ['field'])).toBeUndefined();
    });
  });

  describe('Request Context - Legacy Array Format', () => {
    it('should include all headers when headers specified', () => {
      const ctx = createMockExecutionContext();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: { request: ['headers'] }
      };

      const result = controller.testBuildRequestContext(ctx, auditConfig);

      expect(result.headers).toEqual(ctx.request.headers);
      expect(result.body).toBeUndefined();
      expect(result.query).toBeUndefined();
    });

    it('should include multiple sections when specified', () => {
      const ctx = createMockExecutionContext();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: { request: ['headers', 'body', 'query'] }
      };

      const result = controller.testBuildRequestContext(ctx, auditConfig);

      expect(result.headers).toEqual(ctx.request.headers);
      expect(result.body).toEqual(ctx.request.body);
      expect(result.query).toEqual(ctx.request.queryStringParameters);
    });
  });

  describe('Request Context - Selective Object Format', () => {
    it('should include only specified header fields', () => {
      const ctx = createMockExecutionContext();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: {
          request: {
            headers: ['content-type', 'user-agent']
          }
        }
      };

      const result = controller.testBuildRequestContext(ctx, auditConfig);

      expect(result.headers).toEqual({
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0'
      });
      expect(result.body).toBeUndefined();
      expect(result.query).toBeUndefined();
    });

    it('should include only specified body fields', () => {
      const ctx = createMockExecutionContext();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: {
          request: {
            body: ['email', 'name']
          }
        }
      };

      const result = controller.testBuildRequestContext(ctx, auditConfig);

      expect(result.body).toEqual({
        email: 'john@example.com',
        name: 'John Doe'
      });
      expect(result.headers).toBeUndefined();
      expect(result.query).toBeUndefined();
    });

    it('should include only specified query fields', () => {
      const ctx = createMockExecutionContext();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: {
          request: {
            query: ['page', 'limit']
          }
        }
      };

      const result = controller.testBuildRequestContext(ctx, auditConfig);

      expect(result.query).toEqual({
        page: '1',
        limit: '10'
      });
      expect(result.headers).toBeUndefined();
      expect(result.body).toBeUndefined();
    });

    it('should handle selective includes for multiple sections', () => {
      const ctx = createMockExecutionContext();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: {
          request: {
            headers: ['content-type'],
            body: ['email'],
            query: ['page']
          }
        }
      };

      const result = controller.testBuildRequestContext(ctx, auditConfig);

      expect(result.headers).toEqual({ 'content-type': 'application/json' });
      expect(result.body).toEqual({ email: 'john@example.com' });
      expect(result.query).toEqual({ page: '1' });
    });

    it('should exclude sensitive fields from audit', () => {
      const ctx = createMockExecutionContext();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: {
          request: {
            headers: ['content-type', 'user-agent'], // Exclude authorization
            body: ['email', 'name']                  // Exclude password
          }
        }
      };

      const result = controller.testBuildRequestContext(ctx, auditConfig);

      expect(result.headers).not.toHaveProperty('authorization');
      expect(result.body).not.toHaveProperty('password');
      expect(result.headers).toEqual({
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0'
      });
      expect(result.body).toEqual({
        email: 'john@example.com',
        name: 'John Doe'
      });
    });
  });

  describe('Response Context - Legacy Array Format', () => {
    it('should include all headers when headers specified', () => {
      const response = createMockResponse();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: { response: ['headers'] }
      };

      const result = controller.testBuildResponseContext(response, auditConfig);

      expect(result?.headers).toEqual(response.headers);
      expect(result?.body).toBeUndefined();
    });

    it('should include both headers and body when specified', () => {
      const response = createMockResponse();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: { response: ['headers', 'body'] }
      };

      const result = controller.testBuildResponseContext(response, auditConfig);

      expect(result?.headers).toEqual(response.headers);
      expect(result?.body).toEqual(response.body);
    });
  });

  describe('Response Context - Selective Object Format', () => {
    it('should include only specified response header fields', () => {
      const response = createMockResponse();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: {
          response: {
            headers: ['content-type', 'x-response-time']
          }
        }
      };

      const result = controller.testBuildResponseContext(response, auditConfig);

      expect(result?.headers).toEqual({
        'content-type': 'application/json',
        'x-response-time': '150ms'
      });
      expect(result?.body).toBeUndefined();
    });

    it('should include only specified response body fields', () => {
      const response = createMockResponse();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: {
          response: {
            body: ['id', 'email', 'name']
          }
        }
      };

      const result = controller.testBuildResponseContext(response, auditConfig);

      expect(result?.body).toEqual(JSON.stringify({
        id: '123',
        email: 'john@example.com',
        name: 'John Doe'
      }));
      expect(result?.headers).toBeUndefined();
    });

    it('should exclude sensitive response fields', () => {
      const response = createMockResponse();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: {
          response: {
            body: ['id', 'email', 'name'] // Exclude token and internal
          }
        }
      };

      const result = controller.testBuildResponseContext(response, auditConfig);

      const parsedBody = JSON.parse(result?.body || '{}');
      expect(parsedBody).not.toHaveProperty('token');
      expect(parsedBody).not.toHaveProperty('internal');
      expect(parsedBody).toEqual({
        id: '123',
        email: 'john@example.com',
        name: 'John Doe'
      });
    });
  });

  describe('Backwards Compatibility', () => {
    it('should handle boolean true for request includes', () => {
      const ctx = createMockExecutionContext();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: { request: true }
      };

      const result = controller.testBuildRequestContext(ctx, auditConfig);

      expect(result.headers).toEqual(ctx.request.headers);
      expect(result.body).toBeUndefined();
      expect(result.query).toBeUndefined();
    });

    it('should handle boolean true for response includes', () => {
      const response = createMockResponse();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: { response: true }
      };

      const result = controller.testBuildResponseContext(response, auditConfig);

      expect(result?.headers).toEqual(response.headers);
      expect(result?.body).toBeUndefined();
    });

    it('should return undefined when no includes specified', () => {
      const ctx = createMockExecutionContext();
      const response = createMockResponse();
      const auditConfig: AuditConfig = { enabled: true };

      const requestResult = controller.testBuildRequestContext(ctx, auditConfig);
      const responseResult = controller.testBuildResponseContext(response, auditConfig);

      expect(requestResult.headers).toBeUndefined();
      expect(requestResult.body).toBeUndefined();
      expect(requestResult.query).toBeUndefined();
      expect(responseResult).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty field arrays correctly', () => {
      const ctx = createMockExecutionContext();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: {
          request: {
            headers: [],
            body: [],
            query: []
          }
        }
      };

      const result = controller.testBuildRequestContext(ctx, auditConfig);

      // Empty arrays should still include the objects (implementation returns full object when no fields specified)
      expect(result.headers).toEqual(ctx.request.headers);
      expect(result.body).toEqual(ctx.request.body);
      expect(result.query).toEqual(ctx.request.queryStringParameters);
    });

    it('should handle non-existent fields gracefully', () => {
      const ctx = createMockExecutionContext();
      const auditConfig: AuditConfig = {
        enabled: true,
        includes: {
          request: {
            headers: ['non-existent-header'],
            body: ['non-existent-field']
          }
        }
      };

      const result = controller.testBuildRequestContext(ctx, auditConfig);

      expect(result.headers).toEqual({});
      expect(result.body).toEqual({});
    });
  });

  describe('Real Implementation Validation', () => {
    it('should verify the selectivelyIncludeFields implementation matches expected behavior', () => {
      // Test that our implementation correctly handles the documented behavior
      const testObj = {
        sensitive: 'secret123',
        public: 'visible',
        nested: { inner: 'data' }
      };

      // Test selective inclusion
      const selected = controller.testSelectivelyIncludeFields(testObj, ['public', 'nested']);
      expect(selected).toEqual({ public: 'visible', nested: { inner: 'data' } });
      expect(selected).not.toHaveProperty('sensitive');

      // Test empty array behavior
      const all = controller.testSelectivelyIncludeFields(testObj, []);
      expect(all).toEqual(testObj);
    });

    it('should verify buildRequestContext handles real-world audit configs', () => {
      const ctx = createMockExecutionContext();
      
      // Test a realistic audit config for a payment API
      const paymentAuditConfig: AuditConfig = {
        enabled: true,
        includes: {
          request: {
            headers: ['content-type', 'user-agent'],  // Exclude authorization
            body: ['amount', 'currency', 'orderId'],  // Exclude card details
            query: ['merchantId']                     // Only merchant tracking
          }
        }
      };

      const result = controller.testBuildRequestContext(ctx, paymentAuditConfig);

      // Should only include safe fields
      expect(result.headers).toEqual({
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0'
      });
      expect(result.headers).not.toHaveProperty('authorization');
      
      // Should exclude sensitive body fields like password
      expect(result.body).not.toHaveProperty('password');
      expect(result.body).not.toHaveProperty('email');
      
      // Should be empty since merchantId is not in our mock query
      expect(result.query).toEqual({});
    });
  });
});
