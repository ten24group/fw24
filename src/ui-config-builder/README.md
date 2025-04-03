# UI Config Builder

A system for building UI configurations using TypeScript JSX syntax and builder patterns, providing flexible and type-safe configuration generation for admin UIs.

## Features

- **JSX Syntax**: Define UI configurations using TypeScript JSX for improved readability
- **Builder Pattern**: Create configuration objects using chainable methods
- **Type Safety**: Full TypeScript support with proper typing and IntelliSense
- **Templates**: Reusable configuration templates for common UI patterns
- **Flexibility**: Override and extend configurations as needed
- **UI24 Compatible**: Generates configurations compatible with the UI24 system

## Usage Approaches

### JSX Approach

```tsx
import UIConfig from '@/ui-config-builder/components/jsx';
import { buildConfig } from '@/ui-config-builder/components/jsx';

const userForm = (
  <form url="/api/users" method="POST">
    <field id="name" type="string" label="Name" required />
    <field id="email" type="string" fieldType="email" label="Email" required>
      <validation type="email" message="Please enter a valid email" />
    </field>
  </form>
);

const config = buildConfig(userForm);
```

### Builder Pattern Approach

```typescript
import { createFormBuilder } from '@/ui-config-builder/core';

const formConfig = createFormBuilder('user')
  .setTitle('Create User')
  .addProperty({
    id: 'name',
    name: 'name',
    type: 'string',
    fieldType: 'text',
    label: 'Name',
    column: 'name',
    validations: [{ required: true }],
  })
  .addProperty({
    id: 'email',
    name: 'email',
    type: 'string',
    fieldType: 'email',
    label: 'Email',
    column: 'email',
    validations: [{ required: true }, { email: true }],
  })
  .build();
```

## Quick Entity Config Generation

```typescript
import { createEntityUIConfig } from '@/ui-config-builder/core';

const userConfigs = createEntityUIConfig('user', {
  list: true,
  create: true,
  edit: true,
  view: true,
});
```

## Examples

### User Entity Configuration Example

See a complete example of generating UI configurations for a User entity:

```typescript
// Define User entity properties
const userProperties = [
  {
    id: 'id',
    name: 'id',
    type: 'number',
    fieldType: 'number',
    label: 'ID',
    column: 'id',
    isIdentifier: true,
    isListable: true,
    isVisible: true,
  },
  {
    id: 'fullName',
    name: 'fullName',
    type: 'string',
    fieldType: 'text',
    label: 'Full Name',
    column: 'fullName',
    isCreatable: true,
    isEditable: true,
    isListable: true,
    isVisible: true,
    isRequired: true,
  },
  {
    id: 'email',
    name: 'email',
    type: 'string',
    fieldType: 'email',
    label: 'Email Address',
    column: 'email',
    isCreatable: true,
    isEditable: true,
    isListable: true,
    isVisible: true,
    isRequired: true,
  },
  // ... other properties
];

// Create list configuration
const listBuilder = createListBuilder('User');
userProperties.forEach(prop => {
  if (prop.isListable) {
    listBuilder.addProperty(prop);
  }
});
const listConfig = listBuilder.build();

// Create form configuration
const createFormBuilder = createFormBuilder('User');
userProperties.forEach(prop => {
  if (prop.isCreatable) {
    createFormBuilder.addProperty(prop);
  }
});
const createConfig = createFormBuilder.build();

// Generate all configs at once
const userConfigs = {
  'list-user': listConfig,
  'create-user': createConfig,
  // ... other configs
};
```

For a complete example with validation, hooks, and more advanced features, see [examples/user-entity.ts](examples/user-entity.ts) or the test file at [**tests**/examples/user-entity.test.ts](__tests__/examples/user-entity.test.ts).

## Documentation

- [Component Documentation](docs/COMPONENTS.md)
- [JSX Example](examples/jsx-example.tsx)
- [Builder Example](examples/builder-example.ts)

## TypeScript Configuration

For JSX support, include the following in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react",
    "jsxFactory": "UIConfig.createElement"
  }
}
```

## UI Configuration Builder

This package provides a builder-pattern implementation for creating UI configurations that are directly compatible with the UI24 system.

### Key Features

- **Direct UI24 Compatibility**: The builders create configurations that can be used directly with the UI24 system without any conversion or reformatting.
- **Type Safety**: TypeScript types ensure configuration validity at compile time.
- **Builder Pattern**: Fluent API for creating configurations with method chaining.
- **JSX Support**: Create configurations using JSX syntax (optional).
- **Metadata-based**: Takes externally-provided metadata to generate configurations.

### Usage Examples

#### Creating a list configuration

```typescript
import { createListBuilder } from 'ui-config-builder/core';

const listConfig = createListBuilder('User')
  .setTitle('User Management')
  .addHeaderAction({
    label: 'Create User',
    url: '/create-user',
  })
  .addProperty({
    id: 'id',
    name: 'id',
    fieldType: 'text',
    label: 'ID',
    column: 'id',
    isIdentifier: true,
  })
  .addProperty({
    id: 'username',
    name: 'username',
    fieldType: 'text',
    label: 'Username',
    column: 'username',
  })
  // Add row actions
  .addDefaultViewAction('user')
  .addDefaultEditAction('user')
  .addDefaultDeleteAction('user')
  .build();
```

#### Creating a form configuration

```typescript
import { createFormBuilder } from 'ui-config-builder/core';

const formConfig = createFormBuilder('User')
  .setTitle('Create User')
  .addBreadcrumb('Users', '/list-user')
  .addBreadcrumb('Create', '/create-user')
  .addProperty({
    id: 'username',
    name: 'username',
    fieldType: 'text',
    label: 'Username',
    column: 'username',
    isRequired: true,
    validations: [{ type: 'required', message: 'Username is required' }],
  })
  // More properties...
  .setApiConfig({
    apiMethod: 'POST',
    apiUrl: '/user',
    responseKey: 'user',
  })
  .build();
```

### Property Format

All properties used in the builders follow a consistent format that's directly compatible with UI24:

```typescript
interface PropertyConfig {
  id: string; // Unique identifier
  name: string; // Field name
  fieldType: string; // UI field type (text, select, date, etc.)
  label: string; // Display label
  column: string; // Data column name

  // Optional fields
  isVisible?: boolean;
  isEditable?: boolean;
  isListable?: boolean;
  isCreatable?: boolean;
  isFilterable?: boolean;
  isRequired?: boolean;
  validations?: Array<Record<string, unknown>>;
  options?: Array<{ label: string; value: string | number }>;
  // ...other fields as needed
}
```

When using `addProperty()` methods, missing fields like `name`, `label`, etc. can be automatically inferred from the `id` field if not explicitly provided.

### UI24 Integration

The configurations produced by these builders can be directly used with UI24's configuration system:

```typescript
import { createEntityUIConfig } from 'ui-config-builder/core';

// Generate all CRUD configurations for 'User' entity
const userConfigs = createEntityUIConfig('User', {
  list: true,
  create: true,
  edit: true,
  view: true,
  menuIcon: 'user',
});

// Use with UI24
const ui24Config = {
  entities: {
    ...userConfigs,
  },
  menu: {
    items: [
      {
        key: 'user',
        title: 'Users',
        icon: 'user',
        url: '/list-user',
      },
    ],
  },
};
```

## Testing

The UI Config Builder includes comprehensive tests:

```bash
# Run all tests
npm test

# Run specific tests
npx jest __tests__/ui24-compatibility.test.ts
npx jest __tests__/examples/user-entity.test.ts
```

Test coverage includes:

- UI24 compatibility verification
- End-to-end configuration generation
- Builder methods and chaining
- JSX rendering and transformation
- Example implementations
