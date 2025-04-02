/**
 * Example usage of the UI Config Builder
 * This file demonstrates how to use both the builder pattern and JSX-like syntax.
 */

import {
  createFormBuilder,
  createListBuilder,
  createEntityUIConfig,
  Components,
  createEntityConfig,
  CoreBuilders,
  Templates,
} from '../index';

// Import the function from CoreBuilders
const { createEntityUIConfigFromTemplates } = CoreBuilders;

// Destructure components for convenience
const { Page, Form, Field, DataTable, Action } = Components;

// Example 1: Using the builder pattern
function builderPatternExample() {
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

  // Combine configurations
  const configs = {
    'list-user': listConfig,
    'create-user': formConfig,
  };

  // Write to file (commented out for example)
  // writeFileSync('./gen/config/entities.json', JSON.stringify(configs, null, 2));

  console.log('Builder pattern example generated:', Object.keys(configs));
  return configs;
}

// Example 2: Using JSX-like syntax with factory functions
function jsxStyleExample() {
  // Form configuration using factory functions
  const userCreateForm = Page({
    title: 'Create User',
    pageType: 'form',
    children: [
      Form({
        url: '/user',
        responseKey: 'user',
        submitRedirect: '/list-user',
        children: [
          Field({ id: 'firstName', type: 'string', fieldType: 'text', label: 'First Name', required: true }),
          Field({ id: 'lastName', type: 'string', fieldType: 'text', label: 'Last Name', required: true }),
          Field({ id: 'email', type: 'string', fieldType: 'email', label: 'Email', required: true }),
          Field({
            id: 'role',
            type: 'string',
            fieldType: 'select',
            label: 'Role',
            options: [
              { label: 'Admin', value: 'admin' },
              { label: 'User', value: 'user' },
            ],
          }),
        ],
      }),
    ],
  });

  // List configuration using factory functions
  const userListTable = Page({
    title: 'User Management',
    pageType: 'list',
    children: [
      DataTable({
        url: '/user',
        responseKey: 'items',
        children: [
          Field({ id: 'firstName', type: 'string', fieldType: 'text', label: 'First Name' }),
          Field({ id: 'lastName', type: 'string', fieldType: 'text', label: 'Last Name' }),
          Field({ id: 'email', type: 'string', fieldType: 'text', label: 'Email' }),
          Field({ id: 'role', type: 'string', fieldType: 'text', label: 'Role' }),
          Action({ label: 'View', icon: 'eye', url: '/view-user/:id' }),
          Action({ label: 'Edit', icon: 'edit', url: '/edit-user/:id' }),
          Action({
            label: 'Delete',
            icon: 'delete',
            openInModal: true,
            modalConfig: {
              modalType: 'confirm',
              modalPageConfig: {
                title: 'Delete User',
                content: 'Are you sure you want to delete this user?',
              },
              apiConfig: {
                apiMethod: 'DELETE',
                apiUrl: '/user/:id',
              },
            },
          }),
        ],
      }),
    ],
  });

  // Create entity configurations
  const userCreateConfig = createEntityConfig('user', userCreateForm);
  const userListConfig = createEntityConfig('user', userListTable);

  // Combine configurations
  const configs = {
    ...userCreateConfig,
    ...userListConfig,
  };

  // Write to file (commented out for example)
  // writeFileSync('./gen/config/entities.json', JSON.stringify(configs, null, 2));

  console.log('JSX-style factory example generated:', Object.keys(configs));
  return configs;
}

// Example 3: Using convenience function for generating CRUD pages
function crudGenerationExample() {
  // Generate complete CRUD configurations
  const userConfigs = createEntityUIConfig('User', {
    list: true,
    create: true,
    edit: true,
    view: true,
  });

  console.log('CRUD generation example created:', Object.keys(userConfigs));
  return userConfigs;
}

// Example 4: Using templates
function templatesExample() {
  // Define fields for the entity
  const fields = [
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
    {
      id: 'email',
      name: 'Email',
      type: 'string',
      fieldType: 'email',
      label: 'Email',
      column: 'email',
      validations: ['required', 'email'],
    },
  ];

  // Use templates directly from Templates namespace
  const { createStandardForm, createStandardList } = Templates;

  // Create configurations using templates
  const createForm = createStandardForm({
    entityName: 'User',
    fields: fields,
  });

  const listView = createStandardList({
    entityName: 'User',
    columns: fields,
  });

  // Create entity configurations
  const userCreateConfig = createEntityConfig('user', createForm);
  const userListConfig = createEntityConfig('user', listView);

  // Combine configurations
  const configs = {
    ...userCreateConfig,
    ...userListConfig,
  };

  console.log('Templates example created:', Object.keys(configs));
  return configs;
}

// Run all examples
export function runExamples() {
  const builderResults = builderPatternExample();
  const jsxResults = jsxStyleExample();
  const crudResults = crudGenerationExample();
  const templateResults = templatesExample();

  return {
    builder: builderResults,
    jsx: jsxResults,
    crud: crudResults,
    templates: templateResults,
  };
}

// Run if this file is executed directly
if (require.main === module) {
  console.log('Running UI Config Builder examples...');
  runExamples();
  console.log('Examples complete!');
}
