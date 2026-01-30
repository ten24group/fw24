import { BaseEntityService, hasAttribute, isAttributeReadOnly } from './base-service';
import { createEntitySchema, DefaultEntityOperations } from './base-entity';
import { ExecutionContext, Actor } from '../core/types/execution-context';
import { DIContainer } from '../di';
import { EntityConfiguration } from 'electrodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SpanObserver } from '../observability/observers/span';
import { cleanupTestObservability, createTestContext, setupTestObservability, type MockBackend } from '../observability/testing';

// Test entity schema with actor fields
const TestEntitySchema = createEntitySchema({
  model: {
    version: '1',
    entity: 'testEntity',
    entityNamePlural: 'testEntities',
    entityOperations: DefaultEntityOperations,
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
        composite: [ 'testId' ]
      },
      sk: {
        field: 'sk',
        composite: []
      }
    }
  }
} as const);

// Test entity schema without actor fields
const MinimalEntitySchema = createEntitySchema({
  model: {
    version: '1',
    entity: 'minimalEntity',
    entityNamePlural: 'minimalEntities',
    entityOperations: DefaultEntityOperations,
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
        composite: [ 'minimalId' ]
      },
      sk: {
        field: 'sk',
        composite: []
      }
    }
  }
} as const);

// Test entity service
class TestEntityService extends BaseEntityService<typeof TestEntitySchema> {
  constructor() {
    const entityConfiguration: EntityConfiguration = {
      table: 'test-table',
      client: new DynamoDBClient({})
    };
    super(TestEntitySchema, entityConfiguration, DIContainer.ROOT);
  }

  // Expose protected method for testing
  public testInjectActorContext<T extends Record<string, any>>(
    data: T,
    operation: 'create' | 'update',
    ctx?: ExecutionContext
  ): T {
    return (this as any).injectActorContext(data, operation, ctx);
  }
}

class MinimalEntityService extends BaseEntityService<typeof MinimalEntitySchema> {
  constructor() {
    const entityConfiguration: EntityConfiguration = {
      table: 'minimal-table',
      client: new DynamoDBClient({})
    };
    super(MinimalEntitySchema, entityConfiguration, DIContainer.ROOT);
  }

  // Expose protected method for testing
  public testInjectActorContext<T extends Record<string, any>>(
    data: T,
    operation: 'create' | 'update',
    ctx?: ExecutionContext
  ): T {
    return (this as any).injectActorContext(data, operation, ctx);
  }
}

// Helper function to create minimal mock actor for most tests
function createMinimalActor(overrides: Partial<Actor> = {}): Actor {
  return {
    requestId: 'req-123',
    timestamp: '2024-01-15T10:30:00.000Z',
    actorId: 'user-456',
    tenantId: 'tenant-abc',
    ...overrides
  };
}

// Helper function to create full mock actor for comprehensive tests
function createFullMockActor(overrides: Partial<Actor> = {}): Actor {
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
function createMockExecutionContext(actor?: Actor): ExecutionContext {
  return {
    event: {} as any,
    lambdaContext: {} as any,
    request: {} as any,
    response: {} as any,
    actor,
    debugInfo: {}
  };
}

describe('BaseEntityService Actor Context Injection', () => {
  let service: TestEntityService;
  let minimalService: MinimalEntityService;
  let backend: MockBackend;

  beforeEach(() => {
    // Enable aggressive span filtering to ensure "pinned parent" spans still survive.
    backend = setupTestObservability({ enabled: true, skipEmptySpans: true, minSpanDurationMs: 999999 });
    service = new TestEntityService();
    minimalService = new MinimalEntityService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanupTestObservability();
  });

  describe('hasAttribute utility function', () => {
    it('should correctly detect attributes in schema', () => {
      expect(hasAttribute(TestEntitySchema, 'createdBy')).toBe(true);
      expect(hasAttribute(TestEntitySchema, 'updatedBy')).toBe(true);
      expect(hasAttribute(TestEntitySchema, 'tenantId')).toBe(true);
      expect(hasAttribute(TestEntitySchema, 'nonExistentField')).toBe(false);
    });

    it('should correctly detect missing attributes in minimal schema', () => {
      expect(hasAttribute(MinimalEntitySchema, 'createdBy')).toBe(false);
      expect(hasAttribute(MinimalEntitySchema, 'updatedBy')).toBe(false);
      expect(hasAttribute(MinimalEntitySchema, 'tenantId')).toBe(false);
    });
  });

  describe('isAttributeReadOnly utility function', () => {
    it('should correctly detect read-only attributes', () => {
      // Most attributes are not read-only by default
      expect(isAttributeReadOnly(TestEntitySchema, 'createdBy')).toBe(false);
      expect(isAttributeReadOnly(TestEntitySchema, 'updatedBy')).toBe(false);
      expect(isAttributeReadOnly(TestEntitySchema, 'tenantId')).toBe(false);
      expect(isAttributeReadOnly(TestEntitySchema, 'title')).toBe(false);
    });

    it('should return false for non-existent attributes', () => {
      expect(isAttributeReadOnly(TestEntitySchema, 'nonExistentField')).toBe(false);
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
      expect((result as any).createdBy).toBe('user-456');
      expect((result as any).updatedBy).toBe('user-456');
      expect((result as any).tenantId).toBe('tenant-abc');
      expect((result as any)._actor).toEqual(mockActor);

      // Timestamps should be system-generated (current time)
      expect((result as any).createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect((result as any).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date((result as any).createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
      expect(new Date((result as any).updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
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
      expect((result as any).tenantId).toBe('tenant-abc'); // tenantId is set even when actorId is undefined
      expect((result as any)._actor).toEqual(mockActor);

      // createdBy and updatedBy should not be set when actorId is undefined
      expect(result).not.toHaveProperty('createdBy');
      expect(result).not.toHaveProperty('updatedBy');

      // But timestamps should be system-generated
      expect((result as any).createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect((result as any).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date((result as any).createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
      expect(new Date((result as any).updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
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
      expect((result as any).createdBy).toBe('user-456');
      expect((result as any).updatedBy).toBe('user-456');
      expect((result as any)._actor).toEqual(mockActor);

      // tenantId should not be set when undefined
      expect(result).not.toHaveProperty('tenantId');

      // Timestamps should be system-generated
      expect((result as any).createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect((result as any).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date((result as any).createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
      expect(new Date((result as any).updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
    });
  });

  describe('Parent span linkage for audits (_actor.parentObservabilityLogId)', () => {
    it('should NOT set _actor.parentObservabilityLogId (parent is strict in-slice only; cross-hop uses causedBy)', async () => {
      const actor = createFullMockActor({
        correlationId: 'corr-1',
        // parentObservabilityLogId should never be inferred/persisted for cross-hop linkage.
        parentObservabilityLogId: undefined,
      });

      let spanId: string | undefined;

      await createTestContext(async () => {
        await SpanObserver.withSpan('request', async (span) => {
          spanId = span.id;

          // Simulate an update payload and omit ctx so injectActorContext reads actor from ALS.
          const payload = { testId: '1', title: 't' };
          const enhanced = service.testInjectActorContext(payload, 'update');

          expect((enhanced as any)._actor).toBeTruthy();
          expect((enhanced as any)._actor.parentObservabilityLogId).toBeUndefined();
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
      expect((result as any).updatedBy).toBe('user-456');
      expect((result as any).tenantId).toBe('tenant-abc');
      expect((result as any)._actor).toEqual(mockActor);

      // Should not set create fields for update operation
      expect(result).not.toHaveProperty('createdBy');
      expect(result).not.toHaveProperty('createdAt');

      // updatedAt should be system-generated
      expect((result as any).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date((result as any).updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
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
      expect((result as any).updatedBy).toBe('user-456');
      expect((result as any).tenantId).toBe('tenant-abc');
      expect((result as any)._actor).toEqual(mockActor);

      // updatedAt should be system-generated
      expect((result as any).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date((result as any).updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
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
      expect((result as any).createdBy).toBe('user-456');
      expect((result as any).updatedBy).toBe('user-456');
      expect((result as any).tenantId).toBe('tenant-abc');
      expect((result as any)._actor).toEqual(mockActor);

      // Timestamps should be system-generated
      expect((result as any).createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect((result as any).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date((result as any).createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
      expect(new Date((result as any).updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
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
      expect((result as any)._actor).toEqual(mockActor);
    });

    it('should handle complex actor context', () => {
      const complexActor = createFullMockActor({
        cognitoGroups: [ 'admin', 'user', 'manager' ],
        rawAuthContext: {
          sub: 'sub-789',
          'cognito:username': 'john.doe',
          email: 'john@example.com',
          'custom:department': 'engineering'
        },
        customField: 'custom value',
        nestedData: {
          permissions: [ 'read', 'write' ],
          metadata: { role: 'admin' }
        }
      });

      const ctx = createMockExecutionContext(complexActor);

      const inputData = {
        title: 'Test Title'
      };

      const result = service.testInjectActorContext(inputData, 'create', ctx);

      expect((result as any)._actor).toEqual(complexActor);
      expect((result as any)._actor.cognitoGroups).toEqual([ 'admin', 'user', 'manager' ]);
      expect((result as any)._actor.rawAuthContext).toEqual({
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
        arrayField: [ 1, 2, 3 ],
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
      expect(result.arrayField).toEqual([ 1, 2, 3 ]);
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
      const mockActor = createMinimalActor({ timestamp: null as any });
      const ctx = createMockExecutionContext(mockActor);

      const result = service.testInjectActorContext({ title: 'Test' }, 'create', ctx);

      // Even with null actor timestamp, database timestamps should use current system time
      expect((result as any).createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect((result as any).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date((result as any).createdAt).getTime()).toBeGreaterThan(Date.now() - 5000);
      expect(new Date((result as any).updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
    });

    it('should handle extremely large actor context', () => {
      const largeRawContext = Array.from({ length: 1000 }, (_, i) => [ `key${i}`, `value${i}` ])
        .reduce((acc, [ k, v ]) => ({ ...acc, [ k ]: v }), {});

      const mockActor = createFullMockActor({ rawAuthContext: largeRawContext });
      const ctx = createMockExecutionContext(mockActor);

      const result = service.testInjectActorContext({ title: 'Test' }, 'create', ctx);

      expect((result as any)._actor.rawAuthContext).toEqual(largeRawContext);
    });

    it('should handle circular reference in actor data gracefully', () => {
      const mockActor = createMinimalActor();
      const circularObj: any = { self: null };
      circularObj.self = circularObj;
      (mockActor as any).circular = circularObj;

      const ctx = createMockExecutionContext(mockActor);

      // Should not throw error
      expect(() => {
        service.testInjectActorContext({ title: 'Test' }, 'create', ctx);
      }).not.toThrow();
    });
  });
});
