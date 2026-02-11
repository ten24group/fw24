"use strict";
/**
 * Noise Reduction Algorithm (v2: single DFS, no tree mutation)
 *
 * Three-phase approach:
 * 1. BUILD: Flat events → tree (parentObservabilityLogId linkage)
 * 2. EVALUATE: Post-order DFS assigns emit/absorb/silent to each node
 * 3. COLLECT: Pre-order DFS builds output with resolved parent IDs and absorbed data
 * 4. STRIP: Promoted (noise) roots are removed; genuine children become new roots
 *
 * Key invariants:
 * - The tree is NEVER mutated (no reparenting, no child moving)
 * - Decisions are recorded as separate properties on nodes
 * - Parent IDs in output resolve to the nearest EMITTED ancestor
 * - Absorbed data flows to the nearest EMITTED ancestor
 * - Hard signals force emit (unless explicitly overridden by high-priority rule)
 * - Noise roots (silent/absorbed with no emitted ancestor) are ALWAYS stripped:
 *   - If ALL events are noise → entire invocation is suppressed (0 output)
 *   - If SOME events are genuine → noise roots stripped, genuine children kept as new roots
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyNoiseReduction = applyNoiseReduction;
exports.pickNoiseDecision = pickNoiseDecision;
exports.buildAndEvaluate = buildAndEvaluate;
const priority_1 = require("./priority");
const hard_signals_1 = require("./hard-signals");
const matcher_1 = require("./rules/matcher");
const builtins_1 = require("./rules/builtins");
const absorb_1 = require("./absorb");
const utils_1 = require("./utils");
/**
 * Build a tree from flat events based on parentObservabilityLogId.
 *
 * Events whose parent is not in this batch become root nodes.
 * span.start events are separated for special handling.
 */
function buildTree(events) {
    const nodeById = new Map();
    const spanStartEvents = [];
    // First pass: create all nodes, separating span.start events
    for (const event of events) {
        if (event.type === 'span.start') {
            spanStartEvents.push(event);
            continue;
        }
        const node = {
            event,
            parent: undefined,
            children: [],
        };
        nodeById.set(event.observabilityLogId, node);
    }
    // Second pass: link parents
    const roots = [];
    for (const node of nodeById.values()) {
        const parentId = node.event.parentObservabilityLogId;
        if (parentId) {
            const parent = nodeById.get(parentId);
            if (parent) {
                node.parent = parent;
                parent.children.push(node);
                continue;
            }
        }
        // No parent or parent not in batch → root
        roots.push(node);
    }
    return { roots, nodeById, spanStartEvents };
}
// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: EVALUATE DECISIONS (post-order DFS)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Evaluate noise reduction decisions for an entire subtree (post-order DFS).
 *
 * Post-order ensures children are evaluated before parents, which is needed
 * for hard signal propagation (if a child is a hard signal, the parent
 * knows about it when it's evaluated).
 */
function evaluateSubtree(node, config, allRules, matchFn) {
    // Recurse into children first (post-order)
    for (const child of node.children) {
        evaluateSubtree(child, config, allRules, matchFn);
    }
    // Evaluate this node's decision via rules
    const ruleResult = (0, priority_1.evaluateNoiseRules)(node.event, allRules, matchFn);
    const eventIsHardSignal = (0, hard_signals_1.isHardSignal)(node.event, config);
    // Store the hard signal flag on the node (used for propagation)
    node.isHardSignal = eventIsHardSignal;
    // Hard signal protection: force emit unless the rule explicitly overrides
    if (eventIsHardSignal && ruleResult.decision !== 'emit' && ruleResult.priority <= priority_1.HARD_SIGNAL_PRIORITY) {
        node.evaluation = {
            decision: 'emit',
            ruleId: 'hard-signal',
            reason: 'Hard signal: error/failure/slow operation forces emit',
            priority: priority_1.HARD_SIGNAL_PRIORITY,
        };
    }
    else {
        node.evaluation = {
            decision: ruleResult.decision,
            ruleId: ruleResult.ruleId,
            reason: ruleResult.reason,
            priority: ruleResult.priority,
        };
    }
    // Propagate hard signal flag from children
    // Check both: child IS a hard signal, or child HAS hard signal descendants
    const childHasHardSignal = node.children.some(c => c.isHardSignal || c.hasHardSignalDescendant);
    node.hasHardSignalDescendant = childHasHardSignal;
    // Context preservation: if this span has hard signal descendants and would
    // be absorbed/silenced, force it to emit to preserve the hierarchy
    if (childHasHardSignal && node.evaluation.decision !== 'emit' && node.event.type === 'span') {
        node.evaluation = {
            decision: 'emit',
            ruleId: 'hard-signal-ancestor',
            reason: 'Ancestor of hard signal: forced emit to preserve hierarchy',
            priority: priority_1.HARD_SIGNAL_PRIORITY,
        };
    }
}
/**
 * Collect output from a subtree via pre-order DFS.
 *
 * - EMIT nodes become output events; their children get this node as their nearest emitted ancestor
 * - ABSORB nodes merge data into the nearest emitted ancestor; children inherit the same ancestor
 * - SILENT nodes increment a counter on the nearest emitted ancestor; children inherit the same ancestor
 *
 * If a node would be absorbed/silenced but has no emitted ancestor (root with no parent in batch),
 * it is promoted to emit and marked as `promoted: true`. After collection, if ALL emitted events
 * are promoted, the entire invocation tree is noise and can be suppressed.
 */
function collectNode(node, nearestEmittedAncestorId, state) {
    // Safety: evaluation must be set by Phase 2
    const decision = node.evaluation?.decision ?? 'emit';
    if (decision === 'emit') {
        // This node is genuinely emitted as a standalone record
        state.emittedEvents.push({
            event: node.event,
            resolvedParentId: nearestEmittedAncestorId,
            evaluation: node.evaluation,
            promoted: false,
        });
        state.stats.emitted++;
        // Children see this node as their nearest emitted ancestor
        for (const child of node.children) {
            collectNode(child, node.event.observabilityLogId, state);
        }
    }
    else if (decision === 'absorb') {
        if (nearestEmittedAncestorId) {
            // Merge data into the nearest emitted ancestor
            const absorbed = getOrCreateAbsorbed(state.absorbedByNodeId, nearestEmittedAncestorId);
            (0, absorb_1.absorbEvent)(absorbed, node.event, state.bounds);
            state.stats.absorbed++;
            (0, utils_1.incrementCounter)(state.stats.absorbedByOperation, node.event.operation ?? node.event.type);
        }
        else {
            // No ancestor to absorb into → promote to emit (marked for possible suppression)
            state.emittedEvents.push({
                event: node.event,
                resolvedParentId: undefined,
                evaluation: node.evaluation,
                promoted: true,
            });
            state.stats.emitted++;
        }
        // Children inherit the same nearest emitted ancestor (or this node if promoted)
        const childAncestorId = nearestEmittedAncestorId ?? node.event.observabilityLogId;
        for (const child of node.children) {
            collectNode(child, childAncestorId, state);
        }
    }
    else {
        // 'silent': counter only
        if (nearestEmittedAncestorId) {
            const absorbed = getOrCreateAbsorbed(state.absorbedByNodeId, nearestEmittedAncestorId);
            (0, absorb_1.recordSilent)(absorbed);
            state.stats.silenced++;
            (0, utils_1.incrementCounter)(state.stats.silencedByOperation, node.event.operation ?? node.event.type);
        }
        else {
            // No ancestor to track counter on → promote to emit (marked for possible suppression)
            state.emittedEvents.push({
                event: node.event,
                resolvedParentId: undefined,
                evaluation: node.evaluation,
                promoted: true,
            });
            state.stats.emitted++;
        }
        const childAncestorId = nearestEmittedAncestorId ?? node.event.observabilityLogId;
        for (const child of node.children) {
            collectNode(child, childAncestorId, state);
        }
    }
}
function getOrCreateAbsorbed(map, nodeId) {
    let absorbed = map.get(nodeId);
    if (!absorbed) {
        absorbed = (0, absorb_1.createMutableAbsorbed)();
        map.set(nodeId, absorbed);
    }
    return absorbed;
}
// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Apply noise reduction to a batch of observability events.
 *
 * This is the core algorithm. It processes events through three phases:
 * 1. Build tree from flat events (parentObservabilityLogId linkage)
 * 2. Evaluate decisions via post-order DFS (rules + hard signals)
 * 3. Collect output via pre-order DFS (resolved parents + absorbed data)
 *
 * span.start events are handled separately: they follow the decision of their
 * corresponding consolidated span (same observabilityLogId).
 *
 * @param inputEvents - Raw events from the invocation buffer
 * @param config - Noise reduction configuration
 * @returns Reduced events with resolved parent IDs and absorbed data
 */
function applyNoiseReduction(inputEvents, config) {
    // Disabled → pass everything through
    if (!config.enabled) {
        const events = inputEvents.map(event => ({
            event,
            resolvedParentId: event.parentObservabilityLogId ?? undefined,
            absorbed: undefined,
        }));
        return {
            events,
            stats: {
                emitted: inputEvents.length,
                absorbed: 0,
                silenced: 0,
                totalInput: inputEvents.length,
                suppressedRoots: 0,
                absorbedByOperation: {},
                silencedByOperation: {},
            },
        };
    }
    const bounds = (0, utils_1.getAbsorptionBounds)(config);
    // Collect all rules (builtin + custom)
    const builtinRules = (0, builtins_1.getBuiltinRules)(config.presets);
    const allRules = [...builtinRules, ...config.rules];
    // Phase 1: Build tree (separates span.start events)
    const { roots, nodeById, spanStartEvents } = buildTree(inputEvents);
    // Phase 2: Evaluate decisions (post-order DFS)
    for (const root of roots) {
        evaluateSubtree(root, config, allRules, matcher_1.matchesRule);
    }
    // Track decisions for span.start handling
    const spanDecisions = new Map();
    for (const node of nodeById.values()) {
        if (node.event.type === 'span' && node.evaluation) {
            spanDecisions.set(node.event.observabilityLogId, node.evaluation);
        }
    }
    // Phase 3: Collect output (pre-order DFS)
    const state = {
        emittedEvents: [],
        absorbedByNodeId: new Map(),
        stats: (0, utils_1.createMutableStats)(),
        bounds,
    };
    for (const root of roots) {
        collectNode(root, undefined, state);
    }
    // Handle span.start events: follow the decision of their parent span
    for (const spanStart of spanStartEvents) {
        const parentDecision = spanDecisions.get(spanStart.observabilityLogId);
        if (!parentDecision || parentDecision.decision === 'emit') {
            // Span was emitted → emit its span.start too
            state.emittedEvents.push({
                event: spanStart,
                resolvedParentId: spanStart.parentObservabilityLogId ?? undefined,
            });
            state.stats.emitted++;
        }
        else {
            // Span was absorbed/silenced → drop span.start
            state.stats.silenced++;
            (0, utils_1.incrementCounter)(state.stats.silencedByOperation, spanStart.operation ?? 'span.start');
        }
    }
    state.stats.totalInput = inputEvents.length;
    // ═══════════════════════════════════════════════════════════════════════
    // NOISE ROOT STRIPPING
    //
    // Promoted events are noise roots (silent/absorbed) that had no emitted
    // ancestor. They are ALWAYS stripped from the output:
    //
    // 1. If ALL emitted events are promoted → entire invocation is noise
    //    (e.g., idle scheduled task, stream processor that just forwarded).
    //    Nothing is persisted — this is "root suppression".
    //
    // 2. If SOME are promoted and SOME are genuine → the noise roots are
    //    dropped but genuine children are kept. Genuine children that
    //    referenced a promoted root get resolvedParentId cleared to
    //    undefined (they become new roots in the output).
    //    Example: DynamoDBStreamAuditLogger batch span is dropped, but the
    //    genuine audit.entity children are persisted as root records.
    //
    // Safety guarantees:
    // - Hard signals (errors/failures/slow ops) force `decision: 'emit'` in
    //   Phase 2, so they are NEVER promoted and are always persisted.
    // - Genuine audit records, user-facing events, etc. that don't match any
    //   silent/absorb rule default to 'emit' and are always persisted.
    // ═══════════════════════════════════════════════════════════════════════
    // Collect IDs of promoted (noise) events so we can fix parent references
    const promotedIds = new Set();
    for (const entry of state.emittedEvents) {
        if (entry.promoted === true) {
            promotedIds.add(entry.event.observabilityLogId);
        }
    }
    // Separate genuine and promoted events
    const genuineEvents = [];
    for (const entry of state.emittedEvents) {
        if (entry.promoted === true) {
            // Noise root — strip from output and adjust stats
            state.stats.emitted--;
            const originalDecision = entry.evaluation?.decision ?? 'silent';
            if (originalDecision === 'absorb') {
                state.stats.absorbed++;
                (0, utils_1.incrementCounter)(state.stats.absorbedByOperation, entry.event.operation ?? entry.event.type);
            }
            else {
                state.stats.silenced++;
                (0, utils_1.incrementCounter)(state.stats.silencedByOperation, entry.event.operation ?? entry.event.type);
            }
        }
        else {
            genuineEvents.push(entry);
        }
    }
    // Count suppressed roots (all promoted, entire invocation is noise)
    if (genuineEvents.length === 0 && promotedIds.size > 0) {
        state.stats.suppressedRoots += roots.length;
    }
    // Build final output with frozen absorbed data (and optional debug info)
    const includeDebug = config.debug === true;
    const finalEvents = genuineEvents.map(({ event, resolvedParentId, evaluation }) => {
        const mutableAbsorbed = state.absorbedByNodeId.get(event.observabilityLogId);
        // If this event's parent was a promoted (noise) root, clear both the
        // resolved parent ID and the event's original parentObservabilityLogId.
        // This prevents the manager from falling back to a stale reference that
        // points to a span that was stripped from the output.
        let cleanParentId = resolvedParentId;
        if (resolvedParentId && promotedIds.has(resolvedParentId)) {
            cleanParentId = undefined;
            event.parentObservabilityLogId = undefined;
        }
        return {
            event,
            resolvedParentId: cleanParentId,
            absorbed: mutableAbsorbed ? (0, absorb_1.freezeAbsorbed)(mutableAbsorbed) : undefined,
            debugInfo: includeDebug && evaluation ? {
                decision: evaluation.decision,
                ruleId: evaluation.ruleId,
                reason: evaluation.reason,
            } : undefined,
        };
    });
    return {
        events: finalEvents,
        stats: (0, utils_1.freezeStats)(state.stats),
    };
}
/**
 * Evaluate noise decision for a single event (for testing/inspection).
 *
 * This evaluates rules for a single event without building a tree.
 * Does NOT apply hard signal logic or context preservation.
 *
 * @param event - Event to evaluate
 * @param config - Noise reduction configuration
 * @returns Decision with context
 */
function pickNoiseDecision(event, config) {
    const builtinRules = (0, builtins_1.getBuiltinRules)(config.presets);
    const allRules = [...builtinRules, ...config.rules];
    const result = (0, priority_1.evaluateNoiseRules)(event, allRules, matcher_1.matchesRule);
    return {
        decision: result.decision,
        ruleId: result.ruleId,
        reason: result.reason,
    };
}
/**
 * Get the tree built from events (for testing/inspection).
 * Returns the tree nodes with their evaluations but without collecting output.
 */
function buildAndEvaluate(inputEvents, config) {
    const builtinRules = (0, builtins_1.getBuiltinRules)(config.presets);
    const allRules = [...builtinRules, ...config.rules];
    const { roots, nodeById } = buildTree(inputEvents);
    for (const root of roots) {
        evaluateSubtree(root, config, allRules, matcher_1.matchesRule);
    }
    // Cast is safe: MutableTreeNode satisfies TreeNode (TreeNode is readonly)
    return {
        roots: roots,
        nodeById: nodeById,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWxnb3JpdGhtLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL2FsZ29yaXRobS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQWtCRzs7QUF1VEgsa0RBcUtDO0FBWUQsOENBYUM7QUFNRCw0Q0FrQkM7QUE3ZkQseUNBQXdGO0FBQ3hGLGlEQUE4QztBQUM5Qyw2Q0FBOEM7QUFDOUMsK0NBQW1EO0FBQ25ELHFDQU1rQjtBQUNsQixtQ0FBaUc7QUE4QmpHOzs7OztHQUtHO0FBQ0gsU0FBUyxTQUFTLENBQUMsTUFBcUM7SUFDdEQsTUFBTSxRQUFRLEdBQUcsSUFBSSxHQUFHLEVBQTJCLENBQUM7SUFDcEQsTUFBTSxlQUFlLEdBQXlCLEVBQUUsQ0FBQztJQUVqRCw2REFBNkQ7SUFDN0QsS0FBSyxNQUFNLEtBQUssSUFBSSxNQUFNLEVBQUUsQ0FBQztRQUMzQixJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssWUFBWSxFQUFFLENBQUM7WUFDaEMsZUFBZSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUM1QixTQUFTO1FBQ1gsQ0FBQztRQUNELE1BQU0sSUFBSSxHQUFvQjtZQUM1QixLQUFLO1lBQ0wsTUFBTSxFQUFFLFNBQVM7WUFDakIsUUFBUSxFQUFFLEVBQUU7U0FDYixDQUFDO1FBQ0YsUUFBUSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDL0MsQ0FBQztJQUVELDRCQUE0QjtJQUM1QixNQUFNLEtBQUssR0FBc0IsRUFBRSxDQUFDO0lBRXBDLEtBQUssTUFBTSxJQUFJLElBQUksUUFBUSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7UUFDckMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQztRQUNyRCxJQUFJLFFBQVEsRUFBRSxD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QUNyRCxNQUFNLFFBQVEsR0FBeUIsQ0FBQyxHQUFHLFlBQVksRUFBRSxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUUxRSxNQUFNLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxHQUFHLFNBQVMsQ0FBQyxXQUFXLENBQUMsQ0FBQztJQUVuRCxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1FBQ3pCLGVBQWUsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxxQkFBVyxDQUFDLENBQUM7SUFDdkQsQ0FBQztJQUVELDBFQUEwRTtJQUMxRSxPQUFPO1FBQ0wsS0FBSyxFQUFFLEtBQXVDO1FBQzlDLFFBQVEsRUFBRSxRQUFvRDtLQUMvRCxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTm9pc2UgUmVkdWN0aW9uIEFsZ29yaXRobSAodjI6IHNpbmdsZSBERlMsIG5vIHRyZWUgbXV0YXRpb24pXG4gKiBcbiAqIFRocmVlLXBoYXNlIGFwcHJvYWNoOlxuICogMS4gQlVJTEQ6IEZsYXQgZXZlbnRzIOKGkiB0cmVlIChwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgbGlua2FnZSlcbiAqIDIuIEVWQUxVQVRFOiBQb3N0LW9yZGVyIERGUyBhc3NpZ25zIGVtaXQvYWJzb3JiL3NpbGVudCB0byBlYWNoIG5vZGVcbiAqIDMuIENPTExFQ1Q6IFByZS1vcmRlciBERlMgYnVpbGRzIG91dHB1dCB3aXRoIHJlc29sdmVkIHBhcmVudCBJRHMgYW5kIGFic29yYmVkIGRhdGFcbiAqIDQuIFNUUklQOiBQcm9tb3RlZCAobm9pc2UpIHJvb3RzIGFyZSByZW1vdmVkOyBnZW51aW5lIGNoaWxkcmVuIGJlY29tZSBuZXcgcm9vdHNcbiAqIFxuICogS2V5IGludmFyaWFudHM6XG4gKiAtIFRoZSB0cmVlIGlzIE5FVkVSIG11dGF0ZWQgKG5vIHJlcGFyZW50aW5nLCBubyBjaGlsZCBtb3ZpbmcpXG4gKiAtIERlY2lzaW9ucyBhcmUgcmVjb3JkZWQgYXMgc2VwYXJhdGUgcHJvcGVydGllcyBvbiBub2Rlc1xuICogLSBQYXJlbnQgSURzIGluIG91dHB1dCByZXNvbHZlIHRvIHRoZSBuZWFyZXN0IEVNSVRURUQgYW5jZXN0b3JcbiAqIC0gQWJzb3JiZWQgZGF0YSBmbG93cyB0byB0aGUgbmVhcmVzdCBFTUlUVEVEIGFuY2VzdG9yXG4gKiAtIEhhcmQgc2lnbmFscyBmb3JjZSBlbWl0ICh1bmxlc3MgZXhwbGljaXRseSBvdmVycmlkZGVuIGJ5IGhpZ2gtcHJpb3JpdHkgcnVsZSlcbiAqIC0gTm9pc2Ugcm9vdHMgKHNpbGVudC9hYnNvcmJlZCB3aXRoIG5vIGVtaXR0ZWQgYW5jZXN0b3IpIGFyZSBBTFdBWVMgc3RyaXBwZWQ6XG4gKiAgIC0gSWYgQUxMIGV2ZW50cyBhcmUgbm9pc2Ug4oaSIGVudGlyZSBpbnZvY2F0aW9uIGlzIHN1cHByZXNzZWQgKDAgb3V0cHV0KVxuICogICAtIElmIFNPTUUgZXZlbnRzIGFyZSBnZW51aW5lIOKGkiBub2lzZSByb290cyBzdHJpcHBlZCwgZ2VudWluZSBjaGlsZHJlbiBrZXB0IGFzIG5ldyByb290c1xuICovXG5cbmltcG9ydCB0eXBlIHtcbiAgT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBOb2lzZVJlZHVjdGlvbkNvbmZpZyxcbiAgTm9pc2VSdWxlLFxuICBOb2lzZVJ1bGVNYXRjaCxcbn0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHR5cGUge1xuICBUcmVlTm9kZSxcbiAgTm9kZURlY2lzaW9uLFxuICBFbWl0dGVkRXZlbnQsXG4gIE5vaXNlUmVkdWN0aW9uUmVzdWx0LFxuICBOb2lzZVJlZHVjdGlvblN0YXRzLFxuICBBYnNvcnB0aW9uQm91bmRzLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IGV2YWx1YXRlTm9pc2VSdWxlcywgSEFSRF9TSUdOQUxfUFJJT1JJVFksIHR5cGUgUnVsZU1hdGNoRm4gfSBmcm9tICcuL3ByaW9yaXR5JztcbmltcG9ydCB7IGlzSGFyZFNpZ25hbCB9IGZyb20gJy4vaGFyZC1zaWduYWxzJztcbmltcG9ydCB7IG1hdGNoZXNSdWxlIH0gZnJvbSAnLi9ydWxlcy9tYXRjaGVyJztcbmltcG9ydCB7IGdldEJ1aWx0aW5SdWxlcyB9IGZyb20gJy4vcnVsZXMvYnVpbHRpbnMnO1xuaW1wb3J0IHtcbiAgY3JlYXRlTXV0YWJsZUFic29yYmVkLFxuICBmcmVlemVBYnNvcmJlZCxcbiAgYWJzb3JiRXZlbnQsXG4gIHJlY29yZFNpbGVudCxcbiAgdHlwZSBNdXRhYmxlQWJzb3JiZWREYXRhLFxufSBmcm9tICcuL2Fic29yYic7XG5pbXBvcnQgeyBjcmVhdGVNdXRhYmxlU3RhdHMsIGZyZWV6ZVN0YXRzLCBpbmNyZW1lbnRDb3VudGVyLCBnZXRBYnNvcnB0aW9uQm91bmRzIH0gZnJvbSAnLi91dGlscyc7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gTVVUQUJMRSBUUkVFIE5PREUgKGludGVybmFsLCBmb3IgYnVpbGRpbmcpXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqXG4gKiBJbnRlcm5hbCBtdXRhYmxlIG5vZGUgdXNlZCBkdXJpbmcgdHJlZSBjb25zdHJ1Y3Rpb24uXG4gKiBBZnRlciBidWlsZCwgdGhpcyBpcyBjYXN0IHRvIHRoZSByZWFkb25seSBUcmVlTm9kZSBpbnRlcmZhY2UuXG4gKi9cbmludGVyZmFjZSBNdXRhYmxlVHJlZU5vZGUge1xuICByZWFkb25seSBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50O1xuICBwYXJlbnQ6IE11dGFibGVUcmVlTm9kZSB8IHVuZGVmaW5lZDtcbiAgcmVhZG9ubHkgY2hpbGRyZW46IE11dGFibGVUcmVlTm9kZVtdO1xuICBldmFsdWF0aW9uPzogTm9kZURlY2lzaW9uO1xuICAvKiogVHJ1ZSBpZiBUSElTIGV2ZW50IGlzIGEgaGFyZCBzaWduYWwgKGVycm9yL2ZhaWx1cmUvc2xvdyksIHJlZ2FyZGxlc3Mgb2YgZGVjaXNpb24uICovXG4gIGlzSGFyZFNpZ25hbD86IGJvb2xlYW47XG4gIGhhc0hhcmRTaWduYWxEZXNjZW5kYW50PzogYm9vbGVhbjtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQSEFTRSAxOiBCVUlMRCBUUkVFXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuaW50ZXJmYWNlIEJ1aWxkUmVzdWx0IHtcbiAgcmVhZG9ubHkgcm9vdHM6IHJlYWRvbmx5IE11dGFibGVUcmVlTm9kZVtdO1xuICByZWFkb25seSBub2RlQnlJZDogUmVhZG9ubHlNYXA8c3RyaW5nLCBNdXRhYmxlVHJlZU5vZGU+O1xuICByZWFkb25seSBzcGFuU3RhcnRFdmVudHM6IHJlYWRvbmx5IE9ic2VydmFiaWxpdHlFdmVudFtdO1xufVxuXG4vKipcbiAqIEJ1aWxkIGEgdHJlZSBmcm9tIGZsYXQgZXZlbnRzIGJhc2VkIG9uIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZC5cbiAqIFxuICogRXZlbnRzIHdob3NlIHBhcmVudCBpcyBub3QgaW4gdGhpcyBiYXRjaCBiZWNvbWUgcm9vdCBub2Rlcy5cbiAqIHNwYW4uc3RhcnQgZXZlbnRzIGFyZSBzZXBhcmF0ZWQgZm9yIHNwZWNpYWwgaGFuZGxpbmcuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkVHJlZShldmVudHM6IHJlYWRvbmx5IE9ic2VydmFiaWxpdHlFdmVudFtdKTogQnVpbGRSZXN1bHQge1xuICBjb25zdCBub2RlQnlJZCA9IG5ldyBNYXA8c3RyaW5nLCBNdXRhYmxlVHJlZU5vZGU+KCk7XG4gIGNvbnN0IHNwYW5TdGFydEV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcblxuICAvLyBGaXJzdCBwYXNzOiBjcmVhdGUgYWxsIG5vZGVzLCBzZXBhcmF0aW5nIHNwYW4uc3RhcnQgZXZlbnRzXG4gIGZvciAoY29uc3QgZXZlbnQgb2YgZXZlbnRzKSB7XG4gICAgaWYgKGV2ZW50LnR5cGUgPT09ICdzcGFuLnN0YXJ0Jykge1xuICAgICAgc3BhblN0YXJ0RXZlbnRzLnB1c2goZXZlbnQpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IG5vZGU6IE11dGFibGVUcmVlTm9kZSA9IHtcbiAgICAgIGV2ZW50LFxuICAgICAgcGFyZW50OiB1bmRlZmluZWQsXG4gICAgICBjaGlsZHJlbjogW10sXG4gICAgfTtcbiAgICBub2RlQnlJZC5zZXQoZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkLCBub2RlKTtcbiAgfVxuXG4gIC8vIFNlY29uZCBwYXNzOiBsaW5rIHBhcmVudHNcbiAgY29uc3Qgcm9vdHM6IE11dGFibGVUcmVlTm9kZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBub2RlIG9mIG5vZGVCeUlkLnZhbHVlcygpKSB7XG4gICAgY29uc3QgcGFyZW50SWQgPSBub2RlLmV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICBpZiAocGFyZW50SWQpIHtcbiAgICAgIGNvbnN0IHBhcmVudCA9IG5vZGVCeUlkLmdldChwYXJlbnRJZCk7XG4gICAgICBpZiAocGFyZW50KSB7XG4gICAgICAgIG5vZGUucGFyZW50ID0gcGFyZW50O1xuICAgICAgICBwYXJlbnQuY2hpbGRyZW4ucHVzaChub2RlKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIE5vIHBhcmVudCBvciBwYXJlbnQgbm90IGluIGJhdGNoIOKGkiByb290XG4gICAgcm9vdHMucHVzaChub2RlKTtcbiAgfVxuXG4gIHJldHVybiB7IHJvb3RzLCBub2RlQnlJZCwgc3BhblN0YXJ0RXZlbnRzIH07XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUEhBU0UgMjogRVZBTFVBVEUgREVDSVNJT05TIChwb3N0LW9yZGVyIERGUylcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIEV2YWx1YXRlIG5vaXNlIHJlZHVjdGlvbiBkZWNpc2lvbnMgZm9yIGFuIGVudGlyZSBzdWJ0cmVlIChwb3N0LW9yZGVyIERGUykuXG4gKiBcbiAqIFBvc3Qtb3JkZXIgZW5zdXJlcyBjaGlsZHJlbiBhcmUgZXZhbHVhdGVkIGJlZm9yZSBwYXJlbnRzLCB3aGljaCBpcyBuZWVkZWRcbiAqIGZvciBoYXJkIHNpZ25hbCBwcm9wYWdhdGlvbiAoaWYgYSBjaGlsZCBpcyBhIGhhcmQgc2lnbmFsLCB0aGUgcGFyZW50XG4gKiBrbm93cyBhYm91dCBpdCB3aGVuIGl0J3MgZXZhbHVhdGVkKS5cbiAqL1xuZnVuY3Rpb24gZXZhbHVhdGVTdWJ0cmVlKFxuICBub2RlOiBNdXRhYmxlVHJlZU5vZGUsXG4gIGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcsXG4gIGFsbFJ1bGVzOiByZWFkb25seSBOb2lzZVJ1bGVbXSxcbiAgbWF0Y2hGbjogUnVsZU1hdGNoRm4sXG4pOiB2b2lkIHtcbiAgLy8gUmVjdXJzZSBpbnRvIGNoaWxkcmVuIGZpcnN0IChwb3N0LW9yZGVyKVxuICBmb3IgKGNvbnN0IGNoaWxkIG9mIG5vZGUuY2hpbGRyZW4pIHtcbiAgICBldmFsdWF0ZVN1YnRyZWUoY2hpbGQsIGNvbmZpZywgYWxsUnVsZXMsIG1hdGNoRm4pO1xuICB9XG5cbiAgLy8gRXZhbHVhdGUgdGhpcyBub2RlJ3MgZGVjaXNpb24gdmlhIHJ1bGVzXG4gIGNvbnN0IHJ1bGVSZXN1bHQgPSBldmFsdWF0ZU5vaXNlUnVsZXMobm9kZS5ldmVudCwgYWxsUnVsZXMsIG1hdGNoRm4pO1xuICBjb25zdCBldmVudElzSGFyZFNpZ25hbCA9IGlzSGFyZFNpZ25hbChub2RlLmV2ZW50LCBjb25maWcpO1xuXG4gIC8vIFN0b3JlIHRoZSBoYXJkIHNpZ25hbCBmbGFnIG9uIHRoZSBub2RlICh1c2VkIGZvciBwcm9wYWdhdGlvbilcbiAgbm9kZS5pc0hhcmRTaWduYWwgPSBldmVudElzSGFyZFNpZ25hbDtcblxuICAvLyBIYXJkIHNpZ25hbCBwcm90ZWN0aW9uOiBmb3JjZSBlbWl0IHVubGVzcyB0aGUgcnVsZSBleHBsaWNpdGx5IG92ZXJyaWRlc1xuICBpZiAoZXZlbnRJc0hhcmRTaWduYWwgJiYgcnVsZVJlc3VsdC5kZWNpc2lvbiAhPT0gJ2VtaXQnICYmIHJ1bGVSZXN1bHQucHJpb3JpdHkgPD0gSEFSRF9TSUdOQUxfUFJJT1JJVFkpIHtcbiAgICBub2RlLmV2YWx1YXRpb24gPSB7XG4gICAgICBkZWNpc2lvbjogJ2VtaXQnLFxuICAgICAgcnVsZUlkOiAnaGFyZC1zaWduYWwnLFxuICAgICAgcmVhc29uOiAnSGFyZCBzaWduYWw6IGVycm9yL2ZhaWx1cmUvc2xvdyBvcGVyYXRpb24gZm9yY2VzIGVtaXQnLFxuICAgICAgcHJpb3JpdHk6IEhBUkRfU0lHTkFMX1BSSU9SSVRZLFxuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgbm9kZS5ldmFsdWF0aW9uID0ge1xuICAgICAgZGVjaXNpb246IHJ1bGVSZXN1bHQuZGVjaXNpb24sXG4gICAgICBydWxlSWQ6IHJ1bGVSZXN1bHQucnVsZUlkLFxuICAgICAgcmVhc29uOiBydWxlUmVzdWx0LnJlYXNvbixcbiAgICAgIHByaW9yaXR5OiBydWxlUmVzdWx0LnByaW9yaXR5LFxuICAgIH07XG4gIH1cblxuICAvLyBQcm9wYWdhdGUgaGFyZCBzaWduYWwgZmxhZyBmcm9tIGNoaWxkcmVuXG4gIC8vIENoZWNrIGJvdGg6IGNoaWxkIElTIGEgaGFyZCBzaWduYWwsIG9yIGNoaWxkIEhBUyBoYXJkIHNpZ25hbCBkZXNjZW5kYW50c1xuICBjb25zdCBjaGlsZEhhc0hhcmRTaWduYWwgPSBub2RlLmNoaWxkcmVuLnNvbWUoXG4gICAgYyA9PiBjLmlzSGFyZFNpZ25hbCB8fCBjLmhhc0hhcmRTaWduYWxEZXNjZW5kYW50LFxuICApO1xuICBub2RlLmhhc0hhcmRTaWduYWxEZXNjZW5kYW50ID0gY2hpbGRIYXNIYXJkU2lnbmFsO1xuXG4gIC8vIENvbnRleHQgcHJlc2VydmF0aW9uOiBpZiB0aGlzIHNwYW4gaGFzIGhhcmQgc2lnbmFsIGRlc2NlbmRhbnRzIGFuZCB3b3VsZFxuICAvLyBiZSBhYnNvcmJlZC9zaWxlbmNlZCwgZm9yY2UgaXQgdG8gZW1pdCB0byBwcmVzZXJ2ZSB0aGUgaGllcmFyY2h5XG4gIGlmIChjaGlsZEhhc0hhcmRTaWduYWwgJiYgbm9kZS5ldmFsdWF0aW9uLmRlY2lzaW9uICE9PSAnZW1pdCcgJiYgbm9kZS5ldmVudC50eXBlID09PSAnc3BhbicpIHtcbiAgICBub2RlLmV2YWx1YXRpb24gPSB7XG4gICAgICBkZWNpc2lvbjogJ2VtaXQnLFxuICAgICAgcnVsZUlkOiAnaGFyZC1zaWduYWwtYW5jZXN0b3InLFxuICAgICAgcmVhc29uOiAnQW5jZXN0b3Igb2YgaGFyZCBzaWduYWw6IGZvcmNlZCBlbWl0IHRvIHByZXNlcnZlIGhpZXJhcmNoeScsXG4gICAgICBwcmlvcml0eTogSEFSRF9TSUdOQUxfUFJJT1JJVFksXG4gICAgfTtcbiAgfVxufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFBIQVNFIDM6IENPTExFQ1QgT1VUUFVUIChwcmUtb3JkZXIgREZTKVxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogRW50cnkgaW4gdGhlIGVtaXR0ZWQgZXZlbnRzIGxpc3QgZHVyaW5nIGNvbGxlY3Rpb24uXG4gKi9cbmludGVyZmFjZSBDb2xsZWN0ZWRFbWl0dGVkRW50cnkge1xuICByZWFkb25seSBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50O1xuICByZWFkb25seSByZXNvbHZlZFBhcmVudElkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIHJlYWRvbmx5IGV2YWx1YXRpb24/OiBOb2RlRGVjaXNpb247XG4gIC8qKiBcbiAgICogVHJ1ZSBpZiB0aGlzIGV2ZW50IHdhcyBwcm9tb3RlZCBmcm9tIGFic29yYi9zaWxlbnQgdG8gZW1pdCBiZWNhdXNlIGl0IGhhZCBubyBlbWl0dGVkIGFuY2VzdG9yLlxuICAgKiBQcm9tb3RlZCBldmVudHMgYXJlIG5vaXNlIHJvb3RzIOKAlCB0aGV5IGFyZSBhbHdheXMgc3RyaXBwZWQgZnJvbSB0aGUgZmluYWwgb3V0cHV0LlxuICAgKiBJZiBhbGwgZXZlbnRzIGFyZSBwcm9tb3RlZCwgdGhlIGVudGlyZSBpbnZvY2F0aW9uIGlzIG5vaXNlIGFuZCBmdWxseSBzdXBwcmVzc2VkLlxuICAgKi9cbiAgcmVhZG9ubHkgcHJvbW90ZWQ/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIEFjY3VtdWxhdGVkIG91dHB1dCBkdXJpbmcgdGhlIGNvbGxlY3QgcGhhc2UuXG4gKi9cbmludGVyZmFjZSBDb2xsZWN0U3RhdGUge1xuICAvKiogT3JkZXJlZCBsaXN0IG9mIGVtaXR0ZWQgZXZlbnRzIHdpdGggcmVzb2x2ZWQgcGFyZW50IElEcyBhbmQgZXZhbHVhdGlvbiBtZXRhZGF0YSAqL1xuICByZWFkb25seSBlbWl0dGVkRXZlbnRzOiBDb2xsZWN0ZWRFbWl0dGVkRW50cnlbXTtcbiAgLyoqIEFic29yYmVkIGRhdGEgYnVpbGRlcnMga2V5ZWQgYnkgdGhlIG9ic2VydmFiaWxpdHlMb2dJZCBvZiB0aGUgZW1pdHRlZCBhbmNlc3RvciAqL1xuICByZWFkb25seSBhYnNvcmJlZEJ5Tm9kZUlkOiBNYXA8c3RyaW5nLCBNdXRhYmxlQWJzb3JiZWREYXRhPjtcbiAgLyoqIE11dGFibGUgc3RhdHMgY291bnRlcnMgKi9cbiAgcmVhZG9ubHkgc3RhdHM6IFJldHVyblR5cGU8dHlwZW9mIGNyZWF0ZU11dGFibGVTdGF0cz47XG4gIC8qKiBBYnNvcnB0aW9uIGJvdW5kcyBmcm9tIGNvbmZpZyAqL1xuICByZWFkb25seSBib3VuZHM6IEFic29ycHRpb25Cb3VuZHM7XG59XG5cbi8qKlxuICogQ29sbGVjdCBvdXRwdXQgZnJvbSBhIHN1YnRyZWUgdmlhIHByZS1vcmRlciBERlMuXG4gKiBcbiAqIC0gRU1JVCBub2RlcyBiZWNvbWUgb3V0cHV0IGV2ZW50czsgdGhlaXIgY2hpbGRyZW4gZ2V0IHRoaXMgbm9kZSBhcyB0aGVpciBuZWFyZXN0IGVtaXR0ZWQgYW5jZXN0b3JcbiAqIC0gQUJTT1JCIG5vZGVzIG1lcmdlIGRhdGEgaW50byB0aGUgbmVhcmVzdCBlbWl0dGVkIGFuY2VzdG9yOyBjaGlsZHJlbiBpbmhlcml0IHRoZSBzYW1lIGFuY2VzdG9yXG4gKiAtIFNJTEVOVCBub2RlcyBpbmNyZW1lbnQgYSBjb3VudGVyIG9uIHRoZSBuZWFyZXN0IGVtaXR0ZWQgYW5jZXN0b3I7IGNoaWxkcmVuIGluaGVyaXQgdGhlIHNhbWUgYW5jZXN0b3JcbiAqIFxuICogSWYgYSBub2RlIHdvdWxkIGJlIGFic29yYmVkL3NpbGVuY2VkIGJ1dCBoYXMgbm8gZW1pdHRlZCBhbmNlc3RvciAocm9vdCB3aXRoIG5vIHBhcmVudCBpbiBiYXRjaCksXG4gKiBpdCBpcyBwcm9tb3RlZCB0byBlbWl0IGFuZCBtYXJrZWQgYXMgYHByb21vdGVkOiB0cnVlYC4gQWZ0ZXIgY29sbGVjdGlvbiwgaWYgQUxMIGVtaXR0ZWQgZXZlbnRzXG4gKiBhcmUgcHJvbW90ZWQsIHRoZSBlbnRpcmUgaW52b2NhdGlvbiB0cmVlIGlzIG5vaXNlIGFuZCBjYW4gYmUgc3VwcHJlc3NlZC5cbiAqL1xuZnVuY3Rpb24gY29sbGVjdE5vZGUoXG4gIG5vZGU6IE11dGFibGVUcmVlTm9kZSxcbiAgbmVhcmVzdEVtaXR0ZWRBbmNlc3RvcklkOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4gIHN0YXRlOiBDb2xsZWN0U3RhdGUsXG4pOiB2b2lkIHtcbiAgLy8gU2FmZXR5OiBldmFsdWF0aW9uIG11c3QgYmUgc2V0IGJ5IFBoYXNlIDJcbiAgY29uc3QgZGVjaXNpb24gPSBub2RlLmV2YWx1YXRpb24/LmRlY2lzaW9uID8/ICdlbWl0JztcblxuICBpZiAoZGVjaXNpb24gPT09ICdlbWl0Jykge1xuICAgIC8vIFRoaXMgbm9kZSBpcyBnZW51aW5lbHkgZW1pdHRlZCBhcyBhIHN0YW5kYWxvbmUgcmVjb3JkXG4gICAgc3RhdGUuZW1pdHRlZEV2ZW50cy5wdXNoKHtcbiAgICAgIGV2ZW50OiBub2RlLmV2ZW50LFxuICAgICAgcmVzb2x2ZWRQYXJlbnRJZDogbmVhcmVzdEVtaXR0ZWRBbmNlc3RvcklkLFxuICAgICAgZXZhbHVhdGlvbjogbm9kZS5ldmFsdWF0aW9uLFxuICAgICAgcHJvbW90ZWQ6IGZhbHNlLFxuICAgIH0pO1xuICAgIHN0YXRlLnN0YXRzLmVtaXR0ZWQrKztcblxuICAgIC8vIENoaWxkcmVuIHNlZSB0aGlzIG5vZGUgYXMgdGhlaXIgbmVhcmVzdCBlbWl0dGVkIGFuY2VzdG9yXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICBjb2xsZWN0Tm9kZShjaGlsZCwgbm9kZS5ldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQsIHN0YXRlKTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoZGVjaXNpb24gPT09ICdhYnNvcmInKSB7XG4gICAgaWYgKG5lYXJlc3RFbWl0dGVkQW5jZXN0b3JJZCkge1xuICAgICAgLy8gTWVyZ2UgZGF0YSBpbnRvIHRoZSBuZWFyZXN0IGVtaXR0ZWQgYW5jZXN0b3JcbiAgICAgIGNvbnN0IGFic29yYmVkID0gZ2V0T3JDcmVhdGVBYnNvcmJlZChzdGF0ZS5hYnNvcmJlZEJ5Tm9kZUlkLCBuZWFyZXN0RW1pdHRlZEFuY2VzdG9ySWQpO1xuICAgICAgYWJzb3JiRXZlbnQoYWJzb3JiZWQsIG5vZGUuZXZlbnQsIHN0YXRlLmJvdW5kcyk7XG4gICAgICBzdGF0ZS5zdGF0cy5hYnNvcmJlZCsrO1xuICAgICAgaW5jcmVtZW50Q291bnRlcihzdGF0ZS5zdGF0cy5hYnNvcmJlZEJ5T3BlcmF0aW9uLCBub2RlLmV2ZW50Lm9wZXJhdGlvbiA/PyBub2RlLmV2ZW50LnR5cGUpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBObyBhbmNlc3RvciB0byBhYnNvcmIgaW50byDihpIgcHJvbW90ZSB0byBlbWl0IChtYXJrZWQgZm9yIHBvc3NpYmxlIHN1cHByZXNzaW9uKVxuICAgICAgc3RhdGUuZW1pdHRlZEV2ZW50cy5wdXNoKHtcbiAgICAgICAgZXZlbnQ6IG5vZGUuZXZlbnQsXG4gICAgICAgIHJlc29sdmVkUGFyZW50SWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgZXZhbHVhdGlvbjogbm9kZS5ldmFsdWF0aW9uLFxuICAgICAgICBwcm9tb3RlZDogdHJ1ZSxcbiAgICAgIH0pO1xuICAgICAgc3RhdGUuc3RhdHMuZW1pdHRlZCsrO1xuICAgIH1cblxuICAgIC8vIENoaWxkcmVuIGluaGVyaXQgdGhlIHNhbWUgbmVhcmVzdCBlbWl0dGVkIGFuY2VzdG9yIChvciB0aGlzIG5vZGUgaWYgcHJvbW90ZWQpXG4gICAgY29uc3QgY2hpbGRBbmNlc3RvcklkID0gbmVhcmVzdEVtaXR0ZWRBbmNlc3RvcklkID8/IG5vZGUuZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIGZvciAoY29uc3QgY2hpbGQgb2Ygbm9kZS5jaGlsZHJlbikge1xuICAgICAgY29sbGVjdE5vZGUoY2hpbGQsIGNoaWxkQW5jZXN0b3JJZCwgc3RhdGUpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyAnc2lsZW50JzogY291bnRlciBvbmx5XG4gICAgaWYgKG5lYXJlc3RFbWl0dGVkQW5jZXN0b3JJZCkge1xuICAgICAgY29uc3QgYWJzb3JiZWQgPSBnZXRPckNyZWF0ZUFic29yYmVkKHN0YXRlLmFic29yYmVkQnlOb2RlSWQsIG5lYXJlc3RFbWl0dGVkQW5jZXN0b3JJZCk7XG4gICAgICByZWNvcmRTaWxlbnQoYWJzb3JiZWQpO1xuICAgICAgc3RhdGUuc3RhdHMuc2lsZW5jZWQrKztcbiAgICAgIGluY3JlbWVudENvdW50ZXIoc3RhdGUuc3RhdHMuc2lsZW5jZWRCeU9wZXJhdGlvbiwgbm9kZS5ldmVudC5vcGVyYXRpb24gPz8gbm9kZS5ldmVudC50eXBlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTm8gYW5jZXN0b3IgdG8gdHJhY2sgY291bnRlciBvbiDihpIgcHJvbW90ZSB0byBlbWl0IChtYXJrZWQgZm9yIHBvc3NpYmxlIHN1cHByZXNzaW9uKVxuICAgICAgc3RhdGUuZW1pdHRlZEV2ZW50cy5wdXNoKHtcbiAgICAgICAgZXZlbnQ6IG5vZGUuZXZlbnQsXG4gICAgICAgIHJlc29sdmVkUGFyZW50SWQ6IHVuZGVmaW5lZCxcbiAgICAgICAgZXZhbHVhdGlvbjogbm9kZS5ldmFsdWF0aW9uLFxuICAgICAgICBwcm9tb3RlZDogdHJ1ZSxcbiAgICAgIH0pO1xuICAgICAgc3RhdGUuc3RhdHMuZW1pdHRlZCsrO1xuICAgIH1cblxuICAgIGNvbnN0IGNoaWxkQW5jZXN0b3JJZCA9IG5lYXJlc3RFbWl0dGVkQW5jZXN0b3JJZCA/PyBub2RlLmV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgIGNvbGxlY3ROb2RlKGNoaWxkLCBjaGlsZEFuY2VzdG9ySWQsIHN0YXRlKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gZ2V0T3JDcmVhdGVBYnNvcmJlZChcbiAgbWFwOiBNYXA8c3RyaW5nLCBNdXRhYmxlQWJzb3JiZWREYXRhPixcbiAgbm9kZUlkOiBzdHJpbmcsXG4pOiBNdXRhYmxlQWJzb3JiZWREYXRhIHtcbiAgbGV0IGFic29yYmVkID0gbWFwLmdldChub2RlSWQpO1xuICBpZiAoIWFic29yYmVkKSB7XG4gICAgYWJzb3JiZWQgPSBjcmVhdGVNdXRhYmxlQWJzb3JiZWQoKTtcbiAgICBtYXAuc2V0KG5vZGVJZCwgYWJzb3JiZWQpO1xuICB9XG4gIHJldHVybiBhYnNvcmJlZDtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBNQUlOIEVOVFJZIFBPSU5UXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqXG4gKiBBcHBseSBub2lzZSByZWR1Y3Rpb24gdG8gYSBiYXRjaCBvZiBvYnNlcnZhYmlsaXR5IGV2ZW50cy5cbiAqIFxuICogVGhpcyBpcyB0aGUgY29yZSBhbGdvcml0aG0uIEl0IHByb2Nlc3NlcyBldmVudHMgdGhyb3VnaCB0aHJlZSBwaGFzZXM6XG4gKiAxLiBCdWlsZCB0cmVlIGZyb20gZmxhdCBldmVudHMgKHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBsaW5rYWdlKVxuICogMi4gRXZhbHVhdGUgZGVjaXNpb25zIHZpYSBwb3N0LW9yZGVyIERGUyAocnVsZXMgKyBoYXJkIHNpZ25hbHMpXG4gKiAzLiBDb2xsZWN0IG91dHB1dCB2aWEgcHJlLW9yZGVyIERGUyAocmVzb2x2ZWQgcGFyZW50cyArIGFic29yYmVkIGRhdGEpXG4gKiBcbiAqIHNwYW4uc3RhcnQgZXZlbnRzIGFyZSBoYW5kbGVkIHNlcGFyYXRlbHk6IHRoZXkgZm9sbG93IHRoZSBkZWNpc2lvbiBvZiB0aGVpclxuICogY29ycmVzcG9uZGluZyBjb25zb2xpZGF0ZWQgc3BhbiAoc2FtZSBvYnNlcnZhYmlsaXR5TG9nSWQpLlxuICogXG4gKiBAcGFyYW0gaW5wdXRFdmVudHMgLSBSYXcgZXZlbnRzIGZyb20gdGhlIGludm9jYXRpb24gYnVmZmVyXG4gKiBAcGFyYW0gY29uZmlnIC0gTm9pc2UgcmVkdWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIFJlZHVjZWQgZXZlbnRzIHdpdGggcmVzb2x2ZWQgcGFyZW50IElEcyBhbmQgYWJzb3JiZWQgZGF0YVxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgaW5wdXRFdmVudHM6IHJlYWRvbmx5IE9ic2VydmFiaWxpdHlFdmVudFtdLFxuICBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnLFxuKTogTm9pc2VSZWR1Y3Rpb25SZXN1bHQge1xuICAvLyBEaXNhYmxlZCDihpIgcGFzcyBldmVyeXRoaW5nIHRocm91Z2hcbiAgaWYgKCFjb25maWcuZW5hYmxlZCkge1xuICAgIGNvbnN0IGV2ZW50czogRW1pdHRlZEV2ZW50W10gPSBpbnB1dEV2ZW50cy5tYXAoZXZlbnQgPT4gKHtcbiAgICAgIGV2ZW50LFxuICAgICAgcmVzb2x2ZWRQYXJlbnRJZDogZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8/IHVuZGVmaW5lZCxcbiAgICAgIGFic29yYmVkOiB1bmRlZmluZWQsXG4gICAgfSkpO1xuICAgIHJldHVybiB7XG4gICAgICBldmVudHMsXG4gICAgICBzdGF0czoge1xuICAgICAgICBlbWl0dGVkOiBpbnB1dEV2ZW50cy5sZW5ndGgsXG4gICAgICAgIGFic29yYmVkOiAwLFxuICAgICAgICBzaWxlbmNlZDogMCxcbiAgICAgICAgdG90YWxJbnB1dDogaW5wdXRFdmVudHMubGVuZ3RoLFxuICAgICAgICBzdXBwcmVzc2VkUm9vdHM6IDAsXG4gICAgICAgIGFic29yYmVkQnlPcGVyYXRpb246IHt9LFxuICAgICAgICBzaWxlbmNlZEJ5T3BlcmF0aW9uOiB7fSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IGJvdW5kcyA9IGdldEFic29ycHRpb25Cb3VuZHMoY29uZmlnKTtcblxuICAvLyBDb2xsZWN0IGFsbCBydWxlcyAoYnVpbHRpbiArIGN1c3RvbSlcbiAgY29uc3QgYnVpbHRpblJ1bGVzID0gZ2V0QnVpbHRpblJ1bGVzKGNvbmZpZy5wcmVzZXRzKTtcbiAgY29uc3QgYWxsUnVsZXM6IHJlYWRvbmx5IE5vaXNlUnVsZVtdID0gWy4uLmJ1aWx0aW5SdWxlcywgLi4uY29uZmlnLnJ1bGVzXTtcblxuICAvLyBQaGFzZSAxOiBCdWlsZCB0cmVlIChzZXBhcmF0ZXMgc3Bhbi5zdGFydCBldmVudHMpXG4gIGNvbnN0IHsgcm9vdHMsIG5vZGVCeUlkLCBzcGFuU3RhcnRFdmVudHMgfSA9IGJ1aWxkVHJlZShpbnB1dEV2ZW50cyk7XG5cbiAgLy8gUGhhc2UgMjogRXZhbHVhdGUgZGVjaXNpb25zIChwb3N0LW9yZGVyIERGUylcbiAgZm9yIChjb25zdCByb290IG9mIHJvb3RzKSB7XG4gICAgZXZhbHVhdGVTdWJ0cmVlKHJvb3QsIGNvbmZpZywgYWxsUnVsZXMsIG1hdGNoZXNSdWxlKTtcbiAgfVxuXG4gIC8vIFRyYWNrIGRlY2lzaW9ucyBmb3Igc3Bhbi5zdGFydCBoYW5kbGluZ1xuICBjb25zdCBzcGFuRGVjaXNpb25zID0gbmV3IE1hcDxzdHJpbmcsIE5vZGVEZWNpc2lvbj4oKTtcbiAgZm9yIChjb25zdCBub2RlIG9mIG5vZGVCeUlkLnZhbHVlcygpKSB7XG4gICAgaWYgKG5vZGUuZXZlbnQudHlwZSA9PT0gJ3NwYW4nICYmIG5vZGUuZXZhbHVhdGlvbikge1xuICAgICAgc3BhbkRlY2lzaW9ucy5zZXQobm9kZS5ldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQsIG5vZGUuZXZhbHVhdGlvbik7XG4gICAgfVxuICB9XG5cbiAgLy8gUGhhc2UgMzogQ29sbGVjdCBvdXRwdXQgKHByZS1vcmRlciBERlMpXG4gIGNvbnN0IHN0YXRlOiBDb2xsZWN0U3RhdGUgPSB7XG4gICAgZW1pdHRlZEV2ZW50czogW10sXG4gICAgYWJzb3JiZWRCeU5vZGVJZDogbmV3IE1hcCgpLFxuICAgIHN0YXRzOiBjcmVhdGVNdXRhYmxlU3RhdHMoKSxcbiAgICBib3VuZHMsXG4gIH07XG5cbiAgZm9yIChjb25zdCByb290IG9mIHJvb3RzKSB7XG4gICAgY29sbGVjdE5vZGUocm9vdCwgdW5kZWZpbmVkLCBzdGF0ZSk7XG4gIH1cblxuICAvLyBIYW5kbGUgc3Bhbi5zdGFydCBldmVudHM6IGZvbGxvdyB0aGUgZGVjaXNpb24gb2YgdGhlaXIgcGFyZW50IHNwYW5cbiAgZm9yIChjb25zdCBzcGFuU3RhcnQgb2Ygc3BhblN0YXJ0RXZlbnRzKSB7XG4gICAgY29uc3QgcGFyZW50RGVjaXNpb24gPSBzcGFuRGVjaXNpb25zLmdldChzcGFuU3RhcnQub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICBpZiAoIXBhcmVudERlY2lzaW9uIHx8IHBhcmVudERlY2lzaW9uLmRlY2lzaW9uID09PSAnZW1pdCcpIHtcbiAgICAgIC8vIFNwYW4gd2FzIGVtaXR0ZWQg4oaSIGVtaXQgaXRzIHNwYW4uc3RhcnQgdG9vXG4gICAgICBzdGF0ZS5lbWl0dGVkRXZlbnRzLnB1c2goe1xuICAgICAgICBldmVudDogc3BhblN0YXJ0LFxuICAgICAgICByZXNvbHZlZFBhcmVudElkOiBzcGFuU3RhcnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8/IHVuZGVmaW5lZCxcbiAgICAgIH0pO1xuICAgICAgc3RhdGUuc3RhdHMuZW1pdHRlZCsrO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTcGFuIHdhcyBhYnNvcmJlZC9zaWxlbmNlZCDihpIgZHJvcCBzcGFuLnN0YXJ0XG4gICAgICBzdGF0ZS5zdGF0cy5zaWxlbmNlZCsrO1xuICAgICAgaW5jcmVtZW50Q291bnRlcihzdGF0ZS5zdGF0cy5zaWxlbmNlZEJ5T3BlcmF0aW9uLCBzcGFuU3RhcnQub3BlcmF0aW9uID8/ICdzcGFuLnN0YXJ0Jyk7XG4gICAgfVxuICB9XG5cbiAgc3RhdGUuc3RhdHMudG90YWxJbnB1dCA9IGlucHV0RXZlbnRzLmxlbmd0aDtcblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gTk9JU0UgUk9PVCBTVFJJUFBJTkdcbiAgLy9cbiAgLy8gUHJvbW90ZWQgZXZlbnRzIGFyZSBub2lzZSByb290cyAoc2lsZW50L2Fic29yYmVkKSB0aGF0IGhhZCBubyBlbWl0dGVkXG4gIC8vIGFuY2VzdG9yLiBUaGV5IGFyZSBBTFdBWVMgc3RyaXBwZWQgZnJvbSB0aGUgb3V0cHV0OlxuICAvL1xuICAvLyAxLiBJZiBBTEwgZW1pdHRlZCBldmVudHMgYXJlIHByb21vdGVkIOKGkiBlbnRpcmUgaW52b2NhdGlvbiBpcyBub2lzZVxuICAvLyAgICAoZS5nLiwgaWRsZSBzY2hlZHVsZWQgdGFzaywgc3RyZWFtIHByb2Nlc3NvciB0aGF0IGp1c3QgZm9yd2FyZGVkKS5cbiAgLy8gICAgTm90aGluZyBpcyBwZXJzaXN0ZWQg4oCUIHRoaXMgaXMgXCJyb290IHN1cHByZXNzaW9uXCIuXG4gIC8vXG4gIC8vIDIuIElmIFNPTUUgYXJlIHByb21vdGVkIGFuZCBTT01FIGFyZSBnZW51aW5lIOKGkiB0aGUgbm9pc2Ugcm9vdHMgYXJlXG4gIC8vICAgIGRyb3BwZWQgYnV0IGdlbnVpbmUgY2hpbGRyZW4gYXJlIGtlcHQuIEdlbnVpbmUgY2hpbGRyZW4gdGhhdFxuICAvLyAgICByZWZlcmVuY2VkIGEgcHJvbW90ZWQgcm9vdCBnZXQgcmVzb2x2ZWRQYXJlbnRJZCBjbGVhcmVkIHRvXG4gIC8vICAgIHVuZGVmaW5lZCAodGhleSBiZWNvbWUgbmV3IHJvb3RzIGluIHRoZSBvdXRwdXQpLlxuICAvLyAgICBFeGFtcGxlOiBEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyIGJhdGNoIHNwYW4gaXMgZHJvcHBlZCwgYnV0IHRoZVxuICAvLyAgICBnZW51aW5lIGF1ZGl0LmVudGl0eSBjaGlsZHJlbiBhcmUgcGVyc2lzdGVkIGFzIHJvb3QgcmVjb3Jkcy5cbiAgLy9cbiAgLy8gU2FmZXR5IGd1YXJhbnRlZXM6XG4gIC8vIC0gSGFyZCBzaWduYWxzIChlcnJvcnMvZmFpbHVyZXMvc2xvdyBvcHMpIGZvcmNlIGBkZWNpc2lvbjogJ2VtaXQnYCBpblxuICAvLyAgIFBoYXNlIDIsIHNvIHRoZXkgYXJlIE5FVkVSIHByb21vdGVkIGFuZCBhcmUgYWx3YXlzIHBlcnNpc3RlZC5cbiAgLy8gLSBHZW51aW5lIGF1ZGl0IHJlY29yZHMsIHVzZXItZmFjaW5nIGV2ZW50cywgZXRjLiB0aGF0IGRvbid0IG1hdGNoIGFueVxuICAvLyAgIHNpbGVudC9hYnNvcmIgcnVsZSBkZWZhdWx0IHRvICdlbWl0JyBhbmQgYXJlIGFsd2F5cyBwZXJzaXN0ZWQuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8vIENvbGxlY3QgSURzIG9mIHByb21vdGVkIChub2lzZSkgZXZlbnRzIHNvIHdlIGNhbiBmaXggcGFyZW50IHJlZmVyZW5jZXNcbiAgY29uc3QgcHJvbW90ZWRJZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5lbWl0dGVkRXZlbnRzKSB7XG4gICAgaWYgKGVudHJ5LnByb21vdGVkID09PSB0cnVlKSB7XG4gICAgICBwcm9tb3RlZElkcy5hZGQoZW50cnkuZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICB9XG4gIH1cblxuICAvLyBTZXBhcmF0ZSBnZW51aW5lIGFuZCBwcm9tb3RlZCBldmVudHNcbiAgY29uc3QgZ2VudWluZUV2ZW50czogdHlwZW9mIHN0YXRlLmVtaXR0ZWRFdmVudHMgPSBbXTtcbiAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5lbWl0dGVkRXZlbnRzKSB7XG4gICAgaWYgKGVudHJ5LnByb21vdGVkID09PSB0cnVlKSB7XG4gICAgICAvLyBOb2lzZSByb290IOKAlCBzdHJpcCBmcm9tIG91dHB1dCBhbmQgYWRqdXN0IHN0YXRzXG4gICAgICBzdGF0ZS5zdGF0cy5lbWl0dGVkLS07XG4gICAgICBjb25zdCBvcmlnaW5hbERlY2lzaW9uID0gZW50cnkuZXZhbHVhdGlvbj8uZGVjaXNpb24gPz8gJ3NpbGVudCc7XG4gICAgICBpZiAob3JpZ2luYWxEZWNpc2lvbiA9PT0gJ2Fic29yYicpIHtcbiAgICAgICAgc3RhdGUuc3RhdHMuYWJzb3JiZWQrKztcbiAgICAgICAgaW5jcmVtZW50Q291bnRlcihzdGF0ZS5zdGF0cy5hYnNvcmJlZEJ5T3BlcmF0aW9uLCBlbnRyeS5ldmVudC5vcGVyYXRpb24gPz8gZW50cnkuZXZlbnQudHlwZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzdGF0ZS5zdGF0cy5zaWxlbmNlZCsrO1xuICAgICAgICBpbmNyZW1lbnRDb3VudGVyKHN0YXRlLnN0YXRzLnNpbGVuY2VkQnlPcGVyYXRpb24sIGVudHJ5LmV2ZW50Lm9wZXJhdGlvbiA/PyBlbnRyeS5ldmVudC50eXBlKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgZ2VudWluZUV2ZW50cy5wdXNoKGVudHJ5KTtcbiAgICB9XG4gIH1cblxuICAvLyBDb3VudCBzdXBwcmVzc2VkIHJvb3RzIChhbGwgcHJvbW90ZWQsIGVudGlyZSBpbnZvY2F0aW9uIGlzIG5vaXNlKVxuICBpZiAoZ2VudWluZUV2ZW50cy5sZW5ndGggPT09IDAgJiYgcHJvbW90ZWRJZHMuc2l6ZSA+IDApIHtcbiAgICBzdGF0ZS5zdGF0cy5zdXBwcmVzc2VkUm9vdHMgKz0gcm9vdHMubGVuZ3RoO1xuICB9XG5cbiAgLy8gQnVpbGQgZmluYWwgb3V0cHV0IHdpdGggZnJvemVuIGFic29yYmVkIGRhdGEgKGFuZCBvcHRpb25hbCBkZWJ1ZyBpbmZvKVxuICBjb25zdCBpbmNsdWRlRGVidWcgPSBjb25maWcuZGVidWcgPT09IHRydWU7XG4gIGNvbnN0IGZpbmFsRXZlbnRzOiBFbWl0dGVkRXZlbnRbXSA9IGdlbnVpbmVFdmVudHMubWFwKCh7IGV2ZW50LCByZXNvbHZlZFBhcmVudElkLCBldmFsdWF0aW9uIH0pID0+IHtcbiAgICBjb25zdCBtdXRhYmxlQWJzb3JiZWQgPSBzdGF0ZS5hYnNvcmJlZEJ5Tm9kZUlkLmdldChldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuXG4gICAgLy8gSWYgdGhpcyBldmVudCdzIHBhcmVudCB3YXMgYSBwcm9tb3RlZCAobm9pc2UpIHJvb3QsIGNsZWFyIGJvdGggdGhlXG4gICAgLy8gcmVzb2x2ZWQgcGFyZW50IElEIGFuZCB0aGUgZXZlbnQncyBvcmlnaW5hbCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQuXG4gICAgLy8gVGhpcyBwcmV2ZW50cyB0aGUgbWFuYWdlciBmcm9tIGZhbGxpbmcgYmFjayB0byBhIHN0YWxlIHJlZmVyZW5jZSB0aGF0XG4gICAgLy8gcG9pbnRzIHRvIGEgc3BhbiB0aGF0IHdhcyBzdHJpcHBlZCBmcm9tIHRoZSBvdXRwdXQuXG4gICAgbGV0IGNsZWFuUGFyZW50SWQgPSByZXNvbHZlZFBhcmVudElkO1xuICAgIGlmIChyZXNvbHZlZFBhcmVudElkICYmIHByb21vdGVkSWRzLmhhcyhyZXNvbHZlZFBhcmVudElkKSkge1xuICAgICAgY2xlYW5QYXJlbnRJZCA9IHVuZGVmaW5lZDtcbiAgICAgIChldmVudCBhcyBhbnkpLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZXZlbnQsXG4gICAgICByZXNvbHZlZFBhcmVudElkOiBjbGVhblBhcmVudElkLFxuICAgICAgYWJzb3JiZWQ6IG11dGFibGVBYnNvcmJlZCA/IGZyZWV6ZUFic29yYmVkKG11dGFibGVBYnNvcmJlZCkgOiB1bmRlZmluZWQsXG4gICAgICBkZWJ1Z0luZm86IGluY2x1ZGVEZWJ1ZyAmJiBldmFsdWF0aW9uID8ge1xuICAgICAgICBkZWNpc2lvbjogZXZhbHVhdGlvbi5kZWNpc2lvbixcbiAgICAgICAgcnVsZUlkOiBldmFsdWF0aW9uLnJ1bGVJZCxcbiAgICAgICAgcmVhc29uOiBldmFsdWF0aW9uLnJlYXNvbixcbiAgICAgIH0gOiB1bmRlZmluZWQsXG4gICAgfTtcbiAgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBldmVudHM6IGZpbmFsRXZlbnRzLFxuICAgIHN0YXRzOiBmcmVlemVTdGF0cyhzdGF0ZS5zdGF0cyksXG4gIH07XG59XG5cbi8qKlxuICogRXZhbHVhdGUgbm9pc2UgZGVjaXNpb24gZm9yIGEgc2luZ2xlIGV2ZW50IChmb3IgdGVzdGluZy9pbnNwZWN0aW9uKS5cbiAqIFxuICogVGhpcyBldmFsdWF0ZXMgcnVsZXMgZm9yIGEgc2luZ2xlIGV2ZW50IHdpdGhvdXQgYnVpbGRpbmcgYSB0cmVlLlxuICogRG9lcyBOT1QgYXBwbHkgaGFyZCBzaWduYWwgbG9naWMgb3IgY29udGV4dCBwcmVzZXJ2YXRpb24uXG4gKiBcbiAqIEBwYXJhbSBldmVudCAtIEV2ZW50IHRvIGV2YWx1YXRlXG4gKiBAcGFyYW0gY29uZmlnIC0gTm9pc2UgcmVkdWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIERlY2lzaW9uIHdpdGggY29udGV4dFxuICovXG5leHBvcnQgZnVuY3Rpb24gcGlja05vaXNlRGVjaXNpb24oXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcsXG4pOiB7IHJlYWRvbmx5IGRlY2lzaW9uOiBzdHJpbmc7IHJlYWRvbmx5IHJ1bGVJZDogc3RyaW5nOyByZWFkb25seSByZWFzb246IHN0cmluZyB9IHtcbiAgY29uc3QgYnVpbHRpblJ1bGVzID0gZ2V0QnVpbHRpblJ1bGVzKGNvbmZpZy5wcmVzZXRzKTtcbiAgY29uc3QgYWxsUnVsZXM6IHJlYWRvbmx5IE5vaXNlUnVsZVtdID0gWy4uLmJ1aWx0aW5SdWxlcywgLi4uY29uZmlnLnJ1bGVzXTtcbiAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVOb2lzZVJ1bGVzKGV2ZW50LCBhbGxSdWxlcywgbWF0Y2hlc1J1bGUpO1xuXG4gIHJldHVybiB7XG4gICAgZGVjaXNpb246IHJlc3VsdC5kZWNpc2lvbixcbiAgICBydWxlSWQ6IHJlc3VsdC5ydWxlSWQsXG4gICAgcmVhc29uOiByZXN1bHQucmVhc29uLFxuICB9O1xufVxuXG4vKipcbiAqIEdldCB0aGUgdHJlZSBidWlsdCBmcm9tIGV2ZW50cyAoZm9yIHRlc3RpbmcvaW5zcGVjdGlvbikuXG4gKiBSZXR1cm5zIHRoZSB0cmVlIG5vZGVzIHdpdGggdGhlaXIgZXZhbHVhdGlvbnMgYnV0IHdpdGhvdXQgY29sbGVjdGluZyBvdXRwdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEFuZEV2YWx1YXRlKFxuICBpbnB1dEV2ZW50czogcmVhZG9ubHkgT2JzZXJ2YWJpbGl0eUV2ZW50W10sXG4gIGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcsXG4pOiB7IHJlYWRvbmx5IHJvb3RzOiByZWFkb25seSBUcmVlTm9kZVtdOyByZWFkb25seSBub2RlQnlJZDogUmVhZG9ubHlNYXA8c3RyaW5nLCBUcmVlTm9kZT4gfSB7XG4gIGNvbnN0IGJ1aWx0aW5SdWxlcyA9IGdldEJ1aWx0aW5SdWxlcyhjb25maWcucHJlc2V0cyk7XG4gIGNvbnN0IGFsbFJ1bGVzOiByZWFkb25seSBOb2lzZVJ1bGVbXSA9IFsuLi5idWlsdGluUnVsZXMsIC4uLmNvbmZpZy5ydWxlc107XG5cbiAgY29uc3QgeyByb290cywgbm9kZUJ5SWQgfSA9IGJ1aWxkVHJlZShpbnB1dEV2ZW50cyk7XG5cbiAgZm9yIChjb25zdCByb290IG9mIHJvb3RzKSB7XG4gICAgZXZhbHVhdGVTdWJ0cmVlKHJvb3QsIGNvbmZpZywgYWxsUnVsZXMsIG1hdGNoZXNSdWxlKTtcbiAgfVxuXG4gIC8vIENhc3QgaXMgc2FmZTogTXV0YWJsZVRyZWVOb2RlIHNhdGlzZmllcyBUcmVlTm9kZSAoVHJlZU5vZGUgaXMgcmVhZG9ubHkpXG4gIHJldHVybiB7XG4gICAgcm9vdHM6IHJvb3RzIGFzIHVua25vd24gYXMgcmVhZG9ubHkgVHJlZU5vZGVbXSxcbiAgICBub2RlQnlJZDogbm9kZUJ5SWQgYXMgdW5rbm93biBhcyBSZWFkb25seU1hcDxzdHJpbmcsIFRyZWVOb2RlPixcbiAgfTtcbn1cbiJdfQ==