/**
 * JSX Factory implementation for UI Config Builder
 *
 * Based on TypeScript JSX as a typed DSL pattern (see: https://dempfi.com/posts/type-scripts-jsx-as-a-typed-dsl/)
 */

import { flatten } from 'lodash';
import {
  FieldProps,
  FormProps,
  DataTableProps,
  DetailViewProps,
  PageProps,
  ActionProps,
  ValidationProps,
  RenderContext,
  ConfigObject,
  PageHeaderAction,
  PropertyConfig,
} from '../types';
import { JSXIntrinsicElements } from '../types/jsx-types';

// Kinds of elements our JSX supports
type ElementKind = keyof JSXIntrinsicElements;

// Helper to check if something is an Element
const isElement = (e: unknown): e is Element<ElementKind> =>
  e !== null && typeof e === 'object' && 'kind' in (e as Record<string, unknown>);

/**
 * Element class - the core of our JSX implementation
 * This follows the pattern from the blog post but adapted to our UI config needs
 */
class Element<K extends ElementKind> {
  readonly children: Array<string | Element<ElementKind>>;

  constructor(
    readonly kind: K,
    readonly props: JSXIntrinsicElements[K],
    children: Array<string | Element<ElementKind> | undefined | null>,
  ) {
    // Filter out null/undefined and flatten nested arrays
    this.children = flatten(children.filter(Boolean)) as Array<string | Element<ElementKind>>;
  }

  /**
   * Convert this Element to a UI config object
   */
  toConfig(): ConfigObject {
    // Based on the element kind, use the appropriate renderer
    const renderers: Record<string, (element: Element<any>) => ConfigObject> = {
      page: renderPage,
      form: renderForm,
      datatable: renderDataTable,
      detailview: renderDetailView,
      section: renderSection,
      field: renderField,
      action: renderAction,
      validation: renderValidation,
      // Add any other element renderers here
    };

    // If we have a renderer for this element type, use it
    if (this.kind in renderers) {
      return renderers[this.kind](this);
    }

    // For unknown elements, just return the props
    return this.props as unknown as ConfigObject;
  }

  /**
   * Find children of a specific kind
   */
  findChildrenOfKind<T extends ElementKind>(kind: T): Element<T>[] {
    return this.children
      .filter((child): child is Element<T> => isElement(child) && child.kind === kind)
      .map(child => child as Element<T>);
  }

  /**
   * Get the text content of this element (non-element children)
   */
  get textContent(): string {
    return this.children.filter(child => typeof child === 'string').join('');
  }
}

/**
 * Render a page component
 */
function renderPage(element: Element<'page'>): ConfigObject {
  const { title, pageType = 'custom', breadcrumbs = [], ...rest } = element.props as PageProps;

  // Find content elements
  const content = element.children
    .map(child => (typeof child === 'string' ? child : (child as Element<ElementKind>).toConfig()))
    .filter(Boolean);

  return {
    pageTitle: title,
    pageType,
    breadcrumbs,
    ...rest,
    content,
  };
}

/**
 * Render a form component
 */
function renderForm(element: Element<'form'>): ConfigObject {
  const {
    method = 'POST',
    url,
    responseKey,
    buttons = ['submit', 'reset'],
    layout = 'vertical',
    submitRedirect,
    ...rest
  } = element.props as FormProps;

  // Process sections and collect all fields
  const allFields: PropertyConfig[] = [];
  const sections: ConfigObject[] = [];

  // Process all children
  const directFields = element.children
    .filter(child => typeof child !== 'string' && (child as Element<ElementKind>).kind === 'field')
    .map(child => (child as Element<'field'>).toConfig()) as PropertyConfig[];

  // Add direct fields to allFields
  allFields.push(...directFields);

  // Process sections
  element.children
    .filter(child => typeof child !== 'string' && (child as Element<ElementKind>).kind === 'section')
    .forEach(section => {
      const sectionElement = section as Element<'section'>;
      const sectionConfig = sectionElement.toConfig();
      sections.push(sectionConfig);

      // Extract fields from the section
      const sectionFields = sectionElement
        .findChildrenOfKind('field')
        .map(field => renderField(field) as PropertyConfig);
      allFields.push(...sectionFields);
    });

  // Combine sections and direct fields for the final propertiesConfig
  const propertiesConfig = [...sections, ...directFields];

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
      propertiesConfig: propertiesConfig,
      // Store all fields for reference
      allFields: allFields,
    },
  };
}

/**
 * Render a data table component
 */
function renderDataTable(element: Element<'datatable'>): ConfigObject {
  const {
    url,
    responseKey = 'items',
    perPage = 10,
    search = true,
    showFilters = false,
    ...rest
  } = element.props as DataTableProps;

  // Process fields
  const fields = element.findChildrenOfKind('field').map(field => renderField(field) as PropertyConfig);

  // Process actions
  const actions = element.findChildrenOfKind('action').map(action => renderAction(action) as PageHeaderAction);

  return {
    listPageConfig: {
      apiConfig: {
        apiMethod: 'GET',
        apiUrl: url,
        responseKey,
      },
      propertiesConfig: fields,
      rowActions: actions,
      paginationConfig: { defaultPageSize: perPage },
      searchConfig: search === true ? { showSearch: true } : search,
      filterConfig: { showFilters },
      ...rest,
    },
  };
}

/**
 * Render a detail view component
 */
function renderDetailView(element: Element<'detailview'>): ConfigObject {
  const { url, responseKey, ...rest } = element.props as DetailViewProps;

  // Process fields
  const fields = element.findChildrenOfKind('field').map(field => renderField(field) as PropertyConfig);

  return {
    detailPageConfig: {
      apiConfig: {
        apiMethod: 'GET',
        apiUrl: url,
        responseKey,
      },
      ...rest,
      propertiesConfig: fields,
    },
  };
}

/**
 * Render a section component
 */
function renderSection(element: Element<'section'>): ConfigObject {
  const { title, collapsible = false, defaultOpen = true, ...rest } = element.props;

  // Process fields - get field IDs for the section
  const fields = element.findChildrenOfKind('field').map(field => field.props.id || field.props.name);

  return {
    title,
    collapsed: !defaultOpen,
    collapsible,
    fields,
    ...rest,
  };
}

/**
 * Render a field component
 */
function renderField(element: Element<'field'>): ConfigObject {
  const {
    id,
    name,
    type = 'string',
    fieldType = 'text',
    label,
    required = false,
    ...rest
  } = element.props as FieldProps;

  // Process validation elements
  const validations = element
    .findChildrenOfKind('validation')
    .map(validation => renderValidation(validation) as ConfigObject);

  // Process options
  const options = element.findChildrenOfKind('option').map(option => ({
    label: option.props.label || String(option.props.value),
    value: option.props.value,
  }));

  return {
    id,
    name: name || id,
    type,
    fieldType,
    label: label || name || id,
    validations: required ? [{ required: true }, ...validations] : validations.length ? validations : undefined,
    options: options.length ? options : undefined,
    ...rest,
    column: id,
  };
}

/**
 * Render an action component
 */
function renderAction(element: Element<'action'>): ConfigObject {
  const { label, url, icon, type = 'primary', ...rest } = element.props as ActionProps;

  return {
    label,
    url,
    icon,
    type,
    ...rest,
  };
}

/**
 * Render a validation component
 */
function renderValidation(element: Element<'validation'>): ConfigObject {
  const { type, message, value } = element.props as ValidationProps;

  return {
    [type]: value !== undefined ? value : true,
    message,
  };
}

/**
 * The createElement function that TypeScript compiler will call for JSX expressions
 * as configured in tsconfig.json with jsxFactory option
 */
export function createElement<K extends ElementKind>(
  type: K,
  props: JSXIntrinsicElements[K] | null,
  ...children: any[]
): Element<K> {
  return new Element(type, props || ({} as JSXIntrinsicElements[K]), children);
}

/**
 * Render a component tree into a configuration object
 */
export function render(component: Element<ElementKind>, _context?: RenderContext): ConfigObject {
  return component.toConfig();
}

/**
 * Build a UI configuration from JSX
 */
export function buildConfig(jsxElement: JSX.Element): ConfigObject {
  return (jsxElement as unknown as Element<ElementKind>).toConfig();
}

// Export the factory function - this is what tsconfig.jsxFactory refers to
export default {
  createElement,
  render,
  buildConfig,
};
