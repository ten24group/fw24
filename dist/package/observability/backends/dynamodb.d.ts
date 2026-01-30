/**
 * DynamoDB Backend for Observability
 *
 * Stores all observability events in DynamoDB.
 *
 * **Size Management:**
 * - Entity schema auto-compresses fields (data, metadata) via `compressed: true`
 * - Optional truncation applied here (if enabled in config)
 * - All config injected via DI
 */
import { ObservabilityLogService } from '../storage/service';
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel, DynamoDBConfig } from '../types';
export declare class DynamoDBObservabilityBackend implements ObservabilityBackend {
    private readonly service;
    readonly name = "dynamodb";
    readonly minLevel?: ObservabilityLevel;
    private buffer;
    private readonly config;
    constructor(minLevel: ObservabilityLevel, config: DynamoDBConfig, service: ObservabilityLogService);
    initializeInvocation(): void;
    capture(event: ObservabilityEvent): Promise<void>;
    flush(): Promise<void>;
    private static readonly RETRYABLE_ERRORS;
    private isRetryableError;
    private writeBatch;
    private mapEventToItem;
}
