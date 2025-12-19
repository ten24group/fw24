"use strict";
/**
 * Observability Context
 *
 * Direct re-exports from the core execution context module.
 *
 * @module observability/context
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toW3CParentId = exports.toW3CTraceId = exports.createStepFunctionsContext = exports.createEventBridgeContext = exports.createSnsAttributes = exports.createSqsAttributes = exports.createHttpHeaders = exports.extractFromKinesis = exports.extractFromStepFunctions = exports.extractFromEventBridge = exports.extractFromSns = exports.extractFromSqs = exports.extractFromHeaders = exports.setParentObservabilityLogId = exports.setSource = exports.setAttributes = exports.setAttribute = exports.addTags = exports.enrichActor = exports.setActor = exports.getCurrentExecutionContext = exports.runWithExecutionContextSync = exports.runWithExecutionContext = exports.createExecutionContext = void 0;
exports.getCurrentContext = getCurrentContext;
exports.getCorrelationIdIfExists = getCorrelationIdIfExists;
exports.createObservationContext = createObservationContext;
exports.runWithContext = runWithContext;
exports.runWithContextSync = runWithContextSync;
// Re-export everything from core execution context
var execution_context_1 = require("../core/runtime/execution-context");
// Storage & Lifecycle
Object.defineProperty(exports, "createExecutionContext", { enumerable: true, get: function () { return execution_context_1.createExecutionContext; } });
Object.defineProperty(exports, "runWithExecutionContext", { enumerable: true, get: function () { return execution_context_1.runWithExecutionContext; } });
Object.defineProperty(exports, "runWithExecutionContextSync", { enumerable: true, get: function () { return execution_context_1.runWithExecutionContextSync; } });
Object.defineProperty(exports, "getCurrentExecutionContext", { enumerable: true, get: function () { return execution_context_1.getCurrentExecutionContext; } });
// Enrichment
Object.defineProperty(exports, "setActor", { enumerable: true, get: function () { return execution_context_1.setActor; } });
Object.defineProperty(exports, "enrichActor", { enumerable: true, get: function () { return execution_context_1.enrichActor; } });
Object.defineProperty(exports, "addTags", { enumerable: true, get: function () { return execution_context_1.addTags; } });
Object.defineProperty(exports, "setAttribute", { enumerable: true, get: function () { return execution_context_1.setAttribute; } });
Object.defineProperty(exports, "setAttributes", { enumerable: true, get: function () { return execution_context_1.setAttributes; } });
Object.defineProperty(exports, "setSource", { enumerable: true, get: function () { return execution_context_1.setSource; } });
Object.defineProperty(exports, "setParentObservabilityLogId", { enumerable: true, get: function () { return execution_context_1.setParentObservabilityLogId; } });
// Propagation - Extraction
Object.defineProperty(exports, "extractFromHeaders", { enumerable: true, get: function () { return execution_context_1.extractFromHeaders; } });
Object.defineProperty(exports, "extractFromSqs", { enumerable: true, get: function () { return execution_context_1.extractFromSqs; } });
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
// Internal convenience aliases (used by observability internals)
// ============================================================================
const execution_context_2 = require("../core/runtime/execution-context");
/** @internal Alias for getCurrentExecutionContext */
function getCurrentContext() {
    return (0, execution_context_2.getCurrentExecutionContext)();
}
/** @internal Get correlation ID if context exists */
function getCorrelationIdIfExists() {
    return (0, execution_context_2.getCurrentExecutionContext)()?.correlationId;
}
/** Create observation context - alias for createExecutionContext */
function createObservationContext(correlationId, options) {
    return (0, execution_context_2.createExecutionContext)({ correlationId, ...options });
}
/** Run with context - alias for runWithExecutionContext */
function runWithContext(context, fn) {
    return (0, execution_context_2.runWithExecutionContext)(context, fn);
}
/** Run with context sync - alias for runWithExecutionContextSync */
function runWithContextSync(context, fn) {
    return (0, execution_context_2.runWithExecutionContextSync)(context, fn);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGV4dC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2NvbnRleHQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7O0FBMkRILDhDQUVDO0FBR0QsNERBRUM7QUFVRCw0REFLQztBQUdELHdDQUtDO0FBR0QsZ0RBS0M7QUEvRkQsbURBQW1EO0FBQ25ELHVFQXFDMkM7QUEvQnpDLHNCQUFzQjtBQUN0QiwySEFBQSxzQkFBc0IsT0FBQTtBQUN0Qiw0SEFBQSx1QkFBdUIsT0FBQTtBQUN2QixnSUFBQSwyQkFBMkIsT0FBQTtBQUMzQiwrSEFBQSwwQkFBMEIsT0FBQTtBQUUxQixhQUFhO0FBQ2IsNkdBQUEsUUFBUSxPQUFBO0FBQ1IsZ0hBQUEsV0FBVyxPQUFBO0FBQ1gsNEdBQUEsT0FBTyxPQUFBO0FBQ1AsaUhBQUEsWUFBWSxPQUFBO0FBQ1osa0hBQUEsYUFBYSxPQUFBO0FBQ2IsOEdBQUEsU0FBUyxPQUFBO0FBQ1QsZ0lBQUEsMkJBQTJCLE9BQUE7QUFFM0IsMkJBQTJCO0FBQzNCLHVIQUFBLGtCQUFrQixPQUFBO0FBQ2xCLG1IQUFBLGNBQWMsT0FBQTtBQUNkLG1IQUFBLGNBQWMsT0FBQTtBQUNkLDJIQUFBLHNCQUFzQixPQUFBO0FBQ3RCLDZIQUFBLHdCQUF3QixPQUFBO0FBQ3hCLHVIQUFBLGtCQUFrQixPQUFBO0FBRWxCLHlCQUF5QjtBQUN6QixzSEFBQSxpQkFBaUIsT0FBQTtBQUNqQix3SEFBQSxtQkFBbUIsT0FBQTtBQUNuQix3SEFBQSxtQkFBbUIsT0FBQTtBQUNuQiw2SEFBQSx3QkFBd0IsT0FBQTtBQUN4QiwrSEFBQSwwQkFBMEIsT0FBQTtBQUMxQixpSEFBQSxZQUFZLE9BQUE7QUFDWixrSEFBQSxhQUFhLE9BQUE7QUFNZiwrRUFBK0U7QUFDL0UsaUVBQWlFO0FBQ2pFLCtFQUErRTtBQUUvRSx5RUFPMkM7QUFFM0MscURBQXFEO0FBQ3JELFNBQWdCLGlCQUFpQjtJQUMvQixPQUFPLElBQUEsOENBQTBCLEdBQUUsQ0FBQztBQUN0QyxDQUFDO0FBRUQscURBQXFEO0FBQ3JELFNBQWdCLHdCQUF3QjtJQUN0QyxPQUFPLElBQUEsOENBQTBCLEdBQUUsRUFBRSxhQUFhLENBQUM7QUFDckQsQ0FBQztBQVNELG9FQUFvRTtBQUNwRSxTQUFnQix3QkFBd0IsQ0FDdEMsYUFBcUIsRUFDckIsT0FBOEQ7SUFFOUQsT0FBTyxJQUFBLDBDQUFzQixFQUFDLEVBQUUsYUFBYSxFQUFFLEdBQUcsT0FBTyxFQUFFLENBQUMsQ0FBQztBQUMvRCxDQUFDO0FBRUQsMkRBQTJEO0FBQzNELFNBQWdCLGNBQWMsQ0FDNUIsT0FBMkIsRUFDM0IsRUFBb0I7SUFFcEIsT0FBTyxJQUFBLDJDQUF1QixFQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQztBQUM5QyxDQUFDO0FBRUQsb0VBQW9FO0FBQ3BFLFNBQWdCLGtCQUFrQixDQUNoQyxPQUEyQixFQUMzQixFQUFXO0lBRVgsT0FBTyxJQUFBLCtDQUEyQixFQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQztBQUNsRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5IENvbnRleHRcbiAqIFxuICogRGlyZWN0IHJlLWV4cG9ydHMgZnJvbSB0aGUgY29yZSBleGVjdXRpb24gY29udGV4dCBtb2R1bGUuXG4gKiBcbiAqIEBtb2R1bGUgb2JzZXJ2YWJpbGl0eS9jb250ZXh0XG4gKi9cblxuLy8gUmUtZXhwb3J0IGV2ZXJ5dGhpbmcgZnJvbSBjb3JlIGV4ZWN1dGlvbiBjb250ZXh0XG5leHBvcnQge1xuICAvLyBUeXBlc1xuICB0eXBlIEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICB0eXBlIENyZWF0ZUV4ZWN1dGlvbkNvbnRleHRPcHRpb25zLFxuICB0eXBlIFBhcnNlZFRyYWNlQ29udGV4dCxcblxuICAvLyBTdG9yYWdlICYgTGlmZWN5Y2xlXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMsXG4gIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0LFxuXG4gIC8vIEVucmljaG1lbnRcbiAgc2V0QWN0b3IsXG4gIGVucmljaEFjdG9yLFxuICBhZGRUYWdzLFxuICBzZXRBdHRyaWJ1dGUsXG4gIHNldEF0dHJpYnV0ZXMsXG4gIHNldFNvdXJjZSxcbiAgc2V0UGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuXG4gIC8vIFByb3BhZ2F0aW9uIC0gRXh0cmFjdGlvblxuICBleHRyYWN0RnJvbUhlYWRlcnMsXG4gIGV4dHJhY3RGcm9tU3FzLFxuICBleHRyYWN0RnJvbVNucyxcbiAgZXh0cmFjdEZyb21FdmVudEJyaWRnZSxcbiAgZXh0cmFjdEZyb21TdGVwRnVuY3Rpb25zLFxuICBleHRyYWN0RnJvbUtpbmVzaXMsXG5cbiAgLy8gUHJvcGFnYXRpb24gLSBDcmVhdGlvblxuICBjcmVhdGVIdHRwSGVhZGVycyxcbiAgY3JlYXRlU3FzQXR0cmlidXRlcyxcbiAgY3JlYXRlU25zQXR0cmlidXRlcyxcbiAgY3JlYXRlRXZlbnRCcmlkZ2VDb250ZXh0LFxuICBjcmVhdGVTdGVwRnVuY3Rpb25zQ29udGV4dCxcbiAgdG9XM0NUcmFjZUlkLFxuICB0b1czQ1BhcmVudElkLFxufSBmcm9tICcuLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQnO1xuXG4vLyBSZS1leHBvcnQgQWN0b3IgdHlwZSBmcm9tIGNvcmVcbmV4cG9ydCB0eXBlIHsgQWN0b3IgfSBmcm9tICcuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gSW50ZXJuYWwgY29udmVuaWVuY2UgYWxpYXNlcyAodXNlZCBieSBvYnNlcnZhYmlsaXR5IGludGVybmFscylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuaW1wb3J0IHtcbiAgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQsXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMsXG4gIHR5cGUgRXhlY3V0aW9uQ29udGV4dERhdGEsXG4gIHR5cGUgQ3JlYXRlRXhlY3V0aW9uQ29udGV4dE9wdGlvbnMsXG59IGZyb20gJy4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dCc7XG5cbi8qKiBAaW50ZXJuYWwgQWxpYXMgZm9yIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0ICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0Q3VycmVudENvbnRleHQoKTogRXhlY3V0aW9uQ29udGV4dERhdGEgfCB1bmRlZmluZWQge1xuICByZXR1cm4gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbn1cblxuLyoqIEBpbnRlcm5hbCBHZXQgY29ycmVsYXRpb24gSUQgaWYgY29udGV4dCBleGlzdHMgKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk/LmNvcnJlbGF0aW9uSWQ7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFRlc3RpbmcgdXRpbGl0aWVzIC0gdHlwZXMgYW5kIGZ1bmN0aW9ucyBmb3IgdGVzdGluZ1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiogVHlwZSBhbGlhcyBmb3IgdGVzdGluZyAqL1xuZXhwb3J0IHR5cGUgT2JzZXJ2YXRpb25Db250ZXh0ID0gRXhlY3V0aW9uQ29udGV4dERhdGE7XG5cbi8qKiBDcmVhdGUgb2JzZXJ2YXRpb24gY29udGV4dCAtIGFsaWFzIGZvciBjcmVhdGVFeGVjdXRpb25Db250ZXh0ICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KFxuICBjb3JyZWxhdGlvbklkOiBzdHJpbmcsXG4gIG9wdGlvbnM/OiBPbWl0PENyZWF0ZUV4ZWN1dGlvbkNvbnRleHRPcHRpb25zLCAnY29ycmVsYXRpb25JZCc+XG4pOiBPYnNlcnZhdGlvbkNvbnRleHQge1xuICByZXR1cm4gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7IGNvcnJlbGF0aW9uSWQsIC4uLm9wdGlvbnMgfSk7XG59XG5cbi8qKiBSdW4gd2l0aCBjb250ZXh0IC0gYWxpYXMgZm9yIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0ICovXG5leHBvcnQgZnVuY3Rpb24gcnVuV2l0aENvbnRleHQ8VD4oXG4gIGNvbnRleHQ6IE9ic2VydmF0aW9uQ29udGV4dCxcbiAgZm46ICgpID0+IFByb21pc2U8VD5cbik6IFByb21pc2U8VD4ge1xuICByZXR1cm4gcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoY29udGV4dCwgZm4pO1xufVxuXG4vKiogUnVuIHdpdGggY29udGV4dCBzeW5jIC0gYWxpYXMgZm9yIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0U3luYyAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJ1bldpdGhDb250ZXh0U3luYzxUPihcbiAgY29udGV4dDogT2JzZXJ2YXRpb25Db250ZXh0LFxuICBmbjogKCkgPT4gVFxuKTogVCB7XG4gIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMoY29udGV4dCwgZm4pO1xufVxuIl19