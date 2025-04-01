import { isObject } from './datatypes';

export const getCircularReplacer = () => {
  const seen = new WeakSet();

  return (
    //@ts-ignore
    key,
    value: any,
  ) => {
    if (isObject(value)) {
      if (seen.has(value)) return;
      seen.add(value);
    }
    return value;
  };
};

export function jsonStringifyReplacer(key: string, value: any) {
  const aa = key;
  if (typeof value === 'object' && value !== null) {
    if (value instanceof Map) {
      return Array.from(value.entries());
    } else if (value instanceof Set) {
      return Array.from(value.values());
    } else if (value instanceof RegExp) {
      return value.toString();
    }
  }
  return value;
}

export class JsonSerializer {
  static stringify<T = any>(value: T): string {
    return JSON.stringify(value, (key, value) => jsonStringifyReplacer(key, value));
  }
}

export const deepCopy = (obj: any) => {
  return structuredClone(obj);
};
