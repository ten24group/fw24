import { AuditCaptureService } from './audit-helpers';
import { AuditContext, RequestAuditContext } from '../interfaces';
import { Actor } from '../../core/types/execution-context';
import { AuditLoggerFactory } from '../loggers/factory';

// Mock the audit logger
jest.mock('../loggers/factory');

describe('Audit Strategies', () => {
  const mockCaptureLog = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock the factory instance and create method
    const mockFactory = {
      create: jest.fn().mockReturnValue({
        audit: mockCaptureLog
      })
    };
    (AuditLoggerFactory.getInstance as jest.Mock).mockReturnValue(mockFactory);
  });

  const createMockAuditContext = (strategy: 'separate' | 'single' = 'separate'): AuditContext => ({
    enabled: true,
    logType: 'log',
    subType: 'api_request',
    entityName: 'user',
    operation: 'create',
    category: 'user-management',
    actor: {
      actorType: 'user',
      actorId: 'user123',
      authMethod: 'cognito',
      requestId: 'req-123',
      timestamp: '2024-01-01T00:00:00.000Z'
    } as Actor,
    correlation: {
      correlationId: 'corr-123',
      operationId: 'op-123',
      operationType: 'api',
      operationName: 'create_user',
      startTimestamp: '2024-01-01T00:00:00.000Z'
    },
    auditConfig: {
      enabled: true,
      strategy,
      category: 'user-management'
    }
  });

  const createMockOperationContext = (): RequestAuditContext => ({
    method: 'POST',
    path: '/api/users',
    headers: { 'content-type': 'application/json' },
    body: { name: 'John Doe', email: 'john@example.com' },
    query: { format: 'json' }
  });

  const createMockResponseContext = () => ({
    headers: { 'content-type': 'application/json' },
    body: { id: '123', name: 'John Doe' },
    statusCode: 201,
    responseSize: 56
  });

  describe('Separate Strategy (Default)', () => {
    it('should create separate start and end audit entries', async () => {
      const auditContext = createMockAuditContext('separate');
      const operationContext = createMockOperationContext();
      const responseContext = createMockResponseContext();

      // Capture start
      await AuditCaptureService.captureStart(auditContext, operationContext);
      
      // Capture end
      await AuditCaptureService.captureEnd(auditContext, null, null, responseContext);

      // Should have called captureLog twice (start + end)
      expect(mockCaptureLog).toHaveBeenCalledTimes(2);
      
      // First call should be start
      expect(mockCaptureLog).toHaveBeenNthCalledWith(1, expect.objectContaining({
        auditEntry: expect.objectContaining({
          subType: 'api_request_start',
          eventType: 'start'
        })
      }));
      
      // Second call should be end
      expect(mockCaptureLog).toHaveBeenNthCalledWith(2, expect.objectContaining({
        auditEntry: expect.objectContaining({
          subType: 'api_request_complete',
          eventType: 'complete',
          success: true
        })
      }));
    });
  });

  describe('Single Strategy', () => {
    it('should create only one comprehensive audit entry at the end', async () => {
      const auditContext = createMockAuditContext('single');
      const operationContext = createMockOperationContext();
      const responseContext = createMockResponseContext();

      // Capture start - should not log but store context
      await AuditCaptureService.captureStart(auditContext, operationContext);
      
      // Should not have logged anything yet
      expect(mockCaptureLog).not.toHaveBeenCalled();
      
      // Capture end - should create comprehensive entry
      await AuditCaptureService.captureEnd(auditContext, null, null, responseContext);

      // Should have called captureLog only once
      expect(mockCaptureLog).toHaveBeenCalledTimes(1);
      
      // Should contain comprehensive data in existing fields
      expect(mockCaptureLog).toHaveBeenCalledWith(expect.objectContaining({
        auditEntry: expect.objectContaining({
          subType: 'api_request',
          eventType: 'completed',
          success: true,
          
          // All comprehensive data stored in existing 'data' field
          data: expect.objectContaining({
            request: expect.objectContaining({
              headers: { 'content-type': 'application/json' },
              body: expect.objectContaining({ 
                name: 'John Doe',
                email: '[REDACTED]' // Data protection is working
              }),
              method: 'POST',
              path: '/api/users'
            }),
            response: expect.objectContaining({
              statusCode: 201,
              responseSize: 56
            }),
            timing: expect.objectContaining({
              startTime: '2024-01-01T00:00:00.000Z',
              endTime: expect.any(String),
              duration: expect.any(Number)
            })
          })
        })
      }));
    });

    it('should handle errors in single strategy', async () => {
      const auditContext = createMockAuditContext('single');
      const operationContext = createMockOperationContext();
      const error = new Error('Something went wrong');

      // Capture start
      await AuditCaptureService.captureStart(auditContext, operationContext);
      
      // Capture error
      await AuditCaptureService.captureEnd(auditContext, null, error);

      // Should have called captureLog only once
      expect(mockCaptureLog).toHaveBeenCalledTimes(1);
      
      // Should contain error data in existing fields
      expect(mockCaptureLog).toHaveBeenCalledWith(expect.objectContaining({
        auditEntry: expect.objectContaining({
          eventType: 'failed',
          success: false,
          status: 'failed',
          data: expect.objectContaining({
            error: expect.objectContaining({
              name: 'Error',
              message: 'Something went wrong',
              stack: expect.any(String)
            })
          })
        })
      }));
    });
  });

  describe('Strategy Comparison', () => {
    it('should demonstrate efficiency difference between strategies', async () => {
      const separateContext = createMockAuditContext('separate');
      const singleContext = createMockAuditContext('single');
      const operationContext = createMockOperationContext();
      const responseContext = createMockResponseContext();

      // Test separate strategy
      await AuditCaptureService.captureStart(separateContext, operationContext);
      await AuditCaptureService.captureEnd(separateContext, null, null, responseContext);
      
      const separateCallCount = mockCaptureLog.mock.calls.length;
      mockCaptureLog.mockClear();

      // Test single strategy  
      await AuditCaptureService.captureStart(singleContext, operationContext);
      await AuditCaptureService.captureEnd(singleContext, null, null, responseContext);
      
      const singleCallCount = mockCaptureLog.mock.calls.length;

      // Single strategy should be more efficient
      expect(separateCallCount).toBe(2); // start + end
      expect(singleCallCount).toBe(1);   // only end with comprehensive data
    });
  });
});
