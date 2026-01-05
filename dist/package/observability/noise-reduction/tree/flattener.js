"use strict";
/**
 * Phase 4: Flatten tree to output array.
 *
 * Converts the transformed tree back to a flat array of events,
 * including only kept nodes and adding summary checkpoints.
 *
 * IMPORTANT: Tree structure is the source of truth after transformation.
 * The parentObservabilityLogId field is always synchronized from the tree's
 * parent pointer. If reparenting occurred during transformation, the output
 * will reflect the modified hierarchy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.flattenTree = flattenTree;
const utils_1 = require("../utils");
/**
 * Flatten tree to output array.
 *
 * Performs depth-first traversal, emitting only kept nodes.
 * For nodes with noise reduction summaries, adds a summary checkpoint.
 *
 * Time complexity: O(n) where n = nodes
 * Space complexity: O(k) where k = kept nodes
 *
 * @param node - Current node to flatten
 * @param output - Output array to append to
 * @param config - Optional config for checkpoint bounds checking
 */
function flattenTree(node, output, config) {
    if (!node.kept) {
        // Node was suppressed - skip it and its children
        return;
    }
    // CRITICAL: Sync parentObservabilityLogId from tree structure
    // Tree structure is the source of truth after reparenting
    if (node.parent !== undefined) {
        // Has parent: find nearest KEPT ancestor to avoid dangling references
        let nearestKeptAncestor = node.parent;
        while (nearestKeptAncestor && !nearestKeptAncestor.kept) {
            nearestKeptAncestor = nearestKeptAncestor.parent;
        }
        node.event.parentObservabilityLogId = nearestKeptAncestor?.event.observabilityLogId;
    }
    else if (node.wasReparented) {
        // Node was reparented (parent was dropped) - clear parent reference
        node.event.parentObservabilityLogId = undefined;
    }
    // else: No parent in tree and not reparented - preserve original parentObservabilityLogId
    // (This handles invalid parent references that should be caught downstream)
    // Add this node to output
    output.push(node.event);
    // Add summary checkpoint if this node had suppressions
    // IMPORTANT: Use appendCheckpointBounded to respect limits
    const data = node.event.data;
    if ((0, utils_1.isRecord)(data)) {
        const nrData = data.noiseReduction;
        if (nrData && (nrData.dropped || nrData.folded || nrData.aggregated)) {
            // Check if summary checkpoint already exists
            const checkpoints = data.checkpoints;
            const hasSummary = Array.isArray(checkpoints) &&
                checkpoints.some((c) => c?.name === 'noiseReduction.summary');
            if (!hasSummary && config) {
                // Create summary data for checkpoint (compact, distinct info only)
                const summaryData = {};
                // Always include counts (cheap, useful)
                if (nrData.dropped)
                    summaryData.dropped = nrData.dropped;
                if (nrData.folded)
                    summaryData.folded = nrData.folded;
                if (nrData.aggregated)
                    summaryData.aggregated = nrData.aggregated;
                // Include type breakdown (distinct values, cheap)
                if (nrData.byType && Object.keys(nrData.byType).length > 0) {
                    summaryData.byType = nrData.byType;
                }
                // Include aggregates summary (not full details, just keys and counts)
                if (nrData.aggregates) {
                    summaryData.aggregates = {};
                    for (const [key, bucket] of Object.entries(nrData.aggregates)) {
                        summaryData.aggregates[key] = {
                            count: bucket.count,
                            errorCount: bucket.errorCount || 0,
                            durationSumMs: bucket.durationSumMs,
                            durationMaxMs: bucket.durationMaxMs,
                        };
                    }
                }
                // Add summary checkpoint with actual data
                (0, utils_1.appendCheckpointBounded)(node.event, config, {
                    name: 'noiseReduction.summary',
                    ts: Date.now(),
                    data: summaryData,
                });
            }
            else if (!hasSummary) {
                // Fallback if no config provided (shouldn't happen in practice)
                if (!Array.isArray(data.checkpoints)) {
                    data.checkpoints = [];
                }
                data.checkpoints.push({
                    name: 'noiseReduction.summary',
                    ts: Date.now(),
                    data: {
                        dropped: nrData.dropped,
                        folded: nrData.folded,
                        aggregated: nrData.aggregated,
                    },
                });
            }
            // Keep data.noiseReduction for programmatic access
            // Checkpoint has human-readable summary, noiseReduction has full details
            const compactNR = {};
            // Keep count fields (cheap, useful for filtering/queries)
            if (nrData.dropped)
                compactNR.dropped = nrData.dropped;
            if (nrData.folded)
                compactNR.folded = nrData.folded;
            if (nrData.aggregated)
                compactNR.aggregated = nrData.aggregated;
            // Keep aggregates (full structure for programmatic access)
            if (nrData.aggregates) {
                compactNR.aggregates = nrData.aggregates;
            }
            // Keep metadata fields (byType, byRuleId, etc. - small, useful)
            if (nrData.byType)
                compactNR.byType = nrData.byType;
            if (nrData.byRuleId)
                compactNR.byRuleId = nrData.byRuleId;
            if (nrData.byOperation)
                compactNR.byOperation = nrData.byOperation;
            if (nrData._bucketCount)
                compactNR._bucketCount = nrData._bucketCount;
            // Keep truncation metadata (important for debugging)
            if (nrData.checkpointsTruncated)
                compactNR.checkpointsTruncated = nrData.checkpointsTruncated;
            if (nrData.checkpointsTruncatedCount)
                compactNR.checkpointsTruncatedCount = nrData.checkpointsTruncatedCount;
            if (nrData.aggregateKeysTruncated)
                compactNR.aggregateKeysTruncated = nrData.aggregateKeysTruncated;
            if (nrData.aggregateExamplesTruncated)
                compactNR.aggregateExamplesTruncated = nrData.aggregateExamplesTruncated;
            if (Object.keys(compactNR).length > 0) {
                data.noiseReduction = compactNR;
            }
            else {
                // No aggregates, remove noiseReduction entirely
                delete data.noiseReduction;
            }
        }
    }
    // Recurse to kept children only
    for (const child of node.children) {
        if (child.kept) {
            flattenTree(child, output, config);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmxhdHRlbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL3RyZWUvZmxhdHRlbmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7OztHQVVHOztBQW1CSCxrQ0FtSUM7QUFsSkQsb0NBQTZEO0FBRTdEOzs7Ozs7Ozs7Ozs7R0FZRztBQUNILFNBQWdCLFdBQVcsQ0FDekIsSUFBYyxFQUNkLE1BQTRCLEVBQzVCLE1BQTZCO0lBRTdCLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDZixpREFBaUQ7UUFDakQsT0FBTztJQUNULENBQUM7SUFFRCw4REFBOEQ7SUFDOUQsMERBQTBEO0lBQzFELElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUM5QixzRUFBc0U7UUFDdEUsSUFBSSxtQkFBbUIsR0FBeUIsSUFBSSxDQUFDLE1BQU0sQ0FBQztRQUM1RCxPQUFPLG1CQUFtQixJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDeEQsbUJBQW1CLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxDQUFDO1FBQ25ELENBQUM7UUFDRCxJQUFJLENBQUMsS0FBSyxDQUFDLHdCQUF3QixHQUFHLG1CQUFtQixFQUFFLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQztJQUN0RixDQUFDO1NBQU0sSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDOUIsb0VBQW9FO1FBQ3BFLElBQUksQ0FBQyxLQUFLLENBQUMsd0JBQXdCLEdBQUcsU0FBUyxDQUFDO0lBQ2xELENBQUM7SUFDRCwwRkFBMEY7SUFDMUYsNEVBQTRFO0lBRTVFLDBCQUEwQjtJQUMxQixNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUV4Qix1REFBdUQ7SUFDdkQsMkRBQTJEO0lBQzNELE1BQU0sSUFB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QkFBRSxTQUFTLENBQUMseUJBQXlCLEdBQUcsTUFBTSxDQUFDLHlCQUF5QixDQUFDO1lBQzdHLElBQUksTUFBTSxDQUFDLHNCQUFzQjtnQkFBRSxTQUFTLENBQUMsc0JBQXNCLEdBQUcsTUFBTSxDQUFDLHNCQUFzQixDQUFDO1lBQ3BHLElBQUksTUFBTSxDQUFDLDBCQUEwQjtnQkFBRSxTQUFTLENBQUMsMEJBQTBCLEdBQUcsTUFBTSxDQUFDLDBCQUEwQixDQUFDO1lBRWhILElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ3RDLElBQUksQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFDO1lBQ2xDLENBQUM7aUJBQU0sQ0FBQztnQkFDTixnREFBZ0Q7Z0JBQ2hELE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQztZQUM3QixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxnQ0FBZ0M7SUFDaEMsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDZixXQUFXLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztRQUNyQyxDQUFDO0lBQ0gsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFBoYXNlIDQ6IEZsYXR0ZW4gdHJlZSB0byBvdXRwdXQgYXJyYXkuXG4gKiBcbiAqIENvbnZlcnRzIHRoZSB0cmFuc2Zvcm1lZCB0cmVlIGJhY2sgdG8gYSBmbGF0IGFycmF5IG9mIGV2ZW50cyxcbiAqIGluY2x1ZGluZyBvbmx5IGtlcHQgbm9kZXMgYW5kIGFkZGluZyBzdW1tYXJ5IGNoZWNrcG9pbnRzLlxuICogXG4gKiBJTVBPUlRBTlQ6IFRyZWUgc3RydWN0dXJlIGlzIHRoZSBzb3VyY2Ugb2YgdHJ1dGggYWZ0ZXIgdHJhbnNmb3JtYXRpb24uXG4gKiBUaGUgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGZpZWxkIGlzIGFsd2F5cyBzeW5jaHJvbml6ZWQgZnJvbSB0aGUgdHJlZSdzXG4gKiBwYXJlbnQgcG9pbnRlci4gSWYgcmVwYXJlbnRpbmcgb2NjdXJyZWQgZHVyaW5nIHRyYW5zZm9ybWF0aW9uLCB0aGUgb3V0cHV0XG4gKiB3aWxsIHJlZmxlY3QgdGhlIG1vZGlmaWVkIGhpZXJhcmNoeS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IE5vaXNlUmVkdWN0aW9uQ29uZmlnLCBPYnNlcnZhYmlsaXR5RXZlbnQgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5pbXBvcnQgdHlwZSB7IFRyZWVOb2RlLCBOb2lzZVJlZHVjdGlvbkRhdGEgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBpc1JlY29yZCwgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQgfSBmcm9tICcuLi91dGlscyc7XG5cbi8qKlxuICogRmxhdHRlbiB0cmVlIHRvIG91dHB1dCBhcnJheS5cbiAqIFxuICogUGVyZm9ybXMgZGVwdGgtZmlyc3QgdHJhdmVyc2FsLCBlbWl0dGluZyBvbmx5IGtlcHQgbm9kZXMuXG4gKiBGb3Igbm9kZXMgd2l0aCBub2lzZSByZWR1Y3Rpb24gc3VtbWFyaWVzLCBhZGRzIGEgc3VtbWFyeSBjaGVja3BvaW50LlxuICogXG4gKiBUaW1lIGNvbXBsZXhpdHk6IE8obikgd2hlcmUgbiA9IG5vZGVzXG4gKiBTcGFjZSBjb21wbGV4aXR5OiBPKGspIHdoZXJlIGsgPSBrZXB0IG5vZGVzXG4gKiBcbiAqIEBwYXJhbSBub2RlIC0gQ3VycmVudCBub2RlIHRvIGZsYXR0ZW5cbiAqIEBwYXJhbSBvdXRwdXQgLSBPdXRwdXQgYXJyYXkgdG8gYXBwZW5kIHRvXG4gKiBAcGFyYW0gY29uZmlnIC0gT3B0aW9uYWwgY29uZmlnIGZvciBjaGVja3BvaW50IGJvdW5kcyBjaGVja2luZ1xuICovXG5leHBvcnQgZnVuY3Rpb24gZmxhdHRlblRyZWUoXG4gIG5vZGU6IFRyZWVOb2RlLFxuICBvdXRwdXQ6IE9ic2VydmFiaWxpdHlFdmVudFtdLFxuICBjb25maWc/OiBOb2lzZVJlZHVjdGlvbkNvbmZpZ1xuKTogdm9pZCB7XG4gIGlmICghbm9kZS5rZXB0KSB7XG4gICAgLy8gTm9kZSB3YXMgc3VwcHJlc3NlZCAtIHNraXAgaXQgYW5kIGl0cyBjaGlsZHJlblxuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIENSSVRJQ0FMOiBTeW5jIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBmcm9tIHRyZWUgc3RydWN0dXJlXG4gIC8vIFRyZWUgc3RydWN0dXJlIGlzIHRoZSBzb3VyY2Ugb2YgdHJ1dGggYWZ0ZXIgcmVwYXJlbnRpbmdcbiAgaWYgKG5vZGUucGFyZW50ICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBIYXMgcGFyZW50OiBmaW5kIG5lYXJlc3QgS0VQVCBhbmNlc3RvciB0byBhdm9pZCBkYW5nbGluZyByZWZlcmVuY2VzXG4gICAgbGV0IG5lYXJlc3RLZXB0QW5jZXN0b3I6IFRyZWVOb2RlIHwgdW5kZWZpbmVkID0gbm9kZS5wYXJlbnQ7XG4gICAgd2hpbGUgKG5lYXJlc3RLZXB0QW5jZXN0b3IgJiYgIW5lYXJlc3RLZXB0QW5jZXN0b3Iua2VwdCkge1xuICAgICAgbmVhcmVzdEtlcHRBbmNlc3RvciA9IG5lYXJlc3RLZXB0QW5jZXN0b3IucGFyZW50O1xuICAgIH1cbiAgICBub2RlLmV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IG5lYXJlc3RLZXB0QW5jZXN0b3I/LmV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgfSBlbHNlIGlmIChub2RlLndhc1JlcGFyZW50ZWQpIHtcbiAgICAvLyBOb2RlIHdhcyByZXBhcmVudGVkIChwYXJlbnQgd2FzIGRyb3BwZWQpIC0gY2xlYXIgcGFyZW50IHJlZmVyZW5jZVxuICAgIG5vZGUuZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gdW5kZWZpbmVkO1xuICB9XG4gIC8vIGVsc2U6IE5vIHBhcmVudCBpbiB0cmVlIGFuZCBub3QgcmVwYXJlbnRlZCAtIHByZXNlcnZlIG9yaWdpbmFsIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZFxuICAvLyAoVGhpcyBoYW5kbGVzIGludmFsaWQgcGFyZW50IHJlZmVyZW5jZXMgdGhhdCBzaG91bGQgYmUgY2F1Z2h0IGRvd25zdHJlYW0pXG5cbiAgLy8gQWRkIHRoaXMgbm9kZSB0byBvdXRwdXRcbiAgb3V0cHV0LnB1c2gobm9kZS5ldmVudCk7XG5cbiAgLy8gQWRkIHN1bW1hcnkgY2hlY2twb2ludCBpZiB0aGlzIG5vZGUgaGFkIHN1cHByZXNzaW9uc1xuICAvLyBJTVBPUlRBTlQ6IFVzZSBhcHBlbmRDaGVja3BvaW50Qm91bmRlZCB0byByZXNwZWN0IGxpbWl0c1xuICBjb25zdCBkYXRhID0gbm9kZS5ldmVudC5kYXRhO1xuICBpZiAoaXNSZWNvcmQoZGF0YSkpIHtcbiAgICBjb25zdCBuckRhdGEgPSBkYXRhLm5vaXNlUmVkdWN0aW9uIGFzIE5vaXNlUmVkdWN0aW9uRGF0YSB8IHVuZGVmaW5lZDtcblxuICAgIGlmIChuckRhdGEgJiYgKG5yRGF0YS5kcm9wcGVkIHx8IG5yRGF0YS5mb2xkZWQgfHwgbnJEYXRhLmFnZ3JlZ2F0ZWQpKSB7XG4gICAgICAvLyBDaGVjayBpZiBzdW1tYXJ5IGNoZWNrcG9pbnQgYWxyZWFkeSBleGlzdHNcbiAgICAgIGNvbnN0IGNoZWNrcG9pbnRzID0gZGF0YS5jaGVja3BvaW50cztcbiAgICAgIGNvbnN0IGhhc1N1bW1hcnkgPSBBcnJheS5pc0FycmF5KGNoZWNrcG9pbnRzKSAmJlxuICAgICAgICBjaGVja3BvaW50cy5zb21lKChjOiBhbnkpID0+IGM/Lm5hbWUgPT09ICdub2lzZVJlZHVjdGlvbi5zdW1tYXJ5Jyk7XG5cbiAgICAgIGlmICghaGFzU3VtbWFyeSAmJiBjb25maWcpIHtcbiAgICAgICAgLy8gQ3JlYXRlIHN1bW1hcnkgZGF0YSBmb3IgY2hlY2twb2ludCAoY29tcGFjdCwgZGlzdGluY3QgaW5mbyBvbmx5KVxuICAgICAgICBjb25zdCBzdW1tYXJ5RGF0YTogYW55ID0ge307XG5cbiAgICAgICAgLy8gQWx3YXlzIGluY2x1ZGUgY291bnRzIChjaGVhcCwgdXNlZnVsKVxuICAgICAgICBpZiAobnJEYXRhLmRyb3BwZWQpIHN1bW1hcnlEYXRhLmRyb3BwZWQgPSBuckRhdGEuZHJvcHBlZDtcbiAgICAgICAgaWYgKG5yRGF0YS5mb2xkZWQpIHN1bW1hcnlEYXRhLmZvbGRlZCA9IG5yRGF0YS5mb2xkZWQ7XG4gICAgICAgIGlmIChuckRhdGEuYWdncmVnYXRlZCkgc3VtbWFyeURhdGEuYWdncmVnYXRlZCA9IG5yRGF0YS5hZ2dyZWdhdGVkO1xuXG4gICAgICAgIC8vIEluY2x1ZGUgdHlwZSBicmVha2Rvd24gKGRpc3RpbmN0IHZhbHVlcywgY2hlYXApXG4gICAgICAgIGlmIChuckRhdGEuYnlUeXBlICYmIE9iamVjdC5rZXlzKG5yRGF0YS5ieVR5cGUpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBzdW1tYXJ5RGF0YS5ieVR5cGUgPSBuckRhdGEuYnlUeXBlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSW5jbHVkZSBhZ2dyZWdhdGVzIHN1bW1hcnkgKG5vdCBmdWxsIGRldGFpbHMsIGp1c3Qga2V5cyBhbmQgY291bnRzKVxuICAgICAgICBpZiAobnJEYXRhLmFnZ3JlZ2F0ZXMpIHtcbiAgICAgICAgICBzdW1tYXJ5RGF0YS5hZ2dyZWdhdGVzID0ge307XG4gICAgICAgICAgZm9yIChjb25zdCBbIGtleSwgYnVja2V0IF0gb2YgT2JqZWN0LmVudHJpZXMobnJEYXRhLmFnZ3JlZ2F0ZXMpKSB7XG4gICAgICAgICAgICBzdW1tYXJ5RGF0YS5hZ2dyZWdhdGVzWyBrZXkgXSA9IHtcbiAgICAgICAgICAgICAgY291bnQ6IGJ1Y2tldC5jb3VudCxcbiAgICAgICAgICAgICAgZXJyb3JDb3VudDogYnVja2V0LmVycm9yQ291bnQgfHwgMCxcbiAgICAgICAgICAgICAgZHVyYXRpb25TdW1NczogYnVja2V0LmR1cmF0aW9uU3VtTXMsXG4gICAgICAgICAgICAgIGR1cmF0aW9uTWF4TXM6IGJ1Y2tldC5kdXJhdGlvbk1heE1zLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgc3VtbWFyeSBjaGVja3BvaW50IHdpdGggYWN0dWFsIGRhdGFcbiAgICAgICAgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQobm9kZS5ldmVudCwgY29uZmlnLCB7XG4gICAgICAgICAgbmFtZTogJ25vaXNlUmVkdWN0aW9uLnN1bW1hcnknLFxuICAgICAgICAgIHRzOiBEYXRlLm5vdygpLFxuICAgICAgICAgIGRhdGE6IHN1bW1hcnlEYXRhLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSBpZiAoIWhhc1N1bW1hcnkpIHtcbiAgICAgICAgLy8gRmFsbGJhY2sgaWYgbm8gY29uZmlnIHByb3ZpZGVkIChzaG91bGRuJ3QgaGFwcGVuIGluIHByYWN0aWNlKVxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoZGF0YS5jaGVja3BvaW50cykpIHtcbiAgICAgICAgICBkYXRhLmNoZWNrcG9pbnRzID0gW107XG4gICAgICAgIH1cbiAgICAgICAgKGRhdGEuY2hlY2twb2ludHMgYXMgYW55W10pLnB1c2goe1xuICAgICAgICAgIG5hbWU6ICdub2lzZVJlZHVjdGlvbi5zdW1tYXJ5JyxcbiAgICAgICAgICB0czogRGF0ZS5ub3coKSxcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBkcm9wcGVkOiBuckRhdGEuZHJvcHBlZCxcbiAgICAgICAgICAgIGZvbGRlZDogbnJEYXRhLmZvbGRlZCxcbiAgICAgICAgICAgIGFnZ3JlZ2F0ZWQ6IG5yRGF0YS5hZ2dyZWdhdGVkLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBLZWVwIGRhdGEubm9pc2VSZWR1Y3Rpb24gZm9yIHByb2dyYW1tYXRpYyBhY2Nlc3NcbiAgICAgIC8vIENoZWNrcG9pbnQgaGFzIGh1bWFuLXJlYWRhYmxlIHN1bW1hcnksIG5vaXNlUmVkdWN0aW9uIGhhcyBmdWxsIGRldGFpbHNcbiAgICAgIGNvbnN0IGNvbXBhY3ROUjogYW55ID0ge307XG5cbiAgICAgIC8vIEtlZXAgY291bnQgZmllbGRzIChjaGVhcCwgdXNlZnVsIGZvciBmaWx0ZXJpbmcvcXVlcmllcylcbiAgICAgIGlmIChuckRhdGEuZHJvcHBlZCkgY29tcGFjdE5SLmRyb3BwZWQgPSBuckRhdGEuZHJvcHBlZDtcbiAgICAgIGlmIChuckRhdGEuZm9sZGVkKSBjb21wYWN0TlIuZm9sZGVkID0gbnJEYXRhLmZvbGRlZDtcbiAgICAgIGlmIChuckRhdGEuYWdncmVnYXRlZCkgY29tcGFjdE5SLmFnZ3JlZ2F0ZWQgPSBuckRhdGEuYWdncmVnYXRlZDtcblxuICAgICAgLy8gS2VlcCBhZ2dyZWdhdGVzIChmdWxsIHN0cnVjdHVyZSBmb3IgcHJvZ3JhbW1hdGljIGFjY2VzcylcbiAgICAgIGlmIChuckRhdGEuYWdncmVnYXRlcykge1xuICAgICAgICBjb21wYWN0TlIuYWdncmVnYXRlcyA9IG5yRGF0YS5hZ2dyZWdhdGVzO1xuICAgICAgfVxuXG4gICAgICAvLyBLZWVwIG1ldGFkYXRhIGZpZWxkcyAoYnlUeXBlLCBieVJ1bGVJZCwgZXRjLiAtIHNtYWxsLCB1c2VmdWwpXG4gICAgICBpZiAobnJEYXRhLmJ5VHlwZSkgY29tcGFjdE5SLmJ5VHlwZSA9IG5yRGF0YS5ieVR5cGU7XG4gICAgICBpZiAobnJEYXRhLmJ5UnVsZUlkKSBjb21wYWN0TlIuYnlSdWxlSWQgPSBuckRhdGEuYnlSdWxlSWQ7XG4gICAgICBpZiAobnJEYXRhLmJ5T3BlcmF0aW9uKSBjb21wYWN0TlIuYnlPcGVyYXRpb24gPSBuckRhdGEuYnlPcGVyYXRpb247XG4gICAgICBpZiAobnJEYXRhLl9idWNrZXRDb3VudCkgY29tcGFjdE5SLl9idWNrZXRDb3VudCA9IG5yRGF0YS5fYnVja2V0Q291bnQ7XG5cbiAgICAgIC8vIEtlZXAgdHJ1bmNhdGlvbiBtZXRhZGF0YSAoaW1wb3J0YW50IGZvciBkZWJ1Z2dpbmcpXG4gICAgICBpZiAobnJEYXRhLmNoZWNrcG9pbnRzVHJ1bmNhdGVkKSBjb21wYWN0TlIuY2hlY2twb2ludHNUcnVuY2F0ZWQgPSBuckRhdGEuY2hlY2twb2ludHNUcnVuY2F0ZWQ7XG4gICAgICBpZiAobnJEYXRhLmNoZWNrcG9pbnRzVHJ1bmNhdGVkQ291bnQpIGNvbXBhY3ROUi5jaGVja3BvaW50c1RydW5jYXRlZENvdW50ID0gbnJEYXRhLmNoZWNrcG9pbnRzVHJ1bmNhdGVkQ291bnQ7XG4gICAgICBpZiAobnJEYXRhLmFnZ3JlZ2F0ZUtleXNUcnVuY2F0ZWQpIGNvbXBhY3ROUi5hZ2dyZWdhdGVLZXlzVHJ1bmNhdGVkID0gbnJEYXRhLmFnZ3JlZ2F0ZUtleXNUcnVuY2F0ZWQ7XG4gICAgICBpZiAobnJEYXRhLmFnZ3JlZ2F0ZUV4YW1wbGVzVHJ1bmNhdGVkKSBjb21wYWN0TlIuYWdncmVnYXRlRXhhbXBsZXNUcnVuY2F0ZWQgPSBuckRhdGEuYWdncmVnYXRlRXhhbXBsZXNUcnVuY2F0ZWQ7XG5cbiAgICAgIGlmIChPYmplY3Qua2V5cyhjb21wYWN0TlIpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZGF0YS5ub2lzZVJlZHVjdGlvbiA9IGNvbXBhY3ROUjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIE5vIGFnZ3JlZ2F0ZXMsIHJlbW92ZSBub2lzZVJlZHVjdGlvbiBlbnRpcmVseVxuICAgICAgICBkZWxldGUgZGF0YS5ub2lzZVJlZHVjdGlvbjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBSZWN1cnNlIHRvIGtlcHQgY2hpbGRyZW4gb25seVxuICBmb3IgKGNvbnN0IGNoaWxkIG9mIG5vZGUuY2hpbGRyZW4pIHtcbiAgICBpZiAoY2hpbGQua2VwdCkge1xuICAgICAgZmxhdHRlblRyZWUoY2hpbGQsIG91dHB1dCwgY29uZmlnKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==