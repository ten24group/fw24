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
 * Create a source identifier for a queue handler
 */
export declare function createTaskSource(taskName: string, handlerName?: string): string;
export type SourceType = 'controller' | 'service' | 'queue' | 'task' | 'handler';
/**
 * Auto-detect source type from class name.
 * Used by decorators to infer the source type when not explicitly provided.
 */
export declare function autoDetectSourceType(className: string): SourceType;
/**
 * Map source type to actual source string.
 * Centralizes the switch logic that was duplicated in @Observed and @Traced.
 */
export declare function resolveSource(sourceType: SourceType | undefined, className: string, methodName: string): string;
/**
 * Extract common tags from environment
 *
 * CACHED: Computed once on first call, reused for all subsequent calls.
 * This is safe because environment variables don't change during Lambda execution.
 *
 * NOTE: Most of these are AWS runtime environment variables that are
 * automatically set by the Lambda runtime, not application config.
 * Application-level config (like serviceName) comes from DI config.
 */
export declare function getEnvironmentTags(): Record<string, string>;
/**
 * Clear cached environment tags (for testing)
 */
export declare function clearEnvironmentTagsCache(): void;
/**
 * Merge tags with defaults
 *
 * Event-specific tags override environment tags.
 *
 * IMPORTANT: Always creates a new object to avoid mutating cached environment tags.
 */
export declare function mergeTags(eventTags?: Record<string, string>, includeEnvironment?: boolean): Record<string, string> | undefined;
