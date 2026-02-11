"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hybrid_search_event_extractor_1 = require("./hybrid-search-event-extractor");
const globals_1 = require("@jest/globals");
// Mock the DynamoDBEventDataExtractor
globals_1.jest.mock('../../core/runtime/event-processor/dynamodb-event-data-extractor', () => ({
    DynamoDBEventDataExtractor: globals_1.jest.fn().mockImplementation(() => ({
        extractData: globals_1.jest.fn()
    }))
}));
const createSQSRecord = (body, messageId = 'test-msg-id') => ({
    messageId,
    receiptHandle: 'test-receipt',
    body: JSON.stringify(body),
    attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1234567890',
        SenderId: 'test-sender',
        ApproximateFirstReceiveTimestamp: '1234567890'
    },
    messageAttributes: {},
    md5OfBody: 'test-md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
    awsRegion: 'us-east-1'
});
(0, globals_1.describe)('HybridSearchEventExtractor', () => {
    let extractor;
    let mockDynamoExtractor;
    (0, globals_1.beforeEach)(() => {
        extractor = new hybrid_search_event_extractor_1.HybridSearchEventExtractor();
        // Get the mocked DynamoDB extractor instance
        mockDynamoExtractor = extractor.dynamoExtractor;
    });
    (0, globals_1.describe)('Resync Event Processing', () => {
        (0, globals_1.it)('should extract resync events with eventName format', () => {
            const resyncBody = {
                eventName: 'RESYNC',
                data: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
                entityName: 'user'
            };
            const sqsEvent = {
                Records: [createSQSRecord(resyncBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toHaveLength(1);
            (0, globals_1.expect)(records[0]).toEqual({
                eventId: 'test-msg-id',
                eventType: 'update',
                timestamp: globals_1.expect.any(Number),
                eventSource: 'aws:sqs',
                payload: resyncBody.data,
                entityId: 'user-123',
                entityName: 'user',
                metadata: {
                    source: 'resync'
                }
            });
        });
        (0, globals_1.it)('should extract resync events with simple format (no eventName)', () => {
            const resyncBody = {
                data: { id: 'user-456', name: 'Jane Doe', email: 'jane@example.com' },
                entityName: 'user'
            };
            const sqsEvent = {
                Records: [createSQSRecord(resyncBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toHaveLength(1);
            (0, globals_1.expect)(records[0]).toEqual({
                eventId: 'test-msg-id',
                eventType: 'update',
                timestamp: globals_1.expect.any(Number),
                eventSource: 'aws:sqs',
                payload: resyncBody.data,
                entityId: 'user-456',
                entityName: 'user',
                metadata: {
                    source: 'resync'
                }
            });
        });
        (0, globals_1.it)('should extract resync events with array data (batch processing)', () => {
            const resyncBody = {
                eventName: 'RESYNC',
                data: [
                    { id: 'user-1', name: 'User 1' },
                    { id: 'user-2', name: 'User 2' }
                ],
                entityName: 'user'
            };
            const sqsEvent = {
                Records: [createSQSRecord(resyncBody)]
            };
            const records = extractor.extractData(sqsEvent);
            // Array data should create multiple individual records
            (0, globals_1.expect)(records).toHaveLength(2);
            // First record
            (0, globals_1.expect)(records[0]).toEqual({
                eventId: 'test-msg-id-0',
                eventType: 'update',
                timestamp: globals_1.expect.any(Number),
                eventSource: 'aws:sqs',
                payload: { id: 'user-1', name: 'User 1' },
                entityId: 'user-1',
                entityName: 'user',
                metadata: {
                    source: 'resync'
                }
            });
            // Second record
            (0, globals_1.expect)(records[1]).toEqual({
                eventId: 'test-msg-id-1',
                eventType: 'update',
                timestamp: globals_1.expect.any(Number),
                eventSource: 'aws:sqs',
                payload: { id: 'user-2', name: 'User 2' },
                entityId: 'user-2',
                entityName: 'user',
                metadata: {
                    source: 'resync'
                }
            });
        });
        (0, globals_1.it)('should handle resync events with entityName-based ID', () => {
            const resyncBody = {
                eventName: 'RESYNC',
                data: { userId: 'user-456', name: 'Jane Doe' },
                entityName: 'user'
            };
            const sqsEvent = {
                Records: [createSQSRecord(resyncBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toHaveLength(1);
            (0, globals_1.expect)(records[0].entityId).toBe('user-456');
            (0, globals_1.expect)(records[0].payload).toEqual(resyncBody.data);
        });
        (0, globals_1.it)('should handle multiple resync records', () => {
            const sqsEvent = {
                Records: [
                    createSQSRecord({
                        eventName: 'RESYNC',
                        data: { id: 'user-1', name: 'User 1' },
                        entityName: 'user'
                    }, 'msg-1'),
                    createSQSRecord({
                        eventName: 'RESYNC',
                        data: { id: 'post-1', title: 'Post 1' },
                        entityName: 'post'
                    }, 'msg-2')
                ]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toHaveLength(2);
            (0, globals_1.expect)(records[0].entityName).toBe('user');
            (0, globals_1.expect)(records[0].payload.name).toBe('User 1');
            (0, globals_1.expect)(records[1].entityName).toBe('post');
            (0, globals_1.expect)(records[1].payload.title).toBe('Post 1');
        });
    });
    (0, globals_1.describe)('DynamoDB Stream Event Processing', () => {
        (0, globals_1.it)('should delegate to DynamoDBEventDataExtractor for non-resync events', () => {
            const snsBody = {
                Message: JSON.stringify({
                    Records: [{
                            eventName: 'INSERT',
                            dynamodb: {
                                NewImage: { id: { S: 'user-123' }, name: { S: 'John' } }
                            }
                        }]
                })
            };
            const sqsEvent = {
                Records: [createSQSRecord(snsBody)]
            };
            const mockDynamoRecords = [{
                    eventId: 'dynamo-event-1',
                    eventType: 'create',
                    entityName: 'user',
                    entityId: 'user-123',
                    payload: {
                        newImage: { id: 'user-123', name: 'John' },
                        oldImage: undefined,
                        keys: { id: 'user-123' }
                    },
                    timestamp: Date.now(),
                    eventSource: 'aws:dynamodb',
                    metadata: {}
                }];
            mockDynamoExtractor.extractData.mockReturnValue(mockDynamoRecords);
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(mockDynamoExtractor.extractData).toHaveBeenCalledWith(sqsEvent);
            (0, globals_1.expect)(records).toHaveLength(1);
            (0, globals_1.expect)(records[0]).toEqual({
                ...mockDynamoRecords[0],
                metadata: {
                    source: 'stream'
                }
            });
        });
        (0, globals_1.it)('should preserve DynamoDB stream record structure', () => {
            const sqsEvent = {
                Records: [createSQSRecord({ someOtherFormat: 'data' })]
            };
            const mockDynamoRecords = [{
                    eventId: 'dynamo-event-1',
                    eventType: 'update',
                    entityName: 'post',
                    entityId: 'post-456',
                    payload: {
                        newImage: { id: 'post-456', title: 'Updated Post' },
                        oldImage: { id: 'post-456', title: 'Old Post' },
                        keys: { id: 'post-456' }
                    },
                    timestamp: Date.now(),
                    eventSource: 'aws:dynamodb'
                }];
            mockDynamoExtractor.extractData.mockReturnValue(mockDynamoRecords);
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toHaveLength(1);
            (0, globals_1.expect)(records[0].metadata?.source).toBe('stream');
            (0, globals_1.expect)(records[0].payload).toEqual(mockDynamoRecords[0].payload);
        });
    });
    (0, globals_1.describe)('Mixed Event Processing', () => {
        (0, globals_1.it)('should handle mixed resync and stream events in the same SQS batch', () => {
            const sqsEvent = {
                Records: [
                    createSQSRecord({
                        eventName: 'RESYNC',
                        data: { id: 'user-resync', name: 'Resync User' },
                        entityName: 'user'
                    }, 'resync-msg'),
                    createSQSRecord({
                        Message: 'DynamoDB stream event'
                    }, 'stream-msg')
                ]
            };
            const mockDynamoRecords = [{
                    eventId: 'stream-event',
                    eventType: 'delete',
                    entityName: 'post',
                    entityId: 'post-stream',
                    payload: { oldImage: { id: 'post-stream' } },
                    timestamp: Date.now(),
                    eventSource: 'aws:dynamodb'
                }];
            // Mock to return records only for the second (stream) record
            mockDynamoExtractor.extractData.mockImplementation((event) => {
                if (event.Records[0].messageId === 'stream-msg') {
                    return mockDynamoRecords;
                }
                return [];
            });
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toHaveLength(2);
            // First record should be resync
            (0, globals_1.expect)(records[0].metadata?.source).toBe('resync');
            (0, globals_1.expect)(records[0].entityName).toBe('user');
            (0, globals_1.expect)(records[0].payload.name).toBe('Resync User');
            // Second record should be stream
            (0, globals_1.expect)(records[1].metadata?.source).toBe('stream');
            (0, globals_1.expect)(records[1].entityName).toBe('post');
            (0, globals_1.expect)(records[1].eventType).toBe('delete');
        });
    });
    (0, globals_1.describe)('Error Handling', () => {
        (0, globals_1.it)('should handle invalid JSON in SQS record body gracefully', () => {
            const invalidRecord = {
                ...createSQSRecord({}),
                body: 'invalid-json{'
            };
            const sqsEvent = {
                Records: [invalidRecord]
            };
            // Mock DynamoDB extractor to return empty array for invalid data
            mockDynamoExtractor.extractData.mockReturnValue([]);
            // Should not throw, but delegate to DynamoDB extractor
            (0, globals_1.expect)(() => extractor.extractData(sqsEvent)).not.toThrow();
            (0, globals_1.expect)(mockDynamoExtractor.extractData).toHaveBeenCalled();
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toEqual([]);
        });
        (0, globals_1.it)('should handle missing required fields in resync events', () => {
            const incompleteResyncBody = {
                eventName: 'RESYNC',
                data: { id: 'user-123' }
                // Missing entityName
            };
            const sqsEvent = {
                Records: [createSQSRecord(incompleteResyncBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toHaveLength(1);
            (0, globals_1.expect)(records[0].entityName).toBeUndefined();
            (0, globals_1.expect)(records[0].metadata?.source).toBe('resync');
        });
        (0, globals_1.it)('should handle empty or null data in resync events', () => {
            const emptyResyncBody = {
                eventName: 'RESYNC',
                data: null,
                entityName: 'user'
            };
            const sqsEvent = {
                Records: [createSQSRecord(emptyResyncBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toHaveLength(1);
            (0, globals_1.expect)(records[0].payload).toBeNull();
            (0, globals_1.expect)(records[0].entityId).toBeUndefined();
        });
    });
    (0, globals_1.describe)('Entity ID Extraction', () => {
        (0, globals_1.it)('should prefer "id" field over entityName-based field', () => {
            const resyncBody = {
                eventName: 'RESYNC',
                data: {
                    id: 'primary-id',
                    userId: 'secondary-id',
                    name: 'Test User'
                },
                entityName: 'user'
            };
            const sqsEvent = {
                Records: [createSQSRecord(resyncBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records[0].entityId).toBe('primary-id');
        });
        (0, globals_1.it)('should fallback to entityName-based ID when "id" is missing', () => {
            const resyncBody = {
                eventName: 'RESYNC',
                data: {
                    postId: 'fallback-id',
                    title: 'Test Post'
                },
                entityName: 'post'
            };
            const sqsEvent = {
                Records: [createSQSRecord(resyncBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records[0].entityId).toBe('fallback-id');
        });
        (0, globals_1.it)('should handle missing ID fields gracefully', () => {
            const resyncBody = {
                eventName: 'RESYNC',
                data: {
                    name: 'No ID User'
                },
                entityName: 'user'
            };
            const sqsEvent = {
                Records: [createSQSRecord(resyncBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records[0].entityId).toBeUndefined();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaHlicmlkLXNlYXJjaC1ldmVudC1leHRyYWN0b3IudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvaW5kZXhlci9oeWJyaWQtc2VhcmNoLWV2ZW50LWV4dHJhY3Rvci50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0EsbUZBQTZFO0FBRTdFLDJDQUF1RTtBQUV2RSxzQ0FBc0M7QUFDdEMsY0FBSSxDQUFDLElBQUksQ0FBQyxrRUFBa0UsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ25GLDBCQUEwQixFQUFFLGNBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQzlELFdBQVcsRUFBRSxjQUFJLENBQUMsRUFBRSxFQUFFO0tBQ3ZCLENBQUMsQ0FBQztDQUNKLENBQUMsQ0FBQyxDQUFDO0FBRUosTUFBTSxlQUFlLEdBQUcsQ0FBQyxJQUFTLEVBQUUsWUFBb0IsYUFBYSxFQUFhLEVBQUUsQ0FBQyxDQUFDO0lBQ3BGLFNBQVM7SUFDVCxhQUFhLEVBQUUsY0FBYztJQUM3QixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUM7SUFDMUIsVUFBVSxFQUFFO1FBQ1YsdUJBQXVCLEVBQUUsR0FBRztRQUM1QixhQUFhLEVBQUUsWUFBWTtRQUMzQixRQUFRLEVBQUUsYUFBYTtRQUN2QixnQ0FBZ0MsRUFBRSxZQUFZO0tBQy9DO0lBQ0QsaUJBQWlCLEVBQUUsRUFBRTtJQUNyQixTQUFTLEVBQUUsVUFBVTtJQUNyQixXQUFXLEVBQUUsU0FBUztJQUN0QixjQUFjLEVBQUUsK0NBQStDO0lBQy9ELFNBQVMsRUFBRSxXQUFXO0NBQ3ZCLENBQUMsQ0FBQztBQUVILElBQUEsa0JBQVEsRUFBQyw0QkFBNEIsRUFBRSxHQUFHLEVBQUU7SUFDMUMsSUFBSSxTQUFxQyxDQUFDO0lBQzFDLElBQUksbUJBQXdCLENBQUM7SUFFN0IsSUFB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LENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQyxDQUFDO2FBQ3ZDLENBQUM7WUFFRixNQUFNLE9BQU8sR0FBRyxTQUFTLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBRWhELElBQUEsZ0JBQU0sRUFBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDOUMsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU1FTRXZlbnQsIFNRU1JlY29yZCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgSHlicmlkU2VhcmNoRXZlbnRFeHRyYWN0b3IgfSBmcm9tICcuL2h5YnJpZC1zZWFyY2gtZXZlbnQtZXh0cmFjdG9yJztcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzJztcbmltcG9ydCB7IGRlc2NyaWJlLCBleHBlY3QsIGl0LCBqZXN0LCBiZWZvcmVFYWNoIH0gZnJvbSAnQGplc3QvZ2xvYmFscyc7XG5cbi8vIE1vY2sgdGhlIER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yXG5qZXN0Lm1vY2soJy4uLy4uL2NvcmUvcnVudGltZS9ldmVudC1wcm9jZXNzb3IvZHluYW1vZGItZXZlbnQtZGF0YS1leHRyYWN0b3InLCAoKSA9PiAoe1xuICBEeW5hbW9EQkV2ZW50RGF0YUV4dHJhY3RvcjogamVzdC5mbigpLm1vY2tJbXBsZW1lbnRhdGlvbigoKSA9PiAoe1xuICAgIGV4dHJhY3REYXRhOiBqZXN0LmZuKClcbiAgfSkpXG59KSk7XG5cbmNvbnN0IGNyZWF0ZVNRU1JlY29yZCA9IChib2R5OiBhbnksIG1lc3NhZ2VJZDogc3RyaW5nID0gJ3Rlc3QtbXNnLWlkJyk6IFNRU1JlY29yZCA9PiAoe1xuICBtZXNzYWdlSWQsXG4gIHJlY2VpcHRIYW5kbGU6ICd0ZXN0LXJlY2VpcHQnLFxuICBib2R5OiBKU09OLnN0cmluZ2lmeShib2R5KSxcbiAgYXR0cmlidXRlczoge1xuICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXG4gICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnLFxuICAgIFNlbmRlcklkOiAndGVzdC1zZW5kZXInLFxuICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTIzNDU2Nzg5MCdcbiAgfSxcbiAgbWVzc2FnZUF0dHJpYnV0ZXM6IHt9LFxuICBtZDVPZkJvZHk6ICd0ZXN0LW1kNScsXG4gIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXG4gIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcbiAgYXdzUmVnaW9uOiAndXMtZWFzdC0xJ1xufSk7XG5cbmRlc2NyaWJlKCdIeWJyaWRTZWFyY2hFdmVudEV4dHJhY3RvcicsICgpID0+IHtcbiAgbGV0IGV4dHJhY3RvcjogSHlicmlkU2VhcmNoRXZlbnRFeHRyYWN0b3I7XG4gIGxldCBtb2NrRHluYW1vRXh0cmFjdG9yOiBhbnk7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgZXh0cmFjdG9yID0gbmV3IEh5YnJpZFNlYXJjaEV2ZW50RXh0cmFjdG9yKCk7XG4gICAgLy8gR2V0IHRoZSBtb2NrZWQgRHluYW1vREIgZXh0cmFjdG9yIGluc3RhbmNlXG4gICAgbW9ja0R5bmFtb0V4dHJhY3RvciA9IChleHRyYWN0b3IgYXMgYW55KS5keW5hbW9FeHRyYWN0b3I7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdSZXN5bmMgRXZlbnQgUHJvY2Vzc2luZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGV4dHJhY3QgcmVzeW5jIGV2ZW50cyB3aXRoIGV2ZW50TmFtZSBmb3JtYXQnLCAoKSA9PiB7XG4gICAgICBjb25zdCByZXN5bmNCb2R5ID0ge1xuICAgICAgICBldmVudE5hbWU6ICdSRVNZTkMnLFxuICAgICAgICBkYXRhOiB7IGlkOiAndXNlci0xMjMnLCBuYW1lOiAnSm9obiBEb2UnLCBlbWFpbDogJ2pvaG5AZXhhbXBsZS5jb20nIH0sXG4gICAgICAgIGVudGl0eU5hbWU6ICd1c2VyJ1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHJlc3luY0JvZHkpXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG5cbiAgICAgIGV4cGVjdChyZWNvcmRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QocmVjb3Jkc1swXSkudG9FcXVhbCh7XG4gICAgICAgIGV2ZW50SWQ6ICd0ZXN0LW1zZy1pZCcsXG4gICAgICAgIGV2ZW50VHlwZTogJ3VwZGF0ZScsXG4gICAgICAgIHRpbWVzdGFtcDogZXhwZWN0LmFueShOdW1iZXIpLFxuICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxuICAgICAgICBwYXlsb2FkOiByZXN5bmNCb2R5LmRhdGEsXG4gICAgICAgIGVudGl0eUlkOiAndXNlci0xMjMnLFxuICAgICAgICBlbnRpdHlOYW1lOiAndXNlcicsXG4gICAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgICAgc291cmNlOiAncmVzeW5jJ1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCByZXN5bmMgZXZlbnRzIHdpdGggc2ltcGxlIGZvcm1hdCAobm8gZXZlbnROYW1lKScsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3luY0JvZHkgPSB7XG4gICAgICAgIGRhdGE6IHsgaWQ6ICd1c2VyLTQ1NicsIG5hbWU6ICdKYW5lIERvZScsIGVtYWlsOiAnamFuZUBleGFtcGxlLmNvbScgfSxcbiAgICAgICAgZW50aXR5TmFtZTogJ3VzZXInXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBzcXNFdmVudDogU1FTRXZlbnQgPSB7XG4gICAgICAgIFJlY29yZHM6IFtjcmVhdGVTUVNSZWNvcmQocmVzeW5jQm9keSldXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZWNvcmRzID0gZXh0cmFjdG9yLmV4dHJhY3REYXRhKHNxc0V2ZW50KTtcblxuICAgICAgZXhwZWN0KHJlY29yZHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChyZWNvcmRzWzBdKS50b0VxdWFsKHtcbiAgICAgICAgZXZlbnRJZDogJ3Rlc3QtbXNnLWlkJyxcbiAgICAgICAgZXZlbnRUeXBlOiAndXBkYXRlJyxcbiAgICAgICAgdGltZXN0YW1wOiBleHBlY3QuYW55KE51bWJlciksXG4gICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXG4gICAgICAgIHBheWxvYWQ6IHJlc3luY0JvZHkuZGF0YSxcbiAgICAgICAgZW50aXR5SWQ6ICd1c2VyLTQ1NicsXG4gICAgICAgIGVudGl0eU5hbWU6ICd1c2VyJyxcbiAgICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgICBzb3VyY2U6ICdyZXN5bmMnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBleHRyYWN0IHJlc3luYyBldmVudHMgd2l0aCBhcnJheSBkYXRhIChiYXRjaCBwcm9jZXNzaW5nKScsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3luY0JvZHkgPSB7XG4gICAgICAgIGV2ZW50TmFtZTogJ1JFU1lOQycsXG4gICAgICAgIGRhdGE6IFtcbiAgICAgICAgICB7IGlkOiAndXNlci0xJywgbmFtZTogJ1VzZXIgMScgfSxcbiAgICAgICAgICB7IGlkOiAndXNlci0yJywgbmFtZTogJ1VzZXIgMicgfVxuICAgICAgICBdLFxuICAgICAgICBlbnRpdHlOYW1lOiAndXNlcidcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNxc0V2ZW50OiBTUVNFdmVudCA9IHtcbiAgICAgICAgUmVjb3JkczogW2NyZWF0ZVNRU1JlY29yZChyZXN5bmNCb2R5KV1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlY29yZHMgPSBleHRyYWN0b3IuZXh0cmFjdERhdGEoc3FzRXZlbnQpO1xuXG4gICAgICAvLyBBcnJheSBkYXRhIHNob3VsZCBjcmVhdGUgbXVsdGlwbGUgaW5kaXZpZHVhbCByZWNvcmRzXG4gICAgICBleHBlY3QocmVjb3JkcykudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgXG4gICAgICAvLyBGaXJzdCByZWNvcmRcbiAgICAgIGV4cGVjdChyZWNvcmRzWzBdKS50b0VxdWFsKHtcbiAgICAgICAgZXZlbnRJZDogJ3Rlc3QtbXNnLWlkLTAnLFxuICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICB0aW1lc3RhbXA6IGV4cGVjdC5hbnkoTnVtYmVyKSxcbiAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcbiAgICAgICAgcGF5bG9hZDogeyBpZDogJ3VzZXItMScsIG5hbWU6ICdVc2VyIDEnIH0sXG4gICAgICAgIGVudGl0eUlkOiAndXNlci0xJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ3VzZXInLFxuICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgIHNvdXJjZTogJ3Jlc3luYydcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIC8vIFNlY29uZCByZWNvcmRcbiAgICAgIGV4cGVjdChyZWNvcmRzWzFdKS50b0VxdWFsKHtcbiAgICAgICAgZXZlbnRJZDogJ3Rlc3QtbXNnLWlkLTEnLFxuICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICB0aW1lc3RhbXA6IGV4cGVjdC5hbnkoTnVtYmVyKSxcbiAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcbiAgICAgICAgcGF5bG9hZDogeyBpZDogJ3VzZXItMicsIG5hbWU6ICdVc2VyIDInIH0sXG4gICAgICAgIGVudGl0eUlkOiAndXNlci0yJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ3VzZXInLFxuICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgIHNvdXJjZTogJ3Jlc3luYydcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSByZXN5bmMgZXZlbnRzIHdpdGggZW50aXR5TmFtZS1iYXNlZCBJRCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3luY0JvZHkgPSB7XG4gICAgICAgIGV2ZW50TmFtZTogJ1JFU1lOQycsXG4gICAgICAgIGRhdGE6IHsgdXNlcklkOiAndXNlci00NTYnLCBuYW1lOiAnSmFuZSBEb2UnIH0sXG4gICAgICAgIGVudGl0eU5hbWU6ICd1c2VyJ1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHJlc3luY0JvZHkpXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG5cbiAgICAgIGV4cGVjdChyZWNvcmRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QocmVjb3Jkc1swXS5lbnRpdHlJZCkudG9CZSgndXNlci00NTYnKTtcbiAgICAgIGV4cGVjdChyZWNvcmRzWzBdLnBheWxvYWQpLnRvRXF1YWwocmVzeW5jQm9keS5kYXRhKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG11bHRpcGxlIHJlc3luYyByZWNvcmRzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbXG4gICAgICAgICAgY3JlYXRlU1FTUmVjb3JkKHtcbiAgICAgICAgICAgIGV2ZW50TmFtZTogJ1JFU1lOQycsXG4gICAgICAgICAgICBkYXRhOiB7IGlkOiAndXNlci0xJywgbmFtZTogJ1VzZXIgMScgfSxcbiAgICAgICAgICAgIGVudGl0eU5hbWU6ICd1c2VyJ1xuICAgICAgICAgIH0sICdtc2ctMScpLFxuICAgICAgICAgIGNyZWF0ZVNRU1JlY29yZCh7XG4gICAgICAgICAgICBldmVudE5hbWU6ICdSRVNZTkMnLFxuICAgICAgICAgICAgZGF0YTogeyBpZDogJ3Bvc3QtMScsIHRpdGxlOiAnUG9zdCAxJyB9LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogJ3Bvc3QnXG4gICAgICAgICAgfSwgJ21zZy0yJylcbiAgICAgICAgXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG5cbiAgICAgIGV4cGVjdChyZWNvcmRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QocmVjb3Jkc1swXS5lbnRpdHlOYW1lKS50b0JlKCd1c2VyJyk7XG4gICAgICBleHBlY3QocmVjb3Jkc1swXS5wYXlsb2FkLm5hbWUpLnRvQmUoJ1VzZXIgMScpO1xuICAgICAgZXhwZWN0KHJlY29yZHNbMV0uZW50aXR5TmFtZSkudG9CZSgncG9zdCcpO1xuICAgICAgZXhwZWN0KHJlY29yZHNbMV0ucGF5bG9hZC50aXRsZSkudG9CZSgnUG9zdCAxJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdEeW5hbW9EQiBTdHJlYW0gRXZlbnQgUHJvY2Vzc2luZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGRlbGVnYXRlIHRvIER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yIGZvciBub24tcmVzeW5jIGV2ZW50cycsICgpID0+IHtcbiAgICAgIGNvbnN0IHNuc0JvZHkgPSB7XG4gICAgICAgIE1lc3NhZ2U6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBSZWNvcmRzOiBbe1xuICAgICAgICAgICAgZXZlbnROYW1lOiAnSU5TRVJUJyxcbiAgICAgICAgICAgIGR5bmFtb2RiOiB7XG4gICAgICAgICAgICAgIE5ld0ltYWdlOiB7IGlkOiB7IFM6ICd1c2VyLTEyMycgfSwgbmFtZTogeyBTOiAnSm9obicgfSB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfV1cbiAgICAgICAgfSlcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNxc0V2ZW50OiBTUVNFdmVudCA9IHtcbiAgICAgICAgUmVjb3JkczogW2NyZWF0ZVNRU1JlY29yZChzbnNCb2R5KV1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1vY2tEeW5hbW9SZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8YW55PltdID0gW3tcbiAgICAgICAgZXZlbnRJZDogJ2R5bmFtby1ldmVudC0xJyxcbiAgICAgICAgZXZlbnRUeXBlOiAnY3JlYXRlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ3VzZXInLFxuICAgICAgICBlbnRpdHlJZDogJ3VzZXItMTIzJyxcbiAgICAgICAgcGF5bG9hZDoge1xuICAgICAgICAgIG5ld0ltYWdlOiB7IGlkOiAndXNlci0xMjMnLCBuYW1lOiAnSm9obicgfSxcbiAgICAgICAgICBvbGRJbWFnZTogdW5kZWZpbmVkLFxuICAgICAgICAgIGtleXM6IHsgaWQ6ICd1c2VyLTEyMycgfVxuICAgICAgICB9LFxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIGV2ZW50U291cmNlOiAnYXdzOmR5bmFtb2RiJyxcbiAgICAgICAgbWV0YWRhdGE6IHt9XG4gICAgICB9XTtcblxuICAgICAgbW9ja0R5bmFtb0V4dHJhY3Rvci5leHRyYWN0RGF0YS5tb2NrUmV0dXJuVmFsdWUobW9ja0R5bmFtb1JlY29yZHMpO1xuXG4gICAgICBjb25zdCByZWNvcmRzID0gZXh0cmFjdG9yLmV4dHJhY3REYXRhKHNxc0V2ZW50KTtcblxuICAgICAgZXhwZWN0KG1vY2tEeW5hbW9FeHRyYWN0b3IuZXh0cmFjdERhdGEpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKHNxc0V2ZW50KTtcbiAgICAgIGV4cGVjdChyZWNvcmRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QocmVjb3Jkc1swXSkudG9FcXVhbCh7XG4gICAgICAgIC4uLm1vY2tEeW5hbW9SZWNvcmRzWzBdLFxuICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgIHNvdXJjZTogJ3N0cmVhbSdcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByZXNlcnZlIER5bmFtb0RCIHN0cmVhbSByZWNvcmQgc3RydWN0dXJlJywgKCkgPT4ge1xuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHsgc29tZU90aGVyRm9ybWF0OiAnZGF0YScgfSldXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtb2NrRHluYW1vUmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPGFueT5bXSA9IFt7XG4gICAgICAgIGV2ZW50SWQ6ICdkeW5hbW8tZXZlbnQtMScsXG4gICAgICAgIGV2ZW50VHlwZTogJ3VwZGF0ZScsXG4gICAgICAgIGVudGl0eU5hbWU6ICdwb3N0JyxcbiAgICAgICAgZW50aXR5SWQ6ICdwb3N0LTQ1NicsXG4gICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICBuZXdJbWFnZTogeyBpZDogJ3Bvc3QtNDU2JywgdGl0bGU6ICdVcGRhdGVkIFBvc3QnIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHsgaWQ6ICdwb3N0LTQ1NicsIHRpdGxlOiAnT2xkIFBvc3QnIH0sXG4gICAgICAgICAga2V5czogeyBpZDogJ3Bvc3QtNDU2JyB9XG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6ZHluYW1vZGInXG4gICAgICB9XTtcblxuICAgICAgbW9ja0R5bmFtb0V4dHJhY3Rvci5leHRyYWN0RGF0YS5tb2NrUmV0dXJuVmFsdWUobW9ja0R5bmFtb1JlY29yZHMpO1xuXG4gICAgICBjb25zdCByZWNvcmRzID0gZXh0cmFjdG9yLmV4dHJhY3REYXRhKHNxc0V2ZW50KTtcblxuICAgICAgZXhwZWN0KHJlY29yZHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChyZWNvcmRzWzBdLm1ldGFkYXRhPy5zb3VyY2UpLnRvQmUoJ3N0cmVhbScpO1xuICAgICAgZXhwZWN0KHJlY29yZHNbMF0ucGF5bG9hZCkudG9FcXVhbChtb2NrRHluYW1vUmVjb3Jkc1swXS5wYXlsb2FkKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ01peGVkIEV2ZW50IFByb2Nlc3NpbmcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWl4ZWQgcmVzeW5jIGFuZCBzdHJlYW0gZXZlbnRzIGluIHRoZSBzYW1lIFNRUyBiYXRjaCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHNxc0V2ZW50OiBTUVNFdmVudCA9IHtcbiAgICAgICAgUmVjb3JkczogW1xuICAgICAgICAgIGNyZWF0ZVNRU1JlY29yZCh7XG4gICAgICAgICAgICBldmVudE5hbWU6ICdSRVNZTkMnLFxuICAgICAgICAgICAgZGF0YTogeyBpZDogJ3VzZXItcmVzeW5jJywgbmFtZTogJ1Jlc3luYyBVc2VyJyB9LFxuICAgICAgICAgICAgZW50aXR5TmFtZTogJ3VzZXInXG4gICAgICAgICAgfSwgJ3Jlc3luYy1tc2cnKSxcbiAgICAgICAgICBjcmVhdGVTUVNSZWNvcmQoe1xuICAgICAgICAgICAgTWVzc2FnZTogJ0R5bmFtb0RCIHN0cmVhbSBldmVudCdcbiAgICAgICAgICB9LCAnc3RyZWFtLW1zZycpXG4gICAgICAgIF1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1vY2tEeW5hbW9SZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8YW55PltdID0gW3tcbiAgICAgICAgZXZlbnRJZDogJ3N0cmVhbS1ldmVudCcsXG4gICAgICAgIGV2ZW50VHlwZTogJ2RlbGV0ZScsXG4gICAgICAgIGVudGl0eU5hbWU6ICdwb3N0JyxcbiAgICAgICAgZW50aXR5SWQ6ICdwb3N0LXN0cmVhbScsXG4gICAgICAgIHBheWxvYWQ6IHsgb2xkSW1hZ2U6IHsgaWQ6ICdwb3N0LXN0cmVhbScgfSB9LFxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIGV2ZW50U291cmNlOiAnYXdzOmR5bmFtb2RiJ1xuICAgICAgfV07XG5cbiAgICAgIC8vIE1vY2sgdG8gcmV0dXJuIHJlY29yZHMgb25seSBmb3IgdGhlIHNlY29uZCAoc3RyZWFtKSByZWNvcmRcbiAgICAgIG1vY2tEeW5hbW9FeHRyYWN0b3IuZXh0cmFjdERhdGEubW9ja0ltcGxlbWVudGF0aW9uKChldmVudDogU1FTRXZlbnQpID0+IHtcbiAgICAgICAgaWYgKGV2ZW50LlJlY29yZHNbMF0ubWVzc2FnZUlkID09PSAnc3RyZWFtLW1zZycpIHtcbiAgICAgICAgICByZXR1cm4gbW9ja0R5bmFtb1JlY29yZHM7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHJlY29yZHMgPSBleHRyYWN0b3IuZXh0cmFjdERhdGEoc3FzRXZlbnQpO1xuXG4gICAgICBleHBlY3QocmVjb3JkcykudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgXG4gICAgICAvLyBGaXJzdCByZWNvcmQgc2hvdWxkIGJlIHJlc3luY1xuICAgICAgZXhwZWN0KHJlY29yZHNbMF0ubWV0YWRhdGE/LnNvdXJjZSkudG9CZSgncmVzeW5jJyk7XG4gICAgICBleHBlY3QocmVjb3Jkc1swXS5lbnRpdHlOYW1lKS50b0JlKCd1c2VyJyk7XG4gICAgICBleHBlY3QocmVjb3Jkc1swXS5wYXlsb2FkLm5hbWUpLnRvQmUoJ1Jlc3luYyBVc2VyJyk7XG4gICAgICBcbiAgICAgIC8vIFNlY29uZCByZWNvcmQgc2hvdWxkIGJlIHN0cmVhbVxuICAgICAgZXhwZWN0KHJlY29yZHNbMV0ubWV0YWRhdGE/LnNvdXJjZSkudG9CZSgnc3RyZWFtJyk7XG4gICAgICBleHBlY3QocmVjb3Jkc1sxXS5lbnRpdHlOYW1lKS50b0JlKCdwb3N0Jyk7XG4gICAgICBleHBlY3QocmVjb3Jkc1sxXS5ldmVudFR5cGUpLnRvQmUoJ2RlbGV0ZScpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnRXJyb3IgSGFuZGxpbmcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgaW52YWxpZCBKU09OIGluIFNRUyByZWNvcmQgYm9keSBncmFjZWZ1bGx5JywgKCkgPT4ge1xuICAgICAgY29uc3QgaW52YWxpZFJlY29yZCA9IHtcbiAgICAgICAgLi4uY3JlYXRlU1FTUmVjb3JkKHt9KSxcbiAgICAgICAgYm9keTogJ2ludmFsaWQtanNvbnsnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBzcXNFdmVudDogU1FTRXZlbnQgPSB7XG4gICAgICAgIFJlY29yZHM6IFtpbnZhbGlkUmVjb3JkXVxuICAgICAgfTtcblxuICAgICAgLy8gTW9jayBEeW5hbW9EQiBleHRyYWN0b3IgdG8gcmV0dXJuIGVtcHR5IGFycmF5IGZvciBpbnZhbGlkIGRhdGFcbiAgICAgIG1vY2tEeW5hbW9FeHRyYWN0b3IuZXh0cmFjdERhdGEubW9ja1JldHVyblZhbHVlKFtdKTtcblxuICAgICAgLy8gU2hvdWxkIG5vdCB0aHJvdywgYnV0IGRlbGVnYXRlIHRvIER5bmFtb0RCIGV4dHJhY3RvclxuICAgICAgZXhwZWN0KCgpID0+IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCkpLm5vdC50b1Rocm93KCk7XG4gICAgICBleHBlY3QobW9ja0R5bmFtb0V4dHJhY3Rvci5leHRyYWN0RGF0YSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgXG4gICAgICBjb25zdCByZWNvcmRzID0gZXh0cmFjdG9yLmV4dHJhY3REYXRhKHNxc0V2ZW50KTtcbiAgICAgIGV4cGVjdChyZWNvcmRzKS50b0VxdWFsKFtdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1pc3NpbmcgcmVxdWlyZWQgZmllbGRzIGluIHJlc3luYyBldmVudHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBpbmNvbXBsZXRlUmVzeW5jQm9keSA9IHtcbiAgICAgICAgZXZlbnROYW1lOiAnUkVTWU5DJyxcbiAgICAgICAgZGF0YTogeyBpZDogJ3VzZXItMTIzJyB9XG4gICAgICAgIC8vIE1pc3NpbmcgZW50aXR5TmFtZVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKGluY29tcGxldGVSZXN5bmNCb2R5KV1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlY29yZHMgPSBleHRyYWN0b3IuZXh0cmFjdERhdGEoc3FzRXZlbnQpO1xuXG4gICAgICBleHBlY3QocmVjb3JkcykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KHJlY29yZHNbMF0uZW50aXR5TmFtZSkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHJlY29yZHNbMF0ubWV0YWRhdGE/LnNvdXJjZSkudG9CZSgncmVzeW5jJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBvciBudWxsIGRhdGEgaW4gcmVzeW5jIGV2ZW50cycsICgpID0+IHtcbiAgICAgIGNvbnN0IGVtcHR5UmVzeW5jQm9keSA9IHtcbiAgICAgICAgZXZlbnROYW1lOiAnUkVTWU5DJyxcbiAgICAgICAgZGF0YTogbnVsbCxcbiAgICAgICAgZW50aXR5TmFtZTogJ3VzZXInXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBzcXNFdmVudDogU1FTRXZlbnQgPSB7XG4gICAgICAgIFJlY29yZHM6IFtjcmVhdGVTUVNSZWNvcmQoZW1wdHlSZXN5bmNCb2R5KV1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlY29yZHMgPSBleHRyYWN0b3IuZXh0cmFjdERhdGEoc3FzRXZlbnQpO1xuXG4gICAgICBleHBlY3QocmVjb3JkcykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KHJlY29yZHNbMF0ucGF5bG9hZCkudG9CZU51bGwoKTtcbiAgICAgIGV4cGVjdChyZWNvcmRzWzBdLmVudGl0eUlkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFbnRpdHkgSUQgRXh0cmFjdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHByZWZlciBcImlkXCIgZmllbGQgb3ZlciBlbnRpdHlOYW1lLWJhc2VkIGZpZWxkJywgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzeW5jQm9keSA9IHtcbiAgICAgICAgZXZlbnROYW1lOiAnUkVTWU5DJyxcbiAgICAgICAgZGF0YTogeyBcbiAgICAgICAgICBpZDogJ3ByaW1hcnktaWQnLFxuICAgICAgICAgIHVzZXJJZDogJ3NlY29uZGFyeS1pZCcsXG4gICAgICAgICAgbmFtZTogJ1Rlc3QgVXNlcidcbiAgICAgICAgfSxcbiAgICAgICAgZW50aXR5TmFtZTogJ3VzZXInXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBzcXNFdmVudDogU1FTRXZlbnQgPSB7XG4gICAgICAgIFJlY29yZHM6IFtjcmVhdGVTUVNSZWNvcmQocmVzeW5jQm9keSldXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZWNvcmRzID0gZXh0cmFjdG9yLmV4dHJhY3REYXRhKHNxc0V2ZW50KTtcblxuICAgICAgZXhwZWN0KHJlY29yZHNbMF0uZW50aXR5SWQpLnRvQmUoJ3ByaW1hcnktaWQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZmFsbGJhY2sgdG8gZW50aXR5TmFtZS1iYXNlZCBJRCB3aGVuIFwiaWRcIiBpcyBtaXNzaW5nJywgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzeW5jQm9keSA9IHtcbiAgICAgICAgZXZlbnROYW1lOiAnUkVTWU5DJyxcbiAgICAgICAgZGF0YTogeyBcbiAgICAgICAgICBwb3N0SWQ6ICdmYWxsYmFjay1pZCcsXG4gICAgICAgICAgdGl0bGU6ICdUZXN0IFBvc3QnXG4gICAgICAgIH0sXG4gICAgICAgIGVudGl0eU5hbWU6ICdwb3N0J1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHJlc3luY0JvZHkpXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG5cbiAgICAgIGV4cGVjdChyZWNvcmRzWzBdLmVudGl0eUlkKS50b0JlKCdmYWxsYmFjay1pZCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWlzc2luZyBJRCBmaWVsZHMgZ3JhY2VmdWxseScsICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3luY0JvZHkgPSB7XG4gICAgICAgIGV2ZW50TmFtZTogJ1JFU1lOQycsXG4gICAgICAgIGRhdGE6IHsgXG4gICAgICAgICAgbmFtZTogJ05vIElEIFVzZXInXG4gICAgICAgIH0sXG4gICAgICAgIGVudGl0eU5hbWU6ICd1c2VyJ1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHJlc3luY0JvZHkpXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG5cbiAgICAgIGV4cGVjdChyZWNvcmRzWzBdLmVudGl0eUlkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=