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
export declare function defineAttributeGroup<const T extends Record<string, EntityAttribute>>(attrs: T): T;
/**
 * Standard `createdAt` / `updatedAt` timestamp attributes.
 * Both are read-only, auto-managed, hidden from create/edit/list views.
 * `updatedAt` watches all fields (`watch: '*'`) so it updates on every write.
 */
export declare const TIMESTAMPS: {
    readonly createdAt: {
        readonly type: "string";
        readonly fieldType: "datetime";
        readonly readOnly: true;
        readonly required: true;
        readonly isCreatable: false;
        readonly isEditable: false;
        readonly isListable: false;
        readonly label: "Created At";
        readonly default: () => string;
        readonly set: () => string;
    };
    readonly updatedAt: {
        readonly type: "string";
        readonly fieldType: "datetime";
        readonly watch: "*";
        readonly required: true;
        readonly readOnly: true;
        readonly isCreatable: false;
        readonly isEditable: false;
        readonly isListable: false;
        readonly label: "Updated At";
        readonly default: () => string;
        readonly set: () => string;
    };
};
/**
 * Soft-delete `deletedAt` attribute.
 * Marks a record as logically deleted. Service-layer filtering on `deletedAt`
 * presence is required separately.
 */
export declare const SOFT_DELETE_TIMESTAMPS: {
    readonly deletedAt: {
        readonly type: "string";
        readonly fieldType: "datetime";
        readonly required: false;
        readonly readOnly: true;
        readonly isCreatable: false;
        readonly isEditable: false;
        readonly isListable: false;
        readonly label: "Deleted At";
    };
};
/**
 * `createdBy` / `updatedBy` actor tracking attributes.
 * Populate from your service layer using the actor context:
 * ```ts
 * createdBy: context.actor?.userId,
 * updatedBy: context.actor?.userId,
 * ```
 */
export declare const ACTOR_TIMESTAMPS: {
    readonly createdBy: {
        readonly type: "string";
        readonly required: false;
        readonly isEditable: false;
        readonly isCreatable: false;
        readonly isListable: false;
        readonly label: "Created By";
    };
    readonly updatedBy: {
        readonly type: "string";
        readonly required: false;
        readonly isEditable: false;
        readonly isCreatable: false;
        readonly isListable: false;
        readonly label: "Updated By";
    };
};
/**
 * Generic `metadata` (JSON) + `notes` (textarea) fields.
 * Useful for operator-facing annotations and arbitrary key-value metadata.
 */
export declare const METADATA_FIELDS: {
    readonly metadata: {
        readonly type: "any";
        readonly fieldType: "json";
        readonly required: false;
        readonly isListable: false;
        readonly label: "Metadata";
        readonly helpText: "Arbitrary JSON metadata";
    };
    readonly notes: {
        readonly type: "string";
        readonly fieldType: "textarea";
        readonly required: false;
        readonly isListable: false;
        readonly label: "Notes";
        readonly helpText: "Internal notes (not user-facing)";
    };
};
