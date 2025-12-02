/**
 * DynamoDB Backend for Observability
 *
 * Stores all observability events in DynamoDB using ObservabilityLogService.
 * Service is self-contained - no DI dependency.
 */
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
export interface DynamoDBBackendOptions {
    ttlDays: number;
    minLevel?: ObservabilityLevel;
}
export declare class DynamoDBObservabilityBackend implements ObservabilityBackend {
    private readonly options;
    readonly name = "dynamodb";
    readonly minLevel?: ObservabilityLevel;
    private buffer;
    private ttlDays;
    constructor(options: DynamoDBBackendOptions);
    /**
     * Get service instance (self-contained, no DI)
     */
    private getService;
    initializeInvocation(): void;
    capture(event: ObservabilityEvent): Promise<void>;
    flush(): Promise<void>;
    private static readonly RETRYABLE_ERRORS;
    private isRetryableError;
    private writeBatch;
    private mapEventToItem;
}
