"use strict";
/**
 * Execution Context Storage
 *
 * AsyncLocalStorage-based context management for the framework.
 * This is the SINGLE source of truth for cross-cutting context.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExecutionContext = createExecutionContext;
exports.runWithExecutionContext = runWithExecutionContext;
exports.runWithExecutionContextSync = runWithExecutionContextSync;
exports.getCurrentExecutionContext = getCurrentExecutionContext;
exports.setActor = setActor;
exports.enrichActor = enrichActor;
exports.addTags = addTags;
exports.setAttribute = setAttribute;
exports.setAttributes = setAttributes;
exports.setSource = setSource;
exports.setParentObservabilityLogId = setParentObservabilityLogId;
const node_async_hooks_1 = require("node:async_hooks");
// ============================================================================
// Storage (ONE AsyncLocalStorage for the entire framework)
// ============================================================================
const storage = new node_async_hooks_1.AsyncLocalStorage();
// ============================================================================
// Context Lifecycle
// ============================================================================
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
    const tags = { ...options.tags };
    const attributes = { ...options.attributes };
    return {
        correlationId,
        parentObservabilityLogId: options.parentObservabilityLogId?.trim(),
        sampled: options.sampled ?? true,
        actor: options.actor,
        tags,
        attributes,
        source: options.source?.trim(),
        startTime: Date.now(),
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
// ============================================================================
// Context Access
// ============================================================================
/**
 * Get current execution context.
 * Returns undefined if no context is established.
 */
function getCurrentExecutionContext() {
    return storage.getStore();
}
// ============================================================================
// Context Enrichment
// ============================================================================
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
/**
 * Add tags to current context (merged with existing).
 */
function addTags(tags) {
    const ctx = storage.getStore();
    if (ctx) {
        Object.assign(ctx.tags, tags);
    }
}
/**
 * Set a single attribute on current context.
 */
function setAttribute(key, value) {
    const ctx = storage.getStore();
    if (ctx) {
        ctx.attributes[key] = value;
    }
}
/**
 * Set multiple attributes on current context.
 */
function setAttributes(attrs) {
    const ctx = storage.getStore();
    if (ctx) {
        Object.assign(ctx.attributes, attrs);
    }
}
/**
 * Set source identifier on current context.
 */
function setSource(source) {
    const ctx = storage.getStore();
    if (ctx) {
        ctx.source = source.trim();
    }
}
/**
 * Set parent observability log ID on current context.
 * Used for tracking span hierarchy.
 */
function setParentObservabilityLogId(observabilityLogId) {
    const ctx = storage.getStore();
    if (ctx) {
        ctx.parentObservabilityLogId = observabilityLogId;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmFnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQvc3RvcmFnZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7O0FBdUJILHdEQXFCQztBQVFELDBEQUtDO0FBS0Qsa0VBS0M7QUFVRCxnRUFFQztBQVNELDRCQUtDO0FBS0Qsa0NBU0M7QUFLRCwwQkFLQztBQUtELG9DQUtDO0FBS0Qsc0NBS0M7QUFLRCw4QkFLQztBQU1ELGtFQUtDO0FBNUpELHVEQUFxRDtBQUlyRCwrRUFBK0U7QUFDL0UsMkRBQTJEO0FBQzNELCtFQUErRTtBQUUvRSxNQUFNLE9BQU8sR0FBRyxJQUFJLG9DQUFpQixFQUF3QixDQUFDO0FBRTlELCtFQUErRTtBQUMvRSxvQkFBb0I7QUFDcEIsK0VBQStFO0FBRS9FOzs7Ozs7R0FNRztBQUNILFNBQWdCLHNCQUFzQixDQUNwQyxPQUFzQztJQUV0QyxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsYUFBYSxFQUFFLElBQUksRUFBRSxDQUFDO0lBQ3BELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxDQUFDLENBQUM7SUFDckUsQ0FBQztJQUVELE1BQU0sSUFBSSxHQUEyQixFQUFFLEdBQUcsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQ3pELE1BQU0sVUFBVSxHQUE0QixFQUFFLEdBQUcsT0FBTyxDQUFDLFVBQVUsRUFBRSxDQUFDO0lBRXRFLE9BQU87UUFDTCxhQUFhO1FBQ2Isd0JBQXdCLEVBQUUsT0FBTyxDQUFDLHdCQUF3QixFQUFFLElBQUksRUFBRTtRQUNsRSxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU8sSUFBSSxJQUFJO1FBQ2hDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSztRQUNwQixJQUFJO1FBQ0osVUFBVTtRQUNWLE1BQU0sRUFBRSxP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LENBQUM7UUFDUixHQUFHLENBQUMsd0JBQXdCLEdBQUcsa0JBQWtCLENBQUM7SUFDcEQsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEV4ZWN1dGlvbiBDb250ZXh0IFN0b3JhZ2VcbiAqIFxuICogQXN5bmNMb2NhbFN0b3JhZ2UtYmFzZWQgY29udGV4dCBtYW5hZ2VtZW50IGZvciB0aGUgZnJhbWV3b3JrLlxuICogVGhpcyBpcyB0aGUgU0lOR0xFIHNvdXJjZSBvZiB0cnV0aCBmb3IgY3Jvc3MtY3V0dGluZyBjb250ZXh0LlxuICovXG5cbmltcG9ydCB7IEFzeW5jTG9jYWxTdG9yYWdlIH0gZnJvbSAnbm9kZTphc3luY19ob29rcyc7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uLy4uL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHREYXRhLCBDcmVhdGVFeGVjdXRpb25Db250ZXh0T3B0aW9ucyB9IGZyb20gJy4vdHlwZXMnO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTdG9yYWdlIChPTkUgQXN5bmNMb2NhbFN0b3JhZ2UgZm9yIHRoZSBlbnRpcmUgZnJhbWV3b3JrKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5jb25zdCBzdG9yYWdlID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlPEV4ZWN1dGlvbkNvbnRleHREYXRhPigpO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb250ZXh0IExpZmVjeWNsZVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIENyZWF0ZSBleGVjdXRpb24gY29udGV4dC5cbiAqIFxuICogQHBhcmFtIG9wdGlvbnMgLSBDb250ZXh0IG9wdGlvbnMgKGNvcnJlbGF0aW9uSWQgaXMgcmVxdWlyZWQpXG4gKiBAcmV0dXJucyBFeGVjdXRpb25Db250ZXh0RGF0YVxuICogQHRocm93cyBFcnJvciBpZiBjb3JyZWxhdGlvbklkIGlzIGVtcHR5XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVFeGVjdXRpb25Db250ZXh0KFxuICBvcHRpb25zOiBDcmVhdGVFeGVjdXRpb25Db250ZXh0T3B0aW9uc1xuKTogRXhlY3V0aW9uQ29udGV4dERhdGEge1xuICBjb25zdCBjb3JyZWxhdGlvbklkID0gb3B0aW9ucy5jb3JyZWxhdGlvbklkPy50cmltKCk7XG4gIGlmICghY29ycmVsYXRpb25JZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignY29ycmVsYXRpb25JZCBpcyByZXF1aXJlZCBmb3IgZXhlY3V0aW9uIGNvbnRleHQnKTtcbiAgfVxuXG4gIGNvbnN0IHRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IC4uLm9wdGlvbnMudGFncyB9O1xuICBjb25zdCBhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHsgLi4ub3B0aW9ucy5hdHRyaWJ1dGVzIH07XG5cbiAgcmV0dXJuIHtcbiAgICBjb3JyZWxhdGlvbklkLFxuICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogb3B0aW9ucy5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ/LnRyaW0oKSxcbiAgICBzYW1wbGVkOiBvcHRpb25zLnNhbXBsZWQgPz8gdHJ1ZSxcbiAgICBhY3Rvcjogb3B0aW9ucy5hY3RvcixcbiAgICB0YWdzLFxuICAgIGF0dHJpYnV0ZXMsXG4gICAgc291cmNlOiBvcHRpb25zLnNvdXJjZT8udHJpbSgpLFxuICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKSxcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW4gYXN5bmMgZnVuY3Rpb24gd2l0aCBleGVjdXRpb24gY29udGV4dC5cbiAqIFxuICogQ29udGV4dCBpcyBhdmFpbGFibGUgdmlhIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCkgd2l0aGluIHRoZSBmdW5jdGlvblxuICogYW5kIGFsbCBhc3luYyBvcGVyYXRpb25zIGl0IHNwYXducy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0PFQ+KFxuICBjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICBmbjogKCkgPT4gUHJvbWlzZTxUPlxuKTogUHJvbWlzZTxUPiB7XG4gIHJldHVybiBzdG9yYWdlLnJ1bihjdHgsIGZuKTtcbn1cblxuLyoqXG4gKiBSdW4gc3luYyBmdW5jdGlvbiB3aXRoIGV4ZWN1dGlvbiBjb250ZXh0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHRTeW5jPFQ+KFxuICBjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICBmbjogKCkgPT4gVFxuKTogVCB7XG4gIHJldHVybiBzdG9yYWdlLnJ1bihjdHgsIGZuKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29udGV4dCBBY2Nlc3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBHZXQgY3VycmVudCBleGVjdXRpb24gY29udGV4dC5cbiAqIFJldHVybnMgdW5kZWZpbmVkIGlmIG5vIGNvbnRleHQgaXMgZXN0YWJsaXNoZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpOiBFeGVjdXRpb25Db250ZXh0RGF0YSB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBzdG9yYWdlLmdldFN0b3JlKCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIENvbnRleHQgRW5yaWNobWVudFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFNldCBhY3RvciBvbiBjdXJyZW50IGNvbnRleHQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRBY3RvcihhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgY29uc3QgY3R4ID0gc3RvcmFnZS5nZXRTdG9yZSgpO1xuICBpZiAoY3R4KSB7XG4gICAgY3R4LmFjdG9yID0gYWN0b3I7XG4gIH1cbn1cblxuLyoqXG4gKiBNZXJnZSBwYXJ0aWFsIGFjdG9yIGRhdGEgaW50byBleGlzdGluZyBhY3Rvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVucmljaEFjdG9yKHBhcnRpYWw6IFBhcnRpYWw8QWN0b3I+KTogdm9pZCB7XG4gIGNvbnN0IGN0eCA9IHN0b3JhZ2UuZ2V0U3RvcmUoKTtcbiAgaWYgKCFjdHgpIHJldHVybjtcblxuICBpZiAoY3R4LmFjdG9yKSB7XG4gICAgT2JqZWN0LmFzc2lnbihjdHguYWN0b3IsIHBhcnRpYWwpO1xuICB9IGVsc2Uge1xuICAgIGN0eC5hY3RvciA9IHBhcnRpYWwgYXMgQWN0b3I7XG4gIH1cbn1cblxuLyoqXG4gKiBBZGQgdGFncyB0byBjdXJyZW50IGNvbnRleHQgKG1lcmdlZCB3aXRoIGV4aXN0aW5nKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkZFRhZ3ModGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IHZvaWQge1xuICBjb25zdCBjdHggPSBzdG9yYWdlLmdldFN0b3JlKCk7XG4gIGlmIChjdHgpIHtcbiAgICBPYmplY3QuYXNzaWduKGN0eC50YWdzLCB0YWdzKTtcbiAgfVxufVxuXG4vKipcbiAqIFNldCBhIHNpbmdsZSBhdHRyaWJ1dGUgb24gY3VycmVudCBjb250ZXh0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0QXR0cmlidXRlKGtleTogc3RyaW5nLCB2YWx1ZTogdW5rbm93bik6IHZvaWQge1xuICBjb25zdCBjdHggPSBzdG9yYWdlLmdldFN0b3JlKCk7XG4gIGlmIChjdHgpIHtcbiAgICBjdHguYXR0cmlidXRlc1sga2V5IF0gPSB2YWx1ZTtcbiAgfVxufVxuXG4vKipcbiAqIFNldCBtdWx0aXBsZSBhdHRyaWJ1dGVzIG9uIGN1cnJlbnQgY29udGV4dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldEF0dHJpYnV0ZXMoYXR0cnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCB7XG4gIGNvbnN0IGN0eCA9IHN0b3JhZ2UuZ2V0U3RvcmUoKTtcbiAgaWYgKGN0eCkge1xuICAgIE9iamVjdC5hc3NpZ24oY3R4LmF0dHJpYnV0ZXMsIGF0dHJzKTtcbiAgfVxufVxuXG4vKipcbiAqIFNldCBzb3VyY2UgaWRlbnRpZmllciBvbiBjdXJyZW50IGNvbnRleHQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRTb3VyY2Uoc291cmNlOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgY3R4ID0gc3RvcmFnZS5nZXRTdG9yZSgpO1xuICBpZiAoY3R4KSB7XG4gICAgY3R4LnNvdXJjZSA9IHNvdXJjZS50cmltKCk7XG4gIH1cbn1cblxuLyoqXG4gKiBTZXQgcGFyZW50IG9ic2VydmFiaWxpdHkgbG9nIElEIG9uIGN1cnJlbnQgY29udGV4dC5cbiAqIFVzZWQgZm9yIHRyYWNraW5nIHNwYW4gaGllcmFyY2h5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0UGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKG9ic2VydmFiaWxpdHlMb2dJZDogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IGN0eCA9IHN0b3JhZ2UuZ2V0U3RvcmUoKTtcbiAgaWYgKGN0eCkge1xuICAgIGN0eC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBvYnNlcnZhYmlsaXR5TG9nSWQ7XG4gIH1cbn1cblxuIl19