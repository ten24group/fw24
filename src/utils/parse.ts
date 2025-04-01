import { isDateString, isJsonString, isNumericString } from './datatypes';

export type SafeParseSuccess = { success: true; value: number };
export type SafeParseError<ValType> = { success: false; value: ValType };

export type SafeParseReturnType<ValType> = SafeParseSuccess | SafeParseError<ValType>;

export function safeParseInt<ValType extends number>(
  value: any | null,
  defaultValue: ValType,
  radix: number | undefined = 10,
): SafeParseReturnType<ValType> {
  if (value == null) {
    return { success: false, value: defaultValue };
  }

  if (typeof value === 'number') {
    return { success: true, value: value };
  }

  const parsedValue = parseInt(value, radix);

  if (isNaN(parsedValue)) {
    return { success: false, value: defaultValue };
  }

  return { success: true, value: parsedValue };
}

export function safeParseFloat<ValType extends number>(
  value: any | null,
  defaultValue: ValType,
): SafeParseReturnType<ValType> {
  if (value == null) {
    return { success: false, value: defaultValue };
  }

  if (typeof value === 'number') {
    return { success: true, value: value };
  }

  const parsedValue = parseFloat(value);

  if (isNaN(parsedValue)) {
    return { success: false, value: defaultValue };
  }

  return { success: true, value: parsedValue };
}

interface ParseValueToCorrectTypesOptions {
  parseNull?: boolean;
  parseUndefined?: boolean;
  parseBoolean?: boolean;
  parseNumber?: boolean;
  parseJson?: boolean;
  // parseDate ?: boolean
}

const defaultParseValueToCorrectTypesOptions: ParseValueToCorrectTypesOptions = {
  parseNull: true,
  parseUndefined: true,
  parseBoolean: true,
  parseNumber: true,
  parseJson: true,
  // parseDate: true,
};

type ParsedValueType = any;
export const parseValueToCorrectTypes = (
  target: ParsedValueType,
  options?: ParseValueToCorrectTypesOptions,
): ParsedValueType => {
  options = { ...defaultParseValueToCorrectTypesOptions, ...options };

  if (!target) {
    return target;
  }

  switch (typeof target) {
    case 'string':
      if (target === '') {
        return '';
      } else if (options.parseNull && target === 'null') {
        return null;
      } else if (options.parseUndefined && target === 'undefined') {
        return undefined;
      } else if (options.parseBoolean && (target === 'true' || target === 'false')) {
        return target === 'true';
      } else if (options.parseNumber && isNumericString(target)) {
        return Number(target);
      } else if (options.parseJson && isJsonString(target)) {
        return JSON.parse(target);
      }
      //  else if (options.parseDate && isDateString(target) ) {
      //   return new Date(target)
      // }
      else {
        return target;
      }
    case 'object':
      if (Array.isArray(target)) {
        return target.map(x => parseValueToCorrectTypes(x, options));
      } else {
        const obj = target;
        Object.keys(obj).map(key => (obj[key] = parseValueToCorrectTypes(target[key], options)));
        return obj;
      }
    default:
      return target;
  }
};
