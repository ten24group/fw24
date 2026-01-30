"use strict";
/**
 * Hard signal detection for noise reduction.
 *
 * Hard signals are events that must always be preserved and trigger
 * context preservation in their ancestor nodes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHardSignal = isHardSignal;
/**
 * Check if an event is a hard signal.
 *
 * Hard signals include:
 * - Error/critical level events
 * - Failed operations (success=false or error present)
 * - Slow operations (exceeds threshold)
 * - Optionally: WARN level (if configured)
 *
 * @param event - The observability event to check
 * @param config - Noise reduction configuration
 * @returns true if this is a hard signal that must be preserved
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
 *
 * @param event - The observability event
 * @param hardSigConfig - Hard signal configuration
 * @returns Slow threshold in milliseconds
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGFyZC1zaWduYWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL2hhcmQtc2lnbmFscy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7O0FBaUJILG9DQStCQztBQTVDRDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxTQUFnQixZQUFZLENBQzFCLEtBQXlCLEVBQ3pCLE1BQTRCO0lBRTVCLE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO0lBRS9DLGNBQWM7SUFDZCxNQUFNLE1BQU0sR0FBRyxhQUFhLENBQUMsTUFBTSxJQUFJLENBQUUsT0FBTyxFQUFFLFVBQVUsQ0FBRSxDQUFDO0lBQy9ELElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUNqQyxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRCxzQkFBc0I7SUFDdEIsSUFBSSxhQUFhLENBQUMsV0FBVyxJQUFJLEtBQUssQ0FBQyxLQUFLLEtBQUssTUFBTSxFQUFFLENBQUM7UUFDeEQsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsZ0JBQWdCO0lBQ2hCLElBQUksS0FBSyxDQUFDLE9BQU8sS0FBSyxLQUFLLElBQUksS0FBSyxDQUFDLEtBQUssSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUNuRCxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRCx1Q0FBdUM7SUFDdkMsSUFBSSxLQUFLLENBQUMsVUFBVSxJQUFJLElBQUksRUFBRSxDQUFDO1FBQzdCLE1BQU0sU0FBUyxHQUFHLGdCQUFnQixDQUFDLEtBQUssRUFBRSxhQUFhLENBQUMsQ0FBQztRQUN6RCxJQUFJLEtBQUssQ0FBQyxVQUFVLEdBQUcsU0FBUyxFQUFFLENBQUM7WUFDakMsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxTQUFTLGdCQUFnQixDQUN2QixLQUF5QixFQUN6QixhQUErQjtJQUUvQiwyQkFBMkI7SUFDM0IsSUFBSSxhQUFhLENBQUMsY0FBYyxFQUFFLENBQUM7UUFDakMsTUFBTSxhQUFhLEdBQUcsYUFBYSxDQUFDLGNBQWMsQ0FBRSxLQUFLLENBQUMsSUFBSSxDQUFFLENBQUM7UUFDakUsSUFBSSxhQUFhLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDaEMsT0FBTyxhQUFhLENBQUM7UUFDdkIsQ0FBQztJQUNILENBQUM7SUFFRCw4QkFBOEI7SUFDOUIsT0FBTyxhQUFhLENBQUMsZUFBZSxJQUFJLElBQUksQ0FBQztBQUMvQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBIYXJkIHNpZ25hbCBkZXRlY3Rpb24gZm9yIG5vaXNlIHJlZHVjdGlvbi5cbiAqIFxuICogSGFyZCBzaWduYWxzIGFyZSBldmVudHMgdGhhdCBtdXN0IGFsd2F5cyBiZSBwcmVzZXJ2ZWQgYW5kIHRyaWdnZXJcbiAqIGNvbnRleHQgcHJlc2VydmF0aW9uIGluIHRoZWlyIGFuY2VzdG9yIG5vZGVzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eUV2ZW50LCBOb2lzZVJlZHVjdGlvbkNvbmZpZywgSGFyZFNpZ25hbENvbmZpZyB9IGZyb20gJy4uL3R5cGVzJztcblxuLyoqXG4gKiBDaGVjayBpZiBhbiBldmVudCBpcyBhIGhhcmQgc2lnbmFsLlxuICogXG4gKiBIYXJkIHNpZ25hbHMgaW5jbHVkZTpcbiAqIC0gRXJyb3IvY3JpdGljYWwgbGV2ZWwgZXZlbnRzXG4gKiAtIEZhaWxlZCBvcGVyYXRpb25zIChzdWNjZXNzPWZhbHNlIG9yIGVycm9yIHByZXNlbnQpXG4gKiAtIFNsb3cgb3BlcmF0aW9ucyAoZXhjZWVkcyB0aHJlc2hvbGQpXG4gKiAtIE9wdGlvbmFsbHk6IFdBUk4gbGV2ZWwgKGlmIGNvbmZpZ3VyZWQpXG4gKiBcbiAqIEBwYXJhbSBldmVudCAtIFRoZSBvYnNlcnZhYmlsaXR5IGV2ZW50IHRvIGNoZWNrXG4gKiBAcGFyYW0gY29uZmlnIC0gTm9pc2UgcmVkdWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIHRydWUgaWYgdGhpcyBpcyBhIGhhcmQgc2lnbmFsIHRoYXQgbXVzdCBiZSBwcmVzZXJ2ZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSGFyZFNpZ25hbChcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZ1xuKTogYm9vbGVhbiB7XG4gIGNvbnN0IGhhcmRTaWdDb25maWcgPSBjb25maWcuaGFyZFNpZ25hbHMgPz8ge307XG5cbiAgLy8gQ2hlY2sgbGV2ZWxcbiAgY29uc3QgbGV2ZWxzID0gaGFyZFNpZ0NvbmZpZy5sZXZlbHMgPz8gWyAnZXJyb3InLCAnY3JpdGljYWwnIF07XG4gIGlmIChsZXZlbHMuaW5jbHVkZXMoZXZlbnQubGV2ZWwpKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyBDaGVjayB3YXJuIChvcHQtaW4pXG4gIGlmIChoYXJkU2lnQ29uZmlnLmluY2x1ZGVXYXJuICYmIGV2ZW50LmxldmVsID09PSAnd2FybicpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIENoZWNrIGZhaWx1cmVcbiAgaWYgKGV2ZW50LnN1Y2Nlc3MgPT09IGZhbHNlIHx8IGV2ZW50LmVycm9yICE9IG51bGwpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIENoZWNrIHNsb3cgKGNvbmZpZ3VyYWJsZSB0aHJlc2hvbGRzKVxuICBpZiAoZXZlbnQuZHVyYXRpb25NcyAhPSBudWxsKSB7XG4gICAgY29uc3QgdGhyZXNob2xkID0gZ2V0U2xvd1RocmVzaG9sZChldmVudCwgaGFyZFNpZ0NvbmZpZyk7XG4gICAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgPiB0aHJlc2hvbGQpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBHZXQgc2xvdyB0aHJlc2hvbGQgZm9yIGFuIGV2ZW50LlxuICogQ2hlY2tzIHBlci10eXBlIHRocmVzaG9sZHMgZmlyc3QsIHRoZW4gZmFsbHMgYmFjayB0byBnbG9iYWwgZGVmYXVsdC5cbiAqIFxuICogQHBhcmFtIGV2ZW50IC0gVGhlIG9ic2VydmFiaWxpdHkgZXZlbnRcbiAqIEBwYXJhbSBoYXJkU2lnQ29uZmlnIC0gSGFyZCBzaWduYWwgY29uZmlndXJhdGlvblxuICogQHJldHVybnMgU2xvdyB0aHJlc2hvbGQgaW4gbWlsbGlzZWNvbmRzXG4gKi9cbmZ1bmN0aW9uIGdldFNsb3dUaHJlc2hvbGQoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGhhcmRTaWdDb25maWc6IEhhcmRTaWduYWxDb25maWdcbik6IG51bWJlciB7XG4gIC8vIENoZWNrIHBlci10eXBlIHRocmVzaG9sZFxuICBpZiAoaGFyZFNpZ0NvbmZpZy5zbG93VGhyZXNob2xkcykge1xuICAgIGNvbnN0IHR5cGVUaHJlc2hvbGQgPSBoYXJkU2lnQ29uZmlnLnNsb3dUaHJlc2hvbGRzWyBldmVudC50eXBlIF07XG4gICAgaWYgKHR5cGVUaHJlc2hvbGQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHR5cGVUaHJlc2hvbGQ7XG4gICAgfVxuICB9XG5cbiAgLy8gRmFsbCBiYWNrIHRvIGdsb2JhbCBkZWZhdWx0XG4gIHJldHVybiBoYXJkU2lnQ29uZmlnLnNsb3dUaHJlc2hvbGRNcyA/PyA1MDAwO1xufVxuIl19