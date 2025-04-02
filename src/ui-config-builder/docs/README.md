# UI Config Builder

A system for building UI configurations using a builder pattern and JSX-like syntax. This allows for more flexible and type-safe configuration building compared to manually editing JSON files.

## Features

- Builder pattern for creating UI configurations
- JSX-like syntax for defining components
- Type-safe interface with TypeScript
- Reusable templates for common UI patterns
- Route registration system
- Compatible with the existing UI24 JSON configuration format

## Builder Pattern Usage

You can build UI configurations using the builder pattern:

```typescript
import { createFormBuilder, createListBuilder } from '../ui-config-builder';

// Create a list configuration
const listConfig = createListBuilder('User')
  .setTitle('User Management')
  .addHeaderAction({
    label: 'Create User',
    url: '/create-user',
  })
  .addProperty({
    id: 'firstName',
    name: 'First Name',
    type: 'string',
    fieldType: 'text',
    label: 'First Name',
    column: 'firstName',
  })
  .addProperty({
    id: 'lastName',
    name: 'Last Name',
    type: 'string',
    fieldType: 'text',
    label: 'Last Name',
    column: 'lastName',
  })
  .addDefaultCrudActions('user', 'userId')
  .build();

// Create a form configuration
const formConfig = createFormBuilder('User')
  .setTitle('Create User')
  .addHeaderAction({
    label: 'Back to List',
    url: '/list-user',
  })
  .addProperty({
    id: 'firstName',
    name: 'First Name',
    type: 'string',
    fieldType: 'text',
    label: 'First Name',
    column: 'firstName',
    validations: ['required'],
  })
  .addProperty({
    id: 'lastName',
    name: 'Last Name',
    type: 'string',
    fieldType: 'text',
    label: 'Last Name',
    column: 'lastName',
    validations: ['required'],
  })
  .setSubmitSuccessRedirect('/list-user')
  .build();

// Write configurations to a file
import { writeFileSync } from 'fs';
const configs = {
  'list-user': listConfig,
  'create-user': formConfig,
};
writeFileSync('./gen/config/entities.json', JSON.stringify(configs, null, 2));
```

## JSX-like Syntax Usage

You can also define UI configurations using a JSX-like syntax:

```typescript
import {
  Page, Form, Field, DataTable, Action,
  createEntityConfig
} from '../ui-config-builder';

// Create a form configuration using JSX-like syntax
const userCreateForm = (
  <Page title="Create User" pageType="form">
    <Form url="/user" responseKey="user" submitRedirect="/list-user">
      <Field id="firstName" type="string" fieldType="text" label="First Name" required={true} />
      <Field id="lastName" type="string" fieldType="text" label="Last Name" required={true} />
      <Field id="email" type="string" fieldType="email" label="Email" required={true} />
      <Field id="role" type="string" fieldType="select" label="Role"
        options={[
          { label: 'Admin', value: 'admin' },
          { label: 'User', value: 'user' }
        ]}
      />
    </Form>
  </Page>
);

// Create a list configuration using JSX-like syntax
const userListTable = (
  <Page title="User Management" pageType="list">
    <DataTable url="/user" responseKey="items">
      <Field id="firstName" type="string" fieldType="text" label="First Name" />
      <Field id="lastName" type="string" fieldType="text" label="Last Name" />
      <Field id="email" type="string" fieldType="text" label="Email" />
      <Field id="role" type="string" fieldType="text" label="Role" />
      <Action label="View" icon="eye" url="/view-user/:id" />
      <Action label="Edit" icon="edit" url="/edit-user/:id" />
      <Action label="Delete" icon="delete" openInModal={true}
        modalConfig={{
          modalType: 'confirm',
          modalPageConfig: {
            title: 'Delete User',
            content: 'Are you sure you want to delete this user?'
          },
          apiConfig: {
            apiMethod: 'DELETE',
            apiUrl: '/user/:id'
          }
        }}
      />
    </DataTable>
  </Page>
);

// Create entity configurations
const userCreateConfig = createEntityConfig('user', userCreateForm);
const userListConfig = createEntityConfig('user', userListTable);

// Write configurations to a file
import { writeFileSync } from 'fs';
const configs = {
  ...userCreateConfig,
  ...userListConfig
};
writeFileSync('./gen/config/entities.json', JSON.stringify(configs, null, 2));
```

## Using Templates

You can use pre-built templates for common UI patterns:

```typescript
import { Templates, Registration } from '../ui-config-builder';

const { createStandardForm, createStandardList } = Templates;

// Create a form using a template
const userForm = createStandardForm({
  entityName: 'User',
  title: 'Create User',
  fields: [
    {
      id: 'firstName',
      name: 'First Name',
      type: 'string',
      fieldType: 'text',
      label: 'First Name',
      column: 'firstName',
      validations: ['required'],
    },
    {
      id: 'lastName',
      name: 'Last Name',
      type: 'string',
      fieldType: 'text',
      label: 'Last Name',
      column: 'lastName',
      validations: ['required'],
    },
  ],
});

// Create a list using a template
const userList = createStandardList({
  entityName: 'User',
  title: 'User Management',
  columns: [
    {
      id: 'firstName',
      name: 'First Name',
      type: 'string',
      fieldType: 'text',
      label: 'First Name',
      column: 'firstName',
    },
    {
      id: 'lastName',
      name: 'Last Name',
      type: 'string',
      fieldType: 'text',
      label: 'Last Name',
      column: 'lastName',
    },
  ],
  includeDefaultActions: true,
});

// Register routes
Registration.registerEntityRoute('user', 'create', userForm);
Registration.registerEntityRoute('user', 'list', userList);

// Generate configurations from registered routes
const configs = Registration.generateRegisteredConfigs();

// Write configurations to a file
import { writeFileSync } from 'fs';
writeFileSync('./gen/config/entities.json', JSON.stringify(configs, null, 2));
```

## Integration with Existing UI Config Generator

You can extend or override the generated configurations:

```typescript
import { EntityUIConfigGen } from '../ui-config-gen/entity-ui-config.gen';
import { createListBuilder } from '../ui-config-builder';
import { writeFileSync } from 'fs';

class CustomEntityUIConfigGen extends EntityUIConfigGen {
  async process() {
    // First, generate the standard configs
    await super.process();

    // Then extend or override as needed
    const configs = this.getGeneratedConfigs();

    // Override a specific configuration
    const enhancedUserList = createListBuilder('User')
      .setTitle('Enhanced User Management')
      .addProperty({
        id: 'status',
        name: 'Status',
        type: 'string',
        fieldType: 'tag',
        label: 'Status',
        column: 'status',
      })
      .build();

    configs.entities['list-user'] = enhancedUserList;

    // Write the enhanced configs
    this.writeEnhancedConfigs(configs);
  }

  getGeneratedConfigs() {
    // Access the generated configs
    return {
      auth: require('../../gen/config/auth.json'),
      dashboard: require('../../gen/config/dashboard.json'),
      entities: require('../../gen/config/entities.json'),
      menu: require('../../gen/config/menu.json'),
    };
  }

  writeEnhancedConfigs(configs) {
    // Write the enhanced configs
    writeFileSync('./gen/config/entities.json', JSON.stringify(configs.entities, null, 2));
    writeFileSync('./gen/config/menu.json', JSON.stringify(configs.menu, null, 2));
  }
}

// Use the enhanced generator
const generator = new CustomEntityUIConfigGen();
generator.run();
```

## Benefits

1. **Type Safety**: All configurations are type-checked at compile time
2. **Developer Experience**: IntelliSense and code completion for configurations
3. **Flexibility**: Easy to extend and customize configurations
4. **Reusability**: Reuse templates and components across multiple pages
5. **Maintainability**: Code-based configurations are easier to maintain than JSON
6. **Compatibility**: Works with the existing UI24 system without modifications
