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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmxhdHRlbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL3RyZWUvZmxhdHRlbmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7OztHQVVHOztBQW1CSCxrQ0FzR0M7QUFySEQsb0NBQTZEO0FBRTdEOzs7Ozs7Ozs7Ozs7R0FZRztBQUNILFNBQWdCLFdBQVcsQ0FDekIsSUFBYyxFQUNkLE1BQTRCLEVBQzVCLE1BQTZCO0lBRTdCLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDZixpREFBaUQ7UUFDakQsT0FBTztJQUNULENBQUM7SUFFRCw4REFBOEQ7SUFDOUQsMERBQTBEO0lBQzFELElBQUksSUFBSSxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUM5QixzRUFBc0U7UUFDdEUsSUFBSSxtQkFBbUIsR0FBeUIsSUFBSSxDQUFDLE1BQU0sQ0FBQztRQUM1RCxPQUFPLG1CQUFtQixJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDeEQsbUJBQW1CLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxDQUFDO1FBQ25ELENBQUM7UUFDRCxJQUFJLENBQUMsS0FBSyxDQUFDLHdCQUF3QixHQUFHLG1CQUFtQixFQUFFLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQztJQUN0RixDQUFDO1NBQU0sSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDOUIsb0VBQW9FO1FBQ3BFLElBQUksQ0FBQyxLQUFLLENBQUMsd0JBQXdCLEdBQUcsU0FBUyxDQUFDO0lBQ2xELENBQUM7SUFDRCwwRkFBMEY7SUFDMUYsNEVBQTRFO0lBRTVFLDBCQUEwQjtJQUMxQixNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUV4Qix1REFBdUQ7SUFDdkQsMkRBQTJEO0lBQzNELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDO0lBQzdCLElBQUksSUFBQSxnQkFBUSxFQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDbkIsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLGNBQWdELENBQUM7UUFFckUsSUFBSSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDckUsNkNBQTZDO1lBQzdDLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUM7WUFDckMsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUM7Z0JBQzNDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxJQUFJLEtBQUssd0JBQXdCLENBQUMsQ0FBQztZQUVyRSxJQUFJLENBQUMsVUFBVSxJQUFJLE1BQU0sRUFBRSxDQUFDO2dCQUMxQixtRUFBbUU7Z0JBQ25FLE1BQU0sV0FBVyxHQUFRLEVBQUUsQ0FBQztnQkFFNUIsd0NBQXdDO2dCQUN4QyxJQUFJLE1BQU0sQ0FBQyxPQUFPO29CQUFFLFdBQVcsQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQztnQkFDekQsSUFBSSxNQUFNLENBQUMsTUFBTTtvQkFBRSxXQUFXLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7Z0JBQ3RELElBQUksTUFBTSxDQUFDLFVBQVU7b0JBQUUsV0FBVyxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFDO2dCQUVsRSxrREFBa0Q7Z0JBQ2xELElBQUksTUFBTSxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQzNELFdBQVcsQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQztnQkFDckMsQ0FBQztnQkFFRCw4REFBOEQ7Z0JBQzlELGlFQUFpRTtnQkFDakUsSUFBSSxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUM7b0JBQ3RCLFdBQVcsQ0FBQyxVQUFVLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQztnQkFDN0MsQ0FBQztnQkFFRCx5Q0FBeUM7Z0JBQ3pDLElBQUksTUFBTSxDQUFDLG9CQUFvQjtvQkFBRSxXQUFXLENBQUMsb0JBQW9CLEdBQUcsTUFBTSxDQUFDLG9CQUFvQixDQUFDO2dCQUNoRyxJQUFJLE1BQU0sQ0FBQyx5QkFBeUI7b0JBQUUsV0FBVyxDQUFDLHlCQUF5QixHQUFHLE1BQU0sQ0FBQyx5QkFBeUIsQ0FBQztnQkFDL0csSUFBSSxNQUFNLENBQUMsc0JBQXNCO29CQUFFLFdBQVcsQ0FBQyxzQkFBc0IsR0FBRyxNQUFNLENBQUMsc0JBQXNCLENBQUM7Z0JBQ3RHLElBQUksTUFBTSxDQUFDLDBCQUEwQjtvQkFBRSxXQUFXLENBQUMsMEJBQTBCLEdBQUcsTUFBTSxDQUFDLDBCQUEwQixDQUFDO2dCQUVsSCxzRUFBc0U7Z0JBQ3RFLElBQUEsK0JBQXVCLEVBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUU7b0JBQzFDLElBQUksRUFBRSx3QkFBd0I7b0JBQzlCLEVBQUUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO29CQUNkLElBQUksRUFBRSxXQUFXO2lCQUNsQixDQUFDLENBQUM7WUFDTCxDQUFDO2lCQUFNLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDdkIsZ0VBQWdFO2dCQUNoRSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztvQkFDckMsSUFBSSxDQUFDLFdBQVcsR0FBRyxFQUFFLENBQUM7Z0JBQ3hCLENBQUM7Z0JBQ0EsSUFBSSxDQUFDLFdBQXFCLENBQUMsSUFBSSxDQUFDO29CQUMvQixJQUFJLEVBQUUsd0JBQXdCO29CQUM5QixFQUFFLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtvQkFDZCxJQUFJLEVBQUU7d0JBQ0osT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPO3dCQUN2QixNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU07d0JBQ3JCLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTt3QkFDN0IsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO3dCQUNyQixVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7cUJBQzlCO2lCQUNGLENBQUMsQ0FBQztZQUNMLENBQUM7WUFFRCwwRUFBMEU7WUFDMUUsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDO1FBQzdCLENBQUM7SUFDSCxDQUFDO0lBRUQsZ0NBQWdDO0lBQ2hDLEtBQUssTUFBTSxLQUFLLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ2xDLElBQUksS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ2YsV0FBVyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDckMsQ0FBQztJQUNILENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBQaGFzZSA0OiBGbGF0dGVuIHRyZWUgdG8gb3V0cHV0IGFycmF5LlxuICogXG4gKiBDb252ZXJ0cyB0aGUgdHJhbnNmb3JtZWQgdHJlZSBiYWNrIHRvIGEgZmxhdCBhcnJheSBvZiBldmVudHMsXG4gKiBpbmNsdWRpbmcgb25seSBrZXB0IG5vZGVzIGFuZCBhZGRpbmcgc3VtbWFyeSBjaGVja3BvaW50cy5cbiAqIFxuICogSU1QT1JUQU5UOiBUcmVlIHN0cnVjdHVyZSBpcyB0aGUgc291cmNlIG9mIHRydXRoIGFmdGVyIHRyYW5zZm9ybWF0aW9uLlxuICogVGhlIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBmaWVsZCBpcyBhbHdheXMgc3luY2hyb25pemVkIGZyb20gdGhlIHRyZWUnc1xuICogcGFyZW50IHBvaW50ZXIuIElmIHJlcGFyZW50aW5nIG9jY3VycmVkIGR1cmluZyB0cmFuc2Zvcm1hdGlvbiwgdGhlIG91dHB1dFxuICogd2lsbCByZWZsZWN0IHRoZSBtb2RpZmllZCBoaWVyYXJjaHkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBOb2lzZVJlZHVjdGlvbkNvbmZpZywgT2JzZXJ2YWJpbGl0eUV2ZW50IH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuaW1wb3J0IHR5cGUgeyBUcmVlTm9kZSwgTm9pc2VSZWR1Y3Rpb25EYXRhIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgaXNSZWNvcmQsIGFwcGVuZENoZWNrcG9pbnRCb3VuZGVkIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG4vKipcbiAqIEZsYXR0ZW4gdHJlZSB0byBvdXRwdXQgYXJyYXkuXG4gKiBcbiAqIFBlcmZvcm1zIGRlcHRoLWZpcnN0IHRyYXZlcnNhbCwgZW1pdHRpbmcgb25seSBrZXB0IG5vZGVzLlxuICogRm9yIG5vZGVzIHdpdGggbm9pc2UgcmVkdWN0aW9uIHN1bW1hcmllcywgYWRkcyBhIHN1bW1hcnkgY2hlY2twb2ludC5cbiAqIFxuICogVGltZSBjb21wbGV4aXR5OiBPKG4pIHdoZXJlIG4gPSBub2Rlc1xuICogU3BhY2UgY29tcGxleGl0eTogTyhrKSB3aGVyZSBrID0ga2VwdCBub2Rlc1xuICogXG4gKiBAcGFyYW0gbm9kZSAtIEN1cnJlbnQgbm9kZSB0byBmbGF0dGVuXG4gKiBAcGFyYW0gb3V0cHV0IC0gT3V0cHV0IGFycmF5IHRvIGFwcGVuZCB0b1xuICogQHBhcmFtIGNvbmZpZyAtIE9wdGlvbmFsIGNvbmZpZyBmb3IgY2hlY2twb2ludCBib3VuZHMgY2hlY2tpbmdcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZsYXR0ZW5UcmVlKFxuICBub2RlOiBUcmVlTm9kZSxcbiAgb3V0cHV0OiBPYnNlcnZhYmlsaXR5RXZlbnRbXSxcbiAgY29uZmlnPzogTm9pc2VSZWR1Y3Rpb25Db25maWdcbik6IHZvaWQge1xuICBpZiAoIW5vZGUua2VwdCkge1xuICAgIC8vIE5vZGUgd2FzIHN1cHByZXNzZWQgLSBza2lwIGl0IGFuZCBpdHMgY2hpbGRyZW5cbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBDUklUSUNBTDogU3luYyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgZnJvbSB0cmVlIHN0cnVjdHVyZVxuICAvLyBUcmVlIHN0cnVjdHVyZSBpcyB0aGUgc291cmNlIG9mIHRydXRoIGFmdGVyIHJlcGFyZW50aW5nXG4gIGlmIChub2RlLnBhcmVudCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gSGFzIHBhcmVudDogZmluZCBuZWFyZXN0IEtFUFQgYW5jZXN0b3IgdG8gYXZvaWQgZGFuZ2xpbmcgcmVmZXJlbmNlc1xuICAgIGxldCBuZWFyZXN0S2VwdEFuY2VzdG9yOiBUcmVlTm9kZSB8IHVuZGVmaW5lZCA9IG5vZGUucGFyZW50O1xuICAgIHdoaWxlIChuZWFyZXN0S2VwdEFuY2VzdG9yICYmICFuZWFyZXN0S2VwdEFuY2VzdG9yLmtlcHQpIHtcbiAgICAgIG5lYXJlc3RLZXB0QW5jZXN0b3IgPSBuZWFyZXN0S2VwdEFuY2VzdG9yLnBhcmVudDtcbiAgICB9XG4gICAgbm9kZS5ldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBuZWFyZXN0S2VwdEFuY2VzdG9yPy5ldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gIH0gZWxzZSBpZiAobm9kZS53YXNSZXBhcmVudGVkKSB7XG4gICAgLy8gTm9kZSB3YXMgcmVwYXJlbnRlZCAocGFyZW50IHdhcyBkcm9wcGVkKSAtIGNsZWFyIHBhcmVudCByZWZlcmVuY2VcbiAgICBub2RlLmV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IHVuZGVmaW5lZDtcbiAgfVxuICAvLyBlbHNlOiBObyBwYXJlbnQgaW4gdHJlZSBhbmQgbm90IHJlcGFyZW50ZWQgLSBwcmVzZXJ2ZSBvcmlnaW5hbCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWRcbiAgLy8gKFRoaXMgaGFuZGxlcyBpbnZhbGlkIHBhcmVudCByZWZlcmVuY2VzIHRoYXQgc2hvdWxkIGJlIGNhdWdodCBkb3duc3RyZWFtKVxuXG4gIC8vIEFkZCB0aGlzIG5vZGUgdG8gb3V0cHV0XG4gIG91dHB1dC5wdXNoKG5vZGUuZXZlbnQpO1xuXG4gIC8vIEFkZCBzdW1tYXJ5IGNoZWNrcG9pbnQgaWYgdGhpcyBub2RlIGhhZCBzdXBwcmVzc2lvbnNcbiAgLy8gSU1QT1JUQU5UOiBVc2UgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQgdG8gcmVzcGVjdCBsaW1pdHNcbiAgY29uc3QgZGF0YSA9IG5vZGUuZXZlbnQuZGF0YTtcbiAgaWYgKGlzUmVjb3JkKGRhdGEpKSB7XG4gICAgY29uc3QgbnJEYXRhID0gZGF0YS5ub2lzZVJlZHVjdGlvbiBhcyBOb2lzZVJlZHVjdGlvbkRhdGEgfCB1bmRlZmluZWQ7XG5cbiAgICBpZiAobnJEYXRhICYmIChuckRhdGEuZHJvcHBlZCB8fCBuckRhdGEuZm9sZGVkIHx8IG5yRGF0YS5hZ2dyZWdhdGVkKSkge1xuICAgICAgLy8gQ2hlY2sgaWYgc3VtbWFyeSBjaGVja3BvaW50IGFscmVhZHkgZXhpc3RzXG4gICAgICBjb25zdCBjaGVja3BvaW50cyA9IGRhdGEuY2hlY2twb2ludHM7XG4gICAgICBjb25zdCBoYXNTdW1tYXJ5ID0gQXJyYXkuaXNBcnJheShjaGVja3BvaW50cykgJiZcbiAgICAgICAgY2hlY2twb2ludHMuc29tZSgoYzogYW55KSA9PiBjPy5uYW1lID09PSAnbm9pc2VSZWR1Y3Rpb24uc3VtbWFyeScpO1xuXG4gICAgICBpZiAoIWhhc1N1bW1hcnkgJiYgY29uZmlnKSB7XG4gICAgICAgIC8vIENyZWF0ZSBzdW1tYXJ5IGRhdGEgZm9yIGNoZWNrcG9pbnQgKGNvbXBhY3QsIGRpc3RpbmN0IGluZm8gb25seSlcbiAgICAgICAgY29uc3Qgc3VtbWFyeURhdGE6IGFueSA9IHt9O1xuXG4gICAgICAgIC8vIEFsd2F5cyBpbmNsdWRlIGNvdW50cyAoY2hlYXAsIHVzZWZ1bClcbiAgICAgICAgaWYgKG5yRGF0YS5kcm9wcGVkKSBzdW1tYXJ5RGF0YS5kcm9wcGVkID0gbnJEYXRhLmRyb3BwZWQ7XG4gICAgICAgIGlmIChuckRhdGEuZm9sZGVkKSBzdW1tYXJ5RGF0YS5mb2xkZWQgPSBuckRhdGEuZm9sZGVkO1xuICAgICAgICBpZiAobnJEYXRhLmFnZ3JlZ2F0ZWQpIHN1bW1hcnlEYXRhLmFnZ3JlZ2F0ZWQgPSBuckRhdGEuYWdncmVnYXRlZDtcblxuICAgICAgICAvLyBJbmNsdWRlIHR5cGUgYnJlYWtkb3duIChkaXN0aW5jdCB2YWx1ZXMsIGNoZWFwKVxuICAgICAgICBpZiAobnJEYXRhLmJ5VHlwZSAmJiBPYmplY3Qua2V5cyhuckRhdGEuYnlUeXBlKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgc3VtbWFyeURhdGEuYnlUeXBlID0gbnJEYXRhLmJ5VHlwZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEluY2x1ZGUgRlVMTCBhZ2dyZWdhdGVzIGRhdGEgKHdpdGggZXhhbXBsZXMsIGVycm9ycywgcnVsZXMpXG4gICAgICAgIC8vIENoZWNrcG9pbnQgc2hvdWxkIGJlIHNlbGYtY29udGFpbmVkIHdpdGggYWxsIGFnZ3JlZ2F0ZSBkZXRhaWxzXG4gICAgICAgIGlmIChuckRhdGEuYWdncmVnYXRlcykge1xuICAgICAgICAgIHN1bW1hcnlEYXRhLmFnZ3JlZ2F0ZXMgPSBuckRhdGEuYWdncmVnYXRlcztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEluY2x1ZGUgdHJ1bmNhdGlvbiBtZXRhZGF0YSBpZiBwcmVzZW50XG4gICAgICAgIGlmIChuckRhdGEuY2hlY2twb2ludHNUcnVuY2F0ZWQpIHN1bW1hcnlEYXRhLmNoZWNrcG9pbnRzVHJ1bmNhdGVkID0gbnJEYXRhLmNoZWNrcG9pbnRzVHJ1bmNhdGVkO1xuICAgICAgICBpZiAobnJEYXRhLmNoZWNrcG9pbnRzVHJ1bmNhdGVkQ291bnQpIHN1bW1hcnlEYXRhLmNoZWNrcG9pbnRzVHJ1bmNhdGVkQ291bnQgPSBuckRhdGEuY2hlY2twb2ludHNUcnVuY2F0ZWRDb3VudDtcbiAgICAgICAgaWYgKG5yRGF0YS5hZ2dyZWdhdGVLZXlzVHJ1bmNhdGVkKSBzdW1tYXJ5RGF0YS5hZ2dyZWdhdGVLZXlzVHJ1bmNhdGVkID0gbnJEYXRhLmFnZ3JlZ2F0ZUtleXNUcnVuY2F0ZWQ7XG4gICAgICAgIGlmIChuckRhdGEuYWdncmVnYXRlRXhhbXBsZXNUcnVuY2F0ZWQpIHN1bW1hcnlEYXRhLmFnZ3JlZ2F0ZUV4YW1wbGVzVHJ1bmNhdGVkID0gbnJEYXRhLmFnZ3JlZ2F0ZUV4YW1wbGVzVHJ1bmNhdGVkO1xuXG4gICAgICAgIC8vIEFkZCBzdW1tYXJ5IGNoZWNrcG9pbnQgd2l0aCBBTEwgZGF0YSAoY2hlY2twb2ludCBpcyBzZWxmLWNvbnRhaW5lZClcbiAgICAgICAgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQobm9kZS5ldmVudCwgY29uZmlnLCB7XG4gICAgICAgICAgbmFtZTogJ25vaXNlUmVkdWN0aW9uLnN1bW1hcnknLFxuICAgICAgICAgIHRzOiBEYXRlLm5vdygpLFxuICAgICAgICAgIGRhdGE6IHN1bW1hcnlEYXRhLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSBpZiAoIWhhc1N1bW1hcnkpIHtcbiAgICAgICAgLy8gRmFsbGJhY2sgaWYgbm8gY29uZmlnIHByb3ZpZGVkIChzaG91bGRuJ3QgaGFwcGVuIGluIHByYWN0aWNlKVxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoZGF0YS5jaGVja3BvaW50cykpIHtcbiAgICAgICAgICBkYXRhLmNoZWNrcG9pbnRzID0gW107XG4gICAgICAgIH1cbiAgICAgICAgKGRhdGEuY2hlY2twb2ludHMgYXMgYW55W10pLnB1c2goe1xuICAgICAgICAgIG5hbWU6ICdub2lzZVJlZHVjdGlvbi5zdW1tYXJ5JyxcbiAgICAgICAgICB0czogRGF0ZS5ub3coKSxcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBkcm9wcGVkOiBuckRhdGEuZHJvcHBlZCxcbiAgICAgICAgICAgIGZvbGRlZDogbnJEYXRhLmZvbGRlZCxcbiAgICAgICAgICAgIGFnZ3JlZ2F0ZWQ6IG5yRGF0YS5hZ2dyZWdhdGVkLFxuICAgICAgICAgICAgYnlUeXBlOiBuckRhdGEuYnlUeXBlLFxuICAgICAgICAgICAgYWdncmVnYXRlczogbnJEYXRhLmFnZ3JlZ2F0ZXMsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIERlbGV0ZSBkYXRhLm5vaXNlUmVkdWN0aW9uIGVudGlyZWx5IC0gYWxsIGluZm8gaXMgaW4gdGhlIGNoZWNrcG9pbnQgbm93XG4gICAgICBkZWxldGUgZGF0YS5ub2lzZVJlZHVjdGlvbjtcbiAgICB9XG4gIH1cblxuICAvLyBSZWN1cnNlIHRvIGtlcHQgY2hpbGRyZW4gb25seVxuICBmb3IgKGNvbnN0IGNoaWxkIG9mIG5vZGUuY2hpbGRyZW4pIHtcbiAgICBpZiAoY2hpbGQua2VwdCkge1xuICAgICAgZmxhdHRlblRyZWUoY2hpbGQsIG91dHB1dCwgY29uZmlnKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==