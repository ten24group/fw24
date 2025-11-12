"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toHumanReadableName = toHumanReadableName;
exports.camelCase = camelCase;
exports.pascalCase = pascalCase;
exports.toSlug = toSlug;
function toHumanReadableName(input) {
    // Replace special characters with space, add space before uppercase, collapse spaces, trim
    let result = input
        .replace(/[^a-zA-Z0-9]+/g, ' ') // replace special chars with space
        .replace(/([A-Z])/g, ' $1') // add space before capital letters
        .replace(/\s+/g, ' ') // collapse multiple spaces
        .trim();
    // Capitalize the first character and any character after a space
    return result.replace(/(^|\s)([a-zA-Z])/g, (_, p1, p2) => p1 + p2.toUpperCase());
}
function camelCase(input) {
    // Remove hyphens, underscores, and spaces, then camelCase
    // Handles: 'team-stats' → 'teamStats', 'user_name' → 'userName', 'first name' → 'firstName'
    return input
        .replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '') // Remove separators and uppercase following char
        .replace(/^[A-Z]/, c => c.toLowerCase()); // Ensure first char is lowercase
}
function pascalCase(input) {
    input = camelCase(input);
    return input.charAt(0).toUpperCase() + input.slice(1);
}
function toSlug(str) {
    if (!str)
        return '';
    return str.toString().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, "") //remove diacritics
        .toLowerCase()
        .replace(/\s+/g, '-') //spaces to dashes
        .replace(/&/g, '-and-') //ampersand to and
        .replace(/[^\w\-]+/g, '') //remove non-words
        .replace(/\-\-+/g, '-') //collapse multiple dashes
        .replace(/^-+/, '') //trim starting dash
        .replace(/-+$/, ''); //trim ending dash
}
;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FzZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvY2FzZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxrREFVQztBQUVELDhCQU1DO0FBRUQsZ0NBR0M7QUFFRCx3QkFZQztBQXJDRCxTQUFnQixtQkFBbUIsQ0FBQyxLQUFhO0lBQzdDLDJGQUEyRjtJQUMzRixJQUFJLE1BQU0sR0FBRyxLQUFLO1NBQ2IsT0FBTyxDQUFDLGdCQUFnQixFQUFFLEdBQUcsQ0FBQyxDQUFNLG1DQUFtQztTQUN2RSxPQUFPLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxDQUFVLG1DQUFtQztTQUN2RSxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFnQiwyQkFBMkI7U0FDL0QsSUFBSSxFQUFFLENBQUM7SUFFWixpRUFBaUU7SUFDakUsT0FBTyxNQUFNLENBQUMsT0FBTyxDQUFDLG1CQUFtQixFQUFFLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztBQUNyRixDQUFDO0FBRUQsU0FBZ0IsU0FBUyxDQUFDLEtBQWE7SUFDbkMsMERBQTBEO0lBQzFELDRGQUE0RjtJQUM1RixPQUFPLEtBQUs7U0FDUCxPQUFPLENBQUMsY0FBYyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLGlEQUFpRDtTQUM3RyxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQyxpQ0FBaUM7QUFDbkYsQ0FBQztBQUVELFNBQWdCLFVBQVUsQ0FBQyxLQUFhO0lBQ3BDLEtBQUssR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDekIsT0FBTyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDMUQsQ0FBQztBQUVELFNBQWdCLE1BQU0sQ0FBQyxHQUFXO0lBQzlCLElBQUcsQ0FBQyxHQUFHO1FBQUUsT0FBTyxFQUFFLENBQUM7SUFFbkIsT0FBTyxHQUFHLENBQUMsUUFBUSxFQUFFLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQztTQUM3QixPQUFPLENBQUMsa0JBQWtCLEVBQUUsRUFBRSxDQUFDLENBQUMsbUJBQW1CO1NBQ25ELFdBQVcsRUFBRTtTQUNiLE9BQU8sQ0FBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUMsa0JBQWtCO1NBQ3ZDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUMsa0JBQWtCO1NBQ3pDLE9BQU8sQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDLENBQUMsa0JBQWtCO1NBQzNDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUMsMEJBQTBCO1NBQ2pELE9BQU8sQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUMsb0JBQW9CO1NBQ3ZDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxrQkFBa0I7QUFDbkQsQ0FBQztBQUFBLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZnVuY3Rpb24gdG9IdW1hblJlYWRhYmxlTmFtZShpbnB1dDogc3RyaW5nKSB7XG4gICAgLy8gUmVwbGFjZSBzcGVjaWFsIGNoYXJhY3RlcnMgd2l0aCBzcGFjZSwgYWRkIHNwYWNlIGJlZm9yZSB1cHBlcmNhc2UsIGNvbGxhcHNlIHNwYWNlcywgdHJpbVxuICAgIGxldCByZXN1bHQgPSBpbnB1dFxuICAgICAgICAucmVwbGFjZSgvW15hLXpBLVowLTldKy9nLCAnICcpICAgICAgLy8gcmVwbGFjZSBzcGVjaWFsIGNoYXJzIHdpdGggc3BhY2VcbiAgICAgICAgLnJlcGxhY2UoLyhbQS1aXSkvZywgJyAkMScpICAgICAgICAgIC8vIGFkZCBzcGFjZSBiZWZvcmUgY2FwaXRhbCBsZXR0ZXJzXG4gICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICcgJykgICAgICAgICAgICAgICAgLy8gY29sbGFwc2UgbXVsdGlwbGUgc3BhY2VzXG4gICAgICAgIC50cmltKCk7XG5cbiAgICAvLyBDYXBpdGFsaXplIHRoZSBmaXJzdCBjaGFyYWN0ZXIgYW5kIGFueSBjaGFyYWN0ZXIgYWZ0ZXIgYSBzcGFjZVxuICAgIHJldHVybiByZXN1bHQucmVwbGFjZSgvKF58XFxzKShbYS16QS1aXSkvZywgKF8sIHAxLCBwMikgPT4gcDEgKyBwMi50b1VwcGVyQ2FzZSgpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbWVsQ2FzZShpbnB1dDogc3RyaW5nKSB7XG4gICAgLy8gUmVtb3ZlIGh5cGhlbnMsIHVuZGVyc2NvcmVzLCBhbmQgc3BhY2VzLCB0aGVuIGNhbWVsQ2FzZVxuICAgIC8vIEhhbmRsZXM6ICd0ZWFtLXN0YXRzJyDihpIgJ3RlYW1TdGF0cycsICd1c2VyX25hbWUnIOKGkiAndXNlck5hbWUnLCAnZmlyc3QgbmFtZScg4oaSICdmaXJzdE5hbWUnXG4gICAgcmV0dXJuIGlucHV0XG4gICAgICAgIC5yZXBsYWNlKC9bLV9cXHNdKyguKT8vZywgKF8sIGMpID0+IGMgPyBjLnRvVXBwZXJDYXNlKCkgOiAnJykgLy8gUmVtb3ZlIHNlcGFyYXRvcnMgYW5kIHVwcGVyY2FzZSBmb2xsb3dpbmcgY2hhclxuICAgICAgICAucmVwbGFjZSgvXltBLVpdLywgYyA9PiBjLnRvTG93ZXJDYXNlKCkpOyAvLyBFbnN1cmUgZmlyc3QgY2hhciBpcyBsb3dlcmNhc2Vcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhc2NhbENhc2UoaW5wdXQ6IHN0cmluZykge1xuICAgIGlucHV0ID0gY2FtZWxDYXNlKGlucHV0KTtcbiAgICByZXR1cm4gaW5wdXQuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBpbnB1dC5zbGljZSgxKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvU2x1ZyhzdHI6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgaWYoIXN0cikgcmV0dXJuICcnO1xuICAgIFxuICAgIHJldHVybiBzdHIudG9TdHJpbmcoKS5ub3JtYWxpemUoJ05GRCcpXG4gICAgICAgICAgICAucmVwbGFjZSgvW1xcdTAzMDAtXFx1MDM2Zl0vZywgXCJcIikgLy9yZW1vdmUgZGlhY3JpdGljc1xuICAgICAgICAgICAgLnRvTG93ZXJDYXNlKClcbiAgICAgICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICctJykgLy9zcGFjZXMgdG8gZGFzaGVzXG4gICAgICAgICAgICAucmVwbGFjZSgvJi9nLCAnLWFuZC0nKSAvL2FtcGVyc2FuZCB0byBhbmRcbiAgICAgICAgICAgIC5yZXBsYWNlKC9bXlxcd1xcLV0rL2csICcnKSAvL3JlbW92ZSBub24td29yZHNcbiAgICAgICAgICAgIC5yZXBsYWNlKC9cXC1cXC0rL2csICctJykgLy9jb2xsYXBzZSBtdWx0aXBsZSBkYXNoZXNcbiAgICAgICAgICAgIC5yZXBsYWNlKC9eLSsvLCAnJykgLy90cmltIHN0YXJ0aW5nIGRhc2hcbiAgICAgICAgICAgIC5yZXBsYWNlKC8tKyQvLCAnJyk7IC8vdHJpbSBlbmRpbmcgZGFzaFxufTsiXX0=