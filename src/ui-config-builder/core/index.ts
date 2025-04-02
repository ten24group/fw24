/**
 * Core builders for UI configuration
 */

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
export function createFormBuilder(entityName: string, initialConfig?: any) {
  return new FormBuilder(entityName, initialConfig);
}

/**
 * Create a list page builder instance
 */
export function createListBuilder(entityName: string, initialConfig?: any) {
  return new ListBuilder(entityName, initialConfig);
}

/**
 * Create a detail page builder instance
 */
export function createDetailBuilder(entityName: string, initialConfig?: any) {
  return new DetailBuilder(entityName, initialConfig);
}

/**
 * Create a menu builder instance
 */
export function createMenuBuilder(initialConfig?: any) {
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
  } = {},
) {
  const { list = true, create = true, edit = true, view = true, menu = true, menuIcon = 'appStore' } = options;

  const result: Record<string, any> = {};
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

    result[`view-${entityName.toLowerCase()}`] = viewBuilder.build();
  }

  return result;
}
