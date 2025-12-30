"use strict";
/**
 * Priority-based noise reduction evaluation.
 *
 * Provides explicit priority handling for noise reduction rules,
 * replacing implicit "first match wins" with explicit priority resolution.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECISION_BASE_PRIORITY = void 0;
exports.getEffectivePriority = getEffectivePriority;
exports.evaluateNoiseRules = evaluateNoiseRules;
/**
 * Base priority for each decision type.
 * Higher numbers = higher priority (harder to override).
 *
 * These priorities ensure sensible defaults:
 * - Keeping events is hard to override (high priority)
 * - Dropping events is easy to override (low priority)
 * - Aggregation/folding sit in the middle
 */
exports.DECISION_BASE_PRIORITY = {
    keep: 100,
    aggregate: 50,
    fold: 40,
    downgrade: 30,
    drop: 10,
};
/**
 * Calculate the effective priority for a rule.
 * Uses explicit priority if provided, otherwise decision's base priority.
 */
function getEffectivePriority(rule) {
    if (rule.priority !== undefined) {
        // Explicit priority must be positive
        if (rule.priority <= 0) {
            throw new Error(`Rule "${rule.id}" has invalid priority ${rule.priority}. Priority must be > 0.`);
        }
        return rule.priority;
    }
    // Use decision's base priority
    return exports.DECISION_BASE_PRIORITY[rule.decision];
}
/**
 * Evaluate all rules against an event and return the winning decision.
 *
 * Algorithm:
 * 1. Check per-event override (absolute highest priority)
 * 2. Check hard signals (errors/failures always kept unless overridden)
 * 3. Collect all matching rules (including exception evaluation)
 * 4. Sort by effective priority (highest first)
 * 5. Return the winning rule's decision
 *
 * @param event - The event to evaluate
 * @param allRules - All rules to consider (custom + builtin)
 * @param matchFn - Function to check if a match condition matches the event
 * @returns Evaluation result with full context
 */
function evaluateNoiseRules(event, allRules, matchFn) {
    // 1. Per-event override (absolute highest priority)
    if (event.capture?.noise) {
        return {
            decision: event.capture.noise.decision,
            ruleId: 'override',
            reason: event.capture.noise.reason || 'Per-event override',
            priority: Infinity,
            matchedRulesCount: 0,
        };
    }
    // 2. Hard signals always kept (unless explicitly overridden)
    const isHardSignal = event.level === 'error'
        || event.level === 'critical'
        || event.success === false
        || Boolean(event.error);
    if (isHardSignal) {
        return {
            decision: 'keep',
            ruleId: 'builtin.hard_signal',
            reason: 'Hard signal (error/critical/failure) always kept',
            priority: 1000,
            matchedRulesCount: 0,
        };
    }
    // 3. Collect all matching rules
    const matchedRules = [];
    for (const rule of allRules) {
        // Check main match condition
        if (!matchFn(event, rule.match)) {
            continue;
        }
        // Check exception conditions - if ANY exception matches, skip this rule
        if (rule.except && rule.except.length > 0) {
            const hasMatchingException = rule.except.some(exc => matchFn(event, exc));
            if (hasMatchingException) {
                continue;
            }
        }
        // Rule matched and no exceptions - add to candidates
        matchedRules.push({
            rule,
            effectivePriority: getEffectivePriority(rule),
        });
    }
    // 4. No matching rules = keep by default
    if (matchedRules.length === 0) {
        return {
            decision: 'keep',
            ruleId: 'default',
            reason: 'No matching rules, keep by default',
            priority: 0,
            matchedRulesCount: 0,
        };
    }
    // 5. Sort by priority (highest first) and select winner
    matchedRules.sort((a, b) => b.effectivePriority - a.effectivePriority);
    const winner = matchedRules[0];
    return {
        decision: winner.rule.decision,
        ruleId: winner.rule.id,
        reason: winner.rule.reason || `Matched rule: ${winner.rule.id}`,
        priority: winner.effectivePriority,
        matchedRulesCount: matchedRules.length,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJpb3JpdHkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vcHJpb3JpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFxREgsb0RBV0M7QUFpQkQsZ0RBOEVDO0FBM0pEOzs7Ozs7OztHQVFHO0FBQ1UsUUFBQSxzQkFBc0IsR0FBNEM7SUFDN0UsSUFBSSxFQUFFLEdBQUc7SUFDVCxTQUFTLEVBQUUsRUFBRTtJQUNiLElBQUksRUFBRSxFQUFFO0lBQ1IsU0FBUyxFQUFFLEVBQUU7SUFDYixJQUFJLEVBQUUsRUFBRTtDQUNBLENBQUM7QUE4Qlg7OztHQUdHO0FBQ0gsU0FBZ0Isb0JBQW9CLENBQUMsSUFBZTtJQUNsRCxJQUFJLElBQUksQ0FBQyxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDaEMscUNBQXFDO1FBQ3JDLElBQUksSUFBSSxDQUFDLFFBQVEsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUN2QixNQUFNLElBQUksS0FBSyxDQUFDLFNBQVMsSUFBSSxDQUFDLEVBQUUsMEJBQTBCLElBQUksQ0FBQyxRQUFRLHlCQUF5QixDQUFDLENBQUM7UUFDcEcsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQztJQUN2QixDQUFDO0lBRUQsK0JBQStCO0lBQy9CLE9BQU8sOEJBQXNCLENBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBRSxDQUFDO0FBQ2pELENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7R0FjRztBQUNILFNBQWdCLGtCQUFrQixDQUNoQyxLQUF5QixFQUN6QixRQUE4QixFQUM5QixPQUE0RTtJQUU1RSxvREFBb0Q7SUFDcEQsSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLEtBQUssRUFBRSxDQUFDO1FBQ3pCLE9BQU87WUFDTCxRQUFRLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsUUFBUTtZQUN0QyxNQUFNLEVBQUUsVUFBVTtZQUNsQixNQUFNLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsTUFBTSxJQUFJLG9CQUFvQjtZQUMxRCxRQUFRLEVBQUUsUUFBUTtZQUNsQixpQkFBaUIsRUFBRSxDQUFDO1NBQ3JCLENBQUM7SUFDSixDQUFDO0lBRUQsNkRBQTZEO0lBQzdELE1BQU0sWUFBWSxHQUFHLEtBQUssQ0FBQyxLQUFLLEtBQUssT0FBTztXQUN2QyxLQUFLLENBQUMsS0FBSyxLQUFLLFVBQVU7V0FDMUIsS0FBSyxDQUFDLE9BQU8sS0FBSyxLQUFLO1dBQ3ZCLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7SUFFMUIsSUFBSSxZQUFZLEVBQUUsQ0FBQztRQUNqQixPQUFPO1lBQ0wsUUFBUSxFQUFFLE1BQU07WUFDaEIsTUFBTSxFQUFFLHFCQUFxQjtZQUM3QixNQUFNLEVBQUUsa0RBQWtEO1lBQzFELFFBQVEsRUFBRSxJQUFJO1lBQ2QsaUJBQWlCLEVBQUUsQ0FBQztTQUNyQixDQUFDO0lBQ0osQ0FBQztJQUVELGdDQUFnQztJQUNoQyxNQUFNLFlBQVksR0FBa0IsRUFBRSxDQUFDO0lBRXZDLEtBQUssTUFBTSxJQUFJLElBQUksUUFBUSxFQUFFLENBQUM7UUFDNUIsNkJBQTZCO1FBQzdCLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ2hDLFNBQVM7UUFDWCxDQUFDO1FBRUQsd0VBQXdFO1FBQ3hFLElBQUksSUFBSSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMxQyxNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQzFFLElBQUksb0JBQW9CLEVBQUUsQ0FBQztnQkFDekIsU0FBUztZQUNYLENBQUM7UUFDSCxDQUFDO1FBRUQscURBQXFEO1FBQ3JELFlBQVksQ0FBQyxJQUFJLENBQUM7WUFDaEIsSUFBSTtZQUNKLGlCQUFpQixFQUFFLG9CQUFvQixDQUFDLElBQUksQ0FBQztTQUM5QyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQseUNBQXlDO0lBQ3pDLElBQUksWUFBWSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUM5QixPQUFPO1lBQ0wsUUFBUSxFQUFFLE1BQU07WUFDaEIsTUFBTSxFQUFFLFNBQVM7WUFDakIsTUFBTSxFQUFFLG9DQUFvQztZQUM1QyxRQUFRLEVBQUUsQ0FBQztZQUNYLGlCQUFpQixFQUFFLENBQUM7U0FDckIsQ0FBQztJQUNKLENBQUM7SUFFRCx3REFBd0Q7SUFDeEQsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsR0FBRyxDQUFDLENBQUMsaUJBQWlCLENBQUMsQ0FBQztJQUN2RSxNQUFNLE1BQU0sR0FBRyxZQUFZLENBQUUsQ0FBQyxDQUFFLENBQUM7SUFFakMsT0FBTztRQUNMLFFBQVEsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVE7UUFDOUIsTUFBTSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUN0QixNQUFNLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLElBQUksaUJBQWlCLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQy9ELFFBQVEsRUFBRSxNQUFNLENBQUMsaUJBQWlCO1FBQ2xDLGlCQUFpQixFQUFFLFlBQVksQ0FBQyxNQUFNO0tBQ3ZDLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBQcmlvcml0eS1iYXNlZCBub2lzZSByZWR1Y3Rpb24gZXZhbHVhdGlvbi5cbiAqIFxuICogUHJvdmlkZXMgZXhwbGljaXQgcHJpb3JpdHkgaGFuZGxpbmcgZm9yIG5vaXNlIHJlZHVjdGlvbiBydWxlcyxcbiAqIHJlcGxhY2luZyBpbXBsaWNpdCBcImZpcnN0IG1hdGNoIHdpbnNcIiB3aXRoIGV4cGxpY2l0IHByaW9yaXR5IHJlc29sdXRpb24uXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBOb2lzZURlY2lzaW9uLCBOb2lzZVJ1bGUsIE9ic2VydmFiaWxpdHlFdmVudCB9IGZyb20gJy4uL3R5cGVzJztcblxuLyoqXG4gKiBCYXNlIHByaW9yaXR5IGZvciBlYWNoIGRlY2lzaW9uIHR5cGUuXG4gKiBIaWdoZXIgbnVtYmVycyA9IGhpZ2hlciBwcmlvcml0eSAoaGFyZGVyIHRvIG92ZXJyaWRlKS5cbiAqIFxuICogVGhlc2UgcHJpb3JpdGllcyBlbnN1cmUgc2Vuc2libGUgZGVmYXVsdHM6XG4gKiAtIEtlZXBpbmcgZXZlbnRzIGlzIGhhcmQgdG8gb3ZlcnJpZGUgKGhpZ2ggcHJpb3JpdHkpXG4gKiAtIERyb3BwaW5nIGV2ZW50cyBpcyBlYXN5IHRvIG92ZXJyaWRlIChsb3cgcHJpb3JpdHkpXG4gKiAtIEFnZ3JlZ2F0aW9uL2ZvbGRpbmcgc2l0IGluIHRoZSBtaWRkbGVcbiAqL1xuZXhwb3J0IGNvbnN0IERFQ0lTSU9OX0JBU0VfUFJJT1JJVFk6IFJlYWRvbmx5PFJlY29yZDxOb2lzZURlY2lzaW9uLCBudW1iZXI+PiA9IHtcbiAga2VlcDogMTAwLFxuICBhZ2dyZWdhdGU6IDUwLFxuICBmb2xkOiA0MCxcbiAgZG93bmdyYWRlOiAzMCxcbiAgZHJvcDogMTAsXG59IGFzIGNvbnN0O1xuXG4vKipcbiAqIFJlc3VsdCBvZiBub2lzZSByZWR1Y3Rpb24gZXZhbHVhdGlvbiB3aXRoIGZ1bGwgY29udGV4dC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBOb2lzZUV2YWx1YXRpb25SZXN1bHQge1xuICAvKiogVGhlIGRlY2lzaW9uIHRvIGFwcGx5ICovXG4gIGRlY2lzaW9uOiBOb2lzZURlY2lzaW9uO1xuXG4gIC8qKiBJRCBvZiB0aGUgcnVsZSB0aGF0IG1hZGUgdGhpcyBkZWNpc2lvbiAqL1xuICBydWxlSWQ6IHN0cmluZztcblxuICAvKiogSHVtYW4tcmVhZGFibGUgcmVhc29uIGZvciB0aGlzIGRlY2lzaW9uICovXG4gIHJlYXNvbjogc3RyaW5nO1xuXG4gIC8qKiBFZmZlY3RpdmUgcHJpb3JpdHkgb2YgdGhlIHdpbm5pbmcgcnVsZSAqL1xuICBwcmlvcml0eTogbnVtYmVyO1xuXG4gIC8qKiBUb3RhbCBudW1iZXIgb2YgcnVsZXMgdGhhdCBtYXRjaGVkIHRoaXMgZXZlbnQgKi9cbiAgbWF0Y2hlZFJ1bGVzQ291bnQ6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBJbnRlcm5hbDogTWF0Y2hlZCBydWxlIHdpdGggaXRzIGVmZmVjdGl2ZSBwcmlvcml0eS5cbiAqL1xuaW50ZXJmYWNlIE1hdGNoZWRSdWxlIHtcbiAgcnVsZTogTm9pc2VSdWxlO1xuICBlZmZlY3RpdmVQcmlvcml0eTogbnVtYmVyO1xufVxuXG4vKipcbiAqIENhbGN1bGF0ZSB0aGUgZWZmZWN0aXZlIHByaW9yaXR5IGZvciBhIHJ1bGUuXG4gKiBVc2VzIGV4cGxpY2l0IHByaW9yaXR5IGlmIHByb3ZpZGVkLCBvdGhlcndpc2UgZGVjaXNpb24ncyBiYXNlIHByaW9yaXR5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0RWZmZWN0aXZlUHJpb3JpdHkocnVsZTogTm9pc2VSdWxlKTogbnVtYmVyIHtcbiAgaWYgKHJ1bGUucHJpb3JpdHkgIT09IHVuZGVmaW5lZCkge1xuICAgIC8vIEV4cGxpY2l0IHByaW9yaXR5IG11c3QgYmUgcG9zaXRpdmVcbiAgICBpZiAocnVsZS5wcmlvcml0eSA8PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJ1bGUgXCIke3J1bGUuaWR9XCIgaGFzIGludmFsaWQgcHJpb3JpdHkgJHtydWxlLnByaW9yaXR5fS4gUHJpb3JpdHkgbXVzdCBiZSA+IDAuYCk7XG4gICAgfVxuICAgIHJldHVybiBydWxlLnByaW9yaXR5O1xuICB9XG5cbiAgLy8gVXNlIGRlY2lzaW9uJ3MgYmFzZSBwcmlvcml0eVxuICByZXR1cm4gREVDSVNJT05fQkFTRV9QUklPUklUWVsgcnVsZS5kZWNpc2lvbiBdO1xufVxuXG4vKipcbiAqIEV2YWx1YXRlIGFsbCBydWxlcyBhZ2FpbnN0IGFuIGV2ZW50IGFuZCByZXR1cm4gdGhlIHdpbm5pbmcgZGVjaXNpb24uXG4gKiBcbiAqIEFsZ29yaXRobTpcbiAqIDEuIENoZWNrIHBlci1ldmVudCBvdmVycmlkZSAoYWJzb2x1dGUgaGlnaGVzdCBwcmlvcml0eSlcbiAqIDIuIENoZWNrIGhhcmQgc2lnbmFscyAoZXJyb3JzL2ZhaWx1cmVzIGFsd2F5cyBrZXB0IHVubGVzcyBvdmVycmlkZGVuKVxuICogMy4gQ29sbGVjdCBhbGwgbWF0Y2hpbmcgcnVsZXMgKGluY2x1ZGluZyBleGNlcHRpb24gZXZhbHVhdGlvbilcbiAqIDQuIFNvcnQgYnkgZWZmZWN0aXZlIHByaW9yaXR5IChoaWdoZXN0IGZpcnN0KVxuICogNS4gUmV0dXJuIHRoZSB3aW5uaW5nIHJ1bGUncyBkZWNpc2lvblxuICogXG4gKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgdG8gZXZhbHVhdGVcbiAqIEBwYXJhbSBhbGxSdWxlcyAtIEFsbCBydWxlcyB0byBjb25zaWRlciAoY3VzdG9tICsgYnVpbHRpbilcbiAqIEBwYXJhbSBtYXRjaEZuIC0gRnVuY3Rpb24gdG8gY2hlY2sgaWYgYSBtYXRjaCBjb25kaXRpb24gbWF0Y2hlcyB0aGUgZXZlbnRcbiAqIEByZXR1cm5zIEV2YWx1YXRpb24gcmVzdWx0IHdpdGggZnVsbCBjb250ZXh0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBldmFsdWF0ZU5vaXNlUnVsZXMoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGFsbFJ1bGVzOiByZWFkb25seSBOb2lzZVJ1bGVbXSxcbiAgbWF0Y2hGbjogKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIG1hdGNoOiBOb2lzZVJ1bGVbICdtYXRjaCcgXSkgPT4gYm9vbGVhblxuKTogTm9pc2VFdmFsdWF0aW9uUmVzdWx0IHtcbiAgLy8gMS4gUGVyLWV2ZW50IG92ZXJyaWRlIChhYnNvbHV0ZSBoaWdoZXN0IHByaW9yaXR5KVxuICBpZiAoZXZlbnQuY2FwdHVyZT8ubm9pc2UpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZGVjaXNpb246IGV2ZW50LmNhcHR1cmUubm9pc2UuZGVjaXNpb24sXG4gICAgICBydWxlSWQ6ICdvdmVycmlkZScsXG4gICAgICByZWFzb246IGV2ZW50LmNhcHR1cmUubm9pc2UucmVhc29uIHx8ICdQZXItZXZlbnQgb3ZlcnJpZGUnLFxuICAgICAgcHJpb3JpdHk6IEluZmluaXR5LFxuICAgICAgbWF0Y2hlZFJ1bGVzQ291bnQ6IDAsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDIuIEhhcmQgc2lnbmFscyBhbHdheXMga2VwdCAodW5sZXNzIGV4cGxpY2l0bHkgb3ZlcnJpZGRlbilcbiAgY29uc3QgaXNIYXJkU2lnbmFsID0gZXZlbnQubGV2ZWwgPT09ICdlcnJvcidcbiAgICB8fCBldmVudC5sZXZlbCA9PT0gJ2NyaXRpY2FsJ1xuICAgIHx8IGV2ZW50LnN1Y2Nlc3MgPT09IGZhbHNlXG4gICAgfHwgQm9vbGVhbihldmVudC5lcnJvcik7XG5cbiAgaWYgKGlzSGFyZFNpZ25hbCkge1xuICAgIHJldHVybiB7XG4gICAgICBkZWNpc2lvbjogJ2tlZXAnLFxuICAgICAgcnVsZUlkOiAnYnVpbHRpbi5oYXJkX3NpZ25hbCcsXG4gICAgICByZWFzb246ICdIYXJkIHNpZ25hbCAoZXJyb3IvY3JpdGljYWwvZmFpbHVyZSkgYWx3YXlzIGtlcHQnLFxuICAgICAgcHJpb3JpdHk6IDEwMDAsXG4gICAgICBtYXRjaGVkUnVsZXNDb3VudDogMCxcbiAgICB9O1xuICB9XG5cbiAgLy8gMy4gQ29sbGVjdCBhbGwgbWF0Y2hpbmcgcnVsZXNcbiAgY29uc3QgbWF0Y2hlZFJ1bGVzOiBNYXRjaGVkUnVsZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBydWxlIG9mIGFsbFJ1bGVzKSB7XG4gICAgLy8gQ2hlY2sgbWFpbiBtYXRjaCBjb25kaXRpb25cbiAgICBpZiAoIW1hdGNoRm4oZXZlbnQsIHJ1bGUubWF0Y2gpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBleGNlcHRpb24gY29uZGl0aW9ucyAtIGlmIEFOWSBleGNlcHRpb24gbWF0Y2hlcywgc2tpcCB0aGlzIHJ1bGVcbiAgICBpZiAocnVsZS5leGNlcHQgJiYgcnVsZS5leGNlcHQubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgaGFzTWF0Y2hpbmdFeGNlcHRpb24gPSBydWxlLmV4Y2VwdC5zb21lKGV4YyA9PiBtYXRjaEZuKGV2ZW50LCBleGMpKTtcbiAgICAgIGlmIChoYXNNYXRjaGluZ0V4Y2VwdGlvbikge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSdWxlIG1hdGNoZWQgYW5kIG5vIGV4Y2VwdGlvbnMgLSBhZGQgdG8gY2FuZGlkYXRlc1xuICAgIG1hdGNoZWRSdWxlcy5wdXNoKHtcbiAgICAgIHJ1bGUsXG4gICAgICBlZmZlY3RpdmVQcmlvcml0eTogZ2V0RWZmZWN0aXZlUHJpb3JpdHkocnVsZSksXG4gICAgfSk7XG4gIH1cblxuICAvLyA0LiBObyBtYXRjaGluZyBydWxlcyA9IGtlZXAgYnkgZGVmYXVsdFxuICBpZiAobWF0Y2hlZFJ1bGVzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB7XG4gICAgICBkZWNpc2lvbjogJ2tlZXAnLFxuICAgICAgcnVsZUlkOiAnZGVmYXVsdCcsXG4gICAgICByZWFzb246ICdObyBtYXRjaGluZyBydWxlcywga2VlcCBieSBkZWZhdWx0JyxcbiAgICAgIHByaW9yaXR5OiAwLFxuICAgICAgbWF0Y2hlZFJ1bGVzQ291bnQ6IDAsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDUuIFNvcnQgYnkgcHJpb3JpdHkgKGhpZ2hlc3QgZmlyc3QpIGFuZCBzZWxlY3Qgd2lubmVyXG4gIG1hdGNoZWRSdWxlcy5zb3J0KChhLCBiKSA9PiBiLmVmZmVjdGl2ZVByaW9yaXR5IC0gYS5lZmZlY3RpdmVQcmlvcml0eSk7XG4gIGNvbnN0IHdpbm5lciA9IG1hdGNoZWRSdWxlc1sgMCBdO1xuXG4gIHJldHVybiB7XG4gICAgZGVjaXNpb246IHdpbm5lci5ydWxlLmRlY2lzaW9uLFxuICAgIHJ1bGVJZDogd2lubmVyLnJ1bGUuaWQsXG4gICAgcmVhc29uOiB3aW5uZXIucnVsZS5yZWFzb24gfHwgYE1hdGNoZWQgcnVsZTogJHt3aW5uZXIucnVsZS5pZH1gLFxuICAgIHByaW9yaXR5OiB3aW5uZXIuZWZmZWN0aXZlUHJpb3JpdHksXG4gICAgbWF0Y2hlZFJ1bGVzQ291bnQ6IG1hdGNoZWRSdWxlcy5sZW5ndGgsXG4gIH07XG59XG4iXX0=