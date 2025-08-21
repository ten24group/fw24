"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HybridSearchEventExtractor = void 0;
const logging_1 = require("../../logging");
const dynamodb_event_data_extractor_1 = require("../../core/runtime/event-processor/dynamodb-event-data-extractor");
/**
 * Hybrid event data extractor that can handle both:
 * 1. DynamoDB stream events (via SQS/SNS) - delegates to DynamoDBEventDataExtractor
 * 2. Direct resync events from search controller
 */
class HybridSearchEventExtractor {
    logger = (0, logging_1.createLogger)('HybridSearchEventExtractor');
    dynamoExtractor = new dynamodb_event_data_extractor_1.DynamoDBEventDataExtractor();
    extractData(event) {
        const records = [];
        for (const sqsRecord of event.Records) {
            const body = JSON.parse(sqsRecord.body);
            // Check if this is a resync message (direct from search controller)
            if (body.eventName === 'RESYNC') {
                records.push(...this.extractResyncRecords(sqsRecord, body));
            }
            else {
                // This should be a DynamoDB stream event from SNS
                records.push(...this.extractDynamoStreamRecords(sqsRecord));
            }
        }
        return records;
    }
    extractResyncRecords(sqsRecord, body) {
        const { data: rawPayload, entityName } = body;
        const entityId = Array.isArray(rawPayload)
            ? undefined
            : (rawPayload?.id || rawPayload?.[`${entityName}Id`]);
        return [{
                eventId: sqsRecord.messageId,
                eventType: 'update',
                timestamp: Date.now(),
                eventSource: sqsRecord.eventSource,
                payload: rawPayload,
                entityId,
                entityName,
                metadata: {
                    source: 'resync'
                }
            }];
    }
    extractDynamoStreamRecords(sqsRecord) {
        // Create a temporary SQS event for the DynamoDB extractor
        const tempSQSEvent = { Records: [sqsRecord] };
        const dynamoRecords = this.dynamoExtractor.extractData(tempSQSEvent);
        // For stream records, we pass the changeStreamPayload through so the base class can process it
        return dynamoRecords.map(record => {
            const { payload } = record;
            return {
                ...record,
                payload: payload, // Keep the full ChangeStreamPayload
                metadata: {
                    ...record.metadata,
                    source: 'stream'
                }
            };
        });
    }
}
exports.HybridSearchEventExtractor = HybridSearchEventExtractor;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaHlicmlkLXNlYXJjaC1ldmVudC1leHRyYWN0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL2luZGV4ZXIvaHlicmlkLXNlYXJjaC1ldmVudC1leHRyYWN0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRUEsMkNBQTZDO0FBQzdDLG9IQUE4RztBQUU5Rzs7OztHQUlHO0FBQ0gsTUFBYSwwQkFBMEI7SUFDcEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyw0QkFBNEIsQ0FBQyxDQUFDO0lBQ3BELGVBQWUsR0FBRyxJQUFJLDBEQUEwQixFQUFFLENBQUM7SUFFN0QsV0FBVyxDQUFDLEtBQWU7UUFDaEMsTUFBTSxPQUFPLEdBQTJDLEVBQUUsQ0FBQztRQUUzRCxLQUFLLE1BQU0sU0FBUyxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0QyxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUV4QyxvRUFBb0U7WUFDcEUsSUFBSSxJQUFJLENBQUMsU0FBUyxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUNoQyxPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQzlELENBQUM7aUJBQU0sQ0FBQztnQkFDTixrREFBa0Q7Z0JBQ2xELE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsMEJBQTBCLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztZQUM5RCxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sT0FBTyxDQUFDO0lBQ2pCLENBQUM7SUFFTyxvQkFBb0IsQ0FBQyxTQUFjLEVBQUUsSUFBUztRQUNwRCxNQUFNLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsR0FBRyxJQUF5QyxDQUFDO1FBRW5GLE1BQU0sUUFBUSxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDO1lBQ3hDLENBQUMsQ0FBQyxTQUFTO1lBQ1gsQ0FBQyxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUUsSUFBSSxVQUFVLEVBQUUsQ0FBQyxHQUFHLFVBQVUsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUV4RCxPQUFPLENBQUM7Z0JBQ04sT0FBTyxFQUFFLFNBQVMsQ0FBQyxTQUFTO2dCQUM1QixTQUFTLEVBQUUsUUFBUTtnQkFDbkIsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7Z0JBQ3JCLFdBQVcsRUFBRSxTQUFTLENBQUMsV0FBVztnQkFDbEMsT0FBTyxFQUFFLFVBQVU7Z0JBQ25CLFFBQVE7Z0JBQ1IsVUFBVTtnQkFDVixRQUFRLEVBQUU7b0JBQ1IsTUFBTSxFQUFFLFFBQVE7aUJBQ2pCO2FBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVPLDBCQUEwQixDQUFDLFNBQWM7UUFDL0MsMERBQTBEO1FBQzFELE1BQU0sWUFBWSxHQUFhLEVBQUUsT0FBTyxFQUFFLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztRQUN4RCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLFdBQVcsQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUVyRSwrRkFBK0Y7UUFDL0YsT0FBTyxhQUFhLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFO1lBQ2hDLE1BQU0sRUFBRSxPQUFPLEVBQUUsR0FBRyxNQUE4QyxDQUFDO1lBQ25FLE9BQU87Z0JBQ0wsR0FBRyxNQUFNO2dCQUNULE9BQU8sRUFBRSxPQUFPLEVBQUUsb0NBQW9DO2dCQUN0RCxRQUFRLEVBQUU7b0JBQ1IsR0FBRyxNQUFNLENBQUMsUUFBUTtvQkFDbEIsTUFBTSxFQUFFLFFBQVE7aUJBQ2pCO2FBQ3NDLENBQUM7UUFDNUMsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUE3REQsZ0VBNkRDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU1FTRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCwgQ2hhbmdlU3RyZWFtUGF5bG9hZCwgSUV2ZW50RGF0YUV4dHJhY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgRHluYW1vREJFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXZlbnQtcHJvY2Vzc29yL2R5bmFtb2RiLWV2ZW50LWRhdGEtZXh0cmFjdG9yJztcblxuLyoqXG4gKiBIeWJyaWQgZXZlbnQgZGF0YSBleHRyYWN0b3IgdGhhdCBjYW4gaGFuZGxlIGJvdGg6XG4gKiAxLiBEeW5hbW9EQiBzdHJlYW0gZXZlbnRzICh2aWEgU1FTL1NOUykgLSBkZWxlZ2F0ZXMgdG8gRHluYW1vREJFdmVudERhdGFFeHRyYWN0b3JcbiAqIDIuIERpcmVjdCByZXN5bmMgZXZlbnRzIGZyb20gc2VhcmNoIGNvbnRyb2xsZXJcbiAqL1xuZXhwb3J0IGNsYXNzIEh5YnJpZFNlYXJjaEV2ZW50RXh0cmFjdG9yIGltcGxlbWVudHMgSUV2ZW50RGF0YUV4dHJhY3RvcjxTUVNFdmVudCwgUmVjb3JkPHN0cmluZywgYW55Pj4ge1xuICBwcml2YXRlIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignSHlicmlkU2VhcmNoRXZlbnRFeHRyYWN0b3InKTtcbiAgcHJpdmF0ZSByZWFkb25seSBkeW5hbW9FeHRyYWN0b3IgPSBuZXcgRHluYW1vREJFdmVudERhdGFFeHRyYWN0b3IoKTtcblxuICBwdWJsaWMgZXh0cmFjdERhdGEoZXZlbnQ6IFNRU0V2ZW50KTogQmFzZUV2ZW50UmVjb3JkPFJlY29yZDxzdHJpbmcsIGFueT4+W10ge1xuICAgIGNvbnN0IHJlY29yZHM6IEJhc2VFdmVudFJlY29yZDxSZWNvcmQ8c3RyaW5nLCBhbnk+PltdID0gW107XG4gICAgXG4gICAgZm9yIChjb25zdCBzcXNSZWNvcmQgb2YgZXZlbnQuUmVjb3Jkcykge1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2Uoc3FzUmVjb3JkLmJvZHkpO1xuICAgICAgXG4gICAgICAvLyBDaGVjayBpZiB0aGlzIGlzIGEgcmVzeW5jIG1lc3NhZ2UgKGRpcmVjdCBmcm9tIHNlYXJjaCBjb250cm9sbGVyKVxuICAgICAgaWYgKGJvZHkuZXZlbnROYW1lID09PSAnUkVTWU5DJykge1xuICAgICAgICByZWNvcmRzLnB1c2goLi4udGhpcy5leHRyYWN0UmVzeW5jUmVjb3JkcyhzcXNSZWNvcmQsIGJvZHkpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFRoaXMgc2hvdWxkIGJlIGEgRHluYW1vREIgc3RyZWFtIGV2ZW50IGZyb20gU05TXG4gICAgICAgIHJlY29yZHMucHVzaCguLi50aGlzLmV4dHJhY3REeW5hbW9TdHJlYW1SZWNvcmRzKHNxc1JlY29yZCkpO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gcmVjb3JkcztcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdFJlc3luY1JlY29yZHMoc3FzUmVjb3JkOiBhbnksIGJvZHk6IGFueSk6IEJhc2VFdmVudFJlY29yZDxSZWNvcmQ8c3RyaW5nLCBhbnk+PltdIHtcbiAgICBjb25zdCB7IGRhdGE6IHJhd1BheWxvYWQsIGVudGl0eU5hbWUgfSA9IGJvZHkgYXMgeyBkYXRhOiBhbnksIGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgIFxuICAgIGNvbnN0IGVudGl0eUlkID0gQXJyYXkuaXNBcnJheShyYXdQYXlsb2FkKVxuICAgICAgPyB1bmRlZmluZWRcbiAgICAgIDogKHJhd1BheWxvYWQ/LmlkIHx8IHJhd1BheWxvYWQ/LltgJHtlbnRpdHlOYW1lfUlkYF0pO1xuXG4gICAgcmV0dXJuIFt7XG4gICAgICBldmVudElkOiBzcXNSZWNvcmQubWVzc2FnZUlkLFxuICAgICAgZXZlbnRUeXBlOiAndXBkYXRlJyxcbiAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgIGV2ZW50U291cmNlOiBzcXNSZWNvcmQuZXZlbnRTb3VyY2UsXG4gICAgICBwYXlsb2FkOiByYXdQYXlsb2FkLFxuICAgICAgZW50aXR5SWQsXG4gICAgICBlbnRpdHlOYW1lLFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgc291cmNlOiAncmVzeW5jJ1xuICAgICAgfVxuICAgIH1dO1xuICB9XG5cbiAgcHJpdmF0ZSBleHRyYWN0RHluYW1vU3RyZWFtUmVjb3JkcyhzcXNSZWNvcmQ6IGFueSk6IEJhc2VFdmVudFJlY29yZDxSZWNvcmQ8c3RyaW5nLCBhbnk+PltdIHtcbiAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgU1FTIGV2ZW50IGZvciB0aGUgRHluYW1vREIgZXh0cmFjdG9yXG4gICAgY29uc3QgdGVtcFNRU0V2ZW50OiBTUVNFdmVudCA9IHsgUmVjb3JkczogW3Nxc1JlY29yZF0gfTtcbiAgICBjb25zdCBkeW5hbW9SZWNvcmRzID0gdGhpcy5keW5hbW9FeHRyYWN0b3IuZXh0cmFjdERhdGEodGVtcFNRU0V2ZW50KTtcbiAgICBcbiAgICAvLyBGb3Igc3RyZWFtIHJlY29yZHMsIHdlIHBhc3MgdGhlIGNoYW5nZVN0cmVhbVBheWxvYWQgdGhyb3VnaCBzbyB0aGUgYmFzZSBjbGFzcyBjYW4gcHJvY2VzcyBpdFxuICAgIHJldHVybiBkeW5hbW9SZWNvcmRzLm1hcChyZWNvcmQgPT4ge1xuICAgICAgY29uc3QgeyBwYXlsb2FkIH0gPSByZWNvcmQgYXMgQmFzZUV2ZW50UmVjb3JkPENoYW5nZVN0cmVhbVBheWxvYWQ+O1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4ucmVjb3JkLFxuICAgICAgICBwYXlsb2FkOiBwYXlsb2FkLCAvLyBLZWVwIHRoZSBmdWxsIENoYW5nZVN0cmVhbVBheWxvYWRcbiAgICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgICAuLi5yZWNvcmQubWV0YWRhdGEsXG4gICAgICAgICAgc291cmNlOiAnc3RyZWFtJ1xuICAgICAgICB9XG4gICAgICB9IGFzIEJhc2VFdmVudFJlY29yZDxSZWNvcmQ8c3RyaW5nLCBhbnk+PjtcbiAgICB9KTtcbiAgfVxufVxuIl19