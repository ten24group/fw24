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
export { ObservabilityLevel, ObservabilityLevelString, ObservabilityEvent, ObservabilityEventType, BaseEventType, ObservabilityError, CaptureInput, CaptureOptions, IEventCapture, ObservabilityBackend, ObservabilityBackendConfig, ObservabilityConfig, SamplingConfig, TypeSpecificConfig, DefaultSamplingConfig, ObservationContext, } from './types';
export { ObservabilityManager, Observer, withObservability, } from './manager';
export { ConfigManager, validateConfig, CONFIG_DEFAULTS, VALID_BACKENDS, ValidBackend, } from './config';
export { CreateObservationContextOptions, ParsedTraceContext, createObservationContext, runWithContext, runWithContextSync, getCurrentContext, hasContext, getCorrelationId, getCorrelationIdIfExists, getContextActor, setContextActor, addContextTags, setContextParentLogId, extractTraceContextFromHeaders, extractTraceContextFromSqs, extractTraceContextFromSns, extractTraceContextFromEventBridge, extractTraceContextFromStepFunctions, extractTraceContextFromKinesis, extractTraceContextFromDynamoDBStream, createPropagationHeaders, createSqsMessageAttributes, createSnsMessageAttributes, createEventBridgeTraceContext, createStepFunctionsTraceContext, toW3CTraceId, toW3CParentId, withObservationContext, withObservationContextSync, } from './context';
export { SpanObserver, withSpan, SpanOptions, AuditObserver, AuditObserverOptions, MetricObserver, MetricOptions, WorkflowObserver, WorkflowOptions, StepOptions, DecisionObserver, DecisionRule, AccessLogObserver, AccessLogOptions, LogObserver, LogOptions, ChildLogObserver, } from './observers';
export { ObservabilityLogEntitySchema, ObservabilityLogSchema, ObservabilityLogService, ReconstructedSpan, LogRecord, } from './storage';
export { CloudWatchBackend, CloudWatchBackendOptions } from './backends/cloudwatch';
export { DynamoDBObservabilityBackend, DynamoDBBackendOptions } from './backends/dynamodb';
export { OTELObservabilityBackend, OTELBackendOptions } from './backends/otel';
export { stringToLevel, levelToString, levelToPowertoolsLogLevel, } from './utils/level-utils';
export { detectSource, createControllerSource, createServiceSource, createQueueSource, createTaskSource, getEnvironmentTags, mergeTags, } from './utils/source-utils';
export { truncatePayload, estimateItemSize, isPayloadWithinLimits, safeStringify, } from './utils/payload';
export { Traced, TracedOptions, Audited, AuditedOptions, } from './decorators';
export { CrudObservabilityHooks, CrudObservabilityContext, } from './crud-hooks';
export { apiGatewayObservabilityMiddleware, processSqsMessages, ObservabilityContextData, SqsMessage, SqsMessageHandler, } from './middleware';
export { BaseObserverOptions, CommonFields, generateId, resolveCorrelationId, mergeObserverTags, buildCommonFields, extractObserverOptions, mapError, captureEvent, captureEventAsync, setCapturer, resetCapturer, } from './observers/base';
export { MockBackend, setupTestObservability, cleanupTestObservability, createTestContext, createTestContextSync, assertEventCaptured, assertNoEventCaptured, assertEventCount, createTestActor, createTestObservationContext, } from './testing';
export { clearEnvironmentTagsCache } from './utils/source-utils';
