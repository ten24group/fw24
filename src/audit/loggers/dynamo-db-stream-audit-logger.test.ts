/**
 * Tests for DynamoDBStreamAuditLogger
 * 
 * Tests the stream handler's core functionality:
 * - Actor extraction from _actor field and fallback
 * - Correlation ID extraction
 * - Integration with AuditObserver
 * - Entity filtering (allowed/excluded)
 */
import { DynamoDBStreamAuditLogger } from './dynamo-db-stream-audit-logger';
import { getChangedProperties } from '../helpers/change-detection';
import { BaseEventRecord, ChangeStreamPayload } from '../../core/types/event-processor-types';
import { Actor } from '../../core/types/execution-context';
import { AuditObserver } from '../../observability';

// Mock dependencies
jest.mock('../../observability', () => ({
    AuditObserver: {
        entityCreate: jest.fn(),
        entityUpdate: jest.fn(),
        entityDelete: jest.fn(),
    }
}));

jest.mock('../../utils/env', () => ({
    resolveEnvValueFor: jest.fn(() => undefined)
}));

// Helper to access protected methods for testing
class TestableStreamAuditLogger extends DynamoDBStreamAuditLogger {
    public testExtractActor(
        newImage: Record<string, unknown> | undefined,
        oldImage: Record<string, unknown> | undefined
    ): Actor | undefined {
        return this.extractActor(newImage, oldImage);
    }

    public testExtractCorrelationId(
        record: BaseEventRecord<ChangeStreamPayload>,
        newImage: Record<string, unknown> | undefined,
        oldImage: Record<string, unknown> | undefined
    ): string {
        return this.extractCorrelationId(record, newImage, oldImage);
    }

    public testCaptureAuditEvent(record: BaseEventRecord<ChangeStreamPayload>): Promise<void> {
        return this.captureAuditEvent(record);
    }

    public testShouldAuditEntity(entityName: string): boolean {
        return this.shouldAuditEntity(entityName);
    }
}

describe('DynamoDBStreamAuditLogger', () => {
    let auditLogger: TestableStreamAuditLogger;
    const mockEntityCreate = AuditObserver.entityCreate as jest.Mock;
    const mockEntityUpdate = AuditObserver.entityUpdate as jest.Mock;
    const mockEntityDelete = AuditObserver.entityDelete as jest.Mock;

    beforeEach(() => {
        auditLogger = new TestableStreamAuditLogger();
        jest.clearAllMocks();
    });

    // Helper: Create minimal actor
    function createMinimalActor(overrides: Partial<Actor> = {}): Actor {
        return {
            requestId: 'req-123',
            timestamp: '2024-01-15T10:30:00.000Z',
            actorId: 'user-456',
            tenantId: 'tenant-abc',
            ...overrides
        } as Actor;
    }

    // Helper: Create complete mock actor
    function createMockActor(overrides: Partial<Actor> = {}): Actor {
        return {
            requestId: 'req-123',
            timestamp: '2024-01-15T10:30:00.000Z',
            actorId: 'user-456',
            actorType: 'user',
            authMethod: 'cognito',
            sourceIp: '192.168.1.1',
            userAgent: 'Mozilla/5.0',
            tenantId: 'tenant-abc',
            correlationId: 'corr-xyz',
            email: 'john@example.com',
            cognito: {
                sub: 'sub-789',
                username: 'john.doe',
                groups: ['admin', 'user']
            },
            ...overrides
        } as Actor;
    }

    // Helper: Create mock event record
    function createMockEventRecord(
        overrides: Partial<BaseEventRecord<ChangeStreamPayload>> = {}
    ): BaseEventRecord<ChangeStreamPayload> {
        return {
            entityName: 'Post',
            eventType: 'update',
            timestamp: 1705314600000,
            entityId: 'post-123',
            eventId: 'evt-abc-123',
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

    describe('extractActor', () => {
        it('should extract actor from newImage._actor field', () => {
            const mockActor = createMinimalActor();
            const newImage = { title: 'Test', _actor: mockActor };
            const oldImage = { title: 'Old' };

            const actor = auditLogger.testExtractActor(newImage, oldImage);

            expect(actor).toEqual(mockActor);
        });

        it('should extract actor from oldImage._actor when newImage has no actor', () => {
            const mockActor = createMinimalActor();
            const newImage = undefined;
            const oldImage = { title: 'Deleted', _actor: mockActor };

            const actor = auditLogger.testExtractActor(newImage, oldImage);

            expect(actor).toEqual(mockActor);
        });

        it('should fallback to visible actor fields when _actor is not available', () => {
            const newImage = { 
                title: 'Test',
                updatedBy: 'user-visible-456',
                tenantId: 'tenant-visible-abc'
            };
            const oldImage = { title: 'Old' };

            const actor = auditLogger.testExtractActor(newImage, oldImage);

            expect(actor).toEqual({
                actorId: 'user-visible-456',
                tenantId: 'tenant-visible-abc',
                actorType: 'user'
            });
        });

        it('should prioritize updatedBy over createdBy', () => {
            const newImage = { 
                title: 'Test',
                createdBy: 'user-creator',
                updatedBy: 'user-updater',
                tenantId: 'tenant-abc'
            };

            const actor = auditLogger.testExtractActor(newImage, undefined);

            expect(actor?.actorId).toBe('user-updater');
        });

        it('should use createdBy when updatedBy is not available', () => {
            const newImage = { 
                title: 'Test',
                createdBy: 'user-creator',
                tenantId: 'tenant-abc'
            };

            const actor = auditLogger.testExtractActor(newImage, undefined);

            expect(actor?.actorId).toBe('user-creator');
        });

        it('should return undefined when no actor info available', () => {
            const newImage = { title: 'Test' };
            const oldImage = { title: 'Old' };

            const actor = auditLogger.testExtractActor(newImage, oldImage);

            expect(actor).toBeUndefined();
        });

        it('should handle complex actor with all fields', () => {
            const complexActor = createMockActor({
                sourceIp: '203.0.113.1',
                userAgent: 'Custom/1.0',
                cognito: {
                    sub: 'sub-789',
                    username: 'john.doe',
                    groups: ['admin', 'manager']
                }
            });

            const newImage = { title: 'Test', _actor: complexActor };

            const actor = auditLogger.testExtractActor(newImage, undefined);

            expect(actor).toEqual(complexActor);
            expect(actor?.cognito?.groups).toContain('admin');
        });

        it('should handle API key actor', () => {
            const apiKeyActor = createMinimalActor({
                actorType: 'service',
                authMethod: 'api-key',
                actorId: 'api-key:abc123'
            });

            const newImage = { title: 'Test', _actor: apiKeyActor };

            const actor = auditLogger.testExtractActor(newImage, undefined);

            expect(actor?.authMethod).toBe('api-key');
            expect(actor?.actorType).toBe('service');
        });

        it('should handle IAM actor', () => {
            const iamActor = createMinimalActor({
                actorType: 'service',
                authMethod: 'iam',
                actorId: 'AIDAI23HZ27SI6FQMGNQ2'
            });

            const newImage = { title: 'Test', _actor: iamActor };

            const actor = auditLogger.testExtractActor(newImage, undefined);

            expect(actor?.authMethod).toBe('iam');
            expect(actor?.actorType).toBe('service');
        });

        it('should handle null/undefined actor gracefully', () => {
            const newImage = { title: 'Test', _actor: null };
            const oldImage = { title: 'Old', _actor: undefined };

            const actor = auditLogger.testExtractActor(newImage as any, oldImage as any);

            expect(actor).toBeUndefined();
        });

        it('should handle system/anonymous actor context', () => {
            const systemActor = createMinimalActor({
                actorType: 'anonymous',
                authMethod: 'anonymous',
                actorId: 'anonymous',
                tenantId: undefined
            });

            const newImage = { title: 'Test', _actor: systemActor };

            const actor = auditLogger.testExtractActor(newImage, undefined);

            expect(actor?.authMethod).toBe('anonymous');
            expect(actor?.actorType).toBe('anonymous');
            expect(actor?.actorId).toBe('anonymous');
        });

        it('should use invalid actor as-is when _actor field exists but is invalid', () => {
            const newImage = { 
                title: 'Test', 
                updatedBy: 'fallback-user-123',
                tenantId: 'fallback-tenant',
                _actor: 'invalid-actor-string' // Invalid actor type
            };

            const actor = auditLogger.testExtractActor(newImage as any, undefined);

            // Should use invalid actor as-is since _actor field exists
            expect(actor).toBe('invalid-actor-string');
        });

        it('should handle empty/minimal actor objects', () => {
            const minimalActor = {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z'
                // Missing most fields
            } as Actor;

            const newImage = { title: 'Test', _actor: minimalActor };

            const actor = auditLogger.testExtractActor(newImage, undefined);

            expect(actor).toEqual(minimalActor);
        });
    });

    describe('extractCorrelationId', () => {
        it('should extract correlationId from _actor.correlationId', () => {
            const actorWithCorrelation = createMockActor({ correlationId: 'corr-from-actor-123' });
            const record = createMockEventRecord();
            const newImage = { title: 'Test', _actor: actorWithCorrelation };

            const correlationId = auditLogger.testExtractCorrelationId(record, newImage, undefined);

            expect(correlationId).toBe('corr-from-actor-123');
        });

        it('should use DynamoDB eventId when no correlationId in actor', () => {
            const record = createMockEventRecord({ eventId: 'evt-dynamodb-456' });
            const newImage = { title: 'Test' };

            const correlationId = auditLogger.testExtractCorrelationId(record, newImage, undefined);

            expect(correlationId).toBe('stream-evt-dynamodb-456');
        });

        it('should generate fallback correlationId when no eventId', () => {
            const record = createMockEventRecord({ eventId: undefined });
            const newImage = { title: 'Test' };

            const correlationId = auditLogger.testExtractCorrelationId(record, newImage, undefined);

            expect(correlationId).toMatch(/^stream-Post-post-123-\d+$/);
        });

        it('should prefer oldImage._actor.correlationId when newImage has none', () => {
            const actorWithCorrelation = createMockActor({ correlationId: 'corr-from-old-actor' });
            const record = createMockEventRecord();
            const newImage = { title: 'Test' };
            const oldImage = { title: 'Old', _actor: actorWithCorrelation };

            const correlationId = auditLogger.testExtractCorrelationId(record, newImage, oldImage);

            expect(correlationId).toBe('corr-from-old-actor');
        });
    });

    describe('captureAuditEvent', () => {
        it('should call AuditObserver.entityCreate for create events', async () => {
            const mockActor = createMinimalActor();
            const record = createMockEventRecord({
                eventType: 'create',
                payload: {
                    newImage: { postId: 'post-123', title: 'New Post', _actor: mockActor },
                    oldImage: undefined
                }
            });

            await auditLogger.testCaptureAuditEvent(record);

            expect(mockEntityCreate).toHaveBeenCalledTimes(1);
            expect(mockEntityCreate).toHaveBeenCalledWith(
                'Post',
                'post-123',
                expect.objectContaining({ postId: 'post-123', title: 'New Post' }),
                expect.objectContaining({ actor: mockActor })
            );
        });

        it('should call AuditObserver.entityUpdate for update events', async () => {
            const record = createMockEventRecord({
                eventType: 'update',
                payload: {
                    newImage: { postId: 'post-123', title: 'Updated' },
                    oldImage: { postId: 'post-123', title: 'Original' }
                }
            });

            await auditLogger.testCaptureAuditEvent(record);

            expect(mockEntityUpdate).toHaveBeenCalledTimes(1);
            expect(mockEntityUpdate).toHaveBeenCalledWith(
                'Post',
                'post-123',
                expect.objectContaining({
                    before: expect.objectContaining({ title: 'Original' }),
                    after: expect.objectContaining({ title: 'Updated' }),
                    diff: expect.objectContaining({
                        title: { old: 'Original', new: 'Updated' }
                    })
                }),
                expect.any(Object)
            );
        });

        it('should call AuditObserver.entityDelete for delete events', async () => {
            const mockActor = createMinimalActor();
            const record = createMockEventRecord({
                eventType: 'delete',
                payload: {
                    newImage: undefined,
                    oldImage: { postId: 'post-123', title: 'Deleted Post', _actor: mockActor }
                }
            });

            await auditLogger.testCaptureAuditEvent(record);

            expect(mockEntityDelete).toHaveBeenCalledTimes(1);
            expect(mockEntityDelete).toHaveBeenCalledWith(
                'Post',
                'post-123',
                expect.objectContaining({ postId: 'post-123', title: 'Deleted Post' }),
                expect.objectContaining({ actor: mockActor })
            );
        });

        it('should skip update when no changes detected', async () => {
            const record = createMockEventRecord({
                eventType: 'update',
                payload: {
                    newImage: { postId: 'post-123', title: 'Same' },
                    oldImage: { postId: 'post-123', title: 'Same' }
                }
            });

            await auditLogger.testCaptureAuditEvent(record);

            expect(mockEntityUpdate).not.toHaveBeenCalled();
            expect(mockEntityCreate).not.toHaveBeenCalled();
            expect(mockEntityDelete).not.toHaveBeenCalled();
        });

        it('should pass correlationId from actor context', async () => {
            const actorWithCorrelation = createMockActor({ correlationId: 'trace-123' });
            const record = createMockEventRecord({
                eventType: 'create',
                payload: {
                    newImage: { postId: 'post-123', title: 'Test', _actor: actorWithCorrelation },
                    oldImage: undefined
                }
            });

            await auditLogger.testCaptureAuditEvent(record);

            expect(mockEntityCreate).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(Object),
                expect.objectContaining({ correlationId: 'trace-123' })
            );
        });
    });

    describe('shouldAuditEntity', () => {
        it('should exclude auditLog entity by default', () => {
            expect(auditLogger.testShouldAuditEntity('auditLog')).toBe(false);
        });

        it('should exclude observabilityLog entity by default', () => {
            expect(auditLogger.testShouldAuditEntity('observabilityLog')).toBe(false);
        });

        it('should audit other entities by default', () => {
            expect(auditLogger.testShouldAuditEntity('User')).toBe(true);
            expect(auditLogger.testShouldAuditEntity('Post')).toBe(true);
            expect(auditLogger.testShouldAuditEntity('Order')).toBe(true);
        });
    });

    describe('getChangedProperties integration', () => {
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

        it('should detect changes while ignoring _actor', () => {
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

            expect(changes.title).toEqual({ old: 'Title', new: 'Updated Title' });
            expect(changes.content).toEqual({ old: 'Content', new: 'Updated Content' });
            expect(changes.updatedBy).toEqual({ old: 'user-1', new: 'user-2' });
            expect(changes).not.toHaveProperty('_actor');
        });

        it('should return empty when only _actor field changes', () => {
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

            expect(Object.keys(changes).length).toBe(0);
        });
    });
});

