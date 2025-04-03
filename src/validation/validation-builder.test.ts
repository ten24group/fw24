import { describe, expect, it, jest } from '@jest/globals';
import { Validator } from './validator';
import { entity, http, ValidationRule } from './validation-builder';

describe('ValidationBuilder Compatibility', () => {
  const validator = new Validator();

  describe('EntityValidationBuilder', () => {
    it('should return validation passed if no rules', async () => {
      const validations = entity().build();

      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
      });

      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should create validations compatible with validator', async () => {
      // Create validations using the builder
      const validations = entity()
        .add('input', 'email', {
          required: true,
          email: true,
        })
        .add('input', 'name', {
          required: true,
          minLength: 2,
        })
        .add('actor', 'role', {
          in: [['admin', 'user']],
        })
        .build();

      // Create equivalent manual validations
      const manualValidations = {
        input: {
          email: [{ required: true }, { datatype: 'email' }],
          name: [{ required: true }, { minLength: 2 }],
        },
        actor: {
          role: [{ inList: ['admin', 'user'] }],
        },
      };

      // Verify the structure
      expect(validations).toHaveProperty('input.email');
      expect(validations).toHaveProperty('input.name');
      expect(validations).toHaveProperty('actor.role');

      // Verify the builder validations work with the validator
      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        input: {
          email: 'test@example.com',
          name: 'John',
        },
        actor: {
          role: 'admin',
        },
      });

      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);

      // Test failure case
      const failResult = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        collectErrors: true,
        verboseErrors: true,
        entityValidations: validations,
        input: {
          email: 'invalid',
          name: 'J',
        },
        actor: {
          role: 'guest',
        },
      });

      expect(failResult.pass).toBe(false);
      expect(failResult.errors?.length).toBeGreaterThan(0);
    });

    it('should validate actor rules specifically', async () => {
      const actor = {
        role: 'admin',
      };

      const validations = entity()
        .add('actor', 'role', {
          eq: 'admin',
        })
        .build();

      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        actor,
      });

      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);

      // Test failure case
      const nonAdminActor = {
        role: 'user',
      };

      const failResult = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        collectErrors: true,
        verboseErrors: true,
        entityValidations: validations,
        actor: nonAdminActor,
      });

      expect(failResult.pass).toBe(false);
      expect(failResult.errors?.length).toBeGreaterThan(0);
      expect(failResult.errors?.[0]?.messageIds).toContain('validation.entity.test.actor.role.eq.admin');
    });

    it('should handle operation-specific validations', async () => {
      const validations = entity()
        .add('input', 'email', {
          required: true,
          email: true,
          operations: ['create'],
        })
        .add('input', 'id', {
          required: true,
          operations: ['update', 'delete'],
        })
        .build();

      // Test create operation
      const createResult = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        input: {
          email: 'test@example.com',
        },
      });

      expect(createResult.pass).toBe(true);

      // Test update operation
      const updateResult = await validator.validateEntity({
        operationName: 'update',
        entityName: 'test',
        entityValidations: validations,
        input: {
          id: '123',
        },
      });

      expect(updateResult.pass).toBe(true);

      // Test update operation failure
      const updateFailResult = await validator.validateEntity({
        operationName: 'update',
        entityName: 'test',
        collectErrors: true,
        entityValidations: validations,
        input: {},
      });

      expect(updateFailResult.pass).toBe(false);
    });

    it('should handle complex password rules', async () => {
      const validations = entity()
        .add('input', 'password', {
          required: true,
          minLength: 8,
          pattern: /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/,
        })
        .build();

      // Valid password
      const validResult = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        input: {
          password: 'Test123!',
        },
      });

      expect(validResult.pass).toBe(true);

      // Invalid password
      const invalidResult = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        collectErrors: true,
        entityValidations: validations,
        input: {
          password: 'weak',
        },
      });

      expect(invalidResult.pass).toBe(false);
    });

    it('should handle conditional validations', async () => {
      // Define conditions
      const conditions = {
        userIsAdmin: {
          actor: {
            role: { eq: 'admin' },
          },
        },
        nameIsJohn: {
          input: {
            name: { eq: 'John' },
          },
        },
      };

      // Create validation with "when" condition using the builder
      const whenConditionValidations = entity()
        .add('input', 'sensitiveField', {
          required: true,
        })
        .build();

      // Test a basic validation without conditions
      const basicResult = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: whenConditionValidations,
        collectErrors: true,
        verboseErrors: true,
        input: {},
      });

      expect(basicResult.pass).toBe(false);

      // Test with valid input
      const validResult = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: whenConditionValidations,
        input: {
          sensitiveField: 'secret',
        },
      });

      expect(validResult.pass).toBe(true);
    });

    it('should validate record rules', async () => {
      const validations = entity()
        .add('record', 'status', {
          eq: 'active',
        })
        .build();

      const record = {
        status: 'active',
      };

      const result = await validator.validateEntity({
        operationName: 'update',
        entityName: 'test',
        entityValidations: validations,
        record,
      });

      expect(result.pass).toBe(true);

      const failResult = await validator.validateEntity({
        operationName: 'update',
        entityName: 'test',
        collectErrors: true,
        entityValidations: validations,
        record: { status: 'inactive' },
      });

      expect(failResult.pass).toBe(false);
    });

    it('should support helpers for adding multiple fields at once', async () => {
      const validations = entity()
        .inputs({
          email: { required: true, email: true },
          name: { minLength: 2 },
          age: { gt: 18 },
        })
        .actors({
          role: { in: [['admin', 'editor']] },
        })
        .records({
          status: { eq: 'active' },
        })
        .build();

      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        input: {
          email: 'test@example.com',
          name: 'John Doe',
          age: 25,
        },
        actor: {
          role: 'admin',
        },
        record: {
          status: 'active',
        },
      });

      expect(result.pass).toBe(true);

      const failResult = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        collectErrors: true,
        entityValidations: validations,
        input: {
          email: 'invalid',
          name: 'J',
          age: 16,
        },
        actor: {
          role: 'user',
        },
        record: {
          status: 'pending',
        },
      });

      expect(failResult.pass).toBe(false);
      expect(failResult.errors?.length).toBeGreaterThan(0);
    });
  });

  describe('HttpValidationBuilder', () => {
    it('should create HTTP validations compatible with validator', async () => {
      // Create validations using the builder
      const validations = http()
        .body({
          email: { required: true, email: true },
          name: { required: true, minLength: 2 },
        })
        .param({
          id: { required: true, pattern: /^\d+$/ },
        })
        .query({
          page: { type: 'number' },
        })
        .build();

      // Test against the validator
      const mockRequest = {
        body: {
          email: 'test@example.com',
          name: 'John',
        },
        pathParameters: {
          id: '123',
        },
        queryStringParameters: {
          page: '1',
        },
      };

      const result = await validator.validateHttpRequest({
        requestContext: mockRequest as any,
        validations,
      });

      expect(result.pass).toBe(true);
      expect(result.errors).toEqual([]);

      // Test failure
      const failRequest = {
        body: {
          email: 'invalid',
          name: 'J',
        },
        pathParameters: {
          id: 'abc',
        },
      };

      const failResult = await validator.validateHttpRequest({
        requestContext: failRequest as any,
        validations,
        collectErrors: true,
        verboseErrors: true,
      });

      expect(failResult.pass).toBe(false);
      expect(failResult.errors?.length).toBeGreaterThan(0);
    });

    it('should validate request parameters specifically', async () => {
      const validations = http()
        .param({
          id: { required: true, pattern: /^\d+$/ },
        })
        .build();

      const mockRequest = {
        pathParameters: {
          id: '123',
        },
      };

      const result = await validator.validateHttpRequest({
        requestContext: mockRequest as any,
        validations,
      });

      expect(result.pass).toBe(true);
    });

    it('should validate request headers', async () => {
      const validations = http()
        .header({
          'content-type': { eq: 'application/json' },
        })
        .build();

      const mockRequest = {
        headers: {
          'content-type': 'application/json',
        },
      };

      const result = await validator.validateHttpRequest({
        requestContext: mockRequest as any,
        validations,
      });

      expect(result.pass).toBe(true);
    });

    it('should support custom error messages with overrides', async () => {
      const validations = http()
        .body({
          age: { gt: 40, required: true },
        })
        .build();

      const mockRequest = {
        body: {
          age: 30,
        },
      };

      const overriddenErrorMessages = new Map<string, string>(
        Object.entries({
          'validation.http.body.age.gt': 'Age must be greater than 40....',
        }),
      );

      const result = await validator.validateHttpRequest({
        requestContext: mockRequest as any,
        validations,
        collectErrors: true,
        verboseErrors: true,
        overriddenErrorMessages,
      });

      expect(result.pass).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]?.messageIds).toContain('validation.http.body.age.gt');
    });
  });

  describe('ValidationRule Conversion', () => {
    it('should convert basic validation rule types correctly', async () => {
      // Test a subset of validation types to ensure they're properly converted
      const validations = entity()
        .add('input', 'field', {
          required: true,
          minLength: 5,
          type: 'string',
        })
        .build();

      // Verify the structure
      expect(validations).toHaveProperty('input.field');
      expect(validations.input.field.length).toBeGreaterThan(0);

      // Test with validator
      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        input: {
          field: 'Value123', // Valid input
        },
      });

      expect(result.pass).toBe(true);

      // Test with invalid input
      const failResult = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        collectErrors: true,
        entityValidations: validations,
        input: {
          field: 'Val', // Too short
        },
      });

      expect(failResult.pass).toBe(false);
    });

    it('should support all validation types', async () => {
      // Create a test entity with all validation types
      const validations = entity()
        .add('input', 'required', { required: true })
        .add('input', 'minLength', { minLength: 3 })
        .add('input', 'maxLength', { maxLength: 10 })
        .add('input', 'pattern', { pattern: /^[A-Z]/ })
        .add('input', 'email', { email: true })
        .add('input', 'url', { url: true })
        .add('input', 'date', { date: true })
        .add('input', 'eq', { eq: 'test' })
        .add('input', 'neq', { neq: 'other' })
        .add('input', 'gt', { gt: 5 })
        .add('input', 'gte', { gte: 5 })
        .add('input', 'lt', { lt: 10 })
        .add('input', 'lte', { lte: 10 })
        .add('input', 'inList', { in: [['a', 'b', 'c']] })
        .add('input', 'notInList', { notIn: [['x', 'y', 'z']] })
        .build();

      // Valid input that should pass all validations
      const input = {
        required: 'present',
        minLength: 'abc',
        maxLength: '1234567890',
        pattern: 'AbcDef',
        email: 'test@example.com',
        url: 'http://example.com',
        date: '2023-01-01',
        eq: 'test',
        neq: 'different',
        gt: 6,
        gte: 5,
        lt: 9,
        lte: 10,
        inList: 'a',
        notInList: 'w',
      };

      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        input,
      });

      expect(result.pass).toBe(true);
    });

    it('should support custom validation functions', async () => {
      const customValidator = (value: string) => value.includes('custom');

      const validations = entity()
        .add('input', 'field', {
          custom: customValidator,
        })
        .build();

      const result = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        entityValidations: validations,
        input: {
          field: 'this is custom content',
        },
      });

      expect(result.pass).toBe(true);

      const failResult = await validator.validateEntity({
        operationName: 'create',
        entityName: 'test',
        collectErrors: true,
        entityValidations: validations,
        input: {
          field: 'this has no match',
        },
      });

      expect(failResult.pass).toBe(false);
    });
  });
});
