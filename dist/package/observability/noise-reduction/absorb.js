"use strict";
/**
 * Absorption Logic
 *
 * Handles merging data from absorbed/silenced events into the nearest
 * emitted ancestor's AbsorbedData structure.
 *
 * All operations are additive and bounded (capped by AbsorptionBounds).
 * No data is mutated on the original events.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMutableAbsorbed = createMutableAbsorbed;
exports.freezeAbsorbed = freezeAbsorbed;
exports.absorbEvent = absorbEvent;
exports.recordSilent = recordSilent;
/**
 * Create an empty mutable AbsorbedData builder.
 */
function createMutableAbsorbed() {
    return {
        count: 0,
        silentCount: 0,
        byOperation: {},
        errors: [],
        causedByLinks: [],
        entityIds: [],
        checkpoints: [],
    };
}
/**
 * Freeze a mutable AbsorbedData into an immutable one.
 * Returns undefined if no data was absorbed (count === 0 and silentCount === 0).
 */
function freezeAbsorbed(mutable) {
    if (mutable.count === 0 && mutable.silentCount === 0) {
        return undefined;
    }
    const frozenByOperation = {};
    for (const [key, stats] of Object.entries(mutable.byOperation)) {
        const frozen = {
            count: stats.count,
            errorCount: stats.errorCount,
            duration: stats.duration ? freezeDuration(stats.duration) : undefined,
        };
        frozenByOperation[key] = frozen;
    }
    return {
        count: mutable.count,
        silentCount: mutable.silentCount,
        byOperation: frozenByOperation,
        errors: [...mutable.errors],
        causedByLinks: [...mutable.causedByLinks],
        entityIds: [...mutable.entityIds],
        checkpoints: [...mutable.checkpoints],
    };
}
function freezeDuration(d) {
    return { sum: d.sum, min: d.min, max: d.max, count: d.count };
}
// ═══════════════════════════════════════════════════════════════════════════
// ABSORPTION OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Absorb an event's data into a mutable AbsorbedData builder.
 *
 * This records:
 * - Per-operation stats (count, errorCount, duration min/max/sum)
 * - Error details (capped)
 * - Cross-hop causedBy links (capped)
 * - Entity IDs (capped)
 *
 * All arrays are bounded by the provided bounds.
 */
function absorbEvent(target, event, bounds) {
    target.count++;
    const opKey = event.operation ?? event.type;
    // Update per-operation stats (bounded)
    if (Object.keys(target.byOperation).length < bounds.maxOperationKeysPerSpan || opKey in target.byOperation) {
        const opStats = getOrCreateOperationStats(target.byOperation, opKey);
        opStats.count++;
        // Track errors
        if (event.success === false || event.error != null) {
            opStats.errorCount++;
        }
        // Track duration
        if (event.durationMs != null) {
            updateDuration(opStats, event.durationMs);
        }
    }
    // Preserve error details (always, but capped)
    if ((event.success === false || event.error != null) && target.errors.length < bounds.maxErrorsPerSpan) {
        target.errors.push(createAbsorbedError(event));
    }
    // Preserve cross-hop causedBy links (capped, deduplicated)
    if (event.causedBy && target.causedByLinks.length < bounds.maxCausedByLinksPerSpan) {
        if (!target.causedByLinks.includes(event.causedBy)) {
            target.causedByLinks.push(event.causedBy);
        }
    }
    // Preserve entity IDs (capped, deduplicated)
    if (event.entityId && target.entityIds.length < bounds.maxEntityIdsPerSpan) {
        if (!target.entityIds.includes(event.entityId)) {
            target.entityIds.push(event.entityId);
        }
    }
    // Create a timeline checkpoint from the absorbed event (capped).
    // Per-item varying fields go here; shared context (tags, source, etc.) is
    // extracted into the group header at persistence time (manager.ts).
    if (target.checkpoints.length < bounds.maxCheckpointsPerSpan) {
        const checkpoint = {
            // Grouping key
            name: event.operation ?? event.type,
            // Per-item fields (vary across absorbed events)
            ts: event.timestampMs,
            durationMs: event.durationMs,
            success: event.success,
            observabilityLogId: event.observabilityLogId,
            entityId: event.entityId,
            status: event.status,
            causedBy: event.causedBy,
            metrics: event.metrics ? { ...event.metrics } : undefined,
            // Error details (only for failures) — preserve original message, fall back to type, then operation-qualified default
            error: (event.success === false || event.error != null)
                ? {
                    type: event.error?.type ?? 'unknown',
                    message: event.error?.message || event.error?.type || `${event.operation ?? event.type} failed`,
                }
                : undefined,
            // Shared context (stored here during collection, factored out to group at persistence)
            tags: event.tags ? { ...event.tags } : undefined,
            type: event.type,
            subType: event.subType,
            level: event.level,
            entityName: event.entityName,
            source: event.source,
        };
        target.checkpoints.push(checkpoint);
    }
}
/**
 * Record a silently dropped event (counter only, no data).
 */
function recordSilent(target) {
    target.silentCount++;
}
/**
 * Merge absorbed data from a child emitted node into the parent's absorbed data.
 * This happens when child nodes that were emitted had their own absorbed children,
 * and we want the parent to also know about them (for cascade queries).
 *
 * NOTE: We do NOT merge child's absorbed data into parent in the current design.
 * Each emitted node only carries absorbed data from its direct absorbed/silenced children.
 * This keeps the data model simple and predictable.
 */
// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function getOrCreateOperationStats(byOp, opKey) {
    let stats = byOp[opKey];
    if (!stats) {
        stats = { count: 0, errorCount: 0 };
        byOp[opKey] = stats;
    }
    return stats;
}
function updateDuration(stats, durationMs) {
    if (!stats.duration) {
        stats.duration = { sum: durationMs, min: durationMs, max: durationMs, count: 1 };
    }
    else {
        stats.duration.sum += durationMs;
        stats.duration.count++;
        if (durationMs < stats.duration.min)
            stats.duration.min = durationMs;
        if (durationMs > stats.duration.max)
            stats.duration.max = durationMs;
    }
}
function createAbsorbedError(event) {
    const rawError = event.error;
    const errorType = rawError?.type ?? (event.success === false ? 'failure' : 'unknown');
    const errorMessage = rawError?.message
        || rawError?.type
        || `${event.operation ?? event.type} failed (no error details)`;
    return {
        observabilityLogId: event.observabilityLogId,
        operation: event.operation,
        entityId: event.entityId,
        error: { type: errorType, message: errorMessage },
        durationMs: event.durationMs,
        causedBy: event.causedBy,
        tags: event.tags ? { ...event.tags } : undefined,
        fingerprint: event.fingerprint,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWJzb3JiLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL2Fic29yYi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7O0dBUUc7O0FBdUNILHNEQVVDO0FBTUQsd0NBd0JDO0FBcUJELGtDQTZFQztBQUtELG9DQUVDO0FBcEpEOztHQUVHO0FBQ0gsU0FBZ0IscUJBQXFCO0lBQ25DLE9BQU87UUFDTCxLQUFLLEVBQUUsQ0FBQztRQUNSLFdBQVcsRUFBRSxDQUFDO1FBQ2QsV0FBVyxFQUFFLEVBQUU7UUFDZixNQUFNLEVBQUUsRUFBRTtRQUNWLGFBQWEsRUFBRSxFQUFFO1FBQ2pCLFNBQVMsRUFBRSxFQUFFO1FBQ2IsV0FBVyxFQUFFLEVBQUU7S0FDaEIsQ0FBQztBQUNKLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFnQixjQUFjLENBQUMsT0FBNEI7SUFDekQsSUFBSSxPQUFPLENBQUMsS0FBSyxLQUFLLENBQUMsSUFBSSxPQUFPLENBQUMsV0FBVyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3JELE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCxNQUFNLGlCQUFpQixHQUFtQyxFQUFFLENBQUM7SUFDN0QsS0FBSyxNQUFNLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7UUFDL0QsTUFBTSxNQUFNLEdBQW1CO1lBQzdCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztZQUNsQixVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7WUFDNUIsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVM7U0FDdEUsQ0FBQztRQUNGLGlCQUFpQixDQUFDLEdBQUcs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Q2pELFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtRQUM1QixRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVE7UUFDeEIsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsR0FBRyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVM7UUFDaEQsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXO0tBQy9CLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBBYnNvcnB0aW9uIExvZ2ljXG4gKiBcbiAqIEhhbmRsZXMgbWVyZ2luZyBkYXRhIGZyb20gYWJzb3JiZWQvc2lsZW5jZWQgZXZlbnRzIGludG8gdGhlIG5lYXJlc3RcbiAqIGVtaXR0ZWQgYW5jZXN0b3IncyBBYnNvcmJlZERhdGEgc3RydWN0dXJlLlxuICogXG4gKiBBbGwgb3BlcmF0aW9ucyBhcmUgYWRkaXRpdmUgYW5kIGJvdW5kZWQgKGNhcHBlZCBieSBBYnNvcnB0aW9uQm91bmRzKS5cbiAqIE5vIGRhdGEgaXMgbXV0YXRlZCBvbiB0aGUgb3JpZ2luYWwgZXZlbnRzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eUV2ZW50LCBPYnNlcnZhYmlsaXR5RXJyb3IgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgdHlwZSB7IEFic29yYmVkRGF0YSwgQWJzb3JiZWRDaGVja3BvaW50LCBBYnNvcmJlZEVycm9yLCBBYnNvcnB0aW9uQm91bmRzLCBEdXJhdGlvblN0YXRzLCBPcGVyYXRpb25TdGF0cyB9IGZyb20gJy4vdHlwZXMnO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIE1VVEFCTEUgQlVJTERFUiAoaW50ZXJuYWwsIGZyb3plbiBiZWZvcmUgcmV0dXJuaW5nIHRvIGNhbGxlcilcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIE11dGFibGUgdmVyc2lvbiBvZiBBYnNvcmJlZERhdGEgdXNlZCBkdXJpbmcgY29uc3RydWN0aW9uLlxuICogRnJvemVuIGludG8gYW4gaW1tdXRhYmxlIEFic29yYmVkRGF0YSBiZWZvcmUgbGVhdmluZyB0aGUgYWxnb3JpdGhtLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIE11dGFibGVBYnNvcmJlZERhdGEge1xuICBjb3VudDogbnVtYmVyO1xuICBzaWxlbnRDb3VudDogbnVtYmVyO1xuICBieU9wZXJhdGlvbjogUmVjb3JkPHN0cmluZywgTXV0YWJsZU9wZXJhdGlvblN0YXRzPjtcbiAgZXJyb3JzOiBBYnNvcmJlZEVycm9yW107XG4gIGNhdXNlZEJ5TGlua3M6IHN0cmluZ1tdO1xuICBlbnRpdHlJZHM6IHN0cmluZ1tdO1xuICBjaGVja3BvaW50czogQWJzb3JiZWRDaGVja3BvaW50W107XG59XG5cbmludGVyZmFjZSBNdXRhYmxlT3BlcmF0aW9uU3RhdHMge1xuICBjb3VudDogbnVtYmVyO1xuICBlcnJvckNvdW50OiBudW1iZXI7XG4gIGR1cmF0aW9uPzogTXV0YWJsZUR1cmF0aW9uU3RhdHM7XG59XG5cbmludGVyZmFjZSBNdXRhYmxlRHVyYXRpb25TdGF0cyB7XG4gIHN1bTogbnVtYmVyO1xuICBtaW46IG51bWJlcjtcbiAgbWF4OiBudW1iZXI7XG4gIGNvdW50OiBudW1iZXI7XG59XG5cbi8qKlxuICogQ3JlYXRlIGFuIGVtcHR5IG11dGFibGUgQWJzb3JiZWREYXRhIGJ1aWxkZXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVNdXRhYmxlQWJzb3JiZWQoKTogTXV0YWJsZUFic29yYmVkRGF0YSB7XG4gIHJldHVybiB7XG4gICAgY291bnQ6IDAsXG4gICAgc2lsZW50Q291bnQ6IDAsXG4gICAgYnlPcGVyYXRpb246IHt9LFxuICAgIGVycm9yczogW10sXG4gICAgY2F1c2VkQnlMaW5rczogW10sXG4gICAgZW50aXR5SWRzOiBbXSxcbiAgICBjaGVja3BvaW50czogW10sXG4gIH07XG59XG5cbi8qKlxuICogRnJlZXplIGEgbXV0YWJsZSBBYnNvcmJlZERhdGEgaW50byBhbiBpbW11dGFibGUgb25lLlxuICogUmV0dXJucyB1bmRlZmluZWQgaWYgbm8gZGF0YSB3YXMgYWJzb3JiZWQgKGNvdW50ID09PSAwIGFuZCBzaWxlbnRDb3VudCA9PT0gMCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcmVlemVBYnNvcmJlZChtdXRhYmxlOiBNdXRhYmxlQWJzb3JiZWREYXRhKTogQWJzb3JiZWREYXRhIHwgdW5kZWZpbmVkIHtcbiAgaWYgKG11dGFibGUuY291bnQgPT09IDAgJiYgbXV0YWJsZS5zaWxlbnRDb3VudCA9PT0gMCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBjb25zdCBmcm96ZW5CeU9wZXJhdGlvbjogUmVjb3JkPHN0cmluZywgT3BlcmF0aW9uU3RhdHM+ID0ge307XG4gIGZvciAoY29uc3QgW2tleSwgc3RhdHNdIG9mIE9iamVjdC5lbnRyaWVzKG11dGFibGUuYnlPcGVyYXRpb24pKSB7XG4gICAgY29uc3QgZnJvemVuOiBPcGVyYXRpb25TdGF0cyA9IHtcbiAgICAgIGNvdW50OiBzdGF0cy5jb3VudCxcbiAgICAgIGVycm9yQ291bnQ6IHN0YXRzLmVycm9yQ291bnQsXG4gICAgICBkdXJhdGlvbjogc3RhdHMuZHVyYXRpb24gPyBmcmVlemVEdXJhdGlvbihzdGF0cy5kdXJhdGlvbikgOiB1bmRlZmluZWQsXG4gICAgfTtcbiAgICBmcm96ZW5CeU9wZXJhdGlvbltrZXldID0gZnJvemVuO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBjb3VudDogbXV0YWJsZS5jb3VudCxcbiAgICBzaWxlbnRDb3VudDogbXV0YWJsZS5zaWxlbnRDb3VudCxcbiAgICBieU9wZXJhdGlvbjogZnJvemVuQnlPcGVyYXRpb24sXG4gICAgZXJyb3JzOiBbLi4ubXV0YWJsZS5lcnJvcnNdLFxuICAgIGNhdXNlZEJ5TGlua3M6IFsuLi5tdXRhYmxlLmNhdXNlZEJ5TGlua3NdLFxuICAgIGVudGl0eUlkczogWy4uLm11dGFibGUuZW50aXR5SWRzXSxcbiAgICBjaGVja3BvaW50czogWy4uLm11dGFibGUuY2hlY2twb2ludHNdLFxuICB9O1xufVxuXG5mdW5jdGlvbiBmcmVlemVEdXJhdGlvbihkOiBNdXRhYmxlRHVyYXRpb25TdGF0cyk6IER1cmF0aW9uU3RhdHMge1xuICByZXR1cm4geyBzdW06IGQuc3VtLCBtaW46IGQubWluLCBtYXg6IGQubWF4LCBjb3VudDogZC5jb3VudCB9O1xufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIEFCU09SUFRJT04gT1BFUkFUSU9OU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogQWJzb3JiIGFuIGV2ZW50J3MgZGF0YSBpbnRvIGEgbXV0YWJsZSBBYnNvcmJlZERhdGEgYnVpbGRlci5cbiAqIFxuICogVGhpcyByZWNvcmRzOlxuICogLSBQZXItb3BlcmF0aW9uIHN0YXRzIChjb3VudCwgZXJyb3JDb3VudCwgZHVyYXRpb24gbWluL21heC9zdW0pXG4gKiAtIEVycm9yIGRldGFpbHMgKGNhcHBlZClcbiAqIC0gQ3Jvc3MtaG9wIGNhdXNlZEJ5IGxpbmtzIChjYXBwZWQpXG4gKiAtIEVudGl0eSBJRHMgKGNhcHBlZClcbiAqIFxuICogQWxsIGFycmF5cyBhcmUgYm91bmRlZCBieSB0aGUgcHJvdmlkZWQgYm91bmRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYWJzb3JiRXZlbnQoXG4gIHRhcmdldDogTXV0YWJsZUFic29yYmVkRGF0YSxcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgYm91bmRzOiBBYnNvcnB0aW9uQm91bmRzLFxuKTogdm9pZCB7XG4gIHRhcmdldC5jb3VudCsrO1xuXG4gIGNvbnN0IG9wS2V5ID0gZXZlbnQub3BlcmF0aW9uID8/IGV2ZW50LnR5cGU7XG5cbiAgLy8gVXBkYXRlIHBlci1vcGVyYXRpb24gc3RhdHMgKGJvdW5kZWQpXG4gIGlmIChPYmplY3Qua2V5cyh0YXJnZXQuYnlPcGVyYXRpb24pLmxlbmd0aCA8IGJvdW5kcy5tYXhPcGVyYXRpb25LZXlzUGVyU3BhbiB8fCBvcEtleSBpbiB0YXJnZXQuYnlPcGVyYXRpb24pIHtcbiAgICBjb25zdCBvcFN0YXRzID0gZ2V0T3JDcmVhdGVPcGVyYXRpb25TdGF0cyh0YXJnZXQuYnlPcGVyYXRpb24sIG9wS2V5KTtcbiAgICBvcFN0YXRzLmNvdW50Kys7XG5cbiAgICAvLyBUcmFjayBlcnJvcnNcbiAgICBpZiAoZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UgfHwgZXZlbnQuZXJyb3IgIT0gbnVsbCkge1xuICAgICAgb3BTdGF0cy5lcnJvckNvdW50Kys7XG4gICAgfVxuXG4gICAgLy8gVHJhY2sgZHVyYXRpb25cbiAgICBpZiAoZXZlbnQuZHVyYXRpb25NcyAhPSBudWxsKSB7XG4gICAgICB1cGRhdGVEdXJhdGlvbihvcFN0YXRzLCBldmVudC5kdXJhdGlvbk1zKTtcbiAgICB9XG4gIH1cblxuICAvLyBQcmVzZXJ2ZSBlcnJvciBkZXRhaWxzIChhbHdheXMsIGJ1dCBjYXBwZWQpXG4gIGlmICgoZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UgfHwgZXZlbnQuZXJyb3IgIT0gbnVsbCkgJiYgdGFyZ2V0LmVycm9ycy5sZW5ndGggPCBib3VuZHMubWF4RXJyb3JzUGVyU3Bhbikge1xuICAgIHRhcmdldC5lcnJvcnMucHVzaChjcmVhdGVBYnNvcmJlZEVycm9yKGV2ZW50KSk7XG4gIH1cblxuICAvLyBQcmVzZXJ2ZSBjcm9zcy1ob3AgY2F1c2VkQnkgbGlua3MgKGNhcHBlZCwgZGVkdXBsaWNhdGVkKVxuICBpZiAoZXZlbnQuY2F1c2VkQnkgJiYgdGFyZ2V0LmNhdXNlZEJ5TGlua3MubGVuZ3RoIDwgYm91bmRzLm1heENhdXNlZEJ5TGlua3NQZXJTcGFuKSB7XG4gICAgaWYgKCF0YXJnZXQuY2F1c2VkQnlMaW5rcy5pbmNsdWRlcyhldmVudC5jYXVzZWRCeSkpIHtcbiAgICAgIHRhcmdldC5jYXVzZWRCeUxpbmtzLnB1c2goZXZlbnQuY2F1c2VkQnkpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFByZXNlcnZlIGVudGl0eSBJRHMgKGNhcHBlZCwgZGVkdXBsaWNhdGVkKVxuICBpZiAoZXZlbnQuZW50aXR5SWQgJiYgdGFyZ2V0LmVudGl0eUlkcy5sZW5ndGggPCBib3VuZHMubWF4RW50aXR5SWRzUGVyU3Bhbikge1xuICAgIGlmICghdGFyZ2V0LmVudGl0eUlkcy5pbmNsdWRlcyhldmVudC5lbnRpdHlJZCkpIHtcbiAgICAgIHRhcmdldC5lbnRpdHlJZHMucHVzaChldmVudC5lbnRpdHlJZCk7XG4gICAgfVxuICB9XG5cbiAgLy8gQ3JlYXRlIGEgdGltZWxpbmUgY2hlY2twb2ludCBmcm9tIHRoZSBhYnNvcmJlZCBldmVudCAoY2FwcGVkKS5cbiAgLy8gUGVyLWl0ZW0gdmFyeWluZyBmaWVsZHMgZ28gaGVyZTsgc2hhcmVkIGNvbnRleHQgKHRhZ3MsIHNvdXJjZSwgZXRjLikgaXNcbiAgLy8gZXh0cmFjdGVkIGludG8gdGhlIGdyb3VwIGhlYWRlciBhdCBwZXJzaXN0ZW5jZSB0aW1lIChtYW5hZ2VyLnRzKS5cbiAgaWYgKHRhcmdldC5jaGVja3BvaW50cy5sZW5ndGggPCBib3VuZHMubWF4Q2hlY2twb2ludHNQZXJTcGFuKSB7XG4gICAgY29uc3QgY2hlY2twb2ludDogQWJzb3JiZWRDaGVja3BvaW50ID0ge1xuICAgICAgLy8gR3JvdXBpbmcga2V5XG4gICAgICBuYW1lOiBldmVudC5vcGVyYXRpb24gPz8gZXZlbnQudHlwZSxcbiAgICAgIC8vIFBlci1pdGVtIGZpZWxkcyAodmFyeSBhY3Jvc3MgYWJzb3JiZWQgZXZlbnRzKVxuICAgICAgdHM6IGV2ZW50LnRpbWVzdGFtcE1zLFxuICAgICAgZHVyYXRpb25NczogZXZlbnQuZHVyYXRpb25NcyxcbiAgICAgIHN1Y2Nlc3M6IGV2ZW50LnN1Y2Nlc3MsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIGVudGl0eUlkOiBldmVudC5lbnRpdHlJZCxcbiAgICAgIHN0YXR1czogZXZlbnQuc3RhdHVzLFxuICAgICAgY2F1c2VkQnk6IGV2ZW50LmNhdXNlZEJ5LFxuICAgICAgbWV0cmljczogZXZlbnQubWV0cmljcyA/IHsgLi4uZXZlbnQubWV0cmljcyB9IDogdW5kZWZpbmVkLFxuICAgICAgLy8gRXJyb3IgZGV0YWlscyAob25seSBmb3IgZmFpbHVyZXMpIOKAlCBwcmVzZXJ2ZSBvcmlnaW5hbCBtZXNzYWdlLCBmYWxsIGJhY2sgdG8gdHlwZSwgdGhlbiBvcGVyYXRpb24tcXVhbGlmaWVkIGRlZmF1bHRcbiAgICAgIGVycm9yOiAoZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UgfHwgZXZlbnQuZXJyb3IgIT0gbnVsbClcbiAgICAgICAgPyB7XG4gICAgICAgICAgICB0eXBlOiBldmVudC5lcnJvcj8udHlwZSA/PyAndW5rbm93bicsXG4gICAgICAgICAgICBtZXNzYWdlOiBldmVudC5lcnJvcj8ubWVzc2FnZSB8fCBldmVudC5lcnJvcj8udHlwZSB8fCBgJHtldmVudC5vcGVyYXRpb24gPz8gZXZlbnQudHlwZX0gZmFpbGVkYCxcbiAgICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgLy8gU2hhcmVkIGNvbnRleHQgKHN0b3JlZCBoZXJlIGR1cmluZyBjb2xsZWN0aW9uLCBmYWN0b3JlZCBvdXQgdG8gZ3JvdXAgYXQgcGVyc2lzdGVuY2UpXG4gICAgICB0YWdzOiBldmVudC50YWdzID8geyAuLi5ldmVudC50YWdzIH0gOiB1bmRlZmluZWQsXG4gICAgICB0eXBlOiBldmVudC50eXBlLFxuICAgICAgc3ViVHlwZTogZXZlbnQuc3ViVHlwZSxcbiAgICAgIGxldmVsOiBldmVudC5sZXZlbCxcbiAgICAgIGVudGl0eU5hbWU6IGV2ZW50LmVudGl0eU5hbWUsXG4gICAgICBzb3VyY2U6IGV2ZW50LnNvdXJjZSxcbiAgICB9O1xuICAgIHRhcmdldC5jaGVja3BvaW50cy5wdXNoKGNoZWNrcG9pbnQpO1xuICB9XG59XG5cbi8qKlxuICogUmVjb3JkIGEgc2lsZW50bHkgZHJvcHBlZCBldmVudCAoY291bnRlciBvbmx5LCBubyBkYXRhKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29yZFNpbGVudCh0YXJnZXQ6IE11dGFibGVBYnNvcmJlZERhdGEpOiB2b2lkIHtcbiAgdGFyZ2V0LnNpbGVudENvdW50Kys7XG59XG5cbi8qKlxuICogTWVyZ2UgYWJzb3JiZWQgZGF0YSBmcm9tIGEgY2hpbGQgZW1pdHRlZCBub2RlIGludG8gdGhlIHBhcmVudCdzIGFic29yYmVkIGRhdGEuXG4gKiBUaGlzIGhhcHBlbnMgd2hlbiBjaGlsZCBub2RlcyB0aGF0IHdlcmUgZW1pdHRlZCBoYWQgdGhlaXIgb3duIGFic29yYmVkIGNoaWxkcmVuLFxuICogYW5kIHdlIHdhbnQgdGhlIHBhcmVudCB0byBhbHNvIGtub3cgYWJvdXQgdGhlbSAoZm9yIGNhc2NhZGUgcXVlcmllcykuXG4gKiBcbiAqIE5PVEU6IFdlIGRvIE5PVCBtZXJnZSBjaGlsZCdzIGFic29yYmVkIGRhdGEgaW50byBwYXJlbnQgaW4gdGhlIGN1cnJlbnQgZGVzaWduLlxuICogRWFjaCBlbWl0dGVkIG5vZGUgb25seSBjYXJyaWVzIGFic29yYmVkIGRhdGEgZnJvbSBpdHMgZGlyZWN0IGFic29yYmVkL3NpbGVuY2VkIGNoaWxkcmVuLlxuICogVGhpcyBrZWVwcyB0aGUgZGF0YSBtb2RlbCBzaW1wbGUgYW5kIHByZWRpY3RhYmxlLlxuICovXG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gSU5URVJOQUwgSEVMUEVSU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmZ1bmN0aW9uIGdldE9yQ3JlYXRlT3BlcmF0aW9uU3RhdHMoXG4gIGJ5T3A6IFJlY29yZDxzdHJpbmcsIE11dGFibGVPcGVyYXRpb25TdGF0cz4sXG4gIG9wS2V5OiBzdHJpbmcsXG4pOiBNdXRhYmxlT3BlcmF0aW9uU3RhdHMge1xuICBsZXQgc3RhdHMgPSBieU9wW29wS2V5XTtcbiAgaWYgKCFzdGF0cykge1xuICAgIHN0YXRzID0geyBjb3VudDogMCwgZXJyb3JDb3VudDogMCB9O1xuICAgIGJ5T3Bbb3BLZXldID0gc3RhdHM7XG4gIH1cbiAgcmV0dXJuIHN0YXRzO1xufVxuXG5mdW5jdGlvbiB1cGRhdGVEdXJhdGlvbihzdGF0czogTXV0YWJsZU9wZXJhdGlvblN0YXRzLCBkdXJhdGlvbk1zOiBudW1iZXIpOiB2b2lkIHtcbiAgaWYgKCFzdGF0cy5kdXJhdGlvbikge1xuICAgIHN0YXRzLmR1cmF0aW9uID0geyBzdW06IGR1cmF0aW9uTXMsIG1pbjogZHVyYXRpb25NcywgbWF4OiBkdXJhdGlvbk1zLCBjb3VudDogMSB9O1xuICB9IGVsc2Uge1xuICAgIHN0YXRzLmR1cmF0aW9uLnN1bSArPSBkdXJhdGlvbk1zO1xuICAgIHN0YXRzLmR1cmF0aW9uLmNvdW50Kys7XG4gICAgaWYgKGR1cmF0aW9uTXMgPCBzdGF0cy5kdXJhdGlvbi5taW4pIHN0YXRzLmR1cmF0aW9uLm1pbiA9IGR1cmF0aW9uTXM7XG4gICAgaWYgKGR1cmF0aW9uTXMgPiBzdGF0cy5kdXJhdGlvbi5tYXgpIHN0YXRzLmR1cmF0aW9uLm1heCA9IGR1cmF0aW9uTXM7XG4gIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlQWJzb3JiZWRFcnJvcihldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogQWJzb3JiZWRFcnJvciB7XG4gIGNvbnN0IHJhd0Vycm9yID0gZXZlbnQuZXJyb3I7XG4gIGNvbnN0IGVycm9yVHlwZSA9IHJhd0Vycm9yPy50eXBlID8/IChldmVudC5zdWNjZXNzID09PSBmYWxzZSA/ICdmYWlsdXJlJyA6ICd1bmtub3duJyk7XG4gIGNvbnN0IGVycm9yTWVzc2FnZSA9IHJhd0Vycm9yPy5tZXNzYWdlXG4gICAgfHwgcmF3RXJyb3I/LnR5cGVcbiAgICB8fCBgJHtldmVudC5vcGVyYXRpb24gPz8gZXZlbnQudHlwZX0gZmFpbGVkIChubyBlcnJvciBkZXRhaWxzKWA7XG5cbiAgcmV0dXJuIHtcbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICBvcGVyYXRpb246IGV2ZW50Lm9wZXJhdGlvbixcbiAgICBlbnRpdHlJZDogZXZlbnQuZW50aXR5SWQsXG4gICAgZXJyb3I6IHsgdHlwZTogZXJyb3JUeXBlLCBtZXNzYWdlOiBlcnJvck1lc3NhZ2UgfSxcbiAgICBkdXJhdGlvbk1zOiBldmVudC5kdXJhdGlvbk1zLFxuICAgIGNhdXNlZEJ5OiBldmVudC5jYXVzZWRCeSxcbiAgICB0YWdzOiBldmVudC50YWdzID8geyAuLi5ldmVudC50YWdzIH0gOiB1bmRlZmluZWQsXG4gICAgZmluZ2VycHJpbnQ6IGV2ZW50LmZpbmdlcnByaW50LFxuICB9O1xufVxuIl19