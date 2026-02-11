"use strict";
/**
 * Priority-based noise reduction evaluation (v2: three-decision model).
 *
 * Provides explicit priority handling for noise reduction rules.
 * Rules are evaluated against events; highest priority match wins.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HARD_SIGNAL_PRIORITY = exports.DECISION_BASE_PRIORITY = void 0;
exports.getEffectivePriority = getEffectivePriority;
exports.evaluateNoiseRules = evaluateNoiseRules;
/**
 * Base priority for each decision type.
 * Higher numbers = higher priority (harder to override).
 *
 * - emit:   hard to override (you want to keep important events)
 * - absorb: middle ground (merge into parent)
 * - silent: easy to override (a keep/absorb rule can rescue events)
 */
exports.DECISION_BASE_PRIORITY = {
    emit: 100,
    absorb: 50,
    silent: 10,
};
/**
 * Priority for hard signal protection (errors, failures, critical events).
 * Rules with priority > HARD_SIGNAL_PRIORITY can override hard signal protection.
 *
 * Example: To absorb error events intentionally, use priority: 2000
 */
exports.HARD_SIGNAL_PRIORITY = 1000;
/**
 * Calculate the effective priority for a rule.
 * Uses explicit priority if provided, otherwise the decision's base priority.
 */
function getEffectivePriority(rule) {
    if (rule.priority !== undefined) {
        if (rule.priority <= 0) {
            throw new Error(`Rule "${rule.id}" has invalid priority ${rule.priority}. Priority must be > 0.`);
        }
        return rule.priority;
    }
    return exports.DECISION_BASE_PRIORITY[rule.decision];
}
/**
 * Evaluate all rules against an event and return the winning decision.
 *
 * Algorithm:
 * 1. Check per-event override (absolute highest priority)
 * 2. Collect all matching rules (including exception evaluation)
 * 3. Sort by effective priority (highest first)
 * 4. Return the winning rule's decision
 *
 * NOTE: Hard signal protection is handled by the caller (algorithm.ts),
 * not inside this function. This keeps evaluation pure and testable.
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
            reason: event.capture.noise.reason ?? 'Per-event override',
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
        matchedRules.push({
            rule,
            effectivePriority: getEffectivePriority(rule),
        });
    }
    // 3. No matching rules = emit by default (safe default: don't lose data)
    if (matchedRules.length === 0) {
        return {
            decision: 'emit',
            ruleId: 'default',
            reason: 'No matching rules, emit by default',
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
        reason: winner.rule.reason ?? `Matched rule: ${winner.rule.id}`,
        priority: winner.effectivePriority,
        matchedRulesCount: matchedRules.length,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJpb3JpdHkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vcHJpb3JpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFzREgsb0RBUUM7QUF5QkQsZ0RBNkRDO0FBaEpEOzs7Ozs7O0dBT0c7QUFDVSxRQUFBLHNCQUFzQixHQUE0QztJQUM3RSxJQUFJLEVBQUUsR0FBRztJQUNULE1BQU0sRUFBRSxFQUFFO0lBQ1YsTUFBTSxFQUFFLEVBQUU7Q0FDRixDQUFDO0FBRVg7Ozs7O0dBS0c7QUFDVSxRQUFBLG9CQUFvQixHQUFHLElBQUksQ0FBQztBQTBCekM7OztHQUdHO0FBQ0gsU0FBZ0Isb0JBQW9CLENBQUMsSUFBZTtJQUNsRCxJQUFJLElBQUksQ0FBQyxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDaEMsSUFBSSxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ3ZCLE1BQU0sSUFBSSxLQUFLLENBQUMsU0FBUyxJQUFJLENBQUMsRUFBRSwwQkFBMEIsSUFBSSxDQUFDLFFBQVEseUJBQXlCLENBQUMsQ0FBQztRQUNwRyxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDO0lBQ3ZCLENBQUM7SUFDRCxPQUFPLDhCQUFzQixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUMvQyxDQUFDO0FBUUQ7Ozs7Ozs7Ozs7Ozs7Ozs7R0FnQkc7QUFDSCxTQUFnQixrQkFBa0IsQ0FDaEMsS0FBeUIsRUFDekIsUUFBOEIsRUFDOUIsT0FBb0I7SUFFcEIsb0RBQW9EO0lBQ3BELElBQUksS0FBSyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQztRQUN6QixPQUFPO1lBQ0wsUUFBUSxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLFFBQVE7WUFDdEMsTUFBTSxFQUFFLFVBQVU7WUFDbEIsTUFBTSxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLE1BQU0sSUFBSSxvQkFBb0I7WUFDMUQsUUFBUSxFQUFFLFFBQVE7WUFDbEIsaUJBQWlCLEVBQUUsQ0FBQztTQUNyQixDQUFDO0lBQ0osQ0FBQztJQUVELGdDQUFnQztJQUNoQyxNQUFNLFlBQVksR0FBa0IsRUFBRSxDQUFDO0lBRXZDLEtBQUssTUFBTSxJQUFJLElBQUksUUFBUSxFQUFFLENBQUM7UUFDNUIsNkJBQTZCO1FBQzdCLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ2hDLFNBQVM7UUFDWCxDQUFDO1FBRUQsd0VBQXdFO1FBQ3hFLElBQUksSUFBSSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMxQyxNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQzFFLElBQUksb0JBQW9CLEVBQUUsQ0FBQztnQkFDekIsU0FBUztZQUNYLENBQUM7UUFDSCxDQUFDO1FBRUQsWUFBWSxDQUFDLElBQUksQ0FBQztZQUNoQixJQUFJO1lBQ0osaUJBQWlCLEVBQUUsb0JBQW9CLENBQUMsSUFBSSxDQUFDO1NBQzlDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCx5RUFBeUU7SUFDekUsSUFBSSxZQUFZLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzlCLE9BQU87WUFDTCxRQUFRLEVBQUUsTUFBTTtZQUNoQixNQUFNLEVBQUUsU0FBUztZQUNqQixNQUFNLEVBQUUsb0NBQW9DO1lBQzVDLFFBQVEsRUFBRSxDQUFDO1lBQ1gsaUJBQWlCLEVBQUUsQ0FBQztTQUNyQixDQUFDO0lBQ0osQ0FBQztJQUVELHdEQUF3RDtJQUN4RCxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixHQUFHLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ3ZFLE1BQU0sTUFBTSxHQUFHLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUUvQixPQUFPO1FBQ0wsUUFBUSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUTtRQUM5QixNQUFNLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFO1FBQ3RCLE1BQU0sRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sSUFBSSxpQkFBaUIsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDL0QsUUFBUSxFQUFFLE1BQU0sQ0FBQyxpQkFBaUI7UUFDbEMsaUJBQWlCLEVBQUUsWUFBWSxDQUFDLE1BQU07S0FDdkMsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFByaW9yaXR5LWJhc2VkIG5vaXNlIHJlZHVjdGlvbiBldmFsdWF0aW9uICh2MjogdGhyZWUtZGVjaXNpb24gbW9kZWwpLlxuICogXG4gKiBQcm92aWRlcyBleHBsaWNpdCBwcmlvcml0eSBoYW5kbGluZyBmb3Igbm9pc2UgcmVkdWN0aW9uIHJ1bGVzLlxuICogUnVsZXMgYXJlIGV2YWx1YXRlZCBhZ2FpbnN0IGV2ZW50czsgaGlnaGVzdCBwcmlvcml0eSBtYXRjaCB3aW5zLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTm9pc2VEZWNpc2lvbiwgTm9pc2VSdWxlLCBOb2lzZVJ1bGVNYXRjaCwgT2JzZXJ2YWJpbGl0eUV2ZW50IH0gZnJvbSAnLi4vdHlwZXMnO1xuXG4vKipcbiAqIEJhc2UgcHJpb3JpdHkgZm9yIGVhY2ggZGVjaXNpb24gdHlwZS5cbiAqIEhpZ2hlciBudW1iZXJzID0gaGlnaGVyIHByaW9yaXR5IChoYXJkZXIgdG8gb3ZlcnJpZGUpLlxuICogXG4gKiAtIGVtaXQ6ICAgaGFyZCB0byBvdmVycmlkZSAoeW91IHdhbnQgdG8ga2VlcCBpbXBvcnRhbnQgZXZlbnRzKVxuICogLSBhYnNvcmI6IG1pZGRsZSBncm91bmQgKG1lcmdlIGludG8gcGFyZW50KVxuICogLSBzaWxlbnQ6IGVhc3kgdG8gb3ZlcnJpZGUgKGEga2VlcC9hYnNvcmIgcnVsZSBjYW4gcmVzY3VlIGV2ZW50cylcbiAqL1xuZXhwb3J0IGNvbnN0IERFQ0lTSU9OX0JBU0VfUFJJT1JJVFk6IFJlYWRvbmx5PFJlY29yZDxOb2lzZURlY2lzaW9uLCBudW1iZXI+PiA9IHtcbiAgZW1pdDogMTAwLFxuICBhYnNvcmI6IDUwLFxuICBzaWxlbnQ6IDEwLFxufSBhcyBjb25zdDtcblxuLyoqXG4gKiBQcmlvcml0eSBmb3IgaGFyZCBzaWduYWwgcHJvdGVjdGlvbiAoZXJyb3JzLCBmYWlsdXJlcywgY3JpdGljYWwgZXZlbnRzKS5cbiAqIFJ1bGVzIHdpdGggcHJpb3JpdHkgPiBIQVJEX1NJR05BTF9QUklPUklUWSBjYW4gb3ZlcnJpZGUgaGFyZCBzaWduYWwgcHJvdGVjdGlvbi5cbiAqIFxuICogRXhhbXBsZTogVG8gYWJzb3JiIGVycm9yIGV2ZW50cyBpbnRlbnRpb25hbGx5LCB1c2UgcHJpb3JpdHk6IDIwMDBcbiAqL1xuZXhwb3J0IGNvbnN0IEhBUkRfU0lHTkFMX1BSSU9SSVRZID0gMTAwMDtcblxuLyoqXG4gKiBSZXN1bHQgb2Ygbm9pc2UgcmVkdWN0aW9uIGV2YWx1YXRpb24gd2l0aCBmdWxsIGNvbnRleHQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTm9pc2VFdmFsdWF0aW9uUmVzdWx0IHtcbiAgLyoqIFRoZSBkZWNpc2lvbiB0byBhcHBseSAqL1xuICByZWFkb25seSBkZWNpc2lvbjogTm9pc2VEZWNpc2lvbjtcbiAgLyoqIElEIG9mIHRoZSBydWxlIHRoYXQgbWFkZSB0aGlzIGRlY2lzaW9uICovXG4gIHJlYWRvbmx5IHJ1bGVJZDogc3RyaW5nO1xuICAvKiogSHVtYW4tcmVhZGFibGUgcmVhc29uIGZvciB0aGlzIGRlY2lzaW9uICovXG4gIHJlYWRvbmx5IHJlYXNvbjogc3RyaW5nO1xuICAvKiogRWZmZWN0aXZlIHByaW9yaXR5IG9mIHRoZSB3aW5uaW5nIHJ1bGUgKi9cbiAgcmVhZG9ubHkgcHJpb3JpdHk6IG51bWJlcjtcbiAgLyoqIFRvdGFsIG51bWJlciBvZiBydWxlcyB0aGF0IG1hdGNoZWQgdGhpcyBldmVudCAqL1xuICByZWFkb25seSBtYXRjaGVkUnVsZXNDb3VudDogbnVtYmVyO1xufVxuXG4vKipcbiAqIEludGVybmFsOiBNYXRjaGVkIHJ1bGUgd2l0aCBpdHMgY29tcHV0ZWQgZWZmZWN0aXZlIHByaW9yaXR5LlxuICovXG5pbnRlcmZhY2UgTWF0Y2hlZFJ1bGUge1xuICByZWFkb25seSBydWxlOiBOb2lzZVJ1bGU7XG4gIHJlYWRvbmx5IGVmZmVjdGl2ZVByaW9yaXR5OiBudW1iZXI7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlIHRoZSBlZmZlY3RpdmUgcHJpb3JpdHkgZm9yIGEgcnVsZS5cbiAqIFVzZXMgZXhwbGljaXQgcHJpb3JpdHkgaWYgcHJvdmlkZWQsIG90aGVyd2lzZSB0aGUgZGVjaXNpb24ncyBiYXNlIHByaW9yaXR5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0RWZmZWN0aXZlUHJpb3JpdHkocnVsZTogTm9pc2VSdWxlKTogbnVtYmVyIHtcbiAgaWYgKHJ1bGUucHJpb3JpdHkgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChydWxlLnByaW9yaXR5IDw9IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUnVsZSBcIiR7cnVsZS5pZH1cIiBoYXMgaW52YWxpZCBwcmlvcml0eSAke3J1bGUucHJpb3JpdHl9LiBQcmlvcml0eSBtdXN0IGJlID4gMC5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHJ1bGUucHJpb3JpdHk7XG4gIH1cbiAgcmV0dXJuIERFQ0lTSU9OX0JBU0VfUFJJT1JJVFlbcnVsZS5kZWNpc2lvbl07XG59XG5cbi8qKlxuICogVHlwZSBmb3IgdGhlIHJ1bGUgbWF0Y2hpbmcgZnVuY3Rpb24uXG4gKiBEZWNvdXBsZXMgZXZhbHVhdGlvbiBmcm9tIHRoZSBtYXRjaGVyIGltcGxlbWVudGF0aW9uLlxuICovXG5leHBvcnQgdHlwZSBSdWxlTWF0Y2hGbiA9IChldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCBtYXRjaDogTm9pc2VSdWxlTWF0Y2gpID0+IGJvb2xlYW47XG5cbi8qKlxuICogRXZhbHVhdGUgYWxsIHJ1bGVzIGFnYWluc3QgYW4gZXZlbnQgYW5kIHJldHVybiB0aGUgd2lubmluZyBkZWNpc2lvbi5cbiAqIFxuICogQWxnb3JpdGhtOlxuICogMS4gQ2hlY2sgcGVyLWV2ZW50IG92ZXJyaWRlIChhYnNvbHV0ZSBoaWdoZXN0IHByaW9yaXR5KVxuICogMi4gQ29sbGVjdCBhbGwgbWF0Y2hpbmcgcnVsZXMgKGluY2x1ZGluZyBleGNlcHRpb24gZXZhbHVhdGlvbilcbiAqIDMuIFNvcnQgYnkgZWZmZWN0aXZlIHByaW9yaXR5IChoaWdoZXN0IGZpcnN0KVxuICogNC4gUmV0dXJuIHRoZSB3aW5uaW5nIHJ1bGUncyBkZWNpc2lvblxuICogXG4gKiBOT1RFOiBIYXJkIHNpZ25hbCBwcm90ZWN0aW9uIGlzIGhhbmRsZWQgYnkgdGhlIGNhbGxlciAoYWxnb3JpdGhtLnRzKSxcbiAqIG5vdCBpbnNpZGUgdGhpcyBmdW5jdGlvbi4gVGhpcyBrZWVwcyBldmFsdWF0aW9uIHB1cmUgYW5kIHRlc3RhYmxlLlxuICogXG4gKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgdG8gZXZhbHVhdGVcbiAqIEBwYXJhbSBhbGxSdWxlcyAtIEFsbCBydWxlcyB0byBjb25zaWRlciAoY3VzdG9tICsgYnVpbHRpbilcbiAqIEBwYXJhbSBtYXRjaEZuIC0gRnVuY3Rpb24gdG8gY2hlY2sgaWYgYSBtYXRjaCBjb25kaXRpb24gbWF0Y2hlcyB0aGUgZXZlbnRcbiAqIEByZXR1cm5zIEV2YWx1YXRpb24gcmVzdWx0IHdpdGggZnVsbCBjb250ZXh0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBldmFsdWF0ZU5vaXNlUnVsZXMoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGFsbFJ1bGVzOiByZWFkb25seSBOb2lzZVJ1bGVbXSxcbiAgbWF0Y2hGbjogUnVsZU1hdGNoRm4sXG4pOiBOb2lzZUV2YWx1YXRpb25SZXN1bHQge1xuICAvLyAxLiBQZXItZXZlbnQgb3ZlcnJpZGUgKGFic29sdXRlIGhpZ2hlc3QgcHJpb3JpdHkpXG4gIGlmIChldmVudC5jYXB0dXJlPy5ub2lzZSkge1xuICAgIHJldHVybiB7XG4gICAgICBkZWNpc2lvbjogZXZlbnQuY2FwdHVyZS5ub2lzZS5kZWNpc2lvbixcbiAgICAgIHJ1bGVJZDogJ292ZXJyaWRlJyxcbiAgICAgIHJlYXNvbjogZXZlbnQuY2FwdHVyZS5ub2lzZS5yZWFzb24gPz8gJ1Blci1ldmVudCBvdmVycmlkZScsXG4gICAgICBwcmlvcml0eTogSW5maW5pdHksXG4gICAgICBtYXRjaGVkUnVsZXNDb3VudDogMCxcbiAgICB9O1xuICB9XG5cbiAgLy8gMi4gQ29sbGVjdCBhbGwgbWF0Y2hpbmcgcnVsZXNcbiAgY29uc3QgbWF0Y2hlZFJ1bGVzOiBNYXRjaGVkUnVsZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBydWxlIG9mIGFsbFJ1bGVzKSB7XG4gICAgLy8gQ2hlY2sgbWFpbiBtYXRjaCBjb25kaXRpb25cbiAgICBpZiAoIW1hdGNoRm4oZXZlbnQsIHJ1bGUubWF0Y2gpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBleGNlcHRpb24gY29uZGl0aW9ucyAtIGlmIEFOWSBleGNlcHRpb24gbWF0Y2hlcywgc2tpcCB0aGlzIHJ1bGVcbiAgICBpZiAocnVsZS5leGNlcHQgJiYgcnVsZS5leGNlcHQubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgaGFzTWF0Y2hpbmdFeGNlcHRpb24gPSBydWxlLmV4Y2VwdC5zb21lKGV4YyA9PiBtYXRjaEZuKGV2ZW50LCBleGMpKTtcbiAgICAgIGlmIChoYXNNYXRjaGluZ0V4Y2VwdGlvbikge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBtYXRjaGVkUnVsZXMucHVzaCh7XG4gICAgICBydWxlLFxuICAgICAgZWZmZWN0aXZlUHJpb3JpdHk6IGdldEVmZmVjdGl2ZVByaW9yaXR5KHJ1bGUpLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gMy4gTm8gbWF0Y2hpbmcgcnVsZXMgPSBlbWl0IGJ5IGRlZmF1bHQgKHNhZmUgZGVmYXVsdDogZG9uJ3QgbG9zZSBkYXRhKVxuICBpZiAobWF0Y2hlZFJ1bGVzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB7XG4gICAgICBkZWNpc2lvbjogJ2VtaXQnLFxuICAgICAgcnVsZUlkOiAnZGVmYXVsdCcsXG4gICAgICByZWFzb246ICdObyBtYXRjaGluZyBydWxlcywgZW1pdCBieSBkZWZhdWx0JyxcbiAgICAgIHByaW9yaXR5OiAwLFxuICAgICAgbWF0Y2hlZFJ1bGVzQ291bnQ6IDAsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDQuIFNvcnQgYnkgcHJpb3JpdHkgKGhpZ2hlc3QgZmlyc3QpIGFuZCBzZWxlY3Qgd2lubmVyXG4gIG1hdGNoZWRSdWxlcy5zb3J0KChhLCBiKSA9PiBiLmVmZmVjdGl2ZVByaW9yaXR5IC0gYS5lZmZlY3RpdmVQcmlvcml0eSk7XG4gIGNvbnN0IHdpbm5lciA9IG1hdGNoZWRSdWxlc1swXTtcblxuICByZXR1cm4ge1xuICAgIGRlY2lzaW9uOiB3aW5uZXIucnVsZS5kZWNpc2lvbixcbiAgICBydWxlSWQ6IHdpbm5lci5ydWxlLmlkLFxuICAgIHJlYXNvbjogd2lubmVyLnJ1bGUucmVhc29uID8/IGBNYXRjaGVkIHJ1bGU6ICR7d2lubmVyLnJ1bGUuaWR9YCxcbiAgICBwcmlvcml0eTogd2lubmVyLmVmZmVjdGl2ZVByaW9yaXR5LFxuICAgIG1hdGNoZWRSdWxlc0NvdW50OiBtYXRjaGVkUnVsZXMubGVuZ3RoLFxuICB9O1xufVxuIl19