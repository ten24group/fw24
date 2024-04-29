import { DeepPartial } from './types';

export * from './types';
export * from './datatypes';

export const getCircularReplacer = () => {
  const seen = new WeakSet();
  //@ts-ignore
  return (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  };
};

export function toHumanReadableName(input: string) {
    // capitalize the first char and split on the uppercase chars
    return input.charAt(0).toUpperCase() + input.slice(1).replace(/([A-Z])/g, " $1");
}

export function camelCase(input: string) {
    // https://stackoverflow.com/a/2970667
    return input.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function(match, index) {
      if (+match === 0) return ""; // or if (/\s+/.test(match)) for white spaces
      return index === 0 ? match.toLowerCase() : match.toUpperCase();
    });
}

export function pascalCase(input: string) {
    input = camelCase(input);
    return input.charAt(0).toUpperCase() + input.slice(1);
}

export const removeEmpty = <T extends {[k:string]: any|undefined|null}>(obj: T) => {
  let newObj: DeepPartial<T> = {};
  if(!obj){
    return newObj;
  }

  Object.keys(obj).forEach((key) => {
    if (obj[key] === Object(obj[key])) {
      newObj[key as keyof typeof newObj] = removeEmpty(obj[key]);
    } else if (obj[key] !== undefined){ 
      newObj[key as keyof typeof newObj] = obj[key];
    }
  });
  return newObj;
};