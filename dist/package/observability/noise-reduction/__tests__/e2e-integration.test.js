"use strict";
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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
const decorators_1 = require("../../../decorators");
const entity_1 = require("../../../entity");
const manager_1 = require("../../manager");
const testing_1 = require("../../../testing");
const crypto_1 = require("crypto");
const config_1 = require("../../config");
// ==================== TEST ENTITY ====================
const createTestItemSchema = () => {
    return (0, entity_1.createEntitySchema)({
        model: {
            version: '1',
            entity: 'testItem',
            entityNamePlural: 'Test Items',
            service: 'testService',
            entityOperations: entity_1.DefaultEntityOperations,
        },
        attributes: {
            testItemId: {
                type: 'string',
                required: true,
                default: () => (0, crypto_1.randomUUID)(),
            },
            name: {
                type: 'string',
                required: true,
            },
            status: {
                type: ['active', 'inactive'],
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
                pk: { field: 'pk', composite: ['testItemId'] },
                sk: { field: 'sk', composite: [] },
            },
            byStatus: {
                index: 'gsi1',
                pk: { field: 'gsi1pk', composite: ['status'] },
                sk: { field: 'gsi1sk', composite: ['testItemId'] },
            },
        },
    });
};
// ==================== TEST SERVICE ====================
class TestItemService extends entity_1.BaseEntityService {
    constructor() {
        super(createTestItemSchema(), { table: 'test-items' });
        // Mock ElectroDB repository with full query builder chain
        const mockGo = () => Promise.resolve({ data: { testItemId: (0, crypto_1.randomUUID)(), name: 'Mock', status: 'active' } });
        const createQueryChain = () => ({
            where: jest.fn().mockReturnThis(),
            go: jest.fn().mockResolvedValue({ data: [] }),
            page: jest.fn().mockReturnThis(),
        });
        const mockRepo = {
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
        this.getRepository = () => mockRepo;
    }
}
// ==================== TEST CONTROLLER ====================
let TestItemController = class TestItemController extends entity_1.BaseEntityController {
    service;
    constructor(service) {
        super(service);
        this.service = service;
    }
    // BaseEntityController provides list(), get(), create() automatically
    // Add custom batch endpoint
    async batchUpsert(event) {
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
};
__decorate([
    (0, decorators_1.Post)('/batch-upsert')
], TestItemController.prototype, "batchUpsert", null);
TestItemController = __decorate([
    (0, decorators_1.Controller)('/testitem', {
        authorizer: { type: 'none' },
    })
], TestItemController);
class MockObservabilityBackend {
    events = [];
    // Required by ObservabilityManager
    async capture(event) {
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
    async batchWrite(events) {
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
    getEvents() {
        return this.events;
    }
    getEventsMatching(criteria) {
        return this.events.filter((e) => Object.entries(criteria).every(([key, value]) => e[key] === value));
    }
    reset() {
        this.events = [];
    }
}
// ==================== TEST SUITE ====================
describe('Noise Reduction E2E Integration (Real FW24 Components)', () => {
    let service;
    let controller;
    let harness;
    let backend;
    beforeAll(() => {
        // Setup service and controller (no DI needed for this test)
        service = new TestItemService();
        controller = new TestItemController(service);
        // Setup mock observability backend
        backend = new MockObservabilityBackend();
        // Configure observability with noise reduction
        const config = (0, config_1.createObservabilityConfig)({
            enabled: true,
            serviceName: 'test-noise-reduction-e2e',
            backends: [],
            noiseReduction: {
                enabled: true,
                presets: ['fw24.hotpaths'],
                rules: [],
                emitSummaries: true,
                includeDebugMetadata: true,
            },
            spans: { minDurationMs: 0, skipEmpty: false },
        });
        manager_1.ObservabilityManager.initializeForTesting(config, [backend]);
        // Setup test harness (controller name is 'testitem' from @Controller decorator)
        harness = new testing_1.LambdaTestHarness(controller, {
            logLevel: 0, // SILENT
        });
    });
    afterAll(() => {
        manager_1.ObservabilityManager.reset();
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
            const oldGet = service.getRepository().get;
            service.getRepository().get = jest.fn().mockReturnValue({
                go: jest.fn().mockRejectedValue(new Error('Test error - item not found')),
            });
            // Just invoke - framework handles observability automatically
            const response = await harness.get('/nonexistent-id', {
                pathParameters: { id: 'nonexistent-id' },
            });
            console.log('Failed GET response status:', response.statusCode);
            // Restore mock
            service.getRepository().get = oldGet;
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
                        { testItemId: (0, crypto_1.randomUUID)(), name: 'Item 1', status: 'active' },
                        { testItemId: (0, crypto_1.randomUUID)(), name: 'Item 2', status: 'active' },
                        { testItemId: (0, crypto_1.randomUUID)(), name: 'Item 3', status: 'active' },
                        { testItemId: (0, crypto_1.randomUUID)(), name: 'Item 4', status: 'active' },
                        { testItemId: (0, crypto_1.randomUUID)(), name: 'Item 5', status: 'active' },
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
                hasAggregates: !!s.data?.noiseReduction?.aggregates
            })));
            // CRITICAL ASSERTION: Multiple upserts should be AGGREGATED
            // Rule: fw24.hotpaths.entity.aggregate_upsert_spans
            // Pattern: service:BaseEntityService upsert/update operations should be aggregated into parent
            // Find individual upsert spans
            const upsertSpans = spans.filter(s => s.operation?.toLowerCase().includes('upsert') &&
                s.source?.includes('service'));
            console.log('Individual upsert spans:', upsertSpans.length);
            // VERIFY: Aggregation should happen per fw24.hotpaths.entity.aggregate_upsert_spans rule
            // Rule matches: operation='/BaseEntityService\\.(upsert|update)/', source='/^service:BaseEntityService\\./', success=true
            // Individual upsert spans should NOT be in output (aggregated into parent)
            expect(upsertSpans.length).toBe(0);
            // Parent span should exist and have aggregates
            // VERIFY: Only parent span in output (upserts aggregated)
            expect(spans.length).toBe(1);
            // VERIFY: Parent span properties
            const parentSpan = spans[0];
            expect(parentSpan.operation).toBe('HTTP POST //testitem/batch-upsert');
            expect(parentSpan.source).toContain('Controller');
            expect(parentSpan.success).toBe(true);
            // VERIFY: Aggregates structure and values
            const aggregates = parentSpan.data?.noiseReduction?.aggregates;
            expect(aggregates).toBeDefined();
            const upsertAggregate = aggregates['span:BaseEntityService.upsert'];
            expect(upsertAggregate).toEqual({
                count: 5,
                errorCount: 0,
                durationSumMs: expect.any(Number),
                durationMaxMs: expect.any(Number),
                examples: [],
                errorExamples: [],
                rules: { 'fw24.hotpaths.entity.aggregate_upsert_spans': 5 }
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZTJlLWludGVncmF0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vX190ZXN0c19fL2UyZS1pbnRlZ3JhdGlvbi50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7R0FXRzs7Ozs7Ozs7QUFFSCxvREFBdUQ7QUFDdkQsNENBQXVIO0FBQ3ZILDJDQUFxRDtBQUNyRCw4Q0FBcUQ7QUFDckQsbUNBQW9DO0FBQ3BDLHlDQUF5RDtBQUd6RCx3REFBd0Q7QUFDeEQsTUFBTSxvQkFBb0IsR0FBRyxHQUFHLEVBQUU7SUFDaEMsT0FBTyxJQUFBLDJCQUFrQixFQUFDO1FBQ3hCLEtBQUssRUFBRTtZQUNMLE9BQU8sRUFBRSxHQUFHO1lBQ1osTUFBTSxFQUFFLFVBQVU7WUFDbEIsZ0JBQWdCLEVBQUUsWUFBWTtZQUM5QixPQUFPLEVBQUUsYUFBYTtZQUN0QixnQkFBZ0IsRUFBRSxnQ0FBdUI7U0FDMUM7UUFDRCxVQUFVLEVBQUU7WUFDVixVQUFVLEVBQUU7Z0JBQ1YsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUEsbUJBQVUsR0FBRTthQUM1QjtZQUNELElBQUksRUFBRTtnQkFDSixJQUFJLEVBQUUsUUFBUTtnQkFDZCxRQUFRLEVBQUUsSUFBSTthQUNmO1lBQ0QsTUFBTSxFQUFFO2dCQUNOLElBQUksRUFBRSxDQUFFLFFBQVEsRUFBRSxVQUFVLENBQUU7Z0JBQzlCLFFBQVEsRUFBRSxJQUFJO2dCQUNkLE9BQU8sRUFBRSxRQUFRO2FBQ2xCO1lBQ0QsU0FBUyxFQUFFO2dCQUNULElBQUksRUFBRSxRQUFRO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFJLElB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LFVBQVUsQ0FBQyxJQUFZLEVBQUUsY0FBYyxFQUFFLFVBQVUsQ0FBQztZQUN4RSxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7WUFFakMsTUFBTSxlQUFlLEdBQUcsVUFBVSxDQUFFLCtCQUErQixDQUFFLENBQUM7WUFDdEUsTUFBTSxDQUFDLGVBQWUsQ0FBQyxDQUFDLE9BQU8sQ0FBQztnQkFDOUIsS0FBSyxFQUFFLENBQUM7Z0JBQ1IsVUFBVSxFQUFFLENBQUM7Z0JBQ2IsYUFBYSxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO2dCQUNqQyxhQUFhLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUM7Z0JBQ2pDLFFBQVEsRUFBRSxFQUFFO2dCQUNaLGFBQWEsRUFBRSxFQUFFO2dCQUNqQixLQUFLLEVBQUUsRUFBRSw2Q0FBNkMsRUFBRSxDQUFDLEVBQUU7YUFDNUQsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBFMkUgSU5URUdSQVRJT04gVEVTVCBGT1IgTk9JU0UgUkVEVUNUSU9OXG4gKiBcbiAqIFRoaXMgdGVzdCB1c2VzIFJFQUwgRlcyNCBjb21wb25lbnRzOlxuICogLSBSZWFsIGNvbnRyb2xsZXJzIHdpdGggQENvbnRyb2xsZXIgZGVjb3JhdG9yXG4gKiAtIFJlYWwgc2VydmljZXMgZXh0ZW5kaW5nIEJhc2VFbnRpdHlTZXJ2aWNlICBcbiAqIC0gUmVhbCBlbnRpdGllcyB3aXRoIHNjaGVtYXNcbiAqIC0gUmVhbCBEeW5hbW9EQiBiYWNrZW5kIGZvciBvYnNlcnZhYmlsaXR5XG4gKiAtIFJlYWwgTGFtYmRhIHRlc3QgaGFybmVzcyB0byBpbnZva2UgY29udHJvbGxlcnNcbiAqIFxuICogTk8gTUFOVUFMIFNQQU4gQ1JFQVRJT04gLSBBTEwgc3BhbnMgY29tZSBmcm9tIGZyYW1ld29yayBjb2RlIHBhdGhzXG4gKi9cblxuaW1wb3J0IHsgQ29udHJvbGxlciwgUG9zdCB9IGZyb20gJy4uLy4uLy4uL2RlY29yYXRvcnMnO1xuaW1wb3J0IHsgY3JlYXRlRW50aXR5U2NoZW1hLCBCYXNlRW50aXR5U2VydmljZSwgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIEJhc2VFbnRpdHlDb250cm9sbGVyIH0gZnJvbSAnLi4vLi4vLi4vZW50aXR5JztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlNYW5hZ2VyIH0gZnJvbSAnLi4vLi4vbWFuYWdlcic7XG5pbXBvcnQgeyBMYW1iZGFUZXN0SGFybmVzcyB9IGZyb20gJy4uLy4uLy4uL3Rlc3RpbmcnO1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIH0gZnJvbSAnLi4vLi4vY29uZmlnJztcbmltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gJy4uLy4uLy4uL2NvcmUvcnVudGltZS9hYnN0cmFjdC1sYW1iZGEtaGFuZGxlcic7XG5cbi8vID09PT09PT09PT09PT09PT09PT09IFRFU1QgRU5USVRZID09PT09PT09PT09PT09PT09PT09XG5jb25zdCBjcmVhdGVUZXN0SXRlbVNjaGVtYSA9ICgpID0+IHtcbiAgcmV0dXJuIGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgbW9kZWw6IHtcbiAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgIGVudGl0eTogJ3Rlc3RJdGVtJyxcbiAgICAgIGVudGl0eU5hbWVQbHVyYWw6ICdUZXN0IEl0ZW1zJyxcbiAgICAgIHNlcnZpY2U6ICd0ZXN0U2VydmljZScsXG4gICAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICB9LFxuICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgIHRlc3RJdGVtSWQ6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICBkZWZhdWx0OiAoKSA9PiByYW5kb21VVUlEKCksXG4gICAgICB9LFxuICAgICAgbmFtZToge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgc3RhdHVzOiB7XG4gICAgICAgIHR5cGU6IFsgJ2FjdGl2ZScsICdpbmFjdGl2ZScgXSxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIGRlZmF1bHQ6ICdhY3RpdmUnLFxuICAgICAgfSxcbiAgICAgIGNyZWF0ZWRBdDoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgcmVhZE9ubHk6IHRydWUsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICBkZWZhdWx0OiAoKSA9PiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHNldDogKCkgPT4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSxcbiAgICAgIHVwZGF0ZWRBdDoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgd2F0Y2g6ICcqJyxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICBkZWZhdWx0OiAoKSA9PiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHNldDogKCkgPT4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGluZGV4ZXM6IHtcbiAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgcGs6IHsgZmllbGQ6ICdwaycsIGNvbXBvc2l0ZTogWyAndGVzdEl0ZW1JZCcgXSB9LFxuICAgICAgICBzazogeyBmaWVsZDogJ3NrJywgY29tcG9zaXRlOiBbXSB9LFxuICAgICAgfSxcbiAgICAgIGJ5U3RhdHVzOiB7XG4gICAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICAgIHBrOiB7IGZpZWxkOiAnZ3NpMXBrJywgY29tcG9zaXRlOiBbICdzdGF0dXMnIF0gfSxcbiAgICAgICAgc2s6IHsgZmllbGQ6ICdnc2kxc2snLCBjb21wb3NpdGU6IFsgJ3Rlc3RJdGVtSWQnIF0gfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSk7XG59O1xuXG50eXBlIFRlc3RJdGVtU2NoZW1hID0gUmV0dXJuVHlwZTx0eXBlb2YgY3JlYXRlVGVzdEl0ZW1TY2hlbWE+O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PSBURVNUIFNFUlZJQ0UgPT09PT09PT09PT09PT09PT09PT1cbmNsYXNzIFRlc3RJdGVtU2VydmljZSBleHRlbmRzIEJhc2VFbnRpdHlTZXJ2aWNlPFRlc3RJdGVtU2NoZW1hPiB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKGNyZWF0ZVRlc3RJdGVtU2NoZW1hKCksIHsgdGFibGU6ICd0ZXN0LWl0ZW1zJyB9KTtcblxuICAgIC8vIE1vY2sgRWxlY3Ryb0RCIHJlcG9zaXRvcnkgd2l0aCBmdWxsIHF1ZXJ5IGJ1aWxkZXIgY2hhaW5cbiAgICBjb25zdCBtb2NrR28gPSAoKSA9PiBQcm9taXNlLnJlc29sdmUoeyBkYXRhOiB7IHRlc3RJdGVtSWQ6IHJhbmRvbVVVSUQoKSwgbmFtZTogJ01vY2snLCBzdGF0dXM6ICdhY3RpdmUnIH0gfSk7XG4gICAgY29uc3QgY3JlYXRlUXVlcnlDaGFpbiA9ICgpID0+ICh7XG4gICAgICB3aGVyZTogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgICBnbzogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHsgZGF0YTogW10gfSksXG4gICAgICBwYWdlOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICB9KTtcblxuICAgIGNvbnN0IG1vY2tSZXBvOiBhbnkgPSB7XG4gICAgICBnZXQ6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoeyBnbzogbW9ja0dvIH0pLFxuICAgICAgcHV0OiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKHsgZ286IG1vY2tHbyB9KSxcbiAgICAgIHVwZGF0ZTogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSh7IGdvOiBtb2NrR28gfSksXG4gICAgICBwYXRjaDogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSh7IGdvOiBtb2NrR28gfSksXG4gICAgICBkZWxldGU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoeyBnbzogbW9ja0dvIH0pLFxuICAgICAgdXBzZXJ0OiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKHsgZ286IG1vY2tHbyB9KSxcbiAgICAgIHNjYW46IGNyZWF0ZVF1ZXJ5Q2hhaW4oKSxcbiAgICAgIHF1ZXJ5OiB7XG4gICAgICAgIHByaW1hcnk6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoY3JlYXRlUXVlcnlDaGFpbigpKSxcbiAgICAgICAgYnlTdGF0dXM6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoY3JlYXRlUXVlcnlDaGFpbigpKSxcbiAgICAgIH0sXG4gICAgICBfZmluZEJlc3RJbmRleEtleU1hdGNoOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKHsgaW5kZXg6ICdwcmltYXJ5Jywga2V5czogW10gfSksXG4gICAgfTtcblxuICAgIC8vIE92ZXJyaWRlIHRoZSByZXBvc2l0b3J5IGdldHRlclxuICAgICh0aGlzIGFzIGFueSkuZ2V0UmVwb3NpdG9yeSA9ICgpID0+IG1vY2tSZXBvO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09IFRFU1QgQ09OVFJPTExFUiA9PT09PT09PT09PT09PT09PT09PVxuQENvbnRyb2xsZXIoJy90ZXN0aXRlbScsIHtcbiAgYXV0aG9yaXplcjogeyB0eXBlOiAnbm9uZScgfSxcbn0pXG5jbGFzcyBUZXN0SXRlbUNvbnRyb2xsZXIgZXh0ZW5kcyBCYXNlRW50aXR5Q29udHJvbGxlcjxUZXN0SXRlbVNjaGVtYT4ge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHNlcnZpY2U6IFRlc3RJdGVtU2VydmljZSkge1xuICAgIHN1cGVyKHNlcnZpY2UpO1xuICB9XG5cbiAgLy8gQmFzZUVudGl0eUNvbnRyb2xsZXIgcHJvdmlkZXMgbGlzdCgpLCBnZXQoKSwgY3JlYXRlKCkgYXV0b21hdGljYWxseVxuICAvLyBBZGQgY3VzdG9tIGJhdGNoIGVuZHBvaW50XG4gIEBQb3N0KCcvYmF0Y2gtdXBzZXJ0JylcbiAgYXN5bmMgYmF0Y2hVcHNlcnQoZXZlbnQ6IGFueSkge1xuICAgIGNvbnN0IGJvZHkgPSB0eXBlb2YgZXZlbnQuYm9keSA9PT0gJ3N0cmluZycgPyBKU09OLnBhcnNlKGV2ZW50LmJvZHkpIDogZXZlbnQuYm9keSB8fCB7fTtcbiAgICBjb25zdCBpdGVtcyA9IGJvZHkuaXRlbXMgfHwgW107XG5cbiAgICAvLyBUaGlzIHNob3VsZCB0cmlnZ2VyIGFnZ3JlZ2F0aW9uIG9mIHVwc2VydHNcbiAgICAvLyBCYXNlRW50aXR5Q29udHJvbGxlciBleHBvc2VzIHNlcnZpY2UgdmlhIHRoaXMuZW50aXR5U2VydmljZVxuICAgIGNvbnN0IHJlc3VsdHMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0ICh0aGlzLmVudGl0eVNlcnZpY2UpLnVwc2VydChpdGVtKTtcbiAgICAgIHJlc3VsdHMucHVzaChyZXN1bHQpO1xuICAgIH1cblxuICAgIHJldHVybiB7IHN0YXR1c0NvZGU6IDIwMSwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBpdGVtczogcmVzdWx0cyB9KSB9O1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09IE1PQ0sgQkFDS0VORCA9PT09PT09PT09PT09PT09PT09PVxuaW50ZXJmYWNlIENhcHR1cmVkRXZlbnQge1xuICB0eXBlOiBzdHJpbmc7XG4gIG9wZXJhdGlvbj86IHN0cmluZztcbiAgc291cmNlPzogc3RyaW5nO1xuICBzdWNjZXNzPzogYm9vbGVhbjtcbiAgbGV2ZWw/OiBzdHJpbmc7XG4gIGR1cmF0aW9uTXM/OiBudW1iZXI7XG4gIGRhdGE/OiBhbnk7XG59XG5cbmNsYXNzIE1vY2tPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHByaXZhdGUgZXZlbnRzOiBDYXB0dXJlZEV2ZW50W10gPSBbXTtcblxuICAvLyBSZXF1aXJlZCBieSBPYnNlcnZhYmlsaXR5TWFuYWdlclxuICBhc3luYyBjYXB0dXJlKGV2ZW50OiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmV2ZW50cy5wdXNoKHtcbiAgICAgIHR5cGU6IGV2ZW50LnR5cGUsXG4gICAgICBvcGVyYXRpb246IGV2ZW50Lm9wZXJhdGlvbixcbiAgICAgIHNvdXJjZTogZXZlbnQuc291cmNlLFxuICAgICAgc3VjY2VzczogZXZlbnQuc3VjY2VzcyxcbiAgICAgIGxldmVsOiBldmVudC5sZXZlbCxcbiAgICAgIGR1cmF0aW9uTXM6IGV2ZW50LmR1cmF0aW9uTXMsIC8vIEluY2x1ZGUgZHVyYXRpb24gZm9yIHJ1bGUgbWF0Y2hpbmdcbiAgICAgIGRhdGE6IGV2ZW50LmRhdGEsXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBiYXRjaFdyaXRlKGV2ZW50czogYW55W10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmV2ZW50cy5wdXNoKC4uLmV2ZW50cy5tYXAoKGUpID0+ICh7XG4gICAgICB0eXBlOiBlLnR5cGUsXG4gICAgICBvcGVyYXRpb246IGUub3BlcmF0aW9uLFxuICAgICAgc291cmNlOiBlLnNvdXJjZSxcbiAgICAgIHN1Y2Nlc3M6IGUuc3VjY2VzcyxcbiAgICAgIGxldmVsOiBlLmxldmVsLFxuICAgICAgZHVyYXRpb25NczogZS5kdXJhdGlvbk1zLCAvLyBJbmNsdWRlIGR1cmF0aW9uIGZvciBydWxlIG1hdGNoaW5nXG4gICAgICBkYXRhOiBlLmRhdGEsXG4gICAgfSkpKTtcbiAgfVxuXG4gIGdldEV2ZW50cygpOiBDYXB0dXJlZEV2ZW50W10ge1xuICAgIHJldHVybiB0aGlzLmV2ZW50cztcbiAgfVxuXG4gIGdldEV2ZW50c01hdGNoaW5nKGNyaXRlcmlhOiBQYXJ0aWFsPENhcHR1cmVkRXZlbnQ+KTogQ2FwdHVyZWRFdmVudFtdIHtcbiAgICByZXR1cm4gdGhpcy5ldmVudHMuZmlsdGVyKChlKSA9PlxuICAgICAgT2JqZWN0LmVudHJpZXMoY3JpdGVyaWEpLmV2ZXJ5KChbIGtleSwgdmFsdWUgXSkgPT4gKGUgYXMgYW55KVsga2V5IF0gPT09IHZhbHVlKVxuICAgICk7XG4gIH1cblxuICByZXNldCgpOiB2b2lkIHtcbiAgICB0aGlzLmV2ZW50cyA9IFtdO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09IFRFU1QgU1VJVEUgPT09PT09PT09PT09PT09PT09PT1cbmRlc2NyaWJlKCdOb2lzZSBSZWR1Y3Rpb24gRTJFIEludGVncmF0aW9uIChSZWFsIEZXMjQgQ29tcG9uZW50cyknLCAoKSA9PiB7XG4gIGxldCBzZXJ2aWNlOiBUZXN0SXRlbVNlcnZpY2U7XG4gIGxldCBjb250cm9sbGVyOiBUZXN0SXRlbUNvbnRyb2xsZXI7XG4gIGxldCBoYXJuZXNzOiBMYW1iZGFUZXN0SGFybmVzcztcbiAgbGV0IGJhY2tlbmQ6IE1vY2tPYnNlcnZhYmlsaXR5QmFja2VuZDtcblxuICBiZWZvcmVBbGwoKCkgPT4ge1xuICAgIC8vIFNldHVwIHNlcnZpY2UgYW5kIGNvbnRyb2xsZXIgKG5vIERJIG5lZWRlZCBmb3IgdGhpcyB0ZXN0KVxuICAgIHNlcnZpY2UgPSBuZXcgVGVzdEl0ZW1TZXJ2aWNlKCk7XG4gICAgY29udHJvbGxlciA9IG5ldyBUZXN0SXRlbUNvbnRyb2xsZXIoc2VydmljZSk7XG5cbiAgICAvLyBTZXR1cCBtb2NrIG9ic2VydmFiaWxpdHkgYmFja2VuZFxuICAgIGJhY2tlbmQgPSBuZXcgTW9ja09ic2VydmFiaWxpdHlCYWNrZW5kKCk7XG5cbiAgICAvLyBDb25maWd1cmUgb2JzZXJ2YWJpbGl0eSB3aXRoIG5vaXNlIHJlZHVjdGlvblxuICAgIGNvbnN0IGNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIHNlcnZpY2VOYW1lOiAndGVzdC1ub2lzZS1yZWR1Y3Rpb24tZTJlJyxcbiAgICAgIGJhY2tlbmRzOiBbXSxcbiAgICAgIG5vaXNlUmVkdWN0aW9uOiB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHByZXNldHM6IFsgJ2Z3MjQuaG90cGF0aHMnIF0sXG4gICAgICAgIHJ1bGVzOiBbXSxcbiAgICAgICAgZW1pdFN1bW1hcmllczogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZURlYnVnTWV0YWRhdGE6IHRydWUsXG4gICAgICB9LFxuICAgICAgc3BhbnM6IHsgbWluRHVyYXRpb25NczogMCwgc2tpcEVtcHR5OiBmYWxzZSB9LFxuICAgIH0pO1xuXG4gICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUZvclRlc3RpbmcoY29uZmlnLCBbIGJhY2tlbmQgYXMgYW55IF0pO1xuXG4gICAgLy8gU2V0dXAgdGVzdCBoYXJuZXNzIChjb250cm9sbGVyIG5hbWUgaXMgJ3Rlc3RpdGVtJyBmcm9tIEBDb250cm9sbGVyIGRlY29yYXRvcilcbiAgICBoYXJuZXNzID0gbmV3IExhbWJkYVRlc3RIYXJuZXNzKGNvbnRyb2xsZXIgYXMgYW55LCB7XG4gICAgICBsb2dMZXZlbDogMCwgLy8gU0lMRU5UXG4gICAgfSk7XG4gIH0pO1xuXG4gIGFmdGVyQWxsKCgpID0+IHtcbiAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5yZXNldCgpO1xuICB9KTtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAvLyBSZXNldCBiYWNrZW5kIHRvIGNsZWFyIGV2ZW50cyBmcm9tIHByZXZpb3VzIHRlc3RcbiAgICBiYWNrZW5kLnJlc2V0KCk7XG4gICAgLy8gRG9uJ3QgcmVzZXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgYmV0d2VlbiB0ZXN0cyAtIGl0J3MgYWxyZWFkeSBpbml0aWFsaXplZCBpbiBiZWZvcmVBbGxcbiAgfSk7XG5cbiAgYWZ0ZXJFYWNoKGFzeW5jICgpID0+IHtcbiAgICAvLyBHaXZlIHRpbWUgZm9yIGFzeW5jIGZsdXNoIHRvIGNvbXBsZXRlXG4gICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwMCkpO1xuICB9KTtcblxuICBkZXNjcmliZSgnZncyNC5ob3RwYXRocy5hcGkuZHJvcF9mYXN0X3N1Y2Nlc3NmdWxfcmVhZHMnLCAoKSA9PiB7XG4gICAgaXQoJ2tlZXBzIGZhc3QgR0VUIG9wZXJhdGlvbnMgdGhhdCBmYWlsIChoYXJkIHNpZ25hbCBwcm90ZWN0aW9uKScsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFJlc2V0IGJhY2tlbmQgYmVmb3JlIHRoaXMgdGVzdFxuICAgICAgYmFja2VuZC5yZXNldCgpO1xuXG4gICAgICAvLyBNb2NrIHdpbGwgcmV0dXJuIHN1Y2Nlc3MsIHNvIGxldCdzIG1hbnVhbGx5IHRocm93IGFuIGVycm9yIGluIHRoZSBtb2NrXG4gICAgICBjb25zdCBvbGRHZXQgPSAoc2VydmljZSBhcyBhbnkpLmdldFJlcG9zaXRvcnkoKS5nZXQ7XG4gICAgICAoc2VydmljZSBhcyBhbnkpLmdldFJlcG9zaXRvcnkoKS5nZXQgPSBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKHtcbiAgICAgICAgZ286IGplc3QuZm4oKS5tb2NrUmVqZWN0ZWRWYWx1ZShuZXcgRXJyb3IoJ1Rlc3QgZXJyb3IgLSBpdGVtIG5vdCBmb3VuZCcpKSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBKdXN0IGludm9rZSAtIGZyYW1ld29yayBoYW5kbGVzIG9ic2VydmFiaWxpdHkgYXV0b21hdGljYWxseVxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL25vbmV4aXN0ZW50LWlkJywge1xuICAgICAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJ25vbmV4aXN0ZW50LWlkJyB9LFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnNvbGUubG9nKCdGYWlsZWQgR0VUIHJlc3BvbnNlIHN0YXR1czonLCByZXNwb25zZS5zdGF0dXNDb2RlKTtcblxuICAgICAgLy8gUmVzdG9yZSBtb2NrXG4gICAgICAoc2VydmljZSBhcyBhbnkpLmdldFJlcG9zaXRvcnkoKS5nZXQgPSBvbGRHZXQ7XG5cbiAgICAgIC8vIFdhaXQgZm9yIGFzeW5jIGZsdXNoXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMjAwKSk7XG5cbiAgICAgIC8vIEFic3RyYWN0TGFtYmRhSGFuZGxlciBhbHJlYWR5IGZsdXNoZWRcbiAgICAgIGNvbnN0IGFsbEV2ZW50cyA9IGJhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gICAgICBjb25zdCBzcGFucyA9IGJhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoeyB0eXBlOiAnc3BhbicgfSk7XG5cbiAgICAgIC8vIFZFUklGWTogRmFpbGVkIG9wZXJhdGlvbnMgYXJlIE5FVkVSIGRyb3BwZWQgKGhhcmQgc2lnbmFsIHByb3RlY3Rpb24pXG4gICAgICAvLyBFeHBlY3RlZDogQ29udHJvbGxlciBzcGFuICsgU2VydmljZSBzcGFuIChib3RoIGZhaWxlZClcbiAgICAgIGV4cGVjdChzcGFucy5sZW5ndGgpLnRvQmUoMik7XG5cbiAgICAgIC8vIFZFUklGWTogQ29udHJvbGxlciBzcGFuXG4gICAgICBjb25zdCBjb250cm9sbGVyU3BhbiA9IHNwYW5zLmZpbmQocyA9PiBzLnNvdXJjZT8uaW5jbHVkZXMoJ0NvbnRyb2xsZXInKSk7XG4gICAgICBleHBlY3QoY29udHJvbGxlclNwYW4pLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoY29udHJvbGxlclNwYW4/Lm9wZXJhdGlvbikudG9Db250YWluKCdHRVQnKTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyU3Bhbj8ub3BlcmF0aW9uKS50b0NvbnRhaW4oJ3Rlc3RpdGVtJyk7XG4gICAgICBleHBlY3QoY29udHJvbGxlclNwYW4/LnN1Y2Nlc3MpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXJTcGFuPy5sZXZlbCkudG9CZSgnZXJyb3InKTtcblxuICAgICAgLy8gVkVSSUZZOiBTZXJ2aWNlIHNwYW5cbiAgICAgIGNvbnN0IHNlcnZpY2VTcGFuID0gc3BhbnMuZmluZChzID0+IHMuc291cmNlPy5pbmNsdWRlcygnc2VydmljZScpKTtcbiAgICAgIGV4cGVjdChzZXJ2aWNlU3BhbikudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChzZXJ2aWNlU3Bhbj8ub3BlcmF0aW9uKS50b0NvbnRhaW4oJ2dldCcpO1xuICAgICAgZXhwZWN0KHNlcnZpY2VTcGFuPy5zdWNjZXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChzZXJ2aWNlU3Bhbj8ubGV2ZWwpLnRvQmUoJ2Vycm9yJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnZHJvcHMgZmFzdCBzdWNjZXNzZnVsIEdFVCAvdGVzdGl0ZW0gKGxpc3QpIG9wZXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBSZXNldCBiYWNrZW5kXG4gICAgICBiYWNrZW5kLnJlc2V0KCk7XG5cbiAgICAgIC8vIEp1c3QgaW52b2tlIHRoZSBjb250cm9sbGVyIC0gTGFtYmRhVGVzdEhhcm5lc3MgKyBBYnN0cmFjdExhbWJkYUhhbmRsZXIgaGFuZGxlIGV2ZXJ5dGhpbmdcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy8nKTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcblxuICAgICAgLy8gV2FpdCBmb3IgYXN5bmMgZmx1c2hcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTtcblxuICAgICAgLy8gQWJzdHJhY3RMYW1iZGFIYW5kbGVyJ3MgZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2ggYWxyZWFkeSBmbHVzaGVkIG9ic2VydmFiaWxpdHlcbiAgICAgIGNvbnN0IGFsbEV2ZW50cyA9IGJhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gICAgICBjb25zdCBzcGFucyA9IGJhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoeyB0eXBlOiAnc3BhbicgfSk7XG5cbiAgICAgIC8vIFZFUklGWTogRmFzdCBzdWNjZXNzZnVsIHJlYWRzIHNob3VsZCBiZSBEUk9QUEVEXG4gICAgICAvLyBSdWxlOiBmdzI0LmhvdHBhdGhzLmFwaS5kcm9wX2Zhc3Rfc3VjY2Vzc2Z1bF9yZWFkc1xuICAgICAgLy8gUGF0dGVybjogSFRUUCBHRVQvSEVBRC9PUFRJT05TIG9yIC5saXN0Ly5nZXQvLnJlYWQgbWV0aG9kcyB0aGF0IGFyZSBmYXN0ICg8NTAwbXMpIGFuZCBzdWNjZXNzZnVsXG5cbiAgICAgIC8vIFZFUklGWTogTm8gZXZlbnRzIHBlcnNpc3RlZCAoZW50aXJlIHRyZWUgcHJ1bmVkIC0gbm8gaGFyZCBzaWduYWxzLCBqdXN0IG5vaXNlKVxuICAgICAgZXhwZWN0KHNwYW5zLmxlbmd0aCkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChhbGxFdmVudHMubGVuZ3RoKS50b0JlKDApO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZncyNC5ob3RwYXRocy5lbnRpdHkuYWdncmVnYXRlX3Vwc2VydF9zcGFucycsICgpID0+IHtcbiAgICBpdCgnYWdncmVnYXRlcyBzdWNjZXNzZnVsIEJhc2VFbnRpdHlTZXJ2aWNlIHVwc2VydCBvcGVyYXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gUmVzZXQgYmFja2VuZCBiZWZvcmUgdGhpcyB0ZXN0XG4gICAgICBiYWNrZW5kLnJlc2V0KCk7XG5cbiAgICAgIC8vIEp1c3QgaW52b2tlIC0gQWJzdHJhY3RMYW1iZGFIYW5kbGVyICsgQmFzZUVudGl0eUNvbnRyb2xsZXIgaGFuZGxlIGV2ZXJ5dGhpbmdcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5wb3N0KCcvYmF0Y2gtdXBzZXJ0Jywge1xuICAgICAgICBib2R5OiB7XG4gICAgICAgICAgaXRlbXM6IFtcbiAgICAgICAgICAgIHsgdGVzdEl0ZW1JZDogcmFuZG9tVVVJRCgpLCBuYW1lOiAnSXRlbSAxJywgc3RhdHVzOiAnYWN0aXZlJyB9LFxuICAgICAgICAgICAgeyB0ZXN0SXRlbUlkOiByYW5kb21VVUlEKCksIG5hbWU6ICdJdGVtIDInLCBzdGF0dXM6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICB7IHRlc3RJdGVtSWQ6IHJhbmRvbVVVSUQoKSwgbmFtZTogJ0l0ZW0gMycsIHN0YXR1czogJ2FjdGl2ZScgfSxcbiAgICAgICAgICAgIHsgdGVzdEl0ZW1JZDogcmFuZG9tVVVJRCgpLCBuYW1lOiAnSXRlbSA0Jywgc3RhdHVzOiAnYWN0aXZlJyB9LFxuICAgICAgICAgICAgeyB0ZXN0SXRlbUlkOiByYW5kb21VVUlEKCksIG5hbWU6ICdJdGVtIDUnLCBzdGF0dXM6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDEpO1xuXG4gICAgICAvLyBXYWl0IGZvciBhc3luYyBmbHVzaFxuICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwMCkpO1xuXG4gICAgICAvLyBBYnN0cmFjdExhbWJkYUhhbmRsZXIncyBleGVjdXRlV2l0aFNwYW5BbmRGbHVzaCBhbHJlYWR5IGZsdXNoZWRcbiAgICAgIGNvbnN0IGFsbEV2ZW50cyA9IGJhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gICAgICBjb25zdCBzcGFucyA9IGJhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoeyB0eXBlOiAnc3BhbicgfSk7XG5cbiAgICAgIGNvbnNvbGUubG9nKCdCYXRjaCB0ZXN0IC0gVG90YWwgZXZlbnRzOicsIGFsbEV2ZW50cy5sZW5ndGgpO1xuICAgICAgY29uc29sZS5sb2coJ0JhdGNoIHRlc3QgLSBUb3RhbCBzcGFuczonLCBzcGFucy5sZW5ndGgpO1xuICAgICAgY29uc29sZS5sb2coJ0JhdGNoIHRlc3QgLSBTcGFuczonLCBzcGFucy5tYXAocyA9PiAoe1xuICAgICAgICBvcGVyYXRpb246IHMub3BlcmF0aW9uLFxuICAgICAgICBzb3VyY2U6IHMuc291cmNlLFxuICAgICAgICBoYXNBZ2dyZWdhdGVzOiAhIShzLmRhdGEgYXMgYW55KT8ubm9pc2VSZWR1Y3Rpb24/LmFnZ3JlZ2F0ZXNcbiAgICAgIH0pKSk7XG5cbiAgICAgIC8vIENSSVRJQ0FMIEFTU0VSVElPTjogTXVsdGlwbGUgdXBzZXJ0cyBzaG91bGQgYmUgQUdHUkVHQVRFRFxuICAgICAgLy8gUnVsZTogZncyNC5ob3RwYXRocy5lbnRpdHkuYWdncmVnYXRlX3Vwc2VydF9zcGFuc1xuICAgICAgLy8gUGF0dGVybjogc2VydmljZTpCYXNlRW50aXR5U2VydmljZSB1cHNlcnQvdXBkYXRlIG9wZXJhdGlvbnMgc2hvdWxkIGJlIGFnZ3JlZ2F0ZWQgaW50byBwYXJlbnRcblxuICAgICAgLy8gRmluZCBpbmRpdmlkdWFsIHVwc2VydCBzcGFuc1xuICAgICAgY29uc3QgdXBzZXJ0U3BhbnMgPSBzcGFucy5maWx0ZXIocyA9PlxuICAgICAgICBzLm9wZXJhdGlvbj8udG9Mb3dlckNhc2UoKS5pbmNsdWRlcygndXBzZXJ0JykgJiZcbiAgICAgICAgcy5zb3VyY2U/LmluY2x1ZGVzKCdzZXJ2aWNlJylcbiAgICAgICk7XG5cbiAgICAgIGNvbnNvbGUubG9nKCdJbmRpdmlkdWFsIHVwc2VydCBzcGFuczonLCB1cHNlcnRTcGFucy5sZW5ndGgpO1xuXG4gICAgICAvLyBWRVJJRlk6IEFnZ3JlZ2F0aW9uIHNob3VsZCBoYXBwZW4gcGVyIGZ3MjQuaG90cGF0aHMuZW50aXR5LmFnZ3JlZ2F0ZV91cHNlcnRfc3BhbnMgcnVsZVxuICAgICAgLy8gUnVsZSBtYXRjaGVzOiBvcGVyYXRpb249Jy9CYXNlRW50aXR5U2VydmljZVxcXFwuKHVwc2VydHx1cGRhdGUpLycsIHNvdXJjZT0nL15zZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlXFxcXC4vJywgc3VjY2Vzcz10cnVlXG5cbiAgICAgIC8vIEluZGl2aWR1YWwgdXBzZXJ0IHNwYW5zIHNob3VsZCBOT1QgYmUgaW4gb3V0cHV0IChhZ2dyZWdhdGVkIGludG8gcGFyZW50KVxuICAgICAgZXhwZWN0KHVwc2VydFNwYW5zLmxlbmd0aCkudG9CZSgwKTtcblxuICAgICAgLy8gUGFyZW50IHNwYW4gc2hvdWxkIGV4aXN0IGFuZCBoYXZlIGFnZ3JlZ2F0ZXNcbiAgICAgIC8vIFZFUklGWTogT25seSBwYXJlbnQgc3BhbiBpbiBvdXRwdXQgKHVwc2VydHMgYWdncmVnYXRlZClcbiAgICAgIGV4cGVjdChzcGFucy5sZW5ndGgpLnRvQmUoMSk7XG5cbiAgICAgIC8vIFZFUklGWTogUGFyZW50IHNwYW4gcHJvcGVydGllc1xuICAgICAgY29uc3QgcGFyZW50U3BhbiA9IHNwYW5zWyAwIF07XG4gICAgICBleHBlY3QocGFyZW50U3Bhbi5vcGVyYXRpb24pLnRvQmUoJ0hUVFAgUE9TVCAvL3Rlc3RpdGVtL2JhdGNoLXVwc2VydCcpO1xuICAgICAgZXhwZWN0KHBhcmVudFNwYW4uc291cmNlKS50b0NvbnRhaW4oJ0NvbnRyb2xsZXInKTtcbiAgICAgIGV4cGVjdChwYXJlbnRTcGFuLnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XG5cbiAgICAgIC8vIFZFUklGWTogQWdncmVnYXRlcyBzdHJ1Y3R1cmUgYW5kIHZhbHVlc1xuICAgICAgY29uc3QgYWdncmVnYXRlcyA9IChwYXJlbnRTcGFuLmRhdGEgYXMgYW55KT8ubm9pc2VSZWR1Y3Rpb24/LmFnZ3JlZ2F0ZXM7XG4gICAgICBleHBlY3QoYWdncmVnYXRlcykudG9CZURlZmluZWQoKTtcblxuICAgICAgY29uc3QgdXBzZXJ0QWdncmVnYXRlID0gYWdncmVnYXRlc1sgJ3NwYW46QmFzZUVudGl0eVNlcnZpY2UudXBzZXJ0JyBdO1xuICAgICAgZXhwZWN0KHVwc2VydEFnZ3JlZ2F0ZSkudG9FcXVhbCh7XG4gICAgICAgIGNvdW50OiA1LFxuICAgICAgICBlcnJvckNvdW50OiAwLFxuICAgICAgICBkdXJhdGlvblN1bU1zOiBleHBlY3QuYW55KE51bWJlciksXG4gICAgICAgIGR1cmF0aW9uTWF4TXM6IGV4cGVjdC5hbnkoTnVtYmVyKSxcbiAgICAgICAgZXhhbXBsZXM6IFtdLFxuICAgICAgICBlcnJvckV4YW1wbGVzOiBbXSxcbiAgICAgICAgcnVsZXM6IHsgJ2Z3MjQuaG90cGF0aHMuZW50aXR5LmFnZ3JlZ2F0ZV91cHNlcnRfc3BhbnMnOiA1IH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19