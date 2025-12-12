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

import { DIContainer } from '../di';
import { createObservabilityConfig } from './config';

// ═══════════════════════════════════════════════════════════════════════════
// REGISTER DEFAULT CONFIG (priority 0 - apps can override with higher priority)
// ═══════════════════════════════════════════════════════════════════════════

DIContainer.ROOT.registerConfigProvider({
  provide: 'observability',
  useConfig: createObservabilityConfig(), // Factory returns complete typed config with defaults
  priority: 0
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

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
  createObservabilityConfig,
  validateConfig,
  CONFIG_DEFAULTS,
  VALID_BACKENDS,
  ValidBackend,
  ObservabilityConfigInput,
} from './config';

// === CONTEXT ===
export {
  type ExecutionContextData,
  type CreateExecutionContextOptions,
  type ParsedTraceContext,
  type Actor,
  type ObservationContext,
  createExecutionContext,
  runWithExecutionContext,
  runWithExecutionContextSync,
  getCurrentExecutionContext,
  setActor,
  enrichActor,
  addTags,
  setAttribute,
  setAttributes,
  setSource,
  setParentObservabilityLogId,
  extractFromHeaders,
  extractFromSqs,
  extractFromSns,
  extractFromEventBridge,
  extractFromStepFunctions,
  extractFromKinesis,
  extractFromDynamoDBStream,
  createHttpHeaders,
  createSqsAttributes,
  createSnsAttributes,
  createEventBridgeContext,
  createStepFunctionsContext,
  toW3CTraceId,
  toW3CParentId,
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

// === BACKENDS (DI-managed, exported for type references) ===
export { CloudWatchBackend } from './backends/cloudwatch';
export { DynamoDBObservabilityBackend } from './backends/dynamodb';
export { OTELObservabilityBackend } from './backends/otel';

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
export type { SpanMetadata, ControllerObservabilityConfig, ObservabilityIncludesConfig } from './controller-config';
export { mergeObservabilityConfigs } from './controller-config';

// === STORAGE (Entity, Service) ===
// For admin UIs, extend BaseEntityController<ObservabilityLogSchema> directly
export {
  ObservabilityLogEntitySchema,
  ObservabilityLogService,
} from './storage';
export type { ObservabilityLogSchema, ReconstructedSpan, LogRecord, ObservabilityLogCreateItem } from './storage';

// === TESTING ===
export { MockBackend, setupTestObservability, cleanupTestObservability, createTestContext, createTestContextSync, assertEventCaptured, assertNoEventCaptured, assertEventCount, createTestActor, createTestObservationContext } from './testing';
