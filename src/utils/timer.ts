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
export class Timer {
    private readonly startTime: number;

    constructor() {
        this.startTime = Date.now();
    }

    /**
     * Get elapsed time in milliseconds
     * @returns Elapsed time in milliseconds
     */
    elapsed(): number {
        return Date.now() - this.startTime;
    }

    /**
     * Get elapsed time formatted as seconds with 1 decimal place
     * @returns Elapsed time as string (e.g., "1.5s")
     */
    elapsedSeconds(): string {
        return `${(this.elapsed() / 1000).toFixed(1)}s`;
    }

    /**
     * Get elapsed time in milliseconds as a formatted string
     * @returns Elapsed time as string (e.g., "150ms")
     */
    elapsedMs(): string {
        return `${this.elapsed()}ms`;
    }

    /**
     * Get elapsed time in a human-readable format
     * Automatically chooses seconds or milliseconds based on duration
     * @returns Formatted time string (e.g., "1.5s" or "150ms")
     */
    elapsedHuman(): string {
        const ms = this.elapsed();
        return ms >= 1000 ? this.elapsedSeconds() : this.elapsedMs();
    }

    /**
     * Static factory method to create and start a timer
     * @returns A new Timer instance
     */
    static start(): Timer {
        return new Timer();
    }
}

/**
 * Format milliseconds to human-readable duration
 * @param ms - Milliseconds to format
 * @returns Formatted string (e.g., "1.5s" or "150ms")
 */
export function formatDuration(ms: number): string {
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
export function msToSeconds(ms: number): string {
    return (ms / 1000).toFixed(1);
}

