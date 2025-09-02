"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_gateway_controller_1 = require("./api-gateway-controller");
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
const mockReflectSet = jest.fn();
global.Reflect = {
    ...global.Reflect,
    get: mockReflectGet,
    set: mockReflectSet
};
// Test controller for method-level audit functionality
class TestMethodAuditController extends api_gateway_controller_1.APIController {
    controllerAuditConfig = {
        enabled: true,
        category: 'controller-level',
        includes: {
            request: ['headers'],
            response: ['headers']
        },
        dataProtection: {
            enabled: true,
            deepRedact: {
                blacklistedKeys: ['password', 'secret']
            }
        }
    };
    getControllerConfig() {
        return {
            audit: this.controllerAuditConfig
        };
    }
    // Expose the private method for testing
    testMergeAuditConfigs(controllerAudit, methodAudit) {
        return this['mergeAuditConfigs'](controllerAudit, methodAudit);
    }
    // Expose makeAuditContext for testing
    testMakeAuditContext(ctx, route) {
        return this['makeAuditContext'](ctx, route);
    }
}
// Helper to create proper mock objects
function createMockAPIGatewayEvent() {
    return {
        body: null,
        headers: {},
        multiValueHeaders: {},
        httpMethod: 'GET',
        isBase64Encoded: false,
        path: '/test',
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {
            accountId: 'test-account',
            apiId: 'test-api',
            stage: 'test',
            requestId: 'test-request-123',
            requestTime: new Date().toISOString(),
            requestTimeEpoch: Date.now(),
            resourceId: 'test-resource',
            resourcePath: '/test',
            httpMethod: 'GET',
            path: '/test/path',
            protocol: 'HTTP/1.1',
            identity: {
                accessKey: null,
                accountId: null,
                apiKey: null,
                apiKeyId: null,
                caller: null,
                cognitoAuthenticationProvider: null,
                cognitoAuthenticationType: null,
                cognitoIdentityId: null,
                cognitoIdentityPoolId: null,
                principalOrgId: null,
                sourceIp: '127.0.0.1',
                user: null,
                userAgent: 'test-agent',
                userArn: null,
                clientCert: null
            },
            authorizer: null
        },
        resource: '/test'
    };
}
function createMockLambdaContext() {
    return {
        callbackWaitsForEmptyEventLoop: false,
        functionName: 'test-function',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
        memoryLimitInMB: '128',
        awsRequestId: 'test-aws-request-id',
        logGroupName: '/aws/lambda/test',
        logStreamName: 'test-stream',
        getRemainingTimeInMillis: () => 30000,
        done: () => { },
        fail: () => { },
        succeed: () => { }
    };
}
function createMockRequest(httpMethod = 'GET', path = '/basic') {
    const mockEvent = createMockAPIGatewayEvent();
    return {
        event: mockEvent,
        context: createMockLambdaContext(),
        httpMethod,
        path,
        pathParameters: { id: '123' },
        queryStringParameters: {},
        headers: {
            'content-type': 'application/json',
            'x-correlation-id': 'test-correlation-123'
        },
        body: JSON.stringify({ test: 'data', password: 'secret123' }),
        isBase64Encoded: false,
        requestId: 'test-request-123',
        resource: '/test',
        stageVariables: {},
        requestContext: mockEvent.requestContext,
        getParam: jest.fn(),
        hasParam: jest.fn(),
        getHeader: jest.fn(),
        hasHeader: jest.fn(),
        getPathParam: jest.fn(),
        hasPathParam: jest.fn(),
        getQueryParam: jest.fn(),
        hasQueryParam: jest.fn(),
        getBodyParam: jest.fn(),
        hasBodyParam: jest.fn()
    };
}
function createMockResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: '{}',
        isBase64Encoded: false,
        send: jest.fn().mockReturnThis(),
        end: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        setHeader: jest.fn().mockReturnThis(),
        getHeader: jest.fn(),
        getHeaders: jest.fn(),
        getBody: jest.fn(),
        getStatusCode: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        text: jest.fn().mockReturnThis(),
        html: jest.fn().mockReturnThis(),
        xml: jest.fn().mockReturnThis(),
        binary: jest.fn().mockReturnThis(),
        download: jest.fn().mockImplementation(function () { return Promise.resolve(this); }),
        header: jest.fn().mockReturnThis(),
        cookie: jest.fn().mockReturnThis(),
        cors: jest.fn().mockReturnThis(),
        cache: jest.fn().mockReturnThis(),
        redirect: jest.fn().mockReturnThis(),
        withMetadata: jest.fn().mockReturnThis(),
        withMetrics: jest.fn().mockReturnThis(),
        setMetadata: jest.fn().mockReturnThis(),
        build: jest.fn()
    };
}
function createMockActor() {
    return {
        actorType: 'user',
        requestId: 'test-request-123',
        timestamp: new Date().toISOString(),
        correlationId: 'test-correlation-123',
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent'
    };
}
// Helper to create mock execution context
function createMockExecutionContext(httpMethod = 'GET', path = '/basic') {
    return {
        event: createMockAPIGatewayEvent(),
        lambdaContext: createMockLambdaContext(),
        request: createMockRequest(httpMethod, path),
        response: createMockResponse(),
        actor: createMockActor()
    };
}
describe('Method-Level Audit Configuration', () => {
    let controller;
    beforeEach(() => {
        // Clear mocks but preserve spy setup
        mockFactoryInstance.create.mockClear();
        mockAuditLogger.audit.mockClear();
        // Create controller using proper framework conventions
        controller = new TestMethodAuditController();
    });
    describe('Audit Config Merging Logic', () => {
        it('should merge method-level config with controller config', () => {
            const controllerConfig = {
                enabled: true,
                category: 'controller-level',
                includes: {
                    request: ['headers'],
                    response: ['headers']
                },
                dataProtection: {
                    enabled: true,
                    deepRedact: {
                        blacklistedKeys: ['password', 'secret']
                    }
                }
            };
            const methodConfig = {
                enabled: true,
                category: 'method-enhanced',
                includes: {
                    request: ['headers', 'body'],
                    response: ['headers', 'body']
                }
            };
            const merged = controller.testMergeAuditConfigs(controllerConfig, methodConfig);
            expect(merged).toBeDefined();
            expect(merged?.enabled).toBe(true);
            expect(merged?.category).toBe('method-enhanced'); // Method overrides controller
            expect(merged?.includes?.request).toEqual(['headers', 'body']); // Method overrides controller
            expect(merged?.includes?.response).toEqual(['headers', 'body']); // Method overrides controller
            expect(merged?.dataProtection?.deepRedact?.blacklistedKeys).toEqual(['password', 'secret']); // Controller preserved
        });
        it('should disable audit when method-level config disables it', () => {
            const controllerConfig = {
                enabled: true,
                category: 'controller-level'
            };
            const methodConfig = {
                enabled: false
            };
            const merged = controller.testMergeAuditConfigs(controllerConfig, methodConfig);
            expect(merged?.enabled).toBe(false);
        });
        it('should merge data protection configs correctly', () => {
            const controllerConfig = {
                enabled: true,
                dataProtection: {
                    enabled: true,
                    deepRedact: {
                        blacklistedKeys: ['password', 'secret'],
                        replacement: '[REDACTED]'
                    }
                }
            };
            const methodConfig = {
                dataProtection: {
                    deepRedact: {
                        blacklistedKeys: ['apiKey', 'token'],
                        replacement: '[CUSTOM-REDACTED]'
                    }
                }
            };
            const merged = controller.testMergeAuditConfigs(controllerConfig, methodConfig);
            expect(merged?.dataProtection?.deepRedact?.blacklistedKeys).toEqual(expect.arrayContaining(['password', 'secret', 'apiKey', 'token']));
            expect(merged?.dataProtection?.deepRedact?.replacement).toBe('[CUSTOM-REDACTED]');
        });
        it('should merge custom context correctly', () => {
            const controllerConfig = {
                enabled: true,
                customContext: {
                    team: 'backend',
                    service: 'api'
                }
            };
            const methodConfig = {
                customContext: {
                    feature: 'special-feature',
                    service: 'override' // This should override
                }
            };
            const merged = controller.testMergeAuditConfigs(controllerConfig, methodConfig);
            expect(merged?.customContext).toEqual({
                team: 'backend',
                service: 'override', // Method override
                feature: 'special-feature'
            });
        });
        it('should handle method config only (no controller config)', () => {
            const methodConfig = {
                enabled: true,
                category: 'method-only'
            };
            const merged = controller.testMergeAuditConfigs(undefined, methodConfig);
            expect(merged).toEqual(methodConfig);
        });
        it('should handle controller config only (no method config)', () => {
            const controllerConfig = {
                enabled: true,
                category: 'controller-only'
            };
            const merged = controller.testMergeAuditConfigs(controllerConfig, undefined);
            expect(merged).toEqual(controllerConfig);
        });
        it('should handle empty configs', () => {
            const merged = controller.testMergeAuditConfigs(undefined, undefined);
            expect(merged).toBeUndefined();
        });
        it('should deduplicate request includes arrays correctly', () => {
            const controllerConfig = {
                enabled: true,
                includes: {
                    request: ['headers', 'query'],
                    response: ['headers']
                }
            };
            const methodConfig = {
                includes: {
                    request: ['headers', 'body'], // 'headers' overlaps
                    response: ['body']
                }
            };
            const merged = controller.testMergeAuditConfigs(controllerConfig, methodConfig);
            expect(merged?.includes?.request).toEqual(['headers', 'query', 'body']); // Deduplicated
            expect(merged?.includes?.response).toEqual(['headers', 'body']); // Deduplicated
        });
    });
    describe('Audit Context Creation with Method Routes', () => {
        it('should create audit context with method-level route config', () => {
            const ctx = createMockExecutionContext('POST', '/enhanced');
            const routeWithAudit = {
                path: '/enhanced',
                httpMethod: 'POST',
                functionName: 'enhancedRoute',
                parameters: [],
                audit: {
                    enabled: true,
                    category: 'method-enhanced',
                    includes: {
                        request: ['headers', 'body'],
                        response: ['headers', 'body']
                    }
                }
            };
            const auditContext = controller.testMakeAuditContext(ctx, routeWithAudit);
            expect(auditContext).toBeTruthy();
            expect(auditContext?.category).toBe('method-enhanced');
            expect(auditContext?.auditConfig.includes?.request).toEqual(['headers', 'body']);
        });
        it('should return null when method-level config disables audit', () => {
            const ctx = createMockExecutionContext('GET', '/disabled');
            const routeWithDisabledAudit = {
                path: '/disabled',
                httpMethod: 'GET',
                functionName: 'disabledRoute',
                parameters: [],
                audit: {
                    enabled: false
                }
            };
            const auditContext = controller.testMakeAuditContext(ctx, routeWithDisabledAudit);
            expect(auditContext).toBeNull();
        });
        it('should use controller config when no method config provided', () => {
            const ctx = createMockExecutionContext('GET', '/basic');
            const routeWithoutAudit = {
                path: '/basic',
                httpMethod: 'GET',
                functionName: 'basicRoute',
                parameters: []
            };
            const auditContext = controller.testMakeAuditContext(ctx, routeWithoutAudit);
            expect(auditContext).toBeTruthy();
            expect(auditContext?.category).toBe('controller-level');
            expect(auditContext?.auditConfig.includes?.request).toEqual(['headers']);
        });
    });
    describe('Critical Edge Cases - Controller No Audit vs Method With Audit', () => {
        class ControllerWithNoAuditConfig extends api_gateway_controller_1.APIController {
            getControllerConfig() {
                return {}; // NO audit config at all
            }
            testMakeAuditContext(ctx, route) {
                return this['makeAuditContext'](ctx, route);
            }
            testMergeAuditConfigs(controllerAudit, methodAudit) {
                return this['mergeAuditConfigs'](controllerAudit, methodAudit);
            }
        }
        class ControllerWithDisabledAudit extends api_gateway_controller_1.APIController {
            getControllerConfig() {
                return {
                    audit: { enabled: false } // Explicitly disabled
                };
            }
            testMakeAuditContext(ctx, route) {
                return this['makeAuditContext'](ctx, route);
            }
            testMergeAuditConfigs(controllerAudit, methodAudit) {
                return this['mergeAuditConfigs'](controllerAudit, methodAudit);
            }
        }
        it('CRITICAL: should enable audit for method when controller has NO audit config', () => {
            const controllerWithNoAudit = new ControllerWithNoAuditConfig();
            const ctx = createMockExecutionContext('POST', '/special');
            const routeWithAudit = {
                path: '/special',
                httpMethod: 'POST',
                functionName: 'specialMethod',
                parameters: [],
                audit: {
                    enabled: true,
                    category: 'method-only-audit',
                    includes: {
                        request: ['headers', 'body']
                    }
                }
            };
            const auditContext = controllerWithNoAudit.testMakeAuditContext(ctx, routeWithAudit);
            // This MUST work - method should enable audit even when controller has none
            expect(auditContext).toBeTruthy();
            expect(auditContext?.enabled).toBe(true);
            expect(auditContext?.category).toBe('method-only-audit');
            expect(auditContext?.auditConfig.includes?.request).toEqual(['headers', 'body']);
        });
        it('CRITICAL: should enable audit for method when controller explicitly disables audit', () => {
            const controllerWithDisabledAudit = new ControllerWithDisabledAudit();
            const ctx = createMockExecutionContext('POST', '/override');
            const routeWithAudit = {
                path: '/override',
                httpMethod: 'POST',
                functionName: 'overrideMethod',
                parameters: [],
                audit: {
                    enabled: true,
                    category: 'method-override-audit',
                    includes: {
                        request: ['headers', 'body'],
                        response: ['headers']
                    }
                }
            };
            const auditContext = controllerWithDisabledAudit.testMakeAuditContext(ctx, routeWithAudit);
            // This MUST work - method should override controller's disabled audit
            expect(auditContext).toBeTruthy();
            expect(auditContext?.enabled).toBe(true);
            expect(auditContext?.category).toBe('method-override-audit');
            expect(auditContext?.auditConfig.enabled).toBe(true);
            expect(auditContext?.auditConfig.includes?.request).toEqual(['headers', 'body']);
        });
        it('should return null when both controller and method disable audit', () => {
            const controllerWithDisabledAudit = new ControllerWithDisabledAudit();
            const ctx = createMockExecutionContext('GET', '/disabled-everywhere');
            const routeWithDisabledAudit = {
                path: '/disabled-everywhere',
                httpMethod: 'GET',
                functionName: 'disabledMethod',
                parameters: [],
                audit: {
                    enabled: false
                }
            };
            const auditContext = controllerWithDisabledAudit.testMakeAuditContext(ctx, routeWithDisabledAudit);
            expect(auditContext).toBeNull();
        });
        it('should return null when controller has no audit and method has no audit', () => {
            const controllerWithNoAudit = new ControllerWithNoAuditConfig();
            const ctx = createMockExecutionContext('GET', '/no-audit-anywhere');
            const routeWithNoAudit = {
                path: '/no-audit-anywhere',
                httpMethod: 'GET',
                functionName: 'noAuditMethod',
                parameters: []
                // No audit config
            };
            const auditContext = controllerWithNoAudit.testMakeAuditContext(ctx, routeWithNoAudit);
            expect(auditContext).toBeNull();
        });
        // Test the merging logic directly for these edge cases
        it('should merge correctly: no controller config + method config', () => {
            const controllerWithNoAudit = new ControllerWithNoAuditConfig();
            const methodConfig = {
                enabled: true,
                category: 'method-only'
            };
            const merged = controllerWithNoAudit.testMergeAuditConfigs(undefined, methodConfig);
            expect(merged).toEqual(methodConfig);
            expect(merged?.enabled).toBe(true);
        });
        it('should merge correctly: disabled controller + enabled method', () => {
            const controllerWithDisabledAudit = new ControllerWithDisabledAudit();
            const controllerConfig = { enabled: false };
            const methodConfig = {
                enabled: true,
                category: 'method-override'
            };
            const merged = controllerWithDisabledAudit.testMergeAuditConfigs(controllerConfig, methodConfig);
            expect(merged?.enabled).toBe(true); // Method should override controller
            expect(merged?.category).toBe('method-override');
        });
    });
    describe('Real-World Scenario - Practical Example', () => {
        it('should work in real controller scenario: no audit by default, specific methods audited', () => {
            // Real-world scenario: Performance API controller with no audit by default
            // but specific sensitive endpoints need audit
            class PerformanceAPIController extends api_gateway_controller_1.APIController {
                getControllerConfig() {
                    return {
                    // No audit config - most endpoints are high-frequency, no audit needed
                    };
                }
                testMakeAuditContext(ctx, route) {
                    return this['makeAuditContext'](ctx, route);
                }
            }
            const controller = new PerformanceAPIController();
            const ctx = createMockExecutionContext('POST', '/auth/login');
            // Only the sensitive login endpoint has audit enabled
            const loginRoute = {
                path: '/auth/login',
                httpMethod: 'POST',
                functionName: 'login',
                parameters: [],
                audit: {
                    enabled: true,
                    category: 'authentication',
                    includes: {
                        request: ['headers'], // No body for security
                        response: ['headers']
                    },
                    dataProtection: {
                        deepRedact: {
                            blacklistedKeys: ['password', 'token', 'mfa'],
                            replacement: '[AUTH-REDACTED]'
                        }
                    }
                }
            };
            const auditContext = controller.testMakeAuditContext(ctx, loginRoute);
            // Verify the sensitive endpoint gets audited even though controller has no audit
            expect(auditContext).toBeTruthy();
            expect(auditContext?.category).toBe('authentication');
            expect(auditContext?.auditConfig.enabled).toBe(true);
            expect(auditContext?.auditConfig.dataProtection?.deepRedact?.blacklistedKeys).toContain('password');
            expect(auditContext?.auditConfig.dataProtection?.deepRedact?.replacement).toBe('[AUTH-REDACTED]');
            // Test the opposite - regular performance endpoint with no audit
            const regularRoute = {
                path: '/metrics/cpu',
                httpMethod: 'GET',
                functionName: 'getCpuMetrics',
                parameters: []
                // No audit config
            };
            const noAuditContext = controller.testMakeAuditContext(ctx, regularRoute);
            expect(noAuditContext).toBeNull(); // No audit for performance endpoints
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0aG9kLWxldmVsLWF1ZGl0LnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL21ldGhvZC1sZXZlbC1hdWRpdC50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEscUVBQXlEO0FBT3pELDZEQUE2RDtBQUM3RCxJQUFJLENBQUMsSUFBSSxDQUFDLDZCQUE2QixFQUFFLEdBQUcsRUFBRTtJQUM1QyxNQUFNLGVBQWUsR0FBRztRQUN0QixLQUFLLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFNBQVMsQ0FBQztLQUM5QyxDQUFDO0lBRUYsTUFBTSxtQkFBbUIsR0FBRztRQUMxQixNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGVBQWUsQ0FBQyxlQUFlLENBQUM7S0FDbkQsQ0FBQztJQUVGLE9BQU87UUFDTCxrQkFBa0IsRUFBRTtZQUNsQixXQUFXLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGVBQWUsQ0FBQyxtQkFBbUIsQ0FBQztTQUM1RDtLQUNGLENBQUM7QUFDSixDQUFDLENBQUMsQ0FBQztBQUVILDJEQUEyRDtBQUMzRCxNQUFNLEVBQUUsa0JBQWtCLEVBQUUsR0FBRyxPQUFPLENBQUMsNkJBQTZCLENBQUMsQ0FBQztBQUN0RSxNQUFNLG1CQUFtQixHQUFHLGtCQUFrQixDQUFDLFdBQVcsRUFBRSxDQUFDO0FBQzdELE1BQU0sZUFBZSxHQUFHLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxDQUFDO0FBRXJELHNDQUFzQztBQUN0QyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7QUFDakMsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO0FBQ2pDLE1BQU0sQ0FBQyxPQUFPLEdBQUc7SUFDZixHQUFHLE1BQU0sQ0FBQyxPQUFPO0lBQ2pCLEdBQUcsRUFBRSxjQUFjO0lBQ25C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QyxjQUFjLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLHFDQUFxQztRQUMxRSxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElDb250cm9sbGVyIH0gZnJvbSAnLi9hcGktZ2F0ZXdheS1jb250cm9sbGVyJztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQsIEFjdG9yIH0gZnJvbSAnLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgY3JlYXRlSGFzaEJhc2VkU2FtcGxpbmcgfSBmcm9tICcuLi8uLi9hdWRpdC9oZWxwZXJzL3NhbXBsaW5nJztcbmltcG9ydCB7IFJlcXVlc3QsIFJlc3BvbnNlLCBSb3V0ZSB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQVBJR2F0ZXdheUV2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBBdWRpdENvbmZpZyB9IGZyb20gJy4uLy4uL2F1ZGl0L2ludGVyZmFjZXMnO1xuXG4vLyBNb2NrIHRoZSBhdWRpdCBsb2dnZXIgZmFjdG9yeSB0byBjYXB0dXJlIGFjdHVhbCBhdWRpdCBsb2dzXG5qZXN0Lm1vY2soJy4uLy4uL2F1ZGl0L2xvZ2dlcnMvZmFjdG9yeScsICgpID0+IHtcbiAgY29uc3QgbW9ja0F1ZGl0TG9nZ2VyID0ge1xuICAgIGF1ZGl0OiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUodW5kZWZpbmVkKVxuICB9O1xuXG4gIGNvbnN0IG1vY2tGYWN0b3J5SW5zdGFuY2UgPSB7XG4gICAgY3JlYXRlOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKG1vY2tBdWRpdExvZ2dlcilcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIEF1ZGl0TG9nZ2VyRmFjdG9yeToge1xuICAgICAgZ2V0SW5zdGFuY2U6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUobW9ja0ZhY3RvcnlJbnN0YW5jZSlcbiAgICB9XG4gIH07XG59KTtcblxuLy8gR2V0IHJlZmVyZW5jZXMgdG8gdGhlIG1vY2tlZCBvYmplY3RzIGZvciB0ZXN0IGFzc2VydGlvbnNcbmNvbnN0IHsgQXVkaXRMb2dnZXJGYWN0b3J5IH0gPSByZXF1aXJlKCcuLi8uLi9hdWRpdC9sb2dnZXJzL2ZhY3RvcnknKTtcbmNvbnN0IG1vY2tGYWN0b3J5SW5zdGFuY2UgPSBBdWRpdExvZ2dlckZhY3RvcnkuZ2V0SW5zdGFuY2UoKTtcbmNvbnN0IG1vY2tBdWRpdExvZ2dlciA9IG1vY2tGYWN0b3J5SW5zdGFuY2UuY3JlYXRlKCk7XG5cbi8vIE1vY2sgUmVmbGVjdCBmb3IgZGVjb3JhdG9yIG1ldGFkYXRhXG5jb25zdCBtb2NrUmVmbGVjdEdldCA9IGplc3QuZm4oKTtcbmNvbnN0IG1vY2tSZWZsZWN0U2V0ID0gamVzdC5mbigpO1xuZ2xvYmFsLlJlZmxlY3QgPSB7XG4gIC4uLmdsb2JhbC5SZWZsZWN0LFxuICBnZXQ6IG1vY2tSZWZsZWN0R2V0LFxuICBzZXQ6IG1vY2tSZWZsZWN0U2V0XG59O1xuXG4vLyBUZXN0IGNvbnRyb2xsZXIgZm9yIG1ldGhvZC1sZXZlbCBhdWRpdCBmdW5jdGlvbmFsaXR5XG5jbGFzcyBUZXN0TWV0aG9kQXVkaXRDb250cm9sbGVyIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG4gIFxuICBwcml2YXRlIGNvbnRyb2xsZXJBdWRpdENvbmZpZzogQXVkaXRDb25maWcgPSB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBjYXRlZ29yeTogJ2NvbnRyb2xsZXItbGV2ZWwnLFxuICAgIGluY2x1ZGVzOiB7XG4gICAgICByZXF1ZXN0OiBbJ2hlYWRlcnMnXSxcbiAgICAgIHJlc3BvbnNlOiBbJ2hlYWRlcnMnXVxuICAgIH0sXG4gICAgZGF0YVByb3RlY3Rpb246IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBkZWVwUmVkYWN0OiB7XG4gICAgICAgIGJsYWNrbGlzdGVkS2V5czogWydwYXNzd29yZCcsICdzZWNyZXQnXVxuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICBnZXRDb250cm9sbGVyQ29uZmlnKCkge1xuICAgIHJldHVybiB7XG4gICAgICBhdWRpdDogdGhpcy5jb250cm9sbGVyQXVkaXRDb25maWdcbiAgICB9O1xuICB9XG5cbiAgLy8gRXhwb3NlIHRoZSBwcml2YXRlIG1ldGhvZCBmb3IgdGVzdGluZ1xuICBwdWJsaWMgdGVzdE1lcmdlQXVkaXRDb25maWdzKGNvbnRyb2xsZXJBdWRpdD86IEF1ZGl0Q29uZmlnLCBtZXRob2RBdWRpdD86IEF1ZGl0Q29uZmlnKTogQXVkaXRDb25maWcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzWydtZXJnZUF1ZGl0Q29uZmlncyddKGNvbnRyb2xsZXJBdWRpdCwgbWV0aG9kQXVkaXQpO1xuICB9XG5cbiAgLy8gRXhwb3NlIG1ha2VBdWRpdENvbnRleHQgZm9yIHRlc3RpbmdcbiAgcHVibGljIHRlc3RNYWtlQXVkaXRDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCwgcm91dGU/OiBSb3V0ZSB8IG51bGwpIHtcbiAgICByZXR1cm4gdGhpc1snbWFrZUF1ZGl0Q29udGV4dCddKGN0eCwgcm91dGUpO1xuICB9XG59XG5cbi8vIEhlbHBlciB0byBjcmVhdGUgcHJvcGVyIG1vY2sgb2JqZWN0c1xuZnVuY3Rpb24gY3JlYXRlTW9ja0FQSUdhdGV3YXlFdmVudCgpOiBBUElHYXRld2F5RXZlbnQge1xuICByZXR1cm4ge1xuICAgIGJvZHk6IG51bGwsXG4gICAgaGVhZGVyczoge30sXG4gICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxuICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXG4gICAgcGF0aDogJy90ZXN0JyxcbiAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcbiAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcbiAgICByZXF1ZXN0Q29udGV4dDoge1xuICAgICAgYWNjb3VudElkOiAndGVzdC1hY2NvdW50JyxcbiAgICAgIGFwaUlkOiAndGVzdC1hcGknLFxuICAgICAgc3RhZ2U6ICd0ZXN0JyxcbiAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC0xMjMnLFxuICAgICAgcmVxdWVzdFRpbWU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHJlcXVlc3RUaW1lRXBvY2g6IERhdGUubm93KCksXG4gICAgICByZXNvdXJjZUlkOiAndGVzdC1yZXNvdXJjZScsXG4gICAgICByZXNvdXJjZVBhdGg6ICcvdGVzdCcsXG4gICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgIHBhdGg6ICcvdGVzdC9wYXRoJyxcbiAgICAgIHByb3RvY29sOiAnSFRUUC8xLjEnLFxuICAgICAgaWRlbnRpdHk6IHtcbiAgICAgICAgYWNjZXNzS2V5OiBudWxsLFxuICAgICAgICBhY2NvdW50SWQ6IG51bGwsXG4gICAgICAgIGFwaUtleTogbnVsbCxcbiAgICAgICAgYXBpS2V5SWQ6IG51bGwsXG4gICAgICAgIGNhbGxlcjogbnVsbCxcbiAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uUHJvdmlkZXI6IG51bGwsXG4gICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblR5cGU6IG51bGwsXG4gICAgICAgIGNvZ25pdG9JZGVudGl0eUlkOiBudWxsLFxuICAgICAgICBjb2duaXRvSWRlbnRpdHlQb29sSWQ6IG51bGwsXG4gICAgICAgIHByaW5jaXBhbE9yZ0lkOiBudWxsLFxuICAgICAgICBzb3VyY2VJcDogJzEyNy4wLjAuMScsXG4gICAgICAgIHVzZXI6IG51bGwsXG4gICAgICAgIHVzZXJBZ2VudDogJ3Rlc3QtYWdlbnQnLFxuICAgICAgICB1c2VyQXJuOiBudWxsLFxuICAgICAgICBjbGllbnRDZXJ0OiBudWxsXG4gICAgICB9LFxuICAgICAgYXV0aG9yaXplcjogbnVsbFxuICAgIH0sXG4gICAgcmVzb3VyY2U6ICcvdGVzdCdcbiAgfTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKTogQ29udGV4dCB7XG4gIHJldHVybiB7XG4gICAgY2FsbGJhY2tXYWl0c0ZvckVtcHR5RXZlbnRMb29wOiBmYWxzZSxcbiAgICBmdW5jdGlvbk5hbWU6ICd0ZXN0LWZ1bmN0aW9uJyxcbiAgICBmdW5jdGlvblZlcnNpb246ICcxJyxcbiAgICBpbnZva2VkRnVuY3Rpb25Bcm46ICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MTIzNDU2Nzg5OmZ1bmN0aW9uOnRlc3QnLFxuICAgIG1lbW9yeUxpbWl0SW5NQjogJzEyOCcsXG4gICAgYXdzUmVxdWVzdElkOiAndGVzdC1hd3MtcmVxdWVzdC1pZCcsXG4gICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9sYW1iZGEvdGVzdCcsXG4gICAgbG9nU3RyZWFtTmFtZTogJ3Rlc3Qtc3RyZWFtJyxcbiAgICBnZXRSZW1haW5pbmdUaW1lSW5NaWxsaXM6ICgpID0+IDMwMDAwLFxuICAgIGRvbmU6ICgpID0+IHt9LFxuICAgIGZhaWw6ICgpID0+IHt9LFxuICAgIHN1Y2NlZWQ6ICgpID0+IHt9XG4gIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZU1vY2tSZXF1ZXN0KGh0dHBNZXRob2Q6IHN0cmluZyA9ICdHRVQnLCBwYXRoOiBzdHJpbmcgPSAnL2Jhc2ljJyk6IFJlcXVlc3Qge1xuICBjb25zdCBtb2NrRXZlbnQgPSBjcmVhdGVNb2NrQVBJR2F0ZXdheUV2ZW50KCk7XG4gIHJldHVybiB7XG4gICAgZXZlbnQ6IG1vY2tFdmVudCxcbiAgICBjb250ZXh0OiBjcmVhdGVNb2NrTGFtYmRhQ29udGV4dCgpLFxuICAgIGh0dHBNZXRob2QsXG4gICAgcGF0aCxcbiAgICBwYXRoUGFyYW1ldGVyczogeyBpZDogJzEyMycgfSxcbiAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHt9LFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAneC1jb3JyZWxhdGlvbi1pZCc6ICd0ZXN0LWNvcnJlbGF0aW9uLTEyMydcbiAgICB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgdGVzdDogJ2RhdGEnLCBwYXNzd29yZDogJ3NlY3JldDEyMycgfSksXG4gICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcbiAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtMTIzJyxcbiAgICByZXNvdXJjZTogJy90ZXN0JyxcbiAgICBzdGFnZVZhcmlhYmxlczoge30sXG4gICAgcmVxdWVzdENvbnRleHQ6IG1vY2tFdmVudC5yZXF1ZXN0Q29udGV4dCxcbiAgICBnZXRQYXJhbTogamVzdC5mbigpLFxuICAgIGhhc1BhcmFtOiBqZXN0LmZuKCksXG4gICAgZ2V0SGVhZGVyOiBqZXN0LmZuKCksXG4gICAgaGFzSGVhZGVyOiBqZXN0LmZuKCksXG4gICAgZ2V0UGF0aFBhcmFtOiBqZXN0LmZuKCksXG4gICAgaGFzUGF0aFBhcmFtOiBqZXN0LmZuKCksXG4gICAgZ2V0UXVlcnlQYXJhbTogamVzdC5mbigpLFxuICAgIGhhc1F1ZXJ5UGFyYW06IGplc3QuZm4oKSxcbiAgICBnZXRCb2R5UGFyYW06IGplc3QuZm4oKSxcbiAgICBoYXNCb2R5UGFyYW06IGplc3QuZm4oKVxuICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVNb2NrUmVzcG9uc2UoKTogUmVzcG9uc2Uge1xuICByZXR1cm4ge1xuICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICBoZWFkZXJzOiB7fSxcbiAgICBib2R5OiAne30nLFxuICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXG4gICAgc2VuZDogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgZW5kOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICBzZXQ6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgIHNldEhlYWRlcjogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgZ2V0SGVhZGVyOiBqZXN0LmZuKCksXG4gICAgZ2V0SGVhZGVyczogamVzdC5mbigpLFxuICAgIGdldEJvZHk6IGplc3QuZm4oKSxcbiAgICBnZXRTdGF0dXNDb2RlOiBqZXN0LmZuKCksXG4gICAgc3RhdHVzOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICBqc29uOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICB0ZXh0OiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICBodG1sOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICB4bWw6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgIGJpbmFyeTogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgZG93bmxvYWQ6IGplc3QuZm4oKS5tb2NrSW1wbGVtZW50YXRpb24oZnVuY3Rpb24odGhpczogUmVzcG9uc2UpIHsgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh0aGlzKTsgfSksXG4gICAgaGVhZGVyOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICBjb29raWU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgIGNvcnM6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgIGNhY2hlOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICByZWRpcmVjdDogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgd2l0aE1ldGFkYXRhOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcbiAgICB3aXRoTWV0cmljczogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXG4gICAgc2V0TWV0YWRhdGE6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxuICAgIGJ1aWxkOiBqZXN0LmZuKClcbiAgfTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTW9ja0FjdG9yKCk6IEFjdG9yIHtcbiAgcmV0dXJuIHtcbiAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtMTIzJyxcbiAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbi0xMjMnLFxuICAgIHNvdXJjZUlwOiAnMTI3LjAuMC4xJyxcbiAgICB1c2VyQWdlbnQ6ICd0ZXN0LWFnZW50J1xuICB9O1xufVxuXG4vLyBIZWxwZXIgdG8gY3JlYXRlIG1vY2sgZXhlY3V0aW9uIGNvbnRleHRcbmZ1bmN0aW9uIGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KGh0dHBNZXRob2Q6IHN0cmluZyA9ICdHRVQnLCBwYXRoOiBzdHJpbmcgPSAnL2Jhc2ljJyk6IEV4ZWN1dGlvbkNvbnRleHQge1xuICByZXR1cm4ge1xuICAgIGV2ZW50OiBjcmVhdGVNb2NrQVBJR2F0ZXdheUV2ZW50KCksXG4gICAgbGFtYmRhQ29udGV4dDogY3JlYXRlTW9ja0xhbWJkYUNvbnRleHQoKSxcbiAgICByZXF1ZXN0OiBjcmVhdGVNb2NrUmVxdWVzdChodHRwTWV0aG9kLCBwYXRoKSxcbiAgICByZXNwb25zZTogY3JlYXRlTW9ja1Jlc3BvbnNlKCksXG4gICAgYWN0b3I6IGNyZWF0ZU1vY2tBY3RvcigpXG4gIH07XG59XG5cbmRlc2NyaWJlKCdNZXRob2QtTGV2ZWwgQXVkaXQgQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgbGV0IGNvbnRyb2xsZXI6IFRlc3RNZXRob2RBdWRpdENvbnRyb2xsZXI7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgLy8gQ2xlYXIgbW9ja3MgYnV0IHByZXNlcnZlIHNweSBzZXR1cFxuICAgIG1vY2tGYWN0b3J5SW5zdGFuY2UuY3JlYXRlLm1vY2tDbGVhcigpO1xuICAgIG1vY2tBdWRpdExvZ2dlci5hdWRpdC5tb2NrQ2xlYXIoKTtcbiAgICBcbiAgICAvLyBDcmVhdGUgY29udHJvbGxlciB1c2luZyBwcm9wZXIgZnJhbWV3b3JrIGNvbnZlbnRpb25zXG4gICAgY29udHJvbGxlciA9IG5ldyBUZXN0TWV0aG9kQXVkaXRDb250cm9sbGVyKCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdBdWRpdCBDb25maWcgTWVyZ2luZyBMb2dpYycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIG1lcmdlIG1ldGhvZC1sZXZlbCBjb25maWcgd2l0aCBjb250cm9sbGVyIGNvbmZpZycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXJDb25maWc6IEF1ZGl0Q29uZmlnID0ge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBjYXRlZ29yeTogJ2NvbnRyb2xsZXItbGV2ZWwnLFxuICAgICAgICBpbmNsdWRlczoge1xuICAgICAgICAgIHJlcXVlc3Q6IFsnaGVhZGVycyddLFxuICAgICAgICAgIHJlc3BvbnNlOiBbJ2hlYWRlcnMnXVxuICAgICAgICB9LFxuICAgICAgICBkYXRhUHJvdGVjdGlvbjoge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgZGVlcFJlZGFjdDoge1xuICAgICAgICAgICAgYmxhY2tsaXN0ZWRLZXlzOiBbJ3Bhc3N3b3JkJywgJ3NlY3JldCddXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtZXRob2RDb25maWc6IEF1ZGl0Q29uZmlnID0ge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBjYXRlZ29yeTogJ21ldGhvZC1lbmhhbmNlZCcsXG4gICAgICAgIGluY2x1ZGVzOiB7XG4gICAgICAgICAgcmVxdWVzdDogWydoZWFkZXJzJywgJ2JvZHknXSxcbiAgICAgICAgICByZXNwb25zZTogWydoZWFkZXJzJywgJ2JvZHknXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtZXJnZWQgPSBjb250cm9sbGVyLnRlc3RNZXJnZUF1ZGl0Q29uZmlncyhjb250cm9sbGVyQ29uZmlnLCBtZXRob2RDb25maWcpO1xuXG4gICAgICBleHBlY3QobWVyZ2VkKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG1lcmdlZD8uZW5hYmxlZCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChtZXJnZWQ/LmNhdGVnb3J5KS50b0JlKCdtZXRob2QtZW5oYW5jZWQnKTsgLy8gTWV0aG9kIG92ZXJyaWRlcyBjb250cm9sbGVyXG4gICAgICBleHBlY3QobWVyZ2VkPy5pbmNsdWRlcz8ucmVxdWVzdCkudG9FcXVhbChbJ2hlYWRlcnMnLCAnYm9keSddKTsgLy8gTWV0aG9kIG92ZXJyaWRlcyBjb250cm9sbGVyXG4gICAgICBleHBlY3QobWVyZ2VkPy5pbmNsdWRlcz8ucmVzcG9uc2UpLnRvRXF1YWwoWydoZWFkZXJzJywgJ2JvZHknXSk7IC8vIE1ldGhvZCBvdmVycmlkZXMgY29udHJvbGxlclxuICAgICAgZXhwZWN0KG1lcmdlZD8uZGF0YVByb3RlY3Rpb24/LmRlZXBSZWRhY3Q/LmJsYWNrbGlzdGVkS2V5cykudG9FcXVhbChbJ3Bhc3N3b3JkJywgJ3NlY3JldCddKTsgLy8gQ29udHJvbGxlciBwcmVzZXJ2ZWRcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZGlzYWJsZSBhdWRpdCB3aGVuIG1ldGhvZC1sZXZlbCBjb25maWcgZGlzYWJsZXMgaXQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyQ29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgY2F0ZWdvcnk6ICdjb250cm9sbGVyLWxldmVsJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgbWV0aG9kQ29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogZmFsc2VcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1lcmdlZCA9IGNvbnRyb2xsZXIudGVzdE1lcmdlQXVkaXRDb25maWdzKGNvbnRyb2xsZXJDb25maWcsIG1ldGhvZENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChtZXJnZWQ/LmVuYWJsZWQpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBtZXJnZSBkYXRhIHByb3RlY3Rpb24gY29uZmlncyBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyQ29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgZGF0YVByb3RlY3Rpb246IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGRlZXBSZWRhY3Q6IHtcbiAgICAgICAgICAgIGJsYWNrbGlzdGVkS2V5czogWydwYXNzd29yZCcsICdzZWNyZXQnXSxcbiAgICAgICAgICAgIHJlcGxhY2VtZW50OiAnW1JFREFDVEVEXSdcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1ldGhvZENvbmZpZzogQXVkaXRDb25maWcgPSB7XG4gICAgICAgIGRhdGFQcm90ZWN0aW9uOiB7XG4gICAgICAgICAgZGVlcFJlZGFjdDoge1xuICAgICAgICAgICAgYmxhY2tsaXN0ZWRLZXlzOiBbJ2FwaUtleScsICd0b2tlbiddLFxuICAgICAgICAgICAgcmVwbGFjZW1lbnQ6ICdbQ1VTVE9NLVJFREFDVEVEXSdcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1lcmdlZCA9IGNvbnRyb2xsZXIudGVzdE1lcmdlQXVkaXRDb25maWdzKGNvbnRyb2xsZXJDb25maWcsIG1ldGhvZENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChtZXJnZWQ/LmRhdGFQcm90ZWN0aW9uPy5kZWVwUmVkYWN0Py5ibGFja2xpc3RlZEtleXMpLnRvRXF1YWwoXG4gICAgICAgIGV4cGVjdC5hcnJheUNvbnRhaW5pbmcoWydwYXNzd29yZCcsICdzZWNyZXQnLCAnYXBpS2V5JywgJ3Rva2VuJ10pXG4gICAgICApO1xuICAgICAgZXhwZWN0KG1lcmdlZD8uZGF0YVByb3RlY3Rpb24/LmRlZXBSZWRhY3Q/LnJlcGxhY2VtZW50KS50b0JlKCdbQ1VTVE9NLVJFREFDVEVEXScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBtZXJnZSBjdXN0b20gY29udGV4dCBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyQ29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgY3VzdG9tQ29udGV4dDoge1xuICAgICAgICAgIHRlYW06ICdiYWNrZW5kJyxcbiAgICAgICAgICBzZXJ2aWNlOiAnYXBpJ1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtZXRob2RDb25maWc6IEF1ZGl0Q29uZmlnID0ge1xuICAgICAgICBjdXN0b21Db250ZXh0OiB7XG4gICAgICAgICAgZmVhdHVyZTogJ3NwZWNpYWwtZmVhdHVyZScsXG4gICAgICAgICAgc2VydmljZTogJ292ZXJyaWRlJyAvLyBUaGlzIHNob3VsZCBvdmVycmlkZVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtZXJnZWQgPSBjb250cm9sbGVyLnRlc3RNZXJnZUF1ZGl0Q29uZmlncyhjb250cm9sbGVyQ29uZmlnLCBtZXRob2RDb25maWcpO1xuXG4gICAgICBleHBlY3QobWVyZ2VkPy5jdXN0b21Db250ZXh0KS50b0VxdWFsKHtcbiAgICAgICAgdGVhbTogJ2JhY2tlbmQnLFxuICAgICAgICBzZXJ2aWNlOiAnb3ZlcnJpZGUnLCAvLyBNZXRob2Qgb3ZlcnJpZGVcbiAgICAgICAgZmVhdHVyZTogJ3NwZWNpYWwtZmVhdHVyZSdcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWV0aG9kIGNvbmZpZyBvbmx5IChubyBjb250cm9sbGVyIGNvbmZpZyknLCAoKSA9PiB7XG4gICAgICBjb25zdCBtZXRob2RDb25maWc6IEF1ZGl0Q29uZmlnID0ge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBjYXRlZ29yeTogJ21ldGhvZC1vbmx5J1xuICAgICAgfTtcblxuICAgICAgY29uc3QgbWVyZ2VkID0gY29udHJvbGxlci50ZXN0TWVyZ2VBdWRpdENvbmZpZ3ModW5kZWZpbmVkLCBtZXRob2RDb25maWcpO1xuXG4gICAgICBleHBlY3QobWVyZ2VkKS50b0VxdWFsKG1ldGhvZENvbmZpZyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb250cm9sbGVyIGNvbmZpZyBvbmx5IChubyBtZXRob2QgY29uZmlnKScsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXJDb25maWc6IEF1ZGl0Q29uZmlnID0ge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBjYXRlZ29yeTogJ2NvbnRyb2xsZXItb25seSdcbiAgICAgIH07XG4gICAgICBcbiAgICAgIGNvbnN0IG1lcmdlZCA9IGNvbnRyb2xsZXIudGVzdE1lcmdlQXVkaXRDb25maWdzKGNvbnRyb2xsZXJDb25maWcsIHVuZGVmaW5lZCk7XG5cbiAgICAgIGV4cGVjdChtZXJnZWQpLnRvRXF1YWwoY29udHJvbGxlckNvbmZpZyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBjb25maWdzJywgKCkgPT4ge1xuICAgICAgY29uc3QgbWVyZ2VkID0gY29udHJvbGxlci50ZXN0TWVyZ2VBdWRpdENvbmZpZ3ModW5kZWZpbmVkLCB1bmRlZmluZWQpO1xuICAgICAgZXhwZWN0KG1lcmdlZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBkZWR1cGxpY2F0ZSByZXF1ZXN0IGluY2x1ZGVzIGFycmF5cyBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyQ29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZXM6IHtcbiAgICAgICAgICByZXF1ZXN0OiBbJ2hlYWRlcnMnLCAncXVlcnknXSBhcyAoJ2hlYWRlcnMnIHwgJ2JvZHknIHwgJ3F1ZXJ5JylbXSxcbiAgICAgICAgICByZXNwb25zZTogWydoZWFkZXJzJ10gYXMgKCdoZWFkZXJzJyB8ICdib2R5JylbXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtZXRob2RDb25maWc6IEF1ZGl0Q29uZmlnID0ge1xuICAgICAgICBpbmNsdWRlczoge1xuICAgICAgICAgIHJlcXVlc3Q6IFsnaGVhZGVycycsICdib2R5J10gYXMgKCdoZWFkZXJzJyB8ICdib2R5JyB8ICdxdWVyeScpW10sIC8vICdoZWFkZXJzJyBvdmVybGFwc1xuICAgICAgICAgIHJlc3BvbnNlOiBbJ2JvZHknXSBhcyAoJ2hlYWRlcnMnIHwgJ2JvZHknKVtdXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1lcmdlZCA9IGNvbnRyb2xsZXIudGVzdE1lcmdlQXVkaXRDb25maWdzKGNvbnRyb2xsZXJDb25maWcsIG1ldGhvZENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChtZXJnZWQ/LmluY2x1ZGVzPy5yZXF1ZXN0KS50b0VxdWFsKFsnaGVhZGVycycsICdxdWVyeScsICdib2R5J10pOyAvLyBEZWR1cGxpY2F0ZWRcbiAgICAgIGV4cGVjdChtZXJnZWQ/LmluY2x1ZGVzPy5yZXNwb25zZSkudG9FcXVhbChbJ2hlYWRlcnMnLCAnYm9keSddKTsgLy8gRGVkdXBsaWNhdGVkXG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdBdWRpdCBDb250ZXh0IENyZWF0aW9uIHdpdGggTWV0aG9kIFJvdXRlcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhdWRpdCBjb250ZXh0IHdpdGggbWV0aG9kLWxldmVsIHJvdXRlIGNvbmZpZycsICgpID0+IHtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCdQT1NUJywgJy9lbmhhbmNlZCcpO1xuICAgICAgXG4gICAgICBjb25zdCByb3V0ZVdpdGhBdWRpdDogUm91dGUgPSB7XG4gICAgICAgIHBhdGg6ICcvZW5oYW5jZWQnLFxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgIGZ1bmN0aW9uTmFtZTogJ2VuaGFuY2VkUm91dGUnLFxuICAgICAgICBwYXJhbWV0ZXJzOiBbXSxcbiAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGNhdGVnb3J5OiAnbWV0aG9kLWVuaGFuY2VkJyxcbiAgICAgICAgICBpbmNsdWRlczoge1xuICAgICAgICAgICAgcmVxdWVzdDogWydoZWFkZXJzJywgJ2JvZHknXSxcbiAgICAgICAgICAgIHJlc3BvbnNlOiBbJ2hlYWRlcnMnLCAnYm9keSddXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjb250cm9sbGVyLnRlc3RNYWtlQXVkaXRDb250ZXh0KGN0eCwgcm91dGVXaXRoQXVkaXQpO1xuXG4gICAgICBleHBlY3QoYXVkaXRDb250ZXh0KS50b0JlVHJ1dGh5KCk7XG4gICAgICBleHBlY3QoYXVkaXRDb250ZXh0Py5jYXRlZ29yeSkudG9CZSgnbWV0aG9kLWVuaGFuY2VkJyk7XG4gICAgICBleHBlY3QoYXVkaXRDb250ZXh0Py5hdWRpdENvbmZpZy5pbmNsdWRlcz8ucmVxdWVzdCkudG9FcXVhbChbJ2hlYWRlcnMnLCAnYm9keSddKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIG51bGwgd2hlbiBtZXRob2QtbGV2ZWwgY29uZmlnIGRpc2FibGVzIGF1ZGl0JywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoJ0dFVCcsICcvZGlzYWJsZWQnKTtcbiAgICAgIFxuICAgICAgY29uc3Qgcm91dGVXaXRoRGlzYWJsZWRBdWRpdDogUm91dGUgPSB7XG4gICAgICAgIHBhdGg6ICcvZGlzYWJsZWQnLFxuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiAnZGlzYWJsZWRSb3V0ZScsXG4gICAgICAgIHBhcmFtZXRlcnM6IFtdLFxuICAgICAgICBhdWRpdDoge1xuICAgICAgICAgIGVuYWJsZWQ6IGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNvbnRyb2xsZXIudGVzdE1ha2VBdWRpdENvbnRleHQoY3R4LCByb3V0ZVdpdGhEaXNhYmxlZEF1ZGl0KTtcblxuICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dCkudG9CZU51bGwoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdXNlIGNvbnRyb2xsZXIgY29uZmlnIHdoZW4gbm8gbWV0aG9kIGNvbmZpZyBwcm92aWRlZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCdHRVQnLCAnL2Jhc2ljJyk7XG4gICAgICBcbiAgICAgIGNvbnN0IHJvdXRlV2l0aG91dEF1ZGl0OiBSb3V0ZSA9IHtcbiAgICAgICAgcGF0aDogJy9iYXNpYycsXG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgICBmdW5jdGlvbk5hbWU6ICdiYXNpY1JvdXRlJyxcbiAgICAgICAgcGFyYW1ldGVyczogW11cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNvbnRyb2xsZXIudGVzdE1ha2VBdWRpdENvbnRleHQoY3R4LCByb3V0ZVdpdGhvdXRBdWRpdCk7XG5cbiAgICAgIGV4cGVjdChhdWRpdENvbnRleHQpLnRvQmVUcnV0aHkoKTtcbiAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmNhdGVnb3J5KS50b0JlKCdjb250cm9sbGVyLWxldmVsJyk7XG4gICAgICBleHBlY3QoYXVkaXRDb250ZXh0Py5hdWRpdENvbmZpZy5pbmNsdWRlcz8ucmVxdWVzdCkudG9FcXVhbChbJ2hlYWRlcnMnXSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDcml0aWNhbCBFZGdlIENhc2VzIC0gQ29udHJvbGxlciBObyBBdWRpdCB2cyBNZXRob2QgV2l0aCBBdWRpdCcsICgpID0+IHtcbiAgICBcbiAgICBjbGFzcyBDb250cm9sbGVyV2l0aE5vQXVkaXRDb25maWcgZXh0ZW5kcyBBUElDb250cm9sbGVyIHtcbiAgICAgIGdldENvbnRyb2xsZXJDb25maWcoKSB7XG4gICAgICAgIHJldHVybiB7fTsgLy8gTk8gYXVkaXQgY29uZmlnIGF0IGFsbFxuICAgICAgfVxuICAgICAgXG4gICAgICBwdWJsaWMgdGVzdE1ha2VBdWRpdENvbnRleHQoY3R4OiBFeGVjdXRpb25Db250ZXh0LCByb3V0ZT86IFJvdXRlIHwgbnVsbCkge1xuICAgICAgICByZXR1cm4gdGhpc1snbWFrZUF1ZGl0Q29udGV4dCddKGN0eCwgcm91dGUpO1xuICAgICAgfVxuICAgICAgXG4gICAgICBwdWJsaWMgdGVzdE1lcmdlQXVkaXRDb25maWdzKGNvbnRyb2xsZXJBdWRpdD86IEF1ZGl0Q29uZmlnLCBtZXRob2RBdWRpdD86IEF1ZGl0Q29uZmlnKSB7XG4gICAgICAgIHJldHVybiB0aGlzWydtZXJnZUF1ZGl0Q29uZmlncyddKGNvbnRyb2xsZXJBdWRpdCwgbWV0aG9kQXVkaXQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNsYXNzIENvbnRyb2xsZXJXaXRoRGlzYWJsZWRBdWRpdCBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICAgICAgZ2V0Q29udHJvbGxlckNvbmZpZygpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBhdWRpdDogeyBlbmFibGVkOiBmYWxzZSB9IC8vIEV4cGxpY2l0bHkgZGlzYWJsZWRcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgcHVibGljIHRlc3RNYWtlQXVkaXRDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCwgcm91dGU/OiBSb3V0ZSB8IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXNbJ21ha2VBdWRpdENvbnRleHQnXShjdHgsIHJvdXRlKTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgcHVibGljIHRlc3RNZXJnZUF1ZGl0Q29uZmlncyhjb250cm9sbGVyQXVkaXQ/OiBBdWRpdENvbmZpZywgbWV0aG9kQXVkaXQ/OiBBdWRpdENvbmZpZykge1xuICAgICAgICByZXR1cm4gdGhpc1snbWVyZ2VBdWRpdENvbmZpZ3MnXShjb250cm9sbGVyQXVkaXQsIG1ldGhvZEF1ZGl0KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpdCgnQ1JJVElDQUw6IHNob3VsZCBlbmFibGUgYXVkaXQgZm9yIG1ldGhvZCB3aGVuIGNvbnRyb2xsZXIgaGFzIE5PIGF1ZGl0IGNvbmZpZycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXJXaXRoTm9BdWRpdCA9IG5ldyBDb250cm9sbGVyV2l0aE5vQXVkaXRDb25maWcoKTtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCdQT1NUJywgJy9zcGVjaWFsJyk7XG4gICAgICBcbiAgICAgIGNvbnN0IHJvdXRlV2l0aEF1ZGl0OiBSb3V0ZSA9IHtcbiAgICAgICAgcGF0aDogJy9zcGVjaWFsJyxcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLCBcbiAgICAgICAgZnVuY3Rpb25OYW1lOiAnc3BlY2lhbE1ldGhvZCcsXG4gICAgICAgIHBhcmFtZXRlcnM6IFtdLFxuICAgICAgICBhdWRpdDoge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgY2F0ZWdvcnk6ICdtZXRob2Qtb25seS1hdWRpdCcsXG4gICAgICAgICAgaW5jbHVkZXM6IHtcbiAgICAgICAgICAgIHJlcXVlc3Q6IFsnaGVhZGVycycsICdib2R5J11cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNvbnRyb2xsZXJXaXRoTm9BdWRpdC50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgsIHJvdXRlV2l0aEF1ZGl0KTtcblxuICAgICAgLy8gVGhpcyBNVVNUIHdvcmsgLSBtZXRob2Qgc2hvdWxkIGVuYWJsZSBhdWRpdCBldmVuIHdoZW4gY29udHJvbGxlciBoYXMgbm9uZVxuICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dCkudG9CZVRydXRoeSgpO1xuICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dD8uZW5hYmxlZCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmNhdGVnb3J5KS50b0JlKCdtZXRob2Qtb25seS1hdWRpdCcpO1xuICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dD8uYXVkaXRDb25maWcuaW5jbHVkZXM/LnJlcXVlc3QpLnRvRXF1YWwoWydoZWFkZXJzJywgJ2JvZHknXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnQ1JJVElDQUw6IHNob3VsZCBlbmFibGUgYXVkaXQgZm9yIG1ldGhvZCB3aGVuIGNvbnRyb2xsZXIgZXhwbGljaXRseSBkaXNhYmxlcyBhdWRpdCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXJXaXRoRGlzYWJsZWRBdWRpdCA9IG5ldyBDb250cm9sbGVyV2l0aERpc2FibGVkQXVkaXQoKTtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCdQT1NUJywgJy9vdmVycmlkZScpO1xuICAgICAgXG4gICAgICBjb25zdCByb3V0ZVdpdGhBdWRpdDogUm91dGUgPSB7XG4gICAgICAgIHBhdGg6ICcvb3ZlcnJpZGUnLFxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICAgIGZ1bmN0aW9uTmFtZTogJ292ZXJyaWRlTWV0aG9kJywgXG4gICAgICAgIHBhcmFtZXRlcnM6IFtdLFxuICAgICAgICBhdWRpdDoge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgY2F0ZWdvcnk6ICdtZXRob2Qtb3ZlcnJpZGUtYXVkaXQnLFxuICAgICAgICAgIGluY2x1ZGVzOiB7XG4gICAgICAgICAgICByZXF1ZXN0OiBbJ2hlYWRlcnMnLCAnYm9keSddLFxuICAgICAgICAgICAgcmVzcG9uc2U6IFsnaGVhZGVycyddXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjb250cm9sbGVyV2l0aERpc2FibGVkQXVkaXQudGVzdE1ha2VBdWRpdENvbnRleHQoY3R4LCByb3V0ZVdpdGhBdWRpdCk7XG5cbiAgICAgIC8vIFRoaXMgTVVTVCB3b3JrIC0gbWV0aG9kIHNob3VsZCBvdmVycmlkZSBjb250cm9sbGVyJ3MgZGlzYWJsZWQgYXVkaXRcbiAgICAgIGV4cGVjdChhdWRpdENvbnRleHQpLnRvQmVUcnV0aHkoKTsgXG4gICAgICBleHBlY3QoYXVkaXRDb250ZXh0Py5lbmFibGVkKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dD8uY2F0ZWdvcnkpLnRvQmUoJ21ldGhvZC1vdmVycmlkZS1hdWRpdCcpO1xuICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dD8uYXVkaXRDb25maWcuZW5hYmxlZCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmF1ZGl0Q29uZmlnLmluY2x1ZGVzPy5yZXF1ZXN0KS50b0VxdWFsKFsnaGVhZGVycycsICdib2R5J10pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gbnVsbCB3aGVuIGJvdGggY29udHJvbGxlciBhbmQgbWV0aG9kIGRpc2FibGUgYXVkaXQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyV2l0aERpc2FibGVkQXVkaXQgPSBuZXcgQ29udHJvbGxlcldpdGhEaXNhYmxlZEF1ZGl0KCk7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dCgnR0VUJywgJy9kaXNhYmxlZC1ldmVyeXdoZXJlJyk7XG4gICAgICBcbiAgICAgIGNvbnN0IHJvdXRlV2l0aERpc2FibGVkQXVkaXQ6IFJvdXRlID0ge1xuICAgICAgICBwYXRoOiAnL2Rpc2FibGVkLWV2ZXJ5d2hlcmUnLFxuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiAnZGlzYWJsZWRNZXRob2QnLFxuICAgICAgICBwYXJhbWV0ZXJzOiBbXSxcbiAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICBlbmFibGVkOiBmYWxzZVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjb250cm9sbGVyV2l0aERpc2FibGVkQXVkaXQudGVzdE1ha2VBdWRpdENvbnRleHQoY3R4LCByb3V0ZVdpdGhEaXNhYmxlZEF1ZGl0KTtcblxuICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dCkudG9CZU51bGwoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0dXJuIG51bGwgd2hlbiBjb250cm9sbGVyIGhhcyBubyBhdWRpdCBhbmQgbWV0aG9kIGhhcyBubyBhdWRpdCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXJXaXRoTm9BdWRpdCA9IG5ldyBDb250cm9sbGVyV2l0aE5vQXVkaXRDb25maWcoKTtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCdHRVQnLCAnL25vLWF1ZGl0LWFueXdoZXJlJyk7XG4gICAgICBcbiAgICAgIGNvbnN0IHJvdXRlV2l0aE5vQXVkaXQ6IFJvdXRlID0ge1xuICAgICAgICBwYXRoOiAnL25vLWF1ZGl0LWFueXdoZXJlJyxcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIGZ1bmN0aW9uTmFtZTogJ25vQXVkaXRNZXRob2QnLFxuICAgICAgICBwYXJhbWV0ZXJzOiBbXVxuICAgICAgICAvLyBObyBhdWRpdCBjb25maWdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNvbnRyb2xsZXJXaXRoTm9BdWRpdC50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgsIHJvdXRlV2l0aE5vQXVkaXQpO1xuXG4gICAgICBleHBlY3QoYXVkaXRDb250ZXh0KS50b0JlTnVsbCgpO1xuICAgIH0pO1xuXG4gICAgLy8gVGVzdCB0aGUgbWVyZ2luZyBsb2dpYyBkaXJlY3RseSBmb3IgdGhlc2UgZWRnZSBjYXNlc1xuICAgIGl0KCdzaG91bGQgbWVyZ2UgY29ycmVjdGx5OiBubyBjb250cm9sbGVyIGNvbmZpZyArIG1ldGhvZCBjb25maWcnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyV2l0aE5vQXVkaXQgPSBuZXcgQ29udHJvbGxlcldpdGhOb0F1ZGl0Q29uZmlnKCk7XG4gICAgICBcbiAgICAgIGNvbnN0IG1ldGhvZENvbmZpZzogQXVkaXRDb25maWcgPSB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGNhdGVnb3J5OiAnbWV0aG9kLW9ubHknXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtZXJnZWQgPSBjb250cm9sbGVyV2l0aE5vQXVkaXQudGVzdE1lcmdlQXVkaXRDb25maWdzKHVuZGVmaW5lZCwgbWV0aG9kQ29uZmlnKTtcblxuICAgICAgZXhwZWN0KG1lcmdlZCkudG9FcXVhbChtZXRob2RDb25maWcpO1xuICAgICAgZXhwZWN0KG1lcmdlZD8uZW5hYmxlZCkudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbWVyZ2UgY29ycmVjdGx5OiBkaXNhYmxlZCBjb250cm9sbGVyICsgZW5hYmxlZCBtZXRob2QnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb250cm9sbGVyV2l0aERpc2FibGVkQXVkaXQgPSBuZXcgQ29udHJvbGxlcldpdGhEaXNhYmxlZEF1ZGl0KCk7XG4gICAgICBcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXJDb25maWc6IEF1ZGl0Q29uZmlnID0geyBlbmFibGVkOiBmYWxzZSB9O1xuICAgICAgY29uc3QgbWV0aG9kQ29uZmlnOiBBdWRpdENvbmZpZyA9IHsgXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGNhdGVnb3J5OiAnbWV0aG9kLW92ZXJyaWRlJ1xuICAgICAgfTtcblxuICAgICAgY29uc3QgbWVyZ2VkID0gY29udHJvbGxlcldpdGhEaXNhYmxlZEF1ZGl0LnRlc3RNZXJnZUF1ZGl0Q29uZmlncyhjb250cm9sbGVyQ29uZmlnLCBtZXRob2RDb25maWcpO1xuXG4gICAgICBleHBlY3QobWVyZ2VkPy5lbmFibGVkKS50b0JlKHRydWUpOyAvLyBNZXRob2Qgc2hvdWxkIG92ZXJyaWRlIGNvbnRyb2xsZXJcbiAgICAgIGV4cGVjdChtZXJnZWQ/LmNhdGVnb3J5KS50b0JlKCdtZXRob2Qtb3ZlcnJpZGUnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1JlYWwtV29ybGQgU2NlbmFyaW8gLSBQcmFjdGljYWwgRXhhbXBsZScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHdvcmsgaW4gcmVhbCBjb250cm9sbGVyIHNjZW5hcmlvOiBubyBhdWRpdCBieSBkZWZhdWx0LCBzcGVjaWZpYyBtZXRob2RzIGF1ZGl0ZWQnLCAoKSA9PiB7XG4gICAgICAvLyBSZWFsLXdvcmxkIHNjZW5hcmlvOiBQZXJmb3JtYW5jZSBBUEkgY29udHJvbGxlciB3aXRoIG5vIGF1ZGl0IGJ5IGRlZmF1bHRcbiAgICAgIC8vIGJ1dCBzcGVjaWZpYyBzZW5zaXRpdmUgZW5kcG9pbnRzIG5lZWQgYXVkaXRcbiAgICAgIGNsYXNzIFBlcmZvcm1hbmNlQVBJQ29udHJvbGxlciBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICAgICAgICBnZXRDb250cm9sbGVyQ29uZmlnKCkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAvLyBObyBhdWRpdCBjb25maWcgLSBtb3N0IGVuZHBvaW50cyBhcmUgaGlnaC1mcmVxdWVuY3ksIG5vIGF1ZGl0IG5lZWRlZFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHB1YmxpYyB0ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHg6IEV4ZWN1dGlvbkNvbnRleHQsIHJvdXRlPzogUm91dGUgfCBudWxsKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXNbJ21ha2VBdWRpdENvbnRleHQnXShjdHgsIHJvdXRlKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IFBlcmZvcm1hbmNlQVBJQ29udHJvbGxlcigpO1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoJ1BPU1QnLCAnL2F1dGgvbG9naW4nKTtcblxuICAgICAgLy8gT25seSB0aGUgc2Vuc2l0aXZlIGxvZ2luIGVuZHBvaW50IGhhcyBhdWRpdCBlbmFibGVkXG4gICAgICBjb25zdCBsb2dpblJvdXRlOiBSb3V0ZSA9IHtcbiAgICAgICAgcGF0aDogJy9hdXRoL2xvZ2luJyxcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxuICAgICAgICBmdW5jdGlvbk5hbWU6ICdsb2dpbicsXG4gICAgICAgIHBhcmFtZXRlcnM6IFtdLFxuICAgICAgICBhdWRpdDoge1xuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgY2F0ZWdvcnk6ICdhdXRoZW50aWNhdGlvbicsXG4gICAgICAgICAgaW5jbHVkZXM6IHtcbiAgICAgICAgICAgIHJlcXVlc3Q6IFsnaGVhZGVycyddLCAvLyBObyBib2R5IGZvciBzZWN1cml0eVxuICAgICAgICAgICAgcmVzcG9uc2U6IFsnaGVhZGVycyddXG4gICAgICAgICAgfSxcbiAgICAgICAgICBkYXRhUHJvdGVjdGlvbjoge1xuICAgICAgICAgICAgZGVlcFJlZGFjdDoge1xuICAgICAgICAgICAgICBibGFja2xpc3RlZEtleXM6IFsncGFzc3dvcmQnLCAndG9rZW4nLCAnbWZhJ10sXG4gICAgICAgICAgICAgIHJlcGxhY2VtZW50OiAnW0FVVEgtUkVEQUNURURdJ1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgsIGxvZ2luUm91dGUpO1xuXG4gICAgICAvLyBWZXJpZnkgdGhlIHNlbnNpdGl2ZSBlbmRwb2ludCBnZXRzIGF1ZGl0ZWQgZXZlbiB0aG91Z2ggY29udHJvbGxlciBoYXMgbm8gYXVkaXRcbiAgICAgIGV4cGVjdChhdWRpdENvbnRleHQpLnRvQmVUcnV0aHkoKTtcbiAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmNhdGVnb3J5KS50b0JlKCdhdXRoZW50aWNhdGlvbicpO1xuICAgICAgZXhwZWN0KGF1ZGl0Q29udGV4dD8uYXVkaXRDb25maWcuZW5hYmxlZCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmF1ZGl0Q29uZmlnLmRhdGFQcm90ZWN0aW9uPy5kZWVwUmVkYWN0Py5ibGFja2xpc3RlZEtleXMpLnRvQ29udGFpbigncGFzc3dvcmQnKTtcbiAgICAgIGV4cGVjdChhdWRpdENvbnRleHQ/LmF1ZGl0Q29uZmlnLmRhdGFQcm90ZWN0aW9uPy5kZWVwUmVkYWN0Py5yZXBsYWNlbWVudCkudG9CZSgnW0FVVEgtUkVEQUNURURdJyk7XG5cbiAgICAgIC8vIFRlc3QgdGhlIG9wcG9zaXRlIC0gcmVndWxhciBwZXJmb3JtYW5jZSBlbmRwb2ludCB3aXRoIG5vIGF1ZGl0XG4gICAgICBjb25zdCByZWd1bGFyUm91dGU6IFJvdXRlID0ge1xuICAgICAgICBwYXRoOiAnL21ldHJpY3MvY3B1JyxcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICAgIGZ1bmN0aW9uTmFtZTogJ2dldENwdU1ldHJpY3MnLFxuICAgICAgICBwYXJhbWV0ZXJzOiBbXVxuICAgICAgICAvLyBObyBhdWRpdCBjb25maWdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG5vQXVkaXRDb250ZXh0ID0gY29udHJvbGxlci50ZXN0TWFrZUF1ZGl0Q29udGV4dChjdHgsIHJlZ3VsYXJSb3V0ZSk7XG4gICAgICBleHBlY3Qobm9BdWRpdENvbnRleHQpLnRvQmVOdWxsKCk7IC8vIE5vIGF1ZGl0IGZvciBwZXJmb3JtYW5jZSBlbmRwb2ludHNcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==