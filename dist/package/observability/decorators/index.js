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
exports.Observed = exports.Audited = exports.Traced = void 0;
var traced_1 = require("./traced");
Object.defineProperty(exports, "Traced", { enumerable: true, get: function () { return traced_1.Traced; } });
var audited_1 = require("./audited");
Object.defineProperty(exports, "Audited", { enumerable: true, get: function () { return audited_1.Audited; } });
var observed_1 = require("./observed");
Object.defineProperty(exports, "Observed", { enumerable: true, get: function () { return observed_1.Observed; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9kZWNvcmF0b3JzL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBd0JHOzs7QUFFSCxtQ0FBaUQ7QUFBeEMsZ0dBQUEsTUFBTSxPQUFBO0FBQ2YscUNBQW9EO0FBQTNDLGtHQUFBLE9BQU8sT0FBQTtBQUNoQix1Q0FBdUQ7QUFBOUMsb0dBQUEsUUFBUSxPQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5IERlY29yYXRvcnNcbiAqIFxuICogTWV0aG9kIGRlY29yYXRvcnMgZm9yIGF1dG9tYXRpYyB0cmFjaW5nIGFuZCBhdWRpdGluZy5cbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBUcmFjZWQsIEF1ZGl0ZWQgfSBmcm9tICdAdGVuMjRncm91cC9mdzI0L29ic2VydmFiaWxpdHknO1xuICogXG4gKiBjbGFzcyBVc2VyU2VydmljZSB7XG4gKiAgIEBUcmFjZWQoKVxuICogICBhc3luYyBjcmVhdGVVc2VyKGRhdGE6IENyZWF0ZVVzZXJJbnB1dCk6IFByb21pc2U8VXNlcj4ge1xuICogICAgIC8vIEF1dG9tYXRpY2FsbHkgdHJhY2VkXG4gKiAgIH1cbiAqICAgXG4gKiAgIEBBdWRpdGVkKHsgb3BlcmF0aW9uOiAncGVybWlzc2lvbi5jaGFuZ2UnIH0pXG4gKiAgIGFzeW5jIHVwZGF0ZVBlcm1pc3Npb25zKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gKiAgICAgLy8gQXV0b21hdGljYWxseSBhdWRpdGVkXG4gKiAgIH1cbiAqIH1cbiAqIGBgYFxuICogXG4gKiBJTVBPUlRBTlQ6IERlY29yYXRvcnMgcmVxdWlyZSBhbiBleGVjdXRpb24gY29udGV4dCB0byBiZSBlc3RhYmxpc2hlZC5cbiAqIENvbnRleHQgaXMgYXV0by1lc3RhYmxpc2hlZCBpbiBjb250cm9sbGVycywgb3IgdXNlIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KCkuXG4gKi9cblxuZXhwb3J0IHsgVHJhY2VkLCBUcmFjZWRPcHRpb25zIH0gZnJvbSAnLi90cmFjZWQnO1xuZXhwb3J0IHsgQXVkaXRlZCwgQXVkaXRlZE9wdGlvbnMgfSBmcm9tICcuL2F1ZGl0ZWQnO1xuZXhwb3J0IHsgT2JzZXJ2ZWQsIE9ic2VydmVkT3B0aW9ucyB9IGZyb20gJy4vb2JzZXJ2ZWQnO1xuIl19