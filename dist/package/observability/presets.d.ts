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
 * - Spans < 100ms are skipped (unless they have errors)
 */
export declare const productionPreset: ObservabilityConfig;
/**
 * Development preset: Balanced visibility and cost
 * - More verbose than production
 * - 50% sampling for most events
 * - All backends enabled
 * - Spans < 50ms skipped (lower threshold than production)
 * - Good for staging environments
 */
export declare const developmentPreset: ObservabilityConfig;
/**
 * Debug preset: Maximum visibility, no sampling
 * - All events captured
 * - All log levels enabled
 * - ALL spans captured regardless of duration
 * - Useful for troubleshooting
 * - ⚠️ WARNING: Very expensive, use only for debugging
 */
export declare const debugPreset: ObservabilityConfig;
/**
 * Minimal preset: Bare minimum observability
 * - Only errors and critical events
 * - No sampling needed (already filtered by level)
 * - CloudWatch only
 * - Only capture failed/slow spans
 * - Lowest cost option
 */
export declare const minimalPreset: ObservabilityConfig;
/**
 * Get preset configuration by name
 */
export declare function getPreset(preset: ObservabilityPreset): ObservabilityConfig;
