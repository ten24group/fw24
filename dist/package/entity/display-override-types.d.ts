/**
 * Display overrides — optional per-entity metadata for admin presentation maps stored separately from canonical fields.
 * `model.displayOverrides` tells UI config gen and ui24 where the map lives and which paths are overridable.
 */
/** One entry in the override map (stored JSON). */
export interface DisplayOverrideEntry {
    /** Primary payload — field value override, or interpretation depends on `kind`. */
    value?: unknown;
    /** When omitted, applies to the default channel. */
    channel?: string;
    /**
     * Extensible kind for non-value overrides (e.g. hide on a channel).
     * @default 'value'
     */
    kind?: 'value' | 'visibility' | 'format';
    /** When kind is 'visibility', whether the field is shown. */
    visible?: boolean;
}
export type DisplayOverrideStorage = Record<string, DisplayOverrideEntry | unknown>;
/**
 * One overridable target — defined only on `displayOverrides.fields` (not on each entity attribute).
 * Codegen merges this onto matching `propertiesConfig` rows so admin UIs get per-field labels/chrome.
 */
export interface DisplayOverrideFieldConfig {
    /**
     * Dot path for override map keys and schema validation (e.g. `bio`, `address.city`).
     */
    path: string;
    /**
     * Optional channel subset for this field (must be contained in `displayOverrides.channels` when that is set).
     */
    channels?: string[];
    /** Admin-facing label for this override (e.g. “Public bio”). */
    label?: string;
    /**
     * Hint for frontend chrome when an override is active.
     * @default 'tag'
     */
    chrome?: 'tag' | 'badge' | 'outline' | 'none';
    /** Short hint shown in admin tools / tooltips. */
    helpText?: string;
}
/**
 * Entity-level UI wiring for the `displayOverrides` (or custom) map attribute on `schema.model`.
 */
export interface DisplayOverridesUIConfig {
    /** Dynamo / entity attribute name holding the override map (e.g. `displayOverrides`). */
    storageAttribute: string;
    /** Optional admin UI section title. */
    label?: string;
    /** Declared channels for validation and channel-scoped keys (`path@channel`). */
    channels?: string[];
    /**
     * When false, validators reject list-index segments in `fields[].path` (e.g. `items.0.name`).
     * @default false
     */
    allowListItemPaths?: boolean;
    /**
     * Allowlist of paths + per-path admin UX. Developers define overrides here once per entity.
     */
    fields?: DisplayOverrideFieldConfig[];
    /**
     * Auto-discover override paths from generated page properties.
     * Explicit `fields[]` still works and overrides per-path metadata.
     */
    auto?: boolean;
    /**
     * Practical auto mode:
     * - `editableVisible`: visible, editable, non-identifier, non-relation leaf fields
     * - `allNonRelation`: all non-relation leaf fields
     * @default 'editableVisible'
     */
    autoMode?: 'editableVisible' | 'allNonRelation';
    /** Exclude specific dot-paths from auto mode. */
    excludePaths?: string[];
    /** Default chrome for auto-discovered fields. */
    defaultChrome?: 'tag' | 'badge' | 'outline' | 'none';
}
