/**
 * Advanced validation demo for v3 validation system
 *
 * This demo showcases:
 * - Nested object validation
 * - Array validation
 * - Object map validation
 * - Dependency validation
 * - Performance limit validation
 * - Data type validation
 */
import {
  Validator,
  ValidationSchema,
  required,
  min,
  maxLength,
  email,
  isUUID,
  unique,
  safeSizeString,
  safeSizeArray,
  safeSizeObject,
  safeDepth,
  nested,
  eachItem,
  objectValues,
  dependsOn,
} from '../';

// ----------------------------------------------------------
// Define types
// ----------------------------------------------------------

interface Address {
  street: string;
  city: string;
  country: string;
  zipCode: string;
}

interface User {
  id: string;
  username: string;
  email: string;
  age: number;
  address: Address;
  alternateAddresses?: Address[];
  metadata?: Record<string, string>;
}

interface Registration {
  username: string;
  password: string;
  confirmPassword: string;
  age: number;
  hasConsented: boolean;
}

interface DataUpload {
  items: number[];
  description: string;
  tags: string[];
}

// ----------------------------------------------------------
// Define validation schemas
// ----------------------------------------------------------

// Address schema for nested validation
const addressSchema: ValidationSchema<Address> = {
  fields: {
    street: required(),
    city: required(),
    country: required(),
    zipCode: required(),
  },
};

// User schema with nested objects
const userSchema: ValidationSchema<User> = {
  fields: {
    id: required(),
    username: required(),
    email: email(),
    age: min(13),
    address: nested<Address, Address>('', addressSchema),
    alternateAddresses: eachItem(nested<Address, Address>('', addressSchema), { required: false }),
    metadata: objectValues(maxLength(100), { required: false }),
  },
};

// Registration schema with dependent field validation
const registrationSchema: ValidationSchema<Registration> = {
  fields: {
    username: required(),
    password: required(),
    confirmPassword: dependsOn('password', (password, confirmPassword) => password === confirmPassword, {
      message: 'Passwords must match',
    }),
    age: min(13),
    hasConsented: dependsOn('age', (age, hasConsented) => (age < 18 ? true : hasConsented), {
      message: 'Adults must consent to terms',
    }),
  },
};

// Data upload schema with performance limits
const uploadSchema: ValidationSchema<DataUpload> = {
  fields: {
    items: safeSizeArray(100),
    description: safeSizeString(200),
    tags: unique(),
  },
};

// ----------------------------------------------------------
// Demo implementation
// ----------------------------------------------------------

async function runDemo() {
  console.log('🚀 ADVANCED VALIDATION DEMO 🚀');
  console.log('===============================\n');

  const validator = new Validator();

  // ----------------------------------------------------------
  // 1. Nested Object Validation
  // ----------------------------------------------------------
  console.log('1️⃣ NESTED OBJECT VALIDATION');
  console.log('---------------------------');

  const validUser: User = {
    id: '123',
    username: 'johndoe',
    email: 'john@example.com',
    age: 25,
    address: {
      street: '123 Main St',
      city: 'Anytown',
      country: 'USA',
      zipCode: '12345',
    },
  };

  const invalidUser: User = {
    id: '456',
    username: 'janedoe',
    email: 'jane@example.com',
    age: 22,
    address: {
      street: '456 Other St',
      city: '', // Empty city should fail
      country: 'Canada',
      zipCode: '67890',
    },
    alternateAddresses: [
      {
        street: '789 Alt St',
        city: 'Othertown',
        country: 'Mexico',
        zipCode: '', // Empty zip code should fail
      },
    ],
    metadata: {
      note: 'A'.repeat(150), // Too long, should fail
    },
  };

  console.log('Valid user validation:');
  const validUserResult = await validator.validate(validUser, userSchema);
  console.log(`Pass: ${validUserResult.pass}`);

  console.log('\nInvalid user validation:');
  const invalidUserResult = await validator.validate(invalidUser, userSchema);
  console.log(`Pass: ${invalidUserResult.pass}`);
  console.log('Errors:', JSON.stringify(invalidUserResult.errors, null, 2));

  // ----------------------------------------------------------
  // 2. Dependency Validation
  // ----------------------------------------------------------
  console.log('\n2️⃣ DEPENDENCY VALIDATION');
  console.log('---------------------------');

  const validRegistration: Registration = {
    username: 'newuser',
    password: 'secret123',
    confirmPassword: 'secret123', // Matches password
    age: 25,
    hasConsented: true, // Required for adults
  };

  const invalidRegistration: Registration = {
    username: 'baduser',
    password: 'secret123',
    confirmPassword: 'different', // Doesn't match
    age: 30,
    hasConsented: false, // Missing consent for adult
  };

  console.log('Valid registration validation:');
  const validRegResult = await validator.validate(validRegistration, registrationSchema);
  console.log(`Pass: ${validRegResult.pass}`);

  console.log('\nInvalid registration validation:');
  const invalidRegResult = await validator.validate(invalidRegistration, registrationSchema);
  console.log(`Pass: ${invalidRegResult.pass}`);
  console.log('Errors:', JSON.stringify(invalidRegResult.errors, null, 2));

  // ----------------------------------------------------------
  // 3. Performance Limit Validation
  // ----------------------------------------------------------
  console.log('\n3️⃣ PERFORMANCE LIMIT VALIDATION');
  console.log('---------------------------');

  const validUpload: DataUpload = {
    items: Array(50)
      .fill(0)
      .map((_, i) => i),
    description: 'A reasonable description',
    tags: ['important', 'valid', 'unique'],
  };

  const invalidUpload: DataUpload = {
    items: Array(150)
      .fill(0)
      .map((_, i) => i), // Too many items
    description: 'A'.repeat(300), // Too long
    tags: ['duplicate', 'duplicate', 'unique'], // Non-unique values
  };

  console.log('Valid upload validation:');
  const validUploadResult = await validator.validate(validUpload, uploadSchema);
  console.log(`Pass: ${validUploadResult.pass}`);

  console.log('\nInvalid upload validation:');
  const invalidUploadResult = await validator.validate(invalidUpload, uploadSchema);
  console.log(`Pass: ${invalidUploadResult.pass}`);
  console.log('Errors:', JSON.stringify(invalidUploadResult.errors, null, 2));

  console.log('\n✅ DEMO COMPLETED SUCCESSFULLY ✅');
}

// Run the demo
runDemo().catch(console.error);
