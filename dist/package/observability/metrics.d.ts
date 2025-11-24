import type { ObservabilityEvent } from './types';
export interface RecordMetricOptions {
    name: string;
    value: number;
    unit?: string;
    type?: 'counter' | 'gauge' | 'histogram';
    level?: ObservabilityEvent['level'];
    attributes?: Record<string, any>;
    traceId?: string;
}
export declare const recordMetric: (options: RecordMetricOptions) => void;
