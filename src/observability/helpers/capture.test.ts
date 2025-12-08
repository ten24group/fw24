import { captureBusinessEvent, captureBusinessError, captureMetric } from './capture';
import { ObservabilityManager } from '../manager';
import { ExecutionContext, Actor } from '../../core/types/execution-context';

// Mock ObservabilityManager
jest.mock('../manager', () => ({
  ObservabilityManager: {
    capture: jest.fn().mockReturnValue('test-log-id'),
  },
}));

describe('Capture Helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('captureBusinessEvent', () => {
    it('should capture a basic event', () => {
      const result = captureBusinessEvent({
        operation: 'payment.processed',
        entityName: 'payment',
        entityId: 'pay_123',
        success: true,
      });

      expect(result).toBe('test-log-id');
      expect(ObservabilityManager.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'audit',
          level: 'info',
          operation: 'payment.processed',
          entityName: 'payment',
          entityId: 'pay_123',
          success: true,
          status: 'completed',
        })
      );
    });

    it('should extract actor and correlationId from ExecutionContext', () => {
      const actor: Actor = {
        actorId: 'user-123',
        actorType: 'user',
        requestId: 'req-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        correlationId: 'corr-123',
      };

      const ctx = {
        actor,
        request: { requestId: 'req-123' },
      } as unknown as ExecutionContext;

      captureBusinessEvent({
        operation: 'user.login',
        ctx,
      });

      expect(ObservabilityManager.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'corr-123',
          actor,
        })
      );
    });

    it('should include metrics with duration convenience', () => {
      captureBusinessEvent({
        operation: 'api.call',
        duration: 150,
        metrics: { statusCode: 200 },
      });

      expect(ObservabilityManager.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: {
            duration: 150,
            statusCode: 200,
          },
        })
      );
    });

    it('should add service and externalSystem as tags', () => {
      captureBusinessEvent({
        operation: 'stripe.charge',
        service: 'payment-service',
        externalSystem: 'stripe',
        externalId: 'ch_123',
      });

      expect(ObservabilityManager.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: {
            service: 'payment-service',
            externalSystem: 'stripe',
          },
          data: expect.objectContaining({
            externalId: 'ch_123',
          }),
        })
      );
    });

    it('should set status based on success flag', () => {
      captureBusinessEvent({
        operation: 'test.failed',
        success: false,
      });

      expect(ObservabilityManager.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          status: 'failed',
        })
      );
    });

    it('should apply data protection by default', () => {
      captureBusinessEvent({
        operation: 'user.create',
        data: {
          username: 'john',
          password: 'secret123',
        },
      });

      const captureCall = (ObservabilityManager.capture as jest.Mock).mock.calls[0][0];
      expect(captureCall.data.password).toBe('[REDACTED]');
      expect(captureCall.data.username).toBe('john');
    });

    it('should skip data protection when disabled', () => {
      captureBusinessEvent({
        operation: 'user.create',
        data: {
          password: 'secret123',
        },
        dataProtection: { enabled: false },
      });

      const captureCall = (ObservabilityManager.capture as jest.Mock).mock.calls[0][0];
      expect(captureCall.data.password).toBe('secret123');
    });

    it('should handle null/undefined data gracefully', () => {
      expect(() => {
        captureBusinessEvent({
          operation: 'test',
          data: undefined,
        });
      }).not.toThrow();
    });
  });

  describe('captureBusinessError', () => {
    it('should capture an Error object', () => {
      const error = new Error('Payment failed');
      error.name = 'PaymentError';

      captureBusinessError(error, {
        operation: 'payment.process',
        entityName: 'payment',
        entityId: 'pay_123',
      });

      expect(ObservabilityManager.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          success: false,
          status: 'failed',
          data: expect.objectContaining({
            errorType: 'PaymentError',
            errorMessage: 'Payment failed',
          }),
        })
      );
    });

    it('should capture a non-Error value', () => {
      captureBusinessError('Something went wrong', {
        operation: 'test.error',
      });

      expect(ObservabilityManager.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            error: 'Something went wrong',
          }),
        })
      );
    });

    it('should merge additional data with error data', () => {
      const error = new Error('Test error');

      captureBusinessError(error, {
        operation: 'test.error',
        data: { additionalInfo: 'context' },
      });

      const captureCall = (ObservabilityManager.capture as jest.Mock).mock.calls[0][0];
      expect(captureCall.data.additionalInfo).toBe('context');
      expect(captureCall.data.errorMessage).toBe('Test error');
    });
  });

  describe('captureMetric', () => {
    it('should capture a metric', () => {
      captureMetric('api.latency', 150, {
        tags: { endpoint: '/users', method: 'GET' },
      });

      expect(ObservabilityManager.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'metric',
          level: 'info',
          operation: 'api.latency',
          metrics: { 'api.latency': 150 },
          tags: { endpoint: '/users', method: 'GET' },
        })
      );
    });

    it('should use correlationId from context', () => {
      const ctx = {
        actor: { correlationId: 'ctx-corr-id' },
      } as unknown as ExecutionContext;

      captureMetric('test.metric', 100, { ctx });

      expect(ObservabilityManager.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'ctx-corr-id',
        })
      );
    });
  });
});

