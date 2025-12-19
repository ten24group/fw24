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
 * // Access via ctx.executionContext or getCurrentContext()
 *
 * const span = SpanObserver.start('processOrder');
 * AuditObserver.entityCreate('Order', orderId, data);
 * MetricObserver.increment('orders.created');
 * span.end({ success: true });
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withSpan = exports.SpanObserver = exports.MetricObserver = exports.ChildLogObserver = exports.LogObserver = exports.AuditObserver = exports.toW3CTraceId = exports.toW3CParentId = exports.setSource = exports.setParentObservabilityLogId = exports.setAttributes = exports.setAttribute = exports.setActor = exports.runWithExecutionContextSync = exports.runWithExecutionContext = exports.runWithContextSync = exports.runWithContext = exports.getCurrentExecutionContext = exports.getCurrentContext = exports.getCorrelationIdIfExists = exports.extractFromStepFunctions = exports.extractFromSqs = exports.extractFromSns = exports.extractFromKinesis = exports.extractFromHeaders = exports.extractFromEventBridge = exports.enrichActor = exports.createStepFunctionsContext = exports.createSqsAttributes = exports.createSnsAttributes = exports.createObservationContext = exports.createHttpHeaders = exports.createExecutionContext = exports.createEventBridgeContext = exports.addTags = exports.productionPreset = exports.minimalPreset = exports.getPreset = exports.developmentPreset = exports.debugPreset = exports.createObservabilityConfigFromPreset = exports.validateConfig = exports.VALID_BACKENDS = exports.createObservabilityConfig = exports.CONFIG_DEFAULTS = exports.withObservability = exports.Observer = exports.ObservabilityManager = exports.ObservabilityLevel = exports.DefaultSamplingConfig = void 0;
exports.setupTestObservability = exports.MockBackend = exports.createTestObservationContext = exports.createTestContextSync = exports.createTestContext = exports.createTestActor = exports.cleanupTestObservability = exports.assertNoEventCaptured = exports.assertEventCount = exports.assertEventCaptured = exports.ObservabilityLogService = exports.ObservabilityLogEntitySchema = exports.mergeObservabilityConfigs = exports.CrudObservabilityHooks = exports.Traced = exports.Observed = exports.Audited = exports.mergeTags = exports.getEnvironmentTags = exports.detectSource = exports.createTaskSource = exports.createServiceSource = exports.createQueueSource = exports.createControllerSource = exports.clearEnvironmentTagsCache = exports.truncatePayload = exports.safeStringify = exports.isPayloadWithinLimits = exports.estimateItemSize = exports.stringToLevel = exports.levelToString = exports.levelToPowertoolsLogLevel = exports.generateTraceId = exports.generateSpanId = exports.shouldRedactKey = exports.redactSensitiveData = exports.extendBlacklist = exports.DEFAULT_PROTECTED_FIELDS = exports.DEFAULT_BLACKLISTED_KEYS = exports.clearRedactorCache = exports.OTELObservabilityBackend = exports.DynamoDBObservabilityBackend = exports.CloudWatchBackend = void 0;
const di_1 = require("../di");
const config_1 = require("./config");
// ═══════════════════════════════════════════════════════════════════════════
// REGISTER DEFAULT CONFIG (priority 0 - apps can override with higher priority)
// ═══════════════════════════════════════════════════════════════════════════
di_1.DIContainer.ROOT.registerConfigProvider({
    provide: 'observability',
    useConfig: (0, config_1.createObservabilityConfig)(), // Factory returns complete typed config with defaults
    priority: 0
});
// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════
// === CORE TYPES ===
var types_1 = require("./types");
Object.defineProperty(exports, "DefaultSamplingConfig", { enumerable: true, get: function () { return types_1.DefaultSamplingConfig; } });
Object.defineProperty(exports, "ObservabilityLevel", { enumerable: true, get: function () { return types_1.ObservabilityLevel; } });
// === CORE MANAGER ===
var manager_1 = require("./manager");
Object.defineProperty(exports, "ObservabilityManager", { enumerable: true, get: function () { return manager_1.ObservabilityManager; } });
Object.defineProperty(exports, "Observer", { enumerable: true, get: function () { return manager_1.Observer; } });
Object.defineProperty(exports, "withObservability", { enumerable: true, get: function () { return manager_1.withObservability; } });
// === CONFIGURATION ===
var config_2 = require("./config");
Object.defineProperty(exports, "CONFIG_DEFAULTS", { enumerable: true, get: function () { return config_2.CONFIG_DEFAULTS; } });
Object.defineProperty(exports, "createObservabilityConfig", { enumerable: true, get: function () { return config_2.createObservabilityConfig; } });
Object.defineProperty(exports, "VALID_BACKENDS", { enumerable: true, get: function () { return config_2.VALID_BACKENDS; } });
Object.defineProperty(exports, "validateConfig", { enumerable: true, get: function () { return config_2.validateConfig; } });
// === PRESETS ===
var presets_1 = require("./presets");
Object.defineProperty(exports, "createObservabilityConfigFromPreset", { enumerable: true, get: function () { return presets_1.createObservabilityConfig; } });
Object.defineProperty(exports, "debugPreset", { enumerable: true, get: function () { return presets_1.debugPreset; } });
Object.defineProperty(exports, "developmentPreset", { enumerable: true, get: function () { return presets_1.developmentPreset; } });
Object.defineProperty(exports, "getPreset", { enumerable: true, get: function () { return presets_1.getPreset; } });
Object.defineProperty(exports, "minimalPreset", { enumerable: true, get: function () { return presets_1.minimalPreset; } });
Object.defineProperty(exports, "productionPreset", { enumerable: true, get: function () { return presets_1.productionPreset; } });
// === CONTEXT ===
var context_1 = require("./context");
Object.defineProperty(exports, "addTags", { enumerable: true, get: function () { return context_1.addTags; } });
Object.defineProperty(exports, "createEventBridgeContext", { enumerable: true, get: function () { return context_1.createEventBridgeContext; } });
Object.defineProperty(exports, "createExecutionContext", { enumerable: true, get: function () { return context_1.createExecutionContext; } });
Object.defineProperty(exports, "createHttpHeaders", { enumerable: true, get: function () { return context_1.createHttpHeaders; } });
Object.defineProperty(exports, "createObservationContext", { enumerable: true, get: function () { return context_1.createObservationContext; } });
Object.defineProperty(exports, "createSnsAttributes", { enumerable: true, get: function () { return context_1.createSnsAttributes; } });
Object.defineProperty(exports, "createSqsAttributes", { enumerable: true, get: function () { return context_1.createSqsAttributes; } });
Object.defineProperty(exports, "createStepFunctionsContext", { enumerable: true, get: function () { return context_1.createStepFunctionsContext; } });
Object.defineProperty(exports, "enrichActor", { enumerable: true, get: function () { return context_1.enrichActor; } });
Object.defineProperty(exports, "extractFromEventBridge", { enumerable: true, get: function () { return context_1.extractFromEventBridge; } });
Object.defineProperty(exports, "extractFromHeaders", { enumerable: true, get: function () { return context_1.extractFromHeaders; } });
Object.defineProperty(exports, "extractFromKinesis", { enumerable: true, get: function () { return context_1.extractFromKinesis; } });
Object.defineProperty(exports, "extractFromSns", { enumerable: true, get: function () { return context_1.extractFromSns; } });
Object.defineProperty(exports, "extractFromSqs", { enumerable: true, get: function () { return context_1.extractFromSqs; } });
Object.defineProperty(exports, "extractFromStepFunctions", { enumerable: true, get: function () { return context_1.extractFromStepFunctions; } });
Object.defineProperty(exports, "getCorrelationIdIfExists", { enumerable: true, get: function () { return context_1.getCorrelationIdIfExists; } });
Object.defineProperty(exports, "getCurrentContext", { enumerable: true, get: function () { return context_1.getCurrentContext; } });
Object.defineProperty(exports, "getCurrentExecutionContext", { enumerable: true, get: function () { return context_1.getCurrentExecutionContext; } });
Object.defineProperty(exports, "runWithContext", { enumerable: true, get: function () { return context_1.runWithContext; } });
Object.defineProperty(exports, "runWithContextSync", { enumerable: true, get: function () { return context_1.runWithContextSync; } });
Object.defineProperty(exports, "runWithExecutionContext", { enumerable: true, get: function () { return context_1.runWithExecutionContext; } });
Object.defineProperty(exports, "runWithExecutionContextSync", { enumerable: true, get: function () { return context_1.runWithExecutionContextSync; } });
Object.defineProperty(exports, "setActor", { enumerable: true, get: function () { return context_1.setActor; } });
Object.defineProperty(exports, "setAttribute", { enumerable: true, get: function () { return context_1.setAttribute; } });
Object.defineProperty(exports, "setAttributes", { enumerable: true, get: function () { return context_1.setAttributes; } });
Object.defineProperty(exports, "setParentObservabilityLogId", { enumerable: true, get: function () { return context_1.setParentObservabilityLogId; } });
Object.defineProperty(exports, "setSource", { enumerable: true, get: function () { return context_1.setSource; } });
Object.defineProperty(exports, "toW3CParentId", { enumerable: true, get: function () { return context_1.toW3CParentId; } });
Object.defineProperty(exports, "toW3CTraceId", { enumerable: true, get: function () { return context_1.toW3CTraceId; } });
// === CORE OBSERVERS ===
var observers_1 = require("./observers");
// Audit
Object.defineProperty(exports, "AuditObserver", { enumerable: true, get: function () { return observers_1.AuditObserver; } });
// Log
Object.defineProperty(exports, "LogObserver", { enumerable: true, get: function () { return observers_1.LogObserver; } });
Object.defineProperty(exports, "ChildLogObserver", { enumerable: true, get: function () { return observers_1.ChildLogObserver; } });
// Metric
Object.defineProperty(exports, "MetricObserver", { enumerable: true, get: function () { return observers_1.MetricObserver; } });
// Span
Object.defineProperty(exports, "SpanObserver", { enumerable: true, get: function () { return observers_1.SpanObserver; } });
Object.defineProperty(exports, "withSpan", { enumerable: true, get: function () { return observers_1.withSpan; } });
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
var source_utils_1 = require("./utils/source-utils");
Object.defineProperty(exports, "clearEnvironmentTagsCache", { enumerable: true, get: function () { return source_utils_1.clearEnvironmentTagsCache; } });
Object.defineProperty(exports, "createControllerSource", { enumerable: true, get: function () { return source_utils_1.createControllerSource; } });
Object.defineProperty(exports, "createQueueSource", { enumerable: true, get: function () { return source_utils_1.createQueueSource; } });
Object.defineProperty(exports, "createServiceSource", { enumerable: true, get: function () { return source_utils_1.createServiceSource; } });
Object.defineProperty(exports, "createTaskSource", { enumerable: true, get: function () { return source_utils_1.createTaskSource; } });
Object.defineProperty(exports, "detectSource", { enumerable: true, get: function () { return source_utils_1.detectSource; } });
Object.defineProperty(exports, "getEnvironmentTags", { enumerable: true, get: function () { return source_utils_1.getEnvironmentTags; } });
Object.defineProperty(exports, "mergeTags", { enumerable: true, get: function () { return source_utils_1.mergeTags; } });
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
Object.defineProperty(exports, "createTestObservationContext", { enumerable: true, get: function () { return testing_1.createTestObservationContext; } });
Object.defineProperty(exports, "MockBackend", { enumerable: true, get: function () { return testing_1.MockBackend; } });
Object.defineProperty(exports, "setupTestObservability", { enumerable: true, get: function () { return testing_1.setupTestObservability; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7R0FnQkc7Ozs7QUFFSCw4QkFBb0M7QUFDcEMscUNBQXFEO0FBRXJELDhFQUE4RTtBQUM5RSxnRkFBZ0Y7QUFDaEYsOEVBQThFO0FBRTlFLGdCQUFXLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDO0lBQ3RDLE9BQU8sRUFBRSxlQUFlO0lBQ3hCLFNBQVMsRUFBRSxJQUFBLGtDQUF5QixHQUFFLEVBQUUsc0RBQXNEO0lBQzlGLFFBQVEsRUFBRSxDQUFDO0NBQ1osQ0FBQyxDQUFDO0FBRUgsOEVBQThFO0FBQzlFLFVBQVU7QUFDViw4RUFBOEU7QUFFOUUscUJBQXFCO0FBQ3JCLGlDQVNpQjtBQVBDLDhHQUFBLHFCQUFxQixPQUFBO0FBSWIsMkdBQUEsa0JBQWtCLE9BQUE7QUFLNUMsdUJBQXVCO0FBQ3ZCLHFDQUE4RTtBQUFyRSwrR0FBQSxvQkFBb0IsT0FBQTtBQUFFLG1HQUFBLFFBQVEsT0FBQTtBQUFFLDRHQUFBLGlCQUFpQixPQUFBO0FBRTFELHdCQUF3QjtBQUN4QixtQ0FFa0I7QUFEaEIseUdBQUEsZUFBZSxPQUFBO0FBQUUsbUhBQUEseUJBQXlCLE9BQUE7QUFBNEIsd0dBQUEsY0FBYyxPQUFBO0FBQUUsd0dBQUEsY0FBYyxPQUFBO0FBR3RHLGtCQUFrQjtBQUNsQixxQ0FFbUI7QUFEakIsOEhBQUEseUJBQXlCLE9BQXVDO0FBQUUsc0dBQUEsV0FBVyxPQUFBO0FBQUUsNEdBQUEsaUJBQWlCLE9BQUE7QUFBRSxvR0FBQSxTQUFTLE9BQUE7QUFBRSx3R0FBQSxhQUFhLE9BQUE7QUFBRSwyR0FBQSxnQkFBZ0IsT0FBQTtBQUc5SSxrQkFBa0I7QUFDbEIscUNBS21CO0FBSmpCLGtHQUFBLE9BQU8sT0FBQTtBQUFFLG1IQUFBLHdCQUF3QixPQUFB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SXpCLGtCQUFrQjtBQUNsQixxQ0FBaVA7QUFBeE8sOEdBQUEsbUJBQW1CLE9BQUE7QUFBRSwyR0FBQSxnQkFBZ0IsT0FBQTtBQUFFLGdIQUFBLHFCQUFxQixPQUFBO0FBQUUsbUhBQUEsd0JBQXdCLE9BQUE7QUFBRSwwR0FBQSxlQUFlLE9BQUE7QUFBRSw0R0FBQSxpQkFBaUIsT0FBQTtBQUFFLGdIQUFBLHFCQUFxQixPQUFBO0FBQUUsdUhBQUEsNEJBQTRCLE9BQUE7QUFBRSxzR0FBQSxXQUFXLE9BQUE7QUFBRSxpSEFBQSxzQkFBc0IsT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRlcyNCBPYnNlcnZhYmlsaXR5IFN5c3RlbVxuICogXG4gKiBVbmlmaWVkIG9ic2VydmFiaWxpdHkgZm9yIGxvZ2dpbmcsIG1ldHJpY3MsIHRyYWNlcywgYW5kIGF1ZGl0cy5cbiAqIFxuICogIyMgUXVpY2sgU3RhcnRcbiAqIFxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQ29udGV4dCBpcyBhdXRvLWVzdGFibGlzaGVkIGluIGNvbnRyb2xsZXJzXG4gKiAvLyBBY2Nlc3MgdmlhIGN0eC5leGVjdXRpb25Db250ZXh0IG9yIGdldEN1cnJlbnRDb250ZXh0KClcbiAqIFxuICogY29uc3Qgc3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydCgncHJvY2Vzc09yZGVyJyk7XG4gKiBBdWRpdE9ic2VydmVyLmVudGl0eUNyZWF0ZSgnT3JkZXInLCBvcmRlcklkLCBkYXRhKTtcbiAqIE1ldHJpY09ic2VydmVyLmluY3JlbWVudCgnb3JkZXJzLmNyZWF0ZWQnKTtcbiAqIHNwYW4uZW5kKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vZGknO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJy4vY29uZmlnJztcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBSRUdJU1RFUiBERUZBVUxUIENPTkZJRyAocHJpb3JpdHkgMCAtIGFwcHMgY2FuIG92ZXJyaWRlIHdpdGggaGlnaGVyIHByaW9yaXR5KVxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbkRJQ29udGFpbmVyLlJPT1QucmVnaXN0ZXJDb25maWdQcm92aWRlcih7XG4gIHByb3ZpZGU6ICdvYnNlcnZhYmlsaXR5JyxcbiAgdXNlQ29uZmlnOiBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKCksIC8vIEZhY3RvcnkgcmV0dXJucyBjb21wbGV0ZSB0eXBlZCBjb25maWcgd2l0aCBkZWZhdWx0c1xuICBwcmlvcml0eTogMFxufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gRVhQT1JUU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8vID09PSBDT1JFIFRZUEVTID09PVxuZXhwb3J0IHtcbiAgQmFzZUV2ZW50VHlwZSwgQ2FwdHVyZUlucHV0LFxuICBDYXB0dXJlT3B0aW9ucywgRGVmYXVsdFNhbXBsaW5nQ29uZmlnLCBJRXZlbnRDYXB0dXJlLFxuICBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgT2JzZXJ2YWJpbGl0eUJhY2tlbmRDb25maWcsXG4gIE9ic2VydmFiaWxpdHlDb25maWcsIE9ic2VydmFiaWxpdHlEYXRhUHJvdGVjdGlvbkNvbmZpZywgT2JzZXJ2YWJpbGl0eUVycm9yLCBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlFdmVudFR5cGUsIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLCBTYW1wbGluZ0NvbmZpZyxcbiAgVHlwZVNwZWNpZmljQ29uZmlnXG59IGZyb20gJy4vdHlwZXMnO1xuXG4vLyA9PT0gQ09SRSBNQU5BR0VSID09PVxuZXhwb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIsIE9ic2VydmVyLCB3aXRoT2JzZXJ2YWJpbGl0eSB9IGZyb20gJy4vbWFuYWdlcic7XG5cbi8vID09PSBDT05GSUdVUkFUSU9OID09PVxuZXhwb3J0IHtcbiAgQ09ORklHX0RFRkFVTFRTLCBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnLCBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQsIFZBTElEX0JBQ0tFTkRTLCB2YWxpZGF0ZUNvbmZpZywgVmFsaWRCYWNrZW5kXG59IGZyb20gJy4vY29uZmlnJztcblxuLy8gPT09IFBSRVNFVFMgPT09XG5leHBvcnQge1xuICBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIGFzIGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWdGcm9tUHJlc2V0LCBkZWJ1Z1ByZXNldCwgZGV2ZWxvcG1lbnRQcmVzZXQsIGdldFByZXNldCwgbWluaW1hbFByZXNldCwgcHJvZHVjdGlvblByZXNldCwgdHlwZSBPYnNlcnZhYmlsaXR5UHJlc2V0XG59IGZyb20gJy4vcHJlc2V0cyc7XG5cbi8vID09PSBDT05URVhUID09PVxuZXhwb3J0IHtcbiAgYWRkVGFncywgY3JlYXRlRXZlbnRCcmlkZ2VDb250ZXh0LCBjcmVhdGVFeGVjdXRpb25Db250ZXh0LCBjcmVhdGVIdHRwSGVhZGVycywgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0LCBjcmVhdGVTbnNBdHRyaWJ1dGVzLCBjcmVhdGVTcXNBdHRyaWJ1dGVzLCBjcmVhdGVTdGVwRnVuY3Rpb25zQ29udGV4dCwgZW5yaWNoQWN0b3IsIGV4dHJhY3RGcm9tRXZlbnRCcmlkZ2UsIGV4dHJhY3RGcm9tSGVhZGVycywgZXh0cmFjdEZyb21LaW5lc2lzLCBleHRyYWN0RnJvbVNucywgZXh0cmFjdEZyb21TcXMsIGV4dHJhY3RGcm9tU3RlcEZ1bmN0aW9ucywgZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzLCBnZXRDdXJyZW50Q29udGV4dCwgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQsIHJ1bldpdGhDb250ZXh0LFxuICBydW5XaXRoQ29udGV4dFN5bmMsIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMsIHNldEFjdG9yLCBzZXRBdHRyaWJ1dGUsXG4gIHNldEF0dHJpYnV0ZXMsIHNldFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCwgc2V0U291cmNlLCB0b1czQ1BhcmVudElkLCB0b1czQ1RyYWNlSWQsIHR5cGUgQWN0b3IsIHR5cGUgQ3JlYXRlRXhlY3V0aW9uQ29udGV4dE9wdGlvbnMsIHR5cGUgRXhlY3V0aW9uQ29udGV4dERhdGEsIHR5cGUgT2JzZXJ2YXRpb25Db250ZXh0LCB0eXBlIFBhcnNlZFRyYWNlQ29udGV4dFxufSBmcm9tICcuL2NvbnRleHQnO1xuXG4vLyA9PT0gQ09SRSBPQlNFUlZFUlMgPT09XG5leHBvcnQge1xuICAvLyBCYXNlIHR5cGVzXG4gIE9ic2VydmFiaWxpdHlQYXlsb2FkLFxuICBCYXNlT2JzZXJ2ZXJPcHRpb25zLFxuICBDb21tb25GaWVsZHMsXG4gIC8vIEF1ZGl0XG4gIEF1ZGl0T2JzZXJ2ZXIsXG4gIEF1ZGl0T2JzZXJ2ZXJPcHRpb25zLFxuICBBdWRpdFJlY29yZE9wdGlvbnMsXG4gIENvbXBsaWFuY2VBdWRpdE9wdGlvbnMsXG4gIEFjY2Vzc0F1ZGl0T3B0aW9ucyxcbiAgLy8gTG9nXG4gIExvZ09ic2VydmVyLFxuICBMb2dPcHRpb25zLFxuICBDaGlsZExvZ09ic2VydmVyLFxuICAvLyBNZXRyaWNcbiAgTWV0cmljT2JzZXJ2ZXIsXG4gIE1ldHJpY09wdGlvbnMsXG4gIC8vIFNwYW5cbiAgU3Bhbk9ic2VydmVyLFxuICBTcGFuT3B0aW9ucyxcbiAgU3BhbkV2ZW50T3B0aW9ucyxcbiAgU3BhbkVuZE9wdGlvbnMsXG4gIElTcGFuT2JzZXJ2ZXIsXG4gIHdpdGhTcGFuXG59IGZyb20gJy4vb2JzZXJ2ZXJzJztcblxuLy8gPT09IEJBQ0tFTkRTIChESS1tYW5hZ2VkLCBleHBvcnRlZCBmb3IgdHlwZSByZWZlcmVuY2VzKSA9PT1cbmV4cG9ydCB7IENsb3VkV2F0Y2hCYWNrZW5kIH0gZnJvbSAnLi9iYWNrZW5kcy9jbG91ZHdhdGNoJztcbmV4cG9ydCB7IER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQgfSBmcm9tICcuL2JhY2tlbmRzL2R5bmFtb2RiJztcbmV4cG9ydCB7IE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZCB9IGZyb20gJy4vYmFja2VuZHMvb3RlbCc7XG5cbi8vID09PSBVVElMSVRJRVMgPT09XG5leHBvcnQgeyBjbGVhclJlZGFjdG9yQ2FjaGUsIERhdGFQcm90ZWN0aW9uQ29uZmlnLCBERUZBVUxUX0JMQUNLTElTVEVEX0tFWVMsIERFRkFVTFRfUFJPVEVDVEVEX0ZJRUxEUywgZXh0ZW5kQmxhY2tsaXN0LCByZWRhY3RTZW5zaXRpdmVEYXRhLCBzaG91bGRSZWRhY3RLZXkgfSBmcm9tICcuL3V0aWxzL2RhdGEtcHJvdGVjdGlvbic7XG5leHBvcnQgeyBnZW5lcmF0ZVNwYW5JZCwgZ2VuZXJhdGVUcmFjZUlkIH0gZnJvbSAnLi91dGlscy9pZC1nZW5lcmF0b3InO1xuZXhwb3J0IHsgbGV2ZWxUb1Bvd2VydG9vbHNMb2dMZXZlbCwgbGV2ZWxUb1N0cmluZywgc3RyaW5nVG9MZXZlbCB9IGZyb20gJy4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuZXhwb3J0IHsgZXN0aW1hdGVJdGVtU2l6ZSwgaXNQYXlsb2FkV2l0aGluTGltaXRzLCBzYWZlU3RyaW5naWZ5LCB0cnVuY2F0ZVBheWxvYWQgfSBmcm9tICcuL3V0aWxzL3BheWxvYWQnO1xuZXhwb3J0IHsgY2xlYXJFbnZpcm9ubWVudFRhZ3NDYWNoZSwgY3JlYXRlQ29udHJvbGxlclNvdXJjZSwgY3JlYXRlUXVldWVTb3VyY2UsIGNyZWF0ZVNlcnZpY2VTb3VyY2UsIGNyZWF0ZVRhc2tTb3VyY2UsIGRldGVjdFNvdXJjZSwgZ2V0RW52aXJvbm1lbnRUYWdzLCBtZXJnZVRhZ3MgfSBmcm9tICcuL3V0aWxzL3NvdXJjZS11dGlscyc7XG5cbi8vID09PSBERUNPUkFUT1JTID09PVxuZXhwb3J0IHsgQXVkaXRlZCwgQXVkaXRlZE9wdGlvbnMsIE9ic2VydmVkLCBPYnNlcnZlZE9wdGlvbnMsIFRyYWNlZCwgVHJhY2VkT3B0aW9ucyB9IGZyb20gJy4vZGVjb3JhdG9ycyc7XG5cbi8vID09PSBDUlVEIEhPT0tTID09PVxuZXhwb3J0IHsgQ3J1ZE9ic2VydmFiaWxpdHlDb250ZXh0LCBDcnVkT2JzZXJ2YWJpbGl0eUhvb2tzIH0gZnJvbSAnLi9jcnVkLWhvb2tzJztcblxuLy8gPT09IENPTlRST0xMRVIgQ09ORklHID09PVxuZXhwb3J0IHsgbWVyZ2VPYnNlcnZhYmlsaXR5Q29uZmlncyB9IGZyb20gJy4vY29udHJvbGxlci1jb25maWcnO1xuZXhwb3J0IHR5cGUgeyBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZywgT2JzZXJ2YWJpbGl0eUluY2x1ZGVzQ29uZmlnLCBTcGFuTWV0YWRhdGEgfSBmcm9tICcuL2NvbnRyb2xsZXItY29uZmlnJztcblxuLy8gPT09IFNUT1JBR0UgKEVudGl0eSwgU2VydmljZSkgPT09XG4vLyBGb3IgYWRtaW4gVUlzLCBleHRlbmQgQmFzZUVudGl0eUNvbnRyb2xsZXI8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT4gZGlyZWN0bHlcbmV4cG9ydCB7XG4gIE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEsXG4gIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlXG59IGZyb20gJy4vc3RvcmFnZSc7XG5leHBvcnQgdHlwZSB7IExvZ1JlY29yZCwgT2JzZXJ2YWJpbGl0eUxvZ0NyZWF0ZUl0ZW0sIE9ic2VydmFiaWxpdHlMb2dTY2hlbWEsIFJlY29uc3RydWN0ZWRTcGFuIH0gZnJvbSAnLi9zdG9yYWdlJztcblxuLy8gPT09IFRFU1RJTkcgPT09XG5leHBvcnQgeyBhc3NlcnRFdmVudENhcHR1cmVkLCBhc3NlcnRFdmVudENvdW50LCBhc3NlcnROb0V2ZW50Q2FwdHVyZWQsIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSwgY3JlYXRlVGVzdEFjdG9yLCBjcmVhdGVUZXN0Q29udGV4dCwgY3JlYXRlVGVzdENvbnRleHRTeW5jLCBjcmVhdGVUZXN0T2JzZXJ2YXRpb25Db250ZXh0LCBNb2NrQmFja2VuZCwgc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSB9IGZyb20gJy4vdGVzdGluZyc7XG4iXX0=