import { ObservabilityEvent } from './types';
export interface SpanOptions {
    traceId?: string;
    parentSpanId?: string;
    level?: ObservabilityEvent['level'];
    attributes?: Record<string, any>;
    source?: string;
    tags?: Record<string, string>;
}
export declare class Span {
    private readonly _spanId;
    private readonly _traceId;
    private readonly _parentSpanId?;
    private readonly level;
    private readonly startTime;
    private attributes;
    private operation;
    private readonly source?;
    private readonly tags?;
    constructor(operation: string, options?: SpanOptions);
    get spanId(): string;
    get traceId(): string;
    get parentSpanId(): string | undefined;
    setAttribute(key: string, value: any): this;
    addEvent(name: string, attributes?: Record<string, any>, level?: ObservabilityEvent['level']): this;
    end(options?: {
        success?: boolean;
        error?: Error;
    }): void;
    withChild<T>(operation: string, fn: (span: Span) => Promise<T>, options?: Omit<SpanOptions, 'traceId' | 'parentSpanId'>): Promise<T>;
}
export declare const withSpan: <T>(operation: string, fn: (span: Span) => Promise<T>, options?: SpanOptions) => Promise<T>;
