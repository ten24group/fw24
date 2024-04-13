export * from './types';


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