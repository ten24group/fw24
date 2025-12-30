import type { Link } from '@opentelemetry/api';
/**
 * Build OTEL SpanLinks for FW24's cross-invocation causation.
 *
 * FW24 contract:
 * - correlationId: local invocation id (slice)
 * - causedBy: upstream invocation correlationId (cross-invocation link)
 *
 * We model causedBy as an OTEL link (NOT parent-child).
 */
export declare function buildCausedByLinks(input: {
    correlationId: string;
    causedBy?: string;
}): Link[];
