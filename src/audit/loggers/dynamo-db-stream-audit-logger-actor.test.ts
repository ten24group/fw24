import { DynamoDBStreamAuditLogger, getChangedProperties } from './dynamo-db-stream-audit-logger';
import { BaseEventRecord, ChangeStreamPayload } from '../../core/types/event-processor-types';
import { AuditEntry } from '../interfaces';
import { Actor } from '../../core/types/execution-context';

// Mock only essential dependencies
jest.mock('../../utils/env', () => ({
  resolveEnvValueFor: jest.fn(() => 'test-value')
}));

jest.mock('../loggers/factory', () => ({
  AuditLoggerFactory: {
    getInstance: () => ({
      create: jest.fn(() => ({
        audit: jest.fn()
      }))
    })
  }
}));

describe('DynamoDBStreamAuditLogger Actor Enhancement', () => {
  let auditLogger: DynamoDBStreamAuditLogger;

  beforeEach(() => {
    auditLogger = new DynamoDBStreamAuditLogger();
    jest.clearAllMocks();
  });

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

  // Helper function to create complete mock actor for comprehensive tests
  function createMockActor(overrides: Partial<Actor> = {}): Actor {
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
      cognitoGroups: ['admin', 'user'],
      rawAuthContext: {
        sub: 'sub-789',
        'cognito:username': 'john.doe',
        email: 'john@example.com'
      },
      ...overrides
    };
  }

  // Helper function to create mock event record
  function createMockEventRecord(
    overrides: Partial<BaseEventRecord<ChangeStreamPayload>> = {}
  ): BaseEventRecord<ChangeStreamPayload> {
    return {
      entityName: 'Post',
      eventType: 'update',
      timestamp: 1705314600000, // 2024-01-15T10:30:00.000Z in milliseconds
      entityId: 'post-123',
      payload: {
        newImage: {
          postId: 'post-123',
          title: 'Updated Title',
          content: 'Updated Content'
        },
        oldImage: {
          postId: 'post-123',
          title: 'Original Title',
          content: 'Original Content'
        }
      },
      ...overrides
    };
  }

  describe('makeAditEntry with Actor Context', () => {
    it('should extract actor context from newImage._actor field', () => {
      const mockActor = createMinimalActor();
      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'Updated Title',
            content: 'Updated Content',
            updatedBy: 'user-456',
            tenantId: 'tenant-abc',
            _actor: mockActor
          },
          oldImage: {
            postId: 'post-123',
            title: 'Original Title',
            content: 'Original Content',
            createdBy: 'user-123',
            updatedBy: 'user-original',
            tenantId: 'tenant-original'
          }
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry).toMatchObject({
        timestamp: '2024-01-15T10:30:00.000Z',
        entityName: 'Post',
        eventType: 'update',
        identifiers: {
          id: 'post-123'
        },
        actor: mockActor
      });

      expect(auditEntry.data).toEqual({
        title: { old: 'Original Title', new: 'Updated Title' },
        content: { old: 'Original Content', new: 'Updated Content' },
        createdBy: { old: 'user-123' }, // Field removed from newImage
        updatedBy: { old: 'user-original', new: 'user-456' },
        tenantId: { old: 'tenant-original', new: 'tenant-abc' }
      });
    });

    it('should extract actor context from oldImage._actor field when newImage has no actor', () => {
      const mockActor = createMinimalActor();
      const record = createMockEventRecord({
        eventType: 'delete',
        payload: {
          newImage: undefined,
          oldImage: {
            postId: 'post-123',
            title: 'Deleted Title',
            content: 'Deleted Content',
            createdBy: 'user-456',
            _actor: mockActor
          }
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry).toMatchObject({
        entityName: 'Post',
        eventType: 'delete',
        actor: mockActor
      });
    });

    it('should fallback to visible actor fields when _actor field is not available', () => {
      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'Updated Title',
            updatedBy: 'user-visible-456',
            tenantId: 'tenant-visible-abc'
          },
          oldImage: {
            postId: 'post-123',
            title: 'Original Title',
            createdBy: 'user-original-123'
          }
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry.actor).toEqual({
        actorId: 'user-visible-456',
        tenantId: 'tenant-visible-abc'
      });
    });

    it('should prioritize updatedBy over createdBy when both are present in fallback', () => {
      const record = createMockEventRecord({
        eventType: 'create',
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'New Title',
            createdBy: 'user-creator-123',
            updatedBy: 'user-updater-456',
            tenantId: 'tenant-abc'
          },
          oldImage: undefined
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry.actor).toEqual({
        actorId: 'user-updater-456',
        tenantId: 'tenant-abc'
      });
    });

    it('should handle complex actor context with all fields', () => {
      const complexActor = createMockActor({
        actorType: 'user',
        authMethod: 'cognito',
        sourceIp: '203.0.113.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        cognitoGroups: ['admin', 'manager', 'user'],
        rawAuthContext: {
          sub: 'sub-789',
          'cognito:username': 'john.doe',
          email: 'john@example.com',
          'custom:department': 'engineering',
          'custom:role': 'senior-developer'
        },
        sessionId: 'session-xyz-789',
        apiKeyId: undefined, // Not an API key auth
        iamRole: undefined, // Not IAM auth
        customField: 'custom-value'
      });

      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'Updated Title',
            _actor: complexActor
          },
          oldImage: {
            postId: 'post-123',
            title: 'Original Title'
          }
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry.actor).toEqual(complexActor);
      expect(auditEntry.actor.cognitoGroups).toContain('admin');
      expect(auditEntry.actor.rawAuthContext?.email).toBe('john@example.com');
      expect(auditEntry.actor.customField).toBe('custom-value');
    });

    it('should handle API key actor context', () => {
      const apiKeyActor = createMockActor({
        actorType: 'service',
        authMethod: 'api-key',
        actorId: 'api-key:abc123',
        apiKeyId: 'abc123',
        cognitoSub: undefined,
        cognitoUsername: undefined,
        cognitoGroups: undefined,
        rawAuthContext: undefined
      });

      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'API Created Title',
            _actor: apiKeyActor
          },
          oldImage: undefined
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry.actor).toEqual(apiKeyActor);
      expect(auditEntry.actor.authMethod).toBe('api-key');
      expect(auditEntry.actor.actorType).toBe('service');
      expect(auditEntry.actor.apiKeyId).toBe('abc123');
    });

    it('should handle IAM actor context', () => {
      const iamActor = createMockActor({
        actorType: 'service',
        authMethod: 'iam',
        actorId: 'AIDAI23HZ27SI6FQMGNQ2',
        iamRole: 'arn:aws:iam::123456789012:user/service-user',
        iamUserId: 'AIDAI23HZ27SI6FQMGNQ2',
        cognitoSub: undefined,
        cognitoUsername: undefined,
        cognitoGroups: undefined,
        rawAuthContext: undefined
      });

      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'IAM Updated Title',
            _actor: iamActor
          },
          oldImage: {
            postId: 'post-123',
            title: 'Original Title'
          }
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry.actor).toEqual(iamActor);
      expect(auditEntry.actor.authMethod).toBe('iam');
      expect(auditEntry.actor.iamRole).toBe('arn:aws:iam::123456789012:user/service-user');
    });

    it('should handle system/anonymous actor context', () => {
      const systemActor = createMockActor({
        actorType: 'anonymous',
        authMethod: 'system',
        actorId: 'system',
        cognitoSub: undefined,
        cognitoUsername: undefined,
        cognitoGroups: undefined,
        tenantId: undefined,
        rawAuthContext: undefined
      });

      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'System Generated Title',
            _actor: systemActor
          },
          oldImage: undefined
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry.actor).toEqual(systemActor);
      expect(auditEntry.actor.authMethod).toBe('system');
      expect(auditEntry.actor.actorType).toBe('anonymous');
      expect(auditEntry.actor.actorId).toBe('system');
    });

    it('should handle missing actor context gracefully', () => {
      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'No Actor Title'
            // No _actor field, no visible actor fields
          },
          oldImage: {
            postId: 'post-123',
            title: 'Original Title'
          }
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry.actor).toEqual({
        actorId: undefined,
        tenantId: undefined
      });
    });

    it('should skip audit entry when no changes detected', () => {
      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'Same Title',
            content: 'Same Content',
            _actor: createMockActor()
          },
          oldImage: {
            postId: 'post-123',
            title: 'Same Title',
            content: 'Same Content'
          }
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry).toBeUndefined();
    });

    it('should include request correlation data in audit entry', () => {
      const actorWithCorrelation = createMockActor({
        requestId: 'req-unique-123',
        correlationId: 'corr-trace-456',
        sessionId: 'session-789'
      });

      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'Updated Title',
            _actor: actorWithCorrelation
          },
          oldImage: {
            postId: 'post-123',
            title: 'Original Title'
          }
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry.actor.requestId).toBe('req-unique-123');
      expect(auditEntry.actor.correlationId).toBe('corr-trace-456');
      expect(auditEntry.actor.sessionId).toBe('session-789');
    });
  });

  describe('getChangedProperties ignores _actor field', () => {
    it('should ignore _actor field in change detection', () => {
      const oldImage = {
        postId: 'post-123',
        title: 'Title',
        _actor: createMockActor({ actorId: 'old-user' })
      };

      const newImage = {
        postId: 'post-123',
        title: 'Updated Title',
        _actor: createMockActor({ actorId: 'new-user' })
      };

      const changes = getChangedProperties(oldImage, newImage);

      expect(changes).toEqual({
        title: { old: 'Title', new: 'Updated Title' }
      });
      expect(changes).not.toHaveProperty('_actor');
    });

    it('should detect other changes while ignoring _actor', () => {
      const oldImage = {
        postId: 'post-123',
        title: 'Title',
        content: 'Content',
        updatedBy: 'user-1',
        _actor: createMockActor({ actorId: 'user-1' })
      };

      const newImage = {
        postId: 'post-123',
        title: 'Updated Title',
        content: 'Updated Content',
        updatedBy: 'user-2',
        _actor: createMockActor({ actorId: 'user-2' })
      };

      const changes = getChangedProperties(oldImage, newImage);

      expect(changes).toEqual({
        title: { old: 'Title', new: 'Updated Title' },
        content: { old: 'Content', new: 'Updated Content' },
        updatedBy: { old: 'user-1', new: 'user-2' }
      });
      expect(changes).not.toHaveProperty('_actor');
    });

    it('should still detect changes when only _actor field changes', () => {
      const oldImage = {
        postId: 'post-123',
        title: 'Same Title',
        _actor: createMockActor({ actorId: 'user-1' })
      };

      const newImage = {
        postId: 'post-123',
        title: 'Same Title',
        _actor: createMockActor({ actorId: 'user-2' })
      };

      const changes = getChangedProperties(oldImage, newImage);

      expect(changes).toEqual({});
      expect(Object.keys(changes).length).toBe(0);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle null/undefined actor gracefully', () => {
      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'Title',
            _actor: null as any
          },
          oldImage: {
            postId: 'post-123',
            title: 'Old Title',
            _actor: undefined
          }
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry.actor).toEqual({
        actorId: undefined,
        tenantId: undefined
      });
    });

    it('should validate actor structure and fallback to visible fields for invalid actor', () => {
      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'Title',
            updatedBy: 'fallback-user-123',
            tenantId: 'fallback-tenant',
            _actor: 'invalid-actor-string' as any // Invalid actor type
          },
          oldImage: {
            postId: 'post-123',
            title: 'Old Title'
          }
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      // Should use fallback when _actor is invalid
      expect(auditEntry.actor).toEqual({
        actorId: 'fallback-user-123',
        tenantId: 'fallback-tenant'
      });
    });

    it('should handle empty/minimal actor objects', () => {
      const minimalActor = {
        requestId: 'req-123',
        timestamp: '2024-01-15T10:30:00.000Z'
        // Missing most fields
      } as Actor;

      const record = createMockEventRecord({
        payload: {
          newImage: {
            postId: 'post-123',
            title: 'Title',
            _actor: minimalActor
          },
          oldImage: {
            postId: 'post-123',
            title: 'Old Title'
          }
        }
      });

      const auditEntry = (auditLogger as any).makeAditEntry(record);

      expect(auditEntry.actor).toEqual(minimalActor);
    });
  });
});
