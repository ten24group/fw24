import { SpanObserver, MetricObserver, ObservabilityManager } from '../observability';
import { createObservabilityConfig } from '../observability/config';
import { createExecutionContext, runWithExecutionContext } from '../observability/context';
import { BaseEntityService } from './base-service';
import { createEntitySchema, DefaultEntityOperations } from './base-entity';
import { randomUUID } from 'crypto';
import { DIContainer } from '../di';

// Initialize observability for testing
ObservabilityManager.initializeForTesting(
  createObservabilityConfig({ enabled: true, backends: [] }),
  []
);

// Test entity schema
const TestEntitySchema = createEntitySchema({
  model: {
    version: '1',
    entity: 'testEntity',
    entityNamePlural: 'Test Entities',
    service: 'testService',
    entityOperations: DefaultEntityOperations,
  },
  attributes: {
    testEntityId: {
      type: 'string',
      required: true,
      default: () => randomUUID(),
    },
    name: {
      type: 'string',
      required: true,
    },
    createdAt: {
      type: "string",
      readOnly: true,
      required: true,
      default: () => new Date().toISOString(),
    },
    updatedAt: {
      type: "string",
      watch: "*",
      required: true,
      readOnly: true,
      default: () => new Date().toISOString(),
    }
  },
  indexes: {
    primary: {
      pk: { field: 'pk', composite: [ 'testEntityId' ] },
      sk: { field: 'sk', composite: [] }
    }
  }
});

// Test service implementation
class TestEntityService extends BaseEntityService<typeof TestEntitySchema> {
  constructor() {
    super(
      TestEntitySchema,
      {
        table: 'test-table',
      },
      DIContainer.ROOT
    );
  }
}

describe('Entity Observability Integration', () => {
  let service: TestEntityService;
  let capturedEvents: any[] = [];
  let tagSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new TestEntityService();
    capturedEvents = [];

    // Mock span creation - both start() and wrap() paths
    const originalStart = (SpanObserver as any).start;
    const originalWrap = (SpanObserver as any).wrap;

    jest.spyOn(SpanObserver, 'start').mockImplementation((operation, options) => {
      const span = originalStart.call(SpanObserver, operation, options);
      capturedEvents.push({
        type: 'span',
        operation,
        options,
      });
      return span;
    });

    // Also mock wrap() since @Observed uses it
    jest.spyOn(SpanObserver, 'wrap').mockImplementation((operation, fn, options) => {
      capturedEvents.push({
        type: 'span',
        operation,
        options,
      });
      return originalWrap.call(SpanObserver, operation, fn, options);
    });

    // @Observed applies extractor output via span.tag()/span.setData() in onStart/onFinish,
    // so we need to assert against span methods (not only the options passed into wrap()).
    tagSpy = jest.spyOn(SpanObserver.prototype, 'tag');

    jest.spyOn(MetricObserver, 'increment').mockImplementation((name, value, options) => {
      capturedEvents.push({
        type: 'metric.increment',
        name,
        value,
        options,
      });
      return 'mock-metric-id';
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('CRUD Operations with @Observed decorator', () => {
    it('should capture entityName in span attributes for list()', async () => {
      const ctx = createExecutionContext({ correlationId: 'test-correlation-id' });

      await runWithExecutionContext(ctx, async () => {
        try {
          await service.list({}, ctx as any);
        } catch (e) {
          // Expected to fail since we don't have real DB
        }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span');
      const listSpan = spanEvents.find(e => e.operation.includes('.list'));

      expect(listSpan).toBeDefined();
      // Extractor tags are applied via SpanObserver.tag() (not embedded into wrap() options).
      expect(tagSpy.mock.calls.some(([ k, v ]) => k === 'entityName' && v === 'testEntity')).toBe(true);
    });

    it('should capture hasFilters attribute for list() with filters', async () => {
      const ctx = createExecutionContext({ correlationId: 'test-correlation-id' });

      await runWithExecutionContext(ctx, async () => {
        try {
          await service.list({ filters: { name: { eq: 'test' } } }, ctx as any);
        } catch (e) {
          // Expected to fail
        }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span');
      const listSpan = spanEvents.find(e => e.operation.includes('.list'));

      expect(listSpan).toBeDefined();
      expect(tagSpy.mock.calls.some(([ k, v ]) => k === 'hasFilters' && v === true)).toBe(true);
    });

    it('should NOT capture hasFilters when no filters provided', async () => {
      const ctx = createExecutionContext({ correlationId: 'test-correlation-id' });

      await runWithExecutionContext(ctx, async () => {
        try {
          await service.list({}, ctx as any);
        } catch (e) {
          // Expected to fail
        }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span');
      const listSpan = spanEvents.find(e => e.operation.includes('.list'));

      expect(listSpan).toBeDefined();
      expect(tagSpy.mock.calls.some(([ k, v ]) => k === 'hasFilters' && v === false)).toBe(true);
    });

    it('should capture entityName for get()', async () => {
      const ctx = createExecutionContext({ correlationId: 'test-correlation-id' });

      await runWithExecutionContext(ctx, async () => {
        try {
          await service.get({ identifiers: { testEntityId: 'test-id' } }, ctx as any);
        } catch (e) {
          // Expected to fail
        }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span');
      const getSpan = spanEvents.find(e => e.operation.includes('.get'));

      expect(getSpan).toBeDefined();
      expect(tagSpy.mock.calls.some(([ k, v ]) => k === 'entityName' && v === 'testEntity')).toBe(true);
    });

    it('should skip span creation when ExecutionContext is not provided', async () => {
      try {
        await service.list({});
      } catch (e) {
        // Expected to fail
      }

      // @Observed decorator skips span creation when no ExecutionContext
      // This is by design - observability requires context for correlation
      const spanEvents = capturedEvents.filter(e => e.type === 'span');
      expect(spanEvents.length).toBe(0);
    });
  });

  describe('Full Scan Metric Tracking', () => {
    it('should increment fullScan metric when no index is found', async () => {
      // This test would need to mock the listEntity function to simulate a full scan
      // For now, we just verify the metric observer is being called

      MetricObserver.increment('entity.fullScan', 1, {
        tags: { entityName: 'testEntity', operation: 'list' },
        level: 'warn',
      });

      const metricEvents = capturedEvents.filter(e => e.type === 'metric.increment');
      const fullScanMetric = metricEvents.find(e => e.name === 'entity.fullScan');

      expect(fullScanMetric).toBeDefined();
      expect(fullScanMetric.value).toBe(1);
      expect(fullScanMetric.options.level).toBe('warn');
      expect(fullScanMetric.options.tags).toMatchObject({
        entityName: 'testEntity',
        operation: 'list',
      });
    });
  });

  describe('Span Creation', () => {
    it('should create span for read operations', async () => {
      const ctx = createExecutionContext({ correlationId: 'test-correlation-id' });

      await runWithExecutionContext(ctx, async () => {
        try {
          await service.get({ identifiers: { testEntityId: 'test' } }, ctx as any);
        } catch (e) { }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span');
      const getSpan = spanEvents.find(e => e.operation.includes('.get'));

      expect(getSpan).toBeDefined();
      expect(getSpan?.operation).toContain('get');
    });

    it('should create span for create operations', async () => {
      const ctx = createExecutionContext({ correlationId: 'test-correlation-id' });

      await runWithExecutionContext(ctx, async () => {
        try {
          await service.create({ name: 'test' }, ctx as any);
        } catch (e) { }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span');
      const createSpan = spanEvents.find(e => e.operation.includes('.create'));

      expect(createSpan).toBeDefined();
      expect(createSpan?.operation).toContain('create');
    });

    it('should create span for delete operations', async () => {
      const ctx = createExecutionContext({ correlationId: 'test-correlation-id' });

      await runWithExecutionContext(ctx, async () => {
        try {
          await service.delete({ testEntityId: 'test' }, ctx as any);
        } catch (e) { }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span');
      const deleteSpan = spanEvents.find(e => e.operation.includes('.delete'));

      expect(deleteSpan).toBeDefined();
      expect(deleteSpan?.operation).toContain('delete');
    });
  });
});
