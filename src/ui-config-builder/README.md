# UI Config Builder

A system for building UI configurations using TypeScript JSX syntax and builder patterns, providing flexible and type-safe configuration generation for admin UIs.

## Features

- **JSX Syntax**: Define UI configurations using TypeScript JSX for improved readability
- **Builder Pattern**: Create configuration objects using chainable methods
- **Type Safety**: Full TypeScript support with proper typing and IntelliSense
- **Templates**: Reusable configuration templates for common UI patterns
- **Flexibility**: Override and extend configurations as needed

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
