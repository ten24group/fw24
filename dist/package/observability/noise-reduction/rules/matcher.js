"use strict";
/**
 * Rule matching logic for noise reduction.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesRule = matchesRule;
const pattern_utils_1 = require("../../utils/pattern-utils");
const utils_1 = require("../utils");
/**
 * Check if an event matches a noise rule match condition.
 *
 * All specified conditions must match for the rule to apply.
 * Undefined/missing conditions are treated as "match any".
 *
 * @param event - The observability event to check
 * @param match - The match conditions from a noise rule
 * @returns true if the event matches all specified conditions
 */
function matchesRule(event, match) {
    // Type matching
    const types = (0, utils_1.asArray)(match.type);
    if (types && !types.includes(event.type)) {
        return false;
    }
    // Level matching
    const levels = (0, utils_1.asArray)(match.level);
    if (levels && !levels.includes(event.level)) {
        return false;
    }
    // Operation pattern matching (supports regex)
    if (!(0, pattern_utils_1.matchesPattern)(event.operation, match.operation)) {
        return false;
    }
    // Source pattern matching (supports regex)
    if (!(0, pattern_utils_1.matchesPattern)(event.source, match.source)) {
        return false;
    }
    // Entity name exact matching
    if (match.entityName && event.entityName !== match.entityName) {
        return false;
    }
    // Duration minimum threshold
    if (match.minDurationMs !== undefined) {
        if (event.durationMs === undefined)
            return false;
        if (event.durationMs < match.minDurationMs)
            return false;
    }
    // Duration maximum threshold
    if (match.maxDurationMs !== undefined) {
        if (event.durationMs === undefined)
            return false;
        if (event.durationMs >= match.maxDurationMs)
            return false;
    }
    // Success status matching
    if (match.success !== undefined) {
        if (event.success === undefined)
            return false;
        if (event.success !== match.success)
            return false;
    }
    // Tag matching (all specified tags must match)
    if (match.tags) {
        for (const [k, v] of Object.entries(match.tags)) {
            if (!event.tags)
                return false;
            if (!(0, pattern_utils_1.matchesPattern)(event.tags[k], v))
                return false;
        }
    }
    // Special handling for observabilityLogId (used in tests)
    if ('observabilityLogId' in match) {
        const matchWithId = match;
        if (event.observabilityLogId !== matchWithId.observabilityLogId) {
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWF0Y2hlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L25vaXNlLXJlZHVjdGlvbi9ydWxlcy9tYXRjaGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7R0FFRzs7QUFnQkgsa0NBK0RDO0FBNUVELDZEQUEyRDtBQUMzRCxvQ0FBbUM7QUFFbkM7Ozs7Ozs7OztHQVNHO0FBQ0gsU0FBZ0IsV0FBVyxDQUFDLEtBQXlCLEVBQUUsS0FBcUI7SUFDMUUsZ0JBQWdCO0lBQ2hCLE1BQU0sS0FBSyxHQUFHLElBQUEsZUFBTyxFQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNsQyxJQUFJLEtBQUssSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQThCLENBQUMsRUFBRSxDQUFDO1FBQ25FLE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQztJQUVELGlCQUFpQjtJQUNqQixNQUFNLE1BQU0sR0FBRyxJQUFBLGVBQU8sRUFBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDcEMsSUFBSSxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxLQUFpQyxDQUFDLEVBQUUsQ0FBQztRQUN4RSxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRCw4Q0FBOEM7SUFDOUMsSUFBSSxDQUFDLElBQUEsOEJBQWMsRUFBQyxLQUFLLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ3RELE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQztJQUVELDJDQUEyQztJQUMzQyxJQUFJLENBQUMsSUFBQSw4QkFBYyxFQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7UUFDaEQsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBRUQsNkJBQTZCO0lBQzdCLElBQUksS0FBSyxDQUFDLFVBQVUsSUFBSSxLQUFLLENBQUMsVUFBVSxLQUFLLEtBQUssQ0FBQyxVQUFVLEVBQUUsQ0FBQztRQUM5RCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRCw2QkFBNkI7SUFDN0IsSUFBSSxLQUFLLENBQUMsYUFBYSxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQ3RDLElBQUksS0FBSyxDQUFDLFVBQVUsS0FBSyxTQUFTO1lBQUUsT0FBTyxLQUFLLENBQUM7UUFDakQsSUFBSSxLQUFLLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQyxhQUFhO1lBQUUsT0FBTyxLQUFLLENBQUM7SUFDM0QsQ0FBQztJQUVELDZCQUE2QjtJQUM3QixJQUFJLEtBQUssQ0FBQyxhQUFhLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDdEMsSUFBSSxLQUFLLENBQUMsVUFBVSxLQUFLLFNBQVM7WUFBRSxPQUFPLEtBQUssQ0FBQztRQUNqRCxJQUFJLEtBQUssQ0FBQyxVQUFVLElBQUksS0FBSyxDQUFDLGFBQWE7WUFBRSxPQUFPLEtBQUssQ0FBQztJQUM1RCxDQUFDO0lBRUQsMEJBQTBCO0lBQzFCLElBQUksS0FBSyxDQUFDLE9BQU8sS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUNoQyxJQUFJLEtBQUssQ0FBQyxPQUFPLEtBQUssU0FBUztZQUFFLE9BQU8sS0FBSyxDQUFDO1FBQzlDLElBQUksS0FBSyxDQUFDLE9BQU8sS0FBSyxLQUFLLENBQUMsT0FBTztZQUFFLE9BQU8sS0FBSyxDQUFDO0lBQ3BELENBQUM7SUFFRCwrQ0FBK0M7SUFDL0MsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDZixLQUFLLE1BQU0sQ0FBRSxDQUFDLEVBQUUsQ0FBQyxDQUFFLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNsRCxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUk7Z0JBQUUsT0FBTyxLQUFLLENBQUM7WUFDOUIsSUFBSSxDQUFDLElBQUEsOEJBQWMsRUFBQyxLQUFLLENBQUMsSUFBSSxDQUFFLENBQUMsQ0FBRSxFQUFFLENBQUMsQ0FBQztnQkFBRSxPQUFPLEtBQUssQ0FBQztRQUN4RCxDQUFDO0lBQ0gsQ0FBQztJQUVELDBEQUEwRDtJQUMxRCxJQUFJLG9CQUFvQixJQUFJLEtBQUssRUFBRSxDQUFDO1FBQ2xDLE1BQU0sV0FBVyxHQUFHLEtBQXdELENBQUM7UUFDN0UsSUFBSSxLQUFLLENBQUMsa0JBQWtCLEtBQUssV0FBVyxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDaEUsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFDO0FBQ2QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUnVsZSBtYXRjaGluZyBsb2dpYyBmb3Igbm9pc2UgcmVkdWN0aW9uLlxuICovXG5cbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eUV2ZW50LCBOb2lzZVJ1bGVNYXRjaCwgT2JzZXJ2YWJpbGl0eUV2ZW50VHlwZSwgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuaW1wb3J0IHsgbWF0Y2hlc1BhdHRlcm4gfSBmcm9tICcuLi8uLi91dGlscy9wYXR0ZXJuLXV0aWxzJztcbmltcG9ydCB7IGFzQXJyYXkgfSBmcm9tICcuLi91dGlscyc7XG5cbi8qKlxuICogQ2hlY2sgaWYgYW4gZXZlbnQgbWF0Y2hlcyBhIG5vaXNlIHJ1bGUgbWF0Y2ggY29uZGl0aW9uLlxuICogXG4gKiBBbGwgc3BlY2lmaWVkIGNvbmRpdGlvbnMgbXVzdCBtYXRjaCBmb3IgdGhlIHJ1bGUgdG8gYXBwbHkuXG4gKiBVbmRlZmluZWQvbWlzc2luZyBjb25kaXRpb25zIGFyZSB0cmVhdGVkIGFzIFwibWF0Y2ggYW55XCIuXG4gKiBcbiAqIEBwYXJhbSBldmVudCAtIFRoZSBvYnNlcnZhYmlsaXR5IGV2ZW50IHRvIGNoZWNrXG4gKiBAcGFyYW0gbWF0Y2ggLSBUaGUgbWF0Y2ggY29uZGl0aW9ucyBmcm9tIGEgbm9pc2UgcnVsZVxuICogQHJldHVybnMgdHJ1ZSBpZiB0aGUgZXZlbnQgbWF0Y2hlcyBhbGwgc3BlY2lmaWVkIGNvbmRpdGlvbnNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1hdGNoZXNSdWxlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIG1hdGNoOiBOb2lzZVJ1bGVNYXRjaCk6IGJvb2xlYW4ge1xuICAvLyBUeXBlIG1hdGNoaW5nXG4gIGNvbnN0IHR5cGVzID0gYXNBcnJheShtYXRjaC50eXBlKTtcbiAgaWYgKHR5cGVzICYmICF0eXBlcy5pbmNsdWRlcyhldmVudC50eXBlIGFzIE9ic2VydmFiaWxpdHlFdmVudFR5cGUpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gTGV2ZWwgbWF0Y2hpbmdcbiAgY29uc3QgbGV2ZWxzID0gYXNBcnJheShtYXRjaC5sZXZlbCk7XG4gIGlmIChsZXZlbHMgJiYgIWxldmVscy5pbmNsdWRlcyhldmVudC5sZXZlbCBhcyBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gT3BlcmF0aW9uIHBhdHRlcm4gbWF0Y2hpbmcgKHN1cHBvcnRzIHJlZ2V4KVxuICBpZiAoIW1hdGNoZXNQYXR0ZXJuKGV2ZW50Lm9wZXJhdGlvbiwgbWF0Y2gub3BlcmF0aW9uKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIFNvdXJjZSBwYXR0ZXJuIG1hdGNoaW5nIChzdXBwb3J0cyByZWdleClcbiAgaWYgKCFtYXRjaGVzUGF0dGVybihldmVudC5zb3VyY2UsIG1hdGNoLnNvdXJjZSkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBFbnRpdHkgbmFtZSBleGFjdCBtYXRjaGluZ1xuICBpZiAobWF0Y2guZW50aXR5TmFtZSAmJiBldmVudC5lbnRpdHlOYW1lICE9PSBtYXRjaC5lbnRpdHlOYW1lKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gRHVyYXRpb24gbWluaW11bSB0aHJlc2hvbGRcbiAgaWYgKG1hdGNoLm1pbkR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudC5kdXJhdGlvbk1zID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoZXZlbnQuZHVyYXRpb25NcyA8IG1hdGNoLm1pbkR1cmF0aW9uTXMpIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIER1cmF0aW9uIG1heGltdW0gdGhyZXNob2xkXG4gIGlmIChtYXRjaC5tYXhEdXJhdGlvbk1zICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoZXZlbnQuZHVyYXRpb25NcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgPj0gbWF0Y2gubWF4RHVyYXRpb25NcykgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gU3VjY2VzcyBzdGF0dXMgbWF0Y2hpbmdcbiAgaWYgKG1hdGNoLnN1Y2Nlc3MgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudC5zdWNjZXNzID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoZXZlbnQuc3VjY2VzcyAhPT0gbWF0Y2guc3VjY2VzcykgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gVGFnIG1hdGNoaW5nIChhbGwgc3BlY2lmaWVkIHRhZ3MgbXVzdCBtYXRjaClcbiAgaWYgKG1hdGNoLnRhZ3MpIHtcbiAgICBmb3IgKGNvbnN0IFsgaywgdiBdIG9mIE9iamVjdC5lbnRyaWVzKG1hdGNoLnRhZ3MpKSB7XG4gICAgICBpZiAoIWV2ZW50LnRhZ3MpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmICghbWF0Y2hlc1BhdHRlcm4oZXZlbnQudGFnc1sgayBdLCB2KSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIG9ic2VydmFiaWxpdHlMb2dJZCAodXNlZCBpbiB0ZXN0cylcbiAgaWYgKCdvYnNlcnZhYmlsaXR5TG9nSWQnIGluIG1hdGNoKSB7XG4gICAgY29uc3QgbWF0Y2hXaXRoSWQgPSBtYXRjaCBhcyBOb2lzZVJ1bGVNYXRjaCAmIHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBzdHJpbmcgfTtcbiAgICBpZiAoZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkICE9PSBtYXRjaFdpdGhJZC5vYnNlcnZhYmlsaXR5TG9nSWQpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn1cbiJdfQ==