"use strict";
/**
 * Observability Context
 *
 * Re-exports from the core execution context module for observability use.
 *
 * @module observability/context
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toW3CParentId = exports.toW3CTraceId = exports.createStepFunctionsContext = exports.createEventBridgeContext = exports.createSnsAttributes = exports.createSqsAttributes = exports.createHttpHeaders = exports.extractFromKinesis = exports.extractFromStepFunctions = exports.extractFromEventBridge = exports.extractFromSns = exports.extractFromSqsRecord = exports.extractFromSqs = exports.extractFromHeaders = exports.setSource = exports.setAttributes = exports.setAttribute = exports.addTags = exports.enrichActor = exports.setActor = exports.getCurrentParentObservabilityLogId = exports.getCapturedParentId = exports.getCurrentSpan = exports.getObservabilityState = exports.getCurrentExecutionContext = exports.runWithExecutionContextSync = exports.runWithExecutionContext = exports.createExecutionContext = void 0;
exports.getCorrelationIdIfExists = getCorrelationIdIfExists;
exports.getCurrentContext = getCurrentContext;
exports.withContext = withContext;
// Re-export everything from core execution context
var execution_context_1 = require("../core/runtime/execution-context");
// Storage & Lifecycle
Object.defineProperty(exports, "createExecutionContext", { enumerable: true, get: function () { return execution_context_1.createExecutionContext; } });
Object.defineProperty(exports, "runWithExecutionContext", { enumerable: true, get: function () { return execution_context_1.runWithExecutionContext; } });
Object.defineProperty(exports, "runWithExecutionContextSync", { enumerable: true, get: function () { return execution_context_1.runWithExecutionContextSync; } });
Object.defineProperty(exports, "getCurrentExecutionContext", { enumerable: true, get: function () { return execution_context_1.getCurrentExecutionContext; } });
Object.defineProperty(exports, "getObservabilityState", { enumerable: true, get: function () { return execution_context_1.getObservabilityState; } });
Object.defineProperty(exports, "getCurrentSpan", { enumerable: true, get: function () { return execution_context_1.getCurrentSpan; } });
// Parent Resolution
Object.defineProperty(exports, "getCapturedParentId", { enumerable: true, get: function () { return execution_context_1.getCapturedParentId; } });
Object.defineProperty(exports, "getCurrentParentObservabilityLogId", { enumerable: true, get: function () { return execution_context_1.getCurrentParentObservabilityLogId; } });
// Enrichment
Object.defineProperty(exports, "setActor", { enumerable: true, get: function () { return execution_context_1.setActor; } });
Object.defineProperty(exports, "enrichActor", { enumerable: true, get: function () { return execution_context_1.enrichActor; } });
Object.defineProperty(exports, "addTags", { enumerable: true, get: function () { return execution_context_1.addTags; } });
Object.defineProperty(exports, "setAttribute", { enumerable: true, get: function () { return execution_context_1.setAttribute; } });
Object.defineProperty(exports, "setAttributes", { enumerable: true, get: function () { return execution_context_1.setAttributes; } });
Object.defineProperty(exports, "setSource", { enumerable: true, get: function () { return execution_context_1.setSource; } });
// Propagation - Extraction
Object.defineProperty(exports, "extractFromHeaders", { enumerable: true, get: function () { return execution_context_1.extractFromHeaders; } });
Object.defineProperty(exports, "extractFromSqs", { enumerable: true, get: function () { return execution_context_1.extractFromSqs; } });
Object.defineProperty(exports, "extractFromSqsRecord", { enumerable: true, get: function () { return execution_context_1.extractFromSqsRecord; } });
Object.defineProperty(exports, "extractFromSns", { enumerable: true, get: function () { return execution_context_1.extractFromSns; } });
Object.defineProperty(exports, "extractFromEventBridge", { enumerable: true, get: function () { return execution_context_1.extractFromEventBridge; } });
Object.defineProperty(exports, "extractFromStepFunctions", { enumerable: true, get: function () { return execution_context_1.extractFromStepFunctions; } });
Object.defineProperty(exports, "extractFromKinesis", { enumerable: true, get: function () { return execution_context_1.extractFromKinesis; } });
// Propagation - Creation
Object.defineProperty(exports, "createHttpHeaders", { enumerable: true, get: function () { return execution_context_1.createHttpHeaders; } });
Object.defineProperty(exports, "createSqsAttributes", { enumerable: true, get: function () { return execution_context_1.createSqsAttributes; } });
Object.defineProperty(exports, "createSnsAttributes", { enumerable: true, get: function () { return execution_context_1.createSnsAttributes; } });
Object.defineProperty(exports, "createEventBridgeContext", { enumerable: true, get: function () { return execution_context_1.createEventBridgeContext; } });
Object.defineProperty(exports, "createStepFunctionsContext", { enumerable: true, get: function () { return execution_context_1.createStepFunctionsContext; } });
Object.defineProperty(exports, "toW3CTraceId", { enumerable: true, get: function () { return execution_context_1.toW3CTraceId; } });
Object.defineProperty(exports, "toW3CParentId", { enumerable: true, get: function () { return execution_context_1.toW3CParentId; } });
// ============================================================================
// Internal Helper (used by observability internals only)
// ============================================================================
const execution_context_2 = require("../core/runtime/execution-context");
/**
 * Get correlation ID if context exists - for internal use by observers
 * @internal
 */
function getCorrelationIdIfExists() {
    return (0, execution_context_2.getCurrentExecutionContext)()?.correlationId;
}
/**
 * Get current context - simpler name for internal use
 * @internal
 */
function getCurrentContext() {
    return (0, execution_context_2.getCurrentExecutionContext)();
}
// ============================================================================
// Context Override - Scoped context changes
// ============================================================================
const execution_context_3 = require("../core/runtime/execution-context");
const merge_1 = require("../utils/merge");
/**
 * Run function with context overrides.
 * Supports both sync and async functions automatically.
 *
 * All override fields are optional - only override what you need.
 * Tags are merged with existing by default.
 *
 * @example
 * ```typescript
 * // Override actor for system operations
 * withContext({ actor: systemActor }, () => {
 *   AuditObserver.entityDelete('User', userId, data);
 * });
 *
 * // Add batch tags
 * await withContext({ tags: { batchId: 'batch-123' } }, async () => {
 *   for (const item of items) {
 *     await processItem(item);
 *   }
 * });
 *
 * // Override source for a scope
 * withContext({ source: 'WorkflowEngine' }, () => {
 *   // All logs/spans in here will have source='WorkflowEngine'
 * });
 * ```
 */
function withContext(overrides, fn) {
    const currentCtx = (0, execution_context_2.getCurrentExecutionContext)();
    if (!currentCtx) {
        // No context exists - create one if correlationId is provided, otherwise just run
        if (overrides.correlationId) {
            const newCtx = (0, execution_context_3.createExecutionContext)({
                correlationId: overrides.correlationId,
                causedBy: overrides.causedBy,
                actor: overrides.actor,
                source: overrides.source,
                tags: overrides.tags ?? overrides.replaceTags,
                metadata: overrides.metadata, // metadata goes to state.metadata
            });
            // IMPORTANT: run fn INSIDE the newly created execution context.
            // Do NOT call fn() before runWithExecutionContext(), or spans/logs won't see the context.
            const result = fn();
            if (result instanceof Promise) {
                return (0, execution_context_3.runWithExecutionContext)(newCtx, () => result);
            }
            return (0, execution_context_3.runWithExecutionContextSync)(newCtx, () => result);
        }
        // No correlationId and no context - just run
        return fn();
    }
    // Build overridden context
    const newObservability = { ...currentCtx.observability };
    if (overrides.source !== undefined) {
        newObservability.source = overrides.source;
    }
    if (overrides.replaceTags !== undefined) {
        // Replace tags entirely
        newObservability.tags = { ...overrides.replaceTags };
    }
    else if (overrides.tags !== undefined) {
        // Merge tags (shallow is fine for flat key-value)
        newObservability.tags = { ...currentCtx.observability.tags, ...overrides.tags };
    }
    // Deep merge metadata into context metadata (flows to event.metadata)
    if (overrides.metadata !== undefined) {
        newObservability.metadata = (0, merge_1.merge)([
            currentCtx.observability.metadata,
            overrides.metadata
        ]) ?? {};
    }
    const newCtx = {
        ...currentCtx,
        correlationId: overrides.correlationId ?? currentCtx.correlationId,
        causedBy: overrides.causedBy ?? currentCtx.causedBy,
        actor: overrides.actor ?? currentCtx.actor,
        observability: newObservability,
    };
    // IMPORTANT: run fn INSIDE the overridden execution context.
    const result = fn();
    if (result instanceof Promise) {
        return (0, execution_context_3.runWithExecutionContext)(newCtx, () => result);
    }
    return (0, execution_context_3.runWithExecutionContextSync)(newCtx, () => result);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGV4dC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2NvbnRleHQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7O0FBZ0VILDREQUVDO0FBTUQsOENBRUM7QUFxQ0Qsa0NBa0VDO0FBL0tELG1EQUFtRDtBQUNuRCx1RUE4QzJDO0FBckN6QyxzQkFBc0I7QUFDdEIsMkhBQUEsc0JBQXNCLE9BQUE7QUFDdEIsNEhBQUEsdUJBQXVCLE9BQUE7QUFDdkIsZ0lBQUEsMkJBQTJCLE9BQUE7QUFDM0IsK0hBQUEsMEJBQTBCLE9BQUE7QUFDMUIsMEhBQUEscUJBQXFCLE9BQUE7QUFDckIsbUhBQUEsY0FBYyxPQUFBO0FBRWQsb0JBQW9CO0FBQ3BCLHdIQUFBLG1CQUFtQixPQUFBO0FBQ25CLHVJQUFBLGtDQUFrQyxPQUFBO0FBRWxDLGFBQWE7QUFDYiw2R0FBQSxRQUFRLE9BQUE7QUFDUixnSEFBQSxXQUFXLE9BQUE7QUFDWCw0R0FBQSxPQUFPLE9BQUE7QUFDUCxpSEFBQSxZQUFZLE9BQUE7QUFDWixrSEFBQSxhQUFhLE9BQUE7QUFDYiw4R0FBQSxTQUFTLE9BQUE7QUFFVCwyQkFBMkI7QUFDM0IsdUhBQUEsa0JBQWtCLE9BQUE7QUFDbEIsbUhBQUEsY0FBYyxPQUFBO0FBQ2QseUhBQUEsb0JBQW9CLE9BQUE7QUFDcEIsbUhBQUEsY0FBYyxPQUFBO0FBQ2QsMkhBQUEsc0JBQXNCLE9BQUE7QUFDdEIsNkhBQUEsd0JBQXdCLE9BQUE7QUFDeEIsdUhBQUEsa0JBQWtCLE9BQUE7QUFFbEIseUJBQXlCO0FBQ3pCLHNIQUFBLGlCQUFpQixPQUFBO0FBQ2pCLHdIQUFBLG1CQUFtQixPQUFBO0FBQ25CLHdIQUFBLG1CQUFtQixPQUFBO0FBQ25CLDZIQUFBLHdCQUF3QixPQUFBO0FBQ3hCLCtIQUFBLDBCQUEwQixPQUFBO0FBQzFCLGlIQUFBLFlBQVksT0FBQTtBQUNaLGtIQUFBLGFB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LENBQUMsYUFBYTtRQUNsRSxRQUFRLEVBQUUsU0FBUyxDQUFDLFFBQVEsSUFBSSxVQUFVLENBQUMsUUFBUTtRQUNuRCxLQUFLLEVBQUUsU0FBUyxDQUFDLEtBQUssSUFBSSxVQUFVLENBQUMsS0FBSztRQUMxQyxhQUFhLEVBQUUsZ0JBQWdCO0tBQ2hDLENBQUM7SUFFRiw2REFBNkQ7SUFDN0QsTUFBTSxNQUFNLEdBQUcsRUFBRSxFQUFFLENBQUM7SUFDcEIsSUFBSSxNQUFNLFlBQVksT0FBTyxFQUFFLENBQUM7UUFDOUIsT0FBTyxJQUFBLDJDQUF1QixFQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxNQUFNLENBQU0sQ0FBQztJQUM1RCxDQUFDO0lBQ0QsT0FBTyxJQUFBLCtDQUEyQixFQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUMzRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5IENvbnRleHRcbiAqIFxuICogUmUtZXhwb3J0cyBmcm9tIHRoZSBjb3JlIGV4ZWN1dGlvbiBjb250ZXh0IG1vZHVsZSBmb3Igb2JzZXJ2YWJpbGl0eSB1c2UuXG4gKiBcbiAqIEBtb2R1bGUgb2JzZXJ2YWJpbGl0eS9jb250ZXh0XG4gKi9cblxuLy8gUmUtZXhwb3J0IGV2ZXJ5dGhpbmcgZnJvbSBjb3JlIGV4ZWN1dGlvbiBjb250ZXh0XG5leHBvcnQge1xuICAvLyBUeXBlc1xuICB0eXBlIEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICB0eXBlIENyZWF0ZUV4ZWN1dGlvbkNvbnRleHRPcHRpb25zLFxuICB0eXBlIFBhcnNlZFRyYWNlQ29udGV4dCxcbiAgdHlwZSBPYnNlcnZhYmlsaXR5U3RhdGUsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eVN1bW1hcnksXG4gIHR5cGUgSVNwYW5Ob2RlLFxuXG4gIC8vIFN0b3JhZ2UgJiBMaWZlY3ljbGVcbiAgY3JlYXRlRXhlY3V0aW9uQ29udGV4dCxcbiAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0U3luYyxcbiAgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQsXG4gIGdldE9ic2VydmFiaWxpdHlTdGF0ZSxcbiAgZ2V0Q3VycmVudFNwYW4sXG5cbiAgLy8gUGFyZW50IFJlc29sdXRpb25cbiAgZ2V0Q2FwdHVyZWRQYXJlbnRJZCxcbiAgZ2V0Q3VycmVudFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcblxuICAvLyBFbnJpY2htZW50XG4gIHNldEFjdG9yLFxuICBlbnJpY2hBY3RvcixcbiAgYWRkVGFncyxcbiAgc2V0QXR0cmlidXRlLFxuICBzZXRBdHRyaWJ1dGVzLFxuICBzZXRTb3VyY2UsXG5cbiAgLy8gUHJvcGFnYXRpb24gLSBFeHRyYWN0aW9uXG4gIGV4dHJhY3RGcm9tSGVhZGVycyxcbiAgZXh0cmFjdEZyb21TcXMsXG4gIGV4dHJhY3RGcm9tU3FzUmVjb3JkLFxuICBleHRyYWN0RnJvbVNucyxcbiAgZXh0cmFjdEZyb21FdmVudEJyaWRnZSxcbiAgZXh0cmFjdEZyb21TdGVwRnVuY3Rpb25zLFxuICBleHRyYWN0RnJvbUtpbmVzaXMsXG5cbiAgLy8gUHJvcGFnYXRpb24gLSBDcmVhdGlvblxuICBjcmVhdGVIdHRwSGVhZGVycyxcbiAgY3JlYXRlU3FzQXR0cmlidXRlcyxcbiAgY3JlYXRlU25zQXR0cmlidXRlcyxcbiAgY3JlYXRlRXZlbnRCcmlkZ2VDb250ZXh0LFxuICBjcmVhdGVTdGVwRnVuY3Rpb25zQ29udGV4dCxcbiAgdG9XM0NUcmFjZUlkLFxuICB0b1czQ1BhcmVudElkLFxufSBmcm9tICcuLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQnO1xuXG4vLyBSZS1leHBvcnQgQWN0b3IgdHlwZSBmcm9tIGNvcmVcbmV4cG9ydCB0eXBlIHsgQWN0b3IgfSBmcm9tICcuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gSW50ZXJuYWwgSGVscGVyICh1c2VkIGJ5IG9ic2VydmFiaWxpdHkgaW50ZXJuYWxzIG9ubHkpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmltcG9ydCB7IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0LCB0eXBlIEV4ZWN1dGlvbkNvbnRleHREYXRhIH0gZnJvbSAnLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuLyoqIFxuICogR2V0IGNvcnJlbGF0aW9uIElEIGlmIGNvbnRleHQgZXhpc3RzIC0gZm9yIGludGVybmFsIHVzZSBieSBvYnNlcnZlcnNcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpPy5jb3JyZWxhdGlvbklkO1xufVxuXG4vKipcbiAqIEdldCBjdXJyZW50IGNvbnRleHQgLSBzaW1wbGVyIG5hbWUgZm9yIGludGVybmFsIHVzZVxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRDdXJyZW50Q29udGV4dCgpOiBFeGVjdXRpb25Db250ZXh0RGF0YSB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb250ZXh0IE92ZXJyaWRlIC0gU2NvcGVkIGNvbnRleHQgY2hhbmdlc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5pbXBvcnQgeyBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCwgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHRTeW5jLCBjcmVhdGVFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB0eXBlIHsgQ29udGV4dE92ZXJyaWRlcyB9IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgbWVyZ2UgfSBmcm9tICcuLi91dGlscy9tZXJnZSc7XG5cbi8qKlxuICogUnVuIGZ1bmN0aW9uIHdpdGggY29udGV4dCBvdmVycmlkZXMuXG4gKiBTdXBwb3J0cyBib3RoIHN5bmMgYW5kIGFzeW5jIGZ1bmN0aW9ucyBhdXRvbWF0aWNhbGx5LlxuICogXG4gKiBBbGwgb3ZlcnJpZGUgZmllbGRzIGFyZSBvcHRpb25hbCAtIG9ubHkgb3ZlcnJpZGUgd2hhdCB5b3UgbmVlZC5cbiAqIFRhZ3MgYXJlIG1lcmdlZCB3aXRoIGV4aXN0aW5nIGJ5IGRlZmF1bHQuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBPdmVycmlkZSBhY3RvciBmb3Igc3lzdGVtIG9wZXJhdGlvbnNcbiAqIHdpdGhDb250ZXh0KHsgYWN0b3I6IHN5c3RlbUFjdG9yIH0sICgpID0+IHtcbiAqICAgQXVkaXRPYnNlcnZlci5lbnRpdHlEZWxldGUoJ1VzZXInLCB1c2VySWQsIGRhdGEpO1xuICogfSk7XG4gKiBcbiAqIC8vIEFkZCBiYXRjaCB0YWdzXG4gKiBhd2FpdCB3aXRoQ29udGV4dCh7IHRhZ3M6IHsgYmF0Y2hJZDogJ2JhdGNoLTEyMycgfSB9LCBhc3luYyAoKSA9PiB7XG4gKiAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICogICAgIGF3YWl0IHByb2Nlc3NJdGVtKGl0ZW0pO1xuICogICB9XG4gKiB9KTtcbiAqIFxuICogLy8gT3ZlcnJpZGUgc291cmNlIGZvciBhIHNjb3BlXG4gKiB3aXRoQ29udGV4dCh7IHNvdXJjZTogJ1dvcmtmbG93RW5naW5lJyB9LCAoKSA9PiB7XG4gKiAgIC8vIEFsbCBsb2dzL3NwYW5zIGluIGhlcmUgd2lsbCBoYXZlIHNvdXJjZT0nV29ya2Zsb3dFbmdpbmUnXG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gd2l0aENvbnRleHQ8VD4oXG4gIG92ZXJyaWRlczogQ29udGV4dE92ZXJyaWRlcyxcbiAgZm46ICgpID0+IFRcbik6IFQge1xuICBjb25zdCBjdXJyZW50Q3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcblxuICBpZiAoIWN1cnJlbnRDdHgpIHtcbiAgICAvLyBObyBjb250ZXh0IGV4aXN0cyAtIGNyZWF0ZSBvbmUgaWYgY29ycmVsYXRpb25JZCBpcyBwcm92aWRlZCwgb3RoZXJ3aXNlIGp1c3QgcnVuXG4gICAgaWYgKG92ZXJyaWRlcy5jb3JyZWxhdGlvbklkKSB7XG4gICAgICBjb25zdCBuZXdDdHggPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgICAgY29ycmVsYXRpb25JZDogb3ZlcnJpZGVzLmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIGNhdXNlZEJ5OiBvdmVycmlkZXMuY2F1c2VkQnksXG4gICAgICAgIGFjdG9yOiBvdmVycmlkZXMuYWN0b3IsXG4gICAgICAgIHNvdXJjZTogb3ZlcnJpZGVzLnNvdXJjZSxcbiAgICAgICAgdGFnczogb3ZlcnJpZGVzLnRhZ3MgPz8gb3ZlcnJpZGVzLnJlcGxhY2VUYWdzLFxuICAgICAgICBtZXRhZGF0YTogb3ZlcnJpZGVzLm1ldGFkYXRhLCAvLyBtZXRhZGF0YSBnb2VzIHRvIHN0YXRlLm1ldGFkYXRhXG4gICAgICB9KTtcbiAgICAgIC8vIElNUE9SVEFOVDogcnVuIGZuIElOU0lERSB0aGUgbmV3bHkgY3JlYXRlZCBleGVjdXRpb24gY29udGV4dC5cbiAgICAgIC8vIERvIE5PVCBjYWxsIGZuKCkgYmVmb3JlIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KCksIG9yIHNwYW5zL2xvZ3Mgd29uJ3Qgc2VlIHRoZSBjb250ZXh0LlxuICAgICAgY29uc3QgcmVzdWx0ID0gZm4oKTtcbiAgICAgIGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChuZXdDdHgsICgpID0+IHJlc3VsdCkgYXMgVDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMobmV3Q3R4LCAoKSA9PiByZXN1bHQpO1xuICAgIH1cbiAgICAvLyBObyBjb3JyZWxhdGlvbklkIGFuZCBubyBjb250ZXh0IC0ganVzdCBydW5cbiAgICByZXR1cm4gZm4oKTtcbiAgfVxuXG4gIC8vIEJ1aWxkIG92ZXJyaWRkZW4gY29udGV4dFxuICBjb25zdCBuZXdPYnNlcnZhYmlsaXR5ID0geyAuLi5jdXJyZW50Q3R4Lm9ic2VydmFiaWxpdHkgfTtcblxuICBpZiAob3ZlcnJpZGVzLnNvdXJjZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbmV3T2JzZXJ2YWJpbGl0eS5zb3VyY2UgPSBvdmVycmlkZXMuc291cmNlO1xuICB9XG5cbiAgaWYgKG92ZXJyaWRlcy5yZXBsYWNlVGFncyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gUmVwbGFjZSB0YWdzIGVudGlyZWx5XG4gICAgbmV3T2JzZXJ2YWJpbGl0eS50YWdzID0geyAuLi5vdmVycmlkZXMucmVwbGFjZVRhZ3MgfTtcbiAgfSBlbHNlIGlmIChvdmVycmlkZXMudGFncyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gTWVyZ2UgdGFncyAoc2hhbGxvdyBpcyBmaW5lIGZvciBmbGF0IGtleS12YWx1ZSlcbiAgICBuZXdPYnNlcnZhYmlsaXR5LnRhZ3MgPSB7IC4uLmN1cnJlbnRDdHgub2JzZXJ2YWJpbGl0eS50YWdzLCAuLi5vdmVycmlkZXMudGFncyB9O1xuICB9XG5cbiAgLy8gRGVlcCBtZXJnZSBtZXRhZGF0YSBpbnRvIGNvbnRleHQgbWV0YWRhdGEgKGZsb3dzIHRvIGV2ZW50Lm1ldGFkYXRhKVxuICBpZiAob3ZlcnJpZGVzLm1ldGFkYXRhICE9PSB1bmRlZmluZWQpIHtcbiAgICBuZXdPYnNlcnZhYmlsaXR5Lm1ldGFkYXRhID0gbWVyZ2UoW1xuICAgICAgY3VycmVudEN0eC5vYnNlcnZhYmlsaXR5Lm1ldGFkYXRhLFxuICAgICAgb3ZlcnJpZGVzLm1ldGFkYXRhXG4gICAgXSkgPz8ge307XG4gIH1cblxuICBjb25zdCBuZXdDdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhID0ge1xuICAgIC4uLmN1cnJlbnRDdHgsXG4gICAgY29ycmVsYXRpb25JZDogb3ZlcnJpZGVzLmNvcnJlbGF0aW9uSWQgPz8gY3VycmVudEN0eC5jb3JyZWxhdGlvbklkLFxuICAgIGNhdXNlZEJ5OiBvdmVycmlkZXMuY2F1c2VkQnkgPz8gY3VycmVudEN0eC5jYXVzZWRCeSxcbiAgICBhY3Rvcjogb3ZlcnJpZGVzLmFjdG9yID8/IGN1cnJlbnRDdHguYWN0b3IsXG4gICAgb2JzZXJ2YWJpbGl0eTogbmV3T2JzZXJ2YWJpbGl0eSxcbiAgfTtcblxuICAvLyBJTVBPUlRBTlQ6IHJ1biBmbiBJTlNJREUgdGhlIG92ZXJyaWRkZW4gZXhlY3V0aW9uIGNvbnRleHQuXG4gIGNvbnN0IHJlc3VsdCA9IGZuKCk7XG4gIGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgcmV0dXJuIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KG5ld0N0eCwgKCkgPT4gcmVzdWx0KSBhcyBUO1xuICB9XG4gIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMobmV3Q3R4LCAoKSA9PiByZXN1bHQpO1xufVxuIl19