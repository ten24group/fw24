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

import { DIContainer } from '../di';
import { createObservabilityConfig } from './config';

// ═══════════════════════════════════════════════════════════════════════════
// REGISTER DEFAULT CONFIG (priority 0 - apps can override with higher priority)
// ═══════════════════════════════════════════════════════════════════════════

DIContainer.ROOT.registerConfigProvider({
  provide: 'observability',
  useConfig: createObservabilityConfig(),
  priority: 0
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

// === CORE TYPES ===
export {
  // Event types
  type BaseEventType,
  type ObservabilityEventType,
  type ObservabilityLevelString,
  ObservabilityLevel,

  // Record types
  type CaptureInput,
  type ObservabilityEvent,
  type ObservabilityError,

  // Capture control
  type CaptureControl,
  type GroupSamplingConfig,
  type RecordOverrides,
  type ContextOverrides,

  // Decorator types
  type DecoratorBaseOptions,
  type DecoratorCaptureControl,
  type CaptureSerializeOptions,
  type SourceType,

  // Config types
  type ObservabilityConfig,
  type ObservabilityBackend,
  type ObservabilityBackendConfig,
  type DataProtectionConfig,
  type TruncationConfig,
  type DynamoDBConfig,
  type SamplingConfig,
  type TypeSpecificConfig,
  type IEventCapture,
  DefaultSamplingConfig,

  // Deprecated aliases
} from './types';

// === NOISE REDUCTION ===
export { DECISION_BASE_PRIORITY, evaluateNoiseRules, getEffectivePriority } from './noise-reduction/priority';
export type { NoiseEvaluationResult } from './noise-reduction/priority';
export { applyNoiseReduction, pickNoiseDecision, buildAndEvaluate } from './noise-reduction';
export type { AbsorbedData, EmittedEvent, NoiseReductionResult, NoiseReductionStats, AbsorptionBounds } from './noise-reduction/types';

// === CORE MANAGER ===
export {
  Observer,
  ObservabilityManager,
  withObservability,
} from './manager';

// === CONFIGURATION ===
export {
  CONFIG_DEFAULTS,
  createObservabilityConfig,
  extendPreset,
  ObservabilityConfigInput,
  VALID_BACKENDS,
  validateConfig,
  ValidBackend
} from './config';

// === PRESETS ===
export {
  debugPreset,
  developmentPreset,
  getPreset,
  minimalPreset,
  productionPreset,
  type ObservabilityPreset
} from './presets';

// === CONTEXT ===
export {
  // Types
  type Actor,
  type CreateExecutionContextOptions,
  type ExecutionContextData,
  type ParsedTraceContext,
  type ObservabilityState,
  type ObservabilitySummary,
  type ISpanNode,

  // Storage & Lifecycle
  createExecutionContext,
  getCurrentExecutionContext,
  getObservabilityState,
  getCurrentSpan,
  runWithExecutionContext,
  runWithExecutionContextSync,

  // Context Override
  withContext,

  // Parent Resolution
  getCapturedParentId,
  getCurrentParentObservabilityLogId,

  // Enrichment
  addTags,
  enrichActor,
  setActor,
  setAttribute,
  setAttributes,
  setSource,

  // Propagation - Extraction
  extractFromEventBridge,
  extractFromHeaders,
  extractFromKinesis,
  extractFromSns,
  extractFromSqs,
  extractFromSqsRecord,
  extractFromStepFunctions,

  // Propagation - Creation
  createEventBridgeContext,
  createHttpHeaders,
  createSnsAttributes,
  createSqsAttributes,
  createStepFunctionsContext,
  toW3CParentId,
  toW3CTraceId,
} from './context';

// === CORE OBSERVERS ===
export {
  // Span
  SpanObserver,
  type SpanOptions,
  type SpanEndOptions,
  type ISpanObserver,
  withSpan,
  withSpanSync,
  wrapInSpan,

  // Audit
  AuditObserver,
  type EntityAuditOptions,
  type AuditRecordOptions,
  type ComplianceAuditOptions,
  type AccessAuditOptions,

  // Log
  LogObserver,
  type LogOptions,

  // Metric
  MetricObserver,
  type MetricOptions,

  // Query (Database performance tracking)
  QueryObserver,
  type QueryContext,

  // Base utilities
  generateId,
  captureRecord,
  captureRecordAsync,
  buildCaptureInput,
  resolveCorrelationId,
  mergeTags,
  mapError,
  normalizeError,

  // Testing utilities
  setCapturer,
  resetCapturer,
  initializeCapturer,
} from './observers';

// === BACKENDS (DI-managed, exported for type references) ===
export { CloudWatchBackend } from './backends/cloudwatch';
export { DynamoDBObservabilityBackend } from './backends/dynamodb';
export { OTELObservabilityBackend } from './backends/otel';

// === UTILITIES ===
export { clearRedactorCache, DEFAULT_BLACKLISTED_KEYS, DEFAULT_PROTECTED_FIELDS, extendBlacklist, redactSensitiveData, shouldRedactKey } from './utils/data-protection';
export { computeErrorFingerprint, normalizeErrorMessage, normalizeStackTrace } from './utils/error-fingerprint';
export { generateSpanId, generateTraceId } from './utils/id-generator';
export { levelToPowertoolsLogLevel, levelToString, stringToLevel } from './utils/level-utils';
export { observedCall, observedCallSync, type ObservedCallOptions } from './utils/observed-call';
export { estimateItemSize, isPayloadWithinLimits, safeStringify, safeSerialize, truncatePayload, truncateItem, type TruncationMetadata, type SerializeOptions } from './utils/payload';
export { clearEnvironmentTagsCache, createControllerSource, createQueueSource, createServiceSource, createTaskSource, detectSource, getEnvironmentTags, mergeTags as mergeSourceTags } from './utils/source-utils';

// === TRACE GRAPH (explicit parent/causedBy graph) ===
export { buildTraceGraph, type TraceGraph, type TraceNode, type TraceEdge } from './trace-graph';

// === BATCH PROGRESS ===
export {
  BatchProgress,
  type BatchResult,
  type BatchSummary,
  type ProcessOptions,
  type ChunkOptions,
  type ProcessContext,
  type FailedItem,
  type MetricStats,
  type ObserveMode,
} from './utils/batch-progress';

// === DECORATORS ===
export { Observed, ObservedOptions } from './decorators';

// === CRUD HOOKS ===
export { CrudObservabilityContext, CrudObservabilityHooks } from './crud-hooks';

// === CONTROLLER CONFIG ===
export { mergeObservabilityConfigs } from './controller-config';
export type { ControllerObservabilityConfig, ObservabilityIncludesConfig, SpanMetadata } from './controller-config';

// === STORAGE (Entity, Service) ===
// For admin UIs, extend BaseEntityController<ObservabilityLogSchema> directly
export {
  ObservabilityLogEntitySchema,
  ObservabilityLogService
} from './storage';
export type { LogRecord, ObservabilityLogCreateItem, ObservabilityLogSchema, ObservabilityLogEntityType, ObservabilityLogRecordType, ReconstructedSpan } from './storage';

// === TESTING ===
export { assertEventCaptured, assertEventCount, assertNoEventCaptured, cleanupTestObservability, createTestActor, createTestContext, createTestContextSync, createTestExecutionContext, MockBackend, setupTestObservability } from './testing';
