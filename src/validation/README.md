# Validation Builder

The Validation Builder provides a fluent, type-safe API for defining validations in a more readable and maintainable way than the traditional object-based approach.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Field Validations](#field-validations)
- [Multiple Field Validations](#multiple-field-validations)
- [Operation-Specific Validations](#operation-specific-validations)
- [Custom Messages](#custom-messages)
- [Predefined Rule Templates](#predefined-rule-templates)
- [Conditional Validations](#conditional-validations)
- [HTTP Validations](#http-validations)
- [Comparison with Traditional Approach](#comparison-with-traditional-approach)
- [Advanced Usage](#advanced-usage)
- [Migration Guide](#migration-guide)

## Basic Usage

Import the validation builder:

```typescript
import { entity, http } from './validation-builder';
```

### Simple Entity Validation

```typescript
// Create validations
const validations = entity()
  .add('input', 'email', {
    required: true,
    email: true,
  })
  .add('input', 'name', {
    required: true,
    minLength: 2,
  })
  .build();

// Use with validator
const result = await validator.validateEntity({
  operationName: 'create',
  entityName: 'user',
  entityValidations: validations,
  input: {
    email: 'test@example.com',
    name: 'John',
  },
});
```

## Field Validations

The builder supports all validation types from the traditional approach:

```typescript
entity()
  .add('input', 'username', {
    required: true, // Field is required
    minLength: 3, // Minimum length
    maxLength: 20, // Maximum length
    pattern: /^[a-zA-Z0-9_]+$/, // Regex pattern
    type: 'string', // Data type
  })
  .build();
```

## Multiple Field Validations

The builder provides helper methods to add validations for multiple fields at once:

```typescript
entity()
  .inputs({
    email: { required: true, email: true },
    name: { required: true, minLength: 2 },
    age: { gt: 18, message: 'Must be at least 18 years old' },
  })
  .actors({
    role: { in: [['admin', 'editor']] },
  })
  .records({
    status: { eq: 'active' },
  })
  .build();
```

## Operation-Specific Validations

Specify validations that only apply to certain operations:

```typescript
entity()
  .add('input', 'email', {
    required: true,
    email: true,
    operations: ['create', 'update'], // Only validate for create and update
  })
  .add('input', 'id', {
    required: true,
    operations: ['update', 'delete'], // Only validate for update and delete
  })
  .build();
```

## Custom Messages

Add custom error messages to validations:

```typescript
entity()
  .add('input', 'password', {
    minLength: [8, 'Password must be at least 8 characters long'],
    pattern: [/^(?=.*[A-Z])(?=.*[0-9])/, 'Password must contain an uppercase letter and a number'],
  })
  .build();
```

## Predefined Rule Templates

The builder includes predefined templates for common validation patterns:

```typescript
entity()
  .addPassword('input', 'password', {
    minLength: 8,
    requireSpecial: true,
    requireUpper: true,
    requireDigit: true,
  })
  .addName('input', 'fullName', {
    minLength: 2,
    maxLength: 50,
  })
  .build();
```

## Conditional Validations

Create complex conditional validations:

```typescript
entity()
  .add('input', 'shippingAddress', {
    when: [
      {
        condition: (value, data) => data.hasPhysicalProducts === true,
        rules: {
          required: true,
          minLength: [10, 'Please provide a complete address'],
        },
      },
    ],
  })
  .build();
```

## HTTP Validations

Create validations for HTTP requests:

```typescript
http()
  .body({
    email: { required: true, email: true },
    password: { required: true, minLength: 8 },
  })
  .param({
    id: { required: true, pattern: /^\d+$/ },
  })
  .query({
    page: { type: 'number' },
    limit: { type: 'number', max: 100 },
  })
  .header({
    'content-type': { eq: 'application/json' },
  })
  .build();
```

## Comparison with Traditional Approach

### Basic Validation

#### Traditional Approach

```typescript
const validations = {
  input: {
    email: [{ required: true }, { datatype: 'email' }],
    name: [{ required: true }, { minLength: 2 }],
  },
  actor: {
    role: [{ inList: ['admin', 'user'] }],
  },
};
```

#### Builder Approach

```typescript
const validations = entity()
  .add('input', 'email', {
    required: true,
    email: true,
  })
  .add('input', 'name', {
    required: true,
    minLength: 2,
  })
  .add('actor', 'role', {
    in: [['admin', 'user']],
  })
  .build();
```

### Custom Messages

#### Traditional Approach

```typescript
const validations = {
  input: {
    password: [
      { required: true },
      { minLength: 8, message: 'Password too short' },
      { pattern: /^(?=.*[A-Z])(?=.*\d)/, message: 'Need uppercase and number' },
    ],
  },
};
```

#### Builder Approach

```typescript
const validations = entity()
  .add('input', 'password', {
    required: true,
    minLength: [8, 'Password too short'],
    pattern: [/^(?=.*[A-Z])(?=.*\d)/, 'Need uppercase and number'],
  })
  .build();
```

### Operation-Specific Validations

#### Traditional Approach

```typescript
const validations = {
  input: {
    email: [
      { required: true, operations: ['create'] },
      { datatype: 'email', operations: ['create', 'update'] },
    ],
    id: [{ required: true, operations: ['update', 'delete'] }],
  },
};
```

#### Builder Approach

```typescript
const validations = entity()
  .add('input', 'email', {
    required: true,
    email: true,
    operations: ['create', 'update'],
  })
  .add('input', 'id', {
    required: true,
    operations: ['update', 'delete'],
  })
  .build();
```

### HTTP Validations

#### Traditional Approach

```typescript
const validations = {
  body: {
    email: { required: true, datatype: 'email' },
    password: { required: true, minLength: 8 },
  },
  param: {
    id: { required: true, pattern: /^\d+$/ },
  },
  query: {
    page: { datatype: 'number' },
  },
};
```

#### Builder Approach

```typescript
const validations = http()
  .body({
    email: { required: true, email: true },
    password: { required: true, minLength: 8 },
  })
  .param({
    id: { required: true, pattern: /^\d+$/ },
  })
  .query({
    page: { type: 'number' },
  })
  .build();
```

### Conditional Validation

#### Traditional Approach

```typescript
const condition = {
  hasPhysicalProducts: {
    input: {
      hasPhysicalProducts: { eq: true },
    },
  },
};

const validations = {
  conditions: condition,
  input: {
    shippingAddress: [
      {
        required: true,
        minLength: 10,
        conditions: [['hasPhysicalProducts'], 'all'],
      },
    ],
  },
};
```

#### Builder Approach

```typescript
const validations = entity()
  .add('input', 'shippingAddress', {
    when: [
      {
        condition: (value, data) => data.hasPhysicalProducts === true,
        rules: {
          required: true,
          minLength: 10,
        },
      },
    ],
  })
  .build();
```

## Advanced Usage

### Combining Multiple Field Configuration Methods

```typescript
const validations = entity()
  // Add individual fields
  .add('input', 'email', { required: true, email: true })

  // Add multiple input fields at once
  .inputs({
    firstName: { required: true, minLength: 2 },
    lastName: { required: true, minLength: 2 },
    age: { gt: 18 },
  })

  // Add actor fields
  .actors({
    role: { in: [['admin', 'editor', 'user']] },
  })

  // Add special template fields
  .addPassword('input', 'password', {
    minLength: 8,
    requireSpecial: true,
  })

  .build();
```

### Callback Function for Complex Rules

```typescript
entity()
  .inputs({
    // Using a callback function to build complex rules
    password: rule => ({
      ...rule,
      required: true,
      minLength: [8, 'Too short'],
      pattern: [/(?=.*[A-Z])(?=.*\d)/, 'Need uppercase and number'],
    }),
  })
  .build();
```

## Migration Guide

To migrate from the traditional validation approach to the builder pattern:

1. Replace object literal declarations with the builder pattern:

```typescript
// Old approach
const validations = {
  input: {
    email: [{ required: true }, { datatype: 'email' }],
  },
};

// New approach
import { entity } from './validation-builder';

const validations = entity()
  .add('input', 'email', {
    required: true,
    email: true,
  })
  .build();
```

2. Consolidate multiple validations for the same field:

```typescript
// Old approach
const validations = {
  input: {
    password: [{ required: true }, { minLength: 8 }, { pattern: /^(?=.*[A-Z])/ }],
  },
};

// New approach
const validations = entity()
  .add('input', 'password', {
    required: true,
    minLength: 8,
    pattern: /^(?=.*[A-Z])/,
  })
  .build();
```

3. Use the helper methods for multiple fields:

```typescript
// Old approach
const validations = {
  input: {
    firstName: [{ required: true }],
    lastName: [{ required: true }],
    email: [{ required: true }, { datatype: 'email' }],
  },
};

// New approach
const validations = entity()
  .inputs({
    firstName: { required: true },
    lastName: { required: true },
    email: { required: true, email: true },
  })
  .build();
```

4. Use predefined templates for common patterns:

```typescript
// Old approach
const validations = {
  input: {
    password: [{ required: true }, { minLength: 8 }, { pattern: /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/ }],
  },
};

// New approach
const validations = entity()
  .addPassword('input', 'password', {
    minLength: 8,
    requireSpecial: true,
    requireUpper: true,
    requireDigit: true,
  })
  .build();
```

5. For HTTP validations, use the `http()` builder:

```typescript
// Old approach
const validations = {
  body: {
    email: { required: true, datatype: 'email' },
  },
};

// New approach
import { http } from './validation-builder';

const validations = http()
  .body({
    email: { required: true, email: true },
  })
  .build();
```

By migrating to the builder pattern, you'll benefit from improved readability, type safety, and maintainability while ensuring full compatibility with the existing validation system.
