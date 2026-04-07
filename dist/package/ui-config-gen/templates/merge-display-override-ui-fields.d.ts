import type { DisplayOverridesUIConfig } from '../../entity/display-override-types';
type UiField = Record<string, unknown> & {
    id?: string;
    column?: string;
    name?: string;
    properties?: UiField[];
    items?: {
        type?: string;
        properties?: UiField[];
    };
};
/**
 * Merges `displayOverrides.fields[]` onto formatted `propertiesConfig` rows by dot path,
 * so admin/runtime consumers get `displayOverride: { path, label, chrome, ... }` per field.
 */
export declare function mergeDisplayOverrideFieldConfigIntoProperties<T extends UiField>(propertiesConfig: T[], ui: DisplayOverridesUIConfig | undefined): T[];
/**
 * Form pages: if the override storage attribute is present and the entity did not set
 * `hidden` / `isVisible`, default it hidden so admins rely on detail override UX unless
 * the schema opts in (explicit metadata wins).
 */
export declare function applyDisplayOverrideStorageFieldFormDefaults<T extends UiField>(propertiesConfig: T[], ui: DisplayOverridesUIConfig | undefined): T[];
export {};
