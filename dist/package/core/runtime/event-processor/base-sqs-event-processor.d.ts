import { Context } from "aws-lambda";
import { BaseEventRecord, IEventDataExtractor } from "../../types/event-processor-types";
import { type BatchSummary } from '../../../observability';
import { QueueController, QueueStreamEvent, QueueExecutionContext, QueueProcessResult } from '../sqs-controller';
/**
 * Base class for handling stream events (SQS or DynamoDB Streams) with data extraction.
 *
 * Extends QueueController to reuse trace extraction logic.
 * Adds the data extractor pattern for transforming raw events into BaseEventRecord.
 *
 * Key difference from QueueController: uses eventId-based matching to attach trace
 * contexts to extracted records, avoiding index misalignment when records fail to parse.
 */
declare abstract class BaseSQSEventProcessor<T extends IEventDataExtractor<TEvent, TPayload>, TEvent extends QueueStreamEvent = QueueStreamEvent, TPayload extends Record<string, any> = Record<string, any>> extends QueueController<TEvent> {
    protected eventDataExtractor: T;
    protected processMode: 'record' | 'batch';
    constructor(extractor: T, options?: {
        processMode?: 'record' | 'batch';
    });
    protected getProcessorName(): string;
    /**
     * Index pre-extracted traces by eventId for O(1) lookup.
     */
    private indexTracesByEventId;
    LambdaHandler(event: TEvent, context: Context): Promise<void>;
    /**
     * Process event with pre-built trace map.
     */
    private processWithTraceMap;
    /**
     * Implement QueueController's abstract process method.
     * Called when used directly (not through LambdaHandler).
     */
    process(event: TEvent, _context: Context, _ctx?: QueueExecutionContext<TEvent>): Promise<QueueProcessResult>;
    /**
     * Process records using BatchProgress for automatic tracking and observability.
     * Handles both batch and individual record processing modes.
     */
    protected processRecords(records: BaseEventRecord<TPayload>[]): Promise<void>;
    /**
     * Called when batch processing completes. Override to add custom behavior.
     */
    protected onBatchComplete(_summary: BatchSummary): void;
    protected abstract processRecord(record: BaseEventRecord<TPayload>): Promise<void>;
    protected abstract processRecordsBatch(records: BaseEventRecord<TPayload>[]): Promise<void>;
    protected preprocessRecord(record: BaseEventRecord<TPayload>): Promise<BaseEventRecord<TPayload> | null>;
    protected postprocessRecord(_record: BaseEventRecord<TPayload>): Promise<void>;
}
export { BaseSQSEventProcessor };
