import {
  OPERATOR_ALIASES,
  CORE_OPERATORS,
  NUMERIC_COMPARISON_OPERATORS,
  ARRAY_OPERATORS,
  normalizeOperator,
  isCoreOperator,
  isNumericOperator,
  isArrayOperator,
  extractFilterValue,
  shouldCoerceToNumber,
  normalizeToArray,
  isOperatorAlias,
  getOperatorAliases,
  isValidOperator,
  createOperatorMatcher,
  normalizeRangeValue,
  coerceValue,
  PARSE_VALUE_DELIMITERS,
  FILTER_KEYS_HAVING_ARRAY_VALUES
} from './query-utils';

describe('Query Utils', () => {
  describe('OPERATOR_ALIASES', () => {
    it('should contain all expected aliases', () => {
      expect(OPERATOR_ALIASES[ 'equalTo' ]).toBe('eq');
      expect(OPERATOR_ALIASES[ '!=' ]).toBe('neq');
      expect(OPERATOR_ALIASES[ '>=' ]).toBe('gte');
      expect(OPERATOR_ALIASES[ '<' ]).toBe('lt');
      expect(OPERATOR_ALIASES[ 'between' ]).toBe('bt');
      expect(OPERATOR_ALIASES[ 'includes' ]).toBe('contains');
    });
  });

  describe('normalizeOperator', () => {
    it('should normalize aliases to core operators', () => {
      expect(normalizeOperator('equalTo')).toBe('eq');
      expect(normalizeOperator('!=')).toBe('neq');
      expect(normalizeOperator('greaterThan')).toBe('gt');
      expect(normalizeOperator('includes')).toBe('contains');
    });

    it('should return core operators unchanged', () => {
      expect(normalizeOperator('eq')).toBe('eq');
      expect(normalizeOperator('gt')).toBe('gt');
      expect(normalizeOperator('contains')).toBe('contains');
    });

    it('should return unknown operators unchanged', () => {
      expect(normalizeOperator('unknownOp')).toBe('unknownOp');
    });
  });

  describe('isCoreOperator', () => {
    it('should identify core operators', () => {
      expect(isCoreOperator('eq')).toBe(true);
      expect(isCoreOperator('gt')).toBe(true);
      expect(isCoreOperator('contains')).toBe(true);
    });

    it('should not identify aliases as core operators', () => {
      expect(isCoreOperator('equalTo')).toBe(false);
      expect(isCoreOperator('!=')).toBe(false);
      expect(isCoreOperator('includes')).toBe(false);
    });
  });

  describe('isNumericOperator', () => {
    it('should identify numeric operators', () => {
      expect(isNumericOperator('gt')).toBe(true);
      expect(isNumericOperator('gte')).toBe(true);
      expect(isNumericOperator('lt')).toBe(true);
      expect(isNumericOperator('lte')).toBe(true);
      expect(isNumericOperator('bt')).toBe(true);
    });

    it('should not identify non-numeric operators', () => {
      expect(isNumericOperator('eq')).toBe(false);
      expect(isNumericOperator('contains')).toBe(false);
      expect(isNumericOperator('in')).toBe(false);
    });
  });

  describe('isArrayOperator', () => {
    it('should identify array operators', () => {
      expect(isArrayOperator('in')).toBe(true);
      expect(isArrayOperator('nin')).toBe(true);
      expect(isArrayOperator('contains')).toBe(true);
      expect(isArrayOperator('notInList')).toBe(true); // alias
    });

    it('should not identify non-array operators', () => {
      expect(isArrayOperator('eq')).toBe(false);
      expect(isArrayOperator('gt')).toBe(false);
      expect(isArrayOperator('startsWith')).toBe(false);
    });
  });

  describe('extractFilterValue', () => {
    it('should extract simple values unchanged', () => {
      expect(extractFilterValue('test')).toBe('test');
      expect(extractFilterValue(123)).toBe(123);
      expect(extractFilterValue(true)).toBe(true);
    });

    it('should extract complex filter values', () => {
      const complexValue = {
        val: 'actual_value',
        valType: 'literal' as const,
        valLabel: 'Display Label'
      };
      expect(extractFilterValue(complexValue)).toBe('actual_value');
    });
  });

  describe('shouldCoerceToNumber', () => {
    it('should recommend coercion for numeric operators with numeric strings', () => {
      expect(shouldCoerceToNumber('123', 'gt')).toBe(true);
      expect(shouldCoerceToNumber('45.67', 'lte')).toBe(true);
    });

    it('should not recommend coercion for non-numeric operators', () => {
      expect(shouldCoerceToNumber('123', 'eq')).toBe(false);
      expect(shouldCoerceToNumber('123', 'contains')).toBe(false);
    });

    it('should not recommend coercion for non-numeric strings', () => {
      expect(shouldCoerceToNumber('abc', 'gt')).toBe(false);
      expect(shouldCoerceToNumber('12abc', 'gte')).toBe(false);
    });
  });

  describe('normalizeToArray', () => {
    it('should convert single values to arrays', () => {
      expect(normalizeToArray('single')).toEqual([ 'single' ]);
      expect(normalizeToArray(42)).toEqual([ 42 ]);
      expect(normalizeToArray(null)).toEqual([ null ]);
    });

    it('should preserve arrays', () => {
      expect(normalizeToArray([ 'a', 'b' ])).toEqual([ 'a', 'b' ]);
      expect(normalizeToArray([])).toEqual([]);
    });
  });

  describe('isOperatorAlias', () => {
    it('should match operators to their core equivalents', () => {
      expect(isOperatorAlias('equalTo', 'eq')).toBe(true);
      expect(isOperatorAlias('!=', 'neq')).toBe(true);
      expect(isOperatorAlias('eq', 'eq')).toBe(true); // core operator matches itself
    });

    it('should not match unrelated operators', () => {
      expect(isOperatorAlias('gt', 'eq')).toBe(false);
      expect(isOperatorAlias('contains', 'neq')).toBe(false);
    });
  });

  describe('getOperatorAliases', () => {
    it('should return all aliases for a core operator', () => {
      const eqAliases = getOperatorAliases('eq');
      expect(eqAliases).toContain('eq');
      expect(eqAliases).toContain('equalTo');
      expect(eqAliases).toContain('equal');
      expect(eqAliases).toContain('===');
      expect(eqAliases).toContain('==');
    });
  });

  describe('isValidOperator', () => {
    it('should validate core operators', () => {
      expect(isValidOperator('eq')).toBe(true);
      expect(isValidOperator('gt')).toBe(true);
    });

    it('should validate aliases', () => {
      expect(isValidOperator('equalTo')).toBe(true);
      expect(isValidOperator('!=')).toBe(true);
    });

    it('should reject invalid operators', () => {
      expect(isValidOperator('unknownOp')).toBe(false);
      expect(isValidOperator('invalid')).toBe(false);
    });
  });

  describe('createOperatorMatcher', () => {
    it('should create a function that matches multiple operators', () => {
      const isEqualityOp = createOperatorMatcher([ 'eq', 'neq' ]);

      expect(isEqualityOp('eq')).toBe(true);
      expect(isEqualityOp('neq')).toBe(true);
      expect(isEqualityOp('equalTo')).toBe(true); // alias
      expect(isEqualityOp('!=')).toBe(true); // alias
      expect(isEqualityOp('gt')).toBe(false);
    });
  });

  describe('normalizeRangeValue', () => {
    it('should handle array format', () => {
      expect(normalizeRangeValue([ 1, 10 ])).toEqual([ 1, 10 ]);
      expect(normalizeRangeValue([ 'a', 'z' ])).toEqual([ 'a', 'z' ]);
    });

    it('should handle object format', () => {
      expect(normalizeRangeValue({ from: 5, to: 15 })).toEqual([ 5, 15 ]);
      expect(normalizeRangeValue({ from: 'start', to: 'end' })).toEqual([ 'start', 'end' ]);
    });

    it('should throw error for invalid formats', () => {
      expect(() => normalizeRangeValue('invalid')).toThrow();
      expect(() => normalizeRangeValue({ min: 1, max: 10 })).toThrow();
      expect(() => normalizeRangeValue([ 1 ])).toThrow();
    });
  });

  describe('coerceValue', () => {
    it('should coerce numeric strings for numeric operators', () => {
      expect(coerceValue('123', 'gt')).toBe(123);
      expect(coerceValue('45.67', 'lte')).toBe(45.67);
    });

    it('should not coerce for non-numeric operators', () => {
      expect(coerceValue('123', 'eq')).toBe('123');
      expect(coerceValue('test', 'contains')).toBe('test');
    });

    it('should not coerce non-numeric values', () => {
      expect(coerceValue('abc', 'gt')).toBe('abc');
      expect(coerceValue(true, 'gte')).toBe(true);
    });
  });

  describe('Constants', () => {
    it('should export PARSE_VALUE_DELIMITERS', () => {
      expect(PARSE_VALUE_DELIMITERS).toBeInstanceOf(RegExp);
      expect(PARSE_VALUE_DELIMITERS.test('test,value')).toBe(true);
      expect(PARSE_VALUE_DELIMITERS.test('test&value')).toBe(true);
    });

    it('should export FILTER_KEYS_HAVING_ARRAY_VALUES', () => {
      expect(Array.isArray(FILTER_KEYS_HAVING_ARRAY_VALUES)).toBe(true);
      expect(FILTER_KEYS_HAVING_ARRAY_VALUES).toContain('in');
      expect(FILTER_KEYS_HAVING_ARRAY_VALUES).toContain('contains');
      expect(FILTER_KEYS_HAVING_ARRAY_VALUES).toContain('notIn');
    });
  });
}); 