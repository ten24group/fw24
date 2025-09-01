"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_gateway_controller_1 = require("./api-gateway-controller");
const sqs_controller_1 = require("./sqs-controller");
const task_controller_1 = require("./task-controller");
const sampling_1 = require("../../audit/helpers/sampling");
// Mock the audit logger factory to capture actual audit logs
jest.mock('../../audit/loggers/factory', () => {
    const mockAuditLogger = {
        audit: jest.fn().mockResolvedValue(undefined)
    };
    const mockFactoryInstance = {
        create: jest.fn().mockReturnValue(mockAuditLogger)
    };
    return {
        AuditLoggerFactory: {
            getInstance: jest.fn().mockReturnValue(mockFactoryInstance)
        }
    };
});
// Get references to the mocked objects for test assertions
const { AuditLoggerFactory } = require('../../audit/loggers/factory');
const mockFactoryInstance = AuditLoggerFactory.getInstance();
const mockAuditLogger = mockFactoryInstance.create();
// Mock Reflect for decorator metadata
const mockReflectGet = jest.fn();
global.Reflect = {
    ...global.Reflect,
    get: mockReflectGet
};
// Mock Date.now for predictable timestamps
const mockDateNow = jest.spyOn(Date, 'now').mockImplementation(() => 1705314600000);
describe('Controller Audit Integration', () => {
    // Mock console.error to avoid noise in test output
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    beforeEach(() => {
        // Clear mocks but preserve spy setup
        mockFactoryInstance.create.mockClear();
        mockAuditLogger.audit.mockClear();
        consoleErrorSpy.mockClear();
        mockDateNow.mockReturnValue(1705314600000);
    });
    afterAll(() => {
        consoleErrorSpy.mockRestore();
    });
    // Helper to create mock SQS event
    function createMockSQSEvent() {
        return {
            Records: [
                {
                    messageId: 'msg-1',
                    receiptHandle: 'receipt-1',
                    body: JSON.stringify({
                        correlationId: 'parent-corr-123',
                        parentOperationId: 'APIController.createUser'
                    }),
                    attributes: {
                        ApproximateReceiveCount: '1',
                        SentTimestamp: '1705314600000',
                        SenderId: 'sender-1',
                        ApproximateFirstReceiveTimestamp: '1705314600000'
                    },
                    messageAttributes: {},
                    md5OfBody: 'md5-1',
                    eventSource: 'aws:sqs',
                    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
                    awsRegion: 'us-east-1'
                }
            ]
        };
    }
    // Helper to create mock Lambda context
    function createMockLambdaContext() {
        return {
            callbackWaitsForEmptyEventLoop: true,
            functionName: 'test-queue-processor',
            functionVersion: '1',
            invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-queue-processor',
            memoryLimitInMB: '128',
            awsRequestId: 'lambda-req-456',
            logGroupName: '/aws/lambda/test-queue-processor',
            logStreamName: '2024/01/15/[$LATEST]abc123',
            getRemainingTimeInMillis: () => 30000,
            done: () => { },
            fail: () => { },
            succeed: () => { }
        };
    }
    // Helper to create mock execution context
    function createMockExecutionContext(overrides = {}) {
        const mockActor = {
            requestId: 'req-123',
            timestamp: '2024-01-15T10:30:00.000Z',
            actorId: 'user-456',
            actorType: 'user',
            authMethod: 'cognito',
            tenantId: 'tenant-abc'
        };
        return {
            event: {
                httpMethod: 'GET',
                path: '/users/123',
                headers: {
                    'user-agent': 'Mozilla/5.0',
                    'X-Forwarded-For': '192.168.1.1'
                },
                requestContext: {
                    identity: {
                        sourceIp: '192.168.1.1'
                    }
                }
            },
            lambdaContext: {
                awsRequestId: 'aws-req-123',
                functionName: 'user-api'
            },
            request: {
                requestId: 'req-123',
                httpMethod: 'GET',
                path: '/users/123',
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'X-Forwarded-For': '192.168.1.1'
                }
            },
            response: {},
            actor: mockActor,
            ...overrides
        };
    }
    describe('APIController Audit Integration', () => {
        class TestAPIController extends api_gateway_controller_1.APIController {
            constructor() {
                super();
            }
            // Expose protected methods for testing
            testMakeAuditContext(ctx) {
                return this.makeAuditContext(ctx);
            }
            async testCaptureStart(auditContext, requestContext) {
                return this.captureStart(auditContext, requestContext);
            }
            async testCaptureEnd(auditContext, response, error) {
                return this.captureEnd(auditContext, response, error);
            }
            testBuildRequestContext(ctx, auditConfig) {
                return this.buildRequestContext(ctx, auditConfig);
            }
        }
        let controller;
        beforeEach(() => {
            controller = new TestAPIController();
        });
        describe('makeAuditContext', () => {
            it('should create audit context with proper correlation ID and operation ID', () => {
                const ctx = createMockExecutionContext();
                mockReflectGet.mockReturnValue({ audit: { enabled: true, category: 'user-management' } });
                const auditContext = controller.testMakeAuditContext(ctx);
                expect(auditContext).toMatchObject({
                    enabled: true,
                    logType: 'log',
                    subType: 'api_request',
                    entityName: 'TestAPIController',
                    operation: 'get_/users/123',
                    category: 'user-management',
                    actor: ctx.actor,
                    correlation: {
                        correlationId: 'req-123',
                        operationId: 'TestAPIController.get_/users/123',
                        operationType: 'api',
                        operationName: 'get_/users/123',
                        startTimestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
                    }
                });
            });
            it('should return null when audit is disabled', () => {
                const ctx = createMockExecutionContext();
                mockReflectGet.mockReturnValue({ audit: { enabled: false } });
                const auditContext = controller.testMakeAuditContext(ctx);
                expect(auditContext).toBeNull();
            });
            it('should use default config when no audit config is present', () => {
                const ctx = createMockExecutionContext();
                mockReflectGet.mockReturnValue({ audit: { enabled: true } });
                const auditContext = controller.testMakeAuditContext(ctx);
                expect(auditContext).toMatchObject({
                    enabled: true,
                    logType: 'log',
                    subType: 'api_request',
                    entityName: 'TestAPIController',
                    auditConfig: {
                        enabled: true
                    }
                });
            });
            it('should include custom sampling function', () => {
                const ctx = createMockExecutionContext();
                const samplingFn = (0, sampling_1.createHashBasedSampling)(0.1);
                mockReflectGet.mockReturnValue({
                    audit: {
                        enabled: true,
                        samplingFn,
                        customContext: { feature: 'user-api', version: '1.2' }
                    }
                });
                const auditContext = controller.testMakeAuditContext(ctx);
                expect(auditContext?.auditConfig.samplingFn).toBe(samplingFn);
                expect(auditContext?.auditConfig.customContext).toEqual({ feature: 'user-api', version: '1.2' });
            });
        });
        describe('buildRequestContext', () => {
            it('should build minimal request context by default', () => {
                const ctx = createMockExecutionContext();
                const auditConfig = { enabled: true };
                const requestContext = controller.testBuildRequestContext(ctx, auditConfig);
                expect(requestContext).toEqual({
                    method: 'GET',
                    path: '/users/123',
                    userAgent: 'Mozilla/5.0',
                    sourceIp: '192.168.1.1',
                    headers: undefined,
                    body: undefined,
                    query: undefined
                });
            });
            it('should include headers when configured', () => {
                const ctx = createMockExecutionContext();
                const auditConfig = {
                    enabled: true,
                    includes: { request: ['headers'] }
                };
                const requestContext = controller.testBuildRequestContext(ctx, auditConfig);
                expect(requestContext).toEqual({
                    method: 'GET',
                    path: '/users/123',
                    userAgent: 'Mozilla/5.0',
                    sourceIp: '192.168.1.1',
                    headers: ctx.request.headers,
                    body: undefined,
                    query: undefined
                });
            });
            it('should include multiple request parts when configured', () => {
                const baseCtx = createMockExecutionContext();
                const ctx = createMockExecutionContext({
                    request: {
                        ...baseCtx.request,
                        body: { userId: '123' },
                        queryStringParameters: { include: 'profile' }
                    }
                });
                const auditConfig = {
                    enabled: true,
                    includes: { request: ['headers', 'body', 'query'] }
                };
                const requestContext = controller.testBuildRequestContext(ctx, auditConfig);
                expect(requestContext).toEqual({
                    method: 'GET',
                    path: '/users/123',
                    userAgent: 'Mozilla/5.0',
                    sourceIp: '192.168.1.1',
                    headers: ctx.request.headers,
                    body: { userId: '123' },
                    query: { include: 'profile' }
                });
            });
        });
        describe('End-to-End Audit Integration', () => {
            it('should capture start audit log with real audit logger', async () => {
                const ctx = createMockExecutionContext();
                const auditContext = {
                    enabled: true,
                    logType: 'audit',
                    subType: 'api_request',
                    entityName: 'TestAPIController',
                    operation: 'getUser',
                    category: 'user-management',
                    actor: ctx.actor,
                    correlation: {
                        correlationId: 'corr-123',
                        operationId: 'TestAPIController.getUser',
                        operationType: 'api',
                        operationName: 'getUser',
                        startTimestamp: '2024-01-15T10:30:00.000Z'
                    },
                    auditConfig: {
                        enabled: true,
                        dataProtection: {
                            enabled: true,
                            fastRedact: {
                                paths: ['*.password', '*.secret']
                            }
                        }
                    }
                };
                const requestContext = {
                    method: 'GET',
                    path: '/users/123',
                    userAgent: 'Mozilla/5.0',
                    sourceIp: '192.168.1.1'
                };
                await controller.testCaptureStart(auditContext, requestContext);
                // Verify the factory was called to create a logger
                expect(mockFactoryInstance.create).toHaveBeenCalled();
                // Verify the real audit entry structure
                expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                    enabled: undefined,
                    auditEntry: expect.objectContaining({
                        logType: 'audit',
                        subType: 'api_request_start',
                        entityName: 'TestAPIController',
                        eventType: 'start',
                        operation: 'getUser',
                        category: 'user-management',
                        severity: 'info',
                        correlationId: 'corr-123',
                        actor: ctx.actor,
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
            it('should capture end audit log with response context', async () => {
                const auditContext = {
                    enabled: true,
                    logType: 'audit',
                    subType: 'api_request',
                    entityName: 'TestAPIController',
                    operation: 'getUser',
                    category: 'user-management',
                    correlation: {
                        correlationId: 'corr-123',
                        operationId: 'TestAPIController.getUser',
                        operationType: 'api',
                        operationName: 'getUser',
                        startTimestamp: '2024-01-15T10:30:00.000Z'
                    },
                    auditConfig: {
                        enabled: true,
                        dataProtection: {
                            enabled: true,
                            fastRedact: {
                                paths: ['*.password', '*.secret']
                            }
                        }
                    }
                };
                const response = {
                    statusCode: 200,
                    body: JSON.stringify({ users: [{ id: '123' }] })
                };
                await controller.testCaptureEnd(auditContext, response, null);
                expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                    enabled: undefined,
                    auditEntry: expect.objectContaining({
                        logType: 'audit',
                        subType: 'api_request_complete',
                        entityName: 'TestAPIController',
                        eventType: 'complete',
                        operation: 'getUser',
                        success: true,
                        status: 'completed',
                        correlationId: 'corr-123',
                        metrics: expect.objectContaining({
                            duration: expect.any(Number),
                            statusCode: 200,
                            responseSize: expect.any(Number)
                        })
                    })
                });
            });
            it('should capture error audit log when request fails', async () => {
                const auditContext = {
                    enabled: true,
                    logType: 'audit',
                    subType: 'api_request',
                    entityName: 'TestAPIController',
                    operation: 'getUser',
                    correlation: {
                        correlationId: 'corr-123',
                        operationId: 'TestAPIController.getUser',
                        operationType: 'api',
                        operationName: 'getUser',
                        startTimestamp: '2024-01-15T10:30:00.000Z'
                    },
                    auditConfig: {
                        enabled: true,
                        dataProtection: {
                            enabled: true,
                            fastRedact: {
                                paths: ['*.password', '*.secret']
                            }
                        }
                    }
                };
                const error = new Error('User not found');
                error.stack = 'Error: User not found\n    at getUserById...';
                const mockResponse = { statusCode: 500, body: '' };
                await controller.testCaptureEnd(auditContext, mockResponse, error);
                expect(mockAuditLogger.audit).toHaveBeenCalledWith({
                    enabled: undefined,
                    auditEntry: expect.objectContaining({
                        logType: 'audit',
                        subType: 'api_request_error',
                        entityName: 'TestAPIController',
                        eventType: 'error',
                        operation: 'getUser',
                        success: false,
                        status: 'failed',
                        severity: 'info',
                        correlationId: 'corr-123',
                        data: {
                            error: expect.any(Object) // Data protection sanitizes error objects
                        }
                    })
                });
            });
            it('should handle audit logger failures gracefully', async () => {
                mockAuditLogger.audit.mockRejectedValueOnce(new Error('Audit logger failed'));
                const auditContext = {
                    enabled: true,
                    logType: 'audit',
                    subType: 'api_request',
                    entityName: 'TestAPIController',
                    operation: 'getUser',
                    correlation: {
                        correlationId: 'corr-123',
                        operationId: 'TestAPIController.getUser',
                        operationType: 'api',
                        operationName: 'getUser',
                        startTimestamp: '2024-01-15T10:30:00.000Z'
                    },
                    auditConfig: {
                        enabled: true,
                        dataProtection: {
                            enabled: true,
                            fastRedact: {
                                paths: ['*.password', '*.secret']
                            }
                        }
                    }
                };
                const requestContext = {
                    method: 'GET',
                    path: '/users/123',
                    userAgent: 'Mozilla/5.0',
                    sourceIp: '192.168.1.1'
                };
                // Should not throw
                await expect(controller.testCaptureStart(auditContext, requestContext)).resolves.toBeUndefined();
                // Should still attempt to audit
                expect(mockAuditLogger.audit).toHaveBeenCalled();
                // Should log the error to console
                expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to capture audit log:', expect.any(Error), expect.any(Object));
            });
        });
    });
    describe('QueueController Audit Integration', () => {
        class TestQueueController extends sqs_controller_1.QueueController {
            constructor() {
                super();
            }
            // Expose protected methods for testing
            testMakeAuditContext(event, context) {
                return this.makeAuditContext(event, context);
            }
            testExtractCorrelationFromMessages(event) {
                return this.extractCorrelationFromMessages(event);
            }
            testExtractParentOperationFromMessages(event) {
                return this.extractParentOperationFromMessages(event);
            }
            async initialize() {
                // Test implementation
            }
            async process() {
                // Test implementation
            }
            async processRecord() {
                return { processed: true };
            }
            // Override for testing
            getQueueName() {
                const config = this.getQueueConfig();
                return config.queueName;
            }
        }
        let controller;
        beforeEach(() => {
            controller = new TestQueueController();
        });
        describe('makeAuditContext', () => {
            it('should create audit context for queue processing', () => {
                const event = createMockSQSEvent();
                const context = createMockLambdaContext();
                mockReflectGet.mockReturnValue({ audit: { enabled: true, category: 'queue-processing' }, queueName: 'user-notifications' });
                const auditContext = controller.testMakeAuditContext(event, context);
                expect(auditContext).toMatchObject({
                    enabled: true,
                    logType: 'event',
                    subType: 'queue_processing',
                    entityName: 'TestQueueController',
                    operation: 'user-notifications',
                    category: 'queue-processing',
                    correlation: {
                        correlationId: 'parent-corr-123',
                        operationId: 'TestQueueController.user-notifications',
                        parentOperationId: 'APIController.createUser',
                        operationType: 'queue',
                        operationName: 'user-notifications'
                    }
                });
            });
            it('should generate new correlation ID when not found in messages', () => {
                const event = {
                    Records: [{
                            ...createMockSQSEvent().Records[0],
                            body: JSON.stringify({ data: 'no correlation' })
                        }]
                };
                const context = createMockLambdaContext();
                mockReflectGet.mockReturnValue({ audit: { enabled: true } });
                const auditContext = controller.testMakeAuditContext(event, context);
                expect(auditContext?.correlation.correlationId).toBe('lambda-req-456');
                expect(auditContext?.correlation.parentOperationId).toBeUndefined();
            });
            it('should return null when audit is disabled', () => {
                const event = createMockSQSEvent();
                const context = createMockLambdaContext();
                mockReflectGet.mockReturnValue({ audit: { enabled: false } });
                const auditContext = controller.testMakeAuditContext(event, context);
                expect(auditContext).toBeNull();
            });
        });
        describe('correlation extraction', () => {
            it('should extract correlation ID from message bodies', () => {
                const event = createMockSQSEvent();
                const correlationId = controller.testExtractCorrelationFromMessages(event);
                expect(correlationId).toBe('parent-corr-123');
            });
            it('should extract parent operation ID from message bodies', () => {
                const event = createMockSQSEvent();
                const parentOperationId = controller.testExtractParentOperationFromMessages(event);
                expect(parentOperationId).toBe('APIController.createUser');
            });
            it('should return null for invalid JSON in message body', () => {
                const event = {
                    Records: [{
                            ...createMockSQSEvent().Records[0],
                            body: 'invalid json{'
                        }]
                };
                const correlationId = controller.testExtractCorrelationFromMessages(event);
                const parentOperationId = controller.testExtractParentOperationFromMessages(event);
                expect(correlationId).toBeNull();
                expect(parentOperationId).toBeNull();
            });
        });
    });
    describe('TaskController Audit Integration', () => {
        class TestTaskController extends task_controller_1.TaskController {
            constructor() {
                super();
            }
            // Expose protected methods for testing
            testMakeAuditContext() {
                return this.makeAuditContext();
            }
            async initialize() {
                // Test implementation
            }
            async process() {
                // Test implementation
            }
            async execute() {
                return { taskCompleted: true };
            }
            // Override for testing
            getTaskName() {
                const config = this.getTaskConfig();
                return config.taskName;
            }
        }
        let controller;
        beforeEach(() => {
            controller = new TestTaskController();
        });
        describe('makeAuditContext', () => {
            it('should create audit context for scheduled task', () => {
                mockReflectGet.mockReturnValue({
                    audit: { enabled: true, category: 'data-processing' },
                    taskName: 'daily-report',
                    schedule: 'cron(0 9 * * ? *)'
                });
                const auditContext = controller.testMakeAuditContext();
                expect(auditContext).toMatchObject({
                    enabled: true,
                    logType: 'event',
                    subType: 'task_execution',
                    entityName: 'TestTaskController',
                    operation: 'daily-report',
                    category: 'data-processing',
                    actor: {
                        actorId: 'scheduler',
                        actorType: 'service',
                        authMethod: 'system'
                    },
                    correlation: {
                        correlationId: expect.stringMatching(/^TestTaskController\.daily-report-\d+$/),
                        operationId: 'TestTaskController.daily-report',
                        operationType: 'task',
                        operationName: 'daily-report'
                    }
                });
            });
            it('should return null when audit is disabled', () => {
                mockReflectGet.mockReturnValue({ audit: { enabled: false } });
                const auditContext = controller.testMakeAuditContext();
                expect(auditContext).toBeNull();
            });
            it('should handle missing task configuration gracefully', () => {
                mockReflectGet.mockReturnValue({ audit: { enabled: true } });
                const auditContext = controller.testMakeAuditContext();
                expect(auditContext).toMatchObject({
                    enabled: true,
                    logType: 'event',
                    subType: 'task_execution',
                    entityName: 'TestTaskController',
                    operation: 'execute' // Default operation name
                });
            });
        });
    });
    describe('Cross-Controller Integration Scenarios', () => {
        it('should maintain correlation across API -> Queue workflow', async () => {
            // Simulate API request creating a queue message
            const apiController = new (class extends api_gateway_controller_1.APIController {
                testMakeAuditContext(ctx) {
                    return this.makeAuditContext(ctx);
                }
            })();
            const queueController = new (class extends sqs_controller_1.QueueController {
                testMakeAuditContext(event, context) {
                    return this.makeAuditContext(event, context);
                }
                async initialize() { }
                async process() { }
                async processRecord() { return {}; }
            })();
            // API request
            const ctx = createMockExecutionContext();
            mockReflectGet.mockReturnValue({ audit: { enabled: true } });
            const apiAuditContext = apiController.testMakeAuditContext(ctx);
            expect(apiAuditContext?.correlation.operationType).toBe('api');
            expect(apiAuditContext?.correlation.correlationId).toBe('req-123');
            // Queue processing with correlation from API
            const queueEvent = {
                Records: [{
                        ...createMockSQSEvent().Records[0],
                        body: JSON.stringify({
                            correlationId: apiAuditContext?.correlation.correlationId,
                            parentOperationId: apiAuditContext?.correlation.operationId
                        })
                    }]
            };
            const queueAuditContext = queueController.testMakeAuditContext(queueEvent, createMockLambdaContext());
            expect(queueAuditContext?.correlation.correlationId).toBe(apiAuditContext?.correlation.correlationId);
            expect(queueAuditContext?.correlation.parentOperationId).toBe(apiAuditContext?.correlation.operationId);
            expect(queueAuditContext?.correlation.operationType).toBe('queue');
        });
        it('should handle different audit configurations across controllers', () => {
            const apiController = new (class extends api_gateway_controller_1.APIController {
                testMakeAuditContext(ctx) {
                    return this.makeAuditContext(ctx);
                }
            })();
            const taskController = new (class extends task_controller_1.TaskController {
                testMakeAuditContext() {
                    return this.makeAuditContext();
                }
                async initialize() { }
                async process() { }
                async execute() { return {}; }
            })();
            // API with detailed audit config
            mockReflectGet.mockReturnValueOnce({
                audit: {
                    enabled: true,
                    skipStart: false,
                    skipEnd: true,
                    samplingFn: (0, sampling_1.createHashBasedSampling)(0.1),
                    includes: { request: ['headers', 'body'], response: true }
                }
            });
            const apiAuditContext = apiController.testMakeAuditContext(createMockExecutionContext());
            // Task with minimal audit config
            mockReflectGet.mockReturnValueOnce({
                audit: {
                    enabled: true,
                    skipStart: true,
                    skipEnd: false,
                    category: 'background-jobs'
                }
            });
            const taskAuditContext = taskController.testMakeAuditContext();
            expect(apiAuditContext?.auditConfig.skipEnd).toBe(true);
            expect(apiAuditContext?.auditConfig.includes).toBeDefined();
            expect(taskAuditContext?.auditConfig.skipStart).toBe(true);
            expect(taskAuditContext?.category).toBe('background-jobs');
        });
        it('should respect sampling configuration in real audit integration', async () => {
            const samplingFn = (0, sampling_1.createHashBasedSampling)(0.0); // 0% sampling - should skip all
            const apiController = new (class extends api_gateway_controller_1.APIController {
                testMakeAuditContext(ctx) {
                    return this.makeAuditContext(ctx);
                }
                async testCaptureStart(auditContext, requestContext) {
                    return this.captureStart(auditContext, requestContext);
                }
            })();
            const ctx = createMockExecutionContext();
            mockReflectGet.mockReturnValue({
                audit: {
                    enabled: true,
                    samplingFn
                }
            });
            const auditContext = apiController.testMakeAuditContext(ctx);
            const requestContext = {
                method: 'GET',
                path: '/users/123',
                userAgent: 'Mozilla/5.0',
                sourceIp: '192.168.1.1'
            };
            await apiController.testCaptureStart(auditContext, requestContext);
            // Should not have called the audit logger due to 0% sampling
            expect(mockAuditLogger.audit).not.toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJvbGxlci1hdWRpdC1pbnRlZ3JhdGlvbi50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9jb250cm9sbGVyLWF1ZGl0LWludGVncmF0aW9uLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxRUFBeUQ7QUFDekQscURBQW1EO0FBQ25ELHVEQUFtRDtBQUduRCwyREFBdUU7QUFFdkUsNkRBQTZEO0FBQzdELElBQUksQ0FBQyxJQUFJLENBQUMsNkJBQTZCLEVBQUUsR0FBRyxFQUFFO0lBQzVDLE1BQU0sZUFBZSxHQUFHO1FBQ3RCLEtBQUssRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsU0FBUyxDQUFDO0tBQzlDLENBQUM7SUFFRixNQUFNLG1CQUFtQixHQUFHO1FBQzFCLE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsZUFBZSxDQUFDLGVBQWUsQ0FBQztLQUNuRCxDQUFDO0lBRUYsT0FBTztRQUNMLGtCQUFrQixFQUFFO1lBQ2xCLFdBQVcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsZUFBZSxDQUFDLG1CQUFtQixDQUFDO1NBQzVEO0tBQ0YsQ0FBQztBQUNKLENBQUMsQ0FBQyxDQUFDO0FBRUgsMkRBQTJEO0FBQzNELE1BQU0sRUFBRSxrQkFBa0IsRUFBRSxHQUFHLE9BQU8sQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDO0FBQ3RFLE1BQU0sbUJBQW1CLEdBQUcsa0JBQWtCLENBQUMsV0FBVyxFQUFFLENBQUM7QUFDN0QsTUFBTSxlQUFlLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxFQUFFLENBQUM7QUFFckQsc0NBQXNDO0FBQ3RDLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQztBQUNqQyxNQUFNLENBQUMsT0FBTyxHQUFHO0lBQ2YsR0FBRyxNQUFNLENBQUMsT0FBTztJQUNqQixHQUFHLEVB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LENBQUM7Z0JBQ3pELENBQUM7YUFDRixDQUFDLEVBQUUsQ0FBQztZQUVMLE1BQU0sR0FBRyxHQUFHLDBCQUEwQixFQUFFLENBQUM7WUFDekMsY0FBYyxDQUFDLGVBQWUsQ0FBQztnQkFDN0IsS0FBSyxFQUFFO29CQUNMLE9BQU8sRUFBRSxJQUFJO29CQUNiLFVBQVU7aUJBQ1g7YUFDRixDQUFDLENBQUM7WUFFSCxNQUFNLFlBQVksR0FBRyxhQUFhLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDN0QsTUFBTSxjQUFjLEdBQUc7Z0JBQ3JCLE1BQU0sRUFBRSxLQUFLO2dCQUNiLElBQUksRUFBRSxZQUFZO2dCQUNsQixTQUFTLEVBQUUsYUFBYTtnQkFDeEIsUUFBUSxFQUFFLGFBQWE7YUFDeEIsQ0FBQztZQUVGLE1BQU0sYUFBYSxDQUFDLGdCQUFnQixDQUFDLFlBQVksRUFBRSxjQUFjLENBQUMsQ0FBQztZQUVuRSw2REFBNkQ7WUFDN0QsTUFBTSxDQUFDLGVBQWUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztRQUN2RCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElDb250cm9sbGVyIH0gZnJvbSAnLi9hcGktZ2F0ZXdheS1jb250cm9sbGVyJztcbmltcG9ydCB7IFF1ZXVlQ29udHJvbGxlciB9IGZyb20gJy4vc3FzLWNvbnRyb2xsZXInO1xuaW1wb3J0IHsgVGFza0NvbnRyb2xsZXIgfSBmcm9tICcuL3Rhc2stY29udHJvbGxlcic7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0LCBBY3RvciB9IGZyb20gJy4uL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IFNRU0V2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoQmFzZWRTYW1wbGluZyB9IGZyb20gJy4uLy4uL2F1ZGl0L2hlbHBlcnMvc2FtcGxpbmcnO1xuXG4vLyBNb2NrIHRoZSBhdWRpdCBsb2dnZXIgZmFjdG9yeSB0byBjYXB0dXJlIGFjdHVhbCBhdWRpdCBsb2dzXG5qZXN0Lm1vY2soJy4uLy4uL2F1ZGl0L2xvZ2dlcnMvZmFjdG9yeScsICgpID0+IHtcbiAgY29uc3QgbW9ja0F1ZGl0TG9nZ2VyID0ge1xuICAgIGF1ZGl0OiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUodW5kZWZpbmVkKVxuICB9O1xuXG4gIGNvbnN0IG1vY2tGYWN0b3J5SW5zdGFuY2UgPSB7XG4gICAgY3JlYXRlOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKG1vY2tBdWRpdExvZ2dlcilcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIEF1ZGl0TG9nZ2VyRmFjdG9yeToge1xuICAgICAgZ2V0SW5zdGFuY2U6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUobW9ja0ZhY3RvcnlJbnN0YW5jZSlcbiAgICB9XG4gIH07XG59KTtcblxuLy8gR2V0IHJlZmVyZW5jZXMgdG8gdGhlIG1vY2tlZCBvYmplY3RzIGZvciB0ZXN0IGFzc2VydGlvbnNcbmNvbnN0IHsgQXVkaXRMb2dnZXJGYWN0b3J5IH0gPSByZXF1aXJlKCcuLi8uLi9hdWRpdC9sb2dnZXJzL2ZhY3RvcnknKTtcbmNvbnN0IG1vY2tGYWN0b3J5SW5zdGFuY2UgPSBBdWRpdExvZ2dlckZhY3RvcnkuZ2V0SW5zdGFuY2UoKTtcbmNvbnN0IG1vY2tBdWRpdExvZ2dlciA9IG1vY2tGYWN0b3J5SW5zdGFuY2UuY3JlYXRlKCk7XG5cbi8vIE1vY2sgUmVmbGVjdCBmb3IgZGVjb3JhdG9yIG1ldGFkYXRhXG5jb25zdCBtb2NrUmVmbGVjdEdldCA9IGplc3QuZm4oKTtcbmdsb2JhbC5SZWZsZWN0ID0ge1xuICAuLi5nbG9iYWwuUmVmbGVjdCxcbiAgZ2V0OiBtb2NrUmVmbGVjdEdldFxufTtcblxuLy8gTW9jayBEYXRlLm5vdyBmb3IgcHJlZGljdGFibGUgdGltZXN0YW1wc1xuY29uc3QgbW9ja0RhdGVOb3cgPSBqZXN0LnNweU9uKERhdGUsICdub3cnKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4gMTcwNTMxNDYwMDAwMCk7XG5cbmRlc2NyaWJlKCdDb250cm9sbGVyIEF1ZGl0IEludGVncmF0aW9uJywgKCkgPT4ge1xuICAvLyBNb2NrIGNvbnNvbGUuZXJyb3IgdG8gYXZvaWQgbm9pc2UgaW4gdGVzdCBvdXRwdXRcbiAgY29uc3QgY29uc29sZUVycm9yU3B5ID0gamVzdC5zcHlPbihjb25zb2xlLCAnZXJyb3InKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4ge30pO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIC8vIENsZWFyIG1vY2tzIGJ1dCBwcmVzZXJ2ZSBzcHkgc2V0dXBcbiAgICBtb2NrRmFjdG9yeUluc3RhbmNlLmNyZWF0ZS5tb2NrQ2xlYXIoKTtcbiAgICBtb2NrQXVkaXRMb2dnZXIuYXVkaXQubW9ja0NsZWFyKCk7XG4gICAgY29uc29sZUVycm9yU3B5Lm1vY2tDbGVhcigpO1xuICAgIG1vY2tEYXRlTm93Lm1vY2tSZXR1cm5WYWx1ZSgxNzA1MzE0NjAwMDAwKTtcbiAgfSk7XG5cbiAgYWZ0ZXJBbGwoKCkgPT4ge1xuICAgIGNvbnNvbGVFcnJvclNweS5tb2NrUmVzdG9yZSgpO1xuICB9KTtcblxuICAvLyBIZWxwZXIgdG8gY3JlYXRlIG1vY2sgU1FTIGV2ZW50XG4gIGZ1bmN0aW9uIGNyZWF0ZU1vY2tTUVNFdmVudCgpOiBTUVNFdmVudCB7XG4gICAgcmV0dXJuIHtcbiAgICAgIFJlY29yZHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIG1lc3NhZ2VJZDogJ21zZy0xJyxcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAncmVjZWlwdC0xJyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAncGFyZW50LWNvcnItMTIzJyxcbiAgICAgICAgICAgIHBhcmVudE9wZXJhdGlvbklkOiAnQVBJQ29udHJvbGxlci5jcmVhdGVVc2VyJ1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXG4gICAgICAgICAgICBTZW50VGltZXN0YW1wOiAnMTcwNTMxNDYwMDAwMCcsXG4gICAgICAgICAgICBTZW5kZXJJZDogJ3NlbmRlci0xJyxcbiAgICAgICAgICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTcwNTMxNDYwMDAwMCdcbiAgICAgICAgICB9LFxuICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcbiAgICAgICAgICBtZDVPZkJvZHk6ICdtZDUtMScsXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcbiAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXG4gICAgICAgICAgYXdzUmVnaW9uOiAndXMtZWFzdC0xJ1xuICAgICAgICB9XG4gICAgICBdXG4gICAgfTtcbiAgfVxuXG4gIC8vIEhlbHBlciB0byBjcmVhdGUgbW9jayBMYW1iZGEgY29udGV4dFxuICBmdW5jdGlvbiBjcmVhdGVNb2NrTGFtYmRhQ29udGV4dCgpOiBDb250ZXh0IHtcbiAgICByZXR1cm4ge1xuICAgICAgY2FsbGJhY2tXYWl0c0ZvckVtcHR5RXZlbnRMb29wOiB0cnVlLFxuICAgICAgZnVuY3Rpb25OYW1lOiAndGVzdC1xdWV1ZS1wcm9jZXNzb3InLFxuICAgICAgZnVuY3Rpb25WZXJzaW9uOiAnMScsXG4gICAgICBpbnZva2VkRnVuY3Rpb25Bcm46ICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmZ1bmN0aW9uOnRlc3QtcXVldWUtcHJvY2Vzc29yJyxcbiAgICAgIG1lbW9yeUxpbWl0SW5NQjogJzEyOCcsXG4gICAgICBhd3NSZXF1ZXN0SWQ6ICdsYW1iZGEtcmVxLTQ1NicsXG4gICAgICBsb2dHcm91cE5hbWU6ICcvYXdzL2xhbWJkYS90ZXN0LXF1ZXVlLXByb2Nlc3NvcicsXG4gICAgICBsb2dTdHJlYW1OYW1lOiAnMjAyNC8wMS8xNS9bJExBVEVTVF1hYmMxMjMnLFxuICAgICAgZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzOiAoKSA9PiAzMDAwMCxcbiAgICAgIGRvbmU6ICgpID0+IHt9LFxuICAgICAgZmFpbDogKCkgPT4ge30sXG4gICAgICBzdWNjZWVkOiAoKSA9PiB7fVxuICAgIH07XG4gIH1cblxuICAvLyBIZWxwZXIgdG8gY3JlYXRlIG1vY2sgZXhlY3V0aW9uIGNvbnRleHRcbiAgZnVuY3Rpb24gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQob3ZlcnJpZGVzOiBQYXJ0aWFsPEV4ZWN1dGlvbkNvbnRleHQ+ID0ge30pOiBFeGVjdXRpb25Db250ZXh0IHtcbiAgICBjb25zdCBtb2NrQWN0b3I6IEFjdG9yID0ge1xuICAgICAgcmVxdWVzdElkOiAncmVxLTEyMycsXG4gICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonLFxuICAgICAgYWN0b3JJZDogJ3VzZXItNDU2JyxcbiAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJ1xuICAgIH07XG5cbiAgICByZXR1cm4ge1xuICAgICAgZXZlbnQ6IHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHBhdGg6ICcvdXNlcnMvMTIzJyxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICd1c2VyLWFnZW50JzogJ01vemlsbGEvNS4wJyxcbiAgICAgICAgICAnWC1Gb3J3YXJkZWQtRm9yJzogJzE5Mi4xNjguMS4xJ1xuICAgICAgICB9LFxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBhcyBhbnksXG4gICAgICBsYW1iZGFDb250ZXh0OiB7XG4gICAgICAgIGF3c1JlcXVlc3RJZDogJ2F3cy1yZXEtMTIzJyxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiAndXNlci1hcGknXG4gICAgICB9IGFzIGFueSxcbiAgICAgIHJlcXVlc3Q6IHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLTEyMycsXG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICBwYXRoOiAnL3VzZXJzLzEyMycsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAnVXNlci1BZ2VudCc6ICdNb3ppbGxhLzUuMCcsXG4gICAgICAgICAgJ1gtRm9yd2FyZGVkLUZvcic6ICcxOTIuMTY4LjEuMSdcbiAgICAgICAgfVxuICAgICAgfSBhcyBhbnksXG4gICAgICByZXNwb25zZToge30gYXMgYW55LFxuICAgICAgYWN0b3I6IG1vY2tBY3RvcixcbiAgICAgIC4uLm92ZXJyaWRlc1xuICAgIH07XG4gIH1cblxuICBkZXNjcmliZSgnQVBJQ29udHJvbGxlciBBdWRpdCBJbnRlZ3JhdGlvbicsICgpID0+IHtcbiAgICBjbGFzcyBUZXN0QVBJQ29udHJvbGxlciBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICAgICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIEV4cG9zZSBwcm90ZWN0ZWQgbWV0aG9kcyBmb3IgdGVzdGluZ1xuICAgICAgcHVibGljIHRlc3RNYWtlQXVkaXRDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICByZXR1cm4gdGhpcy5tYWtlQXVkaXRDb250ZXh0KGN0eCk7XG4gICAgICB9XG5cbiAgICAgIHB1YmxpYyBhc3luYyB0ZXN0Q2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dDogYW55LCByZXF1ZXN0Q29udGV4dDogYW55KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHJlcXVlc3RDb250ZXh0KTtcbiAgICAgIH1cblxuICAgICAgcHVibGljIGFzeW5jIHRlc3RDYXB0dXJlRW5kKGF1ZGl0Q29udGV4dDogYW55LCByZXNwb25zZTogYW55LCBlcnJvcjogYW55KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCByZXNwb25zZSwgZXJyb3IpO1xuICAgICAgfVxuXG4gICAgICBwdWJsaWMgdGVzdEJ1aWxkUmVxdWVzdENvbnRleHQoY3R4OiBFeGVjdXRpb25Db250ZXh0LCBhdWRpdENvbmZpZzogYW55KSB7XG4gICAgICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmJ1aWxkUmVxdWVzdENvbnRleHQoY3R4LCBhdWRpdENvbmZpZyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IGNvbnRyb2xsZXI6IFRlc3RBUElDb250cm9sbGVyO1xuXG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICBjb250cm9sbGVyID0gbmV3IFRlc3RBUElDb250cm9sbGVyKCk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnbWFrZUF1ZGl0Q29udGV4dCcsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgY3JlYXRlIGF1ZGl0IGNvbnRleHQgd2l0aCBwcm9wZXIgY29ycmVsYXRpb24gSUQgYW5kIG9wZXJhdGlvbiBJRCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgbW9ja1JlZmxlY3RHZXQubW9ja1JldHVyblZhbHVlKHsgYXVkaXQ6IHsgZW5hYmxlZDogdHJ1ZSwgY2F0ZWdvcnk6ICd1c2VyLW1hbmFnZW1lbnQnIH0gfSk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgpO1xuXG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgbG9nVHlwZTogJ2xvZycsXG4gICAgICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0JyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVGVzdEFQSUNvbnRyb2xsZXInLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2dldF8vdXNlcnMvMTIzJyxcbiAgICAgICAgICBjYXRlZ29yeTogJ3VzZXItbWFuYWdlbWVudCcsXG4gICAgICAgICAgYWN0b3I6IGN0eC5hY3RvcixcbiAgICAgICAgICBjb3JyZWxhdGlvbjoge1xuICAgICAgICAgICAgY29ycmVsYXRpb25JZDogJ3JlcS0xMjMnLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6ICdUZXN0QVBJQ29udHJvbGxlci5nZXRfL3VzZXJzLzEyMycsXG4gICAgICAgICAgICBvcGVyYXRpb25UeXBlOiAnYXBpJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbk5hbWU6ICdnZXRfL3VzZXJzLzEyMycsXG4gICAgICAgICAgICBzdGFydFRpbWVzdGFtcDogZXhwZWN0LnN0cmluZ01hdGNoaW5nKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHJldHVybiBudWxsIHdoZW4gYXVkaXQgaXMgZGlzYWJsZWQnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZSh7IGF1ZGl0OiB7IGVuYWJsZWQ6IGZhbHNlIH0gfSk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgpO1xuXG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQpLnRvQmVOdWxsKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCB1c2UgZGVmYXVsdCBjb25maWcgd2hlbiBubyBhdWRpdCBjb25maWcgaXMgcHJlc2VudCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgbW9ja1JlZmxlY3RHZXQubW9ja1JldHVyblZhbHVlKHsgYXVkaXQ6IHsgZW5hYmxlZDogdHJ1ZSB9IH0pO1xuXG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNvbnRyb2xsZXIudGVzdE1ha2VBdWRpdENvbnRleHQoY3R4KTtcblxuICAgICAgICBleHBlY3QoYXVkaXRDb250ZXh0KS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGxvZ1R5cGU6ICdsb2cnLFxuICAgICAgICAgIHN1YlR5cGU6ICdhcGlfcmVxdWVzdCcsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ1Rlc3RBUElDb250cm9sbGVyJyxcbiAgICAgICAgICBhdWRpdENvbmZpZzoge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBpbmNsdWRlIGN1c3RvbSBzYW1wbGluZyBmdW5jdGlvbicsICgpID0+IHtcbiAgICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgY29uc3Qgc2FtcGxpbmdGbiA9IGNyZWF0ZUhhc2hCYXNlZFNhbXBsaW5nKDAuMSk7XG4gICAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZSh7IFxuICAgICAgICAgIGF1ZGl0OiB7IFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSwgXG4gICAgICAgICAgICBzYW1wbGluZ0ZuLFxuICAgICAgICAgICAgY3VzdG9tQ29udGV4dDogeyBmZWF0dXJlOiAndXNlci1hcGknLCB2ZXJzaW9uOiAnMS4yJyB9XG4gICAgICAgICAgfSBcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgpO1xuXG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmF1ZGl0Q29uZmlnLnNhbXBsaW5nRm4pLnRvQmUoc2FtcGxpbmdGbik7XG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmF1ZGl0Q29uZmlnLmN1c3RvbUNvbnRleHQpLnRvRXF1YWwoeyBmZWF0dXJlOiAndXNlci1hcGknLCB2ZXJzaW9uOiAnMS4yJyB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ2J1aWxkUmVxdWVzdENvbnRleHQnLCAoKSA9PiB7XG4gICAgICBpdCgnc2hvdWxkIGJ1aWxkIG1pbmltYWwgcmVxdWVzdCBjb250ZXh0IGJ5IGRlZmF1bHQnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnID0geyBlbmFibGVkOiB0cnVlIH07XG5cbiAgICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBjb250cm9sbGVyLnRlc3RCdWlsZFJlcXVlc3RDb250ZXh0KGN0eCwgYXVkaXRDb25maWcpO1xuXG4gICAgICAgIGV4cGVjdChyZXF1ZXN0Q29udGV4dCkudG9FcXVhbCh7XG4gICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICBwYXRoOiAnL3VzZXJzLzEyMycsXG4gICAgICAgICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAnLFxuICAgICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEnLFxuICAgICAgICAgIGhlYWRlcnM6IHVuZGVmaW5lZCxcbiAgICAgICAgICBib2R5OiB1bmRlZmluZWQsXG4gICAgICAgICAgcXVlcnk6IHVuZGVmaW5lZFxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIGluY2x1ZGUgaGVhZGVycyB3aGVuIGNvbmZpZ3VyZWQnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnID0ge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgaW5jbHVkZXM6IHsgcmVxdWVzdDogWydoZWFkZXJzJ10gfVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gY29udHJvbGxlci50ZXN0QnVpbGRSZXF1ZXN0Q29udGV4dChjdHgsIGF1ZGl0Q29uZmlnKTtcblxuICAgICAgICBleHBlY3QocmVxdWVzdENvbnRleHQpLnRvRXF1YWwoe1xuICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcGF0aDogJy91c2Vycy8xMjMnLFxuICAgICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wJyxcbiAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJyxcbiAgICAgICAgICBoZWFkZXJzOiBjdHgucmVxdWVzdC5oZWFkZXJzLFxuICAgICAgICAgIGJvZHk6IHVuZGVmaW5lZCxcbiAgICAgICAgICBxdWVyeTogdW5kZWZpbmVkXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgaW5jbHVkZSBtdWx0aXBsZSByZXF1ZXN0IHBhcnRzIHdoZW4gY29uZmlndXJlZCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgYmFzZUN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICAuLi5iYXNlQ3R4LnJlcXVlc3QsXG4gICAgICAgICAgICBib2R5OiB7IHVzZXJJZDogJzEyMycgfSxcbiAgICAgICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBpbmNsdWRlOiAncHJvZmlsZScgfVxuICAgICAgICAgIH0gYXMgYW55XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBhdWRpdENvbmZpZyA9IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGluY2x1ZGVzOiB7IHJlcXVlc3Q6IFsnaGVhZGVycycsICdib2R5JywgJ3F1ZXJ5J10gfVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gY29udHJvbGxlci50ZXN0QnVpbGRSZXF1ZXN0Q29udGV4dChjdHgsIGF1ZGl0Q29uZmlnKTtcblxuICAgICAgICBleHBlY3QocmVxdWVzdENvbnRleHQpLnRvRXF1YWwoe1xuICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcGF0aDogJy91c2Vycy8xMjMnLFxuICAgICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wJyxcbiAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJyxcbiAgICAgICAgICBoZWFkZXJzOiBjdHgucmVxdWVzdC5oZWFkZXJzLFxuICAgICAgICAgIGJvZHk6IHsgdXNlcklkOiAnMTIzJyB9LFxuICAgICAgICAgIHF1ZXJ5OiB7IGluY2x1ZGU6ICdwcm9maWxlJyB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnRW5kLXRvLUVuZCBBdWRpdCBJbnRlZ3JhdGlvbicsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgY2FwdHVyZSBzdGFydCBhdWRpdCBsb2cgd2l0aCByZWFsIGF1ZGl0IGxvZ2dlcicsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0ge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgbG9nVHlwZTogJ2F1ZGl0JyBhcyBjb25zdCxcbiAgICAgICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3QnLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdUZXN0QVBJQ29udHJvbGxlcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZ2V0VXNlcicsXG4gICAgICAgICAgY2F0ZWdvcnk6ICd1c2VyLW1hbmFnZW1lbnQnLFxuICAgICAgICAgIGFjdG9yOiBjdHguYWN0b3IsXG4gICAgICAgICAgY29ycmVsYXRpb246IHtcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLTEyMycsXG4gICAgICAgICAgICBvcGVyYXRpb25JZDogJ1Rlc3RBUElDb250cm9sbGVyLmdldFVzZXInLFxuICAgICAgICAgICAgb3BlcmF0aW9uVHlwZTogJ2FwaScgYXMgY29uc3QsXG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiAnZ2V0VXNlcicsXG4gICAgICAgICAgICBzdGFydFRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWidcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0Q29uZmlnOiB7IFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGRhdGFQcm90ZWN0aW9uOiB7XG4gICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIGZhc3RSZWRhY3Q6IHtcbiAgICAgICAgICAgICAgICBwYXRoczogWycqLnBhc3N3b3JkJywgJyouc2VjcmV0J11cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSB7XG4gICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICBwYXRoOiAnL3VzZXJzLzEyMycsXG4gICAgICAgICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAnLFxuICAgICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEnXG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgY29udHJvbGxlci50ZXN0Q2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQpO1xuXG4gICAgICAgIC8vIFZlcmlmeSB0aGUgZmFjdG9yeSB3YXMgY2FsbGVkIHRvIGNyZWF0ZSBhIGxvZ2dlclxuICAgICAgICBleHBlY3QobW9ja0ZhY3RvcnlJbnN0YW5jZS5jcmVhdGUpLnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFZlcmlmeSB0aGUgcmVhbCBhdWRpdCBlbnRyeSBzdHJ1Y3R1cmVcbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICBsb2dUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0X3N0YXJ0JyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6ICdUZXN0QVBJQ29udHJvbGxlcicsXG4gICAgICAgICAgICBldmVudFR5cGU6ICdzdGFydCcsXG4gICAgICAgICAgICBvcGVyYXRpb246ICdnZXRVc2VyJyxcbiAgICAgICAgICAgIGNhdGVnb3J5OiAndXNlci1tYW5hZ2VtZW50JyxcbiAgICAgICAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICAgICAgYWN0b3I6IGN0eC5hY3RvcixcbiAgICAgICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgICAgY29ycmVsYXRpb246IGF1ZGl0Q29udGV4dC5jb3JyZWxhdGlvbixcbiAgICAgICAgICAgICAgYXBpOiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgICAgICBwYXRoOiAnL3VzZXJzLzEyMycsXG4gICAgICAgICAgICAgICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAnLFxuICAgICAgICAgICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEnIC8vIERhdGEgcHJvdGVjdGlvbiByZWRhY3RzIElQIGFkZHJlc3Nlc1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgY2FwdHVyZSBlbmQgYXVkaXQgbG9nIHdpdGggcmVzcG9uc2UgY29udGV4dCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0ge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgbG9nVHlwZTogJ2F1ZGl0JyBhcyBjb25zdCxcbiAgICAgICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3QnLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdUZXN0QVBJQ29udHJvbGxlcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZ2V0VXNlcicsXG4gICAgICAgICAgY2F0ZWdvcnk6ICd1c2VyLW1hbmFnZW1lbnQnLFxuICAgICAgICAgIGNvcnJlbGF0aW9uOiB7XG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6ICdUZXN0QVBJQ29udHJvbGxlci5nZXRVc2VyJyxcbiAgICAgICAgICAgIG9wZXJhdGlvblR5cGU6ICdhcGknIGFzIGNvbnN0LFxuICAgICAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2dldFVzZXInLFxuICAgICAgICAgICAgc3RhcnRUaW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdWRpdENvbmZpZzogeyBcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBkYXRhUHJvdGVjdGlvbjoge1xuICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBmYXN0UmVkYWN0OiB7XG4gICAgICAgICAgICAgICAgcGF0aHM6IFsnKi5wYXNzd29yZCcsICcqLnNlY3JldCddXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0ge1xuICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHVzZXJzOiBbeyBpZDogJzEyMycgfV0gfSlcbiAgICAgICAgfTtcblxuICAgICAgICBhd2FpdCBjb250cm9sbGVyLnRlc3RDYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgcmVzcG9uc2UsIG51bGwpO1xuXG4gICAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHtcbiAgICAgICAgICBlbmFibGVkOiB1bmRlZmluZWQsXG4gICAgICAgICAgYXVkaXRFbnRyeTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgICAgbG9nVHlwZTogJ2F1ZGl0JyxcbiAgICAgICAgICAgIHN1YlR5cGU6ICdhcGlfcmVxdWVzdF9jb21wbGV0ZScsXG4gICAgICAgICAgICBlbnRpdHlOYW1lOiAnVGVzdEFQSUNvbnRyb2xsZXInLFxuICAgICAgICAgICAgZXZlbnRUeXBlOiAnY29tcGxldGUnLFxuICAgICAgICAgICAgb3BlcmF0aW9uOiAnZ2V0VXNlcicsXG4gICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLTEyMycsXG4gICAgICAgICAgICBtZXRyaWNzOiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICAgIGR1cmF0aW9uOiBleHBlY3QuYW55KE51bWJlciksXG4gICAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgICAgcmVzcG9uc2VTaXplOiBleHBlY3QuYW55KE51bWJlcilcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfSlcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBjYXB0dXJlIGVycm9yIGF1ZGl0IGxvZyB3aGVuIHJlcXVlc3QgZmFpbHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcgYXMgY29uc3QsXG4gICAgICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0JyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVGVzdEFQSUNvbnRyb2xsZXInLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2dldFVzZXInLFxuICAgICAgICAgIGNvcnJlbGF0aW9uOiB7XG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6ICdUZXN0QVBJQ29udHJvbGxlci5nZXRVc2VyJyxcbiAgICAgICAgICAgIG9wZXJhdGlvblR5cGU6ICdhcGknIGFzIGNvbnN0LFxuICAgICAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2dldFVzZXInLFxuICAgICAgICAgICAgc3RhcnRUaW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdWRpdENvbmZpZzogeyBcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBkYXRhUHJvdGVjdGlvbjoge1xuICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBmYXN0UmVkYWN0OiB7XG4gICAgICAgICAgICAgICAgcGF0aHM6IFsnKi5wYXNzd29yZCcsICcqLnNlY3JldCddXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdVc2VyIG5vdCBmb3VuZCcpO1xuICAgICAgICBlcnJvci5zdGFjayA9ICdFcnJvcjogVXNlciBub3QgZm91bmRcXG4gICAgYXQgZ2V0VXNlckJ5SWQuLi4nO1xuXG4gICAgICAgIGNvbnN0IG1vY2tSZXNwb25zZSA9IHsgc3RhdHVzQ29kZTogNTAwLCBib2R5OiAnJyB9O1xuICAgICAgICBhd2FpdCBjb250cm9sbGVyLnRlc3RDYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgbW9ja1Jlc3BvbnNlLCBlcnJvcik7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICBsb2dUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0X2Vycm9yJyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6ICdUZXN0QVBJQ29udHJvbGxlcicsXG4gICAgICAgICAgICBldmVudFR5cGU6ICdlcnJvcicsXG4gICAgICAgICAgICBvcGVyYXRpb246ICdnZXRVc2VyJyxcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJyxcbiAgICAgICAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBlcnJvcjogZXhwZWN0LmFueShPYmplY3QpIC8vIERhdGEgcHJvdGVjdGlvbiBzYW5pdGl6ZXMgZXJyb3Igb2JqZWN0c1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgaGFuZGxlIGF1ZGl0IGxvZ2dlciBmYWlsdXJlcyBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBtb2NrQXVkaXRMb2dnZXIuYXVkaXQubW9ja1JlamVjdGVkVmFsdWVPbmNlKG5ldyBFcnJvcignQXVkaXQgbG9nZ2VyIGZhaWxlZCcpKTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcgYXMgY29uc3QsXG4gICAgICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0JyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVGVzdEFQSUNvbnRyb2xsZXInLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2dldFVzZXInLFxuICAgICAgICAgIGNvcnJlbGF0aW9uOiB7XG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6ICdUZXN0QVBJQ29udHJvbGxlci5nZXRVc2VyJyxcbiAgICAgICAgICAgIG9wZXJhdGlvblR5cGU6ICdhcGknIGFzIGNvbnN0LFxuICAgICAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2dldFVzZXInLFxuICAgICAgICAgICAgc3RhcnRUaW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdWRpdENvbmZpZzogeyBcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBkYXRhUHJvdGVjdGlvbjoge1xuICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBmYXN0UmVkYWN0OiB7XG4gICAgICAgICAgICAgICAgcGF0aHM6IFsnKi5wYXNzd29yZCcsICcqLnNlY3JldCddXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0ge1xuICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcGF0aDogJy91c2Vycy8xMjMnLFxuICAgICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wJyxcbiAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJ1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIFNob3VsZCBub3QgdGhyb3dcbiAgICAgICAgYXdhaXQgZXhwZWN0KGNvbnRyb2xsZXIudGVzdENhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHJlcXVlc3RDb250ZXh0KSkucmVzb2x2ZXMudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICBcbiAgICAgICAgLy8gU2hvdWxkIHN0aWxsIGF0dGVtcHQgdG8gYXVkaXRcbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgICBcbiAgICAgICAgLy8gU2hvdWxkIGxvZyB0aGUgZXJyb3IgdG8gY29uc29sZVxuICAgICAgICBleHBlY3QoY29uc29sZUVycm9yU3B5KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgICAnRmFpbGVkIHRvIGNhcHR1cmUgYXVkaXQgbG9nOicsXG4gICAgICAgICAgZXhwZWN0LmFueShFcnJvciksXG4gICAgICAgICAgZXhwZWN0LmFueShPYmplY3QpXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1F1ZXVlQ29udHJvbGxlciBBdWRpdCBJbnRlZ3JhdGlvbicsICgpID0+IHtcbiAgICBjbGFzcyBUZXN0UXVldWVDb250cm9sbGVyIGV4dGVuZHMgUXVldWVDb250cm9sbGVyIHtcbiAgICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgfVxuXG4gICAgICAvLyBFeHBvc2UgcHJvdGVjdGVkIG1ldGhvZHMgZm9yIHRlc3RpbmdcbiAgICAgIHB1YmxpYyB0ZXN0TWFrZUF1ZGl0Q29udGV4dChldmVudDogU1FTRXZlbnQsIGNvbnRleHQ6IENvbnRleHQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubWFrZUF1ZGl0Q29udGV4dChldmVudCwgY29udGV4dCk7XG4gICAgICB9XG5cbiAgICAgIHB1YmxpYyB0ZXN0RXh0cmFjdENvcnJlbGF0aW9uRnJvbU1lc3NhZ2VzKGV2ZW50OiBTUVNFdmVudCkge1xuICAgICAgICByZXR1cm4gdGhpcy5leHRyYWN0Q29ycmVsYXRpb25Gcm9tTWVzc2FnZXMoZXZlbnQpO1xuICAgICAgfVxuXG4gICAgICBwdWJsaWMgdGVzdEV4dHJhY3RQYXJlbnRPcGVyYXRpb25Gcm9tTWVzc2FnZXMoZXZlbnQ6IFNRU0V2ZW50KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmV4dHJhY3RQYXJlbnRPcGVyYXRpb25Gcm9tTWVzc2FnZXMoZXZlbnQpO1xuICAgICAgfVxuXG4gICAgICBhc3luYyBpbml0aWFsaXplKCkge1xuICAgICAgICAvLyBUZXN0IGltcGxlbWVudGF0aW9uXG4gICAgICB9XG5cbiAgICAgIGFzeW5jIHByb2Nlc3MoKSB7XG4gICAgICAgIC8vIFRlc3QgaW1wbGVtZW50YXRpb25cbiAgICAgIH1cblxuICAgICAgYXN5bmMgcHJvY2Vzc1JlY29yZCgpIHtcbiAgICAgICAgcmV0dXJuIHsgcHJvY2Vzc2VkOiB0cnVlIH07XG4gICAgICB9XG5cbiAgICAgIC8vIE92ZXJyaWRlIGZvciB0ZXN0aW5nXG4gICAgICBwcm90ZWN0ZWQgZ2V0UXVldWVOYW1lKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0UXVldWVDb25maWcoKTtcbiAgICAgICAgcmV0dXJuIChjb25maWcgYXMgYW55KS5xdWV1ZU5hbWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IGNvbnRyb2xsZXI6IFRlc3RRdWV1ZUNvbnRyb2xsZXI7XG5cbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIGNvbnRyb2xsZXIgPSBuZXcgVGVzdFF1ZXVlQ29udHJvbGxlcigpO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ21ha2VBdWRpdENvbnRleHQnLCAoKSA9PiB7XG4gICAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhdWRpdCBjb250ZXh0IGZvciBxdWV1ZSBwcm9jZXNzaW5nJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tTUVNFdmVudCgpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0gY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKTtcbiAgICAgICAgbW9ja1JlZmxlY3RHZXQubW9ja1JldHVyblZhbHVlKHsgYXVkaXQ6IHsgZW5hYmxlZDogdHJ1ZSwgY2F0ZWdvcnk6ICdxdWV1ZS1wcm9jZXNzaW5nJyB9LCBxdWV1ZU5hbWU6ICd1c2VyLW5vdGlmaWNhdGlvbnMnIH0pO1xuXG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNvbnRyb2xsZXIudGVzdE1ha2VBdWRpdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgbG9nVHlwZTogJ2V2ZW50JyxcbiAgICAgICAgICBzdWJUeXBlOiAncXVldWVfcHJvY2Vzc2luZycsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ1Rlc3RRdWV1ZUNvbnRyb2xsZXInLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ3VzZXItbm90aWZpY2F0aW9ucycsXG4gICAgICAgICAgY2F0ZWdvcnk6ICdxdWV1ZS1wcm9jZXNzaW5nJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbjoge1xuICAgICAgICAgICAgY29ycmVsYXRpb25JZDogJ3BhcmVudC1jb3JyLTEyMycsXG4gICAgICAgICAgICBvcGVyYXRpb25JZDogJ1Rlc3RRdWV1ZUNvbnRyb2xsZXIudXNlci1ub3RpZmljYXRpb25zJyxcbiAgICAgICAgICAgIHBhcmVudE9wZXJhdGlvbklkOiAnQVBJQ29udHJvbGxlci5jcmVhdGVVc2VyJyxcbiAgICAgICAgICAgIG9wZXJhdGlvblR5cGU6ICdxdWV1ZScsXG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiAndXNlci1ub3RpZmljYXRpb25zJ1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBnZW5lcmF0ZSBuZXcgY29ycmVsYXRpb24gSUQgd2hlbiBub3QgZm91bmQgaW4gbWVzc2FnZXMnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgIFJlY29yZHM6IFt7XG4gICAgICAgICAgICAuLi5jcmVhdGVNb2NrU1FTRXZlbnQoKS5SZWNvcmRzWzBdLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhOiAnbm8gY29ycmVsYXRpb24nIH0pXG4gICAgICAgICAgfV1cbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgY29udGV4dCA9IGNyZWF0ZU1vY2tMYW1iZGFDb250ZXh0KCk7XG4gICAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZSh7IGF1ZGl0OiB7IGVuYWJsZWQ6IHRydWUgfSB9KTtcblxuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjb250cm9sbGVyLnRlc3RNYWtlQXVkaXRDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcblxuICAgICAgICBleHBlY3QoYXVkaXRDb250ZXh0Py5jb3JyZWxhdGlvbi5jb3JyZWxhdGlvbklkKS50b0JlKCdsYW1iZGEtcmVxLTQ1NicpO1xuICAgICAgICBleHBlY3QoYXVkaXRDb250ZXh0Py5jb3JyZWxhdGlvbi5wYXJlbnRPcGVyYXRpb25JZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgcmV0dXJuIG51bGwgd2hlbiBhdWRpdCBpcyBkaXNhYmxlZCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrU1FTRXZlbnQoKTtcbiAgICAgICAgY29uc3QgY29udGV4dCA9IGNyZWF0ZU1vY2tMYW1iZGFDb250ZXh0KCk7XG4gICAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZSh7IGF1ZGl0OiB7IGVuYWJsZWQ6IGZhbHNlIH0gfSk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChldmVudCwgY29udGV4dCk7XG5cbiAgICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dCkudG9CZU51bGwoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ2NvcnJlbGF0aW9uIGV4dHJhY3Rpb24nLCAoKSA9PiB7XG4gICAgICBpdCgnc2hvdWxkIGV4dHJhY3QgY29ycmVsYXRpb24gSUQgZnJvbSBtZXNzYWdlIGJvZGllcycsICgpID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrU1FTRXZlbnQoKTtcblxuICAgICAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gY29udHJvbGxlci50ZXN0RXh0cmFjdENvcnJlbGF0aW9uRnJvbU1lc3NhZ2VzKGV2ZW50KTtcblxuICAgICAgICBleHBlY3QoY29ycmVsYXRpb25JZCkudG9CZSgncGFyZW50LWNvcnItMTIzJyk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBleHRyYWN0IHBhcmVudCBvcGVyYXRpb24gSUQgZnJvbSBtZXNzYWdlIGJvZGllcycsICgpID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrU1FTRXZlbnQoKTtcblxuICAgICAgICBjb25zdCBwYXJlbnRPcGVyYXRpb25JZCA9IGNvbnRyb2xsZXIudGVzdEV4dHJhY3RQYXJlbnRPcGVyYXRpb25Gcm9tTWVzc2FnZXMoZXZlbnQpO1xuXG4gICAgICAgIGV4cGVjdChwYXJlbnRPcGVyYXRpb25JZCkudG9CZSgnQVBJQ29udHJvbGxlci5jcmVhdGVVc2VyJyk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCByZXR1cm4gbnVsbCBmb3IgaW52YWxpZCBKU09OIGluIG1lc3NhZ2UgYm9keScsICgpID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSB7XG4gICAgICAgICAgUmVjb3JkczogW3tcbiAgICAgICAgICAgIC4uLmNyZWF0ZU1vY2tTUVNFdmVudCgpLlJlY29yZHNbMF0sXG4gICAgICAgICAgICBib2R5OiAnaW52YWxpZCBqc29ueydcbiAgICAgICAgICB9XVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBjb250cm9sbGVyLnRlc3RFeHRyYWN0Q29ycmVsYXRpb25Gcm9tTWVzc2FnZXMoZXZlbnQpO1xuICAgICAgICBjb25zdCBwYXJlbnRPcGVyYXRpb25JZCA9IGNvbnRyb2xsZXIudGVzdEV4dHJhY3RQYXJlbnRPcGVyYXRpb25Gcm9tTWVzc2FnZXMoZXZlbnQpO1xuXG4gICAgICAgIGV4cGVjdChjb3JyZWxhdGlvbklkKS50b0JlTnVsbCgpO1xuICAgICAgICBleHBlY3QocGFyZW50T3BlcmF0aW9uSWQpLnRvQmVOdWxsKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1Rhc2tDb250cm9sbGVyIEF1ZGl0IEludGVncmF0aW9uJywgKCkgPT4ge1xuICAgIGNsYXNzIFRlc3RUYXNrQ29udHJvbGxlciBleHRlbmRzIFRhc2tDb250cm9sbGVyIHtcbiAgICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgfVxuXG4gICAgICAvLyBFeHBvc2UgcHJvdGVjdGVkIG1ldGhvZHMgZm9yIHRlc3RpbmdcbiAgICAgIHB1YmxpYyB0ZXN0TWFrZUF1ZGl0Q29udGV4dCgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubWFrZUF1ZGl0Q29udGV4dCgpO1xuICAgICAgfVxuXG4gICAgICBhc3luYyBpbml0aWFsaXplKCkge1xuICAgICAgICAvLyBUZXN0IGltcGxlbWVudGF0aW9uXG4gICAgICB9XG5cbiAgICAgIGFzeW5jIHByb2Nlc3MoKSB7XG4gICAgICAgIC8vIFRlc3QgaW1wbGVtZW50YXRpb25cbiAgICAgIH1cblxuICAgICAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICAgICAgcmV0dXJuIHsgdGFza0NvbXBsZXRlZDogdHJ1ZSB9O1xuICAgICAgfVxuXG4gICAgICAvLyBPdmVycmlkZSBmb3IgdGVzdGluZ1xuICAgICAgcHJvdGVjdGVkIGdldFRhc2tOYW1lKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0VGFza0NvbmZpZygpO1xuICAgICAgICByZXR1cm4gKGNvbmZpZyBhcyBhbnkpLnRhc2tOYW1lO1xuICAgICAgfVxuICAgIH1cblxuICAgIGxldCBjb250cm9sbGVyOiBUZXN0VGFza0NvbnRyb2xsZXI7XG5cbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIGNvbnRyb2xsZXIgPSBuZXcgVGVzdFRhc2tDb250cm9sbGVyKCk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnbWFrZUF1ZGl0Q29udGV4dCcsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgY3JlYXRlIGF1ZGl0IGNvbnRleHQgZm9yIHNjaGVkdWxlZCB0YXNrJywgKCkgPT4ge1xuICAgICAgICBtb2NrUmVmbGVjdEdldC5tb2NrUmV0dXJuVmFsdWUoeyBcbiAgICAgICAgICBhdWRpdDogeyBlbmFibGVkOiB0cnVlLCBjYXRlZ29yeTogJ2RhdGEtcHJvY2Vzc2luZycgfSxcbiAgICAgICAgICB0YXNrTmFtZTogJ2RhaWx5LXJlcG9ydCcsXG4gICAgICAgICAgc2NoZWR1bGU6ICdjcm9uKDAgOSAqICogPyAqKSdcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dCgpO1xuXG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgbG9nVHlwZTogJ2V2ZW50JyxcbiAgICAgICAgICBzdWJUeXBlOiAndGFza19leGVjdXRpb24nLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdUZXN0VGFza0NvbnRyb2xsZXInLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2RhaWx5LXJlcG9ydCcsXG4gICAgICAgICAgY2F0ZWdvcnk6ICdkYXRhLXByb2Nlc3NpbmcnLFxuICAgICAgICAgIGFjdG9yOiB7XG4gICAgICAgICAgICBhY3RvcklkOiAnc2NoZWR1bGVyJyxcbiAgICAgICAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgICAgICAgYXV0aE1ldGhvZDogJ3N5c3RlbSdcbiAgICAgICAgICB9LFxuICAgICAgICAgIGNvcnJlbGF0aW9uOiB7XG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiBleHBlY3Quc3RyaW5nTWF0Y2hpbmcoL15UZXN0VGFza0NvbnRyb2xsZXJcXC5kYWlseS1yZXBvcnQtXFxkKyQvKSxcbiAgICAgICAgICAgIG9wZXJhdGlvbklkOiAnVGVzdFRhc2tDb250cm9sbGVyLmRhaWx5LXJlcG9ydCcsXG4gICAgICAgICAgICBvcGVyYXRpb25UeXBlOiAndGFzaycsXG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiAnZGFpbHktcmVwb3J0J1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCByZXR1cm4gbnVsbCB3aGVuIGF1ZGl0IGlzIGRpc2FibGVkJywgKCkgPT4ge1xuICAgICAgICBtb2NrUmVmbGVjdEdldC5tb2NrUmV0dXJuVmFsdWUoeyBhdWRpdDogeyBlbmFibGVkOiBmYWxzZSB9IH0pO1xuXG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNvbnRyb2xsZXIudGVzdE1ha2VBdWRpdENvbnRleHQoKTtcblxuICAgICAgICBleHBlY3QoYXVkaXRDb250ZXh0KS50b0JlTnVsbCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgaGFuZGxlIG1pc3NpbmcgdGFzayBjb25maWd1cmF0aW9uIGdyYWNlZnVsbHknLCAoKSA9PiB7XG4gICAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZSh7IGF1ZGl0OiB7IGVuYWJsZWQ6IHRydWUgfSB9KTtcblxuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjb250cm9sbGVyLnRlc3RNYWtlQXVkaXRDb250ZXh0KCk7XG5cbiAgICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dCkudG9NYXRjaE9iamVjdCh7XG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBsb2dUeXBlOiAnZXZlbnQnLFxuICAgICAgICAgIHN1YlR5cGU6ICd0YXNrX2V4ZWN1dGlvbicsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ1Rlc3RUYXNrQ29udHJvbGxlcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZXhlY3V0ZScgLy8gRGVmYXVsdCBvcGVyYXRpb24gbmFtZVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQ3Jvc3MtQ29udHJvbGxlciBJbnRlZ3JhdGlvbiBTY2VuYXJpb3MnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBtYWludGFpbiBjb3JyZWxhdGlvbiBhY3Jvc3MgQVBJIC0+IFF1ZXVlIHdvcmtmbG93JywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gU2ltdWxhdGUgQVBJIHJlcXVlc3QgY3JlYXRpbmcgYSBxdWV1ZSBtZXNzYWdlXG4gICAgICBjb25zdCBhcGlDb250cm9sbGVyID0gbmV3IChjbGFzcyBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICAgICAgICBwdWJsaWMgdGVzdE1ha2VBdWRpdENvbnRleHQoY3R4OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMubWFrZUF1ZGl0Q29udGV4dChjdHgpO1xuICAgICAgICB9XG4gICAgICB9KSgpO1xuXG4gICAgICBjb25zdCBxdWV1ZUNvbnRyb2xsZXIgPSBuZXcgKGNsYXNzIGV4dGVuZHMgUXVldWVDb250cm9sbGVyIHtcbiAgICAgICAgcHVibGljIHRlc3RNYWtlQXVkaXRDb250ZXh0KGV2ZW50OiBTUVNFdmVudCwgY29udGV4dDogQ29udGV4dCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLm1ha2VBdWRpdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgICB9XG4gICAgICAgIGFzeW5jIGluaXRpYWxpemUoKSB7fVxuICAgICAgICBhc3luYyBwcm9jZXNzKCkge31cbiAgICAgICAgYXN5bmMgcHJvY2Vzc1JlY29yZCgpIHsgcmV0dXJuIHt9OyB9XG4gICAgICB9KSgpO1xuXG4gICAgICAvLyBBUEkgcmVxdWVzdFxuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZSh7IGF1ZGl0OiB7IGVuYWJsZWQ6IHRydWUgfSB9KTtcbiAgICAgIFxuICAgICAgY29uc3QgYXBpQXVkaXRDb250ZXh0ID0gYXBpQ29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgpO1xuICAgICAgZXhwZWN0KGFwaUF1ZGl0Q29udGV4dD8uY29ycmVsYXRpb24ub3BlcmF0aW9uVHlwZSkudG9CZSgnYXBpJyk7XG4gICAgICBleHBlY3QoYXBpQXVkaXRDb250ZXh0Py5jb3JyZWxhdGlvbi5jb3JyZWxhdGlvbklkKS50b0JlKCdyZXEtMTIzJyk7XG5cbiAgICAgIC8vIFF1ZXVlIHByb2Nlc3Npbmcgd2l0aCBjb3JyZWxhdGlvbiBmcm9tIEFQSVxuICAgICAgY29uc3QgcXVldWVFdmVudCA9IHtcbiAgICAgICAgUmVjb3JkczogW3tcbiAgICAgICAgICAuLi5jcmVhdGVNb2NrU1FTRXZlbnQoKS5SZWNvcmRzWzBdLFxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IGFwaUF1ZGl0Q29udGV4dD8uY29ycmVsYXRpb24uY29ycmVsYXRpb25JZCxcbiAgICAgICAgICAgIHBhcmVudE9wZXJhdGlvbklkOiBhcGlBdWRpdENvbnRleHQ/LmNvcnJlbGF0aW9uLm9wZXJhdGlvbklkXG4gICAgICAgICAgfSlcbiAgICAgICAgfV1cbiAgICAgIH07XG4gICAgICBcbiAgICAgIGNvbnN0IHF1ZXVlQXVkaXRDb250ZXh0ID0gcXVldWVDb250cm9sbGVyLnRlc3RNYWtlQXVkaXRDb250ZXh0KHF1ZXVlRXZlbnQsIGNyZWF0ZU1vY2tMYW1iZGFDb250ZXh0KCkpO1xuICAgICAgXG4gICAgICBleHBlY3QocXVldWVBdWRpdENvbnRleHQ/LmNvcnJlbGF0aW9uLmNvcnJlbGF0aW9uSWQpLnRvQmUoYXBpQXVkaXRDb250ZXh0Py5jb3JyZWxhdGlvbi5jb3JyZWxhdGlvbklkKTtcbiAgICAgIGV4cGVjdChxdWV1ZUF1ZGl0Q29udGV4dD8uY29ycmVsYXRpb24ucGFyZW50T3BlcmF0aW9uSWQpLnRvQmUoYXBpQXVkaXRDb250ZXh0Py5jb3JyZWxhdGlvbi5vcGVyYXRpb25JZCk7XG4gICAgICBleHBlY3QocXVldWVBdWRpdENvbnRleHQ/LmNvcnJlbGF0aW9uLm9wZXJhdGlvblR5cGUpLnRvQmUoJ3F1ZXVlJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBkaWZmZXJlbnQgYXVkaXQgY29uZmlndXJhdGlvbnMgYWNyb3NzIGNvbnRyb2xsZXJzJywgKCkgPT4ge1xuICAgICAgY29uc3QgYXBpQ29udHJvbGxlciA9IG5ldyAoY2xhc3MgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgICAgICAgcHVibGljIHRlc3RNYWtlQXVkaXRDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLm1ha2VBdWRpdENvbnRleHQoY3R4KTtcbiAgICAgICAgfVxuICAgICAgfSkoKTtcblxuICAgICAgY29uc3QgdGFza0NvbnRyb2xsZXIgPSBuZXcgKGNsYXNzIGV4dGVuZHMgVGFza0NvbnRyb2xsZXIge1xuICAgICAgICBwdWJsaWMgdGVzdE1ha2VBdWRpdENvbnRleHQoKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMubWFrZUF1ZGl0Q29udGV4dCgpO1xuICAgICAgICB9XG4gICAgICAgIGFzeW5jIGluaXRpYWxpemUoKSB7fVxuICAgICAgICBhc3luYyBwcm9jZXNzKCkge31cbiAgICAgICAgYXN5bmMgZXhlY3V0ZSgpIHsgcmV0dXJuIHt9OyB9XG4gICAgICB9KSgpO1xuXG4gICAgICAvLyBBUEkgd2l0aCBkZXRhaWxlZCBhdWRpdCBjb25maWdcbiAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZU9uY2UoeyBcbiAgICAgICAgYXVkaXQ6IHsgXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSwgXG4gICAgICAgICAgc2tpcFN0YXJ0OiBmYWxzZSxcbiAgICAgICAgICBza2lwRW5kOiB0cnVlLFxuICAgICAgICAgIHNhbXBsaW5nRm46IGNyZWF0ZUhhc2hCYXNlZFNhbXBsaW5nKDAuMSksXG4gICAgICAgICAgaW5jbHVkZXM6IHsgcmVxdWVzdDogWydoZWFkZXJzJywgJ2JvZHknXSwgcmVzcG9uc2U6IHRydWUgfVxuICAgICAgICB9IFxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGNvbnN0IGFwaUF1ZGl0Q29udGV4dCA9IGFwaUNvbnRyb2xsZXIudGVzdE1ha2VBdWRpdENvbnRleHQoY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKSk7XG5cbiAgICAgIC8vIFRhc2sgd2l0aCBtaW5pbWFsIGF1ZGl0IGNvbmZpZ1xuICAgICAgbW9ja1JlZmxlY3RHZXQubW9ja1JldHVyblZhbHVlT25jZSh7IFxuICAgICAgICBhdWRpdDogeyBcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNraXBTdGFydDogdHJ1ZSxcbiAgICAgICAgICBza2lwRW5kOiBmYWxzZSxcbiAgICAgICAgICBjYXRlZ29yeTogJ2JhY2tncm91bmQtam9icydcbiAgICAgICAgfSBcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBjb25zdCB0YXNrQXVkaXRDb250ZXh0ID0gdGFza0NvbnRyb2xsZXIudGVzdE1ha2VBdWRpdENvbnRleHQoKTtcblxuICAgICAgZXhwZWN0KGFwaUF1ZGl0Q29udGV4dD8uYXVkaXRDb25maWcuc2tpcEVuZCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChhcGlBdWRpdENvbnRleHQ/LmF1ZGl0Q29uZmlnLmluY2x1ZGVzKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHRhc2tBdWRpdENvbnRleHQ/LmF1ZGl0Q29uZmlnLnNraXBTdGFydCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdCh0YXNrQXVkaXRDb250ZXh0Py5jYXRlZ29yeSkudG9CZSgnYmFja2dyb3VuZC1qb2JzJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJlc3BlY3Qgc2FtcGxpbmcgY29uZmlndXJhdGlvbiBpbiByZWFsIGF1ZGl0IGludGVncmF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc2FtcGxpbmdGbiA9IGNyZWF0ZUhhc2hCYXNlZFNhbXBsaW5nKDAuMCk7IC8vIDAlIHNhbXBsaW5nIC0gc2hvdWxkIHNraXAgYWxsXG4gICAgICBcbiAgICAgIGNvbnN0IGFwaUNvbnRyb2xsZXIgPSBuZXcgKGNsYXNzIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG4gICAgICAgIHB1YmxpYyB0ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHg6IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5tYWtlQXVkaXRDb250ZXh0KGN0eCk7XG4gICAgICAgIH1cbiAgICAgICAgcHVibGljIGFzeW5jIHRlc3RDYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0OiBhbnksIHJlcXVlc3RDb250ZXh0OiBhbnkpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCByZXF1ZXN0Q29udGV4dCk7XG4gICAgICAgIH1cbiAgICAgIH0pKCk7XG5cbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICBtb2NrUmVmbGVjdEdldC5tb2NrUmV0dXJuVmFsdWUoeyBcbiAgICAgICAgYXVkaXQ6IHsgXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBzYW1wbGluZ0ZuXG4gICAgICAgIH0gXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gYXBpQ29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgpO1xuICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSB7XG4gICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHBhdGg6ICcvdXNlcnMvMTIzJyxcbiAgICAgICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAnLFxuICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJ1xuICAgICAgfTtcblxuICAgICAgYXdhaXQgYXBpQ29udHJvbGxlci50ZXN0Q2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQpO1xuXG4gICAgICAvLyBTaG91bGQgbm90IGhhdmUgY2FsbGVkIHRoZSBhdWRpdCBsb2dnZXIgZHVlIHRvIDAlIHNhbXBsaW5nXG4gICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgIH0pO1xuICB9KTtcbn0pOyJdfQ==