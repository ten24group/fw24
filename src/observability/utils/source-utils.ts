/**
 * Utility functions for automatic source tracking
 */

import { ConfigManager } from '../config';

/**
 * Auto-detect the source of an observability event
 * 
 * Priority:
 * 1. Explicit source passed in event
 * 2. Lambda function name from environment
 * 3. Controller/class context (if available)
 * 4. Call stack analysis (development only)
 */
export function detectSource(explicitSource?: string): string | undefined {
  // Use explicit source if provided
  if (explicitSource) {
    return explicitSource;
  }

  // Try Lambda function name
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (functionName) {
    return `lambda:${functionName}`;
  }

  // In development, try to get caller info from stack trace
  if (process.env.NODE_ENV === 'development' || process.env.OBSERVABILITY_CAPTURE_STACK) {
    try {
      const caller = getCallerInfo();
      if (caller) {
        return caller;
      }
    } catch (error) {
      // Ignore errors in stack parsing
    }
  }

  return undefined;
}

/**
 * Extract caller information from stack trace (development only)
 * 
 * This is useful for debugging but has performance overhead,
 * so it's only enabled in development or with explicit flag.
 */
function getCallerInfo(): string | undefined {
  const originalPrepareStackTrace = Error.prepareStackTrace;

  try {
    Error.prepareStackTrace = (_, stack) => stack;
    const stack = new Error().stack as unknown as NodeJS.CallSite[];

    // Skip our own utility files
    for (const frame of stack) {
      const fileName = frame.getFileName();
      if (!fileName) continue;

      // Skip internal/framework files
      if (
        fileName.includes('node_modules') ||
        fileName.includes('observability/manager') ||
        fileName.includes('observability/utils') ||
        fileName.includes('observability/span') ||
        fileName.includes('observability/metrics')
      ) {
        continue;
      }

      // Extract useful info
      const functionName = frame.getFunctionName() || 'anonymous';
      const lineNumber = frame.getLineNumber();
      const shortFileName = fileName.split('/').slice(-2).join('/'); // Last 2 parts

      return `${shortFileName}:${functionName}:${lineNumber}`;
    }
  } catch (error) {
    // Stack trace parsing failed
    return undefined;
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }

  return undefined;
}

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
export function createControllerSource(className: string, methodName: string): string {
  return `controller:${className}.${methodName}`;
}

/**
 * Create a source identifier for a service method
 */
export function createServiceSource(serviceName: string, methodName: string): string {
  return `service:${serviceName}.${methodName}`;
}

/**
 * Create a source identifier for a queue handler
 */
export function createQueueSource(queueName: string, handlerName?: string): string {
  return handlerName ? `queue:${queueName}.${handlerName}` : `queue:${queueName}`;
}

/**
 * Create a source identifier for a queue handler
 */
export function createTaskSource(taskName: string, handlerName?: string): string {
  return handlerName ? `task:${taskName}.${handlerName}` : `task:${taskName}`;
}

// Cached environment tags - computed once, reused for all events
let _cachedEnvTags: Record<string, string> | null = null;

/**
 * Extract common tags from environment
 * 
 * CACHED: Computed once on first call, reused for all subsequent calls.
 * This is safe because environment variables don't change during Lambda execution.
 * 
 * NOTE: Most of these are AWS runtime environment variables that are
 * automatically set by the Lambda runtime, not application config.
 * Application-level config (like serviceName) comes from ConfigManager.
 */
export function getEnvironmentTags(): Record<string, string> {
  if (_cachedEnvTags !== null) {
    return _cachedEnvTags;
  }

  const tags: Record<string, string> = {};

  // AWS Lambda runtime environment (automatically set by AWS)
  const awsRegion = process.env.AWS_REGION;
  if (awsRegion) {
    tags.region = awsRegion;
  }

  const functionVersion = process.env.AWS_LAMBDA_FUNCTION_VERSION;
  if (functionVersion) {
    tags.functionVersion = functionVersion;
  }

  // Application environment
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv) {
    tags.environment = nodeEnv;
  }

  const stage = process.env.STAGE;
  if (stage) {
    tags.stage = stage;
  }

  // Service name - from ConfigManager (single source of truth)
  const serviceName = ConfigManager.fromEnvironment().serviceName;
  if (serviceName) {
    tags.service = serviceName;
  }

  // Version/deployment
  const appVersion = process.env.APP_VERSION;
  if (appVersion) {
    tags.version = appVersion;
  }

  const deploymentId = process.env.DEPLOYMENT_ID;
  if (deploymentId) {
    tags.deployment = deploymentId;
  }

  _cachedEnvTags = tags;
  return tags;
}

/**
 * Clear cached environment tags (for testing)
 */
export function clearEnvironmentTagsCache(): void {
  _cachedEnvTags = null;
}

/**
 * Merge tags with defaults
 * 
 * Event-specific tags override environment tags
 */
export function mergeTags(
  eventTags?: Record<string, string>,
  includeEnvironment: boolean = true,
): Record<string, string> | undefined {
  if (!includeEnvironment && !eventTags) {
    return undefined;
  }

  const merged = includeEnvironment ? getEnvironmentTags() : {};

  if (eventTags) {
    Object.assign(merged, eventTags);
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

