import { randomUUID } from 'crypto';

export enum ObservabilityLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  CRITICAL = 5,
  OFF = 99,
}

export type ObservabilityEventType =
  | 'span.start'
  | 'span.event'
  | 'span.end'
  | 'log'
  | 'metric'
  | 'workflow.start'
  | 'workflow.step'
  | 'workflow.end'
  | 'audit';

export interface ObservabilityEventBase {
  type: ObservabilityEventType;
  level: keyof typeof ObservabilityLevel | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';
  correlationId: string; // Root trace ID (was traceId)
  parentLogId?: string;
  timestampMs: number;
  durationMs?: number;
  operation?: string;
  status?: string;
  success?: boolean;
  entityName?: string;
  entityId?: string; // Replaces spanId for span records
  subType?: string;
  
  // High-cardinality metadata for filtering (e.g., region, version, environment)
  tags?: Record<string, string>;
  
  // Source tracking (origin of event: lambda:functionName, controller:ClassName.methodName, etc.)
  source?: string;
  
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

export const DefaultSamplingConfig: SamplingConfig = {
  enabled: false,
  rates: {
    [ObservabilityLevel.CRITICAL]: 1,
    [ObservabilityLevel.ERROR]: 1,
    [ObservabilityLevel.WARN]: 1,
    [ObservabilityLevel.INFO]: 1,
    [ObservabilityLevel.DEBUG]: 1,
    [ObservabilityLevel.TRACE]: 1,
    [ObservabilityLevel.OFF]: 0,
  },
};

export const createTraceId = () => randomUUID();

