/**
 * ElementFactory - Responsible for creating and rendering elements to config objects
 */

import { flatten } from 'lodash';
import {
  Element,
  BaseElement,
  ElementOfKind,
  FormElement,
  SectionElement,
  FieldElement,
  DataTableElement,
  DetailViewElement,
  PageElement,
  ActionElement,
  ValidationElement,
} from '../types/element-types';
import { JSXIntrinsicElements } from '../types/jsx-types';
import {
  ConfigObject,
  FormProps,
  SectionProps,
  FieldProps,
  DataTableProps,
  DetailViewProps,
  PageProps,
  ActionProps,
  ValidationProps,
  PropertyConfig,
  PageHeaderAction,
  RenderContext,
} from '../types';

/**
 * Helper to check if something is an Element
 */
export const isElement = (e: unknown): e is BaseElement =>
  e !== null && typeof e === 'object' && 'kind' in (e as Record<string, unknown>);

/**
 * Create an element with proper rendering capabilities
 */
export function createElement<K extends keyof JSXIntrinsicElements>(
  kind: K,
  props: JSXIntrinsicElements[K],
  children: Array<string | BaseElement | null | undefined> = [],
): ElementOfKind<K> {
  // Filter out null/undefined and flatten nested arrays
  const filteredChildren = flatten(children.filter(Boolean)) as Array<string | BaseElement>;

  const element: BaseElement = {
    kind,
    props,
    children: filteredChildren,
    toConfig(): ConfigObject {
      return renderElement(this);
    },
    findChildrenOfKind<T extends string>(searchKind: T): ElementOfKind<T>[] {
      return this.children.filter(
        (child): child is ElementOfKind<T> => typeof child !== 'string' && child.kind === searchKind,
      );
    },
    get textContent(): string {
      return this.children.filter((child): child is string => typeof child === 'string').join('');
    },
  };

  return element as ElementOfKind<K>;
}

/**
 * Render an element to a config object
 */
export function renderElement(element: BaseElement): ConfigObject {
  // Based on the element kind, use the appropriate renderer
  switch (element.kind) {
    case 'page':
      return renderPage(element as PageElement);
    case 'form':
      return renderForm(element as FormElement);
    case 'datatable':
      return renderDataTable(element as DataTableElement);
    case 'detailview':
      return renderDetailView(element as DetailViewElement);
    case 'section':
      return renderSection(element as SectionElement);
    case 'field':
      return renderField(element as FieldElement);
    case 'action':
      return renderAction(element as ActionElement);
    case 'validation':
      return renderValidation(element as ValidationElement);
    default:
      // For unknown elements, just return the props
      return element.props as unknown as ConfigObject;
  }
}

/**
 * Render a page component
 */
function renderPage(element: PageElement): ConfigObject {
  const { title, pageType = 'custom', breadcrumbs = [], ...rest } = element.props;

  // Find content elements
  const content = element.children.map(child => (typeof child === 'string' ? child : child.toConfig())).filter(Boolean);

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
function renderForm(element: FormElement): ConfigObject {
  const {
    method = 'POST',
    url,
    responseKey,
    buttons = ['submit', 'reset'],
    layout = 'vertical',
    submitRedirect,
    ...rest
  } = element.props;

  // Process sections and collect all fields
  const allFields: PropertyConfig[] = [];
  const sections: ConfigObject[] = [];

  // Process all children
  const directFields = element.children
    .filter(child => typeof child !== 'string' && child.kind === 'field')
    .map(child => renderField(child as FieldElement)) as PropertyConfig[];

  // Add direct fields to allFields
  allFields.push(...directFields);

  // Process sections
  element.children
    .filter(child => typeof child !== 'string' && child.kind === 'section')
    .forEach(section => {
      const sectionConfig = renderSection(section as SectionElement);
      sections.push(sectionConfig);

      // Extract fields from the section
      const sectionFields = (section as SectionElement)
        .findChildrenOfKind('field')
        .map(field => renderField(field as FieldElement) as PropertyConfig);
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
function renderDataTable(element: DataTableElement): ConfigObject {
  const { url, responseKey = 'items', perPage = 10, search = true, showFilters = false, ...rest } = element.props;

  // Process fields
  const fields = element.findChildrenOfKind('field').map(field => renderField(field as FieldElement) as PropertyConfig);

  // Process actions
  const actions = element
    .findChildrenOfKind('action')
    .map(action => renderAction(action as ActionElement) as PageHeaderAction);

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
function renderDetailView(element: DetailViewElement): ConfigObject {
  const { url, responseKey, ...rest } = element.props;

  // Process fields
  const fields = element.findChildrenOfKind('field').map(field => renderField(field as FieldElement) as PropertyConfig);

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
function renderSection(element: SectionElement): ConfigObject {
  const { title, collapsible = false, defaultOpen = true, ...rest } = element.props;

  // Process fields - get field IDs for the section
  const fields = element
    .findChildrenOfKind('field')
    .map(field => (field as FieldElement).props.id || (field as FieldElement).props.name);

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
function renderField(element: FieldElement): ConfigObject {
  const { id, name, type = 'string', fieldType = 'text', label, required = false, ...rest } = element.props;

  // Process validation elements
  const validations = element
    .findChildrenOfKind('validation')
    .map(validation => renderValidation(validation as ValidationElement) as ConfigObject);

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
    validations: required ? [{ required: true }, ...validations] : validations,
    options: options.length > 0 ? options : undefined,
    ...rest,
  };
}

/**
 * Render an action component
 */
function renderAction(element: ActionElement): ConfigObject {
  const { label, url, icon, type = 'primary', confirmMessage, ...rest } = element.props;

  return {
    label,
    url,
    icon,
    buttonType: type,
    confirmMessage,
    ...rest,
  };
}

/**
 * Render a validation component
 */
function renderValidation(element: ValidationElement): ConfigObject {
  const { type, message, value, ...rest } = element.props;

  return {
    [type]: value === undefined ? true : value,
    message,
    ...rest,
  };
}
