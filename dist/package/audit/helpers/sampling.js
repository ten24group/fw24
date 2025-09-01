"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNeverSample = exports.createAlwaysSample = exports.createRandomSampling = exports.createHashBasedSampling = void 0;
/**
 * Creates a hash-based sampling function for consistent sampling across requests
 *
 * @param rate Sampling rate between 0.0 and 1.0
 * @returns SamplingFunction that determines if an operation should be sampled
 *
 * @example
 * ```typescript
 * // Sample 10% of requests
 * const sampler = createHashBasedSampling(0.1);
 *
 * // Use in audit config
 * audit: {
 *   enabled: true,
 *   samplingFn: sampler
 * }
 * ```
 */
const createHashBasedSampling = (rate) => {
    return (correlationId) => {
        if (rate >= 1.0)
            return true;
        if (rate <= 0.0)
            return false;
        const hash = correlationId.split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a;
        }, 0);
        return Math.abs(hash) % 100 < (rate * 100);
    };
};
exports.createHashBasedSampling = createHashBasedSampling;
/**
 * Creates a random sampling function for statistical sampling
 *
 * @param rate Sampling rate between 0.0 and 1.0
 * @returns SamplingFunction that randomly determines if an operation should be sampled
 */
const createRandomSampling = (rate) => {
    return () => {
        if (rate >= 1.0)
            return true;
        if (rate <= 0.0)
            return false;
        return Math.random() < rate;
    };
};
exports.createRandomSampling = createRandomSampling;
/**
 * Creates a sampling function that always returns true (100% sampling)
 */
const createAlwaysSample = () => {
    return () => true;
};
exports.createAlwaysSample = createAlwaysSample;
/**
 * Creates a sampling function that always returns false (0% sampling)
 */
const createNeverSample = () => {
    return () => false;
};
exports.createNeverSample = createNeverSample;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2FtcGxpbmcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvaGVscGVycy9zYW1wbGluZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQTs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FpQkc7QUFDSSxNQUFNLHVCQUF1QixHQUFHLENBQUMsSUFBWSxFQUFvQixFQUFFO0lBQ3hFLE9BQU8sQ0FBQyxhQUFxQixFQUFFLEVBQUU7UUFDL0IsSUFBSSxJQUFJLElBQUksR0FBRztZQUFFLE9BQU8sSUFBSSxDQUFDO1FBQzdCLElBQUksSUFBSSxJQUFJLEdBQUc7WUFBRSxPQUFPLEtBQUssQ0FBQztRQUU5QixNQUFNLElBQUksR0FBRyxhQUFhLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRTtZQUNuRCxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3JDLE9BQU8sQ0FBQyxDQUFDO1FBQ1gsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ04sT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDLElBQUksR0FBRyxHQUFHLENBQUMsQ0FBQztJQUM3QyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUM7QUFYVyxRQUFBLHVCQUF1QiwyQkFXbEM7QUFFRjs7Ozs7R0FLRztBQUNJLE1BQU0sb0JBQW9CLEdBQUcsQ0FBQyxJQUFZLEVBQW9CLEVBQUU7SUFDckUsT0FBTyxHQUFHLEVBQUU7UUFDVixJQUFJLElBQUksSUFBSSxHQUFHO1lBQUUsT0FBTyxJQUFJLENBQUM7UUFDN0IsSUFBSSxJQUFJLElBQUksR0FBRztZQUFFLE9BQU8sS0FBSyxDQUFDO1FBQzlCLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQztJQUM5QixDQUFDLENBQUM7QUFDSixDQUFDLENBQUM7QUFOVyxRQUFBLG9CQUFvQix3QkFNL0I7QUFFRjs7R0FFRztBQUNJLE1BQU0sa0JBQWtCLEdBQUcsR0FBcUIsRUFBRTtJQUN2RCxPQUFPLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQztBQUNwQixDQUFDLENBQUM7QUFGVyxRQUFBLGtCQUFrQixzQkFFN0I7QUFFRjs7R0FFRztBQUNJLE1BQU0saUJBQWlCLEdBQUcsR0FBcUIsRUFBRTtJQUN0RCxPQUFPLEdBQUcsRUFBRSxDQUFDLEtBQUssQ0FBQztBQUNyQixDQUFDLENBQUM7QUFGVyxRQUFBLGlCQUFpQixxQkFFNUIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTYW1wbGluZ0Z1bmN0aW9uIH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5cbi8qKlxuICogQ3JlYXRlcyBhIGhhc2gtYmFzZWQgc2FtcGxpbmcgZnVuY3Rpb24gZm9yIGNvbnNpc3RlbnQgc2FtcGxpbmcgYWNyb3NzIHJlcXVlc3RzXG4gKiBcbiAqIEBwYXJhbSByYXRlIFNhbXBsaW5nIHJhdGUgYmV0d2VlbiAwLjAgYW5kIDEuMFxuICogQHJldHVybnMgU2FtcGxpbmdGdW5jdGlvbiB0aGF0IGRldGVybWluZXMgaWYgYW4gb3BlcmF0aW9uIHNob3VsZCBiZSBzYW1wbGVkXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBTYW1wbGUgMTAlIG9mIHJlcXVlc3RzXG4gKiBjb25zdCBzYW1wbGVyID0gY3JlYXRlSGFzaEJhc2VkU2FtcGxpbmcoMC4xKTtcbiAqIFxuICogLy8gVXNlIGluIGF1ZGl0IGNvbmZpZ1xuICogYXVkaXQ6IHtcbiAqICAgZW5hYmxlZDogdHJ1ZSxcbiAqICAgc2FtcGxpbmdGbjogc2FtcGxlclxuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBjcmVhdGVIYXNoQmFzZWRTYW1wbGluZyA9IChyYXRlOiBudW1iZXIpOiBTYW1wbGluZ0Z1bmN0aW9uID0+IHtcbiAgcmV0dXJuIChjb3JyZWxhdGlvbklkOiBzdHJpbmcpID0+IHtcbiAgICBpZiAocmF0ZSA+PSAxLjApIHJldHVybiB0cnVlO1xuICAgIGlmIChyYXRlIDw9IDAuMCkgcmV0dXJuIGZhbHNlO1xuICAgIFxuICAgIGNvbnN0IGhhc2ggPSBjb3JyZWxhdGlvbklkLnNwbGl0KCcnKS5yZWR1Y2UoKGEsIGIpID0+IHtcbiAgICAgIGEgPSAoKGEgPDwgNSkgLSBhKSArIGIuY2hhckNvZGVBdCgwKTtcbiAgICAgIHJldHVybiBhO1xuICAgIH0sIDApO1xuICAgIHJldHVybiBNYXRoLmFicyhoYXNoKSAlIDEwMCA8IChyYXRlICogMTAwKTtcbiAgfTtcbn07XG5cbi8qKlxuICogQ3JlYXRlcyBhIHJhbmRvbSBzYW1wbGluZyBmdW5jdGlvbiBmb3Igc3RhdGlzdGljYWwgc2FtcGxpbmdcbiAqIFxuICogQHBhcmFtIHJhdGUgU2FtcGxpbmcgcmF0ZSBiZXR3ZWVuIDAuMCBhbmQgMS4wXG4gKiBAcmV0dXJucyBTYW1wbGluZ0Z1bmN0aW9uIHRoYXQgcmFuZG9tbHkgZGV0ZXJtaW5lcyBpZiBhbiBvcGVyYXRpb24gc2hvdWxkIGJlIHNhbXBsZWRcbiAqL1xuZXhwb3J0IGNvbnN0IGNyZWF0ZVJhbmRvbVNhbXBsaW5nID0gKHJhdGU6IG51bWJlcik6IFNhbXBsaW5nRnVuY3Rpb24gPT4ge1xuICByZXR1cm4gKCkgPT4ge1xuICAgIGlmIChyYXRlID49IDEuMCkgcmV0dXJuIHRydWU7XG4gICAgaWYgKHJhdGUgPD0gMC4wKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCByYXRlO1xuICB9O1xufTtcblxuLyoqXG4gKiBDcmVhdGVzIGEgc2FtcGxpbmcgZnVuY3Rpb24gdGhhdCBhbHdheXMgcmV0dXJucyB0cnVlICgxMDAlIHNhbXBsaW5nKVxuICovXG5leHBvcnQgY29uc3QgY3JlYXRlQWx3YXlzU2FtcGxlID0gKCk6IFNhbXBsaW5nRnVuY3Rpb24gPT4ge1xuICByZXR1cm4gKCkgPT4gdHJ1ZTtcbn07XG5cbi8qKlxuICogQ3JlYXRlcyBhIHNhbXBsaW5nIGZ1bmN0aW9uIHRoYXQgYWx3YXlzIHJldHVybnMgZmFsc2UgKDAlIHNhbXBsaW5nKVxuICovXG5leHBvcnQgY29uc3QgY3JlYXRlTmV2ZXJTYW1wbGUgPSAoKTogU2FtcGxpbmdGdW5jdGlvbiA9PiB7XG4gIHJldHVybiAoKSA9PiBmYWxzZTtcbn07XG4iXX0=