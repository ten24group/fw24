"use strict";
/**
 * FW24 Observability System
 *
 * A unified observability system for logging, metrics, traces, audits, and more.
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Application Layer (User Code)                               │
 * └─────────────────────────────────────────────────────────────┘
 *                             ↓
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Specialized Observers                                       │
 * │ SpanObserver | AuditObserver | MetricObserver              │
 * │ WorkflowObserver | DecisionObserver | AccessLogObserver    │
 * └─────────────────────────────────────────────────────────────┘
 *                             ↓
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Core Observer (ObservabilityManager)                        │
 * │ capture() | flush() | initializeInvocation()               │
 * └─────────────────────────────────────────────────────────────┘
 *                             ↓
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Backends: DynamoDB | CloudWatch | OTEL/X-Ray               │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Quick Start
 *
 * ### 1. Establish Context
 *
 * ```typescript
 * import { runWithContext, createObservationContext } from '@ten24group/fw24/observability';
 *
 * await runWithContext(
 *   createObservationContext(requestId, { actor }),
 *   async () => {
 *     // All observations here share the same correlationId
 *   }
 * );
 * ```
 *
 * ### 2. Use Observers
 *
 * ```typescript
 * import { SpanObserver, AuditObserver, MetricObserver } from '@ten24group/fw24/observability';
 *
 * const span = SpanObserver.start('processOrder');
 * AuditObserver.entityCreate('Order', orderId, data);
 * MetricObserver.increment('orders.created');
 * span.end({ success: true });
 * ```
 *
 * ### 3. API Gateway Controller
 *
 * ```typescript
 * export class MyController extends APIController {
 *   constructor() {
 *     super();
 *     this.useMiddleware(apiGatewayObservabilityMiddleware);
 *   }
 *
 *   async myHandler(request, response, ctx) {
 *     // Context available via ctx.observability
 *     const { correlationId, context } = ctx.observability;
 *
 *     // For nested operations:
 *     return runWithContext(context, async () => {
 *       SpanObserver.start('nested-op');
 *     });
 *   }
 * }
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTELObservabilityBackend = exports.DynamoDBObservabilityBackend = exports.CloudWatchBackend = exports.ObservabilityLogService = exports.ObservabilityLogEntitySchema = exports.ChildLogObserver = exports.LogObserver = exports.AccessLogObserver = exports.DecisionObserver = exports.WorkflowObserver = exports.MetricObserver = exports.AuditObserver = exports.withSpan = exports.SpanObserver = exports.withObservationContextSync = exports.withObservationContext = exports.toW3CParentId = exports.toW3CTraceId = exports.createStepFunctionsTraceContext = exports.createEventBridgeTraceContext = exports.createSnsMessageAttributes = exports.createSqsMessageAttributes = exports.createPropagationHeaders = exports.extractTraceContextFromDynamoDBStream = exports.extractTraceContextFromKinesis = exports.extractTraceContextFromStepFunctions = exports.extractTraceContextFromEventBridge = exports.extractTraceContextFromSns = exports.extractTraceContextFromSqs = exports.extractTraceContextFromHeaders = exports.setContextParentLogId = exports.addContextTags = exports.setContextActor = exports.getContextActor = exports.getCorrelationIdIfExists = exports.getCorrelationId = exports.hasContext = exports.getCurrentContext = exports.runWithContextSync = exports.runWithContext = exports.createObservationContext = exports.VALID_BACKENDS = exports.CONFIG_DEFAULTS = exports.validateConfig = exports.ConfigManager = exports.withObservability = exports.Observer = exports.ObservabilityManager = exports.DefaultSamplingConfig = exports.ObservabilityLevel = void 0;
exports.clearEnvironmentTagsCache = exports.createTestObservationContext = exports.createTestActor = exports.assertEventCount = exports.assertNoEventCaptured = exports.assertEventCaptured = exports.createTestContextSync = exports.createTestContext = exports.cleanupTestObservability = exports.setupTestObservability = exports.MockBackend = exports.resetCapturer = exports.setCapturer = exports.captureEventAsync = exports.captureEvent = exports.mapError = exports.extractObserverOptions = exports.buildCommonFields = exports.mergeObserverTags = exports.resolveCorrelationId = exports.generateId = exports.processSqsMessages = exports.apiGatewayObservabilityMiddleware = exports.CrudObservabilityHooks = exports.Audited = exports.Traced = exports.safeStringify = exports.isPayloadWithinLimits = exports.estimateItemSize = exports.truncatePayload = exports.mergeTags = exports.getEnvironmentTags = exports.createTaskSource = exports.createQueueSource = exports.createServiceSource = exports.createControllerSource = exports.detectSource = exports.levelToPowertoolsLogLevel = exports.levelToString = exports.stringToLevel = void 0;
// === CORE TYPES ===
var types_1 = require("./types");
Object.defineProperty(exports, "ObservabilityLevel", { enumerable: true, get: function () { return types_1.ObservabilityLevel; } });
Object.defineProperty(exports, "DefaultSamplingConfig", { enumerable: true, get: function () { return types_1.DefaultSamplingConfig; } });
// === CORE MANAGER ===
var manager_1 = require("./manager");
Object.defineProperty(exports, "ObservabilityManager", { enumerable: true, get: function () { return manager_1.ObservabilityManager; } });
Object.defineProperty(exports, "Observer", { enumerable: true, get: function () { return manager_1.Observer; } });
Object.defineProperty(exports, "withObservability", { enumerable: true, get: function () { return manager_1.withObservability; } });
// === CONFIGURATION ===
var config_1 = require("./config");
Object.defineProperty(exports, "ConfigManager", { enumerable: true, get: function () { return config_1.ConfigManager; } });
Object.defineProperty(exports, "validateConfig", { enumerable: true, get: function () { return config_1.validateConfig; } });
Object.defineProperty(exports, "CONFIG_DEFAULTS", { enumerable: true, get: function () { return config_1.CONFIG_DEFAULTS; } });
Object.defineProperty(exports, "VALID_BACKENDS", { enumerable: true, get: function () { return config_1.VALID_BACKENDS; } });
// === CONTEXT MANAGEMENT ===
var context_1 = require("./context");
// Context creation & execution (PRIMARY API)
Object.defineProperty(exports, "createObservationContext", { enumerable: true, get: function () { return context_1.createObservationContext; } });
Object.defineProperty(exports, "runWithContext", { enumerable: true, get: function () { return context_1.runWithContext; } });
Object.defineProperty(exports, "runWithContextSync", { enumerable: true, get: function () { return context_1.runWithContextSync; } });
// Context access
Object.defineProperty(exports, "getCurrentContext", { enumerable: true, get: function () { return context_1.getCurrentContext; } });
Object.defineProperty(exports, "hasContext", { enumerable: true, get: function () { return context_1.hasContext; } });
Object.defineProperty(exports, "getCorrelationId", { enumerable: true, get: function () { return context_1.getCorrelationId; } });
Object.defineProperty(exports, "getCorrelationIdIfExists", { enumerable: true, get: function () { return context_1.getCorrelationIdIfExists; } });
Object.defineProperty(exports, "getContextActor", { enumerable: true, get: function () { return context_1.getContextActor; } });
// Context modification
Object.defineProperty(exports, "setContextActor", { enumerable: true, get: function () { return context_1.setContextActor; } });
Object.defineProperty(exports, "addContextTags", { enumerable: true, get: function () { return context_1.addContextTags; } });
Object.defineProperty(exports, "setContextParentLogId", { enumerable: true, get: function () { return context_1.setContextParentLogId; } });
// Trace context extraction (incoming)
Object.defineProperty(exports, "extractTraceContextFromHeaders", { enumerable: true, get: function () { return context_1.extractTraceContextFromHeaders; } });
Object.defineProperty(exports, "extractTraceContextFromSqs", { enumerable: true, get: function () { return context_1.extractTraceContextFromSqs; } });
Object.defineProperty(exports, "extractTraceContextFromSns", { enumerable: true, get: function () { return context_1.extractTraceContextFromSns; } });
Object.defineProperty(exports, "extractTraceContextFromEventBridge", { enumerable: true, get: function () { return context_1.extractTraceContextFromEventBridge; } });
Object.defineProperty(exports, "extractTraceContextFromStepFunctions", { enumerable: true, get: function () { return context_1.extractTraceContextFromStepFunctions; } });
Object.defineProperty(exports, "extractTraceContextFromKinesis", { enumerable: true, get: function () { return context_1.extractTraceContextFromKinesis; } });
Object.defineProperty(exports, "extractTraceContextFromDynamoDBStream", { enumerable: true, get: function () { return context_1.extractTraceContextFromDynamoDBStream; } });
// Trace context propagation (outgoing)
Object.defineProperty(exports, "createPropagationHeaders", { enumerable: true, get: function () { return context_1.createPropagationHeaders; } });
Object.defineProperty(exports, "createSqsMessageAttributes", { enumerable: true, get: function () { return context_1.createSqsMessageAttributes; } });
Object.defineProperty(exports, "createSnsMessageAttributes", { enumerable: true, get: function () { return context_1.createSnsMessageAttributes; } });
Object.defineProperty(exports, "createEventBridgeTraceContext", { enumerable: true, get: function () { return context_1.createEventBridgeTraceContext; } });
Object.defineProperty(exports, "createStepFunctionsTraceContext", { enumerable: true, get: function () { return context_1.createStepFunctionsTraceContext; } });
// W3C utilities
Object.defineProperty(exports, "toW3CTraceId", { enumerable: true, get: function () { return context_1.toW3CTraceId; } });
Object.defineProperty(exports, "toW3CParentId", { enumerable: true, get: function () { return context_1.toW3CParentId; } });
// Legacy aliases (deprecated)
Object.defineProperty(exports, "withObservationContext", { enumerable: true, get: function () { return context_1.withObservationContext; } });
Object.defineProperty(exports, "withObservationContextSync", { enumerable: true, get: function () { return context_1.withObservationContextSync; } });
// === SPECIALIZED OBSERVERS ===
var observers_1 = require("./observers");
// Span/Tracing
Object.defineProperty(exports, "SpanObserver", { enumerable: true, get: function () { return observers_1.SpanObserver; } });
Object.defineProperty(exports, "withSpan", { enumerable: true, get: function () { return observers_1.withSpan; } });
// Auditing
Object.defineProperty(exports, "AuditObserver", { enumerable: true, get: function () { return observers_1.AuditObserver; } });
// Metrics
Object.defineProperty(exports, "MetricObserver", { enumerable: true, get: function () { return observers_1.MetricObserver; } });
// Workflow
Object.defineProperty(exports, "WorkflowObserver", { enumerable: true, get: function () { return observers_1.WorkflowObserver; } });
// Decision/Feature Flags
Object.defineProperty(exports, "DecisionObserver", { enumerable: true, get: function () { return observers_1.DecisionObserver; } });
// Access Logging
Object.defineProperty(exports, "AccessLogObserver", { enumerable: true, get: function () { return observers_1.AccessLogObserver; } });
// Simple Logging
Object.defineProperty(exports, "LogObserver", { enumerable: true, get: function () { return observers_1.LogObserver; } });
Object.defineProperty(exports, "ChildLogObserver", { enumerable: true, get: function () { return observers_1.ChildLogObserver; } });
// === STORAGE ===
var storage_1 = require("./storage");
Object.defineProperty(exports, "ObservabilityLogEntitySchema", { enumerable: true, get: function () { return storage_1.ObservabilityLogEntitySchema; } });
Object.defineProperty(exports, "ObservabilityLogService", { enumerable: true, get: function () { return storage_1.ObservabilityLogService; } });
// === BACKENDS ===
var cloudwatch_1 = require("./backends/cloudwatch");
Object.defineProperty(exports, "CloudWatchBackend", { enumerable: true, get: function () { return cloudwatch_1.CloudWatchBackend; } });
var dynamodb_1 = require("./backends/dynamodb");
Object.defineProperty(exports, "DynamoDBObservabilityBackend", { enumerable: true, get: function () { return dynamodb_1.DynamoDBObservabilityBackend; } });
var otel_1 = require("./backends/otel");
Object.defineProperty(exports, "OTELObservabilityBackend", { enumerable: true, get: function () { return otel_1.OTELObservabilityBackend; } });
// === UTILITIES ===
var level_utils_1 = require("./utils/level-utils");
Object.defineProperty(exports, "stringToLevel", { enumerable: true, get: function () { return level_utils_1.stringToLevel; } });
Object.defineProperty(exports, "levelToString", { enumerable: true, get: function () { return level_utils_1.levelToString; } });
Object.defineProperty(exports, "levelToPowertoolsLogLevel", { enumerable: true, get: function () { return level_utils_1.levelToPowertoolsLogLevel; } });
var source_utils_1 = require("./utils/source-utils");
Object.defineProperty(exports, "detectSource", { enumerable: true, get: function () { return source_utils_1.detectSource; } });
Object.defineProperty(exports, "createControllerSource", { enumerable: true, get: function () { return source_utils_1.createControllerSource; } });
Object.defineProperty(exports, "createServiceSource", { enumerable: true, get: function () { return source_utils_1.createServiceSource; } });
Object.defineProperty(exports, "createQueueSource", { enumerable: true, get: function () { return source_utils_1.createQueueSource; } });
Object.defineProperty(exports, "createTaskSource", { enumerable: true, get: function () { return source_utils_1.createTaskSource; } });
Object.defineProperty(exports, "getEnvironmentTags", { enumerable: true, get: function () { return source_utils_1.getEnvironmentTags; } });
Object.defineProperty(exports, "mergeTags", { enumerable: true, get: function () { return source_utils_1.mergeTags; } });
var payload_1 = require("./utils/payload");
Object.defineProperty(exports, "truncatePayload", { enumerable: true, get: function () { return payload_1.truncatePayload; } });
Object.defineProperty(exports, "estimateItemSize", { enumerable: true, get: function () { return payload_1.estimateItemSize; } });
Object.defineProperty(exports, "isPayloadWithinLimits", { enumerable: true, get: function () { return payload_1.isPayloadWithinLimits; } });
Object.defineProperty(exports, "safeStringify", { enumerable: true, get: function () { return payload_1.safeStringify; } });
// === DECORATORS ===
var decorators_1 = require("./decorators");
Object.defineProperty(exports, "Traced", { enumerable: true, get: function () { return decorators_1.Traced; } });
Object.defineProperty(exports, "Audited", { enumerable: true, get: function () { return decorators_1.Audited; } });
// === CRUD HOOKS ===
var crud_hooks_1 = require("./crud-hooks");
Object.defineProperty(exports, "CrudObservabilityHooks", { enumerable: true, get: function () { return crud_hooks_1.CrudObservabilityHooks; } });
// === MIDDLEWARE ===
var middleware_1 = require("./middleware");
Object.defineProperty(exports, "apiGatewayObservabilityMiddleware", { enumerable: true, get: function () { return middleware_1.apiGatewayObservabilityMiddleware; } });
Object.defineProperty(exports, "processSqsMessages", { enumerable: true, get: function () { return middleware_1.processSqsMessages; } });
// === OBSERVER BASE UTILITIES ===
var base_1 = require("./observers/base");
Object.defineProperty(exports, "generateId", { enumerable: true, get: function () { return base_1.generateId; } });
Object.defineProperty(exports, "resolveCorrelationId", { enumerable: true, get: function () { return base_1.resolveCorrelationId; } });
Object.defineProperty(exports, "mergeObserverTags", { enumerable: true, get: function () { return base_1.mergeObserverTags; } });
Object.defineProperty(exports, "buildCommonFields", { enumerable: true, get: function () { return base_1.buildCommonFields; } });
Object.defineProperty(exports, "extractObserverOptions", { enumerable: true, get: function () { return base_1.extractObserverOptions; } });
Object.defineProperty(exports, "mapError", { enumerable: true, get: function () { return base_1.mapError; } });
Object.defineProperty(exports, "captureEvent", { enumerable: true, get: function () { return base_1.captureEvent; } });
Object.defineProperty(exports, "captureEventAsync", { enumerable: true, get: function () { return base_1.captureEventAsync; } });
Object.defineProperty(exports, "setCapturer", { enumerable: true, get: function () { return base_1.setCapturer; } });
Object.defineProperty(exports, "resetCapturer", { enumerable: true, get: function () { return base_1.resetCapturer; } });
// === TESTING UTILITIES ===
var testing_1 = require("./testing");
Object.defineProperty(exports, "MockBackend", { enumerable: true, get: function () { return testing_1.MockBackend; } });
Object.defineProperty(exports, "setupTestObservability", { enumerable: true, get: function () { return testing_1.setupTestObservability; } });
Object.defineProperty(exports, "cleanupTestObservability", { enumerable: true, get: function () { return testing_1.cleanupTestObservability; } });
Object.defineProperty(exports, "createTestContext", { enumerable: true, get: function () { return testing_1.createTestContext; } });
Object.defineProperty(exports, "createTestContextSync", { enumerable: true, get: function () { return testing_1.createTestContextSync; } });
Object.defineProperty(exports, "assertEventCaptured", { enumerable: true, get: function () { return testing_1.assertEventCaptured; } });
Object.defineProperty(exports, "assertNoEventCaptured", { enumerable: true, get: function () { return testing_1.assertNoEventCaptured; } });
Object.defineProperty(exports, "assertEventCount", { enumerable: true, get: function () { return testing_1.assertEventCount; } });
Object.defineProperty(exports, "createTestActor", { enumerable: true, get: function () { return testing_1.createTestActor; } });
Object.defineProperty(exports, "createTestObservationContext", { enumerable: true, get: function () { return testing_1.createTestObservationContext; } });
// === UTILITY CACHE CONTROL ===
var source_utils_2 = require("./utils/source-utils");
Object.defineProperty(exports, "clearEnvironmentTagsCache", { enumerable: true, get: function () { return source_utils_2.clearEnvironmentTagsCache; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBMEVHOzs7O0FBRUgscUJBQXFCO0FBQ3JCLGlDQWlCaUI7QUFoQmYsMkdBQUEsa0JBQWtCLE9BQUE7QUFjbEIsOEdBQUEscUJBQXFCLE9BQUE7QUFJdkIsdUJBQXVCO0FBQ3ZCLHFDQUltQjtBQUhqQiwrR0FBQSxvQkFBb0IsT0FBQTtBQUNwQixtR0FBQSxRQUFRLE9BQUE7QUFDUiw0R0FBQSxpQkFBaUIsT0FBQTtBQUduQix3QkFBd0I7QUFDeEIsbUNBTWtCO0FBTGhCLHVHQUFBLGFBQWEsT0FBQTtBQUNiLHdHQUFBLGNBQWMsT0FBQTtBQUNkLHlHQUFBLGVBQWUsT0FBQTtBQUNmLHdHQUFBLGNBQWMsT0FBQTtBQUloQiw2QkFBNkI7QUFDN0IscUNBNkNtQjtBQXhDakIsNkNBQTZDO0FBQzdDLG1IQUFBLHdCQUF3QixPQUFBO0FBQ3hCLHlHQUFBLGNBQWMsT0FBQTtBQUNkLDZHQUFBLGtCQUFrQixPQUFBO0FBRWxCLGlCQUFpQjtBQUNqQiw0R0FBQSxpQkFBaUIsT0FBQTtBQUNqQixxR0FBQSxVQUFVLE9BQUE7QUFDViwyR0FBQSxnQkFBZ0IsT0FBQTtBQUNoQixtSEFBQSx3QkFBd0IsT0FBQTtBQUN4QiwwR0FBQSxlQUFlLE9BQUE7QUFFZix1QkFBdUI7QUFDdkIsMEdBQUEsZUFBZSxPQUFBO0FBQ2YseUdBQUEsY0FBYyxPQUFBO0FBQ2QsZ0hBQUEscUJBQXFCLE9BQUE7QUFFckIsc0NBQXNDO0FBQ3RDLHlIQUFBLDhCQUE4QixPQUFBO0FBQzlCLHFIQUFBLDBCQUEwQixPQUFBO0FBQzFCLHFIQUFBLDBCQUEwQixPQUFBO0FBQzFCLDZIQUFB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Qiw4R0FBQSxtQkFBbUIsT0FBQTtBQUNuQixnSEFBQSxxQkFBcUIsT0FBQTtBQUNyQiwyR0FBQSxnQkFBZ0IsT0FBQTtBQUNoQiwwR0FBQSxlQUFlLE9BQUE7QUFDZix1SEFBQSw0QkFBNEIsT0FBQTtBQUc5QixnQ0FBZ0M7QUFDaEMscURBQWlFO0FBQXhELHlIQUFBLHlCQUF5QixPQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBGVzI0IE9ic2VydmFiaWxpdHkgU3lzdGVtXG4gKiBcbiAqIEEgdW5pZmllZCBvYnNlcnZhYmlsaXR5IHN5c3RlbSBmb3IgbG9nZ2luZywgbWV0cmljcywgdHJhY2VzLCBhdWRpdHMsIGFuZCBtb3JlLlxuICogXG4gKiAjIyBBcmNoaXRlY3R1cmVcbiAqIFxuICogYGBgXG4gKiDilIzilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJBcbiAqIOKUgiBBcHBsaWNhdGlvbiBMYXllciAoVXNlciBDb2RlKSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIJcbiAqIOKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKGk1xuICog4pSM4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSQXG4gKiDilIIgU3BlY2lhbGl6ZWQgT2JzZXJ2ZXJzICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCXG4gKiDilIIgU3Bhbk9ic2VydmVyIHwgQXVkaXRPYnNlcnZlciB8IE1ldHJpY09ic2VydmVyICAgICAgICAgICAgICDilIJcbiAqIOKUgiBXb3JrZmxvd09ic2VydmVyIHwgRGVjaXNpb25PYnNlcnZlciB8IEFjY2Vzc0xvZ09ic2VydmVyICAgIOKUglxuICog4pSU4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSYXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4oaTXG4gKiDilIzilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJBcbiAqIOKUgiBDb3JlIE9ic2VydmVyIChPYnNlcnZhYmlsaXR5TWFuYWdlcikgICAgICAgICAgICAgICAgICAgICAgICDilIJcbiAqIOKUgiBjYXB0dXJlKCkgfCBmbHVzaCgpIHwgaW5pdGlhbGl6ZUludm9jYXRpb24oKSAgICAgICAgICAgICAgIOKUglxuICog4pSU4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSYXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4oaTXG4gKiDilIzilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJBcbiAqIOKUgiBCYWNrZW5kczogRHluYW1vREIgfCBDbG91ZFdhdGNoIHwgT1RFTC9YLVJheSAgICAgICAgICAgICAgIOKUglxuICog4pSU4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSYXG4gKiBgYGBcbiAqIFxuICogIyMgUXVpY2sgU3RhcnRcbiAqIFxuICogIyMjIDEuIEVzdGFibGlzaCBDb250ZXh0XG4gKiBcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHJ1bldpdGhDb250ZXh0LCBjcmVhdGVPYnNlcnZhdGlvbkNvbnRleHQgfSBmcm9tICdAdGVuMjRncm91cC9mdzI0L29ic2VydmFiaWxpdHknO1xuICogXG4gKiBhd2FpdCBydW5XaXRoQ29udGV4dChcbiAqICAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KHJlcXVlc3RJZCwgeyBhY3RvciB9KSxcbiAqICAgYXN5bmMgKCkgPT4ge1xuICogICAgIC8vIEFsbCBvYnNlcnZhdGlvbnMgaGVyZSBzaGFyZSB0aGUgc2FtZSBjb3JyZWxhdGlvbklkXG4gKiAgIH1cbiAqICk7XG4gKiBgYGBcbiAqIFxuICogIyMjIDIuIFVzZSBPYnNlcnZlcnNcbiAqIFxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgU3Bhbk9ic2VydmVyLCBBdWRpdE9ic2VydmVyLCBNZXRyaWNPYnNlcnZlciB9IGZyb20gJ0B0ZW4yNGdyb3VwL2Z3MjQvb2JzZXJ2YWJpbGl0eSc7XG4gKiBcbiAqIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ3Byb2Nlc3NPcmRlcicpO1xuICogQXVkaXRPYnNlcnZlci5lbnRpdHlDcmVhdGUoJ09yZGVyJywgb3JkZXJJZCwgZGF0YSk7XG4gKiBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoJ29yZGVycy5jcmVhdGVkJyk7XG4gKiBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gKiBgYGBcbiAqIFxuICogIyMjIDMuIEFQSSBHYXRld2F5IENvbnRyb2xsZXJcbiAqIFxuICogYGBgdHlwZXNjcmlwdFxuICogZXhwb3J0IGNsYXNzIE15Q29udHJvbGxlciBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICogICBjb25zdHJ1Y3RvcigpIHtcbiAqICAgICBzdXBlcigpO1xuICogICAgIHRoaXMudXNlTWlkZGxld2FyZShhcGlHYXRld2F5T2JzZXJ2YWJpbGl0eU1pZGRsZXdhcmUpO1xuICogICB9XG4gKiAgIFxuICogICBhc3luYyBteUhhbmRsZXIocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCkge1xuICogICAgIC8vIENvbnRleHQgYXZhaWxhYmxlIHZpYSBjdHgub2JzZXJ2YWJpbGl0eVxuICogICAgIGNvbnN0IHsgY29ycmVsYXRpb25JZCwgY29udGV4dCB9ID0gY3R4Lm9ic2VydmFiaWxpdHk7XG4gKiAgICAgXG4gKiAgICAgLy8gRm9yIG5lc3RlZCBvcGVyYXRpb25zOlxuICogICAgIHJldHVybiBydW5XaXRoQ29udGV4dChjb250ZXh0LCBhc3luYyAoKSA9PiB7XG4gKiAgICAgICBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ25lc3RlZC1vcCcpO1xuICogICAgIH0pO1xuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuXG4vLyA9PT0gQ09SRSBUWVBFUyA9PT1cbmV4cG9ydCB7XG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlFdmVudFR5cGUsXG4gIEJhc2VFdmVudFR5cGUsXG4gIE9ic2VydmFiaWxpdHlFcnJvcixcbiAgQ2FwdHVyZUlucHV0LFxuICBDYXB0dXJlT3B0aW9ucyxcbiAgSUV2ZW50Q2FwdHVyZSxcbiAgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnLFxuICBPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICBTYW1wbGluZ0NvbmZpZyxcbiAgVHlwZVNwZWNpZmljQ29uZmlnLFxuICBEZWZhdWx0U2FtcGxpbmdDb25maWcsXG4gIE9ic2VydmF0aW9uQ29udGV4dCxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbi8vID09PSBDT1JFIE1BTkFHRVIgPT09XG5leHBvcnQge1xuICBPYnNlcnZhYmlsaXR5TWFuYWdlcixcbiAgT2JzZXJ2ZXIsXG4gIHdpdGhPYnNlcnZhYmlsaXR5LFxufSBmcm9tICcuL21hbmFnZXInO1xuXG4vLyA9PT0gQ09ORklHVVJBVElPTiA9PT1cbmV4cG9ydCB7XG4gIENvbmZpZ01hbmFnZXIsXG4gIHZhbGlkYXRlQ29uZmlnLFxuICBDT05GSUdfREVGQVVMVFMsXG4gIFZBTElEX0JBQ0tFTkRTLFxuICBWYWxpZEJhY2tlbmQsXG59IGZyb20gJy4vY29uZmlnJztcblxuLy8gPT09IENPTlRFWFQgTUFOQUdFTUVOVCA9PT1cbmV4cG9ydCB7XG4gIC8vIFR5cGVzXG4gIENyZWF0ZU9ic2VydmF0aW9uQ29udGV4dE9wdGlvbnMsXG4gIFBhcnNlZFRyYWNlQ29udGV4dCxcblxuICAvLyBDb250ZXh0IGNyZWF0aW9uICYgZXhlY3V0aW9uIChQUklNQVJZIEFQSSlcbiAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0LFxuICBydW5XaXRoQ29udGV4dCxcbiAgcnVuV2l0aENvbnRleHRTeW5jLFxuXG4gIC8vIENvbnRleHQgYWNjZXNzXG4gIGdldEN1cnJlbnRDb250ZXh0LFxuICBoYXNDb250ZXh0LFxuICBnZXRDb3JyZWxhdGlvbklkLFxuICBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMsXG4gIGdldENvbnRleHRBY3RvcixcblxuICAvLyBDb250ZXh0IG1vZGlmaWNhdGlvblxuICBzZXRDb250ZXh0QWN0b3IsXG4gIGFkZENvbnRleHRUYWdzLFxuICBzZXRDb250ZXh0UGFyZW50TG9nSWQsXG5cbiAgLy8gVHJhY2UgY29udGV4dCBleHRyYWN0aW9uIChpbmNvbWluZylcbiAgZXh0cmFjdFRyYWNlQ29udGV4dEZyb21IZWFkZXJzLFxuICBleHRyYWN0VHJhY2VDb250ZXh0RnJvbVNxcyxcbiAgZXh0cmFjdFRyYWNlQ29udGV4dEZyb21TbnMsXG4gIGV4dHJhY3RUcmFjZUNvbnRleHRGcm9tRXZlbnRCcmlkZ2UsXG4gIGV4dHJhY3RUcmFjZUNvbnRleHRGcm9tU3RlcEZ1bmN0aW9ucyxcbiAgZXh0cmFjdFRyYWNlQ29udGV4dEZyb21LaW5lc2lzLFxuICBleHRyYWN0VHJhY2VDb250ZXh0RnJvbUR5bmFtb0RCU3RyZWFtLFxuXG4gIC8vIFRyYWNlIGNvbnRleHQgcHJvcGFnYXRpb24gKG91dGdvaW5nKVxuICBjcmVhdGVQcm9wYWdhdGlvbkhlYWRlcnMsXG4gIGNyZWF0ZVNxc01lc3NhZ2VBdHRyaWJ1dGVzLFxuICBjcmVhdGVTbnNNZXNzYWdlQXR0cmlidXRlcyxcbiAgY3JlYXRlRXZlbnRCcmlkZ2VUcmFjZUNvbnRleHQsXG4gIGNyZWF0ZVN0ZXBGdW5jdGlvbnNUcmFjZUNvbnRleHQsXG5cbiAgLy8gVzNDIHV0aWxpdGllc1xuICB0b1czQ1RyYWNlSWQsXG4gIHRvVzNDUGFyZW50SWQsXG5cbiAgLy8gTGVnYWN5IGFsaWFzZXMgKGRlcHJlY2F0ZWQpXG4gIHdpdGhPYnNlcnZhdGlvbkNvbnRleHQsXG4gIHdpdGhPYnNlcnZhdGlvbkNvbnRleHRTeW5jLFxufSBmcm9tICcuL2NvbnRleHQnO1xuXG4vLyA9PT0gU1BFQ0lBTElaRUQgT0JTRVJWRVJTID09PVxuZXhwb3J0IHtcbiAgLy8gU3Bhbi9UcmFjaW5nXG4gIFNwYW5PYnNlcnZlcixcbiAgd2l0aFNwYW4sXG4gIFNwYW5PcHRpb25zLFxuXG4gIC8vIEF1ZGl0aW5nXG4gIEF1ZGl0T2JzZXJ2ZXIsXG4gIEF1ZGl0T2JzZXJ2ZXJPcHRpb25zLFxuXG4gIC8vIE1ldHJpY3NcbiAgTWV0cmljT2JzZXJ2ZXIsXG4gIE1ldHJpY09wdGlvbnMsXG5cbiAgLy8gV29ya2Zsb3dcbiAgV29ya2Zsb3dPYnNlcnZlcixcbiAgV29ya2Zsb3dPcHRpb25zLFxuICBTdGVwT3B0aW9ucyxcblxuICAvLyBEZWNpc2lvbi9GZWF0dXJlIEZsYWdzXG4gIERlY2lzaW9uT2JzZXJ2ZXIsXG4gIERlY2lzaW9uUnVsZSxcblxuICAvLyBBY2Nlc3MgTG9nZ2luZ1xuICBBY2Nlc3NMb2dPYnNlcnZlcixcbiAgQWNjZXNzTG9nT3B0aW9ucyxcblxuICAvLyBTaW1wbGUgTG9nZ2luZ1xuICBMb2dPYnNlcnZlcixcbiAgTG9nT3B0aW9ucyxcbiAgQ2hpbGRMb2dPYnNlcnZlcixcbn0gZnJvbSAnLi9vYnNlcnZlcnMnO1xuXG4vLyA9PT0gU1RPUkFHRSA9PT1cbmV4cG9ydCB7XG4gIE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEsXG4gIE9ic2VydmFiaWxpdHlMb2dTY2hlbWEsXG4gIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlLFxuICBSZWNvbnN0cnVjdGVkU3BhbixcbiAgTG9nUmVjb3JkLFxufSBmcm9tICcuL3N0b3JhZ2UnO1xuXG4vLyA9PT0gQkFDS0VORFMgPT09XG5leHBvcnQgeyBDbG91ZFdhdGNoQmFja2VuZCwgQ2xvdWRXYXRjaEJhY2tlbmRPcHRpb25zIH0gZnJvbSAnLi9iYWNrZW5kcy9jbG91ZHdhdGNoJztcbmV4cG9ydCB7IER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQsIER5bmFtb0RCQmFja2VuZE9wdGlvbnMgfSBmcm9tICcuL2JhY2tlbmRzL2R5bmFtb2RiJztcbmV4cG9ydCB7IE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZCwgT1RFTEJhY2tlbmRPcHRpb25zIH0gZnJvbSAnLi9iYWNrZW5kcy9vdGVsJztcblxuLy8gPT09IFVUSUxJVElFUyA9PT1cbmV4cG9ydCB7XG4gIHN0cmluZ1RvTGV2ZWwsXG4gIGxldmVsVG9TdHJpbmcsXG4gIGxldmVsVG9Qb3dlcnRvb2xzTG9nTGV2ZWwsXG59IGZyb20gJy4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuXG5leHBvcnQge1xuICBkZXRlY3RTb3VyY2UsXG4gIGNyZWF0ZUNvbnRyb2xsZXJTb3VyY2UsXG4gIGNyZWF0ZVNlcnZpY2VTb3VyY2UsXG4gIGNyZWF0ZVF1ZXVlU291cmNlLFxuICBjcmVhdGVUYXNrU291cmNlLFxuICBnZXRFbnZpcm9ubWVudFRhZ3MsXG4gIG1lcmdlVGFncyxcbn0gZnJvbSAnLi91dGlscy9zb3VyY2UtdXRpbHMnO1xuXG5leHBvcnQge1xuICB0cnVuY2F0ZVBheWxvYWQsXG4gIGVzdGltYXRlSXRlbVNpemUsXG4gIGlzUGF5bG9hZFdpdGhpbkxpbWl0cyxcbiAgc2FmZVN0cmluZ2lmeSxcbn0gZnJvbSAnLi91dGlscy9wYXlsb2FkJztcblxuLy8gPT09IERFQ09SQVRPUlMgPT09XG5leHBvcnQge1xuICBUcmFjZWQsXG4gIFRyYWNlZE9wdGlvbnMsXG4gIEF1ZGl0ZWQsXG4gIEF1ZGl0ZWRPcHRpb25zLFxufSBmcm9tICcuL2RlY29yYXRvcnMnO1xuXG4vLyA9PT0gQ1JVRCBIT09LUyA9PT1cbmV4cG9ydCB7XG4gIENydWRPYnNlcnZhYmlsaXR5SG9va3MsXG4gIENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCxcbn0gZnJvbSAnLi9jcnVkLWhvb2tzJztcblxuLy8gPT09IE1JRERMRVdBUkUgPT09XG5leHBvcnQge1xuICBhcGlHYXRld2F5T2JzZXJ2YWJpbGl0eU1pZGRsZXdhcmUsXG4gIHByb2Nlc3NTcXNNZXNzYWdlcyxcbiAgT2JzZXJ2YWJpbGl0eUNvbnRleHREYXRhLFxuICBTcXNNZXNzYWdlLFxuICBTcXNNZXNzYWdlSGFuZGxlcixcbn0gZnJvbSAnLi9taWRkbGV3YXJlJztcblxuLy8gPT09IE9CU0VSVkVSIEJBU0UgVVRJTElUSUVTID09PVxuZXhwb3J0IHtcbiAgQmFzZU9ic2VydmVyT3B0aW9ucyxcbiAgQ29tbW9uRmllbGRzLFxuICBnZW5lcmF0ZUlkLFxuICByZXNvbHZlQ29ycmVsYXRpb25JZCxcbiAgbWVyZ2VPYnNlcnZlclRhZ3MsXG4gIGJ1aWxkQ29tbW9uRmllbGRzLFxuICBleHRyYWN0T2JzZXJ2ZXJPcHRpb25zLFxuICBtYXBFcnJvcixcbiAgY2FwdHVyZUV2ZW50LFxuICBjYXB0dXJlRXZlbnRBc3luYyxcbiAgc2V0Q2FwdHVyZXIsXG4gIHJlc2V0Q2FwdHVyZXIsXG59IGZyb20gJy4vb2JzZXJ2ZXJzL2Jhc2UnO1xuXG4vLyA9PT0gVEVTVElORyBVVElMSVRJRVMgPT09XG5leHBvcnQge1xuICBNb2NrQmFja2VuZCxcbiAgc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSxcbiAgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5LFxuICBjcmVhdGVUZXN0Q29udGV4dCxcbiAgY3JlYXRlVGVzdENvbnRleHRTeW5jLFxuICBhc3NlcnRFdmVudENhcHR1cmVkLFxuICBhc3NlcnROb0V2ZW50Q2FwdHVyZWQsXG4gIGFzc2VydEV2ZW50Q291bnQsXG4gIGNyZWF0ZVRlc3RBY3RvcixcbiAgY3JlYXRlVGVzdE9ic2VydmF0aW9uQ29udGV4dCxcbn0gZnJvbSAnLi90ZXN0aW5nJztcblxuLy8gPT09IFVUSUxJVFkgQ0FDSEUgQ09OVFJPTCA9PT1cbmV4cG9ydCB7IGNsZWFyRW52aXJvbm1lbnRUYWdzQ2FjaGUgfSBmcm9tICcuL3V0aWxzL3NvdXJjZS11dGlscyc7XG4iXX0=