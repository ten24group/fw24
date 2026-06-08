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
export { type BaseEventType, type ObservabilityEventType, type ObservabilityLevelString, ObservabilityLevel, type CaptureInput, type ObservabilityEvent, type ObservabilityError, type CaptureControl, type GroupSamplingConfig, type RecordOverrides, type ContextOverrides, type DecoratorBaseOptions, type DecoratorCaptureControl, type CaptureSerializeOptions, type SourceType, type ObservabilityConfig, type ObservabilityBackend, type ObservabilityBackendConfig, type ObservabilityBackendName, type DataProtectionConfig, type TruncationConfig, type DynamoDBConfig, type SamplingConfig, type TypeSpecificConfig, type IEventCapture, type NoiseReductionPresetLevel, DefaultSamplingConfig, } from './types';
export { DECISION_BASE_PRIORITY, evaluateNoiseRules, getEffectivePriority } from './noise-reduction/priority';
export type { NoiseEvaluationResult } from './noise-reduction/priority';
export { applyNoiseReduction, pickNoiseDecision, buildAndEvaluate } from './noise-reduction';
export type { AbsorbedData, EmittedEvent, NoiseReductionResult, NoiseReductionStats, AbsorptionBounds } from './noise-reduction/types';
export { groupCheckpointsByOperation } from './span-compression';
export type { GroupedCheckpoint, CompactCheckpointItem, AggregateStats } from './span-compression';
export { Observer, ObservabilityManager, withObservability, } from './manager';
export { CONFIG_DEFAULTS, createObservabilityConfig, extendPreset, ObservabilityConfigInput, VALID_BACKENDS, validateConfig, ValidBackend } from './config';
export { debugPreset, developmentPreset, getPreset, minimalPreset, productionPreset, type ObservabilityPreset } from './presets';
export { type Actor, type CreateExecutionContextOptions, type ExecutionContextData, type ParsedTraceContext, type ObservabilityState, type ObservabilitySummary, type ISpanNode, createExecutionContext, getCurrentExecutionContext, getObservabilityState, getCurrentSpan, runWithExecutionContext, runWithExecutionContextSync, withContext, getCapturedParentId, getCurrentParentObservabilityLogId, addTags, enrichActor, setActor, setAttribute, setAttributes, setSource, extractFromEventBridge, extractFromHeaders, extractFromKinesis, extractFromSns, extractFromSqs, extractFromSqsRecord, extractFromStepFunctions, createEventBridgeContext, createHttpHeaders, createSnsAttributes, createSqsAttributes, createStepFunctionsContext, toW3CParentId, toW3CTraceId, } from './context';
export { SpanObserver, type SpanOptions, type SpanEndOptions, type ISpanObserver, withSpan, withSpanSync, wrapInSpan, AuditObserver, type EntityAuditOptions, type AuditRecordOptions, type ComplianceAuditOptions, type AccessAuditOptions, LogObserver, type LogOptions, MetricObserver, type MetricOptions, QueryObserver, type QueryContext, type ConsumedCapacityResult, generateId, captureRecord, captureRecordAsync, buildCaptureInput, resolveCorrelationId, mergeTags, mapError, normalizeError, setCapturer, resetCapturer, initializeCapturer, } from './observers';
export { CloudWatchBackend } from './backends/cloudwatch';
export { DynamoDBObservabilityBackend } from './backends/dynamodb';
export { OTELObservabilityBackend } from './backends/otel';
export { LogtrailObservabilityBackend } from './backends/logtrail';
export { clearRedactorCache, DEFAULT_BLACKLISTED_KEYS, DEFAULT_PROTECTED_FIELDS, extendBlacklist, redactSensitiveData, shouldRedactKey } from './utils/data-protection';
export { computeErrorFingerprint, normalizeErrorMessage, normalizeStackTrace } from './utils/error-fingerprint';
export { generateSpanId, generateTraceId } from './utils/id-generator';
export { levelToPowertoolsLogLevel, levelToString, stringToLevel } from './utils/level-utils';
export { observedCall, observedCallSync, type ObservedCallOptions } from './utils/observed-call';
export { estimateItemSize, isPayloadWithinLimits, safeStringify, safeSerialize, truncatePayload, truncateItem, type TruncationMetadata, type SerializeOptions } from './utils/payload';
export { clearEnvironmentTagsCache, createControllerSource, createQueueSource, createServiceSource, createTaskSource, detectSource, getEnvironmentTags, mergeTags as mergeSourceTags } from './utils/source-utils';
export { buildTraceGraph, type TraceGraph, type TraceNode, type TraceEdge } from './trace-graph';
export { BatchProgress, type BatchResult, type BatchSummary, type ProcessOptions, type ChunkOptions, type ProcessContext, type FailedItem, type MetricStats, type ObserveMode, } from './utils/batch-progress';
export { Observed, ObservedOptions } from './decorators';
export { CrudObservabilityContext, CrudObservabilityHooks } from './crud-hooks';
export { mergeObservabilityConfigs } from './controller-config';
export type { ControllerObservabilityConfig, ObservabilityIncludesConfig, SpanMetadata } from './controller-config';
export { ObservabilityLogEntitySchema, ObservabilityLogService } from './storage';
export type { LogRecord, ObservabilityLogCreateItem, ObservabilityLogSchema, ObservabilityLogEntityType, ObservabilityLogRecordType, ReconstructedSpan } from './storage';
export { assertEventCaptured, assertEventCount, assertNoEventCaptured, cleanupTestObservability, createTestActor, createTestContext, createTestContextSync, createTestExecutionContext, MockBackend, setupTestObservability } from './testing';
