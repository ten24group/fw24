/**
 * Simple Validation Demo
 * Demonstrates the concise, function-based validation approach
 */

import { Validator } from '../core/validator';
import { rule, schema, is, all, any, ValidatorFn } from '../functional/simple';

async function simpleValidationDemo() {
  console.log('✨ Simple Function-Based Validation Demo');

  const validator = new Validator();

  // 1. Direct function validation
  console.log('\n📝 Direct Function Validation:');

  // Simple function that validates a username
  const validateUsername = (value: string) =>
    typeof value === 'string' && value.length >= 3 && value.length <= 20 && /^[a-zA-Z0-9_]+$/.test(value);

  // Convert to a ValidationRule
  const usernameRule = rule(validateUsername, {
    message: 'Username must be 3-20 characters and contain only letters, numbers, and underscores',
  });

  console.log('Valid username:', await validator.validate('johndoe123', usernameRule));
  console.log('Invalid username:', await validator.validate('j@', usernameRule));

  // 2. Using predefined validation helpers
  console.log('\n🛠️ Using Validation Helpers:');

  // Email validation
  const emailRule = is.email();
  console.log('Valid email:', await validator.validate('john@example.com', emailRule));
  console.log('Invalid email:', await validator.validate('not-an-email', emailRule));

  // 3. Combining validations with AND
  console.log('\n🔄 Combining Validations (AND):');

  // Age validation with multiple rules
  const ageRule = all([is.required(), value => typeof value === 'number', is.min(18), is.max(120)]);

  console.log('Valid age:', await validator.validate(25, ageRule));
  console.log('Invalid age (too young):', await validator.validate(16, ageRule));

  // 4. Combining validations with OR
  console.log('\n🔀 Combining Validations (OR):');

  // Accept either a string ID or a number ID
  const idRule = any([
    // String ID (UUID format)
    value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    // Numeric ID (positive integer)
    value => typeof value === 'number' && value > 0 && Number.isInteger(value),
  ]);

  console.log('Valid ID (string):', await validator.validate('123e4567-e89b-12d3-a456-426614174000', idRule));
  console.log('Valid ID (number):', await validator.validate(12345, idRule));
  console.log('Invalid ID:', await validator.validate('invalid-id', idRule));

  // 5. Object schema validation
  console.log('\n🏢 Object Schema Validation:');

  // Define a user object type
  interface User {
    username: string;
    email: string;
    age: number;
    role: string;
  }

  // Create a schema for User validation
  const userSchema = schema<User>({
    username: validateUsername,
    email: is.email(),
    age: all([is.required(), is.min(18), is.max(120)]),
    role: value => ['admin', 'user', 'guest'].includes(value as string),
  });

  const validUser = {
    username: 'johndoe',
    email: 'john@example.com',
    age: 30,
    role: 'admin',
  };

  const invalidUser = {
    username: 'jd', // too short
    email: 'not-an-email',
    age: 16, // too young
    role: 'superuser', // invalid role
  };

  console.log('Valid user:', await validator.validate(validUser, userSchema));
  console.log('Invalid user:', await validator.validate(invalidUser, userSchema));

  // 6. Array validation
  console.log('\n📋 Array Validation:');

  // Validate an array of roles
  const rolesRule = is.array(role => ['admin', 'user', 'guest'].includes(role as string));

  console.log('Valid roles:', await validator.validate(['admin', 'user'], rolesRule));
  console.log('Invalid roles:', await validator.validate(['admin', 'invalid'], rolesRule));

  // 7. Context-based validation
  console.log('\n🧩 Context-Based Validation:');

  interface AuthContext {
    userRoles: string[];
  }

  // Create a rule that checks if the user has admin rights
  const adminOnlyRule = rule<string, AuthContext>(
    (value, context) => {
      if (!context?.userRoles) return false;
      return context.userRoles.includes('admin');
    },
    { message: 'Admin access required' },
  );

  console.log(
    'Admin access (with admin role):',
    await validator.validate('sensitive-data', adminOnlyRule, { userRoles: ['admin', 'user'] }),
  );

  console.log(
    'Admin access (without admin role):',
    await validator.validate('sensitive-data', adminOnlyRule, { userRoles: ['user'] }),
  );

  // 8. Complex validation with custom error messages
  console.log('\n📊 Complex Validation with Custom Errors:');

  // Create a password validation rule
  const passwordRule = rule<string>(password => {
    if (typeof password !== 'string') {
      return { pass: false, message: 'Password must be a string' };
    }

    if (password.length < 8) {
      return { pass: false, message: 'Password must be at least 8 characters long' };
    }

    if (!/[A-Z]/.test(password)) {
      return { pass: false, message: 'Password must contain at least one uppercase letter' };
    }

    if (!/[a-z]/.test(password)) {
      return { pass: false, message: 'Password must contain at least one lowercase letter' };
    }

    if (!/[0-9]/.test(password)) {
      return { pass: false, message: 'Password must contain at least one number' };
    }

    if (!/[^A-Za-z0-9]/.test(password)) {
      return { pass: false, message: 'Password must contain at least one special character' };
    }

    return { pass: true };
  });

  console.log('Valid password:', await validator.validate('StrongP@ss123', passwordRule));

  console.log('Invalid password (too short):', await validator.validate('Weak1!', passwordRule));
}

// Run the demo
simpleValidationDemo().catch(console.error);
