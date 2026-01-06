"use strict";
/**
 * Priority-based noise reduction evaluation.
 *
 * Provides explicit priority handling for noise reduction rules,
 * replacing implicit "first match wins" with explicit priority resolution.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HARD_SIGNAL_PRIORITY = exports.DECISION_BASE_PRIORITY = void 0;
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
 * Priority for hard signal protection (errors, failures, critical events).
 * Rules with priority > HARD_SIGNAL_PRIORITY can override hard signal protection.
 *
 * Example: To aggregate error events, use priority: 2000
 */
exports.HARD_SIGNAL_PRIORITY = 1000;
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
    // 2. Collect all matching rules
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
    // 3. No matching rules = keep by default
    // NOTE: Hard signal protection is handled in evaluator.ts, not here
    if (matchedRules.length === 0) {
        return {
            decision: 'keep',
            ruleId: 'default',
            reason: 'No matching rules, keep by default',
            priority: 0,
            matchedRulesCount: 0,
        };
    }
    // 4. Sort by priority (highest first) and select winner
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJpb3JpdHkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vcHJpb3JpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUE2REgsb0RBV0M7QUFpQkQsZ0RBK0RDO0FBcEpEOzs7Ozs7OztHQVFHO0FBQ1UsUUFBQSxzQkFBc0IsR0FBNEM7SUFDN0UsSUFBSSxFQUFFLEdBQUc7SUFDVCxTQUFTLEVBQUUsRUFBRTtJQUNiLElBQUksRUFBRSxFQUFFO0lBQ1IsU0FBUyxFQUFFLEVBQUU7SUFDYixJQUFJLEVBQUUsRUFBRTtDQUNBLENBQUM7QUFFWDs7Ozs7R0FLRztBQUNVLFFBQUEsb0JBQW9CLEdBQUcsSUFBSSxDQUFDO0FBOEJ6Qzs7O0dBR0c7QUFDSCxTQUFnQixvQkFBb0IsQ0FBQyxJQUFlO0lBQ2xELElBQUksSUFBSSxDQUFDLFFBQVEsS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUNoQyxxQ0FBcUM7UUFDckMsSUFBSSxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ3ZCLE1BQU0sSUFBSSxLQUFLLENBQUMsU0FBUyxJQUFJLENBQUMsRUFBRSwwQkFBMEIsSUFBSSxDQUFDLFFBQVEseUJBQXlCLENBQUMsQ0FBQztRQUNwRyxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDO0lBQ3ZCLENBQUM7SUFFRCwrQkFBK0I7SUFDL0IsT0FBTyw4QkFBc0IsQ0FBRSxJQUFJLENBQUMsUUFBUSxDQUFFLENBQUM7QUFDakQsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7OztHQWNHO0FBQ0gsU0FBZ0Isa0JBQWtCLENBQ2hDLEtBQXlCLEVBQ3pCLFFBQThCLEVBQzlCLE9BQTRFO0lBRTVFLG9EQUFvRDtJQUNwRCxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLENBQUM7UUFDekIsT0FBTztZQUNMLFFBQVEsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxRQUFRO1lBQ3RDLE1BQU0sRUFBRSxVQUFVO1lBQ2xCLE1BQU0sRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxNQUFNLElBQUksb0JBQW9CO1lBQzFELFFBQVEsRUFBRSxRQUFRO1lBQ2xCLGlCQUFpQixFQUFFLENBQUM7U0FDckIsQ0FBQztJQUNKLENBQUM7SUFFRCxnQ0FBZ0M7SUFDaEMsTUFBTSxZQUFZLEdBQWtCLEVBQUUsQ0FBQztJQUV2QyxLQUFLLE1BQU0sSUFBSSxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQzVCLDZCQUE2QjtRQUM3QixJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUNoQyxTQUFTO1FBQ1gsQ0FBQztRQUVELHdFQUF3RTtRQUN4RSxJQUFJLElBQUksQ0FBQyxNQUFNLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDMUMsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQztZQUMxRSxJQUFJLG9CQUFvQixFQUFFLENBQUM7Z0JBQ3pCLFNBQVM7WUFDWCxDQUFDO1FBQ0gsQ0FBQztRQUVELHFEQUFxRDtRQUNyRCxZQUFZLENBQUMsSUFBSSxDQUFDO1lBQ2hCLElBQUk7WUFDSixpQkFBaUIsRUFBRSxvQkFBb0IsQ0FBQyxJQUFJLENBQUM7U0FDOUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELHlDQUF5QztJQUN6QyxvRUFBb0U7SUFDcEUsSUFBSSxZQUFZLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzlCLE9BQU87WUFDTCxRQUFRLEVBQUUsTUFBTTtZQUNoQixNQUFNLEVBQUUsU0FBUztZQUNqQixNQUFNLEVBQUUsb0NBQW9DO1lBQzVDLFFBQVEsRUFBRSxDQUFDO1lBQ1gsaUJBQWlCLEVBQUUsQ0FBQztTQUNyQixDQUFDO0lBQ0osQ0FBQztJQUVELHdEQUF3RDtJQUN4RCxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixHQUFHLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ3ZFLE1BQU0sTUFBTSxHQUFHLFlBQVksQ0FBRSxDQUFDLENBQUUsQ0FBQztJQUVqQyxPQUFPO1FBQ0wsUUFBUSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUTtRQUM5QixNQUFNLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFO1FBQ3RCLE1BQU0sRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sSUFBSSxpQkFBaUIsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDL0QsUUFBUSxFQUFFLE1BQU0sQ0FBQyxpQkFBaUI7UUFDbEMsaUJBQWlCLEVBQUUsWUFBWSxDQUFDLE1BQU07S0FDdkMsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFByaW9yaXR5LWJhc2VkIG5vaXNlIHJlZHVjdGlvbiBldmFsdWF0aW9uLlxuICogXG4gKiBQcm92aWRlcyBleHBsaWNpdCBwcmlvcml0eSBoYW5kbGluZyBmb3Igbm9pc2UgcmVkdWN0aW9uIHJ1bGVzLFxuICogcmVwbGFjaW5nIGltcGxpY2l0IFwiZmlyc3QgbWF0Y2ggd2luc1wiIHdpdGggZXhwbGljaXQgcHJpb3JpdHkgcmVzb2x1dGlvbi5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IE5vaXNlRGVjaXNpb24sIE5vaXNlUnVsZSwgT2JzZXJ2YWJpbGl0eUV2ZW50IH0gZnJvbSAnLi4vdHlwZXMnO1xuXG4vKipcbiAqIEJhc2UgcHJpb3JpdHkgZm9yIGVhY2ggZGVjaXNpb24gdHlwZS5cbiAqIEhpZ2hlciBudW1iZXJzID0gaGlnaGVyIHByaW9yaXR5IChoYXJkZXIgdG8gb3ZlcnJpZGUpLlxuICogXG4gKiBUaGVzZSBwcmlvcml0aWVzIGVuc3VyZSBzZW5zaWJsZSBkZWZhdWx0czpcbiAqIC0gS2VlcGluZyBldmVudHMgaXMgaGFyZCB0byBvdmVycmlkZSAoaGlnaCBwcmlvcml0eSlcbiAqIC0gRHJvcHBpbmcgZXZlbnRzIGlzIGVhc3kgdG8gb3ZlcnJpZGUgKGxvdyBwcmlvcml0eSlcbiAqIC0gQWdncmVnYXRpb24vZm9sZGluZyBzaXQgaW4gdGhlIG1pZGRsZVxuICovXG5leHBvcnQgY29uc3QgREVDSVNJT05fQkFTRV9QUklPUklUWTogUmVhZG9ubHk8UmVjb3JkPE5vaXNlRGVjaXNpb24sIG51bWJlcj4+ID0ge1xuICBrZWVwOiAxMDAsXG4gIGFnZ3JlZ2F0ZTogNTAsXG4gIGZvbGQ6IDQwLFxuICBkb3duZ3JhZGU6IDMwLFxuICBkcm9wOiAxMCxcbn0gYXMgY29uc3Q7XG5cbi8qKlxuICogUHJpb3JpdHkgZm9yIGhhcmQgc2lnbmFsIHByb3RlY3Rpb24gKGVycm9ycywgZmFpbHVyZXMsIGNyaXRpY2FsIGV2ZW50cykuXG4gKiBSdWxlcyB3aXRoIHByaW9yaXR5ID4gSEFSRF9TSUdOQUxfUFJJT1JJVFkgY2FuIG92ZXJyaWRlIGhhcmQgc2lnbmFsIHByb3RlY3Rpb24uXG4gKiBcbiAqIEV4YW1wbGU6IFRvIGFnZ3JlZ2F0ZSBlcnJvciBldmVudHMsIHVzZSBwcmlvcml0eTogMjAwMFxuICovXG5leHBvcnQgY29uc3QgSEFSRF9TSUdOQUxfUFJJT1JJVFkgPSAxMDAwO1xuXG4vKipcbiAqIFJlc3VsdCBvZiBub2lzZSByZWR1Y3Rpb24gZXZhbHVhdGlvbiB3aXRoIGZ1bGwgY29udGV4dC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBOb2lzZUV2YWx1YXRpb25SZXN1bHQge1xuICAvKiogVGhlIGRlY2lzaW9uIHRvIGFwcGx5ICovXG4gIGRlY2lzaW9uOiBOb2lzZURlY2lzaW9uO1xuXG4gIC8qKiBJRCBvZiB0aGUgcnVsZSB0aGF0IG1hZGUgdGhpcyBkZWNpc2lvbiAqL1xuICBydWxlSWQ6IHN0cmluZztcblxuICAvKiogSHVtYW4tcmVhZGFibGUgcmVhc29uIGZvciB0aGlzIGRlY2lzaW9uICovXG4gIHJlYXNvbjogc3RyaW5nO1xuXG4gIC8qKiBFZmZlY3RpdmUgcHJpb3JpdHkgb2YgdGhlIHdpbm5pbmcgcnVsZSAqL1xuICBwcmlvcml0eTogbnVtYmVyO1xuXG4gIC8qKiBUb3RhbCBudW1iZXIgb2YgcnVsZXMgdGhhdCBtYXRjaGVkIHRoaXMgZXZlbnQgKi9cbiAgbWF0Y2hlZFJ1bGVzQ291bnQ6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBJbnRlcm5hbDogTWF0Y2hlZCBydWxlIHdpdGggaXRzIGVmZmVjdGl2ZSBwcmlvcml0eS5cbiAqL1xuaW50ZXJmYWNlIE1hdGNoZWRSdWxlIHtcbiAgcnVsZTogTm9pc2VSdWxlO1xuICBlZmZlY3RpdmVQcmlvcml0eTogbnVtYmVyO1xufVxuXG4vKipcbiAqIENhbGN1bGF0ZSB0aGUgZWZmZWN0aXZlIHByaW9yaXR5IGZvciBhIHJ1bGUuXG4gKiBVc2VzIGV4cGxpY2l0IHByaW9yaXR5IGlmIHByb3ZpZGVkLCBvdGhlcndpc2UgZGVjaXNpb24ncyBiYXNlIHByaW9yaXR5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0RWZmZWN0aXZlUHJpb3JpdHkocnVsZTogTm9pc2VSdWxlKTogbnVtYmVyIHtcbiAgaWYgKHJ1bGUucHJpb3JpdHkgIT09IHVuZGVmaW5lZCkge1xuICAgIC8vIEV4cGxpY2l0IHByaW9yaXR5IG11c3QgYmUgcG9zaXRpdmVcbiAgICBpZiAocnVsZS5wcmlvcml0eSA8PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJ1bGUgXCIke3J1bGUuaWR9XCIgaGFzIGludmFsaWQgcHJpb3JpdHkgJHtydWxlLnByaW9yaXR5fS4gUHJpb3JpdHkgbXVzdCBiZSA+IDAuYCk7XG4gICAgfVxuICAgIHJldHVybiBydWxlLnByaW9yaXR5O1xuICB9XG5cbiAgLy8gVXNlIGRlY2lzaW9uJ3MgYmFzZSBwcmlvcml0eVxuICByZXR1cm4gREVDSVNJT05fQkFTRV9QUklPUklUWVsgcnVsZS5kZWNpc2lvbiBdO1xufVxuXG4vKipcbiAqIEV2YWx1YXRlIGFsbCBydWxlcyBhZ2FpbnN0IGFuIGV2ZW50IGFuZCByZXR1cm4gdGhlIHdpbm5pbmcgZGVjaXNpb24uXG4gKiBcbiAqIEFsZ29yaXRobTpcbiAqIDEuIENoZWNrIHBlci1ldmVudCBvdmVycmlkZSAoYWJzb2x1dGUgaGlnaGVzdCBwcmlvcml0eSlcbiAqIDIuIENoZWNrIGhhcmQgc2lnbmFscyAoZXJyb3JzL2ZhaWx1cmVzIGFsd2F5cyBrZXB0IHVubGVzcyBvdmVycmlkZGVuKVxuICogMy4gQ29sbGVjdCBhbGwgbWF0Y2hpbmcgcnVsZXMgKGluY2x1ZGluZyBleGNlcHRpb24gZXZhbHVhdGlvbilcbiAqIDQuIFNvcnQgYnkgZWZmZWN0aXZlIHByaW9yaXR5IChoaWdoZXN0IGZpcnN0KVxuICogNS4gUmV0dXJuIHRoZSB3aW5uaW5nIHJ1bGUncyBkZWNpc2lvblxuICogXG4gKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgdG8gZXZhbHVhdGVcbiAqIEBwYXJhbSBhbGxSdWxlcyAtIEFsbCBydWxlcyB0byBjb25zaWRlciAoY3VzdG9tICsgYnVpbHRpbilcbiAqIEBwYXJhbSBtYXRjaEZuIC0gRnVuY3Rpb24gdG8gY2hlY2sgaWYgYSBtYXRjaCBjb25kaXRpb24gbWF0Y2hlcyB0aGUgZXZlbnRcbiAqIEByZXR1cm5zIEV2YWx1YXRpb24gcmVzdWx0IHdpdGggZnVsbCBjb250ZXh0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBldmFsdWF0ZU5vaXNlUnVsZXMoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGFsbFJ1bGVzOiByZWFkb25seSBOb2lzZVJ1bGVbXSxcbiAgbWF0Y2hGbjogKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIG1hdGNoOiBOb2lzZVJ1bGVbICdtYXRjaCcgXSkgPT4gYm9vbGVhblxuKTogTm9pc2VFdmFsdWF0aW9uUmVzdWx0IHtcbiAgLy8gMS4gUGVyLWV2ZW50IG92ZXJyaWRlIChhYnNvbHV0ZSBoaWdoZXN0IHByaW9yaXR5KVxuICBpZiAoZXZlbnQuY2FwdHVyZT8ubm9pc2UpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZGVjaXNpb246IGV2ZW50LmNhcHR1cmUubm9pc2UuZGVjaXNpb24sXG4gICAgICBydWxlSWQ6ICdvdmVycmlkZScsXG4gICAgICByZWFzb246IGV2ZW50LmNhcHR1cmUubm9pc2UucmVhc29uIHx8ICdQZXItZXZlbnQgb3ZlcnJpZGUnLFxuICAgICAgcHJpb3JpdHk6IEluZmluaXR5LFxuICAgICAgbWF0Y2hlZFJ1bGVzQ291bnQ6IDAsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDIuIENvbGxlY3QgYWxsIG1hdGNoaW5nIHJ1bGVzXG4gIGNvbnN0IG1hdGNoZWRSdWxlczogTWF0Y2hlZFJ1bGVbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgcnVsZSBvZiBhbGxSdWxlcykge1xuICAgIC8vIENoZWNrIG1haW4gbWF0Y2ggY29uZGl0aW9uXG4gICAgaWYgKCFtYXRjaEZuKGV2ZW50LCBydWxlLm1hdGNoKSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgZXhjZXB0aW9uIGNvbmRpdGlvbnMgLSBpZiBBTlkgZXhjZXB0aW9uIG1hdGNoZXMsIHNraXAgdGhpcyBydWxlXG4gICAgaWYgKHJ1bGUuZXhjZXB0ICYmIHJ1bGUuZXhjZXB0Lmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGhhc01hdGNoaW5nRXhjZXB0aW9uID0gcnVsZS5leGNlcHQuc29tZShleGMgPT4gbWF0Y2hGbihldmVudCwgZXhjKSk7XG4gICAgICBpZiAoaGFzTWF0Y2hpbmdFeGNlcHRpb24pIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUnVsZSBtYXRjaGVkIGFuZCBubyBleGNlcHRpb25zIC0gYWRkIHRvIGNhbmRpZGF0ZXNcbiAgICBtYXRjaGVkUnVsZXMucHVzaCh7XG4gICAgICBydWxlLFxuICAgICAgZWZmZWN0aXZlUHJpb3JpdHk6IGdldEVmZmVjdGl2ZVByaW9yaXR5KHJ1bGUpLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gMy4gTm8gbWF0Y2hpbmcgcnVsZXMgPSBrZWVwIGJ5IGRlZmF1bHRcbiAgLy8gTk9URTogSGFyZCBzaWduYWwgcHJvdGVjdGlvbiBpcyBoYW5kbGVkIGluIGV2YWx1YXRvci50cywgbm90IGhlcmVcbiAgaWYgKG1hdGNoZWRSdWxlcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4ge1xuICAgICAgZGVjaXNpb246ICdrZWVwJyxcbiAgICAgIHJ1bGVJZDogJ2RlZmF1bHQnLFxuICAgICAgcmVhc29uOiAnTm8gbWF0Y2hpbmcgcnVsZXMsIGtlZXAgYnkgZGVmYXVsdCcsXG4gICAgICBwcmlvcml0eTogMCxcbiAgICAgIG1hdGNoZWRSdWxlc0NvdW50OiAwLFxuICAgIH07XG4gIH1cblxuICAvLyA0LiBTb3J0IGJ5IHByaW9yaXR5IChoaWdoZXN0IGZpcnN0KSBhbmQgc2VsZWN0IHdpbm5lclxuICBtYXRjaGVkUnVsZXMuc29ydCgoYSwgYikgPT4gYi5lZmZlY3RpdmVQcmlvcml0eSAtIGEuZWZmZWN0aXZlUHJpb3JpdHkpO1xuICBjb25zdCB3aW5uZXIgPSBtYXRjaGVkUnVsZXNbIDAgXTtcblxuICByZXR1cm4ge1xuICAgIGRlY2lzaW9uOiB3aW5uZXIucnVsZS5kZWNpc2lvbixcbiAgICBydWxlSWQ6IHdpbm5lci5ydWxlLmlkLFxuICAgIHJlYXNvbjogd2lubmVyLnJ1bGUucmVhc29uIHx8IGBNYXRjaGVkIHJ1bGU6ICR7d2lubmVyLnJ1bGUuaWR9YCxcbiAgICBwcmlvcml0eTogd2lubmVyLmVmZmVjdGl2ZVByaW9yaXR5LFxuICAgIG1hdGNoZWRSdWxlc0NvdW50OiBtYXRjaGVkUnVsZXMubGVuZ3RoLFxuICB9O1xufVxuIl19