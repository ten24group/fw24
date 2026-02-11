"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseSQSEventProcessor = void 0;
const observability_1 = require("../../../observability");
const execution_context_1 = require("../execution-context");
const sqs_controller_1 = require("../sqs-controller");
/**
 * Base class for handling stream events (SQS or DynamoDB Streams) with data extraction.
 *
 * Extends QueueController to reuse trace extraction logic.
 * Adds the data extractor pattern for transforming raw events into BaseEventRecord.
 *
 * Key difference from QueueController: uses eventId-based matching to attach trace
 * contexts to extracted records, avoiding index misalignment when records fail to parse.
 */
class BaseSQSEventProcessor extends sqs_controller_1.QueueController {
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
    getProcessorName() {
        return this.constructor.name;
    }
    /**
     * Index pre-extracted traces by eventId for O(1) lookup.
     */
    indexTracesByEventId(event, traces) {
        const traceMap = new Map();
        if (!('Records' in event) || !event.Records)
            return traceMap;
        const rawRecords = event.Records;
        for (let i = 0; i < rawRecords.length; i++) {
            const eventId = rawRecords[i].eventID || rawRecords[i].messageId;
            const trace = traces[i];
            if (eventId && trace?.correlationId) {
                traceMap.set(eventId, trace);
            }
        }
        return traceMap;
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
        const recordTraces = this.extractPerRecordTraceContexts(event);
        const { batchCausedBy, batchUpstreamCorrelationId, isMixedBatch } = this.aggregateBatchTraceContext(recordTraces);
        const invocationId = context.awsRequestId || (0, observability_1.generateTraceId)();
        // Strict hierarchy guarantee: correlationId is per-invocation (local slice).
        // Upstream correlationId becomes causedBy.
        const correlationId = invocationId;
        const processorActor = {
            actorType: 'service',
            authMethod: 'system',
            actorId: `processor:${processorName}`,
            requestId: invocationId,
            timestamp: new Date().toISOString(),
            correlationId,
        };
        const execCtx = (0, execution_context_1.createExecutionContext)({
            correlationId,
            causedBy: batchCausedBy,
            actor: processorActor,
            source: `${processorName}.process`,
        });
        return (0, execution_context_1.runWithExecutionContext)(execCtx, async () => {
            // Use the base class helper for span + flush pattern
            return this.executeWithSpanAndFlush(`${eventSource} ${processorName}`, async (processorSpan) => {
                await this.initialize(event, context);
                // SQS retry detection — tag when messages are being reprocessed
                const rawRecords = event.Records;
                if (rawRecords && rawRecords.length > 0) {
                    const receiveCounts = rawRecords.map((r) => parseInt(r.attributes?.ApproximateReceiveCount ?? '1', 10));
                    const maxReceiveCount = Math.max(...receiveCounts);
                    const retryCount = receiveCounts.filter((c) => c > 1).length;
                    if (retryCount > 0) {
                        processorSpan.tag('sqs.has_retries', 'true');
                        processorSpan.metrics({
                            'sqs.retry_count': retryCount,
                            'sqs.max_receive_count': maxReceiveCount,
                        });
                    }
                }
                await this.process(event, context);
            }, {
                correlationId: execCtx.correlationId,
                causedBy: batchCausedBy,
                tags: {
                    handler_type: 'event_processor',
                    processor_name: processorName,
                    event_source: eventSource,
                    operation_category: 'event_processing',
                    'processor.mode': this.processMode,
                    ...(isMixedBatch ? { 'trace.mixed': 'true' } : {}),
                    invocationId,
                },
                metrics: {
                    'event.recordCount': event.Records?.length ?? 0,
                },
            }, context);
        });
    }
    /**
     * Process event with pre-built trace map.
     */
    async processWithTraceMap(event, traceMap) {
        const records = this.eventDataExtractor.extractData(event);
        // Attach trace by eventId (O(1) lookup, avoids index misalignment)
        for (const record of records) {
            const trace = traceMap.get(record.eventId || '');
            if (trace?.correlationId) {
                record.traceContext = {
                    correlationId: trace.correlationId,
                    causedBy: trace.causedBy || trace.correlationId,
                };
            }
        }
        this.logger.debug('Extracted records', { count: records.length, mode: this.processMode });
        if (records.length === 0) {
            this.logger.info('No records extracted for processing.');
            return;
        }
        await this.processRecords(records);
    }
    /**
     * Implement QueueController's abstract process method.
     * Called when used directly (not through LambdaHandler).
     */
    async process(event, _context, _ctx) {
        const traces = this.extractPerRecordTraceContexts(event);
        const traceMap = this.indexTracesByEventId(event, traces);
        await this.processWithTraceMap(event, traceMap);
        return { batchItemFailures: [] };
    }
    /**
     * Process records using BatchProgress for automatic tracking and observability.
     * Handles both batch and individual record processing modes.
     */
    async processRecords(records) {
        const processorName = this.getProcessorName();
        // Apply preprocessing filter to all records
        const filteredRecords = [];
        for (const record of records) {
            const processed = await this.preprocessRecord(record);
            if (processed) {
                filteredRecords.push(processed);
            }
        }
        if (filteredRecords.length === 0) {
            this.logger.debug('No records after filtering');
            return;
        }
        if (this.processMode === 'batch') {
            // Batch mode: process all records at once (useful for bulk operations)
            const { summary } = await observability_1.BatchProgress.all(`${processorName} Batch`, filteredRecords, async (items) => {
                await this.processRecordsBatch(items);
                // Run postprocess for each item
                for (const record of items) {
                    await this.postprocessRecord(record);
                }
                return items;
            }, { tags: { processor: processorName } });
            this.onBatchComplete(summary);
        }
        else {
            // Record mode: process each record individually with its own span
            const { summary } = await observability_1.BatchProgress.process(processorName, filteredRecords, async (record, ctx) => {
                // In strict-hierarchy mode:
                // - correlationId stays per-invocation (batch context)
                // - causedBy links to the upstream correlationId for this record (if present)
                const upstream = record.traceContext?.correlationId;
                await observability_1.SpanObserver.withSpan(`${processorName} record`, async () => {
                    await this.processRecord(record);
                    await this.postprocessRecord(record);
                }, {
                    causedBy: upstream,
                    // Production behavior: per-record span capture can be group-sampled.
                    capture: ctx.getCaptureControl(),
                    tags: {
                        eventId: record.eventId || '',
                        entity: record.entityName || '',
                        type: record.eventType || '',
                    },
                });
                return record;
            }, { tags: { processor: processorName } });
            this.onBatchComplete(summary);
        }
    }
    /**
     * Called when batch processing completes. Override to add custom behavior.
     */
    onBatchComplete(_summary) {
        // Override in subclass if needed
    }
    async preprocessRecord(record) {
        return record;
    }
    async postprocessRecord(_record) { }
}
exports.BaseSQSEventProcessor = BaseSQSEventProcessor;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS9ldmVudC1wcm9jZXNzb3IvYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLDBEQUF5RztBQUN6Ryw0REFJOEI7QUFDOUIsc0RBQWlIO0FBR2pIOzs7Ozs7OztHQVFHO0FBQ0gsTUFBZSxxQkFJYixTQUFRLGdDQUF1QjtJQUVyQixrQkFBa0IsQ0FBSTtJQUN0QixXQUFXLEdBQXVCLFFBQVEsQ0FBQztJQUVyRCxZQUFZLFNBQVksRUFBRSxPQUE4QztRQUN0RSxLQUFLLEVBQUUsQ0FBQztRQUNSLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNmLE1BQU0sSUFBSSxLQUFLLENBQUMsMkRBQTJELENBQUMsQ0FBQztRQUMvRSxDQUFDO1FBQ0QsSUFBSSxDQUFDLGtCQUFrQixHQUFHLFNBQVMsQ0FBQztRQUNwQyxJQUFJLE9BQU8sRUFBRSxXQUFXLEVBQUUsQ0FBQztZQUN6QixJQUFJLENBQUMsV0FBVyxHQUFHLE9BQU8sQ0FBQyxXQUFXLENBQUM7UUFDekMsQ0FBQztJQUNILENBQUM7SUFFUyxnQkFBZ0I7UUFDeEIsT0FBTyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztJQUMvQixDQUFDO0lBRUQ7O09BRUc7SUFDSyxvQkFBb0IsQ0FDMUIsS0FBYSxFQUNiLE1BQTBDO1FBRTFDLE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxFQUE4QixDQUFDO1FBQ3ZELElBQUksQ0FBQyxDQUFDLFNBQVMsSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPO1lBQUUsT0FBTyxRQUFRLENBQUM7UUFFN0QsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLE9BQWdCLENBQUM7UUFDMUMsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FB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QWUsQ0FBQyxRQUFzQjtRQUM5QyxpQ0FBaUM7SUFDbkMsQ0FBQztJQUtTLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFpQztRQUNoRSxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0lBRVMsS0FBSyxDQUFDLGlCQUFpQixDQUFDLE9BQWtDLElBQW1CLENBQUM7Q0FDekY7QUFFUSxzREFBcUIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCwgSUV2ZW50RGF0YUV4dHJhY3RvciB9IGZyb20gXCIuLi8uLi90eXBlcy9ldmVudC1wcm9jZXNzb3ItdHlwZXNcIjtcbmltcG9ydCB7IFNwYW5PYnNlcnZlciwgZ2VuZXJhdGVUcmFjZUlkLCBCYXRjaFByb2dyZXNzLCB0eXBlIEJhdGNoU3VtbWFyeSB9IGZyb20gJy4uLy4uLy4uL29ic2VydmFiaWxpdHknO1xuaW1wb3J0IHtcbiAgY3JlYXRlRXhlY3V0aW9uQ29udGV4dCxcbiAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQsXG4gIFBhcnNlZFRyYWNlQ29udGV4dCxcbn0gZnJvbSAnLi4vZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgUXVldWVDb250cm9sbGVyLCBRdWV1ZVN0cmVhbUV2ZW50LCBRdWV1ZUV4ZWN1dGlvbkNvbnRleHQsIFF1ZXVlUHJvY2Vzc1Jlc3VsdCB9IGZyb20gJy4uL3Nxcy1jb250cm9sbGVyJztcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSAnLi4vLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGhhbmRsaW5nIHN0cmVhbSBldmVudHMgKFNRUyBvciBEeW5hbW9EQiBTdHJlYW1zKSB3aXRoIGRhdGEgZXh0cmFjdGlvbi5cbiAqIFxuICogRXh0ZW5kcyBRdWV1ZUNvbnRyb2xsZXIgdG8gcmV1c2UgdHJhY2UgZXh0cmFjdGlvbiBsb2dpYy5cbiAqIEFkZHMgdGhlIGRhdGEgZXh0cmFjdG9yIHBhdHRlcm4gZm9yIHRyYW5zZm9ybWluZyByYXcgZXZlbnRzIGludG8gQmFzZUV2ZW50UmVjb3JkLlxuICogXG4gKiBLZXkgZGlmZmVyZW5jZSBmcm9tIFF1ZXVlQ29udHJvbGxlcjogdXNlcyBldmVudElkLWJhc2VkIG1hdGNoaW5nIHRvIGF0dGFjaCB0cmFjZVxuICogY29udGV4dHMgdG8gZXh0cmFjdGVkIHJlY29yZHMsIGF2b2lkaW5nIGluZGV4IG1pc2FsaWdubWVudCB3aGVuIHJlY29yZHMgZmFpbCB0byBwYXJzZS5cbiAqL1xuYWJzdHJhY3QgY2xhc3MgQmFzZVNRU0V2ZW50UHJvY2Vzc29yPFxuICBUIGV4dGVuZHMgSUV2ZW50RGF0YUV4dHJhY3RvcjxURXZlbnQsIFRQYXlsb2FkPixcbiAgVEV2ZW50IGV4dGVuZHMgUXVldWVTdHJlYW1FdmVudCA9IFF1ZXVlU3RyZWFtRXZlbnQsXG4gIFRQYXlsb2FkIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55PiA9IFJlY29yZDxzdHJpbmcsIGFueT5cbj4gZXh0ZW5kcyBRdWV1ZUNvbnRyb2xsZXI8VEV2ZW50PiB7XG5cbiAgcHJvdGVjdGVkIGV2ZW50RGF0YUV4dHJhY3RvcjogVDtcbiAgcHJvdGVjdGVkIHByb2Nlc3NNb2RlOiAncmVjb3JkJyB8ICdiYXRjaCcgPSAncmVjb3JkJztcblxuICBjb25zdHJ1Y3RvcihleHRyYWN0b3I6IFQsIG9wdGlvbnM/OiB7IHByb2Nlc3NNb2RlPzogJ3JlY29yZCcgfCAnYmF0Y2gnIH0pIHtcbiAgICBzdXBlcigpO1xuICAgIGlmICghZXh0cmFjdG9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0lFdmVudERhdGFFeHRyYWN0b3IgaXMgcmVxdWlyZWQgZm9yIEJhc2VTUVNFdmVudFByb2Nlc3NvcicpO1xuICAgIH1cbiAgICB0aGlzLmV2ZW50RGF0YUV4dHJhY3RvciA9IGV4dHJhY3RvcjtcbiAgICBpZiAob3B0aW9ucz8ucHJvY2Vzc01vZGUpIHtcbiAgICAgIHRoaXMucHJvY2Vzc01vZGUgPSBvcHRpb25zLnByb2Nlc3NNb2RlO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRQcm9jZXNzb3JOYW1lKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuY29uc3RydWN0b3IubmFtZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbmRleCBwcmUtZXh0cmFjdGVkIHRyYWNlcyBieSBldmVudElkIGZvciBPKDEpIGxvb2t1cC5cbiAgICovXG4gIHByaXZhdGUgaW5kZXhUcmFjZXNCeUV2ZW50SWQoXG4gICAgZXZlbnQ6IFRFdmVudCxcbiAgICB0cmFjZXM6IChQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQpW11cbiAgKTogTWFwPHN0cmluZywgUGFyc2VkVHJhY2VDb250ZXh0PiB7XG4gICAgY29uc3QgdHJhY2VNYXAgPSBuZXcgTWFwPHN0cmluZywgUGFyc2VkVHJhY2VDb250ZXh0PigpO1xuICAgIGlmICghKCdSZWNvcmRzJyBpbiBldmVudCkgfHwgIWV2ZW50LlJlY29yZHMpIHJldHVybiB0cmFjZU1hcDtcblxuICAgIGNvbnN0IHJhd1JlY29yZHMgPSBldmVudC5SZWNvcmRzIGFzIGFueVtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmF3UmVjb3Jkcy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgZXZlbnRJZCA9IHJhd1JlY29yZHNbIGkgXS5ldmVudElEIHx8IHJhd1JlY29yZHNbIGkgXS5tZXNzYWdlSWQ7XG4gICAgICBjb25zdCB0cmFjZSA9IHRyYWNlc1sgaSBdO1xuICAgICAgaWYgKGV2ZW50SWQgJiYgdHJhY2U/LmNvcnJlbGF0aW9uSWQpIHtcbiAgICAgICAgdHJhY2VNYXAuc2V0KGV2ZW50SWQsIHRyYWNlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRyYWNlTWFwO1xuICB9XG5cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihldmVudDogVEV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZXZlbnRTb3VyY2UgPSBldmVudC5SZWNvcmRzPy5bIDAgXT8uZXZlbnRTb3VyY2UgPz8gJ1Vua25vd24nO1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdQcm9jZXNzaW5nIGluY29taW5nIHN0cmVhbSBldmVudCcsIHtcbiAgICAgIGV2ZW50U291cmNlRnJvbVJlY29yZDogZXZlbnRTb3VyY2UsXG4gICAgICByZWNvcmRDb3VudDogZXZlbnQuUmVjb3Jkcz8ubGVuZ3RoLFxuICAgICAgcHJvY2Vzc01vZGU6IHRoaXMucHJvY2Vzc01vZGUsXG4gICAgfSk7XG5cbiAgICB0aGlzLmluaXRpYWxpemVFbnRyeVBhY2thZ2VzQW5kT2JzZXJ2YWJpbGl0eSgpO1xuXG4gICAgY29uc3QgcHJvY2Vzc29yTmFtZSA9IHRoaXMuZ2V0UHJvY2Vzc29yTmFtZSgpO1xuXG4gICAgY29uc3QgcmVjb3JkVHJhY2VzID0gdGhpcy5leHRyYWN0UGVyUmVjb3JkVHJhY2VDb250ZXh0cyhldmVudCk7XG4gICAgY29uc3QgeyBiYXRjaENhdXNlZEJ5LCBiYXRjaFVwc3RyZWFtQ29ycmVsYXRpb25JZCwgaXNNaXhlZEJhdGNoIH0gPSB0aGlzLmFnZ3JlZ2F0ZUJhdGNoVHJhY2VDb250ZXh0KHJlY29yZFRyYWNlcyk7XG5cbiAgICBjb25zdCBpbnZvY2F0aW9uSWQgPSBjb250ZXh0LmF3c1JlcXVlc3RJZCB8fCBnZW5lcmF0ZVRyYWNlSWQoKTtcbiAgICAvLyBTdHJpY3QgaGllcmFyY2h5IGd1YXJhbnRlZTogY29ycmVsYXRpb25JZCBpcyBwZXItaW52b2NhdGlvbiAobG9jYWwgc2xpY2UpLlxuICAgIC8vIFVwc3RyZWFtIGNvcnJlbGF0aW9uSWQgYmVjb21lcyBjYXVzZWRCeS5cbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gaW52b2NhdGlvbklkO1xuXG4gICAgY29uc3QgcHJvY2Vzc29yQWN0b3I6IEFjdG9yID0ge1xuICAgICAgYWN0b3JUeXBlOiAnc2VydmljZScsXG4gICAgICBhdXRoTWV0aG9kOiAnc3lzdGVtJyxcbiAgICAgIGFjdG9ySWQ6IGBwcm9jZXNzb3I6JHtwcm9jZXNzb3JOYW1lfWAsXG4gICAgICByZXF1ZXN0SWQ6IGludm9jYXRpb25JZCxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICB9O1xuXG4gICAgY29uc3QgZXhlY0N0eCA9IGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQoe1xuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIGNhdXNlZEJ5OiBiYXRjaENhdXNlZEJ5LFxuICAgICAgYWN0b3I6IHByb2Nlc3NvckFjdG9yLFxuICAgICAgc291cmNlOiBgJHtwcm9jZXNzb3JOYW1lfS5wcm9jZXNzYCxcbiAgICB9KTtcblxuICAgIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChleGVjQ3R4LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBVc2UgdGhlIGJhc2UgY2xhc3MgaGVscGVyIGZvciBzcGFuICsgZmx1c2ggcGF0dGVyblxuICAgICAgcmV0dXJuIHRoaXMuZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2goXG4gICAgICAgIGAke2V2ZW50U291cmNlfSAke3Byb2Nlc3Nvck5hbWV9YCxcbiAgICAgICAgYXN5bmMgKHByb2Nlc3NvclNwYW4pID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgICAgICAgLy8gU1FTIHJldHJ5IGRldGVjdGlvbiDigJQgdGFnIHdoZW4gbWVzc2FnZXMgYXJlIGJlaW5nIHJlcHJvY2Vzc2VkXG4gICAgICAgICAgY29uc3QgcmF3UmVjb3JkcyA9IChldmVudCBhcyB1bmtub3duIGFzIHsgUmVjb3Jkcz86IEFycmF5PHsgYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfT4gfSkuUmVjb3JkcztcbiAgICAgICAgICBpZiAocmF3UmVjb3JkcyAmJiByYXdSZWNvcmRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IHJlY2VpdmVDb3VudHMgPSByYXdSZWNvcmRzLm1hcChcbiAgICAgICAgICAgICAgKHIpID0+IHBhcnNlSW50KHIuYXR0cmlidXRlcz8uQXBwcm94aW1hdGVSZWNlaXZlQ291bnQgPz8gJzEnLCAxMClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBjb25zdCBtYXhSZWNlaXZlQ291bnQgPSBNYXRoLm1heCguLi5yZWNlaXZlQ291bnRzKTtcbiAgICAgICAgICAgIGNvbnN0IHJldHJ5Q291bnQgPSByZWNlaXZlQ291bnRzLmZpbHRlcigoYykgPT4gYyA+IDEpLmxlbmd0aDtcbiAgICAgICAgICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgICAgICAgICBwcm9jZXNzb3JTcGFuLnRhZygnc3FzLmhhc19yZXRyaWVzJywgJ3RydWUnKTtcbiAgICAgICAgICAgICAgcHJvY2Vzc29yU3Bhbi5tZXRyaWNzKHtcbiAgICAgICAgICAgICAgICAnc3FzLnJldHJ5X2NvdW50JzogcmV0cnlDb3VudCxcbiAgICAgICAgICAgICAgICAnc3FzLm1heF9yZWNlaXZlX2NvdW50JzogbWF4UmVjZWl2ZUNvdW50LFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhd2FpdCB0aGlzLnByb2Nlc3MoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY29ycmVsYXRpb25JZDogZXhlY0N0eC5jb3JyZWxhdGlvbklkLFxuICAgICAgICAgIGNhdXNlZEJ5OiBiYXRjaENhdXNlZEJ5LFxuICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgIGhhbmRsZXJfdHlwZTogJ2V2ZW50X3Byb2Nlc3NvcicsXG4gICAgICAgICAgICBwcm9jZXNzb3JfbmFtZTogcHJvY2Vzc29yTmFtZSxcbiAgICAgICAgICAgIGV2ZW50X3NvdXJjZTogZXZlbnRTb3VyY2UsXG4gICAgICAgICAgICBvcGVyYXRpb25fY2F0ZWdvcnk6ICdldmVudF9wcm9jZXNzaW5nJyxcbiAgICAgICAgICAgICdwcm9jZXNzb3IubW9kZSc6IHRoaXMucHJvY2Vzc01vZGUsXG4gICAgICAgICAgICAuLi4oaXNNaXhlZEJhdGNoID8geyAndHJhY2UubWl4ZWQnOiAndHJ1ZScgfSA6IHt9KSxcbiAgICAgICAgICAgIGludm9jYXRpb25JZCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICdldmVudC5yZWNvcmRDb3VudCc6IGV2ZW50LlJlY29yZHM/Lmxlbmd0aCA/PyAwLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGNvbnRleHRcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUHJvY2VzcyBldmVudCB3aXRoIHByZS1idWlsdCB0cmFjZSBtYXAuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NXaXRoVHJhY2VNYXAoZXZlbnQ6IFRFdmVudCwgdHJhY2VNYXA6IE1hcDxzdHJpbmcsIFBhcnNlZFRyYWNlQ29udGV4dD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZWNvcmRzID0gdGhpcy5ldmVudERhdGFFeHRyYWN0b3IuZXh0cmFjdERhdGEoZXZlbnQpO1xuXG4gICAgLy8gQXR0YWNoIHRyYWNlIGJ5IGV2ZW50SWQgKE8oMSkgbG9va3VwLCBhdm9pZHMgaW5kZXggbWlzYWxpZ25tZW50KVxuICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIHJlY29yZHMpIHtcbiAgICAgIGNvbnN0IHRyYWNlID0gdHJhY2VNYXAuZ2V0KHJlY29yZC5ldmVudElkIHx8ICcnKTtcbiAgICAgIGlmICh0cmFjZT8uY29ycmVsYXRpb25JZCkge1xuICAgICAgICByZWNvcmQudHJhY2VDb250ZXh0ID0ge1xuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHRyYWNlLmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgY2F1c2VkQnk6IHRyYWNlLmNhdXNlZEJ5IHx8IHRyYWNlLmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ0V4dHJhY3RlZCByZWNvcmRzJywgeyBjb3VudDogcmVjb3Jkcy5sZW5ndGgsIG1vZGU6IHRoaXMucHJvY2Vzc01vZGUgfSk7XG5cbiAgICBpZiAocmVjb3Jkcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ05vIHJlY29yZHMgZXh0cmFjdGVkIGZvciBwcm9jZXNzaW5nLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucHJvY2Vzc1JlY29yZHMocmVjb3Jkcyk7XG4gIH1cblxuICAvKipcbiAgICogSW1wbGVtZW50IFF1ZXVlQ29udHJvbGxlcidzIGFic3RyYWN0IHByb2Nlc3MgbWV0aG9kLlxuICAgKiBDYWxsZWQgd2hlbiB1c2VkIGRpcmVjdGx5IChub3QgdGhyb3VnaCBMYW1iZGFIYW5kbGVyKS5cbiAgICovXG4gIGFzeW5jIHByb2Nlc3MoZXZlbnQ6IFRFdmVudCwgX2NvbnRleHQ6IENvbnRleHQsIF9jdHg/OiBRdWV1ZUV4ZWN1dGlvbkNvbnRleHQ8VEV2ZW50Pik6IFByb21pc2U8UXVldWVQcm9jZXNzUmVzdWx0PiB7XG4gICAgY29uc3QgdHJhY2VzID0gdGhpcy5leHRyYWN0UGVyUmVjb3JkVHJhY2VDb250ZXh0cyhldmVudCk7XG4gICAgY29uc3QgdHJhY2VNYXAgPSB0aGlzLmluZGV4VHJhY2VzQnlFdmVudElkKGV2ZW50LCB0cmFjZXMpO1xuICAgIGF3YWl0IHRoaXMucHJvY2Vzc1dpdGhUcmFjZU1hcChldmVudCwgdHJhY2VNYXApO1xuICAgIHJldHVybiB7IGJhdGNoSXRlbUZhaWx1cmVzOiBbXSB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3MgcmVjb3JkcyB1c2luZyBCYXRjaFByb2dyZXNzIGZvciBhdXRvbWF0aWMgdHJhY2tpbmcgYW5kIG9ic2VydmFiaWxpdHkuXG4gICAqIEhhbmRsZXMgYm90aCBiYXRjaCBhbmQgaW5kaXZpZHVhbCByZWNvcmQgcHJvY2Vzc2luZyBtb2Rlcy5cbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBwcm9jZXNzUmVjb3JkcyhyZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+W10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBwcm9jZXNzb3JOYW1lID0gdGhpcy5nZXRQcm9jZXNzb3JOYW1lKCk7XG5cbiAgICAvLyBBcHBseSBwcmVwcm9jZXNzaW5nIGZpbHRlciB0byBhbGwgcmVjb3Jkc1xuICAgIGNvbnN0IGZpbHRlcmVkUmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPltdID0gW107XG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVjb3Jkcykge1xuICAgICAgY29uc3QgcHJvY2Vzc2VkID0gYXdhaXQgdGhpcy5wcmVwcm9jZXNzUmVjb3JkKHJlY29yZCk7XG4gICAgICBpZiAocHJvY2Vzc2VkKSB7XG4gICAgICAgIGZpbHRlcmVkUmVjb3Jkcy5wdXNoKHByb2Nlc3NlZCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZpbHRlcmVkUmVjb3Jkcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdObyByZWNvcmRzIGFmdGVyIGZpbHRlcmluZycpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnByb2Nlc3NNb2RlID09PSAnYmF0Y2gnKSB7XG4gICAgICAvLyBCYXRjaCBtb2RlOiBwcm9jZXNzIGFsbCByZWNvcmRzIGF0IG9uY2UgKHVzZWZ1bCBmb3IgYnVsayBvcGVyYXRpb25zKVxuICAgICAgY29uc3QgeyBzdW1tYXJ5IH0gPSBhd2FpdCBCYXRjaFByb2dyZXNzLmFsbChcbiAgICAgICAgYCR7cHJvY2Vzc29yTmFtZX0gQmF0Y2hgLFxuICAgICAgICBmaWx0ZXJlZFJlY29yZHMsXG4gICAgICAgIGFzeW5jIChpdGVtcykgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucHJvY2Vzc1JlY29yZHNCYXRjaChpdGVtcyk7XG5cbiAgICAgICAgICAvLyBSdW4gcG9zdHByb2Nlc3MgZm9yIGVhY2ggaXRlbVxuICAgICAgICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIGl0ZW1zKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBvc3Rwcm9jZXNzUmVjb3JkKHJlY29yZCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBpdGVtcztcbiAgICAgICAgfSxcbiAgICAgICAgeyB0YWdzOiB7IHByb2Nlc3NvcjogcHJvY2Vzc29yTmFtZSB9IH1cbiAgICAgICk7XG5cbiAgICAgIHRoaXMub25CYXRjaENvbXBsZXRlKHN1bW1hcnkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZWNvcmQgbW9kZTogcHJvY2VzcyBlYWNoIHJlY29yZCBpbmRpdmlkdWFsbHkgd2l0aCBpdHMgb3duIHNwYW5cbiAgICAgIGNvbnN0IHsgc3VtbWFyeSB9ID0gYXdhaXQgQmF0Y2hQcm9ncmVzcy5wcm9jZXNzKFxuICAgICAgICBwcm9jZXNzb3JOYW1lLFxuICAgICAgICBmaWx0ZXJlZFJlY29yZHMsXG4gICAgICAgIGFzeW5jIChyZWNvcmQsIGN0eCkgPT4ge1xuICAgICAgICAgIC8vIEluIHN0cmljdC1oaWVyYXJjaHkgbW9kZTpcbiAgICAgICAgICAvLyAtIGNvcnJlbGF0aW9uSWQgc3RheXMgcGVyLWludm9jYXRpb24gKGJhdGNoIGNvbnRleHQpXG4gICAgICAgICAgLy8gLSBjYXVzZWRCeSBsaW5rcyB0byB0aGUgdXBzdHJlYW0gY29ycmVsYXRpb25JZCBmb3IgdGhpcyByZWNvcmQgKGlmIHByZXNlbnQpXG4gICAgICAgICAgY29uc3QgdXBzdHJlYW0gPSByZWNvcmQudHJhY2VDb250ZXh0Py5jb3JyZWxhdGlvbklkO1xuXG4gICAgICAgICAgYXdhaXQgU3Bhbk9ic2VydmVyLndpdGhTcGFuKFxuICAgICAgICAgICAgYCR7cHJvY2Vzc29yTmFtZX0gcmVjb3JkYCxcbiAgICAgICAgICAgIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wcm9jZXNzUmVjb3JkKHJlY29yZCk7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucG9zdHByb2Nlc3NSZWNvcmQocmVjb3JkKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGNhdXNlZEJ5OiB1cHN0cmVhbSxcbiAgICAgICAgICAgICAgLy8gUHJvZHVjdGlvbiBiZWhhdmlvcjogcGVyLXJlY29yZCBzcGFuIGNhcHR1cmUgY2FuIGJlIGdyb3VwLXNhbXBsZWQuXG4gICAgICAgICAgICAgIGNhcHR1cmU6IGN0eC5nZXRDYXB0dXJlQ29udHJvbCgpLFxuICAgICAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAgICAgZXZlbnRJZDogcmVjb3JkLmV2ZW50SWQgfHwgJycsXG4gICAgICAgICAgICAgICAgZW50aXR5OiByZWNvcmQuZW50aXR5TmFtZSB8fCAnJyxcbiAgICAgICAgICAgICAgICB0eXBlOiByZWNvcmQuZXZlbnRUeXBlIHx8ICcnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfVxuICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuIHJlY29yZDtcbiAgICAgICAgfSxcbiAgICAgICAgeyB0YWdzOiB7IHByb2Nlc3NvcjogcHJvY2Vzc29yTmFtZSB9IH1cbiAgICAgICk7XG5cbiAgICAgIHRoaXMub25CYXRjaENvbXBsZXRlKHN1bW1hcnkpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgd2hlbiBiYXRjaCBwcm9jZXNzaW5nIGNvbXBsZXRlcy4gT3ZlcnJpZGUgdG8gYWRkIGN1c3RvbSBiZWhhdmlvci5cbiAgICovXG4gIHByb3RlY3RlZCBvbkJhdGNoQ29tcGxldGUoX3N1bW1hcnk6IEJhdGNoU3VtbWFyeSk6IHZvaWQge1xuICAgIC8vIE92ZXJyaWRlIGluIHN1YmNsYXNzIGlmIG5lZWRlZFxuICB9XG5cbiAgcHJvdGVjdGVkIGFic3RyYWN0IHByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+KTogUHJvbWlzZTx2b2lkPjtcbiAgcHJvdGVjdGVkIGFic3RyYWN0IHByb2Nlc3NSZWNvcmRzQmF0Y2gocmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPltdKTogUHJvbWlzZTx2b2lkPjtcblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJlcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD4pOiBQcm9taXNlPEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD4gfCBudWxsPiB7XG4gICAgcmV0dXJuIHJlY29yZDtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBwb3N0cHJvY2Vzc1JlY29yZChfcmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+KTogUHJvbWlzZTx2b2lkPiB7IH1cbn1cblxuZXhwb3J0IHsgQmFzZVNRU0V2ZW50UHJvY2Vzc29yIH07XG4iXX0=