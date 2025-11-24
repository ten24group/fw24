import { ObservabilityEvent } from './types';
export interface LogOptions {
    level?: ObservabilityEvent['level'];
    message: string;
    entityName?: string;
    entityId?: string;
    operation?: string;
    data?: Record<string, any>;
    error?: Error;
    traceId?: string;
}
export declare const logEvent: (options: LogOptions) => void;
