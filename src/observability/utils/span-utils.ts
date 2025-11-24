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
export function getSpanKind(subType?: string): number {
  if (!subType) return 0; // INTERNAL
  
  const normalized = subType.toLowerCase();
  
  // HTTP/API spans
  if (normalized.includes('http') || normalized.includes('api') || normalized.includes('request')) {
    return 1; // SERVER
  }
  
  // Client calls (DB, external services, AWS SDK)
  if (normalized.includes('db') || normalized.includes('database') ||
      normalized.includes('client') || normalized.includes('aws') ||
      normalized.includes('external')) {
    return 2; // CLIENT
  }
  
  // Message queue producers
  if (normalized.includes('producer') || normalized.includes('publish')) {
    return 3; // PRODUCER
  }
  
  // Message queue consumers
  if (normalized.includes('consumer') || normalized.includes('subscribe') ||
      normalized.includes('queue')) {
    return 4; // CONSUMER
  }
  
  // Default to INTERNAL for application code
  return 0; // INTERNAL
}

