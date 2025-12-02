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
 * IMPORTANT: Decorators require an observation context to be established.
 * Use runWithContext() or Observer.withContext() before calling
 * decorated methods.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Audited = exports.Traced = void 0;
var traced_1 = require("./traced");
Object.defineProperty(exports, "Traced", { enumerable: true, get: function () { return traced_1.Traced; } });
var audited_1 = require("./audited");
Object.defineProperty(exports, "Audited", { enumerable: true, get: function () { return audited_1.Audited; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9kZWNvcmF0b3JzL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXlCRzs7O0FBRUgsbUNBQWlEO0FBQXhDLGdHQUFBLE1BQU0sT0FBQTtBQUNmLHFDQUFvRDtBQUEzQyxrR0FBQSxPQUFPLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHkgRGVjb3JhdG9yc1xuICogXG4gKiBNZXRob2QgZGVjb3JhdG9ycyBmb3IgYXV0b21hdGljIHRyYWNpbmcgYW5kIGF1ZGl0aW5nLlxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IFRyYWNlZCwgQXVkaXRlZCB9IGZyb20gJ0B0ZW4yNGdyb3VwL2Z3MjQvb2JzZXJ2YWJpbGl0eSc7XG4gKiBcbiAqIGNsYXNzIFVzZXJTZXJ2aWNlIHtcbiAqICAgQFRyYWNlZCgpXG4gKiAgIGFzeW5jIGNyZWF0ZVVzZXIoZGF0YTogQ3JlYXRlVXNlcklucHV0KTogUHJvbWlzZTxVc2VyPiB7XG4gKiAgICAgLy8gQXV0b21hdGljYWxseSB0cmFjZWRcbiAqICAgfVxuICogICBcbiAqICAgQEF1ZGl0ZWQoeyBvcGVyYXRpb246ICdwZXJtaXNzaW9uLmNoYW5nZScgfSlcbiAqICAgYXN5bmMgdXBkYXRlUGVybWlzc2lvbnModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAqICAgICAvLyBBdXRvbWF0aWNhbGx5IGF1ZGl0ZWRcbiAqICAgfVxuICogfVxuICogYGBgXG4gKiBcbiAqIElNUE9SVEFOVDogRGVjb3JhdG9ycyByZXF1aXJlIGFuIG9ic2VydmF0aW9uIGNvbnRleHQgdG8gYmUgZXN0YWJsaXNoZWQuXG4gKiBVc2UgcnVuV2l0aENvbnRleHQoKSBvciBPYnNlcnZlci53aXRoQ29udGV4dCgpIGJlZm9yZSBjYWxsaW5nXG4gKiBkZWNvcmF0ZWQgbWV0aG9kcy5cbiAqL1xuXG5leHBvcnQgeyBUcmFjZWQsIFRyYWNlZE9wdGlvbnMgfSBmcm9tICcuL3RyYWNlZCc7XG5leHBvcnQgeyBBdWRpdGVkLCBBdWRpdGVkT3B0aW9ucyB9IGZyb20gJy4vYXVkaXRlZCc7XG5cbiJdfQ==