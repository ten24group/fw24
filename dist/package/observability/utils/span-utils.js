"use strict";
/**
 * Utility functions for OTEL span handling
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpanKind = void 0;
exports.getSpanKind = getSpanKind;
/**
 * OpenTelemetry SpanKind constants
 *
 * These match the values from @opentelemetry/api SpanKind enum.
 * We define them here to avoid runtime dependency on @opentelemetry/api
 * (which is provided by ADOT layer in Lambda).
 *
 * @see https://opentelemetry.io/docs/specs/otel/trace/api/#spankind
 */
exports.SpanKind = {
    /** Default. Represents an internal operation within an application. */
    INTERNAL: 0,
    /** Indicates that the span covers server-side handling of a request. */
    SERVER: 1,
    /** Indicates that the span describes a request to some remote service. */
    CLIENT: 2,
    /** Indicates that the span describes a producer sending a message to a broker. */
    PRODUCER: 3,
    /** Indicates that the span describes a consumer receiving a message from a broker. */
    CONSUMER: 4,
};
/**
 * Map subType to OpenTelemetry SpanKind
 *
 * Uses heuristics based on common naming patterns to determine the appropriate
 * SpanKind for a given operation subType.
 *
 * @param subType - The operation subType (e.g., 'http', 'db', 'queue')
 * @returns The appropriate SpanKind value
 */
function getSpanKind(subType) {
    if (!subType)
        return exports.SpanKind.INTERNAL;
    const normalized = subType.toLowerCase();
    // HTTP/API spans - typically server-side request handling
    if (normalized.includes('http') || normalized.includes('api') || normalized.includes('request')) {
        return exports.SpanKind.SERVER;
    }
    // Client calls (DB, external services, AWS SDK)
    if (normalized.includes('db') || normalized.includes('database') ||
        normalized.includes('client') || normalized.includes('aws') ||
        normalized.includes('external')) {
        return exports.SpanKind.CLIENT;
    }
    // Message queue producers
    if (normalized.includes('producer') || normalized.includes('publish')) {
        return exports.SpanKind.PRODUCER;
    }
    // Message queue consumers
    if (normalized.includes('consumer') || normalized.includes('subscribe') ||
        normalized.includes('queue')) {
        return exports.SpanKind.CONSUMER;
    }
    // Default to INTERNAL for application code
    return exports.SpanKind.INTERNAL;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3Bhbi11dGlscy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3V0aWxzL3NwYW4tdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOztHQUVHOzs7QUFtQ0gsa0NBOEJDO0FBL0REOzs7Ozs7OztHQVFHO0FBQ1UsUUFBQSxRQUFRLEdBQUc7SUFDdEIsdUVBQXVFO0lBQ3ZFLFFBQVEsRUFBRSxDQUFDO0lBQ1gsd0VBQXdFO0lBQ3hFLE1BQU0sRUFBRSxDQUFDO0lBQ1QsMEVBQTBFO0lBQzFFLE1BQU0sRUFBRSxDQUFDO0lBQ1Qsa0ZBQWtGO0lBQ2xGLFFBQVEsRUFBRSxDQUFDO0lBQ1gsc0ZBQXNGO0lBQ3RGLFFBQVEsRUFBRSxDQUFDO0NBQ0gsQ0FBQztBQUlYOzs7Ozs7OztHQVFHO0FBQ0gsU0FBZ0IsV0FBVyxDQUFDLE9BQWdCO0lBQzFDLElBQUksQ0FBQyxPQUFPO1FBQUUsT0FBTyxnQkFBUSxDQUFDLFFBQVEsQ0FBQztJQUV2QyxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsMERBQTBEO0lBQzFELElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztRQUNoRyxPQUFPLGdCQUFRLENBQUMsTUFBTSxDQUFDO0lBQ3pCLENBQUM7SUFFRCxnREFBZ0Q7SUFDaEQsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDO1FBQzlELFVBQVUsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUM7UUFDM0QsVUFBVSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1FBQ2xDLE9BQU8sZ0JBQVEsQ0FBQyxNQUFNLENBQUM7SUFDekIsQ0FBQztJQUVELDBCQUEwQjtJQUMxQixJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ3RFLE9BQU8sZ0JBQVEsQ0FBQyxRQUFRLENBQUM7SUFDM0IsQ0FBQztJQUVELDBCQUEwQjtJQUMxQixJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUM7UUFDckUsVUFBVSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQy9CLE9BQU8sZ0JBQVEsQ0FBQyxRQUFRLENBQUM7SUFDM0IsQ0FBQztJQUVELDJDQUEyQztJQUMzQyxPQUFPLGdCQUFRLENBQUMsUUFBUSxDQUFDO0FBQzNCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFV0aWxpdHkgZnVuY3Rpb25zIGZvciBPVEVMIHNwYW4gaGFuZGxpbmdcbiAqL1xuXG4vKipcbiAqIE9wZW5UZWxlbWV0cnkgU3BhbktpbmQgY29uc3RhbnRzXG4gKiBcbiAqIFRoZXNlIG1hdGNoIHRoZSB2YWx1ZXMgZnJvbSBAb3BlbnRlbGVtZXRyeS9hcGkgU3BhbktpbmQgZW51bS5cbiAqIFdlIGRlZmluZSB0aGVtIGhlcmUgdG8gYXZvaWQgcnVudGltZSBkZXBlbmRlbmN5IG9uIEBvcGVudGVsZW1ldHJ5L2FwaVxuICogKHdoaWNoIGlzIHByb3ZpZGVkIGJ5IEFET1QgbGF5ZXIgaW4gTGFtYmRhKS5cbiAqIFxuICogQHNlZSBodHRwczovL29wZW50ZWxlbWV0cnkuaW8vZG9jcy9zcGVjcy9vdGVsL3RyYWNlL2FwaS8jc3BhbmtpbmRcbiAqL1xuZXhwb3J0IGNvbnN0IFNwYW5LaW5kID0ge1xuICAvKiogRGVmYXVsdC4gUmVwcmVzZW50cyBhbiBpbnRlcm5hbCBvcGVyYXRpb24gd2l0aGluIGFuIGFwcGxpY2F0aW9uLiAqL1xuICBJTlRFUk5BTDogMCxcbiAgLyoqIEluZGljYXRlcyB0aGF0IHRoZSBzcGFuIGNvdmVycyBzZXJ2ZXItc2lkZSBoYW5kbGluZyBvZiBhIHJlcXVlc3QuICovXG4gIFNFUlZFUjogMSxcbiAgLyoqIEluZGljYXRlcyB0aGF0IHRoZSBzcGFuIGRlc2NyaWJlcyBhIHJlcXVlc3QgdG8gc29tZSByZW1vdGUgc2VydmljZS4gKi9cbiAgQ0xJRU5UOiAyLFxuICAvKiogSW5kaWNhdGVzIHRoYXQgdGhlIHNwYW4gZGVzY3JpYmVzIGEgcHJvZHVjZXIgc2VuZGluZyBhIG1lc3NhZ2UgdG8gYSBicm9rZXIuICovXG4gIFBST0RVQ0VSOiAzLFxuICAvKiogSW5kaWNhdGVzIHRoYXQgdGhlIHNwYW4gZGVzY3JpYmVzIGEgY29uc3VtZXIgcmVjZWl2aW5nIGEgbWVzc2FnZSBmcm9tIGEgYnJva2VyLiAqL1xuICBDT05TVU1FUjogNCxcbn0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIFNwYW5LaW5kVmFsdWUgPSB0eXBlb2YgU3BhbktpbmRbIGtleW9mIHR5cGVvZiBTcGFuS2luZCBdO1xuXG4vKipcbiAqIE1hcCBzdWJUeXBlIHRvIE9wZW5UZWxlbWV0cnkgU3BhbktpbmRcbiAqIFxuICogVXNlcyBoZXVyaXN0aWNzIGJhc2VkIG9uIGNvbW1vbiBuYW1pbmcgcGF0dGVybnMgdG8gZGV0ZXJtaW5lIHRoZSBhcHByb3ByaWF0ZVxuICogU3BhbktpbmQgZm9yIGEgZ2l2ZW4gb3BlcmF0aW9uIHN1YlR5cGUuXG4gKiBcbiAqIEBwYXJhbSBzdWJUeXBlIC0gVGhlIG9wZXJhdGlvbiBzdWJUeXBlIChlLmcuLCAnaHR0cCcsICdkYicsICdxdWV1ZScpXG4gKiBAcmV0dXJucyBUaGUgYXBwcm9wcmlhdGUgU3BhbktpbmQgdmFsdWVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFNwYW5LaW5kKHN1YlR5cGU/OiBzdHJpbmcpOiBTcGFuS2luZFZhbHVlIHtcbiAgaWYgKCFzdWJUeXBlKSByZXR1cm4gU3BhbktpbmQuSU5URVJOQUw7XG5cbiAgY29uc3Qgbm9ybWFsaXplZCA9IHN1YlR5cGUudG9Mb3dlckNhc2UoKTtcblxuICAvLyBIVFRQL0FQSSBzcGFucyAtIHR5cGljYWxseSBzZXJ2ZXItc2lkZSByZXF1ZXN0IGhhbmRsaW5nXG4gIGlmIChub3JtYWxpemVkLmluY2x1ZGVzKCdodHRwJykgfHwgbm9ybWFsaXplZC5pbmNsdWRlcygnYXBpJykgfHwgbm9ybWFsaXplZC5pbmNsdWRlcygncmVxdWVzdCcpKSB7XG4gICAgcmV0dXJuIFNwYW5LaW5kLlNFUlZFUjtcbiAgfVxuXG4gIC8vIENsaWVudCBjYWxscyAoREIsIGV4dGVybmFsIHNlcnZpY2VzLCBBV1MgU0RLKVxuICBpZiAobm9ybWFsaXplZC5pbmNsdWRlcygnZGInKSB8fCBub3JtYWxpemVkLmluY2x1ZGVzKCdkYXRhYmFzZScpIHx8XG4gICAgbm9ybWFsaXplZC5pbmNsdWRlcygnY2xpZW50JykgfHwgbm9ybWFsaXplZC5pbmNsdWRlcygnYXdzJykgfHxcbiAgICBub3JtYWxpemVkLmluY2x1ZGVzKCdleHRlcm5hbCcpKSB7XG4gICAgcmV0dXJuIFNwYW5LaW5kLkNMSUVOVDtcbiAgfVxuXG4gIC8vIE1lc3NhZ2UgcXVldWUgcHJvZHVjZXJzXG4gIGlmIChub3JtYWxpemVkLmluY2x1ZGVzKCdwcm9kdWNlcicpIHx8IG5vcm1hbGl6ZWQuaW5jbHVkZXMoJ3B1Ymxpc2gnKSkge1xuICAgIHJldHVybiBTcGFuS2luZC5QUk9EVUNFUjtcbiAgfVxuXG4gIC8vIE1lc3NhZ2UgcXVldWUgY29uc3VtZXJzXG4gIGlmIChub3JtYWxpemVkLmluY2x1ZGVzKCdjb25zdW1lcicpIHx8IG5vcm1hbGl6ZWQuaW5jbHVkZXMoJ3N1YnNjcmliZScpIHx8XG4gICAgbm9ybWFsaXplZC5pbmNsdWRlcygncXVldWUnKSkge1xuICAgIHJldHVybiBTcGFuS2luZC5DT05TVU1FUjtcbiAgfVxuXG4gIC8vIERlZmF1bHQgdG8gSU5URVJOQUwgZm9yIGFwcGxpY2F0aW9uIGNvZGVcbiAgcmV0dXJuIFNwYW5LaW5kLklOVEVSTkFMO1xufVxuIl19