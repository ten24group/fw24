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
            // runWithExecutionContextSync works for both sync and async functions
            // (it calls fn synchronously, but fn can return a Promise)
            return (0, execution_context_3.runWithExecutionContextSync)(newCtx, fn);
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
    // runWithExecutionContextSync works for both sync and async functions
    return (0, execution_context_3.runWithExecutionContextSync)(newCtx, fn);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGV4dC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2NvbnRleHQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7O0FBZ0VILDREQUVDO0FBTUQsOENBRUM7QUFxQ0Qsa0NBNERDO0FBektELG1EQUFtRDtBQUNuRCx1RUE4QzJDO0FBckN6QyxzQkFBc0I7QUFDdEIsMkhBQUEsc0JBQXNCLE9BQUE7QUFDdEIsNEhBQUEsdUJBQXVCLE9BQUE7QUFDdkIsZ0lBQUEsMkJBQTJCLE9BQUE7QUFDM0IsK0hBQUEsMEJBQTBCLE9BQUE7QUFDMUIsMEhBQUEscUJBQXFCLE9BQUE7QUFDckIsbUhBQUEsY0FBYyxPQUFBO0FBRWQsb0JBQW9CO0FBQ3BCLHdIQUFBLG1CQUFtQixPQUFBO0FBQ25CLHVJQUFBLGtDQUFrQyxPQUFBO0FBRWxDLGFBQWE7QUFDYiw2R0FBQSxRQUFRLE9BQUE7QUFDUixnSEFBQSxXQUFXLE9BQUE7QUFDWCw0R0FBQSxPQUFPLE9BQUE7QUFDUCxpSEFBQSxZQUFZLE9BQUE7QUFDWixrSEFBQSxhQUFhLE9BQUE7QUFDYiw4R0FBQSxTQUFTLE9BQUE7QUFFVCwyQkFBMkI7QUFDM0IsdUhBQUEsa0JBQWtCLE9BQUE7QUFDbEIsbUhBQUEsY0FBYyxPQUFBO0FBQ2QseUhBQUEsb0JBQW9CLE9BQUE7QUFDcEIsbUhBQUEsY0FBYyxPQUFBO0FBQ2QsMkhBQUEsc0JBQXNCLE9BQUE7QUFDdEIsNkhBQUEsd0JBQXdCLE9BQUE7QUFDeEIsdUhBQUEsa0JBQWtCLE9BQUE7QUFFbEIseUJBQXlCO0FBQ3pCLHNIQUFBLGlCQUFpQixPQUFBO0FBQ2pCLHdIQUFBLG1CQUFtQixPQUFBO0FBQ25CLHdIQUFBLG1CQUFtQixPQUFBO0FBQ25CLDZIQUFBLHdCQUF3QixPQUFBO0FBQ3hCLCtIQUFBLDBCQUEwQixPQUFBO0FBQzFCLGlIQUFBLFlBQVksT0FBQTtBQUNaLGtIQUFBLGFB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REFBNkQ7SUFDN0Qsc0VBQXNFO0lBQ3RFLE9BQU8sSUFBQSwrQ0FBMkIsRUFBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUM7QUFDakQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eSBDb250ZXh0XG4gKiBcbiAqIFJlLWV4cG9ydHMgZnJvbSB0aGUgY29yZSBleGVjdXRpb24gY29udGV4dCBtb2R1bGUgZm9yIG9ic2VydmFiaWxpdHkgdXNlLlxuICogXG4gKiBAbW9kdWxlIG9ic2VydmFiaWxpdHkvY29udGV4dFxuICovXG5cbi8vIFJlLWV4cG9ydCBldmVyeXRoaW5nIGZyb20gY29yZSBleGVjdXRpb24gY29udGV4dFxuZXhwb3J0IHtcbiAgLy8gVHlwZXNcbiAgdHlwZSBFeGVjdXRpb25Db250ZXh0RGF0YSxcbiAgdHlwZSBDcmVhdGVFeGVjdXRpb25Db250ZXh0T3B0aW9ucyxcbiAgdHlwZSBQYXJzZWRUcmFjZUNvbnRleHQsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eVN0YXRlLFxuICB0eXBlIE9ic2VydmFiaWxpdHlTdW1tYXJ5LFxuICB0eXBlIElTcGFuTm9kZSxcblxuICAvLyBTdG9yYWdlICYgTGlmZWN5Y2xlXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMsXG4gIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0LFxuICBnZXRPYnNlcnZhYmlsaXR5U3RhdGUsXG4gIGdldEN1cnJlbnRTcGFuLFxuXG4gIC8vIFBhcmVudCBSZXNvbHV0aW9uXG4gIGdldENhcHR1cmVkUGFyZW50SWQsXG4gIGdldEN1cnJlbnRQYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG5cbiAgLy8gRW5yaWNobWVudFxuICBzZXRBY3RvcixcbiAgZW5yaWNoQWN0b3IsXG4gIGFkZFRhZ3MsXG4gIHNldEF0dHJpYnV0ZSxcbiAgc2V0QXR0cmlidXRlcyxcbiAgc2V0U291cmNlLFxuXG4gIC8vIFByb3BhZ2F0aW9uIC0gRXh0cmFjdGlvblxuICBleHRyYWN0RnJvbUhlYWRlcnMsXG4gIGV4dHJhY3RGcm9tU3FzLFxuICBleHRyYWN0RnJvbVNxc1JlY29yZCxcbiAgZXh0cmFjdEZyb21TbnMsXG4gIGV4dHJhY3RGcm9tRXZlbnRCcmlkZ2UsXG4gIGV4dHJhY3RGcm9tU3RlcEZ1bmN0aW9ucyxcbiAgZXh0cmFjdEZyb21LaW5lc2lzLFxuXG4gIC8vIFByb3BhZ2F0aW9uIC0gQ3JlYXRpb25cbiAgY3JlYXRlSHR0cEhlYWRlcnMsXG4gIGNyZWF0ZVNxc0F0dHJpYnV0ZXMsXG4gIGNyZWF0ZVNuc0F0dHJpYnV0ZXMsXG4gIGNyZWF0ZUV2ZW50QnJpZGdlQ29udGV4dCxcbiAgY3JlYXRlU3RlcEZ1bmN0aW9uc0NvbnRleHQsXG4gIHRvVzNDVHJhY2VJZCxcbiAgdG9XM0NQYXJlbnRJZCxcbn0gZnJvbSAnLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuLy8gUmUtZXhwb3J0IEFjdG9yIHR5cGUgZnJvbSBjb3JlXG5leHBvcnQgdHlwZSB7IEFjdG9yIH0gZnJvbSAnLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEludGVybmFsIEhlbHBlciAodXNlZCBieSBvYnNlcnZhYmlsaXR5IGludGVybmFscyBvbmx5KVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5pbXBvcnQgeyBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCwgdHlwZSBFeGVjdXRpb25Db250ZXh0RGF0YSB9IGZyb20gJy4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dCc7XG5cbi8qKiBcbiAqIEdldCBjb3JyZWxhdGlvbiBJRCBpZiBjb250ZXh0IGV4aXN0cyAtIGZvciBpbnRlcm5hbCB1c2UgYnkgb2JzZXJ2ZXJzXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cygpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKT8uY29ycmVsYXRpb25JZDtcbn1cblxuLyoqXG4gKiBHZXQgY3VycmVudCBjb250ZXh0IC0gc2ltcGxlciBuYW1lIGZvciBpbnRlcm5hbCB1c2VcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0Q3VycmVudENvbnRleHQoKTogRXhlY3V0aW9uQ29udGV4dERhdGEgfCB1bmRlZmluZWQge1xuICByZXR1cm4gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29udGV4dCBPdmVycmlkZSAtIFNjb3BlZCBjb250ZXh0IGNoYW5nZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuaW1wb3J0IHsgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQsIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0U3luYywgY3JlYXRlRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgdHlwZSB7IENvbnRleHRPdmVycmlkZXMgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IG1lcmdlIH0gZnJvbSAnLi4vdXRpbHMvbWVyZ2UnO1xuXG4vKipcbiAqIFJ1biBmdW5jdGlvbiB3aXRoIGNvbnRleHQgb3ZlcnJpZGVzLlxuICogU3VwcG9ydHMgYm90aCBzeW5jIGFuZCBhc3luYyBmdW5jdGlvbnMgYXV0b21hdGljYWxseS5cbiAqIFxuICogQWxsIG92ZXJyaWRlIGZpZWxkcyBhcmUgb3B0aW9uYWwgLSBvbmx5IG92ZXJyaWRlIHdoYXQgeW91IG5lZWQuXG4gKiBUYWdzIGFyZSBtZXJnZWQgd2l0aCBleGlzdGluZyBieSBkZWZhdWx0LlxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gT3ZlcnJpZGUgYWN0b3IgZm9yIHN5c3RlbSBvcGVyYXRpb25zXG4gKiB3aXRoQ29udGV4dCh7IGFjdG9yOiBzeXN0ZW1BY3RvciB9LCAoKSA9PiB7XG4gKiAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5RGVsZXRlKCdVc2VyJywgdXNlcklkLCBkYXRhKTtcbiAqIH0pO1xuICogXG4gKiAvLyBBZGQgYmF0Y2ggdGFnc1xuICogYXdhaXQgd2l0aENvbnRleHQoeyB0YWdzOiB7IGJhdGNoSWQ6ICdiYXRjaC0xMjMnIH0gfSwgYXN5bmMgKCkgPT4ge1xuICogICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAqICAgICBhd2FpdCBwcm9jZXNzSXRlbShpdGVtKTtcbiAqICAgfVxuICogfSk7XG4gKiBcbiAqIC8vIE92ZXJyaWRlIHNvdXJjZSBmb3IgYSBzY29wZVxuICogd2l0aENvbnRleHQoeyBzb3VyY2U6ICdXb3JrZmxvd0VuZ2luZScgfSwgKCkgPT4ge1xuICogICAvLyBBbGwgbG9ncy9zcGFucyBpbiBoZXJlIHdpbGwgaGF2ZSBzb3VyY2U9J1dvcmtmbG93RW5naW5lJ1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdpdGhDb250ZXh0PFQ+KFxuICBvdmVycmlkZXM6IENvbnRleHRPdmVycmlkZXMsXG4gIGZuOiAoKSA9PiBUXG4pOiBUIHtcbiAgY29uc3QgY3VycmVudEN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG5cbiAgaWYgKCFjdXJyZW50Q3R4KSB7XG4gICAgLy8gTm8gY29udGV4dCBleGlzdHMgLSBjcmVhdGUgb25lIGlmIGNvcnJlbGF0aW9uSWQgaXMgcHJvdmlkZWQsIG90aGVyd2lzZSBqdXN0IHJ1blxuICAgIGlmIChvdmVycmlkZXMuY29ycmVsYXRpb25JZCkge1xuICAgICAgY29uc3QgbmV3Q3R4ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IG92ZXJyaWRlcy5jb3JyZWxhdGlvbklkLFxuICAgICAgICBjYXVzZWRCeTogb3ZlcnJpZGVzLmNhdXNlZEJ5LFxuICAgICAgICBhY3Rvcjogb3ZlcnJpZGVzLmFjdG9yLFxuICAgICAgICBzb3VyY2U6IG92ZXJyaWRlcy5zb3VyY2UsXG4gICAgICAgIHRhZ3M6IG92ZXJyaWRlcy50YWdzID8/IG92ZXJyaWRlcy5yZXBsYWNlVGFncyxcbiAgICAgICAgbWV0YWRhdGE6IG92ZXJyaWRlcy5tZXRhZGF0YSwgLy8gbWV0YWRhdGEgZ29lcyB0byBzdGF0ZS5tZXRhZGF0YVxuICAgICAgfSk7XG4gICAgICAvLyBJTVBPUlRBTlQ6IHJ1biBmbiBJTlNJREUgdGhlIG5ld2x5IGNyZWF0ZWQgZXhlY3V0aW9uIGNvbnRleHQuXG4gICAgICAvLyBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMgd29ya3MgZm9yIGJvdGggc3luYyBhbmQgYXN5bmMgZnVuY3Rpb25zXG4gICAgICAvLyAoaXQgY2FsbHMgZm4gc3luY2hyb25vdXNseSwgYnV0IGZuIGNhbiByZXR1cm4gYSBQcm9taXNlKVxuICAgICAgcmV0dXJuIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0U3luYyhuZXdDdHgsIGZuKTtcbiAgICB9XG4gICAgLy8gTm8gY29ycmVsYXRpb25JZCBhbmQgbm8gY29udGV4dCAtIGp1c3QgcnVuXG4gICAgcmV0dXJuIGZuKCk7XG4gIH1cblxuICAvLyBCdWlsZCBvdmVycmlkZGVuIGNvbnRleHRcbiAgY29uc3QgbmV3T2JzZXJ2YWJpbGl0eSA9IHsgLi4uY3VycmVudEN0eC5vYnNlcnZhYmlsaXR5IH07XG5cbiAgaWYgKG92ZXJyaWRlcy5zb3VyY2UgIT09IHVuZGVmaW5lZCkge1xuICAgIG5ld09ic2VydmFiaWxpdHkuc291cmNlID0gb3ZlcnJpZGVzLnNvdXJjZTtcbiAgfVxuXG4gIGlmIChvdmVycmlkZXMucmVwbGFjZVRhZ3MgIT09IHVuZGVmaW5lZCkge1xuICAgIC8vIFJlcGxhY2UgdGFncyBlbnRpcmVseVxuICAgIG5ld09ic2VydmFiaWxpdHkudGFncyA9IHsgLi4ub3ZlcnJpZGVzLnJlcGxhY2VUYWdzIH07XG4gIH0gZWxzZSBpZiAob3ZlcnJpZGVzLnRhZ3MgIT09IHVuZGVmaW5lZCkge1xuICAgIC8vIE1lcmdlIHRhZ3MgKHNoYWxsb3cgaXMgZmluZSBmb3IgZmxhdCBrZXktdmFsdWUpXG4gICAgbmV3T2JzZXJ2YWJpbGl0eS50YWdzID0geyAuLi5jdXJyZW50Q3R4Lm9ic2VydmFiaWxpdHkudGFncywgLi4ub3ZlcnJpZGVzLnRhZ3MgfTtcbiAgfVxuXG4gIC8vIERlZXAgbWVyZ2UgbWV0YWRhdGEgaW50byBjb250ZXh0IG1ldGFkYXRhIChmbG93cyB0byBldmVudC5tZXRhZGF0YSlcbiAgaWYgKG92ZXJyaWRlcy5tZXRhZGF0YSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbmV3T2JzZXJ2YWJpbGl0eS5tZXRhZGF0YSA9IG1lcmdlKFtcbiAgICAgIGN1cnJlbnRDdHgub2JzZXJ2YWJpbGl0eS5tZXRhZGF0YSxcbiAgICAgIG92ZXJyaWRlcy5tZXRhZGF0YVxuICAgIF0pID8/IHt9O1xuICB9XG5cbiAgY29uc3QgbmV3Q3R4OiBFeGVjdXRpb25Db250ZXh0RGF0YSA9IHtcbiAgICAuLi5jdXJyZW50Q3R4LFxuICAgIGNvcnJlbGF0aW9uSWQ6IG92ZXJyaWRlcy5jb3JyZWxhdGlvbklkID8/IGN1cnJlbnRDdHguY29ycmVsYXRpb25JZCxcbiAgICBjYXVzZWRCeTogb3ZlcnJpZGVzLmNhdXNlZEJ5ID8/IGN1cnJlbnRDdHguY2F1c2VkQnksXG4gICAgYWN0b3I6IG92ZXJyaWRlcy5hY3RvciA/PyBjdXJyZW50Q3R4LmFjdG9yLFxuICAgIG9ic2VydmFiaWxpdHk6IG5ld09ic2VydmFiaWxpdHksXG4gIH07XG5cbiAgLy8gSU1QT1JUQU5UOiBydW4gZm4gSU5TSURFIHRoZSBvdmVycmlkZGVuIGV4ZWN1dGlvbiBjb250ZXh0LlxuICAvLyBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMgd29ya3MgZm9yIGJvdGggc3luYyBhbmQgYXN5bmMgZnVuY3Rpb25zXG4gIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMobmV3Q3R4LCBmbik7XG59XG4iXX0=