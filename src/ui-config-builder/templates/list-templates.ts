/**
 * List Templates for UI Config Builder
 */

import { DataTable, Action, Page } from '../components';
import { ComponentInstance } from '../types/common-types';
import { PropertyConfig } from '../types';
import { RowAction } from '../types/list-types';

/**
 * Create a standard list template
 */
export function createStandardList(options: {
  entityName: string;
  title?: string;
  description?: string;
  columns: PropertyConfig[];
  listUrl?: string;
  responseKey?: string;
  showCreateButton?: boolean;
  createUrl?: string;
  pagination?: boolean | object;
  search?: boolean | object;
  rowActions?: RowAction[];
  includeDefaultActions?: boolean;
}): ComponentInstance {
  const {
    entityName,
    title = `${entityName} Listing`,
    description,
    columns,
    listUrl = `/${entityName.toLowerCase()}`,
    responseKey = 'items',
    showCreateButton = true,
    createUrl = `/create-${entityName.toLowerCase()}`,
    pagination = true,
    search = true,
    rowActions = [],
    includeDefaultActions = true,
  } = options;

  const actions = [];

  if (showCreateButton) {
    actions.push(
      Action({
        label: 'Create',
        url: createUrl,
      }),
    );
  }

  const allRowActions = [...rowActions];

  if (includeDefaultActions) {
    // View action
    allRowActions.push({
      label: 'View',
      icon: 'eye',
      url: `/view-${entityName.toLowerCase()}`,
      urlParams: ['id'],
    });

    // Edit action
    allRowActions.push({
      label: 'Edit',
      icon: 'edit',
      url: `/edit-${entityName.toLowerCase()}`,
      urlParams: ['id'],
    });

    // Delete action
    allRowActions.push({
      label: 'Delete',
      icon: 'delete',
      openInModal: true,
      modalConfig: {
        title: `Delete ${entityName}`,
        content: `Are you sure you want to delete this ${entityName}?`,
        apiConfig: {
          apiMethod: 'DELETE',
          apiUrl: `/${entityName.toLowerCase()}/:id`,
        },
      },
    });
  }

  return Page({
    title,
    pageType: 'list',
    description,
    actions,
    children: [
      DataTable({
        url: listUrl,
        responseKey,
        columns,
        pagination,
        search,
        rowActions: allRowActions,
      }),
    ],
  });
}

/**
 * Create a filtered list template
 */
export function createFilteredList(options: {
  entityName: string;
  title?: string;
  description?: string;
  columns: PropertyConfig[];
  filters: string[];
  listUrl?: string;
  responseKey?: string;
  showCreateButton?: boolean;
  createUrl?: string;
  pagination?: boolean | object;
  search?: boolean | object;
  rowActions?: RowAction[];
  includeDefaultActions?: boolean;
}): ComponentInstance {
  const {
    entityName,
    title = `${entityName} Listing`,
    description,
    columns,
    filters,
    listUrl = `/${entityName.toLowerCase()}`,
    responseKey = 'items',
    showCreateButton = true,
    createUrl = `/create-${entityName.toLowerCase()}`,
    pagination = true,
    search = true,
    rowActions = [],
    includeDefaultActions = true,
  } = options;

  const listComponent = createStandardList({
    entityName,
    title,
    description,
    columns,
    listUrl,
    responseKey,
    showCreateButton,
    createUrl,
    pagination,
    search,
    rowActions,
    includeDefaultActions,
  });

  // Add filters to the DataTable component
  // We assume the first child is the DataTable
  if (listComponent.children && listComponent.children.length > 0) {
    const firstChild = listComponent.children[0];
    if (typeof firstChild !== 'string' && firstChild.type === 'DataTable') {
      firstChild.props.filters = filters;
    }
  }

  return listComponent;
}
