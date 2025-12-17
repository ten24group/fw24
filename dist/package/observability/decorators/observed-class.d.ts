/**
 * @ObservedClass Decorator - Class-level observability configuration
 *
 * Automatically applies observability to all or selected methods in a class.
 * Useful for services, controllers, or any class where you want comprehensive tracking.
 *
 * Usage:
 * ```typescript
 * @ObservedClass({ traceAll: true, sourceType: 'service' })
 * class OrderService {
 *   // All methods automatically traced
 *   async createOrder(order: Order): Promise<Order> { ... }
 *   async updateOrder(id: string, data: Partial<Order>): Promise<Order> { ... }
 *   async deleteOrder(id: string): Promise<void> { ... }
 * }
 *
 * @ObservedClass({
 *   trace: true,
 *   audit: true,
 *   exclude: ['internalHelper', 'privateMethod']
 * })
 * class UserService {
 *   async createUser(data: UserData): Promise<User> { ... } // Traced + Audited
 *   async updateUser(id: string, data: Partial<UserData>): Promise<User> { ... } // Traced + Audited
 *   private internalHelper(): void { ... } // Excluded
 * }
 * ```
 *
 * REQUIREMENTS:
 * - Must be called within an observation context (runWithContext)
 * - Methods must be async or return synchronous values
 */
export interface ObservedClassOptions {
    /** Source type for all methods in the class */
    sourceType?: 'controller' | 'service' | 'handler' | 'queue' | 'task';
    /** Default level for all observations */
    level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    /** Enable tracing for all methods */
    traceAll?: boolean;
    /** Enable tracing with specific options */
    trace?: boolean | {
        level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
        captureArgs?: boolean;
        captureResult?: boolean;
    };
    /** Enable audit for all methods */
    audit?: boolean | {
        level?: 'info' | 'warn' | 'error';
        captureArgs?: boolean;
        captureResult?: boolean;
    };
    /** Enable metrics for all methods */
    metric?: boolean | {
        type?: 'counter' | 'timing';
        unit?: string;
    };
    /** Methods to exclude from observability */
    exclude?: string[];
    /** Methods to include (if provided, only these will be observed) */
    include?: string[];
    /** Tags applied to all observations in this class */
    tags?: Record<string, string>;
    /** Capture arguments for all methods */
    captureArgs?: boolean;
    /** Capture results for all methods */
    captureResult?: boolean;
    /**
     * Conditionally enable/disable observability for all methods.
     * - Static boolean: `enabled: false` to disable
     * - Dynamic function: `enabled: () => someCondition()`
     * Function receives no arguments but can access getCurrentContext() internally.
     * Default: true (enabled)
     */
    enabled?: boolean | (() => boolean);
}
/**
 * Class decorator that automatically applies observability to methods
 *
 * @param options - Class-level observability options
 */
export declare function ObservedClass(options?: ObservedClassOptions): <T extends {
    new (...args: any[]): {};
}>(constructor: T) => T;
