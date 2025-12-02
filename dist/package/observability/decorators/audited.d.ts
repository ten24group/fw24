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
 *     captureArgs: true
 *   })
 *   async accessSensitiveData(userId: string): Promise<SensitiveData> {
 *     // Audit with arguments captured
 *   }
 * }
 * ```
 *
 * REQUIREMENTS:
 * - Must be called within an observation context (runWithContext)
 * - Otherwise logs warning and doesn't record anything
 */
export interface AuditedOptions {
    /** Audit operation name (defaults to ClassName.methodName) */
    operation?: string;
    /** Entity name being audited (optional) */
    entityName?: string;
    /** Audit level */
    level?: 'info' | 'warn' | 'error';
    /** Whether to capture method arguments in audit data */
    captureArgs?: boolean;
    /** Whether to capture return value in audit data */
    captureResult?: boolean;
    /** Specific argument names to capture (if captureArgs is false) */
    argNames?: string[];
    /** Custom data extractor function */
    dataExtractor?: (args: unknown[], result?: unknown) => Record<string, unknown>;
    /** Tags for filtering */
    tags?: Record<string, string>;
}
/**
 * Method decorator that records an audit event for method calls
 *
 * @param options - Audit options
 */
export declare function Audited(options?: AuditedOptions): <T extends (...args: unknown[]) => unknown>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
