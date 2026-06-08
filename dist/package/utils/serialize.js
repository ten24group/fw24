"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deepCopy = exports.JsonSerializer = exports.getCircularReplacer = void 0;
exports.jsonStringifyReplacer = jsonStringifyReplacer;
const datatypes_1 = require("./datatypes");
const getCircularReplacer = () => {
    const seen = new WeakSet();
    return (
    //@ts-ignore 
    key, value) => {
        if ((0, datatypes_1.isObject)(value)) {
            if (seen.has(value))
                return;
            seen.add(value);
        }
        return value;
    };
};
exports.getCircularReplacer = getCircularReplacer;
function jsonStringifyReplacer(key, value) {
    const aa = key;
    if (typeof value === "object" && value !== null) {
        if (value instanceof Map) {
            return Array.from(value.entries());
        }
        else if (value instanceof Set) {
            return Array.from(value.values());
        }
        else if (value instanceof RegExp) {
            return value.toString();
        }
    }
    return value;
}
class JsonSerializer {
    static stringify(value) {
        return JSON.stringify(value, (key, value) => jsonStringifyReplacer(key, value));
    }
}
exports.JsonSerializer = JsonSerializer;
const deepCopy = (obj) => {
    return structuredClone(obj);
};
exports.deepCopy = deepCopy;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VyaWFsaXplLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3V0aWxzL3NlcmlhbGl6ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFrQkEsc0RBWUM7QUE5QkQsMkNBQXVDO0FBRWhDLE1BQU0sbUJBQW1CLEdBQUcsR0FBRyxFQUFFO0lBQ3RDLE1BQU0sSUFBSSxHQUFHLElBQUksT0FBTyxFQUFFLENBQUM7SUFFM0IsT0FBTztJQUNMLGFBQWE7SUFDYixHQUFHLEVBQ0gsS0FBVSxFQUNWLEVBQUU7UUFDRixJQUFJLElBQUEsb0JBQVEsRUFBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3BCLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUM7Z0JBQUUsT0FBTztZQUM1QixJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ2xCLENBQUM7UUFDRCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQztBQWRXLFFBQUEsbUJBQW1CLHVCQWM5QjtBQUVGLFNBQWdCLHFCQUFxQixDQUFDLEdBQVcsRUFBRSxLQUFVO0lBQzNELE1BQU0sRUFBRSxHQUFHLEdBQUcsQ0FBQztJQUNmLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsQ0FBQztRQUNoRCxJQUFJLEtBQUssWUFBWSxHQUFHLEVBQUUsQ0FBQztZQUN6QixPQUFRLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUM7UUFDdEMsQ0FBQzthQUFNLElBQUksS0FBSyxZQUFZLEdBQUcsRUFBRSxDQUFDO1lBQ2hDLE9BQVEsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUNyQyxDQUFDO2FBQU0sSUFBSSxLQUFLLFlBQVksTUFBTSxFQUFFLENBQUM7WUFDbkMsT0FBTyxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDMUIsQ0FBQztJQUNILENBQUM7SUFDRCxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUM7QUFHRCxNQUFhLGNBQWM7SUFDekIsTUFBTSxDQUFDLFNBQVMsQ0FBVSxLQUFRO1FBQ2hDLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUUsQ0FBQztJQUNuRixDQUFDO0NBQ0Y7QUFKRCx3Q0FJQztBQUdNLE1BQU0sUUFBUSxHQUFHLENBQVUsR0FBTSxFQUFLLEVBQUU7SUFDN0MsT0FBTyxlQUFlLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDOUIsQ0FBQyxDQUFBO0FBRlksUUFBQSxRQUFRLFlBRXBCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgaXNPYmplY3QgfSBmcm9tIFwiLi9kYXRhdHlwZXNcIjtcblxuZXhwb3J0IGNvbnN0IGdldENpcmN1bGFyUmVwbGFjZXIgPSAoKSA9PiB7XG4gIGNvbnN0IHNlZW4gPSBuZXcgV2Vha1NldCgpO1xuICBcbiAgcmV0dXJuIChcbiAgICAvL0B0cy1pZ25vcmUgXG4gICAga2V5LCBcbiAgICB2YWx1ZTogYW55XG4gICkgPT4ge1xuICAgIGlmIChpc09iamVjdCh2YWx1ZSkpIHtcbiAgICAgIGlmIChzZWVuLmhhcyh2YWx1ZSkpIHJldHVybjtcbiAgICAgIHNlZW4uYWRkKHZhbHVlKTtcbiAgICB9XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGpzb25TdHJpbmdpZnlSZXBsYWNlcihrZXk6IHN0cmluZywgdmFsdWU6IGFueSkge1xuICBjb25zdCBhYSA9IGtleTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiB2YWx1ZSAhPT0gbnVsbCkge1xuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIE1hcCkge1xuICAgICAgcmV0dXJuICBBcnJheS5mcm9tKHZhbHVlLmVudHJpZXMoKSk7XG4gICAgfSBlbHNlIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFNldCkge1xuICAgICAgcmV0dXJuICBBcnJheS5mcm9tKHZhbHVlLnZhbHVlcygpKTtcbiAgICB9IGVsc2UgaWYgKHZhbHVlIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgICByZXR1cm4gdmFsdWUudG9TdHJpbmcoKTtcbiAgICB9IFxuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuXG5leHBvcnQgY2xhc3MgSnNvblNlcmlhbGl6ZXIge1xuICBzdGF0aWMgc3RyaW5naWZ5PFQgPSBhbnk+KHZhbHVlOiBUKTogc3RyaW5nIHtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUsIChrZXksIHZhbHVlKSA9PiBqc29uU3RyaW5naWZ5UmVwbGFjZXIoa2V5LCB2YWx1ZSkgKTtcbiAgfVxufVxuXG5cbmV4cG9ydCBjb25zdCBkZWVwQ29weSA9IDxUID0gYW55PihvYmo6IFQpOiBUID0+IHtcbiAgcmV0dXJuIHN0cnVjdHVyZWRDbG9uZShvYmopO1xufSJdfQ==