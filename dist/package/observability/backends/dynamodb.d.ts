/**
 * DynamoDB Backend for Observability
 *
 * Stores all observability events in DynamoDB.
 * All config injected via DI - no fallbacks.
 */
import { ObservabilityLogService } from '../storage/service';
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
export declare class DynamoDBObservabilityBackend implements ObservabilityBackend {
    private readonly service;
    readonly name = "dynamodb";
    readonly minLevel?: ObservabilityLevel;
    private buffer;
    private readonly ttlDays;
    constructor(ttlDays: number, minLevel: ObservabilityLevel, service: ObservabilityLogService);
    initializeInvocation(): void;
    capture(event: ObservabilityEvent): Promise<void>;
    flush(): Promise<void>;
    private static readonly RETRYABLE_ERRORS;
    private isRetryableError;
    private writeBatch;
    private mapEventToItem;
}
