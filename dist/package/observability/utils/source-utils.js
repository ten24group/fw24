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
exports.mergeTags = mergeTags;
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
 * Create a source identifier for a task
 */
function createTaskSource(taskName) {
    return `task:${taskName}`;
}
/**
 * Extract common tags from environment
 *
 * Useful for consistent tagging across all events
 */
function getEnvironmentTags() {
    const tags = {};
    // AWS environment
    if (process.env.AWS_REGION) {
        tags.region = process.env.AWS_REGION;
    }
    if (process.env.AWS_LAMBDA_FUNCTION_VERSION) {
        tags.functionVersion = process.env.AWS_LAMBDA_FUNCTION_VERSION;
    }
    // Application environment
    if (process.env.NODE_ENV) {
        tags.environment = process.env.NODE_ENV;
    }
    if (process.env.STAGE) {
        tags.stage = process.env.STAGE;
    }
    if (process.env.SERVICE_NAME) {
        tags.service = process.env.SERVICE_NAME;
    }
    // Version/deployment
    if (process.env.APP_VERSION) {
        tags.version = process.env.APP_VERSION;
    }
    if (process.env.DEPLOYMENT_ID) {
        tags.deployment = process.env.DEPLOYMENT_ID;
    }
    return tags;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic291cmNlLXV0aWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvdXRpbHMvc291cmNlLXV0aWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7R0FFRzs7QUFXSCxvQ0F5QkM7QUEyREQsd0RBRUM7QUFLRCxrREFFQztBQUtELDhDQUVDO0FBS0QsNENBRUM7QUFPRCxnREFtQ0M7QUFPRCw4QkFlQztBQXBMRDs7Ozs7Ozs7R0FRRztBQUNILFNBQWdCLFlBQVksQ0FBQyxjQUF1QjtJQUNsRCxrQ0FBa0M7SUFDbEMsSUFBSSxjQUFjLEVBQUUsQ0FBQztRQUNuQixPQUFPLGNBQWMsQ0FBQztJQUN4QixDQUFDO0lBRUQsMkJBQTJCO0lBQzNCLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLENBQUM7SUFDMUQsSUFBSSxZQUFZLEVBQUUsQ0FBQztRQUNqQixPQUFPLFVBQVUsWUFBWSxFQUFFLENBQUM7SUFDbEMsQ0FBQztJQUVELDBEQUEwRDtJQUMxRCxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxLQUFLLGFBQWEsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLDJCQUEyQixFQUFFLENBQUM7UUFDdEYsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsYUFBYSxFQUFFLENBQUM7WUFDL0IsSUFBSSxNQUFNLEVBQUUsQ0FBQztnQkFDWCxPQUFPLE1BQU0sQ0FBQztZQUNoQixDQUFDO1FBQ0gsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixpQ0FBaUM7UUFDbkMsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQztBQUNuQixDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLGFBQWE7SUFDcEIsTUFBTSx5QkFBeUIsR0FBRyxLQUFLLENBQUMsaUJBQWlCLENBQUM7SUFFMUQsSUFBSSxDQUFDO1FBQ0gsS0FBSyxDQUFDLGlC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QU0sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO0FBQzdELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFV0aWxpdHkgZnVuY3Rpb25zIGZvciBhdXRvbWF0aWMgc291cmNlIHRyYWNraW5nXG4gKi9cblxuLyoqXG4gKiBBdXRvLWRldGVjdCB0aGUgc291cmNlIG9mIGFuIG9ic2VydmFiaWxpdHkgZXZlbnRcbiAqIFxuICogUHJpb3JpdHk6XG4gKiAxLiBFeHBsaWNpdCBzb3VyY2UgcGFzc2VkIGluIGV2ZW50XG4gKiAyLiBMYW1iZGEgZnVuY3Rpb24gbmFtZSBmcm9tIGVudmlyb25tZW50XG4gKiAzLiBDb250cm9sbGVyL2NsYXNzIGNvbnRleHQgKGlmIGF2YWlsYWJsZSlcbiAqIDQuIENhbGwgc3RhY2sgYW5hbHlzaXMgKGRldmVsb3BtZW50IG9ubHkpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXRlY3RTb3VyY2UoZXhwbGljaXRTb3VyY2U/OiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAvLyBVc2UgZXhwbGljaXQgc291cmNlIGlmIHByb3ZpZGVkXG4gIGlmIChleHBsaWNpdFNvdXJjZSkge1xuICAgIHJldHVybiBleHBsaWNpdFNvdXJjZTtcbiAgfVxuICBcbiAgLy8gVHJ5IExhbWJkYSBmdW5jdGlvbiBuYW1lXG4gIGNvbnN0IGZ1bmN0aW9uTmFtZSA9IHByb2Nlc3MuZW52LkFXU19MQU1CREFfRlVOQ1RJT05fTkFNRTtcbiAgaWYgKGZ1bmN0aW9uTmFtZSkge1xuICAgIHJldHVybiBgbGFtYmRhOiR7ZnVuY3Rpb25OYW1lfWA7XG4gIH1cbiAgXG4gIC8vIEluIGRldmVsb3BtZW50LCB0cnkgdG8gZ2V0IGNhbGxlciBpbmZvIGZyb20gc3RhY2sgdHJhY2VcbiAgaWYgKHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnIHx8IHByb2Nlc3MuZW52Lk9CU0VSVkFCSUxJVFlfQ0FQVFVSRV9TVEFDSykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWxsZXIgPSBnZXRDYWxsZXJJbmZvKCk7XG4gICAgICBpZiAoY2FsbGVyKSB7XG4gICAgICAgIHJldHVybiBjYWxsZXI7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIElnbm9yZSBlcnJvcnMgaW4gc3RhY2sgcGFyc2luZ1xuICAgIH1cbiAgfVxuICBcbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IGNhbGxlciBpbmZvcm1hdGlvbiBmcm9tIHN0YWNrIHRyYWNlIChkZXZlbG9wbWVudCBvbmx5KVxuICogXG4gKiBUaGlzIGlzIHVzZWZ1bCBmb3IgZGVidWdnaW5nIGJ1dCBoYXMgcGVyZm9ybWFuY2Ugb3ZlcmhlYWQsXG4gKiBzbyBpdCdzIG9ubHkgZW5hYmxlZCBpbiBkZXZlbG9wbWVudCBvciB3aXRoIGV4cGxpY2l0IGZsYWcuXG4gKi9cbmZ1bmN0aW9uIGdldENhbGxlckluZm8oKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3Qgb3JpZ2luYWxQcmVwYXJlU3RhY2tUcmFjZSA9IEVycm9yLnByZXBhcmVTdGFja1RyYWNlO1xuICBcbiAgdHJ5IHtcbiAgICBFcnJvci5wcmVwYXJlU3RhY2tUcmFjZSA9IChfLCBzdGFjaykgPT4gc3RhY2s7XG4gICAgY29uc3Qgc3RhY2sgPSBuZXcgRXJyb3IoKS5zdGFjayBhcyB1bmtub3duIGFzIE5vZGVKUy5DYWxsU2l0ZVtdO1xuICAgIFxuICAgIC8vIFNraXAgb3VyIG93biB1dGlsaXR5IGZpbGVzXG4gICAgZm9yIChjb25zdCBmcmFtZSBvZiBzdGFjaykge1xuICAgICAgY29uc3QgZmlsZU5hbWUgPSBmcmFtZS5nZXRGaWxlTmFtZSgpO1xuICAgICAgaWYgKCFmaWxlTmFtZSkgY29udGludWU7XG4gICAgICBcbiAgICAgIC8vIFNraXAgaW50ZXJuYWwvZnJhbWV3b3JrIGZpbGVzXG4gICAgICBpZiAoXG4gICAgICAgIGZpbGVOYW1lLmluY2x1ZGVzKCdub2RlX21vZHVsZXMnKSB8fFxuICAgICAgICBmaWxlTmFtZS5pbmNsdWRlcygnb2JzZXJ2YWJpbGl0eS9tYW5hZ2VyJykgfHxcbiAgICAgICAgZmlsZU5hbWUuaW5jbHVkZXMoJ29ic2VydmFiaWxpdHkvdXRpbHMnKSB8fFxuICAgICAgICBmaWxlTmFtZS5pbmNsdWRlcygnb2JzZXJ2YWJpbGl0eS9zcGFuJykgfHxcbiAgICAgICAgZmlsZU5hbWUuaW5jbHVkZXMoJ29ic2VydmFiaWxpdHkvbWV0cmljcycpXG4gICAgICApIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIEV4dHJhY3QgdXNlZnVsIGluZm9cbiAgICAgIGNvbnN0IGZ1bmN0aW9uTmFtZSA9IGZyYW1lLmdldEZ1bmN0aW9uTmFtZSgpIHx8ICdhbm9ueW1vdXMnO1xuICAgICAgY29uc3QgbGluZU51bWJlciA9IGZyYW1lLmdldExpbmVOdW1iZXIoKTtcbiAgICAgIGNvbnN0IHNob3J0RmlsZU5hbWUgPSBmaWxlTmFtZS5zcGxpdCgnLycpLnNsaWNlKC0yKS5qb2luKCcvJyk7IC8vIExhc3QgMiBwYXJ0c1xuICAgICAgXG4gICAgICByZXR1cm4gYCR7c2hvcnRGaWxlTmFtZX06JHtmdW5jdGlvbk5hbWV9OiR7bGluZU51bWJlcn1gO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAvLyBTdGFjayB0cmFjZSBwYXJzaW5nIGZhaWxlZFxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH0gZmluYWxseSB7XG4gICAgRXJyb3IucHJlcGFyZVN0YWNrVHJhY2UgPSBvcmlnaW5hbFByZXBhcmVTdGFja1RyYWNlO1xuICB9XG4gIFxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIHNvdXJjZSBpZGVudGlmaWVyIGZvciBhIGNvbnRyb2xsZXIgbWV0aG9kXG4gKiBcbiAqIFVzYWdlIGluIGRlY29yYXRvcnM6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBAVHJhY2VkKClcbiAqIGFzeW5jIG15TWV0aG9kKCkge1xuICogICAvLyBTb3VyY2Ugd2lsbCBiZTogY29udHJvbGxlcjpNeUNvbnRyb2xsZXIubXlNZXRob2RcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ29udHJvbGxlclNvdXJjZShjbGFzc05hbWU6IHN0cmluZywgbWV0aG9kTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBjb250cm9sbGVyOiR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YDtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBzb3VyY2UgaWRlbnRpZmllciBmb3IgYSBzZXJ2aWNlIG1ldGhvZFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU2VydmljZVNvdXJjZShzZXJ2aWNlTmFtZTogc3RyaW5nLCBtZXRob2ROYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYHNlcnZpY2U6JHtzZXJ2aWNlTmFtZX0uJHttZXRob2ROYW1lfWA7XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgc291cmNlIGlkZW50aWZpZXIgZm9yIGEgcXVldWUgaGFuZGxlclxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUXVldWVTb3VyY2UocXVldWVOYW1lOiBzdHJpbmcsIGhhbmRsZXJOYW1lPzogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGhhbmRsZXJOYW1lID8gYHF1ZXVlOiR7cXVldWVOYW1lfS4ke2hhbmRsZXJOYW1lfWAgOiBgcXVldWU6JHtxdWV1ZU5hbWV9YDtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBzb3VyY2UgaWRlbnRpZmllciBmb3IgYSB0YXNrXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVUYXNrU291cmNlKHRhc2tOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYHRhc2s6JHt0YXNrTmFtZX1gO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgY29tbW9uIHRhZ3MgZnJvbSBlbnZpcm9ubWVudFxuICogXG4gKiBVc2VmdWwgZm9yIGNvbnNpc3RlbnQgdGFnZ2luZyBhY3Jvc3MgYWxsIGV2ZW50c1xuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0RW52aXJvbm1lbnRUYWdzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICBjb25zdCB0YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIFxuICAvLyBBV1MgZW52aXJvbm1lbnRcbiAgaWYgKHByb2Nlc3MuZW52LkFXU19SRUdJT04pIHtcbiAgICB0YWdzLnJlZ2lvbiA9IHByb2Nlc3MuZW52LkFXU19SRUdJT047XG4gIH1cbiAgXG4gIGlmIChwcm9jZXNzLmVudi5BV1NfTEFNQkRBX0ZVTkNUSU9OX1ZFUlNJT04pIHtcbiAgICB0YWdzLmZ1bmN0aW9uVmVyc2lvbiA9IHByb2Nlc3MuZW52LkFXU19MQU1CREFfRlVOQ1RJT05fVkVSU0lPTjtcbiAgfVxuICBcbiAgLy8gQXBwbGljYXRpb24gZW52aXJvbm1lbnRcbiAgaWYgKHByb2Nlc3MuZW52Lk5PREVfRU5WKSB7XG4gICAgdGFncy5lbnZpcm9ubWVudCA9IHByb2Nlc3MuZW52Lk5PREVfRU5WO1xuICB9XG4gIFxuICBpZiAocHJvY2Vzcy5lbnYuU1RBR0UpIHtcbiAgICB0YWdzLnN0YWdlID0gcHJvY2Vzcy5lbnYuU1RBR0U7XG4gIH1cbiAgXG4gIGlmIChwcm9jZXNzLmVudi5TRVJWSUNFX05BTUUpIHtcbiAgICB0YWdzLnNlcnZpY2UgPSBwcm9jZXNzLmVudi5TRVJWSUNFX05BTUU7XG4gIH1cbiAgXG4gIC8vIFZlcnNpb24vZGVwbG95bWVudFxuICBpZiAocHJvY2Vzcy5lbnYuQVBQX1ZFUlNJT04pIHtcbiAgICB0YWdzLnZlcnNpb24gPSBwcm9jZXNzLmVudi5BUFBfVkVSU0lPTjtcbiAgfVxuICBcbiAgaWYgKHByb2Nlc3MuZW52LkRFUExPWU1FTlRfSUQpIHtcbiAgICB0YWdzLmRlcGxveW1lbnQgPSBwcm9jZXNzLmVudi5ERVBMT1lNRU5UX0lEO1xuICB9XG4gIFxuICByZXR1cm4gdGFncztcbn1cblxuLyoqXG4gKiBNZXJnZSB0YWdzIHdpdGggZGVmYXVsdHNcbiAqIFxuICogRXZlbnQtc3BlY2lmaWMgdGFncyBvdmVycmlkZSBlbnZpcm9ubWVudCB0YWdzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZVRhZ3MoXG4gIGV2ZW50VGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gIGluY2x1ZGVFbnZpcm9ubWVudDogYm9vbGVhbiA9IHRydWUsXG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFpbmNsdWRlRW52aXJvbm1lbnQgJiYgIWV2ZW50VGFncykge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgXG4gIGNvbnN0IG1lcmdlZCA9IGluY2x1ZGVFbnZpcm9ubWVudCA/IGdldEVudmlyb25tZW50VGFncygpIDoge307XG4gIFxuICBpZiAoZXZlbnRUYWdzKSB7XG4gICAgT2JqZWN0LmFzc2lnbihtZXJnZWQsIGV2ZW50VGFncyk7XG4gIH1cbiAgXG4gIHJldHVybiBPYmplY3Qua2V5cyhtZXJnZWQpLmxlbmd0aCA+IDAgPyBtZXJnZWQgOiB1bmRlZmluZWQ7XG59XG5cbiJdfQ==