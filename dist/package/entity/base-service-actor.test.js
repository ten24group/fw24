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
            expect(result).toEqual({
                title: 'Test Title',
                content: 'Test Content',
                createdBy: 'user-456',
                updatedBy: 'user-456',
                createdAt: '2024-01-15T10:30:00.000Z',
                updatedAt: '2024-01-15T10:30:00.000Z',
                tenantId: 'tenant-abc',
                _actor: mockActor
            });
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
            expect(result).toEqual({
                title: 'Test Title',
                createdAt: '2024-01-15T10:30:00.000Z',
                updatedAt: '2024-01-15T10:30:00.000Z',
                tenantId: 'tenant-abc', // tenantId is set even when actorId is undefined
                // createdBy and updatedBy should not be set when actorId is undefined
                _actor: mockActor
            });
            expect(result).not.toHaveProperty('createdBy');
            expect(result).not.toHaveProperty('updatedBy');
        });
        it('should handle missing tenantId gracefully', () => {
            const mockActor = createMinimalActor({ tenantId: undefined });
            const ctx = createMockExecutionContext(mockActor);
            const inputData = {
                title: 'Test Title'
            };
            const result = service.testInjectActorContext(inputData, 'create', ctx);
            expect(result).toEqual({
                title: 'Test Title',
                createdBy: 'user-456',
                updatedBy: 'user-456',
                createdAt: '2024-01-15T10:30:00.000Z',
                updatedAt: '2024-01-15T10:30:00.000Z',
                // tenantId should not be set when undefined
                _actor: mockActor
            });
            expect(result).not.toHaveProperty('tenantId');
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
            expect(result).toEqual({
                title: 'Updated Title',
                content: 'Updated Content',
                updatedBy: 'user-456',
                updatedAt: '2024-01-15T10:30:00.000Z',
                tenantId: 'tenant-abc',
                _actor: mockActor
            });
            // Should not set create fields for update operation
            expect(result).not.toHaveProperty('createdBy');
            expect(result).not.toHaveProperty('createdAt');
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
            expect(result).toEqual({
                title: 'Updated Title',
                existingField: 'existing value',
                customField: { nested: { data: 'complex' } },
                updatedBy: 'user-456',
                updatedAt: '2024-01-15T10:30:00.000Z',
                tenantId: 'tenant-abc',
                _actor: mockActor
            });
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
            expect(result).toEqual({
                createdBy: 'user-456',
                updatedBy: 'user-456',
                createdAt: '2024-01-15T10:30:00.000Z',
                updatedAt: '2024-01-15T10:30:00.000Z',
                tenantId: 'tenant-abc',
                _actor: mockActor
            });
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
            expect(result.createdAt).toBeNull();
            expect(result.updatedAt).toBeNull();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZXJ2aWNlLWFjdG9yLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2Jhc2Utc2VydmljZS1hY3Rvci50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsaURBQXNGO0FBQ3RGLCtDQUE0RTtBQUU1RSw4QkFBb0M7QUFFcEMsOERBQTBEO0FBRTFELHVDQUF1QztBQUN2QyxNQUFNLGdCQUFnQixHQUFHLElBQUEsZ0NBQWtCLEVBQUM7SUFDMUMsS0FBSyxFQUFFO1FBQ0wsT0FBTyxFQUFFLEdBQUc7UUFDWixNQUFNLEVBQUUsWUFBWTtRQUNwQixnQkFBZ0IsRUFBRSxjQUFjO1FBQ2hDLGdCQUFnQixFQUFFLHFDQUF1QjtRQUN6QyxPQUFPLEVBQUUsTUFBTTtLQUNoQjtJQUNELFVBQVUsRUFBRTtRQUNWLE1BQU0sRUFBRTtZQUNOLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7WUFDZCxZQUFZLEVBQUUsSUFBSTtTQUNuQjtRQUNELEtBQUssRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7U0FDZjtRQUNELE9BQU8sRUFBRTtZQUNQLElBQUksRUFBRSxRQUFRO1NBQ2Y7UUFDRCx3QkFBd0I7UUFDeEIsU0FBUyxFQUFFO1lBQ1QsSUFBSSxFQUFFLFFBQVE7WUFDZCxVQUFVLEVBQUUsS0FBSztTQUNsQjtRQUNELFNBQVMsRUFBRTtZQUNULElBQUksRUFBRSxRQUFRO1lBQ2QsVUFBVSxFQUFFLEtBQUs7U0FDbEI7UUFDRCxTQUFTLEVBQUU7WUFDVCxJQUFJLEVBQUUsUUFBUTtZQUNkLFVBQVUsRUFBRSxLQUFLO1NBQ2xCO1FBQ0QsU0FBUyxFQUFFO1lBQ1QsSUFBSSxFQUFFLFFBQVE7WUFDZCxVQUFVLEVBQUUsS0FBSztTQUNsQjtRQUNELFFBQVEsRUFBRTtZQUNSLElBQUksRUFBRSxRQUFRO1lBQ2QsVUFBVSxFQUFFLEtBQUs7U0FDbEI7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QUMsQ0FBQyxPQUFPLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDekUsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsMkRBQTJELEVBQUUsR0FBRyxFQUFFO1lBQ25FLE1BQU0sU0FBUyxHQUFHLGtCQUFrQixFQUFFLENBQUM7WUFDdkMsTUFBTSxXQUFXLEdBQVEsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLENBQUM7WUFDeEMsV0FBVyxDQUFDLElBQUksR0FBRyxXQUFXLENBQUM7WUFDOUIsU0FBaUIsQ0FBQyxRQUFRLEdBQUcsV0FBVyxDQUFDO1lBRTFDLE1BQU0sR0FBRyxHQUFHLDBCQUEwQixDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBRWxELHlCQUF5QjtZQUN6QixNQUFNLENBQUMsR0FBRyxFQUFFO2dCQUNWLE9BQU8sQ0FBQyxzQkFBc0IsQ0FBQyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRSxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDbkUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ25CLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEJhc2VFbnRpdHlTZXJ2aWNlLCBoYXNBdHRyaWJ1dGUsIGlzQXR0cmlidXRlUmVhZE9ubHkgfSBmcm9tICcuL2Jhc2Utc2VydmljZSc7XG5pbXBvcnQgeyBjcmVhdGVFbnRpdHlTY2hlbWEsIERlZmF1bHRFbnRpdHlPcGVyYXRpb25zIH0gZnJvbSAnLi9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0LCBBY3RvciB9IGZyb20gJy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi9kaSc7XG5pbXBvcnQgeyBFbnRpdHlDb25maWd1cmF0aW9uIH0gZnJvbSAnZWxlY3Ryb2RiJztcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcblxuLy8gVGVzdCBlbnRpdHkgc2NoZW1hIHdpdGggYWN0b3IgZmllbGRzXG5jb25zdCBUZXN0RW50aXR5U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgbW9kZWw6IHtcbiAgICB2ZXJzaW9uOiAnMScsXG4gICAgZW50aXR5OiAndGVzdEVudGl0eScsXG4gICAgZW50aXR5TmFtZVBsdXJhbDogJ3Rlc3RFbnRpdGllcycsXG4gICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgc2VydmljZTogJ3Rlc3QnXG4gIH0sXG4gIGF0dHJpYnV0ZXM6IHtcbiAgICB0ZXN0SWQ6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICBpc0lkZW50aWZpZXI6IHRydWVcbiAgICB9LFxuICAgIHRpdGxlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgfSxcbiAgICBjb250ZW50OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgIH0sXG4gICAgLy8gQWN0b3IgdHJhY2tpbmcgZmllbGRzXG4gICAgY3JlYXRlZEJ5OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGlzRWRpdGFibGU6IGZhbHNlXG4gICAgfSxcbiAgICB1cGRhdGVkQnk6IHtcbiAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgaXNFZGl0YWJsZTogZmFsc2VcbiAgICB9LFxuICAgIGNyZWF0ZWRBdDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZVxuICAgIH0sXG4gICAgdXBkYXRlZEF0OiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIGlzRWRpdGFibGU6IGZhbHNlXG4gICAgfSxcbiAgICB0ZW5hbnRJZDoge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICBpc0VkaXRhYmxlOiBmYWxzZVxuICAgIH1cbiAgfSxcbiAgaW5kZXhlczoge1xuICAgIHByaW1hcnk6IHtcbiAgICAgIHBrOiB7XG4gICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICBjb21wb3NpdGU6IFsndGVzdElkJ11cbiAgICAgIH0sXG4gICAgICBzazoge1xuICAgICAgICBmaWVsZDogJ3NrJyxcbiAgICAgICAgY29tcG9zaXRlOiBbXVxuICAgICAgfVxuICAgIH1cbiAgfVxufSBhcyBjb25zdCk7XG5cbi8vIFRlc3QgZW50aXR5IHNjaGVtYSB3aXRob3V0IGFjdG9yIGZpZWxkc1xuY29uc3QgTWluaW1hbEVudGl0eVNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gIG1vZGVsOiB7XG4gICAgdmVyc2lvbjogJzEnLFxuICAgIGVudGl0eTogJ21pbmltYWxFbnRpdHknLFxuICAgIGVudGl0eU5hbWVQbHVyYWw6ICdtaW5pbWFsRW50aXRpZXMnLFxuICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgIHNlcnZpY2U6ICdtaW5pbWFsJ1xuICB9LFxuICBhdHRyaWJ1dGVzOiB7XG4gICAgbWluaW1hbElkOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgaXNJZGVudGlmaWVyOiB0cnVlXG4gICAgfSxcbiAgICBuYW1lOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgfVxuICB9LFxuICBpbmRleGVzOiB7XG4gICAgcHJpbWFyeToge1xuICAgICAgcGs6IHtcbiAgICAgICAgZmllbGQ6ICdwaycsXG4gICAgICAgIGNvbXBvc2l0ZTogWydtaW5pbWFsSWQnXVxuICAgICAgfSxcbiAgICAgIHNrOiB7XG4gICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICBjb21wb3NpdGU6IFtdXG4gICAgICB9XG4gICAgfVxuICB9XG59IGFzIGNvbnN0KTtcblxuLy8gVGVzdCBlbnRpdHkgc2VydmljZVxuY2xhc3MgVGVzdEVudGl0eVNlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTx0eXBlb2YgVGVzdEVudGl0eVNjaGVtYT4ge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBjb25zdCBlbnRpdHlDb25maWd1cmF0aW9uOiBFbnRpdHlDb25maWd1cmF0aW9uID0ge1xuICAgICAgdGFibGU6ICd0ZXN0LXRhYmxlJyxcbiAgICAgIGNsaWVudDogbmV3IER5bmFtb0RCQ2xpZW50KHt9KVxuICAgIH07XG4gICAgc3VwZXIoVGVzdEVudGl0eVNjaGVtYSwgZW50aXR5Q29uZmlndXJhdGlvbiwgRElDb250YWluZXIuUk9PVCk7XG4gIH1cblxuICAvLyBFeHBvc2UgcHJvdGVjdGVkIG1ldGhvZCBmb3IgdGVzdGluZ1xuICBwdWJsaWMgdGVzdEluamVjdEFjdG9yQ29udGV4dDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgZGF0YTogVCxcbiAgICBvcGVyYXRpb246ICdjcmVhdGUnIHwgJ3VwZGF0ZScsXG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dFxuICApOiBUIHtcbiAgICByZXR1cm4gKHRoaXMgYXMgYW55KS5pbmplY3RBY3RvckNvbnRleHQoZGF0YSwgb3BlcmF0aW9uLCBjdHgpO1xuICB9XG59XG5cbmNsYXNzIE1pbmltYWxFbnRpdHlTZXJ2aWNlIGV4dGVuZHMgQmFzZUVudGl0eVNlcnZpY2U8dHlwZW9mIE1pbmltYWxFbnRpdHlTY2hlbWE+IHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgY29uc3QgZW50aXR5Q29uZmlndXJhdGlvbjogRW50aXR5Q29uZmlndXJhdGlvbiA9IHtcbiAgICAgIHRhYmxlOiAnbWluaW1hbC10YWJsZScsXG4gICAgICBjbGllbnQ6IG5ldyBEeW5hbW9EQkNsaWVudCh7fSlcbiAgICB9O1xuICAgIHN1cGVyKE1pbmltYWxFbnRpdHlTY2hlbWEsIGVudGl0eUNvbmZpZ3VyYXRpb24sIERJQ29udGFpbmVyLlJPT1QpO1xuICB9XG5cbiAgLy8gRXhwb3NlIHByb3RlY3RlZCBtZXRob2QgZm9yIHRlc3RpbmdcbiAgcHVibGljIHRlc3RJbmplY3RBY3RvckNvbnRleHQ8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KFxuICAgIGRhdGE6IFQsXG4gICAgb3BlcmF0aW9uOiAnY3JlYXRlJyB8ICd1cGRhdGUnLFxuICAgIGN0eD86IEV4ZWN1dGlvbkNvbnRleHRcbiAgKTogVCB7XG4gICAgcmV0dXJuICh0aGlzIGFzIGFueSkuaW5qZWN0QWN0b3JDb250ZXh0KGRhdGEsIG9wZXJhdGlvbiwgY3R4KTtcbiAgfVxufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIG1pbmltYWwgbW9jayBhY3RvciBmb3IgbW9zdCB0ZXN0c1xuZnVuY3Rpb24gY3JlYXRlTWluaW1hbEFjdG9yKG92ZXJyaWRlczogUGFydGlhbDxBY3Rvcj4gPSB7fSk6IEFjdG9yIHtcbiAgcmV0dXJuIHtcbiAgICByZXF1ZXN0SWQ6ICdyZXEtMTIzJyxcbiAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonLFxuICAgIGFjdG9ySWQ6ICd1c2VyLTQ1NicsXG4gICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJyxcbiAgICAuLi5vdmVycmlkZXNcbiAgfTtcbn1cblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBmdWxsIG1vY2sgYWN0b3IgZm9yIGNvbXByZWhlbnNpdmUgdGVzdHNcbmZ1bmN0aW9uIGNyZWF0ZUZ1bGxNb2NrQWN0b3Iob3ZlcnJpZGVzOiBQYXJ0aWFsPEFjdG9yPiA9IHt9KTogQWN0b3Ige1xuICByZXR1cm4ge1xuICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgYWN0b3JJZDogJ3VzZXItNDU2JyxcbiAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgc291cmNlSXA6ICcxOTIuMTY4LjEuMScsXG4gICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAnLFxuICAgIGNvZ25pdG9TdWI6ICdzdWItNzg5JyxcbiAgICBjb2duaXRvVXNlcm5hbWU6ICdqb2huLmRvZScsXG4gICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJyxcbiAgICBjb3JyZWxhdGlvbklkOiAnY29yci14eXonLFxuICAgIC4uLm92ZXJyaWRlc1xuICB9O1xufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIG1vY2sgZXhlY3V0aW9uIGNvbnRleHRcbmZ1bmN0aW9uIGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGFjdG9yPzogQWN0b3IpOiBFeGVjdXRpb25Db250ZXh0IHtcbiAgcmV0dXJuIHtcbiAgICBldmVudDoge30gYXMgYW55LFxuICAgIGxhbWJkYUNvbnRleHQ6IHt9IGFzIGFueSxcbiAgICByZXF1ZXN0OiB7fSBhcyBhbnksXG4gICAgcmVzcG9uc2U6IHt9IGFzIGFueSxcbiAgICBhY3RvcixcbiAgICBkZWJ1Z0luZm86IHt9XG4gIH07XG59XG5cbmRlc2NyaWJlKCdCYXNlRW50aXR5U2VydmljZSBBY3RvciBDb250ZXh0IEluamVjdGlvbicsICgpID0+IHtcbiAgbGV0IHNlcnZpY2U6IFRlc3RFbnRpdHlTZXJ2aWNlO1xuICBsZXQgbWluaW1hbFNlcnZpY2U6IE1pbmltYWxFbnRpdHlTZXJ2aWNlO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIHNlcnZpY2UgPSBuZXcgVGVzdEVudGl0eVNlcnZpY2UoKTtcbiAgICBtaW5pbWFsU2VydmljZSA9IG5ldyBNaW5pbWFsRW50aXR5U2VydmljZSgpO1xuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xuICB9KTtcblxuICBkZXNjcmliZSgnaGFzQXR0cmlidXRlIHV0aWxpdHkgZnVuY3Rpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjb3JyZWN0bHkgZGV0ZWN0IGF0dHJpYnV0ZXMgaW4gc2NoZW1hJywgKCkgPT4ge1xuICAgICAgZXhwZWN0KGhhc0F0dHJpYnV0ZShUZXN0RW50aXR5U2NoZW1hLCAnY3JlYXRlZEJ5JykpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoaGFzQXR0cmlidXRlKFRlc3RFbnRpdHlTY2hlbWEsICd1cGRhdGVkQnknKSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoVGVzdEVudGl0eVNjaGVtYSwgJ3RlbmFudElkJykpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoaGFzQXR0cmlidXRlKFRlc3RFbnRpdHlTY2hlbWEsICdub25FeGlzdGVudEZpZWxkJykpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjb3JyZWN0bHkgZGV0ZWN0IG1pc3NpbmcgYXR0cmlidXRlcyBpbiBtaW5pbWFsIHNjaGVtYScsICgpID0+IHtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoTWluaW1hbEVudGl0eVNjaGVtYSwgJ2NyZWF0ZWRCeScpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoTWluaW1hbEVudGl0eVNjaGVtYSwgJ3VwZGF0ZWRCeScpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChoYXNBdHRyaWJ1dGUoTWluaW1hbEVudGl0eVNjaGVtYSwgJ3RlbmFudElkJykpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnaXNBdHRyaWJ1dGVSZWFkT25seSB1dGlsaXR5IGZ1bmN0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY29ycmVjdGx5IGRldGVjdCByZWFkLW9ubHkgYXR0cmlidXRlcycsICgpID0+IHtcbiAgICAgIC8vIE1vc3QgYXR0cmlidXRlcyBhcmUgbm90IHJlYWQtb25seSBieSBkZWZhdWx0XG4gICAgICBleHBlY3QoaXNBdHRyaWJ1dGVSZWFkT25seShUZXN0RW50aXR5U2NoZW1hLCAnY3JlYXRlZEJ5JykpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KGlzQXR0cmlidXRlUmVhZE9ubHkoVGVzdEVudGl0eVNjaGVtYSwgJ3VwZGF0ZWRCeScpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChpc0F0dHJpYnV0ZVJlYWRPbmx5KFRlc3RFbnRpdHlTY2hlbWEsICd0ZW5hbnRJZCcpKS50b0JlKGZhbHNlKTtcbiAgICAgIGV4cGVjdChpc0F0dHJpYnV0ZVJlYWRPbmx5KFRlc3RFbnRpdHlTY2hlbWEsICd0aXRsZScpKS50b0JlKGZhbHNlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGZhbHNlIGZvciBub24tZXhpc3RlbnQgYXR0cmlidXRlcycsICgpID0+IHtcbiAgICAgIGV4cGVjdChpc0F0dHJpYnV0ZVJlYWRPbmx5KFRlc3RFbnRpdHlTY2hlbWEsICdub25FeGlzdGVudEZpZWxkJykpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQWN0b3IgY29udGV4dCBpbmplY3Rpb24gZm9yIENSRUFURSBvcGVyYXRpb25zJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaW5qZWN0IGFsbCBhY3RvciBmaWVsZHMgd2hlbiBzY2hlbWEgaGFzIHRoZW0gYW5kIGFjdG9yIGNvbnRleHQgZXhpc3RzJywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIGNvbnRlbnQ6ICdUZXN0IENvbnRlbnQnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIGNvbnRlbnQ6ICdUZXN0IENvbnRlbnQnLFxuICAgICAgICBjcmVhdGVkQnk6ICd1c2VyLTQ1NicsXG4gICAgICAgIHVwZGF0ZWRCeTogJ3VzZXItNDU2JyxcbiAgICAgICAgY3JlYXRlZEF0OiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgdXBkYXRlZEF0OiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJyxcbiAgICAgICAgX2FjdG9yOiBtb2NrQWN0b3JcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBvbmx5IGluamVjdCBmaWVsZHMgdGhhdCBleGlzdCBpbiBzY2hlbWEnLCAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3IoKTtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG1vY2tBY3Rvcik7XG4gICAgICBcbiAgICAgIGNvbnN0IGlucHV0RGF0YSA9IHtcbiAgICAgICAgbmFtZTogJ1Rlc3QgTmFtZSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IG1pbmltYWxTZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgIG5hbWU6ICdUZXN0IE5hbWUnLFxuICAgICAgICBfYWN0b3I6IG1vY2tBY3RvciAvLyBBbHdheXMgaW5qZWN0ZWRcbiAgICAgIH0pO1xuICAgICAgLy8gVmlzaWJsZSBmaWVsZHMgc2hvdWxkIG5vdCBiZSBwcmVzZW50XG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ2NyZWF0ZWRCeScpO1xuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCd1cGRhdGVkQnknKTtcbiAgICAgIGV4cGVjdChyZXN1bHQpLm5vdC50b0hhdmVQcm9wZXJ0eSgndGVuYW50SWQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1pc3NpbmcgYWN0b3JJZCBncmFjZWZ1bGx5JywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKHsgYWN0b3JJZDogdW5kZWZpbmVkIH0pO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcbiAgICAgIFxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIGNyZWF0ZWRBdDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICAgIHVwZGF0ZWRBdDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICAgIHRlbmFudElkOiAndGVuYW50LWFiYycsIC8vIHRlbmFudElkIGlzIHNldCBldmVuIHdoZW4gYWN0b3JJZCBpcyB1bmRlZmluZWRcbiAgICAgICAgLy8gY3JlYXRlZEJ5IGFuZCB1cGRhdGVkQnkgc2hvdWxkIG5vdCBiZSBzZXQgd2hlbiBhY3RvcklkIGlzIHVuZGVmaW5lZFxuICAgICAgICBfYWN0b3I6IG1vY2tBY3RvclxuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ2NyZWF0ZWRCeScpO1xuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCd1cGRhdGVkQnknKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1pc3NpbmcgdGVuYW50SWQgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3Rvcih7IHRlbmFudElkOiB1bmRlZmluZWQgfSk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IHNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dChpbnB1dERhdGEsICdjcmVhdGUnLCBjdHgpO1xuXG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgdGl0bGU6ICdUZXN0IFRpdGxlJyxcbiAgICAgICAgY3JlYXRlZEJ5OiAndXNlci00NTYnLFxuICAgICAgICB1cGRhdGVkQnk6ICd1c2VyLTQ1NicsXG4gICAgICAgIGNyZWF0ZWRBdDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICAgIHVwZGF0ZWRBdDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICAgIC8vIHRlbmFudElkIHNob3VsZCBub3QgYmUgc2V0IHdoZW4gdW5kZWZpbmVkXG4gICAgICAgIF9hY3RvcjogbW9ja0FjdG9yXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXN1bHQpLm5vdC50b0hhdmVQcm9wZXJ0eSgndGVuYW50SWQnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0FjdG9yIGNvbnRleHQgaW5qZWN0aW9uIGZvciBVUERBVEUgb3BlcmF0aW9ucycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGluamVjdCB1cGRhdGUgZmllbGRzIGJ1dCBub3QgY3JlYXRlIGZpZWxkcycsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcbiAgICAgIFxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVXBkYXRlZCBDb250ZW50J1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ3VwZGF0ZScsIGN0eCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVXBkYXRlZCBDb250ZW50JyxcbiAgICAgICAgdXBkYXRlZEJ5OiAndXNlci00NTYnLFxuICAgICAgICB1cGRhdGVkQXQ6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonLFxuICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnLFxuICAgICAgICBfYWN0b3I6IG1vY2tBY3RvclxuICAgICAgfSk7XG4gICAgICAvLyBTaG91bGQgbm90IHNldCBjcmVhdGUgZmllbGRzIGZvciB1cGRhdGUgb3BlcmF0aW9uXG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ2NyZWF0ZWRCeScpO1xuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCdjcmVhdGVkQXQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHVwZGF0ZSBvcGVyYXRpb24gd2l0aCBtaW5pbWFsIHNjaGVtYScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcbiAgICAgIFxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICBuYW1lOiAnVXBkYXRlZCBOYW1lJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gbWluaW1hbFNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dChpbnB1dERhdGEsICd1cGRhdGUnLCBjdHgpO1xuXG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgbmFtZTogJ1VwZGF0ZWQgTmFtZScsXG4gICAgICAgIF9hY3RvcjogbW9ja0FjdG9yXG4gICAgICB9KTtcbiAgICAgIC8vIE5vIHZpc2libGUgYWN0b3IgZmllbGRzIHNob3VsZCBiZSBwcmVzZW50XG4gICAgICBleHBlY3QocmVzdWx0KS5ub3QudG9IYXZlUHJvcGVydHkoJ3VwZGF0ZWRCeScpO1xuICAgICAgZXhwZWN0KHJlc3VsdCkubm90LnRvSGF2ZVByb3BlcnR5KCd1cGRhdGVkQXQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJlc2VydmUgZXhpc3RpbmcgZGF0YSBhbmQgb25seSBhZGQgYWN0b3IgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcbiAgICAgIFxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICBleGlzdGluZ0ZpZWxkOiAnZXhpc3RpbmcgdmFsdWUnLFxuICAgICAgICBjdXN0b21GaWVsZDogeyBuZXN0ZWQ6IHsgZGF0YTogJ2NvbXBsZXgnIH0gfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ3VwZGF0ZScsIGN0eCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICBleGlzdGluZ0ZpZWxkOiAnZXhpc3RpbmcgdmFsdWUnLFxuICAgICAgICBjdXN0b21GaWVsZDogeyBuZXN0ZWQ6IHsgZGF0YTogJ2NvbXBsZXgnIH0gfSxcbiAgICAgICAgdXBkYXRlZEJ5OiAndXNlci00NTYnLFxuICAgICAgICB1cGRhdGVkQXQ6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonLFxuICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnLFxuICAgICAgICBfYWN0b3I6IG1vY2tBY3RvclxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFZGdlIGNhc2VzIGFuZCBlcnJvciBoYW5kbGluZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJldHVybiBvcmlnaW5hbCBkYXRhIHdoZW4gbm8gZXhlY3V0aW9uIGNvbnRleHQgcHJvdmlkZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIGNvbnRlbnQ6ICdUZXN0IENvbnRlbnQnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGVzdCBDb250ZW50J1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiBvcmlnaW5hbCBkYXRhIHdoZW4gZXhlY3V0aW9uIGNvbnRleHQgaGFzIG5vIGFjdG9yJywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTsgLy8gTm8gYWN0b3IgcHJvdmlkZWRcbiAgICAgIFxuICAgICAgY29uc3QgaW5wdXREYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGVzdCBDb250ZW50J1xuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGVzdCBDb250ZW50J1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBpbnB1dCBkYXRhJywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7fTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KGlucHV0RGF0YSwgJ2NyZWF0ZScsIGN0eCk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICBjcmVhdGVkQnk6ICd1c2VyLTQ1NicsXG4gICAgICAgIHVwZGF0ZWRCeTogJ3VzZXItNDU2JyxcbiAgICAgICAgY3JlYXRlZEF0OiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgdXBkYXRlZEF0OiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJyxcbiAgICAgICAgX2FjdG9yOiBtb2NrQWN0b3JcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBvdmVyd3JpdGUgZXhpc3RpbmcgYWN0b3IgZmllbGRzIHdpdGggY3VycmVudCBhY3RvciBjb250ZXh0JywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIGNyZWF0ZWRCeTogJ2V4aXN0aW5nLWNyZWF0b3InLFxuICAgICAgICB1cGRhdGVkQnk6ICdleGlzdGluZy11cGRhdGVyJyxcbiAgICAgICAgX2FjdG9yOiB7IGV4aXN0aW5nOiAnYWN0b3InIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IHNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dChpbnB1dERhdGEsICdjcmVhdGUnLCBjdHgpO1xuXG4gICAgICAvLyBTaG91bGQgb3ZlcnJpZGUgd2l0aCBjdXJyZW50IGFjdG9yIGNvbnRleHRcbiAgICAgIGV4cGVjdChyZXN1bHQuY3JlYXRlZEJ5KS50b0JlKCd1c2VyLTQ1NicpO1xuICAgICAgZXhwZWN0KHJlc3VsdC51cGRhdGVkQnkpLnRvQmUoJ3VzZXItNDU2Jyk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3RvcikudG9FcXVhbChtb2NrQWN0b3IpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29tcGxleCBhY3RvciBjb250ZXh0JywgKCkgPT4ge1xuICAgICAgY29uc3QgY29tcGxleEFjdG9yID0gY3JlYXRlRnVsbE1vY2tBY3Rvcih7XG4gICAgICAgIGNvZ25pdG9Hcm91cHM6IFsnYWRtaW4nLCAndXNlcicsICdtYW5hZ2VyJ10sXG4gICAgICAgIHJhd0F1dGhDb250ZXh0OiB7XG4gICAgICAgICAgc3ViOiAnc3ViLTc4OScsXG4gICAgICAgICAgJ2NvZ25pdG86dXNlcm5hbWUnOiAnam9obi5kb2UnLFxuICAgICAgICAgIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbScsXG4gICAgICAgICAgJ2N1c3RvbTpkZXBhcnRtZW50JzogJ2VuZ2luZWVyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBjdXN0b21GaWVsZDogJ2N1c3RvbSB2YWx1ZScsXG4gICAgICAgIG5lc3RlZERhdGE6IHtcbiAgICAgICAgICBwZXJtaXNzaW9uczogWydyZWFkJywgJ3dyaXRlJ10sXG4gICAgICAgICAgbWV0YWRhdGE6IHsgcm9sZTogJ2FkbWluJyB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChjb21wbGV4QWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZSdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IHNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dChpbnB1dERhdGEsICdjcmVhdGUnLCBjdHgpO1xuXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3RvcikudG9FcXVhbChjb21wbGV4QWN0b3IpO1xuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5fYWN0b3IuY29nbml0b0dyb3VwcykudG9FcXVhbChbJ2FkbWluJywgJ3VzZXInLCAnbWFuYWdlciddKTtcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuX2FjdG9yLnJhd0F1dGhDb250ZXh0KS50b0VxdWFsKHtcbiAgICAgICAgc3ViOiAnc3ViLTc4OScsXG4gICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2pvaG4uZG9lJyxcbiAgICAgICAgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJyxcbiAgICAgICAgJ2N1c3RvbTpkZXBhcnRtZW50JzogJ2VuZ2luZWVyaW5nJ1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdUeXBlIHNhZmV0eSBhbmQgZGF0YSBpbnRlZ3JpdHknLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBtYWludGFpbiBkYXRhIHR5cGUgaW50ZWdyaXR5JywgKCkgPT4ge1xuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCBpbnB1dERhdGEgPSB7XG4gICAgICAgIHRpdGxlOiAnVGVzdCBUaXRsZScsXG4gICAgICAgIG51bWJlckZpZWxkOiA0MixcbiAgICAgICAgYm9vbGVhbkZpZWxkOiB0cnVlLFxuICAgICAgICBhcnJheUZpZWxkOiBbMSwgMiwgM10sXG4gICAgICAgIG9iamVjdEZpZWxkOiB7IG5lc3RlZDogJ3ZhbHVlJyB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoaW5wdXREYXRhLCAnY3JlYXRlJywgY3R4KTtcblxuICAgICAgZXhwZWN0KHR5cGVvZiByZXN1bHQudGl0bGUpLnRvQmUoJ3N0cmluZycpO1xuICAgICAgZXhwZWN0KHR5cGVvZiByZXN1bHQubnVtYmVyRmllbGQpLnRvQmUoJ251bWJlcicpO1xuICAgICAgZXhwZWN0KHR5cGVvZiByZXN1bHQuYm9vbGVhbkZpZWxkKS50b0JlKCdib29sZWFuJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShyZXN1bHQuYXJyYXlGaWVsZCkpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QodHlwZW9mIHJlc3VsdC5vYmplY3RGaWVsZCkudG9CZSgnb2JqZWN0Jyk7XG4gICAgICBleHBlY3QocmVzdWx0Lm51bWJlckZpZWxkKS50b0JlKDQyKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuYm9vbGVhbkZpZWxkKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5hcnJheUZpZWxkKS50b0VxdWFsKFsxLCAyLCAzXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG5vdCBtdXRhdGUgb3JpZ2luYWwgaW5wdXQgZGF0YScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcbiAgICAgIFxuICAgICAgY29uc3Qgb3JpZ2luYWxEYXRhID0ge1xuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxuICAgICAgICBjb250ZW50OiAnVGVzdCBDb250ZW50J1xuICAgICAgfTtcbiAgICAgIGNvbnN0IGlucHV0RGF0YSA9IHsgLi4ub3JpZ2luYWxEYXRhIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IHNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dChpbnB1dERhdGEsICdjcmVhdGUnLCBjdHgpO1xuXG4gICAgICAvLyBPcmlnaW5hbCBkYXRhIHNob3VsZCByZW1haW4gdW5jaGFuZ2VkXG4gICAgICBleHBlY3Qob3JpZ2luYWxEYXRhKS50b0VxdWFsKHtcbiAgICAgICAgdGl0bGU6ICdUZXN0IFRpdGxlJyxcbiAgICAgICAgY29udGVudDogJ1Rlc3QgQ29udGVudCdcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICAvLyBSZXN1bHQgc2hvdWxkIGhhdmUgYWRkaXRpb25hbCBmaWVsZHNcbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvSGF2ZVByb3BlcnR5KCdjcmVhdGVkQnknKTtcbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvSGF2ZVByb3BlcnR5KCdfYWN0b3InKTtcbiAgICAgIGV4cGVjdChPYmplY3Qua2V5cyhyZXN1bHQpLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKE9iamVjdC5rZXlzKG9yaWdpbmFsRGF0YSkubGVuZ3RoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0JvdW5kYXJ5IGFuZCBlZGdlIGNhc2VzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaGFuZGxlIGFjdG9yIHdpdGggbnVsbCB0aW1lc3RhbXAnLCAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3IoeyB0aW1lc3RhbXA6IG51bGwgYXMgYW55IH0pO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQobW9ja0FjdG9yKTtcbiAgICAgIFxuICAgICAgY29uc3QgcmVzdWx0ID0gc2VydmljZS50ZXN0SW5qZWN0QWN0b3JDb250ZXh0KHsgdGl0bGU6ICdUZXN0JyB9LCAnY3JlYXRlJywgY3R4KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5jcmVhdGVkQXQpLnRvQmVOdWxsKCk7XG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnVwZGF0ZWRBdCkudG9CZU51bGwoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGV4dHJlbWVseSBsYXJnZSBhY3RvciBjb250ZXh0JywgKCkgPT4ge1xuICAgICAgY29uc3QgbGFyZ2VSYXdDb250ZXh0ID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogMTAwMCB9LCAoXywgaSkgPT4gW2BrZXkke2l9YCwgYHZhbHVlJHtpfWBdKVxuICAgICAgICAucmVkdWNlKChhY2MsIFtrLCB2XSkgPT4gKHsgLi4uYWNjLCBba106IHYgfSksIHt9KTtcbiAgICAgIFxuICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlRnVsbE1vY2tBY3Rvcih7IHJhd0F1dGhDb250ZXh0OiBsYXJnZVJhd0NvbnRleHQgfSk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChtb2NrQWN0b3IpO1xuICAgICAgXG4gICAgICBjb25zdCByZXN1bHQgPSBzZXJ2aWNlLnRlc3RJbmplY3RBY3RvckNvbnRleHQoeyB0aXRsZTogJ1Rlc3QnIH0sICdjcmVhdGUnLCBjdHgpO1xuICAgICAgXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLl9hY3Rvci5yYXdBdXRoQ29udGV4dCkudG9FcXVhbChsYXJnZVJhd0NvbnRleHQpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY2lyY3VsYXIgcmVmZXJlbmNlIGluIGFjdG9yIGRhdGEgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgY2lyY3VsYXJPYmo6IGFueSA9IHsgc2VsZjogbnVsbCB9O1xuICAgICAgY2lyY3VsYXJPYmouc2VsZiA9IGNpcmN1bGFyT2JqO1xuICAgICAgKG1vY2tBY3RvciBhcyBhbnkpLmNpcmN1bGFyID0gY2lyY3VsYXJPYmo7XG4gICAgICBcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG1vY2tBY3Rvcik7XG4gICAgICBcbiAgICAgIC8vIFNob3VsZCBub3QgdGhyb3cgZXJyb3JcbiAgICAgIGV4cGVjdCgoKSA9PiB7XG4gICAgICAgIHNlcnZpY2UudGVzdEluamVjdEFjdG9yQ29udGV4dCh7IHRpdGxlOiAnVGVzdCcgfSwgJ2NyZWF0ZScsIGN0eCk7XG4gICAgICB9KS5ub3QudG9UaHJvdygpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19