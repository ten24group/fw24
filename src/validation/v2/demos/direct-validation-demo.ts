/**
 * Direct Validation Demo
 * Shows how to use the direct validation API inspired by ElectroDb
 */

import { Validator } from '../core/validator';
import { validate } from '../electro/validator';

// Demo user type
interface User {
  id: string;
  username: string;
  email: string;
  age: number;
  isAdmin: boolean;
  isActive: boolean;
  roles: string[];
  profile?: {
    firstName?: string;
    lastName?: string;
    bio?: string;
  };
}

// Context type for validation
interface ValidationCtx {
  currentUser?: {
    id: string;
    isAdmin: boolean;
  };
}

async function directValidationDemo() {
  console.log('⚡ Direct Validation Demo');

  const validator = new Validator();

  // 1. Simple property validation
  console.log('\n📝 Simple Property Validation:');

  const activeUserRule = validate<User>()
    .where((_, ops) => ops.eq('isActive', true))
    .build();

  console.log(
    'Active user:',
    await validator.validate(
      {
        id: '123',
        username: 'johndoe',
        email: 'john@example.com',
        age: 30,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
      },
      activeUserRule,
    ),
  );

  console.log(
    'Inactive user:',
    await validator.validate(
      {
        id: '123',
        username: 'johndoe',
        email: 'john@example.com',
        age: 30,
        isAdmin: false,
        isActive: false,
        roles: ['user'],
      },
      activeUserRule,
    ),
  );

  // 2. Using OR conditions
  console.log('\n📝 Using OR Conditions:');

  const adminOrActiveRule = validate<User>()
    .where((_, ops) => ops.or(ops.eq('isAdmin', true), ops.eq('isActive', true)))
    .build();

  console.log(
    'Admin but inactive:',
    await validator.validate(
      {
        id: '123',
        username: 'admin',
        email: 'admin@example.com',
        age: 35,
        isAdmin: true,
        isActive: false,
        roles: ['admin'],
      },
      adminOrActiveRule,
    ),
  );

  console.log(
    'Not admin, not active:',
    await validator.validate(
      {
        id: '123',
        username: 'inactive',
        email: 'inactive@example.com',
        age: 25,
        isAdmin: false,
        isActive: false,
        roles: ['user'],
      },
      adminOrActiveRule,
    ),
  );

  // 3. Using comparisons
  console.log('\n📝 Using Comparisons:');

  const adultRule = validate<User>()
    .where((_, ops) => ops.gt('age', 18))
    .build();

  console.log(
    'Adult user:',
    await validator.validate(
      {
        id: '123',
        username: 'adult',
        email: 'adult@example.com',
        age: 25,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
      },
      adultRule,
    ),
  );

  console.log(
    'Underage user:',
    await validator.validate(
      {
        id: '123',
        username: 'teen',
        email: 'teen@example.com',
        age: 16,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
      },
      adultRule,
    ),
  );

  // 4. Using array validation
  console.log('\n📝 Array Validation:');

  const hasAdminRoleRule = validate<User>()
    .where((_, ops) => ops.oneOf('roles', ['admin']))
    .build();

  console.log(
    'Has admin role:',
    await validator.validate(
      {
        id: '123',
        username: 'admin',
        email: 'admin@example.com',
        age: 35,
        isAdmin: true,
        isActive: true,
        roles: ['admin', 'user'],
      },
      hasAdminRoleRule,
    ),
  );

  console.log(
    'No admin role:',
    await validator.validate(
      {
        id: '123',
        username: 'regular',
        email: 'regular@example.com',
        age: 30,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
      },
      hasAdminRoleRule,
    ),
  );

  // 5. Nested property validation with exists
  console.log('\n📝 Optional/Nested Property Validation:');

  const hasProfileRule = validate<User>()
    .where((_, ops) => ops.exists('profile'))
    .build();

  console.log(
    'Has profile:',
    await validator.validate(
      {
        id: '123',
        username: 'withprofile',
        email: 'profile@example.com',
        age: 30,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
        profile: {
          firstName: 'John',
          lastName: 'Doe',
        },
      },
      hasProfileRule,
    ),
  );

  console.log(
    'No profile:',
    await validator.validate(
      {
        id: '123',
        username: 'noprofile',
        email: 'noprofile@example.com',
        age: 30,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
      },
      hasProfileRule,
    ),
  );

  // 6. Combining multiple conditions with AND
  console.log('\n📝 Complex Combined Conditions:');

  const complexRule = validate<User>()
    .where((_, ops) => ops.and(ops.eq('isActive', true), ops.gt('age', 21), ops.exists('profile')))
    .build();

  console.log(
    'Meets all conditions:',
    await validator.validate(
      {
        id: '123',
        username: 'complete',
        email: 'complete@example.com',
        age: 25,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
        profile: {
          firstName: 'John',
          lastName: 'Doe',
        },
      },
      complexRule,
    ),
  );

  console.log(
    'Missing condition (no profile):',
    await validator.validate(
      {
        id: '123',
        username: 'partial',
        email: 'partial@example.com',
        age: 25,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
      },
      complexRule,
    ),
  );

  // 7. Using custom validation with context
  console.log('\n📝 Context-Based Validation:');

  const ownerOrAdminRule = validate<User, ValidationCtx>()
    .where(({ isActive, id, isAdmin }, { and, or, eq, custom }) =>
      and(
        eq(isActive, true),
        or(
          custom(id, (userId, context) => context?.currentUser?.id === userId),
          custom(isAdmin, (_, context) => context?.currentUser?.isAdmin === true),
        ),
      ),
    )
    .build();

  // Owner context
  const ownerContext = {
    currentUser: {
      id: '123',
      isAdmin: false,
    },
  };

  // Admin context
  const adminContext = {
    currentUser: {
      id: '999',
      isAdmin: true,
    },
  };

  // Regular user context
  const regularContext = {
    currentUser: {
      id: '456',
      isAdmin: false,
    },
  };

  console.log(
    'Owner access:',
    await validator.validate(
      {
        id: '123',
        username: 'owner',
        email: 'owner@example.com',
        age: 30,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
      },
      ownerOrAdminRule,
      ownerContext,
    ),
  );

  console.log(
    'Admin access:',
    await validator.validate(
      {
        id: '123',
        username: 'owner',
        email: 'owner@example.com',
        age: 30,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
      },
      ownerOrAdminRule,
      adminContext,
    ),
  );

  console.log(
    'Unauthorized access:',
    await validator.validate(
      {
        id: '123',
        username: 'owner',
        email: 'owner@example.com',
        age: 30,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
      },
      ownerOrAdminRule,
      regularContext,
    ),
  );

  // 8. Required fields validation
  console.log('\n📝 Required Fields Validation:');

  const requiredFieldsRule = validate<User>()
    .where((_, { and, exists }) => and(exists('id'), exists('username'), exists('email'), exists('age')))
    .build();

  console.log(
    'All required fields present:',
    await validator.validate(
      {
        id: '123',
        username: 'complete',
        email: 'complete@example.com',
        age: 30,
        isAdmin: false,
        isActive: true,
        roles: ['user'],
      },
      requiredFieldsRule,
    ),
  );

  console.log(
    'Missing required field:',
    await validator.validate(
      {
        id: '123',
        username: 'incomplete',
        isAdmin: false,
        isActive: true,
        roles: ['user'],
      } as any,
      requiredFieldsRule,
    ),
  );
}

// Run the demo
directValidationDemo().catch(console.error);
