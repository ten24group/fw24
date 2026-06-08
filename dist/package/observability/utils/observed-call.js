"use strict";
/**
 * Observed Call Utility
 *
 * Lightweight wrapper for adding observability spans around any external call
 * (HTTP, gRPC, third-party SDK, etc.) without coupling the framework to a specific
 * HTTP client or transport library.
 *
 * @example
 * ```typescript
 * // Wrap a Stripe API call
 * const charge = await observedCall('stripe.createCharge', () => stripe.charges.create({
 *   amount: 2000,
 *   currency: 'usd',
 * }), { subType: 'http', data: { amount: 2000 } });
 *
 * // Wrap a Redis call
 * const value = await observedCall('redis.get', () => redis.get('session:abc'), {
 *   subType: 'cache',
 * });
 *
 * // Synchronous version
 * const result = observedCallSync('jwt.verify', () => jwt.verify(token, secret), {
 *   subType: 'crypto',
 * });
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.observedCall = observedCall;
exports.observedCallSync = observedCallSync;
const span_1 = require("../observers/span");
/**
 * Wrap an async external call with an observability span.
 *
 * The span automatically captures:
 * - Duration
 * - Success/failure
 * - Error details (if thrown)
 * - Custom data and sub-type from options
 *
 * Errors are re-thrown after being captured.
 */
async function observedCall(operation, fn, options) {
    return span_1.SpanObserver.wrap(operation, fn, {
        level: options?.level ?? 'info',
        data: options?.data,
        tags: {
            component: options?.subType ?? 'external',
            ...options?.tags,
        },
    });
}
/**
 * Wrap a synchronous external call with an observability span.
 *
 * Same as `observedCall` but for synchronous operations.
 */
function observedCallSync(operation, fn, options) {
    return span_1.SpanObserver.wrap(operation, fn, {
        level: options?.level ?? 'info',
        data: options?.data,
        tags: {
            component: options?.subType ?? 'external',
            ...options?.tags,
        },
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2ZWQtY2FsbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3V0aWxzL29ic2VydmVkLWNhbGwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBeUJHOztBQTJCSCxvQ0FhQztBQU9ELDRDQWFDO0FBMURELDRDQUFpRDtBQWNqRDs7Ozs7Ozs7OztHQVVHO0FBQ0ksS0FBSyxVQUFVLFlBQVksQ0FDaEMsU0FBaUIsRUFDakIsRUFBb0IsRUFDcEIsT0FBNkI7SUFFN0IsT0FBTyxtQkFBWSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsRUFBRSxFQUFFO1FBQ3RDLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxJQUFJLE1BQU07UUFDL0IsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJO1FBQ25CLElBQUksRUFBRTtZQUNKLFNBQVMsRUFBRSxPQUFPLEVBQUUsT0FBTyxJQUFJLFVBQVU7WUFDekMsR0FBRyxPQUFPLEVBQUUsSUFBSTtTQUNqQjtLQUNGLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBZ0IsZ0JBQWdCLENBQzlCLFNBQWlCLEVBQ2pCLEVBQVcsRUFDWCxPQUE2QjtJQUU3QixPQUFPLG1CQUFZLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxFQUFFLEVBQUU7UUFDdEMsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLLElBQUksTUFBTTtRQUMvQixJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUk7UUFDbkIsSUFBSSxFQUFFO1lBQ0osU0FBUyxFQUFFLE9BQU8sRUFBRSxPQUFPLElBQUksVUFBVTtZQUN6QyxHQUFHLE9BQU8sRUFBRSxJQUFJO1NBQ2pCO0tBQ0YsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2ZWQgQ2FsbCBVdGlsaXR5XG4gKiBcbiAqIExpZ2h0d2VpZ2h0IHdyYXBwZXIgZm9yIGFkZGluZyBvYnNlcnZhYmlsaXR5IHNwYW5zIGFyb3VuZCBhbnkgZXh0ZXJuYWwgY2FsbFxuICogKEhUVFAsIGdSUEMsIHRoaXJkLXBhcnR5IFNESywgZXRjLikgd2l0aG91dCBjb3VwbGluZyB0aGUgZnJhbWV3b3JrIHRvIGEgc3BlY2lmaWNcbiAqIEhUVFAgY2xpZW50IG9yIHRyYW5zcG9ydCBsaWJyYXJ5LlxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gV3JhcCBhIFN0cmlwZSBBUEkgY2FsbFxuICogY29uc3QgY2hhcmdlID0gYXdhaXQgb2JzZXJ2ZWRDYWxsKCdzdHJpcGUuY3JlYXRlQ2hhcmdlJywgKCkgPT4gc3RyaXBlLmNoYXJnZXMuY3JlYXRlKHtcbiAqICAgYW1vdW50OiAyMDAwLFxuICogICBjdXJyZW5jeTogJ3VzZCcsXG4gKiB9KSwgeyBzdWJUeXBlOiAnaHR0cCcsIGRhdGE6IHsgYW1vdW50OiAyMDAwIH0gfSk7XG4gKiBcbiAqIC8vIFdyYXAgYSBSZWRpcyBjYWxsXG4gKiBjb25zdCB2YWx1ZSA9IGF3YWl0IG9ic2VydmVkQ2FsbCgncmVkaXMuZ2V0JywgKCkgPT4gcmVkaXMuZ2V0KCdzZXNzaW9uOmFiYycpLCB7XG4gKiAgIHN1YlR5cGU6ICdjYWNoZScsXG4gKiB9KTtcbiAqIFxuICogLy8gU3luY2hyb25vdXMgdmVyc2lvblxuICogY29uc3QgcmVzdWx0ID0gb2JzZXJ2ZWRDYWxsU3luYygnand0LnZlcmlmeScsICgpID0+IGp3dC52ZXJpZnkodG9rZW4sIHNlY3JldCksIHtcbiAqICAgc3ViVHlwZTogJ2NyeXB0bycsXG4gKiB9KTtcbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IFNwYW5PYnNlcnZlciB9IGZyb20gJy4uL29ic2VydmVycy9zcGFuJztcbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nIH0gZnJvbSAnLi4vdHlwZXMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9ic2VydmVkQ2FsbE9wdGlvbnMge1xuICAvKiogU3ViLXR5cGUgaGludCBzdG9yZWQgYXMgYSB0YWcgKGUuZy4sICdodHRwJywgJ2NhY2hlJywgJ3F1ZXVlJywgJ2NyeXB0bycpICovXG4gIHN1YlR5cGU/OiBzdHJpbmc7XG4gIC8qKiBBZGRpdGlvbmFsIGRhdGEgdG8gYXR0YWNoIHRvIHRoZSBzcGFuICovXG4gIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIFNldmVyaXR5IGxldmVsIGZvciB0aGUgc3BhbiAoZGVmYXVsdDogJ2luZm8nKSAqL1xuICBsZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZztcbiAgLyoqIEFkZGl0aW9uYWwgdGFncyBmb3IgZmlsdGVyaW5nICovXG4gIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xufVxuXG4vKipcbiAqIFdyYXAgYW4gYXN5bmMgZXh0ZXJuYWwgY2FsbCB3aXRoIGFuIG9ic2VydmFiaWxpdHkgc3Bhbi5cbiAqIFxuICogVGhlIHNwYW4gYXV0b21hdGljYWxseSBjYXB0dXJlczpcbiAqIC0gRHVyYXRpb25cbiAqIC0gU3VjY2Vzcy9mYWlsdXJlXG4gKiAtIEVycm9yIGRldGFpbHMgKGlmIHRocm93bilcbiAqIC0gQ3VzdG9tIGRhdGEgYW5kIHN1Yi10eXBlIGZyb20gb3B0aW9uc1xuICogXG4gKiBFcnJvcnMgYXJlIHJlLXRocm93biBhZnRlciBiZWluZyBjYXB0dXJlZC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG9ic2VydmVkQ2FsbDxUPihcbiAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gIGZuOiAoKSA9PiBQcm9taXNlPFQ+LFxuICBvcHRpb25zPzogT2JzZXJ2ZWRDYWxsT3B0aW9ucyxcbik6IFByb21pc2U8VD4ge1xuICByZXR1cm4gU3Bhbk9ic2VydmVyLndyYXAob3BlcmF0aW9uLCBmbiwge1xuICAgIGxldmVsOiBvcHRpb25zPy5sZXZlbCA/PyAnaW5mbycsXG4gICAgZGF0YTogb3B0aW9ucz8uZGF0YSxcbiAgICB0YWdzOiB7XG4gICAgICBjb21wb25lbnQ6IG9wdGlvbnM/LnN1YlR5cGUgPz8gJ2V4dGVybmFsJyxcbiAgICAgIC4uLm9wdGlvbnM/LnRhZ3MsXG4gICAgfSxcbiAgfSk7XG59XG5cbi8qKlxuICogV3JhcCBhIHN5bmNocm9ub3VzIGV4dGVybmFsIGNhbGwgd2l0aCBhbiBvYnNlcnZhYmlsaXR5IHNwYW4uXG4gKiBcbiAqIFNhbWUgYXMgYG9ic2VydmVkQ2FsbGAgYnV0IGZvciBzeW5jaHJvbm91cyBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gb2JzZXJ2ZWRDYWxsU3luYzxUPihcbiAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gIGZuOiAoKSA9PiBULFxuICBvcHRpb25zPzogT2JzZXJ2ZWRDYWxsT3B0aW9ucyxcbik6IFQge1xuICByZXR1cm4gU3Bhbk9ic2VydmVyLndyYXAob3BlcmF0aW9uLCBmbiwge1xuICAgIGxldmVsOiBvcHRpb25zPy5sZXZlbCA/PyAnaW5mbycsXG4gICAgZGF0YTogb3B0aW9ucz8uZGF0YSxcbiAgICB0YWdzOiB7XG4gICAgICBjb21wb25lbnQ6IG9wdGlvbnM/LnN1YlR5cGUgPz8gJ2V4dGVybmFsJyxcbiAgICAgIC4uLm9wdGlvbnM/LnRhZ3MsXG4gICAgfSxcbiAgfSk7XG59XG4iXX0=