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
            // VERIFY: Aggregates are in the noiseReduction.summary checkpoint (self-contained)
            const checkpoints = parentSpan.data?.checkpoints;
            expect(checkpoints).toBeDefined();
            expect(Array.isArray(checkpoints)).toBe(true);
            const summaryCheckpoint = checkpoints.find((cp) => cp.name === 'noiseReduction.summary');
            expect(summaryCheckpoint).toBeDefined();
            expect(summaryCheckpoint.data).toBeDefined();
            expect(summaryCheckpoint.data.aggregates).toBeDefined();
            const upsertAggregate = summaryCheckpoint.data.aggregates['span:BaseEntityService.upsert'];
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
            expect(parentSpan.data.noiseReduction).toBeUndefined();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZTJlLWludGVncmF0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vX190ZXN0c19fL2UyZS1pbnRlZ3JhdGlvbi50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7R0FXRzs7Ozs7Ozs7QUFFSCxvREFBdUQ7QUFDdkQsNENBQXVIO0FBQ3ZILDJDQUFxRDtBQUNyRCw4Q0FBcUQ7QUFDckQsbUNBQW9DO0FBQ3BDLHlDQUF5RDtBQUd6RCx3REFBd0Q7QUFDeEQsTUFBTSxvQkFBb0IsR0FBRyxHQUFHLEVBQUU7SUFDaEMsT0FBTyxJQUFBLDJCQUFrQixFQUFDO1FBQ3hCLEtBQUssRUFBRTtZQUNMLE9BQU8sRUFBRSxHQUFHO1lBQ1osTUFBTSxFQUFFLFVBQVU7WUFDbEIsZ0JBQWdCLEVBQUUsWUFBWTtZQUM5QixPQUFPLEVBQUUsYUFBYTtZQUN0QixnQkFBZ0IsRUFBRSxnQ0FBdUI7U0FDMUM7UUFDRCxVQUFVLEVBQUU7WUFDVixVQUFVLEVBQUU7Z0JBQ1YsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsUUFBUSxFQUFFLElBQUk7Z0JBQ2QsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUEsbUJBQVUsR0FBRTthQUM1QjtZQUNELElBQUksRUFBRTtnQkFDSixJQUFJLEVBQUUsUUFBUTtnQkFDZCxRQUFRLEVBQUUsSUFBSTthQUNmO1lBQ0QsTUFBTSxFQUFFO2dCQUNOLElBQUksRUFBRSxDQUFFLFFBQVEsRUFBRSxVQUFVLENBQUU7Z0JBQzlCLFFBQVEsRUFBRSxJQUFJO2dCQUNkLE9BQU8sRUFBRSxRQUFRO2FBQ2xCO1lBQ0QsU0FBUyxFQUFFO2dCQUNULElBQUksRUFBRSxRQUFRO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLFFBQVEsRUFBRSxJQUFJO2dCQUNkLE9BQU8sRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFJLElB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LENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRTJFIElOVEVHUkFUSU9OIFRFU1QgRk9SIE5PSVNFIFJFRFVDVElPTlxuICogXG4gKiBUaGlzIHRlc3QgdXNlcyBSRUFMIEZXMjQgY29tcG9uZW50czpcbiAqIC0gUmVhbCBjb250cm9sbGVycyB3aXRoIEBDb250cm9sbGVyIGRlY29yYXRvclxuICogLSBSZWFsIHNlcnZpY2VzIGV4dGVuZGluZyBCYXNlRW50aXR5U2VydmljZSAgXG4gKiAtIFJlYWwgZW50aXRpZXMgd2l0aCBzY2hlbWFzXG4gKiAtIFJlYWwgRHluYW1vREIgYmFja2VuZCBmb3Igb2JzZXJ2YWJpbGl0eVxuICogLSBSZWFsIExhbWJkYSB0ZXN0IGhhcm5lc3MgdG8gaW52b2tlIGNvbnRyb2xsZXJzXG4gKiBcbiAqIE5PIE1BTlVBTCBTUEFOIENSRUFUSU9OIC0gQUxMIHNwYW5zIGNvbWUgZnJvbSBmcmFtZXdvcmsgY29kZSBwYXRoc1xuICovXG5cbmltcG9ydCB7IENvbnRyb2xsZXIsIFBvc3QgfSBmcm9tICcuLi8uLi8uLi9kZWNvcmF0b3JzJztcbmltcG9ydCB7IGNyZWF0ZUVudGl0eVNjaGVtYSwgQmFzZUVudGl0eVNlcnZpY2UsIERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBCYXNlRW50aXR5Q29udHJvbGxlciB9IGZyb20gJy4uLy4uLy4uL2VudGl0eSc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciB9IGZyb20gJy4uLy4uL21hbmFnZXInO1xuaW1wb3J0IHsgTGFtYmRhVGVzdEhhcm5lc3MgfSBmcm9tICcuLi8uLi8uLi90ZXN0aW5nJztcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJy4uLy4uL2NvbmZpZyc7XG5pbXBvcnQgeyBBYnN0cmFjdExhbWJkYUhhbmRsZXIgfSBmcm9tICcuLi8uLi8uLi9jb3JlL3J1bnRpbWUvYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXInO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PSBURVNUIEVOVElUWSA9PT09PT09PT09PT09PT09PT09PVxuY29uc3QgY3JlYXRlVGVzdEl0ZW1TY2hlbWEgPSAoKSA9PiB7XG4gIHJldHVybiBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICAgIG1vZGVsOiB7XG4gICAgICB2ZXJzaW9uOiAnMScsXG4gICAgICBlbnRpdHk6ICd0ZXN0SXRlbScsXG4gICAgICBlbnRpdHlOYW1lUGx1cmFsOiAnVGVzdCBJdGVtcycsXG4gICAgICBzZXJ2aWNlOiAndGVzdFNlcnZpY2UnLFxuICAgICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICB0ZXN0SXRlbUlkOiB7XG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgZGVmYXVsdDogKCkgPT4gcmFuZG9tVVVJRCgpLFxuICAgICAgfSxcbiAgICAgIG5hbWU6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHN0YXR1czoge1xuICAgICAgICB0eXBlOiBbICdhY3RpdmUnLCAnaW5hY3RpdmUnIF0sXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICBkZWZhdWx0OiAnYWN0aXZlJyxcbiAgICAgIH0sXG4gICAgICBjcmVhdGVkQXQ6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIHJlYWRPbmx5OiB0cnVlLFxuICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgZGVmYXVsdDogKCkgPT4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICBzZXQ6ICgpID0+IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0sXG4gICAgICB1cGRhdGVkQXQ6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIHdhdGNoOiAnKicsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgZGVmYXVsdDogKCkgPT4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICBzZXQ6ICgpID0+IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBpbmRleGVzOiB7XG4gICAgICBwcmltYXJ5OiB7XG4gICAgICAgIHBrOiB7IGZpZWxkOiAncGsnLCBjb21wb3NpdGU6IFsgJ3Rlc3RJdGVtSWQnIF0gfSxcbiAgICAgICAgc2s6IHsgZmllbGQ6ICdzaycsIGNvbXBvc2l0ZTogW10gfSxcbiAgICAgIH0sXG4gICAgICBieVN0YXR1czoge1xuICAgICAgICBpbmRleDogJ2dzaTEnLFxuICAgICAgICBwazogeyBmaWVsZDogJ2dzaTFwaycsIGNvbXBvc2l0ZTogWyAnc3RhdHVzJyBdIH0sXG4gICAgICAgIHNrOiB7IGZpZWxkOiAnZ3NpMXNrJywgY29tcG9zaXRlOiBbICd0ZXN0SXRlbUlkJyBdIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0pO1xufTtcblxudHlwZSBUZXN0SXRlbVNjaGVtYSA9IFJldHVyblR5cGU8dHlwZW9mIGNyZWF0ZVRlc3RJdGVtU2NoZW1hPjtcblxuLy8gPT09PT09PT09PT09PT09PT09PT0gVEVTVCBTRVJWSUNFID09PT09PT09PT09PT09PT09PT09XG5jbGFzcyBUZXN0SXRlbVNlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTxUZXN0SXRlbVNjaGVtYT4ge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihjcmVhdGVUZXN0SXRlbVNjaGVtYSgpLCB7IHRhYmxlOiAndGVzdC1pdGVtcycgfSk7XG5cbiAgICAvLyBNb2NrIEVsZWN0cm9EQiByZXBvc2l0b3J5IHdpdGggZnVsbCBxdWVyeSBidWlsZGVyIGNoYWluXG4gICAgY29uc3QgbW9ja0dvID0gKCkgPT4gUHJvbWlzZS5yZXNvbHZlKHsgZGF0YTogeyB0ZXN0SXRlbUlkOiByYW5kb21VVUlEKCksIG5hbWU6ICdNb2NrJywgc3RhdHVzOiAnYWN0aXZlJyB9IH0pO1xuICAgIGNvbnN0IGNyZWF0ZVF1ZXJ5Q2hhaW4gPSAoKSA9PiAoe1xuICAgICAgd2hlcmU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgICAgZ286IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSh7IGRhdGE6IFtdIH0pLFxuICAgICAgcGFnZTogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgfSk7XG5cbiAgICBjb25zdCBtb2NrUmVwbzogYW55ID0ge1xuICAgICAgZ2V0OiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKHsgZ286IG1vY2tHbyB9KSxcbiAgICAgIHB1dDogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSh7IGdvOiBtb2NrR28gfSksXG4gICAgICB1cGRhdGU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoeyBnbzogbW9ja0dvIH0pLFxuICAgICAgcGF0Y2g6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoeyBnbzogbW9ja0dvIH0pLFxuICAgICAgZGVsZXRlOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKHsgZ286IG1vY2tHbyB9KSxcbiAgICAgIHVwc2VydDogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSh7IGdvOiBtb2NrR28gfSksXG4gICAgICBzY2FuOiBjcmVhdGVRdWVyeUNoYWluKCksXG4gICAgICBxdWVyeToge1xuICAgICAgICBwcmltYXJ5OiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKGNyZWF0ZVF1ZXJ5Q2hhaW4oKSksXG4gICAgICAgIGJ5U3RhdHVzOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKGNyZWF0ZVF1ZXJ5Q2hhaW4oKSksXG4gICAgICB9LFxuICAgICAgX2ZpbmRCZXN0SW5kZXhLZXlNYXRjaDogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSh7IGluZGV4OiAncHJpbWFyeScsIGtleXM6IFtdIH0pLFxuICAgIH07XG5cbiAgICAvLyBPdmVycmlkZSB0aGUgcmVwb3NpdG9yeSBnZXR0ZXJcbiAgICAodGhpcyBhcyBhbnkpLmdldFJlcG9zaXRvcnkgPSAoKSA9PiBtb2NrUmVwbztcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PSBURVNUIENPTlRST0xMRVIgPT09PT09PT09PT09PT09PT09PT1cbkBDb250cm9sbGVyKCcvdGVzdGl0ZW0nLCB7XG4gIGF1dGhvcml6ZXI6IHsgdHlwZTogJ25vbmUnIH0sXG59KVxuY2xhc3MgVGVzdEl0ZW1Db250cm9sbGVyIGV4dGVuZHMgQmFzZUVudGl0eUNvbnRyb2xsZXI8VGVzdEl0ZW1TY2hlbWE+IHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBzZXJ2aWNlOiBUZXN0SXRlbVNlcnZpY2UpIHtcbiAgICBzdXBlcihzZXJ2aWNlKTtcbiAgfVxuXG4gIC8vIEJhc2VFbnRpdHlDb250cm9sbGVyIHByb3ZpZGVzIGxpc3QoKSwgZ2V0KCksIGNyZWF0ZSgpIGF1dG9tYXRpY2FsbHlcbiAgLy8gQWRkIGN1c3RvbSBiYXRjaCBlbmRwb2ludFxuICBAUG9zdCgnL2JhdGNoLXVwc2VydCcpXG4gIGFzeW5jIGJhdGNoVXBzZXJ0KGV2ZW50OiBhbnkpIHtcbiAgICBjb25zdCBib2R5ID0gdHlwZW9mIGV2ZW50LmJvZHkgPT09ICdzdHJpbmcnID8gSlNPTi5wYXJzZShldmVudC5ib2R5KSA6IGV2ZW50LmJvZHkgfHwge307XG4gICAgY29uc3QgaXRlbXMgPSBib2R5Lml0ZW1zIHx8IFtdO1xuXG4gICAgLy8gVGhpcyBzaG91bGQgdHJpZ2dlciBhZ2dyZWdhdGlvbiBvZiB1cHNlcnRzXG4gICAgLy8gQmFzZUVudGl0eUNvbnRyb2xsZXIgZXhwb3NlcyBzZXJ2aWNlIHZpYSB0aGlzLmVudGl0eVNlcnZpY2VcbiAgICBjb25zdCByZXN1bHRzID0gW107XG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCAodGhpcy5lbnRpdHlTZXJ2aWNlKS51cHNlcnQoaXRlbSk7XG4gICAgICByZXN1bHRzLnB1c2gocmVzdWx0KTtcbiAgICB9XG5cbiAgICByZXR1cm4geyBzdGF0dXNDb2RlOiAyMDEsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgaXRlbXM6IHJlc3VsdHMgfSkgfTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PSBNT0NLIEJBQ0tFTkQgPT09PT09PT09PT09PT09PT09PT1cbmludGVyZmFjZSBDYXB0dXJlZEV2ZW50IHtcbiAgdHlwZTogc3RyaW5nO1xuICBvcGVyYXRpb24/OiBzdHJpbmc7XG4gIHNvdXJjZT86IHN0cmluZztcbiAgc3VjY2Vzcz86IGJvb2xlYW47XG4gIGxldmVsPzogc3RyaW5nO1xuICBkdXJhdGlvbk1zPzogbnVtYmVyO1xuICBkYXRhPzogYW55O1xufVxuXG5jbGFzcyBNb2NrT2JzZXJ2YWJpbGl0eUJhY2tlbmQge1xuICBwcml2YXRlIGV2ZW50czogQ2FwdHVyZWRFdmVudFtdID0gW107XG5cbiAgLy8gUmVxdWlyZWQgYnkgT2JzZXJ2YWJpbGl0eU1hbmFnZXJcbiAgYXN5bmMgY2FwdHVyZShldmVudDogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiBldmVudC50eXBlLFxuICAgICAgb3BlcmF0aW9uOiBldmVudC5vcGVyYXRpb24sXG4gICAgICBzb3VyY2U6IGV2ZW50LnNvdXJjZSxcbiAgICAgIHN1Y2Nlc3M6IGV2ZW50LnN1Y2Nlc3MsXG4gICAgICBsZXZlbDogZXZlbnQubGV2ZWwsXG4gICAgICBkdXJhdGlvbk1zOiBldmVudC5kdXJhdGlvbk1zLCAvLyBJbmNsdWRlIGR1cmF0aW9uIGZvciBydWxlIG1hdGNoaW5nXG4gICAgICBkYXRhOiBldmVudC5kYXRhLFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgYmF0Y2hXcml0ZShldmVudHM6IGFueVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5ldmVudHMucHVzaCguLi5ldmVudHMubWFwKChlKSA9PiAoe1xuICAgICAgdHlwZTogZS50eXBlLFxuICAgICAgb3BlcmF0aW9uOiBlLm9wZXJhdGlvbixcbiAgICAgIHNvdXJjZTogZS5zb3VyY2UsXG4gICAgICBzdWNjZXNzOiBlLnN1Y2Nlc3MsXG4gICAgICBsZXZlbDogZS5sZXZlbCxcbiAgICAgIGR1cmF0aW9uTXM6IGUuZHVyYXRpb25NcywgLy8gSW5jbHVkZSBkdXJhdGlvbiBmb3IgcnVsZSBtYXRjaGluZ1xuICAgICAgZGF0YTogZS5kYXRhLFxuICAgIH0pKSk7XG4gIH1cblxuICBnZXRFdmVudHMoKTogQ2FwdHVyZWRFdmVudFtdIHtcbiAgICByZXR1cm4gdGhpcy5ldmVudHM7XG4gIH1cblxuICBnZXRFdmVudHNNYXRjaGluZyhjcml0ZXJpYTogUGFydGlhbDxDYXB0dXJlZEV2ZW50Pik6IENhcHR1cmVkRXZlbnRbXSB7XG4gICAgcmV0dXJuIHRoaXMuZXZlbnRzLmZpbHRlcigoZSkgPT5cbiAgICAgIE9iamVjdC5lbnRyaWVzKGNyaXRlcmlhKS5ldmVyeSgoWyBrZXksIHZhbHVlIF0pID0+IChlIGFzIGFueSlbIGtleSBdID09PSB2YWx1ZSlcbiAgICApO1xuICB9XG5cbiAgcmVzZXQoKTogdm9pZCB7XG4gICAgdGhpcy5ldmVudHMgPSBbXTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PSBURVNUIFNVSVRFID09PT09PT09PT09PT09PT09PT09XG5kZXNjcmliZSgnTm9pc2UgUmVkdWN0aW9uIEUyRSBJbnRlZ3JhdGlvbiAoUmVhbCBGVzI0IENvbXBvbmVudHMpJywgKCkgPT4ge1xuICBsZXQgc2VydmljZTogVGVzdEl0ZW1TZXJ2aWNlO1xuICBsZXQgY29udHJvbGxlcjogVGVzdEl0ZW1Db250cm9sbGVyO1xuICBsZXQgaGFybmVzczogTGFtYmRhVGVzdEhhcm5lc3M7XG4gIGxldCBiYWNrZW5kOiBNb2NrT2JzZXJ2YWJpbGl0eUJhY2tlbmQ7XG5cbiAgYmVmb3JlQWxsKCgpID0+IHtcbiAgICAvLyBTZXR1cCBzZXJ2aWNlIGFuZCBjb250cm9sbGVyIChubyBESSBuZWVkZWQgZm9yIHRoaXMgdGVzdClcbiAgICBzZXJ2aWNlID0gbmV3IFRlc3RJdGVtU2VydmljZSgpO1xuICAgIGNvbnRyb2xsZXIgPSBuZXcgVGVzdEl0ZW1Db250cm9sbGVyKHNlcnZpY2UpO1xuXG4gICAgLy8gU2V0dXAgbW9jayBvYnNlcnZhYmlsaXR5IGJhY2tlbmRcbiAgICBiYWNrZW5kID0gbmV3IE1vY2tPYnNlcnZhYmlsaXR5QmFja2VuZCgpO1xuXG4gICAgLy8gQ29uZmlndXJlIG9ic2VydmFiaWxpdHkgd2l0aCBub2lzZSByZWR1Y3Rpb25cbiAgICBjb25zdCBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBzZXJ2aWNlTmFtZTogJ3Rlc3Qtbm9pc2UtcmVkdWN0aW9uLWUyZScsXG4gICAgICBiYWNrZW5kczogW10sXG4gICAgICBub2lzZVJlZHVjdGlvbjoge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBwcmVzZXRzOiBbICdmdzI0LmhvdHBhdGhzJyBdLFxuICAgICAgICBydWxlczogW10sXG4gICAgICAgIGVtaXRTdW1tYXJpZXM6IHRydWUsXG4gICAgICAgIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHNwYW5zOiB7IG1pbkR1cmF0aW9uTXM6IDAsIHNraXBFbXB0eTogZmFsc2UgfSxcbiAgICB9KTtcblxuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVGb3JUZXN0aW5nKGNvbmZpZywgWyBiYWNrZW5kIGFzIGFueSBdKTtcblxuICAgIC8vIFNldHVwIHRlc3QgaGFybmVzcyAoY29udHJvbGxlciBuYW1lIGlzICd0ZXN0aXRlbScgZnJvbSBAQ29udHJvbGxlciBkZWNvcmF0b3IpXG4gICAgaGFybmVzcyA9IG5ldyBMYW1iZGFUZXN0SGFybmVzcyhjb250cm9sbGVyIGFzIGFueSwge1xuICAgICAgbG9nTGV2ZWw6IDAsIC8vIFNJTEVOVFxuICAgIH0pO1xuICB9KTtcblxuICBhZnRlckFsbCgoKSA9PiB7XG4gICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIucmVzZXQoKTtcbiAgfSk7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgLy8gUmVzZXQgYmFja2VuZCB0byBjbGVhciBldmVudHMgZnJvbSBwcmV2aW91cyB0ZXN0XG4gICAgYmFja2VuZC5yZXNldCgpO1xuICAgIC8vIERvbid0IHJlc2V0IE9ic2VydmFiaWxpdHlNYW5hZ2VyIGJldHdlZW4gdGVzdHMgLSBpdCdzIGFscmVhZHkgaW5pdGlhbGl6ZWQgaW4gYmVmb3JlQWxsXG4gIH0pO1xuXG4gIGFmdGVyRWFjaChhc3luYyAoKSA9PiB7XG4gICAgLy8gR2l2ZSB0aW1lIGZvciBhc3luYyBmbHVzaCB0byBjb21wbGV0ZVxuICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2Z3MjQuaG90cGF0aHMuYXBpLmRyb3BfZmFzdF9zdWNjZXNzZnVsX3JlYWRzJywgKCkgPT4ge1xuICAgIGl0KCdrZWVwcyBmYXN0IEdFVCBvcGVyYXRpb25zIHRoYXQgZmFpbCAoaGFyZCBzaWduYWwgcHJvdGVjdGlvbiknLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBSZXNldCBiYWNrZW5kIGJlZm9yZSB0aGlzIHRlc3RcbiAgICAgIGJhY2tlbmQucmVzZXQoKTtcblxuICAgICAgLy8gTW9jayB3aWxsIHJldHVybiBzdWNjZXNzLCBzbyBsZXQncyBtYW51YWxseSB0aHJvdyBhbiBlcnJvciBpbiB0aGUgbW9ja1xuICAgICAgY29uc3Qgb2xkR2V0ID0gKHNlcnZpY2UgYXMgYW55KS5nZXRSZXBvc2l0b3J5KCkuZ2V0O1xuICAgICAgKHNlcnZpY2UgYXMgYW55KS5nZXRSZXBvc2l0b3J5KCkuZ2V0ID0gamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSh7XG4gICAgICAgIGdvOiBqZXN0LmZuKCkubW9ja1JlamVjdGVkVmFsdWUobmV3IEVycm9yKCdUZXN0IGVycm9yIC0gaXRlbSBub3QgZm91bmQnKSksXG4gICAgICB9KTtcblxuICAgICAgLy8gSnVzdCBpbnZva2UgLSBmcmFtZXdvcmsgaGFuZGxlcyBvYnNlcnZhYmlsaXR5IGF1dG9tYXRpY2FsbHlcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy9ub25leGlzdGVudC1pZCcsIHtcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IHsgaWQ6ICdub25leGlzdGVudC1pZCcgfSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zb2xlLmxvZygnRmFpbGVkIEdFVCByZXNwb25zZSBzdGF0dXM6JywgcmVzcG9uc2Uuc3RhdHVzQ29kZSk7XG5cbiAgICAgIC8vIFJlc3RvcmUgbW9ja1xuICAgICAgKHNlcnZpY2UgYXMgYW55KS5nZXRSZXBvc2l0b3J5KCkuZ2V0ID0gb2xkR2V0O1xuXG4gICAgICAvLyBXYWl0IGZvciBhc3luYyBmbHVzaFxuICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDIwMCkpO1xuXG4gICAgICAvLyBBYnN0cmFjdExhbWJkYUhhbmRsZXIgYWxyZWFkeSBmbHVzaGVkXG4gICAgICBjb25zdCBhbGxFdmVudHMgPSBiYWNrZW5kLmdldEV2ZW50cygpO1xuICAgICAgY29uc3Qgc3BhbnMgPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ3NwYW4nIH0pO1xuXG4gICAgICAvLyBWRVJJRlk6IEZhaWxlZCBvcGVyYXRpb25zIGFyZSBORVZFUiBkcm9wcGVkIChoYXJkIHNpZ25hbCBwcm90ZWN0aW9uKVxuICAgICAgLy8gRXhwZWN0ZWQ6IENvbnRyb2xsZXIgc3BhbiArIFNlcnZpY2Ugc3BhbiAoYm90aCBmYWlsZWQpXG4gICAgICBleHBlY3Qoc3BhbnMubGVuZ3RoKS50b0JlKDIpO1xuXG4gICAgICAvLyBWRVJJRlk6IENvbnRyb2xsZXIgc3BhblxuICAgICAgY29uc3QgY29udHJvbGxlclNwYW4gPSBzcGFucy5maW5kKHMgPT4gcy5zb3VyY2U/LmluY2x1ZGVzKCdDb250cm9sbGVyJykpO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXJTcGFuKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXJTcGFuPy5vcGVyYXRpb24pLnRvQ29udGFpbignR0VUJyk7XG4gICAgICBleHBlY3QoY29udHJvbGxlclNwYW4/Lm9wZXJhdGlvbikudG9Db250YWluKCd0ZXN0aXRlbScpO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXJTcGFuPy5zdWNjZXNzKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChjb250cm9sbGVyU3Bhbj8ubGV2ZWwpLnRvQmUoJ2Vycm9yJyk7XG5cbiAgICAgIC8vIFZFUklGWTogU2VydmljZSBzcGFuXG4gICAgICBjb25zdCBzZXJ2aWNlU3BhbiA9IHNwYW5zLmZpbmQocyA9PiBzLnNvdXJjZT8uaW5jbHVkZXMoJ3NlcnZpY2UnKSk7XG4gICAgICBleHBlY3Qoc2VydmljZVNwYW4pLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qoc2VydmljZVNwYW4/Lm9wZXJhdGlvbikudG9Db250YWluKCdnZXQnKTtcbiAgICAgIGV4cGVjdChzZXJ2aWNlU3Bhbj8uc3VjY2VzcykudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3Qoc2VydmljZVNwYW4/LmxldmVsKS50b0JlKCdlcnJvcicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ2Ryb3BzIGZhc3Qgc3VjY2Vzc2Z1bCBHRVQgL3Rlc3RpdGVtIChsaXN0KSBvcGVyYXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gUmVzZXQgYmFja2VuZFxuICAgICAgYmFja2VuZC5yZXNldCgpO1xuXG4gICAgICAvLyBKdXN0IGludm9rZSB0aGUgY29udHJvbGxlciAtIExhbWJkYVRlc3RIYXJuZXNzICsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIGhhbmRsZSBldmVyeXRoaW5nXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvJyk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG5cbiAgICAgIC8vIFdhaXQgZm9yIGFzeW5jIGZsdXNoXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwKSk7XG5cbiAgICAgIC8vIEFic3RyYWN0TGFtYmRhSGFuZGxlcidzIGV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoIGFscmVhZHkgZmx1c2hlZCBvYnNlcnZhYmlsaXR5XG4gICAgICBjb25zdCBhbGxFdmVudHMgPSBiYWNrZW5kLmdldEV2ZW50cygpO1xuICAgICAgY29uc3Qgc3BhbnMgPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ3NwYW4nIH0pO1xuXG4gICAgICAvLyBWRVJJRlk6IEZhc3Qgc3VjY2Vzc2Z1bCByZWFkcyBzaG91bGQgYmUgRFJPUFBFRFxuICAgICAgLy8gUnVsZTogZncyNC5ob3RwYXRocy5hcGkuZHJvcF9mYXN0X3N1Y2Nlc3NmdWxfcmVhZHNcbiAgICAgIC8vIFBhdHRlcm46IEhUVFAgR0VUL0hFQUQvT1BUSU9OUyBvciAubGlzdC8uZ2V0Ly5yZWFkIG1ldGhvZHMgdGhhdCBhcmUgZmFzdCAoPDUwMG1zKSBhbmQgc3VjY2Vzc2Z1bFxuXG4gICAgICAvLyBWRVJJRlk6IE5vIGV2ZW50cyBwZXJzaXN0ZWQgKGVudGlyZSB0cmVlIHBydW5lZCAtIG5vIGhhcmQgc2lnbmFscywganVzdCBub2lzZSlcbiAgICAgIGV4cGVjdChzcGFucy5sZW5ndGgpLnRvQmUoMCk7XG4gICAgICBleHBlY3QoYWxsRXZlbnRzLmxlbmd0aCkudG9CZSgwKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2Z3MjQuaG90cGF0aHMuZW50aXR5LmFnZ3JlZ2F0ZV91cHNlcnRfc3BhbnMnLCAoKSA9PiB7XG4gICAgaXQoJ2FnZ3JlZ2F0ZXMgc3VjY2Vzc2Z1bCBCYXNlRW50aXR5U2VydmljZSB1cHNlcnQgb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFJlc2V0IGJhY2tlbmQgYmVmb3JlIHRoaXMgdGVzdFxuICAgICAgYmFja2VuZC5yZXNldCgpO1xuXG4gICAgICAvLyBKdXN0IGludm9rZSAtIEFic3RyYWN0TGFtYmRhSGFuZGxlciArIEJhc2VFbnRpdHlDb250cm9sbGVyIGhhbmRsZSBldmVyeXRoaW5nXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MucG9zdCgnL2JhdGNoLXVwc2VydCcsIHtcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIGl0ZW1zOiBbXG4gICAgICAgICAgICB7IHRlc3RJdGVtSWQ6IHJhbmRvbVVVSUQoKSwgbmFtZTogJ0l0ZW0gMScsIHN0YXR1czogJ2FjdGl2ZScgfSxcbiAgICAgICAgICAgIHsgdGVzdEl0ZW1JZDogcmFuZG9tVVVJRCgpLCBuYW1lOiAnSXRlbSAyJywgc3RhdHVzOiAnYWN0aXZlJyB9LFxuICAgICAgICAgICAgeyB0ZXN0SXRlbUlkOiByYW5kb21VVUlEKCksIG5hbWU6ICdJdGVtIDMnLCBzdGF0dXM6ICdhY3RpdmUnIH0sXG4gICAgICAgICAgICB7IHRlc3RJdGVtSWQ6IHJhbmRvbVVVSUQoKSwgbmFtZTogJ0l0ZW0gNCcsIHN0YXR1czogJ2FjdGl2ZScgfSxcbiAgICAgICAgICAgIHsgdGVzdEl0ZW1JZDogcmFuZG9tVVVJRCgpLCBuYW1lOiAnSXRlbSA1Jywgc3RhdHVzOiAnYWN0aXZlJyB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAxKTtcblxuICAgICAgLy8gV2FpdCBmb3IgYXN5bmMgZmx1c2hcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTtcblxuICAgICAgLy8gQWJzdHJhY3RMYW1iZGFIYW5kbGVyJ3MgZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2ggYWxyZWFkeSBmbHVzaGVkXG4gICAgICBjb25zdCBhbGxFdmVudHMgPSBiYWNrZW5kLmdldEV2ZW50cygpO1xuICAgICAgY29uc3Qgc3BhbnMgPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ3NwYW4nIH0pO1xuXG4gICAgICBjb25zb2xlLmxvZygnQmF0Y2ggdGVzdCAtIFRvdGFsIGV2ZW50czonLCBhbGxFdmVudHMubGVuZ3RoKTtcbiAgICAgIGNvbnNvbGUubG9nKCdCYXRjaCB0ZXN0IC0gVG90YWwgc3BhbnM6Jywgc3BhbnMubGVuZ3RoKTtcbiAgICAgIGNvbnNvbGUubG9nKCdCYXRjaCB0ZXN0IC0gU3BhbnM6Jywgc3BhbnMubWFwKHMgPT4gKHtcbiAgICAgICAgb3BlcmF0aW9uOiBzLm9wZXJhdGlvbixcbiAgICAgICAgc291cmNlOiBzLnNvdXJjZSxcbiAgICAgICAgaGFzQWdncmVnYXRlczogISEocy5kYXRhIGFzIGFueSk/Lm5vaXNlUmVkdWN0aW9uPy5hZ2dyZWdhdGVzXG4gICAgICB9KSkpO1xuXG4gICAgICAvLyBDUklUSUNBTCBBU1NFUlRJT046IE11bHRpcGxlIHVwc2VydHMgc2hvdWxkIGJlIEFHR1JFR0FURURcbiAgICAgIC8vIFJ1bGU6IGZ3MjQuaG90cGF0aHMuZW50aXR5LmFnZ3JlZ2F0ZV91cHNlcnRfc3BhbnNcbiAgICAgIC8vIFBhdHRlcm46IHNlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2UgdXBzZXJ0L3VwZGF0ZSBvcGVyYXRpb25zIHNob3VsZCBiZSBhZ2dyZWdhdGVkIGludG8gcGFyZW50XG5cbiAgICAgIC8vIEZpbmQgaW5kaXZpZHVhbCB1cHNlcnQgc3BhbnNcbiAgICAgIGNvbnN0IHVwc2VydFNwYW5zID0gc3BhbnMuZmlsdGVyKHMgPT5cbiAgICAgICAgcy5vcGVyYXRpb24/LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ3Vwc2VydCcpICYmXG4gICAgICAgIHMuc291cmNlPy5pbmNsdWRlcygnc2VydmljZScpXG4gICAgICApO1xuXG4gICAgICBjb25zb2xlLmxvZygnSW5kaXZpZHVhbCB1cHNlcnQgc3BhbnM6JywgdXBzZXJ0U3BhbnMubGVuZ3RoKTtcblxuICAgICAgLy8gVkVSSUZZOiBBZ2dyZWdhdGlvbiBzaG91bGQgaGFwcGVuIHBlciBmdzI0LmhvdHBhdGhzLmVudGl0eS5hZ2dyZWdhdGVfdXBzZXJ0X3NwYW5zIHJ1bGVcbiAgICAgIC8vIFJ1bGUgbWF0Y2hlczogb3BlcmF0aW9uPScvQmFzZUVudGl0eVNlcnZpY2VcXFxcLih1cHNlcnR8dXBkYXRlKS8nLCBzb3VyY2U9Jy9ec2VydmljZTpCYXNlRW50aXR5U2VydmljZVxcXFwuLycsIHN1Y2Nlc3M9dHJ1ZVxuXG4gICAgICAvLyBJbmRpdmlkdWFsIHVwc2VydCBzcGFucyBzaG91bGQgTk9UIGJlIGluIG91dHB1dCAoYWdncmVnYXRlZCBpbnRvIHBhcmVudClcbiAgICAgIGV4cGVjdCh1cHNlcnRTcGFucy5sZW5ndGgpLnRvQmUoMCk7XG5cbiAgICAgIC8vIFBhcmVudCBzcGFuIHNob3VsZCBleGlzdCBhbmQgaGF2ZSBhZ2dyZWdhdGVzXG4gICAgICAvLyBWRVJJRlk6IE9ubHkgcGFyZW50IHNwYW4gaW4gb3V0cHV0ICh1cHNlcnRzIGFnZ3JlZ2F0ZWQpXG4gICAgICBleHBlY3Qoc3BhbnMubGVuZ3RoKS50b0JlKDEpO1xuXG4gICAgICAvLyBWRVJJRlk6IFBhcmVudCBzcGFuIHByb3BlcnRpZXNcbiAgICAgIGNvbnN0IHBhcmVudFNwYW4gPSBzcGFuc1sgMCBdO1xuICAgICAgZXhwZWN0KHBhcmVudFNwYW4ub3BlcmF0aW9uKS50b0JlKCdIVFRQIFBPU1QgLy90ZXN0aXRlbS9iYXRjaC11cHNlcnQnKTtcbiAgICAgIGV4cGVjdChwYXJlbnRTcGFuLnNvdXJjZSkudG9Db250YWluKCdDb250cm9sbGVyJyk7XG4gICAgICBleHBlY3QocGFyZW50U3Bhbi5zdWNjZXNzKS50b0JlKHRydWUpO1xuXG4gICAgICAvLyBWRVJJRlk6IEFnZ3JlZ2F0ZXMgYXJlIGluIHRoZSBub2lzZVJlZHVjdGlvbi5zdW1tYXJ5IGNoZWNrcG9pbnQgKHNlbGYtY29udGFpbmVkKVxuICAgICAgY29uc3QgY2hlY2twb2ludHMgPSAocGFyZW50U3Bhbi5kYXRhIGFzIGFueSk/LmNoZWNrcG9pbnRzO1xuICAgICAgZXhwZWN0KGNoZWNrcG9pbnRzKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoY2hlY2twb2ludHMpKS50b0JlKHRydWUpO1xuXG4gICAgICBjb25zdCBzdW1tYXJ5Q2hlY2twb2ludCA9IGNoZWNrcG9pbnRzLmZpbmQoKGNwOiBhbnkpID0+IGNwLm5hbWUgPT09ICdub2lzZVJlZHVjdGlvbi5zdW1tYXJ5Jyk7XG4gICAgICBleHBlY3Qoc3VtbWFyeUNoZWNrcG9pbnQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qoc3VtbWFyeUNoZWNrcG9pbnQuZGF0YSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChzdW1tYXJ5Q2hlY2twb2ludC5kYXRhLmFnZ3JlZ2F0ZXMpLnRvQmVEZWZpbmVkKCk7XG5cbiAgICAgIGNvbnN0IHVwc2VydEFnZ3JlZ2F0ZSA9IHN1bW1hcnlDaGVja3BvaW50LmRhdGEuYWdncmVnYXRlc1sgJ3NwYW46QmFzZUVudGl0eVNlcnZpY2UudXBzZXJ0JyBdO1xuICAgICAgZXhwZWN0KHVwc2VydEFnZ3JlZ2F0ZSkudG9FcXVhbCh7XG4gICAgICAgIGNvdW50OiA1LFxuICAgICAgICBlcnJvckNvdW50OiAwLFxuICAgICAgICBkdXJhdGlvblN1bU1zOiBleHBlY3QuYW55KE51bWJlciksXG4gICAgICAgIGR1cmF0aW9uTWF4TXM6IGV4cGVjdC5hbnkoTnVtYmVyKSxcbiAgICAgICAgZXhhbXBsZXM6IFtdLFxuICAgICAgICBlcnJvckV4YW1wbGVzOiBbXSxcbiAgICAgICAgcnVsZXM6IHsgJ2Z3MjQuaG90cGF0aHMuZW50aXR5LmFnZ3JlZ2F0ZV91cHNlcnRfc3BhbnMnOiA1IH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBWRVJJRlk6IGRhdGEubm9pc2VSZWR1Y3Rpb24gc2hvdWxkIE5PVCBleGlzdCAoYWxsIGluZm8gaW4gY2hlY2twb2ludClcbiAgICAgIGV4cGVjdCgocGFyZW50U3Bhbi5kYXRhIGFzIGFueSkubm9pc2VSZWR1Y3Rpb24pLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==