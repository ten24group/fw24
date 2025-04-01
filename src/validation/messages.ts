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
export default new Map<string, string>(
  Object.entries({
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
    'validation.maxlength':
      "Value for '{key}' should have maximum length of '{validationValue}'; instead of '{refinedReceived}'",
    'validation.minlength':
      "Value for '{key}' should have minimum length of '{validationValue}'; instead of '{refinedReceived}'",
    'validation.notinlist': "Value for '{key}' should not be one of '{validationValue}'",
  }),
);
