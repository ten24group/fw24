"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_service_1 = require("./base-service");
const base_entity_1 = require("./base-entity");
const di_1 = require("../di");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const span_1 = require("../observability/observers/span");
const testing_1 = require("../observability/testing");
// Test entity schema with actor fields
const TestEntitySchema = (0, base_entity_1.createEntitySchema)({
    model: {
        version: '1',
        entity: 'testEntity',
        entityNamePlural: 'testEntities',
        entityOperations: base_entity_1.DefaultEntityOperations,
        service: 'test'
    },
    attributes: {
        testId: {
            type: 'string',
            required: true,
            isIdentifier: true
        },
        title: {
            type: 'string',
            required: true
        },
        content: {
            type: 'string'
        },
        // Actor tracking fields
        createdBy: {
            type: 'string',
            isEditable: false
        },
        updatedBy: {
            type: 'string',
            isEditable: false
        },
        createdAt: {
            type: 'string',
            isEditable: false
        },
        updatedAt: {
            type: 'string',
            isEditable: false
        },
        tenantId: {
            type: 'string',
            isEditable: false
        }
    },
    indexes: {
        primary: {
            pk: {
                field: 'pk',
                composite: ['testId']
            },
            sk: {
                field: 'sk',
                composite: []
            }
        }
    }
});
// Test entity schema without actor fields
const MinimalEntitySchema = (0, base_entity_1.createEntitySchema)({
    model: {
        version: '1',
        entity: 'minimalEntity',
        entityNamePlural: 'minimalEntities',
        entityOperations: base_entity_1.DefaultEntityOperations,
        service: 'minimal'
    },
    attributes: {
        minimalId: {
            type: 'string',
            required: true,
            isIdentifier: true
        },
        name: {
            type: 'string',
            required: true
        }
    },
    indexes: {
        primary: {
            pk: {
                field: 'pk',
                composite: ['minimalId']
            },
            sk: {
                field: 'sk',
                composite: []
            }
        }
    }
});
// Test entity service
class TestEntityService extends base_service_1.BaseEntityService {
    constructor() {
        const entityConfiguration = {
            table: 'test-table',
            client: new client_dynamodb_1.DynamoDBClient({})
        };
        super(TestEntitySchema, entityConfiguration, di_1.DIContainer.ROOT);
    }
    // Expose protected method for testing
    testInjectActorContext(data, operation, ctx) {
        return this.injectActorContext(data, operation, ctx);
    }
}
class MinimalEntityService extends base_service_1.BaseEntityService {
    constructor() {
        const entityConfiguration = {
            table: 'minimal-table',
            client: new client_dynamodb_1.DynamoDBClient({})
        };
        super(MinimalEntitySchema, entityConfiguration, di_1.DIContainer.ROOT);
    }
    // Expose protected method for testing
    testInjectActorContext(data, operation, ctx) {
        return this.injectActorContext(data, operation, ctx);
    }
}
// Helper function to create minimal mock actor for most tests
function createMinimalActor(overrides = {}) {
    return {
        requestId: 'req-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        actorId: 'user-456',
        tenantId: 'tenant-abc',
        ...overrides
    };
}
// Helper function to create full mock actor for comprehensive tests
function createFullMockActor(overrides = {}) {
    return {
        requestId: 'req-123',
        timestamp: '2024-01-15T10:30:00.000Z',
        actorId: 'user-456',
        actorType: 'user',
        authMethod: 'cognito',
        sourceIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        cognitoSub: 'sub-789',
        cognitoUsername: 'john.doe',
        tenantId: 'tenant-abc',
        correlationId: 'corr-xyz',
        ...overrides
    };
}
// Helper function to create mock execution context
function createMockExecutionContext(actor) {
    return {
        event: {},
        lambdaContext: {},
        request: {},
        response: {},
        actor,
        debugInfo: {}
    };
}
describe('BaseEntityService Actor Context Injection', () => {
    let service;
    let minimalService;
    let backend;
    beforeEach(() => {
        // Enable aggressive span filtering to ensure "pinned parent" spans still survive.
        backend = (0, testing_1.setupTestObservability)({ enabled: true, skipEmptySpans: true, minSpanDurationMs: 999999 });
        service = new TestEntityService();
        minimalService = new MinimalEntityService();
        jest.clearAllMocks();
    });
    afterEach(() => {
        (0, testing_1.cleanupTestObservability)();
    });
    describe('hasAttribute utility function', () => {
        it('should correctly detect attributes in schema', () => {
            expect((0, base_service_1.hasAttribute)(TestEntitySchema, 'createdBy')).toBe(true);
            expect((0, base_service_1.hasAttribute)(TestEntitySchema, 'updatedBy')).toBe(true);
            expect((0, base_service_1.hasAttribute)(TestEntitySchema, 'tenantId')).toBe(true);
            expect((0, base_service_1.hasAttribute)(TestEntitySchema, 'nonExistentField')).toBe(false);
        });
        it('should correctly detect missing attributes in minimal schema', () => {
            expect((0, base_service_1.hasAttribute)(MinimalEntitySchema, 'createdBy')).toBe(false);
            expect((0, base_service_1.hasAttribute)(MinimalEntitySchema, 'updatedBy')).toBe(false);
            expect((0, base_service_1.hasAttribute)(MinimalEntitySchema, 'tenantId')).toBe(false);
        });
    });
    describe('isAttributeReadOnly utility function', () => {
        it('should correctly detect read-only attributes', () => {
            // Most attributes are not read-only by default
            expect((0, base_service_1.isAttributeReadOnly)(TestEntitySchema, 'createdBy')).toBe(false);
            expect((0, base_service_1.isAttributeReadOnly)(TestEntitySchema, 'updatedBy')).toBe(false);
            expect((0, base_service_1.isAttributeReadOnly)(TestEntitySchema, 'tenantId')).toBe(false);
            expect((0, base_service_1.isAttributeReadOnly)(TestEntitySchema, 'title')).toBe(false);
        });
        it('should return false for non-existent attributes', () => {
            expect((0, base_service_1.isAttributeReadOnly)(TestEntitySchema, 'nonExistentField')).toBe(false);
        });
    });
    describe('Actor context injection for CREATE operations', () => {
        it('should inject all actor fields when schema has them and actor context exists', () => {
            const mockActor = createMinimalActor();
            const ctx = createMockExecutionContext(mockActor);
            const inputData = {
                title: 'Test Title',
                content: 'Test Content'
            };
            const result = service.testInjectActorContext(inputData, 'create', ctx);
            // Check actor fields
            expect(result.title).toBe('Test Title');
            expect(result.content).toBe('Test Content');
            expect(result.createdBy).toBe('user-456');
            expect(result.updatedBy).toBe('user-456');
            expect(result.tenantId).toBe('tenant-abc');
            expect(result._actor).toEqual(mockActor);
            // Timestamps should be system-generated (current time)
            expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(new Date(result.createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
            expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
        });
        it('should only inject fields that exist in schema', () => {
            const mockActor = createMinimalActor();
            const ctx = createMockExecutionContext(mockActor);
            const inputData = {
                name: 'Test Name'
            };
            const result = minimalService.testInjectActorContext(inputData, 'create', ctx);
            expect(result).toEqual({
                name: 'Test Name',
                _actor: mockActor // Always injected
            });
            // Visible fields should not be present
            expect(result).not.toHaveProperty('createdBy');
            expect(result).not.toHaveProperty('updatedBy');
            expect(result).not.toHaveProperty('tenantId');
        });
        it('should handle missing actorId gracefully', () => {
            const mockActor = createMinimalActor({ actorId: undefined });
            const ctx = createMockExecutionContext(mockActor);
            const inputData = {
                title: 'Test Title'
            };
            const result = service.testInjectActorContext(inputData, 'create', ctx);
            // Check fields
            expect(result.title).toBe('Test Title');
            expect(result.tenantId).toBe('tenant-abc'); // tenantId is set even when actorId is undefined
            expect(result._actor).toEqual(mockActor);
            // createdBy and updatedBy should not be set when actorId is undefined
            expect(result).not.toHaveProperty('createdBy');
            expect(result).not.toHaveProperty('updatedBy');
            // But timestamps should be system-generated
            expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(new Date(result.createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
            expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
        });
        it('should handle missing tenantId gracefully', () => {
            const mockActor = createMinimalActor({ tenantId: undefined });
            const ctx = createMockExecutionContext(mockActor);
            const inputData = {
                title: 'Test Title'
            };
            const result = service.testInjectActorContext(inputData, 'create', ctx);
            // Check fields
            expect(result.title).toBe('Test Title');
            expect(result.createdBy).toBe('user-456');
            expect(result.updatedBy).toBe('user-456');
            expect(result._actor).toEqual(mockActor);
            // tenantId should not be set when undefined
            expect(result).not.toHaveProperty('tenantId');
            // Timestamps should be system-generated
            expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(new Date(result.createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
            expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
        });
    });
    describe('Parent span linkage for audits (_actor.parentObservabilityLogId)', () => {
        it('should NOT set _actor.parentObservabilityLogId (parent is strict in-slice only; cross-hop uses causedBy)', async () => {
            const actor = createFullMockActor({
                correlationId: 'corr-1',
                // parentObservabilityLogId should never be inferred/persisted for cross-hop linkage.
                parentObservabilityLogId: undefined,
            });
            let spanId;
            await (0, testing_1.createTestContext)(async () => {
                await span_1.SpanObserver.withSpan('request', async (span) => {
                    spanId = span.id;
                    // Simulate an update payload and omit ctx so injectActorContext reads actor from ALS.
                    const payload = { testId: '1', title: 't' };
                    const enhanced = service.testInjectActorContext(payload, 'update');
                    expect(enhanced._actor).toBeTruthy();
                    expect(enhanced._actor.parentObservabilityLogId).toBeUndefined();
                });
            }, { actor });
            // This test is about actor propagation rules, not span filtering behavior.
            // Span capture depends on the current observability config (skipEmpty/minDuration/noise reduction).
            expect(spanId).toBeTruthy();
        });
    });
    describe('Actor context injection for UPDATE operations', () => {
        it('should inject update fields but not create fields', () => {
            const mockActor = createMinimalActor();
            const ctx = createMockExecutionContext(mockActor);
            const inputData = {
                title: 'Updated Title',
                content: 'Updated Content'
            };
            const result = service.testInjectActorContext(inputData, 'update', ctx);
            // Check fields
            expect(result.title).toBe('Updated Title');
            expect(result.content).toBe('Updated Content');
            expect(result.updatedBy).toBe('user-456');
            expect(result.tenantId).toBe('tenant-abc');
            expect(result._actor).toEqual(mockActor);
            // Should not set create fields for update operation
            expect(result).not.toHaveProperty('createdBy');
            expect(result).not.toHaveProperty('createdAt');
            // updatedAt should be system-generated
            expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
        });
        it('should handle update operation with minimal schema', () => {
            const mockActor = createMinimalActor();
            const ctx = createMockExecutionContext(mockActor);
            const inputData = {
                name: 'Updated Name'
            };
            const result = minimalService.testInjectActorContext(inputData, 'update', ctx);
            expect(result).toEqual({
                name: 'Updated Name',
                _actor: mockActor
            });
            // No visible actor fields should be present
            expect(result).not.toHaveProperty('updatedBy');
            expect(result).not.toHaveProperty('updatedAt');
        });
        it('should preserve existing data and only add actor context', () => {
            const mockActor = createMinimalActor();
            const ctx = createMockExecutionContext(mockActor);
            const inputData = {
                title: 'Updated Title',
                existingField: 'existing value',
                customField: { nested: { data: 'complex' } }
            };
            const result = service.testInjectActorContext(inputData, 'update', ctx);
            // Check fields
            expect(result.title).toBe('Updated Title');
            expect(result.existingField).toBe('existing value');
            expect(result.customField).toEqual({ nested: { data: 'complex' } });
            expect(result.updatedBy).toBe('user-456');
            expect(result.tenantId).toBe('tenant-abc');
            expect(result._actor).toEqual(mockActor);
            // updatedAt should be system-generated
            expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
        });
    });
    describe('Edge cases and error handling', () => {
        it('should return original data when no execution context provided', () => {
            const inputData = {
                title: 'Test Title',
                content: 'Test Content'
            };
            const result = service.testInjectActorContext(inputData, 'create');
            expect(result).toEqual({
                title: 'Test Title',
                content: 'Test Content'
            });
        });
        it('should return original data when execution context has no actor', () => {
            const ctx = createMockExecutionContext(); // No actor provided
            const inputData = {
                title: 'Test Title',
                content: 'Test Content'
            };
            const result = service.testInjectActorContext(inputData, 'create', ctx);
            expect(result).toEqual({
                title: 'Test Title',
                content: 'Test Content'
            });
        });
        it('should handle empty input data', () => {
            const mockActor = createMinimalActor();
            const ctx = createMockExecutionContext(mockActor);
            const inputData = {};
            const result = service.testInjectActorContext(inputData, 'create', ctx);
            // Check fields
            expect(result.createdBy).toBe('user-456');
            expect(result.updatedBy).toBe('user-456');
            expect(result.tenantId).toBe('tenant-abc');
            expect(result._actor).toEqual(mockActor);
            // Timestamps should be system-generated
            expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(new Date(result.createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
            expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
        });
        it('should overwrite existing actor fields with current actor context', () => {
            const mockActor = createMinimalActor();
            const ctx = createMockExecutionContext(mockActor);
            const inputData = {
                title: 'Test Title',
                createdBy: 'existing-creator',
                updatedBy: 'existing-updater',
                _actor: { existing: 'actor' }
            };
            const result = service.testInjectActorContext(inputData, 'create', ctx);
            // Should override with current actor context
            expect(result.createdBy).toBe('user-456');
            expect(result.updatedBy).toBe('user-456');
            expect(result._actor).toEqual(mockActor);
        });
        it('should handle complex actor context', () => {
            const complexActor = createFullMockActor({
                cognitoGroups: ['admin', 'user', 'manager'],
                rawAuthContext: {
                    sub: 'sub-789',
                    'cognito:username': 'john.doe',
                    email: 'john@example.com',
                    'custom:department': 'engineering'
                },
                customField: 'custom value',
                nestedData: {
                    permissions: ['read', 'write'],
                    metadata: { role: 'admin' }
                }
            });
            const ctx = createMockExecutionContext(complexActor);
            const inputData = {
                title: 'Test Title'
            };
            const result = service.testInjectActorContext(inputData, 'create', ctx);
            expect(result._actor).toEqual(complexActor);
            expect(result._actor.cognitoGroups).toEqual(['admin', 'user', 'manager']);
            expect(result._actor.rawAuthContext).toEqual({
                sub: 'sub-789',
                'cognito:username': 'john.doe',
                email: 'john@example.com',
                'custom:department': 'engineering'
            });
        });
    });
    describe('Type safety and data integrity', () => {
        it('should maintain data type integrity', () => {
            const mockActor = createMinimalActor();
            const ctx = createMockExecutionContext(mockActor);
            const inputData = {
                title: 'Test Title',
                numberField: 42,
                booleanField: true,
                arrayField: [1, 2, 3],
                objectField: { nested: 'value' }
            };
            const result = service.testInjectActorContext(inputData, 'create', ctx);
            expect(typeof result.title).toBe('string');
            expect(typeof result.numberField).toBe('number');
            expect(typeof result.booleanField).toBe('boolean');
            expect(Array.isArray(result.arrayField)).toBe(true);
            expect(typeof result.objectField).toBe('object');
            expect(result.numberField).toBe(42);
            expect(result.booleanField).toBe(true);
            expect(result.arrayField).toEqual([1, 2, 3]);
        });
        it('should not mutate original input data', () => {
            const mockActor = createMinimalActor();
            const ctx = createMockExecutionContext(mockActor);
            const originalData = {
                title: 'Test Title',
                content: 'Test Content'
            };
            const inputData = { ...originalData };
            const result = service.testInjectActorContext(inputData, 'create', ctx);
            // Original data should remain unchanged
            expect(originalData).toEqual({
                title: 'Test Title',
                content: 'Test Content'
            });
            // Result should have additional fields
            expect(result).toHaveProperty('createdBy');
            expect(result).toHaveProperty('_actor');
            expect(Object.keys(result).length).toBeGreaterThan(Object.keys(originalData).length);
        });
    });
    describe('Boundary and edge cases', () => {
        it('should handle actor with null timestamp', () => {
            const mockActor = createMinimalActor({ timestamp: null });
            const ctx = createMockExecutionContext(mockActor);
            const result = service.testInjectActorContext({ title: 'Test' }, 'create', ctx);
            // Even with null actor timestamp, database timestamps should use current system time
            expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(new Date(result.createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
            expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
        });
        it('should handle extremely large actor context', () => {
            const largeRawContext = Array.from({ length: 1000 }, (_, i) => [`key${i}`, `value${i}`])
                .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
            const mockActor = createFullMockActor({ rawAuthContext: largeRawContext });
            const ctx = createMockExecutionContext(mockActor);
            const result = service.testInjectActorContext({ title: 'Test' }, 'create', ctx);
            expect(result._actor.rawAuthContext).toEqual(largeRawContext);
        });
        it('should handle circular reference in actor data gracefully', () => {
            const mockActor = createMinimalActor();
            const circularObj = { self: null };
            circularObj.self = circularObj;
            mockActor.circular = circularObj;
            const ctx = createMockExecutionContext(mockActor);
            // Should not throw error
            expect(() => {
                service.testInjectActorContext({ title: 'Test' }, 'create', ctx);
            }).not.toThrow();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLWFjdG9yLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2Jhc2Utc2VydmljZS1hY3Rvci50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsaURBQXNGO0FBQ3RGLCtDQUE0RTtBQUU1RSw4QkFBb0M7QUFFcEMsOERBQTBEO0FBQzFELDBEQUErRDtBQUMvRCxzREFBaUk7QUFFakksdUNBQXVDO0FBQ3ZDLE1BQU0sZ0JBQWdCLEdBQUcsSUFBQSxnQ0FBa0IsRUFBQztJQUMxQyxLQUFLLEVBQUU7UUFDTCxPQUFPLEVBQUUsR0FBRztRQUNaLE1BQU0sRUFBRSxZQUFZO1FBQ3BCLGdCQUFnQixFQUFFLGNBQWM7UUFDaEMsZ0JBQWdCLEVBQUUscUNBQXVCO1FBQ3pDLE9BQU8sRUFBRSxNQUFNO0tBQ2hCO0lBQ0QsVUFBVSxFQUFFO1FBQ1YsTUFBTSxFQUFFO1lBQ04sSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtZQUNkLFlBQVksRUFBRSxJQUFJO1NBQ25CO1FBQ0QsS0FBSyxFQUFFO1lBQ0wsSUFBSSxFQUFFLFFBQVE7WUFDZCxRQUFRLEVBQUUsSUFBSTtTQUNmO1FBQ0QsT0FBTyxFQUFFO1lBQ1AsSUFBSSxFQUFFLFFBQVE7U0FDZjtRQUNELHdCQUF3QjtRQUN4QixTQUFTLEVBQUU7WUFDVCxJQUFJLEVBQUUsUUFBUTtZQUNkLFVBQVUsRUFBRSxLQUFLO1NBQ2xCO1FBQ0QsU0FBUyxFQUFFO1lBQ1QsSUFBSSxFQUFFLFFBQVE7WUFDZCxVQUFVLEVBQUUsS0FBSztTQUNsQjtRQUNELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsVUFBVSxFQUFFLEtBQUs7U0FDbEI7UUFDRCxTQUFTLEVBQUU7WUFDVCxJQUFJLEVBQUUsUUFBUTtZQUNkLFVBQVUsRUFBRSxLQUFLO1NBQ2xCO1FBQ0QsUUFBUSxFQUFFO1lBQ1IsSUFBSSxFQUFFLFFBQVE7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LENBQUM7WUFDbkUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ25CLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEJhc2VFbnRpdHlTZXJ2aWNlLCBoYXNBdHRyaWJ1dGUsIGlzQXR0cmlidXRlUmVhZE9ubHkgfSBmcm9tICcuL2Jhc2Utc2VydmljZSc7XG5pbXBvcnQgeyBjcmVhdGVFbnRpdHlTY2hlbWEsIERlZmF1bHRFbnRpdHlPcGVyYXRpb25zIH0gZnJvbSAnLi9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0LCBBY3RvciB9IGZyb20gJy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi9kaSc7XG5pbXBvcnQgeyBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSAnZWxlY3Ryb2RiJztcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciB9IGZyb20gJy4uL29ic2VydmFiaWxpdHkvb2JzZXJ2ZXJzL3NwYW4nO1xuaW1wb3J0IHsgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5LCBjcmVhdGVUZXN0Q29udGV4dCwgc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSwgdHlwZSBNb2NrQmFja2VuZCB9IGZyb20gJy4uL29ic2VydmFiaWxpdHkvdGVzdGluZyc7XG5cbi8vIFRlc3QgZW50aXR5IHNjaGVtYSB3aXRoIGFjdG9yIGZpZWxkc1xuY29uc3QgVGVzdEVudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gIG1vZGVsOiB7XG4gICAgdmVyc2lvbjogJzEnLFxuICAgIGVudGl0eTogJ3Rlc3RFbnRpdHknLFxuICAgIGVudGl0eU5hbWVQbHVyYWw6ICd0ZXN0RW50aXRpZXMnLFxuICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgIHNlcnZpY2U6ICd0ZXN0J1xuICB9LFxuICBhdHRyaWJ1dGVzOiB7XG4gICAgdGVzdElkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgaXNJZGVudGlmaWVyOiB0cnVlXG4gICAgfSxcbiAgICB0aXRsZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICByZXF1aXJlZDogdHJ1ZVxuICAgIH0sXG4gICAgY29udGVudDoge1xuICAgICAgdHlwZTogJ3N0cmluZydcbiAgICB9LFxuICAgIC8vIEFjdG9yIHRyYWNraW5nIGZpZWxkc1xuICAgIGNyZWF0ZWRCeToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZVxuICAgIH0sXG4gICAgdXBkYXRlZEJ5OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGlzRWRpdGFibGU6IGZhbHNlXG4gICAgfSxcbiAgICBjcmVhdGVkQXQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgaXNFZGl0YWJsZTogZmFsc2VcbiAgICB9LFxuICAgIHVwZGF0ZWRBdDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZVxuICAgIH0sXG4gICAgdGVuYW50SWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgaXNFZGl0YWJsZTogZmFsc2VcbiAgICB9XG4gIH0sXG4gIGluZGV4ZXM6IHtcbiAgICBwcmltYXJ5OiB7XG4gICAgICBwazoge1xuICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgY29tcG9zaXRlOiBbICd0ZXN0SWQnIF1cbiAgICAgIH0sXG4gICAgICBzazoge1xuICAgICAgICBmaWVsZDogJ3NrJyxcbiAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgfVxuICAgIH1cbiAgfVxufSBhcyBjb25zdCk7XG5cbi8vIFRlc3QgZW50aXR5IHNjaGVtYSB3aXRob3V0IGFjdG9yIGZpZWxkc1xuY29uc3QgTWluaW1hbEVudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gIG1vZGVsOiB7XG4gICAgdmVyc2lvbjogJzEnLFxuICAgIGVudGl0eTogJ21pbmltYWxFbnRpdHknLFxuICAgIGVudGl0eU5hbWVQbHVyYWw6ICdtaW5pbWFsRW50aXRpZXMnLFxuICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgIHNlcnZpY2U6ICdtaW5pbWFsJ1xuICB9LFxuICBhdHRyaWJ1dGVzOiB7XG4gICAgbWluaW1hbElkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgaXNJZGVudGlmaWVyOiB0cnVlXG4gICAgfSxcbiAgICBuYW1lOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgfVxuICB9LFxuICBpbmRleGVzOiB7XG4gICAgcHJpbWFyeToge1xuICAgICAgcGs6IHtcbiAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgIGNvbXBvc2l0ZTogWyAnbWluaW1hbElkJyBdXG4gICAgICB9LFxuICAgICAgc2s6IHtcbiAgICAgICAgZmllbGQ6ICdzaycsXG4gICAgICAgIGNvbXBvc2l0ZTogW11cbiAgICAgIH1cbiAgICB9XG4gIH1cbn0gYXMgY29uc3QpO1xuXG4vLyBUZXN0IGVudGl0eSBzZXJ2aWNlXG5jbGFzcyBUZXN0RW50aXR5U2VydmljZSBleHRlbmRzIEJhc2VFbnRpdHlTZXJ2aWNlPHR5cGVvZiBUZXN0RW50aXR5U2NoZW1hPiB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIGNvbnN0IGVudGl0eUNvbmZpZ3VyYXRpb246IEVudGl0eUNvbmZpZ3VyYXRpb24gPSB7XG4gICAgICB0YWJsZTogJ3Rlc3QtdGFibGUnLFxuICAgICAgY2xpZW50OiBuZXcgRHluYW1vREJDbGllbnQoe30pXG4gICAgfTtcbiAgICBzdXBlcihUZXN0RW50aXR5U2NoZW1hLCBlbnRpdHlDb25maWd1cmF0aW9uLCBESUNvbnRhaW5lci5ST09UKTtcbiAgfVxuXG4gIC8vIEV4cG9zZSBwcm90ZWN0ZWQgbWV0aG9kIGZvciB0ZXN0aW5nXG4gIHB1YmxpYyB0ZXN0SW5qZWN0QWN0b3JDb250ZXh0PFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihcbiAgICBkYXRhOiBULFxuICAgIG9wZXJhdGlvbjogJ2NyZWF0ZScgfCAndXBkYXRlJyxcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0XG4gICk6IFQge1xuICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmluamVjdEFjdG9yQ29udGV4dChkYXRhLCBvcGVyYXRpb24sIGN0eCk7XG4gIH1cbn1cblxuY2xhc3MgTWluaW1hbEVudGl0eVNlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTx0eXBlb2YgTWluaW1hbEVudGl0eVNjaGVtYT4ge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBjb25zdCBlbnRpdHlDb25maWd1cmF0aW9uOiBFbnRpdHlDb25maWd1cmF0aW9uID0ge1xuICAgICAgdGFibGU6ICdtaW5pbWFsLXRhYmxlJyxcbiAgICAgIGNsaWVudDogbmV3IER5bmFtb0RCQ2xpZW50KHt9KVxuICAgIH07XG4gICAgc3VwZXIoTWluaW1hbEVudGl0eVNjaGVtYSwgZW50aXR5Q29uZmlndXJhdGlvbiwgRElDb250YWluZXIuUk9PVCk7XG4gIH1cblxuICAvLyBFeHBvc2UgcHJvdGVjdGVkIG1ldGhvZCBmb3IgdGVzdGluZ1xuICBwdWJsaWMgdGVzdEluamVjdEFjdG9yQ29udGV4dDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgZGF0YTogVCxcbiAgICBvcGVyYXRpb246ICdjcmVhdGUnIHwgJ3VwZGF0ZScsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dFxuICApOiBUIHtcbiAgICByZXR1cm4gKHRoaXMgYXMgYW55KS5pbmplY3RBY3RvckNvbnRleHQoZGF0YSwgb3BlcmF0aW9uLCBjdHgpO1xuICB9XG59XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byBjcmVhdGUgbWluaW1hbCBtb2NrIGFjdG9yIGZvciBtb3N0IHRlc3RzXG5mdW5jdGlvbiBjcmVhdGVNaW5pbWFsQWN0b3Iob3ZlcnJpZGVzOiBQYXJ0aWFsPEFjdG9yPiA9IHt9KTogQWN0b3Ige1xuICByZXR1cm4ge1xuICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgYWN0b3JJZDogJ3VzZXItNDU2JyxcbiAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnLFxuICAgIC4uLm92ZXJyaWRlc1xuICB9O1xufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIGZ1bGwgbW9jayBhY3RvciBmb3IgY29tcHJlaGVuc2l2ZSB0ZXN0c1xuZnVuY3Rpb24gY3JlYXRlRnVsbE1vY2tBY3RvcihvdmVycmlkZXM6IFBhcnRpYWw8QWN0b3I+ID0ge30pOiBBY3RvciB7XG4gIHJldHVybiB7XG4gICAgcmVxdWVzdElkOiAncmVxLTEyMycsXG4gICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICBhY3RvcklkOiAndXNlci00NTYnLFxuICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJyxcbiAgICB1c2VyQWdlbnQ6ICdNb3ppbGxhLzUuMCcsXG4gICAgY29nbml0b1N1YjogJ3N1Yi03ODknLFxuICAgIGNvZ25pdG9Vc2VybmFtZTogJ2pvaG4uZG9lJyxcbiAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnLFxuICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLXh5eicsXG4gICAgLi4ub3ZlcnJpZGVzXG4gIH07XG59XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byBjcmVhdGUgbW9jayBleGVjdXRpb24gY29udGV4dFxuZnVuY3Rpb24gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoYWN0b3I/OiBBY3Rvcik6IEV4ZWN1dGlvbkNvbnRleHQge1xuICByZXR1cm4ge1xuICAgIGV2ZW50OiB7fSBhcyBhbnksXG4gICAgbGFtYmRhQ29udGV4dDoge30gYXMgYW55LFxuICAgIHJlcXVlc3Q6IHt9IGFzIGFueSxcbiAgICByZXNwb25zZToge30gYXMgYW55LFxuICAgIGFjdG9yLFxuICAgIGRlYnVnSW5mbzoge31cbiAgfTtcbn1cblxuZGVzY3JpYmUoJ0Jhc2VFbnRpdHlTZXJ2aWNlIEFjdG9yIENvbnRleHQgSW5qZWN0aW9uJywgKCkgPT4ge1xuICBsZXQgc2VydmljZTogVGVzdEVudGl0eVNlcnZpY2U7XG4gIGxldCBtaW5pbWFsU2VydmljZTogTWluaW1hbEVudGl0eVNlcnZpY2U7XG4gIGxldCBiYWNrZW5kOiBNb2NrQmFja2VuZDtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAvLyBFbmFibGUgYWdncmVzc2l2ZSBzcGFuIGZpbHRlcmluZyB0byBlbnN1cmUgXCJwaW5uZWQgcGFyZW50XCIgc3BhbnMgc3RpbGwgc3Vydml2ZS5cbiAgICBiYWNrZW5kID0gc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSh7IGVuYWJsZWQ6IHRydWUsIHNraXBFbXB0eVNwYW5zOiB0cnVlLCBtaW5TcGFuRHVyYXRpb25NczogOTk5OTk5IH0pO1xuICAgIHNlcnZpY2UgPSBuZXcgVGVzdEVudGl0eVNlcnZpY2UoKTtcbiAgICBtaW5pbWFsU2VydmljZSA9IG5ldyBNaW5pbWFsRW50aXR5U2VydmljZSgpO1xuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xuICB9KTtcblxuICBhZnRlckVhY2goKCkgPT4ge1xuICAgIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSgpO1xuICB9KTtcblxuICBkZXNjcmliZSgnaGFzQXR0cmlidXRlIHV0aWxpdHkgZnVuY3Rpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjb3JyZWN0bHkgZGV0ZWN0IGF0dHJpYnV0ZXMgaW4gc2NoZW1hJywgKCkgPT4ge1xuICAgICAgZXhwZWN0KGhhc0F0dHJpYnV0ZShUZXN0RW50aXR5U2NoZW1hLCAnY3JlYXRlZEJ5JykpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoaGFzQXR0cmlidXRlKFRlc3RFbnRpdHlTY2hlbWEsICd1cGRhdGVkQnknKSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoVGVzdEVudGl0eVNjaGVtYSwgJ3RlbmFudElkJykpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoaGFzQXR0cmlidXRlKFRlc3RFbnRpdHlTY2hlbWEsICdub25FeGlzdGVudEZpZWxkJykpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjb3JyZWN0bHkgZGV0ZWN0IG1pc3NpbmcgYXR0cmlidXRlcyBpbiBtaW5pbWFsIHNjaGVtYScsICgpID0+IHtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoTWluaW1hbEVudGl0eVNjaGVtYSwgJ2NyZWF0ZWRCeScpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoTWluaW1hbEVudGl0eVNjaGVtYSwgJ3VwZGF0ZWRCeScpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoTWluaW1hbEVudGl0eVNjaGVtYSwgJ3RlbmFudElkJykpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnaXNBdHRyaWJ1dGVSZWFkT25seSB1dGlsaXR5IGZ1bmN0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY29ycmVjdGx5IGRldGVjdCByZWFkLW9ubHkgYXR0cmlidXRlcycsICgpID0+IHtcbiAgICAgIC8vIE1vc3QgYXR0cmlidXRlcyBhcmUgbm90IHJlYWQtb25seSBieSBkZWZhdWx0XG4gICAgICBleHBlY3QoaXNBdHRyaWJ1dGVSZWFkT25seShUZXN0RW50aXR5U2NoZW1hLCAnY3JlYXRlZEJ5JykpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KGlzQXR0cmlidXRlUmVhZE9ubHkoVGVzdEVudGl0eVNjaGVtYSwgJ3VwZGF0ZWRCeScpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChpc0F0dHJpYnV0ZVJlYWRPbmx5KFRlc3RFbnRpdHlTY2hlbWEsICd0ZW5hbnRJZCcpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChpc0F0dHJpYnV0ZVJlYWRPbmx5KFRlc3RFbnRpdHlTY2hlbWEsICd0aXRsZScpKS50b0JlKGZhbHNlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGZhbHNlIGZvciBub24tZXhpc3RlbnQgYXR0cmlidXRlcycsICgpID0+IHtcbiAgICAgIGV4cGVjdChpc0F0dHJpYnV0ZVJlYWRPbmx5KFRlc3RFbnRpdHlTY2hlbWEsICdub25FeGlzdGVudEZpZWxkJykpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQWN0b3IgY29udGV4dCBpbmplY3Rpb24gZm9yIENSRUFURSBvcGVyYXRpb25zJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaW5qZWN0IGFsbCBhY3RvciBmaWVsZHMgd2hlbiBzY2hlbWEgaGFzIHRoZW0gYW5kIGFjdG9yIGNvbnRleHQgZXhpc3RzJywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIGNvbnRlbnQ6ICdUZXN0IENvbnRlbnQnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgLy8gQ2hlY2sgYWN0b3IgZmllbGRzXG4gICAgICBleHBlY3QocmVzdWx0LnRpdGxlKS50b0JlKCdUZXN0IFRpdGxlJyk7XG4gICAgICBleHBlY3QocmVzdWx0LmNvbnRlbnQpLnRvQmUoJ1Rlc3QgQ29udGVudCcpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5jcmVhdGVkQnkpLnRvQmUoJ3VzZXItNDU2Jyk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnVwZGF0ZWRCeSkudG9CZSgndXNlci00NTYnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudGVuYW50SWQpLnRvQmUoJ3RlbmFudC1hYmMnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuX2FjdG9yKS50b0VxdWFsKG1vY2tBY3Rvcik7XG5cbiAgICAgIC8vIFRpbWVzdGFtcHMgc2hvdWxkIGJlIHN5c3RlbS1nZW5lcmF0ZWQgKGN1cnJlbnQgdGltZSlcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuY3JlYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QobmV3IERhdGUoKHJlc3VsdCBhcyBhbnkpLmNyZWF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgb25seSBpbmplY3QgZmllbGRzIHRoYXQgZXhpc3QgaW4gc2NoZW1hJywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIG5hbWU6ICdUZXN0IE5hbWUnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBtaW5pbWFsU2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICBuYW1lOiAnVGVzdCBOYW1lJyxcbiAgICAgICAgX2FjdG9yOiBtb2NrQWN0b3IgLy8gQWx3YXlzIGluamVjdGVkXG4gICAgICB9KTtcbiAgICAgIC8vIFZpc2libGUgZmllbGRzIHNob3VsZCBub3QgYmUgcHJlc2VudFxuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCdjcmVhdGVkQnknKTtcbiAgICAgIGV4cGVjdChyZXN1bHQpLm5vdC50b0hhdmVQcm9wZXJ0eSgndXBkYXRlZEJ5Jyk7XG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ3RlbmFudElkJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtaXNzaW5nIGFjdG9ySWQgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3Rvcih7IGFjdG9ySWQ6IHVuZGVmaW5lZCB9KTtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG1vY2tBY3Rvcik7XG5cbiAgICAgIGNvbnN0IGlucHV0RGF0YSA9IHtcbiAgICAgICAgdGl0bGU6ICdUZXN0IFRpdGxlJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIC8vIENoZWNrIGZpZWxkc1xuICAgICAgZXhwZWN0KHJlc3VsdC50aXRsZSkudG9CZSgnVGVzdCBUaXRsZScpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS50ZW5hbnRJZCkudG9CZSgndGVuYW50LWFiYycpOyAvLyB0ZW5hbnRJZCBpcyBzZXQgZXZlbiB3aGVuIGFjdG9ySWQgaXMgdW5kZWZpbmVkXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3RvcikudG9FcXVhbChtb2NrQWN0b3IpO1xuXG4gICAgICAvLyBjcmVhdGVkQnkgYW5kIHVwZGF0ZWRCeSBzaG91bGQgbm90IGJlIHNldCB3aGVuIGFjdG9ySWQgaXMgdW5kZWZpbmVkXG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ2NyZWF0ZWRCeScpO1xuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCd1cGRhdGVkQnknKTtcblxuICAgICAgLy8gQnV0IHRpbWVzdGFtcHMgc2hvdWxkIGJlIHN5c3RlbS1nZW5lcmF0ZWRcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuY3JlYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QobmV3IERhdGUoKHJlc3VsdCBhcyBhbnkpLmNyZWF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1pc3NpbmcgdGVuYW50SWQgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3Rvcih7IHRlbmFudElkOiB1bmRlZmluZWQgfSk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IHNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dChpbnB1dERhdGEsICdjcmVhdGUnLCBjdHgpO1xuXG4gICAgICAvLyBDaGVjayBmaWVsZHNcbiAgICAgIGV4cGVjdChyZXN1bHQudGl0bGUpLnRvQmUoJ1Rlc3QgVGl0bGUnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuY3JlYXRlZEJ5KS50b0JlKCd1c2VyLTQ1NicpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS51cGRhdGVkQnkpLnRvQmUoJ3VzZXItNDU2Jyk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3RvcikudG9FcXVhbChtb2NrQWN0b3IpO1xuXG4gICAgICAvLyB0ZW5hbnRJZCBzaG91bGQgbm90IGJlIHNldCB3aGVuIHVuZGVmaW5lZFxuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCd0ZW5hbnRJZCcpO1xuXG4gICAgICAvLyBUaW1lc3RhbXBzIHNob3VsZCBiZSBzeXN0ZW0tZ2VuZXJhdGVkXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLmNyZWF0ZWRBdCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS5jcmVhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICAgIGV4cGVjdChuZXcgRGF0ZSgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS5nZXRUaW1lKCkpLnRvQmVHcmVhdGVyVGhhbihEYXRlLm5vdygpIC0gNTAwMCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdQYXJlbnQgc3BhbiBsaW5rYWdlIGZvciBhdWRpdHMgKF9hY3Rvci5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgTk9UIHNldCBfYWN0b3IucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIChwYXJlbnQgaXMgc3RyaWN0IGluLXNsaWNlIG9ubHk7IGNyb3NzLWhvcCB1c2VzIGNhdXNlZEJ5KScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGFjdG9yID0gY3JlYXRlRnVsbE1vY2tBY3Rvcih7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLTEnLFxuICAgICAgICAvLyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgc2hvdWxkIG5ldmVyIGJlIGluZmVycmVkL3BlcnNpc3RlZCBmb3IgY3Jvc3MtaG9wIGxpbmthZ2UuXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgfSk7XG5cbiAgICAgIGxldCBzcGFuSWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBTcGFuT2JzZXJ2ZXIud2l0aFNwYW4oJ3JlcXVlc3QnLCBhc3luYyAoc3BhbikgPT4ge1xuICAgICAgICAgIHNwYW5JZCA9IHNwYW4uaWQ7XG5cbiAgICAgICAgICAvLyBTaW11bGF0ZSBhbiB1cGRhdGUgcGF5bG9hZCBhbmQgb21pdCBjdHggc28gaW5qZWN0QWN0b3JDb250ZXh0IHJlYWRzIGFjdG9yIGZyb20gQUxTLlxuICAgICAgICAgIGNvbnN0IHBheWxvYWQgPSB7IHRlc3RJZDogJzEnLCB0aXRsZTogJ3QnIH07XG4gICAgICAgICAgY29uc3QgZW5oYW5jZWQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQocGF5bG9hZCwgJ3VwZGF0ZScpO1xuXG4gICAgICAgICAgZXhwZWN0KChlbmhhbmNlZCBhcyBhbnkpLl9hY3RvcikudG9CZVRydXRoeSgpO1xuICAgICAgICAgIGV4cGVjdCgoZW5oYW5jZWQgYXMgYW55KS5fYWN0b3IucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSwgeyBhY3RvciB9KTtcblxuICAgICAgLy8gVGhpcyB0ZXN0IGlzIGFib3V0IGFjdG9yIHByb3BhZ2F0aW9uIHJ1bGVzLCBub3Qgc3BhbiBmaWx0ZXJpbmcgYmVoYXZpb3IuXG4gICAgICAvLyBTcGFuIGNhcHR1cmUgZGVwZW5kcyBvbiB0aGUgY3VycmVudCBvYnNlcnZhYmlsaXR5IGNvbmZpZyAoc2tpcEVtcHR5L21pbkR1cmF0aW9uL25vaXNlIHJlZHVjdGlvbikuXG4gICAgICBleHBlY3Qoc3BhbklkKS50b0JlVHJ1dGh5KCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdBY3RvciBjb250ZXh0IGluamVjdGlvbiBmb3IgVVBEQVRFIG9wZXJhdGlvbnMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBpbmplY3QgdXBkYXRlIGZpZWxkcyBidXQgbm90IGNyZWF0ZSBmaWVsZHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3IoKTtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG1vY2tBY3Rvcik7XG5cbiAgICAgIGNvbnN0IGlucHV0RGF0YSA9IHtcbiAgICAgICAgdGl0bGU6ICdVcGRhdGVkIFRpdGxlJyxcbiAgICAgICAgY29udGVudDogJ1VwZGF0ZWQgQ29udGVudCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IHNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dChpbnB1dERhdGEsICd1cGRhdGUnLCBjdHgpO1xuXG4gICAgICAvLyBDaGVjayBmaWVsZHNcbiAgICAgIGV4cGVjdChyZXN1bHQudGl0bGUpLnRvQmUoJ1VwZGF0ZWQgVGl0bGUnKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuY29udGVudCkudG9CZSgnVXBkYXRlZCBDb250ZW50Jyk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnVwZGF0ZWRCeSkudG9CZSgndXNlci00NTYnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudGVuYW50SWQpLnRvQmUoJ3RlbmFudC1hYmMnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuX2FjdG9yKS50b0VxdWFsKG1vY2tBY3Rvcik7XG5cbiAgICAgIC8vIFNob3VsZCBub3Qgc2V0IGNyZWF0ZSBmaWVsZHMgZm9yIHVwZGF0ZSBvcGVyYXRpb25cbiAgICAgIGV4cGVjdChyZXN1bHQpLm5vdC50b0hhdmVQcm9wZXJ0eSgnY3JlYXRlZEJ5Jyk7XG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ2NyZWF0ZWRBdCcpO1xuXG4gICAgICAvLyB1cGRhdGVkQXQgc2hvdWxkIGJlIHN5c3RlbS1nZW5lcmF0ZWRcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHVwZGF0ZSBvcGVyYXRpb24gd2l0aCBtaW5pbWFsIHNjaGVtYScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcblxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICBuYW1lOiAnVXBkYXRlZCBOYW1lJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gbWluaW1hbFNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dChpbnB1dERhdGEsICd1cGRhdGUnLCBjdHgpO1xuXG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgbmFtZTogJ1VwZGF0ZWQgTmFtZScsXG4gICAgICAgIF9hY3RvcjogbW9ja0FjdG9yXG4gICAgICB9KTtcbiAgICAgIC8vIE5vIHZpc2libGUgYWN0b3IgZmllbGRzIHNob3VsZCBiZSBwcmVzZW50XG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ3VwZGF0ZWRCeScpO1xuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCd1cGRhdGVkQXQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJlc2VydmUgZXhpc3RpbmcgZGF0YSBhbmQgb25seSBhZGQgYWN0b3IgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcblxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICBleGlzdGluZ0ZpZWxkOiAnZXhpc3RpbmcgdmFsdWUnLFxuICAgICAgICBjdXN0b21GaWVsZDogeyBuZXN0ZWQ6IHsgZGF0YTogJ2NvbXBsZXgnIH0gfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ3VwZGF0ZScsIGN0eCk7XG5cbiAgICAgIC8vIENoZWNrIGZpZWxkc1xuICAgICAgZXhwZWN0KHJlc3VsdC50aXRsZSkudG9CZSgnVXBkYXRlZCBUaXRsZScpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5leGlzdGluZ0ZpZWxkKS50b0JlKCdleGlzdGluZyB2YWx1ZScpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5jdXN0b21GaWVsZCkudG9FcXVhbCh7IG5lc3RlZDogeyBkYXRhOiAnY29tcGxleCcgfSB9KTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudXBkYXRlZEJ5KS50b0JlKCd1c2VyLTQ1NicpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS50ZW5hbnRJZCkudG9CZSgndGVuYW50LWFiYycpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5fYWN0b3IpLnRvRXF1YWwobW9ja0FjdG9yKTtcblxuICAgICAgLy8gdXBkYXRlZEF0IHNob3VsZCBiZSBzeXN0ZW0tZ2VuZXJhdGVkXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnVwZGF0ZWRBdCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICAgIGV4cGVjdChuZXcgRGF0ZSgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS5nZXRUaW1lKCkpLnRvQmVHcmVhdGVyVGhhbihEYXRlLm5vdygpIC0gNTAwMCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFZGdlIGNhc2VzIGFuZCBlcnJvciBoYW5kbGluZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJldHVybiBvcmlnaW5hbCBkYXRhIHdoZW4gbm8gZXhlY3V0aW9uIGNvbnRleHQgcHJvdmlkZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIGNvbnRlbnQ6ICdUZXN0IENvbnRlbnQnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGVzdCBDb250ZW50J1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiBvcmlnaW5hbCBkYXRhIHdoZW4gZXhlY3V0aW9uIGNvbnRleHQgaGFzIG5vIGFjdG9yJywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTsgLy8gTm8gYWN0b3IgcHJvdmlkZWRcblxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGVzdCBDb250ZW50J1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGVzdCBDb250ZW50J1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBpbnB1dCBkYXRhJywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7fTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIC8vIENoZWNrIGZpZWxkc1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5jcmVhdGVkQnkpLnRvQmUoJ3VzZXItNDU2Jyk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnVwZGF0ZWRCeSkudG9CZSgndXNlci00NTYnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudGVuYW50SWQpLnRvQmUoJ3RlbmFudC1hYmMnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuX2FjdG9yKS50b0VxdWFsKG1vY2tBY3Rvcik7XG5cbiAgICAgIC8vIFRpbWVzdGFtcHMgc2hvdWxkIGJlIHN5c3RlbS1nZW5lcmF0ZWRcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuY3JlYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QobmV3IERhdGUoKHJlc3VsdCBhcyBhbnkpLmNyZWF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgb3ZlcndyaXRlIGV4aXN0aW5nIGFjdG9yIGZpZWxkcyB3aXRoIGN1cnJlbnQgYWN0b3IgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcblxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjcmVhdGVkQnk6ICdleGlzdGluZy1jcmVhdG9yJyxcbiAgICAgICAgdXBkYXRlZEJ5OiAnZXhpc3RpbmctdXBkYXRlcicsXG4gICAgICAgIF9hY3RvcjogeyBleGlzdGluZzogJ2FjdG9yJyB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgLy8gU2hvdWxkIG92ZXJyaWRlIHdpdGggY3VycmVudCBhY3RvciBjb250ZXh0XG4gICAgICBleHBlY3QocmVzdWx0LmNyZWF0ZWRCeSkudG9CZSgndXNlci00NTYnKTtcbiAgICAgIGV4cGVjdChyZXN1bHQudXBkYXRlZEJ5KS50b0JlKCd1c2VyLTQ1NicpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5fYWN0b3IpLnRvRXF1YWwobW9ja0FjdG9yKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbXBsZXggYWN0b3IgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbXBsZXhBY3RvciA9IGNyZWF0ZUZ1bGxNb2NrQWN0b3Ioe1xuICAgICAgICBjb2duaXRvR3JvdXBzOiBbICdhZG1pbicsICd1c2VyJywgJ21hbmFnZXInIF0sXG4gICAgICAgIHJhd0F1dGhDb250ZXh0OiB7XG4gICAgICAgICAgc3ViOiAnc3ViLTc4OScsXG4gICAgICAgICAgJ2NvZ25pdG86dXNlcm5hbWUnOiAnam9obi5kb2UnLFxuICAgICAgICAgIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbScsXG4gICAgICAgICAgJ2N1c3RvbTpkZXBhcnRtZW50JzogJ2VuZ2luZWVyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBjdXN0b21GaWVsZDogJ2N1c3RvbSB2YWx1ZScsXG4gICAgICAgIG5lc3RlZERhdGE6IHtcbiAgICAgICAgICBwZXJtaXNzaW9uczogWyAncmVhZCcsICd3cml0ZScgXSxcbiAgICAgICAgICBtZXRhZGF0YTogeyByb2xlOiAnYWRtaW4nIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGNvbXBsZXhBY3Rvcik7XG5cbiAgICAgIGNvbnN0IGlucHV0RGF0YSA9IHtcbiAgICAgICAgdGl0bGU6ICdUZXN0IFRpdGxlJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuX2FjdG9yKS50b0VxdWFsKGNvbXBsZXhBY3Rvcik7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3Rvci5jb2duaXRvR3JvdXBzKS50b0VxdWFsKFsgJ2FkbWluJywgJ3VzZXInLCAnbWFuYWdlcicgXSk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3Rvci5yYXdBdXRoQ29udGV4dCkudG9FcXVhbCh7XG4gICAgICAgIHN1YjogJ3N1Yi03ODknLFxuICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdqb2huLmRvZScsXG4gICAgICAgIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbScsXG4gICAgICAgICdjdXN0b206ZGVwYXJ0bWVudCc6ICdlbmdpbmVlcmluZydcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnVHlwZSBzYWZldHkgYW5kIGRhdGEgaW50ZWdyaXR5JywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgbWFpbnRhaW4gZGF0YSB0eXBlIGludGVncml0eScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcblxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBudW1iZXJGaWVsZDogNDIsXG4gICAgICAgIGJvb2xlYW5GaWVsZDogdHJ1ZSxcbiAgICAgICAgYXJyYXlGaWVsZDogWyAxLCAyLCAzIF0sXG4gICAgICAgIG9iamVjdEZpZWxkOiB7IG5lc3RlZDogJ3ZhbHVlJyB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgZXhwZWN0KHR5cGVvZiByZXN1bHQudGl0bGUpLnRvQmUoJ3N0cmluZycpO1xuICAgICAgZXhwZWN0KHR5cGVvZiByZXN1bHQubnVtYmVyRmllbGQpLnRvQmUoJ251bWJlcicpO1xuICAgICAgZXhwZWN0KHR5cGVvZiByZXN1bHQuYm9vbGVhbkZpZWxkKS50b0JlKCdib29sZWFuJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShyZXN1bHQuYXJyYXlGaWVsZCkpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QodHlwZW9mIHJlc3VsdC5vYmplY3RGaWVsZCkudG9CZSgnb2JqZWN0Jyk7XG4gICAgICBleHBlY3QocmVzdWx0Lm51bWJlckZpZWxkKS50b0JlKDQyKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuYm9vbGVhbkZpZWxkKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5hcnJheUZpZWxkKS50b0VxdWFsKFsgMSwgMiwgMyBdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbm90IG11dGF0ZSBvcmlnaW5hbCBpbnB1dCBkYXRhJywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuXG4gICAgICBjb25zdCBvcmlnaW5hbERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIGNvbnRlbnQ6ICdUZXN0IENvbnRlbnQnXG4gICAgICB9O1xuICAgICAgY29uc3QgaW5wdXREYXRhID0geyAuLi5vcmlnaW5hbERhdGEgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIC8vIE9yaWdpbmFsIGRhdGEgc2hvdWxkIHJlbWFpbiB1bmNoYW5nZWRcbiAgICAgIGV4cGVjdChvcmlnaW5hbERhdGEpLnRvRXF1YWwoe1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGVzdCBDb250ZW50J1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFJlc3VsdCBzaG91bGQgaGF2ZSBhZGRpdGlvbmFsIGZpZWxkc1xuICAgICAgZXhwZWN0KHJlc3VsdCkudG9IYXZlUHJvcGVydHkoJ2NyZWF0ZWRCeScpO1xuICAgICAgZXhwZWN0KHJlc3VsdCkudG9IYXZlUHJvcGVydHkoJ19hY3RvcicpO1xuICAgICAgZXhwZWN0KE9iamVjdC5rZXlzKHJlc3VsdCkubGVuZ3RoKS50b0JlR3JlYXRlclRoYW4oT2JqZWN0LmtleXMob3JpZ2luYWxEYXRhKS5sZW5ndGgpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQm91bmRhcnkgYW5kIGVkZ2UgY2FzZXMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYWN0b3Igd2l0aCBudWxsIHRpbWVzdGFtcCcsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3Rvcih7IHRpbWVzdGFtcDogbnVsbCBhcyBhbnkgfSk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoeyB0aXRsZTogJ1Rlc3QnIH0sICdjcmVhdGUnLCBjdHgpO1xuXG4gICAgICAvLyBFdmVuIHdpdGggbnVsbCBhY3RvciB0aW1lc3RhbXAsIGRhdGFiYXNlIHRpbWVzdGFtcHMgc2hvdWxkIHVzZSBjdXJyZW50IHN5c3RlbSB0aW1lXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLmNyZWF0ZWRBdCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS5jcmVhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICAgIGV4cGVjdChuZXcgRGF0ZSgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS5nZXRUaW1lKCkpLnRvQmVHcmVhdGVyVGhhbihEYXRlLm5vdygpIC0gNTAwMCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBleHRyZW1lbHkgbGFyZ2UgYWN0b3IgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGxhcmdlUmF3Q29udGV4dCA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDEwMDAgfSwgKF8sIGkpID0+IFsgYGtleSR7aX1gLCBgdmFsdWUke2l9YCBdKVxuICAgICAgICAucmVkdWNlKChhY2MsIFsgaywgdiBdKSA9PiAoeyAuLi5hY2MsIFsgayBdOiB2IH0pLCB7fSk7XG5cbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZUZ1bGxNb2NrQWN0b3IoeyByYXdBdXRoQ29udGV4dDogbGFyZ2VSYXdDb250ZXh0IH0pO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KHsgdGl0bGU6ICdUZXN0JyB9LCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5fYWN0b3IucmF3QXV0aENvbnRleHQpLnRvRXF1YWwobGFyZ2VSYXdDb250ZXh0KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNpcmN1bGFyIHJlZmVyZW5jZSBpbiBhY3RvciBkYXRhIGdyYWNlZnVsbHknLCAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3IoKTtcbiAgICAgIGNvbnN0IGNpcmN1bGFyT2JqOiBhbnkgPSB7IHNlbGY6IG51bGwgfTtcbiAgICAgIGNpcmN1bGFyT2JqLnNlbGYgPSBjaXJjdWxhck9iajtcbiAgICAgIChtb2NrQWN0b3IgYXMgYW55KS5jaXJjdWxhciA9IGNpcmN1bGFyT2JqO1xuXG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuXG4gICAgICAvLyBTaG91bGQgbm90IHRocm93IGVycm9yXG4gICAgICBleHBlY3QoKCkgPT4ge1xuICAgICAgICBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoeyB0aXRsZTogJ1Rlc3QnIH0sICdjcmVhdGUnLCBjdHgpO1xuICAgICAgfSkubm90LnRvVGhyb3coKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==