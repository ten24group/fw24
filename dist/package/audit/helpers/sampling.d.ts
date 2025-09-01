import { SamplingFunction } from '../interfaces';
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
export declare const createHashBasedSampling: (rate: number) => SamplingFunction;
/**
 * Creates a random sampling function for statistical sampling
 *
 * @param rate Sampling rate between 0.0 and 1.0
 * @returns SamplingFunction that randomly determines if an operation should be sampled
 */
export declare const createRandomSampling: (rate: number) => SamplingFunction;
/**
 * Creates a sampling function that always returns true (100% sampling)
 */
export declare const createAlwaysSample: () => SamplingFunction;
/**
 * Creates a sampling function that always returns false (0% sampling)
 */
export declare const createNeverSample: () => SamplingFunction;
