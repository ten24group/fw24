import { Request } from './../interfaces/request';
import {
  ComplexValidationRule,
  HttpRequestValidations,
  ConditionalValidationRule,
  MapOfValidationCondition,
  ValidationRule,
} from './types';

import { describe, expect, it } from '@jest/globals';
import { Validator } from './validator';

describe('Validator', () => {
  describe('validateEntity()', () => {
    const validator = new Validator();

    it('should return validation passed if no rules', async () => {
      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: {},
      });
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate actor rules', async () => {
      const actor = {
        role: 'admin',
      };
      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: {
          actor: {
            role: [{ eq: 'admin' }],
          },
        },
        actor,
      });
      console.warn('should validate actor rules result:', result);
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return actor rule errors', async () => {
      const actor = {
        role: 'user',
      };
      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        collectErrors: true,
        verboseErrors: true,
        entityValidations: {
          actor: {
            role: [{ eq: 'admin' }],
          },
        },
        actor,
      });
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.messageIds).toContain('validation.entity.test.actor.role.eq.admin');
    });

    it('should validate input rules', async () => {
      const input = {
        email: 'test@example.com',
      };
      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: {
          input: {
            email: [{ datatype: 'email' }],
          },
        },
        input,
      });
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return input rule errors', async () => {
      const input = {
        firstName: 'xxx',
      };
      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        collectErrors: true,
        verboseErrors: true,
        entityValidations: {
          input: {
            firstName: [{ minLength: 10 }],
          },
        },
        input,
      });
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.messageIds).toContain('validation.entity.test.firstname.minlength');
    });
  });

  describe('validateInput()', () => {
    const validator = new Validator();

    it('should return passed result when input passes validation', async () => {
      const input = {
        name: 'John',
        age: 30,
      };
      const rules = {
        name: { required: true },
        age: { gt: 18 },
      };
      const result = await validator.validateInput(input, rules);

      expect(result.pass).toBe(true);
      expect(result.errors).toEqual({});
    });

    it('should return failed result when input fails validation', async () => {
      const input = {
        name: 'John',
      };
      const rules = {
        name: { required: true },
        age: { gt: 18, required: true },
      };

      const result = await validator.validateInput(input, rules);

      console.log({ result });

      expect(result.pass).toBe(false);
      expect(result.errors).toEqual({
        age: expect.any(Array),
      });
    });

    it('should not collect errors when collectErrors is false', async () => {
      const input = {
        name: 'John',
      };
      const rules = {
        name: { required: true },
        age: { gt: 18 },
      };

      const result = await validator.validateInput(input, rules, false);

      expect(result.errors).toEqual({});
    });
  });

  describe('validateHttpRequest()', () => {
    const validator = new Validator();

    it('should validate request body', async () => {
      const requestContext: Request = {
        body: {
          name: 'John',
          age: 20,
        },
      } as Request;

      const validations: HttpRequestValidations = {
        body: {
          name: { required: true },
          age: { gt: 18, required: true },
        },
      };

      const result = await validator.validateHttpRequest({ requestContext, validations });
      console.log(result);
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate request parameters', async () => {
      const requestContext: Request = {
        pathParameters: {
          id: '123',
        },
      } as unknown as Request;
      const validations: HttpRequestValidations = {
        param: {
          id: { required: true },
        },
      };

      const result = await validator.validateHttpRequest({ requestContext, validations });

      expect(result.pass).toBe(true);
    });

    it('should collect errors for failed validations', async () => {
      const requestContext: Request = {
        body: {
          name: 'John',
        },
      } as Request;

      const validations: HttpRequestValidations = {
        body: {
          name: { required: true },
          age: { gt: 40, required: true },
        },
      };

      const overriddenErrorMessages = new Map<string, string>(
        Object.entries({
          'validation.http.body.age.gt': 'Age must be greater than 40....',
        }),
      );

      const result = await validator.validateHttpRequest({
        requestContext,
        validations,
        collectErrors: true,
        verboseErrors: true,
        overriddenErrorMessages,
      });

      console.log({ result });

      expect(result.errors).toEqual(expect.any(Array));
      expect(result.errors).toHaveLength(2);
      expect(result.errors?.[0]?.messageIds).toContain('validation.http.body.age.gt');
    });
  });

  describe('validateConditionalRules()', () => {
    const validator = new Validator();
    const allConditions: MapOfValidationCondition = {
      condition1: {
        input: {
          name: { eq: 'abc' },
        },
      },
      condition2: {
        input: {
          age: { eq: 18 },
        },
      },
    };

    it('should validate rules when all conditions pass', async () => {
      const rules: ConditionalValidationRule<any, any>[] = [
        {
          minLength: 8,
          conditions: [['condition1', 'condition2'], 'all'],
        },
      ];

      const result = await validator.validateConditionalRules({
        rules,
        allConditions,
        inputVal: 'something_long',
        input: {
          name: 'abc',
          age: 18,
        },
      });

      expect(result.pass).toBe(true);

      const result_fail = await validator.validateConditionalRules({
        rules,
        allConditions,
        inputVal: 'sort',
        input: {
          name: 'abc',
          age: 18,
        },
      });
      console.log(result_fail);
      expect(result_fail.pass).toBe(false);
    });

    it('should skip validation if any condition fails when scope is "all"', async () => {
      const rules: ConditionalValidationRule<any, any>[] = [
        {
          minLength: 8,
          conditions: [['condition1', 'condition2'], 'all'],
        },
      ];

      const result = await validator.validateConditionalRules({
        rules,
        allConditions,
        inputVal: 'sort', // validation should have failed for this input
        input: {
          name: 'pqr', // the condition won't be applied for this input
          age: 18,
        },
      });

      expect(result.pass).toBe(true);
    });

    it('should validate if any condition fails when scope is "any"', async () => {
      const rules: ConditionalValidationRule<any, any>[] = [
        {
          minLength: 8,
          conditions: [['condition1', 'condition2'], 'any'],
        },
      ];

      const result = await validator.validateConditionalRules({
        rules,
        allConditions,
        inputVal: 'sort',
        input: {
          name: 'pqr',
          age: 18,
        },
      });

      expect(result.pass).toBe(false);
    });

    it('should skip validation if any condition passes when scope is "none"', async () => {
      const rules: ConditionalValidationRule<any, any>[] = [
        {
          minLength: 8,
          conditions: [['condition1', 'condition2'], 'none'],
        },
      ];

      const result = await validator.validateConditionalRules({
        rules,
        allConditions,
        inputVal: 'sort', // invalid input
        input: {
          name: 'pqr',
          age: 18,
        },
      });

      expect(result.pass).toBe(true);
    });

    it('should validate when all condition fail; when scope is "none"', async () => {
      const rules: ConditionalValidationRule<any, any>[] = [
        {
          minLength: 8,
          conditions: [['condition1', 'condition2'], 'none'],
        },
      ];

      const result = await validator.validateConditionalRules({
        rules,
        allConditions,
        inputVal: 'sort', // invalid input
        input: {
          name: 'pqr',
          age: 24,
        },
      });

      expect(result.pass).toBe(false);
    });
  });

  describe('validateConditionalRule()', () => {
    const CONDITION: MapOfValidationCondition<any, object> = {
      actorIs123: {
        actor: {
          actorId: { eq: '123' },
        },
      },
    } as const;

    it('should validate rules if criteria rules pass', async () => {
      const validator = new Validator();

      const validationRule: ConditionalValidationRule<any, typeof CONDITION> = {
        conditions: [['actorIs123'], 'all'],
        minLength: 10,
      };

      const actor = {
        actorId: '123',
      };

      const result = await validator.validateConditionalRule({
        rule: validationRule,
        allConditions: CONDITION,
        inputVal: 'input',
        input: {},
        record: {},
        actor: actor,
      });

      // console.warn(JSON.stringify({result}));
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.messageIds).toContain('minlength');
    });

    it('should skip validation if criteria rules fail', async () => {
      const validator = new Validator();

      const validationRule: ConditionalValidationRule<any, typeof CONDITION> = {
        conditions: [['actorIs123'], 'all'],
        minLength: 5,
      };

      const actor = {
        actorId: '456',
      };

      const result = await validator.validateConditionalRule({
        rule: validationRule,
        allConditions: CONDITION,
        inputVal: 'in',
        input: {},
        record: {},
        actor: actor,
      });

      expect(result.pass).toBe(true);
      expect(result.errors).toBe(undefined);
    });
  });

  describe('testComplexValidationRule', () => {
    it('should call custom validator if provided', async () => {
      const validator = new Validator();
      const customValidator = jest.fn().mockResolvedValue({
        pass: true,
      });

      const rule: ComplexValidationRule<string> = {
        validator: customValidator,
      };

      const value = 'test';

      const result = await validator.testComplexValidationRule(rule, value);

      expect(customValidator).toHaveBeenCalledWith(value, true);
      expect(result.pass).toBe(true);
    });

    it('should call default validator if custom not provided', async () => {
      const validator = new Validator();
      const defaultValidator = jest.fn().mockResolvedValue({
        pass: false,
        errors: ['Error!'],
      });

      validator.testValidationRule = defaultValidator;

      const rule: ValidationRule<string> = {
        maxLength: 5,
      };

      const value = 'test';

      const result = await validator.testComplexValidationRule(rule, value);

      expect(defaultValidator).toHaveBeenCalledWith(rule, value, true);
      expect(result.pass).toBe(false);
      expect(result.errors).toEqual(['Error!']);
    });

    it('should use custom message if provided', async () => {
      const validator = new Validator();
      const rule: ComplexValidationRule<string> = {
        message: 'Custom error',
      };

      const value = 'test';

      const result = await validator.testComplexValidationRule(rule, value);

      expect(result.customMessage).toBe('Custom error');
    });
  });

  describe('testValidationRule()', () => {
    it('should return validation passed if no rules', async () => {
      const validator = new Validator();
      const result = await validator.testValidationRule({}, 'test');
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return validation errors if rules fail', async () => {
      const validator = new Validator();
      const partialValidation = {
        required: true,
      };
      const result = await validator.testValidationRule(partialValidation, undefined);
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('should collect multiple validation errors', async () => {
      const validator = new Validator();
      const partialValidation = {
        required: true,
        minLength: 5,
        maxLength: 2,
      };
      const result = await validator.testValidationRule(partialValidation, 'abc');
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('testComplexValidation', () => {
    it('should call validator function if provided', async () => {
      const validator = new Validator();
      const validatorFn = jest.fn().mockResolvedValue({ pass: true });
      const validationName = 'custom';
      const validationValue = { validator: validatorFn };
      const val = 'test';

      const result = await validator.testComplexValidation(validationName, validationValue, val as any);

      expect(validatorFn).toHaveBeenCalledWith(val);
      expect(result).toEqual({ pass: true });
    });

    it('should call testValidation if no validator provided', async () => {
      const validator = new Validator();
      const testValidationFn = jest.fn().mockResolvedValue({ pass: false });
      validator.testValidation = testValidationFn;

      const validationName = 'maxLength';
      const validationValue = { value: 5, message: 'custom msg' };
      const val = 'test';

      const result = await validator.testComplexValidation(validationName, validationValue, val as any);

      expect(testValidationFn).toHaveBeenCalledWith(validationName, validationValue.value, val);
      expect(result).toEqual({ pass: false, customMessage: 'custom msg' });
    });

    it('should set custom message if provided', async () => {
      const validator = new Validator();

      const validationName = 'maxLength';
      const message = 'Custom error message';
      const validationValue = { value: 5, message };
      const val = 'test';

      const result = await validator.testComplexValidation(validationName, validationValue, val as any);

      expect(result.customMessage).toEqual(message);
    });
  });

  describe('testValidation()', () => {
    const validator = new Validator();

    it('should validate required', async () => {
      const result_false = await validator.testValidation('required', true, undefined);
      expect(result_false.pass).toBe(false);

      const result_true = await validator.testValidation('required', true, '');
      expect(result_true.pass).toBe(true);
    });

    it('should validate minLength', async () => {
      const result_false = await validator.testValidation('minLength', 5, 'abc');
      expect(result_false.pass).toBe(false);

      const result_true = await validator.testValidation('minLength', 3, 'abc');
      expect(result_true.pass).toBe(true);
    });

    it('should validate maxLength', async () => {
      const result_false = await validator.testValidation('maxLength', 5, 'abcdef');
      expect(result_false.pass).toBe(false);

      const result_true = await validator.testValidation('maxLength', 6, 'abcdef');
      expect(result_true.pass).toBe(true);
    });

    it('should validate pattern', async () => {
      const result = await validator.testValidation('pattern', /^[0-9]+$/, 'abc123');
      expect(result.pass).toBe(false);

      const result2 = await validator.testValidation('pattern', /^[0-9]+$/, '12323232323');
      expect(result2.pass).toBe(true);
    });

    it('should validate datatype', async () => {
      const result = await validator.testValidation('datatype', 'number', '123');
      expect(result.pass).toBe(true);
    });

    describe('validate data types', () => {
      it('validates email', async () => {
        const result = await validator.testValidation('datatype', 'email', 'test@example.com');
        expect(result.pass).toBe(true);

        const result2 = await validator.testValidation('datatype', 'email', 'invalid');
        expect(result2.pass).toBe(false);
      });

      it('validates IP address', async () => {
        const result = await validator.testValidation('datatype', 'ip', '127.0.0.1');
        console.log(result);
        expect(result.pass).toBe(true);

        const result2 = await validator.testValidation('datatype', 'ip', 'invalid');
        console.log(result2);
        expect(result2.pass).toBe(false);
      });

      it('validates IPv4 address', async () => {
        const result = await validator.testValidation('datatype', 'ipv4', '127.0.0.1');
        expect(result.pass).toBe(true);

        const result2 = await validator.testValidation('datatype', 'ipv4', '2001:db8::1');
        expect(result2.pass).toBe(false);
      });

      it('validates IPv6 address', async () => {
        const result = await validator.testValidation('datatype', 'ipv6', '2001:db8::1');
        expect(result.pass).toBe(true);

        const result2 = await validator.testValidation('datatype', 'ipv6', '127.0.0.1');
        expect(result2.pass).toBe(false);
      });

      it('validates UUID', async () => {
        const result = await validator.testValidation('datatype', 'uuid', '123e4567-e89b-12d3-a456-426614174000');
        expect(result.pass).toBe(true);

        const result2 = await validator.testValidation('datatype', 'uuid', 'invalid');
        expect(result2.pass).toBe(false);
      });

      it('validates JSON', async () => {
        const result = await validator.testValidation('datatype', 'json', '{"x": "Y"}');
        expect(result.pass).toBe(true);

        const result2 = await validator.testValidation('datatype', 'json', '{+}');
        expect(result2.pass).toBe(false);
      });

      it('validates HttpURL', async () => {
        const result = await validator.testValidation('datatype', 'httpUrl', 'http://www.google.com');
        expect(result.pass).toBe(true);

        const result2 = await validator.testValidation('datatype', 'httpUrl', 'httpqinv://www.google.com');
        expect(result2.pass).toBe(false);
      });

      it('validates Date', async () => {
        const result = await validator.testValidation('datatype', 'date', '05/05/2000');
        expect(result.pass).toBe(true);

        const result2 = await validator.testValidation('datatype', 'date', '144/155/2323');
        expect(result2.pass).toBe(false);
      });
    });

    it('should validate equality', async () => {
      const result_eq = await validator.testValidation('eq', 'abc', 'abc');
      expect(result_eq.pass).toBe(true);

      const result_neq = await validator.testValidation('neq', 'abc', 'xxxx');
      expect(result_neq.pass).toBe(true);

      const result_gt = await validator.testValidation('gt', 3232, 445454);
      expect(result_gt.pass).toBe(true);

      const result_gte = await validator.testValidation('gte', 3232, 3232);
      expect(result_gte.pass).toBe(true);

      const result_lt = await validator.testValidation('lt', 445454, 3232);
      expect(result_lt.pass).toBe(true);

      const result_lte = await validator.testValidation('lte', 3232, 3232);
      expect(result_lte.pass).toBe(true);
    });

    it('should validate lists', async () => {
      const result_inList = await validator.testValidation('inList', ['a', 'b'], 'b');
      expect(result_inList.pass).toBe(true);

      const result_notInList = await validator.testValidation('notInList', ['a', 'b'], 'c');
      expect(result_notInList.pass).toBe(true);
    });
  });
});
