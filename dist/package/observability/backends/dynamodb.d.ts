import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
export interface DynamoDBBackendOptions {
    minLevel?: ObservabilityLevel;
    ttlDays?: number;
}
export declare class DynamoDBObservabilityBackend implements ObservabilityBackend {
    private readonly options;
    readonly name = "dynamodb";
    private readonly entity;
    readonly minLevel?: ObservabilityLevel;
    private buffer;
    private readonly BATCH_SIZE;
    private readonly MAX_BUFFER_SIZE;
    constructor(options?: DynamoDBBackendOptions);
    initializeInvocation(): void;
    capture(event: ObservabilityEvent): Promise<void>;
    flush(): Promise<void>;
    private writeBatch;
    private chunkArray;
}
