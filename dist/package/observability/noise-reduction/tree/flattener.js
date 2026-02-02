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
    else if (node.event.parentObservabilityLogId) {
        // No parent in tree and not reparented: parent was never in this batch
        // Clear per contract: parentObservabilityLogId should only reference same slice
        // Cross-invocation links should use causedBy instead
        node.event.parentObservabilityLogId = undefined;
    }
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
                // Include FULL aggregates data (with examples, errors, rules)
                // Checkpoint should be self-contained with all aggregate details
                if (nrData.aggregates) {
                    summaryData.aggregates = nrData.aggregates;
                }
                // Include truncation metadata if present
                if (nrData.checkpointsTruncated)
                    summaryData.checkpointsTruncated = nrData.checkpointsTruncated;
                if (nrData.checkpointsTruncatedCount)
                    summaryData.checkpointsTruncatedCount = nrData.checkpointsTruncatedCount;
                if (nrData.aggregateKeysTruncated)
                    summaryData.aggregateKeysTruncated = nrData.aggregateKeysTruncated;
                if (nrData.aggregateExamplesTruncated)
                    summaryData.aggregateExamplesTruncated = nrData.aggregateExamplesTruncated;
                // Add summary checkpoint with ALL data (checkpoint is self-contained)
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
                        byType: nrData.byType,
                        aggregates: nrData.aggregates,
                    },
                });
            }
            // Delete data.noiseReduction entirely - all info is in the checkpoint now
            delete data.noiseReduction;
        }
    }
    // Recurse to kept children only
    for (const child of node.children) {
        if (child.kept) {
            flattenTree(child, output, config);
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmxhdHRlbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL3RyZWUvZmxhdHRlbmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7OztHQVVHOztBQW1CSCxrQ0F5R0M7QUF4SEQsb0NBQTZEO0FBRTdEOzs7Ozs7Ozs7Ozs7R0FZRztBQUNILFNBQWdCLFdBQVcsQ0FDekIsSUFBYyxFQUNkLE1BQTRCLEVBQzVCLE1BQTZCO0lBRTdCLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDZixpREFBaUQ7UUFDakQsT0FBTztJQUNULENBQUM7SUFFRCw4REFBOEQ7SUFDOUQsMERBQTBEO0lBQzFELElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUM5QixzRUFBc0U7UUFDdEUsSUFBSSxtQkFBbUIsR0FBeUIsSUFBSSxDQUFDLE1BQU0sQ0FBQztRQUM1RCxPQUFPLG1CQUFtQixJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDeEQsbUJBQW1CLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxDQUFDO1FBQ25ELENBQUM7UUFDRCxJQUFJLENBQUMsS0FBSyxDQUFDLHdCQUF3QixHQUFHLG1CQUFtQixFQUFFLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQztJQUN0RixDQUFDO1NBQU0sSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDOUIsb0VBQW9FO1FBQ3BFLElBQUksQ0FBQyxLQUFLLENBQUMsd0JBQXdCLEdBQUcsU0FBUyxDQUFDO0lBQ2xELENBQUM7U0FBTSxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsd0JBQXdCLEVBQUUsQ0FBQztRQUMvQyx1RUFBdUU7UUFDdkUsZ0ZBQWdGO1FBQ2hGLHFEQUFxRDtRQUNyRCxJQUFJLENBQUMsS0FBSyxDQUFDLHdCQUF3QixHQUFHLFNBQVMs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QUUsQ0FBQztnQkFDeEIsQ0FBQztnQkFDQSxJQUFJLENBQUMsV0FBcUIsQ0FBQyxJQUFJLENBQUM7b0JBQy9CLElBQUksRUFBRSx3QkFBd0I7b0JBQzlCLEVBQUUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO29CQUNkLElBQUksRUFBRTt3QkFDSixPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU87d0JBQ3ZCLE1BQU0sRUFBRSxNQUFNLENBQUMsTUFBTTt3QkFDckIsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVO3dCQUM3QixNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU07d0JBQ3JCLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTtxQkFDOUI7aUJBQ0YsQ0FBQyxDQUFDO1lBQ0wsQ0FBQztZQUVELDBFQUEwRTtZQUMxRSxPQUFPLElBQUksQ0FBQyxjQUFjLENBQUM7UUFDN0IsQ0FBQztJQUNILENBQUM7SUFFRCxnQ0FBZ0M7SUFDaEMsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDZixXQUFXLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztRQUNyQyxDQUFDO0lBQ0gsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFBoYXNlIDQ6IEZsYXR0ZW4gdHJlZSB0byBvdXRwdXQgYXJyYXkuXG4gKiBcbiAqIENvbnZlcnRzIHRoZSB0cmFuc2Zvcm1lZCB0cmVlIGJhY2sgdG8gYSBmbGF0IGFycmF5IG9mIGV2ZW50cyxcbiAqIGluY2x1ZGluZyBvbmx5IGtlcHQgbm9kZXMgYW5kIGFkZGluZyBzdW1tYXJ5IGNoZWNrcG9pbnRzLlxuICogXG4gKiBJTVBPUlRBTlQ6IFRyZWUgc3RydWN0dXJlIGlzIHRoZSBzb3VyY2Ugb2YgdHJ1dGggYWZ0ZXIgdHJhbnNmb3JtYXRpb24uXG4gKiBUaGUgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGZpZWxkIGlzIGFsd2F5cyBzeW5jaHJvbml6ZWQgZnJvbSB0aGUgdHJlZSdzXG4gKiBwYXJlbnQgcG9pbnRlci4gSWYgcmVwYXJlbnRpbmcgb2NjdXJyZWQgZHVyaW5nIHRyYW5zZm9ybWF0aW9uLCB0aGUgb3V0cHV0XG4gKiB3aWxsIHJlZmxlY3QgdGhlIG1vZGlmaWVkIGhpZXJhcmNoeS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IE5vaXNlUmVkdWN0aW9uQ29uZmlnLCBPYnNlcnZhYmlsaXR5RXZlbnQgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5pbXBvcnQgdHlwZSB7IFRyZWVOb2RlLCBOb2lzZVJlZHVjdGlvbkRhdGEgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBpc1JlY29yZCwgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQgfSBmcm9tICcuLi91dGlscyc7XG5cbi8qKlxuICogRmxhdHRlbiB0cmVlIHRvIG91dHB1dCBhcnJheS5cbiAqIFxuICogUGVyZm9ybXMgZGVwdGgtZmlyc3QgdHJhdmVyc2FsLCBlbWl0dGluZyBvbmx5IGtlcHQgbm9kZXMuXG4gKiBGb3Igbm9kZXMgd2l0aCBub2lzZSByZWR1Y3Rpb24gc3VtbWFyaWVzLCBhZGRzIGEgc3VtbWFyeSBjaGVja3BvaW50LlxuICogXG4gKiBUaW1lIGNvbXBsZXhpdHk6IE8obikgd2hlcmUgbiA9IG5vZGVzXG4gKiBTcGFjZSBjb21wbGV4aXR5OiBPKGspIHdoZXJlIGsgPSBrZXB0IG5vZGVzXG4gKiBcbiAqIEBwYXJhbSBub2RlIC0gQ3VycmVudCBub2RlIHRvIGZsYXR0ZW5cbiAqIEBwYXJhbSBvdXRwdXQgLSBPdXRwdXQgYXJyYXkgdG8gYXBwZW5kIHRvXG4gKiBAcGFyYW0gY29uZmlnIC0gT3B0aW9uYWwgY29uZmlnIGZvciBjaGVja3BvaW50IGJvdW5kcyBjaGVja2luZ1xuICovXG5leHBvcnQgZnVuY3Rpb24gZmxhdHRlblRyZWUoXG4gIG5vZGU6IFRyZWVOb2RlLFxuICBvdXRwdXQ6IE9ic2VydmFiaWxpdHlFdmVudFtdLFxuICBjb25maWc/OiBOb2lzZVJlZHVjdGlvbkNvbmZpZ1xuKTogdm9pZCB7XG4gIGlmICghbm9kZS5rZXB0KSB7XG4gICAgLy8gTm9kZSB3YXMgc3VwcHJlc3NlZCAtIHNraXAgaXQgYW5kIGl0cyBjaGlsZHJlblxuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIENSSVRJQ0FMOiBTeW5jIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBmcm9tIHRyZWUgc3RydWN0dXJlXG4gIC8vIFRyZWUgc3RydWN0dXJlIGlzIHRoZSBzb3VyY2Ugb2YgdHJ1dGggYWZ0ZXIgcmVwYXJlbnRpbmdcbiAgaWYgKG5vZGUucGFyZW50ICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBIYXMgcGFyZW50OiBmaW5kIG5lYXJlc3QgS0VQVCBhbmNlc3RvciB0byBhdm9pZCBkYW5nbGluZyByZWZlcmVuY2VzXG4gICAgbGV0IG5lYXJlc3RLZXB0QW5jZXN0b3I6IFRyZWVOb2RlIHwgdW5kZWZpbmVkID0gbm9kZS5wYXJlbnQ7XG4gICAgd2hpbGUgKG5lYXJlc3RLZXB0QW5jZXN0b3IgJiYgIW5lYXJlc3RLZXB0QW5jZXN0b3Iua2VwdCkge1xuICAgICAgbmVhcmVzdEtlcHRBbmNlc3RvciA9IG5lYXJlc3RLZXB0QW5jZXN0b3IucGFyZW50O1xuICAgIH1cbiAgICBub2RlLmV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IG5lYXJlc3RLZXB0QW5jZXN0b3I/LmV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgfSBlbHNlIGlmIChub2RlLndhc1JlcGFyZW50ZWQpIHtcbiAgICAvLyBOb2RlIHdhcyByZXBhcmVudGVkIChwYXJlbnQgd2FzIGRyb3BwZWQpIC0gY2xlYXIgcGFyZW50IHJlZmVyZW5jZVxuICAgIG5vZGUuZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gdW5kZWZpbmVkO1xuICB9IGVsc2UgaWYgKG5vZGUuZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSB7XG4gICAgLy8gTm8gcGFyZW50IGluIHRyZWUgYW5kIG5vdCByZXBhcmVudGVkOiBwYXJlbnQgd2FzIG5ldmVyIGluIHRoaXMgYmF0Y2hcbiAgICAvLyBDbGVhciBwZXIgY29udHJhY3Q6IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBzaG91bGQgb25seSByZWZlcmVuY2Ugc2FtZSBzbGljZVxuICAgIC8vIENyb3NzLWludm9jYXRpb24gbGlua3Mgc2hvdWxkIHVzZSBjYXVzZWRCeSBpbnN0ZWFkXG4gICAgbm9kZS5ldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSB1bmRlZmluZWQ7XG4gIH1cblxuICAvLyBBZGQgdGhpcyBub2RlIHRvIG91dHB1dFxuICBvdXRwdXQucHVzaChub2RlLmV2ZW50KTtcblxuICAvLyBBZGQgc3VtbWFyeSBjaGVja3BvaW50IGlmIHRoaXMgbm9kZSBoYWQgc3VwcHJlc3Npb25zXG4gIC8vIElNUE9SVEFOVDogVXNlIGFwcGVuZENoZWNrcG9pbnRCb3VuZGVkIHRvIHJlc3BlY3QgbGltaXRzXG4gIGNvbnN0IGRhdGEgPSBub2RlLmV2ZW50LmRhdGE7XG4gIGlmIChpc1JlY29yZChkYXRhKSkge1xuICAgIGNvbnN0IG5yRGF0YSA9IGRhdGEubm9pc2VSZWR1Y3Rpb24gYXMgTm9pc2VSZWR1Y3Rpb25EYXRhIHwgdW5kZWZpbmVkO1xuXG4gICAgaWYgKG5yRGF0YSAmJiAobnJEYXRhLmRyb3BwZWQgfHwgbnJEYXRhLmZvbGRlZCB8fCBuckRhdGEuYWdncmVnYXRlZCkpIHtcbiAgICAgIC8vIENoZWNrIGlmIHN1bW1hcnkgY2hlY2twb2ludCBhbHJlYWR5IGV4aXN0c1xuICAgICAgY29uc3QgY2hlY2twb2ludHMgPSBkYXRhLmNoZWNrcG9pbnRzO1xuICAgICAgY29uc3QgaGFzU3VtbWFyeSA9IEFycmF5LmlzQXJyYXkoY2hlY2twb2ludHMpICYmXG4gICAgICAgIGNoZWNrcG9pbnRzLnNvbWUoKGM6IGFueSkgPT4gYz8ubmFtZSA9PT0gJ25vaXNlUmVkdWN0aW9uLnN1bW1hcnknKTtcblxuICAgICAgaWYgKCFoYXNTdW1tYXJ5ICYmIGNvbmZpZykge1xuICAgICAgICAvLyBDcmVhdGUgc3VtbWFyeSBkYXRhIGZvciBjaGVja3BvaW50IChjb21wYWN0LCBkaXN0aW5jdCBpbmZvIG9ubHkpXG4gICAgICAgIGNvbnN0IHN1bW1hcnlEYXRhOiBhbnkgPSB7fTtcblxuICAgICAgICAvLyBBbHdheXMgaW5jbHVkZSBjb3VudHMgKGNoZWFwLCB1c2VmdWwpXG4gICAgICAgIGlmIChuckRhdGEuZHJvcHBlZCkgc3VtbWFyeURhdGEuZHJvcHBlZCA9IG5yRGF0YS5kcm9wcGVkO1xuICAgICAgICBpZiAobnJEYXRhLmZvbGRlZCkgc3VtbWFyeURhdGEuZm9sZGVkID0gbnJEYXRhLmZvbGRlZDtcbiAgICAgICAgaWYgKG5yRGF0YS5hZ2dyZWdhdGVkKSBzdW1tYXJ5RGF0YS5hZ2dyZWdhdGVkID0gbnJEYXRhLmFnZ3JlZ2F0ZWQ7XG5cbiAgICAgICAgLy8gSW5jbHVkZSB0eXBlIGJyZWFrZG93biAoZGlzdGluY3QgdmFsdWVzLCBjaGVhcClcbiAgICAgICAgaWYgKG5yRGF0YS5ieVR5cGUgJiYgT2JqZWN0LmtleXMobnJEYXRhLmJ5VHlwZSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHN1bW1hcnlEYXRhLmJ5VHlwZSA9IG5yRGF0YS5ieVR5cGU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJbmNsdWRlIEZVTEwgYWdncmVnYXRlcyBkYXRhICh3aXRoIGV4YW1wbGVzLCBlcnJvcnMsIHJ1bGVzKVxuICAgICAgICAvLyBDaGVja3BvaW50IHNob3VsZCBiZSBzZWxmLWNvbnRhaW5lZCB3aXRoIGFsbCBhZ2dyZWdhdGUgZGV0YWlsc1xuICAgICAgICBpZiAobnJEYXRhLmFnZ3JlZ2F0ZXMpIHtcbiAgICAgICAgICBzdW1tYXJ5RGF0YS5hZ2dyZWdhdGVzID0gbnJEYXRhLmFnZ3JlZ2F0ZXM7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJbmNsdWRlIHRydW5jYXRpb24gbWV0YWRhdGEgaWYgcHJlc2VudFxuICAgICAgICBpZiAobnJEYXRhLmNoZWNrcG9pbnRzVHJ1bmNhdGVkKSBzdW1tYXJ5RGF0YS5jaGVja3BvaW50c1RydW5jYXRlZCA9IG5yRGF0YS5jaGVja3BvaW50c1RydW5jYXRlZDtcbiAgICAgICAgaWYgKG5yRGF0YS5jaGVja3BvaW50c1RydW5jYXRlZENvdW50KSBzdW1tYXJ5RGF0YS5jaGVja3BvaW50c1RydW5jYXRlZENvdW50ID0gbnJEYXRhLmNoZWNrcG9pbnRzVHJ1bmNhdGVkQ291bnQ7XG4gICAgICAgIGlmIChuckRhdGEuYWdncmVnYXRlS2V5c1RydW5jYXRlZCkgc3VtbWFyeURhdGEuYWdncmVnYXRlS2V5c1RydW5jYXRlZCA9IG5yRGF0YS5hZ2dyZWdhdGVLZXlzVHJ1bmNhdGVkO1xuICAgICAgICBpZiAobnJEYXRhLmFnZ3JlZ2F0ZUV4YW1wbGVzVHJ1bmNhdGVkKSBzdW1tYXJ5RGF0YS5hZ2dyZWdhdGVFeGFtcGxlc1RydW5jYXRlZCA9IG5yRGF0YS5hZ2dyZWdhdGVFeGFtcGxlc1RydW5jYXRlZDtcblxuICAgICAgICAvLyBBZGQgc3VtbWFyeSBjaGVja3BvaW50IHdpdGggQUxMIGRhdGEgKGNoZWNrcG9pbnQgaXMgc2VsZi1jb250YWluZWQpXG4gICAgICAgIGFwcGVuZENoZWNrcG9pbnRCb3VuZGVkKG5vZGUuZXZlbnQsIGNvbmZpZywge1xuICAgICAgICAgIG5hbWU6ICdub2lzZVJlZHVjdGlvbi5zdW1tYXJ5JyxcbiAgICAgICAgICB0czogRGF0ZS5ub3coKSxcbiAgICAgICAgICBkYXRhOiBzdW1tYXJ5RGF0YSxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2UgaWYgKCFoYXNTdW1tYXJ5KSB7XG4gICAgICAgIC8vIEZhbGxiYWNrIGlmIG5vIGNvbmZpZyBwcm92aWRlZCAoc2hvdWxkbid0IGhhcHBlbiBpbiBwcmFjdGljZSlcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGRhdGEuY2hlY2twb2ludHMpKSB7XG4gICAgICAgICAgZGF0YS5jaGVja3BvaW50cyA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIChkYXRhLmNoZWNrcG9pbnRzIGFzIGFueVtdKS5wdXNoKHtcbiAgICAgICAgICBuYW1lOiAnbm9pc2VSZWR1Y3Rpb24uc3VtbWFyeScsXG4gICAgICAgICAgdHM6IERhdGUubm93KCksXG4gICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgZHJvcHBlZDogbnJEYXRhLmRyb3BwZWQsXG4gICAgICAgICAgICBmb2xkZWQ6IG5yRGF0YS5mb2xkZWQsXG4gICAgICAgICAgICBhZ2dyZWdhdGVkOiBuckRhdGEuYWdncmVnYXRlZCxcbiAgICAgICAgICAgIGJ5VHlwZTogbnJEYXRhLmJ5VHlwZSxcbiAgICAgICAgICAgIGFnZ3JlZ2F0ZXM6IG5yRGF0YS5hZ2dyZWdhdGVzLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBEZWxldGUgZGF0YS5ub2lzZVJlZHVjdGlvbiBlbnRpcmVseSAtIGFsbCBpbmZvIGlzIGluIHRoZSBjaGVja3BvaW50IG5vd1xuICAgICAgZGVsZXRlIGRhdGEubm9pc2VSZWR1Y3Rpb247XG4gICAgfVxuICB9XG5cbiAgLy8gUmVjdXJzZSB0byBrZXB0IGNoaWxkcmVuIG9ubHlcbiAgZm9yIChjb25zdCBjaGlsZCBvZiBub2RlLmNoaWxkcmVuKSB7XG4gICAgaWYgKGNoaWxkLmtlcHQpIHtcbiAgICAgIGZsYXR0ZW5UcmVlKGNoaWxkLCBvdXRwdXQsIGNvbmZpZyk7XG4gICAgfVxuICB9XG59XG4iXX0=