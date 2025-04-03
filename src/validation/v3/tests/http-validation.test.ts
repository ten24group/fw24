/**
 * Unit tests for HTTP validation
 */
import { HttpValidator, HttpValidationSchema, HttpRequest } from '../http';
import { required, equals, email, min, oneOf } from '../rules';

describe('HTTP Validation', () => {
  const httpValidator = new HttpValidator();

  // Create a schema for API endpoint that accepts a user creation
  const createUserHttpSchema: HttpValidationSchema = {
    headers: {
      fields: {
        'content-type': equals('application/json'),
        'x-api-key': required(),
      },
    },
    params: {
      fields: {
        userId: required(),
      },
    },
    query: {
      fields: {
        includeDetails: equals('true'),
      },
    },
    body: {
      fields: {
        username: required(),
        email: email(),
        age: min(18),
        role: oneOf(['user', 'admin']),
      },
    },
  };

  describe('Valid HTTP request', () => {
    it('validates a completely valid HTTP request', async () => {
      const validRequest: HttpRequest = {
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-api-key',
        },
        params: {
          userId: '123',
        },
        query: {
          includeDetails: 'true',
        },
        body: {
          username: 'johndoe',
          email: 'john@example.com',
          age: 25,
          role: 'user',
        },
      };

      const result = await httpValidator.validate(validRequest, createUserHttpSchema);
      expect(result.pass).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('validates when optional parts are not specified', async () => {
      // Modified schema without query validation
      const modifiedSchema: HttpValidationSchema = {
        headers: createUserHttpSchema.headers,
        params: createUserHttpSchema.params,
        body: createUserHttpSchema.body,
      };

      const requestWithoutQuery: HttpRequest = {
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-api-key',
        },
        params: {
          userId: '123',
        },
        query: {}, // Empty query
        body: {
          username: 'johndoe',
          email: 'john@example.com',
          age: 25,
          role: 'user',
        },
      };

      const result = await httpValidator.validate(requestWithoutQuery, modifiedSchema);
      expect(result.pass).toBe(true);
    });
  });

  describe('Invalid HTTP request', () => {
    it('validates headers correctly', async () => {
      const requestWithInvalidHeaders: HttpRequest = {
        headers: {
          'content-type': 'text/plain', // Invalid content type
          'x-api-key': 'valid-api-key',
        },
        params: {
          userId: '123',
        },
        query: {
          includeDetails: 'true',
        },
        body: {
          username: 'johndoe',
          email: 'john@example.com',
          age: 25,
          role: 'user',
        },
      };

      const result = await httpValidator.validate(requestWithInvalidHeaders, createUserHttpSchema);
      expect(result.pass).toBe(false);
      const headerError = result.errors?.find(err => err.path?.[0] === 'headers');
      expect(headerError).toBeDefined();
    });

    it('validates params correctly', async () => {
      const requestWithInvalidParams: HttpRequest = {
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-api-key',
        },
        params: {
          userId: '', // Empty user ID
        },
        query: {
          includeDetails: 'true',
        },
        body: {
          username: 'johndoe',
          email: 'john@example.com',
          age: 25,
          role: 'user',
        },
      };

      const result = await httpValidator.validate(requestWithInvalidParams, createUserHttpSchema);
      expect(result.pass).toBe(false);
      const paramError = result.errors?.find(err => err.path?.[0] === 'params');
      expect(paramError).toBeDefined();
    });

    it('validates query correctly', async () => {
      const requestWithInvalidQuery: HttpRequest = {
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-api-key',
        },
        params: {
          userId: '123',
        },
        query: {
          includeDetails: 'false', // Not 'true'
        },
        body: {
          username: 'johndoe',
          email: 'john@example.com',
          age: 25,
          role: 'user',
        },
      };

      const result = await httpValidator.validate(requestWithInvalidQuery, createUserHttpSchema);
      expect(result.pass).toBe(false);
      const queryError = result.errors?.find(err => err.path?.[0] === 'query');
      expect(queryError).toBeDefined();
    });

    it('validates body correctly', async () => {
      const requestWithInvalidBody: HttpRequest = {
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-api-key',
        },
        params: {
          userId: '123',
        },
        query: {
          includeDetails: 'true',
        },
        body: {
          username: 'johndoe',
          email: 'not-an-email', // Invalid email
          age: 16, // Too young
          role: 'superuser', // Invalid role
        },
      };

      const result = await httpValidator.validate(requestWithInvalidBody, createUserHttpSchema);
      expect(result.pass).toBe(false);

      // Should have multiple body errors
      const bodyErrors = result.errors?.filter(err => err.path?.[0] === 'body');
      expect(bodyErrors?.length).toBeGreaterThan(1);

      // Check for specific error fields
      expect(bodyErrors?.some(err => err.path?.includes('email'))).toBe(true);
      expect(bodyErrors?.some(err => err.path?.includes('age'))).toBe(true);
      expect(bodyErrors?.some(err => err.path?.includes('role'))).toBe(true);
    });

    it('reports all errors when collectErrors is true', async () => {
      const completelyInvalidRequest: HttpRequest = {
        headers: {
          'content-type': 'text/plain',
          // Missing x-api-key
        },
        params: {
          userId: '',
        },
        query: {
          includeDetails: 'false',
        },
        body: {
          username: '',
          email: 'not-an-email',
          age: 16,
          role: 'superuser',
        },
      };

      const result = await httpValidator.validate(completelyInvalidRequest, createUserHttpSchema);
      expect(result.pass).toBe(false);

      // All parts should have errors
      expect(result.errors?.some(err => err.path?.[0] === 'headers')).toBe(true);
      expect(result.errors?.some(err => err.path?.[0] === 'params')).toBe(true);
      expect(result.errors?.some(err => err.path?.[0] === 'query')).toBe(true);
      expect(result.errors?.some(err => err.path?.[0] === 'body')).toBe(true);

      // Multiple errors in total
      expect(result.errors?.length).toBeGreaterThan(4);
    });
  });
});
