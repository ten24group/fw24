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

export { Traced, TracedOptions } from './traced';
export { Audited, AuditedOptions } from './audited';
export { Observed, ObservedOptions } from './observed';
