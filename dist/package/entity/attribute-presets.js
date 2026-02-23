"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.METADATA_FIELDS = exports.ACTOR_TIMESTAMPS = exports.SOFT_DELETE_TIMESTAMPS = exports.TIMESTAMPS = void 0;
exports.defineAttributeGroup = defineAttributeGroup;
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
function defineAttributeGroup(attrs) {
    return attrs;
}
// ── Built-in presets ─────────────────────────────────────────────────────────
/**
 * Standard `createdAt` / `updatedAt` timestamp attributes.
 * Both are read-only, auto-managed, hidden from create/edit/list views.
 * `updatedAt` watches all fields (`watch: '*'`) so it updates on every write.
 */
exports.TIMESTAMPS = defineAttributeGroup({
    createdAt: {
        type: 'string',
        fieldType: 'datetime',
        readOnly: true,
        required: true,
        isCreatable: false,
        isEditable: false,
        isListable: false,
        label: 'Created At',
        default: () => new Date().toISOString(),
        set: () => new Date().toISOString(),
    },
    updatedAt: {
        type: 'string',
        fieldType: 'datetime',
        watch: '*',
        required: true,
        readOnly: true,
        isCreatable: false,
        isEditable: false,
        isListable: false,
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
exports.SOFT_DELETE_TIMESTAMPS = defineAttributeGroup({
    deletedAt: {
        type: 'string',
        fieldType: 'datetime',
        required: false,
        readOnly: true,
        isCreatable: false,
        isEditable: false,
        isListable: false,
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
exports.ACTOR_TIMESTAMPS = defineAttributeGroup({
    createdBy: {
        type: 'string',
        required: false,
        isEditable: false,
        isCreatable: false,
        isListable: false,
        label: 'Created By',
    },
    updatedBy: {
        type: 'string',
        required: false,
        isEditable: false,
        isCreatable: false,
        isListable: false,
        label: 'Updated By',
    },
});
/**
 * Generic `metadata` (JSON) + `notes` (textarea) fields.
 * Useful for operator-facing annotations and arbitrary key-value metadata.
 */
exports.METADATA_FIELDS = defineAttributeGroup({
    metadata: {
        type: 'any',
        fieldType: 'json',
        required: false,
        isListable: false,
        label: 'Metadata',
        helpText: 'Arbitrary JSON metadata',
    },
    notes: {
        type: 'string',
        fieldType: 'textarea',
        required: false,
        isListable: false,
        label: 'Notes',
        helpText: 'Internal notes (not user-facing)',
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXR0cmlidXRlLXByZXNldHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L2F0dHJpYnV0ZS1wcmVzZXRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBb0NHOzs7QUFtQkgsb0RBRUM7QUFqQkQsZ0ZBQWdGO0FBRWhGOzs7Ozs7Ozs7Ozs7R0FZRztBQUNILFNBQWdCLG9CQUFvQixDQUFrRCxLQUFRO0lBQzFGLE9BQU8sS0FBSyxDQUFDO0FBQ2pCLENBQUM7QUFFRCxnRkFBZ0Y7QUFFaEY7Ozs7R0FJRztBQUNVLFFBQUEsVUFBVSxHQUFHLG9CQUFvQixDQUFDO0lBQzNDLFNBQVMsRUFBRTtRQUNQLElBQUksRUFBRSxRQUFpQjtRQUN2QixTQUFTLEVBQUUsVUFBbUI7UUFDOUIsUUFBUSxFQUFFLElBQWE7UUFDdkIsUUFBUSxFQUFFLElBQWE7UUFDdkIsV0FBVyxFQUFFLEtBQWM7UUFDM0IsVUFBVSxFQUFFLEtBQWM7UUFDMUIsVUFBVSxFQUFFLEtBQWM7UUFDMUIsS0FBSyxFQUFFLFlBQVk7UUFDbkIsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1FBQ3ZDLEdBQUcsRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtLQUN0QztJQUNELFNBQVMsRUFBRTtRQUNQLElBQUksRUFBRSxRQUFpQjtRQUN2QixTQUFTLEVBQUUsVUFBbUI7UUFDOUIsS0FBSyxFQUFFLEdBQVk7UUFDbkIsUUFBUSxFQUFFLElBQWE7UUFDdkIsUUFBUSxFQUFFLElBQWE7UUFDdkIsV0FBVyxFQUFFLEtBQWM7UUFDM0IsVUFBVSxFQUFFLEtBQWM7UUFDMUIsVUFBVSxFQUFFLEtBQWM7UUFDMUIsS0FBSyxFQUFFLFlBQVk7UUFDbkIsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1FBQ3ZDLEdBQUcsRUFBRSxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtLQUN0QztDQUNKLENBQUMsQ0FBQztBQUVIOzs7O0dBSUc7QUFDVSxRQUFBLHNCQUFzQixHQUFHLG9CQUFvQixDQUFDO0lBQ3ZELFNBQVMsRUFBRTtRQUNQLElBQUksRUFBRSxRQUFpQjtRQUN2QixTQUFTLEVBQUUsVUFBbUI7UUFDOUIsUUFBUSxFQUFFLEtBQWM7UUFDeEIsUUFBUSxFQUFFLElBQWE7UUFDdkIsV0FBVyxFQUFFLEtBQWM7UUFDM0IsVUFBVSxFQUFFLEtBQWM7UUFDMUIsVUFBVSxFQUFFLEtBQWM7UUFDMUIsS0FBSyxFQUFFLFlBQVk7S0FDdEI7Q0FDSixDQUFDLENBQUM7QUFFSDs7Ozs7OztHQU9HO0FBQ1UsUUFBQSxnQkFBZ0IsR0FBRyxvQkFBb0IsQ0FBQztJQUNqRCxTQUFTLEVBQUU7UUFDUCxJQUFJLEVBQUUsUUFBaUI7UUFDdkIsUUFBUSxFQUFFLEtBQWM7UUFDeEIsVUFBVSxFQUFFLEtBQWM7UUFDMUIsV0FBVyxFQUFFLEtBQWM7UUFDM0IsVUFBVSxFQUFFLEtBQWM7UUFDMUIsS0FBSyxFQUFFLFlBQVk7S0FDdEI7SUFDRCxTQUFTLEVBQUU7UUFDUCxJQUFJLEVBQUUsUUFBaUI7UUFDdkIsUUFBUSxFQUFFLEtBQWM7UUFDeEIsVUFBVSxFQUFFLEtBQWM7UUFDMUIsV0FBVyxFQUFFLEtBQWM7UUFDM0IsVUFBVSxFQUFFLEtBQWM7UUFDMUIsS0FBSyxFQUFFLFlBQVk7S0FDdEI7Q0FDSixDQUFDLENBQUM7QUFFSDs7O0dBR0c7QUFDVSxRQUFBLGVBQWUsR0FBRyxvQkFBb0IsQ0FBQztJQUNoRCxRQUFRLEVBQUU7UUFDTixJQUFJLEVBQUUsS0FBYztRQUNwQixTQUFTLEVBQUUsTUFBZTtRQUMxQixRQUFRLEVBQUUsS0FBYztRQUN4QixVQUFVLEVBQUUsS0FBYztRQUMxQixLQUFLLEVBQUUsVUFBVTtRQUNqQixRQUFRLEVBQUUseUJBQXlCO0tBQ3RDO0lBQ0QsS0FBSyxFQUFFO1FBQ0gsSUFBSSxFQUFFLFFBQWlCO1FBQ3ZCLFNBQVMsRUFBRSxVQUFtQjtRQUM5QixRQUFRLEVBQUUsS0FBYztRQUN4QixVQUFVLEVBQUUsS0FBYztRQUMxQixLQUFLLEVBQUUsT0FBTztRQUNkLFFBQVEsRUFBRSxrQ0FBa0M7S0FDL0M7Q0FDSixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBmaWxlb3ZlcnZpZXcgUHJlZGVmaW5lZCBhdHRyaWJ1dGUgZ3JvdXBzIGZvciBgY3JlYXRlRW50aXR5U2NoZW1hYCAoIzg5KVxuICpcbiAqIEVhY2ggZXhwb3J0IGlzIGEgcGxhaW4gb2JqZWN0IOKAlCBzcHJlYWQgaXQgZGlyZWN0bHkgaW50byB5b3VyIHNjaGVtYSdzIGBhdHRyaWJ1dGVzYC5cbiAqIFR5cGVTY3JpcHQgc2VlcyBldmVyeSBrZXkgaW5kaXZpZHVhbGx5LCBzbyBgRW50aXR5VHlwZUZyb21TY2hlbWFgIC8gYEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hYFxuICogaW5mZXIgdGhlIGNvcnJlY3QgZmllbGQgdHlwZXMgd2l0aCBubyBleHRyYSBjZXJlbW9ueS5cbiAqXG4gKiBUaGUgYGNvbnN0IFRgIG1vZGlmaWVyIGluIGBkZWZpbmVBdHRyaWJ1dGVHcm91cGAgcHJlc2VydmVzIG5hcnJvdyBsaXRlcmFsIHR5cGVzXG4gKiAoZS5nLiBgdHlwZTogJ3N0cmluZydgIHN0YXlzIGAnc3RyaW5nJ2AsIG5vdCB3aWRlbmVkIHRvIGBzdHJpbmdgKS4gVGhpcyBpcyB3aGF0XG4gKiBFbGVjdHJvREIncyBvd24gZ2VuZXJpY3MgbmVlZCBmb3IgY29ycmVjdCBxdWVyeS91cGRhdGUgdHlwZXMuXG4gKlxuICogYGBgdHNcbiAqIGltcG9ydCB7IGNyZWF0ZUVudGl0eVNjaGVtYSwgVElNRVNUQU1QUywgU09GVF9ERUxFVEVfVElNRVNUQU1QUyB9IGZyb20gJ0B0ZW4yNGdyb3VwL2Z3MjQnO1xuICpcbiAqIGV4cG9ydCBjb25zdCBjcmVhdGVPcmRlclNjaGVtYSA9ICgpID0+IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gKiAgIG1vZGVsOiB7IGVudGl0eTogJ29yZGVyJywgZW50aXR5TmFtZVBsdXJhbDogJ09yZGVycycsIHNlcnZpY2U6ICdteVNlcnZpY2UnLCB2ZXJzaW9uOiAnMScsIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zIH0sXG4gKiAgIGF0dHJpYnV0ZXM6IHtcbiAqICAgICBvcmRlcklkOiB7IHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSwgZGVmYXVsdDogKCkgPT4gcmFuZG9tVVVJRCgpLCBpc0lkZW50aWZpZXI6IHRydWUgfSxcbiAqICAgICAuLi5USU1FU1RBTVBTLFxuICogICAgIC4uLlNPRlRfREVMRVRFX1RJTUVTVEFNUFMsXG4gKiAgIH0sXG4gKiAgIGluZGV4ZXM6IHsgLi4uIH0sXG4gKiB9KTtcbiAqXG4gKiBleHBvcnQgdHlwZSBPcmRlclR5cGUgPSBFbnRpdHlUeXBlRnJvbVNjaGVtYTxSZXR1cm5UeXBlPHR5cGVvZiBjcmVhdGVPcmRlclNjaGVtYT4+O1xuICogLy8gT3JkZXJUeXBlIGhhczogb3JkZXJJZCwgY3JlYXRlZEF0LCB1cGRhdGVkQXQsIGRlbGV0ZWRBdCDigJQgYWxsIGNvcnJlY3RseSB0eXBlZFxuICogYGBgXG4gKlxuICogRm9yIGEgY3VzdG9tIGdyb3VwOlxuICogYGBgdHNcbiAqIGNvbnN0IEFDVE9SX0ZJRUxEUyA9IGRlZmluZUF0dHJpYnV0ZUdyb3VwKHtcbiAqICAgY3JlYXRlZEJ5OiB7IHR5cGU6ICdzdHJpbmcnIGFzIGNvbnN0LCByZXF1aXJlZDogZmFsc2UsIGlzRWRpdGFibGU6IGZhbHNlLCBpc0NyZWF0YWJsZTogZmFsc2UgfSxcbiAqICAgdXBkYXRlZEJ5OiB7IHR5cGU6ICdzdHJpbmcnIGFzIGNvbnN0LCByZXF1aXJlZDogZmFsc2UsIGlzRWRpdGFibGU6IGZhbHNlLCBpc0NyZWF0YWJsZTogZmFsc2UgfSxcbiAqIH0pO1xuICogYXR0cmlidXRlczogeyAuLi5BQ1RPUl9GSUVMRFMsIC4uLlRJTUVTVEFNUFMsIG15SWQ6IHsgLi4uIH0gfVxuICogYGBgXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFbnRpdHlBdHRyaWJ1dGUgfSBmcm9tICcuL2Jhc2UtZW50aXR5JztcblxuLy8g4pSA4pSAIENvcmUgZmFjdG9yeSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuLyoqXG4gKiBEZWZpbmVzIGEgcmV1c2FibGUgZ3JvdXAgb2Ygc2NoZW1hIGF0dHJpYnV0ZXMgd2l0aCBmdWxsIHR5cGUgaW5mZXJlbmNlLlxuICpcbiAqIFRoZSBgY29uc3QgVGAgbW9kaWZpZXIgcHJldmVudHMgVHlwZVNjcmlwdCBmcm9tIHdpZGVuaW5nIHRoZSBpbmZlcnJlZCB0eXBlXG4gKiB0byBgUmVjb3JkPHN0cmluZywgRW50aXR5QXR0cmlidXRlPmAsIGtlZXBpbmcgYWxsIGxpdGVyYWwgdHlwZXMgaW50YWN0LlxuICogVXNlIGBzYXRpc2ZpZXMgRW50aXR5QXR0cmlidXRlYCBvbiBpbmRpdmlkdWFsIGVudHJpZXMgZm9yIHZhbGlkYXRpb246XG4gKlxuICogYGBgdHNcbiAqIGNvbnN0IE1ZX0dST1VQID0gZGVmaW5lQXR0cmlidXRlR3JvdXAoe1xuICogICBteUZpZWxkOiB7IHR5cGU6ICdzdHJpbmcnIGFzIGNvbnN0LCByZXF1aXJlZDogZmFsc2UgfSBzYXRpc2ZpZXMgRW50aXR5QXR0cmlidXRlLFxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZmluZUF0dHJpYnV0ZUdyb3VwPGNvbnN0IFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBFbnRpdHlBdHRyaWJ1dGU+PihhdHRyczogVCk6IFQge1xuICAgIHJldHVybiBhdHRycztcbn1cblxuLy8g4pSA4pSAIEJ1aWx0LWluIHByZXNldHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbi8qKlxuICogU3RhbmRhcmQgYGNyZWF0ZWRBdGAgLyBgdXBkYXRlZEF0YCB0aW1lc3RhbXAgYXR0cmlidXRlcy5cbiAqIEJvdGggYXJlIHJlYWQtb25seSwgYXV0by1tYW5hZ2VkLCBoaWRkZW4gZnJvbSBjcmVhdGUvZWRpdC9saXN0IHZpZXdzLlxuICogYHVwZGF0ZWRBdGAgd2F0Y2hlcyBhbGwgZmllbGRzIChgd2F0Y2g6ICcqJ2ApIHNvIGl0IHVwZGF0ZXMgb24gZXZlcnkgd3JpdGUuXG4gKi9cbmV4cG9ydCBjb25zdCBUSU1FU1RBTVBTID0gZGVmaW5lQXR0cmlidXRlR3JvdXAoe1xuICAgIGNyZWF0ZWRBdDoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyBhcyBjb25zdCxcbiAgICAgICAgZmllbGRUeXBlOiAnZGF0ZXRpbWUnIGFzIGNvbnN0LFxuICAgICAgICByZWFkT25seTogdHJ1ZSBhcyBjb25zdCxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUgYXMgY29uc3QsXG4gICAgICAgIGlzQ3JlYXRhYmxlOiBmYWxzZSBhcyBjb25zdCxcbiAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UgYXMgY29uc3QsXG4gICAgICAgIGlzTGlzdGFibGU6IGZhbHNlIGFzIGNvbnN0LFxuICAgICAgICBsYWJlbDogJ0NyZWF0ZWQgQXQnLFxuICAgICAgICBkZWZhdWx0OiAoKSA9PiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHNldDogKCkgPT4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIH0sXG4gICAgdXBkYXRlZEF0OiB7XG4gICAgICAgIHR5cGU6ICdzdHJpbmcnIGFzIGNvbnN0LFxuICAgICAgICBmaWVsZFR5cGU6ICdkYXRldGltZScgYXMgY29uc3QsXG4gICAgICAgIHdhdGNoOiAnKicgYXMgY29uc3QsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlIGFzIGNvbnN0LFxuICAgICAgICByZWFkT25seTogdHJ1ZSBhcyBjb25zdCxcbiAgICAgICAgaXNDcmVhdGFibGU6IGZhbHNlIGFzIGNvbnN0LFxuICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSBhcyBjb25zdCxcbiAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UgYXMgY29uc3QsXG4gICAgICAgIGxhYmVsOiAnVXBkYXRlZCBBdCcsXG4gICAgICAgIGRlZmF1bHQ6ICgpID0+IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgc2V0OiAoKSA9PiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgfSxcbn0pO1xuXG4vKipcbiAqIFNvZnQtZGVsZXRlIGBkZWxldGVkQXRgIGF0dHJpYnV0ZS5cbiAqIE1hcmtzIGEgcmVjb3JkIGFzIGxvZ2ljYWxseSBkZWxldGVkLiBTZXJ2aWNlLWxheWVyIGZpbHRlcmluZyBvbiBgZGVsZXRlZEF0YFxuICogcHJlc2VuY2UgaXMgcmVxdWlyZWQgc2VwYXJhdGVseS5cbiAqL1xuZXhwb3J0IGNvbnN0IFNPRlRfREVMRVRFX1RJTUVTVEFNUFMgPSBkZWZpbmVBdHRyaWJ1dGVHcm91cCh7XG4gICAgZGVsZXRlZEF0OiB7XG4gICAgICAgIHR5cGU6ICdzdHJpbmcnIGFzIGNvbnN0LFxuICAgICAgICBmaWVsZFR5cGU6ICdkYXRldGltZScgYXMgY29uc3QsXG4gICAgICAgIHJlcXVpcmVkOiBmYWxzZSBhcyBjb25zdCxcbiAgICAgICAgcmVhZE9ubHk6IHRydWUgYXMgY29uc3QsXG4gICAgICAgIGlzQ3JlYXRhYmxlOiBmYWxzZSBhcyBjb25zdCxcbiAgICAgICAgaXNFZGl0YWJsZTogZmFsc2UgYXMgY29uc3QsXG4gICAgICAgIGlzTGlzdGFibGU6IGZhbHNlIGFzIGNvbnN0LFxuICAgICAgICBsYWJlbDogJ0RlbGV0ZWQgQXQnLFxuICAgIH0sXG59KTtcblxuLyoqXG4gKiBgY3JlYXRlZEJ5YCAvIGB1cGRhdGVkQnlgIGFjdG9yIHRyYWNraW5nIGF0dHJpYnV0ZXMuXG4gKiBQb3B1bGF0ZSBmcm9tIHlvdXIgc2VydmljZSBsYXllciB1c2luZyB0aGUgYWN0b3IgY29udGV4dDpcbiAqIGBgYHRzXG4gKiBjcmVhdGVkQnk6IGNvbnRleHQuYWN0b3I/LnVzZXJJZCxcbiAqIHVwZGF0ZWRCeTogY29udGV4dC5hY3Rvcj8udXNlcklkLFxuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBBQ1RPUl9USU1FU1RBTVBTID0gZGVmaW5lQXR0cmlidXRlR3JvdXAoe1xuICAgIGNyZWF0ZWRCeToge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyBhcyBjb25zdCxcbiAgICAgICAgcmVxdWlyZWQ6IGZhbHNlIGFzIGNvbnN0LFxuICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSBhcyBjb25zdCxcbiAgICAgICAgaXNDcmVhdGFibGU6IGZhbHNlIGFzIGNvbnN0LFxuICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSBhcyBjb25zdCxcbiAgICAgICAgbGFiZWw6ICdDcmVhdGVkIEJ5JyxcbiAgICB9LFxuICAgIHVwZGF0ZWRCeToge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyBhcyBjb25zdCxcbiAgICAgICAgcmVxdWlyZWQ6IGZhbHNlIGFzIGNvbnN0LFxuICAgICAgICBpc0VkaXRhYmxlOiBmYWxzZSBhcyBjb25zdCxcbiAgICAgICAgaXNDcmVhdGFibGU6IGZhbHNlIGFzIGNvbnN0LFxuICAgICAgICBpc0xpc3RhYmxlOiBmYWxzZSBhcyBjb25zdCxcbiAgICAgICAgbGFiZWw6ICdVcGRhdGVkIEJ5JyxcbiAgICB9LFxufSk7XG5cbi8qKlxuICogR2VuZXJpYyBgbWV0YWRhdGFgIChKU09OKSArIGBub3Rlc2AgKHRleHRhcmVhKSBmaWVsZHMuXG4gKiBVc2VmdWwgZm9yIG9wZXJhdG9yLWZhY2luZyBhbm5vdGF0aW9ucyBhbmQgYXJiaXRyYXJ5IGtleS12YWx1ZSBtZXRhZGF0YS5cbiAqL1xuZXhwb3J0IGNvbnN0IE1FVEFEQVRBX0ZJRUxEUyA9IGRlZmluZUF0dHJpYnV0ZUdyb3VwKHtcbiAgICBtZXRhZGF0YToge1xuICAgICAgICB0eXBlOiAnYW55JyBhcyBjb25zdCxcbiAgICAgICAgZmllbGRUeXBlOiAnanNvbicgYXMgY29uc3QsXG4gICAgICAgIHJlcXVpcmVkOiBmYWxzZSBhcyBjb25zdCxcbiAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UgYXMgY29uc3QsXG4gICAgICAgIGxhYmVsOiAnTWV0YWRhdGEnLFxuICAgICAgICBoZWxwVGV4dDogJ0FyYml0cmFyeSBKU09OIG1ldGFkYXRhJyxcbiAgICB9LFxuICAgIG5vdGVzOiB7XG4gICAgICAgIHR5cGU6ICdzdHJpbmcnIGFzIGNvbnN0LFxuICAgICAgICBmaWVsZFR5cGU6ICd0ZXh0YXJlYScgYXMgY29uc3QsXG4gICAgICAgIHJlcXVpcmVkOiBmYWxzZSBhcyBjb25zdCxcbiAgICAgICAgaXNMaXN0YWJsZTogZmFsc2UgYXMgY29uc3QsXG4gICAgICAgIGxhYmVsOiAnTm90ZXMnLFxuICAgICAgICBoZWxwVGV4dDogJ0ludGVybmFsIG5vdGVzIChub3QgdXNlci1mYWNpbmcpJyxcbiAgICB9LFxufSk7XG4iXX0=