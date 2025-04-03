/**
 * HTTP Validation Demo
 * Demonstrates how to use the HTTP validation system
 */

import { ValidationRule } from '../core/types';
import { Validator } from '../core/validator';
import { required, email, minLength, pattern, min, max, createRule, RuleOptions } from '../functional/rules';
import { HttpValidationBuilder } from '../http/builder';
import { HttpValidator } from '../http/validator';
import { HttpValidationContext, Method } from '../http/types';

// Helper function to create strongly-typed validation rules for HTTP
function createHttpValidationRule<T>(
  validateFn: (value: T, context?: HttpValidationContext) => boolean | Promise<boolean>,
  options: RuleOptions<T, HttpValidationContext> = {},
): ValidationRule<unknown, HttpValidationContext> {
  return createRule<unknown, HttpValidationContext>(
    (value, context) => {
      // Cast value and context to the expected types
      const httpContext = context as unknown as HttpValidationContext;
      return validateFn(value as T, httpContext);
    },
    {
      message: options.message,
      messageId: options.messageId,
      expected: options.expected,
    },
  );
}

// Demo for HTTP validation
async function httpValidationDemo() {
  console.log('🌐 HTTP Validation Demo');

  // Create an HTTP validation schema for user creation API
  const userApiSchema = new HttpValidationBuilder()
    .forMethods('POST')
    .defineConditions({
      isAdmin: (context: HttpValidationContext) => {
        const authHeader = context.headers?.authorization;
        if (typeof authHeader === 'string') {
          return authHeader.startsWith('Bearer admin-');
        }
        return false;
      },
      isPremiumUser: (context: HttpValidationContext) => {
        const userType = context.headers?.['x-user-type'];
        return userType === 'premium';
      },
    })
    // Body validations
    .addBody(
      'username',
      createHttpValidationRule<string>(value => typeof value === 'string' && value.length >= 3, {
        message: 'Username must be at least 3 characters',
      }),
    )
    .addBody(
      'email',
      createHttpValidationRule<string>(
        value => typeof value === 'string' && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value),
        { message: 'Email must be valid' },
      ),
    )
    .addBody(
      'age',
      createHttpValidationRule<number>(value => typeof value === 'number' && value >= 18, {
        message: 'Age must be at least 18',
      }),
    )
    // Header validations
    .addHeader(
      'content-type',
      createHttpValidationRule<string>(value => value === 'application/json', {
        message: 'Content-Type must be application/json',
      }),
    )
    .addHeader(
      'authorization',
      createHttpValidationRule<string>(value => typeof value === 'string' && value.startsWith('Bearer '), {
        message: 'Authorization header must be a Bearer token',
      }),
    )
    // Parameter validations (for a URL like /users/:userId)
    .addParam(
      'userId',
      createHttpValidationRule<string>(value => typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value), {
        message: 'User ID must be a valid ID (24 hex characters)',
      }),
    )
    // Query validations
    .addQuery(
      'limit',
      createHttpValidationRule<string>(
        value => {
          const numValue = Number(value);
          return !isNaN(numValue) && numValue >= 1 && numValue <= 100;
        },
        { message: 'Limit must be between 1 and 100' },
      ),
    )
    .build();

  // Create HTTP validator
  const httpValidator = new HttpValidator({
    collectErrors: true,
    verboseErrors: true,
  });

  // Test request data
  const validRequest = {
    method: 'POST' as Method,
    url: '/users/5f8d0d55b54764421b51983c?limit=10',
    path: '/users/5f8d0d55b54764421b51983c',
    body: {
      username: 'johndoe',
      email: 'john@example.com',
      age: 25,
    },
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer token123',
      'x-user-type': 'premium',
    },
    params: {
      userId: '5f8d0d55b54764421b51983c',
    },
    query: {
      limit: '10',
    },
  };

  const invalidRequest = {
    method: 'POST' as Method,
    url: '/users/invalid?limit=200',
    path: '/users/invalid',
    body: {
      username: 'jo', // Too short
      email: 'not-an-email',
      age: 16, // Too young
    },
    headers: {
      'content-type': 'text/plain', // Wrong content type
      authorization: 'Basic auth', // Wrong auth type
    },
    params: {
      userId: 'invalid', // Not a valid ID
    },
    query: {
      limit: '200', // Exceeds max
    },
  };

  // Perform validations
  console.log('\nValidating valid request:');
  const validResult = await httpValidator.validate({
    method: validRequest.method,
    schema: userApiSchema,
    url: validRequest.url,
    path: validRequest.path,
    body: validRequest.body,
    headers: validRequest.headers,
    params: validRequest.params,
    query: validRequest.query,
  });
  console.log('Result:', validResult.pass ? 'PASS' : 'FAIL');

  console.log('\nValidating invalid request:');
  const invalidResult = await httpValidator.validate({
    method: invalidRequest.method,
    schema: userApiSchema,
    url: invalidRequest.url,
    path: invalidRequest.path,
    body: invalidRequest.body,
    headers: invalidRequest.headers,
    params: invalidRequest.params,
    query: invalidRequest.query,
  });
  console.log('Result:', invalidResult.pass ? 'PASS' : 'FAIL');
  if (!invalidResult.pass && invalidResult.errors) {
    console.log('Errors:');
    invalidResult.errors.forEach(error => {
      console.log(`- [${error.target}] ${error.path.join('.')}: ${error.message}`);
    });
  }
}

// Run the demo
httpValidationDemo().catch(console.error);
