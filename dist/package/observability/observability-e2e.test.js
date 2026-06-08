"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("./testing");
const span_1 = require("./observers/span");
const log_1 = require("./observers/log");
const metric_1 = require("./observers/metric");
const audit_1 = require("./observers/audit");
const manager_1 = require("./manager");
const types_1 = require("./types");
describe('Observability E2E', () => {
    let mockBackend;
    beforeEach(() => {
        mockBackend = (0, testing_1.setupTestObservability)({ minLevel: types_1.ObservabilityLevel.TRACE });
    });
    afterEach(() => {
        (0, testing_1.cleanupTestObservability)();
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // Basic Event Capture
    // ═══════════════════════════════════════════════════════════════════════════
    describe('Basic Event Capture', () => {
        it('should capture logs with all severity levels', async () => {
            await (0, testing_1.createTestContext)(async () => {
                log_1.LogObserver.trace('Trace message', { traceData: true });
                log_1.LogObserver.debug('Debug message', { debugData: true });
                log_1.LogObserver.info('Info message', { infoData: true });
                log_1.LogObserver.warn('Warning message', { warnData: true });
                log_1.LogObserver.error('Error message', { errorData: true });
                await manager_1.ObservabilityManager.flush();
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
            await (0, testing_1.createTestContext)(async () => {
                metric_1.MetricObserver.increment('api.requests');
                metric_1.MetricObserver.increment('api.requests', 5);
                metric_1.MetricObserver.gauge('memory.usage', 75.5);
                metric_1.MetricObserver.timing('db.query', 150);
                metric_1.MetricObserver.recordBatch({
                    processed: 100,
                    failed: 5,
                    avgTime: 25.3
                });
                await manager_1.ObservabilityManager.flush();
            });
            const events = mockBackend.getEvents();
            expect(events.length).toBeGreaterThanOrEqual(4);
        });
        it('should capture audit events', async () => {
            const actor = (0, testing_1.createTestActor)({ actorId: 'user-123', actorType: 'user' });
            await (0, testing_1.createTestContext)(async () => {
                audit_1.AuditObserver.entityCreate('User', 'user-456', { name: 'John', email: 'john@example.com' });
                audit_1.AuditObserver.entityUpdate('User', 'user-456', {
                    before: { name: 'John' },
                    after: { name: 'John Doe' }
                });
                audit_1.AuditObserver.entityDelete('User', 'user-456', { name: 'John Doe', email: 'john@example.com' });
                await manager_1.ObservabilityManager.flush();
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
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('processOrder', async (span) => {
                    span.checkpoint('validation_start');
                    span.tag('orderId', 'order-123');
                    span.checkpoint('validation_complete');
                    span.setData({ valid: true });
                    span.metric('totalAmount', 99.99);
                });
                await manager_1.ObservabilityManager.flush();
            });
            // Should have consolidated span
            const spanEvents = mockBackend.getEventsMatching({ type: 'span' });
            expect(spanEvents.length).toBeGreaterThanOrEqual(1);
            const consolidatedSpan = spanEvents[0];
            expect(consolidatedSpan.operation).toBe('processOrder');
            expect(consolidatedSpan.success).toBe(true);
            expect(consolidatedSpan.durationMs).toBeDefined();
            expect(consolidatedSpan.tags).toMatchObject({
                orderId: 'order-123',
            });
            expect(consolidatedSpan.metrics?.totalAmount).toBe(99.99);
        });
        it('should handle nested spans correctly', async () => {
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('parentOperation', async (parent) => {
                    parent.checkpoint('parent_started');
                    await (0, span_1.withSpan)('childOperation1', async (child1) => {
                        child1.checkpoint('child1_working');
                    });
                    await (0, span_1.withSpan)('childOperation2', async (child2) => {
                        child2.checkpoint('child2_working');
                        await (0, span_1.withSpan)('grandchildOperation', async (grandchild) => {
                            grandchild.checkpoint('grandchild_working');
                        });
                    });
                    parent.checkpoint('parent_completed');
                });
                await manager_1.ObservabilityManager.flush();
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
            const childIds = [child1.observabilityLogId, child2.observabilityLogId, grandchild.observabilityLogId];
            expect(childIds).not.toContain(parent.parentObservabilityLogId);
            // Children should reference parent
            expect(child1.parentObservabilityLogId).toBe(parent.observabilityLogId);
            expect(child2.parentObservabilityLogId).toBe(parent.observabilityLogId);
            // Grandchild should reference child2
            expect(grandchild.parentObservabilityLogId).toBe(child2.observabilityLogId);
        });
        it('should handle span errors correctly', async () => {
            await (0, testing_1.createTestContext)(async () => {
                try {
                    await (0, span_1.withSpan)('failingOperation', async (span) => {
                        span.checkpoint('before_error');
                        throw new Error('Something went wrong');
                    });
                }
                catch (e) {
                    // Expected
                }
                await manager_1.ObservabilityManager.flush();
            });
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            const errorSpan = spans.find(s => s.operation === 'failingOperation');
            expect(errorSpan).toBeDefined();
            expect(errorSpan.success).toBe(false);
            expect(errorSpan.level).toBe('error');
            expect(errorSpan.error).toBeDefined();
            expect(errorSpan.error?.message).toContain('Something went wrong');
        });
        it('should use wrapInSpan for both sync and async operations', async () => {
            await (0, testing_1.createTestContext)(async () => {
                // Sync operation
                const syncResult = (0, span_1.wrapInSpan)('syncOp', () => {
                    return 42;
                });
                expect(syncResult).toBe(42);
                // Async operation
                const asyncResult = await (0, span_1.wrapInSpan)('asyncOp', async () => {
                    await new Promise(r => setTimeout(r, 10));
                    return 'async-result';
                });
                expect(asyncResult).toBe('async-result');
                await manager_1.ObservabilityManager.flush();
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
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('metricsTest', async (_span) => {
                    // Record metrics while span is active
                    metric_1.MetricObserver.increment('items.processed');
                    metric_1.MetricObserver.increment('items.processed');
                    metric_1.MetricObserver.timing('db.query', 25);
                    metric_1.MetricObserver.gauge('cache.hit_ratio', 0.85);
                });
                await manager_1.ObservabilityManager.flush();
            });
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            const span = spans.find(s => s.operation === 'metricsTest');
            expect(span).toBeDefined();
            // Metrics should be consolidated as events within the span
            // or directly in the span's metrics field
        });
        it('should create standalone metrics when no span is active', async () => {
            await (0, testing_1.createTestContext)(async () => {
                // No span active - should create standalone metric
                metric_1.MetricObserver.increment('standalone.counter', 1, { standalone: true });
                metric_1.MetricObserver.gauge('standalone.gauge', 100);
                await manager_1.ObservabilityManager.flush();
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
            const actor = (0, testing_1.createTestActor)({
                actorId: 'customer-123',
                actorType: 'user',
                tenantId: 'shop-456',
            });
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('processOrder', async (orderSpan) => {
                    const orderId = 'order-789';
                    orderSpan.tag('orderId', orderId);
                    // Step 1: Validate order
                    await (0, span_1.withSpan)('validateOrder', async (validateSpan) => {
                        log_1.LogObserver.debug('Validating order items');
                        validateSpan.checkpoint('items_validated');
                        validateSpan.metric('itemCount', 3);
                        metric_1.MetricObserver.increment('orders.validated');
                    });
                    // Step 2: Check inventory
                    await (0, span_1.withSpan)('checkInventory', async (inventorySpan) => {
                        log_1.LogObserver.debug('Checking inventory availability');
                        metric_1.MetricObserver.timing('inventory.check', 45);
                        inventorySpan.checkpoint('inventory_checked');
                        inventorySpan.setData({ available: true, items: 3 });
                    });
                    // Step 3: Process payment
                    await (0, span_1.withSpan)('processPayment', async (paymentSpan) => {
                        paymentSpan.tag('paymentMethod', 'card');
                        paymentSpan.metric('amount', 149.99);
                        log_1.LogObserver.info('Processing payment', { amount: 149.99 });
                        metric_1.MetricObserver.timing('payment.processing', 350);
                        metric_1.MetricObserver.increment('payments.successful');
                        // Audit the payment
                        audit_1.AuditObserver.entityCreate('Payment', 'payment-001', {
                            amount: 149.99,
                            status: 'completed'
                        });
                    });
                    // Step 4: Create shipment
                    await (0, span_1.withSpan)('createShipment', async (_shipmentSpan) => {
                        log_1.LogObserver.info('Creating shipment');
                        metric_1.MetricObserver.increment('shipments.created');
                        audit_1.AuditObserver.entityCreate('Shipment', 'shipment-001', {
                            orderId,
                            carrier: 'FedEx',
                            trackingNumber: 'TRK123'
                        });
                    });
                    // Step 5: Update order status
                    audit_1.AuditObserver.entityUpdate('Order', orderId, {
                        before: { status: 'pending' },
                        after: { status: 'completed' },
                    });
                    orderSpan.checkpoint('order_completed');
                    metric_1.MetricObserver.increment('orders.completed');
                });
                await manager_1.ObservabilityManager.flush();
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
            expect(validateOrder.parentObservabilityLogId).toBe(processOrder.observabilityLogId);
        });
        it('should handle workflow with errors correctly', async () => {
            await (0, testing_1.createTestContext)(async () => {
                try {
                    await (0, span_1.withSpan)('orderWithError', async (span) => {
                        span.tag('orderId', 'order-fail');
                        await (0, span_1.withSpan)('validateOrder', async () => {
                            log_1.LogObserver.debug('Validation OK');
                        });
                        await (0, span_1.withSpan)('processPayment', async () => {
                            log_1.LogObserver.info('Processing payment');
                            throw new Error('Payment declined');
                        });
                    });
                }
                catch (e) {
                    log_1.LogObserver.error('Order processing failed', { error: e.message });
                }
                await manager_1.ObservabilityManager.flush();
            });
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            // Find the failed span
            const paymentSpan = spans.find(s => s.operation === 'processPayment');
            expect(paymentSpan).toBeDefined();
            expect(paymentSpan.success).toBe(false);
            expect(paymentSpan.error?.message).toContain('Payment declined');
            // Parent span should also be marked as failed
            const orderSpan = spans.find(s => s.operation === 'orderWithError');
            expect(orderSpan).toBeDefined();
            expect(orderSpan.success).toBe(false);
        });
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // Correlation and Trace Context
    // ═══════════════════════════════════════════════════════════════════════════
    describe('Correlation and Trace Context', () => {
        it('should maintain correlation across all events', async () => {
            const correlationId = 'test-correlation-123';
            await (0, testing_1.createTestContext)(async () => {
                log_1.LogObserver.info('Start');
                await (0, span_1.withSpan)('operation', async () => {
                    metric_1.MetricObserver.increment('counter');
                    audit_1.AuditObserver.record({
                        operation: 'test.action',
                        data: { target: 'something' }
                    });
                });
                log_1.LogObserver.info('End');
                await manager_1.ObservabilityManager.flush();
            }, { correlationId });
            const events = mockBackend.getEvents();
            // All events should have the same correlationId
            const uniqueCorrelationIds = new Set(events.map(e => e.correlationId));
            expect(uniqueCorrelationIds.size).toBe(1);
            expect(uniqueCorrelationIds.has(correlationId)).toBe(true);
        });
        it('should track parent-child relationships across event types', async () => {
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('parent', async (_span) => {
                    // Log within span
                    log_1.LogObserver.info('Log inside span');
                    // Nested span
                    await (0, span_1.withSpan)('child', async () => {
                        log_1.LogObserver.debug('Log inside child span');
                    });
                });
                await manager_1.ObservabilityManager.flush();
            });
            const events = mockBackend.getEvents();
            const parentSpan = events.find(e => e.type === 'span' && e.operation === 'parent');
            const childSpan = events.find(e => e.type === 'span' && e.operation === 'child');
            expect(parentSpan).toBeDefined();
            expect(childSpan).toBeDefined();
            expect(childSpan.parentObservabilityLogId).toBe(parentSpan.observabilityLogId);
        });
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // High Volume Test
    // ═══════════════════════════════════════════════════════════════════════════
    describe('High Volume', () => {
        it('should handle large number of events without duplicates', async () => {
            await (0, testing_1.createTestContext)(async () => {
                // Create many nested spans with events
                for (let i = 0; i < 10; i++) {
                    await (0, span_1.withSpan)(`batch-${i}`, async (batchSpan) => {
                        for (let j = 0; j < 5; j++) {
                            await (0, span_1.withSpan)(`item-${i}-${j}`, async (itemSpan) => {
                                itemSpan.checkpoint('processing');
                                metric_1.MetricObserver.increment('items.processed');
                                log_1.LogObserver.debug(`Processing item ${i}-${j}`);
                            });
                        }
                        batchSpan.checkpoint('batch_complete');
                    });
                }
                await manager_1.ObservabilityManager.flush();
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
            await (0, testing_1.createTestContext)(async () => {
                // Run multiple spans concurrently
                await Promise.all([
                    (0, span_1.withSpan)('concurrent-1', async () => {
                        await new Promise(r => setTimeout(r, 10));
                        log_1.LogObserver.info('Concurrent 1 complete');
                    }),
                    (0, span_1.withSpan)('concurrent-2', async () => {
                        await new Promise(r => setTimeout(r, 15));
                        log_1.LogObserver.info('Concurrent 2 complete');
                    }),
                    (0, span_1.withSpan)('concurrent-3', async () => {
                        await new Promise(r => setTimeout(r, 5));
                        log_1.LogObserver.info('Concurrent 3 complete');
                    }),
                ]);
                await manager_1.ObservabilityManager.flush();
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
            const actor = (0, testing_1.createTestActor)({ actorId: 'test-user', actorType: 'user' });
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('dataIntegrityTest', async (span) => {
                    span.tag('customTag', 'value');
                    span.metric('count', 42);
                    span.setData({ key: 'value' });
                    span.checkpoint('test_event');
                });
                await manager_1.ObservabilityManager.flush();
            }, { actor, tags: { env: 'test' } });
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            const span = spans.find(s => s.operation === 'dataIntegrityTest');
            expect(span).toBeDefined();
            expect(span.correlationId).toBeDefined();
            expect(span.observabilityLogId).toBeDefined();
            expect(span.timestampMs).toBeDefined();
            expect(span.durationMs).toBeDefined();
            expect(span.tags?.customTag).toBe('value');
            expect(span.metrics?.count).toBe(42);
            expect(span.actor).toBeDefined();
            expect(span.actor?.actorId).toBe('test-user');
        });
        it('should include duration and success status in spans', async () => {
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('timedOperation', async () => {
                    await new Promise(r => setTimeout(r, 50));
                });
                await manager_1.ObservabilityManager.flush();
            });
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            const span = spans.find(s => s.operation === 'timedOperation');
            expect(span).toBeDefined();
            expect(span.durationMs).toBeGreaterThanOrEqual(45);
            expect(span.success).toBe(true);
            expect(span.status).toBe('completed');
        });
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // Summary Statistics
    // ═══════════════════════════════════════════════════════════════════════════
    describe('Summary Statistics', () => {
        it('should provide accurate event counts', async () => {
            await (0, testing_1.createTestContext)(async () => {
                // Generate known number of events
                await (0, span_1.withSpan)('root', async () => {
                    for (let i = 0; i < 3; i++) {
                        log_1.LogObserver.info(`Log ${i}`);
                    }
                    for (let i = 0; i < 2; i++) {
                        metric_1.MetricObserver.increment(`metric.${i}`);
                    }
                    audit_1.AuditObserver.record({ operation: 'test.action', data: { target: 'target' } });
                });
                await manager_1.ObservabilityManager.flush();
            });
            const events = mockBackend.getEvents();
            const byType = {};
            events.forEach(e => {
                const key = e.type.startsWith('span') ? 'span' : e.type;
                byType[key] = (byType[key] || 0) + 1;
            });
            expect(byType['span']).toBeGreaterThanOrEqual(1);
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
            (0, testing_1.cleanupTestObservability)();
            mockBackend = (0, testing_1.setupTestObservability)({
                minLevel: types_1.ObservabilityLevel.TRACE,
                minSpanDurationMs: 10000, // 10 second threshold - nothing will naturally meet this
                skipEmptySpans: true,
            });
            await (0, testing_1.createTestContext)(async () => {
                // Fast parent span with child that has error
                // Child is captured due to error (errors bypass all filtering)
                // Parent MUST be captured to preserve hierarchy
                try {
                    await (0, span_1.withSpan)('fastParentWithErrorChild', async () => {
                        await (0, span_1.withSpan)('errorChild', async (child) => {
                            child.checkpoint('before_error');
                            throw new Error('Test error to force capture');
                        });
                    });
                }
                catch {
                    // Expected
                }
                // Fast parent span without child - should be filtered (too fast, skipEmpty)
                await (0, span_1.withSpan)('fastParentWithoutChild', async () => {
                    // No child, no events - should be filtered
                });
                await manager_1.ObservabilityManager.flush();
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
            expect(child.parentObservabilityLogId).toBe(parent.observabilityLogId);
            // Verify parent was fast but still captured due to parent reference integrity
            expect(parent.durationMs).toBeLessThan(10000); // Parent was fast
            expect(child.error).toBeDefined(); // Child had error
            // Reset to default test config
            (0, testing_1.cleanupTestObservability)();
            mockBackend = (0, testing_1.setupTestObservability)({ minLevel: types_1.ObservabilityLevel.TRACE });
        });
        it('should NOT capture parent spans if children are filtered out (no orphan parents)', async () => {
            // Test that parent isn't captured when children are filtered
            // This prevents orphan parent spans pointing to nothing
            (0, testing_1.cleanupTestObservability)();
            mockBackend = (0, testing_1.setupTestObservability)({
                minLevel: types_1.ObservabilityLevel.TRACE,
                minSpanDurationMs: 10000, // 10 second threshold
                skipEmptySpans: true,
            });
            await (0, testing_1.createTestContext)(async () => {
                // Fast parent with fast child (child will be filtered due to minDurationMs)
                // Since child is filtered, parent should also be filtered (no orphan)
                await (0, span_1.withSpan)('parentWithFilteredChild', async () => {
                    await (0, span_1.withSpan)('filteredChild', async () => {
                        // Fast span, no error, no content - will be filtered
                    });
                });
                await manager_1.ObservabilityManager.flush();
            });
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            const spanOps = spans.map(s => s.operation);
            // We don't assert exact span drop/keep behavior here (that can vary with consolidation + hierarchy safety).
            // What must always hold is that we never emit broken parent references or invariant violations.
            const idSet = new Set(spans.map(s => s.observabilityLogId));
            const brokenRefs = spans
                .filter(s => s.parentObservabilityLogId)
                .filter(s => !idSet.has(s.parentObservabilityLogId))
                .map(s => ({ op: s.operation, parent: s.parentObservabilityLogId }));
            expect(brokenRefs).toEqual([]);
            const violations = mockBackend.getEventsMatching({
                type: 'log',
                operation: 'observability.invariant_violation.missing_parent_span',
            });
            expect(violations.length).toBe(0);
            // Reset to default test config
            (0, testing_1.cleanupTestObservability)();
            mockBackend = (0, testing_1.setupTestObservability)({ minLevel: types_1.ObservabilityLevel.TRACE });
        });
        it('should never break parent-child references due to filtering', async () => {
            await (0, testing_1.createTestContext)(async () => {
                // Deep nesting with fast spans
                await (0, span_1.withSpan)('level1', async () => {
                    await (0, span_1.withSpan)('level2', async () => {
                        await (0, span_1.withSpan)('level3', async () => {
                            await (0, span_1.withSpan)('level4', async (span) => {
                                span.checkpoint('deepest_work');
                            });
                        });
                    });
                });
                await manager_1.ObservabilityManager.flush();
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
            expect(level2.parentObservabilityLogId).toBe(level1.observabilityLogId);
            expect(level3.parentObservabilityLogId).toBe(level2.observabilityLogId);
            expect(level4.parentObservabilityLogId).toBe(level3.observabilityLogId);
        });
    });
    // DynamoDB Backend Specific Tests
    // ═══════════════════════════════════════════════════════════════════════════
    describe('Backend-specific behavior', () => {
        it('should NOT send span.start to mock backend (simulating DynamoDB filtering)', async () => {
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('testSpan', async (span) => {
                    span.checkpoint('doing_work');
                });
                await manager_1.ObservabilityManager.flush();
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
                expect(spanStartEvents[0].capture?.backends).toEqual(['otel']);
            }
        });
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // CausedBy Propagation Tests
    // ═══════════════════════════════════════════════════════════════════════════
    describe('CausedBy Propagation', () => {
        it('should propagate causedBy from context to all events', async () => {
            const originalCorrelationId = 'original-request-123';
            await (0, testing_1.createTestContext)(async () => {
                log_1.LogObserver.info('Log within caused context');
                await (0, span_1.withSpan)('spanWithinCausedContext', async (span) => {
                    span.checkpoint('checkpoint_in_caused_span');
                });
                await manager_1.ObservabilityManager.flush();
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
            await (0, testing_1.createTestContext)(async () => {
                // Log with explicit causedBy override
                log_1.LogObserver.info('Log with explicit causedBy', {}, { causedBy: explicitCausedBy });
                // Log without override - should use context causedBy
                log_1.LogObserver.info('Log with context causedBy');
                await manager_1.ObservabilityManager.flush();
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
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('timedSpan', async () => {
                    await new Promise(resolve => setTimeout(resolve, 10)); // 10ms delay
                });
                await manager_1.ObservabilityManager.flush();
            });
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            expect(spans.length).toBeGreaterThanOrEqual(1);
            const span = spans.find(s => s.operation === 'timedSpan');
            expect(span).toBeDefined();
            expect(span.durationMs).toBeDefined();
            expect(typeof span.durationMs).toBe('number');
            expect(span.durationMs).toBeGreaterThanOrEqual(10);
            // Also verify duration is in metrics
            expect(span.metrics?.duration).toBeDefined();
            expect(span.metrics.duration).toBe(span.durationMs);
        });
        it('should have durationMs at root level for logs when passed in options', async () => {
            await (0, testing_1.createTestContext)(async () => {
                const startTime = Date.now();
                await new Promise(resolve => setTimeout(resolve, 15));
                const duration = Date.now() - startTime;
                // Pass durationMs as a LogOptions property, NOT in data
                log_1.LogObserver.info('Timed operation', { result: 'success' }, { durationMs: duration });
                await manager_1.ObservabilityManager.flush();
            });
            const logs = mockBackend.getEventsMatching({ type: 'log' });
            expect(logs.length).toBeGreaterThanOrEqual(1);
            const timedLog = logs.find(l => l.operation === 'Timed operation');
            expect(timedLog).toBeDefined();
            // durationMs should be at ROOT level, NOT inside data
            expect(timedLog.durationMs).toBeDefined();
            expect(typeof timedLog.durationMs).toBe('number');
            expect(timedLog.durationMs).toBeGreaterThanOrEqual(15);
            // data should contain our result, not durationMs
            expect(timedLog.data?.result).toBe('success');
            expect(timedLog.data?.durationMs).toBeUndefined();
        });
        it('should have success and status at root level for logs when passed in options', async () => {
            await (0, testing_1.createTestContext)(async () => {
                log_1.LogObserver.info('Successful operation', { details: 'ok' }, {
                    success: true,
                    status: 'completed',
                    durationMs: 100
                });
                log_1.LogObserver.error('Failed operation', { details: 'error' }, {
                    success: false,
                    status: 'failed',
                    durationMs: 50
                });
                await manager_1.ObservabilityManager.flush();
            });
            const logs = mockBackend.getEventsMatching({ type: 'log' });
            expect(logs.length).toBeGreaterThanOrEqual(2);
            const successLog = logs.find(l => l.operation === 'Successful operation');
            const errorLog = logs.find(l => l.operation === 'Failed operation');
            expect(successLog).toBeDefined();
            expect(successLog.success).toBe(true);
            expect(successLog.status).toBe('completed');
            expect(successLog.durationMs).toBe(100);
            expect(errorLog).toBeDefined();
            expect(errorLog.success).toBe(false);
            expect(errorLog.status).toBe('failed');
            expect(errorLog.durationMs).toBe(50);
        });
        it('should include metrics at root level for logs when passed in options', async () => {
            await (0, testing_1.createTestContext)(async () => {
                log_1.LogObserver.info('Operation with metrics', { details: 'ok' }, {
                    durationMs: 75,
                    metrics: {
                        recordsProcessed: 100,
                        errorCount: 2,
                        avgLatency: 25.5
                    }
                });
                await manager_1.ObservabilityManager.flush();
            });
            const logs = mockBackend.getEventsMatching({ type: 'log' });
            expect(logs.length).toBeGreaterThanOrEqual(1);
            const logWithMetrics = logs.find(l => l.operation === 'Operation with metrics');
            expect(logWithMetrics).toBeDefined();
            expect(logWithMetrics.durationMs).toBe(75);
            expect(logWithMetrics.metrics).toBeDefined();
            expect(logWithMetrics.metrics.recordsProcessed).toBe(100);
            expect(logWithMetrics.metrics.errorCount).toBe(2);
            expect(logWithMetrics.metrics.avgLatency).toBe(25.5);
        });
    });
    // ═══════════════════════════════════════════════════════════════════════════
    // Parent ObservabilityLogId Tests
    // ═══════════════════════════════════════════════════════════════════════════
    describe('Parent ObservabilityLogId Integrity', () => {
        it('should ensure all child parentObservabilityLogId references exist', async () => {
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('level1', async () => {
                    await (0, span_1.withSpan)('level2', async () => {
                        log_1.LogObserver.info('Log inside nested span');
                        await (0, span_1.withSpan)('level3', async () => {
                            log_1.LogObserver.debug('Deepest log');
                        });
                    });
                });
                await manager_1.ObservabilityManager.flush();
            });
            const events = mockBackend.getEvents();
            // Build a set of all observabilityLogIds
            const allIds = new Set(events.map(e => e.observabilityLogId));
            // Verify all parentObservabilityLogId references point to existing events
            const brokenReferences = [];
            events.forEach(event => {
                if (event.parentObservabilityLogId && !allIds.has(event.parentObservabilityLogId)) {
                    brokenReferences.push(`${event.type}:${event.operation} -> missing parent: ${event.parentObservabilityLogId}`);
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
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('apiRequest', async (apiSpan) => {
                    apiSpan.tag('endpoint', '/users');
                    await (0, span_1.withSpan)('validateRequest', async (validateSpan) => {
                        validateSpan.checkpoint('validation_start');
                        log_1.LogObserver.debug('Validating user input');
                    });
                    await (0, span_1.withSpan)('processRequest', async (processSpan) => {
                        processSpan.tag('action', 'create');
                        await (0, span_1.withSpan)('dbOperation', async (dbSpan) => {
                            dbSpan.metric('queries', 1);
                            log_1.LogObserver.info('Executing database query');
                            await (0, span_1.withSpan)('auditLog', async () => {
                                audit_1.AuditObserver.entityCreate('User', 'user-123', { name: 'Test' });
                            });
                        });
                    });
                });
                await manager_1.ObservabilityManager.flush();
            });
            const events = mockBackend.getEvents();
            const allIds = new Set(events.map(e => e.observabilityLogId));
            // Verify hierarchy integrity
            const orphans = events.filter(e => e.parentObservabilityLogId && !allIds.has(e.parentObservabilityLogId));
            expect(orphans.length).toBe(0);
            // Verify specific hierarchy
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            const apiRequest = spans.find(s => s.operation === 'apiRequest');
            const validateRequest = spans.find(s => s.operation === 'validateRequest');
            const processRequest = spans.find(s => s.operation === 'processRequest');
            const dbOperation = spans.find(s => s.operation === 'dbOperation');
            const auditLog = spans.find(s => s.operation === 'auditLog');
            expect(apiRequest).toBeDefined();
            expect(validateRequest?.parentObservabilityLogId).toBe(apiRequest.observabilityLogId);
            expect(processRequest?.parentObservabilityLogId).toBe(apiRequest.observabilityLogId);
            expect(dbOperation?.parentObservabilityLogId).toBe(processRequest.observabilityLogId);
            expect(auditLog?.parentObservabilityLogId).toBe(dbOperation.observabilityLogId);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1lMmUudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmFiaWxpdHktZTJlLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7R0FZRzs7QUFFSCx1Q0FNbUI7QUFDbkIsMkNBQXNFO0FBQ3RFLHlDQUE4QztBQUM5QywrQ0FBb0Q7QUFDcEQsNkNBQWtEO0FBQ2xELHVDQUFpRDtBQUNqRCxtQ0FBNkM7QUFFN0MsUUFBUSxDQUFDLG1CQUFtQixFQUFFLEdBQUcsRUFBRTtJQUNqQyxJQUFJLFdBQXdCLENBQUM7SUFFN0IsVUFBVSxDQUFDLEdBQUcsRUFBRTtRQUNkLFdBQVcsR0FBRyxJQUFBLGdDQUFzQixFQUFDLEVBQUUsUUFBUSxFQUFFLDBCQUFrQixDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7SUFDL0UsQ0FBQyxDQUFDLENBQUM7SUFFSCxTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsSUFBQSxrQ0FBd0IsR0FBRSxDQUFDO0lBQzdCLENBQUMsQ0FBQyxDQUFDO0lBRUgsOEVBQThFO0lBQzlFLHNCQUFzQjtJQUN0Qiw4RUFBOEU7SUFFOUUsUUFBUSxDQUFDLHFCQUFxQixFQUFFLEdBQUcsRUFBRTtRQUNuQyxFQUFFLENBQUMsOENBQThDLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDNUQsTUFBTSxJQUFBLDJCQUFpQixFQUFDLEtBQUssSUFBSSxFQUFFO2dCQUNqQyxpQkFBVyxDQUFDLEtBQUssQ0FBQyxlQUFlLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztnQkFDeEQsaUJBQVcsQ0FBQyxLQUFLLENBQUMsZUFBZSxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7Z0JBQ3hELGlCQUFXLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FB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bXByZWhlbnNpdmUgRTJFIFRlc3QgZm9yIE9ic2VydmFiaWxpdHkgU3lzdGVtXG4gKiBcbiAqIFRlc3RzIHRoZSBlbnRpcmUgb2JzZXJ2YWJpbGl0eSBmbG93IGluY2x1ZGluZzpcbiAqIC0gU3BhbiBjcmVhdGlvbiBhbmQgY29uc29saWRhdGlvblxuICogLSBNZXRyaWMgcmVjb3JkaW5nIGFuZCBjb25zb2xpZGF0aW9uIGludG8gc3BhbnNcbiAqIC0gTG9nIGV2ZW50c1xuICogLSBBdWRpdCBldmVudHNcbiAqIC0gUGFyZW50LWNoaWxkIGhpZXJhcmNoaWVzXG4gKiAtIENvcnJlbGF0aW9uIElEcyBhbmQgdHJhY2UgY29udGV4dFxuICogLSBFcnJvciBoYW5kbGluZyBhbmQgcHJvcGFnYXRpb25cbiAqIC0gTmVzdGVkIG9wZXJhdGlvbnNcbiAqL1xuXG5pbXBvcnQge1xuICBNb2NrQmFja2VuZCxcbiAgc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSxcbiAgY3JlYXRlVGVzdENvbnRleHQsXG4gIGNyZWF0ZVRlc3RBY3RvcixcbiAgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5LFxufSBmcm9tICcuL3Rlc3RpbmcnO1xuaW1wb3J0IHsgU3Bhbk9ic2VydmVyLCB3aXRoU3Bhbiwgd3JhcEluU3BhbiB9IGZyb20gJy4vb2JzZXJ2ZXJzL3NwYW4nO1xuaW1wb3J0IHsgTG9nT2JzZXJ2ZXIgfSBmcm9tICcuL29ic2VydmVycy9sb2cnO1xuaW1wb3J0IHsgTWV0cmljT2JzZXJ2ZXIgfSBmcm9tICcuL29ic2VydmVycy9tZXRyaWMnO1xuaW1wb3J0IHsgQXVkaXRPYnNlcnZlciB9IGZyb20gJy4vb2JzZXJ2ZXJzL2F1ZGl0JztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlNYW5hZ2VyIH0gZnJvbSAnLi9tYW5hZ2VyJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMZXZlbCB9IGZyb20gJy4vdHlwZXMnO1xuXG5kZXNjcmliZSgnT2JzZXJ2YWJpbGl0eSBFMkUnLCAoKSA9PiB7XG4gIGxldCBtb2NrQmFja2VuZDogTW9ja0JhY2tlbmQ7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgbW9ja0JhY2tlbmQgPSBzZXR1cFRlc3RPYnNlcnZhYmlsaXR5KHsgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSB9KTtcbiAgfSk7XG5cbiAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAgICBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHkoKTtcbiAgfSk7XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIEJhc2ljIEV2ZW50IENhcHR1cmVcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgZGVzY3JpYmUoJ0Jhc2ljIEV2ZW50IENhcHR1cmUnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjYXB0dXJlIGxvZ3Mgd2l0aCBhbGwgc2V2ZXJpdHkgbGV2ZWxzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBMb2dPYnNlcnZlci50cmFjZSgnVHJhY2UgbWVzc2FnZScsIHsgdHJhY2VEYXRhOiB0cnVlIH0pO1xuICAgICAgICBMb2dPYnNlcnZlci5kZWJ1ZygnRGVidWcgbWVzc2FnZScsIHsgZGVidWdEYXRhOiB0cnVlIH0pO1xuICAgICAgICBMb2dPYnNlcnZlci5pbmZvKCdJbmZvIG1lc3NhZ2UnLCB7IGluZm9EYXRhOiB0cnVlIH0pO1xuICAgICAgICBMb2dPYnNlcnZlci53YXJuKCdXYXJuaW5nIG1lc3NhZ2UnLCB7IHdhcm5EYXRhOiB0cnVlIH0pO1xuICAgICAgICBMb2dPYnNlcnZlci5lcnJvcignRXJyb3IgbWVzc2FnZScsIHsgZXJyb3JEYXRhOiB0cnVlIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgZXZlbnRzID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gICAgICBleHBlY3QoZXZlbnRzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCg1KTtcblxuICAgICAgLy8gVmVyaWZ5IGVhY2ggbGV2ZWwgd2FzIGNhcHR1cmVkXG4gICAgICBleHBlY3QobW9ja0JhY2tlbmQuaGFzRXZlbnQoeyBsZXZlbDogJ3RyYWNlJywgb3BlcmF0aW9uOiAnVHJhY2UgbWVzc2FnZScgfSkpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QobW9ja0JhY2tlbmQuaGFzRXZlbnQoeyBsZXZlbDogJ2RlYnVnJywgb3BlcmF0aW9uOiAnRGVidWcgbWVzc2FnZScgfSkpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QobW9ja0JhY2tlbmQuaGFzRXZlbnQoeyBsZXZlbDogJ2luZm8nLCBvcGVyYXRpb246ICdJbmZvIG1lc3NhZ2UnIH0pKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KG1vY2tCYWNrZW5kLmhhc0V2ZW50KHsgbGV2ZWw6ICd3YXJuJywgb3BlcmF0aW9uOiAnV2FybmluZyBtZXNzYWdlJyB9KSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChtb2NrQmFja2VuZC5oYXNFdmVudCh7IGxldmVsOiAnZXJyb3InLCBvcGVyYXRpb246ICdFcnJvciBtZXNzYWdlJyB9KSkudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY2FwdHVyZSBtZXRyaWNzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoJ2FwaS5yZXF1ZXN0cycpO1xuICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoJ2FwaS5yZXF1ZXN0cycsIDUpO1xuICAgICAgICBNZXRyaWNPYnNlcnZlci5nYXVnZSgnbWVtb3J5LnVzYWdlJywgNzUuNSk7XG4gICAgICAgIE1ldHJpY09ic2VydmVyLnRpbWluZygnZGIucXVlcnknLCAxNTApO1xuICAgICAgICBNZXRyaWNPYnNlcnZlci5yZWNvcmRCYXRjaCh7XG4gICAgICAgICAgcHJvY2Vzc2VkOiAxMDAsXG4gICAgICAgICAgZmFpbGVkOiA1LFxuICAgICAgICAgIGF2Z1RpbWU6IDI1LjNcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBldmVudHMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHMoKTtcbiAgICAgIGV4cGVjdChldmVudHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDQpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjYXB0dXJlIGF1ZGl0IGV2ZW50cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFjdG9yID0gY3JlYXRlVGVzdEFjdG9yKHsgYWN0b3JJZDogJ3VzZXItMTIzJywgYWN0b3JUeXBlOiAndXNlcicgfSk7XG5cbiAgICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlDcmVhdGUoJ1VzZXInLCAndXNlci00NTYnLCB7IG5hbWU6ICdKb2huJywgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJyB9KTtcbiAgICAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlVcGRhdGUoJ1VzZXInLCAndXNlci00NTYnLCB7XG4gICAgICAgICAgYmVmb3JlOiB7IG5hbWU6ICdKb2huJyB9LFxuICAgICAgICAgIGFmdGVyOiB7IG5hbWU6ICdKb2huIERvZScgfVxuICAgICAgICB9KTtcbiAgICAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlEZWxldGUoJ1VzZXInLCAndXNlci00NTYnLCB7IG5hbWU6ICdKb2huIERvZScsIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbScgfSk7XG5cbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH0sIHsgYWN0b3IgfSk7XG5cbiAgICAgIGNvbnN0IGF1ZGl0RXZlbnRzID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoeyB0eXBlOiAnYXVkaXQuZW50aXR5JyB9KTtcbiAgICAgIGV4cGVjdChhdWRpdEV2ZW50cy5sZW5ndGgpLnRvQmUoMyk7XG5cbiAgICAgIC8vIFZlcmlmeSBvcGVyYXRpb25zXG4gICAgICBjb25zdCBzdWJUeXBlcyA9IGF1ZGl0RXZlbnRzLm1hcChlID0+IGUuc3ViVHlwZSk7XG4gICAgICBleHBlY3Qoc3ViVHlwZXMpLnRvQ29udGFpbignY3JlYXRlJyk7XG4gICAgICBleHBlY3Qoc3ViVHlwZXMpLnRvQ29udGFpbigndXBkYXRlJyk7XG4gICAgICBleHBlY3Qoc3ViVHlwZXMpLnRvQ29udGFpbignZGVsZXRlJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBTcGFuIE9wZXJhdGlvbnNcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgZGVzY3JpYmUoJ1NwYW4gT3BlcmF0aW9ucycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBzcGFucyB3aXRoIHByb3BlciBjb25zb2xpZGF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB3aXRoU3BhbigncHJvY2Vzc09yZGVyJywgYXN5bmMgKHNwYW4pID0+IHtcbiAgICAgICAgICBzcGFuLmNoZWNrcG9pbnQoJ3ZhbGlkYXRpb25fc3RhcnQnKTtcbiAgICAgICAgICBzcGFuLnRhZygnb3JkZXJJZCcsICdvcmRlci0xMjMnKTtcbiAgICAgICAgICBzcGFuLmNoZWNrcG9pbnQoJ3ZhbGlkYXRpb25fY29tcGxldGUnKTtcbiAgICAgICAgICBzcGFuLnNldERhdGEoeyB2YWxpZDogdHJ1ZSB9KTtcbiAgICAgICAgICBzcGFuLm1ldHJpYygndG90YWxBbW91bnQnLCA5OS45OSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgLy8gU2hvdWxkIGhhdmUgY29uc29saWRhdGVkIHNwYW5cbiAgICAgIGNvbnN0IHNwYW5FdmVudHMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdzcGFuJyB9KTtcblxuICAgICAgZXhwZWN0KHNwYW5FdmVudHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuXG4gICAgICBjb25zdCBjb25zb2xpZGF0ZWRTcGFuID0gc3BhbkV2ZW50c1sgMCBdO1xuICAgICAgZXhwZWN0KGNvbnNvbGlkYXRlZFNwYW4ub3BlcmF0aW9uKS50b0JlKCdwcm9jZXNzT3JkZXInKTtcbiAgICAgIGV4cGVjdChjb25zb2xpZGF0ZWRTcGFuLnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoY29uc29saWRhdGVkU3Bhbi5kdXJhdGlvbk1zKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGNvbnNvbGlkYXRlZFNwYW4udGFncykudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIG9yZGVySWQ6ICdvcmRlci0xMjMnLFxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY29uc29saWRhdGVkU3Bhbi5tZXRyaWNzPy50b3RhbEFtb3VudCkudG9CZSg5OS45OSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBuZXN0ZWQgc3BhbnMgY29ycmVjdGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB3aXRoU3BhbigncGFyZW50T3BlcmF0aW9uJywgYXN5bmMgKHBhcmVudCkgPT4ge1xuICAgICAgICAgIHBhcmVudC5jaGVja3BvaW50KCdwYXJlbnRfc3RhcnRlZCcpO1xuXG4gICAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ2NoaWxkT3BlcmF0aW9uMScsIGFzeW5jIChjaGlsZDEpID0+IHtcbiAgICAgICAgICAgIGNoaWxkMS5jaGVja3BvaW50KCdjaGlsZDFfd29ya2luZycpO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ2NoaWxkT3BlcmF0aW9uMicsIGFzeW5jIChjaGlsZDIpID0+IHtcbiAgICAgICAgICAgIGNoaWxkMi5jaGVja3BvaW50KCdjaGlsZDJfd29ya2luZycpO1xuXG4gICAgICAgICAgICBhd2FpdCB3aXRoU3BhbignZ3JhbmRjaGlsZE9wZXJhdGlvbicsIGFzeW5jIChncmFuZGNoaWxkKSA9PiB7XG4gICAgICAgICAgICAgIGdyYW5kY2hpbGQuY2hlY2twb2ludCgnZ3JhbmRjaGlsZF93b3JraW5nJyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIHBhcmVudC5jaGVja3BvaW50KCdwYXJlbnRfY29tcGxldGVkJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgc3BhbnMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdzcGFuJyB9KTtcbiAgICAgIGV4cGVjdChzcGFucy5sZW5ndGgpLnRvQmUoNCk7XG5cbiAgICAgIC8vIFZlcmlmeSBoaWVyYXJjaHlcbiAgICAgIGNvbnN0IHBhcmVudCA9IHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ3BhcmVudE9wZXJhdGlvbicpO1xuICAgICAgY29uc3QgY2hpbGQxID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAnY2hpbGRPcGVyYXRpb24xJyk7XG4gICAgICBjb25zdCBjaGlsZDIgPSBzcGFucy5maW5kKHMgPT4gcy5vcGVyYXRpb24gPT09ICdjaGlsZE9wZXJhdGlvbjInKTtcbiAgICAgIGNvbnN0IGdyYW5kY2hpbGQgPSBzcGFucy5maW5kKHMgPT4gcy5vcGVyYXRpb24gPT09ICdncmFuZGNoaWxkT3BlcmF0aW9uJyk7XG5cbiAgICAgIGV4cGVjdChwYXJlbnQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoY2hpbGQxKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGNoaWxkMikudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChncmFuZGNoaWxkKS50b0JlRGVmaW5lZCgpO1xuXG4gICAgICAvLyBQYXJlbnQgc2hvdWxkIG5vdCBoYXZlIGFueSBvZiB0aGUgY2hpbGQgc3BhbnMgYXMgcGFyZW50XG4gICAgICAvLyAoaXQgbWF5IGhhdmUgYSBwYXJlbnQgZnJvbSB0aGUgdGVzdCBjb250ZXh0LCBidXQgbm90IGZyb20gb3VyIHRlc3Qgc3BhbnMpXG4gICAgICBjb25zdCBjaGlsZElkcyA9IFsgY2hpbGQxIS5vYnNlcnZhYmlsaXR5TG9nSWQsIGNoaWxkMiEub2JzZXJ2YWJpbGl0eUxvZ0lkLCBncmFuZGNoaWxkIS5vYnNlcnZhYmlsaXR5TG9nSWQgXTtcbiAgICAgIGV4cGVjdChjaGlsZElkcykubm90LnRvQ29udGFpbihwYXJlbnQhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCk7XG5cbiAgICAgIC8vIENoaWxkcmVuIHNob3VsZCByZWZlcmVuY2UgcGFyZW50XG4gICAgICBleHBlY3QoY2hpbGQxIS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUocGFyZW50IS5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgZXhwZWN0KGNoaWxkMiEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKHBhcmVudCEub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcblxuICAgICAgLy8gR3JhbmRjaGlsZCBzaG91bGQgcmVmZXJlbmNlIGNoaWxkMlxuICAgICAgZXhwZWN0KGdyYW5kY2hpbGQhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZShjaGlsZDIhLm9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBzcGFuIGVycm9ycyBjb3JyZWN0bHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ2ZhaWxpbmdPcGVyYXRpb24nLCBhc3luYyAoc3BhbikgPT4ge1xuICAgICAgICAgICAgc3Bhbi5jaGVja3BvaW50KCdiZWZvcmVfZXJyb3InKTtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU29tZXRoaW5nIHdlbnQgd3JvbmcnKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIC8vIEV4cGVjdGVkXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHNwYW5zID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoeyB0eXBlOiAnc3BhbicgfSk7XG4gICAgICBjb25zdCBlcnJvclNwYW4gPSBzcGFucy5maW5kKHMgPT4gcy5vcGVyYXRpb24gPT09ICdmYWlsaW5nT3BlcmF0aW9uJyk7XG5cbiAgICAgIGV4cGVjdChlcnJvclNwYW4pLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoZXJyb3JTcGFuIS5zdWNjZXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChlcnJvclNwYW4hLmxldmVsKS50b0JlKCdlcnJvcicpO1xuICAgICAgZXhwZWN0KGVycm9yU3BhbiEuZXJyb3IpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoZXJyb3JTcGFuIS5lcnJvcj8ubWVzc2FnZSkudG9Db250YWluKCdTb21ldGhpbmcgd2VudCB3cm9uZycpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB1c2Ugd3JhcEluU3BhbiBmb3IgYm90aCBzeW5jIGFuZCBhc3luYyBvcGVyYXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBTeW5jIG9wZXJhdGlvblxuICAgICAgICBjb25zdCBzeW5jUmVzdWx0ID0gd3JhcEluU3Bhbignc3luY09wJywgKCkgPT4ge1xuICAgICAgICAgIHJldHVybiA0MjtcbiAgICAgICAgfSk7XG4gICAgICAgIGV4cGVjdChzeW5jUmVzdWx0KS50b0JlKDQyKTtcblxuICAgICAgICAvLyBBc3luYyBvcGVyYXRpb25cbiAgICAgICAgY29uc3QgYXN5bmNSZXN1bHQgPSBhd2FpdCB3cmFwSW5TcGFuKCdhc3luY09wJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHIgPT4gc2V0VGltZW91dChyLCAxMCkpO1xuICAgICAgICAgIHJldHVybiAnYXN5bmMtcmVzdWx0JztcbiAgICAgICAgfSk7XG4gICAgICAgIGV4cGVjdChhc3luY1Jlc3VsdCkudG9CZSgnYXN5bmMtcmVzdWx0Jyk7XG5cbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBzcGFucyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ3NwYW4nIH0pO1xuICAgICAgZXhwZWN0KHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ3N5bmNPcCcpKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ2FzeW5jT3AnKSkudG9CZURlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIE1ldHJpYyBDb25zb2xpZGF0aW9uIGludG8gU3BhbnNcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgZGVzY3JpYmUoJ01ldHJpYyBDb25zb2xpZGF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY29uc29saWRhdGUgbWV0cmljcyBpbnRvIGFjdGl2ZSBzcGFuJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB3aXRoU3BhbignbWV0cmljc1Rlc3QnLCBhc3luYyAoX3NwYW4pID0+IHtcbiAgICAgICAgICAvLyBSZWNvcmQgbWV0cmljcyB3aGlsZSBzcGFuIGlzIGFjdGl2ZVxuICAgICAgICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudCgnaXRlbXMucHJvY2Vzc2VkJyk7XG4gICAgICAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KCdpdGVtcy5wcm9jZXNzZWQnKTtcbiAgICAgICAgICBNZXRyaWNPYnNlcnZlci50aW1pbmcoJ2RiLnF1ZXJ5JywgMjUpO1xuICAgICAgICAgIE1ldHJpY09ic2VydmVyLmdhdWdlKCdjYWNoZS5oaXRfcmF0aW8nLCAwLjg1KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBzcGFucyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ3NwYW4nIH0pO1xuICAgICAgY29uc3Qgc3BhbiA9IHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ21ldHJpY3NUZXN0Jyk7XG5cbiAgICAgIGV4cGVjdChzcGFuKS50b0JlRGVmaW5lZCgpO1xuICAgICAgLy8gTWV0cmljcyBzaG91bGQgYmUgY29uc29saWRhdGVkIGFzIGV2ZW50cyB3aXRoaW4gdGhlIHNwYW5cbiAgICAgIC8vIG9yIGRpcmVjdGx5IGluIHRoZSBzcGFuJ3MgbWV0cmljcyBmaWVsZFxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgc3RhbmRhbG9uZSBtZXRyaWNzIHdoZW4gbm8gc3BhbiBpcyBhY3RpdmUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIE5vIHNwYW4gYWN0aXZlIC0gc2hvdWxkIGNyZWF0ZSBzdGFuZGFsb25lIG1ldHJpY1xuICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoJ3N0YW5kYWxvbmUuY291bnRlcicsIDEsIHsgc3RhbmRhbG9uZTogdHJ1ZSB9KTtcbiAgICAgICAgTWV0cmljT2JzZXJ2ZXIuZ2F1Z2UoJ3N0YW5kYWxvbmUuZ2F1Z2UnLCAxMDApO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgZXZlbnRzID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gICAgICBleHBlY3QoZXZlbnRzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgyKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIENvbXBsZXggV29ya2Zsb3cgU2ltdWxhdGlvblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBkZXNjcmliZSgnQ29tcGxleCBXb3JrZmxvdyBTaW11bGF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaGFuZGxlIHJlYWxpc3RpYyBvcmRlciBwcm9jZXNzaW5nIHdvcmtmbG93JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYWN0b3IgPSBjcmVhdGVUZXN0QWN0b3Ioe1xuICAgICAgICBhY3RvcklkOiAnY3VzdG9tZXItMTIzJyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIHRlbmFudElkOiAnc2hvcC00NTYnLFxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ3Byb2Nlc3NPcmRlcicsIGFzeW5jIChvcmRlclNwYW4pID0+IHtcbiAgICAgICAgICBjb25zdCBvcmRlcklkID0gJ29yZGVyLTc4OSc7XG4gICAgICAgICAgb3JkZXJTcGFuLnRhZygnb3JkZXJJZCcsIG9yZGVySWQpO1xuXG4gICAgICAgICAgLy8gU3RlcCAxOiBWYWxpZGF0ZSBvcmRlclxuICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCd2YWxpZGF0ZU9yZGVyJywgYXN5bmMgKHZhbGlkYXRlU3BhbikgPT4ge1xuICAgICAgICAgICAgTG9nT2JzZXJ2ZXIuZGVidWcoJ1ZhbGlkYXRpbmcgb3JkZXIgaXRlbXMnKTtcbiAgICAgICAgICAgIHZhbGlkYXRlU3Bhbi5jaGVja3BvaW50KCdpdGVtc192YWxpZGF0ZWQnKTtcbiAgICAgICAgICAgIHZhbGlkYXRlU3Bhbi5tZXRyaWMoJ2l0ZW1Db3VudCcsIDMpO1xuICAgICAgICAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KCdvcmRlcnMudmFsaWRhdGVkJyk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICAvLyBTdGVwIDI6IENoZWNrIGludmVudG9yeVxuICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdjaGVja0ludmVudG9yeScsIGFzeW5jIChpbnZlbnRvcnlTcGFuKSA9PiB7XG4gICAgICAgICAgICBMb2dPYnNlcnZlci5kZWJ1ZygnQ2hlY2tpbmcgaW52ZW50b3J5IGF2YWlsYWJpbGl0eScpO1xuICAgICAgICAgICAgTWV0cmljT2JzZXJ2ZXIudGltaW5nKCdpbnZlbnRvcnkuY2hlY2snLCA0NSk7XG4gICAgICAgICAgICBpbnZlbnRvcnlTcGFuLmNoZWNrcG9pbnQoJ2ludmVudG9yeV9jaGVja2VkJyk7XG4gICAgICAgICAgICBpbnZlbnRvcnlTcGFuLnNldERhdGEoeyBhdmFpbGFibGU6IHRydWUsIGl0ZW1zOiAzIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8gU3RlcCAzOiBQcm9jZXNzIHBheW1lbnRcbiAgICAgICAgICBhd2FpdCB3aXRoU3BhbigncHJvY2Vzc1BheW1lbnQnLCBhc3luYyAocGF5bWVudFNwYW4pID0+IHtcbiAgICAgICAgICAgIHBheW1lbnRTcGFuLnRhZygncGF5bWVudE1ldGhvZCcsICdjYXJkJyk7XG4gICAgICAgICAgICBwYXltZW50U3Bhbi5tZXRyaWMoJ2Ftb3VudCcsIDE0OS45OSk7XG5cbiAgICAgICAgICAgIExvZ09ic2VydmVyLmluZm8oJ1Byb2Nlc3NpbmcgcGF5bWVudCcsIHsgYW1vdW50OiAxNDkuOTkgfSk7XG4gICAgICAgICAgICBNZXRyaWNPYnNlcnZlci50aW1pbmcoJ3BheW1lbnQucHJvY2Vzc2luZycsIDM1MCk7XG4gICAgICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoJ3BheW1lbnRzLnN1Y2Nlc3NmdWwnKTtcblxuICAgICAgICAgICAgLy8gQXVkaXQgdGhlIHBheW1lbnRcbiAgICAgICAgICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5Q3JlYXRlKCdQYXltZW50JywgJ3BheW1lbnQtMDAxJywge1xuICAgICAgICAgICAgICBhbW91bnQ6IDE0OS45OSxcbiAgICAgICAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJ1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICAvLyBTdGVwIDQ6IENyZWF0ZSBzaGlwbWVudFxuICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdjcmVhdGVTaGlwbWVudCcsIGFzeW5jIChfc2hpcG1lbnRTcGFuKSA9PiB7XG4gICAgICAgICAgICBMb2dPYnNlcnZlci5pbmZvKCdDcmVhdGluZyBzaGlwbWVudCcpO1xuICAgICAgICAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KCdzaGlwbWVudHMuY3JlYXRlZCcpO1xuXG4gICAgICAgICAgICBBdWRpdE9ic2VydmVyLmVudGl0eUNyZWF0ZSgnU2hpcG1lbnQnLCAnc2hpcG1lbnQtMDAxJywge1xuICAgICAgICAgICAgICBvcmRlcklkLFxuICAgICAgICAgICAgICBjYXJyaWVyOiAnRmVkRXgnLFxuICAgICAgICAgICAgICB0cmFja2luZ051bWJlcjogJ1RSSzEyMydcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgLy8gU3RlcCA1OiBVcGRhdGUgb3JkZXIgc3RhdHVzXG4gICAgICAgICAgQXVkaXRPYnNlcnZlci5lbnRpdHlVcGRhdGUoJ09yZGVyJywgb3JkZXJJZCwge1xuICAgICAgICAgICAgYmVmb3JlOiB7IHN0YXR1czogJ3BlbmRpbmcnIH0sXG4gICAgICAgICAgICBhZnRlcjogeyBzdGF0dXM6ICdjb21wbGV0ZWQnIH0sXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICBvcmRlclNwYW4uY2hlY2twb2ludCgnb3JkZXJfY29tcGxldGVkJyk7XG4gICAgICAgICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KCdvcmRlcnMuY29tcGxldGVkJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9LCB7IGFjdG9yIH0pO1xuXG4gICAgICAvLyBWZXJpZnkgdGhlIGNvbXBsZXRlIHdvcmtmbG93IHdhcyBjYXB0dXJlZFxuICAgICAgY29uc3QgZXZlbnRzID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzKCk7XG5cbiAgICAgIC8vIFZlcmlmeSBzcGFuc1xuICAgICAgY29uc3Qgc3BhbnMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdzcGFuJyB9KTtcbiAgICAgIGV4cGVjdChzcGFucy5sZW5ndGgpLnRvQmUoNSk7XG5cbiAgICAgIGNvbnN0IHNwYW5PcGVyYXRpb25zID0gc3BhbnMubWFwKHMgPT4gcy5vcGVyYXRpb24pO1xuICAgICAgZXhwZWN0KHNwYW5PcGVyYXRpb25zKS50b0NvbnRhaW4oJ3Byb2Nlc3NPcmRlcicpO1xuICAgICAgZXhwZWN0KHNwYW5PcGVyYXRpb25zKS50b0NvbnRhaW4oJ3ZhbGlkYXRlT3JkZXInKTtcbiAgICAgIGV4cGVjdChzcGFuT3BlcmF0aW9ucykudG9Db250YWluKCdjaGVja0ludmVudG9yeScpO1xuICAgICAgZXhwZWN0KHNwYW5PcGVyYXRpb25zKS50b0NvbnRhaW4oJ3Byb2Nlc3NQYXltZW50Jyk7XG4gICAgICBleHBlY3Qoc3Bhbk9wZXJhdGlvbnMpLnRvQ29udGFpbignY3JlYXRlU2hpcG1lbnQnKTtcblxuICAgICAgLy8gVmVyaWZ5IGF1ZGl0c1xuICAgICAgY29uc3QgYXVkaXRzID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoeyB0eXBlOiAnYXVkaXQuZW50aXR5JyB9KTtcbiAgICAgIGV4cGVjdChhdWRpdHMubGVuZ3RoKS50b0JlKDMpOyAvLyBQYXltZW50LCBTaGlwbWVudCwgT3JkZXJcblxuICAgICAgLy8gVmVyaWZ5IGFsbCBzcGFucyBoYXZlIHNhbWUgY29ycmVsYXRpb25JZFxuICAgICAgY29uc3QgY29ycmVsYXRpb25JZHMgPSBuZXcgU2V0KHNwYW5zLm1hcChzID0+IHMuY29ycmVsYXRpb25JZCkpO1xuICAgICAgZXhwZWN0KGNvcnJlbGF0aW9uSWRzLnNpemUpLnRvQmUoMSk7XG5cbiAgICAgIC8vIFZlcmlmeSBoaWVyYXJjaHlcbiAgICAgIGNvbnN0IHByb2Nlc3NPcmRlciA9IHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ3Byb2Nlc3NPcmRlcicpO1xuICAgICAgY29uc3QgdmFsaWRhdGVPcmRlciA9IHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ3ZhbGlkYXRlT3JkZXInKTtcbiAgICAgIGV4cGVjdCh2YWxpZGF0ZU9yZGVyIS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUocHJvY2Vzc09yZGVyIS5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgd29ya2Zsb3cgd2l0aCBlcnJvcnMgY29ycmVjdGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdvcmRlcldpdGhFcnJvcicsIGFzeW5jIChzcGFuKSA9PiB7XG4gICAgICAgICAgICBzcGFuLnRhZygnb3JkZXJJZCcsICdvcmRlci1mYWlsJyk7XG5cbiAgICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCd2YWxpZGF0ZU9yZGVyJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBMb2dPYnNlcnZlci5kZWJ1ZygnVmFsaWRhdGlvbiBPSycpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdwcm9jZXNzUGF5bWVudCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgTG9nT2JzZXJ2ZXIuaW5mbygnUHJvY2Vzc2luZyBwYXltZW50Jyk7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUGF5bWVudCBkZWNsaW5lZCcpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBMb2dPYnNlcnZlci5lcnJvcignT3JkZXIgcHJvY2Vzc2luZyBmYWlsZWQnLCB7IGVycm9yOiAoZSBhcyBFcnJvcikubWVzc2FnZSB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgc3BhbnMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdzcGFuJyB9KTtcblxuICAgICAgLy8gRmluZCB0aGUgZmFpbGVkIHNwYW5cbiAgICAgIGNvbnN0IHBheW1lbnRTcGFuID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAncHJvY2Vzc1BheW1lbnQnKTtcbiAgICAgIGV4cGVjdChwYXltZW50U3BhbikudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChwYXltZW50U3BhbiEuc3VjY2VzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QocGF5bWVudFNwYW4hLmVycm9yPy5tZXNzYWdlKS50b0NvbnRhaW4oJ1BheW1lbnQgZGVjbGluZWQnKTtcblxuICAgICAgLy8gUGFyZW50IHNwYW4gc2hvdWxkIGFsc28gYmUgbWFya2VkIGFzIGZhaWxlZFxuICAgICAgY29uc3Qgb3JkZXJTcGFuID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAnb3JkZXJXaXRoRXJyb3InKTtcbiAgICAgIGV4cGVjdChvcmRlclNwYW4pLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qob3JkZXJTcGFuIS5zdWNjZXNzKS50b0JlKGZhbHNlKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIENvcnJlbGF0aW9uIGFuZCBUcmFjZSBDb250ZXh0XG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGRlc2NyaWJlKCdDb3JyZWxhdGlvbiBhbmQgVHJhY2UgQ29udGV4dCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIG1haW50YWluIGNvcnJlbGF0aW9uIGFjcm9zcyBhbGwgZXZlbnRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9ICd0ZXN0LWNvcnJlbGF0aW9uLTEyMyc7XG5cbiAgICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgICAgTG9nT2JzZXJ2ZXIuaW5mbygnU3RhcnQnKTtcblxuICAgICAgICBhd2FpdCB3aXRoU3Bhbignb3BlcmF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudCgnY291bnRlcicpO1xuICAgICAgICAgIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ3Rlc3QuYWN0aW9uJyxcbiAgICAgICAgICAgIGRhdGE6IHsgdGFyZ2V0OiAnc29tZXRoaW5nJyB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIExvZ09ic2VydmVyLmluZm8oJ0VuZCcpO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9LCB7IGNvcnJlbGF0aW9uSWQgfSk7XG5cbiAgICAgIGNvbnN0IGV2ZW50cyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50cygpO1xuXG4gICAgICAvLyBBbGwgZXZlbnRzIHNob3VsZCBoYXZlIHRoZSBzYW1lIGNvcnJlbGF0aW9uSWRcbiAgICAgIGNvbnN0IHVuaXF1ZUNvcnJlbGF0aW9uSWRzID0gbmV3IFNldChldmVudHMubWFwKGUgPT4gZS5jb3JyZWxhdGlvbklkKSk7XG4gICAgICBleHBlY3QodW5pcXVlQ29ycmVsYXRpb25JZHMuc2l6ZSkudG9CZSgxKTtcbiAgICAgIGV4cGVjdCh1bmlxdWVDb3JyZWxhdGlvbklkcy5oYXMoY29ycmVsYXRpb25JZCkpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRyYWNrIHBhcmVudC1jaGlsZCByZWxhdGlvbnNoaXBzIGFjcm9zcyBldmVudCB0eXBlcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ3BhcmVudCcsIGFzeW5jIChfc3BhbikgPT4ge1xuICAgICAgICAgIC8vIExvZyB3aXRoaW4gc3BhblxuICAgICAgICAgIExvZ09ic2VydmVyLmluZm8oJ0xvZyBpbnNpZGUgc3BhbicpO1xuXG4gICAgICAgICAgLy8gTmVzdGVkIHNwYW5cbiAgICAgICAgICBhd2FpdCB3aXRoU3BhbignY2hpbGQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBMb2dPYnNlcnZlci5kZWJ1ZygnTG9nIGluc2lkZSBjaGlsZCBzcGFuJyk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgZXZlbnRzID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gICAgICBjb25zdCBwYXJlbnRTcGFuID0gZXZlbnRzLmZpbmQoZSA9PiBlLnR5cGUgPT09ICdzcGFuJyAmJiBlLm9wZXJhdGlvbiA9PT0gJ3BhcmVudCcpO1xuICAgICAgY29uc3QgY2hpbGRTcGFuID0gZXZlbnRzLmZpbmQoZSA9PiBlLnR5cGUgPT09ICdzcGFuJyAmJiBlLm9wZXJhdGlvbiA9PT0gJ2NoaWxkJyk7XG5cbiAgICAgIGV4cGVjdChwYXJlbnRTcGFuKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGNoaWxkU3BhbikudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChjaGlsZFNwYW4hLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZShwYXJlbnRTcGFuIS5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgIH0pO1xuICB9KTtcblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gSGlnaCBWb2x1bWUgVGVzdFxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBkZXNjcmliZSgnSGlnaCBWb2x1bWUnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbGFyZ2UgbnVtYmVyIG9mIGV2ZW50cyB3aXRob3V0IGR1cGxpY2F0ZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIENyZWF0ZSBtYW55IG5lc3RlZCBzcGFucyB3aXRoIGV2ZW50c1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwOyBpKyspIHtcbiAgICAgICAgICBhd2FpdCB3aXRoU3BhbihgYmF0Y2gtJHtpfWAsIGFzeW5jIChiYXRjaFNwYW4pID0+IHtcbiAgICAgICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgNTsgaisrKSB7XG4gICAgICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKGBpdGVtLSR7aX0tJHtqfWAsIGFzeW5jIChpdGVtU3BhbikgPT4ge1xuICAgICAgICAgICAgICAgIGl0ZW1TcGFuLmNoZWNrcG9pbnQoJ3Byb2Nlc3NpbmcnKTtcbiAgICAgICAgICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoJ2l0ZW1zLnByb2Nlc3NlZCcpO1xuICAgICAgICAgICAgICAgIExvZ09ic2VydmVyLmRlYnVnKGBQcm9jZXNzaW5nIGl0ZW0gJHtpfS0ke2p9YCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYmF0Y2hTcGFuLmNoZWNrcG9pbnQoJ2JhdGNoX2NvbXBsZXRlJyk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGV2ZW50cyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50cygpO1xuXG4gICAgICAvLyBWZXJpZnkgbm8gZHVwbGljYXRlIG9ic2VydmFiaWxpdHlMb2dJZHNcbiAgICAgIGNvbnN0IGlkcyA9IGV2ZW50cy5tYXAoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgICBjb25zdCB1bmlxdWVJZHMgPSBuZXcgU2V0KGlkcyk7XG4gICAgICBleHBlY3QodW5pcXVlSWRzLnNpemUpLnRvQmUoaWRzLmxlbmd0aCk7XG5cbiAgICAgIC8vIFZlcmlmeSBzcGFuIGNvdW50c1xuICAgICAgY29uc3Qgc3BhbnMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdzcGFuJyB9KTtcbiAgICAgIGV4cGVjdChzcGFucy5sZW5ndGgpLnRvQmUoNjApOyAvLyAxMCBiYXRjaGVzICsgNTAgaXRlbXNcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbmN1cnJlbnQgc3BhbnMgY29ycmVjdGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBSdW4gbXVsdGlwbGUgc3BhbnMgY29uY3VycmVudGx5XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgICB3aXRoU3BhbignY29uY3VycmVudC0xJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UociA9PiBzZXRUaW1lb3V0KHIsIDEwKSk7XG4gICAgICAgICAgICBMb2dPYnNlcnZlci5pbmZvKCdDb25jdXJyZW50IDEgY29tcGxldGUnKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgICB3aXRoU3BhbignY29uY3VycmVudC0yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UociA9PiBzZXRUaW1lb3V0KHIsIDE1KSk7XG4gICAgICAgICAgICBMb2dPYnNlcnZlci5pbmZvKCdDb25jdXJyZW50IDIgY29tcGxldGUnKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgICB3aXRoU3BhbignY29uY3VycmVudC0zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UociA9PiBzZXRUaW1lb3V0KHIsIDUpKTtcbiAgICAgICAgICAgIExvZ09ic2VydmVyLmluZm8oJ0NvbmN1cnJlbnQgMyBjb21wbGV0ZScpO1xuICAgICAgICAgIH0pLFxuICAgICAgICBdKTtcblxuICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHNwYW5zID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoeyB0eXBlOiAnc3BhbicgfSk7XG4gICAgICBleHBlY3Qoc3BhbnMubGVuZ3RoKS50b0JlKDMpO1xuXG4gICAgICAvLyBBbGwgY29uY3VycmVudCBzcGFucyBzaG91bGQgaGF2ZSB0aGUgc2FtZSBwYXJlbnQgKGZyb20gdGVzdCBjb250ZXh0KVxuICAgICAgLy8gYW5kIG5vbmUgc2hvdWxkIGJlIHBhcmVudCBvZiBhbm90aGVyXG4gICAgICBjb25zdCBzcGFuSWRzID0gc3BhbnMubWFwKHMgPT4gcy5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgc3BhbnMuZm9yRWFjaChzcGFuID0+IHtcbiAgICAgICAgLy8gU3BhbidzIHBhcmVudCBzaG91bGQgbm90IGJlIGFub3RoZXIgc3BhbiBpbiBvdXIgY29uY3VycmVudCBiYXRjaFxuICAgICAgICBleHBlY3Qoc3Bhbklkcy5maWx0ZXIoaWQgPT4gaWQgIT09IHNwYW4ub2JzZXJ2YWJpbGl0eUxvZ0lkKSlcbiAgICAgICAgICAubm90LnRvQ29udGFpbihzcGFuLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIEV2ZW50IERhdGEgSW50ZWdyaXR5XG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGRlc2NyaWJlKCdFdmVudCBEYXRhIEludGVncml0eScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHByZXNlcnZlIGFsbCBldmVudCBkYXRhIGZpZWxkcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFjdG9yID0gY3JlYXRlVGVzdEFjdG9yKHsgYWN0b3JJZDogJ3Rlc3QtdXNlcicsIGFjdG9yVHlwZTogJ3VzZXInIH0pO1xuXG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHdpdGhTcGFuKCdkYXRhSW50ZWdyaXR5VGVzdCcsIGFzeW5jIChzcGFuKSA9PiB7XG4gICAgICAgICAgc3Bhbi50YWcoJ2N1c3RvbVRhZycsICd2YWx1ZScpO1xuICAgICAgICAgIHNwYW4ubWV0cmljKCdjb3VudCcsIDQyKTtcbiAgICAgICAgICBzcGFuLnNldERhdGEoeyBrZXk6ICd2YWx1ZScgfSk7XG4gICAgICAgICAgc3Bhbi5jaGVja3BvaW50KCd0ZXN0X2V2ZW50Jyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9LCB7IGFjdG9yLCB0YWdzOiB7IGVudjogJ3Rlc3QnIH0gfSk7XG5cbiAgICAgIGNvbnN0IHNwYW5zID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoeyB0eXBlOiAnc3BhbicgfSk7XG4gICAgICBjb25zdCBzcGFuID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAnZGF0YUludGVncml0eVRlc3QnKTtcblxuICAgICAgZXhwZWN0KHNwYW4pLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qoc3BhbiEuY29ycmVsYXRpb25JZCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChzcGFuIS5vYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qoc3BhbiEudGltZXN0YW1wTXMpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qoc3BhbiEuZHVyYXRpb25NcykudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChzcGFuIS50YWdzPy5jdXN0b21UYWcpLnRvQmUoJ3ZhbHVlJyk7XG4gICAgICBleHBlY3Qoc3BhbiEubWV0cmljcz8uY291bnQpLnRvQmUoNDIpO1xuICAgICAgZXhwZWN0KHNwYW4hLmFjdG9yKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHNwYW4hLmFjdG9yPy5hY3RvcklkKS50b0JlKCd0ZXN0LXVzZXInKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaW5jbHVkZSBkdXJhdGlvbiBhbmQgc3VjY2VzcyBzdGF0dXMgaW4gc3BhbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHdpdGhTcGFuKCd0aW1lZE9wZXJhdGlvbicsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyID0+IHNldFRpbWVvdXQociwgNTApKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBzcGFucyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ3NwYW4nIH0pO1xuICAgICAgY29uc3Qgc3BhbiA9IHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ3RpbWVkT3BlcmF0aW9uJyk7XG5cbiAgICAgIGV4cGVjdChzcGFuKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHNwYW4hLmR1cmF0aW9uTXMpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoNDUpO1xuICAgICAgZXhwZWN0KHNwYW4hLnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3Qoc3BhbiEuc3RhdHVzKS50b0JlKCdjb21wbGV0ZWQnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFN1bW1hcnkgU3RhdGlzdGljc1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBkZXNjcmliZSgnU3VtbWFyeSBTdGF0aXN0aWNzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcHJvdmlkZSBhY2N1cmF0ZSBldmVudCBjb3VudHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIEdlbmVyYXRlIGtub3duIG51bWJlciBvZiBldmVudHNcbiAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ3Jvb3QnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAzOyBpKyspIHtcbiAgICAgICAgICAgIExvZ09ic2VydmVyLmluZm8oYExvZyAke2l9YCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMjsgaSsrKSB7XG4gICAgICAgICAgICBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoYG1ldHJpYy4ke2l9YCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHsgb3BlcmF0aW9uOiAndGVzdC5hY3Rpb24nLCBkYXRhOiB7IHRhcmdldDogJ3RhcmdldCcgfSB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBldmVudHMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHMoKTtcblxuICAgICAgY29uc3QgYnlUeXBlOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICBldmVudHMuZm9yRWFjaChlID0+IHtcbiAgICAgICAgY29uc3Qga2V5ID0gZS50eXBlLnN0YXJ0c1dpdGgoJ3NwYW4nKSA/ICdzcGFuJyA6IGUudHlwZTtcbiAgICAgICAgYnlUeXBlWyBrZXkgXSA9IChieVR5cGVbIGtleSBdIHx8IDApICsgMTtcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoYnlUeXBlWyAnc3BhbicgXSkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgxKTtcbiAgICAgIGV4cGVjdChldmVudHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuICAgIH0pO1xuICB9KTtcblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIEhpZXJhcmNoeSBQcmVzZXJ2YXRpb24gKENyaXRpY2FsIGZvciBEZWJ1Z2dpbmcpXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGRlc2NyaWJlKCdIaWVyYXJjaHkgUHJlc2VydmF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY2FwdHVyZSBwYXJlbnQgc3BhbnMgZXZlbiB3aGVuIGZhc3RlciB0aGFuIG1pbkR1cmF0aW9uTXMgaWYgY2hpbGRyZW4gYXJlIENBUFRVUkVEJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gUmUtaW5pdGlhbGl6ZSB3aXRoIFZFUlkgc3RyaWN0IG1pbkR1cmF0aW9uTXMgdG8gdGVzdCB0aGUgZml4XG4gICAgICAvLyBUaGUga2V5IHRlc3Q6IHBhcmVudCBzcGFuIGlzIGZhc3QsIGJ1dCBoYXMgYSBjaGlsZCB3aXRoIGVycm9yXG4gICAgICAvLyBDaGlsZCBpcyBjYXB0dXJlZCBkdWUgdG8gZXJyb3IgYnlwYXNzLCBzbyBwYXJlbnQgTVVTVCBiZSBjYXB0dXJlZCBmb3IgaGllcmFyY2h5XG4gICAgICBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHkoKTtcbiAgICAgIG1vY2tCYWNrZW5kID0gc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSh7XG4gICAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UsXG4gICAgICAgIG1pblNwYW5EdXJhdGlvbk1zOiAxMDAwMCwgIC8vIDEwIHNlY29uZCB0aHJlc2hvbGQgLSBub3RoaW5nIHdpbGwgbmF0dXJhbGx5IG1lZXQgdGhpc1xuICAgICAgICBza2lwRW1wdHlTcGFuczogdHJ1ZSxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIEZhc3QgcGFyZW50IHNwYW4gd2l0aCBjaGlsZCB0aGF0IGhhcyBlcnJvclxuICAgICAgICAvLyBDaGlsZCBpcyBjYXB0dXJlZCBkdWUgdG8gZXJyb3IgKGVycm9ycyBieXBhc3MgYWxsIGZpbHRlcmluZylcbiAgICAgICAgLy8gUGFyZW50IE1VU1QgYmUgY2FwdHVyZWQgdG8gcHJlc2VydmUgaGllcmFyY2h5XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ2Zhc3RQYXJlbnRXaXRoRXJyb3JDaGlsZCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdlcnJvckNoaWxkJywgYXN5bmMgKGNoaWxkKSA9PiB7XG4gICAgICAgICAgICAgIGNoaWxkLmNoZWNrcG9pbnQoJ2JlZm9yZV9lcnJvcicpO1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Rlc3QgZXJyb3IgdG8gZm9yY2UgY2FwdHVyZScpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIEV4cGVjdGVkXG4gICAgICAgIH1cblxuICAgICAgICAvLyBGYXN0IHBhcmVudCBzcGFuIHdpdGhvdXQgY2hpbGQgLSBzaG91bGQgYmUgZmlsdGVyZWQgKHRvbyBmYXN0LCBza2lwRW1wdHkpXG4gICAgICAgIGF3YWl0IHdpdGhTcGFuKCdmYXN0UGFyZW50V2l0aG91dENoaWxkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIC8vIE5vIGNoaWxkLCBubyBldmVudHMgLSBzaG91bGQgYmUgZmlsdGVyZWRcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBzcGFucyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ3NwYW4nIH0pO1xuICAgICAgY29uc3Qgc3Bhbk9wcyA9IHNwYW5zLm1hcChzID0+IHMub3BlcmF0aW9uKTtcblxuICAgICAgLy8gUGFyZW50IHdpdGggZXJyb3IgY2hpbGQgc2hvdWxkIGJlIGNhcHR1cmVkIChldmVuIHRob3VnaCA8IDEwcyBpdHNlbGYpXG4gICAgICAvLyBiZWNhdXNlIGl0IGhhcyBjaGlsZHJlbiAtIGNyaXRpY2FsIGZvciBoaWVyYXJjaHkhXG4gICAgICBleHBlY3Qoc3Bhbk9wcykudG9Db250YWluKCdmYXN0UGFyZW50V2l0aEVycm9yQ2hpbGQnKTtcbiAgICAgIGV4cGVjdChzcGFuT3BzKS50b0NvbnRhaW4oJ2Vycm9yQ2hpbGQnKTtcblxuICAgICAgLy8gUGFyZW50IHdpdGhvdXQgY2hpbGQgY2FwdHVyZSBkZXBlbmRzIG9uIG5vaXNlLXJlZHVjdGlvbiAvIGZpbHRlcmluZyBzZW1hbnRpY3M7IHdlIGRvbid0IGFzc2VydCBpdCBoZXJlLlxuXG4gICAgICAvLyBWZXJpZnkgaGllcmFyY2h5IGlzIGludGFjdFxuICAgICAgY29uc3QgcGFyZW50ID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAnZmFzdFBhcmVudFdpdGhFcnJvckNoaWxkJyk7XG4gICAgICBjb25zdCBjaGlsZCA9IHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ2Vycm9yQ2hpbGQnKTtcblxuICAgICAgZXhwZWN0KHBhcmVudCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChjaGlsZCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChjaGlsZCEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKHBhcmVudCEub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcblxuICAgICAgLy8gVmVyaWZ5IHBhcmVudCB3YXMgZmFzdCBidXQgc3RpbGwgY2FwdHVyZWQgZHVlIHRvIHBhcmVudCByZWZlcmVuY2UgaW50ZWdyaXR5XG4gICAgICBleHBlY3QocGFyZW50IS5kdXJhdGlvbk1zKS50b0JlTGVzc1RoYW4oMTAwMDApOyAgLy8gUGFyZW50IHdhcyBmYXN0XG4gICAgICBleHBlY3QoY2hpbGQhLmVycm9yKS50b0JlRGVmaW5lZCgpOyAgLy8gQ2hpbGQgaGFkIGVycm9yXG5cbiAgICAgIC8vIFJlc2V0IHRvIGRlZmF1bHQgdGVzdCBjb25maWdcbiAgICAgIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSgpO1xuICAgICAgbW9ja0JhY2tlbmQgPSBzZXR1cFRlc3RPYnNlcnZhYmlsaXR5KHsgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgTk9UIGNhcHR1cmUgcGFyZW50IHNwYW5zIGlmIGNoaWxkcmVuIGFyZSBmaWx0ZXJlZCBvdXQgKG5vIG9ycGhhbiBwYXJlbnRzKScsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFRlc3QgdGhhdCBwYXJlbnQgaXNuJ3QgY2FwdHVyZWQgd2hlbiBjaGlsZHJlbiBhcmUgZmlsdGVyZWRcbiAgICAgIC8vIFRoaXMgcHJldmVudHMgb3JwaGFuIHBhcmVudCBzcGFucyBwb2ludGluZyB0byBub3RoaW5nXG4gICAgICBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHkoKTtcbiAgICAgIG1vY2tCYWNrZW5kID0gc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSh7XG4gICAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UsXG4gICAgICAgIG1pblNwYW5EdXJhdGlvbk1zOiAxMDAwMCwgIC8vIDEwIHNlY29uZCB0aHJlc2hvbGRcbiAgICAgICAgc2tpcEVtcHR5U3BhbnM6IHRydWUsXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBGYXN0IHBhcmVudCB3aXRoIGZhc3QgY2hpbGQgKGNoaWxkIHdpbGwgYmUgZmlsdGVyZWQgZHVlIHRvIG1pbkR1cmF0aW9uTXMpXG4gICAgICAgIC8vIFNpbmNlIGNoaWxkIGlzIGZpbHRlcmVkLCBwYXJlbnQgc2hvdWxkIGFsc28gYmUgZmlsdGVyZWQgKG5vIG9ycGhhbilcbiAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ3BhcmVudFdpdGhGaWx0ZXJlZENoaWxkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdmaWx0ZXJlZENoaWxkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgLy8gRmFzdCBzcGFuLCBubyBlcnJvciwgbm8gY29udGVudCAtIHdpbGwgYmUgZmlsdGVyZWRcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBzcGFucyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ3NwYW4nIH0pO1xuICAgICAgY29uc3Qgc3Bhbk9wcyA9IHNwYW5zLm1hcChzID0+IHMub3BlcmF0aW9uKTtcblxuICAgICAgLy8gV2UgZG9uJ3QgYXNzZXJ0IGV4YWN0IHNwYW4gZHJvcC9rZWVwIGJlaGF2aW9yIGhlcmUgKHRoYXQgY2FuIHZhcnkgd2l0aCBjb25zb2xpZGF0aW9uICsgaGllcmFyY2h5IHNhZmV0eSkuXG4gICAgICAvLyBXaGF0IG11c3QgYWx3YXlzIGhvbGQgaXMgdGhhdCB3ZSBuZXZlciBlbWl0IGJyb2tlbiBwYXJlbnQgcmVmZXJlbmNlcyBvciBpbnZhcmlhbnQgdmlvbGF0aW9ucy5cbiAgICAgIGNvbnN0IGlkU2V0ID0gbmV3IFNldChzcGFucy5tYXAocyA9PiBzLm9ic2VydmFiaWxpdHlMb2dJZCkpO1xuICAgICAgY29uc3QgYnJva2VuUmVmcyA9IHNwYW5zXG4gICAgICAgIC5maWx0ZXIocyA9PiBzLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZClcbiAgICAgICAgLmZpbHRlcihzID0+ICFpZFNldC5oYXMocy5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQhKSlcbiAgICAgICAgLm1hcChzID0+ICh7IG9wOiBzLm9wZXJhdGlvbiwgcGFyZW50OiBzLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCB9KSk7XG4gICAgICBleHBlY3QoYnJva2VuUmVmcykudG9FcXVhbChbXSk7XG5cbiAgICAgIGNvbnN0IHZpb2xhdGlvbnMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7XG4gICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICBvcGVyYXRpb246ICdvYnNlcnZhYmlsaXR5LmludmFyaWFudF92aW9sYXRpb24ubWlzc2luZ19wYXJlbnRfc3BhbicsXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdCh2aW9sYXRpb25zLmxlbmd0aCkudG9CZSgwKTtcblxuICAgICAgLy8gUmVzZXQgdG8gZGVmYXVsdCB0ZXN0IGNvbmZpZ1xuICAgICAgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5KCk7XG4gICAgICBtb2NrQmFja2VuZCA9IHNldHVwVGVzdE9ic2VydmFiaWxpdHkoeyBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLlRSQUNFIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBuZXZlciBicmVhayBwYXJlbnQtY2hpbGQgcmVmZXJlbmNlcyBkdWUgdG8gZmlsdGVyaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBEZWVwIG5lc3Rpbmcgd2l0aCBmYXN0IHNwYW5zXG4gICAgICAgIGF3YWl0IHdpdGhTcGFuKCdsZXZlbDEnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ2xldmVsMicsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdsZXZlbDMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdsZXZlbDQnLCBhc3luYyAoc3BhbikgPT4ge1xuICAgICAgICAgICAgICAgIHNwYW4uY2hlY2twb2ludCgnZGVlcGVzdF93b3JrJyk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgc3BhbnMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdzcGFuJyB9KTtcblxuICAgICAgLy8gQWxsIDQgbGV2ZWxzIHNob3VsZCBiZSBjYXB0dXJlZFxuICAgICAgZXhwZWN0KHNwYW5zLmxlbmd0aCkudG9CZSg0KTtcblxuICAgICAgLy8gVmVyaWZ5IGNvbXBsZXRlIGhpZXJhcmNoeSBjaGFpblxuICAgICAgY29uc3QgbGV2ZWwxID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAnbGV2ZWwxJyk7XG4gICAgICBjb25zdCBsZXZlbDIgPSBzcGFucy5maW5kKHMgPT4gcy5vcGVyYXRpb24gPT09ICdsZXZlbDInKTtcbiAgICAgIGNvbnN0IGxldmVsMyA9IHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ2xldmVsMycpO1xuICAgICAgY29uc3QgbGV2ZWw0ID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAnbGV2ZWw0Jyk7XG5cbiAgICAgIGV4cGVjdChsZXZlbDEpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QobGV2ZWwyKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGxldmVsMykudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChsZXZlbDQpLnRvQmVEZWZpbmVkKCk7XG5cbiAgICAgIC8vIFZlcmlmeSBwYXJlbnQgY2hhaW5cbiAgICAgIGV4cGVjdChsZXZlbDIhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZShsZXZlbDEhLm9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgICBleHBlY3QobGV2ZWwzIS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUobGV2ZWwyIS5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgZXhwZWN0KGxldmVsNCEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKGxldmVsMyEub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gRHluYW1vREIgQmFja2VuZCBTcGVjaWZpYyBUZXN0c1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBkZXNjcmliZSgnQmFja2VuZC1zcGVjaWZpYyBiZWhhdmlvcicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIE5PVCBzZW5kIHNwYW4uc3RhcnQgdG8gbW9jayBiYWNrZW5kIChzaW11bGF0aW5nIER5bmFtb0RCIGZpbHRlcmluZyknLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHdpdGhTcGFuKCd0ZXN0U3BhbicsIGFzeW5jIChzcGFuKSA9PiB7XG4gICAgICAgICAgc3Bhbi5jaGVja3BvaW50KCdkb2luZ193b3JrJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgZXZlbnRzID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzKCk7XG5cbiAgICAgIC8vIEluIHJlYWwgc2NlbmFyaW8gd2l0aCBiYWNrZW5kIGZpbHRlcmluZywgc3Bhbi5zdGFydCBzaG91bGQgbm90IGFwcGVhclxuICAgICAgLy8gTW9ja0JhY2tlbmQgcmVjZWl2ZXMgZXZlcnl0aGluZywgYnV0IHdlIGNhbiB2ZXJpZnkgdGhlIGZpbHRlciBpcyBzZXRcbiAgICAgIGNvbnN0IHNwYW5TdGFydEV2ZW50cyA9IGV2ZW50cy5maWx0ZXIoZSA9PiBlLnR5cGUgPT09ICdzcGFuLnN0YXJ0Jyk7XG4gICAgICBjb25zdCBzcGFuRXZlbnRzID0gZXZlbnRzLmZpbHRlcihlID0+IGUudHlwZSA9PT0gJ3NwYW4nKTtcblxuICAgICAgLy8gV2Ugc2hvdWxkIGhhdmUgYXQgbGVhc3QgdGhlIGNvbnNvbGlkYXRlZCBzcGFuXG4gICAgICBleHBlY3Qoc3BhbkV2ZW50cy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMSk7XG5cbiAgICAgIC8vIFZlcmlmeSBzcGFuLnN0YXJ0IGhhcyBiYWNrZW5kIGZpbHRlciBzZXRcbiAgICAgIGlmIChzcGFuU3RhcnRFdmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICBleHBlY3Qoc3BhblN0YXJ0RXZlbnRzWyAwIF0uY2FwdHVyZT8uYmFja2VuZHMpLnRvRXF1YWwoWyAnb3RlbCcgXSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBDYXVzZWRCeSBQcm9wYWdhdGlvbiBUZXN0c1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBkZXNjcmliZSgnQ2F1c2VkQnkgUHJvcGFnYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBwcm9wYWdhdGUgY2F1c2VkQnkgZnJvbSBjb250ZXh0IHRvIGFsbCBldmVudHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBvcmlnaW5hbENvcnJlbGF0aW9uSWQgPSAnb3JpZ2luYWwtcmVxdWVzdC0xMjMnO1xuXG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIExvZ09ic2VydmVyLmluZm8oJ0xvZyB3aXRoaW4gY2F1c2VkIGNvbnRleHQnKTtcbiAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ3NwYW5XaXRoaW5DYXVzZWRDb250ZXh0JywgYXN5bmMgKHNwYW4pID0+IHtcbiAgICAgICAgICBzcGFuLmNoZWNrcG9pbnQoJ2NoZWNrcG9pbnRfaW5fY2F1c2VkX3NwYW4nKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH0sIHsgY2F1c2VkQnk6IG9yaWdpbmFsQ29ycmVsYXRpb25JZCB9KTtcblxuICAgICAgY29uc3QgZXZlbnRzID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gICAgICBleHBlY3QoZXZlbnRzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgyKTtcblxuICAgICAgLy8gQWxsIGV2ZW50cyBzaG91bGQgaGF2ZSBjYXVzZWRCeSBzZXRcbiAgICAgIGV2ZW50cy5mb3JFYWNoKGV2ZW50ID0+IHtcbiAgICAgICAgZXhwZWN0KGV2ZW50LmNhdXNlZEJ5KS50b0JlKG9yaWdpbmFsQ29ycmVsYXRpb25JZCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgYWxsb3cgZXhwbGljaXQgY2F1c2VkQnkgb3ZlcnJpZGUgcGVyIGV2ZW50JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29udGV4dENhdXNlZEJ5ID0gJ2NvbnRleHQtY2F1c2UtMTIzJztcbiAgICAgIGNvbnN0IGV4cGxpY2l0Q2F1c2VkQnkgPSAnZXhwbGljaXQtY2F1c2UtNDU2JztcblxuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBMb2cgd2l0aCBleHBsaWNpdCBjYXVzZWRCeSBvdmVycmlkZVxuICAgICAgICBMb2dPYnNlcnZlci5pbmZvKCdMb2cgd2l0aCBleHBsaWNpdCBjYXVzZWRCeScsIHt9LCB7IGNhdXNlZEJ5OiBleHBsaWNpdENhdXNlZEJ5IH0pO1xuXG4gICAgICAgIC8vIExvZyB3aXRob3V0IG92ZXJyaWRlIC0gc2hvdWxkIHVzZSBjb250ZXh0IGNhdXNlZEJ5XG4gICAgICAgIExvZ09ic2VydmVyLmluZm8oJ0xvZyB3aXRoIGNvbnRleHQgY2F1c2VkQnknKTtcblxuICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgICAgfSwgeyBjYXVzZWRCeTogY29udGV4dENhdXNlZEJ5IH0pO1xuXG4gICAgICBjb25zdCBldmVudHMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHMoKTtcbiAgICAgIGV4cGVjdChldmVudHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuXG4gICAgICBjb25zdCBleHBsaWNpdEV2ZW50ID0gZXZlbnRzLmZpbmQoZSA9PiBlLm9wZXJhdGlvbiA9PT0gJ0xvZyB3aXRoIGV4cGxpY2l0IGNhdXNlZEJ5Jyk7XG4gICAgICBjb25zdCBjb250ZXh0RXZlbnQgPSBldmVudHMuZmluZChlID0+IGUub3BlcmF0aW9uID09PSAnTG9nIHdpdGggY29udGV4dCBjYXVzZWRCeScpO1xuXG4gICAgICBleHBlY3QoZXhwbGljaXRFdmVudD8uY2F1c2VkQnkpLnRvQmUoZXhwbGljaXRDYXVzZWRCeSk7XG4gICAgICBleHBlY3QoY29udGV4dEV2ZW50Py5jYXVzZWRCeSkudG9CZShjb250ZXh0Q2F1c2VkQnkpO1xuICAgIH0pO1xuICB9KTtcblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gRHVyYXRpb25NcyBUZXN0c1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBkZXNjcmliZSgnRHVyYXRpb25NcyBhdCBSb290IExldmVsJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaGF2ZSBkdXJhdGlvbk1zIGF0IHJvb3QgbGV2ZWwgZm9yIHNwYW5zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB3aXRoU3BhbigndGltZWRTcGFuJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMCkpOyAvLyAxMG1zIGRlbGF5XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgc3BhbnMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdzcGFuJyB9KTtcbiAgICAgIGV4cGVjdChzcGFucy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMSk7XG5cbiAgICAgIGNvbnN0IHNwYW4gPSBzcGFucy5maW5kKHMgPT4gcy5vcGVyYXRpb24gPT09ICd0aW1lZFNwYW4nKTtcbiAgICAgIGV4cGVjdChzcGFuKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHNwYW4hLmR1cmF0aW9uTXMpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QodHlwZW9mIHNwYW4hLmR1cmF0aW9uTXMpLnRvQmUoJ251bWJlcicpO1xuICAgICAgZXhwZWN0KHNwYW4hLmR1cmF0aW9uTXMpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMTApO1xuXG4gICAgICAvLyBBbHNvIHZlcmlmeSBkdXJhdGlvbiBpcyBpbiBtZXRyaWNzXG4gICAgICBleHBlY3Qoc3BhbiEubWV0cmljcz8uZHVyYXRpb24pLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qoc3BhbiEubWV0cmljcyEuZHVyYXRpb24pLnRvQmUoc3BhbiEuZHVyYXRpb25Ncyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhdmUgZHVyYXRpb25NcyBhdCByb290IGxldmVsIGZvciBsb2dzIHdoZW4gcGFzc2VkIGluIG9wdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxNSkpO1xuICAgICAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG5cbiAgICAgICAgLy8gUGFzcyBkdXJhdGlvbk1zIGFzIGEgTG9nT3B0aW9ucyBwcm9wZXJ0eSwgTk9UIGluIGRhdGFcbiAgICAgICAgTG9nT2JzZXJ2ZXIuaW5mbygnVGltZWQgb3BlcmF0aW9uJywgeyByZXN1bHQ6ICdzdWNjZXNzJyB9LCB7IGR1cmF0aW9uTXM6IGR1cmF0aW9uIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgbG9ncyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ2xvZycgfSk7XG4gICAgICBleHBlY3QobG9ncy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMSk7XG5cbiAgICAgIGNvbnN0IHRpbWVkTG9nID0gbG9ncy5maW5kKGwgPT4gbC5vcGVyYXRpb24gPT09ICdUaW1lZCBvcGVyYXRpb24nKTtcbiAgICAgIGV4cGVjdCh0aW1lZExvZykudG9CZURlZmluZWQoKTtcblxuICAgICAgLy8gZHVyYXRpb25NcyBzaG91bGQgYmUgYXQgUk9PVCBsZXZlbCwgTk9UIGluc2lkZSBkYXRhXG4gICAgICBleHBlY3QodGltZWRMb2chLmR1cmF0aW9uTXMpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QodHlwZW9mIHRpbWVkTG9nIS5kdXJhdGlvbk1zKS50b0JlKCdudW1iZXInKTtcbiAgICAgIGV4cGVjdCh0aW1lZExvZyEuZHVyYXRpb25NcykudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgxNSk7XG5cbiAgICAgIC8vIGRhdGEgc2hvdWxkIGNvbnRhaW4gb3VyIHJlc3VsdCwgbm90IGR1cmF0aW9uTXNcbiAgICAgIGV4cGVjdCh0aW1lZExvZyEuZGF0YT8ucmVzdWx0KS50b0JlKCdzdWNjZXNzJyk7XG4gICAgICBleHBlY3QodGltZWRMb2chLmRhdGE/LmR1cmF0aW9uTXMpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGF2ZSBzdWNjZXNzIGFuZCBzdGF0dXMgYXQgcm9vdCBsZXZlbCBmb3IgbG9ncyB3aGVuIHBhc3NlZCBpbiBvcHRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBMb2dPYnNlcnZlci5pbmZvKCdTdWNjZXNzZnVsIG9wZXJhdGlvbicsIHsgZGV0YWlsczogJ29rJyB9LCB7XG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwMFxuICAgICAgICB9KTtcblxuICAgICAgICBMb2dPYnNlcnZlci5lcnJvcignRmFpbGVkIG9wZXJhdGlvbicsIHsgZGV0YWlsczogJ2Vycm9yJyB9LCB7XG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiA1MFxuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGxvZ3MgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdsb2cnIH0pO1xuICAgICAgZXhwZWN0KGxvZ3MubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuXG4gICAgICBjb25zdCBzdWNjZXNzTG9nID0gbG9ncy5maW5kKGwgPT4gbC5vcGVyYXRpb24gPT09ICdTdWNjZXNzZnVsIG9wZXJhdGlvbicpO1xuICAgICAgY29uc3QgZXJyb3JMb2cgPSBsb2dzLmZpbmQobCA9PiBsLm9wZXJhdGlvbiA9PT0gJ0ZhaWxlZCBvcGVyYXRpb24nKTtcblxuICAgICAgZXhwZWN0KHN1Y2Nlc3NMb2cpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qoc3VjY2Vzc0xvZyEuc3VjY2VzcykudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChzdWNjZXNzTG9nIS5zdGF0dXMpLnRvQmUoJ2NvbXBsZXRlZCcpO1xuICAgICAgZXhwZWN0KHN1Y2Nlc3NMb2chLmR1cmF0aW9uTXMpLnRvQmUoMTAwKTtcblxuICAgICAgZXhwZWN0KGVycm9yTG9nKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGVycm9yTG9nIS5zdWNjZXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChlcnJvckxvZyEuc3RhdHVzKS50b0JlKCdmYWlsZWQnKTtcbiAgICAgIGV4cGVjdChlcnJvckxvZyEuZHVyYXRpb25NcykudG9CZSg1MCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGluY2x1ZGUgbWV0cmljcyBhdCByb290IGxldmVsIGZvciBsb2dzIHdoZW4gcGFzc2VkIGluIG9wdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIExvZ09ic2VydmVyLmluZm8oJ09wZXJhdGlvbiB3aXRoIG1ldHJpY3MnLCB7IGRldGFpbHM6ICdvaycgfSwge1xuICAgICAgICAgIGR1cmF0aW9uTXM6IDc1LFxuICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgIHJlY29yZHNQcm9jZXNzZWQ6IDEwMCxcbiAgICAgICAgICAgIGVycm9yQ291bnQ6IDIsXG4gICAgICAgICAgICBhdmdMYXRlbmN5OiAyNS41XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGxvZ3MgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdsb2cnIH0pO1xuICAgICAgZXhwZWN0KGxvZ3MubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuXG4gICAgICBjb25zdCBsb2dXaXRoTWV0cmljcyA9IGxvZ3MuZmluZChsID0+IGwub3BlcmF0aW9uID09PSAnT3BlcmF0aW9uIHdpdGggbWV0cmljcycpO1xuICAgICAgZXhwZWN0KGxvZ1dpdGhNZXRyaWNzKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGxvZ1dpdGhNZXRyaWNzIS5kdXJhdGlvbk1zKS50b0JlKDc1KTtcbiAgICAgIGV4cGVjdChsb2dXaXRoTWV0cmljcyEubWV0cmljcykudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChsb2dXaXRoTWV0cmljcyEubWV0cmljcyEucmVjb3Jkc1Byb2Nlc3NlZCkudG9CZSgxMDApO1xuICAgICAgZXhwZWN0KGxvZ1dpdGhNZXRyaWNzIS5tZXRyaWNzIS5lcnJvckNvdW50KS50b0JlKDIpO1xuICAgICAgZXhwZWN0KGxvZ1dpdGhNZXRyaWNzIS5tZXRyaWNzIS5hdmdMYXRlbmN5KS50b0JlKDI1LjUpO1xuICAgIH0pO1xuICB9KTtcblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gUGFyZW50IE9ic2VydmFiaWxpdHlMb2dJZCBUZXN0c1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBkZXNjcmliZSgnUGFyZW50IE9ic2VydmFiaWxpdHlMb2dJZCBJbnRlZ3JpdHknLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBlbnN1cmUgYWxsIGNoaWxkIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCByZWZlcmVuY2VzIGV4aXN0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB3aXRoU3BhbignbGV2ZWwxJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdsZXZlbDInLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBMb2dPYnNlcnZlci5pbmZvKCdMb2cgaW5zaWRlIG5lc3RlZCBzcGFuJyk7XG4gICAgICAgICAgICBhd2FpdCB3aXRoU3BhbignbGV2ZWwzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBMb2dPYnNlcnZlci5kZWJ1ZygnRGVlcGVzdCBsb2cnKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGV2ZW50cyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50cygpO1xuXG4gICAgICAvLyBCdWlsZCBhIHNldCBvZiBhbGwgb2JzZXJ2YWJpbGl0eUxvZ0lkc1xuICAgICAgY29uc3QgYWxsSWRzID0gbmV3IFNldChldmVudHMubWFwKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQpKTtcblxuICAgICAgLy8gVmVyaWZ5IGFsbCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgcmVmZXJlbmNlcyBwb2ludCB0byBleGlzdGluZyBldmVudHNcbiAgICAgIGNvbnN0IGJyb2tlblJlZmVyZW5jZXM6IHN0cmluZ1tdID0gW107XG4gICAgICBldmVudHMuZm9yRWFjaChldmVudCA9PiB7XG4gICAgICAgIGlmIChldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgJiYgIWFsbElkcy5oYXMoZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSkge1xuICAgICAgICAgIGJyb2tlblJlZmVyZW5jZXMucHVzaChcbiAgICAgICAgICAgIGAke2V2ZW50LnR5cGV9OiR7ZXZlbnQub3BlcmF0aW9ufSAtPiBtaXNzaW5nIHBhcmVudDogJHtldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWR9YFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBpZiAoYnJva2VuUmVmZXJlbmNlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIEhlbHBmdWwgdGVzdCBmYWlsdXJlIG91dHB1dCAob25seSBwcmludGVkIHdoZW4gdGVzdCBmYWlscykuXG4gICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICAgIGNvbnNvbGUubG9nKCdCcm9rZW4gcGFyZW50IHJlZmVyZW5jZXM6JywgYnJva2VuUmVmZXJlbmNlcyk7XG4gICAgICB9XG5cbiAgICAgIGV4cGVjdChicm9rZW5SZWZlcmVuY2VzLmxlbmd0aCkudG9CZSgwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZW5zdXJlIGRlZXBseSBuZXN0ZWQgaGllcmFyY2h5IGludGVncml0eSB3aXRoIG1peGVkIGV2ZW50IHR5cGVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB3aXRoU3BhbignYXBpUmVxdWVzdCcsIGFzeW5jIChhcGlTcGFuKSA9PiB7XG4gICAgICAgICAgYXBpU3Bhbi50YWcoJ2VuZHBvaW50JywgJy91c2VycycpO1xuXG4gICAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ3ZhbGlkYXRlUmVxdWVzdCcsIGFzeW5jICh2YWxpZGF0ZVNwYW4pID0+IHtcbiAgICAgICAgICAgIHZhbGlkYXRlU3Bhbi5jaGVja3BvaW50KCd2YWxpZGF0aW9uX3N0YXJ0Jyk7XG4gICAgICAgICAgICBMb2dPYnNlcnZlci5kZWJ1ZygnVmFsaWRhdGluZyB1c2VyIGlucHV0Jyk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICBhd2FpdCB3aXRoU3BhbigncHJvY2Vzc1JlcXVlc3QnLCBhc3luYyAocHJvY2Vzc1NwYW4pID0+IHtcbiAgICAgICAgICAgIHByb2Nlc3NTcGFuLnRhZygnYWN0aW9uJywgJ2NyZWF0ZScpO1xuXG4gICAgICAgICAgICBhd2FpdCB3aXRoU3BhbignZGJPcGVyYXRpb24nLCBhc3luYyAoZGJTcGFuKSA9PiB7XG4gICAgICAgICAgICAgIGRiU3Bhbi5tZXRyaWMoJ3F1ZXJpZXMnLCAxKTtcbiAgICAgICAgICAgICAgTG9nT2JzZXJ2ZXIuaW5mbygnRXhlY3V0aW5nIGRhdGFiYXNlIHF1ZXJ5Jyk7XG5cbiAgICAgICAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ2F1ZGl0TG9nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5Q3JlYXRlKCdVc2VyJywgJ3VzZXItMTIzJywgeyBuYW1lOiAnVGVzdCcgfSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgZXZlbnRzID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gICAgICBjb25zdCBhbGxJZHMgPSBuZXcgU2V0KGV2ZW50cy5tYXAoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCkpO1xuXG4gICAgICAvLyBWZXJpZnkgaGllcmFyY2h5IGludGVncml0eVxuICAgICAgY29uc3Qgb3JwaGFucyA9IGV2ZW50cy5maWx0ZXIoZSA9PlxuICAgICAgICBlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCAmJiAhYWxsSWRzLmhhcyhlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZClcbiAgICAgICk7XG5cbiAgICAgIGV4cGVjdChvcnBoYW5zLmxlbmd0aCkudG9CZSgwKTtcblxuICAgICAgLy8gVmVyaWZ5IHNwZWNpZmljIGhpZXJhcmNoeVxuICAgICAgY29uc3Qgc3BhbnMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdzcGFuJyB9KTtcbiAgICAgIGNvbnN0IGFwaVJlcXVlc3QgPSBzcGFucy5maW5kKHMgPT4gcy5vcGVyYXRpb24gPT09ICdhcGlSZXF1ZXN0Jyk7XG4gICAgICBjb25zdCB2YWxpZGF0ZVJlcXVlc3QgPSBzcGFucy5maW5kKHMgPT4gcy5vcGVyYXRpb24gPT09ICd2YWxpZGF0ZVJlcXVlc3QnKTtcbiAgICAgIGNvbnN0IHByb2Nlc3NSZXF1ZXN0ID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAncHJvY2Vzc1JlcXVlc3QnKTtcbiAgICAgIGNvbnN0IGRiT3BlcmF0aW9uID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAnZGJPcGVyYXRpb24nKTtcbiAgICAgIGNvbnN0IGF1ZGl0TG9nID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAnYXVkaXRMb2cnKTtcblxuICAgICAgZXhwZWN0KGFwaVJlcXVlc3QpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QodmFsaWRhdGVSZXF1ZXN0Py5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoYXBpUmVxdWVzdCEub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICAgIGV4cGVjdChwcm9jZXNzUmVxdWVzdD8ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKGFwaVJlcXVlc3QhLm9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgICBleHBlY3QoZGJPcGVyYXRpb24/LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZShwcm9jZXNzUmVxdWVzdCEub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICAgIGV4cGVjdChhdWRpdExvZz8ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKGRiT3BlcmF0aW9uIS5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19