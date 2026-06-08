"use strict";
/**
 * Core Observers
 *
 * Essential observability primitives. Applications can build specialized
 * observers (WorkflowObserver, DecisionObserver, etc.) on top of these core primitives.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeCapturer = exports.resetCapturer = exports.setCapturer = exports.normalizeError = exports.mapError = exports.mergeTags = exports.resolveCorrelationId = exports.buildCaptureInput = exports.captureRecordAsync = exports.captureRecord = exports.generateId = exports.QueryObserver = exports.LogObserver = exports.MetricObserver = exports.AuditObserver = exports.wrapInSpan = exports.withSpanSync = exports.withSpan = exports.SpanObserver = void 0;
// Span Observer
var span_1 = require("./span");
Object.defineProperty(exports, "SpanObserver", { enumerable: true, get: function () { return span_1.SpanObserver; } });
Object.defineProperty(exports, "withSpan", { enumerable: true, get: function () { return span_1.withSpan; } });
Object.defineProperty(exports, "withSpanSync", { enumerable: true, get: function () { return span_1.withSpanSync; } });
Object.defineProperty(exports, "wrapInSpan", { enumerable: true, get: function () { return span_1.wrapInSpan; } });
// Audit Observer
var audit_1 = require("./audit");
Object.defineProperty(exports, "AuditObserver", { enumerable: true, get: function () { return audit_1.AuditObserver; } });
// Metric Observer
var metric_1 = require("./metric");
Object.defineProperty(exports, "MetricObserver", { enumerable: true, get: function () { return metric_1.MetricObserver; } });
// Log Observer
var log_1 = require("./log");
Object.defineProperty(exports, "LogObserver", { enumerable: true, get: function () { return log_1.LogObserver; } });
// Query Observer (Database performance tracking)
var query_1 = require("./query");
Object.defineProperty(exports, "QueryObserver", { enumerable: true, get: function () { return query_1.QueryObserver; } });
// Base utilities for building custom observers
var base_1 = require("./base");
// Core functions
Object.defineProperty(exports, "generateId", { enumerable: true, get: function () { return base_1.generateId; } });
Object.defineProperty(exports, "captureRecord", { enumerable: true, get: function () { return base_1.captureRecord; } });
Object.defineProperty(exports, "captureRecordAsync", { enumerable: true, get: function () { return base_1.captureRecordAsync; } });
Object.defineProperty(exports, "buildCaptureInput", { enumerable: true, get: function () { return base_1.buildCaptureInput; } });
Object.defineProperty(exports, "resolveCorrelationId", { enumerable: true, get: function () { return base_1.resolveCorrelationId; } });
Object.defineProperty(exports, "mergeTags", { enumerable: true, get: function () { return base_1.mergeTags; } });
Object.defineProperty(exports, "mapError", { enumerable: true, get: function () { return base_1.mapError; } });
Object.defineProperty(exports, "normalizeError", { enumerable: true, get: function () { return base_1.normalizeError; } });
// Testing utilities
Object.defineProperty(exports, "setCapturer", { enumerable: true, get: function () { return base_1.setCapturer; } });
Object.defineProperty(exports, "resetCapturer", { enumerable: true, get: function () { return base_1.resetCapturer; } });
Object.defineProperty(exports, "initializeCapturer", { enumerable: true, get: function () { return base_1.initializeCapturer; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOzs7QUFFSCxnQkFBZ0I7QUFDaEIsK0JBUWdCO0FBUGQsb0dBQUEsWUFBWSxPQUFBO0FBQ1osZ0dBQUEsUUFBUSxPQUFBO0FBQ1Isb0dBQUEsWUFBWSxPQUFBO0FBQ1osa0dBQUEsVUFBVSxPQUFBO0FBTVosaUJBQWlCO0FBQ2pCLGlDQU1pQjtBQUxmLHNHQUFBLGFBQWEsT0FBQTtBQU9mLGtCQUFrQjtBQUNsQixtQ0FBOEQ7QUFBckQsd0dBQUEsY0FBYyxPQUFBO0FBRXZCLGVBQWU7QUFDZiw2QkFBcUQ7QUFBNUMsa0dBQUEsV0FBVyxPQUFBO0FBRXBCLGlEQUFpRDtBQUNqRCxpQ0FBd0Y7QUFBL0Usc0dBQUEsYUFBYSxPQUFBO0FBRXRCLCtDQUErQztBQUMvQywrQkFlZ0I7QUFkZCxpQkFBaUI7QUFDakIsa0dBQUEsVUFBVSxPQUFBO0FBQ1YscUdBQUEsYUFBYSxPQUFBO0FBQ2IsMEdBQUEsa0JBQWtCLE9BQUE7QUFDbEIseUdBQUEsaUJBQWlCLE9BQUE7QUFDakIsNEdBQUEsb0JBQW9CLE9BQUE7QUFDcEIsaUdBQUEsU0FBUyxPQUFBO0FBQ1QsZ0dBQUEsUUFBUSxPQUFBO0FBQ1Isc0dBQUEsY0FBYyxPQUFBO0FBRWQsb0JBQW9CO0FBQ3BCLG1HQUFBLFdBQVcsT0FBQTtBQUNYLHFHQUFBLGFBQWEsT0FBQTtBQUNiLDBHQUFBLGtCQUFrQixPQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDb3JlIE9ic2VydmVyc1xuICogXG4gKiBFc3NlbnRpYWwgb2JzZXJ2YWJpbGl0eSBwcmltaXRpdmVzLiBBcHBsaWNhdGlvbnMgY2FuIGJ1aWxkIHNwZWNpYWxpemVkXG4gKiBvYnNlcnZlcnMgKFdvcmtmbG93T2JzZXJ2ZXIsIERlY2lzaW9uT2JzZXJ2ZXIsIGV0Yy4pIG9uIHRvcCBvZiB0aGVzZSBjb3JlIHByaW1pdGl2ZXMuXG4gKi9cblxuLy8gU3BhbiBPYnNlcnZlclxuZXhwb3J0IHtcbiAgU3Bhbk9ic2VydmVyLFxuICB3aXRoU3BhbixcbiAgd2l0aFNwYW5TeW5jLFxuICB3cmFwSW5TcGFuLFxuICB0eXBlIFNwYW5PcHRpb25zLFxuICB0eXBlIFNwYW5FbmRPcHRpb25zLFxuICB0eXBlIElTcGFuT2JzZXJ2ZXIsXG59IGZyb20gJy4vc3Bhbic7XG5cbi8vIEF1ZGl0IE9ic2VydmVyXG5leHBvcnQge1xuICBBdWRpdE9ic2VydmVyLFxuICB0eXBlIEVudGl0eUF1ZGl0T3B0aW9ucyxcbiAgdHlwZSBBdWRpdFJlY29yZE9wdGlvbnMsXG4gIHR5cGUgQ29tcGxpYW5jZUF1ZGl0T3B0aW9ucyxcbiAgdHlwZSBBY2Nlc3NBdWRpdE9wdGlvbnMsXG59IGZyb20gJy4vYXVkaXQnO1xuXG4vLyBNZXRyaWMgT2JzZXJ2ZXJcbmV4cG9ydCB7IE1ldHJpY09ic2VydmVyLCB0eXBlIE1ldHJpY09wdGlvbnMgfSBmcm9tICcuL21ldHJpYyc7XG5cbi8vIExvZyBPYnNlcnZlclxuZXhwb3J0IHsgTG9nT2JzZXJ2ZXIsIHR5cGUgTG9nT3B0aW9ucyB9IGZyb20gJy4vbG9nJztcblxuLy8gUXVlcnkgT2JzZXJ2ZXIgKERhdGFiYXNlIHBlcmZvcm1hbmNlIHRyYWNraW5nKVxuZXhwb3J0IHsgUXVlcnlPYnNlcnZlciwgdHlwZSBRdWVyeUNvbnRleHQsIHR5cGUgQ29uc3VtZWRDYXBhY2l0eVJlc3VsdCB9IGZyb20gJy4vcXVlcnknO1xuXG4vLyBCYXNlIHV0aWxpdGllcyBmb3IgYnVpbGRpbmcgY3VzdG9tIG9ic2VydmVyc1xuZXhwb3J0IHtcbiAgLy8gQ29yZSBmdW5jdGlvbnNcbiAgZ2VuZXJhdGVJZCxcbiAgY2FwdHVyZVJlY29yZCxcbiAgY2FwdHVyZVJlY29yZEFzeW5jLFxuICBidWlsZENhcHR1cmVJbnB1dCxcbiAgcmVzb2x2ZUNvcnJlbGF0aW9uSWQsXG4gIG1lcmdlVGFncyxcbiAgbWFwRXJyb3IsXG4gIG5vcm1hbGl6ZUVycm9yLFxuXG4gIC8vIFRlc3RpbmcgdXRpbGl0aWVzXG4gIHNldENhcHR1cmVyLFxuICByZXNldENhcHR1cmVyLFxuICBpbml0aWFsaXplQ2FwdHVyZXIsXG59IGZyb20gJy4vYmFzZSc7XG4iXX0=