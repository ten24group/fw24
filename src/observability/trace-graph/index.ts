import type { ObservabilityEvent } from '../types';

export type TraceEdge =
  | { kind: 'parent'; childId: string; parentId: string; correlationId: string }
  | { kind: 'causedBy'; correlationId: string; causedBy: string };

export type TraceNodeKind = 'span' | 'event';

export type TraceNode = {
  kind: TraceNodeKind;
  /** ObservabilityLogId */
  id: string;
  correlationId: string;
  operation?: string;
  type?: string;
  parentObservabilityLogId?: string | null;
  causedBy?: string;
  /** Underlying event */
  event?: ObservabilityEvent;
};

export type TraceGraph = {
  nodes: TraceNode[];
  nodesById: Map<string, TraceNode[]>;
  spansById: Map<string, ObservabilityEvent>;
  edges: TraceEdge[];
  /**
   * Parent ids referenced by emitted events but missing as spans in this event set.
   *
   * Under the strict FW24 contract (parent is local-only), this MUST be empty.
   * If non-empty, it indicates either:
   * - an invariant violation in framework code, or
   * - a caller injected parentObservabilityLogId manually (unsupported).
   */
  missingParentSpanIds: Set<string>;
  /**
   * Parent ids that exist as spans but belong to a DIFFERENT correlationId than the child.
   *
   * Under FW24 strict contract, parentObservabilityLogId is local-only:
   * - Parent + child must share the same correlationId (same slice).
   * - Cross-slice linkage must use `causedBy` / OTEL links instead.
   */
  crossSliceParentSpanIds: Set<string>;
};

function pushNode(map: Map<string, TraceNode[]>, node: TraceNode) {
  const list = map.get(node.id);
  if (list) list.push(node);
  else map.set(node.id, [ node ]);
}

/**
 * Build an explicit TraceGraph for an invocation's buffered events.
 *
 * This makes parent/child and causedBy relationships explicit (and testable),
 * and allows downstream steps (noise policy, OTEL export) to reason over the graph.
 */
export function buildTraceGraph(
  events: ObservabilityEvent[],
  options?: { strictParents?: boolean }
): TraceGraph {
  const nodes: TraceNode[] = [];
  const nodesById = new Map<string, TraceNode[]>();
  const spansById = new Map<string, ObservabilityEvent>();
  const edges: TraceEdge[] = [];
  const missingParentSpanIds = new Set<string>();
  const crossSliceParentSpanIds = new Set<string>();

  for (const e of events) {
    if (!e.observabilityLogId) continue;

    const node: TraceNode = {
      kind: e.type === 'span' || e.type === 'span.start' ? 'span' : 'event',
      id: e.observabilityLogId,
      correlationId: e.correlationId,
      operation: e.operation,
      type: e.type,
      parentObservabilityLogId: e.parentObservabilityLogId,
      causedBy: e.causedBy,
      event: e,
    };
    nodes.push(node);
    pushNode(nodesById, node);

    // Recognize both 'span' and 'span.start' as valid parent spans
    if (e.type === 'span' || e.type === 'span.start') {
      spansById.set(e.observabilityLogId, e);
    }

    const parentId = e.parentObservabilityLogId ?? undefined;
    if (parentId) {
      edges.push({ kind: 'parent', childId: e.observabilityLogId, parentId, correlationId: e.correlationId });
    }
    if (e.causedBy) {
      edges.push({ kind: 'causedBy', correlationId: e.correlationId, causedBy: e.causedBy });
    }
  }

  // Remote parents: referenced but missing in this set.
  for (const edge of edges) {
    if (edge.kind !== 'parent') continue;
    const parentSpan = spansById.get(edge.parentId);
    if (!parentSpan) {
      missingParentSpanIds.add(edge.parentId);
      continue;
    }
    if (parentSpan.correlationId !== edge.correlationId) {
      crossSliceParentSpanIds.add(edge.parentId);
    }
  }

  // Strict contract: parent is local-only. Missing parents should never happen.
  const strictParents = options?.strictParents ?? true;
  if (strictParents && (missingParentSpanIds.size > 0 || crossSliceParentSpanIds.size > 0)) {
    const sampleMissing = Array.from(missingParentSpanIds).slice(0, 10);
    const sampleCrossSlice = Array.from(crossSliceParentSpanIds).slice(0, 10);
    throw new Error(
      `TraceGraph invariant violated: invalid parent span(s) referenced by parentObservabilityLogId. ` +
      `missing=[${sampleMissing.join(', ')}] crossSlice=[${sampleCrossSlice.join(', ')}]`
    );
  }

  return {
    edges,
    nodes,
    nodesById,
    spansById,
    missingParentSpanIds,
    crossSliceParentSpanIds,
  };
}
