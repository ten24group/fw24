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
export const createHashBasedSampling = (rate: number): SamplingFunction => {
  return (correlationId: string) => {
    if (rate >= 1.0) return true;
    if (rate <= 0.0) return false;
    
    const hash = correlationId.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a;
    }, 0);
    return Math.abs(hash) % 100 < (rate * 100);
  };
};

/**
 * Creates a random sampling function for statistical sampling
 * 
 * @param rate Sampling rate between 0.0 and 1.0
 * @returns SamplingFunction that randomly determines if an operation should be sampled
 */
export const createRandomSampling = (rate: number): SamplingFunction => {
  return () => {
    if (rate >= 1.0) return true;
    if (rate <= 0.0) return false;
    return Math.random() < rate;
  };
};

/**
 * Creates a sampling function that always returns true (100% sampling)
 */
export const createAlwaysSample = (): SamplingFunction => {
  return () => true;
};

/**
 * Creates a sampling function that always returns false (0% sampling)
 */
export const createNeverSample = (): SamplingFunction => {
  return () => false;
};
