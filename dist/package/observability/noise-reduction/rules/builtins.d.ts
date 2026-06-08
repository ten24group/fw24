/**
 * Built-in noise reduction rules (v2: three-decision model).
 *
 * These rules provide sensible defaults for common framework hot paths.
 * Applications can override or extend these rules via configuration.
 *
 * Decision mapping from v1:
 * - keep      → emit
 * - fold      → absorb (structured info on parent)
 * - aggregate → absorb (structured info on parent)
 * - drop      → silent (counter only)
 * - downgrade → removed (use absorb or silent instead)
 */
import type { NoiseRule } from '../../types';
/**
 * Get builtin rules for specified presets.
 * Results are cached for performance.
 *
 * @param presets - Array of preset names to activate
 * @returns Readonly array of builtin rules
 */
export declare function getBuiltinRules(presets: readonly string[]): readonly NoiseRule[];
/**
 * Clear the builtin rules cache.
 * Primarily for testing purposes.
 */
export declare function clearBuiltinRulesCache(): void;
