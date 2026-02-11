"use strict";
/**
 * FW24 Observability System
 *
 * Unified observability for logging, metrics, traces, and audits.
 *
 * ## Quick Start
 *
 * ```typescript
 * // Context is auto-established in controllers
 * // Access via ctx.executionContext or getCurrentExecutionContext()
 *
 * await SpanObserver.withSpan('processOrder', async (span) => {
 *   AuditObserver.entityCreate('Order', orderId, data);
 *   MetricObserver.increment('orders.created');
 * });
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toW3CParentId = exports.createStepFunctionsContext = exports.createSqsAttributes = exports.createSnsAttributes = exports.createHttpHeaders = exports.createEventBridgeContext = exports.extractFromStepFunctions = exports.extractFromSqsRecord = exports.extractFromSqs = exports.extractFromSns = exports.extractFromKinesis = exports.extractFromHeaders = exports.extractFromEventBridge = exports.setSource = exports.setAttributes = exports.setAttribute = exports.setActor = exports.enrichActor = exports.addTags = exports.getCurrentParentObservabilityLogId = exports.getCapturedParentId = exports.withContext = exports.runWithExecutionContextSync = exports.runWithExecutionContext = exports.getCurrentSpan = exports.getObservabilityState = exports.getCurrentExecutionContext = exports.createExecutionContext = exports.productionPreset = exports.minimalPreset = exports.getPreset = exports.developmentPreset = exports.debugPreset = exports.validateConfig = exports.VALID_BACKENDS = exports.extendPreset = exports.createObservabilityConfig = exports.CONFIG_DEFAULTS = exports.withObservability = exports.ObservabilityManager = exports.Observer = exports.groupCheckpointsByOperation = exports.buildAndEvaluate = exports.pickNoiseDecision = exports.applyNoiseReduction = exports.getEffectivePriority = exports.evaluateNoiseRules = exports.DECISION_BASE_PRIORITY = exports.DefaultSamplingConfig = exports.ObservabilityLevel = void 0;
exports.createTaskSource = exports.createServiceSource = exports.createQueueSource = exports.createControllerSource = exports.clearEnvironmentTagsCache = exports.truncateItem = exports.truncatePayload = exports.safeSerialize = exports.safeStringify = exports.isPayloadWithinLimits = exports.estimateItemSize = exports.observedCallSync = exports.observedCall = exports.stringToLevel = exports.levelToString = exports.levelToPowertoolsLogLevel = exports.generateTraceId = exports.generateSpanId = exports.normalizeStackTrace = exports.normalizeErrorMessage = exports.computeErrorFingerprint = exports.shouldRedactKey = exports.redactSensitiveData = exports.extendBlacklist = exports.DEFAULT_PROTECTED_FIELDS = exports.DEFAULT_BLACKLISTED_KEYS = exports.clearRedactorCache = exports.OTELObservabilityBackend = exports.DynamoDBObservabilityBackend = exports.CloudWatchBackend = exports.initializeCapturer = exports.resetCapturer = exports.setCapturer = exports.normalizeError = exports.mapError = exports.mergeTags = exports.resolveCorrelationId = exports.buildCaptureInput = exports.captureRecordAsync = exports.captureRecord = exports.generateId = exports.QueryObserver = exports.MetricObserver = exports.LogObserver = exports.AuditObserver = exports.wrapInSpan = exports.withSpanSync = exports.withSpan = exports.SpanObserver = exports.toW3CTraceId = void 0;
exports.setupTestObservability = exports.MockBackend = exports.createTestExecutionContext = exports.createTestContextSync = exports.createTestContext = exports.createTestActor = exports.cleanupTestObservability = exports.assertNoEventCaptured = exports.assertEventCount = exports.assertEventCaptured = exports.ObservabilityLogService = exports.ObservabilityLogEntitySchema = exports.mergeObservabilityConfigs = exports.CrudObservabilityHooks = exports.Observed = exports.BatchProgress = exports.buildTraceGraph = exports.mergeSourceTags = exports.getEnvironmentTags = exports.detectSource = void 0;
const di_1 = require("../di");
const config_1 = require("./config");
// ═══════════════════════════════════════════════════════════════════════════
// REGISTER DEFAULT CONFIG (priority 0 - apps can override with higher priority)
// ═══════════════════════════════════════════════════════════════════════════
di_1.DIContainer.ROOT.registerConfigProvider({
    provide: 'observability',
    useConfig: (0, config_1.createObservabilityConfig)(),
    priority: 0
});
// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════
// === CORE TYPES ===
var types_1 = require("./types");
Object.defineProperty(exports, "ObservabilityLevel", { enumerable: true, get: function () { return types_1.ObservabilityLevel; } });
Object.defineProperty(exports, "DefaultSamplingConfig", { enumerable: true, get: function () { return types_1.DefaultSamplingConfig; } });
// === NOISE REDUCTION ===
var priority_1 = require("./noise-reduction/priority");
Object.defineProperty(exports, "DECISION_BASE_PRIORITY", { enumerable: true, get: function () { return priority_1.DECISION_BASE_PRIORITY; } });
Object.defineProperty(exports, "evaluateNoiseRules", { enumerable: true, get: function () { return priority_1.evaluateNoiseRules; } });
Object.defineProperty(exports, "getEffectivePriority", { enumerable: true, get: function () { return priority_1.getEffectivePriority; } });
var noise_reduction_1 = require("./noise-reduction");
Object.defineProperty(exports, "applyNoiseReduction", { enumerable: true, get: function () { return noise_reduction_1.applyNoiseReduction; } });
Object.defineProperty(exports, "pickNoiseDecision", { enumerable: true, get: function () { return noise_reduction_1.pickNoiseDecision; } });
Object.defineProperty(exports, "buildAndEvaluate", { enumerable: true, get: function () { return noise_reduction_1.buildAndEvaluate; } });
// === SPAN COMPRESSION ===
var span_compression_1 = require("./span-compression");
Object.defineProperty(exports, "groupCheckpointsByOperation", { enumerable: true, get: function () { return span_compression_1.groupCheckpointsByOperation; } });
// === CORE MANAGER ===
var manager_1 = require("./manager");
Object.defineProperty(exports, "Observer", { enumerable: true, get: function () { return manager_1.Observer; } });
Object.defineProperty(exports, "ObservabilityManager", { enumerable: true, get: function () { return manager_1.ObservabilityManager; } });
Object.defineProperty(exports, "withObservability", { enumerable: true, get: function () { return manager_1.withObservability; } });
// === CONFIGURATION ===
var config_2 = require("./config");
Object.defineProperty(exports, "CONFIG_DEFAULTS", { enumerable: true, get: function () { return config_2.CONFIG_DEFAULTS; } });
Object.defineProperty(exports, "createObservabilityConfig", { enumerable: true, get: function () { return config_2.createObservabilityConfig; } });
Object.defineProperty(exports, "extendPreset", { enumerable: true, get: function () { return config_2.extendPreset; } });
Object.defineProperty(exports, "VALID_BACKENDS", { enumerable: true, get: function () { return config_2.VALID_BACKENDS; } });
Object.defineProperty(exports, "validateConfig", { enumerable: true, get: function () { return config_2.validateConfig; } });
// === PRESETS ===
var presets_1 = require("./presets");
Object.defineProperty(exports, "debugPreset", { enumerable: true, get: function () { return presets_1.debugPreset; } });
Object.defineProperty(exports, "developmentPreset", { enumerable: true, get: function () { return presets_1.developmentPreset; } });
Object.defineProperty(exports, "getPreset", { enumerable: true, get: function () { return presets_1.getPreset; } });
Object.defineProperty(exports, "minimalPreset", { enumerable: true, get: function () { return presets_1.minimalPreset; } });
Object.defineProperty(exports, "productionPreset", { enumerable: true, get: function () { return presets_1.productionPreset; } });
// === CONTEXT ===
var context_1 = require("./context");
// Storage & Lifecycle
Object.defineProperty(exports, "createExecutionContext", { enumerable: true, get: function () { return context_1.createExecutionContext; } });
Object.defineProperty(exports, "getCurrentExecutionContext", { enumerable: true, get: function () { return context_1.getCurrentExecutionContext; } });
Object.defineProperty(exports, "getObservabilityState", { enumerable: true, get: function () { return context_1.getObservabilityState; } });
Object.defineProperty(exports, "getCurrentSpan", { enumerable: true, get: function () { return context_1.getCurrentSpan; } });
Object.defineProperty(exports, "runWithExecutionContext", { enumerable: true, get: function () { return context_1.runWithExecutionContext; } });
Object.defineProperty(exports, "runWithExecutionContextSync", { enumerable: true, get: function () { return context_1.runWithExecutionContextSync; } });
// Context Override
Object.defineProperty(exports, "withContext", { enumerable: true, get: function () { return context_1.withContext; } });
// Parent Resolution
Object.defineProperty(exports, "getCapturedParentId", { enumerable: true, get: function () { return context_1.getCapturedParentId; } });
Object.defineProperty(exports, "getCurrentParentObservabilityLogId", { enumerable: true, get: function () { return context_1.getCurrentParentObservabilityLogId; } });
// Enrichment
Object.defineProperty(exports, "addTags", { enumerable: true, get: function () { return context_1.addTags; } });
Object.defineProperty(exports, "enrichActor", { enumerable: true, get: function () { return context_1.enrichActor; } });
Object.defineProperty(exports, "setActor", { enumerable: true, get: function () { return context_1.setActor; } });
Object.defineProperty(exports, "setAttribute", { enumerable: true, get: function () { return context_1.setAttribute; } });
Object.defineProperty(exports, "setAttributes", { enumerable: true, get: function () { return context_1.setAttributes; } });
Object.defineProperty(exports, "setSource", { enumerable: true, get: function () { return context_1.setSource; } });
// Propagation - Extraction
Object.defineProperty(exports, "extractFromEventBridge", { enumerable: true, get: function () { return context_1.extractFromEventBridge; } });
Object.defineProperty(exports, "extractFromHeaders", { enumerable: true, get: function () { return context_1.extractFromHeaders; } });
Object.defineProperty(exports, "extractFromKinesis", { enumerable: true, get: function () { return context_1.extractFromKinesis; } });
Object.defineProperty(exports, "extractFromSns", { enumerable: true, get: function () { return context_1.extractFromSns; } });
Object.defineProperty(exports, "extractFromSqs", { enumerable: true, get: function () { return context_1.extractFromSqs; } });
Object.defineProperty(exports, "extractFromSqsRecord", { enumerable: true, get: function () { return context_1.extractFromSqsRecord; } });
Object.defineProperty(exports, "extractFromStepFunctions", { enumerable: true, get: function () { return context_1.extractFromStepFunctions; } });
// Propagation - Creation
Object.defineProperty(exports, "createEventBridgeContext", { enumerable: true, get: function () { return context_1.createEventBridgeContext; } });
Object.defineProperty(exports, "createHttpHeaders", { enumerable: true, get: function () { return context_1.createHttpHeaders; } });
Object.defineProperty(exports, "createSnsAttributes", { enumerable: true, get: function () { return context_1.createSnsAttributes; } });
Object.defineProperty(exports, "createSqsAttributes", { enumerable: true, get: function () { return context_1.createSqsAttributes; } });
Object.defineProperty(exports, "createStepFunctionsContext", { enumerable: true, get: function () { return context_1.createStepFunctionsContext; } });
Object.defineProperty(exports, "toW3CParentId", { enumerable: true, get: function () { return context_1.toW3CParentId; } });
Object.defineProperty(exports, "toW3CTraceId", { enumerable: true, get: function () { return context_1.toW3CTraceId; } });
// === CORE OBSERVERS ===
var observers_1 = require("./observers");
// Span
Object.defineProperty(exports, "SpanObserver", { enumerable: true, get: function () { return observers_1.SpanObserver; } });
Object.defineProperty(exports, "withSpan", { enumerable: true, get: function () { return observers_1.withSpan; } });
Object.defineProperty(exports, "withSpanSync", { enumerable: true, get: function () { return observers_1.withSpanSync; } });
Object.defineProperty(exports, "wrapInSpan", { enumerable: true, get: function () { return observers_1.wrapInSpan; } });
// Audit
Object.defineProperty(exports, "AuditObserver", { enumerable: true, get: function () { return observers_1.AuditObserver; } });
// Log
Object.defineProperty(exports, "LogObserver", { enumerable: true, get: function () { return observers_1.LogObserver; } });
// Metric
Object.defineProperty(exports, "MetricObserver", { enumerable: true, get: function () { return observers_1.MetricObserver; } });
// Query (Database performance tracking)
Object.defineProperty(exports, "QueryObserver", { enumerable: true, get: function () { return observers_1.QueryObserver; } });
// Base utilities
Object.defineProperty(exports, "generateId", { enumerable: true, get: function () { return observers_1.generateId; } });
Object.defineProperty(exports, "captureRecord", { enumerable: true, get: function () { return observers_1.captureRecord; } });
Object.defineProperty(exports, "captureRecordAsync", { enumerable: true, get: function () { return observers_1.captureRecordAsync; } });
Object.defineProperty(exports, "buildCaptureInput", { enumerable: true, get: function () { return observers_1.buildCaptureInput; } });
Object.defineProperty(exports, "resolveCorrelationId", { enumerable: true, get: function () { return observers_1.resolveCorrelationId; } });
Object.defineProperty(exports, "mergeTags", { enumerable: true, get: function () { return observers_1.mergeTags; } });
Object.defineProperty(exports, "mapError", { enumerable: true, get: function () { return observers_1.mapError; } });
Object.defineProperty(exports, "normalizeError", { enumerable: true, get: function () { return observers_1.normalizeError; } });
// Testing utilities
Object.defineProperty(exports, "setCapturer", { enumerable: true, get: function () { return observers_1.setCapturer; } });
Object.defineProperty(exports, "resetCapturer", { enumerable: true, get: function () { return observers_1.resetCapturer; } });
Object.defineProperty(exports, "initializeCapturer", { enumerable: true, get: function () { return observers_1.initializeCapturer; } });
// === BACKENDS (DI-managed, exported for type references) ===
var cloudwatch_1 = require("./backends/cloudwatch");
Object.defineProperty(exports, "CloudWatchBackend", { enumerable: true, get: function () { return cloudwatch_1.CloudWatchBackend; } });
var dynamodb_1 = require("./backends/dynamodb");
Object.defineProperty(exports, "DynamoDBObservabilityBackend", { enumerable: true, get: function () { return dynamodb_1.DynamoDBObservabilityBackend; } });
var otel_1 = require("./backends/otel");
Object.defineProperty(exports, "OTELObservabilityBackend", { enumerable: true, get: function () { return otel_1.OTELObservabilityBackend; } });
// === UTILITIES ===
var data_protection_1 = require("./utils/data-protection");
Object.defineProperty(exports, "clearRedactorCache", { enumerable: true, get: function () { return data_protection_1.clearRedactorCache; } });
Object.defineProperty(exports, "DEFAULT_BLACKLISTED_KEYS", { enumerable: true, get: function () { return data_protection_1.DEFAULT_BLACKLISTED_KEYS; } });
Object.defineProperty(exports, "DEFAULT_PROTECTED_FIELDS", { enumerable: true, get: function () { return data_protection_1.DEFAULT_PROTECTED_FIELDS; } });
Object.defineProperty(exports, "extendBlacklist", { enumerable: true, get: function () { return data_protection_1.extendBlacklist; } });
Object.defineProperty(exports, "redactSensitiveData", { enumerable: true, get: function () { return data_protection_1.redactSensitiveData; } });
Object.defineProperty(exports, "shouldRedactKey", { enumerable: true, get: function () { return data_protection_1.shouldRedactKey; } });
var error_fingerprint_1 = require("./utils/error-fingerprint");
Object.defineProperty(exports, "computeErrorFingerprint", { enumerable: true, get: function () { return error_fingerprint_1.computeErrorFingerprint; } });
Object.defineProperty(exports, "normalizeErrorMessage", { enumerable: true, get: function () { return error_fingerprint_1.normalizeErrorMessage; } });
Object.defineProperty(exports, "normalizeStackTrace", { enumerable: true, get: function () { return error_fingerprint_1.normalizeStackTrace; } });
var id_generator_1 = require("./utils/id-generator");
Object.defineProperty(exports, "generateSpanId", { enumerable: true, get: function () { return id_generator_1.generateSpanId; } });
Object.defineProperty(exports, "generateTraceId", { enumerable: true, get: function () { return id_generator_1.generateTraceId; } });
var level_utils_1 = require("./utils/level-utils");
Object.defineProperty(exports, "levelToPowertoolsLogLevel", { enumerable: true, get: function () { return level_utils_1.levelToPowertoolsLogLevel; } });
Object.defineProperty(exports, "levelToString", { enumerable: true, get: function () { return level_utils_1.levelToString; } });
Object.defineProperty(exports, "stringToLevel", { enumerable: true, get: function () { return level_utils_1.stringToLevel; } });
var observed_call_1 = require("./utils/observed-call");
Object.defineProperty(exports, "observedCall", { enumerable: true, get: function () { return observed_call_1.observedCall; } });
Object.defineProperty(exports, "observedCallSync", { enumerable: true, get: function () { return observed_call_1.observedCallSync; } });
var payload_1 = require("./utils/payload");
Object.defineProperty(exports, "estimateItemSize", { enumerable: true, get: function () { return payload_1.estimateItemSize; } });
Object.defineProperty(exports, "isPayloadWithinLimits", { enumerable: true, get: function () { return payload_1.isPayloadWithinLimits; } });
Object.defineProperty(exports, "safeStringify", { enumerable: true, get: function () { return payload_1.safeStringify; } });
Object.defineProperty(exports, "safeSerialize", { enumerable: true, get: function () { return payload_1.safeSerialize; } });
Object.defineProperty(exports, "truncatePayload", { enumerable: true, get: function () { return payload_1.truncatePayload; } });
Object.defineProperty(exports, "truncateItem", { enumerable: true, get: function () { return payload_1.truncateItem; } });
var source_utils_1 = require("./utils/source-utils");
Object.defineProperty(exports, "clearEnvironmentTagsCache", { enumerable: true, get: function () { return source_utils_1.clearEnvironmentTagsCache; } });
Object.defineProperty(exports, "createControllerSource", { enumerable: true, get: function () { return source_utils_1.createControllerSource; } });
Object.defineProperty(exports, "createQueueSource", { enumerable: true, get: function () { return source_utils_1.createQueueSource; } });
Object.defineProperty(exports, "createServiceSource", { enumerable: true, get: function () { return source_utils_1.createServiceSource; } });
Object.defineProperty(exports, "createTaskSource", { enumerable: true, get: function () { return source_utils_1.createTaskSource; } });
Object.defineProperty(exports, "detectSource", { enumerable: true, get: function () { return source_utils_1.detectSource; } });
Object.defineProperty(exports, "getEnvironmentTags", { enumerable: true, get: function () { return source_utils_1.getEnvironmentTags; } });
Object.defineProperty(exports, "mergeSourceTags", { enumerable: true, get: function () { return source_utils_1.mergeTags; } });
// === TRACE GRAPH (explicit parent/causedBy graph) ===
var trace_graph_1 = require("./trace-graph");
Object.defineProperty(exports, "buildTraceGraph", { enumerable: true, get: function () { return trace_graph_1.buildTraceGraph; } });
// === BATCH PROGRESS ===
var batch_progress_1 = require("./utils/batch-progress");
Object.defineProperty(exports, "BatchProgress", { enumerable: true, get: function () { return batch_progress_1.BatchProgress; } });
// === DECORATORS ===
var decorators_1 = require("./decorators");
Object.defineProperty(exports, "Observed", { enumerable: true, get: function () { return decorators_1.Observed; } });
// === CRUD HOOKS ===
var crud_hooks_1 = require("./crud-hooks");
Object.defineProperty(exports, "CrudObservabilityHooks", { enumerable: true, get: function () { return crud_hooks_1.CrudObservabilityHooks; } });
// === CONTROLLER CONFIG ===
var controller_config_1 = require("./controller-config");
Object.defineProperty(exports, "mergeObservabilityConfigs", { enumerable: true, get: function () { return controller_config_1.mergeObservabilityConfigs; } });
// === STORAGE (Entity, Service) ===
// For admin UIs, extend BaseEntityController<ObservabilityLogSchema> directly
var storage_1 = require("./storage");
Object.defineProperty(exports, "ObservabilityLogEntitySchema", { enumerable: true, get: function () { return storage_1.ObservabilityLogEntitySchema; } });
Object.defineProperty(exports, "ObservabilityLogService", { enumerable: true, get: function () { return storage_1.ObservabilityLogService; } });
// === TESTING ===
var testing_1 = require("./testing");
Object.defineProperty(exports, "assertEventCaptured", { enumerable: true, get: function () { return testing_1.assertEventCaptured; } });
Object.defineProperty(exports, "assertEventCount", { enumerable: true, get: function () { return testing_1.assertEventCount; } });
Object.defineProperty(exports, "assertNoEventCaptured", { enumerable: true, get: function () { return testing_1.assertNoEventCaptured; } });
Object.defineProperty(exports, "cleanupTestObservability", { enumerable: true, get: function () { return testing_1.cleanupTestObservability; } });
Object.defineProperty(exports, "createTestActor", { enumerable: true, get: function () { return testing_1.createTestActor; } });
Object.defineProperty(exports, "createTestContext", { enumerable: true, get: function () { return testing_1.createTestContext; } });
Object.defineProperty(exports, "createTestContextSync", { enumerable: true, get: function () { return testing_1.createTestContextSync; } });
Object.defineProperty(exports, "createTestExecutionContext", { enumerable: true, get: function () { return testing_1.createTestExecutionContext; } });
Object.defineProperty(exports, "MockBackend", { enumerable: true, get: function () { return testing_1.MockBackend; } });
Object.defineProperty(exports, "setupTestObservability", { enumerable: true, get: function () { return testing_1.setupTestObservability; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7R0FnQkc7Ozs7O0FBRUgsOEJBQW9DO0FBQ3BDLHFDQUFxRDtBQUVyRCw4RUFBOEU7QUFDOUUsZ0ZBQWdGO0FBQ2hGLDhFQUE4RTtBQUU5RSxnQkFBVyxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQztJQUN0QyxPQUFPLEVBQUUsZUFBZTtJQUN4QixTQUFTLEVBQUUsSUFBQSxrQ0FBeUIsR0FBRTtJQUN0QyxRQUFRLEVBQUUsQ0FBQztDQUNaLENBQUMsQ0FBQztBQUVILDhFQUE4RTtBQUM5RSxVQUFVO0FBQ1YsOEVBQThFO0FBRTlFLHFCQUFxQjtBQUNyQixpQ0FzQ2lCO0FBakNmLDJHQUFBLGtCQUFrQixPQUFBO0FBOEJsQiw4R0FBQSxxQkFBcUIsT0FBQTtBQUt2QiwwQkFBMEI7QUFDMUIsdURBQThHO0FBQXJHLGtIQUFBLHNCQUFzQixPQUFBO0FBQUUsOEdBQUEsa0JBQWtCLE9BQUE7QUFBRSxnSEFBQSxvQkFBb0IsT0FBQTtBQUV6RSxxREFBNkY7QUFBcEYsc0hBQUEsbUJBQW1CLE9BQUE7QUFBRSxvSEFBQSxpQkFBaUIsT0FBQTtBQUFFLG1IQUFBLGdCQUFnQixPQUFBO0FBR2pFLDJCQUEyQjtBQUMzQix1REFBaUU7QUFBeEQsK0hBQUEsMkJBQTJCLE9BQUE7QUFHcEMsdUJBQXVCO0FBQ3ZCLHFDQUltQjtBQUhqQixtR0FBQSxRQUFRLE9BQUE7QUFDUiwrR0FBQSxvQkFBb0IsT0FBQTtBQUNwQiw0R0FBQSxpQkFBaUIsT0FBQTtBQUduQix3QkFBd0I7QUFDeEIsbUNBUWtCO0FBUGhCLHlHQUFBLGVBQWUsT0FBQTtBQUNmLG1IQUFBLHlCQUF5QixPQUFBO0FBQ3pCLHNHQUFBLFlBQVksT0FBQTtBQUVaLHdHQUFBLGNBQWMsT0FBQTtBQUNkLHdH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bUJBQW1CLE9BQUE7QUFBRSwyR0FBQSxnQkFBZ0IsT0FBQTtBQUFFLGdIQUFBLHFCQUFxQixPQUFBO0FBQUUsbUhBQUEsd0JBQXdCLE9BQUE7QUFBRSwwR0FBQSxlQUFlLE9BQUE7QUFBRSw0R0FBQSxpQkFBaUIsT0FBQTtBQUFFLGdIQUFBLHFCQUFxQixPQUFBO0FBQUUscUhBQUEsMEJBQTBCLE9BQUE7QUFBRSxzR0FBQSxXQUFXLE9BQUE7QUFBRSxpSEFBQSxzQkFBc0IsT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRlcyNCBPYnNlcnZhYmlsaXR5IFN5c3RlbVxuICogXG4gKiBVbmlmaWVkIG9ic2VydmFiaWxpdHkgZm9yIGxvZ2dpbmcsIG1ldHJpY3MsIHRyYWNlcywgYW5kIGF1ZGl0cy5cbiAqIFxuICogIyMgUXVpY2sgU3RhcnRcbiAqIFxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQ29udGV4dCBpcyBhdXRvLWVzdGFibGlzaGVkIGluIGNvbnRyb2xsZXJzXG4gKiAvLyBBY2Nlc3MgdmlhIGN0eC5leGVjdXRpb25Db250ZXh0IG9yIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KClcbiAqIFxuICogYXdhaXQgU3Bhbk9ic2VydmVyLndpdGhTcGFuKCdwcm9jZXNzT3JkZXInLCBhc3luYyAoc3BhbikgPT4ge1xuICogICBBdWRpdE9ic2VydmVyLmVudGl0eUNyZWF0ZSgnT3JkZXInLCBvcmRlcklkLCBkYXRhKTtcbiAqICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KCdvcmRlcnMuY3JlYXRlZCcpO1xuICogfSk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpJztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuL2NvbmZpZyc7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUkVHSVNURVIgREVGQVVMVCBDT05GSUcgKHByaW9yaXR5IDAgLSBhcHBzIGNhbiBvdmVycmlkZSB3aXRoIGhpZ2hlciBwcmlvcml0eSlcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5ESUNvbnRhaW5lci5ST09ULnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICBwcm92aWRlOiAnb2JzZXJ2YWJpbGl0eScsXG4gIHVzZUNvbmZpZzogY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZygpLFxuICBwcmlvcml0eTogMFxufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gRVhQT1JUU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8vID09PSBDT1JFIFRZUEVTID09PVxuZXhwb3J0IHtcbiAgLy8gRXZlbnQgdHlwZXNcbiAgdHlwZSBCYXNlRXZlbnRUeXBlLFxuICB0eXBlIE9ic2VydmFiaWxpdHlFdmVudFR5cGUsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLFxuICBPYnNlcnZhYmlsaXR5TGV2ZWwsXG5cbiAgLy8gUmVjb3JkIHR5cGVzXG4gIHR5cGUgQ2FwdHVyZUlucHV0LFxuICB0eXBlIE9ic2VydmFiaWxpdHlFdmVudCxcbiAgdHlwZSBPYnNlcnZhYmlsaXR5RXJyb3IsXG5cbiAgLy8gQ2FwdHVyZSBjb250cm9sXG4gIHR5cGUgQ2FwdHVyZUNvbnRyb2wsXG4gIHR5cGUgR3JvdXBTYW1wbGluZ0NvbmZpZyxcbiAgdHlwZSBSZWNvcmRPdmVycmlkZXMsXG4gIHR5cGUgQ29udGV4dE92ZXJyaWRlcyxcblxuICAvLyBEZWNvcmF0b3IgdHlwZXNcbiAgdHlwZSBEZWNvcmF0b3JCYXNlT3B0aW9ucyxcbiAgdHlwZSBEZWNvcmF0b3JDYXB0dXJlQ29udHJvbCxcbiAgdHlwZSBDYXB0dXJlU2VyaWFsaXplT3B0aW9ucyxcbiAgdHlwZSBTb3VyY2VUeXBlLFxuXG4gIC8vIENvbmZpZyB0eXBlc1xuICB0eXBlIE9ic2VydmFiaWxpdHlDb25maWcsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWcsXG4gIHR5cGUgRGF0YVByb3RlY3Rpb25Db25maWcsXG4gIHR5cGUgVHJ1bmNhdGlvbkNvbmZpZyxcbiAgdHlwZSBEeW5hbW9EQkNvbmZpZyxcbiAgdHlwZSBTYW1wbGluZ0NvbmZpZyxcbiAgdHlwZSBUeXBlU3BlY2lmaWNDb25maWcsXG4gIHR5cGUgSUV2ZW50Q2FwdHVyZSxcbiAgdHlwZSBOb2lzZVJlZHVjdGlvblByZXNldExldmVsLFxuICBEZWZhdWx0U2FtcGxpbmdDb25maWcsXG5cbiAgLy8gRGVwcmVjYXRlZCBhbGlhc2VzXG59IGZyb20gJy4vdHlwZXMnO1xuXG4vLyA9PT0gTk9JU0UgUkVEVUNUSU9OID09PVxuZXhwb3J0IHsgREVDSVNJT05fQkFTRV9QUklPUklUWSwgZXZhbHVhdGVOb2lzZVJ1bGVzLCBnZXRFZmZlY3RpdmVQcmlvcml0eSB9IGZyb20gJy4vbm9pc2UtcmVkdWN0aW9uL3ByaW9yaXR5JztcbmV4cG9ydCB0eXBlIHsgTm9pc2VFdmFsdWF0aW9uUmVzdWx0IH0gZnJvbSAnLi9ub2lzZS1yZWR1Y3Rpb24vcHJpb3JpdHknO1xuZXhwb3J0IHsgYXBwbHlOb2lzZVJlZHVjdGlvbiwgcGlja05vaXNlRGVjaXNpb24sIGJ1aWxkQW5kRXZhbHVhdGUgfSBmcm9tICcuL25vaXNlLXJlZHVjdGlvbic7XG5leHBvcnQgdHlwZSB7IEFic29yYmVkRGF0YSwgRW1pdHRlZEV2ZW50LCBOb2lzZVJlZHVjdGlvblJlc3VsdCwgTm9pc2VSZWR1Y3Rpb25TdGF0cywgQWJzb3JwdGlvbkJvdW5kcyB9IGZyb20gJy4vbm9pc2UtcmVkdWN0aW9uL3R5cGVzJztcblxuLy8gPT09IFNQQU4gQ09NUFJFU1NJT04gPT09XG5leHBvcnQgeyBncm91cENoZWNrcG9pbnRzQnlPcGVyYXRpb24gfSBmcm9tICcuL3NwYW4tY29tcHJlc3Npb24nO1xuZXhwb3J0IHR5cGUgeyBHcm91cGVkQ2hlY2twb2ludCwgQ29tcGFjdENoZWNrcG9pbnRJdGVtLCBBZ2dyZWdhdGVTdGF0cyB9IGZyb20gJy4vc3Bhbi1jb21wcmVzc2lvbic7XG5cbi8vID09PSBDT1JFIE1BTkFHRVIgPT09XG5leHBvcnQge1xuICBPYnNlcnZlcixcbiAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIsXG4gIHdpdGhPYnNlcnZhYmlsaXR5LFxufSBmcm9tICcuL21hbmFnZXInO1xuXG4vLyA9PT0gQ09ORklHVVJBVElPTiA9PT1cbmV4cG9ydCB7XG4gIENPTkZJR19ERUZBVUxUUyxcbiAgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgZXh0ZW5kUHJlc2V0LFxuICBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQsXG4gIFZBTElEX0JBQ0tFTkRTLFxuICB2YWxpZGF0ZUNvbmZpZyxcbiAgVmFsaWRCYWNrZW5kXG59IGZyb20gJy4vY29uZmlnJztcblxuLy8gPT09IFBSRVNFVFMgPT09XG5leHBvcnQge1xuICBkZWJ1Z1ByZXNldCxcbiAgZGV2ZWxvcG1lbnRQcmVzZXQsXG4gIGdldFByZXNldCxcbiAgbWluaW1hbFByZXNldCxcbiAgcHJvZHVjdGlvblByZXNldCxcbiAgdHlwZSBPYnNlcnZhYmlsaXR5UHJlc2V0XG59IGZyb20gJy4vcHJlc2V0cyc7XG5cbi8vID09PSBDT05URVhUID09PVxuZXhwb3J0IHtcbiAgLy8gVHlwZXNcbiAgdHlwZSBBY3RvcixcbiAgdHlwZSBDcmVhdGVFeGVjdXRpb25Db250ZXh0T3B0aW9ucyxcbiAgdHlwZSBFeGVjdXRpb25Db250ZXh0RGF0YSxcbiAgdHlwZSBQYXJzZWRUcmFjZUNvbnRleHQsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eVN0YXRlLFxuICB0eXBlIE9ic2VydmFiaWxpdHlTdW1tYXJ5LFxuICB0eXBlIElTcGFuTm9kZSxcblxuICAvLyBTdG9yYWdlICYgTGlmZWN5Y2xlXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0LFxuICBnZXRPYnNlcnZhYmlsaXR5U3RhdGUsXG4gIGdldEN1cnJlbnRTcGFuLFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCxcbiAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHRTeW5jLFxuXG4gIC8vIENvbnRleHQgT3ZlcnJpZGVcbiAgd2l0aENvbnRleHQsXG5cbiAgLy8gUGFyZW50IFJlc29sdXRpb25cbiAgZ2V0Q2FwdHVyZWRQYXJlbnRJZCxcbiAgZ2V0Q3VycmVudFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcblxuICAvLyBFbnJpY2htZW50XG4gIGFkZFRhZ3MsXG4gIGVucmljaEFjdG9yLFxuICBzZXRBY3RvcixcbiAgc2V0QXR0cmlidXRlLFxuICBzZXRBdHRyaWJ1dGVzLFxuICBzZXRTb3VyY2UsXG5cbiAgLy8gUHJvcGFnYXRpb24gLSBFeHRyYWN0aW9uXG4gIGV4dHJhY3RGcm9tRXZlbnRCcmlkZ2UsXG4gIGV4dHJhY3RGcm9tSGVhZGVycyxcbiAgZXh0cmFjdEZyb21LaW5lc2lzLFxuICBleHRyYWN0RnJvbVNucyxcbiAgZXh0cmFjdEZyb21TcXMsXG4gIGV4dHJhY3RGcm9tU3FzUmVjb3JkLFxuICBleHRyYWN0RnJvbVN0ZXBGdW5jdGlvbnMsXG5cbiAgLy8gUHJvcGFnYXRpb24gLSBDcmVhdGlvblxuICBjcmVhdGVFdmVudEJyaWRnZUNvbnRleHQsXG4gIGNyZWF0ZUh0dHBIZWFkZXJzLFxuICBjcmVhdGVTbnNBdHRyaWJ1dGVzLFxuICBjcmVhdGVTcXNBdHRyaWJ1dGVzLFxuICBjcmVhdGVTdGVwRnVuY3Rpb25zQ29udGV4dCxcbiAgdG9XM0NQYXJlbnRJZCxcbiAgdG9XM0NUcmFjZUlkLFxufSBmcm9tICcuL2NvbnRleHQnO1xuXG4vLyA9PT0gQ09SRSBPQlNFUlZFUlMgPT09XG5leHBvcnQge1xuICAvLyBTcGFuXG4gIFNwYW5PYnNlcnZlcixcbiAgdHlwZSBTcGFuT3B0aW9ucyxcbiAgdHlwZSBTcGFuRW5kT3B0aW9ucyxcbiAgdHlwZSBJU3Bhbk9ic2VydmVyLFxuICB3aXRoU3BhbixcbiAgd2l0aFNwYW5TeW5jLFxuICB3cmFwSW5TcGFuLFxuXG4gIC8vIEF1ZGl0XG4gIEF1ZGl0T2JzZXJ2ZXIsXG4gIHR5cGUgRW50aXR5QXVkaXRPcHRpb25zLFxuICB0eXBlIEF1ZGl0UmVjb3JkT3B0aW9ucyxcbiAgdHlwZSBDb21wbGlhbmNlQXVkaXRPcHRpb25zLFxuICB0eXBlIEFjY2Vzc0F1ZGl0T3B0aW9ucyxcblxuICAvLyBMb2dcbiAgTG9nT2JzZXJ2ZXIsXG4gIHR5cGUgTG9nT3B0aW9ucyxcblxuICAvLyBNZXRyaWNcbiAgTWV0cmljT2JzZXJ2ZXIsXG4gIHR5cGUgTWV0cmljT3B0aW9ucyxcblxuICAvLyBRdWVyeSAoRGF0YWJhc2UgcGVyZm9ybWFuY2UgdHJhY2tpbmcpXG4gIFF1ZXJ5T2JzZXJ2ZXIsXG4gIHR5cGUgUXVlcnlDb250ZXh0LFxuICB0eXBlIENvbnN1bWVkQ2FwYWNpdHlSZXN1bHQsXG5cbiAgLy8gQmFzZSB1dGlsaXRpZXNcbiAgZ2VuZXJhdGVJZCxcbiAgY2FwdHVyZVJlY29yZCxcbiAgY2FwdHVyZVJlY29yZEFzeW5jLFxuICBidWlsZENhcHR1cmVJbnB1dCxcbiAgcmVzb2x2ZUNvcnJlbGF0aW9uSWQsXG4gIG1lcmdlVGFncyxcbiAgbWFwRXJyb3IsXG4gIG5vcm1hbGl6ZUVycm9yLFxuXG4gIC8vIFRlc3RpbmcgdXRpbGl0aWVzXG4gIHNldENhcHR1cmVyLFxuICByZXNldENhcHR1cmVyLFxuICBpbml0aWFsaXplQ2FwdHVyZXIsXG59IGZyb20gJy4vb2JzZXJ2ZXJzJztcblxuLy8gPT09IEJBQ0tFTkRTIChESS1tYW5hZ2VkLCBleHBvcnRlZCBmb3IgdHlwZSByZWZlcmVuY2VzKSA9PT1cbmV4cG9ydCB7IENsb3VkV2F0Y2hCYWNrZW5kIH0gZnJvbSAnLi9iYWNrZW5kcy9jbG91ZHdhdGNoJztcbmV4cG9ydCB7IER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQgfSBmcm9tICcuL2JhY2tlbmRzL2R5bmFtb2RiJztcbmV4cG9ydCB7IE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZCB9IGZyb20gJy4vYmFja2VuZHMvb3RlbCc7XG5cbi8vID09PSBVVElMSVRJRVMgPT09XG5leHBvcnQgeyBjbGVhclJlZGFjdG9yQ2FjaGUsIERFRkFVTFRfQkxBQ0tMSVNURURfS0VZUywgREVGQVVMVF9QUk9URUNURURfRklFTERTLCBleHRlbmRCbGFja2xpc3QsIHJlZGFjdFNlbnNpdGl2ZURhdGEsIHNob3VsZFJlZGFjdEtleSB9IGZyb20gJy4vdXRpbHMvZGF0YS1wcm90ZWN0aW9uJztcbmV4cG9ydCB7IGNvbXB1dGVFcnJvckZpbmdlcnByaW50LCBub3JtYWxpemVFcnJvck1lc3NhZ2UsIG5vcm1hbGl6ZVN0YWNrVHJhY2UgfSBmcm9tICcuL3V0aWxzL2Vycm9yLWZpbmdlcnByaW50JztcbmV4cG9ydCB7IGdlbmVyYXRlU3BhbklkLCBnZW5lcmF0ZVRyYWNlSWQgfSBmcm9tICcuL3V0aWxzL2lkLWdlbmVyYXRvcic7XG5leHBvcnQgeyBsZXZlbFRvUG93ZXJ0b29sc0xvZ0xldmVsLCBsZXZlbFRvU3RyaW5nLCBzdHJpbmdUb0xldmVsIH0gZnJvbSAnLi91dGlscy9sZXZlbC11dGlscyc7XG5leHBvcnQgeyBvYnNlcnZlZENhbGwsIG9ic2VydmVkQ2FsbFN5bmMsIHR5cGUgT2JzZXJ2ZWRDYWxsT3B0aW9ucyB9IGZyb20gJy4vdXRpbHMvb2JzZXJ2ZWQtY2FsbCc7XG5leHBvcnQgeyBlc3RpbWF0ZUl0ZW1TaXplLCBpc1BheWxvYWRXaXRoaW5MaW1pdHMsIHNhZmVTdHJpbmdpZnksIHNhZmVTZXJpYWxpemUsIHRydW5jYXRlUGF5bG9hZCwgdHJ1bmNhdGVJdGVtLCB0eXBlIFRydW5jYXRpb25NZXRhZGF0YSwgdHlwZSBTZXJpYWxpemVPcHRpb25zIH0gZnJvbSAnLi91dGlscy9wYXlsb2FkJztcbmV4cG9ydCB7IGNsZWFyRW52aXJvbm1lbnRUYWdzQ2FjaGUsIGNyZWF0ZUNvbnRyb2xsZXJTb3VyY2UsIGNyZWF0ZVF1ZXVlU291cmNlLCBjcmVhdGVTZXJ2aWNlU291cmNlLCBjcmVhdGVUYXNrU291cmNlLCBkZXRlY3RTb3VyY2UsIGdldEVudmlyb25tZW50VGFncywgbWVyZ2VUYWdzIGFzIG1lcmdlU291cmNlVGFncyB9IGZyb20gJy4vdXRpbHMvc291cmNlLXV0aWxzJztcblxuLy8gPT09IFRSQUNFIEdSQVBIIChleHBsaWNpdCBwYXJlbnQvY2F1c2VkQnkgZ3JhcGgpID09PVxuZXhwb3J0IHsgYnVpbGRUcmFjZUdyYXBoLCB0eXBlIFRyYWNlR3JhcGgsIHR5cGUgVHJhY2VOb2RlLCB0eXBlIFRyYWNlRWRnZSB9IGZyb20gJy4vdHJhY2UtZ3JhcGgnO1xuXG4vLyA9PT0gQkFUQ0ggUFJPR1JFU1MgPT09XG5leHBvcnQge1xuICBCYXRjaFByb2dyZXNzLFxuICB0eXBlIEJhdGNoUmVzdWx0LFxuICB0eXBlIEJhdGNoU3VtbWFyeSxcbiAgdHlwZSBQcm9jZXNzT3B0aW9ucyxcbiAgdHlwZSBDaHVua09wdGlvbnMsXG4gIHR5cGUgUHJvY2Vzc0NvbnRleHQsXG4gIHR5cGUgRmFpbGVkSXRlbSxcbiAgdHlwZSBNZXRyaWNTdGF0cyxcbiAgdHlwZSBPYnNlcnZlTW9kZSxcbn0gZnJvbSAnLi91dGlscy9iYXRjaC1wcm9ncmVzcyc7XG5cbi8vID09PSBERUNPUkFUT1JTID09PVxuZXhwb3J0IHsgT2JzZXJ2ZWQsIE9ic2VydmVkT3B0aW9ucyB9IGZyb20gJy4vZGVjb3JhdG9ycyc7XG5cbi8vID09PSBDUlVEIEhPT0tTID09PVxuZXhwb3J0IHsgQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LCBDcnVkT2JzZXJ2YWJpbGl0eUhvb2tzIH0gZnJvbSAnLi9jcnVkLWhvb2tzJztcblxuLy8gPT09IENPTlRST0xMRVIgQ09ORklHID09PVxuZXhwb3J0IHsgbWVyZ2VPYnNlcnZhYmlsaXR5Q29uZmlncyB9IGZyb20gJy4vY29udHJvbGxlci1jb25maWcnO1xuZXhwb3J0IHR5cGUgeyBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZywgT2JzZXJ2YWJpbGl0eUluY2x1ZGVzQ29uZmlnLCBTcGFuTWV0YWRhdGEgfSBmcm9tICcuL2NvbnRyb2xsZXItY29uZmlnJztcblxuLy8gPT09IFNUT1JBR0UgKEVudGl0eSwgU2VydmljZSkgPT09XG4vLyBGb3IgYWRtaW4gVUlzLCBleHRlbmQgQmFzZUVudGl0eUNvbnRyb2xsZXI8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT4gZGlyZWN0bHlcbmV4cG9ydCB7XG4gIE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEsXG4gIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlXG59IGZyb20gJy4vc3RvcmFnZSc7XG5leHBvcnQgdHlwZSB7IExvZ1JlY29yZCwgT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0sIE9ic2VydmFiaWxpdHlMb2dTY2hlbWEsIE9ic2VydmFiaWxpdHlMb2dFbnRpdHlUeXBlLCBPYnNlcnZhYmlsaXR5TG9nUmVjb3JkVHlwZSwgUmVjb25zdHJ1Y3RlZFNwYW4gfSBmcm9tICcuL3N0b3JhZ2UnO1xuXG4vLyA9PT0gVEVTVElORyA9PT1cbmV4cG9ydCB7IGFzc2VydEV2ZW50Q2FwdHVyZWQsIGFzc2VydEV2ZW50Q291bnQsIGFzc2VydE5vRXZlbnRDYXB0dXJlZCwgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5LCBjcmVhdGVUZXN0QWN0b3IsIGNyZWF0ZVRlc3RDb250ZXh0LCBjcmVhdGVUZXN0Q29udGV4dFN5bmMsIGNyZWF0ZVRlc3RFeGVjdXRpb25Db250ZXh0LCBNb2NrQmFja2VuZCwgc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSB9IGZyb20gJy4vdGVzdGluZyc7XG4iXX0=