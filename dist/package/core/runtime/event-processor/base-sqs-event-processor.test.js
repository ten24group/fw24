"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_sqs_event_processor_1 = require("./base-sqs-event-processor");
const globals_1 = require("@jest/globals");
const observability_1 = require("../../../observability");
// Mock implementation for testing
class MockEventDataExtractor {
    extractData(event) {
        return event.Records.map((record, index) => ({
            eventId: record.messageId,
            eventType: 'update',
            entityName: `entity-${index}`,
            entityId: `id-${index}`,
            payload: { data: `payload-${index}` },
            timestamp: Date.now(),
            eventSource: record.eventSource
        }));
    }
}
class TestSQSEventProcessor extends base_sqs_event_processor_1.BaseSQSEventProcessor {
    processRecordCalls = [];
    processRecordsBatchCalls = [];
    preprocessCalls = [];
    postprocessCalls = [];
    constructor(processMode = 'record') {
        super(new MockEventDataExtractor(), { processMode });
    }
    async initialize(_event, _context) {
        // Mock implementation
    }
    async processRecord(record) {
        this.processRecordCalls.push(record);
    }
    async processRecordsBatch(records) {
        this.processRecordsBatchCalls.push(records);
    }
    async preprocessRecord(record) {
        this.preprocessCalls.push(record);
        return record; // Accept all records
    }
    async postprocessRecord(record) {
        this.postprocessCalls.push(record);
    }
    // Public method to override preprocessRecord for testing
    setPreprocessFilter(filter) {
        this.preprocessRecord = async (record) => {
            this.preprocessCalls.push(record);
            return filter(record) ? record : null;
        };
    }
}
(0, globals_1.describe)('BaseSQSEventProcessor', () => {
    let processor;
    let mockSQSEvent;
    (0, globals_1.beforeEach)(() => {
        mockSQSEvent = {
            Records: [
                {
                    messageId: 'msg-1',
                    receiptHandle: 'receipt-1',
                    body: JSON.stringify({ data: 'test1', entityName: 'entity1' }),
                    attributes: {
                        ApproximateReceiveCount: '1',
                        SentTimestamp: '1234567890',
                        SenderId: 'sender-1',
                        ApproximateFirstReceiveTimestamp: '1234567890'
                    },
                    messageAttributes: {},
                    md5OfBody: 'md5-1',
                    eventSource: 'aws:sqs',
                    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
                    awsRegion: 'us-east-1'
                },
                {
                    messageId: 'msg-2',
                    receiptHandle: 'receipt-2',
                    body: JSON.stringify({ data: 'test2', entityName: 'entity2' }),
                    attributes: {
                        ApproximateReceiveCount: '1',
                        SentTimestamp: '1234567890',
                        SenderId: 'sender-2',
                        ApproximateFirstReceiveTimestamp: '1234567890'
                    },
                    messageAttributes: {},
                    md5OfBody: 'md5-2',
                    eventSource: 'aws:sqs',
                    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
                    awsRegion: 'us-east-1'
                }
            ]
        };
    });
    (0, globals_1.describe)('Constructor', () => {
        (0, globals_1.it)('should initialize with default record mode', () => {
            processor = new TestSQSEventProcessor();
            (0, globals_1.expect)(processor['processMode']).toBe('record');
        });
        (0, globals_1.it)('should initialize with batch mode when specified', () => {
            processor = new TestSQSEventProcessor('batch');
            (0, globals_1.expect)(processor['processMode']).toBe('batch');
        });
        (0, globals_1.it)('should throw error when extractor is not provided', () => {
            (0, globals_1.expect)(() => {
                new (class extends base_sqs_event_processor_1.BaseSQSEventProcessor {
                    async initialize() { }
                    async processRecord() { }
                    async processRecordsBatch() { }
                })(null);
            }).toThrow('IEventDataExtractor is required for BaseSQSEventProcessor');
        });
    });
    (0, globals_1.describe)('Record Mode Processing', () => {
        (0, globals_1.beforeEach)(() => {
            processor = new TestSQSEventProcessor('record');
        });
        (0, globals_1.it)('should process records individually in record mode', async () => {
            await processor.process(mockSQSEvent, {});
            (0, globals_1.expect)(processor.processRecordCalls).toHaveLength(2);
            (0, globals_1.expect)(processor.processRecordsBatchCalls).toHaveLength(0);
            (0, globals_1.expect)(processor.preprocessCalls).toHaveLength(2);
            (0, globals_1.expect)(processor.postprocessCalls).toHaveLength(2);
            (0, globals_1.expect)(processor.processRecordCalls[0].entityName).toBe('entity-0');
            (0, globals_1.expect)(processor.processRecordCalls[1].entityName).toBe('entity-1');
        });
        (0, globals_1.it)('should handle empty records array', async () => {
            const emptyEvent = { Records: [] };
            await processor.process(emptyEvent, {});
            (0, globals_1.expect)(processor.processRecordCalls).toHaveLength(0);
            (0, globals_1.expect)(processor.processRecordsBatchCalls).toHaveLength(0);
        });
        (0, globals_1.it)('should filter out records during preprocessing', async () => {
            // Use the public method to set filter
            processor.setPreprocessFilter((record) => record.entityName === 'entity-0');
            await processor.process(mockSQSEvent, {});
            (0, globals_1.expect)(processor.processRecordCalls).toHaveLength(1);
            (0, globals_1.expect)(processor.processRecordCalls[0].entityName).toBe('entity-0');
        });
        (0, globals_1.it)('should honor per-record trace context (mixed batch) by setting causedBy per record (no remote parent)', async () => {
            // Arrange mixed upstream trace info via message attributes
            mockSQSEvent.Records[0].messageAttributes = {
                correlationId: { stringValue: 'c1', dataType: 'String' },
                causedBy: { stringValue: 'root', dataType: 'String' },
                // parentObservabilityLogId is not propagated across hops under the strict contract
            };
            mockSQSEvent.Records[1].messageAttributes = {
                correlationId: { stringValue: 'c2', dataType: 'String' },
                causedBy: { stringValue: 'root', dataType: 'String' },
                // parentObservabilityLogId is not propagated across hops under the strict contract
            };
            const spy = globals_1.jest.spyOn(observability_1.SpanObserver, 'withSpan');
            const mockContext = {
                callbackWaitsForEmptyEventLoop: true,
                functionName: 'test-function',
                functionVersion: '1',
                invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
                memoryLimitInMB: '128',
                awsRequestId: 'invocation-1',
                logGroupName: 'test-log-group',
                logStreamName: 'test-log-stream',
                getRemainingTimeInMillis: () => 30000,
                done: () => { },
                fail: () => { },
                succeed: () => { }
            };
            await processor.LambdaHandler(mockSQSEvent, mockContext);
            const recordCalls = spy.mock.calls.filter((c) => String(c[0]).includes('record'));
            (0, globals_1.expect)(recordCalls.length).toBeGreaterThanOrEqual(2);
            const opts0 = recordCalls[0][2];
            const opts1 = recordCalls[1][2];
            // In strict-hierarchy mode, correlationId is per-invocation; upstream correlationId becomes causedBy.
            (0, globals_1.expect)([opts0.causedBy, opts1.causedBy].sort()).toEqual(['c1', 'c2'].sort());
            (0, globals_1.expect)(opts0.parentObservabilityLogId).toBeUndefined();
            (0, globals_1.expect)(opts1.parentObservabilityLogId).toBeUndefined();
        });
    });
    (0, globals_1.describe)('Batch Mode Processing', () => {
        (0, globals_1.beforeEach)(() => {
            processor = new TestSQSEventProcessor('batch');
        });
        (0, globals_1.it)('should process records in batch mode', async () => {
            await processor.process(mockSQSEvent, {});
            (0, globals_1.expect)(processor.processRecordCalls).toHaveLength(0);
            (0, globals_1.expect)(processor.processRecordsBatchCalls).toHaveLength(1);
            (0, globals_1.expect)(processor.preprocessCalls).toHaveLength(2);
            (0, globals_1.expect)(processor.postprocessCalls).toHaveLength(2);
            const batchCall = processor.processRecordsBatchCalls[0];
            (0, globals_1.expect)(batchCall).toHaveLength(2);
            (0, globals_1.expect)(batchCall[0].entityName).toBe('entity-0');
            (0, globals_1.expect)(batchCall[1].entityName).toBe('entity-1');
        });
        (0, globals_1.it)('should handle empty records array in batch mode', async () => {
            const emptyEvent = { Records: [] };
            await processor.process(emptyEvent, {});
            (0, globals_1.expect)(processor.processRecordCalls).toHaveLength(0);
            (0, globals_1.expect)(processor.processRecordsBatchCalls).toHaveLength(0);
        });
        (0, globals_1.it)('should filter out records during preprocessing in batch mode', async () => {
            // Use the public method to set filter
            processor.setPreprocessFilter((record) => record.entityName === 'entity-0');
            await processor.process(mockSQSEvent, {});
            (0, globals_1.expect)(processor.processRecordCalls).toHaveLength(0);
            (0, globals_1.expect)(processor.processRecordsBatchCalls).toHaveLength(1);
            (0, globals_1.expect)(processor.processRecordsBatchCalls[0]).toHaveLength(1);
            (0, globals_1.expect)(processor.processRecordsBatchCalls[0][0].entityName).toBe('entity-0');
        });
    });
    (0, globals_1.describe)('LambdaHandler', () => {
        (0, globals_1.beforeEach)(() => {
            processor = new TestSQSEventProcessor('record');
        });
        (0, globals_1.it)('should call initialize and process', async () => {
            const initializeSpy = globals_1.jest.spyOn(processor, 'initialize');
            const processSpy = globals_1.jest.spyOn(processor, 'process');
            const mockContext = {
                callbackWaitsForEmptyEventLoop: true,
                functionName: 'test-function',
                functionVersion: '1',
                invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
                memoryLimitInMB: '128',
                awsRequestId: 'test-request-id',
                logGroupName: 'test-log-group',
                logStreamName: 'test-log-stream',
                getRemainingTimeInMillis: () => 30000,
                done: () => { },
                fail: () => { },
                succeed: () => { }
            };
            await processor.LambdaHandler(mockSQSEvent, mockContext);
            (0, globals_1.expect)(initializeSpy).toHaveBeenCalledWith(mockSQSEvent, mockContext);
            // BaseSQSEventProcessor calls process(event, context) (no third arg)
            (0, globals_1.expect)(processSpy).toHaveBeenCalledWith(mockSQSEvent, mockContext);
        });
    });
    (0, globals_1.describe)('Performance Tracking', () => {
        (0, globals_1.it)('should track processing time in record mode', async () => {
            processor = new TestSQSEventProcessor('record');
            const startTime = Date.now();
            await processor.process(mockSQSEvent, {});
            const endTime = Date.now();
            const duration = endTime - startTime;
            // Should complete within reasonable time (less than 1 second)
            (0, globals_1.expect)(duration).toBeGreaterThanOrEqual(0);
            (0, globals_1.expect)(duration).toBeLessThan(1000);
            // Should have processed the expected number of records
            (0, globals_1.expect)(processor.processRecordCalls).toHaveLength(2);
        });
        (0, globals_1.it)('should track processing time in batch mode', async () => {
            processor = new TestSQSEventProcessor('batch');
            const startTime = Date.now();
            await processor.process(mockSQSEvent, {});
            const endTime = Date.now();
            const duration = endTime - startTime;
            // Should complete within reasonable time (less than 1 second)
            (0, globals_1.expect)(duration).toBeGreaterThanOrEqual(0);
            (0, globals_1.expect)(duration).toBeLessThan(1000);
            // Should have processed records in batch mode
            (0, globals_1.expect)(processor.processRecordsBatchCalls).toHaveLength(1);
            (0, globals_1.expect)(processor.processRecordsBatchCalls[0]).toHaveLength(2);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9iYXNlLXNxcy1ldmVudC1wcm9jZXNzb3IudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHlFQUFtRTtBQUduRSwyQ0FBdUU7QUFDdkUsMERBQXNEO0FBRXRELGtDQUFrQztBQUNsQyxNQUFNLHNCQUFzQjtJQUMxQixXQUFXLENBQUMsS0FBZTtRQUN6QixPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztZQUMzQyxPQUFPLEVBQUUsTUFBTSxDQUFDLFNBQVM7WUFDekIsU0FBUyxFQUFFLFFBQVE7WUFDbkIsVUFBVSxFQUFFLFVBQVUsS0FBSyxFQUFFO1lBQzdCLFFBQVEsRUFBRSxNQUFNLEtBQUssRUFBRTtZQUN2QixPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsV0FBVyxLQUFLLEVBQUUsRUFBRTtZQUNyQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUNyQixXQUFXLEVBQUUsTUFBTSxDQUFDLFdBQVc7U0FDaEMsQ0FBQyxDQUFDLENBQUM7SUFDTixDQUFDO0NBQ0Y7QUFFRCxNQUFNLHFCQUFzQixTQUFRLGdEQUE2QztJQUN4RSxrQkFBa0IsR0FBMkIsRUFBRSxDQUFDO0lBQ2hELHdCQUF3QixHQUE2QixFQUFFLENBQUM7SUFDeEQsZUFBZSxHQUEyQixFQUFFLENBQUM7SUFDN0MsZ0JBQWdCLEdBQTJCLEVBQUUsQ0FBQztJQUVyRCxZQUFZLGNBQWtDLFFBQVE7UUFDcEQsS0FBSyxDQUFDLElBQUksc0JBQXNCLEVBQUUsRUFBRSxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7SUFDdkQsQ0FBQztJQUVELEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBVyxFQUFFLFFBQWE7UUFDekMsc0JBQXNCO0lBQ3hCLENBQUM7SUFFUyxLQUFLLENBQUMsYUFBYSxDQUFDLE1BQTRCO1FBQ3hELElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDdkMsQ0FBQztJQUVTLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxPQUErQjtRQUNqRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQzlDLENBQUM7SUFFUyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsTUFBNEI7UUFDM0QsSUFBSSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDbEMsT0FBTyxNQUFNLENBQUMsQ0FBQyxxQkFBcUI7SUFDdEMsQ0FBQztJQUVTLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxNQUE0QjtRQUM1RCxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ3JDLENBQUM7SUFFRCx5REFBeUQ7SUFDbEQsbUJBQW1CLENBQUMsTUFBaUQ7UUFDMUUsSUFBSSxDQUFDLGdCQUFnQixHQUFHLEtBQUssRUFBRSxNQUE0QixFQUFFLEVBQUU7WUFDN0QsSUFBSSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDbEMsT0FBTyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1FBQ3hDLENBQUMsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQUVELElBQUEsa0JBQVEsRUFBQyx1QkFBdUIsRUFBRSxHQUFHLEVBQUU7SUFDckMsSUFBSSxTQUFnQyxDQUFDO0lBQ3JDLElBQUksWUFBc0IsQ0FBQztJQUUzQixJQUFBLG9CQUFVLEVBQUMsR0FBRyxFQUFFO1FBQ2QsWUFBWSxHQUFHO1lBQ2IsT0FBTyxFQUFFO2dCQUNQO29CQUNFLFNBQVMsRUFBRSxPQUFPO29CQUNsQixhQUFhLEVBQUUsV0FBVztvQkFDMUIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsQ0FBQztvQkFDOUQsVUFBVSxFQUFFO3dCQUNWLHVCQUF1QixFQUFFLEdBQUc7d0JBQzVCLGFBQWEsRUFBRSxZQUFZO3dCQUMzQixRQUFRLEVBQUUsVUFBVTt3QkFDcEIsZ0NBQWdDLEVBQUUsWUFBWTtxQkFDL0M7b0JBQ0QsaUJBQWlCLEVBQUUsRUFBRTtvQkFDckIsU0FBUyxFQUFFLE9BQU87b0JBQ2xCLFdBQVcsRUFBRSxTQUFTO29CQUN0QixjQUFjLEVBQUUsK0NBQStDO29CQUMvRCxTQUFTLEVBQUUsV0FBVztpQkFDdkI7Z0JBQ0Q7b0JBQ0UsU0FBUyxFQUFFLE9BQU87b0JBQ2xCLGFBQWEsRUFBRSxXQUFXO29CQUMxQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxDQUFDO29CQUM5RCxVQUFVLEVBQUU7d0JBQ1YsdUJBQXVCLEVBQUUsR0FBRzt3QkFDNUIsYUFBYSxFQUFFLFlBQVk7d0JBQzNCLFFBQVEsRUFBRSxVQUFVO3dCQUNwQixnQ0FBZ0MsRUFBRSxZQUFZO3FCQUMvQztvQkFDRCxpQkFBaUIsRUFBRSxFQUFFO29CQUNyQixTQUFTLEVBQUUsT0FBTztvQkFDbEIsV0FBVyxFQUFFLFNBQVM7b0JBQ3RCLGNBQWMsRUFBRSwrQ0FBK0M7b0JBQy9ELFNBQVMsRUFBRSxXQUFXO2lCQUN2QjthQUNGO1NBQ0YsQ0FBQztJQUNKLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBQSxrQkFBUSxFQUFDLGFBQWEsRUFBRSxHQUFHLEVBQUU7UUFDM0IsSUFBQSxZQUFFLEVBQUMsNENBQTRDLEVBQUUsR0FBRyxFQUFFO1lBQ3BELFNBQVMsR0FBRyxJQUFJLHFCQUFxQixFQUFFLENBQUM7WUFDeEMsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBRSxhQUFhLENBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNwRCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLGtEQUFrRCxFQUFFLEdBQUcsRUFBRTtZQUMxRCxTQUFTLEdBQUcsSUFBSSxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUMvQyxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFFLGFBQWEsQ0FBRSxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ25ELENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsbURBQW1ELEVBQUUsR0FBRyxFQUFFO1lBQzNELElBQUEsZ0JBQU0sRUFBQyxHQUFHLEVBQUU7Z0JBQ1YsSUFBSSxDQUFDLEtBQU0sU0FBUSxnREFBMEI7b0JBQzNDLEtBQUssQ0FBQyxVQUFVLEtBQW9CLENBQUM7b0JBQzNCLEtBQUssQ0FBQyxhQUFhLEtBQW9CLENBQUM7b0JBQ3hDLEtBQUssQ0FBQyxtQkFBbUIsS0FBb0IsQ0FBQztpQkFDekQsQ0FBQyxDQUFDLElBQVcsQ0FBQyxDQUFDO1lBQ2xCLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQywyREFBMkQsQ0FBQyxDQUFDO1FBQzFFLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLGtCQUFRLEVBQUMsd0JBQXdCLEVBQUUsR0FBRyxFQUFFO1FBQ3RDLElBQUEsb0JBQVUsRUFBQyxHQUFHLEVBQUU7WUFDZCxTQUFTLEdBQUcsSUFBSSxxQkFBcUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNsRCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLG9EQUFvRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2xFLE1BQU0sU0FBUyxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsRUFBUyxDQUFDLENBQUM7WUFFakQsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNyRCxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLHdCQUF3QixDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzNELElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsZUFBZSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2xELElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFFbkQsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBRSxDQUFDLENBQUUsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDdEUsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBRSxDQUFDLENBQUUsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDeEUsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyxtQ0FBbUMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNqRCxNQUFNLFVBQVUsR0FBYSxFQUFFLE9BQU8sRUFBRSxFQUFFLEVBQUUsQ0FBQztZQUM3QyxNQUFNLFNBQVMsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQVMsQ0FBQyxDQUFDO1lBRS9DLElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDckQsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUM3RCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLGdEQUFnRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzlELHNDQUFzQztZQUN0QyxTQUFTLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEtBQUssVUFBVSxDQUFDLENBQUM7WUFFNUUsTUFBTSxTQUFTLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFTLENBQUMsQ0FBQztZQUVqRCxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3JELElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsa0JBQWtCLENBQUUsQ0FBQyxDQUFFLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3hFLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsdUdBQXVHLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDckgsMkRBQTJEO1lBQzNELFlBQVksQ0FBQyxPQUFPLENBQUUsQ0FBQyxDQUFFLENBQUMsaUJBQWlCLEdBQUc7Z0JBQzVDLGFBQWEsRUFBRSxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRTtnQkFDeEQsUUFBUSxFQUFFLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFO2dCQUNyRCxtRkFBbUY7YUFDcEYsQ0FBQztZQUNGLFlBQVksQ0FBQyxPQUFPLENBQUUsQ0FBQyxDQUFFLENBQUMsaUJBQWlCLEdBQUc7Z0JBQzVDLGFBQWEsRUFBRSxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRTtnQkFDeEQsUUFBUSxFQUFFLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFO2dCQUNyRCxtRkFBbUY7YUFDcEYsQ0FBQztZQUVGLE1BQU0sR0FBRyxHQUFHLGNBQUksQ0FBQyxLQUFLLENBQUMsNEJBQVksRUFBRSxVQUFVLENBQUMsQ0FBQztZQUVqRCxNQUFNLFdBQVcsR0FBRztnQkFDbEIsOEJBQThCLEVBQUUsSUFBSTtnQkFDcEMsWUFBWSxFQUFFLGVBQWU7Z0JBQzdCLGVBQWUsRUFBRSxHQUFHO2dCQUNwQixrQkFBa0IsRUFBRSw4REFBOEQ7Z0JBQ2xGLGVBQWUsRUFBRSxLQUFLO2dCQUN0QixZQUFZLEVBQUUsY0FBYztnQkFDNUIsWUFBWSxFQUFFLGdCQUFnQjtnQkFDOUIsYUFBYSxFQUFFLGlCQUFpQjtnQkFDaEMsd0JBQXdCLEVBQUUsR0FBRyxFQUFFLENBQUMsS0FBSztnQkFDckMsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7Z0JBQ2YsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7Z0JBQ2YsT0FBTyxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7YUFDbkIsQ0FBQztZQUVGLE1BQU0sU0FBUyxDQUFDLGFBQWEsQ0FBQyxZQUFZLEVBQUUsV0FBa0IsQ0FBQyxDQUFDO1lBRWhFLE1BQU0sV0FBVyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBRSxDQUFDLENBQUUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO1lBQ3BGLElBQUEsZ0JBQU0sRUFBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFFckQsTUFBTSxLQUFLLEdBQUcsV0FBVyxDQUFFLENBQUMsQ0FBRSxDQUFFLENBQUMsQ0FBUyxDQUFDO1lBQzNDLE1BQU0sS0FBSyxHQUFHLFdBQVcsQ0FBRSxDQUFDLENBQUUsQ0FBRSxDQUFDLENBQVMsQ0FBQztZQUMzQyxzR0FBc0c7WUFDdEcsSUFBQSxnQkFBTSxFQUFDLENBQUUsS0FBSyxDQUFDLFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBRSxJQUFJLEVBQUUsSUFBSSxDQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUNqRixJQUFBLGdCQUFNLEVBQUMsS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDdkQsSUFBQSxnQkFBTSxFQUFDLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3pELENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLGtCQUFRLEVBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFO1FBQ3JDLElBQUEsb0JBQVUsRUFBQyxHQUFHLEVBQUU7WUFDZCxTQUFTLEdBQUcsSUFBSSxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNqRCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLHNDQUFzQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3BELE1BQU0sU0FBUyxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsRUFBUyxDQUFDLENBQUM7WUFFakQsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNyRCxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLHdCQUF3QixDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzNELElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsZUFBZSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2xELElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFFbkQsTUFBTSxTQUFTLEdBQUcsU0FBUyxDQUFDLHdCQUF3QixDQUFFLENBQUMsQ0FBRSxDQUFDO1lBQzFELElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDbEMsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBRSxDQUFDLENBQUUsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDbkQsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBRSxDQUFDLENBQUUsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDckQsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyxpREFBaUQsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMvRCxNQUFNLFVBQVUsR0FBYSxFQUFFLE9BQU8sRUFBRSxFQUFFLEVBQUUsQ0FBQztZQUM3QyxNQUFNLFNBQVMsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQVMsQ0FBQyxDQUFDO1lBRS9DLElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDckQsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUM3RCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLDhEQUE4RCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzVFLHNDQUFzQztZQUN0QyxTQUFTLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEtBQUssVUFBVSxDQUFDLENBQUM7WUFFNUUsTUFBTSxTQUFTLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFTLENBQUMsQ0FBQztZQUVqRCxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3JELElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDM0QsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyx3QkFBd0IsQ0FBRSxDQUFDLENBQUUsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNoRSxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLHdCQUF3QixDQUFFLENBQUMsQ0FBRSxDQUFFLENBQUMsQ0FBRSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUNuRixDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBQSxrQkFBUSxFQUFDLGVBQWUsRUFBRSxHQUFHLEVBQUU7UUFDN0IsSUFBQSxvQkFBVSxFQUFDLEdBQUcsRUFBRTtZQUNkLFNBQVMsR0FBRyxJQUFJLHFCQUFxQixDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ2xELENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsb0NBQW9DLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDbEQsTUFBTSxhQUFhLEdBQUcsY0FBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsWUFBWSxDQUFDLENBQUM7WUFDMUQsTUFBTSxVQUFVLEdBQUcsY0FBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUUsU0FBUyxDQUFDLENBQUM7WUFFcEQsTUFBTSxXQUFXLEdBQUc7Z0JBQ2xCLDhCQUE4QixFQUFFLElBQUk7Z0JBQ3BDLFlBQVksRUFBRSxlQUFlO2dCQUM3QixlQUFlLEVBQUUsR0FBRztnQkFDcEIsa0JBQWtCLEVBQUUsOERBQThEO2dCQUNsRixlQUFlLEVBQUUsS0FBSztnQkFDdEIsWUFBWSxFQUFFLGlCQUFpQjtnQkFDL0IsWUFBWSxFQUFFLGdCQUFnQjtnQkFDOUIsYUFBYSxFQUFFLGlCQUFpQjtnQkFDaEMsd0JBQXdCLEVBQUUsR0FBRyxFQUFFLENBQUMsS0FBSztnQkFDckMsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7Z0JBQ2YsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7Z0JBQ2YsT0FBTyxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7YUFDbkIsQ0FBQztZQUVGLE1BQU0sU0FBUyxDQUFDLGFBQWEsQ0FBQyxZQUFZLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFFekQsSUFBQSxnQkFBTSxFQUFDLGFBQWEsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLFlBQVksRUFBRSxXQUFXLENBQUMsQ0FBQztZQUN0RSxxRUFBcUU7WUFDckUsSUFBQSxnQkFBTSxFQUFDLFVBQVUsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLFlBQVksRUFBRSxXQUFXLENBQUMsQ0FBQztRQUNyRSxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBQSxrQkFBUSxFQUFDLHNCQUFzQixFQUFFLEdBQUcsRUFBRTtRQUNwQyxJQUFBLFlBQUUsRUFBQyw2Q0FBNkMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMzRCxTQUFTLEdBQUcsSUFBSSxxQkFBcUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUNoRCxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFFN0IsTUFBTSxTQUFTLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFTLENBQUMsQ0FBQztZQUVqRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDM0IsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLFNBQVMsQ0FBQztZQUVyQyw4REFBOEQ7WUFDOUQsSUFBQSxnQkFBTSxFQUFDLFFBQVEsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzNDLElBQUEsZ0JBQU0sRUFBQyxRQUFRLENBQUMsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7WUFFcEMsdURBQXVEO1lBQ3ZELElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdkQsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyw0Q0FBNEMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMxRCxTQUFTLEdBQUcsSUFBSSxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUMvQyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFFN0IsTUFBTSxTQUFTLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFTLENBQUMsQ0FBQztZQUVqRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDM0IsTUFBTSxRQUFRLEdBQUcsT0FBTyxHQUFHLFNBQVMsQ0FBQztZQUVyQyw4REFBOEQ7WUFDOUQsSUFBQSxnQkFBTSxFQUFDLFFBQVEsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzNDLElBQUEsZ0JBQU0sRUFBQyxRQUFRLENBQUMsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7WUFFcEMsOENBQThDO1lBQzlDLElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDM0QsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyx3QkFBd0IsQ0FBRSxDQUFDLENBQUUsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNsRSxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBCYXNlU1FTRXZlbnRQcm9jZXNzb3IgfSBmcm9tICcuL2Jhc2Utc3FzLWV2ZW50LXByb2Nlc3Nvcic7XG5pbXBvcnQgeyBCYXNlRXZlbnRSZWNvcmQsIElFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tICcuLi8uLi90eXBlcy9ldmVudC1wcm9jZXNzb3ItdHlwZXMnO1xuaW1wb3J0IHsgU1FTRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IGRlc2NyaWJlLCBleHBlY3QsIGl0LCBqZXN0LCBiZWZvcmVFYWNoIH0gZnJvbSAnQGplc3QvZ2xvYmFscyc7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIgfSBmcm9tICcuLi8uLi8uLi9vYnNlcnZhYmlsaXR5JztcblxuLy8gTW9jayBpbXBsZW1lbnRhdGlvbiBmb3IgdGVzdGluZ1xuY2xhc3MgTW9ja0V2ZW50RGF0YUV4dHJhY3RvciBpbXBsZW1lbnRzIElFdmVudERhdGFFeHRyYWN0b3I8U1FTRXZlbnQsIGFueT4ge1xuICBleHRyYWN0RGF0YShldmVudDogU1FTRXZlbnQpOiBCYXNlRXZlbnRSZWNvcmQ8YW55PltdIHtcbiAgICByZXR1cm4gZXZlbnQuUmVjb3Jkcy5tYXAoKHJlY29yZCwgaW5kZXgpID0+ICh7XG4gICAgICBldmVudElkOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgZXZlbnRUeXBlOiAndXBkYXRlJyxcbiAgICAgIGVudGl0eU5hbWU6IGBlbnRpdHktJHtpbmRleH1gLFxuICAgICAgZW50aXR5SWQ6IGBpZC0ke2luZGV4fWAsXG4gICAgICBwYXlsb2FkOiB7IGRhdGE6IGBwYXlsb2FkLSR7aW5kZXh9YCB9LFxuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgZXZlbnRTb3VyY2U6IHJlY29yZC5ldmVudFNvdXJjZVxuICAgIH0pKTtcbiAgfVxufVxuXG5jbGFzcyBUZXN0U1FTRXZlbnRQcm9jZXNzb3IgZXh0ZW5kcyBCYXNlU1FTRXZlbnRQcm9jZXNzb3I8TW9ja0V2ZW50RGF0YUV4dHJhY3Rvcj4ge1xuICBwdWJsaWMgcHJvY2Vzc1JlY29yZENhbGxzOiBCYXNlRXZlbnRSZWNvcmQ8YW55PltdID0gW107XG4gIHB1YmxpYyBwcm9jZXNzUmVjb3Jkc0JhdGNoQ2FsbHM6IEJhc2VFdmVudFJlY29yZDxhbnk+W11bXSA9IFtdO1xuICBwdWJsaWMgcHJlcHJvY2Vzc0NhbGxzOiBCYXNlRXZlbnRSZWNvcmQ8YW55PltdID0gW107XG4gIHB1YmxpYyBwb3N0cHJvY2Vzc0NhbGxzOiBCYXNlRXZlbnRSZWNvcmQ8YW55PltdID0gW107XG5cbiAgY29uc3RydWN0b3IocHJvY2Vzc01vZGU6ICdyZWNvcmQnIHwgJ2JhdGNoJyA9ICdyZWNvcmQnKSB7XG4gICAgc3VwZXIobmV3IE1vY2tFdmVudERhdGFFeHRyYWN0b3IoKSwgeyBwcm9jZXNzTW9kZSB9KTtcbiAgfVxuXG4gIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBhbnksIF9jb250ZXh0OiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBNb2NrIGltcGxlbWVudGF0aW9uXG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxhbnk+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5wcm9jZXNzUmVjb3JkQ2FsbHMucHVzaChyZWNvcmQpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByb2Nlc3NSZWNvcmRzQmF0Y2gocmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPGFueT5bXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMucHJvY2Vzc1JlY29yZHNCYXRjaENhbGxzLnB1c2gocmVjb3Jkcyk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJlcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxhbnk+KTogUHJvbWlzZTxCYXNlRXZlbnRSZWNvcmQ8YW55PiB8IG51bGw+IHtcbiAgICB0aGlzLnByZXByb2Nlc3NDYWxscy5wdXNoKHJlY29yZCk7XG4gICAgcmV0dXJuIHJlY29yZDsgLy8gQWNjZXB0IGFsbCByZWNvcmRzXG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcG9zdHByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8YW55Pik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMucG9zdHByb2Nlc3NDYWxscy5wdXNoKHJlY29yZCk7XG4gIH1cblxuICAvLyBQdWJsaWMgbWV0aG9kIHRvIG92ZXJyaWRlIHByZXByb2Nlc3NSZWNvcmQgZm9yIHRlc3RpbmdcbiAgcHVibGljIHNldFByZXByb2Nlc3NGaWx0ZXIoZmlsdGVyOiAocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8YW55PikgPT4gYm9vbGVhbikge1xuICAgIHRoaXMucHJlcHJvY2Vzc1JlY29yZCA9IGFzeW5jIChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxhbnk+KSA9PiB7XG4gICAgICB0aGlzLnByZXByb2Nlc3NDYWxscy5wdXNoKHJlY29yZCk7XG4gICAgICByZXR1cm4gZmlsdGVyKHJlY29yZCkgPyByZWNvcmQgOiBudWxsO1xuICAgIH07XG4gIH1cbn1cblxuZGVzY3JpYmUoJ0Jhc2VTUVNFdmVudFByb2Nlc3NvcicsICgpID0+IHtcbiAgbGV0IHByb2Nlc3NvcjogVGVzdFNRU0V2ZW50UHJvY2Vzc29yO1xuICBsZXQgbW9ja1NRU0V2ZW50OiBTUVNFdmVudDtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBtb2NrU1FTRXZlbnQgPSB7XG4gICAgICBSZWNvcmRzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBtZXNzYWdlSWQ6ICdtc2ctMScsXG4gICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3JlY2VpcHQtMScsXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhOiAndGVzdDEnLCBlbnRpdHlOYW1lOiAnZW50aXR5MScgfSksXG4gICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcbiAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJyxcbiAgICAgICAgICAgIFNlbmRlcklkOiAnc2VuZGVyLTEnLFxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXM6IHt9LFxuICAgICAgICAgIG1kNU9mQm9keTogJ21kNS0xJyxcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxuICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBtZXNzYWdlSWQ6ICdtc2ctMicsXG4gICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3JlY2VpcHQtMicsXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhOiAndGVzdDInLCBlbnRpdHlOYW1lOiAnZW50aXR5MicgfSksXG4gICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcbiAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJyxcbiAgICAgICAgICAgIFNlbmRlcklkOiAnc2VuZGVyLTInLFxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXM6IHt9LFxuICAgICAgICAgIG1kNU9mQm9keTogJ21kNS0yJyxcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxuICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXG4gICAgICAgIH1cbiAgICAgIF1cbiAgICB9O1xuICB9KTtcblxuICBkZXNjcmliZSgnQ29uc3RydWN0b3InLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBpbml0aWFsaXplIHdpdGggZGVmYXVsdCByZWNvcmQgbW9kZScsICgpID0+IHtcbiAgICAgIHByb2Nlc3NvciA9IG5ldyBUZXN0U1FTRXZlbnRQcm9jZXNzb3IoKTtcbiAgICAgIGV4cGVjdChwcm9jZXNzb3JbICdwcm9jZXNzTW9kZScgXSkudG9CZSgncmVjb3JkJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGluaXRpYWxpemUgd2l0aCBiYXRjaCBtb2RlIHdoZW4gc3BlY2lmaWVkJywgKCkgPT4ge1xuICAgICAgcHJvY2Vzc29yID0gbmV3IFRlc3RTUVNFdmVudFByb2Nlc3NvcignYmF0Y2gnKTtcbiAgICAgIGV4cGVjdChwcm9jZXNzb3JbICdwcm9jZXNzTW9kZScgXSkudG9CZSgnYmF0Y2gnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdGhyb3cgZXJyb3Igd2hlbiBleHRyYWN0b3IgaXMgbm90IHByb3ZpZGVkJywgKCkgPT4ge1xuICAgICAgZXhwZWN0KCgpID0+IHtcbiAgICAgICAgbmV3IChjbGFzcyBleHRlbmRzIEJhc2VTUVNFdmVudFByb2Nlc3Nvcjxhbnk+IHtcbiAgICAgICAgICBhc3luYyBpbml0aWFsaXplKCk6IFByb21pc2U8dm9pZD4geyB9XG4gICAgICAgICAgcHJvdGVjdGVkIGFzeW5jIHByb2Nlc3NSZWNvcmQoKTogUHJvbWlzZTx2b2lkPiB7IH1cbiAgICAgICAgICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZHNCYXRjaCgpOiBQcm9taXNlPHZvaWQ+IHsgfVxuICAgICAgICB9KShudWxsIGFzIGFueSk7XG4gICAgICB9KS50b1Rocm93KCdJRXZlbnREYXRhRXh0cmFjdG9yIGlzIHJlcXVpcmVkIGZvciBCYXNlU1FTRXZlbnRQcm9jZXNzb3InKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1JlY29yZCBNb2RlIFByb2Nlc3NpbmcnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICBwcm9jZXNzb3IgPSBuZXcgVGVzdFNRU0V2ZW50UHJvY2Vzc29yKCdyZWNvcmQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJvY2VzcyByZWNvcmRzIGluZGl2aWR1YWxseSBpbiByZWNvcmQgbW9kZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHByb2Nlc3Nvci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgZXhwZWN0KHByb2Nlc3Nvci5wcm9jZXNzUmVjb3JkQ2FsbHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGV4cGVjdChwcm9jZXNzb3IucHJvY2Vzc1JlY29yZHNCYXRjaENhbGxzKS50b0hhdmVMZW5ndGgoMCk7XG4gICAgICBleHBlY3QocHJvY2Vzc29yLnByZXByb2Nlc3NDYWxscykudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgZXhwZWN0KHByb2Nlc3Nvci5wb3N0cHJvY2Vzc0NhbGxzKS50b0hhdmVMZW5ndGgoMik7XG5cbiAgICAgIGV4cGVjdChwcm9jZXNzb3IucHJvY2Vzc1JlY29yZENhbGxzWyAwIF0uZW50aXR5TmFtZSkudG9CZSgnZW50aXR5LTAnKTtcbiAgICAgIGV4cGVjdChwcm9jZXNzb3IucHJvY2Vzc1JlY29yZENhbGxzWyAxIF0uZW50aXR5TmFtZSkudG9CZSgnZW50aXR5LTEnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IHJlY29yZHMgYXJyYXknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBlbXB0eUV2ZW50OiBTUVNFdmVudCA9IHsgUmVjb3JkczogW10gfTtcbiAgICAgIGF3YWl0IHByb2Nlc3Nvci5wcm9jZXNzKGVtcHR5RXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIGV4cGVjdChwcm9jZXNzb3IucHJvY2Vzc1JlY29yZENhbGxzKS50b0hhdmVMZW5ndGgoMCk7XG4gICAgICBleHBlY3QocHJvY2Vzc29yLnByb2Nlc3NSZWNvcmRzQmF0Y2hDYWxscykudG9IYXZlTGVuZ3RoKDApO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgb3V0IHJlY29yZHMgZHVyaW5nIHByZXByb2Nlc3NpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBVc2UgdGhlIHB1YmxpYyBtZXRob2QgdG8gc2V0IGZpbHRlclxuICAgICAgcHJvY2Vzc29yLnNldFByZXByb2Nlc3NGaWx0ZXIoKHJlY29yZCkgPT4gcmVjb3JkLmVudGl0eU5hbWUgPT09ICdlbnRpdHktMCcpO1xuXG4gICAgICBhd2FpdCBwcm9jZXNzb3IucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIGV4cGVjdChwcm9jZXNzb3IucHJvY2Vzc1JlY29yZENhbGxzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QocHJvY2Vzc29yLnByb2Nlc3NSZWNvcmRDYWxsc1sgMCBdLmVudGl0eU5hbWUpLnRvQmUoJ2VudGl0eS0wJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhvbm9yIHBlci1yZWNvcmQgdHJhY2UgY29udGV4dCAobWl4ZWQgYmF0Y2gpIGJ5IHNldHRpbmcgY2F1c2VkQnkgcGVyIHJlY29yZCAobm8gcmVtb3RlIHBhcmVudCknLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBBcnJhbmdlIG1peGVkIHVwc3RyZWFtIHRyYWNlIGluZm8gdmlhIG1lc3NhZ2UgYXR0cmlidXRlc1xuICAgICAgbW9ja1NRU0V2ZW50LlJlY29yZHNbIDAgXS5tZXNzYWdlQXR0cmlidXRlcyA9IHtcbiAgICAgICAgY29ycmVsYXRpb25JZDogeyBzdHJpbmdWYWx1ZTogJ2MxJywgZGF0YVR5cGU6ICdTdHJpbmcnIH0sXG4gICAgICAgIGNhdXNlZEJ5OiB7IHN0cmluZ1ZhbHVlOiAncm9vdCcsIGRhdGFUeXBlOiAnU3RyaW5nJyB9LFxuICAgICAgICAvLyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgaXMgbm90IHByb3BhZ2F0ZWQgYWNyb3NzIGhvcHMgdW5kZXIgdGhlIHN0cmljdCBjb250cmFjdFxuICAgICAgfTtcbiAgICAgIG1vY2tTUVNFdmVudC5SZWNvcmRzWyAxIF0ubWVzc2FnZUF0dHJpYnV0ZXMgPSB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IHsgc3RyaW5nVmFsdWU6ICdjMicsIGRhdGFUeXBlOiAnU3RyaW5nJyB9LFxuICAgICAgICBjYXVzZWRCeTogeyBzdHJpbmdWYWx1ZTogJ3Jvb3QnLCBkYXRhVHlwZTogJ1N0cmluZycgfSxcbiAgICAgICAgLy8gcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGlzIG5vdCBwcm9wYWdhdGVkIGFjcm9zcyBob3BzIHVuZGVyIHRoZSBzdHJpY3QgY29udHJhY3RcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNweSA9IGplc3Quc3B5T24oU3Bhbk9ic2VydmVyLCAnd2l0aFNwYW4nKTtcblxuICAgICAgY29uc3QgbW9ja0NvbnRleHQgPSB7XG4gICAgICAgIGNhbGxiYWNrV2FpdHNGb3JFbXB0eUV2ZW50TG9vcDogdHJ1ZSxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiAndGVzdC1mdW5jdGlvbicsXG4gICAgICAgIGZ1bmN0aW9uVmVyc2lvbjogJzEnLFxuICAgICAgICBpbnZva2VkRnVuY3Rpb25Bcm46ICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmZ1bmN0aW9uOnRlc3QtZnVuY3Rpb24nLFxuICAgICAgICBtZW1vcnlMaW1pdEluTUI6ICcxMjgnLFxuICAgICAgICBhd3NSZXF1ZXN0SWQ6ICdpbnZvY2F0aW9uLTEnLFxuICAgICAgICBsb2dHcm91cE5hbWU6ICd0ZXN0LWxvZy1ncm91cCcsXG4gICAgICAgIGxvZ1N0cmVhbU5hbWU6ICd0ZXN0LWxvZy1zdHJlYW0nLFxuICAgICAgICBnZXRSZW1haW5pbmdUaW1lSW5NaWxsaXM6ICgpID0+IDMwMDAwLFxuICAgICAgICBkb25lOiAoKSA9PiB7IH0sXG4gICAgICAgIGZhaWw6ICgpID0+IHsgfSxcbiAgICAgICAgc3VjY2VlZDogKCkgPT4geyB9XG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBwcm9jZXNzb3IuTGFtYmRhSGFuZGxlcihtb2NrU1FTRXZlbnQsIG1vY2tDb250ZXh0IGFzIGFueSk7XG5cbiAgICAgIGNvbnN0IHJlY29yZENhbGxzID0gc3B5Lm1vY2suY2FsbHMuZmlsdGVyKChjKSA9PiBTdHJpbmcoY1sgMCBdKS5pbmNsdWRlcygncmVjb3JkJykpO1xuICAgICAgZXhwZWN0KHJlY29yZENhbGxzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgyKTtcblxuICAgICAgY29uc3Qgb3B0czAgPSByZWNvcmRDYWxsc1sgMCBdWyAyIF0gYXMgYW55O1xuICAgICAgY29uc3Qgb3B0czEgPSByZWNvcmRDYWxsc1sgMSBdWyAyIF0gYXMgYW55O1xuICAgICAgLy8gSW4gc3RyaWN0LWhpZXJhcmNoeSBtb2RlLCBjb3JyZWxhdGlvbklkIGlzIHBlci1pbnZvY2F0aW9uOyB1cHN0cmVhbSBjb3JyZWxhdGlvbklkIGJlY29tZXMgY2F1c2VkQnkuXG4gICAgICBleHBlY3QoWyBvcHRzMC5jYXVzZWRCeSwgb3B0czEuY2F1c2VkQnkgXS5zb3J0KCkpLnRvRXF1YWwoWyAnYzEnLCAnYzInIF0uc29ydCgpKTtcbiAgICAgIGV4cGVjdChvcHRzMC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChvcHRzMS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0JhdGNoIE1vZGUgUHJvY2Vzc2luZycsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIHByb2Nlc3NvciA9IG5ldyBUZXN0U1FTRXZlbnRQcm9jZXNzb3IoJ2JhdGNoJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByb2Nlc3MgcmVjb3JkcyBpbiBiYXRjaCBtb2RlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgcHJvY2Vzc29yLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICBleHBlY3QocHJvY2Vzc29yLnByb2Nlc3NSZWNvcmRDYWxscykudG9IYXZlTGVuZ3RoKDApO1xuICAgICAgZXhwZWN0KHByb2Nlc3Nvci5wcm9jZXNzUmVjb3Jkc0JhdGNoQ2FsbHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChwcm9jZXNzb3IucHJlcHJvY2Vzc0NhbGxzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QocHJvY2Vzc29yLnBvc3Rwcm9jZXNzQ2FsbHMpLnRvSGF2ZUxlbmd0aCgyKTtcblxuICAgICAgY29uc3QgYmF0Y2hDYWxsID0gcHJvY2Vzc29yLnByb2Nlc3NSZWNvcmRzQmF0Y2hDYWxsc1sgMCBdO1xuICAgICAgZXhwZWN0KGJhdGNoQ2FsbCkudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgZXhwZWN0KGJhdGNoQ2FsbFsgMCBdLmVudGl0eU5hbWUpLnRvQmUoJ2VudGl0eS0wJyk7XG4gICAgICBleHBlY3QoYmF0Y2hDYWxsWyAxIF0uZW50aXR5TmFtZSkudG9CZSgnZW50aXR5LTEnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IHJlY29yZHMgYXJyYXkgaW4gYmF0Y2ggbW9kZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGVtcHR5RXZlbnQ6IFNRU0V2ZW50ID0geyBSZWNvcmRzOiBbXSB9O1xuICAgICAgYXdhaXQgcHJvY2Vzc29yLnByb2Nlc3MoZW1wdHlFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgZXhwZWN0KHByb2Nlc3Nvci5wcm9jZXNzUmVjb3JkQ2FsbHMpLnRvSGF2ZUxlbmd0aCgwKTtcbiAgICAgIGV4cGVjdChwcm9jZXNzb3IucHJvY2Vzc1JlY29yZHNCYXRjaENhbGxzKS50b0hhdmVMZW5ndGgoMCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciBvdXQgcmVjb3JkcyBkdXJpbmcgcHJlcHJvY2Vzc2luZyBpbiBiYXRjaCBtb2RlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gVXNlIHRoZSBwdWJsaWMgbWV0aG9kIHRvIHNldCBmaWx0ZXJcbiAgICAgIHByb2Nlc3Nvci5zZXRQcmVwcm9jZXNzRmlsdGVyKChyZWNvcmQpID0+IHJlY29yZC5lbnRpdHlOYW1lID09PSAnZW50aXR5LTAnKTtcblxuICAgICAgYXdhaXQgcHJvY2Vzc29yLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICBleHBlY3QocHJvY2Vzc29yLnByb2Nlc3NSZWNvcmRDYWxscykudG9IYXZlTGVuZ3RoKDApO1xuICAgICAgZXhwZWN0KHByb2Nlc3Nvci5wcm9jZXNzUmVjb3Jkc0JhdGNoQ2FsbHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChwcm9jZXNzb3IucHJvY2Vzc1JlY29yZHNCYXRjaENhbGxzWyAwIF0pLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChwcm9jZXNzb3IucHJvY2Vzc1JlY29yZHNCYXRjaENhbGxzWyAwIF1bIDAgXS5lbnRpdHlOYW1lKS50b0JlKCdlbnRpdHktMCcpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnTGFtYmRhSGFuZGxlcicsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIHByb2Nlc3NvciA9IG5ldyBUZXN0U1FTRXZlbnRQcm9jZXNzb3IoJ3JlY29yZCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjYWxsIGluaXRpYWxpemUgYW5kIHByb2Nlc3MnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBpbml0aWFsaXplU3B5ID0gamVzdC5zcHlPbihwcm9jZXNzb3IsICdpbml0aWFsaXplJyk7XG4gICAgICBjb25zdCBwcm9jZXNzU3B5ID0gamVzdC5zcHlPbihwcm9jZXNzb3IsICdwcm9jZXNzJyk7XG5cbiAgICAgIGNvbnN0IG1vY2tDb250ZXh0ID0ge1xuICAgICAgICBjYWxsYmFja1dhaXRzRm9yRW1wdHlFdmVudExvb3A6IHRydWUsXG4gICAgICAgIGZ1bmN0aW9uTmFtZTogJ3Rlc3QtZnVuY3Rpb24nLFxuICAgICAgICBmdW5jdGlvblZlcnNpb246ICcxJyxcbiAgICAgICAgaW52b2tlZEZ1bmN0aW9uQXJuOiAnYXJuOmF3czpsYW1iZGE6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjpmdW5jdGlvbjp0ZXN0LWZ1bmN0aW9uJyxcbiAgICAgICAgbWVtb3J5TGltaXRJbk1COiAnMTI4JyxcbiAgICAgICAgYXdzUmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0LWlkJyxcbiAgICAgICAgbG9nR3JvdXBOYW1lOiAndGVzdC1sb2ctZ3JvdXAnLFxuICAgICAgICBsb2dTdHJlYW1OYW1lOiAndGVzdC1sb2ctc3RyZWFtJyxcbiAgICAgICAgZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzOiAoKSA9PiAzMDAwMCxcbiAgICAgICAgZG9uZTogKCkgPT4geyB9LFxuICAgICAgICBmYWlsOiAoKSA9PiB7IH0sXG4gICAgICAgIHN1Y2NlZWQ6ICgpID0+IHsgfVxuICAgICAgfTtcblxuICAgICAgYXdhaXQgcHJvY2Vzc29yLkxhbWJkYUhhbmRsZXIobW9ja1NRU0V2ZW50LCBtb2NrQ29udGV4dCk7XG5cbiAgICAgIGV4cGVjdChpbml0aWFsaXplU3B5KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChtb2NrU1FTRXZlbnQsIG1vY2tDb250ZXh0KTtcbiAgICAgIC8vIEJhc2VTUVNFdmVudFByb2Nlc3NvciBjYWxscyBwcm9jZXNzKGV2ZW50LCBjb250ZXh0KSAobm8gdGhpcmQgYXJnKVxuICAgICAgZXhwZWN0KHByb2Nlc3NTcHkpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKG1vY2tTUVNFdmVudCwgbW9ja0NvbnRleHQpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnUGVyZm9ybWFuY2UgVHJhY2tpbmcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCB0cmFjayBwcm9jZXNzaW5nIHRpbWUgaW4gcmVjb3JkIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBwcm9jZXNzb3IgPSBuZXcgVGVzdFNRU0V2ZW50UHJvY2Vzc29yKCdyZWNvcmQnKTtcbiAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAgIGF3YWl0IHByb2Nlc3Nvci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgY29uc3QgZW5kVGltZSA9IERhdGUubm93KCk7XG4gICAgICBjb25zdCBkdXJhdGlvbiA9IGVuZFRpbWUgLSBzdGFydFRpbWU7XG5cbiAgICAgIC8vIFNob3VsZCBjb21wbGV0ZSB3aXRoaW4gcmVhc29uYWJsZSB0aW1lIChsZXNzIHRoYW4gMSBzZWNvbmQpXG4gICAgICBleHBlY3QoZHVyYXRpb24pLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMCk7XG4gICAgICBleHBlY3QoZHVyYXRpb24pLnRvQmVMZXNzVGhhbigxMDAwKTtcblxuICAgICAgLy8gU2hvdWxkIGhhdmUgcHJvY2Vzc2VkIHRoZSBleHBlY3RlZCBudW1iZXIgb2YgcmVjb3Jkc1xuICAgICAgZXhwZWN0KHByb2Nlc3Nvci5wcm9jZXNzUmVjb3JkQ2FsbHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdHJhY2sgcHJvY2Vzc2luZyB0aW1lIGluIGJhdGNoIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBwcm9jZXNzb3IgPSBuZXcgVGVzdFNRU0V2ZW50UHJvY2Vzc29yKCdiYXRjaCcpO1xuICAgICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgICAgYXdhaXQgcHJvY2Vzc29yLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICBjb25zdCBlbmRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICAgIGNvbnN0IGR1cmF0aW9uID0gZW5kVGltZSAtIHN0YXJ0VGltZTtcblxuICAgICAgLy8gU2hvdWxkIGNvbXBsZXRlIHdpdGhpbiByZWFzb25hYmxlIHRpbWUgKGxlc3MgdGhhbiAxIHNlY29uZClcbiAgICAgIGV4cGVjdChkdXJhdGlvbikudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgwKTtcbiAgICAgIGV4cGVjdChkdXJhdGlvbikudG9CZUxlc3NUaGFuKDEwMDApO1xuXG4gICAgICAvLyBTaG91bGQgaGF2ZSBwcm9jZXNzZWQgcmVjb3JkcyBpbiBiYXRjaCBtb2RlXG4gICAgICBleHBlY3QocHJvY2Vzc29yLnByb2Nlc3NSZWNvcmRzQmF0Y2hDYWxscykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KHByb2Nlc3Nvci5wcm9jZXNzUmVjb3Jkc0JhdGNoQ2FsbHNbIDAgXSkudG9IYXZlTGVuZ3RoKDIpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19