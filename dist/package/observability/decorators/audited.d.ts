/**
 * @Audited Decorator - Automatic audit logging for methods
 *
 * Records audit events for method calls, useful for tracking
 * sensitive operations, permission changes, etc.
 *
 * Usage:
 * ```typescript
 * class UserService {
 *   @Audited({ operation: 'permission.change' })
 *   async updatePermissions(userId: string, permissions: string[]): Promise<void> {
 *     // Method is automatically audited
 *   }
 *
 *   @Audited({
 *     operation: 'sensitive.access',
 *     level: 'warn',
 *     capture: { args: true }
 *   })
 *   async accessSensitiveData(userId: string): Promise<SensitiveData> {
 *     // Audit with arguments captured
 *   }
 * }
 * ```
 */
import type { DecoratorBaseOptions } from '../types';
export interface AuditedOptions extends DecoratorBaseOptions {
    /** Audit operation name (defaults to ClassName.methodName) */
    operation?: string;
    /** Entity name being audited (optional) */
    entityName?: string;
    /** Audit level */
    level?: 'info' | 'warn' | 'error';
    /** Specific argument names to capture (requires capture.args to be enabled) */
    argNames?: string[];
    /** Custom data extractor function */
    dataExtractor?: (args: unknown[], result?: unknown) => Record<string, unknown>;
}
/**
 * Method decorator that records an audit event for method calls
 */
export declare function Audited(options?: AuditedOptions): <T extends (...args: any[]) => any>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
