import type { Manifest } from './types';
/**
 * Generate all required reports as specified in du-plan.md Section 28:
 * - routes.md - Route mapping and conflicts
 * - capabilities.md - All discovered capabilities
 * - intents.md - Resource intents and IAM policies
 * - bundles.json - Bundle size and dependency metrics
 */
export declare function generateReports(manifest: Manifest, reportsDir: string): void;
