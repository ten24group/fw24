export declare enum ObservabilityLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
    CRITICAL = 5,
    OFF = 99
}
export type ObservabilityEventType = 'span.start' | 'span.event' | 'span.end' | 'log' | 'metric' | 'workflow.start' | 'workflow.step' | 'workflow.end' | 'audit';
export interface ObservabilityEventBase {
    type: ObservabilityEventType;
    level: keyof typeof ObservabilityLevel | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';
    correlationId: string;
    parentLogId?: string;
    timestampMs: number;
    durationMs?: number;
    operation?: string;
    status?: string;
    success?: boolean;
    entityName?: string;
    entityId?: string;
    subType?: string;
    metrics?: Record<string, number>;
    attributes?: Record<string, any>;
    data?: Record<string, any>;
    metadata?: Record<string, any>;
    error?: {
        type: string;
        message: string;
        stack?: string;
    };
    actor?: Record<string, any>;
    context?: Record<string, any>;
}
export type ObservabilityEvent = ObservabilityEventBase;
export interface ObservabilityBackend {
    name: string;
    minLevel?: ObservabilityLevel;
    capture(event: ObservabilityEvent): Promise<void>;
    flush?(): Promise<void>;
    initializeInvocation?(): void;
}
export interface ObservabilityBackendConfig {
    type: 'cloudwatch' | 'dynamodb' | 'otel' | 'mock';
    enabled: boolean;
    minLevel?: ObservabilityLevel;
    config?: Record<string, any>;
}
export interface TypeSpecificConfig {
    backends?: ('cloudwatch' | 'dynamodb' | 'otel')[];
    minLevel?: ObservabilityLevel;
    sampling?: {
        enabled: boolean;
        rate: number;
    };
}
export interface SamplingConfig {
    enabled: boolean;
    rates: Record<ObservabilityLevel, number>;
    operations?: Record<string, number>;
}
export interface ObservabilityConfig {
    enabled: boolean;
    minLevel: ObservabilityLevel;
    sampling: SamplingConfig;
    backends: ObservabilityBackendConfig[];
    types?: {
        span?: TypeSpecificConfig;
        metric?: TypeSpecificConfig;
        audit?: TypeSpecificConfig;
        log?: TypeSpecificConfig;
        decision?: TypeSpecificConfig;
        workflow?: TypeSpecificConfig;
    };
}
export declare const DefaultSamplingConfig: SamplingConfig;
export declare const createTraceId: () => `${string}-${string}-${string}-${string}-${string}`;
