
export type SafeParseSuccess = { success: true; value: number };
export type SafeParseError<ValType> = { success: false; value: ValType };

export type SafeParseReturnType<ValType> = SafeParseSuccess | SafeParseError<ValType>;

export function safeParseInt<ValType extends number>(value: any | null, defaultValue: ValType, radix : number | undefined = 10)
  : SafeParseReturnType<ValType> {

  if (value == null) {
    return {success: false, value: defaultValue};
  }

  if (typeof value === 'number') {
    return {success: true, value: value};
  }

  const parsedValue = parseInt(value, radix);

  if (isNaN(parsedValue)) {
    return {success: false, value: defaultValue};
  }

  return {success: true, value: parsedValue};
}

export function safeParseFloat<ValType extends number>(value: any | null, defaultValue: ValType)
  : SafeParseReturnType<ValType> {

  if (value == null) {
    return {success: false, value: defaultValue};
  }

  if (typeof value === 'number') {
    return {success: true, value: value};
  }

  const parsedValue = parseFloat(value);

  if (isNaN(parsedValue)) {
    return {success: false, value: defaultValue};
  }

  return {success: true, value: parsedValue};
}