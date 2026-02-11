"use strict";
/**
 * Hard signal detection for noise reduction.
 *
 * Hard signals are events that must always be preserved (emitted) and trigger
 * context preservation in their ancestor nodes. They represent important events
 * that should never be silently dropped.
 *
 * Hard signals include:
 * - Error/critical level events
 * - Failed operations (success=false or error present)
 * - Slow operations (exceeds configurable thresholds)
 * - Optionally: WARN level (if configured)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHardSignal = isHardSignal;
/**
 * Check if an event is a hard signal.
 *
 * Hard signals always default to 'emit' unless explicitly overridden
 * by a rule with priority > HARD_SIGNAL_PRIORITY (1000).
 *
 * @param event - The observability event to check
 * @param config - Noise reduction configuration (only hardSignals sub-config is used)
 * @returns true if this is a hard signal that should be preserved
 */
function isHardSignal(event, config) {
    const hardSigConfig = config.hardSignals ?? {};
    // Check level
    const levels = hardSigConfig.levels ?? ['error', 'critical'];
    if (levels.includes(event.level)) {
        return true;
    }
    // Check warn (opt-in)
    if (hardSigConfig.includeWarn && event.level === 'warn') {
        return true;
    }
    // Check failure
    if (event.success === false || event.error != null) {
        return true;
    }
    // Check slow (configurable thresholds)
    if (event.durationMs != null) {
        const threshold = getSlowThreshold(event, hardSigConfig);
        if (event.durationMs > threshold) {
            return true;
        }
    }
    return false;
}
/**
 * Get slow threshold for an event.
 * Checks per-type thresholds first, then falls back to global default.
 */
function getSlowThreshold(event, hardSigConfig) {
    // Check per-type threshold
    if (hardSigConfig.slowThresholds) {
        const typeThreshold = hardSigConfig.slowThresholds[event.type];
        if (typeThreshold !== undefined) {
            return typeThreshold;
        }
    }
    // Fall back to global default
    return hardSigConfig.slowThresholdMs ?? 5000;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGFyZC1zaWduYWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL2hhcmQtc2lnbmFscy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7OztHQVlHOztBQWNILG9DQStCQztBQXpDRDs7Ozs7Ozs7O0dBU0c7QUFDSCxTQUFnQixZQUFZLENBQzFCLEtBQXlCLEVBQ3pCLE1BQTRCO0lBRTVCLE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO0lBRS9DLGNBQWM7SUFDZCxNQUFNLE1BQU0sR0FBRyxhQUFhLENBQUMsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLFVBQVUsQ0FBQyxDQUFDO0lBQzdELElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUNqQyxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRCxzQkFBc0I7SUFDdEIsSUFBSSxhQUFhLENBQUMsV0FBVyxJQUFJLEtBQUssQ0FBQyxLQUFLLEtBQUssTUFBTSxFQUFFLENBQUM7UUFDeEQsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsZ0JBQWdCO0lBQ2hCLElBQUksS0FBSyxDQUFDLE9BQU8sS0FBSyxLQUFLLElBQUksS0FBSyxDQUFDLEtBQUssSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUNuRCxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRCx1Q0FBdUM7SUFDdkMsSUFBSSxLQUFLLENBQUMsVUFBVSxJQUFJLElBQUksRUFBRSxDQUFDO1FBQzdCLE1BQU0sU0FBUyxHQUFHLGdCQUFnQixDQUFDLEtBQUssRUFBRSxhQUFhLENBQUMsQ0FBQztRQUN6RCxJQUFJLEtBQUssQ0FBQyxVQUFVLEdBQUcsU0FBUyxFQUFFLENBQUM7WUFDakMsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQVMsZ0JBQWdCLENBQ3ZCLEtBQXlCLEVBQ3pCLGFBQStCO0lBRS9CLDJCQUEyQjtJQUMzQixJQUFJLGFBQWEsQ0FBQyxjQUFjLEVBQUUsQ0FBQztRQUNqQyxNQUFNLGFBQWEsR0FBRyxhQUFhLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUMvRCxJQUFJLGFBQWEsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNoQyxPQUFPLGFBQWEsQ0FBQztRQUN2QixDQUFDO0lBQ0gsQ0FBQztJQUVELDhCQUE4QjtJQUM5QixPQUFPLGFBQWEsQ0FBQyxlQUFlLElBQUksSUFBSSxDQUFDO0FBQy9DLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEhhcmQgc2lnbmFsIGRldGVjdGlvbiBmb3Igbm9pc2UgcmVkdWN0aW9uLlxuICogXG4gKiBIYXJkIHNpZ25hbHMgYXJlIGV2ZW50cyB0aGF0IG11c3QgYWx3YXlzIGJlIHByZXNlcnZlZCAoZW1pdHRlZCkgYW5kIHRyaWdnZXJcbiAqIGNvbnRleHQgcHJlc2VydmF0aW9uIGluIHRoZWlyIGFuY2VzdG9yIG5vZGVzLiBUaGV5IHJlcHJlc2VudCBpbXBvcnRhbnQgZXZlbnRzXG4gKiB0aGF0IHNob3VsZCBuZXZlciBiZSBzaWxlbnRseSBkcm9wcGVkLlxuICogXG4gKiBIYXJkIHNpZ25hbHMgaW5jbHVkZTpcbiAqIC0gRXJyb3IvY3JpdGljYWwgbGV2ZWwgZXZlbnRzXG4gKiAtIEZhaWxlZCBvcGVyYXRpb25zIChzdWNjZXNzPWZhbHNlIG9yIGVycm9yIHByZXNlbnQpXG4gKiAtIFNsb3cgb3BlcmF0aW9ucyAoZXhjZWVkcyBjb25maWd1cmFibGUgdGhyZXNob2xkcylcbiAqIC0gT3B0aW9uYWxseTogV0FSTiBsZXZlbCAoaWYgY29uZmlndXJlZClcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlFdmVudCwgTm9pc2VSZWR1Y3Rpb25Db25maWcsIEhhcmRTaWduYWxDb25maWcgfSBmcm9tICcuLi90eXBlcyc7XG5cbi8qKlxuICogQ2hlY2sgaWYgYW4gZXZlbnQgaXMgYSBoYXJkIHNpZ25hbC5cbiAqIFxuICogSGFyZCBzaWduYWxzIGFsd2F5cyBkZWZhdWx0IHRvICdlbWl0JyB1bmxlc3MgZXhwbGljaXRseSBvdmVycmlkZGVuXG4gKiBieSBhIHJ1bGUgd2l0aCBwcmlvcml0eSA+IEhBUkRfU0lHTkFMX1BSSU9SSVRZICgxMDAwKS5cbiAqIFxuICogQHBhcmFtIGV2ZW50IC0gVGhlIG9ic2VydmFiaWxpdHkgZXZlbnQgdG8gY2hlY2tcbiAqIEBwYXJhbSBjb25maWcgLSBOb2lzZSByZWR1Y3Rpb24gY29uZmlndXJhdGlvbiAob25seSBoYXJkU2lnbmFscyBzdWItY29uZmlnIGlzIHVzZWQpXG4gKiBAcmV0dXJucyB0cnVlIGlmIHRoaXMgaXMgYSBoYXJkIHNpZ25hbCB0aGF0IHNob3VsZCBiZSBwcmVzZXJ2ZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSGFyZFNpZ25hbChcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyxcbik6IGJvb2xlYW4ge1xuICBjb25zdCBoYXJkU2lnQ29uZmlnID0gY29uZmlnLmhhcmRTaWduYWxzID8/IHt9O1xuXG4gIC8vIENoZWNrIGxldmVsXG4gIGNvbnN0IGxldmVscyA9IGhhcmRTaWdDb25maWcubGV2ZWxzID8/IFsnZXJyb3InLCAnY3JpdGljYWwnXTtcbiAgaWYgKGxldmVscy5pbmNsdWRlcyhldmVudC5sZXZlbCkpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIENoZWNrIHdhcm4gKG9wdC1pbilcbiAgaWYgKGhhcmRTaWdDb25maWcuaW5jbHVkZVdhcm4gJiYgZXZlbnQubGV2ZWwgPT09ICd3YXJuJykge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gQ2hlY2sgZmFpbHVyZVxuICBpZiAoZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UgfHwgZXZlbnQuZXJyb3IgIT0gbnVsbCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gQ2hlY2sgc2xvdyAoY29uZmlndXJhYmxlIHRocmVzaG9sZHMpXG4gIGlmIChldmVudC5kdXJhdGlvbk1zICE9IG51bGwpIHtcbiAgICBjb25zdCB0aHJlc2hvbGQgPSBnZXRTbG93VGhyZXNob2xkKGV2ZW50LCBoYXJkU2lnQ29uZmlnKTtcbiAgICBpZiAoZXZlbnQuZHVyYXRpb25NcyA+IHRocmVzaG9sZCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIEdldCBzbG93IHRocmVzaG9sZCBmb3IgYW4gZXZlbnQuXG4gKiBDaGVja3MgcGVyLXR5cGUgdGhyZXNob2xkcyBmaXJzdCwgdGhlbiBmYWxscyBiYWNrIHRvIGdsb2JhbCBkZWZhdWx0LlxuICovXG5mdW5jdGlvbiBnZXRTbG93VGhyZXNob2xkKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBoYXJkU2lnQ29uZmlnOiBIYXJkU2lnbmFsQ29uZmlnLFxuKTogbnVtYmVyIHtcbiAgLy8gQ2hlY2sgcGVyLXR5cGUgdGhyZXNob2xkXG4gIGlmIChoYXJkU2lnQ29uZmlnLnNsb3dUaHJlc2hvbGRzKSB7XG4gICAgY29uc3QgdHlwZVRocmVzaG9sZCA9IGhhcmRTaWdDb25maWcuc2xvd1RocmVzaG9sZHNbZXZlbnQudHlwZV07XG4gICAgaWYgKHR5cGVUaHJlc2hvbGQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHR5cGVUaHJlc2hvbGQ7XG4gICAgfVxuICB9XG5cbiAgLy8gRmFsbCBiYWNrIHRvIGdsb2JhbCBkZWZhdWx0XG4gIHJldHVybiBoYXJkU2lnQ29uZmlnLnNsb3dUaHJlc2hvbGRNcyA/PyA1MDAwO1xufVxuIl19