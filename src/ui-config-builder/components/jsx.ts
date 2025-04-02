/**
 * JSX-like component system for UI Config Builder
 */

import { ComponentInstance, RenderContext } from '../types/common-types';

/**
 * Convert JSX-like component representation to UI24 configuration
 */
export function render(component: ComponentInstance, context?: RenderContext): any {
  // Import specific renderers based on component type
  const renderers: Record<string, any> = {
    Layout: renderLayout,
    Page: renderPage,
    Form: renderForm,
    DataTable: renderDataTable,
    DetailView: renderDetailView,
    Section: renderSection,
    Field: renderField,
    Action: renderAction,
    // Add more component renderers as needed
  };

  // If this is a known component type, use its renderer
  if (component.type in renderers) {
    return renderers[component.type](component, context);
  }

  // For unknown components, just return the props
  return component.props;
}

/**
 * Create a component factory for JSX-like syntax
 */
export function createElement(type: string, props: Record<string, any> | null, ...children: any[]): ComponentInstance {
  return {
    type,
    props: props || {},
    children: children.filter(child => child !== null && child !== undefined),
  };
}

/**
 * Render a layout component
 */
function renderLayout(component: ComponentInstance, context?: RenderContext): any {
  // Handle layout component
  const { type, title, ...rest } = component.props;

  return {
    ...rest,
    children: component.children?.map(child =>
      typeof child === 'string' ? child : render(child as ComponentInstance, context),
    ),
  };
}

/**
 * Render a page component
 */
function renderPage(component: ComponentInstance, context?: RenderContext): any {
  const { type, title, pageType = 'custom', breadcrumbs = [], actions = [], ...rest } = component.props;

  return {
    pageTitle: title,
    pageType,
    breadcrums: breadcrumbs,
    pageHeaderActions: actions,
    ...rest,
    content: component.children?.map(child =>
      typeof child === 'string' ? child : render(child as ComponentInstance, context),
    ),
  };
}

/**
 * Render a form component
 */
function renderForm(component: ComponentInstance, context?: RenderContext): any {
  const {
    method = 'POST',
    url,
    responseKey,
    buttons = ['submit', 'reset'],
    layout = 'vertical',
    submitRedirect,
    ...rest
  } = component.props;

  const fields = component.children
    ?.map(child => (typeof child === 'string' ? null : render(child as ComponentInstance, context)))
    .filter(Boolean);

  return {
    formPageConfig: {
      apiConfig: {
        apiMethod: method,
        apiUrl: url,
        responseKey,
      },
      formButtons: buttons,
      formLayout: layout,
      submitSuccessRedirect: submitRedirect,
      ...rest,
      propertiesConfig: fields,
    },
  };
}

/**
 * Render a data table component
 */
function renderDataTable(component: ComponentInstance, context?: RenderContext): any {
  const {
    url,
    responseKey = 'items',
    columns = [],
    pagination = true,
    search = true,
    filters = [],
    rowActions = [],
    ...rest
  } = component.props;

  // Process child components (columns, actions, etc.)
  const processedColumns =
    component.children
      ?.map(child => (typeof child === 'string' ? null : render(child as ComponentInstance, context)))
      .filter(Boolean) || [];

  return {
    listPageConfig: {
      apiConfig: {
        apiMethod: 'GET',
        apiUrl: url,
        responseKey,
      },
      propertiesConfig: [...columns, ...processedColumns],
      rowActions,
      paginationConfig: pagination === true ? { defaultPageSize: 10 } : pagination,
      searchConfig: search === true ? { showSearch: true } : search,
      filterConfig: { allowedFilters: filters },
      ...rest,
    },
  };
}

/**
 * Render a detail view component
 */
function renderDetailView(component: ComponentInstance, context?: RenderContext): any {
  const { url, responseKey, layout = 'default', ...rest } = component.props;

  // Process child components (fields, sections, etc.)
  const fields = component.children
    ?.map(child => (typeof child === 'string' ? null : render(child as ComponentInstance, context)))
    .filter(Boolean);

  return {
    detailPageConfig: {
      apiConfig: {
        apiMethod: 'GET',
        apiUrl: url,
        responseKey,
      },
      layout,
      ...rest,
      propertiesConfig: fields,
    },
  };
}

/**
 * Render a section component
 */
function renderSection(component: ComponentInstance, context?: RenderContext): any {
  const { title, key, collapsed = false, description, ...rest } = component.props;

  // Get field IDs from children
  const fieldIds = component.children
    ?.map(child => {
      if (typeof child === 'string') return null;
      const rendered = render(child as ComponentInstance, context);
      return rendered?.id;
    })
    .filter(Boolean);

  return {
    title,
    key,
    collapsed,
    description,
    fields: fieldIds,
    ...rest,
  };
}

/**
 * Render a field component
 */
function renderField(component: ComponentInstance, context?: RenderContext): any {
  const { id, name, type = 'string', fieldType = 'text', label, required = false, ...rest } = component.props;

  return {
    id,
    name: name || id,
    type,
    fieldType,
    label: label || name || id,
    validations: required ? ['required'] : [],
    ...rest,
    column: id,
  };
}

/**
 * Render an action component
 */
function renderAction(component: ComponentInstance, context?: RenderContext): any {
  const { label, url, icon, onClick, openInModal, modalConfig, ...rest } = component.props;

  return {
    label,
    url,
    icon,
    onClick,
    openInModal,
    modalConfig,
    ...rest,
  };
}
