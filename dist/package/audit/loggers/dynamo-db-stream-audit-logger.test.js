"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Tests for DynamoDBStreamAuditLogger
 *
 * Tests the stream handler's core functionality:
 * - Actor extraction from _actor field and fallback
 * - Correlation ID extraction
 * - Integration with AuditObserver
 * - Entity filtering (allowed/excluded)
 */
const dynamo_db_stream_audit_logger_1 = require("./dynamo-db-stream-audit-logger");
const change_detection_1 = require("../helpers/change-detection");
const observability_1 = require("../../observability");
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
class TestableStreamAuditLogger extends dynamo_db_stream_audit_logger_1.DynamoDBStreamAuditLogger {
    testExtractActor(newImage, oldImage) {
        return this.extractActor(newImage, oldImage);
    }
    testExtractCorrelationId(record, newImage, oldImage) {
        return this.extractCorrelationId(record, newImage, oldImage);
    }
    testCaptureAuditEvent(record) {
        return this.captureAuditEvent(record);
    }
    testShouldAuditEntity(entityName) {
        return this.shouldAuditEntity(entityName);
    }
}
describe('DynamoDBStreamAuditLogger', () => {
    let auditLogger;
    const mockEntityCreate = observability_1.AuditObserver.entityCreate;
    const mockEntityUpdate = observability_1.AuditObserver.entityUpdate;
    const mockEntityDelete = observability_1.AuditObserver.entityDelete;
    beforeEach(() => {
        auditLogger = new TestableStreamAuditLogger();
        jest.clearAllMocks();
    });
    // Helper: Create minimal actor
    function createMinimalActor(overrides = {}) {
        return {
            requestId: 'req-123',
            timestamp: '2024-01-15T10:30:00.000Z',
            actorId: 'user-456',
            tenantId: 'tenant-abc',
            ...overrides
        };
    }
    // Helper: Create complete mock actor
    function createMockActor(overrides = {}) {
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
        };
    }
    // Helper: Create mock event record
    function createMockEventRecord(overrides = {}) {
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
            const actor = auditLogger.testExtractActor(newImage, oldImage);
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
            const actor = auditLogger.testExtractActor(newImage, undefined);
            // Should use invalid actor as-is since _actor field exists
            expect(actor).toBe('invalid-actor-string');
        });
        it('should handle empty/minimal actor objects', () => {
            const minimalActor = {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z'
                // Missing most fields
            };
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
            expect(mockEntityCreate).toHaveBeenCalledWith('Post', 'post-123', expect.objectContaining({ postId: 'post-123', title: 'New Post' }), expect.objectContaining({ actor: mockActor }));
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
            expect(mockEntityUpdate).toHaveBeenCalledWith('Post', 'post-123', expect.objectContaining({
                before: expect.objectContaining({ title: 'Original' }),
                after: expect.objectContaining({ title: 'Updated' }),
                diff: expect.objectContaining({
                    title: { old: 'Original', new: 'Updated' }
                })
            }), expect.any(Object));
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
            expect(mockEntityDelete).toHaveBeenCalledWith('Post', 'post-123', expect.objectContaining({ postId: 'post-123', title: 'Deleted Post' }), expect.objectContaining({ actor: mockActor }));
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
            expect(mockEntityCreate).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(Object), expect.objectContaining({ correlationId: 'trace-123' }));
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
            const changes = (0, change_detection_1.getChangedProperties)(oldImage, newImage);
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
            const changes = (0, change_detection_1.getChangedProperties)(oldImage, newImage);
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
            const changes = (0, change_detection_1.getChangedProperties)(oldImage, newImage);
            expect(Object.keys(changes).length).toBe(0);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vLWRiLXN0cmVhbS1hdWRpdC1sb2dnZXIudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9sb2dnZXJzL2R5bmFtby1kYi1zdHJlYW0tYXVkaXQtbG9nZ2VyLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7Ozs7R0FRRztBQUNILG1GQUE0RTtBQUM1RSxrRUFBbUU7QUFHbkUsdURBQW9EO0FBRXBELG9CQUFvQjtBQUNwQixJQUFJLENBQUMsSUFBSSxDQUFDLHFCQUFxQixFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDcEMsYUFBYSxFQUFFO1FBQ1gsWUFBWSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDdkIsWUFBWSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDdkIsWUFBWSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7S0FDMUI7Q0FDSixDQUFDLENBQUMsQ0FBQztBQUVKLElBQUksQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUNoQyxrQkFBa0IsRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FBQztDQUMvQyxDQUFDLENBQUMsQ0FBQztBQUVKLGlEQUFpRDtBQUNqRCxNQUFNLHlCQUEwQixTQUFRLHlEQUF5QjtJQUN0RCxnQkFBZ0IsQ0FDbkIsUUFBNkMsRUFDN0MsUUFBNkM7UUFFN0MsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQztJQUNqRCxDQUFDO0lBRU0sd0JBQXdCLENBQzNCLE1BQTRDLEVBQzVDLFFBQTZDLEVBQzdDLFFBQTZDO1FBRTdDLE9BQU8sSUFBSSxDQUFDLG9CQUFvQixDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDakUsQ0FBQztJQUVNLHFCQUFxQixDQUFDLE1BQTRDO1FBQ3JF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QUMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDaEQsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBUZXN0cyBmb3IgRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlclxuICogXG4gKiBUZXN0cyB0aGUgc3RyZWFtIGhhbmRsZXIncyBjb3JlIGZ1bmN0aW9uYWxpdHk6XG4gKiAtIEFjdG9yIGV4dHJhY3Rpb24gZnJvbSBfYWN0b3IgZmllbGQgYW5kIGZhbGxiYWNrXG4gKiAtIENvcnJlbGF0aW9uIElEIGV4dHJhY3Rpb25cbiAqIC0gSW50ZWdyYXRpb24gd2l0aCBBdWRpdE9ic2VydmVyXG4gKiAtIEVudGl0eSBmaWx0ZXJpbmcgKGFsbG93ZWQvZXhjbHVkZWQpXG4gKi9cbmltcG9ydCB7IER5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXIgfSBmcm9tICcuL2R5bmFtby1kYi1zdHJlYW0tYXVkaXQtbG9nZ2VyJztcbmltcG9ydCB7IGdldENoYW5nZWRQcm9wZXJ0aWVzIH0gZnJvbSAnLi4vaGVscGVycy9jaGFuZ2UtZGV0ZWN0aW9uJztcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCwgQ2hhbmdlU3RyZWFtUGF5bG9hZCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzJztcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBBdWRpdE9ic2VydmVyIH0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eSc7XG5cbi8vIE1vY2sgZGVwZW5kZW5jaWVzXG5qZXN0Lm1vY2soJy4uLy4uL29ic2VydmFiaWxpdHknLCAoKSA9PiAoe1xuICAgIEF1ZGl0T2JzZXJ2ZXI6IHtcbiAgICAgICAgZW50aXR5Q3JlYXRlOiBqZXN0LmZuKCksXG4gICAgICAgIGVudGl0eVVwZGF0ZTogamVzdC5mbigpLFxuICAgICAgICBlbnRpdHlEZWxldGU6IGplc3QuZm4oKSxcbiAgICB9XG59KSk7XG5cbmplc3QubW9jaygnLi4vLi4vdXRpbHMvZW52JywgKCkgPT4gKHtcbiAgICByZXNvbHZlRW52VmFsdWVGb3I6IGplc3QuZm4oKCkgPT4gdW5kZWZpbmVkKVxufSkpO1xuXG4vLyBIZWxwZXIgdG8gYWNjZXNzIHByb3RlY3RlZCBtZXRob2RzIGZvciB0ZXN0aW5nXG5jbGFzcyBUZXN0YWJsZVN0cmVhbUF1ZGl0TG9nZ2VyIGV4dGVuZHMgRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlciB7XG4gICAgcHVibGljIHRlc3RFeHRyYWN0QWN0b3IoXG4gICAgICAgIG5ld0ltYWdlOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZCxcbiAgICAgICAgb2xkSW1hZ2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkXG4gICAgKTogQWN0b3IgfCB1bmRlZmluZWQge1xuICAgICAgICByZXR1cm4gdGhpcy5leHRyYWN0QWN0b3IobmV3SW1hZ2UsIG9sZEltYWdlKTtcbiAgICB9XG5cbiAgICBwdWJsaWMgdGVzdEV4dHJhY3RDb3JyZWxhdGlvbklkKFxuICAgICAgICByZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPixcbiAgICAgICAgbmV3SW1hZ2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkLFxuICAgICAgICBvbGRJbWFnZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWRcbiAgICApOiBzdHJpbmcge1xuICAgICAgICByZXR1cm4gdGhpcy5leHRyYWN0Q29ycmVsYXRpb25JZChyZWNvcmQsIG5ld0ltYWdlLCBvbGRJbWFnZSk7XG4gICAgfVxuXG4gICAgcHVibGljIHRlc3RDYXB0dXJlQXVkaXRFdmVudChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPik6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICByZXR1cm4gdGhpcy5jYXB0dXJlQXVkaXRFdmVudChyZWNvcmQpO1xuICAgIH1cblxuICAgIHB1YmxpYyB0ZXN0U2hvdWxkQXVkaXRFbnRpdHkoZW50aXR5TmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0aGlzLnNob3VsZEF1ZGl0RW50aXR5KGVudGl0eU5hbWUpO1xuICAgIH1cbn1cblxuZGVzY3JpYmUoJ0R5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXInLCAoKSA9PiB7XG4gICAgbGV0IGF1ZGl0TG9nZ2VyOiBUZXN0YWJsZVN0cmVhbUF1ZGl0TG9nZ2VyO1xuICAgIGNvbnN0IG1vY2tFbnRpdHlDcmVhdGUgPSBBdWRpdE9ic2VydmVyLmVudGl0eUNyZWF0ZSBhcyBqZXN0Lk1vY2s7XG4gICAgY29uc3QgbW9ja0VudGl0eVVwZGF0ZSA9IEF1ZGl0T2JzZXJ2ZXIuZW50aXR5VXBkYXRlIGFzIGplc3QuTW9jaztcbiAgICBjb25zdCBtb2NrRW50aXR5RGVsZXRlID0gQXVkaXRPYnNlcnZlci5lbnRpdHlEZWxldGUgYXMgamVzdC5Nb2NrO1xuXG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICAgIGF1ZGl0TG9nZ2VyID0gbmV3IFRlc3RhYmxlU3RyZWFtQXVkaXRMb2dnZXIoKTtcbiAgICAgICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG4gICAgfSk7XG5cbiAgICAvLyBIZWxwZXI6IENyZWF0ZSBtaW5pbWFsIGFjdG9yXG4gICAgZnVuY3Rpb24gY3JlYXRlTWluaW1hbEFjdG9yKG92ZXJyaWRlczogUGFydGlhbDxBY3Rvcj4gPSB7fSk6IEFjdG9yIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgICAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgICAgIGFjdG9ySWQ6ICd1c2VyLTQ1NicsXG4gICAgICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnLFxuICAgICAgICAgICAgLi4ub3ZlcnJpZGVzXG4gICAgICAgIH0gYXMgQWN0b3I7XG4gICAgfVxuXG4gICAgLy8gSGVscGVyOiBDcmVhdGUgY29tcGxldGUgbW9jayBhY3RvclxuICAgIGZ1bmN0aW9uIGNyZWF0ZU1vY2tBY3RvcihvdmVycmlkZXM6IFBhcnRpYWw8QWN0b3I+ID0ge30pOiBBY3RvciB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtMTIzJyxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICAgICAgICBhY3RvcklkOiAndXNlci00NTYnLFxuICAgICAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJyxcbiAgICAgICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wJyxcbiAgICAgICAgICAgIHRlbmFudElkOiAndGVuYW50LWFiYycsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci14eXonLFxuICAgICAgICAgICAgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJyxcbiAgICAgICAgICAgIGNvZ25pdG86IHtcbiAgICAgICAgICAgICAgICBzdWI6ICdzdWItNzg5JyxcbiAgICAgICAgICAgICAgICB1c2VybmFtZTogJ2pvaG4uZG9lJyxcbiAgICAgICAgICAgICAgICBncm91cHM6IFsnYWRtaW4nLCAndXNlciddXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLi4ub3ZlcnJpZGVzXG4gICAgICAgIH0gYXMgQWN0b3I7XG4gICAgfVxuXG4gICAgLy8gSGVscGVyOiBDcmVhdGUgbW9jayBldmVudCByZWNvcmRcbiAgICBmdW5jdGlvbiBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoXG4gICAgICAgIG92ZXJyaWRlczogUGFydGlhbDxCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4+ID0ge31cbiAgICApOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4ge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZW50aXR5TmFtZTogJ1Bvc3QnLFxuICAgICAgICAgICAgZXZlbnRUeXBlOiAndXBkYXRlJyxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogMTcwNTMxNDYwMDAwMCxcbiAgICAgICAgICAgIGVudGl0eUlkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgZXZlbnRJZDogJ2V2dC1hYmMtMTIzJyxcbiAgICAgICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICAgICAgICBuZXdJbWFnZToge1xuICAgICAgICAgICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlOiAnVXBkYXRlZCBUaXRsZScsXG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6ICdVcGRhdGVkIENvbnRlbnQnXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBvbGRJbWFnZToge1xuICAgICAgICAgICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlOiAnT3JpZ2luYWwgVGl0bGUnLFxuICAgICAgICAgICAgICAgICAgICBjb250ZW50OiAnT3JpZ2luYWwgQ29udGVudCdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLi4ub3ZlcnJpZGVzXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgZGVzY3JpYmUoJ2V4dHJhY3RBY3RvcicsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCBleHRyYWN0IGFjdG9yIGZyb20gbmV3SW1hZ2UuX2FjdG9yIGZpZWxkJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbW9ja0FjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKCk7XG4gICAgICAgICAgICBjb25zdCBuZXdJbWFnZSA9IHsgdGl0bGU6ICdUZXN0JywgX2FjdG9yOiBtb2NrQWN0b3IgfTtcbiAgICAgICAgICAgIGNvbnN0IG9sZEltYWdlID0geyB0aXRsZTogJ09sZCcgfTtcblxuICAgICAgICAgICAgY29uc3QgYWN0b3IgPSBhdWRpdExvZ2dlci50ZXN0RXh0cmFjdEFjdG9yKG5ld0ltYWdlLCBvbGRJbWFnZSk7XG5cbiAgICAgICAgICAgIGV4cGVjdChhY3RvcikudG9FcXVhbChtb2NrQWN0b3IpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGV4dHJhY3QgYWN0b3IgZnJvbSBvbGRJbWFnZS5fYWN0b3Igd2hlbiBuZXdJbWFnZSBoYXMgbm8gYWN0b3InLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBtb2NrQWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3IoKTtcbiAgICAgICAgICAgIGNvbnN0IG5ld0ltYWdlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgY29uc3Qgb2xkSW1hZ2UgPSB7IHRpdGxlOiAnRGVsZXRlZCcsIF9hY3RvcjogbW9ja0FjdG9yIH07XG5cbiAgICAgICAgICAgIGNvbnN0IGFjdG9yID0gYXVkaXRMb2dnZXIudGVzdEV4dHJhY3RBY3RvcihuZXdJbWFnZSwgb2xkSW1hZ2UpO1xuXG4gICAgICAgICAgICBleHBlY3QoYWN0b3IpLnRvRXF1YWwobW9ja0FjdG9yKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBmYWxsYmFjayB0byB2aXNpYmxlIGFjdG9yIGZpZWxkcyB3aGVuIF9hY3RvciBpcyBub3QgYXZhaWxhYmxlJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbmV3SW1hZ2UgPSB7IFxuICAgICAgICAgICAgICAgIHRpdGxlOiAnVGVzdCcsXG4gICAgICAgICAgICAgICAgdXBkYXRlZEJ5OiAndXNlci12aXNpYmxlLTQ1NicsXG4gICAgICAgICAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtdmlzaWJsZS1hYmMnXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY29uc3Qgb2xkSW1hZ2UgPSB7IHRpdGxlOiAnT2xkJyB9O1xuXG4gICAgICAgICAgICBjb25zdCBhY3RvciA9IGF1ZGl0TG9nZ2VyLnRlc3RFeHRyYWN0QWN0b3IobmV3SW1hZ2UsIG9sZEltYWdlKTtcblxuICAgICAgICAgICAgZXhwZWN0KGFjdG9yKS50b0VxdWFsKHtcbiAgICAgICAgICAgICAgICBhY3RvcklkOiAndXNlci12aXNpYmxlLTQ1NicsXG4gICAgICAgICAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtdmlzaWJsZS1hYmMnLFxuICAgICAgICAgICAgICAgIGFjdG9yVHlwZTogJ3VzZXInXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBwcmlvcml0aXplIHVwZGF0ZWRCeSBvdmVyIGNyZWF0ZWRCeScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG5ld0ltYWdlID0geyBcbiAgICAgICAgICAgICAgICB0aXRsZTogJ1Rlc3QnLFxuICAgICAgICAgICAgICAgIGNyZWF0ZWRCeTogJ3VzZXItY3JlYXRvcicsXG4gICAgICAgICAgICAgICAgdXBkYXRlZEJ5OiAndXNlci11cGRhdGVyJyxcbiAgICAgICAgICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCBhY3RvciA9IGF1ZGl0TG9nZ2VyLnRlc3RFeHRyYWN0QWN0b3IobmV3SW1hZ2UsIHVuZGVmaW5lZCk7XG5cbiAgICAgICAgICAgIGV4cGVjdChhY3Rvcj8uYWN0b3JJZCkudG9CZSgndXNlci11cGRhdGVyJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgdXNlIGNyZWF0ZWRCeSB3aGVuIHVwZGF0ZWRCeSBpcyBub3QgYXZhaWxhYmxlJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbmV3SW1hZ2UgPSB7IFxuICAgICAgICAgICAgICAgIHRpdGxlOiAnVGVzdCcsXG4gICAgICAgICAgICAgICAgY3JlYXRlZEJ5OiAndXNlci1jcmVhdG9yJyxcbiAgICAgICAgICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCBhY3RvciA9IGF1ZGl0TG9nZ2VyLnRlc3RFeHRyYWN0QWN0b3IobmV3SW1hZ2UsIHVuZGVmaW5lZCk7XG5cbiAgICAgICAgICAgIGV4cGVjdChhY3Rvcj8uYWN0b3JJZCkudG9CZSgndXNlci1jcmVhdG9yJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgcmV0dXJuIHVuZGVmaW5lZCB3aGVuIG5vIGFjdG9yIGluZm8gYXZhaWxhYmxlJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbmV3SW1hZ2UgPSB7IHRpdGxlOiAnVGVzdCcgfTtcbiAgICAgICAgICAgIGNvbnN0IG9sZEltYWdlID0geyB0aXRsZTogJ09sZCcgfTtcblxuICAgICAgICAgICAgY29uc3QgYWN0b3IgPSBhdWRpdExvZ2dlci50ZXN0RXh0cmFjdEFjdG9yKG5ld0ltYWdlLCBvbGRJbWFnZSk7XG5cbiAgICAgICAgICAgIGV4cGVjdChhY3RvcikudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb21wbGV4IGFjdG9yIHdpdGggYWxsIGZpZWxkcycsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbXBsZXhBY3RvciA9IGNyZWF0ZU1vY2tBY3Rvcih7XG4gICAgICAgICAgICAgICAgc291cmNlSXA6ICcyMDMuMC4xMTMuMScsXG4gICAgICAgICAgICAgICAgdXNlckFnZW50OiAnQ3VzdG9tLzEuMCcsXG4gICAgICAgICAgICAgICAgY29nbml0bzoge1xuICAgICAgICAgICAgICAgICAgICBzdWI6ICdzdWItNzg5JyxcbiAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6ICdqb2huLmRvZScsXG4gICAgICAgICAgICAgICAgICAgIGdyb3VwczogWydhZG1pbicsICdtYW5hZ2VyJ11cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgbmV3SW1hZ2UgPSB7IHRpdGxlOiAnVGVzdCcsIF9hY3RvcjogY29tcGxleEFjdG9yIH07XG5cbiAgICAgICAgICAgIGNvbnN0IGFjdG9yID0gYXVkaXRMb2dnZXIudGVzdEV4dHJhY3RBY3RvcihuZXdJbWFnZSwgdW5kZWZpbmVkKTtcblxuICAgICAgICAgICAgZXhwZWN0KGFjdG9yKS50b0VxdWFsKGNvbXBsZXhBY3Rvcik7XG4gICAgICAgICAgICBleHBlY3QoYWN0b3I/LmNvZ25pdG8/Lmdyb3VwcykudG9Db250YWluKCdhZG1pbicpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGhhbmRsZSBBUEkga2V5IGFjdG9yJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgYXBpS2V5QWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3Ioe1xuICAgICAgICAgICAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgICAgIGF1dGhNZXRob2Q6ICdhcGkta2V5JyxcbiAgICAgICAgICAgICAgICBhY3RvcklkOiAnYXBpLWtleTphYmMxMjMnXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgbmV3SW1hZ2UgPSB7IHRpdGxlOiAnVGVzdCcsIF9hY3RvcjogYXBpS2V5QWN0b3IgfTtcblxuICAgICAgICAgICAgY29uc3QgYWN0b3IgPSBhdWRpdExvZ2dlci50ZXN0RXh0cmFjdEFjdG9yKG5ld0ltYWdlLCB1bmRlZmluZWQpO1xuXG4gICAgICAgICAgICBleHBlY3QoYWN0b3I/LmF1dGhNZXRob2QpLnRvQmUoJ2FwaS1rZXknKTtcbiAgICAgICAgICAgIGV4cGVjdChhY3Rvcj8uYWN0b3JUeXBlKS50b0JlKCdzZXJ2aWNlJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIElBTSBhY3RvcicsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlhbUFjdG9yID0gY3JlYXRlTWluaW1hbEFjdG9yKHtcbiAgICAgICAgICAgICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgICAgICAgICBhdXRoTWV0aG9kOiAnaWFtJyxcbiAgICAgICAgICAgICAgICBhY3RvcklkOiAnQUlEQUkyM0haMjdTSTZGUU1HTlEyJ1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IG5ld0ltYWdlID0geyB0aXRsZTogJ1Rlc3QnLCBfYWN0b3I6IGlhbUFjdG9yIH07XG5cbiAgICAgICAgICAgIGNvbnN0IGFjdG9yID0gYXVkaXRMb2dnZXIudGVzdEV4dHJhY3RBY3RvcihuZXdJbWFnZSwgdW5kZWZpbmVkKTtcblxuICAgICAgICAgICAgZXhwZWN0KGFjdG9yPy5hdXRoTWV0aG9kKS50b0JlKCdpYW0nKTtcbiAgICAgICAgICAgIGV4cGVjdChhY3Rvcj8uYWN0b3JUeXBlKS50b0JlKCdzZXJ2aWNlJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgaGFuZGxlIG51bGwvdW5kZWZpbmVkIGFjdG9yIGdyYWNlZnVsbHknLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBuZXdJbWFnZSA9IHsgdGl0bGU6ICdUZXN0JywgX2FjdG9yOiBudWxsIH07XG4gICAgICAgICAgICBjb25zdCBvbGRJbWFnZSA9IHsgdGl0bGU6ICdPbGQnLCBfYWN0b3I6IHVuZGVmaW5lZCB9O1xuXG4gICAgICAgICAgICBjb25zdCBhY3RvciA9IGF1ZGl0TG9nZ2VyLnRlc3RFeHRyYWN0QWN0b3IobmV3SW1hZ2UgYXMgYW55LCBvbGRJbWFnZSBhcyBhbnkpO1xuXG4gICAgICAgICAgICBleHBlY3QoYWN0b3IpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgc3lzdGVtL2Fub255bW91cyBhY3RvciBjb250ZXh0JywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3lzdGVtQWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3Ioe1xuICAgICAgICAgICAgICAgIGFjdG9yVHlwZTogJ2Fub255bW91cycsXG4gICAgICAgICAgICAgICAgYXV0aE1ldGhvZDogJ2Fub255bW91cycsXG4gICAgICAgICAgICAgICAgYWN0b3JJZDogJ2Fub255bW91cycsXG4gICAgICAgICAgICAgICAgdGVuYW50SWQ6IHVuZGVmaW5lZFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IG5ld0ltYWdlID0geyB0aXRsZTogJ1Rlc3QnLCBfYWN0b3I6IHN5c3RlbUFjdG9yIH07XG5cbiAgICAgICAgICAgIGNvbnN0IGFjdG9yID0gYXVkaXRMb2dnZXIudGVzdEV4dHJhY3RBY3RvcihuZXdJbWFnZSwgdW5kZWZpbmVkKTtcblxuICAgICAgICAgICAgZXhwZWN0KGFjdG9yPy5hdXRoTWV0aG9kKS50b0JlKCdhbm9ueW1vdXMnKTtcbiAgICAgICAgICAgIGV4cGVjdChhY3Rvcj8uYWN0b3JUeXBlKS50b0JlKCdhbm9ueW1vdXMnKTtcbiAgICAgICAgICAgIGV4cGVjdChhY3Rvcj8uYWN0b3JJZCkudG9CZSgnYW5vbnltb3VzJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgdXNlIGludmFsaWQgYWN0b3IgYXMtaXMgd2hlbiBfYWN0b3IgZmllbGQgZXhpc3RzIGJ1dCBpcyBpbnZhbGlkJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbmV3SW1hZ2UgPSB7IFxuICAgICAgICAgICAgICAgIHRpdGxlOiAnVGVzdCcsIFxuICAgICAgICAgICAgICAgIHVwZGF0ZWRCeTogJ2ZhbGxiYWNrLXVzZXItMTIzJyxcbiAgICAgICAgICAgICAgICB0ZW5hbnRJZDogJ2ZhbGxiYWNrLXRlbmFudCcsXG4gICAgICAgICAgICAgICAgX2FjdG9yOiAnaW52YWxpZC1hY3Rvci1zdHJpbmcnIC8vIEludmFsaWQgYWN0b3IgdHlwZVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgYWN0b3IgPSBhdWRpdExvZ2dlci50ZXN0RXh0cmFjdEFjdG9yKG5ld0ltYWdlIGFzIGFueSwgdW5kZWZpbmVkKTtcblxuICAgICAgICAgICAgLy8gU2hvdWxkIHVzZSBpbnZhbGlkIGFjdG9yIGFzLWlzIHNpbmNlIF9hY3RvciBmaWVsZCBleGlzdHNcbiAgICAgICAgICAgIGV4cGVjdChhY3RvcikudG9CZSgnaW52YWxpZC1hY3Rvci1zdHJpbmcnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgZW1wdHkvbWluaW1hbCBhY3RvciBvYmplY3RzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgbWluaW1hbEFjdG9yID0ge1xuICAgICAgICAgICAgICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWidcbiAgICAgICAgICAgICAgICAvLyBNaXNzaW5nIG1vc3QgZmllbGRzXG4gICAgICAgICAgICB9IGFzIEFjdG9yO1xuXG4gICAgICAgICAgICBjb25zdCBuZXdJbWFnZSA9IHsgdGl0bGU6ICdUZXN0JywgX2FjdG9yOiBtaW5pbWFsQWN0b3IgfTtcblxuICAgICAgICAgICAgY29uc3QgYWN0b3IgPSBhdWRpdExvZ2dlci50ZXN0RXh0cmFjdEFjdG9yKG5ld0ltYWdlLCB1bmRlZmluZWQpO1xuXG4gICAgICAgICAgICBleHBlY3QoYWN0b3IpLnRvRXF1YWwobWluaW1hbEFjdG9yKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnZXh0cmFjdENvcnJlbGF0aW9uSWQnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgZXh0cmFjdCBjb3JyZWxhdGlvbklkIGZyb20gX2FjdG9yLmNvcnJlbGF0aW9uSWQnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhY3RvcldpdGhDb3JyZWxhdGlvbiA9IGNyZWF0ZU1vY2tBY3Rvcih7IGNvcnJlbGF0aW9uSWQ6ICdjb3JyLWZyb20tYWN0b3ItMTIzJyB9KTtcbiAgICAgICAgICAgIGNvbnN0IHJlY29yZCA9IGNyZWF0ZU1vY2tFdmVudFJlY29yZCgpO1xuICAgICAgICAgICAgY29uc3QgbmV3SW1hZ2UgPSB7IHRpdGxlOiAnVGVzdCcsIF9hY3RvcjogYWN0b3JXaXRoQ29ycmVsYXRpb24gfTtcblxuICAgICAgICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGF1ZGl0TG9nZ2VyLnRlc3RFeHRyYWN0Q29ycmVsYXRpb25JZChyZWNvcmQsIG5ld0ltYWdlLCB1bmRlZmluZWQpO1xuXG4gICAgICAgICAgICBleHBlY3QoY29ycmVsYXRpb25JZCkudG9CZSgnY29yci1mcm9tLWFjdG9yLTEyMycpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIHVzZSBEeW5hbW9EQiBldmVudElkIHdoZW4gbm8gY29ycmVsYXRpb25JZCBpbiBhY3RvcicsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHJlY29yZCA9IGNyZWF0ZU1vY2tFdmVudFJlY29yZCh7IGV2ZW50SWQ6ICdldnQtZHluYW1vZGItNDU2JyB9KTtcbiAgICAgICAgICAgIGNvbnN0IG5ld0ltYWdlID0geyB0aXRsZTogJ1Rlc3QnIH07XG5cbiAgICAgICAgICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBhdWRpdExvZ2dlci50ZXN0RXh0cmFjdENvcnJlbGF0aW9uSWQocmVjb3JkLCBuZXdJbWFnZSwgdW5kZWZpbmVkKTtcblxuICAgICAgICAgICAgZXhwZWN0KGNvcnJlbGF0aW9uSWQpLnRvQmUoJ3N0cmVhbS1ldnQtZHluYW1vZGItNDU2Jyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgZ2VuZXJhdGUgZmFsbGJhY2sgY29ycmVsYXRpb25JZCB3aGVuIG5vIGV2ZW50SWQnLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoeyBldmVudElkOiB1bmRlZmluZWQgfSk7XG4gICAgICAgICAgICBjb25zdCBuZXdJbWFnZSA9IHsgdGl0bGU6ICdUZXN0JyB9O1xuXG4gICAgICAgICAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gYXVkaXRMb2dnZXIudGVzdEV4dHJhY3RDb3JyZWxhdGlvbklkKHJlY29yZCwgbmV3SW1hZ2UsIHVuZGVmaW5lZCk7XG5cbiAgICAgICAgICAgIGV4cGVjdChjb3JyZWxhdGlvbklkKS50b01hdGNoKC9ec3RyZWFtLVBvc3QtcG9zdC0xMjMtXFxkKyQvKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBwcmVmZXIgb2xkSW1hZ2UuX2FjdG9yLmNvcnJlbGF0aW9uSWQgd2hlbiBuZXdJbWFnZSBoYXMgbm9uZScsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGFjdG9yV2l0aENvcnJlbGF0aW9uID0gY3JlYXRlTW9ja0FjdG9yKHsgY29ycmVsYXRpb25JZDogJ2NvcnItZnJvbS1vbGQtYWN0b3InIH0pO1xuICAgICAgICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKCk7XG4gICAgICAgICAgICBjb25zdCBuZXdJbWFnZSA9IHsgdGl0bGU6ICdUZXN0JyB9O1xuICAgICAgICAgICAgY29uc3Qgb2xkSW1hZ2UgPSB7IHRpdGxlOiAnT2xkJywgX2FjdG9yOiBhY3RvcldpdGhDb3JyZWxhdGlvbiB9O1xuXG4gICAgICAgICAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gYXVkaXRMb2dnZXIudGVzdEV4dHJhY3RDb3JyZWxhdGlvbklkKHJlY29yZCwgbmV3SW1hZ2UsIG9sZEltYWdlKTtcblxuICAgICAgICAgICAgZXhwZWN0KGNvcnJlbGF0aW9uSWQpLnRvQmUoJ2NvcnItZnJvbS1vbGQtYWN0b3InKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnY2FwdHVyZUF1ZGl0RXZlbnQnLCAoKSA9PiB7XG4gICAgICAgIGl0KCdzaG91bGQgY2FsbCBBdWRpdE9ic2VydmVyLmVudGl0eUNyZWF0ZSBmb3IgY3JlYXRlIGV2ZW50cycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgICAgICAgICBldmVudFR5cGU6ICdjcmVhdGUnLFxuICAgICAgICAgICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICAgICAgICAgICAgbmV3SW1hZ2U6IHsgcG9zdElkOiAncG9zdC0xMjMnLCB0aXRsZTogJ05ldyBQb3N0JywgX2FjdG9yOiBtb2NrQWN0b3IgfSxcbiAgICAgICAgICAgICAgICAgICAgb2xkSW1hZ2U6IHVuZGVmaW5lZFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCBhdWRpdExvZ2dlci50ZXN0Q2FwdHVyZUF1ZGl0RXZlbnQocmVjb3JkKTtcblxuICAgICAgICAgICAgZXhwZWN0KG1vY2tFbnRpdHlDcmVhdGUpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygxKTtcbiAgICAgICAgICAgIGV4cGVjdChtb2NrRW50aXR5Q3JlYXRlKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgICAgICAgICAnUG9zdCcsXG4gICAgICAgICAgICAgICAgJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IHBvc3RJZDogJ3Bvc3QtMTIzJywgdGl0bGU6ICdOZXcgUG9zdCcgfSksXG4gICAgICAgICAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBhY3RvcjogbW9ja0FjdG9yIH0pXG4gICAgICAgICAgICApO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGNhbGwgQXVkaXRPYnNlcnZlci5lbnRpdHlVcGRhdGUgZm9yIHVwZGF0ZSBldmVudHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICAgICAgICAgIGV2ZW50VHlwZTogJ3VwZGF0ZScsXG4gICAgICAgICAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgICAgICAgICAgICBuZXdJbWFnZTogeyBwb3N0SWQ6ICdwb3N0LTEyMycsIHRpdGxlOiAnVXBkYXRlZCcgfSxcbiAgICAgICAgICAgICAgICAgICAgb2xkSW1hZ2U6IHsgcG9zdElkOiAncG9zdC0xMjMnLCB0aXRsZTogJ09yaWdpbmFsJyB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLnRlc3RDYXB0dXJlQXVkaXRFdmVudChyZWNvcmQpO1xuXG4gICAgICAgICAgICBleHBlY3QobW9ja0VudGl0eVVwZGF0ZSkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xuICAgICAgICAgICAgZXhwZWN0KG1vY2tFbnRpdHlVcGRhdGUpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICAgICAgICAgICdQb3N0JyxcbiAgICAgICAgICAgICAgICAncG9zdC0xMjMnLFxuICAgICAgICAgICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgICAgICAgICAgYmVmb3JlOiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IHRpdGxlOiAnT3JpZ2luYWwnIH0pLFxuICAgICAgICAgICAgICAgICAgICBhZnRlcjogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyB0aXRsZTogJ1VwZGF0ZWQnIH0pLFxuICAgICAgICAgICAgICAgICAgICBkaWZmOiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogeyBvbGQ6ICdPcmlnaW5hbCcsIG5ldzogJ1VwZGF0ZWQnIH1cbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICBleHBlY3QuYW55KE9iamVjdClcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgY2FsbCBBdWRpdE9ic2VydmVyLmVudGl0eURlbGV0ZSBmb3IgZGVsZXRlIGV2ZW50cycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgICAgICAgICBldmVudFR5cGU6ICdkZWxldGUnLFxuICAgICAgICAgICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICAgICAgICAgICAgbmV3SW1hZ2U6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAgICAgb2xkSW1hZ2U6IHsgcG9zdElkOiAncG9zdC0xMjMnLCB0aXRsZTogJ0RlbGV0ZWQgUG9zdCcsIF9hY3RvcjogbW9ja0FjdG9yIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgYXdhaXQgYXVkaXRMb2dnZXIudGVzdENhcHR1cmVBdWRpdEV2ZW50KHJlY29yZCk7XG5cbiAgICAgICAgICAgIGV4cGVjdChtb2NrRW50aXR5RGVsZXRlKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMSk7XG4gICAgICAgICAgICBleHBlY3QobW9ja0VudGl0eURlbGV0ZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICAgICAgICAgJ1Bvc3QnLFxuICAgICAgICAgICAgICAgICdwb3N0LTEyMycsXG4gICAgICAgICAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoeyBwb3N0SWQ6ICdwb3N0LTEyMycsIHRpdGxlOiAnRGVsZXRlZCBQb3N0JyB9KSxcbiAgICAgICAgICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IGFjdG9yOiBtb2NrQWN0b3IgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgc2tpcCB1cGRhdGUgd2hlbiBubyBjaGFuZ2VzIGRldGVjdGVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICAgICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICAgICAgICAgICAgbmV3SW1hZ2U6IHsgcG9zdElkOiAncG9zdC0xMjMnLCB0aXRsZTogJ1NhbWUnIH0sXG4gICAgICAgICAgICAgICAgICAgIG9sZEltYWdlOiB7IHBvc3RJZDogJ3Bvc3QtMTIzJywgdGl0bGU6ICdTYW1lJyB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLnRlc3RDYXB0dXJlQXVkaXRFdmVudChyZWNvcmQpO1xuXG4gICAgICAgICAgICBleHBlY3QobW9ja0VudGl0eVVwZGF0ZSkubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgICAgICAgIGV4cGVjdChtb2NrRW50aXR5Q3JlYXRlKS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgICAgICAgZXhwZWN0KG1vY2tFbnRpdHlEZWxldGUpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGl0KCdzaG91bGQgcGFzcyBjb3JyZWxhdGlvbklkIGZyb20gYWN0b3IgY29udGV4dCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGFjdG9yV2l0aENvcnJlbGF0aW9uID0gY3JlYXRlTW9ja0FjdG9yKHsgY29ycmVsYXRpb25JZDogJ3RyYWNlLTEyMycgfSk7XG4gICAgICAgICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICAgICAgICAgIGV2ZW50VHlwZTogJ2NyZWF0ZScsXG4gICAgICAgICAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgICAgICAgICAgICBuZXdJbWFnZTogeyBwb3N0SWQ6ICdwb3N0LTEyMycsIHRpdGxlOiAnVGVzdCcsIF9hY3RvcjogYWN0b3JXaXRoQ29ycmVsYXRpb24gfSxcbiAgICAgICAgICAgICAgICAgICAgb2xkSW1hZ2U6IHVuZGVmaW5lZFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCBhdWRpdExvZ2dlci50ZXN0Q2FwdHVyZUF1ZGl0RXZlbnQocmVjb3JkKTtcblxuICAgICAgICAgICAgZXhwZWN0KG1vY2tFbnRpdHlDcmVhdGUpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICAgICAgICAgIGV4cGVjdC5hbnkoU3RyaW5nKSxcbiAgICAgICAgICAgICAgICBleHBlY3QuYW55KFN0cmluZyksXG4gICAgICAgICAgICAgICAgZXhwZWN0LmFueShPYmplY3QpLFxuICAgICAgICAgICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHsgY29ycmVsYXRpb25JZDogJ3RyYWNlLTEyMycgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ3Nob3VsZEF1ZGl0RW50aXR5JywgKCkgPT4ge1xuICAgICAgICBpdCgnc2hvdWxkIGV4Y2x1ZGUgYXVkaXRMb2cgZW50aXR5IGJ5IGRlZmF1bHQnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoYXVkaXRMb2dnZXIudGVzdFNob3VsZEF1ZGl0RW50aXR5KCdhdWRpdExvZycpKS50b0JlKGZhbHNlKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBleGNsdWRlIG9ic2VydmFiaWxpdHlMb2cgZW50aXR5IGJ5IGRlZmF1bHQnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoYXVkaXRMb2dnZXIudGVzdFNob3VsZEF1ZGl0RW50aXR5KCdvYnNlcnZhYmlsaXR5TG9nJykpLnRvQmUoZmFsc2UpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpdCgnc2hvdWxkIGF1ZGl0IG90aGVyIGVudGl0aWVzIGJ5IGRlZmF1bHQnLCAoKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoYXVkaXRMb2dnZXIudGVzdFNob3VsZEF1ZGl0RW50aXR5KCdVc2VyJykpLnRvQmUodHJ1ZSk7XG4gICAgICAgICAgICBleHBlY3QoYXVkaXRMb2dnZXIudGVzdFNob3VsZEF1ZGl0RW50aXR5KCdQb3N0JykpLnRvQmUodHJ1ZSk7XG4gICAgICAgICAgICBleHBlY3QoYXVkaXRMb2dnZXIudGVzdFNob3VsZEF1ZGl0RW50aXR5KCdPcmRlcicpKS50b0JlKHRydWUpO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdnZXRDaGFuZ2VkUHJvcGVydGllcyBpbnRlZ3JhdGlvbicsICgpID0+IHtcbiAgICAgICAgaXQoJ3Nob3VsZCBpZ25vcmUgX2FjdG9yIGZpZWxkIGluIGNoYW5nZSBkZXRlY3Rpb24nLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBvbGRJbWFnZSA9IHtcbiAgICAgICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdUaXRsZScsXG4gICAgICAgICAgICAgICAgX2FjdG9yOiBjcmVhdGVNb2NrQWN0b3IoeyBhY3RvcklkOiAnb2xkLXVzZXInIH0pXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY29uc3QgbmV3SW1hZ2UgPSB7XG4gICAgICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgICAgIHRpdGxlOiAnVXBkYXRlZCBUaXRsZScsXG4gICAgICAgICAgICAgICAgX2FjdG9yOiBjcmVhdGVNb2NrQWN0b3IoeyBhY3RvcklkOiAnbmV3LXVzZXInIH0pXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCBjaGFuZ2VzID0gZ2V0Q2hhbmdlZFByb3BlcnRpZXMob2xkSW1hZ2UsIG5ld0ltYWdlKTtcblxuICAgICAgICAgICAgZXhwZWN0KGNoYW5nZXMpLnRvRXF1YWwoe1xuICAgICAgICAgICAgICAgIHRpdGxlOiB7IG9sZDogJ1RpdGxlJywgbmV3OiAnVXBkYXRlZCBUaXRsZScgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBleHBlY3QoY2hhbmdlcykubm90LnRvSGF2ZVByb3BlcnR5KCdfYWN0b3InKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCBkZXRlY3QgY2hhbmdlcyB3aGlsZSBpZ25vcmluZyBfYWN0b3InLCAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBvbGRJbWFnZSA9IHtcbiAgICAgICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdUaXRsZScsXG4gICAgICAgICAgICAgICAgY29udGVudDogJ0NvbnRlbnQnLFxuICAgICAgICAgICAgICAgIHVwZGF0ZWRCeTogJ3VzZXItMScsXG4gICAgICAgICAgICAgICAgX2FjdG9yOiBjcmVhdGVNb2NrQWN0b3IoeyBhY3RvcklkOiAndXNlci0xJyB9KVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNvbnN0IG5ld0ltYWdlID0ge1xuICAgICAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICAgICAgICAgIGNvbnRlbnQ6ICdVcGRhdGVkIENvbnRlbnQnLFxuICAgICAgICAgICAgICAgIHVwZGF0ZWRCeTogJ3VzZXItMicsXG4gICAgICAgICAgICAgICAgX2FjdG9yOiBjcmVhdGVNb2NrQWN0b3IoeyBhY3RvcklkOiAndXNlci0yJyB9KVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgY29uc3QgY2hhbmdlcyA9IGdldENoYW5nZWRQcm9wZXJ0aWVzKG9sZEltYWdlLCBuZXdJbWFnZSk7XG5cbiAgICAgICAgICAgIGV4cGVjdChjaGFuZ2VzLnRpdGxlKS50b0VxdWFsKHsgb2xkOiAnVGl0bGUnLCBuZXc6ICdVcGRhdGVkIFRpdGxlJyB9KTtcbiAgICAgICAgICAgIGV4cGVjdChjaGFuZ2VzLmNvbnRlbnQpLnRvRXF1YWwoeyBvbGQ6ICdDb250ZW50JywgbmV3OiAnVXBkYXRlZCBDb250ZW50JyB9KTtcbiAgICAgICAgICAgIGV4cGVjdChjaGFuZ2VzLnVwZGF0ZWRCeSkudG9FcXVhbCh7IG9sZDogJ3VzZXItMScsIG5ldzogJ3VzZXItMicgfSk7XG4gICAgICAgICAgICBleHBlY3QoY2hhbmdlcykubm90LnRvSGF2ZVByb3BlcnR5KCdfYWN0b3InKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaXQoJ3Nob3VsZCByZXR1cm4gZW1wdHkgd2hlbiBvbmx5IF9hY3RvciBmaWVsZCBjaGFuZ2VzJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgb2xkSW1hZ2UgPSB7XG4gICAgICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgICAgIHRpdGxlOiAnU2FtZSBUaXRsZScsXG4gICAgICAgICAgICAgICAgX2FjdG9yOiBjcmVhdGVNb2NrQWN0b3IoeyBhY3RvcklkOiAndXNlci0xJyB9KVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNvbnN0IG5ld0ltYWdlID0ge1xuICAgICAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgICAgICB0aXRsZTogJ1NhbWUgVGl0bGUnLFxuICAgICAgICAgICAgICAgIF9hY3RvcjogY3JlYXRlTW9ja0FjdG9yKHsgYWN0b3JJZDogJ3VzZXItMicgfSlcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGNvbnN0IGNoYW5nZXMgPSBnZXRDaGFuZ2VkUHJvcGVydGllcyhvbGRJbWFnZSwgbmV3SW1hZ2UpO1xuXG4gICAgICAgICAgICBleHBlY3QoT2JqZWN0LmtleXMoY2hhbmdlcykubGVuZ3RoKS50b0JlKDApO1xuICAgICAgICB9KTtcbiAgICB9KTtcbn0pO1xuXG4iXX0=