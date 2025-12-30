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

  // Config types
  type ObservabilityConfig,
  type ObservabilityBackend,
  type ObservabilityBackendConfig,
  type ObservabilityDataProtectionConfig,
  type SamplingConfig,
  type TypeSpecificConfig,
  type IEventCapture,
  DefaultSamplingConfig,
} from './types';

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
export { clearRedactorCache, DataProtectionConfig, DEFAULT_BLACKLISTED_KEYS, DEFAULT_PROTECTED_FIELDS, extendBlacklist, redactSensitiveData, shouldRedactKey } from './utils/data-protection';
export { generateSpanId, generateTraceId } from './utils/id-generator';
export { levelToPowertoolsLogLevel, levelToString, stringToLevel } from './utils/level-utils';
export { estimateItemSize, isPayloadWithinLimits, safeStringify, truncatePayload } from './utils/payload';
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
export { Audited, AuditedOptions, Observed, ObservedOptions, Traced, TracedOptions } from './decorators';

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
export type { LogRecord, ObservabilityLogCreateItem, ObservabilityLogSchema, ReconstructedSpan } from './storage';

// === TESTING ===
export { assertEventCaptured, assertEventCount, assertNoEventCaptured, cleanupTestObservability, createTestActor, createTestContext, createTestContextSync, createTestExecutionContext, MockBackend, setupTestObservability } from './testing';
