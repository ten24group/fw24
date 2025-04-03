/**
 * Unit tests for advanced validation features
 */
import { ValidationSchema, Validator } from '../validator';
import { ValidationRule } from '../core/types';
import { nested, eachItem, objectValues, dependsOn } from '../validator/nested';
import { required, min, maxLength } from '../rules';
import { isEmail, isUUID, unique, safeSizeArray, safeSizeString } from '../rules';

describe('Advanced validation features', () => {
  const validator = new Validator();

  describe('Nested object validation', () => {
    interface Address {
      street: string;
      city: string;
      country: string;
      zipCode: string;
    }

    interface User {
      id: string;
      name: string;
      address: Address;
      alternateAddresses?: Address[];
      metadata?: Record<string, string>;
    }

    const addressSchema: ValidationSchema<Address> = {
      fields: {
        street: required(),
        city: required(),
        country: required(),
        zipCode: required(),
      },
    };

    // Using a type annotation to work around the strict type checking
    const nestedAddressValidator: ValidationRule<any> = nested<User, Address>(
      '', // Use an empty path to validate the address directly
      addressSchema,
      { required: true },
    );

    const nestedAddressArrayValidator: ValidationRule<any> = eachItem(nested<Address, Address>('', addressSchema), {
      required: false,
    });

    const userSchema: ValidationSchema<User> = {
      fields: {
        id: required(),
        name: required(),
        address: nestedAddressValidator,
        alternateAddresses: nestedAddressArrayValidator,
        metadata: objectValues(maxLength(100), { required: false }),
      },
    };

    it('validates nested objects correctly', async () => {
      const validUser: User = {
        id: '123',
        name: 'John Doe',
        address: {
          street: '123 Main St',
          city: 'Anytown',
          country: 'USA',
          zipCode: '12345',
        },
      };

      const result = await validator.validate(validUser, userSchema);
      expect(result.pass).toBe(true);
    });

    it('reports errors in nested objects with correct paths', async () => {
      const invalidUser: User = {
        id: '123',
        name: 'John Doe',
        address: {
          street: '123 Main St',
          city: '', // Missing city
          country: 'USA',
          zipCode: '12345',
        },
      };

      const result = await validator.validate(invalidUser, userSchema);
      expect(result.pass).toBe(false);

      const cityError = result.errors?.find(err => err.path?.includes('city'));
      expect(cityError).toBeDefined();
      expect(cityError?.path).toEqual(['address', 'city']);
    });

    it('validates array of nested objects', async () => {
      const user: User = {
        id: '123',
        name: 'John Doe',
        address: {
          street: '123 Main St',
          city: 'Anytown',
          country: 'USA',
          zipCode: '12345',
        },
        alternateAddresses: [
          {
            street: '456 Second St',
            city: 'Othertown',
            country: 'Canada',
            zipCode: '67890',
          },
          {
            street: '789 Third St',
            city: '', // Invalid - empty city
            country: 'Mexico',
            zipCode: '54321',
          },
        ],
      };

      const result = await validator.validate(user, userSchema);
      expect(result.pass).toBe(false);

      const altAddressError = result.errors?.find(
        err => err.path?.[0] === 'alternateAddresses' && err.path?.[1] === '1' && err.path?.[2] === 'city',
      );
      expect(altAddressError).toBeDefined();
    });

    it('validates object values map', async () => {
      const user: User = {
        id: '123',
        name: 'John Doe',
        address: {
          street: '123 Main St',
          city: 'Anytown',
          country: 'USA',
          zipCode: '12345',
        },
        metadata: {
          note: 'This is a short note',
          preferences: 'A'.repeat(150), // Exceeds max length
        },
      };

      const result = await validator.validate(user, userSchema);
      expect(result.pass).toBe(false);

      const metadataError = result.errors?.find(err => err.path?.[0] === 'metadata' && err.path?.[1] === 'preferences');
      expect(metadataError).toBeDefined();
    });
  });

  describe('Dependency validation', () => {
    interface Registration {
      username: string;
      password: string;
      confirmPassword: string;
      age: number;
      hasConsented: boolean;
    }

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

    it('validates dependent fields correctly', async () => {
      const validReg: Registration = {
        username: 'johndoe',
        password: 'secret123',
        confirmPassword: 'secret123',
        age: 25,
        hasConsented: true,
      };

      const result = await validator.validate(validReg, registrationSchema);
      expect(result.pass).toBe(true);
    });

    it('reports errors when dependencies are not satisfied', async () => {
      const invalidReg: Registration = {
        username: 'johndoe',
        password: 'secret123',
        confirmPassword: 'different', // Doesn't match password
        age: 25,
        hasConsented: false, // Adult without consent
      };

      const result = await validator.validate(invalidReg, registrationSchema);
      expect(result.pass).toBe(false);
      expect(result.errors?.length).toBe(2);

      const passwordError = result.errors?.find(err => err.field === 'confirmPassword');
      expect(passwordError).toBeDefined();
      expect(passwordError?.message).toBe('Passwords must match');

      const consentError = result.errors?.find(err => err.field === 'hasConsented');
      expect(consentError).toBeDefined();
      expect(consentError?.message).toBe('Adults must consent to terms');
    });
  });

  describe('Data type validation', () => {
    interface APIRequest {
      requestId: string;
      userEmail: string;
      tags: string[];
      content: string;
    }

    const apiSchema: ValidationSchema<APIRequest> = {
      fields: {
        requestId: isUUID(),
        userEmail: isEmail(),
        tags: unique(),
        content: safeSizeString(1000),
      },
    };

    it('validates correct data types', async () => {
      const validRequest: APIRequest = {
        requestId: '123e4567-e89b-12d3-a456-426614174000',
        userEmail: 'user@example.com',
        tags: ['important', 'urgent', 'review'],
        content: 'This is a reasonable length content',
      };

      const result = await validator.validate(validRequest, apiSchema);
      expect(result.pass).toBe(true);
    });

    it('reports errors for invalid data types', async () => {
      const invalidRequest: APIRequest = {
        requestId: 'not-a-uuid',
        userEmail: 'not-an-email',
        tags: ['duplicate', 'duplicate', 'unique'],
        content: 'A'.repeat(2000), // Too long
      };

      const result = await validator.validate(invalidRequest, apiSchema);
      expect(result.pass).toBe(false);
      expect(result.errors?.length).toBe(4);
    });
  });

  describe('Performance limit validation', () => {
    interface DataUpload {
      items: number[];
      description: string;
    }

    const uploadSchema: ValidationSchema<DataUpload> = {
      fields: {
        items: safeSizeArray(100),
        description: safeSizeString(200),
      },
    };

    it('accepts data within limits', async () => {
      const validUpload: DataUpload = {
        items: Array(50)
          .fill(0)
          .map((_, i) => i),
        description: 'A reasonable length description',
      };

      const result = await validator.validate(validUpload, uploadSchema);
      expect(result.pass).toBe(true);
    });

    it('rejects data exceeding limits', async () => {
      const invalidUpload: DataUpload = {
        items: Array(200)
          .fill(0)
          .map((_, i) => i), // Too many items
        description: 'A'.repeat(500), // Too long
      };

      const result = await validator.validate(invalidUpload, uploadSchema);
      expect(result.pass).toBe(false);
      expect(result.errors?.length).toBe(2);
    });
  });
});
