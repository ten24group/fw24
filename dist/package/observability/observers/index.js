"use strict";
/**
 * Core Observers
 *
 * Essential observability primitives. Applications can build specialized
 * observers (WorkflowObserver, DecisionObserver, etc.) on top of these core primitives.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetCapturer = exports.setCapturer = exports.captureEventAsync = exports.captureEvent = exports.normalizeError = exports.mapError = exports.extractObserverOptions = exports.buildCommonFields = exports.mergeObserverTags = exports.resolveCorrelationId = exports.generateId = exports.ChildLogObserver = exports.LogObserver = exports.MetricObserver = exports.AuditObserver = exports.withSpan = exports.SpanObserver = void 0;
// Core Observer implementations
var span_1 = require("./span");
Object.defineProperty(exports, "SpanObserver", { enumerable: true, get: function () { return span_1.SpanObserver; } });
Object.defineProperty(exports, "withSpan", { enumerable: true, get: function () { return span_1.withSpan; } });
var audit_1 = require("./audit");
Object.defineProperty(exports, "AuditObserver", { enumerable: true, get: function () { return audit_1.AuditObserver; } });
var metric_1 = require("./metric");
Object.defineProperty(exports, "MetricObserver", { enumerable: true, get: function () { return metric_1.MetricObserver; } });
var log_1 = require("./log");
Object.defineProperty(exports, "LogObserver", { enumerable: true, get: function () { return log_1.LogObserver; } });
Object.defineProperty(exports, "ChildLogObserver", { enumerable: true, get: function () { return log_1.ChildLogObserver; } });
// Base utilities for building custom observers
var base_1 = require("./base");
Object.defineProperty(exports, "generateId", { enumerable: true, get: function () { return base_1.generateId; } });
Object.defineProperty(exports, "resolveCorrelationId", { enumerable: true, get: function () { return base_1.resolveCorrelationId; } });
Object.defineProperty(exports, "mergeObserverTags", { enumerable: true, get: function () { return base_1.mergeObserverTags; } });
Object.defineProperty(exports, "buildCommonFields", { enumerable: true, get: function () { return base_1.buildCommonFields; } });
Object.defineProperty(exports, "extractObserverOptions", { enumerable: true, get: function () { return base_1.extractObserverOptions; } });
Object.defineProperty(exports, "mapError", { enumerable: true, get: function () { return base_1.mapError; } });
Object.defineProperty(exports, "normalizeError", { enumerable: true, get: function () { return base_1.normalizeError; } });
Object.defineProperty(exports, "captureEvent", { enumerable: true, get: function () { return base_1.captureEvent; } });
Object.defineProperty(exports, "captureEventAsync", { enumerable: true, get: function () { return base_1.captureEventAsync; } });
// Testing utilities
Object.defineProperty(exports, "setCapturer", { enumerable: true, get: function () { return base_1.setCapturer; } });
Object.defineProperty(exports, "resetCapturer", { enumerable: true, get: function () { return base_1.resetCapturer; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCxnQ0FBZ0M7QUFDaEMsK0JBQThHO0FBQXJHLG9HQUFBLFlBQVksT0FBQTtBQUFFLGdHQUFBLFFBQVEsT0FBQTtBQUMvQixpQ0FNaUI7QUFMZixzR0FBQSxhQUFhLE9BQUE7QUFNZixtQ0FBeUQ7QUFBaEQsd0dBQUEsY0FBYyxPQUFBO0FBQ3ZCLDZCQUFrRTtBQUF6RCxrR0FBQSxXQUFXLE9BQUE7QUFBYyx1R0FBQSxnQkFBZ0IsT0FBQTtBQUVsRCwrQ0FBK0M7QUFDL0MsK0JBZ0JnQjtBQVpkLGtHQUFBLFVBQVUsT0FBQTtBQUNWLDRHQUFBLG9CQUFvQixPQUFBO0FBQ3BCLHlHQUFBLGlCQUFpQixPQUFBO0FBQ2pCLHlHQUFBLGlCQUFpQixPQUFBO0FBQ2pCLDhHQUFBLHNCQUFzQixPQUFBO0FBQ3RCLGdHQUFBLFFBQVEsT0FBQTtBQUNSLHNHQUFBLGNBQWMsT0FBQTtBQUNkLG9HQUFBLFlBQVksT0FBQTtBQUNaLHlHQUFBLGlCQUFpQixPQUFBO0FBQ2pCLG9CQUFvQjtBQUNwQixtR0FBQSxXQUFXLE9BQUE7QUFDWCxxR0FBQSxhQUFhLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENvcmUgT2JzZXJ2ZXJzXG4gKiBcbiAqIEVzc2VudGlhbCBvYnNlcnZhYmlsaXR5IHByaW1pdGl2ZXMuIEFwcGxpY2F0aW9ucyBjYW4gYnVpbGQgc3BlY2lhbGl6ZWRcbiAqIG9ic2VydmVycyAoV29ya2Zsb3dPYnNlcnZlciwgRGVjaXNpb25PYnNlcnZlciwgZXRjLikgb24gdG9wIG9mIHRoZXNlIGNvcmUgcHJpbWl0aXZlcy5cbiAqL1xuXG4vLyBDb3JlIE9ic2VydmVyIGltcGxlbWVudGF0aW9uc1xuZXhwb3J0IHsgU3Bhbk9ic2VydmVyLCB3aXRoU3BhbiwgU3Bhbk9wdGlvbnMsIFNwYW5FdmVudE9wdGlvbnMsIFNwYW5FbmRPcHRpb25zLCBJU3Bhbk9ic2VydmVyIH0gZnJvbSAnLi9zcGFuJztcbmV4cG9ydCB7XG4gIEF1ZGl0T2JzZXJ2ZXIsXG4gIEF1ZGl0T2JzZXJ2ZXJPcHRpb25zLFxuICBBdWRpdFJlY29yZE9wdGlvbnMsXG4gIENvbXBsaWFuY2VBdWRpdE9wdGlvbnMsXG4gIEFjY2Vzc0F1ZGl0T3B0aW9ucyxcbn0gZnJvbSAnLi9hdWRpdCc7XG5leHBvcnQgeyBNZXRyaWNPYnNlcnZlciwgTWV0cmljT3B0aW9ucyB9IGZyb20gJy4vbWV0cmljJztcbmV4cG9ydCB7IExvZ09ic2VydmVyLCBMb2dPcHRpb25zLCBDaGlsZExvZ09ic2VydmVyIH0gZnJvbSAnLi9sb2cnO1xuXG4vLyBCYXNlIHV0aWxpdGllcyBmb3IgYnVpbGRpbmcgY3VzdG9tIG9ic2VydmVyc1xuZXhwb3J0IHtcbiAgQmFzZU9ic2VydmVyT3B0aW9ucyxcbiAgQ29tbW9uRmllbGRzLFxuICBPYnNlcnZhYmlsaXR5UGF5bG9hZCxcbiAgZ2VuZXJhdGVJZCxcbiAgcmVzb2x2ZUNvcnJlbGF0aW9uSWQsXG4gIG1lcmdlT2JzZXJ2ZXJUYWdzLFxuICBidWlsZENvbW1vbkZpZWxkcyxcbiAgZXh0cmFjdE9ic2VydmVyT3B0aW9ucyxcbiAgbWFwRXJyb3IsXG4gIG5vcm1hbGl6ZUVycm9yLFxuICBjYXB0dXJlRXZlbnQsXG4gIGNhcHR1cmVFdmVudEFzeW5jLFxuICAvLyBUZXN0aW5nIHV0aWxpdGllc1xuICBzZXRDYXB0dXJlcixcbiAgcmVzZXRDYXB0dXJlcixcbn0gZnJvbSAnLi9iYXNlJztcblxuIl19