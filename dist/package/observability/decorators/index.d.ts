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
export { Observed, ObservedOptions } from './observed';
