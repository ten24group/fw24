"use strict";
/**
 * Phase 3: Transform tree based on noise reduction decisions.
 *
 * Applies noise reduction decisions to the tree, performing:
 * - Dropping nodes
 * - Folding nodes into parents
 * - Aggregating nodes into parents
 * - Reparenting orphaned children
 * - Tracking statistics
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformTree = transformTree;
const types_1 = require("../../types");
const utils_1 = require("../utils");
const level_utils_1 = require("../../utils/level-utils");
const folding_1 = require("../operations/folding");
const aggregation_1 = require("../operations/aggregation");
const reparenting_1 = require("../operations/reparenting");
const summary_1 = require("../operations/summary");
/**
 * Transform tree by applying noise reduction decisions.
 *
 * Uses post-order traversal (children first) to ensure child states
 * are known before parent decisions are applied. This enables natural
 * reparenting and prevents force-keep bugs.
 *
 * For each node:
 * 1. Transform all children first (post-order)
 * 2. Apply this node's decision (keep/drop/fold/aggregate/downgrade)
 * 3. Handle side effects (reparenting, summaries, statistics)
 *
 * Time complexity: O(n) where n = nodes
 * Space complexity: O(1) additional (modifies tree in-place)
 *
 * @param node - Current node to transform
 * @param config - Noise reduction configuration
 * @param stats - Statistics accumulator
 * @returns Array of orphaned nodes (children that became roots)
 */
function transformTree(node, config, stats) {
    const bounds = (0, utils_1.getBounds)(config);
    let orphanedNodes = [];
    // Post-order traversal: transform children first
    // This ensures we know child states before applying parent decisions
    for (const child of node.children) {
        const childOrphans = transformTree(child, config, stats);
        orphanedNodes = orphanedNodes.concat(childOrphans);
    }
    // Now apply decision to THIS node
    const decision = node.decision ?? 'keep';
    switch (decision) {
        case 'keep':
            node.kept = true;
            stats.kept++;
            break;
        case 'drop':
            const minContextLevel = config.minLevel ?? types_1.ObservabilityLevel.INFO;
            const nodeLevel = (0, level_utils_1.stringToLevel)(node.event.level);
            const hasParent = node.parent !== undefined;
            const isExplicitOverride = node.ruleId === 'override';
            // Context preservation: upgrade DROP to FOLD if this node provides context for a hard signal
            // EXCEPT for explicit overrides (capture.noise) which must be honored
            if (!isExplicitOverride && node.hasHardSignalInSubtree && nodeLevel >= minContextLevel) {
                // Has hard signal in subtree AND node meets minLevel threshold
                // AUTOMATIC UPGRADE: DROP → FOLD (or KEEP if root)
                if (hasParent) {
                    node.kept = false;
                    (0, folding_1.foldIntoParent)(node, config);
                    stats.folded++;
                    (0, utils_1.incrementCounter)(stats.foldedByType, node.event.type);
                    (0, utils_1.incrementCounter)(stats.foldedByOperation, node.event.operation);
                    if (bounds.includeDebugMetadata) {
                        stats.approxBytesSaved += (0, utils_1.estimateEventHeavyBytes)(node.event);
                    }
                    const newOrphans = (0, reparenting_1.reparentKeptChildren)(node, config);
                    orphanedNodes = orphanedNodes.concat(newOrphans);
                    (0, summary_1.addToParentSummary)(node, config);
                }
                else {
                    // ROOT: can't fold, keep as context
                    node.kept = true;
                    stats.kept++;
                    if (bounds.includeDebugMetadata) {
                        (0, utils_1.appendCheckpointBounded)(node.event, config, {
                            name: 'noiseReduction.contextRoot',
                            ts: Date.now(),
                            data: {
                                reason: 'Root context for hard signal (has error in subtree)',
                            },
                        });
                    }
                }
            }
            else {
                // No hard signal OR below minLevel - drop as intended
                node.kept = false;
                stats.dropped++;
                (0, utils_1.incrementCounter)(stats.droppedByType, node.event.type);
                (0, utils_1.incrementCounter)(stats.droppedByOperation, node.event.operation);
                if (bounds.includeDebugMetadata) {
                    stats.approxBytesSaved += (0, utils_1.estimateEventHeavyBytes)(node.event);
                }
                const newOrphans = (0, reparenting_1.reparentKeptChildren)(node, config);
                orphanedNodes = orphanedNodes.concat(newOrphans);
                (0, summary_1.addToParentSummary)(node, config);
            }
            break;
        case 'fold':
            if (node.parent) {
                // Always fold into parent (even if parent will be dropped later)
                // The parent's subsequent processing will see 'hasAbsorbedData=true' and keep itself
                (0, folding_1.foldIntoParent)(node, config);
                node.kept = false;
                stats.folded++;
                (0, utils_1.incrementCounter)(stats.foldedByType, node.event.type);
                (0, utils_1.incrementCounter)(stats.foldedByOperation, node.event.operation);
                if (bounds.includeDebugMetadata) {
                    stats.approxBytesSaved += (0, utils_1.estimateEventHeavyBytes)(node.event);
                }
                // CRITICAL: Reparent any kept children before dropping
                // When a node is folded, its children become orphaned unless reparented
                const newOrphans = (0, reparenting_1.reparentKeptChildren)(node, config);
                orphanedNodes = orphanedNodes.concat(newOrphans);
                (0, summary_1.addToParentSummary)(node, config);
            }
            else {
                // No parent - cannot fold, must keep
                node.kept = true;
                stats.kept++;
            }
            break;
        case 'aggregate':
            if (node.parent) {
                // Always aggregate into parent
                (0, aggregation_1.aggregateIntoParent)(node, config);
                node.kept = false;
                stats.aggregated++;
                if (bounds.includeDebugMetadata) {
                    stats.approxBytesSaved += (0, utils_1.estimateEventHeavyBytes)(node.event);
                }
                // CRITICAL: Reparent any kept children before dropping
                // When a node is aggregated, its children become orphaned unless reparented
                const newOrphans = (0, reparenting_1.reparentKeptChildren)(node, config);
                orphanedNodes = orphanedNodes.concat(newOrphans);
                (0, summary_1.addToParentSummary)(node, config);
            }
            else {
                // No parent - cannot aggregate, must keep
                node.kept = true;
                stats.kept++;
            }
            break;
        case 'downgrade':
            node.kept = true;
            stats.downgraded++;
            (0, utils_1.stripHeavyFields)(node.event);
            if (bounds.includeDebugMetadata) {
                stats.approxBytesSaved += (0, utils_1.estimateEventHeavyBytes)(node.event);
            }
            break;
    }
    return orphanedNodes;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhbnNmb3JtZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vdHJlZS90cmFuc2Zvcm1lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7OztHQVNHOztBQWdDSCxzQ0FnSkM7QUE3S0QsdUNBQWlEO0FBRWpELG9DQUFxSjtBQUNySix5REFBd0Q7QUFDeEQsbURBQXVEO0FBQ3ZELDJEQUFnRTtBQUNoRSwyREFBaUU7QUFDakUsbURBQTJEO0FBRTNEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsU0FBZ0IsYUFBYSxDQUMzQixJQUFjLEVBQ2QsTUFBNEIsRUFDNUIsS0FBMEI7SUFFMUIsTUFBTSxNQUFNLEdBQUcsSUFBQSxpQkFBUyxFQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ2pDLElBQUksYUFBYSxHQUFlLEVBQUUsQ0FBQztJQUVuQyxpREFBaUQ7SUFDakQscUVBQXFFO0lBQ3JFLEtBQUssTUFBTSxLQUFLLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ2xDLE1BQU0sWUFBWSxHQUFHLGFBQWEsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3pELGFBQWEsR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQ3JELENBQUM7SUFFRCxrQ0FBa0M7SUFDbEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsSUFBSSxNQUFNLENBQUM7SUFFekMsUUFBUSxRQUFRLEVBQUUsQ0FBQztRQUNqQixLQUFLLE1BQU07WUFDVCxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztZQUNqQixLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDYixNQUFNO1FBRVIsS0FBSyxNQUFNO1lBQ1QsTUFBTSxlQUFlLEdBQUcsTUFBTSxDQUFDLFFBQVEsSUFBSSwwQkFBa0IsQ0FBQyxJQUFJLENBQUM7WUFDbkUsTUFBTSxTQUFTLEdBQUcsSUFBQSwyQkFBYSxFQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDbEQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLE1BQU0sS0FBSyxTQUFTLENBQUM7WUFDNUMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsTUFBTSxLQUFLLFVBQVUsQ0FBQztZQUV0RCw2RkFBNkY7WUFDN0Ysc0VBQXNFO1lBQ3RFLElBQUksQ0FBQyxrQkFBa0IsSUFBSSxJQUFJLENBQUMsc0JBQXNCLElBQUksU0FBUyxJQUFJLGVBQWUsRUFBRSxDQUFDO2dCQUN2RiwrREFBK0Q7Z0JBQy9ELG1EQUFtRDtnQkFDbkQsSUFBSSxTQUFTLEVBQUUsQ0FBQztvQkFDZCxJQUFJLENBQUMsSUFBSSxHQUFHLEtBQUssQ0FBQztvQkFDbEIsSUFBQSx3QkFBYyxFQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztvQkFDN0IsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDO29CQUNmLElBQUEsd0JBQWdCLEVBQUMsS0FBSyxDQUFDLFlBQVksRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO29CQUN0RCxJQUFBLHdCQUFnQixFQUFDLEtBQUssQ0FBQyxpQkFBaUIsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO29CQUVoRSxJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO3dCQUNoQyxLQUFLLENBQUMsZ0JBQWdCLElBQUksSUFBQSwrQkFBdUIsRUFBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7b0JBQ2hFLENBQUM7b0JBRUQsTUFBTSxVQUFVLEdBQUcsSUFBQSxrQ0FBb0IsRUFBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUM7b0JBQ3RELGFBQWEsR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDO29CQUNqRCxJQUFBLDRCQUFrQixFQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztnQkFDbkMsQ0FBQztxQkFBTSxDQUFDO29CQUNOLG9DQUFvQztvQkFDcEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7b0JBQ2pCLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztvQkFFYixJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO3dCQUNoQyxJQUFBLCtCQUF1QixFQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFOzRCQUMxQyxJQUFJLEVBQUUsNEJBQTRCOzRCQUNsQyxFQUFFLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTs0QkFDZCxJQUFJLEVBQUU7Z0NBQ0osTUFBTSxFQUFFLHFEQUFxRDs2QkFDOUQ7eUJBQ0YsQ0FBQyxDQUFDO29CQUNMLENBQUM7Z0JBQ0gsQ0FBQztZQUNILENBQUM7aUJBQU0sQ0FBQztnQkFDTixzREFBc0Q7Z0JBQ3RELElBQUksQ0FBQyxJQUFJLEdBQUcsS0FBSyxDQUFDO2dCQUNsQixLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ2hCLElBQUEsd0JBQWdCLEVBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUN2RCxJQUFBLHdCQUFnQixFQUFDLEtBQUssQ0FBQyxrQkFBa0IsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUVqRSxJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO29CQUNoQyxLQUFLLENBQUMsZ0JBQWdCLElBQUksSUFBQSwrQkFBdUIsRUFBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQ2hFLENBQUM7Z0JBRUQsTUFBTSxVQUFVLEdBQUcsSUFBQSxrQ0FBb0IsRUFBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUM7Z0JBQ3RELGFBQWEsR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDO2dCQUNqRCxJQUFBLDRCQUFrQixFQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztZQUNuQyxDQUFDO1lBQ0QsTUFBTTtRQUVSLEtBQUssTUFBTTtZQUNULElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUNoQixpRUFBaUU7Z0JBQ2pFLHFGQUFxRjtnQkFDckYsSUFBQSx3QkFBYyxFQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztnQkFDN0IsSUFBSSxDQUFDLElBQUksR0FBRyxLQUFLLENBQUM7Z0JBQ2xCLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDZixJQUFBLHdCQUFnQixFQUFDLEtBQUssQ0FBQyxZQUFZLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDdEQsSUFBQSx3QkFBZ0IsRUFBQyxLQUFLLENBQUMsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFFaEUsSUFBSSxNQUFNLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztvQkFDaEMsS0FBSyxDQUFDLGdCQUFnQixJQUFJLElBQUEsK0JBQXVCLEVBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUNoRSxDQUFDO2dCQUVELHVEQUF1RDtnQkFDdkQsd0VBQXdFO2dCQUN4RSxNQUFNLFVBQVUsR0FBRyxJQUFBLGtDQUFvQixFQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztnQkFDdEQsYUFBYSxHQUFHLGFBQWEsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUM7Z0JBRWpELElBQUEsNEJBQWtCLEVBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBQ25DLENBQUM7aUJBQU0sQ0FBQztnQkFDTixxQ0FBcUM7Z0JBQ3JDLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDO2dCQUNqQixLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDZixDQUFDO1lBQ0QsTUFBTTtRQUVSLEtBQUssV0FBVztZQUNkLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUNoQiwrQkFBK0I7Z0JBQy9CLElBQUEsaUNBQW1CLEVBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUNsQyxJQUFJLENBQUMsSUFBSSxHQUFHLEtBQUssQ0FBQztnQkFDbEIsS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUVuQixJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO29CQUNoQyxLQUFLLENBQUMsZ0JBQWdCLElBQUksSUFBQSwrQkFBdUIsRUFBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQ2hFLENBQUM7Z0JBRUQsdURBQXVEO2dCQUN2RCw0RUFBNEU7Z0JBQzVFLE1BQU0sVUFBVSxHQUFHLElBQUEsa0NBQW9CLEVBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUN0RCxhQUFhLEdBQUcsYUFBYSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQztnQkFFakQsSUFBQSw0QkFBa0IsRUFBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUM7WUFDbkMsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLDBDQUEwQztnQkFDMUMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7Z0JBQ2pCLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNmLENBQUM7WUFDRCxNQUFNO1FBRVIsS0FBSyxXQUFXO1lBQ2QsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7WUFDakIsS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ25CLElBQUEsd0JBQWdCLEVBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRTdCLElBQUksTUFBTSxDQUFDLG9CQUFvQixFQUFFLENBQUM7Z0JBQ2hDLEtBQUssQ0FBQyxnQkFBZ0IsSUFBSSxJQUFBLCtCQUF1QixFQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNoRSxDQUFDO1lBQ0QsTUFBTTtJQUNWLENBQUM7SUFFRCxPQUFPLGFBQWEsQ0FBQztBQUN2QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBQaGFzZSAzOiBUcmFuc2Zvcm0gdHJlZSBiYXNlZCBvbiBub2lzZSByZWR1Y3Rpb24gZGVjaXNpb25zLlxuICogXG4gKiBBcHBsaWVzIG5vaXNlIHJlZHVjdGlvbiBkZWNpc2lvbnMgdG8gdGhlIHRyZWUsIHBlcmZvcm1pbmc6XG4gKiAtIERyb3BwaW5nIG5vZGVzXG4gKiAtIEZvbGRpbmcgbm9kZXMgaW50byBwYXJlbnRzXG4gKiAtIEFnZ3JlZ2F0aW5nIG5vZGVzIGludG8gcGFyZW50c1xuICogLSBSZXBhcmVudGluZyBvcnBoYW5lZCBjaGlsZHJlblxuICogLSBUcmFja2luZyBzdGF0aXN0aWNzXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBOb2lzZVJlZHVjdGlvbkNvbmZpZywgT2JzZXJ2YWJpbGl0eUV2ZW50IH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuaW1wb3J0IHR5cGUgeyBUcmVlTm9kZSwgTm9pc2VSZWR1Y3Rpb25TdGF0cywgTm9pc2VSZWR1Y3Rpb25EYXRhIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgZXN0aW1hdGVFdmVudEhlYXZ5Qnl0ZXMsIGluY3JlbWVudENvdW50ZXIsIHN0cmlwSGVhdnlGaWVsZHMsIGdldEJvdW5kcywgZW5zdXJlU3BhbkRhdGEsIGFwcGVuZENoZWNrcG9pbnRCb3VuZGVkLCBpc1JlY29yZCB9IGZyb20gJy4uL3V0aWxzJztcbmltcG9ydCB7IHN0cmluZ1RvTGV2ZWwgfSBmcm9tICcuLi8uLi91dGlscy9sZXZlbC11dGlscyc7XG5pbXBvcnQgeyBmb2xkSW50b1BhcmVudCB9IGZyb20gJy4uL29wZXJhdGlvbnMvZm9sZGluZyc7XG5pbXBvcnQgeyBhZ2dyZWdhdGVJbnRvUGFyZW50IH0gZnJvbSAnLi4vb3BlcmF0aW9ucy9hZ2dyZWdhdGlvbic7XG5pbXBvcnQgeyByZXBhcmVudEtlcHRDaGlsZHJlbiB9IGZyb20gJy4uL29wZXJhdGlvbnMvcmVwYXJlbnRpbmcnO1xuaW1wb3J0IHsgYWRkVG9QYXJlbnRTdW1tYXJ5IH0gZnJvbSAnLi4vb3BlcmF0aW9ucy9zdW1tYXJ5JztcblxuLyoqXG4gKiBUcmFuc2Zvcm0gdHJlZSBieSBhcHBseWluZyBub2lzZSByZWR1Y3Rpb24gZGVjaXNpb25zLlxuICogXG4gKiBVc2VzIHBvc3Qtb3JkZXIgdHJhdmVyc2FsIChjaGlsZHJlbiBmaXJzdCkgdG8gZW5zdXJlIGNoaWxkIHN0YXRlc1xuICogYXJlIGtub3duIGJlZm9yZSBwYXJlbnQgZGVjaXNpb25zIGFyZSBhcHBsaWVkLiBUaGlzIGVuYWJsZXMgbmF0dXJhbFxuICogcmVwYXJlbnRpbmcgYW5kIHByZXZlbnRzIGZvcmNlLWtlZXAgYnVncy5cbiAqIFxuICogRm9yIGVhY2ggbm9kZTpcbiAqIDEuIFRyYW5zZm9ybSBhbGwgY2hpbGRyZW4gZmlyc3QgKHBvc3Qtb3JkZXIpXG4gKiAyLiBBcHBseSB0aGlzIG5vZGUncyBkZWNpc2lvbiAoa2VlcC9kcm9wL2ZvbGQvYWdncmVnYXRlL2Rvd25ncmFkZSlcbiAqIDMuIEhhbmRsZSBzaWRlIGVmZmVjdHMgKHJlcGFyZW50aW5nLCBzdW1tYXJpZXMsIHN0YXRpc3RpY3MpXG4gKiBcbiAqIFRpbWUgY29tcGxleGl0eTogTyhuKSB3aGVyZSBuID0gbm9kZXNcbiAqIFNwYWNlIGNvbXBsZXhpdHk6IE8oMSkgYWRkaXRpb25hbCAobW9kaWZpZXMgdHJlZSBpbi1wbGFjZSlcbiAqIFxuICogQHBhcmFtIG5vZGUgLSBDdXJyZW50IG5vZGUgdG8gdHJhbnNmb3JtXG4gKiBAcGFyYW0gY29uZmlnIC0gTm9pc2UgcmVkdWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBzdGF0cyAtIFN0YXRpc3RpY3MgYWNjdW11bGF0b3JcbiAqIEByZXR1cm5zIEFycmF5IG9mIG9ycGhhbmVkIG5vZGVzIChjaGlsZHJlbiB0aGF0IGJlY2FtZSByb290cylcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRyYW5zZm9ybVRyZWUoXG4gIG5vZGU6IFRyZWVOb2RlLFxuICBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnLFxuICBzdGF0czogTm9pc2VSZWR1Y3Rpb25TdGF0c1xuKTogVHJlZU5vZGVbXSB7XG4gIGNvbnN0IGJvdW5kcyA9IGdldEJvdW5kcyhjb25maWcpO1xuICBsZXQgb3JwaGFuZWROb2RlczogVHJlZU5vZGVbXSA9IFtdO1xuXG4gIC8vIFBvc3Qtb3JkZXIgdHJhdmVyc2FsOiB0cmFuc2Zvcm0gY2hpbGRyZW4gZmlyc3RcbiAgLy8gVGhpcyBlbnN1cmVzIHdlIGtub3cgY2hpbGQgc3RhdGVzIGJlZm9yZSBhcHBseWluZyBwYXJlbnQgZGVjaXNpb25zXG4gIGZvciAoY29uc3QgY2hpbGQgb2Ygbm9kZS5jaGlsZHJlbikge1xuICAgIGNvbnN0IGNoaWxkT3JwaGFucyA9IHRyYW5zZm9ybVRyZWUoY2hpbGQsIGNvbmZpZywgc3RhdHMpO1xuICAgIG9ycGhhbmVkTm9kZXMgPSBvcnBoYW5lZE5vZGVzLmNvbmNhdChjaGlsZE9ycGhhbnMpO1xuICB9XG5cbiAgLy8gTm93IGFwcGx5IGRlY2lzaW9uIHRvIFRISVMgbm9kZVxuICBjb25zdCBkZWNpc2lvbiA9IG5vZGUuZGVjaXNpb24gPz8gJ2tlZXAnO1xuXG4gIHN3aXRjaCAoZGVjaXNpb24pIHtcbiAgICBjYXNlICdrZWVwJzpcbiAgICAgIG5vZGUua2VwdCA9IHRydWU7XG4gICAgICBzdGF0cy5rZXB0Kys7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ2Ryb3AnOlxuICAgICAgY29uc3QgbWluQ29udGV4dExldmVsID0gY29uZmlnLm1pbkxldmVsID8/IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPO1xuICAgICAgY29uc3Qgbm9kZUxldmVsID0gc3RyaW5nVG9MZXZlbChub2RlLmV2ZW50LmxldmVsKTtcbiAgICAgIGNvbnN0IGhhc1BhcmVudCA9IG5vZGUucGFyZW50ICE9PSB1bmRlZmluZWQ7XG4gICAgICBjb25zdCBpc0V4cGxpY2l0T3ZlcnJpZGUgPSBub2RlLnJ1bGVJZCA9PT0gJ292ZXJyaWRlJztcblxuICAgICAgLy8gQ29udGV4dCBwcmVzZXJ2YXRpb246IHVwZ3JhZGUgRFJPUCB0byBGT0xEIGlmIHRoaXMgbm9kZSBwcm92aWRlcyBjb250ZXh0IGZvciBhIGhhcmQgc2lnbmFsXG4gICAgICAvLyBFWENFUFQgZm9yIGV4cGxpY2l0IG92ZXJyaWRlcyAoY2FwdHVyZS5ub2lzZSkgd2hpY2ggbXVzdCBiZSBob25vcmVkXG4gICAgICBpZiAoIWlzRXhwbGljaXRPdmVycmlkZSAmJiBub2RlLmhhc0hhcmRTaWduYWxJblN1YnRyZWUgJiYgbm9kZUxldmVsID49IG1pbkNvbnRleHRMZXZlbCkge1xuICAgICAgICAvLyBIYXMgaGFyZCBzaWduYWwgaW4gc3VidHJlZSBBTkQgbm9kZSBtZWV0cyBtaW5MZXZlbCB0aHJlc2hvbGRcbiAgICAgICAgLy8gQVVUT01BVElDIFVQR1JBREU6IERST1Ag4oaSIEZPTEQgKG9yIEtFRVAgaWYgcm9vdClcbiAgICAgICAgaWYgKGhhc1BhcmVudCkge1xuICAgICAgICAgIG5vZGUua2VwdCA9IGZhbHNlO1xuICAgICAgICAgIGZvbGRJbnRvUGFyZW50KG5vZGUsIGNvbmZpZyk7XG4gICAgICAgICAgc3RhdHMuZm9sZGVkKys7XG4gICAgICAgICAgaW5jcmVtZW50Q291bnRlcihzdGF0cy5mb2xkZWRCeVR5cGUsIG5vZGUuZXZlbnQudHlwZSk7XG4gICAgICAgICAgaW5jcmVtZW50Q291bnRlcihzdGF0cy5mb2xkZWRCeU9wZXJhdGlvbiwgbm9kZS5ldmVudC5vcGVyYXRpb24pO1xuXG4gICAgICAgICAgaWYgKGJvdW5kcy5pbmNsdWRlRGVidWdNZXRhZGF0YSkge1xuICAgICAgICAgICAgc3RhdHMuYXBwcm94Qnl0ZXNTYXZlZCArPSBlc3RpbWF0ZUV2ZW50SGVhdnlCeXRlcyhub2RlLmV2ZW50KTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBuZXdPcnBoYW5zID0gcmVwYXJlbnRLZXB0Q2hpbGRyZW4obm9kZSwgY29uZmlnKTtcbiAgICAgICAgICBvcnBoYW5lZE5vZGVzID0gb3JwaGFuZWROb2Rlcy5jb25jYXQobmV3T3JwaGFucyk7XG4gICAgICAgICAgYWRkVG9QYXJlbnRTdW1tYXJ5KG5vZGUsIGNvbmZpZyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gUk9PVDogY2FuJ3QgZm9sZCwga2VlcCBhcyBjb250ZXh0XG4gICAgICAgICAgbm9kZS5rZXB0ID0gdHJ1ZTtcbiAgICAgICAgICBzdGF0cy5rZXB0Kys7XG5cbiAgICAgICAgICBpZiAoYm91bmRzLmluY2x1ZGVEZWJ1Z01ldGFkYXRhKSB7XG4gICAgICAgICAgICBhcHBlbmRDaGVja3BvaW50Qm91bmRlZChub2RlLmV2ZW50LCBjb25maWcsIHtcbiAgICAgICAgICAgICAgbmFtZTogJ25vaXNlUmVkdWN0aW9uLmNvbnRleHRSb290JyxcbiAgICAgICAgICAgICAgdHM6IERhdGUubm93KCksXG4gICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICByZWFzb246ICdSb290IGNvbnRleHQgZm9yIGhhcmQgc2lnbmFsIChoYXMgZXJyb3IgaW4gc3VidHJlZSknLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBObyBoYXJkIHNpZ25hbCBPUiBiZWxvdyBtaW5MZXZlbCAtIGRyb3AgYXMgaW50ZW5kZWRcbiAgICAgICAgbm9kZS5rZXB0ID0gZmFsc2U7XG4gICAgICAgIHN0YXRzLmRyb3BwZWQrKztcbiAgICAgICAgaW5jcmVtZW50Q291bnRlcihzdGF0cy5kcm9wcGVkQnlUeXBlLCBub2RlLmV2ZW50LnR5cGUpO1xuICAgICAgICBpbmNyZW1lbnRDb3VudGVyKHN0YXRzLmRyb3BwZWRCeU9wZXJhdGlvbiwgbm9kZS5ldmVudC5vcGVyYXRpb24pO1xuXG4gICAgICAgIGlmIChib3VuZHMuaW5jbHVkZURlYnVnTWV0YWRhdGEpIHtcbiAgICAgICAgICBzdGF0cy5hcHByb3hCeXRlc1NhdmVkICs9IGVzdGltYXRlRXZlbnRIZWF2eUJ5dGVzKG5vZGUuZXZlbnQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbmV3T3JwaGFucyA9IHJlcGFyZW50S2VwdENoaWxkcmVuKG5vZGUsIGNvbmZpZyk7XG4gICAgICAgIG9ycGhhbmVkTm9kZXMgPSBvcnBoYW5lZE5vZGVzLmNvbmNhdChuZXdPcnBoYW5zKTtcbiAgICAgICAgYWRkVG9QYXJlbnRTdW1tYXJ5KG5vZGUsIGNvbmZpZyk7XG4gICAgICB9XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ2ZvbGQnOlxuICAgICAgaWYgKG5vZGUucGFyZW50KSB7XG4gICAgICAgIC8vIEFsd2F5cyBmb2xkIGludG8gcGFyZW50IChldmVuIGlmIHBhcmVudCB3aWxsIGJlIGRyb3BwZWQgbGF0ZXIpXG4gICAgICAgIC8vIFRoZSBwYXJlbnQncyBzdWJzZXF1ZW50IHByb2Nlc3Npbmcgd2lsbCBzZWUgJ2hhc0Fic29yYmVkRGF0YT10cnVlJyBhbmQga2VlcCBpdHNlbGZcbiAgICAgICAgZm9sZEludG9QYXJlbnQobm9kZSwgY29uZmlnKTtcbiAgICAgICAgbm9kZS5rZXB0ID0gZmFsc2U7XG4gICAgICAgIHN0YXRzLmZvbGRlZCsrO1xuICAgICAgICBpbmNyZW1lbnRDb3VudGVyKHN0YXRzLmZvbGRlZEJ5VHlwZSwgbm9kZS5ldmVudC50eXBlKTtcbiAgICAgICAgaW5jcmVtZW50Q291bnRlcihzdGF0cy5mb2xkZWRCeU9wZXJhdGlvbiwgbm9kZS5ldmVudC5vcGVyYXRpb24pO1xuXG4gICAgICAgIGlmIChib3VuZHMuaW5jbHVkZURlYnVnTWV0YWRhdGEpIHtcbiAgICAgICAgICBzdGF0cy5hcHByb3hCeXRlc1NhdmVkICs9IGVzdGltYXRlRXZlbnRIZWF2eUJ5dGVzKG5vZGUuZXZlbnQpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ1JJVElDQUw6IFJlcGFyZW50IGFueSBrZXB0IGNoaWxkcmVuIGJlZm9yZSBkcm9wcGluZ1xuICAgICAgICAvLyBXaGVuIGEgbm9kZSBpcyBmb2xkZWQsIGl0cyBjaGlsZHJlbiBiZWNvbWUgb3JwaGFuZWQgdW5sZXNzIHJlcGFyZW50ZWRcbiAgICAgICAgY29uc3QgbmV3T3JwaGFucyA9IHJlcGFyZW50S2VwdENoaWxkcmVuKG5vZGUsIGNvbmZpZyk7XG4gICAgICAgIG9ycGhhbmVkTm9kZXMgPSBvcnBoYW5lZE5vZGVzLmNvbmNhdChuZXdPcnBoYW5zKTtcblxuICAgICAgICBhZGRUb1BhcmVudFN1bW1hcnkobm9kZSwgY29uZmlnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIE5vIHBhcmVudCAtIGNhbm5vdCBmb2xkLCBtdXN0IGtlZXBcbiAgICAgICAgbm9kZS5rZXB0ID0gdHJ1ZTtcbiAgICAgICAgc3RhdHMua2VwdCsrO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdhZ2dyZWdhdGUnOlxuICAgICAgaWYgKG5vZGUucGFyZW50KSB7XG4gICAgICAgIC8vIEFsd2F5cyBhZ2dyZWdhdGUgaW50byBwYXJlbnRcbiAgICAgICAgYWdncmVnYXRlSW50b1BhcmVudChub2RlLCBjb25maWcpO1xuICAgICAgICBub2RlLmtlcHQgPSBmYWxzZTtcbiAgICAgICAgc3RhdHMuYWdncmVnYXRlZCsrO1xuXG4gICAgICAgIGlmIChib3VuZHMuaW5jbHVkZURlYnVnTWV0YWRhdGEpIHtcbiAgICAgICAgICBzdGF0cy5hcHByb3hCeXRlc1NhdmVkICs9IGVzdGltYXRlRXZlbnRIZWF2eUJ5dGVzKG5vZGUuZXZlbnQpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ1JJVElDQUw6IFJlcGFyZW50IGFueSBrZXB0IGNoaWxkcmVuIGJlZm9yZSBkcm9wcGluZ1xuICAgICAgICAvLyBXaGVuIGEgbm9kZSBpcyBhZ2dyZWdhdGVkLCBpdHMgY2hpbGRyZW4gYmVjb21lIG9ycGhhbmVkIHVubGVzcyByZXBhcmVudGVkXG4gICAgICAgIGNvbnN0IG5ld09ycGhhbnMgPSByZXBhcmVudEtlcHRDaGlsZHJlbihub2RlLCBjb25maWcpO1xuICAgICAgICBvcnBoYW5lZE5vZGVzID0gb3JwaGFuZWROb2Rlcy5jb25jYXQobmV3T3JwaGFucyk7XG5cbiAgICAgICAgYWRkVG9QYXJlbnRTdW1tYXJ5KG5vZGUsIGNvbmZpZyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBObyBwYXJlbnQgLSBjYW5ub3QgYWdncmVnYXRlLCBtdXN0IGtlZXBcbiAgICAgICAgbm9kZS5rZXB0ID0gdHJ1ZTtcbiAgICAgICAgc3RhdHMua2VwdCsrO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdkb3duZ3JhZGUnOlxuICAgICAgbm9kZS5rZXB0ID0gdHJ1ZTtcbiAgICAgIHN0YXRzLmRvd25ncmFkZWQrKztcbiAgICAgIHN0cmlwSGVhdnlGaWVsZHMobm9kZS5ldmVudCk7XG5cbiAgICAgIGlmIChib3VuZHMuaW5jbHVkZURlYnVnTWV0YWRhdGEpIHtcbiAgICAgICAgc3RhdHMuYXBwcm94Qnl0ZXNTYXZlZCArPSBlc3RpbWF0ZUV2ZW50SGVhdnlCeXRlcyhub2RlLmV2ZW50KTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICB9XG5cbiAgcmV0dXJuIG9ycGhhbmVkTm9kZXM7XG59XG4iXX0=