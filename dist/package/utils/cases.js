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
    // https://stackoverflow.com/a/2970667
    return input.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function (match, index) {
        if (+match === 0)
            return ""; // or if (/\s+/.test(match)) for white spaces
        return index === 0 ? match.toLowerCase() : match.toUpperCase();
    });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FzZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvY2FzZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxrREFVQztBQUVELDhCQU1DO0FBRUQsZ0NBR0M7QUFFRCx3QkFZQztBQXJDRCxTQUFnQixtQkFBbUIsQ0FBQyxLQUFhO0lBQzdDLDJGQUEyRjtJQUMzRixJQUFJLE1BQU0sR0FBRyxLQUFLO1NBQ2IsT0FBTyxDQUFDLGdCQUFnQixFQUFFLEdBQUcsQ0FBQyxDQUFNLG1DQUFtQztTQUN2RSxPQUFPLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxDQUFVLG1DQUFtQztTQUN2RSxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFnQiwyQkFBMkI7U0FDL0QsSUFBSSxFQUFFLENBQUM7SUFFWixpRUFBaUU7SUFDakUsT0FBTyxNQUFNLENBQUMsT0FBTyxDQUFDLG1CQUFtQixFQUFFLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztBQUNyRixDQUFDO0FBRUQsU0FBZ0IsU0FBUyxDQUFDLEtBQWE7SUFDbkMsc0NBQXNDO0lBQ3RDLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyx5QkFBeUIsRUFBRSxVQUFTLEtBQUssRUFBRSxLQUFLO1FBQ25FLElBQUksQ0FBQyxLQUFLLEtBQUssQ0FBQztZQUFFLE9BQU8sRUFBRSxDQUFDLENBQUMsNkNBQTZDO1FBQzFFLE9BQU8sS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDakUsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQsU0FBZ0IsVUFBVSxDQUFDLEtBQWE7SUFDcEMsS0FBSyxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUN6QixPQUFPLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMxRCxDQUFDO0FBRUQsU0FBZ0IsTUFBTSxDQUFDLEdBQVc7SUFDOUIsSUFBRyxDQUFDLEdBQUc7UUFBRSxPQUFPLEVBQUUsQ0FBQztJQUVuQixPQUFPLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDO1NBQzdCLE9BQU8sQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUMsQ0FBQyxtQkFBbUI7U0FDbkQsV0FBVyxFQUFFO1NBQ2IsT0FBTyxDQUFDLE1BQU0sRUFBRSxHQUFHLENBQUMsQ0FBQyxrQkFBa0I7U0FDdkMsT0FBTyxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQyxrQkFBa0I7U0FDekMsT0FBTyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUMsQ0FBQyxrQkFBa0I7U0FDM0MsT0FBTyxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQywwQkFBMEI7U0FDakQsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQyxvQkFBb0I7U0FDdkMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLGtCQUFrQjtBQUNuRCxDQUFDO0FBQUEsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiB0b0h1bWFuUmVhZGFibGVOYW1lKGlucHV0OiBzdHJpbmcpIHtcbiAgICAvLyBSZXBsYWNlIHNwZWNpYWwgY2hhcmFjdGVycyB3aXRoIHNwYWNlLCBhZGQgc3BhY2UgYmVmb3JlIHVwcGVyY2FzZSwgY29sbGFwc2Ugc3BhY2VzLCB0cmltXG4gICAgbGV0IHJlc3VsdCA9IGlucHV0XG4gICAgICAgIC5yZXBsYWNlKC9bXmEtekEtWjAtOV0rL2csICcgJykgICAgICAvLyByZXBsYWNlIHNwZWNpYWwgY2hhcnMgd2l0aCBzcGFjZVxuICAgICAgICAucmVwbGFjZSgvKFtBLVpdKS9nLCAnICQxJykgICAgICAgICAgLy8gYWRkIHNwYWNlIGJlZm9yZSBjYXBpdGFsIGxldHRlcnNcbiAgICAgICAgLnJlcGxhY2UoL1xccysvZywgJyAnKSAgICAgICAgICAgICAgICAvLyBjb2xsYXBzZSBtdWx0aXBsZSBzcGFjZXNcbiAgICAgICAgLnRyaW0oKTtcblxuICAgIC8vIENhcGl0YWxpemUgdGhlIGZpcnN0IGNoYXJhY3RlciBhbmQgYW55IGNoYXJhY3RlciBhZnRlciBhIHNwYWNlXG4gICAgcmV0dXJuIHJlc3VsdC5yZXBsYWNlKC8oXnxcXHMpKFthLXpBLVpdKS9nLCAoXywgcDEsIHAyKSA9PiBwMSArIHAyLnRvVXBwZXJDYXNlKCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2FtZWxDYXNlKGlucHV0OiBzdHJpbmcpIHtcbiAgICAvLyBodHRwczovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMjk3MDY2N1xuICAgIHJldHVybiBpbnB1dC5yZXBsYWNlKC8oPzpeXFx3fFtBLVpdfFxcYlxcd3xcXHMrKS9nLCBmdW5jdGlvbihtYXRjaCwgaW5kZXgpIHtcbiAgICAgIGlmICgrbWF0Y2ggPT09IDApIHJldHVybiBcIlwiOyAvLyBvciBpZiAoL1xccysvLnRlc3QobWF0Y2gpKSBmb3Igd2hpdGUgc3BhY2VzXG4gICAgICByZXR1cm4gaW5kZXggPT09IDAgPyBtYXRjaC50b0xvd2VyQ2FzZSgpIDogbWF0Y2gudG9VcHBlckNhc2UoKTtcbiAgICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhc2NhbENhc2UoaW5wdXQ6IHN0cmluZykge1xuICAgIGlucHV0ID0gY2FtZWxDYXNlKGlucHV0KTtcbiAgICByZXR1cm4gaW5wdXQuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBpbnB1dC5zbGljZSgxKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvU2x1ZyhzdHI6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgaWYoIXN0cikgcmV0dXJuICcnO1xuICAgIFxuICAgIHJldHVybiBzdHIudG9TdHJpbmcoKS5ub3JtYWxpemUoJ05GRCcpXG4gICAgICAgICAgICAucmVwbGFjZSgvW1xcdTAzMDAtXFx1MDM2Zl0vZywgXCJcIikgLy9yZW1vdmUgZGlhY3JpdGljc1xuICAgICAgICAgICAgLnRvTG93ZXJDYXNlKClcbiAgICAgICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICctJykgLy9zcGFjZXMgdG8gZGFzaGVzXG4gICAgICAgICAgICAucmVwbGFjZSgvJi9nLCAnLWFuZC0nKSAvL2FtcGVyc2FuZCB0byBhbmRcbiAgICAgICAgICAgIC5yZXBsYWNlKC9bXlxcd1xcLV0rL2csICcnKSAvL3JlbW92ZSBub24td29yZHNcbiAgICAgICAgICAgIC5yZXBsYWNlKC9cXC1cXC0rL2csICctJykgLy9jb2xsYXBzZSBtdWx0aXBsZSBkYXNoZXNcbiAgICAgICAgICAgIC5yZXBsYWNlKC9eLSsvLCAnJykgLy90cmltIHN0YXJ0aW5nIGRhc2hcbiAgICAgICAgICAgIC5yZXBsYWNlKC8tKyQvLCAnJyk7IC8vdHJpbSBlbmRpbmcgZGFzaFxufTsiXX0=