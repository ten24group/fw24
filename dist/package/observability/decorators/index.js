"use strict";
/**
 * Observability Decorators
 *
 * Method decorators for automatic observability instrumentation.
 *
 * Usage:
 * ```typescript
 * import { Observed } from '@ten24group/fw24/observability';
 *
 * class UserService {
 *   @Observed({ operation: 'user.create', type: 'span' })
 *   async createUser(data: CreateUserInput): Promise<User> {
 *     // Automatically observed with span, audit, logging
 *   }
 * }
 * ```
 *
 * IMPORTANT: Decorators require an execution context to be established.
 * Context is auto-established in controllers, or use runWithExecutionContext().
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Observed = void 0;
var observed_1 = require("./observed");
Object.defineProperty(exports, "Observed", { enumerable: true, get: function () { return observed_1.Observed; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9kZWNvcmF0b3JzL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRzs7O0FBRUgsdUNBQXVEO0FBQTlDLG9HQUFBLFFBQVEsT0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eSBEZWNvcmF0b3JzXG4gKiBcbiAqIE1ldGhvZCBkZWNvcmF0b3JzIGZvciBhdXRvbWF0aWMgb2JzZXJ2YWJpbGl0eSBpbnN0cnVtZW50YXRpb24uXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgT2JzZXJ2ZWQgfSBmcm9tICdAdGVuMjRncm91cC9mdzI0L29ic2VydmFiaWxpdHknO1xuICogXG4gKiBjbGFzcyBVc2VyU2VydmljZSB7XG4gKiAgIEBPYnNlcnZlZCh7IG9wZXJhdGlvbjogJ3VzZXIuY3JlYXRlJywgdHlwZTogJ3NwYW4nIH0pXG4gKiAgIGFzeW5jIGNyZWF0ZVVzZXIoZGF0YTogQ3JlYXRlVXNlcklucHV0KTogUHJvbWlzZTxVc2VyPiB7XG4gKiAgICAgLy8gQXV0b21hdGljYWxseSBvYnNlcnZlZCB3aXRoIHNwYW4sIGF1ZGl0LCBsb2dnaW5nXG4gKiAgIH1cbiAqIH1cbiAqIGBgYFxuICogXG4gKiBJTVBPUlRBTlQ6IERlY29yYXRvcnMgcmVxdWlyZSBhbiBleGVjdXRpb24gY29udGV4dCB0byBiZSBlc3RhYmxpc2hlZC5cbiAqIENvbnRleHQgaXMgYXV0by1lc3RhYmxpc2hlZCBpbiBjb250cm9sbGVycywgb3IgdXNlIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KCkuXG4gKi9cblxuZXhwb3J0IHsgT2JzZXJ2ZWQsIE9ic2VydmVkT3B0aW9ucyB9IGZyb20gJy4vb2JzZXJ2ZWQnO1xuIl19