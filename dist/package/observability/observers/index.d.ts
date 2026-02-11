/**
 * Core Observers
 *
 * Essential observability primitives. Applications can build specialized
 * observers (WorkflowObserver, DecisionObserver, etc.) on top of these core primitives.
 */
export { SpanObserver, withSpan, withSpanSync, wrapInSpan, type SpanOptions, type SpanEndOptions, type ISpanObserver, } from './span';
export { AuditObserver, type EntityAuditOptions, type AuditRecordOptions, type ComplianceAuditOptions, type AccessAuditOptions, } from './audit';
export { MetricObserver, type MetricOptions } from './metric';
export { LogObserver, type LogOptions } from './log';
export { QueryObserver, type QueryContext, type ConsumedCapacityResult } from './query';
export { generateId, captureRecord, captureRecordAsync, buildCaptureInput, resolveCorrelationId, mergeTags, mapError, normalizeError, setCapturer, resetCapturer, initializeCapturer, } from './base';
