export interface TracedOptions {
    operation?: string;
    level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';
    source?: string;
    tags?: Record<string, string>;
}
/**
 * Decorator to automatically trace method execution
 *
 * @example
 * ```typescript
 * class MyService {
 *   async processOrder(orderId: string) {
 *     // method body
 *   }
 * }
 * ```
 */
export declare function Traced(options?: TracedOptions): MethodDecorator;
