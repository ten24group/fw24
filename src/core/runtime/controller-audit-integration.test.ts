import { APIController } from './api-gateway-controller';
import { QueueController } from './sqs-controller';
import { TaskController } from './task-controller';
import { ExecutionContext, Actor } from '../types/execution-context';
import { SQSEvent, Context } from 'aws-lambda';
import { createHashBasedSampling } from '../../audit/helpers/sampling';
import { AuditLoggerFactory } from '../../audit/loggers/factory';

// Mock the audit logger factory to capture actual audit logs
jest.mock('../../audit/loggers/factory', () => ({
  AuditLoggerFactory: {
    getInstance: jest.fn().mockReturnValue({
      create: jest.fn().mockReturnValue({
        audit: jest.fn().mockResolvedValue(undefined)
      })
    })
  }
}));

// Mock Reflect for decorator metadata
const mockReflectGet = jest.fn();
global.Reflect = {
  ...global.Reflect,
  get: mockReflectGet
};

// Mock Date.now for predictable timestamps
const mockDateNow = jest.spyOn(Date, 'now').mockImplementation(() => 1705314600000);

describe('Controller Audit Integration', () => {
  const mockFactoryInstance = AuditLoggerFactory.getInstance() as jest.Mocked<any>;
  const mockAuditLogger = mockFactoryInstance.create();

  // Mock console.error to avoid noise in test output
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    // Clear mocks but preserve spy setup
    mockFactoryInstance.create.mockClear();
    mockAuditLogger.audit.mockClear();
    consoleErrorSpy.mockClear();
    mockDateNow.mockReturnValue(1705314600000);
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  // Helper to create mock SQS event
  function createMockSQSEvent(): SQSEvent {
    return {
      Records: [
        {
          messageId: 'msg-1',
          receiptHandle: 'receipt-1',
          body: JSON.stringify({
            correlationId: 'parent-corr-123',
            parentOperationId: 'APIController.createUser'
          }),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1705314600000',
            SenderId: 'sender-1',
            ApproximateFirstReceiveTimestamp: '1705314600000'
          },
          messageAttributes: {},
          md5OfBody: 'md5-1',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
          awsRegion: 'us-east-1'
        }
      ]
    };
  }

  // Helper to create mock Lambda context
  function createMockLambdaContext(): Context {
    return {
      callbackWaitsForEmptyEventLoop: true,
      functionName: 'test-queue-processor',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-queue-processor',
      memoryLimitInMB: '128',
      awsRequestId: 'lambda-req-456',
      logGroupName: '/aws/lambda/test-queue-processor',
      logStreamName: '2024/01/15/[$LATEST]abc123',
      getRemainingTimeInMillis: () => 30000,
      done: () => {},
      fail: () => {},
      succeed: () => {}
    };
  }

  // Helper to create mock execution context
  function createMockExecutionContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
    const mockActor: Actor = {
      requestId: 'req-123',
      timestamp: '2024-01-15T10:30:00.000Z',
      actorId: 'user-456',
      actorType: 'user',
      authMethod: 'cognito',
      tenantId: 'tenant-abc'
    };

    return {
      event: {
        httpMethod: 'GET',
        path: '/users/123',
        headers: {
          'user-agent': 'Mozilla/5.0',
          'X-Forwarded-For': '192.168.1.1'
        },
        requestContext: {
          identity: {
            sourceIp: '192.168.1.1'
          }
        }
      } as any,
      lambdaContext: {
        awsRequestId: 'aws-req-123',
        functionName: 'user-api'
      } as any,
      request: {
        requestId: 'req-123',
        httpMethod: 'GET',
        path: '/users/123',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'X-Forwarded-For': '192.168.1.1'
        }
      } as any,
      response: {} as any,
      actor: mockActor,
      ...overrides
    };
  }

  describe('APIController Audit Integration', () => {
    class TestAPIController extends APIController {
      constructor() {
        super();
      }

      // Expose protected methods for testing
      public testMakeAuditContext(ctx: ExecutionContext) {
        return this.makeAuditContext(ctx);
      }

      public async testCaptureStart(auditContext: any, requestContext: any) {
        return this.captureStart(auditContext, requestContext);
      }

      public async testCaptureEnd(auditContext: any, response: any, error: any) {
        return this.captureEnd(auditContext, response, error);
      }

      public testBuildRequestContext(ctx: ExecutionContext, auditConfig: any) {
        return (this as any).buildRequestContext(ctx, auditConfig);
      }
    }

    let controller: TestAPIController;

    beforeEach(() => {
      controller = new TestAPIController();
    });

    describe('makeAuditContext', () => {
      it('should create audit context with proper correlation ID and operation ID', () => {
        const ctx = createMockExecutionContext();
        mockReflectGet.mockReturnValue({ audit: { enabled: true, category: 'user-management' } });

        const auditContext = controller.testMakeAuditContext(ctx);

        expect(auditContext).toMatchObject({
          enabled: true,
          logType: 'log',
          subType: 'api_request',
          entityName: 'TestAPIController',
          operation: 'get_/users/123',
          category: 'user-management',
          actor: ctx.actor,
          correlation: {
            correlationId: 'req-123',
            operationId: 'TestAPIController.get_/users/123',
            operationType: 'api',
            operationName: 'get_/users/123',
            startTimestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
          }
        });
      });

      it('should return null when audit is disabled', () => {
        const ctx = createMockExecutionContext();
        mockReflectGet.mockReturnValue({ audit: { enabled: false } });

        const auditContext = controller.testMakeAuditContext(ctx);

        expect(auditContext).toBeNull();
      });

      it('should use default config when no audit config is present', () => {
        const ctx = createMockExecutionContext();
        mockReflectGet.mockReturnValue({ audit: { enabled: true } });

        const auditContext = controller.testMakeAuditContext(ctx);

        expect(auditContext).toMatchObject({
          enabled: true,
          logType: 'log',
          subType: 'api_request',
          entityName: 'TestAPIController',
          auditConfig: {
            enabled: true
          }
        });
      });

      it('should include custom sampling function', () => {
        const ctx = createMockExecutionContext();
        const samplingFn = createHashBasedSampling(0.1);
        mockReflectGet.mockReturnValue({ 
          audit: { 
            enabled: true, 
            samplingFn,
            customContext: { feature: 'user-api', version: '1.2' }
          } 
        });

        const auditContext = controller.testMakeAuditContext(ctx);

        expect(auditContext?.auditConfig.samplingFn).toBe(samplingFn);
        expect(auditContext?.auditConfig.customContext).toEqual({ feature: 'user-api', version: '1.2' });
      });
    });

    describe('buildRequestContext', () => {
      it('should build minimal request context by default', () => {
        const ctx = createMockExecutionContext();
        const auditConfig = { enabled: true };

        const requestContext = controller.testBuildRequestContext(ctx, auditConfig);

        expect(requestContext).toEqual({
          method: 'GET',
          path: '/users/123',
          userAgent: 'Mozilla/5.0',
          sourceIp: '192.168.1.1',
          headers: undefined,
          body: undefined,
          query: undefined
        });
      });

      it('should include headers when configured', () => {
        const ctx = createMockExecutionContext();
        const auditConfig = {
          enabled: true,
          includes: { request: ['headers'] }
        };

        const requestContext = controller.testBuildRequestContext(ctx, auditConfig);

        expect(requestContext).toEqual({
          method: 'GET',
          path: '/users/123',
          userAgent: 'Mozilla/5.0',
          sourceIp: '192.168.1.1',
          headers: ctx.request.headers,
          body: undefined,
          query: undefined
        });
      });

      it('should include multiple request parts when configured', () => {
        const baseCtx = createMockExecutionContext();
        const ctx = createMockExecutionContext({
          request: {
            ...baseCtx.request,
            body: { userId: '123' },
            queryStringParameters: { include: 'profile' }
          } as any
        });
        const auditConfig = {
          enabled: true,
          includes: { request: ['headers', 'body', 'query'] }
        };

        const requestContext = controller.testBuildRequestContext(ctx, auditConfig);

        expect(requestContext).toEqual({
          method: 'GET',
          path: '/users/123',
          userAgent: 'Mozilla/5.0',
          sourceIp: '192.168.1.1',
          headers: ctx.request.headers,
          body: { userId: '123' },
          query: { include: 'profile' }
        });
      });
    });

    describe('End-to-End Audit Integration', () => {
      it('should capture start audit log with real audit logger', async () => {
        const ctx = createMockExecutionContext();
        const auditContext = {
          enabled: true,
          logType: 'audit' as const,
          subType: 'api_request',
          entityName: 'TestAPIController',
          operation: 'getUser',
          category: 'user-management',
          actor: ctx.actor,
          correlation: {
            correlationId: 'corr-123',
            operationId: 'TestAPIController.getUser',
            operationType: 'api' as const,
            operationName: 'getUser',
            startTimestamp: '2024-01-15T10:30:00.000Z'
          },
          auditConfig: { enabled: true }
        };
        const requestContext = {
          method: 'GET',
          path: '/users/123',
          userAgent: 'Mozilla/5.0',
          sourceIp: '192.168.1.1'
        };

        await controller.testCaptureStart(auditContext, requestContext);

        // Verify the factory was called to create a logger
        expect(mockFactoryInstance.create).toHaveBeenCalled();
        
        // Verify the real audit entry structure
        expect(mockAuditLogger.audit).toHaveBeenCalledWith({
          enabled: undefined,
          auditEntry: expect.objectContaining({
            logType: 'audit',
            subType: 'api_request_start',
            entityName: 'TestAPIController',
            eventType: 'start',
            operation: 'getUser',
            category: 'user-management',
            correlationId: 'corr-123',
            actor: ctx.actor,
            context: {
              correlation: auditContext.correlation,
              api: requestContext
            }
          })
        });
      });

      it('should capture end audit log with response context', async () => {
        const auditContext = {
          enabled: true,
          logType: 'audit' as const,
          subType: 'api_request',
          entityName: 'TestAPIController',
          operation: 'getUser',
          category: 'user-management',
          correlation: {
            correlationId: 'corr-123',
            operationId: 'TestAPIController.getUser',
            operationType: 'api' as const,
            operationName: 'getUser',
            startTimestamp: '2024-01-15T10:30:00.000Z'
          },
          auditConfig: { enabled: true }
        };
        const response = {
          statusCode: 200,
          body: JSON.stringify({ users: [{ id: '123' }] })
        };

        await controller.testCaptureEnd(auditContext, response, null);

        expect(mockAuditLogger.audit).toHaveBeenCalledWith({
          enabled: undefined,
          auditEntry: expect.objectContaining({
            logType: 'audit',
            subType: 'api_request_complete',
            entityName: 'TestAPIController',
            eventType: 'complete',
            operation: 'getUser',
            success: true,
            status: 'completed',
            correlationId: 'corr-123',
            metrics: expect.objectContaining({
              duration: expect.any(Number),
              statusCode: 200,
              responseSize: expect.any(Number)
            })
          })
        });
      });

      it('should capture error audit log when request fails', async () => {
        const auditContext = {
          enabled: true,
          logType: 'audit' as const,
          subType: 'api_request',
          entityName: 'TestAPIController',
          operation: 'getUser',
          correlation: {
            correlationId: 'corr-123',
            operationId: 'TestAPIController.getUser',
            operationType: 'api' as const,
            operationName: 'getUser',
            startTimestamp: '2024-01-15T10:30:00.000Z'
          },
          auditConfig: { enabled: true }
        };
        const error = new Error('User not found');
        error.stack = 'Error: User not found\n    at getUserById...';

        const mockResponse = { statusCode: 500, body: '' };
        await controller.testCaptureEnd(auditContext, mockResponse, error);

        expect(mockAuditLogger.audit).toHaveBeenCalledWith({
          enabled: undefined,
          auditEntry: expect.objectContaining({
            logType: 'audit',
            subType: 'api_request_error',
            entityName: 'TestAPIController',
            eventType: 'error',
            operation: 'getUser',
            success: false,
            status: 'failed',
            correlationId: 'corr-123',
            data: {
              error: {
                message: 'User not found',
                stack: 'Error: User not found\n    at getUserById...',
                name: 'Error'
              }
            }
          })
        });
      });

      it('should handle audit logger failures gracefully', async () => {
        mockAuditLogger.audit.mockRejectedValueOnce(new Error('Audit logger failed'));
        
        const auditContext = {
          enabled: true,
          logType: 'audit' as const,
          subType: 'api_request',
          entityName: 'TestAPIController',
          operation: 'getUser',
          correlation: {
            correlationId: 'corr-123',
            operationId: 'TestAPIController.getUser',
            operationType: 'api' as const,
            operationName: 'getUser',
            startTimestamp: '2024-01-15T10:30:00.000Z'
          },
          auditConfig: { enabled: true }
        };
        const requestContext = {
          method: 'GET',
          path: '/users/123',
          userAgent: 'Mozilla/5.0',
          sourceIp: '192.168.1.1'
        };

        // Should not throw
        await expect(controller.testCaptureStart(auditContext, requestContext)).resolves.toBeUndefined();
        
        // Should still attempt to audit
        expect(mockAuditLogger.audit).toHaveBeenCalled();
        
        // Should log the error to console
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to capture audit log:',
          expect.any(Error),
          expect.any(Object)
        );
      });
    });
  });

  describe('QueueController Audit Integration', () => {
    class TestQueueController extends QueueController {
      constructor() {
        super();
      }

      // Expose protected methods for testing
      public testMakeAuditContext(event: SQSEvent, context: Context) {
        return this.makeAuditContext(event, context);
      }

      public testExtractCorrelationFromMessages(event: SQSEvent) {
        return this.extractCorrelationFromMessages(event);
      }

      public testExtractParentOperationFromMessages(event: SQSEvent) {
        return this.extractParentOperationFromMessages(event);
      }

      async initialize() {
        // Test implementation
      }

      async process() {
        // Test implementation
      }

      async processRecord() {
        return { processed: true };
      }

      // Override for testing
      protected getQueueName(): string | undefined {
        const config = this.getQueueConfig();
        return (config as any).queueName;
      }
    }

    let controller: TestQueueController;

    beforeEach(() => {
      controller = new TestQueueController();
    });

    describe('makeAuditContext', () => {
      it('should create audit context for queue processing', () => {
        const event = createMockSQSEvent();
        const context = createMockLambdaContext();
        mockReflectGet.mockReturnValue({ audit: { enabled: true, category: 'queue-processing' }, queueName: 'user-notifications' });

        const auditContext = controller.testMakeAuditContext(event, context);

        expect(auditContext).toMatchObject({
          enabled: true,
          logType: 'event',
          subType: 'queue_processing',
          entityName: 'TestQueueController',
          operation: 'user-notifications',
          category: 'queue-processing',
          correlation: {
            correlationId: 'parent-corr-123',
            operationId: 'TestQueueController.user-notifications',
            parentOperationId: 'APIController.createUser',
            operationType: 'queue',
            operationName: 'user-notifications'
          }
        });
      });

      it('should generate new correlation ID when not found in messages', () => {
        const event = {
          Records: [{
            ...createMockSQSEvent().Records[0],
            body: JSON.stringify({ data: 'no correlation' })
          }]
        };
        const context = createMockLambdaContext();
        mockReflectGet.mockReturnValue({ audit: { enabled: true } });

        const auditContext = controller.testMakeAuditContext(event, context);

        expect(auditContext?.correlation.correlationId).toBe('lambda-req-456');
        expect(auditContext?.correlation.parentOperationId).toBeUndefined();
      });

      it('should return null when audit is disabled', () => {
        const event = createMockSQSEvent();
        const context = createMockLambdaContext();
        mockReflectGet.mockReturnValue({ audit: { enabled: false } });

        const auditContext = controller.testMakeAuditContext(event, context);

        expect(auditContext).toBeNull();
      });
    });

    describe('correlation extraction', () => {
      it('should extract correlation ID from message bodies', () => {
        const event = createMockSQSEvent();

        const correlationId = controller.testExtractCorrelationFromMessages(event);

        expect(correlationId).toBe('parent-corr-123');
      });

      it('should extract parent operation ID from message bodies', () => {
        const event = createMockSQSEvent();

        const parentOperationId = controller.testExtractParentOperationFromMessages(event);

        expect(parentOperationId).toBe('APIController.createUser');
      });

      it('should return null for invalid JSON in message body', () => {
        const event = {
          Records: [{
            ...createMockSQSEvent().Records[0],
            body: 'invalid json{'
          }]
        };

        const correlationId = controller.testExtractCorrelationFromMessages(event);
        const parentOperationId = controller.testExtractParentOperationFromMessages(event);

        expect(correlationId).toBeNull();
        expect(parentOperationId).toBeNull();
      });
    });
  });

  describe('TaskController Audit Integration', () => {
    class TestTaskController extends TaskController {
      constructor() {
        super();
      }

      // Expose protected methods for testing
      public testMakeAuditContext() {
        return this.makeAuditContext();
      }

      async initialize() {
        // Test implementation
      }

      async process() {
        // Test implementation
      }

      async execute() {
        return { taskCompleted: true };
      }

      // Override for testing
      protected getTaskName(): string | undefined {
        const config = this.getTaskConfig();
        return (config as any).taskName;
      }
    }

    let controller: TestTaskController;

    beforeEach(() => {
      controller = new TestTaskController();
    });

    describe('makeAuditContext', () => {
      it('should create audit context for scheduled task', () => {
        mockReflectGet.mockReturnValue({ 
          audit: { enabled: true, category: 'data-processing' },
          taskName: 'daily-report',
          schedule: 'cron(0 9 * * ? *)'
        });

        const auditContext = controller.testMakeAuditContext();

        expect(auditContext).toMatchObject({
          enabled: true,
          logType: 'event',
          subType: 'task_execution',
          entityName: 'TestTaskController',
          operation: 'daily-report',
          category: 'data-processing',
          actor: {
            actorId: 'scheduler',
            actorType: 'service',
            authMethod: 'system'
          },
          correlation: {
            correlationId: expect.stringMatching(/^TestTaskController\.daily-report-\d+$/),
            operationId: 'TestTaskController.daily-report',
            operationType: 'task',
            operationName: 'daily-report'
          }
        });
      });

      it('should return null when audit is disabled', () => {
        mockReflectGet.mockReturnValue({ audit: { enabled: false } });

        const auditContext = controller.testMakeAuditContext();

        expect(auditContext).toBeNull();
      });

      it('should handle missing task configuration gracefully', () => {
        mockReflectGet.mockReturnValue({ audit: { enabled: true } });

        const auditContext = controller.testMakeAuditContext();

        expect(auditContext).toMatchObject({
          enabled: true,
          logType: 'event',
          subType: 'task_execution',
          entityName: 'TestTaskController',
          operation: 'execute' // Default operation name
        });
      });
    });
  });

  describe('Cross-Controller Integration Scenarios', () => {
    it('should maintain correlation across API -> Queue workflow', async () => {
      // Simulate API request creating a queue message
      const apiController = new (class extends APIController {
        public testMakeAuditContext(ctx: ExecutionContext) {
          return this.makeAuditContext(ctx);
        }
      })();

      const queueController = new (class extends QueueController {
        public testMakeAuditContext(event: SQSEvent, context: Context) {
          return this.makeAuditContext(event, context);
        }
        async initialize() {}
        async process() {}
        async processRecord() { return {}; }
      })();

      // API request
      const ctx = createMockExecutionContext();
      mockReflectGet.mockReturnValue({ audit: { enabled: true } });
      
      const apiAuditContext = apiController.testMakeAuditContext(ctx);
      expect(apiAuditContext?.correlation.operationType).toBe('api');
      expect(apiAuditContext?.correlation.correlationId).toBe('req-123');

      // Queue processing with correlation from API
      const queueEvent = {
        Records: [{
          ...createMockSQSEvent().Records[0],
          body: JSON.stringify({
            correlationId: apiAuditContext?.correlation.correlationId,
            parentOperationId: apiAuditContext?.correlation.operationId
          })
        }]
      };
      
      const queueAuditContext = queueController.testMakeAuditContext(queueEvent, createMockLambdaContext());
      
      expect(queueAuditContext?.correlation.correlationId).toBe(apiAuditContext?.correlation.correlationId);
      expect(queueAuditContext?.correlation.parentOperationId).toBe(apiAuditContext?.correlation.operationId);
      expect(queueAuditContext?.correlation.operationType).toBe('queue');
    });

    it('should handle different audit configurations across controllers', () => {
      const apiController = new (class extends APIController {
        public testMakeAuditContext(ctx: ExecutionContext) {
          return this.makeAuditContext(ctx);
        }
      })();

      const taskController = new (class extends TaskController {
        public testMakeAuditContext() {
          return this.makeAuditContext();
        }
        async initialize() {}
        async process() {}
        async execute() { return {}; }
      })();

      // API with detailed audit config
      mockReflectGet.mockReturnValueOnce({ 
        audit: { 
          enabled: true, 
          skipStart: false,
          skipEnd: true,
          samplingFn: createHashBasedSampling(0.1),
          includes: { request: ['headers', 'body'], response: true }
        } 
      });
      
      const apiAuditContext = apiController.testMakeAuditContext(createMockExecutionContext());

      // Task with minimal audit config
      mockReflectGet.mockReturnValueOnce({ 
        audit: { 
          enabled: true,
          skipStart: true,
          skipEnd: false,
          category: 'background-jobs'
        } 
      });
      
      const taskAuditContext = taskController.testMakeAuditContext();

      expect(apiAuditContext?.auditConfig.skipEnd).toBe(true);
      expect(apiAuditContext?.auditConfig.includes).toBeDefined();
      expect(taskAuditContext?.auditConfig.skipStart).toBe(true);
      expect(taskAuditContext?.category).toBe('background-jobs');
    });

    it('should respect sampling configuration in real audit integration', async () => {
      const samplingFn = createHashBasedSampling(0.0); // 0% sampling - should skip all
      
      const apiController = new (class extends APIController {
        public testMakeAuditContext(ctx: ExecutionContext) {
          return this.makeAuditContext(ctx);
        }
        public async testCaptureStart(auditContext: any, requestContext: any) {
          return this.captureStart(auditContext, requestContext);
        }
      })();

      const ctx = createMockExecutionContext();
      mockReflectGet.mockReturnValue({ 
        audit: { 
          enabled: true,
          samplingFn
        } 
      });
      
      const auditContext = apiController.testMakeAuditContext(ctx);
      const requestContext = {
        method: 'GET',
        path: '/users/123',
        userAgent: 'Mozilla/5.0',
        sourceIp: '192.168.1.1'
      };

      await apiController.testCaptureStart(auditContext, requestContext);

      // Should not have called the audit logger due to 0% sampling
      expect(mockAuditLogger.audit).not.toHaveBeenCalled();
    });
  });
});