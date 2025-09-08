"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const audit_helpers_1 = require("./audit-helpers");
const factory_1 = require("../loggers/factory");
// Mock the audit logger
jest.mock('../loggers/factory');
describe('Audit Strategies', () => {
    const mockCaptureLog = jest.fn();
    beforeEach(() => {
        jest.clearAllMocks();
        // Mock the factory instance and create method
        const mockFactory = {
            create: jest.fn().mockReturnValue({
                audit: mockCaptureLog
            })
        };
        factory_1.AuditLoggerFactory.getInstance.mockReturnValue(mockFactory);
    });
    const createMockAuditContext = (strategy = 'separate') => ({
        enabled: true,
        logType: 'log',
        subType: 'api_request',
        entityName: 'user',
        operation: 'create',
        category: 'user-management',
        actor: {
            actorType: 'user',
            actorId: 'user123',
            authMethod: 'cognito',
            requestId: 'req-123',
            timestamp: '2024-01-01T00:00:00.000Z'
        },
        correlation: {
            correlationId: 'corr-123',
            operationId: 'op-123',
            operationType: 'api',
            operationName: 'create_user',
            startTimestamp: '2024-01-01T00:00:00.000Z'
        },
        auditConfig: {
            enabled: true,
            strategy,
            category: 'user-management'
        }
    });
    const createMockOperationContext = () => ({
        method: 'POST',
        path: '/api/users',
        headers: { 'content-type': 'application/json' },
        body: { name: 'John Doe', email: 'john@example.com' },
        query: { format: 'json' }
    });
    const createMockResponseContext = () => ({
        headers: { 'content-type': 'application/json' },
        body: { id: '123', name: 'John Doe' },
        statusCode: 201,
        responseSize: 56
    });
    describe('Separate Strategy (Default)', () => {
        it('should create separate start and end audit entries', async () => {
            const auditContext = createMockAuditContext('separate');
            const operationContext = createMockOperationContext();
            const responseContext = createMockResponseContext();
            // Capture start
            await audit_helpers_1.AuditCaptureService.captureStart(auditContext, operationContext);
            // Capture end
            await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, null, null, responseContext);
            // Should have called captureLog twice (start + end)
            expect(mockCaptureLog).toHaveBeenCalledTimes(2);
            // First call should be start
            expect(mockCaptureLog).toHaveBeenNthCalledWith(1, expect.objectContaining({
                auditEntry: expect.objectContaining({
                    subType: 'api_request_start',
                    eventType: 'start'
                })
            }));
            // Second call should be end
            expect(mockCaptureLog).toHaveBeenNthCalledWith(2, expect.objectContaining({
                auditEntry: expect.objectContaining({
                    subType: 'api_request_complete',
                    eventType: 'complete',
                    success: true
                })
            }));
        });
    });
    describe('Single Strategy', () => {
        it('should create only one comprehensive audit entry at the end', async () => {
            const auditContext = createMockAuditContext('single');
            const operationContext = createMockOperationContext();
            const responseContext = createMockResponseContext();
            // Capture start - should not log but store context
            await audit_helpers_1.AuditCaptureService.captureStart(auditContext, operationContext);
            // Should not have logged anything yet
            expect(mockCaptureLog).not.toHaveBeenCalled();
            // Capture end - should create comprehensive entry
            await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, null, null, responseContext);
            // Should have called captureLog only once
            expect(mockCaptureLog).toHaveBeenCalledTimes(1);
            // Should contain comprehensive data in existing fields
            expect(mockCaptureLog).toHaveBeenCalledWith(expect.objectContaining({
                auditEntry: expect.objectContaining({
                    subType: 'api_request',
                    eventType: 'completed',
                    success: true,
                    // All comprehensive data stored in existing 'data' field
                    data: expect.objectContaining({
                        request: expect.objectContaining({
                            headers: { 'content-type': 'application/json' },
                            body: expect.objectContaining({
                                name: 'John Doe',
                                email: '[REDACTED]' // Data protection is working
                            }),
                            method: 'POST',
                            path: '/api/users'
                        }),
                        response: expect.objectContaining({
                            statusCode: 201,
                            responseSize: 56
                        }),
                        timing: expect.objectContaining({
                            startTime: '2024-01-01T00:00:00.000Z',
                            endTime: expect.any(String),
                            duration: expect.any(Number)
                        })
                    })
                })
            }));
        });
        it('should handle errors in single strategy', async () => {
            const auditContext = createMockAuditContext('single');
            const operationContext = createMockOperationContext();
            const error = new Error('Something went wrong');
            // Capture start
            await audit_helpers_1.AuditCaptureService.captureStart(auditContext, operationContext);
            // Capture error
            await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, null, error);
            // Should have called captureLog only once
            expect(mockCaptureLog).toHaveBeenCalledTimes(1);
            // Should contain error data in existing fields
            expect(mockCaptureLog).toHaveBeenCalledWith(expect.objectContaining({
                auditEntry: expect.objectContaining({
                    eventType: 'failed',
                    success: false,
                    status: 'failed',
                    data: expect.objectContaining({
                        error: expect.objectContaining({
                            name: 'Error',
                            message: 'Something went wrong',
                            stack: expect.any(String)
                        })
                    })
                })
            }));
        });
    });
    describe('Strategy Comparison', () => {
        it('should demonstrate efficiency difference between strategies', async () => {
            const separateContext = createMockAuditContext('separate');
            const singleContext = createMockAuditContext('single');
            const operationContext = createMockOperationContext();
            const responseContext = createMockResponseContext();
            // Test separate strategy
            await audit_helpers_1.AuditCaptureService.captureStart(separateContext, operationContext);
            await audit_helpers_1.AuditCaptureService.captureEnd(separateContext, null, null, responseContext);
            const separateCallCount = mockCaptureLog.mock.calls.length;
            mockCaptureLog.mockClear();
            // Test single strategy  
            await audit_helpers_1.AuditCaptureService.captureStart(singleContext, operationContext);
            await audit_helpers_1.AuditCaptureService.captureEnd(singleContext, null, null, responseContext);
            const singleCallCount = mockCaptureLog.mock.calls.length;
            // Single strategy should be more efficient
            expect(separateCallCount).toBe(2); // start + end
            expect(singleCallCount).toBe(1); // only end with comprehensive data
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtc3RyYXRlZ2llcy50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2F1ZGl0L2hlbHBlcnMvYXVkaXQtc3RyYXRlZ2llcy50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbURBQXNEO0FBR3RELGdEQUF3RDtBQUV4RCx3QkFBd0I7QUFDeEIsSUFBSSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO0FBRWhDLFFBQVEsQ0FBQyxrQkFBa0IsRUFBRSxHQUFHLEVBQUU7SUFDaEMsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO0lBRWpDLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDckIsOENBQThDO1FBQzlDLE1BQU0sV0FBVyxHQUFHO1lBQ2xCLE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsZUFBZSxDQUFDO2dCQUNoQyxLQUFLLEVBQUUsY0FBYzthQUN0QixDQUFDO1NBQ0gsQ0FBQztRQUNELDRCQUFrQixDQUFDLFdBQXlCLENBQUMsZUFBZSxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQzdFLENBQUMsQ0FBQyxDQUFDO0lBRUgsTUFBTSxzQkFBc0IsR0FBRyxDQUFDLFdBQWtDLFVBQVUsRUFBZ0IsRUFBRSxDQUFDLENBQUM7UUFDOUYsT0FBTyxFQUFFLElBQUk7UUFDYixPQUFPLEVBQUUsS0FBSztRQUNkLE9BQU8sRUFBRSxhQUFhO1FBQ3RCLFVBQVUsRUFBRSxNQUFNO1FBQ2xCLFNBQVMsRUFBRSxRQUFRO1FBQ25CLFFBQVEsRUFBRSxpQkFBaUI7UUFDM0IsS0FBSyxFQUFFO1lBQ0wsU0FBUyxFQUFFLE1BQU07WUFDakIsT0FBTyxFQUFFLFNBQVM7WUFDbEIsVUFBVSxFQUFFLFNBQVM7WUFDckIsU0FBUyxFQUFFLFNBQVM7WUFDcEIsU0FBUyxFQUFFLDBCQUEwQjtTQUM3QjtRQUNWLFdB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LENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYztZQUNqRCxNQUFNLENBQUMsZUFBZSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUcsbUNBQW1DO1FBQ3hFLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEF1ZGl0Q2FwdHVyZVNlcnZpY2UgfSBmcm9tICcuL2F1ZGl0LWhlbHBlcnMnO1xuaW1wb3J0IHsgQXVkaXRDb250ZXh0LCBSZXF1ZXN0QXVkaXRDb250ZXh0IH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgQXVkaXRMb2dnZXJGYWN0b3J5IH0gZnJvbSAnLi4vbG9nZ2Vycy9mYWN0b3J5JztcblxuLy8gTW9jayB0aGUgYXVkaXQgbG9nZ2VyXG5qZXN0Lm1vY2soJy4uL2xvZ2dlcnMvZmFjdG9yeScpO1xuXG5kZXNjcmliZSgnQXVkaXQgU3RyYXRlZ2llcycsICgpID0+IHtcbiAgY29uc3QgbW9ja0NhcHR1cmVMb2cgPSBqZXN0LmZuKCk7XG4gIFxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBqZXN0LmNsZWFyQWxsTW9ja3MoKTtcbiAgICAvLyBNb2NrIHRoZSBmYWN0b3J5IGluc3RhbmNlIGFuZCBjcmVhdGUgbWV0aG9kXG4gICAgY29uc3QgbW9ja0ZhY3RvcnkgPSB7XG4gICAgICBjcmVhdGU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUoe1xuICAgICAgICBhdWRpdDogbW9ja0NhcHR1cmVMb2dcbiAgICAgIH0pXG4gICAgfTtcbiAgICAoQXVkaXRMb2dnZXJGYWN0b3J5LmdldEluc3RhbmNlIGFzIGplc3QuTW9jaykubW9ja1JldHVyblZhbHVlKG1vY2tGYWN0b3J5KTtcbiAgfSk7XG5cbiAgY29uc3QgY3JlYXRlTW9ja0F1ZGl0Q29udGV4dCA9IChzdHJhdGVneTogJ3NlcGFyYXRlJyB8ICdzaW5nbGUnID0gJ3NlcGFyYXRlJyk6IEF1ZGl0Q29udGV4dCA9PiAoe1xuICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgbG9nVHlwZTogJ2xvZycsXG4gICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0JyxcbiAgICBlbnRpdHlOYW1lOiAndXNlcicsXG4gICAgb3BlcmF0aW9uOiAnY3JlYXRlJyxcbiAgICBjYXRlZ29yeTogJ3VzZXItbWFuYWdlbWVudCcsXG4gICAgYWN0b3I6IHtcbiAgICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgICAgYWN0b3JJZDogJ3VzZXIxMjMnLFxuICAgICAgYXV0aE1ldGhvZDogJ2NvZ25pdG8nLFxuICAgICAgcmVxdWVzdElkOiAncmVxLTEyMycsXG4gICAgICB0aW1lc3RhbXA6ICcyMDI0LTAxLTAxVDAwOjAwOjAwLjAwMFonXG4gICAgfSBhcyBBY3RvcixcbiAgICBjb3JyZWxhdGlvbjoge1xuICAgICAgY29ycmVsYXRpb25JZDogJ2NvcnItMTIzJyxcbiAgICAgIG9wZXJhdGlvbklkOiAnb3AtMTIzJyxcbiAgICAgIG9wZXJhdGlvblR5cGU6ICdhcGknLFxuICAgICAgb3BlcmF0aW9uTmFtZTogJ2NyZWF0ZV91c2VyJyxcbiAgICAgIHN0YXJ0VGltZXN0YW1wOiAnMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaJ1xuICAgIH0sXG4gICAgYXVkaXRDb25maWc6IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBzdHJhdGVneSxcbiAgICAgIGNhdGVnb3J5OiAndXNlci1tYW5hZ2VtZW50J1xuICAgIH1cbiAgfSk7XG5cbiAgY29uc3QgY3JlYXRlTW9ja09wZXJhdGlvbkNvbnRleHQgPSAoKTogUmVxdWVzdEF1ZGl0Q29udGV4dCA9PiAoe1xuICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgIHBhdGg6ICcvYXBpL3VzZXJzJyxcbiAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcbiAgICBib2R5OiB7IG5hbWU6ICdKb2huIERvZScsIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbScgfSxcbiAgICBxdWVyeTogeyBmb3JtYXQ6ICdqc29uJyB9XG4gIH0pO1xuXG4gIGNvbnN0IGNyZWF0ZU1vY2tSZXNwb25zZUNvbnRleHQgPSAoKSA9PiAoe1xuICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgIGJvZHk6IHsgaWQ6ICcxMjMnLCBuYW1lOiAnSm9obiBEb2UnIH0sXG4gICAgc3RhdHVzQ29kZTogMjAxLFxuICAgIHJlc3BvbnNlU2l6ZTogNTZcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1NlcGFyYXRlIFN0cmF0ZWd5IChEZWZhdWx0KScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBzZXBhcmF0ZSBzdGFydCBhbmQgZW5kIGF1ZGl0IGVudHJpZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBhdWRpdENvbnRleHQgPSBjcmVhdGVNb2NrQXVkaXRDb250ZXh0KCdzZXBhcmF0ZScpO1xuICAgICAgY29uc3Qgb3BlcmF0aW9uQ29udGV4dCA9IGNyZWF0ZU1vY2tPcGVyYXRpb25Db250ZXh0KCk7XG4gICAgICBjb25zdCByZXNwb25zZUNvbnRleHQgPSBjcmVhdGVNb2NrUmVzcG9uc2VDb250ZXh0KCk7XG5cbiAgICAgIC8vIENhcHR1cmUgc3RhcnRcbiAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgb3BlcmF0aW9uQ29udGV4dCk7XG4gICAgICBcbiAgICAgIC8vIENhcHR1cmUgZW5kXG4gICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCBudWxsLCBudWxsLCByZXNwb25zZUNvbnRleHQpO1xuXG4gICAgICAvLyBTaG91bGQgaGF2ZSBjYWxsZWQgY2FwdHVyZUxvZyB0d2ljZSAoc3RhcnQgKyBlbmQpXG4gICAgICBleHBlY3QobW9ja0NhcHR1cmVMb2cpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygyKTtcbiAgICAgIFxuICAgICAgLy8gRmlyc3QgY2FsbCBzaG91bGQgYmUgc3RhcnRcbiAgICAgIGV4cGVjdChtb2NrQ2FwdHVyZUxvZykudG9IYXZlQmVlbk50aENhbGxlZFdpdGgoMSwgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICBhdWRpdEVudHJ5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgc3ViVHlwZTogJ2FwaV9yZXF1ZXN0X3N0YXJ0JyxcbiAgICAgICAgICBldmVudFR5cGU6ICdzdGFydCdcbiAgICAgICAgfSlcbiAgICAgIH0pKTtcbiAgICAgIFxuICAgICAgLy8gU2Vjb25kIGNhbGwgc2hvdWxkIGJlIGVuZFxuICAgICAgZXhwZWN0KG1vY2tDYXB0dXJlTG9nKS50b0hhdmVCZWVuTnRoQ2FsbGVkV2l0aCgyLCBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3RfY29tcGxldGUnLFxuICAgICAgICAgIGV2ZW50VHlwZTogJ2NvbXBsZXRlJyxcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlXG4gICAgICAgIH0pXG4gICAgICB9KSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdTaW5nbGUgU3RyYXRlZ3knLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgb25seSBvbmUgY29tcHJlaGVuc2l2ZSBhdWRpdCBlbnRyeSBhdCB0aGUgZW5kJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgYXVkaXRDb250ZXh0ID0gY3JlYXRlTW9ja0F1ZGl0Q29udGV4dCgnc2luZ2xlJyk7XG4gICAgICBjb25zdCBvcGVyYXRpb25Db250ZXh0ID0gY3JlYXRlTW9ja09wZXJhdGlvbkNvbnRleHQoKTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlQ29udGV4dCA9IGNyZWF0ZU1vY2tSZXNwb25zZUNvbnRleHQoKTtcblxuICAgICAgLy8gQ2FwdHVyZSBzdGFydCAtIHNob3VsZCBub3QgbG9nIGJ1dCBzdG9yZSBjb250ZXh0XG4gICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIG9wZXJhdGlvbkNvbnRleHQpO1xuICAgICAgXG4gICAgICAvLyBTaG91bGQgbm90IGhhdmUgbG9nZ2VkIGFueXRoaW5nIHlldFxuICAgICAgZXhwZWN0KG1vY2tDYXB0dXJlTG9nKS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgXG4gICAgICAvLyBDYXB0dXJlIGVuZCAtIHNob3VsZCBjcmVhdGUgY29tcHJlaGVuc2l2ZSBlbnRyeVxuICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgbnVsbCwgbnVsbCwgcmVzcG9uc2VDb250ZXh0KTtcblxuICAgICAgLy8gU2hvdWxkIGhhdmUgY2FsbGVkIGNhcHR1cmVMb2cgb25seSBvbmNlXG4gICAgICBleHBlY3QobW9ja0NhcHR1cmVMb2cpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygxKTtcbiAgICAgIFxuICAgICAgLy8gU2hvdWxkIGNvbnRhaW4gY29tcHJlaGVuc2l2ZSBkYXRhIGluIGV4aXN0aW5nIGZpZWxkc1xuICAgICAgZXhwZWN0KG1vY2tDYXB0dXJlTG9nKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBzdWJUeXBlOiAnYXBpX3JlcXVlc3QnLFxuICAgICAgICAgIGV2ZW50VHlwZTogJ2NvbXBsZXRlZCcsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBBbGwgY29tcHJlaGVuc2l2ZSBkYXRhIHN0b3JlZCBpbiBleGlzdGluZyAnZGF0YScgZmllbGRcbiAgICAgICAgICBkYXRhOiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICByZXF1ZXN0OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgICAgICAgICBib2R5OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7IFxuICAgICAgICAgICAgICAgIG5hbWU6ICdKb2huIERvZScsXG4gICAgICAgICAgICAgICAgZW1haWw6ICdbUkVEQUNURURdJyAvLyBEYXRhIHByb3RlY3Rpb24gaXMgd29ya2luZ1xuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICAgIHBhdGg6ICcvYXBpL3VzZXJzJ1xuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICByZXNwb25zZTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgICAgICBzdGF0dXNDb2RlOiAyMDEsXG4gICAgICAgICAgICAgIHJlc3BvbnNlU2l6ZTogNTZcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgdGltaW5nOiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgICAgICAgIHN0YXJ0VGltZTogJzIwMjQtMDEtMDFUMDA6MDA6MDAuMDAwWicsXG4gICAgICAgICAgICAgIGVuZFRpbWU6IGV4cGVjdC5hbnkoU3RyaW5nKSxcbiAgICAgICAgICAgICAgZHVyYXRpb246IGV4cGVjdC5hbnkoTnVtYmVyKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgfSkpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZXJyb3JzIGluIHNpbmdsZSBzdHJhdGVneScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGF1ZGl0Q29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoJ3NpbmdsZScpO1xuICAgICAgY29uc3Qgb3BlcmF0aW9uQ29udGV4dCA9IGNyZWF0ZU1vY2tPcGVyYXRpb25Db250ZXh0KCk7XG4gICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignU29tZXRoaW5nIHdlbnQgd3JvbmcnKTtcblxuICAgICAgLy8gQ2FwdHVyZSBzdGFydFxuICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCBvcGVyYXRpb25Db250ZXh0KTtcbiAgICAgIFxuICAgICAgLy8gQ2FwdHVyZSBlcnJvclxuICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgbnVsbCwgZXJyb3IpO1xuXG4gICAgICAvLyBTaG91bGQgaGF2ZSBjYWxsZWQgY2FwdHVyZUxvZyBvbmx5IG9uY2VcbiAgICAgIGV4cGVjdChtb2NrQ2FwdHVyZUxvZykudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xuICAgICAgXG4gICAgICAvLyBTaG91bGQgY29udGFpbiBlcnJvciBkYXRhIGluIGV4aXN0aW5nIGZpZWxkc1xuICAgICAgZXhwZWN0KG1vY2tDYXB0dXJlTG9nKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIGF1ZGl0RW50cnk6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICBldmVudFR5cGU6ICdmYWlsZWQnLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIHN0YXR1czogJ2ZhaWxlZCcsXG4gICAgICAgICAgZGF0YTogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICAgICAgZXJyb3I6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgICAgICAgbmFtZTogJ0Vycm9yJyxcbiAgICAgICAgICAgICAgbWVzc2FnZTogJ1NvbWV0aGluZyB3ZW50IHdyb25nJyxcbiAgICAgICAgICAgICAgc3RhY2s6IGV4cGVjdC5hbnkoU3RyaW5nKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgfSkpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnU3RyYXRlZ3kgQ29tcGFyaXNvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGRlbW9uc3RyYXRlIGVmZmljaWVuY3kgZGlmZmVyZW5jZSBiZXR3ZWVuIHN0cmF0ZWdpZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzZXBhcmF0ZUNvbnRleHQgPSBjcmVhdGVNb2NrQXVkaXRDb250ZXh0KCdzZXBhcmF0ZScpO1xuICAgICAgY29uc3Qgc2luZ2xlQ29udGV4dCA9IGNyZWF0ZU1vY2tBdWRpdENvbnRleHQoJ3NpbmdsZScpO1xuICAgICAgY29uc3Qgb3BlcmF0aW9uQ29udGV4dCA9IGNyZWF0ZU1vY2tPcGVyYXRpb25Db250ZXh0KCk7XG4gICAgICBjb25zdCByZXNwb25zZUNvbnRleHQgPSBjcmVhdGVNb2NrUmVzcG9uc2VDb250ZXh0KCk7XG5cbiAgICAgIC8vIFRlc3Qgc2VwYXJhdGUgc3RyYXRlZ3lcbiAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KHNlcGFyYXRlQ29udGV4dCwgb3BlcmF0aW9uQ29udGV4dCk7XG4gICAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVFbmQoc2VwYXJhdGVDb250ZXh0LCBudWxsLCBudWxsLCByZXNwb25zZUNvbnRleHQpO1xuICAgICAgXG4gICAgICBjb25zdCBzZXBhcmF0ZUNhbGxDb3VudCA9IG1vY2tDYXB0dXJlTG9nLm1vY2suY2FsbHMubGVuZ3RoO1xuICAgICAgbW9ja0NhcHR1cmVMb2cubW9ja0NsZWFyKCk7XG5cbiAgICAgIC8vIFRlc3Qgc2luZ2xlIHN0cmF0ZWd5ICBcbiAgICAgIGF3YWl0IEF1ZGl0Q2FwdHVyZVNlcnZpY2UuY2FwdHVyZVN0YXJ0KHNpbmdsZUNvbnRleHQsIG9wZXJhdGlvbkNvbnRleHQpO1xuICAgICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKHNpbmdsZUNvbnRleHQsIG51bGwsIG51bGwsIHJlc3BvbnNlQ29udGV4dCk7XG4gICAgICBcbiAgICAgIGNvbnN0IHNpbmdsZUNhbGxDb3VudCA9IG1vY2tDYXB0dXJlTG9nLm1vY2suY2FsbHMubGVuZ3RoO1xuXG4gICAgICAvLyBTaW5nbGUgc3RyYXRlZ3kgc2hvdWxkIGJlIG1vcmUgZWZmaWNpZW50XG4gICAgICBleHBlY3Qoc2VwYXJhdGVDYWxsQ291bnQpLnRvQmUoMik7IC8vIHN0YXJ0ICsgZW5kXG4gICAgICBleHBlY3Qoc2luZ2xlQ2FsbENvdW50KS50b0JlKDEpOyAgIC8vIG9ubHkgZW5kIHdpdGggY29tcHJlaGVuc2l2ZSBkYXRhXG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=