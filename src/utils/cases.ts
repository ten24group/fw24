import slugify from "slugify";

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

export const toSlug = (str: string, options?: {
  replacement?: string;
  remove?: RegExp;
  lower?: boolean;
  strict?: boolean;
  locale?: string;
  trim?: boolean;
}) => {

  return slugify(str, { lower: true, trim: true, ...options });
};