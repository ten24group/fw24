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
export const DEFAULT_IGNORED_FIELDS = [
    'updatedAt',
    '__edb_e__',
    '__edb_v__',
    'pk',
    'sk',
    '_actor',
    'gsi1pk', 'gsi1sk',
    'gsi2pk', 'gsi2sk',
    'gsi3pk', 'gsi3sk',
    'gsi4pk', 'gsi4sk',
    'gsi5pk', 'gsi5sk',
    'gsi6pk', 'gsi6sk',
    'gsi7pk', 'gsi7sk',
    'gsi8pk', 'gsi8sk',
    'gsi9pk', 'gsi9sk',
    'gsi10pk', 'gsi10sk',
    'gsi11pk', 'gsi11sk',
    'gsi12pk', 'gsi12sk',
    'gsi13pk', 'gsi13sk',
    'gsi14pk', 'gsi14sk',
    'gsi15pk', 'gsi15sk',
    'gsi16pk', 'gsi16sk',
    'gsi17pk', 'gsi17sk',
    'gsi18pk', 'gsi18sk',
    'gsi19pk', 'gsi19sk',
    'gsi20pk', 'gsi20sk',
];

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
export function getChangedProperties(
    oldImage: Record<string, unknown> | undefined,
    newImage: Record<string, unknown> | undefined,
    ignoredFields: string[] = DEFAULT_IGNORED_FIELDS
): Record<string, PropertyChange> {
    return getChangedPropertiesRecursive(oldImage, newImage, new Set(ignoredFields), true);
}

/**
 * Recursive implementation of change detection.
 */
function getChangedPropertiesRecursive(
    oldObj: Record<string, unknown> | undefined,
    newObj: Record<string, unknown> | undefined,
    ignoredSet: Set<string>,
    isTopLevel: boolean
): Record<string, PropertyChange> {
    const changes: Record<string, PropertyChange> = {};

    // Handle base cases
    if (!oldObj && !newObj) return changes;

    // Handle creation case (no old object)
    if (!oldObj && newObj) {
        for (const key of Object.keys(newObj)) {
            if (!ignoredSet.has(key)) {
                changes[ key ] = { new: newObj[ key ] };
            }
        }
        return changes;
    }

    // Handle deletion case (no new object)
    if (oldObj && !newObj) {
        for (const key of Object.keys(oldObj)) {
            if (!ignoredSet.has(key)) {
                changes[ key ] = { old: oldObj[ key ] };
            }
        }
        return changes;
    }

    // Both exist - compare
    const allKeys = new Set([ ...Object.keys(oldObj!), ...Object.keys(newObj!) ]);

    for (const key of allKeys) {
        // Only apply ignored fields at top level
        if (isTopLevel && ignoredSet.has(key)) continue;

        const oldValue = oldObj![ key ];
        const newValue = newObj![ key ];

        // Addition
        if (oldValue === undefined && newValue !== undefined) {
            changes[ key ] = { new: newValue };
            continue;
        }

        // Deletion
        if (oldValue !== undefined && newValue === undefined) {
            changes[ key ] = { old: oldValue };
            continue;
        }

        // Both are plain objects - recurse
        if (isPlainObject(oldValue) && isPlainObject(newValue)) {
            const nestedChanges = getChangedPropertiesRecursive(
                oldValue as Record<string, unknown>,
                newValue as Record<string, unknown>,
                ignoredSet,
                false // nested calls don't apply top-level ignored fields
            );
            if (Object.keys(nestedChanges).length > 0) {
                // Extract only the changed parts
                const oldDiff: Record<string, unknown> = {};
                const newDiff: Record<string, unknown> = {};
                for (const [ nestedKey, change ] of Object.entries(nestedChanges)) {
                    if (change.old !== undefined) oldDiff[ nestedKey ] = change.old;
                    if (change.new !== undefined) newDiff[ nestedKey ] = change.new;
                }
                changes[ key ] = {
                    old: Object.keys(oldDiff).length > 0 ? oldDiff : undefined,
                    new: Object.keys(newDiff).length > 0 ? newDiff : undefined,
                };
            }
            continue;
        }

        // Both are arrays - compare
        if (Array.isArray(oldValue) && Array.isArray(newValue)) {
            const arrayChanges = compareArrays(oldValue, newValue);
            if (arrayChanges !== null) {
                changes[ key ] = arrayChanges;
            }
            continue;
        }

        // Primitive or mixed comparison
        if (!deepEquals(oldValue, newValue)) {
            changes[ key ] = { old: oldValue, new: newValue };
        }
    }

    return changes;
}

/**
 * Compare two arrays and return changes if different.
 * Returns null if arrays are equal.
 */
function compareArrays(oldArray: unknown[], newArray: unknown[]): PropertyChange | null {
    if (deepEquals(oldArray, newArray)) {
        return null;
    }
    return { old: oldArray, new: newArray };
}

/**
 * Deep equality check without JSON.stringify.
 * Handles: primitives, null, undefined, arrays, plain objects, Date, RegExp, Map, Set.
 */
function deepEquals(a: unknown, b: unknown): boolean {
    // Identical references or both primitives with same value
    if (a === b) return true;

    // Handle null/undefined
    if (a === null || b === null) return a === b;
    if (a === undefined || b === undefined) return a === b;

    // Type mismatch
    const typeA = typeof a;
    const typeB = typeof b;
    if (typeA !== typeB) return false;

    // Primitives (already checked ===)
    if (typeA !== 'object') return false;

    // At this point, both are objects

    // Date comparison
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }
    if (a instanceof Date || b instanceof Date) return false;

    // RegExp comparison
    if (a instanceof RegExp && b instanceof RegExp) {
        return a.source === b.source && a.flags === b.flags;
    }
    if (a instanceof RegExp || b instanceof RegExp) return false;

    // Map comparison
    if (a instanceof Map && b instanceof Map) {
        if (a.size !== b.size) return false;
        for (const [ key, val ] of a) {
            if (!b.has(key) || !deepEquals(val, b.get(key))) return false;
        }
        return true;
    }
    if (a instanceof Map || b instanceof Map) return false;

    // Set comparison
    if (a instanceof Set && b instanceof Set) {
        if (a.size !== b.size) return false;
        for (const val of a) {
            if (!b.has(val)) {
                // Try to find equivalent object in b
                let found = false;
                for (const bVal of b) {
                    if (deepEquals(val, bVal)) {
                        found = true;
                        break;
                    }
                }
                if (!found) return false;
            }
        }
        return true;
    }
    if (a instanceof Set || b instanceof Set) return false;

    // Array comparison
    const isArrayA = Array.isArray(a);
    const isArrayB = Array.isArray(b);
    if (isArrayA !== isArrayB) return false;

    if (isArrayA && isArrayB) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEquals(a[ i ], b[ i ])) return false;
        }
        return true;
    }

    // Plain object comparison
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;

    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
        if (!deepEquals(objA[ key ], objB[ key ])) return false;
    }

    return true;
}

/**
 * Check if value is a plain object (not array, Date, RegExp, etc.)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    if (value instanceof Date) return false;
    if (value instanceof RegExp) return false;
    if (value instanceof Map) return false;
    if (value instanceof Set) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
}
