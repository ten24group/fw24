import { PropertyConfig } from './index';

/**
 * Common utility types shared across different components
 */

// Field types supported by the UI system
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'password'
  | 'email'
  | 'url'
  | 'date'
  | 'datetime'
  | 'time'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'switch'
  | 'upload'
  | 'image'
  | 'file'
  | 'color'
  | 'slider'
  | 'rate'
  | 'cascader'
  | 'treeselect'
  | 'map'
  | 'json'
  | 'code'
  | 'richtext'
  | 'markdown'
  | 'custom';

// Type of data supported for fields
export type DataType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array' | 'map' | 'any';

// Common validation types
export type ValidationRule =
  | 'required'
  | 'min'
  | 'max'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'email'
  | 'url'
  | 'integer'
  | 'float'
  | 'oneOf'
  | 'custom';

// Entity field definition for use with builders
export interface EntityField {
  name: string;
  type: DataType;
  fieldType?: FieldType;
  label?: string;
  description?: string;
  defaultValue?: any;
  isRequired?: boolean;
  isUnique?: boolean;
  isIdentifier?: boolean;
  isVisible?: boolean;
  isEditable?: boolean;
  isListable?: boolean;
  isFilterable?: boolean;
  isSearchable?: boolean;
  validations?: ValidationRule[];
  options?: Array<{ label: string; value: any }> | string; // string refers to a dynamic options source
  properties?: Record<string, EntityField>; // For nested fields/objects
  [key: string]: any;
}

// CSS properties type for styling
export type CSSProperties = {
  [key: string]: string | number | undefined;
};

// Helper type for JSX-like components
export interface ComponentProps {
  className?: string;
  style?: CSSProperties;
  children?: any;
  [key: string]: any;
}

// Component instance for JSX-like syntax
export interface ComponentInstance<T = any> {
  type: string;
  props: T;
  children?: Array<ComponentInstance<any> | string>;
}

// Represents the render output
export type RenderOutput = Record<string, any>;

// Render context for templates
export interface RenderContext {
  entityName?: string;
  entitySchema?: any;
  operation?: 'create' | 'update' | 'list' | 'view' | 'delete';
  fields?: Record<string, PropertyConfig>;
  baseUrl?: string;
  isModal?: boolean;
  [key: string]: any;
}
