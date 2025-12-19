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
    ): Actor | undefined {
        return this.extractActor(newImage);
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
                groups: [ 'admin', 'user' ]
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

        it('should pass causedBy from actor context to link to original request', async () => {
            const actorWithCorrelation = createMockActor({ correlationId: 'original-api-request-123' });
            const record = createMockEventRecord({
                eventType: 'create',
                payload: {
                    newImage: { postId: 'post-123', title: 'Test', _actor: actorWithCorrelation },
                    oldImage: undefined
                }
            });

            await auditLogger.testCaptureAuditEvent(record);

            // Verify causedBy is set to the original API request's correlationId
            expect(mockEntityCreate).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(Object),
                expect.objectContaining({ causedBy: 'original-api-request-123' })
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

