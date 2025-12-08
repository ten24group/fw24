/**
 * Core Observers
 * 
 * Essential observability primitives. Applications can build specialized
 * observers (WorkflowObserver, DecisionObserver, etc.) on top of these core primitives.
 */

// Core Observer implementations
export { SpanObserver, withSpan, SpanOptions, ISpanObserver } from './span';
export { AuditObserver, AuditObserverOptions } from './audit';
export { MetricObserver, MetricOptions } from './metric';
export { LogObserver, LogOptions, ChildLogObserver } from './log';

// Base utilities for building custom observers
export {
  BaseObserverOptions,
  CommonFields,
  generateId,
  resolveCorrelationId,
  mergeObserverTags,
  buildCommonFields,
  extractObserverOptions,
  mapError,
  normalizeError,
  captureEvent,
  captureEventAsync,
  // Testing utilities
  setCapturer,
  resetCapturer,
} from './base';

