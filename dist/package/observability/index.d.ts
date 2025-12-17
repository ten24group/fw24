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
export { ObservabilityLevel, ObservabilityLevelString, ObservabilityEvent, ObservabilityEventType, BaseEventType, ObservabilityError, CaptureInput, CaptureOptions, IEventCapture, ObservabilityBackend, ObservabilityBackendConfig, ObservabilityConfig, SamplingConfig, TypeSpecificConfig, DefaultSamplingConfig, ObservabilityDataProtectionConfig, } from './types';
export { ObservabilityManager, Observer, withObservability } from './manager';
export { createObservabilityConfig, validateConfig, CONFIG_DEFAULTS, VALID_BACKENDS, ValidBackend, ObservabilityConfigInput, } from './config';
export { type ObservabilityPreset, createObservabilityConfig as createObservabilityConfigFromPreset, getPreset, productionPreset, developmentPreset, debugPreset, minimalPreset, } from './presets';
export { type ExecutionContextData, type CreateExecutionContextOptions, type ParsedTraceContext, type Actor, type ObservationContext, createExecutionContext, runWithExecutionContext, runWithExecutionContextSync, getCurrentExecutionContext, setActor, enrichActor, addTags, setAttribute, setAttributes, setSource, setParentObservabilityLogId, extractFromHeaders, extractFromSqs, extractFromSns, extractFromEventBridge, extractFromStepFunctions, extractFromKinesis, extractFromDynamoDBStream, createHttpHeaders, createSqsAttributes, createSnsAttributes, createEventBridgeContext, createStepFunctionsContext, toW3CTraceId, toW3CParentId, getCurrentContext, getCorrelationIdIfExists, createObservationContext, runWithContext, runWithContextSync, } from './context';
export { SpanObserver, ISpanObserver, withSpan, SpanOptions, AuditObserver, AuditObserverOptions, MetricObserver, MetricOptions, LogObserver, LogOptions, ChildLogObserver, } from './observers';
export { CloudWatchBackend } from './backends/cloudwatch';
export { DynamoDBObservabilityBackend } from './backends/dynamodb';
export { OTELObservabilityBackend } from './backends/otel';
export { stringToLevel, levelToString, levelToPowertoolsLogLevel } from './utils/level-utils';
export { detectSource, createControllerSource, createServiceSource, createQueueSource, createTaskSource, getEnvironmentTags, mergeTags, clearEnvironmentTagsCache } from './utils/source-utils';
export { truncatePayload, estimateItemSize, isPayloadWithinLimits, safeStringify } from './utils/payload';
export { redactSensitiveData, shouldRedactKey, extendBlacklist, clearRedactorCache, DEFAULT_BLACKLISTED_KEYS, DEFAULT_PROTECTED_FIELDS, DataProtectionConfig } from './utils/data-protection';
export { Traced, TracedOptions, Audited, AuditedOptions, Observed, ObservedOptions, ObservedClass, ObservedClassOptions } from './decorators';
export { CrudObservabilityHooks, CrudObservabilityContext } from './crud-hooks';
export { captureBusinessEvent, captureBusinessError, captureMetric, CaptureEventOptions } from './helpers/capture';
export type { SpanMetadata, ControllerObservabilityConfig, ObservabilityIncludesConfig } from './controller-config';
export { mergeObservabilityConfigs } from './controller-config';
export { ObservabilityLogEntitySchema, ObservabilityLogService, } from './storage';
export type { ObservabilityLogSchema, ReconstructedSpan, LogRecord, ObservabilityLogCreateItem } from './storage';
export { MockBackend, setupTestObservability, cleanupTestObservability, createTestContext, createTestContextSync, assertEventCaptured, assertNoEventCaptured, assertEventCount, createTestActor, createTestObservationContext } from './testing';
