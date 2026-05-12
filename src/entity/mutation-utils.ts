import type { EntitySchema } from "./base-entity";

/**
 * Entity mutation wire-format helpers (create / upsert / patch bodies).
 *
 * Used by {@link ./crud-service} to normalize JSON merge-patch semantics before ElectroDB.
 * Naming aligns with {@link ./query-utils} (reads) vs mutation (writes).
 */

/**
 * JSON-serializable values (RFC 8259 style). Used for HTTP bodies after JSON.parse.
 * Top-level `null` is handled separately by {@link partitionTopLevelJsonNulls}.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [ key: string ]: JsonValue };

/** Top-level keys only — nested objects still use JsonValue inside. */
export type RecordJsonValue = Record<string, JsonValue>;

export interface PartitionedTopLevelNulls {
    readonly setPayload: RecordJsonValue;
    /** Attribute names to REMOVE on patch (merge-patch clear), not passed to `.set()`. */
    readonly nullRemovalKeys: readonly string[];
}

/**
 * Splits top-level JSON `null` from other keys.
 * - **Create / upsert:** persist only `setPayload`.
 * - **Update:** apply `nullRemovalKeys` via ElectroDB `patch().remove([...])`.
 */
export function partitionTopLevelJsonNulls(
    data: Readonly<Record<string, JsonValue | null>>,
): PartitionedTopLevelNulls {
    const setPayload: RecordJsonValue = {};
    const nullRemovalKeys: string[] = [];
    for (const [ key, value ] of Object.entries(data)) {
        if (value === null) {
            nullRemovalKeys.push(key);
        } else {
            setPayload[ key ] = value;
        }
    }
    return { setPayload, nullRemovalKeys };
}

export function isPlainEntityPayload(value: unknown): value is Record<string, JsonValue | null> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Attribute names declared on the entity schema (for removal validation). */
export type SchemaAttributeName<S extends EntitySchema<any, any, any>> = Extract<keyof S[ "attributes" ], string>;

export function isSchemaAttributeName<S extends EntitySchema<any, any, any>>(
    schema: S,
    key: string,
): key is SchemaAttributeName<S> {
    return Object.prototype.hasOwnProperty.call(schema.attributes, key);
}
