"use strict";
/**
 * ID Generator for W3C Trace Context compliance
 *
 * W3C Trace Context requires:
 * - Trace ID: 16-byte array (32 hex characters)
 * - Parent ID (Span ID): 8-byte array (16 hex characters)
 *
 * We use crypto.randomBytes for better entropy than Math.random()
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTraceId = generateTraceId;
exports.generateSpanId = generateSpanId;
exports.generateId = generateId;
const crypto_1 = require("crypto");
/**
 * Generate a W3C-compliant Trace ID (16 bytes / 32 hex chars)
 */
function generateTraceId() {
    return (0, crypto_1.randomBytes)(16).toString('hex');
}
/**
 * Generate a W3C-compliant Span ID (8 bytes / 16 hex chars)
 * Also used for Observability Log IDs
 */
function generateSpanId() {
    return (0, crypto_1.randomBytes)(8).toString('hex');
}
/**
 * Generate a generic unique ID (for backward compatibility or non-trace entities)
 * Uses Span ID format (16 hex chars) to maintain consistency
 */
function generateId() {
    return generateSpanId();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaWQtZ2VuZXJhdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvdXRpbHMvaWQtZ2VuZXJhdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7R0FRRzs7QUFPSCwwQ0FFQztBQU1ELHdDQUVDO0FBTUQsZ0NBRUM7QUF2QkQsbUNBQXFDO0FBRXJDOztHQUVHO0FBQ0gsU0FBZ0IsZUFBZTtJQUM3QixPQUFPLElBQUEsb0JBQVcsRUFBQyxFQUFFLENBQUMsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDekMsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQWdCLGNBQWM7SUFDNUIsT0FBTyxJQUFBLG9CQUFXLEVBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ3hDLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFnQixVQUFVO0lBQ3hCLE9BQU8sY0FBYyxFQUFFLENBQUM7QUFDMUIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogSUQgR2VuZXJhdG9yIGZvciBXM0MgVHJhY2UgQ29udGV4dCBjb21wbGlhbmNlXG4gKiBcbiAqIFczQyBUcmFjZSBDb250ZXh0IHJlcXVpcmVzOlxuICogLSBUcmFjZSBJRDogMTYtYnl0ZSBhcnJheSAoMzIgaGV4IGNoYXJhY3RlcnMpXG4gKiAtIFBhcmVudCBJRCAoU3BhbiBJRCk6IDgtYnl0ZSBhcnJheSAoMTYgaGV4IGNoYXJhY3RlcnMpXG4gKiBcbiAqIFdlIHVzZSBjcnlwdG8ucmFuZG9tQnl0ZXMgZm9yIGJldHRlciBlbnRyb3B5IHRoYW4gTWF0aC5yYW5kb20oKVxuICovXG5cbmltcG9ydCB7IHJhbmRvbUJ5dGVzIH0gZnJvbSAnY3J5cHRvJztcblxuLyoqXG4gKiBHZW5lcmF0ZSBhIFczQy1jb21wbGlhbnQgVHJhY2UgSUQgKDE2IGJ5dGVzIC8gMzIgaGV4IGNoYXJzKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVUcmFjZUlkKCk6IHN0cmluZyB7XG4gIHJldHVybiByYW5kb21CeXRlcygxNikudG9TdHJpbmcoJ2hleCcpO1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIGEgVzNDLWNvbXBsaWFudCBTcGFuIElEICg4IGJ5dGVzIC8gMTYgaGV4IGNoYXJzKVxuICogQWxzbyB1c2VkIGZvciBPYnNlcnZhYmlsaXR5IExvZyBJRHNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlU3BhbklkKCk6IHN0cmluZyB7XG4gIHJldHVybiByYW5kb21CeXRlcyg4KS50b1N0cmluZygnaGV4Jyk7XG59XG5cbi8qKlxuICogR2VuZXJhdGUgYSBnZW5lcmljIHVuaXF1ZSBJRCAoZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkgb3Igbm9uLXRyYWNlIGVudGl0aWVzKVxuICogVXNlcyBTcGFuIElEIGZvcm1hdCAoMTYgaGV4IGNoYXJzKSB0byBtYWludGFpbiBjb25zaXN0ZW5jeVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVJZCgpOiBzdHJpbmcge1xuICByZXR1cm4gZ2VuZXJhdGVTcGFuSWQoKTtcbn1cblxuIl19