import { isEmptyArray, isEmptyObject, isPlainObject } from "./datatypes";

/**
 * Recursively remove props from an object, if the prop's value matches `valueToRemove`
 * 
 * example
  ```
    const payload = { a: 1, b: undefined, c: {}, d: [] }
    removeProps(payload, {}, []);
    // returns
    // { a: 1, b: undefined }
  ```
 *
 */
export function exclude(
  payload: Record<string, any>,
  valueToRemove: any,
  ...valuesToRemove: any[]
): Record<string, unknown> {
  
  if (!isPlainObject(payload)) return payload;

  const remove = [valueToRemove, ...valuesToRemove];

  const removeEmptyObjects = !!remove.find((val) => isEmptyObject(val));
  const removeEmptyArrays = !!remove.find((val) => isEmptyArray(val));

  return Object.entries(payload).reduce<Record<string, any>>(
    (carry, [key, value]) => {
      if (removeEmptyObjects && isEmptyObject(value)) return carry;
      if (removeEmptyArrays && isEmptyArray(value)) return carry;
      if (remove.includes(value)) return carry;

      const newVal = exclude(value, remove[0], ...remove.slice(1))
      if (removeEmptyObjects && isEmptyObject(newVal)) return carry;
      if (removeEmptyArrays && isEmptyArray(newVal)) return carry;

      carry[key] = newVal;
      return carry;
    }, 
  {});
}

export const removeEmpty = <T extends {[k:string]: any|undefined|null}>(obj: T) => {
  return exclude( obj, undefined, null, '');
};