export type EventType = string;
export interface BaseEventRecord<P extends Record<string, any> = Record<string, any>> {
    eventId?: string;
    eventType: EventType;
    entityName?: string;
    entityId?: string | number | Record<string, any>;
    payload: P;
    timestamp?: number;
    eventSource?: string;
    metadata?: {
        rawSourceEventName?: string;
        [key: string]: any;
    };
}
export interface ChangeStreamPayload {
    oldImage?: Record<string, any>;
    newImage?: Record<string, any>;
    keys?: Record<string, any>;
}
export interface IEventDataExtractor<TInputEvent = any, P extends Record<string, any> = Record<string, any>> {
    extractData(event: TInputEvent): BaseEventRecord<P>[];
}
