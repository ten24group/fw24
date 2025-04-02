/**
 * List templates for the UI Config Builder
 *
 * These templates provide pre-built configurations for common list patterns.
 * They use the ListBuilder internally for consistency.
 */

import { ListBuilder } from '../core/ListBuilder';
import { PropertyConfig } from '../types';

export interface ListTemplateOptions {
  entityName: string;
  title?: string;
  description?: string;
  columns: PropertyConfig[];
  showCreateButton?: boolean;
  createUrl?: string;
  showEditAction?: boolean;
  showViewAction?: boolean;
  showDeleteAction?: boolean;
  includeDefaultActions?: boolean;
  idField?: string;
  perPage?: number;
  url?: string;
  responseKey?: string;
  showSearch?: boolean;
  showFilters?: boolean;
}

/**
 * Creates a standard list configuration
 *
 * This creates a simple data table with standard CRUD actions.
 * It uses ListBuilder internally to ensure consistency with the builder pattern.
 *
 * @param options Configuration options for the list
 * @returns A list page configuration
 */
export function createStandardList(options: ListTemplateOptions) {
  const {
    entityName,
    title,
    description,
    columns,
    showCreateButton = true,
    createUrl,
    showEditAction = true,
    showViewAction = true,
    showDeleteAction = true,
    includeDefaultActions = false,
    idField = 'id',
    perPage = 10,
    url,
    responseKey,
    showSearch = true,
    showFilters = false,
  } = options;

  const listBuilder = new ListBuilder(entityName);

  // Set basic properties
  listBuilder.setTitle(title || `${entityName} List`);

  if (description) {
    listBuilder.set('listPageConfig', {
      ...listBuilder.getConfig().listPageConfig,
      pageDescription: description,
    });
  }

  // Add create button if requested
  if (showCreateButton) {
    listBuilder.addHeaderAction({
      label: 'Create',
      url: createUrl || `/create-${entityName.toLowerCase()}`,
    });
  }

  // Add all columns/properties
  columns.forEach(column => {
    listBuilder.addProperty(column);
  });

  // Add standard actions if individual flags are set
  if (showViewAction) {
    listBuilder.addRowAction({
      label: 'View',
      icon: 'eye',
      url: `/view-${entityName.toLowerCase()}/:${idField}`,
    });
  }

  if (showEditAction) {
    listBuilder.addRowAction({
      label: 'Edit',
      icon: 'edit',
      url: `/edit-${entityName.toLowerCase()}/:${idField}`,
    });
  }

  if (showDeleteAction) {
    listBuilder.addRowAction({
      label: 'Delete',
      icon: 'delete',
      modalConfig: {
        title: `Delete ${entityName}`,
        content: `Are you sure you want to delete this ${entityName.toLowerCase()}?`,
        apiConfig: {
          apiMethod: 'DELETE',
          apiUrl: `/${entityName.toLowerCase()}/:${idField}`,
        },
      },
    });
  }

  // Alternatively, use the default CRUD actions helper
  if (includeDefaultActions) {
    listBuilder.addDefaultCrudActions(entityName.toLowerCase(), idField);
  }

  // Set list configuration options
  listBuilder.set('listPageConfig', {
    ...listBuilder.getConfig().listPageConfig,
    listConfig: {
      ...listBuilder.getConfig().listPageConfig?.listConfig,
      perPage,
      apiConfig: {
        apiMethod: 'GET',
        apiUrl: url || `/${entityName.toLowerCase()}`,
        responseKey: responseKey || `${entityName.toLowerCase()}s`,
      },
      showSearch,
      showFilters,
    },
  });

  return listBuilder.build();
}

/**
 * Creates a filtered list configuration
 *
 * This creates a data table with search and filter capabilities.
 * It uses ListBuilder internally to ensure consistency with the builder pattern.
 *
 * @param options Configuration options for the filtered list
 * @param filters Predefined filters to include
 * @returns A list page configuration with filters
 */
export function createFilteredList(
  options: ListTemplateOptions,
  filters?: Array<{
    field: string;
    label: string;
    type: 'select' | 'date' | 'dateRange' | 'text' | 'number';
    options?: Array<{ label: string; value: string | number }>;
    defaultValue?: any;
  }>,
) {
  // Create a standard list as base
  const config = createStandardList({
    ...options,
    showFilters: true,
  });

  // If filters are provided, add them to the configuration
  if (filters && filters.length > 0) {
    const listPageConfig = config.listPageConfig || {};
    const listConfig = listPageConfig.listConfig || {};

    listConfig.filters = filters;

    // Update the configuration
    config.listPageConfig = {
      ...listPageConfig,
      listConfig: {
        ...listConfig,
      },
    };
  }

  return config;
}
