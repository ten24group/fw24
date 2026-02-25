import { getValueByPath, isObject } from '../utils';
import { Actor } from './types/execution-context';

/**
 * Core engine for evaluating rules against data.
 * Shared by Validator and ConditionEvaluator.
 */
export class EvaluationEngine {

  /**
   * Evaluates a single rule against a value.
   * Supports both EvaluationRule (Condition system) and ValidationRule (Validator system).
   */
  static async evaluateRule(
    rule: any,
    value: any,
    context: {
      input?: any,
      record?: any,
      actor?: Actor,
      [key: string]: any
    } = {}
  ): Promise<{ pass: boolean; expected?: any; received?: any }> {

    // Equality
    if (rule.eq !== undefined) {
      const target = this.resolveValue(rule.eq, context);
      if (value !== target) return { pass: false, expected: ['eq', target], received: value };
    }
    if (rule.neq !== undefined) {
      const target = this.resolveValue(rule.neq, context);
      if (value === target) return { pass: false, expected: ['neq', target], received: value };
    }

    // Comparison
    if (rule.gt !== undefined) {
      const target = Number(this.resolveValue(rule.gt, context));
      if (!(Number(value) > target)) return { pass: false, expected: ['gt', target], received: value };
    }
    if (rule.gte !== undefined) {
      const target = Number(this.resolveValue(rule.gte, context));
      if (!(Number(value) >= target)) return { pass: false, expected: ['gte', target], received: value };
    }
    if (rule.lt !== undefined) {
      const target = Number(this.resolveValue(rule.lt, context));
      if (!(Number(value) < target)) return { pass: false, expected: ['lt', target], received: value };
    }
    if (rule.lte !== undefined) {
      const target = Number(this.resolveValue(rule.lte, context));
      if (!(Number(value) <= target)) return { pass: false, expected: ['lte', target], received: value };
    }

    // Range
    if (rule.between !== undefined && Array.isArray(rule.between)) {
      const [min, max] = rule.between.map(v => Number(this.resolveValue(v, context)));
      const numVal = Number(value);
      if (!(numVal >= min && numVal <= max)) return { pass: false, expected: ['between', [min, max]], received: value };
    }

    // Membership
    if (rule.inList !== undefined && Array.isArray(rule.inList)) {
      if (!rule.inList.includes(value)) return { pass: false, expected: ['inList', rule.inList], received: value };
    }
    if (rule.notInList !== undefined && Array.isArray(rule.notInList)) {
      if (rule.notInList.includes(value)) return { pass: false, expected: ['notInList', rule.notInList], received: value };
    }

    // Existence / Empty
    if (rule.exists === true && (value === undefined || value === null)) {
      return { pass: false, expected: ['exists', true], received: value };
    }
    if (rule.exists === false && value !== undefined && value !== null) {
      return { pass: false, expected: ['exists', false], received: value };
    }

    if (rule.empty === true) {
      const isEmpty = value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0);
      if (!isEmpty) return { pass: false, expected: ['empty', true], received: value };
    }
    if (rule.empty === false) {
      const isEmpty = value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0);
      if (isEmpty) return { pass: false, expected: ['empty', false], received: value };
    }

    // Pattern
    if (rule.pattern) {
      const regex = rule.pattern instanceof RegExp ? rule.pattern : new RegExp(rule.pattern);
      if (!regex.test(String(value))) return { pass: false, expected: ['pattern', rule.pattern], received: value };
    }

    // Contains
    if (rule.contains) {
      if (!String(value).toLowerCase().includes(String(rule.contains).toLowerCase())) {
        return { pass: false, expected: ['contains', rule.contains], received: value };
      }
    }

    // String Length
    if (rule.minLength !== undefined) {
      if (!value || value.length < rule.minLength) return { pass: false, expected: ['minLength', rule.minLength], received: value?.length };
    }
    if (rule.maxLength !== undefined) {
      if (value && value.length > rule.maxLength) return { pass: false, expected: ['maxLength', rule.maxLength], received: value?.length };
    }

    // Cross-field logic
    if (rule.greaterThanField) {
      const targetObj = context.input || context.record;
      const otherVal = this.safeGetValue(targetObj, rule.greaterThanField);
      if (!(Number(value) > Number(otherVal))) return { pass: false, expected: ['greaterThanField', rule.greaterThanField], received: value };
    }
    if (rule.lessThanField) {
      const targetObj = context.input || context.record;
      const otherVal = this.safeGetValue(targetObj, rule.lessThanField);
      if (!(Number(value) < Number(otherVal))) return { pass: false, expected: ['lessThanField', rule.lessThanField], received: value };
    }
    if (rule.requiredIf) {
      const criteria = Array.isArray(rule.requiredIf) ? rule.requiredIf : [rule.requiredIf];
      let matches = true;
      const targetObj = context.input || context.record;
      for (const c of criteria) {
        const fVal = this.safeGetValue(targetObj, c.field);
        if (fVal !== c.value) {
          matches = false;
          break;
        }
      }
      if (matches && (value === undefined || value === null || value === '')) {
        return { pass: false, expected: ['requiredIf', rule.requiredIf], received: value };
      }
    }

    // Custom
    if (rule.custom) {
      // In Validation context, rule.custom is a function.
      // In Condition context, it's a string name of a registered evaluator.
      if (typeof rule.custom === 'function') {
        const res = await rule.custom(value, context);
        if (!res) return { pass: false, expected: ['custom', 'function'], received: value };
      }
      // String-based custom evaluators are handled by the caller (ConditionEvaluator)
    }

    return { pass: true };
  }

  private static resolveValue(refOrVal: any, context: any): any {
    if (refOrVal && typeof refOrVal === 'object' && '$ref' in refOrVal) {
      return this.safeGetValue(context, refOrVal.$ref);
    }
    return refOrVal;
  }

  private static safeGetValue(obj: any, path: string): any {
    try {
      return getValueByPath(obj, path);
    } catch (e) {
      return undefined;
    }
  }
}
