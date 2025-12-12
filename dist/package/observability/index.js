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
exports.levelToString = exports.stringToLevel = exports.OTELObservabilityBackend = exports.DynamoDBObservabilityBackend = exports.CloudWatchBackend = exports.ChildLogObserver = exports.LogObserver = exports.MetricObserver = exports.AuditObserver = exports.withSpan = exports.SpanObserver = exports.runWithContextSync = exports.runWithContext = exports.createObservationContext = exports.getCorrelationIdIfExists = exports.getCurrentContext = exports.toW3CParentId = exports.toW3CTraceId = exports.createStepFunctionsContext = exports.createEventBridgeContext = exports.createSnsAttributes = exports.createSqsAttributes = exports.createHttpHeaders = exports.extractFromDynamoDBStream = exports.extractFromKinesis = exports.extractFromStepFunctions = exports.extractFromEventBridge = exports.extractFromSns = exports.extractFromSqs = exports.extractFromHeaders = exports.setParentObservabilityLogId = exports.setSource = exports.setAttributes = exports.setAttribute = exports.addTags = exports.enrichActor = exports.setActor = exports.getCurrentExecutionContext = exports.runWithExecutionContextSync = exports.runWithExecutionContext = exports.createExecutionContext = exports.VALID_BACKENDS = exports.CONFIG_DEFAULTS = exports.validateConfig = exports.createObservabilityConfig = exports.withObservability = exports.Observer = exports.ObservabilityManager = exports.DefaultSamplingConfig = exports.ObservabilityLevel = void 0;
exports.createTestObservationContext = exports.createTestActor = exports.assertEventCount = exports.assertNoEventCaptured = exports.assertEventCaptured = exports.createTestContextSync = exports.createTestContext = exports.cleanupTestObservability = exports.setupTestObservability = exports.MockBackend = exports.ObservabilityLogService = exports.ObservabilityLogEntitySchema = exports.mergeObservabilityConfigs = exports.captureMetric = exports.captureBusinessError = exports.captureBusinessEvent = exports.CrudObservabilityHooks = exports.ObservedClass = exports.Observed = exports.Audited = exports.Traced = exports.DEFAULT_PROTECTED_FIELDS = exports.DEFAULT_BLACKLISTED_KEYS = exports.clearRedactorCache = exports.extendBlacklist = exports.shouldRedactKey = exports.redactSensitiveData = exports.safeStringify = exports.isPayloadWithinLimits = exports.estimateItemSize = exports.truncatePayload = exports.clearEnvironmentTagsCache = exports.mergeTags = exports.getEnvironmentTags = exports.createTaskSource = exports.createQueueSource = exports.createServiceSource = exports.createControllerSource = exports.detectSource = exports.levelToPowertoolsLogLevel = void 0;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7R0FnQkc7Ozs7QUFFSCw4QkFBb0M7QUFDcEMscUNBQXFEO0FBRXJELDhFQUE4RTtBQUM5RSxnRkFBZ0Y7QUFDaEYsOEVBQThFO0FBRTlFLGdCQUFXLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDO0lBQ3RDLE9BQU8sRUFBRSxlQUFlO0lBQ3hCLFNBQVMsRUFBRSxJQUFBLGtDQUF5QixHQUFFLEVBQUUsc0RBQXNEO0lBQzlGLFFBQVEsRUFBRSxDQUFDO0NBQ1osQ0FBQyxDQUFDO0FBRUgsOEVBQThFO0FBQzlFLFVBQVU7QUFDViw4RUFBOEU7QUFFOUUscUJBQXFCO0FBQ3JCLGlDQWlCaUI7QUFoQmYsMkdBQUEsa0JBQWtCLE9BQUE7QUFjbEIsOEdBQUEscUJBQXFCLE9BQUE7QUFJdkIsdUJBQXVCO0FBQ3ZCLHFDQUE4RTtBQUFyRSwrR0FBQSxvQkFBb0IsT0FBQTtBQUFFLG1HQUFBLFFBQVEsT0FBQTtBQUFFLDRHQUFBLGlCQUFpQixPQUFBO0FBRTFELHdCQUF3QjtBQUN4QixtQ0FPa0I7QUFOaEIsbUhBQUEseUJBQXlCLE9BQUE7QUFDekIsd0dBQUEsY0FBYyxPQUFBO0FBQ2QseUdBQUEsZUFBZSxPQUFBO0FBQ2Ysd0dBQUEsY0FBYyxPQUFBO0FBS2hCLGtCQUFrQjtBQUNsQixxQ0FvQ21CO0FBOUJqQixpSEFBQSxzQkFBc0IsT0FBQTtBQUN0QixrSEFBQSx1QkFBdUIsT0FBQTtBQUN2QixzSEFBQSwyQkFBMkIsT0FBQTtBQUMzQixxSEFBQSwwQkFBMEIsT0FBQTtBQUMxQixtR0FBQSxRQUFRLE9BQUE7QUFDUixzR0FBQSxXQUFXLE9BQUE7QUFDWCxrR0FBQSxPQUFPLE9BQUE7QUFDUCx1R0FBQSxZQUFZLE9BQUE7QUFDWix3R0FBQSxhQUFhLE9BQUE7QUFDYixvR0FBQSxTQUFTLE9BQUE7QUFDVCxzSEFBQSwyQkFBMkIsT0FBQTtBQUMzQiw2R0FBQSxrQkFBa0IsT0FBQTtBQUNsQix5R0FBQSxjQUFjLE9BQUE7QUFDZCx5R0FBQSxjQUFjLE9BQUE7QUFDZCxpSEFBQSxzQkFBc0IsT0FBQTtBQUN0QixtSEFBQSx3QkFBd0IsT0FBQTtBQUN4Qiw2R0FBQSxrQkFBa0IsT0FBQTtBQUNsQixvSEFBQSx5QkFBeUIsT0FBQTtBQUN6Qiw0R0FBQSxpQkFBaUIsT0FBQTtBQUNqQiw4R0FBQSxtQkFBbUIsT0FBQTtBQUNuQiw4R0FBQSxtQkFBbUIsT0FBQTtBQUNuQixtSEFBQSx3QkFBd0IsT0FBQTtBQUN4QixxSEFBQSwwQkFBMEIsT0FBQTtBQUMxQix1R0FBQSxZQUFZLE9BQUE7QUFDWix3R0FBQSxhQUFhLE9BQUE7QUFDYiw0R0FBQSxpQkFBaUIsT0FBQTtBQUNqQixtSEFBQSx3QkFBd0IsT0FBQTtBQUN4QixtSEFBQSx3QkFBd0IsT0FBQTtBQUN4Qix5R0FBQSxjQUFjLE9BQUE7QUFDZCw2R0FBQSxrQkFBa0IsT0FBQTtBQUdwQix5QkFBeUI7QUFDekIseUNBWXFCO0FBWG5CLHlHQUFBLFlBQVksT0FBQTtBQUVaLHFHQUFBLFFBQVEsT0FBQTtBQUVSLDBHQUFBLGFBQWEsT0FBQTtBQUViLDJHQUFBLGNBQWMsT0FBQTtBQUVkLHdHQUFBLFdBQVcsT0FBQTtBQUVYLDZHQUFBLGdCQUFnQixPQUFBO0FBR2xCLDhEQUE4RDtBQUM5RCxvREFBMEQ7QUFBakQsK0dBQUEsaUJBQWlCLE9BQUE7QUFDMUIsZ0RBQW1FO0FBQTFELHdIQUFBLDRCQUE0QixPQUFBO0FBQ3JDLHdDQUEyRDtBQUFsRCxnSEFBQSx3QkFBd0IsT0FBQTtBQUVqQyxvQkFBb0I7QUFDcEIsbURBQThGO0FBQXJGLDRHQUFBLGFBQWEsT0FBQTtBQUFFLDRHQUFBLGFBQWEsT0FBQTtBQUFFLHdIQUFBLHlCQUF5QixPQUFBO0FBQ2hFLHFEQUFnTTtBQUF2TCw0R0FBQSxZQUFZLE9BQUE7QUFBRSxzSEFBQSxzQkFBc0IsT0FBQTtBQUFFLG1IQUFBLG1CQUFtQixPQUFBO0FBQUUsaUhBQUEsaUJBQWlCLE9BQUE7QUFBRSxnSEFBQSxnQkFBZ0IsT0FBQTtBQUFFLGtIQUFBLGtCQUFrQixPQUFBO0FBQUUseUdBQUEsU0FBUyxPQUFBO0FBQUUseUhBQUEseUJBQXlCLE9BQUE7QUFDakssMkNBQTBHO0FBQWpHLDBHQUFBLGVBQWUsT0FBQTtBQUFFLDJHQUFBLGdCQUFnQixPQUFBO0FBQUUsZ0hBQUEscUJBQXFCLE9BQUE7QUFBRSx3R0FBQSxhQUFhLE9BQUE7QUFDaEYsMkRBQThMO0FBQXJMLHNIQUFBLG1CQUFtQixPQUFBO0FBQUUsa0hBQUEsZUFBZSxPQUFBO0FBQUUsa0hBQUEsZUFBZSxPQUFBO0FBQUUscUhBQUEsa0JBQWtCLE9BQUE7QUFBRSwySEFBQSx3QkFBd0IsT0FBQTtBQUFFLDJIQUFBLHdCQUF3QixPQUFBO0FBRXRJLHFCQUFxQjtBQUNyQiwyQ0FBOEk7QUFBckksb0dBQUEsTUFBTSxPQUFBO0FBQWlCLHFHQUFBLE9BQU8sT0FBQTtBQUFrQixzR0FBQSxRQUFRLE9BQUE7QUFBbUIsMkdBQUEsYUFBYSxPQUFBO0FBRWpHLHFCQUFxQjtBQUNyQiwyQ0FBZ0Y7QUFBdkUsb0hBQUEsc0JBQXNCLE9BQUE7QUFFL0IsOEJBQThCO0FBQzlCLDZDQUFtSDtBQUExRywrR0FBQSxvQkFBb0IsT0FBQTtBQUFFLCtHQUFBLG9CQUFvQixPQUFBO0FBQUUsd0dBQUEsYUFBYSxPQUFBO0FBSWxFLHlEQUFnRTtBQUF2RCw4SEFBQSx5QkFBeUIsT0FBQTtBQUVsQyxvQ0FBb0M7QUFDcEMsOEVBQThFO0FBQzlFLHFDQUdtQjtBQUZqQix1SEFBQSw0QkFBNEIsT0FBQTtBQUM1QixrSEFBQSx1QkFBdUIsT0FBQTtBQUl6QixrQkFBa0I7QUFDbEIscUNBQWlQO0FBQXhPLHNHQUFBLFdBQVcsT0FBQTtBQUFFLGlIQUFBLHNCQUFzQixPQUFBO0FBQUUsbUhBQUEsd0JBQXdCLE9BQUE7QUFBRSw0R0FBQSxpQkFBaUIsT0FBQTtBQUFFLGdIQUFBLHFCQUFxQixPQUFBO0FBQUUsOEdBQUEsbUJBQW1CLE9BQUE7QUFBRSxnSEFBQSxxQkFBcUIsT0FBQTtBQUFFLDJHQUFBLGdCQUFnQixPQUFBO0FBQUUsMEdBQUEsZUFBZSxPQUFBO0FBQUUsdUhBQUEsNEJBQTRCLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEZXMjQgT2JzZXJ2YWJpbGl0eSBTeXN0ZW1cbiAqIFxuICogVW5pZmllZCBvYnNlcnZhYmlsaXR5IGZvciBsb2dnaW5nLCBtZXRyaWNzLCB0cmFjZXMsIGFuZCBhdWRpdHMuXG4gKiBcbiAqICMjIFF1aWNrIFN0YXJ0XG4gKiBcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIENvbnRleHQgaXMgYXV0by1lc3RhYmxpc2hlZCBpbiBjb250cm9sbGVyc1xuICogLy8gQWNjZXNzIHZpYSBjdHguZXhlY3V0aW9uQ29udGV4dCBvciBnZXRDdXJyZW50Q29udGV4dCgpXG4gKiBcbiAqIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ3Byb2Nlc3NPcmRlcicpO1xuICogQXVkaXRPYnNlcnZlci5lbnRpdHlDcmVhdGUoJ09yZGVyJywgb3JkZXJJZCwgZGF0YSk7XG4gKiBNZXRyaWNPYnNlcnZlci5pbmNyZW1lbnQoJ29yZGVycy5jcmVhdGVkJyk7XG4gKiBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpJztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuL2NvbmZpZyc7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUkVHSVNURVIgREVGQVVMVCBDT05GSUcgKHByaW9yaXR5IDAgLSBhcHBzIGNhbiBvdmVycmlkZSB3aXRoIGhpZ2hlciBwcmlvcml0eSlcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5ESUNvbnRhaW5lci5ST09ULnJlZ2lzdGVyQ29uZmlnUHJvdmlkZXIoe1xuICBwcm92aWRlOiAnb2JzZXJ2YWJpbGl0eScsXG4gIHVzZUNvbmZpZzogY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZygpLCAvLyBGYWN0b3J5IHJldHVybnMgY29tcGxldGUgdHlwZWQgY29uZmlnIHdpdGggZGVmYXVsdHNcbiAgcHJpb3JpdHk6IDBcbn0pO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIEVYUE9SVFNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vLyA9PT0gQ09SRSBUWVBFUyA9PT1cbmV4cG9ydCB7XG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlFdmVudFR5cGUsXG4gIEJhc2VFdmVudFR5cGUsXG4gIE9ic2VydmFiaWxpdHlFcnJvcixcbiAgQ2FwdHVyZUlucHV0LFxuICBDYXB0dXJlT3B0aW9ucyxcbiAgSUV2ZW50Q2FwdHVyZSxcbiAgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnLFxuICBPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICBTYW1wbGluZ0NvbmZpZyxcbiAgVHlwZVNwZWNpZmljQ29uZmlnLFxuICBEZWZhdWx0U2FtcGxpbmdDb25maWcsXG4gIE9ic2VydmFiaWxpdHlEYXRhUHJvdGVjdGlvbkNvbmZpZyxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbi8vID09PSBDT1JFIE1BTkFHRVIgPT09XG5leHBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciwgT2JzZXJ2ZXIsIHdpdGhPYnNlcnZhYmlsaXR5IH0gZnJvbSAnLi9tYW5hZ2VyJztcblxuLy8gPT09IENPTkZJR1VSQVRJT04gPT09XG5leHBvcnQge1xuICBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICB2YWxpZGF0ZUNvbmZpZyxcbiAgQ09ORklHX0RFRkFVTFRTLFxuICBWQUxJRF9CQUNLRU5EUyxcbiAgVmFsaWRCYWNrZW5kLFxuICBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQsXG59IGZyb20gJy4vY29uZmlnJztcblxuLy8gPT09IENPTlRFWFQgPT09XG5leHBvcnQge1xuICB0eXBlIEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICB0eXBlIENyZWF0ZUV4ZWN1dGlvbkNvbnRleHRPcHRpb25zLFxuICB0eXBlIFBhcnNlZFRyYWNlQ29udGV4dCxcbiAgdHlwZSBBY3RvcixcbiAgdHlwZSBPYnNlcnZhdGlvbkNvbnRleHQsXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMsXG4gIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0LFxuICBzZXRBY3RvcixcbiAgZW5yaWNoQWN0b3IsXG4gIGFkZFRhZ3MsXG4gIHNldEF0dHJpYnV0ZSxcbiAgc2V0QXR0cmlidXRlcyxcbiAgc2V0U291cmNlLFxuICBzZXRQYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gIGV4dHJhY3RGcm9tSGVhZGVycyxcbiAgZXh0cmFjdEZyb21TcXMsXG4gIGV4dHJhY3RGcm9tU25zLFxuICBleHRyYWN0RnJvbUV2ZW50QnJpZGdlLFxuICBleHRyYWN0RnJvbVN0ZXBGdW5jdGlvbnMsXG4gIGV4dHJhY3RGcm9tS2luZXNpcyxcbiAgZXh0cmFjdEZyb21EeW5hbW9EQlN0cmVhbSxcbiAgY3JlYXRlSHR0cEhlYWRlcnMsXG4gIGNyZWF0ZVNxc0F0dHJpYnV0ZXMsXG4gIGNyZWF0ZVNuc0F0dHJpYnV0ZXMsXG4gIGNyZWF0ZUV2ZW50QnJpZGdlQ29udGV4dCxcbiAgY3JlYXRlU3RlcEZ1bmN0aW9uc0NvbnRleHQsXG4gIHRvVzNDVHJhY2VJZCxcbiAgdG9XM0NQYXJlbnRJZCxcbiAgZ2V0Q3VycmVudENvbnRleHQsXG4gIGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cyxcbiAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0LFxuICBydW5XaXRoQ29udGV4dCxcbiAgcnVuV2l0aENvbnRleHRTeW5jLFxufSBmcm9tICcuL2NvbnRleHQnO1xuXG4vLyA9PT0gQ09SRSBPQlNFUlZFUlMgPT09XG5leHBvcnQge1xuICBTcGFuT2JzZXJ2ZXIsXG4gIElTcGFuT2JzZXJ2ZXIsXG4gIHdpdGhTcGFuLFxuICBTcGFuT3B0aW9ucyxcbiAgQXVkaXRPYnNlcnZlcixcbiAgQXVkaXRPYnNlcnZlck9wdGlvbnMsXG4gIE1ldHJpY09ic2VydmVyLFxuICBNZXRyaWNPcHRpb25zLFxuICBMb2dPYnNlcnZlcixcbiAgTG9nT3B0aW9ucyxcbiAgQ2hpbGRMb2dPYnNlcnZlcixcbn0gZnJvbSAnLi9vYnNlcnZlcnMnO1xuXG4vLyA9PT0gQkFDS0VORFMgKERJLW1hbmFnZWQsIGV4cG9ydGVkIGZvciB0eXBlIHJlZmVyZW5jZXMpID09PVxuZXhwb3J0IHsgQ2xvdWRXYXRjaEJhY2tlbmQgfSBmcm9tICcuL2JhY2tlbmRzL2Nsb3Vkd2F0Y2gnO1xuZXhwb3J0IHsgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCB9IGZyb20gJy4vYmFja2VuZHMvZHluYW1vZGInO1xuZXhwb3J0IHsgT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kIH0gZnJvbSAnLi9iYWNrZW5kcy9vdGVsJztcblxuLy8gPT09IFVUSUxJVElFUyA9PT1cbmV4cG9ydCB7IHN0cmluZ1RvTGV2ZWwsIGxldmVsVG9TdHJpbmcsIGxldmVsVG9Qb3dlcnRvb2xzTG9nTGV2ZWwgfSBmcm9tICcuL3V0aWxzL2xldmVsLXV0aWxzJztcbmV4cG9ydCB7IGRldGVjdFNvdXJjZSwgY3JlYXRlQ29udHJvbGxlclNvdXJjZSwgY3JlYXRlU2VydmljZVNvdXJjZSwgY3JlYXRlUXVldWVTb3VyY2UsIGNyZWF0ZVRhc2tTb3VyY2UsIGdldEVudmlyb25tZW50VGFncywgbWVyZ2VUYWdzLCBjbGVhckVudmlyb25tZW50VGFnc0NhY2hlIH0gZnJvbSAnLi91dGlscy9zb3VyY2UtdXRpbHMnO1xuZXhwb3J0IHsgdHJ1bmNhdGVQYXlsb2FkLCBlc3RpbWF0ZUl0ZW1TaXplLCBpc1BheWxvYWRXaXRoaW5MaW1pdHMsIHNhZmVTdHJpbmdpZnkgfSBmcm9tICcuL3V0aWxzL3BheWxvYWQnO1xuZXhwb3J0IHsgcmVkYWN0U2Vuc2l0aXZlRGF0YSwgc2hvdWxkUmVkYWN0S2V5LCBleHRlbmRCbGFja2xpc3QsIGNsZWFyUmVkYWN0b3JDYWNoZSwgREVGQVVMVF9CTEFDS0xJU1RFRF9LRVlTLCBERUZBVUxUX1BST1RFQ1RFRF9GSUVMRFMsIERhdGFQcm90ZWN0aW9uQ29uZmlnIH0gZnJvbSAnLi91dGlscy9kYXRhLXByb3RlY3Rpb24nO1xuXG4vLyA9PT0gREVDT1JBVE9SUyA9PT1cbmV4cG9ydCB7IFRyYWNlZCwgVHJhY2VkT3B0aW9ucywgQXVkaXRlZCwgQXVkaXRlZE9wdGlvbnMsIE9ic2VydmVkLCBPYnNlcnZlZE9wdGlvbnMsIE9ic2VydmVkQ2xhc3MsIE9ic2VydmVkQ2xhc3NPcHRpb25zIH0gZnJvbSAnLi9kZWNvcmF0b3JzJztcblxuLy8gPT09IENSVUQgSE9PS1MgPT09XG5leHBvcnQgeyBDcnVkT2JzZXJ2YWJpbGl0eUhvb2tzLCBDcnVkT2JzZXJ2YWJpbGl0eUNvbnRleHQgfSBmcm9tICcuL2NydWQtaG9va3MnO1xuXG4vLyA9PT0gQVBQTElDQVRJT04gSEVMUEVSUyA9PT1cbmV4cG9ydCB7IGNhcHR1cmVCdXNpbmVzc0V2ZW50LCBjYXB0dXJlQnVzaW5lc3NFcnJvciwgY2FwdHVyZU1ldHJpYywgQ2FwdHVyZUV2ZW50T3B0aW9ucyB9IGZyb20gJy4vaGVscGVycy9jYXB0dXJlJztcblxuLy8gPT09IENPTlRST0xMRVIgQ09ORklHID09PVxuZXhwb3J0IHR5cGUgeyBTcGFuTWV0YWRhdGEsIENvbnRyb2xsZXJPYnNlcnZhYmlsaXR5Q29uZmlnLCBPYnNlcnZhYmlsaXR5SW5jbHVkZXNDb25maWcgfSBmcm9tICcuL2NvbnRyb2xsZXItY29uZmlnJztcbmV4cG9ydCB7IG1lcmdlT2JzZXJ2YWJpbGl0eUNvbmZpZ3MgfSBmcm9tICcuL2NvbnRyb2xsZXItY29uZmlnJztcblxuLy8gPT09IFNUT1JBR0UgKEVudGl0eSwgU2VydmljZSkgPT09XG4vLyBGb3IgYWRtaW4gVUlzLCBleHRlbmQgQmFzZUVudGl0eUNvbnRyb2xsZXI8T2JzZXJ2YWJpbGl0eUxvZ1NjaGVtYT4gZGlyZWN0bHlcbmV4cG9ydCB7XG4gIE9ic2VydmFiaWxpdHlMb2dFbnRpdHlTY2hlbWEsXG4gIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlLFxufSBmcm9tICcuL3N0b3JhZ2UnO1xuZXhwb3J0IHR5cGUgeyBPYnNlcnZhYmlsaXR5TG9nU2NoZW1hLCBSZWNvbnN0cnVjdGVkU3BhbiwgTG9nUmVjb3JkLCBPYnNlcnZhYmlsaXR5TG9nQ3JlYXRlSXRlbSB9IGZyb20gJy4vc3RvcmFnZSc7XG5cbi8vID09PSBURVNUSU5HID09PVxuZXhwb3J0IHsgTW9ja0JhY2tlbmQsIHNldHVwVGVzdE9ic2VydmFiaWxpdHksIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSwgY3JlYXRlVGVzdENvbnRleHQsIGNyZWF0ZVRlc3RDb250ZXh0U3luYywgYXNzZXJ0RXZlbnRDYXB0dXJlZCwgYXNzZXJ0Tm9FdmVudENhcHR1cmVkLCBhc3NlcnRFdmVudENvdW50LCBjcmVhdGVUZXN0QWN0b3IsIGNyZWF0ZVRlc3RPYnNlcnZhdGlvbkNvbnRleHQgfSBmcm9tICcuL3Rlc3RpbmcnO1xuIl19