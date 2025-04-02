/**
 * JSX Type Definitions
 *
 * This file defines the TypeScript types for the JSX DSL used in UI Config Builder.
 * It enables proper type checking and IntelliSense for JSX elements in .tsx files.
 */

import { FieldType, DataType, ValidationRule, CSSProperties } from './common-types';

// Base props that all components can have
export interface BaseProps {
  key?: string;
  className?: string;
  style?: CSSProperties;
  [key: string]: any;
}

// Form components
export interface FormProps extends BaseProps {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  responseKey?: string;
  encType?: string;
  onSuccess?: string | Function;
  onError?: string | Function;
  initialValues?: Record<string, any>;
  submitRedirect?: string;
  layout?: 'vertical' | 'horizontal' | 'inline';
  buttons?: Array<'submit' | 'reset' | 'cancel' | string>;
}

export interface SectionProps extends BaseProps {
  title: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  description?: string;
}

export interface FieldProps extends BaseProps {
  id: string;
  name?: string;
  type?: DataType;
  fieldType?: FieldType;
  label?: string;
  placeholder?: string;
  description?: string;
  defaultValue?: any;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  validations?: ValidationRule[] | Record<string, any>[];
  options?: Array<{ label: string; value: any }> | string;
  condition?: {
    field: string;
    operator: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan';
    value: any;
  };
}

// List/table components
export interface DataTableProps extends BaseProps {
  url: string;
  responseKey?: string;
  defaultSort?: string;
  defaultSortDirection?: 'asc' | 'desc';
  perPage?: number;
  selectable?: boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
  showFilters?: boolean;
}

export interface ActionProps extends BaseProps {
  label: string;
  url?: string;
  icon?: string;
  type?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
  confirmMessage?: string;
  modalConfig?: {
    modalType: 'form' | 'confirm' | 'custom';
    modalPageConfig: Record<string, any>;
    apiConfig?: {
      apiMethod: string;
      apiUrl: string;
    };
  };
}

// Detail view components
export interface DetailViewProps extends BaseProps {
  url: string;
  responseKey?: string;
  headerActions?: Array<ActionProps | Record<string, any>>;
}

// Page components
export interface PageProps extends BaseProps {
  title: string;
  pageType?: 'form' | 'list' | 'detail' | 'dashboard' | 'custom';
  breadcrumbs?: Array<{ label: string; url?: string }>;
  layout?: 'default' | 'tabs' | 'cards' | 'custom';
}

// Layout components
export interface LayoutProps extends BaseProps {
  type?: 'tabs' | 'cards' | 'grid' | 'flex' | 'custom';
  columns?: number;
  gutter?: number | [number, number];
}

// Validation components
export interface ValidationProps extends BaseProps {
  type: ValidationRule | string;
  message?: string;
  value?: any;
}

// Option component props
export interface OptionProps extends BaseProps {
  value: string | number;
  label?: string;
}

// Define the interface for JSX elements
export interface JSXElement {
  type: string;
  props: Record<string, any>;
  children: any[];
  toConfig?: () => any;
}

// Define the JSX intrinsic elements (JSX tags)
export interface JSXIntrinsicElements {
  // Core components
  page: PageProps;
  layout: LayoutProps;
  form: FormProps;
  section: SectionProps;
  field: FieldProps;
  datatable: DataTableProps;
  detailview: DetailViewProps;
  action: ActionProps;

  // Form fields
  input: FieldProps;
  textarea: FieldProps;
  select: FieldProps;
  checkbox: FieldProps;
  radio: FieldProps;
  dateField: FieldProps;
  timeField: FieldProps;
  datetimeField: FieldProps;
  numberField: FieldProps;
  emailField: FieldProps;
  password: FieldProps;
  file: FieldProps;

  // Validation
  validation: ValidationProps;
  requiredValidation: ValidationProps;
  emailValidation: ValidationProps;
  urlValidation: ValidationProps;
  minValidation: ValidationProps;
  maxValidation: ValidationProps;
  minlengthValidation: ValidationProps;
  maxlengthValidation: ValidationProps;
  patternValidation: ValidationProps;

  // Layout elements
  tab: BaseProps;
  tabs: BaseProps;
  row: BaseProps;
  col: BaseProps & { span?: number };
  card: BaseProps;

  // Misc elements
  option: OptionProps;
  button: BaseProps & { type?: 'submit' | 'reset' | 'button' };
}

/**
 * We need to use a declaration merging pattern for JSX support
 * This is a standard TypeScript pattern for adding JSX support
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    // These interfaces intentionally extend without adding members

    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Element extends JSXElement {}

    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IntrinsicElements extends JSXIntrinsicElements {}
  }
}
