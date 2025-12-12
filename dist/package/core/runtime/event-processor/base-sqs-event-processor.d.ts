import { SQSEvent, Context, DynamoDBStreamEvent } from "aws-lambda";
import { AbstractLambdaHandler } from "../abstract-lambda-handler";
import { BaseEventRecord, IEventDataExtractor } from "../../types/event-processor-types";
import { ExecutionContextData } from '../execution-context';
/**
 * Supported event types for stream/queue processing.
 */
export type StreamEvent = SQSEvent | DynamoDBStreamEvent;
/**
 * Execution context for event processors.
 */
export interface EventProcessorContext<TEvent extends StreamEvent = StreamEvent> {
    readonly event: TEvent;
    readonly lambdaContext: Context;
    readonly executionContext: ExecutionContextData;
}
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
declare abstract class BaseSQSEventProcessor<T extends IEventDataExtractor<TEvent, TPayload>, TEvent extends StreamEvent = StreamEvent, TPayload extends Record<string, any> = Record<string, any>> extends AbstractLambdaHandler {
    protected eventDataExtractor: T;
    protected processMode: 'record' | 'batch';
    constructor(extractor: T, options?: {
        processMode?: 'record' | 'batch';
    });
    /**
     * Initialize the processor. Override in subclass.
     */
    initialize(_event: TEvent, _context: Context): Promise<void>;
    protected getProcessorName(): string;
    LambdaHandler(event: TEvent, context: Context): Promise<void>;
    /**
     * Extract correlation ID from event.
     */
    protected extractCorrelationIdFromEvent(event: TEvent, context: Context): string;
    /**
     * Process the event. Can be overridden for custom processing.
     */
    process(event: TEvent, _context: Context, _ctx?: EventProcessorContext<TEvent>): Promise<void>;
    protected processRecords(records: BaseEventRecord<TPayload>[]): Promise<void>;
    /** Process a single record (used in 'record' mode) */
    protected abstract processRecord(record: BaseEventRecord<TPayload>): Promise<void>;
    /** Process all records at once (used in 'batch' mode) */
    protected abstract processRecordsBatch(records: BaseEventRecord<TPayload>[]): Promise<void>;
    /** Preprocess a record before processing. Return null to filter out. */
    protected preprocessRecord(record: BaseEventRecord<TPayload>): Promise<BaseEventRecord<TPayload> | null>;
    /** Postprocess a record after processing */
    protected postprocessRecord(_record: BaseEventRecord<TPayload>): Promise<void>;
}
export { BaseSQSEventProcessor };
