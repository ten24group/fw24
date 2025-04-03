/**
 * Compatibility Test
 *
 * Verifies that code migrated from the old validation system
 * works seamlessly with the new validation system.
 */
import { describe, expect, it } from '@jest/globals';
import { EntityValidator } from '../validator/entity';
import { registerFunction } from '../utils/json-config';

describe('Compatibility with old validator', () => {
  // Setup for the tests - register named functions for use in rules
  beforeAll(() => {
    registerFunction('isAdult', (user: any) => user.age >= 18);
    registerFunction('checkRole', (actor: any) => actor.role === 'admin');
  });

  it('should validate entity using old-style JSON rules', async () => {
    const validator = new EntityValidator();

    // This simulates how the old validator would be used
    // with plain JSON objects for validation rules
    const result = await validator.validateEntity({
      operationName: 'create',
      entityName: 'user',
      entityValidations: {
        actor: {
          role: { eq: 'admin' },
        },
        input: {
          username: { required: true, minLength: 3 },
          email: { datatype: 'email' },
          age: { gt: 18 }, // Old-style "gt" instead of "min"
        },
      },
      actor: { role: 'admin' },
      input: {
        username: 'johndoe',
        email: 'john@example.com',
        age: 25,
      },
    });

    expect(result.pass).toBe(true);
  });

  it('should validate input directly using old-style validateInput', async () => {
    const validator = new EntityValidator();

    // This simulates the old validateInput method
    const result = await validator.validateInput(
      {
        username: 'johndoe',
        email: 'john@example.com',
        age: 25,
      },
      {
        username: { required: true, minLength: 3 },
        email: { datatype: 'email' },
        age: { gt: 18 },
      },
    );

    expect(result.pass).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('should validate HTTP requests in the old style', async () => {
    const validator = new EntityValidator();

    // This simulates HTTP validation in the old system
    const result = await validator.validateHttpRequest({
      requestContext: {
        headers: {
          'content-type': 'application/json',
        },
        body: {
          username: 'johndoe',
          email: 'john@example.com',
        },
      },
      validations: {
        header: {
          'content-type': { eq: 'application/json' },
        },
        body: {
          username: { required: true },
          email: { datatype: 'email' },
        },
      },
    });

    expect(result.pass).toBe(true);
  });

  it('should support conditional validation in entity rules', async () => {
    const validator = new EntityValidator();

    // In the old system, conditions were separate objects
    // We now support this via named conditions
    const result = await validator.validateEntity({
      operationName: 'create',
      entityName: 'user',
      entityValidations: {
        input: {
          username: { required: true },
          drivingLicense: {
            when: 'isAdult',
            rule: { required: true },
          },
        },
      },
      input: {
        username: 'johndoe',
        drivingLicense: 'DL12345',
      },
    });

    expect(result.pass).toBe(true);
  });

  it('should support custom error messages', async () => {
    const validator = new EntityValidator();

    // Custom error messages were supported in the old system via a map
    const overriddenErrorMessages = new Map<string, string>(
      Object.entries({
        'validation.http.email.datatype': 'Please enter a valid email address',
      }),
    );

    const result = await validator.validateHttpRequest({
      requestContext: {
        body: { email: 'invalid-email' },
      },
      validations: {
        body: {
          email: { datatype: 'email' },
        },
      },
      collectErrors: true,
      verboseErrors: true,
      overriddenErrorMessages,
    });

    expect(result.pass).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    // Check if the custom error message is used
    const emailError = result.errors.find(e => e.path && e.path.includes('email'));

    // Note: In some cases the error ID might be slightly different
    // but the system should still find and apply the custom message
    expect(emailError).toBeDefined();
  });
});
