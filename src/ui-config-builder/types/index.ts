/**
 * Core types for the UI Config Builder system
 * These types align with the UI24 system's configuration structure
 */

// Re-export for convenience
export * from './page-types';
export * from './form-types';
export * from './list-types';
export * from './menu-types';
export * from './common-types';

// Main configuration interface that matches UI24Config
export interface UIBuilderConfig {
  auth: any;
  menu: any;
  entities: Record<string, PageConfig>;
  dashboard: any;
}

// Base page configuration
export interface PageConfig {
  pageTitle: string;
  pageType: 'form' | 'list' | 'detail' | 'custom';
  cardStyle?: {
    width?: string;
    [key: string]: any;
  };
  breadcrums?: Array<{
    label: string;
    url: string;
  }>;
  pageHeaderActions?: Array<PageHeaderAction>;
  [key: string]: any; // Allow for extension
}

// Page header action configuration
export interface PageHeaderAction {
  label: string;
  icon?: string;
  url?: string;
  openInModal?: boolean;
  onClick?: string;
  modalConfig?: ModalConfig;
  [key: string]: any;
}

// Modal configuration
export interface ModalConfig {
  modalType: 'confirm' | 'form' | 'custom';
  modalPageConfig: {
    title: string;
    content?: string;
    [key: string]: any;
  };
  apiConfig?: ApiConfig;
  submitSuccessRedirect?: string;
  [key: string]: any;
}

// API configuration
export interface ApiConfig {
  apiMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  apiUrl: string;
  responseKey?: string;
  payload?: any;
  headers?: Record<string, string>;
  [key: string]: any;
}

// Field property configuration
export interface PropertyConfig {
  id: string;
  name: string;
  type: string;
  fieldType: string;
  label: string;
  column: string;
  isVisible?: boolean;
  isEditable?: boolean;
  isListable?: boolean;
  isCreatable?: boolean;
  isFilterable?: boolean;
  isSearchable?: boolean;
  isRequired?: boolean;
  hidden?: boolean;
  validations?: string[];
  options?: Array<{ label: string; value: string | number }> | ApiOptionConfig;
  description?: string;
  relation?: RelationConfig;
  [key: string]: any;
}

// API-based options configuration
export interface ApiOptionConfig {
  apiUrl: string;
  apiMethod: string;
  responseKey: string;
  optionMapping: {
    label: string;
    value: string;
  };
}

// Entity relation configuration
export interface RelationConfig {
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  entityName: string;
  identifiers: {
    source: string;
    target: string;
  };
}
