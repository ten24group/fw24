/**
 * Unit tests for basic validation rules
 */
import {
  required,
  minLength,
  maxLength,
  matches,
  email,
  equals,
  notEquals,
  min,
  max,
  oneOf,
  notOneOf,
  custom,
} from '../rules';

describe('Basic validation rules', () => {
  describe('required', () => {
    const requiredRule = required();

    it('passes for valid values', async () => {
      expect((await requiredRule.validate('text')).pass).toBe(true);
      expect((await requiredRule.validate(0)).pass).toBe(true);
      expect((await requiredRule.validate(false)).pass).toBe(true);
      expect((await requiredRule.validate({})).pass).toBe(true);
      expect((await requiredRule.validate([])).pass).toBe(true);
    });

    it('fails for null or undefined', async () => {
      expect((await requiredRule.validate(null)).pass).toBe(false);
      expect((await requiredRule.validate(undefined)).pass).toBe(false);
    });
  });

  describe('minLength', () => {
    const rule = minLength(3);

    it('passes for strings with length >= min', async () => {
      expect((await rule.validate('abc')).pass).toBe(true);
      expect((await rule.validate('abcd')).pass).toBe(true);
    });

    it('fails for strings with length < min', async () => {
      expect((await rule.validate('ab')).pass).toBe(false);
      expect((await rule.validate('')).pass).toBe(false);
    });

    it('passes for arrays with length >= min', async () => {
      expect((await rule.validate([1, 2, 3])).pass).toBe(true);
      expect((await rule.validate([1, 2, 3, 4])).pass).toBe(true);
    });

    it('fails for arrays with length < min', async () => {
      expect((await rule.validate([1, 2])).pass).toBe(false);
      expect((await rule.validate([])).pass).toBe(false);
    });

    it('fails for null or undefined', async () => {
      expect((await rule.validate(null)).pass).toBe(false);
      expect((await rule.validate(undefined)).pass).toBe(false);
    });
  });

  describe('maxLength', () => {
    const rule = maxLength(3);

    it('passes for strings with length <= max', async () => {
      expect((await rule.validate('abc')).pass).toBe(true);
      expect((await rule.validate('ab')).pass).toBe(true);
      expect((await rule.validate('')).pass).toBe(true);
    });

    it('fails for strings with length > max', async () => {
      expect((await rule.validate('abcd')).pass).toBe(false);
    });

    it('passes for arrays with length <= max', async () => {
      expect((await rule.validate([1, 2, 3])).pass).toBe(true);
      expect((await rule.validate([1, 2])).pass).toBe(true);
      expect((await rule.validate([])).pass).toBe(true);
    });

    it('fails for arrays with length > max', async () => {
      expect((await rule.validate([1, 2, 3, 4])).pass).toBe(false);
    });

    it('fails for null or undefined', async () => {
      expect((await rule.validate(null)).pass).toBe(false);
      expect((await rule.validate(undefined)).pass).toBe(false);
    });
  });

  describe('matches', () => {
    const rule = matches(/^[a-z]+$/);

    it('passes for strings matching pattern', async () => {
      expect((await rule.validate('abc')).pass).toBe(true);
      expect((await rule.validate('abcdef')).pass).toBe(true);
    });

    it('fails for strings not matching pattern', async () => {
      expect((await rule.validate('123')).pass).toBe(false);
      expect((await rule.validate('abc123')).pass).toBe(false);
      expect((await rule.validate('ABC')).pass).toBe(false);
    });

    it('fails for null or undefined', async () => {
      expect((await rule.validate(null)).pass).toBe(false);
      expect((await rule.validate(undefined)).pass).toBe(false);
    });
  });

  describe('email', () => {
    const rule = email();

    it('passes for valid email addresses', async () => {
      expect((await rule.validate('test@example.com')).pass).toBe(true);
      expect((await rule.validate('user.name@domain.co.uk')).pass).toBe(true);
    });

    it('fails for invalid email addresses', async () => {
      expect((await rule.validate('not-an-email')).pass).toBe(false);
      expect((await rule.validate('missing@tld')).pass).toBe(false);
      expect((await rule.validate('@domain.com')).pass).toBe(false);
      expect((await rule.validate('user@')).pass).toBe(false);
    });

    it('fails for null or undefined', async () => {
      expect((await rule.validate(null)).pass).toBe(false);
      expect((await rule.validate(undefined)).pass).toBe(false);
    });
  });

  describe('equals', () => {
    it('passes for equal values', async () => {
      const stringRule = equals('test');
      const numberRule = equals(123);
      const boolRule = equals(true);

      expect((await stringRule.validate('test')).pass).toBe(true);
      expect((await numberRule.validate(123)).pass).toBe(true);
      expect((await boolRule.validate(true)).pass).toBe(true);
    });

    it('fails for non-equal values', async () => {
      const stringRule = equals('test');
      const numberRule = equals(123);
      const boolRule = equals(true);

      expect((await stringRule.validate('other')).pass).toBe(false);
      expect((await numberRule.validate(456)).pass).toBe(false);
      expect((await boolRule.validate(false)).pass).toBe(false);
    });
  });

  describe('notEquals', () => {
    it('passes for non-equal values', async () => {
      const stringRule = notEquals('test');
      const numberRule = notEquals(123);
      const boolRule = notEquals(true);

      expect((await stringRule.validate('other')).pass).toBe(true);
      expect((await numberRule.validate(456)).pass).toBe(true);
      expect((await boolRule.validate(false)).pass).toBe(true);
    });

    it('fails for equal values', async () => {
      const stringRule = notEquals('test');
      const numberRule = notEquals(123);
      const boolRule = notEquals(true);

      expect((await stringRule.validate('test')).pass).toBe(false);
      expect((await numberRule.validate(123)).pass).toBe(false);
      expect((await boolRule.validate(true)).pass).toBe(false);
    });
  });

  describe('min', () => {
    const rule = min(5);

    it('passes for numbers >= min', async () => {
      expect((await rule.validate(5)).pass).toBe(true);
      expect((await rule.validate(6)).pass).toBe(true);
      expect((await rule.validate(10)).pass).toBe(true);
    });

    it('fails for numbers < min', async () => {
      expect((await rule.validate(4)).pass).toBe(false);
      expect((await rule.validate(0)).pass).toBe(false);
      expect((await rule.validate(-1)).pass).toBe(false);
    });

    it('fails for null or undefined', async () => {
      expect((await rule.validate(null)).pass).toBe(false);
      expect((await rule.validate(undefined)).pass).toBe(false);
    });
  });

  describe('max', () => {
    const rule = max(5);

    it('passes for numbers <= max', async () => {
      expect((await rule.validate(5)).pass).toBe(true);
      expect((await rule.validate(4)).pass).toBe(true);
      expect((await rule.validate(0)).pass).toBe(true);
      expect((await rule.validate(-1)).pass).toBe(true);
    });

    it('fails for numbers > max', async () => {
      expect((await rule.validate(6)).pass).toBe(false);
      expect((await rule.validate(10)).pass).toBe(false);
    });

    it('fails for null or undefined', async () => {
      expect((await rule.validate(null)).pass).toBe(false);
      expect((await rule.validate(undefined)).pass).toBe(false);
    });
  });

  describe('oneOf', () => {
    const rule = oneOf(['red', 'green', 'blue']);

    it('passes for values in the set', async () => {
      expect((await rule.validate('red')).pass).toBe(true);
      expect((await rule.validate('green')).pass).toBe(true);
      expect((await rule.validate('blue')).pass).toBe(true);
    });

    it('fails for values not in the set', async () => {
      expect((await rule.validate('yellow')).pass).toBe(false);
      expect((await rule.validate('purple')).pass).toBe(false);
    });
  });

  describe('notOneOf', () => {
    const rule = notOneOf(['red', 'green', 'blue']);

    it('passes for values not in the set', async () => {
      expect((await rule.validate('yellow')).pass).toBe(true);
      expect((await rule.validate('purple')).pass).toBe(true);
    });

    it('fails for values in the set', async () => {
      expect((await rule.validate('red')).pass).toBe(false);
      expect((await rule.validate('green')).pass).toBe(false);
      expect((await rule.validate('blue')).pass).toBe(false);
    });
  });

  describe('custom', () => {
    const rule = custom<number>(value => value % 2 === 0, { message: 'Must be even' });

    it('passes for values meeting custom criteria', async () => {
      expect((await rule.validate(2)).pass).toBe(true);
      expect((await rule.validate(4)).pass).toBe(true);
      expect((await rule.validate(0)).pass).toBe(true);
    });

    it('fails for values not meeting custom criteria', async () => {
      expect((await rule.validate(1)).pass).toBe(false);
      expect((await rule.validate(3)).pass).toBe(false);
    });

    it('includes custom message for failed validation', async () => {
      const result = await rule.validate(1);
      expect(result.pass).toBe(false);
      expect(result.errors?.[0].message).toBe('Must be even');
    });
  });
});
