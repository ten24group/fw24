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

// === CORE TYPES ===
export {
  ObservabilityLevel,
  ObservabilityLevelString,
  ObservabilityEvent,
  ObservabilityEventType,
  BaseEventType,
  ObservabilityError,
  CaptureInput,
  CaptureOptions,
  IEventCapture,
  ObservabilityBackend,
  ObservabilityBackendConfig,
  ObservabilityConfig,
  SamplingConfig,
  TypeSpecificConfig,
  DefaultSamplingConfig,
  ObservabilityDataProtectionConfig,
} from './types';

// === CORE MANAGER ===
export { ObservabilityManager, Observer, withObservability } from './manager';

// === CONFIGURATION ===
export {
  ObservabilityConfigManager,
  validateConfig,
  CONFIG_DEFAULTS,
  VALID_BACKENDS,
  ValidBackend,
} from './config';

// === DI SETUP ===
export {
  createObservabilityConfig,
  registerObservabilityConfig,
  ObservabilityConfigOptions,
} from './di-setup';

// === CONTEXT (re-exported from core/runtime/execution-context) ===
export {
  // Types
  type ExecutionContextData,
  type CreateExecutionContextOptions,
  type ParsedTraceContext,
  type Actor,
  type ObservationContext,

  // Storage & Lifecycle
  createExecutionContext,
  runWithExecutionContext,
  runWithExecutionContextSync,
  getCurrentExecutionContext,

  // Enrichment
  setActor,
  enrichActor,
  addTags,
  setAttribute,
  setAttributes,
  setSource,
  setParentLogId,

  // Propagation - Extraction
  extractFromHeaders,
  extractFromSqs,
  extractFromSns,
  extractFromEventBridge,
  extractFromStepFunctions,
  extractFromKinesis,
  extractFromDynamoDBStream,

  // Propagation - Creation
  createHttpHeaders,
  createSqsAttributes,
  createSnsAttributes,
  createEventBridgeContext,
  createStepFunctionsContext,
  toW3CTraceId,
  toW3CParentId,

  // Convenience aliases
  getCurrentContext,
  getCorrelationIdIfExists,
  createObservationContext,
  runWithContext,
  runWithContextSync,
} from './context';

// === CORE OBSERVERS ===
export {
  SpanObserver,
  ISpanObserver,
  withSpan,
  SpanOptions,
  AuditObserver,
  AuditObserverOptions,
  MetricObserver,
  MetricOptions,
  LogObserver,
  LogOptions,
  ChildLogObserver,
} from './observers';

// === STORAGE ===
export {
  ObservabilityLogEntitySchema,
  ObservabilityLogSchema,
  ObservabilityLogService,
  ReconstructedSpan,
  LogRecord,
} from './storage';

// === BACKENDS ===
export { CloudWatchBackend, CloudWatchBackendOptions } from './backends/cloudwatch';
export { DynamoDBObservabilityBackend, DynamoDBBackendOptions } from './backends/dynamodb';
export { OTELObservabilityBackend, OTELBackendOptions } from './backends/otel';

// === UTILITIES ===
export { stringToLevel, levelToString, levelToPowertoolsLogLevel } from './utils/level-utils';
export { detectSource, createControllerSource, createServiceSource, createQueueSource, createTaskSource, getEnvironmentTags, mergeTags, clearEnvironmentTagsCache } from './utils/source-utils';
export { truncatePayload, estimateItemSize, isPayloadWithinLimits, safeStringify } from './utils/payload';
export { redactSensitiveData, shouldRedactKey, extendBlacklist, clearRedactorCache, DEFAULT_BLACKLISTED_KEYS, DEFAULT_PROTECTED_FIELDS, DataProtectionConfig } from './utils/data-protection';

// === DECORATORS ===
export { Traced, TracedOptions, Audited, AuditedOptions, Observed, ObservedOptions, ObservedClass, ObservedClassOptions } from './decorators';

// === CRUD HOOKS ===
export { CrudObservabilityHooks, CrudObservabilityContext } from './crud-hooks';

// === APPLICATION HELPERS ===
export { captureBusinessEvent, captureBusinessError, captureMetric, CaptureEventOptions } from './helpers/capture';

// === CONTROLLER CONFIG ===
export type { ControllerObservabilityConfig, ObservabilityIncludesConfig } from './controller-config';
export { mergeObservabilityConfigs } from './controller-config';

// === TESTING ===
export { MockBackend, setupTestObservability, cleanupTestObservability, createTestContext, createTestContextSync, assertEventCaptured, assertNoEventCaptured, assertEventCount, createTestActor, createTestObservationContext } from './testing';
