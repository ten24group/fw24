import { SQSEvent, Context, DynamoDBStreamEvent } from "aws-lambda";
import { QueueController } from "../sqs-controller";
import { BaseEventRecord, IEventDataExtractor } from "../../types/event-processor-types";
/**
 * Base class for handling SQS events.
 */
declare abstract class BaseSQSEventProcessor<T extends IEventDataExtractor<TEvent, TPayload>, TEvent extends DynamoDBStreamEvent | SQSEvent = any, TPayload extends Record<string, any> = Record<string, any>> extends QueueController {
    protected eventDataExtractor: T;
    protected processMode: 'record' | 'batch';
    constructor(extractor: T, options?: {
        processMode?: 'record' | 'batch';
    });
    abstract initialize(event: TEvent | SQSEvent, context: Context): Promise<any>;
    LambdaHandler(event: TEvent | SQSEvent, context: Context): Promise<void>;
    process(event: TEvent, _context: Context): Promise<void>;
    protected processRecords(records: BaseEventRecord<TPayload>[]): Promise<void>;
    protected abstract processRecord(record: BaseEventRecord<TPayload>): Promise<void>;
    protected abstract processRecordsBatch(records: BaseEventRecord<TPayload>[]): Promise<void>;
    protected preprocessRecord(record: BaseEventRecord<TPayload>): Promise<BaseEventRecord<TPayload> | null>;
    protected postprocessRecord(_record: BaseEventRecord<TPayload>): Promise<void>;
}
export { BaseSQSEventProcessor };
