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
exports.Observed = exports.Audited = exports.Traced = void 0;
var traced_1 = require("./traced");
Object.defineProperty(exports, "Traced", { enumerable: true, get: function () { return traced_1.Traced; } });
var audited_1 = require("./audited");
Object.defineProperty(exports, "Audited", { enumerable: true, get: function () { return audited_1.Audited; } });
var observed_1 = require("./observed");
Object.defineProperty(exports, "Observed", { enumerable: true, get: function () { return observed_1.Observed; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9kZWNvcmF0b3JzL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXlCRzs7O0FBRUgsbUNBQWlEO0FBQXhDLGdHQUFBLE1BQU0sT0FBQTtBQUNmLHFDQUFvRDtBQUEzQyxrR0FBQSxPQUFPLE9BQUE7QUFDaEIsdUNBQXVEO0FBQTlDLG9HQUFBLFFBQVEsT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eSBEZWNvcmF0b3JzXG4gKiBcbiAqIE1ldGhvZCBkZWNvcmF0b3JzIGZvciBhdXRvbWF0aWMgdHJhY2luZyBhbmQgYXVkaXRpbmcuXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgVHJhY2VkLCBBdWRpdGVkIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNC9vYnNlcnZhYmlsaXR5JztcbiAqIFxuICogY2xhc3MgVXNlclNlcnZpY2Uge1xuICogICBAVHJhY2VkKClcbiAqICAgYXN5bmMgY3JlYXRlVXNlcihkYXRhOiBDcmVhdGVVc2VySW5wdXQpOiBQcm9taXNlPFVzZXI+IHtcbiAqICAgICAvLyBBdXRvbWF0aWNhbGx5IHRyYWNlZFxuICogICB9XG4gKiAgIFxuICogICBAQXVkaXRlZCh7IG9wZXJhdGlvbjogJ3Blcm1pc3Npb24uY2hhbmdlJyB9KVxuICogICBhc3luYyB1cGRhdGVQZXJtaXNzaW9ucyh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICogICAgIC8vIEF1dG9tYXRpY2FsbHkgYXVkaXRlZFxuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqIFxuICogSU1QT1JUQU5UOiBEZWNvcmF0b3JzIHJlcXVpcmUgYW4gb2JzZXJ2YXRpb24gY29udGV4dCB0byBiZSBlc3RhYmxpc2hlZC5cbiAqIFVzZSBydW5XaXRoQ29udGV4dCgpIG9yIE9ic2VydmVyLndpdGhDb250ZXh0KCkgYmVmb3JlIGNhbGxpbmdcbiAqIGRlY29yYXRlZCBtZXRob2RzLlxuICovXG5cbmV4cG9ydCB7IFRyYWNlZCwgVHJhY2VkT3B0aW9ucyB9IGZyb20gJy4vdHJhY2VkJztcbmV4cG9ydCB7IEF1ZGl0ZWQsIEF1ZGl0ZWRPcHRpb25zIH0gZnJvbSAnLi9hdWRpdGVkJztcbmV4cG9ydCB7IE9ic2VydmVkLCBPYnNlcnZlZE9wdGlvbnMgfSBmcm9tICcuL29ic2VydmVkJztcbiJdfQ==