/**
 * Tests for Templates in UI Config Builder
 */

import { createStandardForm, createSectionedForm, createEditForm } from '../templates/form-templates';

import { createStandardList, createFilteredList } from '../templates/list-templates';

import {
  createStandardDetailView,
  createSectionedDetailView,
  createDetailViewWithRelated,
} from '../templates/detail-templates';

import { PropertyConfig } from '../types';

describe('Form Templates', () => {
  // Sample fields for testing
  const sampleFields: PropertyConfig[] = [
    {
      id: 'name',
      name: 'name',
      type: 'string',
      fieldType: 'text',
      label: 'Name',
      column: 'name',
    },
    {
      id: 'email',
      name: 'email',
      type: 'string',
      fieldType: 'email',
      label: 'Email',
      column: 'email',
    },
    {
      id: 'active',
      name: 'active',
      type: 'boolean',
      fieldType: 'switch',
      label: 'Active',
      column: 'active',
    },
  ];

  describe('createStandardForm', () => {
    it('should create a standard form with default values', () => {
      const form = createStandardForm({
        entityName: 'user',
        fields: sampleFields,
      });

      // Verify basic structure
      expect(form.pageType).toBe('form');
      expect(form.pageTitle).toBe('Create user');
      expect(form.formPageConfig.formButtons).toContain('submit');
      expect(form.formPageConfig.propertiesConfig).toHaveLength(3);
      expect(form.formPageConfig.apiConfig.apiMethod).toBe('POST');
      expect(form.formPageConfig.apiConfig.apiUrl).toBe('/user');
      expect(form.formPageConfig.apiConfig.responseKey).toBe('user');
      expect(form.formPageConfig.submitSuccessRedirect).toBe('/list-user');
    });

    it('should allow customization of all options', () => {
      const form = createStandardForm({
        entityName: 'user',
        fields: sampleFields,
        title: 'Custom Form Title',
        description: 'Custom form description',
        showBackButton: false,
        backUrl: '/custom-back',
        submitRedirect: '/custom-redirect',
        method: 'PATCH',
        url: '/custom-url',
        responseKey: 'customResponse',
      });

      // Verify customizations
      expect(form.pageTitle).toBe('Custom Form Title');
      expect(form.formPageConfig.pageDescription).toBe('Custom form description');
      expect(form.pageHeaderActions).toBeUndefined(); // No back button
      expect(form.formPageConfig.apiConfig.apiMethod).toBe('PATCH');
      expect(form.formPageConfig.apiConfig.apiUrl).toBe('/custom-url');
      expect(form.formPageConfig.apiConfig.responseKey).toBe('customResponse');
      expect(form.formPageConfig.submitSuccessRedirect).toBe('/custom-redirect');
    });
  });

  describe('createSectionedForm', () => {
    it('should create a form with sections', () => {
      const sections = [
        {
          title: 'Basic Info',
          fieldIds: ['name', 'email'],
          description: 'User identity info',
        },
        {
          title: 'Settings',
          fieldIds: ['active'],
          collapsible: true,
          defaultOpen: false,
        },
      ];

      const form = createSectionedForm(
        {
          entityName: 'user',
          fields: sampleFields,
          title: 'Sectioned Form',
        },
        sections,
      );

      // Verify sections
      expect(form.formPageConfig.sections).toHaveLength(2);
      expect(form.formPageConfig.sections?.[0].title).toBe('Basic Info');
      expect(form.formPageConfig.sections?.[0].description).toBe('User identity info');
      expect(form.formPageConfig.sections?.[0].fields).toHaveLength(2);
      expect(form.formPageConfig.sections?.[1].title).toBe('Settings');
      expect(form.formPageConfig.sections?.[1].fields).toHaveLength(1);
      expect(form.formPageConfig.sections?.[1].collapsible).toBe(true);
      expect(form.formPageConfig.sections?.[1].defaultOpen).toBe(false);
    });
  });

  describe('createEditForm', () => {
    it('should create an edit form with delete action', () => {
      const form = createEditForm({
        entityName: 'user',
        fields: sampleFields,
      });

      // Verify edit form specifics
      expect(form.pageTitle).toBe('Edit user');
      expect(form.formPageConfig.apiConfig.apiMethod).toBe('PATCH');
      expect(form.formPageConfig.apiConfig.apiUrl).toBe('/user/:id');

      // Check for delete action
      const actions = form.pageHeaderActions || [];
      const deleteAction = actions.find(action => action.label === 'Delete');
      expect(deleteAction).toBeDefined();
      expect(deleteAction?.icon).toBe('delete');
      expect(deleteAction?.modalConfig).toBeDefined();
      if (deleteAction?.modalConfig) {
        expect(deleteAction.modalConfig.apiConfig?.apiMethod).toBe('DELETE');
        expect(deleteAction.modalConfig.apiConfig?.apiUrl).toBe('/user/:id');
      }
    });
  });
});

describe('List Templates', () => {
  // Sample columns for testing
  const sampleColumns: PropertyConfig[] = [
    {
      id: 'name',
      name: 'name',
      type: 'string',
      fieldType: 'text',
      label: 'Name',
      column: 'name',
    },
    {
      id: 'email',
      name: 'email',
      type: 'string',
      fieldType: 'email',
      label: 'Email',
      column: 'email',
    },
  ];

  describe('createStandardList', () => {
    it('should create a standard list with default values', () => {
      const list = createStandardList({
        entityName: 'user',
        columns: sampleColumns,
      });

      // Verify basic structure
      expect(list.pageType).toBe('list');
      expect(list.pageTitle).toBe('user List');
      expect(list.listPageConfig.propertiesConfig).toHaveLength(2);
      expect(list.listPageConfig.rowActions).toHaveLength(3); // View, Edit, Delete

      // Check for create action
      const actions = list.pageHeaderActions || [];
      expect(actions.length).toBeGreaterThan(0);
      expect(actions[0].label).toBe('Create');
      expect(actions[0].url).toBe('/create-user');
    });

    it('should allow customization of actions', () => {
      const list = createStandardList({
        entityName: 'user',
        columns: sampleColumns,
        showCreateButton: false,
        showViewAction: false,
        showEditAction: true,
        showDeleteAction: false,
      });

      // Verify customized actions
      expect(list.pageHeaderActions).toBeUndefined(); // No create button
      expect(list.listPageConfig.rowActions).toHaveLength(1); // Only Edit
      const rowAction = list.listPageConfig.rowActions?.[0];
      expect(rowAction?.label).toBe('Edit');
    });
  });

  describe('createFilteredList', () => {
    it('should create a list with filters', () => {
      const filters = [
        {
          field: 'status',
          label: 'Status',
          type: 'select' as const,
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
          ],
          defaultValue: 'active',
        },
        {
          field: 'createdAt',
          label: 'Created Date',
          type: 'dateRange' as const,
        },
      ];

      const list = createFilteredList(
        {
          entityName: 'user',
          columns: sampleColumns,
        },
        filters,
      );

      // Verify filters
      expect(list.listPageConfig.listConfig?.showFilters).toBe(true);
      expect(list.listPageConfig.listConfig?.filters).toHaveLength(2);
      expect(list.listPageConfig.listConfig?.filters?.[0].field).toBe('status');
      expect(list.listPageConfig.listConfig?.filters?.[0].type).toBe('select');
      expect(list.listPageConfig.listConfig?.filters?.[1].field).toBe('createdAt');
      expect(list.listPageConfig.listConfig?.filters?.[1].type).toBe('dateRange');
    });
  });
});

describe('Detail Templates', () => {
  // Sample fields for testing
  const sampleFields: PropertyConfig[] = [
    {
      id: 'name',
      name: 'name',
      type: 'string',
      fieldType: 'text',
      label: 'Name',
      column: 'name',
    },
    {
      id: 'email',
      name: 'email',
      type: 'string',
      fieldType: 'email',
      label: 'Email',
      column: 'email',
    },
    {
      id: 'active',
      name: 'active',
      type: 'boolean',
      fieldType: 'switch',
      label: 'Active',
      column: 'active',
    },
  ];

  describe('createStandardDetailView', () => {
    it('should create a standard detail view with default values', () => {
      const detail = createStandardDetailView({
        entityName: 'user',
        fields: sampleFields,
      });

      // Verify basic structure
      expect(detail.pageType).toBe('detail');
      expect(detail.pageTitle).toBe('user Details');
      expect(detail.detailPageConfig.propertiesConfig).toHaveLength(3);
      expect(detail.detailPageConfig.apiConfig.apiMethod).toBe('GET');
      expect(detail.detailPageConfig.apiConfig.apiUrl).toBe('/user/:id');
      expect(detail.detailPageConfig.apiConfig.responseKey).toBe('user');

      // Check for actions
      const actions = detail.pageHeaderActions || [];
      expect(actions.length).toBe(3); // Back, Edit, Delete
      expect(actions[0].label).toBe('Back');
      expect(actions[1].label).toBe('Edit');
      expect(actions[2].label).toBe('Delete');
    });

    it('should allow customization of buttons', () => {
      const detail = createStandardDetailView({
        entityName: 'user',
        fields: sampleFields,
        showBackButton: false,
        showEditButton: false,
        showDeleteButton: true,
      });

      // Verify customized actions
      const actions = detail.pageHeaderActions || [];
      expect(actions.length).toBe(1); // Only Delete
      expect(actions[0].label).toBe('Delete');
    });
  });

  describe('createSectionedDetailView', () => {
    it('should create a detail view with sections', () => {
      const sections = [
        {
          title: 'Basic Info',
          key: 'basic',
          fieldIds: ['name', 'email'],
          description: 'User identity info',
        },
        {
          title: 'Settings',
          key: 'settings',
          fieldIds: ['active'],
          collapsed: true,
          icon: 'settings',
        },
      ];

      const detail = createSectionedDetailView(
        {
          entityName: 'user',
          fields: sampleFields,
        },
        sections,
      );

      // Verify sections
      expect(detail.detailPageConfig.sections).toHaveLength(2);
      expect(detail.detailPageConfig.sections?.[0].title).toBe('Basic Info');
      expect(detail.detailPageConfig.sections?.[0].key).toBe('basic');
      expect(detail.detailPageConfig.sections?.[0].description).toBe('User identity info');
      expect(detail.detailPageConfig.sections?.[0].fields).toHaveLength(2);
      expect(detail.detailPageConfig.sections?.[1].title).toBe('Settings');
      expect(detail.detailPageConfig.sections?.[1].icon).toBe('settings');
      expect(detail.detailPageConfig.sections?.[1].collapsed).toBe(true);
    });
  });

  describe('createDetailViewWithRelated', () => {
    it('should create a detail view with related entities', () => {
      const relatedEntities = [
        {
          entityName: 'order',
          title: 'User Orders',
          relationPath: 'orders',
          displayFields: ['id', 'date', 'total'],
          displayType: 'table' as const,
          actions: [
            {
              label: 'View Order',
              icon: 'eye',
              url: '/view-order/:id',
            },
          ],
        },
      ];

      const detail = createDetailViewWithRelated(
        {
          entityName: 'user',
          fields: sampleFields,
        },
        relatedEntities,
      );

      // Verify related entities
      expect(detail.detailPageConfig.relatedEntities).toHaveLength(1);
      expect(detail.detailPageConfig.relatedEntities?.[0].entityName).toBe('order');
      expect(detail.detailPageConfig.relatedEntities?.[0].title).toBe('User Orders');
      expect(detail.detailPageConfig.relatedEntities?.[0].relationField).toBe('orders');

      // Check propertiesConfig is created from displayFields
      const relatedProperties = detail.detailPageConfig.relatedEntities?.[0].propertiesConfig || [];
      expect(relatedProperties.length).toBe(3);
      expect(relatedProperties.map(p => p.id)).toEqual(['id', 'date', 'total']);

      expect(detail.detailPageConfig.relatedEntities?.[0].displayType).toBe('table');
      expect(detail.detailPageConfig.relatedEntities?.[0].actions).toHaveLength(1);
    });
  });
});
