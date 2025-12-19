"use strict";
/**
 * Execution Context
 *
 * Framework-owned execution context for cross-cutting concerns.
 * Provides actor, correlation, and custom data throughout the call stack.
 *
 * ## Usage
 *
 * ### In Controllers (context is established automatically)
 * ```typescript
 * async myHandler(request, response, ctx) {
 *   const execCtx = getCurrentExecutionContext();
 *   const { correlationId, actor } = execCtx;
 *
 *   // Enrich context
 *   setAttribute('orderId', orderId);
 *   addTags({ feature: 'checkout' });
 * }
 * ```
 *
 * ### In Services
 * ```typescript
 * class OrderService {
 *   async create(data: OrderData) {
 *     const ctx = getCurrentExecutionContext();
 *     const actor = ctx?.actor;
 *     const tenantId = actor?.tenantId;
 *
 *     // Context is automatically propagated to:
 *     // - Child async operations
 *     // - Outgoing HTTP/SQS/SNS calls (if using framework clients)
 *   }
 * }
 * ```
 *
 * @module core/runtime/execution-context
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toW3CParentId = exports.toW3CTraceId = exports.createStepFunctionsContext = exports.createEventBridgeContext = exports.createSnsAttributes = exports.createSqsAttributes = exports.createHttpHeaders = exports.extractFromKinesis = exports.extractFromStepFunctions = exports.extractFromEventBridge = exports.extractFromSns = exports.extractFromSqs = exports.extractFromHeaders = exports.setParentObservabilityLogId = exports.setSource = exports.setAttributes = exports.setAttribute = exports.addTags = exports.enrichActor = exports.setActor = exports.getCurrentExecutionContext = exports.runWithExecutionContextSync = exports.runWithExecutionContext = exports.createExecutionContext = void 0;
// Storage & Lifecycle
var storage_1 = require("./storage");
Object.defineProperty(exports, "createExecutionContext", { enumerable: true, get: function () { return storage_1.createExecutionContext; } });
Object.defineProperty(exports, "runWithExecutionContext", { enumerable: true, get: function () { return storage_1.runWithExecutionContext; } });
Object.defineProperty(exports, "runWithExecutionContextSync", { enumerable: true, get: function () { return storage_1.runWithExecutionContextSync; } });
Object.defineProperty(exports, "getCurrentExecutionContext", { enumerable: true, get: function () { return storage_1.getCurrentExecutionContext; } });
// Enrichment
var storage_2 = require("./storage");
Object.defineProperty(exports, "setActor", { enumerable: true, get: function () { return storage_2.setActor; } });
Object.defineProperty(exports, "enrichActor", { enumerable: true, get: function () { return storage_2.enrichActor; } });
Object.defineProperty(exports, "addTags", { enumerable: true, get: function () { return storage_2.addTags; } });
Object.defineProperty(exports, "setAttribute", { enumerable: true, get: function () { return storage_2.setAttribute; } });
Object.defineProperty(exports, "setAttributes", { enumerable: true, get: function () { return storage_2.setAttributes; } });
Object.defineProperty(exports, "setSource", { enumerable: true, get: function () { return storage_2.setSource; } });
Object.defineProperty(exports, "setParentObservabilityLogId", { enumerable: true, get: function () { return storage_2.setParentObservabilityLogId; } });
// Propagation - Extraction
var propagation_1 = require("./propagation");
Object.defineProperty(exports, "extractFromHeaders", { enumerable: true, get: function () { return propagation_1.extractFromHeaders; } });
Object.defineProperty(exports, "extractFromSqs", { enumerable: true, get: function () { return propagation_1.extractFromSqs; } });
Object.defineProperty(exports, "extractFromSns", { enumerable: true, get: function () { return propagation_1.extractFromSns; } });
Object.defineProperty(exports, "extractFromEventBridge", { enumerable: true, get: function () { return propagation_1.extractFromEventBridge; } });
Object.defineProperty(exports, "extractFromStepFunctions", { enumerable: true, get: function () { return propagation_1.extractFromStepFunctions; } });
Object.defineProperty(exports, "extractFromKinesis", { enumerable: true, get: function () { return propagation_1.extractFromKinesis; } });
// Propagation - Creation
var propagation_2 = require("./propagation");
Object.defineProperty(exports, "createHttpHeaders", { enumerable: true, get: function () { return propagation_2.createHttpHeaders; } });
Object.defineProperty(exports, "createSqsAttributes", { enumerable: true, get: function () { return propagation_2.createSqsAttributes; } });
Object.defineProperty(exports, "createSnsAttributes", { enumerable: true, get: function () { return propagation_2.createSnsAttributes; } });
Object.defineProperty(exports, "createEventBridgeContext", { enumerable: true, get: function () { return propagation_2.createEventBridgeContext; } });
Object.defineProperty(exports, "createStepFunctionsContext", { enumerable: true, get: function () { return propagation_2.createStepFunctionsContext; } });
Object.defineProperty(exports, "toW3CTraceId", { enumerable: true, get: function () { return propagation_2.toW3CTraceId; } });
Object.defineProperty(exports, "toW3CParentId", { enumerable: true, get: function () { return propagation_2.toW3CParentId; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBb0NHOzs7QUFTSCxzQkFBc0I7QUFDdEIscUNBS21CO0FBSmpCLGlIQUFBLHNCQUFzQixPQUFBO0FBQ3RCLGtIQUFBLHVCQUF1QixPQUFBO0FBQ3ZCLHNIQUFBLDJCQUEyQixPQUFBO0FBQzNCLHFIQUFBLDBCQUEwQixPQUFBO0FBRzVCLGFBQWE7QUFDYixxQ0FRbUI7QUFQakIsbUdBQUEsUUFBUSxPQUFBO0FBQ1Isc0dBQUEsV0FBVyxPQUFBO0FBQ1gsa0dBQUEsT0FBTyxPQUFBO0FBQ1AsdUdBQUEsWUFBWSxPQUFBO0FBQ1osd0dBQUEsYUFBYSxPQUFBO0FBQ2Isb0dBQUEsU0FBUyxPQUFBO0FBQ1Qsc0hBQUEsMkJBQTJCLE9BQUE7QUFHN0IsMkJBQTJCO0FBQzNCLDZDQU91QjtBQU5yQixpSEFBQSxrQkFBa0IsT0FBQTtBQUNsQiw2R0FBQSxjQUFjLE9BQUE7QUFDZCw2R0FBQSxjQUFjLE9BQUE7QUFDZCxxSEFBQSxzQkFBc0IsT0FBQTtBQUN0Qix1SEFBQSx3QkFBd0IsT0FBQTtBQUN4QixpSEFBQSxrQkFBa0IsT0FBQTtBQUdwQix5QkFBeUI7QUFDekIsNkNBUXVCO0FBUHJCLGdIQUFBLGlCQUFpQixPQUFBO0FBQ2pCLGtIQUFBLG1CQUFtQixPQUFBO0FBQ25CLGtIQUFBLG1CQUFtQixPQUFBO0FBQ25CLHVIQUFBLHdCQUF3QixPQUFBO0FBQ3hCLHlIQUFBLDBCQUEwQixPQUFBO0FBQzFCLDJHQUFBLFlBQVksT0FBQTtBQUNaLDRHQUFBLGFBQWEsT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRXhlY3V0aW9uIENvbnRleHRcbiAqIFxuICogRnJhbWV3b3JrLW93bmVkIGV4ZWN1dGlvbiBjb250ZXh0IGZvciBjcm9zcy1jdXR0aW5nIGNvbmNlcm5zLlxuICogUHJvdmlkZXMgYWN0b3IsIGNvcnJlbGF0aW9uLCBhbmQgY3VzdG9tIGRhdGEgdGhyb3VnaG91dCB0aGUgY2FsbCBzdGFjay5cbiAqIFxuICogIyMgVXNhZ2VcbiAqIFxuICogIyMjIEluIENvbnRyb2xsZXJzIChjb250ZXh0IGlzIGVzdGFibGlzaGVkIGF1dG9tYXRpY2FsbHkpXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBhc3luYyBteUhhbmRsZXIocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCkge1xuICogICBjb25zdCBleGVjQ3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAqICAgY29uc3QgeyBjb3JyZWxhdGlvbklkLCBhY3RvciB9ID0gZXhlY0N0eDtcbiAqICAgXG4gKiAgIC8vIEVucmljaCBjb250ZXh0XG4gKiAgIHNldEF0dHJpYnV0ZSgnb3JkZXJJZCcsIG9yZGVySWQpO1xuICogICBhZGRUYWdzKHsgZmVhdHVyZTogJ2NoZWNrb3V0JyB9KTtcbiAqIH1cbiAqIGBgYFxuICogXG4gKiAjIyMgSW4gU2VydmljZXNcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNsYXNzIE9yZGVyU2VydmljZSB7XG4gKiAgIGFzeW5jIGNyZWF0ZShkYXRhOiBPcmRlckRhdGEpIHtcbiAqICAgICBjb25zdCBjdHggPSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpO1xuICogICAgIGNvbnN0IGFjdG9yID0gY3R4Py5hY3RvcjtcbiAqICAgICBjb25zdCB0ZW5hbnRJZCA9IGFjdG9yPy50ZW5hbnRJZDtcbiAqICAgICBcbiAqICAgICAvLyBDb250ZXh0IGlzIGF1dG9tYXRpY2FsbHkgcHJvcGFnYXRlZCB0bzpcbiAqICAgICAvLyAtIENoaWxkIGFzeW5jIG9wZXJhdGlvbnNcbiAqICAgICAvLyAtIE91dGdvaW5nIEhUVFAvU1FTL1NOUyBjYWxscyAoaWYgdXNpbmcgZnJhbWV3b3JrIGNsaWVudHMpXG4gKiAgIH1cbiAqIH1cbiAqIGBgYFxuICogXG4gKiBAbW9kdWxlIGNvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dFxuICovXG5cbi8vIFR5cGVzXG5leHBvcnQgdHlwZSB7XG4gIEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICBDcmVhdGVFeGVjdXRpb25Db250ZXh0T3B0aW9ucyxcbiAgUGFyc2VkVHJhY2VDb250ZXh0LFxufSBmcm9tICcuL3R5cGVzJztcblxuLy8gU3RvcmFnZSAmIExpZmVjeWNsZVxuZXhwb3J0IHtcbiAgY3JlYXRlRXhlY3V0aW9uQ29udGV4dCxcbiAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0U3luYyxcbiAgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQsXG59IGZyb20gJy4vc3RvcmFnZSc7XG5cbi8vIEVucmljaG1lbnRcbmV4cG9ydCB7XG4gIHNldEFjdG9yLFxuICBlbnJpY2hBY3RvcixcbiAgYWRkVGFncyxcbiAgc2V0QXR0cmlidXRlLFxuICBzZXRBdHRyaWJ1dGVzLFxuICBzZXRTb3VyY2UsXG4gIHNldFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbn0gZnJvbSAnLi9zdG9yYWdlJztcblxuLy8gUHJvcGFnYXRpb24gLSBFeHRyYWN0aW9uXG5leHBvcnQge1xuICBleHRyYWN0RnJvbUhlYWRlcnMsXG4gIGV4dHJhY3RGcm9tU3FzLFxuICBleHRyYWN0RnJvbVNucyxcbiAgZXh0cmFjdEZyb21FdmVudEJyaWRnZSxcbiAgZXh0cmFjdEZyb21TdGVwRnVuY3Rpb25zLFxuICBleHRyYWN0RnJvbUtpbmVzaXMsXG59IGZyb20gJy4vcHJvcGFnYXRpb24nO1xuXG4vLyBQcm9wYWdhdGlvbiAtIENyZWF0aW9uXG5leHBvcnQge1xuICBjcmVhdGVIdHRwSGVhZGVycyxcbiAgY3JlYXRlU3FzQXR0cmlidXRlcyxcbiAgY3JlYXRlU25zQXR0cmlidXRlcyxcbiAgY3JlYXRlRXZlbnRCcmlkZ2VDb250ZXh0LFxuICBjcmVhdGVTdGVwRnVuY3Rpb25zQ29udGV4dCxcbiAgdG9XM0NUcmFjZUlkLFxuICB0b1czQ1BhcmVudElkLFxufSBmcm9tICcuL3Byb3BhZ2F0aW9uJztcblxuIl19