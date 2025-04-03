/**
 * Example of generating UI configurations for a User entity
 *
 * This example demonstrates how to:
 * 1. Define entity properties with validations and options
 * 2. Create individual configurations for list, create, edit, and detail views
 * 3. Combine configurations into a complete UI24-compatible object
 */

import {
  createEntityUIConfig,
  createListBuilder,
  createFormBuilder,
  createDetailBuilder,
  createMenuBuilder,
} from '../core';
import { PropertyConfig } from '../types';

/**
 * Define User entity properties
 * Each property includes metadata about:
 * - Data type
 * - UI field type
 * - Validation rules
 * - Visibility in different contexts (list, create, edit, view)
 */
const userProperties: PropertyConfig[] = [
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
    isEditable: false,
    isCreatable: false,
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
    validations: [
      { type: 'required', message: 'Full name is required' },
      { type: 'min', value: 3, message: 'Full name must be at least 3 characters' },
    ],
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
    validations: [
      { type: 'required', message: 'Email is required' },
      { type: 'email', message: 'Please enter a valid email address' },
    ],
  },
  {
    id: 'role',
    name: 'role',
    type: 'string',
    fieldType: 'select',
    label: 'User Role',
    column: 'role',
    isCreatable: true,
    isEditable: true,
    isListable: true,
    isVisible: true,
    isRequired: true,
    options: [
      { label: 'Administrator', value: 'admin' },
      { label: 'Standard User', value: 'user' },
      { label: 'Viewer', value: 'viewer' },
    ],
    validations: [{ type: 'required', message: 'Role is required' }],
  },
  {
    id: 'status',
    name: 'status',
    type: 'string',
    fieldType: 'select',
    label: 'Status',
    column: 'status',
    isCreatable: true,
    isEditable: true,
    isListable: true,
    isVisible: true,
    options: [
      { label: 'Active', value: 'active' },
      { label: 'Inactive', value: 'inactive' },
      { label: 'Pending', value: 'pending' },
    ],
  },
  {
    id: 'lastLogin',
    name: 'lastLogin',
    type: 'date',
    fieldType: 'datetime',
    label: 'Last Login',
    column: 'lastLogin',
    isListable: true,
    isVisible: true,
    isEditable: false,
    isCreatable: false,
  },
  {
    id: 'createdAt',
    name: 'createdAt',
    type: 'date',
    fieldType: 'datetime',
    label: 'Created At',
    column: 'createdAt',
    isListable: true,
    isVisible: true,
    isEditable: false,
    isCreatable: false,
  },
];

/**
 * Method 1: Using createEntityUIConfig
 *
 * This is the simplest approach that generates all configurations at once
 */
export function generateUserUIConfigsWithEntityUIConfig() {
  // Step 1: Use createEntityUIConfig to generate all configurations
  const entityConfigs = createEntityUIConfig('User', {
    list: true,
    create: true,
    edit: true,
    view: true,
    menuIcon: 'user',
    // In a real scenario, the entity builder would have access to properties
    // through a metadata service or similar mechanism
  });

  // Add properties to all configurations
  // (In a real implementation, this might be handled internally by a service)
  // For this example, we'll manually apply the properties to all configs

  // Return the generated configs
  return entityConfigs;
}

/**
 * Method 2: Using individual builders for more customization
 *
 * This approach provides more control over each configuration
 */
export function generateUserUIConfigsWithBuilders() {
  // Step 1: Create list configuration
  const listBuilder = createListBuilder('User').setTitle('User Management');

  // Add properties that should appear in the list
  userProperties.forEach(prop => {
    if (prop.isListable) {
      listBuilder.addProperty(prop);
    }
  });

  // Configure search and filtering
  listBuilder.setSearchConfig({
    fields: ['fullName', 'email'],
    placeholder: 'Search users...',
  });

  // Add row actions
  listBuilder.addDefaultViewAction('User');
  listBuilder.addDefaultEditAction('User');
  listBuilder.addDefaultDeleteAction('User');

  // Configure pagination
  listBuilder.setPaginationConfig({
    defaultPageSize: 20,
    showSizeChanger: true,
    pageSizeOptions: [10, 20, 50, 100],
  });

  // Build the list configuration
  const listConfig = listBuilder.build();

  // Step 2: Create form configuration
  const formBuilder = createFormBuilder('User').setTitle('Create User');

  // Add properties that should appear in the create form
  userProperties.forEach(prop => {
    if (prop.isCreatable) {
      formBuilder.addProperty(prop);
    }
  });

  // Configure form API
  formBuilder.setApiConfig({
    apiMethod: 'POST',
    apiUrl: '/user',
    responseKey: 'user',
  });

  // Add navigation actions
  formBuilder.addHeaderAction({
    label: 'Back to List',
    url: '/list-user',
    icon: 'arrowLeft',
  });

  // Build the create form configuration
  const createConfig = formBuilder.build();

  // Step 3: Edit form configuration
  const editFormBuilder = createFormBuilder('User').setTitle('Edit User');

  // Add properties that should appear in the edit form
  userProperties.forEach(prop => {
    if (prop.isEditable) {
      editFormBuilder.addProperty(prop);
    }
  });

  // Configure form API for edit
  editFormBuilder.setApiConfig({
    apiMethod: 'PATCH',
    apiUrl: '/user/:id',
    responseKey: 'user',
  });

  // Configure API for loading existing data
  const formConfig = editFormBuilder.getConfig();
  if (formConfig.formPageConfig) {
    formConfig.formPageConfig.detailApiConfig = {
      apiMethod: 'GET',
      apiUrl: '/user/:id',
      responseKey: 'user',
    };
    editFormBuilder.set('formPageConfig', formConfig.formPageConfig);
  }

  // Add navigation actions
  editFormBuilder.addHeaderAction({
    label: 'Back to List',
    url: '/list-user',
    icon: 'arrowLeft',
  });

  // Build the edit form configuration
  const editConfig = editFormBuilder.build();

  // Step 4: Detail view configuration
  const detailBuilder = createDetailBuilder('User').setTitle('User Details');

  // Add properties that should appear in the detail view
  userProperties.forEach(prop => {
    if (prop.isVisible) {
      detailBuilder.addProperty(prop);
    }
  });

  // Configure API for loading data
  detailBuilder.setApiConfig({
    apiMethod: 'GET',
    apiUrl: '/user/:id',
    responseKey: 'user',
  });

  // Add header actions
  detailBuilder.addHeaderAction({
    label: 'Back to List',
    url: '/list-user',
    icon: 'arrowLeft',
  });

  detailBuilder.addDefaultEditAction('User');

  // Build the detail view configuration
  const viewConfig = detailBuilder.build();

  // Step 5: Combine all configurations into a UI24-compatible object
  return {
    'list-user': listConfig,
    'create-user': createConfig,
    'edit-user': editConfig,
    'view-user': viewConfig,
  };
}

/**
 * Method 3: Create a complete UI24 configuration including menu
 */
export function generateCompleteUserUI24Config() {
  // Generate entity configurations
  const entityConfigs = generateUserUIConfigsWithBuilders();

  // Create menu configuration
  const menuBuilder = createMenuBuilder().addItem({
    key: 'user',
    title: 'Users',
    icon: 'user',
    url: '/list-user',
  });

  const menuConfig = menuBuilder.build();

  // Combine into a complete UI24 configuration
  return {
    entities: entityConfigs,
    menu: menuConfig,
    // Other global UI24 configuration options could be added here
  };
}

// Usage example
export function main() {
  // Option 1: Quick config generation
  const simpleConfigs = generateUserUIConfigsWithEntityUIConfig();
  console.log('Simple configs:', Object.keys(simpleConfigs));

  // Option 2: Custom builder approach
  const customConfigs = generateUserUIConfigsWithBuilders();
  console.log('Custom configs:', Object.keys(customConfigs));

  // Option 3: Complete UI24 configuration
  const completeConfig = generateCompleteUserUI24Config();
  console.log('Complete UI24 config sections:', Object.keys(completeConfig));

  return completeConfig;
}
