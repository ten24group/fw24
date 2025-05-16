export function toHumanReadableName(input: string) {
    // Replace special characters with space, add space before uppercase, collapse spaces, trim
    let result = input
        .replace(/[^a-zA-Z0-9]+/g, ' ')      // replace special chars with space
        .replace(/([A-Z])/g, ' $1')          // add space before capital letters
        .replace(/\s+/g, ' ')                // collapse multiple spaces
        .trim();

    // Capitalize the first character and any character after a space
    return result.replace(/(^|\s)([a-zA-Z])/g, (_, p1, p2) => p1 + p2.toUpperCase());
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

export function toSlug(str: string): string {
    if(!str) return '';
    
    return str.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, "") //remove diacritics
            .toLowerCase()
            .replace(/\s+/g, '-') //spaces to dashes
            .replace(/&/g, '-and-') //ampersand to and
            .replace(/[^\w\-]+/g, '') //remove non-words
            .replace(/\-\-+/g, '-') //collapse multiple dashes
            .replace(/^-+/, '') //trim starting dash
            .replace(/-+$/, ''); //trim ending dash
};