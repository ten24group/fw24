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
exports.withSpanSync = exports.withSpan = exports.SpanObserver = exports.toW3CTraceId = exports.toW3CParentId = exports.createStepFunctionsContext = exports.createSqsAttributes = exports.createSnsAttributes = exports.createHttpHeaders = exports.createEventBridgeContext = exports.extractFromStepFunctions = exports.extractFromSqsRecord = exports.extractFromSqs = exports.extractFromSns = exports.extractFromKinesis = exports.extractFromHeaders = exports.extractFromEventBridge = exports.setSource = exports.setAttributes = exports.setAttribute = exports.setActor = exports.enrichActor = exports.addTags = exports.getCurrentParentObservabilityLogId = exports.getCapturedParentId = exports.withContext = exports.runWithExecutionContextSync = exports.runWithExecutionContext = exports.getCurrentSpan = exports.getObservabilityState = exports.getCurrentExecutionContext = exports.createExecutionContext = exports.productionPreset = exports.minimalPreset = exports.getPreset = exports.developmentPreset = exports.debugPreset = exports.validateConfig = exports.VALID_BACKENDS = exports.extendPreset = exports.createObservabilityConfig = exports.CONFIG_DEFAULTS = exports.withObservability = exports.ObservabilityManager = exports.Observer = exports.getEffectivePriority = exports.evaluateNoiseRules = exports.DECISION_BASE_PRIORITY = exports.DefaultSamplingConfig = exports.ObservabilityLevel = void 0;
exports.ObservabilityLogEntitySchema = exports.mergeObservabilityConfigs = exports.CrudObservabilityHooks = exports.Traced = exports.Observed = exports.Audited = exports.BatchProgress = exports.buildTraceGraph = exports.mergeSourceTags = exports.getEnvironmentTags = exports.detectSource = exports.createTaskSource = exports.createServiceSource = exports.createQueueSource = exports.createControllerSource = exports.clearEnvironmentTagsCache = exports.truncateItem = exports.truncatePayload = exports.safeStringify = exports.isPayloadWithinLimits = exports.estimateItemSize = exports.stringToLevel = exports.levelToString = exports.levelToPowertoolsLogLevel = exports.generateTraceId = exports.generateSpanId = exports.shouldRedactKey = exports.redactSensitiveData = exports.extendBlacklist = exports.DEFAULT_PROTECTED_FIELDS = exports.DEFAULT_BLACKLISTED_KEYS = exports.clearRedactorCache = exports.OTELObservabilityBackend = exports.DynamoDBObservabilityBackend = exports.CloudWatchBackend = exports.initializeCapturer = exports.resetCapturer = exports.setCapturer = exports.normalizeError = exports.mapError = exports.mergeTags = exports.resolveCorrelationId = exports.buildCaptureInput = exports.captureRecordAsync = exports.captureRecord = exports.generateId = exports.MetricObserver = exports.LogObserver = exports.AuditObserver = exports.wrapInSpan = void 0;
exports.setupTestObservability = exports.MockBackend = exports.createTestExecutionContext = exports.createTestContextSync = exports.createTestContext = exports.createTestActor = exports.cleanupTestObservability = exports.assertNoEventCaptured = exports.assertEventCount = exports.assertEventCaptured = exports.ObservabilityLogService = void 0;
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
// === NOISE REDUCTION PRIORITY SYSTEM ===
var priority_1 = require("./noise-reduction/priority");
Object.defineProperty(exports, "DECISION_BASE_PRIORITY", { enumerable: true, get: function () { return priority_1.DECISION_BASE_PRIORITY; } });
Object.defineProperty(exports, "evaluateNoiseRules", { enumerable: true, get: function () { return priority_1.evaluateNoiseRules; } });
Object.defineProperty(exports, "getEffectivePriority", { enumerable: true, get: function () { return priority_1.getEffectivePriority; } });
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
var id_generator_1 = require("./utils/id-generator");
Object.defineProperty(exports, "generateSpanId", { enumerable: true, get: function () { return id_generator_1.generateSpanId; } });
Object.defineProperty(exports, "generateTraceId", { enumerable: true, get: function () { return id_generator_1.generateTraceId; } });
var level_utils_1 = require("./utils/level-utils");
Object.defineProperty(exports, "levelToPowertoolsLogLevel", { enumerable: true, get: function () { return level_utils_1.levelToPowertoolsLogLevel; } });
Object.defineProperty(exports, "levelToString", { enumerable: true, get: function () { return level_utils_1.levelToString; } });
Object.defineProperty(exports, "stringToLevel", { enumerable: true, get: function () { return level_utils_1.stringToLevel; } });
var payload_1 = require("./utils/payload");
Object.defineProperty(exports, "estimateItemSize", { enumerable: true, get: function () { return payload_1.estimateItemSize; } });
Object.defineProperty(exports, "isPayloadWithinLimits", { enumerable: true, get: function () { return payload_1.isPayloadWithinLimits; } });
Object.defineProperty(exports, "safeStringify", { enumerable: true, get: function () { return payload_1.safeStringify; } });
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
Object.defineProperty(exports, "Audited", { enumerable: true, get: function () { return decorators_1.Audited; } });
Object.defineProperty(exports, "Observed", { enumerable: true, get: function () { return decorators_1.Observed; } });
Object.defineProperty(exports, "Traced", { enumerable: true, get: function () { return decorators_1.Traced; } });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7R0FnQkc7Ozs7O0FBRUgsOEJBQW9DO0FBQ3BDLHFDQUFxRDtBQUVyRCw4RUFBOEU7QUFDOUUsZ0ZBQWdGO0FBQ2hGLDhFQUE4RTtBQUU5RSxnQkFBVyxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQztJQUN0QyxPQUFPLEVBQUUsZUFBZTtJQUN4QixTQUFTLEVBQUUsSUFBQSxrQ0FBeUIsR0FBRTtJQUN0QyxRQUFRLEVBQUUsQ0FBQztDQUNaLENBQUMsQ0FBQztBQUVILDhFQUE4RTtBQUM5RSxVQUFVO0FBQ1YsOEVBQThFO0FBRTlFLHFCQUFxQjtBQUNyQixpQ0FtQ2lCO0FBOUJmLDJHQUFBLGtCQUFrQixPQUFBO0FBMkJsQiw4R0FBQSxxQkFBcUIsT0FBQTtBQUt2QiwwQ0FBMEM7QUFDMUMsdURBQThHO0FBQXJHLGtIQUFBLHNCQUFzQixPQUFBO0FBQUUsOEdBQUEsa0JBQWtCLE9BQUE7QUFBRSxnSEFBQSxvQkFBb0IsT0FBQTtBQUd6RSx1QkFBdUI7QUFDdkIscUNBSW1CO0FBSGpCLG1HQUFBLFFBQVEsT0FBQTtBQUNSLCtHQUFBLG9CQUFvQixPQUFBO0FBQ3BCLDRHQUFBLGlCQUFpQixPQUFBO0FBR25CLHdCQUF3QjtBQUN4QixtQ0FRa0I7QUFQaEIseUdBQUEsZUFBZSxPQUFBO0FBQ2YsbUhBQUEseUJBQXlCLE9BQUE7QUFDekIsc0dBQUEsWUFBWSxPQUFBO0FBRVosd0dBQUEsY0FBYyxPQUFBO0FBQ2Qsd0dBQUEsY0FBYyxPQUFBO0FBSWhCLGtCQUFrQjtBQUNsQixxQ0FPbUI7QUFOakIsc0dBQUEsV0FBVyxPQUFBO0FBQ1gsNEdBQUEsaUJBQWlCLE9BQUE7QUFDakIsb0dBQUEsU0FBUyxPQUFBO0FBQ1Qsd0dBQUEsYUFBYSxPQUFBO0FBQ2Is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QVksT0FBQTtBQUM5RixxREFBbU47QUFBMU0seUhBQUEseUJBQXlCLE9BQUE7QUFBRSxzSEFBQSxzQkFBc0IsT0FBQTtBQUFFLGlIQUFBLGlCQUFpQixPQUFBO0FBQUUsbUhBQUEsbUJBQW1CLE9BQUE7QUFBRSxnSEFBQSxnQkFBZ0IsT0FBQTtBQUFFLDRHQUFBLFlBQVksT0FBQTtBQUFFLGtIQUFBLGtCQUFrQixPQUFBO0FBQUUsK0dBQUEsU0FBUyxPQUFtQjtBQUVwTCx1REFBdUQ7QUFDdkQsNkNBQWlHO0FBQXhGLDhHQUFBLGVBQWUsT0FBQTtBQUV4Qix5QkFBeUI7QUFDekIseURBVWdDO0FBVDlCLCtHQUFBLGFBQWEsT0FBQTtBQVdmLHFCQUFxQjtBQUNyQiwyQ0FBeUc7QUFBaEcscUdBQUEsT0FBTyxPQUFBO0FBQWtCLHNHQUFBLFFBQVEsT0FBQTtBQUFtQixvR0FBQSxNQUFNLE9BQUE7QUFFbkUscUJBQXFCO0FBQ3JCLDJDQUFnRjtBQUE3QyxvSEFBQSxzQkFBc0IsT0FBQTtBQUV6RCw0QkFBNEI7QUFDNUIseURBQWdFO0FBQXZELDhIQUFBLHlCQUF5QixPQUFBO0FBR2xDLG9DQUFvQztBQUNwQyw4RUFBOEU7QUFDOUUscUNBR21CO0FBRmpCLHVIQUFBLDRCQUE0QixPQUFBO0FBQzVCLGtIQUFBLHVCQUF1QixPQUFBO0FBSXpCLGtCQUFrQjtBQUNsQixxQ0FBK087QUFBdE8sOEdBQUEsbUJBQW1CLE9BQUE7QUFBRSwyR0FBQSxnQkFBZ0IsT0FBQTtBQUFFLGdIQUFBLHFCQUFxQixPQUFBO0FBQUUsbUhBQUEsd0JBQXdCLE9BQUE7QUFBRSwwR0FBQSxlQUFlLE9BQUE7QUFBRSw0R0FBQSxpQkFBaUIsT0FBQTtBQUFFLGdIQUFBLHFCQUFxQixPQUFBO0FBQUUscUhBQUEsMEJBQTBCLE9BQUE7QUFBRSxzR0FBQSxXQUFXLE9BQUE7QUFBRSxpSEFBQSxzQkFBc0IsT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRlcyNCBPYnNlcnZhYmlsaXR5IFN5c3RlbVxuICogXG4gKiBVbmlmaWVkIG9ic2VydmFiaWxpdHkgZm9yIGxvZ2dpbmcsIG1ldHJpY3MsIHRyYWNlcywgYW5kIGF1ZGl0cy5cbiAqIFxuICogIyMgUXVpY2sgU3RhcnRcbiAqIFxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQ29udGV4dCBpcyBhdXRvLWVzdGFibGlzaGVkIGluIGNvbnRyb2xsZXJzXG4gKiAvLyBBY2Nlc3MgdmlhIGN0eC5leGVjdXRpb25Db250ZXh0IG9yIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KClcbiAqIFxuICogYXdhaXQgU3Bhbk9ic2VydmVyLndpdGhTcGFuKCdwcm9jZXNzT3JkZXInLCBhc3luYyAoc3BhbikgPT4ge1xuICogICBBdWRpdE9ic2VydmVyLmVudGl0eUNyZWF0ZSgnT3JkZXInLCBvcmRlcklkLCBkYXRhKTtcbiAqICAgTWV0cmljT2JzZXJ2ZXIuaW5jcmVtZW50KCdvcmRlcnMuY3JlYXRlZCcpO1xuICogfSk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpJztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuL2NvbmZpZyc7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUkVHSVNURVIgREVGQVVMVCBDT05GSUcgKHByaW9yaXR5IDAgLSBhcHBzIGNhbiBvdmVycmlkZSB3aXRoIGhpZ2hlciBwcmlvcml0eSlcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5ESUNvbnRhaW5lci5ST09ULnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICBwcm92aWRlOiAnb2JzZXJ2YWJpbGl0eScsXG4gIHVzZUNvbmZpZzogY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZygpLFxuICBwcmlvcml0eTogMFxufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gRVhQT1JUU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8vID09PSBDT1JFIFRZUEVTID09PVxuZXhwb3J0IHtcbiAgLy8gRXZlbnQgdHlwZXNcbiAgdHlwZSBCYXNlRXZlbnRUeXBlLFxuICB0eXBlIE9ic2VydmFiaWxpdHlFdmVudFR5cGUsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLFxuICBPYnNlcnZhYmlsaXR5TGV2ZWwsXG5cbiAgLy8gUmVjb3JkIHR5cGVzXG4gIHR5cGUgQ2FwdHVyZUlucHV0LFxuICB0eXBlIE9ic2VydmFiaWxpdHlFdmVudCxcbiAgdHlwZSBPYnNlcnZhYmlsaXR5RXJyb3IsXG5cbiAgLy8gQ2FwdHVyZSBjb250cm9sXG4gIHR5cGUgQ2FwdHVyZUNvbnRyb2wsXG4gIHR5cGUgR3JvdXBTYW1wbGluZ0NvbmZpZyxcbiAgdHlwZSBSZWNvcmRPdmVycmlkZXMsXG4gIHR5cGUgQ29udGV4dE92ZXJyaWRlcyxcblxuICAvLyBEZWNvcmF0b3IgdHlwZXNcbiAgdHlwZSBEZWNvcmF0b3JCYXNlT3B0aW9ucyxcbiAgdHlwZSBTb3VyY2VUeXBlLFxuXG4gIC8vIENvbmZpZyB0eXBlc1xuICB0eXBlIE9ic2VydmFiaWxpdHlDb25maWcsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWcsXG4gIHR5cGUgRGF0YVByb3RlY3Rpb25Db25maWcsXG4gIHR5cGUgVHJ1bmNhdGlvbkNvbmZpZyxcbiAgdHlwZSBEeW5hbW9EQkNvbmZpZyxcbiAgdHlwZSBTYW1wbGluZ0NvbmZpZyxcbiAgdHlwZSBUeXBlU3BlY2lmaWNDb25maWcsXG4gIHR5cGUgSUV2ZW50Q2FwdHVyZSxcbiAgRGVmYXVsdFNhbXBsaW5nQ29uZmlnLFxuXG4gIC8vIERlcHJlY2F0ZWQgYWxpYXNlc1xufSBmcm9tICcuL3R5cGVzJztcblxuLy8gPT09IE5PSVNFIFJFRFVDVElPTiBQUklPUklUWSBTWVNURU0gPT09XG5leHBvcnQgeyBERUNJU0lPTl9CQVNFX1BSSU9SSVRZLCBldmFsdWF0ZU5vaXNlUnVsZXMsIGdldEVmZmVjdGl2ZVByaW9yaXR5IH0gZnJvbSAnLi9ub2lzZS1yZWR1Y3Rpb24vcHJpb3JpdHknO1xuZXhwb3J0IHR5cGUgeyBOb2lzZUV2YWx1YXRpb25SZXN1bHQgfSBmcm9tICcuL25vaXNlLXJlZHVjdGlvbi9wcmlvcml0eSc7XG5cbi8vID09PSBDT1JFIE1BTkFHRVIgPT09XG5leHBvcnQge1xuICBPYnNlcnZlcixcbiAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIsXG4gIHdpdGhPYnNlcnZhYmlsaXR5LFxufSBmcm9tICcuL21hbmFnZXInO1xuXG4vLyA9PT0gQ09ORklHVVJBVElPTiA9PT1cbmV4cG9ydCB7XG4gIENPTkZJR19ERUZBVUxUUyxcbiAgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgZXh0ZW5kUHJlc2V0LFxuICBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQsXG4gIFZBTElEX0JBQ0tFTkRTLFxuICB2YWxpZGF0ZUNvbmZpZyxcbiAgVmFsaWRCYWNrZW5kXG59IGZyb20gJy4vY29uZmlnJztcblxuLy8gPT09IFBSRVNFVFMgPT09XG5leHBvcnQge1xuICBkZWJ1Z1ByZXNldCxcbiAgZGV2ZWxvcG1lbnRQcmVzZXQsXG4gIGdldFByZXNldCxcbiAgbWluaW1hbFByZXNldCxcbiAgcHJvZHVjdGlvblByZXNldCxcbiAgdHlwZSBPYnNlcnZhYmlsaXR5UHJlc2V0XG59IGZyb20gJy4vcHJlc2V0cyc7XG5cbi8vID09PSBDT05URVhUID09PVxuZXhwb3J0IHtcbiAgLy8gVHlwZXNcbiAgdHlwZSBBY3RvcixcbiAgdHlwZSBDcmVhdGVFeGVjdXRpb25Db250ZXh0T3B0aW9ucyxcbiAgdHlwZSBFeGVjdXRpb25Db250ZXh0RGF0YSxcbiAgdHlwZSBQYXJzZWRUcmFjZUNvbnRleHQsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eVN0YXRlLFxuICB0eXBlIE9ic2VydmFiaWxpdHlTdW1tYXJ5LFxuICB0eXBlIElTcGFuTm9kZSxcblxuICAvLyBTdG9yYWdlICYgTGlmZWN5Y2xlXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0LFxuICBnZXRPYnNlcnZhYmlsaXR5U3RhdGUsXG4gIGdldEN1cnJlbnRTcGFuLFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCxcbiAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHRTeW5jLFxuXG4gIC8vIENvbnRleHQgT3ZlcnJpZGVcbiAgd2l0aENvbnRleHQsXG5cbiAgLy8gUGFyZW50IFJlc29sdXRpb25cbiAgZ2V0Q2FwdHVyZWRQYXJlbnRJZCxcbiAgZ2V0Q3VycmVudFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcblxuICAvLyBFbnJpY2htZW50XG4gIGFkZFRhZ3MsXG4gIGVucmljaEFjdG9yLFxuICBzZXRBY3RvcixcbiAgc2V0QXR0cmlidXRlLFxuICBzZXRBdHRyaWJ1dGVzLFxuICBzZXRTb3VyY2UsXG5cbiAgLy8gUHJvcGFnYXRpb24gLSBFeHRyYWN0aW9uXG4gIGV4dHJhY3RGcm9tRXZlbnRCcmlkZ2UsXG4gIGV4dHJhY3RGcm9tSGVhZGVycyxcbiAgZXh0cmFjdEZyb21LaW5lc2lzLFxuICBleHRyYWN0RnJvbVNucyxcbiAgZXh0cmFjdEZyb21TcXMsXG4gIGV4dHJhY3RGcm9tU3FzUmVjb3JkLFxuICBleHRyYWN0RnJvbVN0ZXBGdW5jdGlvbnMsXG5cbiAgLy8gUHJvcGFnYXRpb24gLSBDcmVhdGlvblxuICBjcmVhdGVFdmVudEJyaWRnZUNvbnRleHQsXG4gIGNyZWF0ZUh0dHBIZWFkZXJzLFxuICBjcmVhdGVTbnNBdHRyaWJ1dGVzLFxuICBjcmVhdGVTcXNBdHRyaWJ1dGVzLFxuICBjcmVhdGVTdGVwRnVuY3Rpb25zQ29udGV4dCxcbiAgdG9XM0NQYXJlbnRJZCxcbiAgdG9XM0NUcmFjZUlkLFxufSBmcm9tICcuL2NvbnRleHQnO1xuXG4vLyA9PT0gQ09SRSBPQlNFUlZFUlMgPT09XG5leHBvcnQge1xuICAvLyBTcGFuXG4gIFNwYW5PYnNlcnZlcixcbiAgdHlwZSBTcGFuT3B0aW9ucyxcbiAgdHlwZSBTcGFuRW5kT3B0aW9ucyxcbiAgdHlwZSBJU3Bhbk9ic2VydmVyLFxuICB3aXRoU3BhbixcbiAgd2l0aFNwYW5TeW5jLFxuICB3cmFwSW5TcGFuLFxuXG4gIC8vIEF1ZGl0XG4gIEF1ZGl0T2JzZXJ2ZXIsXG4gIHR5cGUgRW50aXR5QXVkaXRPcHRpb25zLFxuICB0eXBlIEF1ZGl0UmVjb3JkT3B0aW9ucyxcbiAgdHlwZSBDb21wbGlhbmNlQXVkaXRPcHRpb25zLFxuICB0eXBlIEFjY2Vzc0F1ZGl0T3B0aW9ucyxcblxuICAvLyBMb2dcbiAgTG9nT2JzZXJ2ZXIsXG4gIHR5cGUgTG9nT3B0aW9ucyxcblxuICAvLyBNZXRyaWNcbiAgTWV0cmljT2JzZXJ2ZXIsXG4gIHR5cGUgTWV0cmljT3B0aW9ucyxcblxuICAvLyBCYXNlIHV0aWxpdGllc1xuICBnZW5lcmF0ZUlkLFxuICBjYXB0dXJlUmVjb3JkLFxuICBjYXB0dXJlUmVjb3JkQXN5bmMsXG4gIGJ1aWxkQ2FwdHVyZUlucHV0LFxuICByZXNvbHZlQ29ycmVsYXRpb25JZCxcbiAgbWVyZ2VUYWdzLFxuICBtYXBFcnJvcixcbiAgbm9ybWFsaXplRXJyb3IsXG5cbiAgLy8gVGVzdGluZyB1dGlsaXRpZXNcbiAgc2V0Q2FwdHVyZXIsXG4gIHJlc2V0Q2FwdHVyZXIsXG4gIGluaXRpYWxpemVDYXB0dXJlcixcbn0gZnJvbSAnLi9vYnNlcnZlcnMnO1xuXG4vLyA9PT0gQkFDS0VORFMgKERJLW1hbmFnZWQsIGV4cG9ydGVkIGZvciB0eXBlIHJlZmVyZW5jZXMpID09PVxuZXhwb3J0IHsgQ2xvdWRXYXRjaEJhY2tlbmQgfSBmcm9tICcuL2JhY2tlbmRzL2Nsb3Vkd2F0Y2gnO1xuZXhwb3J0IHsgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCB9IGZyb20gJy4vYmFja2VuZHMvZHluYW1vZGInO1xuZXhwb3J0IHsgT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kIH0gZnJvbSAnLi9iYWNrZW5kcy9vdGVsJztcblxuLy8gPT09IFVUSUxJVElFUyA9PT1cbmV4cG9ydCB7IGNsZWFyUmVkYWN0b3JDYWNoZSwgREVGQVVMVF9CTEFDS0xJU1RFRF9LRVlTLCBERUZBVUxUX1BST1RFQ1RFRF9GSUVMRFMsIGV4dGVuZEJsYWNrbGlzdCwgcmVkYWN0U2Vuc2l0aXZlRGF0YSwgc2hvdWxkUmVkYWN0S2V5IH0gZnJvbSAnLi91dGlscy9kYXRhLXByb3RlY3Rpb24nO1xuZXhwb3J0IHsgZ2VuZXJhdGVTcGFuSWQsIGdlbmVyYXRlVHJhY2VJZCB9IGZyb20gJy4vdXRpbHMvaWQtZ2VuZXJhdG9yJztcbmV4cG9ydCB7IGxldmVsVG9Qb3dlcnRvb2xzTG9nTGV2ZWwsIGxldmVsVG9TdHJpbmcsIHN0cmluZ1RvTGV2ZWwgfSBmcm9tICcuL3V0aWxzL2xldmVsLXV0aWxzJztcbmV4cG9ydCB7IGVzdGltYXRlSXRlbVNpemUsIGlzUGF5bG9hZFdpdGhpbkxpbWl0cywgc2FmZVN0cmluZ2lmeSwgdHJ1bmNhdGVQYXlsb2FkLCB0cnVuY2F0ZUl0ZW0sIHR5cGUgVHJ1bmNhdGlvbk1ldGFkYXRhIH0gZnJvbSAnLi91dGlscy9wYXlsb2FkJztcbmV4cG9ydCB7IGNsZWFyRW52aXJvbm1lbnRUYWdzQ2FjaGUsIGNyZWF0ZUNvbnRyb2xsZXJTb3VyY2UsIGNyZWF0ZVF1ZXVlU291cmNlLCBjcmVhdGVTZXJ2aWNlU291cmNlLCBjcmVhdGVUYXNrU291cmNlLCBkZXRlY3RTb3VyY2UsIGdldEVudmlyb25tZW50VGFncywgbWVyZ2VUYWdzIGFzIG1lcmdlU291cmNlVGFncyB9IGZyb20gJy4vdXRpbHMvc291cmNlLXV0aWxzJztcblxuLy8gPT09IFRSQUNFIEdSQVBIIChleHBsaWNpdCBwYXJlbnQvY2F1c2VkQnkgZ3JhcGgpID09PVxuZXhwb3J0IHsgYnVpbGRUcmFjZUdyYXBoLCB0eXBlIFRyYWNlR3JhcGgsIHR5cGUgVHJhY2VOb2RlLCB0eXBlIFRyYWNlRWRnZSB9IGZyb20gJy4vdHJhY2UtZ3JhcGgnO1xuXG4vLyA9PT0gQkFUQ0ggUFJPR1JFU1MgPT09XG5leHBvcnQge1xuICBCYXRjaFByb2dyZXNzLFxuICB0eXBlIEJhdGNoUmVzdWx0LFxuICB0eXBlIEJhdGNoU3VtbWFyeSxcbiAgdHlwZSBQcm9jZXNzT3B0aW9ucyxcbiAgdHlwZSBDaHVua09wdGlvbnMsXG4gIHR5cGUgUHJvY2Vzc0NvbnRleHQsXG4gIHR5cGUgRmFpbGVkSXRlbSxcbiAgdHlwZSBNZXRyaWNTdGF0cyxcbiAgdHlwZSBPYnNlcnZlTW9kZSxcbn0gZnJvbSAnLi91dGlscy9iYXRjaC1wcm9ncmVzcyc7XG5cbi8vID09PSBERUNPUkFUT1JTID09PVxuZXhwb3J0IHsgQXVkaXRlZCwgQXVkaXRlZE9wdGlvbnMsIE9ic2VydmVkLCBPYnNlcnZlZE9wdGlvbnMsIFRyYWNlZCwgVHJhY2VkT3B0aW9ucyB9IGZyb20gJy4vZGVjb3JhdG9ycyc7XG5cbi8vID09PSBDUlVEIEhPT0tTID09PVxuZXhwb3J0IHsgQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LCBDcnVkT2JzZXJ2YWJpbGl0eUhvb2tzIH0gZnJvbSAnLi9jcnVkLWhvb2tzJztcblxuLy8gPT09IENPTlRST0xMRVIgQ09ORklHID09PVxuZXhwb3J0IHsgbWVyZ2VPYnNlcnZhYmlsaXR5Q29uZmlncyB9IGZyb20gJy4vY29udHJvbGxlci1jb25maWcnO1xuZXhwb3J0IHR5cGUgeyBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZywgT2JzZXJ2YWJpbGl0eUluY2x1ZGVzQ29uZmlnLCBTcGFuTWV0YWRhdGEgfSBmcm9tICcuL2NvbnRyb2xsZXItY29uZmlnJztcblxuLy8gPT09IFNUT1JBR0UgKEVudGl0eSwgU2VydmljZSkgPT09XG4vLyBGb3IgYWRtaW4gVUlzLCBleHRlbmQgQmFzZUVudGl0eUNvbnRyb2xsZXI8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT4gZGlyZWN0bHlcbmV4cG9ydCB7XG4gIE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEsXG4gIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlXG59IGZyb20gJy4vc3RvcmFnZSc7XG5leHBvcnQgdHlwZSB7IExvZ1JlY29yZCwgT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0sIE9ic2VydmFiaWxpdHlMb2dTY2hlbWEsIFJlY29uc3RydWN0ZWRTcGFuIH0gZnJvbSAnLi9zdG9yYWdlJztcblxuLy8gPT09IFRFU1RJTkcgPT09XG5leHBvcnQgeyBhc3NlcnRFdmVudENhcHR1cmVkLCBhc3NlcnRFdmVudENvdW50LCBhc3NlcnROb0V2ZW50Q2FwdHVyZWQsIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSwgY3JlYXRlVGVzdEFjdG9yLCBjcmVhdGVUZXN0Q29udGV4dCwgY3JlYXRlVGVzdENvbnRleHRTeW5jLCBjcmVhdGVUZXN0RXhlY3V0aW9uQ29udGV4dCwgTW9ja0JhY2tlbmQsIHNldHVwVGVzdE9ic2VydmFiaWxpdHkgfSBmcm9tICcuL3Rlc3RpbmcnO1xuIl19