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
            try {
                const body = JSON.parse(sqsRecord.body);
                // Check if this is a resync message (direct from search controller)
                // Support both: { eventName: 'RESYNC', data: ..., entityName: ... } 
                // and simple: { data: ..., entityName: ... }
                if (body.eventName === 'RESYNC' || (body.data && body.entityName && !body.Message)) {
                    records.push(...this.extractResyncRecords(sqsRecord, body));
                }
                else {
                    // This should be a DynamoDB stream event from SNS
                    records.push(...this.extractDynamoStreamRecords(sqsRecord));
                }
            }
            catch (error) {
                // Log error but continue to try as DynamoDB stream event
                this.logger.error('Failed to parse SQS record body for resync detection:', error);
                records.push(...this.extractDynamoStreamRecords(sqsRecord));
            }
        }
        return records;
    }
    extractResyncRecords(sqsRecord, body) {
        const { data: rawPayload, entityName } = body;
        // Handle batch resync: when data is an array, create multiple records
        if (Array.isArray(rawPayload)) {
            return rawPayload.map((item, index) => ({
                eventId: `${sqsRecord.messageId}-${index}`,
                eventType: 'update',
                timestamp: Date.now(),
                eventSource: sqsRecord.eventSource,
                payload: item,
                entityId: item?.id || item?.[`${entityName}Id`],
                entityName,
                metadata: {
                    source: 'resync'
                }
            }));
        }
        // Handle individual resync: when data is a single item
        const entityId = rawPayload?.id || rawPayload?.[`${entityName}Id`];
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
        // Handle case where DynamoDB extractor returns null/undefined
        if (!dynamoRecords || !Array.isArray(dynamoRecords)) {
            this.logger.warn('DynamoDB extractor returned no records', {
                messageId: sqsRecord.messageId
            });
            return [];
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaHlicmlkLXNlYXJjaC1ldmVudC1leHRyYWN0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL2luZGV4ZXIvaHlicmlkLXNlYXJjaC1ldmVudC1leHRyYWN0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRUEsMkNBQTZDO0FBQzdDLG9IQUE4RztBQUU5Rzs7OztHQUlHO0FBQ0gsTUFBYSwwQkFBMEI7SUFDcEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyw0QkFBNEIsQ0FBQyxDQUFDO0lBQ3BELGVBQWUsR0FBRyxJQUFJLDBEQUEwQixFQUFFLENBQUM7SUFFN0QsV0FBVyxDQUFDLEtBQWU7UUFDaEMsTUFBTSxPQUFPLEdBQTJDLEVBQUUsQ0FBQztRQUUzRCxLQUFLLE1BQU0sU0FBUyxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0QyxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBSXhDLG9FQUFvRTtnQkFDcEUscUVBQXFFO2dCQUNyRSw2Q0FBNkM7Z0JBQzdDLElBQUksSUFBSSxDQUFDLFNBQVMsS0FBSyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztvQkFFbkYsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQztnQkFDOUQsQ0FBQztxQkFBTSxDQUFDO29CQUVOLGtEQUFrRDtvQkFDbEQsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO2dCQUM5RCxDQUFDO1lBQ0gsQ0FBQztZQUFDLE9BQU8sS0FBSyxF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IFNRU0V2ZW50IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBCYXNlRXZlbnRSZWNvcmQsIENoYW5nZVN0cmVhbVBheWxvYWQsIElFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V2ZW50LXByb2Nlc3Nvci10eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9keW5hbW9kYi1ldmVudC1kYXRhLWV4dHJhY3Rvcic7XG5cbi8qKlxuICogSHlicmlkIGV2ZW50IGRhdGEgZXh0cmFjdG9yIHRoYXQgY2FuIGhhbmRsZSBib3RoOlxuICogMS4gRHluYW1vREIgc3RyZWFtIGV2ZW50cyAodmlhIFNRUy9TTlMpIC0gZGVsZWdhdGVzIHRvIER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yXG4gKiAyLiBEaXJlY3QgcmVzeW5jIGV2ZW50cyBmcm9tIHNlYXJjaCBjb250cm9sbGVyXG4gKi9cbmV4cG9ydCBjbGFzcyBIeWJyaWRTZWFyY2hFdmVudEV4dHJhY3RvciBpbXBsZW1lbnRzIElFdmVudERhdGFFeHRyYWN0b3I8U1FTRXZlbnQsIFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgcHJpdmF0ZSByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0h5YnJpZFNlYXJjaEV2ZW50RXh0cmFjdG9yJyk7XG4gIHByaXZhdGUgcmVhZG9ubHkgZHluYW1vRXh0cmFjdG9yID0gbmV3IER5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yKCk7XG5cbiAgcHVibGljIGV4dHJhY3REYXRhKGV2ZW50OiBTUVNFdmVudCk6IEJhc2VFdmVudFJlY29yZDxSZWNvcmQ8c3RyaW5nLCBhbnk+PltdIHtcbiAgICBjb25zdCByZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8UmVjb3JkPHN0cmluZywgYW55Pj5bXSA9IFtdO1xuICAgIFxuICAgIGZvciAoY29uc3Qgc3FzUmVjb3JkIG9mIGV2ZW50LlJlY29yZHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHNxc1JlY29yZC5ib2R5KTtcbiAgICAgICAgXG5cbiAgICAgICAgXG4gICAgICAgIC8vIENoZWNrIGlmIHRoaXMgaXMgYSByZXN5bmMgbWVzc2FnZSAoZGlyZWN0IGZyb20gc2VhcmNoIGNvbnRyb2xsZXIpXG4gICAgICAgIC8vIFN1cHBvcnQgYm90aDogeyBldmVudE5hbWU6ICdSRVNZTkMnLCBkYXRhOiAuLi4sIGVudGl0eU5hbWU6IC4uLiB9IFxuICAgICAgICAvLyBhbmQgc2ltcGxlOiB7IGRhdGE6IC4uLiwgZW50aXR5TmFtZTogLi4uIH1cbiAgICAgICAgaWYgKGJvZHkuZXZlbnROYW1lID09PSAnUkVTWU5DJyB8fCAoYm9keS5kYXRhICYmIGJvZHkuZW50aXR5TmFtZSAmJiAhYm9keS5NZXNzYWdlKSkge1xuXG4gICAgICAgICAgcmVjb3Jkcy5wdXNoKC4uLnRoaXMuZXh0cmFjdFJlc3luY1JlY29yZHMoc3FzUmVjb3JkLCBib2R5KSk7XG4gICAgICAgIH0gZWxzZSB7XG5cbiAgICAgICAgICAvLyBUaGlzIHNob3VsZCBiZSBhIER5bmFtb0RCIHN0cmVhbSBldmVudCBmcm9tIFNOU1xuICAgICAgICAgIHJlY29yZHMucHVzaCguLi50aGlzLmV4dHJhY3REeW5hbW9TdHJlYW1SZWNvcmRzKHNxc1JlY29yZCkpO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBMb2cgZXJyb3IgYnV0IGNvbnRpbnVlIHRvIHRyeSBhcyBEeW5hbW9EQiBzdHJlYW0gZXZlbnRcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBwYXJzZSBTUVMgcmVjb3JkIGJvZHkgZm9yIHJlc3luYyBkZXRlY3Rpb246JywgZXJyb3IpO1xuXG4gICAgICAgIHJlY29yZHMucHVzaCguLi50aGlzLmV4dHJhY3REeW5hbW9TdHJlYW1SZWNvcmRzKHNxc1JlY29yZCkpO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gcmVjb3JkcztcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdFJlc3luY1JlY29yZHMoc3FzUmVjb3JkOiBhbnksIGJvZHk6IGFueSk6IEJhc2VFdmVudFJlY29yZDxSZWNvcmQ8c3RyaW5nLCBhbnk+PltdIHtcbiAgICBjb25zdCB7IGRhdGE6IHJhd1BheWxvYWQsIGVudGl0eU5hbWUgfSA9IGJvZHkgYXMgeyBkYXRhOiBhbnksIGVudGl0eU5hbWU6IHN0cmluZyB9O1xuICAgIFxuICAgIC8vIEhhbmRsZSBiYXRjaCByZXN5bmM6IHdoZW4gZGF0YSBpcyBhbiBhcnJheSwgY3JlYXRlIG11bHRpcGxlIHJlY29yZHNcbiAgICBpZiAoQXJyYXkuaXNBcnJheShyYXdQYXlsb2FkKSkge1xuICAgICAgcmV0dXJuIHJhd1BheWxvYWQubWFwKChpdGVtLCBpbmRleCkgPT4gKHtcbiAgICAgICAgZXZlbnRJZDogYCR7c3FzUmVjb3JkLm1lc3NhZ2VJZH0tJHtpbmRleH1gLFxuICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIGV2ZW50U291cmNlOiBzcXNSZWNvcmQuZXZlbnRTb3VyY2UsXG4gICAgICAgIHBheWxvYWQ6IGl0ZW0sXG4gICAgICAgIGVudGl0eUlkOiBpdGVtPy5pZCB8fCBpdGVtPy5bYCR7ZW50aXR5TmFtZX1JZGBdLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgIHNvdXJjZTogJ3Jlc3luYydcbiAgICAgICAgfVxuICAgICAgfSkpO1xuICAgIH1cbiAgICBcbiAgICAvLyBIYW5kbGUgaW5kaXZpZHVhbCByZXN5bmM6IHdoZW4gZGF0YSBpcyBhIHNpbmdsZSBpdGVtXG4gICAgY29uc3QgZW50aXR5SWQgPSByYXdQYXlsb2FkPy5pZCB8fCByYXdQYXlsb2FkPy5bYCR7ZW50aXR5TmFtZX1JZGBdO1xuICAgIHJldHVybiBbe1xuICAgICAgZXZlbnRJZDogc3FzUmVjb3JkLm1lc3NhZ2VJZCxcbiAgICAgIGV2ZW50VHlwZTogJ3VwZGF0ZScsXG4gICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICBldmVudFNvdXJjZTogc3FzUmVjb3JkLmV2ZW50U291cmNlLFxuICAgICAgcGF5bG9hZDogcmF3UGF5bG9hZCxcbiAgICAgIGVudGl0eUlkLFxuICAgICAgZW50aXR5TmFtZSxcbiAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgIHNvdXJjZTogJ3Jlc3luYydcbiAgICAgIH1cbiAgICB9XTtcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdER5bmFtb1N0cmVhbVJlY29yZHMoc3FzUmVjb3JkOiBhbnkpOiBCYXNlRXZlbnRSZWNvcmQ8UmVjb3JkPHN0cmluZywgYW55Pj5bXSB7XG4gICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IFNRUyBldmVudCBmb3IgdGhlIER5bmFtb0RCIGV4dHJhY3RvclxuICAgIGNvbnN0IHRlbXBTUVNFdmVudDogU1FTRXZlbnQgPSB7IFJlY29yZHM6IFtzcXNSZWNvcmRdIH07XG4gICAgY29uc3QgZHluYW1vUmVjb3JkcyA9IHRoaXMuZHluYW1vRXh0cmFjdG9yLmV4dHJhY3REYXRhKHRlbXBTUVNFdmVudCk7XG4gICAgXG4gICAgLy8gSGFuZGxlIGNhc2Ugd2hlcmUgRHluYW1vREIgZXh0cmFjdG9yIHJldHVybnMgbnVsbC91bmRlZmluZWRcbiAgICBpZiAoIWR5bmFtb1JlY29yZHMgfHwgIUFycmF5LmlzQXJyYXkoZHluYW1vUmVjb3JkcykpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ0R5bmFtb0RCIGV4dHJhY3RvciByZXR1cm5lZCBubyByZWNvcmRzJywgeyBcbiAgICAgICAgbWVzc2FnZUlkOiBzcXNSZWNvcmQubWVzc2FnZUlkIFxuICAgICAgfSk7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuICAgIFxuICAgIC8vIEZvciBzdHJlYW0gcmVjb3Jkcywgd2UgcGFzcyB0aGUgY2hhbmdlU3RyZWFtUGF5bG9hZCB0aHJvdWdoIHNvIHRoZSBiYXNlIGNsYXNzIGNhbiBwcm9jZXNzIGl0XG4gICAgcmV0dXJuIGR5bmFtb1JlY29yZHMubWFwKHJlY29yZCA9PiB7XG4gICAgICBjb25zdCB7IHBheWxvYWQgfSA9IHJlY29yZCBhcyBCYXNlRXZlbnRSZWNvcmQ8Q2hhbmdlU3RyZWFtUGF5bG9hZD47XG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5yZWNvcmQsXG4gICAgICAgIHBheWxvYWQ6IHBheWxvYWQsIC8vIEtlZXAgdGhlIGZ1bGwgQ2hhbmdlU3RyZWFtUGF5bG9hZFxuICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgIC4uLnJlY29yZC5tZXRhZGF0YSxcbiAgICAgICAgICBzb3VyY2U6ICdzdHJlYW0nXG4gICAgICAgIH1cbiAgICAgIH0gYXMgQmFzZUV2ZW50UmVjb3JkPFJlY29yZDxzdHJpbmcsIGFueT4+O1xuICAgIH0pO1xuICB9XG59XG4iXX0=