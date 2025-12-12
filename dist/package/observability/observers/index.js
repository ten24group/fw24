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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCxnQ0FBZ0M7QUFDaEMsK0JBQTRFO0FBQW5FLG9HQUFBLFlBQVksT0FBQTtBQUFFLGdHQUFBLFFBQVEsT0FBQTtBQUMvQixpQ0FBOEQ7QUFBckQsc0dBQUEsYUFBYSxPQUFBO0FBQ3RCLG1DQUF5RDtBQUFoRCx3R0FBQSxjQUFjLE9BQUE7QUFDdkIsNkJBQWtFO0FBQXpELGtHQUFBLFdBQVcsT0FBQTtBQUFjLHVHQUFBLGdCQUFnQixPQUFBO0FBRWxELCtDQUErQztBQUMvQywrQkFlZ0I7QUFaZCxrR0FBQSxVQUFVLE9BQUE7QUFDViw0R0FBQSxvQkFBb0IsT0FBQTtBQUNwQix5R0FBQSxpQkFBaUIsT0FBQTtBQUNqQix5R0FBQSxpQkFBaUIsT0FBQTtBQUNqQiw4R0FBQSxzQkFBc0IsT0FBQTtBQUN0QixnR0FBQSxRQUFRLE9BQUE7QUFDUixzR0FBQSxjQUFjLE9BQUE7QUFDZCxvR0FBQSxZQUFZLE9BQUE7QUFDWix5R0FBQSxpQkFBaUIsT0FBQTtBQUNqQixvQkFBb0I7QUFDcEIsbUdBQUEsV0FBVyxPQUFBO0FBQ1gscUdBQUEsYUFBYSxPQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDb3JlIE9ic2VydmVyc1xuICogXG4gKiBFc3NlbnRpYWwgb2JzZXJ2YWJpbGl0eSBwcmltaXRpdmVzLiBBcHBsaWNhdGlvbnMgY2FuIGJ1aWxkIHNwZWNpYWxpemVkXG4gKiBvYnNlcnZlcnMgKFdvcmtmbG93T2JzZXJ2ZXIsIERlY2lzaW9uT2JzZXJ2ZXIsIGV0Yy4pIG9uIHRvcCBvZiB0aGVzZSBjb3JlIHByaW1pdGl2ZXMuXG4gKi9cblxuLy8gQ29yZSBPYnNlcnZlciBpbXBsZW1lbnRhdGlvbnNcbmV4cG9ydCB7IFNwYW5PYnNlcnZlciwgd2l0aFNwYW4sIFNwYW5PcHRpb25zLCBJU3Bhbk9ic2VydmVyIH0gZnJvbSAnLi9zcGFuJztcbmV4cG9ydCB7IEF1ZGl0T2JzZXJ2ZXIsIEF1ZGl0T2JzZXJ2ZXJPcHRpb25zIH0gZnJvbSAnLi9hdWRpdCc7XG5leHBvcnQgeyBNZXRyaWNPYnNlcnZlciwgTWV0cmljT3B0aW9ucyB9IGZyb20gJy4vbWV0cmljJztcbmV4cG9ydCB7IExvZ09ic2VydmVyLCBMb2dPcHRpb25zLCBDaGlsZExvZ09ic2VydmVyIH0gZnJvbSAnLi9sb2cnO1xuXG4vLyBCYXNlIHV0aWxpdGllcyBmb3IgYnVpbGRpbmcgY3VzdG9tIG9ic2VydmVyc1xuZXhwb3J0IHtcbiAgQmFzZU9ic2VydmVyT3B0aW9ucyxcbiAgQ29tbW9uRmllbGRzLFxuICBnZW5lcmF0ZUlkLFxuICByZXNvbHZlQ29ycmVsYXRpb25JZCxcbiAgbWVyZ2VPYnNlcnZlclRhZ3MsXG4gIGJ1aWxkQ29tbW9uRmllbGRzLFxuICBleHRyYWN0T2JzZXJ2ZXJPcHRpb25zLFxuICBtYXBFcnJvcixcbiAgbm9ybWFsaXplRXJyb3IsXG4gIGNhcHR1cmVFdmVudCxcbiAgY2FwdHVyZUV2ZW50QXN5bmMsXG4gIC8vIFRlc3RpbmcgdXRpbGl0aWVzXG4gIHNldENhcHR1cmVyLFxuICByZXNldENhcHR1cmVyLFxufSBmcm9tICcuL2Jhc2UnO1xuXG4iXX0=