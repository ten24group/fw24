/**
 * Tests for UI24 compatibility of generated configurations
 */

import { ListBuilder } from '../core/ListBuilder';
import { FormBuilder } from '../core/FormBuilder';
import { DetailBuilder } from '../core/DetailBuilder';
import { PropertyConfig } from '../types';

// Sample properties for testing
const testProperties: PropertyConfig[] = [
  {
    id: 'id',
    name: 'id',
    type: 'number',
    fieldType: 'number',
    label: 'ID',
    column: 'id',
    isIdentifier: true,
    isListable: true,
  },
  {
    id: 'name',
    name: 'name',
    type: 'string',
    fieldType: 'text',
    label: 'Name',
    column: 'name',
    isCreatable: true,
    isEditable: true,
    isListable: true,
    isVisible: true,
  },
  {
    id: 'email',
    name: 'email',
    type: 'string',
    fieldType: 'email',
    label: 'Email',
    column: 'email',
    isCreatable: true,
    isEditable: true,
    isListable: true,
    isVisible: true,
  },
  {
    id: 'role',
    name: 'role',
    type: 'string',
    fieldType: 'select',
    label: 'Role',
    column: 'role',
    isCreatable: true,
    isEditable: true,
    isListable: true,
    isVisible: true,
    options: [
      { label: 'Admin', value: 'admin' },
      { label: 'User', value: 'user' },
    ],
  },
];

// Property with minimal fields to test auto-completion
const minimalProperty: PropertyConfig = {
  id: 'status',
  name: 'status',
  type: 'string',
  fieldType: 'select',
  label: 'Status',
  column: 'status',
  options: [
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
  ],
};

describe('UI24 Compatibility - ListBuilder', () => {
  it('should generate list configuration in UI24-compatible format', () => {
    const listConfig = new ListBuilder('User').setTitle('User Management').setProperties(testProperties).build();

    // Check basic structure
    expect(listConfig.pageType).toBe('list');
    expect(listConfig.pageTitle).toBe('User Management');
    expect(listConfig.listPageConfig).toBeDefined();

    // Check properties format
    const properties = listConfig.listPageConfig.propertiesConfig;
    expect(properties).toHaveLength(4);

    // Check that each property has required fields
    properties.forEach(prop => {
      expect(prop.name).toBeDefined();
      expect(prop.dataIndex || prop.column).toBeDefined();
      expect(prop.fieldType).toBeDefined();
    });

    // Check API config format
    expect(listConfig.listPageConfig.apiConfig.apiMethod).toBe('GET');
    expect(listConfig.listPageConfig.apiConfig.responseKey).toBe('items');
  });

  it('should add action column when row actions are defined', () => {
    const listConfig = new ListBuilder('User')
      .setProperties([testProperties[0]]) // Just one property
      .addDefaultCrudActions('user')
      .build();

    // Check that actions column was added
    const properties = listConfig.listPageConfig.propertiesConfig;
    expect(properties.length).toBe(2); // Original + actions

    // Find actions column
    const actionsColumn = properties.find(p => p.id === 'actions');
    expect(actionsColumn).toBeDefined();
    expect(actionsColumn?.fieldType).toBe('actions');
    expect(Array.isArray(actionsColumn?.actions)).toBe(true);

    // Check actions
    expect(actionsColumn?.actions).toHaveLength(3); // View, Edit, Delete
  });

  it('should enhance properties with minimal fields', () => {
    const listConfig = new ListBuilder('User').addProperty(minimalProperty).build();

    const property = listConfig.listPageConfig.propertiesConfig[0];

    // Check auto-filled fields
    expect(property.name).toBe('status'); // Should be derived from id
    expect(property.dataIndex).toBe('status'); // Should be derived from column
  });

  it('should set default pagination configuration', () => {
    const listConfig = new ListBuilder('User').setProperties([testProperties[0]]).build();

    // Check pagination config
    const paginationConfig = listConfig.listPageConfig.paginationConfig;
    expect(paginationConfig).toBeDefined();
    expect(paginationConfig?.defaultPageSize).toBe(10);
    expect(paginationConfig?.pageSizeOptions).toEqual([10, 20, 50, 100]);
  });
});

describe('UI24 Compatibility - FormBuilder', () => {
  it('should generate form configuration in UI24-compatible format', () => {
    const formConfig = new FormBuilder('User').setTitle('Create User').setProperties(testProperties).build();

    // Check basic structure
    expect(formConfig.pageType).toBe('form');
    expect(formConfig.pageTitle).toBe('Create User');
    expect(formConfig.formPageConfig).toBeDefined();

    // Check properties format
    const properties = formConfig.formPageConfig.propertiesConfig;
    expect(properties).toHaveLength(4);

    // Check that each property has required fields
    properties.forEach(prop => {
      expect(prop.name).toBeDefined();
      expect(prop.fieldType).toBeDefined();
      expect(prop.label).toBeDefined();
      expect(prop.column).toBeDefined();
    });

    // Check API config format
    expect(formConfig.formPageConfig.apiConfig.apiMethod).toBe('POST');
    expect(formConfig.formPageConfig.apiConfig.apiUrl).toBe('/user');
  });

  it('should enhance properties with minimal fields', () => {
    const formConfig = new FormBuilder('User').addProperty(minimalProperty).build();

    const property = formConfig.formPageConfig.propertiesConfig[0];

    // Check auto-filled fields
    expect(property.name).toBe('status'); // Should be derived from id
    expect(property.label).toBe('Status'); // Already set
    expect(property.column).toBe('status'); // Should be derived from id
  });

  it('should set default form layout', () => {
    const formConfig = new FormBuilder('User').setProperties([testProperties[1]]).build();

    // Check form layout
    expect(formConfig.formPageConfig.formLayout).toBe('horizontal');
  });

  it('should maintain validation configuration', () => {
    const propertyWithValidation: PropertyConfig = {
      id: 'username',
      name: 'username',
      type: 'string',
      fieldType: 'text',
      label: 'Username',
      column: 'username',
      validations: [
        { type: 'required', message: 'Username is required' },
        { type: 'min', value: 3, message: 'Must be at least 3 characters' },
      ],
    };

    const formConfig = new FormBuilder('User').addProperty(propertyWithValidation).build();

    const property = formConfig.formPageConfig.propertiesConfig[0];

    // Check validations
    expect(property.validations).toHaveLength(2);
    expect(property.validations?.[0].type).toBe('required');
    expect(property.validations?.[1].value).toBe(3);
  });
});

describe('UI24 Compatibility - DetailBuilder', () => {
  it('should generate detail configuration in UI24-compatible format', () => {
    const detailConfig = new DetailBuilder('User').setTitle('User Details').setProperties(testProperties).build();

    // Check basic structure
    expect(detailConfig.pageType).toBe('detail');
    expect(detailConfig.pageTitle).toBe('User Details');
    expect(detailConfig.detailPageConfig).toBeDefined();

    // Check properties format
    const properties = detailConfig.detailPageConfig.propertiesConfig;
    expect(properties).toHaveLength(4);

    // Check that each property has required fields
    properties.forEach(prop => {
      expect(prop.name).toBeDefined();
      expect(prop.fieldType).toBeDefined();
      expect(prop.label).toBeDefined();
      expect(prop.column).toBeDefined();
    });

    // Check API config format
    expect(detailConfig.detailPageConfig.apiConfig.apiMethod).toBe('GET');
    expect(detailConfig.detailPageConfig.apiConfig.apiUrl).toBe('/user');
  });

  it('should enhance properties with minimal fields', () => {
    const detailConfig = new DetailBuilder('User').addProperty(minimalProperty).build();

    const property = detailConfig.detailPageConfig.propertiesConfig[0];

    // Check auto-filled fields
    expect(property.name).toBe('status'); // Should be derived from id
    expect(property.label).toBe('Status'); // Already set
    expect(property.column).toBe('status'); // Should be derived from id
  });

  it('should set default layout', () => {
    const detailConfig = new DetailBuilder('User').setProperties([testProperties[1]]).build();

    // Check layout
    expect(detailConfig.detailPageConfig.layout).toBe('descriptive');
  });

  it('should configure header actions properly', () => {
    const detailConfig = new DetailBuilder('User')
      .setProperties([testProperties[0]])
      .addDefaultEditAction('user')
      .addDefaultDeleteAction('user')
      .build();

    // Check header actions
    expect(detailConfig.pageHeaderActions).toHaveLength(2);

    // Check edit action
    const editAction = detailConfig.pageHeaderActions?.[0];
    expect(editAction?.label).toBe('Edit');
    expect(editAction?.icon).toBe('edit');
    expect(editAction?.url).toContain('/edit-user/');

    // Check delete action
    const deleteAction = detailConfig.pageHeaderActions?.[1];
    expect(deleteAction?.label).toBe('Delete');
    expect(deleteAction?.icon).toBe('delete');
    expect(deleteAction?.openInModal).toBe(true);
    expect(deleteAction?.modalConfig?.modalType).toBe('confirm');
  });
});

describe('UI24 Compatibility - Integration', () => {
  it('should produce configuration objects with matching structure', () => {
    // Create configs with different builders
    const listConfig = new ListBuilder('User').setProperties([testProperties[0], testProperties[1]]).build();

    const formConfig = new FormBuilder('User').setProperties([testProperties[0], testProperties[1]]).build();

    const detailConfig = new DetailBuilder('User').setProperties([testProperties[0], testProperties[1]]).build();

    // Create integrated UI24 config
    const ui24Config = {
      entities: {
        'list-user': listConfig,
        'create-user': formConfig,
        'view-user': detailConfig,
      },
      menu: {
        items: [],
      },
    };

    // Verify structure matches expected UI24 format
    expect(ui24Config.entities).toBeDefined();
    expect(ui24Config.entities['list-user']).toBeDefined();
    expect(ui24Config.entities['create-user']).toBeDefined();
    expect(ui24Config.entities['view-user']).toBeDefined();

    // Verify page types are correct in the integration
    expect(ui24Config.entities['list-user'].pageType).toBe('list');
    expect(ui24Config.entities['create-user'].pageType).toBe('form');
    expect(ui24Config.entities['view-user'].pageType).toBe('detail');
  });
});
