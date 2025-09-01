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
// Mock fast-redact to avoid module loading issues in tests
jest.mock('fast-redact', () => {
    return jest.fn(() => jest.fn((obj) => obj));
});
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtaGVscGVycy50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2F1ZGl0L2hlbHBlcnMvYXVkaXQtaGVscGVycy50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbURBQW1HO0FBR25HLHlDQUFxRDtBQUVyRCxnREFBZ0Q7QUFDaEQsSUFBSSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ3JDLGtCQUFrQixFQUFFO1FBQ2xCLFdBQVcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsZUFBZSxDQUFDO1lBQ3JDLE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsZUFBZSxDQUFDO2dCQUNoQyxLQUFLLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFNBQVMsQ0FBQzthQUM5QyxDQUFDO1NBQ0gsQ0FBQztLQUNIO0NBQ0YsQ0FBQyxDQUFDLENBQUM7QUFFSiwyREFBMkQ7QUFDM0QsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsR0FBRyxFQUFFO0lBQzVCLE9BQU8sSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQzlDLENBQUMsQ0FBQyxDQUFDO0FBRUgsMkJBQTJCO0FBQzNCLElBQUksQ0FBQyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN4QyxRQUFRLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7Q0FDNUQsQ0FBQyxDQUFDLENBQUM7QUFFSix1QkFBdUI7QUFDdkIsZ0RB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Q0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUM7WUFDL0MsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBjYXB0dXJlTG9nLCBjYXB0dXJlRXJyb3IsIEF1ZGl0Q2FwdHVyZVNlcnZpY2UsIENhcHR1cmVMb2dPcHRpb25zIH0gZnJvbSAnLi9hdWRpdC1oZWxwZXJzJztcbmltcG9ydCB7IEF1ZGl0Q29udGV4dCwgUmVxdWVzdEF1ZGl0Q29udGV4dCwgUXVldWVBdWRpdENvbnRleHQsIFRhc2tBdWRpdENvbnRleHQsIENvcnJlbGF0aW9uQ29udGV4dCB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQWN0b3IsIEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IGNyZWF0ZUhhc2hCYXNlZFNhbXBsaW5nIH0gZnJvbSAnLi9zYW1wbGluZyc7XG5cbi8vIE1vY2sgdGhlIGF1ZGl0IGxvZ2dlciBmYWN0b3J5IGFuZCBpdHMgbG9nZ2Vyc1xuamVzdC5tb2NrKCcuLi9sb2dnZXJzL2ZhY3RvcnknLCAoKSA9PiAoe1xuICBBdWRpdExvZ2dlckZhY3Rvcnk6IHtcbiAgICBnZXRJbnN0YW5jZTogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSh7XG4gICAgICBjcmVhdGU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoe1xuICAgICAgICBhdWRpdDogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHVuZGVmaW5lZClcbiAgICAgIH0pXG4gICAgfSlcbiAgfVxufSkpO1xuXG4vLyBNb2NrIGZhc3QtcmVkYWN0IHRvIGF2b2lkIG1vZHVsZSBsb2FkaW5nIGlzc3VlcyBpbiB0ZXN0c1xuamVzdC5tb2NrKCdmYXN0LXJlZGFjdCcsICgpID0+IHtcbiAgcmV0dXJuIGplc3QuZm4oKCkgPT4gamVzdC5mbigob2JqKSA9PiBvYmopKTtcbn0pO1xuXG4vLyBNb2NrIGRlZXBDb3B5IGZyb20gdXRpbHNcbmplc3QubW9jaygnLi4vLi4vdXRpbHMvc2VyaWFsaXplJywgKCkgPT4gKHtcbiAgZGVlcENvcHk6IGplc3QuZm4oKG9iaikgPT4gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShvYmopKSlcbn0pKTtcblxuLy8gSW1wb3J0IGFmdGVyIG1vY2tpbmdcbmltcG9ydCB7IEF1ZGl0TG9nZ2VyRmFjdG9yeSB9IGZyb20gJy4uL2xvZ2dlcnMvZmFjdG9yeSc7XG5cbi8vIE1vY2sgY3J5cHRvLnJhbmRvbVVVSUQgZm9yIHByZWRpY3RhYmxlIHRlc3Rpbmdcbmplc3QubW9jaygnY3J5cHRvJywgKCkgPT4gKHtcbiAgcmFuZG9tVVVJRDogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSgnbW9jay11dWlkLTEyMycpXG59KSk7XG5cbmRlc2NyaWJlKCdBdWRpdCBIZWxwZXJzJywgKCkgPT4ge1xuICBjb25zdCBtb2NrRmFjdG9yeUluc3RhbmNlID0gQXVkaXRMb2dnZXJGYWN0b3J5LmdldEluc3RhbmNlKCkgYXMgamVzdC5Nb2NrZWQ8YW55PjtcbiAgY29uc3QgbW9ja0F1ZGl0TG9nZ2VyID0gbW9ja0ZhY3RvcnlJbnN0YW5jZS5jcmVhdGUoKTtcbiAgXG4gIC8vIE1vY2sgY29uc29sZS5lcnJvciB0byBhdm9pZCBub2lzZSBpbiB0ZXN0IG91dHB1dFxuICBjb25zdCBjb25zb2xlRXJyb3JTcHkgPSBqZXN0LnNweU9uKGNvbnNvbGUsICdlcnJvcicpLm1vY2tJbXBsZW1lbnRhdGlvbigoKSA9PiB7fSk7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgLy8gQ2xlYXIgbW9ja3MgYnV0IHByZXNlcnZlIHRoZSBjb25zb2xlIHNweSBzZXR1cFxuICAgIG1vY2tGYWN0b3J5SW5zdGFuY2UuY3JlYXRlLm1vY2tDbGVhcigpO1xuICAgIG1vY2tBdWRpdExvZ2dlci5hdWRpdC5tb2NrQ2xlYXIoKTtcbiAgICBjb25zb2xlRXJyb3JTcHkubW9ja0NsZWFyKCk7XG4gICAgXG4gICAgLy8gUmVzZXQgRGF0ZS5ub3cgbW9jayBpZiBpdCBleGlzdHNcbiAgICBpZiAoamVzdC5pc01vY2tGdW5jdGlvbihEYXRlLm5vdykpIHtcbiAgICAgIChEYXRlLm5vdyBhcyBqZXN0Lk1vY2spLm1vY2tSZXN0b3JlKCk7XG4gICAgfVxuICB9KTtcblxuICBhZnRlckFsbCgoKSA9PiB7XG4gICAgY29uc29sZUVycm9yU3B5Lm1vY2tSZXN0b3JlKCk7XG4gIH0pO1xuXG4gIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjcmVhdGUgbW9jayBleGVjdXRpb24gY29udGV4dFxuICBmdW5jdGlvbiBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dChvdmVycmlkZXM6IFBhcnRpYWw8RXhlY3V0aW9uQ29udGV4dD4gPSB7fSk6IEV4ZWN1dGlvbkNvbnRleHQge1xuICAgIHJldHVybiB7XG4gICAgICBldmVudDoge1xuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHJlcXVlc3Q6IHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLTEyMydcbiAgICAgIH0sXG4gICAgICBhY3Rvcjoge1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtMTIzJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgYWN0b3JJZDogJ3VzZXItNDU2JyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJ1xuICAgICAgfSxcbiAgICAgIC4uLm92ZXJyaWRlc1xuICAgIH0gYXMgRXhlY3V0aW9uQ29udGV4dDtcbiAgfVxuXG4gIGRlc2NyaWJlKCdjYXB0dXJlTG9nJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY3JlYXRlIGFuZCBsb2cgYSBiYXNpYyBhdWRpdCBlbnRyeScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG9wdGlvbnM6IENhcHR1cmVMb2dPcHRpb25zID0ge1xuICAgICAgICBsb2dUeXBlOiAnYXVkaXQnLFxuICAgICAgICBzdWJUeXBlOiAndXNlcl9hY3Rpb24nLFxuICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgIG9wZXJhdGlvbjogJ2xvZ2luJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ2NvcnItMTIzJ1xuICAgICAgfTtcblxuICAgICAgYXdhaXQgY2FwdHVyZUxvZyhvcHRpb25zKTtcblxuICAgICAgZXhwZWN0KG1vY2tGYWN0b3J5SW5zdGFuY2UuY3JlYXRlKS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgc3ViVHlwZTogJ3VzZXJfYWN0aW9uJyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnbG9naW4nLFxuICAgICAgICAgIGV2ZW50VHlwZTogJ3Vua25vd24nLFxuICAgICAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ2NvcnItMTIzJ1xuICAgICAgICB9KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGV4dHJhY3QgY29udGV4dCBmcm9tIEV4ZWN1dGlvbkNvbnRleHQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgY29uc3Qgb3B0aW9uczogQ2FwdHVyZUxvZ09wdGlvbnMgPSB7XG4gICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnZ2V0UHJvZmlsZScsXG4gICAgICAgIGN0eFxuICAgICAgfTtcblxuICAgICAgYXdhaXQgY2FwdHVyZUxvZyhvcHRpb25zKTtcblxuICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICBlbmFibGVkOiB1bmRlZmluZWQsXG4gICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZ2V0UHJvZmlsZScsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3JlcS0xMjMnLFxuICAgICAgICAgIGlwQWRkcmVzczogJzE5Mi4xNjguMS4xJyxcbiAgICAgICAgICBhY3RvcjogY3R4LmFjdG9yXG4gICAgICAgIH0pXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdXNlIGZhbGxiYWNrIFVVSUQgd2hlbiBubyBjb3JyZWxhdGlvbiBJRCBhdmFpbGFibGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBvcHRpb25zOiBDYXB0dXJlTG9nT3B0aW9ucyA9IHtcbiAgICAgICAgZW50aXR5TmFtZTogJ1N5c3RlbScsXG4gICAgICAgIG9wZXJhdGlvbjogJ2hlYWx0aENoZWNrJ1xuICAgICAgfTtcblxuICAgICAgYXdhaXQgY2FwdHVyZUxvZyhvcHRpb25zKTtcblxuICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICBlbmFibGVkOiB1bmRlZmluZWQsXG4gICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnbW9jay11dWlkLTEyMydcbiAgICAgICAgfSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBhZGQgZHVyYXRpb24gdG8gbWV0cmljcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG9wdGlvbnM6IENhcHR1cmVMb2dPcHRpb25zID0ge1xuICAgICAgICBlbnRpdHlOYW1lOiAnT3JkZXInLFxuICAgICAgICBvcGVyYXRpb246ICdwcm9jZXNzJyxcbiAgICAgICAgZHVyYXRpb246IDE1MDAsXG4gICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICByZWNvcmRDb3VudDogMTBcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgYXdhaXQgY2FwdHVyZUxvZyhvcHRpb25zKTtcblxuICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICBlbmFibGVkOiB1bmRlZmluZWQsXG4gICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICBkdXJhdGlvbjogMTUwMCxcbiAgICAgICAgICAgIHJlY29yZENvdW50OiAxMFxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBkZXRlcm1pbmUgc3RhdHVzIGZyb20gc3VjY2VzcyBmbGFnJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc3VjY2Vzc09wdGlvbnM6IENhcHR1cmVMb2dPcHRpb25zID0ge1xuICAgICAgICBlbnRpdHlOYW1lOiAnUGF5bWVudCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ2NoYXJnZScsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWVcbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IGNhcHR1cmVMb2coc3VjY2Vzc09wdGlvbnMpO1xuXG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJ1xuICAgICAgICB9KVxuICAgICAgfSk7XG5cbiAgICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xuXG4gICAgICBjb25zdCBmYWlsdXJlT3B0aW9uczogQ2FwdHVyZUxvZ09wdGlvbnMgPSB7XG4gICAgICAgIGVudGl0eU5hbWU6ICdQYXltZW50JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnY2hhcmdlJyxcbiAgICAgICAgc3VjY2VzczogZmFsc2VcbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IGNhcHR1cmVMb2coZmFpbHVyZU9wdGlvbnMpO1xuXG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIHN0YXR1czogJ2ZhaWxlZCdcbiAgICAgICAgfSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwcm92aWRlIGRlZmF1bHRzIGZvciByZXF1aXJlZCBmaWVsZHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBvcHRpb25zOiBDYXB0dXJlTG9nT3B0aW9ucyA9IHt9O1xuXG4gICAgICBhd2FpdCBjYXB0dXJlTG9nKG9wdGlvbnMpO1xuXG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAndW5rbm93bicsXG4gICAgICAgICAgZXZlbnRUeXBlOiAndW5rbm93bicsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ21vY2stdXVpZC0xMjMnXG4gICAgICAgIH0pXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVuYWJsZWQgZmxhZyBjb3JyZWN0bHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBvcHRpb25zOiBDYXB0dXJlTG9nT3B0aW9ucyA9IHtcbiAgICAgICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICAgICAgICBvcGVyYXRpb246ICdsb2dpbicsXG4gICAgICAgIGVuYWJsZWQ6IGZhbHNlXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBjYXB0dXJlTG9nKG9wdGlvbnMpO1xuXG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3QuYW55KE9iamVjdClcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBub3QgaW5jbHVkZSBlbXB0eSBtZXRyaWNzIG9iamVjdCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG9wdGlvbnM6IENhcHR1cmVMb2dPcHRpb25zID0ge1xuICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgIG9wZXJhdGlvbjogJ2xvZ2luJ1xuICAgICAgfTtcblxuICAgICAgYXdhaXQgY2FwdHVyZUxvZyhvcHRpb25zKTtcblxuICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICBlbmFibGVkOiB1bmRlZmluZWQsXG4gICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnbG9naW4nLFxuICAgICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgICAgICBldmVudFR5cGU6ICd1bmtub3duJ1xuICAgICAgICB9KVxuICAgICAgfSk7XG5cbiAgICAgIC8vIFZlcmlmeSBtZXRyaWNzIGZpZWxkIGlzIG5vdCBwcmVzZW50IHdoZW4gbm90IHByb3ZpZGVkXG4gICAgICBjb25zdCBjYWxsZWRXaXRoID0gbW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0Lm1vY2suY2FsbHNbMF1bMF07XG4gICAgICBleHBlY3QoY2FsbGVkV2l0aC5hdWRpdEVudHJ5KS5ub3QudG9IYXZlUHJvcGVydHkoJ21ldHJpY3MnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGF1ZGl0IGxvZ2dlciBlcnJvcnMgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIG1vY2tBdWRpdExvZ2dlci5hdWRpdC5tb2NrUmVqZWN0ZWRWYWx1ZU9uY2UobmV3IEVycm9yKCdMb2dnZXIgZmFpbGVkJykpO1xuXG4gICAgICBjb25zdCBvcHRpb25zOiBDYXB0dXJlTG9nT3B0aW9ucyA9IHtcbiAgICAgICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICAgICAgICBvcGVyYXRpb246ICdsb2dpbicsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLTEyMydcbiAgICAgIH07XG5cbiAgICAgIC8vIFNob3VsZCBub3QgdGhyb3dcbiAgICAgIGF3YWl0IGV4cGVjdChjYXB0dXJlTG9nKG9wdGlvbnMpKS5yZXNvbHZlcy50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICAgIGV4cGVjdChjb25zb2xlRXJyb3JTcHkpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICAnRmFpbGVkIHRvIGNhcHR1cmUgYXVkaXQgbG9nOicsXG4gICAgICAgIGV4cGVjdC5hbnkoRXJyb3IpLFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgbG9nVHlwZTogdW5kZWZpbmVkLFxuICAgICAgICAgIHN1YlR5cGU6IHVuZGVmaW5lZCxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ2NvcnItMTIzJ1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2NhcHR1cmVFcnJvcicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNhcHR1cmUgZXJyb3Igd2l0aCBwcm9wZXIgZm9ybWF0dGluZycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdTb21ldGhpbmcgd2VudCB3cm9uZycpO1xuICAgICAgZXJyb3Iuc3RhY2sgPSAnRXJyb3I6IFNvbWV0aGluZyB3ZW50IHdyb25nXFxuICAgIGF0IHRlc3QuLi4nO1xuXG4gICAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgICBlbnRpdHlOYW1lOiAnUGF5bWVudFNlcnZpY2UnLFxuICAgICAgICBvcGVyYXRpb246ICdwcm9jZXNzQ2hhcmdlJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3BheW1lbnQtMTIzJ1xuICAgICAgfTtcblxuICAgICAgYXdhaXQgY2FwdHVyZUVycm9yKGVycm9yLCBvcHRpb25zKTtcblxuICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICBlbmFibGVkOiB1bmRlZmluZWQsXG4gICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnUGF5bWVudFNlcnZpY2UnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ3Byb2Nlc3NDaGFyZ2UnLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdwYXltZW50LTEyMycsXG4gICAgICAgICAgbG9nVHlwZTogJ2F1ZGl0JyxcbiAgICAgICAgICBldmVudFR5cGU6ICd1bmtub3duJyxcbiAgICAgICAgICBzZXZlcml0eTogJ2Vycm9yJyxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBzdGF0dXM6ICdmYWlsZWQnLFxuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGVycm9yOiBleHBlY3QuYW55KE9iamVjdCkgLy8gRGF0YSBwcm90ZWN0aW9uIHNhbml0aXplcyBlcnJvciBvYmplY3RzXG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBub24tRXJyb3Igb2JqZWN0cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGVycm9yRGF0YSA9IHsgY29kZTogJ1BBWU1FTlRfRkFJTEVEJywgbWVzc2FnZTogJ0NhcmQgZGVjbGluZWQnIH07XG5cbiAgICAgIGF3YWl0IGNhcHR1cmVFcnJvcihlcnJvckRhdGEsIHtcbiAgICAgICAgZW50aXR5TmFtZTogJ1BheW1lbnQnLFxuICAgICAgICBvcGVyYXRpb246ICdjaGFyZ2UnXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICBlbmFibGVkOiB1bmRlZmluZWQsXG4gICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBzZXZlcml0eTogJ2Vycm9yJyxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBzdGF0dXM6ICdmYWlsZWQnLFxuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGVycm9yOiBlcnJvckRhdGFcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0F1ZGl0Q2FwdHVyZVNlcnZpY2UnLCAoKSA9PiB7XG4gICAgLy8gSGVscGVyIGZ1bmN0aW9uc1xuICAgIGZ1bmN0aW9uIGNyZWF0ZU1vY2tDb3JyZWxhdGlvbkNvbnRleHQob3ZlcnJpZGVzOiBQYXJ0aWFsPENvcnJlbGF0aW9uQ29udGV4dD4gPSB7fSk6IENvcnJlbGF0aW9uQ29udGV4dCB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICBvcGVyYXRpb25JZDogJ0FQSUNvbnRyb2xsZXIuZ2V0VXNlcicsXG4gICAgICAgIG9wZXJhdGlvblR5cGU6ICdhcGknLFxuICAgICAgICBvcGVyYXRpb25OYW1lOiAnZ2V0VXNlcicsXG4gICAgICAgIHN0YXJ0VGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgLi4ub3ZlcnJpZGVzXG4gICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNyZWF0ZU1vY2tBY3RvcihvdmVycmlkZXM6IFBhcnRpYWw8QWN0b3I+ID0ge30pOiBBY3RvciB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtMTIzJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgYWN0b3JJZDogJ3VzZXItNDU2JyxcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIGF1dGhNZXRob2Q6ICdjb2duaXRvJyxcbiAgICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJyxcbiAgICAgICAgLi4ub3ZlcnJpZGVzXG4gICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNyZWF0ZU1vY2tBdWRpdENvbnRleHQob3ZlcnJpZGVzOiBQYXJ0aWFsPEF1ZGl0Q29udGV4dD4gPSB7fSk6IEF1ZGl0Q29udGV4dCB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBsb2dUeXBlOiAnYXVkaXQnLFxuICAgICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3QnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgIG9wZXJhdGlvbjogJ2dldFVzZXInLFxuICAgICAgICBjYXRlZ29yeTogJ3VzZXItbWFuYWdlbWVudCcsXG4gICAgICAgIGFjdG9yOiBjcmVhdGVNb2NrQWN0b3IoKSxcbiAgICAgICAgY29ycmVsYXRpb246IGNyZWF0ZU1vY2tDb3JyZWxhdGlvbkNvbnRleHQoKSxcbiAgICAgICAgYXVkaXRDb25maWc6IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNraXBTdGFydDogZmFsc2UsXG4gICAgICAgICAgc2tpcEVuZDogZmFsc2UsXG4gICAgICAgICAgc2tpcEVycm9yczogZmFsc2VcbiAgICAgICAgfSxcbiAgICAgICAgLi4ub3ZlcnJpZGVzXG4gICAgICB9O1xuICAgIH1cblxuICAgIGRlc2NyaWJlKCdjYXB0dXJlU3RhcnQnLCAoKSA9PiB7XG4gICAgICBpdCgnc2hvdWxkIGNhcHR1cmUgc3RhcnQgYXVkaXQgbG9nIGZvciBBUEkgcmVxdWVzdCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY3JlYXRlTW9ja0F1ZGl0Q29udGV4dCgpO1xuICAgICAgICBjb25zdCByZXF1ZXN0Q29udGV4dDogUmVxdWVzdEF1ZGl0Q29udGV4dCA9IHtcbiAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgIHBhdGg6ICcvdXNlcnMvMTIzJyxcbiAgICAgICAgICB1c2VyQWdlbnQ6ICdNb3ppbGxhLzUuMCcsXG4gICAgICAgICAgc291cmNlSXA6ICcxOTIuMTY4LjEuMSdcbiAgICAgICAgfTtcblxuICAgICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHJlcXVlc3RDb250ZXh0KTtcblxuICAgICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgICAgZW5hYmxlZDogdW5kZWZpbmVkLFxuICAgICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3Rfc3RhcnQnLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICAgICAgICAgICAgZXZlbnRUeXBlOiAnc3RhcnQnLFxuICAgICAgICAgICAgb3BlcmF0aW9uOiAnZ2V0VXNlcicsXG4gICAgICAgICAgICBjYXRlZ29yeTogJ3VzZXItbWFuYWdlbWVudCcsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICAgICAgc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgICAgICAgIGFjdG9yOiBhdWRpdENvbnRleHQuYWN0b3IsXG4gICAgICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgICAgIGNvcnJlbGF0aW9uOiBhdWRpdENvbnRleHQuY29ycmVsYXRpb24sXG4gICAgICAgICAgICAgIGFwaTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICAgICAgcGF0aDogJy91c2Vycy8xMjMnLFxuICAgICAgICAgICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wJyxcbiAgICAgICAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJyAvLyBEYXRhIHByb3RlY3Rpb24gcmVkYWN0cyBJUCBhZGRyZXNzZXNcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIGNhcHR1cmUgc3RhcnQgYXVkaXQgbG9nIGZvciBxdWV1ZSBwcm9jZXNzaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjcmVhdGVNb2NrQXVkaXRDb250ZXh0KHtcbiAgICAgICAgICBzdWJUeXBlOiAncXVldWVfcHJvY2Vzc2luZycsXG4gICAgICAgICAgY29ycmVsYXRpb246IGNyZWF0ZU1vY2tDb3JyZWxhdGlvbkNvbnRleHQoe1xuICAgICAgICAgICAgb3BlcmF0aW9uVHlwZTogJ3F1ZXVlJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbklkOiAnUXVldWVDb250cm9sbGVyLnByb2Nlc3NNZXNzYWdlJ1xuICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBxdWV1ZUNvbnRleHQ6IFF1ZXVlQXVkaXRDb250ZXh0ID0ge1xuICAgICAgICAgIHF1ZXVlTmFtZTogJ3VzZXItbm90aWZpY2F0aW9ucycsXG4gICAgICAgICAgYmF0Y2hTaXplOiA1LFxuICAgICAgICAgIG1lc3NhZ2VJZHM6IFsnbXNnLTEnLCAnbXNnLTInXVxuICAgICAgICB9O1xuXG4gICAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcXVldWVDb250ZXh0KTtcblxuICAgICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgICAgZW5hYmxlZDogdW5kZWZpbmVkLFxuICAgICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgICBzdWJUeXBlOiAncXVldWVfcHJvY2Vzc2luZ19zdGFydCcsXG4gICAgICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgICAgIGNvcnJlbGF0aW9uOiBhdWRpdENvbnRleHQuY29ycmVsYXRpb24sXG4gICAgICAgICAgICAgIHF1ZXVlOiBxdWV1ZUNvbnRleHRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHNraXAgd2hlbiBhdWRpdCBpcyBkaXNhYmxlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY3JlYXRlTW9ja0F1ZGl0Q29udGV4dCh7IGVuYWJsZWQ6IGZhbHNlIH0pO1xuICAgICAgICBjb25zdCByZXF1ZXN0Q29udGV4dDogUmVxdWVzdEF1ZGl0Q29udGV4dCA9IHtcbiAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgIHBhdGg6ICcvdXNlcnMvMTIzJ1xuICAgICAgICB9O1xuXG4gICAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBza2lwIHdoZW4gc2tpcFN0YXJ0IGlzIGVuYWJsZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoe1xuICAgICAgICAgIGF1ZGl0Q29uZmlnOiB7IFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHNraXBTdGFydDogdHJ1ZSBcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCByZXF1ZXN0Q29udGV4dDogUmVxdWVzdEF1ZGl0Q29udGV4dCA9IHtcbiAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgIHBhdGg6ICcvdXNlcnMvMTIzJ1xuICAgICAgICB9O1xuXG4gICAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCByZXNwZWN0IHNhbXBsaW5nIGZ1bmN0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBzYW1wbGluZ0ZuID0gamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZShmYWxzZSk7XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoe1xuICAgICAgICAgIGF1ZGl0Q29uZmlnOiB7IFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHNhbXBsaW5nRm4gXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQ6IFJlcXVlc3RBdWRpdENvbnRleHQgPSB7XG4gICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICBwYXRoOiAnL3VzZXJzLzEyMydcbiAgICAgICAgfTtcblxuICAgICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHJlcXVlc3RDb250ZXh0KTtcblxuICAgICAgICBleHBlY3Qoc2FtcGxpbmdGbikudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2NvcnItMTIzJywgJ2dldFVzZXInKTtcbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIGluY2x1ZGUgY3VzdG9tIGNvbnRleHQgaW4gbWV0YWRhdGEnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGN1c3RvbUNvbnRleHQgPSB7IGZlYXR1cmU6ICd1c2VyLW1hbmFnZW1lbnQnLCB2ZXJzaW9uOiAnMi4xJyB9O1xuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjcmVhdGVNb2NrQXVkaXRDb250ZXh0KHtcbiAgICAgICAgICBhdWRpdENvbmZpZzogeyBcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBjdXN0b21Db250ZXh0IFxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0OiBSZXF1ZXN0QXVkaXRDb250ZXh0ID0ge1xuICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcGF0aDogJy91c2Vycy8xMjMnXG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCByZXF1ZXN0Q29udGV4dCk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICBtZXRhZGF0YTogY3VzdG9tQ29udGV4dFxuICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnY2FwdHVyZUVuZCcsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgY2FwdHVyZSBzdWNjZXNzZnVsIGNvbXBsZXRpb24gYXVkaXQgbG9nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBqZXN0LnNweU9uKERhdGUsICdub3cnKS5tb2NrUmV0dXJuVmFsdWUoMTcwNTMxNDYwNTAwMCk7IC8vIDUgc2Vjb25kcyBhZnRlciBzdGFydFxuXG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoKTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0geyB1c2VyczogW3sgaWQ6ICcxMjMnLCBuYW1lOiAnSm9obicgfV0gfTtcbiAgICAgICAgY29uc3QgcmVzcG9uc2VDb250ZXh0ID0ge1xuICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICByZXNwb25zZVNpemU6IDEyMzRcbiAgICAgICAgfTtcblxuICAgICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCByZXN1bHQsIG51bGwsIHJlc3BvbnNlQ29udGV4dCk7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICBsb2dUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0X2NvbXBsZXRlJyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgICAgIGV2ZW50VHlwZTogJ2NvbXBsZXRlJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2dldFVzZXInLFxuICAgICAgICAgICAgY2F0ZWdvcnk6ICd1c2VyLW1hbmFnZW1lbnQnLFxuICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICAgICAgICBzZXZlcml0eTogJ2luZm8nLFxuICAgICAgICAgICAgY29ycmVsYXRpb25JZDogJ2NvcnItMTIzJyxcbiAgICAgICAgICAgIGFjdG9yOiBhdWRpdENvbnRleHQuYWN0b3IsXG4gICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgIGR1cmF0aW9uOiA1MDAwLFxuICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICAgIHJlc3BvbnNlU2l6ZTogMTIzNFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgICAgY29ycmVsYXRpb246IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbixcbiAgICAgICAgICAgICAgcmVzcG9uc2U6IHJlc3BvbnNlQ29udGV4dFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgZXJyb3I6IG51bGwgLy8gY2FwdHVyZUVuZCBhbHdheXMgaW5jbHVkZXMgZXJyb3IgZmllbGRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIGNhcHR1cmUgZXJyb3IgYXVkaXQgbG9nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBqZXN0LnNweU9uKERhdGUsICdub3cnKS5tb2NrUmV0dXJuVmFsdWUoMTcwNTMxNDYwMjAwMCk7IC8vIDIgc2Vjb25kcyBhZnRlciBzdGFydFxuXG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoKTtcbiAgICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ1VzZXIgbm90IGZvdW5kJyk7XG4gICAgICAgIGVycm9yLnN0YWNrID0gJ0Vycm9yOiBVc2VyIG5vdCBmb3VuZFxcbiAgICBhdCBnZXRVc2VyQnlJZC4uLic7XG5cbiAgICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgbnVsbCwgZXJyb3IpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgICBlbmFibGVkOiB1bmRlZmluZWQsXG4gICAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgICAgbG9nVHlwZTogJ2F1ZGl0JyxcbiAgICAgICAgICAgIHN1YlR5cGU6ICdhcGlfcmVxdWVzdF9lcnJvcicsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgICAgICBldmVudFR5cGU6ICdlcnJvcicsXG4gICAgICAgICAgICBvcGVyYXRpb246ICdnZXRVc2VyJyxcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJyxcbiAgICAgICAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICAgICAgYWN0b3I6IGF1ZGl0Q29udGV4dC5hY3RvcixcbiAgICAgICAgICAgIGNhdGVnb3J5OiAndXNlci1tYW5hZ2VtZW50JyxcbiAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgZHVyYXRpb246IDIwMDBcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgICAgIGNvcnJlbGF0aW9uOiBhdWRpdENvbnRleHQuY29ycmVsYXRpb25cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIGVycm9yOiBleHBlY3QuYW55KE9iamVjdCkgLy8gRGF0YSBwcm90ZWN0aW9uIHNhbml0aXplcyBlcnJvciBvYmplY3RzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBza2lwIHdoZW4gYXVkaXQgaXMgZGlzYWJsZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoeyBlbmFibGVkOiBmYWxzZSB9KTtcblxuICAgICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCBudWxsLCBudWxsKTtcblxuICAgICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgc2tpcCBlcnJvciBhdWRpdCB3aGVuIHNraXBFcnJvcnMgaXMgZW5hYmxlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY3JlYXRlTW9ja0F1ZGl0Q29udGV4dCh7XG4gICAgICAgICAgYXVkaXRDb25maWc6IHsgXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgc2tpcEVycm9yczogdHJ1ZSBcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignVGVzdCBlcnJvcicpO1xuXG4gICAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIG51bGwsIGVycm9yKTtcblxuICAgICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgc2tpcCBzdWNjZXNzIGF1ZGl0IHdoZW4gc2tpcEVuZCBpcyBlbmFibGVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjcmVhdGVNb2NrQXVkaXRDb250ZXh0KHtcbiAgICAgICAgICBhdWRpdENvbmZpZzogeyBcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBza2lwRW5kOiB0cnVlIFxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgeyBzdWNjZXNzOiB0cnVlIH0sIG51bGwpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCByZXNwZWN0IHNhbXBsaW5nIGZ1bmN0aW9uIGZvciBlbmQgZXZlbnRzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBzYW1wbGluZ0ZuID0gamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZShmYWxzZSk7XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoe1xuICAgICAgICAgIGF1ZGl0Q29uZmlnOiB7IFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHNhbXBsaW5nRm4gXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCBudWxsLCBudWxsKTtcblxuICAgICAgICBleHBlY3Qoc2FtcGxpbmdGbikudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2NvcnItMTIzJywgJ2dldFVzZXInKTtcbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ0ludGVncmF0aW9uIHdpdGggcmVhbCBzYW1wbGluZyBmdW5jdGlvbnMnLCAoKSA9PiB7XG4gICAgICBpdCgnc2hvdWxkIHdvcmsgd2l0aCBoYXNoLWJhc2VkIHNhbXBsaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBoYXNoU2FtcGxpbmcgPSBjcmVhdGVIYXNoQmFzZWRTYW1wbGluZygwLjUpOyAvLyA1MCUgc2FtcGxpbmcgcmF0ZVxuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjcmVhdGVNb2NrQXVkaXRDb250ZXh0KHtcbiAgICAgICAgICBhdWRpdENvbmZpZzogeyBcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBzYW1wbGluZ0ZuOiBoYXNoU2FtcGxpbmcgXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQ6IFJlcXVlc3RBdWRpdENvbnRleHQgPSB7XG4gICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICBwYXRoOiAnL3VzZXJzLzEyMydcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBIYXNoLWJhc2VkIHNhbXBsaW5nIHNob3VsZCBiZSBkZXRlcm1pbmlzdGljIGZvciB0aGUgc2FtZSBpbnB1dFxuICAgICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHJlcXVlc3RDb250ZXh0KTtcbiAgICAgICAgY29uc3QgZmlyc3RDYWxsQ291bnQgPSBtb2NrQXVkaXRMb2dnZXIuYXVkaXQubW9jay5jYWxscy5sZW5ndGg7XG4gICAgICAgIFxuICAgICAgICBtb2NrQXVkaXRMb2dnZXIuYXVkaXQubW9ja0NsZWFyKCk7XG4gICAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQpO1xuICAgICAgICBjb25zdCBzZWNvbmRDYWxsQ291bnQgPSBtb2NrQXVkaXRMb2dnZXIuYXVkaXQubW9jay5jYWxscy5sZW5ndGg7XG5cbiAgICAgICAgLy8gU2hvdWxkIGJlIGNvbnNpc3RlbnQgLSBlaXRoZXIgYWx3YXlzIGNhbGxlZCBvciBuZXZlciBjYWxsZWRcbiAgICAgICAgZXhwZWN0KGZpcnN0Q2FsbENvdW50KS50b0JlKHNlY29uZENhbGxDb3VudCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG59KTsiXX0=