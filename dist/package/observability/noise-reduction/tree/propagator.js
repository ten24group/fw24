"use strict";
/**
 * Phase 2.5: Propagate hard signal flags up the tree.
 *
 * This phase walks the tree post-order and marks which nodes have
 * hard signals in their subtree. This information is used in Phase 3
 * to automatically preserve context around errors.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.propagateHardSignals = propagateHardSignals;
const hard_signals_1 = require("../hard-signals");
/**
 * Propagate hard signal flags up the tree.
 *
 * Post-order traversal: check children first, then this node.
 * If any descendant is a hard signal, mark this node's subtree as having one.
 *
 * This enables automatic context preservation: nodes with hard signals in
 * their subtree will not be dropped even if rules say to drop them.
 *
 * Time complexity: O(n) where n = number of nodes
 * Space complexity: O(1) additional (modifies nodes in-place)
 *
 * @param node - Current node to process
 * @param config - Noise reduction configuration
 * @returns true if this node or any descendant is a hard signal
 */
function propagateHardSignals(node, config) {
    let hasHardSignal = false;
    // Check children first (post-order traversal)
    for (const child of node.children) {
        if (propagateHardSignals(child, config)) {
            hasHardSignal = true;
        }
    }
    // Check this node
    if ((0, hard_signals_1.isHardSignal)(node.event, config)) {
        hasHardSignal = true;
    }
    // Store flag on node for Phase 3 (transformer)
    node.hasHardSignalInSubtree = hasHardSignal;
    return hasHardSignal;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvcGFnYXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L25vaXNlLXJlZHVjdGlvbi90cmVlL3Byb3BhZ2F0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7QUFzQkgsb0RBc0JDO0FBeENELGtEQUErQztBQUUvQzs7Ozs7Ozs7Ozs7Ozs7O0dBZUc7QUFDSCxTQUFnQixvQkFBb0IsQ0FDbEMsSUFBYyxFQUNkLE1BQTRCO0lBRTVCLElBQUksYUFBYSxHQUFHLEtBQUssQ0FBQztJQUUxQiw4Q0FBOEM7SUFDOUMsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsSUFBSSxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUN4QyxhQUFhLEdBQUcsSUFBSSxDQUFDO1FBQ3ZCLENBQUM7SUFDSCxDQUFDO0lBRUQsa0JBQWtCO0lBQ2xCLElBQUksSUFBQSwyQkFBWSxFQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLEVBQUUsQ0FBQztRQUNyQyxhQUFhLEdBQUcsSUFBSSxDQUFDO0lBQ3ZCLENBQUM7SUFFRCwrQ0FBK0M7SUFDL0MsSUFBSSxDQUFDLHNCQUFzQixHQUFHLGFBQWEsQ0FBQztJQUU1QyxPQUFPLGFBQWEsQ0FBQztBQUN2QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBQaGFzZSAyLjU6IFByb3BhZ2F0ZSBoYXJkIHNpZ25hbCBmbGFncyB1cCB0aGUgdHJlZS5cbiAqIFxuICogVGhpcyBwaGFzZSB3YWxrcyB0aGUgdHJlZSBwb3N0LW9yZGVyIGFuZCBtYXJrcyB3aGljaCBub2RlcyBoYXZlXG4gKiBoYXJkIHNpZ25hbHMgaW4gdGhlaXIgc3VidHJlZS4gVGhpcyBpbmZvcm1hdGlvbiBpcyB1c2VkIGluIFBoYXNlIDNcbiAqIHRvIGF1dG9tYXRpY2FsbHkgcHJlc2VydmUgY29udGV4dCBhcm91bmQgZXJyb3JzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgVHJlZU5vZGUgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgdHlwZSB7IE5vaXNlUmVkdWN0aW9uQ29uZmlnIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuaW1wb3J0IHsgaXNIYXJkU2lnbmFsIH0gZnJvbSAnLi4vaGFyZC1zaWduYWxzJztcblxuLyoqXG4gKiBQcm9wYWdhdGUgaGFyZCBzaWduYWwgZmxhZ3MgdXAgdGhlIHRyZWUuXG4gKiBcbiAqIFBvc3Qtb3JkZXIgdHJhdmVyc2FsOiBjaGVjayBjaGlsZHJlbiBmaXJzdCwgdGhlbiB0aGlzIG5vZGUuXG4gKiBJZiBhbnkgZGVzY2VuZGFudCBpcyBhIGhhcmQgc2lnbmFsLCBtYXJrIHRoaXMgbm9kZSdzIHN1YnRyZWUgYXMgaGF2aW5nIG9uZS5cbiAqIFxuICogVGhpcyBlbmFibGVzIGF1dG9tYXRpYyBjb250ZXh0IHByZXNlcnZhdGlvbjogbm9kZXMgd2l0aCBoYXJkIHNpZ25hbHMgaW5cbiAqIHRoZWlyIHN1YnRyZWUgd2lsbCBub3QgYmUgZHJvcHBlZCBldmVuIGlmIHJ1bGVzIHNheSB0byBkcm9wIHRoZW0uXG4gKiBcbiAqIFRpbWUgY29tcGxleGl0eTogTyhuKSB3aGVyZSBuID0gbnVtYmVyIG9mIG5vZGVzXG4gKiBTcGFjZSBjb21wbGV4aXR5OiBPKDEpIGFkZGl0aW9uYWwgKG1vZGlmaWVzIG5vZGVzIGluLXBsYWNlKVxuICogXG4gKiBAcGFyYW0gbm9kZSAtIEN1cnJlbnQgbm9kZSB0byBwcm9jZXNzXG4gKiBAcGFyYW0gY29uZmlnIC0gTm9pc2UgcmVkdWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIHRydWUgaWYgdGhpcyBub2RlIG9yIGFueSBkZXNjZW5kYW50IGlzIGEgaGFyZCBzaWduYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByb3BhZ2F0ZUhhcmRTaWduYWxzKFxuICBub2RlOiBUcmVlTm9kZSxcbiAgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZ1xuKTogYm9vbGVhbiB7XG4gIGxldCBoYXNIYXJkU2lnbmFsID0gZmFsc2U7XG5cbiAgLy8gQ2hlY2sgY2hpbGRyZW4gZmlyc3QgKHBvc3Qtb3JkZXIgdHJhdmVyc2FsKVxuICBmb3IgKGNvbnN0IGNoaWxkIG9mIG5vZGUuY2hpbGRyZW4pIHtcbiAgICBpZiAocHJvcGFnYXRlSGFyZFNpZ25hbHMoY2hpbGQsIGNvbmZpZykpIHtcbiAgICAgIGhhc0hhcmRTaWduYWwgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIC8vIENoZWNrIHRoaXMgbm9kZVxuICBpZiAoaXNIYXJkU2lnbmFsKG5vZGUuZXZlbnQsIGNvbmZpZykpIHtcbiAgICBoYXNIYXJkU2lnbmFsID0gdHJ1ZTtcbiAgfVxuXG4gIC8vIFN0b3JlIGZsYWcgb24gbm9kZSBmb3IgUGhhc2UgMyAodHJhbnNmb3JtZXIpXG4gIG5vZGUuaGFzSGFyZFNpZ25hbEluU3VidHJlZSA9IGhhc0hhcmRTaWduYWw7XG5cbiAgcmV0dXJuIGhhc0hhcmRTaWduYWw7XG59XG4iXX0=