"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.protectAuditData = protectAuditData;
exports.createRedactConfig = createRedactConfig;
const fast_redact_1 = __importDefault(require("fast-redact"));
const serialize_1 = require("../../utils/serialize");
/**
 * Default data protection configuration
 */
const DEFAULT_CONFIG = {
    enabled: true
};
/**
 * Default fast-redact configuration for audit entries
 * Redacts common sensitive fields while preserving audit trail integrity
 */
const DEFAULT_FAST_REDACT_CONFIG = {
    paths: [
        // Authentication & Authorization
        '*.password',
        '*.secret',
        '*.privateKey',
        '*.authorization',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.apiKey',
        '*.clientSecret',
        // Payment & Financial
        '*.creditCard',
        '*.cardNumber',
        '*.ssn',
        '*.bankAccount',
        '*.routingNumber',
        '*.cvv',
        // Headers (cookies are sensitive)
        '*.cookie',
        // Specific header paths (set-cookie has hyphens, use specific paths)
        'data.request.headers.cookie',
        'data.response.headers.set-cookie',
        'context.request.headers.cookie',
        'context.response.headers.set-cookie'
    ],
    censor: '[REDACTED]'
};
/**
 * Applies data protection to an audit entry before logging
 * Uses fast-redact library for efficient and configurable redaction
 */
function protectAuditData(auditEntry, config = {}) {
    const effectiveConfig = { ...DEFAULT_CONFIG, ...config };
    if (!effectiveConfig.enabled) {
        return auditEntry;
    }
    // If custom protection function is provided, use it instead
    if (config.customProtectionFn) {
        return config.customProtectionFn(auditEntry, config);
    }
    // Use fast-redact (default behavior)
    const fastRedactConfig = {
        ...DEFAULT_FAST_REDACT_CONFIG,
        ...config.fastRedact
    };
    // Ensure serialize is false for object return (not string)
    const redactOptions = {
        ...fastRedactConfig,
        serialize: false
    };
    const redactFn = (0, fast_redact_1.default)(redactOptions);
    // Create a proper deep copy and redact
    const copy = (0, serialize_1.deepCopy)(auditEntry);
    return redactFn(copy);
}
/**
 * Utility to create a custom fast-redact configuration
 */
function createRedactConfig(paths, options = {}) {
    return {
        paths,
        censor: '[REDACTED]',
        serialize: false,
        strict: false,
        ...options
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1wcm90ZWN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2F1ZGl0L2hlbHBlcnMvZGF0YS1wcm90ZWN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBbUZBLDRDQWdDQztBQUtELGdEQVdDO0FBbElELDhEQUFxQztBQUNyQyxxREFBaUQ7QUFpQ2pEOztHQUVHO0FBQ0gsTUFBTSxjQUFjLEdBQThFO0lBQ2hHLE9BQU8sRUFBRSxJQUFJO0NBQ2QsQ0FBQztBQUVGOzs7R0FHRztBQUNILE1BQU0sMEJBQTBCLEdBQXFCO0lBQ25ELEtBQUssRUFBRTtRQUNMLGlDQUFpQztRQUNqQyxZQUFZO1FBQ1osVUFBVTtRQUNWLGNBQWM7UUFDZCxpQkFBaUI7UUFDakIsU0FBUztRQUNULGVBQWU7UUFDZixnQkFBZ0I7UUFDaEIsVUFBVTtRQUNWLGdCQUFnQjtRQUVoQixzQkFBc0I7UUFDdEIsY0FBYztRQUNkLGNBQWM7UUFDZCxPQUFPO1FBQ1AsZUFBZTtRQUNmLGlCQUFpQjtRQUNqQixPQUFPO1FBRVAsa0NBQWtDO1FBQ2xDLFVBQVU7UUFFVixxRUFBcUU7UUFDckUsNkJBQTZCO1FBQzdCLGtDQUFrQztRQUNsQyxnQ0FBZ0M7UUFDaEMscUNBQXFDO0tBQ3RDO0lBQ0QsTUFBTSxFQUFFLFlBQVk7Q0FDckIsQ0FBQztBQUVGOzs7R0FHRztBQUNILFNBQWdCLGdCQUFnQixDQUM5QixVQUFzQixFQUN0QixTQUErQixFQUFFO0lBRWpDLE1BQU0sZUFBZSxHQUFHLEVBQUUsR0FBRyxjQUFjLEVBQUUsR0FBRyxNQUFNLEVBQUUsQ0FBQztJQUV6RCxJQUFJLENBQUMsZUFBZSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQzdCLE9BQU8sVUFBVSxDQUFDO0lBQ3BCLENBQUM7SUFFRCw0REFBNEQ7SUFDNUQsSUFBSSxNQUFNLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztRQUM5QixPQUFPLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDdkQsQ0FBQztJQUVELHFDQUFxQztJQUNyQyxNQUFNLGdCQUFnQixHQUFHO1FBQ3ZCLEdBQUcsMEJBQTBCO1FBQzdCLEdBQUcsTUFBTSxDQUFDLFVBQVU7S0FDckIsQ0FBQztJQUVGLDJEQUEyRDtJQUMzRCxNQUFNLGFBQWEsR0FBRztRQUNwQixHQUFHLGdCQUFnQjtRQUNuQixTQUFTLEVBQUUsS0FBSztLQUNqQixDQUFDO0lBRUYsTUFBTSxRQUFRLEdBQUcsSUFBQSxxQkFBVSxFQUFDLGFBQWEsQ0FBQyxDQUFDO0lBRTNDLHVDQUF1QztJQUN2QyxNQUFNLElBQUksR0FBRyxJQUFBLG9CQUFRLEVBQUMsVUFBVSxDQUFDLENBQUM7SUFDbEMsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFlLENBQUM7QUFDdEMsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0Isa0JBQWtCLENBQ2hDLEtBQWUsRUFDZixVQUFxQyxFQUFFO0lBRXZDLE9BQU87UUFDTCxLQUFLO1FBQ0wsTUFBTSxFQUFFLFlBQVk7UUFDcEIsU0FBUyxFQUFFLEtBQUs7UUFDaEIsTUFBTSxFQUFFLEtBQUs7UUFDYixHQUFHLE9BQU87S0FDWCxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEF1ZGl0RW50cnkgfSBmcm9tICcuLi9pbnRlcmZhY2VzJztcbmltcG9ydCBmYXN0UmVkYWN0IGZyb20gJ2Zhc3QtcmVkYWN0JztcbmltcG9ydCB7IGRlZXBDb3B5IH0gZnJvbSAnLi4vLi4vdXRpbHMvc2VyaWFsaXplJztcblxuLyoqXG4gKiBDdXN0b20gZGF0YSBwcm90ZWN0aW9uIGZ1bmN0aW9uIHR5cGUgLSBhbGxvd3MgY29tcGxldGUgY29udHJvbCBvdmVyIHJlZGFjdGlvblxuICovXG5leHBvcnQgdHlwZSBEYXRhUHJvdGVjdGlvbkZ1bmN0aW9uID0gKFxuICBhdWRpdEVudHJ5OiBBdWRpdEVudHJ5LFxuICBjb25maWc6IERhdGFQcm90ZWN0aW9uQ29uZmlnXG4pID0+IEF1ZGl0RW50cnk7XG5cbi8qKlxuICogRmFzdC1yZWRhY3QgY29uZmlndXJhdGlvbiBmb3IgY29tbW9uIGF1ZGl0IHNjZW5hcmlvc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIEZhc3RSZWRhY3RDb25maWcge1xuICBwYXRocz86IHN0cmluZ1tdO1xuICBjZW5zb3I/OiBzdHJpbmcgfCAoKHZhbHVlOiBhbnkpID0+IGFueSk7XG4gIHNlcmlhbGl6ZT86IGJvb2xlYW4gfCAoKG9iajogYW55KSA9PiBzdHJpbmcpO1xuICBzdHJpY3Q/OiBib29sZWFuO1xuICByZW1vdmU/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIERhdGEgcHJvdGVjdGlvbiBjb25maWd1cmF0aW9uIGZvciBhdWRpdCBlbnRyaWVzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGF0YVByb3RlY3Rpb25Db25maWcge1xuICAvKiogRW5hYmxlL2Rpc2FibGUgZGF0YSBwcm90ZWN0aW9uICovXG4gIGVuYWJsZWQ/OiBib29sZWFuO1xuICAvKiogRmFzdC1yZWRhY3QgY29uZmlndXJhdGlvbiAqL1xuICBmYXN0UmVkYWN0PzogRmFzdFJlZGFjdENvbmZpZztcbiAgLyoqIEN1c3RvbSBkYXRhIHByb3RlY3Rpb24gZnVuY3Rpb24gLSBvdmVycmlkZXMgZmFzdC1yZWRhY3QgaWYgcHJvdmlkZWQgKi9cbiAgY3VzdG9tUHJvdGVjdGlvbkZuPzogRGF0YVByb3RlY3Rpb25GdW5jdGlvbjtcbn1cblxuLyoqXG4gKiBEZWZhdWx0IGRhdGEgcHJvdGVjdGlvbiBjb25maWd1cmF0aW9uXG4gKi9cbmNvbnN0IERFRkFVTFRfQ09ORklHOiBSZXF1aXJlZDxPbWl0PERhdGFQcm90ZWN0aW9uQ29uZmlnLCAnY3VzdG9tUHJvdGVjdGlvbkZuJyB8ICdmYXN0UmVkYWN0Jz4+ID0ge1xuICBlbmFibGVkOiB0cnVlXG59O1xuXG4vKipcbiAqIERlZmF1bHQgZmFzdC1yZWRhY3QgY29uZmlndXJhdGlvbiBmb3IgYXVkaXQgZW50cmllc1xuICogUmVkYWN0cyBjb21tb24gc2Vuc2l0aXZlIGZpZWxkcyB3aGlsZSBwcmVzZXJ2aW5nIGF1ZGl0IHRyYWlsIGludGVncml0eVxuICovXG5jb25zdCBERUZBVUxUX0ZBU1RfUkVEQUNUX0NPTkZJRzogRmFzdFJlZGFjdENvbmZpZyA9IHtcbiAgcGF0aHM6IFtcbiAgICAvLyBBdXRoZW50aWNhdGlvbiAmIEF1dGhvcml6YXRpb25cbiAgICAnKi5wYXNzd29yZCcsXG4gICAgJyouc2VjcmV0JyxcbiAgICAnKi5wcml2YXRlS2V5JyxcbiAgICAnKi5hdXRob3JpemF0aW9uJyxcbiAgICAnKi50b2tlbicsXG4gICAgJyouYWNjZXNzVG9rZW4nLFxuICAgICcqLnJlZnJlc2hUb2tlbicsXG4gICAgJyouYXBpS2V5JyxcbiAgICAnKi5jbGllbnRTZWNyZXQnLFxuICAgIFxuICAgIC8vIFBheW1lbnQgJiBGaW5hbmNpYWxcbiAgICAnKi5jcmVkaXRDYXJkJyxcbiAgICAnKi5jYXJkTnVtYmVyJyxcbiAgICAnKi5zc24nLFxuICAgICcqLmJhbmtBY2NvdW50JyxcbiAgICAnKi5yb3V0aW5nTnVtYmVyJyxcbiAgICAnKi5jdnYnLFxuICAgIFxuICAgIC8vIEhlYWRlcnMgKGNvb2tpZXMgYXJlIHNlbnNpdGl2ZSlcbiAgICAnKi5jb29raWUnLFxuICAgIFxuICAgIC8vIFNwZWNpZmljIGhlYWRlciBwYXRocyAoc2V0LWNvb2tpZSBoYXMgaHlwaGVucywgdXNlIHNwZWNpZmljIHBhdGhzKVxuICAgICdkYXRhLnJlcXVlc3QuaGVhZGVycy5jb29raWUnLFxuICAgICdkYXRhLnJlc3BvbnNlLmhlYWRlcnMuc2V0LWNvb2tpZScsXG4gICAgJ2NvbnRleHQucmVxdWVzdC5oZWFkZXJzLmNvb2tpZScsXG4gICAgJ2NvbnRleHQucmVzcG9uc2UuaGVhZGVycy5zZXQtY29va2llJ1xuICBdLFxuICBjZW5zb3I6ICdbUkVEQUNURURdJ1xufTtcblxuLyoqXG4gKiBBcHBsaWVzIGRhdGEgcHJvdGVjdGlvbiB0byBhbiBhdWRpdCBlbnRyeSBiZWZvcmUgbG9nZ2luZ1xuICogVXNlcyBmYXN0LXJlZGFjdCBsaWJyYXJ5IGZvciBlZmZpY2llbnQgYW5kIGNvbmZpZ3VyYWJsZSByZWRhY3Rpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByb3RlY3RBdWRpdERhdGEoXG4gIGF1ZGl0RW50cnk6IEF1ZGl0RW50cnksIFxuICBjb25maWc6IERhdGFQcm90ZWN0aW9uQ29uZmlnID0ge31cbik6IEF1ZGl0RW50cnkge1xuICBjb25zdCBlZmZlY3RpdmVDb25maWcgPSB7IC4uLkRFRkFVTFRfQ09ORklHLCAuLi5jb25maWcgfTtcbiAgXG4gIGlmICghZWZmZWN0aXZlQ29uZmlnLmVuYWJsZWQpIHtcbiAgICByZXR1cm4gYXVkaXRFbnRyeTtcbiAgfVxuXG4gIC8vIElmIGN1c3RvbSBwcm90ZWN0aW9uIGZ1bmN0aW9uIGlzIHByb3ZpZGVkLCB1c2UgaXQgaW5zdGVhZFxuICBpZiAoY29uZmlnLmN1c3RvbVByb3RlY3Rpb25Gbikge1xuICAgIHJldHVybiBjb25maWcuY3VzdG9tUHJvdGVjdGlvbkZuKGF1ZGl0RW50cnksIGNvbmZpZyk7XG4gIH1cblxuICAvLyBVc2UgZmFzdC1yZWRhY3QgKGRlZmF1bHQgYmVoYXZpb3IpXG4gIGNvbnN0IGZhc3RSZWRhY3RDb25maWcgPSB7XG4gICAgLi4uREVGQVVMVF9GQVNUX1JFREFDVF9DT05GSUcsXG4gICAgLi4uY29uZmlnLmZhc3RSZWRhY3RcbiAgfTtcblxuICAvLyBFbnN1cmUgc2VyaWFsaXplIGlzIGZhbHNlIGZvciBvYmplY3QgcmV0dXJuIChub3Qgc3RyaW5nKVxuICBjb25zdCByZWRhY3RPcHRpb25zID0ge1xuICAgIC4uLmZhc3RSZWRhY3RDb25maWcsXG4gICAgc2VyaWFsaXplOiBmYWxzZVxuICB9O1xuXG4gIGNvbnN0IHJlZGFjdEZuID0gZmFzdFJlZGFjdChyZWRhY3RPcHRpb25zKTtcbiAgXG4gIC8vIENyZWF0ZSBhIHByb3BlciBkZWVwIGNvcHkgYW5kIHJlZGFjdFxuICBjb25zdCBjb3B5ID0gZGVlcENvcHkoYXVkaXRFbnRyeSk7XG4gIHJldHVybiByZWRhY3RGbihjb3B5KSBhcyBBdWRpdEVudHJ5O1xufVxuXG4vKipcbiAqIFV0aWxpdHkgdG8gY3JlYXRlIGEgY3VzdG9tIGZhc3QtcmVkYWN0IGNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVJlZGFjdENvbmZpZyhcbiAgcGF0aHM6IHN0cmluZ1tdLFxuICBvcHRpb25zOiBQYXJ0aWFsPEZhc3RSZWRhY3RDb25maWc+ID0ge31cbik6IEZhc3RSZWRhY3RDb25maWcge1xuICByZXR1cm4ge1xuICAgIHBhdGhzLFxuICAgIGNlbnNvcjogJ1tSRURBQ1RFRF0nLFxuICAgIHNlcmlhbGl6ZTogZmFsc2UsXG4gICAgc3RyaWN0OiBmYWxzZSxcbiAgICAuLi5vcHRpb25zXG4gIH07XG59XG4iXX0=