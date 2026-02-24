/**
 * @fileoverview Predefined attribute groups for `createEntitySchema` (#89)
 *
 * Each export is a plain object — spread it directly into your schema's `attributes`.
 * TypeScript sees every key individually, so `EntityTypeFromSchema` / `EntityRecordTypeFromSchema`
 * infer the correct field types with no extra ceremony.
 *
 * The `const T` modifier in `defineAttributeGroup` preserves narrow literal types
 * (e.g. `type: 'string'` stays `'string'`, not widened to `string`). This is what
 * ElectroDB's own generics need for correct query/update types.
 *
 * ```ts
 * import { createEntitySchema, TIMESTAMPS, SOFT_DELETE_TIMESTAMPS } from '@ten24group/fw24';
 *
 * export const createOrderSchema = () => createEntitySchema({
 *   model: { entity: 'order', entityNamePlural: 'Orders', service: 'myService', version: '1', entityOperations: DefaultEntityOperations },
 *   attributes: {
 *     orderId: { type: 'string', required: true, default: () => randomUUID(), isIdentifier: true },
 *     ...TIMESTAMPS,
 *     ...SOFT_DELETE_TIMESTAMPS,
 *   },
 *   indexes: { ... },
 * });
 *
 * export type OrderType = EntityTypeFromSchema<ReturnType<typeof createOrderSchema>>;
 * // OrderType has: orderId, createdAt, updatedAt, deletedAt — all correctly typed
 * ```
 *
 * For a custom group:
 * ```ts
 * const ACTOR_FIELDS = defineAttributeGroup({
 *   createdBy: { type: 'string' as const, required: false, isEditable: false, isCreatable: false },
 *   updatedBy: { type: 'string' as const, required: false, isEditable: false, isCreatable: false },
 * });
 * attributes: { ...ACTOR_FIELDS, ...TIMESTAMPS, myId: { ... } }
 * ```
 */

import type { EntityAttribute } from './base-entity';

// ── Core factory ─────────────────────────────────────────────────────────────

/**
 * Defines a reusable group of schema attributes with full type inference.
 *
 * The `const T` modifier prevents TypeScript from widening the inferred type
 * to `Record<string, EntityAttribute>`, keeping all literal types intact.
 * Use `satisfies EntityAttribute` on individual entries for validation:
 *
 * ```ts
 * const MY_GROUP = defineAttributeGroup({
 *   myField: { type: 'string' as const, required: false } satisfies EntityAttribute,
 * });
 * ```
 */
export function defineAttributeGroup<const T extends Record<string, EntityAttribute>>(attrs: T): T {
    return attrs;
}

// ── Built-in presets ─────────────────────────────────────────────────────────

/**
 * Standard `createdAt` / `updatedAt` timestamp attributes.
 * Both are read-only, auto-managed, hidden from create/edit/list views.
 * `updatedAt` watches all fields (`watch: '*'`) so it updates on every write.
 */
export const TIMESTAMPS = defineAttributeGroup({
    createdAt: {
        type: 'string' as const,
        fieldType: 'datetime' as const,
        readOnly: true as const,
        required: true as const,
        isCreatable: false as const,
        isEditable: false as const,
        isListable: false as const,
        label: 'Created At',
        default: () => new Date().toISOString(),
        set: () => new Date().toISOString(),
    },
    updatedAt: {
        type: 'string' as const,
        fieldType: 'datetime' as const,
        watch: '*' as const,
        required: true as const,
        readOnly: true as const,
        isCreatable: false as const,
        isEditable: false as const,
        isListable: false as const,
        label: 'Updated At',
        default: () => new Date().toISOString(),
        set: () => new Date().toISOString(),
    },
});

/**
 * Soft-delete `deletedAt` attribute.
 * Marks a record as logically deleted. Service-layer filtering on `deletedAt`
 * presence is required separately.
 */
export const SOFT_DELETE_TIMESTAMPS = defineAttributeGroup({
    deletedAt: {
        type: 'string' as const,
        fieldType: 'datetime' as const,
        required: false as const,
        readOnly: true as const,
        isCreatable: false as const,
        isEditable: false as const,
        isListable: false as const,
        label: 'Deleted At',
    },
});

/**
 * `createdBy` / `updatedBy` actor tracking attributes.
 * Populate from your service layer using the actor context:
 * ```ts
 * createdBy: context.actor?.userId,
 * updatedBy: context.actor?.userId,
 * ```
 */
export const ACTOR_TIMESTAMPS = defineAttributeGroup({
    createdBy: {
        type: 'string' as const,
        required: false as const,
        isEditable: false as const,
        isCreatable: false as const,
        isListable: false as const,
        label: 'Created By',
    },
    updatedBy: {
        type: 'string' as const,
        required: false as const,
        isEditable: false as const,
        isCreatable: false as const,
        isListable: false as const,
        label: 'Updated By',
    },
});

/**
 * Generic `metadata` (JSON) + `notes` (textarea) fields.
 * Useful for operator-facing annotations and arbitrary key-value metadata.
 */
export const METADATA_FIELDS = defineAttributeGroup({
    metadata: {
        type: 'any' as const,
        fieldType: 'json' as const,
        required: false as const,
        isListable: false as const,
        label: 'Metadata',
        helpText: 'Arbitrary JSON metadata',
    },
    notes: {
        type: 'string' as const,
        fieldType: 'textarea' as const,
        required: false as const,
        isListable: false as const,
        label: 'Notes',
        helpText: 'Internal notes (not user-facing)',
    },
});
