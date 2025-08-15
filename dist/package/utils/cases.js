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
    return str.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, "") //remove diacritics
        .toLowerCase()
        .replace(/\s+/g, '-') //spaces to dashes
        .replace(/&/g, '-and-') //ampersand to and
        .replace(/[^\w\-]+/g, '') //remove non-words
        .replace(/\-\-+/g, '-') //collapse multiple dashes
        .replace(/^-+/, '') //trim starting dash
        .replace(/-+$/, ''); //trim ending dash
}
;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FzZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdXRpbHMvY2FzZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxrREFVQztBQUVELDhCQU1DO0FBRUQsZ0NBR0M7QUFFRCx3QkFXQztBQXBDRCxTQUFnQixtQkFBbUIsQ0FBQyxLQUFhO0lBQzdDLDJGQUEyRjtJQUMzRixJQUFJLE1BQU0sR0FBRyxLQUFLO1NBQ2IsT0FBTyxDQUFDLGdCQUFnQixFQUFFLEdBQUcsQ0FBQyxDQUFNLG1DQUFtQztTQUN2RSxPQUFPLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxDQUFVLG1DQUFtQztTQUN2RSxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFnQiwyQkFBMkI7U0FDL0QsSUFBSSxFQUFFLENBQUM7SUFFWixpRUFBaUU7SUFDakUsT0FBTyxNQUFNLENBQUMsT0FBTyxDQUFDLG1CQUFtQixFQUFFLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxDQUFDLEVBQUUsR0FBRyxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztBQUNyRixDQUFDO0FBRUQsU0FBZ0IsU0FBUyxDQUFDLEtBQWE7SUFDbkMsc0NBQXNDO0lBQ3RDLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyx5QkFBeUIsRUFBRSxVQUFTLEtBQUssRUFBRSxLQUFLO1FBQ25FLElBQUksQ0FBQyxLQUFLLEtBQUssQ0FBQztZQUFFLE9BQU8sRUFBRSxDQUFDLENBQUMsNkNBQTZDO1FBQzFFLE9BQU8sS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDakUsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQsU0FBZ0IsVUFBVSxDQUFDLEtBQWE7SUFDcEMsS0FBSyxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUN6QixPQUFPLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMxRCxDQUFDO0FBRUQsU0FBZ0IsTUFBTSxDQUFDLEdBQVc7SUFDOUIsSUFBRyxDQUFDLEdBQUc7UUFBRSxPQUFPLEVBQUUsQ0FBQztJQUVuQixPQUFPLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLGtCQUFrQixFQUFFLEVBQUUsQ0FBQyxDQUFDLG1CQUFtQjtTQUNqRixXQUFXLEVBQUU7U0FDYixPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFDLGtCQUFrQjtTQUN2QyxPQUFPLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDLGtCQUFrQjtTQUN6QyxPQUFPLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQyxDQUFDLGtCQUFrQjtTQUMzQyxPQUFPLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDLDBCQUEwQjtTQUNqRCxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDLG9CQUFvQjtTQUN2QyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsa0JBQWtCO0FBQ25ELENBQUM7QUFBQSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIHRvSHVtYW5SZWFkYWJsZU5hbWUoaW5wdXQ6IHN0cmluZykge1xuICAgIC8vIFJlcGxhY2Ugc3BlY2lhbCBjaGFyYWN0ZXJzIHdpdGggc3BhY2UsIGFkZCBzcGFjZSBiZWZvcmUgdXBwZXJjYXNlLCBjb2xsYXBzZSBzcGFjZXMsIHRyaW1cbiAgICBsZXQgcmVzdWx0ID0gaW5wdXRcbiAgICAgICAgLnJlcGxhY2UoL1teYS16QS1aMC05XSsvZywgJyAnKSAgICAgIC8vIHJlcGxhY2Ugc3BlY2lhbCBjaGFycyB3aXRoIHNwYWNlXG4gICAgICAgIC5yZXBsYWNlKC8oW0EtWl0pL2csICcgJDEnKSAgICAgICAgICAvLyBhZGQgc3BhY2UgYmVmb3JlIGNhcGl0YWwgbGV0dGVyc1xuICAgICAgICAucmVwbGFjZSgvXFxzKy9nLCAnICcpICAgICAgICAgICAgICAgIC8vIGNvbGxhcHNlIG11bHRpcGxlIHNwYWNlc1xuICAgICAgICAudHJpbSgpO1xuXG4gICAgLy8gQ2FwaXRhbGl6ZSB0aGUgZmlyc3QgY2hhcmFjdGVyIGFuZCBhbnkgY2hhcmFjdGVyIGFmdGVyIGEgc3BhY2VcbiAgICByZXR1cm4gcmVzdWx0LnJlcGxhY2UoLyhefFxccykoW2EtekEtWl0pL2csIChfLCBwMSwgcDIpID0+IHAxICsgcDIudG9VcHBlckNhc2UoKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW1lbENhc2UoaW5wdXQ6IHN0cmluZykge1xuICAgIC8vIGh0dHBzOi8vc3RhY2tvdmVyZmxvdy5jb20vYS8yOTcwNjY3XG4gICAgcmV0dXJuIGlucHV0LnJlcGxhY2UoLyg/Ol5cXHd8W0EtWl18XFxiXFx3fFxccyspL2csIGZ1bmN0aW9uKG1hdGNoLCBpbmRleCkge1xuICAgICAgaWYgKCttYXRjaCA9PT0gMCkgcmV0dXJuIFwiXCI7IC8vIG9yIGlmICgvXFxzKy8udGVzdChtYXRjaCkpIGZvciB3aGl0ZSBzcGFjZXNcbiAgICAgIHJldHVybiBpbmRleCA9PT0gMCA/IG1hdGNoLnRvTG93ZXJDYXNlKCkgOiBtYXRjaC50b1VwcGVyQ2FzZSgpO1xuICAgIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFzY2FsQ2FzZShpbnB1dDogc3RyaW5nKSB7XG4gICAgaW5wdXQgPSBjYW1lbENhc2UoaW5wdXQpO1xuICAgIHJldHVybiBpbnB1dC5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIGlucHV0LnNsaWNlKDEpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9TbHVnKHN0cjogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBpZighc3RyKSByZXR1cm4gJyc7XG4gICAgXG4gICAgcmV0dXJuIHN0ci50b1N0cmluZygpLm5vcm1hbGl6ZSgnTkZEJykucmVwbGFjZSgvW1xcdTAzMDAtXFx1MDM2Zl0vZywgXCJcIikgLy9yZW1vdmUgZGlhY3JpdGljc1xuICAgICAgICAgICAgLnRvTG93ZXJDYXNlKClcbiAgICAgICAgICAgIC5yZXBsYWNlKC9cXHMrL2csICctJykgLy9zcGFjZXMgdG8gZGFzaGVzXG4gICAgICAgICAgICAucmVwbGFjZSgvJi9nLCAnLWFuZC0nKSAvL2FtcGVyc2FuZCB0byBhbmRcbiAgICAgICAgICAgIC5yZXBsYWNlKC9bXlxcd1xcLV0rL2csICcnKSAvL3JlbW92ZSBub24td29yZHNcbiAgICAgICAgICAgIC5yZXBsYWNlKC9cXC1cXC0rL2csICctJykgLy9jb2xsYXBzZSBtdWx0aXBsZSBkYXNoZXNcbiAgICAgICAgICAgIC5yZXBsYWNlKC9eLSsvLCAnJykgLy90cmltIHN0YXJ0aW5nIGRhc2hcbiAgICAgICAgICAgIC5yZXBsYWNlKC8tKyQvLCAnJyk7IC8vdHJpbSBlbmRpbmcgZGFzaFxufTsiXX0=