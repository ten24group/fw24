import type { Link, SpanContext } from '@opentelemetry/api';
import { toW3CParentId, toW3CTraceId } from '../../core/runtime/execution-context/propagation';

/**
 * Build OTEL SpanLinks for FW24's cross-invocation causation.
 *
 * FW24 contract:
 * - correlationId: local invocation id (slice)
 * - causedBy: upstream invocation correlationId (cross-invocation link)
 *
 * We model causedBy as an OTEL link (NOT parent-child).
 */
export function buildCausedByLinks(input: { correlationId: string; causedBy?: string }): Link[] {
  const causedBy = input.causedBy?.trim();
  if (!causedBy) return [];

  // Avoid self-linking
  if (causedBy === input.correlationId) return [];

  // Best-effort: derive a stable SpanContext from the causedBy correlation id.
  // Note: we do NOT have a real upstream span-id, so we use a stable derived value.
  const context: SpanContext = {
    traceId: toW3CTraceId(causedBy),
    spanId: toW3CParentId(causedBy),
    traceFlags: 1, // sampled (best-effort). ADOT/X-Ray will apply its own sampling decisions.
  };

  return [
    {
      context,
      attributes: {
        'fw24.link.kind': 'causedBy',
        'fw24.caused_by': causedBy,
      },
    },
  ];
}


