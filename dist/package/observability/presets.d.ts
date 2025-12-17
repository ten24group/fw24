/**
 * Observability Configuration Presets
 *
 * Pre-configured observability settings for common environments.
 * Provides sensible defaults that can be overridden as needed.
 */
import { ObservabilityConfig } from './types';
/**
 * Preset names for common environments
 */
export type ObservabilityPreset = 'production' | 'development' | 'debug' | 'minimal';
/**
 * Production preset: Cost-optimized with smart sampling
 * - Smart sampling enabled with error context capture
 * - 10% sampling for normal traffic
 * - DynamoDB only for WARN+ logs
 * - Critical events always captured
 */
export declare const productionPreset: ObservabilityConfig;
/**
 * Development preset: Balanced visibility and cost
 * - More verbose than production
 * - 50% sampling for most events
 * - All backends enabled
 * - Good for staging environments
 */
export declare const developmentPreset: ObservabilityConfig;
/**
 * Debug preset: Maximum visibility, no sampling
 * - All events captured
 * - All log levels enabled
 * - Useful for troubleshooting
 * - ⚠️ WARNING: Very expensive, use only for debugging
 */
export declare const debugPreset: ObservabilityConfig;
/**
 * Minimal preset: Bare minimum observability
 * - Only errors and critical events
 * - No sampling needed (already filtered by level)
 * - CloudWatch only
 * - Lowest cost option
 */
export declare const minimalPreset: ObservabilityConfig;
/**
 * Get preset configuration by name
 */
export declare function getPreset(preset: ObservabilityPreset): ObservabilityConfig;
/**
 * Create observability configuration with preset and overrides
 *
 * @example
 * ```typescript
 * // Use production preset with custom service name
 * const config = createObservabilityConfig({
 *   preset: 'production',
 *   serviceName: 'my-api'
 * });
 *
 * // Use development preset with custom sampling
 * const config = createObservabilityConfig({
 *   preset: 'development',
 *   serviceName: 'my-api',
 *   sampling: {
 *     smart: true,
 *     rates: { info: 0.8 }
 *   }
 * });
 *
 * // Use debug preset temporarily
 * const config = createObservabilityConfig({
 *   preset: 'debug',
 *   serviceName: 'my-api'
 * });
 * ```
 */
export declare function createObservabilityConfig(options: {
    preset: ObservabilityPreset;
    serviceName: string;
    overrides?: Partial<ObservabilityConfig>;
}): ObservabilityConfig;
