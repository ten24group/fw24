/**
 * Core builders for UI configuration
 */

import { FormPageConfig } from '../types/form-types';
import { ListPageConfig } from '../types/list-types';
import { DetailPageConfig } from '../types/detail-types';
import { MenuConfig } from '../types/menu-types';
import { PageHeaderAction } from '../types';

export * from './BaseBuilder';
export * from './FormBuilder';
export * from './ListBuilder';
export * from './DetailBuilder';
export * from './MenuBuilder';

// Alias exports for convenience
import { FormBuilder } from './FormBuilder';
import { ListBuilder } from './ListBuilder';
import { DetailBuilder } from './DetailBuilder';
import { MenuBuilder } from './MenuBuilder';

/**
 * Create a form page builder instance
 */
export function createFormBuilder(entityName: string, initialConfig?: Partial<FormPageConfig>) {
  return new FormBuilder(entityName, initialConfig);
}

/**
 * Create a list page builder instance
 */
export function createListBuilder(entityName: string, initialConfig?: Partial<ListPageConfig>) {
  return new ListBuilder(entityName, initialConfig);
}

/**
 * Create a detail page builder instance
 */
export function createDetailBuilder(entityName: string, initialConfig?: Partial<DetailPageConfig>) {
  return new DetailBuilder(entityName, initialConfig);
}

/**
 * Create a menu builder instance
 */
export function createMenuBuilder(initialConfig?: Partial<MenuConfig>) {
  return new MenuBuilder(initialConfig);
}

/**
 * Create a complete entity UI configuration
 */
export function createEntityUIConfig(
  entityName: string,
  options: {
    list?: boolean;
    create?: boolean;
    edit?: boolean;
    view?: boolean;
    menu?: boolean;
    menuIcon?: string;
    customConfigs?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const {
    list = true,
    create = true,
    edit = true,
    view = true,
    menu = true,
    menuIcon = 'appStore',
    customConfigs = {},
  } = options;

  const result: Record<string, Record<string, unknown>> = {
    ...customConfigs,
  };

  const pascalCaseName = entityName.charAt(0).toUpperCase() + entityName.slice(1);

  if (list) {
    const listBuilder = createListBuilder(entityName).setTitle(`${pascalCaseName} Listing`);

    if (create) {
      listBuilder.addHeaderAction({
        label: 'Create',
        url: `/create-${entityName.toLowerCase()}`,
      });
    }

    result[`list-${entityName.toLowerCase()}`] = listBuilder.build();
  }

  if (create) {
    const createBuilder = createFormBuilder(entityName).setTitle(`Create ${pascalCaseName}`);

    if (list) {
      createBuilder.addHeaderAction({
        label: 'Back',
        url: `/list-${entityName.toLowerCase()}`,
      });
    }

    result[`create-${entityName.toLowerCase()}`] = createBuilder.build();
  }

  if (edit) {
    const editBuilder = createFormBuilder(entityName).setTitle(`Update ${pascalCaseName}`);

    if (list) {
      editBuilder.addHeaderAction({
        label: 'Back',
        url: `/list-${entityName.toLowerCase()}`,
      });
    }

    // Set up edit specifics
    editBuilder.set('formPageConfig', {
      ...editBuilder.getConfig().formPageConfig,
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
    });

    result[`edit-${entityName.toLowerCase()}`] = editBuilder.build();
  }

  if (view) {
    const viewBuilder = createDetailBuilder(entityName).setTitle(`${pascalCaseName} Details`);

    if (list) {
      viewBuilder.addHeaderAction({
        label: 'Back',
        url: `/list-${entityName.toLowerCase()}`,
      });
    }

    if (edit) {
      viewBuilder.addDefaultEditAction(entityName);
    }

    // Set up view specifics
    viewBuilder.set('detailPageConfig', {
      ...viewBuilder.getConfig().detailPageConfig,
      apiConfig: {
        apiMethod: 'GET',
        apiUrl: `/${entityName.toLowerCase()}/:id`,
        responseKey: entityName.toLowerCase(),
      },
    });

    result[`view-${entityName.toLowerCase()}`] = viewBuilder.build();
  }

  return result;
}

// Import needed modules for createEntityUIConfigFromTemplates
import { createStandardForm, createEditForm } from '../templates/form-templates';
import { createStandardList } from '../templates/list-templates';
import { createStandardDetailView } from '../templates/detail-templates';
import { createEntityConfig } from '../components';
import { PropertyConfig } from '../types';

/**
 * Create a complete entity UI configuration using JSX templates
 */
export function createEntityUIConfigFromTemplates(
  entityName: string,
  options: {
    list?: boolean;
    create?: boolean;
    edit?: boolean;
    view?: boolean;
    fields?: PropertyConfig[];
    customConfigs?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const { list = true, create = true, edit = true, view = true, fields = [], customConfigs = {} } = options;

  const result: Record<string, Record<string, unknown>> = {
    ...customConfigs,
  };

  if (create && fields.length > 0) {
    const createForm = createStandardForm({
      entityName,
      fields,
      showBackButton: list,
    });

    const createConfig = createEntityConfig(entityName, createForm);
    Object.assign(result, createConfig);
  }

  if (edit && fields.length > 0) {
    const editForm = createEditForm({
      entityName,
      fields,
      showBackButton: list,
    });

    const editConfig = createEntityConfig(entityName, editForm);
    Object.assign(result, editConfig);
  }

  if (list && fields.length > 0) {
    const listView = createStandardList({
      entityName,
      columns: fields,
      showCreateButton: create,
    });

    const listConfig = createEntityConfig(entityName, listView);
    Object.assign(result, listConfig);
  }

  if (view && fields.length > 0) {
    const detailView = createStandardDetailView({
      entityName,
      fields,
      showBackButton: list,
      showEditButton: edit,
    });

    const viewConfig = createEntityConfig(entityName, detailView);
    Object.assign(result, viewConfig);
  }

  return result;
}
