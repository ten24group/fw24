/**
 * JSON-based and Entity Validation Demo for v3 validation system
 *
 * This demo showcases:
 * - Using JSON-based validation rules (similar to the old validator)
 * - Entity validation with actor, input, and record
 */
import { EntityValidator } from '../validator/entity';
import { Validator } from '../';
import { registerFunction, parseJsonSchema, clearRegisteredFunctions } from '../utils/json-config';

// ----------------------------------------------------------
// Clear any existing functions and register new ones
// ----------------------------------------------------------
clearRegisteredFunctions();

// Register functions for JSON-based validation
registerFunction('isAdult', (user: any) => user.age >= 18);
registerFunction('passwordsMatch', (user: any, confirmPassword: string) => {
  console.log('Checking passwords match:', user.password, confirmPassword);
  return user.password === confirmPassword;
});
registerFunction('checkRole', (actor: any) => actor.role === 'admin');

// ----------------------------------------------------------
// 1. JSON-based User Validation
// ----------------------------------------------------------
async function jsonBasedValidationDemo() {
  console.log('\n1️⃣ JSON-BASED VALIDATION');
  console.log('---------------------------');

  // Simplify the schema for the demo to focus on basic validation rules
  const userJsonSchema = {
    fields: {
      id: { required: true },
      username: { required: true, minLength: 3, maxLength: 30 },
      email: { datatype: 'email' },
      age: { min: 13 },
      role: { oneOf: ['user', 'admin', 'guest'] },
    },
  };

  // Parse the JSON schema into a ValidationSchema
  const schema = parseJsonSchema(userJsonSchema);
  const validator = new Validator();

  // Valid user data
  const validUser = {
    id: '123',
    username: 'johndoe',
    email: 'john@example.com',
    age: 25,
    role: 'user',
  };

  // Invalid user data
  const invalidUser = {
    id: '456',
    username: 'ja', // Too short
    email: 'not-an-email',
    age: 10, // Too young
    role: 'superadmin', // Not in allowed values
  };

  // Validate valid user
  console.log('Validating valid user with JSON schema:');
  const validResult = await validator.validate(validUser, schema, validUser);
  console.log(`Pass: ${validResult.pass}`);
  if (!validResult.pass) {
    console.log('Errors (should be empty):', JSON.stringify(validResult.errors, null, 2));
  }

  // Validate invalid user
  console.log('\nValidating invalid user with JSON schema:');
  const invalidResult = await validator.validate(invalidUser, schema, invalidUser);
  console.log(`Pass: ${invalidResult.pass}`);
  console.log('Errors:', JSON.stringify(invalidResult.errors, null, 2));
}

// ----------------------------------------------------------
// 2. Entity Validation
// ----------------------------------------------------------
async function entityValidationDemo() {
  console.log('\n2️⃣ ENTITY VALIDATION');
  console.log('---------------------------');

  const entityValidator = new EntityValidator();

  // Create entity validation rules using JSON syntax
  const entityValidations = {
    // Actor validation rules
    actor: {
      role: { eq: 'admin' },
    },
    // Input validation rules
    input: {
      username: { required: true, minLength: 3 },
      email: { datatype: 'email' },
      password: { required: true, minLength: 8 },
    },
    // Record (existing data) validation rules
    record: {
      status: { oneOf: ['active', 'inactive'] },
    },
  };

  // Valid scenario
  const validActor = { role: 'admin' };
  const validInput = {
    username: 'johndoe',
    email: 'john@example.com',
    password: 'secure123',
  };
  const validRecord = { status: 'active' };

  // Invalid scenario
  const invalidActor = { role: 'user' }; // Not admin
  const invalidInput = {
    username: 'jo', // Too short
    email: 'not-an-email',
    password: '123', // Too short
  };
  const invalidRecord = { status: 'deleted' }; // Not active or inactive

  // Validate valid entity
  console.log('Validating valid entity:');
  const validResult = await entityValidator.validateEntity({
    operationName: 'update',
    entityName: 'user',
    entityValidations,
    actor: validActor,
    input: validInput,
    record: validRecord,
  });
  console.log(`Pass: ${validResult.pass}`);

  // Validate invalid entity
  console.log('\nValidating invalid entity:');
  const invalidResult = await entityValidator.validateEntity({
    operationName: 'update',
    entityName: 'user',
    entityValidations,
    actor: invalidActor,
    input: invalidInput,
    record: invalidRecord,
    collectErrors: true,
    verboseErrors: true,
  });
  console.log(`Pass: ${invalidResult.pass}`);
  console.log('Errors:', JSON.stringify(invalidResult.errors, null, 2));
}

// ----------------------------------------------------------
// 3. HTTP Request Validation
// ----------------------------------------------------------
async function httpValidationDemo() {
  console.log('\n3️⃣ HTTP REQUEST VALIDATION');
  console.log('---------------------------');

  const entityValidator = new EntityValidator();

  // Define HTTP validation rules
  const httpValidation = {
    // Header validation
    header: {
      'content-type': { eq: 'application/json' },
      authorization: { required: true },
    },
    // Body validation
    body: {
      username: { required: true, minLength: 3 },
      email: { datatype: 'email' },
      age: { min: 18 },
      termsAccepted: { eq: true },
    },
    // Path parameters
    param: {
      userId: { required: true },
    },
    // Query parameters
    query: {
      page: { min: 1 },
      limit: { min: 1, max: 100 },
    },
  };

  // Valid HTTP request
  const validRequest = {
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer token123',
    },
    body: {
      username: 'johndoe',
      email: 'john@example.com',
      age: 25,
      termsAccepted: true,
    },
    pathParameters: {
      userId: '123',
    },
    queryStringParameters: {
      page: '2',
      limit: '50',
    },
  };

  // Invalid HTTP request
  const invalidRequest = {
    headers: {
      'content-type': 'text/plain', // Wrong content type
      authorization: 'Bearer token123',
    },
    body: {
      username: 'jo', // Too short
      email: 'not-an-email', // Invalid email
      age: 16, // Too young
      termsAccepted: false, // Terms not accepted
    },
    pathParameters: {
      // userId missing
    },
    queryStringParameters: {
      page: '0', // Too low
      limit: '200', // Too high
    },
  };

  // Validate valid request
  console.log('Validating valid HTTP request:');
  const validResult = await entityValidator.validateHttpRequest({
    requestContext: validRequest,
    validations: httpValidation,
  });
  console.log(`Pass: ${validResult.pass}`);

  // Validate invalid request
  console.log('\nValidating invalid HTTP request:');
  const invalidResult = await entityValidator.validateHttpRequest({
    requestContext: invalidRequest,
    validations: httpValidation,
    collectErrors: true,
    verboseErrors: true,
  });
  console.log(`Pass: ${invalidResult.pass}`);
  console.log('Errors:', JSON.stringify(invalidResult.errors, null, 2));
}

// ----------------------------------------------------------
// Run all demos
// ----------------------------------------------------------
async function runDemo() {
  console.log('🚀 JSON-BASED AND ENTITY VALIDATION DEMO 🚀');
  console.log('==========================================');

  await jsonBasedValidationDemo();
  await entityValidationDemo();
  await httpValidationDemo();

  console.log('\n✅ DEMO COMPLETED SUCCESSFULLY ✅');
}

// Run the demo
runDemo().catch(console.error);
