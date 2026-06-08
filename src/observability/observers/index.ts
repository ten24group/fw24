/**
 * Core Observers
 * 
 * Essential observability primitives. Applications can build specialized
 * observers (WorkflowObserver, DecisionObserver, etc.) on top of these core primitives.
 */

// Span Observer
export {
  SpanObserver,
  withSpan,
  withSpanSync,
  wrapInSpan,
  type SpanOptions,
  type SpanEndOptions,
  type ISpanObserver,
} from './span';

// Audit Observer
export {
  AuditObserver,
  type EntityAuditOptions,
  type AuditRecordOptions,
  type ComplianceAuditOptions,
  type AccessAuditOptions,
} from './audit';

// Metric Observer
export { MetricObserver, type MetricOptions } from './metric';

// Log Observer
export { LogObserver, type LogOptions } from './log';

// Query Observer (Database performance tracking)
export { QueryObserver, type QueryContext, type ConsumedCapacityResult } from './query';

// Base utilities for building custom observers
export {
  // Core functions
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
} from './base';
