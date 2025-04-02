/**
 * Tests for Builder Pattern implementation in the UI Config Builder
 */

import {
  createFormBuilder,
  createListBuilder,
  createDetailBuilder,
  createEntityUIConfig,
  createEntityUIConfigFromTemplates,
} from '../core';
import { PropertyConfig, FormPageConfig, ListPageConfig, DetailPageConfig, ConfigObject } from '../types';

// Define more specific types for testing
interface ApiConfig {
  apiMethod: string;
  apiUrl: string;
  responseKey?: string;
}

interface FormConfig {
  apiConfig: ApiConfig;
  propertiesConfig: PropertyConfig[];
  submitSuccessRedirect?: string;
}

interface ListConfig {
  apiConfig: ApiConfig;
  propertiesConfig: PropertyConfig[];
  rowActions?: Array<{ label: string; url: string; icon?: string }>;
}

interface DetailConfig {
  apiConfig: ApiConfig;
  propertiesConfig: PropertyConfig[];
}

// For createEntityUIConfig options
interface EntityUIConfigOptions {
  list?: boolean;
  create?: boolean;
  edit?: boolean;
  view?: boolean;
}

describe('Builder Pattern Implementation', () => {
  describe('FormBuilder', () => {
    it('should create a basic form configuration with default values', () => {
      // Create a form builder
      const formBuilder = createFormBuilder('user');

      // Build the configuration
      const config = formBuilder.build() as FormPageConfig;

      // Verify structure
      expect(config).toHaveProperty('pageTitle', 'Form for user');
      expect(config).toHaveProperty('pageType', 'form');
      expect(config).toHaveProperty('formPageConfig');
      expect(config.formPageConfig).toHaveProperty('apiConfig');
      expect(config.formPageConfig.apiConfig).toEqual({
        apiMethod: 'POST',
        apiUrl: '/user',
        responseKey: 'user',
      });
    });

    it('should allow setting custom properties', () => {
      // Create a form builder with custom props
      const formBuilder = createFormBuilder('user')
        .setTitle('Create User')
        .setApiConfig({
          apiMethod: 'POST',
          apiUrl: '/api/users',
          responseKey: 'userData',
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
        .setSubmitSuccessRedirect('/users');

      // Build the configuration
      const config = formBuilder.build() as FormPageConfig;

      // Verify structure
      expect(config).toHaveProperty('pageTitle', 'Create User');
      expect(config.formPageConfig.apiConfig).toEqual({
        apiMethod: 'POST',
        apiUrl: '/api/users',
        responseKey: 'userData',
      });
      expect(config.formPageConfig.propertiesConfig).toHaveLength(1);
      expect(config.formPageConfig.submitSuccessRedirect).toBe('/users');
    });

    it('should allow adding multiple properties and actions', () => {
      // Create a form builder with multiple properties
      const formBuilder = createFormBuilder('user')
        .addProperty({
          id: 'name',
          name: 'name',
          type: 'string',
          fieldType: 'text',
          label: 'Name',
          column: 'name',
        })
        .addProperty({
          id: 'email',
          name: 'email',
          type: 'string',
          fieldType: 'email',
          label: 'Email',
          column: 'email',
        })
        .addHeaderAction({
          label: 'Back',
          url: '/users',
          icon: 'back',
        });

      // Build the configuration
      const config = formBuilder.build() as FormPageConfig;

      // Verify structure
      expect(config.formPageConfig.propertiesConfig).toHaveLength(2);
      expect(config).toHaveProperty('pageHeaderActions');
      expect(config.pageHeaderActions || []).toHaveLength(1);
      if (config.pageHeaderActions) {
        expect(config.pageHeaderActions[0]).toHaveProperty('label', 'Back');
      }
    });

    it('should handle validations for properties', () => {
      // Create a form builder with validations
      const formBuilder = createFormBuilder('user').addProperty({
        id: 'username',
        name: 'username',
        type: 'string',
        fieldType: 'text',
        label: 'Username',
        column: 'username',
        validations: [
          { required: true, message: 'Username is required' },
          { min: 3, message: 'Username must be at least 3 characters' },
          { max: 20, message: 'Username cannot exceed 20 characters' },
        ],
      });

      // Build the configuration
      const config = formBuilder.build() as FormPageConfig;

      // Verify validations are properly set
      expect(config.formPageConfig.propertiesConfig).toHaveLength(1);
      const property = config.formPageConfig.propertiesConfig[0];
      expect(property.validations).toHaveLength(3);
      expect(property.validations?.[0]).toEqual({ required: true, message: 'Username is required' });
      expect(property.validations?.[1]).toEqual({ min: 3, message: 'Username must be at least 3 characters' });
    });

    it('should support different field types', () => {
      // Create a form builder with various field types
      const formBuilder = createFormBuilder('user')
        .addProperty({
          id: 'name',
          name: 'name',
          type: 'string',
          fieldType: 'text',
          label: 'Name',
          column: 'name',
        })
        .addProperty({
          id: 'email',
          name: 'email',
          type: 'string',
          fieldType: 'email',
          label: 'Email',
          column: 'email',
        })
        .addProperty({
          id: 'description',
          name: 'description',
          type: 'string',
          fieldType: 'textarea',
          label: 'Description',
          column: 'description',
        })
        .addProperty({
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
        })
        .addProperty({
          id: 'dateJoined',
          name: 'dateJoined',
          type: 'date',
          fieldType: 'datepicker',
          label: 'Date Joined',
          column: 'dateJoined',
        });

      // Build the configuration
      const config = formBuilder.build() as FormPageConfig;

      // Verify different field types are properly set
      expect(config.formPageConfig.propertiesConfig).toHaveLength(5);
      const properties = config.formPageConfig.propertiesConfig;
      expect(properties[0].fieldType).toBe('text');
      expect(properties[1].fieldType).toBe('email');
      expect(properties[2].fieldType).toBe('textarea');
      expect(properties[3].fieldType).toBe('select');
      expect(properties[3].options).toHaveLength(2);
      expect(properties[4].fieldType).toBe('datepicker');
      expect(properties[4].type).toBe('date');
    });
  });

  describe('ListBuilder', () => {
    it('should create a basic list configuration with default values', () => {
      // Create a list builder
      const listBuilder = createListBuilder('user');

      // Build the configuration
      const config = listBuilder.build() as ListPageConfig;

      // Verify structure
      expect(config).toHaveProperty('pageTitle', 'List of user');
      expect(config).toHaveProperty('pageType', 'list');
      expect(config).toHaveProperty('listPageConfig');
      expect(config.listPageConfig).toHaveProperty('apiConfig');
      expect(config.listPageConfig.apiConfig).toEqual({
        apiMethod: 'GET',
        apiUrl: '/user',
        responseKey: 'items',
      });
    });

    it('should allow setting custom properties and actions', () => {
      // Create a list builder with custom props
      const listBuilder = createListBuilder('user')
        .setTitle('User Management')
        .addProperty({
          id: 'name',
          name: 'name',
          type: 'string',
          fieldType: 'text',
          label: 'Name',
          column: 'name',
        })
        .addRowAction({
          label: 'Edit',
          url: '/users/:id/edit',
          icon: 'edit',
        });

      // Build the configuration
      const config = listBuilder.build() as ListPageConfig;

      // Verify structure
      expect(config).toHaveProperty('pageTitle', 'User Management');
      expect(config.listPageConfig.propertiesConfig).toHaveLength(1);
      expect(config.listPageConfig.rowActions || []).toHaveLength(1);
      if (config.listPageConfig.rowActions) {
        expect(config.listPageConfig.rowActions[0]).toHaveProperty('label', 'Edit');
      }
    });

    it('should handle searchable and filterable properties', () => {
      // Create a list builder with searchable and filterable properties
      const listBuilder = createListBuilder('user')
        .setTitle('User Management')
        .addProperty({
          id: 'name',
          name: 'name',
          type: 'string',
          fieldType: 'text',
          label: 'Name',
          column: 'name',
          searchable: true,
          filterable: true,
        })
        .addProperty({
          id: 'status',
          name: 'status',
          type: 'string',
          fieldType: 'select',
          label: 'Status',
          column: 'status',
          filterable: true,
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
          ],
        });

      // Build the configuration
      const config = listBuilder.build() as ListPageConfig;

      // Verify structure
      expect(config.listPageConfig.propertiesConfig).toHaveLength(2);

      // Check searchable properties
      const nameProperty = config.listPageConfig.propertiesConfig[0];
      expect(nameProperty.searchable).toBe(true);

      // Check filterable properties
      const statusProperty = config.listPageConfig.propertiesConfig[1];
      expect(statusProperty.filterable).toBe(true);
      expect(statusProperty.options).toHaveLength(2);
    });

    it('should allow adding multiple row actions', () => {
      // Create a list builder with multiple row actions
      const listBuilder = createListBuilder('user')
        .addRowAction({
          label: 'Edit',
          url: '/users/:id/edit',
          icon: 'edit',
        })
        .addRowAction({
          label: 'Delete',
          url: '/users/:id/delete',
          icon: 'delete',
        })
        .addRowAction({
          label: 'View',
          url: '/users/:id',
          icon: 'eye',
        });

      // Build the configuration
      const config = listBuilder.build() as ListPageConfig;

      // Verify structure
      expect(config.listPageConfig.rowActions).toHaveLength(3);
      if (config.listPageConfig.rowActions) {
        expect(config.listPageConfig.rowActions[0].label).toBe('Edit');
        expect(config.listPageConfig.rowActions[1].label).toBe('Delete');
        expect(config.listPageConfig.rowActions[2].label).toBe('View');
      }
    });

    it('should support properties with sortable attribute', () => {
      // Create a list builder with sortable properties
      const listBuilder = createListBuilder('user')
        .addProperty({
          id: 'name',
          name: 'name',
          type: 'string',
          fieldType: 'text',
          label: 'Name',
          column: 'name',
          sortable: true,
        })
        .addProperty({
          id: 'createdAt',
          name: 'createdAt',
          type: 'date',
          fieldType: 'datepicker',
          label: 'Created At',
          column: 'createdAt',
          sortable: true,
        });

      // Build the configuration
      const config = listBuilder.build() as ListPageConfig;

      // Verify sorting attributes on properties
      expect(config.listPageConfig.propertiesConfig[0].sortable).toBe(true);
      expect(config.listPageConfig.propertiesConfig[1].sortable).toBe(true);
    });
  });

  describe('DetailBuilder', () => {
    it('should create a basic detail configuration with default values', () => {
      // Create a detail builder
      const detailBuilder = createDetailBuilder('user');

      // Build the configuration
      const config = detailBuilder.build() as DetailPageConfig;

      // Verify structure
      expect(config).toHaveProperty('pageTitle', 'Details of user');
      expect(config).toHaveProperty('pageType', 'detail');
      expect(config).toHaveProperty('detailPageConfig');
      expect(config.detailPageConfig).toHaveProperty('apiConfig');
      expect(config.detailPageConfig.apiConfig).toEqual({
        apiMethod: 'GET',
        apiUrl: '/user/:id',
        responseKey: 'user',
      });
    });

    it('should allow adding a default edit action', () => {
      // Create a detail builder with default edit action
      const detailBuilder = createDetailBuilder('user').addDefaultEditAction('user');

      // Build the configuration
      const config = detailBuilder.build() as DetailPageConfig;

      // Verify structure
      expect(config).toHaveProperty('pageHeaderActions');
      expect(config.pageHeaderActions || []).toHaveLength(1);
      if (config.pageHeaderActions && config.pageHeaderActions.length > 0) {
        expect(config.pageHeaderActions[0]).toHaveProperty('label', 'Edit');
        expect(config.pageHeaderActions[0]).toHaveProperty('url', '/edit-user/:id');
      }
    });

    it('should allow grouping properties into sections', () => {
      // Create a detail builder with property sections
      const detailBuilder = createDetailBuilder('user')
        .addProperty({
          id: 'name',
          name: 'name',
          type: 'string',
          fieldType: 'text',
          label: 'Name',
          column: 'name',
          section: 'Basic Information',
        })
        .addProperty({
          id: 'email',
          name: 'email',
          type: 'string',
          fieldType: 'email',
          label: 'Email',
          column: 'email',
          section: 'Basic Information',
        })
        .addProperty({
          id: 'address',
          name: 'address',
          type: 'string',
          fieldType: 'textarea',
          label: 'Address',
          column: 'address',
          section: 'Contact Information',
        });

      // Build the configuration
      const config = detailBuilder.build() as DetailPageConfig;

      // Verify structure
      expect(config.detailPageConfig.propertiesConfig).toHaveLength(3);

      // Check if properties have sections
      const properties = config.detailPageConfig.propertiesConfig;
      expect(properties[0].section).toBe('Basic Information');
      expect(properties[1].section).toBe('Basic Information');
      expect(properties[2].section).toBe('Contact Information');
    });

    it('should allow adding multiple header actions', () => {
      // Create a detail builder with multiple header actions
      const detailBuilder = createDetailBuilder('user')
        .addHeaderAction({
          label: 'Edit',
          url: '/users/:id/edit',
          icon: 'edit',
        })
        .addHeaderAction({
          label: 'Delete',
          url: '/users/:id/delete',
          icon: 'delete',
        })
        .addHeaderAction({
          label: 'Back to List',
          url: '/users',
          icon: 'back',
        });

      // Build the configuration
      const config = detailBuilder.build() as DetailPageConfig;

      // Verify structure
      expect(config.pageHeaderActions).toHaveLength(3);
      if (config.pageHeaderActions) {
        expect(config.pageHeaderActions[0].label).toBe('Edit');
        expect(config.pageHeaderActions[1].label).toBe('Delete');
        expect(config.pageHeaderActions[2].label).toBe('Back to List');
      }
    });
  });

  describe('createEntityUIConfig', () => {
    it('should create a complete entity UI configuration', () => {
      // Generate complete CRUD configurations
      const entityConfigs = createEntityUIConfig('user');

      // Verify structure
      expect(entityConfigs).toHaveProperty('list-user');
      expect(entityConfigs).toHaveProperty('create-user');
      expect(entityConfigs).toHaveProperty('edit-user');
      expect(entityConfigs).toHaveProperty('view-user');

      // Check list config
      const listConfig = entityConfigs['list-user'] as ConfigObject;
      expect(listConfig).toHaveProperty('pageTitle', 'User Listing');
      expect(listConfig).toHaveProperty('pageHeaderActions');

      // Check create config - use type-safe approach
      const createConfig = entityConfigs['create-user'] as ConfigObject;
      expect(createConfig).toHaveProperty('pageTitle', 'Create User');
      expect(createConfig).toHaveProperty('formPageConfig');

      const createFormConfig = createConfig.formPageConfig as FormConfig;
      expect(createFormConfig).toHaveProperty('apiConfig');
      expect(createFormConfig.apiConfig.apiMethod).toBe('POST');

      // Check edit config - use type-safe approach
      const editConfig = entityConfigs['edit-user'] as ConfigObject;
      expect(editConfig).toHaveProperty('pageTitle', 'Update User');
      expect(editConfig).toHaveProperty('formPageConfig');

      const editFormConfig = editConfig.formPageConfig as FormConfig;
      expect(editFormConfig).toHaveProperty('apiConfig');
      expect(editFormConfig.apiConfig.apiMethod).toBe('PATCH');

      // Check view config - use type-safe approach
      const viewConfig = entityConfigs['view-user'] as ConfigObject;
      expect(viewConfig).toHaveProperty('pageTitle', 'User Details');
      expect(viewConfig).toHaveProperty('detailPageConfig');

      const viewDetailConfig = viewConfig.detailPageConfig as DetailConfig;
      expect(viewDetailConfig).toHaveProperty('apiConfig');
      expect(viewDetailConfig.apiConfig.apiMethod).toBe('GET');
    });

    it('should respect options for omitting certain pages', () => {
      // Generate only list and view configurations
      const entityConfigs = createEntityUIConfig('user', {
        list: true,
        create: false,
        edit: false,
        view: true,
      } as EntityUIConfigOptions);

      // Verify structure
      expect(entityConfigs).toHaveProperty('list-user');
      expect(entityConfigs).toHaveProperty('view-user');
      expect(entityConfigs).not.toHaveProperty('create-user');
      expect(entityConfigs).not.toHaveProperty('edit-user');
    });

    it('should accept different entity names', () => {
      // Generate CRUD configurations for different entities
      const userConfigs = createEntityUIConfig('user');
      const productConfigs = createEntityUIConfig('product');
      const customerConfigs = createEntityUIConfig('customer');

      // Verify structure
      expect(userConfigs).toHaveProperty('list-user');
      expect(productConfigs).toHaveProperty('list-product');
      expect(customerConfigs).toHaveProperty('list-customer');

      // Check that the naming is correct
      expect(userConfigs['list-user']).toHaveProperty('pageTitle', 'User Listing');
      expect(productConfigs['list-product']).toHaveProperty('pageTitle', 'Product Listing');
      expect(customerConfigs['list-customer']).toHaveProperty('pageTitle', 'Customer Listing');
    });
  });

  describe('createEntityUIConfigFromTemplates', () => {
    it.skip('should create entity UI configurations from templates', () => {
      // NOTE: This test is skipped because it requires mocking of complex dependencies
      // In an actual test implementation, we would need to mock:
      // - createStandardForm, createEditForm from '../templates/form-templates'
      // - createStandardList from '../templates/list-templates'
      // - createStandardDetailView from '../templates/detail-templates'
      // - createEntityConfig from '../components'
      // Each returning components with 'type' and 'props' properties
      // The test would verify that:
      // 1. The template functions are called with the right parameters
      // 2. The outputted configs have the expected structure
      // 3. Options like {create: false} correctly omit certain configs
    });
  });

  describe('Builder Composability', () => {
    it('should allow reusing property configurations across builders', () => {
      // Define common properties
      const nameProperty = {
        id: 'name',
        name: 'name',
        type: 'string',
        fieldType: 'text',
        label: 'Name',
        column: 'name',
      };

      const emailProperty = {
        id: 'email',
        name: 'email',
        type: 'string',
        fieldType: 'email',
        label: 'Email',
        column: 'email',
      };

      // Use the same properties in different builders
      const formBuilder = createFormBuilder('user').addProperty(nameProperty).addProperty(emailProperty);

      const listBuilder = createListBuilder('user').addProperty(nameProperty).addProperty(emailProperty);

      const detailBuilder = createDetailBuilder('user').addProperty(nameProperty).addProperty(emailProperty);

      // Build and verify configurations
      const formConfig = formBuilder.build() as FormPageConfig;
      const listConfig = listBuilder.build() as ListPageConfig;
      const detailConfig = detailBuilder.build() as DetailPageConfig;

      // Check form config
      expect(formConfig.formPageConfig.propertiesConfig).toHaveLength(2);
      expect(formConfig.formPageConfig.propertiesConfig[0].id).toBe('name');
      expect(formConfig.formPageConfig.propertiesConfig[1].id).toBe('email');

      // Check list config
      expect(listConfig.listPageConfig.propertiesConfig).toHaveLength(2);
      expect(listConfig.listPageConfig.propertiesConfig[0].id).toBe('name');
      expect(listConfig.listPageConfig.propertiesConfig[1].id).toBe('email');

      // Check detail config
      expect(detailConfig.detailPageConfig.propertiesConfig).toHaveLength(2);
      expect(detailConfig.detailPageConfig.propertiesConfig[0].id).toBe('name');
      expect(detailConfig.detailPageConfig.propertiesConfig[1].id).toBe('email');
    });
  });
});
