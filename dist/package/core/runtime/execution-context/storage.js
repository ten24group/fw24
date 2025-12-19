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
        causedBy: options.causedBy?.trim(),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmFnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQvc3RvcmFnZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7O0FBdUJILHdEQXNCQztBQVFELDBEQUtDO0FBS0Qsa0VBS0M7QUFVRCxnRUFFQztBQVNELDRCQUtDO0FBS0Qsa0NBU0M7QUFLRCwwQkFLQztBQUtELG9DQUtDO0FBS0Qsc0NBS0M7QUFLRCw4QkFLQztBQU1ELGtFQUtDO0FBN0pELHVEQUFxRDtBQUlyRCwrRUFBK0U7QUFDL0UsMkRBQTJEO0FBQzNELCtFQUErRTtBQUUvRSxNQUFNLE9BQU8sR0FBRyxJQUFJLG9DQUFpQixFQUF3QixDQUFDO0FBRTlELCtFQUErRTtBQUMvRSxvQkFBb0I7QUFDcEIsK0VBQStFO0FBRS9FOzs7Ozs7R0FNRztBQUNILFNBQWdCLHNCQUFzQixDQUNwQyxPQUFzQztJQUV0QyxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsYUFBYSxFQUFFLElBQUksRUFBRSxDQUFDO0lBQ3BELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxDQUFDLENBQUM7SUFDckUsQ0FBQztJQUVELE1BQU0sSUFBSSxHQUEyQixFQUFFLEdBQUcsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQ3pELE1BQU0sVUFBVSxHQUE0QixFQUFFLEdBQUcsT0FBTyxDQUFDLFVBQVUsRUFBRSxDQUFDO0lBRXRFLE9BQU87UUFDTCxhQUFhO1FBQ2Isd0JBQXdCLEVBQUUsT0FBTyxDQUFDLHdCQUF3QixFQUFFLElBQUksRUFBRTtRQUNsRSxRQUFRLEVBQUUsT0FBTyxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUU7UUFDbEMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPLElBQUksSUFBSTtRQUNoQyxLQUFLLEVBQUUsT0FBTyxD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LE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztJQUMvQixJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQ1IsR0FBRyxDQUFDLHdCQUF3QixHQUFHLGtCQUFrQixDQUFDO0lBQ3BELENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBFeGVjdXRpb24gQ29udGV4dCBTdG9yYWdlXG4gKiBcbiAqIEFzeW5jTG9jYWxTdG9yYWdlLWJhc2VkIGNvbnRleHQgbWFuYWdlbWVudCBmb3IgdGhlIGZyYW1ld29yay5cbiAqIFRoaXMgaXMgdGhlIFNJTkdMRSBzb3VyY2Ugb2YgdHJ1dGggZm9yIGNyb3NzLWN1dHRpbmcgY29udGV4dC5cbiAqL1xuXG5pbXBvcnQgeyBBc3luY0xvY2FsU3RvcmFnZSB9IGZyb20gJ25vZGU6YXN5bmNfaG9va3MnO1xuaW1wb3J0IHsgQWN0b3IgfSBmcm9tICcuLi8uLi90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0RGF0YSwgQ3JlYXRlRXhlY3V0aW9uQ29udGV4dE9wdGlvbnMgfSBmcm9tICcuL3R5cGVzJztcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3RvcmFnZSAoT05FIEFzeW5jTG9jYWxTdG9yYWdlIGZvciB0aGUgZW50aXJlIGZyYW1ld29yaylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuY29uc3Qgc3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZTxFeGVjdXRpb25Db250ZXh0RGF0YT4oKTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29udGV4dCBMaWZlY3ljbGVcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDcmVhdGUgZXhlY3V0aW9uIGNvbnRleHQuXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29udGV4dCBvcHRpb25zIChjb3JyZWxhdGlvbklkIGlzIHJlcXVpcmVkKVxuICogQHJldHVybnMgRXhlY3V0aW9uQ29udGV4dERhdGFcbiAqIEB0aHJvd3MgRXJyb3IgaWYgY29ycmVsYXRpb25JZCBpcyBlbXB0eVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRXhlY3V0aW9uQ29udGV4dChcbiAgb3B0aW9uczogQ3JlYXRlRXhlY3V0aW9uQ29udGV4dE9wdGlvbnNcbik6IEV4ZWN1dGlvbkNvbnRleHREYXRhIHtcbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IG9wdGlvbnMuY29ycmVsYXRpb25JZD8udHJpbSgpO1xuICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvcnJlbGF0aW9uSWQgaXMgcmVxdWlyZWQgZm9yIGV4ZWN1dGlvbiBjb250ZXh0Jyk7XG4gIH1cblxuICBjb25zdCB0YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyAuLi5vcHRpb25zLnRhZ3MgfTtcbiAgY29uc3QgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7IC4uLm9wdGlvbnMuYXR0cmlidXRlcyB9O1xuXG4gIHJldHVybiB7XG4gICAgY29ycmVsYXRpb25JZCxcbiAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IG9wdGlvbnMucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkPy50cmltKCksXG4gICAgY2F1c2VkQnk6IG9wdGlvbnMuY2F1c2VkQnk/LnRyaW0oKSxcbiAgICBzYW1wbGVkOiBvcHRpb25zLnNhbXBsZWQgPz8gdHJ1ZSxcbiAgICBhY3Rvcjogb3B0aW9ucy5hY3RvcixcbiAgICB0YWdzLFxuICAgIGF0dHJpYnV0ZXMsXG4gICAgc291cmNlOiBvcHRpb25zLnNvdXJjZT8udHJpbSgpLFxuICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKSxcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW4gYXN5bmMgZnVuY3Rpb24gd2l0aCBleGVjdXRpb24gY29udGV4dC5cbiAqIFxuICogQ29udGV4dCBpcyBhdmFpbGFibGUgdmlhIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCkgd2l0aGluIHRoZSBmdW5jdGlvblxuICogYW5kIGFsbCBhc3luYyBvcGVyYXRpb25zIGl0IHNwYXducy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0PFQ+KFxuICBjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICBmbjogKCkgPT4gUHJvbWlzZTxUPlxuKTogUHJvbWlzZTxUPiB7XG4gIHJldHVybiBzdG9yYWdlLnJ1bihjdHgsIGZuKTtcbn1cblxuLyoqXG4gKiBSdW4gc3luYyBmdW5jdGlvbiB3aXRoIGV4ZWN1dGlvbiBjb250ZXh0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHRTeW5jPFQ+KFxuICBjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICBmbjogKCkgPT4gVFxuKTogVCB7XG4gIHJldHVybiBzdG9yYWdlLnJ1bihjdHgsIGZuKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29udGV4dCBBY2Nlc3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBHZXQgY3VycmVudCBleGVjdXRpb24gY29udGV4dC5cbiAqIFJldHVybnMgdW5kZWZpbmVkIGlmIG5vIGNvbnRleHQgaXMgZXN0YWJsaXNoZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpOiBFeGVjdXRpb25Db250ZXh0RGF0YSB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBzdG9yYWdlLmdldFN0b3JlKCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIENvbnRleHQgRW5yaWNobWVudFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFNldCBhY3RvciBvbiBjdXJyZW50IGNvbnRleHQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRBY3RvcihhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgY29uc3QgY3R4ID0gc3RvcmFnZS5nZXRTdG9yZSgpO1xuICBpZiAoY3R4KSB7XG4gICAgY3R4LmFjdG9yID0gYWN0b3I7XG4gIH1cbn1cblxuLyoqXG4gKiBNZXJnZSBwYXJ0aWFsIGFjdG9yIGRhdGEgaW50byBleGlzdGluZyBhY3Rvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVucmljaEFjdG9yKHBhcnRpYWw6IFBhcnRpYWw8QWN0b3I+KTogdm9pZCB7XG4gIGNvbnN0IGN0eCA9IHN0b3JhZ2UuZ2V0U3RvcmUoKTtcbiAgaWYgKCFjdHgpIHJldHVybjtcblxuICBpZiAoY3R4LmFjdG9yKSB7XG4gICAgT2JqZWN0LmFzc2lnbihjdHguYWN0b3IsIHBhcnRpYWwpO1xuICB9IGVsc2Uge1xuICAgIGN0eC5hY3RvciA9IHBhcnRpYWwgYXMgQWN0b3I7XG4gIH1cbn1cblxuLyoqXG4gKiBBZGQgdGFncyB0byBjdXJyZW50IGNvbnRleHQgKG1lcmdlZCB3aXRoIGV4aXN0aW5nKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkZFRhZ3ModGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IHZvaWQge1xuICBjb25zdCBjdHggPSBzdG9yYWdlLmdldFN0b3JlKCk7XG4gIGlmIChjdHgpIHtcbiAgICBPYmplY3QuYXNzaWduKGN0eC50YWdzLCB0YWdzKTtcbiAgfVxufVxuXG4vKipcbiAqIFNldCBhIHNpbmdsZSBhdHRyaWJ1dGUgb24gY3VycmVudCBjb250ZXh0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0QXR0cmlidXRlKGtleTogc3RyaW5nLCB2YWx1ZTogdW5rbm93bik6IHZvaWQge1xuICBjb25zdCBjdHggPSBzdG9yYWdlLmdldFN0b3JlKCk7XG4gIGlmIChjdHgpIHtcbiAgICBjdHguYXR0cmlidXRlc1sga2V5IF0gPSB2YWx1ZTtcbiAgfVxufVxuXG4vKipcbiAqIFNldCBtdWx0aXBsZSBhdHRyaWJ1dGVzIG9uIGN1cnJlbnQgY29udGV4dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldEF0dHJpYnV0ZXMoYXR0cnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCB7XG4gIGNvbnN0IGN0eCA9IHN0b3JhZ2UuZ2V0U3RvcmUoKTtcbiAgaWYgKGN0eCkge1xuICAgIE9iamVjdC5hc3NpZ24oY3R4LmF0dHJpYnV0ZXMsIGF0dHJzKTtcbiAgfVxufVxuXG4vKipcbiAqIFNldCBzb3VyY2UgaWRlbnRpZmllciBvbiBjdXJyZW50IGNvbnRleHQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRTb3VyY2Uoc291cmNlOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgY3R4ID0gc3RvcmFnZS5nZXRTdG9yZSgpO1xuICBpZiAoY3R4KSB7XG4gICAgY3R4LnNvdXJjZSA9IHNvdXJjZS50cmltKCk7XG4gIH1cbn1cblxuLyoqXG4gKiBTZXQgcGFyZW50IG9ic2VydmFiaWxpdHkgbG9nIElEIG9uIGN1cnJlbnQgY29udGV4dC5cbiAqIFVzZWQgZm9yIHRyYWNraW5nIHNwYW4gaGllcmFyY2h5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0UGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKG9ic2VydmFiaWxpdHlMb2dJZDogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IGN0eCA9IHN0b3JhZ2UuZ2V0U3RvcmUoKTtcbiAgaWYgKGN0eCkge1xuICAgIGN0eC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBvYnNlcnZhYmlsaXR5TG9nSWQ7XG4gIH1cbn1cblxuIl19