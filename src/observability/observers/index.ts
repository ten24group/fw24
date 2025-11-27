/**
 * Specialized Observers
 * 
 * High-level APIs built on top of the core Observer
 */

// Observer implementations
export { SpanObserver, withSpan, SpanOptions, ISpanObserver } from './span';
export { AuditObserver, AuditObserverOptions } from './audit';
export { MetricObserver, MetricOptions } from './metric';
export { WorkflowObserver, WorkflowOptions, StepOptions, IWorkflowObserver } from './workflow';
export { DecisionObserver, DecisionRule } from './decision';
export { AccessLogObserver, AccessLogOptions } from './access-log';
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

