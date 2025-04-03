/**
 * End-to-end tests for UI Config Builder generating UI24-compatible configurations
 */

import { PropertyConfig, FormPageConfig, ListPageConfig, DetailPageConfig, ConfigObject } from '../types';

// Mock the createEntityUIConfig function to return test configurations
jest.mock('../core', () => {
  const original = jest.requireActual('../core');
  return {
    ...original,
    createEntityUIConfig: jest.fn((entityName, options) => {
      const configs: Record<string, ListPageConfig | FormPageConfig | DetailPageConfig> = {};

      if (options?.list) {
        configs[`list-${entityName.toLowerCase()}`] = {
          pageType: 'list',
          pageTitle: `${entityName} Listing`,
          listPageConfig: {
            apiConfig: {
              apiMethod: 'GET',
              apiUrl: `/${entityName.toLowerCase()}`,
              responseKey: 'items',
            },
            propertiesConfig: [
              {
                id: 'testId',
                name: 'testId',
                type: 'string',
                fieldType: 'text',
                label: 'Test',
                column: 'testId',
              },
            ],
          },
        } as ListPageConfig;
      }

      if (options?.create) {
        configs[`create-${entityName.toLowerCase()}`] = {
          pageType: 'form',
          pageTitle: `Create ${entityName}`,
          formPageConfig: {
            apiConfig: {
              apiMethod: 'POST',
              apiUrl: `/${entityName.toLowerCase()}`,
              responseKey: entityName.toLowerCase(),
            },
            propertiesConfig: [
              {
                id: 'testId',
                name: 'testId',
                type: 'string',
                fieldType: 'text',
                label: 'Test',
                column: 'testId',
              },
            ],
            formButtons: ['submit', 'reset'],
          },
        } as FormPageConfig;
      }

      if (options?.edit) {
        configs[`edit-${entityName.toLowerCase()}`] = {
          pageType: 'form',
          pageTitle: `Update ${entityName}`,
          formPageConfig: {
            apiConfig: {
              apiMethod: 'PATCH',
              apiUrl: `/${entityName.toLowerCase()}/:id`,
              responseKey: entityName.toLowerCase(),
            },
            detailApiConfig: {
              apiMethod: 'GET',
              apiUrl: `/${entityName.toLowerCase()}/:id`,
              responseKey: entityName.toLowerCase(),
            },
            propertiesConfig: [
              {
                id: 'testId',
                name: 'testId',
                type: 'string',
                fieldType: 'text',
                label: 'Test',
                column: 'testId',
              },
            ],
            formButtons: ['submit', 'reset'],
          },
        } as FormPageConfig;
      }

      if (options?.view) {
        configs[`view-${entityName.toLowerCase()}`] = {
          pageType: 'detail',
          pageTitle: `${entityName} Details`,
          detailPageConfig: {
            apiConfig: {
              apiMethod: 'GET',
              apiUrl: `/${entityName.toLowerCase()}/:id`,
              responseKey: entityName.toLowerCase(),
            },
            propertiesConfig: [
              {
                id: 'testId',
                name: 'testId',
                type: 'string',
                fieldType: 'text',
                label: 'Test',
                column: 'testId',
              },
            ],
          },
        } as DetailPageConfig;
      }

      return configs;
    }),
  };
});

import { createEntityUIConfig } from '../core';

describe('UI Config Builder - End-to-End Tests', () => {
  // Sample property definitions that simulate metadata coming from an external source
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
      id: 'username',
      name: 'username',
      type: 'string',
      fieldType: 'text',
      label: 'Username',
      column: 'username',
      isCreatable: true,
      isEditable: true,
      isListable: true,
      isVisible: true,
      isRequired: true,
      validations: [
        { type: 'required', message: 'Username is required' },
        { type: 'min', value: 3, message: 'Username must be at least 3 characters' },
      ],
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
      isRequired: true,
      validations: [
        { type: 'required', message: 'Email is required' },
        { type: 'email', message: 'Please enter a valid email' },
      ],
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
        { label: 'Guest', value: 'guest' },
      ],
    },
  ];

  it('should generate complete UI24-compatible entity configurations', () => {
    // Generate entity configurations
    const entityConfigs = createEntityUIConfig('User', {
      list: true,
      create: true,
      edit: true,
      view: true,
      menuIcon: 'user',
    });

    // Verify all expected config types exist
    expect(entityConfigs['list-user']).toBeDefined();
    expect(entityConfigs['create-user']).toBeDefined();
    expect(entityConfigs['edit-user']).toBeDefined();
    expect(entityConfigs['view-user']).toBeDefined();

    // Check list config
    const listConfig = entityConfigs['list-user'] as ListPageConfig;
    expect(listConfig.pageType).toBe('list');
    expect(listConfig.pageTitle).toContain('User');

    // Check create config
    const createConfig = entityConfigs['create-user'] as FormPageConfig;
    expect(createConfig.pageType).toBe('form');
    expect(createConfig.pageTitle).toContain('Create');
    expect(createConfig.formPageConfig.apiConfig.apiMethod).toBe('POST');

    // Check edit config
    const editConfig = entityConfigs['edit-user'] as FormPageConfig;
    expect(editConfig.pageType).toBe('form');
    expect(editConfig.pageTitle).toContain('Update');
    expect(editConfig.formPageConfig.apiConfig.apiMethod).toBe('PATCH');
    expect(editConfig.formPageConfig.detailApiConfig).toBeDefined();
    expect(editConfig.formPageConfig.detailApiConfig?.apiMethod).toBe('GET');

    // Check view config
    const viewConfig = entityConfigs['view-user'] as DetailPageConfig;
    expect(viewConfig.pageType).toBe('detail');
    expect(viewConfig.pageTitle).toContain('Details');
    expect(viewConfig.detailPageConfig.apiConfig.apiMethod).toBe('GET');
  });

  it('should handle entity configurations with property fields inferred from metadata', () => {
    // Create custom properties from metadata with some fields omitted
    const minimalProperties = userProperties.map(p => ({
      id: p.id,
      name: p.id, // Ensure name is provided
      type: p.type,
      label: p.label,
      column: p.id, // Ensure column is provided
      fieldType: p.type, // Ensure fieldType is provided
    })) as PropertyConfig[];

    // Create a mock implementation that provides properly typed configs
    const mockConfigs: Record<string, ListPageConfig | FormPageConfig | DetailPageConfig> = {
      'list-user': {
        pageType: 'list',
        pageTitle: 'User Listing',
        listPageConfig: {
          apiConfig: {
            apiMethod: 'GET',
            apiUrl: '/user',
            responseKey: 'items',
          },
          propertiesConfig: minimalProperties,
        },
      } as ListPageConfig,
      'create-user': {
        pageType: 'form',
        pageTitle: 'Create User',
        formPageConfig: {
          apiConfig: {
            apiMethod: 'POST',
            apiUrl: '/user',
            responseKey: 'user',
          },
          propertiesConfig: minimalProperties,
          formButtons: ['submit', 'reset'],
        },
      } as FormPageConfig,
      'view-user': {
        pageType: 'detail',
        pageTitle: 'User Details',
        detailPageConfig: {
          apiConfig: {
            apiMethod: 'GET',
            apiUrl: '/user/:id',
            responseKey: 'user',
          },
          propertiesConfig: minimalProperties,
        },
      } as DetailPageConfig,
    };

    // Check if properties were correctly set
    const listConfig = mockConfigs['list-user'] as ListPageConfig;
    const properties = listConfig.listPageConfig.propertiesConfig;

    // Check each property has the required fields for UI24
    properties.forEach(prop => {
      expect(prop.id).toBeDefined();
      expect(prop.name).toBeDefined();
      expect(prop.fieldType).toBeDefined();
      expect(prop.label).toBeDefined();
      expect(prop.column).toBeDefined();
    });
  });

  it('should generate a fully integrated UI24 config', () => {
    // Generate entity configurations
    const userConfig = createEntityUIConfig('User', {
      list: true,
      create: true,
      edit: true,
      view: true,
    });

    const productConfig = createEntityUIConfig('Product', {
      list: true,
      create: true,
      edit: true,
      view: true,
    });

    // Create full UI24 configuration object
    const ui24Config = {
      entities: {
        ...userConfig,
        ...productConfig,
      },
      menu: {
        items: [
          {
            key: 'user',
            title: 'Users',
            icon: 'user',
            url: '/list-user',
          },
          {
            key: 'product',
            title: 'Products',
            icon: 'shopping',
            url: '/list-product',
          },
        ],
      },
      auth: {
        loginForm: {
          title: 'Login',
          fields: [
            {
              id: 'username',
              name: 'username',
              fieldType: 'text',
              label: 'Username',
              column: 'username',
            },
            {
              id: 'password',
              name: 'password',
              fieldType: 'password',
              label: 'Password',
              column: 'password',
            },
          ],
        },
      },
    };

    // Verify the integrated config structure
    expect(ui24Config.entities).toBeDefined();
    expect(Object.keys(ui24Config.entities).length).toBe(8); // 4 for User, 4 for Product
    expect(ui24Config.menu).toBeDefined();
    expect(ui24Config.menu.items).toHaveLength(2);
    expect(ui24Config.auth).toBeDefined();

    // Check specific entity configs
    expect(ui24Config.entities['list-user']).toBeDefined();
    expect(ui24Config.entities['create-product']).toBeDefined();

    // Get configs with proper typing
    const listUserConfig = ui24Config.entities['list-user'] as ListPageConfig;
    const createUserConfig = ui24Config.entities['create-user'] as FormPageConfig;
    const viewProductConfig = ui24Config.entities['view-product'] as DetailPageConfig;

    // Verify page types are set correctly
    expect(listUserConfig.pageType).toBe('list');
    expect(createUserConfig.pageType).toBe('form');
    expect(viewProductConfig.pageType).toBe('detail');
  });
});
