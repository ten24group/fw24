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
exports.LogObserver = exports.MetricObserver = exports.AuditObserver = exports.withSpan = exports.SpanObserver = exports.runWithContextSync = exports.runWithContext = exports.createObservationContext = exports.getCorrelationIdIfExists = exports.getCurrentContext = exports.toW3CParentId = exports.toW3CTraceId = exports.createStepFunctionsContext = exports.createEventBridgeContext = exports.createSnsAttributes = exports.createSqsAttributes = exports.createHttpHeaders = exports.extractFromDynamoDBStream = exports.extractFromKinesis = exports.extractFromStepFunctions = exports.extractFromEventBridge = exports.extractFromSns = exports.extractFromSqs = exports.extractFromHeaders = exports.setParentObservabilityLogId = exports.setSource = exports.setAttributes = exports.setAttribute = exports.addTags = exports.enrichActor = exports.setActor = exports.getCurrentExecutionContext = exports.runWithExecutionContextSync = exports.runWithExecutionContext = exports.createExecutionContext = exports.minimalPreset = exports.debugPreset = exports.developmentPreset = exports.productionPreset = exports.getPreset = exports.createObservabilityConfigFromPreset = exports.VALID_BACKENDS = exports.CONFIG_DEFAULTS = exports.validateConfig = exports.createObservabilityConfig = exports.withObservability = exports.Observer = exports.ObservabilityManager = exports.DefaultSamplingConfig = exports.ObservabilityLevel = void 0;
exports.createTestObservationContext = exports.createTestActor = exports.assertEventCount = exports.assertNoEventCaptured = exports.assertEventCaptured = exports.createTestContextSync = exports.createTestContext = exports.cleanupTestObservability = exports.setupTestObservability = exports.MockBackend = exports.ObservabilityLogService = exports.ObservabilityLogEntitySchema = exports.mergeObservabilityConfigs = exports.captureMetric = exports.captureBusinessError = exports.captureBusinessEvent = exports.CrudObservabilityHooks = exports.ObservedClass = exports.Observed = exports.Audited = exports.Traced = exports.DEFAULT_PROTECTED_FIELDS = exports.DEFAULT_BLACKLISTED_KEYS = exports.clearRedactorCache = exports.extendBlacklist = exports.shouldRedactKey = exports.redactSensitiveData = exports.safeStringify = exports.isPayloadWithinLimits = exports.estimateItemSize = exports.truncatePayload = exports.clearEnvironmentTagsCache = exports.mergeTags = exports.getEnvironmentTags = exports.createTaskSource = exports.createQueueSource = exports.createServiceSource = exports.createControllerSource = exports.detectSource = exports.levelToPowertoolsLogLevel = exports.levelToString = exports.stringToLevel = exports.OTELObservabilityBackend = exports.DynamoDBObservabilityBackend = exports.CloudWatchBackend = exports.ChildLogObserver = void 0;
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
Object.defineProperty(exports, "ObservabilityLevel", { enumerable: true, get: function () { return types_1.ObservabilityLevel; } });
Object.defineProperty(exports, "DefaultSamplingConfig", { enumerable: true, get: function () { return types_1.DefaultSamplingConfig; } });
// === CORE MANAGER ===
var manager_1 = require("./manager");
Object.defineProperty(exports, "ObservabilityManager", { enumerable: true, get: function () { return manager_1.ObservabilityManager; } });
Object.defineProperty(exports, "Observer", { enumerable: true, get: function () { return manager_1.Observer; } });
Object.defineProperty(exports, "withObservability", { enumerable: true, get: function () { return manager_1.withObservability; } });
// === CONFIGURATION ===
var config_2 = require("./config");
Object.defineProperty(exports, "createObservabilityConfig", { enumerable: true, get: function () { return config_2.createObservabilityConfig; } });
Object.defineProperty(exports, "validateConfig", { enumerable: true, get: function () { return config_2.validateConfig; } });
Object.defineProperty(exports, "CONFIG_DEFAULTS", { enumerable: true, get: function () { return config_2.CONFIG_DEFAULTS; } });
Object.defineProperty(exports, "VALID_BACKENDS", { enumerable: true, get: function () { return config_2.VALID_BACKENDS; } });
// === PRESETS ===
var presets_1 = require("./presets");
Object.defineProperty(exports, "createObservabilityConfigFromPreset", { enumerable: true, get: function () { return presets_1.createObservabilityConfig; } });
Object.defineProperty(exports, "getPreset", { enumerable: true, get: function () { return presets_1.getPreset; } });
Object.defineProperty(exports, "productionPreset", { enumerable: true, get: function () { return presets_1.productionPreset; } });
Object.defineProperty(exports, "developmentPreset", { enumerable: true, get: function () { return presets_1.developmentPreset; } });
Object.defineProperty(exports, "debugPreset", { enumerable: true, get: function () { return presets_1.debugPreset; } });
Object.defineProperty(exports, "minimalPreset", { enumerable: true, get: function () { return presets_1.minimalPreset; } });
// === CONTEXT ===
var context_1 = require("./context");
Object.defineProperty(exports, "createExecutionContext", { enumerable: true, get: function () { return context_1.createExecutionContext; } });
Object.defineProperty(exports, "runWithExecutionContext", { enumerable: true, get: function () { return context_1.runWithExecutionContext; } });
Object.defineProperty(exports, "runWithExecutionContextSync", { enumerable: true, get: function () { return context_1.runWithExecutionContextSync; } });
Object.defineProperty(exports, "getCurrentExecutionContext", { enumerable: true, get: function () { return context_1.getCurrentExecutionContext; } });
Object.defineProperty(exports, "setActor", { enumerable: true, get: function () { return context_1.setActor; } });
Object.defineProperty(exports, "enrichActor", { enumerable: true, get: function () { return context_1.enrichActor; } });
Object.defineProperty(exports, "addTags", { enumerable: true, get: function () { return context_1.addTags; } });
Object.defineProperty(exports, "setAttribute", { enumerable: true, get: function () { return context_1.setAttribute; } });
Object.defineProperty(exports, "setAttributes", { enumerable: true, get: function () { return context_1.setAttributes; } });
Object.defineProperty(exports, "setSource", { enumerable: true, get: function () { return context_1.setSource; } });
Object.defineProperty(exports, "setParentObservabilityLogId", { enumerable: true, get: function () { return context_1.setParentObservabilityLogId; } });
Object.defineProperty(exports, "extractFromHeaders", { enumerable: true, get: function () { return context_1.extractFromHeaders; } });
Object.defineProperty(exports, "extractFromSqs", { enumerable: true, get: function () { return context_1.extractFromSqs; } });
Object.defineProperty(exports, "extractFromSns", { enumerable: true, get: function () { return context_1.extractFromSns; } });
Object.defineProperty(exports, "extractFromEventBridge", { enumerable: true, get: function () { return context_1.extractFromEventBridge; } });
Object.defineProperty(exports, "extractFromStepFunctions", { enumerable: true, get: function () { return context_1.extractFromStepFunctions; } });
Object.defineProperty(exports, "extractFromKinesis", { enumerable: true, get: function () { return context_1.extractFromKinesis; } });
Object.defineProperty(exports, "extractFromDynamoDBStream", { enumerable: true, get: function () { return context_1.extractFromDynamoDBStream; } });
Object.defineProperty(exports, "createHttpHeaders", { enumerable: true, get: function () { return context_1.createHttpHeaders; } });
Object.defineProperty(exports, "createSqsAttributes", { enumerable: true, get: function () { return context_1.createSqsAttributes; } });
Object.defineProperty(exports, "createSnsAttributes", { enumerable: true, get: function () { return context_1.createSnsAttributes; } });
Object.defineProperty(exports, "createEventBridgeContext", { enumerable: true, get: function () { return context_1.createEventBridgeContext; } });
Object.defineProperty(exports, "createStepFunctionsContext", { enumerable: true, get: function () { return context_1.createStepFunctionsContext; } });
Object.defineProperty(exports, "toW3CTraceId", { enumerable: true, get: function () { return context_1.toW3CTraceId; } });
Object.defineProperty(exports, "toW3CParentId", { enumerable: true, get: function () { return context_1.toW3CParentId; } });
Object.defineProperty(exports, "getCurrentContext", { enumerable: true, get: function () { return context_1.getCurrentContext; } });
Object.defineProperty(exports, "getCorrelationIdIfExists", { enumerable: true, get: function () { return context_1.getCorrelationIdIfExists; } });
Object.defineProperty(exports, "createObservationContext", { enumerable: true, get: function () { return context_1.createObservationContext; } });
Object.defineProperty(exports, "runWithContext", { enumerable: true, get: function () { return context_1.runWithContext; } });
Object.defineProperty(exports, "runWithContextSync", { enumerable: true, get: function () { return context_1.runWithContextSync; } });
// === CORE OBSERVERS ===
var observers_1 = require("./observers");
Object.defineProperty(exports, "SpanObserver", { enumerable: true, get: function () { return observers_1.SpanObserver; } });
Object.defineProperty(exports, "withSpan", { enumerable: true, get: function () { return observers_1.withSpan; } });
Object.defineProperty(exports, "AuditObserver", { enumerable: true, get: function () { return observers_1.AuditObserver; } });
Object.defineProperty(exports, "MetricObserver", { enumerable: true, get: function () { return observers_1.MetricObserver; } });
Object.defineProperty(exports, "LogObserver", { enumerable: true, get: function () { return observers_1.LogObserver; } });
Object.defineProperty(exports, "ChildLogObserver", { enumerable: true, get: function () { return observers_1.ChildLogObserver; } });
// === BACKENDS (DI-managed, exported for type references) ===
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
Object.defineProperty(exports, "clearEnvironmentTagsCache", { enumerable: true, get: function () { return source_utils_1.clearEnvironmentTagsCache; } });
var payload_1 = require("./utils/payload");
Object.defineProperty(exports, "truncatePayload", { enumerable: true, get: function () { return payload_1.truncatePayload; } });
Object.defineProperty(exports, "estimateItemSize", { enumerable: true, get: function () { return payload_1.estimateItemSize; } });
Object.defineProperty(exports, "isPayloadWithinLimits", { enumerable: true, get: function () { return payload_1.isPayloadWithinLimits; } });
Object.defineProperty(exports, "safeStringify", { enumerable: true, get: function () { return payload_1.safeStringify; } });
var data_protection_1 = require("./utils/data-protection");
Object.defineProperty(exports, "redactSensitiveData", { enumerable: true, get: function () { return data_protection_1.redactSensitiveData; } });
Object.defineProperty(exports, "shouldRedactKey", { enumerable: true, get: function () { return data_protection_1.shouldRedactKey; } });
Object.defineProperty(exports, "extendBlacklist", { enumerable: true, get: function () { return data_protection_1.extendBlacklist; } });
Object.defineProperty(exports, "clearRedactorCache", { enumerable: true, get: function () { return data_protection_1.clearRedactorCache; } });
Object.defineProperty(exports, "DEFAULT_BLACKLISTED_KEYS", { enumerable: true, get: function () { return data_protection_1.DEFAULT_BLACKLISTED_KEYS; } });
Object.defineProperty(exports, "DEFAULT_PROTECTED_FIELDS", { enumerable: true, get: function () { return data_protection_1.DEFAULT_PROTECTED_FIELDS; } });
// === DECORATORS ===
var decorators_1 = require("./decorators");
Object.defineProperty(exports, "Traced", { enumerable: true, get: function () { return decorators_1.Traced; } });
Object.defineProperty(exports, "Audited", { enumerable: true, get: function () { return decorators_1.Audited; } });
Object.defineProperty(exports, "Observed", { enumerable: true, get: function () { return decorators_1.Observed; } });
Object.defineProperty(exports, "ObservedClass", { enumerable: true, get: function () { return decorators_1.ObservedClass; } });
// === CRUD HOOKS ===
var crud_hooks_1 = require("./crud-hooks");
Object.defineProperty(exports, "CrudObservabilityHooks", { enumerable: true, get: function () { return crud_hooks_1.CrudObservabilityHooks; } });
// === APPLICATION HELPERS ===
var capture_1 = require("./helpers/capture");
Object.defineProperty(exports, "captureBusinessEvent", { enumerable: true, get: function () { return capture_1.captureBusinessEvent; } });
Object.defineProperty(exports, "captureBusinessError", { enumerable: true, get: function () { return capture_1.captureBusinessError; } });
Object.defineProperty(exports, "captureMetric", { enumerable: true, get: function () { return capture_1.captureMetric; } });
var controller_config_1 = require("./controller-config");
Object.defineProperty(exports, "mergeObservabilityConfigs", { enumerable: true, get: function () { return controller_config_1.mergeObservabilityConfigs; } });
// === STORAGE (Entity, Service) ===
// For admin UIs, extend BaseEntityController<ObservabilityLogSchema> directly
var storage_1 = require("./storage");
Object.defineProperty(exports, "ObservabilityLogEntitySchema", { enumerable: true, get: function () { return storage_1.ObservabilityLogEntitySchema; } });
Object.defineProperty(exports, "ObservabilityLogService", { enumerable: true, get: function () { return storage_1.ObservabilityLogService; } });
// === TESTING ===
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7R0FnQkc7Ozs7QUFFSCw4QkFBb0M7QUFDcEMscUNBQXFEO0FBRXJELDhFQUE4RTtBQUM5RSxnRkFBZ0Y7QUFDaEYsOEVBQThFO0FBRTlFLGdCQUFXLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDO0lBQ3RDLE9BQU8sRUFBRSxlQUFlO0lBQ3hCLFNBQVMsRUFBRSxJQUFBLGtDQUF5QixHQUFFLEVBQUUsc0RBQXNEO0lBQzlGLFFBQVEsRUFBRSxDQUFDO0NBQ1osQ0FBQyxDQUFDO0FBRUgsOEVBQThFO0FBQzlFLFVBQVU7QUFDViw4RUFBOEU7QUFFOUUscUJBQXFCO0FBQ3JCLGlDQWlCaUI7QUFoQmYsMkdBQUEsa0JBQWtCLE9BQUE7QUFjbEIsOEdBQUEscUJBQXFCLE9BQUE7QUFJdkIsdUJBQXVCO0FBQ3ZCLHFDQUE4RTtBQUFyRSwrR0FBQSxvQkFBb0IsT0FBQTtBQUFFLG1HQUFBLFFBQVEsT0FBQTtBQUFFLDRHQUFBLGlCQUFpQixPQUFBO0FBRTFELHdCQUF3QjtBQUN4QixtQ0FPa0I7QUFOaEIsbUhBQUEseUJBQXlCLE9BQUE7QUFDekIsd0dBQUEsY0FBYyxPQUFBO0FBQ2QseUdBQUEsZUFBZSxPQUFBO0FBQ2Ysd0dBQUEsY0FBYyxPQUFBO0FBS2hCLGtCQUFrQjtBQUNsQixxQ0FRbUI7QUFOakIsOEhBQUEseUJBQXlCLE9BQXVDO0FBQ2hFLG9HQUFBLFNBQVMsT0FBQTtBQUNULDJHQUFBLGdCQUFnQixPQUFBO0FBQ2hCLDRHQUFBLGlCQUFpQixPQUFBO0FBQ2pCLHNHQUFBLFdBQVcsT0FBQTtBQUNYLHdHQUFBLGFBQWEsT0FBQTtBQUdmLGtCQUFrQjtBQUNsQixxQ0FvQ21CO0FBOUJqQixpSEFBQSxzQkFBc0IsT0FBQTtBQUN0QixrSEFBQSx1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QUZqQix1SEFBQSw0QkFBNEIsT0FBQTtBQUM1QixrSEFBQSx1QkFBdUIsT0FBQTtBQUl6QixrQkFBa0I7QUFDbEIscUNBQWlQO0FBQXhPLHNHQUFBLFdBQVcsT0FBQTtBQUFFLGlIQUFBLHNCQUFzQixPQUFBO0FBQUUsbUhBQUEsd0JBQXdCLE9BQUE7QUFBRSw0R0FBQSxpQkFBaUIsT0FBQTtBQUFFLGdIQUFBLHFCQUFxQixPQUFBO0FBQUUsOEdBQUEsbUJBQW1CLE9BQUE7QUFBRSxnSEFBQSxxQkFBcUIsT0FBQTtBQUFFLDJHQUFBLGdCQUFnQixPQUFBO0FBQUUsMEdBQUEsZUFBZSxPQUFBO0FBQUUsdUhBQUEsNEJBQTRCLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEZXMjQgT2JzZXJ2YWJpbGl0eSBTeXN0ZW1cbiAqIFxuICogVW5pZmllZCBvYnNlcnZhYmlsaXR5IGZvciBsb2dnaW5nLCBtZXRyaWNzLCB0cmFjZXMsIGFuZCBhdWRpdHMuXG4gKiBcbiAqICMjIFF1aWNrIFN0YXJ0XG4gKiBcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIENvbnRleHQgaXMgYXV0by1lc3RhYmxpc2hlZCBpbiBjb250cm9sbGVyc1xuICogLy8gQWNjZXNzIHZpYSBjdHguZXhlY3V0aW9uQ29udGV4dCBvciBnZXRDdXJyZW50Q29udGV4dCgpXG4gKiBcbiAqIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ3Byb2Nlc3NPcmRlcicpO1xuICogQXVkaXRPYnNlcnZlci5lbnRpdHlDcmVhdGUoJ09yZGVyJywgb3JkZXJJZCwgZGF0YSk7XG4gKiBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoJ29yZGVycy5jcmVhdGVkJyk7XG4gKiBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpJztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuL2NvbmZpZyc7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUkVHSVNURVIgREVGQVVMVCBDT05GSUcgKHByaW9yaXR5IDAgLSBhcHBzIGNhbiBvdmVycmlkZSB3aXRoIGhpZ2hlciBwcmlvcml0eSlcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5ESUNvbnRhaW5lci5ST09ULnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICBwcm92aWRlOiAnb2JzZXJ2YWJpbGl0eScsXG4gIHVzZUNvbmZpZzogY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZygpLCAvLyBGYWN0b3J5IHJldHVybnMgY29tcGxldGUgdHlwZWQgY29uZmlnIHdpdGggZGVmYXVsdHNcbiAgcHJpb3JpdHk6IDBcbn0pO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIEVYUE9SVFNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vLyA9PT0gQ09SRSBUWVBFUyA9PT1cbmV4cG9ydCB7XG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlFdmVudFR5cGUsXG4gIEJhc2VFdmVudFR5cGUsXG4gIE9ic2VydmFiaWxpdHlFcnJvcixcbiAgQ2FwdHVyZUlucHV0LFxuICBDYXB0dXJlT3B0aW9ucyxcbiAgSUV2ZW50Q2FwdHVyZSxcbiAgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnLFxuICBPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICBTYW1wbGluZ0NvbmZpZyxcbiAgVHlwZVNwZWNpZmljQ29uZmlnLFxuICBEZWZhdWx0U2FtcGxpbmdDb25maWcsXG4gIE9ic2VydmFiaWxpdHlEYXRhUHJvdGVjdGlvbkNvbmZpZyxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbi8vID09PSBDT1JFIE1BTkFHRVIgPT09XG5leHBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciwgT2JzZXJ2ZXIsIHdpdGhPYnNlcnZhYmlsaXR5IH0gZnJvbSAnLi9tYW5hZ2VyJztcblxuLy8gPT09IENPTkZJR1VSQVRJT04gPT09XG5leHBvcnQge1xuICBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICB2YWxpZGF0ZUNvbmZpZyxcbiAgQ09ORklHX0RFRkFVTFRTLFxuICBWQUxJRF9CQUNLRU5EUyxcbiAgVmFsaWRCYWNrZW5kLFxuICBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQsXG59IGZyb20gJy4vY29uZmlnJztcblxuLy8gPT09IFBSRVNFVFMgPT09XG5leHBvcnQge1xuICB0eXBlIE9ic2VydmFiaWxpdHlQcmVzZXQsXG4gIGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgYXMgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZ0Zyb21QcmVzZXQsXG4gIGdldFByZXNldCxcbiAgcHJvZHVjdGlvblByZXNldCxcbiAgZGV2ZWxvcG1lbnRQcmVzZXQsXG4gIGRlYnVnUHJlc2V0LFxuICBtaW5pbWFsUHJlc2V0LFxufSBmcm9tICcuL3ByZXNldHMnO1xuXG4vLyA9PT0gQ09OVEVYVCA9PT1cbmV4cG9ydCB7XG4gIHR5cGUgRXhlY3V0aW9uQ29udGV4dERhdGEsXG4gIHR5cGUgQ3JlYXRlRXhlY3V0aW9uQ29udGV4dE9wdGlvbnMsXG4gIHR5cGUgUGFyc2VkVHJhY2VDb250ZXh0LFxuICB0eXBlIEFjdG9yLFxuICB0eXBlIE9ic2VydmF0aW9uQ29udGV4dCxcbiAgY3JlYXRlRXhlY3V0aW9uQ29udGV4dCxcbiAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0U3luYyxcbiAgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQsXG4gIHNldEFjdG9yLFxuICBlbnJpY2hBY3RvcixcbiAgYWRkVGFncyxcbiAgc2V0QXR0cmlidXRlLFxuICBzZXRBdHRyaWJ1dGVzLFxuICBzZXRTb3VyY2UsXG4gIHNldFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgZXh0cmFjdEZyb21IZWFkZXJzLFxuICBleHRyYWN0RnJvbVNxcyxcbiAgZXh0cmFjdEZyb21TbnMsXG4gIGV4dHJhY3RGcm9tRXZlbnRCcmlkZ2UsXG4gIGV4dHJhY3RGcm9tU3RlcEZ1bmN0aW9ucyxcbiAgZXh0cmFjdEZyb21LaW5lc2lzLFxuICBleHRyYWN0RnJvbUR5bmFtb0RCU3RyZWFtLFxuICBjcmVhdGVIdHRwSGVhZGVycyxcbiAgY3JlYXRlU3FzQXR0cmlidXRlcyxcbiAgY3JlYXRlU25zQXR0cmlidXRlcyxcbiAgY3JlYXRlRXZlbnRCcmlkZ2VDb250ZXh0LFxuICBjcmVhdGVTdGVwRnVuY3Rpb25zQ29udGV4dCxcbiAgdG9XM0NUcmFjZUlkLFxuICB0b1czQ1BhcmVudElkLFxuICBnZXRDdXJyZW50Q29udGV4dCxcbiAgZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzLFxuICBjcmVhdGVPYnNlcnZhdGlvbkNvbnRleHQsXG4gIHJ1bldpdGhDb250ZXh0LFxuICBydW5XaXRoQ29udGV4dFN5bmMsXG59IGZyb20gJy4vY29udGV4dCc7XG5cbi8vID09PSBDT1JFIE9CU0VSVkVSUyA9PT1cbmV4cG9ydCB7XG4gIFNwYW5PYnNlcnZlcixcbiAgSVNwYW5PYnNlcnZlcixcbiAgd2l0aFNwYW4sXG4gIFNwYW5PcHRpb25zLFxuICBBdWRpdE9ic2VydmVyLFxuICBBdWRpdE9ic2VydmVyT3B0aW9ucyxcbiAgTWV0cmljT2JzZXJ2ZXIsXG4gIE1ldHJpY09wdGlvbnMsXG4gIExvZ09ic2VydmVyLFxuICBMb2dPcHRpb25zLFxuICBDaGlsZExvZ09ic2VydmVyLFxufSBmcm9tICcuL29ic2VydmVycyc7XG5cbi8vID09PSBCQUNLRU5EUyAoREktbWFuYWdlZCwgZXhwb3J0ZWQgZm9yIHR5cGUgcmVmZXJlbmNlcykgPT09XG5leHBvcnQgeyBDbG91ZFdhdGNoQmFja2VuZCB9IGZyb20gJy4vYmFja2VuZHMvY2xvdWR3YXRjaCc7XG5leHBvcnQgeyBEeW5hbW9EQk9ic2VydmFiaWxpdHlCYWNrZW5kIH0gZnJvbSAnLi9iYWNrZW5kcy9keW5hbW9kYic7XG5leHBvcnQgeyBPVEVMT2JzZXJ2YWJpbGl0eUJhY2tlbmQgfSBmcm9tICcuL2JhY2tlbmRzL290ZWwnO1xuXG4vLyA9PT0gVVRJTElUSUVTID09PVxuZXhwb3J0IHsgc3RyaW5nVG9MZXZlbCwgbGV2ZWxUb1N0cmluZywgbGV2ZWxUb1Bvd2VydG9vbHNMb2dMZXZlbCB9IGZyb20gJy4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuZXhwb3J0IHsgZGV0ZWN0U291cmNlLCBjcmVhdGVDb250cm9sbGVyU291cmNlLCBjcmVhdGVTZXJ2aWNlU291cmNlLCBjcmVhdGVRdWV1ZVNvdXJjZSwgY3JlYXRlVGFza1NvdXJjZSwgZ2V0RW52aXJvbm1lbnRUYWdzLCBtZXJnZVRhZ3MsIGNsZWFyRW52aXJvbm1lbnRUYWdzQ2FjaGUgfSBmcm9tICcuL3V0aWxzL3NvdXJjZS11dGlscyc7XG5leHBvcnQgeyB0cnVuY2F0ZVBheWxvYWQsIGVzdGltYXRlSXRlbVNpemUsIGlzUGF5bG9hZFdpdGhpbkxpbWl0cywgc2FmZVN0cmluZ2lmeSB9IGZyb20gJy4vdXRpbHMvcGF5bG9hZCc7XG5leHBvcnQgeyByZWRhY3RTZW5zaXRpdmVEYXRhLCBzaG91bGRSZWRhY3RLZXksIGV4dGVuZEJsYWNrbGlzdCwgY2xlYXJSZWRhY3RvckNhY2hlLCBERUZBVUxUX0JMQUNLTElTVEVEX0tFWVMsIERFRkFVTFRfUFJPVEVDVEVEX0ZJRUxEUywgRGF0YVByb3RlY3Rpb25Db25maWcgfSBmcm9tICcuL3V0aWxzL2RhdGEtcHJvdGVjdGlvbic7XG5cbi8vID09PSBERUNPUkFUT1JTID09PVxuZXhwb3J0IHsgVHJhY2VkLCBUcmFjZWRPcHRpb25zLCBBdWRpdGVkLCBBdWRpdGVkT3B0aW9ucywgT2JzZXJ2ZWQsIE9ic2VydmVkT3B0aW9ucywgT2JzZXJ2ZWRDbGFzcywgT2JzZXJ2ZWRDbGFzc09wdGlvbnMgfSBmcm9tICcuL2RlY29yYXRvcnMnO1xuXG4vLyA9PT0gQ1JVRCBIT09LUyA9PT1cbmV4cG9ydCB7IENydWRPYnNlcnZhYmlsaXR5SG9va3MsIENydWRPYnNlcnZhYmlsaXR5Q29udGV4dCB9IGZyb20gJy4vY3J1ZC1ob29rcyc7XG5cbi8vID09PSBBUFBMSUNBVElPTiBIRUxQRVJTID09PVxuZXhwb3J0IHsgY2FwdHVyZUJ1c2luZXNzRXZlbnQsIGNhcHR1cmVCdXNpbmVzc0Vycm9yLCBjYXB0dXJlTWV0cmljLCBDYXB0dXJlRXZlbnRPcHRpb25zIH0gZnJvbSAnLi9oZWxwZXJzL2NhcHR1cmUnO1xuXG4vLyA9PT0gQ09OVFJPTExFUiBDT05GSUcgPT09XG5leHBvcnQgdHlwZSB7IFNwYW5NZXRhZGF0YSwgQ29udHJvbGxlck9ic2VydmFiaWxpdHlDb25maWcsIE9ic2VydmFiaWxpdHlJbmNsdWRlc0NvbmZpZyB9IGZyb20gJy4vY29udHJvbGxlci1jb25maWcnO1xuZXhwb3J0IHsgbWVyZ2VPYnNlcnZhYmlsaXR5Q29uZmlncyB9IGZyb20gJy4vY29udHJvbGxlci1jb25maWcnO1xuXG4vLyA9PT0gU1RPUkFHRSAoRW50aXR5LCBTZXJ2aWNlKSA9PT1cbi8vIEZvciBhZG1pbiBVSXMsIGV4dGVuZCBCYXNlRW50aXR5Q29udHJvbGxlcjxPYnNlcnZhYmlsaXR5TG9nU2NoZW1hPiBkaXJlY3RseVxuZXhwb3J0IHtcbiAgT2JzZXJ2YWJpbGl0eUxvZ0VudGl0eVNjaGVtYSxcbiAgT2JzZXJ2YWJpbGl0eUxvZ1NlcnZpY2UsXG59IGZyb20gJy4vc3RvcmFnZSc7XG5leHBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlMb2dTY2hlbWEsIFJlY29uc3RydWN0ZWRTcGFuLCBMb2dSZWNvcmQsIE9ic2VydmFiaWxpdHlMb2dDcmVhdGVJdGVtIH0gZnJvbSAnLi9zdG9yYWdlJztcblxuLy8gPT09IFRFU1RJTkcgPT09XG5leHBvcnQgeyBNb2NrQmFja2VuZCwgc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSwgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5LCBjcmVhdGVUZXN0Q29udGV4dCwgY3JlYXRlVGVzdENvbnRleHRTeW5jLCBhc3NlcnRFdmVudENhcHR1cmVkLCBhc3NlcnROb0V2ZW50Q2FwdHVyZWQsIGFzc2VydEV2ZW50Q291bnQsIGNyZWF0ZVRlc3RBY3RvciwgY3JlYXRlVGVzdE9ic2VydmF0aW9uQ29udGV4dCB9IGZyb20gJy4vdGVzdGluZyc7XG4iXX0=