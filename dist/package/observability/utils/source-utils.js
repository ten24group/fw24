"use strict";
/**
 * Utility functions for automatic source tracking
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSource = detectSource;
exports.createControllerSource = createControllerSource;
exports.createServiceSource = createServiceSource;
exports.createQueueSource = createQueueSource;
exports.createTaskSource = createTaskSource;
exports.getEnvironmentTags = getEnvironmentTags;
exports.clearEnvironmentTagsCache = clearEnvironmentTagsCache;
exports.mergeTags = mergeTags;
const config_1 = require("../config");
/**
 * Auto-detect the source of an observability event
 *
 * Priority:
 * 1. Explicit source passed in event
 * 2. Lambda function name from environment
 * 3. Controller/class context (if available)
 * 4. Call stack analysis (development only)
 */
function detectSource(explicitSource) {
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
        }
        catch (error) {
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
function getCallerInfo() {
    const originalPrepareStackTrace = Error.prepareStackTrace;
    try {
        Error.prepareStackTrace = (_, stack) => stack;
        const stack = new Error().stack;
        // Skip our own utility files
        for (const frame of stack) {
            const fileName = frame.getFileName();
            if (!fileName)
                continue;
            // Skip internal/framework files
            if (fileName.includes('node_modules') ||
                fileName.includes('observability/manager') ||
                fileName.includes('observability/utils') ||
                fileName.includes('observability/span') ||
                fileName.includes('observability/metrics')) {
                continue;
            }
            // Extract useful info
            const functionName = frame.getFunctionName() || 'anonymous';
            const lineNumber = frame.getLineNumber();
            const shortFileName = fileName.split('/').slice(-2).join('/'); // Last 2 parts
            return `${shortFileName}:${functionName}:${lineNumber}`;
        }
    }
    catch (error) {
        // Stack trace parsing failed
        return undefined;
    }
    finally {
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
function createControllerSource(className, methodName) {
    return `controller:${className}.${methodName}`;
}
/**
 * Create a source identifier for a service method
 */
function createServiceSource(serviceName, methodName) {
    return `service:${serviceName}.${methodName}`;
}
/**
 * Create a source identifier for a queue handler
 */
function createQueueSource(queueName, handlerName) {
    return handlerName ? `queue:${queueName}.${handlerName}` : `queue:${queueName}`;
}
/**
 * Create a source identifier for a queue handler
 */
function createTaskSource(taskName, handlerName) {
    return handlerName ? `task:${taskName}.${handlerName}` : `task:${taskName}`;
}
// Cached environment tags - computed once, reused for all events
let _cachedEnvTags = null;
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
function getEnvironmentTags() {
    if (_cachedEnvTags !== null) {
        return _cachedEnvTags;
    }
    const tags = {};
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
    const serviceName = config_1.ConfigManager.fromEnvironment().serviceName;
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
function clearEnvironmentTagsCache() {
    _cachedEnvTags = null;
}
/**
 * Merge tags with defaults
 *
 * Event-specific tags override environment tags
 */
function mergeTags(eventTags, includeEnvironment = true) {
    if (!includeEnvironment && !eventTags) {
        return undefined;
    }
    const merged = includeEnvironment ? getEnvironmentTags() : {};
    if (eventTags) {
        Object.assign(merged, eventTags);
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic291cmNlLXV0aWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvdXRpbHMvc291cmNlLXV0aWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7R0FFRzs7QUFhSCxvQ0F5QkM7QUEyREQsd0RBRUM7QUFLRCxrREFFQztBQUtELDhDQUVDO0FBS0QsNENBRUM7QUFlRCxnREFnREM7QUFLRCw4REFFQztBQU9ELDhCQWVDO0FBbE5ELHNDQUEwQztBQUUxQzs7Ozs7Ozs7R0FRRztBQUNILFNBQWdCLFlBQVksQ0FBQyxjQUF1QjtJQUNsRCxrQ0FBa0M7SUFDbEMsSUFBSSxjQUFjLEVBQUUsQ0FBQztRQUNuQixPQUFPLGNBQWMsQ0FBQztJQUN4QixDQUFDO0lBRUQsMkJBQTJCO0lBQzNCLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLENBQUM7SUFDMUQsSUFBSSxZQUFZLEVBQUUsQ0FBQztRQUNqQixPQUFPLFVBQVUsWUFBWSxFQUFFLENBQUM7SUFDbEMsQ0FBQztJQUVELDBEQUEwRDtJQUMxRCxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxLQUFLLGFBQWEsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLDJCQUEyQixFQUFFLENBQUM7UUFDdEYsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsYUFBYSxFQUFFLENBQUM7WUFDL0IsSUFBSSxNQUFNLEVBQUUsQ0FBQztnQkFDWCxPQUFPLE1BQU0sQ0FBQztZQUNoQixDQUFDO1FBQ0gsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixpQ0FBaUM7UUFDbkMsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQztBQUNuQixDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLGFBQWE7SUFDcEIsTUFBTSx5QkFBeUIsR0FBRyxLQUFLLENBQUMsaUJBQWlCLENBQUM7SUFFMUQsSUFB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O0FBQ3hCLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBZ0IsU0FBUyxDQUN2QixTQUFrQyxFQUNsQyxxQkFBOEIsSUFBSTtJQUVsQyxJQUFJLENBQUMsa0JBQWtCLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUN0QyxPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBRUQsTUFBTSxNQUFNLEdBQUcsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUU5RCxJQUFJLFNBQVMsRUFBRSxDQUFDO1FBQ2QsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDbkMsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztBQUM3RCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBVdGlsaXR5IGZ1bmN0aW9ucyBmb3IgYXV0b21hdGljIHNvdXJjZSB0cmFja2luZ1xuICovXG5cbmltcG9ydCB7IENvbmZpZ01hbmFnZXIgfSBmcm9tICcuLi9jb25maWcnO1xuXG4vKipcbiAqIEF1dG8tZGV0ZWN0IHRoZSBzb3VyY2Ugb2YgYW4gb2JzZXJ2YWJpbGl0eSBldmVudFxuICogXG4gKiBQcmlvcml0eTpcbiAqIDEuIEV4cGxpY2l0IHNvdXJjZSBwYXNzZWQgaW4gZXZlbnRcbiAqIDIuIExhbWJkYSBmdW5jdGlvbiBuYW1lIGZyb20gZW52aXJvbm1lbnRcbiAqIDMuIENvbnRyb2xsZXIvY2xhc3MgY29udGV4dCAoaWYgYXZhaWxhYmxlKVxuICogNC4gQ2FsbCBzdGFjayBhbmFseXNpcyAoZGV2ZWxvcG1lbnQgb25seSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRldGVjdFNvdXJjZShleHBsaWNpdFNvdXJjZT86IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIC8vIFVzZSBleHBsaWNpdCBzb3VyY2UgaWYgcHJvdmlkZWRcbiAgaWYgKGV4cGxpY2l0U291cmNlKSB7XG4gICAgcmV0dXJuIGV4cGxpY2l0U291cmNlO1xuICB9XG5cbiAgLy8gVHJ5IExhbWJkYSBmdW5jdGlvbiBuYW1lXG4gIGNvbnN0IGZ1bmN0aW9uTmFtZSA9IHByb2Nlc3MuZW52LkFXU19MQU1CREFfRlVOQ1RJT05fTkFNRTtcbiAgaWYgKGZ1bmN0aW9uTmFtZSkge1xuICAgIHJldHVybiBgbGFtYmRhOiR7ZnVuY3Rpb25OYW1lfWA7XG4gIH1cblxuICAvLyBJbiBkZXZlbG9wbWVudCwgdHJ5IHRvIGdldCBjYWxsZXIgaW5mbyBmcm9tIHN0YWNrIHRyYWNlXG4gIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50JyB8fCBwcm9jZXNzLmVudi5PQlNFUlZBQklMSVRZX0NBUFRVUkVfU1RBQ0spIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FsbGVyID0gZ2V0Q2FsbGVySW5mbygpO1xuICAgICAgaWYgKGNhbGxlcikge1xuICAgICAgICByZXR1cm4gY2FsbGVyO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBJZ25vcmUgZXJyb3JzIGluIHN0YWNrIHBhcnNpbmdcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgY2FsbGVyIGluZm9ybWF0aW9uIGZyb20gc3RhY2sgdHJhY2UgKGRldmVsb3BtZW50IG9ubHkpXG4gKiBcbiAqIFRoaXMgaXMgdXNlZnVsIGZvciBkZWJ1Z2dpbmcgYnV0IGhhcyBwZXJmb3JtYW5jZSBvdmVyaGVhZCxcbiAqIHNvIGl0J3Mgb25seSBlbmFibGVkIGluIGRldmVsb3BtZW50IG9yIHdpdGggZXhwbGljaXQgZmxhZy5cbiAqL1xuZnVuY3Rpb24gZ2V0Q2FsbGVySW5mbygpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBjb25zdCBvcmlnaW5hbFByZXBhcmVTdGFja1RyYWNlID0gRXJyb3IucHJlcGFyZVN0YWNrVHJhY2U7XG5cbiAgdHJ5IHtcbiAgICBFcnJvci5wcmVwYXJlU3RhY2tUcmFjZSA9IChfLCBzdGFjaykgPT4gc3RhY2s7XG4gICAgY29uc3Qgc3RhY2sgPSBuZXcgRXJyb3IoKS5zdGFjayBhcyB1bmtub3duIGFzIE5vZGVKUy5DYWxsU2l0ZVtdO1xuXG4gICAgLy8gU2tpcCBvdXIgb3duIHV0aWxpdHkgZmlsZXNcbiAgICBmb3IgKGNvbnN0IGZyYW1lIG9mIHN0YWNrKSB7XG4gICAgICBjb25zdCBmaWxlTmFtZSA9IGZyYW1lLmdldEZpbGVOYW1lKCk7XG4gICAgICBpZiAoIWZpbGVOYW1lKSBjb250aW51ZTtcblxuICAgICAgLy8gU2tpcCBpbnRlcm5hbC9mcmFtZXdvcmsgZmlsZXNcbiAgICAgIGlmIChcbiAgICAgICAgZmlsZU5hbWUuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcycpIHx8XG4gICAgICAgIGZpbGVOYW1lLmluY2x1ZGVzKCdvYnNlcnZhYmlsaXR5L21hbmFnZXInKSB8fFxuICAgICAgICBmaWxlTmFtZS5pbmNsdWRlcygnb2JzZXJ2YWJpbGl0eS91dGlscycpIHx8XG4gICAgICAgIGZpbGVOYW1lLmluY2x1ZGVzKCdvYnNlcnZhYmlsaXR5L3NwYW4nKSB8fFxuICAgICAgICBmaWxlTmFtZS5pbmNsdWRlcygnb2JzZXJ2YWJpbGl0eS9tZXRyaWNzJylcbiAgICAgICkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gRXh0cmFjdCB1c2VmdWwgaW5mb1xuICAgICAgY29uc3QgZnVuY3Rpb25OYW1lID0gZnJhbWUuZ2V0RnVuY3Rpb25OYW1lKCkgfHwgJ2Fub255bW91cyc7XG4gICAgICBjb25zdCBsaW5lTnVtYmVyID0gZnJhbWUuZ2V0TGluZU51bWJlcigpO1xuICAgICAgY29uc3Qgc2hvcnRGaWxlTmFtZSA9IGZpbGVOYW1lLnNwbGl0KCcvJykuc2xpY2UoLTIpLmpvaW4oJy8nKTsgLy8gTGFzdCAyIHBhcnRzXG5cbiAgICAgIHJldHVybiBgJHtzaG9ydEZpbGVOYW1lfToke2Z1bmN0aW9uTmFtZX06JHtsaW5lTnVtYmVyfWA7XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIC8vIFN0YWNrIHRyYWNlIHBhcnNpbmcgZmFpbGVkXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfSBmaW5hbGx5IHtcbiAgICBFcnJvci5wcmVwYXJlU3RhY2tUcmFjZSA9IG9yaWdpbmFsUHJlcGFyZVN0YWNrVHJhY2U7XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIHNvdXJjZSBpZGVudGlmaWVyIGZvciBhIGNvbnRyb2xsZXIgbWV0aG9kXG4gKiBcbiAqIFVzYWdlIGluIGRlY29yYXRvcnM6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBAVHJhY2VkKClcbiAqIGFzeW5jIG15TWV0aG9kKCkge1xuICogICAvLyBTb3VyY2Ugd2lsbCBiZTogY29udHJvbGxlcjpNeUNvbnRyb2xsZXIubXlNZXRob2RcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ29udHJvbGxlclNvdXJjZShjbGFzc05hbWU6IHN0cmluZywgbWV0aG9kTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBjb250cm9sbGVyOiR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YDtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBzb3VyY2UgaWRlbnRpZmllciBmb3IgYSBzZXJ2aWNlIG1ldGhvZFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU2VydmljZVNvdXJjZShzZXJ2aWNlTmFtZTogc3RyaW5nLCBtZXRob2ROYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYHNlcnZpY2U6JHtzZXJ2aWNlTmFtZX0uJHttZXRob2ROYW1lfWA7XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgc291cmNlIGlkZW50aWZpZXIgZm9yIGEgcXVldWUgaGFuZGxlclxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUXVldWVTb3VyY2UocXVldWVOYW1lOiBzdHJpbmcsIGhhbmRsZXJOYW1lPzogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGhhbmRsZXJOYW1lID8gYHF1ZXVlOiR7cXVldWVOYW1lfS4ke2hhbmRsZXJOYW1lfWAgOiBgcXVldWU6JHtxdWV1ZU5hbWV9YDtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBzb3VyY2UgaWRlbnRpZmllciBmb3IgYSBxdWV1ZSBoYW5kbGVyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVUYXNrU291cmNlKHRhc2tOYW1lOiBzdHJpbmcsIGhhbmRsZXJOYW1lPzogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGhhbmRsZXJOYW1lID8gYHRhc2s6JHt0YXNrTmFtZX0uJHtoYW5kbGVyTmFtZX1gIDogYHRhc2s6JHt0YXNrTmFtZX1gO1xufVxuXG4vLyBDYWNoZWQgZW52aXJvbm1lbnQgdGFncyAtIGNvbXB1dGVkIG9uY2UsIHJldXNlZCBmb3IgYWxsIGV2ZW50c1xubGV0IF9jYWNoZWRFbnZUYWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgbnVsbCA9IG51bGw7XG5cbi8qKlxuICogRXh0cmFjdCBjb21tb24gdGFncyBmcm9tIGVudmlyb25tZW50XG4gKiBcbiAqIENBQ0hFRDogQ29tcHV0ZWQgb25jZSBvbiBmaXJzdCBjYWxsLCByZXVzZWQgZm9yIGFsbCBzdWJzZXF1ZW50IGNhbGxzLlxuICogVGhpcyBpcyBzYWZlIGJlY2F1c2UgZW52aXJvbm1lbnQgdmFyaWFibGVzIGRvbid0IGNoYW5nZSBkdXJpbmcgTGFtYmRhIGV4ZWN1dGlvbi5cbiAqIFxuICogTk9URTogTW9zdCBvZiB0aGVzZSBhcmUgQVdTIHJ1bnRpbWUgZW52aXJvbm1lbnQgdmFyaWFibGVzIHRoYXQgYXJlXG4gKiBhdXRvbWF0aWNhbGx5IHNldCBieSB0aGUgTGFtYmRhIHJ1bnRpbWUsIG5vdCBhcHBsaWNhdGlvbiBjb25maWcuXG4gKiBBcHBsaWNhdGlvbi1sZXZlbCBjb25maWcgKGxpa2Ugc2VydmljZU5hbWUpIGNvbWVzIGZyb20gQ29uZmlnTWFuYWdlci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldEVudmlyb25tZW50VGFncygpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgaWYgKF9jYWNoZWRFbnZUYWdzICE9PSBudWxsKSB7XG4gICAgcmV0dXJuIF9jYWNoZWRFbnZUYWdzO1xuICB9XG5cbiAgY29uc3QgdGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuXG4gIC8vIEFXUyBMYW1iZGEgcnVudGltZSBlbnZpcm9ubWVudCAoYXV0b21hdGljYWxseSBzZXQgYnkgQVdTKVxuICBjb25zdCBhd3NSZWdpb24gPSBwcm9jZXNzLmVudi5BV1NfUkVHSU9OO1xuICBpZiAoYXdzUmVnaW9uKSB7XG4gICAgdGFncy5yZWdpb24gPSBhd3NSZWdpb247XG4gIH1cblxuICBjb25zdCBmdW5jdGlvblZlcnNpb24gPSBwcm9jZXNzLmVudi5BV1NfTEFNQkRBX0ZVTkNUSU9OX1ZFUlNJT047XG4gIGlmIChmdW5jdGlvblZlcnNpb24pIHtcbiAgICB0YWdzLmZ1bmN0aW9uVmVyc2lvbiA9IGZ1bmN0aW9uVmVyc2lvbjtcbiAgfVxuXG4gIC8vIEFwcGxpY2F0aW9uIGVudmlyb25tZW50XG4gIGNvbnN0IG5vZGVFbnYgPSBwcm9jZXNzLmVudi5OT0RFX0VOVjtcbiAgaWYgKG5vZGVFbnYpIHtcbiAgICB0YWdzLmVudmlyb25tZW50ID0gbm9kZUVudjtcbiAgfVxuXG4gIGNvbnN0IHN0YWdlID0gcHJvY2Vzcy5lbnYuU1RBR0U7XG4gIGlmIChzdGFnZSkge1xuICAgIHRhZ3Muc3RhZ2UgPSBzdGFnZTtcbiAgfVxuXG4gIC8vIFNlcnZpY2UgbmFtZSAtIGZyb20gQ29uZmlnTWFuYWdlciAoc2luZ2xlIHNvdXJjZSBvZiB0cnV0aClcbiAgY29uc3Qgc2VydmljZU5hbWUgPSBDb25maWdNYW5hZ2VyLmZyb21FbnZpcm9ubWVudCgpLnNlcnZpY2VOYW1lO1xuICBpZiAoc2VydmljZU5hbWUpIHtcbiAgICB0YWdzLnNlcnZpY2UgPSBzZXJ2aWNlTmFtZTtcbiAgfVxuXG4gIC8vIFZlcnNpb24vZGVwbG95bWVudFxuICBjb25zdCBhcHBWZXJzaW9uID0gcHJvY2Vzcy5lbnYuQVBQX1ZFUlNJT047XG4gIGlmIChhcHBWZXJzaW9uKSB7XG4gICAgdGFncy52ZXJzaW9uID0gYXBwVmVyc2lvbjtcbiAgfVxuXG4gIGNvbnN0IGRlcGxveW1lbnRJZCA9IHByb2Nlc3MuZW52LkRFUExPWU1FTlRfSUQ7XG4gIGlmIChkZXBsb3ltZW50SWQpIHtcbiAgICB0YWdzLmRlcGxveW1lbnQgPSBkZXBsb3ltZW50SWQ7XG4gIH1cblxuICBfY2FjaGVkRW52VGFncyA9IHRhZ3M7XG4gIHJldHVybiB0YWdzO1xufVxuXG4vKipcbiAqIENsZWFyIGNhY2hlZCBlbnZpcm9ubWVudCB0YWdzIChmb3IgdGVzdGluZylcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyRW52aXJvbm1lbnRUYWdzQ2FjaGUoKTogdm9pZCB7XG4gIF9jYWNoZWRFbnZUYWdzID0gbnVsbDtcbn1cblxuLyoqXG4gKiBNZXJnZSB0YWdzIHdpdGggZGVmYXVsdHNcbiAqIFxuICogRXZlbnQtc3BlY2lmaWMgdGFncyBvdmVycmlkZSBlbnZpcm9ubWVudCB0YWdzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZVRhZ3MoXG4gIGV2ZW50VGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gIGluY2x1ZGVFbnZpcm9ubWVudDogYm9vbGVhbiA9IHRydWUsXG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFpbmNsdWRlRW52aXJvbm1lbnQgJiYgIWV2ZW50VGFncykge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBjb25zdCBtZXJnZWQgPSBpbmNsdWRlRW52aXJvbm1lbnQgPyBnZXRFbnZpcm9ubWVudFRhZ3MoKSA6IHt9O1xuXG4gIGlmIChldmVudFRhZ3MpIHtcbiAgICBPYmplY3QuYXNzaWduKG1lcmdlZCwgZXZlbnRUYWdzKTtcbiAgfVxuXG4gIHJldHVybiBPYmplY3Qua2V5cyhtZXJnZWQpLmxlbmd0aCA+IDAgPyBtZXJnZWQgOiB1bmRlZmluZWQ7XG59XG5cbiJdfQ==