/**
 * Basic validation demo for v3 validation system
 */
import {
  Validator,
  ValidationSchema,
  required,
  email,
  minLength,
  min,
  max,
  matches,
  equals,
  when,
  whenAll,
  whenAny,
  whenNot,
} from '../';

// Define a User type
interface User {
  id: string;
  username: string;
  email: string;
  age: number;
  isActive: boolean;
  role: 'admin' | 'user' | 'guest';
}

// Define validation context
interface UserContext {
  isAdminMode: boolean;
  currentUserId: string;
}

// Define validation schema with strongly typed fields
const userSchema: ValidationSchema<User, UserContext> = {
  conditions: {
    // Define conditions that can be referenced by name in rules
    isAdult: user => user.age >= 18,
    isAdmin: user => user.role === 'admin',
    isSelf: (user, context) => user.id === context?.currentUserId,
  },

  fields: {
    // Type-safe validation for each field
    id: required<UserContext>(),

    username: when<string, UserContext>((_, context) => {
      // Check conditions through the whole user object
      const user = context as unknown as User;
      return user.isActive && user.role === 'admin';
    }, minLength<UserContext>(3)),

    email: when<string, UserContext>((_, context) => {
      // Check if user is admin or adult through context
      const user = context as unknown as User;
      return user.role === 'admin' || user.age >= 18;
    }, email<UserContext>()),

    age: whenNot<number, UserContext>((_, context) => {
      // Check if user is admin
      const user = context as unknown as User;
      return user.role === 'admin';
    }, min<UserContext>(13)),

    role: when<'admin' | 'user' | 'guest', UserContext>(
      (_, context) => context?.isAdminMode === true,
      required<UserContext>(),
    ),

    isActive: required<UserContext>(),
  },
};

async function runDemo() {
  const validator = new Validator();

  const validUser: User = {
    id: '123',
    username: 'johndoe',
    email: 'john@example.com',
    age: 25,
    isActive: true,
    role: 'admin',
  };

  const invalidUser: User = {
    id: '456',
    username: 'x',
    email: 'invalid-email',
    age: 12,
    isActive: false,
    role: 'guest',
  };

  const context: UserContext = {
    isAdminMode: true,
    currentUserId: '123',
  };

  console.log('Validating valid user:');
  const validResult = await validator.validate(validUser, userSchema, context);
  console.log(JSON.stringify(validResult, null, 2));

  console.log('\nValidating invalid user:');
  const invalidResult = await validator.validate(invalidUser, userSchema, context);
  console.log(JSON.stringify(invalidResult, null, 2));
}

// Run the demo
runDemo().catch(console.error);
