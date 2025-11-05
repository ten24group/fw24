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
    // Remove hyphens, underscores, and spaces, then camelCase
    // Handles: 'team-stats' → 'teamStats', 'user_name' → 'userName', 'first name' → 'firstName'
    return input
        .replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '') // Remove separators and uppercase following char
        .replace(/^[A-Z]/, c => c.toLowerCase()); // Ensure first char is lowercase
}

export function pascalCase(input: string) {
    input = camelCase(input);
    return input.charAt(0).toUpperCase() + input.slice(1);
}

export function toSlug(str: string): string {
    if(!str) return '';
    
    return str.toString().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, "") //remove diacritics
            .toLowerCase()
            .replace(/\s+/g, '-') //spaces to dashes
            .replace(/&/g, '-and-') //ampersand to and
            .replace(/[^\w\-]+/g, '') //remove non-words
            .replace(/\-\-+/g, '-') //collapse multiple dashes
            .replace(/^-+/, '') //trim starting dash
            .replace(/-+$/, ''); //trim ending dash
};