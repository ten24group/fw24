"use strict";
/**
 * Execution Context Storage
 *
 * AsyncLocalStorage-based context management for the framework.
 * This is the SINGLE source of truth for cross-cutting context.
 *
 * DESIGN:
 * - One AsyncLocalStorage for entire framework
 * - Context scoping via nested storage.run() calls
 * - Automatic restoration when scope exits
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExecutionContext = createExecutionContext;
exports.runWithExecutionContext = runWithExecutionContext;
exports.runWithExecutionContextSync = runWithExecutionContextSync;
exports.getCurrentExecutionContext = getCurrentExecutionContext;
exports.getObservabilityState = getObservabilityState;
exports.getCurrentSpan = getCurrentSpan;
exports.withCurrentSpan = withCurrentSpan;
exports.withCurrentSpanAsync = withCurrentSpanAsync;
exports.setActor = setActor;
exports.enrichActor = enrichActor;
exports.setSource = setSource;
exports.addTags = addTags;
exports.setAttribute = setAttribute;
exports.setAttributes = setAttributes;
exports.getCapturedParentId = getCapturedParentId;
exports.getCurrentParentObservabilityLogId = getCurrentParentObservabilityLogId;
const node_async_hooks_1 = require("node:async_hooks");
// ═══════════════════════════════════════════════════════════════════════════
// Storage (ONE AsyncLocalStorage for the entire framework)
// ═══════════════════════════════════════════════════════════════════════════
const storage = new node_async_hooks_1.AsyncLocalStorage();
// ═══════════════════════════════════════════════════════════════════════════
// Factory Functions
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Create default observability summary.
 */
function createObservabilitySummary() {
    return {
        evicted: 0,
        buffered: 0,
        captured: 0,
        sampledOut: 0,
    };
}
/**
 * Create observability state.
 */
function createObservabilityState(sampled, source, tags, attributes, metadata) {
    return {
        contextKey: {},
        currentSpan: undefined,
        sampled,
        source,
        tags: { ...tags },
        attributes: { ...attributes },
        metadata: { ...metadata },
        buffer: [],
        errorOccurred: false,
        summary: createObservabilitySummary(),
    };
}
// ═══════════════════════════════════════════════════════════════════════════
// Context Lifecycle
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Create execution context.
 *
 * @param options - Context options (correlationId is required)
 * @returns ExecutionContextData
 * @throws Error if correlationId is empty
 */
function createExecutionContext(options) {
    const correlationId = options.correlationId?.trim();
    if (!correlationId) {
        throw new Error('correlationId is required for execution context');
    }
    return {
        correlationId,
        causedBy: options.causedBy?.trim(),
        actor: options.actor,
        startTime: Date.now(),
        observability: createObservabilityState(options.sampled ?? true, options.source?.trim(), options.tags, options.attributes, options.metadata),
    };
}
/**
 * Run async function with execution context.
 *
 * Context is available via getCurrentExecutionContext() within the function
 * and all async operations it spawns.
 */
async function runWithExecutionContext(ctx, fn) {
    return storage.run(ctx, fn);
}
/**
 * Run sync function with execution context.
 */
function runWithExecutionContextSync(ctx, fn) {
    return storage.run(ctx, fn);
}
// ═══════════════════════════════════════════════════════════════════════════
// Context Access
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Get current execution context.
 * Returns undefined if no context is established.
 */
function getCurrentExecutionContext() {
    return storage.getStore();
}
/**
 * Get current observability state.
 * Returns undefined if no context is established.
 */
function getObservabilityState() {
    return storage.getStore()?.observability;
}
/**
 * Get current span from observability state.
 * Returns undefined if no span is active.
 */
function getCurrentSpan() {
    return storage.getStore()?.observability.currentSpan;
}
// ═══════════════════════════════════════════════════════════════════════════
// Span Context Scoping
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Run function with span as current.
 * Creates a new context scope - parent context is automatically restored on exit.
 *
 * This is the key mechanism for automatic parent tracking:
 * - withSpan() calls this to set the new span as current
 * - Nested withSpan() calls see this span as their parent
 * - When scope exits, previous context (with previous span) is restored
 *
 * @param span - The span to set as current
 * @param fn - Function to execute in the new scope
 * @returns Result of fn
 */
function withCurrentSpan(span, fn) {
    const ctx = storage.getStore();
    if (!ctx) {
        throw new Error('No execution context - call runWithExecutionContext first');
    }
    // Create new context with updated currentSpan
    // Other state is shallow copied (buffer array is same reference - intentional)
    const newCtx = {
        ...ctx,
        observability: {
            ...ctx.observability,
            currentSpan: span,
        },
    };
    // Run in new scope - AsyncLocalStorage handles restoration
    return storage.run(newCtx, fn);
}
/**
 * Async version of withCurrentSpan.
 */
async function withCurrentSpanAsync(span, fn) {
    return withCurrentSpan(span, fn);
}
// ═══════════════════════════════════════════════════════════════════════════
// Context Enrichment - Actor
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Set actor on current context.
 */
function setActor(actor) {
    const ctx = storage.getStore();
    if (ctx) {
        ctx.actor = actor;
    }
}
/**
 * Merge partial actor data into existing actor.
 */
function enrichActor(partial) {
    const ctx = storage.getStore();
    if (!ctx)
        return;
    if (ctx.actor) {
        Object.assign(ctx.actor, partial);
    }
    else {
        ctx.actor = partial;
    }
}
// ═══════════════════════════════════════════════════════════════════════════
// Context Enrichment - Observability
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Set source identifier on current context.
 */
function setSource(source) {
    const state = getObservabilityState();
    if (state) {
        state.source = source.trim();
    }
}
/**
 * Add tags to current context (merged with existing).
 */
function addTags(tags) {
    const state = getObservabilityState();
    if (state) {
        Object.assign(state.tags, tags);
    }
}
/**
 * Set a single attribute on current context.
 */
function setAttribute(key, value) {
    const state = getObservabilityState();
    if (state) {
        state.attributes[key] = value;
    }
}
/**
 * Set multiple attributes on current context.
 */
function setAttributes(attrs) {
    const state = getObservabilityState();
    if (state) {
        Object.assign(state.attributes, attrs);
    }
}
// ═══════════════════════════════════════════════════════════════════════════
// Parent ID Resolution
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Walk up the span tree to find the first captured ancestor.
 * Returns the ID of the first parent span that was actually captured (not sampled out).
 *
 * This is used for parentObservabilityLogId in ALL events:
 * - If parent was captured → returns parent.id
 * - If parent was sampled out → walks to grandparent, etc.
 * - Returns undefined if no captured ancestor
 *
 * @param span - Starting span (checks span.parent, not span itself)
 * @returns ID of first captured ancestor, or undefined
 */
function getCapturedParentId(span) {
    let current = span?.parent;
    while (current) {
        if (current.captured) {
            return current.id;
        }
        current = current.parent;
    }
    return undefined;
}
/**
 * Get parent observability log ID for new events.
 * Uses the current span and walks to find captured ancestor.
 */
function getCurrentParentObservabilityLogId() {
    const currentSpan = getCurrentSpan();
    if (!currentSpan)
        return undefined;
    // If current span was captured, use its ID
    // Otherwise walk up to find captured ancestor
    if (currentSpan.captured) {
        return currentSpan.id;
    }
    return getCapturedParentId(currentSpan);
}
/**
 * Explicitly register that a span ID has been emitted/propagated as a parentObservabilityLogId.
 *
 * This is the central integrity mechanism for hierarchy:
 * when a parent ID is referenced, the parent span must not be dropped later by filtering.
 *
 * This function is intentionally explicit (NOT hidden inside parent-id getters).
 */
// Parent/child integrity is now enforced at flush-time (graph-based),
// not via manual reference tracking.
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmFnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQvc3RvcmFnZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7R0FVRzs7QUFxRUgsd0RBcUJDO0FBUUQsMERBS0M7QUFLRCxrRUFLQztBQVVELGdFQUVDO0FBTUQsc0RBRUM7QUFNRCx3Q0FFQztBQW1CRCwwQ0FrQkM7QUFLRCxvREFLQztBQVNELDRCQUtDO0FBS0Qsa0NBU0M7QUFTRCw4QkFLQztBQUtELDBCQUtDO0FBS0Qsb0NBS0M7QUFLRCxzQ0FLQztBQWtCRCxrREFTQztBQU1ELGdGQVVDO0FBN1NELHVEQUFxRDtBQVVyRCw4RUFBOEU7QUFDOUUsMkRBQTJEO0FBQzNELDhFQUE4RTtBQUU5RSxNQUFNLE9BQU8sR0FBRyxJQUFJLG9DQUFpQixFQUF3QixDQUFDO0FBRTlELDhFQUE4RTtBQUM5RSxvQkFBb0I7QUFDcEIsOEVBQThFO0FBRTlFOztHQUVHO0FBQ0gsU0FBUywwQkFBMEI7SUFDakMsT0FBTztRQUNMLE9BQU8sRUFBRSxDQUFDO1FBQ1YsUUFBUSxFQUFFLENBQUM7UUFDWCxRQUFRLEVBQUUsQ0FBQztRQUNYLFVBQVUsRUFBRSxDQUFDO0tBQ2QsQ0FBQztBQUNKLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsd0JBQXdCLENBQy9CLE9BQWdCLEVBQ2hCLE1BQWUsRUFDZixJQUE2QixFQUM3QixVQUFvQyxFQUNwQyxRQUFrQztJQUVsQyxPQUFPO1FBQ0wsVUFBVSxFQUFFLEVBQUU7UUFDZCxXQUFXLEVBQUUsU0FBUztRQUN0QixPQUFPO1FBQ1AsTUFBTTtRQUNOLElBQUksRUFBRSxFQUFFLEdBQUcsSUFBSSxFQUFFO1FBQ2pCLFVBQVUsRUFBRSxFQUFFLEdBQUcsVUFBVSxFQUFFO1FBQzdCLFFBQVEsRUFBRSxFQUFFLEdBQUcsUUFBUSxFQUFFO1FBQ3pCLE1BQU0s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ICogRXhlY3V0aW9uIENvbnRleHQgU3RvcmFnZVxuICogXG4gKiBBc3luY0xvY2FsU3RvcmFnZS1iYXNlZCBjb250ZXh0IG1hbmFnZW1lbnQgZm9yIHRoZSBmcmFtZXdvcmsuXG4gKiBUaGlzIGlzIHRoZSBTSU5HTEUgc291cmNlIG9mIHRydXRoIGZvciBjcm9zcy1jdXR0aW5nIGNvbnRleHQuXG4gKiBcbiAqIERFU0lHTjpcbiAqIC0gT25lIEFzeW5jTG9jYWxTdG9yYWdlIGZvciBlbnRpcmUgZnJhbWV3b3JrXG4gKiAtIENvbnRleHQgc2NvcGluZyB2aWEgbmVzdGVkIHN0b3JhZ2UucnVuKCkgY2FsbHNcbiAqIC0gQXV0b21hdGljIHJlc3RvcmF0aW9uIHdoZW4gc2NvcGUgZXhpdHNcbiAqL1xuXG5pbXBvcnQgeyBBc3luY0xvY2FsU3RvcmFnZSB9IGZyb20gJ25vZGU6YXN5bmNfaG9va3MnO1xuaW1wb3J0IHR5cGUgeyBBY3RvciB9IGZyb20gJy4uLy4uL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB0eXBlIHtcbiAgRXhlY3V0aW9uQ29udGV4dERhdGEsXG4gIENyZWF0ZUV4ZWN1dGlvbkNvbnRleHRPcHRpb25zLFxuICBPYnNlcnZhYmlsaXR5U3RhdGUsXG4gIE9ic2VydmFiaWxpdHlTdW1tYXJ5LFxuICBJU3Bhbk5vZGUsXG59IGZyb20gJy4vdHlwZXMnO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFN0b3JhZ2UgKE9ORSBBc3luY0xvY2FsU3RvcmFnZSBmb3IgdGhlIGVudGlyZSBmcmFtZXdvcmspXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuY29uc3Qgc3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZTxFeGVjdXRpb25Db250ZXh0RGF0YT4oKTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBGYWN0b3J5IEZ1bmN0aW9uc1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogQ3JlYXRlIGRlZmF1bHQgb2JzZXJ2YWJpbGl0eSBzdW1tYXJ5LlxuICovXG5mdW5jdGlvbiBjcmVhdGVPYnNlcnZhYmlsaXR5U3VtbWFyeSgpOiBPYnNlcnZhYmlsaXR5U3VtbWFyeSB7XG4gIHJldHVybiB7XG4gICAgZXZpY3RlZDogMCxcbiAgICBidWZmZXJlZDogMCxcbiAgICBjYXB0dXJlZDogMCxcbiAgICBzYW1wbGVkT3V0OiAwLFxuICB9O1xufVxuXG4vKipcbiAqIENyZWF0ZSBvYnNlcnZhYmlsaXR5IHN0YXRlLlxuICovXG5mdW5jdGlvbiBjcmVhdGVPYnNlcnZhYmlsaXR5U3RhdGUoXG4gIHNhbXBsZWQ6IGJvb2xlYW4sXG4gIHNvdXJjZT86IHN0cmluZyxcbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuKTogT2JzZXJ2YWJpbGl0eVN0YXRlIHtcbiAgcmV0dXJuIHtcbiAgICBjb250ZXh0S2V5OiB7fSxcbiAgICBjdXJyZW50U3BhbjogdW5kZWZpbmVkLFxuICAgIHNhbXBsZWQsXG4gICAgc291cmNlLFxuICAgIHRhZ3M6IHsgLi4udGFncyB9LFxuICAgIGF0dHJpYnV0ZXM6IHsgLi4uYXR0cmlidXRlcyB9LFxuICAgIG1ldGFkYXRhOiB7IC4uLm1ldGFkYXRhIH0sXG4gICAgYnVmZmVyOiBbXSxcbiAgICBlcnJvck9jY3VycmVkOiBmYWxzZSxcbiAgICBzdW1tYXJ5OiBjcmVhdGVPYnNlcnZhYmlsaXR5U3VtbWFyeSgpLFxuICB9O1xufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIENvbnRleHQgTGlmZWN5Y2xlXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqXG4gKiBDcmVhdGUgZXhlY3V0aW9uIGNvbnRleHQuXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29udGV4dCBvcHRpb25zIChjb3JyZWxhdGlvbklkIGlzIHJlcXVpcmVkKVxuICogQHJldHVybnMgRXhlY3V0aW9uQ29udGV4dERhdGFcbiAqIEB0aHJvd3MgRXJyb3IgaWYgY29ycmVsYXRpb25JZCBpcyBlbXB0eVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRXhlY3V0aW9uQ29udGV4dChcbiAgb3B0aW9uczogQ3JlYXRlRXhlY3V0aW9uQ29udGV4dE9wdGlvbnNcbik6IEV4ZWN1dGlvbkNvbnRleHREYXRhIHtcbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IG9wdGlvbnMuY29ycmVsYXRpb25JZD8udHJpbSgpO1xuICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvcnJlbGF0aW9uSWQgaXMgcmVxdWlyZWQgZm9yIGV4ZWN1dGlvbiBjb250ZXh0Jyk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgY2F1c2VkQnk6IG9wdGlvbnMuY2F1c2VkQnk/LnRyaW0oKSxcbiAgICBhY3Rvcjogb3B0aW9ucy5hY3RvcixcbiAgICBzdGFydFRpbWU6IERhdGUubm93KCksXG4gICAgb2JzZXJ2YWJpbGl0eTogY3JlYXRlT2JzZXJ2YWJpbGl0eVN0YXRlKFxuICAgICAgb3B0aW9ucy5zYW1wbGVkID8/IHRydWUsXG4gICAgICBvcHRpb25zLnNvdXJjZT8udHJpbSgpLFxuICAgICAgb3B0aW9ucy50YWdzLFxuICAgICAgb3B0aW9ucy5hdHRyaWJ1dGVzLFxuICAgICAgb3B0aW9ucy5tZXRhZGF0YVxuICAgICksXG4gIH07XG59XG5cbi8qKlxuICogUnVuIGFzeW5jIGZ1bmN0aW9uIHdpdGggZXhlY3V0aW9uIGNvbnRleHQuXG4gKiBcbiAqIENvbnRleHQgaXMgYXZhaWxhYmxlIHZpYSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpIHdpdGhpbiB0aGUgZnVuY3Rpb25cbiAqIGFuZCBhbGwgYXN5bmMgb3BlcmF0aW9ucyBpdCBzcGF3bnMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dDxUPihcbiAgY3R4OiBFeGVjdXRpb25Db250ZXh0RGF0YSxcbiAgZm46ICgpID0+IFByb21pc2U8VD5cbik6IFByb21pc2U8VD4ge1xuICByZXR1cm4gc3RvcmFnZS5ydW4oY3R4LCBmbik7XG59XG5cbi8qKlxuICogUnVuIHN5bmMgZnVuY3Rpb24gd2l0aCBleGVjdXRpb24gY29udGV4dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0U3luYzxUPihcbiAgY3R4OiBFeGVjdXRpb25Db250ZXh0RGF0YSxcbiAgZm46ICgpID0+IFRcbik6IFQge1xuICByZXR1cm4gc3RvcmFnZS5ydW4oY3R4LCBmbik7XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gQ29udGV4dCBBY2Nlc3Ncbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIEdldCBjdXJyZW50IGV4ZWN1dGlvbiBjb250ZXh0LlxuICogUmV0dXJucyB1bmRlZmluZWQgaWYgbm8gY29udGV4dCBpcyBlc3RhYmxpc2hlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk6IEV4ZWN1dGlvbkNvbnRleHREYXRhIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHN0b3JhZ2UuZ2V0U3RvcmUoKTtcbn1cblxuLyoqXG4gKiBHZXQgY3VycmVudCBvYnNlcnZhYmlsaXR5IHN0YXRlLlxuICogUmV0dXJucyB1bmRlZmluZWQgaWYgbm8gY29udGV4dCBpcyBlc3RhYmxpc2hlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldE9ic2VydmFiaWxpdHlTdGF0ZSgpOiBPYnNlcnZhYmlsaXR5U3RhdGUgfCB1bmRlZmluZWQge1xuICByZXR1cm4gc3RvcmFnZS5nZXRTdG9yZSgpPy5vYnNlcnZhYmlsaXR5O1xufVxuXG4vKipcbiAqIEdldCBjdXJyZW50IHNwYW4gZnJvbSBvYnNlcnZhYmlsaXR5IHN0YXRlLlxuICogUmV0dXJucyB1bmRlZmluZWQgaWYgbm8gc3BhbiBpcyBhY3RpdmUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRDdXJyZW50U3BhbigpOiBJU3Bhbk5vZGUgfCB1bmRlZmluZWQge1xuICByZXR1cm4gc3RvcmFnZS5nZXRTdG9yZSgpPy5vYnNlcnZhYmlsaXR5LmN1cnJlbnRTcGFuO1xufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFNwYW4gQ29udGV4dCBTY29waW5nXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqXG4gKiBSdW4gZnVuY3Rpb24gd2l0aCBzcGFuIGFzIGN1cnJlbnQuXG4gKiBDcmVhdGVzIGEgbmV3IGNvbnRleHQgc2NvcGUgLSBwYXJlbnQgY29udGV4dCBpcyBhdXRvbWF0aWNhbGx5IHJlc3RvcmVkIG9uIGV4aXQuXG4gKiBcbiAqIFRoaXMgaXMgdGhlIGtleSBtZWNoYW5pc20gZm9yIGF1dG9tYXRpYyBwYXJlbnQgdHJhY2tpbmc6XG4gKiAtIHdpdGhTcGFuKCkgY2FsbHMgdGhpcyB0byBzZXQgdGhlIG5ldyBzcGFuIGFzIGN1cnJlbnRcbiAqIC0gTmVzdGVkIHdpdGhTcGFuKCkgY2FsbHMgc2VlIHRoaXMgc3BhbiBhcyB0aGVpciBwYXJlbnRcbiAqIC0gV2hlbiBzY29wZSBleGl0cywgcHJldmlvdXMgY29udGV4dCAod2l0aCBwcmV2aW91cyBzcGFuKSBpcyByZXN0b3JlZFxuICogXG4gKiBAcGFyYW0gc3BhbiAtIFRoZSBzcGFuIHRvIHNldCBhcyBjdXJyZW50XG4gKiBAcGFyYW0gZm4gLSBGdW5jdGlvbiB0byBleGVjdXRlIGluIHRoZSBuZXcgc2NvcGVcbiAqIEByZXR1cm5zIFJlc3VsdCBvZiBmblxuICovXG5leHBvcnQgZnVuY3Rpb24gd2l0aEN1cnJlbnRTcGFuPFQ+KHNwYW46IElTcGFuTm9kZSwgZm46ICgpID0+IFQpOiBUIHtcbiAgY29uc3QgY3R4ID0gc3RvcmFnZS5nZXRTdG9yZSgpO1xuICBpZiAoIWN0eCkge1xuICAgIHRocm93IG5ldyBFcnJvcignTm8gZXhlY3V0aW9uIGNvbnRleHQgLSBjYWxsIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0IGZpcnN0Jyk7XG4gIH1cblxuICAvLyBDcmVhdGUgbmV3IGNvbnRleHQgd2l0aCB1cGRhdGVkIGN1cnJlbnRTcGFuXG4gIC8vIE90aGVyIHN0YXRlIGlzIHNoYWxsb3cgY29waWVkIChidWZmZXIgYXJyYXkgaXMgc2FtZSByZWZlcmVuY2UgLSBpbnRlbnRpb25hbClcbiAgY29uc3QgbmV3Q3R4OiBFeGVjdXRpb25Db250ZXh0RGF0YSA9IHtcbiAgICAuLi5jdHgsXG4gICAgb2JzZXJ2YWJpbGl0eToge1xuICAgICAgLi4uY3R4Lm9ic2VydmFiaWxpdHksXG4gICAgICBjdXJyZW50U3Bhbjogc3BhbixcbiAgICB9LFxuICB9O1xuXG4gIC8vIFJ1biBpbiBuZXcgc2NvcGUgLSBBc3luY0xvY2FsU3RvcmFnZSBoYW5kbGVzIHJlc3RvcmF0aW9uXG4gIHJldHVybiBzdG9yYWdlLnJ1bihuZXdDdHgsIGZuKTtcbn1cblxuLyoqXG4gKiBBc3luYyB2ZXJzaW9uIG9mIHdpdGhDdXJyZW50U3Bhbi5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdpdGhDdXJyZW50U3BhbkFzeW5jPFQ+KFxuICBzcGFuOiBJU3Bhbk5vZGUsXG4gIGZuOiAoKSA9PiBQcm9taXNlPFQ+XG4pOiBQcm9taXNlPFQ+IHtcbiAgcmV0dXJuIHdpdGhDdXJyZW50U3BhbihzcGFuLCBmbik7XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gQ29udGV4dCBFbnJpY2htZW50IC0gQWN0b3Jcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIFNldCBhY3RvciBvbiBjdXJyZW50IGNvbnRleHQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRBY3RvcihhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgY29uc3QgY3R4ID0gc3RvcmFnZS5nZXRTdG9yZSgpO1xuICBpZiAoY3R4KSB7XG4gICAgY3R4LmFjdG9yID0gYWN0b3I7XG4gIH1cbn1cblxuLyoqXG4gKiBNZXJnZSBwYXJ0aWFsIGFjdG9yIGRhdGEgaW50byBleGlzdGluZyBhY3Rvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVucmljaEFjdG9yKHBhcnRpYWw6IFBhcnRpYWw8QWN0b3I+KTogdm9pZCB7XG4gIGNvbnN0IGN0eCA9IHN0b3JhZ2UuZ2V0U3RvcmUoKTtcbiAgaWYgKCFjdHgpIHJldHVybjtcblxuICBpZiAoY3R4LmFjdG9yKSB7XG4gICAgT2JqZWN0LmFzc2lnbihjdHguYWN0b3IsIHBhcnRpYWwpO1xuICB9IGVsc2Uge1xuICAgIGN0eC5hY3RvciA9IHBhcnRpYWwgYXMgQWN0b3I7XG4gIH1cbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBDb250ZXh0IEVucmljaG1lbnQgLSBPYnNlcnZhYmlsaXR5XG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqXG4gKiBTZXQgc291cmNlIGlkZW50aWZpZXIgb24gY3VycmVudCBjb250ZXh0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0U291cmNlKHNvdXJjZTogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHN0YXRlID0gZ2V0T2JzZXJ2YWJpbGl0eVN0YXRlKCk7XG4gIGlmIChzdGF0ZSkge1xuICAgIHN0YXRlLnNvdXJjZSA9IHNvdXJjZS50cmltKCk7XG4gIH1cbn1cblxuLyoqXG4gKiBBZGQgdGFncyB0byBjdXJyZW50IGNvbnRleHQgKG1lcmdlZCB3aXRoIGV4aXN0aW5nKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkZFRhZ3ModGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IHZvaWQge1xuICBjb25zdCBzdGF0ZSA9IGdldE9ic2VydmFiaWxpdHlTdGF0ZSgpO1xuICBpZiAoc3RhdGUpIHtcbiAgICBPYmplY3QuYXNzaWduKHN0YXRlLnRhZ3MsIHRhZ3MpO1xuICB9XG59XG5cbi8qKlxuICogU2V0IGEgc2luZ2xlIGF0dHJpYnV0ZSBvbiBjdXJyZW50IGNvbnRleHQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRBdHRyaWJ1dGUoa2V5OiBzdHJpbmcsIHZhbHVlOiB1bmtub3duKTogdm9pZCB7XG4gIGNvbnN0IHN0YXRlID0gZ2V0T2JzZXJ2YWJpbGl0eVN0YXRlKCk7XG4gIGlmIChzdGF0ZSkge1xuICAgIHN0YXRlLmF0dHJpYnV0ZXNbIGtleSBdID0gdmFsdWU7XG4gIH1cbn1cblxuLyoqXG4gKiBTZXQgbXVsdGlwbGUgYXR0cmlidXRlcyBvbiBjdXJyZW50IGNvbnRleHQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRBdHRyaWJ1dGVzKGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICBjb25zdCBzdGF0ZSA9IGdldE9ic2VydmFiaWxpdHlTdGF0ZSgpO1xuICBpZiAoc3RhdGUpIHtcbiAgICBPYmplY3QuYXNzaWduKHN0YXRlLmF0dHJpYnV0ZXMsIGF0dHJzKTtcbiAgfVxufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFBhcmVudCBJRCBSZXNvbHV0aW9uXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqXG4gKiBXYWxrIHVwIHRoZSBzcGFuIHRyZWUgdG8gZmluZCB0aGUgZmlyc3QgY2FwdHVyZWQgYW5jZXN0b3IuXG4gKiBSZXR1cm5zIHRoZSBJRCBvZiB0aGUgZmlyc3QgcGFyZW50IHNwYW4gdGhhdCB3YXMgYWN0dWFsbHkgY2FwdHVyZWQgKG5vdCBzYW1wbGVkIG91dCkuXG4gKiBcbiAqIFRoaXMgaXMgdXNlZCBmb3IgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGluIEFMTCBldmVudHM6XG4gKiAtIElmIHBhcmVudCB3YXMgY2FwdHVyZWQg4oaSIHJldHVybnMgcGFyZW50LmlkXG4gKiAtIElmIHBhcmVudCB3YXMgc2FtcGxlZCBvdXQg4oaSIHdhbGtzIHRvIGdyYW5kcGFyZW50LCBldGMuXG4gKiAtIFJldHVybnMgdW5kZWZpbmVkIGlmIG5vIGNhcHR1cmVkIGFuY2VzdG9yXG4gKiBcbiAqIEBwYXJhbSBzcGFuIC0gU3RhcnRpbmcgc3BhbiAoY2hlY2tzIHNwYW4ucGFyZW50LCBub3Qgc3BhbiBpdHNlbGYpXG4gKiBAcmV0dXJucyBJRCBvZiBmaXJzdCBjYXB0dXJlZCBhbmNlc3Rvciwgb3IgdW5kZWZpbmVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRDYXB0dXJlZFBhcmVudElkKHNwYW46IElTcGFuTm9kZSB8IHVuZGVmaW5lZCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGxldCBjdXJyZW50ID0gc3Bhbj8ucGFyZW50O1xuICB3aGlsZSAoY3VycmVudCkge1xuICAgIGlmIChjdXJyZW50LmNhcHR1cmVkKSB7XG4gICAgICByZXR1cm4gY3VycmVudC5pZDtcbiAgICB9XG4gICAgY3VycmVudCA9IGN1cnJlbnQucGFyZW50O1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogR2V0IHBhcmVudCBvYnNlcnZhYmlsaXR5IGxvZyBJRCBmb3IgbmV3IGV2ZW50cy5cbiAqIFVzZXMgdGhlIGN1cnJlbnQgc3BhbiBhbmQgd2Fsa3MgdG8gZmluZCBjYXB0dXJlZCBhbmNlc3Rvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldEN1cnJlbnRQYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgY3VycmVudFNwYW4gPSBnZXRDdXJyZW50U3BhbigpO1xuICBpZiAoIWN1cnJlbnRTcGFuKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIC8vIElmIGN1cnJlbnQgc3BhbiB3YXMgY2FwdHVyZWQsIHVzZSBpdHMgSURcbiAgLy8gT3RoZXJ3aXNlIHdhbGsgdXAgdG8gZmluZCBjYXB0dXJlZCBhbmNlc3RvclxuICBpZiAoY3VycmVudFNwYW4uY2FwdHVyZWQpIHtcbiAgICByZXR1cm4gY3VycmVudFNwYW4uaWQ7XG4gIH1cbiAgcmV0dXJuIGdldENhcHR1cmVkUGFyZW50SWQoY3VycmVudFNwYW4pO1xufVxuXG4vKipcbiAqIEV4cGxpY2l0bHkgcmVnaXN0ZXIgdGhhdCBhIHNwYW4gSUQgaGFzIGJlZW4gZW1pdHRlZC9wcm9wYWdhdGVkIGFzIGEgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLlxuICpcbiAqIFRoaXMgaXMgdGhlIGNlbnRyYWwgaW50ZWdyaXR5IG1lY2hhbmlzbSBmb3IgaGllcmFyY2h5OlxuICogd2hlbiBhIHBhcmVudCBJRCBpcyByZWZlcmVuY2VkLCB0aGUgcGFyZW50IHNwYW4gbXVzdCBub3QgYmUgZHJvcHBlZCBsYXRlciBieSBmaWx0ZXJpbmcuXG4gKlxuICogVGhpcyBmdW5jdGlvbiBpcyBpbnRlbnRpb25hbGx5IGV4cGxpY2l0IChOT1QgaGlkZGVuIGluc2lkZSBwYXJlbnQtaWQgZ2V0dGVycykuXG4gKi9cbi8vIFBhcmVudC9jaGlsZCBpbnRlZ3JpdHkgaXMgbm93IGVuZm9yY2VkIGF0IGZsdXNoLXRpbWUgKGdyYXBoLWJhc2VkKSxcbi8vIG5vdCB2aWEgbWFudWFsIHJlZmVyZW5jZSB0cmFja2luZy4iXX0=