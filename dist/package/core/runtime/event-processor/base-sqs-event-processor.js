"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseSQSEventProcessor = void 0;
const abstract_lambda_handler_1 = require("../abstract-lambda-handler");
const observability_1 = require("../../../observability");
const execution_context_1 = require("../execution-context");
/**
 * Base class for handling stream events (SQS or DynamoDB Streams).
 *
 * Extends AbstractLambdaHandler directly since it handles multiple event types
 * that are not compatible with each other (SQSEvent vs DynamoDBStreamEvent).
 *
 * @typeParam T - Event data extractor type
 * @typeParam TEvent - Event type (SQSEvent, DynamoDBStreamEvent, or union)
 * @typeParam TPayload - Payload type extracted from events
 */
class BaseSQSEventProcessor extends abstract_lambda_handler_1.AbstractLambdaHandler {
    eventDataExtractor;
    processMode = 'record';
    constructor(extractor, options) {
        super();
        if (!extractor) {
            throw new Error('IEventDataExtractor is required for BaseSQSEventProcessor');
        }
        this.eventDataExtractor = extractor;
        if (options?.processMode) {
            this.processMode = options.processMode;
        }
    }
    /**
     * Initialize the processor. Override in subclass.
     */
    initialize(_event, _context) {
        return Promise.resolve();
    }
    getProcessorName() {
        return this.constructor.name;
    }
    async LambdaHandler(event, context) {
        const eventSource = event.Records?.[0]?.eventSource ?? 'Unknown';
        this.logger.debug('Processing incoming stream event', {
            eventSourceFromRecord: eventSource,
            recordCount: event.Records?.length,
            processMode: this.processMode,
        });
        this.initializeObservability();
        const processorName = this.getProcessorName();
        const correlationId = this.extractCorrelationIdFromEvent(event, context);
        // Create execution context
        const execCtx = (0, execution_context_1.createExecutionContext)({
            correlationId,
            source: `${processorName}.process`,
        });
        // Run handler within execution context
        return (0, execution_context_1.runWithExecutionContext)(execCtx, async () => {
            const span = observability_1.SpanObserver.start(`${eventSource} ${processorName}`, {
                correlationId,
                attributes: {
                    'event.source': eventSource,
                    'event.recordCount': event.Records?.length ?? 0,
                    'processor.mode': this.processMode,
                },
            });
            execCtx.parentObservabilityLogId = span.id;
            const ctx = {
                event,
                lambdaContext: context,
                executionContext: execCtx,
            };
            let spanEnded = false;
            const endSpan = async (success, error) => {
                if (!spanEnded) {
                    span.end({ success, error });
                    spanEnded = true;
                }
                await this.flushObservability();
            };
            try {
                await this.initialize(event, context);
                await this.process(event, context, ctx);
                await endSpan(true);
            }
            catch (error) {
                await endSpan(false, error);
                throw error;
            }
        });
    }
    /**
     * Extract correlation ID from event.
     */
    extractCorrelationIdFromEvent(event, context) {
        // Try SQS message attributes
        if ('Records' in event && event.Records?.[0]) {
            const record = event.Records[0];
            if ('messageAttributes' in record) {
                const sqsRecord = record;
                const traceCtx = (0, execution_context_1.extractFromSqs)(sqsRecord.messageAttributes);
                if (traceCtx?.correlationId)
                    return traceCtx.correlationId;
            }
        }
        return context.awsRequestId || crypto.randomUUID();
    }
    /**
     * Process the event. Can be overridden for custom processing.
     */
    async process(event, _context, _ctx) {
        this.logger.debug('Extracting records using data extractor');
        const records = this.eventDataExtractor.extractData(event);
        this.logger.debug('Extracted records for processing', {
            recordCount: records.length,
            processMode: this.processMode,
        });
        if (records.length === 0) {
            this.logger.info('No records extracted for processing from the event.');
            return;
        }
        await this.processRecords(records);
    }
    async processRecords(records) {
        const startTime = Date.now();
        this.logger.debug('Starting record processing', {
            recordCount: records.length,
            processMode: this.processMode,
        });
        // Preprocess and filter
        const preprocessed = [];
        for (const record of records) {
            const processed = await this.preprocessRecord(record);
            if (!processed) {
                this.logger.debug('Record filtered out during preprocessing', {
                    eventId: record.eventId,
                    entityName: record.entityName,
                });
                continue;
            }
            preprocessed.push(processed);
        }
        this.logger.debug('Preprocessing completed', {
            originalCount: records.length,
            preprocessedCount: preprocessed.length,
            filteredCount: records.length - preprocessed.length,
            processMode: this.processMode,
        });
        if (preprocessed.length === 0) {
            this.logger.debug('No records to process after preprocessing.');
            return;
        }
        if (this.processMode === 'batch') {
            this.logger.debug('Executing batch processing mode', { recordCount: preprocessed.length });
            await this.processRecordsBatch(preprocessed);
            this.logger.debug('Batch processing completed, running postprocessors');
            for (const rec of preprocessed) {
                await this.postprocessRecord(rec);
            }
        }
        else {
            this.logger.debug('Executing record-by-record processing mode', { recordCount: preprocessed.length });
            const processPromises = preprocessed.map(async (processedRecord) => {
                await this.processRecord(processedRecord);
                await this.postprocessRecord(processedRecord);
            });
            await Promise.all(processPromises);
        }
        const duration = Date.now() - startTime;
        this.logger.debug('Record processing completed', {
            processedCount: preprocessed.length,
            processMode: this.processMode,
            durationMs: duration,
            avgTimePerRecord: duration / preprocessed.length,
        });
    }
    /** Preprocess a record before processing. Return null to filter out. */
    async preprocessRecord(record) {
        return record;
    }
    /** Postprocess a record after processing */
    async postprocessRecord(_record) { }
}
exports.BaseSQSEventProcessor = BaseSQSEventProcessor;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9ldmVudC1wcm9jZXNzb3IvYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHdFQUFtRTtBQUVuRSwwREFBc0Q7QUFDdEQsNERBSzhCO0FBZ0I5Qjs7Ozs7Ozs7O0dBU0c7QUFDSCxNQUFlLHFCQUliLFNBQVEsK0NBQXFCO0lBRW5CLGtCQUFrQixDQUFJO0lBQ3RCLFdBQVcsR0FBdUIsUUFBUSxDQUFDO0lBRXJELFlBQVksU0FBWSxFQUFFLE9BQThDO1FBQ3RFLEtBQUssRUFBRSxDQUFDO1FBQ1IsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ2YsTUFBTSxJQUFJLEtBQUssQ0FBQywyREFBMkQsQ0FBQyxDQUFDO1FBQy9FLENBQUM7UUFDRCxJQUFJLENBQUMsa0JBQWtCLEdBQUcsU0FBUyxDQUFDO1FBQ3BDLElBQUksT0FBTyxFQUFFLFdBQVcsRUFBRSxDQUFDO1lBQ3pCLElBQUksQ0FBQyxXQUFXLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQztRQUN6QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0gsVUFBVSxDQUFDLE1BQWMsRUFBRSxRQUFpQjtRQUMxQyxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBRVMsZ0JBQWdCO1FBQ3hCLE9BQU8sSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7SUFDL0IsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQUMsS0FBYSxFQUFFLE9BQWdCO1FBQ2pELE1BQU0sV0FBVyxHQUFHLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBRSxDQUFDLENBQUUsRUFBRSxXQUFXLElBQUksU0FBUyxDQUFDO1FBQ25FLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGtDQUFrQyxFQUFFO1lBQ3BELHFCQUFxQixFQUFFLFdBQVc7WUFDbEMsV0FBVyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTTtZQUNsQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVc7U0FDOUIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLHVCQUF1QixFQUFFLENBQUM7UUFFL0IsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7UUFDOUMsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLDZCQUE2QixDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV6RSwyQkFBMkI7UUFDM0IsTUFBTSxPQUFPLEdBQUcsSUFBQSwwQ0FBc0IsRUFBQztZQUNyQyxhQUFhO1lBQ2IsTUFBTSxFQUFFLEdBQUcsYUFBYSxVQUFVO1NBQ25DLENBQUMsQ0FBQztRQUVILHVDQUF1QztRQUN2QyxPQUFPLElBQUEsMkNBQXVCLEVBQUMsT0FBTyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2pELE1BQU0sSUFBSSxHQUFHLDRCQUFZLENBQUMsS0FBSyxDQUFDLEdBQUcsV0FBVyxJQUFJLGFBQWEsRUFBRSxFQUFFO2dCQUNqRSxhQUFhO2dCQUNiLFVBQVUsRUFBRTtvQkFDVixjQUFjLEVBQUUsV0FBVztvQkFDM0IsbUJBQW1CLEVBQUUsS0FBSyxDQUFDLE9BQU8sRUFBRSxNQUFNLElBQUksQ0FBQztvQkFDL0MsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLFdBQVc7aUJBQ25DO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsT0FBTyxDQUFDLHdCQUF3QixHQUFHLElBQUksQ0FBQyxFQUFFLENBQUM7WUFFM0MsTUFBTSxHQUFHLEdBQWtDO2dCQUN6QyxLQUFLO2dCQUNMLGFBQWEsRUFBRSxPQUFPO2dCQUN0QixnQkFBZ0IsRUFBRSxPQUFPO2FBQzFCLENBQUM7WUFFRixJQUFJLFNBQVMsR0FBRyxLQUFLLENBQUM7WUFDdEIsTUFBTSxPQUFPLEdBQUcsS0FBSyxFQUFFLE9BQWdCLEVBQUUsS0FBYSxFQUFpQixFQUFFO2dCQUN2RSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7b0JBQ2YsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO29CQUM3QixTQUFTLEdBQUcsSUFBSSxDQUFDO2dCQUNuQixDQUFDO2dCQUNELE1BQU0sSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDbEMsQ0FBQyxDQUFDO1lBRUYsSUFBSSxDQUFDO2dCQUNILE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7Z0JBQ3RDLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDO2dCQUN4QyxNQUFNLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUN0QixDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixNQUFNLE9BQU8sQ0FBQyxLQUFLLEVBQUUsS0FBYyxDQUFDLENBQUM7Z0JBQ3JDLE1BQU0sS0FBSyxDQUFDO1lBQ2QsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ08sNkJBQTZCLENBQUMsS0FBYSxFQUFFLE9BQWdCO1FBQ3JFLDZCQUE2QjtRQUM3QixJQUFJLFNBQVMsSUFBSSxLQUFLLElBQUksS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFFLENBQUMsQ0FBRSxFQUFFLENBQUM7WUFDL0MsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBRSxDQUFDLENBQUUsQ0FBQztZQUNsQyxJQUFJLG1CQUFtQixJQUFJLE1BQU0sRUFBRSxDQUFDO2dCQUNsQyxNQUFNLFNBQVMsR0FBRyxNQUFvQyxDQUFDO2dCQUN2RCxNQUFNLFFBQVEsR0FBRyxJQUFBLGtDQUFjLEVBQUMsU0FBUyxDQUFDLGlCQUFpQixDQUFDLENBQUM7Z0JBQzdELElBQUksUUFBUSxFQUFFLGFBQWE7b0JBQUUsT0FBTyxRQUFRLENBQUMsYUFBYSxDQUFDO1lBQzdELENBQUM7UUFDSCxDQUFDO1FBQ0QsT0FBTyxPQUFPLENBQUMsWUFBWSxJQUFJLE1BQU0sQ0FBQyxVQUFVLEVBQUUsQ0FBQztJQUNyRCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUNYLEtBQWEsRUFDYixRQUFpQixFQUNqQixJQUFvQztRQUVwQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFDO1FBRTdELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUM7UUFFM0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsa0NBQWtDLEVBQUU7WUFDcEQsV0FBVyxFQUFFLE9BQU8sQ0FBQyxNQUFNO1lBQzNCLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVztTQUM5QixDQUFDLENBQUM7UUFFSCxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDekIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscURBQXFELENBQUMsQ0FBQztZQUN4RSxPQUFPO1FBQ1QsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBRVMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxPQUFvQztRQUNqRSxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDN0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsNEJBQTRCLEVBQUU7WUFDOUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxNQUFNO1lBQzNCLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVztTQUM5QixDQUFDLENBQUM7UUFFSCx3QkFBd0I7UUFDeEIsTUFBTSxZQUFZLEdBQWdDLEVBQUUsQ0FBQztRQUNyRCxLQUFLLE1BQU0sTUFBTSxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQzdCLE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3RELElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztnQkFDZixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQywwQ0FBMEMsRUFBRTtvQkFDNUQsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPO29CQUN2QixVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7aUJBQzlCLENBQUMsQ0FBQztnQkFDSCxTQUFTO1lBQ1gsQ0FBQztZQUNELFlBQVksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDL0IsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLHlCQUF5QixFQUFFO1lBQzNDLGFBQWEsRUFBRSxPQUFPLENBQUMsTUFBTTtZQUM3QixpQkFBaUIsRUFBRSxZQUFZLENBQUMsTUFBTTtZQUN0QyxhQUFhLEVBQUUsT0FBTyxDQUFDLE1BQU0sR0FBRyxZQUFZLENBQUMsTUFBTTtZQUNuRCxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVc7U0FDOUIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxZQUFZLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzlCLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDRDQUE0QyxDQUFDLENBQUM7WUFDaEUsT0FBTztRQUNULENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxXQUFXLEtBQUssT0FBTyxFQUFFLENBQUM7WUFDakMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsaUNBQWlDLEVBQUUsRUFBRSxXQUFXLEVBQUUsWUFBWSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFDM0YsTUFBTSxJQUFJLENBQUMsbUJBQW1CLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDN0MsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsb0RBQW9ELENBQUMsQ0FBQztZQUN4RSxLQUFLLE1BQU0sR0FBRyxJQUFJLFlBQVksRUFBRSxDQUFDO2dCQUMvQixNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNwQyxDQUFDO1FBQ0gsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyw0Q0FBNEMsRUFBRSxFQUFFLFdBQVcsRUFBRSxZQUFZLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUN0RyxNQUFNLGVBQWUsR0FBRyxZQUFZLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxlQUFlLEVBQUUsRUFBRTtnQkFDakUsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxDQUFDO2dCQUMxQyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUNoRCxDQUFDLENBQUMsQ0FBQztZQUNILE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUNyQyxDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQztRQUN4QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyw2QkFBNkIsRUFBRTtZQUMvQyxjQUFjLEVBQUUsWUFBWSxDQUFDLE1BQU07WUFDbkMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXO1lBQzdCLFVBQVUsRUFBRSxRQUFRO1lBQ3BCLGdCQUFnQixFQUFFLFFBQVEsR0FBRyxZQUFZLENBQUMsTUFBTTtTQUNqRCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBUUQsd0VBQXdFO0lBQzlELEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFpQztRQUNoRSxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0lBRUQsNENBQTRDO0lBQ2xDLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxPQUFrQyxJQUFtQixDQUFDO0NBQ3pGO0FBRVEsc0RBQXFCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU1FTRXZlbnQsIENvbnRleHQsIER5bmFtb0RCU3RyZWFtRXZlbnQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4uL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBCYXNlRXZlbnRSZWNvcmQsIElFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tIFwiLi4vLi4vdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzXCI7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIgfSBmcm9tICcuLi8uLi8uLi9vYnNlcnZhYmlsaXR5JztcbmltcG9ydCB7XG4gIEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICBjcmVhdGVFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCxcbiAgZXh0cmFjdEZyb21TcXMsXG59IGZyb20gJy4uL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuLyoqXG4gKiBTdXBwb3J0ZWQgZXZlbnQgdHlwZXMgZm9yIHN0cmVhbS9xdWV1ZSBwcm9jZXNzaW5nLlxuICovXG5leHBvcnQgdHlwZSBTdHJlYW1FdmVudCA9IFNRU0V2ZW50IHwgRHluYW1vREJTdHJlYW1FdmVudDtcblxuLyoqXG4gKiBFeGVjdXRpb24gY29udGV4dCBmb3IgZXZlbnQgcHJvY2Vzc29ycy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBFdmVudFByb2Nlc3NvckNvbnRleHQ8VEV2ZW50IGV4dGVuZHMgU3RyZWFtRXZlbnQgPSBTdHJlYW1FdmVudD4ge1xuICByZWFkb25seSBldmVudDogVEV2ZW50O1xuICByZWFkb25seSBsYW1iZGFDb250ZXh0OiBDb250ZXh0O1xuICByZWFkb25seSBleGVjdXRpb25Db250ZXh0OiBFeGVjdXRpb25Db250ZXh0RGF0YTtcbn1cblxuLyoqXG4gKiBCYXNlIGNsYXNzIGZvciBoYW5kbGluZyBzdHJlYW0gZXZlbnRzIChTUVMgb3IgRHluYW1vREIgU3RyZWFtcykuXG4gKiBcbiAqIEV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIGRpcmVjdGx5IHNpbmNlIGl0IGhhbmRsZXMgbXVsdGlwbGUgZXZlbnQgdHlwZXNcbiAqIHRoYXQgYXJlIG5vdCBjb21wYXRpYmxlIHdpdGggZWFjaCBvdGhlciAoU1FTRXZlbnQgdnMgRHluYW1vREJTdHJlYW1FdmVudCkuXG4gKiBcbiAqIEB0eXBlUGFyYW0gVCAtIEV2ZW50IGRhdGEgZXh0cmFjdG9yIHR5cGVcbiAqIEB0eXBlUGFyYW0gVEV2ZW50IC0gRXZlbnQgdHlwZSAoU1FTRXZlbnQsIER5bmFtb0RCU3RyZWFtRXZlbnQsIG9yIHVuaW9uKVxuICogQHR5cGVQYXJhbSBUUGF5bG9hZCAtIFBheWxvYWQgdHlwZSBleHRyYWN0ZWQgZnJvbSBldmVudHNcbiAqL1xuYWJzdHJhY3QgY2xhc3MgQmFzZVNRU0V2ZW50UHJvY2Vzc29yPFxuICBUIGV4dGVuZHMgSUV2ZW50RGF0YUV4dHJhY3RvcjxURXZlbnQsIFRQYXlsb2FkPixcbiAgVEV2ZW50IGV4dGVuZHMgU3RyZWFtRXZlbnQgPSBTdHJlYW1FdmVudCxcbiAgVFBheWxvYWQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0gUmVjb3JkPHN0cmluZywgYW55PlxuPiBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG5cbiAgcHJvdGVjdGVkIGV2ZW50RGF0YUV4dHJhY3RvcjogVDtcbiAgcHJvdGVjdGVkIHByb2Nlc3NNb2RlOiAncmVjb3JkJyB8ICdiYXRjaCcgPSAncmVjb3JkJztcblxuICBjb25zdHJ1Y3RvcihleHRyYWN0b3I6IFQsIG9wdGlvbnM/OiB7IHByb2Nlc3NNb2RlPzogJ3JlY29yZCcgfCAnYmF0Y2gnIH0pIHtcbiAgICBzdXBlcigpO1xuICAgIGlmICghZXh0cmFjdG9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0lFdmVudERhdGFFeHRyYWN0b3IgaXMgcmVxdWlyZWQgZm9yIEJhc2VTUVNFdmVudFByb2Nlc3NvcicpO1xuICAgIH1cbiAgICB0aGlzLmV2ZW50RGF0YUV4dHJhY3RvciA9IGV4dHJhY3RvcjtcbiAgICBpZiAob3B0aW9ucz8ucHJvY2Vzc01vZGUpIHtcbiAgICAgIHRoaXMucHJvY2Vzc01vZGUgPSBvcHRpb25zLnByb2Nlc3NNb2RlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIHRoZSBwcm9jZXNzb3IuIE92ZXJyaWRlIGluIHN1YmNsYXNzLlxuICAgKi9cbiAgaW5pdGlhbGl6ZShfZXZlbnQ6IFRFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0UHJvY2Vzc29yTmFtZSgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gIH1cblxuICBhc3luYyBMYW1iZGFIYW5kbGVyKGV2ZW50OiBURXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBldmVudFNvdXJjZSA9IGV2ZW50LlJlY29yZHM/LlsgMCBdPy5ldmVudFNvdXJjZSA/PyAnVW5rbm93bic7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ1Byb2Nlc3NpbmcgaW5jb21pbmcgc3RyZWFtIGV2ZW50Jywge1xuICAgICAgZXZlbnRTb3VyY2VGcm9tUmVjb3JkOiBldmVudFNvdXJjZSxcbiAgICAgIHJlY29yZENvdW50OiBldmVudC5SZWNvcmRzPy5sZW5ndGgsXG4gICAgICBwcm9jZXNzTW9kZTogdGhpcy5wcm9jZXNzTW9kZSxcbiAgICB9KTtcblxuICAgIHRoaXMuaW5pdGlhbGl6ZU9ic2VydmFiaWxpdHkoKTtcblxuICAgIGNvbnN0IHByb2Nlc3Nvck5hbWUgPSB0aGlzLmdldFByb2Nlc3Nvck5hbWUoKTtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gdGhpcy5leHRyYWN0Q29ycmVsYXRpb25JZEZyb21FdmVudChldmVudCwgY29udGV4dCk7XG5cbiAgICAvLyBDcmVhdGUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICBjb25zdCBleGVjQ3R4ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgc291cmNlOiBgJHtwcm9jZXNzb3JOYW1lfS5wcm9jZXNzYCxcbiAgICB9KTtcblxuICAgIC8vIFJ1biBoYW5kbGVyIHdpdGhpbiBleGVjdXRpb24gY29udGV4dFxuICAgIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChleGVjQ3R4LCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzcGFuID0gU3Bhbk9ic2VydmVyLnN0YXJ0KGAke2V2ZW50U291cmNlfSAke3Byb2Nlc3Nvck5hbWV9YCwge1xuICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgJ2V2ZW50LnNvdXJjZSc6IGV2ZW50U291cmNlLFxuICAgICAgICAgICdldmVudC5yZWNvcmRDb3VudCc6IGV2ZW50LlJlY29yZHM/Lmxlbmd0aCA/PyAwLFxuICAgICAgICAgICdwcm9jZXNzb3IubW9kZSc6IHRoaXMucHJvY2Vzc01vZGUsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgZXhlY0N0eC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBzcGFuLmlkO1xuXG4gICAgICBjb25zdCBjdHg6IEV2ZW50UHJvY2Vzc29yQ29udGV4dDxURXZlbnQ+ID0ge1xuICAgICAgICBldmVudCxcbiAgICAgICAgbGFtYmRhQ29udGV4dDogY29udGV4dCxcbiAgICAgICAgZXhlY3V0aW9uQ29udGV4dDogZXhlY0N0eCxcbiAgICAgIH07XG5cbiAgICAgIGxldCBzcGFuRW5kZWQgPSBmYWxzZTtcbiAgICAgIGNvbnN0IGVuZFNwYW4gPSBhc3luYyAoc3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBFcnJvcik6IFByb21pc2U8dm9pZD4gPT4ge1xuICAgICAgICBpZiAoIXNwYW5FbmRlZCkge1xuICAgICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzcywgZXJyb3IgfSk7XG4gICAgICAgICAgc3BhbkVuZGVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLmZsdXNoT2JzZXJ2YWJpbGl0eSgpO1xuICAgICAgfTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplKGV2ZW50LCBjb250ZXh0KTtcbiAgICAgICAgYXdhaXQgdGhpcy5wcm9jZXNzKGV2ZW50LCBjb250ZXh0LCBjdHgpO1xuICAgICAgICBhd2FpdCBlbmRTcGFuKHRydWUpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgYXdhaXQgZW5kU3BhbihmYWxzZSwgZXJyb3IgYXMgRXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IGNvcnJlbGF0aW9uIElEIGZyb20gZXZlbnQuXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdENvcnJlbGF0aW9uSWRGcm9tRXZlbnQoZXZlbnQ6IFRFdmVudCwgY29udGV4dDogQ29udGV4dCk6IHN0cmluZyB7XG4gICAgLy8gVHJ5IFNRUyBtZXNzYWdlIGF0dHJpYnV0ZXNcbiAgICBpZiAoJ1JlY29yZHMnIGluIGV2ZW50ICYmIGV2ZW50LlJlY29yZHM/LlsgMCBdKSB7XG4gICAgICBjb25zdCByZWNvcmQgPSBldmVudC5SZWNvcmRzWyAwIF07XG4gICAgICBpZiAoJ21lc3NhZ2VBdHRyaWJ1dGVzJyBpbiByZWNvcmQpIHtcbiAgICAgICAgY29uc3Qgc3FzUmVjb3JkID0gcmVjb3JkIGFzIFNRU0V2ZW50WyAnUmVjb3JkcycgXVsgMCBdO1xuICAgICAgICBjb25zdCB0cmFjZUN0eCA9IGV4dHJhY3RGcm9tU3FzKHNxc1JlY29yZC5tZXNzYWdlQXR0cmlidXRlcyk7XG4gICAgICAgIGlmICh0cmFjZUN0eD8uY29ycmVsYXRpb25JZCkgcmV0dXJuIHRyYWNlQ3R4LmNvcnJlbGF0aW9uSWQ7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjb250ZXh0LmF3c1JlcXVlc3RJZCB8fCBjcnlwdG8ucmFuZG9tVVVJRCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3MgdGhlIGV2ZW50LiBDYW4gYmUgb3ZlcnJpZGRlbiBmb3IgY3VzdG9tIHByb2Nlc3NpbmcuXG4gICAqL1xuICBhc3luYyBwcm9jZXNzKFxuICAgIGV2ZW50OiBURXZlbnQsXG4gICAgX2NvbnRleHQ6IENvbnRleHQsXG4gICAgX2N0eD86IEV2ZW50UHJvY2Vzc29yQ29udGV4dDxURXZlbnQ+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdFeHRyYWN0aW5nIHJlY29yZHMgdXNpbmcgZGF0YSBleHRyYWN0b3InKTtcblxuICAgIGNvbnN0IHJlY29yZHMgPSB0aGlzLmV2ZW50RGF0YUV4dHJhY3Rvci5leHRyYWN0RGF0YShldmVudCk7XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnRXh0cmFjdGVkIHJlY29yZHMgZm9yIHByb2Nlc3NpbmcnLCB7XG4gICAgICByZWNvcmRDb3VudDogcmVjb3Jkcy5sZW5ndGgsXG4gICAgICBwcm9jZXNzTW9kZTogdGhpcy5wcm9jZXNzTW9kZSxcbiAgICB9KTtcblxuICAgIGlmIChyZWNvcmRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbygnTm8gcmVjb3JkcyBleHRyYWN0ZWQgZm9yIHByb2Nlc3NpbmcgZnJvbSB0aGUgZXZlbnQuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5wcm9jZXNzUmVjb3JkcyhyZWNvcmRzKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBwcm9jZXNzUmVjb3JkcyhyZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+W10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdTdGFydGluZyByZWNvcmQgcHJvY2Vzc2luZycsIHtcbiAgICAgIHJlY29yZENvdW50OiByZWNvcmRzLmxlbmd0aCxcbiAgICAgIHByb2Nlc3NNb2RlOiB0aGlzLnByb2Nlc3NNb2RlLFxuICAgIH0pO1xuXG4gICAgLy8gUHJlcHJvY2VzcyBhbmQgZmlsdGVyXG4gICAgY29uc3QgcHJlcHJvY2Vzc2VkOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWNvcmRzKSB7XG4gICAgICBjb25zdCBwcm9jZXNzZWQgPSBhd2FpdCB0aGlzLnByZXByb2Nlc3NSZWNvcmQocmVjb3JkKTtcbiAgICAgIGlmICghcHJvY2Vzc2VkKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdSZWNvcmQgZmlsdGVyZWQgb3V0IGR1cmluZyBwcmVwcm9jZXNzaW5nJywge1xuICAgICAgICAgIGV2ZW50SWQ6IHJlY29yZC5ldmVudElkLFxuICAgICAgICAgIGVudGl0eU5hbWU6IHJlY29yZC5lbnRpdHlOYW1lLFxuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBwcmVwcm9jZXNzZWQucHVzaChwcm9jZXNzZWQpO1xuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdQcmVwcm9jZXNzaW5nIGNvbXBsZXRlZCcsIHtcbiAgICAgIG9yaWdpbmFsQ291bnQ6IHJlY29yZHMubGVuZ3RoLFxuICAgICAgcHJlcHJvY2Vzc2VkQ291bnQ6IHByZXByb2Nlc3NlZC5sZW5ndGgsXG4gICAgICBmaWx0ZXJlZENvdW50OiByZWNvcmRzLmxlbmd0aCAtIHByZXByb2Nlc3NlZC5sZW5ndGgsXG4gICAgICBwcm9jZXNzTW9kZTogdGhpcy5wcm9jZXNzTW9kZSxcbiAgICB9KTtcblxuICAgIGlmIChwcmVwcm9jZXNzZWQubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnTm8gcmVjb3JkcyB0byBwcm9jZXNzIGFmdGVyIHByZXByb2Nlc3NpbmcuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucHJvY2Vzc01vZGUgPT09ICdiYXRjaCcpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdFeGVjdXRpbmcgYmF0Y2ggcHJvY2Vzc2luZyBtb2RlJywgeyByZWNvcmRDb3VudDogcHJlcHJvY2Vzc2VkLmxlbmd0aCB9KTtcbiAgICAgIGF3YWl0IHRoaXMucHJvY2Vzc1JlY29yZHNCYXRjaChwcmVwcm9jZXNzZWQpO1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0JhdGNoIHByb2Nlc3NpbmcgY29tcGxldGVkLCBydW5uaW5nIHBvc3Rwcm9jZXNzb3JzJyk7XG4gICAgICBmb3IgKGNvbnN0IHJlYyBvZiBwcmVwcm9jZXNzZWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5wb3N0cHJvY2Vzc1JlY29yZChyZWMpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnRXhlY3V0aW5nIHJlY29yZC1ieS1yZWNvcmQgcHJvY2Vzc2luZyBtb2RlJywgeyByZWNvcmRDb3VudDogcHJlcHJvY2Vzc2VkLmxlbmd0aCB9KTtcbiAgICAgIGNvbnN0IHByb2Nlc3NQcm9taXNlcyA9IHByZXByb2Nlc3NlZC5tYXAoYXN5bmMgKHByb2Nlc3NlZFJlY29yZCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLnByb2Nlc3NSZWNvcmQocHJvY2Vzc2VkUmVjb3JkKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wb3N0cHJvY2Vzc1JlY29yZChwcm9jZXNzZWRSZWNvcmQpO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChwcm9jZXNzUHJvbWlzZXMpO1xuICAgIH1cblxuICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnUmVjb3JkIHByb2Nlc3NpbmcgY29tcGxldGVkJywge1xuICAgICAgcHJvY2Vzc2VkQ291bnQ6IHByZXByb2Nlc3NlZC5sZW5ndGgsXG4gICAgICBwcm9jZXNzTW9kZTogdGhpcy5wcm9jZXNzTW9kZSxcbiAgICAgIGR1cmF0aW9uTXM6IGR1cmF0aW9uLFxuICAgICAgYXZnVGltZVBlclJlY29yZDogZHVyYXRpb24gLyBwcmVwcm9jZXNzZWQubGVuZ3RoLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqIFByb2Nlc3MgYSBzaW5nbGUgcmVjb3JkICh1c2VkIGluICdyZWNvcmQnIG1vZGUpICovXG4gIHByb3RlY3RlZCBhYnN0cmFjdCBwcm9jZXNzUmVjb3JkKHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPik6IFByb21pc2U8dm9pZD47XG5cbiAgLyoqIFByb2Nlc3MgYWxsIHJlY29yZHMgYXQgb25jZSAodXNlZCBpbiAnYmF0Y2gnIG1vZGUpICovXG4gIHByb3RlY3RlZCBhYnN0cmFjdCBwcm9jZXNzUmVjb3Jkc0JhdGNoKHJlY29yZHM6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD5bXSk6IFByb21pc2U8dm9pZD47XG5cbiAgLyoqIFByZXByb2Nlc3MgYSByZWNvcmQgYmVmb3JlIHByb2Nlc3NpbmcuIFJldHVybiBudWxsIHRvIGZpbHRlciBvdXQuICovXG4gIHByb3RlY3RlZCBhc3luYyBwcmVwcm9jZXNzUmVjb3JkKHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPik6IFByb21pc2U8QmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPiB8IG51bGw+IHtcbiAgICByZXR1cm4gcmVjb3JkO1xuICB9XG5cbiAgLyoqIFBvc3Rwcm9jZXNzIGEgcmVjb3JkIGFmdGVyIHByb2Nlc3NpbmcgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIHBvc3Rwcm9jZXNzUmVjb3JkKF9yZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD4pOiBQcm9taXNlPHZvaWQ+IHsgfVxufVxuXG5leHBvcnQgeyBCYXNlU1FTRXZlbnRQcm9jZXNzb3IgfTtcbiJdfQ==