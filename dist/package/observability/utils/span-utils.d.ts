/**
 * Utility functions for OTEL span handling
 */
/**
 * Map subType to OpenTelemetry SpanKind
 *
 * SpanKind values:
 * - 0 = INTERNAL (default for application code)
 * - 1 = SERVER (receiving a request)
 * - 2 = CLIENT (making a request)
 * - 3 = PRODUCER (message producer)
 * - 4 = CONSUMER (message consumer)
 */
export declare function getSpanKind(subType?: string): number;
