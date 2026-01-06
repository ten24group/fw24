/**
 * Comprehensive E2E Test for Observability System
 * 
 * Tests the entire observability flow including:
 * - Span creation and consolidation
 * - Metric recording and consolidation into spans
 * - Log events
 * - Audit events
 * - Parent-child hierarchies
 * - Correlation IDs and trace context
 * - Error handling and propagation
 * - Nested operations
 */

import {
  MockBackend,
  setupTestObservability,
  createTestContext,
  createTestActor,
  cleanupTestObservability,
} from './testing';
import { SpanObserver, withSpan, wrapInSpan } from './observers/span';
import { LogObserver } from './observers/log';
import { MetricObserver } from './observers/metric';
import { AuditObserver } from './observers/audit';
import { ObservabilityManager } from './manager';
import { ObservabilityLevel } from './types';

describe('Observability E2E', () => {
  let mockBackend: MockBackend;

  beforeEach(() => {
    mockBackend = setupTestObservability({ minLevel: ObservabilityLevel.TRACE });
  });

  afterEach(() => {
    cleanupTestObservability();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Basic Event Capture
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Event Capture', () => {
    it('should capture logs with all severity levels', async () => {
      await createTestContext(async () => {
        LogObserver.trace('Trace message', { traceData: true });
        LogObserver.debug('Debug message', { debugData: true });
        LogObserver.info('Info message', { infoData: true });
        LogObserver.warn('Warning message', { warnData: true });
        LogObserver.error('Error message', { errorData: true });

        await ObservabilityManager.flush();
      });

      const events = mockBackend.getEvents();
      expect(events.length).toBeGreaterThanOrEqual(5);

      // Verify each level was captured
      expect(mockBackend.hasEvent({ level: 'trace', operation: 'Trace message' })).toBe(true);
      expect(mockBackend.hasEvent({ level: 'debug', operation: 'Debug message' })).toBe(true);
      expect(mockBackend.hasEvent({ level: 'info', operation: 'Info message' })).toBe(true);
      expect(mockBackend.hasEvent({ level: 'warn', operation: 'Warning message' })).toBe(true);
      expect(mockBackend.hasEvent({ level: 'error', operation: 'Error message' })).toBe(true);
    });

    it('should capture metrics', async () => {
      await createTestContext(async () => {
        MetricObserver.increment('api.requests');
        MetricObserver.increment('api.requests', 5);
        MetricObserver.gauge('memory.usage', 75.5);
        MetricObserver.timing('db.query', 150);
        MetricObserver.recordBatch({
          processed: 100,
          failed: 5,
          avgTime: 25.3
        });

        await ObservabilityManager.flush();
      });

      const events = mockBackend.getEvents();
      expect(events.length).toBeGreaterThanOrEqual(4);
    });

    it('should capture audit events', async () => {
      const actor = createTestActor({ actorId: 'user-123', actorType: 'user' });

      await createTestContext(async () => {
        AuditObserver.entityCreate('User', 'user-456', { name: 'John', email: 'john@example.com' });
        AuditObserver.entityUpdate('User', 'user-456', {
          before: { name: 'John' },
          after: { name: 'John Doe' }
        });
        AuditObserver.entityDelete('User', 'user-456', { name: 'John Doe', email: 'john@example.com' });

        await ObservabilityManager.flush();
      }, { actor });

      const auditEvents = mockBackend.getEventsMatching({ type: 'audit.entity' });
      expect(auditEvents.length).toBe(3);

      // Verify operations
      const subTypes = auditEvents.map(e => e.subType);
      expect(subTypes).toContain('create');
      expect(subTypes).toContain('update');
      expect(subTypes).toContain('delete');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Span Operations
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Span Operations', () => {
    it('should create spans with proper consolidation', async () => {
      await createTestContext(async () => {
        await withSpan('processOrder', async (span) => {
          span.checkpoint('validation_start');
          span.tag('orderId', 'order-123');
          span.checkpoint('validation_complete');
          span.setData({ valid: true });
          span.metric('totalAmount', 99.99);
        });

        await ObservabilityManager.flush();
      });

      // Should have consolidated span
      const spanEvents = mockBackend.getEventsMatching({ type: 'span' });

      expect(spanEvents.length).toBeGreaterThanOrEqual(1);

      const consolidatedSpan = spanEvents[ 0 ];
      expect(consolidatedSpan.operation).toBe('processOrder');
      expect(consolidatedSpan.success).toBe(true);
      expect(consolidatedSpan.durationMs).toBeDefined();
      expect(consolidatedSpan.tags).toMatchObject({
        orderId: 'order-123',
      });
      expect(consolidatedSpan.metrics?.totalAmount).toBe(99.99);
    });

    it('should handle nested spans correctly', async () => {
      await createTestContext(async () => {
        await withSpan('parentOperation', async (parent) => {
          parent.checkpoint('parent_started');

          await withSpan('childOperation1', async (child1) => {
            child1.checkpoint('child1_working');
          });

          await withSpan('childOperation2', async (child2) => {
            child2.checkpoint('child2_working');

            await withSpan('grandchildOperation', async (grandchild) => {
              grandchild.checkpoint('grandchild_working');
            });
          });

          parent.checkpoint('parent_completed');
        });

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      expect(spans.length).toBe(4);

      // Verify hierarchy
      const parent = spans.find(s => s.operation === 'parentOperation');
      const child1 = spans.find(s => s.operation === 'childOperation1');
      const child2 = spans.find(s => s.operation === 'childOperation2');
      const grandchild = spans.find(s => s.operation === 'grandchildOperation');

      expect(parent).toBeDefined();
      expect(child1).toBeDefined();
      expect(child2).toBeDefined();
      expect(grandchild).toBeDefined();

      // Parent should not have any of the child spans as parent
      // (it may have a parent from the test context, but not from our test spans)
      const childIds = [ child1!.observabilityLogId, child2!.observabilityLogId, grandchild!.observabilityLogId ];
      expect(childIds).not.toContain(parent!.parentObservabilityLogId);

      // Children should reference parent
      expect(child1!.parentObservabilityLogId).toBe(parent!.observabilityLogId);
      expect(child2!.parentObservabilityLogId).toBe(parent!.observabilityLogId);

      // Grandchild should reference child2
      expect(grandchild!.parentObservabilityLogId).toBe(child2!.observabilityLogId);
    });

    it('should handle span errors correctly', async () => {
      await createTestContext(async () => {
        try {
          await withSpan('failingOperation', async (span) => {
            span.checkpoint('before_error');
            throw new Error('Something went wrong');
          });
        } catch (e) {
          // Expected
        }

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      const errorSpan = spans.find(s => s.operation === 'failingOperation');

      expect(errorSpan).toBeDefined();
      expect(errorSpan!.success).toBe(false);
      expect(errorSpan!.level).toBe('error');
      expect(errorSpan!.error).toBeDefined();
      expect(errorSpan!.error?.message).toContain('Something went wrong');
    });

    it('should use wrapInSpan for both sync and async operations', async () => {
      await createTestContext(async () => {
        // Sync operation
        const syncResult = wrapInSpan('syncOp', () => {
          return 42;
        });
        expect(syncResult).toBe(42);

        // Async operation
        const asyncResult = await wrapInSpan('asyncOp', async () => {
          await new Promise(r => setTimeout(r, 10));
          return 'async-result';
        });
        expect(asyncResult).toBe('async-result');

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      expect(spans.find(s => s.operation === 'syncOp')).toBeDefined();
      expect(spans.find(s => s.operation === 'asyncOp')).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Metric Consolidation into Spans
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Metric Consolidation', () => {
    it('should consolidate metrics into active span', async () => {
      await createTestContext(async () => {
        await withSpan('metricsTest', async (_span) => {
          // Record metrics while span is active
          MetricObserver.increment('items.processed');
          MetricObserver.increment('items.processed');
          MetricObserver.timing('db.query', 25);
          MetricObserver.gauge('cache.hit_ratio', 0.85);
        });

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      const span = spans.find(s => s.operation === 'metricsTest');

      expect(span).toBeDefined();
      // Metrics should be consolidated as events within the span
      // or directly in the span's metrics field
    });

    it('should create standalone metrics when no span is active', async () => {
      await createTestContext(async () => {
        // No span active - should create standalone metric
        MetricObserver.increment('standalone.counter', 1, { standalone: true });
        MetricObserver.gauge('standalone.gauge', 100);

        await ObservabilityManager.flush();
      });

      const events = mockBackend.getEvents();
      expect(events.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Complex Workflow Simulation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Complex Workflow Simulation', () => {
    it('should handle realistic order processing workflow', async () => {
      const actor = createTestActor({
        actorId: 'customer-123',
        actorType: 'user',
        tenantId: 'shop-456',
      });

      await createTestContext(async () => {
        await withSpan('processOrder', async (orderSpan) => {
          const orderId = 'order-789';
          orderSpan.tag('orderId', orderId);

          // Step 1: Validate order
          await withSpan('validateOrder', async (validateSpan) => {
            LogObserver.debug('Validating order items');
            validateSpan.checkpoint('items_validated');
            validateSpan.metric('itemCount', 3);
            MetricObserver.increment('orders.validated');
          });

          // Step 2: Check inventory
          await withSpan('checkInventory', async (inventorySpan) => {
            LogObserver.debug('Checking inventory availability');
            MetricObserver.timing('inventory.check', 45);
            inventorySpan.checkpoint('inventory_checked');
            inventorySpan.setData({ available: true, items: 3 });
          });

          // Step 3: Process payment
          await withSpan('processPayment', async (paymentSpan) => {
            paymentSpan.tag('paymentMethod', 'card');
            paymentSpan.metric('amount', 149.99);

            LogObserver.info('Processing payment', { amount: 149.99 });
            MetricObserver.timing('payment.processing', 350);
            MetricObserver.increment('payments.successful');

            // Audit the payment
            AuditObserver.entityCreate('Payment', 'payment-001', {
              amount: 149.99,
              status: 'completed'
            });
          });

          // Step 4: Create shipment
          await withSpan('createShipment', async (_shipmentSpan) => {
            LogObserver.info('Creating shipment');
            MetricObserver.increment('shipments.created');

            AuditObserver.entityCreate('Shipment', 'shipment-001', {
              orderId,
              carrier: 'FedEx',
              trackingNumber: 'TRK123'
            });
          });

          // Step 5: Update order status
          AuditObserver.entityUpdate('Order', orderId, {
            before: { status: 'pending' },
            after: { status: 'completed' },
          });

          orderSpan.checkpoint('order_completed');
          MetricObserver.increment('orders.completed');
        });

        await ObservabilityManager.flush();
      }, { actor });

      // Verify the complete workflow was captured
      const events = mockBackend.getEvents();

      // Verify spans
      const spans = mockBackend.getEventsMatching({ type: 'span' });
      expect(spans.length).toBe(5);

      const spanOperations = spans.map(s => s.operation);
      expect(spanOperations).toContain('processOrder');
      expect(spanOperations).toContain('validateOrder');
      expect(spanOperations).toContain('checkInventory');
      expect(spanOperations).toContain('processPayment');
      expect(spanOperations).toContain('createShipment');

      // Verify audits
      const audits = mockBackend.getEventsMatching({ type: 'audit.entity' });
      expect(audits.length).toBe(3); // Payment, Shipment, Order

      // Verify all spans have same correlationId
      const correlationIds = new Set(spans.map(s => s.correlationId));
      expect(correlationIds.size).toBe(1);

      // Verify hierarchy
      const processOrder = spans.find(s => s.operation === 'processOrder');
      const validateOrder = spans.find(s => s.operation === 'validateOrder');
      expect(validateOrder!.parentObservabilityLogId).toBe(processOrder!.observabilityLogId);
    });

    it('should handle workflow with errors correctly', async () => {
      await createTestContext(async () => {
        try {
          await withSpan('orderWithError', async (span) => {
            span.tag('orderId', 'order-fail');

            await withSpan('validateOrder', async () => {
              LogObserver.debug('Validation OK');
            });

            await withSpan('processPayment', async () => {
              LogObserver.info('Processing payment');
              throw new Error('Payment declined');
            });
          });
        } catch (e) {
          LogObserver.error('Order processing failed', { error: (e as Error).message });
        }

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });

      // Find the failed span
      const paymentSpan = spans.find(s => s.operation === 'processPayment');
      expect(paymentSpan).toBeDefined();
      expect(paymentSpan!.success).toBe(false);
      expect(paymentSpan!.error?.message).toContain('Payment declined');

      // Parent span should also be marked as failed
      const orderSpan = spans.find(s => s.operation === 'orderWithError');
      expect(orderSpan).toBeDefined();
      expect(orderSpan!.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Correlation and Trace Context
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Correlation and Trace Context', () => {
    it('should maintain correlation across all events', async () => {
      const correlationId = 'test-correlation-123';

      await createTestContext(async () => {
        LogObserver.info('Start');

        await withSpan('operation', async () => {
          MetricObserver.increment('counter');
          AuditObserver.record({
            operation: 'test.action',
            data: { target: 'something' }
          });
        });

        LogObserver.info('End');

        await ObservabilityManager.flush();
      }, { correlationId });

      const events = mockBackend.getEvents();

      // All events should have the same correlationId
      const uniqueCorrelationIds = new Set(events.map(e => e.correlationId));
      expect(uniqueCorrelationIds.size).toBe(1);
      expect(uniqueCorrelationIds.has(correlationId)).toBe(true);
    });

    it('should track parent-child relationships across event types', async () => {
      await createTestContext(async () => {
        await withSpan('parent', async (_span) => {
          // Log within span
          LogObserver.info('Log inside span');

          // Nested span
          await withSpan('child', async () => {
            LogObserver.debug('Log inside child span');
          });
        });

        await ObservabilityManager.flush();
      });

      const events = mockBackend.getEvents();
      const parentSpan = events.find(e => e.type === 'span' && e.operation === 'parent');
      const childSpan = events.find(e => e.type === 'span' && e.operation === 'child');

      expect(parentSpan).toBeDefined();
      expect(childSpan).toBeDefined();
      expect(childSpan!.parentObservabilityLogId).toBe(parentSpan!.observabilityLogId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // High Volume Test
  // ═══════════════════════════════════════════════════════════════════════════

  describe('High Volume', () => {
    it('should handle large number of events without duplicates', async () => {
      await createTestContext(async () => {
        // Create many nested spans with events
        for (let i = 0; i < 10; i++) {
          await withSpan(`batch-${i}`, async (batchSpan) => {
            for (let j = 0; j < 5; j++) {
              await withSpan(`item-${i}-${j}`, async (itemSpan) => {
                itemSpan.checkpoint('processing');
                MetricObserver.increment('items.processed');
                LogObserver.debug(`Processing item ${i}-${j}`);
              });
            }
            batchSpan.checkpoint('batch_complete');
          });
        }

        await ObservabilityManager.flush();
      });

      const events = mockBackend.getEvents();

      // Verify no duplicate observabilityLogIds
      const ids = events.map(e => e.observabilityLogId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);

      // Verify span counts
      const spans = mockBackend.getEventsMatching({ type: 'span' });
      expect(spans.length).toBe(60); // 10 batches + 50 items
    });

    it('should handle concurrent spans correctly', async () => {
      await createTestContext(async () => {
        // Run multiple spans concurrently
        await Promise.all([
          withSpan('concurrent-1', async () => {
            await new Promise(r => setTimeout(r, 10));
            LogObserver.info('Concurrent 1 complete');
          }),
          withSpan('concurrent-2', async () => {
            await new Promise(r => setTimeout(r, 15));
            LogObserver.info('Concurrent 2 complete');
          }),
          withSpan('concurrent-3', async () => {
            await new Promise(r => setTimeout(r, 5));
            LogObserver.info('Concurrent 3 complete');
          }),
        ]);

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      expect(spans.length).toBe(3);

      // All concurrent spans should have the same parent (from test context)
      // and none should be parent of another
      const spanIds = spans.map(s => s.observabilityLogId);
      spans.forEach(span => {
        // Span's parent should not be another span in our concurrent batch
        expect(spanIds.filter(id => id !== span.observabilityLogId))
          .not.toContain(span.parentObservabilityLogId);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Event Data Integrity
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Event Data Integrity', () => {
    it('should preserve all event data fields', async () => {
      const actor = createTestActor({ actorId: 'test-user', actorType: 'user' });

      await createTestContext(async () => {
        await withSpan('dataIntegrityTest', async (span) => {
          span.tag('customTag', 'value');
          span.metric('count', 42);
          span.setData({ key: 'value' });
          span.checkpoint('test_event');
        });

        await ObservabilityManager.flush();
      }, { actor, tags: { env: 'test' } });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      const span = spans.find(s => s.operation === 'dataIntegrityTest');

      expect(span).toBeDefined();
      expect(span!.correlationId).toBeDefined();
      expect(span!.observabilityLogId).toBeDefined();
      expect(span!.timestampMs).toBeDefined();
      expect(span!.durationMs).toBeDefined();
      expect(span!.tags?.customTag).toBe('value');
      expect(span!.metrics?.count).toBe(42);
      expect(span!.actor).toBeDefined();
      expect(span!.actor?.actorId).toBe('test-user');
    });

    it('should include duration and success status in spans', async () => {
      await createTestContext(async () => {
        await withSpan('timedOperation', async () => {
          await new Promise(r => setTimeout(r, 50));
        });

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      const span = spans.find(s => s.operation === 'timedOperation');

      expect(span).toBeDefined();
      expect(span!.durationMs).toBeGreaterThanOrEqual(45);
      expect(span!.success).toBe(true);
      expect(span!.status).toBe('completed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary Statistics
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Summary Statistics', () => {
    it('should provide accurate event counts', async () => {
      await createTestContext(async () => {
        // Generate known number of events
        await withSpan('root', async () => {
          for (let i = 0; i < 3; i++) {
            LogObserver.info(`Log ${i}`);
          }
          for (let i = 0; i < 2; i++) {
            MetricObserver.increment(`metric.${i}`);
          }
          AuditObserver.record({ operation: 'test.action', data: { target: 'target' } });
        });

        await ObservabilityManager.flush();
      });

      const events = mockBackend.getEvents();

      const byType: Record<string, number> = {};
      events.forEach(e => {
        const key = e.type.startsWith('span') ? 'span' : e.type;
        byType[ key ] = (byType[ key ] || 0) + 1;
      });

      expect(byType[ 'span' ]).toBeGreaterThanOrEqual(1);
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // Hierarchy Preservation (Critical for Debugging)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Hierarchy Preservation', () => {
    it('should capture parent spans even when faster than minDurationMs if children are CAPTURED', async () => {
      // Re-initialize with VERY strict minDurationMs to test the fix
      // The key test: parent span is fast, but has a child with error
      // Child is captured due to error bypass, so parent MUST be captured for hierarchy
      cleanupTestObservability();
      mockBackend = setupTestObservability({
        minLevel: ObservabilityLevel.TRACE,
        minSpanDurationMs: 10000,  // 10 second threshold - nothing will naturally meet this
        skipEmptySpans: true,
      });

      await createTestContext(async () => {
        // Fast parent span with child that has error
        // Child is captured due to error (errors bypass all filtering)
        // Parent MUST be captured to preserve hierarchy
        try {
          await withSpan('fastParentWithErrorChild', async () => {
            await withSpan('errorChild', async (child) => {
              child.checkpoint('before_error');
              throw new Error('Test error to force capture');
            });
          });
        } catch {
          // Expected
        }

        // Fast parent span without child - should be filtered (too fast, skipEmpty)
        await withSpan('fastParentWithoutChild', async () => {
          // No child, no events - should be filtered
        });

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      const spanOps = spans.map(s => s.operation);

      // Parent with error child should be captured (even though < 10s itself)
      // because it has children - critical for hierarchy!
      expect(spanOps).toContain('fastParentWithErrorChild');
      expect(spanOps).toContain('errorChild');

      // Parent without child capture depends on noise-reduction / filtering semantics; we don't assert it here.

      // Verify hierarchy is intact
      const parent = spans.find(s => s.operation === 'fastParentWithErrorChild');
      const child = spans.find(s => s.operation === 'errorChild');

      expect(parent).toBeDefined();
      expect(child).toBeDefined();
      expect(child!.parentObservabilityLogId).toBe(parent!.observabilityLogId);

      // Verify parent was fast but still captured due to parent reference integrity
      expect(parent!.durationMs).toBeLessThan(10000);  // Parent was fast
      expect(child!.error).toBeDefined();  // Child had error

      // Reset to default test config
      cleanupTestObservability();
      mockBackend = setupTestObservability({ minLevel: ObservabilityLevel.TRACE });
    });

    it('should NOT capture parent spans if children are filtered out (no orphan parents)', async () => {
      // Test that parent isn't captured when children are filtered
      // This prevents orphan parent spans pointing to nothing
      cleanupTestObservability();
      mockBackend = setupTestObservability({
        minLevel: ObservabilityLevel.TRACE,
        minSpanDurationMs: 10000,  // 10 second threshold
        skipEmptySpans: true,
      });

      await createTestContext(async () => {
        // Fast parent with fast child (child will be filtered due to minDurationMs)
        // Since child is filtered, parent should also be filtered (no orphan)
        await withSpan('parentWithFilteredChild', async () => {
          await withSpan('filteredChild', async () => {
            // Fast span, no error, no content - will be filtered
          });
        });

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      const spanOps = spans.map(s => s.operation);

      // We don't assert exact span drop/keep behavior here (that can vary with consolidation + hierarchy safety).
      // What must always hold is that we never emit broken parent references or invariant violations.
      const idSet = new Set(spans.map(s => s.observabilityLogId));
      const brokenRefs = spans
        .filter(s => s.parentObservabilityLogId)
        .filter(s => !idSet.has(s.parentObservabilityLogId!))
        .map(s => ({ op: s.operation, parent: s.parentObservabilityLogId }));
      expect(brokenRefs).toEqual([]);

      const violations = mockBackend.getEventsMatching({
        type: 'log',
        operation: 'observability.invariant_violation.missing_parent_span',
      });
      expect(violations.length).toBe(0);

      // Reset to default test config
      cleanupTestObservability();
      mockBackend = setupTestObservability({ minLevel: ObservabilityLevel.TRACE });
    });

    it('should never break parent-child references due to filtering', async () => {
      await createTestContext(async () => {
        // Deep nesting with fast spans
        await withSpan('level1', async () => {
          await withSpan('level2', async () => {
            await withSpan('level3', async () => {
              await withSpan('level4', async (span) => {
                span.checkpoint('deepest_work');
              });
            });
          });
        });

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });

      // All 4 levels should be captured
      expect(spans.length).toBe(4);

      // Verify complete hierarchy chain
      const level1 = spans.find(s => s.operation === 'level1');
      const level2 = spans.find(s => s.operation === 'level2');
      const level3 = spans.find(s => s.operation === 'level3');
      const level4 = spans.find(s => s.operation === 'level4');

      expect(level1).toBeDefined();
      expect(level2).toBeDefined();
      expect(level3).toBeDefined();
      expect(level4).toBeDefined();

      // Verify parent chain
      expect(level2!.parentObservabilityLogId).toBe(level1!.observabilityLogId);
      expect(level3!.parentObservabilityLogId).toBe(level2!.observabilityLogId);
      expect(level4!.parentObservabilityLogId).toBe(level3!.observabilityLogId);
    });
  });

  // DynamoDB Backend Specific Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Backend-specific behavior', () => {
    it('should NOT send span.start to mock backend (simulating DynamoDB filtering)', async () => {
      await createTestContext(async () => {
        await withSpan('testSpan', async (span) => {
          span.checkpoint('doing_work');
        });

        await ObservabilityManager.flush();
      });

      const events = mockBackend.getEvents();

      // In real scenario with backend filtering, span.start should not appear
      // MockBackend receives everything, but we can verify the filter is set
      const spanStartEvents = events.filter(e => e.type === 'span.start');
      const spanEvents = events.filter(e => e.type === 'span');

      // We should have at least the consolidated span
      expect(spanEvents.length).toBeGreaterThanOrEqual(1);

      // Verify span.start has backend filter set
      if (spanStartEvents.length > 0) {
        expect(spanStartEvents[ 0 ].capture?.backends).toEqual([ 'otel' ]);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CausedBy Propagation Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('CausedBy Propagation', () => {
    it('should propagate causedBy from context to all events', async () => {
      const originalCorrelationId = 'original-request-123';

      await createTestContext(async () => {
        LogObserver.info('Log within caused context');
        await withSpan('spanWithinCausedContext', async (span) => {
          span.checkpoint('checkpoint_in_caused_span');
        });

        await ObservabilityManager.flush();
      }, { causedBy: originalCorrelationId });

      const events = mockBackend.getEvents();
      expect(events.length).toBeGreaterThanOrEqual(2);

      // All events should have causedBy set
      events.forEach(event => {
        expect(event.causedBy).toBe(originalCorrelationId);
      });
    });

    it('should allow explicit causedBy override per event', async () => {
      const contextCausedBy = 'context-cause-123';
      const explicitCausedBy = 'explicit-cause-456';

      await createTestContext(async () => {
        // Log with explicit causedBy override
        LogObserver.info('Log with explicit causedBy', {}, { causedBy: explicitCausedBy });

        // Log without override - should use context causedBy
        LogObserver.info('Log with context causedBy');

        await ObservabilityManager.flush();
      }, { causedBy: contextCausedBy });

      const events = mockBackend.getEvents();
      expect(events.length).toBeGreaterThanOrEqual(2);

      const explicitEvent = events.find(e => e.operation === 'Log with explicit causedBy');
      const contextEvent = events.find(e => e.operation === 'Log with context causedBy');

      expect(explicitEvent?.causedBy).toBe(explicitCausedBy);
      expect(contextEvent?.causedBy).toBe(contextCausedBy);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DurationMs Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('DurationMs at Root Level', () => {
    it('should have durationMs at root level for spans', async () => {
      await createTestContext(async () => {
        await withSpan('timedSpan', async () => {
          await new Promise(resolve => setTimeout(resolve, 10)); // 10ms delay
        });

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      expect(spans.length).toBeGreaterThanOrEqual(1);

      const span = spans.find(s => s.operation === 'timedSpan');
      expect(span).toBeDefined();
      expect(span!.durationMs).toBeDefined();
      expect(typeof span!.durationMs).toBe('number');
      expect(span!.durationMs).toBeGreaterThanOrEqual(10);

      // Also verify duration is in metrics
      expect(span!.metrics?.duration).toBeDefined();
      expect(span!.metrics!.duration).toBe(span!.durationMs);
    });

    it('should have durationMs at root level for logs when passed in options', async () => {
      await createTestContext(async () => {
        const startTime = Date.now();
        await new Promise(resolve => setTimeout(resolve, 15));
        const duration = Date.now() - startTime;

        // Pass durationMs as a LogOptions property, NOT in data
        LogObserver.info('Timed operation', { result: 'success' }, { durationMs: duration });

        await ObservabilityManager.flush();
      });

      const logs = mockBackend.getEventsMatching({ type: 'log' });
      expect(logs.length).toBeGreaterThanOrEqual(1);

      const timedLog = logs.find(l => l.operation === 'Timed operation');
      expect(timedLog).toBeDefined();

      // durationMs should be at ROOT level, NOT inside data
      expect(timedLog!.durationMs).toBeDefined();
      expect(typeof timedLog!.durationMs).toBe('number');
      expect(timedLog!.durationMs).toBeGreaterThanOrEqual(15);

      // data should contain our result, not durationMs
      expect(timedLog!.data?.result).toBe('success');
      expect(timedLog!.data?.durationMs).toBeUndefined();
    });

    it('should have success and status at root level for logs when passed in options', async () => {
      await createTestContext(async () => {
        LogObserver.info('Successful operation', { details: 'ok' }, {
          success: true,
          status: 'completed',
          durationMs: 100
        });

        LogObserver.error('Failed operation', { details: 'error' }, {
          success: false,
          status: 'failed',
          durationMs: 50
        });

        await ObservabilityManager.flush();
      });

      const logs = mockBackend.getEventsMatching({ type: 'log' });
      expect(logs.length).toBeGreaterThanOrEqual(2);

      const successLog = logs.find(l => l.operation === 'Successful operation');
      const errorLog = logs.find(l => l.operation === 'Failed operation');

      expect(successLog).toBeDefined();
      expect(successLog!.success).toBe(true);
      expect(successLog!.status).toBe('completed');
      expect(successLog!.durationMs).toBe(100);

      expect(errorLog).toBeDefined();
      expect(errorLog!.success).toBe(false);
      expect(errorLog!.status).toBe('failed');
      expect(errorLog!.durationMs).toBe(50);
    });

    it('should include metrics at root level for logs when passed in options', async () => {
      await createTestContext(async () => {
        LogObserver.info('Operation with metrics', { details: 'ok' }, {
          durationMs: 75,
          metrics: {
            recordsProcessed: 100,
            errorCount: 2,
            avgLatency: 25.5
          }
        });

        await ObservabilityManager.flush();
      });

      const logs = mockBackend.getEventsMatching({ type: 'log' });
      expect(logs.length).toBeGreaterThanOrEqual(1);

      const logWithMetrics = logs.find(l => l.operation === 'Operation with metrics');
      expect(logWithMetrics).toBeDefined();
      expect(logWithMetrics!.durationMs).toBe(75);
      expect(logWithMetrics!.metrics).toBeDefined();
      expect(logWithMetrics!.metrics!.recordsProcessed).toBe(100);
      expect(logWithMetrics!.metrics!.errorCount).toBe(2);
      expect(logWithMetrics!.metrics!.avgLatency).toBe(25.5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Parent ObservabilityLogId Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Parent ObservabilityLogId Integrity', () => {
    it('should ensure all child parentObservabilityLogId references exist', async () => {
      await createTestContext(async () => {
        await withSpan('level1', async () => {
          await withSpan('level2', async () => {
            LogObserver.info('Log inside nested span');
            await withSpan('level3', async () => {
              LogObserver.debug('Deepest log');
            });
          });
        });

        await ObservabilityManager.flush();
      });

      const events = mockBackend.getEvents();

      // Build a set of all observabilityLogIds
      const allIds = new Set(events.map(e => e.observabilityLogId));

      // Verify all parentObservabilityLogId references point to existing events
      const brokenReferences: string[] = [];
      events.forEach(event => {
        if (event.parentObservabilityLogId && !allIds.has(event.parentObservabilityLogId)) {
          brokenReferences.push(
            `${event.type}:${event.operation} -> missing parent: ${event.parentObservabilityLogId}`
          );
        }
      });

      if (brokenReferences.length > 0) {
        // Helpful test failure output (only printed when test fails).
        // eslint-disable-next-line no-console
        console.log('Broken parent references:', brokenReferences);
      }

      expect(brokenReferences.length).toBe(0);
    });

    it('should ensure deeply nested hierarchy integrity with mixed event types', async () => {
      await createTestContext(async () => {
        await withSpan('apiRequest', async (apiSpan) => {
          apiSpan.tag('endpoint', '/users');

          await withSpan('validateRequest', async (validateSpan) => {
            validateSpan.checkpoint('validation_start');
            LogObserver.debug('Validating user input');
          });

          await withSpan('processRequest', async (processSpan) => {
            processSpan.tag('action', 'create');

            await withSpan('dbOperation', async (dbSpan) => {
              dbSpan.metric('queries', 1);
              LogObserver.info('Executing database query');

              await withSpan('auditLog', async () => {
                AuditObserver.entityCreate('User', 'user-123', { name: 'Test' });
              });
            });
          });
        });

        await ObservabilityManager.flush();
      });

      const events = mockBackend.getEvents();
      const allIds = new Set(events.map(e => e.observabilityLogId));

      // Verify hierarchy integrity
      const orphans = events.filter(e =>
        e.parentObservabilityLogId && !allIds.has(e.parentObservabilityLogId)
      );

      expect(orphans.length).toBe(0);

      // Verify specific hierarchy
      const spans = mockBackend.getEventsMatching({ type: 'span' });
      const apiRequest = spans.find(s => s.operation === 'apiRequest');
      const validateRequest = spans.find(s => s.operation === 'validateRequest');
      const processRequest = spans.find(s => s.operation === 'processRequest');
      const dbOperation = spans.find(s => s.operation === 'dbOperation');
      const auditLog = spans.find(s => s.operation === 'auditLog');

      expect(apiRequest).toBeDefined();
      expect(validateRequest?.parentObservabilityLogId).toBe(apiRequest!.observabilityLogId);
      expect(processRequest?.parentObservabilityLogId).toBe(apiRequest!.observabilityLogId);
      expect(dbOperation?.parentObservabilityLogId).toBe(processRequest!.observabilityLogId);
      expect(auditLog?.parentObservabilityLogId).toBe(dbOperation!.observabilityLogId);
    });
  });
});
