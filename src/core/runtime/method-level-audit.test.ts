import { APIController } from './api-gateway-controller';
import { ExecutionContext, Actor } from '../types/execution-context';
import { createHashBasedSampling } from '../../audit/helpers/sampling';
import { Request, Response, Route } from '../../interfaces';
import { APIGatewayEvent, Context } from 'aws-lambda';
import { AuditConfig } from '../../audit/interfaces';

// Mock the audit logger factory to capture actual audit logs
jest.mock('../../audit/loggers/factory', () => {
  const mockAuditLogger = {
    audit: jest.fn().mockResolvedValue(undefined)
  };

  const mockFactoryInstance = {
    create: jest.fn().mockReturnValue(mockAuditLogger)
  };

  return {
    AuditLoggerFactory: {
      getInstance: jest.fn().mockReturnValue(mockFactoryInstance)
    }
  };
});

// Get references to the mocked objects for test assertions
const { AuditLoggerFactory } = require('../../audit/loggers/factory');
const mockFactoryInstance = AuditLoggerFactory.getInstance();
const mockAuditLogger = mockFactoryInstance.create();

// Mock Reflect for decorator metadata
const mockReflectGet = jest.fn();
const mockReflectSet = jest.fn();
global.Reflect = {
  ...global.Reflect,
  get: mockReflectGet,
  set: mockReflectSet
};

// Test controller for method-level audit functionality
class TestMethodAuditController extends APIController {
  
  private controllerAuditConfig: AuditConfig = {
    enabled: true,
    category: 'controller-level',
    includes: {
      request: ['headers'],
      response: ['headers']
    },
    dataProtection: {
      enabled: true,
      deepRedact: {
        blacklistedKeys: ['password', 'secret']
      }
    }
  };

  getControllerConfig() {
    return {
      audit: this.controllerAuditConfig
    };
  }

  // Expose the private method for testing
  public testMergeAuditConfigs(controllerAudit?: AuditConfig, methodAudit?: AuditConfig): AuditConfig | undefined {
    return this['mergeAuditConfigs'](controllerAudit, methodAudit);
  }

  // Expose makeAuditContext for testing
  public testMakeAuditContext(ctx: ExecutionContext, route?: Route | null) {
    return this['makeAuditContext'](ctx, route);
  }
}

// Helper to create proper mock objects
function createMockAPIGatewayEvent(): APIGatewayEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/test',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: 'test-account',
      apiId: 'test-api',
      stage: 'test',
      requestId: 'test-request-123',
      requestTime: new Date().toISOString(),
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/test',
      httpMethod: 'GET',
      path: '/test/path',
      protocol: 'HTTP/1.1',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'test-agent',
        userArn: null,
        clientCert: null
      },
      authorizer: null
    },
    resource: '/test'
  };
}

function createMockLambdaContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    memoryLimitInMB: '128',
    awsRequestId: 'test-aws-request-id',
    logGroupName: '/aws/lambda/test',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {}
  };
}

function createMockRequest(httpMethod: string = 'GET', path: string = '/basic'): Request {
  const mockEvent = createMockAPIGatewayEvent();
  return {
    event: mockEvent,
    context: createMockLambdaContext(),
    httpMethod,
    path,
    pathParameters: { id: '123' },
    queryStringParameters: {},
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': 'test-correlation-123'
    },
    body: JSON.stringify({ test: 'data', password: 'secret123' }),
    isBase64Encoded: false,
    requestId: 'test-request-123',
    resource: '/test',
    stageVariables: {},
    requestContext: mockEvent.requestContext,
    getParam: jest.fn(),
    hasParam: jest.fn(),
    getHeader: jest.fn(),
    hasHeader: jest.fn(),
    getPathParam: jest.fn(),
    hasPathParam: jest.fn(),
    getQueryParam: jest.fn(),
    hasQueryParam: jest.fn(),
    getBodyParam: jest.fn(),
    hasBodyParam: jest.fn()
  };
}

function createMockResponse(): Response {
  return {
    statusCode: 200,
    headers: {},
    body: '{}',
    isBase64Encoded: false,
    send: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    getHeader: jest.fn(),
    getHeaders: jest.fn(),
    getBody: jest.fn(),
    getStatusCode: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    html: jest.fn().mockReturnThis(),
    xml: jest.fn().mockReturnThis(),
    binary: jest.fn().mockReturnThis(),
    download: jest.fn().mockImplementation(function(this: Response) { return Promise.resolve(this); }),
    header: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    cors: jest.fn().mockReturnThis(),
    cache: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    withMetadata: jest.fn().mockReturnThis(),
    withMetrics: jest.fn().mockReturnThis(),
    setMetadata: jest.fn().mockReturnThis(),
    build: jest.fn()
  };
}

function createMockActor(): Actor {
  return {
    actorType: 'user',
    requestId: 'test-request-123',
    timestamp: new Date().toISOString(),
    correlationId: 'test-correlation-123',
    sourceIp: '127.0.0.1',
    userAgent: 'test-agent'
  };
}

// Helper to create mock execution context
function createMockExecutionContext(httpMethod: string = 'GET', path: string = '/basic'): ExecutionContext {
  return {
    event: createMockAPIGatewayEvent(),
    lambdaContext: createMockLambdaContext(),
    request: createMockRequest(httpMethod, path),
    response: createMockResponse(),
    actor: createMockActor()
  };
}

describe('Method-Level Audit Configuration', () => {
  let controller: TestMethodAuditController;

  beforeEach(() => {
    // Clear mocks but preserve spy setup
    mockFactoryInstance.create.mockClear();
    mockAuditLogger.audit.mockClear();
    
    // Create controller using proper framework conventions
    controller = new TestMethodAuditController();
  });

  describe('Audit Config Merging Logic', () => {
    it('should merge method-level config with controller config', () => {
      const controllerConfig: AuditConfig = {
        enabled: true,
        category: 'controller-level',
        includes: {
          request: ['headers'],
          response: ['headers']
        },
        dataProtection: {
          enabled: true,
          deepRedact: {
            blacklistedKeys: ['password', 'secret']
          }
        }
      };

      const methodConfig: AuditConfig = {
        enabled: true,
        category: 'method-enhanced',
        includes: {
          request: ['headers', 'body'],
          response: ['headers', 'body']
        }
      };

      const merged = controller.testMergeAuditConfigs(controllerConfig, methodConfig);

      expect(merged).toBeDefined();
      expect(merged?.enabled).toBe(true);
      expect(merged?.category).toBe('method-enhanced'); // Method overrides controller
      expect(merged?.includes?.request).toEqual(['headers', 'body']); // Method overrides controller
      expect(merged?.includes?.response).toEqual(['headers', 'body']); // Method overrides controller
      expect(merged?.dataProtection?.deepRedact?.blacklistedKeys).toEqual(['password', 'secret']); // Controller preserved
    });

    it('should disable audit when method-level config disables it', () => {
      const controllerConfig: AuditConfig = {
        enabled: true,
        category: 'controller-level'
      };

      const methodConfig: AuditConfig = {
        enabled: false
      };

      const merged = controller.testMergeAuditConfigs(controllerConfig, methodConfig);

      expect(merged?.enabled).toBe(false);
    });

    it('should merge data protection configs correctly', () => {
      const controllerConfig: AuditConfig = {
        enabled: true,
        dataProtection: {
          enabled: true,
          deepRedact: {
            blacklistedKeys: ['password', 'secret'],
            replacement: '[REDACTED]'
          }
        }
      };

      const methodConfig: AuditConfig = {
        dataProtection: {
          deepRedact: {
            blacklistedKeys: ['apiKey', 'token'],
            replacement: '[CUSTOM-REDACTED]'
          }
        }
      };

      const merged = controller.testMergeAuditConfigs(controllerConfig, methodConfig);

      expect(merged?.dataProtection?.deepRedact?.blacklistedKeys).toEqual(
        expect.arrayContaining(['password', 'secret', 'apiKey', 'token'])
      );
      expect(merged?.dataProtection?.deepRedact?.replacement).toBe('[CUSTOM-REDACTED]');
    });

    it('should merge custom context correctly', () => {
      const controllerConfig: AuditConfig = {
        enabled: true,
        customContext: {
          team: 'backend',
          service: 'api'
        }
      };

      const methodConfig: AuditConfig = {
        customContext: {
          feature: 'special-feature',
          service: 'override' // This should override
        }
      };

      const merged = controller.testMergeAuditConfigs(controllerConfig, methodConfig);

      expect(merged?.customContext).toEqual({
        team: 'backend',
        service: 'override', // Method override
        feature: 'special-feature'
      });
    });

    it('should handle method config only (no controller config)', () => {
      const methodConfig: AuditConfig = {
        enabled: true,
        category: 'method-only'
      };

      const merged = controller.testMergeAuditConfigs(undefined, methodConfig);

      expect(merged).toEqual(methodConfig);
    });

    it('should handle controller config only (no method config)', () => {
      const controllerConfig: AuditConfig = {
        enabled: true,
        category: 'controller-only'
      };
      
      const merged = controller.testMergeAuditConfigs(controllerConfig, undefined);

      expect(merged).toEqual(controllerConfig);
    });

    it('should handle empty configs', () => {
      const merged = controller.testMergeAuditConfigs(undefined, undefined);
      expect(merged).toBeUndefined();
    });

    it('should deduplicate request includes arrays correctly', () => {
      const controllerConfig: AuditConfig = {
        enabled: true,
        includes: {
          request: ['headers', 'query'] as ('headers' | 'body' | 'query')[],
          response: ['headers'] as ('headers' | 'body')[]
        }
      };

      const methodConfig: AuditConfig = {
        includes: {
          request: ['headers', 'body'] as ('headers' | 'body' | 'query')[], // 'headers' overlaps
          response: ['body'] as ('headers' | 'body')[]
        }
      };

      const merged = controller.testMergeAuditConfigs(controllerConfig, methodConfig);

      expect(merged?.includes?.request).toEqual(['headers', 'query', 'body']); // Deduplicated
      expect(merged?.includes?.response).toEqual(['headers', 'body']); // Deduplicated
    });
  });

  describe('Audit Context Creation with Method Routes', () => {
    it('should create audit context with method-level route config', () => {
      const ctx = createMockExecutionContext('POST', '/enhanced');
      
      const routeWithAudit: Route = {
        path: '/enhanced',
        httpMethod: 'POST',
        functionName: 'enhancedRoute',
        parameters: [],
        audit: {
          enabled: true,
          category: 'method-enhanced',
          includes: {
            request: ['headers', 'body'],
            response: ['headers', 'body']
          }
        }
      };

      const auditContext = controller.testMakeAuditContext(ctx, routeWithAudit);

      expect(auditContext).toBeTruthy();
      expect(auditContext?.category).toBe('method-enhanced');
      expect(auditContext?.auditConfig.includes?.request).toEqual(['headers', 'body']);
    });

    it('should return null when method-level config disables audit', () => {
      const ctx = createMockExecutionContext('GET', '/disabled');
      
      const routeWithDisabledAudit: Route = {
        path: '/disabled',
        httpMethod: 'GET',
        functionName: 'disabledRoute',
        parameters: [],
        audit: {
          enabled: false
        }
      };

      const auditContext = controller.testMakeAuditContext(ctx, routeWithDisabledAudit);

      expect(auditContext).toBeNull();
    });

    it('should use controller config when no method config provided', () => {
      const ctx = createMockExecutionContext('GET', '/basic');
      
      const routeWithoutAudit: Route = {
        path: '/basic',
        httpMethod: 'GET',
        functionName: 'basicRoute',
        parameters: []
      };

      const auditContext = controller.testMakeAuditContext(ctx, routeWithoutAudit);

      expect(auditContext).toBeTruthy();
      expect(auditContext?.category).toBe('controller-level');
      expect(auditContext?.auditConfig.includes?.request).toEqual(['headers']);
    });
  });

  describe('Critical Edge Cases - Controller No Audit vs Method With Audit', () => {
    
    class ControllerWithNoAuditConfig extends APIController {
      getControllerConfig() {
        return {}; // NO audit config at all
      }
      
      public testMakeAuditContext(ctx: ExecutionContext, route?: Route | null) {
        return this['makeAuditContext'](ctx, route);
      }
      
      public testMergeAuditConfigs(controllerAudit?: AuditConfig, methodAudit?: AuditConfig) {
        return this['mergeAuditConfigs'](controllerAudit, methodAudit);
      }
    }

    class ControllerWithDisabledAudit extends APIController {
      getControllerConfig() {
        return {
          audit: { enabled: false } // Explicitly disabled
        };
      }
      
      public testMakeAuditContext(ctx: ExecutionContext, route?: Route | null) {
        return this['makeAuditContext'](ctx, route);
      }
      
      public testMergeAuditConfigs(controllerAudit?: AuditConfig, methodAudit?: AuditConfig) {
        return this['mergeAuditConfigs'](controllerAudit, methodAudit);
      }
    }

    it('CRITICAL: should enable audit for method when controller has NO audit config', () => {
      const controllerWithNoAudit = new ControllerWithNoAuditConfig();
      const ctx = createMockExecutionContext('POST', '/special');
      
      const routeWithAudit: Route = {
        path: '/special',
        httpMethod: 'POST', 
        functionName: 'specialMethod',
        parameters: [],
        audit: {
          enabled: true,
          category: 'method-only-audit',
          includes: {
            request: ['headers', 'body']
          }
        }
      };

      const auditContext = controllerWithNoAudit.testMakeAuditContext(ctx, routeWithAudit);

      // This MUST work - method should enable audit even when controller has none
      expect(auditContext).toBeTruthy();
      expect(auditContext?.enabled).toBe(true);
      expect(auditContext?.category).toBe('method-only-audit');
      expect(auditContext?.auditConfig.includes?.request).toEqual(['headers', 'body']);
    });

    it('CRITICAL: should enable audit for method when controller explicitly disables audit', () => {
      const controllerWithDisabledAudit = new ControllerWithDisabledAudit();
      const ctx = createMockExecutionContext('POST', '/override');
      
      const routeWithAudit: Route = {
        path: '/override',
        httpMethod: 'POST',
        functionName: 'overrideMethod', 
        parameters: [],
        audit: {
          enabled: true,
          category: 'method-override-audit',
          includes: {
            request: ['headers', 'body'],
            response: ['headers']
          }
        }
      };

      const auditContext = controllerWithDisabledAudit.testMakeAuditContext(ctx, routeWithAudit);

      // This MUST work - method should override controller's disabled audit
      expect(auditContext).toBeTruthy(); 
      expect(auditContext?.enabled).toBe(true);
      expect(auditContext?.category).toBe('method-override-audit');
      expect(auditContext?.auditConfig.enabled).toBe(true);
      expect(auditContext?.auditConfig.includes?.request).toEqual(['headers', 'body']);
    });

    it('should return null when both controller and method disable audit', () => {
      const controllerWithDisabledAudit = new ControllerWithDisabledAudit();
      const ctx = createMockExecutionContext('GET', '/disabled-everywhere');
      
      const routeWithDisabledAudit: Route = {
        path: '/disabled-everywhere',
        httpMethod: 'GET',
        functionName: 'disabledMethod',
        parameters: [],
        audit: {
          enabled: false
        }
      };

      const auditContext = controllerWithDisabledAudit.testMakeAuditContext(ctx, routeWithDisabledAudit);

      expect(auditContext).toBeNull();
    });

    it('should return null when controller has no audit and method has no audit', () => {
      const controllerWithNoAudit = new ControllerWithNoAuditConfig();
      const ctx = createMockExecutionContext('GET', '/no-audit-anywhere');
      
      const routeWithNoAudit: Route = {
        path: '/no-audit-anywhere',
        httpMethod: 'GET',
        functionName: 'noAuditMethod',
        parameters: []
        // No audit config
      };

      const auditContext = controllerWithNoAudit.testMakeAuditContext(ctx, routeWithNoAudit);

      expect(auditContext).toBeNull();
    });

    // Test the merging logic directly for these edge cases
    it('should merge correctly: no controller config + method config', () => {
      const controllerWithNoAudit = new ControllerWithNoAuditConfig();
      
      const methodConfig: AuditConfig = {
        enabled: true,
        category: 'method-only'
      };

      const merged = controllerWithNoAudit.testMergeAuditConfigs(undefined, methodConfig);

      expect(merged).toEqual(methodConfig);
      expect(merged?.enabled).toBe(true);
    });

    it('should merge correctly: disabled controller + enabled method', () => {
      const controllerWithDisabledAudit = new ControllerWithDisabledAudit();
      
      const controllerConfig: AuditConfig = { enabled: false };
      const methodConfig: AuditConfig = { 
        enabled: true,
        category: 'method-override'
      };

      const merged = controllerWithDisabledAudit.testMergeAuditConfigs(controllerConfig, methodConfig);

      expect(merged?.enabled).toBe(true); // Method should override controller
      expect(merged?.category).toBe('method-override');
    });
  });

  describe('Real-World Scenario - Practical Example', () => {
    it('should work in real controller scenario: no audit by default, specific methods audited', () => {
      // Real-world scenario: Performance API controller with no audit by default
      // but specific sensitive endpoints need audit
      class PerformanceAPIController extends APIController {
        getControllerConfig() {
          return {
            // No audit config - most endpoints are high-frequency, no audit needed
          };
        }
        
        public testMakeAuditContext(ctx: ExecutionContext, route?: Route | null) {
          return this['makeAuditContext'](ctx, route);
        }
      }

      const controller = new PerformanceAPIController();
      const ctx = createMockExecutionContext('POST', '/auth/login');

      // Only the sensitive login endpoint has audit enabled
      const loginRoute: Route = {
        path: '/auth/login',
        httpMethod: 'POST',
        functionName: 'login',
        parameters: [],
        audit: {
          enabled: true,
          category: 'authentication',
          includes: {
            request: ['headers'], // No body for security
            response: ['headers']
          },
          dataProtection: {
            deepRedact: {
              blacklistedKeys: ['password', 'token', 'mfa'],
              replacement: '[AUTH-REDACTED]'
            }
          }
        }
      };

      const auditContext = controller.testMakeAuditContext(ctx, loginRoute);

      // Verify the sensitive endpoint gets audited even though controller has no audit
      expect(auditContext).toBeTruthy();
      expect(auditContext?.category).toBe('authentication');
      expect(auditContext?.auditConfig.enabled).toBe(true);
      expect(auditContext?.auditConfig.dataProtection?.deepRedact?.blacklistedKeys).toContain('password');
      expect(auditContext?.auditConfig.dataProtection?.deepRedact?.replacement).toBe('[AUTH-REDACTED]');

      // Test the opposite - regular performance endpoint with no audit
      const regularRoute: Route = {
        path: '/metrics/cpu',
        httpMethod: 'GET',
        functionName: 'getCpuMetrics',
        parameters: []
        // No audit config
      };

      const noAuditContext = controller.testMakeAuditContext(ctx, regularRoute);
      expect(noAuditContext).toBeNull(); // No audit for performance endpoints
    });
  });
});
