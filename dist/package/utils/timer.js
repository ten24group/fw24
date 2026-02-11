"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Timer = void 0;
exports.formatDuration = formatDuration;
exports.msToSeconds = msToSeconds;
/**
 * Utility class for timing operations and measuring performance
 *
 * @example
 * // Basic usage
 * const timer = Timer.start();
 * await doSomething();
 * console.log(`Operation took ${timer.elapsedSeconds()}s`);
 *
 * @example
 * // Using with logger
 * const timer = Timer.start();
 * await doSomething();
 * logger.info(`✅ Completed in ${timer.elapsedSeconds()}s`);
 */
class Timer {
    startTime;
    constructor() {
        this.startTime = Date.now();
    }
    /**
     * Get elapsed time in milliseconds
     * @returns Elapsed time in milliseconds
     */
    elapsed() {
        return Date.now() - this.startTime;
    }
    /**
     * Get elapsed time formatted as seconds with 1 decimal place
     * @returns Elapsed time as string (e.g., "1.5s")
     */
    elapsedSeconds() {
        return `${(this.elapsed() / 1000).toFixed(1)}s`;
    }
    /**
     * Get elapsed time in milliseconds as a formatted string
     * @returns Elapsed time as string (e.g., "150ms")
     */
    elapsedMs() {
        return `${this.elapsed()}ms`;
    }
    /**
     * Get elapsed time in a human-readable format
     * Automatically chooses seconds or milliseconds based on duration
     * @returns Formatted time string (e.g., "1.5s" or "150ms")
     */
    elapsedHuman() {
        const ms = this.elapsed();
        return ms >= 1000 ? this.elapsedSeconds() : this.elapsedMs();
    }
    /**
     * Static factory method to create and start a timer
     * @returns A new Timer instance
     */
    static start() {
        return new Timer();
    }
}
exports.Timer = Timer;
/**
 * Format milliseconds to human-readable duration
 * @param ms - Milliseconds to format
 * @returns Formatted string (e.g., "1.5s" or "150ms")
 */
function formatDuration(ms) {
    if (ms >= 1000) {
        return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${ms}ms`;
}
/**
 * Format milliseconds to seconds with 1 decimal place
 * @param ms - Milliseconds to format
 * @returns Formatted string (e.g., "1.5")
 */
function msToSeconds(ms) {
    return (ms / 1000).toFixed(1);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGltZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvdGltZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBc0VBLHdDQUtDO0FBT0Qsa0NBRUM7QUFwRkQ7Ozs7Ozs7Ozs7Ozs7O0dBY0c7QUFDSCxNQUFhLEtBQUs7SUFDRyxTQUFTLENBQVM7SUFFbkM7UUFDSSxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUNoQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsT0FBTztRQUNILE9BQU8sSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7SUFDdkMsQ0FBQztJQUVEOzs7T0FHRztJQUNILGNBQWM7UUFDVixPQUFPLEdBQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUM7SUFDcEQsQ0FBQztJQUVEOzs7T0FHRztJQUNILFNBQVM7UUFDTCxPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUM7SUFDakMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxZQUFZO1FBQ1IsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQzFCLE9BQU8sRUFBRSxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7SUFDakUsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxLQUFLO1FBQ1IsT0FBTyxJQUFJLEtBQUssRUFBRSxDQUFDO0lBQ3ZCLENBQUM7Q0FDSjtBQWhERCxzQkFnREM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBZ0IsY0FBYyxDQUFDLEVBQVU7SUFDckMsSUFBSSxFQUFFLElBQUksSUFBSSxFQUFFLENBQUM7UUFDYixPQUFPLEdBQUcsQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUM7SUFDeEMsQ0FBQztJQUNELE9BQU8sR0FBRyxFQUFFLElBQUksQ0FBQztBQUNyQixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQWdCLFdBQVcsQ0FBQyxFQUFVO0lBQ2xDLE9BQU8sQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2xDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFV0aWxpdHkgY2xhc3MgZm9yIHRpbWluZyBvcGVyYXRpb25zIGFuZCBtZWFzdXJpbmcgcGVyZm9ybWFuY2VcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIEJhc2ljIHVzYWdlXG4gKiBjb25zdCB0aW1lciA9IFRpbWVyLnN0YXJ0KCk7XG4gKiBhd2FpdCBkb1NvbWV0aGluZygpO1xuICogY29uc29sZS5sb2coYE9wZXJhdGlvbiB0b29rICR7dGltZXIuZWxhcHNlZFNlY29uZHMoKX1zYCk7XG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBVc2luZyB3aXRoIGxvZ2dlclxuICogY29uc3QgdGltZXIgPSBUaW1lci5zdGFydCgpO1xuICogYXdhaXQgZG9Tb21ldGhpbmcoKTtcbiAqIGxvZ2dlci5pbmZvKGDinIUgQ29tcGxldGVkIGluICR7dGltZXIuZWxhcHNlZFNlY29uZHMoKX1zYCk7XG4gKi9cbmV4cG9ydCBjbGFzcyBUaW1lciB7XG4gICAgcHJpdmF0ZSByZWFkb25seSBzdGFydFRpbWU6IG51bWJlcjtcblxuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICB0aGlzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGVsYXBzZWQgdGltZSBpbiBtaWxsaXNlY29uZHNcbiAgICAgKiBAcmV0dXJucyBFbGFwc2VkIHRpbWUgaW4gbWlsbGlzZWNvbmRzXG4gICAgICovXG4gICAgZWxhcHNlZCgpOiBudW1iZXIge1xuICAgICAgICByZXR1cm4gRGF0ZS5ub3coKSAtIHRoaXMuc3RhcnRUaW1lO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldCBlbGFwc2VkIHRpbWUgZm9ybWF0dGVkIGFzIHNlY29uZHMgd2l0aCAxIGRlY2ltYWwgcGxhY2VcbiAgICAgKiBAcmV0dXJucyBFbGFwc2VkIHRpbWUgYXMgc3RyaW5nIChlLmcuLCBcIjEuNXNcIilcbiAgICAgKi9cbiAgICBlbGFwc2VkU2Vjb25kcygpOiBzdHJpbmcge1xuICAgICAgICByZXR1cm4gYCR7KHRoaXMuZWxhcHNlZCgpIC8gMTAwMCkudG9GaXhlZCgxKX1zYDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXQgZWxhcHNlZCB0aW1lIGluIG1pbGxpc2Vjb25kcyBhcyBhIGZvcm1hdHRlZCBzdHJpbmdcbiAgICAgKiBAcmV0dXJucyBFbGFwc2VkIHRpbWUgYXMgc3RyaW5nIChlLmcuLCBcIjE1MG1zXCIpXG4gICAgICovXG4gICAgZWxhcHNlZE1zKCk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBgJHt0aGlzLmVsYXBzZWQoKX1tc2A7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0IGVsYXBzZWQgdGltZSBpbiBhIGh1bWFuLXJlYWRhYmxlIGZvcm1hdFxuICAgICAqIEF1dG9tYXRpY2FsbHkgY2hvb3NlcyBzZWNvbmRzIG9yIG1pbGxpc2Vjb25kcyBiYXNlZCBvbiBkdXJhdGlvblxuICAgICAqIEByZXR1cm5zIEZvcm1hdHRlZCB0aW1lIHN0cmluZyAoZS5nLiwgXCIxLjVzXCIgb3IgXCIxNTBtc1wiKVxuICAgICAqL1xuICAgIGVsYXBzZWRIdW1hbigpOiBzdHJpbmcge1xuICAgICAgICBjb25zdCBtcyA9IHRoaXMuZWxhcHNlZCgpO1xuICAgICAgICByZXR1cm4gbXMgPj0gMTAwMCA/IHRoaXMuZWxhcHNlZFNlY29uZHMoKSA6IHRoaXMuZWxhcHNlZE1zKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU3RhdGljIGZhY3RvcnkgbWV0aG9kIHRvIGNyZWF0ZSBhbmQgc3RhcnQgYSB0aW1lclxuICAgICAqIEByZXR1cm5zIEEgbmV3IFRpbWVyIGluc3RhbmNlXG4gICAgICovXG4gICAgc3RhdGljIHN0YXJ0KCk6IFRpbWVyIHtcbiAgICAgICAgcmV0dXJuIG5ldyBUaW1lcigpO1xuICAgIH1cbn1cblxuLyoqXG4gKiBGb3JtYXQgbWlsbGlzZWNvbmRzIHRvIGh1bWFuLXJlYWRhYmxlIGR1cmF0aW9uXG4gKiBAcGFyYW0gbXMgLSBNaWxsaXNlY29uZHMgdG8gZm9ybWF0XG4gKiBAcmV0dXJucyBGb3JtYXR0ZWQgc3RyaW5nIChlLmcuLCBcIjEuNXNcIiBvciBcIjE1MG1zXCIpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXREdXJhdGlvbihtczogbnVtYmVyKTogc3RyaW5nIHtcbiAgICBpZiAobXMgPj0gMTAwMCkge1xuICAgICAgICByZXR1cm4gYCR7KG1zIC8gMTAwMCkudG9GaXhlZCgxKX1zYDtcbiAgICB9XG4gICAgcmV0dXJuIGAke21zfW1zYDtcbn1cblxuLyoqXG4gKiBGb3JtYXQgbWlsbGlzZWNvbmRzIHRvIHNlY29uZHMgd2l0aCAxIGRlY2ltYWwgcGxhY2VcbiAqIEBwYXJhbSBtcyAtIE1pbGxpc2Vjb25kcyB0byBmb3JtYXRcbiAqIEByZXR1cm5zIEZvcm1hdHRlZCBzdHJpbmcgKGUuZy4sIFwiMS41XCIpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtc1RvU2Vjb25kcyhtczogbnVtYmVyKTogc3RyaW5nIHtcbiAgICByZXR1cm4gKG1zIC8gMTAwMCkudG9GaXhlZCgxKTtcbn1cblxuIl19