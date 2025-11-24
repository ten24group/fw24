export interface TraceContext {
    traceId: string;
    parentSpanId?: string;
    sampled?: boolean;
}
export declare const extractTraceContextFromHeaders: (headers: Record<string, string | undefined>) => TraceContext;
export declare const injectTraceContextHeaders: (traceId: string, spanId: string) => {
    traceparent: string;
    "x-amzn-trace-id": string;
};
export declare const addTraceContextToSqs: (attributes: Record<string, any> | undefined, traceId: string, spanId: string) => {
    traceId: {
        DataType: string;
        StringValue: string;
    };
    parentSpanId: {
        DataType: string;
        StringValue: string;
    };
};
export declare const extractTraceContextFromSqs: (attributes?: Record<string, any>) => TraceContext;
