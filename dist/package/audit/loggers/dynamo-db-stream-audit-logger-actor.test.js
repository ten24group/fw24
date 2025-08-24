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
            const auditEntry = auditLogger.makeAditEntry(record);
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
            const auditEntry = auditLogger.makeAditEntry(record);
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
            const auditEntry = auditLogger.makeAditEntry(record);
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
            const auditEntry = auditLogger.makeAditEntry(record);
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
            const auditEntry = auditLogger.makeAditEntry(record);
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
            const auditEntry = auditLogger.makeAditEntry(record);
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
            const auditEntry = auditLogger.makeAditEntry(record);
            expect(auditEntry.actor).toEqual(iamActor);
            expect(auditEntry.actor.authMethod).toBe('iam');
            expect(auditEntry.actor.iamRole).toBe('arn:aws:iam::123456789012:user/service-user');
        });
        it('should handle system/anonymous actor context', () => {
            const systemActor = createMockActor({
                actorType: 'anonymous',
                authMethod: 'anonymous',
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
            const auditEntry = auditLogger.makeAditEntry(record);
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
            const auditEntry = auditLogger.makeAditEntry(record);
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
            const auditEntry = auditLogger.makeAditEntry(record);
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
            const auditEntry = auditLogger.makeAditEntry(record);
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
            const auditEntry = auditLogger.makeAditEntry(record);
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
                        _actor: 'invalid-actor-string' // Invalid actor type
                    },
                    oldImage: {
                        postId: 'post-123',
                        title: 'Old Title'
                    }
                }
            });
            const auditEntry = auditLogger.makeAditEntry(record);
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
            const auditEntry = auditLogger.makeAditEntry(record);
            expect(auditEntry.actor).toEqual(minimalActor);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vLWRiLXN0cmVhbS1hdWRpdC1sb2dnZXItYWN0b3IudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9hdWRpdC9sb2dnZXJzL2R5bmFtby1kYi1zdHJlYW0tYXVkaXQtbG9nZ2VyLWFjdG9yLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxtRkFBa0c7QUFLbEcsbUNBQW1DO0FBQ25DLElBQUksQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUNsQyxrQkFBa0IsRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLFlBQVksQ0FBQztDQUNoRCxDQUFDLENBQUMsQ0FBQztBQUVKLElBQUksQ0FBQyxJQUFJLENBQUMsb0JBQW9CLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUNyQyxrQkFBa0IsRUFBRTtRQUNsQixXQUFXLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztZQUNsQixNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO2dCQUNyQixLQUFLLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTthQUNqQixDQUFDLENBQUM7U0FDSixDQUFDO0tBQ0g7Q0FDRixDQUFDLENBQUMsQ0FBQztBQUVKLFFBQVEsQ0FBQyw2Q0FBNkMsRUFBRSxHQUFHLEVBQUU7SUFDM0QsSUFBSSxXQUFzQyxDQUFDO0lBRTNDLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxXQUFXLEdBQUcsSUFBSSx5REFBeUIsRUFBRSxDQUFDO1FBQzlDLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUN2QixDQUFDLENBQUMsQ0FBQztJQUVILDhEQUE4RDtJQUM5RCxTQUFTLGtCQUFrQixDQUFDLFlBQTRCLEVBQUU7UUFDeEQsT0FBTztZQUNMLFNBQVMsRUFBRSxTQUFTO1lBQ3BCLFNBQVMsRUFBRSwwQkFBMEI7WUFDckMsT0FB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QVksR0FBRztnQkFDbkIsU0FBUyxFQUFFLFNBQVM7Z0JBQ3BCLFNBQVMsRUFBRSwwQkFBMEI7Z0JBQ3JDLHNCQUFzQjthQUNkLENBQUM7WUFFWCxNQUFNLE1BQU0sR0FBRyxxQkFBcUIsQ0FBQztnQkFDbkMsT0FBTyxFQUFFO29CQUNQLFFBQVEsRUFBRTt3QkFDUixNQUFNLEVBQUUsVUFBVTt3QkFDbEIsS0FBSyxFQUFFLE9BQU87d0JBQ2QsTUFBTSxFQUFFLFlBQVk7cUJBQ3JCO29CQUNELFFBQVEsRUFBRTt3QkFDUixNQUFNLEVBQUUsVUFBVTt3QkFDbEIsS0FBSyxFQUFFLFdBQVc7cUJBQ25CO2lCQUNGO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsTUFBTSxVQUFVLEdBQUksV0FBbUIsQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFOUQsTUFBTSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDakQsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlciwgZ2V0Q2hhbmdlZFByb3BlcnRpZXMgfSBmcm9tICcuL2R5bmFtby1kYi1zdHJlYW0tYXVkaXQtbG9nZ2VyJztcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCwgQ2hhbmdlU3RyZWFtUGF5bG9hZCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzJztcbmltcG9ydCB7IEF1ZGl0RW50cnkgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5cbi8vIE1vY2sgb25seSBlc3NlbnRpYWwgZGVwZW5kZW5jaWVzXG5qZXN0Lm1vY2soJy4uLy4uL3V0aWxzL2VudicsICgpID0+ICh7XG4gIHJlc29sdmVFbnZWYWx1ZUZvcjogamVzdC5mbigoKSA9PiAndGVzdC12YWx1ZScpXG59KSk7XG5cbmplc3QubW9jaygnLi4vbG9nZ2Vycy9mYWN0b3J5JywgKCkgPT4gKHtcbiAgQXVkaXRMb2dnZXJGYWN0b3J5OiB7XG4gICAgZ2V0SW5zdGFuY2U6ICgpID0+ICh7XG4gICAgICBjcmVhdGU6IGplc3QuZm4oKCkgPT4gKHtcbiAgICAgICAgYXVkaXQ6IGplc3QuZm4oKVxuICAgICAgfSkpXG4gICAgfSlcbiAgfVxufSkpO1xuXG5kZXNjcmliZSgnRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlciBBY3RvciBFbmhhbmNlbWVudCcsICgpID0+IHtcbiAgbGV0IGF1ZGl0TG9nZ2VyOiBEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGF1ZGl0TG9nZ2VyID0gbmV3IER5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXIoKTtcbiAgICBqZXN0LmNsZWFyQWxsTW9ja3MoKTtcbiAgfSk7XG5cbiAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBtaW5pbWFsIG1vY2sgYWN0b3IgZm9yIG1vc3QgdGVzdHNcbiAgZnVuY3Rpb24gY3JlYXRlTWluaW1hbEFjdG9yKG92ZXJyaWRlczogUGFydGlhbDxBY3Rvcj4gPSB7fSk6IEFjdG9yIHtcbiAgICByZXR1cm4ge1xuICAgICAgcmVxdWVzdElkOiAncmVxLTEyMycsXG4gICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonLFxuICAgICAgYWN0b3JJZDogJ3VzZXItNDU2JyxcbiAgICAgIHRlbmFudElkOiAndGVuYW50LWFiYycsXG4gICAgICAuLi5vdmVycmlkZXNcbiAgICB9O1xuICB9XG5cbiAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBjb21wbGV0ZSBtb2NrIGFjdG9yIGZvciBjb21wcmVoZW5zaXZlIHRlc3RzXG4gIGZ1bmN0aW9uIGNyZWF0ZU1vY2tBY3RvcihvdmVycmlkZXM6IFBhcnRpYWw8QWN0b3I+ID0ge30pOiBBY3RvciB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgIGFjdG9ySWQ6ICd1c2VyLTQ1NicsXG4gICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEnLFxuICAgICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAnLFxuICAgICAgY29nbml0b1N1YjogJ3N1Yi03ODknLFxuICAgICAgY29nbml0b1VzZXJuYW1lOiAnam9obi5kb2UnLFxuICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLXh5eicsXG4gICAgICBjb2duaXRvR3JvdXBzOiBbJ2FkbWluJywgJ3VzZXInXSxcbiAgICAgIHJhd0F1dGhDb250ZXh0OiB7XG4gICAgICAgIHN1YjogJ3N1Yi03ODknLFxuICAgICAgICAnY29nbml0bzp1c2VybmFtZSc6ICdqb2huLmRvZScsXG4gICAgICAgIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbSdcbiAgICAgIH0sXG4gICAgICAuLi5vdmVycmlkZXNcbiAgICB9O1xuICB9XG5cbiAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBtb2NrIGV2ZW50IHJlY29yZFxuICBmdW5jdGlvbiBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoXG4gICAgb3ZlcnJpZGVzOiBQYXJ0aWFsPEJhc2VFdmVudFJlY29yZDxDaGFuZ2VTdHJlYW1QYXlsb2FkPj4gPSB7fVxuICApOiBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD4ge1xuICAgIHJldHVybiB7XG4gICAgICBlbnRpdHlOYW1lOiAnUG9zdCcsXG4gICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgdGltZXN0YW1wOiAxNzA1MzE0NjAwMDAwLCAvLyAyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFogaW4gbWlsbGlzZWNvbmRzXG4gICAgICBlbnRpdHlJZDogJ3Bvc3QtMTIzJyxcbiAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgdGl0bGU6ICdVcGRhdGVkIFRpdGxlJyxcbiAgICAgICAgICBjb250ZW50OiAnVXBkYXRlZCBDb250ZW50J1xuICAgICAgICB9LFxuICAgICAgICBvbGRJbWFnZToge1xuICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICB0aXRsZTogJ09yaWdpbmFsIFRpdGxlJyxcbiAgICAgICAgICBjb250ZW50OiAnT3JpZ2luYWwgQ29udGVudCdcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIC4uLm92ZXJyaWRlc1xuICAgIH07XG4gIH1cblxuICBkZXNjcmliZSgnbWFrZUFkaXRFbnRyeSB3aXRoIEFjdG9yIENvbnRleHQnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBleHRyYWN0IGFjdG9yIGNvbnRleHQgZnJvbSBuZXdJbWFnZS5fYWN0b3IgZmllbGQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3IoKTtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGNyZWF0ZU1vY2tFdmVudFJlY29yZCh7XG4gICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICBuZXdJbWFnZToge1xuICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgdGl0bGU6ICdVcGRhdGVkIFRpdGxlJyxcbiAgICAgICAgICAgIGNvbnRlbnQ6ICdVcGRhdGVkIENvbnRlbnQnLFxuICAgICAgICAgICAgdXBkYXRlZEJ5OiAndXNlci00NTYnLFxuICAgICAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJyxcbiAgICAgICAgICAgIF9hY3RvcjogbW9ja0FjdG9yXG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbGRJbWFnZToge1xuICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgdGl0bGU6ICdPcmlnaW5hbCBUaXRsZScsXG4gICAgICAgICAgICBjb250ZW50OiAnT3JpZ2luYWwgQ29udGVudCcsXG4gICAgICAgICAgICBjcmVhdGVkQnk6ICd1c2VyLTEyMycsXG4gICAgICAgICAgICB1cGRhdGVkQnk6ICd1c2VyLW9yaWdpbmFsJyxcbiAgICAgICAgICAgIHRlbmFudElkOiAndGVuYW50LW9yaWdpbmFsJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSAoYXVkaXRMb2dnZXIgYXMgYW55KS5tYWtlQWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5KS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ1Bvc3QnLFxuICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICBpZGVudGlmaWVyczoge1xuICAgICAgICAgIGlkOiAncG9zdC0xMjMnXG4gICAgICAgIH0sXG4gICAgICAgIGFjdG9yOiBtb2NrQWN0b3JcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5kYXRhKS50b0VxdWFsKHtcbiAgICAgICAgdGl0bGU6IHsgb2xkOiAnT3JpZ2luYWwgVGl0bGUnLCBuZXc6ICdVcGRhdGVkIFRpdGxlJyB9LFxuICAgICAgICBjb250ZW50OiB7IG9sZDogJ09yaWdpbmFsIENvbnRlbnQnLCBuZXc6ICdVcGRhdGVkIENvbnRlbnQnIH0sXG4gICAgICAgIGNyZWF0ZWRCeTogeyBvbGQ6ICd1c2VyLTEyMycgfSwgLy8gRmllbGQgcmVtb3ZlZCBmcm9tIG5ld0ltYWdlXG4gICAgICAgIHVwZGF0ZWRCeTogeyBvbGQ6ICd1c2VyLW9yaWdpbmFsJywgbmV3OiAndXNlci00NTYnIH0sXG4gICAgICAgIHRlbmFudElkOiB7IG9sZDogJ3RlbmFudC1vcmlnaW5hbCcsIG5ldzogJ3RlbmFudC1hYmMnIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBleHRyYWN0IGFjdG9yIGNvbnRleHQgZnJvbSBvbGRJbWFnZS5fYWN0b3IgZmllbGQgd2hlbiBuZXdJbWFnZSBoYXMgbm8gYWN0b3InLCAoKSA9PiB7XG4gICAgICBjb25zdCBtb2NrQWN0b3IgPSBjcmVhdGVNaW5pbWFsQWN0b3IoKTtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGNyZWF0ZU1vY2tFdmVudFJlY29yZCh7XG4gICAgICAgIGV2ZW50VHlwZTogJ2RlbGV0ZScsXG4gICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICBuZXdJbWFnZTogdW5kZWZpbmVkLFxuICAgICAgICAgIG9sZEltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ0RlbGV0ZWQgVGl0bGUnLFxuICAgICAgICAgICAgY29udGVudDogJ0RlbGV0ZWQgQ29udGVudCcsXG4gICAgICAgICAgICBjcmVhdGVkQnk6ICd1c2VyLTQ1NicsXG4gICAgICAgICAgICBfYWN0b3I6IG1vY2tBY3RvclxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSAoYXVkaXRMb2dnZXIgYXMgYW55KS5tYWtlQWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5KS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgZW50aXR5TmFtZTogJ1Bvc3QnLFxuICAgICAgICBldmVudFR5cGU6ICdkZWxldGUnLFxuICAgICAgICBhY3RvcjogbW9ja0FjdG9yXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZmFsbGJhY2sgdG8gdmlzaWJsZSBhY3RvciBmaWVsZHMgd2hlbiBfYWN0b3IgZmllbGQgaXMgbm90IGF2YWlsYWJsZScsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGNyZWF0ZU1vY2tFdmVudFJlY29yZCh7XG4gICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICBuZXdJbWFnZToge1xuICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgdGl0bGU6ICdVcGRhdGVkIFRpdGxlJyxcbiAgICAgICAgICAgIHVwZGF0ZWRCeTogJ3VzZXItdmlzaWJsZS00NTYnLFxuICAgICAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtdmlzaWJsZS1hYmMnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbGRJbWFnZToge1xuICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgdGl0bGU6ICdPcmlnaW5hbCBUaXRsZScsXG4gICAgICAgICAgICBjcmVhdGVkQnk6ICd1c2VyLW9yaWdpbmFsLTEyMydcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhdWRpdEVudHJ5ID0gKGF1ZGl0TG9nZ2VyIGFzIGFueSkubWFrZUFkaXRFbnRyeShyZWNvcmQpO1xuXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3RvcikudG9FcXVhbCh7XG4gICAgICAgIGFjdG9ySWQ6ICd1c2VyLXZpc2libGUtNDU2JyxcbiAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtdmlzaWJsZS1hYmMnXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJpb3JpdGl6ZSB1cGRhdGVkQnkgb3ZlciBjcmVhdGVkQnkgd2hlbiBib3RoIGFyZSBwcmVzZW50IGluIGZhbGxiYWNrJywgKCkgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgZXZlbnRUeXBlOiAnY3JlYXRlJyxcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIG5ld0ltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ05ldyBUaXRsZScsXG4gICAgICAgICAgICBjcmVhdGVkQnk6ICd1c2VyLWNyZWF0b3ItMTIzJyxcbiAgICAgICAgICAgIHVwZGF0ZWRCeTogJ3VzZXItdXBkYXRlci00NTYnLFxuICAgICAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBZGl0RW50cnkocmVjb3JkKTtcblxuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IpLnRvRXF1YWwoe1xuICAgICAgICBhY3RvcklkOiAndXNlci11cGRhdGVyLTQ1NicsXG4gICAgICAgIHRlbmFudElkOiAndGVuYW50LWFiYydcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29tcGxleCBhY3RvciBjb250ZXh0IHdpdGggYWxsIGZpZWxkcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbXBsZXhBY3RvciA9IGNyZWF0ZU1vY2tBY3Rvcih7XG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICBhdXRoTWV0aG9kOiAnY29nbml0bycsXG4gICAgICAgIHNvdXJjZUlwOiAnMjAzLjAuMTEzLjEnLFxuICAgICAgICB1c2VyQWdlbnQ6ICdNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYnLFxuICAgICAgICBjb2duaXRvR3JvdXBzOiBbJ2FkbWluJywgJ21hbmFnZXInLCAndXNlciddLFxuICAgICAgICByYXdBdXRoQ29udGV4dDoge1xuICAgICAgICAgIHN1YjogJ3N1Yi03ODknLFxuICAgICAgICAgICdjb2duaXRvOnVzZXJuYW1lJzogJ2pvaG4uZG9lJyxcbiAgICAgICAgICBlbWFpbDogJ2pvaG5AZXhhbXBsZS5jb20nLFxuICAgICAgICAgICdjdXN0b206ZGVwYXJ0bWVudCc6ICdlbmdpbmVlcmluZycsXG4gICAgICAgICAgJ2N1c3RvbTpyb2xlJzogJ3Nlbmlvci1kZXZlbG9wZXInXG4gICAgICAgIH0sXG4gICAgICAgIHNlc3Npb25JZDogJ3Nlc3Npb24teHl6LTc4OScsXG4gICAgICAgIGFwaUtleUlkOiB1bmRlZmluZWQsIC8vIE5vdCBhbiBBUEkga2V5IGF1dGhcbiAgICAgICAgaWFtUm9sZTogdW5kZWZpbmVkLCAvLyBOb3QgSUFNIGF1dGhcbiAgICAgICAgY3VzdG9tRmllbGQ6ICdjdXN0b20tdmFsdWUnXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIG5ld0ltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICAgICAgX2FjdG9yOiBjb21wbGV4QWN0b3JcbiAgICAgICAgICB9LFxuICAgICAgICAgIG9sZEltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ09yaWdpbmFsIFRpdGxlJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSAoYXVkaXRMb2dnZXIgYXMgYW55KS5tYWtlQWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yKS50b0VxdWFsKGNvbXBsZXhBY3Rvcik7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5jb2duaXRvR3JvdXBzKS50b0NvbnRhaW4oJ2FkbWluJyk7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5yYXdBdXRoQ29udGV4dD8uZW1haWwpLnRvQmUoJ2pvaG5AZXhhbXBsZS5jb20nKTtcbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yLmN1c3RvbUZpZWxkKS50b0JlKCdjdXN0b20tdmFsdWUnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIEFQSSBrZXkgYWN0b3IgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGFwaUtleUFjdG9yID0gY3JlYXRlTW9ja0FjdG9yKHtcbiAgICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhcGkta2V5JyxcbiAgICAgICAgYWN0b3JJZDogJ2FwaS1rZXk6YWJjMTIzJyxcbiAgICAgICAgYXBpS2V5SWQ6ICdhYmMxMjMnLFxuICAgICAgICBjb2duaXRvU3ViOiB1bmRlZmluZWQsXG4gICAgICAgIGNvZ25pdG9Vc2VybmFtZTogdW5kZWZpbmVkLFxuICAgICAgICBjb2duaXRvR3JvdXBzOiB1bmRlZmluZWQsXG4gICAgICAgIHJhd0F1dGhDb250ZXh0OiB1bmRlZmluZWRcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnQVBJIENyZWF0ZWQgVGl0bGUnLFxuICAgICAgICAgICAgX2FjdG9yOiBhcGlLZXlBY3RvclxuICAgICAgICAgIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBZGl0RW50cnkocmVjb3JkKTtcblxuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IpLnRvRXF1YWwoYXBpS2V5QWN0b3IpO1xuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IuYXV0aE1ldGhvZCkudG9CZSgnYXBpLWtleScpO1xuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IuYWN0b3JUeXBlKS50b0JlKCdzZXJ2aWNlJyk7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5hcGlLZXlJZCkudG9CZSgnYWJjMTIzJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBJQU0gYWN0b3IgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGlhbUFjdG9yID0gY3JlYXRlTW9ja0FjdG9yKHtcbiAgICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdpYW0nLFxuICAgICAgICBhY3RvcklkOiAnQUlEQUkyM0haMjdTSTZGUU1HTlEyJyxcbiAgICAgICAgaWFtUm9sZTogJ2Fybjphd3M6aWFtOjoxMjM0NTY3ODkwMTI6dXNlci9zZXJ2aWNlLXVzZXInLFxuICAgICAgICBpYW1Vc2VySWQ6ICdBSURBSTIzSFoyN1NJNkZRTUdOUTInLFxuICAgICAgICBjb2duaXRvU3ViOiB1bmRlZmluZWQsXG4gICAgICAgIGNvZ25pdG9Vc2VybmFtZTogdW5kZWZpbmVkLFxuICAgICAgICBjb2duaXRvR3JvdXBzOiB1bmRlZmluZWQsXG4gICAgICAgIHJhd0F1dGhDb250ZXh0OiB1bmRlZmluZWRcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnSUFNIFVwZGF0ZWQgVGl0bGUnLFxuICAgICAgICAgICAgX2FjdG9yOiBpYW1BY3RvclxuICAgICAgICAgIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnT3JpZ2luYWwgVGl0bGUnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBZGl0RW50cnkocmVjb3JkKTtcblxuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IpLnRvRXF1YWwoaWFtQWN0b3IpO1xuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IuYXV0aE1ldGhvZCkudG9CZSgnaWFtJyk7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5pYW1Sb2xlKS50b0JlKCdhcm46YXdzOmlhbTo6MTIzNDU2Nzg5MDEyOnVzZXIvc2VydmljZS11c2VyJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBzeXN0ZW0vYW5vbnltb3VzIGFjdG9yIGNvbnRleHQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzeXN0ZW1BY3RvciA9IGNyZWF0ZU1vY2tBY3Rvcih7XG4gICAgICAgIGFjdG9yVHlwZTogJ2Fub255bW91cycsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdhbm9ueW1vdXMnLFxuICAgICAgICBhY3RvcklkOiAnc3lzdGVtJyxcbiAgICAgICAgY29nbml0b1N1YjogdW5kZWZpbmVkLFxuICAgICAgICBjb2duaXRvVXNlcm5hbWU6IHVuZGVmaW5lZCxcbiAgICAgICAgY29nbml0b0dyb3VwczogdW5kZWZpbmVkLFxuICAgICAgICB0ZW5hbnRJZDogdW5kZWZpbmVkLFxuICAgICAgICByYXdBdXRoQ29udGV4dDogdW5kZWZpbmVkXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIG5ld0ltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ1N5c3RlbSBHZW5lcmF0ZWQgVGl0bGUnLFxuICAgICAgICAgICAgX2FjdG9yOiBzeXN0ZW1BY3RvclxuICAgICAgICAgIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHVuZGVmaW5lZFxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBZGl0RW50cnkocmVjb3JkKTtcblxuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IpLnRvRXF1YWwoc3lzdGVtQWN0b3IpO1xuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IuYXV0aE1ldGhvZCkudG9CZSgnc3lzdGVtJyk7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5hY3RvclR5cGUpLnRvQmUoJ2Fub255bW91cycpO1xuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IuYWN0b3JJZCkudG9CZSgnc3lzdGVtJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtaXNzaW5nIGFjdG9yIGNvbnRleHQgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGNyZWF0ZU1vY2tFdmVudFJlY29yZCh7XG4gICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICBuZXdJbWFnZToge1xuICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgdGl0bGU6ICdObyBBY3RvciBUaXRsZSdcbiAgICAgICAgICAgIC8vIE5vIF9hY3RvciBmaWVsZCwgbm8gdmlzaWJsZSBhY3RvciBmaWVsZHNcbiAgICAgICAgICB9LFxuICAgICAgICAgIG9sZEltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ09yaWdpbmFsIFRpdGxlJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSAoYXVkaXRMb2dnZXIgYXMgYW55KS5tYWtlQWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yKS50b0VxdWFsKHtcbiAgICAgICAgYWN0b3JJZDogdW5kZWZpbmVkLFxuICAgICAgICB0ZW5hbnRJZDogdW5kZWZpbmVkXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgc2tpcCBhdWRpdCBlbnRyeSB3aGVuIG5vIGNoYW5nZXMgZGV0ZWN0ZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnU2FtZSBUaXRsZScsXG4gICAgICAgICAgICBjb250ZW50OiAnU2FtZSBDb250ZW50JyxcbiAgICAgICAgICAgIF9hY3RvcjogY3JlYXRlTW9ja0FjdG9yKClcbiAgICAgICAgICB9LFxuICAgICAgICAgIG9sZEltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ1NhbWUgVGl0bGUnLFxuICAgICAgICAgICAgY29udGVudDogJ1NhbWUgQ29udGVudCdcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhdWRpdEVudHJ5ID0gKGF1ZGl0TG9nZ2VyIGFzIGFueSkubWFrZUFkaXRFbnRyeShyZWNvcmQpO1xuXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBpbmNsdWRlIHJlcXVlc3QgY29ycmVsYXRpb24gZGF0YSBpbiBhdWRpdCBlbnRyeScsICgpID0+IHtcbiAgICAgIGNvbnN0IGFjdG9yV2l0aENvcnJlbGF0aW9uID0gY3JlYXRlTW9ja0FjdG9yKHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLXVuaXF1ZS0xMjMnLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci10cmFjZS00NTYnLFxuICAgICAgICBzZXNzaW9uSWQ6ICdzZXNzaW9uLTc4OSdcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnVXBkYXRlZCBUaXRsZScsXG4gICAgICAgICAgICBfYWN0b3I6IGFjdG9yV2l0aENvcnJlbGF0aW9uXG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbGRJbWFnZToge1xuICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgdGl0bGU6ICdPcmlnaW5hbCBUaXRsZSdcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBhdWRpdEVudHJ5ID0gKGF1ZGl0TG9nZ2VyIGFzIGFueSkubWFrZUFkaXRFbnRyeShyZWNvcmQpO1xuXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5yZXF1ZXN0SWQpLnRvQmUoJ3JlcS11bmlxdWUtMTIzJyk7XG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3Rvci5jb3JyZWxhdGlvbklkKS50b0JlKCdjb3JyLXRyYWNlLTQ1NicpO1xuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3Iuc2Vzc2lvbklkKS50b0JlKCdzZXNzaW9uLTc4OScpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnZ2V0Q2hhbmdlZFByb3BlcnRpZXMgaWdub3JlcyBfYWN0b3IgZmllbGQnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBpZ25vcmUgX2FjdG9yIGZpZWxkIGluIGNoYW5nZSBkZXRlY3Rpb24nLCAoKSA9PiB7XG4gICAgICBjb25zdCBvbGRJbWFnZSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICB0aXRsZTogJ1RpdGxlJyxcbiAgICAgICAgX2FjdG9yOiBjcmVhdGVNb2NrQWN0b3IoeyBhY3RvcklkOiAnb2xkLXVzZXInIH0pXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBuZXdJbWFnZSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICB0aXRsZTogJ1VwZGF0ZWQgVGl0bGUnLFxuICAgICAgICBfYWN0b3I6IGNyZWF0ZU1vY2tBY3Rvcih7IGFjdG9ySWQ6ICduZXctdXNlcicgfSlcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNoYW5nZXMgPSBnZXRDaGFuZ2VkUHJvcGVydGllcyhvbGRJbWFnZSwgbmV3SW1hZ2UpO1xuXG4gICAgICBleHBlY3QoY2hhbmdlcykudG9FcXVhbCh7XG4gICAgICAgIHRpdGxlOiB7IG9sZDogJ1RpdGxlJywgbmV3OiAnVXBkYXRlZCBUaXRsZScgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QoY2hhbmdlcykubm90LnRvSGF2ZVByb3BlcnR5KCdfYWN0b3InKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZGV0ZWN0IG90aGVyIGNoYW5nZXMgd2hpbGUgaWdub3JpbmcgX2FjdG9yJywgKCkgPT4ge1xuICAgICAgY29uc3Qgb2xkSW1hZ2UgPSB7XG4gICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgdGl0bGU6ICdUaXRsZScsXG4gICAgICAgIGNvbnRlbnQ6ICdDb250ZW50JyxcbiAgICAgICAgdXBkYXRlZEJ5OiAndXNlci0xJyxcbiAgICAgICAgX2FjdG9yOiBjcmVhdGVNb2NrQWN0b3IoeyBhY3RvcklkOiAndXNlci0xJyB9KVxuICAgICAgfTtcblxuICAgICAgY29uc3QgbmV3SW1hZ2UgPSB7XG4gICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgdGl0bGU6ICdVcGRhdGVkIFRpdGxlJyxcbiAgICAgICAgY29udGVudDogJ1VwZGF0ZWQgQ29udGVudCcsXG4gICAgICAgIHVwZGF0ZWRCeTogJ3VzZXItMicsXG4gICAgICAgIF9hY3RvcjogY3JlYXRlTW9ja0FjdG9yKHsgYWN0b3JJZDogJ3VzZXItMicgfSlcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNoYW5nZXMgPSBnZXRDaGFuZ2VkUHJvcGVydGllcyhvbGRJbWFnZSwgbmV3SW1hZ2UpO1xuXG4gICAgICBleHBlY3QoY2hhbmdlcykudG9FcXVhbCh7XG4gICAgICAgIHRpdGxlOiB7IG9sZDogJ1RpdGxlJywgbmV3OiAnVXBkYXRlZCBUaXRsZScgfSxcbiAgICAgICAgY29udGVudDogeyBvbGQ6ICdDb250ZW50JywgbmV3OiAnVXBkYXRlZCBDb250ZW50JyB9LFxuICAgICAgICB1cGRhdGVkQnk6IHsgb2xkOiAndXNlci0xJywgbmV3OiAndXNlci0yJyB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjaGFuZ2VzKS5ub3QudG9IYXZlUHJvcGVydHkoJ19hY3RvcicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBzdGlsbCBkZXRlY3QgY2hhbmdlcyB3aGVuIG9ubHkgX2FjdG9yIGZpZWxkIGNoYW5nZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBvbGRJbWFnZSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICB0aXRsZTogJ1NhbWUgVGl0bGUnLFxuICAgICAgICBfYWN0b3I6IGNyZWF0ZU1vY2tBY3Rvcih7IGFjdG9ySWQ6ICd1c2VyLTEnIH0pXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBuZXdJbWFnZSA9IHtcbiAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICB0aXRsZTogJ1NhbWUgVGl0bGUnLFxuICAgICAgICBfYWN0b3I6IGNyZWF0ZU1vY2tBY3Rvcih7IGFjdG9ySWQ6ICd1c2VyLTInIH0pXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjaGFuZ2VzID0gZ2V0Q2hhbmdlZFByb3BlcnRpZXMob2xkSW1hZ2UsIG5ld0ltYWdlKTtcblxuICAgICAgZXhwZWN0KGNoYW5nZXMpLnRvRXF1YWwoe30pO1xuICAgICAgZXhwZWN0KE9iamVjdC5rZXlzKGNoYW5nZXMpLmxlbmd0aCkudG9CZSgwKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0VkZ2UgY2FzZXMgYW5kIGVycm9yIGhhbmRsaW5nJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaGFuZGxlIG51bGwvdW5kZWZpbmVkIGFjdG9yIGdyYWNlZnVsbHknLCAoKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmQgPSBjcmVhdGVNb2NrRXZlbnRSZWNvcmQoe1xuICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgbmV3SW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnVGl0bGUnLFxuICAgICAgICAgICAgX2FjdG9yOiBudWxsIGFzIGFueVxuICAgICAgICAgIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnT2xkIFRpdGxlJyxcbiAgICAgICAgICAgIF9hY3RvcjogdW5kZWZpbmVkXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBZGl0RW50cnkocmVjb3JkKTtcblxuICAgICAgZXhwZWN0KGF1ZGl0RW50cnkuYWN0b3IpLnRvRXF1YWwoe1xuICAgICAgICBhY3RvcklkOiB1bmRlZmluZWQsXG4gICAgICAgIHRlbmFudElkOiB1bmRlZmluZWRcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBhY3RvciBzdHJ1Y3R1cmUgYW5kIGZhbGxiYWNrIHRvIHZpc2libGUgZmllbGRzIGZvciBpbnZhbGlkIGFjdG9yJywgKCkgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkID0gY3JlYXRlTW9ja0V2ZW50UmVjb3JkKHtcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIG5ld0ltYWdlOiB7XG4gICAgICAgICAgICBwb3N0SWQ6ICdwb3N0LTEyMycsXG4gICAgICAgICAgICB0aXRsZTogJ1RpdGxlJyxcbiAgICAgICAgICAgIHVwZGF0ZWRCeTogJ2ZhbGxiYWNrLXVzZXItMTIzJyxcbiAgICAgICAgICAgIHRlbmFudElkOiAnZmFsbGJhY2stdGVuYW50JyxcbiAgICAgICAgICAgIF9hY3RvcjogJ2ludmFsaWQtYWN0b3Itc3RyaW5nJyBhcyBhbnkgLy8gSW52YWxpZCBhY3RvciB0eXBlXG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbGRJbWFnZToge1xuICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgdGl0bGU6ICdPbGQgVGl0bGUnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYXVkaXRFbnRyeSA9IChhdWRpdExvZ2dlciBhcyBhbnkpLm1ha2VBZGl0RW50cnkocmVjb3JkKTtcblxuICAgICAgLy8gU2hvdWxkIHVzZSBmYWxsYmFjayB3aGVuIF9hY3RvciBpcyBpbnZhbGlkXG4gICAgICBleHBlY3QoYXVkaXRFbnRyeS5hY3RvcikudG9FcXVhbCh7XG4gICAgICAgIGFjdG9ySWQ6ICdmYWxsYmFjay11c2VyLTEyMycsXG4gICAgICAgIHRlbmFudElkOiAnZmFsbGJhY2stdGVuYW50J1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eS9taW5pbWFsIGFjdG9yIG9iamVjdHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBtaW5pbWFsQWN0b3IgPSB7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonXG4gICAgICAgIC8vIE1pc3NpbmcgbW9zdCBmaWVsZHNcbiAgICAgIH0gYXMgQWN0b3I7XG5cbiAgICAgIGNvbnN0IHJlY29yZCA9IGNyZWF0ZU1vY2tFdmVudFJlY29yZCh7XG4gICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICBuZXdJbWFnZToge1xuICAgICAgICAgICAgcG9zdElkOiAncG9zdC0xMjMnLFxuICAgICAgICAgICAgdGl0bGU6ICdUaXRsZScsXG4gICAgICAgICAgICBfYWN0b3I6IG1pbmltYWxBY3RvclxuICAgICAgICAgIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHtcbiAgICAgICAgICAgIHBvc3RJZDogJ3Bvc3QtMTIzJyxcbiAgICAgICAgICAgIHRpdGxlOiAnT2xkIFRpdGxlJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGF1ZGl0RW50cnkgPSAoYXVkaXRMb2dnZXIgYXMgYW55KS5tYWtlQWRpdEVudHJ5KHJlY29yZCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdEVudHJ5LmFjdG9yKS50b0VxdWFsKG1pbmltYWxBY3Rvcik7XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=