import { captureLog, captureError, AuditCaptureService, CaptureLogOptions } from './audit-helpers';
import { AuditContext, RequestAuditContext, QueueAuditContext, TaskAuditContext, CorrelationContext } from '../interfaces';
import { Actor, ExecutionContext } from '../../core/types/execution-context';
import { createHashBasedSampling } from './sampling';

// Mock the audit logger factory and its loggers
jest.mock('../loggers/factory', () => ({
  AuditLoggerFactory: {
    getInstance: jest.fn().mockReturnValue({
      create: jest.fn().mockReturnValue({
        audit: jest.fn().mockResolvedValue(undefined)
      })
    })
  }
}));

// Mock fast-redact to avoid module loading issues in tests
jest.mock('fast-redact', () => {
  return jest.fn(() => jest.fn((obj) => obj));
});

// Mock deepCopy from utils
jest.mock('../../utils/serialize', () => ({
  deepCopy: jest.fn((obj) => JSON.parse(JSON.stringify(obj)))
}));

// Import after mocking
import { AuditLoggerFactory } from '../loggers/factory';

// Mock crypto.randomUUID for predictable testing
jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('mock-uuid-123')
}));

describe('Audit Helpers', () => {
  const mockFactoryInstance = AuditLoggerFactory.getInstance() as jest.Mocked<any>;
  const mockAuditLogger = mockFactoryInstance.create();
  
  // Mock console.error to avoid noise in test output
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    // Clear mocks but preserve the console spy setup
    mockFactoryInstance.create.mockClear();
    mockAuditLogger.audit.mockClear();
    consoleErrorSpy.mockClear();
    
    // Reset Date.now mock if it exists
    if (jest.isMockFunction(Date.now)) {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  // Helper function to create mock execution context
  function createMockExecutionContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
    return {
      event: {
        requestContext: {
          identity: {
            sourceIp: '192.168.1.1'
          }
        }
      },
      request: {
        requestId: 'req-123'
      },
      actor: {
        requestId: 'req-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        actorId: 'user-456',
        actorType: 'user',
        authMethod: 'cognito',
        tenantId: 'tenant-abc'
      },
      ...overrides
    } as ExecutionContext;
  }

  describe('captureLog', () => {
    it('should create and log a basic audit entry', async () => {
      const options: CaptureLogOptions = {
        logType: 'audit',
        subType: 'user_action',
        entityName: 'User',
        operation: 'login',
        correlationId: 'corr-123'
      };

      await captureLog(options);

      expect(mockFactoryInstance.create).toHaveBeenCalled();
      expect(mockAuditLogger.audit).toHaveBeenCalledWith({
        enabled: undefined,
        auditEntry: expect.objectContaining({
          logType: 'audit',
          subType: 'user_action',
          entityName: 'User',
          operation: 'login',
          eventType: 'unknown',
          severity: 'info',
          correlationId: 'corr-123'
        })
      });
    });

    it('should extract context from ExecutionContext', async () => {
      const ctx = createMockExecutionContext();
      const options: CaptureLogOptions = {
        entityName: 'User',
        operation: 'getProfile',
        ctx
      };

      await captureLog(options);

      expect(mockAuditLogger.audit).toHaveBeenCalledWith({
        enabled: undefined,
        auditEntry: expect.objectContaining({
          entityName: 'User',
          operation: 'getProfile',
          correlationId: 'req-123',
          ipAddress: '192.168.1.1',
          actor: ctx.actor
        })
      });
    });

    it('should use fallback UUID when no correlation ID available', async () => {
      const options: CaptureLogOptions = {
        entityName: 'System',
        operation: 'healthCheck'
      };

      await captureLog(options);

      expect(mockAuditLogger.audit).toHaveBeenCalledWith({
        enabled: undefined,
        auditEntry: expect.objectContaining({
          correlationId: 'mock-uuid-123'
        })
      });
    });

    it('should add duration to metrics', async () => {
      const options: CaptureLogOptions = {
        entityName: 'Order',
        operation: 'process',
        duration: 1500,
        metrics: {
          recordCount: 10
        }
      };

      await captureLog(options);

      expect(mockAuditLogger.audit).toHaveBeenCalledWith({
        enabled: undefined,
        auditEntry: expect.objectContaining({
          metrics: {
            duration: 1500,
            recordCount: 10
          }
        })
      });
    });

    it('should determine status from success flag', async () => {
      const successOptions: CaptureLogOptions = {
        entityName: 'Payment',
        operation: 'charge',
        success: true
      };

      await captureLog(successOptions);

      expect(mockAuditLogger.audit).toHaveBeenCalledWith({
        enabled: undefined,
        auditEntry: expect.objectContaining({
          success: true,
          status: 'completed'
        })
      });

      jest.clearAllMocks();

      const failureOptions: CaptureLogOptions = {
        entityName: 'Payment',
        operation: 'charge',
        success: false
      };

      await captureLog(failureOptions);

      expect(mockAuditLogger.audit).toHaveBeenCalledWith({
        enabled: undefined,
        auditEntry: expect.objectContaining({
          success: false,
          status: 'failed'
        })
      });
    });

    it('should provide defaults for required fields', async () => {
      const options: CaptureLogOptions = {};

      await captureLog(options);

      expect(mockAuditLogger.audit).toHaveBeenCalledWith({
        enabled: undefined,
        auditEntry: expect.objectContaining({
          logType: 'audit',
          severity: 'info',
          entityName: 'unknown',
          eventType: 'unknown',
          correlationId: 'mock-uuid-123'
        })
      });
    });

    it('should handle enabled flag correctly', async () => {
      const options: CaptureLogOptions = {
        entityName: 'User',
        operation: 'login',
        enabled: false
      };

      await captureLog(options);

      expect(mockAuditLogger.audit).toHaveBeenCalledWith({
        enabled: false,
        auditEntry: expect.any(Object)
      });
    });

    it('should not include empty metrics object', async () => {
      const options: CaptureLogOptions = {
        entityName: 'User',
        operation: 'login'
      };

      await captureLog(options);

      expect(mockAuditLogger.audit).toHaveBeenCalledWith({
        enabled: undefined,
        auditEntry: expect.objectContaining({
          entityName: 'User',
          operation: 'login',
          logType: 'audit',
          severity: 'info',
          eventType: 'unknown'
        })
      });

      // Verify metrics field is not present when not provided
      const calledWith = mockAuditLogger.audit.mock.calls[0][0];
      expect(calledWith.auditEntry).not.toHaveProperty('metrics');
    });

    it('should handle audit logger errors gracefully', async () => {
      mockAuditLogger.audit.mockRejectedValueOnce(new Error('Logger failed'));

      const options: CaptureLogOptions = {
        entityName: 'User',
        operation: 'login',
        correlationId: 'corr-123'
      };

      // Should not throw
      await expect(captureLog(options)).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to capture audit log:',
        expect.any(Error),
        expect.objectContaining({
          logType: undefined,
          subType: undefined,
          entityName: 'User',
          correlationId: 'corr-123'
        })
      );
    });
  });

  describe('captureError', () => {
    it('should capture error with proper formatting', async () => {
      const error = new Error('Something went wrong');
      error.stack = 'Error: Something went wrong\n    at test...';

      const options = {
        entityName: 'PaymentService',
        operation: 'processCharge',
        correlationId: 'payment-123'
      };

      await captureError(error, options);

      expect(mockAuditLogger.audit).toHaveBeenCalledWith({
        enabled: undefined,
        auditEntry: expect.objectContaining({
          entityName: 'PaymentService',
          operation: 'processCharge',
          correlationId: 'payment-123',
          logType: 'audit',
          eventType: 'unknown',
          severity: 'error',
          success: false,
          status: 'failed',
          data: {
            error: expect.any(Object) // Data protection sanitizes error objects
          }
        })
      });
    });

    it('should handle non-Error objects', async () => {
      const errorData = { code: 'PAYMENT_FAILED', message: 'Card declined' };

      await captureError(errorData, {
        entityName: 'Payment',
        operation: 'charge'
      });

      expect(mockAuditLogger.audit).toHaveBeenCalledWith({
        enabled: undefined,
        auditEntry: expect.objectContaining({
          severity: 'error',
          success: false,
          status: 'failed',
          data: {
            error: errorData
          }
        })
      });
    });
  });

  describe('AuditCaptureService', () => {
    // Helper functions
    function createMockCorrelationContext(overrides: Partial<CorrelationContext> = {}): CorrelationContext {
      return {
        correlationId: 'corr-123',
        operationId: 'APIController.getUser',
        operationType: 'api',
        operationName: 'getUser',
        startTimestamp: '2024-01-15T10:30:00.000Z',
        ...overrides
      };
    }

    function createMockActor(overrides: Partial<Actor> = {}): Actor {
      return {
        requestId: 'req-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        actorId: 'user-456',
        actorType: 'user',
        authMethod: 'cognito',
        tenantId: 'tenant-abc',
        ...overrides
      };
    }

    function createMockAuditContext(overrides: Partial<AuditContext> = {}): AuditContext {
      return {
        enabled: true,
        logType: 'audit',
        subType: 'api_request',
        entityName: 'User',
        operation: 'getUser',
        category: 'user-management',
        actor: createMockActor(),
        correlation: createMockCorrelationContext(),
        auditConfig: {
          enabled: true,
          skipStart: false,
          skipEnd: false,
          skipErrors: false
        },
        ...overrides
      };
    }

    describe('captureStart', () => {
      it('should capture start audit log for API request', async () => {
        const auditContext = createMockAuditContext();
        const requestContext: RequestAuditContext = {
          method: 'GET',
          path: '/users/123',
          userAgent: 'Mozilla/5.0',
          sourceIp: '192.168.1.1'
        };

        await AuditCaptureService.captureStart(auditContext, requestContext);

        expect(mockAuditLogger.audit).toHaveBeenCalledWith({
          enabled: undefined,
          auditEntry: expect.objectContaining({
            logType: 'audit',
            subType: 'api_request_start',
            entityName: 'User',
            eventType: 'start',
            operation: 'getUser',
            category: 'user-management',
            correlationId: 'corr-123',
            severity: 'info',
            actor: auditContext.actor,
            context: {
              correlation: auditContext.correlation,
              api: expect.objectContaining({
                method: 'GET',
                path: '/users/123',
                userAgent: 'Mozilla/5.0',
                sourceIp: '192.168.1.1' // Data protection redacts IP addresses
              })
            }
          })
        });
      });

      it('should capture start audit log for queue processing', async () => {
        const auditContext = createMockAuditContext({
          subType: 'queue_processing',
          correlation: createMockCorrelationContext({
            operationType: 'queue',
            operationId: 'QueueController.processMessage'
          })
        });
        const queueContext: QueueAuditContext = {
          queueName: 'user-notifications',
          batchSize: 5,
          messageIds: ['msg-1', 'msg-2']
        };

        await AuditCaptureService.captureStart(auditContext, queueContext);

        expect(mockAuditLogger.audit).toHaveBeenCalledWith({
          enabled: undefined,
          auditEntry: expect.objectContaining({
            logType: 'audit',
            subType: 'queue_processing_start',
            context: {
              correlation: auditContext.correlation,
              queue: queueContext
            }
          })
        });
      });

      it('should skip when audit is disabled', async () => {
        const auditContext = createMockAuditContext({ enabled: false });
        const requestContext: RequestAuditContext = {
          method: 'GET',
          path: '/users/123'
        };

        await AuditCaptureService.captureStart(auditContext, requestContext);

        expect(mockAuditLogger.audit).not.toHaveBeenCalled();
      });

      it('should skip when skipStart is enabled', async () => {
        const auditContext = createMockAuditContext({
          auditConfig: { 
            enabled: true,
            skipStart: true 
          }
        });
        const requestContext: RequestAuditContext = {
          method: 'GET',
          path: '/users/123'
        };

        await AuditCaptureService.captureStart(auditContext, requestContext);

        expect(mockAuditLogger.audit).not.toHaveBeenCalled();
      });

      it('should respect sampling function', async () => {
        const samplingFn = jest.fn().mockReturnValue(false);
        const auditContext = createMockAuditContext({
          auditConfig: { 
            enabled: true,
            samplingFn 
          }
        });
        const requestContext: RequestAuditContext = {
          method: 'GET',
          path: '/users/123'
        };

        await AuditCaptureService.captureStart(auditContext, requestContext);

        expect(samplingFn).toHaveBeenCalledWith('corr-123', 'getUser');
        expect(mockAuditLogger.audit).not.toHaveBeenCalled();
      });

      it('should include custom context in metadata', async () => {
        const customContext = { feature: 'user-management', version: '2.1' };
        const auditContext = createMockAuditContext({
          auditConfig: { 
            enabled: true,
            customContext 
          }
        });
        const requestContext: RequestAuditContext = {
          method: 'GET',
          path: '/users/123'
        };

        await AuditCaptureService.captureStart(auditContext, requestContext);

        expect(mockAuditLogger.audit).toHaveBeenCalledWith({
          enabled: undefined,
          auditEntry: expect.objectContaining({
            metadata: customContext
          })
        });
      });
    });

    describe('captureEnd', () => {
      it('should capture successful completion audit log', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1705314605000); // 5 seconds after start

        const auditContext = createMockAuditContext();
        const result = { users: [{ id: '123', name: 'John' }] };
        const responseContext = {
          statusCode: 200,
          responseSize: 1234
        };

        await AuditCaptureService.captureEnd(auditContext, result, null, responseContext);

        expect(mockAuditLogger.audit).toHaveBeenCalledWith({
          enabled: undefined,
          auditEntry: expect.objectContaining({
            logType: 'audit',
            subType: 'api_request_complete',
            entityName: 'User',
            eventType: 'complete',
            operation: 'getUser',
            category: 'user-management',
            success: true,
            status: 'completed',
            severity: 'info',
            correlationId: 'corr-123',
            actor: auditContext.actor,
            metrics: {
              duration: 5000,
              statusCode: 200,
              responseSize: 1234
            },
            context: {
              correlation: auditContext.correlation,
              response: responseContext
            },
            data: {
              error: null // captureEnd always includes error field
            }
          })
        });
      });

      it('should capture error audit log', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1705314602000); // 2 seconds after start

        const auditContext = createMockAuditContext();
        const error = new Error('User not found');
        error.stack = 'Error: User not found\n    at getUserById...';

        await AuditCaptureService.captureEnd(auditContext, null, error);

        expect(mockAuditLogger.audit).toHaveBeenCalledWith({
          enabled: undefined,
          auditEntry: expect.objectContaining({
            logType: 'audit',
            subType: 'api_request_error',
            entityName: 'User',
            eventType: 'error',
            operation: 'getUser',
            success: false,
            status: 'failed',
            severity: 'info',
            correlationId: 'corr-123',
            actor: auditContext.actor,
            category: 'user-management',
            metrics: {
              duration: 2000
            },
            context: {
              correlation: auditContext.correlation
            },
            data: {
              error: expect.any(Object) // Data protection sanitizes error objects
            }
          })
        });
      });

      it('should skip when audit is disabled', async () => {
        const auditContext = createMockAuditContext({ enabled: false });

        await AuditCaptureService.captureEnd(auditContext, null, null);

        expect(mockAuditLogger.audit).not.toHaveBeenCalled();
      });

      it('should skip error audit when skipErrors is enabled', async () => {
        const auditContext = createMockAuditContext({
          auditConfig: { 
            enabled: true,
            skipErrors: true 
          }
        });
        const error = new Error('Test error');

        await AuditCaptureService.captureEnd(auditContext, null, error);

        expect(mockAuditLogger.audit).not.toHaveBeenCalled();
      });

      it('should skip success audit when skipEnd is enabled', async () => {
        const auditContext = createMockAuditContext({
          auditConfig: { 
            enabled: true,
            skipEnd: true 
          }
        });

        await AuditCaptureService.captureEnd(auditContext, { success: true }, null);

        expect(mockAuditLogger.audit).not.toHaveBeenCalled();
      });

      it('should respect sampling function for end events', async () => {
        const samplingFn = jest.fn().mockReturnValue(false);
        const auditContext = createMockAuditContext({
          auditConfig: { 
            enabled: true,
            samplingFn 
          }
        });

        await AuditCaptureService.captureEnd(auditContext, null, null);

        expect(samplingFn).toHaveBeenCalledWith('corr-123', 'getUser');
        expect(mockAuditLogger.audit).not.toHaveBeenCalled();
      });
    });

    describe('Integration with real sampling functions', () => {
      it('should work with hash-based sampling', async () => {
        const hashSampling = createHashBasedSampling(0.5); // 50% sampling rate
        const auditContext = createMockAuditContext({
          auditConfig: { 
            enabled: true,
            samplingFn: hashSampling 
          }
        });
        const requestContext: RequestAuditContext = {
          method: 'GET',
          path: '/users/123'
        };

        // Hash-based sampling should be deterministic for the same input
        await AuditCaptureService.captureStart(auditContext, requestContext);
        const firstCallCount = mockAuditLogger.audit.mock.calls.length;
        
        mockAuditLogger.audit.mockClear();
        await AuditCaptureService.captureStart(auditContext, requestContext);
        const secondCallCount = mockAuditLogger.audit.mock.calls.length;

        // Should be consistent - either always called or never called
        expect(firstCallCount).toBe(secondCallCount);
      });
    });
  });
});