import { ApiConfig, PageConfig, PropertyConfig } from './index';

/**
 * Configuration for list pages
 */
export interface ListPageConfig extends PageConfig {
  pageType: 'list';
  listPageConfig: {
    apiConfig: ApiConfig;
    propertiesConfig: PropertyConfig[];
    rowActions?: RowAction[];
    tableConfig?: TableConfig;
    filterConfig?: FilterConfig;
    searchConfig?: SearchConfig;
    paginationConfig?: PaginationConfig;
    [key: string]: any;
  };
}

/**
 * Row action configuration for list tables
 */
export interface RowAction {
  label: string;
  icon?: string;
  url?: string;
  urlParams?: string[]; // Parameters to include in URL
  openInModal?: boolean;
  modalConfig?: {
    title: string;
    content?: string;
    apiConfig?: ApiConfig;
    [key: string]: any;
  };
  condition?: {
    field: string;
    operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'startsWith' | 'endsWith';
    value: any;
  };
  [key: string]: any;
}

/**
 * Table configuration
 */
export interface TableConfig {
  bordered?: boolean;
  size?: 'small' | 'middle' | 'large';
  loading?: boolean;
  showHeader?: boolean;
  title?: string;
  footer?: string;
  rowKey?: string;
  rowSelection?: {
    type: 'checkbox' | 'radio';
    actions?: Array<{
      label: string;
      apiConfig?: ApiConfig;
      [key: string]: any;
    }>;
  };
  expandable?: {
    expandedRowRender?: string; // Template name or custom function
    expandIcon?: string;
    expandRowByClick?: boolean;
  };
  [key: string]: any;
}

/**
 * Filter configuration
 */
export interface FilterConfig {
  defaultFilters?: Record<string, any>;
  showFilterPanel?: boolean;
  allowedFilters?: string[]; // Field IDs that can be filtered
  customFilters?: Array<{
    label: string;
    field: string;
    operator: string;
    value: any;
    [key: string]: any;
  }>;
  [key: string]: any;
}

/**
 * Search configuration
 */
export interface SearchConfig {
  showSearch?: boolean;
  searchPlaceholder?: string;
  searchFields?: string[]; // Fields to include in search
  searchDelay?: number; // Debounce delay in ms
  [key: string]: any;
}

/**
 * Pagination configuration
 */
export interface PaginationConfig {
  defaultPageSize?: number;
  pageSizeOptions?: number[];
  showSizeChanger?: boolean;
  showQuickJumper?: boolean;
  showTotal?: boolean;
  [key: string]: any;
}
