"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeDisplayOverrideFieldConfigIntoProperties = mergeDisplayOverrideFieldConfigIntoProperties;
exports.applyDisplayOverrideStorageFieldFormDefaults = applyDisplayOverrideStorageFieldFormDefaults;
function segmentKey(row) {
    return String(row.column ?? row.name ?? row.id ?? '');
}
/**
 * Merges `displayOverrides.fields[]` onto formatted `propertiesConfig` rows by dot path,
 * so consumers get `displayOverride: { path, label, chrome, ... }` per field row.
 */
function mergeDisplayOverrideFieldConfigIntoProperties(propertiesConfig, ui) {
    if (!ui)
        return propertiesConfig;
    const byPath = new Map();
    const includeAuto = ui.auto === true || (ui.auto === undefined && !(ui.fields?.length));
    const excludeAutoPaths = new Set((ui.excludePaths ?? []).map((p) => p.trim()).filter(Boolean));
    const defaultChrome = ui.defaultChrome;
    /** Every leaf field in this page's propertiesConfig, except storage map, relations, and identifiers. Use `excludePaths` to opt out. */
    const isEligibleAutoField = (row, fullPath) => {
        if (!fullPath || excludeAutoPaths.has(fullPath))
            return false;
        if (fullPath === ui.storageAttribute || fullPath.startsWith(`${ui.storageAttribute}.`))
            return false;
        if (Boolean(row.relation))
            return false;
        if (row.isIdentifier === true)
            return false;
        return true;
    };
    const collectAutoPaths = (rows, prefix) => {
        for (const row of rows) {
            const seg = segmentKey(row);
            if (!seg)
                continue;
            const fullPath = prefix ? `${prefix}.${seg}` : seg;
            const hasChildProps = Array.isArray(row.properties) && row.properties.length > 0;
            const itemsProps = row.items?.properties;
            const hasItemProps = Array.isArray(itemsProps) && itemsProps.length > 0;
            if (hasChildProps) {
                collectAutoPaths(row.properties, fullPath);
            }
            if (hasItemProps) {
                collectAutoPaths(itemsProps, fullPath);
            }
            if (hasChildProps || hasItemProps)
                continue;
            if (!isEligibleAutoField(row, fullPath))
                continue;
            if (byPath.has(fullPath))
                continue;
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
            if (p)
                byPath.set(p, f);
        }
    }
    if (byPath.size === 0)
        return propertiesConfig;
    const mergeRow = (rows, prefix) => {
        return rows.map((row) => {
            const seg = segmentKey(row);
            const fullPath = prefix ? `${prefix}.${seg}` : seg;
            let next = { ...row };
            const entry = byPath.get(fullPath);
            if (entry) {
                const displayOverride = { path: entry.path };
                if (entry.channels?.length)
                    displayOverride.channels = entry.channels;
                if (entry.label)
                    displayOverride.label = entry.label;
                if (entry.chrome)
                    displayOverride.chrome = entry.chrome;
                if (entry.helpText)
                    displayOverride.helpText = entry.helpText;
                next = { ...next, displayOverride };
            }
            if (Array.isArray(row.properties) && row.properties.length > 0) {
                next.properties = mergeRow(row.properties, fullPath);
            }
            const itemsProps = row.items?.properties;
            if (Array.isArray(itemsProps) && itemsProps.length > 0) {
                next.items = {
                    ...row.items,
                    properties: mergeRow(itemsProps, fullPath),
                };
            }
            return next;
        });
    };
    return mergeRow(propertiesConfig, '');
}
/**
 * Form pages: if the override storage attribute is present and the entity did not set
 * `hidden` / `isVisible`, default it hidden so raw JSON is not shown as a normal field unless opted in.
 */
function applyDisplayOverrideStorageFieldFormDefaults(propertiesConfig, ui) {
    if (!ui?.storageAttribute)
        return propertiesConfig;
    const key = ui.storageAttribute;
    return propertiesConfig.map((row) => {
        const name = String(row.column ?? row.name ?? row.id ?? '');
        if (name !== key)
            return row;
        const hasVisibility = row.hidden !== undefined || row.isVisible !== undefined;
        if (hasVisibility)
            return row;
        return { ...row, hidden: true, isVisible: false };
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVyZ2UtZGlzcGxheS1vdmVycmlkZS11aS1maWVsZHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvdWktY29uZmlnLWdlbi90ZW1wbGF0ZXMvbWVyZ2UtZGlzcGxheS1vdmVycmlkZS11aS1maWVsZHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFrQkEsc0dBdUZDO0FBTUQsb0dBYUM7QUFsSEQsU0FBUyxVQUFVLENBQUMsR0FBWTtJQUM5QixPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsTUFBTSxJQUFJLEdBQUcsQ0FBQyxJQUFJLElBQUksR0FBRyxDQUFDLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztBQUN4RCxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBZ0IsNkNBQTZDLENBQzNELGdCQUFxQixFQUNyQixFQUF3QztJQUV4QyxJQUFJLENBQUMsRUFBRTtRQUFFLE9BQU8sZ0JBQWdCLENBQUM7SUFFakMsTUFBTSxNQUFNLEdBQUcsSUFBSSxHQUFHLEVBQXNDLENBQUM7SUFDN0QsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFDLElBQUksS0FBSyxJQUFJLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxLQUFLLFNBQVMsSUFBSSxDQUFDLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO0lBQ3hGLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsWUFBWSxJQUFJLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7SUFDL0YsTUFBTSxhQUFhLEdBQUcsRUFBRSxDQUFDLGFBQWEsQ0FBQztJQUV2Qyx1SUFBdUk7SUFDdkksTUFBTSxtQkFBbUIsR0FBRyxDQUFDLEdBQVksRUFBRSxRQUFnQixFQUFXLEVB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Q0FBQztRQUM3QixNQUFNLGFBQWEsR0FBRyxHQUFHLENBQUMsTUFBTSxLQUFLLFNBQVMsSUFBSSxHQUFHLENBQUMsU0FBUyxLQUFLLFNBQVMsQ0FBQztRQUM5RSxJQUFJLGFBQWE7WUFBRSxPQUFPLEdBQUcsQ0FBQztRQUM5QixPQUFPLEVBQUUsR0FBRyxHQUFHLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFPLENBQUM7SUFDekQsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBEaXNwbGF5T3ZlcnJpZGVGaWVsZENvbmZpZywgRGlzcGxheU92ZXJyaWRlc1VJQ29uZmlnIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Rpc3BsYXktb3ZlcnJpZGUtdHlwZXMnO1xuXG50eXBlIFVpRmllbGQgPSBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiAmIHtcbiAgaWQ/OiBzdHJpbmc7XG4gIGNvbHVtbj86IHN0cmluZztcbiAgbmFtZT86IHN0cmluZztcbiAgcHJvcGVydGllcz86IFVpRmllbGRbXTtcbiAgaXRlbXM/OiB7IHR5cGU/OiBzdHJpbmc7IHByb3BlcnRpZXM/OiBVaUZpZWxkW10gfTtcbn07XG5cbmZ1bmN0aW9uIHNlZ21lbnRLZXkocm93OiBVaUZpZWxkKTogc3RyaW5nIHtcbiAgcmV0dXJuIFN0cmluZyhyb3cuY29sdW1uID8/IHJvdy5uYW1lID8/IHJvdy5pZCA/PyAnJyk7XG59XG5cbi8qKlxuICogTWVyZ2VzIGBkaXNwbGF5T3ZlcnJpZGVzLmZpZWxkc1tdYCBvbnRvIGZvcm1hdHRlZCBgcHJvcGVydGllc0NvbmZpZ2Agcm93cyBieSBkb3QgcGF0aCxcbiAqIHNvIGNvbnN1bWVycyBnZXQgYGRpc3BsYXlPdmVycmlkZTogeyBwYXRoLCBsYWJlbCwgY2hyb21lLCAuLi4gfWAgcGVyIGZpZWxkIHJvdy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRGlzcGxheU92ZXJyaWRlRmllbGRDb25maWdJbnRvUHJvcGVydGllczxUIGV4dGVuZHMgVWlGaWVsZD4oXG4gIHByb3BlcnRpZXNDb25maWc6IFRbXSxcbiAgdWk6IERpc3BsYXlPdmVycmlkZXNVSUNvbmZpZyB8IHVuZGVmaW5lZFxuKTogVFtdIHtcbiAgaWYgKCF1aSkgcmV0dXJuIHByb3BlcnRpZXNDb25maWc7XG5cbiAgY29uc3QgYnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIERpc3BsYXlPdmVycmlkZUZpZWxkQ29uZmlnPigpO1xuICBjb25zdCBpbmNsdWRlQXV0byA9IHVpLmF1dG8gPT09IHRydWUgfHwgKHVpLmF1dG8gPT09IHVuZGVmaW5lZCAmJiAhKHVpLmZpZWxkcz8ubGVuZ3RoKSk7XG4gIGNvbnN0IGV4Y2x1ZGVBdXRvUGF0aHMgPSBuZXcgU2V0KCh1aS5leGNsdWRlUGF0aHMgPz8gW10pLm1hcCgocCkgPT4gcC50cmltKCkpLmZpbHRlcihCb29sZWFuKSk7XG4gIGNvbnN0IGRlZmF1bHRDaHJvbWUgPSB1aS5kZWZhdWx0Q2hyb21lO1xuXG4gIC8qKiBFdmVyeSBsZWFmIGZpZWxkIGluIHRoaXMgcGFnZSdzIHByb3BlcnRpZXNDb25maWcsIGV4Y2VwdCBzdG9yYWdlIG1hcCwgcmVsYXRpb25zLCBhbmQgaWRlbnRpZmllcnMuIFVzZSBgZXhjbHVkZVBhdGhzYCB0byBvcHQgb3V0LiAqL1xuICBjb25zdCBpc0VsaWdpYmxlQXV0b0ZpZWxkID0gKHJvdzogVWlGaWVsZCwgZnVsbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4gPT4ge1xuICAgIGlmICghZnVsbFBhdGggfHwgZXhjbHVkZUF1dG9QYXRocy5oYXMoZnVsbFBhdGgpKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGZ1bGxQYXRoID09PSB1aS5zdG9yYWdlQXR0cmlidXRlIHx8IGZ1bGxQYXRoLnN0YXJ0c1dpdGgoYCR7dWkuc3RvcmFnZUF0dHJpYnV0ZX0uYCkpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoQm9vbGVhbihyb3cucmVsYXRpb24pKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHJvdy5pc0lkZW50aWZpZXIgPT09IHRydWUpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICBjb25zdCBjb2xsZWN0QXV0b1BhdGhzID0gKHJvd3M6IFRbXSwgcHJlZml4OiBzdHJpbmcpOiB2b2lkID0+IHtcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBjb25zdCBzZWcgPSBzZWdtZW50S2V5KHJvdyk7XG4gICAgICBpZiAoIXNlZykgY29udGludWU7XG4gICAgICBjb25zdCBmdWxsUGF0aCA9IHByZWZpeCA/IGAke3ByZWZpeH0uJHtzZWd9YCA6IHNlZztcbiAgICAgIGNvbnN0IGhhc0NoaWxkUHJvcHMgPSBBcnJheS5pc0FycmF5KHJvdy5wcm9wZXJ0aWVzKSAmJiByb3cucHJvcGVydGllcy5sZW5ndGggPiAwO1xuICAgICAgY29uc3QgaXRlbXNQcm9wcyA9IHJvdy5pdGVtcz8ucHJvcGVydGllcztcbiAgICAgIGNvbnN0IGhhc0l0ZW1Qcm9wcyA9IEFycmF5LmlzQXJyYXkoaXRlbXNQcm9wcykgJiYgaXRlbXNQcm9wcy5sZW5ndGggPiAwO1xuICAgICAgaWYgKGhhc0NoaWxkUHJvcHMpIHtcbiAgICAgICAgY29sbGVjdEF1dG9QYXRocyhyb3cucHJvcGVydGllcyBhcyBUW10sIGZ1bGxQYXRoKTtcbiAgICAgIH1cbiAgICAgIGlmIChoYXNJdGVtUHJvcHMpIHtcbiAgICAgICAgY29sbGVjdEF1dG9QYXRocyhpdGVtc1Byb3BzIGFzIFRbXSwgZnVsbFBhdGgpO1xuICAgICAgfVxuICAgICAgaWYgKGhhc0NoaWxkUHJvcHMgfHwgaGFzSXRlbVByb3BzKSBjb250aW51ZTtcbiAgICAgIGlmICghaXNFbGlnaWJsZUF1dG9GaWVsZChyb3csIGZ1bGxQYXRoKSkgY29udGludWU7XG4gICAgICBpZiAoYnlQYXRoLmhhcyhmdWxsUGF0aCkpIGNvbnRpbnVlO1xuICAgICAgYnlQYXRoLnNldChmdWxsUGF0aCwge1xuICAgICAgICBwYXRoOiBmdWxsUGF0aCxcbiAgICAgICAgbGFiZWw6IHR5cGVvZiByb3cubGFiZWwgPT09ICdzdHJpbmcnID8gcm93LmxhYmVsIDogdW5kZWZpbmVkLFxuICAgICAgICBoZWxwVGV4dDogdHlwZW9mIHJvdy5oZWxwVGV4dCA9PT0gJ3N0cmluZycgPyByb3cuaGVscFRleHQgOiB1bmRlZmluZWQsXG4gICAgICAgIGNocm9tZTogZGVmYXVsdENocm9tZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfTtcblxuICBpZiAoaW5jbHVkZUF1dG8pIHtcbiAgICBjb2xsZWN0QXV0b1BhdGhzKHByb3BlcnRpZXNDb25maWcsICcnKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgZiBvZiB1aS5maWVsZHMgPz8gW10pIHtcbiAgICBpZiAoZj8ucGF0aCAmJiB0eXBlb2YgZi5wYXRoID09PSAnc3RyaW5nJykge1xuICAgICAgY29uc3QgcCA9IGYucGF0aC50cmltKCk7XG4gICAgICBpZiAocCkgYnlQYXRoLnNldChwLCBmKTtcbiAgICB9XG4gIH1cbiAgaWYgKGJ5UGF0aC5zaXplID09PSAwKSByZXR1cm4gcHJvcGVydGllc0NvbmZpZztcblxuICBjb25zdCBtZXJnZVJvdyA9IChyb3dzOiBUW10sIHByZWZpeDogc3RyaW5nKTogVFtdID0+IHtcbiAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4ge1xuICAgICAgY29uc3Qgc2VnID0gc2VnbWVudEtleShyb3cpO1xuICAgICAgY29uc3QgZnVsbFBhdGggPSBwcmVmaXggPyBgJHtwcmVmaXh9LiR7c2VnfWAgOiBzZWc7XG4gICAgICBsZXQgbmV4dDogVCA9IHsgLi4ucm93IH07XG4gICAgICBjb25zdCBlbnRyeSA9IGJ5UGF0aC5nZXQoZnVsbFBhdGgpO1xuICAgICAgaWYgKGVudHJ5KSB7XG4gICAgICAgIGNvbnN0IGRpc3BsYXlPdmVycmlkZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7IHBhdGg6IGVudHJ5LnBhdGggfTtcbiAgICAgICAgaWYgKGVudHJ5LmNoYW5uZWxzPy5sZW5ndGgpIGRpc3BsYXlPdmVycmlkZS5jaGFubmVscyA9IGVudHJ5LmNoYW5uZWxzO1xuICAgICAgICBpZiAoZW50cnkubGFiZWwpIGRpc3BsYXlPdmVycmlkZS5sYWJlbCA9IGVudHJ5LmxhYmVsO1xuICAgICAgICBpZiAoZW50cnkuY2hyb21lKSBkaXNwbGF5T3ZlcnJpZGUuY2hyb21lID0gZW50cnkuY2hyb21lO1xuICAgICAgICBpZiAoZW50cnkuaGVscFRleHQpIGRpc3BsYXlPdmVycmlkZS5oZWxwVGV4dCA9IGVudHJ5LmhlbHBUZXh0O1xuICAgICAgICBuZXh0ID0geyAuLi5uZXh0LCBkaXNwbGF5T3ZlcnJpZGUgfSBhcyBUO1xuICAgICAgfVxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocm93LnByb3BlcnRpZXMpICYmIHJvdy5wcm9wZXJ0aWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbmV4dC5wcm9wZXJ0aWVzID0gbWVyZ2VSb3cocm93LnByb3BlcnRpZXMgYXMgVFtdLCBmdWxsUGF0aCkgYXMgdW5rbm93biBhcyBVaUZpZWxkW107XG4gICAgICB9XG4gICAgICBjb25zdCBpdGVtc1Byb3BzID0gcm93Lml0ZW1zPy5wcm9wZXJ0aWVzO1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoaXRlbXNQcm9wcykgJiYgaXRlbXNQcm9wcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIG5leHQuaXRlbXMgPSB7XG4gICAgICAgICAgLi4ucm93Lml0ZW1zLFxuICAgICAgICAgIHByb3BlcnRpZXM6IG1lcmdlUm93KGl0ZW1zUHJvcHMgYXMgVFtdLCBmdWxsUGF0aCkgYXMgdW5rbm93biBhcyBVaUZpZWxkW10sXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV4dDtcbiAgICB9KTtcbiAgfTtcblxuICByZXR1cm4gbWVyZ2VSb3cocHJvcGVydGllc0NvbmZpZywgJycpO1xufVxuXG4vKipcbiAqIEZvcm0gcGFnZXM6IGlmIHRoZSBvdmVycmlkZSBzdG9yYWdlIGF0dHJpYnV0ZSBpcyBwcmVzZW50IGFuZCB0aGUgZW50aXR5IGRpZCBub3Qgc2V0XG4gKiBgaGlkZGVuYCAvIGBpc1Zpc2libGVgLCBkZWZhdWx0IGl0IGhpZGRlbiBzbyByYXcgSlNPTiBpcyBub3Qgc2hvd24gYXMgYSBub3JtYWwgZmllbGQgdW5sZXNzIG9wdGVkIGluLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlEaXNwbGF5T3ZlcnJpZGVTdG9yYWdlRmllbGRGb3JtRGVmYXVsdHM8VCBleHRlbmRzIFVpRmllbGQ+KFxuICBwcm9wZXJ0aWVzQ29uZmlnOiBUW10sXG4gIHVpOiBEaXNwbGF5T3ZlcnJpZGVzVUlDb25maWcgfCB1bmRlZmluZWRcbik6IFRbXSB7XG4gIGlmICghdWk/LnN0b3JhZ2VBdHRyaWJ1dGUpIHJldHVybiBwcm9wZXJ0aWVzQ29uZmlnO1xuICBjb25zdCBrZXkgPSB1aS5zdG9yYWdlQXR0cmlidXRlO1xuICByZXR1cm4gcHJvcGVydGllc0NvbmZpZy5tYXAoKHJvdykgPT4ge1xuICAgIGNvbnN0IG5hbWUgPSBTdHJpbmcocm93LmNvbHVtbiA/PyByb3cubmFtZSA/PyByb3cuaWQgPz8gJycpO1xuICAgIGlmIChuYW1lICE9PSBrZXkpIHJldHVybiByb3c7XG4gICAgY29uc3QgaGFzVmlzaWJpbGl0eSA9IHJvdy5oaWRkZW4gIT09IHVuZGVmaW5lZCB8fCByb3cuaXNWaXNpYmxlICE9PSB1bmRlZmluZWQ7XG4gICAgaWYgKGhhc1Zpc2liaWxpdHkpIHJldHVybiByb3c7XG4gICAgcmV0dXJuIHsgLi4ucm93LCBoaWRkZW46IHRydWUsIGlzVmlzaWJsZTogZmFsc2UgfSBhcyBUO1xuICB9KTtcbn1cbiJdfQ==