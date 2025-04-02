/**
 * Builder Pattern Examples for UI Config Builder
 *
 * This file demonstrates how to use the builder pattern to create UI configurations
 */

import {
  createFormBuilder,
  createListBuilder,
  createDetailBuilder,
  createEntityUIConfig,
  createEntityUIConfigFromTemplates,
} from '../core';
import { PropertyConfig } from '../types';

/**
 * Example using individual builders for different page types
 */
function individualBuilderExample() {
  // Create a list configuration
  const listBuilder = createListBuilder('user')
    .setTitle('User Management')
    .addHeaderAction({
      label: 'Create User',
      url: '/create-user',
      icon: 'plus',
    })
    .addProperty({
      id: 'name',
      name: 'name',
      type: 'string',
      fieldType: 'text',
      label: 'Full Name',
      column: 'name',
      isSearchable: true,
      isFilterable: true,
    })
    .addProperty({
      id: 'email',
      name: 'email',
      type: 'string',
      fieldType: 'email',
      label: 'Email Address',
      column: 'email',
      isSearchable: true,
    })
    .addProperty({
      id: 'role',
      name: 'role',
      type: 'string',
      fieldType: 'select',
      label: 'Role',
      column: 'role',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'User', value: 'user' },
        { label: 'Guest', value: 'guest' },
      ],
      isFilterable: true,
    })
    .addProperty({
      id: 'active',
      name: 'active',
      type: 'boolean',
      fieldType: 'switch',
      label: 'Status',
      column: 'active',
    });

  // Add row actions to the list
  listBuilder
    .addRowAction({
      label: 'View',
      url: '/view-user/:id',
      icon: 'eye',
    })
    .addRowAction({
      label: 'Edit',
      url: '/edit-user/:id',
      icon: 'edit',
    })
    .addRowAction({
      label: 'Delete',
      icon: 'delete',
      modalConfig: {
        modalType: 'confirm',
        title: 'Delete User',
        content: 'Are you sure you want to delete this user? This action cannot be undone.',
        apiConfig: {
          apiMethod: 'DELETE',
          apiUrl: '/api/users/:id',
        },
      },
    });

  // Create a form configuration
  const formBuilder = createFormBuilder('user')
    .setTitle('Create User')
    .addHeaderAction({
      label: 'Back to List',
      url: '/list-user',
      icon: 'arrowLeft',
    })
    .setApiConfig({
      apiMethod: 'POST',
      apiUrl: '/api/users',
      responseKey: 'user',
    })
    .addProperty({
      id: 'name',
      name: 'name',
      type: 'string',
      fieldType: 'text',
      label: 'Full Name',
      column: 'name',
      validations: [{ required: true, message: 'Please enter a name' }],
    })
    .addProperty({
      id: 'email',
      name: 'email',
      type: 'string',
      fieldType: 'email',
      label: 'Email Address',
      column: 'email',
      validations: [
        { required: true, message: 'Please enter an email address' },
        { email: true, message: 'Please enter a valid email address' },
      ],
    })
    .addProperty({
      id: 'role',
      name: 'role',
      type: 'string',
      fieldType: 'select',
      label: 'Role',
      column: 'role',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'User', value: 'user' },
        { label: 'Guest', value: 'guest' },
      ],
      validations: [{ required: true, message: 'Please select a role' }],
    })
    .addProperty({
      id: 'password',
      name: 'password',
      type: 'string',
      fieldType: 'password',
      label: 'Password',
      column: 'password',
      validations: [
        { required: true, message: 'Please enter a password' },
        { minLength: 8, message: 'Password must be at least 8 characters' },
      ],
    })
    .addProperty({
      id: 'active',
      name: 'active',
      type: 'boolean',
      fieldType: 'switch',
      label: 'Active Account',
      column: 'active',
      defaultValue: true,
    })
    .setSubmitSuccessRedirect('/list-user');

  // Create a detail view configuration
  const detailBuilder = createDetailBuilder('user')
    .setTitle('User Details')
    .addHeaderAction({
      label: 'Back to List',
      url: '/list-user',
      icon: 'arrowLeft',
    })
    .addHeaderAction({
      label: 'Edit',
      url: '/edit-user/:id',
      icon: 'edit',
    })
    .setApiConfig({
      apiMethod: 'GET',
      apiUrl: '/api/users/:id',
      responseKey: 'user',
    })
    .addProperty({
      id: 'name',
      name: 'name',
      type: 'string',
      fieldType: 'text',
      label: 'Full Name',
      column: 'name',
    })
    .addProperty({
      id: 'email',
      name: 'email',
      type: 'string',
      fieldType: 'email',
      label: 'Email Address',
      column: 'email',
    })
    .addProperty({
      id: 'role',
      name: 'role',
      type: 'string',
      fieldType: 'text',
      label: 'Role',
      column: 'role',
    })
    .addProperty({
      id: 'active',
      name: 'active',
      type: 'boolean',
      fieldType: 'switch',
      label: 'Status',
      column: 'active',
    })
    .addProperty({
      id: 'createdAt',
      name: 'createdAt',
      type: 'date',
      fieldType: 'date',
      label: 'Created Date',
      column: 'createdAt',
    });

  // Build configurations
  const listConfig = listBuilder.build();
  const formConfig = formBuilder.build();
  const detailConfig = detailBuilder.build();

  // Return combined configurations
  return {
    'list-user': listConfig,
    'create-user': formConfig,
    'view-user': detailConfig,
  };
}

/**
 * Example using the convenience function to generate complete CRUD UI
 */
function completeEntityExample() {
  // Generate complete CRUD configurations for a User entity
  const userConfigs = createEntityUIConfig('user', {
    list: true,
    create: true,
    edit: true,
    view: true,
    menuIcon: 'userGroup',
    customConfigs: {
      // Add any custom configurations here
    },
  });

  return userConfigs;
}

/**
 * Example using templates with entity fields
 */
function templateBasedExample() {
  // Define fields for the entity
  const fields: PropertyConfig[] = [
    {
      id: 'name',
      name: 'name',
      type: 'string',
      fieldType: 'text',
      label: 'Full Name',
      column: 'name',
      validations: [{ required: true, message: 'Please enter a name' }],
    },
    {
      id: 'email',
      name: 'email',
      type: 'string',
      fieldType: 'email',
      label: 'Email Address',
      column: 'email',
      validations: [{ required: true, message: 'Please enter an email address' }],
    },
    {
      id: 'role',
      name: 'role',
      type: 'string',
      fieldType: 'select',
      label: 'Role',
      column: 'role',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'User', value: 'user' },
        { label: 'Guest', value: 'guest' },
      ],
    },
    {
      id: 'active',
      name: 'active',
      type: 'boolean',
      fieldType: 'switch',
      label: 'Active',
      column: 'active',
      defaultValue: true,
    },
  ];

  // Generate entity UI config from templates
  const userConfigsFromTemplates = createEntityUIConfigFromTemplates('user', {
    fields,
    list: true,
    create: true,
    edit: true,
    view: true,
  });

  return userConfigsFromTemplates;
}

// Export all examples
export { individualBuilderExample, completeEntityExample, templateBasedExample };
