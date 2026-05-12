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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlzcGxheS1vdmVycmlkZS1yZXNvbHZlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VudGl0eS9kaXNwbGF5LW92ZXJyaWRlLXJlc29sdmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7OztHQVFHOztBQWlDSCxrRUE0QkM7QUFNRCxzREFlQztBQTlFRCxTQUFTLGNBQWMsQ0FBQyxHQUFZO0lBQ2xDLElBQUksR0FBRyxLQUFLLFNBQVMsSUFBSSxHQUFHLEtBQUssSUFBSTtRQUFFLE9BQU8sSUFBSSxDQUFDO0lBQ25ELElBQUksT0FBTyxHQUFHLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ25ELE1BQU0sQ0FBQyxHQUFHLEdBQThCLENBQUM7UUFDekMsSUFBSSxPQUFPLElBQUksQ0FBQyxJQUFJLE1BQU0sSUFBSSxDQUFDLElBQUksU0FBUyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ2xELE9BQU8sR0FBMkIsQ0FBQztRQUNyQyxDQUFDO0lBQ0gsQ0FBQztJQUNELE9BQU8sRUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsQ0FBQztBQUN2QyxDQUFDO0FBb0JELFNBQWdCLDJCQUEyQixDQUN6QyxNQUF5QztJQUV6QyxNQUFNLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLEdBQUcsTUFBTSxDQUFDO0lBQ2hFLElBQUksQ0FBQyxXQUFXLElBQUksT0FBTyxXQUFXLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDcEQsT0FBTyxFQUFFLGFBQWEsRUFBRSxXQUFXLEVBQUUsaUJBQWlCLEVBQUUsS0FBSyxFQUFFLENBQUM7SUFDbEUsQ0FBQztJQUVELE1BQU0sU0FBUyxHQUFhLEVBQUUsQ0FBQztJQUMvQixJQUFJLE9BQU87UUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLEdBQUcsU0FBUyxJQUFJLE9BQU8sRUFBRSxDQUFDLENBQUM7SUFDdkQsU0FBUyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUUxQixLQUFLLE1BQU0sR0FBRyxJQUFJLFNBQVMsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEdBQUcsQ0FBQztZQUFFLFNBQVM7UUFDdEUsTUFBTSxHQUFHLEdBQUcsV0FBVyxDQUFFLEdBQUcsQ0FBRSxDQUFDO1FBQy9CLE1BQU0sS0FBSyxHQUFHLGNBQWMsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNsQyxJQUFJLENBQUMsS0FBSztZQUFFLFNBQVM7UUFFckIsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksSUFBSSxPQUFPLENBQUM7UUFDbkMsSUFBSSxJQUFJLEtBQUssWUFBWSxJQUFJLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUMvQyxPQUFPLEVBQUUsYUFBYSxFQUFFLFdBQVcsRUFBRSxpQkFBaUIsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLENBQUM7UUFDekUsQ0FBQztRQUNELElBQUksS0FBSyxDQUFDLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUM5QixPQUFPLEVBQUUsYUFBYSxFQUFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsaUJBQWlCLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxDQUFDO1FBQ3hFLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxFQUFFLGFBQWEsRUFBRSxXQUFXLEVBQUUsaUJBQWlCLEVBQUUsS0FBSyxFQUFFLENBQUM7QUFDbEUsQ0FBQztBQUdEOztHQUVHO0FBQ0gsU0FBZ0IscUJBQXFCLENBQUMsTUFBK0IsRUFBRSxTQUFpQjtJQUN0RixJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzdCLE9BQU8sTUFBTSxDQUFFLFNBQVMsQ0FBRSxDQUFDO0lBQzdCLENBQUM7SUFDRCxNQUFNLElBQUksR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ2xDLElBQUksR0FBRyxHQUFZLE1BQU0sQ0FBQztJQUMxQixLQUFLLE1BQU0sQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ3JCLElBQUksQ0FBQyxLQUFLLEVBQUU7WUFBRSxPQUFPLFNBQVMsQ0FBQztRQUMvQixJQUFJLEdBQUcsS0FBSyxJQUFJLElBQUksR0FBRyxLQUFLLFNBQVM7WUFBRSxPQUFPLFNBQVMsQ0FBQztRQUN4RCxJQUFJLE9BQU8sR0FBRyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQztZQUFFLE9BQU8sU0FBUyxDQUFDO1FBQ3BFLE1BQU0sQ0FBQyxHQUFHLEdBQThCLENBQUM7UUFDekMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQUUsT0FBTyxTQUFTLENBQUM7UUFDbEUsR0FBRyxHQUFHLENBQUMsQ0FBRSxDQUFDLENBQUUsQ0FBQztJQUNmLENBQUM7SUFDRCxPQUFPLEdBQUcsQ0FBQztBQUNiLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIERpc3BsYXkgb3ZlcnJpZGVzIG1lcmdlICoqc3RvcmVkIGZpZWxkIHZhbHVlcyoqIHdpdGggYW4gb3B0aW9uYWwgSlNPTiBtYXAgKGBkaXNwbGF5T3ZlcnJpZGVzYCBvclxuICogYG1vZGVsLmRpc3BsYXlPdmVycmlkZXMuc3RvcmFnZUF0dHJpYnV0ZWApLiBTYW1lIGJlaGF2aW9yIGFzIHVpMjQuXG4gKlxuICogLSBObyBtYXAgLyBubyBlbnRyeSDihpIgdXNlIHN0b3JlZCB2YWx1ZS5cbiAqIC0gTWFwIGhhcyBhICoqdmFsdWUqKiBvdmVycmlkZSDihpIgdXNlIHRoYXQuXG4gKiAtIEVudHJ5IGlzIG9ubHkgKip2aXNpYmlsaXR5Kiogb3IgKipmb3JtYXQqKiDihpIga2VlcCBzdG9yZWQgdmFsdWUgKGNhbGxlcnMgY2FuIGluc3BlY3QgYGVudHJ5YCkuXG4gKiAtIENoYW5uZWw6IHRyaWVzIGBmaWVsZFBhdGhAY2hhbm5lbGAgYmVmb3JlIGBmaWVsZFBhdGhgLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRGlzcGxheU92ZXJyaWRlRW50cnksIERpc3BsYXlPdmVycmlkZVN0b3JhZ2UgfSBmcm9tICcuL2Rpc3BsYXktb3ZlcnJpZGUtdHlwZXMnO1xuXG5mdW5jdGlvbiBub3JtYWxpemVFbnRyeShyYXc6IHVua25vd24pOiBEaXNwbGF5T3ZlcnJpZGVFbnRyeSB8IG51bGwge1xuICBpZiAocmF3ID09PSB1bmRlZmluZWQgfHwgcmF3ID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgaWYgKHR5cGVvZiByYXcgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHJhdykpIHtcbiAgICBjb25zdCBvID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICgndmFsdWUnIGluIG8gfHwgJ2tpbmQnIGluIG8gfHwgJ2NoYW5uZWwnIGluIG8pIHtcbiAgICAgIHJldHVybiByYXcgYXMgRGlzcGxheU92ZXJyaWRlRW50cnk7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IHZhbHVlOiByYXcsIGtpbmQ6ICd2YWx1ZScgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlV2l0aERpc3BsYXlPdmVycmlkZXNQYXJhbXMge1xuICAvKiogQ3VycmVudCB2YWx1ZSBvbiB0aGUgcm93IGZvciB0aGlzIGZpZWxkIChiZWZvcmUgb3ZlcnJpZGVzKS4gKi9cbiAgc3RvcmVkVmFsdWU6IHVua25vd247XG4gIG92ZXJyaWRlTWFwOiBEaXNwbGF5T3ZlcnJpZGVTdG9yYWdlIHwgdW5kZWZpbmVkO1xuICAvKiogRG90IHBhdGggdXNlZCBhcyBrZXkgaW4gdGhlIG1hcCAoYW5kIG9wdGlvbmFsIGBwYXRoQGNoYW5uZWxgKS4gKi9cbiAgZmllbGRQYXRoOiBzdHJpbmc7XG4gIGNoYW5uZWw/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb2x2ZVdpdGhEaXNwbGF5T3ZlcnJpZGVzUmVzdWx0IHtcbiAgLyoqIFZhbHVlIHRvIHNob3cgKHN0b3JlZCwgb3Igb3ZlcnJpZGUgd2hlbiBhcHBsaWNhYmxlKS4gKi9cbiAgcmVzb2x2ZWRWYWx1ZTogdW5rbm93bjtcbiAgLyoqIFRydWUgd2hlbiBhIHZhbHVlLXR5cGUgb3ZlcnJpZGUgcmVwbGFjZWQgdGhlIHN0b3JlZCBmaWVsZC4gKi9cbiAgdmFsdWVGcm9tT3ZlcnJpZGU6IGJvb2xlYW47XG4gIGVudHJ5PzogRGlzcGxheU92ZXJyaWRlRW50cnkgfCBudWxsO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlV2l0aERpc3BsYXlPdmVycmlkZXMoXG4gIHBhcmFtczogUmVzb2x2ZVdpdGhEaXNwbGF5T3ZlcnJpZGVzUGFyYW1zXG4pOiBSZXNvbHZlV2l0aERpc3BsYXlPdmVycmlkZXNSZXN1bHQge1xuICBjb25zdCB7IHN0b3JlZFZhbHVlLCBvdmVycmlkZU1hcCwgZmllbGRQYXRoLCBjaGFubmVsIH0gPSBwYXJhbXM7XG4gIGlmICghb3ZlcnJpZGVNYXAgfHwgdHlwZW9mIG92ZXJyaWRlTWFwICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiB7IHJlc29sdmVkVmFsdWU6IHN0b3JlZFZhbHVlLCB2YWx1ZUZyb21PdmVycmlkZTogZmFsc2UgfTtcbiAgfVxuXG4gIGNvbnN0IGtleXNUb1RyeTogc3RyaW5nW10gPSBbXTtcbiAgaWYgKGNoYW5uZWwpIGtleXNUb1RyeS5wdXNoKGAke2ZpZWxkUGF0aH1AJHtjaGFubmVsfWApO1xuICBrZXlzVG9UcnkucHVzaChmaWVsZFBhdGgpO1xuXG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXNUb1RyeSkge1xuICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG92ZXJyaWRlTWFwLCBrZXkpKSBjb250aW51ZTtcbiAgICBjb25zdCByYXcgPSBvdmVycmlkZU1hcFsga2V5IF07XG4gICAgY29uc3QgZW50cnkgPSBub3JtYWxpemVFbnRyeShyYXcpO1xuICAgIGlmICghZW50cnkpIGNvbnRpbnVlO1xuXG4gICAgY29uc3Qga2luZCA9IGVudHJ5LmtpbmQgPz8gJ3ZhbHVlJztcbiAgICBpZiAoa2luZCA9PT0gJ3Zpc2liaWxpdHknIHx8IGtpbmQgPT09ICdmb3JtYXQnKSB7XG4gICAgICByZXR1cm4geyByZXNvbHZlZFZhbHVlOiBzdG9yZWRWYWx1ZSwgdmFsdWVGcm9tT3ZlcnJpZGU6IGZhbHNlLCBlbnRyeSB9O1xuICAgIH1cbiAgICBpZiAoZW50cnkudmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHsgcmVzb2x2ZWRWYWx1ZTogZW50cnkudmFsdWUsIHZhbHVlRnJvbU92ZXJyaWRlOiB0cnVlLCBlbnRyeSB9O1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7IHJlc29sdmVkVmFsdWU6IHN0b3JlZFZhbHVlLCB2YWx1ZUZyb21PdmVycmlkZTogZmFsc2UgfTtcbn1cblxuXG4vKipcbiAqIFJlYWQgYSB2YWx1ZSBmcm9tIGEgcmVjb3JkIGJ5IGRvdC1wYXRoIHdpdGhvdXQgdGhyb3dpbmcgKGBhLmIuY2ApLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVhZFN0b3JlZFZhbHVlQXRQYXRoKHJlY29yZDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGZpZWxkUGF0aDogc3RyaW5nKTogdW5rbm93biB7XG4gIGlmICghZmllbGRQYXRoLmluY2x1ZGVzKCcuJykpIHtcbiAgICByZXR1cm4gcmVjb3JkWyBmaWVsZFBhdGggXTtcbiAgfVxuICBjb25zdCBrZXlzID0gZmllbGRQYXRoLnNwbGl0KCcuJyk7XG4gIGxldCBjdXI6IHVua25vd24gPSByZWNvcmQ7XG4gIGZvciAoY29uc3QgayBvZiBrZXlzKSB7XG4gICAgaWYgKGsgPT09ICcnKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmIChjdXIgPT09IG51bGwgfHwgY3VyID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKHR5cGVvZiBjdXIgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkoY3VyKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjb25zdCBvID0gY3VyIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG8sIGspKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGN1ciA9IG9bIGsgXTtcbiAgfVxuICByZXR1cm4gY3VyO1xufVxuXG4iXX0=