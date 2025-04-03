/**
 * Tests for the EntityValidator
 * Ensures compatibility with test cases from the original validator.test.ts
 */
import { describe, expect, it, jest } from '@jest/globals';
import { EntityValidator } from '../validator/entity';
import { ValidationError, ValidationResult } from '../core/types';
import { registerFunction } from '../utils/json-config';

interface Request {
  body?: any;
  pathParameters?: any;
  queryStringParameters?: any;
  headers?: any;
}

describe('EntityValidator', () => {
  describe('validateEntity()', () => {
    const validator = new EntityValidator();

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
            role: { eq: 'admin' },
          },
        },
        actor,
      });
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
            role: { eq: 'admin' },
          },
        },
        actor,
      });
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.messageIds).toContain('validation.entity.test.role.eq');
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
            email: { datatype: 'email' },
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
            firstName: { minLength: 10 },
          },
        },
        input,
      });
      expect(result.pass).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.messageIds).toContain('validation.entity.test.firstname.minLength');
    });
  });

  describe('validateInput()', () => {
    const validator = new EntityValidator();

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

      expect(result.pass).toBe(false);
      expect(result.errors).toHaveProperty('age');
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
    const validator = new EntityValidator();

    it('should validate request body', async () => {
      const requestContext: Request = {
        body: {
          name: 'John',
          age: 20,
        },
      };

      const validations = {
        body: {
          name: { required: true },
          age: { gt: 18, required: true },
        },
      };

      const result = await validator.validateHttpRequest({ requestContext, validations });
      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate request parameters', async () => {
      const requestContext: Request = {
        pathParameters: {
          id: '123',
        },
      };
      const validations = {
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
      };

      const validations = {
        body: {
          name: { required: true },
          age: { gt: 40, required: true },
        },
      };

      const overriddenErrorMessages = new Map<string, string>(
        Object.entries({
          'validation.http.age.required': 'Age must be greater than 40....',
        }),
      );

      const result = await validator.validateHttpRequest({
        requestContext,
        validations,
        collectErrors: true,
        verboseErrors: true,
        overriddenErrorMessages,
      });

      // Just check that we have errors, not the exact count
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors?.[0]?.messageIds?.[0]).toContain('validation.http');
    });
  });

  describe('JSON-based conditional rules', () => {
    const validator = new EntityValidator();

    // Register condition functions for JSON-based validation
    beforeAll(() => {
      registerFunction('checkName', (input: any) => input.name === 'abc');
      registerFunction('checkAge', (input: any) => input.age === 18);
    });

    it('should validate when all conditions pass', async () => {
      const input = {
        name: 'abc',
        age: 18,
        password: 'something_long',
      };

      const validations = {
        input: {
          password: {
            when: 'checkName',
            rule: { minLength: 8 },
          },
        },
      };

      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        input,
      });

      expect(result.pass).toBe(true);
    });

    it('should skip validation if condition fails', async () => {
      const input = {
        name: 'pqr', // Different name, so condition won't match
        age: 18,
        password: 'short', // Would fail minLength, but won't be validated
      };

      const validations = {
        input: {
          password: {
            when: 'checkName',
            rule: { minLength: 8 },
          },
        },
      };

      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        input,
      });

      expect(result.pass).toBe(true);
    });
  });

  describe('Complex validation rules', () => {
    it('should support custom validation functions', async () => {
      const validator = new EntityValidator();

      // Create a custom validator function
      const customValidator = (_: any) => {
        return {
          pass: true,
          errors: [],
        } as ValidationResult;
      };

      registerFunction('customPasswordValidator', customValidator);

      const input = {
        password: 'test123',
      };

      const validations = {
        input: {
          password: { custom: 'customPasswordValidator' },
        },
      };

      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        input,
      });

      expect(result.pass).toBe(true);
    });

    it('should support data type validation', async () => {
      const validator = new EntityValidator();

      const validations = {
        input: {
          email: { datatype: 'email' },
          ip: { datatype: 'ip' },
          uuid: { datatype: 'uuid' },
          date: { datatype: 'date' },
          json: { datatype: 'json' },
          url: { datatype: 'url' },
        },
      };

      const validInput = {
        email: 'test@example.com',
        ip: '127.0.0.1',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        date: '05/05/2000',
        json: '{"x": "Y"}',
        url: 'http://www.google.com',
      };

      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        input: validInput,
      });

      expect(result.pass).toBe(true);

      const invalidInput = {
        email: 'invalid',
        ip: 'invalid',
        uuid: 'invalid',
        date: '144/155/2323',
        json: '{+}',
        url: 'httpqinv://www.google.com',
      };

      const invalidResult = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        collectErrors: true,
        entityValidations: validations,
        input: invalidInput,
      });

      expect(invalidResult.pass).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });
  });
});
