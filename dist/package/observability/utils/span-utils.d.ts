/**
 * Utility functions for OTEL span handling
 */
/**
 * OpenTelemetry SpanKind constants
 *
 * These match the values from @opentelemetry/api SpanKind enum.
 * We define them here to avoid runtime dependency on @opentelemetry/api
 * (which is provided by ADOT layer in Lambda).
 *
 * @see https://opentelemetry.io/docs/specs/otel/trace/api/#spankind
 */
export declare const SpanKind: {
    /** Default. Represents an internal operation within an application. */
    readonly INTERNAL: 0;
    /** Indicates that the span covers server-side handling of a request. */
    readonly SERVER: 1;
    /** Indicates that the span describes a request to some remote service. */
    readonly CLIENT: 2;
    /** Indicates that the span describes a producer sending a message to a broker. */
    readonly PRODUCER: 3;
    /** Indicates that the span describes a consumer receiving a message from a broker. */
    readonly CONSUMER: 4;
};
export type SpanKindValue = typeof SpanKind[keyof typeof SpanKind];
/**
 * Map subType to OpenTelemetry SpanKind
 *
 * Uses heuristics based on common naming patterns to determine the appropriate
 * SpanKind for a given operation subType.
 *
 * @param subType - The operation subType (e.g., 'http', 'db', 'queue')
 * @returns The appropriate SpanKind value
 */
export declare function getSpanKind(subType?: string): SpanKindValue;
