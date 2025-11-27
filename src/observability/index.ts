/**
 * FW24 Observability System
 * 
 * A unified observability system for logging, metrics, traces, audits, and more.
 * 
 * ## Architecture
 * 
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Application Layer (User Code)                               │
 * └─────────────────────────────────────────────────────────────┘
 *                             ↓
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Specialized Observers                                       │
 * │ SpanObserver | AuditObserver | MetricObserver              │
 * │ WorkflowObserver | DecisionObserver | AccessLogObserver    │
 * └─────────────────────────────────────────────────────────────┘
 *                             ↓
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Core Observer (ObservabilityManager)                        │
 * │ capture() | flush() | initializeInvocation()               │
 * └─────────────────────────────────────────────────────────────┘
 *                             ↓
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Backends: DynamoDB | CloudWatch | OTEL/X-Ray               │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 * 
 * ## Quick Start
 * 
 * ### 1. Establish Context
 * 
 * ```typescript
 * import { runWithContext, createObservationContext } from '@ten24group/fw24/observability';
 * 
 * await runWithContext(
 *   createObservationContext(requestId, { actor }),
 *   async () => {
 *     // All observations here share the same correlationId
 *   }
 * );
 * ```
 * 
 * ### 2. Use Observers
 * 
 * ```typescript
 * import { SpanObserver, AuditObserver, MetricObserver } from '@ten24group/fw24/observability';
 * 
 * const span = SpanObserver.start('processOrder');
 * AuditObserver.entityCreate('Order', orderId, data);
 * MetricObserver.increment('orders.created');
 * span.end({ success: true });
 * ```
 * 
 * ### 3. API Gateway Controller
 * 
 * ```typescript
 * export class MyController extends APIController {
 *   constructor() {
 *     super();
 *     this.useMiddleware(apiGatewayObservabilityMiddleware);
 *   }
 *   
 *   async myHandler(request, response, ctx) {
 *     // Context available via ctx.observability
 *     const { correlationId, context } = ctx.observability;
 *     
 *     // For nested operations:
 *     return runWithContext(context, async () => {
 *       SpanObserver.start('nested-op');
 *     });
 *   }
 * }
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
  ObservationContext,
} from './types';

// === CORE MANAGER ===
export {
  ObservabilityManager,
  Observer,
  withObservability,
} from './manager';

// === CONFIGURATION ===
export {
  ConfigManager,
  validateConfig,
  CONFIG_DEFAULTS,
  VALID_BACKENDS,
  ValidBackend,
} from './config';

// === CONTEXT MANAGEMENT ===
export {
  // Types
  CreateObservationContextOptions,
  ParsedTraceContext,

  // Context creation & execution (PRIMARY API)
  createObservationContext,
  runWithContext,
  runWithContextSync,

  // Context access
  getCurrentContext,
  hasContext,
  getCorrelationId,
  getCorrelationIdIfExists,
  getContextActor,

  // Context modification
  setContextActor,
  addContextTags,
  setContextParentLogId,

  // Trace context extraction (incoming)
  extractTraceContextFromHeaders,
  extractTraceContextFromSqs,
  extractTraceContextFromSns,
  extractTraceContextFromEventBridge,
  extractTraceContextFromStepFunctions,
  extractTraceContextFromKinesis,
  extractTraceContextFromDynamoDBStream,

  // Trace context propagation (outgoing)
  createPropagationHeaders,
  createSqsMessageAttributes,
  createSnsMessageAttributes,
  createEventBridgeTraceContext,
  createStepFunctionsTraceContext,

  // W3C utilities
  toW3CTraceId,
  toW3CParentId,

  // Legacy aliases (deprecated)
  withObservationContext,
  withObservationContextSync,
} from './context';

// === SPECIALIZED OBSERVERS ===
export {
  // Span/Tracing
  SpanObserver,
  withSpan,
  SpanOptions,

  // Auditing
  AuditObserver,
  AuditObserverOptions,

  // Metrics
  MetricObserver,
  MetricOptions,

  // Workflow
  WorkflowObserver,
  WorkflowOptions,
  StepOptions,

  // Decision/Feature Flags
  DecisionObserver,
  DecisionRule,

  // Access Logging
  AccessLogObserver,
  AccessLogOptions,

  // Simple Logging
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
export {
  stringToLevel,
  levelToString,
  levelToPowertoolsLogLevel,
} from './utils/level-utils';

export {
  detectSource,
  createControllerSource,
  createServiceSource,
  createQueueSource,
  createTaskSource,
  getEnvironmentTags,
  mergeTags,
} from './utils/source-utils';

export {
  truncatePayload,
  estimateItemSize,
  isPayloadWithinLimits,
  safeStringify,
} from './utils/payload';

// === DECORATORS ===
export {
  Traced,
  TracedOptions,
  Audited,
  AuditedOptions,
} from './decorators';

// === CRUD HOOKS ===
export {
  CrudObservabilityHooks,
  CrudObservabilityContext,
} from './crud-hooks';

// === MIDDLEWARE ===
export {
  apiGatewayObservabilityMiddleware,
  processSqsMessages,
  ObservabilityContextData,
  SqsMessage,
  SqsMessageHandler,
} from './middleware';

// === OBSERVER BASE UTILITIES ===
export {
  BaseObserverOptions,
  CommonFields,
  generateId,
  resolveCorrelationId,
  mergeObserverTags,
  buildCommonFields,
  extractObserverOptions,
  mapError,
  captureEvent,
  captureEventAsync,
  setCapturer,
  resetCapturer,
} from './observers/base';

// === TESTING UTILITIES ===
export {
  MockBackend,
  setupTestObservability,
  cleanupTestObservability,
  createTestContext,
  createTestContextSync,
  assertEventCaptured,
  assertNoEventCaptured,
  assertEventCount,
  createTestActor,
  createTestObservationContext,
} from './testing';

// === UTILITY CACHE CONTROL ===
export { clearEnvironmentTagsCache } from './utils/source-utils';
