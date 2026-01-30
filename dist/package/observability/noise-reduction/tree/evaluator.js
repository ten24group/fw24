"use strict";
/**
 * Phase 2: Evaluate noise reduction decisions for all nodes.
 *
 * Walks the tree depth-first and evaluates noise reduction rules
 * for each node, storing the decision on the node itself.
 *
 * Hard signals (errors/failures/slow operations) are protected here and can only
 * receive KEEP or AGGREGATE decisions. This ensures critical events are always visible.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateDecisions = evaluateDecisions;
const priority_1 = require("../priority");
const matcher_1 = require("../rules/matcher");
const hard_signals_1 = require("../hard-signals");
/**
 * Evaluate noise reduction decisions for a tree.
 *
 * Performs depth-first traversal, evaluating rules for each node.
 * The decision is stored on the node for use in Phase 3 (transformation).
 *
 * Hard signals are protected: if a rule tries to drop/fold/downgrade a hard signal,
 * the decision is overridden to KEEP to ensure visibility.
 *
 * Time complexity: O(n * m) where n = nodes, m = rules
 * Space complexity: O(1) additional (modifies nodes in-place)
 *
 * @param node - Current node to evaluate (starts with root)
 * @param config - Noise reduction configuration
 * @param allRules - All rules to evaluate (builtin + custom)
 */
function evaluateDecisions(node, config, allRules) {
    // Evaluate rules for this node
    const result = (0, priority_1.evaluateNoiseRules)(node.event, allRules, matcher_1.matchesRule);
    // Hard signal protection: errors/failures cannot be dropped, folded, or downgraded
    // EXCEPT when explicitly overridden via capture.noise (which has Infinity priority)
    const isExplicitOverride = result.ruleId === 'override';
    const shouldProtect = (0, hard_signals_1.isHardSignal)(node.event, config) && !isExplicitOverride;
    if (shouldProtect) {
        if (result.decision === 'drop' || result.decision === 'fold' || result.decision === 'downgrade') {
            // Override: hard signals must be kept as standalone records
            node.decision = 'keep';
            node.ruleId = 'builtin.hard_signal_protection';
            node.reason = 'Hard signal (error/failure/slow) must be visible as standalone record';
        }
        else {
            // Allow KEEP or AGGREGATE (errors still visible in parent stats if aggregated)
            node.decision = result.decision;
            node.ruleId = result.ruleId;
            node.reason = result.reason;
        }
    }
    else {
        // Not a hard signal OR explicit override - use rule evaluation result
        node.decision = result.decision;
        node.ruleId = result.ruleId;
        node.reason = result.reason;
    }
    // Recurse to children (depth-first traversal)
    for (const child of node.children) {
        evaluateDecisions(child, config, allRules);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXZhbHVhdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL3RyZWUvZXZhbHVhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7R0FRRzs7QUF3QkgsOENBb0NDO0FBeERELDBDQUFpRDtBQUNqRCw4Q0FBK0M7QUFDL0Msa0RBQStDO0FBRS9DOzs7Ozs7Ozs7Ozs7Ozs7R0FlRztBQUNILFNBQWdCLGlCQUFpQixDQUMvQixJQUFjLEVBQ2QsTUFBNEIsRUFDNUIsUUFBa0M7SUFFbEMsK0JBQStCO0lBQy9CLE1BQU0sTUFBTSxHQUFHLElBQUEsNkJBQWtCLEVBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxRQUFRLEVBQUUscUJBQVcsQ0FBQyxDQUFDO0lBRXJFLG1GQUFtRjtJQUNuRixvRkFBb0Y7SUFDcEYsTUFBTSxrQkFBa0IsR0FBRyxNQUFNLENBQUMsTUFBTSxLQUFLLFVBQVUsQ0FBQztJQUN4RCxNQUFNLGFBQWEsR0FBRyxJQUFBLDJCQUFZLEVBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDO0lBRTlFLElBQUksYUFBYSxFQUFFLENBQUM7UUFDbEIsSUFBSSxNQUFNLENBQUMsUUFBUSxLQUFLLE1BQU0sSUFBSSxNQUFNLENBQUMsUUFBUSxLQUFLLE1BQU0sSUFBSSxNQUFNLENBQUMsUUFBUSxLQUFLLFdBQVcsRUFBRSxDQUFDO1lBQ2hHLDREQUE0RDtZQUM1RCxJQUFJLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQztZQUN2QixJQUFJLENBQUMsTUFBTSxHQUFHLGdDQUFnQyxDQUFDO1lBQy9DLElBQUksQ0FBQyxNQUFNLEdBQUcsdUVBQXVFLENBQUM7UUFDeEYsQ0FBQzthQUFNLENBQUM7WUFDTiwrRUFBK0U7WUFDL0UsSUFBSSxDQUFDLFFBQVEsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDO1lBQ2hDLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQztZQUM1QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7UUFDOUIsQ0FBQztJQUNILENBQUM7U0FBTSxDQUFDO1FBQ04sc0VBQXNFO1FBQ3RFLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQztRQUNoQyxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7UUFDNUIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDO0lBQzlCLENBQUM7SUFFRCw4Q0FBOEM7SUFDOUMsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsaUJBQWlCLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxRQUFRLENBQUMsQ0FBQztJQUM3QyxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUGhhc2UgMjogRXZhbHVhdGUgbm9pc2UgcmVkdWN0aW9uIGRlY2lzaW9ucyBmb3IgYWxsIG5vZGVzLlxuICogXG4gKiBXYWxrcyB0aGUgdHJlZSBkZXB0aC1maXJzdCBhbmQgZXZhbHVhdGVzIG5vaXNlIHJlZHVjdGlvbiBydWxlc1xuICogZm9yIGVhY2ggbm9kZSwgc3RvcmluZyB0aGUgZGVjaXNpb24gb24gdGhlIG5vZGUgaXRzZWxmLlxuICogXG4gKiBIYXJkIHNpZ25hbHMgKGVycm9ycy9mYWlsdXJlcy9zbG93IG9wZXJhdGlvbnMpIGFyZSBwcm90ZWN0ZWQgaGVyZSBhbmQgY2FuIG9ubHlcbiAqIHJlY2VpdmUgS0VFUCBvciBBR0dSRUdBVEUgZGVjaXNpb25zLiBUaGlzIGVuc3VyZXMgY3JpdGljYWwgZXZlbnRzIGFyZSBhbHdheXMgdmlzaWJsZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IE5vaXNlUmVkdWN0aW9uQ29uZmlnLCBOb2lzZVJ1bGUgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5pbXBvcnQgdHlwZSB7IFRyZWVOb2RlIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgZXZhbHVhdGVOb2lzZVJ1bGVzIH0gZnJvbSAnLi4vcHJpb3JpdHknO1xuaW1wb3J0IHsgbWF0Y2hlc1J1bGUgfSBmcm9tICcuLi9ydWxlcy9tYXRjaGVyJztcbmltcG9ydCB7IGlzSGFyZFNpZ25hbCB9IGZyb20gJy4uL2hhcmQtc2lnbmFscyc7XG5cbi8qKlxuICogRXZhbHVhdGUgbm9pc2UgcmVkdWN0aW9uIGRlY2lzaW9ucyBmb3IgYSB0cmVlLlxuICogXG4gKiBQZXJmb3JtcyBkZXB0aC1maXJzdCB0cmF2ZXJzYWwsIGV2YWx1YXRpbmcgcnVsZXMgZm9yIGVhY2ggbm9kZS5cbiAqIFRoZSBkZWNpc2lvbiBpcyBzdG9yZWQgb24gdGhlIG5vZGUgZm9yIHVzZSBpbiBQaGFzZSAzICh0cmFuc2Zvcm1hdGlvbikuXG4gKiBcbiAqIEhhcmQgc2lnbmFscyBhcmUgcHJvdGVjdGVkOiBpZiBhIHJ1bGUgdHJpZXMgdG8gZHJvcC9mb2xkL2Rvd25ncmFkZSBhIGhhcmQgc2lnbmFsLFxuICogdGhlIGRlY2lzaW9uIGlzIG92ZXJyaWRkZW4gdG8gS0VFUCB0byBlbnN1cmUgdmlzaWJpbGl0eS5cbiAqIFxuICogVGltZSBjb21wbGV4aXR5OiBPKG4gKiBtKSB3aGVyZSBuID0gbm9kZXMsIG0gPSBydWxlc1xuICogU3BhY2UgY29tcGxleGl0eTogTygxKSBhZGRpdGlvbmFsIChtb2RpZmllcyBub2RlcyBpbi1wbGFjZSlcbiAqIFxuICogQHBhcmFtIG5vZGUgLSBDdXJyZW50IG5vZGUgdG8gZXZhbHVhdGUgKHN0YXJ0cyB3aXRoIHJvb3QpXG4gKiBAcGFyYW0gY29uZmlnIC0gTm9pc2UgcmVkdWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBhbGxSdWxlcyAtIEFsbCBydWxlcyB0byBldmFsdWF0ZSAoYnVpbHRpbiArIGN1c3RvbSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlRGVjaXNpb25zKFxuICBub2RlOiBUcmVlTm9kZSxcbiAgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyxcbiAgYWxsUnVsZXM6IFJlYWRvbmx5QXJyYXk8Tm9pc2VSdWxlPlxuKTogdm9pZCB7XG4gIC8vIEV2YWx1YXRlIHJ1bGVzIGZvciB0aGlzIG5vZGVcbiAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVOb2lzZVJ1bGVzKG5vZGUuZXZlbnQsIGFsbFJ1bGVzLCBtYXRjaGVzUnVsZSk7XG5cbiAgLy8gSGFyZCBzaWduYWwgcHJvdGVjdGlvbjogZXJyb3JzL2ZhaWx1cmVzIGNhbm5vdCBiZSBkcm9wcGVkLCBmb2xkZWQsIG9yIGRvd25ncmFkZWRcbiAgLy8gRVhDRVBUIHdoZW4gZXhwbGljaXRseSBvdmVycmlkZGVuIHZpYSBjYXB0dXJlLm5vaXNlICh3aGljaCBoYXMgSW5maW5pdHkgcHJpb3JpdHkpXG4gIGNvbnN0IGlzRXhwbGljaXRPdmVycmlkZSA9IHJlc3VsdC5ydWxlSWQgPT09ICdvdmVycmlkZSc7XG4gIGNvbnN0IHNob3VsZFByb3RlY3QgPSBpc0hhcmRTaWduYWwobm9kZS5ldmVudCwgY29uZmlnKSAmJiAhaXNFeHBsaWNpdE92ZXJyaWRlO1xuXG4gIGlmIChzaG91bGRQcm90ZWN0KSB7XG4gICAgaWYgKHJlc3VsdC5kZWNpc2lvbiA9PT0gJ2Ryb3AnIHx8IHJlc3VsdC5kZWNpc2lvbiA9PT0gJ2ZvbGQnIHx8IHJlc3VsdC5kZWNpc2lvbiA9PT0gJ2Rvd25ncmFkZScpIHtcbiAgICAgIC8vIE92ZXJyaWRlOiBoYXJkIHNpZ25hbHMgbXVzdCBiZSBrZXB0IGFzIHN0YW5kYWxvbmUgcmVjb3Jkc1xuICAgICAgbm9kZS5kZWNpc2lvbiA9ICdrZWVwJztcbiAgICAgIG5vZGUucnVsZUlkID0gJ2J1aWx0aW4uaGFyZF9zaWduYWxfcHJvdGVjdGlvbic7XG4gICAgICBub2RlLnJlYXNvbiA9ICdIYXJkIHNpZ25hbCAoZXJyb3IvZmFpbHVyZS9zbG93KSBtdXN0IGJlIHZpc2libGUgYXMgc3RhbmRhbG9uZSByZWNvcmQnO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBBbGxvdyBLRUVQIG9yIEFHR1JFR0FURSAoZXJyb3JzIHN0aWxsIHZpc2libGUgaW4gcGFyZW50IHN0YXRzIGlmIGFnZ3JlZ2F0ZWQpXG4gICAgICBub2RlLmRlY2lzaW9uID0gcmVzdWx0LmRlY2lzaW9uO1xuICAgICAgbm9kZS5ydWxlSWQgPSByZXN1bHQucnVsZUlkO1xuICAgICAgbm9kZS5yZWFzb24gPSByZXN1bHQucmVhc29uO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBOb3QgYSBoYXJkIHNpZ25hbCBPUiBleHBsaWNpdCBvdmVycmlkZSAtIHVzZSBydWxlIGV2YWx1YXRpb24gcmVzdWx0XG4gICAgbm9kZS5kZWNpc2lvbiA9IHJlc3VsdC5kZWNpc2lvbjtcbiAgICBub2RlLnJ1bGVJZCA9IHJlc3VsdC5ydWxlSWQ7XG4gICAgbm9kZS5yZWFzb24gPSByZXN1bHQucmVhc29uO1xuICB9XG5cbiAgLy8gUmVjdXJzZSB0byBjaGlsZHJlbiAoZGVwdGgtZmlyc3QgdHJhdmVyc2FsKVxuICBmb3IgKGNvbnN0IGNoaWxkIG9mIG5vZGUuY2hpbGRyZW4pIHtcbiAgICBldmFsdWF0ZURlY2lzaW9ucyhjaGlsZCwgY29uZmlnLCBhbGxSdWxlcyk7XG4gIH1cbn1cbiJdfQ==