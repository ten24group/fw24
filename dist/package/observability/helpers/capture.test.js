"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const capture_1 = require("./capture");
const manager_1 = require("../manager");
// Mock ObservabilityManager
jest.mock('../manager', () => ({
    ObservabilityManager: {
        capture: jest.fn().mockReturnValue('test-log-id'),
    },
}));
describe('Capture Helpers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    describe('captureBusinessEvent', () => {
        it('should capture a basic event', () => {
            const result = (0, capture_1.captureBusinessEvent)({
                operation: 'payment.processed',
                entityName: 'payment',
                entityId: 'pay_123',
                success: true,
            });
            expect(result).toBe('test-log-id');
            expect(manager_1.ObservabilityManager.capture).toHaveBeenCalledWith(expect.objectContaining({
                type: 'audit',
                level: 'info',
                operation: 'payment.processed',
                entityName: 'payment',
                entityId: 'pay_123',
                success: true,
                status: 'completed',
            }));
        });
        it('should extract actor and correlationId from ExecutionContext', () => {
            const actor = {
                actorId: 'user-123',
                actorType: 'user',
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                correlationId: 'corr-123',
            };
            const ctx = {
                actor,
                request: { requestId: 'req-123' },
            };
            (0, capture_1.captureBusinessEvent)({
                operation: 'user.login',
                ctx,
            });
            expect(manager_1.ObservabilityManager.capture).toHaveBeenCalledWith(expect.objectContaining({
                correlationId: 'corr-123',
                actor,
            }));
        });
        it('should include metrics with duration convenience', () => {
            (0, capture_1.captureBusinessEvent)({
                operation: 'api.call',
                duration: 150,
                metrics: { statusCode: 200 },
            });
            expect(manager_1.ObservabilityManager.capture).toHaveBeenCalledWith(expect.objectContaining({
                metrics: {
                    duration: 150,
                    statusCode: 200,
                },
            }));
        });
        it('should add service and externalSystem as tags', () => {
            (0, capture_1.captureBusinessEvent)({
                operation: 'stripe.charge',
                service: 'payment-service',
                externalSystem: 'stripe',
                externalId: 'ch_123',
            });
            expect(manager_1.ObservabilityManager.capture).toHaveBeenCalledWith(expect.objectContaining({
                tags: {
                    service: 'payment-service',
                    externalSystem: 'stripe',
                },
                data: expect.objectContaining({
                    externalId: 'ch_123',
                }),
            }));
        });
        it('should set status based on success flag', () => {
            (0, capture_1.captureBusinessEvent)({
                operation: 'test.failed',
                success: false,
            });
            expect(manager_1.ObservabilityManager.capture).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                status: 'failed',
            }));
        });
        it('should apply data protection by default', () => {
            (0, capture_1.captureBusinessEvent)({
                operation: 'user.create',
                data: {
                    username: 'john',
                    password: 'secret123',
                },
            });
            const captureCall = manager_1.ObservabilityManager.capture.mock.calls[0][0];
            expect(captureCall.data.password).toBe('[REDACTED]');
            expect(captureCall.data.username).toBe('john');
        });
        it('should skip data protection when disabled', () => {
            (0, capture_1.captureBusinessEvent)({
                operation: 'user.create',
                data: {
                    password: 'secret123',
                },
                dataProtection: { enabled: false },
            });
            const captureCall = manager_1.ObservabilityManager.capture.mock.calls[0][0];
            expect(captureCall.data.password).toBe('secret123');
        });
        it('should handle null/undefined data gracefully', () => {
            expect(() => {
                (0, capture_1.captureBusinessEvent)({
                    operation: 'test',
                    data: undefined,
                });
            }).not.toThrow();
        });
    });
    describe('captureBusinessError', () => {
        it('should capture an Error object', () => {
            const error = new Error('Payment failed');
            error.name = 'PaymentError';
            (0, capture_1.captureBusinessError)(error, {
                operation: 'payment.process',
                entityName: 'payment',
                entityId: 'pay_123',
            });
            expect(manager_1.ObservabilityManager.capture).toHaveBeenCalledWith(expect.objectContaining({
                level: 'error',
                success: false,
                status: 'failed',
                data: expect.objectContaining({
                    errorType: 'PaymentError',
                    errorMessage: 'Payment failed',
                }),
            }));
        });
        it('should capture a non-Error value', () => {
            (0, capture_1.captureBusinessError)('Something went wrong', {
                operation: 'test.error',
            });
            expect(manager_1.ObservabilityManager.capture).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    error: 'Something went wrong',
                }),
            }));
        });
        it('should merge additional data with error data', () => {
            const error = new Error('Test error');
            (0, capture_1.captureBusinessError)(error, {
                operation: 'test.error',
                data: { additionalInfo: 'context' },
            });
            const captureCall = manager_1.ObservabilityManager.capture.mock.calls[0][0];
            expect(captureCall.data.additionalInfo).toBe('context');
            expect(captureCall.data.errorMessage).toBe('Test error');
        });
    });
    describe('captureMetric', () => {
        it('should capture a metric', () => {
            (0, capture_1.captureMetric)('api.latency', 150, {
                tags: { endpoint: '/users', method: 'GET' },
            });
            expect(manager_1.ObservabilityManager.capture).toHaveBeenCalledWith(expect.objectContaining({
                type: 'metric',
                level: 'info',
                operation: 'api.latency',
                metrics: { 'api.latency': 150 },
                tags: { endpoint: '/users', method: 'GET' },
            }));
        });
        it('should use correlationId from context', () => {
            const ctx = {
                actor: { correlationId: 'ctx-corr-id' },
            };
            (0, capture_1.captureMetric)('test.metric', 100, { ctx });
            expect(manager_1.ObservabilityManager.capture).toHaveBeenCalledWith(expect.objectContaining({
                correlationId: 'ctx-corr-id',
            }));
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FwdHVyZS50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvaGVscGVycy9jYXB0dXJlLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSx1Q0FBc0Y7QUFDdEYsd0NBQWtEO0FBR2xELDRCQUE0QjtBQUM1QixJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQzdCLG9CQUFvQixFQUFFO1FBQ3BCLE9BQU8sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsZUFBZSxDQUFDLGFBQWEsQ0FBQztLQUNsRDtDQUNGLENBQUMsQ0FBQyxDQUFDO0FBRUosUUFBUSxDQUFDLGlCQUFpQixFQUFFLEdBQUcsRUFBRTtJQUMvQixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO0lBQ3ZCLENBQUMsQ0FBQyxDQUFDO0lBRUgsUUFBUSxDQUFDLHNCQUFzQixFQUFFLEdBQUcsRUFBRTtRQUNwQyxFQUFFLENBQUMsOEJBQThCLEVBQUUsR0FBRyxFQUFFO1lBQ3RDLE1BQU0sTUFBTSxHQUFHLElBQUEsOEJBQW9CLEVBQUM7Z0JBQ2xDLFNBQVMsRUFBRSxtQkFBbUI7Z0JBQzlCLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixRQUFRLEVBQUUsU0FBUztnQkFDbkIsT0FBTyxFQUFFLElBQUk7YUFDZCxDQUFDLENBQUM7WUFFSCxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1lBQ25DLE1BQU0sQ0FBQyw4QkFBb0IsQ0FBQyxPQUFPLENBQUMsQ0FBQyxvQkFBb0IsQ0FDdkQsTUFBTSxDQUFDLGdCQUFnQixDQUFDO2dCQUN0QixJQUFJLEVBQUUsT0FBTztnQkFDYixLQUFLLEVBQUUsTUFBTTtnQkFDYixTQUFTLEVBQUUsbUJBQW1CO2dCQUM5QixVQUFVLEVBQUUsU0FBUztn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QUM7UUFFSCxFQUFFLENBQUMsdUNBQXVDLEVBQUUsR0FBRyxFQUFFO1lBQy9DLE1BQU0sR0FBRyxHQUFHO2dCQUNWLEtBQUssRUFBRSxFQUFFLGFBQWEsRUFBRSxhQUFhLEVBQUU7YUFDVCxDQUFDO1lBRWpDLElBQUEsdUJBQWEsRUFBQyxhQUFhLEVBQUUsR0FBRyxFQUFFLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztZQUUzQyxNQUFNLENBQUMsOEJBQW9CLENBQUMsT0FBTyxDQUFDLENBQUMsb0JBQW9CLENBQ3ZELE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQztnQkFDdEIsYUFBYSxFQUFFLGFBQWE7YUFDN0IsQ0FBQyxDQUNILENBQUM7UUFDSixDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBjYXB0dXJlQnVzaW5lc3NFdmVudCwgY2FwdHVyZUJ1c2luZXNzRXJyb3IsIGNhcHR1cmVNZXRyaWMgfSBmcm9tICcuL2NhcHR1cmUnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgfSBmcm9tICcuLi9tYW5hZ2VyJztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQsIEFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5cbi8vIE1vY2sgT2JzZXJ2YWJpbGl0eU1hbmFnZXJcbmplc3QubW9jaygnLi4vbWFuYWdlcicsICgpID0+ICh7XG4gIE9ic2VydmFiaWxpdHlNYW5hZ2VyOiB7XG4gICAgY2FwdHVyZTogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSgndGVzdC1sb2ctaWQnKSxcbiAgfSxcbn0pKTtcblxuZGVzY3JpYmUoJ0NhcHR1cmUgSGVscGVycycsICgpID0+IHtcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdjYXB0dXJlQnVzaW5lc3NFdmVudCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNhcHR1cmUgYSBiYXNpYyBldmVudCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGNhcHR1cmVCdXNpbmVzc0V2ZW50KHtcbiAgICAgICAgb3BlcmF0aW9uOiAncGF5bWVudC5wcm9jZXNzZWQnLFxuICAgICAgICBlbnRpdHlOYW1lOiAncGF5bWVudCcsXG4gICAgICAgIGVudGl0eUlkOiAncGF5XzEyMycsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9CZSgndGVzdC1sb2ctaWQnKTtcbiAgICAgIGV4cGVjdChPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgIHR5cGU6ICdhdWRpdCcsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdwYXltZW50LnByb2Nlc3NlZCcsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ3BheW1lbnQnLFxuICAgICAgICAgIGVudGl0eUlkOiAncGF5XzEyMycsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBhY3RvciBhbmQgY29ycmVsYXRpb25JZCBmcm9tIEV4ZWN1dGlvbkNvbnRleHQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBhY3RvcjogQWN0b3IgPSB7XG4gICAgICAgIGFjdG9ySWQ6ICd1c2VyLTEyMycsXG4gICAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgICByZXF1ZXN0SWQ6ICdyZXEtMTIzJyxcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyNC0wMS0xNVQxMDozMDowMC4wMDBaJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ2NvcnItMTIzJyxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGN0eCA9IHtcbiAgICAgICAgYWN0b3IsXG4gICAgICAgIHJlcXVlc3Q6IHsgcmVxdWVzdElkOiAncmVxLTEyMycgfSxcbiAgICAgIH0gYXMgdW5rbm93biBhcyBFeGVjdXRpb25Db250ZXh0O1xuXG4gICAgICBjYXB0dXJlQnVzaW5lc3NFdmVudCh7XG4gICAgICAgIG9wZXJhdGlvbjogJ3VzZXIubG9naW4nLFxuICAgICAgICBjdHgsXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ2NvcnItMTIzJyxcbiAgICAgICAgICBhY3RvcixcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGluY2x1ZGUgbWV0cmljcyB3aXRoIGR1cmF0aW9uIGNvbnZlbmllbmNlJywgKCkgPT4ge1xuICAgICAgY2FwdHVyZUJ1c2luZXNzRXZlbnQoe1xuICAgICAgICBvcGVyYXRpb246ICdhcGkuY2FsbCcsXG4gICAgICAgIGR1cmF0aW9uOiAxNTAsXG4gICAgICAgIG1ldHJpY3M6IHsgc3RhdHVzQ29kZTogMjAwIH0sXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICAgZHVyYXRpb246IDE1MCxcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICB9LFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgYWRkIHNlcnZpY2UgYW5kIGV4dGVybmFsU3lzdGVtIGFzIHRhZ3MnLCAoKSA9PiB7XG4gICAgICBjYXB0dXJlQnVzaW5lc3NFdmVudCh7XG4gICAgICAgIG9wZXJhdGlvbjogJ3N0cmlwZS5jaGFyZ2UnLFxuICAgICAgICBzZXJ2aWNlOiAncGF5bWVudC1zZXJ2aWNlJyxcbiAgICAgICAgZXh0ZXJuYWxTeXN0ZW06ICdzdHJpcGUnLFxuICAgICAgICBleHRlcm5hbElkOiAnY2hfMTIzJyxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICBzZXJ2aWNlOiAncGF5bWVudC1zZXJ2aWNlJyxcbiAgICAgICAgICAgIGV4dGVybmFsU3lzdGVtOiAnc3RyaXBlJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGRhdGE6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgIGV4dGVybmFsSWQ6ICdjaF8xMjMnLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgc2V0IHN0YXR1cyBiYXNlZCBvbiBzdWNjZXNzIGZsYWcnLCAoKSA9PiB7XG4gICAgICBjYXB0dXJlQnVzaW5lc3NFdmVudCh7XG4gICAgICAgIG9wZXJhdGlvbjogJ3Rlc3QuZmFpbGVkJyxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJyxcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGFwcGx5IGRhdGEgcHJvdGVjdGlvbiBieSBkZWZhdWx0JywgKCkgPT4ge1xuICAgICAgY2FwdHVyZUJ1c2luZXNzRXZlbnQoe1xuICAgICAgICBvcGVyYXRpb246ICd1c2VyLmNyZWF0ZScsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICB1c2VybmFtZTogJ2pvaG4nLFxuICAgICAgICAgIHBhc3N3b3JkOiAnc2VjcmV0MTIzJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBjYXB0dXJlQ2FsbCA9IChPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlIGFzIGplc3QuTW9jaykubW9jay5jYWxsc1swXVswXTtcbiAgICAgIGV4cGVjdChjYXB0dXJlQ2FsbC5kYXRhLnBhc3N3b3JkKS50b0JlKCdbUkVEQUNURURdJyk7XG4gICAgICBleHBlY3QoY2FwdHVyZUNhbGwuZGF0YS51c2VybmFtZSkudG9CZSgnam9obicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBza2lwIGRhdGEgcHJvdGVjdGlvbiB3aGVuIGRpc2FibGVkJywgKCkgPT4ge1xuICAgICAgY2FwdHVyZUJ1c2luZXNzRXZlbnQoe1xuICAgICAgICBvcGVyYXRpb246ICd1c2VyLmNyZWF0ZScsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBwYXNzd29yZDogJ3NlY3JldDEyMycsXG4gICAgICAgIH0sXG4gICAgICAgIGRhdGFQcm90ZWN0aW9uOiB7IGVuYWJsZWQ6IGZhbHNlIH0sXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgY2FwdHVyZUNhbGwgPSAoT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSBhcyBqZXN0Lk1vY2spLm1vY2suY2FsbHNbMF1bMF07XG4gICAgICBleHBlY3QoY2FwdHVyZUNhbGwuZGF0YS5wYXNzd29yZCkudG9CZSgnc2VjcmV0MTIzJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBudWxsL3VuZGVmaW5lZCBkYXRhIGdyYWNlZnVsbHknLCAoKSA9PiB7XG4gICAgICBleHBlY3QoKCkgPT4ge1xuICAgICAgICBjYXB0dXJlQnVzaW5lc3NFdmVudCh7XG4gICAgICAgICAgb3BlcmF0aW9uOiAndGVzdCcsXG4gICAgICAgICAgZGF0YTogdW5kZWZpbmVkLFxuICAgICAgICB9KTtcbiAgICAgIH0pLm5vdC50b1Rocm93KCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdjYXB0dXJlQnVzaW5lc3NFcnJvcicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNhcHR1cmUgYW4gRXJyb3Igb2JqZWN0JywgKCkgPT4ge1xuICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ1BheW1lbnQgZmFpbGVkJyk7XG4gICAgICBlcnJvci5uYW1lID0gJ1BheW1lbnRFcnJvcic7XG5cbiAgICAgIGNhcHR1cmVCdXNpbmVzc0Vycm9yKGVycm9yLCB7XG4gICAgICAgIG9wZXJhdGlvbjogJ3BheW1lbnQucHJvY2VzcycsXG4gICAgICAgIGVudGl0eU5hbWU6ICdwYXltZW50JyxcbiAgICAgICAgZW50aXR5SWQ6ICdwYXlfMTIzJyxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBzdGF0dXM6ICdmYWlsZWQnLFxuICAgICAgICAgIGRhdGE6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgIGVycm9yVHlwZTogJ1BheW1lbnRFcnJvcicsXG4gICAgICAgICAgICBlcnJvck1lc3NhZ2U6ICdQYXltZW50IGZhaWxlZCcsXG4gICAgICAgICAgfSksXG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjYXB0dXJlIGEgbm9uLUVycm9yIHZhbHVlJywgKCkgPT4ge1xuICAgICAgY2FwdHVyZUJ1c2luZXNzRXJyb3IoJ1NvbWV0aGluZyB3ZW50IHdyb25nJywge1xuICAgICAgICBvcGVyYXRpb246ICd0ZXN0LmVycm9yJyxcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBkYXRhOiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICBlcnJvcjogJ1NvbWV0aGluZyB3ZW50IHdyb25nJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG1lcmdlIGFkZGl0aW9uYWwgZGF0YSB3aXRoIGVycm9yIGRhdGEnLCAoKSA9PiB7XG4gICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignVGVzdCBlcnJvcicpO1xuXG4gICAgICBjYXB0dXJlQnVzaW5lc3NFcnJvcihlcnJvciwge1xuICAgICAgICBvcGVyYXRpb246ICd0ZXN0LmVycm9yJyxcbiAgICAgICAgZGF0YTogeyBhZGRpdGlvbmFsSW5mbzogJ2NvbnRleHQnIH0sXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgY2FwdHVyZUNhbGwgPSAoT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSBhcyBqZXN0Lk1vY2spLm1vY2suY2FsbHNbMF1bMF07XG4gICAgICBleHBlY3QoY2FwdHVyZUNhbGwuZGF0YS5hZGRpdGlvbmFsSW5mbykudG9CZSgnY29udGV4dCcpO1xuICAgICAgZXhwZWN0KGNhcHR1cmVDYWxsLmRhdGEuZXJyb3JNZXNzYWdlKS50b0JlKCdUZXN0IGVycm9yJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdjYXB0dXJlTWV0cmljJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY2FwdHVyZSBhIG1ldHJpYycsICgpID0+IHtcbiAgICAgIGNhcHR1cmVNZXRyaWMoJ2FwaS5sYXRlbmN5JywgMTUwLCB7XG4gICAgICAgIHRhZ3M6IHsgZW5kcG9pbnQ6ICcvdXNlcnMnLCBtZXRob2Q6ICdHRVQnIH0sXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdhcGkubGF0ZW5jeScsXG4gICAgICAgICAgbWV0cmljczogeyAnYXBpLmxhdGVuY3knOiAxNTAgfSxcbiAgICAgICAgICB0YWdzOiB7IGVuZHBvaW50OiAnL3VzZXJzJywgbWV0aG9kOiAnR0VUJyB9LFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdXNlIGNvcnJlbGF0aW9uSWQgZnJvbSBjb250ZXh0JywgKCkgPT4ge1xuICAgICAgY29uc3QgY3R4ID0ge1xuICAgICAgICBhY3RvcjogeyBjb3JyZWxhdGlvbklkOiAnY3R4LWNvcnItaWQnIH0sXG4gICAgICB9IGFzIHVua25vd24gYXMgRXhlY3V0aW9uQ29udGV4dDtcblxuICAgICAgY2FwdHVyZU1ldHJpYygndGVzdC5tZXRyaWMnLCAxMDAsIHsgY3R4IH0pO1xuXG4gICAgICBleHBlY3QoT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAnY3R4LWNvcnItaWQnLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuIl19