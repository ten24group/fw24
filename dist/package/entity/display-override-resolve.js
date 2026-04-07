"use strict";
/**
 * Display overrides merge **stored field values** with an optional JSON map (`displayOverrides` or
 * `model.displayOverrides.storageAttribute`). Same behavior as ui24.
 *
 * - No map / no entry → use stored value.
 * - Map has a **value** override → use that.
 * - Entry is only **visibility** or **format** → keep stored value (callers can inspect `entry`).
 * - Channel: tries `fieldPath@channel` before `fieldPath`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWithDisplayOverrides = resolveWithDisplayOverrides;
exports.readStoredValueAtPath = readStoredValueAtPath;
function normalizeEntry(raw) {
    if (raw === undefined || raw === null)
        return null;
    if (typeof raw === 'object' && !Array.isArray(raw)) {
        const o = raw;
        if ('value' in o || 'kind' in o || 'channel' in o) {
            return raw;
        }
    }
    return { value: raw, kind: 'value' };
}
function resolveWithDisplayOverrides(params) {
    const { storedValue, overrideMap, fieldPath, channel } = params;
    if (!overrideMap || typeof overrideMap !== 'object') {
        return { resolvedValue: storedValue, valueFromOverride: false };
    }
    const keysToTry = [];
    if (channel)
        keysToTry.push(`${fieldPath}@${channel}`);
    keysToTry.push(fieldPath);
    for (const key of keysToTry) {
        if (!Object.prototype.hasOwnProperty.call(overrideMap, key))
            continue;
        const raw = overrideMap[key];
        const entry = normalizeEntry(raw);
        if (!entry)
            continue;
        const kind = entry.kind ?? 'value';
        if (kind === 'visibility' || kind === 'format') {
            return { resolvedValue: storedValue, valueFromOverride: false, entry };
        }
        if (entry.value !== undefined) {
            return { resolvedValue: entry.value, valueFromOverride: true, entry };
        }
    }
    return { resolvedValue: storedValue, valueFromOverride: false };
}
/**
 * Read a value from a record by dot-path without throwing (`a.b.c`).
 */
function readStoredValueAtPath(record, fieldPath) {
    if (!fieldPath.includes('.')) {
        return record[fieldPath];
    }
    const keys = fieldPath.split('.');
    let cur = record;
    for (const k of keys) {
        if (k === '')
            return undefined;
        if (cur === null || cur === undefined)
            return undefined;
        if (typeof cur !== 'object' || Array.isArray(cur))
            return undefined;
        const o = cur;
        if (!Object.prototype.hasOwnProperty.call(o, k))
            return undefined;
        cur = o[k];
    }
    return cur;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlzcGxheS1vdmVycmlkZS1yZXNvbHZlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9kaXNwbGF5LW92ZXJyaWRlLXJlc29sdmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7OztHQVFHOztBQWdDSCxrRUE0QkM7QUFLRCxzREFlQztBQTVFRCxTQUFTLGNBQWMsQ0FBQyxHQUFZO0lBQ2xDLElBQUksR0FBRyxLQUFLLFNBQVMsSUFBSSxHQUFHLEtBQUssSUFBSTtRQUFFLE9BQU8sSUFBSSxDQUFDO0lBQ25ELElBQUksT0FBTyxHQUFHLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ25ELE1BQU0sQ0FBQyxHQUFHLEdBQThCLENBQUM7UUFDekMsSUFBSSxPQUFPLElBQUksQ0FBQyxJQUFJLE1BQU0sSUFBSSxDQUFDLElBQUksU0FBUyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ2xELE9BQU8sR0FBMkIsQ0FBQztRQUNyQyxDQUFDO0lBQ0gsQ0FBQztJQUNELE9BQU8sRUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsQ0FBQztBQUN2QyxDQUFDO0FBbUJELFNBQWdCLDJCQUEyQixDQUN6QyxNQUF5QztJQUV6QyxNQUFNLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLEdBQUcsTUFBTSxDQUFDO0lBQ2hFLElBQUksQ0FBQyxXQUFXLElBQUksT0FBTyxXQUFXLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDcEQsT0FBTyxFQUFFLGFBQWEsRUFBRSxXQUFXLEVBQUUsaUJBQWlCLEVBQUUsS0FBSyxFQUFFLENBQUM7SUFDbEUsQ0FBQztJQUVELE1BQU0sU0FBUyxHQUFhLEVBQUUsQ0FBQztJQUMvQixJQUFJLE9BQU87UUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLEdBQUcsU0FBUyxJQUFJLE9BQU8sRUFBRSxDQUFDLENBQUM7SUFDdkQsU0FBUyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUUxQixLQUFLLE1BQU0sR0FBRyxJQUFJLFNBQVMsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEdBQUcsQ0FBQztZQUFFLFNBQVM7UUFDdEUsTUFBTSxHQUFHLEdBQUcsV0FBVyxDQUFFLEdBQUcsQ0FBRSxDQUFDO1FBQy9CLE1BQU0sS0FBSyxHQUFHLGNBQWMsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNsQyxJQUFJLENBQUMsS0FBSztZQUFFLFNBQVM7UUFFckIsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksSUFBSSxPQUFPLENBQUM7UUFDbkMsSUFBSSxJQUFJLEtBQUssWUFBWSxJQUFJLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUMvQyxPQUFPLEVBQUUsYUFBYSxFQUFFLFdBQVcsRUFBRSxpQkFBaUIsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLENBQUM7UUFDekUsQ0FBQztRQUNELElBQUksS0FBSyxDQUFDLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUM5QixPQUFPLEVBQUUsYUFBYSxFQUFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsaUJBQWlCLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxDQUFDO1FBQ3hFLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxFQUFFLGFBQWEsRUFBRSxXQUFXLEVBQUUsaUJBQWlCLEVBQUUsS0FBSyxFQUFFLENBQUM7QUFDbEUsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IscUJBQXFCLENBQUMsTUFBK0IsRUFBRSxTQUFpQjtJQUN0RixJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzdCLE9BQU8sTUFBTSxDQUFFLFNBQVMsQ0FBRSxDQUFDO0lBQzdCLENBQUM7SUFDRCxNQUFNLElBQUksR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ2xDLElBQUksR0FBRyxHQUFZLE1BQU0sQ0FBQztJQUMxQixLQUFLLE1BQU0sQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ3JCLElBQUksQ0FBQyxLQUFLLEVBQUU7WUFBRSxPQUFPLFNBQVMsQ0FBQztRQUMvQixJQUFJLEdBQUcsS0FBSyxJQUFJLElBQUksR0FBRyxLQUFLLFNBQVM7WUFBRSxPQUFPLFNBQVMsQ0FBQztRQUN4RCxJQUFJLE9BQU8sR0FBRyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQztZQUFFLE9BQU8sU0FBUyxDQUFDO1FBQ3BFLE1BQU0sQ0FBQyxHQUFHLEdBQThCLENBQUM7UUFDekMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQUUsT0FBTyxTQUFTLENBQUM7UUFDbEUsR0FBRyxHQUFHLENBQUMsQ0FBRSxDQUFDLENBQUUsQ0FBQztJQUNmLENBQUM7SUFDRCxPQUFPLEdBQUcsQ0FBQztBQUNiLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIERpc3BsYXkgb3ZlcnJpZGVzIG1lcmdlICoqc3RvcmVkIGZpZWxkIHZhbHVlcyoqIHdpdGggYW4gb3B0aW9uYWwgSlNPTiBtYXAgKGBkaXNwbGF5T3ZlcnJpZGVzYCBvclxuICogYG1vZGVsLmRpc3BsYXlPdmVycmlkZXMuc3RvcmFnZUF0dHJpYnV0ZWApLiBTYW1lIGJlaGF2aW9yIGFzIHVpMjQuXG4gKlxuICogLSBObyBtYXAgLyBubyBlbnRyeSDihpIgdXNlIHN0b3JlZCB2YWx1ZS5cbiAqIC0gTWFwIGhhcyBhICoqdmFsdWUqKiBvdmVycmlkZSDihpIgdXNlIHRoYXQuXG4gKiAtIEVudHJ5IGlzIG9ubHkgKip2aXNpYmlsaXR5Kiogb3IgKipmb3JtYXQqKiDihpIga2VlcCBzdG9yZWQgdmFsdWUgKGNhbGxlcnMgY2FuIGluc3BlY3QgYGVudHJ5YCkuXG4gKiAtIENoYW5uZWw6IHRyaWVzIGBmaWVsZFBhdGhAY2hhbm5lbGAgYmVmb3JlIGBmaWVsZFBhdGhgLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRGlzcGxheU92ZXJyaWRlRW50cnksIERpc3BsYXlPdmVycmlkZVN0b3JhZ2UgfSBmcm9tICcuL2Rpc3BsYXktb3ZlcnJpZGUtdHlwZXMnO1xuXG5mdW5jdGlvbiBub3JtYWxpemVFbnRyeShyYXc6IHVua25vd24pOiBEaXNwbGF5T3ZlcnJpZGVFbnRyeSB8IG51bGwge1xuICBpZiAocmF3ID09PSB1bmRlZmluZWQgfHwgcmF3ID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgaWYgKHR5cGVvZiByYXcgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHJhdykpIHtcbiAgICBjb25zdCBvID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICgndmFsdWUnIGluIG8gfHwgJ2tpbmQnIGluIG8gfHwgJ2NoYW5uZWwnIGluIG8pIHtcbiAgICAgIHJldHVybiByYXcgYXMgRGlzcGxheU92ZXJyaWRlRW50cnk7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IHZhbHVlOiByYXcsIGtpbmQ6ICd2YWx1ZScgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlV2l0aERpc3BsYXlPdmVycmlkZXNQYXJhbXMge1xuICAvKiogQ3VycmVudCB2YWx1ZSBvbiB0aGUgcm93IGZvciB0aGlzIGZpZWxkIChiZWZvcmUgb3ZlcnJpZGVzKS4gKi9cbiAgc3RvcmVkVmFsdWU6IHVua25vd247XG4gIG92ZXJyaWRlTWFwOiBEaXNwbGF5T3ZlcnJpZGVTdG9yYWdlIHwgdW5kZWZpbmVkO1xuICAvKiogRG90IHBhdGggdXNlZCBhcyBrZXkgaW4gdGhlIG1hcCAoYW5kIG9wdGlvbmFsIGBwYXRoQGNoYW5uZWxgKS4gKi9cbiAgZmllbGRQYXRoOiBzdHJpbmc7XG4gIGNoYW5uZWw/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb2x2ZVdpdGhEaXNwbGF5T3ZlcnJpZGVzUmVzdWx0IHtcbiAgLyoqIFZhbHVlIHRvIHNob3cgKHN0b3JlZCwgb3Igb3ZlcnJpZGUgd2hlbiBhcHBsaWNhYmxlKS4gKi9cbiAgcmVzb2x2ZWRWYWx1ZTogdW5rbm93bjtcbiAgLyoqIFRydWUgd2hlbiBhIHZhbHVlLXR5cGUgb3ZlcnJpZGUgcmVwbGFjZWQgdGhlIHN0b3JlZCBmaWVsZC4gKi9cbiAgdmFsdWVGcm9tT3ZlcnJpZGU6IGJvb2xlYW47XG4gIGVudHJ5PzogRGlzcGxheU92ZXJyaWRlRW50cnkgfCBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVdpdGhEaXNwbGF5T3ZlcnJpZGVzKFxuICBwYXJhbXM6IFJlc29sdmVXaXRoRGlzcGxheU92ZXJyaWRlc1BhcmFtc1xuKTogUmVzb2x2ZVdpdGhEaXNwbGF5T3ZlcnJpZGVzUmVzdWx0IHtcbiAgY29uc3QgeyBzdG9yZWRWYWx1ZSwgb3ZlcnJpZGVNYXAsIGZpZWxkUGF0aCwgY2hhbm5lbCB9ID0gcGFyYW1zO1xuICBpZiAoIW92ZXJyaWRlTWFwIHx8IHR5cGVvZiBvdmVycmlkZU1hcCAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4geyByZXNvbHZlZFZhbHVlOiBzdG9yZWRWYWx1ZSwgdmFsdWVGcm9tT3ZlcnJpZGU6IGZhbHNlIH07XG4gIH1cblxuICBjb25zdCBrZXlzVG9Ucnk6IHN0cmluZ1tdID0gW107XG4gIGlmIChjaGFubmVsKSBrZXlzVG9UcnkucHVzaChgJHtmaWVsZFBhdGh9QCR7Y2hhbm5lbH1gKTtcbiAga2V5c1RvVHJ5LnB1c2goZmllbGRQYXRoKTtcblxuICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzVG9UcnkpIHtcbiAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvdmVycmlkZU1hcCwga2V5KSkgY29udGludWU7XG4gICAgY29uc3QgcmF3ID0gb3ZlcnJpZGVNYXBbIGtleSBdO1xuICAgIGNvbnN0IGVudHJ5ID0gbm9ybWFsaXplRW50cnkocmF3KTtcbiAgICBpZiAoIWVudHJ5KSBjb250aW51ZTtcblxuICAgIGNvbnN0IGtpbmQgPSBlbnRyeS5raW5kID8/ICd2YWx1ZSc7XG4gICAgaWYgKGtpbmQgPT09ICd2aXNpYmlsaXR5JyB8fCBraW5kID09PSAnZm9ybWF0Jykge1xuICAgICAgcmV0dXJuIHsgcmVzb2x2ZWRWYWx1ZTogc3RvcmVkVmFsdWUsIHZhbHVlRnJvbU92ZXJyaWRlOiBmYWxzZSwgZW50cnkgfTtcbiAgICB9XG4gICAgaWYgKGVudHJ5LnZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiB7IHJlc29sdmVkVmFsdWU6IGVudHJ5LnZhbHVlLCB2YWx1ZUZyb21PdmVycmlkZTogdHJ1ZSwgZW50cnkgfTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4geyByZXNvbHZlZFZhbHVlOiBzdG9yZWRWYWx1ZSwgdmFsdWVGcm9tT3ZlcnJpZGU6IGZhbHNlIH07XG59XG5cbi8qKlxuICogUmVhZCBhIHZhbHVlIGZyb20gYSByZWNvcmQgYnkgZG90LXBhdGggd2l0aG91dCB0aHJvd2luZyAoYGEuYi5jYCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWFkU3RvcmVkVmFsdWVBdFBhdGgocmVjb3JkOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgZmllbGRQYXRoOiBzdHJpbmcpOiB1bmtub3duIHtcbiAgaWYgKCFmaWVsZFBhdGguaW5jbHVkZXMoJy4nKSkge1xuICAgIHJldHVybiByZWNvcmRbIGZpZWxkUGF0aCBdO1xuICB9XG4gIGNvbnN0IGtleXMgPSBmaWVsZFBhdGguc3BsaXQoJy4nKTtcbiAgbGV0IGN1cjogdW5rbm93biA9IHJlY29yZDtcbiAgZm9yIChjb25zdCBrIG9mIGtleXMpIHtcbiAgICBpZiAoayA9PT0gJycpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKGN1ciA9PT0gbnVsbCB8fCBjdXIgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAodHlwZW9mIGN1ciAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShjdXIpKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IG8gPSBjdXIgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobywgaykpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY3VyID0gb1sgayBdO1xuICB9XG4gIHJldHVybiBjdXI7XG59XG5cbiJdfQ==