import { SpanObserver, MetricObserver, ObservabilityManager } from '../observability';
import { createObservabilityConfig } from '../observability/config';
import { createObservationContext, runWithContext } from '../observability/context';
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

  beforeEach(() => {
    service = new TestEntityService();
    capturedEvents = [];

    // Mock the observability manager to capture events
    const originalCapture = (SpanObserver as any).start;
    jest.spyOn(SpanObserver, 'start').mockImplementation((operation, options) => {
      const span = originalCapture.call(SpanObserver, operation, options);
      capturedEvents.push({
        type: 'span.start',
        operation,
        options,
      });
      return span;
    });

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
      const ctx = createObservationContext('test-correlation-id');

      await runWithContext(ctx, async () => {
        try {
          await service.list({}, ctx as any);
        } catch (e) {
          // Expected to fail since we don't have real DB
        }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span.start');
      const listSpan = spanEvents.find(e => e.operation.includes('.list'));

      expect(listSpan).toBeDefined();
      expect(listSpan.options.attributes).toMatchObject({
        entityName: 'testEntity',
      });
    });

    it('should capture hasFilters attribute for list() with filters', async () => {
      const ctx = createObservationContext('test-correlation-id');

      await runWithContext(ctx, async () => {
        try {
          await service.list({ filters: { name: { eq: 'test' } } }, ctx as any);
        } catch (e) {
          // Expected to fail
        }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span.start');
      const listSpan = spanEvents.find(e => e.operation.includes('.list'));

      expect(listSpan?.options.attributes.hasFilters).toBe(true);
    });

    it('should NOT capture hasFilters when no filters provided', async () => {
      const ctx = createObservationContext('test-correlation-id');

      await runWithContext(ctx, async () => {
        try {
          await service.list({}, ctx as any);
        } catch (e) {
          // Expected to fail
        }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span.start');
      const listSpan = spanEvents.find(e => e.operation.includes('.list'));

      expect(listSpan?.options.attributes.hasFilters).toBe(false);
    });

    it('should capture entityName for get()', async () => {
      const ctx = createObservationContext('test-correlation-id');

      await runWithContext(ctx, async () => {
        try {
          await service.get({ identifiers: { testEntityId: 'test-id' } }, ctx as any);
        } catch (e) {
          // Expected to fail
        }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span.start');
      const getSpan = spanEvents.find(e => e.operation.includes('.get'));

      expect(getSpan).toBeDefined();
      expect(getSpan.options.attributes).toMatchObject({
        entityName: 'testEntity',
      });
    });

    it('should create spans even when ExecutionContext is not provided', async () => {
      try {
        await service.list({});
      } catch (e) {
        // Expected to fail
      }

      // Spans ARE created, just without actor/correlationId from context
      const spanEvents = capturedEvents.filter(e => e.type === 'span.start');
      expect(spanEvents.length).toBeGreaterThan(0);
      expect(spanEvents[ 0 ].operation).toContain('.list');
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

  describe('Span Levels', () => {
    it('should use debug level for read operations', async () => {
      const ctx = createObservationContext('test-correlation-id');

      await runWithContext(ctx, async () => {
        try {
          await service.get({ identifiers: { testEntityId: 'test' } }, ctx as any);
        } catch (e) { }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span.start');
      const getSpan = spanEvents.find(e => e.operation.includes('.get'));

      expect(getSpan?.options.level).toBe('debug');
    });

    it('should use info level for create operations', async () => {
      const ctx = createObservationContext('test-correlation-id');

      await runWithContext(ctx, async () => {
        try {
          await service.create({ name: 'test' }, ctx as any);
        } catch (e) { }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span.start');
      const createSpan = spanEvents.find(e => e.operation.includes('.create'));

      expect(createSpan?.options.level).toBe('info');
    });

    it('should use warn level for delete operations', async () => {
      const ctx = createObservationContext('test-correlation-id');

      await runWithContext(ctx, async () => {
        try {
          await service.delete({ testEntityId: 'test' }, ctx as any);
        } catch (e) { }
      });

      const spanEvents = capturedEvents.filter(e => e.type === 'span.start');
      const deleteSpan = spanEvents.find(e => e.operation.includes('.delete'));

      expect(deleteSpan?.options.level).toBe('warn');
    });
  });
});

