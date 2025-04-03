/**
 * Functional Validation Demo
 * Demonstrates how to use the functional validation approach
 */

import { ValidationRule, ValidationContext, ValidationResult } from '../core/types';
import { Validator } from '../core/validator';
import {
  createRule,
  custom,
  required,
  minLength,
  maxLength,
  email,
  pattern,
  numeric,
  min,
  max,
  oneOf,
  all,
  any,
} from '../functional/rules';
import { RuleAggregator } from '../core/rule-aggregator';

// Basic usage of built-in validation rules
async function basicUsageDemo() {
  console.log('🔍 Basic Usage Demo');

  const validator = new Validator();

  // Example data
  const data = {
    username: 'johndoe',
    email: 'john@example.com',
    age: 25,
  };

  // Required field validation
  const requiredRule = required<string | null>();
  console.log('Required validation result:', await validator.validate(data.username, requiredRule));
  console.log('Required validation result (null):', await validator.validate(null, requiredRule));

  // String length validation
  const minLengthRule = minLength(3);
  console.log('Min length validation result:', await validator.validate(data.username, minLengthRule));
  console.log('Min length validation result (short):', await validator.validate('jo', minLengthRule));

  // Email validation
  const emailRule = email();
  console.log('Email validation result:', await validator.validate(data.email, emailRule));
  console.log('Email validation result (invalid):', await validator.validate('not-an-email', emailRule));

  // Number validation
  const ageRule = all([numeric(), min(18), max(100)]);
  console.log('Age validation result:', await validator.validate(data.age, ageRule));
  console.log('Age validation result (too young):', await validator.validate(16, ageRule));
}

// Custom validation rules
async function customRulesDemo() {
  console.log('\n🔧 Custom Rules Demo');

  const validator = new Validator();

  // Create a custom rule using a function
  const isEven = createRule<number>(value => value % 2 === 0, { message: 'Value must be an even number' });

  console.log('Is even validation result (10):', await validator.validate(10, isEven));
  console.log('Is even validation result (11):', await validator.validate(11, isEven));

  // Custom rule with context
  type UserContext = {
    role: string;
    permissions: string[];
  };

  const hasPermission = (permission: string): ValidationRule<unknown, UserContext> => {
    return custom<unknown, UserContext>(
      (_, context) => {
        if (!context?.data) return false;
        return context.data.permissions.includes(permission);
      },
      { message: `User must have ${permission} permission` },
    );
  };

  const userContext: ValidationContext<UserContext> = {
    data: {
      role: 'admin',
      permissions: ['read', 'write'],
    },
  };

  console.log('Permission check (write):', await validator.validate(null, hasPermission('write'), userContext));
  console.log('Permission check (delete):', await validator.validate(null, hasPermission('delete'), userContext));
}

// Rule composition
async function ruleCompositionDemo() {
  console.log('\n🔄 Rule Composition Demo');

  const validator = new Validator();

  // Define a password validation rule
  const passwordRule = all([
    required(),
    minLength(8),
    maxLength(100),
    // At least one uppercase letter
    pattern(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' }),
    // At least one lowercase letter
    pattern(/[a-z]/, { message: 'Password must contain at least one lowercase letter' }),
    // At least one digit
    pattern(/[0-9]/, { message: 'Password must contain at least one digit' }),
    // At least one special character
    pattern(/[^A-Za-z0-9]/, { message: 'Password must contain at least one special character' }),
  ]);

  console.log('Password validation (good):', await validator.validate('Pass1234!', passwordRule));
  console.log('Password validation (bad):', await validator.validate('password', passwordRule));

  // Use any for alternative validations
  const identifierRule = any([email(), pattern(/^\d{10}$/, { message: 'Identifier must be a 10-digit number' })]);

  console.log('Identifier validation (email):', await validator.validate('user@example.com', identifierRule));
  console.log('Identifier validation (10-digit):', await validator.validate('1234567890', identifierRule));
  console.log('Identifier validation (invalid):', await validator.validate('not-valid', identifierRule));
}

// Using rule aggregator
async function ruleAggregatorDemo() {
  console.log('\n📚 Rule Aggregator Demo');

  const validator = new Validator();

  // Create a rule set for a user
  const userRules = new RuleAggregator<any, any>();

  // Add base rules
  userRules.add(required());

  // Add conditional rules
  userRules
    .when(
      user => user && typeof user === 'object' && user.type === 'admin',
      createRule(user => user.adminCode === 'ADMIN123', { message: 'Invalid admin code' }),
    )
    .when(
      user => user && typeof user === 'object' && user.age !== undefined,
      createRule(user => user.age >= 18, { message: 'User must be 18 or older' }),
    );

  // Build a composite rule
  const compositeRule = userRules.composite();

  // Regular user
  const regularUser = {
    name: 'John',
    type: 'regular',
    age: 25,
  };

  // Admin user with valid code
  const validAdmin = {
    name: 'Admin',
    type: 'admin',
    adminCode: 'ADMIN123',
    age: 30,
  };

  // Admin user with invalid code
  const invalidAdmin = {
    name: 'Bad Admin',
    type: 'admin',
    adminCode: 'WRONG',
    age: 35,
  };

  // Underage user
  const underageUser = {
    name: 'Young',
    type: 'regular',
    age: 16,
  };

  console.log('Regular user validation:', await validator.validate(regularUser, compositeRule));
  console.log('Valid admin validation:', await validator.validate(validAdmin, compositeRule));
  console.log('Invalid admin validation:', await validator.validate(invalidAdmin, compositeRule));
  console.log('Underage user validation:', await validator.validate(underageUser, compositeRule));
}

// Main function to run all demos
async function runDemos() {
  await basicUsageDemo();
  await customRulesDemo();
  await ruleCompositionDemo();
  await ruleAggregatorDemo();
}

// Run the demo
runDemos().catch(console.error);
