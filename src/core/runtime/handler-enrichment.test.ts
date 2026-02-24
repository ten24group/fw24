/**
 * Tests for handler enrichment features:
 * - Feature 1: HTTP status code tagging and response size metrics
 * - Feature 3: Memory pressure and timeout risk auto-tagging
 * - Feature 4: Error categorization
 */

import { APIController } from './api-gateway-controller';
import type { Request } from '../../interfaces';
import type { Context } from 'aws-lambda';
import { SpanObserver } from '../../observability';

// ═══════════════════════════════════════════════════════════════════════════
// Test Controller — expose protected methods for unit testing
// ═══════════════════════════════════════════════════════════════════════════

class TestableController extends APIController {
  public controllerName = 'test-enrichment';
  public routes = {};

  /** Expose categorizeError for direct testing */
  public testCategorizeError(statusCode: number, error?: Error): string {
    return this.categorizeError(statusCode, error);
  }

  /** Expose getStatusCodeClass for direct testing */
  public testGetStatusCodeClass(statusCode: number): string {
    return this.getStatusCodeClass(statusCode);
  }

  /** Expose tagResponseMetrics for direct testing */
  public testTagResponseMetrics(span: SpanObserver, response: { statusCode?: number; body?: string }): void {
    return this.tagResponseMetrics(span, response as any);
  }

  /** Expose enrichRootSpan for direct testing */
  public testEnrichRootSpan(span: SpanObserver, lambdaContext?: Context): void {
    return this.enrichRootSpan(span, lambdaContext);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function createMockLambdaContext(overrides: Partial<Context> = {}): Context {
  return {
    callbackWaitsForEmptyEventLoop: true,
    functionName: 'test-function',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2026/02/09/[$LATEST]abc123',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Feature 1: HTTP Status Code Classification
// ═══════════════════════════════════════════════════════════════════════════

describe('Feature 1: HTTP Status Code Classification', () => {
  let controller: TestableController;

  beforeEach(() => {
    controller = new TestableController();
  });

  describe('getStatusCodeClass', () => {
    it('classifies 1xx as informational', () => {
      expect(controller.testGetStatusCodeClass(100)).toBe('1xx');
      expect(controller.testGetStatusCodeClass(101)).toBe('1xx');
    });

    it('classifies 2xx as success', () => {
      expect(controller.testGetStatusCodeClass(200)).toBe('2xx');
      expect(controller.testGetStatusCodeClass(201)).toBe('2xx');
      expect(controller.testGetStatusCodeClass(204)).toBe('2xx');
      expect(controller.testGetStatusCodeClass(299)).toBe('2xx');
    });

    it('classifies 3xx as redirect', () => {
      expect(controller.testGetStatusCodeClass(301)).toBe('3xx');
      expect(controller.testGetStatusCodeClass(302)).toBe('3xx');
      expect(controller.testGetStatusCodeClass(304)).toBe('3xx');
    });

    it('classifies 4xx as client error', () => {
      expect(controller.testGetStatusCodeClass(400)).toBe('4xx');
      expect(controller.testGetStatusCodeClass(401)).toBe('4xx');
      expect(controller.testGetStatusCodeClass(403)).toBe('4xx');
      expect(controller.testGetStatusCodeClass(404)).toBe('4xx');
      expect(controller.testGetStatusCodeClass(422)).toBe('4xx');
      expect(controller.testGetStatusCodeClass(429)).toBe('4xx');
    });

    it('classifies 5xx as server error', () => {
      expect(controller.testGetStatusCodeClass(500)).toBe('5xx');
      expect(controller.testGetStatusCodeClass(502)).toBe('5xx');
      expect(controller.testGetStatusCodeClass(503)).toBe('5xx');
      expect(controller.testGetStatusCodeClass(504)).toBe('5xx');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature 4: Error Categorization
// ═══════════════════════════════════════════════════════════════════════════

describe('Feature 4: Error Categorization', () => {
  let controller: TestableController;

  beforeEach(() => {
    controller = new TestableController();
  });

  describe('categorizeError', () => {
    it('returns "auth" for 401 Unauthorized', () => {
      expect(controller.testCategorizeError(401)).toBe('auth');
    });

    it('returns "auth" for 403 Forbidden', () => {
      expect(controller.testCategorizeError(403)).toBe('auth');
    });

    it('returns "throttle" for 429 Too Many Requests', () => {
      expect(controller.testCategorizeError(429)).toBe('throttle');
    });

    it('returns "validation" for other 4xx errors', () => {
      expect(controller.testCategorizeError(400)).toBe('validation');
      expect(controller.testCategorizeError(404)).toBe('validation');
      expect(controller.testCategorizeError(409)).toBe('validation');
      expect(controller.testCategorizeError(422)).toBe('validation');
    });

    it('returns "infrastructure" for timeout errors regardless of status code', () => {
      expect(controller.testCategorizeError(500, new Error('ETIMEDOUT'))).toBe('infrastructure');
      expect(controller.testCategorizeError(502, new Error('ECONNREFUSED'))).toBe('infrastructure');
      expect(controller.testCategorizeError(500, new Error('ECONNRESET'))).toBe('infrastructure');
      expect(controller.testCategorizeError(500, new Error('socket hang up'))).toBe('infrastructure');
      expect(controller.testCategorizeError(500, new Error('ENOTFOUND'))).toBe('infrastructure');
      expect(controller.testCategorizeError(504, new Error('Request timeout'))).toBe('infrastructure');
    });

    it('returns "server" for 5xx without infrastructure error pattern', () => {
      expect(controller.testCategorizeError(500)).toBe('server');
      expect(controller.testCategorizeError(500, new Error('Something went wrong'))).toBe('server');
      expect(controller.testCategorizeError(502)).toBe('server');
      expect(controller.testCategorizeError(503)).toBe('server');
    });

    it('returns "application" for unclassifiable errors', () => {
      expect(controller.testCategorizeError(200, new Error('Weird error'))).toBe('application');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature 3: Memory Pressure and Timeout Risk Auto-Tagging
// ═══════════════════════════════════════════════════════════════════════════

describe('Feature 3: Memory Pressure and Timeout Risk', () => {
  let controller: TestableController;

  beforeEach(() => {
    controller = new TestableController();
  });

  describe('enrichRootSpan memory pressure detection', () => {
    it('tags _memory_pressure when heap > 80% of Lambda memory limit', () => {
      // We can't easily control process.memoryUsage(), but we can test with
      // a very low memory limit that current heap will exceed 80% of.
      const tags: Record<string, string> = {};
      const mockSpan = {
        tag: jest.fn((k: string, v: string) => { tags[k] = v; return mockSpan; }),
        tags: jest.fn(() => mockSpan),
        metric: jest.fn(() => mockSpan),
        metrics: jest.fn(() => mockSpan),
      } as unknown as SpanObserver;

      // Use a very low memory limit so heap usage > 80%
      const ctx = createMockLambdaContext({ memoryLimitInMB: '1' });
      controller.testEnrichRootSpan(mockSpan, ctx);

      // Current heap is way more than 0.8MB, so _memory_pressure should be tagged
      expect(mockSpan.tag).toHaveBeenCalledWith('_memory_pressure', 'true');
    });

    it('does not tag _memory_pressure when heap < 80% of Lambda memory limit', () => {
      const tags: Record<string, string> = {};
      const mockSpan = {
        tag: jest.fn((k: string, v: string) => { tags[k] = v; return mockSpan; }),
        tags: jest.fn(() => mockSpan),
        metric: jest.fn(() => mockSpan),
        metrics: jest.fn(() => mockSpan),
      } as unknown as SpanObserver;

      // Use a very high memory limit so heap is well under 80%
      const ctx = createMockLambdaContext({ memoryLimitInMB: '10240' });
      controller.testEnrichRootSpan(mockSpan, ctx);

      // Verify _memory_pressure was NOT called
      const memPressureCalls = (mockSpan.tag as jest.Mock).mock.calls.filter(
        ([k]: [string]) => k === '_memory_pressure'
      );
      expect(memPressureCalls).toHaveLength(0);
    });
  });

  describe('enrichRootSpan timeout risk detection', () => {
    it('tags _timeout_risk when remaining time < 3000ms', () => {
      const mockSpan = {
        tag: jest.fn(() => mockSpan),
        tags: jest.fn(() => mockSpan),
        metric: jest.fn(() => mockSpan),
        metrics: jest.fn(() => mockSpan),
      } as unknown as SpanObserver;

      const ctx = createMockLambdaContext({
        memoryLimitInMB: '10240', // high to avoid memory pressure
        getRemainingTimeInMillis: () => 1500, // only 1.5s left
      });
      controller.testEnrichRootSpan(mockSpan, ctx);

      expect(mockSpan.tag).toHaveBeenCalledWith('_timeout_risk', 'true');
    });

    it('does not tag _timeout_risk when remaining time is ample', () => {
      const mockSpan = {
        tag: jest.fn(() => mockSpan),
        tags: jest.fn(() => mockSpan),
        metric: jest.fn(() => mockSpan),
        metrics: jest.fn(() => mockSpan),
      } as unknown as SpanObserver;

      const ctx = createMockLambdaContext({
        memoryLimitInMB: '10240',
        getRemainingTimeInMillis: () => 60000, // 60s remaining
      });
      controller.testEnrichRootSpan(mockSpan, ctx);

      const timeoutRiskCalls = (mockSpan.tag as jest.Mock).mock.calls.filter(
        ([k]: [string]) => k === '_timeout_risk'
      );
      expect(timeoutRiskCalls).toHaveLength(0);
    });
  });

  describe('enrichRootSpan without Lambda context', () => {
    it('does not tag memory or timeout signals when no context provided', () => {
      const mockSpan = {
        tag: jest.fn(() => mockSpan),
        tags: jest.fn(() => mockSpan),
        metric: jest.fn(() => mockSpan),
        metrics: jest.fn(() => mockSpan),
      } as unknown as SpanObserver;

      controller.testEnrichRootSpan(mockSpan); // no context

      const pressureCalls = (mockSpan.tag as jest.Mock).mock.calls.filter(
        ([k]: [string]) => k === '_memory_pressure' || k === '_timeout_risk'
      );
      expect(pressureCalls).toHaveLength(0);
    });
  });
});
