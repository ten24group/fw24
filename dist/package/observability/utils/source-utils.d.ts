/**
 * Utility functions for automatic source tracking
 */
/**
 * Auto-detect the source of an observability event
 *
 * Priority:
 * 1. Explicit source passed in event
 * 2. Lambda function name from environment
 * 3. Controller/class context (if available)
 * 4. Call stack analysis (development only)
 */
export declare function detectSource(explicitSource?: string): string | undefined;
/**
 * Create a source identifier for a controller method
 *
 * Usage in decorators:
 * ```typescript
 * @Traced()
 * async myMethod() {
 *   // Source will be: controller:MyController.myMethod
 * }
 * ```
 */
export declare function createControllerSource(className: string, methodName: string): string;
/**
 * Create a source identifier for a service method
 */
export declare function createServiceSource(serviceName: string, methodName: string): string;
/**
 * Create a source identifier for a queue handler
 */
export declare function createQueueSource(queueName: string, handlerName?: string): string;
/**
 * Create a source identifier for a task
 */
export declare function createTaskSource(taskName: string): string;
/**
 * Extract common tags from environment
 *
 * Useful for consistent tagging across all events
 */
export declare function getEnvironmentTags(): Record<string, string>;
/**
 * Merge tags with defaults
 *
 * Event-specific tags override environment tags
 */
export declare function mergeTags(eventTags?: Record<string, string>, includeEnvironment?: boolean): Record<string, string> | undefined;
