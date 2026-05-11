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
exports.createServiceSource = exports.createQueueSource = exports.createControllerSource = exports.clearEnvironmentTagsCache = exports.truncateItem = exports.truncatePayload = exports.safeSerialize = exports.safeStringify = exports.isPayloadWithinLimits = exports.estimateItemSize = exports.observedCallSync = exports.observedCall = exports.stringToLevel = exports.levelToString = exports.levelToPowertoolsLogLevel = exports.generateTraceId = exports.generateSpanId = exports.normalizeStackTrace = exports.normalizeErrorMessage = exports.computeErrorFingerprint = exports.shouldRedactKey = exports.redactSensitiveData = exports.extendBlacklist = exports.DEFAULT_PROTECTED_FIELDS = exports.DEFAULT_BLACKLISTED_KEYS = exports.clearRedactorCache = exports.LogtrailObservabilityBackend = exports.OTELObservabilityBackend = exports.DynamoDBObservabilityBackend = exports.CloudWatchBackend = exports.initializeCapturer = exports.resetCapturer = exports.setCapturer = exports.normalizeError = exports.mapError = exports.mergeTags = exports.resolveCorrelationId = exports.buildCaptureInput = exports.captureRecordAsync = exports.captureRecord = exports.generateId = exports.QueryObserver = exports.MetricObserver = exports.LogObserver = exports.AuditObserver = exports.wrapInSpan = exports.withSpanSync = exports.withSpan = exports.SpanObserver = exports.toW3CTraceId = void 0;
exports.setupTestObservability = exports.MockBackend = exports.createTestExecutionContext = exports.createTestContextSync = exports.createTestContext = exports.createTestActor = exports.cleanupTestObservability = exports.assertNoEventCaptured = exports.assertEventCount = exports.assertEventCaptured = exports.ObservabilityLogService = exports.ObservabilityLogEntitySchema = exports.mergeObservabilityConfigs = exports.CrudObservabilityHooks = exports.Observed = exports.BatchProgress = exports.buildTraceGraph = exports.mergeSourceTags = exports.getEnvironmentTags = exports.detectSource = exports.createTaskSource = void 0;
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
var logtrail_1 = require("./backends/logtrail");
Object.defineProperty(exports, "LogtrailObservabilityBackend", { enumerable: true, get: function () { return logtrail_1.LogtrailObservabilityBackend; } });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7R0FnQkc7Ozs7O0FBRUgsOEJBQW9DO0FBQ3BDLHFDQUFxRDtBQUVyRCw4RUFBOEU7QUFDOUUsZ0ZBQWdGO0FBQ2hGLDhFQUE4RTtBQUU5RSxnQkFBVyxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQztJQUN0QyxPQUFPLEVBQUUsZUFBZTtJQUN4QixTQUFTLEVBQUUsSUFBQSxrQ0FBeUIsR0FBRTtJQUN0QyxRQUFRLEVBQUUsQ0FBQztDQUNaLENBQUMsQ0FBQztBQUVILDhFQUE4RTtBQUM5RSxVQUFVO0FBQ1YsOEVBQThFO0FBRTlFLHFCQUFxQjtBQUNyQixpQ0F1Q2lCO0FBbENmLDJHQUFBLGtCQUFrQixPQUFBO0FBK0JsQiw4R0FBQSxxQkFBcUIsT0FBQTtBQUt2QiwwQkFBMEI7QUFDMUIsdURBQThHO0FBQXJHLGtIQUFBLHNCQUFzQixPQUFBO0FBQUUsOEdBQUEsa0JBQWtCLE9BQUE7QUFBRSxnSEFBQSxvQkFBb0IsT0FBQTtBQUV6RSxxREFBNkY7QUFBcEYsc0hBQUEsbUJBQW1CLE9BQUE7QUFBRSxvSEFBQSxpQkFBaUIsT0FBQTtBQUFFLG1IQUFBLGdCQUFnQixPQUFBO0FBR2pFLDJCQUEyQjtBQUMzQix1REFBaUU7QUFBeEQsK0hBQUEsMkJBQTJCLE9BQUE7QUFHcEMsdUJBQXVCO0FBQ3ZCLHFDQUltQjtBQUhqQixtR0FBQSxRQUFRLE9BQUE7QUFDUiwrR0FBQSxvQkFBb0IsT0FBQTtBQUNwQiw0R0FBQSxpQkFBaUIsT0FBQTtBQUduQix3QkFBd0I7QUFDeEIsbUNBUWtCO0FBUGhCLHlHQUFBLGVBQWUsT0FBQTtBQUNmLG1IQUFBLHlCQUF5QixPQUFBO0FBQ3pCLHNHQUFBLFlBQVksT0FBQTtBQUVaLHdHQUFBLGNBQWMsT0FBQTtBQUNkLHdH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QUl6QixrQkFBa0I7QUFDbEIscUNBQStPO0FBQXRPLDhHQUFBLG1CQUFtQixPQUFBO0FBQUUsMkdBQUEsZ0JBQWdCLE9BQUE7QUFBRSxnSEFBQSxxQkFBcUIsT0FBQTtBQUFFLG1IQUFBLHdCQUF3QixPQUFBO0FBQUUsMEdBQUEsZUFBZSxPQUFBO0FBQUUsNEdBQUEsaUJBQWlCLE9BQUE7QUFBRSxnSEFBQSxxQkFBcUIsT0FBQTtBQUFFLHFIQUFBLDBCQUEwQixPQUFBO0FBQUUsc0dBQUEsV0FBVyxPQUFBO0FBQUUsaUhBQUEsc0JBQXNCLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEZXMjQgT2JzZXJ2YWJpbGl0eSBTeXN0ZW1cbiAqIFxuICogVW5pZmllZCBvYnNlcnZhYmlsaXR5IGZvciBsb2dnaW5nLCBtZXRyaWNzLCB0cmFjZXMsIGFuZCBhdWRpdHMuXG4gKiBcbiAqICMjIFF1aWNrIFN0YXJ0XG4gKiBcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIENvbnRleHQgaXMgYXV0by1lc3RhYmxpc2hlZCBpbiBjb250cm9sbGVyc1xuICogLy8gQWNjZXNzIHZpYSBjdHguZXhlY3V0aW9uQ29udGV4dCBvciBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpXG4gKiBcbiAqIGF3YWl0IFNwYW5PYnNlcnZlci53aXRoU3BhbigncHJvY2Vzc09yZGVyJywgYXN5bmMgKHNwYW4pID0+IHtcbiAqICAgQXVkaXRPYnNlcnZlci5lbnRpdHlDcmVhdGUoJ09yZGVyJywgb3JkZXJJZCwgZGF0YSk7XG4gKiAgIE1ldHJpY09ic2VydmVyLmluY3JlbWVudCgnb3JkZXJzLmNyZWF0ZWQnKTtcbiAqIH0pO1xuICogYGBgXG4gKi9cblxuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi9kaSc7XG5pbXBvcnQgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIH0gZnJvbSAnLi9jb25maWcnO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFJFR0lTVEVSIERFRkFVTFQgQ09ORklHIChwcmlvcml0eSAwIC0gYXBwcyBjYW4gb3ZlcnJpZGUgd2l0aCBoaWdoZXIgcHJpb3JpdHkpXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuRElDb250YWluZXIuUk9PVC5yZWdpc3RlckNvbmZpZ1Byb3ZpZGVyKHtcbiAgcHJvdmlkZTogJ29ic2VydmFiaWxpdHknLFxuICB1c2VDb25maWc6IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoKSxcbiAgcHJpb3JpdHk6IDBcbn0pO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIEVYUE9SVFNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vLyA9PT0gQ09SRSBUWVBFUyA9PT1cbmV4cG9ydCB7XG4gIC8vIEV2ZW50IHR5cGVzXG4gIHR5cGUgQmFzZUV2ZW50VHlwZSxcbiAgdHlwZSBPYnNlcnZhYmlsaXR5RXZlbnRUeXBlLFxuICB0eXBlIE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyxcbiAgT2JzZXJ2YWJpbGl0eUxldmVsLFxuXG4gIC8vIFJlY29yZCB0eXBlc1xuICB0eXBlIENhcHR1cmVJbnB1dCxcbiAgdHlwZSBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eUVycm9yLFxuXG4gIC8vIENhcHR1cmUgY29udHJvbFxuICB0eXBlIENhcHR1cmVDb250cm9sLFxuICB0eXBlIEdyb3VwU2FtcGxpbmdDb25maWcsXG4gIHR5cGUgUmVjb3JkT3ZlcnJpZGVzLFxuICB0eXBlIENvbnRleHRPdmVycmlkZXMsXG5cbiAgLy8gRGVjb3JhdG9yIHR5cGVzXG4gIHR5cGUgRGVjb3JhdG9yQmFzZU9wdGlvbnMsXG4gIHR5cGUgRGVjb3JhdG9yQ2FwdHVyZUNvbnRyb2wsXG4gIHR5cGUgQ2FwdHVyZVNlcmlhbGl6ZU9wdGlvbnMsXG4gIHR5cGUgU291cmNlVHlwZSxcblxuICAvLyBDb25maWcgdHlwZXNcbiAgdHlwZSBPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICB0eXBlIE9ic2VydmFiaWxpdHlCYWNrZW5kLFxuICB0eXBlIE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnLFxuICB0eXBlIE9ic2VydmFiaWxpdHlCYWNrZW5kTmFtZSxcbiAgdHlwZSBEYXRhUHJvdGVjdGlvbkNvbmZpZyxcbiAgdHlwZSBUcnVuY2F0aW9uQ29uZmlnLFxuICB0eXBlIER5bmFtb0RCQ29uZmlnLFxuICB0eXBlIFNhbXBsaW5nQ29uZmlnLFxuICB0eXBlIFR5cGVTcGVjaWZpY0NvbmZpZyxcbiAgdHlwZSBJRXZlbnRDYXB0dXJlLFxuICB0eXBlIE5vaXNlUmVkdWN0aW9uUHJlc2V0TGV2ZWwsXG4gIERlZmF1bHRTYW1wbGluZ0NvbmZpZyxcblxuICAvLyBEZXByZWNhdGVkIGFsaWFzZXNcbn0gZnJvbSAnLi90eXBlcyc7XG5cbi8vID09PSBOT0lTRSBSRURVQ1RJT04gPT09XG5leHBvcnQgeyBERUNJU0lPTl9CQVNFX1BSSU9SSVRZLCBldmFsdWF0ZU5vaXNlUnVsZXMsIGdldEVmZmVjdGl2ZVByaW9yaXR5IH0gZnJvbSAnLi9ub2lzZS1yZWR1Y3Rpb24vcHJpb3JpdHknO1xuZXhwb3J0IHR5cGUgeyBOb2lzZUV2YWx1YXRpb25SZXN1bHQgfSBmcm9tICcuL25vaXNlLXJlZHVjdGlvbi9wcmlvcml0eSc7XG5leHBvcnQgeyBhcHBseU5vaXNlUmVkdWN0aW9uLCBwaWNrTm9pc2VEZWNpc2lvbiwgYnVpbGRBbmRFdmFsdWF0ZSB9IGZyb20gJy4vbm9pc2UtcmVkdWN0aW9uJztcbmV4cG9ydCB0eXBlIHsgQWJzb3JiZWREYXRhLCBFbWl0dGVkRXZlbnQsIE5vaXNlUmVkdWN0aW9uUmVzdWx0LCBOb2lzZVJlZHVjdGlvblN0YXRzLCBBYnNvcnB0aW9uQm91bmRzIH0gZnJvbSAnLi9ub2lzZS1yZWR1Y3Rpb24vdHlwZXMnO1xuXG4vLyA9PT0gU1BBTiBDT01QUkVTU0lPTiA9PT1cbmV4cG9ydCB7IGdyb3VwQ2hlY2twb2ludHNCeU9wZXJhdGlvbiB9IGZyb20gJy4vc3Bhbi1jb21wcmVzc2lvbic7XG5leHBvcnQgdHlwZSB7IEdyb3VwZWRDaGVja3BvaW50LCBDb21wYWN0Q2hlY2twb2ludEl0ZW0sIEFnZ3JlZ2F0ZVN0YXRzIH0gZnJvbSAnLi9zcGFuLWNvbXByZXNzaW9uJztcblxuLy8gPT09IENPUkUgTUFOQUdFUiA9PT1cbmV4cG9ydCB7XG4gIE9ic2VydmVyLFxuICBPYnNlcnZhYmlsaXR5TWFuYWdlcixcbiAgd2l0aE9ic2VydmFiaWxpdHksXG59IGZyb20gJy4vbWFuYWdlcic7XG5cbi8vID09PSBDT05GSUdVUkFUSU9OID09PVxuZXhwb3J0IHtcbiAgQ09ORklHX0RFRkFVTFRTLFxuICBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICBleHRlbmRQcmVzZXQsXG4gIE9ic2VydmFiaWxpdHlDb25maWdJbnB1dCxcbiAgVkFMSURfQkFDS0VORFMsXG4gIHZhbGlkYXRlQ29uZmlnLFxuICBWYWxpZEJhY2tlbmRcbn0gZnJvbSAnLi9jb25maWcnO1xuXG4vLyA9PT0gUFJFU0VUUyA9PT1cbmV4cG9ydCB7XG4gIGRlYnVnUHJlc2V0LFxuICBkZXZlbG9wbWVudFByZXNldCxcbiAgZ2V0UHJlc2V0LFxuICBtaW5pbWFsUHJlc2V0LFxuICBwcm9kdWN0aW9uUHJlc2V0LFxuICB0eXBlIE9ic2VydmFiaWxpdHlQcmVzZXRcbn0gZnJvbSAnLi9wcmVzZXRzJztcblxuLy8gPT09IENPTlRFWFQgPT09XG5leHBvcnQge1xuICAvLyBUeXBlc1xuICB0eXBlIEFjdG9yLFxuICB0eXBlIENyZWF0ZUV4ZWN1dGlvbkNvbnRleHRPcHRpb25zLFxuICB0eXBlIEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICB0eXBlIFBhcnNlZFRyYWNlQ29udGV4dCxcbiAgdHlwZSBPYnNlcnZhYmlsaXR5U3RhdGUsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eVN1bW1hcnksXG4gIHR5cGUgSVNwYW5Ob2RlLFxuXG4gIC8vIFN0b3JhZ2UgJiBMaWZlY3ljbGVcbiAgY3JlYXRlRXhlY3V0aW9uQ29udGV4dCxcbiAgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQsXG4gIGdldE9ic2VydmFiaWxpdHlTdGF0ZSxcbiAgZ2V0Q3VycmVudFNwYW4sXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMsXG5cbiAgLy8gQ29udGV4dCBPdmVycmlkZVxuICB3aXRoQ29udGV4dCxcblxuICAvLyBQYXJlbnQgUmVzb2x1dGlvblxuICBnZXRDYXB0dXJlZFBhcmVudElkLFxuICBnZXRDdXJyZW50UGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuXG4gIC8vIEVucmljaG1lbnRcbiAgYWRkVGFncyxcbiAgZW5yaWNoQWN0b3IsXG4gIHNldEFjdG9yLFxuICBzZXRBdHRyaWJ1dGUsXG4gIHNldEF0dHJpYnV0ZXMsXG4gIHNldFNvdXJjZSxcblxuICAvLyBQcm9wYWdhdGlvbiAtIEV4dHJhY3Rpb25cbiAgZXh0cmFjdEZyb21FdmVudEJyaWRnZSxcbiAgZXh0cmFjdEZyb21IZWFkZXJzLFxuICBleHRyYWN0RnJvbUtpbmVzaXMsXG4gIGV4dHJhY3RGcm9tU25zLFxuICBleHRyYWN0RnJvbVNxcyxcbiAgZXh0cmFjdEZyb21TcXNSZWNvcmQsXG4gIGV4dHJhY3RGcm9tU3RlcEZ1bmN0aW9ucyxcblxuICAvLyBQcm9wYWdhdGlvbiAtIENyZWF0aW9uXG4gIGNyZWF0ZUV2ZW50QnJpZGdlQ29udGV4dCxcbiAgY3JlYXRlSHR0cEhlYWRlcnMsXG4gIGNyZWF0ZVNuc0F0dHJpYnV0ZXMsXG4gIGNyZWF0ZVNxc0F0dHJpYnV0ZXMsXG4gIGNyZWF0ZVN0ZXBGdW5jdGlvbnNDb250ZXh0LFxuICB0b1czQ1BhcmVudElkLFxuICB0b1czQ1RyYWNlSWQsXG59IGZyb20gJy4vY29udGV4dCc7XG5cbi8vID09PSBDT1JFIE9CU0VSVkVSUyA9PT1cbmV4cG9ydCB7XG4gIC8vIFNwYW5cbiAgU3Bhbk9ic2VydmVyLFxuICB0eXBlIFNwYW5PcHRpb25zLFxuICB0eXBlIFNwYW5FbmRPcHRpb25zLFxuICB0eXBlIElTcGFuT2JzZXJ2ZXIsXG4gIHdpdGhTcGFuLFxuICB3aXRoU3BhblN5bmMsXG4gIHdyYXBJblNwYW4sXG5cbiAgLy8gQXVkaXRcbiAgQXVkaXRPYnNlcnZlcixcbiAgdHlwZSBFbnRpdHlBdWRpdE9wdGlvbnMsXG4gIHR5cGUgQXVkaXRSZWNvcmRPcHRpb25zLFxuICB0eXBlIENvbXBsaWFuY2VBdWRpdE9wdGlvbnMsXG4gIHR5cGUgQWNjZXNzQXVkaXRPcHRpb25zLFxuXG4gIC8vIExvZ1xuICBMb2dPYnNlcnZlcixcbiAgdHlwZSBMb2dPcHRpb25zLFxuXG4gIC8vIE1ldHJpY1xuICBNZXRyaWNPYnNlcnZlcixcbiAgdHlwZSBNZXRyaWNPcHRpb25zLFxuXG4gIC8vIFF1ZXJ5IChEYXRhYmFzZSBwZXJmb3JtYW5jZSB0cmFja2luZylcbiAgUXVlcnlPYnNlcnZlcixcbiAgdHlwZSBRdWVyeUNvbnRleHQsXG4gIHR5cGUgQ29uc3VtZWRDYXBhY2l0eVJlc3VsdCxcblxuICAvLyBCYXNlIHV0aWxpdGllc1xuICBnZW5lcmF0ZUlkLFxuICBjYXB0dXJlUmVjb3JkLFxuICBjYXB0dXJlUmVjb3JkQXN5bmMsXG4gIGJ1aWxkQ2FwdHVyZUlucHV0LFxuICByZXNvbHZlQ29ycmVsYXRpb25JZCxcbiAgbWVyZ2VUYWdzLFxuICBtYXBFcnJvcixcbiAgbm9ybWFsaXplRXJyb3IsXG5cbiAgLy8gVGVzdGluZyB1dGlsaXRpZXNcbiAgc2V0Q2FwdHVyZXIsXG4gIHJlc2V0Q2FwdHVyZXIsXG4gIGluaXRpYWxpemVDYXB0dXJlcixcbn0gZnJvbSAnLi9vYnNlcnZlcnMnO1xuXG4vLyA9PT0gQkFDS0VORFMgKERJLW1hbmFnZWQsIGV4cG9ydGVkIGZvciB0eXBlIHJlZmVyZW5jZXMpID09PVxuZXhwb3J0IHsgQ2xvdWRXYXRjaEJhY2tlbmQgfSBmcm9tICcuL2JhY2tlbmRzL2Nsb3Vkd2F0Y2gnO1xuZXhwb3J0IHsgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCB9IGZyb20gJy4vYmFja2VuZHMvZHluYW1vZGInO1xuZXhwb3J0IHsgT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kIH0gZnJvbSAnLi9iYWNrZW5kcy9vdGVsJztcbmV4cG9ydCB7IExvZ3RyYWlsT2JzZXJ2YWJpbGl0eUJhY2tlbmQgfSBmcm9tICcuL2JhY2tlbmRzL2xvZ3RyYWlsJztcblxuLy8gPT09IFVUSUxJVElFUyA9PT1cbmV4cG9ydCB7IGNsZWFyUmVkYWN0b3JDYWNoZSwgREVGQVVMVF9CTEFDS0xJU1RFRF9LRVlTLCBERUZBVUxUX1BST1RFQ1RFRF9GSUVMRFMsIGV4dGVuZEJsYWNrbGlzdCwgcmVkYWN0U2Vuc2l0aXZlRGF0YSwgc2hvdWxkUmVkYWN0S2V5IH0gZnJvbSAnLi91dGlscy9kYXRhLXByb3RlY3Rpb24nO1xuZXhwb3J0IHsgY29tcHV0ZUVycm9yRmluZ2VycHJpbnQsIG5vcm1hbGl6ZUVycm9yTWVzc2FnZSwgbm9ybWFsaXplU3RhY2tUcmFjZSB9IGZyb20gJy4vdXRpbHMvZXJyb3ItZmluZ2VycHJpbnQnO1xuZXhwb3J0IHsgZ2VuZXJhdGVTcGFuSWQsIGdlbmVyYXRlVHJhY2VJZCB9IGZyb20gJy4vdXRpbHMvaWQtZ2VuZXJhdG9yJztcbmV4cG9ydCB7IGxldmVsVG9Qb3dlcnRvb2xzTG9nTGV2ZWwsIGxldmVsVG9TdHJpbmcsIHN0cmluZ1RvTGV2ZWwgfSBmcm9tICcuL3V0aWxzL2xldmVsLXV0aWxzJztcbmV4cG9ydCB7IG9ic2VydmVkQ2FsbCwgb2JzZXJ2ZWRDYWxsU3luYywgdHlwZSBPYnNlcnZlZENhbGxPcHRpb25zIH0gZnJvbSAnLi91dGlscy9vYnNlcnZlZC1jYWxsJztcbmV4cG9ydCB7IGVzdGltYXRlSXRlbVNpemUsIGlzUGF5bG9hZFdpdGhpbkxpbWl0cywgc2FmZVN0cmluZ2lmeSwgc2FmZVNlcmlhbGl6ZSwgdHJ1bmNhdGVQYXlsb2FkLCB0cnVuY2F0ZUl0ZW0sIHR5cGUgVHJ1bmNhdGlvbk1ldGFkYXRhLCB0eXBlIFNlcmlhbGl6ZU9wdGlvbnMgfSBmcm9tICcuL3V0aWxzL3BheWxvYWQnO1xuZXhwb3J0IHsgY2xlYXJFbnZpcm9ubWVudFRhZ3NDYWNoZSwgY3JlYXRlQ29udHJvbGxlclNvdXJjZSwgY3JlYXRlUXVldWVTb3VyY2UsIGNyZWF0ZVNlcnZpY2VTb3VyY2UsIGNyZWF0ZVRhc2tTb3VyY2UsIGRldGVjdFNvdXJjZSwgZ2V0RW52aXJvbm1lbnRUYWdzLCBtZXJnZVRhZ3MgYXMgbWVyZ2VTb3VyY2VUYWdzIH0gZnJvbSAnLi91dGlscy9zb3VyY2UtdXRpbHMnO1xuXG4vLyA9PT0gVFJBQ0UgR1JBUEggKGV4cGxpY2l0IHBhcmVudC9jYXVzZWRCeSBncmFwaCkgPT09XG5leHBvcnQgeyBidWlsZFRyYWNlR3JhcGgsIHR5cGUgVHJhY2VHcmFwaCwgdHlwZSBUcmFjZU5vZGUsIHR5cGUgVHJhY2VFZGdlIH0gZnJvbSAnLi90cmFjZS1ncmFwaCc7XG5cbi8vID09PSBCQVRDSCBQUk9HUkVTUyA9PT1cbmV4cG9ydCB7XG4gIEJhdGNoUHJvZ3Jlc3MsXG4gIHR5cGUgQmF0Y2hSZXN1bHQsXG4gIHR5cGUgQmF0Y2hTdW1tYXJ5LFxuICB0eXBlIFByb2Nlc3NPcHRpb25zLFxuICB0eXBlIENodW5rT3B0aW9ucyxcbiAgdHlwZSBQcm9jZXNzQ29udGV4dCxcbiAgdHlwZSBGYWlsZWRJdGVtLFxuICB0eXBlIE1ldHJpY1N0YXRzLFxuICB0eXBlIE9ic2VydmVNb2RlLFxufSBmcm9tICcuL3V0aWxzL2JhdGNoLXByb2dyZXNzJztcblxuLy8gPT09IERFQ09SQVRPUlMgPT09XG5leHBvcnQgeyBPYnNlcnZlZCwgT2JzZXJ2ZWRPcHRpb25zIH0gZnJvbSAnLi9kZWNvcmF0b3JzJztcblxuLy8gPT09IENSVUQgSE9PS1MgPT09XG5leHBvcnQgeyBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQsIENydWRPYnNlcnZhYmlsaXR5SG9va3MgfSBmcm9tICcuL2NydWQtaG9va3MnO1xuXG4vLyA9PT0gQ09OVFJPTExFUiBDT05GSUcgPT09XG5leHBvcnQgeyBtZXJnZU9ic2VydmFiaWxpdHlDb25maWdzIH0gZnJvbSAnLi9jb250cm9sbGVyLWNvbmZpZyc7XG5leHBvcnQgdHlwZSB7IENvbnRyb2xsZXJPYnNlcnZhYmlsaXR5Q29uZmlnLCBPYnNlcnZhYmlsaXR5SW5jbHVkZXNDb25maWcsIFNwYW5NZXRhZGF0YSB9IGZyb20gJy4vY29udHJvbGxlci1jb25maWcnO1xuXG4vLyA9PT0gU1RPUkFHRSAoRW50aXR5LCBTZXJ2aWNlKSA9PT1cbi8vIEZvciBhZG1pbiBVSXMsIGV4dGVuZCBCYXNlRW50aXR5Q29udHJvbGxlcjxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPiBkaXJlY3RseVxuZXhwb3J0IHtcbiAgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVNjaGVtYSxcbiAgT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2Vcbn0gZnJvbSAnLi9zdG9yYWdlJztcbmV4cG9ydCB0eXBlIHsgTG9nUmVjb3JkLCBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbSwgT2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYSwgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVR5cGUsIE9ic2VydmFiaWxpdHlMb2dSZWNvcmRUeXBlLCBSZWNvbnN0cnVjdGVkU3BhbiB9IGZyb20gJy4vc3RvcmFnZSc7XG5cbi8vID09PSBURVNUSU5HID09PVxuZXhwb3J0IHsgYXNzZXJ0RXZlbnRDYXB0dXJlZCwgYXNzZXJ0RXZlbnRDb3VudCwgYXNzZXJ0Tm9FdmVudENhcHR1cmVkLCBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHksIGNyZWF0ZVRlc3RBY3RvciwgY3JlYXRlVGVzdENvbnRleHQsIGNyZWF0ZVRlc3RDb250ZXh0U3luYywgY3JlYXRlVGVzdEV4ZWN1dGlvbkNvbnRleHQsIE1vY2tCYWNrZW5kLCBzZXR1cFRlc3RPYnNlcnZhYmlsaXR5IH0gZnJvbSAnLi90ZXN0aW5nJztcbiJdfQ==