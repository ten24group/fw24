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
        this.initializeEntryPackagesAndObservability();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9ldmVudC1wcm9jZXNzb3IvYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHdFQUFtRTtBQUVuRSwwREFBc0Q7QUFDdEQsNERBSzhCO0FBZ0I5Qjs7Ozs7Ozs7O0dBU0c7QUFDSCxNQUFlLHFCQUliLFNBQVEsK0NBQXFCO0lBRW5CLGtCQUFrQixDQUFJO0lBQ3RCLFdBQVcsR0FBdUIsUUFBUSxDQUFDO0lBRXJELFlBQVksU0FBWSxFQUFFLE9BQThDO1FBQ3RFLEtBQUssRUFBRSxDQUFDO1FBQ1IsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ2YsTUFBTSxJQUFJLEtBQUssQ0FBQywyREFBMkQsQ0FBQyxDQUFDO1FBQy9FLENBQUM7UUFDRCxJQUFJLENBQUMsa0JBQWtCLEdBQUcsU0FBUyxDQUFDO1FBQ3BDLElBQUksT0FBTyxFQUFFLFdBQVcsRUFBRSxDQUFDO1lBQ3pCLElBQUksQ0FBQyxXQUFXLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQztRQUN6QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0gsVUFBVSxDQUFDLE1BQWMsRUFBRSxRQUFpQjtRQUMxQyxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBRVMsZ0JBQWdCO1FBQ3hCLE9BQU8sSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7SUFDL0IsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQUMsS0FBYSxFQUFFLE9BQWdCO1FBQ2pELE1BQU0sV0FBVyxHQUFHLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBRSxDQUFDLENBQUUsRUFBRSxXQUFXLElBQUksU0FBUyxDQUFDO1FBQ25FLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGtDQUFr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QyxDQUFDO1FBQ0gsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyw0Q0FBNEMsRUFBRSxFQUFFLFdBQVcsRUFBRSxZQUFZLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUN0RyxNQUFNLGVBQWUsR0FBRyxZQUFZLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxlQUFlLEVBQUUsRUFBRTtnQkFDakUsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxDQUFDO2dCQUMxQyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUNoRCxDQUFDLENBQUMsQ0FBQztZQUNILE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUNyQyxDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQztRQUN4QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyw2QkFBNkIsRUFBRTtZQUMvQyxjQUFjLEVBQUUsWUFBWSxDQUFDLE1BQU07WUFDbkMsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXO1lBQzdCLFVBQVUsRUFBRSxRQUFRO1lBQ3BCLGdCQUFnQixFQUFFLFFBQVEsR0FBRyxZQUFZLENBQUMsTUFBTTtTQUNqRCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBUUQsd0VBQXdFO0lBQzlELEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFpQztRQUNoRSxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0lBRUQsNENBQTRDO0lBQ2xDLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxPQUFrQyxJQUFtQixDQUFDO0NBQ3pGO0FBRVEsc0RBQXFCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU1FTRXZlbnQsIENvbnRleHQsIER5bmFtb0RCU3RyZWFtRXZlbnQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4uL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBCYXNlRXZlbnRSZWNvcmQsIElFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tIFwiLi4vLi4vdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzXCI7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIgfSBmcm9tICcuLi8uLi8uLi9vYnNlcnZhYmlsaXR5JztcbmltcG9ydCB7XG4gIEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICBjcmVhdGVFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCxcbiAgZXh0cmFjdEZyb21TcXMsXG59IGZyb20gJy4uL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuLyoqXG4gKiBTdXBwb3J0ZWQgZXZlbnQgdHlwZXMgZm9yIHN0cmVhbS9xdWV1ZSBwcm9jZXNzaW5nLlxuICovXG5leHBvcnQgdHlwZSBTdHJlYW1FdmVudCA9IFNRU0V2ZW50IHwgRHluYW1vREJTdHJlYW1FdmVudDtcblxuLyoqXG4gKiBFeGVjdXRpb24gY29udGV4dCBmb3IgZXZlbnQgcHJvY2Vzc29ycy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBFdmVudFByb2Nlc3NvckNvbnRleHQ8VEV2ZW50IGV4dGVuZHMgU3RyZWFtRXZlbnQgPSBTdHJlYW1FdmVudD4ge1xuICByZWFkb25seSBldmVudDogVEV2ZW50O1xuICByZWFkb25seSBsYW1iZGFDb250ZXh0OiBDb250ZXh0O1xuICByZWFkb25seSBleGVjdXRpb25Db250ZXh0OiBFeGVjdXRpb25Db250ZXh0RGF0YTtcbn1cblxuLyoqXG4gKiBCYXNlIGNsYXNzIGZvciBoYW5kbGluZyBzdHJlYW0gZXZlbnRzIChTUVMgb3IgRHluYW1vREIgU3RyZWFtcykuXG4gKiBcbiAqIEV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIGRpcmVjdGx5IHNpbmNlIGl0IGhhbmRsZXMgbXVsdGlwbGUgZXZlbnQgdHlwZXNcbiAqIHRoYXQgYXJlIG5vdCBjb21wYXRpYmxlIHdpdGggZWFjaCBvdGhlciAoU1FTRXZlbnQgdnMgRHluYW1vREJTdHJlYW1FdmVudCkuXG4gKiBcbiAqIEB0eXBlUGFyYW0gVCAtIEV2ZW50IGRhdGEgZXh0cmFjdG9yIHR5cGVcbiAqIEB0eXBlUGFyYW0gVEV2ZW50IC0gRXZlbnQgdHlwZSAoU1FTRXZlbnQsIER5bmFtb0RCU3RyZWFtRXZlbnQsIG9yIHVuaW9uKVxuICogQHR5cGVQYXJhbSBUUGF5bG9hZCAtIFBheWxvYWQgdHlwZSBleHRyYWN0ZWQgZnJvbSBldmVudHNcbiAqL1xuYWJzdHJhY3QgY2xhc3MgQmFzZVNRU0V2ZW50UHJvY2Vzc29yPFxuICBUIGV4dGVuZHMgSUV2ZW50RGF0YUV4dHJhY3RvcjxURXZlbnQsIFRQYXlsb2FkPixcbiAgVEV2ZW50IGV4dGVuZHMgU3RyZWFtRXZlbnQgPSBTdHJlYW1FdmVudCxcbiAgVFBheWxvYWQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0gUmVjb3JkPHN0cmluZywgYW55PlxuPiBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG5cbiAgcHJvdGVjdGVkIGV2ZW50RGF0YUV4dHJhY3RvcjogVDtcbiAgcHJvdGVjdGVkIHByb2Nlc3NNb2RlOiAncmVjb3JkJyB8ICdiYXRjaCcgPSAncmVjb3JkJztcblxuICBjb25zdHJ1Y3RvcihleHRyYWN0b3I6IFQsIG9wdGlvbnM/OiB7IHByb2Nlc3NNb2RlPzogJ3JlY29yZCcgfCAnYmF0Y2gnIH0pIHtcbiAgICBzdXBlcigpO1xuICAgIGlmICghZXh0cmFjdG9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0lFdmVudERhdGFFeHRyYWN0b3IgaXMgcmVxdWlyZWQgZm9yIEJhc2VTUVNFdmVudFByb2Nlc3NvcicpO1xuICAgIH1cbiAgICB0aGlzLmV2ZW50RGF0YUV4dHJhY3RvciA9IGV4dHJhY3RvcjtcbiAgICBpZiAob3B0aW9ucz8ucHJvY2Vzc01vZGUpIHtcbiAgICAgIHRoaXMucHJvY2Vzc01vZGUgPSBvcHRpb25zLnByb2Nlc3NNb2RlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIHRoZSBwcm9jZXNzb3IuIE92ZXJyaWRlIGluIHN1YmNsYXNzLlxuICAgKi9cbiAgaW5pdGlhbGl6ZShfZXZlbnQ6IFRFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0UHJvY2Vzc29yTmFtZSgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gIH1cblxuICBhc3luYyBMYW1iZGFIYW5kbGVyKGV2ZW50OiBURXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBldmVudFNvdXJjZSA9IGV2ZW50LlJlY29yZHM/LlsgMCBdPy5ldmVudFNvdXJjZSA/PyAnVW5rbm93bic7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ1Byb2Nlc3NpbmcgaW5jb21pbmcgc3RyZWFtIGV2ZW50Jywge1xuICAgICAgZXZlbnRTb3VyY2VGcm9tUmVjb3JkOiBldmVudFNvdXJjZSxcbiAgICAgIHJlY29yZENvdW50OiBldmVudC5SZWNvcmRzPy5sZW5ndGgsXG4gICAgICBwcm9jZXNzTW9kZTogdGhpcy5wcm9jZXNzTW9kZSxcbiAgICB9KTtcblxuICAgIHRoaXMuaW5pdGlhbGl6ZUVudHJ5UGFja2FnZXNBbmRPYnNlcnZhYmlsaXR5KCk7XG5cbiAgICBjb25zdCBwcm9jZXNzb3JOYW1lID0gdGhpcy5nZXRQcm9jZXNzb3JOYW1lKCk7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHRoaXMuZXh0cmFjdENvcnJlbGF0aW9uSWRGcm9tRXZlbnQoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgLy8gQ3JlYXRlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgY29uc3QgZXhlY0N0eCA9IGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQoe1xuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIHNvdXJjZTogYCR7cHJvY2Vzc29yTmFtZX0ucHJvY2Vzc2AsXG4gICAgfSk7XG5cbiAgICAvLyBSdW4gaGFuZGxlciB3aXRoaW4gZXhlY3V0aW9uIGNvbnRleHRcbiAgICByZXR1cm4gcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoZXhlY0N0eCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydChgJHtldmVudFNvdXJjZX0gJHtwcm9jZXNzb3JOYW1lfWAsIHtcbiAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICdldmVudC5zb3VyY2UnOiBldmVudFNvdXJjZSxcbiAgICAgICAgICAnZXZlbnQucmVjb3JkQ291bnQnOiBldmVudC5SZWNvcmRzPy5sZW5ndGggPz8gMCxcbiAgICAgICAgICAncHJvY2Vzc29yLm1vZGUnOiB0aGlzLnByb2Nlc3NNb2RlLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIGV4ZWNDdHgucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gc3Bhbi5pZDtcblxuICAgICAgY29uc3QgY3R4OiBFdmVudFByb2Nlc3NvckNvbnRleHQ8VEV2ZW50PiA9IHtcbiAgICAgICAgZXZlbnQsXG4gICAgICAgIGxhbWJkYUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICAgIGV4ZWN1dGlvbkNvbnRleHQ6IGV4ZWNDdHgsXG4gICAgICB9O1xuXG4gICAgICBsZXQgc3BhbkVuZGVkID0gZmFsc2U7XG4gICAgICBjb25zdCBlbmRTcGFuID0gYXN5bmMgKHN1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogRXJyb3IpOiBQcm9taXNlPHZvaWQ+ID0+IHtcbiAgICAgICAgaWYgKCFzcGFuRW5kZWQpIHtcbiAgICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3MsIGVycm9yIH0pO1xuICAgICAgICAgIHNwYW5FbmRlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5mbHVzaE9ic2VydmFiaWxpdHkoKTtcbiAgICAgIH07XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG4gICAgICAgIGF3YWl0IHRoaXMucHJvY2VzcyhldmVudCwgY29udGV4dCwgY3R4KTtcbiAgICAgICAgYXdhaXQgZW5kU3Bhbih0cnVlKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGF3YWl0IGVuZFNwYW4oZmFsc2UsIGVycm9yIGFzIEVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBjb3JyZWxhdGlvbiBJRCBmcm9tIGV2ZW50LlxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RDb3JyZWxhdGlvbklkRnJvbUV2ZW50KGV2ZW50OiBURXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBzdHJpbmcge1xuICAgIC8vIFRyeSBTUVMgbWVzc2FnZSBhdHRyaWJ1dGVzXG4gICAgaWYgKCdSZWNvcmRzJyBpbiBldmVudCAmJiBldmVudC5SZWNvcmRzPy5bIDAgXSkge1xuICAgICAgY29uc3QgcmVjb3JkID0gZXZlbnQuUmVjb3Jkc1sgMCBdO1xuICAgICAgaWYgKCdtZXNzYWdlQXR0cmlidXRlcycgaW4gcmVjb3JkKSB7XG4gICAgICAgIGNvbnN0IHNxc1JlY29yZCA9IHJlY29yZCBhcyBTUVNFdmVudFsgJ1JlY29yZHMnIF1bIDAgXTtcbiAgICAgICAgY29uc3QgdHJhY2VDdHggPSBleHRyYWN0RnJvbVNxcyhzcXNSZWNvcmQubWVzc2FnZUF0dHJpYnV0ZXMpO1xuICAgICAgICBpZiAodHJhY2VDdHg/LmNvcnJlbGF0aW9uSWQpIHJldHVybiB0cmFjZUN0eC5jb3JyZWxhdGlvbklkO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gY29udGV4dC5hd3NSZXF1ZXN0SWQgfHwgY3J5cHRvLnJhbmRvbVVVSUQoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzIHRoZSBldmVudC4gQ2FuIGJlIG92ZXJyaWRkZW4gZm9yIGN1c3RvbSBwcm9jZXNzaW5nLlxuICAgKi9cbiAgYXN5bmMgcHJvY2VzcyhcbiAgICBldmVudDogVEV2ZW50LFxuICAgIF9jb250ZXh0OiBDb250ZXh0LFxuICAgIF9jdHg/OiBFdmVudFByb2Nlc3NvckNvbnRleHQ8VEV2ZW50PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnRXh0cmFjdGluZyByZWNvcmRzIHVzaW5nIGRhdGEgZXh0cmFjdG9yJyk7XG5cbiAgICBjb25zdCByZWNvcmRzID0gdGhpcy5ldmVudERhdGFFeHRyYWN0b3IuZXh0cmFjdERhdGEoZXZlbnQpO1xuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ0V4dHJhY3RlZCByZWNvcmRzIGZvciBwcm9jZXNzaW5nJywge1xuICAgICAgcmVjb3JkQ291bnQ6IHJlY29yZHMubGVuZ3RoLFxuICAgICAgcHJvY2Vzc01vZGU6IHRoaXMucHJvY2Vzc01vZGUsXG4gICAgfSk7XG5cbiAgICBpZiAocmVjb3Jkcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ05vIHJlY29yZHMgZXh0cmFjdGVkIGZvciBwcm9jZXNzaW5nIGZyb20gdGhlIGV2ZW50LicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucHJvY2Vzc1JlY29yZHMocmVjb3Jkcyk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1JlY29yZHMocmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPltdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnU3RhcnRpbmcgcmVjb3JkIHByb2Nlc3NpbmcnLCB7XG4gICAgICByZWNvcmRDb3VudDogcmVjb3Jkcy5sZW5ndGgsXG4gICAgICBwcm9jZXNzTW9kZTogdGhpcy5wcm9jZXNzTW9kZSxcbiAgICB9KTtcblxuICAgIC8vIFByZXByb2Nlc3MgYW5kIGZpbHRlclxuICAgIGNvbnN0IHByZXByb2Nlc3NlZDogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPltdID0gW107XG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVjb3Jkcykge1xuICAgICAgY29uc3QgcHJvY2Vzc2VkID0gYXdhaXQgdGhpcy5wcmVwcm9jZXNzUmVjb3JkKHJlY29yZCk7XG4gICAgICBpZiAoIXByb2Nlc3NlZCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnUmVjb3JkIGZpbHRlcmVkIG91dCBkdXJpbmcgcHJlcHJvY2Vzc2luZycsIHtcbiAgICAgICAgICBldmVudElkOiByZWNvcmQuZXZlbnRJZCxcbiAgICAgICAgICBlbnRpdHlOYW1lOiByZWNvcmQuZW50aXR5TmFtZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgcHJlcHJvY2Vzc2VkLnB1c2gocHJvY2Vzc2VkKTtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnUHJlcHJvY2Vzc2luZyBjb21wbGV0ZWQnLCB7XG4gICAgICBvcmlnaW5hbENvdW50OiByZWNvcmRzLmxlbmd0aCxcbiAgICAgIHByZXByb2Nlc3NlZENvdW50OiBwcmVwcm9jZXNzZWQubGVuZ3RoLFxuICAgICAgZmlsdGVyZWRDb3VudDogcmVjb3Jkcy5sZW5ndGggLSBwcmVwcm9jZXNzZWQubGVuZ3RoLFxuICAgICAgcHJvY2Vzc01vZGU6IHRoaXMucHJvY2Vzc01vZGUsXG4gICAgfSk7XG5cbiAgICBpZiAocHJlcHJvY2Vzc2VkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ05vIHJlY29yZHMgdG8gcHJvY2VzcyBhZnRlciBwcmVwcm9jZXNzaW5nLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnByb2Nlc3NNb2RlID09PSAnYmF0Y2gnKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZygnRXhlY3V0aW5nIGJhdGNoIHByb2Nlc3NpbmcgbW9kZScsIHsgcmVjb3JkQ291bnQ6IHByZXByb2Nlc3NlZC5sZW5ndGggfSk7XG4gICAgICBhd2FpdCB0aGlzLnByb2Nlc3NSZWNvcmRzQmF0Y2gocHJlcHJvY2Vzc2VkKTtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdCYXRjaCBwcm9jZXNzaW5nIGNvbXBsZXRlZCwgcnVubmluZyBwb3N0cHJvY2Vzc29ycycpO1xuICAgICAgZm9yIChjb25zdCByZWMgb2YgcHJlcHJvY2Vzc2VkKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucG9zdHByb2Nlc3NSZWNvcmQocmVjKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ0V4ZWN1dGluZyByZWNvcmQtYnktcmVjb3JkIHByb2Nlc3NpbmcgbW9kZScsIHsgcmVjb3JkQ291bnQ6IHByZXByb2Nlc3NlZC5sZW5ndGggfSk7XG4gICAgICBjb25zdCBwcm9jZXNzUHJvbWlzZXMgPSBwcmVwcm9jZXNzZWQubWFwKGFzeW5jIChwcm9jZXNzZWRSZWNvcmQpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5wcm9jZXNzUmVjb3JkKHByb2Nlc3NlZFJlY29yZCk7XG4gICAgICAgIGF3YWl0IHRoaXMucG9zdHByb2Nlc3NSZWNvcmQocHJvY2Vzc2VkUmVjb3JkKTtcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocHJvY2Vzc1Byb21pc2VzKTtcbiAgICB9XG5cbiAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ1JlY29yZCBwcm9jZXNzaW5nIGNvbXBsZXRlZCcsIHtcbiAgICAgIHByb2Nlc3NlZENvdW50OiBwcmVwcm9jZXNzZWQubGVuZ3RoLFxuICAgICAgcHJvY2Vzc01vZGU6IHRoaXMucHJvY2Vzc01vZGUsXG4gICAgICBkdXJhdGlvbk1zOiBkdXJhdGlvbixcbiAgICAgIGF2Z1RpbWVQZXJSZWNvcmQ6IGR1cmF0aW9uIC8gcHJlcHJvY2Vzc2VkLmxlbmd0aCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKiBQcm9jZXNzIGEgc2luZ2xlIHJlY29yZCAodXNlZCBpbiAncmVjb3JkJyBtb2RlKSAqL1xuICBwcm90ZWN0ZWQgYWJzdHJhY3QgcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD4pOiBQcm9taXNlPHZvaWQ+O1xuXG4gIC8qKiBQcm9jZXNzIGFsbCByZWNvcmRzIGF0IG9uY2UgKHVzZWQgaW4gJ2JhdGNoJyBtb2RlKSAqL1xuICBwcm90ZWN0ZWQgYWJzdHJhY3QgcHJvY2Vzc1JlY29yZHNCYXRjaChyZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+W10pOiBQcm9taXNlPHZvaWQ+O1xuXG4gIC8qKiBQcmVwcm9jZXNzIGEgcmVjb3JkIGJlZm9yZSBwcm9jZXNzaW5nLiBSZXR1cm4gbnVsbCB0byBmaWx0ZXIgb3V0LiAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgcHJlcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD4pOiBQcm9taXNlPEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD4gfCBudWxsPiB7XG4gICAgcmV0dXJuIHJlY29yZDtcbiAgfVxuXG4gIC8qKiBQb3N0cHJvY2VzcyBhIHJlY29yZCBhZnRlciBwcm9jZXNzaW5nICovXG4gIHByb3RlY3RlZCBhc3luYyBwb3N0cHJvY2Vzc1JlY29yZChfcmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+KTogUHJvbWlzZTx2b2lkPiB7IH1cbn1cblxuZXhwb3J0IHsgQmFzZVNRU0V2ZW50UHJvY2Vzc29yIH07XG4iXX0=