/**
 * Built-in noise reduction rules.
 *
 * These rules provide sensible defaults for common framework hot paths.
 * Applications can override or extend these rules via configuration.
 */
import type { NoiseRule } from '../../types';
/**
 * Get builtin rules for specified presets.
 * Results are cached for performance.
 *
 * @param presets - Array of preset names to activate
 * @returns Array of builtin rules
 */
export declare function getBuiltinRules(presets: readonly string[]): ReadonlyArray<NoiseRule>;
/**
 * Clear the builtin rules cache.
 * Primarily for testing purposes.
 */
export declare function clearBuiltinRulesCache(): void;
