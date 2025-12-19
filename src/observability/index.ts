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
  BaseEventType, CaptureInput,
  CaptureOptions, DefaultSamplingConfig, IEventCapture,
  ObservabilityBackend,
  ObservabilityBackendConfig,
  ObservabilityConfig, ObservabilityDataProtectionConfig, ObservabilityError, ObservabilityEvent,
  ObservabilityEventType, ObservabilityLevel,
  ObservabilityLevelString, SamplingConfig,
  TypeSpecificConfig
} from './types';

// === CORE MANAGER ===
export { ObservabilityManager, Observer, withObservability } from './manager';

// === CONFIGURATION ===
export {
  CONFIG_DEFAULTS, createObservabilityConfig, ObservabilityConfigInput, VALID_BACKENDS, validateConfig, ValidBackend
} from './config';

// === PRESETS ===
export {
  createObservabilityConfig as createObservabilityConfigFromPreset, debugPreset, developmentPreset, getPreset, minimalPreset, productionPreset, type ObservabilityPreset
} from './presets';

// === CONTEXT ===
export {
  addTags, createEventBridgeContext, createExecutionContext, createHttpHeaders, createObservationContext, createSnsAttributes, createSqsAttributes, createStepFunctionsContext, enrichActor, extractFromEventBridge, extractFromHeaders, extractFromKinesis, extractFromSns, extractFromSqs, extractFromStepFunctions, getCorrelationIdIfExists, getCurrentContext, getCurrentExecutionContext, runWithContext,
  runWithContextSync, runWithExecutionContext,
  runWithExecutionContextSync, setActor, setAttribute,
  setAttributes, setParentObservabilityLogId, setSource, toW3CParentId, toW3CTraceId, type Actor, type CreateExecutionContextOptions, type ExecutionContextData, type ObservationContext, type ParsedTraceContext
} from './context';

// === CORE OBSERVERS ===
export {
  // Base types
  ObservabilityPayload,
  BaseObserverOptions,
  CommonFields,
  // Audit
  AuditObserver,
  AuditObserverOptions,
  AuditRecordOptions,
  ComplianceAuditOptions,
  AccessAuditOptions,
  // Log
  LogObserver,
  LogOptions,
  ChildLogObserver,
  // Metric
  MetricObserver,
  MetricOptions,
  // Span
  SpanObserver,
  SpanOptions,
  SpanEventOptions,
  SpanEndOptions,
  ISpanObserver,
  withSpan
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
export { clearEnvironmentTagsCache, createControllerSource, createQueueSource, createServiceSource, createTaskSource, detectSource, getEnvironmentTags, mergeTags } from './utils/source-utils';

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
export { assertEventCaptured, assertEventCount, assertNoEventCaptured, cleanupTestObservability, createTestActor, createTestContext, createTestContextSync, createTestObservationContext, MockBackend, setupTestObservability } from './testing';
