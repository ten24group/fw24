/**
 * Example test for generating UI24 configurations for a User entity
 */

import { createEntityUIConfig, createListBuilder, createFormBuilder, createDetailBuilder } from '../../core';
import { PropertyConfig } from '../../types';

// Define User entity properties for the example
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

describe('User Entity UI Configuration Example', () => {
  // Example using createEntityUIConfig by creating all the builders manually and then constructing the config object
  it('should generate all User entity configurations with createEntityUIConfig approach', () => {
    // Create list config
    const listBuilder = createListBuilder('User');
    userProperties.forEach(prop => {
      if (prop.isListable) {
        listBuilder.addProperty(prop);
      }
    });
    const listConfig = listBuilder.build();

    // Create form config
    const createBuilder = createFormBuilder('User');
    createBuilder.setTitle('Create User');
    userProperties.forEach(prop => {
      if (prop.isCreatable) {
        createBuilder.addProperty(prop);
      }
    });
    const createConfig = createBuilder.build();

    // Edit form config
    const editBuilder = createFormBuilder('User');
    editBuilder.setTitle('Update User');
    userProperties.forEach(prop => {
      if (prop.isEditable) {
        editBuilder.addProperty(prop);
      }
    });
    editBuilder.setApiConfig({
      apiMethod: 'PATCH',
      apiUrl: '/user/:id',
      responseKey: 'user',
    });
    const editConfig = editBuilder.build();

    // View config
    const viewBuilder = createDetailBuilder('User');
    viewBuilder.setTitle('User Details');
    userProperties.forEach(prop => {
      if (prop.isVisible) {
        viewBuilder.addProperty(prop);
      }
    });
    const viewConfig = viewBuilder.build();

    // Combine all configs
    const userConfigs = {
      'list-user': listConfig,
      'create-user': createConfig,
      'edit-user': editConfig,
      'view-user': viewConfig,
    };

    // Validate the generated configs
    expect(userConfigs).toBeDefined();
    expect(Object.keys(userConfigs).length).toBe(4);

    // List config
    expect(userConfigs['list-user']).toBeDefined();
    expect(listConfig.pageType).toBe('list');
    expect(listConfig.pageTitle).toBe('User Listing');
    expect(listConfig.listPageConfig.propertiesConfig.length).toBeGreaterThan(0);

    // Create config
    expect(userConfigs['create-user']).toBeDefined();
    expect(createConfig.pageType).toBe('form');
    expect(createConfig.pageTitle).toBe('Create User');
    expect(createConfig.formPageConfig.propertiesConfig.length).toBeGreaterThan(0);

    // Edit config
    expect(userConfigs['edit-user']).toBeDefined();
    expect(editConfig.pageType).toBe('form');
    expect(editConfig.pageTitle).toBe('Update User');
    expect(editConfig.formPageConfig.propertiesConfig.length).toBeGreaterThan(0);

    // View config
    expect(userConfigs['view-user']).toBeDefined();
    expect(viewConfig.pageType).toBe('detail');
    expect(viewConfig.pageTitle).toBe('User Details');
    expect(viewConfig.detailPageConfig.propertiesConfig.length).toBeGreaterThan(0);
  });

  // Example using individual builders for more customization
  it('should allow custom configuration with individual builders', () => {
    // Create list configuration with customizations
    const listBuilder = createListBuilder('User');

    // Add properties
    userProperties.forEach(prop => {
      if (prop.isListable) {
        listBuilder.addProperty(prop);
      }
    });

    // Configure search on specific fields
    listBuilder.setSearchConfig({
      fields: ['fullName', 'email'],
      placeholder: 'Search users...',
    });

    // Set pagination
    listBuilder.setPaginationConfig({
      defaultPageSize: 20,
      showSizeChanger: true,
    });

    // Add actions
    listBuilder.addDefaultViewAction('User');
    listBuilder.addDefaultEditAction('User');
    listBuilder.addDefaultDeleteAction('User');

    const listConfig = listBuilder.build();

    // Create form configuration with customizations
    const formBuilder = createFormBuilder('User');

    // Add properties
    userProperties.forEach(prop => {
      if (prop.isCreatable) {
        formBuilder.addProperty(prop);
      }
    });

    const createConfig = formBuilder.build();

    // Edit form configuration
    const editFormBuilder = createFormBuilder('User');

    // Add properties first
    userProperties.forEach(prop => {
      if (prop.isEditable) {
        editFormBuilder.addProperty(prop);
      }
    });

    // Then update the API configuration for edit mode
    editFormBuilder.setApiConfig({
      apiMethod: 'PATCH',
      apiUrl: '/user/:id',
      responseKey: 'user',
    });

    // Set detail API config for loading existing data
    const formConfig = editFormBuilder.getConfig();
    if (formConfig.formPageConfig) {
      formConfig.formPageConfig.detailApiConfig = {
        apiMethod: 'GET',
        apiUrl: '/user/:id',
        responseKey: 'user',
      };
      editFormBuilder.set('formPageConfig', formConfig.formPageConfig);
    }

    const editConfig = editFormBuilder.build();

    // Detail view configuration
    const detailBuilder = createDetailBuilder('User');

    // Add properties
    userProperties.forEach(prop => {
      if (prop.isVisible) {
        detailBuilder.addProperty(prop);
      }
    });

    // Add header actions
    detailBuilder.addDefaultEditAction('User');

    const viewConfig = detailBuilder.build();

    // Validate custom configurations
    expect(listConfig).toBeDefined();
    expect(listConfig.pageType).toBe('list');
    expect(listConfig.listPageConfig.searchConfig).toBeDefined();
    expect(listConfig.listPageConfig.searchConfig?.fields).toContain('fullName');
    expect(listConfig.listPageConfig.searchConfig?.fields).toContain('email');

    expect(createConfig).toBeDefined();
    expect(createConfig.pageType).toBe('form');

    expect(viewConfig).toBeDefined();
    expect(viewConfig.pageType).toBe('detail');
    expect(viewConfig.detailPageConfig.propertiesConfig.length).toBeGreaterThan(0);
  });
});
