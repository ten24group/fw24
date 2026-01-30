import type { ObservabilityEvent } from '../types';
export type TraceEdge = {
    kind: 'parent';
    childId: string;
    parentId: string;
    correlationId: string;
} | {
    kind: 'causedBy';
    correlationId: string;
    causedBy: string;
};
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
/**
 * Build an explicit TraceGraph for an invocation's buffered events.
 *
 * This makes parent/child and causedBy relationships explicit (and testable),
 * and allows downstream steps (noise policy, OTEL export) to reason over the graph.
 */
export declare function buildTraceGraph(events: ObservabilityEvent[], options?: {
    strictParents?: boolean;
}): TraceGraph;
