/**
 * Entity Validation Demo
 * Demonstrates a concise, function-based entity validation approach
 */

// Import the necessary types from the validation system
import { ValidationContext, ValidationRule, ValidationResult } from '../core/types';
import { Validator } from '../core/validator';

// Type definitions for our example
type User = {
  id: string;
  username: string;
  email: string;
  age: number;
  isAdmin: boolean;
  roles: string[];
};

// Demo operation types
type Operation = 'create' | 'update' | 'delete';

// Example context type
type UserContext = {
  userRoles: string[];
  currentUserId?: string;
  isSuperAdmin?: boolean;
};

/**
 * EntityValidator - A simple, function-based approach to entity validation
 */
class EntityValidator<T extends Record<string, unknown>, TContext = unknown> {
  private validator = new Validator();
  private fieldRules: Record<string, (value: any, context: TContext) => boolean | ValidationResult> = {};
  private conditions: Record<string, (context: TContext) => boolean> = {};
  private operationRules: Record<string, Record<string, boolean>> = {};

  // Define a validation rule for a field
  field<K extends keyof T>(field: K, validator: (value: T[K], context: TContext) => boolean | ValidationResult): this {
    this.fieldRules[field as string] = validator;
    return this;
  }

  // Define a condition that can be used in rules
  condition(name: string, check: (context: TContext) => boolean): this {
    this.conditions[name] = check;
    return this;
  }

  // Define which fields are required for which operations
  operations(operations: Record<string, { required?: Array<keyof T> }>): this {
    for (const [op, config] of Object.entries(operations)) {
      this.operationRules[op] = {};

      if (config.required) {
        for (const field of config.required) {
          this.operationRules[op][field as string] = true;
        }
      }
    }
    return this;
  }

  // Validate the entity
  async validate(entity: Partial<T>, operation: string, context?: TContext): Promise<ValidationResult> {
    const errors: Record<string, string> = {};
    let hasErrors = false;

    // Check required fields for the operation
    const opRules = this.operationRules[operation] || {};
    for (const [field, required] of Object.entries(opRules)) {
      if (required && entity[field as keyof T] === undefined) {
        hasErrors = true;
        errors[field] = `Field '${field}' is required for ${operation} operation`;
      }
    }

    // Validate each field with its rule
    for (const [field, value] of Object.entries(entity)) {
      const rule = this.fieldRules[field];
      if (!rule) continue;

      try {
        const result = rule(value, context as TContext);

        if (typeof result === 'boolean') {
          if (!result) {
            hasErrors = true;
            errors[field] = `Validation failed for ${field}`;
          }
        } else if (!result.pass) {
          hasErrors = true;
          errors[field] = result.errors?.[0]?.message || `Validation failed for ${field}`;
        }
      } catch (error) {
        hasErrors = true;
        errors[field] = (error as Error).message || `Error validating ${field}`;
      }
    }

    return {
      pass: !hasErrors,
      errors: hasErrors
        ? Object.entries(errors).map(([field, message]) => ({
            field,
            message,
          }))
        : undefined,
    };
  }
}

// Example usage
async function entityValidationDemo() {
  console.log('✨ Entity Validation Demo');

  // Create the validator with direct function validations
  const userValidator = new EntityValidator<User, UserContext>()
    // Define field validators as simple functions
    .field('username', value => {
      if (typeof value !== 'string') return false;
      if (value.length < 3) return false;
      if (value.length > 20) return false;
      if (!/^[a-zA-Z0-9_]+$/.test(value)) return false;
      return true;
    })
    .field('email', value => {
      if (typeof value !== 'string') return false;
      return /^[^@]+@[^@]+\.[^@]+$/.test(value);
    })
    .field('age', value => {
      if (typeof value !== 'number') return false;
      return value >= 18 && value <= 120;
    })
    .field('roles', (value, context) => {
      if (!Array.isArray(value)) return false;
      if (value.length === 0) return false;

      // Only admins can assign admin role
      if (value.includes('admin') && !context.userRoles.includes('admin')) {
        return {
          pass: false,
          errors: [{ field: 'roles', message: 'Only admins can assign admin role' }],
        };
      }

      // Check if all roles are valid
      const validRoles = ['admin', 'user', 'guest'];
      return value.every(role => validRoles.includes(role));
    })
    // Define conditions for validation
    .condition('isAdmin', context => context.userRoles.includes('admin'))
    .condition('isSelf', context => context.currentUserId === context.currentUserId)
    // Define operations and their required fields
    .operations({
      create: {
        required: ['username', 'email', 'age', 'roles'],
      },
      update: {
        required: [],
      },
      delete: {
        required: ['id'],
      },
    });

  // Example valid data
  const validUser: Partial<User> = {
    username: 'johndoe',
    email: 'john@example.com',
    age: 30,
    roles: ['user'],
  };

  // Example invalid data
  const invalidUser: Partial<User> = {
    username: 'j@', // Invalid format
    email: 'not-an-email',
    age: 16, // Too young
    roles: ['admin'], // Regular user trying to assign admin role
  };

  // Example contexts
  const adminContext: UserContext = {
    userRoles: ['admin'],
    currentUserId: '123',
  };

  const userContext: UserContext = {
    userRoles: ['user'],
    currentUserId: '456',
  };

  // Validate create operation with valid data (as admin)
  console.log('\n📝 Valid user creation (as admin):');
  const validCreateResult = await userValidator.validate(validUser, 'create', adminContext);
  console.log(validCreateResult);

  // Validate create operation with invalid data (as regular user)
  console.log('\n📝 Invalid user creation (as regular user):');
  const invalidCreateResult = await userValidator.validate(invalidUser, 'create', userContext);
  console.log(invalidCreateResult);

  // Validate update with missing required field
  console.log('\n📝 Invalid delete (missing ID):');
  const invalidDeleteResult = await userValidator.validate({}, 'delete', adminContext);
  console.log(invalidDeleteResult);
}

// Run the demo
entityValidationDemo().catch(console.error);
