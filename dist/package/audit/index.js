"use strict";
/**
 * Audit Module - DynamoDB Stream Entity Auditing ONLY
 *
 * For request/event/metrics logging, use the observability module directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_IGNORED_FIELDS = exports.getChangedProperties = exports.DefaultAuditHandler = exports.DynamoDBStreamAuditLogger = exports.AUDIT_ENV_KEYS = void 0;
// ============================================================================
// ENTITY FILTERING CONFIG
// ============================================================================
var interfaces_1 = require("./interfaces");
Object.defineProperty(exports, "AUDIT_ENV_KEYS", { enumerable: true, get: function () { return interfaces_1.AUDIT_ENV_KEYS; } });
// ============================================================================
// STREAM HANDLER
// ============================================================================
var loggers_1 = require("./loggers");
Object.defineProperty(exports, "DynamoDBStreamAuditLogger", { enumerable: true, get: function () { return loggers_1.DynamoDBStreamAuditLogger; } });
Object.defineProperty(exports, "DefaultAuditHandler", { enumerable: true, get: function () { return loggers_1.DynamoDBStreamAuditLogger; } });
// ============================================================================
// CHANGE DETECTION UTILITIES
// ============================================================================
var change_detection_1 = require("./helpers/change-detection");
Object.defineProperty(exports, "getChangedProperties", { enumerable: true, get: function () { return change_detection_1.getChangedProperties; } });
Object.defineProperty(exports, "DEFAULT_IGNORED_FIELDS", { enumerable: true, get: function () { return change_detection_1.DEFAULT_IGNORED_FIELDS; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXVkaXQvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILCtFQUErRTtBQUMvRSwwQkFBMEI7QUFDMUIsK0VBQStFO0FBRS9FLDJDQUE4QztBQUFyQyw0R0FBQSxjQUFjLE9BQUE7QUFFdkIsK0VBQStFO0FBQy9FLGlCQUFpQjtBQUNqQiwrRUFBK0U7QUFFL0UscUNBR21CO0FBRmYsb0hBQUEseUJBQXlCLE9BQUE7QUFDekIsOEdBQUEseUJBQXlCLE9BQXVCO0FBR3BELCtFQUErRTtBQUMvRSw2QkFBNkI7QUFDN0IsK0VBQStFO0FBRS9FLCtEQUdvQztBQUZoQyx3SEFBQSxvQkFBb0IsT0FBQTtBQUNwQiwwSEFBQSxzQkFBc0IsT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQXVkaXQgTW9kdWxlIC0gRHluYW1vREIgU3RyZWFtIEVudGl0eSBBdWRpdGluZyBPTkxZXG4gKiBcbiAqIEZvciByZXF1ZXN0L2V2ZW50L21ldHJpY3MgbG9nZ2luZywgdXNlIHRoZSBvYnNlcnZhYmlsaXR5IG1vZHVsZSBkaXJlY3RseS5cbiAqL1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFTlRJVFkgRklMVEVSSU5HIENPTkZJR1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5leHBvcnQgeyBBVURJVF9FTlZfS0VZUyB9IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNUUkVBTSBIQU5ETEVSXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCB7XG4gICAgRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlcixcbiAgICBEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyIGFzIERlZmF1bHRBdWRpdEhhbmRsZXIsXG59IGZyb20gJy4vbG9nZ2Vycyc7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIENIQU5HRSBERVRFQ1RJT04gVVRJTElUSUVTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCB7XG4gICAgZ2V0Q2hhbmdlZFByb3BlcnRpZXMsXG4gICAgREVGQVVMVF9JR05PUkVEX0ZJRUxEUyxcbn0gZnJvbSAnLi9oZWxwZXJzL2NoYW5nZS1kZXRlY3Rpb24nO1xuIl19