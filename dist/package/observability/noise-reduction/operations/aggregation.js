"use strict";
/**
 * Aggregation operations - summarizing multiple events into buckets.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregateIntoParent = aggregateIntoParent;
const utils_1 = require("../utils");
/**
 * Aggregate an event into its parent span's aggregate buckets.
 *
 * PURPOSE: Summarize many similar events (e.g., batch processing 1000 items)
 * into statistics + limited examples. Shows patterns without storing every event.
 *
 * PERFORMANCE CRITICAL: Runs during flush on potentially 1000+ events.
 * - Fast bucket lookups
 * - Minimal field copies
 * - Examples only if configured
 *
 * OUTPUT:
 * - Statistics: count, errorCount, durationSum, durationMax
 * - Success examples: Minimal (ID + timing only)
 * - Error examples: Full context (critical for debugging)
 *
 * @param node - Node to aggregate (child)
 * @param config - Noise reduction configuration
 */
function aggregateIntoParent(node, config) {
    if (!node.parent)
        return;
    const parent = node.parent;
    const event = node.event;
    const bounds = (0, utils_1.getBounds)(config);
    // Get or create noise reduction data on parent
    const data = (0, utils_1.ensureSpanData)(parent.event);
    const nrData = (data.noiseReduction ?? {});
    if (!nrData.aggregates) {
        nrData.aggregates = {};
    }
    // Create aggregate key from event type and operation/source
    const key = `${event.type}:${event.operation ?? event.source ?? event.type}`;
    let bucket = nrData.aggregates[key];
    let isNewBucket = false;
    if (!bucket) {
        // Track bucket count internally (avoid Object.keys() on every call)
        if (!nrData._bucketCount)
            nrData._bucketCount = 0;
        // Check if we've hit the limit for aggregate keys
        if (nrData._bucketCount >= bounds.maxAggregateKeysPerSpan) {
            nrData.aggregateTruncated = true;
            return; // Don't create new bucket if limit reached
        }
        // Create new bucket
        bucket = {
            count: 0,
            errorCount: 0,
            durationSumMs: 0,
            durationMaxMs: 0,
            examples: [],
            errorExamples: [],
            rules: {},
        };
        nrData.aggregates[key] = bucket;
        nrData._bucketCount++;
        isNewBucket = true;
    }
    // ─────────────────────────────────────────────────────────────────────────
    // UPDATE STATISTICS (FAST)
    // ─────────────────────────────────────────────────────────────────────────
    bucket.count++;
    if (event.durationMs !== undefined) {
        bucket.durationSumMs += event.durationMs;
        bucket.durationMaxMs = Math.max(bucket.durationMaxMs, event.durationMs);
    }
    // Track which rule matched
    if (node.ruleId) {
        bucket.rules[node.ruleId] = (bucket.rules[node.ruleId] ?? 0) + 1;
    }
    // ─────────────────────────────────────────────────────────────────────────
    // CAPTURE EXAMPLES (if configured)
    // ─────────────────────────────────────────────────────────────────────────
    if (!bounds.includeExamples) {
        // Examples disabled - skip expensive example creation
        if (!event.success || event.error) {
            bucket.errorCount++;
        }
    }
    else if (!event.success || event.error) {
        // ERROR EXAMPLE: Capture full context (critical for debugging)
        bucket.errorCount++;
        if (bucket.errorExamples.length < bounds.maxAggregateErrorExamplesPerKey) {
            const errorExample = {
                observabilityLogId: event.observabilityLogId,
                type: event.type,
                level: event.level,
                operation: event.operation,
                entityId: event.entityId, // Critical for identifying which entity failed
                entityName: event.entityName,
                durationMs: event.durationMs,
                success: event.success,
                error: event.error
                    ? { type: event.error.type ?? 'Error', message: event.error.message ?? '' }
                    : undefined,
                // Error context (important for debugging)
                status: event.status,
                subType: event.subType,
                data: event.data, // Full error payload
                tags: event.tags,
                metrics: event.metrics,
                actor: event.actor,
                causedBy: event.causedBy,
                ruleId: node.ruleId,
            };
            bucket.errorExamples.push(errorExample);
        }
    }
    else {
        // SUCCESS EXAMPLE: Minimal data (just ID + timing for reference)
        if (bucket.examples.length < bounds.maxAggregateExamplesPerKey) {
            const example = {
                observabilityLogId: event.observabilityLogId,
                type: event.type,
                level: event.level,
                operation: event.operation,
                entityId: event.entityId, // Just the ID for lookup/reference
                entityName: event.entityName,
                durationMs: event.durationMs,
                success: event.success,
                // Minimal context (no heavy payloads for successful operations)
                status: event.status,
                subType: event.subType,
                ruleId: node.ruleId,
                // DEBUG MODE: Include tags/metrics for pattern analysis
                tags: bounds.includeDebugMetadata ? event.tags : undefined,
                metrics: bounds.includeDebugMetadata ? event.metrics : undefined,
            };
            bucket.examples.push(example);
        }
    }
    // Save updated noise reduction data
    data.noiseReduction = nrData;
    // ─────────────────────────────────────────────────────────────────────────
    // CREATE/UPDATE AGGREGATE CHECKPOINT
    // ─────────────────────────────────────────────────────────────────────────
    // Each aggregate bucket gets its own checkpoint showing what was aggregated,
    // timing, counts, and error stats. This provides a proper timeline view.
    const checkpointName = `aggregate:${key}`;
    // Build checkpoint with complete aggregate stats
    const aggregateCheckpoint = {
        name: checkpointName,
        ts: Date.now(),
        metrics: {
            'aggregate.count': bucket.count,
            'aggregate.error_count': bucket.errorCount,
            'aggregate.duration_sum_ms': bucket.durationSumMs,
            'aggregate.duration_max_ms': bucket.durationMaxMs,
            'aggregate.duration_avg_ms': bucket.count > 0 ? Math.round(bucket.durationSumMs / bucket.count) : 0,
        },
        data: {
            aggregateKey: key,
            eventType: event.type,
            operation: event.operation ?? event.source ?? event.type,
            // Include rule breakdown
            rules: Object.keys(bucket.rules).length > 0 ? bucket.rules : undefined,
            // Include sample IDs for traceability (from examples)
            sampleIds: bounds.includeExamples && bucket.examples.length > 0
                ? bucket.examples.slice(0, 3).map(ex => ex.observabilityLogId)
                : undefined,
        },
    };
    // Add tags if first event had relevant tags
    if (event.entityName) {
        if (!aggregateCheckpoint.tags)
            aggregateCheckpoint.tags = {};
        aggregateCheckpoint.tags['aggregate.entity_name'] = event.entityName;
    }
    // Find and update existing checkpoint, or add new one
    if (!data.checkpoints)
        data.checkpoints = [];
    const existingCheckpointIndex = data.checkpoints.findIndex((cp) => cp.name === checkpointName);
    if (existingCheckpointIndex >= 0) {
        // Update existing checkpoint with latest stats
        data.checkpoints[existingCheckpointIndex] = aggregateCheckpoint;
    }
    else {
        // Add new checkpoint (respecting bounds)
        (0, utils_1.appendCheckpointBounded)(parent.event, config, aggregateCheckpoint);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWdncmVnYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vb3BlcmF0aW9ucy9hZ2dyZWdhdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7O0dBRUc7O0FBeUJILGtEQWdMQztBQXJNRCxvQ0FBOEU7QUFFOUU7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQWtCRztBQUNILFNBQWdCLG1CQUFtQixDQUFDLElBQWMsRUFBRSxNQUE0QjtJQUM5RSxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU07UUFBRSxPQUFPO0lBRXpCLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDM0IsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztJQUN6QixNQUFNLE1BQU0sR0FBRyxJQUFBLGlCQUFTLEVBQUMsTUFBTSxDQUFDLENBQUM7SUFFakMsK0NBQStDO0lBQy9DLE1BQU0sSUFBSSxHQUFHLElBQUEsc0JBQWMsRUFBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDMUMsTUFBTSxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsY0FBYyxJQUFJLEVBQUUsQ0FBdUIsQ0FBQztJQUNqRSxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ3ZCLE1BQU0sQ0FBQyxVQUFVLEdBQUcsRUFBRSxDQUFDO0lBQ3pCLENBQUM7SUFFRCw0REFBNEQ7SUFDNUQsTUFBTSxHQUFHLEdBQUcsR0FBRyxLQUFLLENBQUMsSUFBSSxJQUFJLEtBQUssQ0FBQyxTQUFTLElBQUksS0FBSyxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDN0UsSUFBSSxNQUFNLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBRSxHQUFHLENBQUUsQ0FBQztJQUN0QyxJQUFJLFdBQVcsR0FBRyxLQUFLLENBQUM7SUFFeEIsSUFBSSxDQUFDLE1B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SUFDL0UsQ0FBQztTQUFNLENBQUM7UUFDTix5Q0FBeUM7UUFDekMsSUFBQSwrQkFBdUIsRUFBQyxNQUFNLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO0lBQ3JFLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBBZ2dyZWdhdGlvbiBvcGVyYXRpb25zIC0gc3VtbWFyaXppbmcgbXVsdGlwbGUgZXZlbnRzIGludG8gYnVja2V0cy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IE5vaXNlUmVkdWN0aW9uQ29uZmlnLCBTcGFuQ2hlY2twb2ludCB9IGZyb20gJy4uLy4uL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgVHJlZU5vZGUsIEFnZ3JlZ2F0ZUJ1Y2tldCwgTm9pc2VSZWR1Y3Rpb25EYXRhLCBBZ2dyZWdhdGVFeGFtcGxlLCBBZ2dyZWdhdGVFcnJvckV4YW1wbGUgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBhcHBlbmRDaGVja3BvaW50Qm91bmRlZCwgZW5zdXJlU3BhbkRhdGEsIGdldEJvdW5kcyB9IGZyb20gJy4uL3V0aWxzJztcblxuLyoqXG4gKiBBZ2dyZWdhdGUgYW4gZXZlbnQgaW50byBpdHMgcGFyZW50IHNwYW4ncyBhZ2dyZWdhdGUgYnVja2V0cy5cbiAqIFxuICogUFVSUE9TRTogU3VtbWFyaXplIG1hbnkgc2ltaWxhciBldmVudHMgKGUuZy4sIGJhdGNoIHByb2Nlc3NpbmcgMTAwMCBpdGVtcylcbiAqIGludG8gc3RhdGlzdGljcyArIGxpbWl0ZWQgZXhhbXBsZXMuIFNob3dzIHBhdHRlcm5zIHdpdGhvdXQgc3RvcmluZyBldmVyeSBldmVudC5cbiAqIFxuICogUEVSRk9STUFOQ0UgQ1JJVElDQUw6IFJ1bnMgZHVyaW5nIGZsdXNoIG9uIHBvdGVudGlhbGx5IDEwMDArIGV2ZW50cy5cbiAqIC0gRmFzdCBidWNrZXQgbG9va3Vwc1xuICogLSBNaW5pbWFsIGZpZWxkIGNvcGllc1xuICogLSBFeGFtcGxlcyBvbmx5IGlmIGNvbmZpZ3VyZWRcbiAqIFxuICogT1VUUFVUOlxuICogLSBTdGF0aXN0aWNzOiBjb3VudCwgZXJyb3JDb3VudCwgZHVyYXRpb25TdW0sIGR1cmF0aW9uTWF4XG4gKiAtIFN1Y2Nlc3MgZXhhbXBsZXM6IE1pbmltYWwgKElEICsgdGltaW5nIG9ubHkpXG4gKiAtIEVycm9yIGV4YW1wbGVzOiBGdWxsIGNvbnRleHQgKGNyaXRpY2FsIGZvciBkZWJ1Z2dpbmcpXG4gKiBcbiAqIEBwYXJhbSBub2RlIC0gTm9kZSB0byBhZ2dyZWdhdGUgKGNoaWxkKVxuICogQHBhcmFtIGNvbmZpZyAtIE5vaXNlIHJlZHVjdGlvbiBjb25maWd1cmF0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZ2dyZWdhdGVJbnRvUGFyZW50KG5vZGU6IFRyZWVOb2RlLCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnKTogdm9pZCB7XG4gIGlmICghbm9kZS5wYXJlbnQpIHJldHVybjtcblxuICBjb25zdCBwYXJlbnQgPSBub2RlLnBhcmVudDtcbiAgY29uc3QgZXZlbnQgPSBub2RlLmV2ZW50O1xuICBjb25zdCBib3VuZHMgPSBnZXRCb3VuZHMoY29uZmlnKTtcblxuICAvLyBHZXQgb3IgY3JlYXRlIG5vaXNlIHJlZHVjdGlvbiBkYXRhIG9uIHBhcmVudFxuICBjb25zdCBkYXRhID0gZW5zdXJlU3BhbkRhdGEocGFyZW50LmV2ZW50KTtcbiAgY29uc3QgbnJEYXRhID0gKGRhdGEubm9pc2VSZWR1Y3Rpb24gPz8ge30pIGFzIE5vaXNlUmVkdWN0aW9uRGF0YTtcbiAgaWYgKCFuckRhdGEuYWdncmVnYXRlcykge1xuICAgIG5yRGF0YS5hZ2dyZWdhdGVzID0ge307XG4gIH1cblxuICAvLyBDcmVhdGUgYWdncmVnYXRlIGtleSBmcm9tIGV2ZW50IHR5cGUgYW5kIG9wZXJhdGlvbi9zb3VyY2VcbiAgY29uc3Qga2V5ID0gYCR7ZXZlbnQudHlwZX06JHtldmVudC5vcGVyYXRpb24gPz8gZXZlbnQuc291cmNlID8/IGV2ZW50LnR5cGV9YDtcbiAgbGV0IGJ1Y2tldCA9IG5yRGF0YS5hZ2dyZWdhdGVzWyBrZXkgXTtcbiAgbGV0IGlzTmV3QnVja2V0ID0gZmFsc2U7XG5cbiAgaWYgKCFidWNrZXQpIHtcbiAgICAvLyBUcmFjayBidWNrZXQgY291bnQgaW50ZXJuYWxseSAoYXZvaWQgT2JqZWN0LmtleXMoKSBvbiBldmVyeSBjYWxsKVxuICAgIGlmICghbnJEYXRhLl9idWNrZXRDb3VudCkgbnJEYXRhLl9idWNrZXRDb3VudCA9IDA7XG5cbiAgICAvLyBDaGVjayBpZiB3ZSd2ZSBoaXQgdGhlIGxpbWl0IGZvciBhZ2dyZWdhdGUga2V5c1xuICAgIGlmIChuckRhdGEuX2J1Y2tldENvdW50ID49IGJvdW5kcy5tYXhBZ2dyZWdhdGVLZXlzUGVyU3Bhbikge1xuICAgICAgbnJEYXRhLmFnZ3JlZ2F0ZVRydW5jYXRlZCA9IHRydWU7XG4gICAgICByZXR1cm47IC8vIERvbid0IGNyZWF0ZSBuZXcgYnVja2V0IGlmIGxpbWl0IHJlYWNoZWRcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgbmV3IGJ1Y2tldFxuICAgIGJ1Y2tldCA9IHtcbiAgICAgIGNvdW50OiAwLFxuICAgICAgZXJyb3JDb3VudDogMCxcbiAgICAgIGR1cmF0aW9uU3VtTXM6IDAsXG4gICAgICBkdXJhdGlvbk1heE1zOiAwLFxuICAgICAgZXhhbXBsZXM6IFtdLFxuICAgICAgZXJyb3JFeGFtcGxlczogW10sXG4gICAgICBydWxlczoge30sXG4gICAgfTtcbiAgICBuckRhdGEuYWdncmVnYXRlc1sga2V5IF0gPSBidWNrZXQ7XG4gICAgbnJEYXRhLl9idWNrZXRDb3VudCsrO1xuICAgIGlzTmV3QnVja2V0ID0gdHJ1ZTtcbiAgfVxuXG4gIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAvLyBVUERBVEUgU1RBVElTVElDUyAoRkFTVClcbiAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgYnVja2V0LmNvdW50Kys7XG5cbiAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGJ1Y2tldC5kdXJhdGlvblN1bU1zICs9IGV2ZW50LmR1cmF0aW9uTXM7XG4gICAgYnVja2V0LmR1cmF0aW9uTWF4TXMgPSBNYXRoLm1heChidWNrZXQuZHVyYXRpb25NYXhNcywgZXZlbnQuZHVyYXRpb25Ncyk7XG4gIH1cblxuICAvLyBUcmFjayB3aGljaCBydWxlIG1hdGNoZWRcbiAgaWYgKG5vZGUucnVsZUlkKSB7XG4gICAgYnVja2V0LnJ1bGVzWyBub2RlLnJ1bGVJZCBdID0gKGJ1Y2tldC5ydWxlc1sgbm9kZS5ydWxlSWQgXSA/PyAwKSArIDE7XG4gIH1cblxuICAvLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgLy8gQ0FQVFVSRSBFWEFNUExFUyAoaWYgY29uZmlndXJlZClcbiAgLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgaWYgKCFib3VuZHMuaW5jbHVkZUV4YW1wbGVzKSB7XG4gICAgLy8gRXhhbXBsZXMgZGlzYWJsZWQgLSBza2lwIGV4cGVuc2l2ZSBleGFtcGxlIGNyZWF0aW9uXG4gICAgaWYgKCFldmVudC5zdWNjZXNzIHx8IGV2ZW50LmVycm9yKSB7XG4gICAgICBidWNrZXQuZXJyb3JDb3VudCsrO1xuICAgIH1cbiAgfSBlbHNlIGlmICghZXZlbnQuc3VjY2VzcyB8fCBldmVudC5lcnJvcikge1xuICAgIC8vIEVSUk9SIEVYQU1QTEU6IENhcHR1cmUgZnVsbCBjb250ZXh0IChjcml0aWNhbCBmb3IgZGVidWdnaW5nKVxuICAgIGJ1Y2tldC5lcnJvckNvdW50Kys7XG5cbiAgICBpZiAoYnVja2V0LmVycm9yRXhhbXBsZXMubGVuZ3RoIDwgYm91bmRzLm1heEFnZ3JlZ2F0ZUVycm9yRXhhbXBsZXNQZXJLZXkpIHtcbiAgICAgIGNvbnN0IGVycm9yRXhhbXBsZTogQWdncmVnYXRlRXJyb3JFeGFtcGxlID0ge1xuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgICAgdHlwZTogZXZlbnQudHlwZSxcbiAgICAgICAgbGV2ZWw6IGV2ZW50LmxldmVsLFxuICAgICAgICBvcGVyYXRpb246IGV2ZW50Lm9wZXJhdGlvbixcbiAgICAgICAgZW50aXR5SWQ6IGV2ZW50LmVudGl0eUlkLCAvLyBDcml0aWNhbCBmb3IgaWRlbnRpZnlpbmcgd2hpY2ggZW50aXR5IGZhaWxlZFxuICAgICAgICBlbnRpdHlOYW1lOiBldmVudC5lbnRpdHlOYW1lLFxuICAgICAgICBkdXJhdGlvbk1zOiBldmVudC5kdXJhdGlvbk1zLFxuICAgICAgICBzdWNjZXNzOiBldmVudC5zdWNjZXNzLFxuICAgICAgICBlcnJvcjogZXZlbnQuZXJyb3JcbiAgICAgICAgICA/IHsgdHlwZTogZXZlbnQuZXJyb3IudHlwZSA/PyAnRXJyb3InLCBtZXNzYWdlOiBldmVudC5lcnJvci5tZXNzYWdlID8/ICcnIH1cbiAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgLy8gRXJyb3IgY29udGV4dCAoaW1wb3J0YW50IGZvciBkZWJ1Z2dpbmcpXG4gICAgICAgIHN0YXR1czogZXZlbnQuc3RhdHVzLFxuICAgICAgICBzdWJUeXBlOiBldmVudC5zdWJUeXBlLFxuICAgICAgICBkYXRhOiBldmVudC5kYXRhLCAvLyBGdWxsIGVycm9yIHBheWxvYWRcbiAgICAgICAgdGFnczogZXZlbnQudGFncyxcbiAgICAgICAgbWV0cmljczogZXZlbnQubWV0cmljcyxcbiAgICAgICAgYWN0b3I6IGV2ZW50LmFjdG9yLFxuICAgICAgICBjYXVzZWRCeTogZXZlbnQuY2F1c2VkQnksXG4gICAgICAgIHJ1bGVJZDogbm9kZS5ydWxlSWQsXG4gICAgICB9O1xuICAgICAgYnVja2V0LmVycm9yRXhhbXBsZXMucHVzaChlcnJvckV4YW1wbGUpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBTVUNDRVNTIEVYQU1QTEU6IE1pbmltYWwgZGF0YSAoanVzdCBJRCArIHRpbWluZyBmb3IgcmVmZXJlbmNlKVxuICAgIGlmIChidWNrZXQuZXhhbXBsZXMubGVuZ3RoIDwgYm91bmRzLm1heEFnZ3JlZ2F0ZUV4YW1wbGVzUGVyS2V5KSB7XG4gICAgICBjb25zdCBleGFtcGxlOiBBZ2dyZWdhdGVFeGFtcGxlID0ge1xuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgICAgdHlwZTogZXZlbnQudHlwZSxcbiAgICAgICAgbGV2ZWw6IGV2ZW50LmxldmVsLFxuICAgICAgICBvcGVyYXRpb246IGV2ZW50Lm9wZXJhdGlvbixcbiAgICAgICAgZW50aXR5SWQ6IGV2ZW50LmVudGl0eUlkLCAvLyBKdXN0IHRoZSBJRCBmb3IgbG9va3VwL3JlZmVyZW5jZVxuICAgICAgICBlbnRpdHlOYW1lOiBldmVudC5lbnRpdHlOYW1lLFxuICAgICAgICBkdXJhdGlvbk1zOiBldmVudC5kdXJhdGlvbk1zLFxuICAgICAgICBzdWNjZXNzOiBldmVudC5zdWNjZXNzLFxuICAgICAgICAvLyBNaW5pbWFsIGNvbnRleHQgKG5vIGhlYXZ5IHBheWxvYWRzIGZvciBzdWNjZXNzZnVsIG9wZXJhdGlvbnMpXG4gICAgICAgIHN0YXR1czogZXZlbnQuc3RhdHVzLFxuICAgICAgICBzdWJUeXBlOiBldmVudC5zdWJUeXBlLFxuICAgICAgICBydWxlSWQ6IG5vZGUucnVsZUlkLFxuICAgICAgICAvLyBERUJVRyBNT0RFOiBJbmNsdWRlIHRhZ3MvbWV0cmljcyBmb3IgcGF0dGVybiBhbmFseXNpc1xuICAgICAgICB0YWdzOiBib3VuZHMuaW5jbHVkZURlYnVnTWV0YWRhdGEgPyBldmVudC50YWdzIDogdW5kZWZpbmVkLFxuICAgICAgICBtZXRyaWNzOiBib3VuZHMuaW5jbHVkZURlYnVnTWV0YWRhdGEgPyBldmVudC5tZXRyaWNzIDogdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICAgIGJ1Y2tldC5leGFtcGxlcy5wdXNoKGV4YW1wbGUpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFNhdmUgdXBkYXRlZCBub2lzZSByZWR1Y3Rpb24gZGF0YVxuICBkYXRhLm5vaXNlUmVkdWN0aW9uID0gbnJEYXRhO1xuXG4gIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAvLyBDUkVBVEUvVVBEQVRFIEFHR1JFR0FURSBDSEVDS1BPSU5UXG4gIC8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAvLyBFYWNoIGFnZ3JlZ2F0ZSBidWNrZXQgZ2V0cyBpdHMgb3duIGNoZWNrcG9pbnQgc2hvd2luZyB3aGF0IHdhcyBhZ2dyZWdhdGVkLFxuICAvLyB0aW1pbmcsIGNvdW50cywgYW5kIGVycm9yIHN0YXRzLiBUaGlzIHByb3ZpZGVzIGEgcHJvcGVyIHRpbWVsaW5lIHZpZXcuXG5cbiAgY29uc3QgY2hlY2twb2ludE5hbWUgPSBgYWdncmVnYXRlOiR7a2V5fWA7XG5cbiAgLy8gQnVpbGQgY2hlY2twb2ludCB3aXRoIGNvbXBsZXRlIGFnZ3JlZ2F0ZSBzdGF0c1xuICBjb25zdCBhZ2dyZWdhdGVDaGVja3BvaW50OiBhbnkgPSB7XG4gICAgbmFtZTogY2hlY2twb2ludE5hbWUsXG4gICAgdHM6IERhdGUubm93KCksXG4gICAgbWV0cmljczoge1xuICAgICAgJ2FnZ3JlZ2F0ZS5jb3VudCc6IGJ1Y2tldC5jb3VudCxcbiAgICAgICdhZ2dyZWdhdGUuZXJyb3JfY291bnQnOiBidWNrZXQuZXJyb3JDb3VudCxcbiAgICAgICdhZ2dyZWdhdGUuZHVyYXRpb25fc3VtX21zJzogYnVja2V0LmR1cmF0aW9uU3VtTXMsXG4gICAgICAnYWdncmVnYXRlLmR1cmF0aW9uX21heF9tcyc6IGJ1Y2tldC5kdXJhdGlvbk1heE1zLFxuICAgICAgJ2FnZ3JlZ2F0ZS5kdXJhdGlvbl9hdmdfbXMnOiBidWNrZXQuY291bnQgPiAwID8gTWF0aC5yb3VuZChidWNrZXQuZHVyYXRpb25TdW1NcyAvIGJ1Y2tldC5jb3VudCkgOiAwLFxuICAgIH0sXG4gICAgZGF0YToge1xuICAgICAgYWdncmVnYXRlS2V5OiBrZXksXG4gICAgICBldmVudFR5cGU6IGV2ZW50LnR5cGUsXG4gICAgICBvcGVyYXRpb246IGV2ZW50Lm9wZXJhdGlvbiA/PyBldmVudC5zb3VyY2UgPz8gZXZlbnQudHlwZSxcbiAgICAgIC8vIEluY2x1ZGUgcnVsZSBicmVha2Rvd25cbiAgICAgIHJ1bGVzOiBPYmplY3Qua2V5cyhidWNrZXQucnVsZXMpLmxlbmd0aCA+IDAgPyBidWNrZXQucnVsZXMgOiB1bmRlZmluZWQsXG4gICAgICAvLyBJbmNsdWRlIHNhbXBsZSBJRHMgZm9yIHRyYWNlYWJpbGl0eSAoZnJvbSBleGFtcGxlcylcbiAgICAgIHNhbXBsZUlkczogYm91bmRzLmluY2x1ZGVFeGFtcGxlcyAmJiBidWNrZXQuZXhhbXBsZXMubGVuZ3RoID4gMFxuICAgICAgICA/IGJ1Y2tldC5leGFtcGxlcy5zbGljZSgwLCAzKS5tYXAoZXggPT4gZXgub2JzZXJ2YWJpbGl0eUxvZ0lkKVxuICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICB9LFxuICB9O1xuXG4gIC8vIEFkZCB0YWdzIGlmIGZpcnN0IGV2ZW50IGhhZCByZWxldmFudCB0YWdzXG4gIGlmIChldmVudC5lbnRpdHlOYW1lKSB7XG4gICAgaWYgKCFhZ2dyZWdhdGVDaGVja3BvaW50LnRhZ3MpIGFnZ3JlZ2F0ZUNoZWNrcG9pbnQudGFncyA9IHt9O1xuICAgIGFnZ3JlZ2F0ZUNoZWNrcG9pbnQudGFnc1sgJ2FnZ3JlZ2F0ZS5lbnRpdHlfbmFtZScgXSA9IGV2ZW50LmVudGl0eU5hbWU7XG4gIH1cblxuICAvLyBGaW5kIGFuZCB1cGRhdGUgZXhpc3RpbmcgY2hlY2twb2ludCwgb3IgYWRkIG5ldyBvbmVcbiAgaWYgKCFkYXRhLmNoZWNrcG9pbnRzKSBkYXRhLmNoZWNrcG9pbnRzID0gW107XG4gIGNvbnN0IGV4aXN0aW5nQ2hlY2twb2ludEluZGV4ID0gKGRhdGEuY2hlY2twb2ludHMgYXMgYW55W10pLmZpbmRJbmRleChcbiAgICAoY3A6IGFueSkgPT4gY3AubmFtZSA9PT0gY2hlY2twb2ludE5hbWVcbiAgKTtcblxuICBpZiAoZXhpc3RpbmdDaGVja3BvaW50SW5kZXggPj0gMCkge1xuICAgIC8vIFVwZGF0ZSBleGlzdGluZyBjaGVja3BvaW50IHdpdGggbGF0ZXN0IHN0YXRzXG4gICAgKGRhdGEuY2hlY2twb2ludHMgYXMgYW55W10pWyBleGlzdGluZ0NoZWNrcG9pbnRJbmRleCBdID0gYWdncmVnYXRlQ2hlY2twb2ludDtcbiAgfSBlbHNlIHtcbiAgICAvLyBBZGQgbmV3IGNoZWNrcG9pbnQgKHJlc3BlY3RpbmcgYm91bmRzKVxuICAgIGFwcGVuZENoZWNrcG9pbnRCb3VuZGVkKHBhcmVudC5ldmVudCwgY29uZmlnLCBhZ2dyZWdhdGVDaGVja3BvaW50KTtcbiAgfVxufVxuIl19