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
export const SpanKind = {
  /** Default. Represents an internal operation within an application. */
  INTERNAL: 0,
  /** Indicates that the span covers server-side handling of a request. */
  SERVER: 1,
  /** Indicates that the span describes a request to some remote service. */
  CLIENT: 2,
  /** Indicates that the span describes a producer sending a message to a broker. */
  PRODUCER: 3,
  /** Indicates that the span describes a consumer receiving a message from a broker. */
  CONSUMER: 4,
} as const;

export type SpanKindValue = typeof SpanKind[ keyof typeof SpanKind ];

/**
 * Map subType to OpenTelemetry SpanKind
 * 
 * Uses heuristics based on common naming patterns to determine the appropriate
 * SpanKind for a given operation subType.
 * 
 * @param subType - The operation subType (e.g., 'http', 'db', 'queue')
 * @returns The appropriate SpanKind value
 */
export function getSpanKind(subType?: string): SpanKindValue {
  if (!subType) return SpanKind.INTERNAL;

  const normalized = subType.toLowerCase();

  // HTTP/API spans - typically server-side request handling
  if (normalized.includes('http') || normalized.includes('api') || normalized.includes('request')) {
    return SpanKind.SERVER;
  }

  // Client calls (DB, external services, AWS SDK)
  if (normalized.includes('db') || normalized.includes('database') ||
    normalized.includes('client') || normalized.includes('aws') ||
    normalized.includes('external')) {
    return SpanKind.CLIENT;
  }

  // Message queue producers
  if (normalized.includes('producer') || normalized.includes('publish')) {
    return SpanKind.PRODUCER;
  }

  // Message queue consumers
  if (normalized.includes('consumer') || normalized.includes('subscribe') ||
    normalized.includes('queue')) {
    return SpanKind.CONSUMER;
  }

  // Default to INTERNAL for application code
  return SpanKind.INTERNAL;
}
