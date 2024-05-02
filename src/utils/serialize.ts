import { isObject } from "./datatypes";

export const getCircularReplacer = () => {
  const seen = new WeakSet();
  
  return (
    //@ts-ignore 
    key, 
    value: any
  ) => {
    if (isObject(value)) {
      if (seen.has(value)) return;
      seen.add(value);
    }
    return value;
  };
};


export const deepCopy = (obj: any) => {
  return structuredClone(obj);
}