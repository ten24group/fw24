/**
 * Tests for additional builder methods to improve coverage
 */

import { createFormBuilder, createListBuilder, createDetailBuilder } from '../core';
import { FormBuilder } from '../core/FormBuilder';
import { ListBuilder } from '../core/ListBuilder';
import { DetailBuilder } from '../core/DetailBuilder';
import {
  FormPageConfig,
  ListPageConfig,
  DetailPageConfig,
  ApiConfig,
  FormSection,
  TableConfig,
  RelatedEntity,
  FormButton,
  PropertyConfig,
} from '../types';

// Sample property for testing
const nameProperty: PropertyConfig = {
  id: 'name',
  name: 'name',
  type: 'string',
  fieldType: 'text',
  label: 'Name',
  column: 'name',
};

describe('FormBuilder Methods', () => {
  it('should set and get card style', () => {
    const builder = createFormBuilder('user').addProperty(nameProperty).setCardStyle({ width: '100%' });

    const config = builder.build();
    expect(config.cardStyle).toEqual({ width: '100%' });
  });

  it('should set and get breadcrumbs', () => {
    const breadcrumbs = [
      { label: 'Home', url: '/' },
      { label: 'Users', url: '/users' },
    ];

    const builder = createFormBuilder('user').addProperty(nameProperty).setBreadcrumbs(breadcrumbs);

    const config = builder.build();
    expect(config.breadcrums).toEqual(breadcrumbs);
  });

  it('should add a breadcrumb', () => {
    const builder = createFormBuilder('user').addProperty(nameProperty).addBreadcrumb('Home', '/');

    const config = builder.build();
    expect(config.breadcrums).toHaveLength(1);
    expect(config.breadcrums?.[0]).toEqual({ label: 'Home', url: '/' });
  });

  it('should set API config', () => {
    const apiConfig: ApiConfig = {
      apiMethod: 'PUT',
      apiUrl: '/custom-endpoint',
      responseKey: 'customKey',
    };

    const builder = createFormBuilder('user').addProperty(nameProperty).setApiConfig(apiConfig);

    const config = builder.build();
    expect(config.formPageConfig.apiConfig).toEqual(apiConfig);
  });

  it('should set detail API config for edit forms', () => {
    const detailApiConfig: ApiConfig = {
      apiMethod: 'GET',
      apiUrl: '/fetch-user/:id',
      responseKey: 'userData',
    };

    const builder = createFormBuilder('user').addProperty(nameProperty).setDetailApiConfig(detailApiConfig);

    const config = builder.build();
    expect(config.formPageConfig.detailApiConfig).toEqual(detailApiConfig);
  });

  it('should add a form button', () => {
    const builder = createFormBuilder('user').addProperty(nameProperty).addFormButton('reset');

    const config = builder.build();
    expect(config.formPageConfig.formButtons).toContain('reset');
  });

  it('should set form buttons', () => {
    const cancelButton: FormButton = {
      text: 'Cancel',
      type: 'default',
    };

    const buttons: ('submit' | 'reset' | FormButton)[] = ['submit', cancelButton];

    const builder = createFormBuilder('user').addProperty(nameProperty).setFormButtons(buttons);

    const config = builder.build();
    expect(config.formPageConfig.formButtons).toEqual(buttons);
  });

  it('should set submit success redirect', () => {
    const builder = createFormBuilder('user').addProperty(nameProperty).setSubmitSuccessRedirect('/thank-you');

    const config = builder.build();
    expect(config.formPageConfig.submitSuccessRedirect).toBe('/thank-you');
  });

  it('should set form layout', () => {
    const builder = createFormBuilder('user').addProperty(nameProperty).setFormLayout('horizontal');

    const config = builder.build();
    expect(config.formPageConfig.formLayout).toBe('horizontal');
  });

  it('should set form item layout', () => {
    const layout = { labelCol: { span: 8 }, wrapperCol: { span: 16 } };

    const builder = createFormBuilder('user').addProperty(nameProperty).setFormItemLayout(layout);

    const config = builder.build();
    expect(config.formPageConfig.formItemLayout).toEqual(layout);
  });

  it('should set form sections', () => {
    const sections: FormSection[] = [
      {
        title: 'Basic Info',
        key: 'basic',
        fields: ['name'],
      },
    ];

    const builder = createFormBuilder('user').addProperty(nameProperty).setFormSections(sections);

    const config = builder.build();
    expect(config.formPageConfig.formSections).toEqual(sections);
  });

  it('should add a form section', () => {
    const section: FormSection = {
      title: 'Basic Info',
      key: 'basic',
      fields: ['name'],
    };

    const builder = createFormBuilder('user').addProperty(nameProperty).addFormSection(section);

    const config = builder.build();
    expect(config.formPageConfig.formSections).toHaveLength(1);
    expect(config.formPageConfig.formSections?.[0]).toEqual(section);
  });

  it('should set custom submit handler', () => {
    const builder = createFormBuilder('user').addProperty(nameProperty).setSubmitHandler('customSubmitHandler');

    const config = builder.build();
    expect(config.formPageConfig.onSubmitHandler).toBe('customSubmitHandler');
  });
});

describe('ListBuilder Methods', () => {
  it('should set card style', () => {
    const builder = createListBuilder('user').addProperty(nameProperty).setCardStyle({ width: '100%' });

    const config = builder.build();
    expect(config.cardStyle).toEqual({ width: '100%' });
  });

  it('should add and manage breadcrumbs', () => {
    const builder = createListBuilder('user')
      .addProperty(nameProperty)
      .addBreadcrumb('Home', '/')
      .addBreadcrumb('Users', '/users');

    const config = builder.build();
    expect(config.breadcrums).toHaveLength(2);
    expect(config.breadcrums?.[0].label).toBe('Home');
    expect(config.breadcrums?.[1].url).toBe('/users');
  });

  it('should set table config', () => {
    const tableConfig: TableConfig = {
      scroll: { x: 1500 },
      size: 'small',
      bordered: true,
    };

    const builder = createListBuilder('user').addProperty(nameProperty).setTableConfig(tableConfig);

    const config = builder.build();
    expect(config.listPageConfig.tableConfig).toEqual(tableConfig);
  });

  it('should set filter config', () => {
    const filterConfig = {
      position: 'top',
      filters: {
        status: {
          type: 'select',
          options: [
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ],
        },
      },
    };

    const builder = createListBuilder('user').addProperty(nameProperty).setFilterConfig(filterConfig);

    const config = builder.build();
    expect(config.listPageConfig.filterConfig).toEqual(filterConfig);
  });

  it('should set search config', () => {
    const searchConfig = {
      placeholder: 'Search users...',
      properties: ['name', 'email'],
    };

    const builder = createListBuilder('user').addProperty(nameProperty).setSearchConfig(searchConfig);

    const config = builder.build();
    expect(config.listPageConfig.searchConfig).toEqual(searchConfig);
  });

  it('should set pagination config', () => {
    const paginationConfig = {
      pageSize: 25,
      showSizeChanger: true,
      position: 'bottom',
    };

    const builder = createListBuilder('user').addProperty(nameProperty).setPaginationConfig(paginationConfig);

    const config = builder.build();
    expect(config.listPageConfig.paginationConfig).toEqual(paginationConfig);
  });

  it('should add default view action', () => {
    const builder = createListBuilder('user').addProperty(nameProperty).addDefaultViewAction('user');

    const config = builder.build();
    const actions = config.listPageConfig.rowActions || [];
    expect(actions.length).toBeGreaterThan(0);

    const viewAction = actions.find(a => a.label === 'View');
    expect(viewAction).toBeDefined();
    expect(viewAction?.url).toBe('/view-user');
  });

  it('should add default edit action', () => {
    const builder = createListBuilder('user').addProperty(nameProperty).addDefaultEditAction('user');

    const config = builder.build();
    const actions = config.listPageConfig.rowActions || [];

    const editAction = actions.find(a => a.label === 'Edit');
    expect(editAction).toBeDefined();
    expect(editAction?.url).toBe('/edit-user');
  });

  it('should add default delete action', () => {
    const builder = createListBuilder('user').addProperty(nameProperty).addDefaultDeleteAction('user');

    const config = builder.build();
    const actions = config.listPageConfig.rowActions || [];

    const deleteAction = actions.find(a => a.label === 'Delete');
    expect(deleteAction).toBeDefined();
    expect(deleteAction?.icon).toBe('delete');
    expect(deleteAction?.modalConfig).toBeDefined();
  });

  it('should add all default CRUD actions', () => {
    const builder = createListBuilder('user').addProperty(nameProperty).addDefaultCrudActions('user');

    const config = builder.build();
    const actions = config.listPageConfig.rowActions || [];
    expect(actions.length).toBeGreaterThanOrEqual(3);

    expect(actions.some(a => a.label === 'View')).toBe(true);
    expect(actions.some(a => a.label === 'Edit')).toBe(true);
    expect(actions.some(a => a.label === 'Delete')).toBe(true);
  });
});

describe('DetailBuilder Methods', () => {
  it('should set card style', () => {
    const builder = createDetailBuilder('user').addProperty(nameProperty).setCardStyle({ width: '100%' });

    const config = builder.build();
    expect(config.cardStyle).toEqual({ width: '100%' });
  });

  it('should set and manage breadcrumbs', () => {
    const breadcrumbs = [
      { label: 'Home', url: '/' },
      { label: 'Users', url: '/users' },
    ];

    const builder = createDetailBuilder('user').addProperty(nameProperty).setBreadcrumbs(breadcrumbs);

    const config = builder.build();
    expect(config.breadcrums).toEqual(breadcrumbs);
  });

  it('should set layout type', () => {
    const builder = createDetailBuilder('user').addProperty(nameProperty).setLayout('two-column');

    const config = builder.build();
    expect(config.detailPageConfig.layout).toBe('two-column');
  });

  it('should set sections', () => {
    const sections = [
      {
        title: 'Basic Info',
        key: 'basic',
        fields: ['name', 'email'],
      },
      {
        title: 'Address',
        key: 'address',
        fields: ['street', 'city'],
      },
    ];

    const builder = createDetailBuilder('user').addProperty(nameProperty).setSections(sections);

    const config = builder.build();
    expect(config.detailPageConfig.sections).toEqual(sections);
  });

  it('should add a section', () => {
    const section = {
      title: 'Basic Info',
      key: 'basic',
      fields: ['name', 'email'],
    };

    const builder = createDetailBuilder('user').addProperty(nameProperty).addSection(section);

    const config = builder.build();
    expect(config.detailPageConfig.sections).toHaveLength(1);
    expect(config.detailPageConfig.sections?.[0]).toEqual(section);
  });

  it('should set related entities', () => {
    const relatedEntities: RelatedEntity[] = [
      {
        entityName: 'order',
        title: 'Orders',
        relationField: 'userId',
        displayType: 'table',
        apiConfig: {
          apiMethod: 'GET',
          apiUrl: '/orders?userId=:id',
        },
        propertiesConfig: [
          {
            id: 'id',
            name: 'id',
            type: 'string',
            label: 'ID',
            fieldType: 'text',
            column: 'id',
          },
        ],
      },
    ];

    const builder = createDetailBuilder('user').addProperty(nameProperty).setRelatedEntities(relatedEntities);

    const config = builder.build();
    expect(config.detailPageConfig.relatedEntities).toEqual(relatedEntities);
  });

  it('should add a related entity', () => {
    const relatedEntity: RelatedEntity = {
      entityName: 'order',
      title: 'Orders',
      relationField: 'userId',
      displayType: 'table',
      apiConfig: {
        apiMethod: 'GET',
        apiUrl: '/orders?userId=:id',
      },
      propertiesConfig: [
        {
          id: 'id',
          name: 'id',
          type: 'string',
          label: 'ID',
          fieldType: 'text',
          column: 'id',
        },
      ],
    };

    const builder = createDetailBuilder('user').addProperty(nameProperty).addRelatedEntity(relatedEntity);

    const config = builder.build();
    expect(config.detailPageConfig.relatedEntities).toHaveLength(1);
    expect(config.detailPageConfig.relatedEntities?.[0]).toEqual(relatedEntity);
  });

  it('should add default edit action', () => {
    const builder = createDetailBuilder('user').addProperty(nameProperty).addDefaultEditAction('user');

    const config = builder.build();
    const actions = config.pageHeaderActions || [];

    const editAction = actions.find(a => a.label === 'Edit');
    expect(editAction).toBeDefined();
    expect(editAction?.url).toBe('/edit-user/:id');
  });

  it('should add default delete action', () => {
    const builder = createDetailBuilder('user').addProperty(nameProperty).addDefaultDeleteAction('user');

    const config = builder.build();
    const actions = config.pageHeaderActions || [];

    const deleteAction = actions.find(a => a.label === 'Delete');
    expect(deleteAction).toBeDefined();
    expect(deleteAction?.icon).toBe('delete');
    expect(deleteAction?.modalConfig).toBeDefined();
  });

  it('should add default back to list action', () => {
    const builder = createDetailBuilder('user').addProperty(nameProperty).addDefaultBackToListAction('user');

    const config = builder.build();
    const actions = config.pageHeaderActions || [];

    const backAction = actions.find(a => a.label === 'Back to List');
    expect(backAction).toBeDefined();
    expect(backAction?.url).toBe('/list-user');
  });
});
