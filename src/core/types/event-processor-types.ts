export type EventType = string; // e.g., 'ENTITY_CREATED', 'ENTITY_UPDATED', 'ENTITY_DELETED', 'MANUAL_INDEX_REQUEST'

export interface BaseEventRecord<P extends Record<string, any> = Record<string, any>> {
  eventId?: string;
  eventType: EventType;
  entityName?: string;
  entityId?: string | number | Record<string, any>;
  payload: P;
  timestamp?: number; // Unix epoch milliseconds (e.g., 1734567890000 for "2024-12-19T10:31:30.000Z")
  eventSource?: string;
  metadata?: {
    rawSourceEventName?: string; // e.g., "INSERT", "MODIFY" from DynamoDB
    [ key: string ]: any; // For other source-specific metadata
  };
  /** Upstream trace context for per-record causedBy linkage (set by framework) */
  traceContext?: {
    correlationId?: string;
    causedBy?: string;
  };
}

export interface ChangeStreamPayload {
  oldImage?: Record<string, any>;
  newImage?: Record<string, any>;
  keys?: Record<string, any>; // Useful if only keys are available or changed
}

export interface IEventDataExtractor<TInputEvent = any, P extends Record<string, any> = Record<string, any>> {
  extractData(event: TInputEvent): BaseEventRecord<P>[];
}