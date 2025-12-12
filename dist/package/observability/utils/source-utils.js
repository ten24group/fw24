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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic291cmNlLXV0aWxzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvdXRpbHMvc291cmNlLXV0aWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7R0FFRzs7QUFhSCxvQ0F5QkM7QUFtRUQsd0RBRUM7QUFLRCxrREFFQztBQUtELDhDQUVDO0FBS0QsNENBRUM7QUFlRCxnREFvREM7QUFLRCw4REFFQztBQVNELDhCQWlCQztBQWxPRCxpQ0FBdUM7QUFFdkM7Ozs7Ozs7O0dBUUc7QUFDSCxTQUFnQixZQUFZLENBQUMsY0FBdUI7SUFDbEQsa0NBQWtDO0lBQ2xDLElBQUksY0FBYyxFQUFFLENBQUM7UUFDbkIsT0FBTyxjQUFjLENBQUM7SUFDeEIsQ0FBQztJQUVELDJCQUEyQjtJQUMzQixNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLHdCQUF3QixDQUFDO0lBQzFELElBQUksWUFBWSxFQUFFLENBQUM7UUFDakIsT0FBTyxVQUFVLFlBQVksRUFBRSxDQUFDO0lBQ2xDLENBQUM7SUFFRCwwREFBMEQ7SUFDMUQsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsS0FBSyxhQUFhLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsRUFBRSxDQUFDO1FBQ3RGLElBQUksQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLGFBQWEsRUFBRSxDQUFDO1lBQy9CLElBQUksTUFBTSxFQUFFLENBQUM7Z0JBQ1gsT0FBTyxNQUFNLENBQUM7WUFDaEIsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsaUNBQWlDO1FBQ25DLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxTQUFTLENBQUM7QUFDbkIsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBUyxhQUFhO0lBQ3BCLE1BQU0seUJBQXlCLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixDQUFDO0lBRTFELElBQUksQ0FBQztRQUNILEtBQUssQ0FBQyxpQkFBaUIsR0FBRyxDQUFDLENBQUMsRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQztRQUM5QyxNQUFNLEtBQUssR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFDO1FBQzFCLE1BQU0sS0FBSyxHQUFHLEtBQUssQ0FBQyxLQUFnQixDQUFDO1FBRXJDLDZEQUE2RDtRQUM3RCxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzFCLE9BQU8sU0FBUyxDQUFDO1FBQ25CLENBQUM7UUFFRCxNQUFNLFNBQVMsR0FBRyxLQUEwQixDQUFDO1FBRTdDLDZCQUE2QjtRQUM3QixLQUFLLE1BQU0sS0FBSyxJQUFJLFNBQVMsRUFBRSxDQUFDO1lBQzlCLE1BQU0sUUFBUSxHQUFHLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNyQyxJQUFJLENBQUMsUUFBUTtnQkFBRSxTQUFTO1lBRXhCLGdDQUFnQztZQUNoQyxJQUNFLFFBQVEsQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDO2dCQUNqQyxRQUFRLENBQUMsUUFBUSxDQUFDLHVCQUF1QixDQUFDO2dCQUMxQyxRQUFRLENBQUMsUUFBUSxDQUFDLHFCQUFxQixDQUFDO2dCQUN4QyxRQUFRLENBQUMsUUFBUSxDQUFDLG9CQUFvQixDQUFDO2dCQUN2QyxRQUFRLENBQUMsUUFBUSxDQUFDLHVCQUF1QixDQUFDLEVBQzFDLENBQUM7Z0JBQ0QsU0FBUztZQUNYLENBQUM7WUFFRCxzQkFBc0I7WUFDdEIsTUFBTSxZQUFZLEdBQUcsS0FBSyxDQUFDLGVBQWUsRUFBRSxJQUFJLFdBQVcsQ0FBQztZQUM1RCxNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDekMsTUFBTSxhQUFhLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxlQUFlO1lBRTlFLE9BQU8sR0FBRyxhQUFhLElBQUksWUFBWSxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBQzFELENBQUM7SUFDSCxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLDZCQUE2QjtRQUM3QixPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO1lBQVMsQ0FBQztRQUNULEtBQUssQ0FBQyxpQkFBaUIsR0FBRyx5QkFBeUIsQ0FBQztJQUN0RCxDQUFDO0lBRUQsT0FBTyxTQUFTLENBQUM7QUFDbkIsQ0FBQztBQUVEOzs7Ozs7Ozs7O0dBVUc7QUFDSCxTQUFnQixzQkFBc0IsQ0FBQyxTQUFpQixFQUFFLFVBQWtCO0lBQzFFLE9BQU8sY0FBYyxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7QUFDakQsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsbUJBQW1CLENBQUMsV0FBbUIsRUFBRSxVQUFrQjtJQUN6RSxPQUFPLFdBQVcsV0FBVyxJQUFJLFVBQVUsRUFBRSxDQUFDO0FBQ2hELENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGlCQUFpQixDQUFDLFNBQWlCLEVBQUUsV0FBb0I7SUFDdkUsT0FBTyxXQUFXLENBQUMsQ0FBQyxDQUFDLFNBQVMsU0FBUyxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTLFNBQVMsRUFBRSxDQUFDO0FBQ2xGLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGdCQUFnQixDQUFDLFFBQWdCLEVBQUUsV0FBb0I7SUFDckUsT0FBTyxXQUFXLENBQUMsQ0FBQyxDQUFDLFFBQVEsUUFBUSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLFFBQVEsRUFBRSxDQUFDO0FBQzlFLENBQUM7QUFFRCxpRUFBaUU7QUFDakUsSUFBSSxjQUFjLEdBQWtDLElBQUksQ0FBQztBQUV6RDs7Ozs7Ozs7O0dBU0c7QUFDSCxTQUFnQixrQkFBa0I7SUFDaEMsSUFBSSxjQUFjLEtBQUssSUFBSSxFQUFFLENBQUM7UUFDNUIsT0FBTyxjQUFjLENBQUM7SUFDeEIsQ0FBQztJQUVELE1BQU0sSUFBSSxHQUEyQixFQUFFLENBQUM7SUFFeEMsNERBQTREO0lBQzVELE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDO0lBQ3pDLElBQUksU0FBUyxFQUFFLENBQUM7UUFDZCxJQUFJLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQztJQUMxQixDQUFDO0lBRUQsTUFBTSxlQUFlLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsQ0FBQztJQUNoRSxJQUFJLGVBQWUsRUFBRSxDQUFDO1FBQ3BCLElBQUksQ0FBQyxlQUFlLEdBQUcsZUFBZSxDQUFDO0lBQ3pDLENBQUM7SUFFRCwwQkFBMEI7SUFDMUIsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUM7SUFDckMsSUFBSSxPQUFPLEVBQUUsQ0FBQztRQUNaLElBQUksQ0FBQyxXQUFXLEdBQUcsT0FBTyxDQUFDO0lBQzdCLENBQUM7SUFFRCxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQztJQUNoQyxJQUFJLEtBQUssRUFBRSxDQUFDO1FBQ1YsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7SUFDckIsQ0FBQztJQUVELDhCQUE4QjtJQUM5QixJQUFJLENBQUM7UUFDSCxNQUFNLFdBQVcsR0FBRyxnQkFBVyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQVMsMkJBQTJCLENBQUMsQ0FBQztRQUN4RixJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLElBQUksQ0FBQyxPQUFPLEdBQUcsV0FBVyxDQUFDO1FBQzdCLENBQUM7SUFDSCxDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1Asa0NBQWtDO0lBQ3BDLENBQUM7SUFFRCxxQkFBcUI7SUFDckIsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUM7SUFDM0MsSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUNmLElBQUksQ0FBQyxPQUFPLEdBQUcsVUFBVSxDQUFDO0lBQzVCLENBQUM7SUFFRCxNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQztJQUMvQyxJQUFJLFlBQVksRUFBRSxDQUFDO1FBQ2pCLElBQUksQ0FBQyxVQUFVLEdBQUcsWUFBWSxDQUFDO0lBQ2pDLENBQUM7SUFFRCxjQUFjLEdBQUcsSUFBSSxDQUFDO0lBQ3RCLE9BQU8sSUFBSSxDQUFDO0FBQ2QsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IseUJBQXlCO0lBQ3ZDLGNBQWMsR0FBRyxJQUFJLENBQUM7QUFDeEIsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQWdCLFNBQVMsQ0FDdkIsU0FBa0MsRUFDbEMscUJBQThCLElBQUk7SUFFbEMsSUFBSSxDQUFDLGtCQUFrQixJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDdEMsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVELHVFQUF1RTtJQUN2RSwwRUFBMEU7SUFDMUUsTUFBTSxNQUFNLEdBQUcsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLEVBQUUsR0FBRyxrQkFBa0IsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUVyRSxJQUFJLFNBQVMsRUFBRSxDQUFDO1FBQ2QsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDbkMsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztBQUM3RCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBVdGlsaXR5IGZ1bmN0aW9ucyBmb3IgYXV0b21hdGljIHNvdXJjZSB0cmFja2luZ1xuICovXG5cbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vLi4vZGknO1xuXG4vKipcbiAqIEF1dG8tZGV0ZWN0IHRoZSBzb3VyY2Ugb2YgYW4gb2JzZXJ2YWJpbGl0eSBldmVudFxuICogXG4gKiBQcmlvcml0eTpcbiAqIDEuIEV4cGxpY2l0IHNvdXJjZSBwYXNzZWQgaW4gZXZlbnRcbiAqIDIuIExhbWJkYSBmdW5jdGlvbiBuYW1lIGZyb20gZW52aXJvbm1lbnRcbiAqIDMuIENvbnRyb2xsZXIvY2xhc3MgY29udGV4dCAoaWYgYXZhaWxhYmxlKVxuICogNC4gQ2FsbCBzdGFjayBhbmFseXNpcyAoZGV2ZWxvcG1lbnQgb25seSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRldGVjdFNvdXJjZShleHBsaWNpdFNvdXJjZT86IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIC8vIFVzZSBleHBsaWNpdCBzb3VyY2UgaWYgcHJvdmlkZWRcbiAgaWYgKGV4cGxpY2l0U291cmNlKSB7XG4gICAgcmV0dXJuIGV4cGxpY2l0U291cmNlO1xuICB9XG5cbiAgLy8gVHJ5IExhbWJkYSBmdW5jdGlvbiBuYW1lXG4gIGNvbnN0IGZ1bmN0aW9uTmFtZSA9IHByb2Nlc3MuZW52LkFXU19MQU1CREFfRlVOQ1RJT05fTkFNRTtcbiAgaWYgKGZ1bmN0aW9uTmFtZSkge1xuICAgIHJldHVybiBgbGFtYmRhOiR7ZnVuY3Rpb25OYW1lfWA7XG4gIH1cblxuICAvLyBJbiBkZXZlbG9wbWVudCwgdHJ5IHRvIGdldCBjYWxsZXIgaW5mbyBmcm9tIHN0YWNrIHRyYWNlXG4gIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50JyB8fCBwcm9jZXNzLmVudi5PQlNFUlZBQklMSVRZX0NBUFRVUkVfU1RBQ0spIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FsbGVyID0gZ2V0Q2FsbGVySW5mbygpO1xuICAgICAgaWYgKGNhbGxlcikge1xuICAgICAgICByZXR1cm4gY2FsbGVyO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBJZ25vcmUgZXJyb3JzIGluIHN0YWNrIHBhcnNpbmdcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgY2FsbGVyIGluZm9ybWF0aW9uIGZyb20gc3RhY2sgdHJhY2UgKGRldmVsb3BtZW50IG9ubHkpXG4gKiBcbiAqIFRoaXMgaXMgdXNlZnVsIGZvciBkZWJ1Z2dpbmcgYnV0IGhhcyBwZXJmb3JtYW5jZSBvdmVyaGVhZCxcbiAqIHNvIGl0J3Mgb25seSBlbmFibGVkIGluIGRldmVsb3BtZW50IG9yIHdpdGggZXhwbGljaXQgZmxhZy5cbiAqL1xuZnVuY3Rpb24gZ2V0Q2FsbGVySW5mbygpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBjb25zdCBvcmlnaW5hbFByZXBhcmVTdGFja1RyYWNlID0gRXJyb3IucHJlcGFyZVN0YWNrVHJhY2U7XG5cbiAgdHJ5IHtcbiAgICBFcnJvci5wcmVwYXJlU3RhY2tUcmFjZSA9IChfLCBzdGFjaykgPT4gc3RhY2s7XG4gICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoKTtcbiAgICBjb25zdCBzdGFjayA9IGVycm9yLnN0YWNrIGFzIHVua25vd247XG5cbiAgICAvLyBWZXJpZnkgd2UgYWN0dWFsbHkgZ290IGFuIGFycmF5IChDYWxsU2l0ZVtdKSwgbm90IGEgc3RyaW5nXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHN0YWNrKSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBjYWxsU2l0ZXMgPSBzdGFjayBhcyBOb2RlSlMuQ2FsbFNpdGVbXTtcblxuICAgIC8vIFNraXAgb3VyIG93biB1dGlsaXR5IGZpbGVzXG4gICAgZm9yIChjb25zdCBmcmFtZSBvZiBjYWxsU2l0ZXMpIHtcbiAgICAgIGNvbnN0IGZpbGVOYW1lID0gZnJhbWUuZ2V0RmlsZU5hbWUoKTtcbiAgICAgIGlmICghZmlsZU5hbWUpIGNvbnRpbnVlO1xuXG4gICAgICAvLyBTa2lwIGludGVybmFsL2ZyYW1ld29yayBmaWxlc1xuICAgICAgaWYgKFxuICAgICAgICBmaWxlTmFtZS5pbmNsdWRlcygnbm9kZV9tb2R1bGVzJykgfHxcbiAgICAgICAgZmlsZU5hbWUuaW5jbHVkZXMoJ29ic2VydmFiaWxpdHkvbWFuYWdlcicpIHx8XG4gICAgICAgIGZpbGVOYW1lLmluY2x1ZGVzKCdvYnNlcnZhYmlsaXR5L3V0aWxzJykgfHxcbiAgICAgICAgZmlsZU5hbWUuaW5jbHVkZXMoJ29ic2VydmFiaWxpdHkvc3BhbicpIHx8XG4gICAgICAgIGZpbGVOYW1lLmluY2x1ZGVzKCdvYnNlcnZhYmlsaXR5L21ldHJpY3MnKVxuICAgICAgKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBFeHRyYWN0IHVzZWZ1bCBpbmZvXG4gICAgICBjb25zdCBmdW5jdGlvbk5hbWUgPSBmcmFtZS5nZXRGdW5jdGlvbk5hbWUoKSB8fCAnYW5vbnltb3VzJztcbiAgICAgIGNvbnN0IGxpbmVOdW1iZXIgPSBmcmFtZS5nZXRMaW5lTnVtYmVyKCk7XG4gICAgICBjb25zdCBzaG9ydEZpbGVOYW1lID0gZmlsZU5hbWUuc3BsaXQoJy8nKS5zbGljZSgtMikuam9pbignLycpOyAvLyBMYXN0IDIgcGFydHNcblxuICAgICAgcmV0dXJuIGAke3Nob3J0RmlsZU5hbWV9OiR7ZnVuY3Rpb25OYW1lfToke2xpbmVOdW1iZXJ9YDtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgLy8gU3RhY2sgdHJhY2UgcGFyc2luZyBmYWlsZWRcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9IGZpbmFsbHkge1xuICAgIEVycm9yLnByZXBhcmVTdGFja1RyYWNlID0gb3JpZ2luYWxQcmVwYXJlU3RhY2tUcmFjZTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgc291cmNlIGlkZW50aWZpZXIgZm9yIGEgY29udHJvbGxlciBtZXRob2RcbiAqIFxuICogVXNhZ2UgaW4gZGVjb3JhdG9yczpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIEBUcmFjZWQoKVxuICogYXN5bmMgbXlNZXRob2QoKSB7XG4gKiAgIC8vIFNvdXJjZSB3aWxsIGJlOiBjb250cm9sbGVyOk15Q29udHJvbGxlci5teU1ldGhvZFxuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDb250cm9sbGVyU291cmNlKGNsYXNzTmFtZTogc3RyaW5nLCBtZXRob2ROYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYGNvbnRyb2xsZXI6JHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIHNvdXJjZSBpZGVudGlmaWVyIGZvciBhIHNlcnZpY2UgbWV0aG9kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTZXJ2aWNlU291cmNlKHNlcnZpY2VOYW1lOiBzdHJpbmcsIG1ldGhvZE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgc2VydmljZToke3NlcnZpY2VOYW1lfS4ke21ldGhvZE5hbWV9YDtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBzb3VyY2UgaWRlbnRpZmllciBmb3IgYSBxdWV1ZSBoYW5kbGVyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVRdWV1ZVNvdXJjZShxdWV1ZU5hbWU6IHN0cmluZywgaGFuZGxlck5hbWU/OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gaGFuZGxlck5hbWUgPyBgcXVldWU6JHtxdWV1ZU5hbWV9LiR7aGFuZGxlck5hbWV9YCA6IGBxdWV1ZToke3F1ZXVlTmFtZX1gO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIHNvdXJjZSBpZGVudGlmaWVyIGZvciBhIHF1ZXVlIGhhbmRsZXJcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVRhc2tTb3VyY2UodGFza05hbWU6IHN0cmluZywgaGFuZGxlck5hbWU/OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gaGFuZGxlck5hbWUgPyBgdGFzazoke3Rhc2tOYW1lfS4ke2hhbmRsZXJOYW1lfWAgOiBgdGFzazoke3Rhc2tOYW1lfWA7XG59XG5cbi8vIENhY2hlZCBlbnZpcm9ubWVudCB0YWdzIC0gY29tcHV0ZWQgb25jZSwgcmV1c2VkIGZvciBhbGwgZXZlbnRzXG5sZXQgX2NhY2hlZEVudlRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBudWxsID0gbnVsbDtcblxuLyoqXG4gKiBFeHRyYWN0IGNvbW1vbiB0YWdzIGZyb20gZW52aXJvbm1lbnRcbiAqIFxuICogQ0FDSEVEOiBDb21wdXRlZCBvbmNlIG9uIGZpcnN0IGNhbGwsIHJldXNlZCBmb3IgYWxsIHN1YnNlcXVlbnQgY2FsbHMuXG4gKiBUaGlzIGlzIHNhZmUgYmVjYXVzZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZG9uJ3QgY2hhbmdlIGR1cmluZyBMYW1iZGEgZXhlY3V0aW9uLlxuICogXG4gKiBOT1RFOiBNb3N0IG9mIHRoZXNlIGFyZSBBV1MgcnVudGltZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdGhhdCBhcmVcbiAqIGF1dG9tYXRpY2FsbHkgc2V0IGJ5IHRoZSBMYW1iZGEgcnVudGltZSwgbm90IGFwcGxpY2F0aW9uIGNvbmZpZy5cbiAqIEFwcGxpY2F0aW9uLWxldmVsIGNvbmZpZyAobGlrZSBzZXJ2aWNlTmFtZSkgY29tZXMgZnJvbSBESSBjb25maWcuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbnZpcm9ubWVudFRhZ3MoKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gIGlmIChfY2FjaGVkRW52VGFncyAhPT0gbnVsbCkge1xuICAgIHJldHVybiBfY2FjaGVkRW52VGFncztcbiAgfVxuXG4gIGNvbnN0IHRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcblxuICAvLyBBV1MgTGFtYmRhIHJ1bnRpbWUgZW52aXJvbm1lbnQgKGF1dG9tYXRpY2FsbHkgc2V0IGJ5IEFXUylcbiAgY29uc3QgYXdzUmVnaW9uID0gcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTjtcbiAgaWYgKGF3c1JlZ2lvbikge1xuICAgIHRhZ3MucmVnaW9uID0gYXdzUmVnaW9uO1xuICB9XG5cbiAgY29uc3QgZnVuY3Rpb25WZXJzaW9uID0gcHJvY2Vzcy5lbnYuQVdTX0xBTUJEQV9GVU5DVElPTl9WRVJTSU9OO1xuICBpZiAoZnVuY3Rpb25WZXJzaW9uKSB7XG4gICAgdGFncy5mdW5jdGlvblZlcnNpb24gPSBmdW5jdGlvblZlcnNpb247XG4gIH1cblxuICAvLyBBcHBsaWNhdGlvbiBlbnZpcm9ubWVudFxuICBjb25zdCBub2RlRW52ID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlY7XG4gIGlmIChub2RlRW52KSB7XG4gICAgdGFncy5lbnZpcm9ubWVudCA9IG5vZGVFbnY7XG4gIH1cblxuICBjb25zdCBzdGFnZSA9IHByb2Nlc3MuZW52LlNUQUdFO1xuICBpZiAoc3RhZ2UpIHtcbiAgICB0YWdzLnN0YWdlID0gc3RhZ2U7XG4gIH1cblxuICAvLyBTZXJ2aWNlIG5hbWUgZnJvbSBESSBjb25maWdcbiAgdHJ5IHtcbiAgICBjb25zdCBzZXJ2aWNlTmFtZSA9IERJQ29udGFpbmVyLlJPT1QucmVzb2x2ZUNvbmZpZzxzdHJpbmc+KCdvYnNlcnZhYmlsaXR5LnNlcnZpY2VOYW1lJyk7XG4gICAgaWYgKHNlcnZpY2VOYW1lKSB7XG4gICAgICB0YWdzLnNlcnZpY2UgPSBzZXJ2aWNlTmFtZTtcbiAgICB9XG4gIH0gY2F0Y2gge1xuICAgIC8vIENvbmZpZyBub3QgeWV0IHJlZ2lzdGVyZWQsIHNraXBcbiAgfVxuXG4gIC8vIFZlcnNpb24vZGVwbG95bWVudFxuICBjb25zdCBhcHBWZXJzaW9uID0gcHJvY2Vzcy5lbnYuQVBQX1ZFUlNJT047XG4gIGlmIChhcHBWZXJzaW9uKSB7XG4gICAgdGFncy52ZXJzaW9uID0gYXBwVmVyc2lvbjtcbiAgfVxuXG4gIGNvbnN0IGRlcGxveW1lbnRJZCA9IHByb2Nlc3MuZW52LkRFUExPWU1FTlRfSUQ7XG4gIGlmIChkZXBsb3ltZW50SWQpIHtcbiAgICB0YWdzLmRlcGxveW1lbnQgPSBkZXBsb3ltZW50SWQ7XG4gIH1cblxuICBfY2FjaGVkRW52VGFncyA9IHRhZ3M7XG4gIHJldHVybiB0YWdzO1xufVxuXG4vKipcbiAqIENsZWFyIGNhY2hlZCBlbnZpcm9ubWVudCB0YWdzIChmb3IgdGVzdGluZylcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyRW52aXJvbm1lbnRUYWdzQ2FjaGUoKTogdm9pZCB7XG4gIF9jYWNoZWRFbnZUYWdzID0gbnVsbDtcbn1cblxuLyoqXG4gKiBNZXJnZSB0YWdzIHdpdGggZGVmYXVsdHNcbiAqIFxuICogRXZlbnQtc3BlY2lmaWMgdGFncyBvdmVycmlkZSBlbnZpcm9ubWVudCB0YWdzLlxuICogXG4gKiBJTVBPUlRBTlQ6IEFsd2F5cyBjcmVhdGVzIGEgbmV3IG9iamVjdCB0byBhdm9pZCBtdXRhdGluZyBjYWNoZWQgZW52aXJvbm1lbnQgdGFncy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlVGFncyhcbiAgZXZlbnRUYWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbiAgaW5jbHVkZUVudmlyb25tZW50OiBib29sZWFuID0gdHJ1ZSxcbik6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQge1xuICBpZiAoIWluY2x1ZGVFbnZpcm9ubWVudCAmJiAhZXZlbnRUYWdzKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8vIENyZWF0ZSBhIHNoYWxsb3cgY29weSB0byBhdm9pZCBtdXRhdGluZyB0aGUgY2FjaGVkIGVudmlyb25tZW50IHRhZ3MhXG4gIC8vIGdldEVudmlyb25tZW50VGFncygpIHJldHVybnMgYSBjYWNoZWQgb2JqZWN0IHRoYXQgbXVzdCBub3QgYmUgbW9kaWZpZWQuXG4gIGNvbnN0IG1lcmdlZCA9IGluY2x1ZGVFbnZpcm9ubWVudCA/IHsgLi4uZ2V0RW52aXJvbm1lbnRUYWdzKCkgfSA6IHt9O1xuXG4gIGlmIChldmVudFRhZ3MpIHtcbiAgICBPYmplY3QuYXNzaWduKG1lcmdlZCwgZXZlbnRUYWdzKTtcbiAgfVxuXG4gIHJldHVybiBPYmplY3Qua2V5cyhtZXJnZWQpLmxlbmd0aCA+IDAgPyBtZXJnZWQgOiB1bmRlZmluZWQ7XG59XG5cbiJdfQ==