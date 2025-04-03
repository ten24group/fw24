/**
 * Fluent Validation Demo
 * Demonstrates the concise, ElectroDb-inspired validation builder
 */

import { validate } from '../fluent/builder';
import { Validator } from '../core/validator';

async function fluentValidationDemo() {
  console.log('✨ Fluent Validation Builder Demo');

  const validator = new Validator();

  // Simple string validation
  console.log('\n📝 String Validation:');
  const usernameRule = validate().string(s => {
    s.required()
      .minLength(3)
      .maxLength(20)
      .matches(/^[a-zA-Z0-9_]+$/);
  });

  console.log('Valid username:', await validator.validate('johndoe123', usernameRule));

  console.log('Invalid username (too short):', await validator.validate('jo', usernameRule));

  console.log('Invalid username (invalid chars):', await validator.validate('john.doe!', usernameRule));

  // Email validation
  console.log('\n📧 Email Validation:');
  const emailRule = validate().string(s => {
    s.required().email();
  });

  console.log('Valid email:', await validator.validate('john@example.com', emailRule));

  console.log('Invalid email:', await validator.validate('not-an-email', emailRule));

  // Number validation
  console.log('\n🔢 Number Validation:');
  const ageRule = validate().number(n => {
    n.required().min(18).max(120);
  });

  console.log('Valid age:', await validator.validate(25, ageRule));

  console.log('Invalid age (too young):', await validator.validate(16, ageRule));

  // Boolean validation
  console.log('\n🔄 Boolean Validation:');
  const activeRule = validate().boolean(b => {
    b.required().isTrue();
  });

  console.log('Valid (true):', await validator.validate(true, activeRule));

  console.log('Invalid (false):', await validator.validate(false, activeRule));

  // Array validation
  console.log('\n📋 Array Validation:');
  const rolesRule = validate().array<string>(a => {
    a.required()
      .minLength(1)
      .eachItem(
        validate().string(s => {
          s.required().oneOf(['admin', 'user', 'guest']);
        }),
      );
  });

  console.log('Valid roles:', await validator.validate(['admin', 'user'], rolesRule));

  console.log('Invalid roles (empty):', await validator.validate([], rolesRule));

  console.log('Invalid roles (invalid role):', await validator.validate(['admin', 'invalid'], rolesRule));

  // Object validation with simple types first
  console.log('\n🏢 Simple Object Validation:');

  // Define a simple login form validation
  const loginFormRule = validate().object<{ username: string; password: string }>(o => {
    o.required()
      .property(
        'username',
        validate().string(s => s.required().minLength(3)),
      )
      .property(
        'password',
        validate().string(s => s.required().minLength(8)),
      );
  });

  console.log(
    'Valid login:',
    await validator.validate(
      {
        username: 'johndoe',
        password: 'securepass123',
      },
      loginFormRule,
    ),
  );

  console.log(
    'Invalid login (short password):',
    await validator.validate(
      {
        username: 'johndoe',
        password: 'short',
      },
      loginFormRule,
    ),
  );

  // Custom validation with context
  console.log('\n🧩 Custom Validation with Context:');

  // Define a permission-based context
  type PermissionContext = {
    userRoles: string[];
  };

  const adminAccessRule = validate<PermissionContext>().custom<string>((value, context) => {
    if (!context) return false;
    return (context as PermissionContext).userRoles.includes('admin');
  }, 'Admin access required');

  console.log(
    'Admin access (with admin role):',
    await validator.validate('sensitive-data', adminAccessRule, {
      userRoles: ['admin', 'user'],
    }),
  );

  console.log(
    'Admin access (without admin role):',
    await validator.validate('sensitive-data', adminAccessRule, {
      userRoles: ['user'],
    }),
  );

  // Demonstrating the fluent composition for schema validation
  console.log('\n🌟 Schema Validation:');

  // Define a user schema validation
  const userSchemaRule = validate().object<{
    id: string;
    username: string;
    email: string;
    age: number;
    isActive: boolean;
    roles: string[];
  }>(o => {
    o.required()
      .property(
        'id',
        validate().string(s => s.required().matches(/^[0-9a-f]{24}$/)),
      )
      .property('username', usernameRule) // Reusing existing rules
      .property('email', emailRule) // Reusing existing rules
      .property('age', ageRule) // Reusing existing rules
      .property('isActive', activeRule) // Reusing existing rules
      .property('roles', rolesRule); // Reusing existing rules
  });

  const validUserData = {
    id: '507f1f77bcf86cd799439011',
    username: 'johndoe',
    email: 'john@example.com',
    age: 30,
    isActive: true,
    roles: ['admin', 'user'],
  };

  console.log('Valid user schema:', await validator.validate(validUserData, userSchemaRule));
}

// Run the demo
fluentValidationDemo().catch(console.error);
