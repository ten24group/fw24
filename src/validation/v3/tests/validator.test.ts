/**
 * Unit tests for the core validator
 */
import { Validator, ValidationSchema } from '../validator';
import { required, min, email, oneOf } from '../rules';
import { when, whenNot } from '../conditions';

describe('Validator', () => {
  // Define test types
  interface User {
    id: string;
    username: string;
    email: string;
    age: number;
    isActive: boolean;
    role: 'admin' | 'user' | 'guest';
  }

  interface UserContext {
    isAdminMode: boolean;
    currentUserId: string;
  }

  // Test schema
  const userSchema: ValidationSchema<User, UserContext> = {
    conditions: {
      isAdult: user => user.age >= 18,
      isAdmin: user => user.role === 'admin',
      isSelf: (user, context) => context?.currentUserId === user.id,
    },
    fields: {
      id: required(),
      username: required(),
      email: email(),
      age: min(13),
      isActive: required(),
      role: oneOf(['admin', 'user', 'guest']),
    },
  };

  const validator = new Validator();

  describe('Basic validation', () => {
    it('validates a valid object', async () => {
      const validUser: User = {
        id: '123',
        username: 'johndoe',
        email: 'john@example.com',
        age: 25,
        isActive: true,
        role: 'admin',
      };

      const result = await validator.validate(validUser, userSchema);
      expect(result.pass).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('validates an invalid object', async () => {
      const invalidUser: User = {
        id: '',
        username: '',
        email: 'not-an-email',
        age: 10,
        isActive: false,
        role: 'admin',
      };

      const result = await validator.validate(invalidUser, userSchema);
      expect(result.pass).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('formats error paths correctly', async () => {
      const invalidUser: User = {
        id: '',
        username: 'johndoe',
        email: 'john@example.com',
        age: 25,
        isActive: true,
        role: 'admin',
      };

      const result = await validator.validate(invalidUser, userSchema);
      expect(result.pass).toBe(false);
      expect(result.errors?.[0].path).toContain('id');
    });
  });

  describe('Conditional validation', () => {
    // Test schema with conditional validation
    const conditionalSchema: ValidationSchema<User, UserContext> = {
      conditions: {
        isAdult: user => user.age >= 18,
        isAdmin: user => user.role === 'admin',
      },
      fields: {
        id: required(),
        // Only require email for adults
        email: when('isAdult', email()),
        // Apply stricter age requirement for non-admins
        age: whenNot('isAdmin', min(18)),
      },
    };

    it('applies conditional rules correctly when condition is true', async () => {
      const adultUser: User = {
        id: '123',
        username: 'johndoe',
        email: 'not-an-email',
        age: 25,
        isActive: true,
        role: 'user',
      };

      const result = await validator.validate(adultUser, conditionalSchema);
      expect(result.pass).toBe(false);
      // Should fail email validation because user is adult
      expect(result.errors?.some(err => err.field === 'email')).toBe(true);
    });

    it('skips conditional rules when condition is false', async () => {
      const childUser: User = {
        id: '123',
        username: 'johndoe',
        email: 'not-an-email',
        age: 15,
        isActive: true,
        role: 'guest',
      };

      const result = await validator.validate(childUser, conditionalSchema);
      expect(result.pass).toBe(false);
      // Should fail age validation because user is not admin
      expect(result.errors?.some(err => err.field === 'age')).toBe(true);
      // Should not fail email validation because user is not adult
      expect(result.errors?.some(err => err.field === 'email')).toBe(false);
    });
  });

  describe('Validation options', () => {
    it('respects collectErrors=false option', async () => {
      const invalidUser: User = {
        id: '',
        username: '',
        email: 'not-an-email',
        age: 10,
        isActive: false,
        role: 'admin',
      };

      const result = await validator.validate(invalidUser, userSchema, undefined, {
        collectErrors: false,
      });

      expect(result.pass).toBe(false);
      expect(result.errors?.length).toBe(1); // Should stop at first error
    });

    it('applies verboseErrors=false option', async () => {
      const invalidUser: User = {
        id: '',
        username: '',
        email: 'not-an-email',
        age: 10,
        isActive: false,
        role: 'admin',
      };

      const result = await validator.validate(invalidUser, userSchema, undefined, {
        verboseErrors: false,
      });

      expect(result.pass).toBe(false);
      expect(result.errors?.[0]).toHaveProperty('path');
      expect(result.errors?.[0]).toHaveProperty('message');
      expect(result.errors?.[0]).not.toHaveProperty('messageIds');
      expect(result.errors?.[0]).not.toHaveProperty('expected');
    });

    it('applies custom error messages', async () => {
      const invalidUser: User = {
        id: '123',
        username: 'johndoe',
        email: 'not-an-email',
        age: 25,
        isActive: true,
        role: 'admin',
      };

      const result = await validator.validate(invalidUser, userSchema, undefined, {
        overriddenErrorMessages: {
          'validation.email': 'Custom email error message',
        },
      });

      expect(result.pass).toBe(false);
      const emailError = result.errors?.find(err => err.field === 'email');
      expect(emailError?.message).toBe('Custom email error message');
    });
  });
});
