# Validation System v3

A comprehensive, type-safe validation system for validating data in TypeScript applications. The system is designed to be flexible, extensible, and to provide clear, helpful error messages.

## Overview

This validation system (v3) is a complete reimplementation and replacement for the previous validation system. It offers the following improvements:

- **Strong TypeScript typing**: Full type inference and type safety throughout
- **Clean separation**: Validation logic is completely separate from authorization
- **Extensible design**: Easy to add new validation rules or customize existing ones
- **Comprehensive**: Covers all validation scenarios from the previous implementation
- **Performance**: Includes built-in protections against DoS attacks
- **Testing**: Thoroughly tested with unit tests for all features

## Features

### Core Types and Interfaces

- **ValidationResult**: Contains validation status and errors
- **ValidationError**: Detailed error information with field paths, messages, and expected/received values
- **ValidationRule**: Interface for implementing validation rules
- **ConditionReference**: For conditional validation with named or inline conditions
- **ConditionExpression**: Support for complex logical operators (AND, OR, NOT)

### Validation Rules

- **Basic Rules**:

  - `required()`: Field must be present and not null or empty string
  - `minLength()`, `maxLength()`: String/array length constraints
  - `matches()`: Pattern matching with RegExp
  - `equals()`, `notEquals()`: Exact value comparison
  - `min()`, `max()`: Numeric range validation
  - `oneOf()`, `notOneOf()`: Value must be in/not in a set
  - `custom()`: Create custom validation logic

- **Data Type Validation**:

  - `isEmail()`: Email format validation
  - `isIP()`, `isIPv4()`, `isIPv6()`: IP address validation
  - `isUUID()`: UUID format validation
  - `isDate()`: Date string validation
  - `isJSON()`: JSON string validation
  - `isURL()`: URL format validation
  - `isNumeric()`: Numeric string validation
  - `isType()`: General type checking
  - `unique()`: Array/string uniqueness validation

- **Performance Protection**:
  - `safeSizeString()`: Prevent excessive string size
  - `safeSizeArray()`: Prevent excessive array length
  - `safeSizeObject()`: Limit object property count
  - `safeSizeJSON()`: Limit JSON data size
  - `safeDepth()`: Prevent overly nested objects

### Conditional Validation

- `when()`: Apply rule only when condition is met
- `whenAll()`: Apply rule when all conditions are met (AND)
- `whenAny()`: Apply rule when any condition is met (OR)
- `whenNot()`: Apply rule when condition is not met (NOT)
- Named conditions for reuse

### Nested Object Validation

- `nested()`: Validate nested objects with their own schema
- `eachItem()`: Validate each item in an array
- `objectValues()`: Validate all values in an object
- `dependsOn()`: Validate based on other field values
- Path-based access to nested properties

### Core Validator

- Schema-based validation for objects
- Detailed error reporting with paths
- Support for conditional rules
- Options for error collection and formatting
- Support for custom error messages

### HTTP Validation

- Request validation with headers, params, query, and body
- Type-safe request validation
- Structured error reporting

## Migration from Previous Validator

This validator supports all the validation features from the previous implementation, including:

- All basic validation rules (`required`, `minLength`, etc.)
- Data type validation (`isEmail`, `isUUID`, etc.)
- HTTP request validation
- Error collection and reporting
- Custom error messages and error formatting
- **Entity validation** with actor, input, and record rules
- **JSON-based validation configuration** for compatibility with existing code

### Entity Validation

The `EntityValidator` provides full compatibility with the previous validator's entity validation:

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
      email: { datatype: 'email' },
    },
  },
  actor: { role: 'admin' },
  input: { username: 'johndoe', email: 'john@example.com' },
  collectErrors: true,
});
```

### JSON-based Validation Configuration

For cases where you cannot use builder functions (like in configuration files), you can use JSON-based validation:

```typescript
import { parseJsonSchema, registerFunction } from '@validation/v3';

// Register any custom functions needed by name
registerFunction('isAdult', user => user.age >= 18);

// Define schema using JSON syntax
const userJsonSchema = {
  fields: {
    username: { required: true, minLength: 3 },
    email: { datatype: 'email' },
    age: { min: 13 },
    license: {
      when: 'isAdult',
      rule: { required: true },
    },
  },
  conditions: {
    isAdult: 'isAdult',
  },
};

// Parse it to a ValidationSchema
const schema = parseJsonSchema(userJsonSchema);
const validator = new Validator();
const result = await validator.validate(user, schema);
```

## Examples

### Basic Object Validation

```typescript
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

### Conditional Validation

```typescript
const schema: ValidationSchema<User> = {
  conditions: {
    isAdult: user => user.age >= 18,
    isAdmin: user => user.role === 'admin',
  },
  fields: {
    email: when('isAdult', email()),
    permissions: when('isAdmin', required()),
  },
};
```

### Nested Object Validation

```typescript
const addressSchema: ValidationSchema<Address> = {
  fields: {
    street: required(),
    city: required(),
    country: required(),
    zipCode: required(),
  },
};

const userSchema: ValidationSchema<User> = {
  fields: {
    name: required(),
    address: nested('', addressSchema),
    alternateAddresses: eachItem(nested('', addressSchema)),
  },
};
```

### HTTP Request Validation

```typescript
const httpSchema: HttpValidationSchema = {
  headers: {
    fields: {
      'content-type': equals('application/json'),
    },
  },
  body: {
    fields: {
      username: required(),
      email: email(),
    },
  },
};

const httpValidator = new HttpValidator();
const result = await httpValidator.validate(request, httpSchema);
```

### Performance Protection

```typescript
const uploadSchema: ValidationSchema<Upload> = {
  fields: {
    content: safeSizeString(1000000),
    attachments: safeSizeArray(100),
    metadata: safeSizeObject(50),
  },
};
```

## Best Practices

1. **Start with a clear schema**: Define your validation needs upfront
2. **Use type parameters**: Get the most out of TypeScript's type system
3. **Organize complex validations**: Use named conditions for reuse
4. **Safety first**: Apply performance checks for user inputs
5. **Custom messages**: Provide clear, helpful error messages

## API Documentation

For detailed API documentation, see the source files with comments. The demos folder contains working examples of different validation scenarios.
