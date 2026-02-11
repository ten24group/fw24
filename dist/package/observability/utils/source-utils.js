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
exports.autoDetectSourceType = autoDetectSourceType;
exports.resolveSource = resolveSource;
exports.getEnvironmentTags = getEnvironmentTags;
exports.clearEnvironmentTagsCache = clearEnvironmentTagsCache;
exports.mergeTags = mergeTags;
const di_1 = require("../../di");
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
        const error = new Error();
        const stack = error.stack;
        // Verify we actually got an array (CallSite[]), not a string
        if (!Array.isArray(stack)) {
            return undefined;
        }
        const callSites = stack;
        // Skip our own utility files
        for (const frame of callSites) {
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
/**
 * Auto-detect source type from class name.
 * Used by decorators to infer the source type when not explicitly provided.
 */
function autoDetectSourceType(className) {
    const lowerName = className.toLowerCase();
    if (lowerName.includes('controller')) {
        return 'controller';
    }
    if (lowerName.includes('service')) {
        return 'service';
    }
    if (lowerName.includes('queue') || lowerName.includes('queuehandler')) {
        return 'queue';
    }
    if (lowerName.includes('task') || lowerName.includes('taskhandler')) {
        return 'task';
    }
    return 'handler';
}
/**
 * Map source type to actual source string.
 * Centralizes the switch logic that was duplicated in @Observed and @Traced.
 */
function resolveSource(sourceType, className, methodName) {
    // Auto-detect if not provided
    const type = sourceType ?? autoDetectSourceType(className);
    switch (type) {
        case 'controller':
            return createControllerSource(className, methodName);
        case 'service':
            return createServiceSource(className, methodName);
        case 'queue':
            return createQueueSource(className, methodName);
        case 'task':
            return createTaskSource(className, methodName);
        default:
            return `${className}.${methodName}`;
    }
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
 * Application-level config (like serviceName) comes from DI config.
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
    // Service name from DI config
    try {
        const serviceName = di_1.DIContainer.ROOT.resolveConfig('observability.serviceName');
        if (serviceName) {
            tags.service = serviceName;
        }
    }
    catch {
        // Config not yet registered, skip
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
 * Event-specific tags override environment tags.
 *
 * IMPORTANT: Always creates a new object to avoid mutating cached environment tags.
 */
function mergeTags(eventTags, includeEnvironment = true) {
    if (!includeEnvironment && !eventTags) {
        return undefined;
    }
    // Create a shallow copy to avoid mutating the cached environment tags!
    // getEnvironmentTags() returns a cached object that must not be modified.
    const merged = includeEnvironment ? { ...getEnvironmentTags() } : {};
    if (eventTags) {
        Object.assign(merged, eventTags);
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic291cmNlLXV0aWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvdXRpbHMvc291cmNlLXV0aWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7R0FFRzs7QUFhSCxvQ0F5QkM7QUFtRUQsd0RBRUM7QUFLRCxrREFFQztBQUtELDhDQUVDO0FBS0QsNENBRUM7QUFVRCxvREFpQkM7QUFNRCxzQ0FvQkM7QUFlRCxnREFvREM7QUFLRCw4REFFQztBQVNELDhCQWlCQztBQXZSRCxpQ0FBdUM7QUFFdkM7Ozs7Ozs7O0dBUUc7QUFDSCxTQUFnQixZQUFZLENBQUMsY0FBdUI7SUFDbEQsa0NBQWtDO0lBQ2xDLElBQUksY0FBYyxFQUFFLENBQUM7UUFDbkIsT0FBTyxjQUFjLENBQUM7SUFDeEIsQ0FBQztJQUVELDJCQUEyQjtJQUMzQixNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLHdCQUF3QixDQUFDO0lBQzFELElBQUksWUFBWSxFQUFFLENBQUM7UUFDakIsT0FBTyxVQUFVLFlBQVksRUFBRSxDQUFDO0lBQ2xDLENBQUM7SUFFRCwwREFBMEQ7SUFDMUQsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsS0FBSyxhQUFhLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsRUFBRSxDQUFDO1FBQ3RGLElBQUksQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLGFBQWEsRUFBRSxDQUFDO1lBQy9CLElBQUksTUFBTSxFQUFFLENBQUM7Z0JBQ1gsT0FBTyxNQUFNLENBQUM7WUFDaEIsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsaUNBQWlDO1FBQ25DLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxTQUFTLENBQUM7QUFDbkIsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxhQUFhO0lBQ3BCLE1BQU0seUJBQXlCLEdBQUcsS0FBSyxD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ZSB0cmFja2luZ1xuICovXG5cbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vLi4vZGknO1xuXG4vKipcbiAqIEF1dG8tZGV0ZWN0IHRoZSBzb3VyY2Ugb2YgYW4gb2JzZXJ2YWJpbGl0eSBldmVudFxuICogXG4gKiBQcmlvcml0eTpcbiAqIDEuIEV4cGxpY2l0IHNvdXJjZSBwYXNzZWQgaW4gZXZlbnRcbiAqIDIuIExhbWJkYSBmdW5jdGlvbiBuYW1lIGZyb20gZW52aXJvbm1lbnRcbiAqIDMuIENvbnRyb2xsZXIvY2xhc3MgY29udGV4dCAoaWYgYXZhaWxhYmxlKVxuICogNC4gQ2FsbCBzdGFjayBhbmFseXNpcyAoZGV2ZWxvcG1lbnQgb25seSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRldGVjdFNvdXJjZShleHBsaWNpdFNvdXJjZT86IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIC8vIFVzZSBleHBsaWNpdCBzb3VyY2UgaWYgcHJvdmlkZWRcbiAgaWYgKGV4cGxpY2l0U291cmNlKSB7XG4gICAgcmV0dXJuIGV4cGxpY2l0U291cmNlO1xuICB9XG5cbiAgLy8gVHJ5IExhbWJkYSBmdW5jdGlvbiBuYW1lXG4gIGNvbnN0IGZ1bmN0aW9uTmFtZSA9IHByb2Nlc3MuZW52LkFXU19MQU1CREFfRlVOQ1RJT05fTkFNRTtcbiAgaWYgKGZ1bmN0aW9uTmFtZSkge1xuICAgIHJldHVybiBgbGFtYmRhOiR7ZnVuY3Rpb25OYW1lfWA7XG4gIH1cblxuICAvLyBJbiBkZXZlbG9wbWVudCwgdHJ5IHRvIGdldCBjYWxsZXIgaW5mbyBmcm9tIHN0YWNrIHRyYWNlXG4gIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50JyB8fCBwcm9jZXNzLmVudi5PQlNFUlZBQklMSVRZX0NBUFRVUkVfU1RBQ0spIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FsbGVyID0gZ2V0Q2FsbGVySW5mbygpO1xuICAgICAgaWYgKGNhbGxlcikge1xuICAgICAgICByZXR1cm4gY2FsbGVyO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBJZ25vcmUgZXJyb3JzIGluIHN0YWNrIHBhcnNpbmdcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgY2FsbGVyIGluZm9ybWF0aW9uIGZyb20gc3RhY2sgdHJhY2UgKGRldmVsb3BtZW50IG9ubHkpXG4gKiBcbiAqIFRoaXMgaXMgdXNlZnVsIGZvciBkZWJ1Z2dpbmcgYnV0IGhhcyBwZXJmb3JtYW5jZSBvdmVyaGVhZCxcbiAqIHNvIGl0J3Mgb25seSBlbmFibGVkIGluIGRldmVsb3BtZW50IG9yIHdpdGggZXhwbGljaXQgZmxhZy5cbiAqL1xuZnVuY3Rpb24gZ2V0Q2FsbGVySW5mbygpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBjb25zdCBvcmlnaW5hbFByZXBhcmVTdGFja1RyYWNlID0gRXJyb3IucHJlcGFyZVN0YWNrVHJhY2U7XG5cbiAgdHJ5IHtcbiAgICBFcnJvci5wcmVwYXJlU3RhY2tUcmFjZSA9IChfLCBzdGFjaykgPT4gc3RhY2s7XG4gICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoKTtcbiAgICBjb25zdCBzdGFjayA9IGVycm9yLnN0YWNrIGFzIHVua25vd247XG5cbiAgICAvLyBWZXJpZnkgd2UgYWN0dWFsbHkgZ290IGFuIGFycmF5IChDYWxsU2l0ZVtdKSwgbm90IGEgc3RyaW5nXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHN0YWNrKSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBjYWxsU2l0ZXMgPSBzdGFjayBhcyBOb2RlSlMuQ2FsbFNpdGVbXTtcblxuICAgIC8vIFNraXAgb3VyIG93biB1dGlsaXR5IGZpbGVzXG4gICAgZm9yIChjb25zdCBmcmFtZSBvZiBjYWxsU2l0ZXMpIHtcbiAgICAgIGNvbnN0IGZpbGVOYW1lID0gZnJhbWUuZ2V0RmlsZU5hbWUoKTtcbiAgICAgIGlmICghZmlsZU5hbWUpIGNvbnRpbnVlO1xuXG4gICAgICAvLyBTa2lwIGludGVybmFsL2ZyYW1ld29yayBmaWxlc1xuICAgICAgaWYgKFxuICAgICAgICBmaWxlTmFtZS5pbmNsdWRlcygnbm9kZV9tb2R1bGVzJykgfHxcbiAgICAgICAgZmlsZU5hbWUuaW5jbHVkZXMoJ29ic2VydmFiaWxpdHkvbWFuYWdlcicpIHx8XG4gICAgICAgIGZpbGVOYW1lLmluY2x1ZGVzKCdvYnNlcnZhYmlsaXR5L3V0aWxzJykgfHxcbiAgICAgICAgZmlsZU5hbWUuaW5jbHVkZXMoJ29ic2VydmFiaWxpdHkvc3BhbicpIHx8XG4gICAgICAgIGZpbGVOYW1lLmluY2x1ZGVzKCdvYnNlcnZhYmlsaXR5L21ldHJpY3MnKVxuICAgICAgKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBFeHRyYWN0IHVzZWZ1bCBpbmZvXG4gICAgICBjb25zdCBmdW5jdGlvbk5hbWUgPSBmcmFtZS5nZXRGdW5jdGlvbk5hbWUoKSB8fCAnYW5vbnltb3VzJztcbiAgICAgIGNvbnN0IGxpbmVOdW1iZXIgPSBmcmFtZS5nZXRMaW5lTnVtYmVyKCk7XG4gICAgICBjb25zdCBzaG9ydEZpbGVOYW1lID0gZmlsZU5hbWUuc3BsaXQoJy8nKS5zbGljZSgtMikuam9pbignLycpOyAvLyBMYXN0IDIgcGFydHNcblxuICAgICAgcmV0dXJuIGAke3Nob3J0RmlsZU5hbWV9OiR7ZnVuY3Rpb25OYW1lfToke2xpbmVOdW1iZXJ9YDtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgLy8gU3RhY2sgdHJhY2UgcGFyc2luZyBmYWlsZWRcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9IGZpbmFsbHkge1xuICAgIEVycm9yLnByZXBhcmVTdGFja1RyYWNlID0gb3JpZ2luYWxQcmVwYXJlU3RhY2tUcmFjZTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgc291cmNlIGlkZW50aWZpZXIgZm9yIGEgY29udHJvbGxlciBtZXRob2RcbiAqIFxuICogVXNhZ2UgaW4gZGVjb3JhdG9yczpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIEBUcmFjZWQoKVxuICogYXN5bmMgbXlNZXRob2QoKSB7XG4gKiAgIC8vIFNvdXJjZSB3aWxsIGJlOiBjb250cm9sbGVyOk15Q29udHJvbGxlci5teU1ldGhvZFxuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDb250cm9sbGVyU291cmNlKGNsYXNzTmFtZTogc3RyaW5nLCBtZXRob2ROYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYGNvbnRyb2xsZXI6JHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIHNvdXJjZSBpZGVudGlmaWVyIGZvciBhIHNlcnZpY2UgbWV0aG9kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTZXJ2aWNlU291cmNlKHNlcnZpY2VOYW1lOiBzdHJpbmcsIG1ldGhvZE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgc2VydmljZToke3NlcnZpY2VOYW1lfS4ke21ldGhvZE5hbWV9YDtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBzb3VyY2UgaWRlbnRpZmllciBmb3IgYSBxdWV1ZSBoYW5kbGVyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVRdWV1ZVNvdXJjZShxdWV1ZU5hbWU6IHN0cmluZywgaGFuZGxlck5hbWU/OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gaGFuZGxlck5hbWUgPyBgcXVldWU6JHtxdWV1ZU5hbWV9LiR7aGFuZGxlck5hbWV9YCA6IGBxdWV1ZToke3F1ZXVlTmFtZX1gO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIHNvdXJjZSBpZGVudGlmaWVyIGZvciBhIHF1ZXVlIGhhbmRsZXJcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVRhc2tTb3VyY2UodGFza05hbWU6IHN0cmluZywgaGFuZGxlck5hbWU/OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gaGFuZGxlck5hbWUgPyBgdGFzazoke3Rhc2tOYW1lfS4ke2hhbmRsZXJOYW1lfWAgOiBgdGFzazoke3Rhc2tOYW1lfWA7XG59XG5cbi8vIFJlLWV4cG9ydCBTb3VyY2VUeXBlIGZyb20gdHlwZXMudHMgdG8gbWFpbnRhaW4gYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuZXhwb3J0IHR5cGUgeyBTb3VyY2VUeXBlIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHR5cGUgeyBTb3VyY2VUeXBlIH0gZnJvbSAnLi4vdHlwZXMnO1xuXG4vKipcbiAqIEF1dG8tZGV0ZWN0IHNvdXJjZSB0eXBlIGZyb20gY2xhc3MgbmFtZS5cbiAqIFVzZWQgYnkgZGVjb3JhdG9ycyB0byBpbmZlciB0aGUgc291cmNlIHR5cGUgd2hlbiBub3QgZXhwbGljaXRseSBwcm92aWRlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGF1dG9EZXRlY3RTb3VyY2VUeXBlKGNsYXNzTmFtZTogc3RyaW5nKTogU291cmNlVHlwZSB7XG4gIGNvbnN0IGxvd2VyTmFtZSA9IGNsYXNzTmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gIGlmIChsb3dlck5hbWUuaW5jbHVkZXMoJ2NvbnRyb2xsZXInKSkge1xuICAgIHJldHVybiAnY29udHJvbGxlcic7XG4gIH1cbiAgaWYgKGxvd2VyTmFtZS5pbmNsdWRlcygnc2VydmljZScpKSB7XG4gICAgcmV0dXJuICdzZXJ2aWNlJztcbiAgfVxuICBpZiAobG93ZXJOYW1lLmluY2x1ZGVzKCdxdWV1ZScpIHx8IGxvd2VyTmFtZS5pbmNsdWRlcygncXVldWVoYW5kbGVyJykpIHtcbiAgICByZXR1cm4gJ3F1ZXVlJztcbiAgfVxuICBpZiAobG93ZXJOYW1lLmluY2x1ZGVzKCd0YXNrJykgfHwgbG93ZXJOYW1lLmluY2x1ZGVzKCd0YXNraGFuZGxlcicpKSB7XG4gICAgcmV0dXJuICd0YXNrJztcbiAgfVxuXG4gIHJldHVybiAnaGFuZGxlcic7XG59XG5cbi8qKlxuICogTWFwIHNvdXJjZSB0eXBlIHRvIGFjdHVhbCBzb3VyY2Ugc3RyaW5nLlxuICogQ2VudHJhbGl6ZXMgdGhlIHN3aXRjaCBsb2dpYyB0aGF0IHdhcyBkdXBsaWNhdGVkIGluIEBPYnNlcnZlZCBhbmQgQFRyYWNlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTb3VyY2UoXG4gIHNvdXJjZVR5cGU6IFNvdXJjZVR5cGUgfCB1bmRlZmluZWQsXG4gIGNsYXNzTmFtZTogc3RyaW5nLFxuICBtZXRob2ROYW1lOiBzdHJpbmdcbik6IHN0cmluZyB7XG4gIC8vIEF1dG8tZGV0ZWN0IGlmIG5vdCBwcm92aWRlZFxuICBjb25zdCB0eXBlID0gc291cmNlVHlwZSA/PyBhdXRvRGV0ZWN0U291cmNlVHlwZShjbGFzc05hbWUpO1xuXG4gIHN3aXRjaCAodHlwZSkge1xuICAgIGNhc2UgJ2NvbnRyb2xsZXInOlxuICAgICAgcmV0dXJuIGNyZWF0ZUNvbnRyb2xsZXJTb3VyY2UoY2xhc3NOYW1lLCBtZXRob2ROYW1lKTtcbiAgICBjYXNlICdzZXJ2aWNlJzpcbiAgICAgIHJldHVybiBjcmVhdGVTZXJ2aWNlU291cmNlKGNsYXNzTmFtZSwgbWV0aG9kTmFtZSk7XG4gICAgY2FzZSAncXVldWUnOlxuICAgICAgcmV0dXJuIGNyZWF0ZVF1ZXVlU291cmNlKGNsYXNzTmFtZSwgbWV0aG9kTmFtZSk7XG4gICAgY2FzZSAndGFzayc6XG4gICAgICByZXR1cm4gY3JlYXRlVGFza1NvdXJjZShjbGFzc05hbWUsIG1ldGhvZE5hbWUpO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YDtcbiAgfVxufVxuXG4vLyBDYWNoZWQgZW52aXJvbm1lbnQgdGFncyAtIGNvbXB1dGVkIG9uY2UsIHJldXNlZCBmb3IgYWxsIGV2ZW50c1xubGV0IF9jYWNoZWRFbnZUYWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgbnVsbCA9IG51bGw7XG5cbi8qKlxuICogRXh0cmFjdCBjb21tb24gdGFncyBmcm9tIGVudmlyb25tZW50XG4gKiBcbiAqIENBQ0hFRDogQ29tcHV0ZWQgb25jZSBvbiBmaXJzdCBjYWxsLCByZXVzZWQgZm9yIGFsbCBzdWJzZXF1ZW50IGNhbGxzLlxuICogVGhpcyBpcyBzYWZlIGJlY2F1c2UgZW52aXJvbm1lbnQgdmFyaWFibGVzIGRvbid0IGNoYW5nZSBkdXJpbmcgTGFtYmRhIGV4ZWN1dGlvbi5cbiAqIFxuICogTk9URTogTW9zdCBvZiB0aGVzZSBhcmUgQVdTIHJ1bnRpbWUgZW52aXJvbm1lbnQgdmFyaWFibGVzIHRoYXQgYXJlXG4gKiBhdXRvbWF0aWNhbGx5IHNldCBieSB0aGUgTGFtYmRhIHJ1bnRpbWUsIG5vdCBhcHBsaWNhdGlvbiBjb25maWcuXG4gKiBBcHBsaWNhdGlvbi1sZXZlbCBjb25maWcgKGxpa2Ugc2VydmljZU5hbWUpIGNvbWVzIGZyb20gREkgY29uZmlnLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0RW52aXJvbm1lbnRUYWdzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICBpZiAoX2NhY2hlZEVudlRhZ3MgIT09IG51bGwpIHtcbiAgICByZXR1cm4gX2NhY2hlZEVudlRhZ3M7XG4gIH1cblxuICBjb25zdCB0YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG5cbiAgLy8gQVdTIExhbWJkYSBydW50aW1lIGVudmlyb25tZW50IChhdXRvbWF0aWNhbGx5IHNldCBieSBBV1MpXG4gIGNvbnN0IGF3c1JlZ2lvbiA9IHByb2Nlc3MuZW52LkFXU19SRUdJT047XG4gIGlmIChhd3NSZWdpb24pIHtcbiAgICB0YWdzLnJlZ2lvbiA9IGF3c1JlZ2lvbjtcbiAgfVxuXG4gIGNvbnN0IGZ1bmN0aW9uVmVyc2lvbiA9IHByb2Nlc3MuZW52LkFXU19MQU1CREFfRlVOQ1RJT05fVkVSU0lPTjtcbiAgaWYgKGZ1bmN0aW9uVmVyc2lvbikge1xuICAgIHRhZ3MuZnVuY3Rpb25WZXJzaW9uID0gZnVuY3Rpb25WZXJzaW9uO1xuICB9XG5cbiAgLy8gQXBwbGljYXRpb24gZW52aXJvbm1lbnRcbiAgY29uc3Qgbm9kZUVudiA9IHByb2Nlc3MuZW52Lk5PREVfRU5WO1xuICBpZiAobm9kZUVudikge1xuICAgIHRhZ3MuZW52aXJvbm1lbnQgPSBub2RlRW52O1xuICB9XG5cbiAgY29uc3Qgc3RhZ2UgPSBwcm9jZXNzLmVudi5TVEFHRTtcbiAgaWYgKHN0YWdlKSB7XG4gICAgdGFncy5zdGFnZSA9IHN0YWdlO1xuICB9XG5cbiAgLy8gU2VydmljZSBuYW1lIGZyb20gREkgY29uZmlnXG4gIHRyeSB7XG4gICAgY29uc3Qgc2VydmljZU5hbWUgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmVDb25maWc8c3RyaW5nPignb2JzZXJ2YWJpbGl0eS5zZXJ2aWNlTmFtZScpO1xuICAgIGlmIChzZXJ2aWNlTmFtZSkge1xuICAgICAgdGFncy5zZXJ2aWNlID0gc2VydmljZU5hbWU7XG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICAvLyBDb25maWcgbm90IHlldCByZWdpc3RlcmVkLCBza2lwXG4gIH1cblxuICAvLyBWZXJzaW9uL2RlcGxveW1lbnRcbiAgY29uc3QgYXBwVmVyc2lvbiA9IHByb2Nlc3MuZW52LkFQUF9WRVJTSU9OO1xuICBpZiAoYXBwVmVyc2lvbikge1xuICAgIHRhZ3MudmVyc2lvbiA9IGFwcFZlcnNpb247XG4gIH1cblxuICBjb25zdCBkZXBsb3ltZW50SWQgPSBwcm9jZXNzLmVudi5ERVBMT1lNRU5UX0lEO1xuICBpZiAoZGVwbG95bWVudElkKSB7XG4gICAgdGFncy5kZXBsb3ltZW50ID0gZGVwbG95bWVudElkO1xuICB9XG5cbiAgX2NhY2hlZEVudlRhZ3MgPSB0YWdzO1xuICByZXR1cm4gdGFncztcbn1cblxuLyoqXG4gKiBDbGVhciBjYWNoZWQgZW52aXJvbm1lbnQgdGFncyAoZm9yIHRlc3RpbmcpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhckVudmlyb25tZW50VGFnc0NhY2hlKCk6IHZvaWQge1xuICBfY2FjaGVkRW52VGFncyA9IG51bGw7XG59XG5cbi8qKlxuICogTWVyZ2UgdGFncyB3aXRoIGRlZmF1bHRzXG4gKiBcbiAqIEV2ZW50LXNwZWNpZmljIHRhZ3Mgb3ZlcnJpZGUgZW52aXJvbm1lbnQgdGFncy5cbiAqIFxuICogSU1QT1JUQU5UOiBBbHdheXMgY3JlYXRlcyBhIG5ldyBvYmplY3QgdG8gYXZvaWQgbXV0YXRpbmcgY2FjaGVkIGVudmlyb25tZW50IHRhZ3MuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZVRhZ3MoXG4gIGV2ZW50VGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gIGluY2x1ZGVFbnZpcm9ubWVudDogYm9vbGVhbiA9IHRydWUsXG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFpbmNsdWRlRW52aXJvbm1lbnQgJiYgIWV2ZW50VGFncykge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICAvLyBDcmVhdGUgYSBzaGFsbG93IGNvcHkgdG8gYXZvaWQgbXV0YXRpbmcgdGhlIGNhY2hlZCBlbnZpcm9ubWVudCB0YWdzIVxuICAvLyBnZXRFbnZpcm9ubWVudFRhZ3MoKSByZXR1cm5zIGEgY2FjaGVkIG9iamVjdCB0aGF0IG11c3Qgbm90IGJlIG1vZGlmaWVkLlxuICBjb25zdCBtZXJnZWQgPSBpbmNsdWRlRW52aXJvbm1lbnQgPyB7IC4uLmdldEVudmlyb25tZW50VGFncygpIH0gOiB7fTtcblxuICBpZiAoZXZlbnRUYWdzKSB7XG4gICAgT2JqZWN0LmFzc2lnbihtZXJnZWQsIGV2ZW50VGFncyk7XG4gIH1cblxuICByZXR1cm4gT2JqZWN0LmtleXMobWVyZ2VkKS5sZW5ndGggPiAwID8gbWVyZ2VkIDogdW5kZWZpbmVkO1xufVxuXG4iXX0=