/**
 * JSON-based validation configuration utility
 * Allows defining validation rules as plain objects/JSON instead of builder functions
 */
import { ValidationRule, ConditionalRule } from '../core/types';
import * as rules from '../rules';
import * as dataTypeRules from '../rules/data-types';
import * as performanceRules from '../rules/performance';
import { when, whenAll, whenAny, whenNot } from '../conditions';
import { nested, eachItem, objectValues, dependsOn } from '../validator/nested';
import { ValidationSchema } from '../validator';

type JsonValidationRule = Record<string, any>;
type JsonValidationSchema<T> = {
  fields: Record<keyof T, JsonValidationRule>;
  conditions?: Record<string, any>;
};

/**
 * Converts a JSON validation rule to a ValidationRule
 * @param jsonRule The JSON validation rule
 * @returns A ValidationRule instance
 */
export function parseJsonRule<TContext = unknown>(
  jsonRule: JsonValidationRule,
): ValidationRule<any, TContext> | ConditionalRule<any, TContext> {
  // Handle conditional rules
  if ('when' in jsonRule && 'rule' in jsonRule) {
    const conditionRef = jsonRule.when;
    const rule = parseJsonRule(jsonRule.rule);
    return when(conditionRef, rule as ValidationRule<any, TContext>);
  }

  if ('whenAll' in jsonRule && 'rule' in jsonRule) {
    const conditions = jsonRule.whenAll;
    const rule = parseJsonRule(jsonRule.rule);
    return whenAll(conditions, rule as ValidationRule<any, TContext>);
  }

  if ('whenAny' in jsonRule && 'rule' in jsonRule) {
    const conditions = jsonRule.whenAny;
    const rule = parseJsonRule(jsonRule.rule);
    return whenAny(conditions, rule as ValidationRule<any, TContext>);
  }

  if ('whenNot' in jsonRule && 'rule' in jsonRule) {
    const condition = jsonRule.whenNot;
    const rule = parseJsonRule(jsonRule.rule);
    return whenNot(condition, rule as ValidationRule<any, TContext>);
  }

  // Handle nested validation
  if ('nested' in jsonRule) {
    const { nested: nestedPath, schema } = jsonRule;
    return nested(nestedPath, parseJsonSchema(schema), jsonRule.options);
  }

  if ('eachItem' in jsonRule) {
    const itemRule = parseJsonRule(jsonRule.eachItem);
    return eachItem(itemRule as ValidationRule<any, TContext>, jsonRule.options);
  }

  if ('objectValues' in jsonRule) {
    const valueRule = parseJsonRule(jsonRule.objectValues);
    return objectValues(valueRule as ValidationRule<any, TContext>, jsonRule.options);
  }

  if ('dependsOn' in jsonRule) {
    const { dependsOn: dependencyPath, condition } = jsonRule;
    // Note: for dependsOn with JSON config, the condition has to be a string reference to a named function
    return dependsOn(dependencyPath, getNamedFunction(condition), jsonRule.options);
  }

  // Handle basic rules
  for (const key in jsonRule) {
    const value = jsonRule[key];
    const options =
      typeof value === 'object' && value !== null && 'value' in value
        ? { message: value.message, messageId: value.messageId }
        : {};

    const ruleValue = typeof value === 'object' && value !== null && 'value' in value ? value.value : value;

    // Basic rules
    if (key === 'required') return rules.required(options);
    if (key === 'minLength') return rules.minLength(ruleValue, options);
    if (key === 'maxLength') return rules.maxLength(ruleValue, options);
    if (key === 'min') return rules.min(ruleValue, options);
    if (key === 'max') return rules.max(ruleValue, options);
    if (key === 'equals' || key === 'eq') return rules.equals(ruleValue, options);
    if (key === 'notEquals' || key === 'neq') return rules.notEquals(ruleValue, options);
    if (key === 'oneOf' || key === 'inList') return rules.oneOf(ruleValue, options);
    if (key === 'notOneOf' || key === 'notInList') return rules.notOneOf(ruleValue, options);
    if (key === 'matches' || key === 'pattern') {
      // If pattern is provided as a string, convert to RegExp
      const pattern = typeof ruleValue === 'string' ? new RegExp(ruleValue) : ruleValue;
      return rules.matches(pattern, options);
    }

    // Compatibility with old format
    if (key === 'gt') return rules.min(ruleValue + 1, options);
    if (key === 'lt') return rules.max(ruleValue - 1, options);
    if (key === 'gte') return rules.min(ruleValue, options);
    if (key === 'lte') return rules.max(ruleValue, options);

    // Data type rules
    if (key === 'email') return dataTypeRules.isEmail(options);
    if (key === 'uuid') return dataTypeRules.isUUID(options);
    if (key === 'ip') return dataTypeRules.isIP(options);
    if (key === 'ipv4') return dataTypeRules.isIPv4(options);
    if (key === 'ipv6') return dataTypeRules.isIPv6(options);
    if (key === 'url') return dataTypeRules.isURL(options);
    if (key === 'date') return dataTypeRules.isDate(options);
    if (key === 'json') return dataTypeRules.isJSON(options);
    if (key === 'numeric') return dataTypeRules.isNumeric(options);
    if (key === 'unique') return dataTypeRules.unique(options);
    if (key === 'datatype') return dataTypeRules.isType(ruleValue, options);

    // Performance rules
    if (key === 'safeSizeString') return performanceRules.safeSizeString(ruleValue, options);
    if (key === 'safeSizeArray') return performanceRules.safeSizeArray(ruleValue, options);
    if (key === 'safeSizeObject') return performanceRules.safeSizeObject(ruleValue, options);
    if (key === 'safeSizeJSON') return performanceRules.safeSizeJSON(ruleValue, options);
    if (key === 'safeDepth') return performanceRules.safeDepth(ruleValue, options);

    // Custom validation
    if (key === 'custom') {
      if (typeof ruleValue === 'string') {
        return rules.custom(getNamedFunction(ruleValue), options);
      } else {
        throw new Error('Custom validation requires a named function reference');
      }
    }
  }

  // If nothing matches, return a validation rule that always passes
  console.warn('Unknown JSON validation rule:', jsonRule);
  return {
    async validate() {
      return { pass: true };
    },
  };
}

/**
 * Converts a JSON validation schema to a ValidationSchema
 * @param jsonSchema The JSON validation schema
 * @returns A ValidationSchema instance
 */
export function parseJsonSchema<T, TContext = unknown>(
  jsonSchema: JsonValidationSchema<T>,
): ValidationSchema<T, TContext> {
  const fields: Record<string, ValidationRule<any, TContext> | ConditionalRule<any, TContext>> = {};

  for (const key in jsonSchema.fields) {
    fields[key] = parseJsonRule(jsonSchema.fields[key]);
  }

  // Parse conditions if they exist
  const conditions: Record<string, (entity: T, context?: TContext) => boolean> = {};
  if (jsonSchema.conditions) {
    for (const key in jsonSchema.conditions) {
      const conditionRef = jsonSchema.conditions[key];
      if (typeof conditionRef === 'string') {
        conditions[key] = getNamedFunction(conditionRef);
      } else {
        console.warn('Condition must be a named function reference:', key);
      }
    }
  }

  // Use type assertion to overcome the type constraint
  return {
    fields,
    conditions,
  } as ValidationSchema<T, TContext>;
}

/**
 * Gets a named function from the global registry
 * This is needed for JSON validation configs since functions can't be serialized
 */
function getNamedFunction(name: string): any {
  // @ts-ignore
  const func = global.__validationFunctions__?.[name];
  if (!func) {
    throw new Error(`Named function not found in registry: ${name}`);
  }
  return func;
}

/**
 * Registers a named function for use in JSON validation configs
 * @param name The function name
 * @param func The function implementation
 */
export function registerFunction(name: string, func: Function): void {
  // @ts-ignore
  if (!global.__validationFunctions__) {
    // @ts-ignore
    global.__validationFunctions__ = {};
  }
  // @ts-ignore
  global.__validationFunctions__[name] = func;
}

/**
 * Clears all registered functions
 */
export function clearRegisteredFunctions(): void {
  // @ts-ignore
  global.__validationFunctions__ = {};
}
