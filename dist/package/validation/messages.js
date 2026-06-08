"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 *
 * you can use one of the following placeholders
 *
 * - {validationName}: the name of the validation in the current rule   e.g. `minLength` | `required`
 * - {validationValue}: the value of the validation in the current rule e.g. `5`         | `true`
 *
 * - {key}: the name of the input-field that is being validated
 * - {received}: the value of the input-field that is being validated
 * - {refinedReceived}: the computed input-field-value, that required by the validation e.g. `length of a string`
 *
 */
exports.default = new Map(Object.entries({
    'validation.eq': "Value for '{key}' should be equal to '{validationValue}'",
    'validation.gt': "Value for '{key}' should be greater than '{validationValue}'",
    'validation.lt': "Value for '{key}' should be less than '{validationValue}'",
    'validation.gte': "Value for '{key}' should be greater than or equal to '{validationValue}'",
    'validation.lte': "Value for '{key}' should be less than or equal to '{validationValue}'",
    'validation.neq': "Value for '{key}' should not be equal to '{validationValue}'",
    'validation.custom': "Value for '{key}' is invalid",
    'validation.inlist': "Value for '{key}' should be one of '{validationValue}'",
    'validation.unique': "Value for '{key}' should be unique",
    'validation.pattern': "Value for '{key}' should match '{validationValue}' pattern",
    'validation.datatype': "Value for '{key}' should be '{validationValue}'",
    'validation.required': "Value for '{key}' is required",
    'validation.maxlength': "Value for '{key}' should have maximum length of '{validationValue}'; instead of '{refinedReceived}'",
    'validation.minlength': "Value for '{key}' should have minimum length of '{validationValue}'; instead of '{refinedReceived}'",
    'validation.notinlist': "Value for '{key}' should not be one of '{validationValue}'",
}));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVzc2FnZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdmFsaWRhdGlvbi9tZXNzYWdlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7Ozs7OztHQVdHO0FBQ0gsa0JBQWUsSUFBSSxHQUFHLENBQWtCLE1BQU0sQ0FBQyxPQUFPLENBQUM7SUFDbkQsZUFBZSxFQUFhLDBEQUEwRDtJQUN0RixlQUFlLEVBQWEsOERBQThEO0lBQzFGLGVBQWUsRUFBYSwyREFBMkQ7SUFDdkYsZ0JBQWdCLEVBQVksMEVBQTBFO0lBQ3RHLGdCQUFnQixFQUFZLHVFQUF1RTtJQUNuRyxnQkFBZ0IsRUFBWSw4REFBOEQ7SUFDMUYsbUJBQW1CLEVBQVMsOEJBQThCO0lBQzFELG1CQUFtQixFQUFTLHdEQUF3RDtJQUNwRixtQkFBbUIsRUFBUyxvQ0FBb0M7SUFDaEUsb0JBQW9CLEVBQVEsNERBQTREO0lBQ3hGLHFCQUFxQixFQUFPLGlEQUFpRDtJQUM3RSxxQkFBcUIsRUFBTywrQkFBK0I7SUFDM0Qsc0JBQXNCLEVBQU0scUdBQXFHO0lBQ2pJLHNCQUFzQixFQUFNLHFHQUFxRztJQUNqSSxzQkFBc0IsRUFBTSw0REFBNEQ7Q0FDM0YsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFxuICogeW91IGNhbiB1c2Ugb25lIG9mIHRoZSBmb2xsb3dpbmcgcGxhY2Vob2xkZXJzXG4gKiBcbiAqIC0ge3ZhbGlkYXRpb25OYW1lfTogdGhlIG5hbWUgb2YgdGhlIHZhbGlkYXRpb24gaW4gdGhlIGN1cnJlbnQgcnVsZSAgIGUuZy4gYG1pbkxlbmd0aGAgfCBgcmVxdWlyZWRgXG4gKiAtIHt2YWxpZGF0aW9uVmFsdWV9OiB0aGUgdmFsdWUgb2YgdGhlIHZhbGlkYXRpb24gaW4gdGhlIGN1cnJlbnQgcnVsZSBlLmcuIGA1YCAgICAgICAgIHwgYHRydWVgXG4gKiBcbiAqIC0ge2tleX06IHRoZSBuYW1lIG9mIHRoZSBpbnB1dC1maWVsZCB0aGF0IGlzIGJlaW5nIHZhbGlkYXRlZFxuICogLSB7cmVjZWl2ZWR9OiB0aGUgdmFsdWUgb2YgdGhlIGlucHV0LWZpZWxkIHRoYXQgaXMgYmVpbmcgdmFsaWRhdGVkXG4gKiAtIHtyZWZpbmVkUmVjZWl2ZWR9OiB0aGUgY29tcHV0ZWQgaW5wdXQtZmllbGQtdmFsdWUsIHRoYXQgcmVxdWlyZWQgYnkgdGhlIHZhbGlkYXRpb24gZS5nLiBgbGVuZ3RoIG9mIGEgc3RyaW5nYFxuICogXG4gKi9cbmV4cG9ydCBkZWZhdWx0IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCBPYmplY3QuZW50cmllcyh7XG4gICAgJ3ZhbGlkYXRpb24uZXEnOiAgICAgICAgICAgIFwiVmFsdWUgZm9yICd7a2V5fScgc2hvdWxkIGJlIGVxdWFsIHRvICd7dmFsaWRhdGlvblZhbHVlfSdcIixcbiAgICAndmFsaWRhdGlvbi5ndCc6ICAgICAgICAgICAgXCJWYWx1ZSBmb3IgJ3trZXl9JyBzaG91bGQgYmUgZ3JlYXRlciB0aGFuICd7dmFsaWRhdGlvblZhbHVlfSdcIixcbiAgICAndmFsaWRhdGlvbi5sdCc6ICAgICAgICAgICAgXCJWYWx1ZSBmb3IgJ3trZXl9JyBzaG91bGQgYmUgbGVzcyB0aGFuICd7dmFsaWRhdGlvblZhbHVlfSdcIixcbiAgICAndmFsaWRhdGlvbi5ndGUnOiAgICAgICAgICAgXCJWYWx1ZSBmb3IgJ3trZXl9JyBzaG91bGQgYmUgZ3JlYXRlciB0aGFuIG9yIGVxdWFsIHRvICd7dmFsaWRhdGlvblZhbHVlfSdcIixcbiAgICAndmFsaWRhdGlvbi5sdGUnOiAgICAgICAgICAgXCJWYWx1ZSBmb3IgJ3trZXl9JyBzaG91bGQgYmUgbGVzcyB0aGFuIG9yIGVxdWFsIHRvICd7dmFsaWRhdGlvblZhbHVlfSdcIixcbiAgICAndmFsaWRhdGlvbi5uZXEnOiAgICAgICAgICAgXCJWYWx1ZSBmb3IgJ3trZXl9JyBzaG91bGQgbm90IGJlIGVxdWFsIHRvICd7dmFsaWRhdGlvblZhbHVlfSdcIixcbiAgICAndmFsaWRhdGlvbi5jdXN0b20nOiAgICAgICAgXCJWYWx1ZSBmb3IgJ3trZXl9JyBpcyBpbnZhbGlkXCIsXG4gICAgJ3ZhbGlkYXRpb24uaW5saXN0JzogICAgICAgIFwiVmFsdWUgZm9yICd7a2V5fScgc2hvdWxkIGJlIG9uZSBvZiAne3ZhbGlkYXRpb25WYWx1ZX0nXCIsXG4gICAgJ3ZhbGlkYXRpb24udW5pcXVlJzogICAgICAgIFwiVmFsdWUgZm9yICd7a2V5fScgc2hvdWxkIGJlIHVuaXF1ZVwiLFxuICAgICd2YWxpZGF0aW9uLnBhdHRlcm4nOiAgICAgICBcIlZhbHVlIGZvciAne2tleX0nIHNob3VsZCBtYXRjaCAne3ZhbGlkYXRpb25WYWx1ZX0nIHBhdHRlcm5cIixcbiAgICAndmFsaWRhdGlvbi5kYXRhdHlwZSc6ICAgICAgXCJWYWx1ZSBmb3IgJ3trZXl9JyBzaG91bGQgYmUgJ3t2YWxpZGF0aW9uVmFsdWV9J1wiLFxuICAgICd2YWxpZGF0aW9uLnJlcXVpcmVkJzogICAgICBcIlZhbHVlIGZvciAne2tleX0nIGlzIHJlcXVpcmVkXCIsXG4gICAgJ3ZhbGlkYXRpb24ubWF4bGVuZ3RoJzogICAgIFwiVmFsdWUgZm9yICd7a2V5fScgc2hvdWxkIGhhdmUgbWF4aW11bSBsZW5ndGggb2YgJ3t2YWxpZGF0aW9uVmFsdWV9JzsgaW5zdGVhZCBvZiAne3JlZmluZWRSZWNlaXZlZH0nXCIsXG4gICAgJ3ZhbGlkYXRpb24ubWlubGVuZ3RoJzogICAgIFwiVmFsdWUgZm9yICd7a2V5fScgc2hvdWxkIGhhdmUgbWluaW11bSBsZW5ndGggb2YgJ3t2YWxpZGF0aW9uVmFsdWV9JzsgaW5zdGVhZCBvZiAne3JlZmluZWRSZWNlaXZlZH0nXCIsXG4gICAgJ3ZhbGlkYXRpb24ubm90aW5saXN0JzogICAgIFwiVmFsdWUgZm9yICd7a2V5fScgc2hvdWxkIG5vdCBiZSBvbmUgb2YgJ3t2YWxpZGF0aW9uVmFsdWV9J1wiLFxufSkpOyJdfQ==