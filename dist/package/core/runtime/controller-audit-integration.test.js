"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_gateway_controller_1 = require("./api-gateway-controller");
const sqs_controller_1 = require("./sqs-controller");
const task_controller_1 = require("./task-controller");
const sampling_1 = require("../../audit/helpers/sampling");
const factory_1 = require("../../audit/loggers/factory");
// Mock the audit logger factory to capture actual audit logs
jest.mock('../../audit/loggers/factory', () => ({
    AuditLoggerFactory: {
        getInstance: jest.fn().mockReturnValue({
            create: jest.fn().mockReturnValue({
                audit: jest.fn().mockResolvedValue(undefined)
            })
        })
    }
}));
// Mock Reflect for decorator metadata
const mockReflectGet = jest.fn();
global.Reflect = {
    ...global.Reflect,
    get: mockReflectGet
};
// Mock Date.now for predictable timestamps
const mockDateNow = jest.spyOn(Date, 'now').mockImplementation(() => 1705314600000);
describe('Controller Audit Integration', () => {
    const mockFactoryInstance = factory_1.AuditLoggerFactory.getInstance();
    const mockAuditLogger = mockFactoryInstance.create();
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
                            redactPII: true,
                            redactSensitiveFields: true
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
                    auditConfig: { enabled: true }
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
                            redactPII: true,
                            redactSensitiveFields: true
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
                    auditConfig: { enabled: true }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJvbGxlci1hdWRpdC1pbnRlZ3JhdGlvbi50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9jb250cm9sbGVyLWF1ZGl0LWludGVncmF0aW9uLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxxRUFBeUQ7QUFDekQscURBQW1EO0FBQ25ELHVEQUFtRDtBQUduRCwyREFBdUU7QUFDdkUseURBQWlFO0FBRWpFLDZEQUE2RDtBQUM3RCxJQUFJLENBQUMsSUFBSSxDQUFDLDZCQUE2QixFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDOUMsa0JBQWtCLEVBQUU7UUFDbEIsV0FBVyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxlQUFlLENBQUM7WUFDckMsTUFBTSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxlQUFlLENBQUM7Z0JBQ2hDLEtBQUssRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsU0FBUyxDQUFDO2FBQzlDLENBQUM7U0FDSCxDQUFDO0tBQ0g7Q0FDRixDQUFDLENBQUMsQ0FBQztBQUVKLHNDQUFzQztBQUN0QyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7QUFDakMsTUFBTSxDQUFDLE9BQU8sR0FBRztJQUNmLEdBQUcsTUFBTSxDQUFDLE9BQU87SUFDakIsR0FBRyxFQUFFLGNBQWM7Q0FDcEIsQ0FBQztBQUVGLDJDQUEyQztBQUMzQyxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxhQUFhLENBQUMsQ0FBQztBQUVwRixRQUFRLENBQUMsOEJBQThCLEVBQUUsR0FBRyxFQUFFO0lBQzVDLE1BQU0sbUJBQW1CLEdBQUcsNEJBQWtCLENBQUMsV0FBVyxFQUFzQixDQUFDO0lBQ2pG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LGNBQWMsQ0FBQyxDQUFDO1lBRW5FLDZEQUE2RDtZQUM3RCxNQUFNLENBQUMsZUFBZSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1FBQ3ZELENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUNvbnRyb2xsZXIgfSBmcm9tICcuL2FwaS1nYXRld2F5LWNvbnRyb2xsZXInO1xuaW1wb3J0IHsgUXVldWVDb250cm9sbGVyIH0gZnJvbSAnLi9zcXMtY29udHJvbGxlcic7XG5pbXBvcnQgeyBUYXNrQ29udHJvbGxlciB9IGZyb20gJy4vdGFzay1jb250cm9sbGVyJztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQsIEFjdG9yIH0gZnJvbSAnLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgU1FTRXZlbnQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IGNyZWF0ZUhhc2hCYXNlZFNhbXBsaW5nIH0gZnJvbSAnLi4vLi4vYXVkaXQvaGVscGVycy9zYW1wbGluZyc7XG5pbXBvcnQgeyBBdWRpdExvZ2dlckZhY3RvcnkgfSBmcm9tICcuLi8uLi9hdWRpdC9sb2dnZXJzL2ZhY3RvcnknO1xuXG4vLyBNb2NrIHRoZSBhdWRpdCBsb2dnZXIgZmFjdG9yeSB0byBjYXB0dXJlIGFjdHVhbCBhdWRpdCBsb2dzXG5qZXN0Lm1vY2soJy4uLy4uL2F1ZGl0L2xvZ2dlcnMvZmFjdG9yeScsICgpID0+ICh7XG4gIEF1ZGl0TG9nZ2VyRmFjdG9yeToge1xuICAgIGdldEluc3RhbmNlOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKHtcbiAgICAgIGNyZWF0ZTogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSh7XG4gICAgICAgIGF1ZGl0OiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUodW5kZWZpbmVkKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG59KSk7XG5cbi8vIE1vY2sgUmVmbGVjdCBmb3IgZGVjb3JhdG9yIG1ldGFkYXRhXG5jb25zdCBtb2NrUmVmbGVjdEdldCA9IGplc3QuZm4oKTtcbmdsb2JhbC5SZWZsZWN0ID0ge1xuICAuLi5nbG9iYWwuUmVmbGVjdCxcbiAgZ2V0OiBtb2NrUmVmbGVjdEdldFxufTtcblxuLy8gTW9jayBEYXRlLm5vdyBmb3IgcHJlZGljdGFibGUgdGltZXN0YW1wc1xuY29uc3QgbW9ja0RhdGVOb3cgPSBqZXN0LnNweU9uKERhdGUsICdub3cnKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4gMTcwNTMxNDYwMDAwMCk7XG5cbmRlc2NyaWJlKCdDb250cm9sbGVyIEF1ZGl0IEludGVncmF0aW9uJywgKCkgPT4ge1xuICBjb25zdCBtb2NrRmFjdG9yeUluc3RhbmNlID0gQXVkaXRMb2dnZXJGYWN0b3J5LmdldEluc3RhbmNlKCkgYXMgamVzdC5Nb2NrZWQ8YW55PjtcbiAgY29uc3QgbW9ja0F1ZGl0TG9nZ2VyID0gbW9ja0ZhY3RvcnlJbnN0YW5jZS5jcmVhdGUoKTtcblxuICAvLyBNb2NrIGNvbnNvbGUuZXJyb3IgdG8gYXZvaWQgbm9pc2UgaW4gdGVzdCBvdXRwdXRcbiAgY29uc3QgY29uc29sZUVycm9yU3B5ID0gamVzdC5zcHlPbihjb25zb2xlLCAnZXJyb3InKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4ge30pO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIC8vIENsZWFyIG1vY2tzIGJ1dCBwcmVzZXJ2ZSBzcHkgc2V0dXBcbiAgICBtb2NrRmFjdG9yeUluc3RhbmNlLmNyZWF0ZS5tb2NrQ2xlYXIoKTtcbiAgICBtb2NrQXVkaXRMb2dnZXIuYXVkaXQubW9ja0NsZWFyKCk7XG4gICAgY29uc29sZUVycm9yU3B5Lm1vY2tDbGVhcigpO1xuICAgIG1vY2tEYXRlTm93Lm1vY2tSZXR1cm5WYWx1ZSgxNzA1MzE0NjAwMDAwKTtcbiAgfSk7XG5cbiAgYWZ0ZXJBbGwoKCkgPT4ge1xuICAgIGNvbnNvbGVFcnJvclNweS5tb2NrUmVzdG9yZSgpO1xuICB9KTtcblxuICAvLyBIZWxwZXIgdG8gY3JlYXRlIG1vY2sgU1FTIGV2ZW50XG4gIGZ1bmN0aW9uIGNyZWF0ZU1vY2tTUVNFdmVudCgpOiBTUVNFdmVudCB7XG4gICAgcmV0dXJuIHtcbiAgICAgIFJlY29yZHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIG1lc3NhZ2VJZDogJ21zZy0xJyxcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAncmVjZWlwdC0xJyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAncGFyZW50LWNvcnItMTIzJyxcbiAgICAgICAgICAgIHBhcmVudE9wZXJhdGlvbklkOiAnQVBJQ29udHJvbGxlci5jcmVhdGVVc2VyJ1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXG4gICAgICAgICAgICBTZW50VGltZXN0YW1wOiAnMTcwNTMxNDYwMDAwMCcsXG4gICAgICAgICAgICBTZW5kZXJJZDogJ3NlbmRlci0xJyxcbiAgICAgICAgICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTcwNTMxNDYwMDAwMCdcbiAgICAgICAgICB9LFxuICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcbiAgICAgICAgICBtZDVPZkJvZHk6ICdtZDUtMScsXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcbiAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXG4gICAgICAgICAgYXdzUmVnaW9uOiAndXMtZWFzdC0xJ1xuICAgICAgICB9XG4gICAgICBdXG4gICAgfTtcbiAgfVxuXG4gIC8vIEhlbHBlciB0byBjcmVhdGUgbW9jayBMYW1iZGEgY29udGV4dFxuICBmdW5jdGlvbiBjcmVhdGVNb2NrTGFtYmRhQ29udGV4dCgpOiBDb250ZXh0IHtcbiAgICByZXR1cm4ge1xuICAgICAgY2FsbGJhY2tXYWl0c0ZvckVtcHR5RXZlbnRMb29wOiB0cnVlLFxuICAgICAgZnVuY3Rpb25OYW1lOiAndGVzdC1xdWV1ZS1wcm9jZXNzb3InLFxuICAgICAgZnVuY3Rpb25WZXJzaW9uOiAnMScsXG4gICAgICBpbnZva2VkRnVuY3Rpb25Bcm46ICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmZ1bmN0aW9uOnRlc3QtcXVldWUtcHJvY2Vzc29yJyxcbiAgICAgIG1lbW9yeUxpbWl0SW5NQjogJzEyOCcsXG4gICAgICBhd3NSZXF1ZXN0SWQ6ICdsYW1iZGEtcmVxLTQ1NicsXG4gICAgICBsb2dHcm91cE5hbWU6ICcvYXdzL2xhbWJkYS90ZXN0LXF1ZXVlLXByb2Nlc3NvcicsXG4gICAgICBsb2dTdHJlYW1OYW1lOiAnMjAyNC8wMS8xNS9bJExBVEVTVF1hYmMxMjMnLFxuICAgICAgZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzOiAoKSA9PiAzMDAwMCxcbiAgICAgIGRvbmU6ICgpID0+IHt9LFxuICAgICAgZmFpbDogKCkgPT4ge30sXG4gICAgICBzdWNjZWVkOiAoKSA9PiB7fVxuICAgIH07XG4gIH1cblxuICAvLyBIZWxwZXIgdG8gY3JlYXRlIG1vY2sgZXhlY3V0aW9uIGNvbnRleHRcbiAgZnVuY3Rpb24gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQob3ZlcnJpZGVzOiBQYXJ0aWFsPEV4ZWN1dGlvbkNvbnRleHQ+ID0ge30pOiBFeGVjdXRpb25Db250ZXh0IHtcbiAgICBjb25zdCBtb2NrQWN0b3I6IEFjdG9yID0ge1xuICAgICAgcmVxdWVzdElkOiAncmVxLTEyMycsXG4gICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonLFxuICAgICAgYWN0b3JJZDogJ3VzZXItNDU2JyxcbiAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgdGVuYW50SWQ6ICd0ZW5hbnQtYWJjJ1xuICAgIH07XG5cbiAgICByZXR1cm4ge1xuICAgICAgZXZlbnQ6IHtcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIHBhdGg6ICcvdXNlcnMvMTIzJyxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICd1c2VyLWFnZW50JzogJ01vemlsbGEvNS4wJyxcbiAgICAgICAgICAnWC1Gb3J3YXJkZWQtRm9yJzogJzE5Mi4xNjguMS4xJ1xuICAgICAgICB9LFxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgICAgIGlkZW50aXR5OiB7XG4gICAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJ1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBhcyBhbnksXG4gICAgICBsYW1iZGFDb250ZXh0OiB7XG4gICAgICAgIGF3c1JlcXVlc3RJZDogJ2F3cy1yZXEtMTIzJyxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiAndXNlci1hcGknXG4gICAgICB9IGFzIGFueSxcbiAgICAgIHJlcXVlc3Q6IHtcbiAgICAgICAgcmVxdWVzdElkOiAncmVxLTEyMycsXG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICBwYXRoOiAnL3VzZXJzLzEyMycsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAnVXNlci1BZ2VudCc6ICdNb3ppbGxhLzUuMCcsXG4gICAgICAgICAgJ1gtRm9yd2FyZGVkLUZvcic6ICcxOTIuMTY4LjEuMSdcbiAgICAgICAgfVxuICAgICAgfSBhcyBhbnksXG4gICAgICByZXNwb25zZToge30gYXMgYW55LFxuICAgICAgYWN0b3I6IG1vY2tBY3RvcixcbiAgICAgIC4uLm92ZXJyaWRlc1xuICAgIH07XG4gIH1cblxuICBkZXNjcmliZSgnQVBJQ29udHJvbGxlciBBdWRpdCBJbnRlZ3JhdGlvbicsICgpID0+IHtcbiAgICBjbGFzcyBUZXN0QVBJQ29udHJvbGxlciBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICAgICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIEV4cG9zZSBwcm90ZWN0ZWQgbWV0aG9kcyBmb3IgdGVzdGluZ1xuICAgICAgcHVibGljIHRlc3RNYWtlQXVkaXRDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICByZXR1cm4gdGhpcy5tYWtlQXVkaXRDb250ZXh0KGN0eCk7XG4gICAgICB9XG5cbiAgICAgIHB1YmxpYyBhc3luYyB0ZXN0Q2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dDogYW55LCByZXF1ZXN0Q29udGV4dDogYW55KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHJlcXVlc3RDb250ZXh0KTtcbiAgICAgIH1cblxuICAgICAgcHVibGljIGFzeW5jIHRlc3RDYXB0dXJlRW5kKGF1ZGl0Q29udGV4dDogYW55LCByZXNwb25zZTogYW55LCBlcnJvcjogYW55KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCByZXNwb25zZSwgZXJyb3IpO1xuICAgICAgfVxuXG4gICAgICBwdWJsaWMgdGVzdEJ1aWxkUmVxdWVzdENvbnRleHQoY3R4OiBFeGVjdXRpb25Db250ZXh0LCBhdWRpdENvbmZpZzogYW55KSB7XG4gICAgICAgIHJldHVybiAodGhpcyBhcyBhbnkpLmJ1aWxkUmVxdWVzdENvbnRleHQoY3R4LCBhdWRpdENvbmZpZyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IGNvbnRyb2xsZXI6IFRlc3RBUElDb250cm9sbGVyO1xuXG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICBjb250cm9sbGVyID0gbmV3IFRlc3RBUElDb250cm9sbGVyKCk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnbWFrZUF1ZGl0Q29udGV4dCcsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgY3JlYXRlIGF1ZGl0IGNvbnRleHQgd2l0aCBwcm9wZXIgY29ycmVsYXRpb24gSUQgYW5kIG9wZXJhdGlvbiBJRCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgbW9ja1JlZmxlY3RHZXQubW9ja1JldHVyblZhbHVlKHsgYXVkaXQ6IHsgZW5hYmxlZDogdHJ1ZSwgY2F0ZWdvcnk6ICd1c2VyLW1hbmFnZW1lbnQnIH0gfSk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgpO1xuXG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQpLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgbG9nVHlwZTogJ2xvZycsXG4gICAgICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0JyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVGVzdEFQSUNvbnRyb2xsZXInLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2dldF8vdXNlcnMvMTIzJyxcbiAgICAgICAgICBjYXRlZ29yeTogJ3VzZXItbWFuYWdlbWVudCcsXG4gICAgICAgICAgYWN0b3I6IGN0eC5hY3RvcixcbiAgICAgICAgICBjb3JyZWxhdGlvbjoge1xuICAgICAgICAgICAgY29ycmVsYXRpb25JZDogJ3JlcS0xMjMnLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6ICdUZXN0QVBJQ29udHJvbGxlci5nZXRfL3VzZXJzLzEyMycsXG4gICAgICAgICAgICBvcGVyYXRpb25UeXBlOiAnYXBpJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbk5hbWU6ICdnZXRfL3VzZXJzLzEyMycsXG4gICAgICAgICAgICBzdGFydFRpbWVzdGFtcDogZXhwZWN0LnN0cmluZ01hdGNoaW5nKC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1UXFxkezJ9OlxcZHsyfTpcXGR7Mn1cXC5cXGR7M31aJC8pXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHJldHVybiBudWxsIHdoZW4gYXVkaXQgaXMgZGlzYWJsZWQnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZSh7IGF1ZGl0OiB7IGVuYWJsZWQ6IGZhbHNlIH0gfSk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgpO1xuXG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQpLnRvQmVOdWxsKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCB1c2UgZGVmYXVsdCBjb25maWcgd2hlbiBubyBhdWRpdCBjb25maWcgaXMgcHJlc2VudCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgbW9ja1JlZmxlY3RHZXQubW9ja1JldHVyblZhbHVlKHsgYXVkaXQ6IHsgZW5hYmxlZDogdHJ1ZSB9IH0pO1xuXG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNvbnRyb2xsZXIudGVzdE1ha2VBdWRpdENvbnRleHQoY3R4KTtcblxuICAgICAgICBleHBlY3QoYXVkaXRDb250ZXh0KS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGxvZ1R5cGU6ICdsb2cnLFxuICAgICAgICAgIHN1YlR5cGU6ICdhcGlfcmVxdWVzdCcsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ1Rlc3RBUElDb250cm9sbGVyJyxcbiAgICAgICAgICBhdWRpdENvbmZpZzoge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBpbmNsdWRlIGN1c3RvbSBzYW1wbGluZyBmdW5jdGlvbicsICgpID0+IHtcbiAgICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgY29uc3Qgc2FtcGxpbmdGbiA9IGNyZWF0ZUhhc2hCYXNlZFNhbXBsaW5nKDAuMSk7XG4gICAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZSh7IFxuICAgICAgICAgIGF1ZGl0OiB7IFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSwgXG4gICAgICAgICAgICBzYW1wbGluZ0ZuLFxuICAgICAgICAgICAgY3VzdG9tQ29udGV4dDogeyBmZWF0dXJlOiAndXNlci1hcGknLCB2ZXJzaW9uOiAnMS4yJyB9XG4gICAgICAgICAgfSBcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgpO1xuXG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmF1ZGl0Q29uZmlnLnNhbXBsaW5nRm4pLnRvQmUoc2FtcGxpbmdGbik7XG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmF1ZGl0Q29uZmlnLmN1c3RvbUNvbnRleHQpLnRvRXF1YWwoeyBmZWF0dXJlOiAndXNlci1hcGknLCB2ZXJzaW9uOiAnMS4yJyB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgZGVzY3JpYmUoJ2J1aWxkUmVxdWVzdENvbnRleHQnLCAoKSA9PiB7XG4gICAgICBpdCgnc2hvdWxkIGJ1aWxkIG1pbmltYWwgcmVxdWVzdCBjb250ZXh0IGJ5IGRlZmF1bHQnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnID0geyBlbmFibGVkOiB0cnVlIH07XG5cbiAgICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBjb250cm9sbGVyLnRlc3RCdWlsZFJlcXVlc3RDb250ZXh0KGN0eCwgYXVkaXRDb25maWcpO1xuXG4gICAgICAgIGV4cGVjdChyZXF1ZXN0Q29udGV4dCkudG9FcXVhbCh7XG4gICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICBwYXRoOiAnL3VzZXJzLzEyMycsXG4gICAgICAgICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAnLFxuICAgICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEnLFxuICAgICAgICAgIGhlYWRlcnM6IHVuZGVmaW5lZCxcbiAgICAgICAgICBib2R5OiB1bmRlZmluZWQsXG4gICAgICAgICAgcXVlcnk6IHVuZGVmaW5lZFxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIGluY2x1ZGUgaGVhZGVycyB3aGVuIGNvbmZpZ3VyZWQnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnID0ge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgaW5jbHVkZXM6IHsgcmVxdWVzdDogWydoZWFkZXJzJ10gfVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gY29udHJvbGxlci50ZXN0QnVpbGRSZXF1ZXN0Q29udGV4dChjdHgsIGF1ZGl0Q29uZmlnKTtcblxuICAgICAgICBleHBlY3QocmVxdWVzdENvbnRleHQpLnRvRXF1YWwoe1xuICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcGF0aDogJy91c2Vycy8xMjMnLFxuICAgICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wJyxcbiAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJyxcbiAgICAgICAgICBoZWFkZXJzOiBjdHgucmVxdWVzdC5oZWFkZXJzLFxuICAgICAgICAgIGJvZHk6IHVuZGVmaW5lZCxcbiAgICAgICAgICBxdWVyeTogdW5kZWZpbmVkXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgaW5jbHVkZSBtdWx0aXBsZSByZXF1ZXN0IHBhcnRzIHdoZW4gY29uZmlndXJlZCcsICgpID0+IHtcbiAgICAgICAgY29uc3QgYmFzZUN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICAuLi5iYXNlQ3R4LnJlcXVlc3QsXG4gICAgICAgICAgICBib2R5OiB7IHVzZXJJZDogJzEyMycgfSxcbiAgICAgICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBpbmNsdWRlOiAncHJvZmlsZScgfVxuICAgICAgICAgIH0gYXMgYW55XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBhdWRpdENvbmZpZyA9IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGluY2x1ZGVzOiB7IHJlcXVlc3Q6IFsnaGVhZGVycycsICdib2R5JywgJ3F1ZXJ5J10gfVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gY29udHJvbGxlci50ZXN0QnVpbGRSZXF1ZXN0Q29udGV4dChjdHgsIGF1ZGl0Q29uZmlnKTtcblxuICAgICAgICBleHBlY3QocmVxdWVzdENvbnRleHQpLnRvRXF1YWwoe1xuICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcGF0aDogJy91c2Vycy8xMjMnLFxuICAgICAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wJyxcbiAgICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJyxcbiAgICAgICAgICBoZWFkZXJzOiBjdHgucmVxdWVzdC5oZWFkZXJzLFxuICAgICAgICAgIGJvZHk6IHsgdXNlcklkOiAnMTIzJyB9LFxuICAgICAgICAgIHF1ZXJ5OiB7IGluY2x1ZGU6ICdwcm9maWxlJyB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnRW5kLXRvLUVuZCBBdWRpdCBJbnRlZ3JhdGlvbicsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgY2FwdHVyZSBzdGFydCBhdWRpdCBsb2cgd2l0aCByZWFsIGF1ZGl0IGxvZ2dlcicsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0ge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgbG9nVHlwZTogJ2F1ZGl0JyBhcyBjb25zdCxcbiAgICAgICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3QnLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdUZXN0QVBJQ29udHJvbGxlcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZ2V0VXNlcicsXG4gICAgICAgICAgY2F0ZWdvcnk6ICd1c2VyLW1hbmFnZW1lbnQnLFxuICAgICAgICAgIGFjdG9yOiBjdHguYWN0b3IsXG4gICAgICAgICAgY29ycmVsYXRpb246IHtcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLTEyMycsXG4gICAgICAgICAgICBvcGVyYXRpb25JZDogJ1Rlc3RBUElDb250cm9sbGVyLmdldFVzZXInLFxuICAgICAgICAgICAgb3BlcmF0aW9uVHlwZTogJ2FwaScgYXMgY29uc3QsXG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiAnZ2V0VXNlcicsXG4gICAgICAgICAgICBzdGFydFRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWidcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0Q29uZmlnOiB7IFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGRhdGFQcm90ZWN0aW9uOiB7XG4gICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIHJlZGFjdFBJSTogdHJ1ZSxcbiAgICAgICAgICAgICAgcmVkYWN0U2Vuc2l0aXZlRmllbGRzOiB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IHtcbiAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgIHBhdGg6ICcvdXNlcnMvMTIzJyxcbiAgICAgICAgICB1c2VyQWdlbnQ6ICdNb3ppbGxhLzUuMCcsXG4gICAgICAgICAgc291cmNlSXA6ICcxOTIuMTY4LjEuMSdcbiAgICAgICAgfTtcblxuICAgICAgICBhd2FpdCBjb250cm9sbGVyLnRlc3RDYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCByZXF1ZXN0Q29udGV4dCk7XG5cbiAgICAgICAgLy8gVmVyaWZ5IHRoZSBmYWN0b3J5IHdhcyBjYWxsZWQgdG8gY3JlYXRlIGEgbG9nZ2VyXG4gICAgICAgIGV4cGVjdChtb2NrRmFjdG9yeUluc3RhbmNlLmNyZWF0ZSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgICBcbiAgICAgICAgLy8gVmVyaWZ5IHRoZSByZWFsIGF1ZGl0IGVudHJ5IHN0cnVjdHVyZVxuICAgICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgICAgZW5hYmxlZDogdW5kZWZpbmVkLFxuICAgICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3Rfc3RhcnQnLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogJ1Rlc3RBUElDb250cm9sbGVyJyxcbiAgICAgICAgICAgIGV2ZW50VHlwZTogJ3N0YXJ0JyxcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2dldFVzZXInLFxuICAgICAgICAgICAgY2F0ZWdvcnk6ICd1c2VyLW1hbmFnZW1lbnQnLFxuICAgICAgICAgICAgc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLTEyMycsXG4gICAgICAgICAgICBhY3RvcjogY3R4LmFjdG9yLFxuICAgICAgICAgICAgY29udGV4dDoge1xuICAgICAgICAgICAgICBjb3JyZWxhdGlvbjogYXVkaXRDb250ZXh0LmNvcnJlbGF0aW9uLFxuICAgICAgICAgICAgICBhcGk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgICAgIHBhdGg6ICcvdXNlcnMvMTIzJyxcbiAgICAgICAgICAgICAgICB1c2VyQWdlbnQ6ICdNb3ppbGxhLzUuMCcsXG4gICAgICAgICAgICAgICAgc291cmNlSXA6ICcxOTIuMTY4LjEuMScgLy8gRGF0YSBwcm90ZWN0aW9uIHJlZGFjdHMgSVAgYWRkcmVzc2VzXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBjYXB0dXJlIGVuZCBhdWRpdCBsb2cgd2l0aCByZXNwb25zZSBjb250ZXh0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSB7XG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBsb2dUeXBlOiAnYXVkaXQnIGFzIGNvbnN0LFxuICAgICAgICAgIHN1YlR5cGU6ICdhcGlfcmVxdWVzdCcsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ1Rlc3RBUElDb250cm9sbGVyJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdnZXRVc2VyJyxcbiAgICAgICAgICBjYXRlZ29yeTogJ3VzZXItbWFuYWdlbWVudCcsXG4gICAgICAgICAgY29ycmVsYXRpb246IHtcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLTEyMycsXG4gICAgICAgICAgICBvcGVyYXRpb25JZDogJ1Rlc3RBUElDb250cm9sbGVyLmdldFVzZXInLFxuICAgICAgICAgICAgb3BlcmF0aW9uVHlwZTogJ2FwaScgYXMgY29uc3QsXG4gICAgICAgICAgICBvcGVyYXRpb25OYW1lOiAnZ2V0VXNlcicsXG4gICAgICAgICAgICBzdGFydFRpbWVzdGFtcDogJzIwMjQtMDEtMTVUMTA6MzA6MDAuMDAwWidcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0Q29uZmlnOiB7IGVuYWJsZWQ6IHRydWUgfVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyB1c2VyczogW3sgaWQ6ICcxMjMnIH1dIH0pXG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgY29udHJvbGxlci50ZXN0Q2FwdHVyZUVuZChhdWRpdENvbnRleHQsIHJlc3BvbnNlLCBudWxsKTtcblxuICAgICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh7XG4gICAgICAgICAgZW5hYmxlZDogdW5kZWZpbmVkLFxuICAgICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3RfY29tcGxldGUnLFxuICAgICAgICAgICAgZW50aXR5TmFtZTogJ1Rlc3RBUElDb250cm9sbGVyJyxcbiAgICAgICAgICAgIGV2ZW50VHlwZTogJ2NvbXBsZXRlJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2dldFVzZXInLFxuICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICAgICAgbWV0cmljczogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgICAgICBkdXJhdGlvbjogZXhwZWN0LmFueShOdW1iZXIpLFxuICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgICAgICAgIHJlc3BvbnNlU2l6ZTogZXhwZWN0LmFueShOdW1iZXIpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgY2FwdHVyZSBlcnJvciBhdWRpdCBsb2cgd2hlbiByZXF1ZXN0IGZhaWxzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSB7XG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBsb2dUeXBlOiAnYXVkaXQnIGFzIGNvbnN0LFxuICAgICAgICAgIHN1YlR5cGU6ICdhcGlfcmVxdWVzdCcsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ1Rlc3RBUElDb250cm9sbGVyJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdnZXRVc2VyJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbjoge1xuICAgICAgICAgICAgY29ycmVsYXRpb25JZDogJ2NvcnItMTIzJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbklkOiAnVGVzdEFQSUNvbnRyb2xsZXIuZ2V0VXNlcicsXG4gICAgICAgICAgICBvcGVyYXRpb25UeXBlOiAnYXBpJyBhcyBjb25zdCxcbiAgICAgICAgICAgIG9wZXJhdGlvbk5hbWU6ICdnZXRVc2VyJyxcbiAgICAgICAgICAgIHN0YXJ0VGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgYXVkaXRDb25maWc6IHsgXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZGF0YVByb3RlY3Rpb246IHtcbiAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgcmVkYWN0UElJOiB0cnVlLFxuICAgICAgICAgICAgICByZWRhY3RTZW5zaXRpdmVGaWVsZHM6IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdVc2VyIG5vdCBmb3VuZCcpO1xuICAgICAgICBlcnJvci5zdGFjayA9ICdFcnJvcjogVXNlciBub3QgZm91bmRcXG4gICAgYXQgZ2V0VXNlckJ5SWQuLi4nO1xuXG4gICAgICAgIGNvbnN0IG1vY2tSZXNwb25zZSA9IHsgc3RhdHVzQ29kZTogNTAwLCBib2R5OiAnJyB9O1xuICAgICAgICBhd2FpdCBjb250cm9sbGVyLnRlc3RDYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgbW9ja1Jlc3BvbnNlLCBlcnJvcik7XG5cbiAgICAgICAgZXhwZWN0KG1vY2tBdWRpdExvZ2dlci5hdWRpdCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoe1xuICAgICAgICAgIGVuYWJsZWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICBsb2dUeXBlOiAnYXVkaXQnLFxuICAgICAgICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0X2Vycm9yJyxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6ICdUZXN0QVBJQ29udHJvbGxlcicsXG4gICAgICAgICAgICBldmVudFR5cGU6ICdlcnJvcicsXG4gICAgICAgICAgICBvcGVyYXRpb246ICdnZXRVc2VyJyxcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJyxcbiAgICAgICAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBlcnJvcjogZXhwZWN0LmFueShPYmplY3QpIC8vIERhdGEgcHJvdGVjdGlvbiBzYW5pdGl6ZXMgZXJyb3Igb2JqZWN0c1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGl0KCdzaG91bGQgaGFuZGxlIGF1ZGl0IGxvZ2dlciBmYWlsdXJlcyBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBtb2NrQXVkaXRMb2dnZXIuYXVkaXQubW9ja1JlamVjdGVkVmFsdWVPbmNlKG5ldyBFcnJvcignQXVkaXQgbG9nZ2VyIGZhaWxlZCcpKTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGxvZ1R5cGU6ICdhdWRpdCcgYXMgY29uc3QsXG4gICAgICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0JyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVGVzdEFQSUNvbnRyb2xsZXInLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2dldFVzZXInLFxuICAgICAgICAgIGNvcnJlbGF0aW9uOiB7XG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY29yci0xMjMnLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6ICdUZXN0QVBJQ29udHJvbGxlci5nZXRVc2VyJyxcbiAgICAgICAgICAgIG9wZXJhdGlvblR5cGU6ICdhcGknIGFzIGNvbnN0LFxuICAgICAgICAgICAgb3BlcmF0aW9uTmFtZTogJ2dldFVzZXInLFxuICAgICAgICAgICAgc3RhcnRUaW1lc3RhbXA6ICcyMDI0LTAxLTE1VDEwOjMwOjAwLjAwMFonXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdWRpdENvbmZpZzogeyBlbmFibGVkOiB0cnVlIH1cbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSB7XG4gICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICBwYXRoOiAnL3VzZXJzLzEyMycsXG4gICAgICAgICAgdXNlckFnZW50OiAnTW96aWxsYS81LjAnLFxuICAgICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEnXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gU2hvdWxkIG5vdCB0aHJvd1xuICAgICAgICBhd2FpdCBleHBlY3QoY29udHJvbGxlci50ZXN0Q2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcmVxdWVzdENvbnRleHQpKS5yZXNvbHZlcy50b0JlVW5kZWZpbmVkKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBTaG91bGQgc3RpbGwgYXR0ZW1wdCB0byBhdWRpdFxuICAgICAgICBleHBlY3QobW9ja0F1ZGl0TG9nZ2VyLmF1ZGl0KS50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBTaG91bGQgbG9nIHRoZSBlcnJvciB0byBjb25zb2xlXG4gICAgICAgIGV4cGVjdChjb25zb2xlRXJyb3JTcHkpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICAgICdGYWlsZWQgdG8gY2FwdHVyZSBhdWRpdCBsb2c6JyxcbiAgICAgICAgICBleHBlY3QuYW55KEVycm9yKSxcbiAgICAgICAgICBleHBlY3QuYW55KE9iamVjdClcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnUXVldWVDb250cm9sbGVyIEF1ZGl0IEludGVncmF0aW9uJywgKCkgPT4ge1xuICAgIGNsYXNzIFRlc3RRdWV1ZUNvbnRyb2xsZXIgZXh0ZW5kcyBRdWV1ZUNvbnRyb2xsZXIge1xuICAgICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIEV4cG9zZSBwcm90ZWN0ZWQgbWV0aG9kcyBmb3IgdGVzdGluZ1xuICAgICAgcHVibGljIHRlc3RNYWtlQXVkaXRDb250ZXh0KGV2ZW50OiBTUVNFdmVudCwgY29udGV4dDogQ29udGV4dCkge1xuICAgICAgICByZXR1cm4gdGhpcy5tYWtlQXVkaXRDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgICAgIH1cblxuICAgICAgcHVibGljIHRlc3RFeHRyYWN0Q29ycmVsYXRpb25Gcm9tTWVzc2FnZXMoZXZlbnQ6IFNRU0V2ZW50KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmV4dHJhY3RDb3JyZWxhdGlvbkZyb21NZXNzYWdlcyhldmVudCk7XG4gICAgICB9XG5cbiAgICAgIHB1YmxpYyB0ZXN0RXh0cmFjdFBhcmVudE9wZXJhdGlvbkZyb21NZXNzYWdlcyhldmVudDogU1FTRXZlbnQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZXh0cmFjdFBhcmVudE9wZXJhdGlvbkZyb21NZXNzYWdlcyhldmVudCk7XG4gICAgICB9XG5cbiAgICAgIGFzeW5jIGluaXRpYWxpemUoKSB7XG4gICAgICAgIC8vIFRlc3QgaW1wbGVtZW50YXRpb25cbiAgICAgIH1cblxuICAgICAgYXN5bmMgcHJvY2VzcygpIHtcbiAgICAgICAgLy8gVGVzdCBpbXBsZW1lbnRhdGlvblxuICAgICAgfVxuXG4gICAgICBhc3luYyBwcm9jZXNzUmVjb3JkKCkge1xuICAgICAgICByZXR1cm4geyBwcm9jZXNzZWQ6IHRydWUgfTtcbiAgICAgIH1cblxuICAgICAgLy8gT3ZlcnJpZGUgZm9yIHRlc3RpbmdcbiAgICAgIHByb3RlY3RlZCBnZXRRdWV1ZU5hbWUoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5nZXRRdWV1ZUNvbmZpZygpO1xuICAgICAgICByZXR1cm4gKGNvbmZpZyBhcyBhbnkpLnF1ZXVlTmFtZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgY29udHJvbGxlcjogVGVzdFF1ZXVlQ29udHJvbGxlcjtcblxuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgY29udHJvbGxlciA9IG5ldyBUZXN0UXVldWVDb250cm9sbGVyKCk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnbWFrZUF1ZGl0Q29udGV4dCcsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgY3JlYXRlIGF1ZGl0IGNvbnRleHQgZm9yIHF1ZXVlIHByb2Nlc3NpbmcnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja1NRU0V2ZW50KCk7XG4gICAgICAgIGNvbnN0IGNvbnRleHQgPSBjcmVhdGVNb2NrTGFtYmRhQ29udGV4dCgpO1xuICAgICAgICBtb2NrUmVmbGVjdEdldC5tb2NrUmV0dXJuVmFsdWUoeyBhdWRpdDogeyBlbmFibGVkOiB0cnVlLCBjYXRlZ29yeTogJ3F1ZXVlLXByb2Nlc3NpbmcnIH0sIHF1ZXVlTmFtZTogJ3VzZXItbm90aWZpY2F0aW9ucycgfSk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChldmVudCwgY29udGV4dCk7XG5cbiAgICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dCkudG9NYXRjaE9iamVjdCh7XG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBsb2dUeXBlOiAnZXZlbnQnLFxuICAgICAgICAgIHN1YlR5cGU6ICdxdWV1ZV9wcm9jZXNzaW5nJyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVGVzdFF1ZXVlQ29udHJvbGxlcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAndXNlci1ub3RpZmljYXRpb25zJyxcbiAgICAgICAgICBjYXRlZ29yeTogJ3F1ZXVlLXByb2Nlc3NpbmcnLFxuICAgICAgICAgIGNvcnJlbGF0aW9uOiB7XG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiAncGFyZW50LWNvcnItMTIzJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbklkOiAnVGVzdFF1ZXVlQ29udHJvbGxlci51c2VyLW5vdGlmaWNhdGlvbnMnLFxuICAgICAgICAgICAgcGFyZW50T3BlcmF0aW9uSWQ6ICdBUElDb250cm9sbGVyLmNyZWF0ZVVzZXInLFxuICAgICAgICAgICAgb3BlcmF0aW9uVHlwZTogJ3F1ZXVlJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbk5hbWU6ICd1c2VyLW5vdGlmaWNhdGlvbnMnXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIGdlbmVyYXRlIG5ldyBjb3JyZWxhdGlvbiBJRCB3aGVuIG5vdCBmb3VuZCBpbiBtZXNzYWdlcycsICgpID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSB7XG4gICAgICAgICAgUmVjb3JkczogW3tcbiAgICAgICAgICAgIC4uLmNyZWF0ZU1vY2tTUVNFdmVudCgpLlJlY29yZHNbMF0sXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGE6ICdubyBjb3JyZWxhdGlvbicgfSlcbiAgICAgICAgICB9XVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCBjb250ZXh0ID0gY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKTtcbiAgICAgICAgbW9ja1JlZmxlY3RHZXQubW9ja1JldHVyblZhbHVlKHsgYXVkaXQ6IHsgZW5hYmxlZDogdHJ1ZSB9IH0pO1xuXG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNvbnRyb2xsZXIudGVzdE1ha2VBdWRpdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmNvcnJlbGF0aW9uLmNvcnJlbGF0aW9uSWQpLnRvQmUoJ2xhbWJkYS1yZXEtNDU2Jyk7XG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmNvcnJlbGF0aW9uLnBhcmVudE9wZXJhdGlvbklkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCByZXR1cm4gbnVsbCB3aGVuIGF1ZGl0IGlzIGRpc2FibGVkJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tTUVNFdmVudCgpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0gY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKTtcbiAgICAgICAgbW9ja1JlZmxlY3RHZXQubW9ja1JldHVyblZhbHVlKHsgYXVkaXQ6IHsgZW5hYmxlZDogZmFsc2UgfSB9KTtcblxuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjb250cm9sbGVyLnRlc3RNYWtlQXVkaXRDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcblxuICAgICAgICBleHBlY3QoYXVkaXRDb250ZXh0KS50b0JlTnVsbCgpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBkZXNjcmliZSgnY29ycmVsYXRpb24gZXh0cmFjdGlvbicsICgpID0+IHtcbiAgICAgIGl0KCdzaG91bGQgZXh0cmFjdCBjb3JyZWxhdGlvbiBJRCBmcm9tIG1lc3NhZ2UgYm9kaWVzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tTUVNFdmVudCgpO1xuXG4gICAgICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBjb250cm9sbGVyLnRlc3RFeHRyYWN0Q29ycmVsYXRpb25Gcm9tTWVzc2FnZXMoZXZlbnQpO1xuXG4gICAgICAgIGV4cGVjdChjb3JyZWxhdGlvbklkKS50b0JlKCdwYXJlbnQtY29yci0xMjMnKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIGV4dHJhY3QgcGFyZW50IG9wZXJhdGlvbiBJRCBmcm9tIG1lc3NhZ2UgYm9kaWVzJywgKCkgPT4ge1xuICAgICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tTUVNFdmVudCgpO1xuXG4gICAgICAgIGNvbnN0IHBhcmVudE9wZXJhdGlvbklkID0gY29udHJvbGxlci50ZXN0RXh0cmFjdFBhcmVudE9wZXJhdGlvbkZyb21NZXNzYWdlcyhldmVudCk7XG5cbiAgICAgICAgZXhwZWN0KHBhcmVudE9wZXJhdGlvbklkKS50b0JlKCdBUElDb250cm9sbGVyLmNyZWF0ZVVzZXInKTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHJldHVybiBudWxsIGZvciBpbnZhbGlkIEpTT04gaW4gbWVzc2FnZSBib2R5JywgKCkgPT4ge1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICBSZWNvcmRzOiBbe1xuICAgICAgICAgICAgLi4uY3JlYXRlTW9ja1NRU0V2ZW50KCkuUmVjb3Jkc1swXSxcbiAgICAgICAgICAgIGJvZHk6ICdpbnZhbGlkIGpzb257J1xuICAgICAgICAgIH1dXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGNvbnRyb2xsZXIudGVzdEV4dHJhY3RDb3JyZWxhdGlvbkZyb21NZXNzYWdlcyhldmVudCk7XG4gICAgICAgIGNvbnN0IHBhcmVudE9wZXJhdGlvbklkID0gY29udHJvbGxlci50ZXN0RXh0cmFjdFBhcmVudE9wZXJhdGlvbkZyb21NZXNzYWdlcyhldmVudCk7XG5cbiAgICAgICAgZXhwZWN0KGNvcnJlbGF0aW9uSWQpLnRvQmVOdWxsKCk7XG4gICAgICAgIGV4cGVjdChwYXJlbnRPcGVyYXRpb25JZCkudG9CZU51bGwoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnVGFza0NvbnRyb2xsZXIgQXVkaXQgSW50ZWdyYXRpb24nLCAoKSA9PiB7XG4gICAgY2xhc3MgVGVzdFRhc2tDb250cm9sbGVyIGV4dGVuZHMgVGFza0NvbnRyb2xsZXIge1xuICAgICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIEV4cG9zZSBwcm90ZWN0ZWQgbWV0aG9kcyBmb3IgdGVzdGluZ1xuICAgICAgcHVibGljIHRlc3RNYWtlQXVkaXRDb250ZXh0KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5tYWtlQXVkaXRDb250ZXh0KCk7XG4gICAgICB9XG5cbiAgICAgIGFzeW5jIGluaXRpYWxpemUoKSB7XG4gICAgICAgIC8vIFRlc3QgaW1wbGVtZW50YXRpb25cbiAgICAgIH1cblxuICAgICAgYXN5bmMgcHJvY2VzcygpIHtcbiAgICAgICAgLy8gVGVzdCBpbXBsZW1lbnRhdGlvblxuICAgICAgfVxuXG4gICAgICBhc3luYyBleGVjdXRlKCkge1xuICAgICAgICByZXR1cm4geyB0YXNrQ29tcGxldGVkOiB0cnVlIH07XG4gICAgICB9XG5cbiAgICAgIC8vIE92ZXJyaWRlIGZvciB0ZXN0aW5nXG4gICAgICBwcm90ZWN0ZWQgZ2V0VGFza05hbWUoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5nZXRUYXNrQ29uZmlnKCk7XG4gICAgICAgIHJldHVybiAoY29uZmlnIGFzIGFueSkudGFza05hbWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IGNvbnRyb2xsZXI6IFRlc3RUYXNrQ29udHJvbGxlcjtcblxuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgY29udHJvbGxlciA9IG5ldyBUZXN0VGFza0NvbnRyb2xsZXIoKTtcbiAgICB9KTtcblxuICAgIGRlc2NyaWJlKCdtYWtlQXVkaXRDb250ZXh0JywgKCkgPT4ge1xuICAgICAgaXQoJ3Nob3VsZCBjcmVhdGUgYXVkaXQgY29udGV4dCBmb3Igc2NoZWR1bGVkIHRhc2snLCAoKSA9PiB7XG4gICAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZSh7IFxuICAgICAgICAgIGF1ZGl0OiB7IGVuYWJsZWQ6IHRydWUsIGNhdGVnb3J5OiAnZGF0YS1wcm9jZXNzaW5nJyB9LFxuICAgICAgICAgIHRhc2tOYW1lOiAnZGFpbHktcmVwb3J0JyxcbiAgICAgICAgICBzY2hlZHVsZTogJ2Nyb24oMCA5ICogKiA/ICopJ1xuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjb250cm9sbGVyLnRlc3RNYWtlQXVkaXRDb250ZXh0KCk7XG5cbiAgICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dCkudG9NYXRjaE9iamVjdCh7XG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBsb2dUeXBlOiAnZXZlbnQnLFxuICAgICAgICAgIHN1YlR5cGU6ICd0YXNrX2V4ZWN1dGlvbicsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ1Rlc3RUYXNrQ29udHJvbGxlcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZGFpbHktcmVwb3J0JyxcbiAgICAgICAgICBjYXRlZ29yeTogJ2RhdGEtcHJvY2Vzc2luZycsXG4gICAgICAgICAgYWN0b3I6IHtcbiAgICAgICAgICAgIGFjdG9ySWQ6ICdzY2hlZHVsZXInLFxuICAgICAgICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICAgICAgICBhdXRoTWV0aG9kOiAnc3lzdGVtJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgY29ycmVsYXRpb246IHtcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IGV4cGVjdC5zdHJpbmdNYXRjaGluZygvXlRlc3RUYXNrQ29udHJvbGxlclxcLmRhaWx5LXJlcG9ydC1cXGQrJC8pLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6ICdUZXN0VGFza0NvbnRyb2xsZXIuZGFpbHktcmVwb3J0JyxcbiAgICAgICAgICAgIG9wZXJhdGlvblR5cGU6ICd0YXNrJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbk5hbWU6ICdkYWlseS1yZXBvcnQnXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpdCgnc2hvdWxkIHJldHVybiBudWxsIHdoZW4gYXVkaXQgaXMgZGlzYWJsZWQnLCAoKSA9PiB7XG4gICAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZSh7IGF1ZGl0OiB7IGVuYWJsZWQ6IGZhbHNlIH0gfSk7XG5cbiAgICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dCgpO1xuXG4gICAgICAgIGV4cGVjdChhdWRpdENvbnRleHQpLnRvQmVOdWxsKCk7XG4gICAgICB9KTtcblxuICAgICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWlzc2luZyB0YXNrIGNvbmZpZ3VyYXRpb24gZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgICAgbW9ja1JlZmxlY3RHZXQubW9ja1JldHVyblZhbHVlKHsgYXVkaXQ6IHsgZW5hYmxlZDogdHJ1ZSB9IH0pO1xuXG4gICAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNvbnRyb2xsZXIudGVzdE1ha2VBdWRpdENvbnRleHQoKTtcblxuICAgICAgICBleHBlY3QoYXVkaXRDb250ZXh0KS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGxvZ1R5cGU6ICdldmVudCcsXG4gICAgICAgICAgc3ViVHlwZTogJ3Rhc2tfZXhlY3V0aW9uJyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVGVzdFRhc2tDb250cm9sbGVyJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdleGVjdXRlJyAvLyBEZWZhdWx0IG9wZXJhdGlvbiBuYW1lXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDcm9zcy1Db250cm9sbGVyIEludGVncmF0aW9uIFNjZW5hcmlvcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIG1haW50YWluIGNvcnJlbGF0aW9uIGFjcm9zcyBBUEkgLT4gUXVldWUgd29ya2Zsb3cnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTaW11bGF0ZSBBUEkgcmVxdWVzdCBjcmVhdGluZyBhIHF1ZXVlIG1lc3NhZ2VcbiAgICAgIGNvbnN0IGFwaUNvbnRyb2xsZXIgPSBuZXcgKGNsYXNzIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG4gICAgICAgIHB1YmxpYyB0ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHg6IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5tYWtlQXVkaXRDb250ZXh0KGN0eCk7XG4gICAgICAgIH1cbiAgICAgIH0pKCk7XG5cbiAgICAgIGNvbnN0IHF1ZXVlQ29udHJvbGxlciA9IG5ldyAoY2xhc3MgZXh0ZW5kcyBRdWV1ZUNvbnRyb2xsZXIge1xuICAgICAgICBwdWJsaWMgdGVzdE1ha2VBdWRpdENvbnRleHQoZXZlbnQ6IFNRU0V2ZW50LCBjb250ZXh0OiBDb250ZXh0KSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMubWFrZUF1ZGl0Q29udGV4dChldmVudCwgY29udGV4dCk7XG4gICAgICAgIH1cbiAgICAgICAgYXN5bmMgaW5pdGlhbGl6ZSgpIHt9XG4gICAgICAgIGFzeW5jIHByb2Nlc3MoKSB7fVxuICAgICAgICBhc3luYyBwcm9jZXNzUmVjb3JkKCkgeyByZXR1cm4ge307IH1cbiAgICAgIH0pKCk7XG5cbiAgICAgIC8vIEFQSSByZXF1ZXN0XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgbW9ja1JlZmxlY3RHZXQubW9ja1JldHVyblZhbHVlKHsgYXVkaXQ6IHsgZW5hYmxlZDogdHJ1ZSB9IH0pO1xuICAgICAgXG4gICAgICBjb25zdCBhcGlBdWRpdENvbnRleHQgPSBhcGlDb250cm9sbGVyLnRlc3RNYWtlQXVkaXRDb250ZXh0KGN0eCk7XG4gICAgICBleHBlY3QoYXBpQXVkaXRDb250ZXh0Py5jb3JyZWxhdGlvbi5vcGVyYXRpb25UeXBlKS50b0JlKCdhcGknKTtcbiAgICAgIGV4cGVjdChhcGlBdWRpdENvbnRleHQ/LmNvcnJlbGF0aW9uLmNvcnJlbGF0aW9uSWQpLnRvQmUoJ3JlcS0xMjMnKTtcblxuICAgICAgLy8gUXVldWUgcHJvY2Vzc2luZyB3aXRoIGNvcnJlbGF0aW9uIGZyb20gQVBJXG4gICAgICBjb25zdCBxdWV1ZUV2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbe1xuICAgICAgICAgIC4uLmNyZWF0ZU1vY2tTUVNFdmVudCgpLlJlY29yZHNbMF0sXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgY29ycmVsYXRpb25JZDogYXBpQXVkaXRDb250ZXh0Py5jb3JyZWxhdGlvbi5jb3JyZWxhdGlvbklkLFxuICAgICAgICAgICAgcGFyZW50T3BlcmF0aW9uSWQ6IGFwaUF1ZGl0Q29udGV4dD8uY29ycmVsYXRpb24ub3BlcmF0aW9uSWRcbiAgICAgICAgICB9KVxuICAgICAgICB9XVxuICAgICAgfTtcbiAgICAgIFxuICAgICAgY29uc3QgcXVldWVBdWRpdENvbnRleHQgPSBxdWV1ZUNvbnRyb2xsZXIudGVzdE1ha2VBdWRpdENvbnRleHQocXVldWVFdmVudCwgY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChxdWV1ZUF1ZGl0Q29udGV4dD8uY29ycmVsYXRpb24uY29ycmVsYXRpb25JZCkudG9CZShhcGlBdWRpdENvbnRleHQ/LmNvcnJlbGF0aW9uLmNvcnJlbGF0aW9uSWQpO1xuICAgICAgZXhwZWN0KHF1ZXVlQXVkaXRDb250ZXh0Py5jb3JyZWxhdGlvbi5wYXJlbnRPcGVyYXRpb25JZCkudG9CZShhcGlBdWRpdENvbnRleHQ/LmNvcnJlbGF0aW9uLm9wZXJhdGlvbklkKTtcbiAgICAgIGV4cGVjdChxdWV1ZUF1ZGl0Q29udGV4dD8uY29ycmVsYXRpb24ub3BlcmF0aW9uVHlwZSkudG9CZSgncXVldWUnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGRpZmZlcmVudCBhdWRpdCBjb25maWd1cmF0aW9ucyBhY3Jvc3MgY29udHJvbGxlcnMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBhcGlDb250cm9sbGVyID0gbmV3IChjbGFzcyBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICAgICAgICBwdWJsaWMgdGVzdE1ha2VBdWRpdENvbnRleHQoY3R4OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMubWFrZUF1ZGl0Q29udGV4dChjdHgpO1xuICAgICAgICB9XG4gICAgICB9KSgpO1xuXG4gICAgICBjb25zdCB0YXNrQ29udHJvbGxlciA9IG5ldyAoY2xhc3MgZXh0ZW5kcyBUYXNrQ29udHJvbGxlciB7XG4gICAgICAgIHB1YmxpYyB0ZXN0TWFrZUF1ZGl0Q29udGV4dCgpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5tYWtlQXVkaXRDb250ZXh0KCk7XG4gICAgICAgIH1cbiAgICAgICAgYXN5bmMgaW5pdGlhbGl6ZSgpIHt9XG4gICAgICAgIGFzeW5jIHByb2Nlc3MoKSB7fVxuICAgICAgICBhc3luYyBleGVjdXRlKCkgeyByZXR1cm4ge307IH1cbiAgICAgIH0pKCk7XG5cbiAgICAgIC8vIEFQSSB3aXRoIGRldGFpbGVkIGF1ZGl0IGNvbmZpZ1xuICAgICAgbW9ja1JlZmxlY3RHZXQubW9ja1JldHVyblZhbHVlT25jZSh7IFxuICAgICAgICBhdWRpdDogeyBcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLCBcbiAgICAgICAgICBza2lwU3RhcnQ6IGZhbHNlLFxuICAgICAgICAgIHNraXBFbmQ6IHRydWUsXG4gICAgICAgICAgc2FtcGxpbmdGbjogY3JlYXRlSGFzaEJhc2VkU2FtcGxpbmcoMC4xKSxcbiAgICAgICAgICBpbmNsdWRlczogeyByZXF1ZXN0OiBbJ2hlYWRlcnMnLCAnYm9keSddLCByZXNwb25zZTogdHJ1ZSB9XG4gICAgICAgIH0gXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgY29uc3QgYXBpQXVkaXRDb250ZXh0ID0gYXBpQ29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dCgpKTtcblxuICAgICAgLy8gVGFzayB3aXRoIG1pbmltYWwgYXVkaXQgY29uZmlnXG4gICAgICBtb2NrUmVmbGVjdEdldC5tb2NrUmV0dXJuVmFsdWVPbmNlKHsgXG4gICAgICAgIGF1ZGl0OiB7IFxuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgc2tpcFN0YXJ0OiB0cnVlLFxuICAgICAgICAgIHNraXBFbmQ6IGZhbHNlLFxuICAgICAgICAgIGNhdGVnb3J5OiAnYmFja2dyb3VuZC1qb2JzJ1xuICAgICAgICB9IFxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGNvbnN0IHRhc2tBdWRpdENvbnRleHQgPSB0YXNrQ29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dCgpO1xuXG4gICAgICBleHBlY3QoYXBpQXVkaXRDb250ZXh0Py5hdWRpdENvbmZpZy5za2lwRW5kKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGFwaUF1ZGl0Q29udGV4dD8uYXVkaXRDb25maWcuaW5jbHVkZXMpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QodGFza0F1ZGl0Q29udGV4dD8uYXVkaXRDb25maWcuc2tpcFN0YXJ0KS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KHRhc2tBdWRpdENvbnRleHQ/LmNhdGVnb3J5KS50b0JlKCdiYWNrZ3JvdW5kLWpvYnMnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVzcGVjdCBzYW1wbGluZyBjb25maWd1cmF0aW9uIGluIHJlYWwgYXVkaXQgaW50ZWdyYXRpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzYW1wbGluZ0ZuID0gY3JlYXRlSGFzaEJhc2VkU2FtcGxpbmcoMC4wKTsgLy8gMCUgc2FtcGxpbmcgLSBzaG91bGQgc2tpcCBhbGxcbiAgICAgIFxuICAgICAgY29uc3QgYXBpQ29udHJvbGxlciA9IG5ldyAoY2xhc3MgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgICAgICAgcHVibGljIHRlc3RNYWtlQXVkaXRDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLm1ha2VBdWRpdENvbnRleHQoY3R4KTtcbiAgICAgICAgfVxuICAgICAgICBwdWJsaWMgYXN5bmMgdGVzdENhcHR1cmVTdGFydChhdWRpdENvbnRleHQ6IGFueSwgcmVxdWVzdENvbnRleHQ6IGFueSkge1xuICAgICAgICAgIHJldHVybiB0aGlzLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHJlcXVlc3RDb250ZXh0KTtcbiAgICAgICAgfVxuICAgICAgfSkoKTtcblxuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgIG1vY2tSZWZsZWN0R2V0Lm1vY2tSZXR1cm5WYWx1ZSh7IFxuICAgICAgICBhdWRpdDogeyBcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHNhbXBsaW5nRm5cbiAgICAgICAgfSBcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBhcGlDb250cm9sbGVyLnRlc3RNYWtlQXVkaXRDb250ZXh0KGN0eCk7XG4gICAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IHtcbiAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgcGF0aDogJy91c2Vycy8xMjMnLFxuICAgICAgICB1c2VyQWdlbnQ6ICdNb3ppbGxhLzUuMCcsXG4gICAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEnXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBhcGlDb250cm9sbGVyLnRlc3RDYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCByZXF1ZXN0Q29udGV4dCk7XG5cbiAgICAgIC8vIFNob3VsZCBub3QgaGF2ZSBjYWxsZWQgdGhlIGF1ZGl0IGxvZ2dlciBkdWUgdG8gMCUgc2FtcGxpbmdcbiAgICAgIGV4cGVjdChtb2NrQXVkaXRMb2dnZXIuYXVkaXQpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgfSk7XG4gIH0pO1xufSk7Il19