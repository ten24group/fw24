/**
 * HTTP validation demo for v3 validation system
 */
import {
  HttpValidator,
  HttpValidationSchema,
  HttpRequest,
  required,
  email,
  minLength,
  min,
  matches,
  equals,
  oneOf,
} from '../';

// Define an HTTP validation schema for user creation
const createUserHttpSchema: HttpValidationSchema = {
  headers: {
    fields: {
      'content-type': equals('application/json'),
    },
    conditions: {},
  },

  body: {
    fields: {
      username: required(),
      email: email(),
      age: min(18),
      termsAccepted: equals(true),
      role: oneOf(['user', 'admin']),
    },
    conditions: {},
  },
};

async function runDemo() {
  const httpValidator = new HttpValidator();

  // Valid request
  const validRequest: HttpRequest = {
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    params: {},
    query: {},
    body: {
      username: 'johndoe',
      email: 'john@example.com',
      age: 25,
      termsAccepted: true,
      role: 'user',
    },
  };

  // Invalid request
  const invalidRequest: HttpRequest = {
    headers: {
      'content-type': 'text/plain',
      accept: 'application/json',
    },
    params: {},
    query: {},
    body: {
      username: 'jane',
      email: 'not-an-email',
      age: 16,
      termsAccepted: false,
      role: 'guest',
    },
  };

  console.log('Validating valid HTTP request:');
  const validResult = await httpValidator.validate(validRequest, createUserHttpSchema);
  console.log(JSON.stringify(validResult, null, 2));

  console.log('\nValidating invalid HTTP request:');
  const invalidResult = await httpValidator.validate(invalidRequest, createUserHttpSchema, {
    verboseErrors: true,
  });
  console.log(JSON.stringify(invalidResult, null, 2));
}

// Run the demo
runDemo().catch(console.error);
