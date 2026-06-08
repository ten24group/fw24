/**
 * Change Detection Utilities
 *
 * Pure utility functions for detecting changes between DynamoDB images.
 * These functions have no external dependencies and can be tested in isolation.
 *
 * Uses proper deep comparison - NO JSON.stringify.
 */
/**
 * Default fields to ignore when comparing images.
 * Includes ElectroDB internal fields and DynamoDB key fields.
 */
export declare const DEFAULT_IGNORED_FIELDS: string[];
/**
 * Change record for a single property
 */
export interface PropertyChange {
    old?: unknown;
    new?: unknown;
}
/**
 * Main entry point for change detection.
 * Compares old and new images and returns only the changed properties.
 *
 * For nested objects, reports only the changed fields within, not the entire object.
 */
export declare function getChangedProperties(oldImage: Record<string, unknown> | undefined, newImage: Record<string, unknown> | undefined, ignoredFields?: string[]): Record<string, PropertyChange>;
