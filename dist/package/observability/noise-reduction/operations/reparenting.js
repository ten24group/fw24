"use strict";
/**
 * Reparenting operations - handling orphaned children when parents are dropped.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reparentKeptChildren = reparentKeptChildren;
const utils_1 = require("../utils");
/**
 * Reparent kept children when their parent is dropped.
 *
 * When a parent node is dropped/folded/aggregated, any kept children
 * must be reparented to the nearest kept ancestor. This maintains
 * hierarchy integrity in the final output.
 *
 * Algorithm:
 * 1. Find all kept children of the dropped node
 * 2. For each kept child:
 *    a. Walk up ancestors until finding a kept one
 *    b. If found: reparent to that ancestor
 *    c. If not found: make child a root (orphan)
 * 3. Add debug checkpoints to track reparenting
 *
 * Time complexity: O(k * d) where k = kept children, d = tree depth
 * Space complexity: O(1) (modifies tree in-place)
 *
 * @param droppedNode - Node that was dropped (parent)
 * @param config - Noise reduction configuration
 * @returns Array of orphaned nodes (children that became roots)
 */
function reparentKeptChildren(droppedNode, config) {
    const keptChildren = droppedNode.children.filter(c => c.kept);
    const bounds = (0, utils_1.getBounds)(config);
    const orphanedNodes = [];
    for (const child of keptChildren) {
        // Find nearest ancestor
        // We simply move children to the immediate parent (bubbling up).
        // The ancestor will then decide whether to keep itself (now that it has children)
        // or drop and continue bubbling the children up.
        const ancestor = droppedNode.parent;
        if (ancestor) {
            // Reparent to ancestor (update tree structure only)
            // The flattener will set parentObservabilityLogId based on the tree structure
            child.parent = ancestor;
            // Add child to ancestor's children if not already there
            // (It might already be there from initial tree building)
            if (!ancestor.children.includes(child)) {
                ancestor.children.push(child);
            }
            // Add debug checkpoint
            if (bounds.includeDebugMetadata) {
                (0, utils_1.appendCheckpointBounded)(child.event, config, {
                    name: 'noiseReduction.reparented',
                    ts: Date.now(),
                    data: {
                        originalParent: droppedNode.event.observabilityLogId,
                        newParent: ancestor.event.observabilityLogId,
                        reason: 'Original parent was dropped by noise reduction',
                    },
                });
            }
        }
        else {
            // No kept ancestor found - this becomes a root (orphan)
            // The flattener will set parentObservabilityLogId to undefined based on wasReparented flag
            child.parent = undefined;
            child.wasReparented = true;
            // Track as orphaned node (will be added to roots)
            orphanedNodes.push(child);
            // Add debug checkpoint
            if (bounds.includeDebugMetadata) {
                (0, utils_1.appendCheckpointBounded)(child.event, config, {
                    name: 'noiseReduction.orphaned',
                    ts: Date.now(),
                    data: {
                        originalParent: droppedNode.event.observabilityLogId,
                        reason: 'Original parent and all ancestors were dropped by noise reduction',
                    },
                });
            }
        }
    }
    return orphanedNodes;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVwYXJlbnRpbmcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vb3BlcmF0aW9ucy9yZXBhcmVudGluZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7O0dBRUc7O0FBNEJILG9EQThEQztBQXRGRCxvQ0FBOEQ7QUFFOUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXFCRztBQUNILFNBQWdCLG9CQUFvQixDQUNsQyxXQUFxQixFQUNyQixNQUE0QjtJQUU1QixNQUFNLFlBQVksR0FBRyxXQUFXLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM5RCxNQUFNLE1BQU0sR0FBRyxJQUFBLGlCQUFTLEVBQUMsTUFBTSxDQUFDLENBQUM7SUFDakMsTUFBTSxhQUFhLEdBQWUsRUFBRSxDQUFDO0lBRXJDLEtBQUssTUFBTSxLQUFLLElBQUksWUFBWSxFQUFFLENBQUM7UUFDakMsd0JBQXdCO1FBQ3hCLGlFQUFpRTtRQUNqRSxrRkFBa0Y7UUFDbEYsaURBQWlEO1FBQ2pELE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxNQUFNLENBQUM7UUFFcEMsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUNiLG9EQUFvRDtZQUNwRCw4RUFBOEU7WUFDOUUsS0FBSyxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUM7WUFFeEIsd0RBQXdEO1lBQ3hELHlEQUF5RDtZQUN6RCxJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDdkMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDaEMsQ0FBQztZQUVELHVCQUF1QjtZQUN2QixJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO2dCQUNoQyxJQUFBLCtCQUF1QixFQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFO29CQUMzQyxJQUFJLEVBQUUsMkJBQTJCO29CQUNqQyxFQUFFLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtvQkFDZCxJQUFJLEVBQUU7d0JBQ0osY0FBYyxFQUFFLFdBQVcsQ0FBQyxLQUFLLENBQUMsa0JBQWtCO3dCQUNwRCxTQUFTLEVBQUUsUUFBUSxDQUFDLEtBQUssQ0FBQyxrQkFBa0I7d0JBQzVDLE1BQU0sRUFBRSxnREFBZ0Q7cUJBQ3pEO2lCQUNGLENBQUMsQ0FBQztZQUNMLENBQUM7UUFDSCxDQUFDO2FBQU0sQ0FBQztZQUNOLHdEQUF3RDtZQUN4RCwyRkFBMkY7WUFDM0YsS0FBSyxDQUFDLE1BQU0sR0FBRyxTQUFTLENBQUM7WUFDekIsS0FBSyxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUM7WUFFM0Isa0RBQWtEO1lBQ2xELGFBQWEsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7WUFFMUIsdUJBQXVCO1lBQ3ZCLElBQUksTUFBTSxDQUFDLG9CQUFvQixFQUFFLENBQUM7Z0JBQ2hDLElBQUEsK0JBQXVCLEVBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUU7b0JBQzNDLElBQUksRUFBRSx5QkFBeUI7b0JBQy9CLEVBQUUsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO29CQUNkLElBQUksRUFBRTt3QkFDSixjQUFjLEVBQUUsV0FBVyxDQUFDLEtBQUssQ0FBQyxrQkFBa0I7d0JBQ3BELE1BQU0sRUFBRSxtRUFBbUU7cUJBQzVFO2lCQUNGLENBQUMsQ0FBQztZQUNMLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sYUFBYSxDQUFDO0FBQ3ZCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFJlcGFyZW50aW5nIG9wZXJhdGlvbnMgLSBoYW5kbGluZyBvcnBoYW5lZCBjaGlsZHJlbiB3aGVuIHBhcmVudHMgYXJlIGRyb3BwZWQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBOb2lzZVJlZHVjdGlvbkNvbmZpZyB9IGZyb20gJy4uLy4uL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgVHJlZU5vZGUgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBhcHBlbmRDaGVja3BvaW50Qm91bmRlZCwgZ2V0Qm91bmRzIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG4vKipcbiAqIFJlcGFyZW50IGtlcHQgY2hpbGRyZW4gd2hlbiB0aGVpciBwYXJlbnQgaXMgZHJvcHBlZC5cbiAqIFxuICogV2hlbiBhIHBhcmVudCBub2RlIGlzIGRyb3BwZWQvZm9sZGVkL2FnZ3JlZ2F0ZWQsIGFueSBrZXB0IGNoaWxkcmVuXG4gKiBtdXN0IGJlIHJlcGFyZW50ZWQgdG8gdGhlIG5lYXJlc3Qga2VwdCBhbmNlc3Rvci4gVGhpcyBtYWludGFpbnNcbiAqIGhpZXJhcmNoeSBpbnRlZ3JpdHkgaW4gdGhlIGZpbmFsIG91dHB1dC5cbiAqIFxuICogQWxnb3JpdGhtOlxuICogMS4gRmluZCBhbGwga2VwdCBjaGlsZHJlbiBvZiB0aGUgZHJvcHBlZCBub2RlXG4gKiAyLiBGb3IgZWFjaCBrZXB0IGNoaWxkOlxuICogICAgYS4gV2FsayB1cCBhbmNlc3RvcnMgdW50aWwgZmluZGluZyBhIGtlcHQgb25lXG4gKiAgICBiLiBJZiBmb3VuZDogcmVwYXJlbnQgdG8gdGhhdCBhbmNlc3RvclxuICogICAgYy4gSWYgbm90IGZvdW5kOiBtYWtlIGNoaWxkIGEgcm9vdCAob3JwaGFuKVxuICogMy4gQWRkIGRlYnVnIGNoZWNrcG9pbnRzIHRvIHRyYWNrIHJlcGFyZW50aW5nXG4gKiBcbiAqIFRpbWUgY29tcGxleGl0eTogTyhrICogZCkgd2hlcmUgayA9IGtlcHQgY2hpbGRyZW4sIGQgPSB0cmVlIGRlcHRoXG4gKiBTcGFjZSBjb21wbGV4aXR5OiBPKDEpIChtb2RpZmllcyB0cmVlIGluLXBsYWNlKVxuICogXG4gKiBAcGFyYW0gZHJvcHBlZE5vZGUgLSBOb2RlIHRoYXQgd2FzIGRyb3BwZWQgKHBhcmVudClcbiAqIEBwYXJhbSBjb25maWcgLSBOb2lzZSByZWR1Y3Rpb24gY29uZmlndXJhdGlvblxuICogQHJldHVybnMgQXJyYXkgb2Ygb3JwaGFuZWQgbm9kZXMgKGNoaWxkcmVuIHRoYXQgYmVjYW1lIHJvb3RzKVxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVwYXJlbnRLZXB0Q2hpbGRyZW4oXG4gIGRyb3BwZWROb2RlOiBUcmVlTm9kZSxcbiAgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZ1xuKTogVHJlZU5vZGVbXSB7XG4gIGNvbnN0IGtlcHRDaGlsZHJlbiA9IGRyb3BwZWROb2RlLmNoaWxkcmVuLmZpbHRlcihjID0+IGMua2VwdCk7XG4gIGNvbnN0IGJvdW5kcyA9IGdldEJvdW5kcyhjb25maWcpO1xuICBjb25zdCBvcnBoYW5lZE5vZGVzOiBUcmVlTm9kZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBjaGlsZCBvZiBrZXB0Q2hpbGRyZW4pIHtcbiAgICAvLyBGaW5kIG5lYXJlc3QgYW5jZXN0b3JcbiAgICAvLyBXZSBzaW1wbHkgbW92ZSBjaGlsZHJlbiB0byB0aGUgaW1tZWRpYXRlIHBhcmVudCAoYnViYmxpbmcgdXApLlxuICAgIC8vIFRoZSBhbmNlc3RvciB3aWxsIHRoZW4gZGVjaWRlIHdoZXRoZXIgdG8ga2VlcCBpdHNlbGYgKG5vdyB0aGF0IGl0IGhhcyBjaGlsZHJlbilcbiAgICAvLyBvciBkcm9wIGFuZCBjb250aW51ZSBidWJibGluZyB0aGUgY2hpbGRyZW4gdXAuXG4gICAgY29uc3QgYW5jZXN0b3IgPSBkcm9wcGVkTm9kZS5wYXJlbnQ7XG5cbiAgICBpZiAoYW5jZXN0b3IpIHtcbiAgICAgIC8vIFJlcGFyZW50IHRvIGFuY2VzdG9yICh1cGRhdGUgdHJlZSBzdHJ1Y3R1cmUgb25seSlcbiAgICAgIC8vIFRoZSBmbGF0dGVuZXIgd2lsbCBzZXQgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGJhc2VkIG9uIHRoZSB0cmVlIHN0cnVjdHVyZVxuICAgICAgY2hpbGQucGFyZW50ID0gYW5jZXN0b3I7XG5cbiAgICAgIC8vIEFkZCBjaGlsZCB0byBhbmNlc3RvcidzIGNoaWxkcmVuIGlmIG5vdCBhbHJlYWR5IHRoZXJlXG4gICAgICAvLyAoSXQgbWlnaHQgYWxyZWFkeSBiZSB0aGVyZSBmcm9tIGluaXRpYWwgdHJlZSBidWlsZGluZylcbiAgICAgIGlmICghYW5jZXN0b3IuY2hpbGRyZW4uaW5jbHVkZXMoY2hpbGQpKSB7XG4gICAgICAgIGFuY2VzdG9yLmNoaWxkcmVuLnB1c2goY2hpbGQpO1xuICAgICAgfVxuXG4gICAgICAvLyBBZGQgZGVidWcgY2hlY2twb2ludFxuICAgICAgaWYgKGJvdW5kcy5pbmNsdWRlRGVidWdNZXRhZGF0YSkge1xuICAgICAgICBhcHBlbmRDaGVja3BvaW50Qm91bmRlZChjaGlsZC5ldmVudCwgY29uZmlnLCB7XG4gICAgICAgICAgbmFtZTogJ25vaXNlUmVkdWN0aW9uLnJlcGFyZW50ZWQnLFxuICAgICAgICAgIHRzOiBEYXRlLm5vdygpLFxuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIG9yaWdpbmFsUGFyZW50OiBkcm9wcGVkTm9kZS5ldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICAgICAgICBuZXdQYXJlbnQ6IGFuY2VzdG9yLmV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgICAgICAgIHJlYXNvbjogJ09yaWdpbmFsIHBhcmVudCB3YXMgZHJvcHBlZCBieSBub2lzZSByZWR1Y3Rpb24nLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBObyBrZXB0IGFuY2VzdG9yIGZvdW5kIC0gdGhpcyBiZWNvbWVzIGEgcm9vdCAob3JwaGFuKVxuICAgICAgLy8gVGhlIGZsYXR0ZW5lciB3aWxsIHNldCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgdG8gdW5kZWZpbmVkIGJhc2VkIG9uIHdhc1JlcGFyZW50ZWQgZmxhZ1xuICAgICAgY2hpbGQucGFyZW50ID0gdW5kZWZpbmVkO1xuICAgICAgY2hpbGQud2FzUmVwYXJlbnRlZCA9IHRydWU7XG5cbiAgICAgIC8vIFRyYWNrIGFzIG9ycGhhbmVkIG5vZGUgKHdpbGwgYmUgYWRkZWQgdG8gcm9vdHMpXG4gICAgICBvcnBoYW5lZE5vZGVzLnB1c2goY2hpbGQpO1xuXG4gICAgICAvLyBBZGQgZGVidWcgY2hlY2twb2ludFxuICAgICAgaWYgKGJvdW5kcy5pbmNsdWRlRGVidWdNZXRhZGF0YSkge1xuICAgICAgICBhcHBlbmRDaGVja3BvaW50Qm91bmRlZChjaGlsZC5ldmVudCwgY29uZmlnLCB7XG4gICAgICAgICAgbmFtZTogJ25vaXNlUmVkdWN0aW9uLm9ycGhhbmVkJyxcbiAgICAgICAgICB0czogRGF0ZS5ub3coKSxcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBvcmlnaW5hbFBhcmVudDogZHJvcHBlZE5vZGUuZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgICAgICAgcmVhc29uOiAnT3JpZ2luYWwgcGFyZW50IGFuZCBhbGwgYW5jZXN0b3JzIHdlcmUgZHJvcHBlZCBieSBub2lzZSByZWR1Y3Rpb24nLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvcnBoYW5lZE5vZGVzO1xufVxuIl19