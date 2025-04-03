# Migration Guide: Validator to Validation System v3

This guide will help you migrate from the previous validator to the new v3 validation system.

## Overview

The v3 validation system is a complete replacement for the previous validator, offering:

- Stronger TypeScript typing
- Clearer separation of validation logic from authorization
- More extensibility
- Better error messages
- Enhanced performance protections
- Comprehensive test coverage

The v3 system provides a straightforward migration path so you can upgrade your existing code with minimal changes.

## Direct Migration: EntityValidator

For the simplest migration, you can use the `EntityValidator` which provides a compatible interface with the previous validator.

### Before (old validator):

```typescript
const validator = new Validator();
const result = await validator.validateEntity({
  operationName: 'create',
  entityName: 'user',
  entityValidations: {
    actor: {
      role: { eq: 'admin' },
    },
    input: {
      username: { required: true, minLength: 3 },
      email: { email: true },
    },
  },
  actor: { role: 'admin' },
  input: userInput,
  collectErrors: true,
});
```

### After (new v3 validator):

```typescript
import { EntityValidator } from '@validation/v3';

const validator = new EntityValidator();
const result = await validator.validateEntity({
  operationName: 'create',
  entityName: 'user',
  entityValidations: {
    actor: {
      role: { eq: 'admin' },
    },
    input: {
      username: { required: true, minLength: 3 },
      email: { datatype: 'email' }, // Note: slight syntax change
    },
  },
  actor: { role: 'admin' },
  input: userInput,
  collectErrors: true,
});
```

The key differences are:

- Import from `@validation/v3` instead of the old validator
- Use `EntityValidator` as the class name
- Some minor syntax changes in validation rules (e.g., `email: true` → `datatype: 'email'`)

## Input Validation

For validating individual inputs:

### Before:

```typescript
const result = await validator.validateInput(userInput, {
  username: { required: true, minLength: 3 },
  email: { email: true },
  age: { gt: 18 },
});
```

### After:

```typescript
const validator = new EntityValidator();
const result = await validator.validateInput(userInput, {
  username: { required: true, minLength: 3 },
  email: { datatype: 'email' },
  age: { gt: 18 }, // or use min: 19 for more precision
});
```

## HTTP Validation

For HTTP request validation:

### Before:

```typescript
const result = await validator.validateHttpRequest({
  requestContext,
  validations: {
    body: {
      username: { required: true },
      email: { email: true },
    },
    header: {
      'content-type': { eq: 'application/json' },
    },
  },
});
```

### After:

```typescript
const validator = new EntityValidator();
const result = await validator.validateHttpRequest({
  requestContext,
  validations: {
    body: {
      username: { required: true },
      email: { datatype: 'email' },
    },
    header: {
      'content-type': { eq: 'application/json' },
    },
  },
});
```

## Conditional Validation

For conditional validation:

### Before:

```typescript
const conditions = {
  isAdult: user => user.age >= 18,
};

const result = await validator.validateEntity({
  // ...other options...
  entityValidations: {
    input: {
      drivingLicense: {
        when: 'isAdult',
        validate: { required: true },
      },
    },
  },
  conditions,
});
```

### After:

```typescript
import { registerFunction } from '@validation/v3';

// Register the condition function globally (once)
registerFunction('isAdult', user => user.age >= 18);

const validator = new EntityValidator();
const result = await validator.validateEntity({
  // ...other options...
  entityValidations: {
    input: {
      drivingLicense: {
        when: 'isAdult',
        rule: { required: true }, // Note: 'rule' instead of 'validate'
      },
    },
  },
});
```

Key difference:

- Conditions are registered globally with `registerFunction` in the new system
- Use `rule` instead of `validate` in the conditional validation

## Data Type Validation

Several validation types have been standardized:

### Before:

```typescript
{
  email: { email: true },
  url: { httpUrl: true },
  uuid: { uuid: true }
}
```

### After:

```typescript
{
  email: { datatype: 'email' },
  url: { datatype: 'url' },
  uuid: { datatype: 'uuid' }
}
```

## Full Schema-Based Validation (Optional Enhancement)

The v3 system offers a more type-safe validation approach using schemas:

```typescript
import { Validator, ValidationSchema, required, email, minLength, oneOf } from '@validation/v3';

interface User {
  id: string;
  username: string;
  email: string;
  age: number;
  role: 'admin' | 'user' | 'guest';
}

// Define a strongly-typed validation schema
const userSchema: ValidationSchema<User> = {
  fields: {
    id: required(),
    username: minLength(3),
    email: email(),
    age: min(13),
    role: oneOf(['admin', 'user', 'guest']),
  },
};

const validator = new Validator();
const result = await validator.validate(userData, userSchema);
```

This approach provides stronger type checking but requires more changes to your existing code.

## Complete Examples

For complete examples, see the various demo files:

- `src/validation/v3/demos/basic-validation-demo.ts`
- `src/validation/v3/demos/advanced-validation-demo.ts`
- `src/validation/v3/demos/http-validation-demo.ts`
- `src/validation/v3/demos/json-and-entity-validation-demo.ts`

## Common Migration Issues

1. **Renamed validation rules**:

   - `email: true` → `datatype: 'email'`
   - `httpUrl: true` → `datatype: 'url'`
   - `gt: x` → `min: x+1` (prefer using `min`/`max` for clarity)

2. **Conditions handling**:

   - Conditions must be registered globally using `registerFunction`
   - Use the `rule` property instead of `validate` for conditional validation

3. **Error message IDs**:
   - Some error message IDs have changed slightly (e.g., lowercase vs. camelCase)
   - Check error output during testing to update any custom error message mappings

## Performance and Security Improvements

The v3 system includes built-in protections against DoS attacks:

```typescript
import { safeSizeString, safeSizeArray, safeSizeObject } from '@validation/v3';

const uploadSchema = {
  content: { safeSizeString: 1000000 }, // Limit string to 1MB
  tags: { safeSizeArray: 100 }, // Limit array to 100 items
  metadata: { safeSizeObject: 50 }, // Limit object to 50 properties
};
```

These protections help prevent malicious inputs that could cause performance issues.

## Need Help?

If you encounter any issues during migration, please refer to:

1. The comprehensive README in the v3 validation system folder
2. Test files in the `tests` directory for usage examples
3. Demo files in the `demos` directory for working examples
