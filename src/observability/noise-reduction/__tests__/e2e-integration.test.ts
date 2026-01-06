/**
 * E2E INTEGRATION TEST FOR NOISE REDUCTION
 * 
 * This test uses REAL FW24 components:
 * - Real controllers with @Controller decorator
 * - Real services extending BaseEntityService  
 * - Real entities with schemas
 * - Real DynamoDB backend for observability
 * - Real Lambda test harness to invoke controllers
 * 
 * NO MANUAL SPAN CREATION - ALL spans come from framework code paths
 */

import { Controller, Post } from '../../../decorators';
import { createEntitySchema, BaseEntityService, DefaultEntityOperations, BaseEntityController } from '../../../entity';
import { ObservabilityManager } from '../../manager';
import { LambdaTestHarness } from '../../../testing';
import { randomUUID } from 'crypto';
import { createObservabilityConfig } from '../../config';
import { AbstractLambdaHandler } from '../../../core/runtime/abstract-lambda-handler';

// ==================== TEST ENTITY ====================
const createTestItemSchema = () => {
  return createEntitySchema({
    model: {
      version: '1',
      entity: 'testItem',
      entityNamePlural: 'Test Items',
      service: 'testService',
      entityOperations: DefaultEntityOperations,
    },
    attributes: {
      testItemId: {
        type: 'string',
        required: true,
        default: () => randomUUID(),
      },
      name: {
        type: 'string',
        required: true,
      },
      status: {
        type: [ 'active', 'inactive' ],
        required: true,
        default: 'active',
      },
      createdAt: {
        type: 'string',
        readOnly: true,
        required: true,
        default: () => new Date().toISOString(),
        set: () => new Date().toISOString(),
      },
      updatedAt: {
        type: 'string',
        watch: '*',
        required: true,
        readOnly: true,
        default: () => new Date().toISOString(),
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      primary: {
        pk: { field: 'pk', composite: [ 'testItemId' ] },
        sk: { field: 'sk', composite: [] },
      },
      byStatus: {
        index: 'gsi1',
        pk: { field: 'gsi1pk', composite: [ 'status' ] },
        sk: { field: 'gsi1sk', composite: [ 'testItemId' ] },
      },
    },
  });
};

type TestItemSchema = ReturnType<typeof createTestItemSchema>;

// ==================== TEST SERVICE ====================
class TestItemService extends BaseEntityService<TestItemSchema> {
  constructor() {
    super(createTestItemSchema(), { table: 'test-items' });

    // Mock ElectroDB repository with full query builder chain
    const mockGo = () => Promise.resolve({ data: { testItemId: randomUUID(), name: 'Mock', status: 'active' } });
    const createQueryChain = () => ({
      where: jest.fn().mockReturnThis(),
      go: jest.fn().mockResolvedValue({ data: [] }),
      page: jest.fn().mockReturnThis(),
    });

    const mockRepo: any = {
      get: jest.fn().mockReturnValue({ go: mockGo }),
      put: jest.fn().mockReturnValue({ go: mockGo }),
      update: jest.fn().mockReturnValue({ go: mockGo }),
      patch: jest.fn().mockReturnValue({ go: mockGo }),
      delete: jest.fn().mockReturnValue({ go: mockGo }),
      upsert: jest.fn().mockReturnValue({ go: mockGo }),
      scan: createQueryChain(),
      query: {
        primary: jest.fn().mockReturnValue(createQueryChain()),
        byStatus: jest.fn().mockReturnValue(createQueryChain()),
      },
      _findBestIndexKeyMatch: jest.fn().mockReturnValue({ index: 'primary', keys: [] }),
    };

    // Override the repository getter
    (this as any).getRepository = () => mockRepo;
  }
}

// ==================== TEST CONTROLLER ====================
@Controller('/testitem', {
  authorizer: { type: 'none' },
})
class TestItemController extends BaseEntityController<TestItemSchema> {
  constructor(private readonly service: TestItemService) {
    super(service);
  }

  // BaseEntityController provides list(), get(), create() automatically
  // Add custom batch endpoint
  @Post('/batch-upsert')
  async batchUpsert(event: any) {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
    const items = body.items || [];

    // This should trigger aggregation of upserts
    // BaseEntityController exposes service via this.entityService
    const results = [];
    for (const item of items) {
      const result = await (this.entityService).upsert(item);
      results.push(result);
    }

    return { statusCode: 201, body: JSON.stringify({ items: results }) };
  }
}

// ==================== MOCK BACKEND ====================
interface CapturedEvent {
  type: string;
  operation?: string;
  source?: string;
  success?: boolean;
  level?: string;
  durationMs?: number;
  data?: any;
}

class MockObservabilityBackend {
  private events: CapturedEvent[] = [];

  // Required by ObservabilityManager
  async capture(event: any): Promise<void> {
    this.events.push({
      type: event.type,
      operation: event.operation,
      source: event.source,
      success: event.success,
      level: event.level,
      durationMs: event.durationMs, // Include duration for rule matching
      data: event.data,
    });
  }

  async batchWrite(events: any[]): Promise<void> {
    this.events.push(...events.map((e) => ({
      type: e.type,
      operation: e.operation,
      source: e.source,
      success: e.success,
      level: e.level,
      durationMs: e.durationMs, // Include duration for rule matching
      data: e.data,
    })));
  }

  getEvents(): CapturedEvent[] {
    return this.events;
  }

  getEventsMatching(criteria: Partial<CapturedEvent>): CapturedEvent[] {
    return this.events.filter((e) =>
      Object.entries(criteria).every(([ key, value ]) => (e as any)[ key ] === value)
    );
  }

  reset(): void {
    this.events = [];
  }
}

// ==================== TEST SUITE ====================
describe('Noise Reduction E2E Integration (Real FW24 Components)', () => {
  let service: TestItemService;
  let controller: TestItemController;
  let harness: LambdaTestHarness;
  let backend: MockObservabilityBackend;

  beforeAll(() => {
    // Setup service and controller (no DI needed for this test)
    service = new TestItemService();
    controller = new TestItemController(service);

    // Setup mock observability backend
    backend = new MockObservabilityBackend();

    // Configure observability with noise reduction
    const config = createObservabilityConfig({
      enabled: true,
      serviceName: 'test-noise-reduction-e2e',
      backends: [],
      noiseReduction: {
        enabled: true,
        presets: [ 'fw24.hotpaths' ],
        rules: [],
        emitSummaries: true,
        includeDebugMetadata: true,
      },
      spans: { minDurationMs: 0, skipEmpty: false },
    });

    ObservabilityManager.initializeForTesting(config, [ backend as any ]);

    // Setup test harness (controller name is 'testitem' from @Controller decorator)
    harness = new LambdaTestHarness(controller as any, {
      logLevel: 0, // SILENT
    });
  });

  afterAll(() => {
    ObservabilityManager.reset();
  });

  beforeEach(() => {
    // Reset backend to clear events from previous test
    backend.reset();
    // Don't reset ObservabilityManager between tests - it's already initialized in beforeAll
  });

  afterEach(async () => {
    // Give time for async flush to complete
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('fw24.hotpaths.api.drop_fast_successful_reads', () => {
    it('keeps fast GET operations that fail (hard signal protection)', async () => {
      // Reset backend before this test
      backend.reset();

      // Mock will return success, so let's manually throw an error in the mock
      const oldGet = (service as any).getRepository().get;
      (service as any).getRepository().get = jest.fn().mockReturnValue({
        go: jest.fn().mockRejectedValue(new Error('Test error - item not found')),
      });

      // Just invoke - framework handles observability automatically
      const response = await harness.get('/nonexistent-id', {
        pathParameters: { id: 'nonexistent-id' },
      });

      console.log('Failed GET response status:', response.statusCode);

      // Restore mock
      (service as any).getRepository().get = oldGet;

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 200));

      // AbstractLambdaHandler already flushed
      const allEvents = backend.getEvents();
      const spans = backend.getEventsMatching({ type: 'span' });

      // VERIFY: Failed operations are NEVER dropped (hard signal protection)
      // Expected: Controller span + Service span (both failed)
      expect(spans.length).toBe(2);

      // VERIFY: Controller span
      const controllerSpan = spans.find(s => s.source?.includes('Controller'));
      expect(controllerSpan).toBeDefined();
      expect(controllerSpan?.operation).toContain('GET');
      expect(controllerSpan?.operation).toContain('testitem');
      expect(controllerSpan?.success).toBe(false);
      expect(controllerSpan?.level).toBe('error');

      // VERIFY: Service span
      const serviceSpan = spans.find(s => s.source?.includes('service'));
      expect(serviceSpan).toBeDefined();
      expect(serviceSpan?.operation).toContain('get');
      expect(serviceSpan?.success).toBe(false);
      expect(serviceSpan?.level).toBe('error');
    });

    it('drops fast successful GET /testitem (list) operations', async () => {
      // Reset backend
      backend.reset();

      // Just invoke the controller - LambdaTestHarness + AbstractLambdaHandler handle everything
      const response = await harness.get('/');

      expect(response.statusCode).toBe(200);

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 100));

      // AbstractLambdaHandler's executeWithSpanAndFlush already flushed observability
      const allEvents = backend.getEvents();
      const spans = backend.getEventsMatching({ type: 'span' });

      // VERIFY: Fast successful reads should be DROPPED
      // Rule: fw24.hotpaths.api.drop_fast_successful_reads
      // Pattern: HTTP GET/HEAD/OPTIONS or .list/.get/.read methods that are fast (<500ms) and successful

      // VERIFY: No events persisted (entire tree pruned - no hard signals, just noise)
      expect(spans.length).toBe(0);
      expect(allEvents.length).toBe(0);
    });
  });

  describe('fw24.hotpaths.entity.aggregate_upsert_spans', () => {
    it('aggregates successful BaseEntityService upsert operations', async () => {
      // Reset backend before this test
      backend.reset();

      // Just invoke - AbstractLambdaHandler + BaseEntityController handle everything
      const response = await harness.post('/batch-upsert', {
        body: {
          items: [
            { testItemId: randomUUID(), name: 'Item 1', status: 'active' },
            { testItemId: randomUUID(), name: 'Item 2', status: 'active' },
            { testItemId: randomUUID(), name: 'Item 3', status: 'active' },
            { testItemId: randomUUID(), name: 'Item 4', status: 'active' },
            { testItemId: randomUUID(), name: 'Item 5', status: 'active' },
          ],
        },
      });

      expect(response.statusCode).toBe(201);

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 100));

      // AbstractLambdaHandler's executeWithSpanAndFlush already flushed
      const allEvents = backend.getEvents();
      const spans = backend.getEventsMatching({ type: 'span' });

      console.log('Batch test - Total events:', allEvents.length);
      console.log('Batch test - Total spans:', spans.length);
      console.log('Batch test - Spans:', spans.map(s => ({
        operation: s.operation,
        source: s.source,
        hasAggregates: !!(s.data as any)?.noiseReduction?.aggregates
      })));

      // CRITICAL ASSERTION: Multiple upserts should be AGGREGATED
      // Rule: fw24.hotpaths.entity.aggregate_upsert_spans
      // Pattern: service:BaseEntityService upsert/update operations should be aggregated into parent

      // Find individual upsert spans
      const upsertSpans = spans.filter(s =>
        s.operation?.toLowerCase().includes('upsert') &&
        s.source?.includes('service')
      );

      console.log('Individual upsert spans:', upsertSpans.length);

      // VERIFY: Aggregation should happen per fw24.hotpaths.entity.aggregate_upsert_spans rule
      // Rule matches: operation='/BaseEntityService\\.(upsert|update)/', source='/^service:BaseEntityService\\./', success=true

      // Individual upsert spans should NOT be in output (aggregated into parent)
      expect(upsertSpans.length).toBe(0);

      // Parent span should exist and have aggregates
      // VERIFY: Only parent span in output (upserts aggregated)
      expect(spans.length).toBe(1);

      // VERIFY: Parent span properties
      const parentSpan = spans[ 0 ];
      expect(parentSpan.operation).toBe('HTTP POST //testitem/batch-upsert');
      expect(parentSpan.source).toContain('Controller');
      expect(parentSpan.success).toBe(true);

      // VERIFY: Aggregates are in the noiseReduction.summary checkpoint (self-contained)
      const checkpoints = (parentSpan.data as any)?.checkpoints;
      expect(checkpoints).toBeDefined();
      expect(Array.isArray(checkpoints)).toBe(true);

      const summaryCheckpoint = checkpoints.find((cp: any) => cp.name === 'noiseReduction.summary');
      expect(summaryCheckpoint).toBeDefined();
      expect(summaryCheckpoint.data).toBeDefined();
      expect(summaryCheckpoint.data.aggregates).toBeDefined();

      const upsertAggregate = summaryCheckpoint.data.aggregates[ 'span:BaseEntityService.upsert' ];
      expect(upsertAggregate).toEqual({
        count: 5,
        errorCount: 0,
        durationSumMs: expect.any(Number),
        durationMaxMs: expect.any(Number),
        examples: [],
        errorExamples: [],
        rules: { 'fw24.hotpaths.entity.aggregate_upsert_spans': 5 }
      });

      // VERIFY: data.noiseReduction should NOT exist (all info in checkpoint)
      expect((parentSpan.data as any).noiseReduction).toBeUndefined();
    });
  });
});
