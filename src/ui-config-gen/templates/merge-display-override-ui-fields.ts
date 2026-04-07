import type { DisplayOverrideFieldConfig, DisplayOverridesUIConfig } from '../../entity/display-override-types';

type UiField = Record<string, unknown> & {
  id?: string;
  column?: string;
  name?: string;
  properties?: UiField[];
  items?: { type?: string; properties?: UiField[] };
};

function segmentKey(row: UiField): string {
  return String(row.column ?? row.name ?? row.id ?? '');
}

/**
 * Merges `displayOverrides.fields[]` onto formatted `propertiesConfig` rows by dot path,
 * so admin/runtime consumers get `displayOverride: { path, label, chrome, ... }` per field.
 */
export function mergeDisplayOverrideFieldConfigIntoProperties<T extends UiField>(
  propertiesConfig: T[],
  ui: DisplayOverridesUIConfig | undefined
): T[] {
  if (!ui) return propertiesConfig;

  const byPath = new Map<string, DisplayOverrideFieldConfig>();
  const includeAuto = ui.auto === true || (ui.auto === undefined && !(ui.fields?.length));
  const preset = ui.autoMode ?? 'editableVisible';
  const excludeAutoPaths = new Set((ui.excludePaths ?? []).map((p) => p.trim()).filter(Boolean));
  const defaultChrome = ui.defaultChrome;

  const isEligibleAutoField = (row: UiField, fullPath: string): boolean => {
    if (!fullPath || excludeAutoPaths.has(fullPath)) return false;
    if (fullPath === ui.storageAttribute || fullPath.startsWith(`${ui.storageAttribute}.`)) return false;
    if (Boolean(row.relation)) return false;
    if (row.isIdentifier === true) return false;
    if (preset === 'allNonRelation') return true;
    const isReadOnly = row.readOnly === true || row.isEditable === false;
    if (isReadOnly) return false;
    const isHidden = row.isVisible === false || row.hidden === true;
    if (isHidden) return false;
    return true;
  };

  const collectAutoPaths = (rows: T[], prefix: string): void => {
    for (const row of rows) {
      const seg = segmentKey(row);
      if (!seg) continue;
      const fullPath = prefix ? `${prefix}.${seg}` : seg;
      const hasChildProps = Array.isArray(row.properties) && row.properties.length > 0;
      const itemsProps = row.items?.properties;
      const hasItemProps = Array.isArray(itemsProps) && itemsProps.length > 0;
      if (hasChildProps) {
        collectAutoPaths(row.properties as T[], fullPath);
      }
      if (hasItemProps) {
        collectAutoPaths(itemsProps as T[], fullPath);
      }
      if (hasChildProps || hasItemProps) continue;
      if (!isEligibleAutoField(row, fullPath)) continue;
      if (byPath.has(fullPath)) continue;
      byPath.set(fullPath, {
        path: fullPath,
        label: typeof row.label === 'string' ? row.label : undefined,
        helpText: typeof row.helpText === 'string' ? row.helpText : undefined,
        chrome: defaultChrome,
      });
    }
  };

  if (includeAuto) {
    collectAutoPaths(propertiesConfig, '');
  }

  for (const f of ui.fields ?? []) {
    if (f?.path && typeof f.path === 'string') {
      const p = f.path.trim();
      if (p) byPath.set(p, f);
    }
  }
  if (byPath.size === 0) return propertiesConfig;

  const mergeRow = (rows: T[], prefix: string): T[] => {
    return rows.map((row) => {
      const seg = segmentKey(row);
      const fullPath = prefix ? `${prefix}.${seg}` : seg;
      let next: T = { ...row };
      const entry = byPath.get(fullPath);
      if (entry) {
        const displayOverride: Record<string, unknown> = { path: entry.path };
        if (entry.channels?.length) displayOverride.channels = entry.channels;
        if (entry.label) displayOverride.label = entry.label;
        if (entry.chrome) displayOverride.chrome = entry.chrome;
        if (entry.helpText) displayOverride.helpText = entry.helpText;
        next = { ...next, displayOverride } as T;
      }
      if (Array.isArray(row.properties) && row.properties.length > 0) {
        next.properties = mergeRow(row.properties as T[], fullPath) as unknown as UiField[];
      }
      const itemsProps = row.items?.properties;
      if (Array.isArray(itemsProps) && itemsProps.length > 0) {
        next.items = {
          ...row.items,
          properties: mergeRow(itemsProps as T[], fullPath) as unknown as UiField[],
        };
      }
      return next;
    });
  };

  return mergeRow(propertiesConfig, '');
}

/**
 * Form pages: if the override storage attribute is present and the entity did not set
 * `hidden` / `isVisible`, default it hidden so admins rely on detail override UX unless
 * the schema opts in (explicit metadata wins).
 */
export function applyDisplayOverrideStorageFieldFormDefaults<T extends UiField>(
  propertiesConfig: T[],
  ui: DisplayOverridesUIConfig | undefined
): T[] {
  if (!ui?.storageAttribute) return propertiesConfig;
  const key = ui.storageAttribute;
  return propertiesConfig.map((row) => {
    const name = String(row.column ?? row.name ?? row.id ?? '');
    if (name !== key) return row;
    const hasVisibility = row.hidden !== undefined || row.isVisible !== undefined;
    if (hasVisibility) return row;
    return { ...row, hidden: true, isVisible: false } as T;
  });
}
