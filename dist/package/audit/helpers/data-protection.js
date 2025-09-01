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
        '*.set-cookie'
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1wcm90ZWN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2F1ZGl0L2hlbHBlcnMvZGF0YS1wcm90ZWN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBOEVBLDRDQWdDQztBQUtELGdEQVdDO0FBN0hELDhEQUFxQztBQUNyQyxxREFBaUQ7QUFpQ2pEOztHQUVHO0FBQ0gsTUFBTSxjQUFjLEdBQThFO0lBQ2hHLE9BQU8sRUFBRSxJQUFJO0NBQ2QsQ0FBQztBQUVGOzs7R0FHRztBQUNILE1BQU0sMEJBQTBCLEdBQXFCO0lBQ25ELEtBQUssRUFBRTtRQUNMLGlDQUFpQztRQUNqQyxZQUFZO1FBQ1osVUFBVTtRQUNWLGNBQWM7UUFDZCxpQkFBaUI7UUFDakIsU0FBUztRQUNULGVBQWU7UUFDZixnQkFBZ0I7UUFDaEIsVUFBVTtRQUNWLGdCQUFnQjtRQUVoQixzQkFBc0I7UUFDdEIsY0FBYztRQUNkLGNBQWM7UUFDZCxPQUFPO1FBQ1AsZUFBZTtRQUNmLGlCQUFpQjtRQUNqQixPQUFPO1FBRVAsa0NBQWtDO1FBQ2xDLFVBQVU7UUFDVixjQUFjO0tBQ2Y7SUFDRCxNQUFNLEVBQUUsWUFBWTtDQUNyQixDQUFDO0FBRUY7OztHQUdHO0FBQ0gsU0FBZ0IsZ0JBQWdCLENBQzlCLFVBQXNCLEVBQ3RCLFNBQStCLEVBQUU7SUFFakMsTUFBTSxlQUFlLEdBQUcsRUFBRSxHQUFHLGNBQWMsRUFBRSxHQUFHLE1BQU0sRUFBRSxDQUFDO0lBRXpELElBQUksQ0FBQyxlQUFlLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDN0IsT0FBTyxVQUFVLENBQUM7SUFDcEIsQ0FBQztJQUVELDREQUE0RDtJQUM1RCxJQUFJLE1BQU0sQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1FBQzlCLE9BQU8sTUFBTSxDQUFDLGtCQUFrQixDQUFDLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQztJQUN2RCxDQUFDO0lBRUQscUNBQXFDO0lBQ3JDLE1BQU0sZ0JBQWdCLEdBQUc7UUFDdkIsR0FBRywwQkFBMEI7UUFDN0IsR0FBRyxNQUFNLENBQUMsVUFBVTtLQUNyQixDQUFDO0lBRUYsMkRBQTJEO0lBQzNELE1BQU0sYUFBYSxHQUFHO1FBQ3BCLEdBQUcsZ0JBQWdCO1FBQ25CLFNBQVMsRUFBRSxLQUFLO0tBQ2pCLENBQUM7SUFFRixNQUFNLFFBQVEsR0FBRyxJQUFBLHFCQUFVLEVBQUMsYUFBYSxDQUFDLENBQUM7SUFFM0MsdUNBQXVDO0lBQ3ZDLE1BQU0sSUFBSSxHQUFHLElBQUEsb0JBQVEsRUFBQyxVQUFVLENBQUMsQ0FBQztJQUNsQyxPQUFPLFFBQVEsQ0FBQyxJQUFJLENBQWUsQ0FBQztBQUN0QyxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixrQkFBa0IsQ0FDaEMsS0FBZSxFQUNmLFVBQXFDLEVBQUU7SUFFdkMsT0FBTztRQUNMLEtBQUs7UUFDTCxNQUFNLEVBQUUsWUFBWTtRQUNwQixTQUFTLEVBQUUsS0FBSztRQUNoQixNQUFNLEVBQUUsS0FBSztRQUNiLEdBQUcsT0FBTztLQUNYLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQXVkaXRFbnRyeSB9IGZyb20gJy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IGZhc3RSZWRhY3QgZnJvbSAnZmFzdC1yZWRhY3QnO1xuaW1wb3J0IHsgZGVlcENvcHkgfSBmcm9tICcuLi8uLi91dGlscy9zZXJpYWxpemUnO1xuXG4vKipcbiAqIEN1c3RvbSBkYXRhIHByb3RlY3Rpb24gZnVuY3Rpb24gdHlwZSAtIGFsbG93cyBjb21wbGV0ZSBjb250cm9sIG92ZXIgcmVkYWN0aW9uXG4gKi9cbmV4cG9ydCB0eXBlIERhdGFQcm90ZWN0aW9uRnVuY3Rpb24gPSAoXG4gIGF1ZGl0RW50cnk6IEF1ZGl0RW50cnksXG4gIGNvbmZpZzogRGF0YVByb3RlY3Rpb25Db25maWdcbikgPT4gQXVkaXRFbnRyeTtcblxuLyoqXG4gKiBGYXN0LXJlZGFjdCBjb25maWd1cmF0aW9uIGZvciBjb21tb24gYXVkaXQgc2NlbmFyaW9zXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRmFzdFJlZGFjdENvbmZpZyB7XG4gIHBhdGhzPzogc3RyaW5nW107XG4gIGNlbnNvcj86IHN0cmluZyB8ICgodmFsdWU6IGFueSkgPT4gYW55KTtcbiAgc2VyaWFsaXplPzogYm9vbGVhbiB8ICgob2JqOiBhbnkpID0+IHN0cmluZyk7XG4gIHN0cmljdD86IGJvb2xlYW47XG4gIHJlbW92ZT86IGJvb2xlYW47XG59XG5cbi8qKlxuICogRGF0YSBwcm90ZWN0aW9uIGNvbmZpZ3VyYXRpb24gZm9yIGF1ZGl0IGVudHJpZXNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEYXRhUHJvdGVjdGlvbkNvbmZpZyB7XG4gIC8qKiBFbmFibGUvZGlzYWJsZSBkYXRhIHByb3RlY3Rpb24gKi9cbiAgZW5hYmxlZD86IGJvb2xlYW47XG4gIC8qKiBGYXN0LXJlZGFjdCBjb25maWd1cmF0aW9uICovXG4gIGZhc3RSZWRhY3Q/OiBGYXN0UmVkYWN0Q29uZmlnO1xuICAvKiogQ3VzdG9tIGRhdGEgcHJvdGVjdGlvbiBmdW5jdGlvbiAtIG92ZXJyaWRlcyBmYXN0LXJlZGFjdCBpZiBwcm92aWRlZCAqL1xuICBjdXN0b21Qcm90ZWN0aW9uRm4/OiBEYXRhUHJvdGVjdGlvbkZ1bmN0aW9uO1xufVxuXG4vKipcbiAqIERlZmF1bHQgZGF0YSBwcm90ZWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqL1xuY29uc3QgREVGQVVMVF9DT05GSUc6IFJlcXVpcmVkPE9taXQ8RGF0YVByb3RlY3Rpb25Db25maWcsICdjdXN0b21Qcm90ZWN0aW9uRm4nIHwgJ2Zhc3RSZWRhY3QnPj4gPSB7XG4gIGVuYWJsZWQ6IHRydWVcbn07XG5cbi8qKlxuICogRGVmYXVsdCBmYXN0LXJlZGFjdCBjb25maWd1cmF0aW9uIGZvciBhdWRpdCBlbnRyaWVzXG4gKiBSZWRhY3RzIGNvbW1vbiBzZW5zaXRpdmUgZmllbGRzIHdoaWxlIHByZXNlcnZpbmcgYXVkaXQgdHJhaWwgaW50ZWdyaXR5XG4gKi9cbmNvbnN0IERFRkFVTFRfRkFTVF9SRURBQ1RfQ09ORklHOiBGYXN0UmVkYWN0Q29uZmlnID0ge1xuICBwYXRoczogW1xuICAgIC8vIEF1dGhlbnRpY2F0aW9uICYgQXV0aG9yaXphdGlvblxuICAgICcqLnBhc3N3b3JkJyxcbiAgICAnKi5zZWNyZXQnLFxuICAgICcqLnByaXZhdGVLZXknLFxuICAgICcqLmF1dGhvcml6YXRpb24nLFxuICAgICcqLnRva2VuJyxcbiAgICAnKi5hY2Nlc3NUb2tlbicsXG4gICAgJyoucmVmcmVzaFRva2VuJyxcbiAgICAnKi5hcGlLZXknLFxuICAgICcqLmNsaWVudFNlY3JldCcsXG4gICAgXG4gICAgLy8gUGF5bWVudCAmIEZpbmFuY2lhbFxuICAgICcqLmNyZWRpdENhcmQnLFxuICAgICcqLmNhcmROdW1iZXInLFxuICAgICcqLnNzbicsXG4gICAgJyouYmFua0FjY291bnQnLFxuICAgICcqLnJvdXRpbmdOdW1iZXInLFxuICAgICcqLmN2dicsXG4gICAgXG4gICAgLy8gSGVhZGVycyAoY29va2llcyBhcmUgc2Vuc2l0aXZlKVxuICAgICcqLmNvb2tpZScsXG4gICAgJyouc2V0LWNvb2tpZSdcbiAgXSxcbiAgY2Vuc29yOiAnW1JFREFDVEVEXSdcbn07XG5cbi8qKlxuICogQXBwbGllcyBkYXRhIHByb3RlY3Rpb24gdG8gYW4gYXVkaXQgZW50cnkgYmVmb3JlIGxvZ2dpbmdcbiAqIFVzZXMgZmFzdC1yZWRhY3QgbGlicmFyeSBmb3IgZWZmaWNpZW50IGFuZCBjb25maWd1cmFibGUgcmVkYWN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcm90ZWN0QXVkaXREYXRhKFxuICBhdWRpdEVudHJ5OiBBdWRpdEVudHJ5LCBcbiAgY29uZmlnOiBEYXRhUHJvdGVjdGlvbkNvbmZpZyA9IHt9XG4pOiBBdWRpdEVudHJ5IHtcbiAgY29uc3QgZWZmZWN0aXZlQ29uZmlnID0geyAuLi5ERUZBVUxUX0NPTkZJRywgLi4uY29uZmlnIH07XG4gIFxuICBpZiAoIWVmZmVjdGl2ZUNvbmZpZy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIGF1ZGl0RW50cnk7XG4gIH1cblxuICAvLyBJZiBjdXN0b20gcHJvdGVjdGlvbiBmdW5jdGlvbiBpcyBwcm92aWRlZCwgdXNlIGl0IGluc3RlYWRcbiAgaWYgKGNvbmZpZy5jdXN0b21Qcm90ZWN0aW9uRm4pIHtcbiAgICByZXR1cm4gY29uZmlnLmN1c3RvbVByb3RlY3Rpb25GbihhdWRpdEVudHJ5LCBjb25maWcpO1xuICB9XG5cbiAgLy8gVXNlIGZhc3QtcmVkYWN0IChkZWZhdWx0IGJlaGF2aW9yKVxuICBjb25zdCBmYXN0UmVkYWN0Q29uZmlnID0ge1xuICAgIC4uLkRFRkFVTFRfRkFTVF9SRURBQ1RfQ09ORklHLFxuICAgIC4uLmNvbmZpZy5mYXN0UmVkYWN0XG4gIH07XG5cbiAgLy8gRW5zdXJlIHNlcmlhbGl6ZSBpcyBmYWxzZSBmb3Igb2JqZWN0IHJldHVybiAobm90IHN0cmluZylcbiAgY29uc3QgcmVkYWN0T3B0aW9ucyA9IHtcbiAgICAuLi5mYXN0UmVkYWN0Q29uZmlnLFxuICAgIHNlcmlhbGl6ZTogZmFsc2VcbiAgfTtcblxuICBjb25zdCByZWRhY3RGbiA9IGZhc3RSZWRhY3QocmVkYWN0T3B0aW9ucyk7XG4gIFxuICAvLyBDcmVhdGUgYSBwcm9wZXIgZGVlcCBjb3B5IGFuZCByZWRhY3RcbiAgY29uc3QgY29weSA9IGRlZXBDb3B5KGF1ZGl0RW50cnkpO1xuICByZXR1cm4gcmVkYWN0Rm4oY29weSkgYXMgQXVkaXRFbnRyeTtcbn1cblxuLyoqXG4gKiBVdGlsaXR5IHRvIGNyZWF0ZSBhIGN1c3RvbSBmYXN0LXJlZGFjdCBjb25maWd1cmF0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSZWRhY3RDb25maWcoXG4gIHBhdGhzOiBzdHJpbmdbXSxcbiAgb3B0aW9uczogUGFydGlhbDxGYXN0UmVkYWN0Q29uZmlnPiA9IHt9XG4pOiBGYXN0UmVkYWN0Q29uZmlnIHtcbiAgcmV0dXJuIHtcbiAgICBwYXRocyxcbiAgICBjZW5zb3I6ICdbUkVEQUNURURdJyxcbiAgICBzZXJpYWxpemU6IGZhbHNlLFxuICAgIHN0cmljdDogZmFsc2UsXG4gICAgLi4ub3B0aW9uc1xuICB9O1xufVxuIl19