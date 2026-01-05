"use strict";
/**
 * Tree-based noise reduction for observability events.
 *
 * This module provides intelligent noise reduction for observability data,
 * reducing log volume while preserving critical information.
 *
 * ## Architecture
 *
 * The system uses a 4-phase tree-based approach:
 *
 * 1. **Build Tree**: Convert flat events to tree structure
 * 2. **Evaluate Decisions**: Apply noise rules to each node
 * 3. **Transform Tree**: Apply decisions (drop/fold/aggregate)
 * 4. **Flatten**: Convert back to flat array
 *
 * ## Benefits
 *
 * - **O(n) complexity**: Single pass per phase
 * - **Automatic reparenting**: No separate loops needed
 * - **Clear separation**: Each phase is independently testable
 * - **Type-safe**: Strong TypeScript types throughout
 *
 * @module noise-reduction
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearBuiltinRulesCache = exports.getBuiltinRules = exports.DECISION_BASE_PRIORITY = exports.evaluateNoiseRules = void 0;
exports.applyNoiseReduction = applyNoiseReduction;
exports.pickNoiseDecision = pickNoiseDecision;
const utils_1 = require("./utils");
const builtins_1 = require("./rules/builtins");
const builder_1 = require("./tree/builder");
const evaluator_1 = require("./tree/evaluator");
const propagator_1 = require("./tree/propagator");
const transformer_1 = require("./tree/transformer");
const flattener_1 = require("./tree/flattener");
const priority_1 = require("./priority");
const matcher_1 = require("./rules/matcher");
/**
 * Apply noise reduction to a batch of observability events.
 *
 * This is the main entry point for noise reduction. It processes events
 * through all four phases and returns the reduced output with statistics.
 *
 * ## Algorithm
 *
 * 1. Handle span.start events separately (OTEL compatibility)
 * 2. Build tree from remaining events
 * 3. Evaluate noise rules for all nodes
 * 4. Transform tree (apply decisions)
 * 5. Flatten tree to output
 * 6. Handle span.start based on parent decisions
 *
 * ## Performance
 *
 * - Time: O(n) where n = number of events
 * - Space: O(n) for tree structure
 *
 * @param inputEvents - Events to process
 * @param cfg - Noise reduction configuration
 * @returns Reduced events with statistics
 */
function applyNoiseReduction(inputEvents, cfg) {
    const stats = (0, utils_1.createStats)();
    // If disabled, return all events unchanged
    if (!cfg.enabled) {
        return {
            events: [...inputEvents], // Create mutable copy
            stats: { ...stats, kept: inputEvents.length },
        };
    }
    // ═══════════════════════════════════════════════════════════════════════
    // PREPARATION: Separate span.start events (OTEL compatibility)
    // ═══════════════════════════════════════════════════════════════════════
    const spanStartEvents = [];
    const mainEvents = [];
    const spanDecisions = new Map();
    for (const event of inputEvents) {
        if (event.type === 'span.start') {
            spanStartEvents.push(event);
        }
        else {
            mainEvents.push(event);
        }
    }
    // Collect all rules (builtin + custom)
    const builtinRules = (0, builtins_1.getBuiltinRules)(cfg.presets);
    const allRules = [...builtinRules, ...cfg.rules];
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: BUILD TREE
    // ═══════════════════════════════════════════════════════════════════════
    const { roots, nodeById } = (0, builder_1.buildEventTree)(mainEvents);
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2: EVALUATE DECISIONS
    // ═══════════════════════════════════════════════════════════════════════
    for (const root of roots) {
        (0, evaluator_1.evaluateDecisions)(root, cfg, allRules);
    }
    // Store decisions for span.start handling
    for (const node of nodeById.values()) {
        if (node.event.type === 'span') {
            spanDecisions.set(node.event.observabilityLogId, node.decision ?? 'keep');
        }
    }
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2.5: PROPAGATE HARD SIGNALS
    // ═══════════════════════════════════════════════════════════════════════
    for (const root of roots) {
        (0, propagator_1.propagateHardSignals)(root, cfg);
    }
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 3: TRANSFORM TREE
    // ═══════════════════════════════════════════════════════════════════════
    const allOrphanedNodes = [];
    for (const root of roots) {
        const orphans = (0, transformer_1.transformTree)(root, cfg, stats);
        allOrphanedNodes.push(...orphans);
    }
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 4: FLATTEN TO OUTPUT
    // ═══════════════════════════════════════════════════════════════════════
    const output = [];
    // Flatten original roots
    for (const root of roots) {
        (0, flattener_1.flattenTree)(root, output, cfg);
    }
    // Flatten orphaned nodes (children that became roots)
    for (const orphan of allOrphanedNodes) {
        (0, flattener_1.flattenTree)(orphan, output, cfg);
    }
    // ═══════════════════════════════════════════════════════════════════════
    // HANDLE SPAN.START EVENTS (OTEL COMPATIBILITY)
    // ═══════════════════════════════════════════════════════════════════════
    for (const spanStart of spanStartEvents) {
        // Try to find the corresponding consolidated span's decision by ID
        let decision = spanDecisions.get(spanStart.observabilityLogId);
        // If not found (ID mismatch), evaluate span.start independently
        if (decision === undefined) {
            const result = (0, priority_1.evaluateNoiseRules)(spanStart, allRules, matcher_1.matchesRule);
            decision = result.decision;
        }
        if (decision === 'drop' || decision === 'aggregate') {
            // Span was dropped/aggregated - drop span.start too
            stats.dropped++;
            (0, utils_1.incrementCounter)(stats.droppedByType, spanStart.type);
            (0, utils_1.incrementCounter)(stats.droppedByOperation, spanStart.operation);
        }
        else {
            // Span was kept - keep span.start
            output.push(spanStart);
            stats.kept++;
        }
    }
    // Update final kept count
    stats.kept = output.length;
    return {
        events: output,
        stats,
    };
}
/**
 * Evaluate noise decision for a single event (for testing/inspection).
 *
 * This is a convenience function that evaluates rules for a single event
 * without building a tree or applying transformations.
 *
 * @param event - Event to evaluate
 * @param cfg - Noise reduction configuration
 * @returns Decision with context
 */
function pickNoiseDecision(event, cfg) {
    const builtinRules = (0, builtins_1.getBuiltinRules)(cfg.presets);
    const allRules = [...builtinRules, ...cfg.rules];
    const result = (0, priority_1.evaluateNoiseRules)(event, allRules, matcher_1.matchesRule);
    return {
        decision: result.decision,
        ruleId: result.ruleId,
        reason: result.reason,
    };
}
// ═══════════════════════════════════════════════════════════════════════════
// RE-EXPORTS FOR BACKWARD COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════════════
var priority_2 = require("./priority");
Object.defineProperty(exports, "evaluateNoiseRules", { enumerable: true, get: function () { return priority_2.evaluateNoiseRules; } });
Object.defineProperty(exports, "DECISION_BASE_PRIORITY", { enumerable: true, get: function () { return priority_2.DECISION_BASE_PRIORITY; } });
var builtins_2 = require("./rules/builtins");
Object.defineProperty(exports, "getBuiltinRules", { enumerable: true, get: function () { return builtins_2.getBuiltinRules; } });
Object.defineProperty(exports, "clearBuiltinRulesCache", { enumerable: true, get: function () { return builtins_2.clearBuiltinRulesCache; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXVCRzs7O0FBaURILGtEQTJIQztBQVlELDhDQWFDO0FBak1ELG1DQUF3RDtBQUN4RCwrQ0FBbUQ7QUFDbkQsNENBQWdEO0FBQ2hELGdEQUFxRDtBQUNyRCxrREFBeUQ7QUFDekQsb0RBQW1EO0FBQ25ELGdEQUErQztBQUMvQyx5Q0FBZ0Q7QUFDaEQsNkNBQThDO0FBYTlDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXVCRztBQUNILFNBQWdCLG1CQUFtQixDQUNqQyxXQUE4QyxFQUM5QyxHQUF5QjtJQUV6QixNQUFNLEtBQUssR0FBRyxJQUFBLG1CQUFXLEdBQUUsQ0FBQztJQUU1QiwyQ0FBMkM7SUFDM0MsSUFBSSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNqQixPQUFPO1lBQ0wsTUFBTSxFQUFFLENBQUUsR0FBRyxXQUFXLENBQUUsRUFBRSxzQkFBc0I7WUFDbEQsS0FBSyxFQUFFLEVBQUUsR0FBRyxLQUFLLEVBQUUsSUFBSSxFQUFFLFdBQVcsQ0FBQyxNQUFNLEVBQUU7U0FDOUMsQ0FBQztJQUNKLENBQUM7SUFFRCwwRUFBMEU7SUFDMUUsK0RBQStEO0lBQy9ELDBFQUEwRTtJQUUxRSxNQUFNLGVBQWUsR0FBeUIsRUFBRSxDQUFDO0lBQ2pELE1BQU0sVUFBVSxHQUF5QixFQUFFLENBQUM7SUFDNUMsTUFBTSxhQUFhLEdBQUcsSUFBSSxHQUFHLEVBQXlCLENBQUM7SUFFdkQsS0FBSyxNQUFNLEtBQUssSUFBSSxXQUFXLEVBQUUsQ0FBQztRQUNoQyxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssWUFBWSxFQUFFLENBQUM7WUFDaEMsZUFBZSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMs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QUE7QUFBRSxrSEFBQSxzQkFBc0IsT0FBQTtBQUNuRCw2Q0FBMkU7QUFBbEUsMkdBQUEsZUFBZSxPQUFBO0FBQUUsa0hBQUEsc0JBQXNCLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFRyZWUtYmFzZWQgbm9pc2UgcmVkdWN0aW9uIGZvciBvYnNlcnZhYmlsaXR5IGV2ZW50cy5cbiAqIFxuICogVGhpcyBtb2R1bGUgcHJvdmlkZXMgaW50ZWxsaWdlbnQgbm9pc2UgcmVkdWN0aW9uIGZvciBvYnNlcnZhYmlsaXR5IGRhdGEsXG4gKiByZWR1Y2luZyBsb2cgdm9sdW1lIHdoaWxlIHByZXNlcnZpbmcgY3JpdGljYWwgaW5mb3JtYXRpb24uXG4gKiBcbiAqICMjIEFyY2hpdGVjdHVyZVxuICogXG4gKiBUaGUgc3lzdGVtIHVzZXMgYSA0LXBoYXNlIHRyZWUtYmFzZWQgYXBwcm9hY2g6XG4gKiBcbiAqIDEuICoqQnVpbGQgVHJlZSoqOiBDb252ZXJ0IGZsYXQgZXZlbnRzIHRvIHRyZWUgc3RydWN0dXJlXG4gKiAyLiAqKkV2YWx1YXRlIERlY2lzaW9ucyoqOiBBcHBseSBub2lzZSBydWxlcyB0byBlYWNoIG5vZGVcbiAqIDMuICoqVHJhbnNmb3JtIFRyZWUqKjogQXBwbHkgZGVjaXNpb25zIChkcm9wL2ZvbGQvYWdncmVnYXRlKVxuICogNC4gKipGbGF0dGVuKio6IENvbnZlcnQgYmFjayB0byBmbGF0IGFycmF5XG4gKiBcbiAqICMjIEJlbmVmaXRzXG4gKiBcbiAqIC0gKipPKG4pIGNvbXBsZXhpdHkqKjogU2luZ2xlIHBhc3MgcGVyIHBoYXNlXG4gKiAtICoqQXV0b21hdGljIHJlcGFyZW50aW5nKio6IE5vIHNlcGFyYXRlIGxvb3BzIG5lZWRlZFxuICogLSAqKkNsZWFyIHNlcGFyYXRpb24qKjogRWFjaCBwaGFzZSBpcyBpbmRlcGVuZGVudGx5IHRlc3RhYmxlXG4gKiAtICoqVHlwZS1zYWZlKio6IFN0cm9uZyBUeXBlU2NyaXB0IHR5cGVzIHRocm91Z2hvdXRcbiAqIFxuICogQG1vZHVsZSBub2lzZS1yZWR1Y3Rpb25cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlFdmVudCwgTm9pc2VSZWR1Y3Rpb25Db25maWcsIE5vaXNlRGVjaXNpb24gfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgdHlwZSB7IE5vaXNlUmVkdWN0aW9uU3RhdHMsIFRyZWVOb2RlIH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVTdGF0cywgaW5jcmVtZW50Q291bnRlciB9IGZyb20gJy4vdXRpbHMnO1xuaW1wb3J0IHsgZ2V0QnVpbHRpblJ1bGVzIH0gZnJvbSAnLi9ydWxlcy9idWlsdGlucyc7XG5pbXBvcnQgeyBidWlsZEV2ZW50VHJlZSB9IGZyb20gJy4vdHJlZS9idWlsZGVyJztcbmltcG9ydCB7IGV2YWx1YXRlRGVjaXNpb25zIH0gZnJvbSAnLi90cmVlL2V2YWx1YXRvcic7XG5pbXBvcnQgeyBwcm9wYWdhdGVIYXJkU2lnbmFscyB9IGZyb20gJy4vdHJlZS9wcm9wYWdhdG9yJztcbmltcG9ydCB7IHRyYW5zZm9ybVRyZWUgfSBmcm9tICcuL3RyZWUvdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgZmxhdHRlblRyZWUgfSBmcm9tICcuL3RyZWUvZmxhdHRlbmVyJztcbmltcG9ydCB7IGV2YWx1YXRlTm9pc2VSdWxlcyB9IGZyb20gJy4vcHJpb3JpdHknO1xuaW1wb3J0IHsgbWF0Y2hlc1J1bGUgfSBmcm9tICcuL3J1bGVzL21hdGNoZXInO1xuXG4vKipcbiAqIFJlc3VsdCBvZiBub2lzZSByZWR1Y3Rpb24gcHJvY2Vzc2luZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBOb2lzZVJlZHVjdGlvblJlc3VsdCB7XG4gIC8qKiBFdmVudHMgYWZ0ZXIgbm9pc2UgcmVkdWN0aW9uICovXG4gIGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W107XG5cbiAgLyoqIFN0YXRpc3RpY3MgYWJvdXQgd2hhdCB3YXMgc3VwcHJlc3NlZCAqL1xuICBzdGF0czogTm9pc2VSZWR1Y3Rpb25TdGF0cztcbn1cblxuLyoqXG4gKiBBcHBseSBub2lzZSByZWR1Y3Rpb24gdG8gYSBiYXRjaCBvZiBvYnNlcnZhYmlsaXR5IGV2ZW50cy5cbiAqIFxuICogVGhpcyBpcyB0aGUgbWFpbiBlbnRyeSBwb2ludCBmb3Igbm9pc2UgcmVkdWN0aW9uLiBJdCBwcm9jZXNzZXMgZXZlbnRzXG4gKiB0aHJvdWdoIGFsbCBmb3VyIHBoYXNlcyBhbmQgcmV0dXJucyB0aGUgcmVkdWNlZCBvdXRwdXQgd2l0aCBzdGF0aXN0aWNzLlxuICogXG4gKiAjIyBBbGdvcml0aG1cbiAqIFxuICogMS4gSGFuZGxlIHNwYW4uc3RhcnQgZXZlbnRzIHNlcGFyYXRlbHkgKE9URUwgY29tcGF0aWJpbGl0eSlcbiAqIDIuIEJ1aWxkIHRyZWUgZnJvbSByZW1haW5pbmcgZXZlbnRzXG4gKiAzLiBFdmFsdWF0ZSBub2lzZSBydWxlcyBmb3IgYWxsIG5vZGVzXG4gKiA0LiBUcmFuc2Zvcm0gdHJlZSAoYXBwbHkgZGVjaXNpb25zKVxuICogNS4gRmxhdHRlbiB0cmVlIHRvIG91dHB1dFxuICogNi4gSGFuZGxlIHNwYW4uc3RhcnQgYmFzZWQgb24gcGFyZW50IGRlY2lzaW9uc1xuICogXG4gKiAjIyBQZXJmb3JtYW5jZVxuICogXG4gKiAtIFRpbWU6IE8obikgd2hlcmUgbiA9IG51bWJlciBvZiBldmVudHNcbiAqIC0gU3BhY2U6IE8obikgZm9yIHRyZWUgc3RydWN0dXJlXG4gKiBcbiAqIEBwYXJhbSBpbnB1dEV2ZW50cyAtIEV2ZW50cyB0byBwcm9jZXNzXG4gKiBAcGFyYW0gY2ZnIC0gTm9pc2UgcmVkdWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIFJlZHVjZWQgZXZlbnRzIHdpdGggc3RhdGlzdGljc1xuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgaW5wdXRFdmVudHM6IFJlYWRvbmx5QXJyYXk8T2JzZXJ2YWJpbGl0eUV2ZW50PixcbiAgY2ZnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZ1xuKTogTm9pc2VSZWR1Y3Rpb25SZXN1bHQge1xuICBjb25zdCBzdGF0cyA9IGNyZWF0ZVN0YXRzKCk7XG5cbiAgLy8gSWYgZGlzYWJsZWQsIHJldHVybiBhbGwgZXZlbnRzIHVuY2hhbmdlZFxuICBpZiAoIWNmZy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGV2ZW50czogWyAuLi5pbnB1dEV2ZW50cyBdLCAvLyBDcmVhdGUgbXV0YWJsZSBjb3B5XG4gICAgICBzdGF0czogeyAuLi5zdGF0cywga2VwdDogaW5wdXRFdmVudHMubGVuZ3RoIH0sXG4gICAgfTtcbiAgfVxuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBQUkVQQVJBVElPTjogU2VwYXJhdGUgc3Bhbi5zdGFydCBldmVudHMgKE9URUwgY29tcGF0aWJpbGl0eSlcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgY29uc3Qgc3BhblN0YXJ0RXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtdO1xuICBjb25zdCBtYWluRXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtdO1xuICBjb25zdCBzcGFuRGVjaXNpb25zID0gbmV3IE1hcDxzdHJpbmcsIE5vaXNlRGVjaXNpb24+KCk7XG5cbiAgZm9yIChjb25zdCBldmVudCBvZiBpbnB1dEV2ZW50cykge1xuICAgIGlmIChldmVudC50eXBlID09PSAnc3Bhbi5zdGFydCcpIHtcbiAgICAgIHNwYW5TdGFydEV2ZW50cy5wdXNoKGV2ZW50KTtcbiAgICB9IGVsc2Uge1xuICAgICAgbWFpbkV2ZW50cy5wdXNoKGV2ZW50KTtcbiAgICB9XG4gIH1cblxuICAvLyBDb2xsZWN0IGFsbCBydWxlcyAoYnVpbHRpbiArIGN1c3RvbSlcbiAgY29uc3QgYnVpbHRpblJ1bGVzID0gZ2V0QnVpbHRpblJ1bGVzKGNmZy5wcmVzZXRzKTtcbiAgY29uc3QgYWxsUnVsZXMgPSBbIC4uLmJ1aWx0aW5SdWxlcywgLi4uY2ZnLnJ1bGVzIF07XG5cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gUEhBU0UgMTogQlVJTEQgVFJFRVxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBjb25zdCB7IHJvb3RzLCBub2RlQnlJZCB9ID0gYnVpbGRFdmVudFRyZWUobWFpbkV2ZW50cyk7XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFBIQVNFIDI6IEVWQUxVQVRFIERFQ0lTSU9OU1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBmb3IgKGNvbnN0IHJvb3Qgb2Ygcm9vdHMpIHtcbiAgICBldmFsdWF0ZURlY2lzaW9ucyhyb290LCBjZmcsIGFsbFJ1bGVzKTtcbiAgfVxuXG4gIC8vIFN0b3JlIGRlY2lzaW9ucyBmb3Igc3Bhbi5zdGFydCBoYW5kbGluZ1xuICBmb3IgKGNvbnN0IG5vZGUgb2Ygbm9kZUJ5SWQudmFsdWVzKCkpIHtcbiAgICBpZiAobm9kZS5ldmVudC50eXBlID09PSAnc3BhbicpIHtcbiAgICAgIHNwYW5EZWNpc2lvbnMuc2V0KG5vZGUuZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkLCBub2RlLmRlY2lzaW9uID8/ICdrZWVwJyk7XG4gICAgfVxuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFBIQVNFIDIuNTogUFJPUEFHQVRFIEhBUkQgU0lHTkFMU1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBmb3IgKGNvbnN0IHJvb3Qgb2Ygcm9vdHMpIHtcbiAgICBwcm9wYWdhdGVIYXJkU2lnbmFscyhyb290LCBjZmcpO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFBIQVNFIDM6IFRSQU5TRk9STSBUUkVFXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGNvbnN0IGFsbE9ycGhhbmVkTm9kZXM6IFRyZWVOb2RlW10gPSBbXTtcbiAgZm9yIChjb25zdCByb290IG9mIHJvb3RzKSB7XG4gICAgY29uc3Qgb3JwaGFucyA9IHRyYW5zZm9ybVRyZWUocm9vdCwgY2ZnLCBzdGF0cyk7XG4gICAgYWxsT3JwaGFuZWROb2Rlcy5wdXNoKC4uLm9ycGhhbnMpO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFBIQVNFIDQ6IEZMQVRURU4gVE8gT1VUUFVUXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGNvbnN0IG91dHB1dDogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcblxuICAvLyBGbGF0dGVuIG9yaWdpbmFsIHJvb3RzXG4gIGZvciAoY29uc3Qgcm9vdCBvZiByb290cykge1xuICAgIGZsYXR0ZW5UcmVlKHJvb3QsIG91dHB1dCwgY2ZnKTtcbiAgfVxuXG4gIC8vIEZsYXR0ZW4gb3JwaGFuZWQgbm9kZXMgKGNoaWxkcmVuIHRoYXQgYmVjYW1lIHJvb3RzKVxuICBmb3IgKGNvbnN0IG9ycGhhbiBvZiBhbGxPcnBoYW5lZE5vZGVzKSB7XG4gICAgZmxhdHRlblRyZWUob3JwaGFuLCBvdXRwdXQsIGNmZyk7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gSEFORExFIFNQQU4uU1RBUlQgRVZFTlRTIChPVEVMIENPTVBBVElCSUxJVFkpXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGZvciAoY29uc3Qgc3BhblN0YXJ0IG9mIHNwYW5TdGFydEV2ZW50cykge1xuICAgIC8vIFRyeSB0byBmaW5kIHRoZSBjb3JyZXNwb25kaW5nIGNvbnNvbGlkYXRlZCBzcGFuJ3MgZGVjaXNpb24gYnkgSURcbiAgICBsZXQgZGVjaXNpb24gPSBzcGFuRGVjaXNpb25zLmdldChzcGFuU3RhcnQub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcblxuICAgIC8vIElmIG5vdCBmb3VuZCAoSUQgbWlzbWF0Y2gpLCBldmFsdWF0ZSBzcGFuLnN0YXJ0IGluZGVwZW5kZW50bHlcbiAgICBpZiAoZGVjaXNpb24gPT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVOb2lzZVJ1bGVzKHNwYW5TdGFydCwgYWxsUnVsZXMsIG1hdGNoZXNSdWxlKTtcbiAgICAgIGRlY2lzaW9uID0gcmVzdWx0LmRlY2lzaW9uO1xuICAgIH1cblxuICAgIGlmIChkZWNpc2lvbiA9PT0gJ2Ryb3AnIHx8IGRlY2lzaW9uID09PSAnYWdncmVnYXRlJykge1xuICAgICAgLy8gU3BhbiB3YXMgZHJvcHBlZC9hZ2dyZWdhdGVkIC0gZHJvcCBzcGFuLnN0YXJ0IHRvb1xuICAgICAgc3RhdHMuZHJvcHBlZCsrO1xuICAgICAgaW5jcmVtZW50Q291bnRlcihzdGF0cy5kcm9wcGVkQnlUeXBlLCBzcGFuU3RhcnQudHlwZSk7XG4gICAgICBpbmNyZW1lbnRDb3VudGVyKHN0YXRzLmRyb3BwZWRCeU9wZXJhdGlvbiwgc3BhblN0YXJ0Lm9wZXJhdGlvbik7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFNwYW4gd2FzIGtlcHQgLSBrZWVwIHNwYW4uc3RhcnRcbiAgICAgIG91dHB1dC5wdXNoKHNwYW5TdGFydCk7XG4gICAgICBzdGF0cy5rZXB0Kys7XG4gICAgfVxuICB9XG5cbiAgLy8gVXBkYXRlIGZpbmFsIGtlcHQgY291bnRcbiAgc3RhdHMua2VwdCA9IG91dHB1dC5sZW5ndGg7XG5cbiAgcmV0dXJuIHtcbiAgICBldmVudHM6IG91dHB1dCxcbiAgICBzdGF0cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBFdmFsdWF0ZSBub2lzZSBkZWNpc2lvbiBmb3IgYSBzaW5nbGUgZXZlbnQgKGZvciB0ZXN0aW5nL2luc3BlY3Rpb24pLlxuICogXG4gKiBUaGlzIGlzIGEgY29udmVuaWVuY2UgZnVuY3Rpb24gdGhhdCBldmFsdWF0ZXMgcnVsZXMgZm9yIGEgc2luZ2xlIGV2ZW50XG4gKiB3aXRob3V0IGJ1aWxkaW5nIGEgdHJlZSBvciBhcHBseWluZyB0cmFuc2Zvcm1hdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBldmVudCAtIEV2ZW50IHRvIGV2YWx1YXRlXG4gKiBAcGFyYW0gY2ZnIC0gTm9pc2UgcmVkdWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIERlY2lzaW9uIHdpdGggY29udGV4dFxuICovXG5leHBvcnQgZnVuY3Rpb24gcGlja05vaXNlRGVjaXNpb24oXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGNmZzogTm9pc2VSZWR1Y3Rpb25Db25maWdcbik6IHsgZGVjaXNpb246IE5vaXNlRGVjaXNpb247IHJ1bGVJZDogc3RyaW5nOyByZWFzb246IHN0cmluZyB9IHtcbiAgY29uc3QgYnVpbHRpblJ1bGVzID0gZ2V0QnVpbHRpblJ1bGVzKGNmZy5wcmVzZXRzKTtcbiAgY29uc3QgYWxsUnVsZXMgPSBbIC4uLmJ1aWx0aW5SdWxlcywgLi4uY2ZnLnJ1bGVzIF07XG4gIGNvbnN0IHJlc3VsdCA9IGV2YWx1YXRlTm9pc2VSdWxlcyhldmVudCwgYWxsUnVsZXMsIG1hdGNoZXNSdWxlKTtcblxuICByZXR1cm4ge1xuICAgIGRlY2lzaW9uOiByZXN1bHQuZGVjaXNpb24sXG4gICAgcnVsZUlkOiByZXN1bHQucnVsZUlkLFxuICAgIHJlYXNvbjogcmVzdWx0LnJlYXNvbixcbiAgfTtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBSRS1FWFBPUlRTIEZPUiBCQUNLV0FSRCBDT01QQVRJQklMSVRZXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZXhwb3J0IHsgZXZhbHVhdGVOb2lzZVJ1bGVzLCBERUNJU0lPTl9CQVNFX1BSSU9SSVRZLCB0eXBlIE5vaXNlRXZhbHVhdGlvblJlc3VsdCB9IGZyb20gJy4vcHJpb3JpdHknO1xuZXhwb3J0IHsgZ2V0QnVpbHRpblJ1bGVzLCBjbGVhckJ1aWx0aW5SdWxlc0NhY2hlIH0gZnJvbSAnLi9ydWxlcy9idWlsdGlucyc7XG5leHBvcnQgdHlwZSB7IE5vaXNlUmVkdWN0aW9uU3RhdHMgfSBmcm9tICcuL3R5cGVzJztcbiJdfQ==