"use strict";
/**
 * Summary tracking operations - tracking suppressions on parent spans.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.addToParentSummary = addToParentSummary;
const utils_1 = require("../utils");
/**
 * Add noise reduction summary data to parent span.
 *
 * Tracks statistics about suppressed children (dropped/folded/aggregated)
 * on the parent span. This provides visibility into what was suppressed.
 *
 * Summary data includes:
 * - Counts by decision type (dropped, folded, aggregated)
 * - Breakdown by event type
 * - Breakdown by rule ID (debug metadata only)
 * - Breakdown by operation (debug metadata only)
 *
 * @param node - Node that was suppressed (child)
 * @param config - Noise reduction configuration
 */
function addToParentSummary(node, config) {
    if (!node.parent)
        return;
    const parent = node.parent;
    const event = node.event;
    const bounds = (0, utils_1.getBounds)(config);
    // Get or create noise reduction data on parent
    const data = (0, utils_1.ensureSpanData)(parent.event);
    const nrData = (data.noiseReduction ?? {});
    // Increment appropriate decision counter
    switch (node.decision) {
        case 'drop':
            nrData.dropped = (nrData.dropped ?? 0) + 1;
            break;
        case 'fold':
            nrData.folded = (nrData.folded ?? 0) + 1;
            break;
        case 'aggregate':
            nrData.aggregated = (nrData.aggregated ?? 0) + 1;
            break;
    }
    // Track by event type
    if (!nrData.byType)
        nrData.byType = {};
    (0, utils_1.incrementCounter)(nrData.byType, event.type);
    // Track by rule ID (debug metadata only)
    if (bounds.includeDebugMetadata) {
        if (!nrData.byRuleId)
            nrData.byRuleId = {};
        if (node.ruleId) {
            (0, utils_1.incrementCounter)(nrData.byRuleId, node.ruleId);
        }
        if (!nrData.byOperation)
            nrData.byOperation = {};
        (0, utils_1.incrementCounter)(nrData.byOperation, event.operation);
    }
    // Save updated data
    data.noiseReduction = nrData;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3VtbWFyeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L25vaXNlLXJlZHVjdGlvbi9vcGVyYXRpb25zL3N1bW1hcnkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOztHQUVHOztBQXFCSCxnREE0Q0M7QUE3REQsb0NBQXVFO0FBRXZFOzs7Ozs7Ozs7Ozs7OztHQWNHO0FBQ0gsU0FBZ0Isa0JBQWtCLENBQ2hDLElBQWMsRUFDZCxNQUE0QjtJQUU1QixJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU07UUFBRSxPQUFPO0lBRXpCLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDM0IsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztJQUN6QixNQUFNLE1BQU0sR0FBRyxJQUFBLGlCQUFTLEVBQUMsTUFBTSxDQUFDLENBQUM7SUFFakMsK0NBQStDO0lBQy9DLE1BQU0sSUFBSSxHQUFHLElBQUEsc0JBQWMsRUFBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDMUMsTUFBTSxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsY0FBYyxJQUFJLEVBQUUsQ0FBdUIsQ0FBQztJQUVqRSx5Q0FBeUM7SUFDekMsUUFBUSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDdEIsS0FBSyxNQUFNO1lBQ1QsTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFDLE1BQU0sQ0FBQyxPQUFPLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQzNDLE1BQU07UUFDUixLQUFLLE1BQU07WUFDVCxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsTUFBTSxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDekMsTUFBTTtRQUNSLEtBQUssV0FBVztZQUNkLE1BQU0sQ0FBQyxVQUFVLEdBQUcsQ0FBQyxNQUFNLENBQUMsVUFBVSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNqRCxNQUFNO0lBQ1YsQ0FBQztJQUVELHNCQUFzQjtJQUN0QixJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU07UUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUN2QyxJQUFBLHdCQUFnQixFQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRTVDLHlDQUF5QztJQUN6QyxJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBQ2hDLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUTtZQUFFLE1BQU0sQ0FBQyxRQUFRLEdBQUcsRUFBRSxDQUFDO1FBQzNDLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ2hCLElBQUEsd0JBQWdCLEVBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDakQsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVztZQUFFLE1BQU0sQ0FBQyxXQUFXLEdBQUcsRUFBRSxDQUFDO1FBQ2pELElBQUEsd0JBQWdCLEVBQUMsTUFBTSxDQUFDLFdBQVcsRUFBRSxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDeEQsQ0FBQztJQUVELG9CQUFvQjtJQUNwQixJQUFJLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQztBQUMvQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTdW1tYXJ5IHRyYWNraW5nIG9wZXJhdGlvbnMgLSB0cmFja2luZyBzdXBwcmVzc2lvbnMgb24gcGFyZW50IHNwYW5zLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTm9pc2VSZWR1Y3Rpb25Db25maWcgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5pbXBvcnQgdHlwZSB7IFRyZWVOb2RlLCBOb2lzZVJlZHVjdGlvbkRhdGEgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBlbnN1cmVTcGFuRGF0YSwgaW5jcmVtZW50Q291bnRlciwgZ2V0Qm91bmRzIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG4vKipcbiAqIEFkZCBub2lzZSByZWR1Y3Rpb24gc3VtbWFyeSBkYXRhIHRvIHBhcmVudCBzcGFuLlxuICogXG4gKiBUcmFja3Mgc3RhdGlzdGljcyBhYm91dCBzdXBwcmVzc2VkIGNoaWxkcmVuIChkcm9wcGVkL2ZvbGRlZC9hZ2dyZWdhdGVkKVxuICogb24gdGhlIHBhcmVudCBzcGFuLiBUaGlzIHByb3ZpZGVzIHZpc2liaWxpdHkgaW50byB3aGF0IHdhcyBzdXBwcmVzc2VkLlxuICogXG4gKiBTdW1tYXJ5IGRhdGEgaW5jbHVkZXM6XG4gKiAtIENvdW50cyBieSBkZWNpc2lvbiB0eXBlIChkcm9wcGVkLCBmb2xkZWQsIGFnZ3JlZ2F0ZWQpXG4gKiAtIEJyZWFrZG93biBieSBldmVudCB0eXBlXG4gKiAtIEJyZWFrZG93biBieSBydWxlIElEIChkZWJ1ZyBtZXRhZGF0YSBvbmx5KVxuICogLSBCcmVha2Rvd24gYnkgb3BlcmF0aW9uIChkZWJ1ZyBtZXRhZGF0YSBvbmx5KVxuICogXG4gKiBAcGFyYW0gbm9kZSAtIE5vZGUgdGhhdCB3YXMgc3VwcHJlc3NlZCAoY2hpbGQpXG4gKiBAcGFyYW0gY29uZmlnIC0gTm9pc2UgcmVkdWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkZFRvUGFyZW50U3VtbWFyeShcbiAgbm9kZTogVHJlZU5vZGUsXG4gIGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWdcbik6IHZvaWQge1xuICBpZiAoIW5vZGUucGFyZW50KSByZXR1cm47XG5cbiAgY29uc3QgcGFyZW50ID0gbm9kZS5wYXJlbnQ7XG4gIGNvbnN0IGV2ZW50ID0gbm9kZS5ldmVudDtcbiAgY29uc3QgYm91bmRzID0gZ2V0Qm91bmRzKGNvbmZpZyk7XG5cbiAgLy8gR2V0IG9yIGNyZWF0ZSBub2lzZSByZWR1Y3Rpb24gZGF0YSBvbiBwYXJlbnRcbiAgY29uc3QgZGF0YSA9IGVuc3VyZVNwYW5EYXRhKHBhcmVudC5ldmVudCk7XG4gIGNvbnN0IG5yRGF0YSA9IChkYXRhLm5vaXNlUmVkdWN0aW9uID8/IHt9KSBhcyBOb2lzZVJlZHVjdGlvbkRhdGE7XG5cbiAgLy8gSW5jcmVtZW50IGFwcHJvcHJpYXRlIGRlY2lzaW9uIGNvdW50ZXJcbiAgc3dpdGNoIChub2RlLmRlY2lzaW9uKSB7XG4gICAgY2FzZSAnZHJvcCc6XG4gICAgICBuckRhdGEuZHJvcHBlZCA9IChuckRhdGEuZHJvcHBlZCA/PyAwKSArIDE7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdmb2xkJzpcbiAgICAgIG5yRGF0YS5mb2xkZWQgPSAobnJEYXRhLmZvbGRlZCA/PyAwKSArIDE7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdhZ2dyZWdhdGUnOlxuICAgICAgbnJEYXRhLmFnZ3JlZ2F0ZWQgPSAobnJEYXRhLmFnZ3JlZ2F0ZWQgPz8gMCkgKyAxO1xuICAgICAgYnJlYWs7XG4gIH1cblxuICAvLyBUcmFjayBieSBldmVudCB0eXBlXG4gIGlmICghbnJEYXRhLmJ5VHlwZSkgbnJEYXRhLmJ5VHlwZSA9IHt9O1xuICBpbmNyZW1lbnRDb3VudGVyKG5yRGF0YS5ieVR5cGUsIGV2ZW50LnR5cGUpO1xuXG4gIC8vIFRyYWNrIGJ5IHJ1bGUgSUQgKGRlYnVnIG1ldGFkYXRhIG9ubHkpXG4gIGlmIChib3VuZHMuaW5jbHVkZURlYnVnTWV0YWRhdGEpIHtcbiAgICBpZiAoIW5yRGF0YS5ieVJ1bGVJZCkgbnJEYXRhLmJ5UnVsZUlkID0ge307XG4gICAgaWYgKG5vZGUucnVsZUlkKSB7XG4gICAgICBpbmNyZW1lbnRDb3VudGVyKG5yRGF0YS5ieVJ1bGVJZCwgbm9kZS5ydWxlSWQpO1xuICAgIH1cblxuICAgIGlmICghbnJEYXRhLmJ5T3BlcmF0aW9uKSBuckRhdGEuYnlPcGVyYXRpb24gPSB7fTtcbiAgICBpbmNyZW1lbnRDb3VudGVyKG5yRGF0YS5ieU9wZXJhdGlvbiwgZXZlbnQub3BlcmF0aW9uKTtcbiAgfVxuXG4gIC8vIFNhdmUgdXBkYXRlZCBkYXRhXG4gIGRhdGEubm9pc2VSZWR1Y3Rpb24gPSBuckRhdGE7XG59XG4iXX0=