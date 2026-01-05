"use strict";
/**
 * Phase 1: Build event tree from flat array.
 *
 * Constructs a tree structure from flat observability events based on
 * parentObservabilityLogId relationships. This enables efficient
 * parent-child operations in subsequent phases.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEventTree = buildEventTree;
/**
 * Build a tree structure from flat observability events.
 *
 * Algorithm:
 * 1. Create a TreeNode for each event
 * 2. Index all nodes by observabilityLogId
 * 3. Link parent-child relationships via parentObservabilityLogId
 * 4. Collect root nodes (no parent or parent not in batch)
 *
 * Time complexity: O(n) where n is the number of events
 * Space complexity: O(n) for the tree structure
 *
 * @param events - Flat array of observability events
 * @returns Tree structure with roots and node index
 */
function buildEventTree(events) {
    const nodeById = new Map();
    const roots = [];
    // Phase 1: Create all nodes
    // We create all nodes first to ensure they exist before linking
    for (const event of events) {
        const node = {
            event,
            children: [],
            kept: false, // Will be set in Phase 3 (transformation)
        };
        nodeById.set(event.observabilityLogId, node);
    }
    // Phase 2: Link parent-child relationships
    // Now that all nodes exist, we can safely link them
    for (const node of nodeById.values()) {
        const parentId = node.event.parentObservabilityLogId;
        if (parentId) {
            const parent = nodeById.get(parentId);
            if (parent) {
                // Parent exists in this batch - link them
                node.parent = parent;
                parent.children.push(node);
            }
            else {
                // Parent not in this batch - this is a root for our purposes
                // This can happen with cross-invocation spans or batched processing
                roots.push(node);
            }
        }
        else {
            // No parent ID - this is a true root
            roots.push(node);
        }
    }
    return {
        roots: Object.freeze(roots),
        nodeById,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbGRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L25vaXNlLXJlZHVjdGlvbi90cmVlL2J1aWxkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7QUFvQkgsd0NBMkNDO0FBMUREOzs7Ozs7Ozs7Ozs7OztHQWNHO0FBQ0gsU0FBZ0IsY0FBYyxDQUFDLE1BQXlDO0lBQ3RFLE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxFQUFvQixDQUFDO0lBQzdDLE1BQU0sS0FBSyxHQUFlLEVBQUUsQ0FBQztJQUU3Qiw0QkFBNEI7SUFDNUIsZ0VBQWdFO0lBQ2hFLEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxFQUFFLENBQUM7UUFDM0IsTUFBTSxJQUFJLEdBQWE7WUFDckIsS0FBSztZQUNMLFFBQVEsRUFBRSxFQUFFO1lBQ1osSUFBSSxFQUFFLEtBQUssRUFBRSwwQ0FBMEM7U0FDeEQsQ0FBQztRQUVGLFFBQVEsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLGtCQUFrQixFQUFFLElBQUksQ0FBQyxDQUFDO0lBQy9DLENBQUM7SUFFRCwyQ0FBMkM7SUFDM0Msb0RBQW9EO0lBQ3BELEtBQUssTUFBTSxJQUFJLElBQUksUUFBUSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7UUFDckMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQztRQUVyRCxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQ2IsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUV0QyxJQUFJLE1BQU0sRUFBRSxDQUFDO2dCQUNYLDBDQUEwQztnQkFDMUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7Z0JBQ3JCLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQzdCLENBQUM7aUJBQU0sQ0FBQztnQkFDTiw2REFBNkQ7Z0JBQzdELG9FQUFvRTtnQkFDcEUsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNuQixDQUFDO1FBQ0gsQ0FBQzthQUFNLENBQUM7WUFDTixxQ0FBcUM7WUFDckMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNuQixDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU87UUFDTCxLQUFLLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUM7UUFDM0IsUUFBUTtLQUNULENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBQaGFzZSAxOiBCdWlsZCBldmVudCB0cmVlIGZyb20gZmxhdCBhcnJheS5cbiAqIFxuICogQ29uc3RydWN0cyBhIHRyZWUgc3RydWN0dXJlIGZyb20gZmxhdCBvYnNlcnZhYmlsaXR5IGV2ZW50cyBiYXNlZCBvblxuICogcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIHJlbGF0aW9uc2hpcHMuIFRoaXMgZW5hYmxlcyBlZmZpY2llbnRcbiAqIHBhcmVudC1jaGlsZCBvcGVyYXRpb25zIGluIHN1YnNlcXVlbnQgcGhhc2VzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eUV2ZW50IH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuaW1wb3J0IHR5cGUgeyBFdmVudFRyZWUsIFRyZWVOb2RlIH0gZnJvbSAnLi4vdHlwZXMnO1xuXG4vKipcbiAqIEJ1aWxkIGEgdHJlZSBzdHJ1Y3R1cmUgZnJvbSBmbGF0IG9ic2VydmFiaWxpdHkgZXZlbnRzLlxuICogXG4gKiBBbGdvcml0aG06XG4gKiAxLiBDcmVhdGUgYSBUcmVlTm9kZSBmb3IgZWFjaCBldmVudFxuICogMi4gSW5kZXggYWxsIG5vZGVzIGJ5IG9ic2VydmFiaWxpdHlMb2dJZFxuICogMy4gTGluayBwYXJlbnQtY2hpbGQgcmVsYXRpb25zaGlwcyB2aWEgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXG4gKiA0LiBDb2xsZWN0IHJvb3Qgbm9kZXMgKG5vIHBhcmVudCBvciBwYXJlbnQgbm90IGluIGJhdGNoKVxuICogXG4gKiBUaW1lIGNvbXBsZXhpdHk6IE8obikgd2hlcmUgbiBpcyB0aGUgbnVtYmVyIG9mIGV2ZW50c1xuICogU3BhY2UgY29tcGxleGl0eTogTyhuKSBmb3IgdGhlIHRyZWUgc3RydWN0dXJlXG4gKiBcbiAqIEBwYXJhbSBldmVudHMgLSBGbGF0IGFycmF5IG9mIG9ic2VydmFiaWxpdHkgZXZlbnRzXG4gKiBAcmV0dXJucyBUcmVlIHN0cnVjdHVyZSB3aXRoIHJvb3RzIGFuZCBub2RlIGluZGV4XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEV2ZW50VHJlZShldmVudHM6IFJlYWRvbmx5QXJyYXk8T2JzZXJ2YWJpbGl0eUV2ZW50Pik6IEV2ZW50VHJlZSB7XG4gIGNvbnN0IG5vZGVCeUlkID0gbmV3IE1hcDxzdHJpbmcsIFRyZWVOb2RlPigpO1xuICBjb25zdCByb290czogVHJlZU5vZGVbXSA9IFtdO1xuXG4gIC8vIFBoYXNlIDE6IENyZWF0ZSBhbGwgbm9kZXNcbiAgLy8gV2UgY3JlYXRlIGFsbCBub2RlcyBmaXJzdCB0byBlbnN1cmUgdGhleSBleGlzdCBiZWZvcmUgbGlua2luZ1xuICBmb3IgKGNvbnN0IGV2ZW50IG9mIGV2ZW50cykge1xuICAgIGNvbnN0IG5vZGU6IFRyZWVOb2RlID0ge1xuICAgICAgZXZlbnQsXG4gICAgICBjaGlsZHJlbjogW10sXG4gICAgICBrZXB0OiBmYWxzZSwgLy8gV2lsbCBiZSBzZXQgaW4gUGhhc2UgMyAodHJhbnNmb3JtYXRpb24pXG4gICAgfTtcblxuICAgIG5vZGVCeUlkLnNldChldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQsIG5vZGUpO1xuICB9XG5cbiAgLy8gUGhhc2UgMjogTGluayBwYXJlbnQtY2hpbGQgcmVsYXRpb25zaGlwc1xuICAvLyBOb3cgdGhhdCBhbGwgbm9kZXMgZXhpc3QsIHdlIGNhbiBzYWZlbHkgbGluayB0aGVtXG4gIGZvciAoY29uc3Qgbm9kZSBvZiBub2RlQnlJZC52YWx1ZXMoKSkge1xuICAgIGNvbnN0IHBhcmVudElkID0gbm9kZS5ldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ7XG5cbiAgICBpZiAocGFyZW50SWQpIHtcbiAgICAgIGNvbnN0IHBhcmVudCA9IG5vZGVCeUlkLmdldChwYXJlbnRJZCk7XG5cbiAgICAgIGlmIChwYXJlbnQpIHtcbiAgICAgICAgLy8gUGFyZW50IGV4aXN0cyBpbiB0aGlzIGJhdGNoIC0gbGluayB0aGVtXG4gICAgICAgIG5vZGUucGFyZW50ID0gcGFyZW50O1xuICAgICAgICBwYXJlbnQuY2hpbGRyZW4ucHVzaChub2RlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFBhcmVudCBub3QgaW4gdGhpcyBiYXRjaCAtIHRoaXMgaXMgYSByb290IGZvciBvdXIgcHVycG9zZXNcbiAgICAgICAgLy8gVGhpcyBjYW4gaGFwcGVuIHdpdGggY3Jvc3MtaW52b2NhdGlvbiBzcGFucyBvciBiYXRjaGVkIHByb2Nlc3NpbmdcbiAgICAgICAgcm9vdHMucHVzaChub2RlKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTm8gcGFyZW50IElEIC0gdGhpcyBpcyBhIHRydWUgcm9vdFxuICAgICAgcm9vdHMucHVzaChub2RlKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHJvb3RzOiBPYmplY3QuZnJlZXplKHJvb3RzKSxcbiAgICBub2RlQnlJZCxcbiAgfTtcbn1cbiJdfQ==