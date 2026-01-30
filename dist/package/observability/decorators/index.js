"use strict";
/**
 * Observability Decorators
 *
 * Method decorators for automatic tracing and auditing.
 *
 * Usage:
 * ```typescript
 * import { Traced, Audited } from '@ten24group/fw24/observability';
 *
 * class UserService {
 *   @Traced()
 *   async createUser(data: CreateUserInput): Promise<User> {
 *     // Automatically traced
 *   }
 *
 *   @Audited({ operation: 'permission.change' })
 *   async updatePermissions(userId: string): Promise<void> {
 *     // Automatically audited
 *   }
 * }
 * ```
 *
 * IMPORTANT: Decorators require an execution context to be established.
 * Context is auto-established in controllers, or use runWithExecutionContext().
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Metric = exports.Log = exports.Checkpoint = exports.Observed = exports.Audited = exports.Traced = void 0;
var traced_1 = require("./traced");
Object.defineProperty(exports, "Traced", { enumerable: true, get: function () { return traced_1.Traced; } });
var audited_1 = require("./audited");
Object.defineProperty(exports, "Audited", { enumerable: true, get: function () { return audited_1.Audited; } });
var observed_1 = require("./observed");
Object.defineProperty(exports, "Observed", { enumerable: true, get: function () { return observed_1.Observed; } });
var checkpoint_1 = require("./checkpoint");
Object.defineProperty(exports, "Checkpoint", { enumerable: true, get: function () { return checkpoint_1.Checkpoint; } });
var log_1 = require("./log");
Object.defineProperty(exports, "Log", { enumerable: true, get: function () { return log_1.Log; } });
var metric_1 = require("./metric");
Object.defineProperty(exports, "Metric", { enumerable: true, get: function () { return metric_1.Metric; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9kZWNvcmF0b3JzL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBd0JHOzs7QUFFSCxtQ0FBaUQ7QUFBeEMsZ0dBQUEsTUFBTSxPQUFBO0FBQ2YscUNBQW9EO0FBQTNDLGtHQUFBLE9BQU8sT0FBQTtBQUNoQix1Q0FBdUQ7QUFBOUMsb0dBQUEsUUFBUSxPQUFBO0FBQ2pCLDJDQUE2RDtBQUFwRCx3R0FBQSxVQUFVLE9BQUE7QUFDbkIsNkJBQXdDO0FBQS9CLDBGQUFBLEdBQUcsT0FBQTtBQUNaLG1DQUFpRDtBQUF4QyxnR0FBQSxNQUFNLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHkgRGVjb3JhdG9yc1xuICogXG4gKiBNZXRob2QgZGVjb3JhdG9ycyBmb3IgYXV0b21hdGljIHRyYWNpbmcgYW5kIGF1ZGl0aW5nLlxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IFRyYWNlZCwgQXVkaXRlZCB9IGZyb20gJ0B0ZW4yNGdyb3VwL2Z3MjQvb2JzZXJ2YWJpbGl0eSc7XG4gKiBcbiAqIGNsYXNzIFVzZXJTZXJ2aWNlIHtcbiAqICAgQFRyYWNlZCgpXG4gKiAgIGFzeW5jIGNyZWF0ZVVzZXIoZGF0YTogQ3JlYXRlVXNlcklucHV0KTogUHJvbWlzZTxVc2VyPiB7XG4gKiAgICAgLy8gQXV0b21hdGljYWxseSB0cmFjZWRcbiAqICAgfVxuICogICBcbiAqICAgQEF1ZGl0ZWQoeyBvcGVyYXRpb246ICdwZXJtaXNzaW9uLmNoYW5nZScgfSlcbiAqICAgYXN5bmMgdXBkYXRlUGVybWlzc2lvbnModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAqICAgICAvLyBBdXRvbWF0aWNhbGx5IGF1ZGl0ZWRcbiAqICAgfVxuICogfVxuICogYGBgXG4gKiBcbiAqIElNUE9SVEFOVDogRGVjb3JhdG9ycyByZXF1aXJlIGFuIGV4ZWN1dGlvbiBjb250ZXh0IHRvIGJlIGVzdGFibGlzaGVkLlxuICogQ29udGV4dCBpcyBhdXRvLWVzdGFibGlzaGVkIGluIGNvbnRyb2xsZXJzLCBvciB1c2UgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoKS5cbiAqL1xuXG5leHBvcnQgeyBUcmFjZWQsIFRyYWNlZE9wdGlvbnMgfSBmcm9tICcuL3RyYWNlZCc7XG5leHBvcnQgeyBBdWRpdGVkLCBBdWRpdGVkT3B0aW9ucyB9IGZyb20gJy4vYXVkaXRlZCc7XG5leHBvcnQgeyBPYnNlcnZlZCwgT2JzZXJ2ZWRPcHRpb25zIH0gZnJvbSAnLi9vYnNlcnZlZCc7XG5leHBvcnQgeyBDaGVja3BvaW50LCBDaGVja3BvaW50T3B0aW9ucyB9IGZyb20gJy4vY2hlY2twb2ludCc7XG5leHBvcnQgeyBMb2csIExvZ09wdGlvbnMgfSBmcm9tICcuL2xvZyc7XG5leHBvcnQgeyBNZXRyaWMsIE1ldHJpY09wdGlvbnMgfSBmcm9tICcuL21ldHJpYyc7Il19