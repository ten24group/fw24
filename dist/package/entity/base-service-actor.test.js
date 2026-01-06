"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_service_1 = require("./base-service");
const base_entity_1 = require("./base-entity");
const di_1 = require("../di");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
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
    beforeEach(() => {
        service = new TestEntityService();
        minimalService = new MinimalEntityService();
        jest.clearAllMocks();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLWFjdG9yLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2Jhc2Utc2VydmljZS1hY3Rvci50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsaURBQXNGO0FBQ3RGLCtDQUE0RTtBQUU1RSw4QkFBb0M7QUFFcEMsOERBQTBEO0FBRTFELHVDQUF1QztBQUN2QyxNQUFNLGdCQUFnQixHQUFHLElBQUEsZ0NBQWtCLEVBQUM7SUFDMUMsS0FBSyxFQUFFO1FBQ0wsT0FBTyxFQUFFLEdBQUc7UUFDWixNQUFNLEVBQUUsWUFBWTtRQUNwQixnQkFBZ0IsRUFBRSxjQUFjO1FBQ2hDLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6QyxPQUFPLEVBQUUsTUFBTTtLQUNoQjtJQUNELFVBQVUsRUFBRTtRQUNWLE1BQU0sRUFBRTtZQUNOLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7WUFDZCxZQUFZLEVBQUUsSUFBSTtTQUNuQjtRQUNELEtBQUssRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7U0FDZjtRQUNELE9BQU8sRUFBRTtZQUNQLElBQUksRUFBRSxRQUFRO1NBQ2Y7UUFDRCx3QkFBd0I7UUFDeEIsU0FBUyxFQUFFO1lBQ1QsSUFBSSxFQUFFLFFBQVE7WUFDZCxVQUFVLEVBQUUsS0FBSztTQUNsQjtRQUNELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsVUFBVSxFQUFFLEtBQUs7U0FDbEI7UUFDRCxTQUFTLEVBQUU7WUFDVCxJQUFJLEVBQUUsUUFBUTtZQUNkLFVBQVUsRUFBRSxLQUFLO1NBQ2xCO1FBQ0QsU0FBUyxFQUFFO1lBQ1QsSUFBSSxFQUFFLFFBQVE7WUFDZCxVQUFVLEVBQUUsS0FBSztTQUNsQjtRQUNELFFBQVEsRUFBRTtZQUNSLElBQUksRUFBRSxRQUFRO1lBQ2QsVUFBVSxFQUFFLEtBQUs7U0FDbEI7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LCBoYXNBdHRyaWJ1dGUsIGlzQXR0cmlidXRlUmVhZE9ubHkgfSBmcm9tICcuL2Jhc2Utc2VydmljZSc7XG5pbXBvcnQgeyBjcmVhdGVFbnRpdHlTY2hlbWEsIERlZmF1bHRFbnRpdHlPcGVyYXRpb25zIH0gZnJvbSAnLi9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0LCBBY3RvciB9IGZyb20gJy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi9kaSc7XG5pbXBvcnQgeyBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSAnZWxlY3Ryb2RiJztcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcblxuLy8gVGVzdCBlbnRpdHkgc2NoZW1hIHdpdGggYWN0b3IgZmllbGRzXG5jb25zdCBUZXN0RW50aXR5U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgbW9kZWw6IHtcbiAgICB2ZXJzaW9uOiAnMScsXG4gICAgZW50aXR5OiAndGVzdEVudGl0eScsXG4gICAgZW50aXR5TmFtZVBsdXJhbDogJ3Rlc3RFbnRpdGllcycsXG4gICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgc2VydmljZTogJ3Rlc3QnXG4gIH0sXG4gIGF0dHJpYnV0ZXM6IHtcbiAgICB0ZXN0SWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBpc0lkZW50aWZpZXI6IHRydWVcbiAgICB9LFxuICAgIHRpdGxlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgfSxcbiAgICBjb250ZW50OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgIH0sXG4gICAgLy8gQWN0b3IgdHJhY2tpbmcgZmllbGRzXG4gICAgY3JlYXRlZEJ5OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGlzRWRpdGFibGU6IGZhbHNlXG4gICAgfSxcbiAgICB1cGRhdGVkQnk6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgaXNFZGl0YWJsZTogZmFsc2VcbiAgICB9LFxuICAgIGNyZWF0ZWRBdDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZVxuICAgIH0sXG4gICAgdXBkYXRlZEF0OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGlzRWRpdGFibGU6IGZhbHNlXG4gICAgfSxcbiAgICB0ZW5hbnRJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZVxuICAgIH1cbiAgfSxcbiAgaW5kZXhlczoge1xuICAgIHByaW1hcnk6IHtcbiAgICAgIHBrOiB7XG4gICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICBjb21wb3NpdGU6IFsndGVzdElkJ11cbiAgICAgIH0sXG4gICAgICBzazoge1xuICAgICAgICBmaWVsZDogJ3NrJyxcbiAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgfVxuICAgIH1cbiAgfVxufSBhcyBjb25zdCk7XG5cbi8vIFRlc3QgZW50aXR5IHNjaGVtYSB3aXRob3V0IGFjdG9yIGZpZWxkc1xuY29uc3QgTWluaW1hbEVudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gIG1vZGVsOiB7XG4gICAgdmVyc2lvbjogJzEnLFxuICAgIGVudGl0eTogJ21pbmltYWxFbnRpdHknLFxuICAgIGVudGl0eU5hbWVQbHVyYWw6ICdtaW5pbWFsRW50aXRpZXMnLFxuICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgIHNlcnZpY2U6ICdtaW5pbWFsJ1xuICB9LFxuICBhdHRyaWJ1dGVzOiB7XG4gICAgbWluaW1hbElkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgaXNJZGVudGlmaWVyOiB0cnVlXG4gICAgfSxcbiAgICBuYW1lOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgfVxuICB9LFxuICBpbmRleGVzOiB7XG4gICAgcHJpbWFyeToge1xuICAgICAgcGs6IHtcbiAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgIGNvbXBvc2l0ZTogWydtaW5pbWFsSWQnXVxuICAgICAgfSxcbiAgICAgIHNrOiB7XG4gICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICBjb21wb3NpdGU6IFtdXG4gICAgICB9XG4gICAgfVxuICB9XG59IGFzIGNvbnN0KTtcblxuLy8gVGVzdCBlbnRpdHkgc2VydmljZVxuY2xhc3MgVGVzdEVudGl0eVNlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTx0eXBlb2YgVGVzdEVudGl0eVNjaGVtYT4ge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBjb25zdCBlbnRpdHlDb25maWd1cmF0aW9uOiBFbnRpdHlDb25maWd1cmF0aW9uID0ge1xuICAgICAgdGFibGU6ICd0ZXN0LXRhYmxlJyxcbiAgICAgIGNsaWVudDogbmV3IER5bmFtb0RCQ2xpZW50KHt9KVxuICAgIH07XG4gICAgc3VwZXIoVGVzdEVudGl0eVNjaGVtYSwgZW50aXR5Q29uZmlndXJhdGlvbiwgRElDb250YWluZXIuUk9PVCk7XG4gIH1cblxuICAvLyBFeHBvc2UgcHJvdGVjdGVkIG1ldGhvZCBmb3IgdGVzdGluZ1xuICBwdWJsaWMgdGVzdEluamVjdEFjdG9yQ29udGV4dDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgZGF0YTogVCxcbiAgICBvcGVyYXRpb246ICdjcmVhdGUnIHwgJ3VwZGF0ZScsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dFxuICApOiBUIHtcbiAgICByZXR1cm4gKHRoaXMgYXMgYW55KS5pbmplY3RBY3RvckNvbnRleHQoZGF0YSwgb3BlcmF0aW9uLCBjdHgpO1xuICB9XG59XG5cbmNsYXNzIE1pbmltYWxFbnRpdHlTZXJ2aWNlIGV4dGVuZHMgQmFzZUVudGl0eVNlcnZpY2U8dHlwZW9mIE1pbmltYWxFbnRpdHlTY2hlbWE+IHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgY29uc3QgZW50aXR5Q29uZmlndXJhdGlvbjogRW50aXR5Q29uZmlndXJhdGlvbiA9IHtcbiAgICAgIHRhYmxlOiAnbWluaW1hbC10YWJsZScsXG4gICAgICBjbGllbnQ6IG5ldyBEeW5hbW9EQkNsaWVudCh7fSlcbiAgICB9O1xuICAgIHN1cGVyKE1pbmltYWxFbnRpdHlTY2hlbWEsIGVudGl0eUNvbmZpZ3VyYXRpb24sIERJQ29udGFpbmVyLlJPT1QpO1xuICB9XG5cbiAgLy8gRXhwb3NlIHByb3RlY3RlZCBtZXRob2QgZm9yIHRlc3RpbmdcbiAgcHVibGljIHRlc3RJbmplY3RBY3RvckNvbnRleHQ8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KFxuICAgIGRhdGE6IFQsXG4gICAgb3BlcmF0aW9uOiAnY3JlYXRlJyB8ICd1cGRhdGUnLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHRcbiAgKTogVCB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuaW5qZWN0QWN0b3JDb250ZXh0KGRhdGEsIG9wZXJhdGlvbiwgY3R4KTtcbiAgfVxufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIG1pbmltYWwgbW9jayBhY3RvciBmb3IgbW9zdCB0ZXN0c1xuZnVuY3Rpb24gY3JlYXRlTWluaW1hbEFjdG9yKG92ZXJyaWRlczogUGFydGlhbDxBY3Rvcj4gPSB7fSk6IEFjdG9yIHtcbiAgcmV0dXJuIHtcbiAgICByZXF1ZXN0SWQ6ICdyZXEtMTIzJyxcbiAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonLFxuICAgIGFjdG9ySWQ6ICd1c2VyLTQ1NicsXG4gICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJyxcbiAgICAuLi5vdmVycmlkZXNcbiAgfTtcbn1cblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBmdWxsIG1vY2sgYWN0b3IgZm9yIGNvbXByZWhlbnNpdmUgdGVzdHNcbmZ1bmN0aW9uIGNyZWF0ZUZ1bGxNb2NrQWN0b3Iob3ZlcnJpZGVzOiBQYXJ0aWFsPEFjdG9yPiA9IHt9KTogQWN0b3Ige1xuICByZXR1cm4ge1xuICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgYWN0b3JJZDogJ3VzZXItNDU2JyxcbiAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgc291cmNlSXA6ICcxOTIuMTY4LjEuMScsXG4gICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAnLFxuICAgIGNvZ25pdG9TdWI6ICdzdWItNzg5JyxcbiAgICBjb2duaXRvVXNlcm5hbWU6ICdqb2huLmRvZScsXG4gICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJyxcbiAgICBjb3JyZWxhdGlvbklkOiAnY29yci14eXonLFxuICAgIC4uLm92ZXJyaWRlc1xuICB9O1xufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIG1vY2sgZXhlY3V0aW9uIGNvbnRleHRcbmZ1bmN0aW9uIGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGFjdG9yPzogQWN0b3IpOiBFeGVjdXRpb25Db250ZXh0IHtcbiAgcmV0dXJuIHtcbiAgICBldmVudDoge30gYXMgYW55LFxuICAgIGxhbWJkYUNvbnRleHQ6IHt9IGFzIGFueSxcbiAgICByZXF1ZXN0OiB7fSBhcyBhbnksXG4gICAgcmVzcG9uc2U6IHt9IGFzIGFueSxcbiAgICBhY3RvcixcbiAgICBkZWJ1Z0luZm86IHt9XG4gIH07XG59XG5cbmRlc2NyaWJlKCdCYXNlRW50aXR5U2VydmljZSBBY3RvciBDb250ZXh0IEluamVjdGlvbicsICgpID0+IHtcbiAgbGV0IHNlcnZpY2U6IFRlc3RFbnRpdHlTZXJ2aWNlO1xuICBsZXQgbWluaW1hbFNlcnZpY2U6IE1pbmltYWxFbnRpdHlTZXJ2aWNlO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIHNlcnZpY2UgPSBuZXcgVGVzdEVudGl0eVNlcnZpY2UoKTtcbiAgICBtaW5pbWFsU2VydmljZSA9IG5ldyBNaW5pbWFsRW50aXR5U2VydmljZSgpO1xuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xuICB9KTtcblxuICBkZXNjcmliZSgnaGFzQXR0cmlidXRlIHV0aWxpdHkgZnVuY3Rpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjb3JyZWN0bHkgZGV0ZWN0IGF0dHJpYnV0ZXMgaW4gc2NoZW1hJywgKCkgPT4ge1xuICAgICAgZXhwZWN0KGhhc0F0dHJpYnV0ZShUZXN0RW50aXR5U2NoZW1hLCAnY3JlYXRlZEJ5JykpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoaGFzQXR0cmlidXRlKFRlc3RFbnRpdHlTY2hlbWEsICd1cGRhdGVkQnknKSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoVGVzdEVudGl0eVNjaGVtYSwgJ3RlbmFudElkJykpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoaGFzQXR0cmlidXRlKFRlc3RFbnRpdHlTY2hlbWEsICdub25FeGlzdGVudEZpZWxkJykpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjb3JyZWN0bHkgZGV0ZWN0IG1pc3NpbmcgYXR0cmlidXRlcyBpbiBtaW5pbWFsIHNjaGVtYScsICgpID0+IHtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoTWluaW1hbEVudGl0eVNjaGVtYSwgJ2NyZWF0ZWRCeScpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoTWluaW1hbEVudGl0eVNjaGVtYSwgJ3VwZGF0ZWRCeScpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoTWluaW1hbEVudGl0eVNjaGVtYSwgJ3RlbmFudElkJykpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnaXNBdHRyaWJ1dGVSZWFkT25seSB1dGlsaXR5IGZ1bmN0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY29ycmVjdGx5IGRldGVjdCByZWFkLW9ubHkgYXR0cmlidXRlcycsICgpID0+IHtcbiAgICAgIC8vIE1vc3QgYXR0cmlidXRlcyBhcmUgbm90IHJlYWQtb25seSBieSBkZWZhdWx0XG4gICAgICBleHBlY3QoaXNBdHRyaWJ1dGVSZWFkT25seShUZXN0RW50aXR5U2NoZW1hLCAnY3JlYXRlZEJ5JykpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KGlzQXR0cmlidXRlUmVhZE9ubHkoVGVzdEVudGl0eVNjaGVtYSwgJ3VwZGF0ZWRCeScpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChpc0F0dHJpYnV0ZVJlYWRPbmx5KFRlc3RFbnRpdHlTY2hlbWEsICd0ZW5hbnRJZCcpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChpc0F0dHJpYnV0ZVJlYWRPbmx5KFRlc3RFbnRpdHlTY2hlbWEsICd0aXRsZScpKS50b0JlKGZhbHNlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGZhbHNlIGZvciBub24tZXhpc3RlbnQgYXR0cmlidXRlcycsICgpID0+IHtcbiAgICAgIGV4cGVjdChpc0F0dHJpYnV0ZVJlYWRPbmx5KFRlc3RFbnRpdHlTY2hlbWEsICdub25FeGlzdGVudEZpZWxkJykpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQWN0b3IgY29udGV4dCBpbmplY3Rpb24gZm9yIENSRUFURSBvcGVyYXRpb25zJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaW5qZWN0IGFsbCBhY3RvciBmaWVsZHMgd2hlbiBzY2hlbWEgaGFzIHRoZW0gYW5kIGFjdG9yIGNvbnRleHQgZXhpc3RzJywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIGNvbnRlbnQ6ICdUZXN0IENvbnRlbnQnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgLy8gQ2hlY2sgYWN0b3IgZmllbGRzXG4gICAgICBleHBlY3QocmVzdWx0LnRpdGxlKS50b0JlKCdUZXN0IFRpdGxlJyk7XG4gICAgICBleHBlY3QocmVzdWx0LmNvbnRlbnQpLnRvQmUoJ1Rlc3QgQ29udGVudCcpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5jcmVhdGVkQnkpLnRvQmUoJ3VzZXItNDU2Jyk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnVwZGF0ZWRCeSkudG9CZSgndXNlci00NTYnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudGVuYW50SWQpLnRvQmUoJ3RlbmFudC1hYmMnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuX2FjdG9yKS50b0VxdWFsKG1vY2tBY3Rvcik7XG4gICAgICBcbiAgICAgIC8vIFRpbWVzdGFtcHMgc2hvdWxkIGJlIHN5c3RlbS1nZW5lcmF0ZWQgKGN1cnJlbnQgdGltZSlcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuY3JlYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QobmV3IERhdGUoKHJlc3VsdCBhcyBhbnkpLmNyZWF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgb25seSBpbmplY3QgZmllbGRzIHRoYXQgZXhpc3QgaW4gc2NoZW1hJywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIG5hbWU6ICdUZXN0IE5hbWUnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBtaW5pbWFsU2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICBuYW1lOiAnVGVzdCBOYW1lJyxcbiAgICAgICAgX2FjdG9yOiBtb2NrQWN0b3IgLy8gQWx3YXlzIGluamVjdGVkXG4gICAgICB9KTtcbiAgICAgIC8vIFZpc2libGUgZmllbGRzIHNob3VsZCBub3QgYmUgcHJlc2VudFxuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCdjcmVhdGVkQnknKTtcbiAgICAgIGV4cGVjdChyZXN1bHQpLm5vdC50b0hhdmVQcm9wZXJ0eSgndXBkYXRlZEJ5Jyk7XG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ3RlbmFudElkJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtaXNzaW5nIGFjdG9ySWQgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3Rvcih7IGFjdG9ySWQ6IHVuZGVmaW5lZCB9KTtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG1vY2tBY3Rvcik7XG4gICAgICBcbiAgICAgIGNvbnN0IGlucHV0RGF0YSA9IHtcbiAgICAgICAgdGl0bGU6ICdUZXN0IFRpdGxlJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIC8vIENoZWNrIGZpZWxkc1xuICAgICAgZXhwZWN0KHJlc3VsdC50aXRsZSkudG9CZSgnVGVzdCBUaXRsZScpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS50ZW5hbnRJZCkudG9CZSgndGVuYW50LWFiYycpOyAvLyB0ZW5hbnRJZCBpcyBzZXQgZXZlbiB3aGVuIGFjdG9ySWQgaXMgdW5kZWZpbmVkXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3RvcikudG9FcXVhbChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICAvLyBjcmVhdGVkQnkgYW5kIHVwZGF0ZWRCeSBzaG91bGQgbm90IGJlIHNldCB3aGVuIGFjdG9ySWQgaXMgdW5kZWZpbmVkXG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ2NyZWF0ZWRCeScpO1xuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCd1cGRhdGVkQnknKTtcbiAgICAgIFxuICAgICAgLy8gQnV0IHRpbWVzdGFtcHMgc2hvdWxkIGJlIHN5c3RlbS1nZW5lcmF0ZWRcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuY3JlYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QobmV3IERhdGUoKHJlc3VsdCBhcyBhbnkpLmNyZWF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1pc3NpbmcgdGVuYW50SWQgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3Rvcih7IHRlbmFudElkOiB1bmRlZmluZWQgfSk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IHNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dChpbnB1dERhdGEsICdjcmVhdGUnLCBjdHgpO1xuXG4gICAgICAvLyBDaGVjayBmaWVsZHNcbiAgICAgIGV4cGVjdChyZXN1bHQudGl0bGUpLnRvQmUoJ1Rlc3QgVGl0bGUnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuY3JlYXRlZEJ5KS50b0JlKCd1c2VyLTQ1NicpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS51cGRhdGVkQnkpLnRvQmUoJ3VzZXItNDU2Jyk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3RvcikudG9FcXVhbChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICAvLyB0ZW5hbnRJZCBzaG91bGQgbm90IGJlIHNldCB3aGVuIHVuZGVmaW5lZFxuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCd0ZW5hbnRJZCcpO1xuICAgICAgXG4gICAgICAvLyBUaW1lc3RhbXBzIHNob3VsZCBiZSBzeXN0ZW0tZ2VuZXJhdGVkXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLmNyZWF0ZWRBdCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS5jcmVhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICAgIGV4cGVjdChuZXcgRGF0ZSgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS5nZXRUaW1lKCkpLnRvQmVHcmVhdGVyVGhhbihEYXRlLm5vdygpIC0gNTAwMCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdBY3RvciBjb250ZXh0IGluamVjdGlvbiBmb3IgVVBEQVRFIG9wZXJhdGlvbnMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBpbmplY3QgdXBkYXRlIGZpZWxkcyBidXQgbm90IGNyZWF0ZSBmaWVsZHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3IoKTtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG1vY2tBY3Rvcik7XG4gICAgICBcbiAgICAgIGNvbnN0IGlucHV0RGF0YSA9IHtcbiAgICAgICAgdGl0bGU6ICdVcGRhdGVkIFRpdGxlJyxcbiAgICAgICAgY29udGVudDogJ1VwZGF0ZWQgQ29udGVudCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IHNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dChpbnB1dERhdGEsICd1cGRhdGUnLCBjdHgpO1xuXG4gICAgICAvLyBDaGVjayBmaWVsZHNcbiAgICAgIGV4cGVjdChyZXN1bHQudGl0bGUpLnRvQmUoJ1VwZGF0ZWQgVGl0bGUnKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuY29udGVudCkudG9CZSgnVXBkYXRlZCBDb250ZW50Jyk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnVwZGF0ZWRCeSkudG9CZSgndXNlci00NTYnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudGVuYW50SWQpLnRvQmUoJ3RlbmFudC1hYmMnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuX2FjdG9yKS50b0VxdWFsKG1vY2tBY3Rvcik7XG4gICAgICBcbiAgICAgIC8vIFNob3VsZCBub3Qgc2V0IGNyZWF0ZSBmaWVsZHMgZm9yIHVwZGF0ZSBvcGVyYXRpb25cbiAgICAgIGV4cGVjdChyZXN1bHQpLm5vdC50b0hhdmVQcm9wZXJ0eSgnY3JlYXRlZEJ5Jyk7XG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ2NyZWF0ZWRBdCcpO1xuICAgICAgXG4gICAgICAvLyB1cGRhdGVkQXQgc2hvdWxkIGJlIHN5c3RlbS1nZW5lcmF0ZWRcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHVwZGF0ZSBvcGVyYXRpb24gd2l0aCBtaW5pbWFsIHNjaGVtYScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcbiAgICAgIFxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICBuYW1lOiAnVXBkYXRlZCBOYW1lJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gbWluaW1hbFNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dChpbnB1dERhdGEsICd1cGRhdGUnLCBjdHgpO1xuXG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgbmFtZTogJ1VwZGF0ZWQgTmFtZScsXG4gICAgICAgIF9hY3RvcjogbW9ja0FjdG9yXG4gICAgICB9KTtcbiAgICAgIC8vIE5vIHZpc2libGUgYWN0b3IgZmllbGRzIHNob3VsZCBiZSBwcmVzZW50XG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ3VwZGF0ZWRCeScpO1xuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCd1cGRhdGVkQXQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJlc2VydmUgZXhpc3RpbmcgZGF0YSBhbmQgb25seSBhZGQgYWN0b3IgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcbiAgICAgIFxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICBleGlzdGluZ0ZpZWxkOiAnZXhpc3RpbmcgdmFsdWUnLFxuICAgICAgICBjdXN0b21GaWVsZDogeyBuZXN0ZWQ6IHsgZGF0YTogJ2NvbXBsZXgnIH0gfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ3VwZGF0ZScsIGN0eCk7XG5cbiAgICAgIC8vIENoZWNrIGZpZWxkc1xuICAgICAgZXhwZWN0KHJlc3VsdC50aXRsZSkudG9CZSgnVXBkYXRlZCBUaXRsZScpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5leGlzdGluZ0ZpZWxkKS50b0JlKCdleGlzdGluZyB2YWx1ZScpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5jdXN0b21GaWVsZCkudG9FcXVhbCh7IG5lc3RlZDogeyBkYXRhOiAnY29tcGxleCcgfSB9KTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudXBkYXRlZEJ5KS50b0JlKCd1c2VyLTQ1NicpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS50ZW5hbnRJZCkudG9CZSgndGVuYW50LWFiYycpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5fYWN0b3IpLnRvRXF1YWwobW9ja0FjdG9yKTtcbiAgICAgIFxuICAgICAgLy8gdXBkYXRlZEF0IHNob3VsZCBiZSBzeXN0ZW0tZ2VuZXJhdGVkXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnVwZGF0ZWRBdCkudG9NYXRjaCgvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9VFxcZHsyfTpcXGR7Mn06XFxkezJ9XFwuXFxkezN9WiQvKTtcbiAgICAgIGV4cGVjdChuZXcgRGF0ZSgocmVzdWx0IGFzIGFueSkudXBkYXRlZEF0KS5nZXRUaW1lKCkpLnRvQmVHcmVhdGVyVGhhbihEYXRlLm5vdygpIC0gNTAwMCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFZGdlIGNhc2VzIGFuZCBlcnJvciBoYW5kbGluZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJldHVybiBvcmlnaW5hbCBkYXRhIHdoZW4gbm8gZXhlY3V0aW9uIGNvbnRleHQgcHJvdmlkZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIGNvbnRlbnQ6ICdUZXN0IENvbnRlbnQnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGVzdCBDb250ZW50J1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiBvcmlnaW5hbCBkYXRhIHdoZW4gZXhlY3V0aW9uIGNvbnRleHQgaGFzIG5vIGFjdG9yJywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTsgLy8gTm8gYWN0b3IgcHJvdmlkZWRcbiAgICAgIFxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGVzdCBDb250ZW50J1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGVzdCBDb250ZW50J1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBpbnB1dCBkYXRhJywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7fTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIC8vIENoZWNrIGZpZWxkc1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5jcmVhdGVkQnkpLnRvQmUoJ3VzZXItNDU2Jyk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnVwZGF0ZWRCeSkudG9CZSgndXNlci00NTYnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkudGVuYW50SWQpLnRvQmUoJ3RlbmFudC1hYmMnKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuX2FjdG9yKS50b0VxdWFsKG1vY2tBY3Rvcik7XG4gICAgICBcbiAgICAgIC8vIFRpbWVzdGFtcHMgc2hvdWxkIGJlIHN5c3RlbS1nZW5lcmF0ZWRcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuY3JlYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QobmV3IERhdGUoKHJlc3VsdCBhcyBhbnkpLmNyZWF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgb3ZlcndyaXRlIGV4aXN0aW5nIGFjdG9yIGZpZWxkcyB3aXRoIGN1cnJlbnQgYWN0b3IgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcbiAgICAgIFxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjcmVhdGVkQnk6ICdleGlzdGluZy1jcmVhdG9yJyxcbiAgICAgICAgdXBkYXRlZEJ5OiAnZXhpc3RpbmctdXBkYXRlcicsXG4gICAgICAgIF9hY3RvcjogeyBleGlzdGluZzogJ2FjdG9yJyB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgLy8gU2hvdWxkIG92ZXJyaWRlIHdpdGggY3VycmVudCBhY3RvciBjb250ZXh0XG4gICAgICBleHBlY3QocmVzdWx0LmNyZWF0ZWRCeSkudG9CZSgndXNlci00NTYnKTtcbiAgICAgIGV4cGVjdChyZXN1bHQudXBkYXRlZEJ5KS50b0JlKCd1c2VyLTQ1NicpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5fYWN0b3IpLnRvRXF1YWwobW9ja0FjdG9yKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbXBsZXggYWN0b3IgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbXBsZXhBY3RvciA9IGNyZWF0ZUZ1bGxNb2NrQWN0b3Ioe1xuICAgICAgICBjb2duaXRvR3JvdXBzOiBbJ2FkbWluJywgJ3VzZXInLCAnbWFuYWdlciddLFxuICAgICAgICByYXdBdXRoQ29udGV4dDoge1xuICAgICAgICAgIHN1YjogJ3N1Yi03ODknLFxuICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2pvaG4uZG9lJyxcbiAgICAgICAgICBlbWFpbDogJ2pvaG5AZXhhbXBsZS5jb20nLFxuICAgICAgICAgICdjdXN0b206ZGVwYXJ0bWVudCc6ICdlbmdpbmVlcmluZydcbiAgICAgICAgfSxcbiAgICAgICAgY3VzdG9tRmllbGQ6ICdjdXN0b20gdmFsdWUnLFxuICAgICAgICBuZXN0ZWREYXRhOiB7XG4gICAgICAgICAgcGVybWlzc2lvbnM6IFsncmVhZCcsICd3cml0ZSddLFxuICAgICAgICAgIG1ldGFkYXRhOiB7IHJvbGU6ICdhZG1pbicgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoY29tcGxleEFjdG9yKTtcbiAgICAgIFxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5fYWN0b3IpLnRvRXF1YWwoY29tcGxleEFjdG9yKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuX2FjdG9yLmNvZ25pdG9Hcm91cHMpLnRvRXF1YWwoWydhZG1pbicsICd1c2VyJywgJ21hbmFnZXInXSk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3Rvci5yYXdBdXRoQ29udGV4dCkudG9FcXVhbCh7XG4gICAgICAgIHN1YjogJ3N1Yi03ODknLFxuICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdqb2huLmRvZScsXG4gICAgICAgIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbScsXG4gICAgICAgICdjdXN0b206ZGVwYXJ0bWVudCc6ICdlbmdpbmVlcmluZydcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnVHlwZSBzYWZldHkgYW5kIGRhdGEgaW50ZWdyaXR5JywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgbWFpbnRhaW4gZGF0YSB0eXBlIGludGVncml0eScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcbiAgICAgIFxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBudW1iZXJGaWVsZDogNDIsXG4gICAgICAgIGJvb2xlYW5GaWVsZDogdHJ1ZSxcbiAgICAgICAgYXJyYXlGaWVsZDogWzEsIDIsIDNdLFxuICAgICAgICBvYmplY3RGaWVsZDogeyBuZXN0ZWQ6ICd2YWx1ZScgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIGV4cGVjdCh0eXBlb2YgcmVzdWx0LnRpdGxlKS50b0JlKCdzdHJpbmcnKTtcbiAgICAgIGV4cGVjdCh0eXBlb2YgcmVzdWx0Lm51bWJlckZpZWxkKS50b0JlKCdudW1iZXInKTtcbiAgICAgIGV4cGVjdCh0eXBlb2YgcmVzdWx0LmJvb2xlYW5GaWVsZCkudG9CZSgnYm9vbGVhbicpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkocmVzdWx0LmFycmF5RmllbGQpKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KHR5cGVvZiByZXN1bHQub2JqZWN0RmllbGQpLnRvQmUoJ29iamVjdCcpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5udW1iZXJGaWVsZCkudG9CZSg0Mik7XG4gICAgICBleHBlY3QocmVzdWx0LmJvb2xlYW5GaWVsZCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuYXJyYXlGaWVsZCkudG9FcXVhbChbMSwgMiwgM10pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBub3QgbXV0YXRlIG9yaWdpbmFsIGlucHV0IGRhdGEnLCAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3IoKTtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG1vY2tBY3Rvcik7XG4gICAgICBcbiAgICAgIGNvbnN0IG9yaWdpbmFsRGF0YSA9IHtcbiAgICAgICAgdGl0bGU6ICdUZXN0IFRpdGxlJyxcbiAgICAgICAgY29udGVudDogJ1Rlc3QgQ29udGVudCdcbiAgICAgIH07XG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7IC4uLm9yaWdpbmFsRGF0YSB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgLy8gT3JpZ2luYWwgZGF0YSBzaG91bGQgcmVtYWluIHVuY2hhbmdlZFxuICAgICAgZXhwZWN0KG9yaWdpbmFsRGF0YSkudG9FcXVhbCh7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIGNvbnRlbnQ6ICdUZXN0IENvbnRlbnQnXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgLy8gUmVzdWx0IHNob3VsZCBoYXZlIGFkZGl0aW9uYWwgZmllbGRzXG4gICAgICBleHBlY3QocmVzdWx0KS50b0hhdmVQcm9wZXJ0eSgnY3JlYXRlZEJ5Jyk7XG4gICAgICBleHBlY3QocmVzdWx0KS50b0hhdmVQcm9wZXJ0eSgnX2FjdG9yJyk7XG4gICAgICBleHBlY3QoT2JqZWN0LmtleXMocmVzdWx0KS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbihPYmplY3Qua2V5cyhvcmlnaW5hbERhdGEpLmxlbmd0aCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdCb3VuZGFyeSBhbmQgZWRnZSBjYXNlcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBhY3RvciB3aXRoIG51bGwgdGltZXN0YW1wJywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKHsgdGltZXN0YW1wOiBudWxsIGFzIGFueSB9KTtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG1vY2tBY3Rvcik7XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dCh7IHRpdGxlOiAnVGVzdCcgfSwgJ2NyZWF0ZScsIGN0eCk7XG4gICAgICBcbiAgICAgIC8vIEV2ZW4gd2l0aCBudWxsIGFjdG9yIHRpbWVzdGFtcCwgZGF0YWJhc2UgdGltZXN0YW1wcyBzaG91bGQgdXNlIGN1cnJlbnQgc3lzdGVtIHRpbWVcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuY3JlYXRlZEF0KS50b01hdGNoKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLnRvTWF0Y2goL15cXGR7NH0tXFxkezJ9LVxcZHsyfVRcXGR7Mn06XFxkezJ9OlxcZHsyfVxcLlxcZHszfVokLyk7XG4gICAgICBleHBlY3QobmV3IERhdGUoKHJlc3VsdCBhcyBhbnkpLmNyZWF0ZWRBdCkuZ2V0VGltZSgpKS50b0JlR3JlYXRlclRoYW4oRGF0ZS5ub3coKSAtIDUwMDApO1xuICAgICAgZXhwZWN0KG5ldyBEYXRlKChyZXN1bHQgYXMgYW55KS51cGRhdGVkQXQpLmdldFRpbWUoKSkudG9CZUdyZWF0ZXJUaGFuKERhdGUubm93KCkgLSA1MDAwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGV4dHJlbWVseSBsYXJnZSBhY3RvciBjb250ZXh0JywgKCkgPT4ge1xuICAgICAgY29uc3QgbGFyZ2VSYXdDb250ZXh0ID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogMTAwMCB9LCAoXywgaSkgPT4gW2BrZXkke2l9YCwgYHZhbHVlJHtpfWBdKVxuICAgICAgICAucmVkdWNlKChhY2MsIFtrLCB2XSkgPT4gKHsgLi4uYWNjLCBba106IHYgfSksIHt9KTtcbiAgICAgIFxuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlRnVsbE1vY2tBY3Rvcih7IHJhd0F1dGhDb250ZXh0OiBsYXJnZVJhd0NvbnRleHQgfSk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoeyB0aXRsZTogJ1Rlc3QnIH0sICdjcmVhdGUnLCBjdHgpO1xuICAgICAgXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3Rvci5yYXdBdXRoQ29udGV4dCkudG9FcXVhbChsYXJnZVJhd0NvbnRleHQpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY2lyY3VsYXIgcmVmZXJlbmNlIGluIGFjdG9yIGRhdGEgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY2lyY3VsYXJPYmo6IGFueSA9IHsgc2VsZjogbnVsbCB9O1xuICAgICAgY2lyY3VsYXJPYmouc2VsZiA9IGNpcmN1bGFyT2JqO1xuICAgICAgKG1vY2tBY3RvciBhcyBhbnkpLmNpcmN1bGFyID0gY2lyY3VsYXJPYmo7XG4gICAgICBcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG1vY2tBY3Rvcik7XG4gICAgICBcbiAgICAgIC8vIFNob3VsZCBub3QgdGhyb3cgZXJyb3JcbiAgICAgIGV4cGVjdCgoKSA9PiB7XG4gICAgICAgIHNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dCh7IHRpdGxlOiAnVGVzdCcgfSwgJ2NyZWF0ZScsIGN0eCk7XG4gICAgICB9KS5ub3QudG9UaHJvdygpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19