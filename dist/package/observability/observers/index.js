"use strict";
/**
 * Specialized Observers
 *
 * High-level APIs built on top of the core Observer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetCapturer = exports.setCapturer = exports.captureEventAsync = exports.captureEvent = exports.normalizeError = exports.mapError = exports.extractObserverOptions = exports.buildCommonFields = exports.mergeObserverTags = exports.resolveCorrelationId = exports.generateId = exports.ChildLogObserver = exports.LogObserver = exports.AccessLogObserver = exports.DecisionObserver = exports.WorkflowObserver = exports.MetricObserver = exports.AuditObserver = exports.withSpan = exports.SpanObserver = void 0;
// Observer implementations
var span_1 = require("./span");
Object.defineProperty(exports, "SpanObserver", { enumerable: true, get: function () { return span_1.SpanObserver; } });
Object.defineProperty(exports, "withSpan", { enumerable: true, get: function () { return span_1.withSpan; } });
var audit_1 = require("./audit");
Object.defineProperty(exports, "AuditObserver", { enumerable: true, get: function () { return audit_1.AuditObserver; } });
var metric_1 = require("./metric");
Object.defineProperty(exports, "MetricObserver", { enumerable: true, get: function () { return metric_1.MetricObserver; } });
var workflow_1 = require("./workflow");
Object.defineProperty(exports, "WorkflowObserver", { enumerable: true, get: function () { return workflow_1.WorkflowObserver; } });
var decision_1 = require("./decision");
Object.defineProperty(exports, "DecisionObserver", { enumerable: true, get: function () { return decision_1.DecisionObserver; } });
var access_log_1 = require("./access-log");
Object.defineProperty(exports, "AccessLogObserver", { enumerable: true, get: function () { return access_log_1.AccessLogObserver; } });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILDJCQUEyQjtBQUMzQiwrQkFBNEU7QUFBbkUsb0dBQUEsWUFBWSxPQUFBO0FBQUUsZ0dBQUEsUUFBUSxPQUFBO0FBQy9CLGlDQUE4RDtBQUFyRCxzR0FBQSxhQUFhLE9BQUE7QUFDdEIsbUNBQXlEO0FBQWhELHdHQUFBLGNBQWMsT0FBQTtBQUN2Qix1Q0FBK0Y7QUFBdEYsNEdBQUEsZ0JBQWdCLE9BQUE7QUFDekIsdUNBQTREO0FBQW5ELDRHQUFBLGdCQUFnQixPQUFBO0FBQ3pCLDJDQUFtRTtBQUExRCwrR0FBQSxpQkFBaUIsT0FBQTtBQUMxQiw2QkFBa0U7QUFBekQsa0dBQUEsV0FBVyxPQUFBO0FBQWMsdUdBQUEsZ0JBQWdCLE9BQUE7QUFFbEQsK0NBQStDO0FBQy9DLCtCQWVnQjtBQVpkLGtHQUFBLFVBQVUsT0FBQTtBQUNWLDRHQUFBLG9CQUFvQixPQUFBO0FBQ3BCLHlHQUFBLGlCQUFpQixPQUFBO0FBQ2pCLHlHQUFBLGlCQUFpQixPQUFBO0FBQ2pCLDhHQUFBLHNCQUFzQixPQUFBO0FBQ3RCLGdHQUFBLFFBQVEsT0FBQTtBQUNSLHNHQUFBLGNBQWMsT0FBQTtBQUNkLG9HQUFBLFlBQVksT0FBQTtBQUNaLHlHQUFBLGlCQUFpQixPQUFBO0FBQ2pCLG9CQUFvQjtBQUNwQixtR0FBQSxXQUFXLE9BQUE7QUFDWCxxR0FBQSxhQUFhLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFNwZWNpYWxpemVkIE9ic2VydmVyc1xuICogXG4gKiBIaWdoLWxldmVsIEFQSXMgYnVpbHQgb24gdG9wIG9mIHRoZSBjb3JlIE9ic2VydmVyXG4gKi9cblxuLy8gT2JzZXJ2ZXIgaW1wbGVtZW50YXRpb25zXG5leHBvcnQgeyBTcGFuT2JzZXJ2ZXIsIHdpdGhTcGFuLCBTcGFuT3B0aW9ucywgSVNwYW5PYnNlcnZlciB9IGZyb20gJy4vc3Bhbic7XG5leHBvcnQgeyBBdWRpdE9ic2VydmVyLCBBdWRpdE9ic2VydmVyT3B0aW9ucyB9IGZyb20gJy4vYXVkaXQnO1xuZXhwb3J0IHsgTWV0cmljT2JzZXJ2ZXIsIE1ldHJpY09wdGlvbnMgfSBmcm9tICcuL21ldHJpYyc7XG5leHBvcnQgeyBXb3JrZmxvd09ic2VydmVyLCBXb3JrZmxvd09wdGlvbnMsIFN0ZXBPcHRpb25zLCBJV29ya2Zsb3dPYnNlcnZlciB9IGZyb20gJy4vd29ya2Zsb3cnO1xuZXhwb3J0IHsgRGVjaXNpb25PYnNlcnZlciwgRGVjaXNpb25SdWxlIH0gZnJvbSAnLi9kZWNpc2lvbic7XG5leHBvcnQgeyBBY2Nlc3NMb2dPYnNlcnZlciwgQWNjZXNzTG9nT3B0aW9ucyB9IGZyb20gJy4vYWNjZXNzLWxvZyc7XG5leHBvcnQgeyBMb2dPYnNlcnZlciwgTG9nT3B0aW9ucywgQ2hpbGRMb2dPYnNlcnZlciB9IGZyb20gJy4vbG9nJztcblxuLy8gQmFzZSB1dGlsaXRpZXMgZm9yIGJ1aWxkaW5nIGN1c3RvbSBvYnNlcnZlcnNcbmV4cG9ydCB7XG4gIEJhc2VPYnNlcnZlck9wdGlvbnMsXG4gIENvbW1vbkZpZWxkcyxcbiAgZ2VuZXJhdGVJZCxcbiAgcmVzb2x2ZUNvcnJlbGF0aW9uSWQsXG4gIG1lcmdlT2JzZXJ2ZXJUYWdzLFxuICBidWlsZENvbW1vbkZpZWxkcyxcbiAgZXh0cmFjdE9ic2VydmVyT3B0aW9ucyxcbiAgbWFwRXJyb3IsXG4gIG5vcm1hbGl6ZUVycm9yLFxuICBjYXB0dXJlRXZlbnQsXG4gIGNhcHR1cmVFdmVudEFzeW5jLFxuICAvLyBUZXN0aW5nIHV0aWxpdGllc1xuICBzZXRDYXB0dXJlcixcbiAgcmVzZXRDYXB0dXJlcixcbn0gZnJvbSAnLi9iYXNlJztcblxuIl19