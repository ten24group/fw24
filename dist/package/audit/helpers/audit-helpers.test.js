"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const audit_helpers_1 = require("./audit-helpers");
const sampling_1 = require("./sampling");
// Mock the audit logger factory and its loggers
jest.mock('../loggers/factory', () => ({
    AuditLoggerFactory: {
        getInstance: jest.fn().mockReturnValue({
            create: jest.fn().mockReturnValue({
                audit: jest.fn().mockResolvedValue(undefined)
            })
        })
    }
}));
// Removed fast-redact mock as we now use @hackylabs/deep-redact
// Mock deepCopy from utils
jest.mock('../../utils/serialize', () => ({
    deepCopy: jest.fn((obj) => JSON.parse(JSON.stringify(obj)))
}));
// Import after mocking
const factory_1 = require("../loggers/factory");
// Mock crypto.randomUUID for predictable testing
jest.mock('crypto', () => ({
    randomUUID: jest.fn().mockReturnValue('mock-uuid-123')
}));
describe('Audit Helpers', () => {
    const mockFactoryInstance = factory_1.AuditLoggerFactory.getInstance();
    const mockAuditLogger = mockFactoryInstance.create();
    // Mock console.error to avoid noise in test output
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    beforeEach(() => {
        // Clear mocks but preserve the console spy setup
        mockFactoryInstance.create.mockClear();
        mockAuditLogger.audit.mockClear();
        consoleErrorSpy.mockClear();
        // Reset Date.now mock if it exists
        if (jest.isMockFunction(Date.now)) {
            Date.now.mockRestore();
        }
    });
    afterAll(() => {
        consoleErrorSpy.mockRestore();
    });
    // Helper function to create mock execution context
    function createMockExecutionContext(overrides = {}) {
        return {
            event: {
                requestContext: {
                    identity: {
                        sourceIp: '192.168.1.1'
                    }
                }
            },
            request: {
                requestId: 'req-123'
            },
            actor: {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                actorId: 'user-456',
                actorType: 'user',
                authMethod: 'cognito',
                tenantId: 'tenant-abc'
            },
            ...overrides
        };
    }
    describe('captureLog', () => {
        it('should create and log a basic audit entry', async () => {
            const options = {
                logType: 'audit',
                subType: 'user_action',
                entityName: 'User',
                operation: 'login',
                correlationId: 'corr-123'
            };
            await (0, audit_helpers_1.captureLog)(options);
            expect(mockFactoryInstance.create).toHaveBeenCalled();
            expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                enabled: undefined,
                auditEntry: expect.objectContaining({
                    logType: 'audit',
                    subType: 'user_action',
                    entityName: 'User',
                    operation: 'login',
                    eventType: 'unknown',
                    severity: 'info',
                    correlationId: 'corr-123'
                })
            });
        });
        it('should extract context from ExecutionContext', async () => {
            const ctx = createMockExecutionContext();
            const options = {
                entityName: 'User',
                operation: 'getProfile',
                ctx
            };
            await (0, audit_helpers_1.captureLog)(options);
            expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                enabled: undefined,
                auditEntry: expect.objectContaining({
                    entityName: 'User',
                    operation: 'getProfile',
                    correlationId: 'req-123',
                    ipAddress: '192.168.1.1',
                    actor: ctx.actor
                })
            });
        });
        it('should use fallback UUID when no correlation ID available', async () => {
            const options = {
                entityName: 'System',
                operation: 'healthCheck'
            };
            await (0, audit_helpers_1.captureLog)(options);
            expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                enabled: undefined,
                auditEntry: expect.objectContaining({
                    correlationId: 'mock-uuid-123'
                })
            });
        });
        it('should add duration to metrics', async () => {
            const options = {
                entityName: 'Order',
                operation: 'process',
                duration: 1500,
                metrics: {
                    recordCount: 10
                }
            };
            await (0, audit_helpers_1.captureLog)(options);
            expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                enabled: undefined,
                auditEntry: expect.objectContaining({
                    metrics: {
                        duration: 1500,
                        recordCount: 10
                    }
                })
            });
        });
        it('should determine status from success flag', async () => {
            const successOptions = {
                entityName: 'Payment',
                operation: 'charge',
                success: true
            };
            await (0, audit_helpers_1.captureLog)(successOptions);
            expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                enabled: undefined,
                auditEntry: expect.objectContaining({
                    success: true,
                    status: 'completed'
                })
            });
            jest.clearAllMocks();
            const failureOptions = {
                entityName: 'Payment',
                operation: 'charge',
                success: false
            };
            await (0, audit_helpers_1.captureLog)(failureOptions);
            expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                enabled: undefined,
                auditEntry: expect.objectContaining({
                    success: false,
                    status: 'failed'
                })
            });
        });
        it('should provide defaults for required fields', async () => {
            const options = {};
            await (0, audit_helpers_1.captureLog)(options);
            expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                enabled: undefined,
                auditEntry: expect.objectContaining({
                    logType: 'audit',
                    severity: 'info',
                    entityName: 'unknown',
                    eventType: 'unknown',
                    correlationId: 'mock-uuid-123'
                })
            });
        });
        it('should handle enabled flag correctly', async () => {
            const options = {
                entityName: 'User',
                operation: 'login',
                enabled: false
            };
            await (0, audit_helpers_1.captureLog)(options);
            expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                enabled: false,
                auditEntry: expect.any(Object)
            });
        });
        it('should not include empty metrics object', async () => {
            const options = {
                entityName: 'User',
                operation: 'login'
            };
            await (0, audit_helpers_1.captureLog)(options);
            expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                enabled: undefined,
                auditEntry: expect.objectContaining({
                    entityName: 'User',
                    operation: 'login',
                    logType: 'audit',
                    severity: 'info',
                    eventType: 'unknown'
                })
            });
            // Verify metrics field is not present when not provided
            const calledWith = mockAuditLogger.audit.mock.calls[0][0];
            expect(calledWith.auditEntry).not.toHaveProperty('metrics');
        });
        it('should handle audit logger errors gracefully', async () => {
            mockAuditLogger.audit.mockRejectedValueOnce(new Error('Logger failed'));
            const options = {
                entityName: 'User',
                operation: 'login',
                correlationId: 'corr-123'
            };
            // Should not throw
            await expect((0, audit_helpers_1.captureLog)(options)).resolves.toBeUndefined();
            expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to capture audit log:', expect.any(Error), expect.objectContaining({
                logType: undefined,
                subType: undefined,
                entityName: 'User',
                correlationId: 'corr-123'
            }));
        });
    });
    describe('captureError', () => {
        it('should capture error with proper formatting', async () => {
            const error = new Error('Something went wrong');
            error.stack = 'Error: Something went wrong\n    at test...';
            const options = {
                entityName: 'PaymentService',
                operation: 'processCharge',
                correlationId: 'payment-123'
            };
            await (0, audit_helpers_1.captureError)(error, options);
            expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                enabled: undefined,
                auditEntry: expect.objectContaining({
                    entityName: 'PaymentService',
                    operation: 'processCharge',
                    correlationId: 'payment-123',
                    logType: 'audit',
                    eventType: 'unknown',
                    severity: 'error',
                    success: false,
                    status: 'failed',
                    data: {
                        error: expect.any(Object) // Data protection sanitizes error objects
                    }
                })
            });
        });
        it('should handle non-Error objects', async () => {
            const errorData = { code: 'PAYMENT_FAILED', message: 'Card declined' };
            await (0, audit_helpers_1.captureError)(errorData, {
                entityName: 'Payment',
                operation: 'charge'
            });
            expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                enabled: undefined,
                auditEntry: expect.objectContaining({
                    severity: 'error',
                    success: false,
                    status: 'failed',
                    data: {
                        error: errorData
                    }
                })
            });
        });
    });
    describe('AuditCaptureService', () => {
        // Helper functions
        function createMockCorrelationContext(overrides = {}) {
            return {
                correlationId: 'corr-123',
                operationId: 'APIController.getUser',
                operationType: 'api',
                operationName: 'getUser',
                startTimestamp: '2024-01-15T10:30:00.000Z',
                ...overrides
            };
        }
        function createMockActor(overrides = {}) {
            return {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                actorId: 'user-456',
                actorType: 'user',
                authMethod: 'cognito',
                tenantId: 'tenant-abc',
                ...overrides
            };
        }
        function createMockAuditContext(overrides = {}) {
            return {
                enabled: true,
                logType: 'audit',
                subType: 'api_request',
                entityName: 'User',
                operation: 'getUser',
                category: 'user-management',
                actor: createMockActor(),
                correlation: createMockCorrelationContext(),
                auditConfig: {
                    enabled: true,
                    skipStart: false,
                    skipEnd: false,
                    skipErrors: false
                },
                ...overrides
            };
        }
        describe('captureStart', () => {
            it('should capture start audit log for API request', async () => {
                const auditContext = createMockAuditContext();
                const requestContext = {
                    method: 'GET',
                    path: '/users/123',
                    userAgent: 'Mozilla/5.0',
                    sourceIp: '192.168.1.1'
                };
                await audit_helpers_1.AuditCaptureService.captureStart(auditContext, requestContext);
                expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                    enabled: undefined,
                    auditEntry: expect.objectContaining({
                        logType: 'audit',
                        subType: 'api_request_start',
                        entityName: 'User',
                        eventType: 'start',
                        operation: 'getUser',
                        category: 'user-management',
                        correlationId: 'corr-123',
                        severity: 'info',
                        actor: auditContext.actor,
                        context: {
                            correlation: auditContext.correlation,
                            api: expect.objectContaining({
                                method: 'GET',
                                path: '/users/123',
                                userAgent: 'Mozilla/5.0',
                                sourceIp: '192.168.1.1' // Data protection redacts IP addresses
                            })
                        }
                    })
                });
            });
            it('should capture start audit log for queue processing', async () => {
                const auditContext = createMockAuditContext({
                    subType: 'queue_processing',
                    correlation: createMockCorrelationContext({
                        operationType: 'queue',
                        operationId: 'QueueController.processMessage'
                    })
                });
                const queueContext = {
                    queueName: 'user-notifications',
                    batchSize: 5,
                    messageIds: ['msg-1', 'msg-2']
                };
                await audit_helpers_1.AuditCaptureService.captureStart(auditContext, queueContext);
                expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                    enabled: undefined,
                    auditEntry: expect.objectContaining({
                        logType: 'audit',
                        subType: 'queue_processing_start',
                        context: {
                            correlation: auditContext.correlation,
                            queue: queueContext
                        }
                    })
                });
            });
            it('should skip when audit is disabled', async () => {
                const auditContext = createMockAuditContext({ enabled: false });
                const requestContext = {
                    method: 'GET',
                    path: '/users/123'
                };
                await audit_helpers_1.AuditCaptureService.captureStart(auditContext, requestContext);
                expect(mockAuditLogger.audit).not.toHaveBeenCalled();
            });
            it('should skip when skipStart is enabled', async () => {
                const auditContext = createMockAuditContext({
                    auditConfig: {
                        enabled: true,
                        skipStart: true
                    }
                });
                const requestContext = {
                    method: 'GET',
                    path: '/users/123'
                };
                await audit_helpers_1.AuditCaptureService.captureStart(auditContext, requestContext);
                expect(mockAuditLogger.audit).not.toHaveBeenCalled();
            });
            it('should respect sampling function', async () => {
                const samplingFn = jest.fn().mockReturnValue(false);
                const auditContext = createMockAuditContext({
                    auditConfig: {
                        enabled: true,
                        samplingFn
                    }
                });
                const requestContext = {
                    method: 'GET',
                    path: '/users/123'
                };
                await audit_helpers_1.AuditCaptureService.captureStart(auditContext, requestContext);
                expect(samplingFn).toHaveBeenCalledWith('corr-123', 'getUser');
                expect(mockAuditLogger.audit).not.toHaveBeenCalled();
            });
            it('should include custom context in metadata', async () => {
                const customContext = { feature: 'user-management', version: '2.1' };
                const auditContext = createMockAuditContext({
                    auditConfig: {
                        enabled: true,
                        customContext
                    }
                });
                const requestContext = {
                    method: 'GET',
                    path: '/users/123'
                };
                await audit_helpers_1.AuditCaptureService.captureStart(auditContext, requestContext);
                expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                    enabled: undefined,
                    auditEntry: expect.objectContaining({
                        metadata: customContext
                    })
                });
            });
        });
        describe('captureEnd', () => {
            it('should capture successful completion audit log', async () => {
                jest.spyOn(Date, 'now').mockReturnValue(1705314605000); // 5 seconds after start
                const auditContext = createMockAuditContext();
                const result = { users: [{ id: '123', name: 'John' }] };
                const responseContext = {
                    statusCode: 200,
                    responseSize: 1234
                };
                await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, result, null, responseContext);
                expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                    enabled: undefined,
                    auditEntry: expect.objectContaining({
                        logType: 'audit',
                        subType: 'api_request_complete',
                        entityName: 'User',
                        eventType: 'complete',
                        operation: 'getUser',
                        category: 'user-management',
                        success: true,
                        status: 'completed',
                        severity: 'info',
                        correlationId: 'corr-123',
                        actor: auditContext.actor,
                        metrics: {
                            duration: 5000,
                            statusCode: 200,
                            responseSize: 1234
                        },
                        context: {
                            correlation: auditContext.correlation,
                            response: responseContext
                        },
                        data: {
                            error: null // captureEnd always includes error field
                        }
                    })
                });
            });
            it('should capture error audit log', async () => {
                jest.spyOn(Date, 'now').mockReturnValue(1705314602000); // 2 seconds after start
                const auditContext = createMockAuditContext();
                const error = new Error('User not found');
                error.stack = 'Error: User not found\n    at getUserById...';
                await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, null, error);
                expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                    enabled: undefined,
                    auditEntry: expect.objectContaining({
                        logType: 'audit',
                        subType: 'api_request_error',
                        entityName: 'User',
                        eventType: 'error',
                        operation: 'getUser',
                        success: false,
                        status: 'failed',
                        severity: 'info',
                        correlationId: 'corr-123',
                        actor: auditContext.actor,
                        category: 'user-management',
                        metrics: {
                            duration: 2000
                        },
                        context: {
                            correlation: auditContext.correlation
                        },
                        data: {
                            error: expect.any(Object) // Data protection sanitizes error objects
                        }
                    })
                });
            });
            it('should skip when audit is disabled', async () => {
                const auditContext = createMockAuditContext({ enabled: false });
                await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, null, null);
                expect(mockAuditLogger.audit).not.toHaveBeenCalled();
            });
            it('should skip error audit when skipErrors is enabled', async () => {
                const auditContext = createMockAuditContext({
                    auditConfig: {
                        enabled: true,
                        skipErrors: true
                    }
                });
                const error = new Error('Test error');
                await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, null, error);
                expect(mockAuditLogger.audit).not.toHaveBeenCalled();
            });
            it('should skip success audit when skipEnd is enabled', async () => {
                const auditContext = createMockAuditContext({
                    auditConfig: {
                        enabled: true,
                        skipEnd: true
                    }
                });
                await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, { success: true }, null);
                expect(mockAuditLogger.audit).not.toHaveBeenCalled();
            });
            it('should respect sampling function for end events', async () => {
                const samplingFn = jest.fn().mockReturnValue(false);
                const auditContext = createMockAuditContext({
                    auditConfig: {
                        enabled: true,
                        samplingFn
                    }
                });
                await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, null, null);
                expect(samplingFn).toHaveBeenCalledWith('corr-123', 'getUser');
                expect(mockAuditLogger.audit).not.toHaveBeenCalled();
            });
        });
        describe('Integration with real sampling functions', () => {
            it('should work with hash-based sampling', async () => {
                const hashSampling = (0, sampling_1.createHashBasedSampling)(0.5); // 50% sampling rate
                const auditContext = createMockAuditContext({
                    auditConfig: {
                        enabled: true,
                        samplingFn: hashSampling
                    }
                });
                const requestContext = {
                    method: 'GET',
                    path: '/users/123'
                };
                // Hash-based sampling should be deterministic for the same input
                await audit_helpers_1.AuditCaptureService.captureStart(auditContext, requestContext);
                const firstCallCount = mockAuditLogger.audit.mock.calls.length;
                mockAuditLogger.audit.mockClear();
                await audit_helpers_1.AuditCaptureService.captureStart(auditContext, requestContext);
                const secondCallCount = mockAuditLogger.audit.mock.calls.length;
                // Should be consistent - either always called or never called
                expect(firstCallCount).toBe(secondCallCount);
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtaGVscGVycy50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2F1ZGl0L2hlbHBlcnMvYXVkaXQtaGVscGVycy50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbURBQW1HO0FBR25HLHlDQUFxRDtBQUVyRCxnREFBZ0Q7QUFDaEQsSUFBSSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ3JDLGtCQUFrQixFQUFFO1FBQ2xCLFdBQVcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsZUFBZSxDQUFDO1lBQ3JDLE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsZUFBZSxDQUFDO2dCQUNoQyxLQUFLLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFNBQVMsQ0FBQzthQUM5QyxDQUFDO1NBQ0gsQ0FBQztLQUNIO0NBQ0YsQ0FBQyxDQUFDLENBQUM7QUFFSixnRUFBZ0U7QUFFaEUsMkJBQTJCO0FBQzNCLElBQUksQ0FBQyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN4QyxRQUFRLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7Q0FDNUQsQ0FBQyxDQUFDLENBQUM7QUFFSix1QkFBdUI7QUFDdkIsZ0RBQXdEO0FBRXhELGlEQUFpRDtBQUNqRCxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ3pCLFVBQVUsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsZUFBZSxDQUFDLGVBQWUsQ0FBQztDQUN2RCxDQUFDLENBQUMsQ0FBQztBQUVKLFFBQVEsQ0FBQyxlQUFlLEVB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ZVNlcnZpY2UsIENhcHR1cmVMb2dPcHRpb25zIH0gZnJvbSAnLi9hdWRpdC1oZWxwZXJzJztcbmltcG9ydCB7IEF1ZGl0Q29udGV4dCwgUmVxdWVzdEF1ZGl0Q29udGV4dCwgUXVldWVBdWRpdENvbnRleHQsIFRhc2tBdWRpdENvbnRleHQsIENvcnJlbGF0aW9uQ29udGV4dCB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQWN0b3IsIEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IGNyZWF0ZUhhc2hCYXNlZFNhbXBsaW5nIH0gZnJvbSAnLi9zYW1wbGluZyc7XG5cbi8vIE1vY2sgdGhlIGF1ZGl0IGxvZ2dlciBmYWN0b3J5IGFuZCBpdHMgbG9nZ2Vyc1xuamVzdC5tb2NrKCcuLi9sb2dnZXJzL2ZhY3RvcnknLCAoKSA9PiAoe1xuICBBdWRpdExvZ2dlckZhY3Rvcnk6IHtcbiAgICBnZXRJbnN0YW5jZTogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSh7XG4gICAgICBjcmVhdGU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoe1xuICAgICAgICBhdWRpdDogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHVuZGVmaW5lZClcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxufSkpO1xuXG4vLyBSZW1vdmVkIGZhc3QtcmVkYWN0IG1vY2sgYXMgd2Ugbm93IHVzZSBAaGFja3lsYWJzL2RlZXAtcmVkYWN0XG5cbi8vIE1vY2sgZGVlcENvcHkgZnJvbSB1dGlsc1xuamVzdC5tb2NrKCcuLi8uLi91dGlscy9zZXJpYWxpemUnLCAoKSA9PiAoe1xuICBkZWVwQ29weTogamVzdC5mbigob2JqKSA9PiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9iaikpKVxufSkpO1xuXG4vLyBJbXBvcnQgYWZ0ZXIgbW9ja2luZ1xuaW1wb3J0IHsgQXVkaXRMb2dnZXJGYWN0b3J5IH0gZnJvbSAnLi4vbG9nZ2Vycy9mYWN0b3J5JztcblxuLy8gTW9jayBjcnlwdG8ucmFuZG9tVVVJRCBmb3IgcHJlZGljdGFibGUgdGVzdGluZ1xuamVzdC5tb2NrKCdjcnlwdG8nLCAoKSA9PiAoe1xuICByYW5kb21VVUlEOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKCdtb2NrLXV1aWQtMTIzJylcbn0pKTtcblxuZGVzY3JpYmUoJ0F1ZGl0IEhlbHBlcnMnLCAoKSA9PiB7XG4gIGNvbnN0IG1vY2tGYWN0b3J5SW5zdGFuY2UgPSBBdWRpdExvZ2dlckZhY3RvcnkuZ2V0SW5zdGFuY2UoKSBhcyBqZXN0Lk1vY2tlZDxhbnk+O1xuICBjb25zdCBtb2NrQXVkaXRMb2dnZXIgPSBtb2NrRmFjdG9yeUluc3RhbmNlLmNyZWF0ZSgpO1xuICBcbiAgLy8gTW9jayBjb25zb2xlLmVycm9yIHRvIGF2b2lkIG5vaXNlIGluIHRlc3Qgb3V0cHV0XG4gIGNvbnN0IGNvbnNvbGVFcnJvclNweSA9IGplc3Quc3B5T24oY29uc29sZSwgJ2Vycm9yJykubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+IHt9KTtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAvLyBDbGVhciBtb2NrcyBidXQgcHJlc2VydmUgdGhlIGNvbnNvbGUgc3B5IHNldHVwXG4gICAgbW9ja0ZhY3RvcnlJbnN0YW5jZS5jcmVhdGUubW9ja0NsZWFyKCk7XG4gICAgbW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0Lm1vY2tDbGVhcigpO1xuICAgIGNvbnNvbGVFcnJvclNweS5tb2NrQ2xlYXIoKTtcbiAgICBcbiAgICAvLyBSZXNldCBEYXRlLm5vdyBtb2NrIGlmIGl0IGV4aXN0c1xuICAgIGlmIChqZXN0LmlzTW9ja0Z1bmN0aW9uKERhdGUubm93KSkge1xuICAgICAgKERhdGUubm93IGFzIGplc3QuTW9jaykubW9ja1Jlc3RvcmUoKTtcbiAgICB9XG4gIH0pO1xuXG4gIGFmdGVyQWxsKCgpID0+IHtcbiAgICBjb25zb2xlRXJyb3JTcHkubW9ja1Jlc3RvcmUoKTtcbiAgfSk7XG5cbiAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSBtb2NrIGV4ZWN1dGlvbiBjb250ZXh0XG4gIGZ1bmN0aW9uIGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KG92ZXJyaWRlczogUGFydGlhbDxFeGVjdXRpb25Db250ZXh0PiA9IHt9KTogRXhlY3V0aW9uQ29udGV4dCB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGV2ZW50OiB7XG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XG4gICAgICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgcmVxdWVzdDoge1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtMTIzJ1xuICAgICAgfSxcbiAgICAgIGFjdG9yOiB7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonLFxuICAgICAgICBhY3RvcklkOiAndXNlci00NTYnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnXG4gICAgICB9LFxuICAgICAgLi4ub3ZlcnJpZGVzXG4gICAgfSBhcyBFeGVjdXRpb25Db250ZXh0O1xuICB9XG5cbiAgZGVzY3JpYmUoJ2NhcHR1cmVMb2cnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgYW5kIGxvZyBhIGJhc2ljIGF1ZGl0IGVudHJ5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgb3B0aW9uczogQ2FwdHVyZUxvZ09wdGlvbnMgPSB7XG4gICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcsXG4gICAgICAgIHN1YlR5cGU6ICd1c2VyX2FjdGlvbicsXG4gICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnbG9naW4nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBjYXB0dXJlTG9nKG9wdGlvbnMpO1xuXG4gICAgICBleHBlY3QobW9ja0ZhY3RvcnlJbnN0YW5jZS5jcmVhdGUpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgZW5hYmxlZDogdW5kZWZpbmVkLFxuICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgbG9nVHlwZTogJ2F1ZGl0JyxcbiAgICAgICAgICBzdWJUeXBlOiAndXNlcl9hY3Rpb24nLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdsb2dpbicsXG4gICAgICAgICAgZXZlbnRUeXBlOiAndW5rbm93bicsXG4gICAgICAgICAgc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnXG4gICAgICAgIH0pXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBjb250ZXh0IGZyb20gRXhlY3V0aW9uQ29udGV4dCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICBjb25zdCBvcHRpb25zOiBDYXB0dXJlTG9nT3B0aW9ucyA9IHtcbiAgICAgICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICAgICAgICBvcGVyYXRpb246ICdnZXRQcm9maWxlJyxcbiAgICAgICAgY3R4XG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBjYXB0dXJlTG9nKG9wdGlvbnMpO1xuXG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdnZXRQcm9maWxlJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAncmVxLTEyMycsXG4gICAgICAgICAgaXBBZGRyZXNzOiAnMTkyLjE2OC4xLjEnLFxuICAgICAgICAgIGFjdG9yOiBjdHguYWN0b3JcbiAgICAgICAgfSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB1c2UgZmFsbGJhY2sgVVVJRCB3aGVuIG5vIGNvcnJlbGF0aW9uIElEIGF2YWlsYWJsZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG9wdGlvbnM6IENhcHR1cmVMb2dPcHRpb25zID0ge1xuICAgICAgICBlbnRpdHlOYW1lOiAnU3lzdGVtJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnaGVhbHRoQ2hlY2snXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBjYXB0dXJlTG9nKG9wdGlvbnMpO1xuXG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdtb2NrLXV1aWQtMTIzJ1xuICAgICAgICB9KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGFkZCBkdXJhdGlvbiB0byBtZXRyaWNzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgb3B0aW9uczogQ2FwdHVyZUxvZ09wdGlvbnMgPSB7XG4gICAgICAgIGVudGl0eU5hbWU6ICdPcmRlcicsXG4gICAgICAgIG9wZXJhdGlvbjogJ3Byb2Nlc3MnLFxuICAgICAgICBkdXJhdGlvbjogMTUwMCxcbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgIHJlY29yZENvdW50OiAxMFxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBjYXB0dXJlTG9nKG9wdGlvbnMpO1xuXG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgIGR1cmF0aW9uOiAxNTAwLFxuICAgICAgICAgICAgcmVjb3JkQ291bnQ6IDEwXG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGRldGVybWluZSBzdGF0dXMgZnJvbSBzdWNjZXNzIGZsYWcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzdWNjZXNzT3B0aW9uczogQ2FwdHVyZUxvZ09wdGlvbnMgPSB7XG4gICAgICAgIGVudGl0eU5hbWU6ICdQYXltZW50JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnY2hhcmdlJyxcbiAgICAgICAgc3VjY2VzczogdHJ1ZVxuICAgICAgfTtcblxuICAgICAgYXdhaXQgY2FwdHVyZUxvZyhzdWNjZXNzT3B0aW9ucyk7XG5cbiAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgZW5hYmxlZDogdW5kZWZpbmVkLFxuICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnXG4gICAgICAgIH0pXG4gICAgICB9KTtcblxuICAgICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG5cbiAgICAgIGNvbnN0IGZhaWx1cmVPcHRpb25zOiBDYXB0dXJlTG9nT3B0aW9ucyA9IHtcbiAgICAgICAgZW50aXR5TmFtZTogJ1BheW1lbnQnLFxuICAgICAgICBvcGVyYXRpb246ICdjaGFyZ2UnLFxuICAgICAgICBzdWNjZXNzOiBmYWxzZVxuICAgICAgfTtcblxuICAgICAgYXdhaXQgY2FwdHVyZUxvZyhmYWlsdXJlT3B0aW9ucyk7XG5cbiAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgZW5hYmxlZDogdW5kZWZpbmVkLFxuICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJ1xuICAgICAgICB9KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByb3ZpZGUgZGVmYXVsdHMgZm9yIHJlcXVpcmVkIGZpZWxkcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG9wdGlvbnM6IENhcHR1cmVMb2dPcHRpb25zID0ge307XG5cbiAgICAgIGF3YWl0IGNhcHR1cmVMb2cob3B0aW9ucyk7XG5cbiAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgZW5hYmxlZDogdW5kZWZpbmVkLFxuICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgbG9nVHlwZTogJ2F1ZGl0JyxcbiAgICAgICAgICBzZXZlcml0eTogJ2luZm8nLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICd1bmtub3duJyxcbiAgICAgICAgICBldmVudFR5cGU6ICd1bmtub3duJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnbW9jay11dWlkLTEyMydcbiAgICAgICAgfSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZW5hYmxlZCBmbGFnIGNvcnJlY3RseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG9wdGlvbnM6IENhcHR1cmVMb2dPcHRpb25zID0ge1xuICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgIG9wZXJhdGlvbjogJ2xvZ2luJyxcbiAgICAgICAgZW5hYmxlZDogZmFsc2VcbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IGNhcHR1cmVMb2cob3B0aW9ucyk7XG5cbiAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgZW5hYmxlZDogZmFsc2UsXG4gICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5hbnkoT2JqZWN0KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG5vdCBpbmNsdWRlIGVtcHR5IG1ldHJpY3Mgb2JqZWN0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgb3B0aW9uczogQ2FwdHVyZUxvZ09wdGlvbnMgPSB7XG4gICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnbG9naW4nXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBjYXB0dXJlTG9nKG9wdGlvbnMpO1xuXG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdsb2dpbicsXG4gICAgICAgICAgbG9nVHlwZTogJ2F1ZGl0JyxcbiAgICAgICAgICBzZXZlcml0eTogJ2luZm8nLFxuICAgICAgICAgIGV2ZW50VHlwZTogJ3Vua25vd24nXG4gICAgICAgIH0pXG4gICAgICB9KTtcblxuICAgICAgLy8gVmVyaWZ5IG1ldHJpY3MgZmllbGQgaXMgbm90IHByZXNlbnQgd2hlbiBub3QgcHJvdmlkZWRcbiAgICAgIGNvbnN0IGNhbGxlZFdpdGggPSBtb2NrQXVkaXRMb2dnZXIuYXVkaXQubW9jay5jYWxsc1swXVswXTtcbiAgICAgIGV4cGVjdChjYWxsZWRXaXRoLmF1ZGl0RW50cnkpLm5vdC50b0hhdmVQcm9wZXJ0eSgnbWV0cmljcycpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYXVkaXQgbG9nZ2VyIGVycm9ycyBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgbW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0Lm1vY2tSZWplY3RlZFZhbHVlT25jZShuZXcgRXJyb3IoJ0xvZ2dlciBmYWlsZWQnKSk7XG5cbiAgICAgIGNvbnN0IG9wdGlvbnM6IENhcHR1cmVMb2dPcHRpb25zID0ge1xuICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgIG9wZXJhdGlvbjogJ2xvZ2luJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ2NvcnItMTIzJ1xuICAgICAgfTtcblxuICAgICAgLy8gU2hvdWxkIG5vdCB0aHJvd1xuICAgICAgYXdhaXQgZXhwZWN0KGNhcHR1cmVMb2cob3B0aW9ucykpLnJlc29sdmVzLnRvQmVVbmRlZmluZWQoKTtcblxuICAgICAgZXhwZWN0KGNvbnNvbGVFcnJvclNweSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgICdGYWlsZWQgdG8gY2FwdHVyZSBhdWRpdCBsb2c6JyxcbiAgICAgICAgZXhwZWN0LmFueShFcnJvciksXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBsb2dUeXBlOiB1bmRlZmluZWQsXG4gICAgICAgICAgc3ViVHlwZTogdW5kZWZpbmVkLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnXG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnY2FwdHVyZUVycm9yJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY2FwdHVyZSBlcnJvciB3aXRoIHByb3BlciBmb3JtYXR0aW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ1NvbWV0aGluZyB3ZW50IHdyb25nJyk7XG4gICAgICBlcnJvci5zdGFjayA9ICdFcnJvcjogU29tZXRoaW5nIHdlbnQgd3JvbmdcXG4gICAgYXQgdGVzdC4uLic7XG5cbiAgICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICAgIGVudGl0eU5hbWU6ICdQYXltZW50U2VydmljZScsXG4gICAgICAgIG9wZXJhdGlvbjogJ3Byb2Nlc3NDaGFyZ2UnLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAncGF5bWVudC0xMjMnXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBjYXB0dXJlRXJyb3IoZXJyb3IsIG9wdGlvbnMpO1xuXG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIGVudGl0eU5hbWU6ICdQYXltZW50U2VydmljZScsXG4gICAgICAgICAgb3BlcmF0aW9uOiAncHJvY2Vzc0NoYXJnZScsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3BheW1lbnQtMTIzJyxcbiAgICAgICAgICBsb2dUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgIGV2ZW50VHlwZTogJ3Vua25vd24nLFxuICAgICAgICAgIHNldmVyaXR5OiAnZXJyb3InLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIHN0YXR1czogJ2ZhaWxlZCcsXG4gICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgZXJyb3I6IGV4cGVjdC5hbnkoT2JqZWN0KSAvLyBEYXRhIHByb3RlY3Rpb24gc2FuaXRpemVzIGVycm9yIG9iamVjdHNcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG5vbi1FcnJvciBvYmplY3RzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXJyb3JEYXRhID0geyBjb2RlOiAnUEFZTUVOVF9GQUlMRUQnLCBtZXNzYWdlOiAnQ2FyZCBkZWNsaW5lZCcgfTtcblxuICAgICAgYXdhaXQgY2FwdHVyZUVycm9yKGVycm9yRGF0YSwge1xuICAgICAgICBlbnRpdHlOYW1lOiAnUGF5bWVudCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ2NoYXJnZSdcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIHNldmVyaXR5OiAnZXJyb3InLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIHN0YXR1czogJ2ZhaWxlZCcsXG4gICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgZXJyb3I6IGVycm9yRGF0YVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQXVkaXRDYXB0dXJlU2VydmljZScsICgpID0+IHtcbiAgICAvLyBIZWxwZXIgZnVuY3Rpb25zXG4gICAgZnVuY3Rpb24gY3JlYXRlTW9ja0NvcnJlbGF0aW9uQ29udGV4dChvdmVycmlkZXM6IFBhcnRpYWw8Q29ycmVsYXRpb25Db250ZXh0PiA9IHt9KTogQ29ycmVsYXRpb25Db250ZXh0IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLTEyMycsXG4gICAgICAgIG9wZXJhdGlvbklkOiAnQVBJQ29udHJvbGxlci5nZXRVc2VyJyxcbiAgICAgICAgb3BlcmF0aW9uVHlwZTogJ2FwaScsXG4gICAgICAgIG9wZXJhdGlvbk5hbWU6ICdnZXRVc2VyJyxcbiAgICAgICAgc3RhcnRUaW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonLFxuICAgICAgICAuLi5vdmVycmlkZXNcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY3JlYXRlTW9ja0FjdG9yKG92ZXJyaWRlczogUGFydGlhbDxBY3Rvcj4gPSB7fSk6IEFjdG9yIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHJlcXVlc3RJZDogJ3JlcS0xMjMnLFxuICAgICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonLFxuICAgICAgICBhY3RvcklkOiAndXNlci00NTYnLFxuICAgICAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICB0ZW5hbnRJZDogJ3RlbmFudC1hYmMnLFxuICAgICAgICAuLi5vdmVycmlkZXNcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY3JlYXRlTW9ja0F1ZGl0Q29udGV4dChvdmVycmlkZXM6IFBhcnRpYWw8QXVkaXRDb250ZXh0PiA9IHt9KTogQXVkaXRDb250ZXh0IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcsXG4gICAgICAgIHN1YlR5cGU6ICdhcGlfcmVxdWVzdCcsXG4gICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnZ2V0VXNlcicsXG4gICAgICAgIGNhdGVnb3J5OiAndXNlci1tYW5hZ2VtZW50JyxcbiAgICAgICAgYWN0b3I6IGNyZWF0ZU1vY2tBY3RvcigpLFxuICAgICAgICBjb3JyZWxhdGlvbjogY3JlYXRlTW9ja0NvcnJlbGF0aW9uQ29udGV4dCgpLFxuICAgICAgICBhdWRpdENvbmZpZzoge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgc2tpcFN0YXJ0OiBmYWxzZSxcbiAgICAgICAgICBza2lwRW5kOiBmYWxzZSxcbiAgICAgICAgICBza2lwRXJyb3JzOiBmYWxzZVxuICAgICAgICB9LFxuICAgICAgICAuLi5vdmVycmlkZXNcbiAgICAgIH07XG4gICAgfVxuXG4gICAgZGVzY3JpYmUoJ2NhcHR1cmVTdGFydCcsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgY2FwdHVyZSBzdGFydCBhdWRpdCBsb2cgZm9yIEFQSSByZXF1ZXN0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjcmVhdGVNb2NrQXVkaXRDb250ZXh0KCk7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0QXVkaXRDb250ZXh0ID0ge1xuICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcGF0aDogJy91c2Vycy8xMjMnLFxuICAgICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wJyxcbiAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJ1xuICAgICAgICB9O1xuXG4gICAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgICBlbmFibGVkOiB1bmRlZmluZWQsXG4gICAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgICAgbG9nVHlwZTogJ2F1ZGl0JyxcbiAgICAgICAgICAgIHN1YlR5cGU6ICdhcGlfcmVxdWVzdF9zdGFydCcsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgICAgICBldmVudFR5cGU6ICdzdGFydCcsXG4gICAgICAgICAgICBvcGVyYXRpb246ICdnZXRVc2VyJyxcbiAgICAgICAgICAgIGNhdGVnb3J5OiAndXNlci1tYW5hZ2VtZW50JyxcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLTEyMycsXG4gICAgICAgICAgICBzZXZlcml0eTogJ2luZm8nLFxuICAgICAgICAgICAgYWN0b3I6IGF1ZGl0Q29udGV4dC5hY3RvcixcbiAgICAgICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgICAgY29ycmVsYXRpb246IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbixcbiAgICAgICAgICAgICAgYXBpOiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgICAgICBwYXRoOiAnL3VzZXJzLzEyMycsXG4gICAgICAgICAgICAgICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAnLFxuICAgICAgICAgICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEnIC8vIERhdGEgcHJvdGVjdGlvbiByZWRhY3RzIElQIGFkZHJlc3Nlc1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgY2FwdHVyZSBzdGFydCBhdWRpdCBsb2cgZm9yIHF1ZXVlIHByb2Nlc3NpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoe1xuICAgICAgICAgIHN1YlR5cGU6ICdxdWV1ZV9wcm9jZXNzaW5nJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbjogY3JlYXRlTW9ja0NvcnJlbGF0aW9uQ29udGV4dCh7XG4gICAgICAgICAgICBvcGVyYXRpb25UeXBlOiAncXVldWUnLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6ICdRdWV1ZUNvbnRyb2xsZXIucHJvY2Vzc01lc3NhZ2UnXG4gICAgICAgICAgfSlcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHF1ZXVlQ29udGV4dDogUXVldWVBdWRpdENvbnRleHQgPSB7XG4gICAgICAgICAgcXVldWVOYW1lOiAndXNlci1ub3RpZmljYXRpb25zJyxcbiAgICAgICAgICBiYXRjaFNpemU6IDUsXG4gICAgICAgICAgbWVzc2FnZUlkczogWydtc2ctMScsICdtc2ctMiddXG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCBxdWV1ZUNvbnRleHQpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgICBlbmFibGVkOiB1bmRlZmluZWQsXG4gICAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgICAgbG9nVHlwZTogJ2F1ZGl0JyxcbiAgICAgICAgICAgIHN1YlR5cGU6ICdxdWV1ZV9wcm9jZXNzaW5nX3N0YXJ0JyxcbiAgICAgICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgICAgY29ycmVsYXRpb246IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbixcbiAgICAgICAgICAgICAgcXVldWU6IHF1ZXVlQ29udGV4dFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgc2tpcCB3aGVuIGF1ZGl0IGlzIGRpc2FibGVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjcmVhdGVNb2NrQXVkaXRDb250ZXh0KHsgZW5hYmxlZDogZmFsc2UgfSk7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0QXVkaXRDb250ZXh0ID0ge1xuICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcGF0aDogJy91c2Vycy8xMjMnXG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCByZXF1ZXN0Q29udGV4dCk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHNraXAgd2hlbiBza2lwU3RhcnQgaXMgZW5hYmxlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY3JlYXRlTW9ja0F1ZGl0Q29udGV4dCh7XG4gICAgICAgICAgYXVkaXRDb25maWc6IHsgXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgc2tpcFN0YXJ0OiB0cnVlIFxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0QXVkaXRDb250ZXh0ID0ge1xuICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcGF0aDogJy91c2Vycy8xMjMnXG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCByZXF1ZXN0Q29udGV4dCk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHJlc3BlY3Qgc2FtcGxpbmcgZnVuY3Rpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHNhbXBsaW5nRm4gPSBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKGZhbHNlKTtcbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY3JlYXRlTW9ja0F1ZGl0Q29udGV4dCh7XG4gICAgICAgICAgYXVkaXRDb25maWc6IHsgXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgc2FtcGxpbmdGbiBcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCByZXF1ZXN0Q29udGV4dDogUmVxdWVzdEF1ZGl0Q29udGV4dCA9IHtcbiAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgIHBhdGg6ICcvdXNlcnMvMTIzJ1xuICAgICAgICB9O1xuXG4gICAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQpO1xuXG4gICAgICAgIGV4cGVjdChzYW1wbGluZ0ZuKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnY29yci0xMjMnLCAnZ2V0VXNlcicpO1xuICAgICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgaW5jbHVkZSBjdXN0b20gY29udGV4dCBpbiBtZXRhZGF0YScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgY3VzdG9tQ29udGV4dCA9IHsgZmVhdHVyZTogJ3VzZXItbWFuYWdlbWVudCcsIHZlcnNpb246ICcyLjEnIH07XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoe1xuICAgICAgICAgIGF1ZGl0Q29uZmlnOiB7IFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGN1c3RvbUNvbnRleHQgXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQ6IFJlcXVlc3RBdWRpdENvbnRleHQgPSB7XG4gICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICBwYXRoOiAnL3VzZXJzLzEyMydcbiAgICAgICAgfTtcblxuICAgICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHJlcXVlc3RDb250ZXh0KTtcblxuICAgICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgICAgZW5hYmxlZDogdW5kZWZpbmVkLFxuICAgICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgIG1ldGFkYXRhOiBjdXN0b21Db250ZXh0XG4gICAgICAgICAgfSlcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdjYXB0dXJlRW5kJywgKCkgPT4ge1xuICAgICAgaXQoJ3Nob3VsZCBjYXB0dXJlIHN1Y2Nlc3NmdWwgY29tcGxldGlvbiBhdWRpdCBsb2cnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGplc3Quc3B5T24oRGF0ZSwgJ25vdycpLm1vY2tSZXR1cm5WYWx1ZSgxNzA1MzE0NjA1MDAwKTsgLy8gNSBzZWNvbmRzIGFmdGVyIHN0YXJ0XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY3JlYXRlTW9ja0F1ZGl0Q29udGV4dCgpO1xuICAgICAgICBjb25zdCByZXN1bHQgPSB7IHVzZXJzOiBbeyBpZDogJzEyMycsIG5hbWU6ICdKb2huJyB9XSB9O1xuICAgICAgICBjb25zdCByZXNwb25zZUNvbnRleHQgPSB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgICAgIHJlc3BvbnNlU2l6ZTogMTIzNFxuICAgICAgICB9O1xuXG4gICAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIHJlc3VsdCwgbnVsbCwgcmVzcG9uc2VDb250ZXh0KTtcblxuICAgICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgICAgZW5hYmxlZDogdW5kZWZpbmVkLFxuICAgICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3RfY29tcGxldGUnLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICAgICAgICAgICAgZXZlbnRUeXBlOiAnY29tcGxldGUnLFxuICAgICAgICAgICAgb3BlcmF0aW9uOiAnZ2V0VXNlcicsXG4gICAgICAgICAgICBjYXRlZ29yeTogJ3VzZXItbWFuYWdlbWVudCcsXG4gICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgICAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICAgICAgYWN0b3I6IGF1ZGl0Q29udGV4dC5hY3RvcixcbiAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgZHVyYXRpb246IDUwMDAsXG4gICAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgICAgcmVzcG9uc2VTaXplOiAxMjM0XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29udGV4dDoge1xuICAgICAgICAgICAgICBjb3JyZWxhdGlvbjogYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLFxuICAgICAgICAgICAgICByZXNwb25zZTogcmVzcG9uc2VDb250ZXh0XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBlcnJvcjogbnVsbCAvLyBjYXB0dXJlRW5kIGFsd2F5cyBpbmNsdWRlcyBlcnJvciBmaWVsZFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgY2FwdHVyZSBlcnJvciBhdWRpdCBsb2cnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGplc3Quc3B5T24oRGF0ZSwgJ25vdycpLm1vY2tSZXR1cm5WYWx1ZSgxNzA1MzE0NjAyMDAwKTsgLy8gMiBzZWNvbmRzIGFmdGVyIHN0YXJ0XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY3JlYXRlTW9ja0F1ZGl0Q29udGV4dCgpO1xuICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignVXNlciBub3QgZm91bmQnKTtcbiAgICAgICAgZXJyb3Iuc3RhY2sgPSAnRXJyb3I6IFVzZXIgbm90IGZvdW5kXFxuICAgIGF0IGdldFVzZXJCeUlkLi4uJztcblxuICAgICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCBudWxsLCBlcnJvcik7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICBsb2dUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0X2Vycm9yJyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgICAgIGV2ZW50VHlwZTogJ2Vycm9yJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2dldFVzZXInLFxuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICBzdGF0dXM6ICdmYWlsZWQnLFxuICAgICAgICAgICAgc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLTEyMycsXG4gICAgICAgICAgICBhY3RvcjogYXVkaXRDb250ZXh0LmFjdG9yLFxuICAgICAgICAgICAgY2F0ZWdvcnk6ICd1c2VyLW1hbmFnZW1lbnQnLFxuICAgICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgICBkdXJhdGlvbjogMjAwMFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgICAgY29ycmVsYXRpb246IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvblxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgZXJyb3I6IGV4cGVjdC5hbnkoT2JqZWN0KSAvLyBEYXRhIHByb3RlY3Rpb24gc2FuaXRpemVzIGVycm9yIG9iamVjdHNcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHNraXAgd2hlbiBhdWRpdCBpcyBkaXNhYmxlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY3JlYXRlTW9ja0F1ZGl0Q29udGV4dCh7IGVuYWJsZWQ6IGZhbHNlIH0pO1xuXG4gICAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIG51bGwsIG51bGwpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBza2lwIGVycm9yIGF1ZGl0IHdoZW4gc2tpcEVycm9ycyBpcyBlbmFibGVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjcmVhdGVNb2NrQXVkaXRDb250ZXh0KHtcbiAgICAgICAgICBhdWRpdENvbmZpZzogeyBcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBza2lwRXJyb3JzOiB0cnVlIFxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdUZXN0IGVycm9yJyk7XG5cbiAgICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgbnVsbCwgZXJyb3IpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBza2lwIHN1Y2Nlc3MgYXVkaXQgd2hlbiBza2lwRW5kIGlzIGVuYWJsZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoe1xuICAgICAgICAgIGF1ZGl0Q29uZmlnOiB7IFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHNraXBFbmQ6IHRydWUgXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCB7IHN1Y2Nlc3M6IHRydWUgfSwgbnVsbCk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHJlc3BlY3Qgc2FtcGxpbmcgZnVuY3Rpb24gZm9yIGVuZCBldmVudHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHNhbXBsaW5nRm4gPSBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKGZhbHNlKTtcbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY3JlYXRlTW9ja0F1ZGl0Q29udGV4dCh7XG4gICAgICAgICAgYXVkaXRDb25maWc6IHsgXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgc2FtcGxpbmdGbiBcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIG51bGwsIG51bGwpO1xuXG4gICAgICAgIGV4cGVjdChzYW1wbGluZ0ZuKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnY29yci0xMjMnLCAnZ2V0VXNlcicpO1xuICAgICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnSW50ZWdyYXRpb24gd2l0aCByZWFsIHNhbXBsaW5nIGZ1bmN0aW9ucycsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgd29yayB3aXRoIGhhc2gtYmFzZWQgc2FtcGxpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGhhc2hTYW1wbGluZyA9IGNyZWF0ZUhhc2hCYXNlZFNhbXBsaW5nKDAuNSk7IC8vIDUwJSBzYW1wbGluZyByYXRlXG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoe1xuICAgICAgICAgIGF1ZGl0Q29uZmlnOiB7IFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHNhbXBsaW5nRm46IGhhc2hTYW1wbGluZyBcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCByZXF1ZXN0Q29udGV4dDogUmVxdWVzdEF1ZGl0Q29udGV4dCA9IHtcbiAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgIHBhdGg6ICcvdXNlcnMvMTIzJ1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEhhc2gtYmFzZWQgc2FtcGxpbmcgc2hvdWxkIGJlIGRldGVybWluaXN0aWMgZm9yIHRoZSBzYW1lIGlucHV0XG4gICAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQpO1xuICAgICAgICBjb25zdCBmaXJzdENhbGxDb3VudCA9IG1vY2tBdWRpdExvZ2dlci5hdWRpdC5tb2NrLmNhbGxzLmxlbmd0aDtcbiAgICAgICAgXG4gICAgICAgIG1vY2tBdWRpdExvZ2dlci5hdWRpdC5tb2NrQ2xlYXIoKTtcbiAgICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCByZXF1ZXN0Q29udGV4dCk7XG4gICAgICAgIGNvbnN0IHNlY29uZENhbGxDb3VudCA9IG1vY2tBdWRpdExvZ2dlci5hdWRpdC5tb2NrLmNhbGxzLmxlbmd0aDtcblxuICAgICAgICAvLyBTaG91bGQgYmUgY29uc2lzdGVudCAtIGVpdGhlciBhbHdheXMgY2FsbGVkIG9yIG5ldmVyIGNhbGxlZFxuICAgICAgICBleHBlY3QoZmlyc3RDYWxsQ291bnQpLnRvQmUoc2Vjb25kQ2FsbENvdW50KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbn0pOyJdfQ==