"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_gateway_controller_1 = require("../../core/runtime/api-gateway-controller");
describe('Selective Field Auditing', () => {
    class TestSelectiveAuditController extends api_gateway_controller_1.APIController {
        constructor() {
            super();
        }
        // Expose private methods for testing
        testBuildRequestContext(ctx, auditConfig) {
            return this['buildRequestContext'](ctx, auditConfig);
        }
        testBuildResponseContext(response, auditConfig) {
            return this['buildResponseContext'](response, auditConfig);
        }
        testSelectivelyIncludeFields(obj, fields) {
            return this['selectivelyIncludeFields'](obj, fields);
        }
        testSelectivelyIncludeResponseBody(body, fields) {
            return this['selectivelyIncludeResponseBody'](body, fields);
        }
        initialize() {
            return Promise.resolve();
        }
    }
    const createMockExecutionContext = () => {
        // Simplified mock that focuses on what buildRequestContext actually uses
        const mockRequest = {
            httpMethod: 'POST',
            path: '/api/users',
            headers: {
                'content-type': 'application/json',
                'authorization': 'Bearer token123',
                'user-agent': 'Mozilla/5.0',
                'x-forwarded-for': '192.168.1.1'
            },
            body: {
                email: 'john@example.com',
                password: 'secret123',
                name: 'John Doe',
                age: 30,
                preferences: {
                    theme: 'dark',
                    notifications: true
                }
            },
            queryStringParameters: {
                page: '1',
                limit: '10',
                sort: 'name',
                debug: 'true'
            }
        };
        return {
            request: mockRequest,
            response: {},
            event: {
                headers: {
                    'content-type': 'application/json',
                    'authorization': 'Bearer token123',
                    'user-agent': 'Mozilla/5.0'
                },
                requestContext: {
                    identity: { sourceIp: '192.168.1.1' }
                }
            },
            lambdaContext: {},
            actor: {
                actorType: 'user',
                actorId: 'user123',
                authMethod: 'cognito',
                requestId: 'req-123',
                timestamp: '2024-01-01T00:00:00.000Z'
            }
        };
    };
    const createMockResponse = () => ({
        statusCode: 201,
        headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '99',
            'x-response-time': '150ms'
        },
        body: JSON.stringify({
            id: '123',
            email: 'john@example.com',
            name: 'John Doe',
            token: 'access_token_123',
            internal: {
                userId: 'user_123',
                permissions: ['read', 'write']
            }
        }),
        isBase64Encoded: false,
        // Only include the methods that might be called by the code under test
        send: jest.fn(),
        end: jest.fn(),
        set: jest.fn(),
        setHeader: jest.fn(),
        getHeader: jest.fn(),
        getHeaders: jest.fn(),
        getBody: jest.fn(),
        getStatusCode: jest.fn(),
        json: jest.fn(),
        text: jest.fn(),
        html: jest.fn(),
        xml: jest.fn(),
        binary: jest.fn(),
        download: jest.fn(),
        status: jest.fn(),
        header: jest.fn(),
        cookie: jest.fn(),
        cors: jest.fn(),
        cache: jest.fn(),
        redirect: jest.fn(),
        withMetadata: jest.fn(),
        withMetrics: jest.fn(),
        setMetadata: jest.fn(),
        build: jest.fn()
    });
    let controller;
    beforeEach(() => {
        controller = new TestSelectiveAuditController();
    });
    describe('selectivelyIncludeFields Helper', () => {
        it('should return entire object when no fields specified', () => {
            const obj = { a: 1, b: 2, c: 3 };
            const result = controller.testSelectivelyIncludeFields(obj, []);
            expect(result).toEqual(obj);
        });
        it('should extract only specified fields', () => {
            const obj = { a: 1, b: 2, c: 3, d: 4 };
            const result = controller.testSelectivelyIncludeFields(obj, ['a', 'c']);
            expect(result).toEqual({ a: 1, c: 3 });
        });
        it('should ignore non-existent fields', () => {
            const obj = { a: 1, b: 2 };
            const result = controller.testSelectivelyIncludeFields(obj, ['a', 'nonexistent', 'b']);
            expect(result).toEqual({ a: 1, b: 2 });
        });
        it('should handle null/undefined objects', () => {
            expect(controller.testSelectivelyIncludeFields(null, ['field'])).toBeNull();
            expect(controller.testSelectivelyIncludeFields(undefined, ['field'])).toBeUndefined();
        });
    });
    describe('selectivelyIncludeResponseBody Helper', () => {
        it('should return entire JSON body when no fields specified', () => {
            const jsonBody = JSON.stringify({ a: 1, b: 2, c: 3 });
            const result = controller.testSelectivelyIncludeResponseBody(jsonBody, []);
            expect(result).toEqual(jsonBody);
        });
        it('should extract only specified fields from JSON body', () => {
            const jsonBody = JSON.stringify({ a: 1, b: 2, c: 3, d: 4 });
            const result = controller.testSelectivelyIncludeResponseBody(jsonBody, ['a', 'c']);
            expect(result).toEqual(JSON.stringify({ a: 1, c: 3 }));
        });
        it('should ignore non-existent fields in JSON body', () => {
            const jsonBody = JSON.stringify({ a: 1, b: 2 });
            const result = controller.testSelectivelyIncludeResponseBody(jsonBody, ['a', 'nonexistent', 'b']);
            expect(result).toEqual(JSON.stringify({ a: 1, b: 2 }));
        });
        it('should handle non-JSON strings by returning as-is', () => {
            const plainText = 'This is plain text';
            const result = controller.testSelectivelyIncludeResponseBody(plainText, ['field']);
            expect(result).toEqual(plainText);
        });
        it('should handle invalid JSON gracefully', () => {
            const invalidJson = '{ invalid json }';
            const result = controller.testSelectivelyIncludeResponseBody(invalidJson, ['field']);
            expect(result).toEqual(invalidJson);
        });
        it('should handle null/undefined/empty strings', () => {
            expect(controller.testSelectivelyIncludeResponseBody('', ['field'])).toBe('');
            expect(controller.testSelectivelyIncludeResponseBody(null, ['field'])).toBeNull();
            expect(controller.testSelectivelyIncludeResponseBody(undefined, ['field'])).toBeUndefined();
        });
    });
    describe('Request Context - Legacy Array Format', () => {
        it('should include all headers when headers specified', () => {
            const ctx = createMockExecutionContext();
            const auditConfig = {
                enabled: true,
                includes: { request: ['headers'] }
            };
            const result = controller.testBuildRequestContext(ctx, auditConfig);
            expect(result.headers).toEqual(ctx.request.headers);
            expect(result.body).toBeUndefined();
            expect(result.query).toBeUndefined();
        });
        it('should include multiple sections when specified', () => {
            const ctx = createMockExecutionContext();
            const auditConfig = {
                enabled: true,
                includes: { request: ['headers', 'body', 'query'] }
            };
            const result = controller.testBuildRequestContext(ctx, auditConfig);
            expect(result.headers).toEqual(ctx.request.headers);
            expect(result.body).toEqual(ctx.request.body);
            expect(result.query).toEqual(ctx.request.queryStringParameters);
        });
    });
    describe('Request Context - Selective Object Format', () => {
        it('should include only specified header fields', () => {
            const ctx = createMockExecutionContext();
            const auditConfig = {
                enabled: true,
                includes: {
                    request: {
                        headers: ['content-type', 'user-agent']
                    }
                }
            };
            const result = controller.testBuildRequestContext(ctx, auditConfig);
            expect(result.headers).toEqual({
                'content-type': 'application/json',
                'user-agent': 'Mozilla/5.0'
            });
            expect(result.body).toBeUndefined();
            expect(result.query).toBeUndefined();
        });
        it('should include only specified body fields', () => {
            const ctx = createMockExecutionContext();
            const auditConfig = {
                enabled: true,
                includes: {
                    request: {
                        body: ['email', 'name']
                    }
                }
            };
            const result = controller.testBuildRequestContext(ctx, auditConfig);
            expect(result.body).toEqual({
                email: 'john@example.com',
                name: 'John Doe'
            });
            expect(result.headers).toBeUndefined();
            expect(result.query).toBeUndefined();
        });
        it('should include only specified query fields', () => {
            const ctx = createMockExecutionContext();
            const auditConfig = {
                enabled: true,
                includes: {
                    request: {
                        query: ['page', 'limit']
                    }
                }
            };
            const result = controller.testBuildRequestContext(ctx, auditConfig);
            expect(result.query).toEqual({
                page: '1',
                limit: '10'
            });
            expect(result.headers).toBeUndefined();
            expect(result.body).toBeUndefined();
        });
        it('should handle selective includes for multiple sections', () => {
            const ctx = createMockExecutionContext();
            const auditConfig = {
                enabled: true,
                includes: {
                    request: {
                        headers: ['content-type'],
                        body: ['email'],
                        query: ['page']
                    }
                }
            };
            const result = controller.testBuildRequestContext(ctx, auditConfig);
            expect(result.headers).toEqual({ 'content-type': 'application/json' });
            expect(result.body).toEqual({ email: 'john@example.com' });
            expect(result.query).toEqual({ page: '1' });
        });
        it('should exclude sensitive fields from audit', () => {
            const ctx = createMockExecutionContext();
            const auditConfig = {
                enabled: true,
                includes: {
                    request: {
                        headers: ['content-type', 'user-agent'], // Exclude authorization
                        body: ['email', 'name'] // Exclude password
                    }
                }
            };
            const result = controller.testBuildRequestContext(ctx, auditConfig);
            expect(result.headers).not.toHaveProperty('authorization');
            expect(result.body).not.toHaveProperty('password');
            expect(result.headers).toEqual({
                'content-type': 'application/json',
                'user-agent': 'Mozilla/5.0'
            });
            expect(result.body).toEqual({
                email: 'john@example.com',
                name: 'John Doe'
            });
        });
    });
    describe('Response Context - Legacy Array Format', () => {
        it('should include all headers when headers specified', () => {
            const response = createMockResponse();
            const auditConfig = {
                enabled: true,
                includes: { response: ['headers'] }
            };
            const result = controller.testBuildResponseContext(response, auditConfig);
            expect(result?.headers).toEqual(response.headers);
            expect(result?.body).toBeUndefined();
        });
        it('should include both headers and body when specified', () => {
            const response = createMockResponse();
            const auditConfig = {
                enabled: true,
                includes: { response: ['headers', 'body'] }
            };
            const result = controller.testBuildResponseContext(response, auditConfig);
            expect(result?.headers).toEqual(response.headers);
            expect(result?.body).toEqual(response.body);
        });
    });
    describe('Response Context - Selective Object Format', () => {
        it('should include only specified response header fields', () => {
            const response = createMockResponse();
            const auditConfig = {
                enabled: true,
                includes: {
                    response: {
                        headers: ['content-type', 'x-response-time']
                    }
                }
            };
            const result = controller.testBuildResponseContext(response, auditConfig);
            expect(result?.headers).toEqual({
                'content-type': 'application/json',
                'x-response-time': '150ms'
            });
            expect(result?.body).toBeUndefined();
        });
        it('should include only specified response body fields', () => {
            const response = createMockResponse();
            const auditConfig = {
                enabled: true,
                includes: {
                    response: {
                        body: ['id', 'email', 'name']
                    }
                }
            };
            const result = controller.testBuildResponseContext(response, auditConfig);
            expect(result?.body).toEqual(JSON.stringify({
                id: '123',
                email: 'john@example.com',
                name: 'John Doe'
            }));
            expect(result?.headers).toBeUndefined();
        });
        it('should exclude sensitive response fields', () => {
            const response = createMockResponse();
            const auditConfig = {
                enabled: true,
                includes: {
                    response: {
                        body: ['id', 'email', 'name'] // Exclude token and internal
                    }
                }
            };
            const result = controller.testBuildResponseContext(response, auditConfig);
            const parsedBody = JSON.parse(result?.body || '{}');
            expect(parsedBody).not.toHaveProperty('token');
            expect(parsedBody).not.toHaveProperty('internal');
            expect(parsedBody).toEqual({
                id: '123',
                email: 'john@example.com',
                name: 'John Doe'
            });
        });
    });
    describe('Backwards Compatibility', () => {
        it('should handle boolean true for request includes', () => {
            const ctx = createMockExecutionContext();
            const auditConfig = {
                enabled: true,
                includes: { request: true }
            };
            const result = controller.testBuildRequestContext(ctx, auditConfig);
            expect(result.headers).toEqual(ctx.request.headers);
            expect(result.body).toBeUndefined();
            expect(result.query).toBeUndefined();
        });
        it('should handle boolean true for response includes', () => {
            const response = createMockResponse();
            const auditConfig = {
                enabled: true,
                includes: { response: true }
            };
            const result = controller.testBuildResponseContext(response, auditConfig);
            expect(result?.headers).toEqual(response.headers);
            expect(result?.body).toBeUndefined();
        });
        it('should return undefined when no includes specified', () => {
            const ctx = createMockExecutionContext();
            const response = createMockResponse();
            const auditConfig = { enabled: true };
            const requestResult = controller.testBuildRequestContext(ctx, auditConfig);
            const responseResult = controller.testBuildResponseContext(response, auditConfig);
            expect(requestResult.headers).toBeUndefined();
            expect(requestResult.body).toBeUndefined();
            expect(requestResult.query).toBeUndefined();
            expect(responseResult).toBeUndefined();
        });
    });
    describe('Edge Cases', () => {
        it('should handle empty field arrays correctly', () => {
            const ctx = createMockExecutionContext();
            const auditConfig = {
                enabled: true,
                includes: {
                    request: {
                        headers: [],
                        body: [],
                        query: []
                    }
                }
            };
            const result = controller.testBuildRequestContext(ctx, auditConfig);
            // Empty arrays should still include the objects (implementation returns full object when no fields specified)
            expect(result.headers).toEqual(ctx.request.headers);
            expect(result.body).toEqual(ctx.request.body);
            expect(result.query).toEqual(ctx.request.queryStringParameters);
        });
        it('should handle non-existent fields gracefully', () => {
            const ctx = createMockExecutionContext();
            const auditConfig = {
                enabled: true,
                includes: {
                    request: {
                        headers: ['non-existent-header'],
                        body: ['non-existent-field']
                    }
                }
            };
            const result = controller.testBuildRequestContext(ctx, auditConfig);
            expect(result.headers).toEqual({});
            expect(result.body).toEqual({});
        });
    });
    describe('Real Implementation Validation', () => {
        it('should verify the selectivelyIncludeFields implementation matches expected behavior', () => {
            // Test that our implementation correctly handles the documented behavior
            const testObj = {
                sensitive: 'secret123',
                public: 'visible',
                nested: { inner: 'data' }
            };
            // Test selective inclusion
            const selected = controller.testSelectivelyIncludeFields(testObj, ['public', 'nested']);
            expect(selected).toEqual({ public: 'visible', nested: { inner: 'data' } });
            expect(selected).not.toHaveProperty('sensitive');
            // Test empty array behavior
            const all = controller.testSelectivelyIncludeFields(testObj, []);
            expect(all).toEqual(testObj);
        });
        it('should verify buildRequestContext handles real-world audit configs', () => {
            const ctx = createMockExecutionContext();
            // Test a realistic audit config for a payment API
            const paymentAuditConfig = {
                enabled: true,
                includes: {
                    request: {
                        headers: ['content-type', 'user-agent'], // Exclude authorization
                        body: ['amount', 'currency', 'orderId'], // Exclude card details
                        query: ['merchantId'] // Only merchant tracking
                    }
                }
            };
            const result = controller.testBuildRequestContext(ctx, paymentAuditConfig);
            // Should only include safe fields
            expect(result.headers).toEqual({
                'content-type': 'application/json',
                'user-agent': 'Mozilla/5.0'
            });
            expect(result.headers).not.toHaveProperty('authorization');
            // Should exclude sensitive body fields like password
            expect(result.body).not.toHaveProperty('password');
            expect(result.body).not.toHaveProperty('email');
            // Should be empty since merchantId is not in our mock query
            expect(result.query).toEqual({});
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VsZWN0aXZlLWZpZWxkLWF1ZGl0aW5nLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvaGVscGVycy9zZWxlY3RpdmUtZmllbGQtYXVkaXRpbmcudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHNGQUEwRTtBQUsxRSxRQUFRLENBQUMsMEJBQTBCLEVBQUUsR0FBRyxFQUFFO0lBRXhDLE1BQU0sNEJBQTZCLFNBQVEsc0NBQWE7UUFDdEQ7WUFDRSxLQUFLLEVBQUUsQ0FBQztRQUNWLENBQUM7UUFFRCxxQ0FBcUM7UUFDOUIsdUJBQXVCLENBQUMsR0FBcUIsRUFBRSxXQUF3QjtZQUM1RSxPQUFPLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLEdBQUcsRUFBRSxXQUFXLENBQUMsQ0FBQztRQUN2RCxDQUFDO1FBRU0sd0JBQXdCLENBQUMsUUFBa0IsRUFBRSxXQUF3QjtZQUMxRSxPQUFPLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQztRQUM3RCxDQUFDO1FBRU0sNEJBQTRCLENBQUMsR0FBUSxFQUFFLE1BQWdCO1lBQzVELE9BQU8sSUFBSSxDQUFDLDBCQUEwQixDQUFDLENBQUMsR0FBRyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQ3ZELENBQUM7UUFFTSxrQ0FBa0MsQ0FBQyxJQUFZLEVBQUUsTUFBZ0I7WUFDdEUsT0FBTyxJQUFJLENBQUMsZ0NBQWdDLENBQUMsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDOUQsQ0FBQztRQUVTLFVBQVU7WUFDbEIsT0FBTyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDM0IsQ0FBQztLQUNGO0lBRUQsTUFBTSwwQkFBMEIsR0FBRyxHQUFxQixFQUFFO1FBQ3hELHlFQUF5RTtRQUN6RSxNQUFNLFdBQVcsR0FBRztZQUNsQixVQUFVLEVBQUUsTUFBTTtZQUNsQixJQUFJLEVBQUUsWUFB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ImltcG9ydCB7IEFQSUNvbnRyb2xsZXIgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvYXBpLWdhdGV3YXktY29udHJvbGxlcic7XG5pbXBvcnQgeyBBdWRpdENvbmZpZyB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCwgQWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IFJlc3BvbnNlIH0gZnJvbSAnLi4vLi4vaW50ZXJmYWNlcyc7XG5cbmRlc2NyaWJlKCdTZWxlY3RpdmUgRmllbGQgQXVkaXRpbmcnLCAoKSA9PiB7XG4gIFxuICBjbGFzcyBUZXN0U2VsZWN0aXZlQXVkaXRDb250cm9sbGVyIGV4dGVuZHMgQVBJQ29udHJvbGxlciB7XG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICBzdXBlcigpO1xuICAgIH1cbiAgICBcbiAgICAvLyBFeHBvc2UgcHJpdmF0ZSBtZXRob2RzIGZvciB0ZXN0aW5nXG4gICAgcHVibGljIHRlc3RCdWlsZFJlcXVlc3RDb250ZXh0KGN0eDogRXhlY3V0aW9uQ29udGV4dCwgYXVkaXRDb25maWc6IEF1ZGl0Q29uZmlnKSB7XG4gICAgICByZXR1cm4gdGhpc1snYnVpbGRSZXF1ZXN0Q29udGV4dCddKGN0eCwgYXVkaXRDb25maWcpO1xuICAgIH1cbiAgICBcbiAgICBwdWJsaWMgdGVzdEJ1aWxkUmVzcG9uc2VDb250ZXh0KHJlc3BvbnNlOiBSZXNwb25zZSwgYXVkaXRDb25maWc6IEF1ZGl0Q29uZmlnKSB7XG4gICAgICByZXR1cm4gdGhpc1snYnVpbGRSZXNwb25zZUNvbnRleHQnXShyZXNwb25zZSwgYXVkaXRDb25maWcpO1xuICAgIH1cbiAgICBcbiAgICBwdWJsaWMgdGVzdFNlbGVjdGl2ZWx5SW5jbHVkZUZpZWxkcyhvYmo6IGFueSwgZmllbGRzOiBzdHJpbmdbXSkge1xuICAgICAgcmV0dXJuIHRoaXNbJ3NlbGVjdGl2ZWx5SW5jbHVkZUZpZWxkcyddKG9iaiwgZmllbGRzKTtcbiAgICB9XG4gICAgXG4gICAgcHVibGljIHRlc3RTZWxlY3RpdmVseUluY2x1ZGVSZXNwb25zZUJvZHkoYm9keTogc3RyaW5nLCBmaWVsZHM6IHN0cmluZ1tdKSB7XG4gICAgICByZXR1cm4gdGhpc1snc2VsZWN0aXZlbHlJbmNsdWRlUmVzcG9uc2VCb2R5J10oYm9keSwgZmllbGRzKTtcbiAgICB9XG4gICAgXG4gICAgcHJvdGVjdGVkIGluaXRpYWxpemUoKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQgPSAoKTogRXhlY3V0aW9uQ29udGV4dCA9PiB7XG4gICAgLy8gU2ltcGxpZmllZCBtb2NrIHRoYXQgZm9jdXNlcyBvbiB3aGF0IGJ1aWxkUmVxdWVzdENvbnRleHQgYWN0dWFsbHkgdXNlc1xuICAgIGNvbnN0IG1vY2tSZXF1ZXN0ID0ge1xuICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxuICAgICAgcGF0aDogJy9hcGkvdXNlcnMnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAnYXV0aG9yaXphdGlvbic6ICdCZWFyZXIgdG9rZW4xMjMnLFxuICAgICAgICAndXNlci1hZ2VudCc6ICdNb3ppbGxhLzUuMCcsXG4gICAgICAgICd4LWZvcndhcmRlZC1mb3InOiAnMTkyLjE2OC4xLjEnXG4gICAgICB9LFxuICAgICAgYm9keToge1xuICAgICAgICBlbWFpbDogJ2pvaG5AZXhhbXBsZS5jb20nLFxuICAgICAgICBwYXNzd29yZDogJ3NlY3JldDEyMycsXG4gICAgICAgIG5hbWU6ICdKb2huIERvZScsXG4gICAgICAgIGFnZTogMzAsXG4gICAgICAgIHByZWZlcmVuY2VzOiB7XG4gICAgICAgICAgdGhlbWU6ICdkYXJrJyxcbiAgICAgICAgICBub3RpZmljYXRpb25zOiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgcGFnZTogJzEnLFxuICAgICAgICBsaW1pdDogJzEwJyxcbiAgICAgICAgc29ydDogJ25hbWUnLFxuICAgICAgICBkZWJ1ZzogJ3RydWUnXG4gICAgICB9XG4gICAgfTtcblxuICAgIHJldHVybiB7XG4gICAgICByZXF1ZXN0OiBtb2NrUmVxdWVzdCBhcyBhbnksXG4gICAgICByZXNwb25zZToge30gYXMgYW55LFxuICAgICAgZXZlbnQ6IHtcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgJ2F1dGhvcml6YXRpb24nOiAnQmVhcmVyIHRva2VuMTIzJyxcbiAgICAgICAgICAndXNlci1hZ2VudCc6ICdNb3ppbGxhLzUuMCdcbiAgICAgICAgfSxcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcbiAgICAgICAgICBpZGVudGl0eTogeyBzb3VyY2VJcDogJzE5Mi4xNjguMS4xJyB9XG4gICAgICAgIH1cbiAgICAgIH0gYXMgYW55LFxuICAgICAgbGFtYmRhQ29udGV4dDoge30gYXMgYW55LFxuICAgICAgYWN0b3I6IHtcbiAgICAgICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgICAgIGFjdG9ySWQ6ICd1c2VyMTIzJyxcbiAgICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtMTIzJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaJ1xuICAgICAgfSBhcyBBY3RvclxuICAgIH07XG4gIH07XG5cbiAgY29uc3QgY3JlYXRlTW9ja1Jlc3BvbnNlID0gKCk6IFJlc3BvbnNlID0+ICh7XG4gICAgc3RhdHVzQ29kZTogMjAxLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAneC1yYXRlbGltaXQtcmVtYWluaW5nJzogJzk5JyxcbiAgICAgICd4LXJlc3BvbnNlLXRpbWUnOiAnMTUwbXMnXG4gICAgfSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICBpZDogJzEyMycsXG4gICAgICBlbWFpbDogJ2pvaG5AZXhhbXBsZS5jb20nLFxuICAgICAgbmFtZTogJ0pvaG4gRG9lJyxcbiAgICAgIHRva2VuOiAnYWNjZXNzX3Rva2VuXzEyMycsXG4gICAgICBpbnRlcm5hbDoge1xuICAgICAgICB1c2VySWQ6ICd1c2VyXzEyMycsXG4gICAgICAgIHBlcm1pc3Npb25zOiBbJ3JlYWQnLCAnd3JpdGUnXVxuICAgICAgfVxuICAgIH0pLFxuICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXG4gICAgLy8gT25seSBpbmNsdWRlIHRoZSBtZXRob2RzIHRoYXQgbWlnaHQgYmUgY2FsbGVkIGJ5IHRoZSBjb2RlIHVuZGVyIHRlc3RcbiAgICBzZW5kOiBqZXN0LmZuKCksXG4gICAgZW5kOiBqZXN0LmZuKCksXG4gICAgc2V0OiBqZXN0LmZuKCksXG4gICAgc2V0SGVhZGVyOiBqZXN0LmZuKCksXG4gICAgZ2V0SGVhZGVyOiBqZXN0LmZuKCksXG4gICAgZ2V0SGVhZGVyczogamVzdC5mbigpLFxuICAgIGdldEJvZHk6IGplc3QuZm4oKSxcbiAgICBnZXRTdGF0dXNDb2RlOiBqZXN0LmZuKCksXG4gICAganNvbjogamVzdC5mbigpLFxuICAgIHRleHQ6IGplc3QuZm4oKSxcbiAgICBodG1sOiBqZXN0LmZuKCksXG4gICAgeG1sOiBqZXN0LmZuKCksXG4gICAgYmluYXJ5OiBqZXN0LmZuKCksXG4gICAgZG93bmxvYWQ6IGplc3QuZm4oKSxcbiAgICBzdGF0dXM6IGplc3QuZm4oKSxcbiAgICBoZWFkZXI6IGplc3QuZm4oKSxcbiAgICBjb29raWU6IGplc3QuZm4oKSxcbiAgICBjb3JzOiBqZXN0LmZuKCksXG4gICAgY2FjaGU6IGplc3QuZm4oKSxcbiAgICByZWRpcmVjdDogamVzdC5mbigpLFxuICAgIHdpdGhNZXRhZGF0YTogamVzdC5mbigpLFxuICAgIHdpdGhNZXRyaWNzOiBqZXN0LmZuKCksXG4gICAgc2V0TWV0YWRhdGE6IGplc3QuZm4oKSxcbiAgICBidWlsZDogamVzdC5mbigpXG4gIH0pO1xuXG4gIGxldCBjb250cm9sbGVyOiBUZXN0U2VsZWN0aXZlQXVkaXRDb250cm9sbGVyO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGNvbnRyb2xsZXIgPSBuZXcgVGVzdFNlbGVjdGl2ZUF1ZGl0Q29udHJvbGxlcigpO1xuICB9KTtcblxuICBkZXNjcmliZSgnc2VsZWN0aXZlbHlJbmNsdWRlRmllbGRzIEhlbHBlcicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJldHVybiBlbnRpcmUgb2JqZWN0IHdoZW4gbm8gZmllbGRzIHNwZWNpZmllZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IG9iaiA9IHsgYTogMSwgYjogMiwgYzogMyB9O1xuICAgICAgY29uc3QgcmVzdWx0ID0gY29udHJvbGxlci50ZXN0U2VsZWN0aXZlbHlJbmNsdWRlRmllbGRzKG9iaiwgW10pO1xuICAgICAgXG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKG9iaik7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGV4dHJhY3Qgb25seSBzcGVjaWZpZWQgZmllbGRzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgb2JqID0geyBhOiAxLCBiOiAyLCBjOiAzLCBkOiA0IH07XG4gICAgICBjb25zdCByZXN1bHQgPSBjb250cm9sbGVyLnRlc3RTZWxlY3RpdmVseUluY2x1ZGVGaWVsZHMob2JqLCBbJ2EnLCAnYyddKTtcbiAgICAgIFxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7IGE6IDEsIGM6IDMgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGlnbm9yZSBub24tZXhpc3RlbnQgZmllbGRzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgb2JqID0geyBhOiAxLCBiOiAyIH07XG4gICAgICBjb25zdCByZXN1bHQgPSBjb250cm9sbGVyLnRlc3RTZWxlY3RpdmVseUluY2x1ZGVGaWVsZHMob2JqLCBbJ2EnLCAnbm9uZXhpc3RlbnQnLCAnYiddKTtcbiAgICAgIFxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7IGE6IDEsIGI6IDIgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBudWxsL3VuZGVmaW5lZCBvYmplY3RzJywgKCkgPT4ge1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdFNlbGVjdGl2ZWx5SW5jbHVkZUZpZWxkcyhudWxsLCBbJ2ZpZWxkJ10pKS50b0JlTnVsbCgpO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdFNlbGVjdGl2ZWx5SW5jbHVkZUZpZWxkcyh1bmRlZmluZWQsIFsnZmllbGQnXSkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3NlbGVjdGl2ZWx5SW5jbHVkZVJlc3BvbnNlQm9keSBIZWxwZXInLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gZW50aXJlIEpTT04gYm9keSB3aGVuIG5vIGZpZWxkcyBzcGVjaWZpZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBqc29uQm9keSA9IEpTT04uc3RyaW5naWZ5KHsgYTogMSwgYjogMiwgYzogMyB9KTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdFNlbGVjdGl2ZWx5SW5jbHVkZVJlc3BvbnNlQm9keShqc29uQm9keSwgW10pO1xuICAgICAgXG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKGpzb25Cb2R5KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBvbmx5IHNwZWNpZmllZCBmaWVsZHMgZnJvbSBKU09OIGJvZHknLCAoKSA9PiB7XG4gICAgICBjb25zdCBqc29uQm9keSA9IEpTT04uc3RyaW5naWZ5KHsgYTogMSwgYjogMiwgYzogMywgZDogNCB9KTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdFNlbGVjdGl2ZWx5SW5jbHVkZVJlc3BvbnNlQm9keShqc29uQm9keSwgWydhJywgJ2MnXSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoSlNPTi5zdHJpbmdpZnkoeyBhOiAxLCBjOiAzIH0pKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaWdub3JlIG5vbi1leGlzdGVudCBmaWVsZHMgaW4gSlNPTiBib2R5JywgKCkgPT4ge1xuICAgICAgY29uc3QganNvbkJvZHkgPSBKU09OLnN0cmluZ2lmeSh7IGE6IDEsIGI6IDIgfSk7XG4gICAgICBjb25zdCByZXN1bHQgPSBjb250cm9sbGVyLnRlc3RTZWxlY3RpdmVseUluY2x1ZGVSZXNwb25zZUJvZHkoanNvbkJvZHksIFsnYScsICdub25leGlzdGVudCcsICdiJ10pO1xuICAgICAgXG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKEpTT04uc3RyaW5naWZ5KHsgYTogMSwgYjogMiB9KSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBub24tSlNPTiBzdHJpbmdzIGJ5IHJldHVybmluZyBhcy1pcycsICgpID0+IHtcbiAgICAgIGNvbnN0IHBsYWluVGV4dCA9ICdUaGlzIGlzIHBsYWluIHRleHQnO1xuICAgICAgY29uc3QgcmVzdWx0ID0gY29udHJvbGxlci50ZXN0U2VsZWN0aXZlbHlJbmNsdWRlUmVzcG9uc2VCb2R5KHBsYWluVGV4dCwgWydmaWVsZCddKTtcbiAgICAgIFxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbChwbGFpblRleHQpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgaW52YWxpZCBKU09OIGdyYWNlZnVsbHknLCAoKSA9PiB7XG4gICAgICBjb25zdCBpbnZhbGlkSnNvbiA9ICd7IGludmFsaWQganNvbiB9JztcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdFNlbGVjdGl2ZWx5SW5jbHVkZVJlc3BvbnNlQm9keShpbnZhbGlkSnNvbiwgWydmaWVsZCddKTtcbiAgICAgIFxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbChpbnZhbGlkSnNvbik7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBudWxsL3VuZGVmaW5lZC9lbXB0eSBzdHJpbmdzJywgKCkgPT4ge1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdFNlbGVjdGl2ZWx5SW5jbHVkZVJlc3BvbnNlQm9keSgnJywgWydmaWVsZCddKSkudG9CZSgnJyk7XG4gICAgICBleHBlY3QoY29udHJvbGxlci50ZXN0U2VsZWN0aXZlbHlJbmNsdWRlUmVzcG9uc2VCb2R5KG51bGwgYXMgYW55LCBbJ2ZpZWxkJ10pKS50b0JlTnVsbCgpO1xuICAgICAgZXhwZWN0KGNvbnRyb2xsZXIudGVzdFNlbGVjdGl2ZWx5SW5jbHVkZVJlc3BvbnNlQm9keSh1bmRlZmluZWQgYXMgYW55LCBbJ2ZpZWxkJ10pKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdSZXF1ZXN0IENvbnRleHQgLSBMZWdhY3kgQXJyYXkgRm9ybWF0JywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaW5jbHVkZSBhbGwgaGVhZGVycyB3aGVuIGhlYWRlcnMgc3BlY2lmaWVkJywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZXM6IHsgcmVxdWVzdDogWydoZWFkZXJzJ10gfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gY29udHJvbGxlci50ZXN0QnVpbGRSZXF1ZXN0Q29udGV4dChjdHgsIGF1ZGl0Q29uZmlnKTtcblxuICAgICAgZXhwZWN0KHJlc3VsdC5oZWFkZXJzKS50b0VxdWFsKGN0eC5yZXF1ZXN0LmhlYWRlcnMpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5ib2R5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICBleHBlY3QocmVzdWx0LnF1ZXJ5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGluY2x1ZGUgbXVsdGlwbGUgc2VjdGlvbnMgd2hlbiBzcGVjaWZpZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgY29uc3QgYXVkaXRDb25maWc6IEF1ZGl0Q29uZmlnID0ge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBpbmNsdWRlczogeyByZXF1ZXN0OiBbJ2hlYWRlcnMnLCAnYm9keScsICdxdWVyeSddIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdEJ1aWxkUmVxdWVzdENvbnRleHQoY3R4LCBhdWRpdENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuaGVhZGVycykudG9FcXVhbChjdHgucmVxdWVzdC5oZWFkZXJzKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuYm9keSkudG9FcXVhbChjdHgucmVxdWVzdC5ib2R5KTtcbiAgICAgIGV4cGVjdChyZXN1bHQucXVlcnkpLnRvRXF1YWwoY3R4LnJlcXVlc3QucXVlcnlTdHJpbmdQYXJhbWV0ZXJzKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1JlcXVlc3QgQ29udGV4dCAtIFNlbGVjdGl2ZSBPYmplY3QgRm9ybWF0JywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaW5jbHVkZSBvbmx5IHNwZWNpZmllZCBoZWFkZXIgZmllbGRzJywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZXM6IHtcbiAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICBoZWFkZXJzOiBbJ2NvbnRlbnQtdHlwZScsICd1c2VyLWFnZW50J11cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdEJ1aWxkUmVxdWVzdENvbnRleHQoY3R4LCBhdWRpdENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuaGVhZGVycykudG9FcXVhbCh7XG4gICAgICAgICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICd1c2VyLWFnZW50JzogJ01vemlsbGEvNS4wJ1xuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzdWx0LmJvZHkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChyZXN1bHQucXVlcnkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaW5jbHVkZSBvbmx5IHNwZWNpZmllZCBib2R5IGZpZWxkcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGN0eCA9IGNyZWF0ZU1vY2tFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICBjb25zdCBhdWRpdENvbmZpZzogQXVkaXRDb25maWcgPSB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGluY2x1ZGVzOiB7XG4gICAgICAgICAgcmVxdWVzdDoge1xuICAgICAgICAgICAgYm9keTogWydlbWFpbCcsICduYW1lJ11cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdEJ1aWxkUmVxdWVzdENvbnRleHQoY3R4LCBhdWRpdENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuYm9keSkudG9FcXVhbCh7XG4gICAgICAgIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbScsXG4gICAgICAgIG5hbWU6ICdKb2huIERvZSdcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3VsdC5oZWFkZXJzKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICBleHBlY3QocmVzdWx0LnF1ZXJ5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGluY2x1ZGUgb25seSBzcGVjaWZpZWQgcXVlcnkgZmllbGRzJywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZXM6IHtcbiAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICBxdWVyeTogWydwYWdlJywgJ2xpbWl0J11cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdEJ1aWxkUmVxdWVzdENvbnRleHQoY3R4LCBhdWRpdENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQucXVlcnkpLnRvRXF1YWwoe1xuICAgICAgICBwYWdlOiAnMScsXG4gICAgICAgIGxpbWl0OiAnMTAnXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXN1bHQuaGVhZGVycykudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5ib2R5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBzZWxlY3RpdmUgaW5jbHVkZXMgZm9yIG11bHRpcGxlIHNlY3Rpb25zJywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZXM6IHtcbiAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICBoZWFkZXJzOiBbJ2NvbnRlbnQtdHlwZSddLFxuICAgICAgICAgICAgYm9keTogWydlbWFpbCddLFxuICAgICAgICAgICAgcXVlcnk6IFsncGFnZSddXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBjb250cm9sbGVyLnRlc3RCdWlsZFJlcXVlc3RDb250ZXh0KGN0eCwgYXVkaXRDb25maWcpO1xuXG4gICAgICBleHBlY3QocmVzdWx0LmhlYWRlcnMpLnRvRXF1YWwoeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgZXhwZWN0KHJlc3VsdC5ib2R5KS50b0VxdWFsKHsgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJyB9KTtcbiAgICAgIGV4cGVjdChyZXN1bHQucXVlcnkpLnRvRXF1YWwoeyBwYWdlOiAnMScgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGV4Y2x1ZGUgc2Vuc2l0aXZlIGZpZWxkcyBmcm9tIGF1ZGl0JywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZXM6IHtcbiAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICBoZWFkZXJzOiBbJ2NvbnRlbnQtdHlwZScsICd1c2VyLWFnZW50J10sIC8vIEV4Y2x1ZGUgYXV0aG9yaXphdGlvblxuICAgICAgICAgICAgYm9keTogWydlbWFpbCcsICduYW1lJ10gICAgICAgICAgICAgICAgICAvLyBFeGNsdWRlIHBhc3N3b3JkXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBjb250cm9sbGVyLnRlc3RCdWlsZFJlcXVlc3RDb250ZXh0KGN0eCwgYXVkaXRDb25maWcpO1xuXG4gICAgICBleHBlY3QocmVzdWx0LmhlYWRlcnMpLm5vdC50b0hhdmVQcm9wZXJ0eSgnYXV0aG9yaXphdGlvbicpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5ib2R5KS5ub3QudG9IYXZlUHJvcGVydHkoJ3Bhc3N3b3JkJyk7XG4gICAgICBleHBlY3QocmVzdWx0LmhlYWRlcnMpLnRvRXF1YWwoe1xuICAgICAgICAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAndXNlci1hZ2VudCc6ICdNb3ppbGxhLzUuMCdcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KHJlc3VsdC5ib2R5KS50b0VxdWFsKHtcbiAgICAgICAgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJyxcbiAgICAgICAgbmFtZTogJ0pvaG4gRG9lJ1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdSZXNwb25zZSBDb250ZXh0IC0gTGVnYWN5IEFycmF5IEZvcm1hdCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGluY2x1ZGUgYWxsIGhlYWRlcnMgd2hlbiBoZWFkZXJzIHNwZWNpZmllZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gY3JlYXRlTW9ja1Jlc3BvbnNlKCk7XG4gICAgICBjb25zdCBhdWRpdENvbmZpZzogQXVkaXRDb25maWcgPSB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGluY2x1ZGVzOiB7IHJlc3BvbnNlOiBbJ2hlYWRlcnMnXSB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBjb250cm9sbGVyLnRlc3RCdWlsZFJlc3BvbnNlQ29udGV4dChyZXNwb25zZSwgYXVkaXRDb25maWcpO1xuXG4gICAgICBleHBlY3QocmVzdWx0Py5oZWFkZXJzKS50b0VxdWFsKHJlc3BvbnNlLmhlYWRlcnMpO1xuICAgICAgZXhwZWN0KHJlc3VsdD8uYm9keSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBpbmNsdWRlIGJvdGggaGVhZGVycyBhbmQgYm9keSB3aGVuIHNwZWNpZmllZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gY3JlYXRlTW9ja1Jlc3BvbnNlKCk7XG4gICAgICBjb25zdCBhdWRpdENvbmZpZzogQXVkaXRDb25maWcgPSB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGluY2x1ZGVzOiB7IHJlc3BvbnNlOiBbJ2hlYWRlcnMnLCAnYm9keSddIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdEJ1aWxkUmVzcG9uc2VDb250ZXh0KHJlc3BvbnNlLCBhdWRpdENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQ/LmhlYWRlcnMpLnRvRXF1YWwocmVzcG9uc2UuaGVhZGVycyk7XG4gICAgICBleHBlY3QocmVzdWx0Py5ib2R5KS50b0VxdWFsKHJlc3BvbnNlLmJvZHkpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnUmVzcG9uc2UgQ29udGV4dCAtIFNlbGVjdGl2ZSBPYmplY3QgRm9ybWF0JywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaW5jbHVkZSBvbmx5IHNwZWNpZmllZCByZXNwb25zZSBoZWFkZXIgZmllbGRzJywgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBjcmVhdGVNb2NrUmVzcG9uc2UoKTtcbiAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZXM6IHtcbiAgICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgICAgaGVhZGVyczogWydjb250ZW50LXR5cGUnLCAneC1yZXNwb25zZS10aW1lJ11cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdEJ1aWxkUmVzcG9uc2VDb250ZXh0KHJlc3BvbnNlLCBhdWRpdENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQ/LmhlYWRlcnMpLnRvRXF1YWwoe1xuICAgICAgICAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAneC1yZXNwb25zZS10aW1lJzogJzE1MG1zJ1xuICAgICAgfSk7XG4gICAgICBleHBlY3QocmVzdWx0Py5ib2R5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGluY2x1ZGUgb25seSBzcGVjaWZpZWQgcmVzcG9uc2UgYm9keSBmaWVsZHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGNyZWF0ZU1vY2tSZXNwb25zZSgpO1xuICAgICAgY29uc3QgYXVkaXRDb25maWc6IEF1ZGl0Q29uZmlnID0ge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBpbmNsdWRlczoge1xuICAgICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgICBib2R5OiBbJ2lkJywgJ2VtYWlsJywgJ25hbWUnXVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gY29udHJvbGxlci50ZXN0QnVpbGRSZXNwb25zZUNvbnRleHQocmVzcG9uc2UsIGF1ZGl0Q29uZmlnKTtcblxuICAgICAgZXhwZWN0KHJlc3VsdD8uYm9keSkudG9FcXVhbChKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGlkOiAnMTIzJyxcbiAgICAgICAgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJyxcbiAgICAgICAgbmFtZTogJ0pvaG4gRG9lJ1xuICAgICAgfSkpO1xuICAgICAgZXhwZWN0KHJlc3VsdD8uaGVhZGVycykudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBleGNsdWRlIHNlbnNpdGl2ZSByZXNwb25zZSBmaWVsZHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGNyZWF0ZU1vY2tSZXNwb25zZSgpO1xuICAgICAgY29uc3QgYXVkaXRDb25maWc6IEF1ZGl0Q29uZmlnID0ge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBpbmNsdWRlczoge1xuICAgICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgICBib2R5OiBbJ2lkJywgJ2VtYWlsJywgJ25hbWUnXSAvLyBFeGNsdWRlIHRva2VuIGFuZCBpbnRlcm5hbFxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gY29udHJvbGxlci50ZXN0QnVpbGRSZXNwb25zZUNvbnRleHQocmVzcG9uc2UsIGF1ZGl0Q29uZmlnKTtcblxuICAgICAgY29uc3QgcGFyc2VkQm9keSA9IEpTT04ucGFyc2UocmVzdWx0Py5ib2R5IHx8ICd7fScpO1xuICAgICAgZXhwZWN0KHBhcnNlZEJvZHkpLm5vdC50b0hhdmVQcm9wZXJ0eSgndG9rZW4nKTtcbiAgICAgIGV4cGVjdChwYXJzZWRCb2R5KS5ub3QudG9IYXZlUHJvcGVydHkoJ2ludGVybmFsJyk7XG4gICAgICBleHBlY3QocGFyc2VkQm9keSkudG9FcXVhbCh7XG4gICAgICAgIGlkOiAnMTIzJyxcbiAgICAgICAgZW1haWw6ICdqb2huQGV4YW1wbGUuY29tJyxcbiAgICAgICAgbmFtZTogJ0pvaG4gRG9lJ1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdCYWNrd2FyZHMgQ29tcGF0aWJpbGl0eScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBib29sZWFuIHRydWUgZm9yIHJlcXVlc3QgaW5jbHVkZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgY29uc3QgYXVkaXRDb25maWc6IEF1ZGl0Q29uZmlnID0ge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBpbmNsdWRlczogeyByZXF1ZXN0OiB0cnVlIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdEJ1aWxkUmVxdWVzdENvbnRleHQoY3R4LCBhdWRpdENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuaGVhZGVycykudG9FcXVhbChjdHgucmVxdWVzdC5oZWFkZXJzKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuYm9keSkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5xdWVyeSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYm9vbGVhbiB0cnVlIGZvciByZXNwb25zZSBpbmNsdWRlcycsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gY3JlYXRlTW9ja1Jlc3BvbnNlKCk7XG4gICAgICBjb25zdCBhdWRpdENvbmZpZzogQXVkaXRDb25maWcgPSB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGluY2x1ZGVzOiB7IHJlc3BvbnNlOiB0cnVlIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdEJ1aWxkUmVzcG9uc2VDb250ZXh0KHJlc3BvbnNlLCBhdWRpdENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQ/LmhlYWRlcnMpLnRvRXF1YWwocmVzcG9uc2UuaGVhZGVycyk7XG4gICAgICBleHBlY3QocmVzdWx0Py5ib2R5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiB1bmRlZmluZWQgd2hlbiBubyBpbmNsdWRlcyBzcGVjaWZpZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBjcmVhdGVNb2NrUmVzcG9uc2UoKTtcbiAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyA9IHsgZW5hYmxlZDogdHJ1ZSB9O1xuXG4gICAgICBjb25zdCByZXF1ZXN0UmVzdWx0ID0gY29udHJvbGxlci50ZXN0QnVpbGRSZXF1ZXN0Q29udGV4dChjdHgsIGF1ZGl0Q29uZmlnKTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlUmVzdWx0ID0gY29udHJvbGxlci50ZXN0QnVpbGRSZXNwb25zZUNvbnRleHQocmVzcG9uc2UsIGF1ZGl0Q29uZmlnKTtcblxuICAgICAgZXhwZWN0KHJlcXVlc3RSZXN1bHQuaGVhZGVycykudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHJlcXVlc3RSZXN1bHQuYm9keSkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHJlcXVlc3RSZXN1bHQucXVlcnkpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZVJlc3VsdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnRWRnZSBDYXNlcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBmaWVsZCBhcnJheXMgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZXM6IHtcbiAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICBoZWFkZXJzOiBbXSxcbiAgICAgICAgICAgIGJvZHk6IFtdLFxuICAgICAgICAgICAgcXVlcnk6IFtdXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBjb250cm9sbGVyLnRlc3RCdWlsZFJlcXVlc3RDb250ZXh0KGN0eCwgYXVkaXRDb25maWcpO1xuXG4gICAgICAvLyBFbXB0eSBhcnJheXMgc2hvdWxkIHN0aWxsIGluY2x1ZGUgdGhlIG9iamVjdHMgKGltcGxlbWVudGF0aW9uIHJldHVybnMgZnVsbCBvYmplY3Qgd2hlbiBubyBmaWVsZHMgc3BlY2lmaWVkKVxuICAgICAgZXhwZWN0KHJlc3VsdC5oZWFkZXJzKS50b0VxdWFsKGN0eC5yZXF1ZXN0LmhlYWRlcnMpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5ib2R5KS50b0VxdWFsKGN0eC5yZXF1ZXN0LmJvZHkpO1xuICAgICAgZXhwZWN0KHJlc3VsdC5xdWVyeSkudG9FcXVhbChjdHgucmVxdWVzdC5xdWVyeVN0cmluZ1BhcmFtZXRlcnMpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbm9uLWV4aXN0ZW50IGZpZWxkcyBncmFjZWZ1bGx5JywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0gY3JlYXRlTW9ja0V4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgIGNvbnN0IGF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZXM6IHtcbiAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICBoZWFkZXJzOiBbJ25vbi1leGlzdGVudC1oZWFkZXInXSxcbiAgICAgICAgICAgIGJvZHk6IFsnbm9uLWV4aXN0ZW50LWZpZWxkJ11cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNvbnRyb2xsZXIudGVzdEJ1aWxkUmVxdWVzdENvbnRleHQoY3R4LCBhdWRpdENvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQuaGVhZGVycykudG9FcXVhbCh7fSk7XG4gICAgICBleHBlY3QocmVzdWx0LmJvZHkpLnRvRXF1YWwoe30pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnUmVhbCBJbXBsZW1lbnRhdGlvbiBWYWxpZGF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgdmVyaWZ5IHRoZSBzZWxlY3RpdmVseUluY2x1ZGVGaWVsZHMgaW1wbGVtZW50YXRpb24gbWF0Y2hlcyBleHBlY3RlZCBiZWhhdmlvcicsICgpID0+IHtcbiAgICAgIC8vIFRlc3QgdGhhdCBvdXIgaW1wbGVtZW50YXRpb24gY29ycmVjdGx5IGhhbmRsZXMgdGhlIGRvY3VtZW50ZWQgYmVoYXZpb3JcbiAgICAgIGNvbnN0IHRlc3RPYmogPSB7XG4gICAgICAgIHNlbnNpdGl2ZTogJ3NlY3JldDEyMycsXG4gICAgICAgIHB1YmxpYzogJ3Zpc2libGUnLFxuICAgICAgICBuZXN0ZWQ6IHsgaW5uZXI6ICdkYXRhJyB9XG4gICAgICB9O1xuXG4gICAgICAvLyBUZXN0IHNlbGVjdGl2ZSBpbmNsdXNpb25cbiAgICAgIGNvbnN0IHNlbGVjdGVkID0gY29udHJvbGxlci50ZXN0U2VsZWN0aXZlbHlJbmNsdWRlRmllbGRzKHRlc3RPYmosIFsncHVibGljJywgJ25lc3RlZCddKTtcbiAgICAgIGV4cGVjdChzZWxlY3RlZCkudG9FcXVhbCh7IHB1YmxpYzogJ3Zpc2libGUnLCBuZXN0ZWQ6IHsgaW5uZXI6ICdkYXRhJyB9IH0pO1xuICAgICAgZXhwZWN0KHNlbGVjdGVkKS5ub3QudG9IYXZlUHJvcGVydHkoJ3NlbnNpdGl2ZScpO1xuXG4gICAgICAvLyBUZXN0IGVtcHR5IGFycmF5IGJlaGF2aW9yXG4gICAgICBjb25zdCBhbGwgPSBjb250cm9sbGVyLnRlc3RTZWxlY3RpdmVseUluY2x1ZGVGaWVsZHModGVzdE9iaiwgW10pO1xuICAgICAgZXhwZWN0KGFsbCkudG9FcXVhbCh0ZXN0T2JqKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmVyaWZ5IGJ1aWxkUmVxdWVzdENvbnRleHQgaGFuZGxlcyByZWFsLXdvcmxkIGF1ZGl0IGNvbmZpZ3MnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjdHggPSBjcmVhdGVNb2NrRXhlY3V0aW9uQ29udGV4dCgpO1xuICAgICAgXG4gICAgICAvLyBUZXN0IGEgcmVhbGlzdGljIGF1ZGl0IGNvbmZpZyBmb3IgYSBwYXltZW50IEFQSVxuICAgICAgY29uc3QgcGF5bWVudEF1ZGl0Q29uZmlnOiBBdWRpdENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZXM6IHtcbiAgICAgICAgICByZXF1ZXN0OiB7XG4gICAgICAgICAgICBoZWFkZXJzOiBbJ2NvbnRlbnQtdHlwZScsICd1c2VyLWFnZW50J10sICAvLyBFeGNsdWRlIGF1dGhvcml6YXRpb25cbiAgICAgICAgICAgIGJvZHk6IFsnYW1vdW50JywgJ2N1cnJlbmN5JywgJ29yZGVySWQnXSwgIC8vIEV4Y2x1ZGUgY2FyZCBkZXRhaWxzXG4gICAgICAgICAgICBxdWVyeTogWydtZXJjaGFudElkJ10gICAgICAgICAgICAgICAgICAgICAvLyBPbmx5IG1lcmNoYW50IHRyYWNraW5nXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBjb250cm9sbGVyLnRlc3RCdWlsZFJlcXVlc3RDb250ZXh0KGN0eCwgcGF5bWVudEF1ZGl0Q29uZmlnKTtcblxuICAgICAgLy8gU2hvdWxkIG9ubHkgaW5jbHVkZSBzYWZlIGZpZWxkc1xuICAgICAgZXhwZWN0KHJlc3VsdC5oZWFkZXJzKS50b0VxdWFsKHtcbiAgICAgICAgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgJ3VzZXItYWdlbnQnOiAnTW96aWxsYS81LjAnXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChyZXN1bHQuaGVhZGVycykubm90LnRvSGF2ZVByb3BlcnR5KCdhdXRob3JpemF0aW9uJyk7XG4gICAgICBcbiAgICAgIC8vIFNob3VsZCBleGNsdWRlIHNlbnNpdGl2ZSBib2R5IGZpZWxkcyBsaWtlIHBhc3N3b3JkXG4gICAgICBleHBlY3QocmVzdWx0LmJvZHkpLm5vdC50b0hhdmVQcm9wZXJ0eSgncGFzc3dvcmQnKTtcbiAgICAgIGV4cGVjdChyZXN1bHQuYm9keSkubm90LnRvSGF2ZVByb3BlcnR5KCdlbWFpbCcpO1xuICAgICAgXG4gICAgICAvLyBTaG91bGQgYmUgZW1wdHkgc2luY2UgbWVyY2hhbnRJZCBpcyBub3QgaW4gb3VyIG1vY2sgcXVlcnlcbiAgICAgIGV4cGVjdChyZXN1bHQucXVlcnkpLnRvRXF1YWwoe30pO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19