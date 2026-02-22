import { Condition, InlineCondition, EvaluationRule } from '../entity/base-entity';
import { Actor } from './types/execution-context';
import { getValueByPath, isObject } from '../utils';
import { EvaluationEngine } from './evaluation-engine';

/**
 * Evaluates FW24 Conditions in the backend.
 * Used for Field Level Security (FLS) and other server-side conditional logic.
 */
export class ConditionEvaluator {

  /**
   * Evaluates a condition against a provided context.
   */
  static async evaluate(
    condition: Condition | undefined,
    context: {
      actor?: Actor,
      record?: any,
      input?: any,
      tenant?: any,
      [key: string]: any
    }
  ): Promise<boolean> {
    if (condition === undefined || condition === true) return true;
    if (condition === false) return false;

    if (typeof condition === 'object') {
      if ('and' in condition && Array.isArray(condition.and)) {
        for (const sub of condition.and) {
          if (!(await this.evaluate(sub, context))) return false;
        }
        return true;
      }

      if ('or' in condition && Array.isArray(condition.or)) {
        for (const sub of condition.or) {
          if (await this.evaluate(sub, context)) return true;
        }
        return false;
      }

      if ('not' in condition) {
        return !(await this.evaluate(condition.not as Condition, context));
      }

      if ('ref' in condition) {
        // Named conditions - currently not supported in backend
        return false;
      }

      if ('custom' in condition) {
        // Custom evaluators - currently not supported in backend
        return false;
      }

      // It's an InlineCondition
      return this.evaluateInline(condition as InlineCondition, context);
    }

    return false;
  }

  private static async evaluateInline(condition: InlineCondition, context: any): Promise<boolean> {
    // Categories: actor, record, input, tenant, device, context, queryParams, etc.
    for (const [category, rules] of Object.entries(condition)) {
      if (!isObject(rules)) continue;

      const categoryData = context[category];

      for (const [path, rule] of Object.entries(rules)) {
        let val: any;
        try {
          val = getValueByPath(categoryData, path);
        } catch (e) {
          val = undefined;
        }
        const result = await EvaluationEngine.evaluateRule(rule as EvaluationRule, val, context);
        if (!result.pass) {
          return false;
        }
      }
    }
    return true;
  }
}
