"use strict";
/**
 * Folding operations - collapsing events into parent as checkpoints.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldIntoParent = foldIntoParent;
const utils_1 = require("../utils");
/**
 * Fold an event into its parent span as a checkpoint.
 *
 * PURPOSE: Collapse noisy child events into parent timeline, preserving
 * metrics and critical context. Used for repetitive operations (cache hits,
 * validation steps, etc.) that need timeline markers but not standalone records.
 *
 * PERFORMANCE CRITICAL: Runs during flush on potentially 1000+ events.
 * - NO JSON.stringify()
 * - NO Object.keys().length checks
 * - NO deep object comparisons
 * - Simple string comparisons only
 *
 * DESIGN:
 * - Metrics: Merged into parent (additive aggregation)
 * - Timeline: Single checkpoint with timestamp
 * - Critical data: Errors, failures, entity IDs
 * - Common data: Inherited from parent (NOT duplicated)
 *
 * @param node - Node to fold (child)
 * @param config - Noise reduction configuration
 */
function foldIntoParent(node, config) {
    if (!node.parent)
        return;
    const parent = node.parent;
    const event = node.event;
    const bounds = (0, utils_1.getBounds)(config);
    // ─────────────────────────────────────────────────────────────────────────
    // 1. MERGE METRICS INTO PARENT (fast additive operation)
    // ─────────────────────────────────────────────────────────────────────────
    if (event.metrics) {
        if (!parent.event.metrics) {
            parent.event.metrics = {};
        }
        for (const [k, v] of Object.entries(event.metrics)) {
            parent.event.metrics[k] = (parent.event.metrics[k] ?? 0) + v;
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 2. BUILD CHECKPOINT WITH MINIMAL DATA (FAST)
    // ─────────────────────────────────────────────────────────────────────────
    const name = event.operation || event.type;
    const data = {
        _id: event.observabilityLogId, // Always include for traceability
    };
    // CRITICAL: Errors always get full context
    if (event.error) {
        data.error = event.error;
        if (event.data)
            data.data = event.data; // Error payload critical for debugging
    }
    // CRITICAL: Failures always recorded
    if (event.success === false) {
        data.success = false;
    }
    // Entity context (ONLY if different - cheap string comparison)
    if (event.entityId && event.entityId !== parent.event.entityId) {
        data.entityId = event.entityId;
    }
    if (event.entityName && event.entityName !== parent.event.entityName) {
        data.entityName = event.entityName;
    }
    // Status markers (checkpoint-specific, usually different)
    if (event.status)
        data.status = event.status;
    if (event.subType)
        data.subType = event.subType;
    // Duration if significant (>10ms threshold)
    if (event.durationMs !== undefined && event.durationMs > 10) {
        data.durationMs = event.durationMs;
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 3. DEBUG MODE: Include verbose context (opt-in)
    // ─────────────────────────────────────────────────────────────────────────
    if (bounds.includeDebugMetadata) {
        // Include data payload (if not already included for error)
        if (event.data && !event.error)
            data.data = event.data;
        // Include metadata for debugging
        if (event.source && event.source !== parent.event.source)
            data.source = event.source;
        if (event.level && event.level !== parent.event.level)
            data.level = event.level;
        if (event.attributes)
            data.attributes = event.attributes;
        if (event.context)
            data.context = event.context;
        if (event.metadata)
            data.metadata = event.metadata;
        // Rule info
        if (node.ruleId)
            data._rule = node.ruleId;
        if (node.reason)
            data._reason = node.reason;
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 4. APPEND CHECKPOINT TO PARENT
    // ─────────────────────────────────────────────────────────────────────────
    (0, utils_1.appendCheckpointBounded)(parent.event, config, {
        name: `metrics.folded:${name}`, // Keep original naming for backward compatibility
        ts: event.timestampMs,
        metrics: event.metrics,
        data,
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZm9sZGluZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L25vaXNlLXJlZHVjdGlvbi9vcGVyYXRpb25zL2ZvbGRpbmcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOztHQUVHOztBQTRCSCx3Q0F3RkM7QUFoSEQsb0NBQThEO0FBRTlEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FxQkc7QUFDSCxTQUFnQixjQUFjLENBQUMsSUFBYyxFQUFFLE1BQTRCO0lBQ3pFLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTTtRQUFFLE9BQU87SUFFekIsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQztJQUMzQixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ3pCLE1BQU0sTUFBTSxHQUFHLElBQUEsaUJBQVMsRUFBQyxNQUFNLENBQUMsQ0FBQztJQUVqQyw0RUFBNEU7SUFDNUUseURBQXlEO0lBQ3pELDRFQUE0RTtJQUU1RSxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNsQixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUMxQixNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7UUFDNUIsQ0FBQztRQUNELEtBQUssTUFBTSxDQUFFLENBQUMsRUFBRSxDQUFDLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ3JELE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFFLENBQUMsQ0FBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUUsQ0FBQyxDQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ25FLENBQUM7SUFDSCxDQUFDO0lBRUQsNEVBQTRFO0lBQzVFLCtDQUErQztJQUMvQyw0RUFB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SSxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDO0lBQzlDLENBQUM7SUFFRCw0RUFBNEU7SUFDNUUsaUNBQWlDO0lBQ2pDLDRFQUE0RTtJQUU1RSxJQUFBLCtCQUF1QixFQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFO1FBQzVDLElBQUksRUFBRSxrQkFBa0IsSUFBSSxFQUFFLEVBQUUsa0RBQWtEO1FBQ2xGLEVBQUUsRUFBRSxLQUFLLENBQUMsV0FBVztRQUNyQixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87UUFDdEIsSUFBSTtLQUNMLENBQUMsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEZvbGRpbmcgb3BlcmF0aW9ucyAtIGNvbGxhcHNpbmcgZXZlbnRzIGludG8gcGFyZW50IGFzIGNoZWNrcG9pbnRzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTm9pc2VSZWR1Y3Rpb25Db25maWcgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5pbXBvcnQgdHlwZSB7IFRyZWVOb2RlIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQsIGdldEJvdW5kcyB9IGZyb20gJy4uL3V0aWxzJztcblxuLyoqXG4gKiBGb2xkIGFuIGV2ZW50IGludG8gaXRzIHBhcmVudCBzcGFuIGFzIGEgY2hlY2twb2ludC5cbiAqIFxuICogUFVSUE9TRTogQ29sbGFwc2Ugbm9pc3kgY2hpbGQgZXZlbnRzIGludG8gcGFyZW50IHRpbWVsaW5lLCBwcmVzZXJ2aW5nXG4gKiBtZXRyaWNzIGFuZCBjcml0aWNhbCBjb250ZXh0LiBVc2VkIGZvciByZXBldGl0aXZlIG9wZXJhdGlvbnMgKGNhY2hlIGhpdHMsXG4gKiB2YWxpZGF0aW9uIHN0ZXBzLCBldGMuKSB0aGF0IG5lZWQgdGltZWxpbmUgbWFya2VycyBidXQgbm90IHN0YW5kYWxvbmUgcmVjb3Jkcy5cbiAqIFxuICogUEVSRk9STUFOQ0UgQ1JJVElDQUw6IFJ1bnMgZHVyaW5nIGZsdXNoIG9uIHBvdGVudGlhbGx5IDEwMDArIGV2ZW50cy5cbiAqIC0gTk8gSlNPTi5zdHJpbmdpZnkoKVxuICogLSBOTyBPYmplY3Qua2V5cygpLmxlbmd0aCBjaGVja3NcbiAqIC0gTk8gZGVlcCBvYmplY3QgY29tcGFyaXNvbnNcbiAqIC0gU2ltcGxlIHN0cmluZyBjb21wYXJpc29ucyBvbmx5XG4gKiBcbiAqIERFU0lHTjpcbiAqIC0gTWV0cmljczogTWVyZ2VkIGludG8gcGFyZW50IChhZGRpdGl2ZSBhZ2dyZWdhdGlvbilcbiAqIC0gVGltZWxpbmU6IFNpbmdsZSBjaGVja3BvaW50IHdpdGggdGltZXN0YW1wXG4gKiAtIENyaXRpY2FsIGRhdGE6IEVycm9ycywgZmFpbHVyZXMsIGVudGl0eSBJRHNcbiAqIC0gQ29tbW9uIGRhdGE6IEluaGVyaXRlZCBmcm9tIHBhcmVudCAoTk9UIGR1cGxpY2F0ZWQpXG4gKiBcbiAqIEBwYXJhbSBub2RlIC0gTm9kZSB0byBmb2xkIChjaGlsZClcbiAqIEBwYXJhbSBjb25maWcgLSBOb2lzZSByZWR1Y3Rpb24gY29uZmlndXJhdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9sZEludG9QYXJlbnQobm9kZTogVHJlZU5vZGUsIGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcpOiB2b2lkIHtcbiAgaWYgKCFub2RlLnBhcmVudCkgcmV0dXJuO1xuXG4gIGNvbnN0IHBhcmVudCA9IG5vZGUucGFyZW50O1xuICBjb25zdCBldmVudCA9IG5vZGUuZXZlbnQ7XG4gIGNvbnN0IGJvdW5kcyA9IGdldEJvdW5kcyhjb25maWcpO1xuXG4gIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAvLyAxLiBNRVJHRSBNRVRSSUNTIElOVE8gUEFSRU5UIChmYXN0IGFkZGl0aXZlIG9wZXJhdGlvbilcbiAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgaWYgKGV2ZW50Lm1ldHJpY3MpIHtcbiAgICBpZiAoIXBhcmVudC5ldmVudC5tZXRyaWNzKSB7XG4gICAgICBwYXJlbnQuZXZlbnQubWV0cmljcyA9IHt9O1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IFsgaywgdiBdIG9mIE9iamVjdC5lbnRyaWVzKGV2ZW50Lm1ldHJpY3MpKSB7XG4gICAgICBwYXJlbnQuZXZlbnQubWV0cmljc1sgayBdID0gKHBhcmVudC5ldmVudC5tZXRyaWNzWyBrIF0gPz8gMCkgKyB2O1xuICAgIH1cbiAgfVxuXG4gIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAvLyAyLiBCVUlMRCBDSEVDS1BPSU5UIFdJVEggTUlOSU1BTCBEQVRBIChGQVNUKVxuICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuICBjb25zdCBuYW1lID0gZXZlbnQub3BlcmF0aW9uIHx8IGV2ZW50LnR5cGU7XG4gIGNvbnN0IGRhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgIF9pZDogZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkLCAvLyBBbHdheXMgaW5jbHVkZSBmb3IgdHJhY2VhYmlsaXR5XG4gIH07XG5cbiAgLy8gQ1JJVElDQUw6IEVycm9ycyBhbHdheXMgZ2V0IGZ1bGwgY29udGV4dFxuICBpZiAoZXZlbnQuZXJyb3IpIHtcbiAgICBkYXRhLmVycm9yID0gZXZlbnQuZXJyb3I7XG4gICAgaWYgKGV2ZW50LmRhdGEpIGRhdGEuZGF0YSA9IGV2ZW50LmRhdGE7IC8vIEVycm9yIHBheWxvYWQgY3JpdGljYWwgZm9yIGRlYnVnZ2luZ1xuICB9XG5cbiAgLy8gQ1JJVElDQUw6IEZhaWx1cmVzIGFsd2F5cyByZWNvcmRlZFxuICBpZiAoZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UpIHtcbiAgICBkYXRhLnN1Y2Nlc3MgPSBmYWxzZTtcbiAgfVxuXG4gIC8vIEVudGl0eSBjb250ZXh0IChPTkxZIGlmIGRpZmZlcmVudCAtIGNoZWFwIHN0cmluZyBjb21wYXJpc29uKVxuICBpZiAoZXZlbnQuZW50aXR5SWQgJiYgZXZlbnQuZW50aXR5SWQgIT09IHBhcmVudC5ldmVudC5lbnRpdHlJZCkge1xuICAgIGRhdGEuZW50aXR5SWQgPSBldmVudC5lbnRpdHlJZDtcbiAgfVxuXG4gIGlmIChldmVudC5lbnRpdHlOYW1lICYmIGV2ZW50LmVudGl0eU5hbWUgIT09IHBhcmVudC5ldmVudC5lbnRpdHlOYW1lKSB7XG4gICAgZGF0YS5lbnRpdHlOYW1lID0gZXZlbnQuZW50aXR5TmFtZTtcbiAgfVxuXG4gIC8vIFN0YXR1cyBtYXJrZXJzIChjaGVja3BvaW50LXNwZWNpZmljLCB1c3VhbGx5IGRpZmZlcmVudClcbiAgaWYgKGV2ZW50LnN0YXR1cykgZGF0YS5zdGF0dXMgPSBldmVudC5zdGF0dXM7XG4gIGlmIChldmVudC5zdWJUeXBlKSBkYXRhLnN1YlR5cGUgPSBldmVudC5zdWJUeXBlO1xuXG4gIC8vIER1cmF0aW9uIGlmIHNpZ25pZmljYW50ICg+MTBtcyB0aHJlc2hvbGQpXG4gIGlmIChldmVudC5kdXJhdGlvbk1zICE9PSB1bmRlZmluZWQgJiYgZXZlbnQuZHVyYXRpb25NcyA+IDEwKSB7XG4gICAgZGF0YS5kdXJhdGlvbk1zID0gZXZlbnQuZHVyYXRpb25NcztcbiAgfVxuXG4gIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAvLyAzLiBERUJVRyBNT0RFOiBJbmNsdWRlIHZlcmJvc2UgY29udGV4dCAob3B0LWluKVxuICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuICBpZiAoYm91bmRzLmluY2x1ZGVEZWJ1Z01ldGFkYXRhKSB7XG4gICAgLy8gSW5jbHVkZSBkYXRhIHBheWxvYWQgKGlmIG5vdCBhbHJlYWR5IGluY2x1ZGVkIGZvciBlcnJvcilcbiAgICBpZiAoZXZlbnQuZGF0YSAmJiAhZXZlbnQuZXJyb3IpIGRhdGEuZGF0YSA9IGV2ZW50LmRhdGE7XG5cbiAgICAvLyBJbmNsdWRlIG1ldGFkYXRhIGZvciBkZWJ1Z2dpbmdcbiAgICBpZiAoZXZlbnQuc291cmNlICYmIGV2ZW50LnNvdXJjZSAhPT0gcGFyZW50LmV2ZW50LnNvdXJjZSkgZGF0YS5zb3VyY2UgPSBldmVudC5zb3VyY2U7XG4gICAgaWYgKGV2ZW50LmxldmVsICYmIGV2ZW50LmxldmVsICE9PSBwYXJlbnQuZXZlbnQubGV2ZWwpIGRhdGEubGV2ZWwgPSBldmVudC5sZXZlbDtcbiAgICBpZiAoZXZlbnQuYXR0cmlidXRlcykgZGF0YS5hdHRyaWJ1dGVzID0gZXZlbnQuYXR0cmlidXRlcztcbiAgICBpZiAoZXZlbnQuY29udGV4dCkgZGF0YS5jb250ZXh0ID0gZXZlbnQuY29udGV4dDtcbiAgICBpZiAoZXZlbnQubWV0YWRhdGEpIGRhdGEubWV0YWRhdGEgPSBldmVudC5tZXRhZGF0YTtcblxuICAgIC8vIFJ1bGUgaW5mb1xuICAgIGlmIChub2RlLnJ1bGVJZCkgZGF0YS5fcnVsZSA9IG5vZGUucnVsZUlkO1xuICAgIGlmIChub2RlLnJlYXNvbikgZGF0YS5fcmVhc29uID0gbm9kZS5yZWFzb247XG4gIH1cblxuICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgLy8gNC4gQVBQRU5EIENIRUNLUE9JTlQgVE8gUEFSRU5UXG4gIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gIGFwcGVuZENoZWNrcG9pbnRCb3VuZGVkKHBhcmVudC5ldmVudCwgY29uZmlnLCB7XG4gICAgbmFtZTogYG1ldHJpY3MuZm9sZGVkOiR7bmFtZX1gLCAvLyBLZWVwIG9yaWdpbmFsIG5hbWluZyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgIHRzOiBldmVudC50aW1lc3RhbXBNcyxcbiAgICBtZXRyaWNzOiBldmVudC5tZXRyaWNzLFxuICAgIGRhdGEsXG4gIH0pO1xufVxuIl19