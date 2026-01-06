"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dynamo_db_stream_audit_logger_1 = require("./dynamo-db-stream-audit-logger");
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
    let auditLogger;
    beforeEach(() => {
        auditLogger = new dynamo_db_stream_audit_logger_1.DynamoDBStreamAuditLogger();
        jest.clearAllMocks();
    });
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
    // Helper function to create complete mock actor for comprehensive tests
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
            rawAuthContext: {
                sub: 'sub-789',
                'cognito:username': 'john.doe',
                email: 'john@example.com'
            },
            ...overrides
        };
    }
    // Helper function to create mock event record
    function createMockEventRecord(overrides = {}) {
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
            const auditEntry = auditLogger.makeAuditEntry(record);
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
            const auditEntry = auditLogger.makeAuditEntry(record);
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
            const auditEntry = auditLogger.makeAuditEntry(record);
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
            const auditEntry = auditLogger.makeAuditEntry(record);
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
                cognito: {
                    sub: 'sub-789',
                    username: 'john.doe',
                    groups: ['admin', 'manager', 'user'],
                    customAttributes: {
                        department: 'engineering',
                        role: 'senior-developer'
                    }
                },
                rawAuthContext: {
                    sub: 'sub-789',
                    'cognito:username': 'john.doe',
                    email: 'john@example.com',
                    'custom:department': 'engineering',
                    'custom:role': 'senior-developer'
                },
                sessionId: 'session-xyz-789',
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
            const auditEntry = auditLogger.makeAuditEntry(record);
            expect(auditEntry.actor).toEqual(complexActor);
            expect(auditEntry.actor.cognito?.groups).toContain('admin');
            expect(auditEntry.actor.rawAuthContext?.email).toBe('john@example.com');
            expect(auditEntry.actor.customField).toBe('custom-value');
        });
        it('should handle API key actor context', () => {
            const apiKeyActor = createMockActor({
                actorType: 'service',
                authMethod: 'api-key',
                actorId: 'api-key:abc123',
                email: undefined,
                apiKey: {
                    id: 'abc123',
                    source: 'request-context'
                },
                cognito: undefined,
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
            const auditEntry = auditLogger.makeAuditEntry(record);
            expect(auditEntry.actor).toEqual(apiKeyActor);
            expect(auditEntry.actor.authMethod).toBe('api-key');
            expect(auditEntry.actor.actorType).toBe('service');
            expect(auditEntry.actor.apiKey?.id).toBe('abc123');
        });
        it('should handle IAM actor context', () => {
            const iamActor = createMockActor({
                actorType: 'service',
                authMethod: 'iam',
                actorId: 'AIDAI23HZ27SI6FQMGNQ2',
                email: undefined,
                iam: {
                    userArn: 'arn:aws:iam::123456789012:user/service-user',
                    userId: 'AIDAI23HZ27SI6FQMGNQ2',
                    accountId: '123456789012',
                    caller: 'caller-id'
                },
                cognito: undefined,
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
            const auditEntry = auditLogger.makeAuditEntry(record);
            expect(auditEntry.actor).toEqual(iamActor);
            expect(auditEntry.actor.authMethod).toBe('iam');
            expect(auditEntry.actor.iam?.userArn).toBe('arn:aws:iam::123456789012:user/service-user');
        });
        it('should handle system/anonymous actor context', () => {
            const systemActor = createMockActor({
                actorType: 'anonymous',
                authMethod: 'anonymous',
                actorId: 'anonymous',
                email: undefined,
                cognito: undefined,
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
            const auditEntry = auditLogger.makeAuditEntry(record);
            expect(auditEntry.actor).toEqual(systemActor);
            expect(auditEntry.actor.authMethod).toBe('anonymous');
            expect(auditEntry.actor.actorType).toBe('anonymous');
            expect(auditEntry.actor.actorId).toBe('anonymous');
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
            const auditEntry = auditLogger.makeAuditEntry(record);
            expect(auditEntry.actor).toEqual({
                actorType: 'unknown'
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
            const auditEntry = auditLogger.makeAuditEntry(record);
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
            const auditEntry = auditLogger.makeAuditEntry(record);
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
            const changes = (0, dynamo_db_stream_audit_logger_1.getChangedProperties)(oldImage, newImage);
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
            const changes = (0, dynamo_db_stream_audit_logger_1.getChangedProperties)(oldImage, newImage);
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
            const changes = (0, dynamo_db_stream_audit_logger_1.getChangedProperties)(oldImage, newImage);
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
                        _actor: null
                    },
                    oldImage: {
                        postId: 'post-123',
                        title: 'Old Title',
                        _actor: undefined
                    }
                }
            });
            const auditEntry = auditLogger.makeAuditEntry(record);
            expect(auditEntry.actor).toEqual({
                actorType: 'unknown'
            });
        });
        it('should use invalid actor as-is when _actor field exists but is invalid', () => {
            const record = createMockEventRecord({
                payload: {
                    newImage: {
                        postId: 'post-123',
                        title: 'Title',
                        updatedBy: 'fallback-user-123',
                        tenantId: 'fallback-tenant',
                        _actor: 'invalid-actor-string' // Invalid actor type
                    },
                    oldImage: {
                        postId: 'post-123',
                        title: 'Old Title'
                    }
                }
            });
            const auditEntry = auditLogger.makeAuditEntry(record);
            // Should use invalid actor as-is since _actor field exists
            expect(auditEntry.actor).toBe('invalid-actor-string');
        });
        it('should handle empty/minimal actor objects', () => {
            const minimalActor = {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z'
                // Missing most fields
            };
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
            const auditEntry = auditLogger.makeAuditEntry(record);
            expect(auditEntry.actor).toEqual(minimalActor);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vLWRiLXN0cmVhbS1hdWRpdC1sb2dnZXItYWN0b3IudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9sb2dnZXJzL2R5bmFtby1kYi1zdHJlYW0tYXVkaXQtbG9nZ2VyLWFjdG9yLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxtRkFBa0c7QUFLbEcsbUNBQW1DO0FBQ25DLElBQUksQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUNsQyxrQkFBa0IsRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLFlBQVksQ0FBQztDQUNoRCxDQUFDLENBQUMsQ0FBQztBQUVKLElBQUksQ0FBQyxJQUFJLENBQUMsb0JBQW9CLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUNyQyxrQkFBa0IsRUFBRTtRQUNsQixXQUFXLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztZQUNsQixNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO2dCQUNyQixLQUFLLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTthQUNqQixDQUFDLENBQUM7U0FDSixDQUFDO0tBQ0g7Q0FDRixDQUFDLENBQUMsQ0FBQztBQUVKLFFBQVEsQ0FBQyw2Q0FBNkMsRUFBRSxHQUFHLEVBQUU7SUFDM0QsSUFBSSxXQUFzQyxDQUFDO0lBRTNDLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxXQUFXLEdBQUcsSUFBSSx5REFBeUIsRUFBRSxDQUFDO1FBQzlDLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUN2QixDQUFDLENBQUMsQ0FBQztJQUVILDhEQUE4RDtJQUM5RCxTQUFTLGtCQUFrQixDQUFDLFlBQTRCLEVBQUU7UUFDeEQsT0FBTztZQUNMLFNBQVMsRUFBRSxTQUFTO1lBQ3BCLFNBQVMsRUFBRSwwQkFBMEI7WUFDckMsT0FB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QyxJQUFJLENBQUMsc0JBQXNCLENBQUMsQ0FBQztRQUN4RCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQywyQ0FBMkMsRUFBRSxHQUFHLEVBQUU7WUFDbkQsTUFBTSxZQUFZLEdBQUc7Z0JBQ25CLFNBQVMsRUFBRSxTQUFTO2dCQUNwQixTQUFTLEVBQUUsMEJBQTBCO2dCQUNyQyxzQkFBc0I7YUFDZCxDQUFDO1lBRVgsTUFBTSxNQUFNLEdBQUcscUJBQXFCLENBQUM7Z0JBQ25DLE9BQU8sRUFBRTtvQkFDUCxRQUFRLEVBQUU7d0JBQ1IsTUFBTSxFQUFFLFVBQVU7d0JBQ2xCLEtBQUssRUFBRSxPQUFPO3dCQUNkLE1BQU0sRUFBRSxZQUFZO3FCQUNyQjtvQkFDRCxRQUFRLEVBQUU7d0JBQ1IsTUFBTSxFQUFFLFVBQVU7d0JBQ2xCLEtBQUssRUFBRSxXQUFXO3FCQUNuQjtpQkFDRjthQUNGLENBQUMsQ0FBQztZQUVILE1BQU0sVUFBVSxHQUFJLFdBQW1CLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBRS9ELE1BQU0sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ2pELENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXIsIGdldENoYW5nZWRQcm9wZXJ0aWVzIH0gZnJvbSAnLi9keW5hbW8tZGItc3RyZWFtLWF1ZGl0LWxvZ2dlcic7XG5pbXBvcnQgeyBCYXNlRXZlbnRSZWNvcmQsIENoYW5nZVN0cmVhbVBheWxvYWQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V2ZW50LXByb2Nlc3Nvci10eXBlcyc7XG5pbXBvcnQgeyBBdWRpdEVudHJ5IH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuXG4vLyBNb2NrIG9ubHkgZXNzZW50aWFsIGRlcGVuZGVuY2llc1xuamVzdC5tb2NrKCcuLi8uLi91dGlscy9lbnYnLCAoKSA9PiAoe1xuICByZXNvbHZlRW52VmFsdWVGb3I6IGplc3QuZm4oKCkgPT4gJ3Rlc3QtdmFsdWUnKVxufSkpO1xuXG5qZXN0Lm1vY2soJy4uL2xvZ2dlcnMvZmFjdG9yeScsICgpID0+ICh7XG4gIEF1ZGl0TG9nZ2VyRmFjdG9yeToge1xuICAgIGdldEluc3RhbmNlOiAoKSA9PiAoe1xuICAgICAgY3JlYXRlOiBqZXN0LmZuKCgpID0+ICh7XG4gICAgICAgIGF1ZGl0OiBqZXN0LmZuKClcbiAgICAgIH0pKVxuICAgIH0pXG4gIH1cbn0pKTtcblxuZGVzY3JpYmUoJ0R5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXIgQWN0b3IgRW5oYW5jZW1lbnQnLCAoKSA9PiB7XG4gIGxldCBhdWRpdExvZ2dlcjogRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlcjtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBhdWRpdExvZ2dlciA9IG5ldyBEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyKCk7XG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG4gIH0pO1xuXG4gIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjcmVhdGUgbWluaW1hbCBtb2NrIGFjdG9yIGZvciBtb3N0IHRlc3RzXG4gIGZ1bmN0aW9uIGNyZWF0ZU1pbmltYWxBY3RvcihvdmVycmlkZXM6IFBhcnRpYWw8QWN0b3I+ID0ge30pOiBBY3RvciB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgIGFjdG9ySWQ6ICd1c2VyLTQ1NicsXG4gICAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnLFxuICAgICAgLi4ub3ZlcnJpZGVzXG4gICAgfTtcbiAgfVxuXG4gIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjcmVhdGUgY29tcGxldGUgbW9jayBhY3RvciBmb3IgY29tcHJlaGVuc2l2ZSB0ZXN0c1xuICBmdW5jdGlvbiBjcmVhdGVNb2NrQWN0b3Iob3ZlcnJpZGVzOiBQYXJ0aWFsPEFjdG9yPiA9IHt9KTogQWN0b3Ige1xuICAgIHJldHVybiB7XG4gICAgICByZXF1ZXN0SWQ6ICdyZXEtMTIzJyxcbiAgICAgIHRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWicsXG4gICAgICBhY3RvcklkOiAndXNlci00NTYnLFxuICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJyxcbiAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wJyxcbiAgICAgIHRlbmFudElkOiAndGVuYW50LWFiYycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnY29yci14eXonLFxuICAgICAgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJyxcbiAgICAgIGNvZ25pdG86IHtcbiAgICAgICAgc3ViOiAnc3ViLTc4OScsXG4gICAgICAgIHVzZXJuYW1lOiAnam9obi5kb2UnLFxuICAgICAgICBncm91cHM6IFsnYWRtaW4nLCAndXNlciddXG4gICAgICB9LFxuICAgICAgcmF3QXV0aENvbnRleHQ6IHtcbiAgICAgICAgc3ViOiAnc3ViLTc4OScsXG4gICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2pvaG4uZG9lJyxcbiAgICAgICAgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJ1xuICAgICAgfSxcbiAgICAgIC4uLm92ZXJyaWRlc1xuICAgIH07XG4gIH1cblxuICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIG1vY2sgZXZlbnQgcmVjb3JkXG4gIGZ1bmN0aW9uIGNyZWF0ZU1vY2tFdmVudFJlY29yZChcbiAgICBvdmVycmlkZXM6IFBhcnRpYWw8QmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+PiA9IHt9XG4gICk6IEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVudGl0eU5hbWU6ICdQb3N0JyxcbiAgICAgIGV2ZW50VHlwZTogJ3VwZGF0ZScsXG4gICAgICB0aW1lc3RhbXA6IDE3MDUzMTQ2MDAwMDAsIC8vIDIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWiBpbiBtaWxsaXNlY29uZHNcbiAgICAgIGVudGl0eUlkOiAncG9zdC0xMjMnLFxuICAgICAgcGF5bG9hZDoge1xuICAgICAgICBuZXdJbWFnZToge1xuICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICAgIGNvbnRlbnQ6ICdVcGRhdGVkIENvbnRlbnQnXG4gICAgICAgIH0sXG4gICAgICAgIG9sZEltYWdlOiB7XG4gICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgIHRpdGxlOiAnT3JpZ2luYWwgVGl0bGUnLFxuICAgICAgICAgIGNvbnRlbnQ6ICdPcmlnaW5hbCBDb250ZW50J1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgLi4ub3ZlcnJpZGVzXG4gICAgfTtcbiAgfVxuXG4gIGRlc2NyaWJlKCdtYWtlQWRpdEVudHJ5IHdpdGggQWN0b3IgQ29udGV4dCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGV4dHJhY3QgYWN0b3IgY29udGV4dCBmcm9tIG5ld0ltYWdlLl9hY3RvciBmaWVsZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IG1vY2tBY3RvciA9IGNyZWF0ZU1pbmltYWxBY3RvcigpO1xuICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIG5ld0ltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICAgICAgY29udGVudDogJ1VwZGF0ZWQgQ29udGVudCcsXG4gICAgICAgICAgICB1cGRhdGVkQnk6ICd1c2VyLTQ1NicsXG4gICAgICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnLFxuICAgICAgICAgICAgX2FjdG9yOiBtb2NrQWN0b3JcbiAgICAgICAgICB9LFxuICAgICAgICAgIG9sZEltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ09yaWdpbmFsIFRpdGxlJyxcbiAgICAgICAgICAgIGNvbnRlbnQ6ICdPcmlnaW5hbCBDb250ZW50JyxcbiAgICAgICAgICAgIGNyZWF0ZWRCeTogJ3VzZXItMTIzJyxcbiAgICAgICAgICAgIHVwZGF0ZWRCeTogJ3VzZXItb3JpZ2luYWwnLFxuICAgICAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtb3JpZ2luYWwnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBdWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5KS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ1Bvc3QnLFxuICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICBpZGVudGlmaWVyczoge1xuICAgICAgICAgIGlkOiAncG9zdC0xMjMnXG4gICAgICAgIH0sXG4gICAgICAgIGFjdG9yOiBtb2NrQWN0b3JcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5kYXRhKS50b0VxdWFsKHtcbiAgICAgICAgdGl0bGU6IHsgb2xkOiAnT3JpZ2luYWwgVGl0bGUnLCBuZXc6ICdVcGRhdGVkIFRpdGxlJyB9LFxuICAgICAgICBjb250ZW50OiB7IG9sZDogJ09yaWdpbmFsIENvbnRlbnQnLCBuZXc6ICdVcGRhdGVkIENvbnRlbnQnIH0sXG4gICAgICAgIGNyZWF0ZWRCeTogeyBvbGQ6ICd1c2VyLTEyMycgfSwgLy8gRmllbGQgcmVtb3ZlZCBmcm9tIG5ld0ltYWdlXG4gICAgICAgIHVwZGF0ZWRCeTogeyBvbGQ6ICd1c2VyLW9yaWdpbmFsJywgbmV3OiAndXNlci00NTYnIH0sXG4gICAgICAgIHRlbmFudElkOiB7IG9sZDogJ3RlbmFudC1vcmlnaW5hbCcsIG5ldzogJ3RlbmFudC1hYmMnIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBleHRyYWN0IGFjdG9yIGNvbnRleHQgZnJvbSBvbGRJbWFnZS5fYWN0b3IgZmllbGQgd2hlbiBuZXdJbWFnZSBoYXMgbm8gYWN0b3InLCAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3IoKTtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGNyZWF0ZU1vY2tFdmVudFJlY29yZCh7XG4gICAgICAgIGV2ZW50VHlwZTogJ2RlbGV0ZScsXG4gICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICBuZXdJbWFnZTogdW5kZWZpbmVkLFxuICAgICAgICAgIG9sZEltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ0RlbGV0ZWQgVGl0bGUnLFxuICAgICAgICAgICAgY29udGVudDogJ0RlbGV0ZWQgQ29udGVudCcsXG4gICAgICAgICAgICBjcmVhdGVkQnk6ICd1c2VyLTQ1NicsXG4gICAgICAgICAgICBfYWN0b3I6IG1vY2tBY3RvclxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSAoYXVkaXRMb2dnZXIgYXMgYW55KS5tYWtlQXVkaXRFbnRyeShyZWNvcmQpO1xuXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeSkudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIGVudGl0eU5hbWU6ICdQb3N0JyxcbiAgICAgICAgZXZlbnRUeXBlOiAnZGVsZXRlJyxcbiAgICAgICAgYWN0b3I6IG1vY2tBY3RvclxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGZhbGxiYWNrIHRvIHZpc2libGUgYWN0b3IgZmllbGRzIHdoZW4gX2FjdG9yIGZpZWxkIGlzIG5vdCBhdmFpbGFibGUnLCAoKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnVXBkYXRlZCBUaXRsZScsXG4gICAgICAgICAgICB1cGRhdGVkQnk6ICd1c2VyLXZpc2libGUtNDU2JyxcbiAgICAgICAgICAgIHRlbmFudElkOiAndGVuYW50LXZpc2libGUtYWJjJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnT3JpZ2luYWwgVGl0bGUnLFxuICAgICAgICAgICAgY3JlYXRlZEJ5OiAndXNlci1vcmlnaW5hbC0xMjMnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBdWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yKS50b0VxdWFsKHtcbiAgICAgICAgYWN0b3JJZDogJ3VzZXItdmlzaWJsZS00NTYnLFxuICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC12aXNpYmxlLWFiYydcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwcmlvcml0aXplIHVwZGF0ZWRCeSBvdmVyIGNyZWF0ZWRCeSB3aGVuIGJvdGggYXJlIHByZXNlbnQgaW4gZmFsbGJhY2snLCAoKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBldmVudFR5cGU6ICdjcmVhdGUnLFxuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnTmV3IFRpdGxlJyxcbiAgICAgICAgICAgIGNyZWF0ZWRCeTogJ3VzZXItY3JlYXRvci0xMjMnLFxuICAgICAgICAgICAgdXBkYXRlZEJ5OiAndXNlci11cGRhdGVyLTQ1NicsXG4gICAgICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbGRJbWFnZTogdW5kZWZpbmVkXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhdWRpdEVudHJ5ID0gKGF1ZGl0TG9nZ2VyIGFzIGFueSkubWFrZUF1ZGl0RW50cnkocmVjb3JkKTtcblxuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IpLnRvRXF1YWwoe1xuICAgICAgICBhY3RvcklkOiAndXNlci11cGRhdGVyLTQ1NicsXG4gICAgICAgIHRlbmFudElkOiAndGVuYW50LWFiYydcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29tcGxleCBhY3RvciBjb250ZXh0IHdpdGggYWxsIGZpZWxkcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbXBsZXhBY3RvciA9IGNyZWF0ZU1vY2tBY3Rvcih7XG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIHNvdXJjZUlwOiAnMjAzLjAuMTEzLjEnLFxuICAgICAgICB1c2VyQWdlbnQ6ICdNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYnLFxuICAgICAgICBjb2duaXRvOiB7XG4gICAgICAgICAgc3ViOiAnc3ViLTc4OScsXG4gICAgICAgICAgdXNlcm5hbWU6ICdqb2huLmRvZScsXG4gICAgICAgICAgZ3JvdXBzOiBbJ2FkbWluJywgJ21hbmFnZXInLCAndXNlciddLFxuICAgICAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgIGRlcGFydG1lbnQ6ICdlbmdpbmVlcmluZycsXG4gICAgICAgICAgICByb2xlOiAnc2VuaW9yLWRldmVsb3BlcidcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHJhd0F1dGhDb250ZXh0OiB7XG4gICAgICAgICAgc3ViOiAnc3ViLTc4OScsXG4gICAgICAgICAgJ2NvZ25pdG86dXNlcm5hbWUnOiAnam9obi5kb2UnLFxuICAgICAgICAgIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbScsXG4gICAgICAgICAgJ2N1c3RvbTpkZXBhcnRtZW50JzogJ2VuZ2luZWVyaW5nJyxcbiAgICAgICAgICAnY3VzdG9tOnJvbGUnOiAnc2VuaW9yLWRldmVsb3BlcidcbiAgICAgICAgfSxcbiAgICAgICAgc2Vzc2lvbklkOiAnc2Vzc2lvbi14eXotNzg5JyxcbiAgICAgICAgY3VzdG9tRmllbGQ6ICdjdXN0b20tdmFsdWUnXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIG5ld0ltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICAgICAgX2FjdG9yOiBjb21wbGV4QWN0b3JcbiAgICAgICAgICB9LFxuICAgICAgICAgIG9sZEltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ09yaWdpbmFsIFRpdGxlJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSAoYXVkaXRMb2dnZXIgYXMgYW55KS5tYWtlQXVkaXRFbnRyeShyZWNvcmQpO1xuXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3RvcikudG9FcXVhbChjb21wbGV4QWN0b3IpO1xuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IuY29nbml0bz8uZ3JvdXBzKS50b0NvbnRhaW4oJ2FkbWluJyk7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5yYXdBdXRoQ29udGV4dD8uZW1haWwpLnRvQmUoJ2pvaG5AZXhhbXBsZS5jb20nKTtcbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yLmN1c3RvbUZpZWxkKS50b0JlKCdjdXN0b20tdmFsdWUnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIEFQSSBrZXkgYWN0b3IgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUtleUFjdG9yID0gY3JlYXRlTW9ja0FjdG9yKHtcbiAgICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhcGkta2V5JyxcbiAgICAgICAgYWN0b3JJZDogJ2FwaS1rZXk6YWJjMTIzJyxcbiAgICAgICAgZW1haWw6IHVuZGVmaW5lZCxcbiAgICAgICAgYXBpS2V5OiB7XG4gICAgICAgICAgaWQ6ICdhYmMxMjMnLFxuICAgICAgICAgIHNvdXJjZTogJ3JlcXVlc3QtY29udGV4dCdcbiAgICAgICAgfSxcbiAgICAgICAgY29nbml0bzogdW5kZWZpbmVkLFxuICAgICAgICByYXdBdXRoQ29udGV4dDogdW5kZWZpbmVkXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIG5ld0ltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ0FQSSBDcmVhdGVkIFRpdGxlJyxcbiAgICAgICAgICAgIF9hY3RvcjogYXBpS2V5QWN0b3JcbiAgICAgICAgICB9LFxuICAgICAgICAgIG9sZEltYWdlOiB1bmRlZmluZWRcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSAoYXVkaXRMb2dnZXIgYXMgYW55KS5tYWtlQXVkaXRFbnRyeShyZWNvcmQpO1xuXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3RvcikudG9FcXVhbChhcGlLZXlBY3Rvcik7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5hdXRoTWV0aG9kKS50b0JlKCdhcGkta2V5Jyk7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5hY3RvclR5cGUpLnRvQmUoJ3NlcnZpY2UnKTtcbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yLmFwaUtleT8uaWQpLnRvQmUoJ2FiYzEyMycpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgSUFNIGFjdG9yIGNvbnRleHQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBpYW1BY3RvciA9IGNyZWF0ZU1vY2tBY3Rvcih7XG4gICAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICBhdXRoTWV0aG9kOiAnaWFtJyxcbiAgICAgICAgYWN0b3JJZDogJ0FJREFJMjNIWjI3U0k2RlFNR05RMicsXG4gICAgICAgIGVtYWlsOiB1bmRlZmluZWQsXG4gICAgICAgIGlhbToge1xuICAgICAgICAgIHVzZXJBcm46ICdhcm46YXdzOmlhbTo6MTIzNDU2Nzg5MDEyOnVzZXIvc2VydmljZS11c2VyJyxcbiAgICAgICAgICB1c2VySWQ6ICdBSURBSTIzSFoyN1NJNkZRTUdOUTInLFxuICAgICAgICAgIGFjY291bnRJZDogJzEyMzQ1Njc4OTAxMicsXG4gICAgICAgICAgY2FsbGVyOiAnY2FsbGVyLWlkJ1xuICAgICAgICB9LFxuICAgICAgICBjb2duaXRvOiB1bmRlZmluZWQsXG4gICAgICAgIHJhd0F1dGhDb250ZXh0OiB1bmRlZmluZWRcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnSUFNIFVwZGF0ZWQgVGl0bGUnLFxuICAgICAgICAgICAgX2FjdG9yOiBpYW1BY3RvclxuICAgICAgICAgIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnT3JpZ2luYWwgVGl0bGUnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBdWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yKS50b0VxdWFsKGlhbUFjdG9yKTtcbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yLmF1dGhNZXRob2QpLnRvQmUoJ2lhbScpO1xuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IuaWFtPy51c2VyQXJuKS50b0JlKCdhcm46YXdzOmlhbTo6MTIzNDU2Nzg5MDEyOnVzZXIvc2VydmljZS11c2VyJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBzeXN0ZW0vYW5vbnltb3VzIGFjdG9yIGNvbnRleHQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzeXN0ZW1BY3RvciA9IGNyZWF0ZU1vY2tBY3Rvcih7XG4gICAgICAgIGFjdG9yVHlwZTogJ2Fub255bW91cycsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvcklkOiAnYW5vbnltb3VzJyxcbiAgICAgICAgZW1haWw6IHVuZGVmaW5lZCxcbiAgICAgICAgY29nbml0bzogdW5kZWZpbmVkLFxuICAgICAgICB0ZW5hbnRJZDogdW5kZWZpbmVkLFxuICAgICAgICByYXdBdXRoQ29udGV4dDogdW5kZWZpbmVkXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIG5ld0ltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ1N5c3RlbSBHZW5lcmF0ZWQgVGl0bGUnLFxuICAgICAgICAgICAgX2FjdG9yOiBzeXN0ZW1BY3RvclxuICAgICAgICAgIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBdWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yKS50b0VxdWFsKHN5c3RlbUFjdG9yKTtcbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yLmF1dGhNZXRob2QpLnRvQmUoJ2Fub255bW91cycpO1xuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IuYWN0b3JUeXBlKS50b0JlKCdhbm9ueW1vdXMnKTtcbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yLmFjdG9ySWQpLnRvQmUoJ2Fub255bW91cycpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWlzc2luZyBhY3RvciBjb250ZXh0IGdyYWNlZnVsbHknLCAoKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnTm8gQWN0b3IgVGl0bGUnXG4gICAgICAgICAgICAvLyBObyBfYWN0b3IgZmllbGQsIG5vIHZpc2libGUgYWN0b3IgZmllbGRzXG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbGRJbWFnZToge1xuICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgdGl0bGU6ICdPcmlnaW5hbCBUaXRsZSdcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhdWRpdEVudHJ5ID0gKGF1ZGl0TG9nZ2VyIGFzIGFueSkubWFrZUF1ZGl0RW50cnkocmVjb3JkKTtcblxuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IpLnRvRXF1YWwoe1xuICAgICAgICBhY3RvclR5cGU6ICd1bmtub3duJ1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHNraXAgYXVkaXQgZW50cnkgd2hlbiBubyBjaGFuZ2VzIGRldGVjdGVkJywgKCkgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIG5ld0ltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ1NhbWUgVGl0bGUnLFxuICAgICAgICAgICAgY29udGVudDogJ1NhbWUgQ29udGVudCcsXG4gICAgICAgICAgICBfYWN0b3I6IGNyZWF0ZU1vY2tBY3RvcigpXG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbGRJbWFnZToge1xuICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgdGl0bGU6ICdTYW1lIFRpdGxlJyxcbiAgICAgICAgICAgIGNvbnRlbnQ6ICdTYW1lIENvbnRlbnQnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBdWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGluY2x1ZGUgcmVxdWVzdCBjb3JyZWxhdGlvbiBkYXRhIGluIGF1ZGl0IGVudHJ5JywgKCkgPT4ge1xuICAgICAgY29uc3QgYWN0b3JXaXRoQ29ycmVsYXRpb24gPSBjcmVhdGVNb2NrQWN0b3Ioe1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtdW5pcXVlLTEyMycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLXRyYWNlLTQ1NicsXG4gICAgICAgIHNlc3Npb25JZDogJ3Nlc3Npb24tNzg5J1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlY29yZCA9IGNyZWF0ZU1vY2tFdmVudFJlY29yZCh7XG4gICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICBuZXdJbWFnZToge1xuICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgdGl0bGU6ICdVcGRhdGVkIFRpdGxlJyxcbiAgICAgICAgICAgIF9hY3RvcjogYWN0b3JXaXRoQ29ycmVsYXRpb25cbiAgICAgICAgICB9LFxuICAgICAgICAgIG9sZEltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ09yaWdpbmFsIFRpdGxlJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSAoYXVkaXRMb2dnZXIgYXMgYW55KS5tYWtlQXVkaXRFbnRyeShyZWNvcmQpO1xuXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5yZXF1ZXN0SWQpLnRvQmUoJ3JlcS11bmlxdWUtMTIzJyk7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5jb3JyZWxhdGlvbklkKS50b0JlKCdjb3JyLXRyYWNlLTQ1NicpO1xuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3Iuc2Vzc2lvbklkKS50b0JlKCdzZXNzaW9uLTc4OScpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZ2V0Q2hhbmdlZFByb3BlcnRpZXMgaWdub3JlcyBfYWN0b3IgZmllbGQnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBpZ25vcmUgX2FjdG9yIGZpZWxkIGluIGNoYW5nZSBkZXRlY3Rpb24nLCAoKSA9PiB7XG4gICAgICBjb25zdCBvbGRJbWFnZSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICB0aXRsZTogJ1RpdGxlJyxcbiAgICAgICAgX2FjdG9yOiBjcmVhdGVNb2NrQWN0b3IoeyBhY3RvcklkOiAnb2xkLXVzZXInIH0pXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBuZXdJbWFnZSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICBfYWN0b3I6IGNyZWF0ZU1vY2tBY3Rvcih7IGFjdG9ySWQ6ICduZXctdXNlcicgfSlcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNoYW5nZXMgPSBnZXRDaGFuZ2VkUHJvcGVydGllcyhvbGRJbWFnZSwgbmV3SW1hZ2UpO1xuXG4gICAgICBleHBlY3QoY2hhbmdlcykudG9FcXVhbCh7XG4gICAgICAgIHRpdGxlOiB7IG9sZDogJ1RpdGxlJywgbmV3OiAnVXBkYXRlZCBUaXRsZScgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY2hhbmdlcykubm90LnRvSGF2ZVByb3BlcnR5KCdfYWN0b3InKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZGV0ZWN0IG90aGVyIGNoYW5nZXMgd2hpbGUgaWdub3JpbmcgX2FjdG9yJywgKCkgPT4ge1xuICAgICAgY29uc3Qgb2xkSW1hZ2UgPSB7XG4gICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgdGl0bGU6ICdUaXRsZScsXG4gICAgICAgIGNvbnRlbnQ6ICdDb250ZW50JyxcbiAgICAgICAgdXBkYXRlZEJ5OiAndXNlci0xJyxcbiAgICAgICAgX2FjdG9yOiBjcmVhdGVNb2NrQWN0b3IoeyBhY3RvcklkOiAndXNlci0xJyB9KVxuICAgICAgfTtcblxuICAgICAgY29uc3QgbmV3SW1hZ2UgPSB7XG4gICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgdGl0bGU6ICdVcGRhdGVkIFRpdGxlJyxcbiAgICAgICAgY29udGVudDogJ1VwZGF0ZWQgQ29udGVudCcsXG4gICAgICAgIHVwZGF0ZWRCeTogJ3VzZXItMicsXG4gICAgICAgIF9hY3RvcjogY3JlYXRlTW9ja0FjdG9yKHsgYWN0b3JJZDogJ3VzZXItMicgfSlcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNoYW5nZXMgPSBnZXRDaGFuZ2VkUHJvcGVydGllcyhvbGRJbWFnZSwgbmV3SW1hZ2UpO1xuXG4gICAgICBleHBlY3QoY2hhbmdlcykudG9FcXVhbCh7XG4gICAgICAgIHRpdGxlOiB7IG9sZDogJ1RpdGxlJywgbmV3OiAnVXBkYXRlZCBUaXRsZScgfSxcbiAgICAgICAgY29udGVudDogeyBvbGQ6ICdDb250ZW50JywgbmV3OiAnVXBkYXRlZCBDb250ZW50JyB9LFxuICAgICAgICB1cGRhdGVkQnk6IHsgb2xkOiAndXNlci0xJywgbmV3OiAndXNlci0yJyB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjaGFuZ2VzKS5ub3QudG9IYXZlUHJvcGVydHkoJ19hY3RvcicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBzdGlsbCBkZXRlY3QgY2hhbmdlcyB3aGVuIG9ubHkgX2FjdG9yIGZpZWxkIGNoYW5nZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBvbGRJbWFnZSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICB0aXRsZTogJ1NhbWUgVGl0bGUnLFxuICAgICAgICBfYWN0b3I6IGNyZWF0ZU1vY2tBY3Rvcih7IGFjdG9ySWQ6ICd1c2VyLTEnIH0pXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBuZXdJbWFnZSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICB0aXRsZTogJ1NhbWUgVGl0bGUnLFxuICAgICAgICBfYWN0b3I6IGNyZWF0ZU1vY2tBY3Rvcih7IGFjdG9ySWQ6ICd1c2VyLTInIH0pXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjaGFuZ2VzID0gZ2V0Q2hhbmdlZFByb3BlcnRpZXMob2xkSW1hZ2UsIG5ld0ltYWdlKTtcblxuICAgICAgZXhwZWN0KGNoYW5nZXMpLnRvRXF1YWwoe30pO1xuICAgICAgZXhwZWN0KE9iamVjdC5rZXlzKGNoYW5nZXMpLmxlbmd0aCkudG9CZSgwKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0VkZ2UgY2FzZXMgYW5kIGVycm9yIGhhbmRsaW5nJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaGFuZGxlIG51bGwvdW5kZWZpbmVkIGFjdG9yIGdyYWNlZnVsbHknLCAoKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnVGl0bGUnLFxuICAgICAgICAgICAgX2FjdG9yOiBudWxsIGFzIGFueVxuICAgICAgICAgIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnT2xkIFRpdGxlJyxcbiAgICAgICAgICAgIF9hY3RvcjogdW5kZWZpbmVkXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBdWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yKS50b0VxdWFsKHtcbiAgICAgICAgYWN0b3JUeXBlOiAndW5rbm93bidcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB1c2UgaW52YWxpZCBhY3RvciBhcy1pcyB3aGVuIF9hY3RvciBmaWVsZCBleGlzdHMgYnV0IGlzIGludmFsaWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnVGl0bGUnLFxuICAgICAgICAgICAgdXBkYXRlZEJ5OiAnZmFsbGJhY2stdXNlci0xMjMnLFxuICAgICAgICAgICAgdGVuYW50SWQ6ICdmYWxsYmFjay10ZW5hbnQnLFxuICAgICAgICAgICAgX2FjdG9yOiAnaW52YWxpZC1hY3Rvci1zdHJpbmcnIGFzIGFueSAvLyBJbnZhbGlkIGFjdG9yIHR5cGVcbiAgICAgICAgICB9LFxuICAgICAgICAgIG9sZEltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ09sZCBUaXRsZSdcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhdWRpdEVudHJ5ID0gKGF1ZGl0TG9nZ2VyIGFzIGFueSkubWFrZUF1ZGl0RW50cnkocmVjb3JkKTtcblxuICAgICAgLy8gU2hvdWxkIHVzZSBpbnZhbGlkIGFjdG9yIGFzLWlzIHNpbmNlIF9hY3RvciBmaWVsZCBleGlzdHNcbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yKS50b0JlKCdpbnZhbGlkLWFjdG9yLXN0cmluZycpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZW1wdHkvbWluaW1hbCBhY3RvciBvYmplY3RzJywgKCkgPT4ge1xuICAgICAgY29uc3QgbWluaW1hbEFjdG9yID0ge1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtMTIzJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJ1xuICAgICAgICAvLyBNaXNzaW5nIG1vc3QgZmllbGRzXG4gICAgICB9IGFzIEFjdG9yO1xuXG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnVGl0bGUnLFxuICAgICAgICAgICAgX2FjdG9yOiBtaW5pbWFsQWN0b3JcbiAgICAgICAgICB9LFxuICAgICAgICAgIG9sZEltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ09sZCBUaXRsZSdcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhdWRpdEVudHJ5ID0gKGF1ZGl0TG9nZ2VyIGFzIGFueSkubWFrZUF1ZGl0RW50cnkocmVjb3JkKTtcblxuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IpLnRvRXF1YWwobWluaW1hbEFjdG9yKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==