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
 * so consumers get `displayOverride: { path, label, chrome, ... }` per field row.
 */
export declare function mergeDisplayOverrideFieldConfigIntoProperties<T extends UiField>(propertiesConfig: T[], ui: DisplayOverridesUIConfig | undefined): T[];
/**
 * Form pages: if the override storage attribute is present and the entity did not set
 * `hidden` / `isVisible`, default it hidden so raw JSON is not shown as a normal field unless opted in.
 */
export declare function applyDisplayOverrideStorageFieldFormDefaults<T extends UiField>(propertiesConfig: T[], ui: DisplayOverridesUIConfig | undefined): T[];
export {};
