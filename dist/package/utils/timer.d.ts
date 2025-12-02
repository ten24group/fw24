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
export declare class Timer {
    private readonly startTime;
    constructor();
    /**
     * Get elapsed time in milliseconds
     * @returns Elapsed time in milliseconds
     */
    elapsed(): number;
    /**
     * Get elapsed time formatted as seconds with 1 decimal place
     * @returns Elapsed time as string (e.g., "1.5s")
     */
    elapsedSeconds(): string;
    /**
     * Get elapsed time in milliseconds as a formatted string
     * @returns Elapsed time as string (e.g., "150ms")
     */
    elapsedMs(): string;
    /**
     * Get elapsed time in a human-readable format
     * Automatically chooses seconds or milliseconds based on duration
     * @returns Formatted time string (e.g., "1.5s" or "150ms")
     */
    elapsedHuman(): string;
    /**
     * Static factory method to create and start a timer
     * @returns A new Timer instance
     */
    static start(): Timer;
}
/**
 * Format milliseconds to human-readable duration
 * @param ms - Milliseconds to format
 * @returns Formatted string (e.g., "1.5s" or "150ms")
 */
export declare function formatDuration(ms: number): string;
/**
 * Format milliseconds to seconds with 1 decimal place
 * @param ms - Milliseconds to format
 * @returns Formatted string (e.g., "1.5")
 */
export declare function msToSeconds(ms: number): string;
